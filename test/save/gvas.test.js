// node --test gvas.test.mjs
// 合成バイト列だけを使う（実セーブのバイトは含めない）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGvas, readGvasHeader, GvasReader, GvasError, guidAt, ZERO_GUID } from '../../web/js/save/gvas.js';
import { readSavHeader, playerUidFromFileName, ticksToIso, detectSaveKind, eggPlaceKind } from '../../web/js/save/palworld.js';
import { ByteWriter, GvasWriter, gvasWithHeader, finishGvas } from '../helpers/gvas-writer.js';

const G1 = 'aabbccdd-eeff-0011-2233-445566778899';
const G2 = '4de16e79-0000-0000-0000-000000000000';

test('header', () => {
  const bytes = finishGvas(gvasWithHeader({
    className: '/Script/Pal.PalWorldSaveGame',
    customVersions: [[G1, 7], [ZERO_GUID, 1]],
  }));
  const { header, properties, trailer } = readGvas(bytes);
  assert.equal(header.magic, 0x53415647);
  assert.equal(header.saveGameVersion, 3);
  assert.equal(header.packageFileVersionUE4, 522);
  assert.equal(header.packageFileVersionUE5, 1008);
  assert.deepEqual(header.engineVersion, { major: 5, minor: 1, patch: 1, changelist: 0, branch: '++UE5+Release-5.1' });
  assert.equal(header.customVersionFormat, 3);
  assert.deepEqual(header.customVersions, [{ guid: G1, version: 7 }, { guid: ZERO_GUID, version: 1 }]);
  assert.equal(header.saveGameClassName, '/Script/Pal.PalWorldSaveGame');
  assert.deepEqual(properties, {});
  assert.deepEqual(Array.from(trailer), [0, 0, 0, 0]);
  assert.equal(readGvasHeader(bytes).saveGameClassName, '/Script/Pal.PalWorldSaveGame');
  assert.equal(detectSaveKind(bytes), 'level');
});

test('header: bad magic', () => {
  const w = new ByteWriter().u32(0x12345678).i32(3);
  assert.throws(() => readGvas(w.toBytes()), (e) => e instanceof GvasError && /not a GVAS file/.test(e.message));
});

test('guid format matches palsav UUID.__str__', () => {
  // palsav: '%08x-%04x-%04x-%04x-%04x%08x' % (b3..b0, b7b6, b5b4, b11b10, b9b8, b15..b12)
  const b = Uint8Array.from({ length: 16 }, (_, i) => i);
  assert.equal(guidAt(b, 0), '03020100-0706-0504-0b0a-09080f0e0d0c');
  const w = new ByteWriter().guid(G1);
  assert.equal(guidAt(w.toBytes(), 0), G1);
});

test('scalars: int / float / bool / str (latin1 + UTF-16) / name / enum / byte', () => {
  const w = gvasWithHeader();
  w.int('I', -123456)
    .float('F', 1.5)
    .double('D', -2.25)
    .bool('BT', true)
    .bool('BF', false)
    .str('S1', 'Hello')
    .str('S2', 'café') // Latin-1（8bit）
    .str('S3', 'ナイトフォックス') // UTF-16
    .str('S4', '')
    .name('N', 'NightFox')
    .enumProp('E', 'EPalGenderType', 'EPalGenderType::Female')
    .byte('B1', 42)
    .byte('B2', 'EFoo::Bar', 'EFoo')
    .uint32('U32', 4000000000)
    .uint16('U16', 65535)
    .int64('L1', -5)
    .int64('L2', 639268171446470000n)
    .int('I2', 7, { guidFlag: 1 }); // プロパティ GUID 付き
  const { properties: p } = readGvas(finishGvas(w));
  assert.deepEqual(p, {
    I: -123456, F: 1.5, D: -2.25, BT: true, BF: false,
    S1: 'Hello', S2: 'café', S3: 'ナイトフォックス', S4: '',
    N: 'NightFox', E: 'EPalGenderType::Female', B1: 42, B2: 'EFoo::Bar',
    U32: 4000000000, U16: 65535, L1: -5, L2: '639268171446470000', I2: 7,
  });
});

