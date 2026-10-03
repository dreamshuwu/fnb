// ---------------------------------------------------------------------------
// 统一错误处理 —— Express 4 不会捕获 async handler 里的 rejection。
//
// 实际后果:任何一处 `schema.parse(req.body)` 校验失败(以及任何 await 之后的
// 抛错)都会变成 unhandledRejection,在 Node ≥15 下**直接杀掉整个进程**,
// 而不只是让这一个请求失败。
//
// 这里在应用启动的最早期给 Router 的注册方法打一层包装,把 async handler 的
// 异常交给 next(err),再由 errorHandler 统一转成 JSON 响应。
// 因为 ESM 按 import 顺序求值,index.js 只要把这个模块放在第一个 import,
// 补丁就会在所有 routes/*.js 注册路由之前生效。
// ---------------------------------------------------------------------------
import express from 'express';

// 注意:不含 'use'。Express 靠 fn.length === 4 识别错误中间件,
// 包装后 length 会变成 3,反而会让错误中间件失效。
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];
let installed = false;

function wrapHandler(fn) {
  if (typeof fn !== 'function') return fn;
  // 只包 async 函数;同步函数 Express 自己的 try/catch 已经能兜住
  if (fn.constructor?.name !== 'AsyncFunction') return fn;
  return function wrappedHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function installAsyncErrorHandling() {
  if (installed) return;
  installed = true;
  for (const m of METHODS) {
    const orig = express.Router[m];
    if (typeof orig !== 'function') continue;
    express.Router[m] = function (...args) {
      return orig.apply(this, args.map(wrapHandler));
    };
  }
}

/** 兜底错误中间件,必须挂在所有路由之后。 */
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;
  // zod 校验失败 → 400,并回传字段级信息,前端可直接定位到哪个字段
  if (err?.name === 'ZodError' || Array.isArray(err?.issues)) {
    const issues = (err.issues || []).map((i) => ({ path: i.path, message: i.message }));
    return res.status(400).json({
      error: 'validation_failed',
      message: issues.map((i) => `${(i.path || []).join('.') || 'body'}: ${i.message}`).join('; '),
      issues,
    });
  }
  // 业务上显式带 status 的错误
  if (err?.status) {
    return res.status(err.status).json({ error: err.code || err.message || 'error' });
  }
  console.error('[api] unhandled error:', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'internal_error' });
}

// 导入即生效 —— 必须早于任何 routes/*.js 的求值
installAsyncErrorHandling();
