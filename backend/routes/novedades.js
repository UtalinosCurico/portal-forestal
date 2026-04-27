const express = require("express");
const fs = require("fs");
const path = require("path");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { run, all } = require("../database/db");
const { ROLES } = require("../config/appRoles");
const { HttpError } = require("../utils/errors");
const { isOperationalPgEnabled, getOperationalPool } = require("../services/operationalPgStore");

const router = express.Router();
router.use(authenticate);

const ALL_ROLES = [
  ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR,
];

const CHANGELOG_PATH = path.join(__dirname, "../../backend/data/changelog.json");
const NOVEDADES_RESET_AT = "2026-04-27T00:00:00.000Z";

function isVisibleNovedad(entry) {
  return !entry?.created_at || entry.created_at >= NOVEDADES_RESET_AT;
}

function readChangelogEntries() {
  try {
    const data = JSON.parse(fs.readFileSync(CHANGELOG_PATH, "utf8"));
    return Array.isArray(data.entries) ? data.entries.filter(isVisibleNovedad) : [];
  } catch {
    return [];
  }
}

function normalizeNovedadRow(row) {
  if (!row) return row;
  return {
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function getDbRows(fields = "*") {
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rows } = await pg.query(`SELECT ${fields} FROM novedades ORDER BY created_at DESC`);
    return rows.map(normalizeNovedadRow).filter(isVisibleNovedad);
  }
  try {
    const rows = await all(`SELECT ${fields} FROM novedades ORDER BY created_at DESC`);
    return rows.map(normalizeNovedadRow).filter(isVisibleNovedad);
  } catch {
    return [];
  }
}

async function insertNovedad(tipo, titulo, descripcion, autorNombre) {
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    await pg.query(
      `INSERT INTO novedades (tipo, titulo, descripcion, autor_nombre) VALUES ($1, $2, $3, $4)`,
      [tipo, titulo, descripcion, autorNombre]
    );
    return;
  }
  await run(
    `INSERT INTO novedades (tipo, titulo, descripcion, autor_nombre) VALUES (?, ?, ?, ?)`,
    [tipo, titulo, descripcion, autorNombre]
  );
}

async function deleteNovedad(id) {
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    await pg.query(`DELETE FROM novedades WHERE id = $1`, [id]);
    return;
  }
  await run(`DELETE FROM novedades WHERE id = ?`, [id]);
}

// GET /api/novedades
router.get(
  "/",
  authorize(...ALL_ROLES),
  asyncHandler(async (req, res) => {
    const fileEntries = readChangelogEntries();
    const dbRows = await getDbRows();
    const merged = [...fileEntries, ...dbRows].sort(
      (a, b) => (b.created_at || "").localeCompare(a.created_at || "")
    );
    res.json({ status: "ok", data: merged });
  })
);

// GET /api/novedades/count?since=ISO_DATE
router.get(
  "/count",
  authorize(...ALL_ROLES),
  asyncHandler(async (req, res) => {
    const since = req.query.since ? String(req.query.since).slice(0, 30) : null;
    const fileEntries = readChangelogEntries();
    const dbRows = await getDbRows("id, created_at");
    const all_entries = [...fileEntries, ...dbRows];
    const count = since
      ? all_entries.filter((e) => (e.created_at || "") > since).length
      : all_entries.length;
    res.json({ status: "ok", data: { count } });
  })
);

// POST /api/novedades — solo ADMIN
router.post(
  "/",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const { tipo, titulo, descripcion } = req.body;
    if (!titulo?.trim() || !descripcion?.trim()) {
      throw new HttpError(400, "Título y descripción son obligatorios");
    }
    const tipoValido = ["feature", "mejora", "fix"].includes(tipo) ? tipo : "feature";
    await insertNovedad(
      tipoValido,
      titulo.trim().slice(0, 120),
      descripcion.trim().slice(0, 1000),
      req.user.nombre || req.user.name || "Admin"
    );
    res.json({ status: "ok", data: { message: "Novedad publicada." } });
  })
);

// DELETE /api/novedades/:id — solo ADMIN
router.delete(
  "/:id",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    await deleteNovedad(req.params.id);
    res.json({ status: "ok" });
  })
);

module.exports = router;
