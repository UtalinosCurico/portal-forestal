const bcrypt = require("bcryptjs");
const { run, get, all } = require("./db");
const { ROLES } = require("../config/appRoles");
const { SOLICITUD_STATUS } = require("../config/solicitudFlow");
const { SOLICITUD_ITEM_STATUS } = require("../config/solicitudItemFlow");

async function tableExists(tableName) {
  const row = await get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  );
  return Boolean(row);
}

async function getTableColumns(tableName) {
  return all(`PRAGMA table_info(${tableName})`);
}

async function getColumnInfo(tableName, columnName) {
  const columns = await getTableColumns(tableName);
  return columns.find((column) => column.name === columnName) || null;
}

async function columnExists(tableName, columnName) {
  return Boolean(await getColumnInfo(tableName, columnName));
}

async function ensureColumn(tableName, columnName, sqlDefinition) {
  if (await columnExists(tableName, columnName)) {
    return;
  }
  await run(`ALTER TABLE ${tableName} ADD COLUMN ${sqlDefinition}`);
}

async function renameColumnIfNeeded(tableName, oldName, newName) {
  const oldColumn = await getColumnInfo(tableName, oldName);
  const newColumn = await getColumnInfo(tableName, newName);

  if (!oldColumn || newColumn) {
    return;
  }

  try {
    await run(`ALTER TABLE ${tableName} RENAME COLUMN ${oldName} TO ${newName}`);
  } catch (error) {
    // Fallback para motores SQLite sin soporte de RENAME COLUMN.
    const sqlType = oldColumn.type || "TEXT";
    await ensureColumn(tableName, newName, `${newName} ${sqlType}`);
    await run(`UPDATE ${tableName} SET ${newName} = ${oldName} WHERE ${newName} IS NULL`);
  }
}

