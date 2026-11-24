// public/js/chat/friends.js — the fork's friends window, separate from chat. A top-bar button (the twin of 设置 / 玩法说明,
// placed right of 玩法说明 in the lobby) opens a simple Modal: add by account id, accept/reject requests, the friends list
// with online dots, and a private conversation per friend (persistent, offline delivered). installFriends() wires the net
// events once (main.js); <FriendsButton/> is the trigger rendered in the lobby top bar.
import { net } from '../net.js';
import { createStore, useStore } from '../store.js';
import { html, Button, Modal, Icon } from '../ui/components.js';
import { render } from '../../vendor/preact.module.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { getToken } from '../auth/gate.js';

const ERR = { need_account: '该功能需注册账号', bad_target: '目标无效', already_friends: '已经是好友', no_request: '没有该申请', not_friends: '对方不是你的好友', empty: '不能发空消息', rate_limited: '发言太快，稍等', not_online: '对方不在线', no_room: '你不在同盟中' };
const fstore = createStore({ own: null, friends: [], requests: [], pmTarget: null, pmName: '', pm: [], open: false, invitePicker: false, inviteRoom: null });
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
  // [player-id] a player名片's 私聊 button opens this window straight into the conversation.
  window.addEventListener('sp-open-pm', (e) => { const d = e.detail || {}; if (d.id) { fstore.set({ open: true }); openPM(d.id, d.name); } });
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
  // [friend-invite] an online friend's room invite pops a dialog on ANY screen; the result of our own invite toasts.
  net.on('friend.invite', (m) => showInviteDialog(m));
  net.on('friend.invite.result', (m) => toast(`${m.byName || '对方'} ${m.accept ? '接受了你的邀请' : '拒绝了你的邀请'}`));
  if (!document.getElementById('sp-friends-badge-css')) {
    const st = document.createElement('style'); st.id = 'sp-friends-badge-css';
    st.textContent = '.friends-wrap{position:relative;display:inline-flex}.friends-badge{position:absolute;top:-.05rem;right:-.05rem;min-width:.16rem;height:.16rem;padding:0 .04rem;border-radius:.08rem;background:#f85149;color:#fff;font-size:.1rem;line-height:.16rem;text-align:center;font-weight:700;box-shadow:0 0 0 2px var(--bg-0,#0d1117);pointer-events:none;z-index:5}';
    document.head.appendChild(st);
  }
  // [friend-invite] the picker is opened from the room screen too, so it lives in its own global root (not the lobby button).
  if (!document.getElementById('sp-friend-invite-host')) {
    const host = document.createElement('div'); host.id = 'sp-friend-invite-host'; document.body.appendChild(host);
    render(html`<${InviteHost} />`, host);
  }
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
      ${s.requests.length ? html`<div class="fr-sec">待处理申请</div>${s.requests.map((r) => html`<div key=${r.fromId} class="fr-row"><button class="fr-nm fr-link" onClick=${() => window.dispatchEvent(new CustomEvent('sp-player-card', { detail: { id: r.fromId } }))}>${r.fromName || '账号' + r.fromId}<span class="fr-tag">${r.fromTag ? '#' + r.fromTag.split('#')[1] : ' (#' + r.fromId + ')'}</span></button><${Button} size="sm" onClick=${() => net.send('friend.respond', { fromId: r.fromId, accept: true })}>同意<//><${Button} size="sm" variant="ghost" onClick=${() => net.send('friend.respond', { fromId: r.fromId, accept: false })}>拒绝<//></div>`)}` : null}
      <div class="fr-sec">好友（${s.friends.length}）</div>
      ${!s.friends.length ? html`<p class="fr-empty">还没有好友</p>` : s.friends.map((f) => html`<div key=${f.accountId} class="fr-row"><i class=${'fr-dot' + (f.online ? ' on' : '')}></i><button class="fr-nm fr-link" onClick=${() => window.dispatchEvent(new CustomEvent('sp-player-card', { detail: { id: f.accountId } }))}>${f.name || '账号' + f.accountId}<span class="fr-tag">${f.disc != null ? '#' + f.disc : ' (#' + f.accountId + ')'}</span></button><${Button} size="sm" variant="ghost" onClick=${() => openPM(f.accountId, f.name)}>私聊<//><${Button} size="sm" variant="ghost" onClick=${() => { if (confirm('删除该好友？')) net.send('friend.remove', { otherId: f.accountId }); }}>删除<//></div>`)}
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
.fr-link{background:none;border:none;text-align:left;cursor:pointer;font-family:inherit}
.fr-link:hover{color:var(--mint-400,#59f4ca)}
.fr-tag{color:var(--mint-400,#59f4ca);font-size:.11rem;margin-left:.03rem}
`;

/** [friend-invite] open the online-friends invite picker from the room screen (room.js onInvite / 邀请好友). */
export function openFriendInvite(roomCode) {
  if (net.status === 'online') net.send('friend.list', {});
  fstore.set({ invitePicker: true, inviteRoom: roomCode || null });
}

/** [friend-invite] the picker: online friends get a one-click 邀请; the key/link stay copyable as a fallback. */
function InvitePickerModal({ onClose }) {
  const s = useStore((x) => x, Object.is, fstore);
  const online = s.friends.filter((f) => f.online);
  const invite = (f) => { net.send('friend.invite', { toId: f.accountId }); toast(`已向 ${f.name || '账号' + f.accountId} 发送邀请`); };
  const copy = async (what) => {
    const code = s.inviteRoom; if (!code) return;
    const { copyText, inviteLink } = await import('../screens/room.js');
    const ok = await copyText(what === 'code' ? code : inviteLink(code));
    toast(ok ? (what === 'code' ? `已复制同盟密钥 ${code}` : '已复制邀请链接') : '复制失败，请手动复制');
  };
  return html`<${Modal} open=${true} onClose=${onClose} title="邀请好友" micro="INVITE" width="4.2rem" class="fr-modal">
    <style>${FR_CSS}</style>
    <div class="fr-list">
      ${!s.own ? html`<p class="fr-empty">游客不能邀请好友；注册后解锁。</p>` : html`
        <div class="fr-sec">在线好友（${online.length}）</div>
        ${!online.length ? html`<p class="fr-empty">暂无在线好友</p>` : online.map((f) => html`<div key=${f.accountId} class="fr-row"><i class="fr-dot on"></i><span class="fr-nm">${f.name || '账号' + f.accountId}<span class="fr-tag">${f.disc != null ? '#' + f.disc : ' (#' + f.accountId + ')'}</span></span><${Button} size="sm" onClick=${() => invite(f)}>邀请<//></div>`)}
        <div class="fr-sec">或分享邀请</div>
        <div class="fr-add"><${Button} size="sm" variant="ghost" onClick=${() => copy('code')}>复制密钥<//><${Button} size="sm" variant="ghost" onClick=${() => copy('link')}>复制链接<//></div>
      `}
    </div>
  <//>`;
}

/** [friend-invite] global root so the picker shows on any screen (room / lobby / title). */
function InviteHost() {
  const picker = useStore((s) => s.invitePicker, Object.is, fstore);
  return picker ? html`<${InvitePickerModal} onClose=${() => fstore.set({ invitePicker: false })} />` : null;
}

/** [friend-invite] a screen-independent accept/decline dialog for an incoming room invite (plain DOM, like the toast). */
let inviteEl = null;
function showInviteDialog(m) {
  if (inviteEl) inviteEl.remove();
  inviteEl = document.createElement('div'); inviteEl.className = 'sp-invite-mask';
  const card = document.createElement('div'); card.className = 'sp-invite-card';
  const txt = document.createElement('p'); txt.textContent = `${m.fromName || '有人'} 邀请你加入同盟 ${m.roomCode || ''}`;
  const row = document.createElement('div'); row.className = 'sp-invite-row';
  const yes = document.createElement('button'); yes.className = 'sp-invite-yes'; yes.textContent = '接受';
  const no = document.createElement('button'); no.className = 'sp-invite-no'; no.textContent = '拒绝';
  const done = () => { if (inviteEl) { inviteEl.remove(); inviteEl = null; } };
  yes.onclick = async () => { done(); net.send('friend.invite.respond', { fromId: m.fromId, accept: true });
    try { const { joinKnown } = await import('../screens/lobby.js'); await joinKnown('room.join', m.roomCode); } catch { toast('加入同盟失败'); } };
  no.onclick = () => { done(); net.send('friend.invite.respond', { fromId: m.fromId, accept: false }); };
  row.append(yes, no); card.append(txt, row); inviteEl.append(card); document.body.appendChild(inviteEl);
  if (!document.getElementById('sp-invite-css')) {
    const st = document.createElement('style'); st.id = 'sp-invite-css';
    st.textContent = '.sp-invite-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9600;display:flex;align-items:center;justify-content:center}.sp-invite-card{background:var(--bg-1,#141816);border:1px solid var(--mint-a35,rgba(78,216,175,.4));border-radius:.1rem;padding:.2rem .24rem;max-width:80vw;text-align:center}.sp-invite-card p{color:var(--text-hi,#e6edf3);font-size:.15rem;margin:0 0 .14rem}.sp-invite-row{display:flex;gap:.1rem;justify-content:center}.sp-invite-row button{padding:.06rem .18rem;border-radius:.06rem;font-size:.13rem;cursor:pointer;border:1px solid var(--line,#2f3a35)}.sp-invite-yes{background:var(--mint-500,#4ed8af);color:#0d1117;border:none!important;font-weight:700}.sp-invite-no{background:none;color:var(--text-dim,#8b949e)}';
    document.head.appendChild(st);
  }
}

/** The lobby top-bar friends trigger — same size/colour as the 设置 button (its twin), right of 玩法说明. */
export function FriendsButton({ class: cls, size = 'sm', variant = 'ghost', square = false }) {
  const open = useStore((s) => s.open, Object.is, fstore);
  const nreq = useStore((s) => s.requests.length, Object.is, fstore);
  return html`<span class="friends-wrap">
      <${Button} variant=${variant} size=${size} square=${square} icon="users" class=${`friends-btn ${cls || ''}`}
        onClick=${() => fstore.set({ open: true })} title="好友" aria-label="好友" data-testid="friends-btn">${square ? null : '好友'}<//>
      ${nreq > 0 ? html`<span class="friends-badge" aria-label=${nreq + ' 条好友申请'}>${nreq > 99 ? '99+' : nreq}</span>` : null}
    </span>
    ${open ? html`<${FriendsModal} onClose=${() => fstore.set({ open: false, pmTarget: null, pm: [] })} />` : null}`;
}
