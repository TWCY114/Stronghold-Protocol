// public/admin/admin.js — admin dashboard logic (P2). Role-gated by the account token (js/auth/gate.js); draws the online
// time-series as an SVG line chart (no external lib, CSP-safe), lists players/rooms/accounts and drives the admin actions.
import { getToken, clearToken } from '/js/auth/gate.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const token = getToken();
const msgEl = $('#msg');
let msgTimer = null;

function toast(text, kind) {
  msgEl.textContent = text;
  msgEl.className = 'adm-msg show' + (kind ? ' ' + kind : '');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { msgEl.className = 'adm-msg'; }, 2600);
}
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmmss = (t) => new Date(t).toLocaleTimeString('zh-CN', { hour12: false });

// ---- chart ----------------------------------------------------------------------------------------------------------
let chartState = null;
function smoothPath(p) {
  if (p.length < 2) return p.length ? `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}` : '';
  let d = `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}
function renderChart(history) {
  const svg = $('#chart');
  const W = 900, H = 260, L = 42, R = 14, T = 14, B = 28;
  const pw = W - L - R, ph = H - T - B;
  const pts = history.length ? history : [{ t: Date.now(), online: 0 }];
  const maxY = Math.max(1, ...pts.map((p) => p.online));
  const niceMax = Math.max(1, Math.ceil(maxY / 5) * 5);
  const n = pts.length;
  const x = (i) => L + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v) => T + ph - (v / niceMax) * ph;
  const P = pts.map((p, i) => ({ x: x(i), y: y(p.online) }));
  const lineD = smoothPath(P);
  const base = T + ph;
  const areaD = `${lineD}L${P[n - 1].x.toFixed(1)},${base}L${P[0].x.toFixed(1)},${base}Z`;
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const val = (niceMax / 4) * g, gy = y(val);
    grid += `<line x1="${L}" y1="${gy.toFixed(1)}" x2="${W - R}" y2="${gy.toFixed(1)}" stroke="#222a35" stroke-width="1" ${g ? 'stroke-dasharray="3 4"' : ''}/>`
      + `<text x="${L - 7}" y="${(gy + 4).toFixed(1)}" fill="#6e7681" font-size="10" text-anchor="end">${val}</text>`;
  }
  const last = pts[n - 1], lx = P[n - 1].x, ly = P[n - 1].y;
  const midT = pts[Math.floor(n / 2)].t;
  svg.innerHTML =
    `<defs>`
    + `<linearGradient id="sp-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ed8af" stop-opacity=".34"/><stop offset="1" stop-color="#4ed8af" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="sp-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#35d8b4"/><stop offset="1" stop-color="#59f4ca"/></linearGradient>`
    + `<filter id="sp-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
    + `</defs>`
    + grid
    + `<path d="${areaD}" fill="url(#sp-area)"/>`
    + `<path d="${lineD}" fill="none" stroke="url(#sp-line)" stroke-width="2.4" stroke-linecap="round" filter="url(#sp-glow)"/>`
    + `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="8" fill="rgba(78,216,175,.18)"><animate attributeName="r" values="5;11;5" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".5;.1;.5" dur="2.4s" repeatCount="indefinite"/></circle>`
    + `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.6" fill="#59f4ca" stroke="#0d1117" stroke-width="1.5"/>`
    + `<g id="chart-hover"></g>`
    + `<text x="${L}" y="${H - 7}" fill="#6e7681" font-size="10">${hhmmss(pts[0].t)}</text>`
    + `<text x="${(L + pw / 2).toFixed(1)}" y="${H - 7}" fill="#6e7681" font-size="10" text-anchor="middle">${hhmmss(midT)}</text>`
    + `<text x="${W - R}" y="${H - 7}" fill="#6e7681" font-size="10" text-anchor="end">${hhmmss(last.t)}</text>`;
  chartState = { pts, P, L, pw, T, ph, W, H, n, niceMax };
  $('#chart-range').textContent = `每 5 秒采样 · 最近 ${Math.max(1, Math.round((last.t - pts[0].t) / 60000))} 分钟 · 峰值 ${maxY} · 当前 ${last.online}`;
}
function setupChartHover() {
  const svg = $('#chart');
  const wrap = svg.closest('.adm-chart-wrap');
  wrap.style.position = 'relative';
  const tip = document.createElement('div');
  tip.className = 'adm-chart-tip'; tip.style.display = 'none'; wrap.appendChild(tip);
  svg.addEventListener('mousemove', (e) => {
    if (!chartState) return;
    const { pts, P, L, pw, n } = chartState;
    const rect = svg.getBoundingClientRect();
    const vx = (e.clientX - rect.left) / rect.width * chartState.W;
    let i = Math.round((vx - L) / pw * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const p = P[i], d = pts[i];
    const hover = svg.querySelector('#chart-hover');
    if (hover) hover.innerHTML =
      `<line x1="${p.x.toFixed(1)}" y1="${chartState.T}" x2="${p.x.toFixed(1)}" y2="${chartState.T + chartState.ph}" stroke="#4ed8af" stroke-width="1" stroke-dasharray="3 3" opacity=".6"/>`
      + `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#59f4ca" stroke="#0d1117" stroke-width="1.5"/>`;
    tip.style.display = 'block';
    tip.innerHTML = `<b>${d.online}</b> 在线<br><span>${hhmmss(d.t)}</span>`;
    const px = p.x / chartState.W * rect.width;
    tip.style.left = Math.min(rect.width - 90, Math.max(4, px - 40)) + 'px';
    tip.style.top = Math.max(2, p.y / chartState.H * rect.height - 52) + 'px';
  });
  svg.addEventListener('mouseleave', () => {
    tip.style.display = 'none';
    const hover = svg.querySelector('#chart-hover'); if (hover) hover.innerHTML = '';
  });
}

function renderCards(c) {
  const items = [['在线', c.online], ['房间', c.rooms], ['对局', c.matches], ['玩家', c.humans], ['AI', c.bots], ['观战', c.spectators]];
  $('#cards').innerHTML = items.map(([l, n]) => `<div class="adm-card"><div class="n">${n ?? 0}</div><div class="l">${l}</div></div>`).join('');
}

// ---- tables ---------------------------------------------------------------------------------------------------------
async function loadPlayers() {
  const { j } = await api('/api/admin/players');
  if (!j?.ok) return;
  const rows = j.players.map((p) => `<tr>
    <td>${esc(p.name)}</td>
    <td><span class="adm-tag ${p.connected ? 'on' : 'off'}">${p.connected ? '在线' : '离线'}</span></td>
    <td>${p.role === 'admin' ? '<span class="adm-tag admin">管理员</span>' : p.role === 'guest' ? '<span class="adm-tag">游客</span>' : '<span class="adm-tag">用户</span>'}</td>
    <td>${esc(p.roomCode || '—')}</td>
    <td>${esc(p.addr || '—')}</td>
    <td><div class="adm-actions"><button class="adm-btn danger mini" data-kick="${esc(p.playerId)}" data-name="${esc(p.name)}">踢出</button></div></td>
  </tr>`).join('');
  $('#players-table').innerHTML = `<thead><tr><th>名字</th><th>状态</th><th>身份</th><th>房间</th><th>地址</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="6" style="color:#8b949e">暂无玩家</td></tr>'}</tbody>`;
}
async function loadRooms() {
  const { j } = await api('/api/admin/rooms');
  if (!j?.ok) return;
  const rows = j.rooms.map((r) => `<tr>
    <td><b>${esc(r.code)}</b></td>
    <td>${r.match ? '<span class="adm-tag match">对局中</span>' : '<span class="adm-tag">大厅</span>'}</td>
    <td>${esc(r.mode || '—')}</td>
    <td>${r.seats.map((s) => esc(s.name) + (s.isBot ? '🤖' : '')).join('、') || '—'}</td>
    <td>${r.spectators}</td>
    <td><div class="adm-actions">${r.match ? `<button class="adm-btn mini" data-match="${esc(r.code)}">对局控制</button>` : ''}<button class="adm-btn danger mini" data-end="${esc(r.code)}">结束对局</button></div></td>
  </tr>`).join('');
  $('#rooms-table').innerHTML = `<thead><tr><th>房号</th><th>状态</th><th>模式</th><th>席位</th><th>观战</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="6" style="color:#8b949e">暂无房间</td></tr>'}</tbody>`;
}
async function loadAccounts() {
  const { j } = await api('/api/admin/accounts');
  if (!j?.ok) return;
  const rows = j.accounts.map((a) => `<tr>
    <td>${a.id}</td>
    <td>${esc(a.username)}</td>
    <td>${a.role === 'admin' ? '<span class="adm-tag admin">管理员</span>' : '<span class="adm-tag">用户</span>'}</td>
    <td>${a.disabled ? '<span class="adm-tag off">停用</span>' : '<span class="adm-tag on">正常</span>'}</td>
    <td>${new Date(a.created_at).toLocaleDateString('zh-CN')}</td>
    <td><div class="adm-actions">
      <button class="adm-btn ghost mini" data-acc="${a.id}" data-act="${a.disabled ? 'enable' : 'disable'}">${a.disabled ? '启用' : '停用'}</button>
      <button class="adm-btn ghost mini" data-acc="${a.id}" data-act="role" data-role="${a.role === 'admin' ? 'user' : 'admin'}">${a.role === 'admin' ? '降为普通' : '设为管理'}</button>
      <button class="adm-btn ghost mini" data-acc="${a.id}" data-act="reset-password">改密</button>
      <button class="adm-btn danger mini" data-acc="${a.id}" data-act="delete" data-name="${esc(a.username)}">删除</button>
    </div></td>
  </tr>`).join('');
  $('#accounts-table').innerHTML = `<thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>状态</th><th>注册</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="6" style="color:#8b949e">暂无账号</td></tr>'}</tbody>`;
}

// ---- live match control ---------------------------------------------------------------------------------------------
let matchPanel = null;
function closeMatchPanel() { if (matchPanel) { matchPanel.remove(); matchPanel = null; } }
async function openMatchPanel(code) {
  closeMatchPanel();
  const { j } = await api('/api/admin/match-state?code=' + encodeURIComponent(code));
  if (!j?.ok) { toast('无法读取对局：' + (j?.error === 'hosted_match' ? '插件对局运行在独立进程，暂不支持' : (j?.error || '')), 'err'); return; }
  matchPanel = document.createElement('div');
  matchPanel.className = 'adm-modal';
  matchPanel.innerHTML = `<div class="adm-modal__box">
    <div class="adm-modal__head"><b>对局控制 · ${esc(code)}</b><button class="adm-btn ghost mini" data-mclose>关闭</button></div>
    <div class="adm-modal__body" id="mbody"></div>
  </div>`;
  document.body.appendChild(matchPanel);
  matchPanel.addEventListener('click', (e) => { if (e.target === matchPanel || e.target.closest('[data-mclose]')) closeMatchPanel(); });
  renderMatchPanel(code, j);
}
function renderMatchPanel(code, j) {
  const body = $('#mbody', matchPanel);
  if (!body) return;
  const rows = j.players.map((p) => `<tr>
    <td>${esc(p.name || ('座位' + p.seat))}${p.spectator ? ' <span class="adm-tag">观战</span>' : ''}${p.alive ? '' : ' <span class="adm-tag off">阵亡</span>'}</td>
    <td>${p.lp}</td>
    <td><div class="adm-funds"><input type="number" min="0" max="1000000000" value="${p.funds}" data-finput="${esc(p.playerId)}"><button class="adm-btn mini" data-setfunds="${esc(p.playerId)}">设为</button></div></td>
  </tr>`).join('');
  body.innerHTML = `
    <div class="adm-mrow"><span>当前回合 <b>R${j.round}</b> · 相位 <b>${esc(j.phase)}</b>${j.bossRound ? ` · Boss R${j.bossRound}` : ''}</span></div>
    <div class="adm-mrow"><label>跳到回合</label><input type="number" min="1" max="${j.lastRound || 30}" value="${j.round}" id="mround"><button class="adm-btn mini" data-setround>跳转</button><span class="adm-sub">跳转不结算中间回合；LP≤0 者先被淘汰</span></div>
    <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>玩家</th><th>LP</th><th>金钱（绝对值）</th></tr></thead><tbody>${rows || '<tr><td colspan="3" style="color:#8b949e">无席位</td></tr>'}</tbody></table></div>`;
  body.onclick = async (e) => {
    const sf = e.target.closest('[data-setfunds]');
    if (sf) {
      const pid = sf.dataset.setfunds;
      const inp = body.querySelector(`[data-finput="${pid}"]`);
      const amount = Number(inp?.value);
      const { j: r } = await api('/api/admin/match-edit', { method: 'POST', body: { code, cmd: 'funds', playerId: pid, amount } });
      toast(r?.ok ? `金钱已设为 ${r.funds}` : ('失败：' + (r?.error || '')), r?.ok ? 'ok' : 'err');
      if (r?.ok) refreshMatchPanel(code);
      return;
    }
    const sr = e.target.closest('[data-setround]');
    if (sr) {
      const round = Number($('#mround', body)?.value);
      if (!confirm(`把房间 ${code} 跳到回合 ${round}？中间回合不结算。`)) return;
      const { j: r } = await api('/api/admin/match-edit', { method: 'POST', body: { code, cmd: 'round', round } });
      toast(r?.ok ? `已跳到 R${r.round}` : ('失败：' + (r?.error || '') + (r?.detail ? ' ' + r.detail : '')), r?.ok ? 'ok' : 'err');
      if (r?.ok) refreshMatchPanel(code);
      return;
    }
  };
}
async function refreshMatchPanel(code) {
  if (!matchPanel) return;
  const { j } = await api('/api/admin/match-state?code=' + encodeURIComponent(code));
  if (j?.ok) renderMatchPanel(code, j); else closeMatchPanel();
}

// ---- actions --------------------------------------------------------------------------------------------------------
document.addEventListener('click', async (e) => {
  const kick = e.target.closest('[data-kick]');
  if (kick) {
    if (!confirm(`把 ${kick.dataset.name} 踢出房间？`)) return;
    const { j } = await api('/api/admin/kick', { method: 'POST', body: { playerId: kick.dataset.kick } });
    toast(j?.ok ? '已踢出' : ('失败：' + (j?.error || '')), j?.ok ? 'ok' : 'err');
    loadPlayers(); loadRooms(); return;
  }
  const end = e.target.closest('[data-end]');
  if (end) {
    if (!confirm(`结束房间 ${end.dataset.end} 的对局？所有成员会被退回大厅。`)) return;
    const { j } = await api('/api/admin/end-room', { method: 'POST', body: { code: end.dataset.end } });
    toast(j?.ok ? '对局已结束' : ('失败：' + (j?.error || '')), j?.ok ? 'ok' : 'err');
    loadRooms(); return;
  }
  const match = e.target.closest('[data-match]');
  if (match) { openMatchPanel(match.dataset.match); return; }
  const acc = e.target.closest('[data-acc]');
  if (acc) {
    const id = Number(acc.dataset.acc), act = acc.dataset.act;
    const body = { id, action: act };
    if (act === 'role') body.role = acc.dataset.role;
    if (act === 'reset-password') { const pw = prompt('输入新密码（≥6 位）：'); if (!pw) return; body.password = pw; }
    if (act === 'delete' && !confirm(`删除账号 ${acc.dataset.name}？不可恢复。`)) return;
    const { j } = await api('/api/admin/account', { method: 'POST', body });
    toast(j?.ok ? '已更新' : ('失败：' + (j?.error || '')), j?.ok ? 'ok' : 'err');
    loadAccounts(); return;
  }
  const ref = e.target.closest('[data-refresh]');
  if (ref) { ({ players: loadPlayers, rooms: loadRooms, accounts: loadAccounts })[ref.dataset.refresh]?.(); }
});

$('#create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { j } = await api('/api/admin/accounts', { method: 'POST', body: { username: f.get('username'), password: f.get('password'), role: f.get('role') } });
  toast(j?.ok ? '账号已创建' : ('失败：' + (j?.error || '')), j?.ok ? 'ok' : 'err');
  if (j?.ok) e.target.reset();
  loadAccounts();
});

