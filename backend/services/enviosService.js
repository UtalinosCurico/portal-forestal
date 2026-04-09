const { all, get, run } = require("../db/database");
const { ROLES } = require("../config/appRoles");
const { isGlobalRole, requireTeamAssigned } = require("../middleware/roles");
const { HttpError } = require("../utils/httpError");
const { getChileDayBounds } = require("../utils/dateTime");
const notificacionesService = require("./notificacionesService");

const ESTADOS_VISUALES = ["PREPARADO", "ENVIADO", "RECIBIDO"];
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

function parseEstadoVisual(value, fallback = "PREPARADO") {
  const estado = String(value || fallback)
    .trim()
    .toUpperCase();

  if (!ESTADOS_VISUALES.includes(estado)) {
    throw new HttpError(400, "estado_visual invalido");
  }
  return estado;
}

function normalizeLimit(value, fallback = 25) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 300);
}

function normalizeOrder(value) {
  const normalized = String(value || "desc")
    .trim()
    .toLowerCase();

  if (["asc", "oldest", "antiguos"].includes(normalized)) {
    return "ASC";
  }
  return "DESC";
}

function normalizeSearch(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text ? text.toLowerCase() : null;
}

function buildScope(actor, filters = {}, alias = "es") {
  const role = getActorRole(actor);
  const params = [];
  const conditions = [];

  const fechaDesde = normalizeDate(filters.fechaDesde, "fechaDesde");
  const fechaHasta = normalizeDate(filters.fechaHasta, "fechaHasta");
  if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
    throw new HttpError(400, "fechaDesde no puede ser mayor que fechaHasta");
  }

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    conditions.push(`${alias}.equipo_destino_id = ?`);
    params.push(actor.equipo_id);
  } else if (filters.equipoId || filters.equipo_destino_id) {
    const equipoId = Number(filters.equipoId || filters.equipo_destino_id);
    if (!Number.isInteger(equipoId) || equipoId <= 0) {
      throw new HttpError(400, "equipoId invalido");
    }
    conditions.push(`${alias}.equipo_destino_id = ?`);
    params.push(equipoId);
  }

  if (filters.estado_visual) {
    conditions.push(`${alias}.estado_visual = ?`);
    params.push(parseEstadoVisual(filters.estado_visual));
  }

  const search = normalizeSearch(filters.q || filters.buscar || filters.search);
  if (search) {
    conditions.push(
      "(LOWER(i.nombre) LIKE ? OR LOWER(i.codigo) LIKE ? OR LOWER(e.nombre_equipo) LIKE ?)"
    );
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (fechaDesde) {
    const bounds = getChileDayBounds(fechaDesde);
    conditions.push(`${alias}.fecha_envio >= ?`);
    params.push(bounds.startUtcSql);
  }

  if (fechaHasta) {
    const bounds = getChileDayBounds(fechaHasta);
    conditions.push(`${alias}.fecha_envio < ?`);
    params.push(bounds.endUtcSql);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    limit: normalizeLimit(filters.limit, 25),
    order: normalizeOrder(filters.order),
  };
}

async function ensureEquipoStockRow(equipoId, repuestoId) {
  await run(
    `
      INSERT OR IGNORE INTO equipo_stock (equipo_id, repuesto_id, stock, ultima_actualizacion)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    `,
    [equipoId, repuestoId]
  );
}

