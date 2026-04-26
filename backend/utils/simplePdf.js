function sanitizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function escapePdfText(value) {
  return sanitizeText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(value, maxLength = 94) {
  const words = sanitizeText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length > maxLength) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [""];
}

function paginateLines(lines, options) {
  const pages = [];
  const pageHeight = options.pageHeight || 792;
  const top = options.top || 740;
  const bottom = options.bottom || 54;
  const lineHeight = options.lineHeight || 14;
  const maxLines = Math.max(1, Math.floor((top - bottom) / lineHeight));

  for (let index = 0; index < lines.length; index += maxLines) {
    pages.push(lines.slice(index, index + maxLines));
  }

  return pages.length ? pages : [[]];
}

function buildPdf(lines, options = {}) {
  const pageWidth = options.pageWidth || 612;
  const pageHeight = options.pageHeight || 792;
  const marginLeft = options.marginLeft || 54;
  const top = options.top || 740;
  const lineHeight = options.lineHeight || 14;
  const pages = paginateLines(lines, { pageHeight, top, lineHeight, bottom: options.bottom || 54 });
  const objects = [];

  function addObject(content) {
    objects.push(Buffer.isBuffer(content) ? content : Buffer.from(String(content), "ascii"));
    return objects.length;
  }

  const fontObject = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageObjectIds = [];
  const contentObjectIds = [];

  pages.forEach((pageLines) => {
    const streamLines = ["BT", `/F1 ${options.fontSize || 10} Tf`, `${marginLeft} ${top} Td`];
    pageLines.forEach((line, index) => {
      if (index > 0) {
        streamLines.push(`0 -${lineHeight} Td`);
      }
      streamLines.push(`(${escapePdfText(line)}) Tj`);
    });
    streamLines.push("ET");
    const stream = Buffer.from(streamLines.join("\n"), "ascii");
    const contentObject = addObject(
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
        stream,
        Buffer.from("\nendstream", "ascii"),
      ])
    );
    contentObjectIds.push(contentObject);
    pageObjectIds.push(null);
  });

  const pagesObjectId = objects.length + pageObjectIds.length + 1;
  contentObjectIds.forEach((contentObject, index) => {
    const pageObject = addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`
    );
    pageObjectIds[index] = pageObject;
  });

  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  addObject(`<< /Type /Pages /Kids [${kids}] /Count ${pageObjectIds.length} >>`);
  const catalogObject = addObject(`<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`);

  const chunks = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, "ascii"));
    chunks.push(object);
    chunks.push(Buffer.from("\nendobj\n", "ascii"));
  });

  const xrefOffset = Buffer.concat(chunks).length;
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
  ].join("\n");
  chunks.push(Buffer.from(xref, "ascii"));

  return Buffer.concat(chunks);
}

function buildHistoryPdf({ solicitud, historial = [], generatedAt }) {
  const lines = [
    "Portal FMN - Historial de solicitud",
    `Solicitud: #${solicitud.id}`,
    `Equipo: ${solicitud.nombre_equipo || solicitud.equipo || "Sin equipo"}`,
    `Solicitante: ${solicitud.solicitante_name || solicitud.solicitante || "Usuario"}`,
    `Estado: ${solicitud.estado || "-"}`,
    `Generado: ${generatedAt}`,
    "",
  ];

  if (!historial.length) {
    lines.push("Sin historial registrado.");
  } else {
    historial.forEach((item) => {
      lines.push(`Fecha: ${item.created_at || "-"}`);
      lines.push(`Accion: ${item.accion || "EVENTO"}`);
      lines.push(`Actor: ${item.actor_name || "Sistema"}`);
      if (item.estado_anterior || item.estado_nuevo) {
        lines.push(`Cambio: ${item.estado_anterior || "-"} -> ${item.estado_nuevo || "-"}`);
      }
      wrapText(`Detalle: ${item.detalle || "Sin detalle"}`, 94).forEach((line) => lines.push(line));
      lines.push("");
    });
  }

  return buildPdf(lines, { fontSize: 10, lineHeight: 14 });
}

module.exports = {
  buildHistoryPdf,
  wrapText,
};
