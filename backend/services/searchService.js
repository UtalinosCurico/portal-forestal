const { all } = require("../db/database");
const { isGlobalRole, requireTeamAssigned } = require("../middleware/roles");
const { HttpError } = require("../utils/httpError");
const { isOperationalPgEnabled, getOperationalPool, loadEquiposMap } = require("./operationalPgStore");

function getActorRole(actor) {
  return actor.rol || actor.role;
}

function normalizeQuery(value) {
  const query = String(value || "").trim();
  if (query.length < 2) {
    throw new HttpError(400, "La busqueda debe tener al menos 2 caracteres");
  }
  return query.slice(0, 80);
}

function normalizeLimit(value) {
  const limit = Number(value || 6);
  if (!Number.isInteger(limit) || limit <= 0) {
    return 6;
  }
  return Math.min(limit, 12);
}

async function pgTableExists(pg, tableName) {
  const { rows } = await pg.query("SELECT to_regclass($1) AS table_name", [tableName]);
  return Boolean(rows[0]?.table_name);
}

async function searchSqlite(actor, filters = {}) {
  const q = normalizeQuery(filters.q || filters.texto || filters.search);
  const limit = normalizeLimit(filters.limit);
  const role = getActorRole(actor);
  const like = `%${q.toLowerCase()}%`;
  const idLike = `%${q.replaceAll("%", "")}%`;
  const solicitudParams = [like, like, like, idLike, like, like, like, like];
  let solicitudScope = "";

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    solicitudScope = "AND s.equipo_id = ?";
    solicitudParams.push(actor.equipo_id);
  }
  solicitudParams.push(limit);

  const solicitudes = await all(
    `
      SELECT
        s.id,
        s.estado,
        COALESCE(e.nombre_equipo, s.equipo, 'Sin equipo') AS equipo,
        COALESCE(s.repuesto, 'Solicitud') AS titulo,
        su.nombre AS solicitante,
        s.created_at
      FROM solicitudes s
      INNER JOIN usuarios su ON su.id = s.solicitante_id
      LEFT JOIN equipos e ON e.id = s.equipo_id
      WHERE (
        LOWER(COALESCE(s.repuesto, '')) LIKE ?
        OR LOWER(COALESCE(s.comentario, '')) LIKE ?
        OR LOWER(COALESCE(e.nombre_equipo, s.equipo, '')) LIKE ?
        OR CAST(s.id AS TEXT) LIKE ?
        OR LOWER(COALESCE(su.nombre, '')) LIKE ?
        OR EXISTS (
          SELECT 1
          FROM solicitud_items si
          WHERE si.solicitud_id = s.id
            AND (
              LOWER(COALESCE(si.nombre_item, '')) LIKE ?
              OR LOWER(COALESCE(si.codigo_referencia, '')) LIKE ?
              OR LOWER(COALESCE(si.comentario, '')) LIKE ?
            )
        )
      )
      ${solicitudScope}
      ORDER BY s.id DESC
      LIMIT ?
    `,
    solicitudParams
  );

  const inventario = await all(
    `
      SELECT id, codigo, nombre, stock_central, stock_faena, unidad_medida
      FROM inventario
      WHERE LOWER(COALESCE(codigo, '')) LIKE ?
         OR LOWER(COALESCE(nombre, '')) LIKE ?
      ORDER BY nombre ASC
      LIMIT ?
    `,
    [like, like, limit]
  );

  const usuarios = isGlobalRole(role)
    ? await all(
        `
          SELECT u.id, u.nombre, u.email, u.rol, e.nombre_equipo
          FROM usuarios u
          LEFT JOIN equipos e ON e.id = u.equipo_id
          WHERE COALESCE(u.archivado, 0) = 0
            AND (
              LOWER(COALESCE(u.nombre, '')) LIKE ?
              OR LOWER(COALESCE(u.email, '')) LIKE ?
              OR LOWER(COALESCE(u.rol, '')) LIKE ?
              OR LOWER(COALESCE(e.nombre_equipo, '')) LIKE ?
            )
          ORDER BY u.nombre ASC
          LIMIT ?
        `,
        [like, like, like, like, limit]
      )
    : [];

  return {
    query: q,
    solicitudes: solicitudes.map((row) => ({
      tipo: "solicitud",
      id: Number(row.id),
      titulo: `Solicitud #${row.id}`,
      descripcion: `${row.titulo || "Solicitud"} | ${row.equipo || "Sin equipo"} | ${row.estado}`,
      meta: row.solicitante || null,
    })),
    inventario: inventario.map((row) => ({
      tipo: "inventario",
      id: Number(row.id),
      titulo: row.nombre || row.codigo || "Repuesto",
      descripcion: `${row.codigo || "Sin codigo"} | Central: ${row.stock_central ?? 0} | Faena: ${row.stock_faena ?? 0}`,
      meta: row.unidad_medida || null,
    })),
    usuarios: usuarios.map((row) => ({
      tipo: "usuario",
      id: Number(row.id),
      titulo: row.nombre || row.email || "Usuario",
      descripcion: `${row.rol || "-"} | ${row.nombre_equipo || "Global"}`,
      meta: row.email || null,
    })),
  };
}

