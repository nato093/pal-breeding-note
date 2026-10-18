// アイテムの在庫（UI 改善フェーズ 4 の implants）: インプラントとパルリバーサーを入れ物ごとに数え、拠点の箱・ギルド保管庫・所持品などだけを
// 合わせる（拠点の外の宝箱は数えない）。タマゴの場所の判定は変えない（同じ入れ物にタマゴがあっても）。
// 合成バイト列だけを使う（実セーブのバイトは含めない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZERO_GUID } from '../../web/js/save/gvas.js';
import { parseLevel, parsePlayer, buildSnapshot } from '../../web/js/save/palworld.js';
import { normalizeOwned, ownedFromShared, itemStock, stockText, sharedExtras } from '../../web/js/core/owned.js';
import { OWNED_FIELDS, OWNED_ITEMS_MAX, OWNED_EXTRAS_MAX_CHARS, validateOwnedUpload, ownedExtrasText } from '../../web/js/core/owned-shared.js';
import { cleanOwnedWorlds } from '../../web/js/core/boundary.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { ByteWriter, GvasWriter, gvasWithHeader, finishGvas } from '../helpers/gvas-writer.js';

const id = (n) => `${String(n).padStart(8, '0')}-0000-0000-0000-00000000dddd`;
const P1 = '00000000-0000-0000-0000-000000000001';
const [BASE1, GUILD] = [id(31), id(33)];
const [IC_CHEST, IC_TREASURE, IC_FARM, IC_RECYCLER, IC_GUILD, IC_COMMON, IC_ESSENTIAL, IC_NOWHERE] = [id(41), id(42), id(43), id(44), id(45), id(46), id(47), id(48)];
const [EGG_CHEST, EGG_TREASURE, EGG_COMMON] = [id(201), id(202), id(203)];
const SPEED = 'PalPassiveSkillChange_Consumable_MoveSpeed_up_3';
const NOUKIN = 'PalPassiveSkillChange_Noukin';
const REVERSER = 'PalGenderReverse';

const transform = (w) => w.f64(0).f64(0).f64(0).f64(1).f64(0).f64(0).f64(0).f64(1).f64(1).f64(1);
const sp = (fill) => (s) => s.structProps('SaveParameter', 'PalIndividualCharacterSaveParameter', fill);
const charBlob = (fill) => {
  const w = new GvasWriter();
  sp(fill)(w);
  return w.none().u32(0).guid(ZERO_GUID).u32(0).toBytes();
};
const modelBlob = (baseId, instanceId = ZERO_GUID, concreteId = ZERO_GUID) => {
  const w = new ByteWriter().guid(instanceId).guid(concreteId).guid(baseId).guid(ZERO_GUID).i32(1).i32(1);
  transform(w);
  return w.guid(ZERO_GUID).guid(ZERO_GUID).guid(ZERO_GUID).guid(P1).u8(0).f32(0).guid(ZERO_GUID).u32(0).toBytes();
};
// 配合牧場の ConcreteModel（save-extras.test.js と同じ形）
const farmBlob = (concreteId, modelId) => new ByteWriter().guid(concreteId).guid(modelId).u32(0).u32(0).f32(300).u32(2).toBytes();
const moduleBlob = (containerId) => new ByteWriter().guid(containerId).u32(0).u32(0).u32(0).u8(0).u32(0).toBytes();
const itemSlot = (index, staticId, count, local = ZERO_GUID) => new ByteWriter().i32(index).i32(count).fstring(staticId).guid(ZERO_GUID).guid(local).u32(0).toBytes();
const eggBlob = (local, staticId, characterId) => {
  const w = new GvasWriter().guid(ZERO_GUID).guid(local).fstring(staticId).u32(0).fstring('X');
  sp((s) => s.name('CharacterID', characterId))(w);
  return w.none().bytes(new Uint8Array(28)).toBytes();
};
// ギルド（拠点 1 を持つ。メンバーは Alice）
const guildBlob = () => new ByteWriter().guid(GUILD).fstring('').u32(0).u8(1).u32(0)
  .u32(1).guid(BASE1).i32(0).i32(5).u32(0).fstring('ギルド').guid(ZERO_GUID).u32(0)
  .u32(0).i32(0).guid(P1).u32(1).guid(P1).i64(0).fstring('Alice').u8(1).u32(0).u32(0).toBytes();

