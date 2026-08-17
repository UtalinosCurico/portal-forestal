// Herramientas que el asistente puede usar para consultar el portal.
//
// Decision de diseno importante: el modelo NO recibe acceso SQL. Recibe un
// puñado de consultas acotadas que llaman a los mismos servicios que usa la
// interfaz, pasandoles el usuario autenticado. Asi los permisos por rol se
// heredan solos -un JEFE_FAENA solo ve lo de su equipo aunque pregunte por
// otro- y no hay forma de que una instruccion inyectada en un nombre de
// producto termine leyendo o modificando algo que no corresponde.
//
// Todas las herramientas son de solo lectura. El asistente puede responder
// "cuanto papel higienico necesitas", nunca crear ni cambiar una solicitud.

const { betaTool } = require("@anthropic-ai/sdk/helpers/beta/json-schema");
const consumoService = require("./consumoService");
const solicitudesService = require("./solicitudesService");
const equiposService = require("./equiposService");
const { buildProductoKey } = require("../utils/productoKey");
const { normalizeRole, ROLES } = require("../config/appRoles");

// Consumo y stock sugerido son informacion de gestion: el modulo Reportes no se
// le muestra a faena, asi que el asistente tampoco se la puede contar. Si no,
// bastaria con preguntarle a PumAI para saltarse el permiso.
const ROLES_QUE_VEN_CONSUMO = new Set([ROLES.ADMIN, ROLES.SUPERVISOR]);

function puedeVerConsumo(actor) {
  return ROLES_QUE_VEN_CONSUMO.has(normalizeRole(actor?.rol || actor?.role));
}

// Los resultados vuelven al contexto del modelo y se pagan como tokens: se
// devuelve lo justo para responder, no el objeto completo del servicio.
const MAX_PRODUCTOS = 15;
const MAX_SOLICITUDES = 15;

function recortar(texto, largo = 60) {
  const limpio = String(texto ?? "").trim();
  return limpio.length > largo ? `${limpio.slice(0, largo)}...` : limpio;
}

/** Rango por defecto: ultimos 3 meses, que es lo que suele preguntarse. */
function rangoPorDefecto() {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
  return {
    fechaDesde: desde.toISOString().slice(0, 10),
    fechaHasta: hoy.toISOString().slice(0, 10),
  };
}

