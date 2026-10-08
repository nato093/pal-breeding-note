import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGoal, parseGoals, goalKey, goalMatches, ownPlayerUids, ownPals, palsOfPlayers, GOAL_LIMIT } from '../../web/js/core/ideal-goals.js';

const WORLD = '4A431AC14B58A7E31A76B2A991F79FE8';
const talent = (hp = 0, shot = 0, defense = 0) => ({ hp, shot, defense });
const pal = (id, palId, gender, passives = [], stats = talent(), extra = {}) => ({ id, palId, gender, passives, talent: stats, egg: false, place: 'palbox', ...extra });
const goal = (extra = {}) => cleanGoal({
  id: 'g1', name: '目標', palId: 'X', passives: ['P1', 'P2'], mode: 'include', targets: { hp: 100, shot: 100, defense: 100 },
  cake: 'none', order: 'next', addedAt: '2026-10-08T00:00:00.000Z', worlds: {}, ...extra,
});

test('理想個体の登録: 形を確かめ、読めない値は安全な既定値にする', () => {
  assert.equal(cleanGoal(null), null);
  assert.equal(cleanGoal({ id: 'a b', palId: 'X' }), null);
  assert.equal(cleanGoal({ id: 'g', palId: 'X"><script>' }), null);
  const clean = cleanGoal({
    id: 'g', palId: 'X', name: '\u0000とても長い名前'.padEnd(40, 'あ'), passives: ['P1', 'P1', 'bad id', 7, 'P2', 'P3', 'P4', 'P5'],
    mode: 'all', targets: { hp: '100', shot: -1, defense: 50 }, cake: 'gold', order: 'later', addedAt: 'x',
    worlds: {
      [WORLD.toLowerCase()]: { checked: true, complete: true, completedAt: '2026-10-08T01:00:00.000Z', observedAt: '2026-10-08T00:30:00.000Z', worldName: 'テスト' },
      bad: { checked: true, complete: true, observedAt: '2026-10-08T00:30:00.000Z' },
      ['B'.repeat(32)]: { checked: false, complete: true, observedAt: '2026-10-08T00:30:00.000Z' },
    },
  });
  assert.equal(clean.name.length, 30);
  assert.ok(!clean.name.includes('\u0000'));
  assert.deepEqual(clean.passives, ['P1', 'P2', 'P3', 'P4']);
  // 文字列や範囲外の個体値は 0（気にしない）ではなく 100 にする
  assert.deepEqual(clean.targets, { hp: 100, shot: 100, defense: 50 });
  assert.deepEqual([clean.mode, clean.cake, clean.order, clean.addedAt, clean.alpha], ['include', 'none', 'next', '', 'any']);
  // アルファの条件は 3 つのどれか（読めない値は気にしない）
  assert.equal(cleanGoal({ id: 'g', palId: 'X', alpha: 'alpha' }).alpha, 'alpha');
  assert.equal(cleanGoal({ id: 'g', palId: 'X', alpha: 'boss' }).alpha, 'any');
  assert.deepEqual(Object.keys(clean.worlds), [WORLD]);
  assert.equal(clean.worlds[WORLD].completedAt, '2026-10-08T01:00:00.000Z');
  // 名前がなければパルの ID
  assert.equal(cleanGoal({ id: 'g', palId: 'X' }).name, 'X');
});

test('理想個体の登録: 読み込みは壊れた JSON を空にし、同じ ID・同じ目標は先のものを残し、件数を限る', () => {
  assert.deepEqual(parseGoals('{'), []);
  assert.deepEqual(parseGoals('{}'), []);
  const list = parseGoals(JSON.stringify([{ id: 'a', palId: 'X', name: '先' }, { id: 'a', palId: 'Y', name: '後' }, { id: 'b', palId: 'Y' }]));
  assert.deepEqual(list.map((item) => [item.id, item.name]), [['a', '先'], ['b', 'Y']]);
  // 名前の変更で 2 つの登録をつないだときなど、同じ目標が 2 つあれば先のものを残す
  assert.deepEqual(parseGoals(JSON.stringify([{ id: 'a', palId: 'X', name: '先' }, { id: 'c', palId: 'X', name: '後', cake: 'talent' }])).map((item) => item.id), ['a']);
  const many = Array.from({ length: GOAL_LIMIT + 5 }, (_, i) => ({ id: `g${i}`, palId: `P${i}` }));
  assert.equal(parseGoals(JSON.stringify(many)).length, GOAL_LIMIT);
});

