const { all, get, run } = require("../db/database");
const { isGlobalRole, requireTeamAssigned } = require("../middleware/roles");
const { SOLICITUD_STATUS, canTransition } = require("../config/solicitudFlow");
const {
  SOLICITUD_ITEM_STATUS,
  SOLICITUD_ITEM_STATUS_LIST,
  canTransitionItemStatus,
  isItemStatusReversion,
} = require("../config/solicitudItemFlow");
const { HttpError } = require("../utils/httpError");
const { getChileDayBounds } = require("../utils/dateTime");
const notificacionesService = require("./notificacionesService");
const { isOperationalPgEnabled } = require("./operationalPgStore");
const pgService = require("./solicitudesPgService");

const VALID_STATUS = new Set(Object.values(SOLICITUD_STATUS));
const VALID_ITEM_STATUS = new Set(SOLICITUD_ITEM_STATUS_LIST);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE_DATA_LIMIT = 3_500_000;
const CLIENT_REQUEST_ID_MAX_LENGTH = 120;

function getActorRole(actor) {
  return actor.rol || actor.role;
}

function getRoleLabel(role) {
  const normalized = String(role || "").trim().toUpperCase();
  const labels = {
    ADMIN: "Administrador",
    SUPERVISOR: "Supervisor",
    JEFE_FAENA: "Jefe de faena",
    MECANICO: "Mecanico",
    OPERADOR: "Operador",
  };
  return labels[normalized] || normalized || "Usuario";
}

function getSolicitudStatusLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  const labels = {
    PENDIENTE: "Pendiente",
    EN_REVISION: "En gestion",
    APROBADO: "Aprobada",
    EN_DESPACHO: "En despacho",
    ENTREGADO: "Entregada",
    RECHAZADO: "Rechazada",
  };
  return labels[normalized] || normalized || "Proceso";
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
    estado: null,
    equipoId: null,
    fechaDesde: normalizeDate(filters.fechaDesde, "fechaDesde"),
    fechaHasta: normalizeDate(filters.fechaHasta, "fechaHasta"),
  };

  if (filters.estado) {
    const estado = String(filters.estado).trim().toUpperCase();
    if (!VALID_STATUS.has(estado)) {
      throw new HttpError(400, "estado invalido");
    }
    normalized.estado = estado;
  }

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

function buildWhereClause(actor, filters = {}, alias = "s") {
  const role = getActorRole(actor);
  const normalized = normalizeFilters(actor, filters);
  const conditions = [];
  const params = [];

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    conditions.push(`${alias}.equipo_id = ?`);
    params.push(actor.equipo_id);
  }

  if (normalized.equipoId) {
    conditions.push(`${alias}.equipo_id = ?`);
    params.push(normalized.equipoId);
  }

  if (normalized.estado) {
    conditions.push(`${alias}.estado = ?`);
    params.push(normalized.estado);
  }

  if (normalized.fechaDesde) {
    const bounds = getChileDayBounds(normalized.fechaDesde);
    conditions.push(`${alias}.created_at >= ?`);
    params.push(bounds.startUtcSql);
  }

  if (normalized.fechaHasta) {
    const bounds = getChileDayBounds(normalized.fechaHasta);
    conditions.push(`${alias}.created_at < ?`);
    params.push(bounds.endUtcSql);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    normalized,
  };
}

function normalizeSingleItem(payload = {}) {
  const nombreItemRaw = String(
    payload.nombre_item || payload.nombre || payload.repuesto || payload.item || ""
  ).trim();
  const cantidadRaw = Number(payload.cantidad);
  const nombreItem = nombreItemRaw || "Producto sin nombre";
  const cantidad = Number.isInteger(cantidadRaw) && cantidadRaw > 0 ? cantidadRaw : 1;
  const unidadMedida = String(
    payload.unidad_medida ?? payload.unidadMedida ?? payload.talla ?? payload.unidad ?? ""
  ).trim() || null;
  const codigoReferencia = String(
    payload.codigo_referencia ?? payload.codigoReferencia ?? payload.codigo ?? ""
  ).trim() || null;
  const usuarioFinal = String(payload.usuario_final ?? payload.usuarioFinal ?? "").trim() || null;
  const comentario = String(payload.detalle ?? payload.comentario ?? "").trim() || null;
  const estadoItemRaw = payload.estado_item ?? payload.estadoItem;
  const comentarioGestion = payload.comentario_gestion
    ? String(payload.comentario_gestion).trim()
    : null;
  const encargadoIdRaw = payload.encargado_id ?? payload.encargadoId;
  const enviadoPorIdRaw = payload.enviado_por_id ?? payload.enviadoPorId;
  const recepcionadoPorIdRaw = payload.recepcionado_por_id ?? payload.recepcionadoPorId;
  const encargadoId =
    encargadoIdRaw === undefined || encargadoIdRaw === null || encargadoIdRaw === ""
      ? null
      : Number(encargadoIdRaw);
  const enviadoPorId =
    enviadoPorIdRaw === undefined || enviadoPorIdRaw === null || enviadoPorIdRaw === ""
      ? null
      : Number(enviadoPorIdRaw);
  const recepcionadoPorId =
    recepcionadoPorIdRaw === undefined ||
    recepcionadoPorIdRaw === null ||
    recepcionadoPorIdRaw === ""
      ? null
      : Number(recepcionadoPorIdRaw);

  const estadoItem = estadoItemRaw
    ? String(estadoItemRaw).trim().toUpperCase()
    : SOLICITUD_ITEM_STATUS.POR_GESTIONAR;
  if (!VALID_ITEM_STATUS.has(estadoItem)) {
    throw new HttpError(400, "estado_item invalido");
  }

  if (encargadoId !== null && (!Number.isInteger(encargadoId) || encargadoId <= 0)) {
    throw new HttpError(400, "encargado_id invalido");
  }
  if (enviadoPorId !== null && (!Number.isInteger(enviadoPorId) || enviadoPorId <= 0)) {
    throw new HttpError(400, "enviado_por_id invalido");
  }
  if (
    recepcionadoPorId !== null &&
    (!Number.isInteger(recepcionadoPorId) || recepcionadoPorId <= 0)
  ) {
    throw new HttpError(400, "recepcionado_por_id invalido");
  }

  return {
    nombre_item: nombreItem,
    cantidad,
    unidad_medida: unidadMedida,
    codigo_referencia: codigoReferencia,
    usuario_final: usuarioFinal,
    comentario,
    estado_item: estadoItem,
    comentario_gestion: comentarioGestion,
    encargado_id: encargadoId,
    enviado_por_id: enviadoPorId,
    recepcionado_por_id: recepcionadoPorId,
  };
}

function normalizeItems(payload = {}) {
  const incomingItems = Array.isArray(payload.items) ? payload.items : [];
  if (incomingItems.length) {
    return incomingItems.map((item) => normalizeSingleItem(item));
  }

  return [normalizeSingleItem(payload)];
}

function normalizeClientRequestId(payload = {}) {
  const raw = payload.client_request_id ?? payload.clientRequestId ?? payload.request_id ?? null;
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const value = String(raw).trim();
  if (!value) {
    return null;
  }

  if (value.length > CLIENT_REQUEST_ID_MAX_LENGTH) {
    throw new HttpError(400, "client_request_id demasiado largo");
  }

  return value;
}

function isSolicitudDuplicateRequestError(error) {
  return String(error?.message || "").includes("solicitudes.client_request_id");
}

function isSolicitudItemDuplicateRequestError(error) {
  return String(error?.message || "").includes("solicitud_items.client_request_id");
}

function buildSolicitudSummary(items) {
  const totalItems = items.length;
  const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad || 0), 0);
  const firstItem = items[0]?.nombre_item || "Solicitud";

  return {
    totalItems,
    totalUnidades,
    repuestoResumen:
      totalItems === 1 ? firstItem : `${firstItem} y ${Math.max(totalItems - 1, 0)} item(s) mas`,
    cantidadResumen: totalUnidades,
  };
}

function normalizeComparableText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function buildBusinessItemSignature(item = {}) {
  return [
    normalizeComparableText(item.nombre_item ?? item.nombre ?? item.repuesto ?? item.item),
    Number(item.cantidad || 0),
    normalizeComparableText(item.unidad_medida ?? item.unidadMedida ?? item.talla ?? item.unidad),
    normalizeComparableText(item.codigo_referencia ?? item.codigoReferencia ?? item.codigo),
    normalizeComparableText(item.usuario_final ?? item.usuarioFinal),
    normalizeComparableText(item.comentario ?? item.detalle),
  ].join("|");
}

function partitionIncomingItems(existingItems = [], incomingItems = []) {
  const knownSignatures = new Set(existingItems.map((item) => buildBusinessItemSignature(item)));
  const itemsToInsert = [];
  const skippedItems = [];

  for (const item of incomingItems) {
    const signature = buildBusinessItemSignature(item);
    if (knownSignatures.has(signature)) {
      skippedItems.push(item);
      continue;
    }
    knownSignatures.add(signature);
    itemsToInsert.push(item);
  }

  return { itemsToInsert, skippedItems };
}

function mergeSolicitudComment(existingComment, incomingComment) {
  const current = String(existingComment || "").trim();
  const next = String(incomingComment || "").trim();

  if (!next) {
    return current || null;
  }
  if (!current) {
    return next;
  }
  if (normalizeComparableText(current) === normalizeComparableText(next)) {
    return current;
  }
  return `${current}\n${next}`;
}

