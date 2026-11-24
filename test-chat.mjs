// test-chat.mjs — P3 chat/friends/PM WebSocket flow test against a fork server on PORT 3002 (isolated SP_AUTH_DB).
import WebSocket from 'ws';
const BASE = 'http://127.0.0.1:3002', WS = 'ws://127.0.0.1:3002/ws';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();

class C {
  constructor(token) { this.q = []; this.waiters = []; this.ws = new WebSocket(`${WS}?token=${token}`);
    this.ws.on('message', (d) => { let m; try { m = JSON.parse(d.toString()); } catch { return; }
      const i = this.waiters.findIndex((w) => w.type === m.t);
      if (i >= 0) { const [w] = this.waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(m); } else this.q.push(m); }); }
  open() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); setTimeout(() => rej(new Error('open timeout')), 6000); }); }
  send(t, f = {}) { this.ws.send(JSON.stringify({ t, ...f })); }
  next(type, ms = 6000) {
    const i = this.q.findIndex((m) => m.t === type);
    if (i >= 0) return Promise.resolve(this.q.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('timeout ' + type)), ms);
      this.waiters.push({ type, resolve, timer }); });
  }
  async hello(name) { this.send('hello', { name, version: 1 }); return this.next('welcome'); }
  close() { try { this.ws.close(); } catch {} }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 30; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await sleep(500); }
const suffix = Math.random().toString(36).slice(2, 7);
const A = await post('/api/auth/register', { username: 'alice_' + suffix, password: 'pass12345' });
const B = await post('/api/auth/register', { username: 'bob_' + suffix, password: 'pass12345' });
const aid = A.account.id, bid = B.account.id;

console.log('[大厅聊天]');
const a = new C(A.token); await a.open(); const aw = await a.hello('Alice');
const b = new C(B.token); await b.open(); await b.hello('Bob');
ok(aw.account?.id === aid, 'alice 连接 welcome 带账号');
a.send('chat.history', {}); const hist0 = await a.next('chat.history'); ok(Array.isArray(hist0.messages), 'chat.history 返回数组');
a.send('chat.send', { body: '大家好' });
const la = await a.next('chat.lobby'); const lb = await b.next('chat.lobby');
ok(la.body === '大家好' && lb.body === '大家好', '大厅消息广播给所有人', JSON.stringify(lb));
const g = await post('/api/auth/guest', { name: '游客' + suffix });
const gc = new C(g.token); await gc.open(); await gc.hello('游客');
gc.send('chat.send', { body: '游客也能说' });
const lg = await a.next('chat.lobby'); ok(lg.body === '游客也能说' && lg.guest === true, '游客可发大厅聊天');

console.log('[限频]');
let limited = false;
a.send('chat.send', { body: '1' }); a.send('chat.send', { body: '2' }); a.send('chat.send', { body: '3' }); a.send('chat.send', { body: '4' });
try { const e = await a.next('chat.error', 3000); limited = e.error === 'rate_limited'; } catch {}
ok(limited, '大厅发言限频触发');

console.log('[好友]');
gc.send('friend.request', { toId: bid }); const ge = await gc.next('friend.result'); ok(ge.error === 'need_account', '游客加好友被拒 need_account');
a.send('friend.request', { toId: bid });
const req = await b.next('friend.request'); ok(req.fromId === aid, 'bob 收到好友申请');
const ar = await a.next('friend.result'); ok(ar.ok, 'alice 申请发送成功');
b.send('friend.respond', { fromId: aid, accept: true });
const acc = await a.next('friend.accepted'); ok(acc.byId === bid, 'alice 收到同意通知');
await sleep(200);
a.send('friend.list', {}); const fl = await a.next('friend.list');
ok(fl.friends.some((f) => f.accountId === bid && f.online), 'alice 好友列表含在线 bob');

console.log('[私聊 + 离线送达]');
a.send('pm.send', { toId: bid, body: '在吗' });
const pm = await b.next('pm.message'); ok(pm.body === '在吗' && pm.fromId === aid, 'bob 收到在线私聊');
const echo = await a.next('pm.message'); ok(echo.self === true, 'alice 收到自己的私聊回显');
b.close(); await sleep(600);
a.send('pm.send', { toId: bid, body: '离线留言' });
const off = await a.next('pm.message'); ok(off.offline === true, '对方离线时私聊标记 offline');
const b2 = new C(B.token); await b2.open(); await b2.hello('Bob');
const delivered = await b2.next('pm.message', 6000); ok(delivered.body === '离线留言' && delivered.offline === true, 'bob 重连后收到离线私聊');
a.send('pm.history', { otherId: bid }); const ph = await a.next('pm.history'); ok(ph.messages.some((m) => m.body === '离线留言'), '私聊历史持久化');

a.close(); gc.close(); b2.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
