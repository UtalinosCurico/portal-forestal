const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const {
  getVapidPublicKey,
  getPushStatusForUser,
  isPushConfigured,
  saveSubscription,
  removeSubscription,
  sendPushToEndpoint,
  sendPushToUser,
} = require("../services/pushService");

const router = express.Router();

router.use(authenticate);

// Devuelve la VAPID public key para que el frontend la use al suscribirse
router.get("/vapid-public-key", (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const status = await getPushStatusForUser(req.user.id, req.query.endpoint || "");
    res.json(status);
  })
);

// Guarda o actualiza la suscripción push del usuario autenticado
router.post(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Suscripción inválida" });
    }
    await saveSubscription(req.user.id, { endpoint, keys });
    res.json({ ok: true });
  })
);

// Elimina la suscripción (cuando el usuario desactiva notificaciones)
router.delete(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: "endpoint requerido" });
    await removeSubscription(endpoint);
    res.json({ ok: true });
  })
);

router.post(
  "/test",
  asyncHandler(async (req, res) => {
    const endpoint = String(req.body?.endpoint || "").trim();

    if (!isPushConfigured()) {
      return res.status(503).json({ error: "Las notificaciones push no estan configuradas en el servidor." });
    }

    if (endpoint) {
      const status = await getPushStatusForUser(req.user.id, endpoint);
      if (!status.currentDeviceSubscribed) {
        return res.status(409).json({ error: "Este celular aun no esta suscrito. Activalo primero en el portal." });
      }

      const result = await sendPushToEndpoint(endpoint, {
        title: "Prueba de notificaciones",
        body: "Este celular ya puede recibir avisos del Portal FMN.",
        url: "/web",
      });

      if (!result.delivered) {
        return res.status(502).json({ error: "No se pudo entregar la notificacion de prueba. Revisa los permisos del dispositivo." });
      }

      return res.json({ ok: true, delivered: result.delivered });
    }

    const status = await getPushStatusForUser(req.user.id);
    if (!status.subscribed) {
      return res.status(409).json({ error: "Este usuario aun no tiene un celular suscrito para recibir notificaciones." });
    }

    const result = await sendPushToUser(req.user.id, {
      title: "Prueba de notificaciones",
      body: "Este celular ya puede recibir avisos del Portal FMN.",
      url: "/web",
    });

    if (!result.delivered) {
      return res.status(502).json({ error: "No se pudo entregar la notificacion de prueba. Revisa los permisos del dispositivo." });
    }

    res.json({ ok: true, delivered: result.delivered });
  })
);

module.exports = router;
