const express = require("express");
const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { requireFields } = require("../utils/validators");

const router = express.Router();

router.post(
  "/login",
  validate((req) => requireFields(req.body, ["email", "password"])),
  authController.login
);
router.post(
  "/refresh",
  validate((req) => requireFields(req.body, ["refreshToken"])),
  authController.refresh
);
router.post("/logout", authController.logout);
router.get("/me", authenticate, authController.me);

module.exports = router;

