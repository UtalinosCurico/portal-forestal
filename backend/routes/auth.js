const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const authService = require("../services/authService");
const { obtenerIpCliente } = require("../services/loginIntentosService");

const router = express.Router();

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    // La IP alimenta el limite de intentos fallidos (ver loginIntentosService).
    const data = await authService.login(email, password, { ip: obtenerIpCliente(req) });
    res.json({
      status: "ok",
      mensaje: "Login exitoso",
      ...data,
    });
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const profile = await authService.getProfile(req.user.id);
    res.json({
      status: "ok",
      user: profile,
    });
  })
);

router.post(
  "/refresh",
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await authService.refreshSession(req.user.id);
    res.json({
      status: "ok",
      mensaje: "Sesión renovada",
      ...data,
    });
  })
);

module.exports = router;

