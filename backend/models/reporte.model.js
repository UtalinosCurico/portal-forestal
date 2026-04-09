const { query } = require("../database/db");

async function getResumenByRole(user) {
  const params = [];
  const filters = [];

  if (user.role === "Jefe de faena") {
    params.push(user.faenaId);
    filters.push(`faena_id = $${params.length}`);
  } else if (user.role === "Operador") {
    params.push(user.id);
    filters.push(`solicitante_id = $${params.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const solicitudesPorEstado = await query(
    `
      SELECT estado, COUNT(*)::INT AS total
      FROM solicitudes
      ${where}
      GROUP BY estado
      ORDER BY estado ASC
    `,
    params
  );

  const totalSolicitudes = await query(
    `
      SELECT COUNT(*)::INT AS total
      FROM solicitudes
      ${where}
    `,
    params
  );

  const movimientosHoy = await query(
    `
      SELECT COUNT(*)::INT AS total
      FROM inventario_movimientos
      WHERE created_at::date = NOW()::date
    `
  );

  return {
    totalSolicitudes: totalSolicitudes.rows[0].total,
    solicitudesPorEstado: solicitudesPorEstado.rows,
    movimientosHoy: movimientosHoy.rows[0].total,
  };
}

module.exports = {
  getResumenByRole,
};

