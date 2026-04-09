const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const usuariosService = require("../services/usuariosService");
const { assertUserMutationsAllowed, getStorageState } = require("../utils/storageMode");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR),
  asyncHandler(async (req, res) => {
    const data = await usuariosService.listUsuarios(req.query || {});
    res.json({
      status: "ok",
      data,
      storage: getStorageState(),
    });
  })
);

router.post(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR),
  asyncHandler(async (req, res) => {
    assertUserMutationsAllowed();
    const data = await usuariosService.createUsuario(req.body || {}, req.user);
    res.status(201).json({
      status: "ok",
      mensaje: "Usuario creado correctamente",
      data,
    });
  })
);

router.put(
  "/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR),
  asyncHandler(async (req, res) => {
    assertUserMutationsAllowed();
    const usuarioId = Number(req.params.id);
    const data = await usuariosService.updateUsuario(req.user, usuarioId, req.body || {});
    res.json({
      status: "ok",
      mensaje: "Usuario actualizado correctamente",
      data,
    });
  })
);

router.delete(
  "/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR),
  asyncHandler(async (req, res) => {
    assertUserMutationsAllowed();
    const usuarioId = Number(req.params.id);
    const data = await usuariosService.archiveUsuario(req.user, usuarioId);
    res.json({
      status: "ok",
      mensaje: "Usuario archivado correctamente",
      data,
    });
  })
);

router.post(
  "/:id/reset-password",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR),
  asyncHandler(async (req, res) => {
    assertUserMutationsAllowed();
    const usuarioId = Number(req.params.id);
    const data = await usuariosService.resetUsuarioPassword(
      req.user,
      usuarioId,
      req.body?.password
    );
    res.json({
      status: "ok",
      mensaje: "Contrasena restablecida correctamente",
      data,
    });
  })
);

module.exports = router;
