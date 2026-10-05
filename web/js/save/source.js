// 画面で選んだ（またはドロップした）フォルダから、ワールドのセーブ一式を見つける。
import { saveFileRole } from './import.js';

const WORLD_ID = /^[0-9A-F]{32}$/i;

/**
 * パス付きのファイル一覧からワールドを探す。最後に遊んだ順。バックアップ（backup フォルダ）の中は対象にしない。
 * Level.sav のあるフォルダは role 'host'（この PC にワールドのセーブがある）、
 * LocalData.sav だけのフォルダは role 'guest'（他の人のワールドに参加した。フォルダ名がホストのワールド ID）。
 * @param {{ path: string, file: File }[]} entries path は選んだフォルダからの相対パス（/ 区切り）
 * @returns {{ id: string, dir: string, role: 'host'|'guest', updatedAt: string, playedAt: string, files: { path: string, file: File }[] }[]}
 */
export function findWorldsInEntries(entries) {
  const normalized = entries.map((entry) => ({ ...entry, path: entry.path.replace(/\\/g, '/').replace(/^\/+/, '') }));
  const byPath = new Map(normalized.map((entry) => [entry.path, entry]));
  const dirs = new Map();
  for (const entry of normalized) {
    const parts = entry.path.split('/');
    const name = parts.at(-1);
    if ((name !== 'Level.sav' && name !== 'LocalData.sav') || parts.some((part) => /^backup$/i.test(part))) continue;
    const dir = parts.slice(0, -1).join('/');
    if (!dirs.has(dir)) dirs.set(dir, {});
    dirs.get(dir)[name] = entry;
  }
  const time = (entry) => (entry ? new Date(entry.file.lastModified || 0).getTime() : 0);
  const worlds = [];
  for (const [dir, found] of dirs) {
    const parts = dir ? dir.split('/') : [];
    const folder = parts.at(-1) ?? '';
    const id = WORLD_ID.test(folder) ? folder.toUpperCase() : (folder || 'ワールド');
    const playedAt = new Date(Math.max(time(found['Level.sav']), time(found['LocalData.sav']))).toISOString();
    if (!found['Level.sav']) {
      worlds.push({ id, dir: dir || '.', role: 'guest', updatedAt: playedAt, playedAt, files: [] });
      continue;
    }
    const prefix = dir ? `${dir}/` : '';
    const files = [];
    for (const other of normalized) {
      if (!other.path.startsWith(prefix)) continue;
      const rel = other.path.slice(prefix.length);
      if (saveFileRole(rel) && !rel.includes('../') && rel.split('/').length <= 2) files.push({ path: rel, file: other.file });
    }
    const parent = parts.slice(0, -1).join('/');
    const global = byPath.get(parent ? `${parent}/GlobalPalStorage.sav` : 'GlobalPalStorage.sav');
    if (global && dir) files.push({ path: '../GlobalPalStorage.sav', file: global.file });
    worlds.push({ id, dir: dir || '.', role: 'host', updatedAt: new Date(time(found['Level.sav'])).toISOString(), playedAt, files });
  }
  return worlds.sort((a, b) => b.playedAt.localeCompare(a.playedAt));
}

/** <input type="file" webkitdirectory> の選択結果。 */
export function entriesFromFileList(fileList) {
  return [...fileList].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

// ドロップされたフォルダを（古い FileSystemEntry の仕組みで）たどる。AppData 配下でも読める。
function readEntries(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function walk(entry, prefix, out, depth) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ path: `${prefix}${entry.name}`, file });
    return;
  }
  // Saved フォルダごとドロップされても Players まで届くよう、6 階層までたどる（バックアップは除く）
  if (!entry.isDirectory || depth > 6 || /^backup$/i.test(entry.name)) return;
  const reader = entry.createReader();
  for (let batch = await readEntries(reader); batch.length; batch = await readEntries(reader)) {
    for (const child of batch) await walk(child, `${prefix}${entry.name}/`, out, depth + 1);
  }
}

/** ドロップされた項目（フォルダ・ファイル）をパス付きのファイル一覧にする。 */
export async function entriesFromDataTransfer(dataTransfer) {
  const out = [];
  const roots = [...(dataTransfer?.items ?? [])].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  for (const root of roots) await walk(root, '', out, 0);
  return out;
}

/** ワールドのファイルを読み込む。 */
export async function readWorldEntries(world) {
  const files = [];
  for (const { path, file } of world.files) files.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
  return files;
}
