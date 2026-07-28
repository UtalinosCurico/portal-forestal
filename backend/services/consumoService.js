// Reporte de consumo por producto. Responde la pregunta operativa de fondo:
// "cuanto papel higienico se pidio este mes y cuanto conviene tener en stock".
//
// Se apoya en listSolicitudesForExport para heredar el filtrado por rol: un
// JEFE_FAENA solo puede agregar lo de su equipo, sin logica de permisos nueva.

const solicitudesService = require("./solicitudesService");
const productoAliasService = require("./productoAliasService");
const {
  buildProductoKey,
  normalizeUnidad,
  pickNombreVisible,
  detectarPosiblesDuplicados,
} = require("../utils/productoKey");

// Una solicitud rechazada no representa consumo real, no debe inflar el stock.
const ESTADOS_EXCLUIDOS = new Set(["RECHAZADO"]);

function mesDe(fechaTexto) {
  const texto = String(fechaTexto || "");
  return texto.length >= 7 ? texto.slice(0, 7) : "";
}

function listarMesesDelPeriodo(meses) {
  return [...meses].filter(Boolean).sort();
}

function redondearArriba(valor) {
  return Math.max(0, Math.ceil(Number(valor) || 0));
}

/**
 * Sugerencia de stock a partir del historial.
 *
 * - minimo: el consumo de un mes promedio, para no quedar corto en un mes normal
 * - maximo: el mes de mayor consumo con un 50% de holgura, para aguantar un peak
 *
 * Son sugerencias, no verdades: con un solo mes de historia el promedio es ese
 * mes y hay que decirlo, por eso se devuelve tambien `meses_con_datos`.
 */
function sugerirStock(porMes, mesesDelPeriodo) {
  const valores = mesesDelPeriodo.map((mes) => Number(porMes[mes] || 0));
  const mesesConDatos = valores.filter((v) => v > 0).length;

  if (!valores.length) {
    return { promedio_mensual: 0, sugerido_min: 0, sugerido_max: 0, meses_con_datos: 0 };
  }

  const total = valores.reduce((acc, v) => acc + v, 0);
  const promedio = total / valores.length;
  const peak = Math.max(...valores);

  return {
    promedio_mensual: Number(promedio.toFixed(1)),
    sugerido_min: redondearArriba(promedio),
    sugerido_max: redondearArriba(peak * 1.5),
    meses_con_datos: mesesConDatos,
  };
}

async function getConsumo(actor, filters = {}) {
  const [solicitudes, alias] = await Promise.all([
    solicitudesService.listSolicitudesForExport(actor, filters),
    productoAliasService.buildResolver(),
  ]);

  const productos = new Map();
  const mesesVistos = new Set();
  const equiposVistos = new Set();

  let totalUnidades = 0;
  let solicitudesConsideradas = 0;

  for (const solicitud of solicitudes) {
    if (ESTADOS_EXCLUIDOS.has(String(solicitud.estado || "").toUpperCase())) {
      continue;
    }

    const mes = mesDe(solicitud.created_at);
    const equipo = solicitud.equipo || "Sin equipo";
    if (mes) mesesVistos.add(mes);
    equiposVistos.add(equipo);
    solicitudesConsideradas += 1;

    // Solicitudes antiguas guardaban un solo repuesto en la propia solicitud,
    // antes de que existiera la tabla de items. Hay que contarlas igual.
    const items = solicitud.items?.length
      ? solicitud.items
      : solicitud.repuesto
        ? [{ nombre_item: solicitud.repuesto, cantidad: solicitud.cantidad || 0 }]
        : [];

    for (const item of items) {
      const nombreCrudo = String(item.nombre_item || "").trim();
      const claveOriginal = buildProductoKey(nombreCrudo);
      if (!claveOriginal) {
        continue;
      }

      // Si un ADMIN declaro que este nombre es el mismo producto que otro, se
      // suma alla. Es la unica forma de agrupar lo que la normalizacion
      // automatica no puede saber por su cuenta.
      const clave = alias.resolver(claveOriginal);

      const cantidad = Number(item.cantidad) || 0;
      totalUnidades += cantidad;

      if (!productos.has(clave)) {
        productos.set(clave, {
          clave,
          variantes: new Map(),
          unidades: new Map(),
          total_unidades: 0,
          solicitudes: new Set(),
          por_mes: {},
          por_equipo: {},
        });
      }

      const registro = productos.get(clave);
      registro.total_unidades += cantidad;
      registro.solicitudes.add(solicitud.id);
      registro.variantes.set(nombreCrudo, (registro.variantes.get(nombreCrudo) || 0) + 1);

      const unidad = normalizeUnidad(item.unidad_medida);
      if (unidad) {
        registro.unidades.set(unidad, (registro.unidades.get(unidad) || 0) + 1);
      }

      if (mes) {
        registro.por_mes[mes] = (registro.por_mes[mes] || 0) + cantidad;
      }
      registro.por_equipo[equipo] = (registro.por_equipo[equipo] || 0) + cantidad;
    }
  }

  const meses = listarMesesDelPeriodo(mesesVistos);

  const filas = [...productos.values()]
    .map((registro) => {
      const variantes = [...registro.variantes.entries()]
        .map(([nombre, conteo]) => ({ nombre, conteo }))
        .sort((a, b) => b.conteo - a.conteo);

      const unidadMasUsada = [...registro.unidades.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0];

      // Si el ADMIN eligio con que nombre quedaba el producto al unificarlo,
      // ese manda por sobre el mas frecuente.
      const nombreElegido = alias.nombreDe(registro.clave);
      const unificadosAMano = alias.variantesDe(registro.clave);

      return {
        clave: registro.clave,
        nombre: nombreElegido || pickNombreVisible(variantes) || registro.clave,
        unificado_a_mano: unificadosAMano.length > 0,
        nombres_unificados: unificadosAMano,
        // Se exponen las variantes para que se vea que quedo agrupado bajo un
        // mismo nombre y se pueda detectar a simple vista una agrupacion mala.
        variantes,
        escrito_de_formas: variantes.length,
        unidad: unidadMasUsada ? unidadMasUsada[0] : "",
        total_unidades: registro.total_unidades,
        total_solicitudes: registro.solicitudes.size,
        por_mes: registro.por_mes,
        por_equipo: registro.por_equipo,
        ...sugerirStock(registro.por_mes, meses),
      };
    })
    .sort((a, b) => b.total_unidades - a.total_unidades);

  return {
    periodo: {
      desde: filters.fechaDesde || null,
      hasta: filters.fechaHasta || null,
      meses,
    },
    totales: {
      productos_distintos: filas.length,
      unidades: totalUnidades,
      solicitudes: solicitudesConsideradas,
    },
    equipos: [...equiposVistos].sort(),
    productos: filas,
    // Candidatos a ser el mismo producto escrito distinto. Nunca se unen solos.
    posibles_duplicados: detectarPosiblesDuplicados(filas.map((f) => f.clave)).map(
      (sugerencia) => ({
        ...sugerencia,
        nombres: sugerencia.claves.map(
          (clave) => filas.find((f) => f.clave === clave)?.nombre || clave
        ),
      })
    ),
  };
}

module.exports = {
  getConsumo,
};
