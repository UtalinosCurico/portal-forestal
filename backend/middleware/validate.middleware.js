const { AppError } = require("../utils/errors");

function validate(schemaFn) {
  return (req, res, next) => {
    try {
      schemaFn(req);
      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }
      next(new AppError(error.message, 400, "VALIDATION_ERROR"));
    }
  };
}

module.exports = {
  validate,
};

