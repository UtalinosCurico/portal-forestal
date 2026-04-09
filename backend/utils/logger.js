function format(level, message, meta) {
  const payload = {
    level,
    message,
    ...(meta ? { meta } : {}),
    at: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

const logger = {
  info(message, meta) {
    // eslint-disable-next-line no-console
    console.log(format("info", message, meta));
  },
  warn(message, meta) {
    // eslint-disable-next-line no-console
    console.warn(format("warn", message, meta));
  },
  error(message, meta) {
    // eslint-disable-next-line no-console
    console.error(format("error", message, meta));
  },
  http(message, meta) {
    // eslint-disable-next-line no-console
    console.log(format("http", message, meta));
  },
};

module.exports = logger;

