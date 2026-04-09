// DEPRECATED: Este archivo no está activo en producción.
// El stack de producción usa backend/config/solicitudFlow.js (valores UPPERCASE).
// Este archivo es usado únicamente por solicitud.service.js y el stack legacy de app.js,
// que no es el entry point de Vercel (server.js es el correcto).
// No eliminar hasta confirmar que app.js y su stack ya no se usan en ningún entorno.

const STATUS = Object.freeze({
  PENDIENTE: "pendiente",
  EN_REVISION: "en gestion",
  APROBADO: "aprobado",
  EN_DESPACHO: "en despacho",
  ENTREGADO: "entregado",
  RECHAZADO: "rechazado",
});

const TRANSITIONS = Object.freeze(
  Object.fromEntries(Object.values(STATUS).map((status) => [status, Object.values(STATUS)]))
);

function canTransition(fromStatus, toStatus) {
  return Boolean(TRANSITIONS[fromStatus]?.includes(toStatus));
}

module.exports = {
  STATUS,
  TRANSITIONS,
  canTransition,
};
