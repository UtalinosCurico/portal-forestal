// Vista de consumo por producto. El objetivo concreto es que se pueda mirar un
// periodo y decidir cuanto stock conviene tener de cada cosa.

const NOMBRE_MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function etiquetaMes(clave) {
  const [ano, mes] = String(clave || "").split("-");
  const indice = Number(mes) - 1;
  if (!ano || Number.isNaN(indice) || !NOMBRE_MESES[indice]) {
    return clave || "-";
  }
  return `${NOMBRE_MESES[indice]} ${ano}`;
}

function fechaISO(date) {
  return date.toISOString().slice(0, 10);
}

/** Rango de fechas para los botones de periodo rapido. */
function calcularPeriodo(clave) {
  const hoy = new Date();
  const ano = hoy.getFullYear();
  const mes = hoy.getMonth();

  if (clave === "mes-actual") {
    return { desde: fechaISO(new Date(ano, mes, 1)), hasta: fechaISO(hoy) };
  }
  if (clave === "mes-anterior") {
    return {
      desde: fechaISO(new Date(ano, mes - 1, 1)),
      hasta: fechaISO(new Date(ano, mes, 0)),
    };
  }
  if (clave === "ultimos-3") {
    return { desde: fechaISO(new Date(ano, mes - 2, 1)), hasta: fechaISO(hoy) };
  }
  if (clave === "ultimos-6") {
    return { desde: fechaISO(new Date(ano, mes - 5, 1)), hasta: fechaISO(hoy) };
  }
  if (clave === "ano") {
    return { desde: fechaISO(new Date(ano, 0, 1)), hasta: fechaISO(hoy) };
  }
  return { desde: "", hasta: "" };
}