// [admin-title] / [announce] broadcast tab: load this admin's 称号, save it, and fire a server-wide marquee.
async function loadBroadcast() {
  const { j } = await api('/api/admin/title');
  if (j?.ok) $('#title-input').value = j.title || '管理';
}
$('#title-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#title-input').value.trim();
  const { j } = await api('/api/admin/title', { method: 'POST', body: { title } });
  toast(j?.ok ? ('称号已保存：' + j.title) : ('失败：' + (j?.error || '')), j?.ok ? 'ok' : 'err');
});
$('#announce-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = { text: $('#ann-text').value.trim(), size: Number($('#ann-size').value), speed: Number($('#ann-speed').value), color: $('#ann-color').value };
  const { j } = await api('/api/admin/announce', { method: 'POST', body });
  toast(j?.ok ? '公告已发送到全服' : ('失败：' + (j?.error || '')), j?.ok ? 'ok' : 'err');
  if (j?.ok) $('#ann-text').value = '';
});

$$('.adm-tab').forEach((t) => t.addEventListener('click', () => {
  $$('.adm-tab').forEach((x) => x.classList.toggle('is-active', x === t));
  $$('[data-panel]').forEach((p) => p.classList.toggle('is-hidden', p.dataset.panel !== t.dataset.tab));
  ({ players: loadPlayers, rooms: loadRooms, accounts: loadAccounts, broadcast: loadBroadcast })[t.dataset.tab]?.();
}));

$('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  clearToken();
  location.replace('/login');
});

// ---- boot + refresh -------------------------------------------------------------------------------------------------
async function refreshStats() {
  const { status, j } = await api('/api/admin/stats');
  if (status === 403 || !j?.ok) {
    $('#gate').classList.remove('is-hidden');
    $('#main').classList.add('is-hidden');
    return false;
  }
  $('#gate').classList.add('is-hidden');
  $('#main').classList.remove('is-hidden');
  renderCards(j.current);
  renderChart(j.history);
  return true;
}

(async () => {
  if (!token) { location.replace('/login'); return; }
  const me = await api('/api/auth/me');
  if (me.j?.ok && me.j.account) $('#who').textContent = me.j.account.username + '（管理员）';
  const okNow = await refreshStats();
  if (!okNow) return;
  setupChartHover();
  loadPlayers();
  setInterval(refreshStats, 5000);
  setInterval(() => {
    if (!$('[data-panel="players"]').classList.contains('is-hidden')) loadPlayers();
    if (!$('[data-panel="rooms"]').classList.contains('is-hidden')) loadRooms();
  }, 10000);
})();
