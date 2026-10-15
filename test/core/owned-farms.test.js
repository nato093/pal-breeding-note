import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanOwnedFarms, fitOwnedFarms, isMutationEggItem, validateOwnedUpload, OWNED_FIELDS,
  OWNED_FARMS_MAX_CHARS, OWNED_FARM_EGGS_MAX, OWNED_MAX_FARMS,
} from '../../web/js/core/owned-shared.js';

// 最悪の場合の牧場（ID・拠点・親が 40 字、タマゴの中身 20 個も 40 字の ID）
const longId = (prefix, i) => `${prefix}${String(i).padStart(6, '0')}`.padEnd(40, 'x');
const fullFarm = (i) => ({
  id: longId('F', i), baseId: longId('B', i), parents: [longId('P', i), longId('Q', i)], n: 64,
  eggs: Array.from({ length: OWNED_FARM_EGGS_MAX }, (_, j) => ({ id: longId(`E${i}-`, j), p: 'GrassMinotaur_Electric_Dark', m: 1 })),
});

test('牧場の共有: 突然変異のタマゴのアイテム ID を見分ける', () => {
  assert.equal(isMutationEggItem('PalEgg_MutationPal_Fire_01'), true);
  assert.equal(isMutationEggItem('palegg_mutationpal_x'), true);
  assert.equal(isMutationEggItem('PalEgg_Fire_01'), false);
  assert.equal(isMutationEggItem(undefined), false);
});

test('牧場の共有: cleanOwnedFarms は短い鍵（s・eggs・n・of）を確かめて残し、不正な値と知らない鍵を捨て、古い形（親だけ）も受ける', () => {
  assert.deepEqual(cleanOwnedFarms([
    { id: 'F1', baseId: 'B', parents: ['a', 'b'], n: 3, eggs: [{ id: 'e1', p: 'SheepBall', m: 1, x: 'y' }, { id: 'e2', p: 'bad id!', m: true }, { p: 'SheepBall' }, 'egg'], extra: 1 },
    { id: 'F2', baseId: 'B', parents: [], s: 'u', n: 70, of: 0 },
    { id: 'F3', baseId: 'B', parents: ['a'], s: 'x', n: 1.5, of: 5 },
    { id: 'F4', parents: ['a', 'b', 'c'] },
    { id: 'F5', baseId: 'B', parents: ['c'] },
  ]), [
    { id: 'F1', baseId: 'B', parents: ['a', 'b'], eggs: [{ id: 'e1', p: 'SheepBall', m: 1 }, { id: 'e2' }], n: 3 },
    { id: 'F2', baseId: 'B', parents: [], s: 'u' },
    { id: 'F3', baseId: 'B', parents: ['a'], of: 5 },
    { id: 'F5', baseId: 'B', parents: ['c'] },
  ]);
  // 中身は 1 牧場 20 個まで
  assert.equal(cleanOwnedFarms([fullFarm(0)])[0].eggs.length, OWNED_FARM_EGGS_MAX);
  assert.equal(cleanOwnedFarms([{ ...fullFarm(0), eggs: [...fullFarm(0).eggs, ...fullFarm(1).eggs] }])[0].eggs.length, OWNED_FARM_EGGS_MAX);
});

test('牧場の共有: fitOwnedFarms は 45,000 字に収める（そのまま → 中身を外して数だけ → 牧場を切って of）', () => {
  const size = (value) => JSON.stringify(value).length;
  // (1) 入ればそのまま
  const small = cleanOwnedFarms([fullFarm(0), fullFarm(1)]);
  assert.equal(fitOwnedFarms(small), small);
  // (2) 中身を外すと入る（牧場は全部ある。n は残る）
  const middle = cleanOwnedFarms(Array.from({ length: 30 }, (_, i) => fullFarm(i)));
  assert.ok(size(middle) > OWNED_FARMS_MAX_CHARS);
  const counted = fitOwnedFarms(middle);
  assert.equal(counted.length, 30);
  assert.ok(counted.every((farm) => !('eggs' in farm) && farm.n === 64 && !('of' in farm)));
  assert.ok(size(counted) <= OWNED_FARMS_MAX_CHARS);
  // 最悪の場合（牧場 200・タマゴ 20 個・ID 40 字）でも (2) で全部の牧場が収まる（1 牧場 約 210 字）
  const worst = cleanOwnedFarms(Array.from({ length: OWNED_MAX_FARMS }, (_, i) => fullFarm(i)));
  const fitted = fitOwnedFarms(worst);
  assert.ok(size(fitted) <= OWNED_FARMS_MAX_CHARS, String(size(fitted)));
  assert.equal(fitted.length, OWNED_MAX_FARMS);
  assert.deepEqual(cleanOwnedFarms(fitted), fitted);
  // (3) それでも入らないとき（今の 200 件の上限を超えた入力。上限を変えたときの守り）は、先頭から入る分だけ残して of（元の数）
  const many = Array.from({ length: 400 }, (_, i) => fullFarm(i));
  const cut = fitOwnedFarms(many);
  assert.ok(size(cut) <= OWNED_FARMS_MAX_CHARS, String(size(cut)));
  assert.ok(cut.length > 0 && cut.length < 400);
  assert.ok(cut.every((farm) => farm.of === 400 && !('eggs' in farm)));
  assert.equal(cut[0].id, many[0].id);
  // of の付いた牧場は cleanOwnedFarms を通しても残る（GAS が読み戻すときと同じ形）
  assert.deepEqual(cleanOwnedFarms(cut.slice(0, 3)), cut.slice(0, 3));
});

test('牧場の共有: validateOwnedUpload も同じ上限で farms を縮める（個体の行の共有は止めない）', () => {
  const result = validateOwnedUpload({
    worldId: 'ABCDEF0123456789ABCDEF0123456789', saveUpdatedAt: '2026-10-15T00:00:00.000Z', world: { name: 'W' },
    farms: Array.from({ length: OWNED_MAX_FARMS }, (_, i) => fullFarm(i)),
    columns: OWNED_FIELDS, rows: [OWNED_FIELDS.map((field) => (field === 'instanceId' ? 'p1' : ''))],
  });
  assert.equal(result.ok, true);
  assert.ok(JSON.stringify(result.value.farms).length <= OWNED_FARMS_MAX_CHARS);
  assert.equal(result.value.rows.length, 1);
});
