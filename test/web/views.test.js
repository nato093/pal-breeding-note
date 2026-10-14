import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { parseHash } from '../../web/js/router.js';
import { searchView } from '../../web/js/views/search.js';
import { reverseView } from '../../web/js/views/reverse.js';
import { inheritanceView } from '../../web/js/views/route.js';
import { listView } from '../../web/js/views/list.js';
import { settingsView } from '../../web/js/views/settings.js';
import { palView } from '../../web/js/views/pal.js';
import { TABS, tabLabel } from '../../web/js/views/tabs.js';

function context(records = [{ id: '配合', parent1Id: 'FlowerDoll', parent2Id: 'SheepBall', childId: 'MoonQueen',
  parent1Gender: 'F', parent2Gender: 'M', registrant: '仲間', updatedAt: '2026-10-04T00:00:00Z', confirmCount: 10 }]) {
  const index = buildIndex(records, pals);
  const state = { records, index, graph: buildCarrierGraph(index), env: 'test', warnings: [], userId: '仲間' };
  const navigations = [];
  // 入力の間引き（ui/dom.js の onTextInput）を 0 にして、入力した直後の結果を同期で確かめる
  return { store: { state, subscribe: () => () => {} }, navigations, navigate: (hash) => navigations.push(hash), inputDelay: 0 };
}

test('配合検索: 親は初期未選択で、入れ替え・共有・見出しの装飾を出さない', (t) => {
  installDom(t);
  const view = searchView(context(), parseHash('#/search'));
  assert.deepEqual(view.element.querySelectorAll('.picker-trigger').map((node) => node.textContent), ['パルを選択', 'パルを選択']);
  assert.equal(view.element.querySelector('.swap-button'), null);
  const heading = view.element.querySelector('.view-heading');
  assert.equal(heading.children.length, 1);
  assert.equal(heading.children[0].tagName, 'h1');
  assert.doesNotMatch(heading.textContent, /共有|仲間とつくる|記録した組み合わせから/);
  view.destroy();
});

for (const [params, names, genders] of [
  ['p1=SheepBall', ['モコロン', 'フラリーナ', 'セレムーン'], ['♂', '♀']],
  ['p2=SheepBall', ['フラリーナ', 'モコロン', 'セレムーン'], ['♀', '♂']],
  ['p1=FlowerDoll', ['フラリーナ', 'モコロン', 'セレムーン'], ['♀', '♂']],
  ['p2=FlowerDoll', ['モコロン', 'フラリーナ', 'セレムーン'], ['♂', '♀']],
  ['p1=SheepBall&p2=FlowerDoll', ['モコロン', 'フラリーナ', 'セレムーン'], ['♂', '♀']],
]) {
  test(`配合検索: ${params} の選択欄に合わせて両親と性別を並べる`, (t) => {
    installDom(t);
    const view = searchView(context(), parseHash(`#/search?${params}`));
    assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
    const equation = view.element.querySelector('.breeding-equation');
    assert.deepEqual(equation.querySelectorAll('strong').map((node) => node.textContent), names);
    assert.deepEqual(equation.querySelectorAll('.gender').map((node) => node.textContent), genders);
    assert.match(equation.textContent, /＋.*→/);
    assert.equal(view.element.querySelector('.result-note').textContent, '1 件の登録済み配合');
    view.destroy();
  });
}

test('継承ルート: 除外設定と確認回数を出さず、旧 URL でも経路を表示し、入れ替えは残す', async (t) => {
  installDom(t);
  const app = context();
  const view = inheritanceView(app, parseHash('#/route?from=SheepBall&to=MoonQueen&exclude=FlowerDoll'));
  assert.equal(view.element.querySelectorAll('.picker').length, 2);
  assert.doesNotMatch(view.element.textContent, /相手親に使わない|除外|確認.*回/);
  assert.match(view.element.textContent, /最短 1 回の配合/);
  // 見出しはタブ名、説明は「パッシブ」（「スキル」はアクティブスキル・パートナースキルの言葉。copy-dead-ends）
  assert.equal(view.element.querySelector('h1').textContent, '継承ルート');
  assert.ok(view.element.textContent.includes('この経路はパッシブを運ぶ個体の流れです。相手親は別途用意します'));
  assert.doesNotMatch(view.element.textContent, /スキルを運ぶ|スキルをつなぐ/);
  const swap = view.element.querySelector('.swap-button');
  assert.equal(swap.getAttribute('aria-label'), '開始と目標を入れ替える');
  await swap.dispatch('click');
  assert.equal(app.navigations[0], '#/route?from=MoonQueen&to=SheepBall&exclude=FlowerDoll');
  view.destroy();
});

