/**
 * Obtiene commits nuevos via GitHub API y los agrega a backend/data/changelog.json
 * Se ejecuta automáticamente via GitHub Actions en cada push a main.
 * Requiere: GH_PAT secret + GITHUB_REPOSITORY env var (auto-set en Actions)
 */
const fs = require("fs");
const path = require("path");

const CHANGELOG_PATH = path.join(__dirname, "../backend/data/changelog.json");

// Prefijos de commit a ignorar (internos, sin valor para el usuario final)
const SKIP_RE = /^(chore|docs|test|ci|style|wip|refactor\(deps\)|build)(\(.+\))?!?:/i;

// Líneas a eliminar del cuerpo del commit
const STRIP_BODY_RE = /^(Co-Authored-By:|Co-authored-by:|Signed-off-by:)/i;

const TYPE_MAP = {
  feat: "feature", feature: "feature",
  fix: "fix", bugfix: "fix", hotfix: "fix",
  refactor: "mejora", perf: "mejora", improve: "mejora",
  update: "mejora", mejora: "mejora", enhancement: "mejora",
};

function readChangelog() {
  try {
    return JSON.parse(fs.readFileSync(CHANGELOG_PATH, "utf8"));
  } catch {
    return { lastCommit: null, entries: [] };
  }
}

function parseCommit(sha, fullMessage, author, date) {
  const lines = fullMessage.split("\n");
  const subject = lines[0].trim();

  if (SKIP_RE.test(subject)) return null;

  // Extraer cuerpo: líneas después del subject, sin líneas vacías iniciales ni Co-Authored-By
  const bodyLines = lines
    .slice(1)
    .filter((l) => !STRIP_BODY_RE.test(l.trim()))
    .join("\n")
    .trim();

  const match = subject.match(/^(\w+)(\(.+\))?!?:\s*(.+)/);
  let tipo = "feature";
  let titulo = subject.trim();

  if (match) {
    tipo = TYPE_MAP[match[1].toLowerCase()] || "feature";
    titulo = match[3].trim();
  }

  titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  titulo = titulo.replace(/^[^\w\s¡¿áéíóúñÁÉÍÓÚÑ]+\s*/, "").trim() || subject.trim();

  const entry = {
    id: sha.slice(0, 8),
    tipo,
    titulo,
    autor_nombre: author || "Equipo FMN",
    created_at: new Date(date).toISOString(),
  };

  if (bodyLines) {
    entry.descripcion = bodyLines.slice(0, 400);
  }

  return entry;
}

async function fetchCommits(repo, token) {
  const url = `https://api.github.com/repos/${repo}/commits?sha=main&per_page=50`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Portal-FMN-Bot",
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────
const token = process.env.GH_PAT || process.env.GITHUB_TOKEN;
const repo  = process.env.GITHUB_REPOSITORY;

if (!token || !repo) {
  console.log("Sin token o GITHUB_REPOSITORY. Saliendo.");
  process.exit(0);
}

const changelog  = readChangelog();
const existingIds = new Set((changelog.entries || []).map((e) => e.id));

(async () => {
  try {
    const commits = await fetchCommits(repo, token);

    if (!commits.length) {
      console.log("Sin commits desde la API.");
      process.exit(0);
    }

    const newEntries = [];

    for (const c of commits) {
      // Parar al llegar al último commit ya registrado
      if (changelog.lastCommit && c.sha === changelog.lastCommit) break;
      if (existingIds.has(c.sha.slice(0, 8))) break;

      const message = c.commit?.message || "";
      const author  = c.commit?.author?.name || c.author?.login || "Equipo FMN";
      const date    = c.commit?.author?.date || new Date().toISOString();

      const entry = parseCommit(c.sha, message, author, date);
      if (entry) newEntries.push(entry);
    }

    // Actualizar lastCommit con el más reciente (primer elemento de la API)
    const latestSha = commits[0].sha;

    if (!newEntries.length) {
      if (latestSha !== changelog.lastCommit) {
        changelog.lastCommit = latestSha;
        fs.writeFileSync(CHANGELOG_PATH, JSON.stringify(changelog, null, 2) + "\n");
      }
      console.log("Sin entradas nuevas para el changelog.");
      process.exit(0);
    }

    // La API devuelve más recientes primero — agregar al principio tal cual
    changelog.entries = [...newEntries, ...(changelog.entries || [])].slice(0, 200);
    changelog.lastCommit = latestSha;

    fs.mkdirSync(path.dirname(CHANGELOG_PATH), { recursive: true });
    fs.writeFileSync(CHANGELOG_PATH, JSON.stringify(changelog, null, 2) + "\n");
    console.log(`✅ ${newEntries.length} entrada(s) agregada(s) al changelog.`);
  } catch (err) {
    console.error("Error actualizando changelog:", err.message);
    process.exit(1);
  }
})();
