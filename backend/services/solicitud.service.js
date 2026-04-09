// DEPRECATED: Este servicio pertenece al stack de app.js, que no es el entry point de producción.
// El stack activo en producción (server.js) usa solicitudesService.js → solicitudesPgService.js.
// Este archivo usa status-flow.js (valores lowercase) que es incompatible con los valores
// UPPERCASE que la base de datos PostgreSQL de producción almacena.
// No activar ni extender este archivo sin migrar primero a solicitudFlow.js.

const { transaction } = require("../database/db");
const solicitudModel = require("../models/solicitud.model");
const { STATUS, canTransition } = require("../config/status-flow");
const { ROLES } = require("../config/roles");
const { AppError } = require("../utils/errors");
const { requireFields, isPositiveNumber } = require("../utils/validators");
const { buildSolicitudTimeline } = require("./audit.service");

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError("Debe incluir al menos un ítem", 400, "VALIDATION_ERROR");
  }
  for (const item of items) {
    if (!item.repuestoId || !isPositiveNumber(item.cantidad)) {
      throw new AppError("Ítem inválido: repuestoId y cantidad > 0 son obligatorios", 400, "VALIDATION_ERROR");
    }
  }
}

function canViewSolicitud(actor, solicitud) {
  if (actor.role === ROLES.OPERADOR) {
    return solicitud.solicitante_id === actor.id;
  }
  if (actor.role === ROLES.JEFE_FAENA) {
    return solicitud.faena_id === actor.faenaId;
  }
  return true;
}

async function createSolicitud(actor, payload) {
  requireFields(payload, ["items"]);
  validateItems(payload.items);

  const restrictedRole = [ROLES.JEFE_FAENA, ROLES.OPERADOR].includes(actor.role);
  const faenaId = restrictedRole ? actor.faenaId : payload.faenaId || actor.faenaId;
  if (!faenaId) {
    throw new AppError("No se pudo determinar la faena de la solicitud", 400, "VALIDATION_ERROR");
  }

  const solicitudId = await solicitudModel.create({
    solicitanteId: actor.id,
    equipoId: payload.equipoId || null,
    faenaId,
    comentario: payload.comentario || null,
    items: payload.items.map((item) => ({
      repuestoId: Number(item.repuestoId),
      cantidad: Number(item.cantidad),
    })),
  });

  return solicitudModel.findById(solicitudId);
}

async function listSolicitudes(actor, filters) {
  return solicitudModel.list(
    {
      page: Number(filters.page || 1),
      limit: Number(filters.limit || 20),
      estado: filters.estado,
      faenaId: filters.faenaId ? Number(filters.faenaId) : undefined,
      fechaDesde: filters.fechaDesde,
      fechaHasta: filters.fechaHasta,
    },
    actor
  );
}

async function getSolicitud(actor, solicitudId) {
  const solicitud = await solicitudModel.findById(solicitudId);
  if (!solicitud) {
    throw new AppError("Solicitud no encontrada", 404, "NOT_FOUND");
  }
  if (!canViewSolicitud(actor, solicitud)) {
    throw new AppError("No puede ver esta solicitud", 403, "FORBIDDEN");
  }
  return solicitud;
}

async function editPending(actor, solicitudId, payload) {
  const solicitud = await getSolicitud(actor, solicitudId);
  if (solicitud.estado !== STATUS.PENDIENTE) {
    throw new AppError("Solo se pueden editar solicitudes en estado pendiente", 409, "INVALID_STATE");
  }

  const ownerOrManager =
    solicitud.solicitante_id === actor.id ||
    [ROLES.ADMINISTRADOR, ROLES.SUPERVISOR].includes(actor.role);
  if (!ownerOrManager) {
    throw new AppError("Solo el autor puede editar la solicitud pendiente", 403, "FORBIDDEN");
  }

  if (payload.items) {
    validateItems(payload.items);
  }

  await solicitudModel.updatePending(solicitudId, {
    equipoId: payload.equipoId,
    comentario: payload.comentario,
    items: payload.items
      ? payload.items.map((item) => ({
          repuestoId: Number(item.repuestoId),
          cantidad: Number(item.cantidad),
        }))
      : undefined,
  });

  await solicitudModel.addHistorial({
    solicitudId,
    estadoAnterior: STATUS.PENDIENTE,
    estadoNuevo: STATUS.PENDIENTE,
    accion: "edicion_pendiente",
    comentario: "Solicitud pendiente actualizada",
    userId: actor.id,
  });

  return solicitudModel.findById(solicitudId);
}

