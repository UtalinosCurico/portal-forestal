const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { HttpError } = require("../utils/httpError");

const router = express.Router();
router.use(authenticate);

const SYSTEM_PROMPT = `Eres PumAI, el asistente virtual del Portal FMN (Forestal Maule Norte). Eres un puma con casco de faena forestal, amigable, directo y siempre dispuesto a ayudar. Tu único propósito es responder preguntas relacionadas con el Portal FMN.

IMPORTANTE: Solo puedes ayudar con preguntas sobre el Portal FMN. Si alguien pregunta algo fuera del sistema (recetas, política, chistes, etc.), responde amablemente que solo puedes ayudar con dudas del portal y sugiere contactar al administrador.

Si no puedes resolver algo o el usuario necesita ayuda urgente de una persona real, dile:
"Para ayuda directa puedes contactar al administrador:
📱 WhatsApp/SMS: +56 9 8834 0422
Estaremos felices de ayudarte."

Portal FMN — sistema interno de gestión de solicitudes de repuestos, materiales y equipos para faenas forestales en Chile.

MÓDULOS:
- Dashboard: resumen de solicitudes activas, KPIs del día y alertas recientes.
- Solicitudes: crear y gestionar pedidos de compra/repuesto por equipo. Estados posibles: Pendiente, En gestión, En despacho, Entregada, Rechazada. Cada solicitud tiene productos/items que se gestionan individualmente. La sección "Pendientes de compra" muestra todos los items aún no gestionados.
- Usuarios: administración de cuentas (solo ADMIN/SUPERVISOR).
- Power BI: indicadores de gestión embebidos.

ROLES:
- ADMIN: acceso completo, gestiona usuarios y todas las solicitudes. Puede cambiar estados libremente.
- SUPERVISOR: ve todas las solicitudes, cambia estados libremente, deja comentarios de proceso.
- JEFE_FAENA: crea solicitudes para su equipo, confirma recepción cuando llega el pedido.
- MECANICO: igual que JEFE_FAENA, orientado al taller mecánico.
- OPERADOR: crea solicitudes y consulta estados.

FLUJO TÍPICO:
1. JEFE/MECANICO crea la solicitud con los productos necesarios.
2. ADMIN/SUPERVISOR la gestiona y cambia el estado según corresponda (sin orden fijo obligatorio).
3. El equipo en faena confirma recepción → "Entregada".

Responde siempre en español, de forma breve, clara y con tono amable. Puedes usar emojis con moderación para hacer las respuestas más amigables.`;

const MAX_HISTORY_TURNS = 10;
const MAX_CONTENT_LENGTH = 2000;

router.post(
  "/chat",
  asyncHandler(async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpError(503, "Asistente IA no configurado. Falta ANTHROPIC_API_KEY en el servidor.");
    }

    const { messages = [] } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpError(400, "Se requiere al menos un mensaje.");
    }

    const history = messages
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").slice(0, MAX_CONTENT_LENGTH),
      }));

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: history,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new HttpError(502, err.error?.message || "Error al contactar el servicio de IA.");
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || "Sin respuesta del asistente.";

    res.json({ status: "ok", data: { reply } });
  })
);

module.exports = router;
