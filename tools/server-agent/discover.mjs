// サーバーのワールドの見つけ方（docs/server/README.md の T5。仲間の PC でも動くように、決め打ちのパスを持たない）。
// 順に: 設定の worldDir → 設定の serverRoot → %LOCALAPPDATA%\ServerSync\instances.json の各インスタンス。
// serverRoot・インスタンスでは <Saved>\Config\WindowsServer\GameUserSettings.ini の DedicatedServerName がワールドを指す。
// instance.json・PalWorldSettings.ini はパスワードを含むので読まない。ServerSync のローカル API も使わない（ファイルで足りる）。
// 複数のインスタンスが候補なら、更新日時では選ばずに設定の instance を求める（終了コード 2 の理由として返す）。
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { isServerWorld, parseWorldPath, savePathForName } from '../../web/js/save/handles.js';

// サーバーの Saved のフォルダ（ServerSync は bin\Pal\Saved と、そこへのジャンクション save。Steam の PalServer は Pal\Saved）
const SAVED_DIRS = [['bin', 'Pal', 'Saved'], ['Pal', 'Saved'], ['save']];
const INI = ['Config', 'WindowsServer', 'GameUserSettings.ini'];
const WORLD_ID = /^[0-9A-F]{32}$/i;
const INSTANCE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// 常駐が読むワールドの直下のファイル（LocalData.sav・GlobalPalStorage.sav は使わない。server の決定 10）
const WORLD_FILES = new Set(['Level.sav', 'LevelMeta.sav']);

/** child が parent の中（同じ場所を含む）か。Windows では大文字と小文字を区別しない（path.relative に任せる） */
export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function realOrNull(fs, target) {
  try { return await fs.realpath(target); } catch { return null; }
}

async function isDirectory(fs, target) {
  try { return (await fs.stat(target)).isDirectory(); } catch { return false; }
}

// ini・json の本文（UTF-16 LE の BOM と UTF-8 の BOM を受ける）
function decodeText(bytes) {
  const buffer = Buffer.from(bytes);
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  return buffer.toString('utf8').replace(/^﻿/, '');
}

