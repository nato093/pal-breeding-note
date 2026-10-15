// check-save の --probe（読み取りのみ。save-extras）: セーブにある項目と入れ物の中身を調べて出す。ふだんの読み込み（web/js/save/）は変えない。
// 出すもの（docs/ui-refactor/phase-3-4-drawer-data.md の save-extras の「実装の記録」に読み方を書いた）:
//   [1] 個体の SaveParameter の項目の有無（Level・パル次元ストレージ・グローバルパルボックスごとの数と値の例・分布）
//   [2] プレイ中の判定（ギルドのメンバーの最終ログインとワールドの通算の時間の差）とゲーム内の日数
//   [3] 場所が「不明」の個体の入れ物と、その入れ物を持つ MapObject（観賞用ケージなど）
//   [4] 配合牧場の ModuleMap とケーキ
//   [5] 孵化器（ConcreteModel・ModuleMap・中のタマゴ）と WorldOption.sav の孵化の設定
//   [6] インプラント（PalPassiveSkillChange_*）とパルリバーサー（PalGenderReverse）の入れ物の種類ごとの数（implants が使う）
//   [7] Players/*.sav の RecordData の PalCaptureCount・PaldeckUnlockFlag の件数（paldex が使う）
// プレイヤー名は手元の console にだけ出す（今の check-save と同じ）。ファイルには書かない。
import fs from 'node:fs';
import path from 'node:path';
import { readGvas, GvasReader, guidAt, ZERO_GUID } from '../web/js/save/gvas.js';
import { decompressSav } from '../web/js/save/import.js';
import { parseLevel, parsePalStorage, parsePlayer, playerUidFromFileName } from '../web/js/save/palworld.js';
import { createSpeciesResolver } from '../web/js/core/owned.js';
import pals from '../web/data/pals.js';

// 個体の SaveParameter で調べる項目（ふだん読む項目も、書かれているかを数えるために並べる）
export const PROBE_PAL_FIELDS = [
  'OwnedTime', 'IsFavoritePal', 'FavoriteIndex', 'bFavoriteChangedByFriendship', 'Rank_HP', 'Rank_Attack', 'Rank_Defence', 'Rank_CraftSpeed',
  'WorkerSick', 'HungerType', 'SanityValue', 'CraftSpeeds',
];
const WS = '.worldSaveData';
const MO = `${WS}.MapObjectSaveData.MapObjectSaveData`;
const ITEM_MODULE = 'EPalMapObjectConcreteModelModuleType::ItemContainer';
const short = (key) => String(key).replace('EPalMapObjectConcreteModelModuleType::', '');
const zero = (id) => (id === ZERO_GUID ? '' : id);
const count = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
const top = (map, n = 10) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, value]) => `${key}×${value}`).join(', ');
const show = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

async function loadGvas(file) {
  return decompressSav(new Uint8Array(fs.readFileSync(file)));
}

// MapObject の ID と所属拠点（rawdata/map_model.py。palworld.js の decodeMapModel と同じ並び）
function modelOf(raw) {
  try {
    const r = new GvasReader(raw);
    const instanceId = zero(r.guid());
    r.skipBytes(16);
    return { instanceId, baseId: zero(r.guid()) };
  } catch {
    return { instanceId: '', baseId: '' };
  }
}

// rawdata/item_container_slots.py（palworld.js の decodeItemSlot と同じ並び）
function itemSlot(raw) {
  const r = new GvasReader(raw);
  const slotIndex = r.i32();
  const amount = r.i32();
  return { slotIndex, count: amount, staticId: r.fstring() };
}

