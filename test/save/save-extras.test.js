// セーブから読む追加の情報（save-extras）: 入手時刻・魂の強化と状態・プレイ中と Day・観賞用ケージ・配合牧場のケーキ。
// 合成バイト列だけを使う（実セーブのバイトは含めない）。今の項目の読み取りが変わらないことは gvas.test.js・breed-farm.test.js が確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZERO_GUID } from '../../web/js/save/gvas.js';
import { parseLevel, parsePlayer, parsePalStorage, buildSnapshot, ticksToLocalIso, ticksToIso } from '../../web/js/save/palworld.js';
import { ByteWriter, GvasWriter, gvasWithHeader, finishGvas } from '../helpers/gvas-writer.js';

const id = (n) => `${String(n).padStart(8, '0')}-0000-0000-0000-00000000cccc`;
const P1 = '00000000-0000-0000-0000-000000000001';
const P2 = id(2);
const [C_PARTY, C_BASE, C_DISPLAY] = [id(11), id(12), id(13)];
const [IC_FARM1, IC_FARM2, IC_MISSING] = [id(21), id(22), id(23)];
const [BASE1, GUILD] = [id(31), id(33)];
// ローカル時刻の壁時計（ホストの PC の 2026/10/15 21:52:16.570）のティック。2^53 を超えるので 10 進の文字列で書く
const wallTicks = (y, mo, d, h, mi, s, ms) => ((BigInt(Date.UTC(y, mo - 1, d, h, mi, s, ms)) + 62135596800000n) * 10000n).toString();
const OWNED = wallTicks(2026, 10, 15, 21, 52, 16, 570);
const REAL = 9919376670000;
const GAME = 624 * 864e9 + 3.6e10;

const transform = (w) => w.f64(0).f64(0).f64(0).f64(1).f64(0).f64(0).f64(0).f64(1).f64(1).f64(1);
const sp = (fill) => (s) => s.structProps('SaveParameter', 'PalIndividualCharacterSaveParameter', fill);
const charBlob = (fill) => {
  const w = new GvasWriter();
  sp(fill)(w);
  return w.none().u32(0).guid(ZERO_GUID).u32(0).toBytes();
};
const slotId = (s, c, i) => s.structProps('SlotId', 'PalCharacterSlotId', (t) => {
  t.structProps('ContainerId', 'PalContainerId', (u) => u.nativeStruct('ID', 'Guid', (x) => x.guid(c)));
  t.int('SlotIndex', i);
});
const modelBlob = (instanceId, concreteId, baseId) => {
  const w = new ByteWriter().guid(instanceId).guid(concreteId).guid(baseId).guid(ZERO_GUID).i32(1).i32(1);
  transform(w);
  return w.guid(ZERO_GUID).guid(ZERO_GUID).guid(ZERO_GUID).guid(P1).u8(0).f32(0).guid(ZERO_GUID).u32(0).toBytes();
};
const farmBlob = (concreteId, modelId) => new ByteWriter().guid(concreteId).guid(modelId).u32(0).u32(0).f32(300).u32(2).toBytes();
const moduleBlob = (containerId) => new ByteWriter().guid(containerId).u32(0).u32(0).u32(0).u8(0).u32(0).toBytes();
const itemSlot = (index, staticId, count) => new ByteWriter().i32(index).i32(count).fstring(staticId).guid(ZERO_GUID).guid(id(500 + index)).u32(0).toBytes();
// ギルドの末尾（2026-07 更新後の形）: 倉庫の役割・管理者・メンバー（UID・最終ログイン・名前・役割）・権限・末尾 4 バイト
const guildBlob = (members) => {
  const w = new ByteWriter().guid(GUILD).fstring('').u32(0).u8(1).u32(0)
    .u32(1).guid(BASE1).i32(0).i32(5).u32(0).fstring('ギルド').guid(ZERO_GUID).u32(0)
    .u32(0).i32(0).guid(P1).u32(members.length);
  for (const [uid, last, name] of members) w.guid(uid).i64(last).fstring(name).u8(1);
  return w.u32(0).u32(0).toBytes();
};