function buildItemStatusSummary(items = []) {
  const summary = {
    total_items: items.length,
    total: 0,
    por_gestionar: 0,
    gestionados: 0,
    enviados: 0,
    entregados: 0,
    no_aplica: 0,
  };

  for (const item of items) {
    const status = String(item.estado_item || SOLICITUD_ITEM_STATUS.POR_GESTIONAR).toUpperCase();
    if (status === SOLICITUD_ITEM_STATUS.NO_APLICA) {
      summary.no_aplica += 1;
      continue;
    }

    summary.total += 1;

    if (status === SOLICITUD_ITEM_STATUS.POR_GESTIONAR) {
      summary.por_gestionar += 1;
    }
    if (status === SOLICITUD_ITEM_STATUS.GESTIONADO) {
      summary.gestionados += 1;
    }
    if (status === SOLICITUD_ITEM_STATUS.ENVIADO) {
      summary.enviados += 1;
    }
    if (status === SOLICITUD_ITEM_STATUS.ENTREGADO) {
      summary.entregados += 1;
    }
  }

  return summary;
}

function deriveSolicitudStatusFromItemSummary(summary = {}, currentStatus = SOLICITUD_STATUS.PENDIENTE) {
  const total = Number(summary.total || 0);
  if (!total) {
    return currentStatus || SOLICITUD_STATUS.PENDIENTE;
  }

  if (currentStatus === SOLICITUD_STATUS.RECHAZADO) {
    return SOLICITUD_STATUS.RECHAZADO;
  }

  if (Number(summary.entregados || 0) === total) {
    return SOLICITUD_STATUS.ENTREGADO;
  }

  if (Number(summary.enviados || 0) + Number(summary.entregados || 0) === total) {
    return SOLICITUD_STATUS.EN_DESPACHO;
  }

  if (
    Number(summary.gestionados || 0) + Number(summary.enviados || 0) + Number(summary.entregados || 0) >
    0
  ) {
    return SOLICITUD_STATUS.EN_REVISION;
  }

  if (currentStatus === SOLICITUD_STATUS.APROBADO) {
    return SOLICITUD_STATUS.APROBADO;
  }

  return SOLICITUD_STATUS.PENDIENTE;
}

function mapSolicitudItemRow(row) {
  return {
    ...row,
    id: Number(row.id),
    solicitud_id: Number(row.solicitud_id),
    cantidad: Number(row.cantidad),
    unidad_medida: row.unidad_medida || null,
    codigo_referencia: row.codigo_referencia || null,
    usuario_final: row.usuario_final || null,
    detalle: row.comentario || null,
    estado_item: row.estado_item || SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
    comentario_gestion: row.comentario_gestion || null,
    encargado_id: row.encargado_id === null || row.encargado_id === undefined ? null : Number(row.encargado_id),
    encargado_nombre: row.encargado_nombre || null,
    enviado_por_id: row.enviado_por_id === null || row.enviado_por_id === undefined ? null : Number(row.enviado_por_id),
    enviado_por_nombre: row.enviado_por_nombre || null,
    recepcionado_por_id:
      row.recepcionado_por_id === null || row.recepcionado_por_id === undefined
        ? null
        : Number(row.recepcionado_por_id),
    recepcionado_por_nombre: row.recepcionado_por_nombre || null,
    updated_at: row.updated_at || null,
  };
}

function applyStatusMetadata(updates, params, estadoNuevo, actorId) {
  if (estadoNuevo === SOLICITUD_STATUS.PENDIENTE) {
    updates.push("reviewed_at = NULL");
    updates.push("reviewed_by = NULL");
    updates.push("dispatched_at = NULL");
    updates.push("dispatched_by = NULL");
    updates.push("received_at = NULL");
    updates.push("received_by = NULL");
    return;
  }

  if (estadoNuevo === SOLICITUD_STATUS.EN_REVISION || estadoNuevo === SOLICITUD_STATUS.APROBADO) {
    updates.push("reviewed_at = CURRENT_TIMESTAMP");
    updates.push("reviewed_by = ?");
    params.push(actorId);
    updates.push("dispatched_at = NULL");
    updates.push("dispatched_by = NULL");
    updates.push("received_at = NULL");
    updates.push("received_by = NULL");
    return;
  }

  if (estadoNuevo === SOLICITUD_STATUS.EN_DESPACHO) {
    updates.push("reviewed_at = CURRENT_TIMESTAMP");
    updates.push("reviewed_by = ?");
    params.push(actorId);
    updates.push("dispatched_at = CURRENT_TIMESTAMP");
    updates.push("dispatched_by = ?");
    params.push(actorId);
    updates.push("received_at = NULL");
    updates.push("received_by = NULL");
    return;
  }

  if (estadoNuevo === SOLICITUD_STATUS.ENTREGADO) {
    updates.push("reviewed_at = CURRENT_TIMESTAMP");
    updates.push("reviewed_by = ?");
    params.push(actorId);
    updates.push("dispatched_at = CURRENT_TIMESTAMP");
    updates.push("dispatched_by = ?");
    params.push(actorId);
    updates.push("received_at = CURRENT_TIMESTAMP");
    updates.push("received_by = ?");
    params.push(actorId);
    return;
  }

  if (estadoNuevo === SOLICITUD_STATUS.RECHAZADO) {
    updates.push("reviewed_at = CURRENT_TIMESTAMP");
    updates.push("reviewed_by = ?");
    params.push(actorId);
    updates.push("dispatched_at = NULL");
    updates.push("dispatched_by = NULL");
    updates.push("received_at = NULL");
    updates.push("received_by = NULL");
  }
}

async function getHistorialBySolicitudId(solicitudId) {
  return all(
    `
      SELECT
        id,
        accion,
        estado_anterior,
        estado_nuevo,
        detalle,
        actor_id,
        actor_name,
        created_at
      FROM solicitud_historial
      WHERE solicitud_id = ?
      ORDER BY id ASC
    `,
    [solicitudId]
  );
}

async function getSolicitudItemsBySolicitudId(solicitudId) {
  return all(
    `
      SELECT
        si.id,
        si.solicitud_id,
        si.nombre_item,
        si.cantidad,
        si.unidad_medida,
        si.codigo_referencia,
        si.usuario_final,
        si.comentario,
        si.estado_item,
        si.comentario_gestion,
        si.encargado_id,
        si.enviado_por_id,
        si.recepcionado_por_id,
        u.nombre AS encargado_nombre,
        su.nombre AS enviado_por_nombre,
        ru.nombre AS recepcionado_por_nombre,
        si.created_at,
        si.updated_at
      FROM solicitud_items si
      LEFT JOIN usuarios u ON u.id = si.encargado_id
      LEFT JOIN usuarios su ON su.id = si.enviado_por_id
      LEFT JOIN usuarios ru ON ru.id = si.recepcionado_por_id
      WHERE si.solicitud_id = ?
      ORDER BY si.id ASC
    `,
    [solicitudId]
  ).then((rows) => rows.map((row) => mapSolicitudItemRow(row)));
}

async function getSolicitudItemsBySolicitudIds(solicitudIds = []) {
  if (!solicitudIds.length) {
    return new Map();
  }

  const placeholders = solicitudIds.map(() => "?").join(", ");
  const rows = await all(
    `
      SELECT
        si.id,
        si.solicitud_id,
        si.nombre_item,
        si.cantidad,
        si.unidad_medida,
        si.codigo_referencia,
        si.usuario_final,
        si.comentario,
        si.estado_item,
        si.comentario_gestion,
        si.encargado_id,
        si.enviado_por_id,
        si.recepcionado_por_id,
        u.nombre AS encargado_nombre,
        su.nombre AS enviado_por_nombre,
        ru.nombre AS recepcionado_por_nombre,
        si.created_at,
        si.updated_at
      FROM solicitud_items si
      LEFT JOIN usuarios u ON u.id = si.encargado_id
      LEFT JOIN usuarios su ON su.id = si.enviado_por_id
      LEFT JOIN usuarios ru ON ru.id = si.recepcionado_por_id
      WHERE si.solicitud_id IN (${placeholders})
      ORDER BY si.solicitud_id ASC, si.id ASC
    `,
    solicitudIds
  );

  const grouped = new Map();
  for (const row of rows) {
    const bucket = grouped.get(Number(row.solicitud_id)) || [];
    bucket.push(mapSolicitudItemRow(row));
    grouped.set(Number(row.solicitud_id), bucket);
  }

  return grouped;
}

async function getSolicitudMensajesBySolicitudId(solicitudId) {
  return all(
    `
      SELECT
        sm.id,
        sm.solicitud_id,
        sm.remitente_id,
        ru.nombre AS remitente_nombre,
        sm.destinatario_id,
        du.nombre AS destinatario_nombre,
        sm.mensaje,
        sm.imagen_nombre,
        sm.imagen_data,
        sm.created_at
      FROM solicitud_mensajes sm
      INNER JOIN usuarios ru ON ru.id = sm.remitente_id
      LEFT JOIN usuarios du ON du.id = sm.destinatario_id
      WHERE sm.solicitud_id = ?
      ORDER BY sm.id ASC
    `,
    [solicitudId]
  );
}

async function getContactosForSolicitud(actor, solicitud, options = {}) {
  const includeSelf = options.includeSelf === true;
  const actorRole = getActorRole(actor);
  const params = [];
  let where = "WHERE u.activo = 1";

  if (!includeSelf) {
    where += " AND u.id <> ?";
    params.push(actor.id);
  }

  if (isGlobalRole(actorRole)) {
    where += " AND (u.equipo_id = ? OR u.rol IN ('ADMIN', 'SUPERVISOR'))";
    params.push(solicitud.equipo_id);
  } else {
    where += " AND (u.equipo_id = ? OR u.rol IN ('ADMIN', 'SUPERVISOR'))";
    params.push(actor.equipo_id);
  }

  const rows = await all(
    `
      SELECT
        u.id,
        u.nombre,
        u.email,
        u.rol,
        u.equipo_id,
        e.nombre_equipo AS equipo_nombre
      FROM usuarios u
      LEFT JOIN equipos e ON e.id = u.equipo_id
      ${where}
      ORDER BY
        CASE
          WHEN u.rol = 'JEFE_FAENA' THEN 1
          WHEN u.rol = 'SUPERVISOR' THEN 2
          WHEN u.rol = 'ADMIN' THEN 3
          WHEN u.rol = 'MECANICO' THEN 4
          ELSE 5
        END,
        u.nombre ASC
    `,
    params
  );

  return rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    rol: row.rol,
    equipo_id: row.equipo_id,
    equipo_nombre: row.equipo_nombre,
  }));
}

