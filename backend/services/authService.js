const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { normalizeRole } = require("../config/appRoles");
const { JWT_SECRET, JWT_EXPIRES_IN } = require("../config/jwtConfig");
const { HttpError } = require("../utils/httpError");
const { normalizeEmail, validateEmail } = require("../utils/validators");
const { findUserByEmail, findUserById } = require("./userStore");
const loginIntentos = require("./loginIntentosService");

// Hash bcrypt de una cadena aleatoria que nadie conoce (costo 10, el mismo de
// las contrasenas reales). Cuando el correo no existe se compara contra este:
// asi el rechazo tarda lo mismo que con una contrasena equivocada y el tiempo
// de respuesta no delata que correos estan registrados.
const HASH_FICTICIO = "$2a$10$LHnls0sbWyps2zjECHFmRel/zk0wWjAis6N9.PcVVd.qArKpf0LZG";

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

async function login(email, password, { ip = "" } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new HttpError(400, "Email y contrasena son obligatorios");
  }

  if (!validateEmail(normalizedEmail)) {
    throw new HttpError(400, "Email invalido");
  }

  // Freno a la fuerza bruta: se revisa antes de buscar al usuario y de mirar
  // la contrasena, asi quien esta bloqueado no puede seguir probando.
  const intento = { email: normalizedEmail, ip };
  await loginIntentos.verificarIntentos(intento);

  const user = await findUserByEmail(normalizedEmail);
  const cuentaHabilitada =
    Boolean(user) &&
    normalizeBoolean(user.activo) &&
    !normalizeBoolean(user.archivado) &&
    Boolean(user.password_hash);

  // Siempre se corre un bcrypt, aunque la cuenta no exista o este inactiva:
  // si no, ese rechazo saldria al instante y delataria que el correo no esta.
  const isValidPassword = await bcrypt.compare(
    password,
    cuentaHabilitada ? user.password_hash : HASH_FICTICIO
  );

  if (!cuentaHabilitada || !isValidPassword) {
    await loginIntentos.registrarFallo(intento);
    throw new HttpError(401, "Credenciales invalidas");
  }

  await loginIntentos.registrarExito(intento);

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

// Sesion deslizante: mientras el usuario siga activo y su token siga siendo
// valido, se emite uno nuevo para que no lo expulse a mitad de jornada.
async function refreshSession(userId) {
  const user = await findUserById(userId);

  if (!user || !normalizeBoolean(user.activo) || normalizeBoolean(user.archivado)) {
    throw new HttpError(401, "Usuario invalido o inactivo");
  }

  return {
    token: createToken(user),
    user: sanitizeUser(user),
  };
}

module.exports = {
  login,
  getProfile,
  refreshSession,
};

