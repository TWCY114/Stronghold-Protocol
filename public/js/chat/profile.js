// public/js/chat/profile.js — [player-id] the fork's player identity UI:
//   • ProfileButton: lobby top-bar entry (right of 添加到桌面) opening an Arknights-style 个人主页 (rename, friends list with
//     a search box above it, and a player search tab).
//   • PlayerCard: a Delta-Force-style popup名片 shown when any player name is clicked (chat / friends / search).
//   • search "名字#编号" → exact one; "名字" → all same-name players.
// Cross-module actions use DOM events: 'sp-player-card' {id} opens a card; 'sp-open-pm' {id,name} opens a private chat.
import { net } from '../net.js';
import { createStore, useStore } from '../store.js';
import { html, Button, Modal, Icon } from '../ui/components.js';
import { useState, useEffect } from '../../vendor/hooks.module.js';
import { getToken } from '../auth/gate.js';
import { logout } from '../auth/logout.js';

const pstore = createStore({ open: false, me: null, friends: [], tab: 'friends', friendQuery: '', searchQ: '', results: [], searching: false, card: null, editing: false, nameDraft: '', busy: false, confirmDelete: false });
const auth = () => ({ Authorization: `Bearer ${getToken() || ''}` });
const pget = async (p) => (await fetch(p, { headers: auth() })).json();
const ppost = async (p, b) => (await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify(b || {}) })).json();
const fmtDate = (t) => t ? new Date(t).toLocaleDateString('zh-CN') : '—';

let toastEl = null, toastTimer = null;
function toast(text) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'sp-profile-toast'; document.body.appendChild(toastEl);
    const st = document.createElement('style'); st.textContent = '.sp-profile-toast{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:9700;padding:8px 16px;background:rgba(13,17,23,.95);border:1px solid var(--mint-a35,rgba(78,216,175,.4));border-radius:8px;color:#e6edf3;font-size:13px;opacity:0;transition:.2s;pointer-events:none}.sp-profile-toast.show{opacity:1}'; document.head.appendChild(st); }
  toastEl.textContent = text; toastEl.className = 'sp-profile-toast show'; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.className = 'sp-profile-toast', 2400);
}

export async function openCard(id) {
  if (!id) return;
  const r = await pget('/api/player/profile?id=' + id);
  if (r.ok) pstore.set({ card: r.profile }); else toast('找不到该玩家');
}
async function loadMe() { const r = await pget('/api/player/me'); if (r.ok) pstore.set({ me: r.profile }); }
async function loadFriends() { const r = await pget('/api/player/friends'); if (r.ok) pstore.set({ friends: r.friends }); }
async function doSearch() {
  const q = pstore.get().searchQ.trim(); if (!q) return;
  pstore.set({ searching: true });
  const r = await pget('/api/player/search?q=' + encodeURIComponent(q));
  pstore.set({ results: r.ok ? r.results : [], searching: false });
}
async function saveName() {
  const name = pstore.get().nameDraft.trim(); if (!name) return;
  pstore.set({ busy: true });
  const r = await ppost('/api/player/rename', { name });
  pstore.set({ busy: false });
  if (r.ok) { pstore.set({ me: r.profile, editing: false }); toast('名字已更新为 ' + r.profile.tag); }
  else toast(r.error === 'bad_name' ? '名字需 2–16 个字符（中文/字母/数字/下划线）' : '改名失败');
}
async function deleteAccount() {
  pstore.set({ busy: true });
  const r = await ppost('/api/player/delete', {});
  pstore.set({ busy: false, confirmDelete: false });
  if (r.ok) { toast('账号已注销'); await logout(); }   // logout() clears the token, closes the socket and returns to /login
  else toast('注销失败，请稍后再试');
}

let wired = false;
export function installProfile() {
  if (wired) return; wired = true;
  window.addEventListener('sp-player-card', (e) => openCard(e.detail?.id));
  net.on('welcome', (m) => { if (m.account?.id) loadMe(); });
  if (net.status === 'online') loadMe();
}