// farm1Slots・farm2Slots は牧場 1・2 の入れ物のスロット（[アイテム ID, 個数]、または読めない生のバイト列の Uint8Array）
function level({ gameTime = true, members = [[P1, REAL, 'Alice'], [P2, REAL - 14310 * 1e7, 'Bob']],
  farm1Slots = [['Cake02', 30], ['Cake03', 18], ['Cake02', 21], ['Wood', 5], ['Cake05', 0]], farm2Slots = [] } = {}) {
  const lv = gvasWithHeader({ className: '/Script/Pal.PalWorldSaveGame' });
  lv.structProps('worldSaveData', 'PalWorldSaveData', (ws) => {
    const chars = [
      [P1, id(101), charBlob((s) => s.bool('IsPlayer', true).str('NickName', 'Alice').byte('Level', 52))],
      [P2, id(102), charBlob((s) => s.bool('IsPlayer', true).str('NickName', 'Bob').byte('Level', 47))],
      // 入手時刻・魂の強化・病気・空腹・SAN を持つ手持ちの個体
      [P1, id(103), charBlob((s) => {
        s.name('CharacterID', 'Anubis').nativeStruct('OwnedTime', 'DateTime', (x) => x.u64(OWNED))
          .byte('Rank_HP', 10).byte('Rank_CraftSpeed', 20)
          .enumProp('WorkerSick', 'EPalBaseCampWorkerSickType', 'EPalBaseCampWorkerSickType::Cold')
          .enumProp('HungerType', 'EPalStatusHungerType', 'EPalStatusHungerType::Starvation')
          .float('SanityValue', 82.5);
        slotId(s, C_PARTY, 0);
      })],
      // 既定の値（None・Default）だけを書いた拠点の個体
      [P1, id(104), charBlob((s) => {
        s.name('CharacterID', 'SheepBall').enumProp('WorkerSick', 'EPalBaseCampWorkerSickType', 'EPalBaseCampWorkerSickType::None')
          .enumProp('HungerType', 'EPalStatusHungerType', 'EPalStatusHungerType::Default');
        slotId(s, C_BASE, 0);
      })],
      // 観賞用ケージの個体（前は場所が「不明」）
      [P1, id(105), charBlob((s) => { s.name('CharacterID', 'ChickenPal'); slotId(s, C_DISPLAY, 3); })],
    ];
    ws.map('CharacterSaveParameterMap', 'StructProperty', 'StructProperty', chars.map(([p, i, b]) => [[p, i], b]),
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
      return w.u8(0).u8(0).guid(C_BASE).u32(0).toBytes();
    };
    ws.map('BaseCampSaveData', 'StructProperty', 'StructProperty', [[BASE1, 0]], (k, b) => k.guid(b),
      (v) => v.byteArray('RawData', baseBlob()).structProps('WorkerDirector', 'PalBaseCampSaveData_WorkerDirector', (s) => s.byteArray('RawData', wdBlob())).none());
    ws.map('GroupSaveDataMap', 'StructProperty', 'StructProperty', [[GUILD, guildBlob(members)]], (k, g) => k.guid(g),
      (v, b) => v.enumProp('GroupType', 'EPalGroupType', 'EPalGroupType::Guild').byteArray('RawData', b).none());
    // 牧場 1 はケーキ 2 種（同じ種類は合わせる）とケーキ以外のアイテム、牧場 2 は空の入れ物、牧場 3 は入れ物が見つからない
    ws.map('ItemContainerSaveData', 'StructProperty', 'StructProperty',
      [[IC_FARM1, farm1Slots], [IC_FARM2, farm2Slots]],
      (k, c) => k.nativeStruct('ID', 'Guid', (x) => x.guid(c)).none(),
      (v, slots) => v.structArray('Slots', 'PalItemSlotSaveData', slots.map((slot, i) => [i, slot]),
        (e, [i, slot]) => e.byteArray('RawData', slot instanceof Uint8Array ? slot : itemSlot(i, ...slot)).none()).none());
    const mapObjects = [
      ['DisplayCharacter', modelBlob(id(201), id(202), BASE1), new Uint8Array(0), [['EPalMapObjectConcreteModelModuleType::CharacterContainer', C_DISPLAY]]],
      ['BreedFarm', modelBlob(id(301), id(302), BASE1), farmBlob(id(302), id(301)), [['EPalMapObjectConcreteModelModuleType::ItemContainer', IC_FARM1]]],
      ['BreedFarm', modelBlob(id(311), id(312), BASE1), farmBlob(id(312), id(311)), [['EPalMapObjectConcreteModelModuleType::ItemContainer', IC_FARM2]]],
      ['BreedFarm', modelBlob(id(321), id(322), BASE1), farmBlob(id(322), id(321)), [['EPalMapObjectConcreteModelModuleType::ItemContainer', IC_MISSING]]],
      ['BreedFarm', modelBlob(id(331), id(332), BASE1), farmBlob(id(332), id(331)), []],
    ];
    ws.structArray('MapObjectSaveData', 'PalMapObjectSaveData', mapObjects, (e, [mid, model, concrete, modules]) => {
      e.name('MapObjectId', mid)
        .structProps('Model', 'PalMapObjectModelSaveData', (s) => s.byteArray('RawData', model))
        .structProps('ConcreteModel', 'PalMapObjectConcreteModelSaveData', (s) => {
          s.byteArray('RawData', concrete);
          s.map('ModuleMap', 'EnumProperty', 'StructProperty', modules, (k, n) => k.fstring(n), (v, c) => v.byteArray('RawData', moduleBlob(c)).none());
        })
        .none();
    });
    if (gameTime) ws.structProps('GameTimeSaveData', 'PalGameTimeSaveData', (s) => s.int64('GameDateTimeTicks', GAME).int64('RealDateTimeTicks', REAL));
  });
  return finishGvas(lv);
}

