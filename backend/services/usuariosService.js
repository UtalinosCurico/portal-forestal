const bcrypt = require("bcryptjs");
const { all, get, run } = require("../db/database");
const { ROLES, ROLE_LIST, normalizeRole } = require("../config/appRoles");
const { HttpError } = require("../utils/httpError");
const { normalizeEmail, normalizeText, validateEmail } = require("../utils/validators");
const { getOperationalPool, isOperationalPgEnabled } = require("./operationalPgStore");
const {
  getUserStoreState,
  findUserById,
  listUsers,
  countOtherActiveAdmins,
  emailExists,
  createUserRecord,
  updateUserRecord,
} = require("./userStore");

let legacyPasswordColumnExists = null;

const USER_SELECT = `
  SELECT
    u.id,
    u.nombre,
    u.email,
    u.rol,
    u.equipo_id,
    e.nombre_equipo AS equipo_nombre,
    u.activo,
    u.archivado,
    u.fecha_archivado,
    u.archivado_por,
    u.fecha_creacion
  FROM usuarios u
  LEFT JOIN equipos e ON e.id = u.equipo_id
`;

function normalizeBoolean(value) {
  return value === true || value === 1 || value === "1";
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  const rol = normalizeRole(user.rol);
  const activo = normalizeBoolean(user.activo);
  const archivado = normalizeBoolean(user.archivado);

  return {
    id: Number(user.id),
    nombre: normalizeText(user.nombre),
    name: normalizeText(user.nombre),
    email: normalizeEmail(user.email),
    rol,
    role: rol,
    equipo_id: user.equipo_id === null || user.equipo_id === undefined ? null : Number(user.equipo_id),
    equipo_nombre: user.equipo_nombre || null,
    activo,
    active: activo,
    archivado,
    fecha_archivado: user.fecha_archivado || null,
    archivado_por:
      user.archivado_por === null || user.archivado_por === undefined ? null : Number(user.archivado_por),
    fecha_creacion: user.fecha_creacion || user.created_at || null,
    created_at: user.fecha_creacion || user.created_at || null,
  };
}

function isPersistentUserStore() {
  return Boolean(getUserStoreState().persistent);
}

function getActorRole(actor) {
  return normalizeRole(actor?.rol || actor?.role || "");
}

function isRoleGlobal(rol) {
  return [ROLES.ADMIN, ROLES.SUPERVISOR].includes(normalizeRole(rol));
}

function roleNeedsEquipo(rol) {
  return [ROLES.JEFE_FAENA, ROLES.MECANICO, ROLES.OPERADOR].includes(normalizeRole(rol));
}

function validateRole(rol) {
  const normalizedRole = normalizeRole(rol);
  if (!ROLE_LIST.includes(normalizedRole)) {
    throw new HttpError(400, "Rol invalido");
  }
  return normalizedRole;
}

function normalizeEstadoFilter(value) {
  const normalized = String(value || "activos").trim().toLowerCase();
  const allowed = ["activos", "inactivos", "archivados", "todos"];
  if (!allowed.includes(normalized)) {
    throw new HttpError(400, "Filtro de estado invalido");
  }
  return normalized;
}

function normalizeOptionalRoleFilter(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "";
  }

  return validateRole(value);
}

function parseEquipoId(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || String(value).trim() === "") {
    return null;
  }

  const equipoId = Number(value);
  if (!Number.isInteger(equipoId) || equipoId <= 0) {
    throw new HttpError(400, "equipo_id invalido");
  }

  return equipoId;
}

async function ensureEquipoExists(equipoId) {
  if (!equipoId) {
    return null;
  }

  const equipo = await get("SELECT id FROM equipos WHERE id = ?", [equipoId]);
  if (!equipo) {
    throw new HttpError(400, "equipo_id no existe");
  }

  return Number(equipo.id);
}

async function getEquipoNombre(equipoId) {
  if (!equipoId) {
    return null;
  }

  const equipo = await get("SELECT nombre_equipo FROM equipos WHERE id = ?", [equipoId]);
  return equipo?.nombre_equipo || null;
}