/** The Delta-Force-style player名片 popup. */
function PlayerCard() {
  const card = useStore((s) => s.card, Object.is, pstore);
  if (!card) return null;
  const me = pstore.get().me;
  const isSelf = me && me.id === card.id;
  const close = () => pstore.set({ card: null });
  const addFriend = () => { net.send('friend.request', { toId: card.id }); toast('好友请求已发送'); };
  const pm = () => { window.dispatchEvent(new CustomEvent('sp-open-pm', { detail: { id: card.id, name: card.name } })); close(); };
  // [friend-gate] 私聊 is friends-only: for a non-friend the button is greyed, hover explains why, and clicking raises
  // the explicit error instead of opening a private chat.
  const pmBlocked = () => toast('错误：你与对方还不是好友');
  // [report] card-only report for bad speech; admin reviews and can pull the player's chat history.
  const report = () => { net.send('chat.report', { targetId: card.id, reason: '发言不善' }); toast('举报已提交，管理员会核查'); };
  return html`<${Modal} open=${true} onClose=${close} title="玩家名片" micro="PLAYER CARD" width="3.1rem" class="df-card">
    <style>${CARD_CSS}</style>
    <div class="df-card__body">
      <div class="df-card__top">
        <div class="df-avatar">${(card.name || '?').slice(0, 1).toUpperCase()}</div>
        <div class="df-card__id">
          <div class="df-name">${card.name}<span class="df-disc">#${card.disc}</span></div>
          <div class="df-meta"><i class=${'df-dot' + (card.online ? ' on' : '')}></i>${card.online ? '在线' : '离线'} · ID ${card.id}</div>
          ${(card.profile_title || card.profile_badge) ? html`<div class="df-titles">${card.profile_title ? html`<span class="df-title">${card.profile_title}</span>` : null}${card.profile_badge ? html`<span class="df-badge">${card.profile_badge}</span>` : null}</div>` : null}
        </div>
      </div>
      <div class="df-stats">
        <div class="df-stat"><b>${card.friendsCount}</b><span>好友</span></div>
        <div class="df-stat"><b>${fmtDate(card.createdAt)}</b><span>注册</span></div>
        <div class="df-stat"><b>${card.role === 'admin' ? '管理' : '玩家'}</b><span>身份</span></div>
      </div>
      ${isSelf ? html`<p class="df-self">这是你自己的名片</p>` : html`<div class="df-actions">
        <${Button} size="sm" onClick=${addFriend} disabled=${!!card.isFriend}>${card.isFriend ? '已是好友' : '加好友'}<//>
        ${card.isFriend
          ? html`<${Button} size="sm" variant="secondary" onClick=${pm}>私聊<//>`
          : html`<${Button} size="sm" variant="secondary" class="df-pm-off" onClick=${pmBlocked} title="你与对方还不是好友" aria-disabled="true">私聊<//>`}
        <${Button} size="sm" variant="secondary" class="df-report" onClick=${report} title="举报该玩家发言不善">举报<//>
      </div>`}
    </div>
  <//>`;
}

