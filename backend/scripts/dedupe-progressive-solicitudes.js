const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const {
  itemLooseSignature,
  loadRuntimeConfig,
  normalizeText,
  parseTime,
} = require("./dedupe-solicitudes");

const DEFAULT_PROGRESSIVE_WINDOW_MS = 72 * 60 * 60 * 1000;

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    help: false,
    envFile: null,
    windowMs: DEFAULT_PROGRESSIVE_WINDOW_MS,
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
    if (token === "--window-hours") {
      const rawValue = Number(argv[index + 1]);
      if (!Number.isFinite(rawValue) || rawValue <= 0) {
        throw new Error("El valor de --window-hours debe ser un numero positivo");
      }
      args.windowMs = rawValue * 60 * 60 * 1000;
      index += 1;
      continue;
    }
    if (token.startsWith("--window-hours=")) {
      const rawValue = Number(token.slice("--window-hours=".length));
      if (!Number.isFinite(rawValue) || rawValue <= 0) {
        throw new Error("El valor de --window-hours debe ser un numero positivo");
      }
      args.windowMs = rawValue * 60 * 60 * 1000;
      continue;
    }
    throw new Error(`Argumento no reconocido: ${token}`);
  }

  return args;
}

function printHelp() {
  console.log(`Uso:
  node backend/scripts/dedupe-progressive-solicitudes.js
  node backend/scripts/dedupe-progressive-solicitudes.js --apply
  node backend/scripts/dedupe-progressive-solicitudes.js --window-hours 72
  node backend/scripts/dedupe-progressive-solicitudes.js --env-file .env.production.real

Opciones:
  --apply             Ejecuta la consolidacion real. Sin esto solo hace preview.
  --env-file <ruta>   Fuerza el archivo de entorno a usar.
  --window-hours N    Ventana maxima entre solicitudes del mismo grupo progresivo.
  --help, -h          Muestra esta ayuda.`);
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

function getSolicitudStatusRank(status) {
  const ranks = {
    RECHAZADO: -1,
    PENDIENTE: 0,
    APROBADO: 1,
    EN_REVISION: 2,
    EN_DESPACHO: 3,
    ENTREGADO: 4,
  };
  return ranks[String(status || "").trim().toUpperCase()] ?? 0;
}

function getItemStatusRank(status) {
  const ranks = {
    NO_APLICA: 0,
    POR_GESTIONAR: 1,
    GESTIONADO: 2,
    ENVIADO: 3,
    ENTREGADO: 4,
  };
  return ranks[String(status || "").trim().toUpperCase()] ?? 0;
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

function mergeText(targetValue, sourceValue) {
  const targetText = String(targetValue || "").trim();
  const sourceText = String(sourceValue || "").trim();
  if (!targetText) {
    return sourceText || null;
  }
  if (!sourceText) {
    return targetText;
  }
  if (normalizeText(targetText) === normalizeText(sourceText)) {
    return targetText;
  }
  return `${targetText}\n${sourceText}`;
}

function setIsSubset(subset, superset) {
  for (const value of subset) {
    if (!superset.has(value)) {
      return false;
    }
  }
  return true;
}

function enrichSolicitud(solicitud, itemMap, historyMap, messageMap) {
  const items = itemMap.get(Number(solicitud.id)) || [];
  const looseSet = new Set(items.map((item) => itemLooseSignature(item)).filter(Boolean));
  const itemProgressScore = items.reduce(
    (acc, item) => acc + getItemStatusRank(item.estado_item),
    0
  );

  return {
    ...solicitud,
    items,
    looseSet,
    looseSignatures: [...looseSet].sort(),
    exactSignatures: items.map((item) => itemBaseSignature(item)),
    itemCount: items.length,
    itemProgressScore,
    historyCount: (historyMap.get(Number(solicitud.id)) || []).length,
    messageCount: (messageMap.get(Number(solicitud.id)) || []).length,
  };
}

function isProgressivePair(previous, next, options = {}) {
  if (Number(previous.solicitante_id) !== Number(next.solicitante_id)) {
    return false;
  }
  if (Number(previous.equipo_id) !== Number(next.equipo_id)) {
    return false;
  }

  const previousTime = parseTime(previous.created_at);
  const nextTime = parseTime(next.created_at);
  const diff = nextTime - previousTime;
  if (diff < 0 || diff > Number(options.windowMs || DEFAULT_PROGRESSIVE_WINDOW_MS)) {
    return false;
  }

  if (!previous.looseSet.size || !next.looseSet.size) {
    return false;
  }

  return setIsSubset(previous.looseSet, next.looseSet);
}

function pickProgressiveCanonical(chain) {
  return [...chain].sort((a, b) => {
    if (b.looseSet.size !== a.looseSet.size) {
      return b.looseSet.size - a.looseSet.size;
    }

    if (b.itemCount !== a.itemCount) {
      return b.itemCount - a.itemCount;
    }

    if (b.itemProgressScore !== a.itemProgressScore) {
      return b.itemProgressScore - a.itemProgressScore;
    }

    const aStatusRank = getSolicitudStatusRank(a.estado);
    const bStatusRank = getSolicitudStatusRank(b.estado);
    if (bStatusRank !== aStatusRank) {
      return bStatusRank - aStatusRank;
    }

    if (b.messageCount !== a.messageCount) {
      return b.messageCount - a.messageCount;
    }

    if (b.historyCount !== a.historyCount) {
      return b.historyCount - a.historyCount;
    }

    const aUpdated = parseTime(a.updated_at || a.created_at);
    const bUpdated = parseTime(b.updated_at || b.created_at);
    if (bUpdated !== aUpdated) {
      return bUpdated - aUpdated;
    }

    return Number(a.id) - Number(b.id);
  })[0];
}

function buildProgressiveChains(solicitudes, itemMap, historyMap, messageMap, options = {}) {
  const grouped = new Map();
  for (const solicitud of solicitudes) {
    const enriched = enrichSolicitud(solicitud, itemMap, historyMap, messageMap);
    const key = `${Number(enriched.solicitante_id || 0)}|${Number(enriched.equipo_id || 0)}`;
    const bucket = grouped.get(key) || [];
    bucket.push(enriched);
    grouped.set(key, bucket);
  }

  const chains = [];
  for (const bucket of grouped.values()) {
    const ordered = [...bucket].sort((a, b) => parseTime(a.created_at) - parseTime(b.created_at));
    let currentChain = [];
    let hasStrictExpansion = false;

    for (const solicitud of ordered) {
      if (!currentChain.length) {
        currentChain = [solicitud];
        hasStrictExpansion = false;
        continue;
      }

      const previous = currentChain[currentChain.length - 1];
      if (isProgressivePair(previous, solicitud, options)) {
        if (solicitud.looseSet.size > previous.looseSet.size) {
          hasStrictExpansion = true;
        }
        currentChain.push(solicitud);
        continue;
      }

      if (currentChain.length > 1 && hasStrictExpansion) {
        const canonical = pickProgressiveCanonical(currentChain);
        chains.push({
          canonical,
          duplicates: currentChain.filter((entry) => Number(entry.id) !== Number(canonical.id)),
          chain: currentChain,
        });
      }

      currentChain = [solicitud];
      hasStrictExpansion = false;
    }

    if (currentChain.length > 1 && hasStrictExpansion) {
      const canonical = pickProgressiveCanonical(currentChain);
      chains.push({
        canonical,
        duplicates: currentChain.filter((entry) => Number(entry.id) !== Number(canonical.id)),
        chain: currentChain,
      });
    }
  }

  return chains.filter((entry) => entry.duplicates.length > 0);
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

  const inventoryMovements = await client
    .query(`SELECT * FROM inventario_movimientos WHERE solicitud_id = ANY($1::int[]) ORDER BY id ASC`, [ids])
    .catch(() => ({ rows: [] }));
  snapshot.inventario_movimientos = inventoryMovements.rows;

  fs.writeFileSync(
    path.join(backupDir, "postgres-progressive-dedupe-backup.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8"
  );
}

async function mergeProgressiveChain(client, chain, itemMap, historyMap, messageMap, options = {}) {
  const hasInventoryMovements = options.hasInventoryMovements === true;
  const canonical = chain.canonical;
  const canonicalId = Number(canonical.id);
  const canonicalItems = [...(itemMap.get(canonicalId) || [])];
  let mergedItems = 0;
  let movedItems = 0;
  let movedHistories = 0;
  let movedMessages = 0;
  let movedNotifications = 0;
  let movedInventoryMovements = 0;
  let deletedSolicitudes = 0;
  let mergedComment = String(canonical.comentario || "").trim() || null;

  const targetByBaseSignature = new Map();
  for (const item of canonicalItems) {
    targetByBaseSignature.set(itemBaseSignature(item), item);
  }

  for (const duplicate of chain.duplicates) {
    const duplicateId = Number(duplicate.id);
    const duplicateItems = itemMap.get(duplicateId) || [];
    mergedComment = mergeText(mergedComment, duplicate.comentario);

    for (const sourceItem of duplicateItems) {
      const signature = itemBaseSignature(sourceItem);
      const targetItem = targetByBaseSignature.get(signature);

      if (targetItem) {
        const nextEstado =
          getItemStatusRank(sourceItem.estado_item) > getItemStatusRank(targetItem.estado_item)
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
        targetByBaseSignature.set(signature, movedItem);
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
        comentario = $3,
        estado = $4,
        updated_at = NOW()
      WHERE id = $5
    `,
    [summary.repuesto, summary.cantidad, mergedComment, nextStatus, canonicalId]
  );

  await client.query(
    `
      INSERT INTO solicitud_historial
        (solicitud_id, accion, estado_anterior, estado_nuevo, detalle, actor_id, actor_name)
      VALUES ($1, 'SOLICITUD_DEDUPLICADA_PROGRESIVA', $2, $3, $4, 1, 'Sistema')
    `,
    [
      canonicalId,
      canonical.estado,
      nextStatus,
      `Se consolidaron ${chain.duplicates.length} solicitud(es) duplicada(s) por arrastre historico: ${chain.duplicates
        .map((entry) => `#${entry.id}`)
        .join(", ")}`,
    ]
  );

  return {
    canonicalId,
    duplicateIds: chain.duplicates.map((entry) => Number(entry.id)),
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

    const progressiveChains = buildProgressiveChains(solicitudes, itemMap, historyMap, messageMap, {
      windowMs,
    });
    const affectedIds = progressiveChains.flatMap((chain) =>
      chain.chain.map((entry) => Number(entry.id))
    );

    const preview = progressiveChains.map((chain) => ({
      keep: Number(chain.canonical.id),
      remove: chain.duplicates.map((entry) => Number(entry.id)),
      solicitudIds: chain.chain.map((entry) => Number(entry.id)),
      statuses: chain.chain.map((entry) => ({
        id: Number(entry.id),
        estado: entry.estado,
      })),
      createdAt: chain.chain.map((entry) => ({
        id: Number(entry.id),
        created_at: entry.created_at,
      })),
      itemCounts: chain.chain.map((entry) => ({
        id: Number(entry.id),
        items: entry.itemCount,
      })),
      itemFingerprints: chain.chain.map((entry) => ({
        id: Number(entry.id),
        signatures: entry.looseSignatures,
      })),
    }));

    if (!apply) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "dry-run",
            envPath,
            windowHours: Math.round(windowMs / (60 * 60 * 1000)),
            duplicateGroupCount: progressiveChains.length,
            affectedSolicitudIds: [...new Set(affectedIds)].sort((a, b) => a - b),
            preview,
          },
          null,
          2
        )
      );
      return;
    }

    if (!progressiveChains.length) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "apply",
            envPath,
            windowHours: Math.round(windowMs / (60 * 60 * 1000)),
            duplicateGroupCount: 0,
            applied: [],
          },
          null,
          2
        )
      );
      return;
    }

    const backupDir = path.join(
      projectRoot,
      "backups",
      `solicitudes-progressive-dedupe-${timestampKey()}`
    );
    ensureDir(backupDir);
    await backupRows(client, backupDir, affectedIds);

    await client.query("BEGIN");
    try {
      const applied = [];
      for (const chain of progressiveChains) {
        applied.push(
          await mergeProgressiveChain(client, chain, itemMap, historyMap, messageMap, {
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
            windowHours: Math.round(windowMs / (60 * 60 * 1000)),
            backupDir,
            duplicateGroupCount: progressiveChains.length,
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
  DEFAULT_PROGRESSIVE_WINDOW_MS,
  buildProgressiveChains,
  isProgressivePair,
  itemBaseSignature,
  mergeText,
  parseArgs,
  pickProgressiveCanonical,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
