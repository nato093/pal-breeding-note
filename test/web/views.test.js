import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { parseHash } from '../../web/js/router.js';
import { searchView } from '../../web/js/views/search.js';
import { inheritanceView } from '../../web/js/views/route.js';
import { settingsView } from '../../web/js/views/settings.js';
import { palView } from '../../web/js/views/pal.js';
import { TABS, tabLabel } from '../../web/js/views/tabs.js';
import { createSearchSeen } from '../../web/js/search-seen.js';

function context(records = [{ id: '配合', parent1Id: 'FlowerDoll', parent2Id: 'SheepBall', childId: 'MoonQueen',
  parent1Gender: 'F', parent2Gender: 'M', registrant: '仲間', updatedAt: '2026-10-04T00:00:00Z', confirmCount: 10 }]) {
  const index = buildIndex(records, pals);
  const state = { records, index, graph: buildCarrierGraph(index), env: 'test', warnings: [], userId: '仲間' };
  const navigations = [];
  // 入力の間引き（ui/dom.js の onTextInput）を 0 にして、入力した直後の結果を同期で確かめる
  return { store: { state, subscribe: () => () => {} }, navigations, navigate: (hash) => navigations.push(hash), inputDelay: 0 };
}

test('配合を探す: 親1・親2・子は初期未選択で、何も選ばなければ全件を出し、入れ替え・共有・見出しの装飾を出さない', (t) => {
  installDom(t);
  const view = searchView(context(), parseHash('#/search'));
  assert.deepEqual(view.element.querySelectorAll('.picker-trigger').map((node) => node.textContent), ['パルを選択', 'パルを選択', 'パルを選択']);
  assert.deepEqual(view.element.querySelectorAll('.picker-trigger').map((node) => node.getAttribute('aria-label')), ['親1: パルを選択', '親2: パルを選択', '子: パルを選択']);
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
  assert.equal(view.element.querySelector('.find-count-text').textContent, '1 件');
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
  test(`配合を探す: ${params} の選択欄に合わせて両親と性別を並べる`, (t) => {
    installDom(t);
    const view = searchView(context(), parseHash(`#/search?${params}`));
    assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
    const equation = view.element.querySelector('.breeding-equation');
    assert.deepEqual(equation.querySelectorAll('strong').map((node) => node.textContent), names);
    assert.deepEqual(equation.querySelectorAll('.gender').map((node) => node.textContent), genders);
    assert.match(equation.textContent, /＋.*→/);
    assert.equal(view.element.querySelector('.find-count-text').textContent, '1 件');
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

test('配合を探す: 同じ両親に複数の結果があれば件数に添え、すべて選択欄の順に表示する。親の性別で子が変わるときはそう書く', (t) => {
  installDom(t);
  const original = context().store.state.records[0];
  const view = searchView(context([original, { ...original, id: '別の配合', childId: 'CatMage', parent1Gender: '', parent2Gender: '' }]),
    parseHash('#/search?p1=SheepBall&p2=FlowerDoll'));
  assert.equal(view.element.querySelector('.find-count').textContent, '2 件 · 同じ組み合わせで結果が複数あります');
  assert.ok(view.element.querySelectorAll('.breeding-equation').every((node) => node.querySelector('strong').textContent === 'モコロン'));
  view.destroy();
  const gendered = searchView(context([original, { ...original, id: '別の配合', childId: 'CatMage', parent1Gender: 'M', parent2Gender: 'F' }]),
    parseHash('#/search?p1=SheepBall&p2=FlowerDoll'));
  assert.equal(gendered.element.querySelector('.find-count').textContent, '2 件 · 親の性別で子が変わります');
  gendered.destroy();
});

test('配合を探す: × は該当する親だけを URL から解除する', async (t) => {
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

test('配合を探す: 同じ画面のまま URL が変わると（applyRoute）、選択欄と結果だけを合わせ、要素は作り直さない', async (t) => {
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

test('配合を探す: 子だけでも引け、applyRoute で子を合わせ、不正な ID は URL から外す', (t) => {
  installDom(t);
  const app = context();
  const replaced = [];
  app.replace = (hash) => replaced.push(hash);
  const view = searchView(app, parseHash('#/search'));
  const trigger = view.element.querySelectorAll('.picker-trigger')[2];
  view.applyRoute(parseHash('#/search?c=MoonQueen'), { reason: 'history' });
  assert.equal(view.element.querySelectorAll('.picker-trigger')[2], trigger);
  assert.equal(trigger.getAttribute('aria-label'), `子: No.${pals.find((pal) => pal.id === 'MoonQueen').label} セレムーン`);
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
  view.applyRoute(parseHash('#/search?c=SheepBall'), { reason: 'history' });
  assert.equal(view.element.querySelector('.empty-state').querySelector('p').textContent, 'この子の配合はまだ登録されていません。');
  view.applyRoute(parseHash('#/search?c=存在しない'), { reason: 'history' });
  assert.deepEqual(replaced, ['#/search']);
  assert.equal(trigger.getAttribute('aria-label'), '子: パルを選択');
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
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

// 配合を探すのテスト用: context.update で URL を変えたら、そのビューの applyRoute で合わせる（app.js と同じ流れ）
function updating(app, getView) {
  const updates = [];
  app.update = (hash, options) => {
    updates.push(options?.replace ? [hash, 'replace'] : hash);
    getView().applyRoute(parseHash(hash), { reason: 'update' });
  };
  return updates;
}

test('配合を探す: 並べ替えは 5 種（既定は更新日の新しい順）。親・子の並びは 1 件 1 回で見出しの行にまとめ、登録者は選択・キーワードで絞れる', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const app = context([
    { ...source, id: '新しい', parent1Id: 'FlowerDoll', childId: 'SheepBall', memo: '夜に産まれた' },
    { ...source, id: '古い', parent1Id: 'SheepBall', parent2Id: 'CatMage', childId: 'MoonQueen', registrant: 'ボブ', updatedAt: '2026-10-01T00:00:00Z' },
  ]);
  let view = null;
  const updates = updating(app, () => view);
  view = searchView(app, parseHash('#/search'));
  const select = view.element.querySelector('.find-sort').querySelector('select');
  assert.deepEqual(select.children.map((node) => node.textContent), [
    '更新日の新しい順', '親の図鑑番号順', '親の五十音順', '子の図鑑番号順', '子の五十音順',
  ]);
  assert.deepEqual(select.children.map((node) => node.value), ['updated', 'parent-dex', 'parent-name', 'child-dex', 'child-name']);
  assert.equal(select.value, 'updated');
  const names = () => view.element.querySelectorAll('.breeding-equation').map((node) => node.querySelectorAll('strong').map((item) => item.textContent));
  // 既定は更新日の新しい順（見出しなし）
  assert.deepEqual(names(), [['フラリーナ', 'モコロン', 'モコロン'], ['モコロン', 'クレメーオ', 'セレムーン']]);
  assert.equal(view.element.querySelector('.find-group-heading'), null);
  assert.equal(view.element.querySelector('.find-count-text').textContent, '2 件');
  // 親の図鑑番号順: 1 件 1 回、先に来る親（モコロン）の見出しの下に「相手 → 子」
  select.value = 'parent-dex';
  await select.dispatch('change');
  assert.equal(updates.at(-1), '#/search?sort=parent-dex');
  const headings = view.element.querySelectorAll('.find-group-heading');
  assert.deepEqual(headings.map((node) => [node.getAttribute('role'), node.getAttribute('aria-level'), node.textContent]), [
    ['heading', '2', `No.${pals.find((pal) => pal.id === 'SheepBall').label} モコロン2 件`],
  ]);
  // 群の中は相手の図鑑順（クレメーオ → フラリーナ）
  assert.deepEqual(names(), [['クレメーオ', 'セレムーン'], ['フラリーナ', 'モコロン']]);
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 2);
  // 「· N 件を表示」は出さない
  assert.equal(view.element.querySelector('.find-count-text').textContent, '2 件');
  // 子の図鑑番号順: 子の見出しの下に「親 ＋ 親」
  select.value = 'child-dex';
  await select.dispatch('change');
  assert.deepEqual(view.element.querySelectorAll('.find-group-name').map((node) => node.textContent.replace(/^No\.\S+ /, '')), ['モコロン', 'セレムーン']);
  assert.deepEqual(names(), [['フラリーナ', 'モコロン'], ['モコロン', 'クレメーオ']]);
  // 既定に戻すと URL から sort を外す
  select.value = 'updated';
  await select.dispatch('change');
  assert.equal(updates.at(-1), '#/search');
  // 登録者の選択: すべて・自分・ほかの登録者（件数つき）
  const registrant = view.element.querySelector('.find-registrant').querySelector('select');
  assert.deepEqual(registrant.children.map((node) => [node.value, node.textContent]), [
    ['', 'すべて · 2 件'], ['by:仲間', '仲間（自分） · 1 件'], ['by:ボブ', 'ボブ · 1 件'],
  ]);
  registrant.value = 'by:ボブ';
  await registrant.dispatch('change');
  assert.equal(updates.at(-1), `#/search?by=${encodeURIComponent('ボブ')}`);
  assert.deepEqual(names(), [['モコロン', 'クレメーオ', 'セレムーン']]);
  assert.equal(registrant.value, 'by:ボブ');
  registrant.value = '';
  await registrant.dispatch('change');
  assert.equal(updates.at(-1), '#/search');
  // キーワード（パル名・メモ・登録者。空白で複数）は履歴を増やさない
  const keyword = view.element.querySelector('.find-keyword').querySelector('input');
  keyword.value = 'もこ 夜';
  await keyword.dispatch('input');
  assert.deepEqual(updates.at(-1), [`#/search?q=${new URLSearchParams({ q: 'もこ 夜' }).toString().slice(2)}`, 'replace']);
  assert.deepEqual(names(), [['フラリーナ', 'モコロン', 'モコロン']]);
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

test('配合を探す: 取得し直しても同じ配合は同じ要素のまま。中身が変わった配合だけ作り直し、表示中に増えた配合だけ光らせる', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const app = liveContext([{ ...source, etag: 'e1' }]);
  const view = searchView(app, parseHash('#/search'));
  const cards = () => view.element.querySelectorAll('.breeding-card');
  assert.equal(cards().length, 1);
  // 最初の描画では光らせない
  assert.ok(cards().every((card) => !/is-new/.test(card.className)));
  const before = cards();
  // 中身が同じ取得（番号が増えない）では描き直さない
  app.store.emit({ serverTime: '2026-10-05T00:00:00Z' });
  assert.deepEqual(cards(), before);
  // 番号は増えたが中身が同じ配合は、同じ要素を使い回す
  app.store.emit({ records: [{ ...source, etag: 'e1' }] });
  assert.deepEqual(cards(), before);
  // 楽観更新（etag は同じで updatedAt が変わる）は作り直す（古い表示を残さない）。同じ配合なので光らせない
  app.store.emit({ records: [{ ...source, etag: 'e1', updatedAt: '2026-10-06T00:00:00Z', memo: '書き換え' }] });
  assert.ok(cards().every((card) => !before.includes(card)));
  assert.match(cards()[0].textContent, /書き換え/);
  assert.ok(cards().every((card) => !/is-new/.test(card.className)));
  // 表示中に増えた配合だけ光らせる
  app.store.emit({ records: [...app.store.state.records, { ...source, id: '増えた', childId: 'CatMage', updatedAt: '2026-10-07T00:00:00Z' }] });
  assert.deepEqual(cards().map((card) => /is-new/.test(card.className)), [true, false]);
  // 条件を変えた描画では光らせない
  view.applyRoute(parseHash('#/search?sort=child-dex'), { reason: 'update' });
  assert.ok(cards().every((card) => !/is-new/.test(card.className)));
  view.destroy();
});

test('配合を探す: 親を選んだ後に記録が取り直されても、同じ配合のカードは同じ要素のまま（件数の行も残す）', (t) => {
  installDom(t);
  const app = liveContext();
  const view = searchView(app, parseHash('#/search?p1=SheepBall'));
  const card = view.element.querySelector('.breeding-card');
  assert.ok(card);
  assert.equal(view.element.querySelector('.find-count-text').textContent, '1 件');
  app.store.emit({ records: [...app.store.state.records] });
  assert.equal(view.element.querySelector('.breeding-card'), card);
  // カードの操作ボタンには、差分更新でフォーカスを戻すための目印がある
  assert.deepEqual(card.querySelectorAll('[data-focus]').map((node) => node.getAttribute('data-focus')), ['edit', 'remove']);
  view.destroy();
});

test('配合を探す: 登録の無い組み合わせで「この組み合わせを登録」にフォーカスしたまま記録が取り直されても、空の表示を作り直さずフォーカスも外れない', async (t) => {
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

test('配合を探す: パル選択の並びは図鑑順のまま、親（親1・親2）・子（子）としての登録件数を添え、0 件の行は薄くする', async (t) => {
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
  const childSearch = searchView(context(), parseHash('#/search'));
  const child = await pickerRows(childSearch, 2);
  assert.deepEqual(child.rows.filter((row) => row.badge).map((row) => [row.name, row.badge]), [['セレムーン', '子 1 件']]);
  assert.equal(child.rows.find((row) => row.name === 'モコロン').dim, true);
  childSearch.destroy();
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
test('配合を探す: キーワードの入力の間引きの途中で画面を閉じたら、閉じた後に URL を変えない。flushInputs は待っている入力をすぐ当てる', async (t) => {
  installDom(t);
  const typeIn = async (view, value) => {
    const keyword = view.element.querySelector('.find-keyword').querySelector('input');
    keyword.value = value;
    await keyword.dispatch('input');
  };
  const cards = (view) => view.element.querySelectorAll('.breeding-card').length;
  const app = { ...context(), inputDelay: 20 };
  let view = null;
  const updates = updating(app, () => view);
  view = searchView(app, parseHash('#/search'));
  const shown = cards(view);
  assert.ok(shown > 0);
  await typeIn(view, '該当なし');
  view.destroy();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(updates, []);
  const slow = { ...context(), inputDelay: 1000 };
  let later = null;
  const slowUpdates = updating(slow, () => later);
  later = searchView(slow, parseHash('#/search'));
  await typeIn(later, '該当なし');
  assert.equal(cards(later), shown);
  later.flushInputs();
  assert.equal(slowUpdates.length, 1);
  assert.equal(cards(later), 0);
  later.destroy();
});

test('配合を探す: 利用者が並べ替えを変えたら、結果の先頭が条件帯の下に隠れているときだけ見える位置へ移す。データの更新では動かさない', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const app = liveContext([{ ...source, etag: 'e1' }]);
  let view = null;
  updating(app, () => view);
  view = searchView(app, parseHash('#/search'));
  const results = view.element.querySelector('.find-results');
  const panel = view.element.querySelector('.find-bar');
  const moves = [];
  results.scrollIntoView = (options) => moves.push(options);
  let top = 300;
  results.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, width: 100 });
  panel.getBoundingClientRect = () => ({ top: 64, bottom: 180, left: 0, width: 100, height: 116 });
  const sort = view.element.querySelector('.find-sort').querySelector('select');
  // 先頭が見えているときは動かさない
  sort.value = 'parent-dex';
  await sort.dispatch('change');
  assert.deepEqual(moves, []);
  // 下の方を見ていて（先頭が帯の下に隠れている）並べ替えを変えると、先頭へ
  top = -2000;
  sort.value = 'child-dex';
  await sort.dispatch('change');
  assert.deepEqual(moves.slice(0, 1), [{ block: 'start' }]);
  const count = moves.length;
  // データの更新では動かさない
  app.store.emit({ records: [{ ...source, etag: 'e2' }] });
  assert.equal(moves.length, count);
  view.destroy();
});

test('見出し: 各画面の h1 はタブの名前（views/tabs.js の TABS）。キャッチコピーの見出しは出さない', (t) => {
  installDom(t);
  assert.deepEqual(TABS.map(([view]) => view), ['search', 'route', 'drafts', 'wishlist', 'owned', 'ideal', 'settings']);
  assert.equal(tabLabel('search'), '配合を探す');
  assert.equal(tabLabel('route'), '継承ルート');
  assert.equal(tabLabel('pal'), '');
  assert.equal(tabLabel('reverse'), '');
  for (const [view, make] of [['search', () => searchView(context(), parseHash('#/search'))],
    ['route', () => inheritanceView(context(), parseHash('#/route'))], ['settings', () => settingsView(context())]]) {
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

test('配合を探す: 登録者・キーワードで 0 件なら「条件に合う登録はありません。」と「条件をすべて解除」（押すと全件に戻り、キーワードの欄へ）。登録が 1 件もなければ登録へ', async (t) => {
  installDom(t);
  const app = context();
  let view = null;
  const updates = updating(app, () => view);
  view = searchView(app, parseHash(`#/search?p1=SheepBall&q=${encodeURIComponent('該当なし')}`));
  document.body.append(view.element);
  const keyword = view.element.querySelector('.find-keyword').querySelector('input');
  assert.equal(keyword.value, '該当なし');
  const emptyState = view.element.querySelector('.empty-state');
  assert.equal(emptyState.querySelector('p').textContent, '条件に合う登録はありません。');
  assert.ok(emptyState.querySelector('.empty-icon'));
  const clear = emptyState.querySelector('button');
  assert.equal(clear.textContent, '条件をすべて解除');
  clear.focus();
  await clear.dispatch('click');
  assert.equal(updates.at(-1), '#/search');
  assert.equal(keyword.value, '');
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 1);
  assert.equal(document.activeElement, keyword);
  // 登録者が記録にいなければ、選択肢に 0 件で足して選んだまま
  view.applyRoute(parseHash(`#/search?by=${encodeURIComponent('キャロル')}`), { reason: 'history' });
  const registrant = view.element.querySelector('.find-registrant').querySelector('select');
  assert.equal(registrant.value, 'by:キャロル');
  assert.equal(registrant.children.at(-1).textContent, 'キャロル · 0 件');
  assert.equal(view.element.querySelector('.empty-state').querySelector('p').textContent, '条件に合う登録はありません。');
  view.destroy();
  // 登録が 1 件もないとき
  const registers = [];
  const none = context([]);
  none.register = (fields) => registers.push(fields ?? null);
  const emptyList = searchView(none, parseHash('#/search'));
  const noRecords = emptyList.element.querySelector('.empty-state');
  assert.equal(noRecords.querySelector('p').textContent, 'まだ配合が登録されていません。');
  await noRecords.querySelector('button').dispatch('click');
  assert.deepEqual(registers, [{}]);
  emptyList.destroy();
});

test('配合を探す: 条件で 0 件なら、選んだ親・子を入れて登録を開く（親 2 体・親 1 体・親と子・子だけ。子も渡す）', async (t) => {
  installDom(t);
  const app = context();
  const registers = [];
  app.register = (fields) => registers.push(fields);
  for (const [hash, label, fields] of [
    ['#/search?p1=PinkCat', 'この親で配合を登録', { parent1Id: 'PinkCat' }],
    ['#/search?p2=PinkCat', 'この親で配合を登録', { parent1Id: 'PinkCat' }],
    ['#/search?p1=PinkCat&p2=SheepBall', 'この組み合わせを登録', { parent1Id: 'PinkCat', parent2Id: 'SheepBall' }],
    ['#/search?p1=PinkCat&p2=SheepBall&c=CatMage', 'この組み合わせを登録', { parent1Id: 'PinkCat', parent2Id: 'SheepBall', childId: 'CatMage' }],
    ['#/search?p1=SheepBall&c=CatMage', 'この親と子で配合を登録', { parent1Id: 'SheepBall', childId: 'CatMage' }],
    ['#/search?c=CatMage', 'この子の配合を登録', { childId: 'CatMage' }],
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
  const views = [searchView(app, parseHash('#/search?p1=SheepBall')), searchView(app, parseHash('#/search?c=MoonQueen')),
    searchView(app, parseHash('#/search')), palView(app, parseHash('#/pal/SheepBall')), inheritanceView(app, parseHash('#/route?from=SheepBall&to=MoonQueen'))];
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

// 配合を探すの「新」の印の基準（search-seen.js と同じ形の偽物）
function seenStore(initial = null) {
  const writes = [];
  let value = initial;
  return { writes, read: () => value, write: (env, userId, time = 'now') => { writes.push([env, userId, time]); value = time; } };
}

test('配合を探す: 他人の登録で、前に画面を離れた時刻より後に作られたものに「新」を付け、件数の行に「新着 n 件」（押すと更新日の新しい順）。初めてなら印を付けず今の時刻を書くだけ', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const records = [
    { ...source, id: '他人の新しい', registrant: 'ボブ', createdAt: '2026-10-05T00:00:00Z' },
    { ...source, id: '自分の新しい', childId: 'CatMage', registrant: '仲間', createdAt: '2026-10-05T00:00:00Z' },
    { ...source, id: '他人の古い', childId: 'PinkCat', registrant: 'ボブ', createdAt: '2026-10-01T00:00:00Z' },
  ];
  // 初めて開いた（基準がない）
  const first = context(records);
  first.store.state.serverTime = '2026-10-06T00:00:00Z';
  first.seen = seenStore();
  const fresh = searchView(first, parseHash('#/search'));
  assert.equal(fresh.element.querySelector('.new-chip'), null);
  assert.equal(fresh.element.querySelector('.find-new').hidden, true);
  assert.deepEqual(first.seen.writes, [['test', '仲間', '2026-10-06T00:00:00Z']]);
  fresh.destroy();
  // 離れるときに基準を今の取得の時刻に進める
  assert.deepEqual(first.seen.writes.at(-1), ['test', '仲間', '2026-10-06T00:00:00Z']);
  // 前に離れた時刻が 10/03 なら、他人の 10/05 の登録だけ新着
  const app = context(records);
  app.seen = seenStore('2026-10-03T00:00:00Z');
  let view = null;
  const updates = updating(app, () => view);
  view = searchView(app, parseHash('#/search?sort=child-dex'));
  const marked = view.element.querySelectorAll('.breeding-card').filter((card) => card.querySelector('.new-chip'));
  assert.equal(marked.length, 1);
  assert.equal(marked[0].querySelector('.new-chip').textContent, '新');
  const button = view.element.querySelector('.find-new');
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, '新着 1 件');
  await button.dispatch('click');
  assert.equal(updates.at(-1), '#/search');
  // 更新日の新しい順では押せない（新着は上に並んでいる）
  assert.equal(button.getAttribute('aria-disabled'), 'true');
  view.destroy();
  // 端末に読み書きできなくても壊れない（新着なし）
  const none = context(records);
  const broken = () => { throw new Error('使えない'); };
  none.seen = createSearchSeen({ storage: { getItem: broken, setItem: broken } });
  const quiet = searchView(none, parseHash('#/search'));
  assert.equal(quiet.element.querySelector('.new-chip'), null);
  assert.doesNotThrow(() => quiet.destroy());
});

test('配合を探す: 親を 1 体だけ選んで結果が 6 件以上なら、子ごとの要約のチップを出し、押すと子で絞る（もう一度押すと外す）', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const children = ['MoonQueen', 'CatMage', 'PinkCat', 'Kitsunebi', 'Alpaca', 'Boar'];
  const records = children.map((childId, index) => ({ ...source, id: `r${index}`, parent2Id: index % 2 ? 'SheepBall' : 'PinkCat', parent1Id: 'FlowerDoll', childId }));
  records.push({ ...source, id: 'r9', parent1Id: 'FlowerDoll', parent2Id: 'Alpaca', childId: 'MoonQueen' });
  const app = context(records);
  let view = null;
  const updates = updating(app, () => view);
  view = searchView(app, parseHash('#/search?p1=FlowerDoll'));
  const chips = () => view.element.querySelector('.find-child-chips');
  assert.equal(chips().hidden, false);
  const first = chips().children[0];
  assert.match(first.textContent, /セレムーン2/);
  assert.equal(first.getAttribute('aria-pressed'), 'false');
  await first.dispatch('click');
  assert.equal(updates.at(-1), '#/search?p1=FlowerDoll&c=MoonQueen');
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 2);
  assert.equal(chips().hidden, false);
  assert.equal(chips().children[0].getAttribute('aria-pressed'), 'true');
  await chips().children[0].dispatch('click');
  assert.equal(updates.at(-1), '#/search?p1=FlowerDoll');
  // 親 2 体・5 件以下では出さない
  view.applyRoute(parseHash('#/search?p1=FlowerDoll&p2=SheepBall'), { reason: 'update' });
  assert.equal(chips().hidden, true);
  view.destroy();
});

// 所持パルのデータ（ownedCounts が読む形の個体だけ）を持つ偽物
function ownedStore(pals) {
  const listeners = new Set();
  return {
    state: { owned: pals ? { pals } : null },
    loads: 0,
    load() { this.loads++; return Promise.resolve(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { this.state = { owned: next ? { pals: next } : null }; listeners.forEach((listener) => listener(this.state)); },
  };
}
const ownedPal = (id, palId, gender, extra = {}) => ({ id, palId, gender, egg: false, place: 'palbox', ...extra });

test('配合を探す: 所持パルのデータがあれば、カードの親に「♂n ♀m／未所持」、子に「所持 N」を出し（押すと所持パル）、データが変わったら描き直す。なければ何も出さない', async (t) => {
  installDom(t);
  const none = context();
  none.owned = ownedStore(null);
  const plain = searchView(none, parseHash('#/search'));
  assert.equal(plain.element.querySelector('.owned-count'), null);
  assert.equal(plain.element.querySelector('.find-owned').hidden, true);
  assert.equal(none.owned.loads, 1);
  plain.destroy();
  const app = context();
  // フラリーナ ♀1（親）・モコロンはタマゴだけ・セレムーン 2 体（子）
  app.owned = ownedStore([
    ownedPal('a', 'FlowerDoll', 'F'), ownedPal('b', 'SheepBall', 'M', { egg: true }),
    ownedPal('c', 'MoonQueen', 'F'), ownedPal('d', 'MoonQueen', 'M', { place: 'global' }),
  ]);
  const view = searchView(app, parseHash('#/search'));
  const badges = () => view.element.querySelector('.breeding-card').querySelectorAll('.owned-count').map((node) => [node.className, node.textContent, node.href ?? '']);
  // 親の印は「♂0 ♀1」（性別の記号は色だけの genderMark）。タマゴ等だけなら「タマゴ等のみ」、子は「所持 N」
  assert.deepEqual(badges(), [
    ['owned-count', '♂0♀1', '#/owned?pal=FlowerDoll'],
    ['owned-count is-blocked', 'タマゴ等のみ', '#/owned?pal=SheepBall'],
    ['owned-count is-child', '所持 2', '#/owned?pal=MoonQueen'],
  ]);
  assert.match(view.element.querySelector('.is-blocked').title, /うちタマゴ 1・グローバルパルボックス 0・性別不明 0 は親にできません/);
  assert.equal(view.element.querySelector('.find-owned').hidden, false);
  // データが変わったら描き直す（所持していなければ「未所持」・子は何も出さない）
  app.owned.set([]);
  assert.deepEqual(badges().map(([className, text]) => [className, text]), [['owned-count is-none', '未所持'], ['owned-count is-none', '未所持']]);
  view.destroy();
});

test('配合を探す: 「両親を持つ組を上へ」は組める記録を群の中で先に（安定に）、「今の所持で作れる」は組めて子を持っていない記録だけ。所持パルがなければ効かない', async (t) => {
  installDom(t);
  const source = context().store.state.records[0];
  const records = [
    { ...source, id: '組めない', parent1Id: 'PinkCat', parent2Id: 'CatMage', childId: 'Kitsunebi', updatedAt: '2026-10-09T00:00:00Z' },
    { ...source, id: '組める・子あり', childId: 'MoonQueen', updatedAt: '2026-10-08T00:00:00Z' },
    { ...source, id: '組める・子なし', childId: 'Alpaca', updatedAt: '2026-10-07T00:00:00Z' },
  ];
  const app = context(records);
  app.owned = ownedStore([ownedPal('a', 'FlowerDoll', 'F'), ownedPal('b', 'SheepBall', 'M'), ownedPal('c', 'MoonQueen', 'F')]);
  let view = null;
  const updates = updating(app, () => view);
  view = searchView(app, parseHash('#/search'));
  const children = () => view.element.querySelectorAll('.breeding-card').map((card) => card.querySelector('.breeding-equation').querySelectorAll('strong').at(-1).textContent);
  const ja = (id) => pals.find((pal) => pal.id === id).ja;
  assert.deepEqual(children(), [ja('Kitsunebi'), ja('MoonQueen'), ja('Alpaca')]);
  const [first, make] = view.element.querySelector('.find-toggles').querySelectorAll('button');
  assert.equal(first.textContent, '両親を持つ組を上へ');
  await first.dispatch('click');
  assert.equal(updates.at(-1), '#/search?ownedfirst=1');
  assert.equal(first.getAttribute('aria-pressed'), 'true');
  // 組める 2 件が今の並び（更新日の新しい順）のまま先へ
  assert.deepEqual(children(), [ja('MoonQueen'), ja('Alpaca'), ja('Kitsunebi')]);
  await make.dispatch('click');
  assert.equal(updates.at(-1), '#/search?ownedfirst=1&make=1');
  assert.deepEqual(children(), [ja('Alpaca')]);
  // 作れる配合がなければ、切り替えを外す案内
  app.owned.set([]);
  const emptyState = view.element.querySelector('.empty-state');
  assert.equal(emptyState.querySelector('p').textContent, '今の所持パルで作れる配合はありません。');
  await emptyState.querySelector('button').dispatch('click');
  assert.equal(updates.at(-1), '#/search?ownedfirst=1');
  // 所持パルのデータがなければ、URL にあっても効かない（切り替えも出さない）
  app.owned.set(null);
  view.applyRoute(parseHash('#/search?make=1'), { reason: 'history' });
  assert.equal(view.element.querySelectorAll('.breeding-card').length, 3);
  assert.equal(view.element.querySelector('.find-owned').hidden, true);
  view.destroy();
});
