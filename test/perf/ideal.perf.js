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

// stable-render（D18）: 画面は idealPlanSteps を 30ms の区切りで回す（ui/slice.js）。分けて回せる組のループも、世代の表の作成も、
// 1 回の区切りで画面が止まる時間は 50ms 以内（表の作成も区切って回す）。区切った計算の合計は記録だけ（5 秒を超えたら Worker を考える）
test('性能: 区切った計算は、同じ種族の ♂2000 × ♀2000 と、新しく作る大きい世代の表（キノコケーキの 2 つの表を含む）でも、1 回の区切りが 50ms 以内', async () => {
  const { idealPlanSteps, hasGenerationTable } = await import('../../web/js/core/ideal.js');
  const { startSliced } = await import('../../web/js/ui/slice.js');
  let state = 0x534c4943;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const junk = ['J0', 'J1', 'J2', 'J3', 'J4', 'J5'];
  // 和集合がそろう親と、欲しいものを欠いて余計を 3〜4 個持つ親を混ぜる（先頭の ♂ は余計 4 個、♀ は欲しいものを全部）
  const make = (wanted, count, low) => Array.from({ length: count * 2 }, (_, i) => {
    const own = i === 0 ? [] : i === 1 ? [...wanted] : wanted.filter(() => random() < 0.5);
    const extras = i === 0 ? junk.slice(0, 4) : junk.filter(() => random() < 0.4).slice(0, 4 - own.length);
    const value = () => low + Math.floor(random() * (101 - low));
    return { id: `S${i}`, palId: 'X', gender: i % 2 ? 'F' : 'M', egg: false, place: 'palbox', passives: [...own, ...extras], talent: { hp: value(), shot: value(), defense: value() } };
  });
  const index = buildIndex([], [{ id: 'X', no: 1, variant: false }]);
  const run = async (label, input, tables = []) => {
    const fresh = tables.filter((table) => !hasGenerationTable(table)).length;
    const slices = [];
    const job = startSliced(idealPlanSteps({ index, target: 'X', ...input }), { budget: 30, onSlice: (ms) => slices.push(ms), schedule: (fn) => setImmediate(fn) });
    const result = job.done ? job.value : await job.promise;
    const max = Math.max(...slices);
    const total = slices.reduce((sum, ms) => sum + ms, 0);
    console.log(`区切った計算・${label}: ${slices.length} 回・最大 ${max.toFixed(2)} ms・合計 ${total.toFixed(0)} ms（新しく作った表 ${fresh} 個）`);
    assert.ok(max <= 50, `${label}の 1 回の区切りが 50ms を超えました: ${max.toFixed(2)} ms`);
    return result;
  };
  const tableOf = (wanted, mode, cake, targets, bound) => ({ wanted, mode, cake, targets, bound, parentExtras: 4 });
  assert.equal((await run('ケーキなし ♂2000×♀2000・欲しい 2 つ', { pals: make(['P0', 'P1'], 2000, 0), passives: ['P0', 'P1'] })).total, 4000000);
  assert.equal((await run('キノコケーキ ♂2000×♀2000・欲しい 2 つ', { pals: make(['P0', 'P1'], 2000, 0), passives: ['P0', 'P1'], cake: 'talent' })).total, 4000000);
  // 表の作成がいちばん重い条件（欲しい 1 つ・欲しいものだけ・キノコケーキで、親の余計 4 個まで。表 1 つで 300ms を超えることがある）
  const heavy = { hp: 90, shot: 90, defense: 90 };
  const tables = ['estimate', 'upper'].map((bound) => tableOf(1, 'only', 'talent', heavy, bound));
  const result = await run('欲しい 1 つ・欲しいものだけ・キノコケーキ ♂1000×♀1000（表 2 つを新しく作る）',
    { pals: make(['P0'], 1000, 0), passives: ['P0'], mode: 'only', cake: 'talent', targets: heavy }, tables);
  assert.ok(tables.every(hasGenerationTable));
  assert.equal(result.pairs[0].group, 'complete');
  await run('欲しい 1 つ・ケーキなし ♂1000×♀1000（表 1 つを新しく作る）',
    { pals: make(['P0'], 1000, 0), passives: ['P0'], targets: { hp: 99, shot: 98, defense: 97 } }, [tableOf(1, 'include', 'none', { hp: 99, shot: 98, defense: 97 }, 'upper')]);
});

