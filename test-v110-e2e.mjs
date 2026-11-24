// test-v110-e2e.mjs — [v1.1.0] world-100 cap, admin 称号 on world lines, 全服紧急公告 marquee broadcast, rich colour/emoji
// parsing. Against PORT 3005 (isolated SP_AUTH_DB, seeded root admin). Rich parsing uses a tiny DOM stub (no browser).
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

console.log('[rich-chat: 颜色 / emoji 解析]');
globalThis.document = {
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  createElement: (tag) => ({ tagName: tag, style: {}, textContent: '', children: [], append(...n) { this.children.push(...n); } }),
};
const { richNodes } = await import('./public/js/chat/rich.js');
const flat = (ns) => ns.map((n) => n.nodeType === 3 ? n.textContent : `[${n.style.color || ''}]${n.textContent}`).join('');
const r1 = richNodes('#0000FF 蓝色 §a 绿色');
ok(r1.length === 2 && r1[0].style.color === '#0000FF' && r1[0].textContent.includes('蓝色') && r1[1].style.color === '#55FF55' && r1[1].textContent.includes('绿色'), '#hex + §a 分段着色', flat(r1));
const r2 = richNodes(':smile: 你好 :nope:');
ok(flat(r2) === '😄 你好 :nope:', 'emoji shortcode 替换、未知保留', flat(r2));
const r3 = richNodes('§l 粗 §r 普通');
ok(r3[0].style.fontWeight === '700' && r3[1].nodeType === 3, '§l 加粗 / §r 复位', flat(r3));
const r4 = richNodes('<img src=x onerror=alert(1)>');
ok(r4.every((n) => n.nodeType === 3) && flat(r4).includes('<img'), 'HTML 不注入（纯文本节点）', flat(r4));

console.log('[admin-title: 称号设置 + 世界频道显示]');
const root = await post('/api/auth/login', { username: 'root', password: process.env.SP_TEST_ADMIN_PASSWORD || 'Test#Admin3005', mode: 'password' });
ok(root.ok && root.token, 'root 管理员登录');
const adminTok = root.token;
const sfx = Math.random().toString(36).slice(2, 7);
const U = await post('/api/auth/register', { username: 'u_' + sfx });
const uId = (await get('/api/auth/me', U.token)).account.id;
const aId = (await get('/api/auth/me', adminTok)).account.id;
const t0 = await get('/api/admin/title', adminTok);
ok(t0.ok && t0.title === '管理', '默认称号 管理', JSON.stringify(t0));
const t1 = await post('/api/admin/title', { title: '大佬' }, adminTok);
ok(t1.ok && t1.title === '大佬', '设置称号 大佬');
const a = new C(adminTok); await a.open(); await a.hello('Admin');
const u = new C(U.token); await u.open(); await u.hello('User');
a.send('chat.send', { body: '管理员发言', channel: 'world' });
await a.next('chat.lobby', 5000);
const hu = await u.next('chat.lobby', 5000);
ok(hu.title === '大佬' && hu.accountId === aId, '管理员世界消息带 title=大佬', JSON.stringify(hu.title));
u.send('chat.send', { body: '普通发言', channel: 'world' });
const ha = await a.next('chat.lobby', 5000);
ok(!ha.title, '普通玩家世界消息无 title', JSON.stringify(ha.title));
a.send('chat.history', { channel: 'world' });
const hist = await a.next('chat.history', 5000);
ok((hist.messages || []).some((x) => x.account_id === aId && x.title === '大佬'), '世界历史保留 title');

console.log('[announce: 全服紧急公告广播]');
const ann = await post('/api/admin/announce', { text: '紧急公告测试', size: 30, color: '#00ff00', speed: 200 }, adminTok);
ok(ann.ok && ann.size === 30 && ann.color === '#00ff00' && ann.speed === 200, '公告接口回显参数', JSON.stringify(ann));
const ua = await u.next('announce', 5000);
const aa = await a.next('announce', 5000);
ok(ua.text === '紧急公告测试' && ua.size === 30 && ua.color === '#00ff00' && ua.speed === 200, '普通玩家收到 announce');
ok(aa.text === '紧急公告测试', '管理员自己也收到 announce');
const bad = await post('/api/admin/announce', { text: '' }, adminTok);
ok(!bad.ok, '空公告被拒绝');
const clamp = await post('/api/admin/announce', { text: 'clamp', size: 999, speed: 9999, color: 'javascript:alert(1)' }, adminTok);
ok(clamp.ok && clamp.size === 64 && clamp.speed === 600 && clamp.color === '#ff5555', 'size/speed 钳制 + 非法颜色回退', JSON.stringify(clamp));

a.close(); u.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