async function assertEncargadoAllowed(actor, solicitud, encargadoId) {
  if (encargadoId === null || encargadoId === undefined) {
    return null;
  }

  const contactos = await getContactosForSolicitud(actor, solicitud, { includeSelf: true });
  const encargado = contactos.find((item) => Number(item.id) === Number(encargadoId));
  if (!encargado) {
    throw new HttpError(403, "No puedes asignar ese encargado a este item");
  }
  return encargado;
}

async function assertSenderAllowed(actor, solicitud, enviadoPorId) {
  if (enviadoPorId === null || enviadoPorId === undefined) {
    return null;
  }

  const contactos = await getContactosForSolicitud(actor, solicitud, { includeSelf: true });
  const sender = contactos.find((item) => Number(item.id) === Number(enviadoPorId));
  if (!sender) {
    throw new HttpError(403, "No puedes asignar ese remitente a este item");
  }
  return sender;
}

async function assertReceiverAllowed(actor, solicitud, recepcionadoPorId) {
  if (recepcionadoPorId === null || recepcionadoPorId === undefined) {
    return null;
  }

  const contactos = await getContactosForSolicitud(actor, solicitud, { includeSelf: true });
  const receiver = contactos.find((item) => Number(item.id) === Number(recepcionadoPorId));
  if (!receiver) {
    throw new HttpError(403, "No puedes asignar ese receptor a este item");
  }
  return receiver;
}

function assertSolicitudVisible(actor, solicitud) {
  const role = getActorRole(actor);
  if (isGlobalRole(role)) {
    return;
  }

  requireTeamAssigned(actor);
  if (Number(solicitud.equipo_id) !== Number(actor.equipo_id)) {
    throw new HttpError(403, "No puede acceder a solicitudes de otro equipo");
  }
}

async function loadSolicitudRecord(solicitudId) {
  return get(
    `
      SELECT
        s.*,
        su.nombre AS solicitante_name,
        eq.nombre_equipo,
        rv.nombre AS reviewed_by_name,
        dp.nombre AS dispatched_by_name,
        rc.nombre AS received_by_name
      FROM solicitudes s
      INNER JOIN usuarios su ON su.id = s.solicitante_id
      LEFT JOIN equipos eq ON eq.id = s.equipo_id
      LEFT JOIN usuarios rv ON rv.id = s.reviewed_by
      LEFT JOIN usuarios dp ON dp.id = s.dispatched_by
      LEFT JOIN usuarios rc ON rc.id = s.received_by
      WHERE s.id = ?
    `,
    [solicitudId]
  );
}

async function findSolicitudIdByClientRequestId(clientRequestId) {
  if (!clientRequestId) {
    return null;
  }

  const row = await get(
    `
      SELECT id, solicitante_id
      FROM solicitudes
      WHERE client_request_id = ?
      LIMIT 1
    `,
    [clientRequestId]
  );

  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    solicitante_id: Number(row.solicitante_id),
  };
}

async function getSolicitudById(solicitudId, actor = null) {
  const solicitud = await loadSolicitudRecord(solicitudId);
  if (!solicitud) {
    return null;
  }

  if (actor) {
    assertSolicitudVisible(actor, solicitud);
  }

  const [items, historial, mensajes] = await Promise.all([
    getSolicitudItemsBySolicitudId(solicitudId),
    getHistorialBySolicitudId(solicitudId),
    getSolicitudMensajesBySolicitudId(solicitudId),
  ]);

  const summary = buildSolicitudSummary(items);

  return {
    ...solicitud,
    items,
    historial,
    mensajes,
    total_items: summary.totalItems,
    total_unidades: summary.totalUnidades,
    resumen_items: summary.repuestoResumen,
  };
}

async function getSolicitudDetail(actor, solicitudId) {
  const solicitud = await getSolicitudById(solicitudId, actor);
  if (!solicitud) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  return {
    ...solicitud,
    contactos: await getContactosForSolicitud(actor, solicitud),
  };
}

async function listSolicitudes(actor, filters = {}) {
  const scope = buildWhereClause(actor, filters, "s");
  const limit = Math.min(100, Math.max(10, Number(filters.limit) || 50));
  const page  = Math.max(1, Number(filters.page) || 1);
  const offset = (page - 1) * limit;

  const [{ total }] = await all(
    `SELECT COUNT(*) AS total FROM solicitudes s ${scope.where}`,
    scope.params
  );

  const rows = await all(
    `
      SELECT
        s.*,
        su.nombre AS solicitante_name,
        eq.nombre_equipo,
        rv.nombre AS reviewed_by_name,
        dp.nombre AS dispatched_by_name,
        rc.nombre AS received_by_name
      FROM solicitudes s
      INNER JOIN usuarios su ON su.id = s.solicitante_id
      LEFT JOIN equipos eq ON eq.id = s.equipo_id
      LEFT JOIN usuarios rv ON rv.id = s.reviewed_by
      LEFT JOIN usuarios dp ON dp.id = s.dispatched_by
      LEFT JOIN usuarios rc ON rc.id = s.received_by
      ${scope.where}
      ORDER BY s.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    scope.params
  );

  const data = rows.length
    ? (() => {
        const itemsBySolicitudId = null; // resolved below
        return rows;
      })()
    : [];

  if (!data.length) {
    return { data: [], total: Number(total), page, pages: Math.ceil(Number(total) / limit) };
  }

  const itemsBySolicitudId = await getSolicitudItemsBySolicitudIds(rows.map((r) => r.id));

  const decorated = rows.map((row) => {
    const items = itemsBySolicitudId.get(row.id) || [];
    const summary = items.length
      ? buildSolicitudSummary(items)
      : {
          totalItems: row.repuesto ? 1 : 0,
          totalUnidades: Number(row.cantidad || 0),
          repuestoResumen: row.repuesto || "Solicitud",
        };
    return { ...row, total_items: summary.totalItems, total_unidades: summary.totalUnidades, resumen_items: summary.repuestoResumen };
  });

  return { data: decorated, total: Number(total), page, pages: Math.ceil(Number(total) / limit) };
}

async function listSolicitudesForExport(actor, filters = {}) {
  const scope = buildWhereClause(actor, filters, "s");

  const solicitudes = await all(
    `
      SELECT
        s.id,
        COALESCE(eq.nombre_equipo, 'Sin equipo') AS equipo,
        s.repuesto,
        s.cantidad,
        s.estado,
        su.nombre AS solicitante,
        s.created_at,
        s.reviewed_at,
        s.dispatched_at,
        s.received_at,
        s.updated_at,
        s.comentario
      FROM solicitudes s
      INNER JOIN usuarios su ON su.id = s.solicitante_id
      LEFT JOIN equipos eq ON eq.id = s.equipo_id
      ${scope.where}
      ORDER BY s.created_at DESC, s.id DESC
    `,
    scope.params
  );

  if (!solicitudes.length) return [];

  const ids = solicitudes.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const items = await all(
    `
      SELECT
        si.*,
        u1.nombre AS encargado_nombre,
        u2.nombre AS enviado_por_nombre,
        u3.nombre AS recepcionado_por_nombre
      FROM solicitud_items si
      LEFT JOIN usuarios u1 ON u1.id = si.encargado_id
      LEFT JOIN usuarios u2 ON u2.id = si.enviado_por_id
      LEFT JOIN usuarios u3 ON u3.id = si.recepcionado_por_id
      WHERE si.solicitud_id IN (${placeholders})
      ORDER BY si.solicitud_id ASC, si.id ASC
    `,
    ids
  );

  const itemsMap = new Map();
  for (const item of items) {
    const bucket = itemsMap.get(item.solicitud_id) || [];
    bucket.push(item);
    itemsMap.set(item.solicitud_id, bucket);
  }

  return solicitudes.map((row) => {
    const rowItems = itemsMap.get(row.id) || [];
    return {
      ...row,
      total_items: rowItems.length || (row.repuesto ? 1 : 0),
      items: rowItems,
    };
  });
}

async function resolveEquipoForCreation(actor, payload) {
  const role = getActorRole(actor);

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    return actor.equipo_id;
  }

  const payloadEquipoId = Number(payload.equipo_id || payload.equipoId || 0);
  if (!payloadEquipoId) {
    throw new HttpError(400, "Para ADMIN/SUPERVISOR debes indicar equipo_id");
  }

  const equipo = await get("SELECT id FROM equipos WHERE id = ?", [payloadEquipoId]);
  if (!equipo) {
    throw new HttpError(400, "equipo_id no existe");
  }

  return payloadEquipoId;
}

async function findLatestPendingSolicitudForActor(actorId, equipoId) {
  const row = await get(
    `
      SELECT id
      FROM solicitudes
      WHERE solicitante_id = ? AND equipo_id = ? AND estado = ?
      ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
      LIMIT 1
    `,
    [Number(actorId), Number(equipoId), SOLICITUD_STATUS.PENDIENTE]
  );

  return row ? Number(row.id) : null;
}

async function insertSolicitudItems(solicitudId, items) {
  for (const item of items) {
    await run(
      `
        INSERT INTO solicitud_items (
          solicitud_id,
          nombre_item,
          cantidad,
          unidad_medida,
          codigo_referencia,
          usuario_final,
          comentario,
          estado_item,
          comentario_gestion,
          encargado_id,
          enviado_por_id,
          recepcionado_por_id,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        solicitudId,
        item.nombre_item,
        item.cantidad,
        item.unidad_medida || null,
        item.codigo_referencia || null,
        item.usuario_final || null,
        item.comentario || null,
        item.estado_item || SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
        item.comentario_gestion || null,
        item.encargado_id || null,
        item.enviado_por_id || null,
        item.recepcionado_por_id || null,
      ]
    );
  }
}

