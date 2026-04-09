const authService = require("../services/auth.service");

async function login(req, res, next) {
  try {
    const data = await authService.login(req.body);
    res.apiSuccess(data, 200);
  } catch (error) {
    next(error);
  }
}

async function refresh(req, res, next) {
  try {
    const data = await authService.refresh(req.body);
    res.apiSuccess(data, 200);
  } catch (error) {
    next(error);
  }
}

async function logout(req, res, next) {
  try {
    await authService.logout(req.body);
    res.apiSuccess({ message: "Sesión cerrada" }, 200);
  } catch (error) {
    next(error);
  }
}

async function me(req, res, next) {
  try {
    const data = await authService.me(req.user.id);
    res.apiSuccess(data, 200);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  login,
  refresh,
  logout,
  me,
};

