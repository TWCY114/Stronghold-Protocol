// rebase-auth.mjs — the login fork's rebase tool. An official update zip overwrites the official files and drops the
// [auth-fork] hooks; the new server/auth/ + public/login/ + public/js/auth/ directories are NOT in MANIFEST.json, so they
// survive. Run this after every update to re-apply the few hooks idempotently:
//
//   node rebase-auth.mjs            # re-apply hooks + syntax-check the touched files
//
// Each hook is anchored on a stable line of the official file. If an official refactor moves that line, the anchor count
// is not 1 and the script STOPS with a clear message — a human adapts the anchor (the only manual work an update needs).
// Re-running is safe: a hook already present is skipped.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
let failed = 0, applied = 0, skipped = 0;
const touched = new Set();

function hook(rel, anchor, addition, { mode = 'after' } = {}) {
  const p = join(ROOT, rel);
  const text = readFileSync(p, 'utf8');
  if (text.includes(addition.trim())) { skipped++; return; }
  const n = text.split(anchor).length - 1;
  if (n !== 1) {
    console.error(`✗ ${rel}: 锚点出现 ${n} 次（官方可能重构了此处，需人工适配）→ ${JSON.stringify(anchor.slice(0, 60))}`);
    failed++;
    return;
  }
  const neu = mode === 'replace' ? addition : (mode === 'after' ? anchor + addition : addition + anchor);
  writeFileSync(p, text.replace(anchor, neu), 'utf8');
  touched.add(rel);
  applied++;
  console.log(`✓ ${rel}`);
}

// ---- server/http/routes.js: auth surface ahead of the GET/HEAD-only check -------------------------------------------
hook('server/http/routes.js',
  `import { clientAddress, isLocalIp } from '../net.js';\n`,
  `import { authHttp } from '../auth/http.js'; // [auth-fork]\n`);
hook('server/http/routes.js',
  `    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }\n`,
  `    if (authHttp.handles(parts.rawPath) && await authHttp.handle(req, res, parts)) return; // [auth-fork]\n`);

// ---- server/http/websocket.js: token gate at upgrade ----------------------------------------------------------------
hook('server/http/websocket.js',
  `import { netOptionsFrom, lobbyOptionsFrom } from './config.js';\n`,
  `import { gateUpgrade } from '../auth/ws.js'; // [auth-fork]\n`);
hook('server/http/websocket.js',
  `    if (refused) { reject(503, 'Service Unavailable'); return; }\n`,
  `    const gate = gateUpgrade(req, parts); // [auth-fork]\n`
  + `    if (!gate.ok) { reject(gate.code === 'no-token' ? 401 : 403, gate.code === 'no-token' ? 'Unauthorized' : 'Forbidden'); return; }\n`
  + `    req.spAccount = gate.principal;\n`);

// ---- server/net.js: carry the principal into the session + welcome --------------------------------------------------
hook('server/net.js',
  `import { ERR, ERR_TEXT, NAME_MAX_LEN, PROTOCOL_VERSION } from '../shared/constants.js';\n`,
  `import { bindHello, welcomeExtra, setRenameBroadcaster } from './auth/session.js'; // [auth-fork]\n`);
// [name-sync] a profile rename re-runs the hello resync path so the room broadcasts the new seat name.
hook('server/net.js',
  `    this.handler = handler;\n    this.log = log;\n    this.now = now;\n`,
  `    this.handler = handler;\n    this.log = log;\n    this.now = now;\n`
  + `    // [auth-fork] name-sync: a profile rename re-runs the hello resync path so the room broadcasts the new seat name.\n`
  + `    setRenameBroadcaster((s) => { try { this.handler.onHello?.(s, { resumed: true, repeat: true }); } catch (e) { this.log.error('[net] rename broadcast', e); } });\n`,
  { mode: 'replace' });
hook('server/net.js',
  `    const conn = new Connection(ws, clientAddress(req, this.opts.trustProxy), this.now(), this.opts);\n`,
  `    conn.spAccount = req.spAccount || null; // [auth-fork]\n`);
