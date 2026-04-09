const express = require("express");
const controller = require("../controllers/solicitudes.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { attachAuditContext } = require("../middleware/audit.middleware");

const router = express.Router();

router.use(authenticate);
router.use(attachAuditContext);

router.get("/", controller.list);
router.get("/:id", controller.getById);
router.get("/:id/historial", controller.historial);
router.post("/", controller.create);
router.put("/:id", controller.update);

module.exports = router;

