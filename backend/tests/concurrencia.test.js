// Perder el comentario de alguien es de los errores mas caros: no se nota
// hasta que esa persona lo busca, y para entonces nadie sabe que paso.

const test = require("node:test");
const assert = require("node:assert/strict");

const { verificarNoPisar } = require("../utils/concurrencia");

const base = { campo: "comentario", etiqueta: "el detalle del producto" };

test("deja guardar si nadie escribio mientras tanto", () => {
  assert.doesNotThrow(() =>
    verificarNoPisar({ ...base, visto: "lo de antes", almacenado: "lo de antes", nuevo: "lo nuevo" })
  );
});

test("deja guardar cuando el campo estaba vacio y sigue vacio", () => {
  assert.doesNotThrow(() =>
    verificarNoPisar({ ...base, visto: "", almacenado: "", nuevo: "primer comentario" })
  );
});

test("bloquea cuando otra persona escribio mientras el formulario estaba abierto", () => {
  // El caso real: el admin abrio la pantalla con el campo vacio, el operador
  // comento, y el admin guarda con su formulario desactualizado.
  assert.throws(
    () =>
      verificarNoPisar({
        ...base,
        visto: "",
        almacenado: "OPERADOR: falta la marca, es la roja grande",
        nuevo: "ADMIN: ya lo pedi",
      }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.details.texto_actual, "OPERADOR: falta la marca, es la roja grande");
      assert.equal(error.details.texto_que_intentabas, "ADMIN: ya lo pedi");
      assert.match(error.message, /Otra persona escribio/);
      return true;
    }
  );
});

test("no bloquea si el texto guardado quedo vacio: no hay nada que proteger", () => {
  assert.doesNotThrow(() =>
    verificarNoPisar({ ...base, visto: "algo viejo", almacenado: "   ", nuevo: "algo nuevo" })
  );
});

test("no bloquea si lo que se quiere guardar ya es lo que hay", () => {
  // Dos personas escribieron lo mismo, o se reenvio el formulario.
  assert.doesNotThrow(() =>
    verificarNoPisar({ ...base, visto: "", almacenado: "mismo texto", nuevo: "mismo texto" })
  );
});

test("los espacios sobrantes no cuentan como un cambio", () => {
  assert.doesNotThrow(() =>
    verificarNoPisar({ ...base, visto: "  hola  ", almacenado: "hola", nuevo: "otra cosa" })
  );
});

test("sin el valor visto no se verifica nada", () => {
  // Llamadas que no vienen de una pantalla (scripts, integraciones) no deben
  // quedar bloqueadas por una proteccion pensada para formularios.
  assert.doesNotThrow(() =>
    verificarNoPisar({ ...base, visto: undefined, almacenado: "texto de otro", nuevo: "lo mio" })
  );
});
