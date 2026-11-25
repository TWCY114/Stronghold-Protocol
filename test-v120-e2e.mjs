// test-v120-e2e.mjs — [v1.2.0] dup-fix / mute scopes+expiry / ban+unban / report+history / switches / rates / SMTP /
// grant-title(any player) / plugin upload+unlist+relist. Against PORT 3005 (isolated SP_AUTH_DB, seeded root admin).
import WebSocket from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const root = await post('/api/auth/login', { username: 'root', password: process.env.SP_TEST_ADMIN_PASSWORD || 'Test#Admin3005', mode: 'password' });
ok(root.ok && root.token, 'root 管理员登录');
const T = root.token;
// raise rates so the many probe messages below are not rate-limited (rate test re-tightens later)
await post('/api/admin/config', { rates: { world: { max: 60, windowMs: 5000 }, room: { max: 60, windowMs: 5000 }, pm: { max: 60, windowMs: 5000 } } }, T);
const sfx = Math.random().toString(36).slice(2, 7);
const PW = 'Pass#12345';
const U1 = await post('/api/auth/register', { username: 'a_' + sfx, password: PW, mode: 'password' });
const U2 = await post('/api/auth/register', { username: 'b_' + sfx, password: PW, mode: 'password' });
const id1 = (await get('/api/auth/me', U1.token)).account.id;
const id2 = (await get('/api/auth/me', U2.token)).account.id;
let u1 = new C(U1.token); await u1.open(); await u1.hello('A');
const u2 = new C(U2.token); await u2.open(); await u2.hello('B');
// PM requires friendship; make u1/u2 friends so the mute-scope PM checks are meaningful.
u1.send('friend.request', { toId: id2 });
await u2.next('friend.request', 5000);
u2.send('friend.respond', { fromId: id1, accept: true });
await sleep(400);

console.log('[B1 dup-fix: 直播与历史同一时间戳，合并不重复]');
const DUP = 'dup测试' + sfx;
u1.send('chat.send', { body: DUP, channel: 'world' });
const live = await u2.next('chat.lobby', 5000);
u1.send('chat.history', { channel: 'world' });
const hist = await u1.next('chat.history', 5000);
const stored = (hist.messages || []).find((x) => x.body === DUP);
const storedAt = stored && (stored.at || stored.created_at);
ok(stored && storedAt === live.at, '历史行 created_at === 直播 at', JSON.stringify({ s: storedAt, l: live.at }));
const key = (m) => `${m.at || m.created_at}|${m.name || m.fromName}|${m.body}`;
const seen = new Set(); const merged = [];
for (const x of [...(hist.messages || []), live]) { const k = key(x); if (!seen.has(k)) { seen.add(k); merged.push(x); } }
ok(merged.filter((x) => x.body === DUP).length === 1, 'live+history 去重后该消息仅一条');

console.log('[titles: 授予任意玩家 world 称号 + 主页称号/徽章]');
const g = await post('/api/admin/grant-title', { id: id1, world: '大神', profile: '盟约元老', badge: '★先锋' }, T);
ok(g.ok && g.world === '大神' && g.profile === '盟约元老' && g.badge === '★先锋', 'grant-title 回显', JSON.stringify(g));
u1.send('chat.send', { body: '称号测试', channel: 'world' });
const tl = await u2.next('chat.lobby', 5000);
ok(tl.title === '大神' && tl.accountId === id1, '非管理员世界消息带授予的 title', JSON.stringify(tl.title));
const prof = (await get('/api/player/profile?id=' + id1)).profile || {};
ok(prof.profile_title === '盟约元老' && prof.profile_badge === '★先锋', '名片返回 profile 称号/徽章', JSON.stringify({ t: prof.profile_title, b: prof.profile_badge }));

