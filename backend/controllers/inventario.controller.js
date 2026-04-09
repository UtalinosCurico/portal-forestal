const inventarioService = require("../services/inventario.service");

async function list(req, res, next) {
  try {
    const data = await inventarioService.listInventario(req.user, req.query);
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const data = await inventarioService.createRepuesto(req.user, req.body);
    res.apiSuccess(data, 201);
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const data = await inventarioService.updateRepuesto(req.user, Number(req.params.id), req.body);
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

async function registerMovement(req, res, next) {
  try {
    const data = await inventarioService.registerMovement(req.user, req.body);
    res.apiSuccess(data, 201);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list,
  create,
  update,
  registerMovement,
};

