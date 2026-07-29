// Estadistica para el reporte de consumo.
//
// El promedio miente cuando hay un pedido raro. Si en cuatro meses se pidieron
// 20, 22, 18 y 400 unidades, el promedio da 115 y el stock sugerido queda
// absurdo por un solo dato que probablemente fue un error de tipeo. La mediana
// da 21, que es lo que realmente se consume.
//
// Por eso todo lo de aca usa medidas robustas -mediana, cuartiles, percentiles-
// y ademas se detectan esos pedidos raros para poder revisarlos.

/** Ordena una copia; nunca muta el arreglo recibido. */
function ordenar(valores) {
  return [...valores].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

/**
 * Percentil por interpolacion lineal (metodo 7, el que usan R y numpy por
 * defecto). Con pocos datos evita saltos bruscos entre valores.
 */
function percentil(valores, p) {
  const datos = ordenar(valores);
  if (!datos.length) return 0;
  if (datos.length === 1) return datos[0];

  const posicion = (datos.length - 1) * p;
  const inferior = Math.floor(posicion);
  const superior = Math.ceil(posicion);

  if (inferior === superior) return datos[inferior];

  const peso = posicion - inferior;
  return datos[inferior] * (1 - peso) + datos[superior] * peso;
}

function mediana(valores) {
  return percentil(valores, 0.5);
}

function promedio(valores) {
  const datos = ordenar(valores);
  if (!datos.length) return 0;
  return datos.reduce((acc, v) => acc + v, 0) / datos.length;
}

function desviacionEstandar(valores) {
  const datos = ordenar(valores);
  if (datos.length < 2) return 0;
  const media = promedio(datos);
  const varianza =
    datos.reduce((acc, v) => acc + (v - media) ** 2, 0) / (datos.length - 1);
  return Math.sqrt(varianza);
}

/**
 * Coeficiente de variacion: que tan erratico es el consumo.
 * Bajo 0.3 el consumo es parejo y se puede planificar con confianza; sobre 0.75
 * es tan irregular que cualquier sugerencia de stock hay que tomarla con pinzas.
 */
function coeficienteVariacion(valores) {
  const media = promedio(valores);
  if (!media) return 0;
  return desviacionEstandar(valores) / media;
}

function clasificarRegularidad(cv) {
  if (cv <= 0.3) return { nivel: "regular", etiqueta: "Consumo parejo" };
  if (cv <= 0.75) return { nivel: "variable", etiqueta: "Consumo variable" };
  return { nivel: "erratico", etiqueta: "Consumo irregular" };
}

/**
 * Limites de Tukey: lo que cae fuera de [Q1 - 1.5*IQR, Q3 + 1.5*IQR] se
 * considera atipico. Es el mismo criterio que dibuja los bigotes de un
 * diagrama de caja.
 *
 * Con menos de 5 datos no se calcula: no hay forma de saber que es "normal"
 * y marcariamos cosas al azar.
 */
const MINIMO_DATOS_PARA_ATIPICOS = 5;

// Se usa 3 y no el 1.5 clasico. Con 1.5 se marca lo que la estadistica llama
// "atipico", que incluye una compra grande perfectamente legitima: en un
// producto donde se piden 10 a 30 unidades, un pedido de 95 quedaba marcado y
// al excluirlo el mes entero se iba a cero. Con 3 se marca solo lo "atipico
// extremo", que es lo que buscamos: el error de tipeo.
const FACTOR_IQR = 3;

// Ademas tiene que ser mucho mas grande que lo tipico. Un cero de mas multiplica
// por 10; una compra grande de verdad rara vez pasa de 3 o 4 veces lo habitual.
const VECES_SOBRE_MEDIANA = 4;

function limitesTukey(valores) {
  const datos = ordenar(valores);
  if (datos.length < MINIMO_DATOS_PARA_ATIPICOS) {
    return null;
  }

  const q1 = percentil(datos, 0.25);
  const q3 = percentil(datos, 0.75);
  const iqr = q3 - q1;

  // Sin dispersion (todos iguales) cualquier valor distinto seria "atipico".
  if (iqr === 0) {
    return null;
  }

  return {
    q1,
    q3,
    iqr,
    limiteInferior: q1 - FACTOR_IQR * iqr,
    limiteSuperior: q3 + FACTOR_IQR * iqr,
  };
}

/**
 * Marca los pedidos anormalmente altos de una lista.
 *
 * Solo se miran los altos: un pedido chico no descuadra el stock ni suele ser
 * un error de tipeo, mientras que un 200 donde siempre se piden 20 casi
 * siempre es un cero de mas.
 *
 * @param {Array<{cantidad:number}>} registros
 * @returns lista de registros marcados, con cuantas veces supera lo tipico
 */
function detectarAtipicos(registros = []) {
  const cantidades = registros.map((r) => Number(r.cantidad) || 0);
  const limites = limitesTukey(cantidades);

  if (!limites) {
    return [];
  }

  const tipico = mediana(cantidades);
  const pisoPorMediana = tipico * VECES_SOBRE_MEDIANA;

  return registros
    .filter((r) => {
      const cantidad = Number(r.cantidad) || 0;
      // Las dos condiciones a la vez: extremo en la distribucion y muy por
      // encima de lo habitual. Con una sola se marcan compras grandes normales.
      return cantidad > limites.limiteSuperior && cantidad >= pisoPorMediana;
    })
    .map((r) => {
      const cantidad = Number(r.cantidad) || 0;
      return {
        ...r,
        cantidad,
        valor_tipico: Math.round(tipico * 10) / 10,
        limite_superior: Math.round(limites.limiteSuperior * 10) / 10,
        veces_lo_tipico: tipico > 0 ? Math.round((cantidad / tipico) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.cantidad - a.cantidad);
}

/**
 * Sugerencia de stock a partir del consumo por periodo.
 *
 * - tipico  : la mediana, el consumo de un periodo normal
 * - minimo  : la mediana, para no quedar corto en un periodo normal
 * - maximo  : el percentil 90, que cubre 9 de cada 10 periodos sin dispararse
 *             por un peak aislado
 *
 * Se devuelve tambien la version con promedio para poder mostrar la diferencia
 * cuando un atipico esta distorsionando el calculo.
 */
function sugerirStock(valoresPorPeriodo = []) {
  const datos = valoresPorPeriodo.map((v) => Number(v) || 0);

  if (!datos.length) {
    return {
      tipico: 0,
      promedio: 0,
      minimo: 0,
      maximo: 0,
      regularidad: clasificarRegularidad(0),
      periodos_con_consumo: 0,
    };
  }

  const med = mediana(datos);
  const p90 = percentil(datos, 0.9);
  const cv = coeficienteVariacion(datos);

  return {
    tipico: Math.round(med * 10) / 10,
    promedio: Math.round(promedio(datos) * 10) / 10,
    minimo: Math.max(0, Math.ceil(med)),
    maximo: Math.max(Math.ceil(p90), Math.ceil(med)),
    regularidad: clasificarRegularidad(cv),
    coeficiente_variacion: Math.round(cv * 100) / 100,
    periodos_con_consumo: datos.filter((v) => v > 0).length,
  };
}

/**
 * Tendencia comparando la primera mitad del periodo con la segunda.
 * Es deliberadamente simple: una regresion sobre 3 o 4 puntos daria una
 * precision que los datos no tienen.
 */
function calcularTendencia(valoresEnOrden = []) {
  const datos = valoresEnOrden.map((v) => Number(v) || 0);
  if (datos.length < 2) {
    return { direccion: "sin_datos", variacion: 0, etiqueta: "Sin datos suficientes" };
  }

  const mitad = Math.floor(datos.length / 2);
  const inicio = datos.slice(0, mitad);
  const fin = datos.slice(datos.length - mitad);

  const promInicio = promedio(inicio);
  const promFin = promedio(fin);

  if (!promInicio) {
    return promFin > 0
      ? { direccion: "sube", variacion: 100, etiqueta: "Empezo a consumirse" }
      : { direccion: "estable", variacion: 0, etiqueta: "Sin movimiento" };
  }

  const variacion = Math.round(((promFin - promInicio) / promInicio) * 100);

  if (Math.abs(variacion) < 15) {
    return { direccion: "estable", variacion, etiqueta: "Se mantiene" };
  }

  return variacion > 0
    ? { direccion: "sube", variacion, etiqueta: `Subio ${variacion}%` }
    : { direccion: "baja", variacion, etiqueta: `Bajo ${Math.abs(variacion)}%` };
}

/**
 * Media movil: suaviza el ruido para que se vea la tendencia de fondo. Cada
 * punto es el promedio de los ultimos `ventana` periodos, incluido el actual.
 * Los primeros puntos usan menos datos, que es lo esperable.
 */
function mediaMovil(valores = [], ventana = 3) {
  const datos = valores.map((v) => Number(v) || 0);
  return datos.map((_, i) => {
    const desde = Math.max(0, i - ventana + 1);
    const trozo = datos.slice(desde, i + 1);
    return Math.round(promedio(trozo) * 10) / 10;
  });
}

/**
 * Recta que mejor se ajusta a la serie (minimos cuadrados) y su R².
 *
 * El R² dice que porcentaje del movimiento explica la tendencia: 0.9 es un
 * consumo que sube o baja de forma pareja y se puede proyectar con confianza;
 * 0.1 es puro vaiven y cualquier proyeccion es una apuesta.
 */
function regresionLineal(valores = []) {
  const y = valores.map((v) => Number(v) || 0);
  const n = y.length;
  if (n < 2) {
    return { pendiente: 0, intercepto: y[0] || 0, r2: 0 };
  }

  const x = y.map((_, i) => i);
  const mediaX = promedio(x);
  const mediaY = promedio(y);

  let numerador = 0;
  let denominador = 0;
  for (let i = 0; i < n; i += 1) {
    numerador += (x[i] - mediaX) * (y[i] - mediaY);
    denominador += (x[i] - mediaX) ** 2;
  }

  const pendiente = denominador === 0 ? 0 : numerador / denominador;
  const intercepto = mediaY - pendiente * mediaX;

  // R² = 1 - (error de la recta / variacion total).
  let sumaResiduos = 0;
  let sumaTotal = 0;
  for (let i = 0; i < n; i += 1) {
    sumaResiduos += (y[i] - (pendiente * x[i] + intercepto)) ** 2;
    sumaTotal += (y[i] - mediaY) ** 2;
  }

  // Serie plana: la recta acierta perfecto, pero no hay nada que explicar.
  const r2 = sumaTotal === 0 ? 0 : Math.max(0, 1 - sumaResiduos / sumaTotal);

  return {
    pendiente: Math.round(pendiente * 100) / 100,
    intercepto: Math.round(intercepto * 100) / 100,
    r2: Math.round(r2 * 100) / 100,
  };
}

/**
 * Que tan confiable es la proyeccion.
 *
 * Ojo con el R² solo: en una serie plana como 30, 32, 29, 31 el R² da casi 0
 * porque no hay tendencia que explicar, y sin embargo es el consumo MAS
 * predecible que existe. Lo predecible se mide con la variabilidad; el R² solo
 * agrega confianza cuando ademas hay una tendencia clara que seguir.
 */
function clasificarConfianza(r2, cantidadPeriodos, cv = 1) {
  if (cantidadPeriodos < 3) {
    return { nivel: "baja", etiqueta: "Pocos datos" };
  }
  // Consumo parejo: se repite mes a mes, se puede planificar tranquilo.
  if (cv <= 0.3) {
    return { nivel: "alta", etiqueta: "Estimacion confiable" };
  }
  // Varia, pero lo hace siguiendo una tendencia clara.
  if (r2 >= 0.7) {
    return { nivel: "alta", etiqueta: "Estimacion confiable" };
  }
  if (r2 >= 0.4 || cv <= 0.6) {
    return { nivel: "media", etiqueta: "Estimacion aproximada" };
  }
  return { nivel: "baja", etiqueta: "Consumo poco predecible" };
}

/**
 * Cuanto se va a pedir el proximo periodo.
 *
 * Base: media movil de los ultimos periodos, que es lo que mejor funciona para
 * demanda operativa sin estacionalidad marcada. Si ademas la tendencia es clara
 * (R² alto) se corrige un paso en esa direccion; si el consumo es puro vaiven,
 * proyectar la pendiente solo agrega error, asi que se deja la media movil sola.
 */
function proyectarProximo(valores = [], ventana = 3) {
  const datos = valores.map((v) => Number(v) || 0);

  if (datos.length < 2) {
    return null;
  }

  const base = promedio(datos.slice(-ventana));
  const { pendiente, r2 } = regresionLineal(datos);
  const confianza = clasificarConfianza(r2, datos.length, coeficienteVariacion(datos));

  const ajuste = r2 >= 0.4 ? pendiente : 0;
  const estimado = Math.max(0, Math.round(base + ajuste));

  return {
    valor: estimado,
    base: Math.round(base * 10) / 10,
    r2,
    pendiente,
    confianza,
    ventana: Math.min(ventana, datos.length),
  };
}

module.exports = {
  percentil,
  mediana,
  promedio,
  mediaMovil,
  regresionLineal,
  proyectarProximo,
  clasificarConfianza,
  desviacionEstandar,
  coeficienteVariacion,
  clasificarRegularidad,
  limitesTukey,
  detectarAtipicos,
  sugerirStock,
  calcularTendencia,
  MINIMO_DATOS_PARA_ATIPICOS,
};
