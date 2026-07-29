// Aviso automatico cuando un pedido nuevo se sale de lo normal para ese
// producto. Reusa exactamente el mismo criterio que ya usa el reporte de
// consumo (Tukey ajustado + minimo de veces la mediana, ver
// utils/estadistica.js) para que "esto es raro" signifique lo mismo en todas
// partes: si el reporte no lo marcaria como atipico, tampoco se notifica.
//
// Se engancha en la capa de rutas (backend/routes/solicitudes.js), que es
// comun a SQLite y PostgreSQL, en vez de en un cron: Vercel no sostiene
// procesos en segundo plano, asi que el unico momento seguro para revisar es
// justo cuando se crea el pedido.

const solicitudesService = require("./solicitudesService");
const productoAliasService = require("./productoAliasService");
const notificacionesService = require("./notificacionesService");
const { buildProductoKey } = require("../utils/productoKey");
const { detectarAtipicos, MINIMO_DATOS_PARA_ATIPICOS } = require("../utils/estadistica");
const logger = require("../utils/logger");

// Historial de un ano: suficiente para que la mediana tenga sentido sin cargar
// el total de solicitudes que existan en el portal.
const MESES_DE_HISTORIA = 12;

// Actor sintetico con visibilidad total: la tipicidad de un producto se mide
// contra todo el portal, no contra lo que alcanza a ver el usuario que crea la
// solicitud. Un JEFE_FAENA puede disparar la alerta igual que un ADMIN.
const ACTOR_GLOBAL = { id: null, rol: "ADMIN", role: "ADMIN" };

/**
 * Revisa si `cantidad` es un pedido fuera de lo normal para `nombreItem`,
 * comparando contra el historial del ultimo ano. Con menos de
 * MINIMO_DATOS_PARA_ATIPICOS pedidos previos no hay base para decidir, asi que
 * no avisa: es preferible callar a marcar como raro algo que simplemente es
 * nuevo.
 */
async function evaluarPedido({ nombreItem, cantidad }) {
  const claveOriginal = buildProductoKey(nombreItem);
  const cantidadNumerica = Number(cantidad) || 0;
  if (!claveOriginal || cantidadNumerica <= 0) {
    return null;
  }

  const alias = await productoAliasService.buildResolver();
  const clave = alias.resolver(claveOriginal);

  const desde = new Date();
  desde.setMonth(desde.getMonth() - MESES_DE_HISTORIA);

  const solicitudes = await solicitudesService.listSolicitudesForExport(ACTOR_GLOBAL, {
    fechaDesde: desde.toISOString().slice(0, 10),
  });

  const historico = [];
  for (const solicitud of solicitudes) {
    if (String(solicitud.estado || "").toUpperCase() === "RECHAZADO") continue;

    const items = solicitud.items?.length
      ? solicitud.items
      : solicitud.repuesto
        ? [{ nombre_item: solicitud.repuesto, cantidad: solicitud.cantidad || 0 }]
        : [];

    for (const item of items) {
      const claveItem = alias.resolver(buildProductoKey(item.nombre_item));
      if (claveItem === clave) {
        historico.push({ cantidad: Number(item.cantidad) || 0 });
      }
    }
  }

  if (historico.length < MINIMO_DATOS_PARA_ATIPICOS) {
    return null;
  }

  // Se marca el pedido nuevo dentro del mismo conjunto que se evalua, para
  // usar exactamente la funcion que ya usa el reporte en vez de reimplementar
  // el criterio.
  const conPedidoNuevo = [...historico, { cantidad: cantidadNumerica, __nuevo: true }];
  const marcado = detectarAtipicos(conPedidoNuevo).find((a) => a.__nuevo);

  if (!marcado) {
    return null;
  }

  return {
    clave,
    nombre: alias.nombrePersonalizadoDe(clave) || alias.nombreDe(clave) || nombreItem,
    cantidad: cantidadNumerica,
    valor_tipico: marcado.valor_tipico,
    veces_lo_tipico: marcado.veces_lo_tipico,
  };
}

/**
 * Revisa uno o varios items nuevos y notifica los que resulten inusuales.
 * Pensada para llamarse sin esperar su resultado (fire-and-forget): un fallo
 * aca -o que la deteccion tarde- no debe demorar ni romper la creacion de la
 * solicitud, que ya paso y esta confirmada.
 */
async function revisarPedidosNuevos({ solicitudId, equipoId, equipoNombre, items = [] }) {
  for (const item of items) {
    try {
      const resultado = await evaluarPedido({
        nombreItem: item.nombre_item,
        cantidad: item.cantidad,
      });

      if (resultado) {
        await notificacionesService.createPedidoInusualNotification({
          solicitudId,
          equipoId,
          equipoNombre,
          nombreItem: resultado.nombre,
          cantidad: resultado.cantidad,
          valorTipico: resultado.valor_tipico,
          vecesLoTipico: resultado.veces_lo_tipico,
        });
      }
    } catch (error) {
      // Nunca debe tumbar la creacion de la solicitud, que ya se confirmo.
      logger.warn("no se pudo revisar si un pedido es inusual", {
        solicitudId,
        item: item.nombre_item,
        errorMessage: error?.message,
      });
    }
  }
}

module.exports = {
  evaluarPedido,
  revisarPedidosNuevos,
};