async function loadSolicitudItemsForSummary(solicitudId) {
  const rows = await all(
    `
      SELECT nombre_item, cantidad, estado_item
      FROM solicitud_items
      WHERE solicitud_id = ?
      ORDER BY id ASC
    `,
    [solicitudId]
  );

  return rows.map((row) => ({
    nombre_item: row.nombre_item,
    cantidad: Number(row.cantidad),
    estado_item: row.estado_item || SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
  }));
}

async function refreshSolicitudSummary(solicitudId, options = {}) {
  const items = await loadSolicitudItemsForSummary(solicitudId);
  if (!items.length) {
    throw new HttpError(409, "La solicitud debe mantener al menos un item");
  }

  const currentSolicitud = await get(
    `
      SELECT estado
      FROM solicitudes
      WHERE id = ?
    `,
    [solicitudId]
  );
  if (!currentSolicitud) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  const summary = buildSolicitudSummary(items);
  const itemStatusSummary = buildItemStatusSummary(items);
  const nextStatus =
    options.forceStatus ||
    deriveSolicitudStatusFromItemSummary(itemStatusSummary, currentSolicitud.estado);
  const statusChanged = nextStatus !== currentSolicitud.estado;

  const updates = ["repuesto = ?", "cantidad = ?", "updated_at = CURRENT_TIMESTAMP"];
  const params = [summary.repuestoResumen, summary.cantidadResumen];

  if (statusChanged) {
    updates.push("estado = ?");
    params.push(nextStatus);
    applyStatusMetadata(updates, params, nextStatus, options.actorId || null);
  }

  await run(
    `
      UPDATE solicitudes
      SET ${updates.join(", ")}
      WHERE id = ?
    `,
    [...params, solicitudId]
  );

  if (statusChanged && options.actorId && options.actorName) {
    await run(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES (?, 'ESTADO_AUTO_POR_PRODUCTOS', ?, ?, ?, ?, ?)
      `,
      [
        solicitudId,
        currentSolicitud.estado,
        nextStatus,
        options.reason || "El estado general se ajusto segun el avance de los productos",
        options.actorId,
        options.actorName,
      ]
    );
  }

  return {
    summary,
    itemStatusSummary,
    previousStatus: currentSolicitud.estado,
    nextStatus,
    statusChanged,
  };
}

async function findMatchingSolicitudItem(solicitudId, item) {
  const existingItems = await getSolicitudItemsBySolicitudId(solicitudId);
  const targetSignature = buildBusinessItemSignature(item);
  return (
    existingItems.find(
      (existingItem) => buildBusinessItemSignature(existingItem) === targetSignature
    ) || null
  );
}

async function reusePendingSolicitudForCreate(actor, solicitudId, payload, items) {
  const current = await loadSolicitudRecord(solicitudId);
  if (!current) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  const actorName = actor.nombre || actor.name || "Sistema";
  const existingItems = await getSolicitudItemsBySolicitudId(solicitudId);
  const { itemsToInsert, skippedItems } = partitionIncomingItems(existingItems, items);
  const mergedComment = mergeSolicitudComment(
    current.comentario,
    payload.comentario ? String(payload.comentario).trim() : null
  );
  const commentChanged = (current.comentario || null) !== (mergedComment || null);
  let refreshResult = {
    previousStatus: current.estado,
    nextStatus: current.estado,
    statusChanged: false,
  };

  if (itemsToInsert.length || commentChanged) {
    await run("BEGIN IMMEDIATE TRANSACTION");
    try {
      if (itemsToInsert.length) {
        await insertSolicitudItems(solicitudId, itemsToInsert);
      }

      if (commentChanged) {
        await run(
          `
            UPDATE solicitudes
            SET comentario = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [mergedComment, solicitudId]
        );
      }

      refreshResult = await refreshSolicitudSummary(solicitudId, {
        actorId: actor.id,
        actorName,
        reason: "La solicitud pendiente existente fue reutilizada para agregar nuevos productos",
      });

      const detailParts = [
        itemsToInsert.length
          ? `Se agregaron ${itemsToInsert.length} item(s) nuevo(s) a la solicitud pendiente existente.`
          : null,
        skippedItems.length
          ? `Se omitieron ${skippedItems.length} item(s) porque ya estaban registrados.`
          : null,
        commentChanged ? "Se anexó el comentario general recibido." : null,
      ].filter(Boolean);

      if (detailParts.length) {
        await run(
          `
            INSERT INTO solicitud_historial
              (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
            VALUES (?, 'SOLICITUD_REUTILIZADA', ?, ?, ?, ?, ?)
          `,
          [
            solicitudId,
            current.estado,
            refreshResult.nextStatus || current.estado,
            detailParts.join(" "),
            Number(actor.id),
            actorName,
          ]
        );
      }

      await run("COMMIT");
    } catch (error) {
      await run("ROLLBACK");
      throw error;
    }
  }

  const refreshedSolicitud = await getSolicitudById(solicitudId, actor);
  if (refreshResult.statusChanged) {
    await notificacionesService.createSolicitudStatusNotification({
      solicitudId: refreshedSolicitud?.id,
      equipoId: refreshedSolicitud?.equipo_id,
      equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo,
      repuesto: refreshedSolicitud?.resumen_items || refreshedSolicitud?.repuesto,
      estado: refreshedSolicitud?.estado,
      solicitanteId: refreshedSolicitud?.solicitante_id,
    });
  }

  for (const item of itemsToInsert) {
    await notificacionesService.createSolicitudItemNotification({
      solicitudId,
      equipoId: refreshedSolicitud?.equipo_id || current.equipo_id,
      equipoNombre:
        refreshedSolicitud?.nombre_equipo ||
        refreshedSolicitud?.equipo ||
        current.nombre_equipo ||
        current.equipo,
      itemNombre: item.nombre_item,
      accion: "Agregado por reutilizacion",
      estadoItem: item.estado_item || SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
    });
  }

  return {
    ...refreshedSolicitud,
    meta: {
      action: "merged_into_pending",
      solicitudId,
      addedItems: itemsToInsert.length,
      skippedItems: skippedItems.length,
    },
  };
}

async function applyMassItemStatusUpdate(solicitudId, estadoItem, actorId) {
  const normalizedStatus = String(estadoItem || "").trim().toUpperCase();
  if (!VALID_ITEM_STATUS.has(normalizedStatus)) {
    throw new HttpError(400, "estado_item invalido");
  }

  if (normalizedStatus === SOLICITUD_ITEM_STATUS.ENVIADO) {
    await run(
      `
        UPDATE solicitud_items
        SET
          estado_item = ?,
          enviado_por_id = COALESCE(enviado_por_id, ?),
          updated_at = CURRENT_TIMESTAMP
        WHERE solicitud_id = ?
          AND estado_item <> ?
      `,
      [SOLICITUD_ITEM_STATUS.ENVIADO, actorId, solicitudId, SOLICITUD_ITEM_STATUS.ENTREGADO]
    );
    return;
  }

  if (normalizedStatus === SOLICITUD_ITEM_STATUS.ENTREGADO) {
    await run(
      `
        UPDATE solicitud_items
        SET
          estado_item = ?,
          enviado_por_id = COALESCE(enviado_por_id, ?),
          recepcionado_por_id = COALESCE(recepcionado_por_id, ?),
          updated_at = CURRENT_TIMESTAMP
        WHERE solicitud_id = ?
      `,
      [SOLICITUD_ITEM_STATUS.ENTREGADO, actorId, actorId, solicitudId]
    );
  }
}

async function createSolicitud(actor, payload) {
  const actorName = actor.nombre || actor.name || "Sistema";
  const clientRequestId = normalizeClientRequestId(payload);
  const items = normalizeItems(payload);
  const equipoId = await resolveEquipoForCreation(actor, payload);
  const solicitudContext = { equipo_id: Number(equipoId) };
  for (const item of items) {
    if (item.encargado_id) {
      await assertEncargadoAllowed(actor, solicitudContext, item.encargado_id);
    }
      if (item.enviado_por_id) {
        await assertSenderAllowed(actor, solicitudContext, item.enviado_por_id);
      }
      if (item.recepcionado_por_id) {
        await assertReceiverAllowed(actor, solicitudContext, item.recepcionado_por_id);
      }
  }
  const summary = buildSolicitudSummary(items);
  const comentarioGeneral = payload.comentario ? String(payload.comentario).trim() : null;

  if (clientRequestId) {
    const existing = await findSolicitudIdByClientRequestId(clientRequestId);
    if (existing) {
      if (Number(existing.solicitante_id) !== Number(actor.id)) {
        throw new HttpError(409, "client_request_id ya fue utilizado por otra solicitud");
      }
      console.warn(
        `[FMN] Solicitud duplicada evitada para actor ${actor.id} con client_request_id=${clientRequestId}`
      );
      return getSolicitudById(existing.id, actor);
    }
  }

  await run("BEGIN IMMEDIATE TRANSACTION");
  let solicitudId = null;

  try {
    const insertResult = await run(
      `
        INSERT INTO solicitudes
          (solicitante_id, client_request_id, equipo, equipo_id, repuesto, cantidad, comentario, estado, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        actor.id,
        clientRequestId,
        payload.equipo ? String(payload.equipo) : null,
        equipoId,
        summary.repuestoResumen,
        summary.cantidadResumen,
        comentarioGeneral,
        SOLICITUD_STATUS.PENDIENTE,
      ]
    );

    solicitudId = insertResult.lastID;
    await insertSolicitudItems(solicitudId, items);

    await run(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES (?, 'CREADA', NULL, ?, ?, ?, ?)
      `,
      [
        solicitudId,
        SOLICITUD_STATUS.PENDIENTE,
        comentarioGeneral || `Solicitud creada con ${summary.totalItems} item(s)`,
        actor.id,
        actorName,
      ]
    );

    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    if (clientRequestId && isSolicitudDuplicateRequestError(error)) {
      const existing = await findSolicitudIdByClientRequestId(clientRequestId);
      if (existing) {
        console.warn(
          `[FMN] Solicitud duplicada evitada por indice unico para actor ${actor.id} con client_request_id=${clientRequestId}`
        );
        return getSolicitudById(existing.id, actor);
      }
    }
    throw error;
  }

  const created = await getSolicitudById(solicitudId, actor);

  await notificacionesService.createSolicitudNotification({
    solicitudId: created?.id,
    equipoId: created?.equipo_id,
    equipoNombre: created?.nombre_equipo || created?.equipo,
    repuesto: created?.resumen_items,
    cantidad: created?.total_unidades,
  });

  return created;
}

