const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { normalizeRole } = require("../config/appRoles");
const { JWT_SECRET, JWT_EXPIRES_IN } = require("../config/jwtConfig");
const { HttpError } = require("../utils/httpError");
const { normalizeEmail, validateEmail } = require("../utils/validators");
const { findUserByEmail, findUserById } = require("./userStore");

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function sanitizeUser(user) {
  const nombre = user.nombre || user.name;
  const rol = normalizeRole(user.rol || user.role);
  const activo = normalizeBoolean(user.activo ?? user.active);
  const archivado = normalizeBoolean(user.archivado);
  const fechaCreacion = user.fecha_creacion || user.created_at;

  return {
    id: user.id,
    nombre,
    name: nombre,
    email: normalizeEmail(user.email),
    rol,
    role: rol,
    equipo_id: user.equipo_id || null,
    equipo_nombre: user.equipo_nombre || null,
    activo,
    active: activo,
    archivado,
    fecha_creacion: fechaCreacion,
    created_at: fechaCreacion,
  };
}

function createToken(user) {
  const rol = normalizeRole(user.rol || user.role);

  return jwt.sign(
    {
      role: rol,
      email: user.email,
      equipo_id: user.equipo_id || null,
    },
    JWT_SECRET,
    {
      subject: String(user.id),
      expiresIn: JWT_EXPIRES_IN,
    }
  );
}

async function login(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new HttpError(400, "Email y contrasena son obligatorios");
  }

  if (!validateEmail(normalizedEmail)) {
    throw new HttpError(400, "Email invalido");
  }

  const user = await findUserByEmail(normalizedEmail);

  if (!user || !normalizeBoolean(user.activo) || normalizeBoolean(user.archivado)) {
    throw new HttpError(401, "Credenciales invalidas");
  }

  if (!user.password_hash) {
    throw new HttpError(401, "Credenciales invalidas");
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    throw new HttpError(401, "Credenciales invalidas");
  }

  return {
    token: createToken(user),
    user: sanitizeUser(user),
  };
}

async function getProfile(userId) {
  const user = await findUserById(userId);

  if (!user || !normalizeBoolean(user.activo) || normalizeBoolean(user.archivado)) {
    throw new HttpError(404, "Usuario no encontrado o inactivo");
  }

  return sanitizeUser(user);
}

module.exports = {
  login,
  getProfile,
};

