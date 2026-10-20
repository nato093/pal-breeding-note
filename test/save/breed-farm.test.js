// 配合牧場（親の割り当てと産んだタマゴ）の読み取り。合成バイト列だけを使う（実セーブのバイトは含めない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZERO_GUID } from '../../web/js/save/gvas.js';
import { parseLevel, buildSnapshot } from '../../web/js/save/palworld.js';
import { ByteWriter, GvasWriter, gvasWithHeader, finishGvas } from '../helpers/gvas-writer.js';
import data from '../../web/data/breeding.js';
import pals from '../../web/data/pals.js';
import { decodeBreeding } from '../../web/js/core/breeding.js';
import { createSpeciesResolver } from '../../web/js/core/owned.js';
import { findNewBreedings } from '../../web/js/core/auto-breeding.js';

const id = (n) => `${String(n).padStart(8, '0')}-0000-0000-0000-00000000bbbb`;
const P1 = id(1);
const P2 = id(2);
const BASE = id(31);
const transform = (w) => w.f64(0).f64(0).f64(0).f64(1).f64(0).f64(0).f64(0).f64(1).f64(1).f64(1);
const sp = (fill) => (s) => s.structProps('SaveParameter', 'PalIndividualCharacterSaveParameter', fill);
const charBlob = (fill) => {
  const w = new GvasWriter();
  sp(fill)(w);
  return w.none().u32(0).guid(ZERO_GUID).u32(0).toBytes();
};
const pal = (characterId, gender, depositor, owner = null) => charBlob((s) => {
  s.name('CharacterID', characterId).enumProp('Gender', 'EPalGenderType', `EPalGenderType::${gender}`);
  if (owner) s.nativeStruct('OwnerPlayerUId', 'Guid', (x) => x.guid(owner));
  if (depositor) s.structArray('OldOwnerPlayerUIds', 'Guid', [depositor], (e, g) => e.guid(g));
});
const modelBlob = (instanceId, concreteId) => {
  const w = new ByteWriter().guid(instanceId).guid(concreteId).guid(BASE).guid(ZERO_GUID).i32(1).i32(1);
  transform(w);
  return w.guid(ZERO_GUID).guid(ZERO_GUID).guid(ZERO_GUID).guid(P1).u8(0).f32(0).guid(ZERO_GUID).u32(0).toBytes();
};
const farmBlob = (concreteId, modelId, eggObjects, count = eggObjects.length) => {
  const w = new ByteWriter().guid(concreteId).guid(modelId).u32(0).u32(count);
  for (const egg of eggObjects) w.guid(egg);
  return w.f32(300).u32(2).toBytes();
};
// rawdata/work.py: id・workable_bounds(112)・base_camp_id・owner_map_object_model_id・concrete_model_id・…
const workBlob = (ownerModelId) => new ByteWriter().guid(id(900)).bytes(new Uint8Array(112)).guid(BASE)
  .guid(ownerModelId).guid(ZERO_GUID).u8(0).u32(0).toBytes();
const assignBlob = (instanceId) => new ByteWriter().guid(id(901)).i32(0).u8(1).guid(ZERO_GUID).guid(instanceId)
  .u8(2).u32(1).u32(0).toBytes();
const moduleBlob = (containerId) => new ByteWriter().guid(containerId).u32(0).u32(0).u32(0).u8(0).u32(0).toBytes();
const slotBlob = (local) => new ByteWriter().i32(0).i32(1).fstring('PalEgg_Earth_01').guid(ZERO_GUID).guid(local).u32(0).toBytes();
const eggBlob = (local, characterId) => {
  const w = new GvasWriter().guid(ZERO_GUID).guid(local).fstring('PalEgg_Earth_01').u32(0).fstring('X');
  sp((s) => s.name('CharacterID', characterId))(w);
  return w.none().bytes(new Uint8Array(28)).toBytes();
};