hook('server/net.js',
  `    session.name = name;\n    session.lastSeen = now;\n`,
  `    bindHello(conn, session); // [auth-fork]\n`);
hook('server/net.js',
  `    if (session.aiTakeoverFrom) { welcome.takeoverFrom = session.aiTakeoverFrom; session.aiTakeoverFrom = null; }\n`,
  `    const accountExtra = welcomeExtra(session); if (accountExtra) Object.assign(welcome, accountExtra); // [auth-fork]\n`,
  { mode: 'before' });

// ---- public/js/main.js: client boot gate ----------------------------------------------------------------------------
hook('public/js/main.js',
  `import { net, identity, NetError } from './net.js';\n`,
  `import { requireLogin } from './auth/gate.js'; // [auth-fork]\n`);
hook('public/js/main.js',
  `async function boot() {\n`,
  `  if (!(await requireLogin())) return; // [auth-fork]\n`);

// ---- public/js/net.js: carry the account token on the WS URL --------------------------------------------------------
hook('public/js/net.js',
  "  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;\n",
  "  const base = `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`; // [auth-fork]\n"
  + "  const tok = globalThis.localStorage?.getItem?.('sp_token');\n"
  + "  return tok ? `${base}?token=${encodeURIComponent(tok)}` : base;\n",
  { mode: 'replace' });

// ---- server/index.js: wire the admin backend to the live session stack ----------------------------------------------
hook('server/index.js',
  `import { createRequestHandler } from './http/routes.js';\n`,
  `import { wireAdmin } from './admin/index.js'; // [auth-fork]\n`);
hook('server/index.js',
  `  const { registry, lobby, network } = createSessionStack(opts, { data, log, content, plugins: roomSets, hosts, versions, versionHosts, simPool });\n`,
  `  wireAdmin({ network, lobby, registry, log, packs, pluginsDir }); // [auth-fork] packs/pluginsDir for plugin admin\n`);

// ---- server/http/routes.js: admin surface beside auth ---------------------------------------------------------------
hook('server/http/routes.js',
  `import { clientAddress, isLocalIp } from '../net.js';\n`,
  `import { adminHttp } from '../admin/http.js'; // [auth-fork]\n`);
hook('server/http/routes.js',
  `    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }\n`,
  `    if (adminHttp.handles(parts.rawPath) && await adminHttp.handle(req, res, parts)) return; // [auth-fork]\n`);

// ---- server/net.js: intercept chat/friend frames before the game's C2S validation -----------------------------------
hook('server/net.js',
  `import { bindHello, welcomeExtra, setRenameBroadcaster } from './auth/session.js'; // [auth-fork]\n`,
  `import { handleChat } from './chat/ws.js'; // [auth-fork]\n`);
hook('server/net.js',
  `    const rid = msg && typeof msg === 'object' ? msg.rid : undefined;\n`,
  `    if (msg && typeof msg.t === 'string' && (msg.t.startsWith('chat.') || msg.t.startsWith('friend.') || msg.t.startsWith('pm.'))) { handleChat(conn, msg); return; } // [auth-fork]\n`);

// ---- server/index.js: wire the chat backend -------------------------------------------------------------------------
hook('server/index.js',
  `import { wireAdmin } from './admin/index.js'; // [auth-fork]\n`,
  `import { wireChat } from './chat/index.js'; // [auth-fork]\n`);
hook('server/index.js',
  `  wireAdmin({ network, lobby, registry, log, packs, pluginsDir }); // [auth-fork] packs/pluginsDir for plugin admin\n`,
  `  wireChat({ registry, log }); // [auth-fork]\n`);

// ---- public/js/net.js: let chat/friend types bypass C2S validation on send ------------------------------------------
hook('public/js/net.js',
  `    const msg = { ...(fields && typeof fields === 'object' ? fields : {}), t };\n    const bad = validateC2S(msg);\n`,
  `    const msg = { ...(fields && typeof fields === 'object' ? fields : {}), t };\n`
  + `    const bad = (t.startsWith('chat.') || t.startsWith('friend.') || t.startsWith('pm.')) ? null : validateC2S(msg); // [auth-fork]\n`,
  { mode: 'replace' });

