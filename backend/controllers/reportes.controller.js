const reporteService = require("../services/reporte.service");

async function resumen(req, res, next) {
  try {
    const data = await reporteService.getResumen(req.user);
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  resumen,
};

