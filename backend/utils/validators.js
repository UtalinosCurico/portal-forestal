const { AppError } = require("./errors");

function isPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => payload[field] === undefined || payload[field] === null);
  if (missing.length > 0) {
    throw new AppError(
      `Campos obligatorios faltantes: ${missing.join(", ")}`,
      400,
      "VALIDATION_ERROR"
    );
  }
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(email) {
  return normalizeText(email).toLowerCase();
}

module.exports = {
  isPositiveNumber,
  requireFields,
  validateEmail,
  normalizeText,
  normalizeEmail,
};
