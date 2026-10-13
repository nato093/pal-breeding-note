import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { normalizeOwned } from '../../web/js/core/owned.js';
import { parseHash } from '../../web/js/router.js';
import { ownedView, OWNED_MEMORY } from '../../web/js/views/owned.js';
import { cleanSaved } from '../../web/js/core/boundary.js';
import { ownedSettingsCard } from '../../web/js/views/owned-settings.js';
import { fakeHandle } from '../helpers/file-handles.js';
import { inheritanceView } from '../../web/js/views/route.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const snapshot = {
  version: 1, world: { name: 'テスト', hostName: 'Alice' }, players: [{ uid: P1, name: 'Alice', level: 50 }], bases: [],
  pals: [
    { instanceId: 'a', characterId: 'SheepBall', nickname: 'もこ', gender: 'Female', level: 12, rank: 3, passives: ['CraftSpeed_up2', 'Rare'],
      talent: { hp: 10, shot: 20, defense: 30 }, isRare: true, location: { kind: 'palbox', playerUid: P1, slotIndex: 31 } },
    { instanceId: 'b', characterId: 'PinkCat', gender: 'Male', level: 3, rank: 1, passives: [], talent: {}, location: { kind: 'party', playerUid: P1 } },
    { instanceId: 'c', characterId: 'FlowerDoll', passives: ['CraftSpeed_up2'], talent: {}, location: { kind: 'egg-ground', playerUid: P1 } },
    { instanceId: 'g', characterId: 'PinkCat', passives: [], talent: {}, location: { kind: 'global', playerUid: '' } },
  ],
  stats: {},
};

function fakeOwned(data = { version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', hostName: 'Alice', updatedAt: '2026-10-05T00:00:00.000Z' }, snapshot }, overrides = {}) {
  const listeners = new Set();
  const state = {
    ready: true, data, owned: data ? normalizeOwned(data.snapshot, { pals, passives }) : null, busy: false, progress: '', error: '',
    auto: { enabled: Boolean(data), status: 'ready', worlds: data ? [{ id: 'W', dir: 'W', kind: 'host', name: 'テスト', hostName: 'Alice', status: 'ok', role: 'host', playedAt: data.world.updatedAt, files: ['Level.sav'] }] : [], worldId: '', error: '' }, folder: null, uploadReady: Boolean(data),
    role: data ? 'host' : '', linkedWorldId: data ? 'W' : '', viewWorldId: '', local: data,
    shared: { worlds: [], current: null, fetchedAt: '', error: '' }, upload: { status: '', at: '', error: '', worldId: '' },
    meta: data ? { worldId: 'W', worldName: 'テスト', hostName: 'Alice', source: 'local', saveUpdatedAt: data.world.updatedAt, importedAt: data.importedAt, sharedAt: '2026-10-05T00:01:00.000Z', uploadedBy: 'ホスト', palCount: 3 } : null,
    ...overrides,
  };
  return {
    state, loads: 0,
    load() { this.loads++; return Promise.resolve(); },
    autoRefresh: () => Promise.resolve('skipped'),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit() { listeners.forEach((listener) => listener(state)); },
  };
}

function context(owned, records = []) {
  const index = buildIndex(records, pals);
  const state = { records, index, graph: buildCarrierGraph(index), env: 'test', warnings: [], userId: '仲間' };
  const navigations = [];
  // 入力の間引き（キーワード・個体値）を 0 にして、入力した直後の結果を同期で確かめる
  return { store: { state, subscribe: () => () => {} }, owned, navigations, navigate: (hash) => navigations.push(hash), inputDelay: 0 };
}

test('所持パル画面: 読み込んだパルを、パッシブ・所持者・場所と更新時刻つきで一覧にする（連携の設定は出さない）', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned'));
  const rows = view.element.querySelectorAll('.owned-row');
  // グローバルボックスは既定で出さない
  assert.equal(rows.length, 3);
  const first = rows[0];
  assert.match(first.textContent, /モコロン/);
  assert.match(first.textContent, /「もこ」/);
  assert.match(first.textContent, /ラッキー/);
  assert.deepEqual(first.querySelectorAll('.passive-chip').map((node) => node.textContent), ['職人気質', '希少']);
  assert.deepEqual(first.querySelectorAll('.passive-chip').map((node) => node.className), ['passive-chip passive-rank-3', 'passive-chip passive-rank-4']);
  // パルボックスはページと位置まで出す
  assert.match(first.textContent, /Alice.*パルボックス 2 ページ・1 行 2 列/);
  assert.match(first.textContent, /★★/);
  assert.match(rows.find((row) => /タマゴ/.test(row.textContent)).textContent, /孵化前/);
  assert.equal(view.element.querySelector('.owned-world').textContent, '「テスト」（ホスト Alice） · 4 体');
  assert.match(view.element.querySelector('.owned-times').textContent, /セーブの更新: .*共有: .*（ホスト）/);
  assert.equal(view.element.querySelector('.result-note').textContent, '3 体');
  assert.doesNotMatch(view.element.textContent, /セーブのファイルを登録|フォルダを選んで読み込む|データを消す/);
  const labels = view.element.querySelectorAll('.owned-toggle').map((node) => [node.textContent, node.children[0].checked]);
  assert.deepEqual(labels, [['タマゴも表示', true], ['グローバルボックスを表示', false]]);
  view.destroy();
});

test('所持パル画面: グローバルボックスとタマゴの表示を切り替え、パッシブで絞り込む', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned?p=CraftSpeed_up2'));
  assert.equal(view.element.querySelectorAll('.owned-row').length, 2);
  const [eggs, globals] = view.element.querySelectorAll('.owned-toggle').map((node) => node.children[0]);
  eggs.checked = false;
  await eggs.dispatch('change');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 1);
  view.destroy();
  const all = ownedView(context(fakeOwned()), parseHash('#/owned'));
  const toggle = all.element.querySelectorAll('.owned-toggle')[1].children[0];
  toggle.checked = true;
  await toggle.dispatch('change');
  assert.equal(all.element.querySelectorAll('.owned-row').length, 4);
  assert.ok(all.element.querySelectorAll('option').some((node) => node.textContent === 'グローバルパルボックス'));
  all.destroy();
});

