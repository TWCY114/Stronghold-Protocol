// public/login/login.js — the login fork's sign-in logic. Token-only is the default mode for both login and register;
// a token-only registration hands the permanent token to the player to keep (no password). Also supports password and
// e-mail (password or verification-code) modes, and guides a second registration on the same device to the existing
// account via a browser fingerprint. Mint-themed. External module so the page CSP (script-src 'self') allows it.
import { setToken, getToken } from '/js/auth/gate.js';
import { deviceFp } from '/js/auth/fingerprint.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const msg = $('.login-msg');
const panels = $$('.login-form');
const modes = { login: 'token', register: 'token' };
let pendingToken = null;
let fp = '';
deviceFp().then((v) => { fp = v; });

const ERRORS = {
  bad_username: '用户名需 2–16 位字母、数字或中文',
  bad_password: '密码需 6–64 位',
  taken: '该用户名已被注册',
  bad_credentials: '用户名/邮箱或密码错误',
  bad_token: 'token 无效或已失效',
  disabled: '该账号已被停用',
  rate_limited: '尝试过于频繁，请稍后再试',
  bad_name: '请填写昵称',
  bad_body: '请求格式错误',
  bad_email: '邮箱格式不正确',
  bad_code: '验证码错误或已过期',
  email_taken: '该邮箱已注册',
  email_not_configured: '邮箱功能暂未开启（服务器未配置 SMTP）',
  no_account: '该邮箱尚未注册',
  send_failed: '验证码发送失败，请稍后再试',
  smtp_failed: '邮件服务器错误，请稍后再试',
  smtp_timeout: '邮件服务器超时，请稍后再试',
  device_has_account: '该设备已注册过账号，请直接登录',
};

function setMsg(text, kind) { msg.textContent = text; msg.className = 'login-msg' + (kind ? ' is-' + kind : ''); }
function show(tab) {
  panels.forEach((p) => p.classList.toggle('is-hidden', p.dataset.panel !== tab));
  $('#token-result').classList.add('is-hidden');
  setMsg('');
  if (tab === 'register') checkDevice();
}
function setMode(panel, mode) {
  modes[panel] = mode;
  const form = $(`.login-form[data-panel="${panel}"]`);
  $$('.login-mode button', form).forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
  $$('.login-fields', form).forEach((g) => {
    const on = g.dataset.fields === mode;
    g.classList.toggle('is-hidden', !on);
    $$('input', g).forEach((i) => { i.required = on && i.name !== 'code'; });   // hidden fields must not block submit; code optional
  });
  setMsg('');
}
async function call(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null) };
}
function enter(j) {
  setToken(j.token);
  setMsg('登录成功，正在进入…', 'ok');
  setTimeout(() => location.replace('/'), 400);
}
function handOffToken(j) {
  pendingToken = j.token;
  $('#tok-value').textContent = j.token;
  panels.forEach((p) => p.classList.add('is-hidden'));
  $('#token-result').classList.remove('is-hidden');
  setMsg('注册成功！请保存你的 token', 'ok');
}
/** Read a field from the ACTIVE mode group of a panel (avoids duplicate names across hidden groups). */
function fieldVal(panel, name) {
  const g = $(`.login-form[data-panel="${panel}"] .login-fields:not(.is-hidden)`);
  const i = g && g.querySelector(`[name="${name}"]`);
  return i ? i.value.trim() : '';
}
/** [account-plus] tell the register form when this device already owns an account. */
async function checkDevice() {
  const note = $('#device-note');
  if (!fp) { note.classList.add('is-hidden'); return; }
  try {
    const r = await fetch('/api/auth/device-check?fp=' + encodeURIComponent(fp));
    const j = await r.json();
    if (j?.hasAccount) {
      $('#device-note-text').textContent = `该设备已注册过账号「${j.existing?.tag || j.existing?.name || ''}」，建议直接登录。`;
      note.classList.remove('is-hidden');
    } else note.classList.add('is-hidden');
  } catch { note.classList.add('is-hidden'); }
}