function player() {
  const pw = gvasWithHeader({ className: '/Script/Pal.PalWorldPlayerSaveGame' });
  pw.structProps('SaveData', 'PalWorldPlayerSaveData', (s) => {
    s.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(P1));
    s.structProps('OtomoCharacterContainerId', 'PalContainerId', (t) => t.nativeStruct('ID', 'Guid', (x) => x.guid(C_PARTY)));
  });
  return parsePlayer(finishGvas(pw));
}

function storage() {
  const dw = gvasWithHeader({ className: '/Script/Pal.PalDimensionPalStorageSaveGame' });
  dw.structArray('SaveParameterArray', 'PalDimensionPalStorageSaveParameter', [id(401)], (e, iid) => {
    // 保管庫では魂の強化と状態がいつも書かれる（既定の値も）
    sp((s) => s.name('CharacterID', 'PinkCat').nativeStruct('OwnedTime', 'DateTime', (x) => x.u64(wallTicks(2024, 4, 20, 1, 5, 45, 58)))
      .byte('Rank_HP', 10).byte('Rank_Attack', 10).byte('Rank_Defence', 10).byte('Rank_CraftSpeed', 0)
      .enumProp('WorkerSick', 'EPalBaseCampWorkerSickType', 'EPalBaseCampWorkerSickType::None').float('SanityValue', 100)
      .byte('FavoriteIndex', 2))(e);
    e.structProps('InstanceId', 'PalInstanceID', (s) => s.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(ZERO_GUID))
      .nativeStruct('InstanceId', 'Guid', (x) => x.guid(iid)).str('DebugName', '')).none();
  });
  return finishGvas(dw);
}

