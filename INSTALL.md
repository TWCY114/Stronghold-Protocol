# 安装与部署 · 卫戍协议 fork（登录 / 管理 / 社交）

本 fork 在官方 Stronghold-Protocol 0.4.0 之上**只新增文件 + 少量 `[auth-fork]` 钩子**。发布包已含打好钩子的官方文件，
解压后装依赖、跑一次 `rebase-auth.mjs`、建管理员、起服务即可。三种安装方式任选其一。

> **环境要求**：Node.js **≥ 22.5**（账号库用内置 `node:sqlite`，推荐 22 / 24 LTS）；依赖 `ws`。
> **版权**：非官方同人、仅限非商业，详见 [NOTICE.md](NOTICE.md)。运行所需的 `data/*.json` 为官方数据，版权归原作者。

---

## 方式一 · 通用 / Linux（命令行）

```bash
tar -xzf stronghold-fork-0.9.tar.gz
cd Stronghold-Protocol
pnpm install --prod            # 或 npm i --omit=dev（至少需要 ws）
node tools/vendor.mjs          # 浏览器库（public/vendor 已随包，通常可跳过）
node rebase-auth.mjs           # 校验/重放钩子：应「全跳过 + 语法通过」
node seed-admin.mjs <管理员用户名> <强密码>
PORT=3001 node server/index.js # 建议 pm2 守护：pm2 start server/index.js --name sp-fork
```

再用 nginx 把外部端口（如 34671 ssl）反代到 `127.0.0.1:3001`，**WS 需透传 `Upgrade`/`Connection` 头**。
验证：浏览器开 `https://域名:外部端口/` → 跳 `/login` → 注册（token-only）/游客 → 进游戏；`/healthz` 看在线数。

---

## 方式二 · Windows

先装 Node.js（≥ 22）：`winget install OpenJS.NodeJS.LTS`，或官网 <https://nodejs.org/zh-cn/download>。
解压发布包到任意目录（路径建议不含中文/空格），进入 `Stronghold-Protocol` 文件夹。

### A. 双击启动（前台，最简单）
1. 先建管理员（命令行，一次即可）：
   ```cmd
   node seed-admin.mjs admin 你的强密码
   ```
2. 双击 **`scripts\start-windows.bat`**。首次运行自动 `npm ci` 装依赖并启动，打印局域网地址并打开浏览器。
   - 指定端口：`scripts\start-windows.bat --port 3001`
   - 跳过本地素材提取：加 `--no-local`（发布包不含游戏美术，游戏可跑但画面精简）。
3. 浏览器开 `http://localhost:3001/`（或打印的局域网地址）→ `/login`。

### B. 开机自启后台服务（推荐长期运行）
以管理员身份打开 PowerShell，进入项目目录：
```powershell
node seed-admin.mjs admin 你的强密码
powershell -ExecutionPolicy Bypass -File scripts\install-service-windows.ps1 -Port 3001
```
它注册计划任务「StrongholdProtocol」（开机以 SYSTEM 运行、进程退出 5 秒自动重启、日志 `logs\server.log`）并添加入站防火墙规则。
管理命令：
```powershell
... install-service-windows.ps1 -Status     # 查看状态
... install-service-windows.ps1 -Restart    # 更新代码后重启
... install-service-windows.ps1 -Stop       # 停止
... install-service-windows.ps1 -Uninstall  # 卸载任务与防火墙规则
```
> 公网访问需在路由器/云安全组放行端口，并自行配置反向代理 + 证书（Windows 上可用 nginx 或 Caddy）。

---

## 方式三 · 宝塔面板（BT Panel）

适合已有宝塔的 Linux 服务器。用宝塔的 **Node 项目管理器**托管，反代 + SSL 由宝塔接管。

### 1. 装 Node
软件商店 → 安装 **「Node.js 版本管理器」** → 安装 **v22 或 v24**（设为命令行默认版本）。

### 2. 上传解压
把 `stronghold-fork-0.9.tar.gz` 上传到 `/www/wwwroot/`，宝塔终端解压：
```bash
cd /www/wwwroot
tar -xzf stronghold-fork-0.9.tar.gz
mv Stronghold-Protocol Stronghold-Fork    # 与原项目隔离（可选）
cd Stronghold-Fork
```

### 3. 装依赖 + 钩子 + 管理员（宝塔终端）
```bash
npm install --omit=dev          # 或 pnpm install --prod
node tools/vendor.mjs
node rebase-auth.mjs            # 应全跳过 + 语法通过
node seed-admin.mjs admin 你的强密码
```

### 4. 添加 Node 项目
网站 → **Node 项目** → 添加项目：
- **项目目录**：`/www/wwwroot/Stronghold-Fork`
- **启动文件**：`server/index.js`
- **端口**：`3001`
- **Node 版本**：v22 / v24
- **环境变量**：`PORT=3001`（可选 `SP_STUDIO=off`）
- **安装依赖**：若第 3 步已装可跳过；否则 `npm install --omit=dev`
- 启动方式选 **PM2**（守护、开机自启），提交并启动。

### 5. 域名 + 反向代理 + SSL
网站 → 添加站点（填域名）→ **反向代理** → 目标 URL `http://127.0.0.1:3001`。
**WebSocket 关键**：编辑该反代的配置文件，在 `location /` 里加：
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
```
站点 → **SSL** → Let's Encrypt 申请证书并开启强制 HTTPS。

### 6. 放行端口
宝塔 **安全** + 云服务器 **安全组** 放行外部端口（如 34671 / 443）。内部 3001 不必对外暴露。

### 7. 验证
浏览器开 `https://你的域名/`（或 `:外部端口`）→ 跳 `/login` → 注册/游客 → 进游戏。
`curl https://你的域名/healthz` 看 sockets。后台 `/admin`（用第 3 步的管理员登录）。

---

## 更新与回滚
- **官方更新后**：新增目录不在 MANIFEST 里会保留，重跑 `node rebase-auth.mjs` 幂等重放钩子即可。
- **数据库** `server/auth/auth.db`（WAL，运行时生成）：不要提交/覆盖；备份它即备份账号。
- **回滚**：fork 与原项目目录/端口隔离，停 fork 进程 + 摘掉其反代即可，原项目不受影响。