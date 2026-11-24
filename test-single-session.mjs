// test-single-session.mjs — one active session per account (new hello kicks the old with 4001) + logout revokes the
// token. Guests are exempt. Against PORT 3003 (isolated SP_AUTH_DB).
import WebSocket from 'ws';
const B = 'http://127.0.0.1:3003', WS = 'ws://127.0.0.1:3003/ws';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b, tok) => (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b || {}) })).json();
const get = async (p, tok) => (await fetch(B + p, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class C {
  constructor(token) { this.q = []; this.waiters = []; this.closeCode = null; this.ws = new WebSocket(`${WS}?token=${token}`);
    this.ws.on('close', (code) => { this.closeCode = code; });
    this.ws.on('message', (d) => { let m; try { m = JSON.parse(d.toString()); } catch { return; }
      const i = this.waiters.findIndex((w) => w.type === m.t);
      if (i >= 0) { const [w] = this.waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(m); } else this.q.push(m); }); }
  open() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); setTimeout(() => rej(new Error('open timeout')), 6000); }); }
  send(t, f = {}) { this.ws.send(JSON.stringify({ t, ...f })); }
  next(type, ms = 6000) { const i = this.q.findIndex((m) => m.t === type); if (i >= 0) return Promise.resolve(this.q.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('timeout ' + type)), ms); this.waiters.push({ type, resolve, timer }); }); }
  closed(ms = 6000) { if (this.closeCode != null) return Promise.resolve(this.closeCode);
    return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('close timeout')), ms); this.ws.on('close', (code) => { clearTimeout(t); resolve(code); }); }); }
  async hello(name) { this.send('hello', { name, version: 1 }); return this.next('welcome'); }
  close() { try { this.ws.close(); } catch {} }
}
for (let i = 0; i < 30; i++) { try { await fetch(B + '/healthz'); break; } catch {} await sleep(500); }
const sfx = Math.random().toString(36).slice(2, 7);
const A = await post('/api/auth/register', { username: 'ss_' + sfx });

console.log('[同账号单点登录]');
const a1 = new C(A.token); await a1.open(); const w1 = await a1.hello('一号');
ok(w1.account?.username === 'ss_' + sfx, '第一个会话登录成功');
const a2 = new C(A.token); await a2.open();
const closedP = a1.closed(6000).catch(() => null);
const w2 = await a2.hello('二号');
ok(!!w2.account, '第二个会话（同账号）登录成功');
const code = await closedP;
ok(code === 4001, '第一个会话被顶掉（close 4001）', String(code));
await sleep(300);
ok(a2.ws.readyState === 1, '第二个会话仍在线');

console.log('[游客豁免：可多开]');
const g1 = await post('/api/auth/guest', { name: '客甲' + sfx });
const g2 = await post('/api/auth/guest', { name: '客乙' + sfx });
const ga = new C(g1.token); await ga.open(); await ga.hello('客甲');
const gb = new C(g2.token); await gb.open(); await gb.hello('客乙');
await sleep(400);
ok(ga.ws.readyState === 1 && gb.ws.readyState === 1, '两个游客会话都在线（不互踢）');

console.log('[登出撤销 token]');
const meBefore = await get('/api/auth/me', A.token);
ok(meBefore.ok, '登出前 token 有效');
const lo = await post('/api/auth/logout', {}, A.token);
ok(lo.ok, '登出接口返回 ok');
const meAfter = await get('/api/auth/me', A.token);
ok(!meAfter.ok, '登出后 token 失效');

a1.close(); a2.close(); ga.close(); gb.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
