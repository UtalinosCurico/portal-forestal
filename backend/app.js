// DEPRECATED: Este entry point pertenece al stack legacy y no es el usado en producción.
// Vercel y el entorno activo usan backend/server.js con routes/solicitudes.js y
// services/solicitudesService.js -> solicitudesPgService.js.
// Este archivo sigue existiendo por compatibilidad histórica; no extenderlo ni usarlo
// como base para cambios nuevos sin revisar primero la paridad con el stack activo.

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const env = require("./config/env");
const { AppError } = require("./utils/errors");
const logger = require("./utils/logger");
const { errorHandler } = require("./middleware/error.middleware");

const authRoutes = require("./routes/auth.routes");
const solicitudesRoutes = require("./routes/solicitudes.routes");
const inventarioRoutes = require("./routes/inventario.routes");
const usuariosRoutes = require("./routes/usuarios.routes");
const equiposRoutes = require("./routes/equipos.routes");
const reportesRoutes = require("./routes/reportes.routes");
const powerbiRoutes = require("./routes/powerbi.routes");

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(
  morgan("dev", {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
  })
);

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});

app.use((req, res, next) => {
  res.apiSuccess = (data, statusCode = 200) => {
    res.status(statusCode).json({
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      data,
    });
  };
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/solicitudes", solicitudesRoutes);
app.use("/api/inventario", inventarioRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/equipos", equiposRoutes);
app.use("/api/reportes", reportesRoutes);
app.use("/api/powerbi", powerbiRoutes);

const frontendPath = path.join(__dirname, "..", "frontend");
app.use(express.static(frontendPath));
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.use((req, res, next) => {
  next(new AppError(`Ruta no encontrada: ${req.originalUrl}`, 404, "NOT_FOUND"));
});

app.use(errorHandler);

module.exports = app;