test('配合検索: 同じ両親に複数の結果がある注記を保ち、すべて選択欄の順に表示する', (t) => {
  installDom(t);
  const original = context().store.state.records[0];
  const view = searchView(context([original, { ...original, id: '別の配合', childId: 'CatMage' }]),
    parseHash('#/search?p1=SheepBall&p2=FlowerDoll'));
  assert.equal(view.element.querySelector('.result-note').textContent, '同じ組み合わせで結果が複数登録されています');
  assert.ok(view.element.querySelectorAll('.breeding-equation').every((node) => node.querySelector('strong').textContent === 'モコロン'));
  view.destroy();
});

test('配合検索: × は該当する親だけを URL から解除する', async (t) => {
  const { body } = installDom(t);
  const app = context();
  const view = searchView(app, parseHash('#/search?p1=SheepBall&p2=FlowerDoll'));
  body.append(view.element);
  const picker = view.element.querySelectorAll('.picker')[0];
  await picker.querySelector('.picker-clear').dispatch('click');
  assert.equal(app.navigations[0], '#/search?p2=FlowerDoll');
  assert.equal(document.activeElement, picker.querySelector('.picker-trigger'));
  view.destroy();
});

test('配合検索: 同じ画面のまま URL が変わると（applyRoute）、選択欄と結果だけを合わせ、要素は作り直さない', async (t) => {
  const { body } = installDom(t);
  const app = context();
  const updates = [];
  app.update = (hash) => updates.push(hash);
  const view = searchView(app, parseHash('#/search?p1=SheepBall'));
  body.append(view.element);
  const triggers = view.element.querySelectorAll('.picker-trigger');
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
  const next = parseHash('#/search?p1=SheepBall&p2=PinkCat');
  view.applyRoute(next, { reason: 'update' });
  assert.deepEqual(view.element.querySelectorAll('.picker-trigger'), triggers);
  assert.equal(triggers[1].getAttribute('aria-label'), '親2: No.2 ツッパニャン');
  assert.match(view.element.textContent, /この組み合わせはまだ登録されていません/);
  // 同じ route でもう一度呼んでも変わらない
  view.applyRoute(next, { reason: 'history' });
  assert.match(view.element.textContent, /この組み合わせはまだ登録されていません/);
  // 選び直しの URL は、入れ直した route から作り、context.update があればそれで変える
  await view.element.querySelectorAll('.picker-clear')[0].dispatch('click');
  assert.deepEqual(updates, ['#/search?p2=PinkCat']);
  assert.deepEqual(app.navigations, []);
  view.applyRoute(parseHash('#/search?p2=FlowerDoll'), { reason: 'history' });
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
  view.destroy();
});

test('逆引き: applyRoute で子を合わせ、不正な ID は URL から外す', (t) => {
  installDom(t);
  const app = context();
  const replaced = [];
  app.replace = (hash) => replaced.push(hash);
  const view = reverseView(app, parseHash('#/reverse'));
  const trigger = view.element.querySelector('.picker-trigger');
  assert.match(view.element.textContent, /探したい子を選んでください/);
  view.applyRoute(parseHash('#/reverse?c=MoonQueen'), { reason: 'history' });
  assert.equal(view.element.querySelector('.picker-trigger'), trigger);
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
  view.applyRoute(parseHash('#/reverse?c=存在しない'), { reason: 'history' });
  assert.deepEqual(replaced, ['#/reverse']);
  assert.equal(trigger.getAttribute('aria-label'), '産まれる子: パルを選択');
  assert.match(view.element.textContent, /探したい子を選んでください/);
  view.destroy();
});

