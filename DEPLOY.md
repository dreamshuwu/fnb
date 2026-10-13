# F&B POS 部署指南（共享 cPanel · 前后端一体化）

目标：在**一个 cPanel 账号、一个域名**里把整套 POS 跑起来。
后端(Node) 与前端(React 静态文件)由**同一个 Node 进程**托管：Node 既提供 `/api`
接口和 Socket.IO，又直接返回前端页面。因此**不需要**单独静态站、不需要子域、
不需要 `.htaccess`、也不需要把仓库根目录传上去。

后端数据层是 **MySQL(mysql2)**，共用你服务器上已有的 MySQL 实例。

---

## 前提：数据库
1. cPanel → **MySQL® Databases**：
   - 确认库 `beyourdi_fnb` 已存在（没有就新建）。
   - 把用户 `beyourdi_cms` 通过 “Add User To Database” 授权给 `beyourdi_fnb`，给 **ALL PRIVILEGES**。
2. 连接信息：主机 `127.0.0.1`（或 `localhost`），端口 `3306`。
3. ⚠️ 生产请给 `beyourdi_fnb` 建一个**专用强密码**并替换掉此前暴露的密码。

---

## 0. 先拿到 Application root 的绝对路径

Document Root 那一栏要的是**绝对路径**。三种拿法，任选一种：

**方法 1（最准，推荐）** —— cPanel → **Setup Node.js App** → 点开该应用 →
页面上 **Application root** 那一栏显示的就是绝对路径，例如 `/home/beyourdi/fnb-pos/server`。
**直接复制这一串**，粘到 Document Root 里。

**方法 2（Terminal）** —— cPanel → **Terminal**（或 SSH），粘这一行：

```bash
find ~ -maxdepth 5 -type d -path '*/fnb-pos/server' 2>/dev/null | head -1 | sed 's/^/Document Root 填这个: /'
```

输出形如 `Document Root 填这个: /home/beyourdi/fnb-pos/server` —— 冒号后面整串复制走。

**方法 3（File Manager）** —— cPanel → **File Manager** → 进入 `fnb-pos/server`，
地址栏 / 顶部路径面包屑显示的就是绝对路径。

> **填错的样子**：填成 `server`、`fnb-pos/server`、`public_html/fnb-pos/server` 都算错。
> cPanel 会把相对路径拼到 `public_html` 下面，得到 `/home/<用户>/public_html/fnb-pos/server` 这种
> 根本不存在的位置，于是又回到「Index of /」。
>
> 如果 cPanel 拒绝绝对路径（少数老版本只收相对 `public_html` 的路径），用软链绕过：
> ```bash
> ln -s ~/fnb-pos/server ~/public_html/fnb-app
> ```
> 然后把 Document Root 填 `public_html/fnb-app`。

---

## 0.5 改完之后怎么自证（一条命令）

仓库自带自检脚本，**只读探测、不写任何东西**：

```bash
npm run deploy:check
# 或指定域名 / 输出 JSON
node scripts/deploy-check.mjs https://fnb.beyourdiary.com
node scripts/deploy-check.mjs https://fnb.beyourdiary.com --json
```

它逐项判定，全绿则退出码 0（可以挂 CI）：

| 检查项 | 通过条件 | 挂了说明什么 |
| --- | --- | --- |
| 首页返回前端 SPA | `/` 返回含 `id="root"` 的页面 | 返回「Index of /」→ Document Root 指到了仓库根 |
| API 健康检查 | `/api/health` → `{"ok":true}` | 404 = 请求根本没到 Node；502/503 = 代理到了但 Node 没起来 |
| 仓库根未被公开 | `/DEPLOY.md`、`/package.json`、`/server/src/index.js` 取不到源码 | Document Root 指错，源码在公网上 |
| 前端没有被埋在子目录 | `/server/public/index.html` 不是真 index.html | 前端在 `/server/public/` 下，子目录里永远加载不出来（它引用根绝对路径 `/assets/*.js`） |
| 前端 JS/CSS 可加载 | index.html 引用的 `/assets/*` 全部 200 | doc root 不对，或前端产物没传上去 |
| 线上前端与本地构建一致 | asset hash 与本地 `server/public` 相同 | 线上跑的是旧构建 → 服务器要 `git pull` |
| Socket.IO 端点可握手 | `0{...}` | 同 `/api/health`，请求没到 Node |

