const inventarioModel = require("../models/inventario.model");
const { ROLES } = require("../config/roles");
const { AppError } = require("../utils/errors");
const { requireFields } = require("../utils/validators");

function canModifyInventory(role) {
  return role === ROLES.ADMINISTRADOR;
}

function canRegisterMovement(role) {
  return [ROLES.ADMINISTRADOR, ROLES.SUPERVISOR].includes(role);
}

async function listInventario(actor, filters) {
  const faenaId = actor.faenaId || filters.faenaId || null;
  return inventarioModel.listRepuestos({
    page: Number(filters.page || 1),
    limit: Number(filters.limit || 50),
    faenaId,
  });
}

async function createRepuesto(actor, payload) {
  if (!canModifyInventory(actor.role)) {
    throw new AppError("Solo Administrador puede crear repuestos", 403, "FORBIDDEN");
  }
  requireFields(payload, ["codigo", "nombre", "unidadMedida"]);
  if (
    payload.stockBodega !== undefined &&
    (!Number.isFinite(Number(payload.stockBodega)) || Number(payload.stockBodega) < 0)
  ) {
    throw new AppError("stockBodega inválido", 400, "VALIDATION_ERROR");
  }

  return inventarioModel.createRepuesto({
    codigo: payload.codigo,
    nombre: payload.nombre,
    unidadMedida: payload.unidadMedida,
    stockBodega: Number(payload.stockBodega || 0),
  });
}

async function updateRepuesto(actor, repuestoId, payload) {
  if (!canModifyInventory(actor.role)) {
    throw new AppError("Solo Administrador puede modificar inventario", 403, "FORBIDDEN");
  }
  if (
    payload.stockBodega !== undefined &&
    (!Number.isFinite(Number(payload.stockBodega)) || Number(payload.stockBodega) < 0)
  ) {
    throw new AppError("stockBodega inválido", 400, "VALIDATION_ERROR");
  }
  return inventarioModel.updateRepuesto(repuestoId, {
    codigo: payload.codigo,
    nombre: payload.nombre,
    unidadMedida: payload.unidadMedida,
    activo: payload.activo,
    stockBodega: payload.stockBodega !== undefined ? Number(payload.stockBodega) : undefined,
  });
}

async function registerMovement(actor, payload) {
  if (!canRegisterMovement(actor.role)) {
    throw new AppError("No tiene permisos para registrar movimientos", 403, "FORBIDDEN");
  }
  requireFields(payload, ["repuestoId", "tipo", "cantidad"]);
  if (!Number.isFinite(Number(payload.cantidad)) || Number(payload.cantidad) === 0) {
    throw new AppError("cantidad inválida", 400, "VALIDATION_ERROR");
  }

  return inventarioModel.registerMovement({
    repuestoId: Number(payload.repuestoId),
    faenaId: payload.faenaId ? Number(payload.faenaId) : null,
    solicitudId: payload.solicitudId ? Number(payload.solicitudId) : null,
    userId: actor.id,
    tipo: payload.tipo,
    cantidad: Number(payload.cantidad),
    origen: payload.origen,
    destino: payload.destino,
    comentario: payload.comentario,
  });
}

module.exports = {
  listInventario,
  createRepuesto,
  updateRepuesto,
  registerMovement,
};