test('struct: property-list struct and native structs', () => {
  const w = gvasWithHeader();
  w.structProps('SaveData', 'PalWorldBaseInfoSaveData', (s) => {
    s.str('WorldName', 'W');
    s.structProps('SlotId', 'PalCharacterSlotId', (t) => {
      t.structProps('ContainerId', 'PalContainerId', (u) => u.nativeStruct('ID', 'Guid', (x) => x.guid(G1)));
      t.int('SlotIndex', 3);
    });
  });
  w.nativeStruct('Pos', 'Vector', (x) => x.f64(1).f64(-2).f64(3.5));
  w.nativeStruct('Rot', 'Quat', (x) => x.f64(0).f64(0).f64(0).f64(1));
  w.nativeStruct('When', 'DateTime', (x) => x.u64(639268171446470000n));
  w.nativeStruct('Small', 'DateTime', (x) => x.u64(12345));
  w.nativeStruct('Col', 'LinearColor', (x) => x.f32(0.5).f32(1).f32(0).f32(1));
  const { properties: p } = readGvas(finishGvas(w));
  assert.deepEqual(p.SaveData, { WorldName: 'W', SlotId: { ContainerId: { ID: G1 }, SlotIndex: 3 } });
  assert.deepEqual(p.Pos, { x: 1, y: -2, z: 3.5 });
  assert.deepEqual(p.Rot, { x: 0, y: 0, z: 0, w: 1 });
  assert.equal(p.When, '639268171446470000');
  assert.equal(p.Small, 12345);
  assert.deepEqual(p.Col, { r: 0.5, g: 1, b: 0, a: 1 });
});

test('array of names / ints', () => {
  const w = gvasWithHeader();
  w.array('PassiveSkillList', 'NameProperty', ['Legend', 'Rare', 'PAL_ALLAttack_up3']);
  w.array('Nums', 'IntProperty', [1, -2, 3]);
  w.array('Empty', 'NameProperty', []);
  const { properties: p } = readGvas(finishGvas(w));
  assert.deepEqual(p.PassiveSkillList, ['Legend', 'Rare', 'PAL_ALLAttack_up3']);
  assert.deepEqual(p.Nums, [1, -2, 3]);
  assert.deepEqual(p.Empty, []);
});

test('array of structs (property lists and Guid) with palsav paths', () => {
  const w = gvasWithHeader();
  w.structArray('Items', 'PalItemAndNum', [['A', 1], ['B', 2]], (e, [id, n]) => {
    e.name('StaticId', id).int('Num', n).none();
  });
  w.structArray('Owners', 'Guid', [G1, G2], (e, g) => e.guid(g));
  const seen = [];
  const { properties: p } = readGvas(finishGvas(w), { skip: (path) => { seen.push(path); return false; } });
  assert.deepEqual(p.Items, [{ StaticId: 'A', Num: 1 }, { StaticId: 'B', Num: 2 }]);
  assert.deepEqual(p.Owners, [G1, G2]);
  // 要素の子のパスは palsav と同じく '<path>.<prop名>.<子>'
  assert.ok(seen.includes('.Items.Items.StaticId'));
});

