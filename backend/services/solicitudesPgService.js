const { get } = require("../db/database");
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
const {
  getOperationalPool,
  loadEquiposMap,
  loadUsersMap,
} = require("./operationalPgStore");
const { listUsers } = require("./userStore");
const notificacionesService = require("./notificacionesService");

const VALID_STATUS = new Set(Object.values(SOLICITUD_STATUS));
const VALID_ITEM_STATUS = new Set(SOLICITUD_ITEM_STATUS_LIST);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IMAGE_DATA_LIMIT = 3_500_000;

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
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    conditions.push(`${alias}.equipo_id = ${push(Number(actor.equipo_id))}`);
  }

  if (normalized.equipoId) {
    conditions.push(`${alias}.equipo_id = ${push(normalized.equipoId)}`);
  }

  if (normalized.estado) {
    conditions.push(`${alias}.estado = ${push(normalized.estado)}`);
  }

  if (normalized.fechaDesde) {
    const bounds = getChileDayBounds(normalized.fechaDesde);
    conditions.push(`${alias}.created_at >= ${push(bounds.startUtcSql)}`);
  }

  if (normalized.fechaHasta) {
    const bounds = getChileDayBounds(normalized.fechaHasta);
    conditions.push(`${alias}.created_at < ${push(bounds.endUtcSql)}`);
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

function buildItemStatusSummary(items = []) {
  const baseSummary = {
    total_items: items.length,
    total: 0,
    por_gestionar: 0,
    gestionados: 0,
    enviados: 0,
    entregados: 0,
    no_aplica: 0,
  };

  if (!items.length) {
    return baseSummary;
  }

  for (const item of items) {
    const status = String(item.estado_item || SOLICITUD_ITEM_STATUS.POR_GESTIONAR).toUpperCase();
    if (status === SOLICITUD_ITEM_STATUS.NO_APLICA) {
      baseSummary.no_aplica += 1;
      continue;
    }

    baseSummary.total += 1;

    if (status === SOLICITUD_ITEM_STATUS.POR_GESTIONAR) {
      baseSummary.por_gestionar += 1;
    }
    if (status === SOLICITUD_ITEM_STATUS.GESTIONADO) {
      baseSummary.gestionados += 1;
    }
    if (status === SOLICITUD_ITEM_STATUS.ENVIADO) {
      baseSummary.enviados += 1;
    }
    if (status === SOLICITUD_ITEM_STATUS.ENTREGADO) {
      baseSummary.entregados += 1;
    }
  }

  return baseSummary;
}

function buildItemStatusText(summary = {}) {
  const parts = [];

  if (Number(summary.por_gestionar || 0) > 0) {
    parts.push(`${summary.por_gestionar} por gestionar`);
  }
  if (Number(summary.gestionados || 0) > 0) {
    parts.push(`${summary.gestionados} gestionado(s)`);
  }
  if (Number(summary.enviados || 0) > 0) {
    parts.push(`${summary.enviados} enviado(s)`);
  }
  if (Number(summary.entregados || 0) > 0) {
    parts.push(`${summary.entregados} entregado(s)`);
  }
  if (Number(summary.no_aplica || 0) > 0) {
    parts.push(`${summary.no_aplica} N/A`);
  }

  return parts.join(" | ");
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

function mapSolicitudItemRow(row, usersMap) {
  const encargadoId =
    row.encargado_id === null || row.encargado_id === undefined ? null : Number(row.encargado_id);
  const enviadoPorId =
    row.enviado_por_id === null || row.enviado_por_id === undefined ? null : Number(row.enviado_por_id);
  const recepcionadoPorId =
    row.recepcionado_por_id === null || row.recepcionado_por_id === undefined
      ? null
      : Number(row.recepcionado_por_id);

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
    encargado_id: encargadoId,
    encargado_nombre: encargadoId ? usersMap.get(encargadoId)?.nombre || null : null,
    enviado_por_id: enviadoPorId,
    enviado_por_nombre: enviadoPorId ? usersMap.get(enviadoPorId)?.nombre || null : null,
    recepcionado_por_id: recepcionadoPorId,
    recepcionado_por_nombre:
      recepcionadoPorId ? usersMap.get(recepcionadoPorId)?.nombre || null : null,
    updated_at: row.updated_at || null,
  };
}

function pushValue(params, value) {
  params.push(value);
  return `$${params.length}`;
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
    updates.push("reviewed_at = NOW()");
    updates.push(`reviewed_by = ${pushValue(params, actorId)}`);
    updates.push("dispatched_at = NULL");
    updates.push("dispatched_by = NULL");
    updates.push("received_at = NULL");
    updates.push("received_by = NULL");
    return;
  }

  if (estadoNuevo === SOLICITUD_STATUS.EN_DESPACHO) {
    updates.push("reviewed_at = NOW()");
    updates.push(`reviewed_by = ${pushValue(params, actorId)}`);
    updates.push("dispatched_at = NOW()");
    updates.push(`dispatched_by = ${pushValue(params, actorId)}`);
    updates.push("received_at = NULL");
    updates.push("received_by = NULL");
    return;
  }

  if (estadoNuevo === SOLICITUD_STATUS.ENTREGADO) {
    updates.push("reviewed_at = NOW()");
    updates.push(`reviewed_by = ${pushValue(params, actorId)}`);
    updates.push("dispatched_at = NOW()");
    updates.push(`dispatched_by = ${pushValue(params, actorId)}`);
    updates.push("received_at = NOW()");
    updates.push(`received_by = ${pushValue(params, actorId)}`);
    return;
  }

  if (estadoNuevo === SOLICITUD_STATUS.RECHAZADO) {
    updates.push("reviewed_at = NOW()");
    updates.push(`reviewed_by = ${pushValue(params, actorId)}`);
    updates.push("dispatched_at = NULL");
    updates.push("dispatched_by = NULL");
    updates.push("received_at = NULL");
    updates.push("received_by = NULL");
  }
}

