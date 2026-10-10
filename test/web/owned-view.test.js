import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { normalizeOwned } from '../../web/js/core/owned.js';
import { parseHash } from '../../web/js/router.js';
import { ownedView } from '../../web/js/views/owned.js';
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
  return { store: { state, subscribe: () => () => {} }, owned, navigations, navigate: (hash) => navigations.push(hash) };
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
  const many = Array.from({ length: 250 }, (_, i) => ({ instanceId: `s${i}`, characterId: 'SheepBall', passives: [], talent: {}, location: { kind: 'palbox', playerUid: P1 } }));
  const humans = [{ instanceId: 'h', characterId: 'BOSS_Believer_CrossBow', gender: 'Male', passives: [], talent: {}, location: { kind: 'palbox', playerUid: P1 } }];
  const data = { version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', updatedAt: '2026-10-05T00:00:00.000Z' }, snapshot: { ...snapshot, pals: [...humans, ...many] } };
  const view = ownedView(context(fakeOwned(data)), parseHash('#/owned'));
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

test('継承ルート: 所持パルのデータがないときは、開始と目標を並べて選ぶ', (t) => {
  installDom(t);
  const view = inheritanceView(context(fakeOwned(null)), parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.ok(view.element.querySelector('.pair-selection'));
  assert.ok(view.element.querySelector('.swap-button'));
  assert.equal(view.element.querySelector('.start-filter'), null);
  assert.match(view.element.querySelector('.route-owned').textContent, /設定タブの「セーブ連携」でワールドを登録/);
  view.destroy();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const DROP_WIN = { DataTransferItem: { prototype: { getAsFileSystemHandle() {} } } };
const WORLD_PATH = 'C:\\Users\\a\\AppData\\Local\\Pal\\Saved\\SaveGames\\7656\\4A431AC14B58A7E31A76B2A991F79FE8';
const dropped = (...names) => ({ items: names.map((name) => ({ kind: 'file', getAsFileSystemHandle: () => Promise.resolve(fakeHandle(name)) })) });

test('設定画面: 「＋ ワールドを登録」のモーダルで、パスを貼ってファイルをドロップすると確かめ、保存で登録する', async (t) => {
  const { body } = installDom(t);
  const calls = [];
  const owned = fakeOwned(null);
  owned.previewRegistration = async (input) => {
    calls.push(['preview', input.worldId, input.steamId, input.files.map((file) => file.path)]);
    return { ...input, kind: 'host', role: 'host', name: 'LC9', hostName: 'Etona', palCount: 12, replaced: [] };
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
  assert.deepEqual(calls.at(-1), ['preview', '4A431AC14B58A7E31A76B2A991F79FE8', '7656', ['Level.sav', 'LevelMeta.sav', 'LocalData.sav', 'Players/00000000000000000000000000000001.sav']]);
  assert.match(dialog.querySelector('.owned-dialog-result').textContent, /「LC9」（ホスト Etona） · 12 体/);
  assert.equal(save.disabled, false);
  await save.dispatch('click');
  assert.deepEqual(calls.at(-1), ['commit', '4A431AC14B58A7E31A76B2A991F79FE8']);
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
const OTHER_PATH = WORLD_PATH.replace('4A431AC14B58A7E31A76B2A991F79FE8', '88DC480846CA4D73A670DA90D96950DC');

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
  assert.deepEqual(commits, ['4A431AC14B58A7E31A76B2A991F79FE8']);
});

test('ワールドの登録: 編集でパスの Steam ID だけ直しても、確かめ直して新しい Steam ID で保存する', async (t) => {
  const { body } = installDom(t);
  const owned = fakeOwned();
  owned.state.auto.worlds[0].steamId = '7656';
  owned.state.auto.worlds[0].id = '4A431AC14B58A7E31A76B2A991F79FE8';
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
