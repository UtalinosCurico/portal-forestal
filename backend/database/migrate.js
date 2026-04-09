const fs = require("fs/promises");
const path = require("path");
const { query, transaction } = require("./db");

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations() {
  const { rows } = await query("SELECT filename FROM schema_migrations");
  return new Set(rows.map((row) => row.filename));
}

async function run() {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await transaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
    });
    // eslint-disable-next-line no-console
    console.log(`Applied migration: ${file}`);
  }

  // eslint-disable-next-line no-console
  console.log("Migrations complete.");
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", error);
  process.exit(1);
});

