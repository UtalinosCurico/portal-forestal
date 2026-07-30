// Recibe los fallos que ocurren en el navegador de la gente y los hace llegar
// a quien administra el portal.
//
// Antes esos fallos morian donde ocurrian: la persona veia algo raro, no habia
// nada que mirar, y el problema podia vivir dias. Ahora quedan en el mismo
// registro que los errores del servidor (/api/admin/error-log) y ademas
// disparan un aviso, que llega al telefono por la notificacion push que el
// portal ya tiene configurada.
//
// Por que push y no correo ni SMS: el correo necesita un servidor de envio con
// credenciales, y el SMS un servicio de pago. El push ya funciona hoy, sin
// costo y sin depender de nadie mas. Si mas adelante hace falta el correo,
// se engancha aca mismo.

const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { recordApiError } = require("../middleware/errorHandlers");
const notificacionesService = require("../services/notificacionesService");
const logger = require("../utils/logger");

const router = express.Router();
router.use(authenticate);

// Un fallo que se repite en bucle no puede convertirse en cien avisos al
// telefono. Se avisa una vez por mensaje distinto dentro de esta ventana; el
// resto igual queda registrado, solo que sin sonar.
const VENTANA_AVISO_MS = 10 * 60 * 1000;
const avisadosRecientemente = new Map();

function yaSeAviso(clave) {
  const ahora = Date.now();

  // Limpieza oportunista: sin esto el mapa crece para siempre.
  for (const [k, cuando] of avisadosRecientemente) {
    if (ahora - cuando > VENTANA_AVISO_MS) avisadosRecientemente.delete(k);
  }

  if (avisadosRecientemente.has(clave)) {
    return true;
  }
  avisadosRecientemente.set(clave, ahora);
  return false;
}

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { mensaje, donde, vista, origen } = req.body || {};
    const texto = String(mensaje || "").trim().slice(0, 300);

    if (!texto) {
      res.json({ status: "ok", data: { registrado: false } });
      return;
    }

    const quien = req.user?.nombre || req.user?.name || "Usuario";

    // Queda en el mismo registro que los errores del servidor, para poder
    // revisarlo todo en un solo lugar.
    recordApiError(
      { method: "NAVEGADOR", originalUrl: `/${vista || "?"}`, user: req.user },
      0,
      `[${origen || "cliente"}] ${texto}${donde ? ` — ${donde}` : ""}`
    );

    logger.warn("fallo en el navegador de un usuario", { quien, vista, texto, donde });

    // Se responde ya: el navegador no tiene por que esperar a que se avise.
    res.json({ status: "ok", data: { registrado: true } });

    if (yaSeAviso(texto)) {
      return;
    }

    notificacionesService
      .createFalloClienteNotification({ texto, vista, quien })
      .catch((error) => {
        logger.warn("no se pudo avisar del fallo de cliente", { errorMessage: error?.message });
      });
  })
);

module.exports = router;
