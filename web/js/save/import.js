// ワールドのセーブ一式（Level.sav・LevelMeta.sav・Players/*.sav・GlobalPalStorage.sav）を解凍・解析して、
// 所持パルのスナップショットにする。DOM にも通信にも触れない（Web Worker からも使う）。
import { decompressOodle } from './oodle.js';
import {
  readSavHeader, detectSaveKind, playerUidFromFileName, parseLevel, parsePlayer, parsePalStorage, parseLevelMeta, buildSnapshot,
} from './palworld.js';

/**
 * セーブのファイル名（ワールドのフォルダからの相対パス）から役割を決める。対象外なら ''。
 * @param {string} path 例 'Level.sav'・'Players/0123…_dps.sav'・'../GlobalPalStorage.sav'
 * @returns {'level'|'meta'|'player'|'dps'|'global'|''}
 */
export function saveFileRole(path) {
  const parts = String(path).replace(/\\/g, '/').split('/').filter(Boolean);
  const name = parts.at(-1) ?? '';
  const parent = parts.at(-2) ?? '';
  if (/^Level\.sav$/i.test(name)) return 'level';
  if (/^LevelMeta\.sav$/i.test(name)) return 'meta';
  if (/^GlobalPalStorage\.sav$/i.test(name)) return 'global';
  if (/^Players$/i.test(parent) && /^[0-9a-f]{32}_dps\.sav$/i.test(name)) return 'dps';
  if (/^Players$/i.test(parent) && /^[0-9a-f]{32}\.sav$/i.test(name)) return 'player';
  return '';
}

async function inflate(bytes) {
  // zlib 形式（PlZ）。ブラウザ・Node 18 以降に標準である DecompressionStream を使う。
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * .sav（圧縮済み）を解凍して GVAS のバイト列にする。
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function decompressSav(bytes) {
  const header = readSavHeader(bytes);
  const body = bytes.subarray(header.dataOffset);
  let result;
  if (header.compression === 'oodle') {
    result = decompressOodle(body.subarray(0, Math.min(body.length, header.compressedSize || body.length)), header.rawSize);
  } else {
    result = await inflate(body);
    if (header.compression === 'zlib2') result = await inflate(result);
  }
  if (result.length !== header.rawSize) throw new Error('セーブの解凍後の大きさが合いません');
  return result;
}

const label = (role, name) => ({
  level: 'Level.sav', meta: 'LevelMeta.sav', global: 'GlobalPalStorage.sav',
}[role] ?? `Players/${name}`);

/**
 * セーブ一式をスナップショットにする。
 * @param {{ path: string, bytes: Uint8Array }[]} files
 * @param {{ onProgress?: (message: string) => void }} [options]
 * @returns {Promise<object>} buildSnapshot の結果に files（読み込んだファイルの一覧）を足したもの
 */
export async function readWorldFiles(files, { onProgress = () => {} } = {}) {
  const input = { level: null, players: [], dps: [], globalStorage: null, meta: null };
  const used = [];
  const skipped = [];
  // 大きい Level.sav を先に読み、壊れていればすぐ止める
  const ordered = files.map((file) => ({ ...file, role: saveFileRole(file.path) }))
    .filter((file) => file.role)
    .sort((a, b) => (a.role === 'level' ? -1 : 0) - (b.role === 'level' ? -1 : 0));
  if (!ordered.some((file) => file.role === 'level')) throw new Error('Level.sav が見つかりません。ワールドのフォルダを選んでください');
  for (const file of ordered) {
    const name = String(file.path).replace(/\\/g, '/').split('/').at(-1);
    onProgress(`${label(file.role, name)} を読み込み中…`);
    let gvas;
    try {
      gvas = await decompressSav(file.bytes);
    } catch (error) {
      if (file.role === 'level') throw new Error(`Level.sav を読めませんでした（${error.message}）。ゲームの保存中だった場合は少し待ってからやり直してください`);
      skipped.push({ path: file.path, reason: error.message });
      continue;
    }
    const kind = detectSaveKind(gvas);
    try {
      if (file.role === 'level' && kind === 'level') input.level = parseLevel(gvas);
      else if (file.role === 'meta' && kind === 'levelMeta') input.meta = parseLevelMeta(gvas);
      else if (file.role === 'player' && kind === 'player') input.players.push(parsePlayer(gvas));
      else if (file.role === 'dps' && kind === 'dps') input.dps.push({ playerUid: playerUidFromFileName(name), data: parsePalStorage(gvas) });
      else if (file.role === 'global' && kind === 'global') input.globalStorage = parsePalStorage(gvas);
      else { skipped.push({ path: file.path, reason: `種類が違います（${kind}）` }); continue; }
    } catch (error) {
      if (file.role === 'level') throw new Error(`Level.sav を解析できませんでした（${error.message}）`);
      skipped.push({ path: file.path, reason: error.message });
      continue;
    }
    used.push(file.path);
  }
  if (!input.level) throw new Error('Level.sav を解析できませんでした');
  onProgress('所持パルを整理中…');
  const snapshot = buildSnapshot(input);
  return { ...snapshot, files: { used, skipped } };
}
