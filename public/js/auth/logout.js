// public/js/auth/logout.js — the fork's logout. Revokes the token server-side (/api/auth/logout), closes the socket
// (net.close stops reconnecting), forgets the local token + entered flag, and returns to the standalone /login page.
// <LogoutButton/> is the trigger (rendered in 设置 by chat/settings.js).
import { net } from '../net.js';
import { getToken, clearToken } from './gate.js';
import { html, Button } from '../ui/components.js';

export async function logout() {
  const t = getToken();
  try { if (t) await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }); } catch { /* offline: still clear locally */ }
  try { net.close(); } catch { /* ignore */ }
  clearToken();
  try { sessionStorage.removeItem('sp.entered'); } catch { /* ignore */ }
  location.replace('/login');
}

export function LogoutButton({ class: cls }) {
  return html`<${Button} variant="secondary" class=${`logout-btn ${cls || ''}`} onClick=${() => logout()}
    title="登出当前账号" data-testid="logout-btn">登出<//>`;
}
