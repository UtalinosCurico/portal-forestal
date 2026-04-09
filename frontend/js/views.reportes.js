import { apiRequest } from "./api.js";

export async function renderReportes(root) {
  root.innerHTML = `
    <div class="grid">
      <section class="card full">
        <h3>Resumen operacional</h3>
        <pre id="report-json">Cargando...</pre>
      </section>
    </div>
  `;

  try {
    const data = await apiRequest("/reportes/resumen");
    document.getElementById("report-json").textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    document.getElementById("report-json").textContent = `Error: ${error.message}`;
  }
}

