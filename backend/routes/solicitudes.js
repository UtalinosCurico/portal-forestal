const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { ROLES } = require("../config/appRoles");
const solicitudesService = require("../services/solicitudesService");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const result = await solicitudesService.listSolicitudes(req.user, req.query || {});
    res.json({
      status: "ok",
      data: result.data,
      meta: { total: result.total, page: result.page, pages: result.pages },
    });
  })
);

router.get(
  "/items/pendientes",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const data = await solicitudesService.listPendingItems(req.user);
    res.json({ status: "ok", data });
  })
);

router.get(
  "/:id/historial",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const result = await solicitudesService.getSolicitudHistory(req.user, solicitudId, req.query || {});
    res.json({
      status: "ok",
      data: result.data,
      meta: result.meta,
    });
  })
);

router.get(
  "/:id/export-pdf",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const result = await solicitudesService.exportSolicitudHistoryPdf(req.user, solicitudId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  })
);

router.get(
  "/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const data = await solicitudesService.getSolicitudDetail(req.user, solicitudId);
    res.json({
      status: "ok",
      data,
    });
  })
);

router.post(
  "/",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const created = await solicitudesService.createSolicitud(req.user, req.body || {});
    const { meta, ...data } = created || {};
    const mergedIntoPending = meta?.action === "merged_into_pending";
    res.status(mergedIntoPending ? 200 : 201).json({
      status: "ok",
      mensaje: mergedIntoPending
        ? `Se actualizó la solicitud pendiente #${meta?.solicitudId} sin crear duplicados`
        : "Solicitud creada correctamente",
      data,
      ...(meta ? { meta } : {}),
    });
  })
);

router.put(
  "/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const updated = await solicitudesService.updateSolicitud(req.user, solicitudId, req.body || {});
    res.json({
      status: "ok",
      mensaje: "Solicitud actualizada correctamente",
      data: updated,
    });
  })
);

router.post(
  "/:id/comentarios-proceso",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const created = await solicitudesService.addSolicitudProcessComment(
      req.user,
      solicitudId,
      req.body || {}
    );
    res.status(201).json({
      status: "ok",
      mensaje: "Comentario de proceso agregado correctamente",
      data: created,
    });
  })
);

router.put(
  "/:id/items/:itemId",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const updated = await solicitudesService.updateSolicitudItem(
      req.user,
      solicitudId,
      itemId,
      req.body || {}
    );
    res.json({
      status: "ok",
      mensaje: "Item actualizado correctamente",
      data: updated,
    });
  })
);

router.post(
  "/:id/items",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const created = await solicitudesService.createSolicitudItem(req.user, solicitudId, req.body || {});
    const { meta, ...data } = created || {};
    const reusedExistingItem = meta?.action === "existing_item_reused";
    res.status(reusedExistingItem ? 200 : 201).json({
      status: "ok",
      mensaje: reusedExistingItem
        ? `El producto ya existía en la solicitud #${solicitudId}; no se duplicó`
        : "Item creado correctamente",
      data,
      ...(meta ? { meta } : {}),
    });
  })
);

router.delete(
  "/:id/items/:itemId",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const deleted = await solicitudesService.deleteSolicitudItem(req.user, solicitudId, itemId);
    res.json({
      status: "ok",
      mensaje: "Item eliminado correctamente",
      data: deleted,
    });
  })
);

router.post(
  "/:id/mensajes",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const data = await solicitudesService.createSolicitudMessage(
      req.user,
      solicitudId,
      req.body || {}
    );
    res.status(201).json({
      status: "ok",
      mensaje: "Mensaje enviado correctamente",
      data,
    });
  })
);

router.delete(
  "/:id/mensajes/:mensajeId/imagen",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const mensajeId = Number(req.params.mensajeId);
    const data = await solicitudesService.removeSolicitudMessageImage(
      req.user,
      solicitudId,
      mensajeId
    );
    res.json({
      status: "ok",
      mensaje: "Imagen eliminada correctamente",
      data,
    });
  })
);

router.delete(
  "/:id",
  authorize(ROLES.ADMIN, ROLES.SUPERVISOR),
  asyncHandler(async (req, res) => {
    const solicitudId = Number(req.params.id);
    const deleted = await solicitudesService.deleteSolicitud(req.user, solicitudId);
    res.json({
      status: "ok",
      mensaje: "Solicitud eliminada correctamente",
      data: deleted,
    });
  })
);

module.exports = router;
