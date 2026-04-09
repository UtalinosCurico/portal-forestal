const fs = require("fs/promises");
const path = require("path");
const bcrypt = require("bcryptjs");

const env = require("../config/env");
const { query, transaction } = require("./db");
const { ROLES } = require("../config/roles");

async function runSqlSeeds() {
  const seedDir = path.join(__dirname, "seeds");
  const files = (await fs.readdir(seedDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(seedDir, file), "utf8");
    await query(sql);
    // eslint-disable-next-line no-console
    console.log(`Applied seed file: ${file}`);
  }
}

async function ensureAdminUser() {
  await transaction(async (client) => {
    const roleResult = await client.query("SELECT id FROM roles WHERE name = $1", [
      ROLES.ADMINISTRADOR,
    ]);
    if (roleResult.rowCount === 0) {
      throw new Error("Admin role not found. Run migrations and seed roles first.");
    }

    const faenaResult = await client.query(
      "SELECT id FROM faenas WHERE nombre = $1",
      ["Faena Maule Norte Base"]
    );
    const faenaId = faenaResult.rows[0]?.id || null;

    const existingAdmin = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [env.defaultAdminEmail]
    );
    if (existingAdmin.rowCount > 0) {
      return;
    }

    const passwordHash = await bcrypt.hash(env.defaultAdminPassword, 10);
    await client.query(
      `INSERT INTO users
        (nombre, email, password_hash, role_id, faena_id, activo)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [
        env.defaultAdminName,
        env.defaultAdminEmail,
        passwordHash,
        roleResult.rows[0].id,
        faenaId,
      ]
    );
  });
  // eslint-disable-next-line no-console
  console.log("Default admin ensured.");
}

async function run() {
  await runSqlSeeds();
  await ensureAdminUser();
  // eslint-disable-next-line no-console
  console.log("Seeding complete.");
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Seed failed:", error);
  process.exit(1);
});

