// shot-chat-scroll.mjs — [chat-scroll] scrolling up must survive new messages / history merges / rename relabels.
// Needs a local server on PORT (default 3005) with seed-admin root; SP_TEST_ADMIN_PASSWORD env.
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = process.env.PORT || 3005;
const B = `http://127.0.0.1:${PORT}`;
const SHOT = 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b, t) => (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) })).json();
const admin = await post('/api/auth/login', { mode: 'password', username: 'root', password: process.env.SP_TEST_ADMIN_PASSWORD });
const other = await post('/api/auth/register', { username: 'scroll_' + Math.random().toString(36).slice(2, 7) });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('sp.pref.release-seen.0.4.0', '1'); localStorage.setItem('sp_token', t); localStorage.setItem('sp.name', '滚动测试'); localStorage.setItem('sp.chat.box', JSON.stringify({ x: 16, y: 400, w: 360, h: 140 })); sessionStorage.setItem('sp.entered', '1'); } catch {} }, admin.token);
await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
try { await page.waitForSelector('[data-testid="profile-btn"]', { timeout: 20000 }); }
catch (e) {
  await page.screenshot({ path: SHOT + '/shot-scroll-debug.png' });
  console.log('DEBUG', await page.evaluate(() => ({ url: location.href, title: document.title, chat: !!document.getElementById('sp-chat'), body: document.body.innerText.slice(0, 300) })));
  throw e;
}
await sleep(800);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
await page.waitForSelector('#sp-chat.is-open', { timeout: 5000 });
await sleep(300);
// fill the log with own lines so there is something to scroll through (lobby rate = 3 msgs / 5 s)
for (let round = 0; round < 5; round++) {
  for (let i = 0; i < 3; i++) { await page.type('.sp-chat-input', `历史消息 ${round}-${i}`); await page.keyboard.press('Enter'); await sleep(120); }
  await sleep(5200);
}
const filled = await page.evaluate(() => { const l = document.querySelector('.sp-chat-log'); return { n: l.querySelectorAll('.sp-chat-line').length, top: l.scrollTop, h: l.scrollHeight, ch: l.clientHeight }; });
ok(filled.n >= 8 && filled.h > filled.ch + 40, '日志已填满可滚动', JSON.stringify(filled));
const fade = await page.evaluate(() => { const ls = [...document.querySelectorAll('.sp-chat-line')]; return { n: ls.length, old: ls.filter((x) => x.classList.contains('old')).length, op: ls.length ? getComputedStyle(ls[0]).opacity : null }; });
ok(fade.n > 12 && fade.old === 0 && fade.op === '1', '超过12条后旧消息不再变淡', JSON.stringify(fade));
// scroll up to read history
await page.evaluate(() => { document.querySelector('.sp-chat-log').scrollTop = 0; });
await sleep(200);
// a stranger speaks: must NOT yank the reader back down
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${other.token}`);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
ws.send(JSON.stringify({ t: 'hello', name: 'scrollbot', version: 1 }));
await sleep(300);
ws.send(JSON.stringify({ t: 'chat.send', body: '路过的消息', channel: 'world' }));
await sleep(600);
const up1 = await page.evaluate(() => { const l = document.querySelector('.sp-chat-log'); return { top: l.scrollTop, last: [...l.querySelectorAll('.sp-chat-line')].pop().textContent }; });
ok(up1.top < 5, '上滑后新消息不会跳回底部', JSON.stringify(up1.top));
ok(up1.last.includes('路过的消息'), '新消息仍追加到日志末尾', JSON.stringify(up1.last));
// a rename relabel (rebuild) must also preserve the reading position
await post('/api/player/rename', { name: '滚动测试名' }, admin.token);
await sleep(600);
const up2 = await page.evaluate(() => document.querySelector('.sp-chat-log').scrollTop);
ok(up2 < 5, '改名 relabel 后仍保持上滑位置', JSON.stringify(up2));
// scrolling back to bottom re-arms stick-to-bottom
await page.evaluate(() => { const l = document.querySelector('.sp-chat-log'); l.scrollTop = l.scrollHeight; });
await sleep(200);
ws.send(JSON.stringify({ t: 'chat.send', body: '回到底部后的消息', channel: 'world' }));
await sleep(600);
const down = await page.evaluate(() => { const l = document.querySelector('.sp-chat-log'); return l.scrollHeight - l.scrollTop - l.clientHeight; });
ok(down < 24, '回到底部后恢复自动跟随', JSON.stringify(down));
await page.screenshot({ path: SHOT + '/shot-chat-scroll.png' });
ws.close();
await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