console.log('[mute: lobby / room / all 三范围精确控制]');
await post('/api/admin/mute', { id: id1, scope: 'lobby', minutes: 5 }, T);
u1.send('chat.send', { body: '应被禁', channel: 'world' });
ok((await u1.next('chat.error', 5000)).error === 'muted', 'lobby 禁言挡世界');
u1.send('pm.send', { toId: id2, body: '私聊仍可用' });
await u2.next('pm.message', 5000);
ok(true, 'lobby 禁言不影响私聊');
await post('/api/admin/unmute', { id: id1, scope: 'lobby' }, T);
u1.send('chat.send', { body: '解除后世界', channel: 'world' });
await u2.next('chat.lobby', 5000);
ok(true, '解除 lobby 后世界恢复');
// room scope
u1.send('room.create', { mode: 'coop' });
const rs = await u1.next('room.state', 6000);
const code = rs.code;
u2.send('room.join', { code });
await u2.next('room.state', 6000);
await post('/api/admin/mute', { id: id1, scope: 'room', minutes: 5 }, T);
u1.send('chat.send', { body: '房间应被禁', channel: 'room' });
ok((await u1.next('chat.error', 5000)).error === 'muted', 'room 禁言挡房间');
u1.send('chat.send', { body: '世界仍可用', channel: 'world' });
await u2.next('chat.lobby', 5000);
ok(true, 'room 禁言不影响世界');
await post('/api/admin/unmute', { id: id1, scope: 'room' }, T);
// all scope
await post('/api/admin/mute', { id: id1, scope: 'all', minutes: 5 }, T);
u1.send('chat.send', { body: 'all世界', channel: 'world' });
ok((await u1.next('chat.error', 5000)).error === 'muted', 'all 禁言挡世界');
u1.send('pm.send', { toId: id2, body: 'all私聊' });
ok((await u1.next('chat.error', 5000)).error === 'muted', 'all 禁言挡私聊');
await post('/api/admin/unmute', { id: id1, scope: 'all' }, T);
const ml = await get('/api/admin/mutes', T);
ok(ml.ok && !ml.mutes.some((m) => m.account_id === id1), '解除后 mutes 列表无该玩家');

console.log('[mute expiry: 到期自动解除（store 单元）]');
{
  const dir = mkdtempSync(join(tmpdir(), 'sp-mute-'));
  const { createAuthStore } = await import('./server/auth/store.js');
  const st = createAuthStore({ dbPath: join(dir, 'm.db'), log: { info() {}, warn() {}, error() {} } });
  const now = Date.now();
  st.addMute(999, 'all', now - 1000, null, now);
  ok(st.mutesOf(999, now).length === 0, '过期禁言被 mutesOf 丢弃');
  st.addMute(999, 'lobby', 0, null, now);
  ok(st.mutesOf(999, now).some((m) => m.scope === 'lobby'), '永久禁言保留');
  st.removeMute(999, null);
  ok(st.mutesOf(999, now).length === 0, 'removeMute 清空');
  try { st.close ? st.close() : st.db.close(); } catch {}
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch {}
}

console.log('[report: 名片举报 + 后台调取聊天记录 + 处理]');
u2.send('chat.report', { targetId: id1 });
const rr = await u2.next('chat.report.result', 5000);
ok(rr.ok, '举报回执 ok', JSON.stringify(rr));
const reps = await get('/api/admin/reports', T);
const rep = (reps.reports || []).find((r) => r.target === id1);
ok(rep && rep.reason === '发言不善', '后台举报列表含目标+理由', JSON.stringify(rep));
const ch = await get('/api/admin/chat-history?id=' + id1, T);
ok(ch.ok && (ch.history.world || []).some((x) => x.body === DUP), '后台调取该玩家世界记录');
await post('/api/admin/report-action', { id: rep.id, action: 'mute', scope: 'lobby', minutes: 5 }, T);
u1.send('chat.send', { body: '举报后禁言', channel: 'world' });
ok((await u1.next('chat.error', 5000)).error === 'muted', 'report-action mute 生效');
await post('/api/admin/unmute', { id: id1, scope: 'lobby' }, T);
const reps2 = await get('/api/admin/reports?status=actioned', T);
ok((reps2.reports || []).some((r) => r.id === rep.id), '举报状态 actioned');

