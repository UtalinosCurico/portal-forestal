const test = require("node:test");
const assert = require("node:assert/strict");

// Testa el middleware de produccion (middleware/authorize.js)
const { authorize } = require("../middleware/authorize");

test("authorize permite acceso cuando el rol esta permitido", () => {
  const middleware = authorize("ADMIN", "SUPERVISOR");
  const req = { user: { rol: "SUPERVISOR" } };

  let called = false;
  middleware(req, {}, (error) => {
    assert.equal(error, undefined);
    called = true;
  });

  assert.equal(called, true);
});

test("authorize bloquea acceso cuando el rol no esta permitido", () => {
  const middleware = authorize("ADMIN");
  const req = { user: { rol: "OPERADOR" } };

  let receivedError = null;
  middleware(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.statusCode, 403);
});

test("authorize bloquea cuando no hay usuario autenticado", () => {
  const middleware = authorize("ADMIN");
  const req = {};

  let receivedError = null;
  middleware(req, {}, (error) => {
    receivedError = error;
  });

  assert.ok(receivedError);
  assert.equal(receivedError.statusCode, 401);
});

test("authorize permite todos los roles globales listados", () => {
  const globalRoles = ["ADMIN", "SUPERVISOR"];
  for (const rol of globalRoles) {
    const middleware = authorize("ADMIN", "SUPERVISOR");
    const req = { user: { rol } };
    let called = false;
    middleware(req, {}, (error) => {
      assert.equal(error, undefined, `Rol ${rol} deberia tener acceso`);
      called = true;
    });
    assert.equal(called, true);
  }
});

test("authorize bloquea roles operativos en endpoints de gestion", () => {
  const operationalRoles = ["JEFE_FAENA", "MECANICO", "OPERADOR"];
  for (const rol of operationalRoles) {
    const middleware = authorize("ADMIN", "SUPERVISOR");
    const req = { user: { rol } };
    let receivedError = null;
    middleware(req, {}, (error) => {
      receivedError = error;
    });
    assert.ok(receivedError, `Rol ${rol} deberia ser bloqueado`);
    assert.equal(receivedError.statusCode, 403);
  }
});
