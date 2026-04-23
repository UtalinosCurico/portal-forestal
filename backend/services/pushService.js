const webpush = require("web-push");
const { all: sqliteAll, get: sqliteGet, run: sqliteRun } = require("../db/database");
const { isGlobalRole } = require("../middleware/roles");
const { listUsers } = require("./userStore");
const { getOperationalPool, isOperationalPgEnabled } = require("./operationalPgStore");

let initialized = false;

function getVapidPublicKey() {
  return String(process.env.VAPID_PUBLIC_KEY || "").trim();
}

function isPushConfigured() {
  return Boolean(getVapidPublicKey() && String(process.env.VAPID_PRIVATE_KEY || "").trim());
}

function initWebPush() {
  if (initialized || !isPushConfigured()) {
    return initialized;
  }

  const pub = getVapidPublicKey();
  const priv = String(process.env.VAPID_PRIVATE_KEY || "").trim();
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@forestal.cl";
  webpush.setVapidDetails(subject, pub, priv);
  initialized = true;
  return initialized;
}

function normalizePushError(error) {
  const rawBody = error?.body ? String(error.body).slice(0, 600) : "";
  let providerMessage = rawBody;

  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody);
      providerMessage = parsed.error?.message || parsed.message || rawBody;
    } catch {
      providerMessage = rawBody;
    }
  }

  return {
    statusCode: error?.statusCode || null,
    message: providerMessage || error?.message || "El proveedor push rechazo la notificacion.",
  };
}

function buildDeliveryFailureMessage(result) {
  const failure = result?.failures?.[0];
  if (!failure) {
    return "No se pudo entregar la notificacion de prueba. Desactiva y vuelve a activar las notificaciones en este celular.";
  }

  if (failure.statusCode === 401 || failure.statusCode === 403) {
    return "El proveedor rechazo las llaves push del servidor. Desactiva y vuelve a activar las notificaciones; si sigue igual, revisa que VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY correspondan al mismo par.";
  }

  if (failure.statusCode === 404 || failure.statusCode === 410) {
    return "La suscripcion de este celular expiro. Desactiva y vuelve a activar las notificaciones.";
  }

  if (failure.statusCode >= 500) {
    return "El proveedor de notificaciones no acepto el envio en este momento. Intenta nuevamente en unos minutos.";
  }

  return `No se pudo entregar la notificacion de prueba: ${failure.message}`;
}

async function saveSubscription(usuarioId, subscription) {
  const { endpoint, keys } = subscription;
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    await pg.query(
      `INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (endpoint) DO UPDATE
       SET usuario_id = $1, p256dh = $3, auth = $4, updated_at = NOW()`,
      [Number(usuarioId), endpoint, keys.p256dh, keys.auth]
    );
    return;
  }

  await ensureSqlitePushStorage();
  await sqliteRun(
    `INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(endpoint) DO UPDATE SET
       usuario_id = excluded.usuario_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       updated_at = CURRENT_TIMESTAMP`,
    [Number(usuarioId), endpoint, keys.p256dh, keys.auth]
  );
}

async function removeSubscription(endpoint) {
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    await pg.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
    return;
  }

  await ensureSqlitePushStorage();
  await sqliteRun("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
}

async function listSubscriptionsByUser(usuarioId) {
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rows } = await pg.query(
      `SELECT endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE usuario_id = $1
       ORDER BY updated_at DESC, id DESC`,
      [Number(usuarioId)]
    );
    return rows;
  }

  await ensureSqlitePushStorage();
  return sqliteAll(
    `SELECT endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE usuario_id = ?
     ORDER BY updated_at DESC, id DESC`,
    [Number(usuarioId)]
  );
}

async function findSubscriptionByEndpoint(endpoint) {
  const normalizedEndpoint = String(endpoint || "").trim();
  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const { rows } = await pg.query(
      `SELECT endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE endpoint = $1
       LIMIT 1`,
      [normalizedEndpoint]
    );
    return rows[0] || null;
  }

  await ensureSqlitePushStorage();
  return sqliteGet(
    `SELECT endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE endpoint = ?
     LIMIT 1`,
    [normalizedEndpoint]
  );
}

async function removeDeadSubscriptions(endpoints) {
  const dead = [...new Set(endpoints.filter(Boolean))];
  if (!dead.length) {
    return 0;
  }

  if (isOperationalPgEnabled()) {
    const pg = getOperationalPool();
    const result = await pg.query("DELETE FROM push_subscriptions WHERE endpoint = ANY($1)", [dead]);
    return Number(result.rowCount || 0);
  }

  const placeholders = dead.map(() => "?").join(", ");
  await ensureSqlitePushStorage();
  const result = await sqliteRun(`DELETE FROM push_subscriptions WHERE endpoint IN (${placeholders})`, dead);
  return Number(result.changes || 0);
}