test('理想個体の登録: 同じ目標かは、完成の条件だけで（名前・完成の記録・ケーキ・並べ方を除き、パッシブの順番を問わずに）比べる', () => {
  assert.equal(goalKey(goal()), goalKey(goal({ id: 'g2', name: '別名', passives: ['P2', 'P1'], worlds: { [WORLD]: { checked: true, observedAt: '2026-10-08T00:00:00.000Z' } } })));
  assert.notEqual(goalKey(goal()), goalKey(goal({ mode: 'only' })));
  assert.notEqual(goalKey(goal()), goalKey(goal({ targets: { hp: 100, shot: 90, defense: 100 } })));
  // アルファの条件は完成の条件なので、違えば別の目標
  assert.notEqual(goalKey(goal()), goalKey(goal({ alpha: 'alpha' })));
  assert.notEqual(goalKey(goal({ alpha: 'alpha' })), goalKey(goal({ alpha: 'normal' })));
  // ケーキと並べ方は作り方なので、違っても同じ目標（同じ完成で通知を重ねない）
  assert.equal(goalKey(goal()), goalKey(goal({ cake: 'talent', order: 'generations' })));
});

test('理想個体の登録: 完成品は、同じ種族で、パッシブの条件・個体値の目標・アルファの条件を満たす個体（グローバルも含み、タマゴは数えない）', () => {
  const pals = [
    pal('ok', 'X', 'M', ['P1', 'P2', 'J1'], talent(100, 100, 100)),
    pal('alpha', 'X', 'M', ['P1', 'P2', 'J2'], talent(100, 100, 100), { alpha: true }),
    pal('clean', 'X', 'F', ['P2', 'P1'], talent(100, 100, 100), { place: 'global' }),
    pal('egg', 'X', 'F', ['P1', 'P2'], talent(100, 100, 100), { egg: true }),
    pal('unknownEgg', 'X', '', [], talent(), { egg: true }),
    pal('low', 'X', 'M', ['P1', 'P2'], talent(100, 99, 100)),
    pal('lack', 'X', 'M', ['P1'], talent(100, 100, 100)),
    pal('other', 'Y', 'M', ['P1', 'P2'], talent(100, 100, 100)),
    pal('human', '', 'M', ['P1', 'P2'], talent(100, 100, 100)),
  ];
  const ids = (extra) => goalMatches(goal(extra), pals).map((item) => item.id);
  // タマゴは、中身が条件を満たしても、孵化させて受け取るまで完成にしない
  assert.deepEqual(ids(), ['ok', 'alpha', 'clean']);
  // 欲しいものだけ（余計がない）
  assert.deepEqual(ids({ mode: 'only' }), ['clean']);
  // 目標 0 のステータスは気にしない
  assert.deepEqual(ids({ targets: { hp: 100, shot: 0, defense: 100 } }), ['ok', 'alpha', 'clean', 'low']);
  // アルファだけ／アルファ以外
  assert.deepEqual(ids({ alpha: 'alpha' }), ['alpha']);
  assert.deepEqual(ids({ alpha: 'normal' }), ['ok', 'clean']);
  // 中身の分からないタマゴは、条件がなくても数えない
  assert.ok(!ids({ passives: [], targets: { hp: 0, shot: 0, defense: 0 } }).includes('unknownEgg'));
});

