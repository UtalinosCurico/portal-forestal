const equipoModel = require("../models/equipo.model");
const { ROLES } = require("../config/roles");
const { AppError } = require("../utils/errors");
const { requireFields } = require("../utils/validators");

function canEditEquipos(role) {
  return [ROLES.ADMINISTRADOR, ROLES.SUPERVISOR].includes(role);
}

async function listEquipos(actor, filters) {
  const defaultFaena = actor.role === ROLES.JEFE_FAENA || actor.role === ROLES.OPERADOR ? actor.faenaId : undefined;
  return equipoModel.list({
    page: Number(filters.page || 1),
    limit: Number(filters.limit || 50),
    faenaId: filters.faenaId ? Number(filters.faenaId) : defaultFaena,
    activo: filters.activo !== undefined ? String(filters.activo) === "true" : undefined,
  });
}

async function createEquipo(actor, payload) {
  if (!canEditEquipos(actor.role)) {
    throw new AppError("No tiene permisos para crear equipos", 403, "FORBIDDEN");
  }
  requireFields(payload, ["codigo", "nombre", "faenaId"]);
  return equipoModel.create({
    codigo: payload.codigo,
    nombre: payload.nombre,
    faenaId: Number(payload.faenaId),
  });
}

async function updateEquipo(actor, id, payload) {
  if (!canEditEquipos(actor.role)) {
    throw new AppError("No tiene permisos para actualizar equipos", 403, "FORBIDDEN");
  }
  const equipo = await equipoModel.update(id, {
    codigo: payload.codigo,
    nombre: payload.nombre,
    faenaId: payload.faenaId ? Number(payload.faenaId) : undefined,
    activo: payload.activo,
  });
  if (!equipo) {
    throw new AppError("Equipo no encontrado", 404, "NOT_FOUND");
  }
  return equipo;
}

module.exports = {
  listEquipos,
  createEquipo,
  updateEquipo,
};