test('所持パル画面: タブを切り替えて作り直しても絞り込みを残し、URL の指定は優先してから URL から外す', async (t) => {
  installDom(t);
  const states = new Map();
  const replaced = [];
  const memoryContext = () => Object.assign(context(fakeOwned()), {
    viewState(view) { if (!states.has(view)) states.set(view, {}); return states.get(view); },
    replace: (hash) => replaced.push(hash),
  });
  const rows = (view) => view.element.querySelectorAll('.owned-row').length;
  const keyword = (view) => view.element.querySelectorAll('input').find((node) => node.type === 'search');
  const first = ownedView(memoryContext(), parseHash('#/owned'));
  const query = keyword(first);
  query.value = 'もこ';
  await query.dispatch('input');
  const [eggs] = first.element.querySelectorAll('.owned-toggle').map((node) => node.children[0]);
  eggs.checked = false;
  await eggs.dispatch('change');
  const hp = first.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）');
  hp.value = '5';
  await hp.dispatch('input');
  assert.equal(rows(first), 1);
  first.destroy();
  const again = ownedView(memoryContext(), parseHash('#/owned'));
  assert.equal(rows(again), 1);
  assert.equal(keyword(again).value, 'もこ');
  assert.equal(again.element.querySelectorAll('.owned-toggle')[0].children[0].checked, false);
  assert.equal(again.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）').value, '5');
  assert.deepEqual(replaced, []);
  again.destroy();
  // URL でパッシブを指定して開いたら、その指定で絞り込み、URL からは外す（キーワードなどは残す）
  const linked = ownedView(memoryContext(), parseHash('#/owned?p=Rare'));
  assert.deepEqual(states.get('owned').filter.passives, ['Rare']);
  assert.deepEqual(replaced, ['#/owned']);
  assert.equal(rows(linked), 1);
  linked.destroy();
  // 作り直していない新しい入れ物（ページの読み込み直し）では既定に戻る
  states.clear();
  const fresh = ownedView(memoryContext(), parseHash('#/owned'));
  assert.equal(rows(fresh), 3);
  assert.equal(keyword(fresh).value, '');
  fresh.destroy();
});

test('所持パル画面: 同じ画面のまま絞り込みつきの URL が来ると（applyRoute）、作り直さずに絞り込みと選択欄を合わせ、URL から外す', (t) => {
  installDom(t);
  const states = new Map();
  const replaced = [];
  const app = Object.assign(context(fakeOwned()), {
    viewState(view) { if (!states.has(view)) states.set(view, {}); return states.get(view); },
    replace: (hash) => replaced.push(hash),
  });
  const view = ownedView(app, parseHash('#/owned'));
  const keyword = view.element.querySelectorAll('input').find((node) => node.type === 'search');
  const trigger = view.element.querySelector('.picker-trigger');
  keyword.value = 'もこ';
  assert.equal(view.element.querySelectorAll('.owned-row').length, 3);
  view.applyRoute(parseHash('#/owned?pal=PinkCat'), { reason: 'history' });
  assert.deepEqual(replaced, ['#/owned']);
  assert.equal(view.element.querySelector('.picker-trigger'), trigger);
  assert.equal(trigger.getAttribute('aria-label'), 'パル: No.2 ツッパニャン');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 1);
  // 画面の中の入力（キーワード）は消さない
  assert.equal(keyword.value, 'もこ');
  // 絞り込みのない URL では何も変えない
  view.applyRoute(parseHash('#/owned'), { reason: 'history' });
  assert.equal(view.element.querySelectorAll('.owned-row').length, 1);
  assert.deepEqual(replaced, ['#/owned']);
  view.destroy();
});

test('所持パル画面: キーワードはスキルや属性でも探せ、一覧に出していないスキルで一致したときは行にその名前を出す', async (t) => {
  installDom(t);
  const data = {
    version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles',
    world: { id: 'W', dir: 's/W', name: 'テスト', hostName: 'Alice', updatedAt: '2026-10-05T00:00:00.000Z' },
    snapshot: { ...snapshot, pals: snapshot.pals.map((pal) => (pal.instanceId === 'a' ? { ...pal, skills: ['Unique_SheepBall_Roll', 'AirCanon'] } : pal)) },
  };
  const view = ownedView(context(fakeOwned(data)), parseHash('#/owned'));
  const query = view.element.querySelectorAll('input').find((node) => node.type === 'search');
  const search = async (text) => {
    query.value = text;
    await query.dispatch('input');
    return view.element.querySelectorAll('.owned-row').map((row) => row.querySelectorAll('.owned-hit').map((node) => node.textContent));
  };
  // 一覧に出していないスキルで一致したら、パッシブの下に一致したスキルだけを出す
  assert.deepEqual(await search('えあー'), [['アクティブスキル：エアーキャノン']]);
  assert.deepEqual(await search('猫の手'), [['パートナースキル：猫の手も借りたい']]);
  // 説明文で一致したときは、名前の下に説明を添える（パッシブは説明で一致したときだけ）
  await search('空気の塊 作業速度');
  const [row] = view.element.querySelectorAll('.owned-row');
  assert.deepEqual(row.querySelectorAll('.owned-hit').map((node) => [node.querySelector('.owned-hit-name').textContent, node.querySelector('.owned-hit-desc')?.textContent]), [
    ['アクティブスキル：エアーキャノン', '高速で飛ぶ空気の塊を発射する。'],
    ['パッシブ：職人気質', '作業速度 +50%'],
    ['パッシブ：希少', '攻撃 +15% 防御 +15% 作業速度 +20%'],
  ]);
  // 名前・属性・ラッキーなど、一覧に出している項目で一致したときは出さない
  assert.deepEqual(await search('無 ラッキー'), [[]]);
  assert.deepEqual(await search(''), [[], [], []]);
  view.destroy();
});

test('所持パル画面: 性別は名前の左に出し、パル濃縮と個体値で絞り込む', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  const line = view.element.querySelectorAll('.owned-row')[0].querySelector('.pal-name-line');
  assert.deepEqual(line.children.map((node) => node.textContent), ['♀', 'モコロン']);
  const rows = () => view.element.querySelectorAll('.owned-row').length;
  const stars = view.element.querySelectorAll('select').find((node) => node.children.some((child) => child.textContent === '★1 以上'));
  stars.value = '2';
  await stars.dispatch('change');
  assert.equal(rows(), 1);
  stars.value = '';
  await stars.dispatch('change');
  assert.equal(rows(), 3);
  const hp = view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）');
  hp.value = '10';
  await hp.dispatch('input');
  assert.equal(rows(), 1);
  hp.value = '11';
  await hp.dispatch('input');
  assert.equal(rows(), 0);
  assert.match(view.element.textContent, /条件に合うパルはいません/);
  view.destroy();
});

test('所持パル画面: 人間のキャラクターはゲームの名前とアイコンで出し、件数が多くても全部出す', (t) => {
  installDom(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const many = Array.from({ length: 250 }, (_, i) => ({ instanceId: `s${i}`, characterId: 'SheepBall', passives: [], talent: {}, location: { kind: 'palbox', playerUid: P1 } }));
  const humans = [{ instanceId: 'h', characterId: 'BOSS_Believer_CrossBow', gender: 'Male', passives: [], talent: {}, location: { kind: 'palbox', playerUid: P1 } }];
  const data = { version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', updatedAt: '2026-10-05T00:00:00.000Z' }, snapshot: { ...snapshot, pals: [...humans, ...many] } };
  const view = ownedView(context(fakeOwned(data)), parseHash('#/owned'));
  // 先頭の 200 行をすぐ出し、残りは区切って足す（途中で止めず、もっと見るもない）
  assert.equal(view.element.querySelectorAll('.owned-row').length, 200);
  t.mock.timers.runAll();
  const rows = view.element.querySelectorAll('.owned-row');
  assert.equal(rows.length, 251);
  assert.equal(view.element.querySelectorAll('.load-more').length, 0);
  const human = rows.find((row) => /賞金首 エゴ/.test(row.textContent));
  assert.ok(human);
  assert.doesNotMatch(human.textContent, /マスターにない|BOSS_Believer_CrossBow/);
  assert.match(human.querySelector('img').src, /img\/humans\/T_BOSS_NPC_Believer\.png$/);
  view.destroy();
});

test('所持パル画面: 連携が設定されていなければ、その旨だけを出す', (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned(null)), parseHash('#/owned'));
  assert.match(view.element.querySelector('.owned-notices').textContent, /セーブのファイルが登録されていません。.*設定タブ/);
  assert.equal(view.element.querySelectorAll('.owned-row').length, 0);
  assert.equal(view.element.querySelectorAll('button').filter((node) => /読み込む|連携/.test(node.textContent)).length, 0);
  view.destroy();
  const guest = ownedView(context(fakeOwned(null, { role: 'guest', folder: { id: 'W', role: 'guest' }, linkedWorldId: 'W' })), parseHash('#/owned'));
  assert.match(guest.element.querySelector('.owned-notices').textContent, /ホストがまだこのワールドの所持パルを共有していません/);
  guest.destroy();
});

