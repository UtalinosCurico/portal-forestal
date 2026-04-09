const { all, get, run } = require("../db/database");
const { ROLES } = require("../config/appRoles");
const { isGlobalRole, requireTeamAssigned } = require("../middleware/roles");
const { HttpError } = require("../utils/httpError");

function getActorRole(actor) {
  return actor.rol || actor.role;
}

async function ensureEquipoStockRowsForRepuesto(repuestoId, stockFaenaInicial = 0) {
  const equipos = await all("SELECT id FROM equipos ORDER BY id ASC");
  if (!equipos.length) {
    return;
  }

  const total = Number(stockFaenaInicial || 0);
  const base = Math.floor(total / equipos.length);
  let remainder = total % equipos.length;

  for (const equipo of equipos) {
    const exists = await get(
      "SELECT id FROM equipo_stock WHERE equipo_id = ? AND repuesto_id = ?",
      [equipo.id, repuestoId]
    );
    if (exists) {
      continue;
    }

    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) {
      remainder -= 1;
    }

    await run(
      `
        INSERT INTO equipo_stock (equipo_id, repuesto_id, stock, ultima_actualizacion)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `,
      [equipo.id, repuestoId, base + extra]
    );
  }
}

async function listInventario(actor) {
  const actorRole = getActorRole(actor);

  if (isGlobalRole(actorRole)) {
    return all(
      `
        SELECT
          i.id,
          i.codigo,
          i.nombre,
          i.stock_central,
          i.stock_faena,
          i.unidad_medida,
          i.critical_level,
          i.updated_at,
          COALESCE(
            (
              SELECT GROUP_CONCAT(e.nombre_equipo || ' (' || es.stock || ')', ' | ')
              FROM equipo_stock es
              INNER JOIN equipos e ON e.id = es.equipo_id
              WHERE es.repuesto_id = i.id
                AND es.stock > 0
            ),
            'Sin stock en faena'
          ) AS faenas_con_stock,
          CASE WHEN i.stock_central <= i.critical_level THEN 1 ELSE 0 END AS stock_critico
        FROM inventario i
        ORDER BY i.nombre ASC
      `
    );
  }

  requireTeamAssigned(actor);

  return all(
    `
      SELECT
        i.id,
        i.codigo,
        i.nombre,
        i.unidad_medida,
        es.stock AS stock_disponible,
        es.ultima_actualizacion,
        CASE
          WHEN es.stock = 0 THEN 'ROJO'
          WHEN es.stock <= 2 THEN 'AMARILLO'
          ELSE 'VERDE'
        END AS estado_stock
      FROM equipo_stock es
      INNER JOIN inventario i ON i.id = es.repuesto_id
      WHERE es.equipo_id = ?
      ORDER BY i.nombre ASC
    `,
    [actor.equipo_id]
  );
}

async function createInventario(actor, payload) {
  const actorRole = getActorRole(actor);
  if (![ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA].includes(actorRole)) {
    throw new HttpError(403, "No tiene permisos para crear inventario");
  }

  const codigo = String(payload.codigo || "").trim();
  const nombre = String(payload.nombre || "").trim();
  const stockCentral = Number(payload.stock_central || 0);
  const stockFaena = Number(payload.stock_faena || 0);
  const unidad = String(payload.unidad_medida || "unidad").trim();
  const criticalLevel = Number(payload.critical_level || 5);

  if (!codigo || !nombre) {
    throw new HttpError(400, "Los campos 'codigo' y 'nombre' son obligatorios");
  }
  if (!Number.isInteger(stockCentral) || stockCentral < 0) {
    throw new HttpError(400, "stock_central debe ser un entero mayor o igual a cero");
  }
  if (!Number.isInteger(stockFaena) || stockFaena < 0) {
    throw new HttpError(400, "stock_faena debe ser un entero mayor o igual a cero");
  }
  if (!Number.isInteger(criticalLevel) || criticalLevel < 0) {
    throw new HttpError(400, "critical_level debe ser un entero mayor o igual a cero");
  }

  const exists = await get("SELECT id FROM inventario WHERE codigo = ?", [codigo]);
  if (exists) {
    throw new HttpError(409, "Ya existe un item de inventario con ese codigo");
  }

  const result = await run(
    `
      INSERT INTO inventario
        (codigo, nombre, stock_central, stock_faena, unidad_medida, critical_level, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `,
    [codigo, nombre, stockCentral, stockFaena, unidad, criticalLevel]
  );

  await run(
    `
      INSERT INTO inventario_movimientos
        (inventario_id, tipo, cantidad, detalle, actor_id)
      VALUES (?, 'CREACION', ?, ?, ?)
    `,
    [result.lastID, stockCentral, "Creacion inicial de item", actor.id]
  );

  await ensureEquipoStockRowsForRepuesto(result.lastID, stockFaena);

  return get("SELECT * FROM inventario WHERE id = ?", [result.lastID]);
}