// `empresa` acota todas las herramientas a Maule Norte o Forest Saint, igual
// que el apartado que el usuario tenga abierto: el asistente no debe responder
// con datos de la otra empresa.
function construirHerramientas(actor, opciones = {}) {
  const empresa = opciones.empresa || undefined;

  const consultarConsumo = betaTool({
    name: "consultar_consumo",
    description:
      "Cuanto se pidio de cada producto en un período, con el stock mínimo y máximo " +
      "sugerido y una estimación de cuanto se pedirá el próximo período. Es la " +
      "herramienta para responder preguntas como 'cuanto papel higienico necesito', " +
      "'que es lo que más se consume' o 'cuanto guante pedimos el mes pasado'. " +
      "Usala siempre que la pregunta sea sobre cantidades, consumo o stock.",
    inputSchema: {
      type: "object",
      properties: {
        producto: {
          type: "string",
          description:
            "Nombre o parte del nombre del producto a consultar. Omitir para " +
            "obtener los productos de mayor consumo.",
        },
        fechaDesde: { type: "string", description: "Inicio del período, formato AAAA-MM-DD." },
        fechaHasta: { type: "string", description: "Fin del período, formato AAAA-MM-DD." },
        agrupacion: {
          type: "string",
          enum: ["mes", "semana"],
          description: "Si el consumo se agrupa por mes o por semana. Por defecto mes.",
        },
        equipoId: {
          type: "integer",
          description: "Limitar a un equipo. Usa listar_equipos para obtener el id.",
        },
      },
      required: [],
    },
    run: async (input) => {
      const rango = rangoPorDefecto();
      const datos = await consumoService.getConsumo(actor, {
        fechaDesde: input.fechaDesde || rango.fechaDesde,
        fechaHasta: input.fechaHasta || rango.fechaHasta,
        agrupacion: input.agrupacion || "mes",
        equipoId: input.equipoId,
        empresa,
      });

      const filtro = buildProductoKey(input.producto || "");
      const productos = (filtro
        ? datos.productos.filter((p) => p.clave.includes(filtro))
        : datos.productos
      ).slice(0, MAX_PRODUCTOS);

      if (!productos.length) {
        return JSON.stringify({
          periodo: `${datos.periodo.desde} a ${datos.periodo.hasta}`,
          resultado: filtro
            ? `No se encontro ningun producto que coincida con "${input.producto}" en ese período.`
            : "No hubo pedidos en ese período.",
        });
      }

      return JSON.stringify({
        periodo: `${datos.periodo.desde} a ${datos.periodo.hasta}`,
        agrupado_por: datos.periodo.agrupacion,
        periodo_en_curso_no_terminado: datos.periodo.etiqueta_incompleto || null,
        productos: productos.map((p) => ({
          producto: p.nombre,
          unidad: p.unidad || null,
          total_pedido: p.total_unidades,
          consumo_tipico_por_periodo: p.tipico,
          stock_sugerido: { minimo: p.sugerido_min, maximo: p.sugerido_max },
          estimado_proximo_periodo: p.proyeccion?.valor ?? null,
          confianza_estimacion: p.proyeccion?.confianza.etiqueta ?? null,
          comportamiento: p.regularidad?.etiqueta,
          tendencia: p.tendencia?.etiqueta,
          pedidos_anomalos_detectados: p.atipicos,
          periodos_con_consumo: p.periodos_con_consumo,
        })),
      });
    },
  });

  const buscarSolicitudes = betaTool({
    name: "buscar_solicitudes",
    description:
      "Busca solicitudes del portal por estado, equipo, fecha o texto libre. " +
      "Sirve para preguntas como 'que solicitudes están pendientes', 'que pidio " +
      "Maule Norte 2 esta semana' o 'hay algo urgente sin gestionar'.",
    inputSchema: {
      type: "object",
      properties: {
        estado: {
          type: "string",
          enum: ["PENDIENTE", "EN_REVISION", "APROBADO", "EN_DESPACHO", "ENTREGADO", "RECHAZADO"],
          description: "Filtrar por estado de la solicitud.",
        },
        equipoId: { type: "integer", description: "Limitar a un equipo." },
        texto: { type: "string", description: "Buscar en producto, equipo o solicitante." },
        fechaDesde: { type: "string", description: "Formato AAAA-MM-DD." },
        fechaHasta: { type: "string", description: "Formato AAAA-MM-DD." },
        soloUrgentes: {
          type: "boolean",
          description: "Solo las que llevan mucho tiempo sin movimiento.",
        },
      },
      required: [],
    },
    run: async (input) => {
      const respuesta = await solicitudesService.listSolicitudes(actor, {
        estado: input.estado,
        equipoId: input.equipoId,
        texto: input.texto,
        fechaDesde: input.fechaDesde,
        fechaHasta: input.fechaHasta,
        soloUrgentes: input.soloUrgentes ? "1" : undefined,
        limit: MAX_SOLICITUDES,
        empresa,
      });

      const filas = respuesta?.data || respuesta || [];
      if (!filas.length) {
        return JSON.stringify({ resultado: "No hay solicitudes que coincidan con esa busqueda." });
      }

      return JSON.stringify({
        encontradas: filas.length,
        solicitudes: filas.slice(0, MAX_SOLICITUDES).map((s) => ({
          id: s.id,
          estado: s.estado,
          equipo: s.nombre_equipo || s.equipo || "Sin equipo",
          solicitante: s.solicitante_name || s.solicitante_nombre || s.solicitante,
          productos: recortar(s.resumen_items || s.repuesto),
          total_productos: s.total_items,
          total_unidades: s.total_unidades,
          creada: String(s.created_at || "").slice(0, 10),
          dias_sin_movimiento: s.dias_sin_movimiento,
        })),
      });
    },
  });

  const listarEquipos = betaTool({
    name: "listar_equipos",
    description:
      "Lista los equipos con su id y nombre. Usala cuando necesites el id de un " +
      "equipo para filtrar en otra herramienta, o para saber que equipos existen.",
    inputSchema: { type: "object", properties: {}, required: [] },
    run: async () => {
      const respuesta = await equiposService.listEquipos(actor, { empresa });
      const equipos = respuesta?.data || respuesta || [];
      return JSON.stringify({
        equipos: equipos.map((e) => ({
          id: e.id,
          nombre: e.nombre_equipo || e.nombre || `Equipo ${e.id}`,
        })),
      });
    },
  });

  const herramientas = [buscarSolicitudes, listarEquipos];
  if (puedeVerConsumo(actor)) {
    herramientas.unshift(consultarConsumo);
  }
  return herramientas;
}

module.exports = {
  construirHerramientas,
};
