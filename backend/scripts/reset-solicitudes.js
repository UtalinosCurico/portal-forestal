const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const sqlite3 = require("sqlite3").verbose();

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const result = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value.replace(/\\r\\n/g, "").trim();
  }

  return result;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function timestampKey() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function openSqlite(dbPath) {
  return new sqlite3.Database(dbPath);
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

function sqliteExec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sqliteClose(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function backupSqliteData(db, backupDir) {
  const tables = [
    "solicitudes",
    "solicitud_items",
    "solicitud_historial",
    "solicitud_mensajes",
  ];

  const snapshot = {};
  for (const table of tables) {
    snapshot[table] = await sqliteAll(db, `SELECT * FROM ${table} ORDER BY id ASC`);
  }
  snapshot.notificaciones = await sqliteAll(
    db,
    `SELECT * FROM notificaciones WHERE tipo LIKE 'SOLICITUD_%' ORDER BY id ASC`
  );

  fs.writeFileSync(
    path.join(backupDir, "sqlite-solicitudes-backup.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );
}

async function resetSqlite(db) {
  await sqliteExec(
    db,
    `
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE TRANSACTION;
      DELETE FROM solicitud_mensajes;
      DELETE FROM solicitud_historial;
      DELETE FROM solicitud_items;
      DELETE FROM solicitudes;
      DELETE FROM notificaciones WHERE tipo LIKE 'SOLICITUD_%';
      DELETE FROM sqlite_sequence WHERE name IN ('solicitud_mensajes', 'solicitud_historial', 'solicitud_items', 'solicitudes');
      COMMIT;
      PRAGMA foreign_keys = ON;
    `
  );
}

async function backupPgData(client, backupDir) {
  const tables = [
    "solicitudes",
    "solicitud_items",
    "solicitud_historial",
    "solicitud_mensajes",
  ];

  const snapshot = {};
  for (const table of tables) {
    const { rows } = await client.query(`SELECT * FROM ${table} ORDER BY id ASC`);
    snapshot[table] = rows;
  }
  const notifications = await client.query(
    `SELECT * FROM notificaciones WHERE tipo LIKE 'SOLICITUD_%' ORDER BY id ASC`
  );
  snapshot.notificaciones = notifications.rows;

  fs.writeFileSync(
    path.join(backupDir, "postgres-solicitudes-backup.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );
}

async function resetPg(client) {
  await client.query("BEGIN");
  try {
    await client.query(`DELETE FROM notificaciones WHERE tipo LIKE 'SOLICITUD_%'`);
    await client.query(
      `TRUNCATE TABLE solicitud_mensajes, solicitud_historial, solicitud_items, solicitudes RESTART IDENTITY`
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const sqlitePath = path.join(projectRoot, "backend", "database", "portal_forestal.db");
  const envPath = path.join(projectRoot, ".env.production.real");
  const backupDir = path.join(projectRoot, "backups", `solicitudes-reset-${timestampKey()}`);
  const env = parseEnvFile(envPath);
  const databaseUrl = String(env.DATABASE_URL || process.env.DATABASE_URL || "").trim();

  ensureDir(backupDir);
  fs.copyFileSync(sqlitePath, path.join(backupDir, "portal_forestal.db"));

  const sqliteDb = openSqlite(sqlitePath);
  try {
    await backupSqliteData(sqliteDb, backupDir);
    await resetSqlite(sqliteDb);
  } finally {
    await sqliteClose(sqliteDb);
  }

  if (!databaseUrl) {
    console.log(JSON.stringify({ ok: true, backupDir, sqliteOnly: true }, null, 2));
    return;
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  try {
    await backupPgData(client, backupDir);
    await resetPg(client);

    const counts = {};
    for (const table of ["solicitudes", "solicitud_items", "solicitud_historial", "solicitud_mensajes"]) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS total FROM ${table}`);
      counts[table] = Number(rows[0]?.total || 0);
    }

    console.log(JSON.stringify({ ok: true, backupDir, counts }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
