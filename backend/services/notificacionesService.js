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
    return emitNotifications(notifications);
  }

  const titulo = "Nueva solicitud en faena";
  const messageParts = [
    equipoNombre ? `Equipo: ${equipoNombre}` : null,
    repuesto ? `Repuesto: ${repuesto}` : null,
    Number.isFinite(Number(cantidad)) ? `Cantidad: ${cantidad}` : null,
  ].filter(Boolean);

  const mensaje = messageParts.length
    ? messageParts.join(" | ")
    : "Se registro una nueva solicitud";

  await insertNotification({
    tipo: "SOLICITUD_NUEVA",
    titulo,
    mensaje,
    rolDestino: ROLES.SUPERVISOR,
    equipoId: equipoId || null,
    referenciaId: solicitudId || null,
  });

  if (equipoId) {
    await insertNotification({
      tipo: "SOLICITUD_EQUIPO",
      titulo: "Nueva solicitud de tu equipo",
      mensaje,
      rolDestino: ROLES.JEFE_FAENA,
      equipoId,
      referenciaId: solicitudId || null,
    });
  }
}

const ESTADO_LABELS_PUSH = {
  EN_REVISION: "está en gestión",
  APROBADO: "fue aprobada",
  EN_DESPACHO: "va en camino",
  ENTREGADO: "fue entregada",
  RECHAZADO: "fue rechazada",
};

async function createSolicitudStatusNotification({
  solicitudId,
  equipoId,
  equipoNombre,
  repuesto,
  estado,
  solicitanteId,
}) {
  if (isOperationalPgEnabled()) {
    const notifications = await pgService.createSolicitudStatusNotification({
      solicitudId,
      equipoId,
      equipoNombre,
      repuesto,
      estado,
    });
    emitNotifications(notifications);
  } else {
    if (!equipoId) return;
    const parts = [
      equipoNombre ? `Equipo: ${equipoNombre}` : null,
      repuesto ? `Repuesto: ${repuesto}` : null,
      estado ? `Estado: ${estado}` : null,
    ].filter(Boolean);
    await insertNotification({
      tipo: "SOLICITUD_ESTADO",
      titulo: "Actualizacion de solicitud",
      mensaje: parts.join(" | ") || "La solicitud cambio de estado",
      rolDestino: ROLES.JEFE_FAENA,
      equipoId,
      referenciaId: solicitudId || null,
    });
  }

  // Push notification al solicitante si tiene suscripción activa
  if (solicitanteId && estado && ESTADO_LABELS_PUSH[estado]) {
    const label = ESTADO_LABELS_PUSH[estado];
    const titulo = `Tu solicitud ${label}`;
    const cuerpo = repuesto ? `Pedido: ${repuesto}` : `Solicitud #${solicitudId}`;
    pushService.sendPushToUser(solicitanteId, {
      title: titulo,
      body: cuerpo,
      solicitudId: solicitudId || null,
      url: "/web",
    }).catch(() => {});
  }
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
    return emitNotifications(notifications);
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

  await insertNotification({
    tipo: "ENVIO_NUEVO",
    titulo: "Nuevo envio hacia tu equipo",
    mensaje: parts.join(" | ") || "Se registro un nuevo envio",
    rolDestino: ROLES.JEFE_FAENA,
    equipoId,
    referenciaId: envioId || null,
  });
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
    return emitNotifications(notifications);
  }

  const preview = String(mensaje || "").trim();
  const body = preview
    ? `${remitenteNombre || "Nuevo mensaje"}: ${preview.slice(0, 140)}`
    : `${remitenteNombre || "Nuevo mensaje"} envio una imagen o archivo de apoyo.`;

  await insertNotification({
    tipo: "SOLICITUD_MENSAJE",
    titulo: "Nuevo mensaje en una solicitud",
    mensaje: body,
    usuarioDestinoId: destinatarioId,
    rolDestino: destinatarioId ? null : destinatarioRol,
    equipoId: equipoId || null,
    referenciaId: solicitudId || null,
  });
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
    return emitNotifications(notifications);
  }

  const parts = [
    equipoNombre ? `Equipo: ${equipoNombre}` : null,
    itemNombre ? `Item: ${itemNombre}` : null,
    accion ? `Accion: ${accion}` : null,
    estadoItem ? `Estado: ${estadoItem}` : null,
  ].filter(Boolean);

  const mensaje = parts.join(" | ") || "Hubo cambios en un producto de la solicitud";

  await insertNotification({
    tipo: "SOLICITUD_ITEM",
    titulo: "Cambio en producto de solicitud",
    mensaje,
    rolDestino: ROLES.SUPERVISOR,
    equipoId: equipoId || null,
    referenciaId: solicitudId || null,
  });

  if (equipoId) {
    await insertNotification({
      tipo: "SOLICITUD_ITEM",
      titulo: "Cambio en producto de tu equipo",
      mensaje,
      rolDestino: ROLES.JEFE_FAENA,
      equipoId,
      referenciaId: solicitudId || null,
    });
  }
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