test('継承ルート: applyRoute で開始と目標を合わせ、入れ替えは入れ直した route から URL を作る', async (t) => {
  installDom(t);
  const app = context();
  const updates = [];
  app.update = (hash) => updates.push(hash);
  const view = inheritanceView(app, parseHash('#/route?to=MoonQueen'));
  const triggers = view.element.querySelectorAll('.picker-trigger');
  const swap = view.element.querySelector('.swap-button');
  assert.match(view.element.textContent, /開始と目標のパルを選んでください/);
  view.applyRoute(parseHash('#/route?from=SheepBall&to=MoonQueen'), { reason: 'update' });
  assert.deepEqual(view.element.querySelectorAll('.picker-trigger'), triggers);
  assert.equal(view.element.querySelector('.swap-button'), swap);
  assert.equal(triggers[0].getAttribute('aria-label'), '開始: No.1 モコロン');
  assert.match(view.element.textContent, /最短 1 回の配合/);
  await swap.dispatch('click');
  assert.deepEqual(updates, ['#/route?from=MoonQueen&to=SheepBall']);
  assert.deepEqual(app.navigations, []);
  view.destroy();
});

test('パル詳細: このパルを親に使う配合は相手 → 子を維持する', (t) => {
  installDom(t);
  const view = palView(context(), parseHash('#/pal/SheepBall'));
  assert.ok(view.element.textContent.includes('このパルを親に使う配合（相手 → 子）'));
  const equation = view.element.querySelector('.breeding-equation');
  assert.deepEqual(equation.querySelectorAll('strong').map((node) => node.textContent), ['フラリーナ', 'セレムーン']);
  assert.doesNotMatch(equation.textContent, /＋/);
  view.destroy();
});

test('一覧: 5 種の並べ替えを選択でき、親の並び順は親ごとに展開して左の親を基準に並び、登録者名で絞り込める', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const app = context([
    { ...source, id: '新しい', parent1Id: 'FlowerDoll', childId: 'SheepBall' },
    { ...source, id: '古い', parent1Id: 'SheepBall', parent2Id: 'CatMage', childId: 'MoonQueen', updatedAt: '2026-10-01T00:00:00Z' },
  ]);
  const view = listView(app);
  const select = view.element.querySelector('select');
  assert.deepEqual(select.children.map((node) => node.textContent), [
    '親の図鑑番号順', '親の五十音順', '子の図鑑番号順', '子の五十音順', '更新日の新しい順',
  ]);
  assert.deepEqual(select.children.map((node) => node.value), ['parent-dex', 'parent-name', 'child-dex', 'child-name', 'updated']);
  assert.equal(select.value, 'parent-dex');
  const firstNames = () => view.element.querySelector('.breeding-equation').querySelectorAll('strong').map((node) => node.textContent);
  assert.equal(firstNames()[2], 'セレムーン');
  // 親の並び順では 1 件を親ごとに展開し、その位置の親を左に出す。
  const leftNames = () => view.element.querySelectorAll('.breeding-equation').map((node) => node.querySelector('strong').textContent);
  assert.deepEqual(leftNames(), ['モコロン', 'モコロン', 'クレメーオ', 'フラリーナ']);
  assert.equal(view.element.querySelector('.result-note').textContent, '2 件の配合 · 4 件を表示');
  for (const [sort, child] of [['parent-dex', 'セレムーン'], ['parent-name', 'セレムーン'],
    ['child-dex', 'モコロン'], ['child-name', 'セレムーン'], ['updated', 'モコロン']]) {
    select.value = sort;
    await select.dispatch('input');
    assert.equal(firstNames()[2], child);
  }
  // パルでの絞り込みは配合検索・逆引き・パル詳細に任せ、一覧には置かない。
  assert.equal(view.element.querySelector('.picker'), null);
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 2);
  const registrant = view.element.querySelectorAll('input')[0];
  registrant.value = '該当なし';
  await registrant.dispatch('input');
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 0);
  view.destroy();
});

