// パル手術台（UI 改善フェーズ 4 の implants）: 手術台の表の引き方（implantOf）・手術で完成できる個体（goalNear）・URL の s の確かめ方（cleanSurgery）と、
// 表の取り出し（scripts/extract-implants.mjs の buildImplants。ゲーム本体は読まない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implantOf, implantNeed, canImplant, goalNear, cleanSurgery, IMPLANT_KINDS } from '../../web/js/core/implants.js';
import { cleanGoal, goalMatches, goalProgress } from '../../web/js/core/ideal-goals.js';
import { buildImplants, implantsModule } from '../../scripts/extract-implants.mjs';

const talent = (hp = 0, shot = 0, defense = 0) => ({ hp, shot, defense });
const pal = (id, palId, passives = [], stats = talent(100, 100, 100), extra = {}) => ({ id, palId, gender: 'M', level: 10, passives, talent: stats, egg: false, place: 'palbox', ...extra });
const goal = (extra = {}) => cleanGoal({
  id: 'g1', name: '目標', palId: 'Anubis', passives: ['MoveSpeed_up_3', 'Rare'], mode: 'include', targets: { hp: 90, shot: 90, defense: 0 },
  cake: 'none', addedAt: '', worlds: {}, ...extra,
});
// 神速（使い切り）・脳筋（インプラント）・勇敢（アイテム不要）は手術台で付けられ、希少・伝説は付けられない（v1.0.5 の表）
const SPEED = 'MoveSpeed_up_3';
const NOUKIN = 'Noukin';
const BRAVE = 'PAL_ALLAttack_up1';

test('implantOf: アイテム不要・何度でも使えるインプラント・使い切りインプラント・付けられないもの', () => {
  assert.deepEqual(implantOf(BRAVE), { item: '', itemName: '', kind: 'free' });
  assert.deepEqual(implantOf(NOUKIN), { item: 'PalPassiveSkillChange_Noukin', itemName: 'インプラント：脳筋', kind: 'reusable' });
  assert.deepEqual(implantOf(SPEED), { item: 'PalPassiveSkillChange_Consumable_MoveSpeed_up_3', itemName: '使い切りインプラント：神速', kind: 'consumable' });
  // 伝説・希少は手術台の表に行がない（アイテムの表にはあっても付けられない）
  for (const id of ['Legend', 'Rare', '', 'constructor', '__proto__']) {
    assert.equal(implantOf(id), null, id);
    assert.equal(canImplant(id), false, id);
  }
  assert.deepEqual([implantNeed(BRAVE), implantNeed(NOUKIN), implantNeed(SPEED), implantNeed('Legend')], ['インプラント不要', 'インプラント：脳筋', '使い切りインプラント：神速', '']);
  assert.deepEqual(IMPLANT_KINDS, { free: 'インプラント不要', reusable: 'インプラント', consumable: '使い切りインプラント' });
  // 返す値は書き換えられない（表を共有しているため）
  assert.ok(Object.isFrozen(implantOf(SPEED)));
});

