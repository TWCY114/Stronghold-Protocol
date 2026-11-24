// test-player.mjs — player identity: name#discriminator search (exact + same-name list), profile, rename, friends w/ tag.
// Against PORT 3004 (isolated SP_AUTH_DB=test4.db).
import WebSocket from 'ws';
const B = 'http://127.0.0.1:3004', WS = 'ws://127.0.0.1:3004/ws';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b, tok) => (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(b || {}) })).json();
const get = async (p, tok) => (await fetch(B + p, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })).json();
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
const NM = '测试玩家' + sfx, SOLO = '独行玩家' + sfx;
const alice = await post('/api/auth/register', { username: 'al_' + sfx });
const bob = await post('/api/auth/register', { username: 'bo_' + sfx });
const carol = await post('/api/auth/register', { username: 'ca_' + sfx });

console.log('[注册即带 tag]');
ok(alice.account?.tag && /#\d{4}$/.test(alice.account.tag), '注册返回 name#编号', alice.account?.tag);

console.log('[改名 + 同名编号唯一]');
const ra = await post('/api/player/rename', { name: NM }, alice.token);
const rb = await post('/api/player/rename', { name: NM }, bob.token);
await post('/api/player/rename', { name: SOLO }, carol.token);
ok(ra.ok && ra.profile.name === NM, 'alice 改名成功');
ok(ra.profile.disc !== rb.profile.disc, '同名两人编号不同', `${ra.profile.disc} vs ${rb.profile.disc}`);
const bad = await post('/api/player/rename', { name: 'x' }, alice.token);
ok(!bad.ok && bad.error === 'bad_name', '非法名字被拒（太短）');

console.log('[搜索：名字列出所有同名 / 名#编号精确]');
const byName = await get('/api/player/search?q=' + encodeURIComponent(NM));
ok(byName.results.length === 2, '只搜名字 → 列出 2 个同名', String(byName.results.length));
const exact = await get('/api/player/search?q=' + encodeURIComponent(NM + '#' + ra.profile.disc));
ok(exact.results.length === 1 && exact.results[0].id === alice.account.id, '名#编号 → 精确一人');
const solo = await get('/api/player/search?q=' + encodeURIComponent(SOLO));
ok(solo.results.length === 1 && solo.results[0].id === carol.account.id, '搜另一名字 → 1 人');
const none = await get('/api/player/search?q=' + encodeURIComponent('不存在的人'));
ok(none.results.length === 0, '搜不到 → 空列表');

console.log('[名片 profile / 自己 me]');
const prof = await get('/api/player/profile?id=' + alice.account.id);
ok(prof.ok && prof.profile.tag === ra.profile.tag && typeof prof.profile.friendsCount === 'number', 'profile 带 tag+好友数');
const me = await get('/api/player/me', alice.token);
ok(me.ok && me.profile.id === alice.account.id, 'me 返回自己名片');
const meGuest = await get('/api/player/me');
ok(!meGuest.ok, '未登录 me 被拒');

console.log('[好友列表带 tag（WS 加好友）]');
const ca = new C(alice.token); await ca.open(); await ca.hello('爱丽丝');
const cb = new C(bob.token); await cb.open(); await cb.hello('鲍勃');
ca.send('friend.request', { toId: bob.account.id });
await cb.next('friend.request');
cb.send('friend.respond', { fromId: alice.account.id, accept: true });
await ca.next('friend.accepted');
await sleep(300);
const fr = await get('/api/player/friends', alice.token);
ok(fr.ok && fr.friends.length === 1 && fr.friends[0].tag === rb.profile.tag, '好友列表带对方 tag', fr.friends[0]?.tag);
ok(fr.friends[0].online === true, '好友在线状态正确');
ca.close(); cb.close();

console.log('[编号全局唯一且固定]');
const before = (await get('/api/player/profile?id=' + alice.account.id)).profile.disc;
await post('/api/player/rename', { name: '换个名字' + sfx }, alice.token);
const after = (await get('/api/player/profile?id=' + alice.account.id)).profile.disc;
ok(before === after, '改名后编号保持不变', `${before} -> ${after}`);
ok(ra.profile.disc !== rb.profile.disc, '不同账号编号全局唯一');

console.log('[注销账号]');
const tmp = await post('/api/auth/register', { username: 'del_' + sfx });
const tmpId = tmp.account.id;
ok((await post('/api/player/delete', {}, tmp.token)).ok, '注销成功');
ok(!(await get('/api/player/me', tmp.token)).ok, '注销后 token 失效');
ok(!(await get('/api/player/profile?id=' + tmpId)).ok, '注销后账号不存在');
ok((await get('/api/player/search?q=' + encodeURIComponent('del_' + sfx))).results.length === 0, '注销后搜不到');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
