// ── Contador animado para quick strip ────────────────────────────────────────
function animateCount(el, target) {
  const from = parseInt(el.textContent) || 0;
  if (from === target) return;
  const dur = 500;
  const t0 = performance.now();
  el.classList.remove("counting");
  void el.offsetWidth;
  el.classList.add("counting");
  function tick(now) {
    const p = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + (target - from) * ease));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const STATUS_LABELS = {
  PENDIENTE: "Pendiente",
  EN_REVISION: "En gestion",
  APROBADO: "Aprobada",
  EN_DESPACHO: "En despacho",
  ENTREGADO: "Entregada",
  RECHAZADO: "Rechazada",
};

const STATUS_OPTIONS = [
  { key: "PENDIENTE", label: "Pendiente", hint: "Recien creada o en espera" },
  { key: "EN_REVISION", label: "En gestion", hint: "Se encuentra en gestion" },
  { key: "APROBADO", label: "Aprobada", hint: "Lista para gestion" },
  { key: "EN_DESPACHO", label: "En despacho", hint: "Va en camino" },
  { key: "ENTREGADO", label: "Entregada", hint: "Recibida por el equipo" },
  { key: "RECHAZADO", label: "Rechazada", hint: "No sigue adelante" },
];

const ITEM_STATUS_LABELS = {
  POR_GESTIONAR: "Por gestionar",
  GESTIONADO: "Gestionado",
  ENVIADO: "Enviado",
  ENTREGADO: "Entregado",
};

const ITEM_STATUS_OPTIONS = [
  { key: "POR_GESTIONAR", label: "Por gestionar", hint: "Aun no se toma el item" },
  { key: "GESTIONADO", label: "Gestionado", hint: "Ya esta siendo trabajado" },
  { key: "ENVIADO", label: "Enviado", hint: "Salio hacia faena" },
  { key: "ENTREGADO", label: "Entregado", hint: "Producto recibido" },
];

const ROLE_ACTIONS = {
  ADMIN: {
    pill: "Administracion",
    title: "Solicitudes por revisar",
    text: "Revisa solicitudes activas, actualiza estados y mantiene el seguimiento del proceso.",
    primary: { label: "Ver pendientes", action: "FILTER_PENDING" },
    secondary: { label: "Ver en despacho", action: "FILTER_DISPATCH" },
  },
  SUPERVISOR: {
    pill: "Supervision",
    title: "Gestion diaria",
    text: "Prioriza pendientes y solicitudes en despacho para mantener continuidad operativa.",
    primary: { label: "Ver pendientes", action: "FILTER_PENDING" },
    secondary: { label: "Ver en despacho", action: "FILTER_DISPATCH" },
  },
  JEFE_FAENA: {
    pill: "Jefatura",
    title: "Seguimiento del equipo",
    text: "Revisa solicitudes de tu equipo, deja observaciones y confirma recepcion cuando corresponda.",
    primary: { label: "Nueva solicitud", action: "OPEN_CREATE" },
    secondary: { label: "Ver en despacho", action: "FILTER_DISPATCH" },
  },
  MECANICO: {
    pill: "Mecanico",
    title: "Solicitudes del taller",
    text: "Registra pedidos, revisa el estado del encargo y confirma recepcion cuando corresponda.",
    primary: { label: "Nueva solicitud", action: "OPEN_CREATE" },
    secondary: { label: "Ver pendientes", action: "FILTER_PENDING" },
  },
  OPERADOR: {
    pill: "Operador",
    title: "Solicitudes del equipo",
    text: "Registra pedidos y consulta el estado de cada solicitud cuando lo necesites.",
    primary: { label: "Nueva solicitud", action: "OPEN_CREATE" },
    secondary: { label: "Ver pendientes", action: "FILTER_PENDING" },
  },
};

function buildQueryString(paramsObject) {
  const searchParams = new URLSearchParams();
  Object.entries(paramsObject).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  return searchParams.toString() ? `?${searchParams.toString()}` : "";
}

function normalizeSearchValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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

function getItemStatusLabel(status) {
  return ITEM_STATUS_LABELS[status] || status || "-";
}

function getItemStatusClass(status) {
  const normalized = String(status || "").toLowerCase().replaceAll("_", "-");
  return `status-badge item-status-badge item-status-${normalized}`;
}

function renderItemStatusBadge(status) {
  return `<span class="${getItemStatusClass(status)}">${getItemStatusLabel(status)}</span>`;
}

