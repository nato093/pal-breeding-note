// 手元のセーブで、所持パルの読み込みを確かめる（読み取りのみ）。
// 使い方: npm run check:save -- "<ワールドのフォルダ>" [--probe]
//   例: %LOCALAPPDATA%\Pal\Saved\SaveGames\<SteamID>\<ワールドID>
// フォルダを省略すると、既定のセーブ場所から一番新しいワールドを使う。--probe は、セーブにある項目と入れ物の中身を調べて足して出す
//（scripts/save-probe.mjs。読み方は docs/ui-refactor/phase-3-4-drawer-data.md の save-extras の「実装の記録」）
import fs from 'node:fs';
import path from 'node:path';
import { readWorldFiles, saveFileRole } from '../web/js/save/import.js';
import { normalizeOwned, placeGroupLabel, PLACE_ORDER, createSpeciesResolver } from '../web/js/core/owned.js';
import { decodeBreeding, breedChild } from '../web/js/core/breeding.js';
import breeding from '../web/data/breeding.js';
import pals from '../web/data/pals.js';
import passives from '../web/data/passives.js';
import { defaultSaveRoot, findWorlds } from './save-worlds.mjs';
import { probeWorld } from './save-probe.mjs';

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
  const args = process.argv.slice(2);
  const probe = args.includes('--probe');
  let worldDir = args.find((arg) => arg !== '--probe');
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
  // プレイ中（この保存の時点で接続していた。save-extras）とゲーム内の日数
  console.log(`プレイヤー: ${owned.players.map((p) => `${p.name}（Lv${p.level}${p.online === true ? '・プレイ中' : ''}）`).join(', ')}`);
  console.log(`ゲーム内: ${owned.world.inGameDay ?? '不明'} 日目`);
  // 捕獲数（paldex。Players/<uid>.sav の RecordData の PalCaptureCount。画面は自分のプレイヤーの分だけを図鑑とパル詳細に出す）。
  // 種は画面で引けたパルの数、引けないキーは人間などマスターにないキー（画面では捨てる）
  const resolveCapture = createSpeciesResolver(pals);
  console.log(`捕獲数: ${owned.players.map((player) => {
    const raw = snapshot.players.find((item) => item.uid === player.uid)?.captures;
    if (!player.captures || !Array.isArray(raw)) return `${player.name}（なし）`;
    const counts = Object.values(player.captures);
    const unknown = raw.filter((entry) => !resolveCapture(entry.id).palId).map((entry) => entry.id);
    return `${player.name} ${counts.length} 種・合計 ${counts.reduce((sum, count) => sum + count, 0)}${unknown.length ? `（引けないキー ${unknown.length}: ${unknown.slice(0, 4).join(', ')}）` : ''}`;
  }).join(', ') || 'プレイヤーなし'}`);
  console.log(`パル（タマゴ含む）: ${owned.pals.length} 体`);
  for (const group of PLACE_ORDER) {
    const list = owned.pals.filter((p) => p.placeGroup === group);
    if (!list.length) continue;
    const byHolder = new Map();
    for (const p of list) byHolder.set(p.holder, (byHolder.get(p.holder) ?? 0) + 1);
    console.log(`  ${placeGroupLabel(group)}: ${list.length}（${[...byHolder].map(([k, v]) => `${k} ${v}`).join(' / ')}）`);
  }
  // パル次元ストレージの読み漏れ（dps-missing。Level.sav の InLockerCharacterInstanceIDArray の個体のうち、読めた _dps.sav にない数）
  console.log(`次元ストレージ: Level.sav ${snapshot.stats.inLocker} 体・読めていない ${snapshot.stats.inLockerMissing} 体`);
  const unknown = owned.pals.filter((p) => !p.known);
  console.log(`マスターにないキャラクター: ${unknown.length} 体${unknown.length ? `（${[...new Set(unknown.map((p) => p.characterId))].slice(0, 8).join(', ')} など）` : ''}`);
  const names = new Set(passives.map((p) => p.id));
  const missing = [...new Set(owned.pals.flatMap((p) => p.passives).filter((id) => !names.has(id)))];
  console.log(`名前のないパッシブ: ${missing.length} 種${missing.length ? `（${missing.join(', ')}）` : ''}`);
  console.log(`対象外: ${JSON.stringify(snapshot.stats.orphanEggs ?? 0)} 個の参照されていないタマゴ`);
  // 配合牧場（自動登録の照合に使う）。親 2 体から配合表で求めた子と、産んだタマゴの中身を並べる
  const table = decodeBreeding(breeding);
  const species = createSpeciesResolver(pals);
  const playerName = (uid) => owned.players.find((p) => p.uid === uid)?.name || uid.slice(0, 8) || '不明';
  const sign = { Male: '♂', Female: '♀' };
  const short = { Male: 'M', Female: 'F' };
  console.log(`配合牧場: ${snapshot.breedFarms.length} か所`);
  for (const farm of snapshot.breedFarms) {
    if (!farm.parents.length && !farm.eggs.length) continue;
    const parents = farm.parents.map((p) => `${p.characterId}${sign[p.gender] ?? ''}（預けた人 ${playerName(p.depositorUid)}）`).join(' × ') || '親なし';
    const [a, b] = farm.parents;
    const expected = farm.parents.length === 2 ? breedChild(table, species(a.characterId).palId, short[a.gender], species(b.characterId).palId, short[b.gender]) || '不明' : '-';
    const eggs = farm.eggs.map((e) => `${e.characterId}${/^PalEgg_MutationPal/i.test(e.itemId ?? '') ? '（突然変異）' : ''}`).join(', ') || 'なし';
    console.log(`  ${farm.status === 'ok' ? '' : '[読めない] '}${parents} → 表の子 ${expected} / タマゴ ${eggs}`);
  }
  // 画面用の形（正規化の後。farm-data）の牧場ごとのタマゴの数と突然変異の数（共有では 1 牧場 20 個までの中身と数を送る）
  const farms = owned.farms ?? [];
  const eggTotal = farms.reduce((sum, farm) => sum + farm.eggCount, 0);
  const mutants = farms.reduce((sum, farm) => sum + farm.eggs.filter((egg) => egg.mutant).length, 0);
  console.log(`画面用の牧場: ${farms.length} か所（読めない ${farms.filter((farm) => farm.status === 'uncertain').length}）・タマゴ ${eggTotal} 個（突然変異 ${mutants} 個・中身の分からない ${farms.reduce((sum, farm) => sum + farm.eggs.filter((egg) => !egg.palId).length, 0)} 個）`);
  for (const farm of farms) if (farm.eggCount) console.log(`  ${farm.id.slice(0, 8)}: タマゴ ${farm.eggCount} 個${farm.eggs.some((egg) => egg.mutant) ? `（突然変異 ${farm.eggs.filter((egg) => egg.mutant).length}）` : ''}`);
  // 牧場のケーキ（save-extras。[] はケーキ切れ、null は分からない）
  console.log(`牧場のケーキ: ${farms.map((farm) => (Array.isArray(farm.cakes) ? (farm.cakes.map((cake) => `${cake.itemId}×${cake.count}`).join('+') || 'ケーキ切れ') : '不明')).join(' / ') || 'なし'}`);
  // アイテムの在庫（implants。拠点の箱・ギルド保管庫・所持品などを合わせた数。拠点の外の宝箱は数えない）
  const stock = Object.entries(owned.items ?? {});
  const reverser = stock.find(([itemId]) => /^PalGenderReverse$/i.test(itemId))?.[1].total ?? 0;
  console.log(`アイテムの在庫（インプラント・パルリバーサー。拠点の外の宝箱は数えない）: ${stock.reduce((sum, [, item]) => sum + item.total, 0)} 個・${stock.length} 種（うちパルリバーサー ${reverser} 個）`);
  if (probe) await probeWorld(worldDir, { snapshot, files });
}

main().catch((error) => { console.error(error.message); process.exit(1); });
