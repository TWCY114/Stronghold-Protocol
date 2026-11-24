// test-invite-e2e.mjs — friend badge data + online-friend invite + accept-join, against PORT 3005 (isolated SP_AUTH_DB).
import WebSocket from 'ws';
const B = 'http://127.0.0.1:3005', WS = 'ws://127.0.0.1:3005/ws';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b) => (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const get = async (p, t) => (await fetch(B + p, { headers: { Authorization: `Bearer ${t}` } })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class C {
  constructor(token) { this.q = []; this.waiters = []; this.ws = new WebSocket(`${WS}?token=${token}`);
    this.ws.on('message', (d) => { let m; try { m = JSON.parse(d.toString()); } catch { return; }
      const i = this.waiters.findIndex((w) => w.type === m.t);
      if (i >= 0) { const [w] = this.waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(m); } else this.q.push(m); }); }
  open() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); setTimeout(() => rej(new Error('open timeout')), 6000); }); }
  send(t, f = {}) { this.ws.send(JSON.stringify({ t, ...f })); }
  next(type, ms = 6000) { const i = this.q.findIndex((m) => m.t === type); if (i >= 0) return Promise.resolve(this.q.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('timeout ' + type)), ms); this.waiters.push({ type, resolve, timer }); }); }
  async hello(name) { this.send('hello', { name, version: 1 }); return this.next('welcome'); }
  close() { try { this.ws.close(); } catch {} }
}
for (let i = 0; i < 30; i++) { try { await fetch(B + '/healthz'); break; } catch {} await sleep(500); }
const sfx = Math.random().toString(36).slice(2, 7);
const A = await post('/api/auth/register', { username: 'ia_' + sfx });
const Bb = await post('/api/auth/register', { username: 'ib_' + sfx });
const aId = (await get('/api/auth/me', A.token)).account.id;
const bId = (await get('/api/auth/me', Bb.token)).account.id;
const a = new C(A.token); await a.open(); await a.hello('Alice');
const b = new C(Bb.token); await b.open(); await b.hello('Bob');

console.log('[好友请求 → 角标数据]');
a.send('friend.request', { toId: bId });
await a.next('friend.result', 5000); // consume the request ack so the later invite ack is clean
const req = await b.next('friend.request', 5000);
ok(req.fromId === aId, 'bob 收到好友请求（角标来源）');
b.send('friend.list', {});
const bl = await b.next('friend.list', 5000);
ok(bl.requests.length === 1, 'bob friend.list 待处理=1（红角标计数）', JSON.stringify(bl.requests.length));
b.send('friend.respond', { fromId: aId, accept: true });
await a.next('friend.accepted', 5000);
b.send('friend.list', {});
const bl2 = await b.next('friend.list', 5000);
ok(bl2.requests.length === 0 && bl2.friends.some((f) => f.accountId === aId && f.online), '同意后角标清零且互为在线好友');

console.log('[建房 → 邀请在线好友 → 弹框数据]');
a.send('room.create', { mode: 'coop' });
const rs = await a.next('room.state', 8000);
const code = rs.code;
a.send('friend.invite', { toId: bId });
const sent = await a.next('friend.result', 5000);
ok(sent.ok === true && sent.action === 'invite', 'alice 邀请发送成功');
const inv = await b.next('friend.invite', 5000);
ok(inv.roomCode === code && inv.fromId === aId, 'bob 收到邀请弹框数据（房号+邀请人）', JSON.stringify({ code: inv.roomCode, from: inv.fromId }));

console.log('[接受 → 自动加入 + 回执]');
b.send('friend.invite.respond', { fromId: aId, accept: true });
const res = await a.next('friend.invite.result', 5000);
ok(res.accept === true && res.byId === bId, 'alice 收到接受回执');
b.send('room.join', { code });
const bj = await b.next('room.state', 8000);
ok(bj.code === code, 'bob 接受后加入同一房间');

console.log('[拒绝路径]');
a.send('friend.invite', { toId: bId });
await b.next('friend.invite', 5000);
b.send('friend.invite.respond', { fromId: aId, accept: false });
const res2 = await a.next('friend.invite.result', 5000);
ok(res2.accept === false, 'alice 收到拒绝回执');

a.close(); b.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