const localIso = (y, mo, d, h, mi, s, ms) => new Date(y, mo - 1, d, h, mi, s, ms).toISOString();

test('save-extras: DateTime のティックはホストの PC のローカル時刻として読む（ticksToIso は UTC のまま）。読めない値は空', () => {
  assert.equal(ticksToLocalIso(OWNED), localIso(2026, 10, 15, 21, 52, 16, 570));
  assert.equal(ticksToLocalIso(BigInt(OWNED)), localIso(2026, 10, 15, 21, 52, 16, 570));
  // UTC として読むと、日本時間の PC ではローカル時刻との差（9 時間）だけずれる
  assert.equal(ticksToIso(OWNED), '2026-10-15T21:52:16.570Z');
  for (const bad of [null, undefined, '', 0, '0', -5, 'abc', '1e9', {}]) assert.equal(ticksToLocalIso(bad), '', String(bad));
});

test('save-extras: 個体の入手時刻・魂の強化・病気と空腹と SAN を読み、書かれていない項目は既定（入手時刻なし・0・なし・SAN 100）', () => {
  const lv = parseLevel(level());
  assert.deepEqual(lv.malformed, {});
  const dps = parsePalStorage(storage());
  const snap = buildSnapshot({ level: lv, players: [player()], dps: [{ playerUid: P1, data: dps }] });
  const byChar = Object.fromEntries(snap.pals.map((p) => [p.characterId, p]));
  assert.deepEqual([byChar.Anubis.ownedAt, byChar.Anubis.soul, byChar.Anubis.condition], [
    localIso(2026, 10, 15, 21, 52, 16, 570), { hp: 10, attack: 0, defense: 0, craft: 20 }, { sick: 'Cold', hunger: 'Starvation', sanity: 82.5 },
  ]);
  // 既定の値（None・Default）と、書かれていない項目
  assert.deepEqual([byChar.SheepBall.ownedAt, byChar.SheepBall.soul, byChar.SheepBall.condition], [
    '', { hp: 0, attack: 0, defense: 0, craft: 0 }, { sick: '', hunger: '', sanity: 100 },
  ]);
  assert.deepEqual([byChar.PinkCat.ownedAt, byChar.PinkCat.soul], [localIso(2024, 4, 20, 1, 5, 45, 58), { hp: 10, attack: 10, defense: 10, craft: 0 }]);
  // ふだんの読み込みはお気に入り（FavoriteIndex。見送った）を読まない
  assert.equal('probe' in byChar.PinkCat, false);
  // 調べるとき（check-save の --probe）だけ、足した項目の生の値を probe に入れる
  const probed = parsePalStorage(storage(), { extraPalFields: ['FavoriteIndex', 'IsFavoritePal'] });
  assert.deepEqual(probed.pals[0].probe, { FavoriteIndex: 2 });
  const probedLevel = parseLevel(level(), { extraPalFields: ['Rank_HP', 'IsFavoritePal'] });
  assert.deepEqual(probedLevel.pals.map((p) => p.probe), [{ Rank_HP: 10 }, {}, {}]);
  assert.doesNotThrow(() => structuredClone(snap));
});

