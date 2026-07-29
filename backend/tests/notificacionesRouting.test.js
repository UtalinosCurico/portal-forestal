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

// Un trabajador arma su pedido agregando los productos de a uno. Antes eso
// generaba un aviso identico por producto y a la secretaria le llegaban todos
// juntos; deben quedar resumidos en uno solo por solicitud.
test("varios productos agregados a la misma solicitud dejan un solo aviso", async () => {
  const { all, get, run, solicitudesService } = await setupSqliteScenario();
  const jefe = await getUserByRole(get, "JEFE_FAENA");

  const solicitud = await solicitudesService.createSolicitud(jefe, {
    client_request_id: "notif-agrupa-create-001",
    comentario: "Pedido armado de a poco",
    items: [{ nombre_item: "Casco", cantidad: 1 }],
  });

  await run("DELETE FROM notificaciones");

  for (const [indice, nombre] of ["Guantes", "Botas", "Lentes", "Chaleco"].entries()) {
    await solicitudesService.createSolicitudItem(jefe, solicitud.id, {
      nombre_item: nombre,
      cantidad: 1,
      client_request_id: `notif-agrupa-item-00${indice}`,
    });
  }

  assert.deepEqual(
    await listNotificationTargets(all, "SOLICITUD_ITEM"),
    ["ADMIN", "SUPERVISOR"],
    "cuatro productos deben dejar un aviso por destinatario, no cuatro"
  );

  const aviso = await get(
    "SELECT mensaje, agrupadas FROM notificaciones WHERE tipo = 'SOLICITUD_ITEM' AND rol_destino = 'ADMIN'"
  );
  assert.equal(Number(aviso.agrupadas), 4, "el aviso debe contar los cuatro cambios");
  assert.match(aviso.mensaje, /4 cambios/, "el mensaje debe decir cuantos cambios resume");
});

test("dos solicitudes distintas conservan su propio aviso de productos", async () => {
  const { all, get, run, solicitudesService } = await setupSqliteScenario();
  const jefe = await getUserByRole(get, "JEFE_FAENA");

  const primera = await solicitudesService.createSolicitud(jefe, {
    client_request_id: "notif-agrupa-sol-a",
    items: [{ nombre_item: "Casco", cantidad: 1 }],
  });
  const segunda = await solicitudesService.createSolicitud(jefe, {
    client_request_id: "notif-agrupa-sol-b",
    items: [{ nombre_item: "Motosierra", cantidad: 1 }],
  });

  assert.notEqual(primera.id, segunda.id, "deben ser dos solicitudes distintas");

  await run("DELETE FROM notificaciones");

  await solicitudesService.createSolicitudItem(jefe, primera.id, {
    nombre_item: "Guantes",
    cantidad: 1,
    client_request_id: "notif-agrupa-item-a",
  });
  await solicitudesService.createSolicitudItem(jefe, segunda.id, {
    nombre_item: "Aceite",
    cantidad: 1,
    client_request_id: "notif-agrupa-item-b",
  });

  const referencias = await all(
    "SELECT DISTINCT referencia_id FROM notificaciones WHERE tipo = 'SOLICITUD_ITEM' ORDER BY referencia_id ASC"
  );
  assert.equal(referencias.length, 2, "agrupar no debe mezclar solicitudes distintas");
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
