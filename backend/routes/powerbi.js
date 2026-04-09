const express = require("express");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const { POWERBI_CONFIG } = require("../config/powerbiConfig");

const router = express.Router();

router.use(authenticate);

// Endpoint para exponer configuracion de embed Power BI.
router.get(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR),
  (req, res) => {
    res.json({
      status: "ok",
      mensaje: "Configuracion Power BI disponible",
      powerbi: POWERBI_CONFIG,
    });
  }
);

module.exports = router;
