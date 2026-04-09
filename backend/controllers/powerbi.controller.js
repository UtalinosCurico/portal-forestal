const powerbiService = require("../services/powerbi.service");

async function getConfig(req, res, next) {
  try {
    const data = await powerbiService.getConfig(req.user);
    res.apiSuccess(data);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getConfig,
};

