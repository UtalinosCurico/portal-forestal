const usuarioService = require("../services/usuario.service");

async function list(req, res, next) {
  try {
    const data = await usuarioService.listUsers(req.user, req.query);
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const data = await usuarioService.createUser(req.user, req.body);
    res.apiSuccess(data, 201);
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const data = await usuarioService.updateUser(req.user, Number(req.params.id), req.body);
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list,
  create,
  update,
};