test('goalNear: 個体値の目標を満たし、足りないパッシブがすべて手術台で付けられる個体だけ。完成している個体・タマゴ・別の種族は返さない', () => {
  const pals = [
    // 希少を持ち、神速が足りない → 神速を付ければ完成
    pal('a', 'Anubis', ['Rare']),
    // 個体値が届かない
    pal('b', 'Anubis', ['Rare'], talent(80, 100, 100)),
    // 希少（付けられない）が足りない
    pal('c', 'Anubis', [SPEED]),
    // もう完成している
    pal('d', 'Anubis', ['Rare', SPEED]),
    // タマゴ・別の種族
    pal('e', 'Anubis', ['Rare'], talent(100, 100, 100), { egg: true }),
    pal('f', 'SheepBall', ['Rare']),
  ];
  const near = goalNear(goal(), pals);
  assert.deepEqual(near.map((item) => [item.pal.id, item.add]), [['a', [SPEED]]]);
  // 完成している個体は goalMatches の側（goalNear には入らない）
  assert.deepEqual(goalMatches(goal(), pals).map((item) => item.id), ['d']);
  // 欲しいパッシブがすべて付けられるなら、何も持たない個体も（付ける数の少ない順 → Lv の高い順 → 個体 ID）
  const all = goalNear(goal({ passives: [SPEED, NOUKIN] }), [pal('x', 'Anubis', []), pal('y', 'Anubis', [NOUKIN]), pal('z', 'Anubis', [], talent(100, 100, 100), { level: 50 })]);
  assert.deepEqual(all.map((item) => [item.pal.id, item.add]), [['y', [SPEED]], ['z', [SPEED, NOUKIN]], ['x', [SPEED, NOUKIN]]]);
  // 種族だけの目標（欲しいパッシブなし）・足りないものがない目標は空
  assert.deepEqual(goalNear(goal({ passives: [] }), pals), []);
  assert.deepEqual(goalNear({ ...goal(), palId: '' }, pals), []);
  assert.deepEqual(goalNear(goal(), null), []);
});

test('goalNear: 「欲しいものだけ」は余計なパッシブを足りない数までしか上書きできない。付けた後に 4 個を超えない', () => {
  const only = goal({ mode: 'only', passives: [SPEED, 'Rare'] });
  const pals = [
    // 余計 1 ≤ 足りない 1 → 上書きして完成
    pal('a', 'Anubis', ['Rare', 'Legend']),
    // 余計 2 > 足りない 1 → 消しきれない
    pal('b', 'Anubis', ['Rare', 'Legend', 'Noukin']),
    // 余計なし・足りない 1
    pal('c', 'Anubis', ['Rare']),
  ];
  assert.deepEqual(goalNear(only, pals).map((item) => item.pal.id), ['a', 'c']);
  // 「全部持つ」は余計なパッシブへも上書きできるので、4 個持っていても足りない分を付けられる
  const full = goal({ passives: [SPEED, 'Rare'] });
  assert.deepEqual(goalNear(full, [pal('d', 'Anubis', ['Rare', 'Legend', 'Noukin', 'Deffence_up1'])]).map((item) => item.add), [[SPEED]]);
  // 欲しいパッシブ 4 個（手術で 2 個）・余計 2 個の「全部持つ」も、余計なものへ上書きすれば 4 個に収まる
  const four = goal({ passives: [SPEED, NOUKIN, 'Rare', 'Legend'] });
  assert.deepEqual(goalNear(four, [pal('e', 'Anubis', ['Rare', 'Legend', 'PAL_Sanity_Down_1', 'Deffence_up1'])]).map((item) => item.add), [[SPEED, NOUKIN]]);
});

