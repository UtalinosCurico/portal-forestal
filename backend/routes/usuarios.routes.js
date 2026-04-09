const express = require("express");
const controller = require("../controllers/usuarios.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/rbac.middleware");
const { ROLES } = require("../config/roles");

const router = express.Router();

router.use(authenticate);

router.get("/", authorize(ROLES.ADMINISTRADOR, ROLES.SUPERVISOR), controller.list);
router.post("/", authorize(ROLES.ADMINISTRADOR), controller.create);
router.put("/:id", authorize(ROLES.ADMINISTRADOR), controller.update);

module.exports = router;