async function syncInventarioFaena(repuestoId) {
  const row = await get(
    `
      SELECT COALESCE(SUM(stock), 0) AS total
      FROM equipo_stock
      WHERE repuesto_id = ?
    `,
    [repuestoId]
  );

  await run(
    `
      UPDATE inventario
      SET stock_faena = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [Number(row?.total || 0), repuestoId]
  );
}

async function getEnvioById(envioId) {
  return get(
    `
      SELECT
        es.id,
        es.repuesto_id,
        i.codigo AS repuesto_codigo,
        i.nombre AS repuesto_nombre,
        es.cantidad,
        es.equipo_destino_id,
        e.nombre_equipo AS equipo_destino,
        es.solicitado_por,
        us.nombre AS solicitado_por_nombre,
        es.autorizado_por,
        ua.nombre AS autorizado_por_nombre,
        es.fecha_envio,
        es.fecha_recepcion,
        es.comentario,
        es.estado_visual,
        es.created_at,
        es.updated_at
      FROM envios_stock es
      INNER JOIN inventario i ON i.id = es.repuesto_id
      INNER JOIN equipos e ON e.id = es.equipo_destino_id
      INNER JOIN usuarios us ON us.id = es.solicitado_por
      LEFT JOIN usuarios ua ON ua.id = es.autorizado_por
      WHERE es.id = ?
    `,
    [envioId]
  );
}

async function listEnvios(actor, filters = {}) {
  const scope = buildScope(actor, filters, "es");

  return all(
    `
      SELECT
        es.id,
        es.repuesto_id,
        i.codigo AS repuesto_codigo,
        i.nombre AS repuesto_nombre,
        es.cantidad,
        es.equipo_destino_id,
        e.nombre_equipo AS equipo_destino,
        es.solicitado_por,
        us.nombre AS solicitado_por_nombre,
        es.autorizado_por,
        ua.nombre AS autorizado_por_nombre,
        es.fecha_envio,
        es.fecha_recepcion,
        es.comentario,
        es.estado_visual,
        es.created_at,
        es.updated_at
      FROM envios_stock es
      INNER JOIN inventario i ON i.id = es.repuesto_id
      INNER JOIN equipos e ON e.id = es.equipo_destino_id
      INNER JOIN usuarios us ON us.id = es.solicitado_por
      LEFT JOIN usuarios ua ON ua.id = es.autorizado_por
      ${scope.where}
      ORDER BY es.id ${scope.order}
      LIMIT ?
    `,
    [...scope.params, scope.limit]
  );
}

async function listOpciones(actor) {
  const actorRole = getActorRole(actor);
  if (![ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA].includes(actorRole)) {
    throw new HttpError(403, "No tiene permisos para consultar opciones de envio");
  }

  const [repuestos, equipos] = await Promise.all([
    all(
      `
        SELECT id, codigo, nombre
        FROM inventario
        WHERE stock_central > 0
        ORDER BY nombre ASC
      `
    ),
    all(
      `
        SELECT id, nombre_equipo
        FROM equipos
        ORDER BY nombre_equipo ASC
      `
    ),
  ]);

  return {
    repuestos,
    equipos,
  };
}

async function createEnvio(actor, payload) {
  const actorRole = getActorRole(actor);
  if (![ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA].includes(actorRole)) {
    throw new HttpError(403, "No tiene permisos para crear envios de stock");
  }

  const repuestoId = Number(payload.repuesto_id || payload.repuestoId);
  const cantidad = Number(payload.cantidad);
  const equipoDestinoId = Number(payload.equipo_destino_id || payload.equipoDestinoId);
  const comentario = payload.comentario ? String(payload.comentario).trim() : null;
  const estadoVisual = parseEstadoVisual(payload.estado_visual, "PREPARADO");
  const autorizadoPor = payload.autorizado_por
    ? Number(payload.autorizado_por)
    : Number(actor.id);

  if (!Number.isInteger(repuestoId) || repuestoId <= 0) {
    throw new HttpError(400, "repuesto_id invalido");
  }
  if (!Number.isInteger(equipoDestinoId) || equipoDestinoId <= 0) {
    throw new HttpError(400, "equipo_destino_id invalido");
  }
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new HttpError(400, "cantidad debe ser un entero mayor a cero");
  }

  const repuesto = await get("SELECT id, codigo, nombre, stock_central FROM inventario WHERE id = ?", [
    repuestoId,
  ]);
  if (!repuesto) {
    throw new HttpError(404, "Repuesto no encontrado");
  }

  const equipo = await get("SELECT id, nombre_equipo FROM equipos WHERE id = ?", [equipoDestinoId]);
  if (!equipo) {
    throw new HttpError(404, "Equipo destino no encontrado");
  }

  if (Number(repuesto.stock_central) < cantidad) {
    throw new HttpError(409, "Stock central insuficiente para este envio");
  }

  let envioId = null;
  await run("BEGIN IMMEDIATE TRANSACTION");
  try {
    const updateCentral = await run(
      `
        UPDATE inventario
        SET stock_central = stock_central - ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND stock_central >= ?
      `,
      [cantidad, repuestoId, cantidad]
    );

    if (updateCentral.changes === 0) {
      throw new HttpError(409, "Stock central insuficiente para este envio");
    }

    await ensureEquipoStockRow(equipoDestinoId, repuestoId);
    await run(
      `
        UPDATE equipo_stock
        SET stock = stock + ?, ultima_actualizacion = CURRENT_TIMESTAMP
        WHERE equipo_id = ? AND repuesto_id = ?
      `,
      [cantidad, equipoDestinoId, repuestoId]
    );

    const insertEnvio = await run(
      `
        INSERT INTO envios_stock (
          repuesto_id,
          cantidad,
          equipo_destino_id,
          solicitado_por,
          autorizado_por,
          fecha_envio,
          comentario,
          estado_visual,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP)
      `,
      [repuestoId, cantidad, equipoDestinoId, actor.id, autorizadoPor, comentario, estadoVisual]
    );
    envioId = insertEnvio.lastID;

    await run(
      `
        INSERT INTO inventario_movimientos
          (inventario_id, tipo, cantidad, detalle, actor_id)
        VALUES (?, 'ENVIO_BODEGA_SALIDA', ?, ?, ?)
      `,
      [repuestoId, -cantidad, `Envio a ${equipo.nombre_equipo}`, actor.id]
    );

    await run(
      `
        INSERT INTO inventario_movimientos
          (inventario_id, tipo, cantidad, detalle, actor_id)
        VALUES (?, 'ENVIO_FAENA_ENTRADA', ?, ?, ?)
      `,
      [repuestoId, cantidad, `Recepcion teorica en ${equipo.nombre_equipo}`, actor.id]
    );

    await syncInventarioFaena(repuestoId);
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }

  const created = await getEnvioById(envioId);

  await notificacionesService.createEnvioNotification({
    envioId: created?.id,
    equipoId: created?.equipo_destino_id,
    equipoNombre: created?.equipo_destino,
    repuesto: created?.repuesto_nombre,
    cantidad: created?.cantidad,
    estadoVisual: created?.estado_visual,
  });

  return created;
}

async function updateEnvio(actor, envioId, payload) {
  const actorRole = getActorRole(actor);
  if (![ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA].includes(actorRole)) {
    throw new HttpError(403, "No tiene permisos para actualizar envios");
  }

  const current = await get("SELECT * FROM envios_stock WHERE id = ?", [envioId]);
  if (!current) {
    throw new HttpError(404, "Envio no encontrado");
  }

  const updates = [];
  const params = [];

  if (payload.estado_visual !== undefined) {
    const nextStatus = parseEstadoVisual(payload.estado_visual);
    updates.push("estado_visual = ?");
    params.push(nextStatus);

    if (nextStatus === "RECIBIDO") {
      updates.push("fecha_recepcion = COALESCE(fecha_recepcion, CURRENT_TIMESTAMP)");
    }
  }

  if (payload.comentario !== undefined) {
    updates.push("comentario = ?");
    params.push(payload.comentario ? String(payload.comentario).trim() : null);
  }

  if (payload.autorizado_por !== undefined) {
    const autorizadoPor = payload.autorizado_por ? Number(payload.autorizado_por) : null;
    if (autorizadoPor !== null && (!Number.isInteger(autorizadoPor) || autorizadoPor <= 0)) {
      throw new HttpError(400, "autorizado_por invalido");
    }
    updates.push("autorizado_por = ?");
    params.push(autorizadoPor);
  }

  if (!updates.length) {
    throw new HttpError(400, "No se enviaron cambios para actualizar");
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(envioId);

  await run(
    `
      UPDATE envios_stock
      SET ${updates.join(", ")}
      WHERE id = ?
    `,
    params
  );

  return getEnvioById(envioId);
}

async function confirmRecepcion(actor, envioId, payload = {}) {
  const role = getActorRole(actor);
  const allowedRoles = [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA, ROLES.JEFE_FAENA, ROLES.MECANICO];
  if (!allowedRoles.includes(role)) {
    throw new HttpError(403, "No tiene permisos para confirmar recepcion");
  }

  const current = await get("SELECT * FROM envios_stock WHERE id = ?", [envioId]);
  if (!current) {
    throw new HttpError(404, "Envio no encontrado");
  }

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    if (Number(current.equipo_destino_id) !== Number(actor.equipo_id)) {
      throw new HttpError(403, "No puede confirmar recepcion de otro equipo");
    }
  }

  const comentarioExtra = payload.comentario ? String(payload.comentario).trim() : null;
  const baseComment = current.comentario ? String(current.comentario).trim() : "";
  const mergedComment = comentarioExtra
    ? [baseComment, comentarioExtra].filter(Boolean).join(" | ")
    : baseComment || "Recepcion confirmada en faena";

  await run(
    `
      UPDATE envios_stock
      SET
        estado_visual = 'RECIBIDO',
        fecha_recepcion = COALESCE(fecha_recepcion, CURRENT_TIMESTAMP),
        comentario = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [mergedComment, envioId]
  );

  return getEnvioById(envioId);
}

module.exports = {
  listEnvios,
  listOpciones,
  createEnvio,
  updateEnvio,
  confirmRecepcion,
};
