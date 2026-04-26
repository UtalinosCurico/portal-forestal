const { all, get } = require("../db/database");
const { SOLICITUD_ITEM_STATUS } = require("../config/solicitudItemFlow");
const { isOperationalPgEnabled, getOperationalPool, loadEquiposMap } = require("./operationalPgStore");
const notificacionesService = require("./notificacionesService");

const STALE_DAYS = 5;
const JOB_INTERVAL_MS = 6 * 60 * 60 * 1000;
let jobStarted = false;
let jobRunning = false;

function toNotificationItemName(row) {
  return `#${row.item_id} ${row.nombre_item || "Producto sin nombre"}`;
}

async function wasRecentlyNotifiedSqlite(row) {
  const needle = `%#${row.item_id} %`;
  const existing = await get(
    `
      SELECT id
      FROM notificaciones
      WHERE tipo = 'SOLICITUD_ITEM'
        AND referencia_id = ?
        AND equipo_id = ?
        AND mensaje LIKE ?
        AND created_at >= datetime('now', '-24 hours')
      LIMIT 1
    `,
    [row.solicitud_id, row.equipo_id, needle]
  );
  return Boolean(existing);
}

async function wasRecentlyNotifiedPg(row) {
  const pg = getOperationalPool();
  const { rows } = await pg.query(
    `
      SELECT id
      FROM notificaciones
      WHERE tipo = 'SOLICITUD_ITEM'
        AND referencia_id = $1
        AND equipo_id = $2
        AND mensaje ILIKE $3
        AND created_at >= NOW() - INTERVAL '24 hours'
      LIMIT 1
    `,
    [Number(row.solicitud_id), Number(row.equipo_id), `%#${row.item_id} %`]
  );
  return Boolean(rows[0]);
}

async function findStaleItemsSqlite() {
  return all(
    `
      SELECT
        si.id AS item_id,
        si.solicitud_id,
        si.nombre_item,
        si.updated_at,
        s.equipo_id,
        COALESCE(e.nombre_equipo, s.equipo, 'Sin equipo') AS equipo_nombre,
        CAST((julianday('now') - julianday(COALESCE(si.updated_at, si.created_at, s.updated_at, s.created_at))) AS INTEGER) AS dias_sin_movimiento
      FROM solicitud_items si
      INNER JOIN solicitudes s ON s.id = si.solicitud_id
      LEFT JOIN equipos e ON e.id = s.equipo_id
      WHERE si.estado_item = ?
        AND s.estado NOT IN ('ENTREGADO', 'RECHAZADO')
        AND CAST((julianday('now') - julianday(COALESCE(si.updated_at, si.created_at, s.updated_at, s.created_at))) AS INTEGER) >= ?
      ORDER BY dias_sin_movimiento DESC, si.id ASC
      LIMIT 50
    `,
    [SOLICITUD_ITEM_STATUS.POR_GESTIONAR, STALE_DAYS]
  );
}

async function findStaleItemsPg() {
  const pg = getOperationalPool();
  const equiposMap = await loadEquiposMap();
  const { rows } = await pg.query(
    `
      SELECT
        si.id AS item_id,
        si.solicitud_id,
        si.nombre_item,
        si.updated_at,
        s.equipo_id,
        s.equipo,
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(si.updated_at, si.created_at, s.updated_at, s.created_at))) / 86400))::int AS dias_sin_movimiento
      FROM solicitud_items si
      INNER JOIN solicitudes s ON s.id = si.solicitud_id
      WHERE si.estado_item = $1
        AND s.estado NOT IN ('ENTREGADO', 'RECHAZADO')
        AND GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(si.updated_at, si.created_at, s.updated_at, s.created_at))) / 86400))::int >= $2
      ORDER BY dias_sin_movimiento DESC, si.id ASC
      LIMIT 50
    `,
    [SOLICITUD_ITEM_STATUS.POR_GESTIONAR, STALE_DAYS]
  );

  return rows.map((row) => ({
    ...row,
    item_id: Number(row.item_id),
    solicitud_id: Number(row.solicitud_id),
    equipo_id: row.equipo_id === null || row.equipo_id === undefined ? null : Number(row.equipo_id),
    equipo_nombre:
      row.equipo_id === null || row.equipo_id === undefined
        ? "Sin equipo"
        : equiposMap.get(Number(row.equipo_id)) || row.equipo || "Sin equipo",
    dias_sin_movimiento: Number(row.dias_sin_movimiento || 0),
  }));
}

async function notifyStaleItems() {
  if (jobRunning) {
    return { checked: 0, notified: 0, skipped: true };
  }

  jobRunning = true;
  try {
    const usePg = isOperationalPgEnabled();
    const staleItems = usePg ? await findStaleItemsPg() : await findStaleItemsSqlite();
    let notified = 0;

    for (const row of staleItems) {
      if (!row.equipo_id) {
        continue;
      }

      const recentlyNotified = usePg
        ? await wasRecentlyNotifiedPg(row)
        : await wasRecentlyNotifiedSqlite(row);
      if (recentlyNotified) {
        continue;
      }

      await notificacionesService.createSolicitudItemNotification({
        solicitudId: row.solicitud_id,
        equipoId: row.equipo_id,
        equipoNombre: row.equipo_nombre,
        itemNombre: toNotificationItemName(row),
        accion: `Atraso: lleva ${Number(row.dias_sin_movimiento || 0)} dias sin movimiento`,
        estadoItem: SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
      });
      notified += 1;
    }

    return { checked: staleItems.length, notified, skipped: false };
  } finally {
    jobRunning = false;
  }
}

function startStaleSolicitudesJob() {
  if (jobStarted) {
    return;
  }
  jobStarted = true;
  notifyStaleItems().catch(() => {});
  setInterval(() => {
    notifyStaleItems().catch(() => {});
  }, JOB_INTERVAL_MS).unref?.();
}

module.exports = {
  notifyStaleItems,
  startStaleSolicitudesJob,
};
