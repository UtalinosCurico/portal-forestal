const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function clearModule(modulePath) {
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch {
    // Ignorar si no estaba cargado.
  }
}

async function setupSqliteScenario() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-fmn-notifications-"));
  const sqlitePath = path.join(tempDir, "portal-fmn-test.db");

  process.env.SQLITE_PATH = sqlitePath;
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.OPERATIONAL_DATABASE_URL;

  [
    "../db/database",
    "../database/db",
    "../database/init",
    "../services/notificacionesService",
    "../services/notificacionesPgService",
    "../services/pushService",
    "../services/solicitudesPgService",
    "../services/operationalPgStore",
    "../services/userStore",
    "../services/solicitudesService",
  ].forEach(clearModule);

  const { initDatabase } = require("../database/init");
  const { all, get, run } = require("../db/database");
  const solicitudesService = require("../services/solicitudesService");

  await initDatabase();

  return { all, get, run, solicitudesService };
}

async function getUserByRole(get, role) {
  return get(
    `
      SELECT id, nombre, email, rol, equipo_id
      FROM usuarios
      WHERE rol = ?
      ORDER BY id ASC
      LIMIT 1
    `,
    [role]
  );
}

async function listNotificationTargets(all, tipo) {
  const rows = await all(
    `
      SELECT tipo, rol_destino, usuario_destino_id
      FROM notificaciones
      WHERE tipo = ?
      ORDER BY id ASC
    `,
    [tipo]
  );

  return rows.map((row) =>
    row.usuario_destino_id ? `user:${Number(row.usuario_destino_id)}` : String(row.rol_destino || "")
  );
}

test("crear solicitud y agregar producto desde faena notifican a admin y supervisor", async () => {
  const { all, get, run, solicitudesService } = await setupSqliteScenario();
  const jefe = await getUserByRole(get, "JEFE_FAENA");

  assert.ok(jefe, "Debe existir un jefe de faena para la prueba");

  const solicitud = await solicitudesService.createSolicitud(jefe, {
    client_request_id: "notif-routing-create-001",
    comentario: "Solicitud de prueba",
    items: [{ nombre_item: "Casco", cantidad: 1 }],
  });

  assert.deepEqual(
    await listNotificationTargets(all, "SOLICITUD_NUEVA"),
    ["ADMIN", "SUPERVISOR"]
  );

  await run("DELETE FROM notificaciones");

  await solicitudesService.createSolicitudItem(jefe, solicitud.id, {
    nombre_item: "Guantes",
    cantidad: 2,
    client_request_id: "notif-routing-item-001",
  });

  assert.deepEqual(
    await listNotificationTargets(all, "SOLICITUD_ITEM"),
    ["ADMIN", "SUPERVISOR"]
  );
});

test("cuando gestion cambia el estado, la notificacion va directo al solicitante", async () => {
  const { all, get, run, solicitudesService } = await setupSqliteScenario();
  const admin = await getUserByRole(get, "ADMIN");
  const jefe = await getUserByRole(get, "JEFE_FAENA");

  assert.ok(admin, "Debe existir un admin para la prueba");
  assert.ok(jefe, "Debe existir un jefe de faena para la prueba");

  const solicitud = await solicitudesService.createSolicitud(jefe, {
    client_request_id: "notif-routing-status-001",
    items: [{ nombre_item: "Radio", cantidad: 1 }],
  });

  await run("DELETE FROM notificaciones");

  await solicitudesService.updateSolicitud(admin, solicitud.id, { estado: "EN_REVISION" });

  assert.deepEqual(
    await listNotificationTargets(all, "SOLICITUD_ESTADO"),
    [`user:${Number(jefe.id)}`]
  );
});

test("cuando faena confirma recepcion, la notificacion vuelve a admin y supervisor", async () => {
  const { all, get, run, solicitudesService } = await setupSqliteScenario();
  const admin = await getUserByRole(get, "ADMIN");
  const jefe = await getUserByRole(get, "JEFE_FAENA");

  assert.ok(admin, "Debe existir un admin para la prueba");
  assert.ok(jefe, "Debe existir un jefe de faena para la prueba");

  const solicitud = await solicitudesService.createSolicitud(jefe, {
    client_request_id: "notif-routing-recepcion-001",
    items: [{ nombre_item: "Botas", cantidad: 1 }],
  });

  await run("DELETE FROM notificaciones");

  await solicitudesService.updateSolicitudItem(admin, solicitud.id, solicitud.items[0].id, {
    estado_item: "ENVIADO",
  });

  await run("DELETE FROM notificaciones");

  await solicitudesService.updateSolicitud(jefe, solicitud.id, { estado: "ENTREGADO" });

  assert.deepEqual(
    await listNotificationTargets(all, "SOLICITUD_ESTADO"),
    ["ADMIN", "SUPERVISOR"]
  );
});
