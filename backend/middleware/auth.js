const jwt = require("jsonwebtoken");
const { normalizeRole } = require("../config/appRoles");
const { JWT_SECRET } = require("../config/jwtConfig");
const { HttpError } = require("../utils/httpError");
const { findUserById } = require("../services/userStore");

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function extractTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, headerToken] = authHeader.split(" ");
  if (scheme === "Bearer" && headerToken) {
    return headerToken;
  }

  const queryToken = String(req.query?.token || "").trim();
  if (queryToken) {
    return queryToken;
  }

  const headerFallbackToken = String(req.headers["x-access-token"] || "").trim();
  if (headerFallbackToken) {
    return headerFallbackToken;
  }

  return "";
}

async function resolveUserFromToken(token) {
  if (!token) {
    throw new HttpError(401, "Token de autenticacion requerido");
  }

  const payload = jwt.verify(token, JWT_SECRET);
  const user = await findUserById(payload.sub);

  if (!user || !normalizeBoolean(user.activo ?? user.active) || normalizeBoolean(user.archivado)) {
    throw new HttpError(401, "Usuario invalido o inactivo");
  }

  return user;
}

async function authenticate(req, res, next) {
  try {
    const token = extractTokenFromRequest(req);
    const user = await resolveUserFromToken(token);
    user.rol = normalizeRole(user.rol);
    user.role = user.rol;
    req.user = user;
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, "Token invalido o expirado"));
  }
}

module.exports = {
  authenticate,
  extractTokenFromRequest,
  resolveUserFromToken,
};

