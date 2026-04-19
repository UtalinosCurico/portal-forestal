const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { saveSubscription, removeSubscription } = require("../services/pushService");

const router = express.Router();

router.use(authenticate);

// Devuelve la VAPID public key para que el frontend la use al suscribirse
router.get("/vapid-public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
});

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

module.exports = router;
