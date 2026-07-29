// Equivalencias de producto declaradas por un ADMIN.
//
// La normalizacion automatica (productoKey.js) solo une lo que es con certeza el
// mismo texto. Todo lo demas -abreviaturas, nombres propios de faena, errores
// arraigados- necesita que una persona diga "esto y esto son lo mismo". Aca eso
// queda guardado, asi la decision se toma una vez y vale para siempre.

const { all: sqliteAll, get: sqliteGet, run: sqliteRun } = require("../db/database");
const { isOperationalPgEnabled, getOperationalPool } = require("./operationalPgStore");
const { buildProductoKey, normalizeUnidad } = require("../utils/productoKey");
const { HttpError } = require("../utils/httpError");

// Corta cadenas circulares por si un dato quedara inconsistente.
const MAX_SALTOS = 10;

/**
 * Unidades de medida usadas por cada producto, agrupadas por su clave
 * normalizada.
 *
 * Se leen solo los pares distintos (nombre, unidad), que son pocos aunque haya
 * miles de solicitudes: la normalizacion del nombre ocurre en JavaScript
 * (buildProductoKey), asi que no se puede agrupar en SQL.
 */
async function unidadesPorClave() {
  const filas = isOperationalPgEnabled()
    ? (
        await getOperationalPool().query(
          "SELECT DISTINCT nombre_item, unidad_medida FROM solicitud_items"
        )
      ).rows
    : await sqliteAll("SELECT DISTINCT nombre_item, unidad_medida FROM solicitud_items");

  const porClave = new Map();
  for (const fila of filas) {
    const clave = buildProductoKey(fila.nombre_item);
    const unidad = normalizeUnidad(fila.unidad_medida);
    if (!clave || !unidad) continue;
    if (!porClave.has(clave)) porClave.set(clave, new Set());
    porClave.get(clave).add(unidad);
  }

  return porClave;
}

/**
 * Avisa si unir estos dos productos mezclaria unidades distintas (litros con
 * unidades, por ejemplo). No lo impide: puede que el ADMIN sepa que una de las
 * dos esta mal escrita y quiera unirlos igual para despues corregir. Pero el
 * total del reporte pasa a ser una suma de peras con manzanas, y eso hay que
 * decirlo antes y no despues.
 */
async function detectarConflictoDeUnidades(claveVariante, claveCanonica) {
  const porClave = await unidadesPorClave();
  const deVariante = [...(porClave.get(claveVariante) || [])];
  const deCanonica = [...(porClave.get(claveCanonica) || [])];

  const juntas = new Set([...deVariante, ...deCanonica]);
  if (juntas.size < 2) {
    return null;
  }

  return {
    unidades: [...juntas],
    variante: { clave: claveVariante, unidades: deVariante },
    canonica: { clave: claveCanonica, unidades: deCanonica },
    mensaje:
      `Ojo: estos productos no usan la misma unidad (${[...juntas].join(", ")}). ` +
      "Si los unes, el total va a sumar cantidades que no son comparables. " +
      "Conviene corregir antes la unidad en los pedidos.",
  };
}

async function listAliases() {
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rows } = await pg.query(
      `SELECT id, clave_variante, clave_canonica, nombre_canonico,
              creado_por_nombre, created_at
         FROM producto_alias
        ORDER BY clave_canonica ASC, clave_variante ASC`
    );
    return rows;
  }

  return sqliteAll(
    `SELECT id, clave_variante, clave_canonica, nombre_canonico,
            creado_por_nombre, created_at
       FROM producto_alias
      ORDER BY clave_canonica ASC, clave_variante ASC`
  );
}

// ── Nombres personalizados ──────────────────────────────────────────────────
// Distintos de los alias: un alias une dos productos; un nombre personalizado
// solo cambia como se muestra uno. Se pueden combinar (unificar y ademas
// renombrar el resultado).