/** Barras proporcionales para comparar meses de un vistazo, sin librerias. */
function renderBarrasMeses(porMes, meses) {
  if (!meses.length) {
    return "<p class='muted-text'>Sin meses en el periodo.</p>";
  }

  const valores = meses.map((mes) => Number(porMes[mes] || 0));
  const maximo = Math.max(...valores, 1);

  return `
    <div class="reportes-barras">
      ${meses
        .map((mes, i) => {
          const valor = valores[i];
          const alto = Math.round((valor / maximo) * 100);
          return `
            <div class="reportes-barra" title="${escapeHtml(etiquetaMes(mes))}: ${valor}">
              <div class="reportes-barra-valor">${valor}</div>
              <div class="reportes-barra-riel">
                <div class="reportes-barra-relleno" style="height:${alto}%"></div>
              </div>
              <div class="reportes-barra-mes">${escapeHtml(etiquetaMes(mes))}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderDesgloseEquipos(porEquipo) {
  const filas = Object.entries(porEquipo || {}).sort((a, b) => b[1] - a[1]);
  if (!filas.length) {
    return "";
  }
  const total = filas.reduce((acc, [, valor]) => acc + valor, 0) || 1;

  return `
    <div class="reportes-equipos">
      ${filas
        .map(
          ([equipo, valor]) => `
        <div class="reportes-equipo-fila">
          <span class="reportes-equipo-nombre">${escapeHtml(equipo)}</span>
          <span class="reportes-equipo-riel">
            <span class="reportes-equipo-relleno" style="width:${Math.round((valor / total) * 100)}%"></span>
          </span>
          <span class="reportes-equipo-valor">${valor}</span>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function renderVariantes(variantes = []) {
  if (variantes.length <= 1) {
    return "";
  }
  return `
    <div class="reportes-variantes">
      <strong>Se escribio de ${variantes.length} formas distintas:</strong>
      ${variantes
        .map(
          (v) =>
            `<span class="mini-chip">${escapeHtml(v.nombre)} (${v.conteo})</span>`
        )
        .join(" ")}
    </div>
  `;
}

function renderFilas(productos, meses, tbody, filtroTexto = "") {
  const filtro = filtroTexto.trim().toLowerCase();
  const visibles = filtro
    ? productos.filter((p) => p.nombre.toLowerCase().includes(filtro))
    : productos;

  if (!visibles.length) {
    tbody.innerHTML = `<tr><td colspan="5">${
      filtro ? "Ningun producto coincide con la busqueda." : "Sin consumo registrado en el periodo."
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = visibles
    .map((producto) => {
      const unidad = producto.unidad ? ` ${escapeHtml(producto.unidad)}` : "";
      const avisoPocosDatos =
        producto.meses_con_datos <= 1
          ? `<div class="table-subline reportes-aviso">Solo hay ${producto.meses_con_datos} mes con datos: la sugerencia es referencial.</div>`
          : "";

      return `
        <tr class="reportes-row" data-clave="${escapeHtml(producto.clave)}" tabindex="0" role="button">
          <td>
            <strong>${escapeHtml(producto.nombre)}</strong>
            ${
              producto.escrito_de_formas > 1
                ? `<div class="table-subline reportes-aviso">agrupa ${producto.escrito_de_formas} escrituras</div>`
                : ""
            }
          </td>
          <td><strong>${producto.total_unidades}</strong>${unidad}</td>
          <td>${producto.total_solicitudes}</td>
          <td>${producto.promedio_mensual}</td>
          <td>
            <span class="reportes-stock">min <strong>${producto.sugerido_min}</strong> · max <strong>${producto.sugerido_max}</strong></span>
            ${avisoPocosDatos}
          </td>
        </tr>
        <tr class="reportes-detalle hidden" data-detalle="${escapeHtml(producto.clave)}">
          <td colspan="5">
            <div class="reportes-detalle-grid">
              <div>
                <h5>Consumo por mes</h5>
                ${renderBarrasMeses(producto.por_mes, meses)}
              </div>
              <div>
                <h5>Por equipo</h5>
                ${renderDesgloseEquipos(producto.por_equipo) || "<p class='muted-text'>Sin desglose.</p>"}
              </div>
            </div>
            ${renderVariantes(producto.variantes)}
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderDuplicados(sugerencias, card, lista, puedeUnificar) {
  if (!sugerencias.length) {
    card.classList.add("hidden");
    lista.innerHTML = "";
    return;
  }

  card.classList.remove("hidden");
  lista.innerHTML = sugerencias
    .map(
      (s, i) => `
      <div class="reportes-duplicado">
        <span class="reportes-duplicado-par">
          <strong>${escapeHtml(s.nombres[0])}</strong>
          <span class="reportes-duplicado-vs">y</span>
          <strong>${escapeHtml(s.nombres[1])}</strong>
        </span>
        <span class="reportes-duplicado-acciones">
          <span class="mini-chip">${escapeHtml(s.motivo)}</span>
          ${
            puedeUnificar
              ? `<button class="action-btn secondary table-btn" data-unificar="${i}" type="button">Son el mismo</button>`
              : ""
          }
        </span>
      </div>
    `
    )
    .join("");
}

function renderUnificados(alias, card, lista, puedeUnificar) {
  if (!alias.length) {
    card.classList.add("hidden");
    lista.innerHTML = "";
    return;
  }

  card.classList.remove("hidden");
  lista.innerHTML = alias
    .map(
      (a) => `
      <div class="reportes-unificado">
        <span class="reportes-unificado-par">
          <span class="reportes-unificado-variante">${escapeHtml(a.clave_variante)}</span>
          <span class="reportes-unificado-flecha">cuenta como</span>
          <strong>${escapeHtml(a.nombre_canonico || a.clave_canonica)}</strong>
        </span>
        <span class="reportes-duplicado-acciones">
          ${
            a.creado_por_nombre
              ? `<span class="table-subline">${escapeHtml(a.creado_por_nombre)}</span>`
              : ""
          }
          ${
            puedeUnificar
              ? `<button class="action-btn secondary table-btn" data-deshacer="${a.id}" type="button">Deshacer</button>`
              : ""
          }
        </span>
      </div>
    `
    )
    .join("");
}

function construirCSV(productos, meses) {
  const cabecera = [
    "Producto",
    "Unidad",
    "Total pedido",
    "Solicitudes",
    "Promedio mensual",
    "Stock minimo sugerido",
    "Stock maximo sugerido",
    "Escrituras agrupadas",
    ...meses.map((m) => etiquetaMes(m)),
  ];

  const filas = productos.map((p) => [
    p.nombre,
    p.unidad || "",
    p.total_unidades,
    p.total_solicitudes,
    p.promedio_mensual,
    p.sugerido_min,
    p.sugerido_max,
    p.variantes.map((v) => v.nombre).join(" | "),
    ...meses.map((m) => p.por_mes[m] || 0),
  ]);

  const escapar = (valor) => {
    const texto = String(valor ?? "");
    return /[";\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
  };

  // Punto y coma: es lo que espera Excel en configuracion regional chilena.
  return [cabecera, ...filas].map((fila) => fila.map(escapar).join(";")).join("\n");
}

export async function initReportesView(context) {
  const { apiRequest, showToast, state } = context;

  const form = document.getElementById("reportes-filter-form");
  const desdeInput = document.getElementById("reportes-fecha-desde");
  const hastaInput = document.getElementById("reportes-fecha-hasta");
  const equipoSelect = document.getElementById("reportes-equipo-id");
  const equipoField = document.getElementById("reportes-equipo-field");
  const tbody = document.getElementById("reportes-table-body");
  const searchInput = document.getElementById("reportes-search");
  const lastUpdate = document.getElementById("reportes-last-update");
  const quickStrip = document.getElementById("reportes-quick-periodos");
  const duplicadosCard = document.getElementById("reportes-duplicados-card");
  const duplicadosList = document.getElementById("reportes-duplicados-list");
  const unificadosCard = document.getElementById("reportes-unificados-card");
  const unificadosList = document.getElementById("reportes-unificados-list");
  const unificarModal = document.getElementById("reportes-unificar-modal");
  const unificarOpciones = document.getElementById("reportes-unificar-opciones");
  const unificarAviso = document.getElementById("reportes-unificar-aviso");
  const unificarManualBtn = document.getElementById("reportes-unificar-manual-btn");
  const selectA = document.getElementById("reportes-unificar-a");
  const selectB = document.getElementById("reportes-unificar-b");

  const role = state.user?.role || state.user?.rol || "";
  const esRolGlobal = role === "ADMIN" || role === "SUPERVISOR";
  // Unificar cambia los totales de todos, asi que solo los roles de gestion.
  const puedeUnificar = esRolGlobal;

  let datos = { productos: [], periodo: { meses: [] }, posibles_duplicados: [] };
  let aliasGuardados = [];
  let unificacionPendiente = null;

  // Un jefe de faena solo ve su equipo: el selector no le aporta nada.
  if (!esRolGlobal && equipoField) {
    equipoField.classList.add("hidden");
  }

  if (puedeUnificar) {
    unificarManualBtn?.classList.remove("hidden");
  }

  async function cargarEquipos() {
    if (!esRolGlobal || !equipoSelect) {
      return;
    }
    try {
      const respuesta = await apiRequest("/api/equipos");
      const equipos = respuesta.data || respuesta || [];
      equipoSelect.innerHTML = [
        '<option value="">Todos los equipos</option>',
        ...equipos.map(
          (e) =>
            `<option value="${e.id}">${escapeHtml(
              e.nombre_equipo || e.nombre || `Equipo ${e.id}`
            )}</option>`
        ),
      ].join("");
    } catch {
      equipoSelect.innerHTML = '<option value="">Todos los equipos</option>';
    }
  }

  function construirQuery() {
    const params = new URLSearchParams();
    if (desdeInput.value) params.set("fechaDesde", desdeInput.value);
    if (hastaInput.value) params.set("fechaHasta", hastaInput.value);
    if (esRolGlobal && equipoSelect?.value) params.set("equipoId", equipoSelect.value);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  function pintarResumen(payload) {
    document.getElementById("reportes-total-productos").textContent =
      payload.totales.productos_distintos;
    document.getElementById("reportes-total-unidades").textContent =
      payload.totales.unidades;
    document.getElementById("reportes-total-solicitudes").textContent =
      payload.totales.solicitudes;
    document.getElementById("reportes-total-meses").textContent =
      payload.periodo.meses.length;
  }

  async function cargarAlias() {
    if (!puedeUnificar) {
      return;
    }
    try {
      const respuesta = await apiRequest("/api/reportes/alias");
      aliasGuardados = respuesta.data || [];
      renderUnificados(aliasGuardados, unificadosCard, unificadosList, puedeUnificar);
    } catch {
      // Sin unificaciones la vista sigue siendo util: no es un error bloqueante.
      aliasGuardados = [];
    }
  }

  async function cargar() {
    tbody.innerHTML = '<tr><td colspan="5">Calculando consumo...</td></tr>';
    try {
      const respuesta = await apiRequest(`/api/reportes/consumo${construirQuery()}`);
      datos = respuesta.data;
      pintarResumen(datos);
      renderFilas(datos.productos, datos.periodo.meses, tbody, searchInput.value);
      renderDuplicados(
        datos.posibles_duplicados,
        duplicadosCard,
        duplicadosList,
        puedeUnificar
      );
      lastUpdate.textContent = `Actualizado ${new Date().toLocaleTimeString("es-CL", {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;
      showToast(error.message, true);
    }
  }

  /** Llena los dos selectores con los productos del periodo cargado. */
  function poblarSelectoresProductos(claveA, claveB) {
    const opciones = datos.productos
      .map(
        (p) =>
          `<option value="${escapeHtml(p.clave)}">${escapeHtml(p.nombre)} (${p.total_unidades})</option>`
      )
      .join("");

    selectA.innerHTML = opciones;
    selectB.innerHTML = opciones;
    if (claveA) selectA.value = claveA;
    if (claveB) selectB.value = claveB;

    // Si no vino un par sugerido, dejamos el segundo distinto del primero para
    // que la ventana no abra proponiendo unir algo consigo mismo.
    if (!claveB && datos.productos.length > 1 && selectB.value === selectA.value) {
      selectB.selectedIndex = selectA.selectedIndex === 0 ? 1 : 0;
    }
  }

  /** Radios para elegir con que nombre queda el producto unificado. */
  function renderOpcionesNombre() {
    const a = datos.productos.find((p) => p.clave === selectA.value);
    const b = datos.productos.find((p) => p.clave === selectB.value);
    const confirmar = document.getElementById("reportes-unificar-confirm");

    if (!a || !b || a.clave === b.clave) {
      unificarOpciones.innerHTML = "";
      unificarAviso.textContent = "Elige dos productos distintos.";
      confirmar.disabled = true;
      return;
    }

    unificarAviso.textContent = `Quedaran juntos: ${a.total_unidades + b.total_unidades} unidades en total.`;
    confirmar.disabled = false;

    unificarOpciones.innerHTML = [a, b]
      .map(
        (p, i) => `
        <label class="reportes-unificar-opcion">
          <input type="radio" name="reportes-canonico" value="${escapeHtml(p.clave)}" ${
            i === 0 ? "checked" : ""
          } />
          <span>
            <strong>${escapeHtml(p.nombre)}</strong>
            <span class="table-subline">Se queda con este nombre (${p.total_unidades} unidades hoy)</span>
          </span>
        </label>
      `
      )
      .join("");
  }

  function abrirModalUnificar(claveA = "", claveB = "") {
    if (!datos.productos.length) {
      showToast("No hay productos en el periodo para unificar", true);
      return;
    }
    if (datos.productos.length < 2) {
      showToast("Se necesitan al menos dos productos para unificar", true);
      return;
    }

    poblarSelectoresProductos(claveA, claveB);
    renderOpcionesNombre();
    unificarModal.classList.remove("hidden");
  }

  function cerrarModalUnificar() {
    unificarModal.classList.add("hidden");
    unificacionPendiente = null;
  }

  async function confirmarUnificacion() {
    const claveCanonica = unificarOpciones.querySelector(
      'input[name="reportes-canonico"]:checked'
    )?.value;
    if (!claveCanonica) {
      return;
    }

    // La que no quedo elegida es la que se absorbe.
    const claveVariante =
      selectA.value === claveCanonica ? selectB.value : selectA.value;
    const canonico = datos.productos.find((p) => p.clave === claveCanonica);

    try {
      await apiRequest("/api/reportes/alias", {
        method: "POST",
        body: {
          claveVariante,
          claveCanonica,
          nombreCanonico: canonico?.nombre || claveCanonica,
        },
      });
      cerrarModalUnificar();
      showToast("Productos unificados");
      await Promise.all([cargar(), cargarAlias()]);
    } catch (error) {
      showToast(error.message, true);
    }
  }

  duplicadosList.addEventListener("click", (event) => {
    const boton = event.target.closest("[data-unificar]");
    if (!boton) return;
    const sugerencia = datos.posibles_duplicados[Number(boton.dataset.unificar)];
    if (sugerencia) abrirModalUnificar(sugerencia.claves[0], sugerencia.claves[1]);
  });

  selectA.addEventListener("change", renderOpcionesNombre);
  selectB.addEventListener("change", renderOpcionesNombre);
  unificarManualBtn?.addEventListener("click", () => abrirModalUnificar());

  unificadosList.addEventListener("click", async (event) => {
    const boton = event.target.closest("[data-deshacer]");
    if (!boton) return;
    if (!window.confirm("Deshacer esta unificacion? Los productos volveran a contarse por separado.")) {
      return;
    }
    try {
      await apiRequest(`/api/reportes/alias/${boton.dataset.deshacer}`, { method: "DELETE" });
      showToast("Unificacion deshecha");
      await Promise.all([cargar(), cargarAlias()]);
    } catch (error) {
      showToast(error.message, true);
    }
  });

  document.getElementById("reportes-unificar-close").addEventListener("click", cerrarModalUnificar);
  document.getElementById("reportes-unificar-cancel").addEventListener("click", cerrarModalUnificar);
  document.getElementById("reportes-unificar-confirm").addEventListener("click", confirmarUnificacion);
  unificarModal.addEventListener("click", (event) => {
    if (event.target.dataset.close === "true") cerrarModalUnificar();
  });

  quickStrip?.addEventListener("click", (event) => {
    const boton = event.target.closest("[data-periodo]");
    if (!boton) return;
    quickStrip.querySelectorAll(".quick-tile").forEach((t) => t.classList.remove("active"));
    boton.classList.add("active");
    const { desde, hasta } = calcularPeriodo(boton.dataset.periodo);
    desdeInput.value = desde;
    hastaInput.value = hasta;
    cargar();
  });

  // Abrir el desglose de un producto.
  tbody.addEventListener("click", (event) => {
    const fila = event.target.closest(".reportes-row");
    if (!fila) return;
    const detalle = tbody.querySelector(`[data-detalle="${CSS.escape(fila.dataset.clave)}"]`);
    detalle?.classList.toggle("hidden");
    fila.classList.toggle("abierta");
  });

  tbody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const fila = event.target.closest(".reportes-row");
    if (!fila || event.target !== fila) return;
    event.preventDefault();
    fila.click();
  });

  searchInput.addEventListener("input", () => {
    renderFilas(datos.productos, datos.periodo.meses, tbody, searchInput.value);
  });

  document.getElementById("reportes-filter-btn").addEventListener("click", cargar);
  document.getElementById("reportes-refresh-btn").addEventListener("click", cargar);

  document.getElementById("reportes-clear-btn").addEventListener("click", () => {
    form.reset();
    quickStrip?.querySelectorAll(".quick-tile").forEach((t) => t.classList.remove("active"));
    cargar();
  });

  document.getElementById("reportes-export-btn").addEventListener("click", () => {
    if (!datos.productos.length) {
      showToast("No hay datos para descargar", true);
      return;
    }
    // BOM para que Excel respete las tildes.
    const contenido = `﻿${construirCSV(datos.productos, datos.periodo.meses)}`;
    const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = `consumo_${desdeInput.value || "inicio"}_${hastaInput.value || "hoy"}.csv`;
    enlace.click();
    URL.revokeObjectURL(url);
    showToast("Archivo descargado");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    cargar();
  });

  await cargarEquipos();

  // Por defecto se muestran los ultimos 3 meses: da contexto suficiente para
  // ver una tendencia sin abrumar con historia antigua.
  const inicial = calcularPeriodo("ultimos-3");
  desdeInput.value = inicial.desde;
  hastaInput.value = inicial.hasta;

  await Promise.all([cargar(), cargarAlias()]);
}
