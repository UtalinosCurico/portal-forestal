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
// Ancho minimo para que una barra siga siendo legible. Con 31 semanas en el
// ancho de la tarjeta quedaban de 17px: ilegibles y con las fechas partidas en
// tres lineas. Por debajo de esto el grafico se desplaza de lado en vez de
// seguir apretando.
const ANCHO_MINIMO_BARRA = 46;

/**
 * Con muchos periodos las fechas se pisan unas con otras. Se muestra una de
 * cada N -siempre la primera y la ultima- para que se lean, sin perder barras.
 */
function pasoEtiquetas(cantidad) {
  if (cantidad <= 8) return 1;
  if (cantidad <= 16) return 2;
  if (cantidad <= 28) return 3;
  return Math.ceil(cantidad / 10);
}

function renderBarras(serie, periodo, mediaMovil = null) {
  const { claves, etiquetas, incompleto } = periodo;

  if (!claves.length || !serie?.length) {
    return "<p class='muted-text'>Sin movimiento en este período.</p>";
  }

  const valores = serie.map((v) => Number(v) || 0);
  const maximo = Math.max(...valores, ...(mediaMovil || []), 1);
  const paso = pasoEtiquetas(claves.length);
  const anchoInterior = claves.length * ANCHO_MINIMO_BARRA;

  return `
    <div class="reportes-barras-scroll">
      <div class="reportes-barras-wrap" style="min-width:${anchoInterior}px">
        ${mediaMovil ? renderLineaMediaMovil(mediaMovil, maximo) : ""}
        <div class="reportes-barras">
          ${claves
            .map((clave, i) => {
              const valor = valores[i];
              const alto = Math.round((valor / maximo) * 100);
              const esIncompleto = clave === incompleto;
              // La primera y la ultima siempre se rotulan: dan el rango de un vistazo.
              const mostrarEtiqueta =
                i % paso === 0 || i === claves.length - 1 || claves.length <= 8;
              return `
                <div class="reportes-barra ${esIncompleto ? "incompleta" : ""}"
                     title="${escapeHtml(etiquetas[i])}: ${valor}${esIncompleto ? " (aun no termina)" : ""}">
                  <div class="reportes-barra-valor">${paso > 2 && !mostrarEtiqueta ? "" : valor}</div>
                  <div class="reportes-barra-riel">
                    <div class="reportes-barra-relleno" style="height:${alto}%"></div>
                  </div>
                  <div class="reportes-barra-mes">${
                    mostrarEtiqueta ? escapeHtml(etiquetas[i]) : ""
                  }</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </div>
    ${
      claves.length > 10
        ? `<p class="reportes-hint-scroll">${claves.length} periodos — arrastra de lado para ver todos.</p>`
        : ""
    }
  `;
}

function renderTopProductos(productos, contenedor, limite = 7) {
  const top = productos.slice(0, limite);

  if (!top.length) {
    contenedor.innerHTML = "<p class='muted-text'>Sin consumo en el período.</p>";
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
            <span class="reportes-top-relleno" style="width:4%"></span>
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
  return `<span class="reportes-chip nivel-0">${escapeHtml(
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
      <span class="reportes-chip confianza-1">${escapeHtml(
        proyeccion.confianza.etiqueta
      )}</span>
    </span>
  `;
}

function chipTendencia(tendencia = {}) {
  const flechas = { sube: "▲", baja: "▼", estable: "=", sin_datos: "" };
  return `<span class="reportes-chip dir-0">${
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

/** Aviso honesto cuando un analisis no tiene datos suficientes. */
function renderSinDatos(mensaje) {
  return `
    <div class="reportes-vacio">
      <strong>Todavia no hay datos suficientes</strong>
      <p class="muted-text">${escapeHtml(mensaje)}</p>
    </div>`;
}

function renderAsociados(asociados, contenedor) {
  if (!asociados?.disponible) {
    contenedor.innerHTML = renderSinDatos(asociados?.mensaje || "Sin información.");
    return;
  }

  if (!asociados.pares.length) {
    contenedor.innerHTML = `
      <div class="reportes-vacio ok">
        <strong>No se detectaron productos que se pidan juntos</strong>
        <p class="muted-text">
          Se revisaron ${asociados.solicitudes_analizadas} solicitudes con más de un
          producto y no aparecio ninguna combinación que se repita más de lo que
          cabria esperar por azar.
        </p>
      </div>`;
    return;
  }

  contenedor.innerHTML = `
    <div class="reportes-asociados">
      ${asociados.pares
        .map(
          (p) => `
        <div class="reportes-asociado">
          <div class="reportes-asociado-texto">
            Cuando se pide <strong>${escapeHtml(p.producto)}</strong>,
            el <strong>${p.confianza}%</strong> de las veces tambien se pide
            <strong>${escapeHtml(p.se_pide_con)}</strong>
            <span class="reportes-asociado-meta">
              ${p.veces_juntos} veces juntos · ${p.veces_mas_que_el_azar}x mas que por azar
            </span>
          </div>
        </div>
      `
        )
        .join("")}
    </div>`;
}

function renderEquipos(datosEquipos, resumenEl, concentracionesEl) {
  const { equipos = [], concentraciones = [] } = datosEquipos || {};

  resumenEl.innerHTML = equipos.length
    ? equipos
        .map(
          (e) => `
      <div class="reportes-equipo-tarjeta">
        <strong>${escapeHtml(e.equipo)}</strong>
        <span class="reportes-equipo-cifra">${e.unidades}<small> uds</small></span>
        <span class="table-subline">
          ${e.solicitudes} solicitudes · ${e.participacion_unidades}% del total
        </span>
      </div>`
        )
        .join("")
    : "<p class='muted-text'>Sin equipos con movimiento en el período.</p>";

  concentracionesEl.innerHTML = concentraciones.length
    ? `
      <h5 class="reportes-subtitulo">Consumos desproporcionados</h5>
      <div class="reportes-concentraciones">
        ${concentraciones
          .map(
            (c) => `
          <div class="reportes-concentracion">
            <span>
              <strong>${escapeHtml(c.equipo)}</strong> se lleva el
              <strong>${c.participacion_del_producto}%</strong> de
              <strong>${escapeHtml(c.producto)}</strong>
              <span class="reportes-asociado-meta">
                por su actividad le corresponderia ${c.participacion_esperada}%
              </span>
            </span>
            <span class="reportes-chip alerta">${c.veces_lo_esperado}x</span>
          </div>`
          )
          .join("")}
      </div>`
    : `<p class="muted-text reportes-nota">
         Ningun equipo consume un producto muy por encima de lo que le corresponde.
       </p>`;
}

function renderEstacionalidad(estacionalidad, contenedor) {
  if (!estacionalidad?.disponible) {
    contenedor.innerHTML = renderSinDatos(estacionalidad?.mensaje || "Sin información.");
    return;
  }

  const maximo = Math.max(...estacionalidad.meses.map((m) => m.unidades), 1);

  contenedor.innerHTML = `
    <p class="muted-text reportes-nota">
      Mes de mayor consumo: <strong>${escapeHtml(estacionalidad.mes_peak.mes)}</strong> ·
      el mas bajo: <strong>${escapeHtml(estacionalidad.mes_mas_bajo.mes)}</strong>
    </p>
    <div class="reportes-top">
      ${estacionalidad.meses
        .map(
          (m) => `
        <div class="reportes-top-fila">
          <span class="reportes-top-nombre">${escapeHtml(m.mes)}</span>
          <span class="reportes-top-valor">${m.unidades}</span>
          <span class="reportes-top-riel">
            <span class="reportes-top-relleno" style="width:${Math.max(2, Math.round((m.unidades / maximo) * 100))}%"></span>
          </span>
        </div>`
        )
        .join("")}
    </div>`;
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

function renderFilas(productos, periodo, tbody, filtroTexto, mobileList, puedeRenombrar) {
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
           <strong>No hubo pedidos en este período</strong>
           <p class="muted-text">Elige un rango de fechas más amplio, o quita el filtro por equipo.</p>
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
          ? `<div class="table-subline reportes-aviso">Solo ${p.periodos_con_consumo} período con consumo: referencial.</div>`
          : "";

      return `
        <tr class="reportes-row" data-clave="${escapeHtml(p.clave)}" tabindex="0" role="button">
          <td>
            <span class="reportes-nombre-fila">
              <strong>${escapeHtml(p.nombre)}</strong>
              ${
                puedeRenombrar
                  ? `<button class="reportes-renombrar-btn" data-renombrar="${escapeHtml(p.clave)}"
                       data-nombre-actual="${escapeHtml(p.nombre)}"
                       data-personalizado="${p.nombre_personalizado ? "1" : ""}"
                       type="button" title="${p.nombre_personalizado ? "Quitar renombre" : "Renombrar"}">
                       ${p.nombre_personalizado ? "↺" : "✎"}
                     </button>`
                  : ""
              }
            </span>
            ${
              p.escrito_de_formas > 1
                ? `<div class="table-subline reportes-aviso">agrupa ${p.escrito_de_formas} escrituras</div>`
                : ""
            }
          </td>
          <td>
            ${
              p.unidad_en_conflicto
                ? // El total es una suma de unidades distintas: mostrarlo a
                  // secas seria mentir. Se muestra el desglose real.
                  `<span class="reportes-unidades-mezcladas" title="Este producto tiene pedidos en unidades distintas: el total no se puede sumar">
                     ${(p.desglose_unidades || [])
                       .map(
                         (d) =>
                           `<span class="reportes-unidad-parte"><strong>${d.total}</strong> ${escapeHtml(
                             d.unidad || "sin unidad"
                           )}</span>`
                       )
                       .join("")}
                     <span class="reportes-chip alerta">unidades mezcladas</span>
                   </span>`
                : `<strong>${p.total_unidades}</strong>${unidad}`
            }
          </td>
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
            <div class="reportes-pedidos" data-pedidos-de="${escapeHtml(p.clave)}">
              <button class="action-btn secondary table-btn" data-cargar-pedidos="${escapeHtml(p.clave)}" type="button">
                Ver cada pedido
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

/** Tabla de pedidos individuales: cuando, cuanto, para quien. */
function renderPedidosIndividuales(datos, contenedor) {
  if (!datos.pedidos.length) {
    contenedor.innerHTML = "<p class='muted-text'>Sin pedidos registrados.</p>";
    return;
  }

  contenedor.innerHTML = `
    <h5>Pedido por pedido (${datos.total_pedidos})</h5>
    <div class="reportes-pedidos-lista">
      <div class="reportes-pedido-fila encabezado" role="row">
        <span>Fecha</span>
        <span>Cantidad</span>
        <span>Equipo</span>
        <span>Pedido por</span>
        <span>Solicitud</span>
        <span></span>
      </div>
      ${datos.pedidos
        .map(
          (p) => `
        <div class="reportes-pedido-fila ${p.atipico ? "atipico" : ""}" role="row">
          <span class="reportes-pedido-fecha" data-etiqueta="Fecha">${escapeHtml(p.fecha_corta)}</span>
          <span class="reportes-pedido-cantidad" data-etiqueta="Cantidad">${p.cantidad}</span>
          <span class="reportes-pedido-equipo" data-etiqueta="Equipo">${escapeHtml(p.equipo)}</span>
          <span class="reportes-pedido-solicitante" data-etiqueta="Pedido por">${escapeHtml(p.solicitante)}</span>
          <span class="reportes-pedido-solicitud" data-etiqueta="Solicitud">#${p.solicitud_id}</span>
          <span class="reportes-pedido-marca">${
            p.atipico ? `<span class="reportes-chip alerta">atípico</span>` : ""
          }</span>
        </div>
      `
        )
        .join("")}
    </div>
  `;
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
    el("reportes-th-proyeccion").textContent = `Próxima ${unidad}`.replace(
      "Próxima mes",
      "Próximo mes"
    );

    // Proyeccion general del proximo periodo.
    const proy = datos.proyeccion_general;
    el("reportes-proyeccion-label").textContent =
      unidad === "semana" ? "Próxima semana" : "Próximo mes";
    el("reportes-proyeccion-valor").textContent = proy ? `~${proy.valor}` : "-";
    el("reportes-proyeccion-confianza").textContent = proy
      ? `${proy.confianza.etiqueta} · media móvil de ${proy.ventana}`
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
      renderFilas(datos.productos, datos.periodo, tbody, searchInput.value, mobileList, puedeUnificar);
      renderDuplicados(datos.posibles_duplicados, duplicadosList, puedeUnificar);

      renderAsociados(datos.analisis?.asociados, el("reportes-asociados"));
      renderEquipos(
        datos.analisis?.equipos,
        el("reportes-equipos-resumen"),
        el("reportes-concentraciones")
      );
      renderEstacionalidad(datos.analisis?.estacionalidad, el("reportes-estacionalidad"));
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
    renderFilas(datos.productos, datos.periodo, tbody, searchInput.value, mobileList, puedeUnificar);
  });

  tbody.addEventListener("click", (event) => {
    // El boton de renombrar vive dentro de la fila: no debe abrir/cerrar el
    // detalle al usarlo.
    const botonRenombrar = event.target.closest("[data-renombrar]");
    if (botonRenombrar) {
      abrirModalRenombrar(
        botonRenombrar.dataset.renombrar,
        botonRenombrar.dataset.nombreActual,
        botonRenombrar.dataset.personalizado === "1"
      );
      return;
    }

    const botonPedidos = event.target.closest("[data-cargar-pedidos]");
    if (botonPedidos) {
      cargarPedidosIndividuales(botonPedidos.dataset.cargarPedidos, botonPedidos.parentElement);
      return;
    }

    const fila = event.target.closest(".reportes-row");
    if (!fila) return;
    tbody.querySelector(`[data-detalle="${CSS.escape(fila.dataset.clave)}"]`)?.classList.toggle("hidden");
    fila.classList.toggle("abierta");
  });

  async function cargarPedidosIndividuales(clave, contenedor) {
    contenedor.innerHTML = "<p class='muted-text'>Cargando pedidos...</p>";
    try {
      const params = new URLSearchParams({ clave });
      if (desdeInput.value) params.set("fechaDesde", desdeInput.value);
      if (hastaInput.value) params.set("fechaHasta", hastaInput.value);
      const respuesta = await apiRequest(`/api/reportes/consumo/detalle?${params.toString()}`);
      renderPedidosIndividuales(respuesta.data, contenedor);
    } catch (error) {
      contenedor.innerHTML = `<p class="muted-text">${escapeHtml(error.message)}</p>`;
    }
  }

  // ── Renombrar producto ────────────────────────────────────────────────
  let renombrarPendiente = null;

  function abrirModalRenombrar(clave, nombreActual, esPersonalizado) {
    renombrarPendiente = { clave, esPersonalizado };
    el("reportes-renombrar-actual").textContent = nombreActual;
    const input = el("reportes-renombrar-input");
    input.value = esPersonalizado ? nombreActual : "";
    el("reportes-renombrar-quitar").classList.toggle("hidden", !esPersonalizado);
    el("reportes-renombrar-modal").classList.remove("hidden");
    input.focus();
  }

  function cerrarModalRenombrar() {
    el("reportes-renombrar-modal").classList.add("hidden");
    renombrarPendiente = null;
  }

  async function confirmarRenombrar() {
    if (!renombrarPendiente) return;
    const nombre = el("reportes-renombrar-input").value.trim();
    if (!nombre) {
      showToast("Escribe un nombre", true);
      return;
    }
    try {
      await apiRequest("/api/reportes/nombres", {
        method: "POST",
        body: { clave: renombrarPendiente.clave, nombre },
      });
      cerrarModalRenombrar();
      showToast("Nombre guardado");
      await cargar();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  async function quitarRenombre() {
    if (!renombrarPendiente) return;
    try {
      const nombres = await apiRequest("/api/reportes/nombres");
      const fila = (nombres.data || []).find((n) => n.clave === renombrarPendiente.clave);
      if (fila) {
        await apiRequest(`/api/reportes/nombres/${fila.id}`, { method: "DELETE" });
      }
      cerrarModalRenombrar();
      showToast("Se volvió al nombre automático");
      await cargar();
    } catch (error) {
      showToast(error.message, true);
    }
  }

  el("reportes-renombrar-close")?.addEventListener("click", cerrarModalRenombrar);
  el("reportes-renombrar-cancel")?.addEventListener("click", cerrarModalRenombrar);
  el("reportes-renombrar-confirm")?.addEventListener("click", confirmarRenombrar);
  el("reportes-renombrar-quitar")?.addEventListener("click", quitarRenombre);
  el("reportes-renombrar-modal")?.addEventListener("click", (event) => {
    if (event.target.dataset.close === "true") cerrarModalRenombrar();
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
    if (!window.confirm("Deshacer esta unificación? Los productos volveran a contarse por separado.")) {
      return;
    }
    try {
      await apiRequest(`/api/reportes/alias/${boton.dataset.deshacer}`, { method: "DELETE" });
      showToast("Unificación deshecha");
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