/**
 * implants が false なら、在庫のアイテムを入れない同じワールド（タマゴの場所の判定が変わらないことを比べる）
 * 入れ物: 拠点の箱（タマゴ・神速 3＋2・パルリバーサー 1・木材 10・0 個の神速）、拠点の外の宝箱（タマゴ・パルリバーサー 85）、拠点の配合牧場（ケーキ・脳筋 1）、
 * 拠点の設備（パルリバーサー 8）、ギルド保管庫（パルリバーサー 3）、Alice の所持品（Common: タマゴ・神速 1、Essential: 脳筋 1）、
 * どこにもない入れ物（脳筋 4）
 */
function level({ implants = true } = {}) {
  const lv = gvasWithHeader({ className: '/Script/Pal.PalWorldSaveGame' });
  lv.structProps('worldSaveData', 'PalWorldSaveData', (ws) => {
    ws.map('CharacterSaveParameterMap', 'StructProperty', 'StructProperty', [[[P1, id(101)], charBlob((s) => s.bool('IsPlayer', true).str('NickName', 'Alice').byte('Level', 52))]],
      (k, [p, i]) => k.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(p)).nativeStruct('InstanceId', 'Guid', (x) => x.guid(i)).str('DebugName', '').none(),
      (v, b) => v.byteArray('RawData', b).none());
    const baseBlob = () => {
      const w = new ByteWriter().guid(BASE1).fstring('tmpl').u8(1);
      transform(w);
      w.f32(3500).guid(GUILD);
      transform(w);
      return w.guid(ZERO_GUID).u32(0).toBytes();
    };
    const wdBlob = () => {
      const w = new ByteWriter().guid(ZERO_GUID);
      transform(w);
      return w.u8(0).u8(0).guid(id(12)).u32(0).toBytes();
    };
    ws.map('BaseCampSaveData', 'StructProperty', 'StructProperty', [[BASE1, 0]], (k, b) => k.guid(b),
      (v) => v.byteArray('RawData', baseBlob()).structProps('WorkerDirector', 'PalBaseCampSaveData_WorkerDirector', (s) => s.byteArray('RawData', wdBlob())).none());
    ws.map('GroupSaveDataMap', 'StructProperty', 'StructProperty', [[GUILD, guildBlob()]], (k, g) => k.guid(g),
      (v, b) => v.enumProp('GroupType', 'EPalGroupType', 'EPalGroupType::Guild').byteArray('RawData', b).none());
    ws.map('GuildExtraSaveDataMap', 'StructProperty', 'StructProperty', [[GUILD, IC_GUILD]], (k, g) => k.guid(g),
      (v, c) => v.structProps('GuildItemStorage', 'PalGuildItemStorageSaveData', (s) => s.byteArray('RawData', new ByteWriter().guid(c).u32(0).toBytes())).none());
    const only = (list) => (implants ? list : list.filter(([item]) => !/^PalPassiveSkillChange_|^PalGenderReverse$/.test(item)));
    const containers = [
      [IC_CHEST, only([['PalEgg_Fire_01', 1, EGG_CHEST], [SPEED, 3], [REVERSER, 1], ['Wood', 10], [SPEED, 2], [SPEED, 0]])],
      [IC_TREASURE, only([['PalEgg_Dark_02', 1, EGG_TREASURE], [REVERSER, 85]])],
      [IC_FARM, only([['Cake02', 5], [NOUKIN, 1]])],
      [IC_RECYCLER, only([[REVERSER, 8]])],
      [IC_GUILD, only([[REVERSER, 3]])],
      [IC_COMMON, only([['PalEgg_Ice_05', 1, EGG_COMMON], [SPEED, 1]])],
      [IC_ESSENTIAL, only([[NOUKIN, 1]])],
      [IC_NOWHERE, only([[NOUKIN, 4]])],
    ];
    ws.map('ItemContainerSaveData', 'StructProperty', 'StructProperty', containers,
      (k, c) => k.nativeStruct('ID', 'Guid', (x) => x.guid(c)).none(),
      (v, slots) => v.structArray('Slots', 'PalItemSlotSaveData', slots.map((slot, i) => [i, ...slot]),
        (e, [i, item, count, local]) => e.byteArray('RawData', itemSlot(i, item, count, local)).none()).none());
    ws.structArray('DynamicItemSaveData', 'PalDynamicItemSaveData', [
      eggBlob(EGG_CHEST, 'PalEgg_Fire_01', 'FoxMage'), eggBlob(EGG_TREASURE, 'PalEgg_Dark_02', 'Werewolf'), eggBlob(EGG_COMMON, 'PalEgg_Ice_05', 'IceFox'),
    ], (e, b) => e.byteArray('RawData', b).none());
    const mapObjects = [
      ['ItemChest_04', modelBlob(BASE1), new Uint8Array(0), IC_CHEST],
      ['TreasureBox_FishingJunk_01', modelBlob(ZERO_GUID), new Uint8Array(0), IC_TREASURE],
      ['BreedFarm', modelBlob(BASE1, id(301), id(302)), farmBlob(id(302), id(301)), IC_FARM],
      ['AncientRelicRecycler', modelBlob(BASE1), new Uint8Array(0), IC_RECYCLER],
    ];
    ws.structArray('MapObjectSaveData', 'PalMapObjectSaveData', mapObjects, (e, [mid, model, concrete, container]) => {
      e.name('MapObjectId', mid)
        .structProps('Model', 'PalMapObjectModelSaveData', (s) => s.byteArray('RawData', model))
        .structProps('ConcreteModel', 'PalMapObjectConcreteModelSaveData', (s) => {
          s.byteArray('RawData', concrete);
          s.map('ModuleMap', 'EnumProperty', 'StructProperty', [['EPalMapObjectConcreteModelModuleType::ItemContainer', container]],
            (k, n) => k.fstring(n), (v, c) => v.byteArray('RawData', moduleBlob(c)).none());
        })
        .none();
    });
  });
  return finishGvas(lv);
}

