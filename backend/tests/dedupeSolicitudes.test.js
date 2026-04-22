const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_DUPLICATE_WINDOW_MS,
  findDuplicateGroups,
  parseArgs,
} = require("../scripts/dedupe-solicitudes");

test("findDuplicateGroups agrupa duplicados por ventana y elige el canonical con mas contexto", () => {
  const solicitudes = [
    {
      id: 10,
      solicitante_id: 1,
      equipo_id: 7,
      estado: "PENDIENTE",
      comentario: "Primera",
      created_at: "2026-04-22T12:00:00.000Z",
      updated_at: "2026-04-22T12:01:00.000Z",
    },
    {
      id: 11,
      solicitante_id: 1,
      equipo_id: 7,
      estado: "EN_REVISION",
      comentario: "Segunda",
      created_at: "2026-04-22T12:04:00.000Z",
      updated_at: "2026-04-22T12:06:00.000Z",
    },
    {
      id: 12,
      solicitante_id: 1,
      equipo_id: 7,
      estado: "PENDIENTE",
      comentario: "Fuera de ventana",
      created_at: "2026-04-22T12:30:00.000Z",
      updated_at: "2026-04-22T12:31:00.000Z",
    },
  ];

  const itemMap = new Map([
    [
      10,
      [
        {
          id: 101,
          solicitud_id: 10,
          nombre_item: "Bomba de agua",
          cantidad: 1,
          unidad_medida: "unidad",
          codigo_referencia: "A-1",
        },
      ],
    ],
    [
      11,
      [
        {
          id: 111,
          solicitud_id: 11,
          nombre_item: "Bomba de agua",
          cantidad: 1,
          unidad_medida: "unidad",
          codigo_referencia: "A-1",
        },
      ],
    ],
    [
      12,
      [
        {
          id: 121,
          solicitud_id: 12,
          nombre_item: "Bomba de agua",
          cantidad: 1,
          unidad_medida: "unidad",
          codigo_referencia: "A-1",
        },
      ],
    ],
  ]);

  const historyMap = new Map([
    [10, [{ id: 1001, solicitud_id: 10 }]],
    [11, [{ id: 1101, solicitud_id: 11 }, { id: 1102, solicitud_id: 11 }]],
  ]);
  const messageMap = new Map([[11, [{ id: 2101, solicitud_id: 11 }]]]);

  const groups = findDuplicateGroups(solicitudes, itemMap, historyMap, messageMap, {
    windowMs: DEFAULT_DUPLICATE_WINDOW_MS,
  });

  assert.equal(groups.length, 1);
  assert.equal(Number(groups[0].canonical.id), 11);
  assert.deepEqual(
    groups[0].duplicates.map((entry) => Number(entry.id)),
    [10]
  );
});

test("parseArgs soporta apply, env-file y window-minutes", () => {
  const parsed = parseArgs([
    "--apply",
    "--env-file",
    "C:\\tmp\\portal.env",
    "--window-minutes",
    "15",
  ]);

  assert.equal(parsed.apply, true);
  assert.equal(parsed.help, false);
  assert.match(parsed.envFile, /portal\.env$/);
  assert.equal(parsed.windowMs, 15 * 60 * 1000);
});
