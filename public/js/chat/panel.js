// public/js/chat/panel.js — Delta Force (三角洲行动) style lobby chat for the login fork.
//   • Passive state: a FULLY TRANSPARENT log in the bottom-left, one line per message as 「[区域] 玩家名: 消息」. No box,
//     no border — just floating text that never blocks play. New lines fade in once (no rebuild flicker).
//   • Enter opens the input bar + channel tabs (世界 / 房间); Esc closes. Touch: a single tap opens. The box is draggable
//     (grab the log) and resizable (corner); geometry is remembered (top-left anchored, so resize follows the cursor).
//   • Entering a room auto-switches to the room channel (members only); leaving returns to world.
//   • Colour follows the 同盟模拟 button: the mint tokens are read from the live season root, so switching version recolours
//     the chat. Solid colours, no gradients. Hidden on the title screen; on/off lives in 设置 → 界面插件 (chat/pref.js).
//   • Friends/PM are a separate window (chat/friends.js), not part of this panel.

import { getToken } from '../auth/gate.js';
import { store, selectRoute } from '../store.js';
import { chatEnabled } from './pref.js';

const CSS = `
.sp-chat{position:fixed;z-index:9000;display:flex;flex-direction:column;background:transparent;border:1px solid transparent;border-radius:10px;overflow:hidden;font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.sp-chat.is-open{background:rgba(12,15,14,.82);border-color:var(--mint-a35,rgba(78,216,175,.35));backdrop-filter:blur(3px);box-shadow:0 8px 28px rgba(0,0,0,.4)}
.sp-chat.is-drag{opacity:.85}
.sp-chat-log{flex:1;overflow-y:auto;padding:6px 10px;display:flex;flex-direction:column;gap:3px;scrollbar-width:thin;cursor:grab;text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 2px rgba(0,0,0,.8)}
.sp-chat.is-open .sp-chat-log{cursor:text;text-shadow:none}
.sp-chat-log::-webkit-scrollbar{width:5px}.sp-chat-log::-webkit-scrollbar-thumb{background:var(--mint-a35,rgba(78,216,175,.3));border-radius:3px}
.sp-chat-line{font-size:12.5px;line-height:1.45;color:#e6edf3;word-break:break-word}
.sp-chat-line.new{animation:spFade .22s ease}
.sp-chat-line .ch{color:var(--mint-400,#59f4ca);margin-right:6px;font-size:11.5px}
.sp-chat-line .who{font-weight:600;color:var(--mint-400,#59f4ca)}
.sp-chat-line .who.clickable{cursor:pointer}
.sp-chat-line .who.clickable:hover{text-decoration:underline}
.sp-chat-line .who.guest{color:#9aa7a1}
.sp-chat-line.mine .who{color:var(--mint-500,#4ed8af)}
.sp-chat-line.old{opacity:.5}
@keyframes spFade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.sp-chat-empty{color:#8b949e;font-size:11px;padding:6px 2px;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.sp-chat-tabs{display:none;gap:5px;padding:6px 8px 0}
.sp-chat.is-open .sp-chat-tabs{display:flex}
.sp-chat-tab{padding:4px 12px;font-size:11.5px;color:#9aa7a1;background:transparent;border:1px solid var(--mint-a20,rgba(78,216,175,.2));border-radius:6px;cursor:pointer}
.sp-chat-tab.is-active{color:var(--mint-400,#59f4ca);border-color:var(--mint-500,#4ed8af);background:var(--mint-a10,rgba(78,216,175,.1))}
.sp-chat-tab:disabled{opacity:.35;cursor:not-allowed}
.sp-chat-inputrow{display:none;gap:6px;padding:6px 8px 8px}
.sp-chat.is-open .sp-chat-inputrow{display:flex}
.sp-chat-input{flex:1;padding:7px 10px;font-size:13px;color:#e6edf3;background:rgba(13,17,23,.85);border:1px solid var(--mint-a35,rgba(78,216,175,.3));border-radius:7px;outline:none;font-family:inherit}
.sp-chat-input:focus{border-color:var(--mint-500,#4ed8af)}
.sp-chat-send{padding:7px 16px;font-size:12.5px;font-weight:600;color:#04140f;background:var(--mint-500,#4ed8af);border:none;border-radius:7px;cursor:pointer}
.sp-chat-send:hover{background:var(--mint-400,#59f4ca)}
.sp-chat-resize{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;background:var(--mint-500,#4ed8af);opacity:.45;clip-path:polygon(100% 0,100% 100%,0 100%);display:none}
.sp-chat.is-open .sp-chat-resize{display:block}
.sp-chat-resize:hover{opacity:.8}
.sp-chat-toast{position:fixed;left:16px;bottom:250px;z-index:9002;padding:7px 13px;background:rgba(13,17,23,.95);border:1px solid var(--mint-a35,rgba(78,216,175,.4));border-radius:7px;color:#e6edf3;font-size:12px;opacity:0;transition:.2s;pointer-events:none}
.sp-chat-toast.show{opacity:1}
`;