// ケーキの提案（D30）: 画面は今の選択のケーキの計画（limit 20）を区切って先に出し、残りの 2 通りを cakeSpeedSteps で区切って求める。
// 3 通りとも新しい世代の表を作る条件（キノコケーキは目安と上限の 2 つ）でも、1 回の区切りは 50ms 以内（D18）。合計は記録だけ
test('性能: ケーキの提案（3 通りのケーキの計画を続けて区切って求める）は、♂1000 × ♀1000 で新しい世代の表を作っても 1 回の区切りが 50ms 以内', async () => {
  const { idealPlanSteps, cakeSpeedSteps, fastestCake, planSpeed } = await import('../../web/js/core/ideal.js');
  const { startSliced } = await import('../../web/js/ui/slice.js');
  let state = 0x43414b45;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const junk = ['J0', 'J1', 'J2', 'J3', 'J4', 'J5'];
  const make = (wanted, count, low) => Array.from({ length: count * 2 }, (_, i) => {
    const own = i === 0 ? [] : i === 1 ? [...wanted] : wanted.filter(() => random() < 0.5);
    const extras = i === 0 ? junk.slice(0, 4) : junk.filter(() => random() < 0.4).slice(0, 4 - own.length);
    const value = () => low + Math.floor(random() * (101 - low));
    return { id: `K${i}`, palId: 'X', gender: i % 2 ? 'F' : 'M', egg: false, place: 'palbox', passives: [...own, ...extras], talent: { hp: value(), shot: value(), defense: value() } };
  });
  const index = buildIndex([], [{ id: 'X', no: 1, variant: false }]);
  const sliced = async (steps) => {
    const slices = [];
    const job = startSliced(steps, { budget: 30, onSlice: (ms) => slices.push(ms), schedule: (fn) => setImmediate(fn) });
    const value = job.done ? job.value : await job.promise;
    return { value, slices };
  };
  for (const [label, wanted, mode, targets, low] of [
    ['欲しい 2 つ・全部持つ ♂1000×♀1000（0〜100）', ['P0', 'P1'], 'include', { hp: 95, shot: 94, defense: 93 }, 0],
    ['欲しい 1 つ・欲しいものだけ ♂1000×♀1000（0〜100。表がいちばん重い条件）', ['P0'], 'only', { hp: 92, shot: 91, defense: 89 }, 0],
  ]) {
    const input = { pals: make(wanted, 1000, low), index, target: 'X', passives: wanted, mode, targets };
    const started = performance.now();
    // 今の選択（ケーキなし）の計画を先に
    const main = await sliced(idealPlanSteps({ ...input, cake: 'none', limit: 20 }));
    const shown = performance.now() - started;
    // 残りの 2 通り
    const speeds = new Map([['none', planSpeed(main.value)]]);
    const rest = await sliced(cakeSpeedSteps(input, ['talent', 'special'], (cake, speed) => speeds.set(cake, speed)));
    const total = performance.now() - started;
    const slices = [...main.slices, ...rest.slices];
    const max = Math.max(...slices);
    console.log(`ケーキの提案・${label}: 今の計画 ${main.slices.length} 回・${shown.toFixed(0)} ms、残り 2 通り ${rest.slices.length} 回、`
      + `提案まで ${total.toFixed(0)} ms・1 回の区切りの最大 ${max.toFixed(2)} ms・最速 ${fastestCake(speeds)}（${[...speeds].map(([cake, speed]) => `${cake} ${speed === null ? '作れない' : speed.toFixed(1)}`).join(' / ')}）`);
    assert.ok(max <= 50, `${label}の 1 回の区切りが 50ms を超えました: ${max.toFixed(2)} ms`);
    assert.equal(speeds.size, 3);
  }
});
