// テスト用の静的ファイルサーバー
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

export async function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    // テストでは本物の API キーを使わない（キー未設定の状態から始め、必要なテストだけ偽のキーを入れる）
    if (p === '/src/app/config.js') { res.end(fs.readFileSync(file, 'utf8').replace(/YOUTUBE_API_KEY = '[^']*'/, "YOUTUBE_API_KEY = ''")); return; }
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, close: () => new Promise(r => server.close(r)) };
}

export async function getPlaywright() {
  try { return await import('playwright'); } catch { /* fallthrough */ }
  const { createRequire } = await import('node:module');
  for (const dir of ['/opt/node-tools/node_modules/', path.join(ROOT, 'node_modules/')]) {
    try { return createRequire(dir)('playwright'); } catch { /* next */ }
  }
  throw new Error('playwright が見つかりません: npm i -D playwright');
}
