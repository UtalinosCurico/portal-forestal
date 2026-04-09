import state, { clearSession, loadSession, saveSession } from "./state.js";
import { apiRequest } from "./api.js";

export async function bootstrapSession() {
  loadSession();
  if (!state.tokens.accessToken) {
    return false;
  }
  try {
    const me = await apiRequest("/auth/me");
    state.user = me;
    saveSession({
      user: me,
      accessToken: state.tokens.accessToken,
      refreshToken: state.tokens.refreshToken,
    });
    return true;
  } catch (error) {
    clearSession();
    return false;
  }
}

export async function login(email, password) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  saveSession({
    user: data.user,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
  return data.user;
}

export async function logout() {
  try {
    if (state.tokens.refreshToken) {
      await apiRequest("/auth/logout", {
        method: "POST",
        body: { refreshToken: state.tokens.refreshToken },
      });
    }
  } finally {
    clearSession();
  }
}

