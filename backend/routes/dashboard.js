const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const dashboardService = require("../services/dashboardService");

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
    const data = await dashboardService.getDashboardData(req.user, req.query || {});
    res.json({
      status: "ok",
      data,
    });
  })
);

router.get(
  "/my-actions",
  authorize(
    ROLES.ADMIN,
    ROLES.SUPERVISOR,
    ROLES.SECRETARIA,
    ROLES.JEFE_FAENA,
    ROLES.MECANICO,
    ROLES.OPERADOR
  ),
  asyncHandler(async (req, res) => {
    const actions = await dashboardService.getMyActions(req.user, req.query || {});
    res.json({
      status: "ok",
      data: actions,
    });
  })
);

router.get(
  "/metrics",
  authorize(
    ROLES.ADMIN,
    ROLES.SUPERVISOR,
    ROLES.SECRETARIA,
    ROLES.JEFE_FAENA,
    ROLES.MECANICO,
    ROLES.OPERADOR
  ),
  asyncHandler(async (req, res) => {
    const metrics = await dashboardService.getDashboardMetrics(req.user, req.query || {});
    res.json({
      status: "ok",
      data: metrics,
    });
  })
);

module.exports = router;
