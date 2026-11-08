// Textos de solicitudes que ve la gente: nombres de estados, acciones del
// historial, el resumen "Guantes y 2 productos más" y el detalle de cada cambio.
//
// Estan en un solo lugar porque los escriben dos motores: solicitudesService
// (SQLite, local) y solicitudesPgService (PostgreSQL, produccion). Con una copia
// en cada uno el historial terminaba distinto segun donde corriera, y lleno de
// codigos crudos ("POR_GESTIONAR -> ENVIADO") y campos que no habian cambiado.

const ESTADOS_SOLICITUD = Object.freeze({
  PENDIENTE: "Pendiente",
  EN_REVISION: "En gestión",
  APROBADO: "Aprobada",
  EN_DESPACHO: "En despacho",
  ENTREGADO: "Entregada",
  RECHAZADO: "Rechazada",
});

// ENTREGADO es "Entregado" para un producto y "Entregada" para la solicitud.
const ESTADOS_PRODUCTO = Object.freeze({
  POR_GESTIONAR: "Por gestionar",
  GESTIONADO: "Gestionado",
  ENVIADO: "Enviado",
  ENTREGADO: "Entregado",
  NO_APLICA: "No aplica",
  RESUELTO_FAENA: "Resuelto en faena",
});

// Igual que formatHistoryActionLabel en frontend/js/solicitudes.js: el PDF y la
// pantalla deben nombrar cada accion de la misma forma.
const ACCIONES_HISTORIAL = Object.freeze({
  SOLICITUD_CREADA: "Solicitud creada",
  CREADA: "Solicitud creada",
  SOLICITUD_ACTUALIZADA: "Solicitud actualizada",
  SOLICITUD_ELIMINADA: "Solicitud eliminada",
  SOLICITUD_REUTILIZADA: "Productos agregados a la solicitud",
  ESTADO_ACTUALIZADO: "Estado actualizado",
  ESTADO_AUTO_POR_PRODUCTOS: "Estado ajustado por productos",
  COMENTARIO_PROCESO: "Comentario de proceso",
  ITEM_CREADO: "Producto agregado",
  ITEM_ACTUALIZADO: "Producto actualizado",
  ITEM_ELIMINADO: "Producto eliminado",
  ESTADO_ITEM_REVERTIDO: "Producto revertido",
  MENSAJE_ENVIADO: "Mensaje enviado",
  MENSAJE: "Mensaje enviado",
  IMAGEN_ELIMINADA: "Imagen eliminada",
});

function texto(valor) {
  return String(valor ?? "").trim();
}

/** "IMAGEN_ELIMINADA" -> "Imagen eliminada", para codigos sin etiqueta propia. */
function humanizarCodigo(codigo) {
  const limpio = texto(codigo).replace(/_+/g, " ").trim().toLowerCase();
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : "";
}

function etiquetaEstadoSolicitud(codigo) {
  const clave = texto(codigo).toUpperCase();
  return ESTADOS_SOLICITUD[clave] || humanizarCodigo(clave);
}

function etiquetaEstadoProducto(codigo) {
  const clave = texto(codigo).toUpperCase();
  return ESTADOS_PRODUCTO[clave] || humanizarCodigo(clave);
}

function etiquetaAccionHistorial(codigo) {
  const clave = texto(codigo).toUpperCase();
  return ACCIONES_HISTORIAL[clave] || humanizarCodigo(clave) || "Evento";
}

/** "1 producto", "3 productos". */
function contarProductos(cantidad) {
  const total = Number(cantidad) || 0;
  return `${total} ${total === 1 ? "producto" : "productos"}`;
}

/**
 * Resumen de una solicitud a partir de su primer producto:
 * "Guantes", "Guantes y 1 producto más", "Guantes y 3 productos más".
 */
function resumenProductos(nombrePrimero, totalProductos) {
  const nombre = texto(nombrePrimero) || "Solicitud";
  const restantes = Math.max((Number(totalProductos) || 0) - 1, 0);
  return restantes ? `${nombre} y ${contarProductos(restantes)} más` : nombre;
}

/**
 * El resumen se guarda en solicitudes.repuesto. Las filas escritas antes de
 * este cambio dicen "y 2 item(s) más" (o "mas", las de los scripts de
 * deduplicacion); se corrigen al mostrarlas, sin tocar la base.
 */
