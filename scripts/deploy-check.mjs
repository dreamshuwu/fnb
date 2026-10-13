#!/usr/bin/env node
/**
 * 部署自检 —— 一条命令判断线上到底是哪一步没配好。
 *
 * 用法（在仓库根执行）：
 *   node scripts/deploy-check.mjs
 *   node scripts/deploy-check.mjs https://fnb.beyourdiary.com
 *   node scripts/deploy-check.mjs https://fnb.beyourdiary.com --json
 *
 * 它只做只读探测，不写任何东西。全部通过时退出码 0，否则 1
 * （方便挂到 CI 或 `&& echo ok` 后面）。
 *
 * 判据来自 DEPLOY.md「看到 Index of /」那一节：
 *   ✅ /            → 返回 SPA（含 id="root"）
 *   ✅ /api/health  → {"ok":true}          ← 这一条挂了就说明请求根本没到 Node
 *   ✅ /assets/*.js → 200 且是 JS
 *   ❌ /DEPLOY.md   → 200 说明仓库根被公开了（Document Root 指错）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const base = (args.find((a) => /^https?:\/\//.test(a)) || 'https://fnb.beyourdiary.com').replace(/\/+$/, '');

const C = {
  reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m',
  red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m',
};

const results = [];
function record(id, title, status, detail, hint) {
  results.push({ id, title, status, detail, hint });
  if (JSON_OUT) return;
  const icon = status === 'pass' ? `${C.green}✅ PASS${C.reset}`
    : status === 'fail' ? `${C.red}❌ FAIL${C.reset}`
      : status === 'warn' ? `${C.yellow}⚠️  WARN${C.reset}`
        : `${C.dim}·  SKIP${C.reset}`;
  console.log(`${icon}  ${title}`);
  if (detail) console.log(`         ${C.dim}${detail}${C.reset}`);
  if (hint && status !== 'pass') console.log(`         ${C.cyan}→ ${hint}${C.reset}`);
}

async function get(p, opts = {}) {
  const url = base + p;
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...opts });
    const body = await res.text();
    return { ok: true, status: res.status, headers: res.headers, body, url };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, url };
  }
}

const DOC_ROOT_HINT = 'cPanel → Domains → ' + base.replace(/^https?:\/\//, '')
  + ' → Manage → Document Root 改成 <Application root 的绝对路径>（cPanel → Setup Node.js App 页面上显示的那串，形如 /home/<cPanel用户>/fnb-pos/server）';

// Document Root 改对之后，还会剩一个**完全不同的**故障：目录里没有 Node 应用。
// 此时再喊「Document Root 指错」就是误诊。用目录列表的内容判断 doc root 到底停在哪一层。
const NO_APP_HINT = 'Document Root 已经对了 —— 缺的是 Node 应用本身。'
  + 'cPanel → Software → Setup Node.js App → CREATE APPLICATION：'
  + 'Node.js version 选最新（20.x/22.x，最低 16.x 也可）、Application mode 选 Production、'
  + 'Application root 填 server 目录（相对家目录，形如 public_html/fnb/server）、'
  + 'Application URL 从下拉框选 ' + base.replace(/^https?:\/\//, '') + ' 且路径框留空、'
  + 'Application startup file 填 src/index.js，再补上 DB_*/JWT_SECRET/CLIENT_ORIGIN 环境变量；'
  + '建好后 Run NPM Install，然后 Restart。';

