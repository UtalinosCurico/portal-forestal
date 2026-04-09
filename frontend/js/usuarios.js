function roleNeedsEquipo(rol) {
  return ["JEFE_FAENA", "MECANICO", "OPERADOR"].includes(String(rol || "").trim().toUpperCase());
}

function normalizeEmailValue(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEquipoOptions(equipos, includeEmpty = true) {
  const options = [];
  if (includeEmpty) {
    options.push("<option value=''>Sin team</option>");
  }

  for (const equipo of equipos) {
    options.push(`<option value='${equipo.id}'>${escapeHtml(equipo.nombre_equipo)}</option>`);
  }

  return options.join("");
}

function getStatusMeta(user) {
  if (user.archivado) {
    return { label: "Archivado", className: "status-archivado" };
  }

  if (user.activo) {
    return { label: "Activo", className: "status-aprobado" };
  }

  return { label: "Inactivo", className: "status-rechazado" };
}

function getFilterLabel(filterName) {
  return {
    activos: "activos",
    inactivos: "inactivos",
    archivados: "archivados",
    todos: "totales",
  }[filterName] || "activos";
}

function canEditUser(sessionRole, user) {
  if (user.archivado) {
    return false;
  }

  if (sessionRole === "ADMIN") {
    return true;
  }

  return sessionRole === "SUPERVISOR" && user.rol !== "ADMIN";
}

function canToggleUser(sessionRole, user) {
  return canEditUser(sessionRole, user);
}

function canArchiveUser(sessionRole, user, currentUserId) {
  if (!["ADMIN", "SUPERVISOR"].includes(sessionRole)) {
    return false;
  }

  if (user.archivado) {
    return false;
  }

  if (sessionRole === "SUPERVISOR" && user.rol === "ADMIN") {
    return false;
  }

  return Number(user.id) !== Number(currentUserId);
}

function canResetPassword(sessionRole, user) {
  if (user.archivado) {
    return false;
  }

  if (sessionRole === "ADMIN") {
    return true;
  }

  return sessionRole === "SUPERVISOR" && user.rol !== "ADMIN";
}

function renderActionButtons({ sessionRole, currentUserId, user, mutationLocked }) {
  if (mutationLocked) {
    return "<span class='table-subline'>Bloqueado por seguridad</span>";
  }

  const actions = [];

  if (canEditUser(sessionRole, user)) {
    actions.push(`<button class="table-btn" data-action="edit" data-id="${user.id}">Editar</button>`);
  }

  if (canResetPassword(sessionRole, user)) {
    actions.push(
      `<button class="table-btn secondary" data-action="reset-password" data-id="${user.id}">Clave</button>`
    );
  }

  if (canToggleUser(sessionRole, user)) {
    actions.push(`
      <button class="table-btn secondary" data-action="toggle" data-id="${user.id}">
        ${user.activo ? "Desactivar" : "Activar"}
      </button>
    `);
  }

  if (canArchiveUser(sessionRole, user, currentUserId)) {
    actions.push(`<button class="table-btn danger" data-action="archive" data-id="${user.id}">Archivar</button>`);
  }

  if (!actions.length) {
    if (sessionRole === "SUPERVISOR" && user.rol === "ADMIN") {
      return "<span class='table-subline'>Cuenta ADMIN protegida</span>";
    }

    return "<span class='table-subline'>Sin acciones</span>";
  }

  return `<div class="table-action-group">${actions.join("")}</div>`;
}

function renderUsuariosRows(rows, options) {
  const { sessionRole, currentUserId, bodyEl, formatDate, mutationLocked } = options;

  if (!rows.length) {
    bodyEl.innerHTML = "<tr><td colspan='8'>Sin usuarios para este filtro</td></tr>";
    return;
  }

  bodyEl.innerHTML = rows
    .map((user) => {
      const status = getStatusMeta(user);
      const teamLabel = user.equipo_nombre || "-";

      return `
        <tr>
          <td>${user.id}</td>
          <td>
            <strong>${escapeHtml(user.nombre)}</strong>
            ${user.archivado ? "<div class='table-subline'>Solo visible por trazabilidad</div>" : ""}
          </td>
          <td>${escapeHtml(user.email)}</td>
          <td>${escapeHtml(user.rol)}</td>
          <td>${escapeHtml(teamLabel)}</td>
          <td><span class="status-badge ${status.className}">${status.label}</span></td>
          <td>${formatDate(user.fecha_creacion)}</td>
          <td>${renderActionButtons({ sessionRole, currentUserId, user, mutationLocked })}</td>
        </tr>
      `;
    })
    .join("");
}

export async function initUsuariosView(context) {
  const sessionRole = context.state.user.role;
  const currentUserId = Number(context.state.user.id);
  const isAdmin = sessionRole === "ADMIN";
  const canManageUsers = ["ADMIN", "SUPERVISOR"].includes(sessionRole);
  const canAssignAdminRole = sessionRole === "ADMIN";
  const storageWarningCard = document.getElementById("usuarios-storage-warning");
  const storageWarningText = document.getElementById("usuarios-storage-warning-text");

  const createSection = document.getElementById("usuarios-create-section");
  const createOpenBtn = document.getElementById("usuarios-open-create-modal");
  const createModal = document.getElementById("usuarios-create-modal");
  const createForm = document.getElementById("usuarios-create-form");
  const createResetBtn = document.getElementById("usuarios-create-reset");
  const createCancelBtn = document.getElementById("usuarios-create-cancel");
  const createCloseBtn = document.getElementById("usuarios-create-close");
  const createRoleSelect = document.getElementById("user-rol");
  const createEmailInput = document.getElementById("user-email");
  const createEquipoSelect = document.getElementById("user-equipo");
  const createEquipoHelp = document.getElementById("user-equipo-help");
  const createActiveInput = document.getElementById("user-activo");

  const searchInput = document.getElementById("usuarios-search-input");
  const roleFilterSelect = document.getElementById("usuarios-role-filter");
  const filterGroup = document.getElementById("usuarios-filter-group");
  const filterSummary = document.getElementById("usuarios-filter-summary");
  const refreshBtn = document.getElementById("usuarios-refresh-btn");
  const tableBody = document.getElementById("usuarios-table-body");

  const editModal = document.getElementById("usuarios-edit-modal");
  const editForm = document.getElementById("usuarios-edit-form");
  const editCaption = document.getElementById("usuarios-edit-caption");
  const editRoleGroup = document.getElementById("edit-user-rol-group");
  const editPasswordGroup = document.getElementById("edit-user-password-group");
  const editRoleSelect = document.getElementById("edit-user-rol");
  const editEmailInput = document.getElementById("edit-user-email");
  const editEquipoSelect = document.getElementById("edit-user-equipo");
  const editEquipoHelp = document.getElementById("edit-user-equipo-help");
  const cancelEditBtn = document.getElementById("edit-user-cancel");
  const closeEditBtn = document.getElementById("edit-user-close");

  const passwordModal = document.getElementById("usuarios-password-modal");
  const passwordForm = document.getElementById("usuarios-password-form");
  const passwordCaption = document.getElementById("usuarios-password-caption");
  const passwordUserName = document.getElementById("password-user-name");
  const passwordUserId = document.getElementById("password-user-id");
  const passwordValue = document.getElementById("password-user-value");
  const passwordConfirm = document.getElementById("password-user-confirm");
  const passwordCancelBtn = document.getElementById("password-user-cancel");
  const passwordCloseBtn = document.getElementById("password-user-close");

  let usuariosCache = [];
  let equiposCache = [];
  let currentFilter = "activos";
  let currentSearch = "";
  let currentRoleFilter = "";
  let currentEditingUser = null;
  let passwordTargetUser = null;
  let searchDebounceTimer = null;
  let storageState = {
    lockUserMutations: false,
    message: "",
  };

  function configureRoleSelectForSession(selectElement) {
    if (!selectElement) {
      return;
    }

    const adminOption = selectElement.querySelector("option[value='ADMIN']");
    if (!adminOption) {
      return;
    }

    adminOption.disabled = !canAssignAdminRole;
    adminOption.hidden = !canAssignAdminRole;
    if (!canAssignAdminRole && selectElement.value === "ADMIN") {
      selectElement.value = "SUPERVISOR";
    }
  }

  function applyStorageGuard(nextStorageState = null) {
    storageState = {
      ...storageState,
      ...(nextStorageState || {}),
      lockUserMutations: Boolean(nextStorageState?.lockUserMutations),
    };

    if (storageWarningCard) {
      const shouldShowWarning = storageState.lockUserMutations;
      storageWarningCard.classList.toggle("hidden", !shouldShowWarning);
      if (shouldShowWarning) {
        storageWarningText.textContent = storageState.message;
      }
    }

    if (createSection) {
      createSection.classList.toggle("hidden", !canManageUsers || storageState.lockUserMutations);
    }
  }

  function assertUserMutationsAvailable() {
    if (storageState.lockUserMutations) {
      throw new Error(
        storageState.message ||
          "Administracion de usuarios bloqueada por seguridad en este entorno."
      );
    }
  }

  applyStorageGuard();

  function updateFilterButtons() {
    filterGroup.querySelectorAll("[data-estado]").forEach((button) => {
      button.classList.toggle("active", button.dataset.estado === currentFilter);
    });
  }

  function updateFilterSummary() {
    const count = usuariosCache.length;
    const label = getFilterLabel(currentFilter);
    const fragments = [`${count} usuario(s) ${label}`];

    if (currentRoleFilter) {
      fragments.push(`rol: ${currentRoleFilter}`);
    }

    if (currentSearch) {
      fragments.push(`busqueda: ${currentSearch}`);
    }

    filterSummary.textContent = fragments.join(" | ");
  }

  function openEditModal() {
    editModal.classList.remove("hidden");
  }

  function openCreateModal() {
    createModal.classList.remove("hidden");
  }

  function closeCreateModal() {
    createModal.classList.add("hidden");
    createForm.reset();
    createRoleSelect.value = "OPERADOR";
    createActiveInput.checked = true;
    syncCreateEquipoState();
  }

  function closeEditModal() {
    editModal.classList.add("hidden");
    editForm.reset();
    currentEditingUser = null;
  }

  function openPasswordModal() {
    passwordModal.classList.remove("hidden");
  }

  function closePasswordModal() {
    passwordModal.classList.add("hidden");
    passwordForm.reset();
    passwordTargetUser = null;
  }

  function syncCreateEquipoState() {
    if (!canManageUsers) {
      return;
    }

    const role = createRoleSelect.value;
    const requiresEquipo = roleNeedsEquipo(role);
    createEquipoSelect.disabled = !requiresEquipo;
    if (!requiresEquipo) {
      createEquipoSelect.value = "";
      createEquipoHelp.textContent = "ADMIN y SUPERVISOR no usan team asignado.";
      return;
    }

    createEquipoHelp.textContent = "Obligatorio para JEFE_FAENA, MECANICO y OPERADOR.";
  }

  function syncEditEquipoState() {
    if (!currentEditingUser) {
      return;
    }

    const effectiveRole =
      isAdmin || sessionRole === "SUPERVISOR" ? editRoleSelect.value : currentEditingUser.rol;
    const requiresEquipo = roleNeedsEquipo(effectiveRole);

    editEquipoSelect.disabled = !requiresEquipo;
    if (!requiresEquipo) {
      editEquipoSelect.value = "";
      editEquipoHelp.textContent = "Este rol no usa team.";
      return;
    }

    editEquipoHelp.textContent = "Selecciona el team que usara esta cuenta.";
  }

  function configureEditModal(user) {
    currentEditingUser = user;
    document.getElementById("edit-user-id").value = String(user.id);
    document.getElementById("edit-user-nombre").value = user.nombre;
    editEmailInput.value = normalizeEmailValue(user.email);
    document.getElementById("edit-user-password").value = "";
    document.getElementById("edit-user-activo").checked = Boolean(user.activo);
    editRoleSelect.value = user.rol;
    editEquipoSelect.value = user.equipo_id || "";

    if (canManageUsers) {
      editRoleGroup.classList.remove("hidden");
      editPasswordGroup.classList.toggle("hidden", !isAdmin);
      editRoleSelect.disabled = false;
      configureRoleSelectForSession(editRoleSelect);
      editCaption.textContent =
        user.rol === "ADMIN"
          ? "Estas editando una cuenta ADMIN. El sistema protege que no te quedes sin administradores activos."
          : sessionRole === "SUPERVISOR"
            ? "Puedes cambiar rol, team, estado y usar Clave para restablecer contrasena en usuarios no-admin."
            : "Puedes cambiar rol, team, estado y contrasena.";
    } else {
      editRoleGroup.classList.add("hidden");
      editPasswordGroup.classList.add("hidden");
      editRoleSelect.disabled = true;
      editCaption.textContent =
        "Como supervisor puedes ajustar nombre, correo, team, estado y usar restablecimiento de clave para usuarios no-admin.";
    }

    syncEditEquipoState();
  }

  function configurePasswordModal(user) {
    passwordTargetUser = user;
    passwordUserId.value = String(user.id);
    passwordUserName.value = `${user.nombre} (${user.email})`;
    passwordCaption.textContent =
      sessionRole === "ADMIN"
        ? "Define una nueva contrasena temporal. El usuario podra iniciar con ella de inmediato."
        : "Como supervisor puedes restablecer la clave de usuarios no-admin.";
  }

  function getCreatePayload() {
    const formData = new FormData(createForm);
    const rol = String(formData.get("rol") || "").trim().toUpperCase();
    const equipoId = String(formData.get("equipo_id") || "").trim();
    const payload = {
      nombre: String(formData.get("nombre") || "").trim(),
      email: normalizeEmailValue(formData.get("user_email")),
      password: String(formData.get("user_password") || ""),
      rol,
      activo: createActiveInput.checked,
    };

    if (!payload.nombre) {
      throw new Error("Debes ingresar el nombre del usuario");
    }

    if (!payload.email) {
      throw new Error("Debes ingresar un email valido");
    }

    if (!payload.password) {
      throw new Error("Debes ingresar una contrasena inicial");
    }

    if (roleNeedsEquipo(rol)) {
      if (!equipoId) {
        throw new Error("Este rol requiere team asignado");
      }
      payload.equipo_id = Number(equipoId);
    } else {
      payload.equipo_id = null;
    }

    return payload;
  }

  function getEditPayload() {
    if (!currentEditingUser) {
      throw new Error("No hay usuario seleccionado");
    }

    const formData = new FormData(editForm);
    const effectiveRole = canManageUsers
      ? String(formData.get("rol") || "").trim().toUpperCase()
      : currentEditingUser.rol;
    const equipoId = String(formData.get("equipo_id") || "").trim();
    const payload = {
      nombre: String(formData.get("nombre") || "").trim(),
      email: normalizeEmailValue(formData.get("user_email")),
      activo: document.getElementById("edit-user-activo").checked,
    };

    if (!payload.nombre) {
      throw new Error("Debes ingresar el nombre del usuario");
    }

    if (!payload.email) {
      throw new Error("Debes ingresar un email valido");
    }

    if (canManageUsers) {
      payload.rol = effectiveRole;
      const password = String(formData.get("user_password") || "");
      if (isAdmin && password) {
        payload.password = password;
      }
    }

    if (roleNeedsEquipo(effectiveRole)) {
      if (!equipoId) {
        throw new Error("Este rol requiere team asignado");
      }
      payload.equipo_id = Number(equipoId);
    } else {
      payload.equipo_id = null;
    }

    return payload;
  }

  async function loadEquipos() {
    const payload = await context.apiRequest("/api/equipos");
    equiposCache = payload.data || [];
    const options = buildEquipoOptions(equiposCache, true);
    createEquipoSelect.innerHTML = options;
    editEquipoSelect.innerHTML = options;
    syncCreateEquipoState();
    syncEditEquipoState();
  }

  async function loadUsuarios() {
    const query = new URLSearchParams();
    query.set("estado", currentFilter);
    if (currentSearch) {
      query.set("q", currentSearch);
    }
    if (currentRoleFilter) {
      query.set("rol", currentRoleFilter);
    }

    const payload = await context.apiRequest(`/api/usuarios?${query.toString()}`);
    applyStorageGuard(payload.storage || null);
    usuariosCache = payload.data || [];
    renderUsuariosRows(usuariosCache, {
      sessionRole,
      currentUserId,
      bodyEl: tableBody,
      formatDate: context.formatDate,
      mutationLocked: storageState.lockUserMutations,
    });
    updateFilterButtons();
    updateFilterSummary();
  }

  if (canManageUsers) {
    configureRoleSelectForSession(createRoleSelect);
    createRoleSelect.value = "OPERADOR";
    syncCreateEquipoState();

    createOpenBtn.addEventListener("click", () => {
      try {
        assertUserMutationsAvailable();
        openCreateModal();
      } catch (error) {
        context.showToast(error.message, true);
      }
    });

    createRoleSelect.addEventListener("change", () => {
      configureRoleSelectForSession(createRoleSelect);
      syncCreateEquipoState();
    });
    createEmailInput.addEventListener("blur", () => {
      createEmailInput.value = normalizeEmailValue(createEmailInput.value);
    });

    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      try {
        assertUserMutationsAvailable();
        const payload = getCreatePayload();
        const response = await context.apiRequest("/api/usuarios", {
          method: "POST",
          body: payload,
        });

        currentFilter = payload.activo ? "activos" : "inactivos";
        closeCreateModal();
        await loadUsuarios();
        context.showToast(`Usuario creado: ${response.data.email}`);
      } catch (error) {
        context.showToast(error.message, true);
      }
    });

    createResetBtn.addEventListener("click", () => {
      createForm.reset();
      configureRoleSelectForSession(createRoleSelect);
      createRoleSelect.value = "OPERADOR";
      createActiveInput.checked = true;
      syncCreateEquipoState();
    });
    createCancelBtn.addEventListener("click", closeCreateModal);
    createCloseBtn.addEventListener("click", closeCreateModal);
    createModal.addEventListener("click", (event) => {
      if (event.target.matches(".modal-backdrop") || event.target.dataset.close === "true") {
        closeCreateModal();
      }
    });
  }

  configureRoleSelectForSession(createRoleSelect);
  configureRoleSelectForSession(editRoleSelect);

  editRoleSelect.addEventListener("change", syncEditEquipoState);
  editEmailInput.addEventListener("blur", () => {
    editEmailInput.value = normalizeEmailValue(editEmailInput.value);
  });

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      assertUserMutationsAvailable();
      const userId = Number(document.getElementById("edit-user-id").value || 0);
      const payload = getEditPayload();
      await context.apiRequest(`/api/usuarios/${userId}`, {
        method: "PUT",
        body: payload,
      });
      closeEditModal();
      await loadUsuarios();
      context.showToast("Usuario actualizado correctamente");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      assertUserMutationsAvailable();
      if (!passwordTargetUser) {
        throw new Error("No hay usuario seleccionado");
      }

      const password = String(passwordValue.value || "");
      const passwordRepeat = String(passwordConfirm.value || "");
      if (!password.trim()) {
        throw new Error("Debes ingresar una nueva contrasena");
      }
      if (password !== passwordRepeat) {
        throw new Error("La confirmacion de contrasena no coincide");
      }

      await context.apiRequest(`/api/usuarios/${passwordTargetUser.id}/reset-password`, {
        method: "POST",
        body: { password },
      });

      closePasswordModal();
      context.showToast("Contrasena restablecida correctamente");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  cancelEditBtn.addEventListener("click", closeEditModal);
  closeEditBtn.addEventListener("click", closeEditModal);
  editModal.addEventListener("click", (event) => {
    if (event.target.matches(".modal-backdrop") || event.target.dataset.close === "true") {
      closeEditModal();
    }
  });

  passwordCancelBtn.addEventListener("click", closePasswordModal);
  passwordCloseBtn.addEventListener("click", closePasswordModal);
  passwordModal.addEventListener("click", (event) => {
    if (event.target.matches(".modal-backdrop") || event.target.dataset.close === "true") {
      closePasswordModal();
    }
  });

  refreshBtn.addEventListener("click", async () => {
    try {
      await loadUsuarios();
      context.showToast("Usuarios recargados");
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  filterGroup.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-estado]");
    if (!button || button.dataset.estado === currentFilter) {
      return;
    }

    currentFilter = button.dataset.estado;

    try {
      await loadUsuarios();
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  roleFilterSelect.addEventListener("change", async () => {
    currentRoleFilter = roleFilterSelect.value;
    try {
      await loadUsuarios();
    } catch (error) {
      context.showToast(error.message, true);
    }
  });

  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = window.setTimeout(async () => {
      currentSearch = String(searchInput.value || "").trim();
      try {
        await loadUsuarios();
      } catch (error) {
        context.showToast(error.message, true);
      }
    }, 280);
  });

  tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const userId = Number(button.dataset.id || 0);
    const user = usuariosCache.find((item) => Number(item.id) === userId);
    if (!user) {
      return;
    }

    if (action === "edit") {
      if (storageState.lockUserMutations) {
        context.showToast(storageState.message, true);
        return;
      }
      configureEditModal(user);
      openEditModal();
      return;
    }

    if (action === "reset-password") {
      if (storageState.lockUserMutations) {
        context.showToast(storageState.message, true);
        return;
      }
      configurePasswordModal(user);
      openPasswordModal();
      return;
    }

    if (action === "toggle") {
      const nextState = !user.activo;
      const confirmMessage = nextState
        ? `Activar a ${user.nombre} y permitir inicio de sesion?`
        : `Desactivar a ${user.nombre}? Seguira visible pero no podra iniciar sesion.`;

      if (!window.confirm(confirmMessage)) {
        return;
      }

      try {
        assertUserMutationsAvailable();
        await context.apiRequest(`/api/usuarios/${user.id}`, {
          method: "PUT",
          body: {
            activo: nextState,
          },
        });
        await loadUsuarios();
        context.showToast(`Usuario ${nextState ? "activado" : "desactivado"}`);
      } catch (error) {
        context.showToast(error.message, true);
      }
      return;
    }

    if (action === "archive") {
      if (!window.confirm(`Archivar a ${user.nombre}? Quedara fuera de la operacion y no podra iniciar sesion.`)) {
        return;
      }

      try {
        assertUserMutationsAvailable();
        await context.apiRequest(`/api/usuarios/${user.id}`, {
          method: "DELETE",
        });
        await loadUsuarios();
        context.showToast("Usuario archivado correctamente");
      } catch (error) {
        context.showToast(error.message, true);
      }
    }
  });

  await loadEquipos();
  await loadUsuarios();
}
