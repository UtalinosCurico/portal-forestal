const { all, get, run } = require("../db/database");
const { isGlobalRole, requireTeamAssigned } = require("../middleware/roles");
const { HttpError } = require("../utils/httpError");

function getActorRole(actor) {
  return actor.rol || actor.role;
}

function mapStockState(stock) {
  const value = Number(stock || 0);
  if (value <= 0) {
    return "ROJO";
  }
  if (value <= 2) {
    return "AMARILLO";
  }
  return "VERDE";
}

async function listEquipos(actor) {
  if (isGlobalRole(getActorRole(actor))) {
    return all(
      `
        SELECT id, nombre_equipo
        FROM equipos
        ORDER BY nombre_equipo ASC
      `
    );
  }

  requireTeamAssigned(actor);
  return all(
    `
      SELECT id, nombre_equipo
      FROM equipos
      WHERE id = ?
      ORDER BY nombre_equipo ASC
    `,
    [actor.equipo_id]
  );
}

async function listEquipoStock(actor) {
  const visibility = isGlobalRole(getActorRole(actor))
    ? { clause: "", params: [] }
    : (() => {
        requireTeamAssigned(actor);
        return { clause: "WHERE es.equipo_id = ?", params: [actor.equipo_id] };
      })();

  const rows = await all(
    `
      SELECT
        es.id,
        es.equipo_id,
        e.nombre_equipo,
        es.repuesto_id,
        i.codigo AS repuesto_codigo,
        i.nombre AS repuesto,
        i.unidad_medida,
        es.stock,
        es.ultima_actualizacion
      FROM equipo_stock es
      INNER JOIN equipos e ON e.id = es.equipo_id
      INNER JOIN inventario i ON i.id = es.repuesto_id
      ${visibility.clause}
      ORDER BY e.nombre_equipo ASC, i.nombre ASC
    `,
    visibility.params
  );

  return rows.map((row) => ({
    ...row,
    estado_stock: mapStockState(row.stock),
  }));
}

async function getEquipoStockByEquipoId(actor, equipoId) {
  const role = getActorRole(actor);
  const teamId = Number(equipoId);
  if (!Number.isInteger(teamId) || teamId <= 0) {
    throw new HttpError(400, "equipoId invalido");
  }

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    if (Number(actor.equipo_id) !== teamId) {
      throw new HttpError(403, "No puede ver stock de otro equipo");
    }
  }

  const rows = await all(
    `
      SELECT
        es.id,
        es.equipo_id,
        e.nombre_equipo,
        es.repuesto_id,
        i.codigo AS repuesto_codigo,
        i.nombre AS repuesto,
        i.unidad_medida,
        es.stock,
        es.ultima_actualizacion
      FROM equipo_stock es
      INNER JOIN equipos e ON e.id = es.equipo_id
      INNER JOIN inventario i ON i.id = es.repuesto_id
      WHERE es.equipo_id = ?
      ORDER BY i.nombre ASC
    `,
    [teamId]
  );

  return rows.map((row) => ({
    ...row,
    estado_stock: mapStockState(row.stock),
  }));
}

async function syncStockFaenaInventario(repuestoId) {
  const row = await get(
    `
      SELECT COALESCE(SUM(stock), 0) AS total
      FROM equipo_stock
      WHERE repuesto_id = ?
    `,
    [repuestoId]
  );

  await run(
    `
      UPDATE inventario
      SET stock_faena = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [Number(row?.total || 0), repuestoId]
  );
}

async function createEquipo(payload) {
  const nombre = String(payload.nombre_equipo || payload.nombre || "").trim();
  if (!nombre) {
    throw new HttpError(400, "nombre_equipo es obligatorio");
  }

  const existing = await get("SELECT id FROM equipos WHERE nombre_equipo = ?", [nombre]);
  if (existing) {
    throw new HttpError(409, "Ya existe un equipo con ese nombre");
  }

  const result = await run("INSERT INTO equipos (nombre_equipo) VALUES (?)", [nombre]);

  const inventario = await all("SELECT id FROM inventario ORDER BY id ASC");
  for (const item of inventario) {
    await run(
      `
        INSERT OR IGNORE INTO equipo_stock (equipo_id, repuesto_id, stock, ultima_actualizacion)
        VALUES (?, ?, 0, CURRENT_TIMESTAMP)
      `,
      [result.lastID, item.id]
    );
  }

  return get("SELECT id, nombre_equipo FROM equipos WHERE id = ?", [result.lastID]);
}

async function updateEquipo(equipoId, payload) {
  const current = await get("SELECT id, nombre_equipo FROM equipos WHERE id = ?", [equipoId]);
  if (!current) {
    throw new HttpError(404, "Equipo no encontrado");
  }

  const nombre = String(payload.nombre_equipo || payload.nombre || "").trim();
  if (!nombre) {
    throw new HttpError(400, "nombre_equipo es obligatorio");
  }

  const duplicate = await get("SELECT id FROM equipos WHERE nombre_equipo = ? AND id <> ?", [
    nombre,
    equipoId,
  ]);
  if (duplicate) {
    throw new HttpError(409, "Ya existe otro equipo con ese nombre");
  }

  await run("UPDATE equipos SET nombre_equipo = ? WHERE id = ?", [nombre, equipoId]);
  return get("SELECT id, nombre_equipo FROM equipos WHERE id = ?", [equipoId]);
}

async function updateEquipoStock(actor, equipoStockId, payload) {
  const role = getActorRole(actor);
  if (!["ADMIN", "SUPERVISOR", "SECRETARIA"].includes(role)) {
    throw new HttpError(403, "No tiene permisos para actualizar stock de equipos");
  }

  const stock = Number(payload.stock);
  if (!Number.isInteger(stock) || stock < 0) {
    throw new HttpError(400, "stock debe ser un entero mayor o igual a cero");
  }

  const current = await get(
    `
      SELECT
        es.*, e.nombre_equipo, i.nombre AS repuesto
      FROM equipo_stock es
      INNER JOIN equipos e ON e.id = es.equipo_id
      INNER JOIN inventario i ON i.id = es.repuesto_id
      WHERE es.id = ?
    `,
    [equipoStockId]
  );

  if (!current) {
    throw new HttpError(404, "Registro de stock no encontrado");
  }

  const delta = stock - Number(current.stock);

  await run(
    `
      UPDATE equipo_stock
      SET stock = ?, ultima_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [stock, equipoStockId]
  );

  await run(
    `
      INSERT INTO inventario_movimientos
        (inventario_id, tipo, cantidad, detalle, actor_id)
      VALUES (?, 'AJUSTE_FAENA', ?, ?, ?)
    `,
    [
      current.repuesto_id,
      delta,
      `Ajuste de stock en ${current.nombre_equipo}`,
      actor.id,
    ]
  );

  await syncStockFaenaInventario(current.repuesto_id);

  const updated = await get(
    `
      SELECT
        es.id,
        es.equipo_id,
        e.nombre_equipo,
        es.repuesto_id,
        i.codigo AS repuesto_codigo,
        i.nombre AS repuesto,
        i.unidad_medida,
        es.stock,
        es.ultima_actualizacion
      FROM equipo_stock es
      INNER JOIN equipos e ON e.id = es.equipo_id
      INNER JOIN inventario i ON i.id = es.repuesto_id
      WHERE es.id = ?
    `,
    [equipoStockId]
  );

  return {
    ...updated,
    estado_stock: mapStockState(updated.stock),
  };
}

module.exports = {
  listEquipos,
  listEquipoStock,
  getEquipoStockByEquipoId,
  createEquipo,
  updateEquipo,
  updateEquipoStock,
};
