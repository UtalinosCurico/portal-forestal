const { query } = require("../database/db");
const { ROLES } = require("../config/roles");
const { AppError } = require("../utils/errors");

async function getConfig(actor) {
  if (![ROLES.ADMINISTRADOR, ROLES.SUPERVISOR].includes(actor.role)) {
    throw new AppError("No autorizado para ver configuración Power BI", 403, "FORBIDDEN");
  }

  const { rows } = await query(
    `
      SELECT
        id,
        workspace_id AS "workspaceId",
        report_id AS "reportId",
        dataset_id AS "datasetId",
        allowed_roles AS "allowedRoles",
        activa AS "activa"
      FROM powerbi_configs
      WHERE activa = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `
  );

  return (
    rows[0] || {
      workspaceId: "workspace-placeholder",
      reportId: "report-placeholder",
      datasetId: "dataset-placeholder",
      allowedRoles: [ROLES.ADMINISTRADOR, ROLES.SUPERVISOR],
      activa: true,
    }
  );
}

module.exports = {
  getConfig,
};

