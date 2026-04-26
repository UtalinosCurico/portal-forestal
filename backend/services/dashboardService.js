const { all, get } = require("../db/database");
const { isGlobalRole, requireTeamAssigned } = require("../middleware/roles");
const { SOLICITUD_STATUS } = require("../config/solicitudFlow");
const { HttpError } = require("../utils/httpError");
const { addDaysToDateKey, formatChileDateKey, getChileDayBounds } = require("../utils/dateTime");
const { isOperationalPgEnabled } = require("./operationalPgStore");
const pgService = require("./dashboardPgService");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getActorRole(actor) {
  return actor.rol || actor.role;
}

function normalizeDate(value, field) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const text = String(value).trim();
  if (!DATE_PATTERN.test(text)) {
    throw new HttpError(400, `${field} debe tener formato YYYY-MM-DD`);
  }
  return text;
}

function normalizeFilters(actor, filters = {}) {
  const role = getActorRole(actor);
  const normalized = {
    fechaDesde: normalizeDate(filters.fechaDesde, "fechaDesde"),
    fechaHasta: normalizeDate(filters.fechaHasta, "fechaHasta"),
    equipoId: null,
  };

  if (isGlobalRole(role) && (filters.equipoId || filters.equipo_id)) {
    const equipoId = Number(filters.equipoId || filters.equipo_id);
    if (!Number.isInteger(equipoId) || equipoId <= 0) {
      throw new HttpError(400, "equipoId invalido");
    }
    normalized.equipoId = equipoId;
  }

  if (normalized.fechaDesde && normalized.fechaHasta && normalized.fechaDesde > normalized.fechaHasta) {
    throw new HttpError(400, "fechaDesde no puede ser mayor que fechaHasta");
  }

  return normalized;
}

function buildScope(actor, filters = {}, alias = "s", options = {}) {
  const includeDate = options.includeDate !== false;
  const dateField = options.dateField || "created_at";
  const teamField = options.teamField || "equipo_id";
  const role = getActorRole(actor);
  const normalized = normalizeFilters(actor, filters);

  const conditions = [];
  const params = [];

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    conditions.push(`${alias}.${teamField} = ?`);
    params.push(actor.equipo_id);
  }

  if (normalized.equipoId) {
    conditions.push(`${alias}.${teamField} = ?`);
    params.push(normalized.equipoId);
  }

  if (includeDate && normalized.fechaDesde) {
    const bounds = getChileDayBounds(normalized.fechaDesde);
    conditions.push(`${alias}.${dateField} >= ?`);
    params.push(bounds.startUtcSql);
  }

  if (includeDate && normalized.fechaHasta) {
    const bounds = getChileDayBounds(normalized.fechaHasta);
    conditions.push(`${alias}.${dateField} < ?`);
    params.push(bounds.endUtcSql);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    normalized,
  };
}

function getSeriesRange(filters) {
  const today = formatChileDateKey(new Date());
  const from = filters.fechaDesde || null;
  const to = filters.fechaHasta || null;

  if (from && to) {
    return { start: from, end: to };
  }

  if (from && !to) {
    return { start: from, end: addDaysToDateKey(from, 6) };
  }

  if (!from && to) {
    return { start: addDaysToDateKey(to, -6), end: to };
  }

  return { start: addDaysToDateKey(today, -6), end: today };
}

async function getMetricValue(sql, params = []) {
  const row = await get(sql, params);
  return Number(row?.total || 0);
}

async function getSolicitudesPorEstado(actor, filters) {
  const scope = buildScope(actor, filters, "s");

  const rows = await all(
    `
      SELECT s.estado, COUNT(*) AS total
      FROM solicitudes s
      ${scope.where}
      GROUP BY s.estado
    `,
    scope.params
  );

  const map = new Map(rows.map((row) => [row.estado, Number(row.total)]));

  return [
    { estado: "Pendiente", total: map.get(SOLICITUD_STATUS.PENDIENTE) || 0 },
    { estado: "En gestion", total: map.get(SOLICITUD_STATUS.EN_REVISION) || 0 },
    { estado: "Despachado", total: map.get(SOLICITUD_STATUS.EN_DESPACHO) || 0 },
    { estado: "Entregado", total: map.get(SOLICITUD_STATUS.ENTREGADO) || 0 },
  ];
}

