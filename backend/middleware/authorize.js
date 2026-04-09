const { HttpError } = require("../utils/httpError");

function getRole(user) {
  return user?.rol || user?.role || null;
}

function authorize(...allowedRoles) {
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

module.exports = {
  authorize,
};
