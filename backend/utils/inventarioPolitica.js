// Sistema de inventario de revision periodica (R, S).
//
// Cada R (una semana) alguien mira el stock y pide hasta completar un nivel
// objetivo S. No es un (s, Q) con punto de reorden porque en faena nadie esta
// mirando el stock de forma continua: la secretaria revisa y pide, y eso es
// exactamente lo que modela la revision periodica.
//
// NO se calcula EOQ. El EOQ es sqrt(2*D*S/H) y necesita el costo de emitir un
// pedido y el costo de mantener inventario. El portal no tiene ninguno de los
// dos, y ponerles un numero inventado daria una cantidad optima con aire de
// exactitud que en realidad no significa nada. Cuando existan esos datos, el
// EOQ se agrega aparte.
//
// Lo que si sale de datos reales:
//   - la demanda y su variabilidad, del historial de consumo;
//   - el lead time y SU variabilidad, de la diferencia entre cuando se pidio
//     (created_at) y cuando se recibio (received_at).
//
// Que el lead time sea incierto importa: si un proveedor a veces demora 3 dias
// y a veces 15, el stock de seguridad tiene que cubrir esa demora, no solo la
// variacion de la demanda.

const DIAS_POR_SEMANA = 7;

// Periodo de revision, en semanas. La secretaria revisa y pide una vez por
// semana, que ademas calza con la rotacion de turnos.
const PERIODO_REVISION_SEMANAS = 1;

// z para un nivel de servicio del 95%: se acepta quedar sin stock en 1 de cada
// 20 ciclos. Es el valor estandar y el que se acordo para este portal.
const Z_NIVEL_SERVICIO = 1.65;
const NIVEL_SERVICIO = 0.95;

// Con menos historia que esto, la desviacion estandar de la demanda no
// significa nada y la politica saldria inventada.
const MINIMO_SEMANAS_DEMANDA = 6;

// Lead times propios del producto. Con menos, se usa el del portal completo:
// es mejor un promedio general real que una media de dos datos.
const MINIMO_ENTREGAS_LEAD_TIME = 3;

// Lead time declarado por la operacion, para cuando todavia no hay entregas
// medidas. NO es un numero inventado: es lo que reporta quien hace los
// pedidos. Van a buscar las cosas y demoran entre 1 y 3 dias normalmente, con
// 7 como el peor caso que se ha visto.
//
// De esos tres numeros se saca media y desviacion con la formula PERT (beta),
// la misma que se usa en planificacion de proyectos cuando solo se tiene una
// estimacion optimista, una probable y una pesimista:
//
//   media = (min + 4*probable + max) / 6
//   sigma = (max - min) / 6
//
// Queda marcado con origen "estimado" para que la pantalla pueda decir que
// esto es lo que declara la operacion y no algo medido. En cuanto haya
// entregas reales registradas, el medido manda.
const LEAD_TIME_DECLARADO = { minimo: 1, probable: 3, maximo: 7 };

function leadTimeDeclarado() {
  const { minimo, probable, maximo } = LEAD_TIME_DECLARADO;
  const mediaDias = (minimo + 4 * probable + maximo) / 6;
  const sigmaDias = (maximo - minimo) / 6;

  return {
    origen: "estimado",
    entregas: 0,
    dias_promedio: Math.round(mediaDias * 10) / 10,
    dias_desviacion: Math.round(sigmaDias * 10) / 10,
    semanas_promedio: mediaDias / DIAS_POR_SEMANA,
    semanas_desviacion: sigmaDias / DIAS_POR_SEMANA,
    detalle: `Segun la operacion: entre ${minimo} y ${maximo} dias, normalmente ${probable}`,
  };
}

function media(valores) {
  if (!valores.length) return 0;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

/**
 * Desviacion estandar muestral (divide por n-1). Es la que corresponde cuando
 * los datos son una muestra del comportamiento y no la poblacion completa, y
 * es la que usan Excel (DESVEST) y R (sd) por defecto.
 */
function desviacionEstandar(valores) {
  if (valores.length < 2) return 0;
  const m = media(valores);
  const suma = valores.reduce((acumulado, v) => acumulado + (v - m) ** 2, 0);
  return Math.sqrt(suma / (valores.length - 1));
}

/**
 * Lead time en semanas a partir de las solicitudes ya recibidas.
 * Devuelve null si no hay suficientes entregas para que el numero valga algo.
 */
function calcularLeadTime(entregas = []) {
  const dias = entregas
    .map(({ pedido, recibido }) => {
      if (!pedido || !recibido) return null;
      const inicio = new Date(pedido).getTime();
      const fin = new Date(recibido).getTime();
      if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin < inicio) return null;
      return (fin - inicio) / 86400000;
    })
    .filter((d) => d !== null);

  if (dias.length < MINIMO_ENTREGAS_LEAD_TIME) {
    return null;
  }

  return {
    entregas: dias.length,
    dias_promedio: Math.round(media(dias) * 10) / 10,
    dias_desviacion: Math.round(desviacionEstandar(dias) * 10) / 10,
    semanas_promedio: media(dias) / DIAS_POR_SEMANA,
    semanas_desviacion: desviacionEstandar(dias) / DIAS_POR_SEMANA,
  };
}

