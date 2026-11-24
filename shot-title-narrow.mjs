// shot-title-narrow.mjs — verify the title conn row (incl. fullscreen) stays on ONE line at narrow AND wide viewports.
import puppeteer from 'puppeteer-core';
import { adminPass } from './_test-creds.mjs';
const BASE = 'http://127.0.0.1:3005';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT = 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 90000);
const admin = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'password', username: 'root', password: adminPass() }) })).json();
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let allOk = true;
for (const width of [400, 768, 1280]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((tok) => { try { localStorage.setItem('sp.pref.release-seen.0.4.0', '1'); localStorage.setItem('sp_token', tok); } catch {} }, admin.token);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.title-login input', { timeout: 15000 });
  await sleep(1200);
  const layout = await page.evaluate(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; };
    return { gear: box('.title-settings'), fs: box('.title-fs'), conn: box('.title-conn') };
  });
  const sameRow = layout.gear && layout.fs && Math.abs(layout.gear.y - layout.fs.y) < 8;
  const inBounds = layout.fs && layout.conn && (layout.fs.x + layout.fs.w) <= (layout.conn.x + layout.conn.w + 2);
  console.log(`width=${width}`, JSON.stringify(layout), sameRow ? '✓ 同行' : '✗ 错位', inBounds ? '✓ 不溢出' : '✗ 溢出');
  if (width === 400) await page.screenshot({ path: SHOT + '/shot-title-narrow.png' });
  if (!sameRow || !inBounds) allOk = false;
  await page.close();
}
await browser.close();
process.exit(allOk ? 0 : 1);
