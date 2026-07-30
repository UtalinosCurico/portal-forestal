// El ABC es lo que responde "para donde se estan yendo las cosas". Si el corte
// esta mal, el jefe recibe una lista de productos equivocada y nadie lo va a
// notar mirando la pantalla. Por eso los cortes se verifican contra
// porcentajes calculados a mano.

const test = require("node:test");
const assert = require("node:assert/strict");

const { clasificarABC } = require("../utils/analisis");

function producto(nombre, unidades, solicitudes = 1, unidad = "unidad") {
  return {
    clave: nombre.toLowerCase(),
    nombre,
    unidad,
    total_unidades: unidades,
    total_solicitudes: solicitudes,
  };
}

test("sin consumo no inventa una clasificacion", () => {
  const resultado = clasificarABC([producto("Guantes", 0)]);
  assert.equal(resultado.disponible, false);
});

test("los cortes A/B/C caen donde corresponde", () => {
  // Total = 1000. Acumulados: 70%, 85%, 95%, 100%.
  const resultado = clasificarABC([
    producto("Guantes", 700),
    producto("Papel", 150),
    producto("Jabon", 100),
    producto("Cadena", 50),
  ]);

  const porNombre = Object.fromEntries(resultado.productos.map((p) => [p.nombre, p]));

  assert.equal(porNombre.Guantes.participacion, 70);
  assert.equal(porNombre.Guantes.clase, "A");

  // Se toman productos hasta ALCANZAR el 80%: con Guantes solo van 70%, asi
  // que Papel entra a la clase A aunque con el el acumulado llegue a 85%.
  assert.equal(porNombre.Papel.acumulado, 85);
  assert.equal(porNombre.Papel.clase, "A", "es el producto que cruza el corte del 80%");

  assert.equal(porNombre.Jabon.acumulado, 95);
  assert.equal(porNombre.Jabon.clase, "B", "arranca con 85% acumulado: ya paso el 80%");

  assert.equal(porNombre.Cadena.clase, "C", "arranca con 95% acumulado");
});

test("el producto que cruza el 80% sigue siendo clase A", () => {
  // Uno solo se lleva el 90%: es A aunque su acumulado pase el corte.
  const resultado = clasificarABC([producto("Combustible", 900), producto("Otro", 100)]);

  assert.equal(resultado.productos[0].clase, "A");
  assert.equal(resultado.resumen.clase_a, 1);
});

test("ordena de mayor a menor sin importar como venga la lista", () => {
  const resultado = clasificarABC([
    producto("Chico", 10),
    producto("Grande", 900),
    producto("Mediano", 90),
  ]);

  assert.deepEqual(
    resultado.productos.map((p) => p.nombre),
    ["Grande", "Mediano", "Chico"]
  );
});

test("la frase del resumen dice cuantos concentran cuanto", () => {
  const resultado = clasificarABC([
    producto("Guantes", 700),
    producto("Papel", 150),
    producto("Jabon", 100),
    producto("Cadena", 50),
  ]);

  assert.match(resultado.resumen.frase, /2 de 4 productos concentran el 85%/);
});

test("avisa cuando el ranking por cantidad mezcla unidades distintas", () => {
  const resultado = clasificarABC([
    producto("Guantes", 400, 5, "par"),
    producto("Papel", 300, 4, "rollo"),
    producto("Agua", 200, 3, "lt"),
  ]);

  assert.ok(
    resultado.advertencia_unidades,
    "comparar pares con rollos y litros no es un ranking de costo y hay que decirlo"
  );
  assert.match(resultado.advertencia_unidades, /unidades distintas/);
});

test("con una sola unidad no hay advertencia que dar", () => {
  const resultado = clasificarABC([
    producto("Guantes", 400, 5, "par"),
    producto("Otros guantes", 100, 2, "par"),
  ]);

  assert.equal(resultado.advertencia_unidades, null);
});

test("el criterio por frecuencia rankea por cantidad de solicitudes, no de unidades", () => {
  // Un producto con muchisimas unidades pero pedido una sola vez, contra otro
  // de pocas unidades pero pedido todas las semanas.
  const productos = [
    producto("Compra grande unica", 5000, 1),
    producto("Pedido de cada semana", 60, 30),
  ];

  const porCantidad = clasificarABC(productos, { criterio: "cantidad" });
  const porFrecuencia = clasificarABC(productos, { criterio: "frecuencia" });

  assert.equal(porCantidad.productos[0].nombre, "Compra grande unica");
  assert.equal(
    porFrecuencia.productos[0].nombre,
    "Pedido de cada semana",
    "por frecuencia manda el que se pide seguido"
  );
  assert.equal(porFrecuencia.advertencia_unidades, null, "contar veces no mezcla unidades");
});

test("las participaciones suman 100", () => {
  const resultado = clasificarABC([
    producto("A", 333),
    producto("B", 333),
    producto("C", 334),
  ]);

  const suma = resultado.productos.reduce((s, p) => s + p.participacion, 0);
  assert.ok(Math.abs(suma - 100) < 0.5, `sumaron ${suma}`);
  assert.ok(Math.abs(resultado.productos.at(-1).acumulado - 100) < 0.5);
});
