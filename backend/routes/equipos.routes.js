const express = require("express");
const controller = require("../controllers/equipos.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { authorize } = require("../middleware/rbac.middleware");
const { ROLES } = require("../config/roles");

const router = express.Router();

router.use(authenticate);

router.get("/", controller.list);
router.post("/", authorize(ROLES.ADMINISTRADOR, ROLES.SUPERVISOR), controller.create);
router.put("/:id", authorize(ROLES.ADMINISTRADOR, ROLES.SUPERVISOR), controller.update);

module.exports = router;

