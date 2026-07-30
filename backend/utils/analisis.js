// Analisis que va mas alla de "cuanto se pidio".
//
// El reporte base es descriptivo: totales, medianas, stock sugerido. Esto
// responde preguntas que no se ven mirando una tabla producto por producto:
//
//   - Que equipo consume desproporcionadamente algo respecto a su actividad
//   - Que se pide mas en que epoca del ano
//   - Que productos se piden juntos, para comprarlos de una vez
//
// Cada analisis declara cuando no hay datos suficientes en vez de devolver un
// numero que parece cierto. Con tres meses de historia no se puede hablar de
// estacionalidad, y decirlo es mas util que inventarla.

const NOMBRE_MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Debajo de esto cualquier patron es ruido.
const MIN_MESES_ESTACIONALIDAD = 12;
const MIN_SOLICITUDES_ASOCIACION = 15;
const MIN_APARICIONES_PRODUCTO = 3;

// Confianza: de las veces que se pidio A, en cuantas venia B.
const CONFIANZA_MINIMA = 0.4;

// Lift: cuantas veces mas seguido aparecen juntos de lo que cabria esperar por
// puro azar. Con 1.6 se filtran los pares que solo reflejan que un producto es
// muy comun. Sin esto, 8 de cada 10 conjuntos aleatorios reportaban "patrones".
const LIFT_MINIMO = 1.6;

// Un equipo "concentra" un producto si se lleva bastante mas de lo que le
// tocaria por su nivel de actividad. 1.8 evita marcar diferencias normales.
const FACTOR_CONCENTRACION = 1.8;

// Un producto pedido una sola vez lo tiene un equipo al 100% por definicion, y
// eso no dice nada. Se exige que se haya pedido varias veces para que la
// desproporcion signifique algo.
const MIN_SOLICITUDES_CONCENTRACION = 4;