function player() {
  const pw = gvasWithHeader({ className: '/Script/Pal.PalWorldPlayerSaveGame' });
  const cont = (s, name, c) => s.structProps(name, 'PalContainerId', (t) => t.nativeStruct('ID', 'Guid', (x) => x.guid(c)));
  pw.structProps('SaveData', 'PalWorldPlayerSaveData', (s) => {
    s.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(P1));
    s.structProps('InventoryInfo', 'PalPlayerDataInventoryInfo', (t) => {
      cont(t, 'CommonContainerId', IC_COMMON);
      cont(t, 'EssentialContainerId', IC_ESSENTIAL);
    });
  });
  return parsePlayer(finishGvas(pw));
}

test('在庫: インプラントとパルリバーサーを入れ物ごとに数え、拠点の中の入れ物・ギルド保管庫・所持品だけを合わせる（拠点の外の宝箱・どこにもない入れ物は数えない）', () => {
  const lv = parseLevel(level());
  assert.deepEqual(lv.malformed, {});
  // 入れ物ごとの数（同じアイテムは合わせる。0 個・ほかのアイテムは数えない）
  const counted = Object.fromEntries(lv.itemCounts.map((entry) => [entry.containerId, entry.items]));
  assert.deepEqual(counted[IC_CHEST], [{ itemId: SPEED, count: 5 }, { itemId: REVERSER, count: 1 }]);
  assert.deepEqual(counted[IC_TREASURE], [{ itemId: REVERSER, count: 85 }]);
  assert.deepEqual(counted[IC_NOWHERE], [{ itemId: NOUKIN, count: 4 }]);
  // 在庫の持ち主（マップオブジェクトと拠点）は、タマゴの持ち主と別に持つ
  assert.deepEqual(lv.itemOwners, {
    [IC_CHEST]: { mapObjectId: 'ItemChest_04', baseCampId: BASE1 },
    [IC_TREASURE]: { mapObjectId: 'TreasureBox_FishingJunk_01', baseCampId: '' },
    [IC_FARM]: { mapObjectId: 'BreedFarm', baseCampId: BASE1 },
    [IC_RECYCLER]: { mapObjectId: 'AncientRelicRecycler', baseCampId: BASE1 },
  });
  assert.deepEqual(Object.keys(lv.containerOwners).sort(), [IC_CHEST, IC_TREASURE].sort());
  const snap = buildSnapshot({ level: lv, players: [player()] });
  const sorted = (list) => [...list].sort((a, b) => `${a.itemId}${a.where}${a.object}`.localeCompare(`${b.itemId}${b.where}${b.object}`));
  assert.deepEqual(sorted(snap.items), sorted([
    { itemId: SPEED, count: 5, where: 'base', id: BASE1, object: 'chest' },
    { itemId: REVERSER, count: 1, where: 'base', id: BASE1, object: 'chest' },
    { itemId: NOUKIN, count: 1, where: 'base', id: BASE1, object: 'farm' },
    { itemId: REVERSER, count: 8, where: 'base', id: BASE1, object: 'other' },
    { itemId: REVERSER, count: 3, where: 'guild', id: GUILD, object: '' },
    { itemId: SPEED, count: 1, where: 'player', id: P1, object: '' },
    { itemId: NOUKIN, count: 1, where: 'player', id: P1, object: '' },
  ]));
  assert.doesNotThrow(() => structuredClone(lv));
  assert.doesNotThrow(() => structuredClone(snap));
});