test('goalNear: 全部の個体を 1 体ずつ見る素朴な決め方と同じ（乱数の個体と目標）。goalProgress の addable はその先頭の 1 体と数', () => {
  let state = 11;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const pick = (items) => items[Math.floor(random() * items.length)];
  const ids = [SPEED, NOUKIN, BRAVE, 'Rare', 'Legend', 'PAL_Sanity_Down_1'];
  const pals = Array.from({ length: 300 }, (_, i) => pal(`id${String((i * 7919) % 300).padStart(3, '0')}`, pick(['X', 'X', 'Y']),
    [...new Set(Array.from({ length: Math.floor(random() * 5) }, () => pick(ids)))], talent(pick([0, 50, 100]), pick([0, 50, 100]), pick([0, 100])),
    { egg: random() < 0.1, level: 1 + Math.floor(random() * 3) }));
  const naive = (target) => {
    const wanted = [...new Set(target.passives)];
    const out = [];
    for (const item of pals) {
      if (item.egg || item.palId !== target.palId) continue;
      const add = wanted.filter((id) => !item.passives.includes(id));
      if (!add.length || !add.every(canImplant)) continue;
      if (['hp', 'shot', 'defense'].some((key) => target.targets[key] > 0 && item.talent[key] < target.targets[key])) continue;
      const extra = item.passives.filter((id) => !wanted.includes(id)).length;
      if (target.mode === 'only' && extra > add.length) continue;
      const overwrite = target.mode === 'only' ? extra : Math.min(extra, add.length);
      if (item.passives.length + add.length - overwrite > 4) continue;
      out.push({ pal: item, add });
    }
    return out.sort((a, b) => a.add.length - b.add.length || b.pal.level - a.pal.level || (a.pal.id < b.pal.id ? -1 : 1));
  };
  let found = 0;
  let both = 0;
  for (let i = 0; i < 80; i++) {
    const target = goal({ id: `g${i}`, palId: pick(['X', 'Y']), passives: ids.filter(() => random() < 0.35).slice(0, 4), mode: pick(['include', 'only']),
      targets: { hp: pick([0, 50]), shot: pick([0, 50, 100]), defense: pick([0, 100]) } });
    const near = goalNear(target, pals);
    assert.deepEqual(near.map((item) => [item.pal.id, item.add]), naive(target).map((item) => [item.pal.id, item.add]), `目標 ${i}`);
    // 目標の一覧（goalProgress の addable）は、同じ並びの先頭の 1 体と数だけ。完成品があれば求めない（一覧は「完成済み」。性能 3）
    const best = goalProgress(target, pals, { canAdd: canImplant }).addable;
    const complete = goalMatches(target, pals).length > 0;
    assert.deepEqual(best && [best.pal.id, best.add, best.count], near.length && !complete ? [near[0].pal.id, near[0].add, near.length] : null, `目標の一覧 ${i}`);
    if (near.length) found++;
    if (near.length && complete) both++;
  }
  assert.ok(found > 10, `手術で完成できる目標 ${found}`);
  assert.ok(both > 0, `完成品もある目標 ${both}`);
});

test('goalProgress: 個体値の目標に届く個体の一覧は、同じ個体の配列の間は目標ごとに使い回し、別の目標・作り直した配列でも正しく数える', () => {
  const pals = [
    pal('a', 'X', ['Rare'], talent(100, 100, 100)), pal('b', 'X', ['Rare'], talent(100, 90, 100)), pal('c', 'X', [], talent(100, 100, 100)),
  ];
  const progress = (targets, list = pals) => goalProgress(goal({ palId: 'X', passives: [SPEED, 'Rare'], targets }), list, { canAdd: canImplant }).addable;
  // 個体値 100・100・100 に届くのは a と c。c は希少を持たない（付けられないので数えない）
  assert.deepEqual([progress(talent(100, 100, 100)).pal.id, progress(talent(100, 100, 100)).count], ['a', 1]);
  // 攻撃 90 なら b も届く。同じ配列でも目標ごとに数え直す
  assert.deepEqual([progress(talent(100, 90, 100)).pal.id, progress(talent(100, 90, 100)).count], ['a', 2]);
  // 届く個体がいなければ null
  assert.equal(progress(talent(100, 100, 100), [pals[1]]), null);
  // 配列を作り直したら（読み直し）、前の一覧を使わない
  const changed = [{ ...pals[0], talent: talent(100, 50, 100) }, pals[1], pals[2]];
  assert.equal(progress(talent(100, 100, 100), changed), null);
  assert.deepEqual([progress(talent(100, 90, 100), changed).pal.id, progress(talent(100, 90, 100), changed).count], ['b', 1]);
});

