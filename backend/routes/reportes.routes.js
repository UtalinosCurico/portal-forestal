const express = require("express");
const controller = require("../controllers/reportes.controller");
const { authenticate } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);
router.get("/resumen", controller.resumen);

module.exports = router;

