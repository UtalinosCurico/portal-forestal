// Maule Norte y Forest Saint operan juntas pero son dos empresas distintas.
// Cada equipo pertenece a una sola, y de ahi cuelga todo lo demas: las
// solicitudes, el dashboard, los reportes y las alertas se leen por separado.
//
// La empresa vive en la columna `equipos.empresa`. Este archivo es el catalogo:
// que empresas existen, como se llaman y de que color se pintan.

const EMPRESAS = {
  MAULE_NORTE: {
    id: "MAULE_NORTE",
    nombre: "Maule Norte",
    descripcion: "Faenas Maule Norte",
    color: "#2d7a57",
    tema: "verde",
  },
  FOREST_SAINT: {
    id: "FOREST_SAINT",
    nombre: "Forest Saint",
    descripcion: "Faenas Forest Saint",
    color: "#7c4dbe",
    tema: "morado",
  },
};

const EMPRESA_IDS = Object.keys(EMPRESAS);

// Con que empresa nace un equipo que todavia no la tiene asignada. Todo lo que
// no este en esta lista queda en Maule Norte.
//
// IMPORTANTE: en Vercel el SQLite es efimero, asi que la tabla `equipos` se
// vuelve a sembrar en cada arranque en frio y esta lista es la que manda de
// verdad. Cuando Forest Saint sume una faena nueva hay que agregarla aqui
// (en minusculas), no solo crearla en el portal.
const DEFAULT_EMPRESA = EMPRESAS.MAULE_NORTE.id;
const EMPRESA_POR_NOMBRE_EQUIPO = {
  "forest saint": EMPRESAS.FOREST_SAINT.id,
};

function normalizeEmpresa(value) {
  const text = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  return EMPRESA_IDS.includes(text) ? text : null;
}

function empresaParaNombreEquipo(nombreEquipo) {
  const key = String(nombreEquipo ?? "").trim().toLowerCase();
  return EMPRESA_POR_NOMBRE_EQUIPO[key] || DEFAULT_EMPRESA;
}

function getEmpresa(empresaId) {
  const normalized = normalizeEmpresa(empresaId);
  return normalized ? EMPRESAS[normalized] : null;
}

function listEmpresasCatalogo() {
  return EMPRESA_IDS.map((id) => ({ ...EMPRESAS[id] }));
}

module.exports = {
  EMPRESAS,
  EMPRESA_IDS,
  DEFAULT_EMPRESA,
  normalizeEmpresa,
  empresaParaNombreEquipo,
  getEmpresa,
  listEmpresasCatalogo,
};