**唯一的判定标准**：`https://fnb.beyourdiary.com/api/health` 返回 `{"ok":true}`。
这一条过了，其余基本都是通的。

---

## 0.6 创建 Node.js App：逐栏照抄

**入口**：cPanel → **SOFTWARE（软件）区** → **Setup Node.js App** → **CREATE APPLICATION**。
（不在「Files」也不在「Advanced」；如果 SOFTWARE 区里没有这一项，说明主机没给你的套餐启用
Node.js Selector，需要开工单让主机打开。）

填表对照：

| 表单栏 | 填什么 | 为什么 |
| --- | --- | --- |
| **Node.js version** | 下拉里**最新的 LTS**（20.x / 22.x）。只有 `16.20.2` 也能跑 —— 本项目没用 Node 17+ 的新语法，依赖（express 4 / socket.io 4 / mysql2 3 / helmet 7 / zod 3）都支持 16 | 16 已 EOL，能用但不推荐 |
| **Application mode** | **Production** | 它只负责设 `NODE_ENV`；本项目代码不读 `NODE_ENV`，但 Production 会跳过 devDependencies，更干净 |
| **Application root** | `server` 目录，**相对家目录**。若仓库在 `public_html/fnb` 下 → `public_html/fnb/server` | cPanel 官方文档原话：*the entry will be appended to `/home/username`*。所以**不要**填 `/home/...` 全路径，也不要以 `/` 开头。本项目的实际值：`public_html/fnb/server`（绝对路径 `/home/beyourdi/public_html/fnb/server`） |
| **Application URL** | 下拉框**必须换成 `fnb.beyourdiary.com`**，右侧路径框**留空** | 下拉默认选中的是 `beyourdiary.com` —— 不换就等于把主域名劫持到这个应用上 |
| **Application startup file** | `src/index.js` | Passenger 的入口，相对 Application root |
| **Environment variables** | 见下表，点 **ADD VARIABLE** 逐个加 | |

环境变量（**只加这些**）：

| 变量 | 值 |
| --- | --- |
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `3306` |
| `DB_USER` | `beyourdi_cms` |
| `DB_PASSWORD` | 该 MySQL 用户的真实密码 |
| `DB_NAME` | `beyourdi_fnb` |
| `JWT_SECRET` | 一长串随机字符。**仓库里从来没有过真值** —— `.env` / `.env.example` 一直是 `change-me-in-prod` 占位符，必须自己生成：在 cPanel Terminal 跑 `openssl rand -base64 48`，把输出整串粘进去 |
| `CLIENT_ORIGIN` | `https://fnb.beyourdiary.com` |

**两个千万别填的变量**：

- **`PORT`** —— Passenger 通过 `process.env.PORT` 把端口交给你（代码里 `process.env.PORT || 4000` 已经正确处理）。自己填了会和 Passenger 抢端口。
- **`WEB_DIST_PATH`** —— 它是**相对进程工作目录**的，而 cPanel/Passenger 的 CWD 就是 Application root（`server/`）。填 `server/public` 会让 Node 去找 `server/server/public`，**不存在 → 前端整块不挂载**，页面白屏但 API 正常，极难排查。一体化部署不设它就对了（默认 `path.join(__dirname,'..','public')`）。

**创建之后**（这三步一个都不能少）：

1. 回到 **WEB APPLICATIONS** 列表 → 找到刚建的应用 → 点铅笔图标 → **Run NPM Install**，等它成功。
2. 同一页点 **Restart**。
3. cPanel → **LiteSpeed Web Cache Manager** → **Flush All**。

然后重跑 `npm run deploy:check`。

### ⚠️ 如果 Run NPM Install 报「An error occured during installation of modules」

这是**本项目历史上真实踩过的坑**，根因是 **npm workspaces**：

仓库根 `package.json` 曾经声明了 `workspaces: ["server","apps/web"]`。在 `server/` 里跑
`npm install` 时，npm 会向上识别出「workspace 根在 `../`」，于是把 `node_modules` 和
`package-lock.json` 装到**仓库根** `~/public_html/fnb/` —— 那在 cPanel 的 **Application root 之外**。
Node.js Selector 只允许在应用目录内安装，于是直接失败，而且**两边都不留 `node_modules`**，
表现就是应用一直起不来（`stderr.log` 里是 `Cannot find package 'dotenv'`）。

