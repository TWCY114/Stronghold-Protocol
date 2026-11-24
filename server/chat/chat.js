// server/chat/chat.js — lobby chat + friends + private messages logic (P3). Server-only. Lobby chat is rate-limited and
// runs through a configurable word filter (server/chat/filter.json); guests may post to the lobby but friends / PM require
// a registered account. Private messages persist: an offline recipient's mail is stored and delivered on their next hello.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../http/config.js';
import { createChatStore } from './store.js';

const LOBBY_RATE = { max: 3, windowMs: 5000 };   // 3 lobby messages / 5 s / player
const PM_RATE = { max: 10, windowMs: 5000 };
const BODY_MAX = 300;

function loadFilter() {
  try { const a = JSON.parse(readFileSync(join(ROOT, 'server', 'chat', 'filter.json'), 'utf8')); return Array.isArray(a) ? a.filter((w) => typeof w === 'string' && w) : []; }
  catch { return []; }
}
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    let r = hits.get(key);
    if (!r || now >= r.resetAt) { r = { n: 0, resetAt: now + windowMs }; hits.set(key, r); }
    return ++r.n <= max;
  };
}
const send = (session, msg) => { try { if (session.connected && session.ws) session.ws.send(JSON.stringify(msg)); } catch { /* ignore */ } };

/**
 * @param {{ dbPath: string, registry: object, log?: object, now?: () => number }} opts
 */
export function createChat({ dbPath, registry, log, now = Date.now }) {
  const store = createChatStore({ dbPath, log });
  const filterWords = loadFilter();
  const lobbyTake = createLimiter(LOBBY_RATE);
  const pmTake = createLimiter(PM_RATE);
  const filter = (text) => { let out = text; for (const w of filterWords) out = out.split(w).join('*'.repeat(w.length)); return out; };

  /** The connected session of an account (for online status / delivery), or null. */
  function onlineOf(accountId) {
    for (const s of registry.byPlayerId.values()) if (s.accountId === accountId && s.connected) return s;
    return null;
  }
  function nameOf(accountId) {
    const s = onlineOf(accountId);
    return s ? s.name : null;
  }
  function broadcast(msg) {
    for (const s of registry.byPlayerId.values()) if (s.connected) send(s, msg);
  }

  return {
    store,
    onlineOf,
    /** Send to a channel: 'world' (global lobby, guests allowed) or 'room' (members of the sender's current room). */
    sendChat(session, rawBody, channel = 'world') {
      const body = filter(String(rawBody ?? '').trim().slice(0, BODY_MAX));
      if (!body) return { ok: false, error: 'empty' };
      if (!lobbyTake(session.playerId, now())) return { ok: false, error: 'rate_limited' };
      const name = session.name || session.username || session.guestName || '玩家';
      const base = { t: 'chat.lobby', name, body, accountId: session.accountId ?? null, guest: session.role === 'guest', at: now() };
      if (channel === 'room') {
        const code = session.roomCode;
        if (!code) return { ok: false, error: 'no_room' };
        store.insertRoom(code, session.accountId ?? null, name, body, now());
        for (const s of registry.byPlayerId.values()) if (s.connected && s.roomCode === code) send(s, { ...base, channel: 'room', roomCode: code });
        return { ok: true, channel: 'room' };
      }
      store.insertLobby(session.accountId ?? null, name, body, now());
      broadcast({ ...base, channel: 'world' });
      return { ok: true, channel: 'world' };
    },
    /** Channel history: world (lobby) or the sender's current room. */
    history(session, channel = 'world', limit = 50) {
      if (channel === 'room') return session.roomCode ? store.roomRecent(session.roomCode, limit) : [];
      return store.lobbyRecent(limit);
    },

    requestFriend(session, toId) {
      if (!session.accountId) return { ok: false, error: 'need_account' };
      toId = Number(toId);
      if (!toId || toId === session.accountId) return { ok: false, error: 'bad_target' };
      if (store.areFriends(session.accountId, toId)) return { ok: false, error: 'already_friends' };
      store.sendRequest(session.accountId, toId, now());
      const target = onlineOf(toId);
      if (target) send(target, { t: 'friend.request', fromId: session.accountId, fromName: session.name, at: now() });
      return { ok: true };
    },
    respondFriend(session, fromId, accept) {
      if (!session.accountId) return { ok: false, error: 'need_account' };
      fromId = Number(fromId);
      const req = store.getRequest(fromId, session.accountId);
      if (!req || req.status !== 'pending') return { ok: false, error: 'no_request' };
      store.answerRequest(fromId, session.accountId, accept ? 'accepted' : 'rejected');
      if (accept) {
        store.addFriend(fromId, session.accountId, now());
        const other = onlineOf(fromId);
        if (other) send(other, { t: 'friend.accepted', byId: session.accountId, byName: session.name, at: now() });
      }
      return { ok: true, accepted: !!accept };
    },
    removeFriend(session, otherId) {
      if (!session.accountId) return { ok: false, error: 'need_account' };
      store.removeFriend(session.accountId, Number(otherId));
      store.removeRequest(session.accountId, Number(otherId));
      store.removeRequest(Number(otherId), session.accountId);
      return { ok: true };
    },
    friendsList(session) {
      if (!session.accountId) return [];
      return store.friendIds(session.accountId).map((id) => ({ accountId: id, name: nameOf(id), online: !!onlineOf(id) }));
    },
    pendingRequests(session) {
      if (!session.accountId) return [];
      return store.pendingRequests(session.accountId).map((r) => ({ fromId: r.from_id, fromName: nameOf(r.from_id), at: r.created_at }));
    },

    sendPM(session, toId, rawBody) {
      if (!session.accountId) return { ok: false, error: 'need_account' };
      toId = Number(toId);
      if (!toId || toId === session.accountId) return { ok: false, error: 'bad_target' };
      if (!store.areFriends(session.accountId, toId)) return { ok: false, error: 'not_friends' };
      const body = filter(String(rawBody ?? '').trim().slice(0, BODY_MAX));
      if (!body) return { ok: false, error: 'empty' };
      if (!pmTake(session.playerId, now())) return { ok: false, error: 'rate_limited' };
      const target = onlineOf(toId);
      const id = store.insertMessage(session.accountId, toId, body, target ? 1 : 0, now());
      const msg = { t: 'pm.message', id, fromId: session.accountId, fromName: session.name, toId, body, at: now(), offline: !target };
      if (target) send(target, msg);
      send(session, { ...msg, self: true });   // echo to sender
      return { ok: true, id, offline: !target };
    },
    pmHistory(session, otherId, limit = 100) {
      if (!session.accountId) return [];
      return store.conversation(session.accountId, Number(otherId), limit);
    },
    /** Deliver stored offline mail on hello; marks it delivered. */
    deliverPending(session) {
      if (!session.accountId) return;
      const mail = store.undeliveredFor(session.accountId);
      for (const m of mail) send(session, { t: 'pm.message', id: m.id, fromId: m.from_id, fromName: nameOf(m.from_id), toId: m.to_id, body: m.body, at: m.created_at, offline: true });
      if (mail.length) store.markDelivered(session.accountId);
    },
    close() { store.close(); },
  };
}
