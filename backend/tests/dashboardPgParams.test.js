// El dashboard de Postgres se cayo para las dos empresas porque la consulta de
// conteo metia los parametros del estado ANTES que los del scope, mientras que
// los marcadores ($1, $2...) del scope ya venian numerados desde 1. Mientras el
// scope estuvo vacio -un ADMIN sin filtros- nadie lo noto; al agregar el filtro
// por empresa el scope dejo de estar vacio y "$1" paso a apuntar al parametro
// equivocado.
//
// Estos tests miran la consulta armada, sin levantar un Postgres: cada $N tiene
// que existir en el arreglo de parametros y apuntar al valor correcto.

const test = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase } = require("../database/init");
const pgService = require("../services/dashboardPgService");
const empresasService = require("../services/empresasService");

const ADMIN = { id: 1, rol: "ADMIN", equipo_id: null };
const JEFE = { id: 3, rol: "JEFE_FAENA", equipo_id: 7 };

/** Numero de marcador mas alto que aparece en la consulta. */
function maxMarcador(sql) {
  const marcadores = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  return marcadores.length ? Math.max(...marcadores) : 0;
}

test.before(async () => {
  await initDatabase();
});

test("la consulta de conteo no deja marcadores sin parametro", () => {
  for (const filtros of [{}, { empresa: "MAULE_NORTE" }, { empresa: "FOREST_SAINT" }]) {
    const scope = pgService.buildScope(ADMIN, filtros, "s");
    const consulta = pgService.buildScopedCountQuery(
      scope,
      (i) => `s.estado = ANY($${i}::text[])`,
      [["PENDIENTE", "EN_REVISION"]]
    );

    assert.equal(
      maxMarcador(consulta.sql),
      consulta.params.length,
      `marcadores y parametros no calzan con ${JSON.stringify(filtros)}: ${consulta.sql}`
    );
  }
});

test("el filtro por empresa recibe el id del equipo, no el estado", () => {
  const equiposForest = empresasService.getEquipoIdsByEmpresa("FOREST_SAINT");
  assert.ok(equiposForest.length, "Forest Saint deberia tener al menos un equipo");

  const scope = pgService.buildScope(ADMIN, { empresa: "FOREST_SAINT" }, "s");
  const consulta = pgService.buildScopedCountQuery(scope, (i) => `s.estado = $${i}`, [
    "EN_DESPACHO",
  ]);

  // El scope va primero: sus marcadores arrancan en $1 y reciben ids de equipo.
  for (let i = 0; i < equiposForest.length; i += 1) {
    assert.equal(typeof consulta.params[i], "number", "el scope espera ids numericos");
  }
  // El estado queda al final, con el marcador que sigue.
  const marcadorEstado = equiposForest.length + 1;
  assert.match(consulta.sql, new RegExp(`s\\.estado = \\$${marcadorEstado}`));
  assert.equal(consulta.params.at(-1), "EN_DESPACHO");
});

test("Maule Norte se lleva tambien lo que no tiene equipo", () => {
  const scope = pgService.buildScope(ADMIN, { empresa: "MAULE_NORTE" }, "s");
  assert.match(scope.where, /s\.equipo_id IS NULL OR s\.equipo_id NOT IN/);
});

test("un rol de faena sigue acotado a su equipo y numera bien", () => {
  const scope = pgService.buildScope(JEFE, { empresa: "FOREST_SAINT" }, "s");
  const consulta = pgService.buildScopedCountQuery(scope, (i) => `s.estado = $${i}`, [
    "EN_DESPACHO",
  ]);

  assert.equal(maxMarcador(consulta.sql), consulta.params.length);
  assert.equal(consulta.params[0], 7, "el primer parametro es el equipo del actor");
});

test("sin filtro de empresa la consulta queda como antes", () => {
  const scope = pgService.buildScope(ADMIN, {}, "s");
  const consulta = pgService.buildScopedCountQuery(scope, (i) => `s.estado = $${i}`, [
    "EN_DESPACHO",
  ]);

  assert.equal(scope.where, "");
  assert.equal(consulta.params.length, 1);
  assert.match(consulta.sql, /WHERE s\.estado = \$1$/);
});