function guessDocRoot(body) {
  if (!/Index of \//i.test(body)) return null;
  const has = (s) => body.includes(s);
  if (has('DEPLOY.md') && has('docker-compose.yml') && has('apps')) return 'repo-root';
  if (has('package.json') && has('src') && has('public') && !has('DEPLOY.md')) return 'server';
  return 'unknown';
}
function docRootHint(body) {
  return guessDocRoot(body) === 'server' ? NO_APP_HINT : DOC_ROOT_HINT;
}

if (!JSON_OUT) {
  console.log(`\n${C.bold}=== F&B POS 部署自检 ===${C.reset}`);
  console.log(`目标：${C.cyan}${base}${C.reset}\n`);
}

// Node 的 SPA fallback 会把任何非 /api 路径都返回 index.html，
// 所以「200」不等于「文件被公开」——必须比对响应体。
const looksLikeSpa = (body) => /<div id="root">/.test(body);

// ---- 1. 首页：是 SPA 还是目录列表？ -------------------------------------
const home = await get('/');
const homeIsSpa = home.ok && looksLikeSpa(home.body);
const sameAsHome = (body) => home.ok && body.trim() === home.body.trim();
if (!home.ok) {
  record('home', '首页可访问', 'fail', `请求失败：${home.error}`, '确认域名解析与 HTTPS 证书正常。');
} else {
  const isSpa = looksLikeSpa(home.body);
  const isAutoindex = /Index of \//i.test(home.body);
  const isPassengerErr = /Passenger|Application error|Internal Server Error/i.test(home.body);
  if (isSpa) {
    record('home', '首页返回前端 SPA', 'pass', `${home.status} · ${home.body.length}B · 含 id="root"`);
  } else if (isAutoindex) {
    const where = guessDocRoot(home.body);
    const label = where === 'repo-root' ? '仓库根' : where === 'server' ? 'server/ 目录（这一层是对的）' : '未知目录';
    record('home', '首页返回前端 SPA', 'fail',
      `${home.status} · 返回 LiteSpeed 目录列表「Index of /」—— 它列的是 ${label}`,
      docRootHint(home.body));
  } else if (isPassengerErr) {
    record('home', '首页返回前端 SPA', 'fail', `${home.status} · 返回 Passenger/服务器错误页`, '看 cPanel → Setup Node.js App → 日志；确认 npm install 已跑、点过 Restart。');
  } else {
    record('home', '首页返回前端 SPA', 'warn', `${home.status} · ${home.body.length}B · 既不是 SPA 也不是目录列表`, '把响应体存下来看看是什么。');
  }
}

// ---- 2. API 健康检查：请求有没有到 Node？ -------------------------------
const health = await get('/api/health');
if (!health.ok) {
  record('health', 'API 健康检查 /api/health', 'fail', `请求失败：${health.error}`, DOC_ROOT_HINT);
} else {
  let json = null;
  try { json = JSON.parse(health.body); } catch { /* 非 JSON */ }
  if (health.status === 200 && json && json.ok === true) {
    record('health', 'API 健康检查 /api/health', 'pass', `${health.status} · ${health.body.trim()}`);
  } else if (health.status === 404 || health.status === 403) {
    record('health', 'API 健康检查 /api/health', 'fail',
      `${health.status} · 服务器自带 404 —— 请求根本没交给 Node`,
      docRootHint(home.body));
  } else if (health.status === 502 || health.status === 503) {
    record('health', 'API 健康检查 /api/health', 'fail',
      `${health.status} · Passenger 代理到了但 Node 没起来`,
      'cPanel → Setup Node.js App：确认 Application root = server/、Startup file = src/index.js、环境变量已填、已 npm install，然后 Restart。');
  } else {
    record('health', 'API 健康检查 /api/health', 'warn', `${health.status} · ${health.body.slice(0, 120)}`, '期望 200 + {"ok":true}。');
  }
}

// ---- 3. 源码有没有被公开？ ---------------------------------------------
// 探测路径要跟着 doc root 走：doc root 是仓库根时源码在 /server/src/，
// doc root 已经是 server/ 时源码直接落在 /src/。
const atServerRoot = guessDocRoot(home.body) === 'server';
const srcProbes = atServerRoot
  ? ['/package.json', '/src/index.js', '/src/db.js']
  : ['/DEPLOY.md', '/package.json', '/server/src/index.js', '/docker-compose.yml'];
// 只有「200 且返回的确实是源文件本体」才算泄露；SPA fallback 不算。
const exposed = [];
for (const p of srcProbes) {
  const r = await get(p);
  if (r.ok && r.status === 200 && r.body.trim() && !sameAsHome(r.body) && !looksLikeSpa(r.body)) exposed.push(p);
}
if (exposed.length === 0) {
  record('expose', '源码未被公开', 'pass', `${srcProbes.length} 个探测路径均不可直连`);
} else {
  record('expose', '源码未被公开', 'fail',
    `源码可被公网直接下载：${exposed.join('、')}`,
    atServerRoot
      ? 'Document Root 已经是 server/ 了，所以 src/ 直接落在 web 根下。把 Node 应用建起来后 Passenger 会接管全部请求，这一项自动消失。'
      : '同一个根因：Document Root 指到了仓库根。改对之后自然消失；改之前先 git pull 拿到仓库根的 .htaccess（含 Options -Indexes）。');
}

// ---- 4. 前端是不是被埋在子目录里？ -------------------------------------
// 判据：/ 不是 SPA，但某个「错误 URL」能直接取到真的 index.html。
const buriedProbe = atServerRoot ? '/public/index.html' : '/server/public/index.html';
const buried = await get(buriedProbe);
const buriedReal = buried.ok && buried.status === 200 && looksLikeSpa(buried.body) && !homeIsSpa;
if (buriedReal) {
  record('buried', '前端没有被埋在子目录', 'fail',
    `GET ${buriedProbe} 返回了真的 index.html —— 前端文件在，但只能从这个子路径取到`,
    '就算手改 URL 访问到它也没用：它引用的是根绝对路径 /assets/*.js，在子目录里永远加载不出来。');
} else {
  record('buried', '前端没有被埋在子目录', 'pass', `${buriedProbe} → ${buried.status}（非真 index.html）`);
}

// ---- 5. 前端资源真的能加载吗？ -----------------------------------------
const servedIndex = homeIsSpa ? home.body : (buriedReal ? buried.body : '');
const assetRefs = [...servedIndex.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g)].map((m) => m[1]);
if (assetRefs.length === 0) {
  record('assets', '前端 JS/CSS 可加载', 'skip', '没拿到含 assets 引用的 index.html，无法验证');
} else {
  const bad = [];
  for (const a of assetRefs) {
    const r = await get(a.startsWith('http') ? a.replace(base, '') : a);
    const ct = r.ok ? (r.headers.get('content-type') || '') : '';
    if (!r.ok || r.status !== 200 || !/javascript|css/.test(ct)) bad.push(`${a} → ${r.ok ? r.status + ' ' + ct : r.error}`);
  }
  if (bad.length === 0) record('assets', '前端 JS/CSS 可加载', 'pass', `${assetRefs.length} 个资源全部 200`);
  else record('assets', '前端 JS/CSS 可加载', 'fail', bad.join('；'),
    atServerRoot
      ? 'Node 应用还没起来，所以 /assets/* 直接落到 web 根下找不到（文件其实在 server/public/assets/）。建好应用即恢复。'
      : '静态资源 404 说明 doc root 不对（或前端构建产物没传上去）。');
}