test('設定画面: セーブ連携の状態・登録したワールド・使うワールドを出す', async (t) => {
  installDom(t);
  const { settingsView } = await import('../../web/js/views/settings.js');
  const owned = fakeOwned();
  const app = context(owned);
  app.store.state.records = [];
  const view = settingsView(app);
  const card = view.element.querySelector('.owned-settings');
  assert.ok(card);
  assert.match(card.querySelector('.owned-settings-status').textContent, /この PCホスト.*表示中「テスト」（ホスト Alice）/);
  // 登録したワールドは一覧にし、編集・削除はそれぞれの行から。登録はモーダルで
  assert.match(card.querySelector('.owned-registered').textContent, /「テスト」（ホスト Alice） · ホスト · 1 ファイル.*編集削除/);
  assert.ok(card.querySelectorAll('button').some((node) => node.textContent === '＋ ワールドを登録'));
  // 所持パルの CSV・共有の削除は、ワールドの行の中（カード全体のボタンはない）
  assert.ok(card.querySelector('.owned-world-details').querySelector('.owned-world-pals'));
  // 使うワールドは、登録したワールドから選ぶ（自動 = いま遊んでいるワールド）
  const select = card.querySelector('.owned-world-row').querySelector('select');
  assert.deepEqual(select.querySelectorAll('option').map((node) => node.textContent), ['自動（いま遊んでいるワールド: 「テスト」（ホスト Alice））', '「テスト」（ホスト Alice）']);
  view.destroy();
});

