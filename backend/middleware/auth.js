const jwt = require("jsonwebtoken");
const { normalizeRole } = require("../config/appRoles");
const { JWT_SECRET } = require("../config/jwtConfig");
const { HttpError } = require("../utils/httpError");
const { findUserById } = require("../services/userStore");

// Stream de avisos en vivo (SSE). EventSource no permite mandar encabezados,
// asi que es la UNICA ruta que acepta el token en la URL. En cualquier otra,
// un ?token= quedaria escrito en logs, en el historial y en el Referer: se
// ignora y la request tiene que traer el encabezado Authorization.
const RUTA_STREAM_SSE = "/api/notificaciones/stream";

function aceptaTokenEnQuery(req) {
  if (req.method !== "GET") {
    return false;
  }
  // baseUrl + path es la ruta completa sin query, monte donde se monte el
  // middleware. Express no distingue mayusculas ni la barra final al enrutar,
  // asi que la comparacion tampoco.
  const ruta = `${req.baseUrl || ""}${req.path || ""}`.replace(/\/+$/, "").toLowerCase();
  return ruta === RUTA_STREAM_SSE;
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function extractTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, headerToken] = authHeader.split(" ");
  if (scheme === "Bearer" && headerToken) {
    return headerToken;
  }

  const queryToken = aceptaTokenEnQuery(req) ? String(req.query?.token || "").trim() : "";
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
    throw new HttpError(401, "Token de autenticación requerido");
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