async function listNombresPersonalizados() {
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rows } = await pg.query(
      `SELECT id, clave, nombre, creado_por_nombre, created_at
         FROM producto_nombre
        ORDER BY nombre ASC`
    );
    return rows;
  }

  return sqliteAll(
    `SELECT id, clave, nombre, creado_por_nombre, created_at
       FROM producto_nombre
      ORDER BY nombre ASC`
  );
}

/** Pone o reemplaza el nombre visible de un producto. */
async function setNombrePersonalizado(actor, payload = {}) {
  const clave = buildProductoKey(payload.clave);
  const nombre = String(payload.nombre || "").trim().slice(0, 80);

  if (!clave) {
    throw new HttpError(400, "Falta el producto a renombrar");
  }
  if (!nombre) {
    throw new HttpError(400, "El nombre no puede quedar vacio");
  }

  const actorId = Number(actor?.id) || null;
  const actorNombre = actor?.nombre || actor?.name || "Admin";

  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rows } = await pg.query(
      `INSERT INTO producto_nombre (clave, nombre, creado_por_id, creado_por_nombre)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (clave) DO UPDATE
         SET nombre = EXCLUDED.nombre,
             creado_por_id = EXCLUDED.creado_por_id,
             creado_por_nombre = EXCLUDED.creado_por_nombre
       RETURNING *`,
      [clave, nombre, actorId, actorNombre]
    );
    return rows[0];
  }

  await sqliteRun(
    `INSERT INTO producto_nombre (clave, nombre, creado_por_id, creado_por_nombre)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (clave) DO UPDATE
       SET nombre = excluded.nombre,
           creado_por_id = excluded.creado_por_id,
           creado_por_nombre = excluded.creado_por_nombre`,
    [clave, nombre, actorId, actorNombre]
  );

  return sqliteGet("SELECT * FROM producto_nombre WHERE clave = ?", [clave]);
}

/** Quita el nombre personalizado: el producto vuelve al automatico. */
async function deleteNombrePersonalizado(nombreId) {
  const id = Number(nombreId);
  if (!id) {
    throw new HttpError(400, "Identificador invalido");
  }

  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rowCount } = await pg.query("DELETE FROM producto_nombre WHERE id = $1", [id]);
    if (!rowCount) {
      throw new HttpError(404, "Ese nombre personalizado no existe");
    }
    return { id };
  }

  const resultado = await sqliteRun("DELETE FROM producto_nombre WHERE id = ?", [id]);
  if (!resultado.changes) {
    throw new HttpError(404, "Ese nombre personalizado no existe");
  }
  return { id };
}

/**
 * Devuelve una funcion que lleva cualquier clave a su clave canonica, siguiendo
 * la cadena si A apunta a B y B apunta a C. Se construye una sola vez por
 * reporte para no consultar la base por cada item.
 */
async function buildResolver() {
  const [aliases, personalizados] = await Promise.all([
    listAliases(),
    listNombresPersonalizados(),
  ]);

  const directo = new Map();
  const nombres = new Map();
  const nombresPersonalizados = new Map(
    personalizados.map((fila) => [fila.clave, fila.nombre])
  );

  for (const fila of aliases) {
    directo.set(fila.clave_variante, fila.clave_canonica);
    if (fila.nombre_canonico) {
      nombres.set(fila.clave_canonica, fila.nombre_canonico);
    }
  }

  function resolver(clave) {
    let actual = clave;
    for (let i = 0; i < MAX_SALTOS; i += 1) {
      const siguiente = directo.get(actual);
      if (!siguiente || siguiente === actual) {
        return actual;
      }
      actual = siguiente;
    }
    return actual;
  }

  return {
    resolver,
    nombreDe: (clave) => nombres.get(clave) || "",
    // El renombre manual manda sobre cualquier otro nombre.
    nombrePersonalizadoDe: (clave) => nombresPersonalizados.get(clave) || "",
    total: aliases.length,
    // Para mostrar en la vista que un producto agrupa nombres unificados a mano.
    variantesDe: (claveCanonica) =>
      aliases
        .filter((fila) => resolver(fila.clave_variante) === claveCanonica)
        .map((fila) => fila.clave_variante),
  };
}