**已修复**：根 `package.json` 去掉了 `workspaces`，三个包各自独立安装；根脚本改用
`npm --prefix <dir>` 转发。所以现在 `server/` 里**裸跑 `npm install` 就会装进 `server/node_modules`**，
cPanel 的按钮也能正常工作。

**服务器上要做的**：先 `git pull` 拿到这个修复，再 Run NPM Install。

```bash
git -C ~/public_html/fnb pull
cd ~/public_html/fnb/server && npm install --no-audit --no-fund
```

> 万一还没 pull、想临时绕过：`npm install --workspaces=false` 也能把包装进 `server/node_modules`
> （已验证有效）。注意**不能用环境变量** `NPM_CONFIG_WORKSPACES=false` —— npm 会同时注入
> `--workspace`，两者冲突直接报错；`.npmrc` 里写 `workspaces=false` 也会被 npm 忽略
> （`npm warn config ignoring workspace config`）。

> **Document Root 与 Application root 的关系**：cPanel 会把 Passenger 代理指令自动写进
> **Application root 的 `.htaccess`**。只有 Document Root 也指向同一个目录，这份 `.htaccess`
> 才会被读到，代理才生效 —— 这就是「两个 root 必须一致」的根本原因。
> 注意：**不要手动在 `server/` 里放 `.htaccess`**，会和 cPanel 生成的那份冲突。
> 仓库根那份 `.htaccess` 是给「Document Root 还指在仓库根」的临时状态用的，改对之后它就失效了。

---

## 方案 A（推荐）：一体化部署，一个 Node App 托管一切
1. 把仓库代码放到 cPanel（git clone 或上传）。重点是里面的 `server/` 目录。
   - `server/public/` 已经包含构建好的前端（由 CI/本地 `npm run build` 生成并随仓库发布），
     所以你**不用自己构建前端、也不用传 dist 到 public_html**。
2. cPanel → **Setup Node.js App → Create Application**：
   - Node.js version：选 **20.x**
   - **Application root：指向 `server/` 目录**（例如 `fnb/server`，即含 `package.json`/`src` 的那个目录）
   - **Application URL：你的域名根**，例如 `fnb.beyourdiary.com`（不要选子域、也不要在路径里加 `/api`）
   - **Startup file：`src/index.js`**
3. **⚠️ 把域名的 Document Root 也指到 `server/`**（这是最容易踩的坑 —— 见下方"看到 Index of /"）。
   cPanel → **Domains** → 找到 `fnb.beyourdiary.com` → **Manage** → 把
   **Document Root** 改成 `/home/<你的cPanel用户>/fnb-pos/server`（即 Application root 的绝对路径）。
   **这一栏必须填绝对路径（以 `/` 开头）**，不能填 `server` 或 `fnb-pos/server` 这种相对写法 ——
   绝对路径怎么拿见下方「0. 先拿到 Application root 的绝对路径」。
   改完后再到 Node.js App 页面点一次 **Restart**，让 cPanel 把代理 `.htaccess` 重新写到正确的 document root。
4. 在该应用的 **Environment Variables** 里填：
   - `DB_HOST=127.0.0.1`  `DB_PORT=3306`  `DB_USER=beyourdi_cms`  `DB_PASSWORD=<密码>`  `DB_NAME=beyourdi_fnb`
   - `JWT_SECRET=` 一长串随机串（生产务必改）
   - `CLIENT_ORIGIN=https://fnb.beyourdiary.com`（同源可省略；填了更严谨）
   - （可选）`WEB_DIST_PATH`：前端静态目录，默认 `server/public`，一般不用改
5. 打开 cPanel **Terminal**（或在文件管理器里用 "Terminal"），安装依赖并启动：
   ```bash
   cd fnb/server
   npm install
   # 回到 Node.js App 页面点 Restart；首次启动会自动建表 + 写入演示数据
   ```
6. 打开 `https://fnb.beyourdiary.com` → 登录页。

> 关键点：Application URL 选**域名根**后，cPanel 会把整个域名的请求都代理给这个 Node App，
> 由它同时处理 `/api`、Socket.IO 和前端页面。所以**完全不需要** `.htaccess`、
> `public_html` 里的 `index.html` 或额外静态站。

---

