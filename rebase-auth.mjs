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
  `import { bindHello, welcomeExtra } from './auth/session.js'; // [auth-fork]\n`);
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
  `  wireAdmin({ network, lobby, registry, log }); // [auth-fork]\n`);

// ---- server/http/routes.js: admin surface beside auth ---------------------------------------------------------------
hook('server/http/routes.js',
  `import { clientAddress, isLocalIp } from '../net.js';\n`,
  `import { adminHttp } from '../admin/http.js'; // [auth-fork]\n`);
hook('server/http/routes.js',
  `    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }\n`,
  `    if (adminHttp.handles(parts.rawPath) && await adminHttp.handle(req, res, parts)) return; // [auth-fork]\n`);

// ---- server/net.js: intercept chat/friend frames before the game's C2S validation -----------------------------------
hook('server/net.js',
  `import { bindHello, welcomeExtra } from './auth/session.js'; // [auth-fork]\n`,
  `import { handleChat } from './chat/ws.js'; // [auth-fork]\n`);
hook('server/net.js',
  `    const rid = msg && typeof msg === 'object' ? msg.rid : undefined;\n`,
  `    if (msg && typeof msg.t === 'string' && (msg.t.startsWith('chat.') || msg.t.startsWith('friend.') || msg.t.startsWith('pm.'))) { handleChat(conn, msg); return; } // [auth-fork]\n`);

// ---- server/index.js: wire the chat backend -------------------------------------------------------------------------
hook('server/index.js',
  `import { wireAdmin } from './admin/index.js'; // [auth-fork]\n`,
  `import { wireChat } from './chat/index.js'; // [auth-fork]\n`);
hook('server/index.js',
  `  wireAdmin({ network, lobby, registry, log }); // [auth-fork]\n`,
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

// ---- public/js/screens/lobby.js: friends button right of 玩法说明 ----------------------------------------------------
hook('public/js/screens/lobby.js',
  `import { GuideButton, openGuide } from '../ui/guide.js';\n`,
  `import { FriendsButton } from '../chat/friends.js'; // [auth-fork]\n`);
hook('public/js/screens/lobby.js',
  `          <\${GuideButton} class="lobby-guide" variant="secondary" square=\${true} />\n`,
  `          <\${FriendsButton} class="lobby-friends" variant="secondary" square=\${true} />\n`);

// ---- public/js/ui/settings.js: chat on/off switch in the plugin manager (界面插件) -----------------------------------
hook('public/js/ui/settings.js',
  `import { setUiPlugin, uiPluginEntries, uiPlugins } from './uiPlugins.js';\n`,
  `import { ChatPluginSection } from '../chat/settings.js'; // [auth-fork]\n`);
hook('public/js/ui/settings.js',
  `      <\${UiPluginSection} />\n`,
  `      <\${ChatPluginSection} />\n`);

console.log(`\n钩子: 新打 ${applied}, 已存在跳过 ${skipped}, 失败 ${failed}`);
if (failed) { console.error('有锚点失败：官方重构了钩子宿主，请人工适配后重跑。'); process.exit(1); }

// ---- syntax smoke on every touched official file + the new modules --------------------------------------------------
const check = [...touched,
  'server/auth/store.js', 'server/auth/auth.js', 'server/auth/index.js', 'server/auth/http.js',
  'server/auth/ws.js', 'server/auth/session.js', 'public/js/auth/gate.js', 'public/login/login.js',
  'server/admin/index.js', 'server/admin/http.js',
  'server/chat/store.js', 'server/chat/chat.js', 'server/chat/index.js', 'server/chat/ws.js', 'public/js/chat/panel.js',
  'public/js/chat/friends.js', 'public/js/chat/settings.js', 'public/js/chat/pref.js', 'public/js/auth/logout.js'];
let bad = 0;
for (const rel of check) {
  const r = spawnSync(process.execPath, ['--check', join(ROOT, rel)], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(`✗ 语法 ${rel}\n${r.stderr}`); }
}
console.log(bad ? `${bad} 个文件语法失败` : `语法冒烟通过（${check.length} 个文件）`);
process.exit(bad ? 1 : 0);
