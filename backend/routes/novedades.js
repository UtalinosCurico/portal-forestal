const express = require("express");
const fs = require("fs");
const path = require("path");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { run, all } = require("../database/db");
const { ROLES } = require("../config/appRoles");
const { HttpError } = require("../utils/errors");

const router = express.Router();
router.use(authenticate);

const ALL_ROLES = [
  ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR,
];

const CHANGELOG_PATH = path.join(__dirname, "../../backend/data/changelog.json");

function readChangelogEntries() {
  try {
    const data = JSON.parse(fs.readFileSync(CHANGELOG_PATH, "utf8"));
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

// GET /api/novedades — todos los roles autenticados
// Lee del archivo changelog.json (auto-generado por GitHub Actions) + tabla DB (admin manual)
router.get(
  "/",
  authorize(...ALL_ROLES),
  asyncHandler(async (req, res) => {
    const fileEntries = readChangelogEntries();
    const dbRows = await all(`SELECT * FROM novedades ORDER BY created_at DESC`);

    const merged = [...fileEntries, ...dbRows].sort(
      (a, b) => (b.created_at || "").localeCompare(a.created_at || "")
    );

    res.json({ status: "ok", data: merged });
  })
);

// GET /api/novedades/count?since=ISO_DATE — cantidad de entradas nuevas (para badge)
router.get(
  "/count",
  authorize(...ALL_ROLES),
  asyncHandler(async (req, res) => {
    const since = req.query.since ? String(req.query.since).slice(0, 30) : null;
    const fileEntries = readChangelogEntries();
    const dbRows = await all(`SELECT id, created_at FROM novedades`);
    const all_entries = [...fileEntries, ...dbRows];

    const count = since
      ? all_entries.filter((e) => (e.created_at || "") > since).length
      : all_entries.length;

    res.json({ status: "ok", data: { count } });
  })
);

// POST /api/novedades — solo ADMIN (entrada manual)
router.post(
  "/",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const { tipo, titulo, descripcion } = req.body;
    if (!titulo?.trim() || !descripcion?.trim()) {
      throw new HttpError(400, "Título y descripción son obligatorios");
    }
    const tipoValido = ["feature", "mejora", "fix"].includes(tipo) ? tipo : "feature";
    await run(
      `INSERT INTO novedades (tipo, titulo, descripcion, autor_nombre) VALUES (?, ?, ?, ?)`,
      [tipoValido, titulo.trim().slice(0, 120), descripcion.trim().slice(0, 1000),
       req.user.nombre || req.user.name || "Admin"]
    );
    res.json({ status: "ok", data: { message: "Novedad publicada." } });
  })
);

// DELETE /api/novedades/:id — solo ADMIN (borra entrada manual de DB)
router.delete(
  "/:id",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    await run(`DELETE FROM novedades WHERE id = ?`, [req.params.id]);
    res.json({ status: "ok" });
  })
);

module.exports = router;
