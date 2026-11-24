// seed-admin.mjs — create (or promote) the first administrator account of the login fork. The admin backend (P2) signs
// in with a normal account whose role is 'admin'; this seeds that role. Run once on the server after deploy:
//
//   node seed-admin.mjs <用户名> <密码>
//
// The password is scrypt-hashed like any account; nothing is printed but the result. Re-running promotes an existing
// account to admin (it does not reset the password unless the account is new).

import { join } from 'node:path';
import { createAuthStore } from './server/auth/store.js';
import { hashPassword } from './server/auth/auth.js';
import { ROOT } from './server/http/config.js';

const [username, password] = process.argv.slice(2);
if (!username || !password) {
  console.error('用法: node seed-admin.mjs <用户名> <密码>');
  process.exit(1);
}
if (password.length < 6) { console.error('密码至少 6 位'); process.exit(1); }

const store = createAuthStore({ dbPath: process.env.SP_AUTH_DB || join(ROOT, 'server', 'auth', 'auth.db') });
const existing = store.accountByName(username);
if (existing) {
  store.setRole(existing.id, 'admin');
  console.log(`已提升为管理员: ${username} (#${existing.id})`);
} else {
  const a = store.createAccount(username, hashPassword(password), 'admin');
  console.log(`已创建管理员: ${username} (#${a.id})`);
}
store.close();
