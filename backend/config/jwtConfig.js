const JWT_SECRET = process.env.JWT_SECRET || "fmn_dev_jwt_secret_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

module.exports = {
  JWT_SECRET,
  JWT_EXPIRES_IN,
};

