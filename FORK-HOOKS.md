# 本 fork 对原项目的改动量 · 与上游更新后的工程量

> 原则：**主体写新增文件，官方文件只打最小钩子**，配 `rebase-auth.mjs` 幂等重放。
> 原项目版权归原作者（sganggs/Stronghold-Protocol，GPL-3.0）；本 fork 同样 GPL-3.0。

## 一、改了多少？

- **新增文件为主（约 50 个，不碰原代码）**：账号 / 管理 / 聊天三大服务端模块、登录页、管理后台前端、auth/chat 客户端模块、配套测试与 rebase/seed 脚本。全部独立目录。
- **官方文件仅 38 处最小钩子**，分布在 12 个文件，每处 1–6 行（导入+挂载），合计约 120 行，只负责"接线"，功能逻辑全在新模块。
- 另有 2 处一行级默认值调整（含在 38 内）：`device.js` PWA 安装端口、`gameLogic/settings.js` 作战统计默认开。
- 其余官方文件与原版逐字节一致（sim / 渲染 / 数据等不侵入）。

### 38 处钩子分布

| 官方文件 | 钩子数 | 作用 |
|---|---|---|
| `public/js/main.js` | 10 | 客户端接线：auth 闸门、聊天/好友/个人主页挂载 |
| `server/net.js` | 6 | 会话身份、hello 绑定、聊天分发 |
| `server/http/routes.js` | 4 | 挂 auth / admin / chat REST 路由 |
| `server/index.js` | 4 | 启动时 wire 账号/管理/聊天模块 |
| `public/js/screens/lobby.js` | 4 | 大厅顶栏好友/个人主页/管理按钮 |
| `server/http/websocket.js` | 2 | WS 升级 auth 闸门 |
| `public/js/net.js` | 2 | 客户端 token/重连 |
| `public/js/ui/settings.js` | 2 | 设置里聊天/社交开关 |
| `server/match/Match.js` | 1 | 装 `adminEdit`（改金钱/跳回合） |
| `server/match/host/proxy.js` | 1 | 子进程代理转发 `adminEdit` |
| `public/js/ui/device.js` | 1 | PWA 安装端口改 fork |
| `public/js/ui/gameLogic/settings.js` | 1 | 作战统计默认开 |

## 二、上游版本更新后的工程量

重放靠 `node rebase-auth.mjs`（幂等、按锚点文本匹配）：

1. **新增模块**（约 50 文件）与官方代码解耦 → **0 工作量**。
2. **38 处钩子**：锚点行还在 → 自动重打/跳过（0 工作量）；锚点被上游改动 → 脚本报「失败」并精确列出，人工重新对准（每处仍 1–6 行）。
3. 上游更新通常改玩法 / sim / 数据，**很少动到导入行与挂载点**，故绝大多数情况 38 处全部自动通过——**常规更新 ≈ 跑一条命令**。
4. **最坏情况**（上游重构某接线文件）：该文件钩子失败、人工重接；上限 38 处小改、集中 12 个文件，不会漏。

> 另：一批「还原成自托管原版基线」的全文件（title.css / i18n / battle / game / title / pixi）不是钩子；若上游更新它们而你想吃上游新内容，需重新拷贝+合并原版定制，属一次性决策，不在常规重放内。

## 三、为什么不能纯插件（不改服务端）？

基座受信插件面（`server/plugins/trustedEntry.js`）只暴露：`http.route`（限 `/x/<id>/`）、`lobby.on`（5 个只读事件）、`health.extend`。**没有** WS 握手闸门、WS 消息分发、Match 方法/代理转发、会话身份——这些是账号/管理/社交必需的集成点，沙箱刻意不开放。故最小钩子是唯一可行接入方式（内容类 mod 才可纯插件）。
