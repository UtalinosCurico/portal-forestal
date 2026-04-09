const { query } = require("../database/db");

function buildUserSelect() {
  return `
    SELECT
      u.id,
      u.nombre,
      u.email,
      u.password_hash,
      u.role_id,
      r.name AS role_name,
      u.faena_id,
      f.nombre AS faena_nombre,
      u.activo,
      u.created_at,
      u.updated_at
    FROM users u
    INNER JOIN roles r ON r.id = u.role_id
    LEFT JOIN faenas f ON f.id = u.faena_id
  `;
}

async function findByEmail(email) {
  const sql = `${buildUserSelect()} WHERE u.email = $1`;
  const { rows } = await query(sql, [email]);
  return rows[0] || null;
}

async function findById(id) {
  const sql = `${buildUserSelect()} WHERE u.id = $1`;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
}

async function list({ page = 1, limit = 20, role, faenaId, activo }) {
  const offset = (page - 1) * limit;
  const filters = [];
  const params = [];

  if (role) {
    params.push(role);
    filters.push(`r.name = $${params.length}`);
  }
  if (faenaId) {
    params.push(faenaId);
    filters.push(`u.faena_id = $${params.length}`);
  }
  if (activo !== undefined) {
    params.push(activo);
    filters.push(`u.activo = $${params.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  params.push(limit);
  params.push(offset);

  const sql = `
    ${buildUserSelect()}
    ${where}
    ORDER BY u.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length};
  `;
  const { rows } = await query(sql, params);
  return rows;
}

async function create({ nombre, email, passwordHash, roleId, faenaId, activo = true }) {
  const sql = `
    INSERT INTO users (nombre, email, password_hash, role_id, faena_id, activo)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id;
  `;
  const { rows } = await query(sql, [nombre, email, passwordHash, roleId, faenaId, activo]);
  return findById(rows[0].id);
}

async function update(id, { nombre, email, passwordHash, roleId, faenaId, activo }) {
  const fields = [];
  const params = [];

  if (nombre !== undefined) {
    params.push(nombre);
    fields.push(`nombre = $${params.length}`);
  }
  if (email !== undefined) {
    params.push(email);
    fields.push(`email = $${params.length}`);
  }
  if (passwordHash !== undefined) {
    params.push(passwordHash);
    fields.push(`password_hash = $${params.length}`);
  }
  if (roleId !== undefined) {
    params.push(roleId);
    fields.push(`role_id = $${params.length}`);
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
  const sql = `
    UPDATE users
    SET ${fields.join(", ")}, updated_at = NOW()
    WHERE id = $${params.length}
    RETURNING id;
  `;
  const { rows } = await query(sql, params);
  return rows[0] ? findById(rows[0].id) : null;
}

async function findRoleByName(name) {
  const { rows } = await query("SELECT id, name FROM roles WHERE name = $1", [name]);
  return rows[0] || null;
}

async function listRoles() {
  const { rows } = await query("SELECT id, name, description FROM roles ORDER BY id ASC");
  return rows;
}

module.exports = {
  findByEmail,
  findById,
  list,
  create,
  update,
  findRoleByName,
  listRoles,
};

