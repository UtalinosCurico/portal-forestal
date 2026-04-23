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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-fmn-no-aplica-"));
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
  const { get } = require("../db/database");
  const solicitudesService = require("../services/solicitudesService");

  await initDatabase();

  return { get, solicitudesService };
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

test("NO_APLICA conserva el registro y no se pisa al entregar la solicitud completa", async () => {
  const { get, solicitudesService } = await setupSqliteScenario();
  const admin = await getUserByRole(get, "ADMIN");
  const jefe = await getUserByRole(get, "JEFE_FAENA");

  assert.ok(admin, "Debe existir un admin para la prueba");
  assert.ok(jefe, "Debe existir un jefe de faena para la prueba");

  const solicitud = await solicitudesService.createSolicitud(jefe, {
    client_request_id: "no-aplica-flow-001",
    comentario: "Una parte se resolvio en faena",
    items: [
      { nombre_item: "Polera", cantidad: 1, comentario: "Se encontro en faena" },
      { nombre_item: "Botas", cantidad: 1, comentario: "Debe enviarse" },
    ],
  });

  const [itemResuelto, itemDespacho] = solicitud.items;

  await solicitudesService.updateSolicitudItem(admin, solicitud.id, itemResuelto.id, {
    estado_item: "NO_APLICA",
    comentario_gestion: "Ya estaba disponible en faena; no se despacha",
  });

  const pendientesTrasResolver = await solicitudesService.listPendingItems(admin);
  assert.equal(
    pendientesTrasResolver.some((item) => Number(item.item_id) === Number(itemResuelto.id)),
    false
  );

  await solicitudesService.updateSolicitudItem(admin, solicitud.id, itemDespacho.id, {
    estado_item: "ENVIADO",
  });

  const confirmada = await solicitudesService.updateSolicitud(jefe, solicitud.id, {
    estado: "ENTREGADO",
  });

  const itemResueltoFinal = confirmada.items.find((item) => Number(item.id) === Number(itemResuelto.id));
  const itemDespachoFinal = confirmada.items.find((item) => Number(item.id) === Number(itemDespacho.id));

  assert.equal(confirmada.estado, "ENTREGADO");
  assert.equal(itemResueltoFinal?.estado_item, "NO_APLICA");
  assert.equal(itemDespachoFinal?.estado_item, "ENTREGADO");
});
