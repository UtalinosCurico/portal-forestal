// Vista de consumo por producto.
//
// Dividida en tres pestanas porque cumplen roles distintos: Resumen es lo que
// se mira siempre, Detalle es para buscar un producto puntual, y Nombres es
// mantencion que no deberia estorbar el uso diario.

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fechaISO(date) {
  return date.toISOString().slice(0, 10);
}

function calcularPeriodo(clave) {
  const hoy = new Date();
  const ano = hoy.getFullYear();
  const mes = hoy.getMonth();

  const rangos = {
    "mes-actual": [new Date(ano, mes, 1), hoy],
    "mes-anterior": [new Date(ano, mes - 1, 1), new Date(ano, mes, 0)],
    "ultimos-3": [new Date(ano, mes - 2, 1), hoy],
    "ultimos-6": [new Date(ano, mes - 5, 1), hoy],
    ano: [new Date(ano, 0, 1), hoy],
  };

  const rango = rangos[clave];
  return rango ? { desde: fechaISO(rango[0]), hasta: fechaISO(rango[1]) } : { desde: "", hasta: "" };
}

/**
 * Linea de media movil sobre las barras. Se dibuja como SVG que se estira al
 * ancho del contenedor, asi queda alineada con las barras sin depender de
 * medir posiciones en pixeles.
 */