## 方案 B（可选）：前后端分离（前端静态站 + 后端子域）
如果你更想让前端由 Apache/LiteSpeed 托管、后端单独用子域：
1. 后端：同方案 A，但 Application URL 用子域，例如 `api.beyourdiary.com`。
2. 前端：构建时把 API 指向该子域再构建：
   ```bash
   cd apps/web
   echo "VITE_API_URL=https://api.beyourdiary.com" > .env
   npm run build          # 产物在 apps/web/dist
   ```
   把 `apps/web/dist/*` 传到前端域名(如 `fnb.beyourdiary.com`)的 `public_html`，
   并把 `deploy/htaccess-cpanel.txt` 存为 `public_html/.htaccess`（已排除 `/api`、`/socket.io`）。
   > 注意：务必传 **dist 里的文件**，不是仓库根 —— 之前“目录列表”就是传错目录导致的。

---

## 本地/更新前端后怎么重新发布
- 改了前端代码后，在本地仓库根运行 `npm run build`（会构建并自动复制到 `server/public`），
  把更新后的 `server/public/` 一起部署/提交即可。
- 改了后端代码后，在 cPanel Node.js App 页面点 **Restart**（必要时重新 `npm install`）。

## 默认演示账号（首次启动建表时写入）
`admin/admin123`、`manager/manager123`、`cashier/cashier123`、`waiter/waiter123`、`kitchen/kitchen123`。
生产前务必改密码（`server/src/seed.js` 里，或直接在数据库 `users` 表改 `password_hash`）。

## 常见问题
- **打开域名是 503（`Service Unavailable`，LiteSpeed 那个大白页）**：
  **这是好消息** —— 说明 Passenger 代理已经生效了，只是 Node 进程起不来。
  唯一能说清原因的地方是 **Application root 下的 `stderr.log`**，它同时也是公网可读的
  （见下方「日志被公开」），所以你可以直接看：
  ```bash
  curl -s https://fnb.beyourdiary.com/stderr.log | tail -30
  ```
  最常见的两条：
  - `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'X'` → **依赖没装**。
    cPanel → Setup Node.js App → 该应用 → **Run NPM Install**；报错就用 Terminal：
    ```bash
    git -C ~/public_html/fnb pull          # 先拿到 workspaces 修复
    cd ~/public_html/fnb/server && npm install --no-audit --no-fund
    ```
    若还没 pull，临时用 `npm install --workspaces=false` 也行 —— 原因见上文
    「如果 Run NPM Install 报 An error occured during installation of modules」。
  - `Access denied for user ...` → MySQL 用户/密码不对，或该用户没被授权给这个库。
  改完点 **Restart**，再跑 `npm run deploy:check`。
- **`https://<域名>/stderr.log` 能被公网直接下载**：
  Passenger 把应用的 stderr 写在 **Application root** 下，而 Application root 就是 Document Root，
  所以这个日志文件能被直接读取。它会泄露**服务器绝对路径**（如 `/home/<用户>/...`）和完整堆栈；
  目前里面只有堆栈、没有口令，但**一旦应用打印出数据库报错就可能带出凭据**。
  挡住它需要主机侧配合（把 Passenger 日志指到 Document Root 之外，例如设
  `PassengerAppLogFile /home/<用户>/logs/fnb-app.log`），或在应用能正常跑起来后
  请主机确认是否可关闭日志目录的直读。自检脚本的「应用日志未公开」那一项会持续盯着它。
- **Document Root 改对了，但打开域名还是 "Index of /"，而且列表里只有 `public` `src` `package.json`**：
  这是**第二个坑**，和第一个坑长得像但原因完全不同 —— 目录列表已经停在 `server/` 这一层了，
  说明 Document Root 是**对的**；缺的是**Node 应用本身**：cPanel 里压根还没建这个 App，
  所以没有 Passenger 代理来接管请求，LiteSpeed 就照旧列目录。
  判据：列表里出现 `DEPLOY.md` / `docker-compose.yml` / `apps` → 还是第一个坑（doc root 指到仓库根）；
  只有 `public` / `src` / `package.json` → 第二个坑（去 0.6 建应用）。
  自检脚本会直接告诉你现在卡在哪个坑。
