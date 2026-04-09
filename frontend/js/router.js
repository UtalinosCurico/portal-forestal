import state from "./state.js";
import { renderDashboard } from "./views.dashboard.js";
import { renderSolicitudes } from "./views.solicitudes.js";
import { renderInventario } from "./views.inventario.js";
import { renderEquipos } from "./views.equipos.js";
import { renderUsuarios } from "./views.usuarios.js";
import { renderReportes } from "./views.reportes.js";
import { renderPowerBI } from "./views.powerbi.js";

const ROLES = {
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  JEFE: "Jefe de faena",
  OPERADOR: "Operador",
};

const views = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Visión general operacional",
    allowedRoles: [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE, ROLES.OPERADOR],
    render: renderDashboard,
  },
  solicitudes: {
    title: "Solicitudes",
    subtitle: "Trazabilidad de repuestos y materiales",
    allowedRoles: [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE, ROLES.OPERADOR],
    render: renderSolicitudes,
  },
  inventario: {
    title: "Inventario",
    subtitle: "Stock bodega central y faenas",
    allowedRoles: [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE],
    render: renderInventario,
  },
  equipos: {
    title: "Equipos",
    subtitle: "Administración de equipos por faena",
    allowedRoles: [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE, ROLES.OPERADOR],
    render: renderEquipos,
  },
  usuarios: {
    title: "Usuarios",
    subtitle: "Gestión de usuarios y roles",
    allowedRoles: [ROLES.ADMIN, ROLES.SUPERVISOR],
    render: renderUsuarios,
  },
  reportes: {
    title: "Reportes",
    subtitle: "Indicadores operacionales base",
    allowedRoles: [ROLES.ADMIN, ROLES.SUPERVISOR, ROLES.JEFE, ROLES.OPERADOR],
    render: renderReportes,
  },
  powerbi: {
    title: "Power BI",
    subtitle: "Módulo preparado para embed",
    allowedRoles: [ROLES.ADMIN, ROLES.SUPERVISOR],
    render: renderPowerBI,
  },
};

function isAllowed(viewName) {
  const view = views[viewName];
  if (!view || !state.user) {
    return false;
  }
  return view.allowedRoles.includes(state.user.role);
}

export function syncMenuByRole() {
  const buttons = [...document.querySelectorAll("#menu-nav button")];
  for (const button of buttons) {
    const viewName = button.dataset.view;
    button.classList.toggle("hidden", !isAllowed(viewName));
  }
}

export async function navigate(viewName) {
  const target = views[viewName];
  if (!target || !isAllowed(viewName)) {
    return;
  }

  state.currentView = viewName;
  document.getElementById("view-title").textContent = target.title;
  document.getElementById("view-subtitle").textContent = target.subtitle;

  const buttons = [...document.querySelectorAll("#menu-nav button")];
  for (const button of buttons) {
    button.classList.toggle("active", button.dataset.view === viewName);
  }

  const root = document.getElementById("view-root");
  await target.render(root, state);
}

export function bindNavigation() {
  const menu = document.getElementById("menu-nav");
  menu.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) {
      return;
    }
    await navigate(button.dataset.view);
  });
}

export function getDefaultView() {
  if (!state.user) {
    return "dashboard";
  }
  const role = state.user.role;
  if (role === ROLES.OPERADOR) {
    return "solicitudes";
  }
  if (role === ROLES.JEFE) {
    return "solicitudes";
  }
  return "dashboard";
}