test('map with guid keys and struct values (type hints)', () => {
  const w = gvasWithHeader();
  w.map('Bases', 'StructProperty', 'StructProperty', [[G1, 5], [G2, 6]],
    (k, g) => k.guid(g),
    (v, n) => v.int('Level', n).none());
  w.map('Counts', 'NameProperty', 'IntProperty', [['SheepBall', 3]], (k, s) => k.fstring(s), (v, n) => v.i32(n));
  w.map('Flags', 'NameProperty', 'BoolProperty', [['X', true], ['Y', false]], (k, s) => k.fstring(s), (v, b) => v.u8(b ? 1 : 0));
  const bytes = finishGvas(w);
  // キーはヒント無しなら Guid、値はヒント無しならプロパティ列（palsav と同じ既定）
  const { properties: p } = readGvas(bytes, { typeHints: {} });
  assert.deepEqual(p.Bases, [{ key: G1, value: { Level: 5 } }, { key: G2, value: { Level: 6 } }]);
  assert.deepEqual(p.Counts, [{ key: 'SheepBall', value: 3 }]);
  assert.deepEqual(p.Flags, [{ key: 'X', value: true }, { key: 'Y', value: false }]);
  // ヒントで型を指定できる（キーをプロパティ列 struct として読む例）
  const w2 = gvasWithHeader();
  w2.map('M', 'StructProperty', 'IntProperty', [['k1', 9]], (k, s) => k.str('Name', s).none(), (v, n) => v.i32(n));
  const { properties: p2 } = readGvas(finishGvas(w2), { typeHints: { '.M.Key': 'StructProperty' } });
  assert.deepEqual(p2.M, [{ key: { Name: 'k1' }, value: 9 }]);
});

test('set of structs uses <path>.StructProperty', () => {
  const w = gvasWithHeader();
  w.set('Locker', 'StructProperty', [G1], (e, g) => e.nativeStruct('InstanceId', 'Guid', (x) => x.guid(g)).none());
  const seen = [];
  const { properties: p } = readGvas(finishGvas(w), { skip: (path) => { seen.push(path); return false; } });
  assert.deepEqual(p.Locker, [{ InstanceId: G1 }]);
  assert.ok(seen.includes('.Locker.StructProperty.InstanceId'));
});

test('byte-array RawData: zero-copy subarray, parsed with the same reader code', () => {
  const inner = new GvasWriter();
  inner.structProps('SaveParameter', 'PalIndividualCharacterSaveParameter', (s) => {
    s.name('CharacterID', 'NightFox').byte('Level', 12).array('PassiveSkillList', 'NameProperty', ['Rare']);
  });
  inner.none();
  inner.u32(0).guid(G1).u32(0); // character.py の後続（4 バイト, group_id, 4 バイト）
  const blob = inner.toBytes();
  const w = gvasWithHeader();
  w.structProps('Entry', 'Foo', (s) => s.byteArray('RawData', blob));
  const bytes = finishGvas(w);
  const { properties: p } = readGvas(bytes);
  const raw = p.Entry.RawData;
  assert.ok(raw instanceof Uint8Array);
  assert.equal(raw.buffer, bytes.buffer, 'subarray of the input buffer (no copy)');
  assert.deepEqual(Array.from(raw), Array.from(blob));
  const r = new GvasReader(raw);
  assert.deepEqual(r.readProperties(''), { SaveParameter: { CharacterID: 'NightFox', Level: 12, PassiveSkillList: ['Rare'] } });
  assert.equal(r.u32(), 0);
  assert.equal(r.guid(), G1);
  // fork は設定を引き継ぐ
  const f = new GvasReader(bytes, { skip: () => true }).fork(raw);
  assert.deepEqual(f.readProperties(''), {});
});

test('skip(): skipped properties are absent and reading continues; args are (path, name, parent, type)', () => {
  const w = gvasWithHeader();
  w.structProps('worldSaveData', 'PalWorldSaveData', (s) => {
    s.map('FoliageGridSaveDataMap', 'StructProperty', 'StructProperty', [[G1, 1]], (k, g) => k.guid(g), (v, n) => v.int('X', n).none());
    s.raw('Weird', 'MysteryProperty', new Uint8Array([1, 2, 3])); // 未知の型も skip なら飛ばせる
    s.int('Keep', 1);
    s.bool('Flag', true);
  });
  w.int('After', 2);
  const calls = [];
  const skip = (path, name, parent, type) => {
    calls.push([path, name, parent, type]);
    return path === '.worldSaveData.FoliageGridSaveDataMap' || type === 'MysteryProperty' || name === 'Flag';
  };
  const { properties: p } = readGvas(finishGvas(w), { skip });
  assert.deepEqual(p, { worldSaveData: { Keep: 1 }, After: 2 });
  assert.deepEqual(calls[1], ['.worldSaveData.FoliageGridSaveDataMap', 'FoliageGridSaveDataMap', '.worldSaveData', 'MapProperty']);
});

