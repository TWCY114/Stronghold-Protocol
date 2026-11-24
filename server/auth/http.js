// server/auth/http.js — the login fork's HTTP surface (P1): the standalone /login page and /api/auth/* JSON endpoints.
// Hooked into server/http/routes.js ahead of the GET/HEAD-only check (these accept POST). The page's JS/CSS are external
// files under public/login/ so the page CSP (script-src 'self') allows them; static.js serves them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../http/config.js';
import { sendJson, sendError } from '../http/common.js';
import { clientAddress } from '../net.js';
import { getAuth } from './index.js';
import { getChat } from '../chat/index.js';

const MAX_BODY = 4096;
const NAME_RE = /^[\w一-龥]{2,16}$/u;   // [player-id] display name: letters / digits / underscore / Chinese, 2–16

/** [player-id] a public profile plus presence (online) and friend count, or null. */
function playerView(id) {
  const p = getAuth().store.profileOf(Number(id));
  if (!p) return null;
  const chat = getChat();
  return { ...p, online: !!(chat && chat.onlineOf(p.id)), friendsCount: chat ? chat.store.friendIds(p.id).length : 0 };
}

/** Read a small JSON request body (rejects oversize / invalid). */
function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

/** The bearer token of a request: Authorization: Bearer …, or ?token=…. */
function bearer(req, parts) {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
  if (parts?.query) return new URLSearchParams(parts.query).get('token') || '';
  return '';
}

function ipOf(req) {
  try { return clientAddress(req, process.env.TRUST_PROXY || 'auto').ip; }
  catch { return req.socket?.remoteAddress || '?'; }
}

let loginHtml = null;
function serveLogin(res) {
  if (loginHtml == null) {
    try { loginHtml = readFileSync(join(ROOT, 'public', 'login', 'index.html'), 'utf8'); }
    catch { loginHtml = '<!doctype html><meta charset="utf-8"><title>登录</title><p>登录页缺失（public/login/index.html）。</p>'; }
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(loginHtml);
}

/** Does this path belong to the auth surface? */
function handles(rawPath) {
  return rawPath === '/login' || rawPath === '/login/' || rawPath.startsWith('/api/auth/') || rawPath.startsWith('/api/player/');
}

/**
 * Handle an auth request. Returns true when it answered (the caller then stops).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ rawPath: string, query: URLSearchParams }} parts
 */
async function handle(req, res, parts) {
  const path = parts.rawPath;
  if (path === '/login' || path === '/login/') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { sendError(req, res, 405, 'Method not allowed'); return true; }
    serveLogin(res);
    return true;
  }

  const auth = getAuth();
  const ip = ipOf(req);

  if (path === '/api/auth/me') {
    const v = auth.verifyToken(bearer(req, parts));
    sendJson(req, res, 200, v.ok ? { ok: true, kind: v.kind, account: v.account ?? null, name: v.name ?? null } : { ok: false });
    return true;
  }

  // [player-id] public identity / search / profile / friends (GET). rename is POST below.
  if (path === '/api/player/search') {
    const q = parts.query ? new URLSearchParams(parts.query).get('q') || '' : '';
    const results = auth.store.searchPlayers(q).map((p) => ({ ...p, online: !!(getChat() && getChat().onlineOf(p.id)) }));
    sendJson(req, res, 200, { ok: true, results });
    return true;
  }
  if (path === '/api/player/profile') {
    const id = parts.query ? new URLSearchParams(parts.query).get('id') : '';
    const p = playerView(id);
    sendJson(req, res, p ? 200 : 404, p ? { ok: true, profile: p } : { ok: false, error: 'not_found' });
    return true;
  }
  if (path === '/api/player/me' || path === '/api/player/friends') {
    const v = auth.verifyToken(bearer(req, parts));
    if (!v.ok || v.kind !== 'account') { sendJson(req, res, 401, { ok: false, error: 'need_account' }); return true; }
    if (path === '/api/player/me') { sendJson(req, res, 200, { ok: true, profile: playerView(v.account.id) }); return true; }
    const chat = getChat();
    const friends = chat ? chat.store.friendIds(v.account.id).map((id) => playerView(id)).filter(Boolean) : [];
    sendJson(req, res, 200, { ok: true, friends });
    return true;
  }

  if (req.method !== 'POST') { sendError(req, res, 405, 'Method not allowed'); return true; }
  const body = await readBody(req);
  if (!body || typeof body !== 'object') { sendJson(req, res, 400, { ok: false, error: 'bad_body' }); return true; }

  if (path === '/api/auth/register') {
    const r = auth.register(body.username, body.password, { ip, mode: body.mode });
    sendJson(req, res, r.ok ? 200 : 400, r);
    return true;
  }
  if (path === '/api/auth/login') {
    const r = auth.login(body.username, body.password, { ip, mode: body.mode, token: body.token });
    sendJson(req, res, r.ok ? 200 : 401, r);
    return true;
  }
  if (path === '/api/auth/guest') {
    const r = auth.guest(body.name, { ip });
    sendJson(req, res, r.ok ? 200 : 400, r);
    return true;
  }
  if (path === '/api/auth/logout') {
    auth.logout(bearer(req, parts));
    sendJson(req, res, 200, { ok: true });
    return true;
  }
  if (path === '/api/player/rename') {
    const v = auth.verifyToken(bearer(req, parts));
    if (!v.ok || v.kind !== 'account') { sendJson(req, res, 401, { ok: false, error: 'need_account' }); return true; }
    const name = String(body.name ?? '').trim();
    if (!NAME_RE.test(name)) { sendJson(req, res, 400, { ok: false, error: 'bad_name' }); return true; }
    const profile = auth.store.setDisplayName(v.account.id, name);
    sendJson(req, res, 200, { ok: true, profile: { ...profile, online: true } });
    return true;
  }
  if (path === '/api/player/delete') {
    const v = auth.verifyToken(bearer(req, parts));
    if (!v.ok || v.kind !== 'account') { sendJson(req, res, 401, { ok: false, error: 'need_account' }); return true; }
    const chat = getChat();
    if (chat) chat.store.purgeAccount(v.account.id);   // friendships / requests / PMs / chat lines
    auth.store.deleteAccount(v.account.id);            // the account row + all its tokens
    sendJson(req, res, 200, { ok: true });
    return true;
  }
  sendError(req, res, 404, 'Not found');
  return true;
}

export const authHttp = { handles, handle };
