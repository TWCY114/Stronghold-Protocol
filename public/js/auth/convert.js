// public/js/auth/convert.js — guest → registered account (account-plus). <ConvertButton/> renders only for a guest pass
// (checked via /api/auth/me) and dispatches 'sp-open-convert'; installConvert() mounts an independent host on <body> so the
// upgrade modal is not nested inside (and unmounted by) the settings dialog. The modal creates a permanent account
// preserving the guest's name, swaps the local token and re-enters the game. Token / password / e-mail (code) modes.
import { net } from '../net.js';
import { getToken, setToken } from './gate.js';
import { deviceFp } from './fingerprint.js';
import { html, Button, Modal } from '../ui/components.js';
import { useState, useEffect } from '../../vendor/hooks.module.js';

const ERR = {
  bad_username: '用户名需 2–16 位字母、数字或中文', bad_password: '密码需 6–64 位', taken: '该用户名已被注册',
  bad_email: '邮箱格式不正确', bad_code: '验证码错误或已过期', email_taken: '该邮箱已注册',
  email_not_configured: '邮箱功能暂未开启', need_guest: '当前不是游客身份', device_has_account: '该设备已有账号，请去登录',
  rate_limited: '操作过于频繁，请稍后再试',
};
const toast = (t) => { try { net?.toast?.(t); } catch { /* ignore */ } };

async function api(path, body, token) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body || {}) });
  return r.json().catch(() => null);
}

function ConvertModal({ guestName, onClose }) {
  const [mode, setMode] = useState('token');
  const [username, setUsername] = useState(guestName || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [cd, setCd] = useState(0);
  useEffect(() => { if (cd <= 0) return; const t = setTimeout(() => setCd(cd - 1), 1000); return () => clearTimeout(t); }, [cd]);

  const sendCode = async () => {
    if (!email) { setMsg('请先填写邮箱'); return; }
    const j = await api('/api/auth/email/send-code', { email, purpose: 'register' });
    if (j?.ok) { setMsg('验证码已发送'); setCd(60); } else setMsg(ERR[j?.error] || '发送失败');
  };
  const submit = async () => {
    if (mode !== 'token' && password !== confirm) { setMsg('两次密码不一致'); return; }
    setBusy(true);
    const fp = await deviceFp();
    const j = await api('/api/auth/convert-guest', { mode, username, password, email, code, deviceFp: fp }, getToken());
    setBusy(false);
    if (j?.ok) { setToken(j.token); toast('转正成功，欢迎 ' + j.account.tag); setTimeout(() => location.replace('/'), 500); }
    else setMsg(ERR[j?.error] || '转正失败');
  };
  const tab = (m, label) => html`<button type="button" class=${'cv-tab' + (mode === m ? ' on' : '')} onClick=${() => { setMode(m); setMsg(''); }}>${label}</button>`;
  return html`<${Modal} open=${true} onClose=${onClose} title="转为正式账号" micro="UPGRADE" width="3.4rem" class="cv-modal">
    <p class="cv-lead">游客「${guestName}」转正后保留这个名字，获得永久编号、好友与私聊。对局进度为房间临时数据，转正后重新开始。</p>
    <div class="cv-tabs">${tab('token', '免密 token')}${tab('password', '设密码')}${tab('email', '邮箱')}</div>
    <label class="cv-f"><span>用户名</span><input value=${username} maxLength=${16} onInput=${(e) => setUsername(e.target.value)} placeholder="2–16 位字母 / 数字 / 中文" /></label>
    ${mode !== 'token' ? html`<div class="cv-pw"><label class="cv-f"><span>密码</span><input type="password" value=${password} maxLength=${64} onInput=${(e) => setPassword(e.target.value)} placeholder="6–64 位" /></label><label class="cv-f"><span>确认密码</span><input type="password" value=${confirm} maxLength=${64} onInput=${(e) => setConfirm(e.target.value)} /></label></div>` : null}
    ${mode === 'email' ? html`<div class="cv-email"><label class="cv-f"><span>邮箱</span><input type="email" value=${email} onInput=${(e) => setEmail(e.target.value)} /></label><div class="cv-code"><input value=${code} maxLength=${6} inputmode="numeric" onInput=${(e) => setCode(e.target.value)} placeholder="验证码" /><button type="button" disabled=${cd > 0} onClick=${sendCode}>${cd > 0 ? cd + 's' : '发送验证码'}</button></div></div>` : null}
    ${mode === 'token' ? html`<p class="cv-hint">免密注册：转正后给你一串永久 token 保管，凭它登录。</p>` : null}
    ${msg ? html`<p class="cv-msg">${msg}</p>` : null}
    <div class="cv-actions"><${Button} size="sm" variant="ghost" onClick=${onClose}>取消<//><${Button} size="sm" onClick=${submit} disabled=${busy} data-testid="convert-submit">${busy ? '处理中…' : '确认转正'}<//></div>
  <//>`;
}

let wired = false;
export function installConvert() {
  if (wired) return; wired = true;
  const st = document.createElement('style'); st.textContent = CV_CSS; document.head.appendChild(st);
}

/** The trigger (rendered in 设置 → 账号 by chat/settings.js); visible only to a guest pass. */
export function ConvertButton({ class: cls }) {
  const [guest, setGuest] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = getToken();
    if (!t) { setGuest(null); return; }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json())
      .then((j) => setGuest(j?.ok && j.kind === 'guest' ? (j.name || '游客') : null)).catch(() => setGuest(null));
  }, []);
  if (!guest) return null;
  return html`<span class="convert-wrap"><${Button} variant="secondary" class=${`convert-btn ${cls || ''}`} data-testid="convert-btn" title="游客转为正式账号"
    onClick=${() => setOpen(true)}>转为正式账号<//>
    ${open ? html`<${ConvertModal} guestName=${guest} onClose=${() => setOpen(false)} />` : null}</span>`;
}

