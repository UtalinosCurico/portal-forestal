const express = require("express");
const { asyncHandler } = require("../utils/asyncHandler");
const { authenticate } = require("../middleware/auth");
const { HttpError } = require("../utils/httpError");
const dashboardService = require("../services/dashboardService");

const router = express.Router();
router.use(authenticate);

// ── Palabras clave para detectar consultas de clima ────────────────────────
const WEATHER_RE = /tiempo|clima|temperatura|lluvia|lloviendo|frío|calor|pronóstico|sol|nublado|viento|precipitac|despejado/i;

// Ciudades representativas de la Región del Maule (wttr.in acepta nombres en inglés/español)
const MAULE_CITIES = [
  "Constitucion",
  "Talca",
  "Curico",
  "Linares",
  "Cauquenes",
  "San Javier",
  "Parral",
];

const SYSTEM_PROMPT_BASE = `Eres PumAI, el asistente virtual del Portal FMN (Forestal Maule Norte). Eres un puma con casco de faena forestal, amigable, directo y siempre dispuesto a ayudar.

IMPORTANTE: Solo puedes ayudar con preguntas sobre el Portal FMN y temas relacionados con las faenas forestales en la Región del Maule. Si alguien pregunta algo completamente fuera de contexto, responde amablemente que solo puedes ayudar con el portal.

Si el usuario necesita ayuda urgente de una persona real, indícale:
"Para ayuda directa contacta al administrador:
📱 WhatsApp/SMS: +56 9 8834 0422"

Portal FMN — sistema interno de gestión de solicitudes de repuestos, materiales y equipos para faenas forestales en Chile.

MÓDULOS:
- Dashboard: resumen de solicitudes activas, KPIs del día y alertas recientes.
- Solicitudes: crear y gestionar pedidos de compra/repuesto por equipo. Estados: Pendiente → En gestión → En despacho → Entregada (o Rechazada). Cada solicitud tiene ítems que se gestionan individualmente. "Pendientes de compra" muestra todos los ítems aún no gestionados.
- Usuarios: administración de cuentas (solo ADMIN/SUPERVISOR).
- Power BI: indicadores de gestión embebidos.
- DataScope: enlace directo al sistema de formularios digitales de terreno (app.mydatascope.com).

ROLES:
- ADMIN: acceso completo, gestiona usuarios y todas las solicitudes.
- SUPERVISOR: ve todas las solicitudes, cambia estados libremente.
- JEFE_FAENA: crea solicitudes para su equipo, confirma recepción.
- MECANICO: igual que JEFE_FAENA, orientado al taller mecánico.
- OPERADOR: crea solicitudes y consulta estados.

Tienes acceso a datos en tiempo real del portal y al clima regional. Cuando el contexto incluya esa información, úsala para dar respuestas concretas y actualizadas. Responde siempre en español, de forma breve y amable. Puedes usar emojis con moderación.`;

const MAX_HISTORY_TURNS = 10;
const MAX_CONTENT_LENGTH = 2000;

// ── Contexto del portal ────────────────────────────────────────────────────
async function fetchPortalContext(actor) {
  try {
    const data = await dashboardService.getDashboardData(actor, {});

    const porEstado = (data.solicitudes_por_estado || [])
      .filter((e) => e.total > 0)
      .map((e) => `  • ${e.estado}: ${e.total}`)
      .join("\n") || "  (sin datos)";

    const porEquipo = (data.solicitudes_por_equipo || [])
      .filter((e) => e.total > 0)
      .slice(0, 8)
      .map((e) => `  • ${e.equipo}: ${e.total}`)
      .join("\n") || "  (sin datos)";

    return (
      `\n\n=== DATOS ACTUALES DEL PORTAL (${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })}) ===` +
      `\nSolicitudes activas (Pendiente + En gestión): ${data.metricas?.solicitudes_pendientes ?? "?"}` +
      `\nDespachos en curso: ${data.metricas?.despachos_pendientes ?? "?"}` +
      `\n\nSolicitudes por estado:\n${porEstado}` +
      `\n\nSolicitudes por equipo:\n${porEquipo}`
    );
  } catch {
    return "";
  }
}

// ── Contexto del clima (wttr.in, sin API key) ──────────────────────────────
async function fetchWeatherContext(lastMessage) {
  if (!WEATHER_RE.test(lastMessage)) return "";

  // ¿El mensaje menciona una ciudad específica?
  const cityMentioned = MAULE_CITIES.find((c) =>
    lastMessage.toLowerCase().includes(c.toLowerCase())
  );
  const citiesToFetch = cityMentioned
    ? [cityMentioned]
    : ["Constitucion", "Talca"];

  const results = await Promise.allSettled(
    citiesToFetch.map(async (city) => {
      const url = `https://wttr.in/${encodeURIComponent(city + ",Chile")}?format=j1&lang=es`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!resp.ok) return null;
      const json = await resp.json();

      const cc = json.current_condition?.[0];
      if (!cc) return null;

      const desc = cc.weatherDesc?.[0]?.value || "";
      const temp = cc.temp_C;
      const feels = cc.FeelsLikeC;
      const humidity = cc.humidity;
      const wind = cc.windspeedKmph;

      const forecast = (json.weather || [])
        .slice(0, 3)
        .map((d) => {
          const descDay = d.hourly?.[4]?.weatherDesc?.[0]?.value || "";
          return `  ${d.date}: ${d.mintempC}°C–${d.maxtempC}°C, ${descDay}`;
        })
        .join("\n");

      return (
        `${city}: ${temp}°C (sensación ${feels}°C), ${desc}, humedad ${humidity}%, viento ${wind} km/h` +
        (forecast ? `\n  Pronóstico:\n${forecast}` : "")
      );
    })
  );

  const lines = results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);

  if (!lines.length) return "";
  return `\n\n=== CLIMA ACTUAL — Región del Maule ===\n${lines.join("\n\n")}`;
}

// ── Endpoint ───────────────────────────────────────────────────────────────
router.post(
  "/chat",
  asyncHandler(async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpError(
        503,
        "Asistente IA no configurado. Falta ANTHROPIC_API_KEY en el servidor."
      );
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

    // Último mensaje del usuario para detectar intención
    const lastUserMsg = history.filter((m) => m.role === "user").at(-1)?.content || "";

    // Construir contexto dinámico en paralelo
    const [portalCtx, weatherCtx] = await Promise.all([
      fetchPortalContext(req.user),
      fetchWeatherContext(lastUserMsg),
    ]);

    const systemPrompt = SYSTEM_PROMPT_BASE + portalCtx + weatherCtx;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: systemPrompt,
        messages: history,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new HttpError(
        502,
        err.error?.message || "Error al contactar el servicio de IA."
      );
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || "Sin respuesta del asistente.";

    res.json({ status: "ok", data: { reply } });
  })
);

module.exports = router;
