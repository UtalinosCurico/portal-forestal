const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { run, all, get } = require("../database/db");
const { ROLES } = require("../config/appRoles");
const { HttpError } = require("../utils/errors");

const router = express.Router();
router.use(authenticate);

const ALL_ROLES = [
  ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR,
];

// POST /api/feedback
router.post(
  "/",
  authorize(...ALL_ROLES),
  asyncHandler(async (req, res) => {
    const { tipo, titulo, descripcion } = req.body;

    if (!titulo?.trim() || !descripcion?.trim()) {
      throw new HttpError(400, "Título y descripción son obligatorios");
    }

    const tipoValido = ["idea", "error"].includes(tipo) ? tipo : "idea";

    await run(
      `INSERT INTO feedback (tipo, titulo, descripcion, autor_id, autor_nombre)
       VALUES (?, ?, ?, ?, ?)`,
      [
        tipoValido,
        titulo.trim().slice(0, 120),
        descripcion.trim().slice(0, 1000),
        req.user.id || null,
        req.user.nombre || req.user.name || "Usuario",
      ]
    );

    res.json({ status: "ok", data: { message: "Feedback recibido. ¡Gracias!" } });
  })
);

// GET /api/feedback — solo ADMIN
router.get(
  "/",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const rows = await all(
      `SELECT * FROM feedback ORDER BY leido ASC, created_at DESC`
    );
    res.json({ status: "ok", data: rows });
  })
);

// PATCH /api/feedback/:id/leido
router.patch(
  "/:id/leido",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    await run(`UPDATE feedback SET leido = 1 WHERE id = ?`, [req.params.id]);
    res.json({ status: "ok" });
  })
);

// DELETE /api/feedback/:id
router.delete(
  "/:id",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    await run(`DELETE FROM feedback WHERE id = ?`, [req.params.id]);
    res.json({ status: "ok" });
  })
);

// GET /api/feedback/count
router.get(
  "/count",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const row = await get(`SELECT COUNT(*) AS total FROM feedback WHERE leido = 0`);
    res.json({ status: "ok", data: { unread: row?.total || 0 } });
  })
);

module.exports = router;
