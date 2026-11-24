// shot-admin.mjs — verify feature 1 (admin-only profile button) + feature 2 (admin match-control panel) UI. PORT 3005.
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { adminPass } from './_test-creds.mjs'; // [auth-fork]
const BASE = 'http://127.0.0.1:3005', WS = 'ws://127.0.0.1:3005/ws';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT = 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 90000);
const post = async (p, b, t) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(b) })).json();
const get = async (p, t) => (await fetch(BASE + p, { headers: { Authorization: 'Bearer ' + t } })).json();

const admin = await post('/api/auth/login', { mode: 'password', username: 'root', password: adminPass() });
const at = admin.token;
ok(admin.ok && !!at, '管理员登录');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((tok) => {
    try { localStorage.setItem('sp.pref.release-seen.0.4.0', '1'); localStorage.setItem('sp_token', tok); sessionStorage.setItem('sp.entered', '1'); } catch {}
  }, at);
  page.on('pageerror', (e) => console.log('PAGEERR', String(e.message || e).slice(0, 120)));
  return page;
}

console.log('[功能1：个人主页管理后台按钮]');
const page = await newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#sp-chat', { timeout: 15000 });
await sleep(2000);
// title screen: enter a callsign and press 开始 to reach the lobby
await page.waitForSelector('.title-login input', { timeout: 8000 });
await page.type('.title-login input', '管理测试', { delay: 15 });
await sleep(300);
await page.evaluate(() => { const b = [...document.querySelectorAll('.title-login button')].find((x) => x.textContent.includes('开始')); if (b) b.click(); });
await page.waitForSelector('[data-testid="profile-btn"]', { timeout: 12000 });
await sleep(700);
const lobbyAdmin = await page.$('[data-testid="lobby-admin"]');
ok(!!lobbyAdmin, '大厅顶栏有「管理后台」按钮（主页右边）');
if (lobbyAdmin) {
  const order = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="profile-btn"]');
    const a = document.querySelector('[data-testid="lobby-admin"]');
    return p && a ? (p.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : false;
  });
  ok(order, '管理后台按钮位于主页按钮右边');
}
await page.screenshot({ path: SHOT + '/shot-lobby-admin.png' });
await page.evaluate(() => document.querySelector('[data-testid="profile-btn"]').click());
await sleep(900);
const adminBtn = await page.$('[data-testid="profile-admin"]');
ok(!!adminBtn, '管理员个人主页有「管理后台」按钮');
if (adminBtn) {
  const href = await page.$eval('[data-testid="profile-admin"]', (e) => e.getAttribute('href'));
  ok(href === '/admin', '按钮指向 /admin', href);
  const txt = await page.$eval('[data-testid="profile-admin"]', (e) => e.textContent);
  ok(txt.includes('管理后台'), '按钮文案', txt);
}
await page.screenshot({ path: SHOT + '/shot-profile-admin.png' });
await page.close();

console.log('[功能2：管理后台对局控制面板]');
// create a running solo match over WS so the admin panel has something to edit
const ws = new WebSocket(WS + '?token=' + at); const msgs = [];
ws.on('message', (d) => { try { msgs.push(JSON.parse(d.toString())); } catch {} });
await new Promise((r) => ws.on('open', r));
ws.send(JSON.stringify({ t: 'hello', name: '面板测试', version: 1 })); await sleep(700);
ws.send(JSON.stringify({ t: 'room.create', mode: 'solo' })); await sleep(900);
const rs = msgs.find((m) => m.t === 'room.state'); const code = rs?.code;
ws.send(JSON.stringify({ t: 'room.contentReady', cs: rs?.content?.cs, ok: true })); await sleep(400);
ws.send(JSON.stringify({ t: 'room.start' })); await sleep(1500);
ok(!!code, '建立 solo 对局供面板编辑', code);

const ap = await newPage();
await ap.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
await ap.waitForSelector('.adm-tabs', { timeout: 8000 });
await ap.evaluate(() => { const t = document.querySelector('[data-tab="rooms"]'); if (t) t.click(); });
await sleep(1500);
const matchBtn = await ap.$(`[data-match="${code}"]`);
ok(!!matchBtn, '房间列表有「对局控制」按钮');
if (matchBtn) {
  await ap.evaluate((c) => document.querySelector(`[data-match="${c}"]`).click(), code);
  await ap.waitForSelector('.adm-modal', { timeout: 6000 });
  await sleep(700);
  const finput = await ap.$('.adm-funds input[data-finput]');
  ok(!!finput, '对局面板渲染玩家金钱输入框');
  const roundInput = await ap.$('#mround');
  ok(!!roundInput, '对局面板渲染跳回合输入框');
  await ap.screenshot({ path: SHOT + '/shot-match-panel.png' });
  // set funds through the UI
  if (finput) {
    const pid = await ap.$eval('.adm-funds input[data-finput]', (e) => e.getAttribute('data-finput'));
    await ap.evaluate((p) => { const i = document.querySelector(`input[data-finput="${p}"]`); i.value = '888'; }, pid);
    await ap.evaluate((p) => document.querySelector(`[data-setfunds="${p}"]`).click(), pid);
    await sleep(900);
    const st = await get('/api/admin/match-state?code=' + code, at);
    const f = st.players?.find((p) => String(p.playerId) === String(pid))?.funds;
    ok(f === 888, '面板设金钱 888 生效', f);
    await ap.screenshot({ path: SHOT + '/shot-match-panel-edited.png' });
  }
}
await ap.close();
ws.close();
await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
