const { HttpError } = require("../utils/httpError");
const { ROLES } = require("../config/appRoles");
const { isGlobalRole, requireTeamAssigned } = require("../middleware/roles");
const {
  getOperationalPool,
  loadEquiposMap,
} = require("./operationalPgStore");

function getActorRole(actor) {
  return actor.rol || actor.role;
}

function toBooleanFlag(value) {
  if (value === undefined || value === null || value === "") {
    return false;
  }
  return ["1", "true", "si", "yes"].includes(String(value).trim().toLowerCase());
}

function normalizeLimit(value, fallback = 30) {
  const limit = Number(value || fallback);
  if (!Number.isInteger(limit) || limit <= 0) {
    return fallback;
  }
  return Math.min(limit, 100);
}

const MANAGEMENT_NOTIFICATION_ROLES = [ROLES.ADMIN, ROLES.SUPERVISOR];

const REQUESTER_STATUS_LABELS = {
  EN_REVISION: "esta en gestion",
  APROBADO: "fue aprobada",
  EN_DESPACHO: "va en camino",
  ENTREGADO: "fue entregada",
  RECHAZADO: "fue rechazada",
};

function buildSolicitudNotificationMessage({ equipoNombre, repuesto, cantidad }) {
  const messageParts = [
    equipoNombre ? `Equipo: ${equipoNombre}` : null,
    repuesto ? `Repuesto: ${repuesto}` : null,
    Number.isFinite(Number(cantidad)) ? `Cantidad: ${cantidad}` : null,
  ].filter(Boolean);

  return messageParts.length ? messageParts.join(" | ") : "Se registro una nueva solicitud";
}

function buildSolicitudStatusMessage({ equipoNombre, repuesto, estado }) {
  const parts = [
    equipoNombre ? `Equipo: ${equipoNombre}` : null,
    repuesto ? `Repuesto: ${repuesto}` : null,
    estado ? `Estado: ${estado}` : null,
  ].filter(Boolean);

  return parts.join(" | ") || "La solicitud cambio de estado";
}

function buildSolicitudStatusTitle({ estado, audience }) {
  if (audience === "management") {
    if (estado === "ENTREGADO") {
      return "Recepcion confirmada en solicitud";
    }
    return "Actualizacion desde faena";
  }

  return REQUESTER_STATUS_LABELS[estado]
    ? `Tu solicitud ${REQUESTER_STATUS_LABELS[estado]}`
    : "Actualizacion de solicitud";
}

function buildSolicitudItemMessage({ equipoNombre, itemNombre, accion, estadoItem }) {
  const parts = [
    equipoNombre ? `Equipo: ${equipoNombre}` : null,
    itemNombre ? `Item: ${itemNombre}` : null,
    accion ? `Accion: ${accion}` : null,
    estadoItem ? `Estado: ${estadoItem}` : null,
  ].filter(Boolean);

  return parts.join(" | ") || "Hubo cambios en un producto de la solicitud";
}

async function insertNotificationsForRoles(basePayload, roles = []) {
  const notifications = [];

  for (const role of roles) {
    notifications.push(
      await insertNotification({
        ...basePayload,
        rolDestino: role,
      })
    );
  }

  return notifications.filter(Boolean);
}

