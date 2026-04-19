const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const { initDatabase } = require("./database/init");
const { initUserStore } = require("./services/userStore");
const { initOperationalStore } = require("./services/operationalPgStore");
const testRoutes = require("./routes/test");
const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const solicitudesRoutes = require("./routes/solicitudes");
const inventarioRoutes = require("./routes/inventario");
const equiposRoutes = require("./routes/equipos");
const usuariosRoutes = require("./routes/usuarios");
const reportesRoutes = require("./routes/reportes");
const powerbiRoutes = require("./routes/powerbi");
const enviosRoutes = require("./routes/envios");
const notificacionesRoutes = require("./routes/notificaciones");
const pushRoutes = require("./routes/push");
const aiRoutes = require("./routes/ai");
const feedbackRoutes = require("./routes/feedback");
const novedadesRoutes = require("./routes/novedades");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandlers");
const { getStorageState } = require("./utils/storageMode");

const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const REQUEST_BODY_LIMIT = "6mb";
let appInstance = null;
let appInitPromise = null;

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(bodyParser.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));

  // Endpoints públicos.
  app.get("/", (req, res) => {
    res.send("Portal Forestal Maule Norte funcionando");
  });
  app.use("/api/test", testRoutes);
  app.use("/api/auth", authRoutes);

  // Endpoints protegidos con JWT y RBAC por ruta.
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/solicitudes", solicitudesRoutes);
  app.use("/api/inventario", inventarioRoutes);
  app.use("/api/equipos", equiposRoutes);
  app.use("/api/usuarios", usuariosRoutes);
  app.use("/api/reportes", reportesRoutes);
  app.use("/api/powerbi", powerbiRoutes);
  app.use("/api/envios", enviosRoutes);
  app.use("/api/notificaciones", notificacionesRoutes);
  app.use("/api/push", pushRoutes);
  app.use("/api/ai", aiRoutes);
  app.use("/api/feedback", feedbackRoutes);
  app.use("/api/novedades", novedadesRoutes);

  // Frontend estático.
  app.use(express.static(FRONTEND_DIR));

  function serveIndexWithVersion(req, res) {
    const sha = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8);
    const version = sha || new Date().toISOString().slice(0, 10).replace(/-/g, "");
    try {
      const html = fs.readFileSync(path.join(FRONTEND_DIR, "index.html"), "utf8")
        .replaceAll("__APP_VER__", version);
      res.type("html").send(html);
    } catch {
      res.sendFile(path.join(FRONTEND_DIR, "index.html"));
    }
  }

  app.get("/web", serveIndexWithVersion);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function initializeApp() {
  if (appInstance) {
    return appInstance;
  }

  if (!appInitPromise) {
    appInitPromise = (async () => {
      await initDatabase();
      await initUserStore();
      await initOperationalStore();
      const storageState = getStorageState();
      if (storageState.lockUserMutations) {
        console.warn("[FMN] Seguridad activa:", storageState.message);
      }
      appInstance = createApp();
      return appInstance;
    })();
  }

  return appInitPromise;
}

async function startServer(port = 3000) {
  const app = await initializeApp();
  return app.listen(port, () => {
    console.log(`Servidor ejecutandose en http://localhost:${port}`);
    console.log(`Portal web disponible en http://localhost:${port}/web`);
    console.log("Usuarios de prueba:");
    console.log("- ADMIN: admin@forestal.cl / Admin123!");
    console.log("- SUPERVISOR: supervisor@forestal.cl / Supervisor123!");
    console.log("- SUPERVISOR APOYO: secretaria@forestal.cl / Secretaria123!");
    console.log("- JEFE_FAENA: jefe@forestal.cl / Jefe123!");
    console.log("- OPERADOR: operador@forestal.cl / Operador123!");
  });
}

async function serverlessHandler(req, res) {
  const app = await initializeApp();
  return app(req, res);
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  startServer(port).catch((error) => {
    console.error("Error al iniciar el servidor:", error);
    process.exit(1);
  });
}

module.exports = serverlessHandler;
module.exports.createApp = createApp;
module.exports.startServer = startServer;