async function updateSolicitud(actor, solicitudId, payload) {
  const actorName = actor.nombre || actor.name || "Sistema";
  const current = await loadSolicitudRecord(solicitudId);
  if (!current) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  assertSolicitudVisible(actor, current);

  const actorRole = getActorRole(actor);
  const actorIsGlobal = isGlobalRole(actorRole);
  const wantsItemsUpdate =
    Array.isArray(payload.items) ||
    payload.repuesto !== undefined ||
    payload.cantidad !== undefined ||
    payload.nombre_item !== undefined;

  if (wantsItemsUpdate && !actorIsGlobal && current.estado !== SOLICITUD_STATUS.PENDIENTE) {
    throw new HttpError(409, "Solo puedes editar el detalle base mientras la solicitud esta pendiente");
  }

  if (!actorIsGlobal) {
    if (
      payload.equipo !== undefined ||
      payload.equipo_id !== undefined ||
      payload.equipoId !== undefined
    ) {
      throw new HttpError(403, "No puede reasignar equipos desde este perfil");
    }

    const requestedEstado = payload.estado ? String(payload.estado).trim().toUpperCase() : null;
    if (requestedEstado && requestedEstado !== SOLICITUD_STATUS.ENTREGADO) {
      throw new HttpError(403, "Desde este perfil solo puedes confirmar la recepcion");
    }
    if (
      requestedEstado === SOLICITUD_STATUS.ENTREGADO &&
      current.estado !== SOLICITUD_STATUS.EN_DESPACHO &&
      current.estado !== SOLICITUD_STATUS.ENTREGADO
    ) {
      throw new HttpError(
        409,
        "Solo puedes confirmar la recepcion cuando la solicitud este en despacho"
      );
    }

    if (
      payload.comentario !== undefined &&
      current.estado !== SOLICITUD_STATUS.PENDIENTE &&
      requestedEstado !== SOLICITUD_STATUS.ENTREGADO
    ) {
      throw new HttpError(
        409,
        "Solo puedes actualizar comentarios en pendiente o al confirmar la recepcion"
      );
    }
  }

  const updates = [];
  const params = [];
  let items = null;
  let teamChanged = false;

  if (wantsItemsUpdate) {
    items = normalizeItems(payload);
    for (const item of items) {
      if (item.encargado_id) {
        await assertEncargadoAllowed(actor, current, item.encargado_id);
      }
      if (item.enviado_por_id) {
        await assertSenderAllowed(actor, current, item.enviado_por_id);
      }
      if (item.recepcionado_por_id) {
        await assertReceiverAllowed(actor, current, item.recepcionado_por_id);
      }
    }
    const summary = buildSolicitudSummary(items);
    updates.push("repuesto = ?");
    params.push(summary.repuestoResumen);
    updates.push("cantidad = ?");
    params.push(summary.cantidadResumen);
  }

  if (payload.equipo !== undefined) {
    updates.push("equipo = ?");
    params.push(payload.equipo ? String(payload.equipo) : null);
  }

  if (payload.comentario !== undefined) {
    updates.push("comentario = ?");
    params.push(payload.comentario ? String(payload.comentario) : null);
  }

  if (payload.equipo_id !== undefined || payload.equipoId !== undefined) {
    const equipoId = Number(payload.equipo_id || payload.equipoId || 0);
    if (!equipoId) {
      throw new HttpError(400, "equipo_id invalido");
    }
    const equipoExists = await get("SELECT id, nombre_equipo FROM equipos WHERE id = ?", [equipoId]);
    if (!equipoExists) {
      throw new HttpError(400, "equipo_id no existe");
    }
    updates.push("equipo_id = ?");
    params.push(equipoId);
    updates.push("equipo = ?");
    params.push(equipoExists.nombre_equipo || null);
    teamChanged = Number(current.equipo_id || 0) !== equipoId;
  }

  let estadoNuevo = current.estado;
  const estadoActual = current.estado;
  let stateChanged = false;
  let bulkItemStatus = null;
  let bulkStatusDetail = null;

  if (payload.estado !== undefined) {
    estadoNuevo = String(payload.estado).trim().toUpperCase();
    if (!VALID_STATUS.has(estadoNuevo)) {
      throw new HttpError(400, "Estado invalido");
    }
    if (!actorIsGlobal && !canTransition(estadoActual, estadoNuevo)) {
      throw new HttpError(409, `Transicion no permitida: ${estadoActual} -> ${estadoNuevo}`);
    }

    updates.push("estado = ?");
    params.push(estadoNuevo);
    stateChanged = estadoNuevo !== estadoActual;
    if (stateChanged) {
      if (estadoNuevo === SOLICITUD_STATUS.EN_DESPACHO) {
        bulkItemStatus = SOLICITUD_ITEM_STATUS.ENVIADO;
        bulkStatusDetail = "Toda la solicitud y sus productos se marcaron como en despacho";
      }
      if (estadoNuevo === SOLICITUD_STATUS.ENTREGADO) {
        bulkItemStatus = SOLICITUD_ITEM_STATUS.ENTREGADO;
        bulkStatusDetail = "Toda la solicitud y sus productos se marcaron como entregados";
      }
      applyStatusMetadata(updates, params, estadoNuevo, actor.id);
    }
  }

  if (!updates.length) {
    throw new HttpError(400, "No se enviaron cambios para actualizar");
  }

  await run("BEGIN IMMEDIATE TRANSACTION");
  let refreshResult = null;
  try {
    // Reapertura RECHAZADO → PENDIENTE: verificar que no haya ítems con avance.
    // La trazabilidad no permite reset silencioso de estados de productos.
    if (estadoActual === SOLICITUD_STATUS.RECHAZADO && estadoNuevo === SOLICITUD_STATUS.PENDIENTE) {
      const itemsConAvance = await get(
        `SELECT COUNT(*) AS total
         FROM solicitud_items
         WHERE solicitud_id = ?
           AND estado_item <> ?`,
        [solicitudId, SOLICITUD_ITEM_STATUS.POR_GESTIONAR]
      );
      if (Number(itemsConAvance?.total || 0) > 0) {
        throw new HttpError(
          409,
          `No se puede reabrir la solicitud: ${itemsConAvance.total} producto(s) tienen avance registrado. Corrige los estados de los productos antes de reabrir.`
        );
      }
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    params.push(solicitudId);

    await run(
      `
        UPDATE solicitudes
        SET ${updates.join(", ")}
        WHERE id = ?
      `,
      params
    );

    if (items) {
      await run("DELETE FROM solicitud_items WHERE solicitud_id = ?", [solicitudId]);
      await insertSolicitudItems(solicitudId, items);
    }

    if (bulkItemStatus) {
      await applyMassItemStatusUpdate(solicitudId, bulkItemStatus, actor.id);
    }

    const action = stateChanged ? "ESTADO_ACTUALIZADO" : "SOLICITUD_ACTUALIZADA";
    await run(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        solicitudId,
        action,
        estadoActual,
        estadoNuevo,
        bulkStatusDetail ||
          (payload.comentario
          ? String(payload.comentario)
          : items
            ? "Detalle de solicitud actualizado"
            : "Actualizacion de solicitud"),
        actor.id,
        actorName,
      ]
    );

    if (teamChanged) {
      await run(
        `
          UPDATE notificaciones
          SET equipo_id = ?
          WHERE referencia_id = ? AND tipo LIKE 'SOLICITUD_%'
        `,
        [Number(payload.equipo_id || payload.equipoId), solicitudId]
      );
    }

    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }

  const updated = await getSolicitudById(solicitudId, actor);

  if (stateChanged) {
    await notificacionesService.createSolicitudStatusNotification({
      solicitudId: updated?.id,
      equipoId: updated?.equipo_id,
      equipoNombre: updated?.nombre_equipo || updated?.equipo,
      repuesto: updated?.resumen_items || updated?.repuesto,
      estado: updated?.estado,
    });
  }

  return updated;
}

async function addSolicitudProcessComment(actor, solicitudId, payload = {}) {
  const solicitud = await getSolicitudById(solicitudId, actor);
  if (!solicitud) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  const comentario = String(payload.comentario || "").trim();
  if (!comentario) {
    throw new HttpError(400, "Debes escribir un comentario de proceso");
  }

  const actorRole = getActorRole(actor);
  const actorName = actor.nombre || actor.name || "Sistema";
  const detalle = `${getRoleLabel(actorRole)} en ${getSolicitudStatusLabel(solicitud.estado)}: ${comentario}`;

  const result = await run(
    `
      INSERT INTO solicitud_historial
        (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
      VALUES (?, 'COMENTARIO_PROCESO', ?, ?, ?, ?, ?)
    `,
    [solicitudId, solicitud.estado, solicitud.estado, detalle, actor.id, actorName]
  );

  return {
    id: result.lastID,
    solicitud_id: solicitudId,
    accion: "COMENTARIO_PROCESO",
    estado: solicitud.estado,
    detalle,
    actor_id: actor.id,
    actor_name: actorName,
    created_at: new Date().toISOString(),
    solicitud: await getSolicitudById(solicitudId, actor),
  };
}

