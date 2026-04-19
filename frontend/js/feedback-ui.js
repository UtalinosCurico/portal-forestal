let _ctx = null;

const el = (id) => document.getElementById(id);

export function initFeedback(ctx) {
  _ctx = ctx;

  el("feedback-btn")?.addEventListener("click", () => {
    openFeedbackModal();
    const isAdmin = (_ctx.state.user?.role || _ctx.state.user?.rol) === "ADMIN";
    document.querySelectorAll(".feedback-tab.admin-only").forEach((t) => t.classList.toggle("hidden", !isAdmin));
  });

  el("feedback-close-btn")?.addEventListener("click", closeFeedbackModal);
  el("feedback-modal")?.addEventListener("click", (e) => {
    if (e.target.dataset.closeFeedback === "true") closeFeedbackModal();
  });

  document.getElementById("feedback-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".feedback-tab");
    if (!tab) return;
    document.querySelectorAll(".feedback-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const isPanelList = tab.dataset.tab === "list";
    el("feedback-panel-send")?.classList.toggle("hidden", isPanelList);
    el("feedback-panel-list")?.classList.toggle("hidden", !isPanelList);
    if (isPanelList) loadFeedbackList();
  });

  el("feedback-list")?.addEventListener("click", async (e) => {
    const markBtn = e.target.closest("[data-fb-mark]");
    const delBtn  = e.target.closest("[data-fb-delete]");
    if (markBtn) {
      await _ctx.apiRequest(`/feedback/${markBtn.dataset.fbMark}/leido`, { method: "PATCH" });
      loadFeedbackList();
      refreshFeedbackBadge();
    }
    if (delBtn) {
      await _ctx.apiRequest(`/feedback/${delBtn.dataset.fbDelete}`, { method: "DELETE" });
      loadFeedbackList();
      refreshFeedbackBadge();
    }
  });

  el("feedback-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = el("feedback-form-error");
    errEl?.classList.add("hidden");
    const tipo = el("feedback-form").querySelector("input[name=feedback_tipo]:checked")?.value || "idea";
    const titulo = el("feedback-titulo")?.value.trim();
    const descripcion = el("feedback-desc")?.value.trim();
    if (!titulo || !descripcion) return;
    const submitBtn = el("feedback-submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";
    try {
      await _ctx.apiRequest("/feedback", { method: "POST", body: JSON.stringify({ tipo, titulo, descripcion }) });
      el("feedback-form").reset();
      closeFeedbackModal();
      _ctx.showToast("¡Feedback enviado! Gracias por tu aporte.");
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || "Error al enviar"; errEl.classList.remove("hidden"); }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar";
    }
  });
}

function openFeedbackModal() {
  el("feedback-modal")?.classList.remove("hidden");
  el("feedback-titulo")?.focus();
}

function closeFeedbackModal() {
  el("feedback-modal")?.classList.add("hidden");
}

async function loadFeedbackList() {
  const list = el("feedback-list");
  if (!list) return;
  try {
    const { data } = await _ctx.apiRequest("/feedback");
    const items = Array.isArray(data) ? data : [];
    if (!items.length) {
      list.innerHTML = "<div class='history-empty'>Sin feedback recibido todavía.</div>";
      return;
    }
    const TIPO_LABEL = { idea: "💡 Idea", error: "🐛 Error" };
    list.innerHTML = items.map((fb) => `
      <div class="feedback-card ${fb.leido ? "leido" : ""}" data-fb-id="${fb.id}">
        <div class="feedback-card-head">
          <span class="feedback-card-tipo ${fb.tipo}">${TIPO_LABEL[fb.tipo] || fb.tipo}</span>
          <span class="feedback-card-titulo">${fb.titulo}</span>
          ${!fb.leido ? '<span class="mini-chip active" style="font-size:0.72rem">Nuevo</span>' : ""}
        </div>
        <p class="feedback-card-desc">${fb.descripcion}</p>
        <div class="feedback-card-meta">
          <span>👤 ${fb.autor_nombre || "Usuario"}</span>
          <span>📅 ${fb.created_at ? fb.created_at.slice(0, 16).replace("T", " ") : "-"}</span>
        </div>
        <div class="feedback-card-actions">
          ${!fb.leido ? `<button class="action-btn secondary" style="font-size:0.8rem;min-height:30px;padding:0.2rem 0.7rem" data-fb-mark="${fb.id}">Marcar leído</button>` : ""}
          <button class="action-btn secondary" style="font-size:0.8rem;min-height:30px;padding:0.2rem 0.7rem;color:#c62828" data-fb-delete="${fb.id}">Eliminar</button>
        </div>
      </div>`).join("");
  } catch {
    list.innerHTML = "<div class='history-empty'>Error al cargar feedback.</div>";
  }
}

export async function refreshFeedbackBadge(apiRequest) {
  try {
    const fn = apiRequest || _ctx?.apiRequest;
    if (!fn) return;
    const { data } = await fn("/feedback/count");
    const n = data?.unread || 0;
    const badge = el("feedback-badge");
    badge?.classList.toggle("hidden", n === 0);
    if (badge) badge.textContent = n;
    const chip = el("feedback-unread-chip");
    if (chip) { chip.classList.toggle("hidden", n === 0); chip.textContent = n; }
  } catch { /* no es crítico */ }
}
