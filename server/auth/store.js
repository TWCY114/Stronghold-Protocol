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
  // [admin-title] per-admin world-channel 称号 (default 管理), editable in the admin panel.
  if (!acctCols.includes('admin_title')) db.exec('ALTER TABLE accounts ADD COLUMN admin_title TEXT');
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

  // [account-plus] email login + per-device registration guidance. email is unique (sparse, many NULLs allowed); device_fp
  // identifies a browser device so a second registration on the same device is guided to the existing account, not duplicated.
  // email_codes holds short-lived verification codes (register / login / reset), one row per email+purpose.
  if (!acctCols.includes('email')) db.exec('ALTER TABLE accounts ADD COLUMN email TEXT');
  if (!acctCols.includes('device_fp')) db.exec('ALTER TABLE accounts ADD COLUMN device_fp TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email) WHERE email IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_device ON accounts(device_fp)');
  db.exec(`CREATE TABLE IF NOT EXISTS email_codes (
    email TEXT NOT NULL, code TEXT NOT NULL, purpose TEXT NOT NULL,
    expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    PRIMARY KEY (email, purpose))`);

  const q = {
    insAccount: db.prepare('INSERT INTO accounts(username, pass_hash, role, created_at, display_name, discriminator) VALUES(?,?,?,?,?,?)'),
    byNameDisc: db.prepare('SELECT * FROM accounts WHERE display_name = ? AND discriminator = ?'),
    byDisplayName: db.prepare('SELECT id, display_name, discriminator, role, created_at FROM accounts WHERE display_name = ? ORDER BY id LIMIT 50'),
    byDisplayNameLike: db.prepare('SELECT id, display_name, discriminator, role, created_at FROM accounts WHERE display_name LIKE ? ESCAPE \'\\\' ORDER BY id LIMIT 50'),
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
    byEmail: db.prepare('SELECT * FROM accounts WHERE email = ?'),
    byDeviceFp: db.prepare('SELECT id, display_name, discriminator, username FROM accounts WHERE device_fp = ? ORDER BY id LIMIT 1'),
    setEmailDevice: db.prepare('UPDATE accounts SET email = ?, device_fp = ? WHERE id = ?'),
    insCode: db.prepare(`INSERT INTO email_codes(email, code, purpose, expires_at, attempts, created_at) VALUES(?,?,?,?,0,?)
      ON CONFLICT(email, purpose) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, attempts=0, created_at=excluded.created_at`),
    getCode: db.prepare('SELECT * FROM email_codes WHERE email = ? AND purpose = ?'),
    delCode: db.prepare('DELETE FROM email_codes WHERE email = ? AND purpose = ?'),
    bumpCode: db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?'),
    purgeCodes: db.prepare('DELETE FROM email_codes WHERE expires_at < ?'),
  };

  return {
    db,
    /** @returns {object|undefined} the created account row (without the hash) */
    createAccount(username, passHash, role = 'user', now = Date.now(), extra = {}) {
      const info = q.insAccount.run(username, passHash, role, now, username, freeDisc());
      const id = Number(info.lastInsertRowid);
      if (extra.email || extra.deviceFp) q.setEmailDevice.run(extra.email || null, extra.deviceFp || null, id);
      return this.accountById(id);
    },
    accountByName(username) { return q.byName.get(username); },
    accountById(id) { return q.byId.get(id); },
    /** [account-plus] lookup by email (normalized lower-case) / by browser device fingerprint. */
    accountByEmail(email) { const e = String(email ?? '').trim().toLowerCase(); return e ? q.byEmail.get(e) : undefined; },
    accountByDevice(fp) { return fp ? q.byDeviceFp.get(fp) : undefined; },
    setEmailDevice(id, email, fp) { q.setEmailDevice.run(email ? String(email).trim().toLowerCase() : null, fp || null, id); },
    /** [account-plus] verification-code helpers (one live code per email+purpose). */
    putCode(email, code, purpose, expiresAt, now = Date.now()) { q.insCode.run(String(email).trim().toLowerCase(), code, purpose, expiresAt, now); },
    getCode(email, purpose) { return q.getCode.get(String(email).trim().toLowerCase(), purpose); },
    delCode(email, purpose) { q.delCode.run(String(email).trim().toLowerCase(), purpose); },
    bumpCode(email, purpose) { q.bumpCode.run(String(email).trim().toLowerCase(), purpose); },
    /** [player-id] public identity {name, disc, tag} of an account, or null. */
    tagOf(id) { const r = q.tagById.get(id); return r && r.display_name != null ? { name: r.display_name, disc: r.discriminator, tag: `${r.display_name}#${r.discriminator}` } : null; },
    /** [player-id] full public profile of an account (no credentials), or null. */
    profileOf(id) { const r = q.byId.get(id); if (!r) return null; return { id: r.id, name: r.display_name ?? r.username, disc: r.discriminator, tag: `${r.display_name ?? r.username}#${r.discriminator}`, role: r.role, createdAt: r.created_at, email: r.email ?? null }; },
    /** [player-id] search "name#disc" (exact one) or "name" (all same-name players). */
    searchPlayers(query) {
      const s = String(query ?? '').trim();
      if (!s) return [];
      const m = s.match(/^(.*)#(\d{1,4})$/);
      if (m) { const r = q.byNameDisc.get(m[1].trim(), Number(m[2])); return r ? [this.profileOf(r.id)] : []; }
      const row = (r) => ({ id: r.id, name: r.display_name, disc: r.discriminator, tag: `${r.display_name}#${r.discriminator}`, role: r.role, createdAt: r.created_at });
      const exact = q.byDisplayName.all(s).map(row);
      if (exact.length) return exact;
      // [friend-search] no exact hit: fall back to a substring match so partial names still find people.
      const like = '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      return q.byDisplayNameLike.all(like).map(row);
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
    /** [admin-title] the admin's world-channel 称号; null/empty falls back to 管理 at render time. */
    adminTitleOf(id) { const r = db.prepare('SELECT admin_title FROM accounts WHERE id = ?').get(id); return (r && r.admin_title) || null; },
    setAdminTitle(id, title) { db.prepare('UPDATE accounts SET admin_title = ? WHERE id = ?').run(title || null, id); },
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
    purgeExpired(now = Date.now()) { q.purge.run(now); q.purgeCodes.run(now); },
    close() { try { db.close(); } catch (e) { log?.error?.('[auth] store close', e); } },
  };
}
