// server/auth/store.js — the account/token store of the login fork (P1). Built on node:sqlite (Node >= 22.5, no native
// dependency, no flag on Node >= 23.4), so an official update zip never touches it: this whole server/auth/ directory is
// new, not in MANIFEST.json. Only the tiny hooks in the official files (routes/websocket/net) need the rebase script.
//
// Two tables:
//   accounts  a registered player: username + scrypt password hash + role ('user' | 'admin') + disabled flag.
//   tokens    a bearer credential: the SHA-256 of the opaque token (the raw token never lands on disk), its kind
//             ('account' tied to an account, 'guest' a temporary nickname-only pass), and an expiry.
//
// Passwords are scrypt (node:crypto, salted, 64-byte key) stored as `saltHex:keyHex`; tokens are 32 random bytes hex,
// stored hashed so a leaked database does not hand over live sessions.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL UNIQUE,
  pass_hash   TEXT    NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'user',
  disabled    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash  TEXT    PRIMARY KEY,
  account_id  INTEGER,
  kind        TEXT    NOT NULL,
  name        TEXT,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_expires ON tokens(expires_at);
CREATE INDEX IF NOT EXISTS tokens_account ON tokens(account_id);
`;

/**
 * Open (creating if needed) the account store.
 * @param {{ dbPath: string, log?: object }} opts
 */
export function createAuthStore({ dbPath, log }) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const q = {
    insAccount: db.prepare('INSERT INTO accounts(username, pass_hash, role, created_at) VALUES(?,?,?,?)'),
    byName: db.prepare('SELECT * FROM accounts WHERE username = ?'),
    byId: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    listAccounts: db.prepare('SELECT id, username, role, disabled, created_at FROM accounts ORDER BY id'),
    setDisabled: db.prepare('UPDATE accounts SET disabled = ? WHERE id = ?'),
    setRole: db.prepare('UPDATE accounts SET role = ? WHERE id = ?'),
    setPass: db.prepare('UPDATE accounts SET pass_hash = ? WHERE id = ?'),
    delAccount: db.prepare('DELETE FROM accounts WHERE id = ?'),
    delAccountTokens: db.prepare('DELETE FROM tokens WHERE account_id = ?'),
    insToken: db.prepare('INSERT INTO tokens(token_hash, account_id, kind, name, expires_at, created_at) VALUES(?,?,?,?,?,?)'),
    byTokenHash: db.prepare(`
      SELECT t.token_hash, t.account_id, t.kind, t.name, t.expires_at,
             a.username AS username, a.role AS role, a.disabled AS disabled
      FROM tokens t LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.token_hash = ?`),
    delToken: db.prepare('DELETE FROM tokens WHERE token_hash = ?'),
    purge: db.prepare('DELETE FROM tokens WHERE expires_at < ?'),
    countAccounts: db.prepare('SELECT COUNT(*) AS n FROM accounts'),
  };

  return {
    db,
    /** @returns {object|undefined} the created account row (without the hash) */
    createAccount(username, passHash, role = 'user', now = Date.now()) {
      const info = q.insAccount.run(username, passHash, role, now);
      return this.accountById(Number(info.lastInsertRowid));
    },
    accountByName(username) { return q.byName.get(username); },
    accountById(id) { return q.byId.get(id); },
    listAccounts() { return q.listAccounts.all(); },
    accountCount() { return Number(q.countAccounts.get().n); },
    setDisabled(id, disabled) { q.setDisabled.run(disabled ? 1 : 0, id); },
    setRole(id, role) { q.setRole.run(role, id); },
    setPassword(id, passHash) { q.setPass.run(passHash, id); },
    /** Remove an account and its tokens (P2 admin). */
    deleteAccount(id) { q.delAccountTokens.run(id); q.delAccount.run(id); },
    insertToken(tokenHash, { accountId = null, kind, name = null, expiresAt }, now = Date.now()) {
      q.insToken.run(tokenHash, accountId, kind, name, expiresAt, now);
    },
    /** @returns {object|undefined} the token joined with its account (role/disabled), or undefined */
    tokenByHash(tokenHash) { return q.byTokenHash.get(tokenHash); },
    revokeToken(tokenHash) { q.delToken.run(tokenHash); },
    revokeAccountTokens(accountId) { q.delAccountTokens.run(accountId); },
    purgeExpired(now = Date.now()) { q.purge.run(now); },
    close() { try { db.close(); } catch (e) { log?.error?.('[auth] store close', e); } },
  };
}
