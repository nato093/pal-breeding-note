import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateWishlist, parseWishes } from '../../web/js/goals-migration.js';
import { parseGoals, cleanGoal, speciesGoal } from '../../web/js/core/ideal-goals.js';
import { parseObservations } from '../../web/js/core/goal-observations.js';

const NS = 'pal-note';
const WISH = 'pal-note.wishlist.test.自分';
const GOALS = 'pal-note.ideals.test.自分';
const OBS = 'pal-note.goalsObs.test.自分';
const run = (storage) => migrateWishlist({ storage, namespace: NS, env: 'test', userKey: '自分', now: () => Date.UTC(2026, 9, 15) });

// setItem を失敗させられる偽の storage（fail に失敗させるキーを入れる）
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values, fail: new Set(), drop: new Set(),
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (this.fail.has(key)) throw new Error('QuotaExceededError');
      // drop: 書いたことにして中身を残さない（読み戻しの不一致）
      if (!this.drop.has(key)) values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
}
const wishes = (...palIds) => JSON.stringify(palIds.map((palId, index) => ({
  palId, addedAt: `2026-10-0${index + 1}T00:00:00.000Z`, craftable: palId === 'SheepBall', readyAt: palId === 'SheepBall' ? '2026-10-05T00:00:00.000Z' : '',
  observedAt: '2026-10-06T00:00:00.000Z', pairs: palId === 'SheepBall' ? ['FlowerDoll|PinkCat'] : [], found: [],
})));
const goalsOf = (storage) => parseGoals(storage.getItem(GOALS));
const obsOf = (storage) => parseObservations(storage.getItem(OBS));

test('ウィッシュリストの移行: ウィッシュ 3 件 → 種族だけの目標 3 件（id wish-<palId>）と観測ができ、旧キーが消える。2 回目を走らせても変わらない', () => {
  const storage = memoryStorage({ [WISH]: wishes('SheepBall', 'PinkCat', 'Alpaca') });
  assert.deepEqual(run(storage), { status: 'done', migrated: 3, pending: 0 });
  const goals = goalsOf(storage);
  assert.deepEqual(goals.map((goal) => [goal.id, goal.palId, goal.name, goal.passives, goal.targets, goal.addedAt]), [
    ['wish-SheepBall', 'SheepBall', 'モコロン', [], { hp: 0, shot: 0, defense: 0 }, '2026-10-01T00:00:00.000Z'],
    ['wish-PinkCat', 'PinkCat', 'ツッパニャン', [], { hp: 0, shot: 0, defense: 0 }, '2026-10-02T00:00:00.000Z'],
    ['wish-Alpaca', 'Alpaca', 'メルパカ', [], { hp: 0, shot: 0, defense: 0 }, '2026-10-03T00:00:00.000Z'],
  ]);
  const obs = obsOf(storage);
  // 観測はウィッシュの状態のまま（作れる・作れるようになった時刻・見た組）
  assert.deepEqual(obs.species.SheepBall, { craftable: true, readyAt: '2026-10-05T00:00:00.000Z', observedAt: '2026-10-06T00:00:00.000Z', pairs: ['FlowerDoll|PinkCat'], found: [] });
  assert.deepEqual(obs.migration.wishlist.migrated, { SheepBall: 'wish-SheepBall', PinkCat: 'wish-PinkCat', Alpaca: 'wish-Alpaca' });
  assert.equal(obs.migration.wishlist.doneAt, '2026-10-15T00:00:00.000Z');
  assert.equal(storage.getItem(WISH), null);
  const before = storage.getItem(GOALS);
  assert.deepEqual(run(storage), { status: 'none', migrated: 0, pending: 0 });
  // 旧キーが書き戻されても（前の版のタブ）、移した記録で同じ結果
  storage.setItem(WISH, wishes('SheepBall', 'PinkCat', 'Alpaca'));
  assert.equal(run(storage).status, 'done');
  assert.equal(storage.getItem(GOALS), before);
});

test('ウィッシュリストの移行: 同じ条件の目標がすでにある種族は、目標を増やさず観測だけ併せる', () => {
  const existing = cleanGoal({ ...speciesGoal('SheepBall', { name: 'もこ' }), id: 'mine-1' });
  const storage = memoryStorage({ [WISH]: wishes('SheepBall'), [GOALS]: JSON.stringify([existing]) });
  assert.equal(run(storage).status, 'done');
  assert.deepEqual(goalsOf(storage).map((goal) => [goal.id, goal.name]), [['mine-1', 'もこ']]);
  assert.equal(obsOf(storage).migration.wishlist.migrated.SheepBall, 'mine-1');
  assert.equal(obsOf(storage).species.SheepBall.craftable, true);
});

