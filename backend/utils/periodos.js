// Agrupacion temporal del reporte de consumo.
//
// El mes es comodo para comparar, pero la operacion en faena se mueve por
// semana: se pide el lunes, se despacha el miercoles. Por eso se puede agrupar
// de las dos formas.

const NOMBRE_MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** Las fechas vienen como 'YYYY-MM-DD HH:MM:SS' desde SQLite y como Date desde PG. */
function aFecha(valor) {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor;
  }
  const texto = String(valor || "").trim();
  if (!texto) return null;
  // Se interpreta como hora local para que un pedido del lunes temprano no
  // caiga en la semana anterior por corrimiento de zona horaria.
  const fecha = new Date(texto.replace(" ", "T"));
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function dosDigitos(n) {
  return String(n).padStart(2, "0");
}

/**
 * Semana ISO 8601: empieza el lunes y la semana 1 es la que contiene el primer
 * jueves del ano. Es el mismo criterio que usan Excel (ISOWEEKNUM) y R.
 */
function semanaISO(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  // Jueves de esa semana: define a que ano pertenece.
  const diaSemana = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana);
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const numero = Math.ceil(((d - inicioAno) / 86400000 + 1) / 7);
  return { ano: d.getUTCFullYear(), numero };
}

/** Lunes de la semana a la que pertenece la fecha. */
function lunesDe(fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  const diaSemana = d.getDay() || 7;
  d.setDate(d.getDate() - (diaSemana - 1));
  return d;
}

function claveMes(fecha) {
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}`;
}

function claveSemana(fecha) {
  const { ano, numero } = semanaISO(fecha);
  return `${ano}-S${dosDigitos(numero)}`;
}

function etiquetaMes(clave) {
  const [ano, mes] = String(clave || "").split("-");
  const indice = Number(mes) - 1;
  if (!ano || !NOMBRE_MESES[indice]) return clave || "-";
  return `${NOMBRE_MESES[indice]} ${ano}`;
}

/** "6 - 12 ene" dice mas que "semana 2" cuando hay que ir a revisar. */
function etiquetaSemana(clave, lunes) {
  if (!lunes) return clave || "-";
  const domingo = new Date(lunes);
  domingo.setDate(domingo.getDate() + 6);

  const mesLunes = NOMBRE_MESES[lunes.getMonth()];
  const mesDomingo = NOMBRE_MESES[domingo.getMonth()];

  return mesLunes === mesDomingo
    ? `${lunes.getDate()} - ${domingo.getDate()} ${mesDomingo}`
    : `${lunes.getDate()} ${mesLunes} - ${domingo.getDate()} ${mesDomingo}`;
}

/**
 * Devuelve la clave del periodo y su etiqueta legible para una fecha dada.
 * @param {"mes"|"semana"} agrupacion
 */
function periodoDe(valorFecha, agrupacion = "mes") {
  const fecha = aFecha(valorFecha);
  if (!fecha) {
    return null;
  }

  if (agrupacion === "semana") {
    const clave = claveSemana(fecha);
    const lunes = lunesDe(fecha);
    const domingo = new Date(lunes);
    domingo.setDate(domingo.getDate() + 6);
    domingo.setHours(23, 59, 59, 999);
    return { clave, etiqueta: etiquetaSemana(clave, lunes), fin: domingo };
  }

  const clave = claveMes(fecha);
  // Dia 0 del mes siguiente = ultimo dia de este mes.
  const fin = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0, 23, 59, 59, 999);
  return { clave, etiqueta: etiquetaMes(clave), fin };
}

function normalizarAgrupacion(valor) {
  return String(valor || "").toLowerCase() === "semana" ? "semana" : "mes";
}

/** Fecha corta para mostrar un pedido puntual: "12 jul". */
function fechaCorta(valorFecha) {
  const fecha = aFecha(valorFecha);
  if (!fecha) return "-";
  return `${fecha.getDate()} ${NOMBRE_MESES[fecha.getMonth()]}`;
}

module.exports = {
  aFecha,
  periodoDe,
  normalizarAgrupacion,
  etiquetaMes,
  etiquetaSemana,
  semanaISO,
  lunesDe,
  fechaCorta,
};
