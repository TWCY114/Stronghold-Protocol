// public/js/auth/gate.js — the login fork's client gate (P1). Runs at the very start of boot(): without a valid account
// or guest token the player is sent to the standalone /login page ("未登录" is enforced here and at the /ws upgrade).
// The token lives in localStorage under sp_token; the WS URL carries it (net.js defaultWsUrl) so the server can gate the
// upgrade. A stale/expired token is cleared and the player returned to /login.

const KEY = 'sp_token';

/** The stored bearer token (account or guest), or null. */
export function getToken() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
/** Store a token after login/register/guest. */
export function setToken(token) {
  try { localStorage.setItem(KEY, token); } catch { /* private mode */ }
}
/** Forget the token (logout). */
export function clearToken() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Gate the boot: true when a valid token is present, else redirect to /login and return false.
 * Validates against /api/auth/me so an expired token does not leave the player stuck on a dead socket.
 */
export async function requireLogin() {
  const token = getToken();
  if (!token) { location.replace('/login'); return false; }
  try {
    const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (j && j.ok) return true;
  } catch { /* network hiccup: fall through to re-login */ }
  clearToken();
  location.replace('/login');
  return false;
}
