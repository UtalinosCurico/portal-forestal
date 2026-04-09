const { query, transaction } = require("../database/db");

function visibilityClause(user, params) {
  if (user.role === "Operador") {
    params.push(user.id);
    return `s.solicitante_id = $${params.length}`;
  }
  if (user.role === "Jefe de faena") {
    params.push(user.faenaId);
    return `s.faena_id = $${params.length}`;
  }
  return null;
}

async function findById(id) {
  const solicitudResult = await query(
    `
      SELECT
        s.*,
        su.nombre AS solicitante_nombre,
        rv.nombre AS revisado_por_nombre,
        dp.nombre AS despachado_por_nombre,
        rc.nombre AS recibido_por_nombre,
        e.nombre AS equipo_nombre,
        e.codigo AS equipo_codigo,
        f.nombre AS faena_nombre
      FROM solicitudes s
      INNER JOIN users su ON su.id = s.solicitante_id
      LEFT JOIN users rv ON rv.id = s.revisado_por
      LEFT JOIN users dp ON dp.id = s.despachado_por
      LEFT JOIN users rc ON rc.id = s.recibido_por
      LEFT JOIN equipos e ON e.id = s.equipo_id
      INNER JOIN faenas f ON f.id = s.faena_id
      WHERE s.id = $1
    `,
    [id]
  );

  if (solicitudResult.rowCount === 0) {
    return null;
  }

  const itemsResult = await query(
    `
      SELECT
        si.id,
        si.repuesto_id,
        r.codigo AS repuesto_codigo,
        r.nombre AS repuesto_nombre,
        r.unidad_medida,
        si.cantidad
      FROM solicitud_items si
      INNER JOIN repuestos r ON r.id = si.repuesto_id
      WHERE si.solicitud_id = $1
      ORDER BY si.id ASC
    `,
    [id]
  );

  return {
    ...solicitudResult.rows[0],
    items: itemsResult.rows,
  };
}

async function getHistorial(solicitudId) {
  const { rows } = await query(
    `
      SELECT
        h.id,
        h.estado_anterior,
        h.estado_nuevo,
        h.accion,
        h.comentario,
        h.created_at,
        u.nombre AS actor_nombre
      FROM solicitud_historial h
      INNER JOIN users u ON u.id = h.user_id
      WHERE h.solicitud_id = $1
      ORDER BY h.created_at ASC
    `,
    [solicitudId]
  );
  return rows;
}

async function list({ page = 1, limit = 20, estado, faenaId, fechaDesde, fechaHasta }, user) {
  const params = [];
  const filters = [];

  const visibility = visibilityClause(user, params);
  if (visibility) {
    filters.push(visibility);
  }
  if (estado) {
    params.push(estado);
    filters.push(`s.estado = $${params.length}`);
  }
  if (faenaId) {
    params.push(faenaId);
    filters.push(`s.faena_id = $${params.length}`);
  }
  if (fechaDesde) {
    params.push(fechaDesde);
    filters.push(`s.created_at >= $${params.length}`);
  }
  if (fechaHasta) {
    params.push(fechaHasta);
    filters.push(`s.created_at <= $${params.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (page - 1) * limit;
  params.push(limit);
  params.push(offset);

  const sql = `
    SELECT
      s.id,
      s.folio,
      s.estado,
      s.created_at,
      s.updated_at,
      s.fecha_revision,
      s.fecha_despacho,
      s.fecha_recepcion,
      su.nombre AS solicitante_nombre,
      f.nombre AS faena_nombre,
      e.nombre AS equipo_nombre,
      COUNT(si.id)::INT AS total_items
    FROM solicitudes s
    INNER JOIN users su ON su.id = s.solicitante_id
    INNER JOIN faenas f ON f.id = s.faena_id
    LEFT JOIN equipos e ON e.id = s.equipo_id
    LEFT JOIN solicitud_items si ON si.solicitud_id = s.id
    ${where}
    GROUP BY s.id, su.nombre, f.nombre, e.nombre
    ORDER BY s.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length};
  `;
  const { rows } = await query(sql, params);
  return rows;
}

async function create({ solicitanteId, equipoId, faenaId, comentario, items }) {
  return transaction(async (client) => {
    const tempFolio = `TMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const solicitudResult = await client.query(
      `
        INSERT INTO solicitudes
          (folio, estado, solicitante_id, equipo_id, faena_id, comentario)
        VALUES ($1, 'pendiente', $2, $3, $4, $5)
        RETURNING id, created_at
      `,
      [tempFolio, solicitanteId, equipoId || null, faenaId, comentario || null]
    );

    const solicitudId = solicitudResult.rows[0].id;
    const year = new Date().getUTCFullYear();
    const folio = `FMN-${year}-${String(solicitudId).padStart(6, "0")}`;

    await client.query("UPDATE solicitudes SET folio = $1 WHERE id = $2", [folio, solicitudId]);

    for (const item of items) {
      await client.query(
        `
          INSERT INTO solicitud_items (solicitud_id, repuesto_id, cantidad)
          VALUES ($1, $2, $3)
        `,
        [solicitudId, item.repuestoId, item.cantidad]
      );
    }

    await client.query(
      `
        INSERT INTO solicitud_historial
          (solicitud_id, estado_anterior, estado_nuevo, accion, comentario, user_id)
        VALUES ($1, NULL, 'pendiente', 'creada', $2, $3)
      `,
      [solicitudId, comentario || "Solicitud creada", solicitanteId]
    );

    return solicitudId;
  });
}