function renderSolicitudStepper(status) {
  return `
    <div class="status-overview-grid">
      ${STATUS_OPTIONS.map((option) => {
        const className = option.key === status ? "status-node current" : "status-node";
        return `
          <article class="${className}">
            <strong>${option.label}</strong>
            <span>${option.hint}</span>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderStatusActions(currentStatus, canManage) {
  if (!canManage) {
    return "";
  }

  return STATUS_OPTIONS.map((option) => {
    const className =
      option.key === currentStatus ? "status-action-btn active" : "status-action-btn";
    return `
      <button
        class="${className}"
        data-status-value="${option.key}"
        type="button"
      >
        <strong>${option.label}</strong>
        <span>${option.hint}</span>
      </button>
    `;
  }).join("");
}

function formatHistoryActionLabel(action) {
  const value = String(action || "EVENTO").trim();
  const map = {
    SOLICITUD_CREADA: "Solicitud creada",
    SOLICITUD_ACTUALIZADA: "Solicitud actualizada",
    SOLICITUD_ELIMINADA: "Solicitud eliminada",
    ESTADO_AUTO_POR_PRODUCTOS: "Estado ajustado por productos",
    COMENTARIO_PROCESO: "Comentario de proceso",
    ITEM_CREADO: "Producto agregado",
    ITEM_ACTUALIZADO: "Producto actualizado",
    ITEM_ELIMINADO: "Producto eliminado",
    ESTADO_ITEM_REVERTIDO: "Producto revertido",
    MENSAJE_ENVIADO: "Mensaje enviado",
  };

  if (map[value]) {
    return map[value];
  }

  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderHistory(historial = [], formatDate) {
  if (!historial.length) {
    return "<div class='history-empty'>Sin historial registrado.</div>";
  }

  return historial
    .map(
      (item) => `
        <article class="history-item">
          <div class="history-marker"></div>
          <div class="history-content">
            <div class="history-headline">
              <strong>${formatHistoryActionLabel(item.accion)}</strong>
              <span class="mini-chip">${formatDate(item.created_at)}</span>
            </div>
            <p>${item.detalle || "Sin detalle"}</p>
            <span>${item.actor_name || "Sistema"}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function summarizeItemStatuses(items = []) {
  const summary = {
    total: items.length,
    porGestionar: 0,
    gestionados: 0,
    enviados: 0,
    entregados: 0,
  };

  items.forEach((item) => {
    const status = String(item.estado_item || "POR_GESTIONAR");
    if (status === "POR_GESTIONAR") {
      summary.porGestionar += 1;
    }
    if (status === "GESTIONADO") {
      summary.gestionados += 1;
    }
    if (status === "ENVIADO") {
      summary.enviados += 1;
    }
    if (status === "ENTREGADO") {
      summary.entregados += 1;
    }
  });

  return summary;
}

function renderProgressSummary(items = []) {
  const summary = summarizeItemStatuses(items);
  const total = summary.total || 1;
  const pct = Math.round((summary.entregados / total) * 100);
  return `
    <div class="progress-bar-wrap">
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width: ${pct}%"></div>
      </div>
      <span class="progress-bar-label">${summary.entregados} de ${summary.total} entregado${summary.entregados !== 1 ? "s" : ""}</span>
    </div>
    <div class="progress-summary-card">
      <span class="progress-summary-label">Productos</span>
      <strong>${summary.total}</strong>
    </div>
    <div class="progress-summary-card">
      <span class="progress-summary-label">Por gestionar</span>
      <strong>${summary.porGestionar}</strong>
    </div>
    <div class="progress-summary-card">
      <span class="progress-summary-label">Enviados</span>
      <strong>${summary.enviados}</strong>
    </div>
    <div class="progress-summary-card">
      <span class="progress-summary-label">Entregados</span>
      <strong>${summary.entregados}</strong>
    </div>
  `;
}

function renderDeliveryAssistant(solicitud, options = {}) {
  const summary = summarizeItemStatuses(solicitud?.items || []);
  const total = Number(summary.total || 0);
  if (!total) {
    return "";
  }

  const canManage = options.canManage === true;
  const canConfirm = options.canConfirm === true;
  const allDelivered = summary.entregados === total;
  const allShipped = summary.enviados + summary.entregados === total;
  const pendingDispatch = Math.max(total - (summary.enviados + summary.entregados), 0);
  const pendingDelivery = Math.max(total - summary.entregados, 0);

  let title = "Seguimiento de entrega";
  let text =
    "Puedes revisar cada producto por separado o aplicar una accion completa sobre toda la solicitud.";

  if (allDelivered) {
    title = "Solicitud completa";
    text = "Todos los productos ya estan entregados y la solicitud queda cerrada.";
  } else if (allShipped) {
    title = "Solicitud lista para cierre";
    text = `Todos los productos ya estan enviados. Quedan ${pendingDelivery} por recepcionar. Puedes entregarlos uno a uno o cerrar toda la solicitud.`;
  } else if (pendingDispatch > 0 || pendingDelivery > 0) {
    text = `Aun faltan ${pendingDispatch} producto(s) por despachar y ${pendingDelivery} por entregar. Puedes seguir uno a uno desde cada producto o usar una accion masiva.`;
  }

  const actions = [];
  if (canManage && !allDelivered) {
    if (!allShipped) {
      actions.push(`
        <button class="action-btn secondary" data-bulk-status="EN_DESPACHO" type="button">
          Despachar todo (${pendingDispatch} ${pendingDispatch === 1 ? "producto" : "productos"})
        </button>
      `);
    }
    actions.push(`
      <button class="action-btn" data-bulk-status="ENTREGADO" type="button">
        Entregar todo (${pendingDelivery} ${pendingDelivery === 1 ? "producto" : "productos"})
      </button>
    `);
  }

  if (!canManage && canConfirm && !allDelivered) {
    text =
      "Puedes confirmar toda la recepcion de una vez o revisar el detalle de cada producto antes de cerrar.";
  }

  const itemsHint = !allDelivered
    ? `<p class="muted-text delivery-hint">Para gestionar uno a uno, ve a la pestana <button class="inline-tab-link" data-switch-tab="items" type="button">Productos</button>.</p>`
    : "";

  return `
    <div class="delivery-assistant-copy">
      <h5>${title}</h5>
      <p class="muted-text">${text}</p>
    </div>
    ${actions.length ? `<div class="actions-inline wrap-actions">${actions.join("")}</div>` : ""}
    ${itemsHint}
  `;
}

function buildBulkStatusWarning(solicitud, targetStatus) {
  const summary = summarizeItemStatuses(solicitud?.items || []);
  if (!summary.total) {
    return "";
  }

  if (targetStatus === "EN_DESPACHO") {
    const remaining = Math.max(summary.total - (summary.enviados + summary.entregados), 0);
    if (remaining > 0) {
      return `Esta accion marcara ${remaining} producto(s) pendiente(s) como enviados. Deseas continuar?`;
    }
  }

  if (targetStatus === "ENTREGADO") {
    const remaining = Math.max(summary.total - summary.entregados, 0);
    if (remaining > 0) {
      return `Esta accion marcara ${remaining} producto(s) pendiente(s) como entregados y cerrara toda la solicitud. Deseas continuar?`;
    }
  }

  return "";
}

function getSolicitudPrimaryAction(item, role) {
  const status = String(item.estado || "");
  const isManager = ["ADMIN", "SUPERVISOR"].includes(role);
  const canConfirm = ["JEFE_FAENA", "MECANICO", "OPERADOR"].includes(role) && status === "EN_DESPACHO";

  if (isManager) {
    return {
      label: status === "EN_DESPACHO" ? "Gestionar despacho" : "Gestionar",
      hint: status === "PENDIENTE" ? "Revisar y decidir" : "Abrir seguimiento completo",
      emphasis: status === "PENDIENTE",
    };
  }

  if (canConfirm) {
    return {
      label: "Confirmar recepcion",
      hint: "Cierra la solicitud cuando el pedido llegue",
      emphasis: true,
    };
  }

  return {
    label: status === "ENTREGADO" ? "Ver detalle" : "Ver estado",
    hint: status === "PENDIENTE" ? "Todavia esta en espera" : "Revisa su avance completo",
    emphasis: false,
  };
}

function renderItemStatusSnapshot(item) {
  if (item.item_status_text) {
    return item.item_status_text;
  }

  const summary = item.item_status_summary;
  if (!summary) {
    return "";
  }

  const parts = [];
  if (summary.por_gestionar) {
    parts.push(`${summary.por_gestionar} por gestionar`);
  }
  if (summary.gestionados) {
    parts.push(`${summary.gestionados} gestionado(s)`);
  }
  if (summary.enviados) {
    parts.push(`${summary.enviados} enviado(s)`);
  }
  if (summary.entregados) {
    parts.push(`${summary.entregados} entregado(s)`);
  }
  return parts.join(" | ");
}

function renderMessages(messages = [], options = {}) {
  const { formatDate, canRemoveImage, currentUserId } = options;

  if (!messages.length) {
    return "<div class='history-empty'>Todavia no hay mensajes en esta solicitud.</div>";
  }

  return messages
    .map((message) => {
      const destinatario = message.destinatario_nombre
        ? `<div class="chat-target">Para: ${message.destinatario_nombre}</div>`
        : "";

      const imageActions =
        message.imagen_data && (canRemoveImage || Number(message.remitente_id) === Number(currentUserId))
          ? `<button
               class="chat-remove-image-btn"
               data-message-id="${message.id}"
               type="button"
             >
               Quitar imagen
             </button>`
          : "";

      const imagen = message.imagen_data
        ? `<div class="chat-image-block">
             <a href="${message.imagen_data}" target="_blank" rel="noreferrer">
               <img src="${message.imagen_data}" alt="${message.imagen_nombre || "Adjunto"}" class="chat-image" />
             </a>
             ${imageActions}
           </div>`
        : "";

      const isMine = Number(message.remitente_id) === Number(currentUserId);
      return `
        <article class="chat-item ${isMine ? "chat-mine" : "chat-theirs"}">
          <div class="chat-header">
            <strong>${message.remitente_nombre || "Usuario"}</strong>
            <span>${formatDate(message.created_at)}</span>
          </div>
          ${destinatario}
          ${message.mensaje ? `<p>${message.mensaje}</p>` : ""}
          ${imagen}
        </article>
      `;
    })
    .join("");
}

function renderSummary(rows) {
  const summary = {
    pendientes: 0,
    revision: 0,
    despacho: 0,
    entregadas: 0,
  };

  for (const row of rows) {
    if (row.estado === "PENDIENTE") {
      summary.pendientes += 1;
    }
    if (row.estado === "EN_REVISION" || row.estado === "APROBADO") {
      summary.revision += 1;
    }
    if (row.estado === "EN_DESPACHO") {
      summary.despacho += 1;
    }
    if (row.estado === "ENTREGADO") {
      summary.entregadas += 1;
    }
  }

  animateCount(document.getElementById("summary-total"), rows.length);
  animateCount(document.getElementById("summary-pendientes"), summary.pendientes);
  animateCount(document.getElementById("summary-revision"), summary.revision);
  animateCount(document.getElementById("summary-despacho"), summary.despacho);
  animateCount(document.getElementById("summary-entregadas"), summary.entregadas);

  const activeCount = summary.pendientes + summary.revision + summary.despacho;
  document.title = activeCount > 0
    ? `(${activeCount}) Solicitudes — Portal FMN`
    : "Solicitudes — Portal FMN";
}

function renderStatusSnapshot(item, formatDate) {
  if (item.estado === "ENTREGADO" && item.received_at) {
    return `Confirmada ${formatDate(item.received_at)}`;
  }
  if (item.estado === "EN_DESPACHO" && item.dispatched_at) {
    return `Despachada ${formatDate(item.dispatched_at)}`;
  }
  if ((item.estado === "EN_REVISION" || item.estado === "APROBADO" || item.estado === "RECHAZADO") && item.reviewed_at) {
    return `Revisada ${formatDate(item.reviewed_at)}`;
  }
  return `Creada ${formatDate(item.created_at)}`;
}

function renderRows(rows, tableBody, mobileList, formatDate, role) {
  if (!rows.length) {
    tableBody.innerHTML = "<tr><td colspan='7'>Sin solicitudes registradas</td></tr>";
    mobileList.innerHTML = "<div class='history-empty'>Sin solicitudes registradas</div>";
    return;
  }

  tableBody.innerHTML = rows
    .map(
      (item, i) => {
        const primaryAction = getSolicitudPrimaryAction(item, role);
        const itemStatusSnapshot = renderItemStatusSnapshot(item);
        const solicitante = item.solicitante_name || item.solicitante_nombre || item.solicitante || "-";
        const rowDelay = Math.min(i * 0.03, 0.28);
        return `
        <tr style="animation-delay:${rowDelay}s">
          <td>${item.id}</td>
          <td>
            <strong>${item.nombre_equipo || item.equipo || "-"}</strong>
            <div class="table-subline">Solicita: ${solicitante}</div>
          </td>
          <td>
            <strong>${item.resumen_items || item.repuesto || "-"}</strong>
            <div class="table-subline">${item.total_items || 1} producto(s) - ${
              item.total_unidades || item.cantidad || 0
            } unidades</div>
            ${itemStatusSnapshot ? `<div class="table-subline item-flow-inline">${itemStatusSnapshot}</div>` : ""}
          </td>
          <td>${renderStatusBadge(item.estado)}</td>
          <td>
            <span class="table-subline">${renderStatusSnapshot(item, formatDate)}</span>
            <div class="table-subline strong-subline">${primaryAction.hint}</div>
          </td>
          <td>${formatDate(item.created_at)}</td>
          <td>
            <button class="table-btn ${primaryAction.emphasis ? "table-btn-emphasis" : ""}" data-action="open" data-id="${item.id}" type="button">
              ${primaryAction.label}
            </button>
            <button class="table-btn-state" data-action="open-state" data-id="${item.id}" type="button">
              Ver estado
            </button>
          </td>
        </tr>
      `;
      }
    )
    .join("");

  mobileList.innerHTML = rows
    .map((item, i) => {
      const primaryAction = getSolicitudPrimaryAction(item, role);
      const itemStatusSnapshot = renderItemStatusSnapshot(item);
      const solicitante = item.solicitante_name || item.solicitante_nombre || item.solicitante || "-";
      const cardDelay = Math.min(i * 0.04, 0.32);
      return `
        <article class="solicitud-mobile-card" style="animation-delay:${cardDelay}s" data-status="${item.estado}">
          <div class="solicitud-mobile-top">
            <div>
              <strong>Solicitud #${item.id}</strong>
              <div class="table-subline">${item.nombre_equipo || item.equipo || "-"}</div>
              <div class="table-subline">Solicita: ${solicitante}</div>
            </div>
            ${renderStatusBadge(item.estado)}
          </div>
          <p class="solicitud-mobile-summary">${item.resumen_items || item.repuesto || "-"}</p>
          <div class="solicitud-mobile-meta">
            <span>${item.total_items || 1} producto(s)</span>
            <span>${item.total_unidades || item.cantidad || 0} unidades</span>
            <span>${renderStatusSnapshot(item, formatDate)}</span>
          </div>
          ${itemStatusSnapshot ? `<div class="solicitud-mobile-flow">${itemStatusSnapshot}</div>` : ""}
          <div class="solicitud-mobile-next-step">${primaryAction.hint}</div>
          <button class="action-btn solicitud-mobile-open ${primaryAction.emphasis ? "cta-emphasis" : ""}" data-action="open" data-id="${item.id}" type="button">
            ${primaryAction.label}
          </button>
        </article>
      `;
    })
    .join("");
}

function buildCreateItemRow(item = {}, options = {}) {
  const { editable = true } = options;
  return `
    <div class="item-row">
      <div class="form-grid cols-3 compact-grid">
        <div>
          <label>Producto</label>
          <input class="solicitud-item-name" value="${item.nombre_item || ""}" ${
            editable ? "" : "disabled"
          } autocomplete="off" spellcheck="false" />
        </div>
        <div>
          <label>Numero de parte</label>
          <input class="solicitud-item-code" value="${item.codigo_referencia || item.codigo || ""}" ${
            editable ? "" : "disabled"
          } autocomplete="off" spellcheck="false" />
        </div>
        <div>
          <label>Cantidad</label>
          <input class="solicitud-item-qty" type="number" min="1" value="${item.cantidad || 1}" ${
            editable ? "" : "disabled"
          } autocomplete="off" />
        </div>
        <div>
          <label>Unidad / talla</label>
          <input class="solicitud-item-unit" value="${item.unidad_medida || ""}" ${
            editable ? "" : "disabled"
          } autocomplete="off" spellcheck="false" />
        </div>
        <div>
          <label>Usuario final</label>
          <input class="solicitud-item-final-user" value="${item.usuario_final || ""}" ${
            editable ? "" : "disabled"
          } autocomplete="off" spellcheck="false" />
        </div>
        <div class="full">
          <label>Detalle</label>
          <input class="solicitud-item-detail" value="${item.detalle || item.comentario || ""}" ${
            editable ? "" : "disabled"
          } autocomplete="off" spellcheck="false" />
        </div>
      </div>
      ${
        editable
          ? `<div class="item-row-actions">
               <button class="table-btn secondary solicitud-remove-item-btn" type="button">
                 Quitar
               </button>
             </div>`
          : ""
      }
    </div>
  `;
}

function buildDetailItemRow(item = {}, options = {}) {
  const {
    editableBase = false,
    canManageItem = false,
    formatDate = (value) => value || "-",
    solicitante = "-",
  } = options;
  const canConfigure = editableBase || canManageItem;
  const summaryLine = [
    `${item.cantidad || 1} - ${item.unidad_medida || "Sin unidad o talla"}`,
    `Numero de parte: ${item.codigo_referencia || "Sin numero de parte"}`,
    `Detalle: ${item.detalle || item.comentario || "Sin detalle"}`,
    `Usuario final: ${item.usuario_final || "Sin usuario final"}`,
  ].join(" | ");
  const gestion = item.comentario_gestion
    ? `<div class="table-subline">Comentario de gestion: ${item.comentario_gestion}</div>`
    : "";
  const encargado = item.encargado_nombre
    ? `<div class="table-subline">Encargado: ${item.encargado_nombre}</div>`
    : `<div class="table-subline">Encargado: Sin asignar</div>`;
  const enviadoPor = item.enviado_por_nombre
    ? `<div class="table-subline">Enviado por: ${item.enviado_por_nombre}</div>`
    : `<div class="table-subline">Enviado por: Sin registrar</div>`;
  const recepcionadoPor = item.recepcionado_por_nombre
    ? `<div class="table-subline">Recepcionado por: ${item.recepcionado_por_nombre}</div>`
    : `<div class="table-subline">Recepcionado por: Sin registrar</div>`;
  const solicitanteNombre =
    item.solicitante_name || item.solicitante_nombre || item.solicitante || solicitante || "-";

  return `
    <article class="item-row item-tracking-card" data-item-id="${item.id || ""}">
      <div class="item-tracking-head">
        <div class="item-tracking-title">
          <strong>${item.nombre_item || "Nuevo producto"}</strong>
          <div class="table-subline">${summaryLine}</div>
          <div class="table-subline">Solicitado por: ${solicitanteNombre}</div>
          <div class="item-status-preview">${renderItemStatusBadge(item.estado_item || "POR_GESTIONAR")}</div>
          ${encargado}
          ${enviadoPor}
          ${recepcionadoPor}
          ${gestion}
        </div>
        ${
          canConfigure
            ? `<button class="table-btn solicitud-configure-item-btn" type="button">Configurar producto</button>`
            : ""
        }
      </div>

      <div class="item-row-actions">
        ${
          item.updated_at
            ? `<span class="item-tracking-meta">Actualizado: ${formatDate(item.updated_at)}</span>`
            : ""
        }
      </div>
    </article>
  `;
}

function openModal(modalEl) {
  modalEl.classList.remove("hidden");
}

function closeModal(modalEl) {
  modalEl.classList.add("hidden");
}

function closeOnBackdrop(modalEl) {
  modalEl.addEventListener("click", (event) => {
    if (event.target.matches(".modal-backdrop") || event.target.dataset.close === "true") {
      closeModal(modalEl);
    }
  });
}

function parseItemsFromContainer(container) {
  const rows = [...container.querySelectorAll(".item-row")];
  if (!rows.length) {
    return [{ nombre_item: "Producto sin nombre", cantidad: 1 }];
  }

  return rows.map((row) => {
    const nombreItem = row.querySelector(".solicitud-item-name")?.value?.trim() || "";
    const codigoReferencia = row.querySelector(".solicitud-item-code")?.value?.trim() || "";
    const cantidadRaw = Number(row.querySelector(".solicitud-item-qty")?.value || 0);
    const cantidad = Number.isInteger(cantidadRaw) && cantidadRaw > 0 ? cantidadRaw : 1;
    const unidadMedida = row.querySelector(".solicitud-item-unit")?.value?.trim() || "";
    const usuarioFinal = row.querySelector(".solicitud-item-final-user")?.value?.trim() || "";
    const comentario = row.querySelector(".solicitud-item-detail")?.value?.trim() || "";
    const estadoItem = row.querySelector(".solicitud-item-status")?.value || undefined;
    const comentarioGestion =
      row.querySelector(".solicitud-item-management-comment")?.value?.trim() || undefined;
    const encargadoIdRaw = row.querySelector(".solicitud-item-owner")?.value;

    return {
      nombre_item: nombreItem || "Producto sin nombre",
      cantidad,
      ...(unidadMedida ? { unidad_medida: unidadMedida } : {}),
      ...(codigoReferencia ? { codigo_referencia: codigoReferencia } : {}),
      ...(usuarioFinal ? { usuario_final: usuarioFinal } : {}),
      ...(comentario ? { comentario } : {}),
      ...(estadoItem ? { estado_item: estadoItem } : {}),
      ...(comentarioGestion ? { comentario_gestion: comentarioGestion } : {}),
      ...(encargadoIdRaw ? { encargado_id: Number(encargadoIdRaw) } : {}),
    };
  });
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

async function optimizeImageFile(file) {
  const sourceDataUrl = await readImageAsDataUrl(file);
  const TARGET_IMAGE_LIMIT = 650_000;

  if (!file.type.startsWith("image/")) {
    throw new Error("Solo se permiten imagenes");
  }

  if (sourceDataUrl.length <= TARGET_IMAGE_LIMIT) {
    return {
      dataUrl: sourceDataUrl,
      fileName: file.name,
    };
  }

  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("No se pudo procesar la imagen"));
    element.src = sourceDataUrl;
  });

  let width = image.width;
  let height = image.height;
  const maxSide = 1280;

  if (Math.max(width, height) > maxSide) {
    const scale = maxSide / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo preparar la imagen");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  let quality = 0.82;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);

  while (dataUrl.length > TARGET_IMAGE_LIMIT && quality > 0.35) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }

  if (dataUrl.length > TARGET_IMAGE_LIMIT) {
    throw new Error("La imagen sigue siendo muy grande. Prueba con una captura o foto mas liviana.");
  }

  const safeName = file.name.replace(/\.[^.]+$/, "") || "imagen";
  return {
    dataUrl,
    fileName: `${safeName}.jpg`,
  };
}

async function downloadSolicitudesExcel(context, filters) {
  const query = buildQueryString(filters);
  const response = await fetch(`/api/reportes/excel/solicitudes${query}`, {
    headers: {
      Authorization: `Bearer ${context.state.token}`,
    },
  });

  if (!response.ok) {
    let message = "No se pudo exportar Excel";
    try {
      const payload = await response.json();
      message = payload.mensaje || payload.error?.message || message;
    } catch {
      // Ignorar parseo.
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

export async function initSolicitudesView(context) {
  const role = context.state.user.role || context.state.user.rol;
  const currentUserId = context.state.user.id;
  const isGlobalRole = ["ADMIN", "SUPERVISOR"].includes(role);
  const canManage = ["ADMIN", "SUPERVISOR"].includes(role);
  const canOperationalConfirm = ["JEFE_FAENA", "MECANICO", "OPERADOR"].includes(role);
  const canProcessComment = ["ADMIN", "SUPERVISOR", "JEFE_FAENA"].includes(role);

  const filtersCard = document.getElementById("solicitudes-filters-card");
  const toggleFiltersBtn = document.getElementById("solicitudes-toggle-filters");
  const filterForm = document.getElementById("solicitudes-filter-form");
  const filterBtn = document.getElementById("solicitudes-filter-btn");
  const clearFiltersBtn = document.getElementById("solicitudes-clear-btn");
  const exportBtn = document.getElementById("solicitudes-export-btn");
  const refreshBtn = document.getElementById("solicitudes-refresh-btn");
  const searchInput = document.getElementById("solicitudes-search-input");
  const searchSummary = document.getElementById("solicitudes-search-summary");
  const tableBody = document.getElementById("solicitudes-table-body");
  const mobileList = document.getElementById("solicitudes-mobile-list");
  const quickFilters = document.getElementById("solicitudes-quick-filters");
  const mobilePrimaryBtn = document.getElementById("solicitudes-mobile-primary");
  const mobileSecondaryBtn = document.getElementById("solicitudes-mobile-secondary");

  const createModal = document.getElementById("solicitudes-create-modal");
  const createForm = document.getElementById("solicitudes-form");
  const createOpenBtn = document.getElementById("solicitudes-open-create-modal");
  const createCloseBtn = document.getElementById("solicitudes-create-close");
  const createCancelBtn = document.getElementById("solicitudes-create-cancel");
  const equipoField = document.getElementById("solicitud-equipo-field");
  const equipoSelect = document.getElementById("solicitud-equipo-id");
  const filterEquipoField = document.getElementById("solicitud-filter-equipo-field");
  const filterEquipoSelect = document.getElementById("solicitud-filter-equipo");
  const createItemsList = document.getElementById("create-items-list");
  const createAddItemBtn = document.getElementById("create-add-item-btn");

  const detailModal = document.getElementById("solicitudes-detail-modal");
  const detailTabButtons = [...document.querySelectorAll(".detail-tab-btn")];
  const detailCloseBtn = document.getElementById("solicitudes-detail-close");
  const detailCancelBtn = document.getElementById("solicitudes-detail-cancel");
  const detailPrimaryPanel = document.getElementById("solicitud-detail-primary-panel");
  const detailSecondaryPanel = document.getElementById("solicitud-detail-secondary-panel");
  const detailStatePanel = document.getElementById("solicitud-detail-state-panel");
  const detailHistoryPanel = document.getElementById("solicitud-detail-history-panel");
  const detailTitle = document.getElementById("solicitud-detail-title");
  const detailBadge = document.getElementById("solicitud-detail-badge");
  const detailEquipo = document.getElementById("solicitud-detail-equipo");
  const detailEquipoSelect = document.getElementById("solicitud-detail-equipo-id");
  const detailSolicitante = document.getElementById("solicitud-detail-solicitante");
  const detailStatusField = document.getElementById("solicitud-detail-status-field");
  const detailStatus = document.getElementById("solicitud-detail-status");
  const detailStatusActions = document.getElementById("solicitud-status-actions");
  const detailComentario = document.getElementById("solicitud-detail-comentario");
  const detailStepper = document.getElementById("solicitud-detail-stepper");
  const progressSummary = document.getElementById("solicitud-progress-summary");
  const deliveryAssistant = document.getElementById("solicitud-delivery-assistant");
  const processCommentCard = document.getElementById("solicitud-process-comment-card");
  const processCommentInput = document.getElementById("solicitud-process-comment-input");
  const processCommentBtn = document.getElementById("solicitud-process-comment-btn");
  const detailHistory = document.getElementById("solicitud-history");
  const detailItemsList = document.getElementById("detail-items-list");
  const detailAddItemBtn = document.getElementById("detail-add-item-btn");
  const saveBtn = document.getElementById("solicitud-save-btn");
  const deleteBtn = document.getElementById("solicitud-delete-btn");
  const confirmBox = document.getElementById("solicitud-confirm-box");
  const confirmBtn = document.getElementById("solicitud-confirm-btn");
  const openChatBtn = document.getElementById("solicitud-open-chat-btn");
  const openChatBtnSecondary = document.getElementById("solicitud-open-chat-btn-secondary");
  const chatScrim = document.getElementById("solicitud-chat-scrim");
  const chatDrawer = document.getElementById("solicitud-chat-drawer");
  const chatBackBtn = document.getElementById("solicitud-chat-back-btn");
  const chatCloseBtn = document.getElementById("solicitud-chat-close-btn");
  const chatSubtitle = document.getElementById("solicitud-chat-subtitle");
  const destinatarioSelect = document.getElementById("solicitud-message-destinatario");
  const messageForm = document.getElementById("solicitud-message-form");
  const messageText = document.getElementById("solicitud-message-text");
  const messageImage = document.getElementById("solicitud-message-image");
  const messagePreview = document.getElementById("solicitud-message-preview");
  const messageRemoveImageBtn = document.getElementById("solicitud-message-remove-image-btn");
  const messagesList = document.getElementById("solicitud-messages-list");
  const itemModal = document.getElementById("solicitud-item-modal");
  const itemModalTitle = document.getElementById("solicitud-item-modal-title");
  const itemModalSubtitle = document.getElementById("solicitud-item-modal-subtitle");
  const itemForm = document.getElementById("solicitud-item-form");
  const itemCloseBtn = document.getElementById("solicitud-item-close");
  const itemCancelBtn = document.getElementById("solicitud-item-cancel-btn");
  const itemSaveBtn = document.getElementById("solicitud-item-save-btn");
  const itemDeleteBtn = document.getElementById("solicitud-item-delete-btn");
  const itemNameInput = document.getElementById("solicitud-item-name-input");
  const itemCodeInput = document.getElementById("solicitud-item-code-input");
  const itemQtyInput = document.getElementById("solicitud-item-qty-input");
  const itemUnitInput = document.getElementById("solicitud-item-unit-input");
  const itemFinalUserInput = document.getElementById("solicitud-item-final-user-input");
  const itemCommentInput = document.getElementById("solicitud-item-comment-input");
  const itemStatusField = document.getElementById("solicitud-item-status-field");
  const itemStatusInput = document.getElementById("solicitud-item-status-input");
  const itemOwnerField = document.getElementById("solicitud-item-owner-field");
  const itemOwnerInput = document.getElementById("solicitud-item-owner-input");
  const itemSenderField = document.getElementById("solicitud-item-sender-field");
  const itemSenderInput = document.getElementById("solicitud-item-sender-input");
  const itemReceiverField = document.getElementById("solicitud-item-receiver-field");
  const itemReceiverInput = document.getElementById("solicitud-item-receiver-input");
  const itemManagementCommentField = document.getElementById("solicitud-item-management-comment-field");
  const itemManagementCommentInput = document.getElementById("solicitud-item-management-comment-input");

  const inlinePendingList = document.getElementById("inline-pending-list");
  const inlinePendingCount = document.getElementById("inline-pending-count");
  const inlinePendingSearch = document.getElementById("inline-pending-search");
  const inlinePendingRefreshBtn = document.getElementById("inline-pending-refresh-btn");
  const inlinePendingToggle = document.getElementById("inline-pending-toggle");
  const inlinePendingBody = document.getElementById("inline-pending-body");

  const filters = {
    estado: "",
    fechaDesde: "",
    fechaHasta: "",
    equipoId: "",
  };

  let solicitudesCache = [];
  let currentSolicitud = null;
  let pendingImageData = "";
  let pendingImageName = "";
  let isListLoading = false;
  let searchText = "";
  let searchTimer = null;
  let realtimeRefreshTimer = null;
  let currentContactOptions = [];
  let currentItemEditor = null;
  let availableEquipos = [];
  let activeDetailTab = "items";
  let lastNonChatDetailTab = "items";
  let chatHistoryEntryActive = false;
  let lastSeenMessageCount = 0;
  let chatUnreadCount = 0;
  let pendingItemsCache = [];

  // ── Pending items inline ─────────────────────────────────────────

  async function loadAndRenderPendingItems() {
    if (inlinePendingCount) inlinePendingCount.textContent = "Cargando...";
    if (inlinePendingList) inlinePendingList.innerHTML = "<div class='history-empty'>Cargando items...</div>";
    try {
      const payload = await context.apiRequest("/api/solicitudes/items/pendientes");
      pendingItemsCache = Array.isArray(payload?.data) ? payload.data : [];
    } catch (err) {
      if (inlinePendingList) inlinePendingList.innerHTML = "<div class='history-empty'>Error al cargar los items.</div>";
      if (inlinePendingCount) inlinePendingCount.textContent = "Error";
      return;
    }
    renderPendingItems(inlinePendingSearch?.value.trim() ?? "");
  }

  function renderPendingItems(query = "") {
    if (!inlinePendingList) return;
    const q = query.toLowerCase();
    const items = q
      ? pendingItemsCache.filter(
          (it) =>
            (it.nombre_item || "").toLowerCase().includes(q) ||
            String(it.solicitud_id).includes(q) ||
            (it.solicitud_equipo || "").toLowerCase().includes(q) ||
            (it.solicitante_nombre || "").toLowerCase().includes(q) ||
            (it.codigo_referencia || "").toLowerCase().includes(q)
        )
      : pendingItemsCache;

    if (inlinePendingCount) {
      inlinePendingCount.textContent =
        `${items.length} producto${items.length !== 1 ? "s" : ""} pendiente${items.length !== 1 ? "s" : ""}`;
    }

    if (!items.length) {
      inlinePendingList.innerHTML = `
        <div class="pending-items-empty">
          <strong>${q ? "Sin resultados" : "Todo gestionado"}</strong>
          ${q ? "Prueba con otro termino." : "No hay productos pendientes en solicitudes activas."}
        </div>`;
      return;
    }

    // Tabla compacta por solicitud
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.solicitud_id)) groups.set(item.solicitud_id, []);
      groups.get(item.solicitud_id).push(item);
    }

    const statusLabel = { PENDIENTE: "Pendiente", EN_REVISION: "En gestion", APROBADO: "Aprobada", EN_DESPACHO: "En despacho" };

    let html = `<div class="inline-pending-table">`;
    let groupIndex = 0;
    for (const [solicitudId, groupItems] of groups) {
      const delay = Math.min(groupIndex * 0.05, 0.3);
      const first = groupItems[0];
      const estado = statusLabel[first.solicitud_estado] || first.solicitud_estado || "";
      html += `
        <div class="ipt-group" style="animation-delay:${delay}s">
          <div class="ipt-group-head">
            <span class="ipt-group-id">#${solicitudId}</span>
            <span class="ipt-group-equipo">${first.solicitud_equipo || "Sin equipo"}</span>
            <span class="ipt-group-quien">${first.solicitante_nombre || "?"}</span>
            <span class="mini-chip">${estado}</span>
            <button class="ipt-open-btn" type="button" data-open-solicitud="${solicitudId}">Ver</button>
          </div>`;
      for (const item of groupItems) {
        const ref = item.codigo_referencia ? `<span class="ipt-ref">${item.codigo_referencia}</span>` : "";
        const nota = item.comentario ? `<span class="ipt-nota">${item.comentario}</span>` : "";
        const uf = item.usuario_final ? `<span class="ipt-uf">👤 ${item.usuario_final}</span>` : "";
        html += `
          <div class="ipt-item">
            <span class="ipt-name">${item.nombre_item || "Sin nombre"}</span>
            ${ref}${nota}${uf}
            <span class="ipt-qty">${item.cantidad ?? ""} <small>${item.unidad_medida || ""}</small></span>
          </div>`;
      }
      html += `</div>`;
      groupIndex++;
    }
    html += `</div>`;
    inlinePendingList.innerHTML = html;
  }

  // ────────────────────────────────────────────────────────────────

  function isPhoneLayout() {
    return window.matchMedia("(max-width: 680px)").matches;
  }

  function syncDetailTabButtons() {
    detailTabButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.detailTab === activeDetailTab);
    });
  }

  function updateChatBadge(count) {
    chatUnreadCount = Math.max(0, count);
    const label = chatUnreadCount > 0 ? ` (${chatUnreadCount})` : "";
    const isChatOpen = chatDrawer?.classList.contains("open");
    const shouldShow = chatUnreadCount > 0 && !isChatOpen;
    [openChatBtn, openChatBtnSecondary].forEach((btn) => {
      if (!btn) return;
      btn.dataset.chatUnread = shouldShow ? String(chatUnreadCount) : "";
      btn.classList.toggle("has-chat-unread", shouldShow);
      const baseLabelPrimary = btn === openChatBtn ? "Abrir chat" : "Abrir chat lateral";
      btn.textContent = baseLabelPrimary + (shouldShow ? label : "");
    });
  }

  function applyDetailTabLayout() {
    syncDetailTabButtons();

    if (!isPhoneLayout()) {
      detailPrimaryPanel.classList.add("detail-tab-active");
      detailSecondaryPanel.classList.add("detail-tab-active");
      detailStatePanel.classList.add("detail-tab-active");
      detailHistoryPanel.classList.add("detail-tab-active");
      return;
    }

    detailPrimaryPanel.classList.toggle("detail-tab-active", activeDetailTab === "items");
    detailSecondaryPanel.classList.toggle(
      "detail-tab-active",
      activeDetailTab === "estado" || activeDetailTab === "historial"
    );
    detailStatePanel.classList.toggle("detail-tab-active", activeDetailTab === "estado");
    detailHistoryPanel.classList.toggle("detail-tab-active", activeDetailTab === "historial");
  }

  function setDetailTab(tabName) {
    activeDetailTab = tabName;
    if (tabName !== "chat") {
      lastNonChatDetailTab = tabName;
    }
    applyDetailTabLayout();

    if (tabName === "chat") {
      openChatDrawer({ syncTab: false });
    } else {
      closeChatDrawer({ syncTab: false });
    }
  }

  function openChatDrawer(options = {}) {
    const { syncTab = true } = options;
    if (syncTab && isPhoneLayout()) {
      activeDetailTab = "chat";
      syncDetailTabButtons();
      applyDetailTabLayout();
    }
    if (isPhoneLayout() && !chatHistoryEntryActive) {
      try {
        window.history.pushState({ ...(window.history.state || {}), fmnOverlay: "solicitud-chat" }, "");
        chatHistoryEntryActive = true;
      } catch {
        chatHistoryEntryActive = false;
      }
    }
    detailModal.classList.add("chat-open");
    chatScrim.classList.add("open");
    chatDrawer.classList.add("open");
    lastSeenMessageCount = currentSolicitud?.mensajes?.length ?? 0;
    updateChatBadge(0);
  }

  function clearChatHistoryState() {
    if (!isPhoneLayout() || !chatHistoryEntryActive) {
      return;
    }

    try {
      const nextState = { ...(window.history.state || {}) };
      delete nextState.fmnOverlay;
      window.history.replaceState(nextState, "");
    } catch {
      // Ignorar si el navegador no permite manipular el state.
    }

    chatHistoryEntryActive = false;
  }

  function closeChatDrawer(options = {}) {
    const { syncTab = true, syncHistory = true } = options;
    detailModal.classList.remove("chat-open");
    chatScrim.classList.remove("open");
    chatDrawer.classList.remove("open");
    if (syncTab && isPhoneLayout() && activeDetailTab === "chat") {
      activeDetailTab = lastNonChatDetailTab || "items";
      applyDetailTabLayout();
    }
    if (syncHistory && isPhoneLayout() && chatHistoryEntryActive) {
      clearChatHistoryState();
    }
  }

  function handleChatPopstate() {
    if (!isPhoneLayout()) {
      return;
    }
    if (chatDrawer.classList.contains("open")) {
      chatHistoryEntryActive = false;
      closeChatDrawer({ syncTab: true, syncHistory: false });
    }
  }

  async function loadEquiposIfNeeded() {
    if (!isGlobalRole) {
      equipoField.classList.add("hidden");
      filterEquipoField.classList.add("hidden");
      return;
    }

    const payload = await context.apiRequest("/api/equipos");
    const equipos = payload.data || [];
    availableEquipos = equipos;

    equipoSelect.innerHTML = equipos.length
      ? [
          "<option value=''>Seleccionar equipo</option>",
          ...equipos.map((item) => `<option value="${item.id}">${item.nombre_equipo}</option>`),
        ].join("")
      : "<option value=''>Sin equipos</option>";

    filterEquipoSelect.innerHTML = [
      "<option value=''>Todos</option>",
      ...equipos.map((item) => `<option value="${item.id}">${item.nombre_equipo}</option>`),
    ].join("");

    detailEquipoSelect.innerHTML = equipos.length
      ? [
          "<option value=''>Seleccionar equipo</option>",
          ...equipos.map((item) => `<option value="${item.id}">${item.nombre_equipo}</option>`),
        ].join("")
      : "<option value=''>Sin equipos</option>";
  }

  function addCreateItem(item = {}, options = {}) {
    const { reveal = true, focus = false } = options;
    createItemsList.insertAdjacentHTML("beforeend", buildCreateItemRow(item, { editable: true }));
    const lastRow = createItemsList.querySelector(".item-row:last-child");
    if (lastRow && reveal) {
      requestAnimationFrame(() => {
        lastRow.scrollIntoView({ behavior: "smooth", block: "end" });
        if (focus) {
          lastRow.querySelector(".solicitud-item-name")?.focus();
        }
      });
    }
  }

  function addDetailItem(item = {}, options = {}) {
    detailItemsList.insertAdjacentHTML(
      "beforeend",
      buildDetailItemRow(item, {
        editableBase: options.editableBase === true,
        canManageItem: options.canManageItem === true,
        contactos: options.contactos || currentContactOptions,
        formatDate: context.formatDate,
        solicitante: options.solicitante || currentSolicitud?.solicitante_name || currentSolicitud?.solicitante,
      })
    );
  }

  function resetCreateItems() {
    createItemsList.innerHTML = "";
    addCreateItem({}, { reveal: false });
  }

  function resetCreateSolicitudForm() {
    createForm.reset();
    resetCreateItems();
    if (isGlobalRole && equipoSelect) {
      equipoSelect.value = "";
    }
  }

  function resetMessageComposer() {
    messageText.value = "";
    messageImage.value = "";
    messagePreview.classList.add("hidden");
    messagePreview.innerHTML = "";
    messageRemoveImageBtn.classList.add("hidden");
    pendingImageData = "";
    pendingImageName = "";
  }

  function populateItemModalOptions(item = {}) {
    itemStatusInput.innerHTML = ITEM_STATUS_OPTIONS.map(
      (option) =>
        `<option value="${option.key}" ${option.key === (item.estado_item || "POR_GESTIONAR") ? "selected" : ""}>${
          option.label
        }</option>`
    ).join("");

    itemOwnerInput.innerHTML = [
      "<option value=''>Sin encargado</option>",
      ...currentContactOptions.map(
        (contacto) =>
          `<option value="${contacto.id}" ${
            Number(contacto.id) === Number(item.encargado_id) ? "selected" : ""
          }>${contacto.nombre} - ${contacto.rol}${
            contacto.equipo_nombre ? ` - ${contacto.equipo_nombre}` : ""
          }</option>`
      ),
    ].join("");

    itemSenderInput.innerHTML = [
      "<option value=''>Sin registrar</option>",
      ...currentContactOptions.map(
        (contacto) =>
          `<option value="${contacto.id}" ${
            Number(contacto.id) === Number(item.enviado_por_id) ? "selected" : ""
          }>${contacto.nombre} - ${contacto.rol}${
            contacto.equipo_nombre ? ` - ${contacto.equipo_nombre}` : ""
          }</option>`
      ),
    ].join("");

    itemReceiverInput.innerHTML = [
      "<option value=''>Sin registrar</option>",
      ...currentContactOptions.map(
        (contacto) =>
          `<option value="${contacto.id}" ${
            Number(contacto.id) === Number(item.recepcionado_por_id) ? "selected" : ""
          }>${contacto.nombre} - ${contacto.rol}${
            contacto.equipo_nombre ? ` - ${contacto.equipo_nombre}` : ""
          }</option>`
      ),
    ].join("");
  }

  function fillItemModal(item = null) {
    const editableBase = Boolean(currentSolicitud && (currentSolicitud.estado === "PENDIENTE" || canManage));
    const canManageItem = canManage;
    const isNew = !item?.id;

    currentItemEditor = {
      itemId: item?.id ? Number(item.id) : null,
      editableBase,
      canManageItem,
      isNew,
    };

    itemModalTitle.textContent = isNew ? "Agregar producto" : `Configurar producto #${item.id}`;
    itemModalSubtitle.textContent = isNew
      ? "Registra un nuevo producto dentro de esta solicitud."
      : "Configura este producto sin mezclarlo con el resto de la solicitud.";

    itemNameInput.value = item?.nombre_item || "";
    itemCodeInput.value = item?.codigo_referencia || item?.codigo || "";
    itemQtyInput.value = item?.cantidad || 1;
    itemUnitInput.value = item?.unidad_medida || "";
    itemFinalUserInput.value = item?.usuario_final || "";
    itemCommentInput.value = item?.detalle || item?.comentario || "";
    itemManagementCommentInput.value = item?.comentario_gestion || "";
    populateItemModalOptions(item || {});

    itemNameInput.disabled = !editableBase;
    itemCodeInput.disabled = !editableBase;
    itemQtyInput.disabled = !editableBase;
    itemUnitInput.disabled = !editableBase;
    itemFinalUserInput.disabled = !editableBase;
    itemCommentInput.disabled = !editableBase;
    itemStatusField.classList.toggle("hidden", !canManageItem);
    itemOwnerField.classList.toggle("hidden", !canManageItem);
    itemSenderField.classList.toggle("hidden", !canManageItem);
    itemReceiverField.classList.toggle("hidden", !canManageItem);
    itemManagementCommentField.classList.toggle("hidden", !canManageItem);
    itemStatusInput.disabled = !canManageItem;
    itemOwnerInput.disabled = !canManageItem;
    itemSenderInput.disabled = !canManageItem;
    itemReceiverInput.disabled = !canManageItem;
    itemManagementCommentInput.disabled = !canManageItem;
    itemDeleteBtn.classList.toggle("hidden", !(editableBase && !isNew));

    openModal(itemModal);
  }

  function closeItemModal() {
    currentItemEditor = null;
    itemForm.reset();
    closeModal(itemModal);
  }

  function renderSolicitudes(rows) {
    renderSummary(rows);
    renderRows(rows, tableBody, mobileList, context.formatDate, role);
  }

  function getVisibleSolicitudes() {
    if (!searchText) {
      return solicitudesCache;
    }

    return solicitudesCache.filter((item) => {
      const haystack = normalizeSearchValue(
        [
          item.id,
          item.nombre_equipo,
          item.equipo,
          item.resumen_items,
          item.repuesto,
          item.estado,
          item.solicitante_nombre,
          item.solicitante,
          getStatusLabel(item.estado),
        ]
          .filter(Boolean)
          .join(" ")
      );
      return haystack.includes(searchText);
    });
  }

  function renderSearchSummary(visibleRows) {
    if (!searchSummary) {
      return;
    }

    if (!searchText) {
      searchSummary.textContent = `Mostrando ${solicitudesCache.length} solicitud(es) cargadas.`;
      return;
    }

    const rawSearch = searchInput?.value?.trim() || "";
    searchSummary.textContent = `Mostrando ${visibleRows.length} de ${solicitudesCache.length} resultado(s) para "${rawSearch}".`;
  }

  function renderCurrentSolicitudes() {
    const visibleRows = getVisibleSolicitudes();
    renderSolicitudes(visibleRows);
    renderSearchSummary(visibleRows);
  }

  function syncQuickFilterUI() {
    quickFilters.querySelectorAll("[data-quick-filter]").forEach((button) => {
      const target = button.dataset.quickFilter;
      const selected = target === "ALL" ? !filters.estado : filters.estado === target;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function scrollToBandeja() {
    const targetSection = tableBody.closest(".card");
    targetSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function applyQuickFilter(status, successMessage = "") {
    filters.estado = status || "";
    const selectEstado = filterForm.querySelector("[name='estado']");
    if (selectEstado) {
      selectEstado.value = filters.estado;
    }
    await loadSolicitudes();
    scrollToBandeja();
    if (successMessage) {
      context.showToast(successMessage);
    }
  }

  function configureRoleActions() {
    const config = ROLE_ACTIONS[role] || ROLE_ACTIONS.OPERADOR;

    [
      [mobilePrimaryBtn, config.primary],
      [mobileSecondaryBtn, config.secondary],
    ].forEach(([button, actionConfig]) => {
      if (!button) {
        return;
      }
      button.textContent = actionConfig.label;
      button.dataset.roleAction = actionConfig.action;
    });
  }

  async function executeRoleAction(actionName) {
    if (actionName === "OPEN_CREATE") {
      resetCreateItems();
      openModal(createModal);
      return;
    }

    if (actionName === "FILTER_PENDING") {
      await applyQuickFilter("PENDIENTE");
      return;
    }

    if (actionName === "FILTER_DISPATCH") {
      await applyQuickFilter("EN_DESPACHO");
    }
  }

  function setListBusy(isBusy) {
    isListLoading = isBusy;
    filterBtn.disabled = isBusy;
    clearFiltersBtn.disabled = isBusy;
    exportBtn.disabled = isBusy;
    refreshBtn.disabled = isBusy;
    createOpenBtn.disabled = isBusy;
    if (isBusy) {
      tableBody.innerHTML = "<tr><td colspan='7'>Cargando solicitudes...</td></tr>";
      mobileList.innerHTML = "<div class='history-empty'>Cargando solicitudes...</div>";
    }
  }

  async function loadSolicitudes(options = {}) {
    const { showLoading = true } = options;
    if (isListLoading) {
      return;
    }

    if (showLoading) {
      setListBusy(true);
    }

    try {
      const query = buildQueryString(filters);
      const payload = await context.apiRequest(`/api/solicitudes${query}`);
      solicitudesCache = payload.data || [];
      renderCurrentSolicitudes();
      syncQuickFilterUI();
    } finally {
      if (showLoading) {
        setListBusy(false);
      }
    }
  }

  async function refreshSolicitudesFromRealtime(notification) {
    if (!tableBody.isConnected) {
      return;
    }

    if (!notification || !String(notification.tipo || "").startsWith("SOLICITUD_")) {
      return;
    }

    if (realtimeRefreshTimer) {
      window.clearTimeout(realtimeRefreshTimer);
    }

    realtimeRefreshTimer = window.setTimeout(async () => {
      try {
        const shouldPreserveChat = chatDrawer.classList.contains("open");
        await Promise.all([loadSolicitudes({ showLoading: false }), loadAndRenderPendingItems()]);

        const referenceId = Number(notification.referencia_id || 0);
        if (currentSolicitud && (!referenceId || Number(currentSolicitud.id) === referenceId)) {
          await loadSolicitudDetail(currentSolicitud.id, { preserveChat: shouldPreserveChat });
        }
      } catch {
        // Ignorar errores silenciosos del refresco en vivo.
      }
    }, 320);
  }

  function isDetailEditable(solicitud) {
    return Boolean(solicitud && (solicitud.estado === "PENDIENTE" || canManage));
  }

  function canConfirmSolicitud(solicitud) {
    return Boolean(solicitud && canOperationalConfirm && solicitud.estado === "EN_DESPACHO");
  }

  function fillContactOptions(contactos = []) {
    currentContactOptions = contactos;
    destinatarioSelect.innerHTML = [
      "<option value=''>Seleccione a quien hablarle</option>",
      ...contactos.map(
        (contacto) =>
          `<option value="${contacto.id}">${contacto.nombre} - ${contacto.rol}${
            contacto.equipo_nombre ? ` - ${contacto.equipo_nombre}` : ""
          }</option>`
      ),
    ].join("");
  }

  function updateChatView(solicitud) {
    const messages = solicitud.mensajes || [];
    messagesList.innerHTML = renderMessages(messages, {
      formatDate: context.formatDate,
      canRemoveImage: canManage,
      currentUserId,
    });
    chatSubtitle.textContent = `Solicitud #${solicitud.id} - ${messages.length} mensaje(s)`;
    fillContactOptions(solicitud.contactos || []);
    resetMessageComposer();

    const isChatOpen = chatDrawer?.classList.contains("open");
    if (!isChatOpen && messages.length > lastSeenMessageCount) {
      updateChatBadge(messages.length - lastSeenMessageCount);
    } else if (isChatOpen) {
      lastSeenMessageCount = messages.length;
      updateChatBadge(0);
    }
  }

  function fillDetailModal(solicitud, options = {}) {
    const preserveChat = options.preserveChat === true;
    currentSolicitud = solicitud;
    detailTitle.textContent = `Solicitud #${solicitud.id}`;
    detailBadge.innerHTML = renderStatusBadge(solicitud.estado);
    detailEquipo.value = solicitud.nombre_equipo || solicitud.equipo || "-";
    detailEquipo.classList.toggle("hidden", isGlobalRole);
    detailEquipoSelect.classList.toggle("hidden", !isGlobalRole);
    detailEquipoSelect.value = solicitud.equipo_id ? String(solicitud.equipo_id) : "";
    detailEquipoSelect.disabled = !canManage || !availableEquipos.length;
    detailSolicitante.value = solicitud.solicitante_name || solicitud.solicitante || "-";
    detailStatus.value = solicitud.estado || "PENDIENTE";
    detailComentario.value = solicitud.comentario || "";
    detailStepper.innerHTML = renderSolicitudStepper(solicitud.estado);
    progressSummary.innerHTML = renderProgressSummary(solicitud.items || []);
    deliveryAssistant.innerHTML = renderDeliveryAssistant(solicitud, {
      canManage,
      canConfirm: canConfirmSolicitud(solicitud),
    });
    deliveryAssistant.classList.toggle("hidden", !deliveryAssistant.innerHTML.trim());
    processCommentCard.classList.toggle("hidden", !canProcessComment);
    processCommentInput.value = "";
    processCommentInput.disabled = !canProcessComment;
    processCommentInput.placeholder = `Agregar comentario sobre ${getStatusLabel(solicitud.estado).toLowerCase()}`;
    processCommentBtn.disabled = !canProcessComment;
    detailHistory.innerHTML = renderHistory(solicitud.historial || [], context.formatDate);
    updateChatView(solicitud);

    const editable = isDetailEditable(solicitud);
    detailStatusField.classList.toggle("hidden", !canManage);
    detailStatus.disabled = !canManage;
    detailStatusActions.innerHTML = renderStatusActions(solicitud.estado, canManage);
    detailComentario.disabled = !(editable || canManage || canConfirmSolicitud(solicitud));
    detailItemsList.innerHTML = "";
    (solicitud.items || []).forEach((item) =>
      addDetailItem(item, {
        editableBase: editable,
        canManageItem: canManage,
        contactos: solicitud.contactos || [],
        solicitante: solicitud.solicitante_name || solicitud.solicitante,
      })
    );
    detailAddItemBtn.classList.toggle("hidden", !editable);
    saveBtn.classList.toggle("hidden", !editable && !canManage);
    deleteBtn.classList.toggle("hidden", !canManage);
    confirmBox.classList.toggle("hidden", !canConfirmSolicitud(solicitud));
    if (preserveChat) {
      openChatDrawer({ syncTab: false });
    } else {
      closeChatDrawer({ syncTab: false });
    }
    closeItemModal();
    applyDetailTabLayout();
  }

  function showDetailLoading(solicitudId) {
    detailTitle.textContent = `Solicitud #${solicitudId}`;
    detailBadge.innerHTML = renderStatusBadge("PENDIENTE");
    detailEquipo.value = "Cargando...";
    detailEquipo.classList.toggle("hidden", isGlobalRole);
    detailEquipoSelect.classList.toggle("hidden", !isGlobalRole);
    detailEquipoSelect.value = "";
    detailEquipoSelect.disabled = true;
    detailSolicitante.value = "Cargando...";
    detailStatus.value = "PENDIENTE";
    detailComentario.value = "";
    detailStepper.innerHTML = "<div class='history-empty'>Cargando estado...</div>";
    progressSummary.innerHTML = `
      <div class="progress-summary-card"><span class="progress-summary-label">Items</span><strong>...</strong></div>
      <div class="progress-summary-card"><span class="progress-summary-label">Por gestionar</span><strong>...</strong></div>
      <div class="progress-summary-card"><span class="progress-summary-label">Gestionados</span><strong>...</strong></div>
      <div class="progress-summary-card"><span class="progress-summary-label">Enviados</span><strong>...</strong></div>
      <div class="progress-summary-card"><span class="progress-summary-label">Entregados</span><strong>...</strong></div>
    `;
    deliveryAssistant.innerHTML = "";
    deliveryAssistant.classList.add("hidden");
    processCommentCard.classList.toggle("hidden", !canProcessComment);
    processCommentInput.value = "";
    processCommentInput.disabled = true;
    processCommentBtn.disabled = true;
    detailStatusActions.innerHTML = "";
    detailHistory.innerHTML = "<div class='history-empty'>Cargando historial...</div>";
    detailItemsList.innerHTML = "<div class='history-empty'>Cargando items...</div>";
    messagesList.innerHTML = "<div class='history-empty'>Cargando mensajes...</div>";
    detailAddItemBtn.classList.add("hidden");
    saveBtn.classList.add("hidden");
    deleteBtn.classList.add("hidden");
    confirmBox.classList.add("hidden");
    closeChatDrawer({ syncTab: false });
    lastSeenMessageCount = 0;
    updateChatBadge(0);
    applyDetailTabLayout();
  }

  async function loadSolicitudDetail(solicitudId, options = {}) {
    const payload = await context.apiRequest(`/api/solicitudes/${solicitudId}`);
    currentSolicitud = payload.data || null;
    if (!currentSolicitud) {
      throw new Error("No se pudo cargar la solicitud");
    }
    fillDetailModal(currentSolicitud, options);
  }

  async function saveSolicitudChanges() {
    if (!currentSolicitud) {
      return;
    }

    const payload = {};

    if (detailComentario.value.trim() !== String(currentSolicitud.comentario || "").trim()) {
      payload.comentario = detailComentario.value.trim();
    }

    if (canManage && detailStatus.value !== currentSolicitud.estado) {
      payload.estado = detailStatus.value;
    }

    const bulkWarning =
      payload.estado && ["EN_DESPACHO", "ENTREGADO"].includes(payload.estado)
        ? buildBulkStatusWarning(currentSolicitud, payload.estado)
        : "";
    if (bulkWarning) {
      const confirmed = window.confirm(bulkWarning);
      if (!confirmed) {
        return;
      }
    }

    if (canManage && !detailEquipoSelect.classList.contains("hidden")) {
      const selectedEquipoId = detailEquipoSelect.value ? Number(detailEquipoSelect.value) : 0;
      const currentEquipoId = Number(currentSolicitud.equipo_id || 0);
      if (selectedEquipoId > 0 && selectedEquipoId !== currentEquipoId) {
        payload.equipo_id = selectedEquipoId;
      }
    }

    if (!Object.keys(payload).length) {
      context.showToast("No hay cambios para guardar");
      return;
    }

    await context.apiRequest(`/api/solicitudes/${currentSolicitud.id}`, {
      method: "PUT",
      body: payload,
    });

    await Promise.all([loadSolicitudes({ showLoading: false }), loadSolicitudDetail(currentSolicitud.id)]);
    context.showToast("Solicitud actualizada");
  }

  async function executeBulkSolicitudStatus(targetStatus) {
    if (!currentSolicitud) {
      return;
    }

    await context.apiRequest(`/api/solicitudes/${currentSolicitud.id}`, {
      method: "PUT",
      body: {
        estado: targetStatus,
        comentario:
          detailComentario.value.trim() ||
          (targetStatus === "ENTREGADO"
            ? "Cierre completo de la solicitud"
            : "Despacho completo de la solicitud"),
      },
    });

    await Promise.all([loadSolicitudes({ showLoading: false }), loadSolicitudDetail(currentSolicitud.id)]);
    context.showToast(
      targetStatus === "ENTREGADO"
        ? "Solicitud completa marcada como entregada"
        : "Solicitud completa marcada como en despacho"
    );
  }

  async function saveProcessComment() {
    if (!currentSolicitud) {
      return;
    }

    const comentario = processCommentInput.value.trim();
    if (!comentario) {
      throw new Error("Escribe un comentario de proceso");
    }

    await context.apiRequest(`/api/solicitudes/${currentSolicitud.id}/comentarios-proceso`, {
      method: "POST",
      body: {
        comentario,
      },
    });

    processCommentInput.value = "";
    await loadSolicitudDetail(currentSolicitud.id, { preserveChat: chatDrawer.classList.contains("open") });
    context.showToast("Comentario de proceso agregado");
  }

  async function saveSolicitudItemFromModal() {
    if (!currentSolicitud || !currentItemEditor) {
      return;
    }

    const payload = {};

    if (currentItemEditor.editableBase) {
      const nombreItem = itemNameInput.value.trim() || "Producto sin nombre";
      const codigoReferencia = itemCodeInput.value.trim();
      const cantidadRaw = Number(itemQtyInput.value || 0);
      const cantidad = Number.isInteger(cantidadRaw) && cantidadRaw > 0 ? cantidadRaw : 1;
      const unidadMedida = itemUnitInput.value.trim();
      const usuarioFinal = itemFinalUserInput.value.trim();
      const detalle = itemCommentInput.value.trim();

      payload.nombre_item = nombreItem;
      payload.cantidad = cantidad;
      if (codigoReferencia) {
        payload.codigo_referencia = codigoReferencia;
      }
      if (unidadMedida) {
        payload.unidad_medida = unidadMedida;
      }
      if (usuarioFinal) {
        payload.usuario_final = usuarioFinal;
      }
      if (detalle) {
        payload.comentario = detalle;
      }
    }

    if (currentItemEditor.canManageItem) {
      payload.estado_item = itemStatusInput.value || "POR_GESTIONAR";
      payload.comentario_gestion = itemManagementCommentInput.value.trim();
      payload.encargado_id = itemOwnerInput.value ? Number(itemOwnerInput.value) : null;
      payload.enviado_por_id = itemSenderInput.value ? Number(itemSenderInput.value) : null;
      payload.recepcionado_por_id = itemReceiverInput.value ? Number(itemReceiverInput.value) : null;
    }

    if (currentItemEditor.isNew) {
      await context.apiRequest(`/api/solicitudes/${currentSolicitud.id}/items`, {
        method: "POST",
        body: payload,
      });
      context.showToast("Producto agregado");
    } else {
      await context.apiRequest(
        `/api/solicitudes/${currentSolicitud.id}/items/${currentItemEditor.itemId}`,
        {
          method: "PUT",
          body: payload,
        }
      );
      context.showToast("Producto actualizado");
    }

    await Promise.all([loadSolicitudes({ showLoading: false }), loadSolicitudDetail(currentSolicitud.id)]);
    openModal(detailModal);
    closeItemModal();
  }

  async function deleteSolicitudItemFromModal() {
    if (!currentSolicitud || !currentItemEditor || currentItemEditor.isNew) {
      return;
    }

    const confirmed = window.confirm("Desea eliminar este item de la solicitud?");
    if (!confirmed) {
      return;
    }

    await context.apiRequest(
      `/api/solicitudes/${currentSolicitud.id}/items/${currentItemEditor.itemId}`,
      {
        method: "DELETE",
      }
    );

    await Promise.all([loadSolicitudes({ showLoading: false }), loadSolicitudDetail(currentSolicitud.id)]);
    openModal(detailModal);
    closeItemModal();
    context.showToast("Producto eliminado");
  }

  toggleFiltersBtn.addEventListener("click", () => {
    const shouldShow = filtersCard.classList.contains("hidden");
    filtersCard.classList.toggle("hidden", !shouldShow);
    toggleFiltersBtn.textContent = shouldShow ? "Ocultar filtros" : "Mostrar filtros";
  });

  createOpenBtn.addEventListener("click", () => {
    resetCreateSolicitudForm();
    openModal(createModal);
  });
  createCloseBtn.addEventListener("click", () => {
    resetCreateSolicitudForm();
    closeModal(createModal);
  });
  createCancelBtn.addEventListener("click", () => {
    resetCreateSolicitudForm();
    closeModal(createModal);
  });
  detailCloseBtn.addEventListener("click", () => {
    closeChatDrawer({ syncTab: false });
    closeItemModal();
    closeModal(detailModal);
  });
  detailCancelBtn.addEventListener("click", () => {
    closeChatDrawer({ syncTab: false });
    closeItemModal();
    closeModal(detailModal);
  });
  itemCloseBtn.addEventListener("click", closeItemModal);
  itemCancelBtn.addEventListener("click", closeItemModal);
  closeOnBackdrop(createModal);
  closeOnBackdrop(detailModal);
  closeOnBackdrop(itemModal);
  createModal.addEventListener("click", (event) => {
    if (event.target.matches(".modal-backdrop") || event.target.dataset.close === "true") {
      resetCreateSolicitudForm();
    }
  });

  detailTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setDetailTab(button.dataset.detailTab || "items");
    });
  });

  openChatBtn.addEventListener("click", () => openChatDrawer());
  openChatBtnSecondary.addEventListener("click", () => openChatDrawer());
  chatBackBtn.addEventListener("click", () => closeChatDrawer());
  chatCloseBtn.addEventListener("click", () => closeChatDrawer());
  chatScrim.addEventListener("click", () => closeChatDrawer());

  // Handle pill en móvil — clic cierra el chat
  chatDrawer.querySelector(".chat-drawer-handle")?.addEventListener("click", () => closeChatDrawer());

  // Swipe hacia abajo en el header para cerrar (móvil)
  let _swipeStartY = 0;
  const chatHead = chatDrawer.querySelector(".chat-drawer-head");
  chatHead?.addEventListener("touchstart", (e) => {
    _swipeStartY = e.touches[0].clientY;
  }, { passive: true });
  chatHead?.addEventListener("touchend", (e) => {
    if (e.changedTouches[0].clientY - _swipeStartY > 64) closeChatDrawer();
  }, { passive: true });
  window.addEventListener("popstate", handleChatPopstate);

  createAddItemBtn.addEventListener("click", () => addCreateItem({}, { focus: true }));
  detailAddItemBtn.addEventListener("click", () => {
    if (!isDetailEditable(currentSolicitud)) {
      return;
    }
    fillItemModal({});
  });

  createItemsList.addEventListener("click", (event) => {
    const button = event.target.closest(".solicitud-remove-item-btn");
    if (!button) {
      return;
    }
    const rows = createItemsList.querySelectorAll(".item-row");
    if (rows.length <= 1) {
      return;
    }
    button.closest(".item-row")?.remove();
  });

  detailItemsList.addEventListener("click", async (event) => {
    const button = event.target.closest(".solicitud-configure-item-btn");
    if (!button) {
      return;
    }

    try {
      const card = button.closest(".item-tracking-card");
      const itemId = Number(card?.dataset.itemId || 0);
      const item = (currentSolicitud?.items || []).find((entry) => Number(entry.id) === itemId);
      if (!item) {
        throw new Error("No se pudo cargar el item");
      }
      fillItemModal(item);
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  itemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      itemSaveBtn.disabled = true;
      await saveSolicitudItemFromModal();
    } catch (error) {
      context.showToast(error.message, true);
    } finally {
      itemSaveBtn.disabled = false;
    }
  });

  itemDeleteBtn.addEventListener("click", async () => {
    try {
      itemDeleteBtn.disabled = true;
      await deleteSolicitudItemFromModal();
    } catch (error) {
      context.showToast(error.message, true);
    } finally {
      itemDeleteBtn.disabled = false;
    }
  });

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const items = parseItemsFromContainer(createItemsList);
      const formData = new FormData(createForm);
      const payload = {
        comentario: String(formData.get("comentario") || "").trim(),
        items,
      };

      if (isGlobalRole) {
        const equipoId = Number(formData.get("equipo_id"));
        if (!Number.isInteger(equipoId) || equipoId <= 0) {
          throw new Error("Selecciona un equipo antes de guardar la solicitud");
        }
        payload.equipo_id = equipoId;
      }

      await context.apiRequest("/api/solicitudes", {
        method: "POST",
        body: payload,
      });

      resetCreateSolicitudForm();
      closeModal(createModal);
      await loadSolicitudes();
      context.showToast("Solicitud creada");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const solicitudId = Number(button.dataset.id);

    try {
      if (action === "open-state") {
        activeDetailTab = "estado";
        lastNonChatDetailTab = "estado";
      } else {
        activeDetailTab = "items";
        lastNonChatDetailTab = "items";
      }
      applyDetailTabLayout();
      showDetailLoading(solicitudId);
      openModal(detailModal);
      await loadSolicitudDetail(solicitudId);
    } catch (error) {
      closeModal(detailModal);
      context.showToast(error.message, true);
    }
  });

  mobileList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='open']");
    if (!button) {
      return;
    }

    try {
      const solicitudId = Number(button.dataset.id);
      activeDetailTab = "items";
      lastNonChatDetailTab = "items";
      applyDetailTabLayout();
      showDetailLoading(solicitudId);
      openModal(detailModal);
      await loadSolicitudDetail(solicitudId);
    } catch (error) {
      closeModal(detailModal);
      context.showToast(error.message, true);
    }
  });

  detailStatusActions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-status-value]");
    if (!button || !canManage) {
      return;
    }

    detailStatus.value = button.dataset.statusValue;
    detailStatusActions
      .querySelectorAll(".status-action-btn")
      .forEach((actionButton) =>
        actionButton.classList.toggle("active", actionButton.dataset.statusValue === detailStatus.value)
      );
  });

  deliveryAssistant.addEventListener("click", async (event) => {
    // Navegar a la pestaña de productos (enlace "uno a uno")
    const switchTab = event.target.closest("[data-switch-tab]");
    if (switchTab) {
      setDetailTab(switchTab.dataset.switchTab);
      return;
    }

    // Cancelar confirmación inline
    if (event.target.closest("[data-bulk-cancel]")) {
      deliveryAssistant.querySelector(".bulk-confirm-panel")?.remove();
      return;
    }

    // Confirmar acción masiva desde el panel inline
    const confirmTarget = event.target.closest("[data-bulk-confirm]");
    if (confirmTarget) {
      const targetStatus = confirmTarget.dataset.bulkConfirm;
      confirmTarget.closest(".bulk-confirm-panel")?.remove();
      try {
        await executeBulkSolicitudStatus(targetStatus);
      } catch (error) {
        context.showToast(error.message, true);
      }
      return;
    }

    // Clic en botón de acción masiva: mostrar panel de confirmación inline
    const button = event.target.closest("[data-bulk-status]");
    if (!button || !canManage) {
      return;
    }

    // Toggle: si ya hay panel visible, cerrarlo
    const existing = deliveryAssistant.querySelector(".bulk-confirm-panel");
    if (existing) {
      existing.remove();
      return;
    }

    const targetStatus = button.dataset.bulkStatus;
    const warning = buildBulkStatusWarning(currentSolicitud, targetStatus);
    if (!warning) {
      try {
        await executeBulkSolicitudStatus(targetStatus);
      } catch (error) {
        context.showToast(error.message, true);
      }
      return;
    }

    const panelTitle =
      targetStatus === "ENTREGADO" ? "Confirmar entrega completa" : "Confirmar despacho completo";

    const panel = document.createElement("div");
    panel.className = "bulk-confirm-panel confirm-box";
    panel.innerHTML = `
      <strong>${panelTitle}</strong>
      <p>${warning}</p>
      <div class="actions-inline">
        <button class="action-btn" data-bulk-confirm="${targetStatus}" type="button">Confirmar</button>
        <button class="action-btn secondary" data-bulk-cancel type="button">Cancelar</button>
      </div>
    `;
    const actionsRow = button.closest(".actions-inline");
    if (actionsRow) {
      actionsRow.insertAdjacentElement("afterend", panel);
    } else {
      deliveryAssistant.appendChild(panel);
    }
  });

  saveBtn.addEventListener("click", async () => {
    try {
      await saveSolicitudChanges();
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  processCommentBtn.addEventListener("click", async () => {
    try {
      processCommentBtn.disabled = true;
      await saveProcessComment();
    } catch (error) {
      context.showToast(error.message, true);
    } finally {
      processCommentBtn.disabled = !canProcessComment;
    }
  });

  confirmBtn.addEventListener("click", async () => {
    if (!currentSolicitud) {
      return;
    }

    try {
      await executeBulkSolicitudStatus("ENTREGADO");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  deleteBtn.addEventListener("click", async () => {
    if (!currentSolicitud) {
      return;
    }

    const confirmed = window.confirm(`Desea eliminar la solicitud #${currentSolicitud.id}?`);
    if (!confirmed) {
      return;
    }

    try {
      await context.apiRequest(`/api/solicitudes/${currentSolicitud.id}`, {
        method: "DELETE",
      });
      closeChatDrawer();
      closeModal(detailModal);
      await loadSolicitudes();
      context.showToast("Solicitud eliminada");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  messageImage.addEventListener("change", async () => {
    const file = messageImage.files?.[0];
    if (!file) {
      resetMessageComposer();
      return;
    }

    try {
      const optimized = await optimizeImageFile(file);
      pendingImageData = optimized.dataUrl;
      pendingImageName = optimized.fileName;
      messagePreview.classList.remove("hidden");
      messageRemoveImageBtn.classList.remove("hidden");
      messagePreview.innerHTML = `
        <div class="image-preview-meta">Imagen lista para enviar: ${pendingImageName}</div>
        <img src="${pendingImageData}" alt="${pendingImageName}" class="chat-image preview-image" />
      `;
    } catch (error) {
      resetMessageComposer();
      context.showToast(error.message, true);
    }
  });

  messageRemoveImageBtn.addEventListener("click", () => {
    resetMessageComposer();
  });

  messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentSolicitud) {
      return;
    }

    try {
      await context.apiRequest(`/api/solicitudes/${currentSolicitud.id}/mensajes`, {
        method: "POST",
        body: {
          destinatario_id: destinatarioSelect.value ? Number(destinatarioSelect.value) : undefined,
          mensaje: messageText.value.trim(),
          imagen_nombre: pendingImageName || undefined,
          imagen_data: pendingImageData || undefined,
        },
      });
      await loadSolicitudDetail(currentSolicitud.id, { preserveChat: true });
      openChatDrawer();
      context.showToast("Mensaje enviado");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  messagesList.addEventListener("click", async (event) => {
    const button = event.target.closest(".chat-remove-image-btn");
    if (!button || !currentSolicitud) {
      return;
    }

    const messageId = Number(button.dataset.messageId);
    if (!messageId) {
      return;
    }

    const confirmed = window.confirm("Desea quitar esta imagen del chat?");
    if (!confirmed) {
      return;
    }

    try {
      await context.apiRequest(
        `/api/solicitudes/${currentSolicitud.id}/mensajes/${messageId}/imagen`,
        {
          method: "DELETE",
        }
      );
      await loadSolicitudDetail(currentSolicitud.id, { preserveChat: true });
      openChatDrawer();
      context.showToast("Imagen quitada");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  refreshBtn.addEventListener("click", async () => {
    try {
      await loadSolicitudes();
      context.showToast("Solicitudes actualizadas");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  quickFilters.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-quick-filter]");
    if (!button) {
      return;
    }

    try {
      const quickFilter = button.dataset.quickFilter;
      await applyQuickFilter(quickFilter === "ALL" ? "" : quickFilter);
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  if (window.__fmnSolicitudesResizeHandler) {
    window.removeEventListener("resize", window.__fmnSolicitudesResizeHandler);
  }
  window.__fmnSolicitudesResizeHandler = () => {
    applyDetailTabLayout();
  };
  window.addEventListener("resize", window.__fmnSolicitudesResizeHandler);

  searchInput?.addEventListener("input", () => {
    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }

    searchTimer = window.setTimeout(() => {
      searchText = normalizeSearchValue(searchInput.value);
      renderCurrentSolicitudes();
    }, 120);
  });

  [mobilePrimaryBtn, mobileSecondaryBtn]
    .filter(Boolean)
    .forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await executeRoleAction(button.dataset.roleAction);
        } catch (error) {
          context.showToast(error.message, true);
        }
      });
    });

  filterBtn.addEventListener("click", async () => {
    const formData = new FormData(filterForm);
    filters.estado = String(formData.get("estado") || "");
    filters.fechaDesde = String(formData.get("fechaDesde") || "");
    filters.fechaHasta = String(formData.get("fechaHasta") || "");
    filters.equipoId = String(formData.get("equipoId") || "");

    try {
      await loadSolicitudes();
      context.showToast("Filtros aplicados");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  clearFiltersBtn.addEventListener("click", async () => {
    filterForm.reset();
    filters.estado = "";
    filters.fechaDesde = "";
    filters.fechaHasta = "";
    filters.equipoId = "";

    try {
      await loadSolicitudes();
      context.showToast("Filtros limpiados");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  exportBtn.addEventListener("click", async () => {
    try {
      await downloadSolicitudesExcel(context, filters);
      context.showToast("Excel exportado correctamente");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  if (window.__fmnPendingAutoRefreshId) {
    window.clearInterval(window.__fmnPendingAutoRefreshId);
    window.__fmnPendingAutoRefreshId = null;
  }

  if (window.__fmnSolicitudesRealtimeHandler) {
    window.removeEventListener("fmn:notification", window.__fmnSolicitudesRealtimeHandler);
  }

  window.__fmnSolicitudesRealtimeHandler = (event) => {
    refreshSolicitudesFromRealtime(event.detail);
  };
  window.addEventListener("fmn:notification", window.__fmnSolicitudesRealtimeHandler);

  // Pending items inline events
  inlinePendingToggle?.addEventListener("click", () => {
    const isCollapsed = inlinePendingBody?.classList.toggle("collapsed");
    if (inlinePendingToggle) {
      inlinePendingToggle.textContent = isCollapsed ? "▼" : "▲";
      inlinePendingToggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    }
  });

  inlinePendingRefreshBtn?.addEventListener("click", loadAndRenderPendingItems);
  inlinePendingSearch?.addEventListener("input", () => {
    renderPendingItems(inlinePendingSearch.value.trim());
  });
  inlinePendingList?.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-open-solicitud]");
    if (!btn) return;
    const solicitudId = Number(btn.dataset.openSolicitud);
    if (!solicitudId) return;
    try {
      activeDetailTab = "items";
      lastNonChatDetailTab = "items";
      applyDetailTabLayout();
      showDetailLoading(solicitudId);
      openModal(detailModal);
      await loadSolicitudDetail(solicitudId);
    } catch (err) {
      closeModal(detailModal);
      context.showToast(err.message, true);
    }
  });

  await loadEquiposIfNeeded();
  configureRoleActions();
  resetCreateSolicitudForm();
  await Promise.all([loadSolicitudes(), loadAndRenderPendingItems()]);

  // Auto-refresh pendientes cada 2 minutos
  const pendingAutoRefreshId = window.setInterval(() => {
    loadAndRenderPendingItems().catch(() => {});
  }, 120000);

  // Limpiar intervalo si la vista se destruye (navegacion)
  window.__fmnPendingAutoRefreshId = pendingAutoRefreshId;
}
