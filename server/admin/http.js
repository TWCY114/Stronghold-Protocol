// server/admin/http.js — the admin backend HTTP surface (P2). Every /api/admin/* call requires a bearer token whose
// account role is 'admin' (the login fork's accounts; seeded by seed-admin.mjs). The /admin page is external JS/CSS under
// public/admin/ (CSP script-src 'self'). Hooked into server/http/routes.js beside the auth surface.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../http/config.js';
import { sendJson, sendError } from '../http/common.js';
import { getAuth } from '../auth/index.js';
import { hashPassword } from '../auth/auth.js';
import { getAdmin } from './index.js';

const MAX_BODY = 8192;
const USERNAME_RE = /^[\w一-龥]{2,16}$/u;

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { resolve(null); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
function bearer(req, parts) {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
  if (parts?.query) return new URLSearchParams(parts.query).get('token') || '';
  return '';
}
function notify(session, msg) {
  try { if (session.connected && session.ws) session.ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
}

let adminHtml = null;
function serveAdmin(res) {
  if (adminHtml == null) {
    try { adminHtml = readFileSync(join(ROOT, 'public', 'admin', 'index.html'), 'utf8'); }
    catch { adminHtml = '<!doctype html><meta charset="utf-8"><title>管理后台</title><p>后台页缺失（public/admin/index.html）。</p>'; }
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(adminHtml);
}

function handles(rawPath) {
  return rawPath === '/admin' || rawPath === '/admin/' || rawPath.startsWith('/api/admin/');
}

// ---- privileged actions ---------------------------------------------------------------------------------------------
function adminKick({ lobby, registry }, playerId) {
  const session = registry.byId(playerId);
  if (!session) return { ok: false, error: 'no_player' };
  const room = session.roomCode ? lobby.getRoom(session.roomCode) : null;
  if (room) {
    lobby.removeMember(room, playerId);
    notify(session, { t: 'room.closed', reason: 'kicked' });
  }
  return { ok: true, name: session.name, room: room?.code || null };
}
function adminEndRoom({ lobby }, code) {
  const room = lobby.getRoom(code);
  if (!room) return { ok: false, error: 'no_room' };
  lobby.disposeRoom(room, 'admin');   // ends the match, clears the relay, tells every member room.closed {reason:'admin'}
  return { ok: true, code: room.code };
}

async function handle(req, res, parts) {
  const path = parts.rawPath;
  if (path === '/admin' || path === '/admin/') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendError(req, res, 405, 'Method not allowed'); return true; }
    serveAdmin(res);
    return true;
  }

  // role gate: a valid account token with role 'admin'
  const v = getAuth().verifyToken(bearer(req, parts));
  if (!v.ok || v.kind !== 'account' || v.account?.role !== 'admin') {
    sendJson(req, res, 403, { ok: false, error: 'forbidden' });
    return true;
  }
  const admin = getAdmin();
  if (!admin) { sendJson(req, res, 503, { ok: false, error: 'not_ready' }); return true; }
  const store = getAuth().store;

  if (req.method === 'GET') {
    if (path === '/api/admin/stats') {
      const s = admin.lobby.stats();
      sendJson(req, res, 200, { ok: true, current: { online: admin.network.onlineCount, ...s }, history: admin.history, sampleMs: admin.sampleMs });
      return true;
    }
    if (path === '/api/admin/players') {
      const players = [];
      for (const s of admin.registry.byPlayerId.values()) {
        players.push({ playerId: s.playerId, name: s.name, connected: !!s.connected, roomCode: s.roomCode || null,
          role: s.role || null, accountId: s.accountId ?? null, addr: s.addr || null, lastSeen: s.lastSeen || null });
      }
      sendJson(req, res, 200, { ok: true, players });
      return true;
    }
    if (path === '/api/admin/rooms') {
      const rooms = [];
      for (const r of admin.lobby.rooms.values()) {
        rooms.push({ code: r.code, hostId: r.hostId, match: !!r.match, mode: r.mode || null,
          seats: r.seats.filter(Boolean).map((s) => ({ name: s.name, playerId: s.playerId, isBot: !!s.isBot, left: !!s.left })),
          spectators: r.spectators.length });
      }
      sendJson(req, res, 200, { ok: true, rooms });
      return true;
    }
    if (path === '/api/admin/accounts') {
      sendJson(req, res, 200, { ok: true, accounts: store.listAccounts() });
      return true;
    }
    sendError(req, res, 404, 'Not found');
    return true;
  }

  if (req.method !== 'POST') { sendError(req, res, 405, 'Method not allowed'); return true; }
  const body = await readBody(req);
  if (!body || typeof body !== 'object') { sendJson(req, res, 400, { ok: false, error: 'bad_body' }); return true; }

  if (path === '/api/admin/kick') { sendJson(req, res, 200, adminKick(admin, String(body.playerId || ''))); return true; }
  if (path === '/api/admin/end-room') { sendJson(req, res, 200, adminEndRoom(admin, String(body.code || ''))); return true; }

  if (path === '/api/admin/accounts') {
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    if (!USERNAME_RE.test(username)) { sendJson(req, res, 400, { ok: false, error: 'bad_username' }); return true; }
    if (password.length < 6 || password.length > 64) { sendJson(req, res, 400, { ok: false, error: 'bad_password' }); return true; }
    if (store.accountByName(username)) { sendJson(req, res, 400, { ok: false, error: 'taken' }); return true; }
    const role = body.role === 'admin' ? 'admin' : 'user';
    const a = store.createAccount(username, hashPassword(password), role);
    sendJson(req, res, 200, { ok: true, account: { id: a.id, username: a.username, role: a.role } });
    return true;
  }

  if (path === '/api/admin/account') {
    const id = Number(body.id);
    const acc = store.accountById(id);
    if (!acc) { sendJson(req, res, 400, { ok: false, error: 'no_account' }); return true; }
    const action = String(body.action || '');
    if (action === 'disable') { store.setDisabled(id, 1); store.revokeAccountTokens(id); }
    else if (action === 'enable') { store.setDisabled(id, 0); }
    else if (action === 'role') { store.setRole(id, body.role === 'admin' ? 'admin' : 'user'); }
    else if (action === 'reset-password') {
      const pw = String(body.password ?? '');
      if (pw.length < 6 || pw.length > 64) { sendJson(req, res, 400, { ok: false, error: 'bad_password' }); return true; }
      store.setPassword(id, hashPassword(pw)); store.revokeAccountTokens(id);
    }
    else if (action === 'delete') { store.deleteAccount(id); }
    else { sendJson(req, res, 400, { ok: false, error: 'bad_action' }); return true; }
    sendJson(req, res, 200, { ok: true });
    return true;
  }

  sendError(req, res, 404, 'Not found');
  return true;
}

export const adminHttp = { handles, handle };