test('継承ルート: パッシブを選ぶと、持っている所持パルから目標への経路と相手親の所持数を出す', (t) => {
  installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
  ];
  const owned = fakeOwned();
  const app = context(owned, records);
  const view = inheritanceView(app, parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.equal(view.element.querySelectorAll('.picker').length, 2);
  const starts = view.element.querySelectorAll('.route-start');
  assert.equal(starts.length, 1);
  // 候補の要約は、パルボックスのページと位置までは出さない
  assert.match(starts[0].textContent, /モコロン.*最短 1 回の配合.*1 体 · Alice・パルボックス/);
  assert.doesNotMatch(starts[0].textContent, /ページ/);
  const go = starts[0].querySelector('.button');
  assert.match(go.href, /from=SheepBall/);
  assert.match(go.href, /p=CraftSpeed_up2/);
  view.destroy();

  const routeView = inheritanceView(app, parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  assert.match(routeView.element.textContent, /最短 1 回の配合/);
  assert.equal(routeView.element.querySelector('.route-owned-note').textContent, '相手親のツッパニャン: 所持 2 体（うちパッシブ一致 0 体）');
  assert.match(routeView.element.querySelector('.route-owned-box').textContent, /職人気質/);
  routeView.destroy();
});

test('継承ルート: 所持パルがあると、目標とパッシブの下に開始の候補を「すべて」を既定にして並べ、押すと絞り込む', async (t) => {
  installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
  ];
  const app = context(fakeOwned(), records);
  const chipStates = (view) => view.element.querySelectorAll('.start-chip').map((chip) => [chip.textContent, chip.getAttribute('aria-pressed')]);

  const view = inheritanceView(app, parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  const order = view.element.children.map((node) => node.className);
  assert.ok(order.indexOf('selection-panel route-query') < order.indexOf('start-filter'));
  assert.equal(view.element.querySelector('.swap-button'), null);
  assert.deepEqual(chipStates(view), [['すべて', 'true'], ['No.1モコロン1回', 'false']]);
  assert.equal(view.element.querySelector('.start-chips').querySelector('.picker-trigger').textContent, '他のパル…');
  await view.element.querySelectorAll('.start-chip')[1].dispatch('click');
  assert.equal(app.navigations.at(-1), '#/route?to=CuteFox&p=CraftSpeed_up2&from=SheepBall');
  view.destroy();

  // 選んだ候補は押された見た目になり、もう一度押すか「すべて」で開始を外す
  const narrowed = inheritanceView(app, parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  assert.deepEqual(chipStates(narrowed), [['すべて', 'false'], ['No.1モコロン1回', 'true']]);
  await narrowed.element.querySelectorAll('.start-chip')[1].dispatch('click');
  await narrowed.element.querySelectorAll('.start-chip')[0].dispatch('click');
  assert.deepEqual(app.navigations.slice(-2), ['#/route?to=CuteFox&p=CraftSpeed_up2', '#/route?to=CuteFox&p=CraftSpeed_up2']);
  narrowed.destroy();

  // 候補にないパルは「他のパル…」の欄に選んだパルとして出す
  const other = inheritanceView(app, parseHash('#/route?from=PinkCat&to=CuteFox&p=CraftSpeed_up2'));
  assert.deepEqual(chipStates(other).map(([, pressed]) => pressed), ['false', 'false']);
  assert.match(other.element.querySelector('.start-chips').querySelector('.picker-trigger').textContent, /ツッパニャン/);
  other.destroy();
});

test('継承ルート: 同じ画面のまま開始のチップやパッシブの × を押しても、作り直した欄の同じ役目の要素にフォーカスを移す', async (t) => {
  const { body } = installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
  ];
  const app = context(fakeOwned(), records);
  const updates = [];
  let view;
  app.update = (hash) => { updates.push(hash); view.applyRoute(parseHash(hash), { reason: 'update' }); };
  view = inheritanceView(app, parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  body.append(view.element);
  const panel = view.element.querySelector('.route-query');
  const chip = view.element.querySelectorAll('.start-chip')[1];
  chip.focus();
  await chip.dispatch('click');
  assert.deepEqual(updates, ['#/route?to=CuteFox&p=CraftSpeed_up2&from=SheepBall']);
  assert.deepEqual(app.navigations, []);
  assert.equal(view.element.querySelector('.route-query'), panel);
  const pressed = view.element.querySelectorAll('.start-chip')[1];
  assert.equal(pressed.getAttribute('aria-pressed'), 'true');
  assert.equal(document.activeElement, pressed);
  // 「すべて」に戻しても、押した「すべて」に残る
  const all = view.element.querySelectorAll('.start-chip')[0];
  all.focus();
  await all.dispatch('click');
  assert.equal(updates.at(-1), '#/route?to=CuteFox&p=CraftSpeed_up2');
  assert.equal(document.activeElement, view.element.querySelectorAll('.start-chip')[0]);
  assert.equal(document.activeElement.getAttribute('aria-pressed'), 'true');
  // パッシブのチップの × で外すと、追加欄へ
  const remove = view.element.querySelector('.passive-remove');
  remove.focus();
  await remove.dispatch('click');
  assert.equal(updates.at(-1), '#/route?to=CuteFox');
  assert.equal(document.activeElement, view.element.querySelector('.passive-add'));
  view.destroy();
});

test('継承ルート: 所持パルのデータがないときは、開始と目標を並べて選ぶ', (t) => {
  installDom(t);
  const view = inheritanceView(context(fakeOwned(null)), parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.ok(view.element.querySelector('.pair-selection'));
  assert.ok(view.element.querySelector('.swap-button'));
  assert.equal(view.element.querySelector('.start-filter'), null);
  assert.match(view.element.querySelector('.route-owned').textContent, /設定タブの「セーブ連携」でワールドを登録/);
  view.destroy();
});

test('パッシブの選択欄: 所持パルのある継承ルートは目標と横に並べる欄（.route-query）に置き、所持パルのない継承ルート・所持パル画面は置かない', (t) => {
  installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
  ];
  const inQuery = (view) => Boolean(view.element.querySelector('.route-query')?.querySelector('.passive-selector'));
  const route = inheritanceView(context(fakeOwned(), records), parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.equal(inQuery(route), true);
  route.destroy();
  // 所持パルがないときは全幅の欄（ふつうは 4 個とも 1 行に収まるので、1 行分のまま）
  const noOwned = inheritanceView(context(fakeOwned(null)), parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.ok(noOwned.element.querySelector('.passive-selector'));
  assert.equal(inQuery(noOwned), false);
  noOwned.destroy();
  const owned = ownedView(context(fakeOwned()), parseHash('#/owned'));
  assert.ok(owned.element.querySelector('.passive-selector'));
  assert.equal(owned.element.querySelector('.route-query'), null);
  owned.destroy();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const DROP_WIN = { DataTransferItem: { prototype: { getAsFileSystemHandle() {} } } };
const WORLD_PATH = 'C:\\Users\\a\\AppData\\Local\\Pal\\Saved\\SaveGames\\7656\\ABCDEF0123456789ABCDEF0123456789';
const dropped = (...names) => ({ items: names.map((name) => ({ kind: 'file', getAsFileSystemHandle: () => Promise.resolve(fakeHandle(name)) })) });

test('設定画面: 「＋ ワールドを登録」のモーダルで、パスを貼ってファイルをドロップすると確かめ、保存で登録する', async (t) => {
  const { body } = installDom(t);
  const calls = [];
  const owned = fakeOwned(null);
  owned.previewRegistration = async (input) => {
    calls.push(['preview', input.worldId, input.steamId, input.files.map((file) => file.path)]);
    return { ...input, kind: 'host', role: 'host', name: 'World9', hostName: 'Dave', palCount: 12, replaced: [] };
  };
  owned.commitRegistration = async (preview) => { calls.push(['commit', preview.worldId]); return { persisted: true, result: 'imported' }; };
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  await card.element.querySelectorAll('button').find((node) => node.textContent === '＋ ワールドを登録').dispatch('click');
  const dialog = body.querySelector('.world-dialog');
  assert.ok(dialog.open);
  const save = dialog.querySelectorAll('button').find((node) => node.textContent === '保存');
  assert.equal(save.disabled, true);
  const path = dialog.querySelector('.owned-path');
  path.value = WORLD_PATH;
  await path.dispatch('input');
  // ドロップするファイルを並べ、ドロップしたものに印を付ける
  assert.match(dialog.querySelector('.owned-draft').textContent, /— Level\.sav— LevelMeta\.sav— LocalData\.sav— Players\\ の中のファイル全部— \.\.\\GlobalPalStorage\.sav（任意）/);
  await dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('Level.sav', 'LevelMeta.sav') });
  await tick();
  await dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('LocalData.sav', '00000000000000000000000000000001.sav') });
  await tick();
  assert.match(dialog.querySelector('.owned-draft').textContent, /✓ Level\.sav✓ LevelMeta\.sav✓ LocalData\.sav✓ Players\\ の中のファイル全部（1 件）/);
  // ドロップするたびに読んで確かめる（「確認する」は押さない）
  assert.deepEqual(calls.at(-1), ['preview', 'ABCDEF0123456789ABCDEF0123456789', '7656', ['Level.sav', 'LevelMeta.sav', 'LocalData.sav', 'Players/00000000000000000000000000000001.sav']]);
  assert.match(dialog.querySelector('.owned-dialog-result').textContent, /「World9」（ホスト Dave） · 12 体/);
  assert.equal(save.disabled, false);
  await save.dispatch('click');
  assert.deepEqual(calls.at(-1), ['commit', 'ABCDEF0123456789ABCDEF0123456789']);
  assert.equal(dialog.open, false);
  card.destroy();
});

test('設定画面: 登録したワールドの「編集」は、パスを入れた状態でモーダルを開き、保存とキャンセルだけを置く', async (t) => {
  const { body } = installDom(t);
  const owned = fakeOwned();
  owned.state.auto.worlds[0].steamId = '7656';
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  await card.element.querySelector('.owned-registered').querySelectorAll('button').find((node) => node.textContent === '編集').dispatch('click');
  const dialog = body.querySelector('.world-dialog');
  assert.equal(dialog.querySelector('.owned-path').value, '%LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\7656\\W');
  assert.match(dialog.querySelector('.owned-draft').textContent, /✓ Level\.sav/);
  // 登録・編集のモーダルには、保存とキャンセルだけを置く（削除は一覧の行から）
  assert.deepEqual(dialog.querySelectorAll('button').map((node) => node.textContent), ['×', 'キャンセル', '保存']);
  card.destroy();
});

test('設定画面: 登録したワールドの行を開くと、そのワールドの配合牧場からの自動登録のオン・オフと登録者を選べる', async (t) => {
  installDom(t);
  const calls = [];
  const autoRegister = {
    map: {},
    enabled(worldId) { return worldId === 'W'; },
    setEnabled(value, worldId) { calls.push(['enabled', value, worldId]); },
    mapping() { return this.map; },
    setMapping(uid, userId, worldId) { calls.push(['mapping', uid, userId, worldId]); },
  };
  const owned = fakeOwned();
  owned.state.auto.worlds.push({ id: 'G', dir: 'G', kind: 'guest', name: '', hostName: '', status: 'ok', role: 'guest', playedAt: '', files: ['LocalData.sav'] });
  const ctx = { ...context(owned), autoRegister };
  ctx.store.state.users = ['Alice', '仲間'];
  const card = ownedSettingsCard(ctx, { win: DROP_WIN });
  // ワールドの行は閉じた状態で並び、開くと設定が出る
  const [host, guest] = card.element.querySelectorAll('.owned-world-details');
  assert.equal(host.open, false);
  // 閉じたままでも、開くと自動登録の設定があることと、いまの状態が分かる
  assert.match(host.querySelector('.owned-world-state').textContent, /配合の自動登録: オン/);
  assert.match(guest.querySelector('.owned-world-state').textContent, /配合の自動登録: 対象外/);
  host.open = true;
  await host.dispatch('toggle');
  const box = host.querySelector('.owned-breeding');
  const toggle = box.querySelector('input');
  assert.equal(toggle.checked, true);
  toggle.checked = false;
  await toggle.dispatch('change');
  // チェックを外すと、行の状態もすぐ変わる
  assert.match(host.querySelector('.owned-world-state').textContent, /配合の自動登録: オフ/);
  const select = box.querySelector('.owned-breeding-player').querySelector('select');
  assert.match(box.querySelector('.owned-breeding-player').textContent, /^Alice/);
  // 手で選んでいなければ、同じ名前のユーザーを使うことを出す
  assert.equal(select.value, '');
  assert.equal(select.querySelectorAll('option')[0].textContent, 'Alice（同じ名前）');
  select.value = '仲間';
  await select.dispatch('change');
  assert.deepEqual(calls, [['enabled', false, 'W'], ['mapping', P1, '仲間', 'W']]);
  // 参加しているだけのワールドでは、自動登録が動かないことだけを出す
  assert.match(guest.querySelector('.owned-breeding').textContent, /参加しているワールドなので、自動登録は動きません/);
  assert.ok(!guest.querySelector('.owned-toggle'));
  // 描き直しても、開いた行は開いたまま
  owned.state.auto.worlds[0].playedAt = '2026-10-06T00:00:00.000Z';
  owned.emit();
  assert.equal(card.element.querySelectorAll('.owned-world-details')[0].open, true);
  card.destroy();
});

test('所持パル画面: 許可が必要なときは案内の中に「読み込みを許可」を出し、押すと許可を求める', async (t) => {
  installDom(t);
  const owned = fakeOwned(null, { auto: { enabled: true, status: 'permission', worlds: [], worldId: '', error: 'セーブを読むには許可が必要です' } });
  let asked = 0;
  owned.grantAndRefresh = () => { asked++; return Promise.resolve({ granted: 1, total: 1, result: 'imported' }); };
  const view = ownedView(context(owned), parseHash('#/owned'));
  const grant = view.element.querySelector('.owned-notices').querySelectorAll('button').find((node) => node.textContent === '読み込みを許可');
  assert.ok(grant);
  await grant.dispatch('click');
  assert.equal(asked, 1);
  view.destroy();
});

test('所持パル画面: 登録した後に増えたプレイヤーの Players のファイルを、追加するよう案内する', (t) => {
  installDom(t);
  const P2 = '0000000a-0000-0000-0000-00000000000b';
  const data = {
    version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 'W', name: 'テスト', updatedAt: '2026-10-05T00:00:00.000Z' },
    snapshot: { ...snapshot, players: [...snapshot.players, { uid: P2, name: 'Bob', level: 10 }, { uid: '0000000c-0000-0000-0000-00000000000d', name: '', level: 0 }],
      files: { used: ['Level.sav', 'Players/00000000000000000000000000000001.sav'], skipped: [] } },
  };
  const view = ownedView(context(fakeOwned(data)), parseHash('#/owned'));
  const text = view.element.querySelector('.owned-notices').textContent;
  assert.match(text, /登録されていないプレイヤーのファイルがあります: Bob（Players\\0000000A00000000000000000000000B\.sav）。/);
  assert.doesNotMatch(text, /0000000C/);
  view.destroy();
});

// モーダルを開いて、パスを貼り、ファイルをドロップするまで
async function openRegister(t, owned) {
  const { body } = installDom(t);
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  await card.element.querySelectorAll('button').find((node) => node.textContent === '＋ ワールドを登録').dispatch('click');
  const dialog = body.querySelector('.world-dialog');
  const path = dialog.querySelector('.owned-path');
  const save = dialog.querySelectorAll('button').find((node) => node.textContent === '保存');
  return { card, dialog, path, save };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const PLAYER_FILE = '00000000000000000000000000000001.sav';
const OTHER_PATH = WORLD_PATH.replace('ABCDEF0123456789ABCDEF0123456789', 'FEDCBA9876543210FEDCBA9876543210');

test('ワールドの登録: 確かめている途中でパスを変えたら、前のワールドの結果では保存できない', async (t) => {
  const owned = fakeOwned(null);
  const pending = deferred();
  owned.previewRegistration = (input) => pending.promise.then(() => ({ ...input, kind: 'host', role: 'host', name: 'A', hostName: '', palCount: 1, replaced: [] }));
  const { dialog, path, save } = await openRegister(t, owned);
  path.value = WORLD_PATH;
  await path.dispatch('input');
  dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('Level.sav', 'LevelMeta.sav', 'LocalData.sav') });
  await tick();
  path.value = OTHER_PATH;
  await path.dispatch('input');
  pending.resolve();
  await tick();
  assert.equal(save.disabled, true);
  assert.equal(dialog.querySelector('.owned-dialog-result').textContent, '');
});

