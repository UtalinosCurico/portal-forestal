// Una simulacion es facil de escribir y dificil de verificar: siempre devuelve
// un numero con cara de razonable. Aca se la fuerza a casos donde el resultado
// correcto se puede calcular a mano, y se verifican las propiedades que tienen
// que cumplirse si el muestreo esta bien hecho.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  simularNivelAMantener,
  muestraTriangular,
  calcularSobredispersion,
  percentil,
  generador,
  MINIMO_SEMANAS,
  MINIMO_SEMANAS_CON_CONSUMO,
} = require("../utils/simulacion");

test("no simula con menos semanas que el minimo", () => {
  const resultado = simularNivelAMantener({
    demandaSemanal: new Array(MINIMO_SEMANAS - 1).fill(10),
  });

  assert.equal(resultado.disponible, false);
  assert.equal(resultado.motivo, "pocas_semanas");
});

test("con la misma semilla devuelve siempre el mismo numero", () => {
  const entrada = { demandaSemanal: [8, 12, 5, 20, 9, 14, 11, 7] };
  const a = simularNivelAMantener(entrada);
  const b = simularNivelAMantener(entrada);

  assert.equal(
    a.nivel_a_mantener,
    b.nivel_a_mantener,
    "un reporte que cambia solo al refrescar no es defendible"
  );
  assert.deepEqual(a.detalle.percentiles, b.detalle.percentiles);
});

test("caso determinista: demanda y lead time constantes dan el valor exacto", () => {
  // Demanda siempre 10 por semana. Lead time siempre 7 dias = 1 semana.
  // Intervalo de proteccion = 1 semana de revision + 1 de lead = 2 semanas.
  // Entonces la demanda del intervalo es SIEMPRE 20, sin dispersion.
  const resultado = simularNivelAMantener({
    demandaSemanal: [10, 10, 10, 10, 10, 10],
    leadTimeDias: { minimo: 7, probable: 7, maximo: 7 },
    revisionSemanas: 1,
    iteraciones: 2000,
  });

  assert.equal(resultado.nivel_a_mantener, 20);
  assert.equal(resultado.detalle.percentiles.p50, 20);
  assert.equal(resultado.detalle.percentiles.p99, 20);
  assert.equal(
    resultado.detalle.desviacion_intervalo,
    0,
    "sin variabilidad no puede haber dispersion"
  );
});

test("exigir mas nivel de servicio nunca puede pedir menos stock", () => {
  const demanda = [8, 12, 5, 20, 9, 14, 11, 7, 16, 3];
  const base = { demandaSemanal: demanda, iteraciones: 5000 };

  const s90 = simularNivelAMantener({ ...base, nivelServicio: 0.9 });
  const s95 = simularNivelAMantener({ ...base, nivelServicio: 0.95 });
  const s99 = simularNivelAMantener({ ...base, nivelServicio: 0.99 });

  assert.ok(s90.nivel_a_mantener <= s95.nivel_a_mantener);
  assert.ok(s95.nivel_a_mantener <= s99.nivel_a_mantener);
});

test("un lead time mas largo exige mantener mas", () => {
  const demanda = [10, 12, 8, 11, 9, 10, 13, 7];

  const corto = simularNivelAMantener({
    demandaSemanal: demanda,
    leadTimeDias: { minimo: 1, probable: 2, maximo: 3 },
    iteraciones: 5000,
  });
  const largo = simularNivelAMantener({
    demandaSemanal: demanda,
    leadTimeDias: { minimo: 10, probable: 14, maximo: 20 },
    iteraciones: 5000,
  });

  assert.ok(
    largo.nivel_a_mantener > corto.nivel_a_mantener,
    "si el proveedor demora mas hay que cubrir mas tiempo"
  );
});

test("los percentiles salen ordenados", () => {
  const { detalle } = simularNivelAMantener({
    demandaSemanal: [8, 12, 5, 20, 9, 14, 11, 7],
    iteraciones: 5000,
  });
  const p = detalle.percentiles;

  assert.ok(p.p50 <= p.p75 && p.p75 <= p.p90 && p.p90 <= p.p95 && p.p95 <= p.p99);
});

test("la triangular tiene la media teorica (min+probable+max)/3", () => {
  const aleatorio = generador(7);
  const muestras = Array.from({ length: 200000 }, () =>
    muestraTriangular(1, 3, 7, aleatorio())
  );
  const media = muestras.reduce((a, b) => a + b, 0) / muestras.length;
  const teorica = (1 + 3 + 7) / 3;

  assert.ok(Math.abs(media - teorica) < 0.05, `dio ${media.toFixed(3)}, esperaba ${teorica}`);
});

test("la triangular respeta sus limites", () => {
  const aleatorio = generador(3);
  for (let i = 0; i < 10000; i += 1) {
    const v = muestraTriangular(1, 3, 7, aleatorio());
    assert.ok(v >= 1 && v <= 7, `se salio del rango: ${v}`);
  }
});

