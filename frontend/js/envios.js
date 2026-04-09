const ESTADOS_VISUALES = ["PREPARADO", "ENVIADO", "RECIBIDO"];
const ENVIO_LIST_CONFIG_KEY = "fmn_envios_list_config";
const ESTADO_LABELS = {
  PREPARADO: "Preparado",
  ENVIADO: "Enviado",
  RECIBIDO: "Recibido",
};

function renderEnvioStatusBadge(status) {
  const className = `status-badge status-${String(status || "").toLowerCase()}`;
  return `<span class="${className}">${ESTADO_LABELS[status] || status || "-"}</span>`;
}

function getTimelineClass(step, estadoActual) {
  const current = String(estadoActual || "PREPARADO").toUpperCase();
  if (step === "PREPARADO") {
    return "tracking-step done";
  }
  if (step === "ENVIADO" && (current === "ENVIADO" || current === "RECIBIDO")) {
    return "tracking-step done";
  }
  if (step === "RECIBIDO" && current === "RECIBIDO") {
    return "tracking-step done";
  }
  return "tracking-step";
}

function renderTimeline(estadoVisual) {
  return `
    <div class="tracking-mini">
      <span class="${getTimelineClass("PREPARADO", estadoVisual)}">Preparado</span>
      <span class="${getTimelineClass("ENVIADO", estadoVisual)}">Enviado</span>
      <span class="${getTimelineClass("RECIBIDO", estadoVisual)}">Recibido</span>
    </div>
  `;
}

function buildRepuestoLabel(item) {
  if (item.codigo && item.nombre) {
    return `${item.codigo} - ${item.nombre}`;
  }
  return item.nombre || "Repuesto";
}

function buildQueryString(filters, listConfig) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });

  params.set("limit", String(listConfig.limit));
  params.set("order", String(listConfig.order));

  return params.toString() ? `?${params.toString()}` : "";
}

function loadListConfig() {
  try {
    const raw = localStorage.getItem(ENVIO_LIST_CONFIG_KEY);
    if (!raw) {
      return {
        limit: 25,
        order: "desc",
        showComment: false,
        showSolicitante: false,
      };
    }

    const parsed = JSON.parse(raw);
    return {
      limit: Number(parsed.limit) || 25,
      order: parsed.order === "asc" ? "asc" : "desc",
      showComment: Boolean(parsed.showComment),
      showSolicitante: Boolean(parsed.showSolicitante),
    };
  } catch {
    return {
      limit: 25,
      order: "desc",
      showComment: false,
      showSolicitante: false,
    };
  }
}

function saveListConfig(config) {
  localStorage.setItem(ENVIO_LIST_CONFIG_KEY, JSON.stringify(config));
}

function renderTableHead(headEl, listConfig) {
  const optionalHeaders = [];
  if (listConfig.showSolicitante) {
    optionalHeaders.push("<th>Solicitado por</th>");
  }
  if (listConfig.showComment) {
    optionalHeaders.push("<th>Comentario</th>");
  }

  headEl.innerHTML = `
    <tr>
      <th>ID</th>
      <th>Repuesto</th>
      <th>Cantidad</th>
      <th>Equipo destino</th>
      <th>Estado visual</th>
      <th>Fecha envio</th>
      <th>Fecha recepcion</th>
      <th>Tracking</th>
      ${optionalHeaders.join("")}
      <th>Accion</th>
    </tr>
  `;
}

function renderRows(rows, options) {
  const { canManage, canConfirmReception, listConfig, bodyEl, formatDate } = options;

  if (!rows.length) {
    const extraCols = (listConfig.showSolicitante ? 1 : 0) + (listConfig.showComment ? 1 : 0);
    bodyEl.innerHTML = `<tr><td colspan='${9 + extraCols}'>Sin envios registrados</td></tr>`;
    return;
  }

  bodyEl.innerHTML = rows
    .map((row) => {
      const actions = [];
      if (canManage) {
        actions.push(
          `<button class='table-btn' data-action='track' data-id='${row.id}' type='button'>Abrir</button>`
        );
      }
      if (canConfirmReception && row.estado_visual !== "RECIBIDO") {
        actions.push(
          `<button class='table-btn secondary' data-action='confirm' data-id='${row.id}' type='button'>Confirmar recepcion</button>`
        );
      }

      const optionalCells = [];
      if (listConfig.showSolicitante) {
        optionalCells.push(`<td>${row.solicitado_por_nombre || "-"}</td>`);
      }
      if (listConfig.showComment) {
        optionalCells.push(`<td>${row.comentario || "-"}</td>`);
      }

      return `
        <tr>
          <td>${row.id}</td>
          <td>${row.repuesto_codigo || "-"} - ${row.repuesto_nombre || "-"}</td>
          <td>${row.cantidad}</td>
          <td>${row.equipo_destino || "-"}</td>
          <td>${renderEnvioStatusBadge(row.estado_visual)}</td>
          <td>${formatDate(row.fecha_envio)}</td>
          <td>${formatDate(row.fecha_recepcion)}</td>
          <td>${renderTimeline(row.estado_visual)}</td>
          ${optionalCells.join("")}
          <td>${actions.length ? `<div class='actions-inline'>${actions.join("")}</div>` : "Solo lectura"}</td>
        </tr>
      `;
    })
    .join("");
}

