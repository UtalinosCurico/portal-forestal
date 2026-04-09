const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/portal_forestal";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret";

const authService = require("../services/auth.service");

test("hashToken genera salida determinística", () => {
  const token = "sample-token";
  const hash1 = authService.__private.hashToken(token);
  const hash2 = authService.__private.hashToken(token);
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64);
});

test("signAccessToken y signRefreshToken retornan JWT", () => {
  const fakeUser = { id: 1, role_name: "Administrador", faena_id: 1 };
  const access = authService.__private.signAccessToken(fakeUser);
  const refresh = authService.__private.signRefreshToken(fakeUser);

  assert.equal(typeof access, "string");
  assert.equal(typeof refresh, "string");
  assert.ok(access.split(".").length === 3);
  assert.ok(refresh.split(".").length === 3);
});
