# F&B POS System

餐饮(F&B)云端收银系统 —— MVP(收银 + KDS + 库存),Web 端全栈。

技术栈:MERN
- 后端:Node + Express + MongoDB(Mongoose)+ Socket.IO
- 前端:React + Vite + Tailwind CSS
- 实时:KDS 通过 WebSocket 接收订单出单

## 快速开始

```bash
# 1. 安装依赖(根目录,workspaces 会自动装 server 与 web)
npm install

# 2. 配置环境变量
cp .env.example .env

# 3. 启动开发(后端 4000 + 前端 5173)
npm run dev
```

- 后端默认用内存版 MongoDB(`USE_MEMORY_DB=1`),无需安装数据库即可运行。
  如需真实 MongoDB:填 `MONGODB_URI` 并设 `USE_MEMORY_DB=0`,或 `docker compose up -d mongo`。
- 首次启动会自动创建演示组织/门店与管理员账号(见 seed)。

## 默认账号

| 角色 | 手机 | 密码 |
|---|---|---|
| admin(管理员) | 1000000000 | admin123 |
| manager(店长) | 1000000001 | manager123 |
| cashier(收银) | 1000000002 | cashier123 |
| waiter(服务员) | 1000000003 | waiter123 |
| kitchen(厨房) | 1000000004 | kitchen123 |

> 仅未结账订单可取消,且取消须经 manager / admin 审批。

## 目录结构

```
fnb-pos/
├─ server/        # Express + Mongoose + Socket.IO
└─ apps/web/      # React + Vite 收银/后台/KDS
```