async function getSolicitudesPorEquipo(actor, filters) {
  const scope = buildScope(actor, filters, "s");

  const rows = await all(
    `
      SELECT
        COALESCE(e.nombre_equipo, 'Sin equipo') AS equipo,
        COUNT(*) AS total
      FROM solicitudes s
      LEFT JOIN equipos e ON e.id = s.equipo_id
      ${scope.where}
      GROUP BY COALESCE(e.nombre_equipo, 'Sin equipo')
      ORDER BY equipo ASC
    `,
    scope.params
  );

  return rows.map((row) => ({
    equipo: row.equipo,
    total: Number(row.total),
  }));
}

async function getSolicitudesSerie(actor, filters) {
  const scope = buildScope(actor, filters, "s", { includeDate: false });
  const range = getSeriesRange(scope.normalized);
  const startBounds = getChileDayBounds(range.start);
  const endBounds = getChileDayBounds(range.end);

  const rows = await all(
    `
      SELECT s.created_at
      FROM solicitudes s
      ${scope.where ? `${scope.where} AND` : "WHERE"} s.created_at >= ? AND s.created_at < ?
      ORDER BY s.created_at ASC
    `,
    [...scope.params, startBounds.startUtcSql, endBounds.endUtcSql]
  );

  const map = new Map();
  rows.forEach((row) => {
    const key = formatChileDateKey(row.created_at);
    map.set(key, (map.get(key) || 0) + 1);
  });

  const result = [];
  let cursor = range.start;
  while (cursor <= range.end) {
    result.push({ fecha: cursor, total: map.get(cursor) || 0 });
    cursor = addDaysToDateKey(cursor, 1);
  }

  return result;
}

async function getSolicitudesEnviadas(actor, filters) {
  const scope = buildScope(actor, filters, "s");

  return all(
    `
      SELECT
        s.id,
        COALESCE(e.nombre_equipo, 'Sin equipo') AS equipo,
        s.repuesto,
        s.cantidad,
        s.estado,
        s.created_at,
        s.dispatched_at,
        s.received_at
      FROM solicitudes s
      LEFT JOIN equipos e ON e.id = s.equipo_id
      ${scope.where}
      ORDER BY s.id DESC
      LIMIT 15
    `,
    scope.params
  );
}

async function getEnviosTracking(actor, filters) {
  const scope = buildScope(actor, filters, "es", {
    dateField: "fecha_envio",
    teamField: "equipo_destino_id",
  });

  return all(
    `
      SELECT
        es.id,
        COALESCE(e.nombre_equipo, 'Sin equipo') AS equipo,
        i.codigo AS repuesto_codigo,
        i.nombre AS repuesto,
        es.cantidad,
        es.estado_visual,
        es.fecha_envio,
        es.comentario
      FROM envios_stock es
      INNER JOIN inventario i ON i.id = es.repuesto_id
      LEFT JOIN equipos e ON e.id = es.equipo_destino_id
      ${scope.where}
      ORDER BY es.id DESC
      LIMIT 50
    `,
    scope.params
  );
}

async function getStockActualPorRepuesto(actor, filters) {
  const role = getActorRole(actor);
  const normalized = normalizeFilters(actor, filters);

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    return all(
      `
        SELECT
          i.nombre AS repuesto,
          es.stock AS cantidad
        FROM equipo_stock es
        INNER JOIN inventario i ON i.id = es.repuesto_id
        WHERE es.equipo_id = ?
        ORDER BY i.nombre ASC
      `,
      [actor.equipo_id]
    );
  }

  if (normalized.equipoId) {
    return all(
      `
        SELECT
          i.nombre AS repuesto,
          es.stock AS cantidad
        FROM equipo_stock es
        INNER JOIN inventario i ON i.id = es.repuesto_id
        WHERE es.equipo_id = ?
        ORDER BY i.nombre ASC
      `,
      [normalized.equipoId]
    );
  }

  return all(
    `
      SELECT
        i.nombre AS repuesto,
        i.stock_faena AS cantidad
      FROM inventario i
      ORDER BY i.nombre ASC
    `
  );
}

