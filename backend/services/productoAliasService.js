// Equivalencias de producto declaradas por un ADMIN.
//
// La normalizacion automatica (productoKey.js) solo une lo que es con certeza el
// mismo texto. Todo lo demas -abreviaturas, nombres propios de faena, errores
// arraigados- necesita que una persona diga "esto y esto son lo mismo". Aca eso
// queda guardado, asi la decision se toma una vez y vale para siempre.

const { all: sqliteAll, get: sqliteGet, run: sqliteRun } = require("../db/database");
const { isOperationalPgEnabled, getOperationalPool } = require("./operationalPgStore");
const { buildProductoKey } = require("../utils/productoKey");
const { HttpError } = require("../utils/httpError");

// Corta cadenas circulares por si un dato quedara inconsistente.
const MAX_SALTOS = 10;

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
    throw new HttpError(400, "Esa unificacion crearia una referencia circular");
  }

  const existente = await findAliasByVariante(variante);
  if (existente) {
    throw new HttpError(
      409,
      "Ese producto ya esta unificado con otro. Deshace la unificacion actual antes de cambiarla"
    );
  }

  const actorId = Number(actor?.id) || null;
  const actorNombre = actor?.nombre || actor?.name || "Admin";

  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rows } = await pg.query(
      `INSERT INTO producto_alias
         (clave_variante, clave_canonica, nombre_canonico, creado_por_id, creado_por_nombre)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [variante, canonica, nombreCanonico, actorId, actorNombre]
    );
    return rows[0];
  }

  const resultado = await sqliteRun(
    `INSERT INTO producto_alias
       (clave_variante, clave_canonica, nombre_canonico, creado_por_id, creado_por_nombre)
     VALUES (?, ?, ?, ?, ?)`,
    [variante, canonica, nombreCanonico, actorId, actorNombre]
  );

  return {
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
      throw new HttpError(404, "La unificacion no existe");
    }
    return { id };
  }

  const resultado = await sqliteRun("DELETE FROM producto_alias WHERE id = ?", [id]);
  if (!resultado.changes) {
    throw new HttpError(404, "La unificacion no existe");
  }
  return { id };
}

module.exports = {
  listAliases,
  buildResolver,
  createAlias,
  deleteAlias,
  listNombresPersonalizados,
  setNombrePersonalizado,
  deleteNombrePersonalizado,
};
