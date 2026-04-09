const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  defaultAdminName: process.env.DEFAULT_ADMIN_NAME || "Administrador Forestal",
  defaultAdminEmail: process.env.DEFAULT_ADMIN_EMAIL || "admin@forestal.cl",
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || "Admin123!",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:4000",
};

const required = ["databaseUrl"];
if (env.nodeEnv !== "test") {
  required.push("jwtSecret", "jwtRefreshSecret");
}

for (const key of required) {
  if (!env[key]) {
    throw new Error(`Missing environment variable: ${key}`);
  }
}

module.exports = env;

