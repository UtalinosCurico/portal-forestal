import { apiRequest } from "./api.js";

export async function renderDashboard(root) {
  root.innerHTML = `
    <div class="grid">
      <article class="card kpi"><h3>Total solicitudes</h3><strong id="kpi-total">-</strong></article>
      <article class="card kpi"><h3>Movimientos hoy</h3><strong id="kpi-movs">-</strong></article>
      <article class="card kpi"><h3>Pendientes</h3><strong id="kpi-pendientes">-</strong></article>
      <article class="card kpi"><h3>Aprobadas</h3><strong id="kpi-aprobadas">-</strong></article>
      <section class="card full">
        <h3>Solicitudes por estado</h3>
        <table>
          <thead>
            <tr><th>Estado</th><th>Total</th></tr>
          </thead>
          <tbody id="dashboard-estados"></tbody>
        </table>
      </section>
    </div>
  `;

  try {
    const resumen = await apiRequest("/reportes/resumen");
    const estados = resumen.solicitudesPorEstado || [];

    document.getElementById("kpi-total").textContent = resumen.totalSolicitudes ?? 0;
    document.getElementById("kpi-movs").textContent = resumen.movimientosHoy ?? 0;
    document.getElementById("kpi-pendientes").textContent =
      estados.find((x) => x.estado === "pendiente")?.total ?? 0;
    document.getElementById("kpi-aprobadas").textContent =
      estados.find((x) => x.estado === "aprobado")?.total ?? 0;

    const tbody = document.getElementById("dashboard-estados");
    if (!estados.length) {
      tbody.innerHTML = `<tr><td colspan="2" class="empty">Sin datos</td></tr>`;
      return;
    }
    tbody.innerHTML = estados
      .map((row) => `<tr><td><span class="status-pill">${row.estado}</span></td><td>${row.total}</td></tr>`)
      .join("");
  } catch (error) {
    root.innerHTML = `<div class="card"><p class="error-text">${error.message}</p></div>`;
  }
}

