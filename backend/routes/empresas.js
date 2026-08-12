const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const { isGlobalRole } = require("../middleware/roles");
const empresasService = require("../services/empresasService");

const router = express.Router();

router.use(authenticate);

// Catalogo de empresas y a cual pertenece quien pregunta. El portal lo usa para
// pintar el selector del menu: ADMIN y SUPERVISOR pueden moverse entre las dos,
// el resto queda fijo en la empresa de su equipo.
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
    await empresasService.ensureLoaded();
    const empresas = await empresasService.listEmpresasVisibles(req.user);
    const empresaDelActor = empresasService.getEmpresaDelActor(req.user);
    const puedeCambiar = isGlobalRole(req.user.rol || req.user.role);

    res.json({
      status: "ok",
      data: {
        empresas,
        empresaActual: empresaDelActor || (puedeCambiar ? null : empresasService.DEFAULT_EMPRESA),
        puedeCambiar,
      },
    });
  })
);

module.exports = router;