function actualizarResumenGuardado(resumen) {
  if (resumen === null || resumen === undefined) {
    return resumen;
  }
  return String(resumen).replace(/ y (\d+) item\(s\) m[aá]s$/, (_, cantidad) =>
    ` y ${contarProductos(Number(cantidad))} más`
  );
}

/** Recorta y deja "…" para que se note que el texto sigue. */
function recortarConElipsis(valor, largo) {
  const limpio = texto(valor);
  if (limpio.length <= largo) {
    return limpio;
  }
  return `${limpio.slice(0, largo).trimEnd()}…`;
}

// "Antes → despues". Sin valor anterior basta con el nuevo; si el nuevo quedo
// vacio se dice con `vacio` ("Sin encargado") para que no parezca un error.
function parteCambio(etiqueta, antes, despues, vacio) {
  const a = texto(antes);
  const d = texto(despues);
  if (!a) {
    return `${etiqueta}: ${d || vacio}`;
  }
  return `${etiqueta}: ${a} → ${d || vacio}`;
}

// Un texto que alguien escribio y otro reemplaza o borra: el anterior queda en
// el historial, que es la unica copia que sobrevive (ver utils/concurrencia.js).
function partesTextoReemplazado(etiqueta, antes, despues) {
  const a = texto(antes);
  const d = texto(despues);
  const partes = [d ? `${etiqueta}: ${d}` : `${etiqueta} borrado`];
  if (a) {
    partes.push(`${etiqueta} anterior: ${a}`);
  }
  return partes;
}

function idONulo(valor) {
  return valor === null || valor === undefined || valor === "" ? null : Number(valor);
}

/**
 * Detalle de ITEM_ACTUALIZADO: el nombre del producto y solo lo que cambio de
 * verdad. El formulario manda todos sus campos aunque no se hayan tocado, y
 * antes el historial se llenaba de "Cantidad: 2 -> 2" y "Encargado: Sin
 * encargado".
 *
 * @param anterior el producto tal como estaba guardado
 * @param nuevo    solo los campos que vinieron en el pedido, con su valor final.
 *                 Las personas van como { id, nombre }.
 * @returns el detalle, o null si nada cambio
 */
function detalleProductoActualizado(anterior = {}, nuevo = {}) {
  const partes = [];

  if (nuevo.cantidad !== undefined && Number(nuevo.cantidad) !== Number(anterior.cantidad)) {
    partes.push(`Cantidad: ${anterior.cantidad} → ${nuevo.cantidad}`);
  }

  for (const [campo, etiqueta] of [
    ["unidad_medida", "Unidad/Talla"],
    ["codigo_referencia", "Número de parte"],
    ["usuario_final", "Usuario final"],
  ]) {
    if (nuevo[campo] !== undefined && texto(nuevo[campo]) !== texto(anterior[campo])) {
      partes.push(parteCambio(etiqueta, anterior[campo], nuevo[campo], "Sin dato"));
    }
  }

  if (nuevo.comentario !== undefined && texto(nuevo.comentario) !== texto(anterior.comentario)) {
    partes.push(...partesTextoReemplazado("Detalle", anterior.comentario, nuevo.comentario));
  }

  if (nuevo.estado_item !== undefined && nuevo.estado_item !== anterior.estado_item) {
    partes.push(
      `Estado: ${etiquetaEstadoProducto(anterior.estado_item)} → ${etiquetaEstadoProducto(nuevo.estado_item)}`
    );
  }

  if (
    nuevo.comentario_gestion !== undefined &&
    texto(nuevo.comentario_gestion) !== texto(anterior.comentario_gestion)
  ) {
    partes.push(
      ...partesTextoReemplazado(
        "Comentario de gestión",
        anterior.comentario_gestion,
        nuevo.comentario_gestion
      )
    );
  }

  for (const [campo, etiqueta, vacio] of [
    ["encargado", "Encargado", "Sin encargado"],
    ["enviado_por", "Enviado por", "Sin registrar"],
    ["recepcionado_por", "Recepcionado por", "Sin registrar"],
  ]) {
    const persona = nuevo[campo];
    if (persona === undefined || idONulo(persona?.id) === idONulo(anterior[`${campo}_id`])) {
      continue;
    }
    partes.push(parteCambio(etiqueta, anterior[`${campo}_nombre`], persona?.nombre, vacio));
  }

  const nombreAntes = texto(anterior.nombre_item);
  const nombreCambia = nuevo.nombre_item !== undefined && texto(nuevo.nombre_item) !== nombreAntes;
  if (!nombreCambia && !partes.length) {
    return null;
  }

  const cabecera = `Producto: ${nombreAntes}${nombreCambia ? ` → ${texto(nuevo.nombre_item)}` : ""}`;
  return [cabecera, ...partes].join(" | ");
}