async function hasLegacyPasswordColumn() {
  if (legacyPasswordColumnExists !== null) {
    return legacyPasswordColumnExists;
  }

  const columns = await all("PRAGMA table_info(usuarios)");
  legacyPasswordColumnExists = columns.some((column) => column.name === "password");
  return legacyPasswordColumnExists;
}

async function getUsuarioRowByIdSqlite(usuarioId) {
  const numericId = Number(usuarioId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new HttpError(400, "ID de usuario invalido");
  }

  const row = await get(`${USER_SELECT} WHERE u.id = ?`, [numericId]);
  if (!row) {
    throw new HttpError(404, "Usuario no encontrado");
  }

  return row;
}

async function fetchUsuarioById(usuarioId) {
  const numericId = Number(usuarioId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new HttpError(400, "ID de usuario invalido");
  }

  const user = await findUserById(numericId);
  if (!user) {
    throw new HttpError(404, "Usuario no encontrado");
  }

  return sanitizeUser(user);
}

async function syncSolicitudesTeamInSqlite(usuarioId, equipoId) {
  const numericUserId = Number(usuarioId);
  const normalizedEquipoId =
    equipoId === null || equipoId === undefined ? null : Number(equipoId);
  const equipoNombre = await getEquipoNombre(normalizedEquipoId);

  await run(
    `
      UPDATE solicitudes
      SET
        equipo_id = ?,
        equipo = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE solicitante_id = ?
    `,
    [normalizedEquipoId, equipoNombre, numericUserId]
  );

  await run(
    `
      UPDATE notificaciones
      SET equipo_id = ?
      WHERE tipo LIKE 'SOLICITUD_%'
        AND referencia_id IN (
          SELECT id
          FROM solicitudes
          WHERE solicitante_id = ?
        )
    `,
    [normalizedEquipoId, numericUserId]
  );
}

async function syncSolicitudesTeamInPostgres(usuarioId, equipoId) {
  if (!isOperationalPgEnabled()) {
    return;
  }

  const pg = getOperationalPool();
  if (!pg) {
    return;
  }

  const numericUserId = Number(usuarioId);
  const normalizedEquipoId =
    equipoId === null || equipoId === undefined ? null : Number(equipoId);
  const equipoNombre = await getEquipoNombre(normalizedEquipoId);

  await pg.query(
    `
      UPDATE solicitudes
      SET
        equipo_id = $1,
        equipo = $2,
        updated_at = NOW()
      WHERE solicitante_id = $3
    `,
    [normalizedEquipoId, equipoNombre, numericUserId]
  );

  await pg.query(
    `
      UPDATE notificaciones
      SET equipo_id = $1
      WHERE tipo LIKE 'SOLICITUD_%'
        AND referencia_id IN (
          SELECT id
          FROM solicitudes
          WHERE solicitante_id = $2
        )
    `,
    [normalizedEquipoId, numericUserId]
  );
}

async function propagateUsuarioTeamToSolicitudes(usuarioId, equipoId) {
  await syncSolicitudesTeamInSqlite(usuarioId, equipoId);
  await syncSolicitudesTeamInPostgres(usuarioId, equipoId);
}

async function ensureActiveAdminRemains(currentUser, nextRole, nextActive, nextArchivado) {
  if (normalizeRole(currentUser.rol) !== ROLES.ADMIN) {
    return;
  }

  const currentlyCounts = normalizeBoolean(currentUser.activo) && !normalizeBoolean(currentUser.archivado);
  const willCount = normalizeRole(nextRole) === ROLES.ADMIN && normalizeBoolean(nextActive) && !normalizeBoolean(nextArchivado);

  if (!currentlyCounts || willCount) {
    return;
  }

  const otherAdmins = await countOtherActiveAdmins(currentUser.id);
  if (otherAdmins < 1) {
    throw new HttpError(400, "No se puede dejar al sistema sin administradores activos");
  }
}

function assertAdmin(actor) {
  if (getActorRole(actor) !== ROLES.ADMIN) {
    throw new HttpError(403, "No tiene permisos para esta accion");
  }
}

function assertPrivilegedUserManager(actor) {
  const actorRole = getActorRole(actor);
  if (![ROLES.ADMIN, ROLES.SUPERVISOR].includes(actorRole)) {
    throw new HttpError(403, "No tiene permisos para esta accion");
  }
}