test('ウィッシュリストの移行: 目標が 98 件のときウィッシュ 5 件 → 2 件だけ移り、残り 3 件は未移行で旧キーを残す。空きができたら残りが移る', () => {
  const many = Array.from({ length: 98 }, (_, index) => cleanGoal({ ...speciesGoal('SheepBall'), id: `g${index}`, passives: ['Rare'], targets: { hp: index, shot: 0, defense: 0 } }));
  const storage = memoryStorage({ [WISH]: wishes('Alpaca', 'Boar', 'Deer', 'Kitsunebi', 'PinkCat'), [GOALS]: JSON.stringify(many) });
  assert.deepEqual(run(storage), { status: 'partial', migrated: 2, pending: 3 });
  assert.equal(goalsOf(storage).length, 100);
  assert.deepEqual(obsOf(storage).migration.wishlist.pending, ['Deer', 'Kitsunebi', 'PinkCat']);
  assert.ok(storage.getItem(WISH));
  // 目標を 3 件外してから走らせると残りが移って旧キーが消える
  storage.setItem(GOALS, JSON.stringify(goalsOf(storage).slice(3)));
  assert.deepEqual(run(storage), { status: 'done', migrated: 3, pending: 0 });
  assert.equal(storage.getItem(WISH), null);
  assert.deepEqual(goalsOf(storage).slice(-3).map((goal) => goal.id), ['wish-Deer', 'wish-Kitsunebi', 'wish-PinkCat']);
});

test('ウィッシュリストの移行: 目標・観測の書き込みの失敗と読み戻しの不一致では旧キーを消さず、次の実行で続きから同じ結果になる', () => {
  const storage = memoryStorage({ [WISH]: wishes('SheepBall', 'PinkCat') });
  storage.fail.add(GOALS);
  assert.equal(run(storage).status, 'failed');
  assert.equal(storage.getItem(GOALS), null);
  assert.ok(storage.getItem(WISH));
  storage.fail.clear();
  storage.fail.add(OBS);
  assert.equal(run(storage).status, 'failed');
  // 目標は書けたが観測が書けなかった: 旧キーは残る
  assert.ok(storage.getItem(WISH));
  storage.fail.clear();
  storage.drop.add(GOALS);
  // 読み戻しで目標が見つからない（一度目に書いた目標を消して試す）: 移行の記録も書かない
  storage.values.delete(GOALS);
  assert.equal(run(storage).status, 'failed');
  assert.ok(storage.getItem(WISH));
  assert.deepEqual(obsOf(storage).migration.wishlist.migrated, {});
  storage.drop.clear();
  // 観測の読み戻しの不一致
  storage.drop.add(OBS);
  assert.equal(run(storage).status, 'failed');
  assert.ok(storage.getItem(WISH));
  storage.drop.clear();
  assert.deepEqual(run(storage), { status: 'done', migrated: 2, pending: 0 });
  assert.deepEqual(goalsOf(storage).map((goal) => goal.id), ['wish-SheepBall', 'wish-PinkCat']);
});

test('ウィッシュリストの移行: 移した目標を利用者が外した後に旧キーへ書き戻されても（前の版のタブ）、その目標は作り直さない', () => {
  const storage = memoryStorage({ [WISH]: wishes('SheepBall', 'PinkCat') });
  run(storage);
  storage.setItem(GOALS, JSON.stringify(goalsOf(storage).filter((goal) => goal.palId !== 'PinkCat')));
  storage.setItem(WISH, wishes('SheepBall', 'PinkCat'));
  assert.equal(run(storage).status, 'done');
  assert.deepEqual(goalsOf(storage).map((goal) => goal.palId), ['SheepBall']);
});

test('ウィッシュリストの移行: 前の版の cleanGoal・parseGoals で目標のキーを書き直しても、移した目標と観測が残る（観測は別のキー）', () => {
  const storage = memoryStorage({ [WISH]: wishes('SheepBall') });
  run(storage);
  // 前の版は目標を同じ形で読み書きする（観測のキーは知らない）
  storage.setItem(GOALS, JSON.stringify(parseGoals(storage.getItem(GOALS))));
  assert.deepEqual(goalsOf(storage).map((goal) => goal.id), ['wish-SheepBall']);
  assert.ok(obsOf(storage).species.SheepBall);
});

test('ウィッシュリストの移行: 旧キーの中身は信用しない（マスターにないパル・壊れた JSON・同じパル）。空なら旧キーを片づけて none', () => {
  assert.deepEqual(parseWishes(JSON.stringify([{ palId: 'SheepBall' }, { palId: '知らない' }, null, { palId: 'SheepBall' }])).map((wish) => wish.palId), ['SheepBall']);
  assert.deepEqual(parseWishes('壊れた'), []);
  const storage = memoryStorage({ [WISH]: '壊れた' });
  assert.equal(run(storage).status, 'none');
  assert.equal(storage.getItem(WISH), null);
  assert.equal(run(memoryStorage()).status, 'none');
});
