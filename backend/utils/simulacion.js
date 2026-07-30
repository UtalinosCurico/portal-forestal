// Simulacion Monte Carlo para responder cuanto conviene mantener de cada
// producto.
//
// Por que simular y no usar la formula (R,S) que ya esta en
// inventarioPolitica.js: esa formula asume que la demanda es Normal. Con esta
// operacion esa premisa es mala -la mayoria de los productos se pidieron muy
// pocas veces y la demanda es intermitente-, y una formula que asume una
// campana donde no la hay entrega un numero equivocado con cara de exacto.
//
// La simulacion no asume forma: remuestrea las semanas que realmente pasaron
// (bootstrap). Con pocos datos eso es mas honesto que ajustar una Poisson o
// una Normal, porque ajustar una distribucion con 15 observaciones es ponerle
// una forma a algo que todavia no la tiene. El bootstrap solo asume que el
// futuro se parece al pasado, que es un supuesto mucho mas debil.
//
// IMPORTANTE, y es lo que hace que esto sirva sin sistema de inventario: el
// stock NO es un dato de entrada. Es el resultado. La pregunta que se responde
// es "cuanto habria que mantener para no quebrar", no "cuanto pedir hoy", y
// para eso no hace falta saber cuanto hay en bodega ahora mismo.
//
// Limitacion que no se puede arreglar desde los datos: la demanda observada
// esta censurada. Se ve lo que se PIDIO, no lo que se NECESITO. Si algo se
// acabo y la gente se aguanto sin pedir, ese consumo no dejo rastro en ninguna
// tabla y ninguna simulacion lo puede recuperar. Hay que decirlo, no taparlo.

const { detectarAtipicos } = require("./estadistica");

const ITERACIONES_POR_DEFECTO = 10000;

// Minimo de semanas observadas para que el remuestreo signifique algo. Con
// menos, se estaria sorteando entre dos o tres valores y la "distribucion"
// resultante seria un artefacto.
const MINIMO_SEMANAS = 4;

/**
 * Generador con semilla (mulberry32). Se usa una semilla fija para que la
 * misma consulta devuelva siempre el mismo numero: un reporte que cambia solo
 * cada vez que se refresca no es defendible frente a nadie.
 */