async function findAliasByVariante(clave) {
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rows } = await pg.query(
      "SELECT * FROM producto_alias WHERE clave_variante = $1 LIMIT 1",
      [clave]
    );
    return rows[0] || null;
  }
  return sqliteGet("SELECT * FROM producto_alias WHERE clave_variante = ? LIMIT 1", [clave]);
}

/**
 * Une dos productos. `variante` deja de existir por su cuenta y pasa a contarse
 * dentro de `canonica`.
 */
async function createAlias(actor, payload = {}) {
  const variante = buildProductoKey(payload.claveVariante);
  let canonica = buildProductoKey(payload.claveCanonica);
  const nombreCanonico = String(payload.nombreCanonico || "").trim() || null;

  if (!variante || !canonica) {
    throw new HttpError(400, "Se requieren los dos productos a unificar");
  }

  if (variante === canonica) {
    throw new HttpError(400, "No se puede unificar un producto consigo mismo");
  }

  // Si el destino ya es alias de otro, apuntamos directo al final de la cadena.
  const { resolver } = await buildResolver();
  canonica = resolver(canonica);

  if (variante === canonica) {
    throw new HttpError(400, "Estos productos ya están unificados");
  }

  // Si la canonica resuelve hacia la variante, unirlos crearia un ciclo.
  if (resolver(canonica) === variante) {
    throw new HttpError(400, "Esa unificación crearia una referencia circular");
  }

  const existente = await findAliasByVariante(variante);
  if (existente) {
    throw new HttpError(
      409,
      "Ese producto ya esta unificado con otro. Deshace la unificación actual antes de cambiarla"
    );
  }

  const actorId = Number(actor?.id) || null;
  const actorNombre = actor?.nombre || actor?.name || "Admin";

  // Se avisa, no se bloquea: el ADMIN puede saber que una de las dos unidades
  // esta mal escrita y querer unirlos igual.
  const conflictoUnidades = await detectarConflictoDeUnidades(variante, canonica);

  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rows } = await pg.query(
      `INSERT INTO producto_alias
         (clave_variante, clave_canonica, nombre_canonico, creado_por_id, creado_por_nombre)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [variante, canonica, nombreCanonico, actorId, actorNombre]
    );
    return { ...rows[0], aviso_unidades: conflictoUnidades };
  }

  const resultado = await sqliteRun(
    `INSERT INTO producto_alias
       (clave_variante, clave_canonica, nombre_canonico, creado_por_id, creado_por_nombre)
     VALUES (?, ?, ?, ?, ?)`,
    [variante, canonica, nombreCanonico, actorId, actorNombre]
  );

  return {
    aviso_unidades: conflictoUnidades,
    id: resultado.lastID,
    clave_variante: variante,
    clave_canonica: canonica,
    nombre_canonico: nombreCanonico,
    creado_por_nombre: actorNombre,
  };
}

async function deleteAlias(aliasId) {
  const id = Number(aliasId);
  if (!id) {
    throw new HttpError(400, "Identificador invalido");
  }

  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rowCount } = await pg.query("DELETE FROM producto_alias WHERE id = $1", [id]);
    if (!rowCount) {
      throw new HttpError(404, "La unificación no existe");
    }
    return { id };
  }

  const resultado = await sqliteRun("DELETE FROM producto_alias WHERE id = ?", [id]);
  if (!resultado.changes) {
    throw new HttpError(404, "La unificación no existe");
  }
  return { id };
}

module.exports = {
  listAliases,
  buildResolver,
  createAlias,
  detectarConflictoDeUnidades,
  unidadesPorClave,
  deleteAlias,
  listNombresPersonalizados,
  setNombrePersonalizado,
  deleteNombrePersonalizado,
};