async function changeStatus(actor, solicitudId, payload) {
  if (![ROLES.SUPERVISOR, ROLES.ADMINISTRADOR].includes(actor.role)) {
    throw new AppError("Solo Supervisor o Administrador pueden cambiar estados", 403, "FORBIDDEN");
  }
  requireFields(payload, ["estado"]);

  return transaction(async (client) => {
    const solicitudResult = await client.query(
      `
        SELECT id, estado, faena_id
        FROM solicitudes
        WHERE id = $1
        FOR UPDATE
      `,
      [solicitudId]
    );
    if (solicitudResult.rowCount === 0) {
      throw new AppError("Solicitud no encontrada", 404, "NOT_FOUND");
    }

    const solicitud = solicitudResult.rows[0];
    const estadoAnterior = solicitud.estado;
    const estadoNuevo = payload.estado;

    if (!canTransition(estadoAnterior, estadoNuevo)) {
      throw new AppError(
        `Transición inválida de '${estadoAnterior}' a '${estadoNuevo}'`,
        409,
        "INVALID_STATE"
      );
    }

    const itemsResult = await client.query(
      `
        SELECT si.repuesto_id, si.cantidad, r.codigo, r.nombre
        FROM solicitud_items si
        INNER JOIN repuestos r ON r.id = si.repuesto_id
        WHERE si.solicitud_id = $1
      `,
      [solicitudId]
    );
    const items = itemsResult.rows;

    if (estadoNuevo === STATUS.EN_DESPACHO) {
      for (const item of items) {
        const stockResult = await client.query(
          "SELECT cantidad FROM stock_bodega WHERE repuesto_id = $1 FOR UPDATE",
          [item.repuesto_id]
        );
        const currentStock = Number(stockResult.rows[0]?.cantidad || 0);
        const requestedQty = Number(item.cantidad);
        if (currentStock < requestedQty) {
          throw new AppError(
            `Stock insuficiente para ${item.nombre} (${item.codigo})`,
            409,
            "INSUFFICIENT_STOCK"
          );
        }

        await client.query(
          `
            UPDATE stock_bodega
            SET cantidad = cantidad - $2, last_updated = NOW()
            WHERE repuesto_id = $1
          `,
          [item.repuesto_id, requestedQty]
        );

        await client.query(
          `
            INSERT INTO inventario_movimientos
              (repuesto_id, faena_id, solicitud_id, user_id, tipo, cantidad, origen, destino, comentario)
            VALUES ($1, $2, $3, $4, 'despacho', $5, 'bodega central', 'faena', $6)
          `,
          [
            item.repuesto_id,
            solicitud.faena_id,
            solicitudId,
            actor.id,
            requestedQty * -1,
            `Descuento automático por despacho de solicitud ${solicitudId}`,
          ]
        );
      }
    }

    if (estadoNuevo === STATUS.ENTREGADO) {
      for (const item of items) {
        const qty = Number(item.cantidad);
        await client.query(
          `
            INSERT INTO stock_faena (faena_id, repuesto_id, cantidad, last_updated)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (faena_id, repuesto_id)
            DO UPDATE SET cantidad = stock_faena.cantidad + EXCLUDED.cantidad, last_updated = NOW()
          `,
          [solicitud.faena_id, item.repuesto_id, qty]
        );
        await client.query(
          `
            INSERT INTO inventario_movimientos
              (repuesto_id, faena_id, solicitud_id, user_id, tipo, cantidad, origen, destino, comentario)
            VALUES ($1, $2, $3, $4, 'recepcion', $5, 'en tránsito', 'faena', $6)
          `,
          [
            item.repuesto_id,
            solicitud.faena_id,
            solicitudId,
            actor.id,
            qty,
            `Ingreso automático por recepción de solicitud ${solicitudId}`,
          ]
        );
      }
    }

    const updateParts = ["estado = $1", "updated_at = NOW()"];
    const values = [estadoNuevo];

    if ([STATUS.EN_REVISION, STATUS.APROBADO, STATUS.RECHAZADO].includes(estadoNuevo)) {
      updateParts.push("fecha_revision = COALESCE(fecha_revision, NOW())");
      values.push(actor.id);
      updateParts.push(`revisado_por = $${values.length}`);
    }
    if (estadoNuevo === STATUS.EN_DESPACHO) {
      updateParts.push("fecha_despacho = NOW()");
      values.push(actor.id);
      updateParts.push(`despachado_por = $${values.length}`);
    }
    if (estadoNuevo === STATUS.ENTREGADO) {
      updateParts.push("fecha_recepcion = NOW()");
      values.push(actor.id);
      updateParts.push(`recibido_por = $${values.length}`);
    }

    values.push(solicitudId);
    await client.query(
      `
        UPDATE solicitudes
        SET ${updateParts.join(", ")}
        WHERE id = $${values.length}
      `,
      values
    );

    await client.query(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, estado_anterior, estado_nuevo, accion, comentario, user_id)
        VALUES ($1, $2, $3, 'cambio_estado', $4, $5)
      `,
      [solicitudId, estadoAnterior, estadoNuevo, payload.comentario || null, actor.id]
    );
  });
}

async function getHistorial(actor, solicitudId) {
  await getSolicitud(actor, solicitudId);
  const rows = await solicitudModel.getHistorial(solicitudId);
  return buildSolicitudTimeline(rows);
}

async function updateSolicitud(actor, solicitudId, payload) {
  if (payload.estado) {
    await changeStatus(actor, solicitudId, payload);
  } else {
    await editPending(actor, solicitudId, payload);
  }
  return getSolicitud(actor, solicitudId);
}

module.exports = {
  createSolicitud,
  listSolicitudes,
  getSolicitud,
  getHistorial,
  updateSolicitud,
};

