const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SOLICITUD_ITEM_STATUS,
  SOLICITUD_ITEM_STATUS_LIST,
  canTransitionItemStatus,
  isItemStatusReversion,
} = require("../config/solicitudItemFlow");

test("flujo de item incluye estados N/A y resuelto en faena", () => {
  assert.equal(SOLICITUD_ITEM_STATUS.NO_APLICA, "NO_APLICA");
  assert.equal(SOLICITUD_ITEM_STATUS.RESUELTO_FAENA, "RESUELTO_FAENA");
  assert.equal(SOLICITUD_ITEM_STATUS_LIST.includes("NO_APLICA"), true);
  assert.equal(SOLICITUD_ITEM_STATUS_LIST.includes("RESUELTO_FAENA"), true);
});

test("flujo de item permite pasar entre seguimiento, N/A y resuelto en faena", () => {
  assert.equal(
    canTransitionItemStatus(SOLICITUD_ITEM_STATUS.POR_GESTIONAR, SOLICITUD_ITEM_STATUS.NO_APLICA),
    true
  );
  assert.equal(
    canTransitionItemStatus(SOLICITUD_ITEM_STATUS.NO_APLICA, SOLICITUD_ITEM_STATUS.GESTIONADO),
    true
  );
  assert.equal(
    canTransitionItemStatus(
      SOLICITUD_ITEM_STATUS.POR_GESTIONAR,
      SOLICITUD_ITEM_STATUS.RESUELTO_FAENA
    ),
    true
  );
  assert.equal(
    canTransitionItemStatus(
      SOLICITUD_ITEM_STATUS.RESUELTO_FAENA,
      SOLICITUD_ITEM_STATUS.GESTIONADO
    ),
    true
  );
});

test("marcar un item como NO_APLICA desde entregado cuenta como reversion", () => {
  assert.equal(
    isItemStatusReversion(SOLICITUD_ITEM_STATUS.ENTREGADO, SOLICITUD_ITEM_STATUS.NO_APLICA),
    true
  );
});

test("marcar un item como resuelto en faena desde entregado cuenta como reversion", () => {
  assert.equal(
    isItemStatusReversion(
      SOLICITUD_ITEM_STATUS.ENTREGADO,
      SOLICITUD_ITEM_STATUS.RESUELTO_FAENA
    ),
    true
  );
});

test("pasar entre N/A y resuelto en faena no cuenta como reversion", () => {
  assert.equal(
    isItemStatusReversion(
      SOLICITUD_ITEM_STATUS.NO_APLICA,
      SOLICITUD_ITEM_STATUS.RESUELTO_FAENA
    ),
    false
  );
  assert.equal(
    isItemStatusReversion(
      SOLICITUD_ITEM_STATUS.RESUELTO_FAENA,
      SOLICITUD_ITEM_STATUS.NO_APLICA
    ),
    false
  );
});
