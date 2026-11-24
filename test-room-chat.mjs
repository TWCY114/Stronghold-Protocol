// test-room-chat.mjs — room-channel chat (members only) vs world channel, against PORT 3003 (isolated SP_AUTH_DB).
import WebSocket from 'ws';
const B = 'http://127.0.0.1:3003', WS = 'ws://127.0.0.1:3003/ws';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b) => (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
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
  has(type, pred = () => true) { return this.q.some((m) => m.t === type && pred(m)); }
  async hello(name) { this.send('hello', { name, version: 1 }); return this.next('welcome'); }
  close() { try { this.ws.close(); } catch {} }
}
for (let i = 0; i < 30; i++) { try { await fetch(B + '/healthz'); break; } catch {} await sleep(500); }
const sfx = Math.random().toString(36).slice(2, 7);
const A = await post('/api/auth/register', { username: 'ra_' + sfx });
const Bb = await post('/api/auth/register', { username: 'rb_' + sfx });
const Cc = await post('/api/auth/register', { username: 'rc_' + sfx });
const a = new C(A.token); await a.open(); await a.hello('Alice');
const b = new C(Bb.token); await b.open(); await b.hello('Bob');
const c = new C(Cc.token); await c.open(); await c.hello('Charlie');

console.log('[建房 / 加入]');
a.send('room.create', { mode: 'coop' });
const rs = await a.next('room.state', 8000);
const code = rs.code;
ok(!!code, 'alice 建房拿到房号', code);
b.send('room.join', { code });
await b.next('room.state', 8000);
ok(true, 'bob 加入房间');
await sleep(400);

console.log('[房间频道：仅房员可见]');
a.send('chat.send', { body: '房间秘密_' + sfx, channel: 'room' });
const rb = await b.next('chat.lobby', 5000);
ok(rb.channel === 'room' && rb.body.includes('房间秘密'), 'bob（房员）收到房间消息', JSON.stringify({ ch: rb.channel }));
const ra = await a.next('chat.lobby', 5000);
ok(ra.channel === 'room', 'alice 自己收到房间消息');
await sleep(600);
ok(!c.has('chat.lobby', (m) => m.channel === 'room'), 'charlie（非房员）收不到房间消息');

console.log('[世界频道：全员可见]');
a.send('chat.send', { body: '世界广播_' + sfx, channel: 'world' });
const wc = await c.next('chat.lobby', 5000);
ok(wc.channel === 'world' && wc.body.includes('世界广播'), 'charlie 收到世界消息');

console.log('[房间历史]');
a.send('chat.history', { channel: 'room' });
const rh = await a.next('chat.history', 5000);
ok(rh.channel === 'room' && rh.messages.some((m) => m.body.includes('房间秘密')), '房间历史持久化');

a.close(); b.close(); c.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