async function updatePending(solicitudId, { equipoId, comentario, items }) {
  return transaction(async (client) => {
    const fields = [];
    const params = [];

    if (equipoId !== undefined) {
      params.push(equipoId);
      fields.push(`equipo_id = $${params.length}`);
    }
    if (comentario !== undefined) {
      params.push(comentario);
      fields.push(`comentario = $${params.length}`);
    }
    if (fields.length > 0) {
      params.push(solicitudId);
      await client.query(
        `
          UPDATE solicitudes
          SET ${fields.join(", ")}, updated_at = NOW()
          WHERE id = $${params.length}
        `,
        params
      );
    }

    if (Array.isArray(items) && items.length > 0) {
      await client.query("DELETE FROM solicitud_items WHERE solicitud_id = $1", [solicitudId]);
      for (const item of items) {
        await client.query(
          "INSERT INTO solicitud_items (solicitud_id, repuesto_id, cantidad) VALUES ($1, $2, $3)",
          [solicitudId, item.repuestoId, item.cantidad]
        );
      }
    }
  });
}

async function updateStatus(solicitudId, statusPayload) {
  const {
    estadoNuevo,
    actorId,
    comentario,
    setFechaRevision,
    setFechaDespacho,
    setFechaRecepcion,
  } = statusPayload;

  return transaction(async (client) => {
    const solicitudCurrent = await client.query(
      "SELECT estado FROM solicitudes WHERE id = $1 FOR UPDATE",
      [solicitudId]
    );
    if (solicitudCurrent.rowCount === 0) {
      return null;
    }

    const estadoAnterior = solicitudCurrent.rows[0].estado;
    const updateParts = ["estado = $1", "updated_at = NOW()"];
    const values = [estadoNuevo];

    if (setFechaRevision) {
      updateParts.push(`fecha_revision = NOW()`);
      values.push(actorId);
      updateParts.push(`revisado_por = $${values.length}`);
    }

    if (setFechaDespacho) {
      updateParts.push(`fecha_despacho = NOW()`);
      values.push(actorId);
      updateParts.push(`despachado_por = $${values.length}`);
    }

    if (setFechaRecepcion) {
      updateParts.push(`fecha_recepcion = NOW()`);
      values.push(actorId);
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
      [solicitudId, estadoAnterior, estadoNuevo, comentario || null, actorId]
    );

    return { estadoAnterior, estadoNuevo };
  });
}

async function addHistorial({ solicitudId, estadoAnterior, estadoNuevo, accion, comentario, userId }) {
  await query(
    `
      INSERT INTO solicitud_historial
      (solicitud_id, estado_anterior, estado_nuevo, accion, comentario, user_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [solicitudId, estadoAnterior, estadoNuevo, accion, comentario || null, userId]
  );
}

module.exports = {
  findById,
  getHistorial,
  list,
  create,
  updatePending,
  updateStatus,
  addHistorial,
};