/**
 * Politica (R, S) para un producto.
 *
 * @param demandaSemanal serie de consumo por semana, ya alineada y sin huecos.
 * @param leadTime resultado de calcularLeadTime (el del producto o el global).
 * @param stockActual posicion de inventario de hoy.
 */
function calcularPolitica({ demandaSemanal = [], leadTime = null, stockActual = 0 }) {
  if (demandaSemanal.length < MINIMO_SEMANAS_DEMANDA) {
    return {
      disponible: false,
      motivo: "pocos_datos",
      semanas_con_datos: demandaSemanal.length,
      semanas_necesarias: MINIMO_SEMANAS_DEMANDA,
      mensaje:
        `Se necesitan al menos ${MINIMO_SEMANAS_DEMANDA} semanas de consumo para calcular ` +
        `cuánto pedir. Hay ${demandaSemanal.length}.`,
    };
  }

  if (!leadTime) {
    return {
      disponible: false,
      motivo: "sin_lead_time",
      mensaje:
        "Todavia no hay entregas suficientes para saber cuanto demora en llegar. " +
        "Se necesita que se registre la recepción de al menos " +
        `${MINIMO_ENTREGAS_LEAD_TIME} pedidos.`,
    };
  }

  const d = media(demandaSemanal);
  const sigmaD = desviacionEstandar(demandaSemanal);
  const L = leadTime.semanas_promedio;
  const sigmaL = leadTime.semanas_desviacion;
  const R = PERIODO_REVISION_SEMANAS;

  // Intervalo de proteccion: lo que hay que cubrir es el tiempo hasta la
  // proxima revision MAS lo que demora en llegar el pedido. Ese es el error
  // clasico de dimensionar solo contra el lead time.
  const intervalo = R + L;

  // Demanda esperada durante el intervalo de proteccion.
  const demandaIntervalo = d * intervalo;

  // Variabilidad combinada: la de la demanda a lo largo del intervalo, mas la
  // que aporta que el propio lead time sea incierto (d^2 * sigmaL^2).
  const varianza = intervalo * sigmaD ** 2 + d ** 2 * sigmaL ** 2;
  const sigmaIntervalo = Math.sqrt(varianza);

  const stockSeguridad = Z_NIVEL_SERVICIO * sigmaIntervalo;
  const nivelObjetivo = demandaIntervalo + stockSeguridad;
  const pedirAhora = Math.max(0, nivelObjetivo - stockActual);

  // Coeficiente de variacion: dice si la demanda es estable o errática, que es
  // lo que determina si vale la pena confiar en el numero.
  const cv = d > 0 ? sigmaD / d : 0;

  return {
    disponible: true,
    demanda_semanal: Math.round(d * 10) / 10,
    demanda_desviacion: Math.round(sigmaD * 10) / 10,
    coeficiente_variacion: Math.round(cv * 100) / 100,
    lead_time_dias: leadTime.dias_promedio,
    lead_time_desviacion_dias: leadTime.dias_desviacion,
    lead_time_entregas: leadTime.entregas,
    periodo_revision_semanas: R,
    intervalo_proteccion_semanas: Math.round(intervalo * 10) / 10,
    demanda_intervalo: Math.round(demandaIntervalo),
    stock_seguridad: Math.ceil(stockSeguridad),
    nivel_objetivo: Math.ceil(nivelObjetivo),
    stock_actual: stockActual,
    pedir_ahora: Math.ceil(pedirAhora),
    nivel_servicio: NIVEL_SERVICIO,
    semanas_analizadas: demandaSemanal.length,
    confianza: clasificarConfianza(cv, demandaSemanal.length),
  };
}

/**
 * Que tan en serio tomarse el numero. Manda el coeficiente de variacion: una
 * demanda pareja se proyecta bien aunque haya poca historia, y una erratica no
 * se proyecta bien ni con mucha.
 */
function clasificarConfianza(cv, semanas) {
  if (cv <= 0.35 && semanas >= 12) {
    return { nivel: "alta", texto: "El consumo es parejo: el número es confiable" };
  }
  if (cv <= 0.75) {
    return { nivel: "media", texto: "El consumo varia algo: usar como referencia" };
  }
  return {
    nivel: "baja",
    texto: "El consumo es muy irregular: conviene revisarlo a mano",
  };
}

module.exports = {
  calcularLeadTime,
  calcularPolitica,
  desviacionEstandar,
  media,
  PERIODO_REVISION_SEMANAS,
  Z_NIVEL_SERVICIO,
  NIVEL_SERVICIO,
  MINIMO_SEMANAS_DEMANDA,
  MINIMO_ENTREGAS_LEAD_TIME,
  DIAS_POR_SEMANA,
};
