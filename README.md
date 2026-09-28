# F&B POS System

餐饮(F&B)云端收银系统 —— MVP(收银 + KDS + 库存),Web 端全栈。

技术栈:
- 后端:Node + Express + **MySQL**(mysql2)+ Socket.IO
- 前端:React + Vite + Tailwind CSS
- 实时:KDS 通过 WebSocket 接收订单出单
- 数据库:**MySQL**(与现有 beyourdiary CMS 共用同一 MySQL 实例,独立库 `beyourdi_fnb`)

## 快速开始(本地)

```bash
# 1. 安装依赖(根目录,workspaces 会自动装 server 与 web)
npm install

# 2. 准备一个本地 MySQL,建库 fnbpos,然后配置环境变量
cp .env.example .env
#   改 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME 指向你的 MySQL

# 3. 启动开发(后端 4000 + 前端 5173)
npm run dev
```

- 首次启动会自动建表 + 写入演示组织/门店与 5 个账号(见 `server/src/seed.js`)。
- 后端使用 **MySQL**,不再依赖 MongoDB。

## 默认账号

| 角色 | 手机 | 密码 |
|---|---|---|
| admin(管理员) | 1000000000 | admin123 |
| manager(店长) | 1000000001 | manager123 |
| cashier(收银) | 1000000002 | cashier123 |
| waiter(服务员) | 1000000003 | waiter123 |
| kitchen(厨房) | 1000000004 | kitchen123 |

> 仅未结账订单可取消,且取消须经 manager / admin 审批。

## 环境变量(.env)

| 变量 | 说明 |
|---|---|
| PORT | 后端端口(默认 4000) |
| DB_HOST / DB_PORT | MySQL 地址(默认 127.0.0.1 / 3306) |
| DB_USER / DB_PASSWORD | MySQL 用户(共用 beyourdi_cms) |
| DB_NAME | 数据库名(beyourdi_fnb) |
| JWT_SECRET | JWT 签名密钥(生产务必修改) |
| CLIENT_ORIGIN | 前端来源,用于 CORS / Socket.IO |

## 目录结构

```
fnb-pos/
├─ server/        # Express + MySQL(mysql2)+ Socket.IO
└─ apps/web/      # React + Vite 收银/后台/KDS
```

部署见 `DEPLOY.md`(cPanel / 共享 MySQL 场景)。
