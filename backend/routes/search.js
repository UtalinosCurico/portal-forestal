const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const searchService = require("../services/searchService");

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
    const data = await searchService.searchAll(req.user, req.query || {});
    res.json({ status: "ok", data });
  })
);

module.exports = router;
