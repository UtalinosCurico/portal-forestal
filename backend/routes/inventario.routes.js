const express = require("express");
const controller = require("../controllers/inventario.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/rbac.middleware");
const { ROLES } = require("../config/roles");

const router = express.Router();

router.use(authenticate);

router.get("/", controller.list);
router.post("/", authorize(ROLES.ADMINISTRADOR), controller.create);
router.put("/:id", authorize(ROLES.ADMINISTRADOR), controller.update);
router.post(
  "/movimientos",
  authorize(ROLES.ADMINISTRADOR, ROLES.SUPERVISOR),
  controller.registerMovement
);

module.exports = router;