const ERR = { empty: '不能发空消息', rate_limited: '发言太快，稍等', no_room: '不在房间中', hello_required: '未连接' };
const GEO_KEY = 'sp.chat.box';
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

export function installChat({ net }) {
  if (document.getElementById('sp-chat')) return;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  const state = { own: null, channel: 'world', roomCode: null, open: false, msg: { world: [], room: [] } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // ---- geometry: top-left anchored (resize follows the cursor), remembered ------------------------------------------
  let geo = { x: 16, y: Math.max(16, window.innerHeight - 236), w: 360, h: 220 };
  try { const g = JSON.parse(localStorage.getItem(GEO_KEY)); if (g && g.w) geo = g; } catch {}
  const box = el('div', 'sp-chat'); box.id = 'sp-chat';
  function applyGeo() {
    geo.w = Math.max(240, Math.min(geo.w, window.innerWidth - 12));
    geo.h = Math.max(120, Math.min(geo.h, window.innerHeight - 12));
    geo.x = Math.max(4, Math.min(geo.x, window.innerWidth - geo.w - 4));
    geo.y = Math.max(4, Math.min(geo.y, window.innerHeight - geo.h - 4));
    box.style.left = geo.x + 'px'; box.style.top = geo.y + 'px'; box.style.width = geo.w + 'px'; box.style.height = geo.h + 'px';
  }
  const saveGeo = () => { try { localStorage.setItem(GEO_KEY, JSON.stringify(geo)); } catch {} };
  applyGeo();

  const log = el('div', 'sp-chat-log');
  const tabs = el('div', 'sp-chat-tabs');
  const inputRow = el('div', 'sp-chat-inputrow');
  const input = el('input', 'sp-chat-input'); input.maxLength = 300; input.placeholder = '说点什么…';
  const sendBtn = el('button', 'sp-chat-send', '发送');
  inputRow.append(input, sendBtn);
  const resize = el('div', 'sp-chat-resize');
  box.append(log, tabs, inputRow, resize);
  document.body.appendChild(box);

  const toastEl = el('div', 'sp-chat-toast'); document.body.appendChild(toastEl);
  let toastTimer = null;
  function toast(t) { toastEl.textContent = t; toastEl.className = 'sp-chat-toast show'; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.className = 'sp-chat-toast', 2400); }

  // drag (grab the log) vs tap (open): a press that moves >4px drags, otherwise it is a tap that opens the input bar
  log.addEventListener('pointerdown', (e) => {
    if (state.open) return;                       // while open the log scrolls normally
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ox = geo.x, oy = geo.y; let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true; box.classList.add('is-drag'); geo.x = ox + dx; geo.y = oy + dy; applyGeo();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      box.classList.remove('is-drag');
      if (moved) saveGeo(); else openChat();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  resize.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = geo.w, oh = geo.h;
    const move = (ev) => { geo.w = ow + (ev.clientX - sx); geo.h = oh + (ev.clientY - sy); applyGeo(); };
    const up = () => { saveGeo(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });

  // ---- rendering: incremental append (no flicker) -------------------------------------------------------------------
  function lineNode(m, animate) {
    const ch = m.channel === 'room' ? 'room' : (m.roomCode ? 'room' : 'world');
    const d = el('div', 'sp-chat-line' + (animate ? ' new' : '') + ((m.accountId === state.own || m.account_id === state.own) ? ' mine' : ''));
    d.append(el('span', 'ch', ch === 'room' ? '[房间]' : '[世界]'));
    const who = el('span', 'who' + (m.guest ? ' guest' : ''), m.name || m.fromName || '玩家');
    const aid = m.accountId ?? m.account_id;
    if (aid && !m.guest) {   // [player-id] click a registered player's name → 名片
      who.classList.add('clickable'); who.title = '查看玩家名片';
      who.addEventListener('click', () => window.dispatchEvent(new CustomEvent('sp-player-card', { detail: { id: aid } })));
    }
    d.append(who);
    d.append(document.createTextNode(': ' + (m.body || '')));
    return d;
  }
  function markOld() {
    const nodes = log.querySelectorAll('.sp-chat-line');
    nodes.forEach((n, i) => n.classList.toggle('old', i < nodes.length - 12));
  }
  function appendLine(m) {
    const empty = log.querySelector('.sp-chat-empty'); if (empty) empty.remove();
    log.append(lineNode(m, true));
    while (log.querySelectorAll('.sp-chat-line').length > 40) log.querySelector('.sp-chat-line').remove();
    markOld(); log.scrollTop = log.scrollHeight;
  }
  function rebuildLog() {
    log.innerHTML = '';
    const arr = state.msg[state.channel] || [];
    if (!arr.length) { log.append(el('div', 'sp-chat-empty', state.channel === 'room' ? '房间频道暂无消息' : '世界频道暂无消息')); return; }
    for (const m of arr.slice(-40)) log.append(lineNode(m, false));
    markOld(); log.scrollTop = log.scrollHeight;
  }
  function renderTabs() {
    tabs.innerHTML = '';
    const mk = (id, label, disabled) => {
      const b = el('button', 'sp-chat-tab', label); b.dataset.tab = id; if (disabled) b.disabled = true;
      b.classList.toggle('is-active', state.channel === id);
      b.onclick = () => selectChannel(id);
      tabs.append(b);
    };
    mk('world', '世界');
    mk('room', '房间', !state.roomCode);
  }
  function syncView() {
    box.classList.toggle('is-open', state.open);
    input.placeholder = state.channel === 'room' ? '房间频道…' : '世界频道…';
    renderTabs();
  }
  function selectChannel(id) {
    if (id === 'room' && !state.roomCode) return;
    state.channel = id;
    if (id === 'room') net.send('chat.history', { channel: 'room' });
    rebuildLog(); syncView();
    if (state.open) input.focus();
  }
  function openChat() { state.open = true; syncView(); rebuildLog(); input.focus(); }
  function closeChat() { state.open = false; syncView(); input.blur(); }
  function doSend() {
    const v = input.value.trim(); if (!v) return;
    net.send('chat.send', { body: v, channel: state.channel });
    input.value = '';
  }
  sendBtn.onclick = doSend;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } else if (e.key === 'Escape') { e.preventDefault(); closeChat(); } });
  window.addEventListener('keydown', (e) => {
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === 'Enter' && !state.open && !typing && box.style.display !== 'none') { e.preventDefault(); openChat(); }
    else if (e.key === 'Escape' && state.open && !typing) closeChat();
  });
  // clicking outside the box collapses it back to the transparent passive log (not only Esc)
  window.addEventListener('pointerdown', (e) => { if (state.open && !box.contains(e.target)) closeChat(); });

  // ---- theme follows the 同盟模拟 button (live season tokens), solid colours ----------------------------------------
  let themeCache = '', themeRaf = 0;
  function applyTheme() {
    const src = document.querySelector('.hub-entry--coop') || document.querySelector('.lobby-hub') || document.querySelector('.screen') || document.documentElement;
    const cs = getComputedStyle(src);
    const vars = ['--mint-500', '--mint-400', '--mint-600', '--mint-a10', '--mint-a20', '--mint-a35'];
    const sig = vars.map((v) => cs.getPropertyValue(v)).join('|');
    if (sig === themeCache) return;
    themeCache = sig;
    for (const v of vars) { const val = cs.getPropertyValue(v).trim(); if (val) box.style.setProperty(v, val); }
  }
  const scheduleTheme = () => { cancelAnimationFrame(themeRaf); themeRaf = requestAnimationFrame(applyTheme); };

  // ---- visibility: hidden on title, off when the plugin-manager toggle is off ---------------------------------------
  function applyVisibility() {
    const show = chatEnabled() && selectRoute(store.get()) !== 'title';
    box.style.display = show ? 'flex' : 'none';
    if (!show && state.open) closeChat();
    scheduleTheme();
  }
  store.subscribe(applyVisibility);
  window.addEventListener('sp-chat-toggle', applyVisibility);
  window.addEventListener('resize', () => { applyGeo(); scheduleTheme(); });

  // ---- net wiring ---------------------------------------------------------------------------------------------------
  const refresh = () => { if (net.status !== 'online') return; box.dataset.online = '1'; net.send('chat.history', { channel: 'world' }); if (state.roomCode) net.send('chat.history', { channel: 'room' }); };
  net.on('welcome', (m) => { if (m.account?.id) state.own = m.account.id; refresh(); });
  net.on('status', () => { box.dataset.online = net.status === 'online' ? '1' : '0'; if (net.status === 'online') refresh(); });
  net.on('room.state', (m) => { if (m.code && m.code !== state.roomCode) { state.roomCode = m.code; state.channel = 'room'; net.send('chat.history', { channel: 'room' }); rebuildLog(); syncView(); } else if (m.code) state.roomCode = m.code; });
  net.on('room.closed', () => { state.roomCode = null; if (state.channel === 'room') { state.channel = 'world'; rebuildLog(); } syncView(); });
  net.on('chat.lobby', (m) => {
    const ch = m.channel === 'room' ? 'room' : 'world';
    (state.msg[ch] ||= []).push(m); if (state.msg[ch].length > 120) state.msg[ch].shift();
    if (ch === state.channel) appendLine(m);
  });
  net.on('chat.history', (m) => {
    const ch = m.channel === 'room' ? 'room' : 'world';
    const hist = m.messages || [], cur = state.msg[ch] || [], seen = new Set(), merged = [];
    for (const x of [...hist, ...cur]) { const k = (x.at || x.created_at) + '|' + (x.name || '') + '|' + (x.body || ''); if (!seen.has(k)) { seen.add(k); merged.push(x); } }
    merged.sort((a, b) => (a.at || a.created_at) - (b.at || b.created_at));
    state.msg[ch] = merged.slice(-120);
    if (ch === state.channel) rebuildLog();
  });
  net.on('chat.error', (m) => toast(ERR[m.error] || '聊天错误'));

  (async () => {
    try { const t = getToken(); if (t) { const me = await (await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })).json(); if (me.account) state.own = me.account.id; } } catch {}
    refresh(); rebuildLog(); syncView(); applyVisibility();
  })();
  rebuildLog(); syncView(); applyVisibility();
}
