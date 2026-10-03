import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const roots = { web: path.join(project, 'web'), dev: path.join(project, 'dev') };
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};

export async function serveStatic(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('この操作は利用できません');
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const development = pathname.startsWith('/dev/');
    const root = development ? roots.dev : roots.web;
    const relative = development ? pathname.slice(5) : pathname.slice(1);
    let target = path.resolve(root, relative || 'index.html');
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('配信範囲外');
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    target = await realpath(target);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error('配信範囲外');
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('ファイルが見つかりません');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = http.createServer(serveStatic);
  const port = Number(process.env.PORT ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT は 1〜65535 の整数で指定してください。');
    process.exitCode = 1;
  } else {
    server.on('error', (error) => {
      console.error(`開発サーバを起動できません（${error.code}）。ポートの利用権限と使用状況を確認してください。`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      console.log(`パル配合ノート: http://localhost:${port}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
  }
}
