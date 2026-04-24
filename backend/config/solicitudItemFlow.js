const SOLICITUD_ITEM_STATUS = Object.freeze({
  NO_APLICA: "NO_APLICA",
  RESUELTO_FAENA: "RESUELTO_FAENA",
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
  [SOLICITUD_ITEM_STATUS.NO_APLICA]: [
    SOLICITUD_ITEM_STATUS.RESUELTO_FAENA,
    SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
    SOLICITUD_ITEM_STATUS.GESTIONADO,
    SOLICITUD_ITEM_STATUS.ENVIADO,
    SOLICITUD_ITEM_STATUS.ENTREGADO,
  ],
  [SOLICITUD_ITEM_STATUS.RESUELTO_FAENA]: [
    SOLICITUD_ITEM_STATUS.NO_APLICA,
    SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
    SOLICITUD_ITEM_STATUS.GESTIONADO,
    SOLICITUD_ITEM_STATUS.ENVIADO,
    SOLICITUD_ITEM_STATUS.ENTREGADO,
  ],
  [SOLICITUD_ITEM_STATUS.POR_GESTIONAR]: [
    SOLICITUD_ITEM_STATUS.NO_APLICA,
    SOLICITUD_ITEM_STATUS.RESUELTO_FAENA,
    SOLICITUD_ITEM_STATUS.GESTIONADO,
  ],
  [SOLICITUD_ITEM_STATUS.GESTIONADO]: [
    SOLICITUD_ITEM_STATUS.NO_APLICA,
    SOLICITUD_ITEM_STATUS.RESUELTO_FAENA,
    SOLICITUD_ITEM_STATUS.ENVIADO,
    SOLICITUD_ITEM_STATUS.POR_GESTIONAR,  // revertir si error antes de despacho
  ],
  [SOLICITUD_ITEM_STATUS.ENVIADO]: [
    SOLICITUD_ITEM_STATUS.NO_APLICA,
    SOLICITUD_ITEM_STATUS.RESUELTO_FAENA,
    SOLICITUD_ITEM_STATUS.ENTREGADO,
    SOLICITUD_ITEM_STATUS.GESTIONADO,     // revertir si error en despacho
  ],
  [SOLICITUD_ITEM_STATUS.ENTREGADO]: [
    SOLICITUD_ITEM_STATUS.NO_APLICA,
    SOLICITUD_ITEM_STATUS.RESUELTO_FAENA,
    SOLICITUD_ITEM_STATUS.ENVIADO,        // revertir si entrega fue registrada por error
    SOLICITUD_ITEM_STATUS.GESTIONADO,     // revertir mayor, solo ADMIN/SUPERVISOR
  ],
});

function canTransitionItemStatus(fromStatus, toStatus) {
  // Permite pasar a cualquier estado válido distinto al actual (sin restricción jerárquica)
  return SOLICITUD_ITEM_STATUS_LIST.includes(toStatus) && fromStatus !== toStatus;
}

// Devuelve true si la transición es una reversión (avance hacia atrás).
// Usado por el service layer para registrar ESTADO_ITEM_REVERTIDO en historial.
function isItemStatusReversion(fromStatus, toStatus) {
  const rank = {
    [SOLICITUD_ITEM_STATUS.NO_APLICA]: 0,
    [SOLICITUD_ITEM_STATUS.RESUELTO_FAENA]: 0,
    [SOLICITUD_ITEM_STATUS.POR_GESTIONAR]: 1,
    [SOLICITUD_ITEM_STATUS.GESTIONADO]: 2,
    [SOLICITUD_ITEM_STATUS.ENVIADO]: 3,
    [SOLICITUD_ITEM_STATUS.ENTREGADO]: 4,
  };
  return (rank[fromStatus] ?? 0) > (rank[toStatus] ?? 0);
}

module.exports = {
  SOLICITUD_ITEM_STATUS,
  SOLICITUD_ITEM_STATUS_LIST,
  ITEM_TRANSITIONS,
  canTransitionItemStatus,
  isItemStatusReversion,
};