// 古代文明の配合器の ConcreteModel.RawData（palworld.js の decodeBreeder の並び）。eggs はタマゴの数、parents は親の InstanceId
const breederBlob = (concreteId, modelId, parents, { eggs = 0, tail = new Uint8Array(0) } = {}) => {
  const w = new GvasWriter().guid(concreteId).guid(modelId).u32(0).u32(eggs);
  for (let i = 0; i < eggs; i++) {
    w.i32(i).guid(id(800 + i));
    sp((s) => s.name('CharacterID', 'SheepBall').enumProp('Gender', 'EPalGenderType', 'EPalGenderType::Female'))(w);
    w.none().bytes(new Uint8Array(28));
  }
  w.u32(0).f32(3.5).f32(10).u32(parents.length);
  for (const parent of parents) w.guid(P1).guid(parent);
  return w.guid(id(899)).u32(0).bytes(tail).toBytes();
};

/**
 * farms: [{ n, parents: [[instanceId, characterId, gender, depositor]], eggs: [characterId], concrete?: (default) => bytes, assigns?: instanceId[] }]
 * breeders: [{ n, parents: [[instanceId, characterId, gender, depositor]], eggs: [characterId], concrete?: (concreteId, modelId, parentIds) => bytes,
 *   ids?: 親の InstanceId（既定は parents の個体）, container?: false で入れ物なし }]
 */
function buildLevel(farms, breeders = []) {
  const chars = [];
  const mapObjects = [];
  const works = [];
  const containers = [];
  const items = [];
  for (const farm of farms) {
    const modelId = id(farm.n * 100);
    const concreteId = id(farm.n * 100 + 1);
    const eggObjects = farm.eggs.map((_, i) => id(farm.n * 100 + 10 + i));
    farm.eggs.forEach((characterId, i) => {
      const container = id(farm.n * 100 + 20 + i);
      const local = id(farm.n * 100 + 30 + i);
      mapObjects.push(['PalEgg_Earth', modelBlob(eggObjects[i], ZERO_GUID), null, container]);
      containers.push([container, local]);
      items.push(eggBlob(local, characterId));
    });
    for (const [instanceId, characterId, gender, depositor, owner] of farm.parents) chars.push([instanceId, pal(characterId, gender, depositor, owner)]);
    const concrete = farm.concrete ? farm.concrete(concreteId, modelId, eggObjects) : farmBlob(concreteId, modelId, eggObjects);
    mapObjects.push(['BreedFarm', modelBlob(modelId, concreteId), concrete, null]);
    works.push([workBlob(modelId), farm.assigns ?? farm.parents.map(([instanceId]) => instanceId)]);
  }
  for (const breeder of breeders) {
    const modelId = id(breeder.n * 100);
    const concreteId = id(breeder.n * 100 + 1);
    const container = id(breeder.n * 100 + 20);
    const locals = breeder.eggs.map((_, i) => id(breeder.n * 100 + 30 + i));
    breeder.eggs.forEach((characterId, i) => items.push(eggBlob(locals[i], characterId)));
    if (locals.length) containers.push([container, locals]);
    for (const [instanceId, characterId, gender, depositor, owner] of breeder.parents) chars.push([instanceId, pal(characterId, gender, depositor, owner)]);
    const ids = breeder.ids ?? breeder.parents.map(([instanceId]) => instanceId);
    const concrete = breeder.concrete ? breeder.concrete(concreteId, modelId, ids) : breederBlob(concreteId, modelId, ids, { eggs: locals.length });
    mapObjects.push(['MultiElectricHatchingPalEggWithBreed', modelBlob(modelId, concreteId), concrete, breeder.container === false ? null : container]);
  }
  const lv = gvasWithHeader({ className: '/Script/Pal.PalWorldSaveGame' });
  lv.structProps('worldSaveData', 'PalWorldSaveData', (ws) => {
    ws.map('CharacterSaveParameterMap', 'StructProperty', 'StructProperty', chars,
      (k, i) => k.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(ZERO_GUID)).nativeStruct('InstanceId', 'Guid', (x) => x.guid(i)).str('DebugName', '').none(),
      (v, b) => v.byteArray('RawData', b).none());
    ws.map('ItemContainerSaveData', 'StructProperty', 'StructProperty', containers,
      (k, c) => k.nativeStruct('ID', 'Guid', (x) => x.guid(c)).none(),
      (v, locals) => v.structArray('Slots', 'PalItemSlotSaveData', [locals].flat(), (e, local) => e.byteArray('RawData', slotBlob(local)).none()).none());
    ws.structArray('DynamicItemSaveData', 'PalDynamicItemSaveData', items, (e, b) => e.byteArray('RawData', b).none());
    ws.structArray('MapObjectSaveData', 'PalMapObjectSaveData', mapObjects, (e, [mid, model, concrete, container]) => {
      e.name('MapObjectId', mid)
        .structProps('Model', 'PalMapObjectModelSaveData', (s) => s.byteArray('RawData', model))
        .structProps('ConcreteModel', 'PalMapObjectConcreteModelSaveData', (s) => {
          s.byteArray('RawData', concrete ?? new Uint8Array(0));
          s.map('ModuleMap', 'EnumProperty', 'StructProperty', container ? [['EPalMapObjectConcreteModelModuleType::ItemContainer', container]] : [],
            (k, n) => k.fstring(n), (v, c) => v.byteArray('RawData', moduleBlob(c)).none());
        })
        .none();
    });
    ws.structArray('WorkSaveData', 'PalWorkSaveData', works, (e, [raw, assigns]) => {
      e.enumProp('WorkableType', 'EPalWorkableType', 'EPalWorkableType::OnlyJoinAndWalkAround').byteArray('RawData', raw)
        .map('WorkAssignMap', 'IntProperty', 'StructProperty', assigns.map((instanceId, i) => [i, instanceId]),
          (k, i) => k.i32(i), (v, instanceId) => v.byteArray('RawData', assignBlob(instanceId)).none())
        .none();
    });
  });
  return parseLevel(finishGvas(lv));
}

