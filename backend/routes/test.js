const express = require("express");

const router = express.Router();

// Endpoint de prueba para validar conectividad API.
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    mensaje: "API funcionando correctamente",
  });
});

module.exports = router;

