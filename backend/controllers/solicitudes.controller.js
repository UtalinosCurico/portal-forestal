const solicitudService = require("../services/solicitud.service");

async function list(req, res, next) {
  try {
    const data = await solicitudService.listSolicitudes(req.user, req.query);
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

async function getById(req, res, next) {
  try {
    const data = await solicitudService.getSolicitud(req.user, Number(req.params.id));
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    const data = await solicitudService.createSolicitud(req.user, req.body);
    res.apiSuccess(data, 201);
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const data = await solicitudService.updateSolicitud(req.user, Number(req.params.id), req.body);
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

async function historial(req, res, next) {
  try {
    const data = await solicitudService.getHistorial(req.user, Number(req.params.id));
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  list,
  getById,
  create,
  update,
  historial,
};