const farmsOf = (level) => buildSnapshot({ level }).breedFarms;

test('配合牧場: 割り当てられた親 2 体（性別・預けた人）と、産んだタマゴの中身を読む', () => {
  const level = buildLevel([{
    n: 1,
    parents: [[id(11), 'BOSS_SheepBall', 'Female', P1], [id(12), 'SwordCutlassfish', 'Male', P2]],
    eggs: ['GuardianDog', 'GuardianDog'],
  }]);
  assert.deepEqual(level.malformed, {});
  const [farm] = farmsOf(level);
  assert.deepEqual(farm, {
    id: id(100), baseId: BASE, status: 'ok',
    parents: [
      { instanceId: id(11), characterId: 'BOSS_SheepBall', gender: 'Female', depositorUid: P1 },
      { instanceId: id(12), characterId: 'SwordCutlassfish', gender: 'Male', depositorUid: P2 },
    ],
    eggs: [
      { localId: id(130), characterId: 'GuardianDog', itemId: 'PalEgg_Earth_01' },
      { localId: id(131), characterId: 'GuardianDog', itemId: 'PalEgg_Earth_01' },
    ],
    // 入れ物（ModuleMap の ItemContainer）のない牧場はケーキが分からない（save-extras）
    cakes: null,
  });
  assert.doesNotThrow(() => structuredClone(farm));
});

test('配合牧場: 親がいない・1 体の牧場もそのまま返す（照合しないのは自動登録の側）', () => {
  const farms = farmsOf(buildLevel([
    { n: 1, parents: [], eggs: ['GuardianDog'] },
    { n: 2, parents: [[id(21), 'ClownRabbit', 'Female', P1]], eggs: [] },
  ]));
  assert.deepEqual(farms.map((f) => [f.status, f.parents.length, f.eggs.length]), [['ok', 0, 1], ['ok', 1, 0]]);
});

