// shot-v120.mjs — [v1.2.0] UI: login hides guest/register when switched off; chat_off hides the chat box; player-card 举报;
// announce marquee renders on top; admin new tabs (settings/moderation/reports/grant/plugins) + create-account clears fields.
// Against PORT 3005 (isolated SP_AUTH_DB, seeded root).
import puppeteer from 'puppeteer-core';
import { adminPass } from './_test-creds.mjs';
const BASE = 'http://127.0.0.1:3005';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT = 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 120000);
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b, t) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) })).json();
const get = async (p, t) => (await fetch(BASE + p, { headers: t ? { Authorization: `Bearer ${t}` } : {} })).json();
const admin = await post('/api/auth/login', { mode: 'password', username: 'root', password: adminPass() });
const sfx = Math.random().toString(36).slice(2, 7);
const other = await post('/api/auth/register', { username: 'v120_' + sfx });
const otherId = (await get('/api/auth/me', other.token)).account.id;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument((tok) => { try { localStorage.setItem('sp.pref.release-seen.0.4.0', '1'); localStorage.setItem('sp_token', tok); localStorage.setItem('sp.name', '界面测试'); sessionStorage.setItem('sp.entered', '1'); } catch {} }, admin.token);
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

console.log('[switches: 登录页隐藏游客 / 注册按钮]');
await post('/api/admin/config', { guest: false, register: false }, admin.token);
const lp = await browser.newPage();
await lp.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
await lp.waitForSelector('#go-guest', { timeout: 10000 });
await sleep(600);
const hid = await lp.evaluate(() => {
  const g = document.querySelector('#go-guest'), r = document.querySelector('#go-register');
  const off = (e) => !e || getComputedStyle(e).display === 'none' || e.offsetParent === null;
  return { g: off(g), r: off(r) };
});
ok(hid.g && hid.r, '关闭后登录页两按钮隐藏', JSON.stringify(hid));
await lp.close();
await post('/api/admin/config', { guest: true, register: true }, admin.token);

console.log('[chat_off: 一键关闭聊天隐藏聊天框]');
await post('/api/admin/config', { chatEnabled: false }, admin.token);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="profile-btn"]', { timeout: 20000 });
await sleep(1200);
const offBox = await page.evaluate(() => { const b = document.querySelector('.sp-chat'); return !b || getComputedStyle(b).display === 'none'; });
ok(offBox, 'chat_off 时聊天框隐藏');
await post('/api/admin/config', { chatEnabled: true }, admin.token);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="profile-btn"]', { timeout: 20000 });
await sleep(1200);
const onBox = await page.evaluate(() => { const b = document.querySelector('.sp-chat'); return !!b && getComputedStyle(b).display !== 'none'; });
ok(onBox, '恢复后聊天框可见');

console.log('[report: 名片举报按钮]');
await page.evaluate((id) => window.dispatchEvent(new CustomEvent('sp-player-card', { detail: { id } })), otherId);
await page.waitForSelector('.df-card', { timeout: 8000 });
await sleep(300);
const hasReport = await page.evaluate(() => !!document.querySelector('.df-report'));
ok(hasReport, '名片含举报按钮');
await click('.df-report');
await sleep(600);
const toast = await page.evaluate(() => document.body.textContent.includes('举报'));
ok(toast, '点击举报有回执提示');
await page.evaluate(() => { const c = document.querySelector('.df-card'); if (c) c.remove(); });

console.log('[announce: 全服公告弹幕渲染]');
await post('/api/admin/announce', { text: 'v120公告弹幕', size: 28, color: '#00ff00', speed: 200 }, admin.token);
await sleep(700);
const ann = await page.evaluate(() => { const h = document.querySelector('#sp-announce-host'); return { n: h ? h.childElementCount : 0, txt: h ? h.textContent : '', pe: h ? getComputedStyle(h).pointerEvents : '' }; });
ok(ann.n > 0 && ann.txt.includes('v120公告弹幕'), '公告弹幕出现', JSON.stringify(ann));
ok(ann.pe === 'none', '公告不挡点击 pointer-events:none');
await page.screenshot({ path: SHOT + '/shot-v120.png' });

console.log('[admin: 新 tabs + 创建账号清空]');
await page.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.adm-tab', { timeout: 15000 });
await sleep(600);
for (const [tab, sel] of [['settings', '#switch-form'], ['moderation', '#mute-form'], ['reports', '#reports-table'], ['grant', '#grant-form'], ['plugins', '#plugins-table']]) {
  await page.evaluate((t) => [...document.querySelectorAll('.adm-tab')].find((x) => x.dataset.tab === t).click(), tab);
  await sleep(500);
  const vis = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const p = e.closest('[data-panel]'); return !p || !p.classList.contains('is-hidden'); }, sel);
  ok(vis, `tab ${tab} 面板可见 (${sel})`);
}
await page.evaluate(() => [...document.querySelectorAll('.adm-tab')].find((x) => x.dataset.tab === 'accounts').click());
await sleep(500);
await page.evaluate((u) => { const f = document.querySelector('#create-form'); f.querySelector('[name=username]').value = u; f.querySelector('[name=password]').value = 'Pass#12345'; }, 'clr_' + sfx);
await page.evaluate(() => document.querySelector('#create-form').requestSubmit());
await sleep(800);
const cleared = await page.evaluate(() => { const f = document.querySelector('#create-form'); return f.querySelector('[name=username]').value === '' && f.querySelector('[name=password]').value === ''; });
ok(cleared, '创建账号后名字/密码框清空');

await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
