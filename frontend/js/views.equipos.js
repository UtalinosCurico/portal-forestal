import { apiRequest } from "./api.js";

function canEdit(role) {
  return role === "Administrador" || role === "Supervisor";
}

export async function renderEquipos(root, state) {
  const formBlock = canEdit(state.user.role)
    ? `
      <section class="card full">
        <h3>Crear equipo</h3>
        <form id="form-equipo" class="form-two">
          <div><label>Código</label><input name="codigo" required /></div>
          <div><label>Nombre</label><input name="nombre" required /></div>
          <div><label>Faena ID</label><input name="faenaId" type="number" required /></div>
          <button class="full" type="submit">Guardar equipo</button>
        </form>
      </section>
    `
    : "";

  root.innerHTML = `
    <div class="grid">
      ${formBlock}
      <section class="card full">
        <button id="btn-refresh-equipos">Recargar equipos</button>
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Faena</th>
              <th>Activo</th>
            </tr>
          </thead>
          <tbody id="equipos-body"></tbody>
        </table>
      </section>
    </div>
  `;

  const tbody = document.getElementById("equipos-body");
  const btnRefresh = document.getElementById("btn-refresh-equipos");
  const form = document.getElementById("form-equipo");

  async function loadEquipos() {
    const rows = await apiRequest("/equipos");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty">Sin equipos</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td>${row.codigo}</td>
          <td>${row.nombre}</td>
          <td>${row.faena_nombre}</td>
          <td>${row.activo ? "Sí" : "No"}</td>
        </tr>
      `
      )
      .join("");
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      try {
        await apiRequest("/equipos", {
          method: "POST",
          body: {
            codigo: data.get("codigo"),
            nombre: data.get("nombre"),
            faenaId: Number(data.get("faenaId")),
          },
        });
        form.reset();
        window.showToast("Equipo creado");
        await loadEquipos();
      } catch (error) {
        window.showToast(error.message, true);
      }
    });
  }

  btnRefresh.addEventListener("click", loadEquipos);
  await loadEquipos();
}

