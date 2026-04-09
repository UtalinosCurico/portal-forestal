const express = require("express");
const controller = require("../controllers/powerbi.controller");
const { authenticate } = require("../middleware/auth.middleware");

const router = express.Router();

router.use(authenticate);
router.get("/config", controller.getConfig);

module.exports = router;

