// Reporte de consumo por producto. Responde la pregunta operativa de fondo:
// "cuanto papel higienico se pidio y cuanto conviene tener en stock".
//
// Se apoya en listSolicitudesForExport para heredar el filtrado por rol: un
// JEFE_FAENA solo puede agregar lo de su equipo, sin logica de permisos nueva.
//
// El orden de calculo importa: primero se detectan los pedidos anormales a
// nivel de linea -donde hay suficientes datos para saber que es normal- y
// recien despues se suma por periodo. Si se hiciera al reves, un pedido con un
// cero de mas se llevaria el stock sugerido para arriba y nadie lo notaria.

const solicitudesService = require("./solicitudesService");
const productoAliasService = require("./productoAliasService");
const {
  buildProductoKey,
  normalizeUnidad,
  pickNombreVisible,
  detectarPosiblesDuplicados,
} = require("../utils/productoKey");
const estadistica = require("../utils/estadistica");
const periodos = require("../utils/periodos");

// Una solicitud rechazada no representa consumo real, no debe inflar el stock.
const ESTADOS_EXCLUIDOS = new Set(["RECHAZADO"]);

function redondear(valor, decimales = 1) {
  const factor = 10 ** decimales;
  return Math.round((Number(valor) || 0) * factor) / factor;
}

/**
 * Recorre las solicitudes y arma, por producto, la lista de pedidos
 * individuales. Es la materia prima de todo lo demas.
 */
function recolectarPedidos(solicitudes, alias, agrupacion) {
  const productos = new Map();
  const periodosVistos = new Map();
  const equiposVistos = new Set();

  let totalUnidades = 0;
  let solicitudesConsideradas = 0;

  for (const solicitud of solicitudes) {
    if (ESTADOS_EXCLUIDOS.has(String(solicitud.estado || "").toUpperCase())) {
      continue;
    }

    const periodo = periodos.periodoDe(solicitud.created_at, agrupacion);
    const equipo = solicitud.equipo || "Sin equipo";
    if (periodo) {
      periodosVistos.set(periodo.clave, periodo);
    }
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

      // Si alguien declaro que este nombre es el mismo producto que otro, se
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
          solicitudes: new Set(),
          pedidos: [],
        });
      }

      const registro = productos.get(clave);
      registro.solicitudes.add(solicitud.id);
      registro.variantes.set(nombreCrudo, (registro.variantes.get(nombreCrudo) || 0) + 1);

      const unidad = normalizeUnidad(item.unidad_medida);
      if (unidad) {
        registro.unidades.set(unidad, (registro.unidades.get(unidad) || 0) + 1);
      }

      registro.pedidos.push({
        solicitud_id: solicitud.id,
        cantidad,
        equipo,
        fecha: solicitud.created_at,
        fecha_corta: periodos.fechaCorta(solicitud.created_at),
        periodo: periodo?.clave || "",
        nombre_escrito: nombreCrudo,
      });
    }
  }

  return { productos, periodosVistos, equiposVistos, totalUnidades, solicitudesConsideradas };
}

function sumarPorPeriodo(pedidos, claves) {
  const totales = {};
  for (const clave of claves) {
    totales[clave] = 0;
  }
  for (const pedido of pedidos) {
    if (pedido.periodo in totales) {
      totales[pedido.periodo] += pedido.cantidad;
    }
  }
  return totales;
}

function sumarPorEquipo(pedidos) {
  const totales = {};
  for (const pedido of pedidos) {
    totales[pedido.equipo] = (totales[pedido.equipo] || 0) + pedido.cantidad;
  }
  return totales;
}

