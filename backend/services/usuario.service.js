const bcrypt = require("bcryptjs");
const userModel = require("../models/user.model");
const { ROLES } = require("../config/roles");
const { AppError } = require("../utils/errors");
const { validateEmail, requireFields } = require("../utils/validators");

function assertAdmin(actor) {
  if (actor.role !== ROLES.ADMINISTRADOR) {
    throw new AppError("Solo el Administrador puede gestionar usuarios", 403, "FORBIDDEN");
  }
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }
  // Remove sensitive fields before sending to clients.
  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

async function listUsers(actor, filters) {
  if (![ROLES.ADMINISTRADOR, ROLES.SUPERVISOR].includes(actor.role)) {
    throw new AppError("No tiene permisos para ver usuarios", 403, "FORBIDDEN");
  }
  const users = await userModel.list(filters);
  return users.map(sanitizeUser);
}

async function createUser(actor, payload) {
  assertAdmin(actor);
  requireFields(payload, ["nombre", "email", "password", "role"]);
  if (!validateEmail(payload.email)) {
    throw new AppError("Email inválido", 400, "VALIDATION_ERROR");
  }

  const role = await userModel.findRoleByName(payload.role);
  if (!role) {
    throw new AppError("Rol inválido", 400, "VALIDATION_ERROR");
  }

  if ([ROLES.JEFE_FAENA, ROLES.OPERADOR].includes(payload.role) && !payload.faenaId) {
    throw new AppError("faenaId es obligatorio para Jefe de faena y Operador", 400, "VALIDATION_ERROR");
  }

  const existing = await userModel.findByEmail(payload.email);
  if (existing) {
    throw new AppError("El email ya está registrado", 409, "CONFLICT");
  }

  const passwordHash = await bcrypt.hash(payload.password, 10);
  const created = await userModel.create({
    nombre: payload.nombre,
    email: payload.email,
    passwordHash,
    roleId: role.id,
    faenaId: payload.faenaId || null,
    activo: payload.activo !== undefined ? !!payload.activo : true,
  });
  return sanitizeUser(created);
}

async function updateUser(actor, userId, payload) {
  assertAdmin(actor);
  const current = await userModel.findById(userId);
  if (!current) {
    throw new AppError("Usuario no encontrado", 404, "NOT_FOUND");
  }

  let roleId;
  if (payload.role) {
    const role = await userModel.findRoleByName(payload.role);
    if (!role) {
      throw new AppError("Rol inválido", 400, "VALIDATION_ERROR");
    }
    roleId = role.id;
  }

  if (payload.email && !validateEmail(payload.email)) {
    throw new AppError("Email inválido", 400, "VALIDATION_ERROR");
  }

  let passwordHash;
  if (payload.password) {
    passwordHash = await bcrypt.hash(payload.password, 10);
  }

  const updated = await userModel.update(userId, {
    nombre: payload.nombre,
    email: payload.email,
    passwordHash,
    roleId,
    faenaId: payload.faenaId,
    activo: payload.activo,
  });
  return sanitizeUser(updated);
}

module.exports = {
  listUsers,
  createUser,
  updateUser,
};
