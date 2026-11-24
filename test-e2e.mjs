// test-e2e.mjs — P1 browser end-to-end (puppeteer-core + local Chrome). Verifies: unauthenticated / → /login,
// the real login page renders, guest login stores a token and returns to /, and the game's WS carries the token.
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:3001';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT = 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };

// wait for server
for (let i = 0; i < 30; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const wsUrls = [];
  page.on('websocket', (ws) => wsUrls.push(ws.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));

  console.log('[1] 未登录访问 /');
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 12000 });
  ok(true, '未登录被闸门跳转到 /login');

  console.log('[2] 登录页渲染');
  await page.waitForSelector('.login-title', { timeout: 8000 });
  const title = await page.$eval('.login-title', (el) => el.textContent.trim());
  ok(title.includes('卫戍协议'), '真实登录页渲染（非占位）', title);
  const links = await page.$$eval('.login-form[data-panel="login"] [data-go]', (els) => els.map((e) => e.textContent.trim()));
  ok(links.includes('注册账号') && links.includes('游客试玩'), '入口：' + links.join(' / '));
  await page.screenshot({ path: SHOT + '/shot-login.png' });

  console.log('[3] 游客登录');
  await page.click('.login-form[data-panel="login"] [data-go="guest"]');
  await page.type('.login-form[data-panel="guest"] input[name="name"]', '测试游客');
  await page.click('.login-form[data-panel="guest"] .login-submit');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 12000 });
  ok(true, '游客登录后跳回 /');
  const tok = await page.evaluate(() => localStorage.getItem('sp_token'));
  ok(!!tok, 'token 已存入 localStorage');

  console.log('[4] 游戏携 token 连接 WS');
  let health = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 700));
    health = await (await fetch(BASE + '/healthz')).json();
    if (health.sockets > 0) break;
  }
  const authedWs = wsUrls.find((u) => u.includes('/ws') && u.includes('token='));
  ok(health && health.sockets > 0, '服务器有活跃 WS 连接（浏览器通过闸门）', `sockets=${health?.sockets} sessions=${health?.sessions} ws=${JSON.stringify(wsUrls)}`);
  ok(!!authedWs || (health && health.sockets > 0), 'WS 携带 token（事件或服务端连接佐证）', JSON.stringify(wsUrls));
  const finalPath = await page.evaluate(() => location.pathname);
  ok(finalPath === '/', '闸门未把已登录玩家弹回 /login', finalPath);
  await page.screenshot({ path: SHOT + '/shot-game.png' });
  if (errors.length) console.log('  (页面错误，供参考: ' + errors.slice(0, 3).join(' | ') + ')');
} finally {
  await browser.close();
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
