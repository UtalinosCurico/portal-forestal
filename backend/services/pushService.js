const webpush = require("web-push");
const { getOperationalPool } = require("./operationalPgStore");

let initialized = false;

function initWebPush() {
  if (initialized) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@forestal.cl";
  if (!pub || !priv) return;
  webpush.setVapidDetails(subject, pub, priv);
  initialized = true;
}

async function saveSubscription(usuarioId, subscription) {
  const pg = getOperationalPool();
  const { endpoint, keys } = subscription;
  await pg.query(
    `INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET usuario_id = $1, p256dh = $3, auth = $4`,
    [usuarioId, endpoint, keys.p256dh, keys.auth]
  );
}

async function removeSubscription(endpoint) {
  const pg = getOperationalPool();
  await pg.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
}

async function sendPushToUser(usuarioId, payload) {
  initWebPush();
  if (!initialized) return;

  const pg = getOperationalPool();
  const { rows } = await pg.query(
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE usuario_id = $1",
    [Number(usuarioId)]
  );

  if (!rows.length) return;

  const data = JSON.stringify(payload);
  const dead = [];

  await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          data
        );
      } catch (err) {
        // 410 Gone = suscripción expirada, limpiar
        if (err.statusCode === 410 || err.statusCode === 404) {
          dead.push(row.endpoint);
        }
      }
    })
  );

  if (dead.length) {
    await pg.query(
      "DELETE FROM push_subscriptions WHERE endpoint = ANY($1)",
      [dead]
    );
  }
}

module.exports = { saveSubscription, removeSubscription, sendPushToUser };
