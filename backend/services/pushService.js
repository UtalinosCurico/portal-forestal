const webpush = require("web-push");
const { isGlobalRole } = require("../middleware/roles");
const { listUsers } = require("./userStore");
const { getOperationalPool } = require("./operationalPgStore");

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

async function saveSubscription(usuarioId, subscription) {
  const pg = getOperationalPool();
  const { endpoint, keys } = subscription;
  await pg.query(
    `INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (endpoint) DO UPDATE
     SET usuario_id = $1, p256dh = $3, auth = $4, updated_at = NOW()`,
    [Number(usuarioId), endpoint, keys.p256dh, keys.auth]
  );
}

async function removeSubscription(endpoint) {
  const pg = getOperationalPool();
  await pg.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
}

async function listSubscriptionsByUser(usuarioId) {
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

async function findSubscriptionByEndpoint(endpoint) {
  const pg = getOperationalPool();
  const { rows } = await pg.query(
    `SELECT endpoint, p256dh, auth
     FROM push_subscriptions
     WHERE endpoint = $1
     LIMIT 1`,
    [String(endpoint || "").trim()]
  );
  return rows[0] || null;
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
  };

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
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(row.endpoint);
        }
      }
    })
  );

  if (dead.length) {
    const pg = getOperationalPool();
    await pg.query("DELETE FROM push_subscriptions WHERE endpoint = ANY($1)", [dead]);
    summary.removed = dead.length;
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
  sendPushToUser,
  sendPushToEndpoint,
  sendPushForNotification,
};