/** GameUserSettings.ini の [/Script/Pal.PalGameLocalSettings] の DedicatedServerName（ワールド ID。大文字）。なければ '' */
export function dedicatedServerName(iniText) {
  let section = '';
  for (const raw of String(iniText ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[(.*)\]$/.exec(line);
    if (head) { section = head[1].trim().toLowerCase(); continue; }
    if (section !== '/script/pal.palgamelocalsettings') continue;
    const match = /^DedicatedServerName\s*=\s*(.*)$/i.exec(line);
    if (match) return WORLD_ID.test(match[1].trim()) ? match[1].trim().toUpperCase() : '';
  }
  return '';
}

// Saved のフォルダ（…\Pal\Saved）から、PalServer.exe があるフォルダ（Pal の 1 つ上）を出す。形が違えば ''
function serverDirOf(savedDir) {
  const pal = path.dirname(savedDir);
  if (path.basename(savedDir).toLowerCase() !== 'saved' || path.basename(pal).toLowerCase() !== 'pal') return '';
  return path.dirname(pal);
}

// Saved のフォルダから、DedicatedServerName が指すワールドを探す。見つからなければ null
async function worldFromSaved(fs, savedDir) {
  const saved = await realOrNull(fs, savedDir);
  if (!saved) return null;
  let ini;
  try { ini = decodeText(await fs.readFile(path.join(saved, ...INI))); } catch { return null; }
  const worldId = dedicatedServerName(ini);
  if (!worldId) return null;
  const worldDir = await realOrNull(fs, path.join(saved, 'SaveGames', '0', worldId));
  if (!worldDir || !isInside(saved, worldDir) || !(await isDirectory(fs, worldDir))) return null;
  return { worldId, worldDir, savedDir: saved, serverDir: serverDirOf(saved) };
}

async function worldFromRoot(fs, root) {
  for (const parts of SAVED_DIRS) {
    const found = await worldFromSaved(fs, path.join(root, ...parts));
    if (found) return found;
  }
  return null;
}

/** %LOCALAPPDATA%\ServerSync\instances.json（{ インスタンス ID: フォルダ }）。読めなければ [] */
export async function readInstances(localAppData, { fs = fsPromises } = {}) {
  if (!localAppData) return [];
  let value;
  try { value = JSON.parse(decodeText(await fs.readFile(path.join(localAppData, 'ServerSync', 'instances.json')))); } catch { return []; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).filter(([id, dir]) => INSTANCE_ID.test(id) && typeof dir === 'string' && dir).map(([id, dir]) => ({ id, dir }));
}

const matchesInstance = (id, wanted) => !wanted || id.toLowerCase().startsWith(wanted.toLowerCase());
// 理由の文に出すインスタンス ID は先頭 4 字だけ
const shortId = (id) => `${id.slice(0, 4)}…`;
const failure = (reason, candidates = []) => ({ ok: false, exitCode: 2, reason, candidates });

/**
 * サーバーのワールドを探す。
 * @param {{ worldDir?: string, serverRoot?: string, instance?: string, localAppData?: string, fs?: object }} options
 * @returns {Promise<{ ok: true, source: 'worldDir'|'serverRoot'|'serversync', worldId: string, worldDir: string, savedDir: string,
 *   serverDir: string, instanceId: string, instanceDir: string } | { ok: false, exitCode: 2, reason: string, candidates: string[] }>}
 *   パスは実際のパス（fs.realpath）。instanceId・instanceDir は ServerSync のインスタンスに当たらなければ ''
 */
export async function discoverWorld({ worldDir = '', serverRoot = '', instance = '', localAppData = '', fs = fsPromises } = {}) {
  const instances = (await readInstances(localAppData, { fs })).filter((entry) => matchesInstance(entry.id, instance));
  // 見つけたワールドを、それを含む ServerSync のインスタンスに結び付ける（サーバーが動いているかの判定に使う）
  const withInstance = async (found, source) => {
    const owners = [];
    for (const entry of instances) {
      const dir = await realOrNull(fs, entry.dir);
      if (dir && isInside(dir, found.worldDir)) owners.push({ ...entry, dir });
    }
    if (instance && owners.length !== 1) return failure('設定の instance のインスタンスに、このワールドが見つかりません');
    const owner = owners.length === 1 ? owners[0] : null;
    return { ok: true, source, ...found, serverDir: found.serverDir || owner?.dir || '', instanceId: owner?.id ?? '', instanceDir: owner?.dir ?? '' };
  };

  if (worldDir) {
    const parsed = parseWorldPath(worldDir);
    if (!parsed || !isServerWorld(parsed.steamId)) return failure('設定の worldDir がサーバーのセーブ（SaveGames\\0\\<ワールド ID>）のフォルダではありません');
    const real = await realOrNull(fs, worldDir);
    if (!real || !(await isDirectory(fs, real)) || parseWorldPath(real)?.worldId !== parsed.worldId) return failure('設定の worldDir のフォルダが見つかりません');
    const saved = path.dirname(path.dirname(path.dirname(real)));
    return withInstance({ worldId: parsed.worldId, worldDir: real, savedDir: saved, serverDir: serverDirOf(saved) }, 'worldDir');
  }
  if (serverRoot) {
    const found = await worldFromRoot(fs, serverRoot);
    if (!found) return failure('設定の serverRoot に、GameUserSettings.ini の DedicatedServerName が指すワールドが見つかりません');
    return withInstance(found, 'serverRoot');
  }

  if (instance && !instances.length) return failure('設定の instance に当たる ServerSync のインスタンスがありません');
  const found = [];
  for (const entry of instances) {
    const world = await worldFromRoot(fs, entry.dir);
    if (!world || found.some((other) => other.worldDir === world.worldDir)) continue;
    const dir = await realOrNull(fs, entry.dir);
    found.push({ ...world, serverDir: world.serverDir || dir, instanceId: entry.id, instanceDir: dir });
  }
  if (!found.length) return failure('サーバーのワールドが見つかりません（ServerSync のインスタンスか、設定の serverRoot・worldDir を確かめてください）');
  if (found.length > 1) {
    const candidates = found.map((world) => shortId(world.instanceId));
    return failure(`サーバーのワールドがあるインスタンスが ${found.length} つあります。設定の instance でどれかを選んでください`, candidates);
  }
  return { ok: true, source: 'serversync', ...found[0] };
}

/**
 * ワールドのフォルダの、常駐が読むファイル（直下の Level.sav・LevelMeta.sav と Players の中の <uid>.sav・<uid>_dps.sav）。
 * handles.js の savePathForName で絞る（savesync.sav・backup は入らない。LocalData.sav・GlobalPalStorage.sav は使わない）。
 * 実際のパスがワールドのフォルダの外に出るもの（リンク）は使わない。
 * @returns {Promise<Record<string, string>>} { 相対パス: 実際のパス }（相対パスの順）
 */
export async function listWorldFiles(worldDir, { fs = fsPromises } = {}) {
  const root = await realOrNull(fs, worldDir);
  if (!root) return {};
  const candidates = [];
  const names = async (dir) => { try { return await fs.readdir(dir); } catch { return []; } };
  for (const name of await names(root)) {
    const rel = savePathForName(name);
    if (WORLD_FILES.has(rel)) candidates.push([rel, path.join(root, name)]);
  }
  for (const name of await names(path.join(root, 'Players'))) {
    const rel = savePathForName(name);
    if (rel.startsWith('Players/')) candidates.push([rel, path.join(root, 'Players', name)]);
  }
  const files = {};
  for (const [rel, abs] of candidates.sort(([a], [b]) => a.localeCompare(b))) {
    const real = await realOrNull(fs, abs);
    if (!real || !isInside(root, real) || files[rel]) continue;
    try { if (!(await fs.stat(real)).isFile()) continue; } catch { continue; }
    files[rel] = real;
  }
  return files;
}
