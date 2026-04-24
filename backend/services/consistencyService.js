const { getOperationalPool } = require("./operationalPgStore");
const {
  deriveSolicitudStatusFromItemSummary,
  buildItemStatusSummary,
} = require("./solicitudesPgService");

// Escanea todas las solicitudes activas y corrige inconsistencias
// estado_solicitud vs estado real derivado de sus ítems.
async function repairSolicitudConsistency() {
  const pg = getOperationalPool();

  // Traer solicitudes activas con sus ítems
  const { rows: solicitudes } = await pg.query(`
    SELECT id, estado FROM solicitudes
    WHERE estado NOT IN ('ENTREGADO', 'RECHAZADO')
    ORDER BY id ASC
  `);

  if (!solicitudes.length) {
    return { checked: 0, repaired: 0, details: [] };
  }

  const ids = solicitudes.map((s) => s.id);
  const { rows: items } = await pg.query(
    `SELECT solicitud_id, estado_item FROM solicitud_items WHERE solicitud_id = ANY($1)`,
    [ids]
  );

  // Agrupar ítems por solicitud
  const itemsByS = new Map();
  for (const item of items) {
    const sid = Number(item.solicitud_id);
    if (!itemsByS.has(sid)) itemsByS.set(sid, []);
    itemsByS.get(sid).push(item);
  }

  const repaired = [];

  for (const sol of solicitudes) {
    const solItems = itemsByS.get(Number(sol.id)) || [];
    if (!solItems.length) continue;

    const summary = buildItemStatusSummary(solItems);
    const expected = deriveSolicitudStatusFromItemSummary(summary, sol.estado);

    if (expected !== sol.estado) {
      await pg.query(
        `UPDATE solicitudes SET estado = $1, updated_at = NOW() WHERE id = $2`,
        [expected, Number(sol.id)]
      );
      await pg.query(
        `INSERT INTO solicitud_historial
           (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
         VALUES ($1, 'ESTADO_AUTO_POR_PRODUCTOS', $2, $3, $4, NULL, 'Sistema')`,
        [
          Number(sol.id),
          sol.estado,
          expected,
          "Consistencia reparada automáticamente por discrepancia entre ítems y estado general",
        ]
      );
      repaired.push({ id: sol.id, from: sol.estado, to: expected });
    }
  }

  return {
    checked: solicitudes.length,
    repaired: repaired.length,
    details: repaired,
  };
}

// Verifica una sola solicitud y retorna si hay inconsistencia
async function checkSolicitudConsistency(solicitudId) {
  const pg = getOperationalPool();

  const { rows: [sol] } = await pg.query(
    `SELECT id, estado FROM solicitudes WHERE id = $1`,
    [Number(solicitudId)]
  );
  if (!sol) return null;

  const { rows: items } = await pg.query(
    `SELECT estado_item FROM solicitud_items WHERE solicitud_id = $1`,
    [Number(solicitudId)]
  );

  if (!items.length) return null;

  const summary = buildItemStatusSummary(items);
  const expected = deriveSolicitudStatusFromItemSummary(summary, sol.estado);

  return {
    solicitudId: sol.id,
    currentStatus: sol.estado,
    expectedStatus: expected,
    inconsistent: expected !== sol.estado,
  };
}

module.exports = { repairSolicitudConsistency, checkSolicitudConsistency };