/** Level.sav を広く読む（MapObject の ModuleMap・アイテムの入れ物・ギルド保管庫・GameTimeSaveData・ギルド） */
function readLevelWide(gvas) {
  const want = new Set(['MapObjectSaveData', 'ItemContainerSaveData', 'GuildExtraSaveDataMap', 'CharacterContainerSaveData', 'GameTimeSaveData']);
  const { properties } = readGvas(gvas, {
    skip: (p, name, parent) => {
      if (parent === '') return name !== 'worldSaveData';
      if (parent === WS) return !want.has(name);
      if (parent === MO) return !['MapObjectId', 'Model', 'ConcreteModel'].includes(name);
      if (parent === `${MO}.Model`) return name !== 'RawData';
      return false;
    },
  });
  const ws = properties.worldSaveData ?? {};
  const mapObjects = (ws.MapObjectSaveData ?? []).map((mo) => ({
    id: String(mo.MapObjectId ?? ''),
    ...(mo.Model?.RawData instanceof Uint8Array ? modelOf(mo.Model.RawData) : { instanceId: '', baseId: '' }),
    concreteLength: mo.ConcreteModel?.RawData instanceof Uint8Array ? mo.ConcreteModel.RawData.length : 0,
    modules: (mo.ConcreteModel?.ModuleMap ?? []).map((m) => ({ key: short(m.key), raw: m.value?.RawData })),
  }));
  const containers = new Map();
  for (const e of ws.ItemContainerSaveData ?? []) {
    const slots = [];
    for (const s of e.value?.Slots ?? []) {
      if (!(s?.RawData instanceof Uint8Array) || !s.RawData.length) continue;
      try { slots.push(itemSlot(s.RawData)); } catch { /* 読めないスロットは数えない */ }
    }
    containers.set(e.key?.ID, slots);
  }
  const guildStorages = new Set();
  for (const e of ws.GuildExtraSaveDataMap ?? []) {
    try { guildStorages.add(guidAt(e.value.GuildItemStorage.RawData, 0)); } catch { /* 読めなければ数えない */ }
  }
  return { mapObjects, containers, guildStorages, characterContainers: new Map((ws.CharacterContainerSaveData ?? []).map((e) => [e.key?.ID, e.value])) };
}

/** Players/*.sav の RecordData の PalCaptureCount・PaldeckUnlockFlag（paldex。PLAYER_SKIP に足す項目の手がかり） */
function readRecord(gvas) {
  const { properties } = readGvas(gvas, {
    skip: (p, name, parent) => {
      if (parent === '') return name !== 'SaveData';
      if (parent === '.SaveData') return name !== 'RecordData';
      if (parent === '.SaveData.RecordData') return !['PalCaptureCount', 'PaldeckUnlockFlag'].includes(name);
      return false;
    },
  });
  return properties.SaveData?.RecordData ?? {};
}

/**
 * @param {string} worldDir ワールドのフォルダ
 * @param {{ snapshot: object, files: { path: string, bytes: Uint8Array }[], log?: (line: string) => void }} input check-save が読んだスナップショットとファイル
 */
