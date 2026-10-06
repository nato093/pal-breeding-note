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
      talent: { hp: 10, shot: 20, defense: 30 }, isRare: true, location: { kind: 'palbox', playerUid: P1 } },
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
  assert.match(first.textContent, /Alice.*パルボックス/);
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

test('設定画面: 所持パルのセーブ連携の設定と状態を出す', async (t) => {
  installDom(t);
  const { settingsView } = await import('../../web/js/views/settings.js');
  const owned = fakeOwned();
  const app = context(owned);
  app.store.state.records = [];
  const view = settingsView(app);
  const card = view.element.querySelector('.owned-settings');
  assert.ok(card);
  // テスト用 DOM はドロップからハンドルを取り出せないため、ブラウザの案内だけを出す
  assert.match(card.textContent, /ファイルの登録は Chrome・Edge で使えます/);
  assert.match(card.textContent, /フォルダを選んで読み込む/);
  assert.match(card.querySelector('.owned-settings-status').textContent, /連携登録したセーブのファイル（自動で読み込み）.*この PCホスト/);
  assert.ok(card.querySelectorAll('button').some((node) => node.textContent === '連携の設定を解除'));
  assert.ok(card.querySelectorAll('button').some((node) => node.textContent === '共有した所持パルを削除' && !node.hidden));
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
  assert.match(starts[0].textContent, /モコロン.*最短 1 回の配合.*1 体 · Alice・パルボックス/);
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const DROP_WIN = { DataTransferItem: { prototype: { getAsFileSystemHandle() {} } } };
const WORLD_PATH = 'C:\\Users\\a\\AppData\\Local\\Pal\\Saved\\SaveGames\\7656\\4A431AC14B58A7E31A76B2A991F79FE8';
const dropped = (...names) => ({ items: names.map((name) => ({ kind: 'file', getAsFileSystemHandle: () => Promise.resolve(fakeHandle(name)) })) });

test('設定画面: パスを貼ると登録するファイルの場所を出し、ドロップしたファイルを確かめてから登録する', async (t) => {
  installDom(t);
  const calls = [];
  const owned = fakeOwned(null);
  owned.previewRegistration = async (input) => {
    calls.push(['preview', input.worldId, input.steamId, input.files.map((file) => file.path)]);
    return { ...input, kind: 'host', role: 'host', name: 'LC9', hostName: 'Etona', palCount: 12, replaced: [] };
  };
  owned.commitRegistration = async (preview) => { calls.push(['commit', preview.worldId]); return { persisted: true, result: 'imported' }; };
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  const path = card.element.querySelector('.owned-path');
  path.value = WORLD_PATH;
  await path.dispatch('input');
  const guide = card.element.querySelector('.owned-file-guide').textContent;
  assert.match(guide, /ワールドのフォルダ: C:\\Users\\a\\AppData\\Local\\Pal\\Saved\\SaveGames\\7656\\4A431AC14B58A7E31A76B2A991F79FE8/);
  // ファイルの場所は、ワールドのフォルダからの相対パスで出す
  assert.match(guide, /自分がホストのワールドLevel\.sav必須.*LevelMeta\.sav必須.*LocalData\.sav必須.*Players\\ の中のファイル全部.*\.\.\\GlobalPalStorage\.sav任意/);
  assert.match(guide, /参加しただけのワールドLocalData\.sav必須/);
  await card.element.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('Level.sav', 'LevelMeta.sav') });
  await tick();
  await card.element.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('LocalData.sav', '00000000000000000000000000000001.sav') });
  await tick();
  assert.match(card.element.querySelector('.owned-draft').textContent, /Level\.sav ✓ ドロップ済み.*LocalData\.sav ✓ ドロップ済み.*Players のファイル 1 件/);
  await card.element.querySelectorAll('button').find((node) => node.textContent === '確認する').dispatch('click');
  assert.deepEqual(calls[0], ['preview', '4A431AC14B58A7E31A76B2A991F79FE8', '7656', ['Level.sav', 'LevelMeta.sav', 'LocalData.sav', 'Players/00000000000000000000000000000001.sav']]);
  assert.match(card.element.querySelector('.owned-preview').textContent, /「LC9」（ホスト Etona） · 12 体/);
  await card.element.querySelectorAll('button').find((node) => node.textContent === 'このワールドで登録').dispatch('click');
  assert.deepEqual(calls[1], ['commit', '4A431AC14B58A7E31A76B2A991F79FE8']);
  assert.equal(path.value, '');
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