function porcentaje(parte, total) {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

/**
 * Compara equipos: no por volumen bruto -el equipo mas grande siempre gana-
 * sino por desproporcion. Si un equipo hace el 20% de las solicitudes pero se
 * lleva el 60% de los guantes, eso es lo que vale la pena mirar.
 */
function compararEquipos(pedidosPorProducto, solicitudesPorEquipo) {
  const totalSolicitudes = Object.values(solicitudesPorEquipo).reduce((a, b) => a + b, 0);
  if (!totalSolicitudes) {
    return { equipos: [], concentraciones: [] };
  }

  const unidadesPorEquipo = {};
  for (const producto of pedidosPorProducto) {
    for (const [equipo, unidades] of Object.entries(producto.por_equipo)) {
      unidadesPorEquipo[equipo] = (unidadesPorEquipo[equipo] || 0) + unidades;
    }
  }
  const totalUnidades = Object.values(unidadesPorEquipo).reduce((a, b) => a + b, 0);

  const equipos = Object.keys(solicitudesPorEquipo)
    .map((equipo) => ({
      equipo,
      solicitudes: solicitudesPorEquipo[equipo] || 0,
      unidades: unidadesPorEquipo[equipo] || 0,
      participacion_solicitudes: porcentaje(solicitudesPorEquipo[equipo] || 0, totalSolicitudes),
      participacion_unidades: porcentaje(unidadesPorEquipo[equipo] || 0, totalUnidades),
    }))
    .sort((a, b) => b.unidades - a.unidades);

  // Productos donde un equipo se lleva mucho mas de lo que le corresponde.
  const concentraciones = [];
  for (const producto of pedidosPorProducto) {
    if (producto.total_unidades <= 0) continue;
    if ((producto.total_solicitudes || 0) < MIN_SOLICITUDES_CONCENTRACION) continue;

    for (const [equipo, unidades] of Object.entries(producto.por_equipo)) {
      const esperado = (solicitudesPorEquipo[equipo] || 0) / totalSolicitudes;
      if (esperado <= 0) continue;

      const real = unidades / producto.total_unidades;
      const veces = real / esperado;

      if (veces >= FACTOR_CONCENTRACION && unidades > 0) {
        concentraciones.push({
          producto: producto.nombre,
          equipo,
          unidades,
          participacion_del_producto: Math.round(real * 100),
          participacion_esperada: Math.round(esperado * 100),
          veces_lo_esperado: Math.round(veces * 10) / 10,
        });
      }
    }
  }

  return {
    equipos,
    concentraciones: concentraciones
      .sort((a, b) => b.veces_lo_esperado - a.veces_lo_esperado)
      .slice(0, 8),
  };
}

/**
 * Estacionalidad por mes del ano. Solo tiene sentido con al menos un ciclo
 * anual completo; con menos se dice explicitamente en vez de dibujar una
 * "temporada alta" que en realidad es el mes en que empezaron a registrar.
 */
function calcularEstacionalidad(solicitudes) {
  const unidadesPorMes = Array(12).fill(0);
  const mesesDistintos = new Set();

  for (const solicitud of solicitudes) {
    const fecha = new Date(String(solicitud.created_at || "").replace(" ", "T"));
    if (Number.isNaN(fecha.getTime())) continue;

    mesesDistintos.add(`${fecha.getFullYear()}-${fecha.getMonth()}`);
    const unidades = (solicitud.items || []).reduce(
      (acc, item) => acc + (Number(item.cantidad) || 0),
      0
    );
    unidadesPorMes[fecha.getMonth()] += unidades;
  }

  if (mesesDistintos.size < MIN_MESES_ESTACIONALIDAD) {
    return {
      disponible: false,
      meses_con_datos: mesesDistintos.size,
      meses_necesarios: MIN_MESES_ESTACIONALIDAD,
      mensaje:
        `Se necesita al menos un año completo para hablar de temporadas. ` +
        `Hay ${mesesDistintos.size} ${mesesDistintos.size === 1 ? "mes" : "meses"} con registros.`,
    };
  }

  const conDatos = unidadesPorMes.filter((v) => v > 0);
  const promedio = conDatos.reduce((a, b) => a + b, 0) / conDatos.length;

  const meses = unidadesPorMes
    .map((unidades, i) => ({
      mes: NOMBRE_MESES[i],
      unidades,
      respecto_al_promedio: promedio > 0 ? Math.round(((unidades - promedio) / promedio) * 100) : 0,
    }))
    .filter((m) => m.unidades > 0);

  const ordenados = [...meses].sort((a, b) => b.unidades - a.unidades);

  return {
    disponible: true,
    meses,
    mes_peak: ordenados[0] || null,
    mes_mas_bajo: ordenados[ordenados.length - 1] || null,
  };
}

/**
 * Productos que se piden en la misma solicitud. Sirve para comprarlos juntos:
 * si cada vez que piden cadena tambien piden lima, conviene tenerlas al lado.
 *
 * Se reporta la confianza en una direccion ("cuando se pide A, en el X% de los
 * casos también se pide B") porque la relacion rara vez es simetrica: la lima
 * casi siempre acompana a la cadena, pero la cadena no siempre a la lima.
 */
function detectarProductosAsociados(solicitudesConClaves, nombrePorClave) {
  const solicitudesValidas = solicitudesConClaves.filter((s) => s.length >= 2);

  if (solicitudesConClaves.length < MIN_SOLICITUDES_ASOCIACION) {
    return {
      disponible: false,
      solicitudes_analizadas: solicitudesConClaves.length,
      solicitudes_necesarias: MIN_SOLICITUDES_ASOCIACION,
      mensaje:
        `Se necesitan al menos ${MIN_SOLICITUDES_ASOCIACION} solicitudes para detectar ` +
        `patrones. Hay ${solicitudesConClaves.length}.`,
    };
  }

  const apariciones = new Map();
  const juntos = new Map();

  for (const claves of solicitudesConClaves) {
    const unicas = [...new Set(claves)];
    for (const clave of unicas) {
      apariciones.set(clave, (apariciones.get(clave) || 0) + 1);
    }
    // Cada par, una sola vez por solicitud.
    for (let i = 0; i < unicas.length; i += 1) {
      for (let j = i + 1; j < unicas.length; j += 1) {
        const par = [unicas[i], unicas[j]].sort().join("\u0000");
        juntos.set(par, (juntos.get(par) || 0) + 1);
      }
    }
  }

  const pares = [];
  for (const [par, vecesJuntos] of juntos.entries()) {
    const [a, b] = par.split("\u0000");
    const aparicionesA = apariciones.get(a) || 0;
    const aparicionesB = apariciones.get(b) || 0;

    if (aparicionesA < MIN_APARICIONES_PRODUCTO || aparicionesB < MIN_APARICIONES_PRODUCTO) {
      continue;
    }

    // Se reporta la direccion mas fuerte: la que resulta accionable.
    const confianzaAB = vecesJuntos / aparicionesA;
    const confianzaBA = vecesJuntos / aparicionesB;
    const [desde, hacia, confianza] =
      confianzaAB >= confianzaBA ? [a, b, confianzaAB] : [b, a, confianzaBA];

    if (confianza < CONFIANZA_MINIMA) continue;

    // La confianza sola enganа: un producto que se pide en casi todas las
    // solicitudes aparece junto a todo con confianza alta sin que exista
    // relacion. El lift corrige eso comparando contra la frecuencia base: 1
    // significa "lo mismo que el azar", y solo por encima hay algo real.
    const frecuenciaBase = (apariciones.get(hacia) || 0) / solicitudesConClaves.length;
    const lift = frecuenciaBase > 0 ? confianza / frecuenciaBase : 0;

    if (lift < LIFT_MINIMO) continue;

    pares.push({
      producto: nombrePorClave.get(desde) || desde,
      se_pide_con: nombrePorClave.get(hacia) || hacia,
      veces_juntos: vecesJuntos,
      confianza: Math.round(confianza * 100),
      veces_mas_que_el_azar: Math.round(lift * 10) / 10,
    });
  }

  return {
    disponible: true,
    solicitudes_analizadas: solicitudesValidas.length,
    pares: pares.sort((a, b) => b.confianza - a.confianza || b.veces_juntos - a.veces_juntos).slice(0, 10),
  };
}

// Cortes ABC clasicos: la clase A es el poco que se lleva la mayor parte.
const CORTE_A = 0.8;
const CORTE_B = 0.95;

/**
 * Clasificacion ABC (Pareto) de los productos.
 *
 * Responde "para donde se estan yendo las cosas": normalmente unos pocos
 * productos concentran la mayor parte del movimiento, y son esos los que vale
 * la pena controlar de cerca.
 *
 * Dos criterios, porque miden cosas distintas y ninguno es "el correcto":
 *
 *   - "cantidad": cuanto sale de cada producto. Es lo intuitivo, PERO suma
 *     unidades que no siempre son comparables: 443 pares de guantes contra 232
 *     rollos de papel no se pueden rankear entre si de forma limpia. Sin
 *     precios no hay manera de convertir eso a plata, asi que el resultado se
 *     entrega marcado con esa advertencia.
 *
 *   - "frecuencia": en cuantas solicitudes distintas aparece. Este SI es
 *     comparable entre productos, porque cuenta veces y no unidades. Mide que
 *     tanta atencion operativa consume cada producto.
 *
 * No se inventa un ranking por costo: para eso harian falta precios que el
 * portal no tiene.
 */
function clasificarABC(productos = [], { criterio = "cantidad" } = {}) {
  const valorDe = (p) =>
    criterio === "frecuencia" ? Number(p.total_solicitudes) || 0 : Number(p.total_unidades) || 0;

  const conValor = productos.filter((p) => valorDe(p) > 0);
  const total = conValor.reduce((acumulado, p) => acumulado + valorDe(p), 0);

  if (!conValor.length || total <= 0) {
    return {
      disponible: false,
      mensaje: "Todavia no hay consumo registrado para ordenar los productos.",
    };
  }

  const ordenados = [...conValor].sort((a, b) => valorDe(b) - valorDe(a));
  const unidadesDistintas = new Set(
    ordenados.map((p) => p.unidad).filter(Boolean)
  );

  let acumulado = 0;
  const items = ordenados.map((p) => {
    const valor = valorDe(p);
    const participacion = valor / total;

    // La clase se decide con el acumulado ANTES de sumar este producto: se van
    // tomando productos hasta ALCANZAR el 80%, asi que el que cruza el corte
    // todavia es clase A. Con el acumulado ya sumado, un producto que por si
    // solo se lleva el 90% quedaba fuera de A, que es justo al reves de lo que
    // significa el analisis.
    const clase = acumulado < CORTE_A ? "A" : acumulado < CORTE_B ? "B" : "C";

    acumulado += participacion;

    return {
      clave: p.clave,
      nombre: p.nombre,
      unidad: p.unidad || "",
      unidad_en_conflicto: Boolean(p.unidad_en_conflicto),
      valor,
      participacion: Math.round(participacion * 1000) / 10,
      acumulado: Math.round(acumulado * 1000) / 10,
      clase,
    };
  });

  const deClaseA = items.filter((i) => i.clase === "A");
  const participacionA = deClaseA.reduce((s, i) => s + i.participacion, 0);

  return {
    disponible: true,
    criterio,
    total,
    productos: items,
    resumen: {
      productos_totales: items.length,
      clase_a: deClaseA.length,
      clase_b: items.filter((i) => i.clase === "B").length,
      clase_c: items.filter((i) => i.clase === "C").length,
      participacion_a: Math.round(participacionA * 10) / 10,
      frase:
        `${deClaseA.length} de ${items.length} productos concentran el ` +
        `${Math.round(participacionA)}% del movimiento`,
    },
    // Sin precios, un ranking por cantidad mezcla unidades distintas. Se dice,
    // no se esconde.
    advertencia_unidades:
      criterio === "cantidad" && unidadesDistintas.size > 1
        ? `Este orden compara cantidades en unidades distintas (${[...unidadesDistintas].join(
            ", "
          )}). Sirve como referencia, no como ranking de costo.`
        : null,
  };
}

module.exports = {
  compararEquipos,
  calcularEstacionalidad,
  detectarProductosAsociados,
  clasificarABC,
  MIN_MESES_ESTACIONALIDAD,
  MIN_SOLICITUDES_ASOCIACION,
  CORTE_A,
  CORTE_B,
};