test('cleanSurgery: パッシブ ID の形・手術台で付けられる・欲しいパッシブと重ならない・合わせて 4 個まで。捨てたら changed', () => {
  assert.deepEqual(cleanSurgery(`${SPEED},${BRAVE}`, ['Rare']), { ids: [SPEED, BRAVE], changed: false });
  // 付けられないもの・形の違うもの・重なり・p にあるものは捨てる
  assert.deepEqual(cleanSurgery(`Legend,${SPEED},<x>,${SPEED},Rare`, ['Rare']), { ids: [SPEED], changed: true });
  // p と合わせて 4 個まで（p を先に残す）
  assert.deepEqual(cleanSurgery(`${SPEED},${NOUKIN}`, ['Rare', 'Legend', 'Deffence_up1']), { ids: [SPEED], changed: true });
  assert.deepEqual(cleanSurgery('', ['Rare']), { ids: [], changed: false });
  assert.deepEqual(cleanSurgery('Legend', []), { ids: [], changed: true });
  assert.deepEqual(cleanSurgery(undefined, []), { ids: [], changed: false });
});

test('buildImplants（取り出し）: アイテムの形で種類を決め、パッシブ ID は passives.js の書き方にそろえる。表にないパッシブ・知らないアイテム・名前のないアイテムで止まる', () => {
  const names = new Map([['ITEM_NAME_PalPassiveSkillChange_Noukin', 'インプラント：脳筋'], ['ITEM_NAME_PalPassiveSkillChange_Consumable_MoveSpeed_up_3', '使い切りインプラント：神速']]);
  const rows = new Map([
    // 既定値（None・0）は readDataTable が値を置かない（undefined）
    ['PAL_ALLAttack_up1', { PassiveSkill: 'PAL_ALLAttack_up1' }],
    ['noukin', { PassiveSkill: 'noukin', RequireItemId: 'PalPassiveSkillChange_Noukin' }],
    ['MoveSpeed_up_3', { PassiveSkill: 'MoveSpeed_up_3', RequireItemId: 'PalPassiveSkillChange_Consumable_MoveSpeed_up_3' }],
    ['Rare', { PassiveSkill: 'Rare', RequireItemId: 'None' }],
  ]);
  const ids = ['PAL_ALLAttack_up1', 'Noukin', 'MoveSpeed_up_3', 'Rare'];
  assert.deepEqual(buildImplants(rows, names, ids), [
    { passiveId: 'PAL_ALLAttack_up1', item: '', itemName: '', kind: 'free' },
    { passiveId: 'Noukin', item: 'PalPassiveSkillChange_Noukin', itemName: 'インプラント：脳筋', kind: 'reusable' },
    { passiveId: 'MoveSpeed_up_3', item: 'PalPassiveSkillChange_Consumable_MoveSpeed_up_3', itemName: '使い切りインプラント：神速', kind: 'consumable' },
    { passiveId: 'Rare', item: '', itemName: '', kind: 'free' },
  ]);
  assert.throws(() => buildImplants(new Map([['Unknown', { PassiveSkill: 'Unknown' }]]), names, ids), /passives\.js にないパッシブ: Unknown/);
  assert.throws(() => buildImplants(new Map([['Rare', { PassiveSkill: 'Rare', RequireItemId: 'Wood' }]]), names, ids), /知らない形のアイテム: Wood/);
  assert.throws(() => buildImplants(new Map([['Rare', { PassiveSkill: 'Rare', RequireItemId: 'PalPassiveSkillChange_Rare' }]]), names, ids), /アイテムの名前がありません/);
  assert.throws(() => buildImplants(new Map([['a', { PassiveSkill: 'Rare' }], ['b', { PassiveSkill: 'rare' }]]), names, ids), /同じパッシブの行が 2 つ/);
  // 書き出し: 自動生成の印と、パルリバーサーの ID・名前（表の数値は書かない）
  const source = implantsModule([{ passiveId: 'Noukin', item: 'PalPassiveSkillChange_Noukin', itemName: 'インプラント：脳筋', kind: 'reusable' }], 'パルリバーサー', { version: 'v1.0.5', date: '2026-10-16' });
  assert.match(source, /自動生成/);
  assert.match(source, /export const GENDER_REVERSE_ITEM = "PalGenderReverse";/);
  assert.match(source, /export const GENDER_REVERSE_NAME = "パルリバーサー";/);
  assert.doesNotMatch(source, /Price|10000|50000/);
});
