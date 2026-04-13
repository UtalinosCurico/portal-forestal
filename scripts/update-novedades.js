/**
 * Lee los commits nuevos de git y los agrega a backend/data/changelog.json
 * Se ejecuta automáticamente via GitHub Actions en cada push a main.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const CHANGELOG_PATH = path.join(__dirname, "../backend/data/changelog.json");

// Prefijos de commit a ignorar (cambios internos sin valor para el usuario)
const SKIP_RE = /^(chore|docs|test|ci|style|wip|refactor\(deps\)|build)(\(.+\))?!?:/i;

// Mapeo de tipo de commit convencional → tipo de novedad
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

function parseCommit(hash, subject, author, date) {
  if (SKIP_RE.test(subject)) return null;

  const match = subject.match(/^(\w+)(\(.+\))?!?:\s*(.+)/);
  let tipo = "feature";
  let titulo = subject.trim();

  if (match) {
    tipo = TYPE_MAP[match[1].toLowerCase()] || "feature";
    titulo = match[3].trim();
  }

  // Capitalizar primera letra
  titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  // Limpiar emojis repetidos o caracteres especiales al inicio
  titulo = titulo.replace(/^[^\w\s¡¿áéíóúñÁÉÍÓÚÑ]+\s*/, "").trim() || subject.trim();

  return {
    id: hash.slice(0, 8),
    tipo,
    titulo,
    autor_nombre: author || "Equipo FMN",
    created_at: new Date(date).toISOString(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const changelog = readChangelog();

const range = changelog.lastCommit
  ? `${changelog.lastCommit}..HEAD`
  : "--max-count=30";

let logOutput = "";
try {
  logOutput = execSync(
    `git log ${range} --format="%H|%s|%an|%ci" --no-merges`,
    { encoding: "utf8" }
  ).trim();
} catch {
  console.log("No se pudo leer el log de git.");
  process.exit(0);
}

if (!logOutput) {
  console.log("Sin commits nuevos.");
  process.exit(0);
}

const lines = logOutput.split("\n").filter(Boolean).reverse(); // más antiguos primero
const newEntries = [];
let lastHash = changelog.lastCommit;

for (const line of lines) {
  const [hash, subject, author, date] = line.split("|");
  if (!hash || !subject) continue;

  lastHash = hash;
  const entry = parseCommit(hash, subject, author, date);
  if (entry) newEntries.push(entry);
}

if (!newEntries.length) {
  // Actualizar lastCommit aunque no haya entradas nuevas visibles
  if (lastHash && lastHash !== changelog.lastCommit) {
    changelog.lastCommit = lastHash;
    fs.mkdirSync(path.dirname(CHANGELOG_PATH), { recursive: true });
    fs.writeFileSync(CHANGELOG_PATH, JSON.stringify(changelog, null, 2) + "\n");
  }
  console.log("Sin entradas nuevas para el changelog.");
  process.exit(0);
}

// Agregar al principio (más recientes primero)
changelog.entries = [...newEntries.reverse(), ...(changelog.entries || [])].slice(0, 200);
changelog.lastCommit = lastHash;

fs.mkdirSync(path.dirname(CHANGELOG_PATH), { recursive: true });
fs.writeFileSync(CHANGELOG_PATH, JSON.stringify(changelog, null, 2) + "\n");
console.log(`✅ ${newEntries.length} entrada(s) agregada(s) al changelog.`);