async function getStockCritico(actor) {
  if (isGlobalRole(getActorRole(actor))) {
    return getMetricValue(
      `
        SELECT COUNT(*) AS total
        FROM inventario
        WHERE stock_central <= critical_level
      `
    );
  }

  requireTeamAssigned(actor);
  return getMetricValue(
    `
      SELECT COUNT(*) AS total
      FROM equipo_stock es
      WHERE es.equipo_id = ?
        AND es.stock <= 2
    `,
    [actor.equipo_id]
  );
}

function mapActionUrgency(days) {
  const value = Number(days || 0);
  if (value > 7) return "alta";
  if (value >= 3) return "media";
  return "normal";
}

async function getMyActions(actor, filters = {}) {
  if (isOperationalPgEnabled()) {
    return pgService.getMyActions(actor, filters);
  }

  const role = getActorRole(actor);
  const limit = Math.min(30, Math.max(5, Number(filters.limit) || 12));

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    const rows = await all(
      `
        SELECT
          'ITEM_POR_GESTIONAR' AS tipo,
          si.id AS item_id,
          si.solicitud_id,
          si.nombre_item,
          si.cantidad,
          si.unidad_medida,
          si.codigo_referencia,
          si.updated_at,
          s.estado AS solicitud_estado,
          s.equipo_id,
          COALESCE(e.nombre_equipo, s.equipo, 'Sin equipo') AS equipo,
          su.nombre AS solicitante,
          CAST((julianday('now') - julianday(COALESCE(si.updated_at, si.created_at, s.updated_at, s.created_at))) AS INTEGER) AS dias_sin_movimiento
        FROM solicitud_items si
        INNER JOIN solicitudes s ON s.id = si.solicitud_id
        INNER JOIN usuarios su ON su.id = s.solicitante_id
        LEFT JOIN equipos e ON e.id = s.equipo_id
        WHERE si.estado_item = 'POR_GESTIONAR'
          AND s.estado NOT IN ('ENTREGADO', 'RECHAZADO')
          AND s.equipo_id = ?
        ORDER BY dias_sin_movimiento DESC, si.id ASC
        LIMIT ?
      `,
      [actor.equipo_id, limit]
    );

    return rows.map((row) => {
      const days = Math.max(0, Number(row.dias_sin_movimiento || 0));
      return {
        tipo: row.tipo,
        prioridad: mapActionUrgency(days),
        dias_sin_movimiento: days,
        solicitud_id: Number(row.solicitud_id),
        item_id: Number(row.item_id),
        titulo: row.nombre_item || "Producto por gestionar",
        descripcion: `Solicitud #${row.solicitud_id} | ${row.equipo || "Sin equipo"}`,
        equipo: row.equipo,
        solicitante: row.solicitante,
        estado: row.solicitud_estado,
        cantidad: Number(row.cantidad || 0),
        unidad_medida: row.unidad_medida || null,
        codigo_referencia: row.codigo_referencia || null,
      };
    });
  }

  const pendingRows = await all(
    `
      SELECT
        'SOLICITUD_PENDIENTE' AS tipo,
        s.id AS solicitud_id,
        NULL AS item_id,
        COALESCE(s.repuesto, 'Solicitud pendiente') AS titulo,
        s.estado,
        s.equipo_id,
        COALESCE(e.nombre_equipo, s.equipo, 'Sin equipo') AS equipo,
        su.nombre AS solicitante,
        CAST((julianday('now') - julianday(COALESCE(s.updated_at, s.created_at))) AS INTEGER) AS dias_sin_movimiento
      FROM solicitudes s
      INNER JOIN usuarios su ON su.id = s.solicitante_id
      LEFT JOIN equipos e ON e.id = s.equipo_id
      WHERE s.estado = ?
      ORDER BY dias_sin_movimiento DESC, s.id ASC
      LIMIT ?
    `,
    [SOLICITUD_STATUS.PENDIENTE, limit]
  );

  const staleRows = await all(
    `
      SELECT
        'ITEM_ATRASADO' AS tipo,
        si.solicitud_id,
        si.id AS item_id,
        si.nombre_item AS titulo,
        s.estado,
        s.equipo_id,
        COALESCE(e.nombre_equipo, s.equipo, 'Sin equipo') AS equipo,
        su.nombre AS solicitante,
        si.cantidad,
        si.unidad_medida,
        si.codigo_referencia,
        CAST((julianday('now') - julianday(COALESCE(si.updated_at, si.created_at, s.updated_at, s.created_at))) AS INTEGER) AS dias_sin_movimiento
      FROM solicitud_items si
      INNER JOIN solicitudes s ON s.id = si.solicitud_id
      INNER JOIN usuarios su ON su.id = s.solicitante_id
      LEFT JOIN equipos e ON e.id = s.equipo_id
      WHERE si.estado_item = 'POR_GESTIONAR'
        AND s.estado NOT IN ('ENTREGADO', 'RECHAZADO')
        AND CAST((julianday('now') - julianday(COALESCE(si.updated_at, si.created_at, s.updated_at, s.created_at))) AS INTEGER) >= 3
      ORDER BY dias_sin_movimiento DESC, si.id ASC
      LIMIT ?
    `,
    [limit]
  );

  return [...pendingRows, ...staleRows]
    .map((row) => {
      const days = Math.max(0, Number(row.dias_sin_movimiento || 0));
      return {
        tipo: row.tipo,
        prioridad: mapActionUrgency(days),
        dias_sin_movimiento: days,
        solicitud_id: Number(row.solicitud_id),
        item_id: row.item_id ? Number(row.item_id) : null,
        titulo: row.titulo || "Accion pendiente",
        descripcion:
          row.tipo === "SOLICITUD_PENDIENTE"
            ? `Revisar solicitud de ${row.solicitante || "usuario"}`
            : `Producto sin gestionar en solicitud #${row.solicitud_id}`,
        equipo: row.equipo,
        solicitante: row.solicitante,
        estado: row.estado,
        cantidad: row.cantidad === undefined || row.cantidad === null ? null : Number(row.cantidad),
        unidad_medida: row.unidad_medida || null,
        codigo_referencia: row.codigo_referencia || null,
      };
    })
    .sort((a, b) => b.dias_sin_movimiento - a.dias_sin_movimiento)
    .slice(0, limit);
}

