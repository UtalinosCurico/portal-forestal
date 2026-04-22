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

test("createSolicitud y createSolicitudItem reutilizan la misma operacion cuando llega duplicada", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-fmn-idempotency-"));
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
  const { get } = require("../db/database");
  const solicitudesService = require("../services/solicitudesService");

  await initDatabase();

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

  assert.ok(actor, "Debe existir un usuario admin para la prueba");
  assert.ok(equipo, "Debe existir al menos un equipo");

  const solicitudPayload = {
    equipo_id: Number(equipo.id),
    comentario: "Prueba de idempotencia",
    client_request_id: "solicitud-idempotente-001",
    items: [
      {
        nombre_item: "Bidon de agua",
        cantidad: 2,
        detalle: "Solicitud de prueba",
      },
    ],
  };

  const firstSolicitud = await solicitudesService.createSolicitud(actor, solicitudPayload);
  const secondSolicitud = await solicitudesService.createSolicitud(actor, solicitudPayload);

  assert.equal(firstSolicitud.id, secondSolicitud.id);

  const storedSolicitud = await get(
    "SELECT COUNT(*) AS total FROM solicitudes WHERE client_request_id = ?",
    [solicitudPayload.client_request_id]
  );
  assert.equal(Number(storedSolicitud.total), 1);

  const itemPayload = {
    nombre_item: "Cadena",
    cantidad: 1,
    comentario: "Agregar una sola vez",
    client_request_id: "solicitud-item-idempotente-001",
  };

  const firstItemResult = await solicitudesService.createSolicitudItem(actor, firstSolicitud.id, itemPayload);
  const secondItemResult = await solicitudesService.createSolicitudItem(actor, firstSolicitud.id, itemPayload);

  assert.equal(firstItemResult.item.id, secondItemResult.item.id);

  const storedItem = await get(
    "SELECT COUNT(*) AS total FROM solicitud_items WHERE client_request_id = ?",
    [itemPayload.client_request_id]
  );
  assert.equal(Number(storedItem.total), 1);
});
