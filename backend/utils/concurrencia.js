// Proteccion contra pisar el comentario de otra persona sin darse cuenta.
//
// El formulario de un item viene precargado con el comentario que existia
// cuando se abrio la pantalla. Si mientras tanto otra persona escribe algo
// ahi, quien tenia la pantalla abierta guarda con el texto viejo y borra lo
// que escribio el otro. No hay mala intencion: el formulario simplemente
// quedo desactualizado.
//
// El texto sobrescrito queda en solicitud_historial, asi que no se pierde del
// todo, pero para quien lo escribio es lo mismo que perderlo: no lo ve mas.
//
// La solucion es concurrencia optimista: el cliente manda tambien el valor que
// tenia a la vista. Si el guardado no coincide, no se pisa nada y se devuelve
// el texto actual para que la persona decida.

const { HttpError } = require("./httpError");

function normalizar(valor) {
  return String(valor ?? "").trim();
}

/**
 * Lanza 409 si el valor guardado cambio respecto a lo que el cliente tenia.
 *
 * No se verifica nada si el cliente no manda `visto`: hay llamadas legitimas
 * (scripts, integraciones) que no participan de una edicion en pantalla, y no
 * tiene sentido bloquearlas.
 *
 * @param campo      nombre del campo, para el mensaje
 * @param visto      lo que el cliente tenia a la vista (puede ser undefined)
 * @param almacenado lo que hay guardado ahora
 * @param nuevo      lo que se quiere guardar
 */
function verificarNoPisar({ campo, etiqueta, visto, almacenado, nuevo }) {
  if (visto === undefined || visto === null) {
    return;
  }

  const vistoLimpio = normalizar(visto);
  const almacenadoLimpio = normalizar(almacenado);

  // Nadie lo cambio mientras tanto: se puede guardar tranquilo.
  if (vistoLimpio === almacenadoLimpio) {
    return;
  }

  // Cambio, pero lo que se quiere guardar ya es identico a lo guardado: no hay
  // nada que pisar (dos personas escribieron lo mismo, o se reenvio el form).
  if (normalizar(nuevo) === almacenadoLimpio) {
    return;
  }

  // Si lo guardado quedo vacio no hay texto ajeno que proteger.
  if (!almacenadoLimpio) {
    return;
  }

  throw new HttpError(
    409,
    `Otra persona escribio en ${etiqueta} mientras editabas. ` +
      "Tu texto no se guardo para no borrar el suyo. Revisa lo que dice ahora y vuelve a escribir.",
    { campo, texto_actual: almacenadoLimpio, texto_que_intentabas: normalizar(nuevo) }
  );
}

module.exports = { verificarNoPisar };
