// server/chat/chat.js — lobby chat + friends + private messages logic (P3). Server-only. Lobby chat is rate-limited and
// runs through a configurable word filter (server/chat/filter.json); guests may post to the lobby but friends / PM require
// a registered account. Private messages persist: an offline recipient's mail is stored and delivered on their next hello.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../http/config.js';
import { createChatStore } from './store.js';
import { getAuth } from '../auth/index.js';

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
    if (s) return s.name;
    const t = getAuth().store.tagOf(accountId);   // [player-id] offline players keep their display name
    return t ? t.name : null;
  }
  /** [player-id] persistent public tag {name, disc, tag} of an account (works offline). */
  function tagOf(accountId) { return getAuth().store.tagOf(accountId); }
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
      // [admin-title] admins carry a configurable 称号 (default 管理) shown as [管理] right after [世界].
      const title = session.role === 'admin' ? (getAuth().store.adminTitleOf(session.accountId) || '管理') : null;
      store.insertLobby(session.accountId ?? null, name, body, title, now());
      broadcast({ ...base, channel: 'world', title });
      return { ok: true, channel: 'world' };
    },
    /** Channel history: world (lobby) or the sender's current room. */
    history(session, channel = 'world', limit = 100) {
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
      return store.friendIds(session.accountId).map((id) => { const t = tagOf(id); return { accountId: id, name: t ? t.name : nameOf(id), disc: t ? t.disc : null, tag: t ? t.tag : null, online: !!onlineOf(id) }; });
    },
    pendingRequests(session) {
      if (!session.accountId) return [];
      return store.pendingRequests(session.accountId).map((r) => { const t = tagOf(r.from_id); return { fromId: r.from_id, fromName: t ? t.name : nameOf(r.from_id), fromTag: t ? t.tag : null, at: r.created_at }; });
    },

    /** [friend-invite] invite an online friend into the sender's current co-op room; the target gets a popup. */
    inviteFriend(session, toId) {
      if (!session.accountId) return { ok: false, error: 'need_account' };
      toId = Number(toId);
      if (!toId || toId === session.accountId) return { ok: false, error: 'bad_target' };
      if (!store.areFriends(session.accountId, toId)) return { ok: false, error: 'not_friends' };
      const code = session.roomCode;
      if (!code) return { ok: false, error: 'no_room' };
      const target = onlineOf(toId);
      if (!target) return { ok: false, error: 'not_online' };
      send(target, { t: 'friend.invite', fromId: session.accountId, fromName: session.name, roomCode: code, at: now() });
      return { ok: true };
    },
    /** [friend-invite] the invited player's accept/decline, relayed to the inviter as a toast. */
    inviteRespond(session, fromId, accept) {
      if (!session.accountId) return { ok: false, error: 'need_account' };
      const other = onlineOf(Number(fromId));
      if (other) send(other, { t: 'friend.invite.result', byId: session.accountId, byName: session.name, accept: !!accept, at: now() });
      return { ok: true, accepted: !!accept };
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
    /** [name-sync] profile rename: rewrite stored chat sender names and tell every open chat panel to relabel live. */
    rename(accountId, name) {
      if (!accountId || !name) return;
      store.renameSender(accountId, name);
      for (const s of registry.byPlayerId.values()) if (s.connected) send(s, { t: 'chat.rename', accountId, name, at: now() });
    },
    /** [announce] 全服紧急公告: one marquee pass on EVERY connected client, on whatever screen they are on. */
    announce({ text, size, color, speed, by }) {
      broadcast({ t: 'announce', text, size, color, speed, by, at: now() });
    },
    close() { store.close(); },
  };
}
