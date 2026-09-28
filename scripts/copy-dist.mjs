import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'apps/web/dist');
const dest = path.join(root, 'server/public');

if (!fs.existsSync(src)) {
  console.error('[copy-dist] apps/web/dist not found. Run "npm run build -w apps/web" first.');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('[copy-dist] copied apps/web/dist -> server/public');
