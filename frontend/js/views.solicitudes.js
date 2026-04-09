import { apiRequest } from "./api.js";

function formatDate(dateValue) {
  if (!dateValue) {
    return "-";
  }
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Santiago",
  }).format(new Date(dateValue));
}

function parseItems(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [repuestoId, cantidad] = line.split(",").map((x) => x.trim());
      return { repuestoId: Number(repuestoId), cantidad: Number(cantidad) };
    });
}

function canChangeStatus(role) {
  return role === "Administrador" || role === "Supervisor";
}

export async function renderSolicitudes(root, state) {
  root.innerHTML = `
    <div class="grid">
      <section class="card full">
        <h3>Nueva solicitud</h3>
        <form id="form-solicitud" class="form-two">
          <div>
            <label>Equipo (ID)</label>
            <input name="equipoId" type="number" placeholder="Opcional" />
          </div>
          <div>
            <label>Faena (ID, solo supervisor/admin)</label>
            <input name="faenaId" type="number" placeholder="Opcional" />
          </div>
          <div class="full">
            <label>Comentario</label>
            <textarea name="comentario" rows="2" placeholder="Comentario opcional"></textarea>
          </div>
          <div class="full">
            <label>Ítems (una línea por ítem: repuestoId,cantidad)</label>
            <textarea name="itemsText" rows="4" placeholder="1,3&#10;5,2"></textarea>
          </div>
          <button type="submit" class="full">Registrar solicitud</button>
        </form>
      </section>

      <section class="card full">
        <div class="toolbar">
          <input id="filter-estado" placeholder="Filtrar estado (ej: pendiente)" />
          <button id="btn-filtrar">Filtrar</button>
          <button id="btn-recargar">Recargar</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Folio</th>
              <th>Estado</th>
              <th>Solicitante</th>
              <th>Faena</th>
              <th>Creación</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="solicitudes-body"></tbody>
        </table>
      </section>
    </div>
  `;

  const form = document.getElementById("form-solicitud");
  const tbody = document.getElementById("solicitudes-body");
  const filterInput = document.getElementById("filter-estado");
  const btnFiltrar = document.getElementById("btn-filtrar");
  const btnRecargar = document.getElementById("btn-recargar");

  async function loadList() {
    const estado = filterInput.value.trim();
    const list = await apiRequest(`/solicitudes${estado ? `?estado=${encodeURIComponent(estado)}` : ""}`);
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty">No hay solicitudes</td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map((row) => {
        const actionCell = canChangeStatus(state.user.role)
          ? `
            <select data-id="${row.id}" class="estado-select">
              <option value="">Cambiar...</option>
              <option value="en revisión">en revisión</option>
              <option value="aprobado">aprobado</option>
              <option value="en despacho">en despacho</option>
              <option value="entregado">entregado</option>
              <option value="rechazado">rechazado</option>
            </select>
          `
          : `<button data-id="${row.id}" class="btn-historial">Historial</button>`;

        return `
          <tr>
            <td>${row.folio}</td>
            <td><span class="status-pill">${row.estado}</span></td>
            <td>${row.solicitante_nombre}</td>
            <td>${row.faena_nombre}</td>
            <td>${formatDate(row.created_at)}</td>
            <td>${actionCell}</td>
          </tr>
        `;
      })
      .join("");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const items = parseItems(data.get("itemsText"));
    if (!items.length) {
      window.showToast("Debe ingresar al menos un ítem", true);
      return;
    }

    try {
      await apiRequest("/solicitudes", {
        method: "POST",
        body: {
          equipoId: data.get("equipoId") ? Number(data.get("equipoId")) : undefined,
          faenaId: data.get("faenaId") ? Number(data.get("faenaId")) : undefined,
          comentario: data.get("comentario"),
          items,
        },
      });
      form.reset();
      window.showToast("Solicitud creada");
      await loadList();
    } catch (error) {
      window.showToast(error.message, true);
    }
  });

  tbody.addEventListener("change", async (event) => {
    const select = event.target.closest(".estado-select");
    if (!select || !select.value) {
      return;
    }
    try {
      await apiRequest(`/solicitudes/${select.dataset.id}`, {
        method: "PUT",
        body: { estado: select.value, comentario: `Cambio por ${state.user.nombre}` },
      });
      window.showToast("Estado actualizado");
      await loadList();
    } catch (error) {
      window.showToast(error.message, true);
    }
  });

  tbody.addEventListener("click", async (event) => {
    const button = event.target.closest(".btn-historial");
    if (!button) {
      return;
    }
    try {
      const history = await apiRequest(`/solicitudes/${button.dataset.id}/historial`);
      const detail = history
        .map((row) => `${formatDate(row.fecha)} | ${row.actor} | ${row.estadoNuevo}`)
        .join("\n");
      alert(detail || "Sin historial");
    } catch (error) {
      window.showToast(error.message, true);
    }
  });

  btnFiltrar.addEventListener("click", loadList);
  btnRecargar.addEventListener("click", async () => {
    filterInput.value = "";
    await loadList();
  });

  await loadList();
}

