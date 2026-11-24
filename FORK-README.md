# 卫戍协议 fork · 登录 / 管理 / 社交

本目录是卫戍协议：盟约（Stronghold-Protocol 0.4.0）的服务端 fork，在官方引擎之上分期加入：

- **P1（已完成）** 账号注册 / 登录 + 游客临时通行证 + 登录闸门 + 独立登录页。**「仅使用 token 登录」为注册/登录默认**：免密码，注册后直接把永久 token 交给玩家保管，凭它登录。**登出**（设置 → 账号 按钮，撤销 token + 断 WS + 回登录页）；**同账号单点登录**（同账号新会话顶掉旧会话，close 4001，游客豁免）。
- **P2（已完成）** 管理员后台：在线人数实时折线图（5s 采样 / 最近 1 小时）、账号管理（建/停/角色/改密/删）、结束对局、踢人。
- **P3（已完成）** 大厅公共聊天（限频 + 可配置敏感词过滤，游客可发）+ 好友系统（申请 / 同意 / 删除 / 在线状态）+ 私聊（持久化、离线存库上线送达）。**聊天 UI 为三角洲行动式**：左下**全透明**被动日志，逐行「`[区域] 玩家名: 消息`」浮字（无边框不挡操作），新消息淡入一次（增量追加，不整列重建→不闪烁）；Enter 弹出输入条+频道页签（世界 / 房间）、**Esc 或点击外部收起**、手机单点打开；可拖拽/缩放（左上锚定，缩放跟手，**缩放角标仅展开时显示**）、记忆位置；进房自动切**房间频道**（仅房员可见）。**首页（标题屏）隐藏聊天**；开关挂在 设置 → 界面插件。**好友独立成窗**：大厅顶栏「玩法说明」右边的好友按钮（尺寸/颜色同设置图标）打开简约弹窗（加 ID / 申请 / 好友列表 / 私聊）。
- **主题**：fork 新增 UI 取**纯色 mint 青绿 `#4ed8af`（取消渐变）**；聊天颜色**随赛季联动**——读取「同盟模拟」按钮所在赛季根的 `--mint-*`，右上角切换版本时聊天随之变色（默认赛季 mint，规程赛季红）。登录页**仿 QQ**（窄竖卡 / 圆形头像 / 下划线模式切换 / 纯色按钮 / 底部链接）。

设计原则：**主体写新增文件，官方文件只打最小钩子**。官方更新 zip 按 `MANIFEST.json` 覆盖文件——新增目录不在清单里，
更新后原样保留；只有少数几行钩子骑在官方文件里，用 `rebase-auth.mjs` 一键幂等重放。

## 新增文件（更新不覆盖）

```
server/auth/
  store.js      node:sqlite 账号 / token 库（零原生依赖，Node ≥ 22.5；密码 scrypt，token 存 SHA-256）
  auth.js       注册 / 登录 / 游客 / 校验 / 限频
  index.js      懒加载单例（SP_AUTH=off 可关闸门，默认开）
  http.js       /login 页 + /api/auth/{register,login,guest,me,logout}
  ws.js         /ws 升级闸门（?token=…）
  session.js    hello 绑账号 + welcome 带 account/role
public/login/   独立登录页（仿 QQ：index.html + login.js + login.css，外部脚本符合 CSP）
public/js/auth/gate.js   客户端 boot 闸门 + token 存取
server/admin/
  index.js      wireAdmin 单例 + 在线统计采样器（5s / 720 点环形缓冲）
  http.js       /admin 页 + /api/admin/*（role=admin 鉴权）
public/admin/   管理后台页（index.html + admin.js + admin.css，SVG 折线图无外部库）
server/chat/
  store.js      好友 / 申请 / 私聊 / 大厅历史 / 房间历史表（与账号同库）
  chat.js       限频 + 敏感词过滤 + 世界/房间广播 + 好友 + 私聊离线送达
  index.js      wireChat 单例
  ws.js         chat/friend/pm WS 消息分发（chat.send/history 带 channel）
  filter.json   可配置敏感词表（默认空，自行填）
public/js/chat/
  panel.js      三角洲行动式聊天（全透明被动日志 [区域]名:消息 / 增量防闪 / Enter 弹窗 / 世界·房间频道 / 左上锚定拖拽缩放 / 主题随赛季 / 首页隐藏）
  friends.js    好友独立窗（FriendsButton 顶栏触发 + FriendsModal 简约弹窗 + installFriends 接 net）
  settings.js   ChatPluginSection：设置「界面插件」里的聊天开关
  pref.js       聊天开关偏好（sp.pref.chat-enabled，默认开）
rebase-auth.mjs 更新后重放钩子
seed-admin.mjs  首个管理员
test-auth.mjs / test-e2e.mjs / test-admin.mjs / test-admin-api.mjs / test-admin-e2e.mjs
test-token-auth.mjs / test-chat.mjs / test-chat-e2e.mjs / test-room-chat.mjs
```

数据库落在 `server/auth/auth.db`（WAL），运行时生成，**不要上传 / 不要提交**。

## 官方文件里的钩子（共 8 个文件，均带 `[auth-fork]` 标记）

