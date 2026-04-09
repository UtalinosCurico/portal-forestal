const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const inventarioService = require("../services/inventarioService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const rows = await inventarioService.listInventario(req.user);
    res.json({
      status: "ok",
      data: rows,
    });
  })
);

router.post(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const created = await inventarioService.createInventario(req.user, req.body || {});
    res.status(201).json({
      status: "ok",
      mensaje: "Item de inventario creado correctamente",
      data: created,
    });
  })
);

router.put(
  "/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const inventarioId = Number(req.params.id);
    const updated = await inventarioService.updateInventario(
      req.user,
      inventarioId,
      req.body || {}
    );
    res.json({
      status: "ok",
      mensaje: "Item de inventario actualizado correctamente",
      data: updated,
    });
  })
);

router.delete(
  "/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const inventarioId = Number(req.params.id);
    const deleted = await inventarioService.deleteInventario(req.user, inventarioId);
    res.json({
      status: "ok",
      mensaje: "Item de inventario eliminado correctamente",
      data: deleted,
    });
  })
);

module.exports = router;
