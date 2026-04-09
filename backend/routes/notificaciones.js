const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const notificacionesService = require("../services/notificacionesService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  authorize(
    ROLES.ADMIN,
    ROLES.SUPERVISOR,
    ROLES.SECRETARIA,
    ROLES.JEFE_FAENA,
    ROLES.MECANICO,
    ROLES.OPERADOR
  ),
  asyncHandler(async (req, res) => {
    const data = await notificacionesService.listNotificaciones(req.user, req.query || {});
    res.json({
      status: "ok",
      data,
    });
  })
);

router.get(
  "/stream",
  authorize(
    ROLES.ADMIN,
    ROLES.SUPERVISOR,
    ROLES.SECRETARIA,
    ROLES.JEFE_FAENA,
    ROLES.MECANICO,
    ROLES.OPERADOR
  ),
  asyncHandler(async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const sendEvent = (eventName, payload) => {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendEvent("connected", {
      status: "ok",
      timestamp: new Date().toISOString(),
    });

    const unsubscribe = notificacionesService.subscribeToNotifications(req.user, (notification) => {
      sendEvent("notification", notification);
    });

    const heartbeat = setInterval(() => {
      sendEvent("ping", {
        timestamp: new Date().toISOString(),
      });
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  })
);

router.put(
  "/:id/leer",
  authorize(
    ROLES.ADMIN,
    ROLES.SUPERVISOR,
    ROLES.SECRETARIA,
    ROLES.JEFE_FAENA,
    ROLES.MECANICO,
    ROLES.OPERADOR
  ),
  asyncHandler(async (req, res) => {
    const notificationId = Number(req.params.id);
    const data = await notificacionesService.markAsRead(req.user, notificationId);
    res.json({
      status: "ok",
      mensaje: "Notificacion marcada como leida",
      data,
    });
  })
);

module.exports = router;
