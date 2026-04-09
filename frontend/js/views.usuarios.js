import { apiRequest } from "./api.js";

function canCreate(role) {
  return role === "Administrador";
}

export async function renderUsuarios(root, state) {
  const createBlock = canCreate(state.user.role)
    ? `
      <section class="card full">
        <h3>Crear usuario</h3>
        <form id="form-usuario" class="form-two">
          <div><label>Nombre</label><input name="nombre" required /></div>
          <div><label>Email</label><input name="email" type="email" required /></div>
          <div><label>Contraseña</label><input name="password" type="password" required /></div>
          <div>
            <label>Rol</label>
            <select name="role">
              <option>Administrador</option>
              <option>Supervisor</option>
              <option>Jefe de faena</option>
              <option>Operador</option>
            </select>
          </div>
          <div><label>Faena ID</label><input name="faenaId" type="number" placeholder="Requerido para Jefe/Operador" /></div>
          <button type="submit" class="full">Crear usuario</button>
        </form>
      </section>
    `
    : "";

  root.innerHTML = `
    <div class="grid">
      ${createBlock}
      <section class="card full">
        <button id="btn-refresh-users">Recargar usuarios</button>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Faena</th>
              <th>Activo</th>
            </tr>
          </thead>
          <tbody id="usuarios-body"></tbody>
        </table>
      </section>
    </div>
  `;

  const tbody = document.getElementById("usuarios-body");
  const btnRefresh = document.getElementById("btn-refresh-users");
  const form = document.getElementById("form-usuario");

  async function loadUsers() {
    const users = await apiRequest("/usuarios");
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Sin usuarios</td></tr>`;
      return;
    }
    tbody.innerHTML = users
      .map(
        (user) => `
        <tr>
          <td>${user.nombre}</td>
          <td>${user.email}</td>
          <td>${user.role_name}</td>
          <td>${user.faena_nombre || "-"}</td>
          <td>${user.activo ? "Sí" : "No"}</td>
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
        await apiRequest("/usuarios", {
          method: "POST",
          body: {
            nombre: data.get("nombre"),
            email: data.get("email"),
            password: data.get("password"),
            role: data.get("role"),
            faenaId: data.get("faenaId") ? Number(data.get("faenaId")) : undefined,
          },
        });
        form.reset();
        window.showToast("Usuario creado");
        await loadUsers();
      } catch (error) {
        window.showToast(error.message, true);
      }
    });
  }

  btnRefresh.addEventListener("click", loadUsers);
  await loadUsers();
}

