// server/auth/session.js — binds the upgrade-gate principal to a game session and adds the account to `welcome` (P1).
// Hooked into server/net.js: handleConnection copies req.spAccount onto the connection; onHelloMsg calls bindHello once
// the session exists; the welcome object gains welcomeExtra(session). The official reconnect token is untouched — the
// account token only gates the upgrade and identifies who this session belongs to.

import { getChat } from '../chat/index.js';
import { getAuth } from './index.js';

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
    // [name-sync] the in-game name IS the public profile name (display_name). The login username never becomes the
    // play name; whatever nickname the client sent in `hello` is overridden by the account's current display_name so
    // lobby / room / chat / friends and the 个人主页 always agree.
    const tag = getAuth().store.tagOf(session.accountId);
    if (tag && tag.name) session.name = tag.name;
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

// [name-sync] live rename propagation: the profile rename handler calls applyRename once the store is updated; the
// live session's play name changes and the registered broadcaster (net.js wires it to lobby.onHello) re-broadcasts the
// room so every seat / spectator header picks up the new name immediately. Offline accounts simply return false.
let renameBroadcaster = null;
export function setRenameBroadcaster(fn) { renameBroadcaster = fn; }
export function applyRename(accountId, name) {
  const conn = accountSessions.get(accountId);
  const session = conn && conn.session;
  if (!session || !name) return false;
  session.name = name;
  try { renameBroadcaster && renameBroadcaster(session); } catch { /* ignore */ }
  return true;
}
