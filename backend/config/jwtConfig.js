const crypto = require("crypto");
const { esProduccion } = require("./entorno");

// Solo para desarrollo local. Esta escrito en el repositorio, asi que quien lo
// conozca puede firmar tokens validos: jamas debe quedar activo en produccion.
const SECRETO_SOLO_DESARROLLO = "fmn_dev_jwt_secret_change_me";

// Prefijo fijo de la derivacion. Si se cambia, todas las sesiones abiertas
// dejan de ser validas y cada persona tiene que volver a entrar.
const PREFIJO_DERIVACION = "fmn-jwt-secret-v1:";

function resolverJwtSecret() {
  // Lo correcto: JWT_SECRET configurado. Se usa tal cual, como siempre.
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (!esProduccion()) {
    return SECRETO_SOLO_DESARROLLO;
  }

  // Produccion sin JWT_SECRET. Antes caia en el secreto de desarrollo, que es
  // publico, y cualquiera podia fabricarse un token de ADMIN. Se deriva uno a
  // partir de la cadena de conexion de PostgreSQL (la misma variable, con la
  // misma limpieza, que usa services/userStore.js): lleva la contrasena de la
  // base, asi que no se puede adivinar, y es igual en todas las instancias, de
  // modo que un token emitido en una se valida en cualquier otra.
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (databaseUrl) {
    console.error(
      "[FMN] SEGURIDAD: falta la variable JWT_SECRET. Las sesiones se firman con un secreto derivado de DATABASE_URL; configura JWT_SECRET en las variables de entorno del despliegue."
    );
    return crypto.createHash("sha256").update(`${PREFIJO_DERIVACION}${databaseUrl}`).digest("hex");
  }

  // Sin JWT_SECRET ni base de datos no hay de donde sacar un secreto comun a
  // todas las instancias. Se mantiene el de desarrollo para no dejar el portal
  // sin inicio de sesion, pero queda avisado con todas sus letras.
  console.error(
    "[FMN] SEGURIDAD: faltan JWT_SECRET y DATABASE_URL. Se usa el secreto de desarrollo, que es público: cualquiera puede falsificar sesiones. Configura JWT_SECRET de inmediato."
  );
  return SECRETO_SOLO_DESARROLLO;
}

// Se resuelve una sola vez al cargar el modulo. authService (firma) y
// middleware/auth (verificacion) importan este mismo valor.
const JWT_SECRET = resolverJwtSecret();
// La sesion se renueva sola vía POST /api/auth/refresh mientras el usuario
// siga activo. Este plazo es el colchon si el refresh falla (ej. sin red).
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
};
