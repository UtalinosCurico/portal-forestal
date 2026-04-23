const EventEmitter = require("events");
const { all, get, run } = require("../db/database");
const { isGlobalRole, requireTeamAssigned } = require("../middleware/roles");
const { HttpError } = require("../utils/httpError");
const { ROLES } = require("../config/appRoles");
const { isOperationalPgEnabled } = require("./operationalPgStore");
const pgService = require("./notificacionesPgService");
const pushService = require("./pushService");

const notificationBus = new EventEmitter();
notificationBus.setMaxListeners(100);

function emitNotifications(notifications) {
  const safeNotifications = Array.isArray(notifications)
    ? notifications.filter(Boolean)
    : notifications
      ? [notifications]
      : [];

  for (const notification of safeNotifications) {
    notificationBus.emit("notification", notification);
  }

  return safeNotifications.at(-1) || null;
}

function dispatchPushNotifications(notifications) {
  const safeNotifications = Array.isArray(notifications)
    ? notifications.filter(Boolean)
    : notifications
      ? [notifications]
      : [];

  if (!safeNotifications.length) {
    return;
  }

  Promise.allSettled(
    safeNotifications.map((notification) => pushService.sendPushForNotification(notification))
  ).catch(() => {});
}

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

function buildSolicitudItemMessage({ equipoNombre, itemNombre, accion, estadoItem }) {
  const parts = [
    equipoNombre ? `Equipo: ${equipoNombre}` : null,
    itemNombre ? `Item: ${itemNombre}` : null,
    accion ? `Accion: ${accion}` : null,
    estadoItem ? `Estado: ${estadoItem}` : null,
  ].filter(Boolean);

  return parts.join(" | ") || "Hubo cambios en un producto de la solicitud";
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

async function insertNotification({
  tipo,
  titulo,
  mensaje,
  rolDestino = null,
  usuarioDestinoId = null,
  equipoId = null,
  referenciaId = null,
}) {
  const result = await run(
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
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [tipo, titulo, mensaje, rolDestino, usuarioDestinoId, equipoId, referenciaId]
  );

  const notification = await get(
    `
      SELECT
        n.id,
        n.tipo,
        n.titulo,
        n.mensaje,
        n.rol_destino,
        n.usuario_destino_id,
        n.equipo_id,
        e.nombre_equipo,
        n.referencia_id,
        n.leida,
        n.created_at,
        n.read_at
      FROM notificaciones n
      LEFT JOIN equipos e ON e.id = n.equipo_id
      WHERE n.id = ?
    `,
    [result.lastID]
  );

  if (notification) {
    notificationBus.emit("notification", notification);
  }

  return notification;
}

function buildVisibilityScope(actor, alias = "n") {
  const role = getActorRole(actor);
  const conditions = [];
  const params = [];

  conditions.push(
    `(${alias}.rol_destino = ? OR ${alias}.usuario_destino_id = ? OR (${alias}.rol_destino IS NULL AND ${alias}.usuario_destino_id IS NULL))`
  );
  params.push(role, actor.id);

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    conditions.push(`(${alias}.equipo_id IS NULL OR ${alias}.equipo_id = ?)`);
    params.push(actor.equipo_id);
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

function subscribeToNotifications(actor, listener) {
  const handler = (notification) => {
    try {
      if (canActorReceiveNotification(actor, notification)) {
        listener(notification);
      }
    } catch {
      // Ignorar errores del listener para no tumbar el stream.
    }
  };

  notificationBus.on("notification", handler);
  return () => {
    notificationBus.off("notification", handler);
  };
}

async function listNotificaciones(actor, filters = {}) {
  if (isOperationalPgEnabled()) {
    return pgService.listNotificaciones(actor, filters);
  }

  const scope = buildVisibilityScope(actor, "n");
  const soloNoLeidas = toBooleanFlag(filters.soloNoLeidas || filters.unreadOnly);
  const limit = normalizeLimit(filters.limit, 30);

  const where = soloNoLeidas
    ? `${scope.where ? `${scope.where} AND` : "WHERE"} n.leida = 0`
    : scope.where;

  return all(
    `
      SELECT
        n.id,
        n.tipo,
        n.titulo,
        n.mensaje,
        n.rol_destino,
        n.usuario_destino_id,
        n.equipo_id,
        e.nombre_equipo,
        n.referencia_id,
        n.leida,
        n.created_at,
        n.read_at
      FROM notificaciones n
      LEFT JOIN equipos e ON e.id = n.equipo_id
      ${where}
      ORDER BY n.id DESC
      LIMIT ?
    `,
    [...scope.params, limit]
  );
}

async function markAsRead(actor, notificationId) {
  if (isOperationalPgEnabled()) {
    return pgService.markAsRead(actor, notificationId);
  }

  const scope = buildVisibilityScope(actor, "n");
  const notification = await get(
    `
      SELECT n.id, n.leida
      FROM notificaciones n
      ${scope.where ? `${scope.where} AND` : "WHERE"} n.id = ?
    `,
    [...scope.params, notificationId]
  );

  if (!notification) {
    throw new HttpError(404, "Notificacion no encontrada");
  }

  if (Number(notification.leida) === 1) {
    return {
      id: notificationId,
      leida: true,
    };
  }

  await run(
    `
      UPDATE notificaciones
      SET leida = 1, read_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [notificationId]
  );

  return {
    id: notificationId,
    leida: true,
  };
}

async function createSolicitudNotification({ solicitudId, equipoId, equipoNombre, repuesto, cantidad }) {
  if (isOperationalPgEnabled()) {
    const notifications = await pgService.createSolicitudNotification({
      solicitudId,
      equipoId,
      equipoNombre,
      repuesto,
      cantidad,
    });
    const latest = emitNotifications(notifications);
    dispatchPushNotifications(notifications);
    return latest;
  }

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

  dispatchPushNotifications(notifications);
  return notifications.at(-1) || null;
}

async function createSolicitudStatusNotification({
  solicitudId,
  equipoId,
  equipoNombre,
  repuesto,
  estado,
  solicitanteId,
  audience = "requester",
}) {
  if (isOperationalPgEnabled()) {
    const notifications = await pgService.createSolicitudStatusNotification({
      solicitudId,
      equipoId,
      equipoNombre,
      repuesto,
      estado,
      solicitanteId,
      audience,
    });
    const latest = emitNotifications(notifications);
    dispatchPushNotifications(notifications);
    return latest;
  }

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

  dispatchPushNotifications(notifications);
  return notifications.at(-1) || null;
}

async function createEnvioNotification({
  envioId,
  equipoId,
  equipoNombre,
  repuesto,
  cantidad,
  estadoVisual,
}) {
  if (isOperationalPgEnabled()) {
    const notifications = await pgService.createEnvioNotification({
      envioId,
      equipoId,
      equipoNombre,
      repuesto,
      cantidad,
      estadoVisual,
    });
    const latest = emitNotifications(notifications);
    dispatchPushNotifications(notifications);
    return latest;
  }

  if (!equipoId) {
    return;
  }

  const parts = [
    equipoNombre ? `Equipo: ${equipoNombre}` : null,
    repuesto ? `Repuesto: ${repuesto}` : null,
    Number.isFinite(Number(cantidad)) ? `Cantidad: ${cantidad}` : null,
    estadoVisual ? `Tracking: ${estadoVisual}` : null,
  ].filter(Boolean);

  const envioNotification = await insertNotification({
    tipo: "ENVIO_NUEVO",
    titulo: "Nuevo envio hacia tu equipo",
    mensaje: parts.join(" | ") || "Se registro un nuevo envio",
    rolDestino: ROLES.JEFE_FAENA,
    equipoId,
    referenciaId: envioId || null,
  });
  dispatchPushNotifications(envioNotification);
}

async function createSolicitudMessageNotification({
  solicitudId,
  equipoId,
  remitenteNombre,
  destinatarioId = null,
  destinatarioRol = null,
  mensaje,
}) {
  if (isOperationalPgEnabled()) {
    const notifications = await pgService.createSolicitudMessageNotification({
      solicitudId,
      equipoId,
      remitenteNombre,
      destinatarioId,
      destinatarioRol,
      mensaje,
    });
    const latest = emitNotifications(notifications);
    dispatchPushNotifications(notifications);
    return latest;
  }

  const preview = String(mensaje || "").trim();
  const body = preview
    ? `${remitenteNombre || "Nuevo mensaje"}: ${preview.slice(0, 140)}`
    : `${remitenteNombre || "Nuevo mensaje"} envio una imagen o archivo de apoyo.`;

  const messageNotification = await insertNotification({
    tipo: "SOLICITUD_MENSAJE",
    titulo: "Nuevo mensaje en una solicitud",
    mensaje: body,
    usuarioDestinoId: destinatarioId,
    rolDestino: destinatarioId ? null : destinatarioRol,
    equipoId: equipoId || null,
    referenciaId: solicitudId || null,
  });
  dispatchPushNotifications(messageNotification);
}

async function createSolicitudItemNotification({
  solicitudId,
  equipoId,
  equipoNombre,
  itemNombre,
  accion,
  estadoItem = null,
}) {
  if (isOperationalPgEnabled()) {
    const notifications = await pgService.createSolicitudItemNotification({
      solicitudId,
      equipoId,
      equipoNombre,
      itemNombre,
      accion,
      estadoItem,
    });
    const latest = emitNotifications(notifications);
    dispatchPushNotifications(notifications);
    return latest;
  }

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

  dispatchPushNotifications(notifications);
  return notifications.at(-1) || null;
}

module.exports = {
  listNotificaciones,
  markAsRead,
  canActorReceiveNotification,
  subscribeToNotifications,
  createSolicitudNotification,
  createSolicitudStatusNotification,
  createEnvioNotification,
  createSolicitudMessageNotification,
  createSolicitudItemNotification,
};
