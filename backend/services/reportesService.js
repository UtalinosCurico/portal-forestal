const ExcelJS = require("exceljs");
const solicitudesService = require("./solicitudesService");
const { formatChileDate, formatChileDateTime } = require("../utils/dateTime");

// ── Paleta de colores ─────────────────────────────────────────────────────────
const C = {
  headerBg:    "FF1A5C3A",
  headerFg:    "FFFFFFFF",
  titleBg:     "FF0F3D27",
  titleFg:     "FFFFFFFF",
  metaBg:      "FFE8F5EE",
  metaFg:      "FF123126",
  sectionBg:   "FF2D7A57",
  sectionFg:   "FFFFFFFF",
  evenRow:     "FFF5FAF7",
  border:      "FFD0E4D8",
  borderLight: "FFEAF3EE",
  statsBg:     "FFF0F8F4",
};

const STATUS_COLOR = {
  PENDIENTE:   { bg: "FFFFF8E1", fg: "FF7A5200" },
  EN_REVISION: { bg: "FFE3F2FD", fg: "FF1565C0" },
  APROBADO:    { bg: "FFE8F5E9", fg: "FF2E7D32" },
  EN_DESPACHO: { bg: "FFFFF3E0", fg: "FFBF5000" },
  ENTREGADO:   { bg: "FFE8F5EE", fg: "FF1A5C3A" },
  RECHAZADO:   { bg: "FFFCE4EC", fg: "FFC62828" },
};

const ITEM_STATUS_COLOR = {
  NO_APLICA:      { bg: "FFF2F4F3", fg: "FF55665E" },
  RESUELTO_FAENA: { bg: "FFF9F1E8", fg: "FF8A4C10" },
  POR_GESTIONAR: { bg: "FFFFF8E1", fg: "FF7A5200" },
  GESTIONADO:    { bg: "FFE3F2FD", fg: "FF1565C0" },
  ENVIADO:       { bg: "FFFFF3E0", fg: "FFBf5000" },
  ENTREGADO:     { bg: "FFE8F5EE", fg: "FF1A5C3A" },
};

const STATUS_LABEL = {
  PENDIENTE:   "Pendiente",
  EN_REVISION: "En Gestión",
  APROBADO:    "Aprobado",
  EN_DESPACHO: "En Despacho",
  ENTREGADO:   "Entregado",
  RECHAZADO:   "Rechazado",
};

const ITEM_STATUS_LABEL = {
  NO_APLICA:      "N/A",
  RESUELTO_FAENA: "Resuelto en faena",
  POR_GESTIONAR: "Por gestionar",
  GESTIONADO:    "Gestionado",
  ENVIADO:       "Enviado",
  ENTREGADO:     "Entregado",
};

// ── Helpers de estilo ─────────────────────────────────────────────────────────
function border(color = C.border) {
  const s = { style: "thin", color: { argb: color } };
  return { top: s, left: s, bottom: s, right: s };
}

function fill(argb) {
  return { type: "pattern", pattern: "solid", fgColor: { argb: argb } };
}

