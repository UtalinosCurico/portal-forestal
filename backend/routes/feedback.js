const express = require("express");
const nodemailer = require("nodemailer");
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

const FEEDBACK_TO = "diego.astete@maulenorte.cl";

// ── Envío de correo ───────────────────────────────────────────────────────────
function buildTransporter() {
  const host = process.env.EMAIL_HOST;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const port = parseInt(process.env.EMAIL_PORT || "587", 10);

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

const TIPO_LABEL = { idea: "💡 Idea / Mejora", error: "🐛 Reporte de error" };

async function sendFeedbackEmail({ tipo, titulo, descripcion, autor }) {
  const transporter = buildTransporter();
  if (!transporter) return; // SMTP no configurado → silencioso

  const tipoLabel = TIPO_LABEL[tipo] || tipo;
  const from = process.env.EMAIL_USER;

  await transporter.sendMail({
    from: `"Portal FMN" <${from}>`,
    to: FEEDBACK_TO,
    subject: `[Portal FMN] ${tipoLabel}: ${titulo}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#0f3d27;padding:18px 24px;border-radius:10px 10px 0 0">
          <h2 style="color:#ffffff;margin:0;font-size:18px">Portal FMN — Nuevo Feedback</h2>
        </div>
        <div style="background:#f8fbf9;border:1px solid #d0e4d8;border-top:none;padding:24px;border-radius:0 0 10px 10px">
          <p style="margin:0 0 6px 0">
            <span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:13px;font-weight:700;
              background:${tipo === "error" ? "#fce4ec" : "#fff8e1"};
              color:${tipo === "error" ? "#c62828" : "#7a5200"}">
              ${tipoLabel}
            </span>
          </p>
          <h3 style="margin:14px 0 6px;color:#123126;font-size:16px">${titulo}</h3>
          <p style="margin:0 0 18px;color:#2d4a3a;line-height:1.6;white-space:pre-wrap">${descripcion}</p>
          <hr style="border:none;border-top:1px solid #d0e4d8;margin:0 0 14px"/>
          <p style="margin:0;font-size:13px;color:#5e766a">
            Enviado por: <strong>${autor}</strong>
          </p>
        </div>
      </div>
    `,
  });
}

// ── POST /api/feedback ────────────────────────────────────────────────────────
router.post(
  "/",
  authorize(...ALL_ROLES),
  asyncHandler(async (req, res) => {
    const { tipo, titulo, descripcion } = req.body;

    if (!titulo?.trim() || !descripcion?.trim()) {
      throw new HttpError(400, "Título y descripción son obligatorios");
    }

    const tipoValido = ["idea", "error"].includes(tipo) ? tipo : "idea";
    const autor = req.user.nombre || req.user.name || "Usuario";

    await run(
      `INSERT INTO feedback (tipo, titulo, descripcion, autor_id, autor_nombre)
       VALUES (?, ?, ?, ?, ?)`,
      [
        tipoValido,
        titulo.trim().slice(0, 120),
        descripcion.trim().slice(0, 1000),
        req.user.id || null,
        autor,
      ]
    );

    // Enviar correo en background — no bloquea la respuesta
    sendFeedbackEmail({
      tipo: tipoValido,
      titulo: titulo.trim(),
      descripcion: descripcion.trim(),
      autor,
    }).catch((err) => {
      console.error("[feedback] Error enviando correo:", err.message);
    });

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
