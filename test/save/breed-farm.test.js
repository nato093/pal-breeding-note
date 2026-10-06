// 配合牧場（親の割り当てと産んだタマゴ）の読み取り。合成バイト列だけを使う（実セーブのバイトは含めない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZERO_GUID } from '../../web/js/save/gvas.js';
import { parseLevel, buildSnapshot } from '../../web/js/save/palworld.js';
import { ByteWriter, GvasWriter, gvasWithHeader, finishGvas } from '../helpers/gvas-writer.js';

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

/**
 * farms: [{ n, parents: [[instanceId, characterId, gender, depositor]], eggs: [characterId], concrete?: (default) => bytes, assigns?: instanceId[] }]
 */
function buildLevel(farms) {
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
  const lv = gvasWithHeader({ className: '/Script/Pal.PalWorldSaveGame' });
  lv.structProps('worldSaveData', 'PalWorldSaveData', (ws) => {
    ws.map('CharacterSaveParameterMap', 'StructProperty', 'StructProperty', chars,
      (k, i) => k.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(ZERO_GUID)).nativeStruct('InstanceId', 'Guid', (x) => x.guid(i)).str('DebugName', '').none(),
      (v, b) => v.byteArray('RawData', b).none());
    ws.map('ItemContainerSaveData', 'StructProperty', 'StructProperty', containers,
      (k, c) => k.nativeStruct('ID', 'Guid', (x) => x.guid(c)).none(),
      (v, local) => v.structArray('Slots', 'PalItemSlotSaveData', [0], (e) => e.byteArray('RawData', slotBlob(local)).none()).none());
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
