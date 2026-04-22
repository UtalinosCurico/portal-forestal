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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-fmn-pending-reuse-"));
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
    "../services/solicitudesPgService",
    "../services/operationalPgStore",
    "../services/userStore",
    "../services/solicitudesService",
  ].forEach(clearModule);

  const { initDatabase } = require("../database/init");
  const { all, get } = require("../db/database");
  const solicitudesService = require("../services/solicitudesService");

  await initDatabase();

  return { all, get, solicitudesService };
}

test("createSolicitud reutiliza una pendiente existente del mismo usuario y agrega solo los items nuevos", async () => {
  const { all, get, solicitudesService } = await setupSqliteScenario();

  const actor = await get(
    `
      SELECT id, nombre, email, rol, equipo_id
      FROM usuarios
      WHERE rol = 'ADMIN'
      ORDER BY id ASC
      LIMIT 1
    `
  );
  const equipo = await get("SELECT id FROM equipos ORDER BY id ASC LIMIT 1");

  const firstSolicitud = await solicitudesService.createSolicitud(actor, {
    equipo_id: Number(equipo.id),
    comentario: "Solicitud inicial",
    client_request_id: "pending-reuse-001",
    items: [
      { nombre_item: "Botas", cantidad: 1, unidad_medida: "par" },
      { nombre_item: "Guantes", cantidad: 2, unidad_medida: "par" },
    ],
  });

  const secondSolicitud = await solicitudesService.createSolicitud(actor, {
    equipo_id: Number(equipo.id),
    comentario: "Agregar casco",
    client_request_id: "pending-reuse-002",
    items: [
      { nombre_item: "Botas", cantidad: 1, unidad_medida: "par" },
      { nombre_item: "Guantes", cantidad: 2, unidad_medida: "par" },
      { nombre_item: "Casco", cantidad: 1, unidad_medida: "unidad" },
    ],
  });

  assert.equal(secondSolicitud.id, firstSolicitud.id);
  assert.equal(secondSolicitud.meta?.action, "merged_into_pending");
  assert.equal(secondSolicitud.meta?.addedItems, 1);
  assert.equal(secondSolicitud.meta?.skippedItems, 2);

  const storedSolicitudes = await get(
    "SELECT COUNT(*) AS total FROM solicitudes WHERE solicitante_id = ? AND equipo_id = ?",
    [Number(actor.id), Number(equipo.id)]
  );
  assert.equal(Number(storedSolicitudes.total), 1);

  const storedItems = await all(
    `
      SELECT nombre_item, cantidad, unidad_medida
      FROM solicitud_items
      WHERE solicitud_id = ?
      ORDER BY id ASC
    `,
    [Number(firstSolicitud.id)]
  );

  assert.deepEqual(
    storedItems.map((row) => `${row.nombre_item}:${row.cantidad}:${row.unidad_medida || ""}`),
    ["Botas:1:par", "Guantes:2:par", "Casco:1:unidad"]
  );

  const refreshedSolicitud = await get(
    "SELECT comentario FROM solicitudes WHERE id = ?",
    [Number(firstSolicitud.id)]
  );
  assert.match(refreshedSolicitud.comentario || "", /Solicitud inicial/);
  assert.match(refreshedSolicitud.comentario || "", /Agregar casco/);
});

test("createSolicitud no mezcla solicitudes pendientes entre usuarios distintos aunque usen el mismo equipo", async () => {
  const { get, solicitudesService } = await setupSqliteScenario();

  const admin = await get(
    `
      SELECT id, nombre, email, rol, equipo_id
      FROM usuarios
      WHERE rol = 'ADMIN'
      ORDER BY id ASC
      LIMIT 1
    `
  );
  const supervisor = await get(
    `
      SELECT id, nombre, email, rol, equipo_id
      FROM usuarios
      WHERE rol = 'SUPERVISOR'
      ORDER BY id ASC
      LIMIT 1
    `
  );
  const equipo = await get("SELECT id FROM equipos ORDER BY id ASC LIMIT 1");

  const firstSolicitud = await solicitudesService.createSolicitud(admin, {
    equipo_id: Number(equipo.id),
    client_request_id: "pending-separate-001",
    items: [{ nombre_item: "Linterna", cantidad: 1 }],
  });

  const secondSolicitud = await solicitudesService.createSolicitud(supervisor, {
    equipo_id: Number(equipo.id),
    client_request_id: "pending-separate-002",
    items: [{ nombre_item: "Linterna", cantidad: 1 }],
  });

  assert.notEqual(secondSolicitud.id, firstSolicitud.id);
});

test("createSolicitudItem reutiliza el item existente cuando ya estaba cargado en la solicitud pendiente", async () => {
  const { get, solicitudesService } = await setupSqliteScenario();

  const actor = await get(
    `
      SELECT id, nombre, email, rol, equipo_id
      FROM usuarios
      WHERE rol = 'ADMIN'
      ORDER BY id ASC
      LIMIT 1
    `
  );
  const equipo = await get("SELECT id FROM equipos ORDER BY id ASC LIMIT 1");

  const solicitud = await solicitudesService.createSolicitud(actor, {
    equipo_id: Number(equipo.id),
    client_request_id: "pending-item-001",
    items: [{ nombre_item: "Radio", cantidad: 1, unidad_medida: "unidad" }],
  });

  const duplicateResult = await solicitudesService.createSolicitudItem(actor, solicitud.id, {
    nombre_item: "Radio",
    cantidad: 1,
    unidad_medida: "unidad",
    client_request_id: "pending-item-duplicate-001",
  });

  assert.equal(duplicateResult.meta?.action, "existing_item_reused");
  assert.equal(Number(duplicateResult.item.id), Number(solicitud.items[0].id));

  const storedItems = await get(
    "SELECT COUNT(*) AS total FROM solicitud_items WHERE solicitud_id = ?",
    [Number(solicitud.id)]
  );
  assert.equal(Number(storedItems.total), 1);
});
