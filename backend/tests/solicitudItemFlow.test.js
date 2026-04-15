const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SOLICITUD_ITEM_STATUS,
  SOLICITUD_ITEM_STATUS_LIST,
  canTransitionItemStatus,
  isItemStatusReversion,
} = require("../config/solicitudItemFlow");

test("flujo de item incluye estado NO_APLICA", () => {
  assert.equal(SOLICITUD_ITEM_STATUS.NO_APLICA, "NO_APLICA");
  assert.equal(SOLICITUD_ITEM_STATUS_LIST.includes("NO_APLICA"), true);
});

test("flujo de item permite pasar entre seguimiento y NO_APLICA", () => {
  assert.equal(
    canTransitionItemStatus(SOLICITUD_ITEM_STATUS.POR_GESTIONAR, SOLICITUD_ITEM_STATUS.NO_APLICA),
    true
  );
  assert.equal(
    canTransitionItemStatus(SOLICITUD_ITEM_STATUS.NO_APLICA, SOLICITUD_ITEM_STATUS.GESTIONADO),
    true
  );
});

test("marcar un item como NO_APLICA desde entregado cuenta como reversion", () => {
  assert.equal(
    isItemStatusReversion(SOLICITUD_ITEM_STATUS.ENTREGADO, SOLICITUD_ITEM_STATUS.NO_APLICA),
    true
  );
});
