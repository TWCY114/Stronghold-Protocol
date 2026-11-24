// server/auth/auth.js — registration / login / guest logic of the login fork (P1). Server-only (not server/sim/), so
// node:crypto and clocks are fine here. Passwords: scrypt, salted, 64-byte key, stored `saltHex:keyHex`. Tokens: 32
// random bytes hex, stored as their SHA-256; account tokens live 30 days, guest passes 2 hours. A small fixed-window
// rate limiter (per IP+username for credentials, per IP for guests) blunts brute force without any external dependency.

import { scryptSync, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createAuthStore } from './store.js';
import { createMailer } from './mailer.js';

const ACCOUNT_TTL_MS = 30 * 24 * 3600 * 1000;   // a password login stays valid for a month
const PERMANENT_TTL_MS = 100 * 365 * 24 * 3600 * 1000;   // token-only credential: effectively never expires
const GUEST_TTL_MS = 2 * 3600 * 1000;           // a guest pass is temporary
const CODE_TTL_MS = 10 * 60 * 1000;             // an e-mail verification code lives 10 minutes
const USERNAME_RE = /^[\w一-龥]{2,16}$/u;   // letters / digits / underscore / Chinese, 2–16
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const normEmail = (e) => String(e ?? '').trim().toLowerCase();

/** scrypt password hash, self-describing `saltHex:keyHex`. */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${key}`;
}
/** Constant-time verification of a password against a stored `saltHex:keyHex`. */
export function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** A fixed-window attempt counter (in memory; resets on restart, which is acceptable for a brute-force speed bump). */
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    take(key, now = Date.now()) {
      let rec = hits.get(key);
      if (!rec || now >= rec.resetAt) { rec = { count: 0, resetAt: now + windowMs }; hits.set(key, rec); }
      if (++rec.count > max) return false;
      return true;
    },
    sweep(now = Date.now()) { for (const [k, r] of hits) if (now >= r.resetAt) hits.delete(k); },
  };
}

/**
 * @param {{ dbPath: string, log?: object, now?: () => number }} opts
 */
export function createAuth({ dbPath, log, now = Date.now }) {
  const store = createAuthStore({ dbPath, log });
  const credLimiter = createLimiter({ max: 10, windowMs: 5 * 60 * 1000 });   // 10 credential tries / 5 min / ip+user
  const guestLimiter = createLimiter({ max: 30, windowMs: 5 * 60 * 1000 });  // 30 guest passes / 5 min / ip
  const mailer = createMailer({ log });
  const codeLimiter = createLimiter({ max: 5, windowMs: 10 * 60 * 1000 });   // 5 code sends / 10 min / ip+email
  const sweepTimer = setInterval(() => { store.purgeExpired(now()); credLimiter.sweep(now()); guestLimiter.sweep(now()); codeLimiter.sweep(now()); }, 10 * 60 * 1000);
  sweepTimer.unref?.();

  /** [account-plus] mint + store + e-mail a 6-digit verification code. */
  async function sendEmailCode(email, purpose, { ip = '?' } = {}) {
    email = normEmail(email);
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'bad_email' };
    if (!mailer.configured) return { ok: false, error: 'email_not_configured' };
    if (!codeLimiter.take(`code:${ip}:${email}`, now())) return { ok: false, error: 'rate_limited' };
    const code = String(100000 + Math.floor(Math.random() * 900000));
    store.putCode(email, code, purpose, now() + CODE_TTL_MS, now());
    const r = await mailer.sendMail({ to: email, subject: '卫戍协议：盟约 验证码', text: `你的验证码是 ${code}（10 分钟内有效，用途：${purpose}）。如非本人操作请忽略。` });
    if (!r.ok) { store.delCode(email, purpose); return { ok: false, error: r.error || 'send_failed' }; }
    log?.info?.(`[auth] code sent to ${email} (${purpose})`);
    return { ok: true };
  }
  /** [account-plus] check a code (expiry + attempt cap); consumes it on success. */
  function verifyCode(email, purpose, code) {
    email = normEmail(email);
    const rec = store.getCode(email, purpose);
    if (!rec || rec.expires_at < now()) return false;
    if (rec.attempts >= 5) { store.delCode(email, purpose); return false; }
    if (String(code ?? '').trim() !== rec.code) { store.bumpCode(email, purpose); return false; }
    store.delCode(email, purpose);
    return true;
  }
  /** [account-plus] one account per device: if this fingerprint already owns an account, guide the player to log in. */
  function deviceConflict(deviceFp) {
    if (!deviceFp) return null;
    const row = store.accountByDevice(deviceFp);
    if (!row) return null;
    const name = row.display_name ?? row.username;
    return { ok: false, error: 'device_has_account', existing: { id: row.id, name, tag: row.discriminator != null ? `${name}#${row.discriminator}` : name } };
  }

  /** Mint a token of a kind and return the raw opaque token (only the hash is stored). */
  function issue({ accountId = null, kind, name = null, ttl }) {
    const token = randomBytes(32).toString('hex');
    store.insertToken(sha256(token), { accountId, kind, name, expiresAt: now() + ttl }, now());
    return token;
  }

  function publicAccount(row) {
    const name = row.display_name ?? row.username;
    return { id: row.id, username: row.username, role: row.role, name, disc: row.discriminator ?? null, tag: row.discriminator != null ? `${name}#${row.discriminator}` : name, email: row.email ?? null };
  }

  return {
    store,
    /**
     * Register a new account and sign it in. mode 'token' (default): no password — the account is credentialled by a
     * permanent token handed to the player to keep. mode 'password': classic username + password (30-day token).
     * @returns {{ok:true, token:string, account:object, mode:string}|{ok:false, error:string}}
     */
    register(username, password, { ip = '?', mode = 'token', email = '', code = '', deviceFp = '' } = {}) {
      username = String(username ?? '').trim();
      password = String(password ?? '');
      email = normEmail(email);
      const emailMode = mode === 'email';
      const tokenMode = mode === 'token';
      if (!USERNAME_RE.test(username)) return { ok: false, error: 'bad_username' };
      const conflict = deviceConflict(deviceFp); if (conflict) return conflict;   // one account per device → guide to login
      if (emailMode) {
        if (!EMAIL_RE.test(email)) return { ok: false, error: 'bad_email' };
        if (password.length < 6 || password.length > 64) return { ok: false, error: 'bad_password' };
        if (store.accountByEmail(email)) return { ok: false, error: 'email_taken' };
        if (!verifyCode(email, 'register', code)) return { ok: false, error: 'bad_code' };
      } else if (!tokenMode && (password.length < 6 || password.length > 64)) return { ok: false, error: 'bad_password' };
      if (!credLimiter.take(`reg:${ip}:${username}`, now())) return { ok: false, error: 'rate_limited' };
      if (store.accountByName(username)) return { ok: false, error: 'taken' };
      let account;
      try { account = store.createAccount(username, tokenMode ? '' : hashPassword(password), 'user', now(), { email: emailMode ? email : '', deviceFp }); }
      catch (e) { log?.error?.('[auth] register', e); return { ok: false, error: 'taken' }; }
      const token = issue({ accountId: account.id, kind: 'account', ttl: tokenMode ? PERMANENT_TTL_MS : ACCOUNT_TTL_MS });
      log?.info?.(`[auth] registered #${account.id} ${username} (${mode})`);
      return { ok: true, token, account: publicAccount(account), mode };
    },
    /**
     * Sign in. mode 'token' (default): paste the permanent token. mode 'password': username + password.
     * @returns {{ok:true, token:string, account:object, mode:string}|{ok:false, error:string}}
     */
    login(username, password, { ip = '?', mode = 'token', token = '', email = '', code = '' } = {}) {
      if (mode === 'token') {
        const v = this.verifyToken(String(token ?? ''));
        if (!v.ok || v.kind !== 'account') return { ok: false, error: 'bad_token' };
        return { ok: true, token: String(token), account: v.account, mode: 'token' };
      }
      if (mode === 'email-code') {   // [account-plus] passwordless: e-mail + verification code
        email = normEmail(email);
        if (!EMAIL_RE.test(email)) return { ok: false, error: 'bad_email' };
        if (!credLimiter.take(`login:${ip}:${email}`, now())) return { ok: false, error: 'rate_limited' };
        if (!verifyCode(email, 'login', code)) return { ok: false, error: 'bad_code' };
        const row = store.accountByEmail(email);
        if (!row) return { ok: false, error: 'no_account' };
        if (row.disabled) return { ok: false, error: 'disabled' };
        const newToken = issue({ accountId: row.id, kind: 'account', ttl: ACCOUNT_TTL_MS });
        return { ok: true, token: newToken, account: publicAccount(row), mode: 'email-code' };
      }
      // password mode: username OR e-mail
      username = String(username ?? '').trim();
      password = String(password ?? '');
      email = normEmail(email);
      const key = email || username;
      if (!credLimiter.take(`login:${ip}:${key}`, now())) return { ok: false, error: 'rate_limited' };
      const row = email ? store.accountByEmail(email) : store.accountByName(username);
      if (!row || !row.pass_hash || !verifyPassword(password, row.pass_hash)) return { ok: false, error: 'bad_credentials' };
      if (row.disabled) return { ok: false, error: 'disabled' };
      const newToken = issue({ accountId: row.id, kind: 'account', ttl: ACCOUNT_TTL_MS });
      return { ok: true, token: newToken, account: publicAccount(row), mode: 'password' };
    },
    /**
     * A temporary nickname-only pass (no account, no friends/persistent chat).
     * @returns {{ok:true, token:string, name:string}|{ok:false, error:string}}
     */
    guest(name, { ip = '?' } = {}) {
      name = String(name ?? '').trim().slice(0, 16);
      if (!name) return { ok: false, error: 'bad_name' };
      if (!guestLimiter.take(`guest:${ip}`, now())) return { ok: false, error: 'rate_limited' };
      const token = issue({ kind: 'guest', name, ttl: GUEST_TTL_MS });
      return { ok: true, token, name };
    },
    /**
     * [account-plus] guest → registered account, preserving the guest's chosen name as the public display_name.
     * mode 'token' (default, passwordless) / 'password' / 'email'. The guest pass is retired on success.
     */
    convertGuest(guestToken, { username = '', password = '', email = '', code = '', deviceFp = '', mode = 'token', ip = '?' } = {}) {
      const v = this.verifyToken(String(guestToken ?? ''));
      if (!v.ok || v.kind !== 'guest') return { ok: false, error: 'need_guest' };
      const guestName = v.name || '游客';
      const conflict = deviceConflict(deviceFp); if (conflict) return conflict;
      let uname = String(username ?? '').trim();
      if (!uname) uname = guestName.replace(/[^\w一-龥]/gu, '').slice(0, 16);
      if (!USERNAME_RE.test(uname)) uname = '玩家' + randomBytes(3).toString('hex');
      if (store.accountByName(uname)) uname = uname.slice(0, 10) + randomBytes(3).toString('hex');
      password = String(password ?? '');
      email = normEmail(email);
      const emailMode = mode === 'email';
      const tokenMode = mode === 'token';
      if (emailMode) {
        if (!EMAIL_RE.test(email)) return { ok: false, error: 'bad_email' };
        if (password.length < 6 || password.length > 64) return { ok: false, error: 'bad_password' };
        if (store.accountByEmail(email)) return { ok: false, error: 'email_taken' };
        if (!verifyCode(email, 'register', code)) return { ok: false, error: 'bad_code' };
      } else if (!tokenMode && (password.length < 6 || password.length > 64)) return { ok: false, error: 'bad_password' };
      let account;
      try { account = store.createAccount(uname, tokenMode ? '' : hashPassword(password), 'user', now(), { email: emailMode ? email : '', deviceFp }); }
      catch (e) { log?.error?.('[auth] convert', e); return { ok: false, error: 'taken' }; }
      store.setDisplayName(account.id, guestName);   // keep the guest's identity
      account = store.accountById(account.id);
      store.revokeToken(sha256(String(guestToken)));   // retire the guest pass
      const token = issue({ accountId: account.id, kind: 'account', ttl: tokenMode ? PERMANENT_TTL_MS : ACCOUNT_TTL_MS });
      log?.info?.(`[auth] guest converted → #${account.id} ${uname} (${mode})`);
      return { ok: true, token, account: publicAccount(account), mode };
    },
    /** [account-plus] send a verification code (register / login / reset). */
    sendEmailCode,
    /** [account-plus] whether SMTP is configured (the UI hides e-mail options when false). */
    emailConfigured: mailer.configured,
    /** [account-plus] does this device already own an account? (guides the register form to login) */
    deviceCheck(fp) { const c = deviceConflict(fp); return c ? { hasAccount: true, existing: c.existing } : { hasAccount: false }; },
    /**
     * Resolve a bearer token to its principal.
     * @returns {{ok:true, kind:'account'|'guest', account?:object, name?:string}|{ok:false}}
     */
    verifyToken(token) {
      if (!token || typeof token !== 'string') return { ok: false };
      const row = store.tokenByHash(sha256(token));
      if (!row) return { ok: false };
      if (row.expires_at < now()) { store.revokeToken(row.token_hash); return { ok: false }; }
      if (row.kind === 'account') {
        if (!row.account_id || row.disabled) return { ok: false };
        const name = row.display_name ?? row.username;
        return { ok: true, kind: 'account', account: { id: row.account_id, username: row.username, role: row.role, name, disc: row.discriminator ?? null, tag: row.discriminator != null ? `${name}#${row.discriminator}` : name } };
      }
      return { ok: true, kind: 'guest', name: row.name || '游客' };
    },
    /** Invalidate a token (logout). */
    logout(token) { if (token) store.revokeToken(sha256(token)); },
    close() { clearInterval(sweepTimer); store.close(); },
  };
}