test("el percentil interpola como corresponde", () => {
  const datos = [10, 20, 30, 40, 50];
  assert.equal(percentil(datos, 0), 10);
  assert.equal(percentil(datos, 1), 50);
  assert.equal(percentil(datos, 0.5), 30);
});

test("detecta sobredispersion cuando la demanda es erratica", () => {
  const pareja = calcularSobredispersion([10, 11, 9, 10, 10, 11, 9, 10]);
  const erratica = calcularSobredispersion([0, 0, 60, 0, 2, 0, 80, 0]);

  assert.ok(pareja.razon < 1.5, `pareja dio ${pareja.razon}`);
  assert.ok(erratica.razon > 1.5, `erratica dio ${erratica.razon}`);
  assert.match(erratica.interpretacion, /simulacion/);
});

test("el histograma cubre todas las iteraciones", () => {
  const { detalle } = simularNivelAMantener({
    demandaSemanal: [8, 12, 5, 20, 9, 14, 11, 7],
    iteraciones: 5000,
  });

  const suma = detalle.histograma.reduce((s, caja) => s + caja.cuenta, 0);
  assert.equal(suma, 5000, "no se puede perder ni duplicar iteraciones al agrupar");
});

// Serie real de guantes nitrilo del portal. Sin tratar el 300, la simulacion
// recomendaba mantener 313 para un producto que se consume de a 20 por semana.
test("un pedido atipico no puede arrastrar la recomendacion", () => {
  const serieReal = [20, 22, 18, 21, 19, 300, 20, 23];

  const limpia = simularNivelAMantener({ demandaSemanal: serieReal });
  const sucia = simularNivelAMantener({ demandaSemanal: serieReal, excluirAtipicos: false });

  assert.ok(
    limpia.nivel_a_mantener < 60,
    `con ~20 por semana el nivel deberia rondar los 40, dio ${limpia.nivel_a_mantener}`
  );
  assert.ok(
    sucia.nivel_a_mantener > 250,
    "sin excluirlo el atipico domina el percentil 95: es el bug que se corrigio"
  );

  assert.equal(limpia.semanas_atipicas.length, 1, "la semana rara se informa, no se borra");
  assert.equal(limpia.semanas_atipicas[0].cantidad, 300);
  assert.equal(limpia.detalle.demanda_media_semanal, 20.4);
});

test("las semanas sin consumo cuentan y bajan el nivel necesario", () => {
  // Mismo total, pero repartido: uno consume todas las semanas y el otro solo
  // algunas. El intermitente deberia necesitar menos en el caso tipico.
  const parejo = simularNivelAMantener({
    demandaSemanal: [10, 10, 10, 10, 10, 10, 10, 10],
    iteraciones: 5000,
  });
  const intermitente = simularNivelAMantener({
    // Cuatro eventos de 20 en ocho semanas: mismo promedio de 10, pero a
    // saltos. Necesita al menos tres eventos para que se pueda estimar.
    demandaSemanal: [0, 20, 0, 20, 0, 20, 0, 20],
    iteraciones: 5000,
  });

  assert.equal(parejo.detalle.demanda_media_semanal, 10);
  assert.equal(intermitente.detalle.demanda_media_semanal, 10);
  assert.ok(
    intermitente.nivel_a_mantener > parejo.nivel_a_mantener,
    "a igual promedio, la demanda a saltos obliga a cubrir el salto completo"
  );
});

// La serie llega alineada al calendario completo, asi que un producto pedido
// una sola vez igual trae quince semanas: catorce ceros y un numero. Contando
// solo el largo del arreglo, la simulacion devolvia "mantener 20" a partir de
// un unico pedido, con toda la pinta de un resultado calculado.
test("un producto pedido una sola vez no recibe recomendacion", () => {
  const unaSolaVez = [0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0];

  const resultado = simularNivelAMantener({ demandaSemanal: unaSolaVez });

  assert.equal(resultado.disponible, false);
  assert.equal(resultado.motivo, "pocos_eventos_de_consumo");
  assert.equal(resultado.semanas_con_consumo, 1);
  assert.match(resultado.mensaje, /1 semana/);
});

test("con suficientes eventos de consumo si se estima, aunque haya muchos ceros", () => {
  // Demanda intermitente real: se pide de vez en cuando, pero varias veces.
  const intermitente = [0, 12, 0, 0, 15, 0, 10, 0, 0, 14, 0, 0];
  assert.ok(intermitente.filter((v) => v > 0).length >= MINIMO_SEMANAS_CON_CONSUMO);

  const resultado = simularNivelAMantener({ demandaSemanal: intermitente });

  assert.equal(resultado.disponible, true, "cuatro eventos de demanda alcanzan para estimar");
  assert.ok(resultado.nivel_a_mantener > 0);
});
