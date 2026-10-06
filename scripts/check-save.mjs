// 手元のセーブで、所持パルの読み込みを確かめる（読み取りのみ）。
// 使い方: npm run check:save -- "<ワールドのフォルダ>"
//   例: %LOCALAPPDATA%\Pal\Saved\SaveGames\<SteamID>\<ワールドID>
// フォルダを省略すると、既定のセーブ場所から一番新しいワールドを使う。
import fs from 'node:fs';
import path from 'node:path';
import { readWorldFiles, saveFileRole } from '../web/js/save/import.js';
import { normalizeOwned, placeGroupLabel, PLACE_ORDER } from '../web/js/core/owned.js';
import pals from '../web/data/pals.js';
import passives from '../web/data/passives.js';
import { defaultSaveRoot, findWorlds } from './save-worlds.mjs';

function collect(worldDir) {
  const files = [];
  const add = (full, rel) => { if (fs.statSync(full).isFile() && saveFileRole(rel)) files.push({ path: rel, bytes: new Uint8Array(fs.readFileSync(full)) }); };
  for (const name of fs.readdirSync(worldDir)) add(path.join(worldDir, name), name);
  const players = path.join(worldDir, 'Players');
  if (fs.existsSync(players)) for (const name of fs.readdirSync(players)) add(path.join(players, name), `Players/${name}`);
  const global = path.join(worldDir, '..', 'GlobalPalStorage.sav');
  if (fs.existsSync(global)) add(global, '../GlobalPalStorage.sav');
  return files;
}

async function main() {
  let worldDir = process.argv[2];
  if (!worldDir) {
    const root = defaultSaveRoot();
    const latest = findWorlds(root).find((world) => world.role === 'host');
    if (!latest) throw new Error(`ホストのワールド（Level.sav）が見つかりません: ${root}`);
    worldDir = path.join(root, ...latest.dir.split('/'));
  }
  console.log(`ワールド: ${worldDir}`);
  const files = collect(worldDir);
  const started = performance.now();
  const snapshot = await readWorldFiles(files);
  const ms = Math.round(performance.now() - started);
  const owned = normalizeOwned(snapshot, { pals, passives });
  // Level.sav の Timestamp は PC のローカル時刻なので、更新日時はファイルの日時を使う
  const savedAt = fs.statSync(path.join(worldDir, 'Level.sav')).mtime.toLocaleString('ja-JP');
  console.log(`ワールド名: ${owned.world.name || '（なし）'} / Level.sav の更新: ${savedAt} / 解析 ${ms} ms`);
  console.log(`読み込んだファイル: ${snapshot.files.used.length} 件${snapshot.files.skipped.length ? `、読めなかったファイル: ${snapshot.files.skipped.map((f) => `${f.path}（${f.reason}）`).join(', ')}` : ''}`);
  console.log(`プレイヤー: ${owned.players.map((p) => `${p.name}（Lv${p.level}）`).join(', ')}`);
  console.log(`パル（タマゴ含む）: ${owned.pals.length} 体`);
  for (const group of PLACE_ORDER) {
    const list = owned.pals.filter((p) => p.placeGroup === group);
    if (!list.length) continue;
    const byHolder = new Map();
    for (const p of list) byHolder.set(p.holder, (byHolder.get(p.holder) ?? 0) + 1);
    console.log(`  ${placeGroupLabel(group)}: ${list.length}（${[...byHolder].map(([k, v]) => `${k} ${v}`).join(' / ')}）`);
  }
  const unknown = owned.pals.filter((p) => !p.known);
  console.log(`マスターにないキャラクター: ${unknown.length} 体${unknown.length ? `（${[...new Set(unknown.map((p) => p.characterId))].slice(0, 8).join(', ')} など）` : ''}`);
  const names = new Set(passives.map((p) => p.id));
  const missing = [...new Set(owned.pals.flatMap((p) => p.passives).filter((id) => !names.has(id)))];
  console.log(`名前のないパッシブ: ${missing.length} 種${missing.length ? `（${missing.join(', ')}）` : ''}`);
  console.log(`対象外: ${JSON.stringify(snapshot.stats.orphanEggs ?? 0)} 個の参照されていないタマゴ`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
