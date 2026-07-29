const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const reportesService = require("../services/reportesService");
const consumoService = require("../services/consumoService");
const consumoExcelService = require("../services/consumoExcelService");
const productoAliasService = require("../services/productoAliasService");

const router = express.Router();

router.use(authenticate);

// Unificar productos cambia como se calculan los totales de todos, asi que
// queda en manos de los roles de gestion. SECRETARIA normaliza a SUPERVISOR.
router.get(
  "/alias",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await productoAliasService.listAliases();
    res.json({ status: "ok", data });
  })
);

router.post(
  "/alias",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await productoAliasService.createAlias(req.user, req.body || {});
    res.status(201).json({
      status: "ok",
      mensaje: "Productos unificados",
      data,
    });
  })
);

router.delete(
  "/alias/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await productoAliasService.deleteAlias(req.params.id);
    res.json({
      status: "ok",
      mensaje: "Unificacion deshecha",
      data,
    });
  })
);

router.get(
  "/consumo",
  authorize(
    ROLES.ADMIN,
    ROLES.SUPERVISOR,
    ROLES.SECRETARIA,
    ROLES.JEFE_FAENA,
    ROLES.MECANICO,
    ROLES.OPERADOR
  ),
  asyncHandler(async (req, res) => {
    const data = await consumoService.getConsumo(req.user, req.query || {});
    res.json({
      status: "ok",
      data,
    });
  })
);

// Detalle pedido por pedido de un producto: cuando, cuanto, para quien. Se
// pide aparte (no viaja dentro de /consumo) para no engordar el reporte con
// algo que solo hace falta al abrir un producto puntual.
router.get(
  "/consumo/detalle",
  authorize(
    ROLES.ADMIN,
    ROLES.SUPERVISOR,
    ROLES.SECRETARIA,
    ROLES.JEFE_FAENA,
    ROLES.MECANICO,
    ROLES.OPERADOR
  ),
  asyncHandler(async (req, res) => {
    const data = await consumoService.getPedidosDeProducto(req.user, req.query || {});
    res.json({
      status: "ok",
      data,
    });
  })
);

// Renombrar un producto del reporte. Cambia solo como se muestra, no toca
// ninguna solicitud. Mismo criterio de permisos que unificar productos: afecta
// lo que ve todo el mundo, asi que queda en manos de gestion.
router.get(
  "/nombres",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await productoAliasService.listNombresPersonalizados();
    res.json({ status: "ok", data });
  })
);

router.post(
  "/nombres",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await productoAliasService.setNombrePersonalizado(req.user, req.body || {});
    res.status(201).json({
      status: "ok",
      mensaje: "Nombre guardado",
      data,
    });
  })
);

router.delete(
  "/nombres/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA),
  asyncHandler(async (req, res) => {
    const data = await productoAliasService.deleteNombrePersonalizado(req.params.id);
    res.json({
      status: "ok",
      mensaje: "Se volvio al nombre automatico",
      data,
    });
  })
);

router.get(
  "/excel/consumo",
  authorize(
    ROLES.ADMIN,
    ROLES.SUPERVISOR,
    ROLES.SECRETARIA,
    ROLES.JEFE_FAENA,
    ROLES.MECANICO,
    ROLES.OPERADOR
  ),
  asyncHandler(async (req, res) => {
    const { buffer, fileName } = await consumoExcelService.exportConsumoExcel(
      req.user,
      req.query || {}
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  })
);

router.get(
  "/excel/solicitudes",
  authorize(
    ROLES.ADMIN,
    ROLES.SUPERVISOR,
    ROLES.SECRETARIA,
    ROLES.JEFE_FAENA,
    ROLES.MECANICO,
    ROLES.OPERADOR
  ),
  asyncHandler(async (req, res) => {
    const { buffer, fileName } = await reportesService.exportSolicitudesExcel(
      req.user,
      req.query || {}
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    res.send(buffer);
  })
);

module.exports = router;
