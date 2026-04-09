const { query } = require("../database/db");

async function list({ page = 1, limit = 50, faenaId, activo }) {
  const offset = (page - 1) * limit;
  const params = [];
  const filters = [];

  if (faenaId) {
    params.push(faenaId);
    filters.push(`e.faena_id = $${params.length}`);
  }
  if (activo !== undefined) {
    params.push(activo);
    filters.push(`e.activo = $${params.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  params.push(limit);
  params.push(offset);

  const { rows } = await query(
    `
      SELECT
        e.id,
        e.codigo,
        e.nombre,
        e.faena_id,
        f.nombre AS faena_nombre,
        e.activo,
        e.created_at,
        e.updated_at
      FROM equipos e
      INNER JOIN faenas f ON f.id = e.faena_id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );
  return rows;
}

async function findById(id) {
  const { rows } = await query(
    `
      SELECT
        e.id,
        e.codigo,
        e.nombre,
        e.faena_id,
        f.nombre AS faena_nombre,
        e.activo,
        e.created_at,
        e.updated_at
      FROM equipos e
      INNER JOIN faenas f ON f.id = e.faena_id
      WHERE e.id = $1
    `,
    [id]
  );
  return rows[0] || null;
}

async function create({ codigo, nombre, faenaId }) {
  const { rows } = await query(
    `
      INSERT INTO equipos (codigo, nombre, faena_id)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
    [codigo, nombre, faenaId]
  );
  return findById(rows[0].id);
}

async function update(id, { codigo, nombre, faenaId, activo }) {
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
  if (faenaId !== undefined) {
    params.push(faenaId);
    fields.push(`faena_id = $${params.length}`);
  }
  if (activo !== undefined) {
    params.push(activo);
    fields.push(`activo = $${params.length}`);
  }
  if (fields.length === 0) {
    return findById(id);
  }

  params.push(id);
  const { rowCount } = await query(
    `
      UPDATE equipos
      SET ${fields.join(", ")}, updated_at = NOW()
      WHERE id = $${params.length}
    `,
    params
  );
  if (rowCount === 0) {
    return null;
  }
  return findById(id);
}

module.exports = {
  list,
  findById,
  create,
  update,
};