test('ワールドの登録: 保存の途中は、ドロップしても保存ボタンが押せるようにならず、二重に登録しない', async (t) => {
  const owned = fakeOwned(null);
  const commits = [];
  const committing = deferred();
  owned.previewRegistration = async (input) => ({ ...input, kind: 'host', role: 'host', name: 'A', hostName: '', palCount: 1, replaced: [] });
  owned.commitRegistration = (preview) => { commits.push(preview.worldId); return committing.promise; };
  const { dialog, path, save } = await openRegister(t, owned);
  path.value = WORLD_PATH;
  await path.dispatch('input');
  await dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('Level.sav', 'LevelMeta.sav', 'LocalData.sav') });
  await tick();
  assert.equal(save.disabled, false);
  save.dispatch('click');
  await tick();
  await dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped(PLAYER_FILE) });
  await tick();
  assert.equal(save.disabled, true);
  await save.dispatch('click');
  committing.resolve({ persisted: true, result: 'imported' });
  await tick();
  assert.deepEqual(commits, ['ABCDEF0123456789ABCDEF0123456789']);
});

test('ワールドの登録: 編集でパスの Steam ID だけ直しても、確かめ直して新しい Steam ID で保存する', async (t) => {
  const { body } = installDom(t);
  const owned = fakeOwned();
  owned.state.auto.worlds[0].steamId = '7656';
  owned.state.auto.worlds[0].id = 'ABCDEF0123456789ABCDEF0123456789';
  const previews = [];
  owned.previewRegistration = async (input) => { previews.push([input.steamId, input.files.length]); return { ...input, kind: 'host', role: 'host', name: 'A', hostName: '', palCount: 1, replaced: [] }; };
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  await card.element.querySelector('.owned-registered').querySelectorAll('button').find((node) => node.textContent === '編集').dispatch('click');
  const dialog = body.querySelector('.world-dialog');
  const path = dialog.querySelector('.owned-path');
  path.value = WORLD_PATH.replace('7656', '9999');
  await path.dispatch('input');
  await tick();
  assert.deepEqual(previews, [['9999', 0]]);
  assert.equal(dialog.querySelectorAll('button').find((node) => node.textContent === '保存').disabled, false);
});

test('ワールドの登録: ドロップしたファイルを受け取る前にパスを変えたら、そのファイルは新しいワールドに入れない', async (t) => {
  const owned = fakeOwned(null);
  const previews = [];
  owned.previewRegistration = async (input) => { previews.push(input.worldId); return { ...input, kind: 'host', role: 'host', name: 'A', hostName: '', palCount: 1, replaced: [] }; };
  const { dialog, path, save } = await openRegister(t, owned);
  path.value = WORLD_PATH;
  await path.dispatch('input');
  const handle = deferred();
  const slow = { items: ['Level.sav', 'LevelMeta.sav', 'LocalData.sav'].map((name) => ({ kind: 'file', getAsFileSystemHandle: () => handle.promise.then(() => fakeHandle(name)) })) };
  dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: slow });
  path.value = OTHER_PATH;
  await path.dispatch('input');
  handle.resolve();
  await tick();
  await tick();
  assert.deepEqual(previews, []);
  assert.equal(save.disabled, true);
  assert.match(dialog.querySelector('.owned-draft').textContent, /— Level\.sav/);
});

test('設定画面: 所持パルの CSV 保存と共有の削除は、ワールドの行の中で、そのワールドについて行う', async (t) => {
  const { body } = installDom(t);
  const calls = [];
  const owned = fakeOwned();
  owned.state.shared.worlds = [{ worldId: 'W', worldName: 'テスト', hostName: 'Alice', uploadedAt: '2026-10-06T00:00:00.000Z', palCount: 4 }];
  owned.state.auto.worlds.push({ id: 'X', dir: 'X', kind: 'host', name: '別', hostName: '', status: 'ok', role: '', playedAt: '', files: ['Level.sav'] });
  owned.ownedOf = async (worldId) => { calls.push(['csv', worldId]); return null; };
  owned.deleteShared = async (worldId) => { calls.push(['delete', worldId]); return true; };
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  const [shared, other] = card.element.querySelectorAll('.owned-world-details');
  const buttonsOf = (row) => row.querySelector('.owned-world-pals').querySelectorAll('button');
  // 共有したワールドは、CSV と共有の削除
  assert.deepEqual(buttonsOf(shared).map((node) => node.textContent), ['CSV で保存', '共有した所持パルを削除']);
  await buttonsOf(shared)[0].dispatch('click');
  buttonsOf(shared)[1].dispatch('click'); // 確認のダイアログが閉じるまで終わらないので待たない
  await tick();
  body.querySelector('dialog').querySelectorAll('button').find((node) => node.textContent === '削除').dispatch('click');
  await tick();
  await tick();
  assert.deepEqual(calls, [['csv', 'W'], ['delete', 'W']]);
  // 読み込んでも共有されてもいないワールドは、CSV を押せず、共有の削除もない
  assert.deepEqual(buttonsOf(other).map((node) => [node.textContent, node.disabled]), [['CSV で保存', true]]);
  card.destroy();
});

