const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const authService = require("../services/authService");

const router = express.Router();

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const data = await authService.login(email, password);
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

module.exports = router;