async function createTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS equipos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre_equipo TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      rol TEXT NOT NULL,
      equipo_id INTEGER,
      activo INTEGER NOT NULL DEFAULT 1,
      fecha_creacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (equipo_id) REFERENCES equipos(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS solicitudes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitante_id INTEGER NOT NULL,
      equipo TEXT,
      equipo_id INTEGER,
      repuesto TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      comentario TEXT,
      estado TEXT NOT NULL DEFAULT '${SOLICITUD_STATUS.PENDIENTE}',
      reviewed_at TEXT,
      reviewed_by INTEGER,
      dispatched_at TEXT,
      dispatched_by INTEGER,
      received_at TEXT,
      received_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT,
      FOREIGN KEY (solicitante_id) REFERENCES usuarios(id),
      FOREIGN KEY (equipo_id) REFERENCES equipos(id),
      FOREIGN KEY (reviewed_by) REFERENCES usuarios(id),
      FOREIGN KEY (dispatched_by) REFERENCES usuarios(id),
      FOREIGN KEY (received_by) REFERENCES usuarios(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS solicitud_historial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitud_id INTEGER NOT NULL,
      accion TEXT NOT NULL,
      estado_anterior TEXT,
      estado_nuevo TEXT,
      detalle TEXT,
      actor_id INTEGER NOT NULL,
      actor_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id),
      FOREIGN KEY (actor_id) REFERENCES usuarios(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS solicitud_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitud_id INTEGER NOT NULL,
      nombre_item TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      unidad_medida TEXT,
      codigo_referencia TEXT,
      usuario_final TEXT,
      comentario TEXT,
      estado_item TEXT NOT NULL DEFAULT '${SOLICITUD_ITEM_STATUS.POR_GESTIONAR}',
      comentario_gestion TEXT,
      encargado_id INTEGER,
      enviado_por_id INTEGER,
      recepcionado_por_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT,
      FOREIGN KEY (encargado_id) REFERENCES usuarios(id),
      FOREIGN KEY (enviado_por_id) REFERENCES usuarios(id),
      FOREIGN KEY (recepcionado_por_id) REFERENCES usuarios(id),
      FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS solicitud_mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      solicitud_id INTEGER NOT NULL,
      remitente_id INTEGER NOT NULL,
      destinatario_id INTEGER,
      mensaje TEXT,
      imagen_nombre TEXT,
      imagen_data TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id),
      FOREIGN KEY (remitente_id) REFERENCES usuarios(id),
      FOREIGN KEY (destinatario_id) REFERENCES usuarios(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS inventario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      stock_central INTEGER NOT NULL DEFAULT 0,
      stock_faena INTEGER NOT NULL DEFAULT 0,
      unidad_medida TEXT NOT NULL DEFAULT 'unidad',
      critical_level INTEGER NOT NULL DEFAULT 5,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS inventario_movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventario_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      detalle TEXT,
      actor_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (inventario_id) REFERENCES inventario(id),
      FOREIGN KEY (actor_id) REFERENCES usuarios(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS envios_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repuesto_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      equipo_destino_id INTEGER NOT NULL,
      solicitado_por INTEGER NOT NULL,
      autorizado_por INTEGER,
      fecha_envio TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_recepcion TEXT,
      comentario TEXT,
      estado_visual TEXT NOT NULL DEFAULT 'PREPARADO',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT,
      FOREIGN KEY (repuesto_id) REFERENCES inventario(id),
      FOREIGN KEY (equipo_destino_id) REFERENCES equipos(id),
      FOREIGN KEY (solicitado_por) REFERENCES usuarios(id),
      FOREIGN KEY (autorizado_por) REFERENCES usuarios(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS notificaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      rol_destino TEXT,
      usuario_destino_id INTEGER,
      equipo_id INTEGER,
      referencia_id INTEGER,
      leida INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at TEXT,
      FOREIGN KEY (usuario_destino_id) REFERENCES usuarios(id),
      FOREIGN KEY (equipo_id) REFERENCES equipos(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS equipo_stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipo_id INTEGER NOT NULL,
      repuesto_id INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      ultima_actualizacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (equipo_id, repuesto_id),
      FOREIGN KEY (equipo_id) REFERENCES equipos(id),
      FOREIGN KEY (repuesto_id) REFERENCES inventario(id)
    )
  `);
}

async function migrateUsuariosSchema() {
  if (!(await tableExists("usuarios"))) {
    return;
  }

  await renameColumnIfNeeded("usuarios", "name", "nombre");
  await renameColumnIfNeeded("usuarios", "role", "rol");
  await renameColumnIfNeeded("usuarios", "active", "activo");
  await renameColumnIfNeeded("usuarios", "created_at", "fecha_creacion");

  await ensureColumn("usuarios", "password_hash", "password_hash TEXT");
  await ensureColumn("usuarios", "equipo_id", "equipo_id INTEGER");
  await ensureColumn("usuarios", "activo", "activo INTEGER NOT NULL DEFAULT 1");
  await ensureColumn("usuarios", "archivado", "archivado INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("usuarios", "fecha_archivado", "fecha_archivado TEXT");
  await ensureColumn("usuarios", "archivado_por", "archivado_por INTEGER");
  await ensureColumn(
    "usuarios",
    "fecha_creacion",
    "fecha_creacion TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"
  );

  await run(`
    UPDATE usuarios
    SET
      activo = COALESCE(activo, 1),
      archivado = COALESCE(archivado, 0)
  `);

  if (await columnExists("usuarios", "password")) {
    await run(`
      UPDATE usuarios
      SET password_hash = password
      WHERE password_hash IS NULL
        AND password IS NOT NULL
    `);
  }
}

async function migrateSolicitudesSchema() {
  if (!(await tableExists("solicitudes"))) {
    return;
  }

  await ensureColumn("solicitudes", "equipo_id", "equipo_id INTEGER");
}

async function migrateEnviosStockSchema() {
  if (!(await tableExists("envios_stock"))) {
    return;
  }

  await ensureColumn(
    "envios_stock",
    "estado_visual",
    "estado_visual TEXT NOT NULL DEFAULT 'PREPARADO'"
  );
  await ensureColumn("envios_stock", "fecha_recepcion", "fecha_recepcion TEXT");
  await ensureColumn("envios_stock", "updated_at", "updated_at TEXT");
}

async function migrateSolicitudItemsSchema() {
  if (!(await tableExists("solicitud_items"))) {
    return;
  }

  await ensureColumn("solicitud_items", "comentario", "comentario TEXT");
  await ensureColumn("solicitud_items", "unidad_medida", "unidad_medida TEXT");
  await ensureColumn("solicitud_items", "codigo_referencia", "codigo_referencia TEXT");
  await ensureColumn("solicitud_items", "usuario_final", "usuario_final TEXT");
  await ensureColumn(
    "solicitud_items",
    "estado_item",
    `estado_item TEXT NOT NULL DEFAULT '${SOLICITUD_ITEM_STATUS.POR_GESTIONAR}'`
  );
  await ensureColumn("solicitud_items", "comentario_gestion", "comentario_gestion TEXT");
  await ensureColumn("solicitud_items", "encargado_id", "encargado_id INTEGER");
  await ensureColumn("solicitud_items", "enviado_por_id", "enviado_por_id INTEGER");
  await ensureColumn("solicitud_items", "recepcionado_por_id", "recepcionado_por_id INTEGER");
  await ensureColumn("solicitud_items", "updated_at", "updated_at TEXT");
  await run(
    `
      UPDATE solicitud_items
      SET estado_item = COALESCE(NULLIF(TRIM(estado_item), ''), ?)
      WHERE estado_item IS NULL
         OR TRIM(estado_item) = ''
    `,
    [SOLICITUD_ITEM_STATUS.POR_GESTIONAR]
  );
}

async function migrateSolicitudMensajesSchema() {
  if (!(await tableExists("solicitud_mensajes"))) {
    return;
  }

  await ensureColumn("solicitud_mensajes", "destinatario_id", "destinatario_id INTEGER");
  await ensureColumn("solicitud_mensajes", "mensaje", "mensaje TEXT");
  await ensureColumn("solicitud_mensajes", "imagen_nombre", "imagen_nombre TEXT");
  await ensureColumn("solicitud_mensajes", "imagen_data", "imagen_data TEXT");
}

async function migrateLegacyRoles() {
  if (!(await tableExists("usuarios"))) {
    return;
  }

  await run(
    `
      UPDATE usuarios
      SET rol = ?
      WHERE rol = 'SECRETARIA'
    `,
    [ROLES.SUPERVISOR]
  );
}

async function seedEquipos() {
  for (const nombreEquipo of ["Maule Norte 2", "Maule Norte 3", "Forest Saint", "Base"]) {
    const exists = await get("SELECT id FROM equipos WHERE nombre_equipo = ?", [nombreEquipo]);
    if (!exists) {
      await run("INSERT INTO equipos (nombre_equipo) VALUES (?)", [nombreEquipo]);
    }
  }
}

async function getEquipoIdByName(nombreEquipo) {
  const row = await get("SELECT id FROM equipos WHERE nombre_equipo = ?", [nombreEquipo]);
  return row ? row.id : null;
}

async function seedUsers() {
  const equipoMaule2Id = await getEquipoIdByName("Maule Norte 2");
  const equipoMaule3Id = await getEquipoIdByName("Maule Norte 3");
  const hasLegacyPasswordColumn = await columnExists("usuarios", "password");

  const seeds = [
    {
      nombre: "Administrador FMN",
      email: "admin@forestal.cl",
      password: "Admin123!",
      rol: ROLES.ADMIN,
      equipoId: null,
    },
    {
      nombre: "Supervisor FMN",
      email: "supervisor@forestal.cl",
      password: "Supervisor123!",
      rol: ROLES.SUPERVISOR,
      equipoId: null,
    },
    {
      nombre: "Jefe Faena FMN",
      email: "jefe@forestal.cl",
      password: "Jefe123!",
      rol: ROLES.JEFE_FAENA,
      equipoId: equipoMaule2Id,
    },
    {
      nombre: "Supervisor Apoyo FMN",
      email: "secretaria@forestal.cl",
      password: "Secretaria123!",
      rol: ROLES.SUPERVISOR,
      equipoId: null,
    },
    {
      nombre: "Operador FMN",
      email: "operador@forestal.cl",
      password: "Operador123!",
      rol: ROLES.OPERADOR,
      equipoId: equipoMaule3Id,
    },
  ];

  for (const seed of seeds) {
    const existing = await get("SELECT id, password_hash FROM usuarios WHERE email = ?", [seed.email]);
    const passwordHash = await bcrypt.hash(seed.password, 10);

    if (!existing) {
      if (hasLegacyPasswordColumn) {
        await run(
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
          VALUES (?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP)
        `,
        [seed.nombre, seed.email, passwordHash, passwordHash, seed.rol, seed.equipoId]
      );
      } else {
        await run(
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
            VALUES (?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP)
        `,
        [seed.nombre, seed.email, passwordHash, seed.rol, seed.equipoId]
      );
      }
      continue;
    }

    if (hasLegacyPasswordColumn) {
      await run(
        `
          UPDATE usuarios
          SET
            nombre = ?,
            rol = ?,
            equipo_id = ?,
            activo = COALESCE(activo, 1),
            archivado = COALESCE(archivado, 0),
            password_hash = COALESCE(password_hash, ?),
            password = COALESCE(password, ?)
          WHERE email = ?
        `,
        [seed.nombre, seed.rol, seed.equipoId, passwordHash, passwordHash, seed.email]
      );
    } else {
      await run(
        `
          UPDATE usuarios
          SET
            nombre = ?,
            rol = ?,
            equipo_id = ?,
            activo = COALESCE(activo, 1),
            archivado = COALESCE(archivado, 0),
            password_hash = COALESCE(password_hash, ?)
          WHERE email = ?
        `,
        [seed.nombre, seed.rol, seed.equipoId, passwordHash, seed.email]
      );
    }
  }

  await run(
    `
      UPDATE usuarios
      SET equipo_id = ?
      WHERE rol = ?
        AND equipo_id IS NULL
    `,
    [equipoMaule2Id, ROLES.JEFE_FAENA]
  );

  await run(
    `
      UPDATE usuarios
      SET equipo_id = ?
      WHERE rol = ?
        AND equipo_id IS NULL
    `,
    [equipoMaule3Id, ROLES.OPERADOR]
  );
}

async function seedInventarioBase() {
  const exists = await get("SELECT id FROM inventario LIMIT 1");
  if (exists) {
    return;
  }

  await run(`
    INSERT INTO inventario (codigo, nombre, stock_central, stock_faena, unidad_medida, critical_level, updated_at)
    VALUES
      ('REP-001', 'Filtro hidraulico', 15, 2, 'unidad', 5, CURRENT_TIMESTAMP),
      ('REP-002', 'Aceite 15W40', 6, 1, 'litro', 8, CURRENT_TIMESTAMP),
      ('REP-003', 'Correa transmision', 4, 0, 'unidad', 4, CURRENT_TIMESTAMP)
  `);
}

async function seedEquipoStock() {
  const equipos = await all("SELECT id FROM equipos ORDER BY id ASC");
  const repuestos = await all("SELECT id, stock_faena FROM inventario ORDER BY id ASC");

  for (const equipo of equipos) {
    for (const repuesto of repuestos) {
      const exists = await get(
        "SELECT id FROM equipo_stock WHERE equipo_id = ? AND repuesto_id = ?",
        [equipo.id, repuesto.id]
      );
      if (exists) {
        continue;
      }

      const stockInicial = equipo.id === equipos[0].id ? Number(repuesto.stock_faena || 0) : 0;
      await run(
        `
          INSERT INTO equipo_stock (equipo_id, repuesto_id, stock, ultima_actualizacion)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `,
        [equipo.id, repuesto.id, stockInicial]
      );
    }
  }
}

async function backfillSolicitudesEquipoFromUsers() {
  await run(`
    UPDATE solicitudes
    SET equipo_id = (
      SELECT u.equipo_id
      FROM usuarios u
      WHERE u.id = solicitudes.solicitante_id
    )
    WHERE equipo_id IS NULL
  `);
}

async function backfillSolicitudItems() {
  const solicitudes = await all(`
    SELECT id, repuesto, cantidad, comentario
    FROM solicitudes
    ORDER BY id ASC
  `);

  for (const solicitud of solicitudes) {
    const existing = await get(
      "SELECT id FROM solicitud_items WHERE solicitud_id = ? LIMIT 1",
      [solicitud.id]
    );

    if (existing) {
      continue;
    }

    await run(
      `
        INSERT INTO solicitud_items (solicitud_id, nombre_item, cantidad, comentario)
        VALUES (?, ?, ?, ?)
      `,
      [
        solicitud.id,
        solicitud.repuesto || "Item sin nombre",
        Number(solicitud.cantidad || 1),
        solicitud.comentario || null,
      ]
    );
  }
}

async function initDatabase() {
  await createTables();
  await migrateUsuariosSchema();
  await migrateSolicitudesSchema();
  await migrateEnviosStockSchema();
  await migrateSolicitudItemsSchema();
  await migrateSolicitudMensajesSchema();
  await migrateLegacyRoles();
  await seedEquipos();
  await seedUsers();
  await backfillSolicitudesEquipoFromUsers();
  await backfillSolicitudItems();
  await seedInventarioBase();
  await seedEquipoStock();
}

module.exports = {
  initDatabase,
};