test('在庫: タマゴの場所の判定は変わらない（在庫を数えた入れ物にタマゴがあっても・在庫のアイテムのないワールドと同じ）', () => {
  const withItems = buildSnapshot({ level: parseLevel(level()), players: [player()] });
  const without = buildSnapshot({ level: parseLevel(level({ implants: false })), players: [player()] });
  assert.deepEqual(withItems.pals, without.pals);
  assert.deepEqual(withItems.stats, without.stats);
  assert.deepEqual(withItems.breedFarms, without.breedFarms);
  const byChar = Object.fromEntries(withItems.pals.map((p) => [p.characterId, p.location]));
  assert.deepEqual([byChar.FoxMage.kind, byChar.FoxMage.baseId, byChar.FoxMage.mapObjectId, byChar.FoxMage.containerId], ['egg-chest', BASE1, 'ItemChest_04', IC_CHEST]);
  assert.deepEqual([byChar.Werewolf.kind, byChar.Werewolf.baseId, byChar.Werewolf.mapObjectId], ['egg-chest', '', 'TreasureBox_FishingJunk_01']);
  assert.deepEqual([byChar.IceFox.kind, byChar.IceFox.playerUid], ['egg-inventory', P1]);
  // 在庫のアイテムのないワールドの在庫は空（分からないではない）
  assert.deepEqual(without.items, []);
});

