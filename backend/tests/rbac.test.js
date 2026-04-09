const test = require("node:test");
const assert = require("node:assert/strict");

const { authorize } = require("../middleware/rbac.middleware");

test("authorize permite acceso cuando el rol está permitido", () => {
  const middleware = authorize("Administrador", "Supervisor");
  const req = { user: { role: "Supervisor" } };

  let called = false;
  middleware(req, {}, (error) => {
    assert.equal(error, undefined);
    called = true;
  });

  assert.equal(called, true);
});

test("authorize bloquea acceso cuando el rol no está permitido", () => {
  const middleware = authorize("Administrador");
  const req = { user: { role: "Operador" } };

  let receivedError = null;
  middleware(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.statusCode, 403);
});