test('設定: アカウントを末尾に移し、他の順序とログイン ID を保つ', (t) => {
  installDom(t);
  const view = settingsView(context());
  const sections = view.element.querySelectorAll('.settings-card');
  assert.deepEqual(sections.map((node) => node.querySelector('h2').textContent), [
    'データの状態', '記録を書き出す', '整合性の警告', '通知', 'アカウント',
  ]);
  assert.match(sections[4].textContent, /ログイン中の ID: 仲間.*ログアウト/);
  view.destroy();
});

// 知らせる（emit）ことのできる store。revision は store.js と同じく、中身が変わったときだけ増やす
function liveContext(records) {
  const app = context(records);
  const listeners = new Set();
  app.store.state.revision = 1;
  app.store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  app.store.emit = (changes = {}) => {
    Object.assign(app.store.state, changes);
    if (changes.records) {
      app.store.state.index = buildIndex(changes.records, pals);
      app.store.state.revision++;
    }
    listeners.forEach((listener) => listener(app.store.state));
  };
  return app;
}

test('一覧: 親の順の 1 件 2 行は別の行（key に表示の向き）で、取得し直しても同じ要素のまま。中身が変わった配合だけ作り直す', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const app = liveContext([{ ...source, etag: 'e1' }]);
  const view = listView(app);
  const cards = () => view.element.querySelectorAll('.breeding-card');
  // 同じ配合の 2 行（左の親が違う）が両方出る
  assert.equal(cards().length, 2);
  assert.deepEqual(cards().map((card) => card.querySelector('.breeding-equation').querySelector('strong').textContent), ['モコロン', 'フラリーナ']);
  const before = cards();
  // 中身が同じ取得（番号が増えない）では描き直さない
  app.store.emit({ serverTime: '2026-10-05T00:00:00Z' });
  assert.deepEqual(cards(), before);
  // 番号は増えたが中身が同じ配合は、同じ要素を使い回す
  app.store.emit({ records: [{ ...source, etag: 'e1' }] });
  assert.deepEqual(cards(), before);
  // 楽観更新（etag は同じで updatedAt が変わる）は作り直す（古い表示を残さない）
  app.store.emit({ records: [{ ...source, etag: 'e1', updatedAt: '2026-10-06T00:00:00Z', memo: '書き換え' }] });
  assert.ok(cards().every((card) => !before.includes(card)));
  assert.match(cards()[0].textContent, /書き換え/);
  view.destroy();
});

test('配合検索: 親を選んだ後に記録が取り直されても、同じ配合のカードは同じ要素のまま（件数の行も残す）', (t) => {
  installDom(t);
  const app = liveContext();
  const view = searchView(app, parseHash('#/search?p1=SheepBall'));
  const card = view.element.querySelector('.breeding-card');
  assert.ok(card);
  assert.equal(view.element.querySelector('.result-note').textContent, '1 件の登録済み配合');
  app.store.emit({ records: [...app.store.state.records] });
  assert.equal(view.element.querySelector('.breeding-card'), card);
  // カードの操作ボタンには、差分更新でフォーカスを戻すための目印がある
  assert.deepEqual(card.querySelectorAll('[data-focus]').map((node) => node.getAttribute('data-focus')), ['edit', 'remove']);
  view.destroy();
});

test('配合検索: 登録の無い組み合わせで「この組み合わせを登録」にフォーカスしたまま記録が取り直されても、空の表示を作り直さずフォーカスも外れない', async (t) => {
  installDom(t);
  const app = liveContext();
  const registers = [];
  app.register = (fields) => registers.push(fields);
  const view = searchView(app, parseHash('#/search?p1=PinkCat&p2=SheepBall'));
  document.body.append(view.element);
  const register = view.element.querySelectorAll('button').find((node) => node.textContent === 'この組み合わせを登録');
  register.focus();
  // 別の配合が増えた（この組み合わせはまだ無い）
  app.store.emit({ records: [...app.store.state.records, { ...app.store.state.records[0], id: '別の配合', parent1Id: 'Kitsunebi' }] });
  assert.equal(view.element.querySelectorAll('button').find((node) => node.textContent === 'この組み合わせを登録'), register);
  assert.equal(document.activeElement, register);
  // 押したときは、今の親で登録の画面を開く
  await register.dispatch('click');
  assert.deepEqual(registers, [{ parent1Id: 'PinkCat', parent2Id: 'SheepBall' }]);
  view.destroy();
});