test('配合牧場: 壊れた・食い違うデータの牧場は uncertain にする', () => {
  const two = (n) => [[id(n * 10 + 1), 'SheepBall', 'Female', P1], [id(n * 10 + 2), 'PinkCat', 'Male', P1]];
  const level = buildLevel([
    { n: 1, parents: two(1), eggs: ['SheepBall'], concrete: (c, m) => new ByteWriter().guid(c).guid(m).u32(0).toBytes() }, // 途中で切れている
    { n: 2, parents: two(2), eggs: ['SheepBall'], concrete: (c, m, eggs) => farmBlob(c, m, eggs, 100000) }, // 件数が大きすぎる
    { n: 3, parents: [...two(3), [id(33), 'Boar', 'Male', P1]], eggs: ['SheepBall'] }, // 3 体の割り当て
    { n: 4, parents: two(4), eggs: ['SheepBall'], assigns: [id(41), id(49)] }, // 親の個体が見つからない
    { n: 5, parents: two(5), eggs: ['SheepBall'], assigns: [id(51), ZERO_GUID] }, // ゼロ GUID
    { n: 6, parents: two(6), eggs: ['SheepBall'], assigns: [id(61), id(61)] }, // 同じ個体が重なる
    { n: 7, parents: two(7), eggs: ['SheepBall'], concrete: (c, m, eggs) => farmBlob(c, id(999), eggs) }, // モデル ID が違う
    { n: 8, parents: two(8), eggs: ['SheepBall'], concrete: (c, m, eggs) => farmBlob(c, m, [...eggs, ZERO_GUID]) }, // タマゴの参照にゼロ GUID
  ]);
  assert.equal(level.malformed.breedFarms, 4);
  assert.deepEqual(farmsOf(level).map((f) => f.status), Array(8).fill('uncertain'));
});

test('配合牧場: 預けた人が記録されていない親は、持ち主で代わりにせず空にする', () => {
  const [farm] = farmsOf(buildLevel([{
    n: 1, parents: [[id(11), 'SheepBall', 'Female', null, P2], [id(12), 'PinkCat', 'Male', P1]], eggs: ['SheepBall'],
  }]));
  assert.deepEqual(farm.parents.map((p) => p.depositorUid), ['', P1]);
});

test('配合牧場: 牧場のないセーブでは空の一覧', () => {
  assert.deepEqual(farmsOf(buildLevel([])), []);
});

// ---- 古代文明の配合器（MultiElectricHatchingPalEggWithBreed） ----

const breedersOf = (level) => buildSnapshot({ level }).breeders;

test('配合器: 配合している親 2 体（性別・預けた人）と、中のタマゴを読む。牧場の一覧には入れない', () => {
  const level = buildLevel([], [{
    n: 5,
    parents: [[id(51), 'NightLady_Dark', 'Female', P1], [id(52), 'Kitsunebi', 'Male', P2]],
    eggs: ['GuardianDog', 'SheepBall'],
  }]);
  assert.deepEqual(level.malformed, {});
  const snapshot = buildSnapshot({ level });
  assert.deepEqual(snapshot.breedFarms, []);
  assert.deepEqual(snapshot.breeders, [{
    id: id(500), baseId: BASE, status: 'ok',
    parents: [
      { instanceId: id(51), characterId: 'NightLady_Dark', gender: 'Female', depositorUid: P1 },
      { instanceId: id(52), characterId: 'Kitsunebi', gender: 'Male', depositorUid: P2 },
    ],
    eggs: [
      { localId: id(530), characterId: 'GuardianDog', itemId: 'PalEgg_Earth_01' },
      { localId: id(531), characterId: 'SheepBall', itemId: 'PalEgg_Earth_01' },
    ],
  }]);
  // 中のタマゴは、今までどおり所持パルの一覧に孵化器のタマゴとして出る
  const eggs = snapshot.pals.filter((p) => p.source === 'egg');
  assert.deepEqual(eggs.map((p) => [p.location.kind, p.location.mapObjectId]), Array(2).fill(['egg-incubator', 'MultiElectricHatchingPalEggWithBreed']));
  assert.doesNotThrow(() => structuredClone(snapshot.breeders));
});

