const JWT_SECRET = process.env.JWT_SECRET || "fmn_dev_jwt_secret_change_me";
// La sesion se renueva sola vía POST /api/auth/refresh mientras el usuario
// siga activo. Este plazo es el colchon si el refresh falla (ej. sin red).
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
};