test('設定: 記録が同じで整合性の警告だけ変わったときも、警告を描き直す', (t) => {
  installDom(t);
  const app = liveContext();
  const view = settingsView(app);
  const warnings = () => view.element.querySelector('.warning-list').textContent;
  assert.match(warnings(), /警告はありません/);
  app.store.emit({ warnings: [{ code: 'UNKNOWN_PAL', rowNumber: 5 }] });
  assert.match(warnings(), /5 行目: マスターにないパルが含まれています/);
  view.destroy();
});

// パル選択を開いて、候補の行（名前・右の注記・薄い行か）を読む
async function pickerRows(view, index = 0) {
  const picker = view.element.querySelectorAll('.picker')[index];
  await picker.querySelector('.picker-trigger').dispatch('click');
  return {
    status: picker.querySelector('.picker-status').textContent,
    rows: picker.querySelectorAll('[role="option"]').map((node) => ({
      name: node.querySelector('strong')?.textContent ?? node.textContent,
      badge: node.querySelector('.picker-badge')?.textContent ?? '',
      dim: /is-dim/.test(node.className),
    })),
  };
}

test('配合検索・逆引き: パル選択の並びは図鑑順のまま、親・子としての登録件数を添え、0 件の行は薄くする', async (t) => {
  installDom(t);
  const search = searchView(context(), parseHash('#/search'));
  const { status, rows } = await pickerRows(search);
  assert.equal(status, '図鑑順で表示');
  assert.equal(rows[0].name, 'パルを選択');
  assert.equal(rows[1].name, 'モコロン');
  assert.deepEqual(rows.filter((row) => row.badge).map((row) => [row.name, row.badge]), [['モコロン', '親 1 件'], ['フラリーナ', '親 1 件']]);
  assert.equal(rows.find((row) => row.name === 'ツッパニャン').dim, true);
  assert.equal(rows[1].dim, false);
  search.destroy();
  const reverse = reverseView(context(), parseHash('#/reverse'));
  const child = await pickerRows(reverse);
  assert.deepEqual(child.rows.filter((row) => row.badge).map((row) => [row.name, row.badge]), [['セレムーン', '子 1 件']]);
  assert.equal(child.rows.find((row) => row.name === 'モコロン').dim, true);
  reverse.destroy();
  // 記録を読み込む前は何も添えない
  const pending = context();
  pending.store.state.env = '';
  const before = searchView(pending, parseHash('#/search'));
  assert.ok((await pickerRows(before)).rows.every((row) => !row.badge && !row.dim));
  before.destroy();
});

test('継承ルート: 開始の候補は、登録済みの配合で目標まで届くパルを回数の少ない順に先へ出し、届かないパルは薄く後ろに', async (t) => {
  installDom(t);
  const view = inheritanceView(context(), parseHash('#/route?to=MoonQueen'));
  const { status, rows } = await pickerRows(view, 0);
  assert.equal(status, '目標まで少ない回数の順に表示');
  assert.deepEqual(rows.slice(0, 4).map((row) => [row.name, row.badge, row.dim]),
    [['パルを選択', '', false], ['セレムーン', '目標', false], ['モコロン', '1 回', false], ['フラリーナ', '1 回', false]]);
  assert.ok(rows.slice(4).every((row) => row.dim && !row.badge));
  view.destroy();
  // 目標を選ぶまでは図鑑順
  const none = inheritanceView(context(), parseHash('#/route'));
  assert.equal((await pickerRows(none, 0)).status, '図鑑順で表示');
  none.destroy();
});

// ---- フェーズ 1a のレビューで直したもの ----
test('一覧: 登録者名の入力の間引きの途中で画面を閉じたら、閉じた後に描かない。flushInputs は待っている入力をすぐ当てる', async (t) => {
  installDom(t);
  const typeIn = async (view, value) => {
    const registrant = view.element.querySelectorAll('input')[0];
    registrant.value = value;
    await registrant.dispatch('input');
  };
  const cards = (view) => view.element.querySelectorAll('.breeding-card').length;
  const view = listView({ ...context(), inputDelay: 20 });
  const shown = cards(view);
  assert.ok(shown > 0);
  await typeIn(view, '該当なし');
  view.destroy();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(cards(view), shown);
  const later = listView({ ...context(), inputDelay: 1000 });
  await typeIn(later, '該当なし');
  assert.equal(cards(later), shown);
  later.flushInputs();
  assert.equal(cards(later), 0);
  later.destroy();
});