// ---- public/js/main.js: mount the chat / friends widget -------------------------------------------------------------
hook('public/js/main.js',
  `import { requireLogin } from './auth/gate.js'; // [auth-fork]\n`,
  `import { installChat } from './chat/panel.js'; // [auth-fork]\n`);
hook('public/js/main.js',
  `  wireNet();\n`,
  `  installChat({ net }); // [auth-fork]\n`);

// ---- public/js/main.js: mount the friends window --------------------------------------------------------------------
hook('public/js/main.js',
  `import { installChat } from './chat/panel.js'; // [auth-fork]\n`,
  `import { installFriends } from './chat/friends.js'; // [auth-fork]\n`);
hook('public/js/main.js',
  `  installChat({ net }); // [auth-fork]\n`,
  `  installFriends(); // [auth-fork]\n`);

// ---- public/js/main.js: mount the player profile / card -------------------------------------------------------------
hook('public/js/main.js',
  `import { installFriends } from './chat/friends.js'; // [auth-fork]\n`,
  `import { installProfile } from './chat/profile.js'; // [auth-fork]\n`);
hook('public/js/main.js',
  `  installFriends(); // [auth-fork]\n`,
  `  installProfile(); // [auth-fork]\n`);
hook('public/js/main.js',
  `import { installProfile } from './chat/profile.js'; // [auth-fork]\n`,
  `import { installConvert } from './auth/convert.js'; // [auth-fork]\n`);
hook('public/js/main.js',
  `  installProfile(); // [auth-fork]\n`,
  `  installConvert(); // [auth-fork]\n`);

// ---- public/js/screens/lobby.js: friends button right of 玩法说明 ----------------------------------------------------
hook('public/js/screens/lobby.js',
  `import { GuideButton, openGuide } from '../ui/guide.js';\n`,
  `import { FriendsButton } from '../chat/friends.js'; // [auth-fork]\n`);
hook('public/js/screens/lobby.js',
  `          <\${GuideButton} class="lobby-guide" variant="secondary" square=\${true} />\n`,
  `          <\${FriendsButton} class="lobby-friends" variant="secondary" square=\${true} />\n`);

// ---- public/js/screens/lobby.js: profile button right of 添加到桌面 + admin entry right of profile ------------------
hook('public/js/screens/lobby.js',
  `import { FriendsButton } from '../chat/friends.js'; // [auth-fork]\n`,
  `import { ProfileButton, AdminButton } from '../chat/profile.js'; // [auth-fork]\n`);
hook('public/js/screens/lobby.js',
  `          <\${PwaInstallButton} class="lobby-pwa" square=\${true} />\n`,
  `          <\${ProfileButton} class="lobby-profile" variant="secondary" square=\${true} />\n`
  + `          <\${AdminButton} class="lobby-admin" />\n`);

// ---- public/js/ui/settings.js: chat on/off switch in the plugin manager (界面插件) -----------------------------------
hook('public/js/ui/settings.js',
  `import { setUiPlugin, uiPluginEntries, uiPlugins } from './uiPlugins.js';\n`,
  `import { ChatPluginSection } from '../chat/settings.js'; // [auth-fork]\n`);
hook('public/js/ui/settings.js',
  `      <\${UiPluginSection} />\n`,
  `      <\${ChatPluginSection} />\n`);

// ---- server/match/Match.js: admin live-match editing on every Match (main process + match-host children) -------------
hook('server/match/Match.js',
  `    Object.defineProperty(Match.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));\n  }\n}\n`,
  `\n// [auth-fork] admin live-match editing: adminEdit on every Match (this process and match-host children). See server/admin/matchEdit.js.\nimport { installMatchAdmin } from '../admin/matchEdit.js';\ninstallMatchAdmin(Match);\n`);