/** "Producto agregado: Guantes (2 par)". */
function detalleProductoAgregado(item = {}) {
  const unidad = texto(item.unidad_medida);
  return `Producto agregado: ${texto(item.nombre_item)} (${item.cantidad}${unidad ? ` ${unidad}` : ""})`;
}

function detalleProductoEliminado(item = {}) {
  return `Producto eliminado: ${texto(item.nombre_item)}`;
}

/**
 * Detalle de SOLICITUD_ACTUALIZADA / ESTADO_ACTUALIZADO.
 *
 * @param detalleMasivo  texto del cierre o despacho completo, si lo hubo
 * @param estado         { anterior, nuevo } si el estado cambio
 * @param productosActualizados si se reemplazo la lista de productos
 * @param comentario     { anterior, nuevo } si el pedido traia comentario general
 */
function detalleSolicitudActualizada({
  detalleMasivo = null,
  estado = null,
  productosActualizados = false,
  comentario = null,
} = {}) {
  const partes = [];

  if (detalleMasivo) {
    partes.push(detalleMasivo);
  } else if (estado && estado.anterior !== estado.nuevo) {
    partes.push(
      `Estado: ${etiquetaEstadoSolicitud(estado.anterior)} → ${etiquetaEstadoSolicitud(estado.nuevo)}`
    );
  }

  if (productosActualizados) {
    partes.push("Detalle de solicitud actualizado");
  }

  // Lo que la persona escribio no se pierde aunque venga con un cambio masivo:
  // antes "Toda la solicitud ... entregados" tapaba el comentario.
  if (comentario && texto(comentario.anterior) !== texto(comentario.nuevo)) {
    const nuevoComentario = texto(comentario.nuevo);
    partes.push(nuevoComentario ? `Comentario: ${nuevoComentario}` : "Comentario general borrado");
    if (texto(comentario.anterior)) {
      partes.push(`Comentario anterior: ${texto(comentario.anterior)}`);
    }
  }

  return partes.length ? partes.join(" | ") : "Actualización de solicitud";
}

/** Detalle de ESTADO_AUTO_POR_PRODUCTOS: el motivo y a que estado quedo. */
function detalleEstadoAjustado(motivo, estadoAnterior, estadoNuevo) {
  return [
    texto(motivo) || "El estado general se ajustó según el avance de los productos",
    `Estado: ${etiquetaEstadoSolicitud(estadoAnterior)} → ${etiquetaEstadoSolicitud(estadoNuevo)}`,
  ].join(" | ");
}

/** Detalle de SOLICITUD_REUTILIZADA. */
function detalleSolicitudReutilizada({ agregados = 0, omitidos = 0, comentarioAnexado = false } = {}) {
  return [
    agregados === 1
      ? "Se agregó 1 producto nuevo a la solicitud pendiente existente."
      : agregados
        ? `Se agregaron ${agregados} productos nuevos a la solicitud pendiente existente.`
        : null,
    omitidos === 1
      ? "Se omitió 1 producto porque ya estaba registrado."
      : omitidos
        ? `Se omitieron ${omitidos} productos porque ya estaban registrados.`
        : null,
    comentarioAnexado ? "Se anexó el comentario general recibido." : null,
  ]
    .filter(Boolean)
    .join(" ");
}

module.exports = {
  ESTADOS_SOLICITUD,
  ESTADOS_PRODUCTO,
  ACCIONES_HISTORIAL,
  humanizarCodigo,
  etiquetaEstadoSolicitud,
  etiquetaEstadoProducto,
  etiquetaAccionHistorial,
  contarProductos,
  resumenProductos,
  actualizarResumenGuardado,
  recortarConElipsis,
  detalleProductoActualizado,
  detalleProductoAgregado,
  detalleProductoEliminado,
  detalleSolicitudActualizada,
  detalleEstadoAjustado,
  detalleSolicitudReutilizada,
};
