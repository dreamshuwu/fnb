# F&B POS 部署指南（cPanel / 共享 MySQL 场景）

目标:把 POS 跑在你的 cPanel 上,并**共用已有的 MySQL 实例**(独立库 `beyourdi_fnb`,用户 `beyourdi_cms`)。

后端数据层已改为 **MySQL(mysql2)**,不再是 MongoDB。

---

## 前提:数据库
1. 登录 cPanel → **MySQL Databases**:
   - 确认库 `beyourdi_fnb` 已存在(没有就新建)。
   - 确认用户 `beyourdi_cms` 已授权访问 `beyourdi_fnb`(在 "Add User To Database" 里把 `beyourdi_cms` 加到 `beyourdi_fnb`,给 ALL PRIVILEGES)。
2. 拿到连接信息:主机通常是 `127.0.0.1:3306`(或 `localhost`)。
3. ⚠️ 生产请新建一个**专用用户**(如 `beyourdi_fnb`)只授权给 `beyourdi_fnb`,不要用通用密码明文。

---

## 方案 A:cPanel 自带 Node.js(CloudLinux)—— 推荐
让后端与 MySQL 同机,直接连 `127.0.0.1:3306`。

1. cPanel → **Setup Node.js App → Create Application**:
   - Node.js version:选 **20.x**
   - Application root:`fnb/server`(git clone 下来的 server 目录)
   - Application URL:选子域,例如 `api.beyourdiary.com`(或主域 `/api`)
   - Startup file:`src/index.js`
2. 在该应用的环境变量里加:
   - `DB_HOST=127.0.0.1` `DB_PORT=3306` `DB_USER=beyourdi_cms` `DB_PASSWORD=<密码>` `DB_NAME=beyourdi_fnb`
   - `JWT_SECRET=` 一长串随机串
   - `CLIENT_ORIGIN=https://fnb.beyourdiary.com`
3. 打开 cPanel **Terminal**,安装后端依赖并建表:
   ```bash
   cd fnb/server && npm install
   # 首次启动会自动建表 + 写入演示数据(见 server/src/index.js 调用的 initSchema/seedIfEmpty)
   ```
   回到 Node.js App 页面点 **Restart**。
4. 构建并上传前端:
   ```bash
   cd fnb/apps/web
   echo "VITE_API_URL=https://api.beyourdiary.com" > .env   # 第1步的 Application URL
   npm install && npm run build
   ```
   把 `apps/web/dist/*` 上传到 cPanel 的 `public_html`(即 `fnb.beyourdiary.com` 文档根)。
5. 把 `deploy/htaccess-cpanel.txt` 的内容存为 `public_html/.htaccess`(SPA 路由回退)。
6. 打开 `https://fnb.beyourdiary.com` → 登录页。

---

## 方案 B:cPanel 无 Node.js(后端用 Render 等)
若 cPanel 没有 Node.js App,后端无法在 cPanel 跑,也就**无法直连 cPanel 的私有 MySQL**。
此时有二选一:
- **B1**:后端部署到能连 MySQL 的同一台 VPS/节点(另装 Node + 可访问的 MySQL)。
- **B2**:后端放 Render、数据库用**可公网访问**的 MySQL(如 Aiven / PlanetScale 免费层 / 自有 VPS 的 MySQL),前端仍静态放 cPanel。

若选 Render + 可公网 MySQL:
1. Render → New → Blueprint → 连 GitHub 仓库 `dreamshuwu/fnb` → 选 `deploy/render.yaml`(把 `DB_*` 改为你的 MySQL 连接串)。
2. 前端 `apps/web` 构建时 `VITE_API_URL=https://<render后端地址>`。
3. 前端静态上传 cPanel `public_html` + `.htaccess`。

---

## 默认演示账号(建表时写入)
admin/admin123、manager/manager123、cashier/cashier123、waiter/waiter123、kitchen/kitchen123。
生产前务必改密码(`server/src/seed.js` 里,或在数据库 `users` 表改 `password_hash`)。

## 常见问题
- **页面能开但登录报错 / 一直转圈**:后端没起来或 `VITE_API_URL` 填错。开 `https://<后端地址>/api/health` 看是否返回 `{"ok":true}`。
- **KDS 不出单**:Socket.IO 没连上,确认 `VITE_SOCKET_URL`(或 `VITE_API_URL`)指向后端。
- **cPanel 上传后还是目录列表**:确认 `public_html` 有 `index.html` 且 `.htaccess` 已放好;清 LiteSpeed 缓存(cPanel → LiteSpeed Cache → Flush All)。
- **数据库连不上**:确认 `beyourdi_cms` 用户已授权 `beyourdi_fnb`,且 `DB_HOST` 在 cPanel 内用 `127.0.0.1`(不是 localhost 有时更有效)。
