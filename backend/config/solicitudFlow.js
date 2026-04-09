const SOLICITUD_STATUS = Object.freeze({
  PENDIENTE: "PENDIENTE",
  EN_REVISION: "EN_REVISION",
  APROBADO: "APROBADO",
  EN_DESPACHO: "EN_DESPACHO",
  ENTREGADO: "ENTREGADO",
  RECHAZADO: "RECHAZADO",
});

// Transiciones estructuralmente válidas por estado.
// Estas definen qué caminos existen, no quién puede ejecutarlos.
// El control de roles vive en el service layer.
//
// Estados derivados por ítems (el sistema los recalcula automáticamente):
//   PENDIENTE, EN_REVISION, EN_DESPACHO, ENTREGADO
//
// Overrides administrativos (decisión explícita de ADMIN/SUPERVISOR):
//   APROBADO  — persiste solo mientras no haya avance de ítems
//   RECHAZADO — bloquea derivación; solo ADMIN/SUPERVISOR pueden reabrirla
const STATUS_TRANSITIONS = Object.freeze({
  [SOLICITUD_STATUS.PENDIENTE]:   [
    SOLICITUD_STATUS.APROBADO,
    SOLICITUD_STATUS.EN_REVISION,  // auto-derivado cuando ítems avanzan
    SOLICITUD_STATUS.RECHAZADO,
  ],
  [SOLICITUD_STATUS.EN_REVISION]: [
    SOLICITUD_STATUS.APROBADO,
    SOLICITUD_STATUS.EN_DESPACHO,  // auto-derivado cuando todos ENVIADO/ENTREGADO
    SOLICITUD_STATUS.RECHAZADO,
  ],
  [SOLICITUD_STATUS.APROBADO]:    [
    SOLICITUD_STATUS.EN_REVISION,  // auto-derivado cuando ítems avanzan
    SOLICITUD_STATUS.EN_DESPACHO,  // auto-derivado o despacho masivo
    SOLICITUD_STATUS.ENTREGADO,    // auto-derivado cuando todos ENTREGADO
    SOLICITUD_STATUS.RECHAZADO,
  ],
  [SOLICITUD_STATUS.EN_DESPACHO]: [
    SOLICITUD_STATUS.ENTREGADO,    // confirmación de recepción
    SOLICITUD_STATUS.EN_REVISION,  // auto-derivado si ítem es revertido
    SOLICITUD_STATUS.RECHAZADO,
  ],
  [SOLICITUD_STATUS.ENTREGADO]:   [
    SOLICITUD_STATUS.EN_DESPACHO,  // auto-derivado si ítem ENTREGADO es revertido
  ],
  [SOLICITUD_STATUS.RECHAZADO]:   [
    SOLICITUD_STATUS.PENDIENTE,    // reapertura — requiere todos ítems en POR_GESTIONAR
  ],
});

function canTransition(fromStatus, toStatus) {
  const allowed = STATUS_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

module.exports = {
  SOLICITUD_STATUS,
  STATUS_TRANSITIONS,
  canTransition,
};
