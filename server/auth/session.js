// server/auth/session.js — binds the upgrade-gate principal to a game session and adds the account to `welcome` (P1).
// Hooked into server/net.js: handleConnection copies req.spAccount onto the connection; onHelloMsg calls bindHello once
// the session exists; the welcome object gains welcomeExtra(session). The official reconnect token is untouched — the
// account token only gates the upgrade and identifies who this session belongs to.

import { getChat } from '../chat/index.js';

// One active session per registered account (同个账号只能登陆一次): a new hello for an account closes the previous
// connection with 4001 (CLOSE.REPLACED — the client stops reconnecting and shows "该身份已在其他页面登录"). Guests
// (accountId null) are exempt. 4001 is the stable protocol constant from server/net.js CLOSE.REPLACED (literal here to
// avoid a circular import).
const accountSessions = new Map(); // accountId -> Connection
function enforceSingleSession(conn, accountId) {
  const prev = accountSessions.get(accountId);
  if (prev && prev !== conn) { try { prev.close(4001, 'account logged in elsewhere'); } catch { /* ignore */ } }
  accountSessions.set(accountId, conn);
  if (!conn._spSingleSession && conn.ws && conn.ws.on) {
    conn._spSingleSession = true;
    conn.ws.on('close', () => { if (accountSessions.get(accountId) === conn) accountSessions.delete(accountId); });
  }
}

/**
 * @param {{ spAccount?: object|null }} conn
 * @param {object} session
 */
export function bindHello(conn, session) {
  const p = conn.spAccount;
  if (p && p.kind === 'account' && p.account) {
    session.accountId = p.account.id;
    session.username = p.account.username;
    session.role = p.account.role;
    enforceSingleSession(conn, session.accountId);
  } else if (p && p.kind === 'guest') {
    session.accountId = null;
    session.role = 'guest';
    session.guestName = p.name;
  }
  // Deliver offline private mail after the welcome goes out (next tick), once the client is listening.
  if (session.accountId) setTimeout(() => { try { getChat()?.deliverPending(session); } catch { /* ignore */ } }, 0);
}

/** Extra `welcome` fields describing the signed-in principal (null when auth is off). */
export function welcomeExtra(session) {
  if (session.accountId) return { account: { id: session.accountId, username: session.username, role: session.role } };
  if (session.role === 'guest') return { account: null, guest: true, guestName: session.guestName };
  return null;
}