async function loadSolicitudItemRecord(solicitudId, itemId) {
  const row = await get(
    `
      SELECT
        si.id,
        si.solicitud_id,
        si.nombre_item,
        si.cantidad,
        si.unidad_medida,
        si.codigo_referencia,
        si.usuario_final,
        si.comentario,
        si.estado_item,
        si.comentario_gestion,
        si.encargado_id,
        si.enviado_por_id,
        si.recepcionado_por_id,
        u.nombre AS encargado_nombre,
        su.nombre AS enviado_por_nombre,
        ru.nombre AS recepcionado_por_nombre,
        si.created_at,
        si.updated_at
      FROM solicitud_items si
      LEFT JOIN usuarios u ON u.id = si.encargado_id
      LEFT JOIN usuarios su ON su.id = si.enviado_por_id
      LEFT JOIN usuarios ru ON ru.id = si.recepcionado_por_id
      WHERE si.solicitud_id = ? AND si.id = ?
    `,
    [solicitudId, itemId]
  );

  return row ? mapSolicitudItemRow(row) : null;
}

async function findSolicitudItemByClientRequestId(clientRequestId) {
  if (!clientRequestId) {
    return null;
  }

  const row = await get(
    `
      SELECT id, solicitud_id
      FROM solicitud_items
      WHERE client_request_id = ?
      LIMIT 1
    `,
    [clientRequestId]
  );

  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    solicitud_id: Number(row.solicitud_id),
  };
}

async function updateSolicitudItem(actor, solicitudId, itemId, payload = {}) {
  const actorRole = getActorRole(actor);
  const solicitud = await getSolicitudById(solicitudId, actor);
  if (!solicitud) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  const currentItem = await loadSolicitudItemRecord(solicitudId, itemId);
  if (!currentItem) {
    throw new HttpError(404, "Item no encontrado en la solicitud");
  }

  const updates = [];
  const params = [];
  const canEditBase = solicitud.estado === SOLICITUD_STATUS.PENDIENTE || isGlobalRole(actorRole);
  const canManageTracking = isGlobalRole(actorRole);
  let estadoNuevo = currentItem.estado_item;
  let encargado = null;
  let sender = null;
  let receiver = null;
  let senderIdFromPayload;
  let receiverIdFromPayload;
  let nombreNuevo = currentItem.nombre_item;
  let cantidadNueva = currentItem.cantidad;
  let unidadMedidaNueva = currentItem.unidad_medida || "";
  let codigoReferenciaNueva = currentItem.codigo_referencia || "";
  let usuarioFinalNuevo = currentItem.usuario_final || "";
  let detalleNuevo = currentItem.comentario || "";

  if (payload.nombre_item !== undefined || payload.nombreItem !== undefined || payload.nombre !== undefined) {
    if (!canEditBase) {
      throw new HttpError(409, "Solo puedes editar el item base mientras la solicitud esta pendiente");
    }
    nombreNuevo = String(payload.nombre_item ?? payload.nombreItem ?? payload.nombre ?? "").trim();
    if (!nombreNuevo) {
      throw new HttpError(400, "nombre_item invalido");
    }
    updates.push("nombre_item = ?");
    params.push(nombreNuevo);
  }

  if (payload.cantidad !== undefined) {
    if (!canEditBase) {
      throw new HttpError(409, "Solo puedes editar el item base mientras la solicitud esta pendiente");
    }
    cantidadNueva = Number(payload.cantidad);
    if (!Number.isInteger(cantidadNueva) || cantidadNueva <= 0) {
      throw new HttpError(400, "cantidad invalida");
    }
    updates.push("cantidad = ?");
    params.push(cantidadNueva);
  }

  if (
    payload.unidad_medida !== undefined ||
    payload.unidadMedida !== undefined ||
    payload.talla !== undefined ||
    payload.unidad !== undefined
  ) {
    if (!canEditBase) {
      throw new HttpError(409, "Solo puedes editar el item base mientras la solicitud esta pendiente");
    }
    unidadMedidaNueva = String(
      payload.unidad_medida ?? payload.unidadMedida ?? payload.talla ?? payload.unidad ?? ""
    ).trim();
    if (!unidadMedidaNueva) {
      throw new HttpError(400, "unidad_medida invalida");
    }
    updates.push("unidad_medida = ?");
    params.push(unidadMedidaNueva);
  }

  if (
    payload.codigo_referencia !== undefined ||
    payload.codigoReferencia !== undefined ||
    payload.codigo !== undefined
  ) {
    if (!canEditBase) {
      throw new HttpError(409, "Solo puedes editar el item base mientras la solicitud esta pendiente");
    }
    codigoReferenciaNueva = String(
      payload.codigo_referencia ?? payload.codigoReferencia ?? payload.codigo ?? ""
    ).trim();
    if (!codigoReferenciaNueva) {
      throw new HttpError(400, "numero de parte invalido");
    }
    updates.push("codigo_referencia = ?");
    params.push(codigoReferenciaNueva);
  }

  if (payload.usuario_final !== undefined || payload.usuarioFinal !== undefined) {
    if (!canEditBase) {
      throw new HttpError(409, "Solo puedes editar el item base mientras la solicitud esta pendiente");
    }
    usuarioFinalNuevo = String(payload.usuario_final ?? payload.usuarioFinal ?? "").trim();
    if (!usuarioFinalNuevo) {
      throw new HttpError(400, "usuario_final invalido");
    }
    updates.push("usuario_final = ?");
    params.push(usuarioFinalNuevo);
  }

  if (payload.comentario !== undefined || payload.detalle !== undefined) {
    if (!canEditBase) {
      throw new HttpError(409, "Solo puedes editar el item base mientras la solicitud esta pendiente");
    }
    detalleNuevo = String(payload.detalle ?? payload.comentario ?? "").trim();
    if (!detalleNuevo) {
      throw new HttpError(400, "detalle invalido");
    }
    updates.push("comentario = ?");
    params.push(detalleNuevo);
  }

  if (payload.estado_item !== undefined || payload.estadoItem !== undefined) {
    if (!canManageTracking) {
      throw new HttpError(403, "Solo ADMIN o SUPERVISOR pueden gestionar el estado por item");
    }
    estadoNuevo = String(payload.estado_item ?? payload.estadoItem)
      .trim()
      .toUpperCase();
    if (!VALID_ITEM_STATUS.has(estadoNuevo)) {
      throw new HttpError(400, "estado_item invalido");
    }
    if (!canTransitionItemStatus(currentItem.estado_item, estadoNuevo)) {
      throw new HttpError(409, "Cambio de estado de item no permitido");
    }
    updates.push("estado_item = ?");
    params.push(estadoNuevo);
  }

  if (payload.comentario_gestion !== undefined || payload.comentarioGestion !== undefined) {
    if (!canManageTracking) {
      throw new HttpError(403, "Solo ADMIN o SUPERVISOR pueden gestionar comentarios por item");
    }
    const comentarioGestion = String(
      payload.comentario_gestion ?? payload.comentarioGestion ?? ""
    ).trim();
    updates.push("comentario_gestion = ?");
    params.push(comentarioGestion || null);
  }

  if (payload.encargado_id !== undefined || payload.encargadoId !== undefined) {
    if (!canManageTracking) {
      throw new HttpError(403, "Solo ADMIN o SUPERVISOR pueden asignar encargado por item");
    }
    const encargadoRaw = payload.encargado_id ?? payload.encargadoId;
    const encargadoId =
      encargadoRaw === null || encargadoRaw === undefined || encargadoRaw === ""
        ? null
        : Number(encargadoRaw);

    if (encargadoId !== null && (!Number.isInteger(encargadoId) || encargadoId <= 0)) {
      throw new HttpError(400, "encargado_id invalido");
    }

    encargado = await assertEncargadoAllowed(actor, solicitud, encargadoId);
    updates.push("encargado_id = ?");
    params.push(encargadoId);
  }

  if (payload.enviado_por_id !== undefined || payload.enviadoPorId !== undefined) {
    if (!canManageTracking) {
      throw new HttpError(403, "Solo ADMIN o SUPERVISOR pueden registrar quien envia el item");
    }
    const senderRaw = payload.enviado_por_id ?? payload.enviadoPorId;
    const senderId =
      senderRaw === null || senderRaw === undefined || senderRaw === "" ? null : Number(senderRaw);
    senderIdFromPayload = senderId;

    if (senderId !== null && (!Number.isInteger(senderId) || senderId <= 0)) {
      throw new HttpError(400, "enviado_por_id invalido");
    }

    sender = await assertSenderAllowed(actor, solicitud, senderId);
    updates.push("enviado_por_id = ?");
    params.push(senderId);
  }

  if (payload.recepcionado_por_id !== undefined || payload.recepcionadoPorId !== undefined) {
    if (!canManageTracking) {
      throw new HttpError(403, "Solo ADMIN o SUPERVISOR pueden registrar quien recepciona el item");
    }
    const receiverRaw = payload.recepcionado_por_id ?? payload.recepcionadoPorId;
    const receiverId =
      receiverRaw === null || receiverRaw === undefined || receiverRaw === ""
        ? null
        : Number(receiverRaw);
    receiverIdFromPayload = receiverId;

    if (receiverId !== null && (!Number.isInteger(receiverId) || receiverId <= 0)) {
      throw new HttpError(400, "recepcionado_por_id invalido");
    }

    receiver = await assertReceiverAllowed(actor, solicitud, receiverId);
    updates.push("recepcionado_por_id = ?");
    params.push(receiverId);
  }

  if (
    canManageTracking &&
    (payload.estado_item !== undefined || payload.estadoItem !== undefined) &&
    estadoNuevo === SOLICITUD_ITEM_STATUS.ENVIADO &&
    payload.enviado_por_id === undefined &&
    payload.enviadoPorId === undefined &&
    !currentItem.enviado_por_id
  ) {
    sender = await assertSenderAllowed(actor, solicitud, Number(actor.id));
    updates.push("enviado_por_id = ?");
    params.push(Number(actor.id));
    senderIdFromPayload = Number(actor.id);
  }

  if (
    canManageTracking &&
    (payload.estado_item !== undefined || payload.estadoItem !== undefined) &&
    estadoNuevo === SOLICITUD_ITEM_STATUS.ENTREGADO &&
    payload.recepcionado_por_id === undefined &&
    payload.recepcionadoPorId === undefined &&
    !currentItem.recepcionado_por_id
  ) {
    receiver = await assertReceiverAllowed(actor, solicitud, Number(actor.id));
    updates.push("recepcionado_por_id = ?");
    params.push(Number(actor.id));
    receiverIdFromPayload = Number(actor.id);
  }

  if (!updates.length) {
    throw new HttpError(400, "No se enviaron cambios para el item");
  }

  await run("BEGIN IMMEDIATE TRANSACTION");
  try {
    updates.push("updated_at = CURRENT_TIMESTAMP");
    params.push(solicitudId, itemId);
    await run(
      `
        UPDATE solicitud_items
        SET ${updates.join(", ")}
        WHERE solicitud_id = ? AND id = ?
      `,
      params
    );

    refreshResult = await refreshSolicitudSummary(solicitudId, {
      actorId: actor.id,
      actorName: actor.nombre || actor.name || "Sistema",
      reason: "El estado general se ajusto segun el avance de los productos",
    });

    const historialDetalle = [
      `Item: ${currentItem.nombre_item}${nombreNuevo !== currentItem.nombre_item ? ` -> ${nombreNuevo}` : ""}`,
      payload.cantidad !== undefined ? `Cantidad: ${currentItem.cantidad} -> ${cantidadNueva}` : null,
      payload.unidad_medida !== undefined ||
      payload.unidadMedida !== undefined ||
      payload.talla !== undefined ||
      payload.unidad !== undefined
        ? `Unidad/Talla: ${unidadMedidaNueva}`
        : null,
      payload.codigo_referencia !== undefined ||
      payload.codigoReferencia !== undefined ||
      payload.codigo !== undefined
        ? `Numero de parte: ${codigoReferenciaNueva}`
        : null,
      payload.usuario_final !== undefined || payload.usuarioFinal !== undefined
        ? `Usuario final: ${usuarioFinalNuevo}`
        : null,
      payload.comentario !== undefined || payload.detalle !== undefined
        ? `Detalle: ${detalleNuevo || "Sin detalle"}`
        : null,
      payload.estado_item !== undefined || payload.estadoItem !== undefined
        ? `Estado: ${currentItem.estado_item} -> ${estadoNuevo}`
        : null,
      payload.encargado_id !== undefined || payload.encargadoId !== undefined
        ? `Encargado: ${encargado?.nombre || "Sin encargado"}`
        : null,
      payload.enviado_por_id !== undefined || payload.enviadoPorId !== undefined
        ? `Enviado por: ${sender?.nombre || "Sin registrar"}`
        : senderIdFromPayload === Number(actor.id)
          ? `Enviado por: ${sender?.nombre || actor.nombre || actor.name || "Sistema"}`
        : null,
      payload.recepcionado_por_id !== undefined || payload.recepcionadoPorId !== undefined
        ? `Recepcionado por: ${receiver?.nombre || "Sin registrar"}`
        : receiverIdFromPayload === Number(actor.id)
          ? `Recepcionado por: ${receiver?.nombre || actor.nombre || actor.name || "Sistema"}`
          : null,
      payload.comentario_gestion !== undefined || payload.comentarioGestion !== undefined
        ? `Comentario de gestion: ${String(payload.comentario_gestion ?? payload.comentarioGestion ?? "").trim() || "Sin comentario"}`
        : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const historialAccion = isItemStatusReversion(currentItem.estado_item, estadoNuevo)
      ? "ESTADO_ITEM_REVERTIDO"
      : "ITEM_ACTUALIZADO";
    await run(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        solicitudId,
        historialAccion,
        solicitud.estado,
        solicitud.estado,
        historialDetalle,
        actor.id,
        actor.nombre || actor.name || "Sistema",
      ]
    );

    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }

  const refreshedSolicitud = await getSolicitudById(solicitudId, actor);
  if (refreshResult?.statusChanged) {
    await notificacionesService.createSolicitudStatusNotification({
      solicitudId: refreshedSolicitud?.id,
      equipoId: refreshedSolicitud?.equipo_id,
      equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo,
      repuesto: refreshedSolicitud?.resumen_items || refreshedSolicitud?.repuesto,
      estado: refreshedSolicitud?.estado,
    });
  }

  return {
    item: await loadSolicitudItemRecord(solicitudId, itemId),
    solicitud: refreshedSolicitud,
  };
}