test('unknown property type throws with path', () => {
  const w = gvasWithHeader();
  w.structProps('Outer', 'X', (s) => s.raw('Weird', 'MysteryProperty', new Uint8Array([1, 2, 3])));
  assert.throws(() => readGvas(finishGvas(w)), (e) => {
    assert.ok(e instanceof GvasError);
    assert.match(e.message, /unknown property type: MysteryProperty/);
    assert.equal(e.path, '.Outer.Weird');
    return true;
  });
});

test('truncated input throws GvasError', () => {
  const w = gvasWithHeader();
  w.str('Name', 'abcdefgh').array('L', 'NameProperty', ['x', 'y']);
  const full = finishGvas(w);
  for (const cut of [10, 60, full.length - 20, full.length - 9]) {
    assert.throws(() => readGvas(full.subarray(0, cut)), (e) => e instanceof GvasError && /unexpected end of data/.test(e.message), `cut ${cut}`);
  }
  // 長さが壊れた FString
  const bad = new ByteWriter().i32(1000000).u8(65).toBytes();
  assert.throws(() => new GvasReader(bad).fstring(), GvasError);
});

test('onError recovers a broken property at the chosen level', () => {
  const w = gvasWithHeader();
  w.structProps('A', 'S', (s) => {
    s.int('Ok', 1);
    // サイズは正しいが中身が壊れた struct（中で未知の型）
    s.structProps('Broken', 'S2', (t) => t.raw('X', 'MysteryProperty', new Uint8Array([9])));
    s.int('AlsoOk', 2);
  });
  const errors = [];
  const { properties: p } = readGvas(finishGvas(w), {
    onError: (e, path) => { errors.push(path); return path === '.A.Broken'; },
  });
  assert.deepEqual(p, { A: { Ok: 1, AlsoOk: 2 } });
  assert.deepEqual(errors, ['.A.Broken.X', '.A.Broken']);
});

test('static array index is kept apart', () => {
  const w = gvasWithHeader();
  w.int('Arr', 10).int('Arr', 11, { index: 1 });
  assert.deepEqual(readGvas(finishGvas(w)).properties, { Arr: 10, 'Arr[1]': 11 });
});

test('readSavHeader: PlM / PlZ / CNK wrapper', () => {
  const sav = (rawSize, compSize, magic, type, extra = []) => {
    const w = new ByteWriter().u32(rawSize).u32(compSize);
    for (const c of magic) w.u8(c.charCodeAt(0));
    return w.u8(type).bytes(Uint8Array.from(extra)).bytes(new Uint8Array(16)).toBytes();
  };
  assert.deepEqual(readSavHeader(sav(100, 50, 'PlM', 0x31)), {
    rawSize: 100, compressedSize: 50, magic: 'PlM', saveType: 0x31, dataOffset: 12, wrapper: '', compression: 'oodle',
  });
  assert.equal(readSavHeader(sav(100, 50, 'PlZ', 0x32)).compression, 'zlib2');
  assert.equal(readSavHeader(sav(100, 50, 'PlZ', 0x31)).compression, 'zlib');
  const inner = new ByteWriter().u32(200).u32(80).u8(0x50).u8(0x6c).u8(0x5a).u8(0x32).toBytes();
  const cnk = sav(0, 0, 'CNK', 0x30, inner);
  assert.deepEqual(readSavHeader(cnk), {
    rawSize: 200, compressedSize: 80, magic: 'PlZ', saveType: 0x32, dataOffset: 24, wrapper: 'CNK', compression: 'zlib2',
  });
  assert.throws(() => readSavHeader(sav(1, 1, 'XYZ', 0)), /unknown magic/);
  assert.throws(() => readSavHeader(finishGvas(gvasWithHeader())), /already a raw GVAS/);
});

