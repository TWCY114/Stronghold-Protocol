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

  // [player-id] public identity: display_name + discriminator. The login username stays unique; the public tag is
  // display_name#discriminator. The discriminator is a PERMANENT, GLOBALLY-UNIQUE number assigned at registration and kept
  // across renames (only the name changes). Idempotent migration: an existing auth.db gains the columns, every account gets
  // a unique number, and collisions left over from the older per-name scheme are reassigned.
  const acctCols = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  if (!acctCols.includes('display_name')) db.exec('ALTER TABLE accounts ADD COLUMN display_name TEXT');
  if (!acctCols.includes('discriminator')) db.exec('ALTER TABLE accounts ADD COLUMN discriminator INTEGER');
  db.exec('UPDATE accounts SET display_name = username WHERE display_name IS NULL');
  const freeDisc = () => { const used = new Set(db.prepare('SELECT discriminator FROM accounts').all().map((r) => r.discriminator)); for (let i = 0; i < 200; i++) { const d = 1000 + Math.floor(Math.random() * 9000); if (!used.has(d)) return d; } let d = 10000; while (used.has(d)) d++; return d; };
  const putDisc = db.prepare('UPDATE accounts SET discriminator = ? WHERE id = ?');
  const used = new Set();
  for (const r of db.prepare('SELECT id, discriminator FROM accounts ORDER BY id').all()) {
    let d = r.discriminator;
    if (d == null || used.has(d)) { d = freeDisc(); putDisc.run(d, r.id); }
    used.add(d);
  }
  db.exec('DROP INDEX IF EXISTS idx_accounts_tag');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_disc ON accounts(discriminator)');

  const q = {
    insAccount: db.prepare('INSERT INTO accounts(username, pass_hash, role, created_at, display_name, discriminator) VALUES(?,?,?,?,?,?)'),
    byNameDisc: db.prepare('SELECT * FROM accounts WHERE display_name = ? AND discriminator = ?'),
    byDisplayName: db.prepare('SELECT id, display_name, discriminator, role, created_at FROM accounts WHERE display_name = ? ORDER BY id LIMIT 50'),
    setTag: db.prepare('UPDATE accounts SET display_name = ?, discriminator = ? WHERE id = ?'),
    tagById: db.prepare('SELECT display_name, discriminator FROM accounts WHERE id = ?'),
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
             a.username AS username, a.role AS role, a.disabled AS disabled,
             a.display_name AS display_name, a.discriminator AS discriminator
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
      const info = q.insAccount.run(username, passHash, role, now, username, freeDisc());
      return this.accountById(Number(info.lastInsertRowid));
    },
    accountByName(username) { return q.byName.get(username); },
    accountById(id) { return q.byId.get(id); },
    /** [player-id] public identity {name, disc, tag} of an account, or null. */
    tagOf(id) { const r = q.tagById.get(id); return r && r.display_name != null ? { name: r.display_name, disc: r.discriminator, tag: `${r.display_name}#${r.discriminator}` } : null; },
    /** [player-id] full public profile of an account (no credentials), or null. */
    profileOf(id) { const r = q.byId.get(id); if (!r) return null; return { id: r.id, name: r.display_name ?? r.username, disc: r.discriminator, tag: `${r.display_name ?? r.username}#${r.discriminator}`, role: r.role, createdAt: r.created_at }; },
    /** [player-id] search "name#disc" (exact one) or "name" (all same-name players). */
    searchPlayers(query) {
      const s = String(query ?? '').trim();
      if (!s) return [];
      const m = s.match(/^(.*)#(\d{1,4})$/);
      if (m) { const r = q.byNameDisc.get(m[1].trim(), Number(m[2])); return r ? [this.profileOf(r.id)] : []; }
      return q.byDisplayName.all(s).map((r) => ({ id: r.id, name: r.display_name, disc: r.discriminator, tag: `${r.display_name}#${r.discriminator}`, role: r.role, createdAt: r.created_at }));
    },
    /** [player-id] rename: change display_name only; the permanent unique discriminator is kept. */
    setDisplayName(id, name) {
      name = String(name ?? '').trim();
      const cur = q.tagById.get(id);
      q.setTag.run(name, cur && cur.discriminator != null ? cur.discriminator : freeDisc(), id);
      return this.profileOf(id);
    },
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
