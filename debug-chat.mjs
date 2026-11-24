// debug-chat.mjs — diagnose the Delta Force chat panel: does Enter open it after the intro? Uses evaluate-dispatched
// events (avoids puppeteer input quirks) and reports activeElement / is-open / log content.
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:3002';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const reg = await post('/api/auth/register', { username: 'dbg_' + Math.random().toString(36).slice(2, 7) });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.evaluateOnNewDocument((t) => { localStorage.setItem('sp_token', t); localStorage.setItem('sp.name', '调试'); sessionStorage.setItem('sp.entered', '1'); }, reg.token);
page.on('pageerror', (e) => console.log('PAGEERR', String(e.message || e).slice(0, 120)));
page.on('dialog', async (d) => { console.log('DIALOG', d.type(), d.message().slice(0, 80)); await d.dismiss(); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#sp-chat', { timeout: 15000 });
await page.waitForFunction(() => document.getElementById('sp-chat')?.dataset.online === '1', { timeout: 12000 }).catch(() => console.log('not online'));
await sleep(2500);
const snap = () => page.evaluate(() => ({
  active: document.activeElement?.tagName + '.' + (document.activeElement?.className || ''),
  open: document.getElementById('sp-chat')?.classList.contains('is-open'),
  film: !!document.querySelector('.entry-film, [class*="entry"], [class*="film"]'),
  bodyChildren: document.body.children.length,
  log: document.querySelector('.sp-chat-log')?.textContent.slice(0, 60),
}));
console.log('before Enter:', JSON.stringify(await snap()));
// dispatch Enter on window (capture false) — same as a real keypress reaching window
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
await sleep(400);
console.log('after Enter:', JSON.stringify(await snap()));
// try sending via the input
const sent = await page.evaluate(() => {
  const i = document.querySelector('.sp-chat-input'); if (!i) return 'no input';
  i.value = '调试消息xyz'; document.querySelector('.sp-chat-send').click();
  return 'clicked';
});
console.log('send:', sent);
await sleep(1200);
console.log('after send:', JSON.stringify(await snap()));
await page.screenshot({ path: 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork/shot-chat-dbg.png' });
await browser.close();