async function ensureEquipoExists(equipoId) {
  const equipo = await get("SELECT id, nombre_equipo FROM equipos WHERE id = ?", [Number(equipoId)]);
  if (!equipo) {
    throw new HttpError(400, "equipo_id no existe");
  }
  return {
    id: Number(equipo.id),
    nombre_equipo: equipo.nombre_equipo,
  };
}

async function getHistorialBySolicitudId(solicitudId) {
  const pg = getOperationalPool();
  const { rows } = await pg.query(
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
      WHERE solicitud_id = $1
      ORDER BY id ASC
    `,
    [Number(solicitudId)]
  );
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    actor_id: Number(row.actor_id),
  }));
}

async function getSolicitudItemsBySolicitudId(solicitudId) {
  const pg = getOperationalPool();
  const usersMap = await loadUsersMap();
  const { rows } = await pg.query(
    `
      SELECT
        id,
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
        created_at,
        updated_at
      FROM solicitud_items
      WHERE solicitud_id = $1
      ORDER BY id ASC
    `,
    [Number(solicitudId)]
  );

  return rows.map((row) => mapSolicitudItemRow(row, usersMap));
}

async function getSolicitudItemsBySolicitudIds(solicitudIds = []) {
  if (!solicitudIds.length) {
    return new Map();
  }

  const pg = getOperationalPool();
  const usersMap = await loadUsersMap();
  const { rows } = await pg.query(
    `
      SELECT
        id,
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
        created_at,
        updated_at
      FROM solicitud_items
      WHERE solicitud_id = ANY($1::int[])
      ORDER BY solicitud_id ASC, id ASC
    `,
    [solicitudIds.map((value) => Number(value))]
  );

  const grouped = new Map();
  for (const row of rows) {
    const bucket = grouped.get(Number(row.solicitud_id)) || [];
    bucket.push(mapSolicitudItemRow(row, usersMap));
    grouped.set(Number(row.solicitud_id), bucket);
  }

  return grouped;
}

async function getSolicitudMensajesBySolicitudId(solicitudId) {
  const pg = getOperationalPool();
  const usersMap = await loadUsersMap();
  const { rows } = await pg.query(
    `
      SELECT
        id,
        solicitud_id,
        remitente_id,
        destinatario_id,
        mensaje,
        imagen_nombre,
        imagen_data,
        created_at
      FROM solicitud_mensajes
      WHERE solicitud_id = $1
      ORDER BY id ASC
    `,
    [Number(solicitudId)]
  );

  return rows.map((row) => ({
    id: Number(row.id),
    solicitud_id: Number(row.solicitud_id),
    remitente_id: Number(row.remitente_id),
    remitente_nombre: usersMap.get(Number(row.remitente_id))?.nombre || "Usuario",
    destinatario_id:
      row.destinatario_id === null || row.destinatario_id === undefined ? null : Number(row.destinatario_id),
    destinatario_nombre:
      row.destinatario_id === null || row.destinatario_id === undefined
        ? null
        : usersMap.get(Number(row.destinatario_id))?.nombre || null,
    mensaje: row.mensaje,
    imagen_nombre: row.imagen_nombre || null,
    imagen_data: row.imagen_data || null,
    created_at: row.created_at,
  }));
}

async function getContactosForSolicitud(actor, solicitud, options = {}) {
  const includeSelf = options.includeSelf === true;
  const actorRole = getActorRole(actor);
  const users = await listUsers({ estado: "activos" });

  return users
    .filter((user) => includeSelf || Number(user.id) !== Number(actor.id))
    .filter((user) => {
      if (isGlobalRole(actorRole)) {
        return Number(user.equipo_id) === Number(solicitud.equipo_id) || ["ADMIN", "SUPERVISOR"].includes(user.rol);
      }

      return Number(user.equipo_id) === Number(actor.equipo_id) || ["ADMIN", "SUPERVISOR"].includes(user.rol);
    })
    .sort((a, b) => {
      const rank = {
        JEFE_FAENA: 1,
        SUPERVISOR: 2,
        ADMIN: 3,
        MECANICO: 4,
        OPERADOR: 5,
      };
      const aRank = rank[a.rol] || 99;
      const bRank = rank[b.rol] || 99;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return String(a.nombre).localeCompare(String(b.nombre));
    })
    .map((row) => ({
      id: Number(row.id),
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

async function decorateSolicitudes(rows) {
  const usersMap = await loadUsersMap();
  const equiposMap = await loadEquiposMap();
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    solicitante_id: Number(row.solicitante_id),
    equipo_id: row.equipo_id === null || row.equipo_id === undefined ? null : Number(row.equipo_id),
    cantidad: Number(row.cantidad),
    reviewed_by: row.reviewed_by === null || row.reviewed_by === undefined ? null : Number(row.reviewed_by),
    dispatched_by: row.dispatched_by === null || row.dispatched_by === undefined ? null : Number(row.dispatched_by),
    received_by: row.received_by === null || row.received_by === undefined ? null : Number(row.received_by),
    solicitante_name: usersMap.get(Number(row.solicitante_id))?.nombre || "Usuario",
    nombre_equipo:
      row.equipo_id === null || row.equipo_id === undefined ? null : equiposMap.get(Number(row.equipo_id)) || null,
    reviewed_by_name:
      row.reviewed_by === null || row.reviewed_by === undefined
        ? null
        : usersMap.get(Number(row.reviewed_by))?.nombre || null,
    dispatched_by_name:
      row.dispatched_by === null || row.dispatched_by === undefined
        ? null
        : usersMap.get(Number(row.dispatched_by))?.nombre || null,
    received_by_name:
      row.received_by === null || row.received_by === undefined
        ? null
        : usersMap.get(Number(row.received_by))?.nombre || null,
  }));
}

async function loadSolicitudRecord(solicitudId, client = null) {
  const executor = client || getOperationalPool();
  const { rows } = await executor.query(
    `
      SELECT
        id,
        solicitante_id,
        equipo,
        equipo_id,
        repuesto,
        cantidad,
        comentario,
        estado,
        reviewed_at,
        reviewed_by,
        dispatched_at,
        dispatched_by,
        received_at,
        received_by,
        created_at,
        updated_at
      FROM solicitudes
      WHERE id = $1
    `,
    [Number(solicitudId)]
  );

  const [solicitud] = await decorateSolicitudes(rows);
  return solicitud || null;
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
  const itemStatusSummary = buildItemStatusSummary(items);

  return {
    ...solicitud,
    items,
    historial,
    mensajes,
    total_items: summary.totalItems,
    total_unidades: summary.totalUnidades,
    resumen_items: summary.repuestoResumen,
    item_status_summary: itemStatusSummary,
    item_status_text: buildItemStatusText(itemStatusSummary),
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
  const pg = getOperationalPool();
  const limit = Math.min(100, Math.max(10, Number(filters.limit) || 50));
  const page  = Math.max(1, Number(filters.page) || 1);
  const offset = (page - 1) * limit;

  const { rows: countRows } = await pg.query(
    `SELECT COUNT(*)::int AS total FROM solicitudes s ${scope.where}`,
    scope.params
  );
  const total = Number(countRows[0]?.total || 0);

  const { rows } = await pg.query(
    `
      SELECT
        id, solicitante_id, equipo, equipo_id, repuesto, cantidad,
        comentario, estado, reviewed_at, reviewed_by,
        dispatched_at, dispatched_by, received_at, received_by,
        created_at, updated_at
      FROM solicitudes s
      ${scope.where}
      ORDER BY s.id DESC
      LIMIT $${scope.params.length + 1} OFFSET $${scope.params.length + 2}
    `,
    [...scope.params, limit, offset]
  );

  if (!rows.length) {
    return { data: [], total, page, pages: Math.ceil(total / limit) };
  }

  const decoratedRows = await decorateSolicitudes(rows);
  const itemsBySolicitudId = await getSolicitudItemsBySolicitudIds(rows.map((row) => row.id));

  const data = decoratedRows.map((row) => {
    const items = itemsBySolicitudId.get(Number(row.id)) || [];
    const summary = items.length
      ? buildSolicitudSummary(items)
      : { totalItems: row.repuesto ? 1 : 0, totalUnidades: Number(row.cantidad || 0), repuestoResumen: row.repuesto || "Solicitud" };
    const itemStatusSummary = items.length
      ? buildItemStatusSummary(items)
      : buildItemStatusSummary(summary.totalItems ? [{ estado_item: SOLICITUD_ITEM_STATUS.POR_GESTIONAR }] : []);
    return {
      ...row,
      total_items: summary.totalItems,
      total_unidades: summary.totalUnidades,
      resumen_items: summary.repuestoResumen,
      item_status_summary: itemStatusSummary,
      item_status_text: buildItemStatusText(itemStatusSummary),
    };
  });

  return { data, total, page, pages: Math.ceil(total / limit) };
}

async function listSolicitudesForExport(actor, filters = {}) {
  const baseRows = await listSolicitudes(actor, filters);
  if (!baseRows.length) return [];

  const solicitudIds = baseRows.map((r) => Number(r.id));
  const itemsMap = await getSolicitudItemsBySolicitudIds(solicitudIds);

  return baseRows.map((row) => ({
    id: row.id,
    equipo: row.nombre_equipo || "Sin equipo",
    repuesto: row.resumen_items || row.repuesto || "",
    cantidad: row.total_unidades || row.cantidad || 0,
    total_items: row.total_items || 0,
    estado: row.estado,
    solicitante: row.solicitante_name || "Usuario",
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
    dispatched_at: row.dispatched_at,
    received_at: row.received_at,
    updated_at: row.updated_at,
    comentario: row.comentario,
    items: itemsMap.get(Number(row.id)) || [],
  }));
}

async function resolveEquipoForCreation(actor, payload) {
  const role = getActorRole(actor);

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    return Number(actor.equipo_id);
  }

  const payloadEquipoId = Number(payload.equipo_id || payload.equipoId || 0);
  if (!payloadEquipoId) {
    throw new HttpError(400, "Para ADMIN/SUPERVISOR debes indicar equipo_id");
  }

  const equipo = await ensureEquipoExists(payloadEquipoId);
  return equipo.id;
}

async function insertSolicitudItems(client, solicitudId, items) {
  for (const item of items) {
    await client.query(
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      `,
      [
        Number(solicitudId),
        item.nombre_item,
        Number(item.cantidad),
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

async function loadSolicitudItemsForSummary(client, solicitudId) {
  const { rows } = await client.query(
    `
      SELECT nombre_item, cantidad, estado_item
      FROM solicitud_items
      WHERE solicitud_id = $1
      ORDER BY id ASC
    `,
    [Number(solicitudId)]
  );

  return rows.map((row) => ({
    nombre_item: row.nombre_item,
    cantidad: Number(row.cantidad),
    estado_item: row.estado_item || SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
  }));
}

async function refreshSolicitudSummary(client, solicitudId, options = {}) {
  const items = await loadSolicitudItemsForSummary(client, solicitudId);
  if (!items.length) {
    throw new HttpError(409, "La solicitud debe mantener al menos un item");
  }

  const currentSolicitudResult = await client.query(
    `
      SELECT id, estado
      FROM solicitudes
      WHERE id = $1
    `,
    [Number(solicitudId)]
  );
  const currentSolicitud = currentSolicitudResult.rows[0] || null;
  if (!currentSolicitud) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  const summary = buildSolicitudSummary(items);
  const itemStatusSummary = buildItemStatusSummary(items);
  const nextStatus =
    options.forceStatus ||
    deriveSolicitudStatusFromItemSummary(itemStatusSummary, currentSolicitud.estado);
  const statusChanged = nextStatus !== currentSolicitud.estado;

  const params = [summary.repuestoResumen, summary.cantidadResumen];
  const updates = ["repuesto = $1", "cantidad = $2", "updated_at = NOW()"];

  if (statusChanged) {
    params.push(nextStatus);
    updates.push(`estado = $${params.length}`);
    applyStatusMetadata(updates, params, nextStatus, options.actorId || null);
  }

  await client.query(
    `
      UPDATE solicitudes
      SET ${updates.join(", ")}
      WHERE id = $${params.length + 1}
    `,
    [...params, Number(solicitudId)]
  );

  if (statusChanged && options.actorId && options.actorName) {
    await client.query(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES ($1, 'ESTADO_AUTO_POR_PRODUCTOS', $2, $3, $4, $5, $6)
      `,
      [
        Number(solicitudId),
        currentSolicitud.estado,
        nextStatus,
        options.reason || "El estado general se ajusto segun el avance de los productos",
        Number(options.actorId),
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

async function applyMassItemStatusUpdate(client, solicitudId, estadoItem, actorId) {
  const normalizedStatus = String(estadoItem || "").trim().toUpperCase();
  if (!VALID_ITEM_STATUS.has(normalizedStatus)) {
    throw new HttpError(400, "estado_item invalido");
  }

  if (normalizedStatus === SOLICITUD_ITEM_STATUS.ENVIADO) {
    await client.query(
      `
        UPDATE solicitud_items
        SET
          estado_item = $1,
          enviado_por_id = COALESCE(enviado_por_id, $2),
          updated_at = NOW()
        WHERE solicitud_id = $3
          AND estado_item <> $4
      `,
      [SOLICITUD_ITEM_STATUS.ENVIADO, Number(actorId), Number(solicitudId), SOLICITUD_ITEM_STATUS.ENTREGADO]
    );
    return;
  }

  if (normalizedStatus === SOLICITUD_ITEM_STATUS.ENTREGADO) {
    await client.query(
      `
        UPDATE solicitud_items
        SET
          estado_item = $1,
          enviado_por_id = COALESCE(enviado_por_id, $2),
          recepcionado_por_id = COALESCE(recepcionado_por_id, $3),
          updated_at = NOW()
        WHERE solicitud_id = $4
      `,
      [SOLICITUD_ITEM_STATUS.ENTREGADO, Number(actorId), Number(actorId), Number(solicitudId)]
    );
  }
}

async function createSolicitud(actor, payload) {
  const actorName = actor.nombre || actor.name || "Sistema";
  const items = normalizeItems(payload);
  const equipoId = await resolveEquipoForCreation(actor, payload);
  const equipo = await ensureEquipoExists(equipoId);
  const solicitudContext = { equipo_id: equipo.id, equipo: equipo.nombre_equipo };
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
  const pg = getOperationalPool();
  const client = await pg.connect();
  let solicitudId = null;

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `
        INSERT INTO solicitudes
          (solicitante_id, equipo, equipo_id, repuesto, cantidad, comentario, estado, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING id
      `,
      [
        Number(actor.id),
        payload.equipo ? String(payload.equipo) : equipo.nombre_equipo,
        Number(equipoId),
        summary.repuestoResumen,
        summary.cantidadResumen,
        comentarioGeneral,
        SOLICITUD_STATUS.PENDIENTE,
      ]
    );

    solicitudId = Number(rows[0].id);
    await insertSolicitudItems(client, solicitudId, items);

    await client.query(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES ($1, 'CREADA', NULL, $2, $3, $4, $5)
      `,
      [
        solicitudId,
        SOLICITUD_STATUS.PENDIENTE,
        comentarioGeneral || `Solicitud creada con ${summary.totalItems} item(s)`,
        Number(actor.id),
        actorName,
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
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
    if (payload.equipo !== undefined || payload.equipo_id !== undefined || payload.equipoId !== undefined) {
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
      throw new HttpError(409, "Solo puedes confirmar la recepcion cuando la solicitud este en despacho");
    }

    if (
      payload.comentario !== undefined &&
      current.estado !== SOLICITUD_STATUS.PENDIENTE &&
      requestedEstado !== SOLICITUD_STATUS.ENTREGADO
    ) {
      throw new HttpError(409, "Solo puedes actualizar comentarios en pendiente o al confirmar la recepcion");
    }
  }

  const updates = [];
  const params = [];
  let items = null;
  let teamChanged = false;
  let nextEquipoId = Number(current.equipo_id || 0) || null;

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
    updates.push(`repuesto = ${pushValue(params, summary.repuestoResumen)}`);
    updates.push(`cantidad = ${pushValue(params, summary.cantidadResumen)}`);
  }

  if (payload.equipo !== undefined) {
    updates.push(`equipo = ${pushValue(params, payload.equipo ? String(payload.equipo) : null)}`);
  }

  if (payload.comentario !== undefined) {
    updates.push(`comentario = ${pushValue(params, payload.comentario ? String(payload.comentario) : null)}`);
  }

  if (payload.equipo_id !== undefined || payload.equipoId !== undefined) {
    const equipoId = Number(payload.equipo_id || payload.equipoId || 0);
    if (!equipoId) {
      throw new HttpError(400, "equipo_id invalido");
    }
    const equipo = await ensureEquipoExists(equipoId);
    updates.push(`equipo_id = ${pushValue(params, equipoId)}`);
    updates.push(`equipo = ${pushValue(params, equipo.nombre_equipo || null)}`);
    teamChanged = Number(current.equipo_id || 0) !== equipoId;
    nextEquipoId = equipoId;
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

    updates.push(`estado = ${pushValue(params, estadoNuevo)}`);
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
      applyStatusMetadata(updates, params, estadoNuevo, Number(actor.id));
    }
  }

  if (!updates.length) {
    throw new HttpError(400, "No se enviaron cambios para actualizar");
  }

  const pg = getOperationalPool();
  const client = await pg.connect();
  let refreshResult = null;
  try {
    await client.query("BEGIN");

    // Reapertura RECHAZADO → PENDIENTE: verificar que no haya ítems con avance.
    // La trazabilidad no permite reset silencioso de estados de productos.
    if (estadoActual === SOLICITUD_STATUS.RECHAZADO && estadoNuevo === SOLICITUD_STATUS.PENDIENTE) {
      const itemsResult = await client.query(
        `SELECT COUNT(*) AS total
         FROM solicitud_items
         WHERE solicitud_id = $1
           AND estado_item <> $2`,
        [Number(solicitudId), SOLICITUD_ITEM_STATUS.POR_GESTIONAR]
      );
      const itemsConAvance = Number(itemsResult.rows[0]?.total || 0);
      if (itemsConAvance > 0) {
        throw new HttpError(
          409,
          `No se puede reabrir la solicitud: ${itemsConAvance} producto(s) tienen avance registrado. Corrige los estados de los productos antes de reabrir.`
        );
      }
    }

    updates.push("updated_at = NOW()");
    const idRef = pushValue(params, Number(solicitudId));

    await client.query(
      `
        UPDATE solicitudes
        SET ${updates.join(", ")}
        WHERE id = ${idRef}
      `,
      params
    );

    if (items) {
      await client.query("DELETE FROM solicitud_items WHERE solicitud_id = $1", [Number(solicitudId)]);
      await insertSolicitudItems(client, solicitudId, items);
    }

    if (bulkItemStatus) {
      await applyMassItemStatusUpdate(client, solicitudId, bulkItemStatus, actor.id);
    }

    const action = stateChanged ? "ESTADO_ACTUALIZADO" : "SOLICITUD_ACTUALIZADA";
    await client.query(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        Number(solicitudId),
        action,
        estadoActual,
        estadoNuevo,
        bulkStatusDetail ||
          (payload.comentario
          ? String(payload.comentario)
          : items
            ? "Detalle de solicitud actualizado"
            : "Actualizacion de solicitud"),
        Number(actor.id),
        actorName,
      ]
    );

    if (teamChanged) {
      await client.query(
        `
          UPDATE notificaciones
          SET equipo_id = $1
          WHERE referencia_id = $2 AND tipo LIKE 'SOLICITUD_%'
        `,
        [nextEquipoId, Number(solicitudId)]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updated = await getSolicitudById(solicitudId, actor);

  if (stateChanged) {
    await notificacionesService.createSolicitudStatusNotification({
      solicitudId: updated?.id,
      equipoId: updated?.equipo_id,
      equipoNombre: updated?.nombre_equipo || updated?.equipo,
      repuesto: updated?.resumen_items || updated?.repuesto,
      estado: updated?.estado,
      solicitanteId: updated?.solicitante_id,
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
  const pg = getOperationalPool();

  const { rows } = await pg.query(
    `
      INSERT INTO solicitud_historial
        (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
      VALUES ($1, 'COMENTARIO_PROCESO', $2, $3, $4, $5, $6)
      RETURNING id, created_at
    `,
    [
      Number(solicitudId),
      solicitud.estado,
      solicitud.estado,
      detalle,
      Number(actor.id),
      actorName,
    ]
  );

  const inserted = rows[0] || {};

  return {
    id: inserted.id ? Number(inserted.id) : null,
    solicitud_id: Number(solicitudId),
    accion: "COMENTARIO_PROCESO",
    estado: solicitud.estado,
    detalle,
    actor_id: Number(actor.id),
    actor_name: actorName,
    created_at: inserted.created_at || new Date().toISOString(),
    solicitud: await getSolicitudById(solicitudId, actor),
  };
}

async function loadSolicitudItemRecord(solicitudId, itemId, client = null) {
  const executor = client || getOperationalPool();
  const usersMap = await loadUsersMap();
  const { rows } = await executor.query(
    `
      SELECT
        id,
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
        created_at,
        updated_at
      FROM solicitud_items
      WHERE solicitud_id = $1 AND id = $2
    `,
    [Number(solicitudId), Number(itemId)]
  );

  const [item] = rows.map((row) => mapSolicitudItemRow(row, usersMap));
  return item || null;
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
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
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
    updates.push(`nombre_item = ${push(nombreNuevo)}`);
  }

  if (payload.cantidad !== undefined) {
    if (!canEditBase) {
      throw new HttpError(409, "Solo puedes editar el item base mientras la solicitud esta pendiente");
    }
    cantidadNueva = Number(payload.cantidad);
    if (!Number.isInteger(cantidadNueva) || cantidadNueva <= 0) {
      throw new HttpError(400, "cantidad invalida");
    }
    updates.push(`cantidad = ${push(cantidadNueva)}`);
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
    updates.push(`unidad_medida = ${push(unidadMedidaNueva)}`);
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
    updates.push(`codigo_referencia = ${push(codigoReferenciaNueva)}`);
  }

  if (payload.usuario_final !== undefined || payload.usuarioFinal !== undefined) {
    if (!canEditBase) {
      throw new HttpError(409, "Solo puedes editar el item base mientras la solicitud esta pendiente");
    }
    usuarioFinalNuevo = String(payload.usuario_final ?? payload.usuarioFinal ?? "").trim();
    if (!usuarioFinalNuevo) {
      throw new HttpError(400, "usuario_final invalido");
    }
    updates.push(`usuario_final = ${push(usuarioFinalNuevo)}`);
  }

  if (payload.comentario !== undefined || payload.detalle !== undefined) {
    if (!canEditBase) {
      throw new HttpError(409, "Solo puedes editar el item base mientras la solicitud esta pendiente");
    }
    detalleNuevo = String(payload.detalle ?? payload.comentario ?? "").trim();
    if (!detalleNuevo) {
      throw new HttpError(400, "detalle invalido");
    }
    updates.push(`comentario = ${push(detalleNuevo)}`);
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
    updates.push(`estado_item = ${push(estadoNuevo)}`);
  }

  if (payload.comentario_gestion !== undefined || payload.comentarioGestion !== undefined) {
    if (!canManageTracking) {
      throw new HttpError(403, "Solo ADMIN o SUPERVISOR pueden gestionar comentarios por item");
    }
    const comentarioGestion = String(
      payload.comentario_gestion ?? payload.comentarioGestion ?? ""
    ).trim();
    updates.push(`comentario_gestion = ${push(comentarioGestion || null)}`);
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
    updates.push(`encargado_id = ${push(encargadoId)}`);
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
    updates.push(`enviado_por_id = ${push(senderId)}`);
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
    updates.push(`recepcionado_por_id = ${push(receiverId)}`);
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
    updates.push(`enviado_por_id = ${push(Number(actor.id))}`);
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
    updates.push(`recepcionado_por_id = ${push(Number(actor.id))}`);
    receiverIdFromPayload = Number(actor.id);
  }

  if (!updates.length) {
    throw new HttpError(400, "No se enviaron cambios para el item");
  }

  const pg = getOperationalPool();
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    updates.push("updated_at = NOW()");
    await client.query(
      `
        UPDATE solicitud_items
        SET ${updates.join(", ")}
        WHERE solicitud_id = $${params.length + 1}
          AND id = $${params.length + 2}
      `,
      [...params, Number(solicitudId), Number(itemId)]
    );

    refreshResult = await refreshSolicitudSummary(client, solicitudId, {
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
    await client.query(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        Number(solicitudId),
        historialAccion,
        solicitud.estado,
        solicitud.estado,
        historialDetalle,
        Number(actor.id),
        actor.nombre || actor.name || "Sistema",
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const updated = await loadSolicitudItemRecord(solicitudId, itemId);
  const refreshedSolicitud = await getSolicitudById(solicitudId, actor);
  if (refreshResult?.statusChanged) {
    await notificacionesService.createSolicitudStatusNotification({
      solicitudId: refreshedSolicitud?.id,
      equipoId: refreshedSolicitud?.equipo_id,
      equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo,
      repuesto: refreshedSolicitud?.resumen_items || refreshedSolicitud?.repuesto,
      estado: refreshedSolicitud?.estado,
      solicitanteId: refreshedSolicitud?.solicitante_id,
    });
  }
  await notificacionesService.createSolicitudItemNotification({
    solicitudId,
    equipoId: refreshedSolicitud?.equipo_id || solicitud.equipo_id,
    equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo || solicitud.nombre_equipo || solicitud.equipo,
    itemNombre: updated?.nombre_item || currentItem.nombre_item,
    accion: "Actualizado",
    estadoItem: updated?.estado_item || estadoNuevo || currentItem.estado_item,
  });
  return {
    item: updated,
    solicitud: refreshedSolicitud,
  };
}

async function createSolicitudItem(actor, solicitudId, payload = {}) {
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

  const pg = getOperationalPool();
  const client = await pg.connect();
  let createdId = null;
  let refreshResult = null;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        RETURNING id
      `,
      [
        Number(solicitudId),
        item.nombre_item,
        Number(item.cantidad),
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
    createdId = Number(rows[0].id);

    refreshResult = await refreshSolicitudSummary(client, solicitudId, {
      actorId: actor.id,
      actorName: actor.nombre || actor.name || "Sistema",
      reason: "El estado general se ajusto tras agregar un producto",
    });
    await client.query(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES ($1, 'ITEM_CREADO', $2, $3, $4, $5, $6)
      `,
      [
        Number(solicitudId),
        solicitud.estado,
        solicitud.estado,
        `Item agregado: ${item.nombre_item} (${item.cantidad})`,
        Number(actor.id),
        actor.nombre || actor.name || "Sistema",
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const createdItem = await loadSolicitudItemRecord(solicitudId, createdId);
  const refreshedSolicitud = await getSolicitudById(solicitudId, actor);
  if (refreshResult?.statusChanged) {
    await notificacionesService.createSolicitudStatusNotification({
      solicitudId: refreshedSolicitud?.id,
      equipoId: refreshedSolicitud?.equipo_id,
      equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo,
      repuesto: refreshedSolicitud?.resumen_items || refreshedSolicitud?.repuesto,
      estado: refreshedSolicitud?.estado,
      solicitanteId: refreshedSolicitud?.solicitante_id,
    });
  }
  await notificacionesService.createSolicitudItemNotification({
    solicitudId,
    equipoId: refreshedSolicitud?.equipo_id || solicitud.equipo_id,
    equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo || solicitud.nombre_equipo || solicitud.equipo,
    itemNombre: createdItem?.nombre_item || item.nombre_item,
    accion: "Agregado",
    estadoItem: createdItem?.estado_item || item.estado_item,
  });

  return {
    item: createdItem,
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

  const pg = getOperationalPool();
  const client = await pg.connect();
  let refreshResult = null;
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM solicitud_items WHERE solicitud_id = $1 AND id = $2", [
      Number(solicitudId),
      Number(itemId),
    ]);
    refreshResult = await refreshSolicitudSummary(client, solicitudId, {
      actorId: actor.id,
      actorName: actor.nombre || actor.name || "Sistema",
      reason: "El estado general se ajusto tras eliminar un producto",
    });
    await client.query(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
        VALUES ($1, 'ITEM_ELIMINADO', $2, $3, $4, $5, $6)
      `,
      [
        Number(solicitudId),
        solicitud.estado,
        solicitud.estado,
        `Item eliminado: ${currentItem.nombre_item}`,
        Number(actor.id),
        actor.nombre || actor.name || "Sistema",
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const refreshedSolicitud = await getSolicitudById(solicitudId, actor);
  if (refreshResult?.statusChanged) {
    await notificacionesService.createSolicitudStatusNotification({
      solicitudId: refreshedSolicitud?.id,
      equipoId: refreshedSolicitud?.equipo_id,
      equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo,
      repuesto: refreshedSolicitud?.resumen_items || refreshedSolicitud?.repuesto,
      estado: refreshedSolicitud?.estado,
      solicitanteId: refreshedSolicitud?.solicitante_id,
    });
  }

  await notificacionesService.createSolicitudItemNotification({
    solicitudId,
    equipoId: refreshedSolicitud?.equipo_id || solicitud.equipo_id,
    equipoNombre: refreshedSolicitud?.nombre_equipo || refreshedSolicitud?.equipo || solicitud.nombre_equipo || solicitud.equipo,
    itemNombre: currentItem.nombre_item,
    accion: "Eliminado",
    estadoItem: currentItem.estado_item,
  });

  return {
    id: Number(itemId),
    solicitud_id: Number(solicitudId),
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

  const pg = getOperationalPool();
  const { rows } = await pg.query(
    `
      INSERT INTO solicitud_mensajes (
        solicitud_id,
        remitente_id,
        destinatario_id,
        mensaje,
        imagen_nombre,
        imagen_data
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
    [Number(solicitudId), Number(actor.id), destinatarioId, mensaje || null, imagenNombre, imagenData || null]
  );

  const messageId = Number(rows[0].id);
  const usersMap = await loadUsersMap();
  const created = {
    id: messageId,
    solicitud_id: Number(solicitudId),
    remitente_id: Number(actor.id),
    remitente_nombre: usersMap.get(Number(actor.id))?.nombre || actor.nombre || actor.name || "Usuario",
    destinatario_id: destinatarioId,
    destinatario_nombre: destinatarioId ? usersMap.get(destinatarioId)?.nombre || null : null,
    mensaje: mensaje || null,
    imagen_nombre: imagenNombre,
    imagen_data: imagenData || null,
    created_at: new Date().toISOString(),
  };

  await pg.query(
    `
      INSERT INTO solicitud_historial
        (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
      VALUES ($1, 'MENSAJE', $2, $3, $4, $5, $6)
    `,
    [
      Number(solicitudId),
      solicitud.estado,
      solicitud.estado,
      mensaje ? `Mensaje interno: ${mensaje.slice(0, 120)}` : "Imagen adjunta enviada",
      Number(actor.id),
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

  const pg = getOperationalPool();
  const { rows } = await pg.query(
    `
      SELECT id, solicitud_id, remitente_id, imagen_data
      FROM solicitud_mensajes
      WHERE id = $1 AND solicitud_id = $2
    `,
    [Number(mensajeId), Number(solicitudId)]
  );

  const message = rows[0];
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

  await pg.query(
    `
      UPDATE solicitud_mensajes
      SET imagen_data = NULL, imagen_nombre = NULL
      WHERE id = $1 AND solicitud_id = $2
    `,
    [Number(mensajeId), Number(solicitudId)]
  );

  await pg.query(
    `
      INSERT INTO solicitud_historial
        (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
      VALUES ($1, 'IMAGEN_ELIMINADA', $2, $3, $4, $5, $6)
    `,
    [
      Number(solicitudId),
      solicitud.estado,
      solicitud.estado,
      "Se elimino una imagen del chat de la solicitud",
      Number(actor.id),
      actor.nombre || actor.name || "Sistema",
    ]
  );

  return {
    id: Number(mensajeId),
    solicitud_id: Number(solicitudId),
    imagen_eliminada: true,
  };
}

async function deleteSolicitud(actor, solicitudId) {
  const existing = await getSolicitudById(solicitudId, actor);
  if (!existing) {
    throw new HttpError(404, "Solicitud no encontrada");
  }

  const pg = getOperationalPool();
  const client = await pg.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM solicitud_mensajes WHERE solicitud_id = $1", [Number(solicitudId)]);
    await client.query("DELETE FROM solicitud_items WHERE solicitud_id = $1", [Number(solicitudId)]);
    await client.query("DELETE FROM solicitud_historial WHERE solicitud_id = $1", [Number(solicitudId)]);
    await client.query("DELETE FROM solicitudes WHERE id = $1", [Number(solicitudId)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    id: Number(solicitudId),
    deleted_by: actor.nombre || actor.name || "Sistema",
    deleted_at: new Date().toISOString(),
  };
}

async function listPendingItems(actor) {
  const role = getActorRole(actor);
  const params = [];
  const push = (v) => { params.push(v); return `$${params.length}`; };

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
      s.solicitante_id
    FROM solicitud_items si
    INNER JOIN solicitudes s ON s.id = si.solicitud_id
    WHERE si.estado_item = ${push(SOLICITUD_ITEM_STATUS.POR_GESTIONAR)}
      AND s.estado NOT IN ('ENTREGADO', 'RECHAZADO')
  `;
  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    query += ` AND s.equipo_id = ${push(Number(actor.equipo_id))}`;
  }
  query += ` ORDER BY s.id ASC, si.id ASC`;

  const pg = getOperationalPool();
  const [{ rows }, usersMap] = await Promise.all([pg.query(query, params), loadUsersMap()]);
  return rows.map((row) => ({
    ...row,
    item_id: Number(row.item_id),
    solicitud_id: Number(row.solicitud_id),
    cantidad: Number(row.cantidad),
    equipo_id: row.equipo_id != null ? Number(row.equipo_id) : null,
    solicitante_nombre: usersMap.get(Number(row.solicitante_id))?.nombre || "Usuario",
  }));
}

module.exports = {
  listSolicitudes,
  listSolicitudesForExport,
  getSolicitudDetail,
  createSolicitud,
  updateSolicitud,
  addSolicitudProcessComment,
  createSolicitudItem,
  updateSolicitudItem,
  deleteSolicitudItem,
  createSolicitudMessage,
  removeSolicitudMessageImage,
  deleteSolicitud,
  listPendingItems,
};
