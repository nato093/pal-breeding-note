// この PC の Palworld のセーブから、ワールドを探す（読み取りのみ。開発用の npm run check:save で使う）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveFileRole } from '../web/js/save/import.js';
import { judgeRole } from '../web/js/save/source.js';

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
 * 役割は judgeRole（web/js/save/source.js）で決める。'host' はこの PC にワールドのセーブがある、'guest' は参加しただけ
 * （前にホストしたときの Level.sav が残っていても、LocalData.sav の方が新しければ参加）。
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
    const playedAt = new Date(Math.max(level, local)).toISOString();
    if (judgeRole({ levelTime: level, localTime: local }) === 'guest') {
      worlds.push({ id, dir: rel, role: 'guest', updatedAt: new Date(local).toISOString(), playedAt, files: [] });
      continue;
    }
    worlds.push({ id, dir: rel, role: 'host', updatedAt: new Date(level).toISOString(), playedAt, files: worldFiles(root, rel, dir) });
  }
  return worlds.sort((a, b) => b.playedAt.localeCompare(a.playedAt));
}