// ---- 6. 线上前端是不是旧版？ -------------------------------------------
try {
  const localIndex = fs.readFileSync(path.join(REPO_ROOT, 'server', 'public', 'index.html'), 'utf8');
  const pick = (html) => [...html.matchAll(/\/assets\/index-([A-Za-z0-9_-]+)\.js/g)].map((m) => m[1])[0] || null;
  const localHash = pick(localIndex);
  const liveHash = pick(servedIndex);
  if (!localHash) record('fresh', '线上前端与本地构建一致', 'skip', '本地 server/public/index.html 里没找到 assets 引用（先跑 npm run build）');
  else if (!liveHash) record('fresh', '线上前端与本地构建一致', 'skip', '没取到线上的 index.html');
  else if (localHash === liveHash) record('fresh', '线上前端与本地构建一致', 'pass', `hash ${localHash}`);
  else record('fresh', '线上前端与本地构建一致', 'warn',
    `本地 ${localHash} ≠ 线上 ${liveHash} —— 线上跑的是旧构建`,
    '在服务器上 git pull && npm install，然后 Restart；前端产物 server/public/ 随仓库一起更新。');
} catch (e) {
  record('fresh', '线上前端与本地构建一致', 'skip', `本地读不到构建产物：${e.message}`);
}

// ---- 7. Socket.IO 端点 ---------------------------------------------------
const sio = await get('/socket.io/?EIO=4&transport=polling');
if (sio.ok && sio.status === 200 && /^0\{/.test(sio.body.trim())) {
  record('socket', 'Socket.IO 端点可握手', 'pass', 'GET /socket.io/?EIO=4&transport=polling → 0{...}');
} else {
  record('socket', 'Socket.IO 端点可握手', 'fail',
    sio.ok ? `${sio.status} · ${sio.body.slice(0, 80)}` : sio.error,
    '和 /api/health 同源问题：请求没到 Node。');
}

// ---- 汇总 ---------------------------------------------------------------
const fails = results.filter((r) => r.status === 'fail');
const warns = results.filter((r) => r.status === 'warn');

if (JSON_OUT) {
  console.log(JSON.stringify({ base, results, fails: fails.length, warns: warns.length }, null, 2));
} else {
  console.log(`\n${C.bold}=== 结论 ===${C.reset}`);
  if (fails.length === 0 && warns.length === 0) {
    console.log(`${C.green}全部通过 —— 站点已按预期由 Node 托管（API + Socket.IO + 前端）。${C.reset}\n`);
  } else {
    console.log(`${fails.length} 项失败 / ${warns.length} 项警告\n`);
    if (fails.length) {
      const steps = atServerRoot
        ? [
          [
            'cPanel → Software → Setup Node.js App → CREATE APPLICATION（目录里还没有 Node 应用）：',
            '   · Node.js version：选最新的 LTS（20.x / 22.x；只有 16.x 也能跑，本项目没用新语法）',
            '   · Application mode：Production',
            '   · Application root：server 目录，相对家目录（若仓库在 public_html/fnb 下 → public_html/fnb/server）',
            `   · Application URL：下拉框选 ${base.replace(/^https?:\/\//, '')}，右侧路径框留空`,
            '   · Application startup file：src/index.js',
            '   · Environment variables：DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME /',
            '     JWT_SECRET / CLIENT_ORIGIN（不要填 PORT，Passenger 会自己给；不要填 DEV_NO_DB）',
            '   · 点 CREATE → 回到该应用点 Run NPM Install → 再点 Restart',
          ].join('\n'),
          'Document Root 已经是 server/ 了，不用再改。',
          'cPanel → LiteSpeed Web Cache Manager → Flush All。',
          '服务器上 cd <Application root> && git pull && npm install，再 Restart。',
        ]
        : [
          [
            'cPanel → Software → Setup Node.js App：Application root = server/、Application URL = 域名根、',
            '   Startup file = src/index.js、环境变量已填、已 npm install，然后点 Restart。',
            '   把这一页显示的 Application root 绝对路径复制下来。',
          ].join('\n'),
          'cPanel → Domains → Manage → Document Root = 上面那串绝对路径。',
          '回 Node.js App 页面再点一次 Restart（让代理 .htaccess 重新写对位置）。',
          'cPanel → LiteSpeed Web Cache Manager → Flush All。',
          '服务器上 cd <Application root> && git pull && npm install，再 Restart。',
        ];
      console.log(`${C.bold}按顺序修：${C.reset}`);
      steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      console.log(`  ${steps.length + 1}. 重跑本脚本：${C.cyan}node scripts/deploy-check.mjs${C.reset}\n`);
      console.log(`${C.dim}判定标准只有一个：GET ${base}/api/health 返回 {"ok":true}。${C.reset}\n`);
    }
  }
}

process.exitCode = fails.length === 0 ? 0 : 1;
