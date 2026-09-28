# F&B POS 部署指南（cPanel / 共享主机场景）

你现在访问 `fnb.beyourdiary.com` 看到的是目录列表，原因是：**LiteSpeed 只把仓库当静态文件夹列出来了，而 POS 系统是一个需要 Node.js 运行的后端服务**，不是一个纯 HTML 网站。

cPanel 共享主机默认**不能跑长驻 Node 进程**（除非你的 cPanel 带 CloudLinux 的「Setup Node.js App」）。
下面给出两条路，先确认你属于哪种。

---

## 先确认：你的 cPanel 有没有 Node.js？

登录 cPanel → 看 **Software** 栏目：
- 若有 **「Setup Node.js App」** → 走【方案 A】（前后端都放 cPanel）。
- 若没有 → 走【方案 B】（前端静态放 cPanel，后端丢到免费 PaaS）。

---

## 方案 A：cPanel 自带 Node.js（CloudLinux）

1. cPanel → **Setup Node.js App → Create Application**
   - Node.js version：选 **20.x**
   - Application root：`fnb/server`（你 git clone 下来的 server 目录）
   - Application URL：选一个子域，例如 `api.beyourdiary.com`（或主域 `/api`）
   - Startup file：`src/index.js`
   - 确认创建。
2. 在应用的环境变量里加：
   - `USE_MEMORY_DB=0`
   - `MONGODB_URI=` 你的 MongoDB 连接串（cPanel 有 MongoDB 就用它，否则用下面的 Atlas）
   - `JWT_SECRET=` 一长串随机字符
   - `CLIENT_ORIGIN=https://fnb.beyourdiary.com`
3. 打开 cPanel 的 **Terminal**，安装后端依赖：
   ```bash
   cd fnb/server && npm install
   ```
   回到 Node.js App 页面点 **Restart**。
4. 构建并上传前端：
   ```bash
   cd fnb/apps/web
   echo "VITE_API_URL=https://api.beyourdiary.com" > .env   # 填第1步的 Application URL
   npm install && npm run build
   ```
   把 `apps/web/dist/*` 全部上传到 cPanel 的 `public_html`（或 `fnb.beyourdiary.com` 的文档根）。
5. 把 `deploy/htaccess-cpanel.txt` 的内容存为 `public_html/.htaccess`（SPA 路由回退）。
6. 浏览器打开 `https://fnb.beyourdiary.com` → 应看到登录页。

---

## 方案 B：cPanel 无 Node.js（推荐，最稳）

把**前端静态文件**放 cPanel，**后端**放免费的 Node 托管（Render），数据库用免费的 MongoDB Atlas。

### B1. 后端 → Render（免费）
1. 注册 https://render.com → **New → Blueprint** → 连 GitHub 仓库 `dreamshuwu/fnb` → 选 `deploy/render.yaml`。
2. 创建后到 Render 控制台填两个变量：
   - `MONGODB_URI`：下一步 Atlas 的连接串
   - `JWT_SECRET`：随机长串
3. 部署完成，记下后端地址，例如 `https://fnb-pos-api.onrender.com`。

### B2. 数据库 → MongoDB Atlas（免费 M0）
1. 注册 https://cloud.mongodb.com → 建 **M0 免费集群** → 建 DB 用户 + 白名单（Render 用 `0.0.0.0/0`）。
2. 拿到连接串形如：
   `mongodb+srv://user:pass@cluster0.xxxx.mongodb.net/fnbpos`
   填到 Render 的 `MONGODB_URI`。

### B3. 前端 → cPanel 静态托管
```bash
cd fnb/apps/web
echo "VITE_API_URL=https://fnb-pos-api.onrender.com" > .env   # 填 B1 的后端地址
npm install && npm run build
```
把 `apps/web/dist/*` 上传到 cPanel `public_html`（即 `fnb.beyourdiary.com` 文档根）。
并把 `deploy/htaccess-cpanel.txt` 存为 `public_html/.htaccess`。

### B4. 允许跨域
Render 后端已通过 `CLIENT_ORIGIN=https://fnb.beyourdiary.com` 放开 CORS（在 render.yaml 已配置）。
如后端在别处，记得把 `CLIENT_ORIGIN` 设成你的前端域名。

打开 `https://fnb.beyourdiary.com` → 登录页出来了。

---

## 默认演示账号（seed 注入）
| 角色 | 用户名 | 密码 |
|------|--------|------|
| admin | admin | admin123 |
| manager | manager | manager123 |
| cashier | cashier | cashier123 |
| kitchen | kitchen | kitchen123 |
| waiter | waiter | waiter123 |

生产前务必改掉这些密码（在 `server/src/seed.js`）。

## 常见问题
- **页面能开但登录报错 / 一直转圈**：后端没起来或 `VITE_API_URL` 填错。先打开 `https://<后端地址>/api/health` 看是否返回 `{"ok":true}`。
- **KDS 不出单**：Socket.IO 没连上，确认 `VITE_SOCKET_URL`（或 `VITE_API_URL`）指向后端。
- **cPanel 上传后还是目录列表**：确认 `public_html` 里有 `index.html` 且 `.htaccess` 已放好；清 LiteSpeed 缓存（cPanel → LiteSpeed Cache → Flush All）。