test('palworld helpers', () => {
  assert.equal(playerUidFromFileName('Players/4DE16E79000000000000000000000000_dps.sav'), G2);
  assert.equal(playerUidFromFileName('00000000000000000000000000000001.sav'), '00000000-0000-0000-0000-000000000001');
  assert.equal(playerUidFromFileName('Level.sav'), '');
  // 0001-01-01 起点の ticks
  assert.equal(ticksToIso('621355968000000000'), '1970-01-01T00:00:00.000Z');
  assert.equal(ticksToIso(null), '');
  assert.equal(eggPlaceKind('Palegg'), 'egg-ground');
  assert.equal(eggPlaceKind('PalEgg_Dark'), 'egg-ground');
  assert.equal(eggPlaceKind('ElectricHatchingPalEgg'), 'egg-incubator');
  assert.equal(eggPlaceKind('ItemChest_03'), 'egg-chest');
});

// ---------------------------------------------------------------------------
// palworld.js: 合成ワールドで場所の判定ルールを確認
// ---------------------------------------------------------------------------

test('palworld: synthetic world → snapshot', async () => {
  const { parseLevel, parsePlayer, parsePalStorage, parseLevelMeta, buildSnapshot } = await import('../../web/js/save/palworld.js');
  const id = (n) => `${String(n).padStart(8, '0')}-0000-0000-0000-00000000aaaa`;
  const P1 = id(1);
  const [C_PARTY, C_BOX, C_BASE, C_UNKNOWN] = [id(11), id(12), id(13), id(14)];
  const [IC_GROUND, IC_INV, IC_ORPHAN] = [id(21), id(22), id(23)];
  const [BASE1, BASE2, GUILD] = [id(31), id(32), id(33)];
  const transform = (w, x = 0, y = 0, z = 0) => w.f64(0).f64(0).f64(0).f64(1).f64(x).f64(y).f64(z).f64(1).f64(1).f64(1);
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
  const owner = (s, g) => s.nativeStruct('OwnerPlayerUId', 'Guid', (x) => x.guid(g));

  // --- Level ---
  const lv = gvasWithHeader({ className: '/Script/Pal.PalWorldSaveGame' });
  lv.nativeStruct('Timestamp', 'DateTime', (x) => x.u64(621355968000000000n + 10000000n));
  lv.structProps('worldSaveData', 'PalWorldSaveData', (ws) => {
    const chars = [
      [P1, id(101), charBlob((s) => s.bool('IsPlayer', true).str('NickName', 'Alice').byte('Level', 10))],
      [P1, id(102), charBlob((s) => {
        s.name('CharacterID', 'NightFox').enumProp('Gender', 'EPalGenderType', 'EPalGenderType::Female').byte('Rank', 3)
          .byte('Talent_HP', 50).array('PassiveSkillList', 'NameProperty', ['Rare', 'Legend']).bool('IsRarePal', true);
        owner(s, P1);
        s.structArray('OldOwnerPlayerUIds', 'Guid', [ZERO_GUID, P1], (e, g) => e.guid(g));
        slotId(s, C_PARTY, 2);
        s.raw('NewFieldFromFutureUpdate', 'MysteryProperty', new Uint8Array([1])); // 読まない項目は飛ばされる
      })],
      [P1, id(103), charBlob((s) => { s.name('CharacterID', 'SheepBall').byte('Level', 7); slotId(s, C_BASE, 0); })],
      [P1, id(104), charBlob((s) => { s.name('CharacterID', 'ChickenPal'); slotId(s, C_UNKNOWN, 0); })],
      [P1, id(105), new Uint8Array([1, 2, 3])], // 壊れたエントリ
    ];
    ws.map('CharacterSaveParameterMap', 'StructProperty', 'StructProperty', chars.map(([p, i, b]) => [[p, i], b]),
      (k, [p, i]) => k.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(p)).nativeStruct('InstanceId', 'Guid', (x) => x.guid(i)).str('DebugName', '').none(),
      (v, b) => v.byteArray('RawData', b).none());
    // 巨大なはずの Foliage は丸ごと飛ばす（中身は未知の型でもよい）
    ws.map('FoliageGridSaveDataMap', 'StructProperty', 'StructProperty', [[0, 0]], (k) => k.raw('X', 'MysteryProperty', new Uint8Array(4)).none(), (v) => v.none());
    const baseBlob = (bid, x) => {
      const w = new ByteWriter().guid(bid).fstring('tmpl').u8(1);
      transform(w, x, 0, 0);
      w.f32(3500).guid(GUILD);
      transform(w);
      return w.guid(ZERO_GUID).u32(0).toBytes();
    };
    const wdBlob = (cid) => {
      const w = new ByteWriter().guid(ZERO_GUID);
      transform(w);
      return w.u8(0).u8(0).guid(cid).u32(0).toBytes();
    };
    ws.map('BaseCampSaveData', 'StructProperty', 'StructProperty', [[BASE1, [C_BASE, 100]], [BASE2, [id(15), 200]]],
      (k, b) => k.guid(b),
      (v, [cid, x], ) => v.byteArray('RawData', baseBlob(cid === C_BASE ? BASE1 : BASE2, x))
        .structProps('WorkerDirector', 'PalBaseCampSaveData_WorkerDirector', (s) => s.byteArray('RawData', wdBlob(cid))).none());
    const groupBlob = new ByteWriter().guid(GUILD).fstring('').u32(0).u8(1).u32(0)
      .u32(2).guid(BASE2).guid(BASE1) // base_ids: BASE2 が 1 番
      .i32(0).i32(5).u32(0).fstring('ギルド').guid(ZERO_GUID).u32(0)
      .guid(P1).u32(1).guid(P1).i64(0).fstring('Alice').u32(0) // 旧形式の末尾
      .toBytes();
    ws.map('GroupSaveDataMap', 'StructProperty', 'StructProperty', [[GUILD, groupBlob]], (k, g) => k.guid(g),
      (v, b) => v.enumProp('GroupType', 'EPalGroupType', 'EPalGroupType::Guild').byteArray('RawData', b).none());
    const slotBlob = (i, staticId, local) => new ByteWriter().i32(i).i32(1).fstring(staticId).guid(ZERO_GUID).guid(local).u32(0).toBytes();
    ws.map('ItemContainerSaveData', 'StructProperty', 'StructProperty',
      [[IC_GROUND, [0, 'PalEgg_Fire_01', id(201)]], [IC_INV, [4, 'PalEgg_Dark_02', id(202)]], [IC_ORPHAN, [0, 'PalEgg_Ice_05', id(203)]]],
      (k, c) => k.nativeStruct('ID', 'Guid', (x) => x.guid(c)).none(),
      (v, [i, s, l]) => v.structArray('Slots', 'PalItemSlotSaveData', [0], (e) => e.byteArray('RawData', slotBlob(i, s, l)).none()).none());
    const eggBlob = (local, staticId, fill) => {
      const w = new GvasWriter().guid(ZERO_GUID).guid(local).fstring(staticId).u32(0).fstring('X');
      if (fill) sp(fill)(w);
      return w.none().bytes(new Uint8Array(28)).toBytes();
    };
    const armor = new ByteWriter().guid(ZERO_GUID).guid(id(299)).fstring('Armor').u32(0).f32(10).u32(0).toBytes();
    ws.structArray('DynamicItemSaveData', 'PalDynamicItemSaveData', [
      eggBlob(id(201), 'PalEgg_Fire_01', (s) => s.name('CharacterID', 'FoxMage').array('PassiveSkillList', 'NameProperty', ['Swift'])),
      eggBlob(id(202), 'PalEgg_Dark_02', (s) => s.name('CharacterID', 'Werewolf')),
      eggBlob(id(203), 'PalEgg_Ice_05', null), // 誰も参照しないコンテナ → orphan
      eggBlob(id(204), 'PalEgg_Ice_05', null), // どのコンテナにも無い → orphan
      armor,
    ], (e, b) => e.byteArray('RawData', b).none());
    const modelBlob = (x, y, z) => {
      const w = new ByteWriter().guid(ZERO_GUID).guid(ZERO_GUID).guid(BASE1).guid(GUILD).i32(1).i32(1);
      transform(w, x, y, z);
      return w.guid(ZERO_GUID).guid(ZERO_GUID).guid(ZERO_GUID).guid(P1).u8(0).f32(0).guid(ZERO_GUID).u32(0).toBytes();
    };
    const moduleBlob = (cid) => new ByteWriter().guid(cid).u32(0).u32(0).u32(0).u8(0).u32(0).toBytes();
    ws.structArray('MapObjectSaveData', 'PalMapObjectSaveData', [['PalEgg_Fire', IC_GROUND]], (e, [mid, cid]) => {
      e.name('MapObjectId', mid)
        .structProps('Model', 'PalMapObjectModelSaveData', (s) => s.byteArray('RawData', modelBlob(1, 2, 3)).raw('Paint', 'MysteryProperty', new Uint8Array(2)))
        .structProps('ConcreteModel', 'PalMapObjectConcreteModelSaveData', (s) => {
          s.map('ModuleMap', 'EnumProperty', 'StructProperty', [['EPalMapObjectConcreteModelModuleType::ItemContainer', cid]],
            (k, n) => k.fstring(n), (v, c) => v.byteArray('RawData', moduleBlob(c)).none());
        })
        .none();
    });
  });
  const level = parseLevel(finishGvas(lv));
  assert.deepEqual(level.malformed, { characters: 1 });

  // --- Player / DPS / Meta ---
  const pw = gvasWithHeader({ className: '/Script/Pal.PalWorldPlayerSaveGame' });
  const cont = (s, name, c) => s.structProps(name, 'PalContainerId', (t) => t.nativeStruct('ID', 'Guid', (x) => x.guid(c)));
  pw.structProps('SaveData', 'PalWorldPlayerSaveData', (s) => {
    s.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(P1));
    cont(s, 'OtomoCharacterContainerId', C_PARTY);
    cont(s, 'PalStorageContainerId', C_BOX);
    s.structProps('InventoryInfo', 'PalPlayerDataInventoryInfo', (t) => cont(t, 'CommonContainerId', IC_INV));
  });
  const player = parsePlayer(finishGvas(pw));
  assert.deepEqual(player.inventoryContainers, { Common: IC_INV });

  const dw = gvasWithHeader({ className: '/Script/Pal.PalDimensionPalStorageSaveGame' });
  dw.structArray('SaveParameterArray', 'PalDimensionPalStorageSaveParameter', [
    ['None', id(0)], ['Anubis', id(301)], ['BROKEN', id(302)], ['NightFox', id(102)],
  ], (e, [cid, iid]) => {
    if (cid === 'BROKEN') e.structProps('SaveParameter', 'P', (s) => s.raw('PassiveSkillList', 'ArrayProperty', new Uint8Array([0xff])));
    else sp((s) => { s.name('CharacterID', cid).byte('Level', 30); owner(s, P1); })(e);
    e.structProps('InstanceId', 'PalInstanceID', (s) => s.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(ZERO_GUID))
      .nativeStruct('InstanceId', 'Guid', (x) => x.guid(iid)).str('DebugName', '')).none();
  });
  const dps = parsePalStorage(finishGvas(dw));
  assert.equal(dps.kind, 'dps');
  assert.equal(dps.slotCount, 4);
  assert.deepEqual(dps.malformed, { slots: 1 });
  assert.deepEqual(dps.pals.map((p) => p.characterId), ['Anubis', 'NightFox']);

  const mw = gvasWithHeader({ className: '/Script/Pal.PalWorldBaseInfoSaveGame' });
  mw.structProps('SaveData', 'PalWorldBaseInfoSaveData', (s) => s.str('WorldName', 'テスト').str('HostPlayerName', 'Alice').int('InGameDay', 3));
  const meta = parseLevelMeta(finishGvas(mw));

  const snap = buildSnapshot({ level, players: [player], dps: [{ playerUid: P1, data: dps }], meta });
  assert.deepEqual(snap.world, { name: 'テスト', hostName: 'Alice', savedAt: '1970-01-01T00:00:01.000Z', inGameDay: 3 });
  assert.deepEqual(snap.players, [{ uid: P1, name: 'Alice', level: 10 }]);
  assert.deepEqual(snap.guilds, [{ id: GUILD, name: 'ギルド', baseIds: [BASE2, BASE1], playerUids: [P1] }]);
  assert.deepEqual(snap.bases.map((b) => [b.id, b.number, b.containerId, b.position.x]), [[BASE2, 1, id(15), 200], [BASE1, 2, C_BASE, 100]]);
  const byChar = Object.fromEntries(snap.pals.map((p) => [p.characterId, p]));
  assert.deepEqual(byChar.NightFox, {
    instanceId: id(102), source: 'level', characterId: 'NightFox', nickname: '', gender: 'Female', level: 1, rank: 3,
    passives: ['Rare', 'Legend'], talent: { hp: 50, shot: 0, defense: 0 }, isRare: true, ownerUid: P1, lastOwnerUid: P1,
    location: { kind: 'party', playerUid: P1, baseId: '', containerId: C_PARTY, slotIndex: 2, mapObjectId: '', itemId: '', position: null },
  });
  assert.equal(byChar.SheepBall.location.kind, 'base');
  assert.equal(byChar.SheepBall.location.baseId, BASE1);
  assert.equal(byChar.SheepBall.level, 7);
  assert.equal(byChar.ChickenPal.location.kind, 'unknown');
  assert.deepEqual([byChar.Anubis.source, byChar.Anubis.location.kind, byChar.Anubis.location.slotIndex, byChar.Anubis.location.playerUid], ['dps', 'dps', 1, P1]);
  assert.deepEqual({ ...byChar.FoxMage.location }, {
    kind: 'egg-ground', playerUid: P1, baseId: BASE1, containerId: IC_GROUND, slotIndex: 0, mapObjectId: 'PalEgg_Fire',
    itemId: 'PalEgg_Fire_01', position: { x: 1, y: 2, z: 3 },
  });
  assert.equal(byChar.FoxMage.instanceId, id(201));
  assert.deepEqual(byChar.FoxMage.passives, ['Swift']);
  assert.deepEqual([byChar.Werewolf.location.kind, byChar.Werewolf.location.playerUid, byChar.Werewolf.location.slotIndex], ['egg-inventory', P1, 4]);
  assert.equal(snap.stats.orphanEggs, 2);
  assert.deepEqual(snap.stats.orphanEggsDetail, { noParams: 0, noContainer: 1, unreferencedContainer: 1 });
  assert.equal(snap.stats.duplicates, 1); // dps 側の NightFox は Level と同じ instanceId
  assert.equal(snap.stats.unknownLocation, 1);
  assert.deepEqual(snap.stats.malformed, { 'level.characters': 1, 'dps.slots': 1 });
  assert.equal(snap.pals.length, 6);
  // 結果はプレーンなデータ（元バッファを参照しない）
  assert.doesNotThrow(() => structuredClone(level));
  assert.ok(!JSON.stringify(level).includes('"buffer"'));
});