async function searchPg(actor, filters = {}) {
  const q = normalizeQuery(filters.q || filters.texto || filters.search);
  const limit = normalizeLimit(filters.limit);
  const role = getActorRole(actor);
  const like = `%${q.toLowerCase()}%`;
  const idLike = `%${q.replaceAll("%", "")}%`;
  const pg = getOperationalPool();
  const equiposMap = await loadEquiposMap();
  const solicitudParams = [like, like, like, idLike, like, like, like, like];
  let solicitudScope = "";

  if (!isGlobalRole(role)) {
    requireTeamAssigned(actor);
    solicitudParams.push(Number(actor.equipo_id));
    solicitudScope = `AND s.equipo_id = $${solicitudParams.length}`;
  }
  solicitudParams.push(limit);

  const { rows: solicitudesRows } = await pg.query(
    `
      SELECT
        s.id,
        s.estado,
        s.equipo,
        s.equipo_id,
        COALESCE(s.repuesto, 'Solicitud') AS titulo,
        su.nombre AS solicitante,
        s.created_at
      FROM solicitudes s
      INNER JOIN usuarios_auth su ON su.id = s.solicitante_id
      WHERE (
        LOWER(COALESCE(s.repuesto, '')) LIKE $1
        OR LOWER(COALESCE(s.comentario, '')) LIKE $2
        OR LOWER(COALESCE(s.equipo, '')) LIKE $3
        OR s.id::text LIKE $4
        OR LOWER(COALESCE(su.nombre, '')) LIKE $5
        OR EXISTS (
          SELECT 1
          FROM solicitud_items si
          WHERE si.solicitud_id = s.id
            AND (
              LOWER(COALESCE(si.nombre_item, '')) LIKE $6
              OR LOWER(COALESCE(si.codigo_referencia, '')) LIKE $7
              OR LOWER(COALESCE(si.comentario, '')) LIKE $8
            )
        )
      )
      ${solicitudScope}
      ORDER BY s.id DESC
      LIMIT $${solicitudParams.length}
    `,
    solicitudParams
  );

  let inventarioRows = [];
  if (await pgTableExists(pg, "inventario")) {
    const result = await pg.query(
      `
        SELECT id, codigo, nombre, stock_central, stock_faena, unidad_medida
        FROM inventario
        WHERE LOWER(COALESCE(codigo, '')) LIKE $1
           OR LOWER(COALESCE(nombre, '')) LIKE $2
        ORDER BY nombre ASC
        LIMIT $3
      `,
      [like, like, limit]
    );
    inventarioRows = result.rows;
  }

  let usuariosRows = [];
  if (isGlobalRole(role)) {
    const result = await pg.query(
      `
        SELECT u.id, u.nombre, u.email, u.rol, u.equipo_id
        FROM usuarios_auth u
        WHERE COALESCE(u.archivado, FALSE) = FALSE
          AND (
            LOWER(COALESCE(u.nombre, '')) LIKE $1
            OR LOWER(COALESCE(u.email, '')) LIKE $2
            OR LOWER(COALESCE(u.rol, '')) LIKE $3
          )
        ORDER BY u.nombre ASC
        LIMIT $4
      `,
      [like, like, like, limit]
    );
    usuariosRows = result.rows;
  }

  return {
    query: q,
    solicitudes: solicitudesRows.map((row) => {
      const equipo = row.equipo_id ? equiposMap.get(Number(row.equipo_id)) || row.equipo || "Sin equipo" : "Sin equipo";
      return {
        tipo: "solicitud",
        id: Number(row.id),
        titulo: `Solicitud #${row.id}`,
        descripcion: `${row.titulo || "Solicitud"} | ${equipo} | ${row.estado}`,
        meta: row.solicitante || null,
      };
    }),
    inventario: inventarioRows.map((row) => ({
      tipo: "inventario",
      id: Number(row.id),
      titulo: row.nombre || row.codigo || "Repuesto",
      descripcion: `${row.codigo || "Sin codigo"} | Central: ${row.stock_central ?? 0} | Faena: ${row.stock_faena ?? 0}`,
      meta: row.unidad_medida || null,
    })),
    usuarios: usuariosRows.map((row) => ({
      tipo: "usuario",
      id: Number(row.id),
      titulo: row.nombre || row.email || "Usuario",
      descripcion: `${row.rol || "-"} | ${
        row.equipo_id ? equiposMap.get(Number(row.equipo_id)) || "Sin equipo" : "Global"
      }`,
      meta: row.email || null,
    })),
  };
}

async function searchAll(actor, filters = {}) {
  return isOperationalPgEnabled() ? searchPg(actor, filters) : searchSqlite(actor, filters);
}

module.exports = {
  searchAll,
};
