import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../../web/js/core/index.js';
import { idealPairs, idealPlan } from '../../web/js/core/ideal.js';

test('性能: 理想個体の提案は、同じ種族の ♂1000 × ♀1000（100 万組）でも 2 秒以内', () => {
  let state = 0x49444541;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const passivePool = Array.from({ length: 12 }, (_, i) => `P${i}`);
  const pals = Array.from({ length: 2000 }, (_, i) => {
    const passives = [...new Set(Array.from({ length: Math.floor(random() * 5) }, () => passivePool[Math.floor(random() * passivePool.length)]))];
    const value = () => Math.floor(random() * 101);
    return { id: `I${i}`, palId: 'X', gender: i % 2 ? 'F' : 'M', egg: false, place: 'palbox', passives, talent: { hp: value(), shot: value(), defense: value() } };
  });
  const index = buildIndex([], [{ id: 'X', no: 1, variant: false }]);
  const measure = (label, input) => {
    const start = performance.now();
    const result = idealPairs({ pals, index, target: 'X', ...input });
    const elapsed = performance.now() - start;
    console.log(`${label}: ${elapsed.toFixed(2)} ms（${result.total} 組）`);
    assert.ok(elapsed < 2000, `${label}が 2 秒を超えました: ${elapsed.toFixed(2)} ms`);
    return result;
  };
  assert.equal(measure('パッシブの指定なし', {}).total, 1000000);
  measure('パッシブ 2 個', { passives: ['P0', 'P1'] });
  measure('パッシブ 4 個・ケーキあり', { passives: ['P0', 'P1', 'P2', 'P3'], cake: 'talent', mode: 'only' });
});

test('性能: 世代を重ねる並べ方は、全員が欲しいパッシブを持つ ♂1000 × ♀1000 と、キノコケーキで値が境目付近にばらける ♂200 × ♀200 でも 2 秒以内', () => {
  let state = 0x47454e53;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const junk = ['J0', 'J1', 'J2'];
  const make = (count, low) => Array.from({ length: count * 2 }, (_, i) => {
    const extras = junk.filter(() => random() < 0.3).slice(0, 2);
    const value = () => low + Math.floor(random() * (101 - low));
    return { id: `G${i}`, palId: 'X', gender: i % 2 ? 'F' : 'M', egg: false, place: 'palbox', passives: ['P0', 'P1', ...extras], talent: { hp: value(), shot: value(), defense: value() } };
  });
  const index = buildIndex([], [{ id: 'X', no: 1, variant: false }]);
  const measure = (label, pals, input) => {
    const start = performance.now();
    const { plan, ...rest } = input;
    const result = (plan ? idealPlan : idealPairs)({ pals, index, target: 'X', passives: ['P0', 'P1'], order: 'generations', ...rest });
    const elapsed = performance.now() - start;
    console.log(`${label}: ${elapsed.toFixed(2)} ms（${result.total} 組）`);
    assert.ok(elapsed < 2000, `${label}が 2 秒を超えました: ${elapsed.toFixed(2)} ms`);
    return result;
  };
  assert.equal(measure('世代・ケーキなし ♂1000×♀1000', make(1000, 0), {}).total, 1000000);
  // 配合の計画（完全体作成組・パッシブ厳選組・個体値厳選組の順に、別々の個体の組を上から選ぶ）
  assert.equal(measure('計画・ケーキなし ♂1000×♀1000', make(1000, 0), { plan: true }).pairs.length, 20);
  // 欲しいパッシブが足りない（配合では作れない）ときは、全部の組で個体値がそろうまでの平均を求める
  assert.equal(measure('計画・足りないパッシブ・ケーキなし ♂1000×♀1000', make(1000, 0), { plan: true, passives: ['P0', 'P9'] }).pairs[0].group, 'talent');
  measure('世代・キノコケーキ ♂200×♀200（88〜100）', make(200, 88), { cake: 'talent' });
  // 配合の計画は、条件を満たす組すべてで世代の平均を求める。キノコケーキは最初の 1 個を実際の値で計算するので、
  // 値が 0〜100 にばらけるなら ♂1000 × ♀1000、値が目標の近くに集まるなら（世代の並べ方と同じく）♂200 × ♀200 で 2 秒以内
  assert.equal(measure('計画・キノコケーキ ♂1000×♀1000（0〜100）', make(1000, 0), { plan: true, cake: 'talent' }).pairs.length, 20);
  assert.equal(measure('計画・キノコケーキ ♂200×♀200（88〜100）', make(200, 88), { plan: true, cake: 'talent' }).pairs.length, 20);
  assert.equal(measure('計画・足りないパッシブ・キノコケーキ ♂1000×♀1000（0〜100）', make(1000, 0), { plan: true, cake: 'talent', passives: ['P0', 'P9'] }).pairs.length, 20);
  assert.equal(measure('計画・足りないパッシブ・キノコケーキ ♂200×♀200（88〜100）', make(200, 88), { plan: true, cake: 'talent', passives: ['P0', 'P9'] }).pairs.length, 20);
});

