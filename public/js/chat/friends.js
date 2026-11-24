// public/js/chat/friends.js — the fork's friends window, separate from chat. A top-bar button (the twin of 设置 / 玩法说明,
// placed right of 玩法说明 in the lobby) opens a simple Modal: add by account id, accept/reject requests, the friends list
// with online dots, and a private conversation per friend (persistent, offline delivered). installFriends() wires the net
// events once (main.js); <FriendsButton/> is the trigger rendered in the lobby top bar.
import { net } from '../net.js';
import { createStore, useStore } from '../store.js';
import { html, Button, Modal, Icon } from '../ui/components.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { getToken } from '../auth/gate.js';

const ERR = { need_account: '该功能需注册账号', bad_target: '目标无效', already_friends: '已经是好友', no_request: '没有该申请', not_friends: '对方不是你的好友', empty: '不能发空消息', rate_limited: '发言太快，稍等' };
const fstore = createStore({ own: null, friends: [], requests: [], pmTarget: null, pmName: '', pm: [] });
const hhmm = (t) => new Date(t).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });

let toastEl = null, toastTimer = null;
function toast(text) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'sp-friends-toast'; document.body.appendChild(toastEl);
    const st = document.createElement('style'); st.textContent = '.sp-friends-toast{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:9500;padding:8px 16px;background:rgba(13,17,23,.95);border:1px solid var(--mint-a35,rgba(78,216,175,.4));border-radius:8px;color:#e6edf3;font-size:13px;opacity:0;transition:.2s;pointer-events:none}.sp-friends-toast.show{opacity:1}'; document.head.appendChild(st); }
  toastEl.textContent = text; toastEl.className = 'sp-friends-toast show'; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.className = 'sp-friends-toast', 2400);
}

let wired = false;
export function installFriends() {
  if (wired) return; wired = true;
  const refresh = () => { if (net.status === 'online') net.send('friend.list', {}); };
  net.on('welcome', (m) => { if (m.account?.id) fstore.set({ own: m.account.id }); refresh(); });
  net.on('status', () => { if (net.status === 'online') refresh(); });
  net.on('friend.list', (m) => fstore.set({ friends: m.friends || [], requests: m.requests || [] }));
  net.on('friend.request', (m) => { fstore.set((s) => ({ requests: [...s.requests, { fromId: m.fromId, fromName: m.fromName }] })); toast(`${m.fromName || '有人'} 请求加你为好友`); });
  net.on('friend.accepted', () => { net.send('friend.list', {}); toast('对方同意了你的好友请求'); });
  net.on('friend.result', (m) => { if (!m.ok) toast(ERR[m.error] || '操作失败'); else { net.send('friend.list', {}); if (m.action === 'request') toast('好友请求已发送'); } });
  net.on('pm.message', (m) => {
    const other = m.fromId === fstore.get().own ? m.toId : m.fromId;
    if (fstore.get().pmTarget === other) fstore.set((s) => ({ pm: [...s.pm, { from_id: m.fromId, body: m.body, created_at: m.at }] }));
    else if (m.fromId !== fstore.get().own) toast(`新私聊：${m.fromName || '账号' + m.fromId}`);
  });
  net.on('pm.history', (m) => { if (fstore.get().pmTarget === m.otherId) fstore.set({ pm: m.messages || [] }); });
  (async () => { try { const t = getToken(); if (t) { const me = await (await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })).json(); if (me.account) fstore.set({ own: me.account.id }); } } catch {} refresh(); })();
}

function openPM(id, name) { fstore.set({ pmTarget: id, pmName: name || '', pm: [] }); net.send('pm.history', { otherId: id }); }

