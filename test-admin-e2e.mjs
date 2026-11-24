// test-admin-e2e.mjs — P2 admin UI in real Chrome (PORT 3002). Logs in as admin, opens /admin, checks the chart + cards +
// tables render, and screenshots the dashboard.
import puppeteer from 'puppeteer-core';
import { adminPass } from './_test-creds.mjs'; // [auth-fork]
const BASE = 'http://127.0.0.1:' + (process.env.PORT || '3002');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT = 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };

for (let i = 0; i < 30; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'password', username: 'root', password: adminPass() }) })).json();
const token = login.token;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('sp_token', t), token);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#chart path', { timeout: 10000 });
  ok(true, '折线图渲染（SVG 平滑曲线）');
  const cards = await page.$$eval('.adm-card', (els) => els.length);
  ok(cards === 6, '6 个统计卡', `cards=${cards}`);
  const online = await page.$eval('.adm-card .n', (el) => el.textContent);
  ok(/^\d+$/.test(online), '在线数显示', online);
  await page.waitForSelector('#players-table thead', { timeout: 8000 });
  ok(true, '在线玩家表渲染');
  // switch to accounts tab
  await page.click('.adm-tab[data-tab="accounts"]');
  await page.waitForSelector('#accounts-table thead', { timeout: 8000 });
  const hasRoot = await page.$eval('#accounts-table', (el) => el.textContent.includes('root'));
  ok(hasRoot, '账号表含 root');
  await page.click('.adm-tab[data-tab="players"]');
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: SHOT + '/shot-admin.png', fullPage: true });
  ok(true, '后台截图已保存');
  if (errors.length) console.log('  (页面错误: ' + errors.slice(0, 3).join(' | ') + ')');
} finally { await browser.close(); }
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
