// セーブ連携ツール: この PC の Palworld のセーブを、パル配合ノートの画面から読めるようにする（読み取り専用）。
// ブラウザは AppData 配下のフォルダを開けない（Chrome・Edge の制限）ため、このツールが 127.0.0.1 だけで中継する。
// 使い方: npm run save-bridge（または scripts/save-bridge.cmd をダブルクリック）
//   --dir <SaveGames のフォルダ>  既定: %LOCALAPPDATA%\Pal\Saved\SaveGames
//   --port <番号>                 既定: 5175（変えると画面からつながらない）
//   --origin <https://…>          画面の配信元を追加で許可する
//   --dev                         開発用の画面（http://localhost:5173）も許可する
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveFileRole, decompressSav } from '../web/js/save/import.js';
import { parseLevelMeta } from '../web/js/save/palworld.js';

export const BRIDGE_PORT = 5175;
// 画面の配信元（GitHub Pages）。開発用の localhost は --dev を付けたときだけ許可する（他の開発中のサイトから読まれないように）
export const DEFAULT_ORIGINS = ['https://nato093.github.io'];
export const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export function defaultSaveRoot(env = process.env) {
  const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, 'Pal', 'Saved', 'SaveGames');
}

const toPosix = (p) => p.split(path.sep).join('/');

function realOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

/**
 * ワールド内のファイルを、ルートの外に出ないこと（シンボリックリンクの先も含めて）を確かめて開く。
 * ワールドのフォルダの中か、1 つ上の GlobalPalStorage.sav だけを許す。
 * @returns {string|null} 実際のパス
 */
export function resolveSaveFile(root, worldDir, name) {
  if (typeof name !== 'string' || typeof worldDir !== 'string' || !saveFileRole(name)) return null;
  const rootPath = path.resolve(root);
  const base = path.resolve(rootPath, worldDir);
  const full = path.resolve(base, name);
  if (!inside(rootPath, base) || !inside(rootPath, full)) return null;
  if (!(full.startsWith(base + path.sep) || full === path.join(path.dirname(base), 'GlobalPalStorage.sav'))) return null;
  const rootReal = realOrNull(rootPath);
  const real = realOrNull(full);
  if (!rootReal || !real || !inside(rootReal, real)) return null;
  try { if (!fs.statSync(real).isFile()) return null; } catch { return null; }
  return real;
}

function worldFiles(root, rel, worldDir) {
  const names = [];
  try { for (const name of fs.readdirSync(worldDir)) names.push(name); } catch { /* 読めないフォルダは空として扱う */ }
  try { for (const name of fs.readdirSync(path.join(worldDir, 'Players'))) names.push(`Players/${name}`); } catch { /* Players がないワールドもある */ }
  names.push('../GlobalPalStorage.sav');
  return names.filter((name) => resolveSaveFile(root, rel, name));
}

/**
 * セーブのフォルダからワールドを探す。最後に遊んだ順。
 * SaveGames / <SteamID> / <ワールドID> の階層（専用サーバーは SteamID の代わりに 0）を想定し、2 階層下まで見る。
 * - role 'host': Level.sav がある（この PC がホスト、または専用サーバーのセーブ）
 * - role 'guest': LocalData.sav だけがある（他の人のワールドに参加した。フォルダ名はホストのワールド ID と同じ）
 * updatedAt は Level.sav（参加側は LocalData.sav）の更新日時。signature は一式のどれかが変わると変わる値。
 */
export function findWorlds(root) {
  const dirs = [root];
  const children = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !/^backup$/i.test(e.name)).map((e) => path.join(dir, e.name));
    } catch { return []; }
  };
  for (const child of children(root)) {
    dirs.push(child);
    for (const grandchild of children(child)) dirs.push(grandchild);
  }
  const mtime = (file) => {
    try { const stat = fs.statSync(file); return stat.isFile() ? stat.mtimeMs : 0; } catch { return 0; }
  };
  const worlds = [];
  for (const dir of dirs) {
    const level = mtime(path.join(dir, 'Level.sav'));
    const local = mtime(path.join(dir, 'LocalData.sav'));
    if (!level && !local) continue;
    const rel = toPosix(path.relative(root, dir)) || '.';
    const id = path.basename(path.resolve(dir)).toUpperCase();
    if (!level) {
      worlds.push({ id, dir: rel, role: 'guest', updatedAt: new Date(local).toISOString(), playedAt: new Date(local).toISOString(), files: [], signature: '' });
      continue;
    }
    const files = worldFiles(root, rel, dir);
    let newest = 0;
    for (const name of files) newest = Math.max(newest, mtime(path.resolve(dir, name)));
    worlds.push({
      id, dir: rel, role: 'host', updatedAt: new Date(level).toISOString(), playedAt: new Date(Math.max(level, local)).toISOString(),
      size: fs.statSync(path.join(dir, 'Level.sav')).size, files, signature: `${Math.round(newest)}:${files.length}`,
    });
  }
  return worlds.sort((a, b) => b.playedAt.localeCompare(a.playedAt));
}