function renderLineaMediaMovil(mediaMovil, maximo) {
  if (!mediaMovil?.length || mediaMovil.length < 2) {
    return "";
  }

  const paso = 100 / mediaMovil.length;
  const puntos = mediaMovil
    .map((valor, i) => {
      const x = paso * i + paso / 2;
      const y = 100 - Math.min(100, (valor / maximo) * 100);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return `
    <svg class="reportes-linea-media" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${puntos}" />
    </svg>
  `;
}

/**
 * Barras verticales de evolucion, con la media movil encima para ver la
 * tendencia de fondo. Marca el periodo incompleto para que nadie lea una caida
 * donde solo faltan dias por transcurrir.
 *
 * @param {number[]} serie valores alineados a periodo.claves
 */
function renderBarras(serie, periodo, mediaMovil = null) {
  const { claves, etiquetas, incompleto } = periodo;

  if (!claves.length || !serie?.length) {
    return "<p class='muted-text'>Sin movimiento en este periodo.</p>";
  }

  const valores = serie.map((v) => Number(v) || 0);
  const maximo = Math.max(...valores, ...(mediaMovil || []), 1);

  return `
    <div class="reportes-barras-wrap">
      ${mediaMovil ? renderLineaMediaMovil(mediaMovil, maximo) : ""}
      <div class="reportes-barras">
        ${claves
          .map((clave, i) => {
            const valor = valores[i];
            const alto = Math.round((valor / maximo) * 100);
            const esIncompleto = clave === incompleto;
            return `
              <div class="reportes-barra ${esIncompleto ? "incompleta" : ""}"
                   title="${escapeHtml(etiquetas[i])}: ${valor}${esIncompleto ? " (aun no termina)" : ""}">
                <div class="reportes-barra-valor">${valor}</div>
                <div class="reportes-barra-riel">
                  <div class="reportes-barra-relleno" style="height:${alto}%"></div>
                </div>
                <div class="reportes-barra-mes">${escapeHtml(etiquetas[i])}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderTopProductos(productos, contenedor, limite = 7) {
  const top = productos.slice(0, limite);

  if (!top.length) {
    contenedor.innerHTML = "<p class='muted-text'>Sin consumo en el periodo.</p>";
    return;
  }

  const maximo = top[0].total_unidades || 1;
  const totalGeneral = productos.reduce((acc, p) => acc + p.total_unidades, 0) || 1;

  contenedor.innerHTML = top
    .map((p) => {
      const porcentaje = Math.round((p.total_unidades / totalGeneral) * 100);
      return `
        <div class="reportes-top-fila" title="${escapeHtml(p.nombre)}: ${p.total_unidades} (${porcentaje}% del total)">
          <span class="reportes-top-nombre">${escapeHtml(p.nombre)}</span>
          <span class="reportes-top-riel">
            <span class="reportes-top-relleno" style="width:${Math.max(2, Math.round((p.total_unidades / maximo) * 100))}%"></span>
          </span>
          <span class="reportes-top-valor">${p.total_unidades}</span>
        </div>
      `;
    })
    .join("");
}

function renderDesgloseEquipos(porEquipo) {
  const filas = Object.entries(porEquipo || {}).sort((a, b) => b[1] - a[1]);
  if (!filas.length) return "";
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
  if (variantes.length <= 1) return "";
  return `
    <div class="reportes-variantes">
      <strong>Se escribio de ${variantes.length} formas distintas:</strong>
      ${variantes
        .map((v) => `<span class="mini-chip">${escapeHtml(v.nombre)} (${v.conteo})</span>`)
        .join(" ")}
    </div>
  `;
}

function chipRegularidad(regularidad = {}) {
  return `<span class="reportes-chip nivel-${escapeHtml(regularidad.nivel || "")}">${escapeHtml(
    regularidad.etiqueta || ""
  )}</span>`;
}

/** Cuanto se estima para el proximo periodo, con su nivel de confianza. */
function celdaProyeccion(proyeccion) {
  if (!proyeccion) {
    return '<span class="muted-text">Sin historial</span>';
  }
  return `
    <span class="reportes-proyeccion">
      <strong>~${proyeccion.valor}</strong>
      <span class="reportes-chip confianza-${escapeHtml(proyeccion.confianza.nivel)}">${escapeHtml(
        proyeccion.confianza.etiqueta
      )}</span>
    </span>
  `;
}

function chipTendencia(tendencia = {}) {
  const flechas = { sube: "▲", baja: "▼", estable: "=", sin_datos: "" };
  return `<span class="reportes-chip dir-${escapeHtml(tendencia.direccion || "")}">${
    flechas[tendencia.direccion] || ""
  } ${escapeHtml(tendencia.etiqueta || "")}</span>`;
}

function renderAtipicos(atipicos, card, lista) {
  if (!atipicos.length) {
    card.classList.add("hidden");
    lista.innerHTML = "";
    return;
  }

  card.classList.remove("hidden");
  lista.innerHTML = atipicos
    .map(
      (a) => `
      <div class="reportes-atipico">
        <div class="reportes-atipico-principal">
          <strong>${escapeHtml(a.producto)}</strong>
          <span class="reportes-atipico-meta">
            ${escapeHtml(a.fecha_corta)} · solicitud #${a.solicitud_id} · ${escapeHtml(a.equipo)}
          </span>
        </div>
        <div class="reportes-atipico-cifras">
          <span class="reportes-atipico-cantidad">${a.cantidad}</span>
          <span class="reportes-atipico-comparacion">
            lo normal es ${a.valor_tipico}${a.veces_lo_tipico ? ` · ${a.veces_lo_tipico}x` : ""}
          </span>
        </div>
      </div>
    `
    )
    .join("");
}

function renderTarjetasMovil(visibles, periodo, lista) {
  lista.innerHTML = visibles
    .map(
      (p) => `
      <article class="reportes-card" data-clave="${escapeHtml(p.clave)}" tabindex="0" role="button">
        <div class="reportes-card-head">
          <div>
            <strong class="reportes-card-nombre">${escapeHtml(p.nombre)}</strong>
            ${
              p.escrito_de_formas > 1
                ? `<div class="table-subline reportes-aviso">agrupa ${p.escrito_de_formas} escrituras</div>`
                : ""
            }
          </div>
          <span class="reportes-card-total">
            ${p.total_unidades}<small>${p.unidad ? ` ${escapeHtml(p.unidad)}` : ""}</small>
          </span>
        </div>
        <div class="reportes-card-datos">
          <span><em>Tipico</em> ${p.tipico}</span>
          <span><em>Stock</em> ${p.sugerido_min} a ${p.sugerido_max}</span>
          <span><em>Solicitudes</em> ${p.total_solicitudes}</span>
        </div>
        <div class="reportes-card-chips">
          ${chipRegularidad(p.regularidad)}
          ${chipTendencia(p.tendencia)}
          ${p.atipicos ? `<span class="reportes-chip alerta">${p.atipicos} a revisar</span>` : ""}
        </div>
        <div class="reportes-card-detalle hidden">
          <h5>Evolucion</h5>
          ${renderBarras(p.serie, periodo)}
          <h5>Por equipo</h5>
          ${renderDesgloseEquipos(p.por_equipo) || "<p class='muted-text'>Sin desglose.</p>"}
          ${renderVariantes(p.variantes)}
        </div>
        <span class="reportes-card-hint">Toca para ver el detalle</span>
      </article>
    `
    )
    .join("");
}

function renderFilas(productos, periodo, tbody, filtroTexto, mobileList) {
  const filtro = filtroTexto.trim().toLowerCase();
  const visibles = filtro
    ? productos.filter((p) => p.nombre.toLowerCase().includes(filtro))
    : productos;

  if (!visibles.length) {
    // Estado vacio con salida: decir que pasa y que hacer, no solo "sin datos".
    const vacio = filtro
      ? `<div class="reportes-vacio">
           <strong>Ningun producto coincide con "${escapeHtml(filtro)}"</strong>
           <p class="muted-text">Prueba con parte del nombre, o revisa si se escribio distinto en las solicitudes.</p>
         </div>`
      : `<div class="reportes-vacio">
           <strong>No hubo pedidos en este periodo</strong>
           <p class="muted-text">Elige un rango de fechas mas amplio, o quita el filtro por equipo.</p>
         </div>`;

    tbody.innerHTML = `<tr><td colspan="6">${vacio}</td></tr>`;
    if (mobileList) mobileList.innerHTML = vacio;
    return;
  }

  if (mobileList) renderTarjetasMovil(visibles, periodo, mobileList);

  tbody.innerHTML = visibles
    .map((p) => {
      const unidad = p.unidad ? ` ${escapeHtml(p.unidad)}` : "";
      const pocosDatos =
        p.periodos_con_consumo <= 1
          ? `<div class="table-subline reportes-aviso">Solo ${p.periodos_con_consumo} periodo con consumo: referencial.</div>`
          : "";

      return `
        <tr class="reportes-row" data-clave="${escapeHtml(p.clave)}" tabindex="0" role="button">
          <td>
            <strong>${escapeHtml(p.nombre)}</strong>
            ${
              p.escrito_de_formas > 1
                ? `<div class="table-subline reportes-aviso">agrupa ${p.escrito_de_formas} escrituras</div>`
                : ""
            }
          </td>
          <td><strong>${p.total_unidades}</strong>${unidad}</td>
          <td>${p.tipico}</td>
          <td>
            <span class="reportes-stock">${p.sugerido_min} a <strong>${p.sugerido_max}</strong></span>
            ${pocosDatos}
          </td>
          <td>${celdaProyeccion(p.proyeccion)}</td>
          <td>
            ${chipRegularidad(p.regularidad)}
            ${chipTendencia(p.tendencia)}
            ${p.atipicos ? `<span class="reportes-chip alerta">${p.atipicos} a revisar</span>` : ""}
          </td>
        </tr>
        <tr class="reportes-detalle hidden" data-detalle="${escapeHtml(p.clave)}">
          <td colspan="6">
            <div class="reportes-detalle-grid">
              <div>
                <h5>Evolucion</h5>
                ${renderBarras(p.serie, periodo)}
              </div>
              <div>
                <h5>Por equipo</h5>
                ${renderDesgloseEquipos(p.por_equipo) || "<p class='muted-text'>Sin desglose.</p>"}
              </div>
            </div>
            ${renderVariantes(p.variantes)}
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderDuplicados(sugerencias, lista, puedeUnificar) {
  if (!sugerencias.length) {
    lista.innerHTML = `
      <div class="reportes-vacio ok">
        <strong>Nada pendiente por revisar</strong>
        <p class="muted-text">
          No se detectaron nombres parecidos que pudieran ser el mismo producto.
        </p>
      </div>`;
    return;
  }

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
          ${a.creado_por_nombre ? `<span class="table-subline">${escapeHtml(a.creado_por_nombre)}</span>` : ""}
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

async function descargarExcel(context, query) {
  const response = await fetch(`/api/reportes/excel/consumo${query}`, {
    headers: { Authorization: `Bearer ${context.state.token}` },
  });

  if (!response.ok) {
    let mensaje = "No se pudo generar el Excel";
    try {
      const payload = await response.json();
      mensaje = payload.mensaje || payload.error?.message || mensaje;
    } catch {
      // Respuesta no JSON: se queda el mensaje generico.
    }
    throw new Error(mensaje);
  }

  const blob = await response.blob();
  const nombre =
    response.headers.get("content-disposition")?.split("filename=")?.at(1)?.replaceAll('"', "") ||
    "consumo.xlsx";

  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

export async function initReportesView(context) {
  const { apiRequest, showToast, state } = context;

  const el = (id) => document.getElementById(id);

  const form = el("reportes-filter-form");
  const desdeInput = el("reportes-fecha-desde");
  const hastaInput = el("reportes-fecha-hasta");
  const equipoSelect = el("reportes-equipo-id");
  const equipoField = el("reportes-equipo-field");
  const tbody = el("reportes-table-body");
  const mobileList = el("reportes-mobile-list");
  const topProductos = el("reportes-top-productos");
  const tendenciaBox = el("reportes-tendencia");
  const searchInput = el("reportes-search");
  const quickStrip = el("reportes-quick-periodos");
  const duplicadosList = el("reportes-duplicados-list");
  const unificadosCard = el("reportes-unificados-card");
  const unificadosList = el("reportes-unificados-list");
  const unificarModal = el("reportes-unificar-modal");
  const unificarOpciones = el("reportes-unificar-opciones");
  const unificarAviso = el("reportes-unificar-aviso");
  const unificarManualBtn = el("reportes-unificar-manual-btn");
  const selectA = el("reportes-unificar-a");
  const selectB = el("reportes-unificar-b");
  const atipicosCard = el("reportes-atipicos-card");
  const atipicosList = el("reportes-atipicos-list");
  const tabs = el("reportes-tabs");
  const nombresBadge = el("reportes-tab-nombres-badge");

  const role = state.user?.role || state.user?.rol || "";
  const esRolGlobal = role === "ADMIN" || role === "SUPERVISOR";
  const puedeUnificar = esRolGlobal;

  let datos = {
    productos: [],
    periodo: { claves: [], etiquetas: [], agrupacion: "mes" },
    posibles_duplicados: [],
    atipicos: [],
  };
  let aliasGuardados = [];
  let agrupacion = "mes";

  if (!esRolGlobal && equipoField) equipoField.classList.add("hidden");
  if (puedeUnificar) unificarManualBtn?.classList.remove("hidden");

  // ── Pestanas ──────────────────────────────────────────────────────────
  tabs.addEventListener("click", (event) => {
    const boton = event.target.closest("[data-tab]");
    if (!boton) return;
    tabs.querySelectorAll(".reportes-tab").forEach((t) => t.classList.remove("active"));
    boton.classList.add("active");
    document.querySelectorAll(".reportes-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== boton.dataset.tab);
    });
  });

  // ── Carga ─────────────────────────────────────────────────────────────
  async function cargarEquipos() {
    if (!esRolGlobal || !equipoSelect) return;
    try {
      const respuesta = await apiRequest("/api/equipos");
      const equipos = respuesta.data || respuesta || [];
      equipoSelect.innerHTML = [
        '<option value="">Todos los equipos</option>',
        ...equipos.map(
          (e) =>
            `<option value="${e.id}">${escapeHtml(e.nombre_equipo || e.nombre || `Equipo ${e.id}`)}</option>`
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
    params.set("agrupacion", agrupacion);
    return `?${params.toString()}`;
  }

  function pintarResumen() {
    el("reportes-total-unidades").textContent = datos.totales.unidades;
    el("reportes-total-productos").textContent = datos.totales.productos_distintos;
    el("reportes-total-solicitudes").textContent = datos.totales.solicitudes;
    el("reportes-total-atipicos").textContent = datos.totales.pedidos_atipicos;

    el("reportes-kpi-atipicos").classList.toggle(
      "con-alerta",
      datos.totales.pedidos_atipicos > 0
    );
    el("reportes-tendencia-general").innerHTML = chipTendencia(datos.tendencia_general);

    const unidad = agrupacion === "semana" ? "semana" : "mes";
    el("reportes-tendencia-titulo").textContent = `Consumo total por ${unidad}`;
    el("reportes-th-tipico").textContent = `Tipico por ${unidad}`;
    el("reportes-th-proyeccion").textContent = `Proxima ${unidad}`.replace(
      "Proxima mes",
      "Proximo mes"
    );

    // Proyeccion general del proximo periodo.
    const proy = datos.proyeccion_general;
    el("reportes-proyeccion-label").textContent =
      unidad === "semana" ? "Proxima semana" : "Proximo mes";
    el("reportes-proyeccion-valor").textContent = proy ? `~${proy.valor}` : "-";
    el("reportes-proyeccion-confianza").textContent = proy
      ? `${proy.confianza.etiqueta} · media movil de ${proy.ventana}`
      : "Sin historial suficiente";

    const avisoIncompleto = el("reportes-aviso-incompleto");
    if (datos.periodo.incompleto) {
      avisoIncompleto.textContent = `"${datos.periodo.etiqueta_incompleto}" aun no termina. Se muestra, pero no se usa para calcular tendencia ni stock.`;
      avisoIncompleto.classList.remove("hidden");
    } else {
      avisoIncompleto.classList.add("hidden");
    }

    const cantidad = datos.periodo.claves.length;
    const plural = cantidad === 1 ? unidad : unidad === "mes" ? "meses" : "semanas";
    el("reportes-rango-texto").textContent =
      `${cantidad} ${plural} · ${datos.totales.unidades} unidades · ` +
      `${datos.totales.productos_distintos} productos`;

    const pendientes = datos.posibles_duplicados.length;
    nombresBadge.textContent = pendientes;
    nombresBadge.classList.toggle("hidden", pendientes === 0);
  }

  async function cargarAlias() {
    if (!puedeUnificar) return;
    try {
      const respuesta = await apiRequest("/api/reportes/alias");
      aliasGuardados = respuesta.data || [];
      renderUnificados(aliasGuardados, unificadosCard, unificadosList, puedeUnificar);
    } catch {
      aliasGuardados = [];
    }
  }

  async function cargar() {
    tbody.innerHTML = '<tr><td colspan="6">Calculando consumo...</td></tr>';
    try {
      const respuesta = await apiRequest(`/api/reportes/consumo${construirQuery()}`);
      datos = respuesta.data;
      pintarResumen();
      renderTopProductos(datos.productos, topProductos);
      tendenciaBox.innerHTML = renderBarras(datos.serie_general, datos.periodo, datos.media_movil);
      renderAtipicos(datos.atipicos, atipicosCard, atipicosList);
      renderFilas(datos.productos, datos.periodo, tbody, searchInput.value, mobileList);
      renderDuplicados(datos.posibles_duplicados, duplicadosList, puedeUnificar);
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;
      showToast(error.message, true);
    }
  }

  // ── Filtros ───────────────────────────────────────────────────────────
  quickStrip.addEventListener("click", (event) => {
    const boton = event.target.closest("[data-periodo]");
    if (!boton) return;
    quickStrip.querySelectorAll(".periodo-chip").forEach((t) => t.classList.remove("active"));
    boton.classList.add("active");
    const { desde, hasta } = calcularPeriodo(boton.dataset.periodo);
    desdeInput.value = desde;
    hastaInput.value = hasta;
    cargar();
  });

  document.querySelectorAll("[data-agrupacion]").forEach((boton) => {
    boton.addEventListener("click", () => {
      agrupacion = boton.dataset.agrupacion;
      document
        .querySelectorAll("[data-agrupacion]")
        .forEach((b) => b.classList.toggle("active", b === boton));
      cargar();
    });
  });

  el("reportes-filter-btn").addEventListener("click", cargar);
  el("reportes-refresh-btn").addEventListener("click", cargar);
  el("reportes-clear-btn").addEventListener("click", () => {
    form.reset();
    quickStrip.querySelectorAll(".periodo-chip").forEach((t) => t.classList.remove("active"));
    cargar();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    cargar();
  });

  el("reportes-excel-btn").addEventListener("click", async () => {
    try {
      await descargarExcel(context, construirQuery());
      showToast("Excel descargado");
    } catch (error) {
      showToast(error.message, true);
    }
  });

  // ── Detalle ───────────────────────────────────────────────────────────
  searchInput.addEventListener("input", () => {
    renderFilas(datos.productos, datos.periodo, tbody, searchInput.value, mobileList);
  });

  tbody.addEventListener("click", (event) => {
    const fila = event.target.closest(".reportes-row");
    if (!fila) return;
    tbody.querySelector(`[data-detalle="${CSS.escape(fila.dataset.clave)}"]`)?.classList.toggle("hidden");
    fila.classList.toggle("abierta");
  });

  tbody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const fila = event.target.closest(".reportes-row");
    if (!fila || event.target !== fila) return;
    event.preventDefault();
    fila.click();
  });

  mobileList.addEventListener("click", (event) => {
    const card = event.target.closest(".reportes-card");
    if (!card) return;
    card.querySelector(".reportes-card-detalle")?.classList.toggle("hidden");
    card.classList.toggle("abierta");
  });

  // ── Unificar nombres ──────────────────────────────────────────────────
  function poblarSelectores(claveA, claveB) {
    const opciones = datos.productos
      .map(
        (p) => `<option value="${escapeHtml(p.clave)}">${escapeHtml(p.nombre)} (${p.total_unidades})</option>`
      )
      .join("");

    selectA.innerHTML = opciones;
    selectB.innerHTML = opciones;
    if (claveA) selectA.value = claveA;
    if (claveB) selectB.value = claveB;

    if (!claveB && datos.productos.length > 1 && selectB.value === selectA.value) {
      selectB.selectedIndex = selectA.selectedIndex === 0 ? 1 : 0;
    }
  }

  function renderOpcionesNombre() {
    const a = datos.productos.find((p) => p.clave === selectA.value);
    const b = datos.productos.find((p) => p.clave === selectB.value);
    const confirmar = el("reportes-unificar-confirm");

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
          <input type="radio" name="reportes-canonico" value="${escapeHtml(p.clave)}" ${i === 0 ? "checked" : ""} />
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
    if (datos.productos.length < 2) {
      showToast("Se necesitan al menos dos productos para unificar", true);
      return;
    }
    poblarSelectores(claveA, claveB);
    renderOpcionesNombre();
    unificarModal.classList.remove("hidden");
  }

  function cerrarModalUnificar() {
    unificarModal.classList.add("hidden");
  }

  async function confirmarUnificacion() {
    const claveCanonica = unificarOpciones.querySelector(
      'input[name="reportes-canonico"]:checked'
    )?.value;
    if (!claveCanonica) return;

    const claveVariante = selectA.value === claveCanonica ? selectB.value : selectA.value;
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

  selectA.addEventListener("change", renderOpcionesNombre);
  selectB.addEventListener("change", renderOpcionesNombre);
  unificarManualBtn?.addEventListener("click", () => abrirModalUnificar());
  el("reportes-unificar-close").addEventListener("click", cerrarModalUnificar);
  el("reportes-unificar-cancel").addEventListener("click", cerrarModalUnificar);
  el("reportes-unificar-confirm").addEventListener("click", confirmarUnificacion);
  unificarModal.addEventListener("click", (event) => {
    if (event.target.dataset.close === "true") cerrarModalUnificar();
  });

  // ── Arranque ──────────────────────────────────────────────────────────
  await cargarEquipos();

  const inicial = calcularPeriodo("ultimos-3");
  desdeInput.value = inicial.desde;
  hastaInput.value = inicial.hasta;

  await Promise.all([cargar(), cargarAlias()]);
}