async function ensureSqlitePushStorage() {
  if (isOperationalPgEnabled()) {
    return;
  }

  await sqliteRun(
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )`
  );

  await sqliteRun(
    `CREATE INDEX IF NOT EXISTS idx_push_subscriptions_usuario
     ON push_subscriptions(usuario_id, updated_at DESC)`
  );
}

async function getPushStatusForUser(usuarioId, endpoint = "") {
  const subscriptions = await listSubscriptionsByUser(usuarioId);
  const normalizedEndpoint = String(endpoint || "").trim();
  return {
    configured: isPushConfigured(),
    publicKey: getVapidPublicKey(),
    subscribed: subscriptions.length > 0,
    subscriptionCount: subscriptions.length,
    currentDeviceSubscribed: normalizedEndpoint
      ? subscriptions.some((subscription) => subscription.endpoint === normalizedEndpoint)
      : null,
  };
}

async function sendPushToUser(usuarioId, payload) {
  const configured = initWebPush();
  const result = {
    configured,
    subscriptionCount: 0,
    attempted: 0,
    delivered: 0,
    removed: 0,
  };

  if (!configured) {
    return result;
  }

  const rows = await listSubscriptionsByUser(usuarioId);
  result.subscriptionCount = rows.length;

  if (!rows.length) {
    return result;
  }

  return sendPushToSubscriptions(rows, payload, result);
}

async function sendPushToSubscriptions(rows, payload, result = null) {
  const configured = initWebPush();
  const summary = result || {
    configured,
    subscriptionCount: rows.length,
    attempted: 0,
    delivered: 0,
    removed: 0,
    failures: [],
  };
  summary.failures = summary.failures || [];

  if (!configured || !rows.length) {
    return summary;
  }

  summary.attempted = rows.length;
  const data = JSON.stringify(payload);
  const dead = [];

  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          data
        );
        summary.delivered += 1;
      } catch (err) {
        const failure = normalizePushError(err);
        summary.failures.push(failure);
        console.warn("[FMN] Fallo envio push:", failure);
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(row.endpoint);
        }
      }
    })
  );

  if (dead.length) {
    summary.removed = await removeDeadSubscriptions(dead);
  }

  return summary;
}

async function sendPushToEndpoint(endpoint, payload) {
  const normalizedEndpoint = String(endpoint || "").trim();
  if (!normalizedEndpoint) {
    return {
      configured: isPushConfigured(),
      subscriptionCount: 0,
      attempted: 0,
      delivered: 0,
      removed: 0,
    };
  }

  const subscription = await findSubscriptionByEndpoint(normalizedEndpoint);
  if (!subscription) {
    return {
      configured: isPushConfigured(),
      subscriptionCount: 0,
      attempted: 0,
      delivered: 0,
      removed: 0,
    };
  }

  return sendPushToSubscriptions([subscription], payload, {
    configured: isPushConfigured(),
    subscriptionCount: 1,
    attempted: 0,
    delivered: 0,
    removed: 0,
    failures: [],
  });
}

async function resolveNotificationRecipientIds(notification) {
  if (!notification) {
    return [];
  }

  if (notification.usuario_destino_id !== null && notification.usuario_destino_id !== undefined) {
    return [Number(notification.usuario_destino_id)];
  }

  const role = String(notification.rol_destino || "").trim();
  if (!role) {
    const users = await listUsers({ estado: "activos" });
    return users
      .filter((user) => {
        if (!notification.equipo_id) {
          return true;
        }
        return isGlobalRole(user.rol) || Number(user.equipo_id) === Number(notification.equipo_id);
      })
      .map((user) => Number(user.id));
  }

  const users = await listUsers({ estado: "activos", rol: role });
  return users
    .filter((user) => {
      if (!notification.equipo_id) {
        return true;
      }
      if (isGlobalRole(role)) {
        return true;
      }
      return Number(user.equipo_id) === Number(notification.equipo_id);
    })
    .map((user) => Number(user.id));
}

function buildPushPayload(notification) {
  return {
    title: notification?.titulo || "Portal FMN",
    body: notification?.mensaje || "Tienes una notificacion nueva.",
    url: "/web",
    notificationId: notification?.id || null,
    solicitudId: notification?.referencia_id || null,
  };
}

async function sendPushForNotification(notification) {
  const recipientIds = [...new Set(await resolveNotificationRecipientIds(notification))].filter((value) =>
    Number.isInteger(Number(value))
  );

  if (!recipientIds.length) {
    return {
      configured: isPushConfigured(),
      recipients: 0,
      delivered: 0,
      removed: 0,
    };
  }

  const payload = buildPushPayload(notification);
  const outcomes = await Promise.all(recipientIds.map((userId) => sendPushToUser(userId, payload)));

  return outcomes.reduce(
    (summary, outcome) => {
      summary.configured = summary.configured || Boolean(outcome.configured);
      summary.recipients += 1;
      summary.delivered += Number(outcome.delivered || 0);
      summary.removed += Number(outcome.removed || 0);
      return summary;
    },
    { configured: false, recipients: 0, delivered: 0, removed: 0 }
  );
}

module.exports = {
  getVapidPublicKey,
  isPushConfigured,
  saveSubscription,
  removeSubscription,
  listSubscriptionsByUser,
  findSubscriptionByEndpoint,
  getPushStatusForUser,
  buildDeliveryFailureMessage,
  sendPushToUser,
  sendPushToEndpoint,
  sendPushForNotification,
};