async function worldMeta(worldDir) {
  try {
    const gvas = await decompressSav(new Uint8Array(fs.readFileSync(path.join(worldDir, 'LevelMeta.sav'))));
    const meta = parseLevelMeta(gvas);
    return { name: meta.worldName || '', hostName: meta.hostPlayerName || '' };
  } catch {
    return { name: '', hostName: '' };
  }
}

export function createBridgeServer({ root = defaultSaveRoot(), origins = DEFAULT_ORIGINS, port = BRIDGE_PORT, log = console.log } = {}) {
  const allowed = new Set(origins);
  const send = (res, status, headers = {}, body = '') => {
    if (!res.headersSent) res.writeHead(status, headers);
    res.end(body);
  };
  return http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      const localPort = req.socket.localPort ?? port;
      // DNS rebinding 対策: 127.0.0.1 / localhost 宛て以外は受けない
      if (!new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${localPort}$`).test(String(req.headers.host || ''))) { send(res, 421); return; }
      // 画面からの要求（別オリジンの fetch）には必ず Origin が付く。付いていない・許可していない要求には何も返さない
      if (!origin || !allowed.has(origin)) { send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'この配信元からは使えません'); return; }
      const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
      if (req.method === 'OPTIONS') {
        send(res, 204, { ...headers, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' });
        return;
      }
      if (req.method !== 'GET') { send(res, 405, headers); return; }
      const url = new URL(req.url, `http://127.0.0.1:${localPort}`);
      if (url.pathname === '/worlds') {
        const worlds = findWorlds(root);
        for (const world of worlds) if (world.role === 'host') Object.assign(world, await worldMeta(path.resolve(root, world.dir)));
        send(res, 200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ version: 1, worlds }));
        return;
      }
      if (url.pathname === '/file') {
        const world = findWorlds(root).find((w) => w.role === 'host' && w.dir === url.searchParams.get('world'));
        const name = url.searchParams.get('name') || '';
        const full = world ? resolveSaveFile(root, world.dir, name) : null;
        if (!full) { send(res, 404, headers); return; }
        const bytes = fs.readFileSync(full);
        log(`読み込み: ${world.dir}/${name}（${bytes.length} バイト）`);
        send(res, 200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length }, bytes);
        return;
      }
      send(res, 404, headers);
    } catch (error) {
      // 不正な要求でツールが止まらないようにする
      send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, String(error?.message ?? error));
    }
  });
}

function parseArgs(argv) {
  const args = { dir: defaultSaveRoot(), port: BRIDGE_PORT, origins: [...DEFAULT_ORIGINS] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--origin') args.origins.push(argv[++i]);
    else if (argv[i] === '--dev') args.origins.push(...DEV_ORIGINS);
  }
  return args;
}

// Windows ではドライブ名の大文字小文字やジャンクションで表記が変わるため、実体のパスで比べる
const isMain = () => {
  try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.dir)) {
    console.error(`セーブのフォルダが見つかりません: ${args.dir}\n--dir でフォルダを指定してください。`);
    process.exit(1);
  }
  const server = createBridgeServer({ root: args.dir, origins: args.origins, port: args.port });
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `ポート ${args.port} は使用中です（連携ツールがすでに起動している可能性があります）` : error.message);
    process.exit(1);
  });
  server.listen(args.port, '127.0.0.1', () => {
    const worlds = findWorlds(args.dir);
    console.log(`セーブ連携ツールを起動しました: http://127.0.0.1:${args.port}（読み取り専用）`);
    const hosted = worlds.filter((w) => w.role === 'host').length;
    console.log(`セーブの場所: ${args.dir}（ホストのワールド ${hosted} 件・参加したワールド ${worlds.length - hosted} 件、最後に遊んだ: ${worlds[0]?.dir ?? 'なし'}）`);
    console.log(`許可している画面: ${args.origins.join(', ')}`);
    console.log('パル配合ノートの設定タブで連携をオンにすると、「所持パル」を開いたときに自動で読み込みます。終了するには Ctrl+C を押すか、このウィンドウを閉じます。');
  });
}
