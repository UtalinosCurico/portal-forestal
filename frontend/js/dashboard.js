let estadoChart;
let equipoChart;
let tiempoChart;
let chartJsPromise;

const STATUS_LABELS = {
  PENDIENTE: "Pendiente",
  EN_REVISION: "En gestion",
  APROBADO: "Aprobada",
  EN_DESPACHO: "En despacho",
  ENTREGADO: "Entregada",
  RECHAZADO: "Rechazada",
};

function buildQueryString(filters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });
  return params.toString() ? `?${params.toString()}` : "";
}

function getStatusLabel(status) {
  return STATUS_LABELS[status] || status || "-";
}

function getStatusClass(status) {
  const normalized = String(status || "").toLowerCase().replaceAll("_", "-");
  return `status-badge status-${normalized}`;
}

function renderStatusBadge(status) {
  return `<span class="${getStatusClass(status)}">${getStatusLabel(status)}</span>`;
}

function renderAlertsList(rows, formatDate, container) {
  if (!container) {
    return;
  }

  if (!rows.length) {
    container.innerHTML = "<div class='history-empty'>Sin novedades recientes.</div>";
    return;
  }

  container.innerHTML = rows
    .map(
      (row) => `
        <article class="alert-card">
          <div class="alert-card-top">
            <strong>${row.tipo || "Novedad"}</strong>
            <span>${formatDate(row.created_at)}</span>
          </div>
          <p>${row.mensaje || "-"}</p>
          <div class="alert-card-meta">${row.nombre_equipo || "Sin equipo"}</div>
        </article>
      `
    )
    .join("");
}

function getUrgencyClass(days = 0) {
  const value = Number(days || 0);
  if (value > 7) return "urgencia-rojo";
  if (value >= 3) return "urgencia-amarillo";
  return "urgencia-verde";
}

function getActionTypeLabel(type) {
  const labels = {
    SOLICITUD_PENDIENTE: "Aprobar",
    ITEM_ATRASADO: "Atrasado",
    ITEM_POR_GESTIONAR: "Gestionar",
  };
  return labels[type] || "Accion";
}

function renderMyActions(rows, container, countEl) {
  if (!container) {
    return;
  }

  if (countEl) {
    countEl.textContent = `${rows.length} accion${rows.length !== 1 ? "es" : ""}`;
  }

  if (!rows.length) {
    container.innerHTML = "<div class='history-empty'>Sin acciones pendientes para hoy.</div>";
    return;
  }

  container.innerHTML = rows
    .map((row) => {
      const days = Number(row.dias_sin_movimiento || 0);
      const qty =
        row.cantidad !== null && row.cantidad !== undefined
          ? `<span>${row.cantidad} ${row.unidad_medida || ""}</span>`
          : "";
      const code = row.codigo_referencia ? `<span>${row.codigo_referencia}</span>` : "";
      return `
        <button class="my-action-card" data-open-solicitud="${row.solicitud_id}" type="button">
          <div class="my-action-top">
            <span class="mini-chip">${getActionTypeLabel(row.tipo)}</span>
            <span class="urgencia-badge ${getUrgencyClass(days)}">${days} dia${days !== 1 ? "s" : ""}</span>
          </div>
          <strong>${row.titulo || "Accion pendiente"}</strong>
          <p>${row.descripcion || `Solicitud #${row.solicitud_id}`}</p>
          <div class="my-action-meta">
            <span>${row.equipo || "Sin equipo"}</span>
            ${qty}
            ${code}
          </div>
        </button>
      `;
    })
    .join("");
}

function openSolicitudFromDashboard(solicitudId) {
  if (!solicitudId) {
    return;
  }
  sessionStorage.setItem("fmn-open-solicitud-id", String(solicitudId));
  document.querySelector('.nav-item[data-view="solicitudes"]')?.click();
}

function renderSolicitudesTable(rows, formatDate, bodyEl) {
  if (!rows.length) {
    bodyEl.innerHTML = "<tr><td colspan='8'>Sin solicitudes para mostrar</td></tr>";
    return;
  }

  bodyEl.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${row.id}</td>
          <td>${row.equipo || "-"}</td>
          <td>${row.repuesto || "-"}</td>
          <td>${row.cantidad ?? "-"}</td>
          <td>${renderStatusBadge(row.estado)}</td>
          <td>${formatDate(row.created_at)}</td>
          <td>${formatDate(row.dispatched_at)}</td>
          <td>${formatDate(row.received_at)}</td>
        </tr>
      `
    )
    .join("");
}

function destroyCharts() {
  if (estadoChart) {
    estadoChart.destroy();
    estadoChart = null;
  }

  if (equipoChart) {
    equipoChart.destroy();
    equipoChart = null;
  }

  if (tiempoChart) {
    tiempoChart.destroy();
    tiempoChart = null;
  }
}

async function ensureChartJs() {
  if (window.Chart) {
    return window.Chart;
  }

  if (!chartJsPromise) {
    chartJsPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector("script[data-chartjs-loader='1']");
      if (existing) {
        existing.addEventListener("load", () => resolve(window.Chart), { once: true });
        existing.addEventListener("error", () => reject(new Error("No se pudo cargar Chart.js")), {
          once: true,
        });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js";
      script.async = true;
      script.dataset.chartjsLoader = "1";
      script.addEventListener("load", () => resolve(window.Chart), { once: true });
      script.addEventListener("error", () => reject(new Error("No se pudo cargar Chart.js")), {
        once: true,
      });
      document.head.appendChild(script);
    }).catch((error) => {
      chartJsPromise = null;
      throw error;
    });
  }

  return chartJsPromise;
}