test('性能: 両親合わせて欲しいパッシブがそろう組（欲しいものを欠いて余計を 3〜4 個持つ親を含む）も 2 秒以内。表の作成と使い回しを分けて測る', async () => {
  const { generationTable } = await import('../../web/js/core/ideal.js');
  let state = 0x554e494f;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const junk = ['J0', 'J1', 'J2', 'J3', 'J4', 'J5'];
  // 欲しいパッシブの一部と余計なパッシブを合わせて 4 個まで。先頭の ♂ は欲しいものを持たず余計 4 個、♀ は欲しいものを全部持つ（表が 4 まで広がる）
  const make = (wanted, count, low) => Array.from({ length: count * 2 }, (_, i) => {
    const own = i === 0 ? [] : i === 1 ? [...wanted] : wanted.filter(() => random() < 0.5);
    const extras = i === 0 ? junk.slice(0, 4) : junk.filter(() => random() < 0.4).slice(0, 4 - own.length);
    const value = () => low + Math.floor(random() * (101 - low));
    return { id: `U${i}`, palId: 'X', gender: i % 2 ? 'F' : 'M', egg: false, place: 'palbox', passives: [...own, ...extras], talent: { hp: value(), shot: value(), defense: value() } };
  });
  const index = buildIndex([], [{ id: 'X', no: 1, variant: false }]);
  const timed = (label, run) => {
    const start = performance.now();
    const result = run();
    const elapsed = performance.now() - start;
    console.log(`${label}: ${elapsed.toFixed(2)} ms`);
    assert.ok(elapsed < 2000, `${label}が 2 秒を超えました: ${elapsed.toFixed(2)} ms`);
    return result;
  };
  // 牧場の組の優先と見張り（牧場 3 か所ぶん）
  const placed = (pals) => new Set([0, 2, 4].map((i) => `${pals[i].id}|${pals[i + 1].id}`));
  // 欲しい数が少ないほど、親の余計を 4 まで広げた表は大きい（欲しい 1 つで 8,000 状態）
  for (const [label, wanted, cake, count, low] of [
    ['ケーキなし ♂1000×♀1000・欲しい 4 つ', ['P0', 'P1', 'P2', 'P3'], 'none', 1000, 0],
    ['キノコケーキ ♂200×♀200（88〜100）・欲しい 4 つ', ['P0', 'P1', 'P2', 'P3'], 'talent', 200, 88],
    ['ケーキなし ♂1000×♀1000・欲しい 1 つ', ['P0'], 'none', 1000, 0],
    ['キノコケーキ ♂1000×♀1000（0〜100）・欲しい 1 つ', ['P0'], 'talent', 1000, 0],
  ]) {
    const pals = make(wanted, count, low);
    // 表の作成（条件を変えて初めて計算するとき。キノコケーキは目安と上限の 2 つを続けて作る）。
    // 計画の計算と同じ条件の表を先に作り、計画では使い回す。表ごとの時間は stable-render の D18（表の作成は 1 回 300ms まで）の判断に使う
    const tables = (cake === 'talent' ? ['estimate', 'upper'] : ['upper']).map((bound) => timed(
      `表の作成・${label}・親の余計 4 個まで（${bound === 'estimate' ? '目安' : cake === 'talent' ? '上限' : '厳密'}）`,
      () => generationTable({ wanted: wanted.length, cake, targets: {}, bound, parentExtras: 4 })));
    assert.ok(tables.every((table) => table.limit === 4));
    const keys = placed(pals);
    const result = timed(`計画（表を使い回す）・${label}・牧場の優先と見張りつき`, () => idealPlan({
      pals, index, target: 'X', passives: wanted, cake, prefer: { placed: keys }, watch: keys,
    }));
    assert.equal(result.pairs.length, 20);
    assert.equal(result.pairs[0].group, 'complete');
    assert.equal(result.measures.size, keys.size);
  }
});