/** The Arknights-style 个人主页 (full overlay). */
function ProfilePage({ onClose }) {
  const s = useStore((x) => x, Object.is, pstore);
  useEffect(() => { loadMe(); loadFriends(); }, []);
  const me = s.me;
  const friends = s.friends.filter((f) => !s.friendQuery || (f.name || '').toLowerCase().includes(s.friendQuery.toLowerCase()) || (f.tag || '').toLowerCase().includes(s.friendQuery.toLowerCase()));
  const setTab = (t) => pstore.set({ tab: t });

  const sidebar = html`<aside class="ak-side">
    <div class="ak-avatar">${(me?.name || '?').slice(0, 1).toUpperCase()}</div>
    ${s.editing ? html`<div class="ak-rename">
        <input value=${s.nameDraft} maxLength=${16} onInput=${(e) => pstore.set({ nameDraft: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') saveName(); }} placeholder="新名字（2–16 字符）" />
        <div class="ak-rename__btn"><${Button} size="sm" onClick=${saveName} disabled=${s.busy}>保存<//><${Button} size="sm" variant="ghost" onClick=${() => pstore.set({ editing: false })}>取消<//></div>
      </div>` : html`<div class="ak-name">${me?.name || '…'}<span class="ak-disc">#${me?.disc ?? '----'}</span></div>`}
    <div class="ak-idline">ID <b>${me?.id ?? '—'}</b></div>
    <div class="ak-statrow"><div class="ak-stat"><b>${s.friends.length}</b><span>好友</span></div><div class="ak-stat"><b>${fmtDate(me?.createdAt)}</b><span>注册</span></div></div>
    ${!s.editing ? html`<${Button} size="sm" variant="secondary" class="ak-editbtn" onClick=${() => pstore.set({ editing: true, nameDraft: me?.name || '' })} icon="edit">更改名字<//>` : null}
    <div class="ak-acct">
      <${Button} size="sm" variant="ghost" class="ak-logout" onClick=${() => logout()} data-testid="profile-logout">登出<//>
      <${Button} size="sm" variant="ghost" class="ak-danger" onClick=${() => pstore.set({ confirmDelete: true })} data-testid="profile-delete">注销账号<//>
    </div>
    <p class="ak-hint">公开身份为「名字#编号」。编号全局唯一且固定，改名不会改变编号。</p>
  </aside>`;

  const friendsTab = html`<div class="ak-main">
    <div class="ak-search"><input value=${s.friendQuery} onInput=${(e) => pstore.set({ friendQuery: e.target.value })} placeholder="在好友中搜索名字…" /><${Icon} name="search" /></div>
    <div class="ak-list">
      ${!friends.length ? html`<p class="ak-empty">${s.friendQuery ? '没有匹配的好友' : '还没有好友，去「搜索玩家」添加吧'}</p>` : friends.map((f) => html`<div key=${f.id} class="ak-row">
        <i class=${'ak-dot' + (f.online ? ' on' : '')}></i>
        <button class="ak-rowname" onClick=${() => openCard(f.id)}>${f.name}<span class="ak-rowdisc">#${f.disc}</span></button>
        <${Button} size="sm" variant="ghost" onClick=${() => window.dispatchEvent(new CustomEvent('sp-open-pm', { detail: { id: f.id, name: f.name } }))}>私聊<//>
        <${Button} size="sm" variant="ghost" onClick=${() => { if (confirm('删除该好友？')) { net.send('friend.remove', { otherId: f.id }); setTimeout(loadFriends, 400); } }}>删除<//>
      </div>`)}
    </div>
  </div>`;

  const searchTab = html`<div class="ak-main">
    <div class="ak-search">
      <input value=${s.searchQ} onInput=${(e) => pstore.set({ searchQ: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') doSearch(); }} placeholder="搜索玩家：名字#编号 或 名字" />
      <${Button} size="sm" onClick=${doSearch} disabled=${s.searching}>搜索<//>
    </div>
    <p class="ak-hint">带 #编号 精确找一人；只输名字列出所有同名玩家。</p>
    <div class="ak-list">
      ${s.searching ? html`<p class="ak-empty">搜索中…</p>` : !s.results.length ? html`<p class="ak-empty">${s.searchQ ? '没有找到匹配的玩家' : '输入名字开始搜索'}</p>` : s.results.map((r) => html`<div key=${r.id} class="ak-row">
        <i class=${'ak-dot' + (r.online ? ' on' : '')}></i>
        <button class="ak-rowname" onClick=${() => openCard(r.id)}>${r.name}<span class="ak-rowdisc">#${r.disc}</span></button>
        <span class="ak-rowid">ID ${r.id}</span>
        <${Button} size="sm" variant="ghost" onClick=${() => openCard(r.id)}>名片<//>
      </div>`)}
    </div>
  </div>`;

  return html`<${Modal} open=${true} onClose=${onClose} title="个人主页" micro="PROFILE" width="7rem" class="ak-profile">
    <style>${AK_CSS}</style>
    <div class="ak-banner"><span class="ak-banner__t">卫戍协议 · 盟约</span><span class="ak-banner__s">PERSONAL PROFILE</span></div>
    <div class="ak-body">
      ${sidebar}
      <section class="ak-content">
        <div class="ak-tabs">
          <button class=${'ak-tab' + (s.tab === 'friends' ? ' on' : '')} onClick=${() => setTab('friends')}>好友（${s.friends.length}）</button>
          <button class=${'ak-tab' + (s.tab === 'search' ? ' on' : '')} onClick=${() => setTab('search')}>搜索玩家</button>
          ${me?.role === 'admin' ? html`<a class="ak-adminbtn" href="/admin" target="_blank" rel="noopener" data-testid="profile-admin" title="进入管理后台">⚙ 管理后台</a>` : null}
        </div>
        ${s.tab === 'friends' ? friendsTab : searchTab}
      </section>
    </div>
    ${s.confirmDelete ? html`<${DeleteConfirm} />` : null}
  <//>`;
}

/** Destructive confirmation for 注销账号 (permanent account deletion). */
function DeleteConfirm() {
  const busy = useStore((s) => s.busy, Object.is, pstore);
  const close = () => pstore.set({ confirmDelete: false });
  return html`<${Modal} open=${true} onClose=${close} title="注销账号" micro="DANGER" tone="red" width="3.2rem" class="ak-delconfirm">
    <p class="ak-delwarn">注销后，你的账号、编号、好友关系、私聊与聊天记录将<strong>永久删除，无法恢复</strong>。此操作不可撤销。</p>
    <div class="ak-delbtn">
      <${Button} size="sm" variant="ghost" onClick=${close}>取消<//>
      <${Button} size="sm" variant="danger" onClick=${deleteAccount} disabled=${busy} data-testid="confirm-delete-btn">${busy ? '注销中…' : '确认注销'}<//>
    </div>
  <//>`;
}

/** Lobby top-bar entry — right of 添加到桌面. Also hosts the global player名片 popup. */
export function ProfileButton({ class: cls, size = 'sm', variant = 'ghost', square = false }) {
  const open = useStore((s) => s.open, Object.is, pstore);
  const card = useStore((s) => s.card, Object.is, pstore);
  return html`<${Button} variant=${variant} size=${size} square=${square} icon="user" class=${`profile-btn ${cls || ''}`}
      onClick=${() => pstore.set({ open: true })} title="个人主页" aria-label="个人主页" data-testid="profile-btn">${square ? null : '主页'}<//>
    ${open ? html`<${ProfilePage} onClose=${() => pstore.set({ open: false })} />` : null}
    ${card ? html`<${PlayerCard} />` : null}`;
}

// [auth-fork] lobby top-bar admin entry, rendered immediately right of ProfileButton. Admin-only: it checks the signed-in
// account's role via /api/player/me and renders nothing for non-admins. Opens the fork admin console in a new tab.
let adminCssDone = false;
function ensureAdminCss() {
  if (adminCssDone) return; adminCssDone = true;
  const st = document.createElement('style');
  st.textContent = '.lobby-admin.btn{background:var(--mint-500,#4ed8af);border-color:var(--mint-500,#4ed8af);color:#04140f}'
    + '.lobby-admin.btn:hover{background:var(--mint-400,#59f4ca);border-color:var(--mint-400,#59f4ca);box-shadow:0 0 .08rem var(--mint-a35,rgba(78,216,175,.4))}'
    + '.lobby-admin .btn__icon{color:#04140f}';
  document.head.appendChild(st);
}
export function AdminButton({ class: cls = '' }) {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    pget('/api/player/me').then((r) => { if (alive && r.ok && r.profile?.role === 'admin') setIsAdmin(true); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!isAdmin) return null;
  ensureAdminCss();
  return html`<${Button} variant="secondary" size="sm" square=${true} icon="shield" class=${'lobby-admin ' + cls}
    onClick=${() => window.open('/admin', '_blank', 'noopener')} title="进入管理后台" aria-label="管理后台" data-testid="lobby-admin" />`;
}

const AK_CSS = `
.ak-profile .modal__body{padding:0}
.ak-banner{display:flex;align-items:baseline;justify-content:space-between;padding:.12rem .18rem;background:var(--mint-a10,rgba(78,216,175,.1));border-bottom:1px solid var(--mint-a35,rgba(78,216,175,.3))}
.ak-banner__t{font-size:.16rem;font-weight:700;color:var(--text-hi,#e6edf3)}
.ak-banner__s{font-size:.1rem;letter-spacing:.18em;color:var(--mint-400,#59f4ca)}
.ak-body{display:flex;gap:.16rem;padding:.16rem .18rem}
.ak-side{width:2rem;flex:none;display:flex;flex-direction:column;align-items:center;gap:.07rem;padding:.14rem .1rem;background:var(--bg-1,#141816);border:1px solid var(--line,#2f3a35);border-radius:.1rem}
.ak-avatar{width:.84rem;height:.84rem;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.34rem;font-weight:700;color:#04140f;background:var(--mint-500,#4ed8af);border:.03rem solid var(--mint-a35,rgba(78,216,175,.4))}
.ak-name{font-size:.18rem;font-weight:700;color:var(--text-hi,#e6edf3);text-align:center;word-break:break-word}
.ak-disc{color:var(--mint-400,#59f4ca);font-size:.13rem;margin-left:.03rem}
.ak-idline{font-size:.12rem;color:var(--text-dim,#8b949e)}
.ak-idline b{color:var(--text-hi,#e6edf3);font-size:.14rem}
.ak-statrow{display:flex;gap:.14rem;margin:.02rem 0}
.ak-stat{display:flex;flex-direction:column;align-items:center}
.ak-stat b{font-size:.15rem;color:var(--text-hi,#e6edf3)}
.ak-stat span{font-size:.1rem;color:var(--text-dim,#8b949e)}
.ak-editbtn{width:100%}
.ak-rename{width:100%;display:flex;flex-direction:column;gap:.05rem}
.ak-rename input{padding:.06rem .08rem;font-size:.13rem;color:var(--text-hi,#e6edf3);background:var(--bg-0,#0d1117);border:1px solid var(--mint-a35,rgba(78,216,175,.4));border-radius:.06rem;outline:none}
.ak-rename__btn{display:flex;gap:.05rem}
.ak-hint{font-size:.105rem;color:var(--text-dim,#6e7681);line-height:1.5;margin:.04rem 0 0}
.ak-content{flex:1;min-width:0;display:flex;flex-direction:column}
.ak-tabs{display:flex;gap:.06rem;border-bottom:1px solid var(--line,#2f3a35);margin-bottom:.1rem}
.ak-tab{background:none;border:none;border-bottom:.02rem solid transparent;padding:.06rem .1rem;font-size:.135rem;color:var(--text-dim,#8b949e);cursor:pointer}
.ak-tab.on{color:var(--mint-400,#59f4ca);border-bottom-color:var(--mint-500,#4ed8af)}
.ak-adminbtn{margin-left:auto;align-self:center;display:inline-flex;align-items:center;gap:.03rem;padding:.045rem .1rem;font-size:.12rem;font-weight:600;color:#04140f;background:var(--mint-500,#4ed8af);border-radius:.06rem;text-decoration:none;letter-spacing:.02em;transition:.15s}
.ak-adminbtn:hover{background:var(--mint-400,#59f4ca);box-shadow:0 0 .08rem var(--mint-a35,rgba(78,216,175,.4))}
.ak-main{display:flex;flex-direction:column;gap:.07rem}
.ak-search{display:flex;align-items:center;gap:.06rem}
.ak-search input{flex:1;padding:.07rem .1rem;font-size:.13rem;color:var(--text-hi,#e6edf3);background:var(--bg-1,#141816);border:1px solid var(--line,#2f3a35);border-radius:.07rem;outline:none}
.ak-search input:focus{border-color:var(--mint-500,#4ed8af)}
.ak-list{display:flex;flex-direction:column;gap:.03rem;max-height:3.6rem;overflow-y:auto}
.ak-empty{color:var(--text-dim,#8b949e);font-size:.125rem;padding:.1rem 0}
.ak-row{display:flex;align-items:center;gap:.07rem;padding:.06rem .08rem;background:var(--bg-1,#141816);border:1px solid var(--line,#2f3a35);border-radius:.07rem}
.ak-dot{width:.07rem;height:.07rem;border-radius:50%;background:#6e7681;flex:none}
.ak-dot.on{background:#7ee787;box-shadow:0 0 .05rem #7ee787}
.ak-rowname{flex:1;text-align:left;background:none;border:none;color:var(--text-hi,#e6edf3);font-size:.135rem;cursor:pointer;padding:0}
.ak-rowname:hover{color:var(--mint-400,#59f4ca)}
.ak-rowdisc{color:var(--mint-400,#59f4ca);font-size:.115rem;margin-left:.02rem}
.ak-rowid{font-size:.11rem;color:var(--text-dim,#6e7681)}
.ak-acct{display:flex;gap:.06rem;width:100%;margin-top:.02rem}
.ak-acct .btn{flex:1}
.ak-logout{color:var(--text-dim,#8b949e)}
.ak-danger{color:#f85149}
.ak-danger:hover{color:#ff6b61;border-color:#f85149}
.ak-delconfirm{z-index:9660}
.ak-delwarn{font-size:.13rem;line-height:1.6;color:var(--text-hi,#e6edf3);margin:.02rem 0 .12rem}
.ak-delwarn strong{color:#f85149}
.ak-delbtn{display:flex;gap:.07rem;justify-content:flex-end}
`;

const CARD_CSS = `
.df-card{z-index:9650}
.df-card .modal__body{padding:.14rem .16rem}
.df-card__body{display:flex;flex-direction:column;gap:.12rem}
.df-card__top{display:flex;align-items:center;gap:.12rem}
.df-avatar{width:.62rem;height:.62rem;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:.26rem;font-weight:700;color:#04140f;background:var(--mint-500,#4ed8af)}
.df-card__id{min-width:0}
.df-name{font-size:.17rem;font-weight:700;color:var(--text-hi,#e6edf3);word-break:break-word}
.df-disc{color:var(--mint-400,#59f4ca);font-size:.125rem;margin-left:.03rem}
.df-meta{display:flex;align-items:center;gap:.05rem;font-size:.115rem;color:var(--text-dim,#8b949e);margin-top:.03rem}
.df-dot{width:.07rem;height:.07rem;border-radius:50%;background:#6e7681}
.df-dot.on{background:#7ee787;box-shadow:0 0 .05rem #7ee787}
.df-stats{display:flex;gap:.1rem;border-top:1px solid var(--line,#2f3a35);border-bottom:1px solid var(--line,#2f3a35);padding:.09rem 0}
.df-stat{flex:1;display:flex;flex-direction:column;align-items:center;gap:.02rem}
.df-stat b{font-size:.14rem;color:var(--text-hi,#e6edf3)}
.df-stat span{font-size:.1rem;color:var(--text-dim,#8b949e)}
.df-actions{display:flex;gap:.07rem}
.df-actions .btn{flex:1}
.df-pm-off.btn{background:var(--bg-1,#141816);border-color:var(--line,#2f3a35);color:var(--text-dim,#6e7681);cursor:not-allowed;opacity:.75}
.df-pm-off.btn:hover{background:var(--bg-1,#141816);border-color:var(--line,#2f3a35);color:var(--text-dim,#6e7681);box-shadow:none}
.df-titles{display:flex;gap:.05rem;margin-top:.04rem;flex-wrap:wrap}
.df-title{font-size:.11rem;padding:.01rem .06rem;border:1px solid var(--mint-a35,rgba(78,216,175,.4));border-radius:.04rem;color:var(--mint,#4ed8af)}
.df-badge{font-size:.11rem;padding:.01rem .06rem;border:1px solid rgba(255,196,0,.45);border-radius:.04rem;color:#ffc400}
.df-report.btn{color:#ff8080;border-color:rgba(255,85,85,.4)}
.df-self{font-size:.12rem;color:var(--text-dim,#8b949e);text-align:center;margin:0}
`;
