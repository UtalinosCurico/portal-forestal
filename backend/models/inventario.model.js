const { query, transaction } = require("../database/db");

async function listRepuestos({ page = 1, limit = 50, faenaId }) {
  const offset = (page - 1) * limit;
  const params = [limit, offset];
  const faenaJoinValue = faenaId || null;
  const sql = `
    SELECT
      r.id,
      r.codigo,
      r.nombre,
      r.unidad_medida,
      r.activo,
      r.updated_at AS fecha_ultima_actualizacion,
      COALESCE(sb.cantidad, 0) AS stock_bodega_central,
      COALESCE(sf.cantidad, 0) AS stock_faena
    FROM repuestos r
    LEFT JOIN stock_bodega sb ON sb.repuesto_id = r.id
    LEFT JOIN stock_faena sf ON sf.repuesto_id = r.id AND sf.faena_id = $3
    ORDER BY r.nombre ASC
    LIMIT $1 OFFSET $2
  `;
  params.push(faenaJoinValue);
  const { rows } = await query(sql, params);
  return rows;
}

async function findRepuestoById(repuestoId) {
  const { rows } = await query(
    `
      SELECT
        r.id,
        r.codigo,
        r.nombre,
        r.unidad_medida,
        r.activo,
        COALESCE(sb.cantidad, 0) AS stock_bodega_central
      FROM repuestos r
      LEFT JOIN stock_bodega sb ON sb.repuesto_id = r.id
      WHERE r.id = $1
    `,
    [repuestoId]
  );
  return rows[0] || null;
}

async function createRepuesto({ codigo, nombre, unidadMedida, stockBodega = 0 }) {
  return transaction(async (client) => {
    const repuestoResult = await client.query(
      `
        INSERT INTO repuestos (codigo, nombre, unidad_medida)
        VALUES ($1, $2, $3)
        RETURNING id
      `,
      [codigo, nombre, unidadMedida]
    );
    const repuestoId = repuestoResult.rows[0].id;
    await client.query(
      `
        INSERT INTO stock_bodega (repuesto_id, cantidad)
        VALUES ($1, $2)
      `,
      [repuestoId, stockBodega]
    );
    return findRepuestoById(repuestoId);
  });
}

async function updateRepuesto(id, { codigo, nombre, unidadMedida, activo, stockBodega }) {
  return transaction(async (client) => {
    const fields = [];
    const params = [];
    if (codigo !== undefined) {
      params.push(codigo);
      fields.push(`codigo = $${params.length}`);
    }
    if (nombre !== undefined) {
      params.push(nombre);
      fields.push(`nombre = $${params.length}`);
    }
    if (unidadMedida !== undefined) {
      params.push(unidadMedida);
      fields.push(`unidad_medida = $${params.length}`);
    }
    if (activo !== undefined) {
      params.push(activo);
      fields.push(`activo = $${params.length}`);
    }

    if (fields.length > 0) {
      params.push(id);
      await client.query(
        `
          UPDATE repuestos
          SET ${fields.join(", ")}, updated_at = NOW()
          WHERE id = $${params.length}
        `,
        params
      );
    }

    if (stockBodega !== undefined) {
      await client.query(
        `
          INSERT INTO stock_bodega (repuesto_id, cantidad, last_updated)
          VALUES ($1, $2, NOW())
          ON CONFLICT (repuesto_id)
          DO UPDATE SET cantidad = EXCLUDED.cantidad, last_updated = NOW()
        `,
        [id, stockBodega]
      );
    }

    return findRepuestoById(id);
  });
}

async function registerMovement({
  repuestoId,
  faenaId,
  solicitudId,
  userId,
  tipo,
  cantidad,
  origen,
  destino,
  comentario,
}) {
  const { rows } = await query(
    `
      INSERT INTO inventario_movimientos
      (repuesto_id, faena_id, solicitud_id, user_id, tipo, cantidad, origen, destino, comentario)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      repuestoId,
      faenaId || null,
      solicitudId || null,
      userId,
      tipo,
      cantidad,
      origen || null,
      destino || null,
      comentario || null,
    ]
  );
  return rows[0];
}

async function adjustStockBodega(client, repuestoId, delta) {
  await client.query(
    `
      INSERT INTO stock_bodega (repuesto_id, cantidad, last_updated)
      VALUES ($1, $2, NOW())
      ON CONFLICT (repuesto_id)
      DO UPDATE SET
        cantidad = stock_bodega.cantidad + EXCLUDED.cantidad,
        last_updated = NOW()
    `,
    [repuestoId, delta]
  );
}

async function adjustStockFaena(client, faenaId, repuestoId, delta) {
  await client.query(
    `
      INSERT INTO stock_faena (faena_id, repuesto_id, cantidad, last_updated)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (faena_id, repuesto_id)
      DO UPDATE SET
        cantidad = stock_faena.cantidad + EXCLUDED.cantidad,
        last_updated = NOW()
    `,
    [faenaId, repuestoId, delta]
  );
}

async function getStockBodegaForUpdate(client, repuestoId) {
  const result = await client.query(
    `
      SELECT cantidad
      FROM stock_bodega
      WHERE repuesto_id = $1
      FOR UPDATE
    `,
    [repuestoId]
  );
  return Number(result.rows[0]?.cantidad || 0);
}

module.exports = {
  listRepuestos,
  findRepuestoById,
  createRepuesto,
  updateRepuesto,
  registerMovement,
  adjustStockBodega,
  adjustStockFaena,
  getStockBodegaForUpdate,
  transaction,
};