function generador(semilla) {
  let estado = semilla >>> 0;
  return function siguiente() {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Muestra de una distribucion triangular por transformada inversa. Es la que
 * corresponde cuando lo que se tiene es una estimacion de tres puntos (minimo,
 * probable, maximo), que es exactamente como la operacion describe el lead
 * time: "entre 1 y 7 dias, normalmente 3".
 */
function muestraTriangular(minimo, probable, maximo, u) {
  if (maximo <= minimo) return minimo;
  const corte = (probable - minimo) / (maximo - minimo);

  if (u < corte) {
    return minimo + Math.sqrt(u * (maximo - minimo) * (probable - minimo));
  }
  return maximo - Math.sqrt((1 - u) * (maximo - minimo) * (maximo - probable));
}

function percentil(ordenados, p) {
  if (!ordenados.length) return 0;
  const posicion = (ordenados.length - 1) * p;
  const bajo = Math.floor(posicion);
  const alto = Math.ceil(posicion);
  if (bajo === alto) return ordenados[bajo];
  return ordenados[bajo] + (ordenados[alto] - ordenados[bajo]) * (posicion - bajo);
}

/**
 * Simula cuanta demanda cae durante el intervalo de proteccion -el tiempo
 * hasta la proxima revision mas lo que demora en llegar el pedido- y devuelve
 * la distribucion de ese total.
 *
 * El nivel a mantener es el percentil correspondiente al nivel de servicio: si
 * se quiere cubrir el 95% de las semanas, es el valor que dejo por debajo al
 * 95% de las simulaciones.
 *
 * @param demandaSemanal semanas observadas (incluidas las de consumo cero).
 * @param leadTimeDias   {minimo, probable, maximo} declarado u observado.
 * @param revisionSemanas cada cuanto se revisa y se pide.
 */
function simularNivelAMantener({
  demandaSemanal = [],
  leadTimeDias = { minimo: 1, probable: 3, maximo: 7 },
  revisionSemanas = 1,
  nivelServicio = 0.95,
  iteraciones = ITERACIONES_POR_DEFECTO,
  semilla = 42,
  excluirAtipicos = true,
} = {}) {
  if (demandaSemanal.length < MINIMO_SEMANAS) {
    return {
      disponible: false,
      motivo: "pocas_semanas",
      semanas_observadas: demandaSemanal.length,
      semanas_necesarias: MINIMO_SEMANAS,
      mensaje:
        `Se necesitan al menos ${MINIMO_SEMANAS} semanas observadas para simular. ` +
        `Hay ${demandaSemanal.length}.`,
    };
  }

  // Una sola semana rara arruina la recomendacion. Medido con datos reales:
  // la serie [20,22,18,21,19,300,20,23] -consumo normal de ~20- daba "mantener
  // 313" por culpa de ese 300, porque el bootstrap lo vuelve a sortear una de
  // cada ocho veces y el percentil 95 se va detras.
  //
  // Se usa el MISMO criterio de atipico que el resto del portal (Tukey 3xIQR y
  // ademas al menos 4 veces la mediana), para que "esto es raro" signifique lo
  // mismo en todas partes. No se borran: se informan aparte para que alguien
  // decida si fue un error de tipeo o una compra grande de verdad.
  const atipicos = excluirAtipicos
    ? detectarAtipicos(demandaSemanal.map((cantidad, semana) => ({ cantidad, semana })))
    : [];
  const semanasAtipicas = new Set(atipicos.map((a) => a.semana));
  const serie = demandaSemanal.filter((_, i) => !semanasAtipicas.has(i));

  if (serie.length < MINIMO_SEMANAS) {
    return {
      disponible: false,
      motivo: "pocas_semanas_tras_limpiar",
      semanas_observadas: serie.length,
      semanas_necesarias: MINIMO_SEMANAS,
      mensaje:
        `Al dejar fuera ${semanasAtipicas.size} semana(s) atipica(s) quedan ` +
        `${serie.length} semanas, y hacen falta ${MINIMO_SEMANAS}.`,
    };
  }

  const demandaSemanalUsada = serie;
  const aleatorio = generador(semilla);
  const totales = new Array(iteraciones);

  for (let i = 0; i < iteraciones; i += 1) {
    // 1. Cuanto demora en llegar esta vez.
    const diasLead = muestraTriangular(
      leadTimeDias.minimo,
      leadTimeDias.probable,
      leadTimeDias.maximo,
      aleatorio()
    );
    const intervaloSemanas = revisionSemanas + diasLead / 7;

    // 2. Cuanta demanda cae en ese intervalo. Se remuestrean semanas completas
    //    y la fraccion sobrante se prorratea sobre una semana adicional.
    const semanasEnteras = Math.floor(intervaloSemanas);
    const fraccion = intervaloSemanas - semanasEnteras;

    let total = 0;
    for (let s = 0; s < semanasEnteras; s += 1) {
      total += demandaSemanalUsada[Math.floor(aleatorio() * demandaSemanalUsada.length)];
    }
    if (fraccion > 0) {
      total +=
        demandaSemanalUsada[Math.floor(aleatorio() * demandaSemanalUsada.length)] * fraccion;
    }

    totales[i] = total;
  }

  const ordenados = [...totales].sort((a, b) => a - b);
  const media = totales.reduce((a, b) => a + b, 0) / iteraciones;
  const varianza =
    totales.reduce((acumulado, v) => acumulado + (v - media) ** 2, 0) / (iteraciones - 1);

  const nivel = percentil(ordenados, nivelServicio);
  const demandaMediaSemanal =
    demandaSemanalUsada.reduce((a, b) => a + b, 0) / demandaSemanalUsada.length;

  return {
    disponible: true,

    // La respuesta simple: esto es lo que ve la secretaria.
    nivel_a_mantener: Math.ceil(nivel),
    nivel_servicio: nivelServicio,
    frase:
      `Manteniendo ${Math.ceil(nivel)} alcanza en ${Math.round(nivelServicio * 100)} ` +
      `de cada 100 semanas`,

    // Las semanas dejadas fuera se informan: si se descartaran en silencio,
    // nadie se enteraria de que hubo un pedido de 300 que quizas fue un error
    // de tipeo -o una compra grande real que conviene tener en cuenta-.
    semanas_atipicas: atipicos.map((a) => ({
      semana: a.semana,
      cantidad: a.cantidad,
      veces_lo_tipico: a.veces_lo_tipico,
    })),

    // El detalle tecnico: esto va en el panel que se abre aparte.
    detalle: {
      metodo: "bootstrap sobre semanas observadas + lead time triangular",
      iteraciones,
      semanas_observadas: demandaSemanalUsada.length,
      demanda_media_semanal: Math.round(demandaMediaSemanal * 10) / 10,
      media_intervalo: Math.round(media * 10) / 10,
      desviacion_intervalo: Math.round(Math.sqrt(varianza) * 10) / 10,
      lead_time_dias: leadTimeDias,
      revision_semanas: revisionSemanas,
      percentiles: {
        p50: Math.ceil(percentil(ordenados, 0.5)),
        p75: Math.ceil(percentil(ordenados, 0.75)),
        p90: Math.ceil(percentil(ordenados, 0.9)),
        p95: Math.ceil(percentil(ordenados, 0.95)),
        p99: Math.ceil(percentil(ordenados, 0.99)),
      },
      // Sobredispersion: si la varianza supera a la media, la demanda no es
      // Poisson y conviene desconfiar de cualquier formula que lo asuma.
      sobredispersion: calcularSobredispersion(demandaSemanalUsada),
      histograma: construirHistograma(ordenados),
    },

    advertencia_censura:
      "Se simula sobre lo que se pidio, no sobre lo que se necesito. Si alguna " +
      "vez algo se acabo y nadie lo pidio, ese consumo no quedo registrado en " +
      "ninguna parte y esta simulacion no lo puede ver.",
  };
}

/**
 * Razon varianza/media de la demanda semanal. En una Poisson vale 1. Por
 * encima de 1 hay mas dispersion de la que esa distribucion admite, que es lo
 * tipico de la demanda intermitente.
 */
function calcularSobredispersion(demandaSemanal) {
  const media = demandaSemanal.reduce((a, b) => a + b, 0) / demandaSemanal.length;
  if (media <= 0) return null;

  const varianza =
    demandaSemanal.reduce((acumulado, v) => acumulado + (v - media) ** 2, 0) /
    Math.max(1, demandaSemanal.length - 1);
  const razon = varianza / media;

  return {
    razon: Math.round(razon * 100) / 100,
    interpretacion:
      razon > 1.5
        ? "La demanda varia mas de lo que admite una Poisson: usar la simulacion, no una formula"
        : "La demanda es razonablemente pareja",
  };
}

/** Histograma para dibujar la distribucion en el panel tecnico. */
function construirHistograma(ordenados, cajas = 12) {
  const minimo = ordenados[0];
  const maximo = ordenados[ordenados.length - 1];

  if (maximo === minimo) {
    return [{ desde: minimo, hasta: maximo, cuenta: ordenados.length }];
  }

  const ancho = (maximo - minimo) / cajas;
  const cuentas = new Array(cajas).fill(0);

  for (const valor of ordenados) {
    const indice = Math.min(cajas - 1, Math.floor((valor - minimo) / ancho));
    cuentas[indice] += 1;
  }

  return cuentas.map((cuenta, i) => ({
    desde: Math.round(minimo + i * ancho),
    hasta: Math.round(minimo + (i + 1) * ancho),
    cuenta,
  }));
}

module.exports = {
  simularNivelAMantener,
  muestraTriangular,
  calcularSobredispersion,
  percentil,
  generador,
  MINIMO_SEMANAS,
  ITERACIONES_POR_DEFECTO,
};
