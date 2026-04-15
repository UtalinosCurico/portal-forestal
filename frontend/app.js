const ASSET_VERSION = window.__APP_VERSION__ || "dev";

// ── Login landscape ───────────────────────────────────────────────────────────
(function initLoginLandscape() {
  const container = document.getElementById("login-landscape");
  if (!container) return;

  const W = 1440, H = 500;

  // Seeded PRNG (LCG) — siempre genera el mismo paisaje
  let _seed = 317;
  function rng() {
    _seed = (_seed * 1664525 + 1013904223) & 0x7fffffff;
    return _seed / 0x7fffffff;
  }

  // Cordillera suave con curvas bezier
  function mountainPath(baseY, variance, segments) {
    const step = W / segments;
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      pts.push({ x: i * step, y: baseY - rng() * variance });
    }
    let d = `M0 ${H} L0 ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const cpx = (pts[i - 1].x + pts[i].x) / 2;
      d += ` C${cpx} ${pts[i - 1].y} ${cpx} ${pts[i].y} ${pts[i].x} ${pts[i].y}`;
    }
    return d + ` L${W} ${H} Z`;
  }

  // Silueta de pinos — triángulos irregulares a lo largo del ancho
  function treesPath(groundY, maxH, count) {
    const spacing = W / count;
    let d = `M0 ${H} L0 ${groundY}`;
    for (let i = 0; i < count; i++) {
      const cx = spacing * i + spacing * (0.3 + rng() * 0.4);
      const h  = maxH * (0.55 + rng() * 0.45);
      const hw = spacing * (0.22 + rng() * 0.18);
      d += ` L${cx - hw} ${groundY}`;
      d += ` L${cx} ${groundY - h}`;
      d += ` L${cx + hw} ${groundY}`;
    }
    return d + ` L${W} ${H} Z`;
  }

  document.getElementById("ll-path-mtn-far").setAttribute("d",    mountainPath(260, 90,  7));
  document.getElementById("ll-path-mtn-mid").setAttribute("d",    mountainPath(320, 65, 10));
  document.getElementById("ll-path-trees-far").setAttribute("d",  treesPath(380, 80, 20));
  document.getElementById("ll-path-trees-near").setAttribute("d", treesPath(430, 110, 13));

  // Slide-in escalonado
  const layers = container.querySelectorAll(".login-layer");
  layers.forEach((layer, i) => {
    setTimeout(() => layer.classList.add("animate-in"), 80 + i * 220);
  });

  // Arrancar parallax + bamboleo una vez que terminó el slide-in
  const lastDelay = 80 + (layers.length - 1) * 220 + 1350; // último slide + duración transición
  setTimeout(() => {
    container.classList.add("droning");
    // activar scroll en cada capa con pequeño escalonado para que no arranquen sincronizadas
    layers.forEach((layer, i) => {
      setTimeout(() => {
        layer.querySelector(".ll-scroll").style.animationPlayState = "running";
      }, i * 120);
    });
  }, lastDelay);
})();

// ── Button ripple ────────────────────────────────────────────────────────────
document.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(
    ".btn, .action-btn, .table-btn, .table-btn-state, .ipt-open-btn, .detail-tab-btn, .pending-collapse-btn"
  );
  if (!btn || btn.disabled || btn.classList.contains("no-ripple")) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "btn-ripple";
  ripple.style.left = e.clientX - rect.left + "px";
  ripple.style.top = e.clientY - rect.top + "px";
  btn.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
});
const CHILE_TIME_ZONE = "America/Santiago";
const CHILE_LOCALE = "es-CL";
const SESSION_KEY = "fmn_auth_session";
const SESSION_REMEMBER_KEY = "fmn_auth_session_persistent";
const LAST_VIEW_KEY = "fmn_last_view";
const TITLE_BASE = "Portal FMN";
const NOTIFICATIONS_STALE_MS = 20000;

const state = {
  token: null,
  user: null,
  currentView: "dashboard",
  alertsPoller: null,
  sessionPoller: null,
  lastAlertsCount: 0,
  notifications: [],
  notificationsLoadedAt: 0,
  viewCache: new Map(),
  viewMarkupRequests: new Map(),
  viewModuleCache: new Map(),
  activeViewRequestId: 0,
  toastTimer: null,
  deferredInstallPrompt: null,
  alertsEventSource: null,
  alertsReconnectTimer: null,
  rememberSession: false,
  sessionEpoch: 0,
};

const loginScreen = document.getElementById("login-screen");
const portalScreen = document.getElementById("portal-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const rememberSessionInput = document.getElementById("remember-session");
const togglePasswordBtn = document.getElementById("toggle-password-btn");
const passwordInput = document.getElementById("password");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const sidebarNav = document.getElementById("sidebar-nav");
const viewContainer = document.getElementById("view-container");
const pageTitle = document.getElementById("page-title");
const pageSubtitle = document.getElementById("page-subtitle");
const userBadge = document.getElementById("user-badge");
const logoutBtn = document.getElementById("logout-btn");
const menuToggle = document.getElementById("menu-toggle");
const helpBtn = document.getElementById("help-btn");
const toast = document.getElementById("toast");
const installAppBtn = document.getElementById("install-app-btn");
const alertsBtn = document.getElementById("alerts-btn");
const alertsBadge = document.getElementById("alerts-badge");
const alertsModal = document.getElementById("alerts-modal");
const alertsCloseBtn = document.getElementById("alerts-close-btn");
const alertsRefreshBtn = document.getElementById("alerts-refresh-btn");
const alertsList = document.getElementById("alerts-list");
const alertsStatus = document.getElementById("alerts-status");

const novedadesBtn      = document.getElementById("novedades-btn");
const novedadesBadge    = document.getElementById("novedades-badge");
const novedadesModal    = document.getElementById("novedades-modal");
const novedadesCloseBtn = document.getElementById("novedades-close-btn");
const novedadesList     = document.getElementById("novedades-list");
const novedadesAddBtn   = document.getElementById("novedades-add-btn");
const novedadesFormWrap = document.getElementById("novedades-form-wrap");
const novedadesForm     = document.getElementById("novedades-form");
const novedadesTitulo   = document.getElementById("novedades-titulo");
const novedadesDesc     = document.getElementById("novedades-desc");
const novedadesFormErr  = document.getElementById("novedades-form-error");
const novedadesSubmitBtn= document.getElementById("novedades-submit-btn");
const novedadesCancelBtn= document.getElementById("novedades-cancel-btn");

const feedbackBtn       = document.getElementById("feedback-btn");
const feedbackBadge     = document.getElementById("feedback-badge");
const feedbackModal     = document.getElementById("feedback-modal");
const feedbackCloseBtn  = document.getElementById("feedback-close-btn");
const feedbackForm      = document.getElementById("feedback-form");
const feedbackTitulo    = document.getElementById("feedback-titulo");
const feedbackDesc      = document.getElementById("feedback-desc");
const feedbackFormError = document.getElementById("feedback-form-error");
const feedbackSubmitBtn = document.getElementById("feedback-submit-btn");
const feedbackPanelSend = document.getElementById("feedback-panel-send");
const feedbackPanelList = document.getElementById("feedback-panel-list");
const feedbackList      = document.getElementById("feedback-list");
const feedbackUnreadChip= document.getElementById("feedback-unread-chip");

const VIEWS = {
  dashboard: {
    file: `/views/dashboard.html?v=${ASSET_VERSION}`,
    title: "Dashboard",
    subtitle: "Resumen diario de solicitudes y seguimiento",
    roles: ["ADMIN", "SUPERVISOR", "JEFE_FAENA", "MECANICO", "OPERADOR"],
  },
  solicitudes: {
    file: `/views/solicitudes.html?v=${ASSET_VERSION}`,
    title: "Solicitudes",
    subtitle: "Registro y seguimiento de solicitudes",
    roles: ["ADMIN", "SUPERVISOR", "JEFE_FAENA", "MECANICO", "OPERADOR"],
  },
  usuarios: {
    file: `/views/usuarios.html?v=${ASSET_VERSION}`,
    title: "Usuarios",
    subtitle: "Administracion de usuarios",
    roles: ["ADMIN", "SUPERVISOR"],
  },
  powerbi: {
    file: `/views/powerbi.html?v=${ASSET_VERSION}`,
    title: "Power BI",
    subtitle: "Indicadores de gestion",
    roles: ["ADMIN", "SUPERVISOR"],
  },
  "como-usar": {
    file: `/views/como-usar.html?v=${ASSET_VERSION}`,
    title: "Como usar",
    subtitle: "Guia del portal y apoyo para capacitacion",
    roles: ["ADMIN", "SUPERVISOR", "JEFE_FAENA", "MECANICO", "OPERADOR"],
  },
};

function getUserRole() {
  return state.user?.role || state.user?.rol || null;
}

function getUserName() {
  return state.user?.name || state.user?.nombre || state.user?.email || "Usuario";
}

function getViewContext() {
  return {
    state,
    apiRequest,
    showToast,
    formatDate,
    formatDateOnly,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeEmailInput(value) {
  return String(value || "").trim().toLowerCase();
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Date(`${text}T12:00:00.000Z`);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return new Date(text.replace(" ", "T") + "Z");
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatChileParts(date, withTime = true) {
  const formatter = new Intl.DateTimeFormat(CHILE_LOCALE, {
    timeZone: CHILE_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }
      : {}),
  });

  const parts = formatter.formatToParts(date);
  const pick = (type) => parts.find((item) => item.type === type)?.value || "";
  const dateText = `${pick("day")}-${pick("month")}-${pick("year")}`;

  if (!withTime) {
    return dateText;
  }

  return `${dateText} ${pick("hour")}:${pick("minute")}`;
}

function updateDocumentTitle() {
  const currentMeta = VIEWS[state.currentView];
  const currentTitle = currentMeta?.title || "Solicitudes";
  const unreadPrefix = state.lastAlertsCount > 0 ? `(${state.lastAlertsCount}) ` : "";
  document.title = `${unreadPrefix}${TITLE_BASE} | ${currentTitle}`;
}

function isPhoneLayout() {
  return window.matchMedia("(max-width: 680px)").matches;
}

let modalStateObserver = null;
let lockedModalScrollY = null;

function lockModalScroll() {
  if (lockedModalScrollY !== null) {
    return;
  }

  lockedModalScrollY = window.scrollY || window.pageYOffset || 0;
  document.documentElement.style.setProperty("--modal-lock-offset", `-${lockedModalScrollY}px`);
}

function unlockModalScroll() {
  if (lockedModalScrollY === null) {
    return;
  }

  const restoreY = lockedModalScrollY;
  lockedModalScrollY = null;
  document.documentElement.style.removeProperty("--modal-lock-offset");
  window.scrollTo(0, restoreY);
}

function syncGlobalModalState() {
  const hasOpenModal = Boolean(document.querySelector(".modal:not(.hidden)"));

  if (hasOpenModal) {
    lockModalScroll();
  } else {
    unlockModalScroll();
  }

  document.documentElement.classList.toggle("modal-active", hasOpenModal);
  document.body.classList.toggle("modal-active", hasOpenModal);
}

function watchGlobalModalState() {
  if (modalStateObserver || !document.body) {
    syncGlobalModalState();
    return;
  }

  modalStateObserver = new MutationObserver(() => {
    syncGlobalModalState();
  });

  modalStateObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  syncGlobalModalState();
}

function isUrgentNotification(notification) {
  const type = String(notification?.tipo || "").toUpperCase();
  return ["SOLICITUD_NUEVA", "SOLICITUD_ESTADO"].includes(type);
}

function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    function chime(freq, startTime, duration, volume = 0.22) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // Segundo oscilador para suavizar el timbre (armónico)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();

      osc.connect(gain);
      osc2.connect(gain2);
      gain.connect(ctx.destination);
      gain2.connect(ctx.destination);

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(freq * 2, startTime); // octava superior, suave

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      gain2.gain.setValueAtTime(0, startTime);
      gain2.gain.linearRampToValueAtTime(volume * 0.18, startTime + 0.015);
      gain2.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.7);

      osc.start(startTime);
      osc.stop(startTime + duration);
      osc2.start(startTime);
      osc2.stop(startTime + duration * 0.7);
    }

    const now = ctx.currentTime;
    // Dos notas descendentes suaves, estilo chime de iPhone
    chime(1318.5, now, 0.28);          // Mi6
    chime(1046.5, now + 0.2, 0.38);   // Do6

    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch (_) {
    // silencioso si el navegador bloquea audio
  }
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.classList.toggle("error", isError);
  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer);
  }
  state.toastTimer = window.setTimeout(() => {
    toast.classList.add("hidden");
    state.toastTimer = null;
  }, 2600);
}

function advanceSessionEpoch() {
  state.sessionEpoch += 1;
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function runWhenIdle(callback, timeout = 250) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout });
    return;
  }

  window.setTimeout(callback, timeout);
}

function saveSession() {
  const storage = state.rememberSession ? localStorage : sessionStorage;
  const otherStorage = state.rememberSession ? sessionStorage : localStorage;
  const payload = JSON.stringify({
    token: state.token,
    user: state.user,
  });

  storage.setItem(SESSION_KEY, payload);
  otherStorage.removeItem(SESSION_KEY);
  localStorage.setItem(SESSION_REMEMBER_KEY, state.rememberSession ? "1" : "0");
}

function saveLastView(viewName) {
  localStorage.setItem(LAST_VIEW_KEY, viewName);
}

function loadLastView() {
  return localStorage.getItem(LAST_VIEW_KEY) || "";
}

function loadSession() {
  try {
    state.rememberSession = localStorage.getItem(SESSION_REMEMBER_KEY) === "1";
    if (rememberSessionInput) {
      rememberSessionInput.checked = state.rememberSession;
    }

    const raw =
      localStorage.getItem(SESSION_KEY) ||
      sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    state.token = parsed.token || null;
    state.user = parsed.user || null;
  } catch {
    clearSession();
  }
}

function clearSession() {
  advanceSessionEpoch();
  state.token = null;
  state.user = null;
  state.notifications = [];
  state.notificationsLoadedAt = 0;
  state.lastAlertsCount = 0;
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function resetRenderedView() {
  viewContainer.innerHTML = "";
  viewContainer.dataset.viewName = "";
}

function openSidebar() {
  sidebar.classList.add("open");
  sidebarOverlay?.classList.remove("hidden");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay?.classList.add("hidden");
}

function closeAlertsModal() {
  alertsModal.classList.add("hidden");
}

function setAuthenticatedUI(isAuthenticated) {
  loginScreen.classList.toggle("hidden", isAuthenticated);
  portalScreen.classList.toggle("hidden", !isAuthenticated);
}

function isViewAllowed(viewName) {
  const view = VIEWS[viewName];
  if (!view || !state.user) {
    return false;
  }
  return view.roles.includes(getUserRole());
}

function getDefaultView() {
  const preferredView = loadLastView();
  if (preferredView && isViewAllowed(preferredView)) {
    return preferredView;
  }

  const role = getUserRole();
  if (["OPERADOR", "JEFE_FAENA", "MECANICO"].includes(role)) {
    return "solicitudes";
  }
  return "dashboard";
}

function formatDate(dateText) {
  if (!dateText) {
    return "-";
  }

  const date = parseDateValue(dateText);
  if (!date) {
    return String(dateText);
  }

  return formatChileParts(date, true);
}

function formatDateOnly(dateText) {
  if (!dateText) {
    return "-";
  }

  const date = parseDateValue(dateText);
  if (!date) {
    return String(dateText);
  }

  return formatChileParts(date, false);
}

async function apiRequest(path, options = {}, requiresAuth = true) {
  const {
    forceLogoutOn401 = path === "/api/auth/me",
    retryOnUnauthorized = requiresAuth && path !== "/api/auth/me",
    ...fetchOptions
  } = options;
  const headers = {
    ...(fetchOptions.headers || {}),
  };
  const requestToken = requiresAuth ? state.token : null;
  const requestEpoch = state.sessionEpoch;

  if (fetchOptions.body !== undefined && !(fetchOptions.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (requiresAuth && requestToken) {
    headers.Authorization = `Bearer ${requestToken}`;
  }

  const requestBody =
    fetchOptions.body &&
    typeof fetchOptions.body !== "string" &&
    !(fetchOptions.body instanceof FormData)
      ? JSON.stringify(fetchOptions.body)
      : fetchOptions.body;

  for (let attempt = 0; attempt <= (retryOnUnauthorized ? 2 : 0); attempt += 1) {
    const response = await fetch(path, {
      ...fetchOptions,
      headers,
      body: requestBody,
    });

    const text = await response.text();
    let payload = {};

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { mensaje: text };
      }
    }

    const isCurrentAuthenticatedRequest =
      requiresAuth &&
      Boolean(requestToken) &&
      state.token === requestToken &&
      state.sessionEpoch === requestEpoch;

    if (
      response.status === 401 &&
      retryOnUnauthorized &&
      attempt < 2 &&
      isCurrentAuthenticatedRequest
    ) {
      await wait(250 * (attempt + 1));
      continue;
    }

    if (response.status === 401 && isCurrentAuthenticatedRequest && forceLogoutOn401) {
      stopRealtimeAlerts();
      stopAlertsPolling();
      stopSessionPolling();
      clearSession();
      updateAlertsBadge(0);
      closeAlertsModal();
      setAuthenticatedUI(false);
    }

    if (!response.ok) {
      throw new Error(payload.mensaje || payload.error?.message || "Error de API");
    }

    return payload;
  }
}

function updateUserBadge() {
  userBadge.textContent = `${getUserName()} (${getUserRole()})`;
}

function stopRealtimeAlerts() {
  if (state.alertsReconnectTimer) {
    window.clearTimeout(state.alertsReconnectTimer);
    state.alertsReconnectTimer = null;
  }

  if (state.alertsEventSource) {
    state.alertsEventSource.close();
    state.alertsEventSource = null;
  }
}

function shouldPollAlerts() {
  return Boolean(state.user && state.token);
}

function updateAlertsBadge(unreadCount) {
  const safeCount = Math.max(0, Number(unreadCount || 0));
  const label = safeCount > 99 ? "99+" : String(safeCount);
  alertsBadge.textContent = label;
  alertsBadge.classList.toggle("hidden", safeCount === 0);
  alertsBtn.classList.toggle("has-alerts", safeCount > 0);
  updateDocumentTitle();
}

function renderAlertsFeed() {
  if (!alertsList) {
    return;
  }

  if (!state.notifications.length) {
    alertsList.innerHTML = "<div class='history-empty'>No hay alertas recientes.</div>";
    alertsStatus.textContent = "Sin novedades";
    alertsStatus.classList.add("active");
    return;
  }

  const unreadCount = state.notifications.filter((item) => Number(item.leida) !== 1).length;
  alertsStatus.textContent = unreadCount > 0 ? `${unreadCount} sin leer` : "Todo al dia";
  alertsStatus.classList.toggle("active", unreadCount > 0);

  if (isPhoneLayout()) {
    const grouped = [];
    const groups = new Map();

    state.notifications.forEach((item) => {
      const key = item.referencia_id ? `ref-${item.referencia_id}` : `single-${item.id}`;
      const current = groups.get(key);

      if (!current) {
        groups.set(key, {
          key,
          referenciaId: item.referencia_id || null,
          latest: item,
          team: item.nombre_equipo || "Portal FMN",
          unreadCount: Number(item.leida) !== 1 ? 1 : 0,
          urgentCount: Number(item.leida) !== 1 && isUrgentNotification(item) ? 1 : 0,
          ids: [Number(item.id)],
          total: 1,
        });
        return;
      }

      current.total += 1;
      current.ids.push(Number(item.id));
      if (Number(item.leida) !== 1) {
        current.unreadCount += 1;
      }
      if (Number(item.leida) !== 1 && isUrgentNotification(item)) {
        current.urgentCount += 1;
      }
    });

    groups.forEach((group) => grouped.push(group));
    grouped.sort((a, b) => {
      if (a.urgentCount !== b.urgentCount) {
        return b.urgentCount - a.urgentCount;
      }
      if (a.unreadCount !== b.unreadCount) {
        return b.unreadCount - a.unreadCount;
      }
      return new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime();
    });

    alertsStatus.textContent =
      unreadCount > 0 ? `${unreadCount} sin leer · resumen movil` : "Todo al dia";

    alertsList.innerHTML = grouped
      .map((group) => {
        const unread = group.unreadCount > 0;
        const subtitle = group.urgentCount > 0
          ? `${group.urgentCount} importante(s)`
          : unread
            ? `${group.unreadCount} sin leer`
            : `${group.total} movimiento(s)`;
        const title = group.referenciaId
          ? `Solicitud #${group.referenciaId}`
          : escapeHtml(group.latest.titulo || group.latest.tipo || "Alerta");

        return `
          <article class="alert-card alert-card-mobile-group ${unread ? "alert-card-unread" : ""} ${
            group.urgentCount > 0 ? "alert-card-urgent" : ""
          }">
            <div class="alert-card-top">
              <strong>${title}</strong>
              <span>${formatDate(group.latest.created_at)}</span>
            </div>
            <p>${escapeHtml(group.latest.mensaje || "-")}</p>
            <div class="alert-card-group-meta">
              <span class="alert-card-meta">${escapeHtml(group.team)}</span>
              <span class="mini-chip ${group.urgentCount > 0 ? "active" : ""}">${subtitle}</span>
            </div>
            <div class="alert-card-actions">
              ${
                unread
                  ? `<button class="table-btn secondary" data-alert-group-read="${group.ids.join(",")}" type="button">
                       Marcar grupo
                     </button>`
                  : `<span class="mini-chip">Leidas</span>`
              }
            </div>
          </article>
        `;
      })
      .join("");
    return;
  }

  alertsList.innerHTML = state.notifications
    .map((item) => {
      const unread = Number(item.leida) !== 1;
      return `
        <article class="alert-card ${unread ? "alert-card-unread" : ""}">
          <div class="alert-card-top">
            <strong>${escapeHtml(item.titulo || item.tipo || "Alerta")}</strong>
            <span>${formatDate(item.created_at)}</span>
          </div>
          <p>${escapeHtml(item.mensaje || "-")}</p>
          <div class="alert-card-actions">
            <span class="alert-card-meta">${escapeHtml(item.nombre_equipo || "Portal FMN")}</span>
            ${
              unread
                ? `<button class="table-btn secondary" data-alert-read="${item.id}" type="button">
                     Marcar leida
                   </button>`
                : `<span class="mini-chip">Leida</span>`
            }
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadNotifications(showToastMessage = "") {
  if (!state.token) {
    return;
  }

  const payload = await apiRequest("/api/notificaciones?limit=12");
  state.notifications = payload.data || [];
  state.notificationsLoadedAt = Date.now();
  renderAlertsFeed();

  if (showToastMessage) {
    showToast(showToastMessage);
  }
}

async function checkAlerts(showToastOnNew = false) {
  if (!shouldPollAlerts()) {
    state.lastAlertsCount = 0;
    updateAlertsBadge(0);
    return;
  }

  const payload = await apiRequest("/api/notificaciones?soloNoLeidas=1&limit=50");
  const unreadCount = (payload.data || []).length;

  if (showToastOnNew && unreadCount > state.lastAlertsCount) {
    playNotificationSound();
    showToast("Hay novedades nuevas en solicitudes o mensajes.");
    await loadNotifications();
  }

  state.lastAlertsCount = unreadCount;
  updateAlertsBadge(unreadCount);
}

function handleRealtimeNotification(notification) {
  if (!notification || !notification.id) {
    return;
  }

  const exists = state.notifications.some((item) => Number(item.id) === Number(notification.id));
  if (!exists) {
    state.notifications = [notification, ...state.notifications].slice(0, 12);
  } else {
    state.notifications = state.notifications.map((item) =>
      Number(item.id) === Number(notification.id) ? { ...item, ...notification } : item
    );
  }

  if (!exists && Number(notification.leida) !== 1) {
    state.lastAlertsCount += 1;
    playNotificationSound();
  } else {
    state.lastAlertsCount = Math.max(
      state.lastAlertsCount,
      state.notifications.filter((item) => Number(item.leida) !== 1).length
    );
  }

  renderAlertsFeed();
  updateAlertsBadge(state.lastAlertsCount);
  if (!isPhoneLayout() || isUrgentNotification(notification)) {
    showToast(notification.titulo || "Nueva alerta recibida");
  }
  window.dispatchEvent(new CustomEvent("fmn:notification", { detail: notification }));
}

function connectRealtimeAlerts() {
  if (!("EventSource" in window) || !state.token || document.hidden) {
    return;
  }

  stopRealtimeAlerts();
  const streamUrl = `/api/notificaciones/stream?token=${encodeURIComponent(state.token)}`;
  const eventSource = new EventSource(streamUrl);
  state.alertsEventSource = eventSource;

  eventSource.addEventListener("notification", (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleRealtimeNotification(payload);
    } catch {
      // Ignorar payloads invalidos.
    }
  });

  eventSource.addEventListener("connected", () => {
    // Conexion lista.
  });

  eventSource.onerror = () => {
    if (!state.token) {
      stopRealtimeAlerts();
      return;
    }

    stopRealtimeAlerts();
    state.alertsReconnectTimer = window.setTimeout(() => {
      connectRealtimeAlerts();
    }, 7000);
  };
}

function stopAlertsPolling() {
  if (state.alertsPoller) {
    window.clearInterval(state.alertsPoller);
    state.alertsPoller = null;
  }
}

function startAlertsPolling() {
  stopAlertsPolling();
  if (!shouldPollAlerts()) {
    return;
  }

  if (!document.hidden) {
    connectRealtimeAlerts();
    checkAlerts(false).catch(() => {
      // Ignorar errores de polling.
    });
  }

  state.alertsPoller = window.setInterval(() => {
    if (document.hidden) {
      return;
    }
    checkAlerts(true).catch(() => {
      // Ignorar errores de polling.
    });
  }, 45000);
}

function stopSessionPolling() {
  if (state.sessionPoller) {
    window.clearInterval(state.sessionPoller);
    state.sessionPoller = null;
  }
}

async function checkSessionProfile() {
  if (!state.token || document.hidden) {
    return;
  }

  const payload = await apiRequest("/api/auth/me");
  const freshUser = payload?.user;
  if (!freshUser) {
    return;
  }

  const currentRole = getUserRole();
  const currentEquipoId = state.user?.equipo_id ?? null;
  const freshRole = freshUser.role || freshUser.rol || null;
  const freshEquipoId = freshUser.equipo_id ?? null;

  const roleChanged = currentRole !== freshRole;
  const equipoChanged = String(currentEquipoId) !== String(freshEquipoId);

  if (!roleChanged && !equipoChanged) {
    return;
  }

  state.user = { ...state.user, ...freshUser };
  saveSession();
  updateUserBadge();
  updateNavByRole();

  const msg = roleChanged
    ? `Tu rol fue actualizado a ${freshRole}. La vista se recargo.`
    : "Tu equipo fue actualizado. La vista se recargo.";
  showToast(msg);

  await loadView(state.currentView, { force: true });
}

function startSessionPolling() {
  stopSessionPolling();
  if (!state.token) {
    return;
  }

  state.sessionPoller = window.setInterval(() => {
    checkSessionProfile().catch(() => {
      // Ignorar errores de polling de sesion.
    });
  }, 60000);
}

function handleVisibilityChange() {
  if (!state.token) {
    return;
  }

  if (document.hidden) {
    stopRealtimeAlerts();
    return;
  }

  connectRealtimeAlerts();
  checkAlerts(false).catch(() => {
    // Ignorar errores al retomar el foco.
  });
}

function updateNavByRole() {
  const buttons = sidebarNav.querySelectorAll(".nav-item");
  for (const button of buttons) {
    const viewName = button.dataset.view;
    button.classList.toggle("hidden", !isViewAllowed(viewName));
  }
}

function setActiveNav(viewName) {
  const buttons = sidebarNav.querySelectorAll(".nav-item");
  for (const button of buttons) {
    button.classList.toggle("active", button.dataset.view === viewName);
  }
  helpBtn?.classList.toggle("active", viewName === "como-usar");
}

function renderViewLoading(meta) {
  pageTitle.textContent = meta.title;
  pageSubtitle.textContent = meta.subtitle;
  viewContainer.innerHTML = `
    <section class="loading-view">
      <div class="loading-view-hero"></div>
      <div class="loading-view-grid">
        <div class="loading-card"></div>
        <div class="loading-card"></div>
        <div class="loading-card wide"></div>
      </div>
    </section>
  `;
}

async function getViewMarkup(meta) {
  if (state.viewCache.has(meta.file)) {
    return state.viewCache.get(meta.file);
  }

  if (state.viewMarkupRequests.has(meta.file)) {
    return state.viewMarkupRequests.get(meta.file);
  }

  const requestPromise = fetch(meta.file)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`No se pudo cargar la vista '${meta.title}'`);
      }

      const markup = await response.text();
      state.viewCache.set(meta.file, markup);
      return markup;
    })
    .finally(() => {
      state.viewMarkupRequests.delete(meta.file);
    });

  state.viewMarkupRequests.set(meta.file, requestPromise);
  return requestPromise;
}

async function getViewController(viewName) {
  if (state.viewModuleCache.has(viewName)) {
    return state.viewModuleCache.get(viewName);
  }

  const loaders = {
    dashboard: () => import(`/js/dashboard.js?v=${ASSET_VERSION}`).then((module) => module.initDashboardView),
    solicitudes: () => import(`/js/solicitudes.js?v=${ASSET_VERSION}`).then((module) => module.initSolicitudesView),
    usuarios: () => import(`/js/usuarios.js?v=${ASSET_VERSION}`).then((module) => module.initUsuariosView),
    powerbi: () => import(`/js/powerbi.js?v=${ASSET_VERSION}`).then((module) => module.initPowerBIView),
    "como-usar": () => import(`/js/como-usar.js?v=${ASSET_VERSION}`).then((module) => module.initComoUsarView),
  };

  const loader = loaders[viewName];
  if (!loader) {
    throw new Error(`No existe controlador para la vista '${viewName}'`);
  }

  const modulePromise = loader().catch((error) => {
    state.viewModuleCache.delete(viewName);
    throw error;
  });
  state.viewModuleCache.set(viewName, modulePromise);
  return modulePromise;
}

function prefetchView(viewName) {
  if (!isViewAllowed(viewName)) {
    return;
  }

  const meta = VIEWS[viewName];
  if (!meta) {
    return;
  }

  runWhenIdle(() => {
    getViewMarkup(meta).catch(() => {
      // Ignorar errores de precarga.
    });
    getViewController(viewName).catch(() => {
      // Ignorar errores de precarga.
    });
  }, 100);
}

function prefetchAllowedViews() {
  runWhenIdle(() => {
    Object.entries(VIEWS)
      .filter(([viewName]) => isViewAllowed(viewName))
      .forEach(([viewName]) => {
        prefetchView(viewName);
      });
  });
}

async function loadView(viewName, options = {}) {
  const targetView = isViewAllowed(viewName) ? viewName : getDefaultView();
  const meta = VIEWS[targetView];
  const currentRenderedView = viewContainer.dataset.viewName || "";

  if (!options.force && targetView === currentRenderedView) {
    setActiveNav(targetView);
    return;
  }

  const requestId = ++state.activeViewRequestId;
  setActiveNav(targetView);
  renderViewLoading(meta);

  const [markup, controller] = await Promise.all([
    getViewMarkup(meta),
    getViewController(targetView),
  ]);
  if (requestId !== state.activeViewRequestId) {
    return;
  }

  viewContainer.innerHTML = markup;
  viewContainer.classList.remove("view-entering");
  void viewContainer.offsetWidth; // reflow para re-triggerear la animación
  viewContainer.classList.add("view-entering");
  const enteredView = viewContainer.firstElementChild;
  if (enteredView) {
    enteredView.addEventListener(
      "animationend",
      (event) => {
        if (event.target === enteredView) {
          viewContainer.classList.remove("view-entering");
        }
      },
      { once: true }
    );
  }
  viewContainer.dataset.viewName = targetView;
  pageTitle.textContent = meta.title;
  pageSubtitle.textContent = meta.subtitle;
  state.currentView = targetView;
  saveLastView(targetView);
  updateDocumentTitle();

  if (typeof controller === "function") {
    await controller(getViewContext());
  }
}

function openAlertsModal() {
  alertsModal.classList.remove("hidden");
  if (state.notifications.length) {
    alertsStatus.textContent = "Usando datos recientes";
    renderAlertsFeed();
  } else {
    alertsStatus.textContent = "Actualizando...";
  }

  const isStale = Date.now() - state.notificationsLoadedAt > NOTIFICATIONS_STALE_MS;
  if (isStale || !state.notifications.length) {
    loadNotifications().catch((error) => {
      alertsStatus.textContent = "Error al cargar";
      showToast(error.message, true);
    });
  }
}

async function markNotificationAsRead(notificationId) {
  await apiRequest(`/api/notificaciones/${notificationId}/leer`, { method: "PUT" });
  const targetItem = state.notifications.find((item) => Number(item.id) === Number(notificationId));
  if (targetItem) {
    targetItem.leida = 1;
  }
  state.lastAlertsCount = Math.max(0, state.lastAlertsCount - 1);
  renderAlertsFeed();
  updateAlertsBadge(state.lastAlertsCount);
}

async function markNotificationsGroupAsRead(notificationIds = []) {
  const ids = notificationIds
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!ids.length) {
    return;
  }

  await Promise.all(
    ids.map((notificationId) => apiRequest(`/api/notificaciones/${notificationId}/leer`, { method: "PUT" }))
  );
  state.notifications = state.notifications.map((item) =>
    ids.includes(Number(item.id)) ? { ...item, leida: 1 } : item
  );
  state.lastAlertsCount = state.notifications.filter((item) => Number(item.leida) !== 1).length;
  renderAlertsFeed();
  updateAlertsBadge(state.lastAlertsCount);
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
}

function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isWindowsDevice() {
  const platform =
    window.navigator.userAgentData?.platform ||
    window.navigator.platform ||
    window.navigator.userAgent ||
    "";
  return /win/i.test(String(platform));
}

function applyPlatformHints() {
  document.documentElement.classList.toggle("platform-windows", isWindowsDevice());
}

function updateInstallButtonVisibility() {
  const shouldShow = Boolean(state.deferredInstallPrompt) && !isStandaloneMode();
  installAppBtn.classList.toggle("hidden", !shouldShow);
}

function registerPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`/sw.js?v=${ASSET_VERSION}`).then((registration) => {
      registration.update().catch(() => {
        // Ignorar errores de update.
      });
    }).catch(() => {
      // Ignorar errores silenciosamente.
    });

    let reloadedOnControllerChange = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadedOnControllerChange) {
        return;
      }
      reloadedOnControllerChange = true;
      window.location.reload();
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    updateInstallButtonVisibility();
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    updateInstallButtonVisibility();
    showToast("La app quedo instalada en este dispositivo.");
  });
}

async function handleInstallApp() {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    const choice = await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    updateInstallButtonVisibility();

    if (choice.outcome === "accepted") {
      showToast("Instalacion iniciada.");
      return;
    }

    showToast("Instalacion cancelada.");
    return;
  }

  if (isIOSDevice()) {
    showToast("En iPhone o iPad usa Compartir y luego Agregar a pantalla de inicio.");
    return;
  }

  showToast("Si tu navegador lo permite, abre el menu y elige Instalar app.");
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  loginError.classList.add("hidden");

  const formData = new FormData(loginForm);
  const email = normalizeEmailInput(formData.get("email"));
  const password = String(formData.get("password") || "");
  state.rememberSession = formData.get("remember_session") === "on";

  const emailInput = document.getElementById("email");
  if (emailInput) {
    emailInput.value = email;
  }

  try {
    const payload = await apiRequest(
      "/api/auth/login",
      {
        method: "POST",
        body: { email, password },
      },
      false
    );

    stopRealtimeAlerts();
    stopAlertsPolling();
    advanceSessionEpoch();
    state.token = payload.token;
    state.user = payload.user;
    saveSession();

    updateUserBadge();
    updateNavByRole();
    startAlertsPolling();
    startSessionPolling();
    setAuthenticatedUI(true);
    showToast("Sesion iniciada");
    loginForm.reset();

    // Inicializar asistente IA
    import(`/js/aiAssistant.js?v=${ASSET_VERSION}`)
      .then(({ initAiAssistant }) => initAiAssistant(getViewContext()))
      .catch(() => {});

    try {
      await loadView(getDefaultView());
      prefetchAllowedViews();
    } catch (viewError) {
      showToast(viewError.message, true);
    }

    runWhenIdle(() => {
      loadNotifications().catch((notificationsError) => {
        showToast(notificationsError.message, true);
      });
    }, 120);
  } catch (error) {
    loginError.textContent = error.message;
    loginError.classList.remove("hidden");
  }
}

function logout() {
  stopRealtimeAlerts();
  stopAlertsPolling();
  stopSessionPolling();
  clearSession();
  state.rememberSession = false;
  localStorage.setItem(SESSION_REMEMBER_KEY, "0");
  if (rememberSessionInput) {
    rememberSessionInput.checked = false;
  }
  updateAlertsBadge(0);
  closeAlertsModal();
  resetRenderedView();
  setAuthenticatedUI(false);
  updateDocumentTitle();
  showToast("Sesion cerrada");
}

async function restoreSession() {
  loadSession();
  if (!state.token) {
    return false;
  }

  try {
    const payload = await apiRequest("/api/auth/me");
    advanceSessionEpoch();
    state.user = payload.user;
    saveSession();
    return true;
  } catch {
    clearSession();
    return false;
  }
}

// ── Novedades ─────────────────────────────────────────────────────────────────
const NOVEDADES_LS_KEY = "fmn_novedades_seen_at";

const NOV_TIPO_META = {
  feature: { label: "🚀 Nueva función", cls: "feature" },
  mejora:  { label: "✨ Mejora",        cls: "mejora"  },
  fix:     { label: "🐛 Corrección",    cls: "fix"     },
};

function openNovedadesModal() {
  novedadesModal.classList.remove("hidden");
  // Mostrar botón agregar solo para ADMIN
  const isAdmin = (state.user?.role || state.user?.rol) === "ADMIN";
  novedadesAddBtn?.classList.toggle("hidden", !isAdmin);
  loadNovedades();
  // Marcar como visto
  localStorage.setItem(NOVEDADES_LS_KEY, new Date().toISOString());
  novedadesBadge?.classList.add("hidden");
}

function closeNovedadesModal() {
  novedadesModal.classList.add("hidden");
  novedadesFormWrap?.classList.add("hidden");
  novedadesForm?.reset();
}

async function loadNovedades() {
  if (!novedadesList) return;
  novedadesList.innerHTML = "<div class='history-empty'>Cargando…</div>";
  try {
    const { data } = await apiRequest("/novedades");
    const items = Array.isArray(data) ? data : [];
    if (!items.length) {
      novedadesList.innerHTML = "<div class='history-empty'>Sin novedades publicadas todavía.</div>";
      return;
    }
    const isAdmin = (state.user?.role || state.user?.rol) === "ADMIN";
    const lastSeen = localStorage.getItem(NOVEDADES_LS_KEY) || "1970-01-01T00:00:00Z";
    novedadesList.innerHTML = items.map((n) => {
      const meta = NOV_TIPO_META[n.tipo] || NOV_TIPO_META.feature;
      const isNew = n.created_at > lastSeen;
      const fecha = n.created_at ? n.created_at.slice(0, 16).replace("T", " ") : "-";
      return `
        <div class="novedades-card">
          <div class="novedades-card-head">
            <span class="novedades-card-tipo ${meta.cls}">${meta.label}</span>
            ${isNew ? '<span class="mini-chip active" style="font-size:0.72rem">Nuevo</span>' : ""}
            <span class="novedades-card-titulo">${n.titulo}</span>
          </div>
          <p class="novedades-card-desc">${n.descripcion}</p>
          <div class="novedades-card-meta">
            <span>👤 ${n.autor_nombre || "Admin"} · 📅 ${fecha}</span>
            ${isAdmin ? `<button class="action-btn secondary" style="font-size:0.78rem;min-height:28px;padding:0.15rem 0.6rem;color:#c62828" data-nov-delete="${n.id}">Eliminar</button>` : ""}
          </div>
        </div>`;
    }).join("");
  } catch {
    novedadesList.innerHTML = "<div class='history-empty'>Error al cargar novedades.</div>";
  }
}

async function refreshNovedadesBadge() {
  try {
    const since = localStorage.getItem(NOVEDADES_LS_KEY) || "1970-01-01T00:00:00Z";
    const { data } = await apiRequest(`/novedades/count?since=${encodeURIComponent(since)}`);
    const n = data?.count || 0;
    if (novedadesBadge) {
      novedadesBadge.classList.toggle("hidden", n === 0);
      novedadesBadge.textContent = n;
    }
  } catch { /* no crítico */ }
}

// ── Feedback ──────────────────────────────────────────────────────────────────
function openFeedbackModal() {
  feedbackModal.classList.remove("hidden");
  feedbackTitulo?.focus();
}
function closeFeedbackModal() {
  feedbackModal.classList.add("hidden");
}

async function loadFeedbackList() {
  try {
    const { data } = await apiRequest("/feedback");
    const items = Array.isArray(data) ? data : [];
    if (!items.length) {
      feedbackList.innerHTML = "<div class='history-empty'>Sin feedback recibido todavía.</div>";
      return;
    }
    const TIPO_LABEL = { idea: "💡 Idea", error: "🐛 Error" };
    feedbackList.innerHTML = items.map((fb) => `
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
      </div>
    `).join("");
  } catch {
    feedbackList.innerHTML = "<div class='history-empty'>Error al cargar feedback.</div>";
  }
}

async function refreshFeedbackBadge() {
  try {
    const { data } = await apiRequest("/feedback/count");
    const n = data?.unread || 0;
    feedbackBadge?.classList.toggle("hidden", n === 0);
    if (feedbackBadge) feedbackBadge.textContent = n;
    if (feedbackUnreadChip) {
      feedbackUnreadChip.classList.toggle("hidden", n === 0);
      feedbackUnreadChip.textContent = n;
    }
  } catch { /* no es crítico */ }
}

function registerEvents() {
  loginForm.addEventListener("submit", handleLoginSubmit);
  logoutBtn.addEventListener("click", logout);
  helpBtn.addEventListener("click", async () => {
    await loadView("como-usar");
    closeSidebar();
  });

  // Novedades
  novedadesBtn?.addEventListener("click", openNovedadesModal);
  novedadesCloseBtn?.addEventListener("click", closeNovedadesModal);
  novedadesModal?.addEventListener("click", (e) => {
    if (e.target.dataset.close === "true") closeNovedadesModal();
  });

  novedadesAddBtn?.addEventListener("click", () => {
    novedadesFormWrap?.classList.remove("hidden");
    novedadesAddBtn.classList.add("hidden");
    novedadesTitulo?.focus();
  });

  novedadesCancelBtn?.addEventListener("click", () => {
    novedadesFormWrap?.classList.add("hidden");
    novedadesAddBtn?.classList.remove("hidden");
    novedadesForm?.reset();
  });

  novedadesForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    novedadesFormErr?.classList.add("hidden");
    const tipo = novedadesForm.querySelector("input[name=nov_tipo]:checked")?.value || "feature";
    const titulo = novedadesTitulo?.value.trim();
    const descripcion = novedadesDesc?.value.trim();
    if (!titulo || !descripcion) return;
    novedadesSubmitBtn.disabled = true;
    novedadesSubmitBtn.textContent = "Publicando…";
    try {
      await apiRequest("/novedades", {
        method: "POST",
        body: JSON.stringify({ tipo, titulo, descripcion }),
      });
      novedadesForm.reset();
      novedadesFormWrap?.classList.add("hidden");
      novedadesAddBtn?.classList.remove("hidden");
      showToast("Novedad publicada correctamente.");
      loadNovedades();
    } catch (err) {
      if (novedadesFormErr) {
        novedadesFormErr.textContent = err.message || "Error al publicar";
        novedadesFormErr.classList.remove("hidden");
      }
    } finally {
      novedadesSubmitBtn.disabled = false;
      novedadesSubmitBtn.textContent = "Publicar";
    }
  });

  novedadesList?.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-nov-delete]");
    if (!del) return;
    await apiRequest(`/novedades/${del.dataset.novDelete}`, { method: "DELETE" });
    loadNovedades();
  });

  // Feedback
  feedbackBtn?.addEventListener("click", () => {
    openFeedbackModal();
    // si es admin, mostrar tab de lista
    const role = state.user?.role || state.user?.rol || "";
    const isAdmin = role === "ADMIN";
    document.querySelectorAll(".feedback-tab.admin-only").forEach((t) => t.classList.toggle("hidden", !isAdmin));
  });
  feedbackCloseBtn?.addEventListener("click", closeFeedbackModal);
  feedbackModal?.addEventListener("click", (e) => {
    if (e.target.dataset.closeFeedback === "true") closeFeedbackModal();
  });

  // Tabs enviar / lista
  document.getElementById("feedback-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".feedback-tab");
    if (!tab) return;
    document.querySelectorAll(".feedback-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const isPanelList = tab.dataset.tab === "list";
    feedbackPanelSend?.classList.toggle("hidden", isPanelList);
    feedbackPanelList?.classList.toggle("hidden", !isPanelList);
    if (isPanelList) loadFeedbackList();
  });

  // Acciones en lista (marcar leído / eliminar)
  feedbackList?.addEventListener("click", async (e) => {
    const markBtn = e.target.closest("[data-fb-mark]");
    const delBtn  = e.target.closest("[data-fb-delete]");
    if (markBtn) {
      await apiRequest(`/feedback/${markBtn.dataset.fbMark}/leido`, { method: "PATCH" });
      loadFeedbackList();
      refreshFeedbackBadge();
    }
    if (delBtn) {
      await apiRequest(`/feedback/${delBtn.dataset.fbDelete}`, { method: "DELETE" });
      loadFeedbackList();
      refreshFeedbackBadge();
    }
  });

  // Envío del formulario
  feedbackForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    feedbackFormError?.classList.add("hidden");
    const tipo = feedbackForm.querySelector("input[name=feedback_tipo]:checked")?.value || "idea";
    const titulo = feedbackTitulo?.value.trim();
    const descripcion = feedbackDesc?.value.trim();
    if (!titulo || !descripcion) return;
    feedbackSubmitBtn.disabled = true;
    feedbackSubmitBtn.textContent = "Enviando...";
    try {
      await apiRequest("/feedback", {
        method: "POST",
        body: JSON.stringify({ tipo, titulo, descripcion }),
      });
      feedbackForm.reset();
      closeFeedbackModal();
      showToast("¡Feedback enviado! Gracias por tu aporte.");
    } catch (err) {
      if (feedbackFormError) {
        feedbackFormError.textContent = err.message || "Error al enviar";
        feedbackFormError.classList.remove("hidden");
      }
    } finally {
      feedbackSubmitBtn.disabled = false;
      feedbackSubmitBtn.textContent = "Enviar";
    }
  });

  alertsBtn.addEventListener("click", openAlertsModal);
  alertsCloseBtn.addEventListener("click", closeAlertsModal);
  alertsRefreshBtn.addEventListener("click", async () => {
    try {
      alertsStatus.textContent = "Actualizando...";
      await Promise.all([loadNotifications(), checkAlerts(false)]);
      showToast("Alertas actualizadas");
    } catch (error) {
      alertsStatus.textContent = "Error al cargar";
      showToast(error.message, true);
    }
  });
  alertsModal.addEventListener("click", (event) => {
    if (event.target.matches(".modal-backdrop") || event.target.dataset.close === "true") {
      closeAlertsModal();
    }
  });
  alertsList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-alert-read]");
    const groupButton = event.target.closest("[data-alert-group-read]");

    try {
      if (button) {
        await markNotificationAsRead(Number(button.dataset.alertRead));
        showToast("Alerta marcada como leida");
        return;
      }

      if (groupButton) {
        const ids = String(groupButton.dataset.alertGroupRead || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        await markNotificationsGroupAsRead(ids);
        showToast("Grupo de alertas marcado como leido");
      }
    } catch (error) {
      showToast(error.message, true);
    }
  });

  installAppBtn.addEventListener("click", async () => {
    try {
      await handleInstallApp();
    } catch (error) {
      showToast(error.message, true);
    }
  });

  menuToggle.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) {
      closeSidebar();
      return;
    }

    openSidebar();
  });

  sidebarOverlay?.addEventListener("click", closeSidebar);

  sidebarNav.addEventListener("click", async (event) => {
    const button = event.target.closest(".nav-item");
    if (!button) {
      return;
    }

    const viewName = button.dataset.view;
    if (!isViewAllowed(viewName)) {
      return;
    }

    await loadView(viewName);
    closeSidebar();
  });

  sidebarNav.addEventListener("mouseover", (event) => {
    const button = event.target.closest(".nav-item");
    if (button?.dataset.view) {
      prefetchView(button.dataset.view);
    }
  });

  sidebarNav.addEventListener("focusin", (event) => {
    const button = event.target.closest(".nav-item");
    if (button?.dataset.view) {
      prefetchView(button.dataset.view);
    }
  });

  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });

  togglePasswordBtn?.addEventListener("click", () => {
    const isText = passwordInput?.type === "text";
    if (!passwordInput) {
      return;
    }

    passwordInput.type = isText ? "password" : "text";
    togglePasswordBtn.textContent = isText ? "Mostrar" : "Ocultar";
  });
}

async function bootstrap() {
  applyPlatformHints();
  registerPWA();
  registerEvents();
  watchGlobalModalState();
  updateDocumentTitle();
  updateInstallButtonVisibility();

  const isAuthenticated = await restoreSession();

  if (!isAuthenticated) {
    resetRenderedView();
    setAuthenticatedUI(false);
    return;
  }

  updateUserBadge();
  updateNavByRole();
  startAlertsPolling();
  startSessionPolling();
  // Badge de novedades para todos los roles
  refreshNovedadesBadge().catch(() => {});
  // Badge de feedback solo para ADMIN
  const _fbRole = state.user?.role || state.user?.rol || "";
  if (_fbRole === "ADMIN") refreshFeedbackBadge().catch(() => {});
  setAuthenticatedUI(true);
  await loadView(getDefaultView());
  prefetchAllowedViews();
  runWhenIdle(() => {
    loadNotifications().catch(() => {
      // Ignorar error silenciosamente en bootstrap diferido.
    });
  }, 120);

  // Inicializar asistente IA
  import(`/js/aiAssistant.js?v=${ASSET_VERSION}`)
    .then(({ initAiAssistant }) => initAiAssistant(getViewContext()))
    .catch(() => {});
}

bootstrap();
