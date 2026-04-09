import state, { clearSession, saveSession, updateAccessToken } from "./state.js";

const API_BASE = "/api";

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  return response.json();
}

async function refreshAccessToken() {
  const refreshToken = state.tokens.refreshToken;
  if (!refreshToken) {
    throw new Error("No hay refresh token");
  }

  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  const payload = await parseResponse(response);
  if (!response.ok || !payload?.data?.accessToken) {
    clearSession();
    throw new Error(payload?.error?.message || "No se pudo refrescar sesión");
  }

  updateAccessToken(payload.data.accessToken);
  saveSession({
    user: state.user,
    accessToken: payload.data.accessToken,
    refreshToken: payload.data.refreshToken,
  });
  return payload.data.accessToken;
}

export async function apiRequest(path, options = {}, retry = true) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.tokens.accessToken) {
    headers.Authorization = `Bearer ${state.tokens.accessToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body:
      options.body && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : options.body,
  });

  const payload = await parseResponse(response);

  if (response.status === 401 && retry && state.tokens.refreshToken) {
    await refreshAccessToken();
    return apiRequest(path, options, false);
  }

  if (!response.ok) {
    throw new Error(payload?.error?.message || "Error inesperado en API");
  }

  return payload?.data;
}
