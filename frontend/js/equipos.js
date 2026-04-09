function renderEquipos(rows, bodyEl) {
  if (!rows.length) {
    bodyEl.innerHTML = "<tr><td colspan='2'>Sin equipos</td></tr>";
    return;
  }

  bodyEl.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.id}</td>
        <td>${row.nombre_equipo}</td>
      </tr>
    `
    )
    .join("");
}

function getStockClass(estado) {
  if (estado === "ROJO") {
    return "stock-badge stock-rojo";
  }
  if (estado === "AMARILLO") {
    return "stock-badge stock-amarillo";
  }
  return "stock-badge stock-verde";
}

function groupByTeam(rows) {
  const map = new Map();
  for (const row of rows) {
    const team = row.nombre_equipo || "Sin equipo";
    if (!map.has(team)) {
      map.set(team, []);
    }
    map.get(team).push(row);
  }
  return map;
}

function renderStockGroups(rows, container, formatDate) {
  if (!rows.length) {
    container.innerHTML = "<p>Sin stock por equipo para mostrar</p>";
    return;
  }

  const groups = groupByTeam(rows);
  container.innerHTML = Array.from(groups.entries())
    .map(([teamName, items]) => {
      const rowsHtml = items
        .map((item) => {
          const badgeClass = getStockClass(item.estado_stock);
          return `
            <tr>
              <td>${item.repuesto_codigo}</td>
              <td>${item.repuesto}</td>
              <td>${item.stock}</td>
              <td><span class='${badgeClass}'>${item.estado_stock}</span></td>
              <td>${formatDate(item.ultima_actualizacion)}</td>
            </tr>
          `;
        })
        .join("");

      return `
        <article class='team-group-card'>
          <h5 class='team-group-title'>${teamName}</h5>
          <div class='table-wrap'>
            <table>
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Repuesto</th>
                  <th>Stock</th>
                  <th>Estado</th>
                  <th>Ultima actualizacion</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");
}

function buildStockOption(item) {
  return `${item.nombre_equipo} | ${item.repuesto_codigo} - ${item.repuesto} (stock: ${item.stock})`;
}

function fillStockForm(item) {
  document.getElementById("equipo-stock-team").value = item.nombre_equipo || "";
  document.getElementById("equipo-stock-code").value = item.repuesto_codigo || "";
  document.getElementById("equipo-stock-name").value = item.repuesto || "";
  document.getElementById("equipo-stock-current").value = String(item.stock ?? 0);
  document.getElementById("equipo-stock-next").value = String(item.stock ?? 0);
}

export async function initEquiposView(context) {
  const userRole = context.state.user.role;
  const isAdmin = userRole === "ADMIN";
  const canEditStock = ["ADMIN", "SUPERVISOR", "JEFE_FAENA"].includes(userRole);

  const adminSection = document.getElementById("equipos-admin-section");
  const stockEditSection = document.getElementById("equipo-stock-edit-section");
  const stockModal = document.getElementById("equipo-stock-modal");
  const openStockModalBtn = document.getElementById("equipo-open-stock-modal");
  const closeStockModalBtn = document.getElementById("equipo-stock-close");
  const cancelStockModalBtn = document.getElementById("equipo-stock-cancel");
  const stockEditForm = document.getElementById("equipo-stock-edit-form");
  const stockSelect = document.getElementById("equipo-stock-select");

  const createForm = document.getElementById("equipos-create-form");
  const updateForm = document.getElementById("equipos-update-form");
  const equiposBody = document.getElementById("equipos-table-body");
  const stockGroups = document.getElementById("equipo-stock-groups");

  let stockCache = [];

  if (!isAdmin) {
    adminSection.classList.add("hidden");
  }

  if (!canEditStock) {
    stockEditSection.classList.add("hidden");
  }

  function openStockModal() {
    stockModal.classList.remove("hidden");
  }

  function closeStockModal() {
    stockModal.classList.add("hidden");
  }

  function syncStockSelect() {
    if (!canEditStock) {
      return;
    }

    if (!stockCache.length) {
      stockSelect.innerHTML = "<option value=''>Sin registros</option>";
      stockEditForm.querySelector("button[type='submit']").disabled = true;
      openStockModalBtn.disabled = true;
      return;
    }

    stockSelect.innerHTML = stockCache
      .map((item) => `<option value='${item.id}'>${buildStockOption(item)}</option>`)
      .join("");

    stockEditForm.querySelector("button[type='submit']").disabled = false;
    openStockModalBtn.disabled = false;
    fillStockForm(stockCache[0]);
  }

  async function loadData() {
    const [equiposPayload, stockPayload] = await Promise.all([
      context.apiRequest("/api/equipos"),
      context.apiRequest("/api/equipos/stock"),
    ]);

    const equipos = equiposPayload.data || [];
    stockCache = stockPayload.data || [];

    renderEquipos(equipos, equiposBody);
    renderStockGroups(stockCache, stockGroups, context.formatDate);
    syncStockSelect();
  }

  if (isAdmin) {
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(createForm);
      const nombre = String(formData.get("nombre_equipo") || "").trim();

      if (!nombre) {
        context.showToast("Debes indicar nombre de equipo", true);
        return;
      }

      try {
        await context.apiRequest("/api/equipos", {
          method: "POST",
          body: { nombre_equipo: nombre },
        });
        createForm.reset();
        await loadData();
        context.showToast("Equipo creado");
      } catch (error) {
        context.showToast(error.message, true);
      }
    });

    updateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(updateForm);
      const id = Number(formData.get("id"));
      const nombre = String(formData.get("nombre_equipo") || "").trim();

      if (!id || !nombre) {
        context.showToast("Debes indicar ID y nombre", true);
        return;
      }

      try {
        await context.apiRequest(`/api/equipos/${id}`, {
          method: "PUT",
          body: { nombre_equipo: nombre },
        });
        updateForm.reset();
        await loadData();
        context.showToast("Equipo actualizado");
      } catch (error) {
        context.showToast(error.message, true);
      }
    });
  }

  if (canEditStock) {
    openStockModalBtn.addEventListener("click", () => {
      if (!stockCache.length) {
        context.showToast("No hay registros para ajustar", true);
        return;
      }
      openStockModal();
    });
    closeStockModalBtn.addEventListener("click", closeStockModal);
    cancelStockModalBtn.addEventListener("click", closeStockModal);
    stockModal.addEventListener("click", (event) => {
      if (event.target.matches(".modal-backdrop") || event.target.dataset.close === "true") {
        closeStockModal();
      }
    });

    stockSelect.addEventListener("change", () => {
      const selectedId = Number(stockSelect.value);
      const selectedItem = stockCache.find((item) => Number(item.id) === selectedId);
      if (selectedItem) {
        fillStockForm(selectedItem);
      }
    });

    stockEditForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const selectedId = Number(stockSelect.value);
      const newStock = Number(document.getElementById("equipo-stock-next").value);

      if (!Number.isInteger(selectedId) || selectedId <= 0) {
        context.showToast("Debes seleccionar un registro de stock", true);
        return;
      }

      if (!Number.isInteger(newStock) || newStock < 0) {
        context.showToast("El nuevo stock debe ser un entero mayor o igual a 0", true);
        return;
      }

      try {
        await context.apiRequest(`/api/equipos/stock/${selectedId}`, {
          method: "PUT",
          body: { stock: newStock },
        });
        closeStockModal();
        await loadData();
        context.showToast("Stock actualizado");
      } catch (error) {
        context.showToast(error.message, true);
      }
    });
  }

  await loadData();
}