$$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
$$('.login-mode').forEach((m) => m.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) setMode(m.dataset.modefor, b.dataset.mode);
}));
$$('.login-sendcode').forEach((b) => b.addEventListener('click', async () => {
  const panel = b.closest('.login-form').dataset.panel;
  const email = fieldVal(panel, 'email');
  if (!email) { setMsg('请先填写邮箱', 'err'); return; }
  b.disabled = true;
  const { j } = await call('/api/auth/email/send-code', { email, purpose: b.dataset.purpose });
  b.disabled = false;
  if (j?.ok) { setMsg('验证码已发送，10 分钟内有效', 'ok'); let n = 60; const t = setInterval(() => { b.textContent = `${n--}s`; if (n < 0) { clearInterval(t); b.textContent = '发送验证码'; } }, 1000); }
  else setMsg(ERRORS[j?.error] || '发送失败', 'err');
}));

panels.forEach((p) => p.addEventListener('submit', async (e) => {
  e.preventDefault();
  const tab = p.dataset.panel;
  const btn = $('.login-submit', p);
  const v = (n) => fieldVal(tab, n);
  btn.disabled = true;
  try {
    if (tab === 'login') {
      let body;
      if (modes.login === 'token') body = { mode: 'token', token: v('token') };
      else if (modes.login === 'email') body = v('code') ? { mode: 'email-code', email: v('email'), code: v('code') } : { mode: 'password', email: v('email'), password: v('password') };
      else body = { mode: 'password', username: v('username'), password: v('password') };
      const { j } = await call('/api/auth/login', body);
      if (j?.ok) enter(j); else setMsg(ERRORS[j?.error] || '登录失败', 'err');
    } else if (tab === 'register') {
      const mode = modes.register;
      let body;
      if (mode === 'token') body = { mode: 'token', username: v('username'), deviceFp: fp };
      else if (mode === 'email') {
        if (v('password') !== v('confirm')) { setMsg('两次密码不一致', 'err'); return; }
        body = { mode: 'email', username: v('username'), email: v('email'), code: v('code'), password: v('password'), deviceFp: fp };
      } else {
        if (v('password') !== v('confirm')) { setMsg('两次密码不一致', 'err'); return; }
        body = { mode: 'password', username: v('username'), password: v('password'), deviceFp: fp };
      }
      const { j } = await call('/api/auth/register', body);
      if (j?.ok) { mode === 'token' ? handOffToken(j) : enter(j); }
      else if (j?.error === 'device_has_account') { setMsg(`该设备已有账号「${j.existing?.tag || ''}」，请直接登录`, 'err'); checkDevice(); }
      else setMsg(ERRORS[j?.error] || '注册失败', 'err');
    } else {
      const { j } = await call('/api/auth/guest', { name: p.querySelector('[name="name"]').value.trim() });
      if (j?.ok) enter(j); else setMsg(ERRORS[j?.error] || '进入失败', 'err');
    }
  } catch { setMsg('网络错误，请重试', 'err'); }
  finally { btn.disabled = false; }
}));

$('#tok-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(pendingToken || ''); setMsg('已复制到剪贴板', 'ok'); }
  catch { const r = document.createRange(); r.selectNodeContents($('#tok-value')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); setMsg('已选中，请手动复制', 'ok'); }
});
$('#tok-enter').addEventListener('click', () => { if (pendingToken) enter({ token: pendingToken }); });

// normalize required state for the default (token) mode
setMode('login', 'token');
setMode('register', 'token');

// Already signed in? Skip the page (validate first so a stale token does not loop).
if (getToken()) {
  fetch('/api/auth/me', { headers: { Authorization: `Bearer ${getToken()}` } })
    .then((r) => r.json())
    .then((j) => { if (j?.ok) location.replace('/'); })
    .catch(() => {});
}
