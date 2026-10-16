const express = require("express");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const { getPowerbiPorEmpresa } = require("../config/powerbiConfig");
const empresasService = require("../services/empresasService");

const router = express.Router();

router.use(authenticate);

// Configuracion del informe embebido. Cada empresa tiene el suyo y aqui se
// entrega solo el de la empresa en la que se esta trabajando: son enlaces
// publicos de Power BI, asi que devolver el de la otra seria entregarselo.
router.get(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR),
  (req, res) => {
    const empresa =
      empresasService.resolveEmpresaFilter(req.user, req.query || {}) ||
      empresasService.getEmpresaDelActor(req.user) ||
      empresasService.DEFAULT_EMPRESA;

    const powerbi = getPowerbiPorEmpresa(empresa);
    const nombreEmpresa = empresasService.getEmpresa(empresa)?.nombre || "esta empresa";

    if (!powerbi) {
      return res.json({
        status: "ok",
        mensaje: `Todavía no hay un informe de Power BI cargado para ${nombreEmpresa}.`,
        powerbi: null,
      });
    }

    return res.json({
      status: "ok",
      mensaje: "Configuración Power BI disponible",
      powerbi,
    });
  }
);

module.exports = router;
