const ExcelJS = require("exceljs");
const solicitudesService = require("./solicitudesService");
const { formatChileDate, formatChileDateTime } = require("../utils/dateTime");

function formatDateForName() {
  return formatChileDate(new Date()).replaceAll("-", "");
}

function normalizeFilterLabel(value, fallback = "Todos") {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value);
}

function applyHeaderStyle(cell) {
  cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F6F50" },
  };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = {
    top: { style: "thin", color: { argb: "FFBFD2C7" } },
    left: { style: "thin", color: { argb: "FFBFD2C7" } },
    bottom: { style: "thin", color: { argb: "FFBFD2C7" } },
    right: { style: "thin", color: { argb: "FFBFD2C7" } },
  };
}

function applyBodyStyle(row, isEven) {
  row.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FFE3ECE7" } },
      left: { style: "thin", color: { argb: "FFE3ECE7" } },
      bottom: { style: "thin", color: { argb: "FFE3ECE7" } },
      right: { style: "thin", color: { argb: "FFE3ECE7" } },
    };

    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };

    if (isEven) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8FBF9" },
      };
    }
  });
}

async function exportSolicitudesExcel(actor, filters = {}) {
  const rows = await solicitudesService.listSolicitudesForExport(actor, filters);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Portal FMN";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Solicitudes");
  sheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Equipo", key: "equipo", width: 24 },
    { header: "Repuesto", key: "repuesto", width: 28 },
    { header: "Cantidad", key: "cantidad", width: 12 },
    { header: "Estado", key: "estado", width: 14 },
    { header: "Solicitante", key: "solicitante", width: 24 },
    { header: "Fecha creacion", key: "created_at", width: 22 },
    { header: "Fecha revision", key: "reviewed_at", width: 22 },
    { header: "Fecha despacho", key: "dispatched_at", width: 22 },
    { header: "Fecha entrega", key: "received_at", width: 22 },
    { header: "Comentario", key: "comentario", width: 36 },
  ];

  sheet.mergeCells("A1:K1");
  sheet.getCell("A1").value = "Portal Forestal Maule Norte - Reporte de Solicitudes";
  sheet.getCell("A1").font = { size: 14, bold: true, color: { argb: "FF123126" } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };

  sheet.mergeCells("A2:K2");
  sheet.getCell("A2").value = `Generado por: ${actor.nombre || actor.name || "Usuario"} | Fecha: ${formatChileDateTime(new Date())}`;
  sheet.getCell("A2").font = { size: 10, color: { argb: "FF5E766A" } };
  sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };

  sheet.mergeCells("A3:K3");
  sheet.getCell("A3").value =
    `Filtros -> Estado: ${normalizeFilterLabel(filters.estado)} | ` +
    `Fecha desde: ${filters.fechaDesde ? formatChileDate(filters.fechaDesde) : "Sin limite"} | ` +
    `Fecha hasta: ${filters.fechaHasta ? formatChileDate(filters.fechaHasta) : "Sin limite"}`;
  sheet.getCell("A3").font = { size: 10, italic: true, color: { argb: "FF4A6358" } };

  const headerRow = sheet.getRow(5);
  headerRow.values = sheet.columns.map((column) => column.header);
  headerRow.height = 22;
  headerRow.eachCell((cell) => applyHeaderStyle(cell));

  let rowIndex = 6;
  for (const item of rows) {
    const row = sheet.getRow(rowIndex);
    row.values = [
      item.id,
      item.equipo,
      item.repuesto,
      item.cantidad,
      item.estado,
      item.solicitante,
      formatChileDateTime(item.created_at),
      formatChileDateTime(item.reviewed_at),
      formatChileDateTime(item.dispatched_at),
      formatChileDateTime(item.received_at),
      item.comentario || "",
    ];

    applyBodyStyle(row, rowIndex % 2 === 0);
    rowIndex += 1;
  }

  if (!rows.length) {
    const emptyRow = sheet.getRow(6);
    emptyRow.getCell(1).value = "Sin datos para los filtros seleccionados";
    sheet.mergeCells("A6:K6");
    emptyRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    emptyRow.getCell(1).font = { italic: true, color: { argb: "FF5E766A" } };
  }

  sheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5, column: 11 },
  };

  sheet.views = [{ state: "frozen", ySplit: 5 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    fileName: `reporte_solicitudes_${formatDateForName()}.xlsx`,
  };
}

module.exports = {
  exportSolicitudesExcel,
};