test('在庫（画面）: アイテムごとの合計と、数の多い場所 3 つまで（「拠点 1 の箱」「ギルド保管庫」「Alice の所持品」）。itemStock と在庫の文', () => {
  const owned = normalizeOwned(buildSnapshot({ level: parseLevel(level()), players: [player()] }), { pals, passives });
  assert.deepEqual(owned.items, {
    [SPEED]: { total: 6, places: [{ label: '拠点 1 の箱', count: 5 }, { label: 'Alice の所持品', count: 1 }] },
    [REVERSER]: { total: 12, places: [{ label: '拠点 1 の設備', count: 8 }, { label: 'ギルド保管庫', count: 3 }, { label: '拠点 1 の箱', count: 1 }] },
    // 同じ数は場所の名前の順
    [NOUKIN]: { total: 2, places: [{ label: 'Alice の所持品', count: 1 }, { label: '拠点 1 の配合牧場', count: 1 }] },
  });
  assert.equal(itemStock(owned, SPEED), owned.items[SPEED]);
  // 大文字小文字は問わない。読んだデータにないアイテムは在庫なし（0）
  assert.equal(itemStock(owned, SPEED.toLowerCase()), owned.items[SPEED]);
  assert.deepEqual(itemStock(owned, 'PalPassiveSkillChange_Consumable_Deffence_up3'), { total: 0, places: [] });
  assert.equal(itemStock(owned, ''), null);
  assert.equal(stockText(itemStock(owned, SPEED)), '在庫 6（拠点 1 の箱 5・Alice の所持品 1）');
  assert.equal(stockText(itemStock(owned, REVERSER)), '在庫 12（拠点 1 の設備 8・ギルド保管庫 3 ほか）');
  assert.equal(stockText({ total: 5, places: [{ label: '拠点 1 の箱', count: 5 }] }), '在庫 5（拠点 1 の箱）');
  assert.equal(stockText(itemStock(owned, 'PalPassiveSkillChange_Consumable_Deffence_up3')), '在庫なし');
  assert.equal(stockText(itemStock(owned, SPEED), { short: true }), '在庫 6');
  assert.equal(stockText(null), '');
  // 在庫を読む前の古いスナップショット・形の壊れた値は分からない（null）。在庫のない古い共有も分からない（共有は次のテスト）
  const old = normalizeOwned({ version: 1, world: {}, players: [], bases: [], pals: [], stats: {} }, { pals, passives });
  assert.equal(old.items, null);
  assert.equal(itemStock(old, SPEED), null);
  assert.equal(stockText(itemStock(old, SPEED)), '');
  const broken = normalizeOwned({ version: 1, players: [], bases: [], pals: [], items: [null, 'x', { itemId: '__proto__', count: 3, where: 'guild' }, { itemId: SPEED, count: -1, where: 'guild' }, { itemId: SPEED, count: 2, where: 'mars' }] }, { pals, passives });
  assert.deepEqual(broken.items, {});
  // 入れ物の種類が壊れた値・組み込みの名前でも読み込みを止めず、ほかの設備にする（Codex のレビュー 1）。
  // 大文字小文字の違う同じアイテムは合わせる（表の ID は最初に見えた書き方。Codex のレビュー 3）
  const bases = [{ id: 'b1', number: 1, guildId: 'g1' }];
  const odd = normalizeOwned({ version: 1, players: [], bases, pals: [], items: [
    { itemId: REVERSER, count: 3, where: 'base', id: 'b1', object: { toString: 0 } },
    { itemId: REVERSER.toLowerCase(), count: 2, where: 'base', id: 'b1', object: '__proto__' },
    { itemId: REVERSER, count: 1, where: 'base', id: 'b1', object: 'constructor' },
  ] }, { pals, passives });
  assert.deepEqual(odd.items, { [REVERSER]: { total: 6, places: [{ label: '拠点 1 の設備', count: 6 }] } });
  assert.equal(itemStock(odd, REVERSER.toLowerCase()).total, 6);
  const shared = ownedFromShared({ world: { worldName: 'W' }, columns: OWNED_FIELDS, rows: [] }, { pals, passives });
  assert.equal(shared.items, null);
  assert.equal(itemStock(shared, SPEED), null);
});