function buildVisibilityScope(actor, alias = "n") {
  const role = getActorRole(actor);
  const conditions = [];
  const params = [];

  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  conditions.push(
    `(${alias}.rol_destino = ${push(role)} OR ${alias}.usuario_destino_id = ${push(Number(actor.id))} OR (${alias}.rol_destino IS NULL AND ${alias}.usuario_destino_id IS NULL))`
  );

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    conditions.push(`(${alias}.equipo_id IS NULL OR ${alias}.equipo_id = ${push(Number(actor.equipo_id))})`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

function canActorReceiveNotification(actor, notification) {
  const role = getActorRole(actor);
  const roleMatches = notification.rol_destino === role;
  const directUserMatches = Number(notification.usuario_destino_id) === Number(actor.id);
  const globalNotification =
    notification.rol_destino === null && notification.usuario_destino_id === null;

  if (!(roleMatches || directUserMatches || globalNotification)) {
    return false;
  }

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    if (notification.equipo_id && Number(notification.equipo_id) !== Number(actor.equipo_id)) {
      return false;
    }
  }

  return true;
}

async function decorateNotifications(rows) {
  const equiposMap = await loadEquiposMap();
  return rows.map((row) => ({
    id: Number(row.id),
    tipo: row.tipo,
    titulo: row.titulo,
    mensaje: row.mensaje,
    rol_destino: row.rol_destino || null,
    usuario_destino_id:
      row.usuario_destino_id === null || row.usuario_destino_id === undefined
        ? null
        : Number(row.usuario_destino_id),
    equipo_id: row.equipo_id === null || row.equipo_id === undefined ? null : Number(row.equipo_id),
    nombre_equipo:
      row.nombre_equipo || (row.equipo_id ? equiposMap.get(Number(row.equipo_id)) || null : null),
    referencia_id:
      row.referencia_id === null || row.referencia_id === undefined ? null : Number(row.referencia_id),
    leida: Boolean(row.leida),
    created_at: row.created_at,
    read_at: row.read_at || null,
  }));
}

async function insertNotification({
  tipo,
  titulo,
  mensaje,
  rolDestino = null,
  usuarioDestinoId = null,
  equipoId = null,
  referenciaId = null,
}) {
  const pg = getOperationalPool();
  const { rows } = await pg.query(
    `
      INSERT INTO notificaciones (
        tipo,
        titulo,
        mensaje,
        rol_destino,
        usuario_destino_id,
        equipo_id,
        referencia_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        tipo,
        titulo,
        mensaje,
        rol_destino,
        usuario_destino_id,
        equipo_id,
        referencia_id,
        leida,
        created_at,
        read_at
    `,
    [tipo, titulo, mensaje, rolDestino, usuarioDestinoId, equipoId, referenciaId]
  );

  const [notification] = await decorateNotifications(rows);
  return notification;
}

async function listNotificaciones(actor, filters = {}) {
  const pg = getOperationalPool();
  const scope = buildVisibilityScope(actor, "n");
  const soloNoLeidas = toBooleanFlag(filters.soloNoLeidas || filters.unreadOnly);
  const limit = normalizeLimit(filters.limit, 30);
  const params = [...scope.params];
  const conditions = [];

  if (scope.where) {
    conditions.push(scope.where.replace(/^WHERE\s+/i, ""));
  }

  if (soloNoLeidas) {
    params.push(false);
    conditions.push(`n.leida = $${params.length}`);
  }

  params.push(limit);

  const { rows } = await pg.query(
    `
      SELECT
        n.id,
        n.tipo,
        n.titulo,
        n.mensaje,
        n.rol_destino,
        n.usuario_destino_id,
        n.equipo_id,
        n.referencia_id,
        n.leida,
        n.created_at,
        n.read_at
      FROM notificaciones n
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY n.id DESC
      LIMIT $${params.length}
    `,
    params
  );

  return decorateNotifications(rows);
}

async function markAsRead(actor, notificationId) {
  const pg = getOperationalPool();
  const scope = buildVisibilityScope(actor, "n");
  const params = [...scope.params, Number(notificationId)];
  const { rows } = await pg.query(
    `
      SELECT n.id, n.leida
      FROM notificaciones n
      ${scope.where ? `${scope.where} AND` : "WHERE"} n.id = $${params.length}
    `,
    params
  );

  const notification = rows[0];
  if (!notification) {
    throw new HttpError(404, "Notificacion no encontrada");
  }

  if (Boolean(notification.leida)) {
    return {
      id: Number(notificationId),
      leida: true,
    };
  }

  await pg.query(
    `
      UPDATE notificaciones
      SET leida = TRUE, read_at = NOW()
      WHERE id = $1
    `,
    [Number(notificationId)]
  );

  return {
    id: Number(notificationId),
    leida: true,
  };
}

async function createSolicitudNotification({ solicitudId, equipoId, equipoNombre, repuesto, cantidad }) {
  const notifications = await insertNotificationsForRoles(
    {
      tipo: "SOLICITUD_NUEVA",
      titulo: "Nueva solicitud en faena",
      mensaje: buildSolicitudNotificationMessage({ equipoNombre, repuesto, cantidad }),
      equipoId: equipoId || null,
      referenciaId: solicitudId || null,
    },
    MANAGEMENT_NOTIFICATION_ROLES
  );

  return notifications.filter(Boolean);
}

async function createSolicitudStatusNotification({
  solicitudId,
  equipoId,
  equipoNombre,
  repuesto,
  estado,
  solicitanteId = null,
  audience = "requester",
}) {
  const baseNotification = {
    tipo: "SOLICITUD_ESTADO",
    titulo: buildSolicitudStatusTitle({ estado, audience }),
    mensaje: buildSolicitudStatusMessage({ equipoNombre, repuesto, estado }),
    equipoId: equipoId || null,
    referenciaId: solicitudId || null,
  };

  let notifications = [];
  if (audience === "management") {
    notifications = await insertNotificationsForRoles(baseNotification, MANAGEMENT_NOTIFICATION_ROLES);
  } else if (solicitanteId) {
    notifications = [
      await insertNotification({
        ...baseNotification,
        usuarioDestinoId: solicitanteId,
      }),
    ].filter(Boolean);
  } else if (equipoId) {
    notifications = [
      await insertNotification({
        ...baseNotification,
        rolDestino: ROLES.JEFE_FAENA,
      }),
    ].filter(Boolean);
  }

  return notifications.filter(Boolean);
}

async function createEnvioNotification({
  envioId,
  equipoId,
  equipoNombre,
  repuesto,
  cantidad,
  estadoVisual,
}) {
  if (!equipoId) {
    return;
  }

  const parts = [
    equipoNombre ? `Equipo: ${equipoNombre}` : null,
    repuesto ? `Repuesto: ${repuesto}` : null,
    Number.isFinite(Number(cantidad)) ? `Cantidad: ${cantidad}` : null,
    estadoVisual ? `Tracking: ${estadoVisual}` : null,
  ].filter(Boolean);

  const notifications = [];

  notifications.push(
    await insertNotification({
      tipo: "ENVIO_NUEVO",
      titulo: "Nuevo envio hacia tu equipo",
      mensaje: parts.join(" | ") || "Se registro un nuevo envio",
      rolDestino: ROLES.JEFE_FAENA,
      equipoId,
      referenciaId: envioId || null,
    })
  );

  return notifications.filter(Boolean);
}

async function createSolicitudMessageNotification({
  solicitudId,
  equipoId,
  remitenteNombre,
  destinatarioId = null,
  destinatarioRol = null,
  mensaje,
}) {
  const preview = String(mensaje || "").trim();
  const body = preview
    ? `${remitenteNombre || "Nuevo mensaje"}: ${preview.slice(0, 140)}`
    : `${remitenteNombre || "Nuevo mensaje"} envio una imagen o archivo de apoyo.`;

  const notifications = [];

  notifications.push(
    await insertNotification({
      tipo: "SOLICITUD_MENSAJE",
      titulo: "Nuevo mensaje en una solicitud",
      mensaje: body,
      usuarioDestinoId: destinatarioId,
      rolDestino: destinatarioId ? null : destinatarioRol,
      equipoId: equipoId || null,
      referenciaId: solicitudId || null,
    })
  );

  return notifications.filter(Boolean);
}

async function createSolicitudItemNotification({
  solicitudId,
  equipoId,
  equipoNombre,
  itemNombre,
  accion,
  estadoItem = null,
}) {
  const notifications = await insertNotificationsForRoles(
    {
      tipo: "SOLICITUD_ITEM",
      titulo: "Cambio en producto de solicitud",
      mensaje: buildSolicitudItemMessage({ equipoNombre, itemNombre, accion, estadoItem }),
      equipoId: equipoId || null,
      referenciaId: solicitudId || null,
    },
    MANAGEMENT_NOTIFICATION_ROLES
  );

  return notifications.filter(Boolean);
}

module.exports = {
  listNotificaciones,
  markAsRead,
  canActorReceiveNotification,
  createSolicitudNotification,
  createSolicitudStatusNotification,
  createEnvioNotification,
  createSolicitudMessageNotification,
  createSolicitudItemNotification,
};