// ---- server/match/host/proxy.js: forward adminEdit to a hosted match over IPC ----------------------------------------
hook('server/match/host/proxy.js',
  `  diag() { return this.disposed ? Promise.resolve(null) : this._request('diag', [], true); }\n`,
  `  /** [auth-fork] admin live-match editing (state / funds / round), forwarded to the worker's Match.adminEdit. */\n  adminEdit(playerId, cmd, args) { return this._request('adminEdit', [playerId, cmd, args || {}]); }\n`);

// ---- public/js/ui/device.js: fork install origin (original game's port → fork's port) ------------------------------
hook('public/js/ui/device.js',
  `export const PWA_ORIGIN = 'https://twcy.antu.fun:34673';\n`,
  `export const PWA_ORIGIN = 'https://twcy.antu.fun:34671';\n`, { mode: 'replace' });

// ---- public/js/ui/gameLogic/settings.js: fork default 作战统计 on (fresh origins get the DPS/HPS panel) --------------
hook('public/js/ui/gameLogic/settings.js',
  `bondTimers: false, combatMetrics: false, prepDeployFold: true,`,
  `bondTimers: false, combatMetrics: true, prepDeployFold: true,`, { mode: 'replace' });

// ---- public/css/screens/title.css: [auth-fork] keep the conn row (incl. fullscreen) on ONE line ---------------------
hook('public/css/screens/title.css',
  `.title-conn { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .1rem; row-gap: .06rem; min-height: .32rem; font-size: calc(.14 * var(--t)); color: var(--text-lo); }`,
  `.title-conn { display: flex; flex-wrap: nowrap; align-items: center; justify-content: center; gap: .06rem; min-height: .32rem; font-size: calc(.12 * var(--t)); color: var(--text-lo); }`, { mode: 'replace' });
hook('public/css/screens/title.css',
  `.title-conn .ping { height: max(.26rem, 1.6em); font-size: calc(.15 * var(--t)); }`,
  `.title-conn .ping { height: max(.26rem, 1.6em); font-size: calc(.13 * var(--t)); }`, { mode: 'replace' });

// ---- public/js/ui/components.js: [chat-focus] keep the lobby chat usable while a modal is open ----------------------
hook('public/js/ui/components.js',
  `    const onFocus = (e) => {\n      if (topmost() && !box.contains(e.target)) focusFirst();\n    };`,
  `    const onFocus = (e) => {\n`
  + `      // [chat-focus] the persistent lobby chat (.sp-chat) stays usable while a modal (e.g. 个人主页) is open: never\n`
  + `      // steal focus back from it, otherwise its input can never be typed into.\n`
  + `      if (topmost() && !box.contains(e.target) && !(e.target.closest && e.target.closest('.sp-chat'))) focusFirst();\n    };`,
  { mode: 'replace' });

// ---- public/js/screens/room.js: [friend-invite] 邀请 opens the online-friends picker --------------------------------
hook('public/js/screens/room.js',
  `import { difficultyInfo, modeInfo, ProtocolSelect } from './lobby.js';\n`,
  `import { openFriendInvite } from '../chat/friends.js'; // [friend-invite]\n`);
hook('public/js/screens/room.js',
  `          ? html\`<button type="button" class="rseat__invite" onClick=\${onInvite} title=\${t('复制同盟密钥以邀请队友')}>\n              <span class="rseat__plus" aria-hidden="true"></span><b>\${t('邀请')}</b><small>\${t('复制同盟密钥以邀请队友')}</small></button>\``,
  `          ? html\`<button type="button" class="rseat__invite" onClick=\${onInvite} title=\${t('邀请在线好友或复制密钥')}>\n              <span class="rseat__plus" aria-hidden="true"></span><b>\${t('邀请')}</b><small>\${t('邀请在线好友或复制密钥')}</small></button>\``, { mode: 'replace' });
hook('public/js/screens/room.js',
  `onInvite=\${() => copy('code')}`,
  `onInvite=\${() => openFriendInvite(room.code)}`, { mode: 'replace' });