test('save-extras: ギルドの最終ログインとワールドの通算の時間の差が 10 秒以内ならプレイ中。読めなければ分からない（null）。Day は通算のゲーム内時刻から', () => {
  const snap = buildSnapshot({ level: parseLevel(level()), players: [player()] });
  assert.deepEqual(snap.players, [
    { uid: P1, name: 'Alice', level: 52, online: true },
    { uid: P2, name: 'Bob', level: 47, online: false },
  ]);
  // LevelMeta.sav がなければ、Day は floor(GameDateTimeTicks ÷ 864e9)
  assert.equal(snap.world.inGameDay, 624);
  // 10 秒（1 億ティック）ちょうどまではプレイ中、それより離れていれば違う
  const edge = buildSnapshot({ level: parseLevel(level({ members: [[P1, REAL - 1e8, 'Alice'], [P2, REAL + 1e8 + 1, 'Bob']] })) });
  assert.deepEqual(edge.players.map((p) => p.online), [true, false]);
  // GameTimeSaveData のないセーブ（古い形・読めない）では分からない
  const old = buildSnapshot({ level: parseLevel(level({ gameTime: false })) });
  assert.deepEqual([old.players.map((p) => p.online), old.world.inGameDay], [[null, null], 0]);
  // LevelMeta.sav の InGameDay があればそちら
  const withMeta = buildSnapshot({ level: parseLevel(level()), meta: { kind: 'levelMeta', worldName: 'World9', hostPlayerName: 'Alice', inGameDay: 623, timestampTicks: null, malformed: {} } });
  assert.equal(withMeta.world.inGameDay, 623);
});

test('save-extras: 観賞用ケージ（DisplayCharacter の CharacterContainer）の個体は場所 display・拠点つき（前は不明）', () => {
  const snap = buildSnapshot({ level: parseLevel(level()), players: [player()] });
  const chicken = snap.pals.find((p) => p.characterId === 'ChickenPal');
  assert.deepEqual([chicken.location.kind, chicken.location.baseId, chicken.location.containerId, chicken.location.slotIndex], ['display', BASE1, C_DISPLAY, 3]);
  assert.equal(snap.stats.unknownLocation, 0);
  assert.equal(snap.stats.byKind.display, 1);
});

test('save-extras: 配合牧場のケーキは入れ物（ModuleMap の ItemContainer）のケーキの種類ごとの数。空ならケーキ切れ（[]）、入れ物がなければ分からない（null）', () => {
  const farms = buildSnapshot({ level: parseLevel(level()) }).breedFarms;
  assert.deepEqual(farms.map((farm) => farm.cakes), [
    // 同じ種類は合わせ、スロットの順。ケーキ以外のアイテム・0 個のスロットは数えない
    [{ itemId: 'Cake02', count: 51 }, { itemId: 'Cake03', count: 18 }],
    [],
    null,
    null,
  ]);
  assert.deepEqual(farms.map((farm) => farm.status), ['ok', 'ok', 'ok', 'ok']);
});

test('save-extras: 牧場の入れ物に読めないスロットがあれば、ケーキの数を確かめられないので分からない（null）。「ケーキ切れ」（[]）にしない', () => {
  const broken = new Uint8Array([1, 2, 3]);
  // 牧場 1 はケーキの間に読めないスロット、牧場 2 は全部のスロットが読めない（前は [] になり、画面が「ケーキ切れ」と出した）
  const lv = parseLevel(level({ farm1Slots: [['Cake02', 30], broken], farm2Slots: [broken, broken, broken] }));
  assert.equal(lv.malformed.itemSlots, 4);
  const farms = buildSnapshot({ level: lv }).breedFarms;
  assert.deepEqual(farms.map((farm) => farm.cakes), [null, null, null, null]);
  // 読めないスロットのない入れ物は今までどおり（空ならケーキ切れ）
  const ok = buildSnapshot({ level: parseLevel(level({ farm1Slots: [broken], farm2Slots: [] })) }).breedFarms;
  assert.deepEqual(ok.map((farm) => farm.cakes), [null, [], null, null]);
  // 中身の分からない 0 バイトのスロット（RawData の空のバイト列）も分からない（Codex のレビュー。実セーブにはなかった形）
  const empty = parseLevel(level({ farm1Slots: [['Cake02', 30]], farm2Slots: [new Uint8Array(0)] }));
  assert.equal(empty.malformed.itemSlots, undefined);
  assert.deepEqual(buildSnapshot({ level: empty }).breedFarms.map((farm) => farm.cakes), [[{ itemId: 'Cake02', count: 30 }], null, null, null]);
});
