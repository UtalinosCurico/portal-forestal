const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const env = require("../config/env");
const { AppError } = require("../utils/errors");
const { query } = require("../database/db");
const userModel = require("../models/user.model");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function signAccessToken(user) {
  return jwt.sign(
    {
      role: user.role_name,
      faenaId: user.faena_id,
    },
    env.jwtSecret,
    {
      subject: String(user.id),
      expiresIn: env.jwtExpiresIn,
    }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    {
      type: "refresh",
    },
    env.jwtRefreshSecret,
    {
      subject: String(user.id),
      expiresIn: env.jwtRefreshExpiresIn,
    }
  );
}

async function saveRefreshToken(userId, refreshToken) {
  const payload = jwt.verify(refreshToken, env.jwtRefreshSecret);
  const tokenHash = hashToken(refreshToken);
  await query(
    `
      INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, to_timestamp($3))
    `,
    [userId, tokenHash, payload.exp]
  );
}

async function login({ email, password }) {
  const user = await userModel.findByEmail(email);
  if (!user || !user.activo) {
    throw new AppError("Credenciales inválidas", 401, "INVALID_CREDENTIALS");
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError("Credenciales inválidas", 401, "INVALID_CREDENTIALS");
  }

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  await saveRefreshToken(user.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      role: user.role_name,
      faenaId: user.faena_id,
      faenaNombre: user.faena_nombre,
    },
  };
}

async function refresh({ refreshToken }) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.jwtRefreshSecret);
  } catch (error) {
    throw new AppError("Refresh token inválido o expirado", 401, "INVALID_TOKEN");
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await query(
    `
      SELECT id, user_id
      FROM refresh_tokens
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
    `,
    [tokenHash]
  );
  if (stored.rowCount === 0) {
    throw new AppError("Refresh token revocado o no reconocido", 401, "INVALID_TOKEN");
  }

  const user = await userModel.findById(payload.sub);
  if (!user || !user.activo) {
    throw new AppError("Usuario no autorizado", 401, "UNAUTHORIZED");
  }

  const newAccessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);

  await query(
    `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE id = $1
    `,
    [stored.rows[0].id]
  );
  await saveRefreshToken(user.id, newRefreshToken);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

async function logout({ refreshToken }) {
  if (!refreshToken) {
    return;
  }
  const tokenHash = hashToken(refreshToken);
  await query(
    `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL
    `,
    [tokenHash]
  );
}

async function me(userId) {
  const user = await userModel.findById(userId);
  if (!user) {
    throw new AppError("Usuario no encontrado", 404, "NOT_FOUND");
  }
  return {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    role: user.role_name,
    faenaId: user.faena_id,
    faenaNombre: user.faena_nombre,
    activo: user.activo,
  };
}

module.exports = {
  login,
  refresh,
  logout,
  me,
  __private: {
    hashToken,
    signAccessToken,
    signRefreshToken,
  },
};
