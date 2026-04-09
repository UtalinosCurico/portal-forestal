function attachAuditContext(req, res, next) {
  req.auditContext = {
    actorId: req.user?.id || null,
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
  };
  next();
}

module.exports = {
  attachAuditContext,
};

