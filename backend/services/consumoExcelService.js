// Exportacion del reporte de consumo a Excel.
//
// La secretaria trabaja comoda en Excel, asi que el archivo tiene que llegar
// listo para usar: cada hoja con una pregunta clara, encabezados congelados y
// los numeros como numeros (no como texto), para poder ordenar y filtrar.

const ExcelJS = require("exceljs");
const consumoService = require("./consumoService");

const C = {
  headerBg: "FF1A5C3A",
  headerFg: "FFFFFFFF",
  titleBg: "FF0F3D27",
  titleFg: "FFFFFFFF",
  metaBg: "FFE8F5EE",
  metaFg: "FF123126",
  evenRow: "FFF5FAF7",
  border: "FFD0E4D8",
  borderLight: "FFEAF3EE",
  alerta: "FFFCE4EC",
  alertaFg: "FFC62828",
  ok: "FFE8F5EE",
};

function fill(argb) {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function borde(color = C.border) {
  const s = { style: "thin", color: { argb: color } };
  return { top: s, left: s, bottom: s, right: s };
}

function titulo(sheet, texto, columnas, fila = 1) {
  sheet.mergeCells(fila, 1, fila, columnas);
  const celda = sheet.getCell(fila, 1);
  celda.value = texto;
  celda.fill = fill(C.titleBg);
  celda.font = { bold: true, size: 14, color: { argb: C.titleFg } };
  celda.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(fila).height = 30;
}

function meta(sheet, texto, columnas, fila) {
  sheet.mergeCells(fila, 1, fila, columnas);
  const celda = sheet.getCell(fila, 1);
  celda.value = texto;
  celda.fill = fill(C.metaBg);
  celda.font = { size: 9, italic: true, color: { argb: C.metaFg } };
  celda.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(fila).height = 16;
}

function encabezados(sheet, columnas, fila) {
  const row = sheet.getRow(fila);
  row.height = 26;
  columnas.forEach((texto, i) => {
    const celda = row.getCell(i + 1);
    celda.value = texto;
    celda.fill = fill(C.headerBg);
    celda.font = { bold: true, size: 10, color: { argb: C.headerFg } };
    celda.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    celda.border = borde();
  });
}

function filaDatos(sheet, valores, fila, par) {
  const row = sheet.getRow(fila);
  row.height = 18;
  valores.forEach((valor, i) => {
    const celda = row.getCell(i + 1);
    celda.value = valor;
    if (par) celda.fill = fill(C.evenRow);
    celda.border = borde(C.borderLight);
    celda.alignment = { vertical: "middle", wrapText: false };
  });
  return row;
}

function anchos(sheet, medidas) {
  medidas.forEach((ancho, i) => {
    sheet.getColumn(i + 1).width = ancho;
  });
}

/** Hoja 1: la que responde "cuanto stock tengo que tener". */
function hojaResumen(libro, datos, filtros) {
  const sheet = libro.addWorksheet("Resumen por producto");
  const cols = [
    "Producto",
    "Unidad",
    "Total pedido",
    "Solicitudes",
    `Consumo tipico por ${datos.periodo.agrupacion}`,
    "Stock mínimo sugerido",
    "Stock máximo sugerido",
    "Regularidad",
    "Tendencia",
    "Pedidos anomalos",
    "Nombres agrupados",
  ];

  titulo(sheet, "Consumo por producto — Portal FMN", cols.length);
  meta(
    sheet,
    `Período: ${filtros.fechaDesde || "inicio"} a ${filtros.fechaHasta || "hoy"}  |  ` +
      `Agrupado por ${datos.periodo.agrupacion}  |  ` +
      `${datos.totales.productos_distintos} productos, ${datos.totales.unidades} unidades`,
    cols.length,
    2
  );
  encabezados(sheet, cols, 3);

  datos.productos.forEach((p, i) => {
    const row = filaDatos(
      sheet,
      [
        p.nombre,
        p.unidad || "",
        p.total_unidades,
        p.total_solicitudes,
        p.tipico,
        p.sugerido_min,
        p.sugerido_max,
        p.regularidad?.etiqueta || "",
        p.tendencia?.etiqueta || "",
        p.atipicos || 0,
        p.variantes.map((v) => v.nombre).join(" | "),
      ],
      i + 4,
      i % 2 === 1
    );

    // Se resalta lo que necesita revision humana, no lo que es normal.
    if (p.atipicos) {
      row.getCell(10).fill = fill(C.alerta);
      row.getCell(10).font = { bold: true, color: { argb: C.alertaFg } };
    }
    if (p.regularidad?.nivel === "erratico") {
      row.getCell(8).font = { color: { argb: C.alertaFg } };
    }
  });

  anchos(sheet, [34, 10, 13, 12, 18, 18, 18, 16, 16, 15, 46]);
  sheet.views = [{ state: "frozen", ySplit: 3 }];
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols.length } };
}