test('在庫の共有（server の share-extras）: world の items（列 extras）で送り、GAS の検査を通って参加者の画面で同じ在庫と文になる。種類の上限で切れた共有は、ないアイテムを「分からない」にする', () => {
  const owned = normalizeOwned(buildSnapshot({ level: parseLevel(level()), players: [player()] }), { pals, passives });
  const extras = sharedExtras(owned, 'coop');
  // アイテム ID の順。場所の内訳は多い順に 3 か所まで
  assert.deepEqual(extras.items, [
    { id: REVERSER, t: 12, p: [{ l: '拠点 1 の設備', n: 8 }, { l: 'ギルド保管庫', n: 3 }, { l: '拠点 1 の箱', n: 1 }] },
    { id: SPEED, t: 6, p: [{ l: '拠点 1 の箱', n: 5 }, { l: 'Alice の所持品', n: 1 }] },
    { id: NOUKIN, t: 2, p: [{ l: 'Alice の所持品', n: 1 }, { l: '拠点 1 の配合牧場', n: 1 }] },
  ]);
  const checked = validateOwnedUpload({ worldId: 'A'.repeat(32), saveUpdatedAt: '2026-10-18T10:00:00.000Z', world: { name: 'W', ...extras }, columns: OWNED_FIELDS, rows: [] });
  // GAS が world に広げて返したもの → 一覧のキャッシュの検査 → 参加者の画面
  const [world] = cleanOwnedWorlds([{ worldId: 'A'.repeat(32), worldName: 'W', ...checked.value.extras }]);
  const shared = ownedFromShared({ world, columns: OWNED_FIELDS, rows: [] }, { pals, passives });
  assert.deepEqual([shared.items, shared.itemsPartial], [owned.items, false]);
  for (const item of [SPEED, REVERSER, NOUKIN, 'PalPassiveSkillChange_Consumable_Deffence_up3']) {
    assert.equal(stockText(itemStock(shared, item)), stockText(itemStock(owned, item)), item);
  }
  // 何も持っていない（[]）は在庫なし。在庫を読む前のデータは送らない（参加者は分からない）
  assert.deepEqual(sharedExtras({ ...owned, items: {} }, 'coop').items, []);
  assert.equal('items' in sharedExtras({ ...owned, items: null }, 'coop'), false);
  assert.equal(stockText(itemStock(ownedFromShared({ world: { items: [] }, rows: [] }, { pals, passives }), SPEED)), '在庫なし');
  // セルに入らず場所の内訳を外した在庫は、数だけの文
  const bare = ownedFromShared({ world: { items: [{ id: SPEED, t: 6 }] }, rows: [] }, { pals, passives });
  assert.equal(stockText(itemStock(bare, SPEED)), '在庫 6');
  // 種類の上限まで届いた共有（一部だけかもしれない）: 見つからないアイテムは「在庫なし」ではなく分からない（null）
  const many = Array.from({ length: OWNED_ITEMS_MAX }, (_, i) => ({ id: `PalPassiveSkillChange_X${i}`, t: 1 }));
  const partial = ownedFromShared({ world: { items: many }, rows: [] }, { pals, passives });
  assert.equal(partial.itemsPartial, true);
  assert.equal(itemStock(partial, SPEED), null);
  assert.equal(itemStock(partial, 'PalPassiveSkillChange_X3').total, 1);
  assert.equal(normalizeOwned({ version: 1, players: [], bases: [], pals: [], items: [] }, { pals, passives }).itemsPartial, false);
  // 大きな在庫（200 種・長い名前）も、送る前にセルに入るよう縮める（GAS と同じ関数。送る中身と GAS が残す中身が同じ）
  const big = Object.fromEntries(Array.from({ length: OWNED_ITEMS_MAX + 20 }, (_, i) => [`PalPassiveSkillChange_${String(i).padStart(90, 'x')}`, {
    total: 2000000, places: [{ label: '拠点'.repeat(30), count: 1000000 }, { label: 'ギルド保管庫', count: 1000000 }],
  }]));
  const fitted = sharedExtras({ ...owned, items: big }, 'coop');
  assert.ok(ownedExtrasText('2026-10-18T10:00:00.000Z', fitted).length <= OWNED_EXTRAS_MAX_CHARS);
  assert.equal(fitted.items.length, OWNED_ITEMS_MAX);
  // 合計が上限（1,000,000）を超えるアイテムも捨てずに上限にする
  assert.ok(fitted.items.every((item) => item.t === 1000000));
  const again = validateOwnedUpload({ worldId: 'A'.repeat(32), saveUpdatedAt: '2026-10-18T10:00:00.000Z', world: { name: 'W', ...fitted }, columns: OWNED_FIELDS, rows: [] });
  assert.deepEqual(again.value.extras.items, fitted.items);
});
