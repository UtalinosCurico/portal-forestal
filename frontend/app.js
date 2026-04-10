const ASSET_VERSION = window.__APP_VERSION__ || "dev";
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

function registerEvents() {
  loginForm.addEventListener("submit", handleLoginSubmit);
  logoutBtn.addEventListener("click", logout);
  helpBtn.addEventListener("click", async () => {
    await loadView("como-usar");
    closeSidebar();
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