/** Hoja 2: la evolucion, para ver si algo viene subiendo. */
function hojaEvolucion(libro, datos) {
  const sheet = libro.addWorksheet("Evolucion");
  const cols = ["Producto", ...datos.periodo.etiquetas, "Total"];

  titulo(sheet, `Consumo por ${datos.periodo.agrupacion}`, cols.length);
  meta(
    sheet,
    datos.periodo.incompleto
      ? `Atención: "${datos.periodo.etiqueta_incompleto}" esta incompleto y no se uso para calcular tendencias.`
      : "Todos los períodos mostrados están completos.",
    cols.length,
    2
  );
  encabezados(sheet, cols, 3);

  datos.productos.forEach((p, i) => {
    filaDatos(
      sheet,
      [
        p.nombre,
        ...p.serie,
        p.total_unidades,
      ],
      i + 4,
      i % 2 === 1
    );
  });

  const filaTotal = datos.productos.length + 4;
  const row = filaDatos(
    sheet,
    [
      "TOTAL",
      ...datos.serie_general,
      datos.totales.unidades,
    ],
    filaTotal,
    false
  );
  row.eachCell((celda) => {
    celda.font = { bold: true };
    celda.fill = fill(C.metaBg);
  });

  anchos(sheet, [34, ...datos.periodo.etiquetas.map(() => 14), 12]);
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];
}

/** Hoja 3: quien consume que. */
function hojaEquipos(libro, datos) {
  const sheet = libro.addWorksheet("Por equipo");
  const cols = ["Producto", ...datos.equipos, "Total"];

  titulo(sheet, "Consumo por equipo", cols.length);
  meta(sheet, "Unidades pedidas por cada equipo en el período.", cols.length, 2);
  encabezados(sheet, cols, 3);

  datos.productos.forEach((p, i) => {
    filaDatos(
      sheet,
      [p.nombre, ...datos.equipos.map((e) => p.por_equipo[e] || 0), p.total_unidades],
      i + 4,
      i % 2 === 1
    );
  });

  anchos(sheet, [34, ...datos.equipos.map(() => 16), 12]);
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];
}

/** Hoja 4: lo que hay que ir a revisar. */
function hojaAtipicos(libro, datos) {
  const sheet = libro.addWorksheet("Pedidos a revisar");
  const cols = [
    "Producto",
    "Fecha",
    "Solicitud",
    "Equipo",
    "Cantidad pedida",
    "Cantidad tipica",
    "Cuantas veces lo normal",
    "Nombre escrito",
  ];

  titulo(sheet, "Pedidos fuera de lo normal", cols.length);
  meta(
    sheet,
    "Cantidades muy por encima de lo habitual para ese producto. Pueden ser un error de tipeo " +
      "o un consumo real puntual. No se usaron para calcular el stock sugerido.",
    cols.length,
    2
  );
  encabezados(sheet, cols, 3);

  if (!datos.atipicos.length) {
    const row = filaDatos(sheet, ["No se detectaron pedidos anomalos en el período."], 4, false);
    row.getCell(1).fill = fill(C.ok);
    sheet.mergeCells(4, 1, 4, cols.length);
  } else {
    datos.atipicos.forEach((a, i) => {
      const row = filaDatos(
        sheet,
        [
          a.producto,
          a.fecha_corta,
          a.solicitud_id,
          a.equipo,
          a.cantidad,
          a.valor_tipico,
          a.veces_lo_tipico ? `${a.veces_lo_tipico}x` : "",
          a.nombre_escrito,
        ],
        i + 4,
        i % 2 === 1
      );
      row.getCell(5).font = { bold: true, color: { argb: C.alertaFg } };
    });
  }

  anchos(sheet, [30, 12, 12, 20, 16, 16, 22, 30]);
  sheet.views = [{ state: "frozen", ySplit: 3 }];
}

function nombreArchivo(filtros) {
  const desde = (filtros.fechaDesde || "inicio").replaceAll("-", "");
  const hasta = (filtros.fechaHasta || "hoy").replaceAll("-", "");
  return `consumo_${desde}_${hasta}.xlsx`;
}

async function exportConsumoExcel(actor, filtros = {}) {
  const datos = await consumoService.getConsumo(actor, filtros);

  const libro = new ExcelJS.Workbook();
  libro.creator = "Portal FMN";
  libro.created = new Date();

  hojaResumen(libro, datos, filtros);
  hojaEvolucion(libro, datos);
  hojaEquipos(libro, datos);
  hojaAtipicos(libro, datos);

  const buffer = await libro.xlsx.writeBuffer();
  return { buffer, fileName: nombreArchivo(filtros) };
}

module.exports = {
  exportConsumoExcel,
};
