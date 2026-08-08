const { all, run } = require("../db/database");
const { isGlobalRole } = require("../middleware/roles");
const { HttpError } = require("../utils/httpError");
const {
  DEFAULT_EMPRESA,
  EMPRESA_IDS,
  getEmpresa,
  listEmpresasCatalogo,
  normalizeEmpresa,
  empresaParaNombreEquipo,
} = require("../config/empresas");

// La tabla `equipos` tiene cuatro filas y casi nunca cambia, pero el filtro por
// empresa se arma dentro de funciones sincronicas (buildWhereClause/buildScope).
// Por eso se cachea en memoria: se carga una vez al arrancar (initDatabase la
// llama) y se recarga cuando alguien crea o edita un equipo.
let cache = null;
let loadPromise = null;

function buildCache(rows) {
  const porEquipo = new Map();
  const equiposPorEmpresa = new Map(EMPRESA_IDS.map((id) => [id, []]));
  const equipos = [];

  for (const row of rows) {
    const equipoId = Number(row.id);
    const empresa = normalizeEmpresa(row.empresa) || empresaParaNombreEquipo(row.nombre_equipo);
    porEquipo.set(equipoId, empresa);
    equiposPorEmpresa.get(empresa).push(equipoId);
    equipos.push({ id: equipoId, nombre_equipo: row.nombre_equipo, empresa });
  }

  return { porEquipo, equiposPorEmpresa, equipos };
}

async function reload() {
  const rows = await all("SELECT id, nombre_equipo, empresa FROM equipos ORDER BY nombre_equipo ASC");
  cache = buildCache(rows);
  return cache;
}

async function ensureLoaded() {
  if (cache) {
    return cache;
  }

  if (!loadPromise) {
    loadPromise = reload().finally(() => {
      loadPromise = null;
    });
  }

  return loadPromise;
}

function invalidate() {
  cache = null;
}

function getCache() {
  if (!cache) {
    // No deberia pasar: initDatabase carga el cache antes de atender requests.
    // Si pasa, es preferible fallar que devolver datos de la otra empresa.
    throw new HttpError(503, "El catalogo de empresas todavia no esta disponible");
  }
  return cache;
}

function isLoaded() {
  return Boolean(cache);
}

function getEquipoIdsByEmpresa(empresaId) {
  const empresa = normalizeEmpresa(empresaId);
  if (!empresa) {
    return [];
  }
  return [...(getCache().equiposPorEmpresa.get(empresa) || [])];
}

function getEmpresaByEquipoId(equipoId) {
  const id = Number(equipoId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return getCache().porEquipo.get(id) || DEFAULT_EMPRESA;
}

function getEmpresaDelActor(actor) {
  if (!actor || !actor.equipo_id) {
    return null;
  }
  return getEmpresaByEquipoId(actor.equipo_id);
}

/**
 * Empresa por la que hay que filtrar en esta consulta, o null si no aplica.
 *
 * Solo tiene efecto para ADMIN/SUPERVISOR: el resto ya viene acotado a su
 * propio equipo, y ese equipo define su empresa sin que el cliente opine.
 */
function resolveEmpresaFilter(actor, filters = {}) {
  if (!isGlobalRole(actor?.rol || actor?.role)) {
    return null;
  }

  const raw = filters.empresa ?? filters.empresaId ?? filters.empresa_id;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }

  const normalized = normalizeEmpresa(raw);
  if (!normalized) {
    throw new HttpError(400, "empresa invalida");
  }
  return normalized;
}

/**
 * Ids de equipo por los que hay que filtrar, o null si la consulta no se
 * acota por empresa. Un arreglo vacio significa "esta empresa no tiene
 * equipos": la consulta debe devolver nada, no todo.
 */
function resolveEmpresaEquipoIds(actor, filters = {}) {
  const empresa = resolveEmpresaFilter(actor, filters);
  return empresa ? getEquipoIdsByEmpresa(empresa) : null;
}

/**
 * Agrega a `conditions` el recorte por empresa, si la consulta lo pide.
 *
 * `push(valor)` registra el parametro y devuelve su marcador, que cambia segun
 * el motor ("?" en SQLite, "$n" en Postgres). Con `incluirSinEquipo` las filas
 * sin equipo (avisos generales) siguen apareciendo en ambas empresas.
 *
 * Las dos empresas juntas tienen que sumar el total: si una solicitud vieja
 * quedo sin equipo, o con un equipo que ya no existe, no puede desaparecer de
 * las dos vistas a la vez. Por eso la empresa por defecto se define por
 * descarte -"todo lo que no sea de la otra"- y no por lista de equipos.
 */
function pushEmpresaCondition(conditions, options = {}) {
  const {
    actor,
    filters = {},
    alias = "s",
    campo = "equipo_id",
    push,
    incluirSinEquipo = false,
  } = options;

  const empresa = resolveEmpresaFilter(actor, filters);
  if (!empresa) {
    return null;
  }

  const columna = `${alias}.${campo}`;

  if (empresa === DEFAULT_EMPRESA) {
    const equiposAjenos = EMPRESA_IDS.filter((id) => id !== DEFAULT_EMPRESA).flatMap((id) =>
      getEquipoIdsByEmpresa(id)
    );

    if (!equiposAjenos.length) {
      return getEquipoIdsByEmpresa(empresa);
    }

    const lista = equiposAjenos.map((id) => push(id)).join(", ");
    conditions.push(`(${columna} IS NULL OR ${columna} NOT IN (${lista}))`);
    return getEquipoIdsByEmpresa(empresa);
  }

  const equipoIds = getEquipoIdsByEmpresa(empresa);
  if (!equipoIds.length) {
    conditions.push(incluirSinEquipo ? `${columna} IS NULL` : "1 = 0");
    return equipoIds;
  }

  const lista = equipoIds.map((id) => push(id)).join(", ");
  conditions.push(
    incluirSinEquipo
      ? `(${columna} IS NULL OR ${columna} IN (${lista}))`
      : `${columna} IN (${lista})`
  );
  return equipoIds;
}

async function listEmpresas() {
  const { equipos } = await ensureLoaded();
  return listEmpresasCatalogo().map((empresa) => ({
    ...empresa,
    equipos: equipos
      .filter((equipo) => equipo.empresa === empresa.id)
      .map((equipo) => ({ id: equipo.id, nombre_equipo: equipo.nombre_equipo })),
  }));
}

async function setEmpresaDeEquipo(equipoId, empresaId) {
  const empresa = normalizeEmpresa(empresaId);
  if (!empresa) {
    throw new HttpError(400, "empresa invalida");
  }

  await run("UPDATE equipos SET empresa = ? WHERE id = ?", [empresa, Number(equipoId)]);
  await reload();
  return empresa;
}

module.exports = {
  DEFAULT_EMPRESA,
  ensureLoaded,
  reload,
  invalidate,
  isLoaded,
  getEmpresa,
  getEquipoIdsByEmpresa,
  getEmpresaByEquipoId,
  getEmpresaDelActor,
  resolveEmpresaFilter,
  resolveEmpresaEquipoIds,
  pushEmpresaCondition,
  listEmpresas,
  setEmpresaDeEquipo,
};
