const NOVEDADES_LS_KEY = "fmn_novedades_seen_at";

const NOV_TIPO_META = {
  feature: { label: "🚀 Nueva función", cls: "feature" },
  mejora:  { label: "✨ Mejora",        cls: "mejora"  },
  fix:     { label: "🐛 Corrección",    cls: "fix"     },
};

let _ctx = null;

const el = (id) => document.getElementById(id);

export function initNovedades(ctx) {
  _ctx = ctx;

  el("novedades-btn")?.addEventListener("click", openNovedadesModal);
  el("novedades-close-btn")?.addEventListener("click", closeNovedadesModal);
  el("novedades-modal")?.addEventListener("click", (e) => {
    if (e.target.dataset.close === "true") closeNovedadesModal();
  });

  el("novedades-add-btn")?.addEventListener("click", () => {
    el("novedades-form-wrap")?.classList.remove("hidden");
    el("novedades-add-btn").classList.add("hidden");
    el("novedades-titulo")?.focus();
  });

  el("novedades-cancel-btn")?.addEventListener("click", () => {
    el("novedades-form-wrap")?.classList.add("hidden");
    el("novedades-add-btn")?.classList.remove("hidden");
    el("novedades-form")?.reset();
  });

  el("novedades-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = el("novedades-form-error");
    errEl?.classList.add("hidden");
    const tipo = el("novedades-form").querySelector("input[name=nov_tipo]:checked")?.value || "feature";
    const titulo = el("novedades-titulo")?.value.trim();
    const descripcion = el("novedades-desc")?.value.trim();
    if (!titulo || !descripcion) return;
    const submitBtn = el("novedades-submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Publicando…";
    try {
      await _ctx.apiRequest("/api/novedades", { method: "POST", body: { tipo, titulo, descripcion } });
      el("novedades-form").reset();
      el("novedades-form-wrap")?.classList.add("hidden");
      el("novedades-add-btn")?.classList.remove("hidden");
      _ctx.showToast("Novedad publicada correctamente.");
      loadNovedades();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message || "Error al publicar"; errEl.classList.remove("hidden"); }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Publicar";
    }
  });

  el("novedades-list")?.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-nov-delete]");
    if (!del) return;
    await _ctx.apiRequest(`/api/novedades/${del.dataset.novDelete}`, { method: "DELETE" });
    loadNovedades();
  });
}

export function openNovedadesModal() {
  el("novedades-modal")?.classList.remove("hidden");
  const isAdmin = (_ctx.state.user?.role || _ctx.state.user?.rol) === "ADMIN";
  el("novedades-add-btn")?.classList.toggle("hidden", !isAdmin);
  loadNovedades();
  localStorage.setItem(NOVEDADES_LS_KEY, new Date().toISOString());
  el("novedades-badge")?.classList.add("hidden");
}

export function closeNovedadesModal() {
  el("novedades-modal")?.classList.add("hidden");
  el("novedades-form-wrap")?.classList.add("hidden");
  el("novedades-form")?.reset();
}

async function loadNovedades() {
  const list = el("novedades-list");
  if (!list) return;
  list.innerHTML = "<div class='history-empty'>Cargando…</div>";
  try {
    const { data } = await _ctx.apiRequest("/api/novedades");
    const items = Array.isArray(data) ? data : [];
    if (!items.length) {
      list.innerHTML = "<div class='history-empty'>Sin novedades publicadas todavía.</div>";
      return;
    }
    const isAdmin = (_ctx.state.user?.role || _ctx.state.user?.rol) === "ADMIN";
    const lastSeen = localStorage.getItem(NOVEDADES_LS_KEY) || "1970-01-01T00:00:00Z";
    list.innerHTML = items.map((n) => {
      const meta = NOV_TIPO_META[n.tipo] || NOV_TIPO_META.feature;
      const isNew = n.created_at > lastSeen;
      const fecha = n.created_at ? n.created_at.slice(0, 16).replace("T", " ") : "-";
      return `<div class="novedades-card">
        <div class="novedades-card-head">
          <span class="novedades-card-tipo ${meta.cls}">${meta.label}</span>
          ${isNew ? '<span class="mini-chip active" style="font-size:0.72rem">Nuevo</span>' : ""}
          <span class="novedades-card-titulo">${n.titulo}</span>
        </div>
        ${n.descripcion ? `<p class="novedades-card-desc">${n.descripcion}</p>` : ""}
        <div class="novedades-card-meta">
          <span>👤 ${n.autor_nombre || "Admin"} · 📅 ${fecha}</span>
          ${isAdmin ? `<button class="action-btn secondary" style="font-size:0.78rem;min-height:28px;padding:0.15rem 0.6rem;color:#c62828" data-nov-delete="${n.id}">Eliminar</button>` : ""}
        </div>
      </div>`;
    }).join("");
  } catch {
    list.innerHTML = "<div class='history-empty'>Error al cargar novedades.</div>";
  }
}

export async function refreshNovedadesBadge(apiRequest) {
  try {
    const fn = apiRequest || _ctx?.apiRequest;
    if (!fn) return;
    const since = localStorage.getItem(NOVEDADES_LS_KEY) || "1970-01-01T00:00:00Z";
    const { data } = await fn(`/api/novedades/count?since=${encodeURIComponent(since)}`);
    const n = data?.count || 0;
    const badge = el("novedades-badge");
    if (badge) { badge.classList.toggle("hidden", n === 0); badge.textContent = n; }
  } catch { /* no crítico */ }
}
