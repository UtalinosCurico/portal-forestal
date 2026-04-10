const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { HttpError } = require("../utils/httpError");

const router = express.Router();
router.use(authenticate);

const SYSTEM_PROMPT = `Eres el asistente de ayuda del Portal FMN (Forestal Maule Norte).
Portal FMN es un sistema interno de gestión de solicitudes de repuestos, materiales y equipos para faenas forestales en Chile.

Módulos:
- Dashboard: resumen de solicitudes activas, KPIs del día y alertas recientes.
- Solicitudes: crear y gestionar pedidos de compra/repuesto por equipo. Estados: Pendiente → En gestión → En despacho → Entregada (o Rechazada). Cada solicitud tiene items que se gestionan de forma individual. La sección "Pendientes de compra" muestra todos los items aún no gestionados de todas las solicitudes activas.
- Usuarios: administración de cuentas (solo ADMIN/SUPERVISOR).
- Power BI: indicadores de gestión embebidos.

Roles:
- ADMIN: acceso completo, gestiona usuarios y todas las solicitudes.
- SUPERVISOR: ve todas las solicitudes, cambia estados, deja comentarios de proceso.
- JEFE_FAENA: crea solicitudes para su equipo y confirma recepción cuando llega el pedido.
- MECANICO: igual que JEFE_FAENA, orientado al taller.
- OPERADOR: crea solicitudes y consulta estados.

Flujo típico:
1. JEFE/MECANICO crea la solicitud con los productos necesarios.
2. ADMIN/SUPERVISOR la revisa → "En gestión".
3. Se gestiona la compra y despacho → "En despacho".
4. El equipo en faena confirma recepción → "Entregada".

Responde siempre en español, de forma breve y amable. Si no sabes algo concreto, indica que el ADMIN o SUPERVISOR puede ayudar.`;

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
