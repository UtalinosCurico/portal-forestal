// El riesgo de un modelo de inventario es que devuelva un numero con pinta de
// exacto que este mal: nadie lo va a cuestionar y la faena se queda sin stock.
// Por eso aca se verifica contra cuentas hechas a mano, no solo contra "no se
// cayo".

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calcularLeadTime,
  calcularPolitica,
  desviacionEstandar,
  MINIMO_SEMANAS_DEMANDA,
  MINIMO_ENTREGAS_LEAD_TIME,
} = require("../utils/inventarioPolitica");

test("la desviacion estandar es la muestral, igual que Excel y R", () => {
  // DESVEST(2;4;4;4;5;5;7;9) en Excel = 2.13809...
  const resultado = desviacionEstandar([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.ok(Math.abs(resultado - 2.13809) < 0.0001, `dio ${resultado}`);
});

test("no se calcula politica con menos historia que el minimo", () => {
  const pocas = Array(MINIMO_SEMANAS_DEMANDA - 1).fill(10);
  const politica = calcularPolitica({
    demandaSemanal: pocas,
    leadTime: { semanas_promedio: 1, semanas_desviacion: 0, dias_promedio: 7, dias_desviacion: 0, entregas: 5 },
    stockActual: 0,
  });

  assert.equal(politica.disponible, false);
  assert.equal(politica.motivo, "pocos_datos");
});

test("sin entregas registradas no se inventa un lead time", () => {
  const politica = calcularPolitica({
    demandaSemanal: [10, 12, 11, 9, 10, 13, 11, 10],
    leadTime: null,
    stockActual: 0,
  });

  assert.equal(politica.disponible, false);
  assert.equal(politica.motivo, "sin_lead_time");
});

test("el lead time necesita un minimo de entregas para valer algo", () => {
  const pocas = Array(MINIMO_ENTREGAS_LEAD_TIME - 1).fill({
    pedido: "2026-01-01",
    recibido: "2026-01-08",
  });
  assert.equal(calcularLeadTime(pocas), null);
});

test("el lead time sale de la diferencia entre pedido y recepcion", () => {
  const leadTime = calcularLeadTime([
    { pedido: "2026-01-01", recibido: "2026-01-08" }, // 7 dias
    { pedido: "2026-01-05", recibido: "2026-01-12" }, // 7 dias
    { pedido: "2026-01-10", recibido: "2026-01-17" }, // 7 dias
  ]);

  assert.equal(leadTime.entregas, 3);
  assert.equal(leadTime.dias_promedio, 7);
  assert.equal(leadTime.dias_desviacion, 0, "tres entregas iguales no tienen dispersion");
  assert.equal(leadTime.semanas_promedio, 1);
});

test("una recepcion anterior al pedido se descarta en vez de dar negativo", () => {
  const leadTime = calcularLeadTime([
    { pedido: "2026-01-01", recibido: "2026-01-08" },
    { pedido: "2026-01-05", recibido: "2026-01-12" },
    { pedido: "2026-01-10", recibido: "2026-01-17" },
    { pedido: "2026-02-10", recibido: "2026-02-01" }, // dato malo
  ]);

  assert.equal(leadTime.entregas, 3, "la fila invalida no debe contarse");
  assert.equal(leadTime.dias_promedio, 7, "ni arrastrar el promedio");
});

test("la politica (R,S) coincide con la cuenta hecha a mano", () => {
  // Demanda: 8 semanas, media 20, calculada a proposito para poder verificar.
  const demanda = [18, 22, 20, 19, 21, 20, 18, 22];
  // media = 160/8 = 20
  // desviaciones: -2,2,0,-1,1,0,-2,2 -> cuadrados: 4,4,0,1,1,0,4,4 = 18
  // sigmaD = sqrt(18/7) = 1.6036
  const leadTime = {
    entregas: 5,
    dias_promedio: 7,
    dias_desviacion: 0,
    semanas_promedio: 1,
    semanas_desviacion: 0,
  };

  const politica = calcularPolitica({ demandaSemanal: demanda, leadTime, stockActual: 30 });

  assert.equal(politica.disponible, true);
  assert.equal(politica.demanda_semanal, 20);

  // R + L = 1 + 1 = 2 semanas
  assert.equal(politica.intervalo_proteccion_semanas, 2);
  // demanda en el intervalo = 20 * 2 = 40
  assert.equal(politica.demanda_intervalo, 40);

  // sigma_intervalo = sqrt(2 * 1.6036^2 + 20^2 * 0^2) = sqrt(5.142) = 2.2677
  // SS = 1.65 * 2.2677 = 3.74 -> techo 4
  assert.equal(politica.stock_seguridad, 4);
  // S = 40 + 3.74 = 43.74 -> techo 44
  assert.equal(politica.nivel_objetivo, 44);
  // pedir = 44 - 30 = 14
  assert.equal(politica.pedir_ahora, 14);
});

test("un lead time incierto exige mas stock de seguridad que uno fijo", () => {
  const demanda = [20, 20, 20, 20, 20, 20, 20, 20];
  const base = { entregas: 6, dias_promedio: 7, dias_desviacion: 0, semanas_promedio: 1 };

  const fijo = calcularPolitica({
    demandaSemanal: demanda,
    leadTime: { ...base, semanas_desviacion: 0 },
    stockActual: 0,
  });
  const incierto = calcularPolitica({
    demandaSemanal: demanda,
    leadTime: { ...base, semanas_desviacion: 0.5 },
    stockActual: 0,
  });

  // Con demanda perfectamente pareja, toda la incertidumbre viene del lead time.
  assert.equal(fijo.stock_seguridad, 0, "demanda y lead time fijos no necesitan colchon");
  assert.ok(
    incierto.stock_seguridad > 0,
    "si el proveedor a veces demora mas, hay que cubrirlo"
  );
});

test("si ya hay mas stock que el nivel objetivo, no se pide nada", () => {
  const politica = calcularPolitica({
    demandaSemanal: [20, 20, 20, 20, 20, 20, 20, 20],
    leadTime: { entregas: 5, dias_promedio: 7, dias_desviacion: 0, semanas_promedio: 1, semanas_desviacion: 0 },
    stockActual: 500,
  });

  assert.equal(politica.pedir_ahora, 0, "nunca debe salir negativo");
});

test("una demanda erratica se marca como poco confiable", () => {
  const pareja = calcularPolitica({
    demandaSemanal: [20, 21, 19, 20, 21, 19, 20, 20, 21, 19, 20, 20],
    leadTime: { entregas: 5, dias_promedio: 7, dias_desviacion: 0, semanas_promedio: 1, semanas_desviacion: 0 },
    stockActual: 0,
  });
  const erratica = calcularPolitica({
    demandaSemanal: [2, 40, 1, 55, 3, 38, 0, 60],
    leadTime: { entregas: 5, dias_promedio: 7, dias_desviacion: 0, semanas_promedio: 1, semanas_desviacion: 0 },
    stockActual: 0,
  });

  assert.equal(pareja.confianza.nivel, "alta");
  assert.equal(erratica.confianza.nivel, "baja");
});