export async function probeWorld(worldDir, { snapshot, files, log = console.log }) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const levelGvas = await decompressSav(byPath.get('Level.sav').bytes);
  const resolve = createSpeciesResolver(pals);
  const playerName = (uid) => snapshot.players.find((player) => player.uid === uid)?.name || `（${String(uid).slice(0, 8)}）`;

  // [1] 個体の項目
  const level = parseLevel(levelGvas, { extraPalFields: PROBE_PAL_FIELDS });
  // 入れ物の種類ごと（level・dps〔プレイヤーごとのファイルを合わせる〕・global）
  const bySource = new Map([['level', level.pals], ['dps', []], ['global', []]]);
  for (const file of files) {
    const name = file.path.split('/').at(-1);
    if (!/_dps\.sav$/i.test(name) && !/^GlobalPalStorage\.sav$/i.test(name)) continue;
    try {
      const data = parsePalStorage(await decompressSav(file.bytes), { extraPalFields: PROBE_PAL_FIELDS });
      bySource.get(data.kind === 'global' ? 'global' : 'dps').push(...data.pals);
    } catch (error) {
      log(`  ${file.path} を読めませんでした（${error.message}）`);
    }
  }
  const sources = [...bySource];
  log('\n[1] 個体の SaveParameter の項目（ある個体の数 / 個体の数。値の例は 3 件、分布は多い順）');
  for (const field of PROBE_PAL_FIELDS) {
    const parts = [];
    const examples = [];
    const values = new Map();
    for (const [source, list] of sources) {
      const present = list.filter((pal) => pal.probe && pal.probe[field] !== undefined);
      parts.push(`${source} ${present.length}/${list.length}`);
      for (const pal of present) {
        if (examples.length < 3) examples.push(show(pal.probe[field]));
        if (typeof pal.probe[field] !== 'object') count(values, show(pal.probe[field]));
      }
    }
    log(`  ${field}: ${parts.join('・')}${examples.length ? ` / 例 ${examples.join(' | ')}` : ''}${values.size && values.size <= 30 ? ` / 分布 ${top(values, 8)}` : ''}`);
  }

  // [2] プレイ中と Day
  log('\n[2] プレイ中（ギルドの最終ログインとワールドの通算の時間 RealDateTimeTicks の差。10 秒以内ならプレイ中）とゲーム内の日数');
  const real = Number(level.realDateTimeTicks);
  log(`  RealDateTimeTicks ${level.realDateTimeTicks ?? 'なし'}・GameDateTimeTicks ${level.gameDateTimeTicks ?? 'なし'}（÷ 864e9 = ${Number.isFinite(Number(level.gameDateTimeTicks)) ? (Number(level.gameDateTimeTicks) / 864e9).toFixed(3) : '-'}）・スナップショットの Day ${snapshot.world.inGameDay}`);
  for (const guild of level.guilds) {
    for (const member of guild.players) {
      const diff = (real - Number(member.lastOnlineTicks)) / 1e7;
      const player = snapshot.players.find((item) => item.uid === member.uid);
      log(`  ${playerName(member.uid)}: 差 ${Number.isFinite(diff) ? `${diff.toFixed(2)} 秒` : '読めない'} → online ${player?.online ?? '-'}・Lv ${player?.level ?? '-'}`);
    }
  }

  const wide = readLevelWide(levelGvas);
  const ownerOf = new Map();
  for (const mo of wide.mapObjects) {
    for (const module of mo.modules) if (module.raw instanceof Uint8Array && module.raw.length >= 16) ownerOf.set(guidAt(module.raw, 0), { mo, module: module.key });
  }

  // [3] 場所が不明の個体
  const unknown = snapshot.pals.filter((pal) => pal.location.kind === 'unknown');
  log(`\n[3] 場所が「不明」の個体 ${unknown.length} 体（観賞用ケージ display は ${snapshot.stats.byKind?.display ?? 0} 体）`);
  const unknownBy = new Map();
  for (const pal of unknown) {
    const owner = pal.location.containerId ? ownerOf.get(pal.location.containerId) : null;
    count(unknownBy, owner ? `${owner.mo.id}（${owner.module}・拠点${owner.mo.baseId ? 'あり' : 'なし'}）` : pal.location.containerId ? '持ち主の分からない入れ物' : '入れ物なし');
  }
  if (unknownBy.size) log(`  入れ物の持ち主: ${top(unknownBy)}`);
  const cages = wide.mapObjects.filter((mo) => /^DisplayCharacter/i.test(mo.id));
  if (cages.length) log(`  DisplayCharacter ${cages.length} 個（拠点あり ${cages.filter((mo) => mo.baseId).length}）・ModuleMap ${[...new Set(cages.flatMap((mo) => mo.modules.map((m) => m.key)))].join(', ')}`);

  // [4] 配合牧場
  const farms = wide.mapObjects.filter((mo) => mo.id.toLowerCase() === 'breedfarm');
  log(`\n[4] 配合牧場 ${farms.length} か所（ModuleMap のキーとケーキ。[] はケーキ切れ・null は入れ物が読めない）`);
  farms.forEach((farm, index) => {
    const cakes = snapshot.breedFarms.find((item) => item.id === farm.instanceId)?.cakes;
    log(`  牧場${index + 1}: ModuleMap ${farm.modules.map((m) => `${m.key}(${m.raw?.length ?? '-'})`).join(', ') || 'なし'} / ケーキ ${cakes ? (cakes.length ? cakes.map((cake) => `${cake.itemId}×${cake.count}`).join(', ') : '[]（ケーキ切れ）') : 'null'}`);
  });

  // [5] 孵化器
  const incubators = wide.mapObjects.filter((mo) => /hatchingpalegg/i.test(mo.id));
  log(`\n[5] 孵化器 ${incubators.length} 個（MapObjectId・ConcreteModel.RawData の長さ・中のタマゴ）`);
  const shapes = new Map();
  let withEggs = 0;
  for (const mo of incubators) {
    const item = mo.modules.find((m) => m.key === 'ItemContainer');
    const slots = item?.raw instanceof Uint8Array ? wide.containers.get(guidAt(item.raw, 0)) ?? [] : [];
    const eggs = slots.filter((slot) => slot.count > 0).length;
    if (eggs) withEggs++;
    count(shapes, `${mo.id} RawData ${mo.concreteLength} B${eggs ? `・タマゴ ${eggs}` : ''}`);
  }
  if (shapes.size) log(`  ${top(shapes, 20)}`);
  log(`  タマゴの入った孵化器 ${withEggs} 個。残り時間は RawData にも作業（WorkSaveData）にも減っていく値が見つからない（2026-10-15 の調査。docs/SAVE_FORMAT.md）`);
  const optionFile = path.join(worldDir, 'WorldOption.sav');
  if (fs.existsSync(optionFile)) {
    try {
      const { properties } = readGvas(await loadGvas(optionFile));
      const flat = (object, prefix = '') => Object.entries(object ?? {}).flatMap(([key, value]) => (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)
        ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]));
      const hatch = flat(properties).filter(([key]) => /hatch|egg/i.test(key));
      log(`  WorldOption.sav: ${hatch.map(([key, value]) => `${key.split('.').at(-1)} = ${show(value)}`).join('・') || '孵化の設定なし（既定）'}`);
    } catch (error) {
      log(`  WorldOption.sav を読めませんでした（${error.message}）`);
    }
  } else log('  WorldOption.sav なし（既定の設定）');

  // [6] インプラントとパルリバーサーの入れ物
  const playerInventories = new Map();
  for (const file of files) {
    if (!/^Players\/[0-9a-f]{32}\.sav$/i.test(file.path)) continue;
    try {
      const player = parsePlayer(await decompressSav(file.bytes));
      for (const [kind, id] of Object.entries(player.inventoryContainers)) playerInventories.set(id, { kind, uid: player.uid });
    } catch { /* 読めないプレイヤーのファイルは数えない */ }
  }
  const farmContainers = new Set(farms.flatMap((farm) => farm.modules.filter((m) => m.key === 'ItemContainer' && m.raw instanceof Uint8Array).map((m) => guidAt(m.raw, 0))));
  const category = (id) => {
    if (wide.guildStorages.has(id)) return 'ギルド保管庫';
    if (playerInventories.has(id)) return `所持品（${playerInventories.get(id).kind}）`;
    if (farmContainers.has(id)) return '配合牧場';
    const owner = ownerOf.get(id);
    if (owner) return owner.mo.baseId ? `拠点の ${owner.mo.id}` : `拠点の外の ${owner.mo.id}（宝箱など）`;
    return 'どこにもない入れ物';
  };
  const isTarget = (staticId) => /^PalPassiveSkillChange_/i.test(staticId) || /^PalGenderReverse/i.test(staticId);
  const byCategory = new Map();
  const byItem = new Map();
  for (const [id, slots] of wide.containers) {
    for (const slot of slots) {
      if (!isTarget(slot.staticId) || slot.count <= 0) continue;
      count(byCategory, category(id), slot.count);
      count(byItem, slot.staticId, slot.count);
    }
  }
  log(`\n[6] インプラント（PalPassiveSkillChange_*）・パルリバーサー（PalGenderReverse）: ${[...byItem.values()].reduce((a, b) => a + b, 0)} 個・${byItem.size} 種`);
  if (byCategory.size) log(`  入れ物の種類ごと: ${top(byCategory, 20)}`);
  if (byItem.size) log(`  アイテムごと（多い順 10 種）: ${top(byItem)}`);

  // [7] RecordData
  log('\n[7] Players/*.sav の RecordData（捕獲数 PalCaptureCount・図鑑の登録 PaldeckUnlockFlag）');
  for (const file of files) {
    if (!/^Players\/[0-9a-f]{32}\.sav$/i.test(file.path)) continue;
    try {
      const record = readRecord(await decompressSav(file.bytes));
      const uid = playerUidFromFileName(file.path);
      const line = (key) => {
        const list = Array.isArray(record[key]) ? record[key] : null;
        if (!list) return `${key} なし`;
        const known = list.filter((entry) => resolve(entry.key).palId).length;
        const total = list.reduce((sum, entry) => sum + (typeof entry.value === 'number' ? entry.value : 0), 0);
        return `${key} ${list.length} 件（pals.js で引ける ${known}${total ? `・合計 ${total}` : ''}）`;
      };
      log(`  ${playerName(uid)}: ${line('PalCaptureCount')}・${line('PaldeckUnlockFlag')}`);
    } catch (error) {
      log(`  ${file.path} を読めませんでした（${error.message}）`);
    }
  }
}
