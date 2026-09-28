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

## 方案 A（推荐）：一体化部署，一个 Node App 托管一切
1. 把仓库代码放到 cPanel（git clone 或上传）。重点是里面的 `server/` 目录。
   - `server/public/` 已经包含构建好的前端（由 CI/本地 `npm run build` 生成并随仓库发布），
     所以你**不用自己构建前端、也不用传 dist 到 public_html**。
2. cPanel → **Setup Node.js App → Create Application**：
   - Node.js version：选 **20.x**
   - **Application root：指向 `server/` 目录**（例如 `fnb/server`，即含 `package.json`/`src` 的那个目录）
   - **Application URL：你的域名根**，例如 `fnb.beyourdiary.com`（不要选子域、也不要在路径里加 `/api`）
   - **Startup file：`src/index.js`**
3. 在该应用的 **Environment Variables** 里填：
   - `DB_HOST=127.0.0.1`  `DB_PORT=3306`  `DB_USER=beyourdi_cms`  `DB_PASSWORD=<密码>`  `DB_NAME=beyourdi_fnb`
   - `JWT_SECRET=` 一长串随机串（生产务必改）
   - `CLIENT_ORIGIN=https://fnb.beyourdiary.com`（同源可省略；填了更严谨）
   - （可选）`WEB_DIST_PATH`：前端静态目录，默认 `server/public`，一般不用改
4. 打开 cPanel **Terminal**（或在文件管理器里用 “Terminal”），安装依赖并启动：
   ```bash
   cd fnb/server
   npm install
   # 回到 Node.js App 页面点 Restart；首次启动会自动建表 + 写入演示数据
   ```
5. 打开 `https://fnb.beyourdiary.com` → 登录页。

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
- **页面打不开 / 一直转圈**：Node App 没起来。看 cPanel Node.js App 的日志；确认 `npm install` 已跑过、点过 Restart。
- **登录报错 401 / 接口 404**：确认 Application URL 是域名根（方案 A），且没有用 `.htaccess` 把 `/api` 拦掉。
- **数据库连不上**：确认 `beyourdi_cms` 已授权 `beyourdi_fnb`，且 `DB_HOST` 用 `127.0.0.1`（cPanel 内网）。
- **健康检查**：访问 `https://<你的域名>/api/health` 应返回 `{"ok":true}`。
