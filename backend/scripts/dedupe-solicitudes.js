const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const DEFAULT_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

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

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function simplifyItemName(value) {
  return normalizeText(value)
    .replace(/\b(para|de|del|la|el|los|las|y|con|sin|por)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    help: false,
    envFile: null,
    windowMs: DEFAULT_DUPLICATE_WINDOW_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      args.apply = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--env-file") {
      args.envFile = argv[index + 1] ? path.resolve(argv[index + 1]) : null;
      index += 1;
      continue;
    }
    if (token.startsWith("--env-file=")) {
      args.envFile = path.resolve(token.slice("--env-file=".length));
      continue;
    }
    if (token === "--window-minutes") {
      const rawValue = Number(argv[index + 1]);
      if (!Number.isFinite(rawValue) || rawValue <= 0) {
        throw new Error("El valor de --window-minutes debe ser un numero positivo");
      }
      args.windowMs = rawValue * 60 * 1000;
      index += 1;
      continue;
    }
    if (token.startsWith("--window-minutes=")) {
      const rawValue = Number(token.slice("--window-minutes=".length));
      if (!Number.isFinite(rawValue) || rawValue <= 0) {
        throw new Error("El valor de --window-minutes debe ser un numero positivo");
      }
      args.windowMs = rawValue * 60 * 1000;
      continue;
    }
    throw new Error(`Argumento no reconocido: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`Uso:
  node backend/scripts/dedupe-solicitudes.js
  node backend/scripts/dedupe-solicitudes.js --apply
  node backend/scripts/dedupe-solicitudes.js --env-file .env.production.real
  node backend/scripts/dedupe-solicitudes.js --window-minutes 15

Opciones:
  --apply             Ejecuta la consolidacion real. Sin esto solo hace preview.
  --env-file <ruta>   Fuerza el archivo de entorno a usar.
  --window-minutes N  Ventana en minutos para considerar solicitudes duplicadas.
  --help, -h          Muestra esta ayuda.`);
}

function resolveEnvFile(projectRoot, explicitEnvFile = null) {
  const candidates = [
    explicitEnvFile,
    process.env.PORTAL_FMN_ENV_FILE,
    path.join(projectRoot, ".env.production.real"),
    path.join(projectRoot, ".env.production"),
    path.join(projectRoot, ".env"),
    path.join(projectRoot, "backend", ".env"),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadRuntimeConfig(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, "..", "..");
  const envPath = resolveEnvFile(projectRoot, options.envFile);
  const env = envPath ? parseEnvFile(envPath) : {};
  const databaseUrl = String(env.DATABASE_URL || process.env.DATABASE_URL || "").trim();

  return {
    projectRoot,
    envPath,
    databaseUrl,
    windowMs: options.windowMs || DEFAULT_DUPLICATE_WINDOW_MS,
  };
}

function itemBaseSignature(item) {
  return [
    normalizeText(item.nombre_item),
    Number(item.cantidad || 0),
    normalizeText(item.unidad_medida),
    normalizeText(item.codigo_referencia),
    normalizeText(item.usuario_final),
    normalizeText(item.comentario),
  ].join("|");
}

function itemLooseSignature(item) {
  return [
    simplifyItemName(item.nombre_item),
    Number(item.cantidad || 0),
    normalizeText(item.unidad_medida),
    normalizeText(item.codigo_referencia),
  ].join("|");
}

function getPrimaryItemName(items = []) {
  return simplifyItemName(items[0]?.nombre_item || "");
}

function buildItemNamesFingerprint(items = []) {
  const normalizedNames = [...new Set(
    items
      .map((item) => simplifyItemName(item.nombre_item))
      .filter(Boolean)
  )];
  normalizedNames.sort();
  return normalizedNames.join("||");
}

function solicitudClusterKey(solicitud, items = []) {
  const itemFingerprint = buildItemNamesFingerprint(items);
  return [
    Number(solicitud.solicitante_id || 0),
    Number(solicitud.equipo_id || 0),
    itemFingerprint || getPrimaryItemName(items),
  ].join("|");
}

function getStatusRank(status) {
  const ranks = {
    NO_APLICA: 0,
    POR_GESTIONAR: 1,
    GESTIONADO: 2,
    ENVIADO: 3,
    ENTREGADO: 4,
  };
  return ranks[String(status || "").trim().toUpperCase()] ?? 0;
}

function mergeText(targetValue, sourceValue) {
  const targetText = String(targetValue || "").trim();
  const sourceText = String(sourceValue || "").trim();
  if (!targetText) {
    return sourceText || null;
  }
  if (!sourceText || targetText === sourceText) {
    return targetText;
  }
  return `${targetText}\n${sourceText}`;
}

function buildSolicitudSummary(items) {
  const totalItems = items.length;
  const totalUnidades = items.reduce((acc, item) => acc + Number(item.cantidad || 0), 0);
  const firstItem = items[0]?.nombre_item || "Solicitud";

  return {
    repuesto:
      totalItems === 1 ? firstItem : `${firstItem} y ${Math.max(totalItems - 1, 0)} item(s) mas`,
    cantidad: totalUnidades,
  };
}

function buildItemStatusSummary(items = []) {
  const summary = {
    total: 0,
    gestionados: 0,
    enviados: 0,
    entregados: 0,
  };

  for (const item of items) {
    const status = String(item.estado_item || "POR_GESTIONAR").trim().toUpperCase();
    if (status === "NO_APLICA") {
      continue;
    }
    summary.total += 1;
    if (status === "GESTIONADO") {
      summary.gestionados += 1;
    }
    if (status === "ENVIADO") {
      summary.enviados += 1;
    }
    if (status === "ENTREGADO") {
      summary.entregados += 1;
    }
  }

  return summary;
}

function deriveSolicitudStatusFromItems(currentStatus, items = []) {
  const summary = buildItemStatusSummary(items);
  const total = Number(summary.total || 0);
  const normalizedCurrent = String(currentStatus || "PENDIENTE").trim().toUpperCase();

  if (!total) {
    return normalizedCurrent || "PENDIENTE";
  }

  if (normalizedCurrent === "RECHAZADO") {
    return "RECHAZADO";
  }

  if (summary.entregados === total) {
    return "ENTREGADO";
  }

  if (summary.enviados + summary.entregados === total) {
    return "EN_DESPACHO";
  }

  if (summary.gestionados + summary.enviados + summary.entregados > 0) {
    return "EN_REVISION";
  }

  if (normalizedCurrent === "APROBADO") {
    return "APROBADO";
  }

  return "PENDIENTE";
}

function pickCanonical(group, itemMap, historyMap, messageMap) {
  return [...group].sort((a, b) => {
    const aItems = itemMap.get(a.id) || [];
    const bItems = itemMap.get(b.id) || [];
    const aHistory = historyMap.get(a.id) || [];
    const bHistory = historyMap.get(b.id) || [];
    const aMessages = messageMap.get(a.id) || [];
    const bMessages = messageMap.get(b.id) || [];

    const aScore = aItems.length * 1000 + aMessages.length * 100 + aHistory.length * 10;
    const bScore = bItems.length * 1000 + bMessages.length * 100 + bHistory.length * 10;
    if (bScore !== aScore) {
      return bScore - aScore;
    }

    const aUpdated = parseTime(a.updated_at || a.created_at);
    const bUpdated = parseTime(b.updated_at || b.created_at);
    if (bUpdated !== aUpdated) {
      return bUpdated - aUpdated;
    }

    return Number(a.id) - Number(b.id);
  })[0];
}

function findDuplicateGroups(
  solicitudes,
  itemMap,
  historyMap,
  messageMap,
  options = {}
) {
  const duplicateWindowMs = Number(options.windowMs || DEFAULT_DUPLICATE_WINDOW_MS);
  const grouped = new Map();
  for (const solicitud of solicitudes) {
    const key = solicitudClusterKey(solicitud, itemMap.get(solicitud.id) || []);
    const bucket = grouped.get(key) || [];
    bucket.push(solicitud);
    grouped.set(key, bucket);
  }

  const result = [];
  for (const bucket of grouped.values()) {
    const ordered = [...bucket].sort((a, b) => parseTime(a.created_at) - parseTime(b.created_at));
    let currentCluster = [];

    for (const solicitud of ordered) {
      if (!currentCluster.length) {
        currentCluster = [solicitud];
        continue;
      }

      const previous = currentCluster[currentCluster.length - 1];
      const diff = Math.abs(parseTime(solicitud.created_at) - parseTime(previous.created_at));
      if (diff <= duplicateWindowMs) {
        currentCluster.push(solicitud);
      } else {
        if (currentCluster.length > 1) {
          const canonical = pickCanonical(currentCluster, itemMap, historyMap, messageMap);
          result.push({
            canonical,
            duplicates: currentCluster.filter((entry) => Number(entry.id) !== Number(canonical.id)),
            cluster: currentCluster,
          });
        }
        currentCluster = [solicitud];
      }
    }

    if (currentCluster.length > 1) {
      const canonical = pickCanonical(currentCluster, itemMap, historyMap, messageMap);
      result.push({
        canonical,
        duplicates: currentCluster.filter((entry) => Number(entry.id) !== Number(canonical.id)),
        cluster: currentCluster,
      });
    }
  }

  return result.filter((entry) => entry.duplicates.length > 0);
}

async function fetchGroupedRows(client, sql) {
  const { rows } = await client.query(sql);
  const map = new Map();
  for (const row of rows) {
    const key = Number(row.solicitud_id);
    const bucket = map.get(key) || [];
    bucket.push(row);
    map.set(key, bucket);
  }
  return map;
}

async function backupRows(client, backupDir, solicitudIds) {
  const ids = [...new Set(solicitudIds.map((value) => Number(value)).filter(Boolean))];
  const snapshot = {};

  for (const table of ["solicitudes", "solicitud_items", "solicitud_historial", "solicitud_mensajes"]) {
    const field = table === "solicitudes" ? "id" : "solicitud_id";
    const { rows } = await client.query(
      `SELECT * FROM ${table} WHERE ${field} = ANY($1::int[]) ORDER BY id ASC`,
      [ids]
    );
    snapshot[table] = rows;
  }

  const notifications = await client.query(
    `SELECT * FROM notificaciones WHERE tipo LIKE 'SOLICITUD_%' AND referencia_id = ANY($1::int[]) ORDER BY id ASC`,
    [ids]
  );
  snapshot.notificaciones = notifications.rows;

  const inventoryMovements = await client.query(
    `SELECT * FROM inventario_movimientos WHERE solicitud_id = ANY($1::int[]) ORDER BY id ASC`
  .replace(/\s+\./g, "."),
    [ids]
  ).catch(() => ({ rows: [] }));
  snapshot.inventario_movimientos = inventoryMovements.rows;

  fs.writeFileSync(
    path.join(backupDir, "postgres-dedupe-backup.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );
}

async function mergeDuplicateGroup(client, group, itemMap, historyMap, messageMap, options = {}) {
  const hasInventoryMovements = options.hasInventoryMovements === true;
  const canonical = group.canonical;
  const canonicalId = Number(canonical.id);
  const canonicalItems = [...(itemMap.get(canonicalId) || [])];
  let mergedItems = 0;
  let movedItems = 0;
  let movedHistories = 0;
  let movedMessages = 0;
  let movedNotifications = 0;
  let movedInventoryMovements = 0;
  let deletedSolicitudes = 0;

  const targetBySignature = new Map();
  for (const item of canonicalItems) {
    targetBySignature.set(itemLooseSignature(item), item);
  }

  for (const duplicate of group.duplicates) {
    const duplicateId = Number(duplicate.id);
    const duplicateItems = itemMap.get(duplicateId) || [];

    for (const sourceItem of duplicateItems) {
      const signature = itemLooseSignature(sourceItem);
      const targetItem = targetBySignature.get(signature);

      if (targetItem) {
        const nextEstado =
          getStatusRank(sourceItem.estado_item) > getStatusRank(targetItem.estado_item)
            ? sourceItem.estado_item
            : targetItem.estado_item;
        const nextComentarioGestion = mergeText(
          targetItem.comentario_gestion,
          sourceItem.comentario_gestion
        );
        const nextEncargado = targetItem.encargado_id || sourceItem.encargado_id || null;
        const nextSender = targetItem.enviado_por_id || sourceItem.enviado_por_id || null;
        const nextReceiver =
          targetItem.recepcionado_por_id || sourceItem.recepcionado_por_id || null;
        const nextUpdatedAt =
          parseTime(sourceItem.updated_at) > parseTime(targetItem.updated_at)
            ? sourceItem.updated_at
            : targetItem.updated_at;

        await client.query(
          `
            UPDATE solicitud_items
            SET
              estado_item = $1,
              comentario_gestion = $2,
              encargado_id = $3,
              enviado_por_id = $4,
              recepcionado_por_id = $5,
              updated_at = COALESCE($6::timestamptz, updated_at, NOW())
            WHERE id = $7
          `,
          [
            nextEstado,
            nextComentarioGestion || null,
            nextEncargado,
            nextSender,
            nextReceiver,
            nextUpdatedAt || null,
            Number(targetItem.id),
          ]
        );

        await client.query(`DELETE FROM solicitud_items WHERE id = $1`, [Number(sourceItem.id)]);
        Object.assign(targetItem, {
          estado_item: nextEstado,
          comentario_gestion: nextComentarioGestion,
          encargado_id: nextEncargado,
          enviado_por_id: nextSender,
          recepcionado_por_id: nextReceiver,
          updated_at: nextUpdatedAt,
        });
        mergedItems += 1;
      } else {
        await client.query(
          `UPDATE solicitud_items SET solicitud_id = $1, updated_at = NOW() WHERE id = $2`,
          [canonicalId, Number(sourceItem.id)]
        );
        const movedItem = { ...sourceItem, solicitud_id: canonicalId };
        canonicalItems.push(movedItem);
        targetBySignature.set(signature, movedItem);
        movedItems += 1;
      }
    }

    const movedHistoryResult = await client.query(
      `UPDATE solicitud_historial SET solicitud_id = $1 WHERE solicitud_id = $2`,
      [canonicalId, duplicateId]
    );
    movedHistories += Number(movedHistoryResult.rowCount || 0);

    const movedMessageResult = await client.query(
      `UPDATE solicitud_mensajes SET solicitud_id = $1 WHERE solicitud_id = $2`,
      [canonicalId, duplicateId]
    );
    movedMessages += Number(movedMessageResult.rowCount || 0);

    const movedNotificationResult = await client.query(
      `UPDATE notificaciones SET referencia_id = $1 WHERE tipo LIKE 'SOLICITUD_%' AND referencia_id = $2`,
      [canonicalId, duplicateId]
    );
    movedNotifications += Number(movedNotificationResult.rowCount || 0);

    if (hasInventoryMovements) {
      const movedInventoryResult = await client.query(
        `UPDATE inventario_movimientos SET solicitud_id = $1 WHERE solicitud_id = $2`,
        [canonicalId, duplicateId]
      );
      movedInventoryMovements += Number(movedInventoryResult.rowCount || 0);
    }

    await client.query(`DELETE FROM solicitudes WHERE id = $1`, [duplicateId]);
    deletedSolicitudes += 1;
  }

  const { rows: canonicalItemRows } = await client.query(
    `
      SELECT
        id,
        nombre_item,
        cantidad,
        unidad_medida,
        codigo_referencia,
        usuario_final,
        comentario,
        estado_item,
        comentario_gestion,
        encargado_id,
        enviado_por_id,
        recepcionado_por_id,
        updated_at
      FROM solicitud_items
      WHERE solicitud_id = $1
      ORDER BY id ASC
    `,
    [canonicalId]
  );

  const summary = buildSolicitudSummary(canonicalItemRows);
  const nextStatus = deriveSolicitudStatusFromItems(canonical.estado, canonicalItemRows);

  await client.query(
    `
      UPDATE solicitudes
      SET
        repuesto = $1,
        cantidad = $2,
        estado = $3,
        updated_at = NOW()
      WHERE id = $4
    `,
    [summary.repuesto, summary.cantidad, nextStatus, canonicalId]
  );

  await client.query(
    `
      INSERT INTO solicitud_historial
        (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
      VALUES ($1, 'SOLICITUD_DEDUPLICADA', $2, $3, $4, 1, 'Sistema')
    `,
    [
      canonicalId,
      canonical.estado,
      nextStatus,
      `Se consolidaron ${group.duplicates.length} solicitud(es) duplicada(s): ${group.duplicates
        .map((entry) => `#${entry.id}`)
        .join(", ")}`,
    ]
  );

  return {
    canonicalId,
    duplicateIds: group.duplicates.map((entry) => Number(entry.id)),
    mergedItems,
    movedItems,
    movedHistories,
    movedMessages,
    movedNotifications,
    movedInventoryMovements,
    deletedSolicitudes,
    finalStatus: nextStatus,
    finalResumen: summary.repuesto,
    finalCantidad: summary.cantidad,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const { apply } = args;
  const { projectRoot, envPath, databaseUrl, windowMs } = loadRuntimeConfig(args);

  if (!databaseUrl) {
    throw new Error(
      "No se encontro DATABASE_URL en el entorno ni en un archivo .env compatible"
    );
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require") ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  try {
    const { rows: tableRows } = await client.query(
      `SELECT to_regclass('inventario_movimientos') AS inventory_table`
    );
    const hasInventoryMovements = Boolean(tableRows[0]?.inventory_table);

    const { rows: solicitudes } = await client.query(
      `
        SELECT
          id,
          solicitante_id,
          equipo_id,
          comentario,
          estado,
          created_at,
          updated_at
        FROM solicitudes
        ORDER BY created_at ASC, id ASC
      `
    );

    const itemMap = await fetchGroupedRows(
      client,
      `
        SELECT
          id,
          solicitud_id,
          nombre_item,
          cantidad,
          unidad_medida,
          codigo_referencia,
          usuario_final,
          comentario,
          estado_item,
          comentario_gestion,
          encargado_id,
          enviado_por_id,
          recepcionado_por_id,
          updated_at
        FROM solicitud_items
        ORDER BY solicitud_id ASC, id ASC
      `
    );
    const historyMap = await fetchGroupedRows(
      client,
      `SELECT id, solicitud_id FROM solicitud_historial ORDER BY solicitud_id ASC, id ASC`
    );
    const messageMap = await fetchGroupedRows(
      client,
      `SELECT id, solicitud_id FROM solicitud_mensajes ORDER BY solicitud_id ASC, id ASC`
    );

    const duplicateGroups = findDuplicateGroups(solicitudes, itemMap, historyMap, messageMap, {
      windowMs,
    });
    const duplicateIds = duplicateGroups.flatMap((group) =>
      [group.canonical, ...group.duplicates].map((entry) => Number(entry.id))
    );

    const preview = duplicateGroups.map((group) => ({
      keep: Number(group.canonical.id),
      remove: group.duplicates.map((entry) => Number(entry.id)),
      solicitudIds: group.cluster.map((entry) => Number(entry.id)),
      createdAt: group.cluster.map((entry) => entry.created_at),
      itemCounts: group.cluster.map((entry) => ({
        id: Number(entry.id),
        items: (itemMap.get(Number(entry.id)) || []).length,
      })),
    }));

    if (!apply) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "dry-run",
            envPath,
            windowMinutes: Math.round(windowMs / 60000),
            duplicateGroupCount: duplicateGroups.length,
            affectedSolicitudIds: [...new Set(duplicateIds)].sort((a, b) => a - b),
            preview,
          },
          null,
          2
        )
      );
      return;
    }

    if (!duplicateGroups.length) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "apply",
            envPath,
            windowMinutes: Math.round(windowMs / 60000),
            duplicateGroupCount: 0,
            applied: [],
          },
          null,
          2
        )
      );
      return;
    }

    const backupDir = path.join(projectRoot, "backups", `solicitudes-dedupe-${timestampKey()}`);
    ensureDir(backupDir);
    await backupRows(client, backupDir, duplicateIds);

    await client.query("BEGIN");
    try {
      const applied = [];
      for (const group of duplicateGroups) {
        applied.push(
          await mergeDuplicateGroup(client, group, itemMap, historyMap, messageMap, {
            hasInventoryMovements,
          })
        );
      }
      await client.query("COMMIT");

      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "apply",
            envPath,
            windowMinutes: Math.round(windowMs / 60000),
            backupDir,
            duplicateGroupCount: duplicateGroups.length,
            applied,
          },
          null,
          2
        )
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

module.exports = {
  DEFAULT_DUPLICATE_WINDOW_MS,
  buildItemNamesFingerprint,
  findDuplicateGroups,
  itemLooseSignature,
  loadRuntimeConfig,
  normalizeText,
  parseArgs,
  parseEnvFile,
  parseTime,
  pickCanonical,
  printHelp,
  resolveEnvFile,
  simplifyItemName,
  solicitudClusterKey,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