async function createSolicitudItem(actor, solicitudId, payload = {}) {
  const clientRequestId = normalizeClientRequestId(payload);
  const solicitud = await getSolicitudById(solicitudId, actor);
  if (!solicitud) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  if (solicitud.estado !== SOLICITUD_STATUS.PENDIENTE) {
    throw new HttpError(409, "Solo puedes agregar items mientras la solicitud esta pendiente");
  }

  const item = normalizeSingleItem(payload);
  if (item.encargado_id) {
    await assertEncargadoAllowed(actor, solicitud, item.encargado_id);
  }
  if (item.enviado_por_id) {
    await assertSenderAllowed(actor, solicitud, item.enviado_por_id);
  }
  if (item.recepcionado_por_id) {
    await assertReceiverAllowed(actor, solicitud, item.recepcionado_por_id);
  }

  const matchingItem = await findMatchingSolicitudItem(solicitudId, item);
  if (matchingItem) {
    return {
      item: matchingItem,
      solicitud,
      meta: {
        action: "existing_item_reused",
        itemId: Number(matchingItem.id),
      },
    };
  }

  if (clientRequestId) {
    const existing = await findSolicitudItemByClientRequestId(clientRequestId);
    if (existing) {
      if (Number(existing.solicitud_id) !== Number(solicitudId)) {
        throw new HttpError(409, "client_request_id ya fue utilizado por otro producto");
      }
      console.warn(
        `[FMN] Producto duplicado evitado en solicitud ${solicitudId} con client_request_id=${clientRequestId}`
      );
      return {
        item: await loadSolicitudItemRecord(solicitudId, existing.id),
        solicitud: await getSolicitudById(solicitudId, actor),
      };
    }
  }

  await run("BEGIN IMMEDIATE TRANSACTION");
  let createdId = null;
  let refreshResult = null;
  try {
    const result = await run(
      `
        INSERT INTO solicitud_items (
          solicitud_id,
          client_request_id,
          nombre_item,
          cantidad,
          unidad_medida,
          codigo_referencia,
          usuario_final,
          comentario,
          estado_item,
          comentario_gestion,
          encargado_id,
          enviado_por_id,
          recepcionado_por_id,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [
        solicitudId,
        clientRequestId,
        item.nombre_item,
        item.cantidad,
        item.unidad_medida || null,
        item.codigo_referencia || null,
        item.usuario_final || null,
        item.comentario || null,
        item.estado_item || SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
        item.comentario_gestion || null,
        item.encargado_id || null,
        item.enviado_por_id || null,
        item.recepcionado_por_id || null,
      ]
    );
    createdId = result.lastID;
    refreshResult = await refreshSolicitudSummary(solicitudId, {
      actorId: actor.id,
      actorName: actor.nombre || actor.name || "Sistema",
      reason: "El estado general se ajusto tras agregar un producto",
    });
    await run(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES (?, 'ITEM_CREADO', ?, ?, ?, ?, ?)
      `,
      [
        solicitudId,
        solicitud.estado,
        solicitud.estado,
        `Item agregado: ${item.nombre_item} (${item.cantidad})`,
        actor.id,
        actor.nombre || actor.name || "Sistema",
      ]
    );
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    if (clientRequestId && isSolicitudItemDuplicateRequestError(error)) {
      const existing = await findSolicitudItemByClientRequestId(clientRequestId);
      if (existing && Number(existing.solicitud_id) === Number(solicitudId)) {
        console.warn(
          `[FMN] Producto duplicado evitado por indice unico en solicitud ${solicitudId} con client_request_id=${clientRequestId}`
        );
        return {
          item: await loadSolicitudItemRecord(solicitudId, existing.id),
          solicitud: await getSolicitudById(solicitudId, actor),
        };
      }
    }
    throw error;
  }

  const refreshedSolicitud = await getSolicitudById(solicitudId, actor);
  if (refreshResult?.statusChanged) {
    await notificacionesService.createSolicitudStatusNotification({
      solicitudId: refreshedSolicitud?.id,
      equipoId: refreshedSolicitud?.equipo_id,
      equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo,
      repuesto: refreshedSolicitud?.resumen_items || refreshedSolicitud?.repuesto,
      estado: refreshedSolicitud?.estado,
    });
  }

  return {
    item: await loadSolicitudItemRecord(solicitudId, createdId),
    solicitud: refreshedSolicitud,
  };
}

