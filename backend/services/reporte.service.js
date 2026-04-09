const reporteModel = require("../models/reporte.model");

async function getResumen(actor) {
  return reporteModel.getResumenByRole(actor);
}

module.exports = {
  getResumen,
};

