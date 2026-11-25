// server/admin/http.js — the admin backend HTTP surface (P2). Every /api/admin/* call requires a bearer token whose
// account role is 'admin' (the login fork's accounts; seeded by seed-admin.mjs). The /admin page is external JS/CSS under
// public/admin/ (CSP script-src 'self'). Hooked into server/http/routes.js beside the auth surface.

import { readFileSync, readdirSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../http/config.js';
import { sendJson, sendError } from '../http/common.js';
import { getAuth } from '../auth/index.js';
import { hashPassword } from '../auth/auth.js';
import { getAdmin } from './index.js';
import { getChat } from '../chat/index.js';
import { matchState, editFunds, editRound } from './matchEdit.js';   // [auth-fork] live-match admin editing
import { installPluginBytes, movePluginAside } from '../plugins/install.js';   // [plugin-admin] upload / unlist

const MAX_BODY = 8192;
const MAX_PLUGIN_BODY = 24 * 1024 * 1024;   // [plugin-admin] base64 zip up to ~18 MB
const USERNAME_RE = /^[\w一-龥]{2,16}$/u;

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { resolve(null); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
function readBodyLarge(req, limit) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { resolve(null); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
// [ban] disable + revoke tokens + force every live socket of the account closed (and out of its room).
function adminBan({ lobby, registry }, id, ban) {
  const store = getAuth().store;
  store.setDisabled(id, ban ? 1 : 0);
  if (ban) store.revokeAccountTokens(id);
  let kicked = 0;
  for (const s of registry.byPlayerId.values()) {
    if (s.accountId !== id) continue;
    if (ban) {
      const room = s.roomCode ? lobby.getRoom(s.roomCode) : null;
      if (room) lobby.removeMember(room, s.playerId);
      notify(s, { t: 'auth.banned' });
      try { s.ws?.close(4003, 'banned'); } catch { /* ignore */ }
      kicked++;
    }
  }
  return { ok: true, banned: !!ban, kicked };
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
    if (path === '/api/admin/match-state') {   // [auth-fork] round/phase + per-seat funds/LP of a running match
      const code = String(new URLSearchParams(parts.query || '').get('code') || '');
      const room = admin.lobby.getRoom(code);
      sendJson(req, res, 200, room ? await matchState(room) : { ok: false, error: 'no_room' });
      return true;
    }
    if (path === '/api/admin/title') {   // [admin-title] this admin's current world-channel 称号
      sendJson(req, res, 200, { ok: true, title: store.adminTitleOf(v.account.id) || '管理' });
      return true;
    }
    if (path === '/api/admin/config') {   // [moderation] switches / rates / SMTP (password masked)
      const auth = store.getConfig('auth', {}) || {};
      const chat = store.getConfig('chat', {}) || {};
      const smtp = store.getConfig('smtp', {}) || {};
      sendJson(req, res, 200, { ok: true, guest: auth.guest !== false, register: auth.register !== false,
        chatEnabled: chat.enabled !== false, rates: chat.rates || {}, smtp: { ...smtp, pass: smtp.pass ? '******' : '' } });
      return true;
    }
    if (path === '/api/admin/mutes') {
      const mutes = store.listMutes().map((m) => { const t = store.tagOf(m.account_id); return { ...m, name: t ? t.tag : ('#' + m.account_id) }; });
      sendJson(req, res, 200, { ok: true, mutes });
      return true;
    }
    if (path === '/api/admin/reports') {
      const status = new URLSearchParams(parts.query || '').get('status') || '';
      const reports = store.listReports(status || undefined).map((r) => {
        const t = store.tagOf(r.target), rp = store.tagOf(r.reporter);
        return { ...r, targetName: t ? t.tag : ('#' + r.target), reporterName: rp ? rp.tag : ('#' + r.reporter) };
      });
      sendJson(req, res, 200, { ok: true, reports });
      return true;
    }
    if (path === '/api/admin/chat-history') {   // [report-review] pull one account's world/room/PM lines
      const id = Number(new URLSearchParams(parts.query || '').get('id'));
      const chat = getChat();
      if (!id || !chat) { sendJson(req, res, 400, { ok: false, error: 'bad_id' }); return true; }
      sendJson(req, res, 200, { ok: true, history: chat.historyOf(id, 100) });
      return true;
    }
    if (path === '/api/admin/plugins') {   // [plugin-admin] installed + unlisted (_removed)
      const dir = admin.pluginsDir;
      const list = [];
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
          let manifest = null; try { manifest = JSON.parse(readFileSync(join(dir, e.name, 'plugin.json'), 'utf8')); } catch { /* ignore */ }
          list.push({ id: e.name, name: manifest?.name || e.name, version: manifest?.version || '', status: 'installed' });
        }
        const rem = join(dir, '_removed');
        if (existsSync(rem)) for (const e of readdirSync(rem, { withFileTypes: true })) {
          if (!e.isDirectory()) continue;
          const id = e.name.replace(/-\d{8,}.*$/, '');
          let manifest = null; try { manifest = JSON.parse(readFileSync(join(rem, e.name, 'plugin.json'), 'utf8')); } catch { /* ignore */ }
          list.push({ id, folder: e.name, name: manifest?.name || id, status: 'removed' });
        }
      } catch { /* ignore */ }
      sendJson(req, res, 200, { ok: true, plugins: list });
      return true;
    }
    sendError(req, res, 404, 'Not found');
    return true;
  }

  if (req.method !== 'POST') { sendError(req, res, 405, 'Method not allowed'); return true; }

  if (path === '/api/admin/plugin-upload') {   // [plugin-admin] base64 zip → install + hot rescan
    const big = await readBodyLarge(req, MAX_PLUGIN_BODY);
    if (!big || typeof big.zip !== 'string') { sendJson(req, res, 400, { ok: false, error: 'bad_body' }); return true; }
    try {
      const r = installPluginBytes(Buffer.from(big.zip, 'base64'), { pluginsDir: admin.pluginsDir, force: true });
      admin.packs?.rescan?.();
      sendJson(req, res, 200, { ok: true, id: r.id });
    } catch (e) { sendJson(req, res, 400, { ok: false, error: String(e?.code || e?.message || 'install_failed').slice(0, 200) }); }
    return true;
  }

  const body = await readBody(req);
  if (!body || typeof body !== 'object') { sendJson(req, res, 400, { ok: false, error: 'bad_body' }); return true; }

  if (path === '/api/admin/kick') { sendJson(req, res, 200, adminKick(admin, String(body.playerId || ''))); return true; }
  if (path === '/api/admin/end-room') { sendJson(req, res, 200, adminEndRoom(admin, String(body.code || ''))); return true; }

  if (path === '/api/admin/match-edit') {   // [auth-fork] set a player's funds or jump the room's round
    const room = admin.lobby.getRoom(String(body.code || ''));
    if (!room) { sendJson(req, res, 200, { ok: false, error: 'no_room' }); return true; }
    const cmd = String(body.cmd || '');
    if (cmd === 'funds') { sendJson(req, res, 200, await editFunds(room, body.playerId, body.amount)); return true; }
    if (cmd === 'round') { sendJson(req, res, 200, await editRound(room, body.round)); return true; }
    sendJson(req, res, 400, { ok: false, error: 'bad_cmd' });
    return true;
  }

  if (path === '/api/admin/title') {   // [admin-title] set this admin's world-channel 称号 (shown as [称号] after [世界])
    const title = String(body.title ?? '').trim().slice(0, 8);
    if (!title) { sendJson(req, res, 400, { ok: false, error: 'bad_title' }); return true; }
    store.setAdminTitle(v.account.id, title);
    sendJson(req, res, 200, { ok: true, title });
    return true;
  }

  if (path === '/api/admin/announce') {   // [announce] 全服紧急公告: one non-blocking marquee pass on every client
    const text = String(body.text ?? '').trim().slice(0, 120);
    if (!text) { sendJson(req, res, 400, { ok: false, error: 'bad_text' }); return true; }
    const size = Math.min(64, Math.max(12, Number(body.size) || 22));
    const speed = Math.min(600, Math.max(40, Number(body.speed) || 160));
    const colorRaw = String(body.color ?? '').trim();
    const color = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colorRaw) ? colorRaw : '#ff5555';
    const chat = getChat();
    if (!chat) { sendJson(req, res, 503, { ok: false, error: 'not_ready' }); return true; }
    const tag = store.tagOf(v.account.id);
    chat.announce({ text, size, color, speed, by: tag ? tag.tag : (v.account.username || 'admin') });
    sendJson(req, res, 200, { ok: true, text, size, color, speed });
    return true;
  }

  if (path === '/api/admin/config') {   // [moderation] guest/register/chat switches + rates + SMTP
    const auth = store.getConfig('auth', {}) || {};
    const chat = store.getConfig('chat', {}) || {};
    if (body.guest !== undefined) auth.guest = !!body.guest;
    if (body.register !== undefined) auth.register = !!body.register;
    if (body.chatEnabled !== undefined) chat.enabled = !!body.chatEnabled;
    if (body.rates && typeof body.rates === 'object') {
      chat.rates = chat.rates || {};
      for (const ch of ['world', 'room', 'pm']) {
        const r = body.rates[ch]; if (!r) continue;
        chat.rates[ch] = { max: Math.min(60, Math.max(1, Number(r.max) || 3)), windowMs: Math.min(60000, Math.max(500, Number(r.windowMs) || 5000)) };
      }
    }
    store.setConfig('auth', auth); store.setConfig('chat', chat);
    if (body.smtp && typeof body.smtp === 'object') {
      const smtp = store.getConfig('smtp', {}) || {};
      for (const k of ['host', 'port', 'user', 'from']) if (body.smtp[k] !== undefined) smtp[k] = String(body.smtp[k]).slice(0, 120);
      if (body.smtp.pass !== undefined && body.smtp.pass !== '******') smtp.pass = String(body.smtp.pass).slice(0, 120);
      smtp.port = Number(smtp.port) || 465;
      store.setConfig('smtp', smtp);
    }
    sendJson(req, res, 200, { ok: true });
    return true;
  }

  if (path === '/api/admin/mute') {   // [mute] scope room/lobby/all; minutes=0 permanent
    const id = Number(body.id); const scope = ['room', 'lobby', 'all'].includes(body.scope) ? body.scope : 'all';
    if (!id || !store.accountById(id)) { sendJson(req, res, 400, { ok: false, error: 'no_account' }); return true; }
    const minutes = Math.max(0, Number(body.minutes) || 0);
    store.addMute(id, scope, minutes ? Date.now() + minutes * 60000 : 0, v.account.id);
    sendJson(req, res, 200, { ok: true, id, scope, minutes });
    return true;
  }
  if (path === '/api/admin/unmute') {
    const id = Number(body.id); if (!id) { sendJson(req, res, 400, { ok: false, error: 'bad_id' }); return true; }
    store.removeMute(id, body.scope || null);
    sendJson(req, res, 200, { ok: true });
    return true;
  }
  if (path === '/api/admin/ban') {   // [ban] disable + force offline + revoke tokens; ban=false unbans
    const id = Number(body.id);
    if (!id || !store.accountById(id)) { sendJson(req, res, 400, { ok: false, error: 'no_account' }); return true; }
    sendJson(req, res, 200, adminBan(admin, id, body.ban !== false));
    return true;
  }
  if (path === '/api/admin/report-action') {   // [report] dismiss / mute / ban a reported player
    const rid = Number(body.id); const rep = store.listReports().find((r) => r.id === rid);
    if (!rep) { sendJson(req, res, 400, { ok: false, error: 'no_report' }); return true; }
    const action = String(body.action || 'dismiss');
    if (action === 'mute') store.addMute(rep.target, ['room', 'lobby', 'all'].includes(body.scope) ? body.scope : 'all', Math.max(0, Number(body.minutes) || 0) ? Date.now() + Number(body.minutes) * 60000 : 0, v.account.id);
    else if (action === 'ban') adminBan(admin, rep.target, true);
    store.setReportStatus(rid, action === 'dismiss' ? 'dismissed' : 'actioned');
    sendJson(req, res, 200, { ok: true });
    return true;
  }
  if (path === '/api/admin/grant-title') {   // [titles] world 称号 + profile 称号/徽章 for ANY player
    const id = Number(body.id);
    if (!id || !store.accountById(id)) { sendJson(req, res, 400, { ok: false, error: 'no_account' }); return true; }
    if (body.world !== undefined) store.setWorldTitle(id, String(body.world).trim().slice(0, 8));
    if (body.profile !== undefined) store.setProfileTitle(id, String(body.profile).trim().slice(0, 16));
    if (body.badge !== undefined) store.setProfileBadge(id, String(body.badge).trim().slice(0, 16));
    sendJson(req, res, 200, { ok: true, world: store.worldTitleOf(id), profile: store.profileTitleOf(id), badge: store.profileBadgeOf(id) });
    return true;
  }
  if (path === '/api/admin/plugin-unlist') {   // [plugin-admin] move to _removed (reversible) + rescan
    const id = String(body.id || '');
    if (!/^[\w-]+$/.test(id) || !existsSync(join(admin.pluginsDir, id))) { sendJson(req, res, 400, { ok: false, error: 'no_plugin' }); return true; }
    movePluginAside(admin.pluginsDir, id, '_removed');
    admin.packs?.rescan?.();
    sendJson(req, res, 200, { ok: true, id });
    return true;
  }
  if (path === '/api/admin/plugin-relist') {   // [plugin-admin] move a _removed folder back + rescan
    const folder = String(body.folder || '');
    const rem = join(admin.pluginsDir, '_removed');
    if (!/^[\w-]+$/.test(folder) || !existsSync(join(rem, folder))) { sendJson(req, res, 400, { ok: false, error: 'no_plugin' }); return true; }
    const id = folder.replace(/-\d{8,}.*$/, '');
    if (existsSync(join(admin.pluginsDir, id))) { sendJson(req, res, 400, { ok: false, error: 'exists' }); return true; }
    renameSync(join(rem, folder), join(admin.pluginsDir, id));
    admin.packs?.rescan?.();
    sendJson(req, res, 200, { ok: true, id });
    return true;
  }

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
    if (action === 'disable') { adminBan(admin, id, true); }   // [ban] force offline too
    else if (action === 'enable') { adminBan(admin, id, false); }
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