async function updateInventario(actor, inventarioId, payload) {
  const actorRole = getActorRole(actor);
  if (![ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA].includes(actorRole)) {
    throw new HttpError(403, "No tiene permisos para actualizar inventario");
  }

  const current = await get("SELECT * FROM inventario WHERE id = ?", [inventarioId]);
  if (!current) {
    throw new HttpError(404, "Item de inventario no encontrado");
  }

  const updates = [];
  const params = [];

  if (payload.codigo !== undefined) {
    const codigo = String(payload.codigo).trim();
    if (!codigo) {
      throw new HttpError(400, "codigo no puede estar vacio");
    }
    updates.push("codigo = ?");
    params.push(codigo);
  }

  if (payload.nombre !== undefined) {
    const nombre = String(payload.nombre).trim();
    if (!nombre) {
      throw new HttpError(400, "nombre no puede estar vacio");
    }
    updates.push("nombre = ?");
    params.push(nombre);
  }

  if (payload.unidad_medida !== undefined) {
    updates.push("unidad_medida = ?");
    params.push(String(payload.unidad_medida || "unidad").trim() || "unidad");
  }

  if (payload.critical_level !== undefined) {
    const criticalLevel = Number(payload.critical_level);
    if (!Number.isInteger(criticalLevel) || criticalLevel < 0) {
      throw new HttpError(400, "critical_level debe ser un entero mayor o igual a cero");
    }
    updates.push("critical_level = ?");
    params.push(criticalLevel);
  }

  let centralDelta = 0;
  if (payload.stock_central !== undefined) {
    const stockCentral = Number(payload.stock_central);
    if (!Number.isInteger(stockCentral) || stockCentral < 0) {
      throw new HttpError(400, "stock_central debe ser un entero mayor o igual a cero");
    }
    centralDelta = stockCentral - Number(current.stock_central);
    updates.push("stock_central = ?");
    params.push(stockCentral);
  }

  if (payload.stock_faena !== undefined) {
    const stockFaena = Number(payload.stock_faena);
    if (!Number.isInteger(stockFaena) || stockFaena < 0) {
      throw new HttpError(400, "stock_faena debe ser un entero mayor o igual a cero");
    }
    updates.push("stock_faena = ?");
    params.push(stockFaena);
  }

  if (updates.length === 0) {
    throw new HttpError(400, "No se enviaron cambios para actualizar");
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(inventarioId);

  await run(
    `
      UPDATE inventario
      SET ${updates.join(", ")}
      WHERE id = ?
    `,
    params
  );

  if (centralDelta !== 0) {
    await run(
      `
        INSERT INTO inventario_movimientos
          (inventario_id, tipo, cantidad, detalle, actor_id)
        VALUES (?, 'AJUSTE_CENTRAL', ?, ?, ?)
      `,
      [inventarioId, centralDelta, "Ajuste de stock central", actor.id]
    );
  }

  await ensureEquipoStockRowsForRepuesto(inventarioId, 0);

  return get("SELECT * FROM inventario WHERE id = ?", [inventarioId]);
}

async function deleteInventario(actor, inventarioId) {
  const actorRole = getActorRole(actor);
  if (![ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.SECRETARIA].includes(actorRole)) {
    throw new HttpError(403, "No tiene permisos para eliminar inventario");
  }

  const current = await get("SELECT * FROM inventario WHERE id = ?", [inventarioId]);
  if (!current) {
    throw new HttpError(404, "Item de inventario no encontrado");
  }

  await run("DELETE FROM equipo_stock WHERE repuesto_id = ?", [inventarioId]);
  await run("DELETE FROM inventario_movimientos WHERE inventario_id = ?", [inventarioId]);
  await run("DELETE FROM inventario WHERE id = ?", [inventarioId]);

  return {
    id: inventarioId,
    codigo: current.codigo,
    nombre: current.nombre,
    deleted_at: new Date().toISOString(),
  };
}

module.exports = {
  listInventario,
  createInventario,
  updateInventario,
  deleteInventario,
};
