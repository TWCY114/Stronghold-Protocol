// test-admin-api.mjs — P2 admin backend test against a fork server on PORT 3002 (isolated SP_AUTH_DB).
import { adminPass, randPass } from './_test-creds.mjs'; // [auth-fork]
const BASE = 'http://127.0.0.1:3002';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json().catch(() => null) };
}
for (let i = 0; i < 30; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const admin = await call('/api/auth/login', { method: 'POST', body: { mode: 'password', username: 'root', password: adminPass() } });
ok(admin.j?.ok && admin.j.account?.role === 'admin', '管理员登录');
const T = admin.j?.token;

console.log('[鉴权]');
const noTok = await call('/api/admin/stats');
ok(noTok.status === 403, '无 token 访问 admin → 403');
const guest = await call('/api/auth/guest', { method: 'POST', body: { name: '游客' } });
const guestStats = await call('/api/admin/stats', { token: guest.j?.token });
ok(guestStats.status === 403, '游客 token 访问 admin → 403');

console.log('[统计 / 列表]');
const stats = await call('/api/admin/stats', { token: T });
ok(stats.j?.ok && typeof stats.j.current?.online === 'number' && Array.isArray(stats.j.history), 'stats 返回 current + history', JSON.stringify(stats.j?.current));
ok(stats.j.history.length >= 1, '采样器已产生数据点', `len=${stats.j?.history?.length}`);
const players = await call('/api/admin/players', { token: T });
ok(players.j?.ok && Array.isArray(players.j.players), 'players 列表');
const rooms = await call('/api/admin/rooms', { token: T });
ok(rooms.j?.ok && Array.isArray(rooms.j.rooms), 'rooms 列表');
const accounts = await call('/api/admin/accounts', { token: T });
ok(accounts.j?.ok && accounts.j.accounts.some((a) => a.username === 'root'), 'accounts 列表含 root');

console.log('[账号 CRUD]');
const U = 'tester_' + Math.random().toString(36).slice(2, 7);
const create = await call('/api/admin/accounts', { method: 'POST', token: T, body: { username: U, password: randPass(), role: 'user' } });
ok(create.j?.ok && create.j.account?.id, '创建账号', JSON.stringify(create.j));
const id = create.j?.account?.id;
ok((await call('/api/admin/account', { method: 'POST', token: T, body: { id, action: 'disable' } })).j?.ok, '停用账号');
ok((await call('/api/admin/account', { method: 'POST', token: T, body: { id, action: 'enable' } })).j?.ok, '启用账号');
ok((await call('/api/admin/account', { method: 'POST', token: T, body: { id, action: 'role', role: 'admin' } })).j?.ok, '改角色');
ok((await call('/api/admin/account', { method: 'POST', token: T, body: { id, action: 'reset-password', password: randPass() } })).j?.ok, '重置密码');
const del = await call('/api/admin/account', { method: 'POST', token: T, body: { id, action: 'delete' } });
ok(del.j?.ok, '删除账号');
const after = await call('/api/admin/accounts', { token: T });
ok(!after.j.accounts.some((a) => a.id === id), '删除后列表不含该账号');

console.log('[踢人 / 结束 边界]');
ok((await call('/api/admin/kick', { method: 'POST', token: T, body: { playerId: 'p_nonexist' } })).j?.error === 'no_player', '踢不存在玩家 → no_player');
ok((await call('/api/admin/end-room', { method: 'POST', token: T, body: { code: 'ZZZZ' } })).j?.error === 'no_room', '结束不存在房间 → no_room');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