// ---------------------------------------------------------------------------
// stable-render: 行の使い回し・区切った描画・仮想の一覧・選択肢を作り直さない
// ---------------------------------------------------------------------------
const settle = () => new Promise((resolve) => setImmediate(resolve));
// パッシブの選択欄: 追加のボタンでポップオーバーを開き（開いていなければ）、候補を押す
const passiveAdd = (view) => view.element.querySelector('.passive-add');
async function pickPassive(view, id) {
  if (passiveAdd(view).getAttribute('aria-expanded') !== 'true') await passiveAdd(view).dispatch('click');
  const option = view.element.querySelector(`[data-value="${id}"]`);
  assert.ok(option, id);
  await option.dispatch('click');
}
const optionCount = (view, id) => view.element.querySelector(`[data-value="${id}"]`)?.querySelector('.passive-option-count')?.textContent ?? '';
const manyData = (count, extra = []) => ({
  version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', updatedAt: '2026-10-05T00:00:00.000Z' },
  snapshot: { ...snapshot, pals: [...extra, ...Array.from({ length: count }, (_, i) => ({ instanceId: `s${i}`, characterId: 'SheepBall', gender: i % 2 ? 'Male' : 'Female', level: 1 + (i % 50), passives: [], talent: { hp: i % 101 }, location: { kind: 'palbox', playerUid: P1 } }))] },
});

test('所持パル画面: 中身が同じセーブの読み直しでは行の要素も選択肢も同じまま。中身が変わった行だけ書き換え、キーワードで一致の理由も変わる', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned'));
  const rows = view.element.querySelectorAll('.owned-row');
  const holder = view.element.querySelectorAll('select')[0];
  const options = [...holder.children];
  const firstContent = rows[0].children[0];
  // 読み直した（新しいデータだが中身は同じ）
  owned.state.owned = normalizeOwned(snapshot, { pals, passives });
  owned.emit();
  assert.deepEqual(view.element.querySelectorAll('.owned-row'), rows);
  assert.equal(rows[0].children[0], firstContent);
  assert.deepEqual([...holder.children], options);
  // 1 体だけレベルが上がった: 行の要素は同じで、その行の中身だけ入れ直す
  const leveled = { ...snapshot, pals: snapshot.pals.map((pal) => (pal.instanceId === 'a' ? { ...pal, level: 13 } : pal)) };
  owned.state.owned = normalizeOwned(leveled, { pals, passives });
  owned.emit();
  const after = view.element.querySelectorAll('.owned-row');
  assert.deepEqual(after, rows);
  assert.match(after[0].textContent, /Lv 13/);
  assert.notEqual(after[0].children[0], firstContent);
  assert.equal(after[1].children[0], rows[1].children[0]);
  // キーワードを変えると、同じ行の一致の理由が変わる
  const query = view.element.querySelectorAll('input').find((node) => node.type === 'search');
  query.value = '作業速度';
  await query.dispatch('input');
  assert.equal(view.element.querySelectorAll('.owned-row')[0], rows[0]);
  assert.ok(rows[0].querySelectorAll('.owned-hit').length > 0);
  query.value = '';
  await query.dispatch('input');
  assert.equal(rows[0].querySelectorAll('.owned-hit').length, 0);
  view.destroy();
});

test('所持パル画面: 所持者の選択肢は、選んでいる途中に中身が変わっても作り直さず、離れてから作り直す', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned'));
  document.body.append(view.element);
  const holder = view.element.querySelectorAll('select')[0];
  const options = [...holder.children];
  holder.focus();
  const P2 = 'abcd1234-0000-0000-0000-000000000000';
  owned.state.owned = normalizeOwned({ ...snapshot, players: [...snapshot.players, { uid: P2, name: 'Bob', level: 3 }] }, { pals, passives });
  owned.emit();
  assert.deepEqual([...holder.children], options);
  document.activeElement = document.body;
  await holder.dispatch('blur');
  await settle();
  assert.deepEqual([...holder.children].map((node) => node.textContent), ['すべて', 'Alice', 'Bob']);
  view.destroy();
});

test('所持パル画面: 区切って行を足している途中で画面を閉じたら、それ以上足さない', (t) => {
  installDom(t);
  // 区切りは次の描画（requestAnimationFrame）でつなぐ。1 回ずつ進めるため、手で回す
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  t.after(() => { delete globalThis.requestAnimationFrame; });
  const view = ownedView(context(fakeOwned(manyData(1500))), parseHash('#/owned'));
  const list = view.element.querySelector('.owned-list');
  assert.equal(list.children.length, 200);
  // 1 回の区切りぶん進める
  frames.shift()();
  const partway = list.children.length;
  assert.ok(partway > 200 && partway < 1500, `途中の行 ${partway}`);
  view.destroy();
  while (frames.length) frames.shift()();
  assert.equal(list.children.length, 0);
});

test('所持パル画面: 区切って行を足すときも、残る既存の行は消さずに使い回し、まだ無い行だけを並び順に足す（1,500 行を絞って外す）', (t) => {
  installDom(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = ownedView(context(fakeOwned(manyData(1500))), parseHash('#/owned'));
  t.mock.timers.runAll();
  const list = view.element.querySelector('.owned-list');
  const hp = view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）');
  // HP 30 以上に絞る（行は減る。残る行は使い回す）
  hp.value = '30';
  hp.dispatch('input');
  t.mock.timers.runAll();
  const kept = new Set(list.querySelectorAll('.owned-row'));
  assert.ok(kept.size > 1000, `絞った後の行 ${kept.size}`);
  // 絞り込みを外す（まだ無い行が 200 を超える）。外した直後も、絞っていた間の行は 1 つも消さない（一覧が 200 行に縮まない）
  hp.value = '';
  hp.dispatch('input');
  const first = list.querySelectorAll('.owned-row');
  assert.ok(first.length >= kept.size && first.length <= kept.size + 200, `外した直後の行 ${first.length}`);
  assert.ok([...kept].every((row) => row.parentElement === list));
  t.mock.timers.runAll();
  const rows = list.querySelectorAll('.owned-row');
  assert.equal(rows.length, Number(view.element.querySelector('.result-note').textContent.replace(/ 体$/, '')));
  assert.equal(rows.filter((row) => kept.has(row)).length, kept.size);
  // 並びは、最初から全部描いたときと同じ
  const fresh = ownedView(context(fakeOwned(manyData(1500))), parseHash('#/owned'));
  t.mock.timers.runAll();
  assert.deepEqual(rows.map((row) => row.textContent), fresh.element.querySelectorAll('.owned-row').map((row) => row.textContent));
  fresh.destroy();
  view.destroy();
});

test('所持パル画面: 条件を変えたら、前の条件で区切って足していた仕事は捨てる', (t) => {
  installDom(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = ownedView(context(fakeOwned(manyData(1500))), parseHash('#/owned'));
  const hp = view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）');
  // HP 90 以上に絞る（行は減る）。前の仕事が後から行を足して戻さない
  hp.value = '90';
  hp.dispatch('input');
  const shown = view.element.querySelectorAll('.owned-row');
  assert.ok(shown.every((row) => /HP (9\d|100)/.test(row.textContent)));
  t.mock.timers.runAll();
  assert.equal(view.element.querySelectorAll('.owned-row').length, shown.length);
  assert.equal(view.element.querySelector('.result-note').textContent, `${shown.length} 体`);
  view.destroy();
});

test('所持パル画面: 2,000 行を超えたら見えている範囲だけを描き、2,000 行以下に戻ったら全部描く', (t) => {
  const { windowEvents } = installDom(t);
  windowEvents.innerHeight = 900;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const owned = fakeOwned(manyData(2001));
  const view = ownedView(context(owned), parseHash('#/owned'));
  const list = view.element.querySelector('.owned-list');
  assert.ok(list.className.includes('is-virtual'));
  const rows = list.querySelectorAll('.owned-row');
  assert.ok(rows.length > 0 && rows.length < 100, `描いた行 ${rows.length}`);
  assert.equal(view.element.querySelector('.result-note').textContent, '2001 体');
  // 並べ替えても仮想のまま（動きは付けない）
  const sort = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'level'));
  sort.value = 'level';
  sort.dispatch('change');
  assert.ok(list.className.includes('is-virtual'));
  // 個体値で 2,000 行以下に絞ると、仮想をやめて全部描く（先頭の 200 行の後は区切って足す）
  const hp = view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）');
  hp.value = '50';
  hp.dispatch('input');
  t.mock.timers.runAll();
  assert.ok(!list.className.includes('is-virtual'));
  const count = Number(view.element.querySelector('.result-note').textContent.replace(/ 体$/, ''));
  assert.equal(list.querySelectorAll('.owned-row').length, count);
  view.destroy();
});