test('配合器: 親のいない・タマゴのない配合器もそのまま返す（照合しないのは自動登録の側）', () => {
  const breeders = breedersOf(buildLevel([], [
    { n: 5, parents: [], eggs: ['GuardianDog'] },
    { n: 6, parents: [[id(61), 'SheepBall', 'Female', P1], [id(62), 'PinkCat', 'Male', P1]], eggs: [] },
  ]));
  assert.deepEqual(breeders.map((b) => [b.status, b.parents.length, b.eggs.length]), [['ok', 0, 1], ['ok', 2, 0]]);
});

test('配合器: 形の違う・食い違うデータの配合器は uncertain にする', () => {
  const two = (n) => [[id(n * 10 + 1), 'SheepBall', 'Female', P1], [id(n * 10 + 2), 'PinkCat', 'Male', P1]];
  const level = buildLevel([], [
    { n: 1, parents: two(1), eggs: [], concrete: (c, m) => new ByteWriter().guid(c).guid(m).u32(0).toBytes() }, // 途中で切れている
    { n: 2, parents: two(2), eggs: [], concrete: (c, m, ids) => breederBlob(c, m, ids, { tail: new Uint8Array([1, 2, 3, 4]) }) }, // 知らない項目が続く
    { n: 3, parents: two(3), eggs: [], concrete: (c, m, ids) => breederBlob(c, m, [...ids, id(39)]) }, // 親が 3 体
    { n: 4, parents: two(4), eggs: [], concrete: (c, m, ids) => breederBlob(c, id(999), ids) }, // モデル ID が違う
    { n: 5, parents: two(5), eggs: [], ids: [id(51), ZERO_GUID] }, // ゼロ GUID
    { n: 6, parents: two(6), eggs: [], ids: [id(61), id(61)] }, // 同じ個体が重なる
    { n: 7, parents: two(7), eggs: [], container: false }, // タマゴの入れ物がない
    { n: 8, parents: two(8), eggs: [], ids: [id(81), id(89)] }, // 親の個体が見つからない（buildSnapshot で uncertain）
    { n: 9, parents: two(9), eggs: [], concrete: (c, m, ids) => new ByteWriter().guid(c).guid(m).u32(0).u32(100000).toBytes() }, // タマゴの数が大きすぎる
  ]);
  assert.equal(level.malformed.breeders, 8);
  assert.deepEqual(breedersOf(level).map((b) => b.status), Array(9).fill('uncertain'));
});

test('配合器: 配合器のないセーブでは空の一覧', () => {
  assert.deepEqual(breedersOf(buildLevel([])), []);
});

test('配合器: RawData が読めなくても、中のタマゴは孵化器のタマゴとして残り、牧場の外のタマゴとして牧場の親と照合される（Codex の再レビュー）', () => {
  const sheep = [[id(11), 'SheepBall', 'Female', P1], [id(12), 'SwordCutlassfish', 'Male', P1]];
  const broken = (c, m, ids) => breederBlob(c, m, ids, { tail: new Uint8Array([1, 2, 3, 4]) });
  const read = (eggs) => buildSnapshot({ level: buildLevel([{ n: 1, parents: sheep, eggs: [] }], [{ n: 5, parents: [], eggs, concrete: broken }]) });
  const after = read(['GuardianDog']);
  assert.equal(after.breeders[0].status, 'uncertain');
  assert.deepEqual(after.pals.filter((p) => p.source === 'egg').map((p) => [p.instanceId, p.location.kind]), [[id(530), 'egg-incubator']]);
  const deps = { resolveSpecies: createSpeciesResolver(pals), table: decodeBreeding(data) };
  const { history } = findNewBreedings(read([]), { ...deps, history: null });
  const { candidates } = findNewBreedings(after, { ...deps, history });
  assert.deepEqual(candidates.map((c) => [c.record.childId, c.evidence.map((e) => e.farmId)]), [['GuardianDog', [id(100)]]]);
});
