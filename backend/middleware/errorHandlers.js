function notFoundHandler(req, res, next) {
  const error = new Error(`Ruta no encontrada: ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

function errorHandler(error, req, res, next) {
  const payloadTooLarge =
    error?.status === 413 ||
    error?.statusCode === 413 ||
    error?.type === "entity.too.large";
  const statusCode = payloadTooLarge ? 413 : error.statusCode || 500;
  const isApiRoute = req.originalUrl.startsWith("/api");
  const message = payloadTooLarge
    ? "La imagen es demasiado pesada. Prueba con una captura o foto mas liviana."
    : error.message || "Error interno del servidor";

  if (!isApiRoute) {
    res.status(statusCode).send(message);
    return;
  }

  res.status(statusCode).json({
    status: "error",
    mensaje: message,
    details: error.details || null,
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