| 文件 | 钩子 |
|---|---|
| `server/http/routes.js` | import authHttp/adminHttp；在 GET/HEAD 检查前挂 auth + admin 路由 |
| `server/http/websocket.js` | import gateUpgrade；升级时校验 token，挂 `req.spAccount` |
| `server/net.js` | import bindHello/welcomeExtra/handleChat；conn 携带 principal；hello 绑账号；welcome 带 account；onFrame 拦截 chat/friend/pm |
| `server/index.js` | import wireAdmin/wireChat；sessionStack 创建后接线 admin + chat |
| `public/js/main.js` | import requireLogin/installChat/installFriends；boot 闸门 + 安装聊天面板 + 好友窗 |
| `public/js/net.js` | defaultWsUrl 追加 `?token=`；send 对 chat/friend/pm 绕过 C2S 校验 |
| `public/js/screens/lobby.js` | import FriendsButton；顶栏「玩法说明」右边渲染好友按钮 |
| `public/js/ui/settings.js` | import ChatPluginSection；「界面插件」区后渲染聊天开关 |

## 管理后台 API（P2，均需 role=admin 的 Bearer token）

- `GET /api/admin/stats` → `{current:{online,rooms,matches,humans,bots,spectators}, history:[{t,online,…}], sampleMs}`
- `GET /api/admin/players` / `rooms` / `accounts` → 列表
- `POST /api/admin/accounts` `{username,password,role}` → 建号
- `POST /api/admin/account` `{id,action:disable|enable|role|reset-password|delete,…}`
- `POST /api/admin/kick` `{playerId}` → 踢出房间（`lobby.removeMember` + `room.closed`）
- `POST /api/admin/end-room` `{code}` → 结束整局（`lobby.disposeRoom(room,'admin')`，清空中继、通知全员）
- 页面 `/admin`；非管理员 / 游客 / 无 token → 403。

## 聊天 / 好友 WS 协议（P3，fork 专属类型，绕过游戏 C2S 校验）

客户端 `net.send(t,…)`，服务端 `net.js onFrame` 在 C2S 校验前拦截 `chat.* / friend.* / pm.*` → `chat/ws.js`：

- `chat.send {body, channel:'world'|'room'}` → 广播 `chat.lobby {channel,roomCode?,name,body,accountId,guest,at}`；`world` 全员、`room` 仅同 `session.roomCode` 房员（服务端按会话房号判定，客户端不可伪造）。`chat.history {channel,limit}` → `chat.history {channel,messages}`（房间历史按房号取）。
- `friend.request {toId}` / `friend.respond {fromId,accept}` / `friend.remove {otherId}` → `friend.result`；推送 `friend.request` / `friend.accepted`
- `friend.list` → `friend.list {friends:[{accountId,name,online}], requests:[…]}`
- `pm.send {toId,body}` → `pm.message`（对方在线即送、离线存库；发送方回显 `self:true`）；`pm.history {otherId}` → `pm.history {messages}`
- 错误统一 `chat.error {error,scope}`。大厅限频 3 条/5 秒、私聊 10 条/5 秒；敏感词见 `server/chat/filter.json`。
- 好友 / 私聊需注册账号；游客可发大厅聊天。离线私聊在对方下次 hello 后送达（`auth/session.js bindHello`）。

## 更新后恢复（rebase）

```bash
node rebase-auth.mjs
```

幂等：已存在的钩子跳过；官方重构导致锚点失配时**停下并报错**，人工适配那一处锚点再重跑。这是更新唯一可能需要的手工。

## 本地运行 / 测试

```bash
PORT=3001 node server/index.js          # SP_AUTH=off 可临时关闸门
node test-auth.mjs                      # 后端 15 项（需服务器在 3001）
node test-e2e.mjs                       # 浏览器 8 项（需本机 Chrome）
node seed-admin.mjs <用户名> <密码>      # 建 / 提升管理员
node test-admin.mjs                     # 验证 admin 角色
```

## 部署（并行方案）

- 原项目保留：外部 34673 → 内部 3000。
- 本 fork：外部 **34671** → 内部 **3001**（nginx 反代 + TLS，证书沿用 twcy.antu.fun）。
- 上传新增目录 + 打过钩子的官方文件 → 服务器装依赖（`ws` 等）→ `node rebase-auth.mjs` 校验 → `node seed-admin.mjs …` → 起 Node（PORT=3001）。
- 服务器命令执行（起 Node / 改 nginx / 备份）需 SSH 或面板 API，部署时确认。

## 安全说明

- 密码 scrypt 加盐；token 32 随机字节、库存哈希。**token-only 账号无密码（pass_hash 空），token 永久有效**（约 100 年到期，等价永久）；密码账号 token 30 天、游客 2 小时。
- 注册 / 登录 API 带 `mode:'token'|'password'`（默认 token）：`register {username,mode}` token 模式免密码并回 token；`login {mode:'token',token}` 或 `{mode:'password',username,password}`。token-only 账号不能用密码登录。
- 登录 / 注册限频 10 次 / 5 分钟 / IP+用户名；游客 30 次 / 5 分钟 / IP。
- 闸门双层：客户端 boot 跳转 + 服务端 /ws 升级拒绝（无 token 401 / 无效 403）。
- 管理员 = 普通账号 role='admin'（P2 后台据此鉴权）。
