// test-namesync-e2e.mjs — [name-sync] play name == profile display_name; login username not searchable; live rename
// broadcasts the room; [friend-gate] profile carries isFriend/isSelf. Against PORT 3005 (isolated SP_AUTH_DB).
import WebSocket from 'ws';
const B = 'http://127.0.0.1:3005', WS = 'ws://127.0.0.1:3005/ws';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b, t) => (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) })).json();
const get = async (p, t) => (await fetch(B + p, { headers: t ? { Authorization: `Bearer ${t}` } : {} })).json();
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
const A = await post('/api/auth/register', { username: 'na_' + sfx });
const Bb = await post('/api/auth/register', { username: 'nb_' + sfx });
const aId = (await get('/api/auth/me', A.token)).account.id;
const bId = (await get('/api/auth/me', Bb.token)).account.id;

console.log('[改名 → 游戏内名字同步]');
const rn = await post('/api/player/rename', { name: '公开甲' }, A.token);
ok(rn.ok && rn.profile.name === '公开甲', 'rename 成功');
const a = new C(A.token); await a.open();
const wa = await a.hello('客户端昵称');
ok(wa.name === '公开甲', 'welcome.name == 主页 display_name（覆盖 hello 昵称）', JSON.stringify(wa.name));
const b = new C(Bb.token); await b.open();
const wb = await b.hello('Bob');
ok(wb.name === 'nb_' + sfx, '未改名账号 welcome.name == 默认 display_name', JSON.stringify(wb.name));

console.log('[账号名只用于登录，不可搜索加好友]');
const byLogin = await get('/api/player/search?q=na_' + sfx, A.token);
ok((byLogin.results || []).length === 0, '搜索登录用户名 → 0 结果', JSON.stringify(byLogin.results));
const byName = await get('/api/player/search?q=公开甲', A.token);
ok((byName.results || []).some((p) => p.id === aId), '搜索公开名 → 命中');

console.log('[friend-gate: profile isFriend / isSelf]');
const pf0 = await get('/api/player/profile?id=' + bId, A.token);
ok(pf0.ok && pf0.profile.isFriend === false && pf0.profile.isSelf === false, '非好友 isFriend=false');
const pfSelf = await get('/api/player/profile?id=' + aId, A.token);
ok(pfSelf.profile.isSelf === true, '自己 isSelf=true');
a.send('friend.request', { toId: bId });
await a.next('friend.result', 5000);
await b.next('friend.request', 5000);
b.send('friend.respond', { fromId: aId, accept: true });
await a.next('friend.accepted', 5000);
const pf1 = await get('/api/player/profile?id=' + bId, A.token);
ok(pf1.profile.isFriend === true, '互为好友后 isFriend=true');

console.log('[房间内改名 → 广播新名字]');
a.send('room.create', { mode: 'coop' });
const rs = await a.next('room.state', 8000);
const code = rs.code;
b.send('room.join', { code });
await b.next('room.state', 8000);
await post('/api/player/rename', { name: '公开甲2' }, A.token);
const bs = await b.next('room.state', 8000);
ok(JSON.stringify(bs).includes('公开甲2'), '改名后房间广播含新名字', JSON.stringify((bs.seats || []).filter(Boolean).map((s) => s.name)));

a.close(); b.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