console.log('[switches: 关闭注册 / 游客 / 聊天]');
await post('/api/admin/config', { register: false }, T);
ok((await post('/api/auth/register', { username: 'c_' + sfx })).error === 'register_closed', '注册关闭拒绝');
await post('/api/admin/config', { guest: false }, T);
ok((await post('/api/auth/guest', {})).error === 'guest_closed', '游客关闭拒绝');
await post('/api/admin/config', { register: true, guest: true }, T);
ok((await post('/api/auth/register', { username: 'c_' + sfx })).ok, '恢复注册可用');
const pub = await get('/api/config');
ok(pub.guest === true && pub.register === true && pub.chatEnabled === true, '公共 /api/config 开关回显');
await post('/api/admin/config', { chatEnabled: false }, T);
u1.send('chat.send', { body: '关聊天', channel: 'world' });
ok((await u1.next('chat.error', 5000)).error === 'chat_off', '关闭聊天挡世界（含管理员稍后验证）');
u1.send('pm.send', { toId: id2, body: '关聊天私聊' });
ok((await u1.next('chat.error', 5000)).error === 'chat_off', '关闭聊天挡私聊');
const rootC = new C(T); await rootC.open(); await rootC.hello('Root');
rootC.send('chat.send', { body: '管理员也关', channel: 'world' });
ok((await rootC.next('chat.error', 5000)).error === 'chat_off', '关闭聊天含管理员');
const annOff = await post('/api/admin/announce', { text: '关聊天时公告仍发' }, T);
ok(annOff.ok, '关闭聊天时公告接口仍可用');
await u2.next('announce', 5000);
ok(true, '关闭聊天时公告仍广播');
await post('/api/admin/config', { chatEnabled: true }, T);
rootC.close();

console.log('[rates: 后台改发言频率立即生效]');
await post('/api/admin/config', { rates: { world: { max: 1, windowMs: 60000 } } }, T);
u2.send('chat.send', { body: '频率1', channel: 'world' });
await u1.next('chat.lobby', 5000);
u2.send('chat.send', { body: '频率2', channel: 'world' });
ok((await u2.next('chat.error', 5000)).error === 'rate_limited', 'max=1 第二条被限流');
await post('/api/admin/config', { rates: { world: { max: 3, windowMs: 5000 } } }, T);
const cfg = await get('/api/admin/config', T);
ok(cfg.rates.world.max === 3, '频率恢复回显');

console.log('[smtp: 后台配置 + 密码掩码]');
await post('/api/admin/config', { smtp: { host: 'smtp.example.com', port: 465, user: 'u@x', from: 'u@x', pass: 'secret1' } }, T);
const s1 = await get('/api/admin/config', T);
ok(s1.smtp.host === 'smtp.example.com' && s1.smtp.pass === '******', 'SMTP 保存且密码掩码', JSON.stringify(s1.smtp));
await post('/api/admin/config', { smtp: { pass: '******' } }, T);
const s2 = await get('/api/admin/config', T);
ok(s2.smtp.host === 'smtp.example.com' && s2.smtp.pass === '******', '掩码回传不覆盖真实密码');

console.log('[plugin: 上传 / 下架 / 重新上架]');
{
  const { zipPlugin } = await import('./server/plugins/pack.js');
  const z = zipPlugin(join(process.cwd(), 'plugins', 'economy-knobs'));
  const up = await post('/api/admin/plugin-upload', { zip: z.body.toString('base64') }, T);
  ok(up.ok && up.id === 'economy-knobs', 'zip 上传安装', JSON.stringify(up));
  let pl = await get('/api/admin/plugins', T);
  ok(pl.plugins.some((p) => p.id === 'economy-knobs' && p.status === 'installed'), '列表 installed');
  const un = await post('/api/admin/plugin-unlist', { id: 'economy-knobs' }, T);
  ok(un.ok, '下架 ok');
  pl = await get('/api/admin/plugins', T);
  const rem = pl.plugins.find((p) => p.id === 'economy-knobs' && p.status === 'removed');
  ok(!!rem, '列表 removed（_removed）');
  const re = await post('/api/admin/plugin-relist', { folder: rem.folder }, T);
  ok(re.ok, '重新上架 ok');
  pl = await get('/api/admin/plugins', T);
  ok(pl.plugins.some((p) => p.id === 'economy-knobs' && p.status === 'installed'), '恢复 installed');
}

console.log('[ban: 禁止登录 + 强制下线 + 撤销令牌 + 解封]');
const ban = await post('/api/admin/ban', { id: id1, ban: true }, T);
ok(ban.ok && ban.banned === true, 'ban 回执', JSON.stringify(ban));
await u1.next('auth.banned', 5000);
ok(true, '被 ban 玩家收到 auth.banned（强制下线）');
ok((await post('/api/auth/login', { username: 'a_' + sfx, password: PW, mode: 'password' })).ok === false, 'ban 后登录拒绝');
ok((await get('/api/auth/me', U1.token)).ok === false, 'ban 后旧令牌失效');
await post('/api/admin/ban', { id: id1, ban: false }, T);
const relogin = await post('/api/auth/login', { username: 'a_' + sfx, password: PW, mode: 'password' });
ok(relogin.ok === true, '解封后登录恢复', JSON.stringify(relogin));

u1.close(); u2.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
