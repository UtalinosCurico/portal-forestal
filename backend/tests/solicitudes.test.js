const test = require("node:test");
const assert = require("node:assert/strict");

const { SOLICITUD_STATUS, canTransition } = require("../config/solicitudFlow");

test("flujo permite transicion pendiente -> aprobado", () => {
  assert.equal(canTransition(SOLICITUD_STATUS.PENDIENTE, SOLICITUD_STATUS.APROBADO), true);
});

test("flujo permite transicion pendiente -> en revision", () => {
  assert.equal(canTransition(SOLICITUD_STATUS.PENDIENTE, SOLICITUD_STATUS.EN_REVISION), true);
});

test("flujo bloquea transicion entregado -> pendiente", () => {
  assert.equal(canTransition(SOLICITUD_STATUS.ENTREGADO, SOLICITUD_STATUS.PENDIENTE), false);
});

test("flujo permite reapertura rechazado -> pendiente", () => {
  assert.equal(canTransition(SOLICITUD_STATUS.RECHAZADO, SOLICITUD_STATUS.PENDIENTE), true);
});

test("flujo bloquea pendiente -> entregado directo", () => {
  assert.equal(canTransition(SOLICITUD_STATUS.PENDIENTE, SOLICITUD_STATUS.ENTREGADO), false);
});
