// Freno a quien intenta adivinar contrasenas en el inicio de sesion.
//
// Cada intento fallido deja una fila por clave: "email:<correo>" y
// "ip:<direccion>". Antes de revisar la contrasena se cuentan los fallos de
// los ultimos 15 minutos; si son demasiados se responde 429 sin mirarla.
//
// Los intentos viven en la base y no en memoria: en Vercel cada request puede
// caer en una instancia distinta y las instancias se reciclan, asi que un
// contador en memoria se reiniciaria solo y no frenaria a nadie. En produccion
// la tabla esta en PostgreSQL; en local, en SQLite (mismo patron que feedback).
//
// Nada de esto puede impedir un inicio de sesion valido: si la base falla al
// contar o al anotar, queda en el log y el login sigue su curso normal.

const net = require("net");
const { run, all } = require("../database/db");
const { isOperationalPgEnabled, getOperationalPool } = require("./operationalPgStore");
const { esVercel } = require("../config/entorno");
const { HttpError } = require("../utils/httpError");

const VENTANA_MINUTOS = 15;
const MAX_FALLOS_POR_EMAIL = 8;
const MAX_FALLOS_POR_IP = 30;
// Pasado un dia un intento ya no sirve para nada: se borra al anotar otro.
const RETENCION_HORAS = 24;
// Ningun correo real pasa de 254 caracteres. El tope evita que alguien llene
// la tabla mandando "correos" de varios megabytes.
const LARGO_MAXIMO_EMAIL = 254;

const MENSAJE_DEMASIADOS_INTENTOS =
  "Demasiados intentos de inicio de sesión. Espera 15 minutos e inténtalo de nuevo.";

function claveEmail(email) {
  const valor = String(email || "").trim().toLowerCase().slice(0, LARGO_MAXIMO_EMAIL);
  return valor ? `email:${valor}` : null;
}

function claveIp(ip) {
  const valor = String(ip || "").trim();
  return valor ? `ip:${valor}` : null;
}

/**
 * IP del cliente para la clave "ip:".
 *
 * La app no tiene "trust proxy", asi que req.ip es la direccion del socket. En
 * Vercel esa direccion es la del proxy interno y es la misma para todos: usarla
 * juntaria a todo el mundo en un solo contador y bastarian 30 fallos de
 * cualquiera para bloquear a todos. El borde de Vercel reescribe
 * x-forwarded-for con la IP real (descarta lo que mande el cliente), asi que
 * ahi su primer valor es confiable. Fuera de Vercel ese encabezado lo puede
 * inventar cualquiera y no se toma en cuenta.
 */
function obtenerIpCliente(req) {
  // Si algun dia se configura "trust proxy", Express ya resuelve la IP real.
  if (req.app && req.app.get("trust proxy")) {
    return req.ip || "";
  }

  if (esVercel()) {
    const encabezado = req.headers?.["x-forwarded-for"];
    const primera = String(Array.isArray(encabezado) ? encabezado[0] : encabezado || "")
      .split(",")[0]
      .trim();
    // Sin una IP valida no se cuenta por IP (queda el limite por correo): es
    // preferible a meter a todos en el contador del proxy.
    return net.isIP(primera) ? primera : "";
  }

  return req.ip || req.socket?.remoteAddress || "";
}

async function contarFallosRecientes(claves) {
  const conteo = new Map(claves.map((clave) => [clave, 0]));
  if (!claves.length) {
    return conteo;
  }

  let filas;
  if (isOperationalPgEnabled()) {
    const resultado = await getOperationalPool().query(
      `SELECT clave, COUNT(*)::int AS total
         FROM login_intentos
        WHERE clave = ANY($1::text[])
          AND creado_en > NOW() - ($2 || ' minutes')::interval
        GROUP BY clave`,
      // Mismo patron de intervalo que notificacionesPgService (ya probado en PostgreSQL).
      [claves, String(VENTANA_MINUTOS)]
    );
    filas = resultado.rows;
  } else {
    const marcadores = claves.map(() => "?").join(", ");
    filas = await all(
      `SELECT clave, COUNT(*) AS total
         FROM login_intentos
        WHERE clave IN (${marcadores})
          AND creado_en > datetime('now', ?)
        GROUP BY clave`,
      [...claves, `-${VENTANA_MINUTOS} minutes`]
    );
  }

  for (const fila of filas) {
    conteo.set(fila.clave, Number(fila.total) || 0);
  }
  return conteo;
}

