const { isOperationalPgEnabled, getOperationalPool } = require("./operationalPgStore");

// Tipos detectables desde prefijo de commit convencional
const TIPO_MAP = {
  feat:     "feature",
  feature:  "feature",
  fix:      "fix",
  hotfix:   "fix",
  perf:     "mejora",
  refactor: "mejora",
  improve:  "mejora",
  mejora:   "mejora",
  chore:    null, // ignorar
  ci:       null,
  docs:     null,
  test:     null,
  style:    null,
  build:    null,
};

function parseCommitMessage(raw) {
  const msg = String(raw || "").trim();

  // Ignorar commits de CI / novedades automáticas
  if (/\[skip ci\]/i.test(msg) || /actualizar novedades/i.test(msg)) {
    return null;
  }

  // Formato convencional: "tipo(scope): titulo" o "tipo: titulo"
  const match = msg.match(/^([a-z]+)(?:\([^)]*\))?[!]?:\s*(.+)/i);
  if (match) {
    const prefix = match[1].toLowerCase();
    const titulo = match[2].trim();
    const tipo = TIPO_MAP[prefix];
    if (tipo === null) return null; // ignorar explícitamente
    return { tipo: tipo || "mejora", titulo };
  }

  // Sin prefijo convencional → tratar como mejora genérica
  return { tipo: "mejora", titulo: msg.slice(0, 120) };
}

async function autoSyncNovedadesFromDeploy() {
  const sha = String(process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
  const rawMsg = String(process.env.VERCEL_GIT_COMMIT_MESSAGE || "").trim();
  const author = String(process.env.VERCEL_GIT_COMMIT_AUTHOR_NAME || "Sistema").trim();

  if (!sha || !rawMsg) return;

  const shortSha = sha.slice(0, 8);
  const parsed = parseCommitMessage(rawMsg);
  if (!parsed) return;

  try {
    if (isOperationalPgEnabled()) {
      const pg = getOperationalPool();

      // Verificar si ya existe esta entrada
      const { rows } = await pg.query(
        `SELECT id FROM novedades WHERE referencia_sha = $1 LIMIT 1`,
        [shortSha]
      );
      if (rows.length) return;

      await pg.query(
        `INSERT INTO novedades (tipo, titulo, descripcion, autor_nombre, referencia_sha)
         VALUES ($1, $2, $3, $4, $5)`,
        [parsed.tipo, parsed.titulo, rawMsg, author, shortSha]
      );
      console.log(`[FMN] Novedad auto-registrada: ${parsed.tipo} — ${parsed.titulo}`);
    }
  } catch (err) {
    // No bloquear el arranque si falla
    console.warn("[FMN] No se pudo auto-registrar novedad:", err.message);
  }
}

module.exports = { autoSyncNovedadesFromDeploy };