function applyTitleRow(sheet, text, cols, row = 1, height = 32) {
  sheet.mergeCells(row, 1, row, cols);
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.fill = fill(C.titleBg);
  cell.font = { bold: true, size: 14, color: { argb: C.titleFg } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(row).height = height;
}

function applyMetaRow(sheet, text, cols, row) {
  sheet.mergeCells(row, 1, row, cols);
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.fill = fill(C.metaBg);
  cell.font = { size: 9, italic: true, color: { argb: C.metaFg } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(row).height = 16;
}

function applyHeaderRow(sheet, headers, rowNum, height = 24) {
  const row = sheet.getRow(rowNum);
  row.height = height;
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    cell.fill = fill(C.headerBg);
    cell.font = { bold: true, size: 10, color: { argb: C.headerFg } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border(C.border);
  });
}

function applyDataRow(sheet, values, rowNum, isEven) {
  const row = sheet.getRow(rowNum);
  row.height = 20;
  values.forEach((v, i) => {
    const cell = row.getCell(i + 1);
    cell.value = v;
    if (isEven) cell.fill = fill(C.evenRow);
    cell.border = border(C.borderLight);
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function applyStatusCell(cell, estado, labelMap, colorMap) {
  const lbl = labelMap[estado] || estado;
  const col = colorMap[estado] || { bg: "FFF5F5F5", fg: "FF333333" };
  cell.value = lbl;
  cell.fill = fill(col.bg);
  cell.font = { bold: true, size: 9, color: { argb: col.fg } };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border = border(C.borderLight);
}

function diasTranscurridos(desde, hasta) {
  if (!desde) return 0;
  const end = hasta ? new Date(hasta) : new Date();
  const diff = Math.floor((end - new Date(desde)) / 86400000);
  return diff >= 0 ? diff : 0;
}

function formatDateForName() {
  return formatChileDate(new Date()).replaceAll("-", "");
}

function normalizeFilterLabel(value, fallback = "Todos") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

// ── Hoja 1: Solicitudes ───────────────────────────────────────────────────────
function buildSheetSolicitudes(workbook, solicitudes, filters, actor) {
  const sheet = workbook.addWorksheet("Solicitudes", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  const COLS = 13;
  sheet.columns = [
    { key: "id",          width: 7  },
    { key: "equipo",      width: 22 },
    { key: "estado",      width: 14 },
    { key: "solicitante", width: 22 },
    { key: "items",       width: 8  },
    { key: "unidades",    width: 10 },
    { key: "productos",   width: 36 },
    { key: "creado",      width: 20 },
    { key: "dias",        width: 8  },
    { key: "revision",    width: 20 },
    { key: "despacho",    width: 20 },
    { key: "entrega",     width: 20 },
    { key: "comentario",  width: 38 },
  ];

  // Cabecera
  applyTitleRow(sheet, "Portal Forestal Maule Norte — Reporte de Solicitudes", COLS, 1);
  applyMetaRow(sheet, `Generado por: ${actor.nombre || "Usuario"}  |  Fecha: ${formatChileDateTime(new Date())}`, COLS, 2);
  applyMetaRow(
    sheet,
    `Filtros → Estado: ${normalizeFilterLabel(filters.estado)}  |  ` +
    `Desde: ${filters.fechaDesde ? formatChileDate(filters.fechaDesde) : "Sin límite"}  |  ` +
    `Hasta: ${filters.fechaHasta ? formatChileDate(filters.fechaHasta) : "Sin límite"}  |  ` +
    `Total registros: ${solicitudes.length}`,
    COLS, 3
  );

  // Fila vacía de separación
  sheet.getRow(4).height = 6;

  // Encabezados de columna
  applyHeaderRow(sheet, [
    "ID", "Equipo", "Estado", "Solicitante",
    "Ítems", "Unidades", "Productos",
    "Fecha creación", "Días", "Fecha revisión",
    "Fecha despacho", "Fecha entrega", "Comentario",
  ], 5);

  // Datos
  let rowNum = 6;
  for (const sol of solicitudes) {
    const isEven = (rowNum % 2 === 0);
    const totalUnidades = sol.items.length
      ? sol.items.reduce((s, it) => s + Number(it.cantidad || 0), 0)
      : Number(sol.cantidad || 0);
    const productos = sol.items.length
      ? sol.items.map((it) => `${it.nombre_item || "?"} (${it.cantidad || 0})`).join(", ")
      : sol.repuesto || "-";
    const endDate = sol.received_at || (sol.estado === "RECHAZADO" ? sol.updated_at : null);

    applyDataRow(sheet, [
      sol.id,
      sol.equipo,
      null, // estado: se aplica aparte
      sol.solicitante,
      sol.total_items || sol.items.length || 1,
      totalUnidades,
      productos,
      sol.created_at ? formatChileDateTime(sol.created_at) : "-",
      diasTranscurridos(sol.created_at, endDate),
      sol.reviewed_at  ? formatChileDateTime(sol.reviewed_at)  : "-",
      sol.dispatched_at? formatChileDateTime(sol.dispatched_at): "-",
      sol.received_at  ? formatChileDateTime(sol.received_at)  : "-",
      sol.comentario || "",
    ], rowNum, isEven);

    // Estado con color
    applyStatusCell(sheet.getCell(rowNum, 3), sol.estado, STATUS_LABEL, STATUS_COLOR);
    // Días: centrado
    sheet.getCell(rowNum, 9).alignment = { horizontal: "center", vertical: "middle" };

    rowNum++;
  }

  if (!solicitudes.length) {
    sheet.mergeCells(6, 1, 6, COLS);
    const cell = sheet.getCell(6, 1);
    cell.value = "Sin datos para los filtros seleccionados";
    cell.font = { italic: true, color: { argb: C.metaFg } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(6).height = 22;
  }

  // Filtro + freeze
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: COLS } };
  sheet.views = [{ state: "frozen", ySplit: 5, xSplit: 0 }];
}

// ── Hoja 2: Detalle por ítem ──────────────────────────────────────────────────
function buildSheetItems(workbook, solicitudes) {
  const sheet = workbook.addWorksheet("Detalle por ítem", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  const COLS = 15;
  sheet.columns = [
    { key: "solicitud_id",  width: 10 },
    { key: "equipo",        width: 22 },
    { key: "sol_estado",    width: 14 },
    { key: "solicitante",   width: 20 },
    { key: "nombre_item",   width: 32 },
    { key: "codigo_ref",    width: 16 },
    { key: "cantidad",      width: 10 },
    { key: "unidad",        width: 10 },
    { key: "usuario_final", width: 20 },
    { key: "nota",          width: 28 },
    { key: "item_estado",   width: 14 },
    { key: "comentario_g",  width: 30 },
    { key: "encargado",     width: 20 },
    { key: "enviado_por",   width: 20 },
    { key: "recepcionado",  width: 20 },
  ];

  applyTitleRow(sheet, "Portal Forestal Maule Norte — Detalle por Ítem", COLS, 1);
  applyMetaRow(sheet, "Un registro por cada ítem de cada solicitud, con tracking completo de gestión", COLS, 2);
  sheet.getRow(3).height = 6;

  applyHeaderRow(sheet, [
    "Sol. #", "Equipo", "Estado Sol.", "Solicitante",
    "Producto", "Código Ref.", "Cantidad", "Unidad",
    "Usuario Final", "Nota Pedido",
    "Estado Ítem", "Comentario Gestión",
    "Encargado", "Enviado por", "Recepcionado por",
  ], 4);

  let rowNum = 5;
  let hasItems = false;

  for (const sol of solicitudes) {
    const itemsToRender = sol.items.length
      ? sol.items
      : sol.repuesto
        ? [{
            nombre_item: sol.repuesto,
            cantidad: sol.cantidad,
            unidad_medida: null,
            codigo_referencia: null,
            usuario_final: null,
            comentario: sol.comentario || null,
            estado_item: "POR_GESTIONAR",
            comentario_gestion: null,
            encargado_nombre: null,
            enviado_por_nombre: null,
            recepcionado_por_nombre: null,
          }]
        : [];

    for (const item of itemsToRender) {
      hasItems = true;
      const isEven = rowNum % 2 === 0;

      applyDataRow(sheet, [
        sol.id,
        sol.equipo,
        null, // estado sol — se aplica aparte
        sol.solicitante,
        item.nombre_item || "-",
        item.codigo_referencia || "-",
        Number(item.cantidad || 0),
        item.unidad_medida || "-",
        item.usuario_final || "-",
        item.comentario || item.detalle || "-",
        null, // estado ítem — se aplica aparte
        item.comentario_gestion || "-",
        item.encargado_nombre || "-",
        item.enviado_por_nombre || "-",
        item.recepcionado_por_nombre || "-",
      ], rowNum, isEven);

      // Estado solicitud con color
      applyStatusCell(sheet.getCell(rowNum, 3), sol.estado, STATUS_LABEL, STATUS_COLOR);
      // Estado ítem con color
      applyStatusCell(sheet.getCell(rowNum, 11), item.estado_item || "POR_GESTIONAR", ITEM_STATUS_LABEL, ITEM_STATUS_COLOR);
      // Cantidad centrada
      sheet.getCell(rowNum, 7).alignment = { horizontal: "center", vertical: "middle" };

      rowNum++;
    }
  }

  if (!hasItems) {
    sheet.mergeCells(5, 1, 5, COLS);
    const cell = sheet.getCell(5, 1);
    cell.value = "Sin ítems para los filtros seleccionados";
    cell.font = { italic: true, color: { argb: C.metaFg } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: COLS } };
  sheet.views = [{ state: "frozen", ySplit: 4, xSplit: 0 }];
}

// ── Hoja 3: Estadísticas ──────────────────────────────────────────────────────
function buildSheetStats(workbook, solicitudes) {
  const sheet = workbook.addWorksheet("Estadísticas");
  sheet.columns = [
    { width: 26 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
  ];

  applyTitleRow(sheet, "Estadísticas del Reporte", 6, 1);
  sheet.getRow(2).height = 8;

  // ── Por estado ───────────────────────────────────────────────────────────────
  const estadoOrder = ["PENDIENTE", "EN_REVISION", "APROBADO", "EN_DESPACHO", "ENTREGADO", "RECHAZADO"];
  const countByEstado = {};
  for (const e of estadoOrder) countByEstado[e] = 0;
  for (const s of solicitudes) {
    if (countByEstado[s.estado] !== undefined) countByEstado[s.estado]++;
  }

  // Sección header
  sheet.mergeCells(3, 1, 3, 3);
  const estadoHeader = sheet.getCell(3, 1);
  estadoHeader.value = "Solicitudes por Estado";
  estadoHeader.fill = fill(C.sectionBg);
  estadoHeader.font = { bold: true, size: 11, color: { argb: C.sectionFg } };
  estadoHeader.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(3).height = 22;

  // Sub-cabecera
  ["Estado", "Cantidad", "% del total"].forEach((h, i) => {
    const cell = sheet.getCell(4, i + 1);
    cell.value = h;
    cell.fill = fill(C.headerBg);
    cell.font = { bold: true, size: 10, color: { argb: C.headerFg } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border(C.border);
    sheet.getRow(4).height = 20;
  });

  let rn = 5;
  const total = solicitudes.length || 1;
  for (const e of estadoOrder) {
    const count = countByEstado[e];
    const pct = ((count / total) * 100).toFixed(1) + "%";
    const col = STATUS_COLOR[e] || { bg: "FFF5F5F5", fg: "FF333333" };

    const labelCell = sheet.getCell(rn, 1);
    labelCell.value = STATUS_LABEL[e] || e;
    labelCell.fill = fill(col.bg);
    labelCell.font = { bold: true, size: 10, color: { argb: col.fg } };
    labelCell.alignment = { vertical: "middle" };
    labelCell.border = border(C.borderLight);

    const countCell = sheet.getCell(rn, 2);
    countCell.value = count;
    countCell.font = { bold: true, size: 11 };
    countCell.alignment = { horizontal: "center", vertical: "middle" };
    countCell.border = border(C.borderLight);
    if (rn % 2 === 0) countCell.fill = fill(C.evenRow);

    const pctCell = sheet.getCell(rn, 3);
    pctCell.value = pct;
    pctCell.alignment = { horizontal: "center", vertical: "middle" };
    pctCell.border = border(C.borderLight);
    if (rn % 2 === 0) pctCell.fill = fill(C.evenRow);

    sheet.getRow(rn).height = 20;
    rn++;
  }

  // Total
  rn++;
  sheet.mergeCells(rn, 1, rn, 1);
  const totLbl = sheet.getCell(rn, 1);
  totLbl.value = "TOTAL";
  totLbl.font = { bold: true, size: 10 };
  totLbl.fill = fill(C.metaBg);
  totLbl.border = border(C.border);
  totLbl.alignment = { vertical: "middle" };
  const totVal = sheet.getCell(rn, 2);
  totVal.value = solicitudes.length;
  totVal.font = { bold: true, size: 11 };
  totVal.fill = fill(C.metaBg);
  totVal.border = border(C.border);
  totVal.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(rn).height = 22;
  rn += 2;

  // ── Por equipo ───────────────────────────────────────────────────────────────
  const countByEquipo = {};
  for (const s of solicitudes) {
    countByEquipo[s.equipo] = (countByEquipo[s.equipo] || 0) + 1;
  }
  const equiposSorted = Object.entries(countByEquipo).sort((a, b) => b[1] - a[1]);

  sheet.mergeCells(rn, 1, rn, 3);
  const equipoHeader = sheet.getCell(rn, 1);
  equipoHeader.value = "Solicitudes por Equipo";
  equipoHeader.fill = fill(C.sectionBg);
  equipoHeader.font = { bold: true, size: 11, color: { argb: C.sectionFg } };
  equipoHeader.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(rn).height = 22;
  rn++;

  ["Equipo", "Cantidad", "% del total"].forEach((h, i) => {
    const cell = sheet.getCell(rn, i + 1);
    cell.value = h;
    cell.fill = fill(C.headerBg);
    cell.font = { bold: true, size: 10, color: { argb: C.headerFg } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border(C.border);
    sheet.getRow(rn).height = 20;
  });
  rn++;

  for (const [equipo, count] of equiposSorted) {
    const pct = ((count / total) * 100).toFixed(1) + "%";
    const isEven = rn % 2 === 0;

    const lbl = sheet.getCell(rn, 1);
    lbl.value = equipo;
    lbl.border = border(C.borderLight);
    lbl.alignment = { vertical: "middle" };
    if (isEven) lbl.fill = fill(C.evenRow);

    const cnt = sheet.getCell(rn, 2);
    cnt.value = count;
    cnt.font = { bold: true, size: 11 };
    cnt.alignment = { horizontal: "center", vertical: "middle" };
    cnt.border = border(C.borderLight);
    if (isEven) cnt.fill = fill(C.evenRow);

    const p = sheet.getCell(rn, 3);
    p.value = pct;
    p.alignment = { horizontal: "center", vertical: "middle" };
    p.border = border(C.borderLight);
    if (isEven) p.fill = fill(C.evenRow);

    sheet.getRow(rn).height = 20;
    rn++;
  }

  sheet.views = [{}];
}

// ── Exportación principal ─────────────────────────────────────────────────────
async function exportSolicitudesExcel(actor, filters = {}) {
  const solicitudes = await solicitudesService.listSolicitudesForExport(actor, filters);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Portal FMN";
  workbook.created = new Date();
  workbook.properties.date1904 = false;

  buildSheetSolicitudes(workbook, solicitudes, filters, actor);
  buildSheetItems(workbook, solicitudes);
  buildSheetStats(workbook, solicitudes);

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    fileName: `reporte_solicitudes_${formatDateForName()}.xlsx`,
  };
}

module.exports = {
  exportSolicitudesExcel,
};
