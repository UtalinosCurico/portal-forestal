const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSolicitudTimeline } = require("../services/audit.service");

test("buildSolicitudTimeline mapea historial de forma consistente", () => {
  const timeline = buildSolicitudTimeline([
    {
      id: 10,
      accion: "creada",
      estado_anterior: null,
      estado_nuevo: "pendiente",
      comentario: "Creada",
      actor_nombre: "Operador 1",
      created_at: "2026-03-11T10:00:00.000Z",
    },
  ]);

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].estadoNuevo, "pendiente");
  assert.equal(timeline[0].actor, "Operador 1");
});

