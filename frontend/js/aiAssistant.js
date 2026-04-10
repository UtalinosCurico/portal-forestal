// ── Asistente IA flotante ────────────────────────────────────────────────────

const AI_WELCOME =
  "¡Hola! 🐾 Soy PumAI, tu asistente del Portal FMN. Puedo ayudarte con dudas sobre solicitudes, estados, roles y cómo usar el sistema. ¿En qué te ayudo?";

export function initAiAssistant(context) {
  const btn = document.getElementById("ai-assistant-btn");
  const drawer = document.getElementById("ai-assistant-drawer");
  const closeBtn = document.getElementById("ai-assistant-close");
  const form = document.getElementById("ai-assistant-form");
  const input = document.getElementById("ai-assistant-input");
  const messagesList = document.getElementById("ai-assistant-messages");
  const sendBtn = document.getElementById("ai-assistant-send");

  if (!btn || !drawer) return;

  let history = []; // { role: "user"|"assistant", content: string }
  let isOpen = false;
  let isLoading = false;

  function open() {
    isOpen = true;
    drawer.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    if (!history.length) {
      appendMessage("assistant", AI_WELCOME);
    }
    setTimeout(() => input?.focus(), 120);
  }

  function close() {
    isOpen = false;
    drawer.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
  }

  function appendMessage(role, text) {
    const isMine = role === "user";
    const article = document.createElement("article");
    article.className = `ai-msg ${isMine ? "ai-msg-mine" : "ai-msg-theirs"}`;
    article.innerHTML = `<p>${escapeHtml(text)}</p>`;
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
    return el;
  }

  function removeTyping() {
    document.getElementById("ai-typing")?.remove();
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  async function sendMessage(text) {
    if (!text.trim() || isLoading) return;

    history.push({ role: "user", content: text.trim() });
    appendMessage("user", text.trim());
    input.value = "";
    input.style.height = "auto";

    isLoading = true;
    sendBtn.disabled = true;
    const typingEl = showTyping();

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
      appendMessage("assistant", "Lo siento, hubo un error al conectar con el asistente. Intenta de nuevo.");
    } finally {
      isLoading = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // Events
  btn.addEventListener("click", () => (isOpen ? close() : open()));
  closeBtn?.addEventListener("click", close);

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(input.value);
  });

  // Auto-resize textarea
  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  // Shift+Enter = nueva línea, Enter = enviar
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });
}
