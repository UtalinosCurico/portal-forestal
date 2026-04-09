const SOLICITUD_ITEM_STATUS = Object.freeze({
  POR_GESTIONAR: "POR_GESTIONAR",
  GESTIONADO: "GESTIONADO",
  ENVIADO: "ENVIADO",
  ENTREGADO: "ENTREGADO",
});

const SOLICITUD_ITEM_STATUS_LIST = Object.values(SOLICITUD_ITEM_STATUS);

// Transiciones válidas por estado de ítem.
// Todos los cambios de estado de ítem requieren ADMIN o SUPERVISOR (enforced en service layer).
// Las reversiones (ENVIADO→GESTIONADO, ENTREGADO→ENVIADO/GESTIONADO) están permitidas
// para corrección de errores operativos. Deben quedar registradas en historial.
const ITEM_TRANSITIONS = Object.freeze({
  [SOLICITUD_ITEM_STATUS.POR_GESTIONAR]: [
    SOLICITUD_ITEM_STATUS.GESTIONADO,
  ],
  [SOLICITUD_ITEM_STATUS.GESTIONADO]: [
    SOLICITUD_ITEM_STATUS.ENVIADO,
    SOLICITUD_ITEM_STATUS.POR_GESTIONAR,  // revertir si error antes de despacho
  ],
  [SOLICITUD_ITEM_STATUS.ENVIADO]: [
    SOLICITUD_ITEM_STATUS.ENTREGADO,
    SOLICITUD_ITEM_STATUS.GESTIONADO,     // revertir si error en despacho
  ],
  [SOLICITUD_ITEM_STATUS.ENTREGADO]: [
    SOLICITUD_ITEM_STATUS.ENVIADO,        // revertir si entrega fue registrada por error
    SOLICITUD_ITEM_STATUS.GESTIONADO,     // revertir mayor, solo ADMIN/SUPERVISOR
  ],
});

function canTransitionItemStatus(fromStatus, toStatus) {
  const allowed = ITEM_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

// Devuelve true si la transición es una reversión (avance hacia atrás).
// Usado por el service layer para registrar ESTADO_ITEM_REVERTIDO en historial.
function isItemStatusReversion(fromStatus, toStatus) {
  const order = [
    SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
    SOLICITUD_ITEM_STATUS.GESTIONADO,
    SOLICITUD_ITEM_STATUS.ENVIADO,
    SOLICITUD_ITEM_STATUS.ENTREGADO,
  ];
  const fromIdx = order.indexOf(fromStatus);
  const toIdx = order.indexOf(toStatus);
  return fromIdx > toIdx;
}

module.exports = {
  SOLICITUD_ITEM_STATUS,
  SOLICITUD_ITEM_STATUS_LIST,
  ITEM_TRANSITIONS,
  canTransitionItemStatus,
  isItemStatusReversion,
};