test('設定画面: 読み込み中（busy）になっても登録したワールドの行と「使うワールド」の選択肢を作り直さず、ボタンの押せる・押せないだけを変える', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  const item = card.element.querySelector('.owned-registered-item');
  const select = card.element.querySelector('.owned-world-row').querySelector('select');
  const options = [...select.children];
  const buttons = () => item.querySelectorAll('button').filter((node) => ['編集', '削除', 'CSV で保存'].includes(node.textContent));
  assert.ok(buttons().every((node) => !node.disabled));
  owned.state.busy = true;
  owned.emit();
  assert.equal(card.element.querySelector('.owned-registered-item'), item);
  assert.deepEqual([...select.children], options);
  assert.ok(buttons().every((node) => node.disabled));
  assert.equal(select.disabled, true);
  owned.state.busy = false;
  owned.emit();
  assert.equal(card.element.querySelector('.owned-registered-item'), item);
  assert.ok(buttons().every((node) => !node.disabled));
  assert.equal(select.disabled, false);
  card.destroy();
});

test('継承ルート: 所持パルの読み直しでパッシブの選択欄を作り直さず、候補を開いている間に所持数が変わっても閉じずに数だけ描き直す', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = inheritanceView(context(owned), parseHash('#/route?to=SheepBall&p=Rare'));
  document.body.append(view.element);
  const add = passiveAdd(view);
  owned.state.data = { ...owned.state.data };
  owned.state.owned = normalizeOwned(snapshot, { pals, passives });
  owned.emit();
  assert.equal(passiveAdd(view), add);
  await add.dispatch('click');
  const search = view.element.querySelector('.picker-search');
  search.value = '職人';
  await search.dispatch('input');
  // タマゴも含めて数える（a と、タマゴの c）
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '2 体');
  const more = { ...snapshot, pals: [...snapshot.pals, { instanceId: 'z', characterId: 'PinkCat', gender: 'Male', passives: ['CraftSpeed_up2'], talent: {}, location: { kind: 'palbox', playerUid: P1 } }] };
  owned.state.data = { ...owned.state.data };
  owned.state.owned = normalizeOwned(more, { pals, passives });
  owned.emit();
  assert.equal(passiveAdd(view), add);
  assert.equal(view.element.querySelector('.picker-search'), search);
  assert.equal(document.activeElement, search);
  assert.equal(search.value, '職人');
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '3 体');
  // 見出しは継承ルートの数え方
  assert.match(view.element.querySelector('.passive-options').textContent, /^所持パルが持っているもの（タマゴを含む）/);
  view.destroy();
});

test('所持パル画面: キーワードで多くの行の一致の理由が変わるときは、先頭の 200 行をすぐ書き換え、残りは区切って書き換える（行の要素は同じ）', (t) => {
  installDom(t);
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => frames.push(fn);
  t.after(() => { delete globalThis.requestAnimationFrame; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const data = manyData(0, Array.from({ length: 300 }, (_, i) => ({ instanceId: `k${i}`, characterId: 'SheepBall', gender: 'Female', level: 10,
    passives: ['CraftSpeed_up2'], talent: {}, location: { kind: 'palbox', playerUid: P1 } })));
  const view = ownedView(context(fakeOwned(data)), parseHash('#/owned'));
  while (frames.length) frames.shift()();
  const rows = view.element.querySelectorAll('.owned-row');
  assert.equal(rows.length, 300);
  const query = view.element.querySelectorAll('input').find((node) => node.type === 'search');
  query.value = '作業速度';
  query.dispatch('input');
  const hits = () => view.element.querySelectorAll('.owned-row').map((row) => row.querySelectorAll('.owned-hit').length);
  assert.deepEqual(view.element.querySelectorAll('.owned-row'), rows);
  assert.equal(hits().filter(Boolean).length, 200);
  assert.ok(hits().slice(0, 200).every(Boolean));
  while (frames.length) frames.shift()();
  assert.ok(hits().every(Boolean));
  // 理由だけが変わった行は、行の中の理由の行だけを入れ直す（パル・レベルの欄は同じ要素）
  const cell = rows[0].children[0];
  query.value = '';
  query.dispatch('input');
  while (frames.length) frames.shift()();
  assert.ok(hits().every((count) => count === 0));
  assert.equal(rows[0].children[0], cell);
  view.destroy();
});

test('所持パル画面: パッシブは候補を開いたまま続けて選べ、4 個目で押せなくなったら残ったチップの最後の × へ、× で外すと追加欄へフォーカスを移す', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  document.body.append(view.element);
  const add = passiveAdd(view);
  await pickPassive(view, 'Rare');
  assert.equal(passiveAdd(view), add);
  assert.equal(document.activeElement, view.element.querySelector('.picker-search'));
  for (const id of ['CraftSpeed_up2', 'Legend']) await pickPassive(view, id);
  await pickPassive(view, 'WorldTree_ATK');
  assert.equal(add.disabled, true);
  assert.equal(view.element.querySelector('.picker-search'), null);
  assert.equal(document.activeElement.getAttribute('data-focus-key'), 'passive-chip:パッシブ（すべて持つ個体）:WorldTree_ATK');
  // × で外すと、押せるようになった追加欄へ
  await document.activeElement.dispatch('click');
  assert.equal(document.activeElement, add);
  assert.equal(add.disabled, false);
  view.destroy();
});

test('所持パル画面: パッシブの所持数は、選んでいるパッシブも含めた今の絞り込みの結果の中で数え、絞り込みを変えると数え直す', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  document.body.append(view.element);
  await passiveAdd(view).dispatch('click');
  assert.match(view.element.querySelector('.passive-options').textContent, /^いまの絞り込みの中で持っているもの/);
  // 既定ではグローバルボックスを出さず、タマゴは出す（a と、タマゴの c）
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '2 体');
  assert.equal(optionCount(view, 'Rare'), '1 体');
  await pickPassive(view, 'Rare');
  // 希少を持つのは a だけなので、その中で職人気質を持つのは 1 体
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '1 体');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 1);
  // × を押しても候補は開いたまま
  await view.element.querySelector('.passive-remove').dispatch('click');
  assert.equal(passiveAdd(view).getAttribute('aria-expanded'), 'true');
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '2 体');
  // タマゴを隠すと、タマゴの c を数えない（候補を開いたまま）
  const eggs = view.element.querySelectorAll('.owned-toggle')[0].children[0];
  eggs.checked = false;
  await eggs.dispatch('change');
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '1 体');
  assert.ok(view.element.querySelector('.picker-search'));
  // キーワードで絞っても数え直す
  const query = view.element.querySelectorAll('input').find((node) => node.type === 'search' && node.className !== 'picker-search');
  query.value = 'ツッパニャン';
  await query.dispatch('input');
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '');
  view.destroy();
});