function renderCharts(data, formatDateOnly) {
  const estadoCtx = document.getElementById("chart-solicitudes-estado");
  const equipoCtx = document.getElementById("chart-solicitudes-equipo");
  const tiempoCtx = document.getElementById("chart-solicitudes-tiempo");

  if (!estadoCtx || !equipoCtx || !tiempoCtx || !window.Chart) {
    return;
  }

  destroyCharts();

  estadoChart = new window.Chart(estadoCtx, {
    type: "doughnut",
    data: {
      labels: (data.solicitudes_por_estado || []).map((item) => item.estado),
      datasets: [
        {
          data: (data.solicitudes_por_estado || []).map((item) => item.total),
          backgroundColor: ["#1f6f50", "#3b8f66", "#62ad81", "#93c9ab"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  });

  equipoChart = new window.Chart(equipoCtx, {
    type: "bar",
    data: {
      labels: (data.solicitudes_por_equipo || []).map((item) => item.equipo),
      datasets: [
        {
          label: "Solicitudes",
          data: (data.solicitudes_por_equipo || []).map((item) => item.total),
          backgroundColor: "#2f7d5a",
          borderRadius: 8,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
        },
      },
      plugins: { legend: { display: false } },
    },
  });

  tiempoChart = new window.Chart(tiempoCtx, {
    type: "line",
    data: {
      labels: (data.solicitudes_ultimos_7_dias || []).map((item) => formatDateOnly(item.fecha)),
      datasets: [
        {
          label: "Solicitudes",
          data: (data.solicitudes_ultimos_7_dias || []).map((item) => item.total),
          borderColor: "#1f6f50",
          backgroundColor: "rgba(47,125,90,0.15)",
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
        },
      },
    },
  });
}

function renderFilterSummary(filters, container, equipoSelect, formatDateOnly) {
  if (!container) {
    return;
  }

  const chips = [];
  if (filters.fechaDesde) {
    chips.push(`Desde: ${formatDateOnly(filters.fechaDesde)}`);
  }
  if (filters.fechaHasta) {
    chips.push(`Hasta: ${formatDateOnly(filters.fechaHasta)}`);
  }
  if (filters.equipoId) {
    const label =
      equipoSelect?.querySelector(`option[value="${filters.equipoId}"]`)?.textContent || "Equipo";
    chips.push(`Equipo: ${label}`);
  }

  container.innerHTML = chips.length
    ? chips.map((chip) => `<span class="mini-chip">${chip}</span>`).join("")
    : "<span class='mini-chip active'>Vista general activa</span>";
}

function setBusyState(isBusy, controls = []) {
  controls.forEach((control) => {
    if (!control) {
      return;
    }
    control.disabled = isBusy;
  });
}

function renderLoadingState(elements) {
  const {
    pendingEl,
    dispatchEl,
    visibleEl,
    alertsList,
    myActionsList,
    myActionsCount,
    enviosBody,
    lastUpdateEl,
  } = elements;

  pendingEl.textContent = "...";
  dispatchEl.textContent = "...";
  visibleEl.textContent = "...";
  alertsList.innerHTML = `
    <div class="alert-card loading-line"></div>
    <div class="alert-card loading-line"></div>
  `;
  if (myActionsList) {
    myActionsList.innerHTML = `
      <div class="my-action-card loading-line"></div>
      <div class="my-action-card loading-line"></div>
    `;
  }
  if (myActionsCount) {
    myActionsCount.textContent = "Cargando...";
  }
  enviosBody.innerHTML = "<tr><td colspan='8'>Cargando informacion...</td></tr>";
  lastUpdateEl.textContent = "Actualizando...";
}

async function downloadExcel(context, filters) {
  const query = buildQueryString(filters);
  const response = await fetch(`/api/reportes/excel/solicitudes${query}`, {
    headers: {
      Authorization: `Bearer ${context.state.token}`,
    },
  });

  if (!response.ok) {
    let message = "No se pudo exportar Excel";
    try {
      const errorPayload = await response.json();
      message = errorPayload.mensaje || errorPayload.error?.message || message;
    } catch {
      // Ignorar error de parseo.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const fileName =
    response.headers
      .get("content-disposition")
      ?.split("filename=")
      ?.at(1)
      ?.replaceAll('"', "") || "reporte_solicitudes.xlsx";

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function initDashboardView(context) {
  const chartReadyPromise = ensureChartJs().catch(() => null);
  const role = context.state.user.role || context.state.user.rol;
  const isOperationalRole = ["JEFE_FAENA", "MECANICO", "OPERADOR"].includes(role);
  const pendingEl = document.getElementById("metric-solicitudes-pendientes");
  const dispatchEl = document.getElementById("metric-despachos-pendientes");
  const visibleEl = document.getElementById("metric-dashboard-visible");
  const alertsList = document.getElementById("dashboard-alerts-list");
  const myActionsList = document.getElementById("dashboard-my-actions-list");
  const myActionsCount = document.getElementById("dashboard-my-actions-count");
  const solicitudesTitle = document.getElementById("metric-solicitudes-title");
  const solicitudesCaption = document.getElementById("metric-solicitudes-caption");
  const despachosTitle = document.getElementById("metric-despachos-title");
  const despachosCaption = document.getElementById("metric-despachos-caption");
  const enviosBody = document.getElementById("dashboard-envios-body");
  const filterForm = document.getElementById("dashboard-filter-form");
  const applyBtn = document.getElementById("dashboard-filter-btn");
  const clearBtn = document.getElementById("dashboard-clear-btn");
  const exportBtn = document.getElementById("dashboard-export-btn");
  const refreshBtn = document.getElementById("dashboard-refresh-btn");
  const equipoField = document.getElementById("dashboard-equipo-field");
  const equipoSelect = document.getElementById("dashboard-equipo-id");
  const lastUpdateEl = document.getElementById("dashboard-last-update");
  const filterSummaryEl = document.getElementById("dashboard-filter-summary");

  const controls = [applyBtn, clearBtn, exportBtn, refreshBtn, equipoSelect];
  let isLoading = false;
  let realtimeDashboardTimer = null;

  const filters = {
    fechaDesde: "",
    fechaHasta: "",
    equipoId: "",
  };

  if (isOperationalRole) {
    if (solicitudesTitle) {
      solicitudesTitle.textContent = "Solicitudes activas";
    }
    if (solicitudesCaption) {
      solicitudesCaption.textContent = "Pendientes y en gestion de tu equipo";
    }
    if (despachosTitle) {
      despachosTitle.textContent = "Confirmaciones por hacer";
    }
    if (despachosCaption) {
      despachosCaption.textContent = "Solicitudes en despacho listas para confirmar";
    }
  }

  async function loadEquiposIfNeeded() {
    if (!["ADMIN", "SUPERVISOR"].includes(role)) {
      equipoField.classList.add("hidden");
      return;
    }

    const payloadEquipos = await context.apiRequest("/api/equipos");
    const equipos = payloadEquipos.data || [];
    equipoSelect.innerHTML = [
      "<option value=''>Todos</option>",
      ...equipos.map((item) => `<option value='${item.id}'>${item.nombre_equipo}</option>`),
    ].join("");
  }

  async function loadDashboard(showToastMessage = "") {
    if (isLoading) {
      return;
    }

    isLoading = true;
    setBusyState(true, controls);
    renderLoadingState({
      pendingEl,
      dispatchEl,
      visibleEl,
      alertsList,
      myActionsList,
      myActionsCount,
      enviosBody,
      lastUpdateEl,
    });
    renderFilterSummary(filters, filterSummaryEl, equipoSelect, context.formatDateOnly);

    try {
      const query = buildQueryString(filters);
      const [dashboardPayload, notificationsPayload, myActionsPayload] = await Promise.all([
        context.apiRequest(`/api/dashboard${query}`),
        context.apiRequest("/api/notificaciones?soloNoLeidas=1&limit=8"),
        context.apiRequest("/api/dashboard/my-actions?limit=12"),
      ]);

      const data = dashboardPayload.data || {};
      const notifications = notificationsPayload.data || [];
      const myActions = myActionsPayload.data || [];
      const metricas = data.metricas || {};
      const visibleRows = data.solicitudes_enviadas || [];

      pendingEl.textContent = metricas.solicitudes_pendientes ?? 0;
      dispatchEl.textContent = metricas.despachos_pendientes ?? 0;
      visibleEl.textContent = visibleRows.length;
      lastUpdateEl.textContent = `Actualizado ${context.formatDate(new Date().toISOString())}`;

      if (await chartReadyPromise) {
        renderCharts(data, context.formatDateOnly);
      }
      renderSolicitudesTable(visibleRows, context.formatDate, enviosBody);
      renderAlertsList(notifications, context.formatDate, alertsList);
      renderMyActions(myActions, myActionsList, myActionsCount);
      renderFilterSummary(filters, filterSummaryEl, equipoSelect, context.formatDateOnly);

      if (showToastMessage) {
        context.showToast(showToastMessage);
      }
    } catch (error) {
      alertsList.innerHTML = "<div class='history-empty'>No se pudieron cargar las novedades.</div>";
      if (myActionsList) {
        myActionsList.innerHTML = "<div class='history-empty'>No se pudo cargar tu agenda.</div>";
      }
      enviosBody.innerHTML = "<tr><td colspan='8'>No se pudo cargar la informacion.</td></tr>";
      lastUpdateEl.textContent = "Error al actualizar";
      context.showToast(error.message, true);
    } finally {
      isLoading = false;
      setBusyState(false, controls);
    }
  }

  async function refreshDashboardFromRealtime(notification) {
    if (!pendingEl.isConnected) {
      return;
    }

    if (!notification || !String(notification.tipo || "").startsWith("SOLICITUD_")) {
      return;
    }

    if (realtimeDashboardTimer) {
      window.clearTimeout(realtimeDashboardTimer);
    }

    realtimeDashboardTimer = window.setTimeout(async () => {
      try {
        await loadDashboard();
      } catch {
        // Ignorar errores silenciosos del refresco en vivo.
      }
    }, 350);
  }

  applyBtn.addEventListener("click", async () => {
    const formData = new FormData(filterForm);
    filters.fechaDesde = String(formData.get("fechaDesde") || "");
    filters.fechaHasta = String(formData.get("fechaHasta") || "");
    filters.equipoId = String(formData.get("equipoId") || "");
    await loadDashboard("Filtros aplicados");
  });

  clearBtn.addEventListener("click", async () => {
    filterForm.reset();
    filters.fechaDesde = "";
    filters.fechaHasta = "";
    filters.equipoId = "";
    await loadDashboard("Filtros limpiados");
  });

  refreshBtn.addEventListener("click", async () => {
    await loadDashboard("Dashboard actualizado");
  });

  myActionsList?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-open-solicitud]");
    if (!card) {
      return;
    }
    openSolicitudFromDashboard(Number(card.dataset.openSolicitud));
  });

  exportBtn.addEventListener("click", async () => {
    try {
      await downloadExcel(context, filters);
      context.showToast("Excel exportado correctamente");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  if (window.__fmnDashboardRealtimeHandler) {
    window.removeEventListener("fmn:notification", window.__fmnDashboardRealtimeHandler);
  }
  window.__fmnDashboardRealtimeHandler = (event) => {
    refreshDashboardFromRealtime(event.detail);
  };
  window.addEventListener("fmn:notification", window.__fmnDashboardRealtimeHandler);

  await loadEquiposIfNeeded();
  await loadDashboard();
}