function FriendsModal({ onClose }) {
  const s = useStore((x) => x, Object.is, fstore);
  const [aid, setAid] = useState('');
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [s.pm, s.pmTarget]);
  const sendPM = () => { const v = draft.trim(); if (!v || !s.pmTarget) return; net.send('pm.send', { toId: s.pmTarget, body: v }); setDraft(''); };

  const pmView = html`<div class="fr-pm">
    <div class="fr-pm__head"><button class="fr-back" onClick=${() => fstore.set({ pmTarget: null, pm: [] })}>← 返回</button><span>私聊 · ${s.pmName || '账号' + s.pmTarget}</span></div>
    <div class="fr-pm__list" ref=${listRef}>
      ${!s.pm.length ? html`<p class="fr-empty">暂无私聊记录</p>` : s.pm.map((m, i) => html`<div key=${i} class=${'fr-line' + (m.from_id === s.own ? ' mine' : '')}><b>${m.from_id === s.own ? '我' : (s.pmName || '对方')}</b>: ${m.body}<span class="fr-t">${m.created_at ? hhmm(m.created_at) : ''}</span></div>`)}
    </div>
    <div class="fr-pm__input"><input value=${draft} onInput=${(e) => setDraft(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') sendPM(); }} placeholder="私聊消息…" maxLength=${300} /><${Button} size="sm" onClick=${sendPM}>发送<//></div>
  </div>`;

  const listView = html`<div class="fr-list">
    ${!s.own ? html`<p class="fr-empty">游客不能加好友；注册后解锁。</p>` : html`
      <div class="fr-add"><input type="number" value=${aid} onInput=${(e) => setAid(e.target.value)} placeholder="输入对方账号 ID 加好友" /><${Button} size="sm" onClick=${() => { const v = Number(aid); if (v) { net.send('friend.request', { toId: v }); setAid(''); } }}>添加<//></div>
      ${s.requests.length ? html`<div class="fr-sec">待处理申请</div>${s.requests.map((r) => html`<div key=${r.fromId} class="fr-row"><span class="fr-nm">${r.fromName || '账号' + r.fromId} (#${r.fromId})</span><${Button} size="sm" onClick=${() => net.send('friend.respond', { fromId: r.fromId, accept: true })}>同意<//><${Button} size="sm" variant="ghost" onClick=${() => net.send('friend.respond', { fromId: r.fromId, accept: false })}>拒绝<//></div>`)}` : null}
      <div class="fr-sec">好友（${s.friends.length}）</div>
      ${!s.friends.length ? html`<p class="fr-empty">还没有好友</p>` : s.friends.map((f) => html`<div key=${f.accountId} class="fr-row"><i class=${'fr-dot' + (f.online ? ' on' : '')}></i><span class="fr-nm">${f.name || '账号' + f.accountId} (#${f.accountId})</span><${Button} size="sm" variant="ghost" onClick=${() => openPM(f.accountId, f.name)}>私聊<//><${Button} size="sm" variant="ghost" onClick=${() => { if (confirm('删除该好友？')) net.send('friend.remove', { otherId: f.accountId }); }}>删除<//></div>`)}
    `}
  </div>`;

  return html`<${Modal} open=${true} onClose=${onClose} title=${s.pmTarget ? '私聊' : '好友'} micro="FRIENDS" width="4.6rem" class="fr-modal">
    <style>${FR_CSS}</style>
    ${s.pmTarget ? pmView : listView}
  <//>`;
}

const FR_CSS = `
.fr-modal .fr-list,.fr-modal .fr-pm{display:flex;flex-direction:column;gap:.08rem}
.fr-empty{color:var(--text-dim,#8b949e);font-size:.13rem;margin:.04rem 0}
.fr-sec{font-size:.11rem;color:var(--text-dim,#8b949e);margin:.06rem 0 .02rem}
.fr-add{display:flex;gap:.06rem;margin-bottom:.06rem}
.fr-add input,.fr-pm__input input{flex:1;padding:.06rem .09rem;font-size:.13rem;color:var(--text-hi,#e6edf3);background:var(--bg-1,#141816);border:1px solid var(--line,#2f3a35);border-radius:.06rem;outline:none}
.fr-add input:focus,.fr-pm__input input:focus{border-color:var(--mint-500,#4ed8af)}
.fr-row{display:flex;align-items:center;gap:.06rem;padding:.05rem .02rem}
.fr-nm{flex:1;font-size:.13rem;color:var(--text-hi,#e6edf3)}
.fr-dot{width:.07rem;height:.07rem;border-radius:50%;background:#6e7681;flex:none}
.fr-dot.on{background:#7ee787;box-shadow:0 0 .05rem #7ee787}
.fr-pm__head{display:flex;align-items:center;gap:.08rem;font-size:.13rem;color:var(--mint-400,#59f4ca);padding-bottom:.06rem;border-bottom:1px solid var(--line,#2f3a35)}
.fr-back{background:none;border:none;color:var(--text-dim,#8b949e);cursor:pointer;font-size:.12rem}
.fr-pm__list{flex:1;overflow-y:auto;max-height:3.2rem;display:flex;flex-direction:column;gap:.04rem;padding:.06rem 0}
.fr-line{font-size:.13rem;color:var(--text-hi,#e6edf3);word-break:break-word}
.fr-line b{color:var(--mint-400,#59f4ca)}
.fr-line.mine b{color:var(--mint-500,#4ed8af)}
.fr-t{color:var(--text-dim,#6e7681);font-size:.1rem;margin-left:.06rem}
.fr-pm__input{display:flex;gap:.06rem}
`;

/** The lobby top-bar friends trigger — same size/colour as the 设置 button (its twin), right of 玩法说明. */
export function FriendsButton({ class: cls, size = 'sm', variant = 'ghost', square = false }) {
  const [open, setOpen] = useState(false);
  return html`<${Button} variant=${variant} size=${size} square=${square} icon="users" class=${`friends-btn ${cls || ''}`}
      onClick=${() => setOpen(true)} title="好友" aria-label="好友" data-testid="friends-btn">${square ? null : '好友'}<//>
    ${open ? html`<${FriendsModal} onClose=${() => setOpen(false)} />` : null}`;
}
