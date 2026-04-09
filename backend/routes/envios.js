const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const enviosService = require("../services/enviosService");

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
    const data = await enviosService.listEnvios(req.user, req.query || {});
    res.json({
      status: "ok",
      data,
    });
  })
);

router.get(
  "/opciones",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await enviosService.listOpciones(req.user);
    res.json({
      status: "ok",
      data,
    });
  })
);

router.post(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await enviosService.createEnvio(req.user, req.body || {});
    res.status(201).json({
      status: "ok",
      mensaje: "Envio creado correctamente",
      data,
    });
  })
);

router.put(
  "/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const envioId = Number(req.params.id);
    const data = await enviosService.updateEnvio(req.user, envioId, req.body || {});
    res.json({
      status: "ok",
      mensaje: "Envio actualizado correctamente",
      data,
    });
  })
);

router.put(
  "/:id/confirmar-recepcion",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA, ROLES.JEFE_FAENA, ROLES.MECANICO),
  asyncHandler(async (req, res) => {
    const envioId = Number(req.params.id);
    const data = await enviosService.confirmRecepcion(req.user, envioId, req.body || {});
    res.json({
      status: "ok",
      mensaje: "Recepcion confirmada correctamente",
      data,
    });
  })
);

module.exports = router;
