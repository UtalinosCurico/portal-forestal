import { apiRequest } from "./api.js";

function canEdit(role) {
  return role === "Administrador";
}

function canMovement(role) {
  return role === "Administrador" || role === "Supervisor";
}

export async function renderInventario(root, state) {
  const adminBlock = canEdit(state.user.role)
    ? `
      <section class="card full">
        <h3>Crear repuesto</h3>
        <form id="form-repuesto" class="form-two">
          <div><label>Código</label><input name="codigo" required /></div>
          <div><label>Nombre</label><input name="nombre" required /></div>
          <div><label>Unidad de medida</label><input name="unidadMedida" required /></div>
          <div><label>Stock bodega inicial</label><input name="stockBodega" type="number" min="0" step="0.01" /></div>
          <button type="submit" class="full">Guardar repuesto</button>
        </form>
      </section>
    `
    : "";

  const movementBlock = canMovement(state.user.role)
    ? `
      <section class="card full">
        <h3>Registrar movimiento</h3>
        <form id="form-movimiento" class="form-two">
          <div><label>Repuesto ID</label><input name="repuestoId" type="number" required /></div>
          <div>
            <label>Tipo</label>
            <select name="tipo">
              <option value="ingreso">ingreso</option>
              <option value="ajuste">ajuste</option>
              <option value="traslado">traslado</option>
            </select>
          </div>
          <div><label>Cantidad</label><input name="cantidad" type="number" step="0.01" required /></div>
          <div><label>Faena ID</label><input name="faenaId" type="number" /></div>
          <div class="full"><label>Comentario</label><input name="comentario" /></div>
          <button type="submit" class="full">Registrar movimiento</button>
        </form>
      </section>
    `
    : "";

  root.innerHTML = `
    <div class="grid">
      ${adminBlock}
      ${movementBlock}
      <section class="card full">
        <button id="btn-refresh-inv">Recargar inventario</button>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Unidad</th>
              <th>Stock bodega</th>
              <th>Stock faena</th>
            </tr>
          </thead>
          <tbody id="inventario-body"></tbody>
        </table>
      </section>
    </div>
  `;

  const tbody = document.getElementById("inventario-body");
  const btnRefresh = document.getElementById("btn-refresh-inv");
  const repuestoForm = document.getElementById("form-repuesto");
  const movForm = document.getElementById("form-movimiento");

  async function loadInventario() {
    const rows = await apiRequest("/inventario");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Sin repuestos registrados</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td>${row.codigo}</td>
          <td>${row.nombre}</td>
          <td>${row.unidad_medida}</td>
          <td>${row.stock_bodega_central}</td>
          <td>${row.stock_faena}</td>
        </tr>
      `
      )
      .join("");
  }

  if (repuestoForm) {
    repuestoForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(repuestoForm);
      try {
        await apiRequest("/inventario", {
          method: "POST",
          body: {
            codigo: data.get("codigo"),
            nombre: data.get("nombre"),
            unidadMedida: data.get("unidadMedida"),
            stockBodega: data.get("stockBodega") || 0,
          },
        });
        repuestoForm.reset();
        window.showToast("Repuesto creado");
        await loadInventario();
      } catch (error) {
        window.showToast(error.message, true);
      }
    });
  }

  if (movForm) {
    movForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(movForm);
      try {
        await apiRequest("/inventario/movimientos", {
          method: "POST",
          body: {
            repuestoId: Number(data.get("repuestoId")),
            tipo: data.get("tipo"),
            cantidad: Number(data.get("cantidad")),
            faenaId: data.get("faenaId") ? Number(data.get("faenaId")) : undefined,
            comentario: data.get("comentario"),
          },
        });
        movForm.reset();
        window.showToast("Movimiento registrado");
      } catch (error) {
        window.showToast(error.message, true);
      }
    });
  }

  btnRefresh.addEventListener("click", loadInventario);
  await loadInventario();
}

