const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const equiposService = require("../services/equiposService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await equiposService.listEquipos(req.user);
    res.json({
      status: "ok",
      data,
    });
  })
);

router.get(
  "/stock",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await equiposService.listEquipoStock(req.user);
    res.json({
      status: "ok",
      data,
    });
  })
);

router.get(
  "/:id/stock",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const equipoId = Number(req.params.id);
    const data = await equiposService.getEquipoStockByEquipoId(req.user, equipoId);
    res.json({
      status: "ok",
      data,
    });
  })
);

router.put(
  "/stock/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const equipoStockId = Number(req.params.id);
    const data = await equiposService.updateEquipoStock(req.user, equipoStockId, req.body || {});
    res.json({
      status: "ok",
      mensaje: "Stock de equipo actualizado correctamente",
      data,
    });
  })
);

router.post(
  "/",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const data = await equiposService.createEquipo(req.body || {});
    res.status(201).json({
      status: "ok",
      mensaje: "Equipo creado correctamente",
      data,
    });
  })
);

router.put(
  "/:id",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const equipoId = Number(req.params.id);
    const data = await equiposService.updateEquipo(equipoId, req.body || {});
    res.json({
      status: "ok",
      mensaje: "Equipo actualizado correctamente",
      data,
    });
  })
);

module.exports = router;