test('一覧: 利用者が並べ替えを変えたら、結果の始まり（件数の行）が画面の上に隠れているときだけ見える位置へ移す。データの更新では動かさない', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const app = liveContext([{ ...source, etag: 'e1' }]);
  const view = listView(app);
  const note = view.element.querySelector('.result-note');
  const moves = [];
  note.scrollIntoView = (options) => moves.push(options);
  let top = 300;
  note.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, width: 100 });
  const sort = view.element.querySelector('select');
  // 始まりが見えているときは動かさない
  sort.value = 'updated';
  await sort.dispatch('input');
  assert.deepEqual(moves, []);
  // 下の方を見ていて（始まりが上に隠れている）並べ替えを変えると、始まりへ
  top = -2000;
  sort.value = 'child-dex';
  await sort.dispatch('input');
  assert.deepEqual(moves, [{ block: 'start' }]);
  // データの更新では動かさない
  app.store.emit({ records: [{ ...source, etag: 'e2' }] });
  assert.equal(moves.length, 1);
  view.destroy();
});

test('見出し: 各画面の h1 はタブの名前（views/tabs.js の TABS）。キャッチコピーの見出しは出さない', (t) => {
  installDom(t);
  assert.deepEqual(TABS.map(([view]) => view), ['search', 'reverse', 'route', 'list', 'drafts', 'wishlist', 'owned', 'ideal', 'settings']);
  assert.equal(tabLabel('route'), '継承ルート');
  assert.equal(tabLabel('pal'), '');
  for (const [view, make] of [['search', () => searchView(context(), parseHash('#/search'))], ['reverse', () => reverseView(context(), parseHash('#/reverse'))],
    ['route', () => inheritanceView(context(), parseHash('#/route'))], ['list', () => listView(context())], ['settings', () => settingsView(context())]]) {
    const shown = make();
    assert.equal(shown.element.querySelector('h1').textContent, tabLabel(view), view);
    assert.doesNotMatch(shown.element.textContent, /配合を見つけよう|この子の親を探す|スキルをつなぐ|みんなの配合ノート|ノートの設定|パルの配合ノート/, view);
    shown.destroy();
  }
});

test('パル詳細: 見出しは「No.〈番号〉 〈名前〉」で、hero は絵と属性だけ（名前を二重に出さない）。「産まれる」にそろえる', (t) => {
  installDom(t);
  const view = palView(context(), parseHash('#/pal/MoonQueen'));
  const pal = pals.find((item) => item.id === 'MoonQueen');
  assert.equal(view.element.querySelector('h1').textContent, `No.${pal.label} ${pal.ja}`);
  const hero = view.element.querySelector('.pal-hero');
  assert.deepEqual(hero.children.map((child) => child.className), ['pal-icon pal-icon-large', 'element-chips']);
  assert.doesNotMatch(hero.textContent, new RegExp(pal.ja));
  assert.ok(view.element.textContent.includes('このパルが産まれる配合'));
  view.destroy();
});

