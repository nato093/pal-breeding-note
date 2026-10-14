import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanGoal, parseGoals, goalKey, goalMatches, goalMarks, ownPlayerUids, ownPals, palsOfPlayers, GOAL_LIMIT } from '../../web/js/core/ideal-goals.js';

const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const talent = (hp = 0, shot = 0, defense = 0) => ({ hp, shot, defense });
const pal = (id, palId, gender, passives = [], stats = talent(), extra = {}) => ({ id, palId, gender, passives, talent: stats, egg: false, place: 'palbox', ...extra });
const goal = (extra = {}) => cleanGoal({
  id: 'g1', name: '目標', palId: 'X', passives: ['P1', 'P2'], mode: 'include', targets: { hp: 100, shot: 100, defense: 100 },
  cake: 'none', addedAt: '2026-10-08T00:00:00.000Z', worlds: {}, ...extra,
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
  assert.deepEqual([clean.mode, clean.cake, clean.addedAt], ['include', 'none', '']);
  // 並べ方（order）はなくした（前に登録したものに残っていても読まない。保存し直すと消える）
  assert.equal('order' in clean, false);
  // アルファの条件はなくした（前に登録したものに残っていても読まない）
  assert.equal('alpha' in cleanGoal({ id: 'g', palId: 'X', alpha: 'alpha' }), false);
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

test('理想個体の登録: 前の版が保存した目標（並べ方 order を含む）も捨てずに読み、保存し直すと order がない', () => {
  // 前の版の cleanGoal が書いた形（order は 'next' か 'generations'）
  const saved = [
    { id: 'g1', name: '世代', palId: 'X', passives: ['P1'], mode: 'include', targets: { hp: 100, shot: 100, defense: 100 }, cake: 'talent', order: 'generations', addedAt: '2026-10-08T00:00:00.000Z', worlds: {} },
    { id: 'g2', name: '次の 1 回', palId: 'Y', passives: [], mode: 'only', targets: { hp: 0, shot: 100, defense: 90 }, cake: 'none', order: 'next', addedAt: '', worlds: {} },
  ];
  const goals = parseGoals(JSON.stringify(saved));
  assert.deepEqual(goals.map((goal) => [goal.id, goal.name, goal.palId, goal.passives, goal.mode, goal.cake]),
    [['g1', '世代', 'X', ['P1'], 'include', 'talent'], ['g2', '次の 1 回', 'Y', [], 'only', 'none']]);
  assert.deepEqual(goals[1].targets, { hp: 0, shot: 100, defense: 90 });
  const again = JSON.stringify(goals);
  assert.doesNotMatch(again, /"order"/);
  // 保存し直したものを読み直しても同じ（前の版のままのタブが読むときは、order の既定 'next' を足すだけで、goalKey は変わらない）
  assert.deepEqual(parseGoals(again), goals);
  assert.deepEqual(goals.map(goalKey), saved.map((goal) => goalKey(cleanGoal(goal))));
});

test('理想個体の登録: 同じ目標かは、完成の条件だけで（名前・完成の記録・ケーキを除き、パッシブの順番を問わずに）比べる', () => {
  assert.equal(goalKey(goal()), goalKey(goal({ id: 'g2', name: '別名', passives: ['P2', 'P1'], worlds: { [WORLD]: { checked: true, observedAt: '2026-10-08T00:00:00.000Z' } } })));
  assert.notEqual(goalKey(goal()), goalKey(goal({ mode: 'only' })));
  assert.notEqual(goalKey(goal()), goalKey(goal({ targets: { hp: 100, shot: 90, defense: 100 } })));
  // 前に登録したアルファの条件は見ない（同じ目標になる）
  assert.equal(goalKey(goal()), goalKey(goal({ alpha: 'alpha' })));
  // ケーキは作り方なので、違っても同じ目標（同じ完成で通知を重ねない）。前に保存した並べ方（order）が残っていても同じ目標
  assert.equal(goalKey(goal()), goalKey(goal({ cake: 'talent' })));
  assert.equal(goalKey(goal()), goalKey(goal({ order: 'generations' })));
  assert.equal(goalKey(goal()), goalKey({ ...goal(), order: 'generations' }));
});

test('理想個体の登録: 完成品は、同じ種族で、パッシブの条件と個体値の目標を満たす個体（アルファかは問わず、グローバルも含み、タマゴは数えない）', () => {
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

  // 中身の分からないタマゴは、条件がなくても数えない
  assert.ok(!ids({ passives: [], targets: { hp: 0, shot: 0, defense: 0 } }).includes('unknownEgg'));
  // 「だけ」は、同じパッシブが重なっていても 1 つと数える（個体ごとに Set を作らない数え方にしても同じ）
  assert.deepEqual(goalMatches(goal({ mode: 'only' }), [pal('dup', 'X', 'F', ['P1', 'P2', 'P1'], talent(100, 100, 100))]).map((item) => item.id), ['dup']);
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

test('理想個体の登録: 「このワールドでの自分」（selfUid）がプレイヤーにいれば、その 1 人だけを自分にする（対応・同じ名前より先）', () => {
  const players = [{ uid: 'p1', name: 'Taro' }, { uid: 'p2', name: 'ｊｉｒｏ' }, { uid: 'p3', name: 'Hanako' }];
  const users = ['Taro', 'Jiro', 'Hanako'];
  // ゲーム内の名前とノートの ID が違う人（参加者など）も、選んだプレイヤーが自分になる
  assert.deepEqual([...ownPlayerUids(players, { userId: 'Saburo', users, selfUid: 'p3' })], ['p3']);
  // 同じ名前・登録者の対応で決まる人でも、選んだプレイヤーだけ（A → B と変えたときに A が残らない）
  assert.deepEqual([...ownPlayerUids(players, { userId: 'Jiro', users, mapping: { p1: 'Jiro' }, selfUid: 'p3' })], ['p3']);
  // プレイヤーにいない selfUid（別のワールドの値・プレイヤーが消えた）は無視して、今の規則に戻る
  assert.deepEqual([...ownPlayerUids(players, { userId: 'jiro', users, selfUid: 'p9' })], ['p2']);
  assert.deepEqual([...ownPlayerUids(players, { userId: 'Saburo', users, selfUid: 'p9' })], []);
  // ログアウト中（ID が空）は、選んでいても空
  assert.deepEqual([...ownPlayerUids(players, { userId: '', users, selfUid: 'p3' })], []);
  assert.deepEqual([...ownPlayerUids(players, { userId: undefined, users, selfUid: 'p3' })], []);
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

test('目標の印: 登録した目標から、個体ごとに「完成品: 目標名」と「目標名の欲しいパッシブ」を作る（種族ごとに判定。タマゴは数えない）', () => {
  const goals = [
    goal({ id: 'g1', name: 'エックスの理想', passives: ['P1', 'P2'], targets: { hp: 90, shot: 0, defense: 0 } }),
    goal({ id: 'g2', name: 'Lv100', palId: 'X', passives: ['P3'], targets: { hp: 0, shot: 0, defense: 0 } }),
    goal({ id: 'g3', name: 'ワイの理想', palId: 'Y', passives: ['P1'], mode: 'only', targets: { hp: 0, shot: 0, defense: 0 } }),
  ];
  const pals = [
    pal('done', 'X', 'M', ['P1', 'P2'], talent(95, 0, 0)),
    // 個体値が足りない完成していない個体は、欲しいパッシブを持つ印だけ
    pal('low', 'X', 'F', ['P1', 'P2'], talent(50, 0, 0)),
    pal('half', 'X', 'F', ['P2', 'P9'], talent(100, 100, 100)),
    pal('none', 'X', 'F', ['P9']),
    pal('egg', 'X', 'M', ['P1', 'P2'], talent(100, 100, 100), { egg: true }),
    // ほかの種族は、その種族の目標だけで見る（だけ: ほかのパッシブを持つと完成品ではない）
    pal('y-only', 'Y', 'M', ['P1']),
    pal('y-more', 'Y', 'M', ['P1', 'P3']),
    pal('z', 'Z', 'M', ['P1']),
  ];
  const marks = goalMarks(goals, pals);
  assert.deepEqual(Object.fromEntries(marks), {
    done: ['完成品: エックスの理想'],
    low: ['エックスの理想の欲しいパッシブ'],
    half: ['エックスの理想の欲しいパッシブ'],
    'y-only': ['完成品: ワイの理想'],
    'y-more': ['ワイの理想の欲しいパッシブ'],
  });
  // 英数字で終わる名前の後だけ空ける。欲しいパッシブのない目標は、完成品の印だけ
  const more = goalMarks([...goals, goal({ id: 'g4', name: 'Lv100', palId: 'X', passives: [], targets: { hp: 90, shot: 0, defense: 0 } })], pals);
  assert.deepEqual(more.get('done'), ['完成品: エックスの理想', '完成品: Lv100']);
  assert.deepEqual(more.get('none'), undefined);
  assert.equal(goalMarks([goal({ id: 'g5', name: 'Lv100', passives: ['P9'], targets: { hp: 100, shot: 100, defense: 100 } })], pals).get('none')[0], 'Lv100 の欲しいパッシブ');
  assert.equal(goalMarks([], pals).size, 0);
});