function assertSupervisorCanEdit(actor, currentUser, payload) {
  if (getActorRole(actor) !== ROLES.SUPERVISOR) {
    return;
  }

  if (normalizeRole(currentUser.rol) === ROLES.ADMIN) {
    throw new HttpError(403, "Supervisor no puede modificar cuentas ADMIN");
  }

  const requestedRole =
    payload.rol !== undefined || payload.role !== undefined
      ? validateRole(payload.rol || payload.role || "")
      : null;
  if (requestedRole === ROLES.ADMIN) {
    throw new HttpError(403, "Supervisor no puede asignar el rol ADMIN");
  }

  const forbiddenKeys = ["archivado", "fecha_archivado", "archivado_por"];
  const includesForbiddenChange = forbiddenKeys.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (includesForbiddenChange) {
    throw new HttpError(403, "Supervisor no puede archivar usuarios desde este formulario");
  }
}

async function listUsuarios(filters = {}) {
  const normalizedFilters = {
    estado: normalizeEstadoFilter(filters.estado),
    rol: normalizeOptionalRoleFilter(filters.rol),
    q: normalizeText(filters.q || filters.search || ""),
  };

  const rows = await listUsers(normalizedFilters);
  return rows.map(sanitizeUser);
}

async function createUsuario(payload, actor) {
  assertPrivilegedUserManager(actor);

  const nombre = normalizeText(payload.nombre || payload.name || "");
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const rol = validateRole(payload.rol || payload.role || "");
  const activo = payload.activo === undefined ? true : Boolean(payload.activo);
  const actorRole = getActorRole(actor);

  if (!nombre || !email || !password || !rol) {
    throw new HttpError(400, "nombre, email, password y rol son obligatorios");
  }

  if (!validateEmail(email)) {
    throw new HttpError(400, "email invalido");
  }

  if (actorRole === ROLES.SUPERVISOR && rol === ROLES.ADMIN) {
    throw new HttpError(403, "Supervisor no puede crear cuentas ADMIN");
  }

  const requestedEquipoId = parseEquipoId(payload.equipo_id);
  let resolvedEquipoId = null;

  if (roleNeedsEquipo(rol)) {
    if (!requestedEquipoId) {
      throw new HttpError(400, "equipo_id es obligatorio para JEFE_FAENA, MECANICO y OPERADOR");
    }
    resolvedEquipoId = await ensureEquipoExists(requestedEquipoId);
  } else {
    resolvedEquipoId = null;
  }

  if (await emailExists(email)) {
    throw new HttpError(409, "Ya existe un usuario con ese email");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  if (isPersistentUserStore()) {
    const createdUser = await createUserRecord({
      nombre,
      email,
      password_hash: passwordHash,
      rol,
      equipo_id: resolvedEquipoId,
      activo,
    });
    return sanitizeUser(createdUser);
  }

  const includeLegacyPassword = await hasLegacyPasswordColumn();
  const result = includeLegacyPassword
    ? await run(
        `
          INSERT INTO usuarios (
            nombre,
            email,
            password_hash,
            password,
            rol,
            equipo_id,
            activo,
            archivado,
            fecha_creacion
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `,
        [nombre, email, passwordHash, passwordHash, rol, resolvedEquipoId, activo ? 1 : 0]
      )
    : await run(
        `
          INSERT INTO usuarios (
            nombre,
            email,
            password_hash,
            rol,
            equipo_id,
            activo,
            archivado,
            fecha_creacion
          )
          VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        `,
        [nombre, email, passwordHash, rol, resolvedEquipoId, activo ? 1 : 0]
      );

  const createdRow = await getUsuarioRowByIdSqlite(result.lastID);
  return sanitizeUser(createdRow);
}

async function updateUsuario(actor, usuarioId, payload) {
  const actorRole = getActorRole(actor);
  if (![ROLES.ADMIN, ROLES.SUPERVISOR].includes(actorRole)) {
    throw new HttpError(403, "No tiene permisos para esta accion");
  }

  const current = await fetchUsuarioById(usuarioId);
  if (current.archivado) {
    throw new HttpError(400, "El usuario archivado no se puede modificar");
  }

  assertSupervisorCanEdit(actor, current, payload);

  const requestedRoleChange =
    payload.rol !== undefined || payload.role !== undefined
      ? validateRole(payload.rol || payload.role || "")
      : null;

  const nextValues = {
    nombre: normalizeText(payload.nombre ?? payload.name ?? current.nombre),
    email: normalizeEmail(payload.email ?? current.email),
    rol:
      actorRole === ROLES.ADMIN && requestedRoleChange
        ? requestedRoleChange
        : actorRole === ROLES.SUPERVISOR && requestedRoleChange
        ? requestedRoleChange
        : normalizeRole(current.rol),
    activo:
      payload.activo !== undefined || payload.active !== undefined
        ? Boolean(payload.activo ?? payload.active)
        : Boolean(current.activo),
    archivado: Boolean(current.archivado),
  };

  if (!nextValues.nombre) {
    throw new HttpError(400, "nombre no puede estar vacio");
  }

  if (!nextValues.email) {
    throw new HttpError(400, "email no puede estar vacio");
  }

  if (!validateEmail(nextValues.email)) {
    throw new HttpError(400, "email invalido");
  }

  if (await emailExists(nextValues.email, Number(usuarioId))) {
    throw new HttpError(409, "Ya existe otro usuario con ese email");
  }

  const requestedEquipoId =
    payload.equipo_id !== undefined
      ? parseEquipoId(payload.equipo_id)
      : current.equipo_id === null || current.equipo_id === undefined
      ? null
      : Number(current.equipo_id);

  if (roleNeedsEquipo(nextValues.rol)) {
    if (!requestedEquipoId) {
      throw new HttpError(400, "equipo_id es obligatorio para JEFE_FAENA, MECANICO y OPERADOR");
    }
    nextValues.equipo_id = await ensureEquipoExists(requestedEquipoId);
  } else {
    nextValues.equipo_id = null;
  }

  await ensureActiveAdminRemains(current, nextValues.rol, nextValues.activo, nextValues.archivado);

  const password =
    [ROLES.ADMIN, ROLES.SUPERVISOR].includes(actorRole) &&
    Object.prototype.hasOwnProperty.call(payload, "password")
      ? String(payload.password || "")
      : "";

  if (Object.prototype.hasOwnProperty.call(payload, "password") && !password) {
    throw new HttpError(400, "password no puede estar vacio");
  }

  if (isPersistentUserStore()) {
    const changes = {};

    if (nextValues.nombre !== current.nombre) {
      changes.nombre = nextValues.nombre;
    }

    if (nextValues.email !== current.email) {
      changes.email = nextValues.email;
    }

    if (nextValues.rol !== current.rol) {
      changes.rol = nextValues.rol;
    }

    if ((nextValues.equipo_id ?? null) !== (current.equipo_id ?? null)) {
      changes.equipo_id = nextValues.equipo_id;
    }

    if (Boolean(nextValues.activo) !== Boolean(current.activo)) {
      changes.activo = Boolean(nextValues.activo);
    }

    if (password) {
      changes.password_hash = await bcrypt.hash(password, 10);
    }

    if (!Object.keys(changes).length) {
      throw new HttpError(400, "No se enviaron cambios para actualizar");
    }

    const updatedUser = await updateUserRecord(usuarioId, changes);
    if (Object.prototype.hasOwnProperty.call(changes, "equipo_id")) {
      await propagateUsuarioTeamToSolicitudes(usuarioId, changes.equipo_id);
    }
    return sanitizeUser(updatedUser);
  }

  const currentSqlite = await getUsuarioRowByIdSqlite(usuarioId);
  const updates = [];
  const params = [];

  if (nextValues.nombre !== currentSqlite.nombre) {
    updates.push("nombre = ?");
    params.push(nextValues.nombre);
  }

  if (nextValues.email !== normalizeEmail(currentSqlite.email)) {
    updates.push("email = ?");
    params.push(nextValues.email);
  }

  if (nextValues.rol !== normalizeRole(currentSqlite.rol)) {
    updates.push("rol = ?");
    params.push(nextValues.rol);
  }

  const currentEquipoId = currentSqlite.equipo_id ? Number(currentSqlite.equipo_id) : null;
  if ((nextValues.equipo_id ?? null) !== currentEquipoId) {
    updates.push("equipo_id = ?");
    params.push(nextValues.equipo_id);
  }

  if (Boolean(nextValues.activo) !== normalizeBoolean(currentSqlite.activo)) {
    updates.push("activo = ?");
    params.push(nextValues.activo ? 1 : 0);
  }

  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    updates.push("password_hash = ?");
    params.push(passwordHash);

    if (await hasLegacyPasswordColumn()) {
      updates.push("password = ?");
      params.push(passwordHash);
    }
  }

  if (!updates.length) {
    throw new HttpError(400, "No se enviaron cambios para actualizar");
  }

  params.push(Number(usuarioId));
  await run(
    `
      UPDATE usuarios
      SET ${updates.join(", ")}
      WHERE id = ?
    `,
    params
  );

  if ((nextValues.equipo_id ?? null) !== currentEquipoId) {
    await propagateUsuarioTeamToSolicitudes(usuarioId, nextValues.equipo_id);
  }

  return fetchUsuarioById(usuarioId);
}