const CV_CSS = `
.cv-modal{z-index:9670}
.cv-lead{font-size:.12rem;line-height:1.6;color:var(--text-dim,#8b949e);margin:.02rem 0 .1rem}
.cv-tabs{display:flex;gap:.06rem;margin-bottom:.1rem}
.cv-tab{flex:1;padding:.05rem 0;font-size:.12rem;cursor:pointer;color:var(--text-dim,#8b949e);background:none;border:1px solid var(--line,#2a313c);border-radius:.06rem}
.cv-tab.on{color:var(--mint-400,#59f4ca);border-color:var(--mint-400,#59f4ca)}
.cv-f{display:flex;flex-direction:column;gap:.03rem;margin-bottom:.08rem;font-size:.12rem;color:var(--text-dim,#8b949e)}
.cv-f input,.cv-code input{padding:.07rem .09rem;font-size:.13rem;color:var(--text-hi,#e6edf3);background:#0d1117;border:1px solid var(--line,#2a313c);border-radius:.06rem;outline:none;font-family:inherit}
.cv-f input:focus,.cv-code input:focus{border-color:var(--mint-400,#59f4ca)}
.cv-code{display:flex;gap:.06rem;margin-bottom:.08rem}
.cv-code input{flex:1;min-width:0}
.cv-code button{flex:0 0 auto;padding:0 .1rem;font-size:.12rem;cursor:pointer;color:var(--mint-400,#59f4ca);background:rgba(78,216,175,.1);border:1px solid rgba(78,216,175,.5);border-radius:.06rem}
.cv-code button:disabled{opacity:.6;cursor:default}
.cv-hint{font-size:.11rem;color:var(--text-dim,#6e7681);margin:0 0 .08rem}
.cv-msg{font-size:.12rem;color:#ff7b72;margin:0 0 .08rem}
.cv-actions{display:flex;gap:.07rem;justify-content:flex-end}
`;
