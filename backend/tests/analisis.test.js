// El riesgo de este modulo no es que falle: es que invente patrones que no
// existen y alguien compre stock por eso. Los tests apuntan sobre todo a que
// NO reporte nada cuando no hay nada.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compararEquipos,
  calcularEstacionalidad,
  detectarProductosAsociados,
} = require("../utils/analisis");

const NOMBRES = new Map([
  ["cadena", "Cadena motosierra"],
  ["lima", "Lima 5.5mm"],
  ["papel", "Papel higienico"],
  ["aceite", "Aceite motor"],
]);

// ── Productos que se piden juntos ──────────────────────────────────────────

test("detecta una asociacion real entre productos", () => {
  const solicitudes = [];
  for (let i = 0; i < 20; i += 1) solicitudes.push(["cadena", "lima"]);
  for (let i = 0; i < 3; i += 1) solicitudes.push(["cadena"]);
  for (let i = 0; i < 25; i += 1) solicitudes.push(["papel"]);

  const resultado = detectarProductosAsociados(solicitudes, NOMBRES);

  assert.equal(resultado.disponible, true);
  assert.ok(resultado.pares.length > 0, "deberia detectar cadena-lima");

  const par = resultado.pares[0];
  assert.ok(par.confianza >= 80, `confianza esperada alta, fue ${par.confianza}`);
  assert.ok(par.veces_mas_que_el_azar > 1, "el lift debe superar el azar");
});

test("no inventa asociaciones cuando los productos son independientes", () => {
  const productos = ["cadena", "lima", "papel", "aceite"];
  let corridasConFalsoPositivo = 0;

  // Varias corridas: una sola podria pasar por casualidad.
  for (let corrida = 0; corrida < 15; corrida += 1) {
    const solicitudes = [];
    for (let i = 0; i < 80; i += 1) {
      const seleccion = new Set();
      const cuantos = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < cuantos; k += 1) {
        seleccion.add(productos[Math.floor(Math.random() * productos.length)]);
      }
      solicitudes.push([...seleccion]);
    }
    if (detectarProductosAsociados(solicitudes, NOMBRES).pares.length) {
      corridasConFalsoPositivo += 1;
    }
  }

  assert.ok(
    corridasConFalsoPositivo <= 3,
    `demasiados falsos positivos: ${corridasConFalsoPositivo} de 15 corridas al azar`
  );
});

test("un producto muy comun no queda asociado a todo por su sola frecuencia", () => {
  // El papel aparece en casi todas las solicitudes, pero no acompana a nada en
  // particular: sin corregir por frecuencia base saldria emparejado con todo.
  const solicitudes = [];
  for (let i = 0; i < 50; i += 1) solicitudes.push(["papel", i % 2 ? "cadena" : "aceite"]);

  const resultado = detectarProductosAsociados(solicitudes, NOMBRES);
  const conPapel = resultado.pares.filter(
    (p) => p.producto === "Papel higienico" || p.se_pide_con === "Papel higienico"
  );

  assert.equal(conPapel.length, 0, "el papel no deberia salir asociado por ser comun");
});

test("declara cuando no hay solicitudes suficientes en vez de responder igual", () => {
  const resultado = detectarProductosAsociados([["cadena", "lima"], ["cadena", "lima"]], NOMBRES);

  assert.equal(resultado.disponible, false);
  assert.ok(resultado.mensaje.includes("15"), "debe decir cuantas se necesitan");
});

// ── Estacionalidad ─────────────────────────────────────────────────────────

test("no reporta estacionalidad sin un ano completo de datos", () => {
  const solicitudes = [];
  for (let mes = 0; mes < 7; mes += 1) {
    solicitudes.push({
      created_at: `2026-0${mes + 1}-15 09:00:00`,
      items: [{ cantidad: 10 }],
    });
  }

  const resultado = calcularEstacionalidad(solicitudes);

  assert.equal(resultado.disponible, false);
  assert.equal(resultado.meses_con_datos, 7);
});

test("con un ano completo identifica el mes peak", () => {
  const solicitudes = [];
  for (let mes = 0; mes < 12; mes += 1) {
    // Julio (indice 6) lleva mucho mas que el resto.
    const cantidad = mes === 6 ? 500 : 40;
    solicitudes.push({
      created_at: `2026-${String(mes + 1).padStart(2, "0")}-15 09:00:00`,
      items: [{ cantidad }],
    });
  }

  const resultado = calcularEstacionalidad(solicitudes);

  assert.equal(resultado.disponible, true);
  assert.equal(resultado.mes_peak.mes, "julio");
});

// ── Comparacion entre equipos ──────────────────────────────────────────────

test("marca al equipo que consume desproporcionadamente", () => {
  const productos = [
    {
      nombre: "Guantes",
      total_unidades: 100,
      total_solicitudes: 10,
      por_equipo: { "Equipo A": 90, "Equipo B": 10 },
    },
  ];
  // Los dos equipos hacen la misma cantidad de solicitudes...
  const solicitudesPorEquipo = { "Equipo A": 50, "Equipo B": 50 };

  const { concentraciones } = compararEquipos(productos, solicitudesPorEquipo);

  // ...pero A se lleva el 90% de los guantes: eso es lo que hay que mirar.
  assert.equal(concentraciones.length, 1);
  assert.equal(concentraciones[0].equipo, "Equipo A");
  assert.equal(concentraciones[0].participacion_del_producto, 90);
});

test("un producto pedido pocas veces no cuenta como concentracion", () => {
  // Un producto pedido una sola vez lo tiene un equipo al 100% por definicion.
  const productos = [
    {
      nombre: "Producto raro",
      total_unidades: 5,
      total_solicitudes: 1,
      por_equipo: { "Equipo A": 5 },
    },
  ];
  const solicitudesPorEquipo = { "Equipo A": 50, "Equipo B": 50 };

  const { concentraciones } = compararEquipos(productos, solicitudesPorEquipo);

  assert.equal(concentraciones.length, 0, "no deberia marcar un pedido aislado");
});
