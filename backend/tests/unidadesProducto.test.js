// Unir dos productos que se miden distinto (100 "unidades" de agua potable y
// 60 "litros" de agua) daba un total de 160 bajo la unidad mas frecuente. El
// numero se veia redondo y confiable, y no significaba nada.
//
// Estos tests cubren las dos mitades del arreglo: avisar ANTES de unir, y
// desglosar DESPUES en vez de esconder la mezcla bajo un solo total.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function clearModule(modulePath) {
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch {
    // No estaba cargado.
  }
}

async function escenarioLimpio() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-fmn-unidades-"));
  process.env.SQLITE_PATH = path.join(tempDir, "portal-fmn-test.db");
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.POSTGRES_PRISMA_URL;
  delete process.env.OPERATIONAL_DATABASE_URL;

  [
    "../db/database",
    "../database/db",
    "../database/init",
    "../services/operationalPgStore",
    "../services/productoAliasService",
    "../services/solicitudesService",
    "../services/consumoService",
    "../services/userStore",
    "../services/notificacionesService",
    "../services/notificacionesPgService",
    "../services/pushService",
    "../services/solicitudesPgService",
  ].forEach(clearModule);

  const { initDatabase } = require("../database/init");
  const { get } = require("../db/database");
  const solicitudesService = require("../services/solicitudesService");
  const productoAliasService = require("../services/productoAliasService");
  const consumoService = require("../services/consumoService");

  await initDatabase();
  const admin = await get("SELECT id, nombre, rol, equipo_id FROM usuarios WHERE rol = 'ADMIN'");
  const jefe = await get("SELECT id, nombre, rol, equipo_id FROM usuarios WHERE rol = 'JEFE_FAENA'");

  return { admin, jefe, solicitudesService, productoAliasService, consumoService };
}

test("avisa antes de unir dos productos que se miden distinto", async () => {
  const { admin, jefe, solicitudesService, productoAliasService } = await escenarioLimpio();

  await solicitudesService.createSolicitud(jefe, {
    client_request_id: "unidades-001",
    items: [
      { nombre_item: "Agua potable", cantidad: 100, unidad_medida: "unidades" },
      { nombre_item: "Agua", cantidad: 60, unidad_medida: "litros" },
    ],
  });

  const resultado = await productoAliasService.createAlias(admin, {
    claveVariante: "agua",
    claveCanonica: "agua potable",
  });

  assert.ok(resultado.aviso_unidades, "unir litros con unidades tiene que avisar");
  assert.deepEqual(resultado.aviso_unidades.unidades.sort(), ["lt", "unidad"]);
  assert.match(resultado.aviso_unidades.mensaje, /no usan la misma unidad/);
});

test("no molesta cuando las dos formas usan la misma unidad", async () => {
  const { admin, jefe, solicitudesService, productoAliasService } = await escenarioLimpio();

  await solicitudesService.createSolicitud(jefe, {
    client_request_id: "unidades-002",
    items: [
      { nombre_item: "Guantes cuero", cantidad: 10, unidad_medida: "pares" },
      { nombre_item: "Guantes de cuero", cantidad: 8, unidad_medida: "par" },
    ],
  });

  const resultado = await productoAliasService.createAlias(admin, {
    claveVariante: "guantes cuero",
    claveCanonica: "guantes de cuero",
  });

  assert.equal(
    resultado.aviso_unidades,
    null,
    "'pares' y 'par' son la misma unidad: avisar aca seria ruido"
  );
});

test("el reporte desglosa las unidades en vez de sumar peras con manzanas", async () => {
  const { admin, jefe, solicitudesService, productoAliasService, consumoService } =
    await escenarioLimpio();

  await solicitudesService.createSolicitud(jefe, {
    client_request_id: "unidades-003",
    items: [
      { nombre_item: "Agua potable", cantidad: 100, unidad_medida: "unidades" },
      { nombre_item: "Agua", cantidad: 60, unidad_medida: "litros" },
    ],
  });

  await productoAliasService.createAlias(admin, {
    claveVariante: "agua",
    claveCanonica: "agua potable",
  });

  const reporte = await consumoService.getConsumo(admin, { agrupacion: "mes" });
  const agua = reporte.productos.find((p) => /agua/i.test(p.nombre));

  assert.ok(agua, "el producto unificado debe aparecer una sola vez");
  assert.equal(agua.unidad_en_conflicto, true, "hay que marcar que las unidades no calzan");

  const porUnidad = Object.fromEntries(agua.desglose_unidades.map((d) => [d.unidad, d.total]));
  assert.equal(porUnidad.unidad, 100);
  assert.equal(porUnidad.lt, 60);
});

test("un producto con una sola unidad no se marca como conflicto", async () => {
  const { admin, jefe, solicitudesService, consumoService } = await escenarioLimpio();

  await solicitudesService.createSolicitud(jefe, {
    client_request_id: "unidades-004",
    items: [{ nombre_item: "Casco", cantidad: 5, unidad_medida: "unidades" }],
  });

  const reporte = await consumoService.getConsumo(admin, { agrupacion: "mes" });
  const casco = reporte.productos.find((p) => /casco/i.test(p.nombre));

  assert.equal(casco.unidad_en_conflicto, false);
  assert.equal(casco.total_unidades, 5);
});

test("los pedidos sin unidad escrita no cuentan como conflicto", async () => {
  const { admin, jefe, solicitudesService, consumoService } = await escenarioLimpio();

  await solicitudesService.createSolicitud(jefe, {
    client_request_id: "unidades-005",
    items: [
      { nombre_item: "Cadena", cantidad: 3, unidad_medida: "unidades" },
      { nombre_item: "Cadena", cantidad: 2 },
    ],
  });

  const reporte = await consumoService.getConsumo(admin, { agrupacion: "mes" });
  const cadena = reporte.productos.find((p) => /cadena/i.test(p.nombre));

  assert.equal(
    cadena.unidad_en_conflicto,
    false,
    "una linea sin unidad es un dato sin etiquetar, no una unidad distinta"
  );
});
