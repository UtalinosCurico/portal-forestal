const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const { getErrorLog } = require("../middleware/errorHandlers");
const { repairSolicitudConsistency, checkSolicitudConsistency } = require("../services/consistencyService");

const router = express.Router();

router.use(authenticate);
router.use(authorize(ROLES.ADMIN));

// Últimos errores de API registrados en memoria
router.get(
  "/error-log",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 50), 100);
    res.json({ status: "ok", data: getErrorLog().slice(0, limit) });
  })
);

// Verifica y repara inconsistencias estado_solicitud vs ítems
router.post(
  "/repair-consistency",
  asyncHandler(async (req, res) => {
    const result = await repairSolicitudConsistency();
    res.json({ status: "ok", ...result });
  })
);

// Verifica una sola solicitud sin reparar
router.get(
  "/check-consistency/:id",
  asyncHandler(async (req, res) => {
    const result = await checkSolicitudConsistency(Number(req.params.id));
    if (!result) return res.status(404).json({ status: "error", mensaje: "Solicitud no encontrada" });
    res.json({ status: "ok", ...result });
  })
);

module.exports = router;