test('理想個体の登録: 自分のプレイヤーは「登録者の対応」で選んだものを優先し、なければ同じ名前のプレイヤー', () => {
  const players = [{ uid: 'p1', name: 'Taro' }, { uid: 'p2', name: 'ｊｉｒｏ' }, { uid: 'p3', name: 'Hanako' }];
  const users = ['Taro', 'Jiro', 'Hanako'];
  assert.deepEqual([...ownPlayerUids(players, { userId: 'jiro', users })], ['p2']);
  // 対応を選んでいれば、名前より優先する（p1 を Jiro にした）
  assert.deepEqual([...ownPlayerUids(players, { userId: 'Jiro', users, mapping: { p1: 'Jiro' } })].sort(), ['p1', 'p2']);
  assert.deepEqual([...ownPlayerUids(players, { userId: 'Taro', users, mapping: { p1: 'Jiro' } })], []);
  // ユーザーにいない名前は対応しない
  assert.deepEqual([...ownPlayerUids(players, { userId: 'Hanako', users: ['Taro'] })], []);
});

test('理想個体の登録: 自分の個体は、所持者が自分・自分が預けた拠点のパル・ホストならグローバルパルボックス', () => {
  const HOST = '00000000-0000-0000-0000-000000000001';
  const players = [{ uid: HOST, name: 'Host' }, { uid: 'p2', name: 'Guest' }];
  const pals = [
    pal('box', 'X', 'M', [], talent(), { holderUid: HOST }),
    pal('egg', 'X', 'F', [], talent(), { holderUid: HOST, egg: true, place: 'egg-inventory' }),
    pal('guestBox', 'X', 'M', [], talent(), { holderUid: 'p2' }),
    pal('baseMine', 'X', 'M', [], talent(), { holderUid: '', place: 'base', lastOwnerUid: HOST }),
    pal('baseShared', 'X', 'M', [], talent(), { holderUid: '', place: 'base', lastOwnerUid: '', lastOwner: 'Host' }),
    pal('baseGuest', 'X', 'M', [], talent(), { holderUid: '', place: 'base', lastOwnerUid: 'p2', lastOwner: 'Guest' }),
    pal('global', 'X', 'M', [], talent(), { holderUid: '', place: 'global' }),
  ];
  const ids = (userId) => ownPals({ players, pals }, { userId, users: ['Host', 'Guest'] })?.map((item) => item.id) ?? null;
  assert.deepEqual(ids('Host'), ['box', 'egg', 'baseMine', 'baseShared', 'global']);
  assert.deepEqual(ids('Guest'), ['guestBox', 'baseGuest']);
  assert.equal(ids('だれでもない'), null);
});

test('理想個体の所持者: 拠点に置かれたタマゴは誰の個体にもしない。同じ名前のプレイヤーが複数・名前が空なら、名前では決めない', () => {
  const players = [{ uid: 'p1', name: 'Taro' }, { uid: 'p2', name: 'Taro' }, { uid: 'p3', name: 'Hanako' }, { uid: 'p4', name: '' }];
  const pals = [
    pal('eggBase', 'X', 'F', [], talent(), { holderUid: '', egg: true, place: 'egg-incubator', baseId: 'B1', lastOwnerUid: '' }),
    pal('eggCarried', 'X', 'F', [], talent(), { holderUid: 'p3', egg: true, place: 'egg-inventory' }),
    pal('baseSameName', 'X', 'M', [], talent(), { holderUid: '', place: 'base', lastOwnerUid: '', lastOwner: 'Taro' }),
    pal('baseHanako', 'X', 'M', [], talent(), { holderUid: '', place: 'base', lastOwnerUid: '', lastOwner: 'Hanako' }),
    pal('baseUnknown', 'X', 'M', [], talent(), { holderUid: '', place: 'base', lastOwnerUid: '', lastOwner: '' }),
  ];
  const ids = (uids) => palsOfPlayers({ players, pals }, new Set(uids)).map((item) => item.id);
  assert.deepEqual(ids(['p3']), ['eggCarried', 'baseHanako']);
  // 共有されたデータでは名前しか分からず、Taro が 2 人いるので、どちらの個体ともしない
  assert.deepEqual(ids(['p1']), []);
  assert.deepEqual(ids(['p2']), []);
  // 名前の空のプレイヤーが、持ち主の分からない拠点のパルを拾わない
  assert.deepEqual(ids(['p4']), []);
});