async function deleteSolicitudItem(actor, solicitudId, itemId) {
  const solicitud = await getSolicitudById(solicitudId, actor);
  if (!solicitud) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  if (solicitud.estado !== SOLICITUD_STATUS.PENDIENTE) {
    throw new HttpError(409, "Solo puedes eliminar items mientras la solicitud esta pendiente");
  }

  const currentItem = await loadSolicitudItemRecord(solicitudId, itemId);
  if (!currentItem) {
    throw new HttpError(404, "Item no encontrado en la solicitud");
  }

  if ((solicitud.items || []).length <= 1) {
    throw new HttpError(409, "La solicitud debe tener al menos un item");
  }

  await run("BEGIN IMMEDIATE TRANSACTION");
  let refreshResult = null;
  try {
    await run("DELETE FROM solicitud_items WHERE solicitud_id = ? AND id = ?", [solicitudId, itemId]);
    refreshResult = await refreshSolicitudSummary(solicitudId, {
      actorId: actor.id,
      actorName: actor.nombre || actor.name || "Sistema",
      reason: "El estado general se ajusto tras eliminar un producto",
    });
    await run(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES (?, 'ITEM_ELIMINADO', ?, ?, ?, ?, ?)
      `,
      [
        solicitudId,
        solicitud.estado,
        solicitud.estado,
        `Item eliminado: ${currentItem.nombre_item}`,
        actor.id,
        actor.nombre || actor.name || "Sistema",
      ]
    );
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }

  const refreshedSolicitud = await getSolicitudById(solicitudId, actor);
  if (refreshResult?.statusChanged) {
    await notificacionesService.createSolicitudStatusNotification({
      solicitudId: refreshedSolicitud?.id,
      equipoId: refreshedSolicitud?.equipo_id,
      equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo,
      repuesto: refreshedSolicitud?.resumen_items || refreshedSolicitud?.repuesto,
      estado: refreshedSolicitud?.estado,
    });
  }

  return {
    id: itemId,
    solicitud_id: solicitudId,
    deleted: true,
    solicitud: refreshedSolicitud,
  };
}

async function createSolicitudMessage(actor, solicitudId, payload = {}) {
  const solicitud = await getSolicitudById(solicitudId, actor);
  if (!solicitud) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  const mensaje = payload.mensaje ? String(payload.mensaje).trim() : "";
  const imagenData = payload.imagen_data ? String(payload.imagen_data).trim() : "";
  const imagenNombre = payload.imagen_nombre ? String(payload.imagen_nombre).trim() : null;
  const destinatarioId = payload.destinatario_id ? Number(payload.destinatario_id) : null;

  if (!mensaje && !imagenData) {
    throw new HttpError(400, "Debes enviar un mensaje o una imagen");
  }

  if (imagenData) {
    if (!imagenData.startsWith("data:image/")) {
      throw new HttpError(400, "Solo se permiten imagenes en formato data URL");
    }
    if (imagenData.length > IMAGE_DATA_LIMIT) {
      throw new HttpError(400, "La imagen es demasiado grande");
    }
  }

  if (destinatarioId) {
    const allowedContacts = await getContactosForSolicitud(actor, solicitud);
    if (!allowedContacts.some((contact) => Number(contact.id) === destinatarioId)) {
      throw new HttpError(403, "No puedes enviar mensajes a ese usuario");
    }
  }

  const result = await run(
    `
      INSERT INTO solicitud_mensajes (
        solicitud_id,
        remitente_id,
        destinatario_id,
        mensaje,
        imagen_nombre,
        imagen_data
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [solicitudId, actor.id, destinatarioId, mensaje || null, imagenNombre, imagenData || null]
  );

  const created = await get(
    `
      SELECT
        sm.id,
        sm.solicitud_id,
        sm.remitente_id,
        ru.nombre AS remitente_nombre,
        sm.destinatario_id,
        du.nombre AS destinatario_nombre,
        sm.mensaje,
        sm.imagen_nombre,
        sm.imagen_data,
        sm.created_at
      FROM solicitud_mensajes sm
      INNER JOIN usuarios ru ON ru.id = sm.remitente_id
      LEFT JOIN usuarios du ON du.id = sm.destinatario_id
      WHERE sm.id = ?
    `,
    [result.lastID]
  );

  await run(
    `
      INSERT INTO solicitud_historial
        (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
      VALUES (?, 'MENSAJE', ?, ?, ?, ?, ?)
    `,
    [
      solicitudId,
      solicitud.estado,
      solicitud.estado,
      mensaje ? `Mensaje interno: ${mensaje.slice(0, 120)}` : "Imagen adjunta enviada",
      actor.id,
      actor.nombre || actor.name || "Sistema",
    ]
  );

  if (destinatarioId) {
    await notificacionesService.createSolicitudMessageNotification({
      solicitudId,
      equipoId: solicitud.equipo_id,
      remitenteNombre: actor.nombre || actor.name,
      destinatarioId,
      mensaje,
    });
  } else if (!isGlobalRole(getActorRole(actor))) {
    await notificacionesService.createSolicitudMessageNotification({
      solicitudId,
      equipoId: solicitud.equipo_id,
      remitenteNombre: actor.nombre || actor.name,
      destinatarioRol: "JEFE_FAENA",
      mensaje,
    });
    await notificacionesService.createSolicitudMessageNotification({
      solicitudId,
      equipoId: solicitud.equipo_id,
      remitenteNombre: actor.nombre || actor.name,
      destinatarioRol: "SUPERVISOR",
      mensaje,
    });
  }

  return created;
}

async function removeSolicitudMessageImage(actor, solicitudId, mensajeId) {
  const solicitud = await getSolicitudById(solicitudId, actor);
  if (!solicitud) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  const message = await get(
    `
      SELECT id, solicitud_id, remitente_id, imagen_data
      FROM solicitud_mensajes
      WHERE id = ? AND solicitud_id = ?
    `,
    [mensajeId, solicitudId]
  );

  if (!message) {
    throw new HttpError(404, "Mensaje no encontrado");
  }

  if (!message.imagen_data) {
    throw new HttpError(409, "El mensaje no tiene imagen para quitar");
  }

  const actorRole = getActorRole(actor);
  const canManage = ["ADMIN", "SUPERVISOR"].includes(actorRole);
  if (!canManage && Number(message.remitente_id) !== Number(actor.id)) {
    throw new HttpError(403, "No puedes quitar la imagen de otro usuario");
  }

  await run(
    `
      UPDATE solicitud_mensajes
      SET imagen_data = NULL, imagen_nombre = NULL
      WHERE id = ? AND solicitud_id = ?
    `,
    [mensajeId, solicitudId]
  );

  await run(
    `
      INSERT INTO solicitud_historial
        (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
      VALUES (?, 'IMAGEN_ELIMINADA', ?, ?, ?, ?, ?)
    `,
    [
      solicitudId,
      solicitud.estado,
      solicitud.estado,
      "Se elimino una imagen del chat de la solicitud",
      actor.id,
      actor.nombre || actor.name || "Sistema",
    ]
  );

  return {
    id: mensajeId,
    solicitud_id: solicitudId,
    imagen_eliminada: true,
  };
}

async function deleteSolicitud(actor, solicitudId) {
  const existing = await getSolicitudById(solicitudId, actor);
  if (!existing) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  await run("BEGIN IMMEDIATE TRANSACTION");
  try {
    await run("DELETE FROM solicitud_mensajes WHERE solicitud_id = ?", [solicitudId]);
    await run("DELETE FROM solicitud_items WHERE solicitud_id = ?", [solicitudId]);
    await run("DELETE FROM solicitud_historial WHERE solicitud_id = ?", [solicitudId]);
    await run("DELETE FROM solicitudes WHERE id = ?", [solicitudId]);
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }

  return {
    id: solicitudId,
    deleted_by: actor.nombre || actor.name || "Sistema",
    deleted_at: new Date().toISOString(),
  };
}

async function listPendingItems(actor) {
  const role = actor.rol || actor.role;
  const params = [SOLICITUD_ITEM_STATUS.POR_GESTIONAR];
  let query = `
    SELECT
      si.id AS item_id,
      si.solicitud_id,
      si.nombre_item,
      si.cantidad,
      si.unidad_medida,
      si.codigo_referencia,
      si.comentario,
      si.usuario_final,
      s.repuesto AS solicitud_resumen,
      s.equipo AS solicitud_equipo,
      s.equipo_id,
      s.estado AS solicitud_estado,
      s.created_at AS solicitud_created_at,
      su.nombre AS solicitante_nombre
    FROM solicitud_items si
    INNER JOIN solicitudes s ON s.id = si.solicitud_id
    INNER JOIN usuarios su ON su.id = s.solicitante_id
    WHERE si.estado_item = ?
      AND s.estado NOT IN ('ENTREGADO', 'RECHAZADO')
  `;
  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    query += ` AND s.equipo_id = ?`;
    params.push(Number(actor.equipo_id));
  }
  query += ` ORDER BY s.id ASC, si.id ASC`;
  return all(query, params);
}

module.exports = {
  listSolicitudes: (...args) =>
    isOperationalPgEnabled() ? pgService.listSolicitudes(...args) : listSolicitudes(...args),
  listSolicitudesForExport: (...args) =>
    isOperationalPgEnabled()
      ? pgService.listSolicitudesForExport(...args)
      : listSolicitudesForExport(...args),
  getSolicitudDetail: (...args) =>
    isOperationalPgEnabled() ? pgService.getSolicitudDetail(...args) : getSolicitudDetail(...args),
  createSolicitud: (...args) =>
    isOperationalPgEnabled() ? pgService.createSolicitud(...args) : createSolicitud(...args),
  updateSolicitud: (...args) =>
    isOperationalPgEnabled() ? pgService.updateSolicitud(...args) : updateSolicitud(...args),
  addSolicitudProcessComment: (...args) =>
    isOperationalPgEnabled()
      ? pgService.addSolicitudProcessComment(...args)
      : addSolicitudProcessComment(...args),
  createSolicitudItem: (...args) =>
    isOperationalPgEnabled() ? pgService.createSolicitudItem(...args) : createSolicitudItem(...args),
  updateSolicitudItem: (...args) =>
    isOperationalPgEnabled() ? pgService.updateSolicitudItem(...args) : updateSolicitudItem(...args),
  deleteSolicitudItem: (...args) =>
    isOperationalPgEnabled() ? pgService.deleteSolicitudItem(...args) : deleteSolicitudItem(...args),
  createSolicitudMessage: (...args) =>
    isOperationalPgEnabled()
      ? pgService.createSolicitudMessage(...args)
      : createSolicitudMessage(...args),
  removeSolicitudMessageImage: (...args) =>
    isOperationalPgEnabled()
      ? pgService.removeSolicitudMessageImage(...args)
      : removeSolicitudMessageImage(...args),
  deleteSolicitud: (...args) =>
    isOperationalPgEnabled() ? pgService.deleteSolicitud(...args) : deleteSolicitud(...args),
  listPendingItems: (...args) =>
    isOperationalPgEnabled() ? pgService.listPendingItems(...args) : listPendingItems(...args),
};