async function insertarIntentos(claves) {
  if (!claves.length) {
    return;
  }

  if (isOperationalPgEnabled()) {
    const valores = claves.map((_, indice) => `($${indice + 1})`).join(", ");
    await getOperationalPool().query(`INSERT INTO login_intentos (clave) VALUES ${valores}`, claves);
    return;
  }

  const valores = claves.map(() => "(?)").join(", ");
  await run(`INSERT INTO login_intentos (clave) VALUES ${valores}`, claves);
}

async function borrarIntentosViejos() {
  if (isOperationalPgEnabled()) {
    await getOperationalPool().query(
      "DELETE FROM login_intentos WHERE creado_en < NOW() - ($1 || ' hours')::interval",
      [String(RETENCION_HORAS)]
    );
    return;
  }

  await run("DELETE FROM login_intentos WHERE creado_en < datetime('now', ?)", [
    `-${RETENCION_HORAS} hours`,
  ]);
}

async function borrarIntentosDeClave(clave) {
  if (!clave) {
    return;
  }

  if (isOperationalPgEnabled()) {
    await getOperationalPool().query("DELETE FROM login_intentos WHERE clave = $1", [clave]);
    return;
  }

  await run("DELETE FROM login_intentos WHERE clave = ?", [clave]);
}

function describirError(error) {
  return error?.message || String(error);
}

/**
 * Lanza 429 si el correo o la IP acumulan demasiados fallos recientes. Se
 * llama ANTES de buscar al usuario y de comparar la contrasena. Si la base
 * falla al contar, deja pasar: un problema de esta contabilidad no puede
 * dejar a nadie afuera.
 */
async function verificarIntentos({ email, ip }) {
  const deEmail = claveEmail(email);
  const deIp = claveIp(ip);

  let conteo;
  try {
    conteo = await contarFallosRecientes([deEmail, deIp].filter(Boolean));
  } catch (error) {
    console.error("[FMN] No se pudieron contar los intentos de inicio de sesión:", describirError(error));
    return;
  }

  const bloqueadoPorEmail = Boolean(deEmail) && conteo.get(deEmail) >= MAX_FALLOS_POR_EMAIL;
  const bloqueadoPorIp = Boolean(deIp) && conteo.get(deIp) >= MAX_FALLOS_POR_IP;
  if (bloqueadoPorEmail || bloqueadoPorIp) {
    throw new HttpError(429, MENSAJE_DEMASIADOS_INTENTOS);
  }
}

/** Anota un inicio de sesion fallido para el correo y la IP. Nunca lanza. */
async function registrarFallo({ email, ip }) {
  try {
    await insertarIntentos([claveEmail(email), claveIp(ip)].filter(Boolean));
  } catch (error) {
    console.error("[FMN] No se pudo anotar el intento fallido de inicio de sesión:", describirError(error));
  }

  // Limpieza de paso: barato, y asi la tabla nunca guarda mas de un dia.
  try {
    await borrarIntentosViejos();
  } catch (error) {
    console.error("[FMN] No se pudieron borrar los intentos de inicio de sesión antiguos:", describirError(error));
  }
}

/** Tras un inicio de sesion correcto, el correo parte de cero. Nunca lanza. */
async function registrarExito({ email }) {
  try {
    await borrarIntentosDeClave(claveEmail(email));
  } catch (error) {
    console.error("[FMN] No se pudieron limpiar los intentos de inicio de sesión:", describirError(error));
  }
}

module.exports = {
  obtenerIpCliente,
  verificarIntentos,
  registrarFallo,
  registrarExito,
  MENSAJE_DEMASIADOS_INTENTOS,
};
