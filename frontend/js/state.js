const STORAGE_KEY = "portal_forestal_session";

const state = {
  user: null,
  tokens: {
    accessToken: null,
    refreshToken: null,
  },
  currentView: "dashboard",
};

export function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw);
    state.user = saved.user || null;
    state.tokens = saved.tokens || { accessToken: null, refreshToken: null };
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function saveSession({ user, accessToken, refreshToken }) {
  state.user = user;
  state.tokens = { accessToken, refreshToken };
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      user: state.user,
      tokens: state.tokens,
    })
  );
}

export function updateAccessToken(accessToken) {
  state.tokens.accessToken = accessToken;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      user: state.user,
      tokens: state.tokens,
    })
  );
}

export function clearSession() {
  state.user = null;
  state.tokens = { accessToken: null, refreshToken: null };
  localStorage.removeItem(STORAGE_KEY);
}

export default state;

