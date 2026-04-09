const test = require("node:test");
const assert = require("node:assert/strict");

const { STATUS, canTransition } = require("../config/status-flow");

test("flujo permite transicion pendiente -> en revision", () => {
  assert.equal(canTransition(STATUS.PENDIENTE, STATUS.EN_REVISION), true);
});

test("flujo permite transicion pendiente -> aprobado", () => {
  assert.equal(canTransition(STATUS.PENDIENTE, STATUS.APROBADO), true);
});

test("flujo permite transicion entregado -> pendiente", () => {
  assert.equal(canTransition(STATUS.ENTREGADO, STATUS.PENDIENTE), true);
});