hook('public/js/screens/room.js',
  `          <button type="button" class="rs-key__copy" onClick=\${() => copy('code')} title=\${t('复制密钥')}>\${t('复制')}</button>\n`,
  `          <button type="button" class="rs-key__copy" onClick=\${() => openFriendInvite(room.code)} title=\${t('邀请在线好友')}>\${t('邀请好友')}</button>\n`);

// ---- public/i18n/*.json: [friend-invite] the three new room strings --------------------------------------------------
for (const [pack, copyLine, add] of [
  ['en', `  "复制同盟密钥以邀请队友": "Copy the Alliance Key to invite teammates",\n`, `  "邀请在线好友或复制密钥": "Invite online friends or copy the key",\n  "邀请在线好友": "Invite online friends",\n  "邀请好友": "Invite friends",\n`],
  ['ja', `  "复制同盟密钥以邀请队友": "同盟キーをコピーして仲間を招待",\n`, `  "邀请在线好友或复制密钥": "オンラインのフレンドを招待 / キーをコピー",\n  "邀请在线好友": "オンラインのフレンドを招待",\n  "邀请好友": "フレンドを招待",\n`],
  ['ko', `  "复制同盟密钥以邀请队友": "동맹 키를 복사해 동료를 초대",\n`, `  "邀请在线好友或复制密钥": "온라인 친구 초대 또는 키 복사",\n  "邀请在线好友": "온라인 친구 초대",\n  "邀请好友": "친구 초대",\n`],
  ['zh-TW', `  "复制同盟密钥以邀请队友": "複製同盟密鑰以邀請隊友",\n`, `  "邀请在线好友或复制密钥": "邀請在線好友或複製密鑰",\n  "邀请在线好友": "邀請在線好友",\n  "邀请好友": "邀請好友",\n`],
]) hook(`public/i18n/${pack}.json`, copyLine, add);

console.log(`\n钩子: 新打 ${applied}, 已存在跳过 ${skipped}, 失败 ${failed}`);
if (failed) { console.error('有锚点失败：官方重构了钩子宿主，请人工适配后重跑。'); process.exit(1); }

// ---- syntax smoke on every touched official file + the new modules --------------------------------------------------
const check = [...touched,
  'server/auth/store.js', 'server/auth/auth.js', 'server/auth/index.js', 'server/auth/http.js',
  'server/auth/ws.js', 'server/auth/session.js', 'public/js/auth/gate.js', 'public/login/login.js',
  'server/admin/index.js', 'server/admin/http.js',
  'server/chat/store.js', 'server/chat/chat.js', 'server/chat/index.js', 'server/chat/ws.js', 'public/js/chat/panel.js',
  'public/js/chat/friends.js', 'public/js/chat/settings.js', 'public/js/chat/pref.js', 'public/js/auth/logout.js', 'public/js/chat/profile.js',
  'server/auth/mailer.js', 'public/js/auth/fingerprint.js', 'public/js/auth/convert.js', 'public/login/login.js',
  'server/admin/matchEdit.js', 'server/match/Match.js', 'server/match/host/proxy.js', 'public/js/screens/room.js',
  'server/net.js', 'public/js/ui/components.js',
  'public/js/chat/rich.js', 'public/js/chat/announce.js', 'public/admin/admin.js',
  '_test-creds.mjs', 'test-admin.mjs', 'test-admin-api.mjs', 'test-admin-e2e.mjs', 'test-admin-match.mjs',
  'shot-admin.mjs', 'test-auth.mjs', 'test-chat.mjs', 'test-token-auth.mjs', 'test-account-plus.mjs'];
let bad = 0;
for (const rel of check) {
  const r = spawnSync(process.execPath, ['--check', join(ROOT, rel)], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`✗ 语法 ${rel}\n${r.stderr}`); }
}
console.log(bad ? `${bad} 个文件语法失败` : `语法冒烟通过（${check.length} 个文件）`);
process.exit(bad ? 1 : 0);
