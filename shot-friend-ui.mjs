// shot-friend-ui.mjs — [chat-focus] lobby chat stays typeable with 个人主页 open; [friend-search] friends window searches
// then opens the 名片; [friend-gate] non-friend 私聊 is grey + tooltip + click error. Against PORT 3005.
import puppeteer from 'puppeteer-core';
import { adminPass } from './_test-creds.mjs';
const BASE = 'http://127.0.0.1:3005';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT = 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 90000);
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b, t) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) })).json();
const admin = await post('/api/auth/login', { mode: 'password', username: 'root', password: adminPass() });
const sfx = Math.random().toString(36).slice(2, 7);
const other = await post('/api/auth/register', { username: 'ui_' + sfx });
await post('/api/player/rename', { name: '测试对象' }, other.token);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument((tok) => { try { localStorage.setItem('sp.pref.release-seen.0.4.0', '1'); localStorage.setItem('sp_token', tok); localStorage.setItem('sp.name', '界面测试'); sessionStorage.setItem('sp.entered', '1'); } catch {} }, admin.token);
const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="profile-btn"]', { timeout: 20000 });
await sleep(800);

console.log('[chat-focus: 主页开着也能打字]');
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
await page.waitForSelector('#sp-chat.is-open', { timeout: 5000 });
await sleep(300);
await click('[data-testid="profile-btn"]');   // open 个人主页 on top
await page.waitForSelector('.ak-profile', { timeout: 8000 });
await sleep(300);
await page.evaluate(() => document.querySelector('.sp-chat-input').focus());   // focus must stay in the chat
await sleep(250);
const focused = await page.evaluate(() => document.activeElement && document.activeElement.className);
ok(String(focused).includes('sp-chat-input'), '焦点留在大厅聊天输入框', String(focused));
await page.keyboard.type('你好大厅');
const val = await page.$eval('.sp-chat-input', (e) => e.value);
ok(val === '你好大厅', '主页开启时聊天可输入', JSON.stringify(val));
await page.screenshot({ path: SHOT + '/shot-chat-focus.png' });

console.log('[friend-search + friend-gate]');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.friends-btn', { timeout: 20000 });
await sleep(600);
await click('.friends-btn');
await page.waitForSelector('.fr-modal', { timeout: 8000 });
await page.type('.fr-add input', '测试对象');
await click('.fr-add .btn');           // 搜索
await page.waitForSelector('.fr-row .btn', { timeout: 8000 });
await sleep(200);
await click('.fr-row .btn');           // 名片 → PlayerCard
await page.waitForSelector('.df-card', { timeout: 8000 });
await sleep(200);
const gate = await page.evaluate(() => {
  const off = document.querySelector('.df-pm-off');
  const add = [...document.querySelectorAll('.df-actions .btn')].find((b) => /加好友|已是好友/.test(b.textContent));
  return { off: !!off, title: off ? off.getAttribute('title') : null, add: add ? add.textContent : null, addDisabled: add ? add.disabled : null };
});
ok(gate.off, '非好友私聊按钮灰色 (df-pm-off)');
ok(gate.title === '你与对方还不是好友', '悬浮提示文案', JSON.stringify(gate.title));
ok(gate.add === '加好友' && gate.addDisabled === false, '名片可加好友', JSON.stringify(gate));
await click('.df-pm-off');
await sleep(250);
const toastTxt = await page.evaluate(() => { const t = document.querySelector('.sp-profile-toast'); return t ? t.textContent : null; });
ok(toastTxt === '错误：你与对方还不是好友', '点击灰色私聊弹出错误', JSON.stringify(toastTxt));
await page.screenshot({ path: SHOT + '/shot-friend-gate.png' });

console.log('[chat-rename: 改名后聊天频道名字跟着改]');
await page.keyboard.press('Escape'); await sleep(300);
await page.keyboard.press('Escape'); await sleep(300);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
await sleep(400);
await page.type('.sp-chat-input', '改名前的聊天');
await page.keyboard.press('Enter');
await sleep(500);
const before = await page.evaluate(() => { const w = [...document.querySelectorAll('.sp-chat-line .who')].pop(); return w ? w.textContent : null; });
await page.evaluate(async (t) => { await fetch('/api/player/rename', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ name: '聊天新名' }) }); }, admin.token);
await sleep(700);
const after = await page.evaluate(() => { const w = [...document.querySelectorAll('.sp-chat-line .who')].pop(); return w ? w.textContent : null; });
ok(!!before && before !== '聊天新名', '改名前聊天显示旧名', JSON.stringify(before));
ok(after === '聊天新名', '改名后聊天频道名字即时更新', JSON.stringify(after));
await page.screenshot({ path: SHOT + '/shot-chat-rename.png' });

await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
