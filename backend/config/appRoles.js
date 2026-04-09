const ROLES = Object.freeze({
  ADMIN: "ADMIN",
  SUPERVISOR: "SUPERVISOR",
  SECRETARIA: "SUPERVISOR",
  JEFE_FAENA: "JEFE_FAENA",
  MECANICO: "MECANICO",
  OPERADOR: "OPERADOR",
});

const LEGACY_ROLE_ALIASES = Object.freeze({
  SECRETARIA: ROLES.SUPERVISOR,
});

function normalizeRole(value) {
  const role = String(value || "")
    .trim()
    .toUpperCase();

  return LEGACY_ROLE_ALIASES[role] || role;
}

const ROLE_LIST = [...new Set(Object.values(ROLES))];

module.exports = {
  ROLES,
  ROLE_LIST,
  normalizeRole,
};
