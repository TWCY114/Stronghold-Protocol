// test-auth.mjs — P1 backend integration test against a running fork server (PORT 3001). Run: node test-auth.mjs
import WebSocket from 'ws';
import { randPass } from './_test-creds.mjs'; // [auth-fork]

const BASE = 'http://127.0.0.1:3001';
const WS = 'ws://127.0.0.1:3001/ws';
const U = 'alice_' + Math.random().toString(36).slice(2, 8);   // unique per run (the store persists; no deletion)
const PW = randPass();   // random per run; no fixed password committed
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${extra}`); } };

async function waitUp() {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
// A WS attempt: resolves { rejected: status } on non-101, or { welcome } after a hello round-trip.
function wsAttempt(url, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve({ timeout: true }); }, 6000);
    ws.on('unexpected-response', (_req, res) => { clearTimeout(timer); resolve({ rejected: res.statusCode }); });
    ws.on('error', (e) => { clearTimeout(timer); resolve({ error: String(e.message || e) }); });
    ws.on('open', () => { if (hello) ws.send(JSON.stringify(hello)); else { clearTimeout(timer); ws.close(); resolve({ opened: true }); } });
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.t === 'welcome') { clearTimeout(timer); ws.close(); resolve({ welcome: m }); }
      else if (m.t === 'error') { clearTimeout(timer); ws.close(); resolve({ errorMsg: m }); }
    });
  });
}

const up = await waitUp();
if (!up) { console.log('服务器未就绪'); process.exit(1); }
console.log('服务器就绪，开始 P1 测试\n');

console.log('[账号 API]');
const reg = await post('/api/auth/register', { mode: 'password', username: U, password: PW });
ok(reg.status === 200 && reg.json?.ok && reg.json.token, '注册 ' + U + ' 成功并返回 token', JSON.stringify(reg.json));
const tokenA = reg.json?.token;
ok(reg.json?.account?.username === U && reg.json?.account?.role === 'user', '注册返回账号信息');

const dup = await post('/api/auth/register', { mode: 'password', username: U, password: PW });
ok(dup.status === 400 && dup.json?.error === 'taken', '重复注册被拒 (taken)', JSON.stringify(dup.json));

const badUser = await post('/api/auth/register', { mode: 'password', username: 'a', password: PW });
ok(badUser.json?.error === 'bad_username', '非法用户名被拒');
const badPass = await post('/api/auth/register', { mode: 'password', username: 'bob', password: '123' });
ok(badPass.json?.error === 'bad_password', '短密码被拒');

const login = await post('/api/auth/login', { mode: 'password', username: U, password: PW });
ok(login.status === 200 && login.json?.ok && login.json.token, '登录成功');
const wrong = await post('/api/auth/login', { mode: 'password', username: U, password: 'wrongpass' });
ok(wrong.status === 401 && wrong.json?.error === 'bad_credentials', '错误密码被拒 (401)');

const guest = await post('/api/auth/guest', { name: '访客小明' });
ok(guest.status === 200 && guest.json?.ok && guest.json.token && guest.json.name === '访客小明', '游客入口返回临时 token');
const tokenG = guest.json?.token;

const me = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenA}` } }).then((r) => r.json());
ok(me.ok && me.kind === 'account' && me.account?.username === U, '/me 解析账号 token');
const meNone = await fetch(`${BASE}/api/auth/me`).then((r) => r.json());
ok(meNone.ok === false, '/me 无 token 返回 ok:false');

const loginPage = await fetch(`${BASE}/login`);
ok(loginPage.status === 200, '/login 页返回 200（页面文件待建）', `status=${loginPage.status}`);

console.log('\n[WS 闸门]');
const noTok = await wsAttempt(WS, null);
ok(noTok.rejected === 401, '无 token 升级被拒 401', JSON.stringify(noTok));
const badTok = await wsAttempt(`${WS}?token=deadbeef`, null);
ok(badTok.rejected === 403, '无效 token 升级被拒 403', JSON.stringify(badTok));

const accConn = await wsAttempt(`${WS}?token=${tokenA}`, { t: 'hello', name: 'Alice', version: 1 });
ok(accConn.welcome?.account?.username === U && accConn.welcome?.account?.role === 'user', '账号 token 连接 → welcome 带账号', JSON.stringify(accConn.welcome?.account || accConn));
const guestConn = await wsAttempt(`${WS}?token=${tokenG}`, { t: 'hello', name: '访客小明', version: 1 });
ok(guestConn.welcome?.guest === true, '游客 token 连接 → welcome guest:true', JSON.stringify(guestConn.welcome?.guest ?? guestConn));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
