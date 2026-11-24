// server/chat/store.js — the login fork's chat / friends store (P3). Shares the account database (server/auth/auth.db, or
// SP_AUTH_DB) so account ids line up; opens its own WAL connection. New directory: an official update leaves it alone.
//
//   friends         a mutual friendship (one canonical row a_id < b_id).
//   friend_requests a pending / answered request (from_id → to_id).
//   messages        persistent private messages (offline storage: delivered=0 until the recipient reads them online).
//   lobby_chat      the public lobby channel history (trimmed to the last LOBBY_KEEP rows).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const LOBBY_KEEP = 200;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS friends (
  a_id INTEGER NOT NULL, b_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (a_id, b_id)
);
CREATE TABLE IF NOT EXISTS friend_requests (
  from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL, PRIMARY KEY (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL,
  body TEXT NOT NULL, created_at INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(from_id, to_id, id);
CREATE INDEX IF NOT EXISTS messages_inbox ON messages(to_id, delivered);
CREATE TABLE IF NOT EXISTS lobby_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL,
  body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL, account_id INTEGER, name TEXT NOT NULL,
  body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS room_chat_code ON room_chat(room_code, id);
`;

export function createChatStore({ dbPath, log }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const q = {
    addFriend: db.prepare('INSERT OR IGNORE INTO friends(a_id,b_id,created_at) VALUES(?,?,?)'),
    delFriend: db.prepare('DELETE FROM friends WHERE a_id=? AND b_id=?'),
    friendsOf: db.prepare('SELECT a_id,b_id,created_at FROM friends WHERE a_id=? OR b_id=?'),
    isFriend: db.prepare('SELECT 1 AS x FROM friends WHERE a_id=? AND b_id=?'),
    upsertReq: db.prepare(`INSERT INTO friend_requests(from_id,to_id,status,created_at) VALUES(?,?,?,?)
      ON CONFLICT(from_id,to_id) DO UPDATE SET status=excluded.status, created_at=excluded.created_at`),
    getReq: db.prepare('SELECT * FROM friend_requests WHERE from_id=? AND to_id=?'),
    pendingFor: db.prepare('SELECT * FROM friend_requests WHERE to_id=? AND status=?'),
    delReq: db.prepare('DELETE FROM friend_requests WHERE from_id=? AND to_id=?'),
    insMsg: db.prepare('INSERT INTO messages(from_id,to_id,body,created_at,delivered) VALUES(?,?,?,?,?)'),
    pairMsgs: db.prepare('SELECT * FROM messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY id DESC LIMIT ?'),
    undelivered: db.prepare('SELECT * FROM messages WHERE to_id=? AND delivered=0 ORDER BY id'),
    markDelivered: db.prepare('UPDATE messages SET delivered=1 WHERE to_id=? AND delivered=0'),
    insLobby: db.prepare('INSERT INTO lobby_chat(account_id,name,body,created_at) VALUES(?,?,?,?)'),
    lobbyRecent: db.prepare('SELECT * FROM lobby_chat ORDER BY id DESC LIMIT ?'),
    trimLobby: db.prepare('DELETE FROM lobby_chat WHERE id NOT IN (SELECT id FROM lobby_chat ORDER BY id DESC LIMIT ?)'),
    insRoom: db.prepare('INSERT INTO room_chat(room_code,account_id,name,body,created_at) VALUES(?,?,?,?,?)'),
    roomRecent: db.prepare('SELECT * FROM room_chat WHERE room_code=? ORDER BY id DESC LIMIT ?'),
    trimRoom: db.prepare('DELETE FROM room_chat WHERE room_code=? AND id NOT IN (SELECT id FROM room_chat WHERE room_code=? ORDER BY id DESC LIMIT ?)'),
    renameLobby: db.prepare('UPDATE lobby_chat SET name=? WHERE account_id=?'),
    renameRoom: db.prepare('UPDATE room_chat SET name=? WHERE account_id=?'),
  };

  const pair = (a, b) => (a < b ? [a, b] : [b, a]);

  return {
    db,
    addFriend(a, b, now = Date.now()) { const [x, y] = pair(a, b); q.addFriend.run(x, y, now); },
    removeFriend(a, b) { const [x, y] = pair(a, b); q.delFriend.run(x, y); },
    areFriends(a, b) { const [x, y] = pair(a, b); return !!q.isFriend.get(x, y); },
    /** @returns {number[]} the friend account ids of `id` */
    friendIds(id) {
      return q.friendsOf.all(id, id).map((r) => (r.a_id === id ? r.b_id : r.a_id));
    },
    sendRequest(from, to, now = Date.now()) { q.upsertReq.run(from, to, 'pending', now); },
    getRequest(from, to) { return q.getReq.get(from, to); },
    pendingRequests(to) { return q.pendingFor.all(to, 'pending'); },
    answerRequest(from, to, status) { q.upsertReq.run(from, to, status, Date.now()); },
    removeRequest(from, to) { q.delReq.run(from, to); },
    insertMessage(from, to, body, delivered = 0, now = Date.now()) {
      const info = q.insMsg.run(from, to, body, now, delivered);
      return Number(info.lastInsertRowid);
    },
    /** Recent private messages between two accounts (newest first). */
    conversation(a, b, limit = 100) { return q.pairMsgs.all(a, b, b, a, limit).reverse(); },
    undeliveredFor(to) { return q.undelivered.all(to); },
    markDelivered(to) { q.markDelivered.run(to); },
    insertLobby(accountId, name, body, now = Date.now()) {
      q.insLobby.run(accountId, name, body, now);
      q.trimLobby.run(LOBBY_KEEP);
    },
    lobbyRecent(limit = 50) { return q.lobbyRecent.all(limit).reverse(); },
    insertRoom(roomCode, accountId, name, body, now = Date.now()) {
      q.insRoom.run(roomCode, accountId, name, body, now);
      q.trimRoom.run(roomCode, roomCode, LOBBY_KEEP);
    },
    roomRecent(roomCode, limit = 50) { return q.roomRecent.all(roomCode, limit).reverse(); },
    /** [name-sync] a profile rename rewrites the sender name on every stored lobby / room line so history agrees too. */
    renameSender(accountId, name) {
      q.renameLobby.run(name, accountId);
      q.renameRoom.run(name, accountId);
    },
    /** [player-id] erase an account's social footprint on self-deletion: friendships, requests, PMs and chat lines. */
    purgeAccount(id) {
      db.prepare('DELETE FROM friends WHERE a_id=? OR b_id=?').run(id, id);
      db.prepare('DELETE FROM friend_requests WHERE from_id=? OR to_id=?').run(id, id);
      db.prepare('DELETE FROM messages WHERE from_id=? OR to_id=?').run(id, id);
      db.prepare('DELETE FROM lobby_chat WHERE account_id=?').run(id);
      db.prepare('DELETE FROM room_chat WHERE account_id=?').run(id);
    },
    close() { try { db.close(); } catch (e) { log?.error?.('[chat] store close', e); } },
  };
}
