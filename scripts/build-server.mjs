/**
 * 把整个后端（含全部 npm 依赖）打成一个单文件 ESM bundle：server/dist/index.mjs
 *
 * 为什么需要它：cPanel 的 Node.js Selector 在共享主机上装依赖经常失败
 * （本项目实际遇到过：npm 因 workspaces 把依赖装到 Application root 之外，
 * cPanel 直接报 "An error occured during installation of modules" 并且什么都不装）。
 * 打好 bundle 之后，服务器上**不需要 node_modules**，只要把 dist/index.mjs 传上去、
 * 把 Startup file 改成 dist/index.mjs 即可。
 *
 * 用法（仓库根）：
 *   npm run build:server
 *
 * 产物落点很关键：必须是 server/dist/index.mjs，这样 index.js 里
 * `path.join(__dirname, '..', 'public')` 才会解析到 server/public。
 * 放到 server/ 根下会变成仓库根/public，前端就挂不上了。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'server', 'src', 'index.js');
const outfile = path.join(root, 'server', 'dist', 'index.mjs');

// esbuild 解析：优先用仓库内的副本（根 node_modules 或 apps/web 里 vite 带的那个），
// 最后才退回普通模块解析（可配合 NODE_PATH 指向已装好 esbuild 的目录）。
// 这样在「根目录依赖没装全」的机器上也能打包。
async function importEsbuild() {
  const candidates = [
    path.join(root, 'node_modules', 'esbuild', 'lib', 'main.js'),
    path.join(root, 'apps', 'web', 'node_modules', 'esbuild', 'lib', 'main.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return import(pathToFileURL(c).href);
  }
  return import('esbuild');
}

const { build } = await importEsbuild();

fs.mkdirSync(path.dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  minify: false,
  sourcemap: false,
  // 产物是要提交/分发到服务器的单文件，保留第三方依赖的许可声明（MIT/Apache 等）
  legalComments: 'eof',
  logLevel: 'info',
  // ESM 产物里没有 require；bundled 的 CJS 依赖（mysql2 / socket.io 等）在运行时
  // 可能仍会调 require()，这里补一个 shim。
  banner: {
    js: "import { createRequire as __createRequire } from 'module';\n"
      + 'const require = __createRequire(import.meta.url);',
  },
});

if (result.errors?.length) {
  console.error('[build-server] 打包失败');
  process.exit(1);
}

const kb = (fs.statSync(outfile).size / 1024).toFixed(0);
console.log(`[build-server] server/src/index.js -> server/dist/index.mjs (${kb} kB)`);

// ---- 构建后安全扫描 ----
// 「是否被直接运行」的守卫通常写成 `import.meta.url === \`file://${process.argv[1]}\``。
// 在单文件 bundle 里，这两个值会同时指向入口文件（dist/index.mjs）→ 相等 → 守卫误判为真，
// 于是服务一启动就执行 CLI 逻辑（本项目真实踩过：seed 守卫触发，dev 模式进程跑去连 MySQL 崩掉）。
// 这里兜一层，防止以后新增文件重新引入这种守卫。
const bundled = fs.readFileSync(outfile, 'utf8');
const DANGEROUS_GUARD = 'file://${process.argv[1]}';
if (bundled.includes(DANGEROUS_GUARD)) {
  const line = bundled.slice(0, bundled.indexOf(DANGEROUS_GUARD)).split('\n').length;
  console.error(`[build-server] ✗ 打包产物第 ${line} 行残留「直接运行」守卫：${DANGEROUS_GUARD}`);
  console.error('  该判断在单文件 bundle 中会误判为真，导致服务启动时执行 CLI 逻辑（如 seed 连库）。');
  console.error('  请把守卫改成 bundle-safe 写法（参考 server/src/seed.js 的 invokedAsSeedCli）。');
  process.exit(1);
}

console.log('[build-server] 部署时把 Startup file 设为 dist/index.mjs，无需 npm install');
