// test-admin.mjs — verify the seeded admin role flows through login and the WS welcome.
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:3001';
const U = 'root', P = 'admin12345';
const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'password', username: U, password: P }) })).json();
console.log('login ok=', login.ok, 'role=', login.account?.role);
if (!login.ok || login.account?.role !== 'admin') { console.log('✗ 管理员登录/角色失败'); process.exit(1); }
const welcome = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:3001/ws?token=${login.token}`);
  const t = setTimeout(() => { ws.close(); resolve(null); }, 6000);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Root', version: 1 })));
  ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.t === 'welcome') { clearTimeout(t); ws.close(); resolve(m); } });
});
console.log('welcome.account=', JSON.stringify(welcome?.account));
console.log(welcome?.account?.role === 'admin' ? '✓ 管理员角色贯穿 login + welcome' : '✗ welcome 角色失败');
process.exit(welcome?.account?.role === 'admin' ? 0 : 1);
