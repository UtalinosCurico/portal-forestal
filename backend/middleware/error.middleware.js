const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");

function errorHandler(error, req, res, next) {
  const err = error instanceof AppError ? error : new AppError(error.message);
  logger.error(err.message, { requestId: req.requestId, code: err.code, details: err.details });

  res.status(err.statusCode).json({
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
    },
  });
}

module.exports = {
  errorHandler,
};