async function getDashboardData(actor, filters = {}) {
  if (isOperationalPgEnabled()) {
    return pgService.getDashboardData(actor, filters);
  }

  const role = getActorRole(actor);
  const includeStock = isGlobalRole(role);
  const scope = buildScope(actor, filters, "s");
  const scopeAnd = scope.where ? scope.where.replace("WHERE", "AND") : "";

  const [
    solicitudesPendientes,
    despachosPendientes,
    solicitudesPorEstado,
    solicitudesPorEquipo,
    solicitudesSerie,
    solicitudesEnviadas,
    stockCritico,
  ] = await Promise.all([
    getMetricValue(
      `
        SELECT COUNT(*) AS total
        FROM solicitudes s
        WHERE s.estado IN (?, ?)
        ${scopeAnd}
      `,
      [SOLICITUD_STATUS.PENDIENTE, SOLICITUD_STATUS.EN_REVISION, ...scope.params]
    ),
    getMetricValue(
      `
        SELECT COUNT(*) AS total
        FROM solicitudes s
        WHERE s.estado = ?
        ${scopeAnd}
      `,
      [SOLICITUD_STATUS.EN_DESPACHO, ...scope.params]
    ),
    getSolicitudesPorEstado(actor, filters),
    getSolicitudesPorEquipo(actor, filters),
    getSolicitudesSerie(actor, filters),
    getSolicitudesEnviadas(actor, filters),
    includeStock ? getStockCritico(actor) : Promise.resolve(null),
  ]);

  return {
    filtros: scope.normalized,
    metricas: {
      solicitudes_pendientes: solicitudesPendientes,
      despachos_pendientes: despachosPendientes,
      stock_critico: stockCritico,
    },
    solicitudes_por_estado: solicitudesPorEstado,
    solicitudes_por_equipo: solicitudesPorEquipo,
    solicitudes_ultimos_7_dias: solicitudesSerie,
    solicitudes_enviadas: solicitudesEnviadas,
    envios_tracking: [],
    stock_actual_repuestos: [],
  };
}

async function getDashboardMetrics(actor, filters = {}) {
  if (isOperationalPgEnabled()) {
    return pgService.getDashboardMetrics(actor, filters);
  }

  const dashboardData = await getDashboardData(actor, filters);
  return dashboardData.metricas;
}

module.exports = {
  getDashboardData,
  getDashboardMetrics,
  getMyActions,
};
