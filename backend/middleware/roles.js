const { HttpError } = require("../utils/httpError");
const { ROLES, normalizeRole } = require("../config/appRoles");

function getRole(value) {
  if (!value) {
    return null;
  }
  return normalizeRole(value.rol || value.role || value);
}

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      next(new HttpError(401, "Usuario no autenticado"));
      return;
    }

    if (!allowedRoles.includes(getRole(req.user))) {
      next(new HttpError(403, "No tiene permisos para esta accion"));
      return;
    }

    next();
  };
}

function isGlobalRole(role) {
  return [ROLES.ADMIN, ROLES.SUPERVISOR].includes(getRole(role));
}

function requireTeamAssigned(user) {
  if (isGlobalRole(user)) {
    return;
  }
  if (!user.equipo_id) {
    throw new HttpError(403, "Usuario sin equipo asignado");
  }
}

module.exports = {
  requireRoles,
  isGlobalRole,
  requireTeamAssigned,
};