async function resetUsuarioPassword(actor, usuarioId, password) {
  const actorRole = getActorRole(actor);
  if (![ROLES.ADMIN, ROLES.SUPERVISOR].includes(actorRole)) {
    throw new HttpError(403, "No tiene permisos para esta accion");
  }

  const current = await fetchUsuarioById(usuarioId);
  if (current.archivado) {
    throw new HttpError(400, "No se puede restablecer la contrasena de un usuario archivado");
  }

  if (actorRole === ROLES.SUPERVISOR && normalizeRole(current.rol) === ROLES.ADMIN) {
    throw new HttpError(403, "Supervisor no puede restablecer contrasenas de ADMIN");
  }

  const normalizedPassword = String(password || "");
  if (!normalizedPassword.trim()) {
    throw new HttpError(400, "Debe indicar una nueva contrasena");
  }

  const passwordHash = await bcrypt.hash(normalizedPassword, 10);

  if (isPersistentUserStore()) {
    await updateUserRecord(usuarioId, { password_hash: passwordHash });
    return fetchUsuarioById(usuarioId);
  }

  const updates = ["password_hash = ?"];
  const params = [passwordHash];

  if (await hasLegacyPasswordColumn()) {
    updates.push("password = ?");
    params.push(passwordHash);
  }

  params.push(Number(usuarioId));
  await run(
    `
      UPDATE usuarios
      SET ${updates.join(", ")}
      WHERE id = ?
    `,
    params
  );

  return fetchUsuarioById(usuarioId);
}