test('所持パル画面: 戻る・進むで条件を入れ直したとき（restored）は、キーワード・個体値・チェック・並べ替えの入力欄も合わせる', (t) => {
  installDom(t);
  const states = new Map();
  const app = Object.assign(context(fakeOwned()), {
    viewState(view) { if (!states.has(view)) states.set(view, {}); return states.get(view); },
    replace() {},
  });
  const view = ownedView(app, parseHash('#/owned'));
  const inputs = () => view.element.querySelectorAll('input');
  const keyword = inputs().find((node) => node.type === 'search');
  const hp = inputs().find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）');
  const checks = () => inputs().filter((node) => node.type === 'checkbox').map((node) => node.checked);
  assert.equal(view.element.querySelectorAll('.owned-row').length, 3);
  // app.js が履歴のエントリの条件を filter に入れ直す
  Object.assign(states.get('owned').filter, { query: 'もこ', talent: { hp: 5, shot: 0, defense: 0 }, eggs: false, sort: 'level' });
  view.applyRoute(parseHash('#/owned'), { reason: 'history' });
  assert.equal(keyword.value, '');
  view.applyRoute(parseHash('#/owned'), { reason: 'history', restored: true });
  assert.equal(keyword.value, 'もこ');
  assert.equal(hp.value, '5');
  assert.deepEqual(checks(), [false, false]);
  assert.equal(view.element.querySelectorAll('select').find((node) => node.children.some((option) => option.value === 'passives')).value, 'level');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 1);
  view.destroy();
});

test('所持パル・継承ルート: パル選択は所持している種族を先に「♂a ♀b」つきで出し（タマゴは数えない）、開いたまま読み直すと数だけ変わる', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned'));
  document.body.append(view.element);
  const picker = view.element.querySelector('.picker');
  await picker.querySelector('.picker-trigger').dispatch('click');
  const rows = () => picker.querySelectorAll('[role="option"]').map((node) => [node.querySelector('strong')?.textContent ?? node.textContent, node.querySelector('.picker-badge')?.textContent ?? '']);
  assert.equal(picker.querySelector('.picker-status').textContent, '所持している種族を先に表示');
  // モコロン ♀ の a、ツッパニャン ♂ の b とグローバルの g（性別なし）。タマゴのフラリーナ c は数えない
  assert.deepEqual(rows().slice(0, 3), [['パルを選択', ''], ['モコロン', '♂0 ♀1'], ['ツッパニャン', '♂1 ♀0']]);
  assert.equal(rows().find(([name]) => name === 'フラリーナ')[1], '');
  const search = picker.querySelector('input');
  const more = { ...snapshot, pals: [...snapshot.pals, { instanceId: 'm', characterId: 'SheepBall', gender: 'Male', passives: [], talent: {}, location: { kind: 'palbox', playerUid: P1 } }] };
  owned.state.owned = normalizeOwned(more, { pals, passives });
  owned.emit();
  assert.equal(picker.querySelector('input'), search);
  assert.deepEqual(rows()[1], ['モコロン', '♂1 ♀1']);
  view.destroy();

  const route = inheritanceView(context(fakeOwned()), parseHash('#/route?to=CuteFox'));
  const target = route.element.querySelector('.picker');
  await target.querySelector('.picker-trigger').dispatch('click');
  assert.deepEqual(target.querySelectorAll('[role="option"]').slice(1, 3).map((node) => node.querySelector('.picker-badge').textContent), ['♂0 ♀1', '♂1 ♀0']);
  route.destroy();
});

// ---- フェーズ 1a のレビューで直したもの ----
test('所持パル画面: キーワード・個体値の入力の間引きの途中で画面を閉じたら、閉じた後に一覧を描かない。flushInputs は待っている入力をすぐ当てる', async (t) => {
  installDom(t);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rows = (view) => view.element.querySelectorAll('.owned-row').length;
  for (const pick of [(view) => view.element.querySelectorAll('input').find((node) => node.type === 'search'),
    (view) => view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）')]) {
    const view = ownedView({ ...context(fakeOwned()), inputDelay: 20 }, parseHash('#/owned'));
    const field = pick(view);
    field.value = field.type === 'search' ? 'もこ' : '5';
    await field.dispatch('input');
    view.destroy();
    assert.equal(rows(view), 0);
    await wait(40);
    assert.equal(rows(view), 0);
  }
  const view = ownedView({ ...context(fakeOwned()), inputDelay: 1000 }, parseHash('#/owned'));
  const keyword = view.element.querySelectorAll('input').find((node) => node.type === 'search');
  keyword.value = 'もこ';
  await keyword.dispatch('input');
  assert.equal(rows(view), 3);
  view.flushInputs();
  assert.equal(rows(view), 1);
  view.destroy();
});

test('所持パル画面: 選んでいる所持者が、フォーカス中の更新で選択肢から消えたら、離れた後に「すべて」に戻して一覧とパッシブの数を数え直す', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned'));
  document.body.append(view.element);
  const holder = view.element.querySelectorAll('select')[0];
  holder.value = `player:${P1}`;
  await holder.dispatch('change');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 3);
  holder.focus();
  // 同じワールドの更新で Alice がいなくなり、Bob の個体だけになった
  const P2 = 'abcd1234-0000-0000-0000-000000000000';
  const bob = { ...snapshot, players: [{ uid: P2, name: 'Bob', level: 3 }],
    pals: [{ instanceId: 'x', characterId: 'PinkCat', gender: 'Male', level: 4, passives: ['Rare'], talent: {}, location: { kind: 'palbox', playerUid: P2 } }] };
  owned.state.owned = normalizeOwned(bob, { pals, passives });
  owned.emit();
  assert.equal(view.element.querySelectorAll('.owned-row').length, 0);
  document.activeElement = document.body;
  await holder.dispatch('blur');
  await settle();
  assert.equal(holder.value, '');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 1);
  assert.equal(view.element.querySelector('.result-note').textContent, '1 体');
  await passiveAdd(view).dispatch('click');
  assert.equal(optionCount(view, 'Rare'), '1 体');
  view.destroy();
});

test('所持パル画面: 所持パルのデータが無いまま開いて読み込みが終わったら、「読み込み中…」から案内に描き直す', (t) => {
  installDom(t);
  const owned = fakeOwned(null, { ready: false });
  const view = ownedView(context(owned), parseHash('#/owned'));
  assert.match(view.element.querySelector('.owned-list').textContent, /読み込み中…/);
  owned.state.ready = true;
  owned.emit();
  assert.match(view.element.querySelector('.owned-list').textContent, /表示できる所持パルがありません/);
  view.destroy();
});

test('所持パル画面: URL のパッシブと保存した条件のパッシブは、重複と内部名の形でない値を除き、マスターにまだ無い内部名は残す', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned?p=Rare,Rare,知らないパッシブ'));
  assert.equal(view.element.querySelectorAll('.passive-remove').length, 1);
  await passiveAdd(view).dispatch('click');
  assert.match(view.element.querySelector('.picker-status').textContent, /あと 3 個まで選べます/);
  view.destroy();
  assert.deepEqual(cleanSaved({ passives: ['Rare', '知らないパッシブ', 'Rare', 'Unknown_Passive_X', 7, 'Legend'] }, OWNED_MEMORY).passives, ['Rare', 'Unknown_Passive_X', 'Legend']);
});

test('継承ルート: URL のパッシブは重複と内部名の形でない値を除き、マスターにまだ無い内部名は残す', (t) => {
  installDom(t);
  const view = inheritanceView(context(fakeOwned()), parseHash('#/route?to=CuteFox&p=Rare,Rare,知らないパッシブ,Unknown_Passive_X'));
  assert.deepEqual(view.element.querySelectorAll('.passive-remove').map((node) => node.getAttribute('aria-label')), ['希少 を外す', 'Unknown_Passive_X を外す']);
  view.destroy();
});
