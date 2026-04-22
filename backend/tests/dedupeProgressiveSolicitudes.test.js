const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PROGRESSIVE_WINDOW_MS,
  buildProgressiveChains,
  parseArgs,
  pickProgressiveCanonical,
} = require("../scripts/dedupe-progressive-solicitudes");

test("buildProgressiveChains detecta arrastre historico y conserva la solicitud mas completa", () => {
  const solicitudes = [
    {
      id: 31,
      solicitante_id: 5,
      equipo_id: 2,
      estado: "EN_DESPACHO",
      comentario: "Base",
      created_at: "2026-04-20T10:00:00.000Z",
      updated_at: "2026-04-20T10:10:00.000Z",
    },
    {
      id: 32,
      solicitante_id: 5,
      equipo_id: 2,
      estado: "PENDIENTE",
      comentario: "Se agrego otro item",
      created_at: "2026-04-20T13:00:00.000Z",
      updated_at: "2026-04-20T13:01:00.000Z",
    },
    {
      id: 33,
      solicitante_id: 5,
      equipo_id: 2,
      estado: "PENDIENTE",
      comentario: "Nueva ampliacion",
      created_at: "2026-04-21T09:00:00.000Z",
      updated_at: "2026-04-21T09:01:00.000Z",
    },
  ];

  const itemMap = new Map([
    [
      31,
      [
        { id: 311, solicitud_id: 31, nombre_item: "Polera", cantidad: 5, unidad_medida: "unidad" },
        { id: 312, solicitud_id: 31, nombre_item: "Casco", cantidad: 1, unidad_medida: "unidad" },
      ],
    ],
    [
      32,
      [
        { id: 321, solicitud_id: 32, nombre_item: "Polera", cantidad: 5, unidad_medida: "unidad" },
        { id: 322, solicitud_id: 32, nombre_item: "Casco", cantidad: 1, unidad_medida: "unidad" },
        { id: 323, solicitud_id: 32, nombre_item: "Guantes", cantidad: 2, unidad_medida: "par" },
      ],
    ],
    [
      33,
      [
        { id: 331, solicitud_id: 33, nombre_item: "Polera", cantidad: 5, unidad_medida: "unidad" },
        { id: 332, solicitud_id: 33, nombre_item: "Casco", cantidad: 1, unidad_medida: "unidad" },
        { id: 333, solicitud_id: 33, nombre_item: "Guantes", cantidad: 2, unidad_medida: "par" },
        { id: 334, solicitud_id: 33, nombre_item: "Zapato seguridad", cantidad: 1, unidad_medida: "par" },
      ],
    ],
  ]);

  const historyMap = new Map([[31, [{ id: 9001, solicitud_id: 31 }]]]);
  const messageMap = new Map([[31, [{ id: 9101, solicitud_id: 31 }]]]);

  const chains = buildProgressiveChains(solicitudes, itemMap, historyMap, messageMap, {
    windowMs: DEFAULT_PROGRESSIVE_WINDOW_MS,
  });

  assert.equal(chains.length, 1);
  assert.equal(Number(chains[0].canonical.id), 33);
  assert.deepEqual(
    chains[0].duplicates.map((entry) => Number(entry.id)),
    [31, 32]
  );
});

test("buildProgressiveChains no mezcla solicitudes de usuarios distintos aunque el equipo coincida", () => {
  const solicitudes = [
    {
      id: 40,
      solicitante_id: 7,
      equipo_id: 4,
      estado: "PENDIENTE",
      created_at: "2026-04-20T10:00:00.000Z",
      updated_at: "2026-04-20T10:00:00.000Z",
    },
    {
      id: 41,
      solicitante_id: 8,
      equipo_id: 4,
      estado: "PENDIENTE",
      created_at: "2026-04-20T11:00:00.000Z",
      updated_at: "2026-04-20T11:00:00.000Z",
    },
  ];

  const itemMap = new Map([
    [40, [{ id: 401, solicitud_id: 40, nombre_item: "Botas", cantidad: 1, unidad_medida: "par" }]],
    [
      41,
      [
        { id: 411, solicitud_id: 41, nombre_item: "Botas", cantidad: 1, unidad_medida: "par" },
        { id: 412, solicitud_id: 41, nombre_item: "Guantes", cantidad: 1, unidad_medida: "par" },
      ],
    ],
  ]);

  const chains = buildProgressiveChains(solicitudes, itemMap, new Map(), new Map(), {
    windowMs: DEFAULT_PROGRESSIVE_WINDOW_MS,
  });

  assert.equal(chains.length, 0);
});

test("pickProgressiveCanonical prioriza la solicitud mas completa y luego el progreso", () => {
  const canonical = pickProgressiveCanonical([
    {
      id: 50,
      estado: "EN_DESPACHO",
      looseSet: new Set(["a", "b"]),
      itemCount: 2,
      itemProgressScore: 8,
      messageCount: 1,
      historyCount: 1,
      updated_at: "2026-04-20T10:00:00.000Z",
      created_at: "2026-04-20T10:00:00.000Z",
    },
    {
      id: 51,
      estado: "PENDIENTE",
      looseSet: new Set(["a", "b", "c"]),
      itemCount: 3,
      itemProgressScore: 3,
      messageCount: 0,
      historyCount: 0,
      updated_at: "2026-04-20T12:00:00.000Z",
      created_at: "2026-04-20T12:00:00.000Z",
    },
  ]);

  assert.equal(Number(canonical.id), 51);
});

test("parseArgs soporta apply, env-file y window-hours", () => {
  const parsed = parseArgs([
    "--apply",
    "--env-file",
    "C:\\tmp\\portal.env",
    "--window-hours",
    "72",
  ]);

  assert.equal(parsed.apply, true);
  assert.equal(parsed.help, false);
  assert.match(parsed.envFile, /portal\.env$/);
  assert.equal(parsed.windowMs, 72 * 60 * 60 * 1000);
});