- **打开域名看到 "Index of /"（LiteSpeed 把整个仓库目录列出来了，例如 `apps/` `server/` `DEPLOY.md` 都被公开）**：
  这是**最常见的坑**，意味着你的域名 Document Root 指到了仓库根 `fnb-pos/`，而不是 `server/`，
  所以 cPanel 的 Node.js App 代理根本没参与。修复三步：
  1. cPanel → **Domains** → 找到 `fnb.beyourdiary.com` → **Manage** → 把
     **Document Root** 改成 `/home/<你的cPanel用户>/fnb-pos/server`（即 Application root 的绝对路径）。
  2. 确认 cPanel → **Setup Node.js App** 里该 App 存在且正确：
     - Application root = `fnb-pos/server`
     - Application URL = `fnb.beyourdiary.com`（域名根，不是子域、不是 `/api` 路径）
     - Startup file = `src/index.js`
     - 环境变量（`DB_*` / `JWT_SECRET` / `CLIENT_ORIGIN`）已填
     - 已 `npm install`、已点过 **Restart**
  3. cPanel → **LiteSpeed Web Cache Manager**（或 Cachewall）→ Flush All，清缓存后再访问。
  
  应急缓解（在改 Document Root 之前）：仓库根已自带 `.htaccess`（`Options -Indexes` +
  屏蔽 `apps/ scripts/ deploy/ node_modules/ server/src/ DEPLOY.md README.md package.json docker-compose.yml`），
  `git pull` 后即可立即阻止目录列表与源码下载暴露公网 —— 但这只是止血，Node App 仍不会被代理，
  真正看到界面必须做完上面三步。
  > 注意：这个文件**只有在 Document Root 是仓库根时才会被读到**；改对之后它就彻底失效、也无害。

  **2026-10-13 实测证据**（`npm run deploy:check` 输出，可复现）：
  | 请求 | 返回 | 含义 |
  | --- | --- | --- |
  | `GET /` | 200，LiteSpeed `Index of /`（列出 apps/deploy/scripts/server） | Document Root = 仓库根 |
  | `GET /api/health` | **404**（LiteSpeed 自带错误页） | 请求没交给 Node，Passenger 完全没参与 |
  | `GET /server/public/index.html` | 200，引用 `/assets/index-DCSPCojG.js` | 前端被埋在子目录，且引用根绝对路径 → 永远加载不出 |
  | `GET /assets/index-DCSPCojG.js` | 404 | 印证上一条 |
  | `GET /DEPLOY.md`、`/package.json`、`/server/src/index.js` | 200，**源码可公网下载** | 仓库根被公开 |
  | `GET /.env`、`/.htaccess` | 403 | LiteSpeed 拦 dotfile，口令未泄露 |
  | `/server/src/routes/` | 只有 8 个文件（本地 11 个） | 线上是 **9/28 的旧快照**，落后 9 个功能区块 |

  最后一行说明：**改完 Document Root 之后，服务器还要 `git pull && npm install` + Restart**，
  否则跑起来的仍是 9/28 那版代码。
- **改了 Document Root 但没生效**：按顺序重来一遍 —— ① 先在 Node.js App 页面点 Restart（让 cPanel 把
  代理 `.htaccess` 重新写到新的 document root）；② 再 Flush All 清 LiteSpeed 缓存；③ 浏览器硬刷新
  （`Cmd/Ctrl+Shift+R`）；④ 重跑 `npm run deploy:check`。若仍是 `Index of /`，多半是绝对路径填错
  （见「0. 先拿到 Application root 的绝对路径」里"填错的样子"）。
- **页面打不开 / 一直转圈**：Node App 没起来。看 cPanel Node.js App 的日志；确认 `npm install` 已跑过、点过 Restart。
- **页面白屏（空白），但 `/api/health` 是通的**：八成是 `WEB_DIST_PATH` 被设成了相对路径
  （如 `server/public`）→ Node 去 `server/server/public` 找前端，找不到就整块不挂载。
  删掉这个环境变量再 Restart 即可（见 0.6 的「两个千万别填的变量」）。
  自检脚本的「前端 JS/CSS 可加载」那一项会红。
- **登录报错 401 / 接口 404**：确认 Application URL 是域名根（方案 A），且 Document Root 已改为 `server/`（参见上一条）。
- **数据库连不上**：确认 `beyourdi_cms` 已授权 `beyourdi_fnb`，且 `DB_HOST` 用 `127.0.0.1`（cPanel 内网）。
- **健康检查**：访问 `https://<你的域名>/api/health` 应返回 `{"ok":true}`。
