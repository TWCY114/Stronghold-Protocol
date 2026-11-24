// public/login/login.js — the login fork's sign-in logic. Token-only is the default mode for both login and register;
// a token-only registration hands the permanent token to the player to keep (no password). Mint-themed. External module
// so the page CSP (script-src 'self') allows it.
import { setToken, getToken } from '/js/auth/gate.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const msg = $('.login-msg');
const panels = $$('.login-form');
const modes = { login: 'token', register: 'token' };
let pendingToken = null;

const ERRORS = {
  bad_username: '用户名需 2–16 位字母、数字或中文',
  bad_password: '密码需 6–64 位',
  taken: '该用户名已被注册',
  bad_credentials: '用户名或密码错误',
  bad_token: 'token 无效或已失效',
  disabled: '该账号已被停用',
  rate_limited: '尝试过于频繁，请稍后再试',
  bad_name: '请填写昵称',
  bad_body: '请求格式错误',
};

function setMsg(text, kind) { msg.textContent = text; msg.className = 'login-msg' + (kind ? ' is-' + kind : ''); }
function show(tab) {
  panels.forEach((p) => p.classList.toggle('is-hidden', p.dataset.panel !== tab));
  $('#token-result').classList.add('is-hidden');
  setMsg('');
}
function setMode(panel, mode) {
  modes[panel] = mode;
  const form = $(`.login-form[data-panel="${panel}"]`);
  $$('.login-mode button', form).forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
  $$('.login-fields', form).forEach((g) => {
    const on = g.dataset.fields === mode;
    g.classList.toggle('is-hidden', !on);
    $$('input', g).forEach((i) => { i.required = on; });   // hidden fields must not block submit
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

$$('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
$$('.login-mode').forEach((m) => m.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) setMode(m.dataset.modefor, b.dataset.mode);
}));

panels.forEach((p) => p.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(p);
  const tab = p.dataset.panel;
  const btn = $('.login-submit', p);
  btn.disabled = true;
  try {
    if (tab === 'login') {
      const body = modes.login === 'token'
        ? { mode: 'token', token: String(f.get('token') || '').trim() }
        : { mode: 'password', username: f.get('username'), password: f.get('password') };
      const { j } = await call('/api/auth/login', body);
      if (j?.ok) enter(j); else setMsg(ERRORS[j?.error] || '登录失败', 'err');
    } else if (tab === 'register') {
      if (modes.register === 'token') {
        const { j } = await call('/api/auth/register', { mode: 'token', username: f.get('username') });
        if (j?.ok) handOffToken(j); else setMsg(ERRORS[j?.error] || '注册失败', 'err');
      } else {
        const pw = f.get('password');
        if (pw !== f.get('confirm')) { setMsg('两次密码不一致', 'err'); return; }
        const { j } = await call('/api/auth/register', { mode: 'password', username: f.get('username'), password: pw });
        if (j?.ok) enter(j); else setMsg(ERRORS[j?.error] || '注册失败', 'err');
      }
    } else {
      const { j } = await call('/api/auth/guest', { name: f.get('name') });
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
