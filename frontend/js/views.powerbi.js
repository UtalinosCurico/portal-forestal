import { apiRequest } from "./api.js";

export async function renderPowerBI(root) {
  root.innerHTML = `
    <div class="grid">
      <section class="card full">
        <h3>Power BI Embed (preparado)</h3>
        <p>
          Este módulo está listo para usar `iframe` o SDK de Power BI cuando se habiliten
          credenciales y token embebido desde backend.
        </p>
        <pre id="powerbi-config">Cargando configuración...</pre>
      </section>
      <section class="card full">
        <h3>Ejemplo de iframe futuro</h3>
        <code>&lt;iframe src="https://app.powerbi.com/reportEmbed?reportId=..." /&gt;</code>
      </section>
    </div>
  `;

  try {
    const config = await apiRequest("/powerbi/config");
    document.getElementById("powerbi-config").textContent = JSON.stringify(config, null, 2);
  } catch (error) {
    document.getElementById("powerbi-config").textContent = `Error: ${error.message}`;
  }
}

