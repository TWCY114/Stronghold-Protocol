// shot-v110.mjs — [v1.1.0] visual: admin 称号 tag, rich colour/emoji render, scrollbar hidden when closed, announce marquee.
import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = process.env.PORT || 3005;
const B = `http://127.0.0.1:${PORT}`;
const SHOT = 'J:/MyConfident/deepseek-harness/default-workspace/_build/fork';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const post = async (p, b, t) => (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) })).json();
const admin = await post('/api/auth/login', { mode: 'password', username: 'root', password: process.env.SP_TEST_ADMIN_PASSWORD });
await post('/api/admin/title', { title: '大佬' }, admin.token);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('sp.pref.release-seen.0.4.0', '1'); localStorage.setItem('sp_token', t); localStorage.setItem('sp.name', '管理员'); localStorage.setItem('sp.chat.box', JSON.stringify({ x: 16, y: 380, w: 420, h: 200 })); sessionStorage.setItem('sp.entered', '1'); } catch {} }, admin.token);
await page.goto(B + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="profile-btn"]', { timeout: 20000 });
await sleep(800);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
await page.waitForSelector('#sp-chat.is-open', { timeout: 5000 });
await sleep(300);
await page.type('.sp-chat-input', '#0000FF 蓝色 §a 绿色 :smile:');
await page.keyboard.press('Enter');
await sleep(600);
const rich = await page.evaluate(() => {
  const line = [...document.querySelectorAll('.sp-chat-line')].pop();
  const spans = [...line.querySelectorAll('span')].filter((s) => s.style.color);
  return { adm: !!line.querySelector('.adm'), admText: line.querySelector('.adm')?.textContent, colors: spans.map((s) => s.style.color), text: line.textContent, emoji: line.textContent.includes('😄') };
});
ok(rich.adm && rich.admText === '[大佬]', '管理员世界行显示 [大佬] 称号', JSON.stringify(rich.admText));
ok(rich.colors.includes('rgb(0, 0, 255)') && rich.colors.includes('rgb(85, 255, 85)'), '蓝色/绿色分段渲染', JSON.stringify(rich.colors));
ok(rich.emoji, 'emoji :smile: → 😄', rich.text);
// close chat → scrollbar must disappear
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
await sleep(300);
const closed = await page.evaluate(() => { const l = document.querySelector('.sp-chat-log'); const cs = getComputedStyle(l); return { open: document.getElementById('sp-chat').classList.contains('is-open'), overflow: cs.overflowY, sbw: cs.scrollbarWidth }; });
ok(!closed.open && (closed.overflow === 'hidden' || closed.sbw === 'none'), '收起后滚动条隐藏', JSON.stringify(closed));
// announce marquee
await post('/api/admin/announce', { text: '全服紧急公告演示', size: 28, color: '#00ff00', speed: 200 }, admin.token);
await sleep(500);
const ann = await page.evaluate(() => { const h = document.getElementById('sp-announce-host'); const line = h && h.firstElementChild; return { exists: !!h, pe: h ? getComputedStyle(h).pointerEvents : null, text: line?.textContent, color: line?.style.color, size: line?.style.fontSize }; });
ok(ann.exists && ann.pe === 'none' && ann.text === '全服紧急公告演示' && /#00ff00|rgb\(0, 255, 0\)/.test(ann.color) && ann.size === '28px', '公告弹幕出现且不阻挡操作', JSON.stringify(ann));
await page.screenshot({ path: SHOT + '/shot-v110.png' });
await browser.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