async function getConsumo(actor, filters = {}) {
  const agrupacion = periodos.normalizarAgrupacion(filters.agrupacion);

  const [solicitudes, alias] = await Promise.all([
    solicitudesService.listSolicitudesForExport(actor, filters),
    productoAliasService.buildResolver(),
  ]);

  const { productos, periodosVistos, equiposVistos, totalUnidades, solicitudesConsideradas } =
    recolectarPedidos(solicitudes, alias, agrupacion);

  const clavesPeriodo = [...periodosVistos.keys()].sort();
  const etiquetasPeriodo = clavesPeriodo.map((clave) => periodosVistos.get(clave).etiqueta);

  // El ultimo periodo casi siempre esta a medias: si se pide "este mes", el mes
  // en curso lleva pocos dias. Contarlo como un periodo completo hace que
  // siempre parezca una caida. Se muestra en el grafico pero no se usa para
  // calcular stock ni tendencia.
  const hasta = filters.fechaHasta ? periodos.aFecha(`${filters.fechaHasta} 23:59:59`) : null;
  const corte = hasta && hasta < new Date() ? hasta : new Date();
  const ultimaClave = clavesPeriodo[clavesPeriodo.length - 1];
  const periodoIncompleto =
    ultimaClave && periodosVistos.get(ultimaClave).fin > corte ? ultimaClave : null;

  const clavesCompletas = clavesPeriodo.filter((c) => c !== periodoIncompleto);

  const atipicosGlobales = [];

  const filas = [...productos.values()]
    .map((registro) => {
      const variantes = [...registro.variantes.entries()]
        .map(([nombre, conteo]) => ({ nombre, conteo }))
        .sort((a, b) => b.conteo - a.conteo);

      const unidadMasUsada = [...registro.unidades.entries()].sort((a, b) => b[1] - a[1])[0];

      // 1. Pedidos anormalmente altos, mirando las lineas individuales.
      const atipicos = estadistica.detectarAtipicos(registro.pedidos);
      const idsAtipicos = new Set(
        atipicos.map((a) => `${a.solicitud_id}|${a.nombre_escrito}|${a.cantidad}`)
      );

      // 2. El stock se calcula ignorandolos: son justamente lo que no hay que
      //    tener en bodega todos los meses.
      const pedidosNormales = registro.pedidos.filter(
        (p) => !idsAtipicos.has(`${p.solicitud_id}|${p.nombre_escrito}|${p.cantidad}`)
      );

      const porPeriodo = sumarPorPeriodo(registro.pedidos, clavesPeriodo);
      const porPeriodoNormal = sumarPorPeriodo(pedidosNormales, clavesPeriodo);

      const totalUnidadesProducto = registro.pedidos.reduce((acc, p) => acc + p.cantidad, 0);
      const unidadesAtipicas = atipicos.reduce((acc, a) => acc + a.cantidad, 0);

      // Un producto que recien empezo a pedirse en junio no tiene "consumo cero"
      // en mayo: simplemente no existia. Contar esos meses hundiria la mediana
      // y haria parecer que el consumo se disparo. Se cuenta desde su primer
      // periodo con movimiento.
      const primeraConConsumo = clavesPeriodo.find((c) => (porPeriodo[c] || 0) > 0);
      const desdeQueExiste = primeraConConsumo
        ? clavesPeriodo.slice(clavesPeriodo.indexOf(primeraConConsumo))
        : clavesPeriodo;

      // Un periodo con un pedido atipico no es un periodo de consumo cero: es
      // un periodo del que no sabemos el consumo real. Se descarta entero, en
      // vez de contarlo como 0, que hundiria la mediana y la tendencia.
      const periodosConAtipico = new Set(atipicos.map((a) => a.periodo));
      const clavesConfiables = desdeQueExiste.filter(
        (c) => clavesCompletas.includes(c) && !periodosConAtipico.has(c)
      );
      const serieConfiable = (clavesConfiables.length ? clavesConfiables : clavesPeriodo).map(
        (c) => porPeriodoNormal[c]
      );

      const stock = estadistica.sugerirStock(serieConfiable);
      const tendencia = estadistica.calcularTendencia(serieConfiable);

      // Promedio crudo, con atipicos incluidos. Solo sirve para mostrar cuanto
      // se habria desviado la sugerencia si no se hubieran descartado.
      const promedioSinCorregir = estadistica.promedio(
        clavesPeriodo.map((c) => porPeriodo[c])
      );

      const nombreElegido = alias.nombreDe(registro.clave);
      const unificadosAMano = alias.variantesDe(registro.clave);
      const nombre = nombreElegido || pickNombreVisible(variantes) || registro.clave;

      for (const atipico of atipicos) {
        atipicosGlobales.push({ ...atipico, producto: nombre, clave: registro.clave });
      }

      return {
        clave: registro.clave,
        nombre,
        variantes,
        escrito_de_formas: variantes.length,
        unificado_a_mano: unificadosAMano.length > 0,
        nombres_unificados: unificadosAMano,
        unidad: unidadMasUsada ? unidadMasUsada[0] : "",

        total_unidades: totalUnidadesProducto,
        total_solicitudes: registro.solicitudes.size,
        por_periodo: porPeriodo,
        por_periodo_normal: porPeriodoNormal,
        por_equipo: sumarPorEquipo(registro.pedidos),

        // Estadistica robusta: la mediana no se mueve por un pedido raro.
        tipico: stock.tipico,
        promedio: stock.promedio,
        promedio_sin_corregir: redondear(promedioSinCorregir),
        sugerido_min: stock.minimo,
        sugerido_max: stock.maximo,
        regularidad: stock.regularidad,
        periodos_con_consumo: stock.periodos_con_consumo,
        tendencia,

        atipicos,
        unidades_atipicas: unidadesAtipicas,
      };
    })
    .sort((a, b) => b.total_unidades - a.total_unidades);

  // El grafico muestra el consumo real -incluidos los atipicos, porque se
  // pidieron de verdad- pero la tendencia se lee sobre los datos limpios.
  const consumoPorPeriodo = {};
  const consumoPorPeriodoNormal = {};
  for (const clave of clavesPeriodo) {
    consumoPorPeriodo[clave] = filas.reduce((acc, f) => acc + (f.por_periodo[clave] || 0), 0);
    consumoPorPeriodoNormal[clave] = filas.reduce(
      (acc, f) => acc + (f.por_periodo_normal[clave] || 0),
      0
    );
  }

  return {
    periodo: {
      desde: filters.fechaDesde || null,
      hasta: filters.fechaHasta || null,
      agrupacion,
      claves: clavesPeriodo,
      etiquetas: etiquetasPeriodo,
      // Se avisa cual esta a medias para que el grafico lo marque y nadie lea
      // una caida donde solo faltan dias por transcurrir.
      incompleto: periodoIncompleto,
      etiqueta_incompleto: periodoIncompleto
        ? periodosVistos.get(periodoIncompleto).etiqueta
        : null,
    },
    totales: {
      productos_distintos: filas.length,
      unidades: totalUnidades,
      solicitudes: solicitudesConsideradas,
      periodos: clavesPeriodo.length,
      pedidos_atipicos: atipicosGlobales.length,
    },
    consumo_por_periodo: consumoPorPeriodo,
    tendencia_general: estadistica.calcularTendencia(
      clavesCompletas.map((c) => consumoPorPeriodoNormal[c])
    ),
    equipos: [...equiposVistos].sort(),
    productos: filas,
    // Pedidos que se salen de lo normal. No se borran: se muestran para que
    // alguien confirme si fue un error de tipeo o un consumo real.
    atipicos: atipicosGlobales
      .sort((a, b) => (b.veces_lo_tipico || 0) - (a.veces_lo_tipico || 0))
      .slice(0, 30),
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
  redondear,
};
