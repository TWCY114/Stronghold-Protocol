// test-chat-e2e.mjs — Delta Force-style chat widget in real Chrome (PORT 3002). Two clients: Enter opens the input bar,
// world message crosses clients, channel tabs present, Esc closes. Screenshots the bottom-left log.
import puppeteer from 'puppeteer-core';
const BASE = 'http://127.0.0.1:3002';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT = 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('GLOBAL TIMEOUT — 强制退出'); process.exit(2); }, 120000);
const post = async (p, b) => (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
for (let i = 0; i < 30; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch {} await sleep(500); }
const sfx = Math.random().toString(36).slice(2, 7);
const A = await post('/api/auth/register', { username: 'ca_' + sfx });
const B = await post('/api/auth/register', { username: 'cb_' + sfx });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
async function client(token, name) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluateOnNewDocument((t, n) => {
    localStorage.setItem('sp_token', t); localStorage.setItem('sp.name', n); sessionStorage.setItem('sp.entered', '1');
  }, token, name);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#sp-chat', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('sp-chat')?.dataset.online === '1', { timeout: 12000 }).catch(() => {});
  return { page, errors };
}
try {
  const a = await client(A.token, 'Alice');
  const b = await client(B.token, 'Bob');
  ok(true, '左下聊天框出现（两客户端）');

  // Enter opens the input bar + channel tabs (dispatch on window; puppeteer keyboard would activate the focused game button)
  await a.page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  await a.page.waitForSelector('#sp-chat.is-open', { timeout: 5000 });
  ok(true, '按 Enter 弹出输入条');
  const tabs = await a.page.$$eval('.sp-chat-tab', (els) => els.map((e) => e.textContent));
  ok(tabs.includes('世界') && tabs.includes('房间') && !tabs.includes('好友'), '频道页签仅世界/房间（好友已独立）', tabs.join(','));
  const roomDisabled = await a.page.$eval('.sp-chat-tab[data-tab="room"]', (e) => e.disabled);
  ok(roomDisabled, '未进房间时房间页签禁用');
  const friendsBtn = await a.page.$('[data-testid="friends-btn"]');
  ok(!!friendsBtn, '大厅顶栏有独立好友按钮');

  // world message crosses clients
  const text = '世界你好_' + sfx;
  await a.page.evaluate((t) => { const i = document.querySelector('.sp-chat-input'); i.value = t; document.querySelector('.sp-chat-send').click(); }, text);
  await sleep(800);
  await a.page.waitForFunction((t) => document.querySelector('.sp-chat-log')?.textContent.includes(t), { timeout: 6000 }, text);
  ok(true, 'Alice 世界消息渲染');
  await b.page.waitForFunction((t) => document.querySelector('.sp-chat-log')?.textContent.includes(t), { timeout: 6000 }, text);
  ok(true, 'Bob 收到世界消息');

  // Esc closes
  await a.page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await sleep(300);
  const closed = await a.page.$eval('#sp-chat', (e) => !e.classList.contains('is-open'));
  ok(closed, 'Esc 收起输入条（日志仍在）');
  const passiveBg = await a.page.$eval('#sp-chat', (e) => getComputedStyle(e).backgroundColor);
  ok(passiveBg === 'rgba(0, 0, 0, 0)' || passiveBg === 'transparent', '被动状态聊天框全透明', passiveBg);

  const fmt = await a.page.$eval('.sp-chat-line', (e) => e.textContent);
  ok(fmt.includes('[世界]') && fmt.includes(':'), '消息格式 [区域] 名: 消息', fmt.slice(0, 40));

  // title screen (not entered) hides the chat box
  const tp = await browser.newPage();
  await tp.setViewport({ width: 1280, height: 900 });
  await tp.evaluateOnNewDocument((t) => { localStorage.setItem('sp_token', t); }, A.token);
  await tp.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await tp.waitForSelector('#sp-chat', { timeout: 15000 });
  await sleep(1800);
  const titleHidden = await tp.$eval('#sp-chat', (e) => getComputedStyle(e).display === 'none');
  ok(titleHidden, '首页（标题屏）隐藏聊天框');
  await tp.close();

  await a.page.screenshot({ path: SHOT + '/shot-chat.png' });
  ok(true, '聊天截图已保存');
  const errs = [...a.errors, ...b.errors];
  if (errs.length) console.log('  (页面错误: ' + errs.slice(0, 3).join(' | ') + ')');
} finally { await browser.close(); }
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