async function archiveUsuario(actor, usuarioId) {
  assertPrivilegedUserManager(actor);

  const current = await fetchUsuarioById(usuarioId);
  if (current.archivado) {
    throw new HttpError(400, "El usuario ya esta archivado");
  }

  if (Number(current.id) === Number(actor.id)) {
    throw new HttpError(400, "No puede archivar su propia cuenta");
  }

  if (getActorRole(actor) === ROLES.SUPERVISOR && normalizeRole(current.rol) === ROLES.ADMIN) {
    throw new HttpError(403, "Supervisor no puede archivar cuentas ADMIN");
  }

  await ensureActiveAdminRemains(current, current.rol, false, true);

  if (isPersistentUserStore()) {
    await updateUserRecord(usuarioId, {
      archivado: true,
      activo: false,
      fecha_archivado: new Date().toISOString(),
      archivado_por: Number(actor.id),
    });
    return fetchUsuarioById(usuarioId);
  }

  await run(
    `
      UPDATE usuarios
      SET
        archivado = 1,
        activo = 0,
        fecha_archivado = CURRENT_TIMESTAMP,
        archivado_por = ?
      WHERE id = ?
    `,
    [Number(actor.id), Number(usuarioId)]
  );

  return fetchUsuarioById(usuarioId);
}

module.exports = {
  listUsuarios,
  createUsuario,
  updateUsuario,
  archiveUsuario,
  resetUsuarioPassword,
};