function openModal(modalEl) {
  modalEl.classList.remove("hidden");
}

function closeModal(modalEl) {
  modalEl.classList.add("hidden");
}

export async function initEnviosView(context) {
  const role = context.state.user.role || context.state.user.rol;
  const canManage = ["ADMIN", "SUPERVISOR"].includes(role);
  const canConfirmReception = ["ADMIN", "SUPERVISOR", "JEFE_FAENA"].includes(role);
  const hasGlobalVision = ["ADMIN", "SUPERVISOR"].includes(role);

  const refreshBtn = document.getElementById("envios-refresh-btn");
  const openCreateBtn = document.getElementById("envios-open-create-modal");
  const tableHead = document.getElementById("envios-table-head");
  const tableBody = document.getElementById("envios-table-body");
  const filterForm = document.getElementById("envios-filter-form");
  const filterApplyBtn = document.getElementById("envios-filter-apply");
  const filterClearBtn = document.getElementById("envios-filter-clear");
  const filterEquipoField = document.getElementById("envios-filter-equipo-field");
  const filterEquipoSelect = document.getElementById("envios-filter-equipo");
  const configForm = document.getElementById("envios-config-form");
  const configApplyBtn = document.getElementById("envios-config-apply");
  const configLimit = document.getElementById("envios-config-limit");
  const configOrder = document.getElementById("envios-config-order");
  const configShowComment = document.getElementById("envios-config-show-comment");
  const configShowSolicitante = document.getElementById("envios-config-show-solicitante");
  const createModal = document.getElementById("envios-create-modal");
  const createForm = document.getElementById("envios-create-form");
  const createCloseBtn = document.getElementById("envios-create-close");
  const createCancelBtn = document.getElementById("envios-create-cancel");
  const repuestoSelect = document.getElementById("envio-repuesto-id");
  const equipoSelect = document.getElementById("envio-equipo-id");
  const trackModal = document.getElementById("envios-track-modal");
  const trackForm = document.getElementById("envios-track-form");
  const trackId = document.getElementById("envios-track-id");
  const trackStatus = document.getElementById("envios-track-status");
  const trackComment = document.getElementById("envios-track-comment");
  const trackCloseBtn = document.getElementById("envios-track-close");
  const trackCancelBtn = document.getElementById("envios-track-cancel");

  const filters = {
    q: "",
    estado_visual: "",
    fechaDesde: "",
    fechaHasta: "",
    equipoId: "",
  };

  const listConfig = loadListConfig();
  configLimit.value = String(listConfig.limit);
  configOrder.value = String(listConfig.order);
  configShowComment.checked = Boolean(listConfig.showComment);
  configShowSolicitante.checked = Boolean(listConfig.showSolicitante);

  let enviosCache = [];

  if (!canManage) {
    openCreateBtn.classList.add("hidden");
  }

  async function loadEquiposFilter() {
    if (!hasGlobalVision) {
      filterEquipoField.classList.add("hidden");
      return;
    }

    const payload = await context.apiRequest("/api/equipos");
    const equipos = payload.data || [];
    filterEquipoSelect.innerHTML = [
      "<option value=''>Todos</option>",
      ...equipos.map((item) => `<option value='${item.id}'>${item.nombre_equipo}</option>`),
    ].join("");
  }

  async function loadCombosForCreate() {
    if (!canManage) {
      return;
    }

    const payload = await context.apiRequest("/api/envios/opciones");
    const repuestos = payload.data?.repuestos || [];
    const equipos = payload.data?.equipos || [];

    repuestoSelect.innerHTML = repuestos.length
      ? repuestos.map((item) => `<option value='${item.id}'>${buildRepuestoLabel(item)}</option>`).join("")
      : "<option value=''>Sin repuestos disponibles</option>";

    equipoSelect.innerHTML = equipos.length
      ? equipos.map((item) => `<option value='${item.id}'>${item.nombre_equipo}</option>`).join("")
      : "<option value=''>Sin equipos disponibles</option>";
  }

  function renderCurrentTable() {
    renderTableHead(tableHead, listConfig);
    renderRows(enviosCache, {
      canManage,
      canConfirmReception,
      listConfig,
      bodyEl: tableBody,
      formatDate: context.formatDate,
    });
  }

  async function loadEnvios() {
    const query = buildQueryString(filters, listConfig);
    const payload = await context.apiRequest(`/api/envios${query}`);
    enviosCache = payload.data || [];
    renderCurrentTable();
  }

  if (canManage) {
    openCreateBtn.addEventListener("click", () => {
      openModal(createModal);
    });

    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(createForm);

      const payload = {
        repuesto_id: Number(formData.get("repuesto_id")),
        cantidad: Number(formData.get("cantidad")),
        equipo_destino_id: Number(formData.get("equipo_destino_id")),
        comentario: String(formData.get("comentario") || ""),
        estado_visual: String(formData.get("estado_visual") || "PREPARADO"),
      };

      const confirmed = window.confirm(
        `Confirmar envio de ${payload.cantidad} unidades al equipo seleccionado?`
      );
      if (!confirmed) {
        return;
      }

      try {
        await context.apiRequest("/api/envios", {
          method: "POST",
          body: payload,
        });
        createForm.reset();
        closeModal(createModal);
        await loadEnvios();
        await loadCombosForCreate();
        context.showToast("Envio registrado correctamente");
      } catch (error) {
        context.showToast(error.message, true);
      }
    });

    trackForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const envioId = Number(trackId.value);
      if (!envioId) {
        return;
      }

      try {
        await context.apiRequest(`/api/envios/${envioId}`, {
          method: "PUT",
          body: {
            estado_visual: trackStatus.value,
            comentario: String(trackComment.value || ""),
          },
        });
        closeModal(trackModal);
        await loadEnvios();
        context.showToast("Tracking actualizado");
      } catch (error) {
        context.showToast(error.message, true);
      }
    });
  }

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const envioId = Number(button.dataset.id);
    const envio = enviosCache.find((item) => Number(item.id) === envioId);
    if (!envio) {
      return;
    }

    if (button.dataset.action === "track") {
      if (!canManage) {
        return;
      }

      trackId.value = String(envio.id);
      trackStatus.value = ESTADOS_VISUALES.includes(envio.estado_visual)
        ? envio.estado_visual
        : "PREPARADO";
      trackComment.value = envio.comentario || "";
      openModal(trackModal);
      return;
    }

    if (button.dataset.action === "confirm") {
      if (!canConfirmReception) {
        return;
      }

      const confirmed = window.confirm(`Confirmar recepcion del envio #${envio.id}?`);
      if (!confirmed) {
        return;
      }

      try {
        await context.apiRequest(`/api/envios/${envio.id}/confirmar-recepcion`, {
          method: "PUT",
          body: {
            comentario: "Recepcion confirmada en faena",
          },
        });
        await loadEnvios();
        context.showToast("Recepcion confirmada");
      } catch (error) {
        context.showToast(error.message, true);
      }
    }
  });

  filterApplyBtn.addEventListener("click", async () => {
    const formData = new FormData(filterForm);
    filters.q = String(formData.get("q") || "").trim();
    filters.estado_visual = String(formData.get("estado_visual") || "");
    filters.fechaDesde = String(formData.get("fechaDesde") || "");
    filters.fechaHasta = String(formData.get("fechaHasta") || "");
    filters.equipoId = String(formData.get("equipoId") || "");

    try {
      await loadEnvios();
      context.showToast("Filtros aplicados");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  filterClearBtn.addEventListener("click", async () => {
    filterForm.reset();
    filters.q = "";
    filters.estado_visual = "";
    filters.fechaDesde = "";
    filters.fechaHasta = "";
    filters.equipoId = "";

    try {
      await loadEnvios();
      context.showToast("Filtros limpiados");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  configApplyBtn.addEventListener("click", async () => {
    const formData = new FormData(configForm);
    listConfig.limit = Number(formData.get("limit") || 25);
    listConfig.order = String(formData.get("order") || "desc");
    listConfig.showComment = formData.get("showComment") === "on";
    listConfig.showSolicitante = formData.get("showSolicitante") === "on";
    saveListConfig(listConfig);

    try {
      await loadEnvios();
      context.showToast("Configuracion guardada");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  for (const [modal, closeBtn, cancelBtn] of [
    [createModal, createCloseBtn, createCancelBtn],
    [trackModal, trackCloseBtn, trackCancelBtn],
  ]) {
    modal.addEventListener("click", (event) => {
      if (event.target.matches(".modal-backdrop") || event.target.dataset.close === "true") {
        closeModal(modal);
      }
    });

    closeBtn.addEventListener("click", () => closeModal(modal));
    cancelBtn.addEventListener("click", () => closeModal(modal));
  }

  refreshBtn.addEventListener("click", async () => {
    try {
      await loadEnvios();
      context.showToast("Tracking recargado");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  await loadEquiposFilter();
  await loadEnvios();
  await loadCombosForCreate();
}