test('一覧: 登録者名で絞って 0 件なら「「入力」に合う登録はありません。」と「絞り込みを解除」（押すと元の件数に戻り、登録者名の欄へ）。登録が 1 件もなければ登録へ', async (t) => {
  installDom(t);
  const view = listView(context());
  document.body.append(view.element);
  const registrant = view.element.querySelectorAll('input')[0];
  registrant.value = ' 該当なし ';
  await registrant.dispatch('input');
  const emptyState = view.element.querySelector('.empty-state');
  assert.equal(emptyState.querySelector('p').textContent, '「該当なし」に合う登録はありません。');
  assert.ok(emptyState.querySelector('.empty-icon'));
  const clear = emptyState.querySelector('button');
  assert.equal(clear.textContent, '絞り込みを解除');
  clear.focus();
  await clear.dispatch('click');
  assert.equal(registrant.value, '');
  // 親の順（既定）は 1 件を親ごとに 2 行
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 2);
  assert.equal(view.element.querySelector('.result-note').textContent, '1 件の配合 · 2 件を表示');
  assert.equal(document.activeElement, registrant);
  view.destroy();
  // 登録が 1 件もないとき（絞り込みを解除しても出ないので、登録へ）
  const registers = [];
  const none = context([]);
  none.register = (fields) => registers.push(fields ?? null);
  const emptyList = listView(none);
  const noRecords = emptyList.element.querySelector('.empty-state');
  assert.equal(noRecords.querySelector('p').textContent, '登録された配合はまだありません。見つけた配合を登録しましょう。');
  await noRecords.querySelector('button').dispatch('click');
  assert.deepEqual(registers, [null]);
  emptyList.destroy();
});

test('配合検索: 親を 1 体だけ選んで 0 件なら「この親の配合を登録」で、その親を親 1 に入れて登録を開く（両方選んでいれば「この組み合わせを登録」）', async (t) => {
  installDom(t);
  const app = context();
  const registers = [];
  app.register = (fields) => registers.push(fields);
  for (const [hash, label, fields] of [
    ['#/search?p1=PinkCat', 'この親の配合を登録', { parent1Id: 'PinkCat' }],
    ['#/search?p2=PinkCat', 'この親の配合を登録', { parent1Id: 'PinkCat' }],
    ['#/search?p1=PinkCat&p2=SheepBall', 'この組み合わせを登録', { parent1Id: 'PinkCat', parent2Id: 'SheepBall' }],
  ]) {
    const view = searchView(app, parseHash(hash));
    const emptyState = view.element.querySelector('.empty-state');
    assert.match(emptyState.querySelector('p').textContent, /まだ登録されていません。$/, hash);
    const register = emptyState.querySelector('button');
    assert.equal(register.textContent, label, hash);
    await register.dispatch('click');
    assert.deepEqual(registers.at(-1), fields, hash);
    view.destroy();
  }
});

test('読み込みの失敗: 記録をまだ読み込めていない画面は「登録済みの配合を読み込み中…」（role=status）、失敗したら文と「もう一度読み込む」（押すと取り直す）', async (t) => {
  installDom(t);
  const app = liveContext();
  let refreshes = 0;
  app.store.refresh = () => { refreshes++; return Promise.resolve(); };
  app.store.state.env = null;
  const views = [searchView(app, parseHash('#/search?p1=SheepBall')), reverseView(app, parseHash('#/reverse?c=MoonQueen')),
    listView(app), palView(app, parseHash('#/pal/SheepBall')), inheritanceView(app, parseHash('#/route?from=SheepBall&to=MoonQueen'))];
  for (const view of views) {
    const loading = view.element.querySelector('.loading-state');
    assert.equal(loading.getAttribute('role'), 'status');
    assert.equal(loading.textContent, '登録済みの配合を読み込み中…');
  }
  app.store.emit({ error: 'サーバに接続できません' });
  for (const view of views) {
    const failed = view.element.querySelector('.error-state');
    assert.equal(failed.getAttribute('role'), 'alert');
    assert.equal(failed.querySelector('p').textContent, 'サーバに接続できません');
    await failed.querySelector('button').dispatch('click');
  }
  assert.equal(refreshes, views.length);
  // 同じ失敗のまま描き直しても、同じ表示は作り直さない（押した「もう一度読み込む」のフォーカスを保つ）
  const [search] = views;
  const again = search.element.querySelector('.error-state').querySelector('button');
  again.focus();
  search.update(app.store.state);
  assert.equal(search.element.querySelector('.error-state').querySelector('button'), again);
  assert.equal(document.activeElement, again);
  // 読み込めたら結果を出す
  app.store.emit({ env: 'test', error: '' });
  assert.equal(search.element.querySelector('.error-state'), null);
  assert.equal(search.element.querySelectorAll('.breeding-card').length, 1);
  for (const view of views) view.destroy();
});
