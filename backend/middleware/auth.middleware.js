const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { AppError } = require("../utils/errors");
const userModel = require("../models/user.model");

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new AppError("Token de acceso requerido", 401, "UNAUTHORIZED");
    }

    const payload = jwt.verify(token, env.jwtSecret);
    const user = await userModel.findById(payload.sub);
    if (!user || !user.activo) {
      throw new AppError("Usuario no autorizado o inactivo", 401, "UNAUTHORIZED");
    }

    req.user = {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      role: user.role_name,
      faenaId: user.faena_id,
      activo: user.activo,
    };
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      next(new AppError("Token inválido o expirado", 401, "UNAUTHORIZED"));
      return;
    }
    next(error);
  }
}

module.exports = {
  authenticate,
};

