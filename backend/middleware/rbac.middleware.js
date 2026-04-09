const { AppError } = require("../utils/errors");

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      next(new AppError("Usuario no autenticado", 401, "UNAUTHORIZED"));
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(new AppError("No tiene permisos para esta acción", 403, "FORBIDDEN"));
      return;
    }
    next();
  };
}

module.exports = {
  authorize,
};

