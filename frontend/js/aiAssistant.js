// ── Asistente IA flotante (PumAI) ───────────────────────────────────────────

const AI_WELCOME =
  "¡Hola! 🐾 Soy PumAI, tu asistente del Portal FMN. Puedo ayudarte con dudas sobre solicitudes, estados, roles y cómo usar el sistema. ¿En qué te ayudo?";

// Convierte markdown básico a HTML seguro
function renderMarkdown(raw) {
  let text = String(raw ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  // Negrita **texto**
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Saltos de línea
  const lines = text.split("\n");
  const result = [];
  let inList = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bulletMatch = line.match(/^[\s]*[-•]\s+(.+)/);
    const numberedMatch = line.match(/^[\s]*\d+\.\s+(.+)/);

    if (bulletMatch || numberedMatch) {
      if (!inList) { result.push("<ul class='ai-list'>"); inList = true; }
      result.push(`<li>${(bulletMatch || numberedMatch)[1]}</li>`);
    } else {
      if (inList) { result.push("</ul>"); inList = false; }
      if (line.trim()) result.push(`<p>${line}</p>`);
      else if (result.length) result.push("<br>");
    }
  }
  if (inList) result.push("</ul>");
  return result.join("");
}

export function initAiAssistant(context) {
  const btn       = document.getElementById("ai-assistant-btn");
  const drawer    = document.getElementById("ai-assistant-drawer");
  const closeBtn  = document.getElementById("ai-assistant-close");
  const resizeHandle = document.getElementById("ai-resize-handle");
  const form      = document.getElementById("ai-assistant-form");
  const input     = document.getElementById("ai-assistant-input");
  const messagesList = document.getElementById("ai-assistant-messages");
  const sendBtn   = document.getElementById("ai-assistant-send");

  if (!btn || !drawer) return;

  let history  = [];
  let isOpen   = false;
  let isLoading = false;

  // ── Resize drag ────────────────────────────────────────────────────────────
  if (resizeHandle) {
    let startY = 0;
    let startH = 0;

    resizeHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = drawer.offsetHeight;
      resizeHandle.setPointerCapture(e.pointerId);
    });

    resizeHandle.addEventListener("pointermove", (e) => {
      if (!e.buttons) return;
      const delta = startY - e.clientY;
      const newH  = Math.min(Math.max(startH + delta, 300), window.innerHeight * 0.9);
      drawer.style.height = newH + "px";
      drawer.style.maxHeight = "none";
    });
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  function open() {
    isOpen = true;
    drawer.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    if (!messagesList.children.length) {
      history.push({ role: "assistant", content: AI_WELCOME });
      appendMessage("assistant", AI_WELCOME);
    }
    setTimeout(() => input?.focus(), 120);
  }

  function close() {
    isOpen = false;
    drawer.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function appendMessage(role, text) {
    const isMine  = role === "user";
    const article = document.createElement("article");
    article.className = `ai-msg ${isMine ? "ai-msg-mine" : "ai-msg-theirs"}`;
    article.innerHTML  = isMine
      ? `<p>${text.replaceAll("&","&amp;").replaceAll("<","&lt;")}</p>`
      : renderMarkdown(text);
    messagesList.appendChild(article);
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  function showTyping() {
    const el = document.createElement("div");
    el.id = "ai-typing";
    el.className = "ai-typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    messagesList.appendChild(el);
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  function removeTyping() {
    document.getElementById("ai-typing")?.remove();
  }

  // ── Send ───────────────────────────────────────────────────────────────────
  async function sendMessage(text) {
    if (!text.trim() || isLoading) return;

    history.push({ role: "user", content: text.trim() });
    appendMessage("user", text.trim());
    input.value = "";
    input.style.height = "auto";

    isLoading = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const payload = await context.apiRequest("/api/ai/chat", {
        method: "POST",
        body: { messages: history },
      });
      const reply = payload?.data?.reply || "Sin respuesta.";
      history.push({ role: "assistant", content: reply });
      removeTyping();
      appendMessage("assistant", reply);
    } catch (err) {
      removeTyping();
      const raw = err?.message || "";
      let msg;
      if (raw.includes("ANTHROPIC_API_KEY") || raw.includes("no configurado")) {
        msg = "PumAI no está activado aún. El administrador debe configurar la clave de API en el servidor. 🔧";
      } else if (raw.includes("credit") || raw.includes("billing") || raw.includes("quota") || raw.includes("insufficient")) {
        msg = "Sin créditos en la cuenta de IA. El administrador debe agregar saldo en console.anthropic.com. 💳";
      } else if (raw.includes("invalid") || raw.includes("auth") || raw.includes("401")) {
        msg = "La clave de API no es válida. El administrador debe verificarla en Vercel. 🔑";
      } else {
        msg = `Error: ${raw || "no pude conectarme"}. Intenta de nuevo. 🐾`;
      }
      appendMessage("assistant", msg);
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  btn.addEventListener("click", () => (isOpen ? close() : open()));
  closeBtn?.addEventListener("click", close);

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(input.value);
  });

  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });
}
