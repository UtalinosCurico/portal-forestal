const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { authorize } = require("../middleware/authorize");
const { run, all, get } = require("../database/db");
const { ROLES } = require("../config/appRoles");
const { HttpError } = require("../utils/httpError");
const notificacionesService = require("../services/notificacionesService");
const { isOperationalPgEnabled, getOperationalPool } = require("../services/operationalPgStore");

const router = express.Router();
router.use(authenticate);

// En produccion (Vercel) el feedback vive en PostgreSQL. SQLite en Vercel es
// un archivo en /tmp que se borra al reciclar la funcion: lo que se guardaba
// ahi se perdia y el ADMIN veia la lista vacia aunque le llegara el aviso.
function normalizarFeedback(row) {
  if (!row) return row;
  return {
    ...row,
    leido: Number(row.leido) || 0,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function guardarFeedback(valores) {
  if (isOperationalPgEnabled()) {
    await getOperationalPool().query(
      `INSERT INTO feedback (tipo, titulo, descripcion, autor_id, autor_nombre)
       VALUES ($1, $2, $3, $4, $5)`,
      valores
    );
    return;
  }
  await run(
    `INSERT INTO feedback (tipo, titulo, descripcion, autor_id, autor_nombre)
     VALUES (?, ?, ?, ?, ?)`,
    valores
  );
}

async function listarFeedback() {
  if (isOperationalPgEnabled()) {
    const { rows } = await getOperationalPool().query(
      "SELECT * FROM feedback ORDER BY leido ASC, created_at DESC"
    );
    return rows.map(normalizarFeedback);
  }
  const rows = await all("SELECT * FROM feedback ORDER BY leido ASC, created_at DESC");
  return rows.map(normalizarFeedback);
}

async function marcarFeedbackLeido(id) {
  if (isOperationalPgEnabled()) {
    await getOperationalPool().query("UPDATE feedback SET leido = 1 WHERE id = $1", [id]);
    return;
  }
  await run("UPDATE feedback SET leido = 1 WHERE id = ?", [id]);
}

async function eliminarFeedback(id) {
  if (isOperationalPgEnabled()) {
    await getOperationalPool().query("DELETE FROM feedback WHERE id = $1", [id]);
    return;
  }
  await run("DELETE FROM feedback WHERE id = ?", [id]);
}

async function contarFeedbackSinLeer() {
  if (isOperationalPgEnabled()) {
    // COUNT(*) es bigint y pg lo entrega como texto; "0" mostraba la insignia.
    const { rows } = await getOperationalPool().query(
      "SELECT COUNT(*)::int AS total FROM feedback WHERE leido = 0"
    );
    return Number(rows[0]?.total) || 0;
  }
  const row = await get("SELECT COUNT(*) AS total FROM feedback WHERE leido = 0");
  return Number(row?.total) || 0;
}

function idValido(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "Identificador de feedback inválido");
  }
  return id;
}

const ALL_ROLES = [
  ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR,
];

// POST /api/feedback
router.post(
  "/",
  authorize(...ALL_ROLES),
  asyncHandler(async (req, res) => {
    const tipo = req.body?.tipo;
    const titulo = String(req.body?.titulo ?? "");
    const descripcion = String(req.body?.descripcion ?? "");

    if (!titulo.trim() || !descripcion.trim()) {
      throw new HttpError(400, "Título y descripción son obligatorios");
    }

    const tipoValido = ["idea", "error"].includes(tipo) ? tipo : "idea";

    await guardarFeedback([
      tipoValido,
      titulo.trim().slice(0, 120),
      descripcion.trim().slice(0, 1000),
      req.user.id || null,
      req.user.nombre || req.user.name || "Usuario",
    ]);

    // El aviso se espera antes de responder: en Vercel la funcion se congela
    // apenas responde y un aviso "en segundo plano" puede no salir nunca. Si
    // falla, se ignora: el feedback ya quedo guardado.
    await notificacionesService
      .createFeedbackNotification({
        tipo: tipoValido,
        titulo: titulo.trim().slice(0, 120),
        autorNombre: req.user.nombre || req.user.name || "Usuario",
      })
      .catch(() => {});

    res.json({ status: "ok", data: { message: "Feedback recibido. ¡Gracias!" } });
  })
);

// GET /api/feedback — solo ADMIN
router.get(
  "/",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const rows = await listarFeedback();
    res.json({ status: "ok", data: rows });
  })
);

// PATCH /api/feedback/:id/leido
router.patch(
  "/:id/leido",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    await marcarFeedbackLeido(idValido(req.params.id));
    res.json({ status: "ok" });
  })
);

// DELETE /api/feedback/:id
router.delete(
  "/:id",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    await eliminarFeedback(idValido(req.params.id));
    res.json({ status: "ok" });
  })
);

// GET /api/feedback/count
router.get(
  "/count",
  authorize(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    res.json({ status: "ok", data: { unread: await contarFeedbackSinLeer() } });
  })
);

module.exports = router;
