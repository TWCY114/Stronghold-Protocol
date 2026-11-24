// test-token-auth.mjs — token-only register/login (default) + password mode, against PORT 3003 (isolated SP_AUTH_DB).
import { randPass } from './_test-creds.mjs'; // [auth-fork]
const B = 'http://127.0.0.1:3003';
const PW = randPass();   // random per run; no fixed password committed
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b) => (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
for (let i = 0; i < 30; i++) { try { await fetch(B + '/healthz'); break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const sfx = Math.random().toString(36).slice(2, 7);

console.log('[token-only 注册（默认，免密码）]');
const r1 = await post('/api/auth/register', { username: 'tok_' + sfx });
ok(r1.ok && r1.token && r1.mode === 'token', '默认注册即 token 模式', JSON.stringify({ ok: r1.ok, mode: r1.mode }));
ok(!r1.error, '无密码也能注册');
const T = r1.token;
const r2 = await post('/api/auth/register', { username: 'tok_' + sfx });
ok(r2.error === 'taken', '重名拒绝');

console.log('[token 登录（默认）]');
const l1 = await post('/api/auth/login', { token: T });
ok(l1.ok && l1.account?.username === 'tok_' + sfx && l1.mode === 'token', 'token 登录成功', JSON.stringify({ ok: l1.ok, mode: l1.mode }));
const l2 = await post('/api/auth/login', { token: 'deadbeef' });
ok(l2.error === 'bad_token', '坏 token 拒绝');
const me = await (await fetch(B + '/api/auth/me', { headers: { Authorization: 'Bearer ' + T } })).json();
ok(me.ok && me.account, '永久 token 通过 /me');

console.log('[token-only 账号不能用密码登录]');
const l3 = await post('/api/auth/login', { mode: 'password', username: 'tok_' + sfx, password: randPass() });
ok(l3.error === 'bad_credentials', '无密码账号密码登录被拒');

console.log('[password 模式仍可用]');
const r3 = await post('/api/auth/register', { mode: 'password', username: 'pw_' + sfx, password: PW });
ok(r3.ok && r3.mode === 'password', 'password 注册');
const l4 = await post('/api/auth/login', { mode: 'password', username: 'pw_' + sfx, password: PW });
ok(l4.ok && l4.mode === 'password', 'password 登录');
const l5 = await post('/api/auth/login', { mode: 'password', username: 'pw_' + sfx, password: 'wrong' });
ok(l5.error === 'bad_credentials', '错密码拒绝');

console.log('[游客不受影响]');
const g = await post('/api/auth/guest', { name: 'guest' });
ok(g.ok && g.token, '游客通行');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
