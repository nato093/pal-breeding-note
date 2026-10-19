import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, installResizeObserver, descendants, FakeElement } from '../helpers/dom.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { buildIndex } from '../../web/js/core/index.js';
import { buildCarrierGraph } from '../../web/js/core/route.js';
import { normalizeOwned } from '../../web/js/core/owned.js';
import { parseHash } from '../../web/js/router.js';
import { ownedView, ownedRowItem, OWNED_MEMORY, migrateFilter, DEFAULT_PLACES, filterFromParams } from '../../web/js/views/owned.js';
import { cleanSaved } from '../../web/js/core/boundary.js';
import { ownedSettingsCard } from '../../web/js/views/owned-settings.js';
import { fakeHandle } from '../helpers/file-handles.js';
import { inheritanceView } from '../../web/js/views/route.js';
import { palsOfPlayers } from '../../web/js/core/ideal-goals.js';
import { createSelfStore } from '../../web/js/self-player.js';
import { createIdealStore } from '../../web/js/ideals.js';

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

// 場所のチップ（件数 0 で隠したものは除く）: [グループ, aria-pressed, 見えている文字]
const placeChips = (view) => view.element.querySelectorAll('.place-chip').filter((node) => !node.hidden)
  .map((node) => [node.getAttribute('data-value'), node.getAttribute('aria-pressed'), node.textContent]);
const placeChip = (view, group) => view.element.querySelectorAll('.place-chip').find((node) => node.getAttribute('data-value') === group);
// 所持者の選択（12 件以下は select）
const holderSelect = (view) => view.element.querySelector('[aria-label="所持者"]');
// 件数の行の先頭の数（「N / M 体 · …」の N）
const shownCount = (view) => Number(view.element.querySelector('.result-note').textContent.split(' / ')[0]);
// 効いている条件のチップの文
// （状態の行の中だけ。「+n」の板のチップは数えない）
const filterChips = (view) => view.element.querySelector('.filter-chips').querySelectorAll('.filter-chip').map((node) => node.querySelector('.filter-chip-text').textContent);

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
  // パッシブは行の中だけランクの高い順（保存の順は 職人気質 3・希少 4。O-25）
  assert.deepEqual(first.querySelectorAll('.passive-chip').map((node) => node.textContent), ['希少', '職人気質']);
  assert.deepEqual(first.querySelectorAll('.passive-chip').map((node) => node.className), ['passive-chip passive-rank-4', 'passive-chip passive-rank-3']);
  // パルボックスは所持者と「P ページ · 行-列」＋ 6×5 の小さな図（場所の全文は title。前は「パルボックス 2 ページ・1 行 2 列」の文字）
  const where = first.querySelector('.owned-where');
  assert.equal(where.querySelector('strong').textContent, 'Alice');
  assert.equal(where.querySelector('.owned-box').textContent, 'P2 · 1-2');
  assert.equal(where.title, 'パルボックス 2 ページ・1 行 2 列');
  const map = where.querySelector('.box-map');
  assert.deepEqual([map.style.getPropertyValue('--r'), map.style.getPropertyValue('--c')], ['1', '2']);
  // 読み上げは「Alice パルボックス 2 ページ・1 行 2 列」（短い表記と図は aria-hidden、全文は見た目を隠した文。B11: 短い表記だけが読まれていた）
  assert.equal(where.querySelector('.owned-box').getAttribute('aria-hidden'), 'true');
  assert.equal(where.querySelector('.visually-hidden').textContent, 'パルボックス 2 ページ・1 行 2 列');
  assert.match(first.textContent, /Alice.*パルボックス 2 ページ・1 行 2 列/);
  // ★は 4 枠（塗りの ★ は文字、輪郭の ☆ は CSS が data-off から出す）で、読み上げは aria-label（前は「★★」の文字だけ・★ がなければ「☆なし」）
  const stars = first.querySelector('.owned-stars');
  assert.deepEqual([stars.getAttribute('role'), stars.getAttribute('aria-label'), stars.textContent, stars.getAttribute('data-off')], ['img', 'パル濃縮 ★2', '★★', '☆☆']);
  assert.equal(rows[1].querySelector('.owned-stars').getAttribute('aria-label'), 'パル濃縮なし');
  // タマゴの Lv は「—」（前は「孵化前」）。タマゴのバッジは残る
  const egg = rows.find((row) => row.querySelector('.badge-egg'));
  assert.equal(egg.querySelector('.owned-level').textContent, '—');
  // 個体値は HP・攻・防・計の 4 セル（数字だけ。ラベルは列見出し）と、読み上げの aria-label
  assert.deepEqual(first.querySelectorAll('.talent-cell').map((cell) => [cell.getAttribute('data-key'), cell.textContent, cell.style.getPropertyValue('--v')]),
    [['hp', '10', '10'], ['shot', '20', '20'], ['defense', '30', '30'], ['total', '60', '20']]);
  assert.equal(first.querySelector('.owned-talent').getAttribute('aria-label'), '個体値 HP 10・攻撃 20・防御 30・合計 60');
  // どのワールドの・いつのデータかは上のバーのセーブ連携の表示に任せ、画面にはデータ元の 1 行を出さない（D29。前は「「テスト」（ホスト Alice） ·
  // この PC · 4 体 · セーブ …」と最終確認の時刻・「設定 →」の 1 行）
  assert.equal(view.element.querySelector('.owned-source'), null);
  assert.equal(view.element.querySelector('.owned-world'), null);
  // 件数の行は「絞り込んだ数 / 全体の数」と ♂♀・タマゴの内訳（グローバルパルボックスは既定で出さない）
  assert.equal(view.element.querySelector('.result-note').textContent, '3 / 4 体 · ♂1 ♀1 タマゴ 1');
  assert.equal(view.element.querySelector('.result-note').title, 'グローバル 1 体は非表示');
  assert.doesNotMatch(view.element.textContent, /セーブのファイルを登録|フォルダを選んで読み込む|データを消す/);
  // 場所はチップ（件数 0 の場所は出さない）。既定はグローバルパルボックスだけを外す。チップに件数は出さない（D29。前は「パルボックス 1」）
  assert.deepEqual(placeChips(view), [['party', 'true', '手持ち'], ['palbox', 'true', 'パルボックス'], ['global', 'false', 'グローバルパルボックス'], ['egg', 'true', 'タマゴ']]);
  assert.equal(view.element.querySelector('.place-chip-count'), null);
  assert.equal(view.element.querySelectorAll('.owned-toggle').length, 0);
  view.destroy();
});

test('所持パル画面: パル次元ストレージの行も「次元 P ページ · 行-列」と 6×5 の図で位置を出し（全文は title と隠した文）、位置のない古い共有は場所の文字だけ', (t) => {
  installDom(t);
  const list = normalizeOwned({ ...snapshot, pals: [
    { instanceId: 'd', characterId: 'SheepBall', gender: 'Female', level: 5, rank: 1, passives: [], talent: {}, location: { kind: 'dps', playerUid: P1, slotIndex: 7820 } },
    { instanceId: 'p', characterId: 'SheepBall', gender: 'Female', level: 5, rank: 1, passives: [], talent: {}, location: { kind: 'palbox', playerUid: P1, slotIndex: 7820 } },
  ] }, { pals, passives }).pals;
  const row = ownedRowItem(list[0]);
  const where = row.element.querySelector('.owned-where');
  assert.equal(where.querySelector('strong').textContent, 'Alice');
  assert.equal(where.querySelector('.owned-box').textContent, '次元 P261 · 4-3');
  assert.equal(where.querySelector('.owned-box').getAttribute('aria-hidden'), 'true');
  const map = where.querySelector('.box-map');
  assert.deepEqual([map.style.getPropertyValue('--r'), map.style.getPropertyValue('--c')], ['4', '3']);
  assert.equal(where.title, 'パル次元ストレージ 261 ページ・4 行 3 列');
  assert.equal(where.querySelector('.visually-hidden').textContent, 'パル次元ストレージ 261 ページ・4 行 3 列');
  // 同じ位置のパルボックスの個体に変われば、短い表記も全文も書き換える（頭の「次元 」が残らない）
  assert.equal(row.update(list[1]), true);
  assert.equal(where.querySelector('.owned-box').textContent, 'P261 · 4-3');
  assert.equal(where.title, 'パルボックス 261 ページ・4 行 3 列');
  // 位置の分からない次元ストレージ（古い共有の「パル次元ストレージ」だけ）は、所持者と場所の文字（図も title もない）
  assert.equal(row.update({ ...list[0], placeLabel: 'パル次元ストレージ', box: null }), true);
  assert.equal(where.querySelector('.owned-box'), null);
  assert.equal(where.querySelector('.box-map'), null);
  assert.deepEqual(where.children.map((node) => node.textContent), ['Alice', 'パル次元ストレージ']);
  assert.equal(where.title, '');
  row.destroy();
});

test('所持パル画面: 場所のチップでタマゴを外し・グローバルパルボックスを足し、パッシブで絞り込む（所持者の選択肢はプレイヤーだけ）', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned?p=CraftSpeed_up2'));
  assert.equal(view.element.querySelectorAll('.owned-row').length, 2);
  await placeChip(view, 'egg').dispatch('click');
  assert.equal(placeChip(view, 'egg').getAttribute('aria-pressed'), 'false');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 1);
  view.destroy();
  const all = ownedView(context(fakeOwned()), parseHash('#/owned'));
  await placeChip(all, 'global').dispatch('click');
  assert.equal(placeChip(all, 'global').getAttribute('aria-pressed'), 'true');
  assert.equal(all.element.querySelectorAll('.owned-row').length, 4);
  // 拠点・グローバルパルボックスは所持者の選択肢に出さない（場所のチップで選ぶ）
  assert.deepEqual(holderSelect(all).children.map((node) => node.textContent), ['すべて', 'Alice']);
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
  // 「採掘3」が Lv3 以上の意味だと title に例を書く（フェーズ 4 の終わりのレビュー）
  assert.match(query.title, /「採掘3」は採掘 Lv3 以上の種族/);
  query.value = 'もこ';
  await query.dispatch('input');
  await placeChip(first, 'egg').dispatch('click');
  const hp = first.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）');
  hp.value = '5';
  await hp.dispatch('input');
  assert.equal(rows(first), 1);
  first.destroy();
  const again = ownedView(memoryContext(), parseHash('#/owned'));
  assert.equal(rows(again), 1);
  assert.equal(keyword(again).value, 'もこ');
  assert.equal(placeChip(again, 'egg').getAttribute('aria-pressed'), 'false');
  assert.equal(again.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === 'HPの個体値（以上）').value, '5');
  assert.deepEqual(replaced, []);
  again.destroy();
  // URL で絞り込みを指定して開いたら、その指定で絞り込み（URL にない条件は既定に戻す。前はキーワードなどを残した）、URL からは外す
  const linked = ownedView(memoryContext(), parseHash('#/owned?p=Rare'));
  assert.deepEqual(states.get('owned').filter.passives, ['Rare']);
  assert.deepEqual(replaced, ['#/owned']);
  assert.equal(rows(linked), 1);
  assert.equal(keyword(linked).value, '');
  assert.equal(placeChip(linked, 'egg').getAttribute('aria-pressed'), 'true');
  linked.destroy();
  // 作り直していない新しい入れ物（ページの読み込み直し）では既定に戻る
  states.clear();
  const fresh = ownedView(memoryContext(), parseHash('#/owned'));
  assert.equal(rows(fresh), 3);
  assert.equal(keyword(fresh).value, '');
  fresh.destroy();
});

test('所持パル画面: 同じ画面のまま絞り込みつきの URL が来ると（applyRoute）、作り直さずに絞り込みと入力欄を URL に合わせ（URL にない条件は既定。前は打ちかけのキーワードを残した）、URL から外す', (t) => {
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
  // URL が条件のすべてを決める（打ちかけのキーワードも URL の q〔ここでは無し〕に合わせる）
  assert.equal(keyword.value, '');
  // 絞り込みのない URL では何も変えない
  view.applyRoute(parseHash('#/owned'), { reason: 'history' });
  assert.equal(view.element.querySelectorAll('.owned-row').length, 1);
  assert.deepEqual(replaced, ['#/owned']);
  view.destroy();
});

test('所持パル画面: キーワードはスキルや属性でも探せ、一致した行の下の段に、語ごとにどの項目の何に一致したかを必ず出す（D29。前は一覧に出していないスキル・説明だけ）', async (t) => {
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
  // スキルで一致したら、行の下の段に「項目：名前」
  assert.deepEqual(await search('えあー'), [['アクティブスキル：エアーキャノン']]);
  assert.deepEqual(await search('猫の手'), [['パートナースキル：猫の手も借りたい']]);
  // 説明文で一致したときは、名前の後ろに説明を添える。同じ項目（パッシブ）はまとめて 1 つに（全文は段の title）
  await search('空気の塊 作業速度');
  const [row] = view.element.querySelectorAll('.owned-row');
  assert.deepEqual(row.querySelectorAll('.owned-hit').map((node) => node.textContent), [
    'アクティブスキル：エアーキャノン（高速で飛ぶ空気の塊を発射する。）',
    'パッシブ：職人気質（作業速度 +50%）・希少（攻撃 +15% 防御 +15% 作業速度 +20%）',
  ]);
  assert.equal(row.querySelector('.owned-hits').title, [
    'アクティブスキル：エアーキャノン（高速で飛ぶ空気の塊を発射する。）', 'パッシブ：職人気質（作業速度 +50%）', 'パッシブ：希少（攻撃 +15% 防御 +15% 作業速度 +20%）',
  ].join('\n'));
  // 名前・属性・ラッキー・所持者など、一覧に出している項目で一致したときも出す（何に一致したか分かるように）
  assert.deepEqual(await search('無 ラッキー'), [['属性：無', '特徴：ラッキー']]);
  assert.deepEqual(await search('モコロン'), [['パル名：モコロン', 'アクティブスキル：コロコロモコロン（モコロンの専用スキル。コロコロと転がりながら、敵を追いかける。攻撃後は目が回って動けなくなってしまう。）']]);
  assert.deepEqual(await search('alice'), [['所持者：Alice'], ['所持者：Alice'], ['所持者：Alice']]);
  assert.deepEqual(await search(''), [[], [], []]);
  view.destroy();
});

test('所持パル画面: キーワードに一致した理由は、項目（見出し）ごとに 4 つまで出し、残りは「ほか N 件」（全文は title）', (t) => {
  installDom(t);
  const pal = normalizeOwned(snapshot, { pals, passives }).pals[0];
  const notes = ['パル名', 'ニックネーム', '属性', 'パッシブ', 'パートナースキル', '所持者'].map((label) => ({ label, name: `${label}の値`, desc: '' }));
  const row = ownedRowItem(pal, { notes });
  const line = row.element.querySelector('.owned-hits');
  assert.deepEqual(line.querySelectorAll('.owned-hit').map((node) => node.textContent), ['パル名：パル名の値', 'ニックネーム：ニックネームの値', '属性：属性の値', 'パッシブ：パッシブの値']);
  assert.match(line.textContent, /ほか 2 件$/);
  assert.equal(line.title.split('\n').length, 6);
  // 短い項目は縮めない印（is-short）。長い項目（説明つきなど）だけが縮んで省略される
  assert.ok(line.querySelectorAll('.owned-hit').every((node) => node.className.split(' ').includes('is-short')));
  // 要素は段落と 4 つと「ほか」まで（2,000 行で要素の数を増やさない）
  assert.equal(descendants(line).length, 6);
  row.update(pal, { notes: [{ label: 'パル名', name: 'パル名の値', desc: '' }, { label: 'パートナースキル', name: '名前', desc: 'とても長い説明の文がここに入ります' }] });
  assert.deepEqual(line.querySelectorAll('.owned-hit').map((node) => node.className), ['owned-hit is-short', 'owned-hit']);
  row.destroy();
});

test('所持パル画面: 性別は名前の左に出し、パル濃縮と個体値で絞り込む', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  const line = view.element.querySelectorAll('.owned-row')[0].querySelector('.pal-name-line');
  assert.deepEqual(line.children.map((node) => node.textContent), ['♀', 'モコロン']);
  // 属性のアイコンは要素を足さず、番号の行のクラス（CSS の ::after の背景）で描く（game-assets。モコロンは無属性。行の要素の数を増やさない。
  // 名前の行に置くと 920px で名前が切れたので番号の行へ。フェーズ 4 の終わりのレビュー）
  assert.equal(line.className, 'pal-name-line');
  assert.equal(view.element.querySelectorAll('.owned-row')[0].querySelector('.dex-label').className, 'dex-label has-elements el1-Neutral');
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

test('所持パル画面: 個体値はチェックつきの入力。「まとめて ▾」の「すべて 90 以上」「すべて 100」は 3 つとも入れて 1 回だけ絞り込み（メニューは閉じる）、チェックを外すと条件なし', async (t) => {
  installDom(t);
  const sheep = (instanceId, talent) => ({ instanceId, characterId: 'SheepBall', gender: 'Male', level: 5, passives: [], talent, location: { kind: 'palbox', playerUid: P1 } });
  const owned = fakeOwned(manyData(0, [sheep('lo', { hp: 10, shot: 20, defense: 30 }), sheep('mid', { hp: 95, shot: 92, defense: 90 }), sheep('top', { hp: 100, shot: 100, defense: 100 })]));
  const view = ownedView(context(owned), parseHash('#/owned'));
  const rows = () => view.element.querySelectorAll('.owned-row').length;
  const inputLabeled = (label) => view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === label);
  const values = () => ['HP', '攻撃', '防御'].map((label) => [inputLabeled(`${label}を条件にする`).checked, inputLabeled(`${label}の個体値（以上）`).value]);
  assert.ok(view.element.querySelectorAll('.field-label').some((node) => node.textContent === '個体値（以上）'));
  // 既定は条件なし（チェックなし・空欄）
  assert.deepEqual(values(), [[false, ''], [false, ''], [false, '']]);
  assert.equal(rows(), 3);
  // 絞り込み（filterOwned が所持パルの全員を filter する）の回数を数える
  let filtered = 0;
  const all = owned.state.owned.pals;
  all.filter = (...args) => { filtered++; return Array.prototype.filter.apply(all, args); };
  const button = (label) => view.element.querySelectorAll('button').find((node) => node.textContent === label);
  // 2 つのプリセットは 1 つのメニューにまとめた（前はボタンを 2 つ並べていた）
  assert.equal(button('すべて 90 以上'), undefined);
  const menu = button('まとめて');
  assert.equal(menu.getAttribute('aria-haspopup'), 'menu');
  await menu.dispatch('click');
  assert.equal(button('すべて 90 以上').getAttribute('role'), 'menuitem');
  await button('すべて 90 以上').dispatch('click');
  assert.equal(button('すべて 100'), undefined);
  assert.deepEqual(values(), [[true, '90'], [true, '90'], [true, '90']]);
  assert.equal(filtered, 1);
  assert.equal(rows(), 2);
  await menu.dispatch('click');
  await button('すべて 100').dispatch('click');
  assert.deepEqual(values(), [[true, '100'], [true, '100'], [true, '100']]);
  assert.equal(filtered, 2);
  assert.equal(rows(), 1);
  // チェックを外すと、そのステータスは条件なし（数字は残す）
  for (const label of ['HP', '攻撃', '防御']) {
    const check = inputLabeled(`${label}を条件にする`);
    check.checked = false;
    await check.dispatch('change');
  }
  assert.deepEqual(values(), [[false, '100'], [false, '100'], [false, '100']]);
  assert.equal(rows(), 3);
  view.destroy();
});

test('所持パル画面: 並べ替えに「個体値の合計が低い順」があり、合計の低い個体から並べる', async (t) => {
  installDom(t);
  const sheep = (instanceId, talent) => ({ instanceId, characterId: 'SheepBall', gender: 'Male', level: 5, passives: [], talent, location: { kind: 'palbox', playerUid: P1 } });
  const owned = fakeOwned(manyData(0, [sheep('mid', { hp: 50, shot: 50, defense: 50 }), sheep('top', { hp: 100, shot: 100, defense: 100 }), sheep('lo', { hp: 0, shot: 10, defense: 0 })]));
  const view = ownedView(context(owned), parseHash('#/owned'));
  const sort = view.element.querySelectorAll('select').find((node) => [...node.children].some((option) => option.value === 'talent'));
  const labels = [...sort.children].map((option) => option.textContent);
  assert.equal(labels[labels.indexOf('個体値の合計が高い順') + 1], '個体値の合計が低い順');
  // 値は「キー:向き」（前の値 talent-low は talent・asc に読み替える）
  sort.value = 'talent:asc';
  await sort.dispatch('change');
  assert.deepEqual(view.element.querySelectorAll('.owned-talent').map((node) => node.getAttribute('aria-label')),
    ['個体値 HP 0・攻撃 10・防御 0・合計 10', '個体値 HP 50・攻撃 50・防御 50・合計 150', '個体値 HP 100・攻撃 100・防御 100・合計 300']);
  view.destroy();
});

test('所持パル画面: 人間のキャラクターはゲームの名前とアイコンで出し、件数が多くても全部出す', (t) => {
  installDom(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const many = Array.from({ length: 250 }, (_, i) => ({ instanceId: `s${i}`, characterId: 'SheepBall', passives: [], talent: {}, location: { kind: 'palbox', playerUid: P1 } }));
  const humans = [{ instanceId: 'h', characterId: 'BOSS_Believer_CrossBow', gender: 'Male', passives: [], talent: {}, location: { kind: 'palbox', playerUid: P1 } }];
  const data = { version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', updatedAt: '2026-10-05T00:00:00.000Z' }, snapshot: { ...snapshot, pals: [...humans, ...many] } };
  const view = ownedView(context(fakeOwned(data)), parseHash('#/owned'));
  // 先頭の 200 行（図鑑順なので種族の見出しの行を含む。goals-detail の F068）をすぐ出し、残りは区切って足す（途中で止めず、もっと見るもない）
  assert.equal(view.element.querySelectorAll('.owned-row').length + view.element.querySelectorAll('.owned-species').length, 200);
  t.mock.timers.runAll();
  const rows = view.element.querySelectorAll('.owned-row');
  assert.equal(rows.length, 251);
  // 種族の見出しはモコロンと、パル以外（人間）の 2 つ
  assert.deepEqual(view.element.querySelectorAll('.owned-species-name').map((node) => node.textContent), ['No.1 モコロン', 'パル以外（人間など）']);
  assert.equal(view.element.querySelectorAll('.load-more').length, 0);
  const human = rows.find((row) => /賞金首 エゴ/.test(row.textContent));
  assert.ok(human);
  assert.doesNotMatch(human.textContent, /マスターにない|BOSS_Believer_CrossBow/);
  assert.match(human.querySelector('img').src, /img\/humans\/T_BOSS_NPC_Believer\.png$/);
  // 性別の印はパルの行と同じ部品（genderMark。文字の ♂ と読み上げの「オス」）
  const mark = human.querySelector('.gender');
  assert.deepEqual([mark.className, mark.textContent, mark.getAttribute('role'), mark.getAttribute('aria-label')], ['gender gender-M', '♂', 'img', 'オス']);
  view.destroy();
});

test('所持パル画面: 所持パルのデータがなく自動の読み込みもオフなら、1 文と「ワールドを登録」を出し、押すとこの画面のまま登録のモーダルを開く（copy-dead-ends。前は「設定でワールドを登録してください」と設定へ移るボタン）', async (t) => {
  const { body } = installDom(t);
  const app = context(fakeOwned(null));
  const view = ownedView(app, parseHash('#/owned'));
  const notices = view.element.querySelector('.owned-notices');
  assert.equal(notices.textContent, 'セーブのファイルが登録されていません。ワールドを登録');
  const open = notices.querySelectorAll('button');
  assert.deepEqual(open.map((node) => node.textContent), ['ワールドを登録']);
  await open[0].dispatch('click');
  assert.deepEqual(app.navigations, []);
  assert.equal(body.querySelector('dialog').querySelector('h2').textContent, 'ワールドを登録');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 0);
  // 空の表示にもアイコン（所持パルのタブのアイコン。読み上げない）
  const icon = view.element.querySelector('.owned-list').querySelector('.empty-icon');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(icon.querySelector('svg').getAttribute('class'), 'tab-icon');
  // 今すぐ読み込むは設定（とヘッダー）の操作のまま、この画面に出さない
  assert.equal(view.element.querySelectorAll('button').filter((node) => /今すぐ読み込む/.test(node.textContent)).length, 0);
  view.destroy();
  const guest = ownedView(context(fakeOwned(null, { role: 'guest', folder: { id: 'W', role: 'guest' }, linkedWorldId: 'W' })), parseHash('#/owned'));
  assert.match(guest.element.querySelector('.owned-notices').textContent, /ホストがまだこのワールドの所持パルを共有していません/);
  guest.destroy();
});

test('所持パル画面: 自動の読み込みがオフでも、共有された所持パルなどを表示できているときは「設定でワールドを登録」の帯を出さない', (t) => {
  installDom(t);
  const owned = fakeOwned(undefined, { auto: { enabled: false, status: 'off', worlds: [], worldId: '', error: '' }, role: '' });
  owned.state.meta = { ...owned.state.meta, source: 'shared' };
  const view = ownedView(context(owned), parseHash('#/owned'));
  const notices = view.element.querySelector('.owned-notices');
  assert.equal(notices.hidden, true);
  assert.equal(notices.children.length, 0);
  assert.equal(view.element.querySelector('.owned-source'), null);
  // 案内がないときは案内の入れ物ごと隠す（パネルが見出しのすぐ下に来る）
  assert.equal(view.element.querySelector('.owned-summary').hidden, true);
  view.destroy();
});

test('所持パル画面: 確認・読み込みの間（busy）も案内の帯は出入りしない（許可の案内も残す。読み込みの状態は上のバーのセーブ連携の表示に任せる）', (t) => {
  installDom(t);
  const permission = { enabled: true, status: 'permission', worlds: [{ id: 'W', status: 'permission' }], worldId: '', error: 'セーブを読むには許可が必要です' };
  const owned = fakeOwned(undefined, { auto: permission });
  owned.state.data.snapshot = { ...owned.state.data.snapshot, files: { used: ['Level.sav', 'Players/00000000000000000000000000000001.sav'], skipped: [] } };
  const view = ownedView(context(owned), parseHash('#/owned'));
  // 許可切れの案内は短い 1 文と、勧め（「毎回のアクセスを許可」）の小さな 2 行目（autoreg-visibility の permissionNotice）
  const PERMISSION_SHOWN = 'セーブを読む許可が必要です。Chrome の確認で「毎回のアクセスを許可」を選ぶと、ゲーム中（タブが裏）も止まりません。読み込みを許可';
  const notices = view.element.querySelector('.owned-notices');
  const shown = () => notices.children.map((node) => node.textContent);
  assert.deepEqual(shown(), [PERMISSION_SHOWN]);
  const item = notices.children[0];
  const parts = view.element.children;
  const filters = view.element.querySelector('.owned-filters');
  const rows = view.element.querySelectorAll('.owned-row');
  // 1 分ごとの確認（busy → checking）
  Object.assign(owned.state, { busy: true, auto: { ...permission, status: 'checking' } });
  owned.emit();
  assert.deepEqual(shown(), [PERMISSION_SHOWN]);
  assert.equal(notices.children[0], item);
  // 読み込みの途中（progress は帯に出さない）
  Object.assign(owned.state, { progress: 'Level.sav を読み込み中…' });
  owned.emit();
  assert.deepEqual(shown(), [PERMISSION_SHOWN]);
  // 終わったら結果で描き直す（同じ結果なら帯は同じ）
  Object.assign(owned.state, { busy: false, progress: '', auto: permission });
  owned.emit();
  assert.deepEqual(shown(), [PERMISSION_SHOWN]);
  assert.equal(view.element.querySelector('.owned-activity'), null);
  assert.deepEqual(view.element.children, parts);
  assert.equal(view.element.querySelector('.owned-filters'), filters);
  assert.deepEqual(view.element.querySelectorAll('.owned-row'), rows);
  // 許可が戻ったら案内は消える
  Object.assign(owned.state, { auto: { ...permission, status: 'ready', error: '' } });
  owned.emit();
  assert.deepEqual(shown(), []);
  view.destroy();
});

test('所持パル画面: この PC で読んだセーブに場所の分からないパルがいれば知らせ、「見る」で場所「不明」に絞る', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  owned.state.data.snapshot = { ...owned.state.data.snapshot, stats: { unknownLocation: 2 }, files: { used: ['Level.sav', 'Players/00000000000000000000000000000001.sav'], skipped: [] } };
  const app = context(owned);
  const view = ownedView(app, parseHash('#/owned'));
  const notices = view.element.querySelector('.owned-notices');
  assert.equal(notices.children.length, 1);
  assert.match(notices.textContent, /^場所が分からないパルが 2 体います見る$/);
  await notices.querySelector('button').dispatch('click');
  assert.deepEqual(app.navigations, ['#/owned?place=unknown']);
  view.destroy();
});

test('所持パル画面: 開いたときに 1 回読み直し、画面は自分でタイマーを持たない（開いている間の読み直しは app.js の 10 秒ごとの 1 本。share-fetch）', async (t) => {
  installDom(t);
  t.mock.timers.enable({ apis: ['setInterval'] });
  const intervals = t.mock.method(globalThis, 'setInterval');
  const owned = fakeOwned();
  let refreshes = 0;
  owned.autoRefresh = () => { refreshes++; return Promise.resolve('skipped'); };
  const view = ownedView(context(owned), parseHash('#/owned'));
  // 開いたときの 1 回
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshes, 1);
  t.mock.timers.tick(60 * 1000);
  assert.equal(refreshes, 1);
  assert.equal(intervals.mock.callCount(), 0);
  view.destroy();
});

test('継承ルート: 所持パルの欄にデータ元の 1 行は出さず（上のバーのセーブ連携の表示と重なるため。D29）、読み込みの状態が変わっても欄を描き直さない', (t) => {
  installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
  ];
  const owned = fakeOwned();
  const view = inheritanceView(context(owned, records), parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  const section = view.element.querySelector('.route-owned');
  assert.equal(section.querySelector('.owned-source'), null);
  assert.equal(section.children[0].className, 'route-owned-box');
  const box = section.querySelector('.route-owned-box');
  Object.assign(owned.state, { busy: true, auto: { ...owned.state.auto, status: 'checking' } });
  owned.emit();
  assert.equal(section.querySelector('.route-owned-box'), box);
  view.destroy();
});

test('設定画面: セーブ連携の状態（役割のチップ）・登録したワールド・使うワールドを出す（表示中・更新の行はない。編集・削除は summary の外）', async (t) => {
  installDom(t);
  const { settingsView } = await import('../../web/js/views/settings.js');
  const owned = fakeOwned();
  const app = context(owned);
  app.store.state.records = [];
  const view = settingsView(app);
  const card = view.element.querySelector('.owned-settings');
  assert.ok(card);
  // この PC の役割は状態の行の短いチップ（前の状態の dl〔この PC・表示中・更新〕はない。C-36）
  assert.equal(card.querySelector('.owned-settings-status'), null);
  assert.equal(card.querySelector('.owned-role-chip').textContent, 'ホスト');
  assert.doesNotMatch(card.textContent, /表示中「テスト」/);
  // 登録したワールドの行は「「テスト」（ホスト Alice） · …に遊んだ」（kind の「ホスト」とファイル数はない。C-43）
  const item = card.querySelector('.owned-registered-item');
  const summary = item.querySelector('.owned-world-summary');
  assert.match(summary.querySelector('.owned-world-label').textContent, /^「テスト」（ホスト Alice） · .+ に遊んだ$/);
  assert.doesNotMatch(summary.textContent, /ファイル|· ホスト ·/);
  // summary の中にボタンはなく、編集・削除は details の外（行の右端。C-44）
  assert.equal(summary.querySelectorAll('button').length, 0);
  assert.deepEqual(item.children.map((node) => node.className), ['owned-world-details', 'owned-registered-actions']);
  assert.deepEqual(item.querySelector('.owned-registered-actions').querySelectorAll('button').map((node) => node.textContent), ['編集', '削除']);
  assert.ok(card.querySelectorAll('button').some((node) => node.textContent === '＋ ワールドを登録'));
  // 所持パルの CSV はカードにも行にもない（設定の「書き出し」カード）
  assert.doesNotMatch(card.textContent, /CSV/);
  // 使うワールドは、登録したワールドから選ぶ（自動 = いま遊んでいるワールド）
  const select = card.querySelector('.owned-world-row').querySelector('select');
  assert.deepEqual(select.querySelectorAll('option').map((node) => node.textContent), ['自動（いま遊んでいるワールド: 「テスト」（ホスト Alice））', '「テスト」（ホスト Alice）']);
  // 所持パルの CSV は「書き出し」カードから（表示中のワールドのデータがあるので押せる）
  const ownedCsv = view.element.querySelector('.settings-export').querySelectorAll('button').find((node) => node.textContent === '所持パルの CSV（表示中のワールド）');
  assert.equal(ownedCsv.disabled, false);
  view.destroy();
});

test('継承ルート: パッシブを選ぶと、持っている所持パルを開始のチップ（2 段目に回数・体数・持ち主）に並べ、開始を選ぶと経路の下に所持個体を所持パルの行で出す', (t) => {
  installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
  ];
  const owned = fakeOwned();
  const app = context(owned, records);
  const view = inheritanceView(app, parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.equal(view.element.querySelectorAll('.picker').length, 2);
  // 候補の一覧（前の .route-start と「この経路を見る」）はなく、開始の候補はチップだけ（route-cleanup。R-01）
  assert.equal(view.element.querySelector('.route-start'), null);
  assert.doesNotMatch(view.element.textContent, /この経路を見る/);
  // チップの 2 段目。候補の要約は、パルボックスのページと位置までは出さない
  const chips = view.element.querySelectorAll('.start-chip');
  assert.equal(chips[1].querySelector('.start-chip-count').textContent, '最短 1 回 · 1 体 · Alice・パルボックス');
  // 2 段目は長いと CSS で省略するので、全文は title にも
  assert.equal(chips[1].title, 'モコロン · 最短 1 回 · 1 体 · Alice・パルボックス');
  // 開始を選ぶまでは所持個体の欄を出さない
  assert.equal(view.element.querySelector('.route-owned').hidden, true);
  view.destroy();

  const routeView = inheritanceView(app, parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  assert.match(routeView.element.textContent, /最短 1 回の配合/);
  // 相手親は親にできる個体（タマゴ・グローバルパルボックスを除く）の ♂♀ の数と、所持パルで見るリンク（owned-overlay）
  const note = routeView.element.querySelector('.route-owned-note');
  assert.equal(note.textContent, '相手親のツッパニャン: ♂1 ♀0（うちパッシブ一致 0 体）所持パルで見る');
  assert.equal(note.querySelector('a').href, '#/owned?pal=PinkCat');
  // 経路の見出しの右に、相手親を持っている段の数
  assert.equal(routeView.element.querySelector('.route-owned-badge').textContent, '相手親 1/1 段で所持');
  // 開始の所持個体は所持パルの行（性別・★・個体値も見える）。見出しの右に「所持パルで開く」（開始のパルと運びたいパッシブで絞った所持パル）
  assert.equal(routeView.element.querySelector('.route-owned').hidden, false);
  const box = routeView.element.querySelector('.route-owned-box');
  assert.equal(box.querySelector('h2').textContent, '開始のモコロンでパッシブを持つ所持個体');
  const rows = box.querySelectorAll('.owned-row');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /職人気質/);
  assert.ok(rows[0].querySelector('.owned-talent'));
  assert.equal(box.querySelector('.route-owned-open').textContent, '所持パルで開く');
  assert.equal(box.querySelector('.route-owned-open').href, '#/owned?pal=SheepBall&p=CraftSpeed_up2');
  assert.equal(box.querySelector('.route-owned-more').hidden, true);
  routeView.destroy();
});

test('継承ルート: 開始のチップの要約は、パル次元ストレージも場所の名前まで（ページと位置は出さない）。所持個体の行には位置を出す', (t) => {
  installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
  ];
  const carrier = (instanceId, location) => ({ instanceId, characterId: 'SheepBall', gender: 'Female', level: 12, rank: 1, passives: ['CraftSpeed_up2'], talent: {}, location });
  const owned = fakeOwned({ ...fakeOwned().state.data, snapshot: { ...snapshot, pals: [
    carrier('d1', { kind: 'dps', playerUid: P1, slotIndex: 55 }),
    carrier('d2', { kind: 'dps', playerUid: P1, slotIndex: 77 }),
    { instanceId: 'b', characterId: 'PinkCat', gender: 'Male', level: 3, rank: 1, passives: [], talent: {}, location: { kind: 'party', playerUid: P1 } },
  ] } });
  const app = context(owned, records);
  const view = inheritanceView(app, parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  const chips = view.element.querySelectorAll('.start-chip');
  assert.equal(chips[1].querySelector('.start-chip-count').textContent, '最短 1 回 · 2 体 · Alice・パル次元ストレージ');
  view.destroy();
  const routeView = inheritanceView(app, parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  const rows = routeView.element.querySelector('.route-owned-box').querySelectorAll('.owned-row');
  assert.deepEqual(rows.map((row) => row.querySelector('.owned-box').textContent).sort(), ['次元 P2 · 5-2', '次元 P3 · 3-6']);
  routeView.destroy();
});

test('継承ルート: 目標とパッシブの下に開始の候補を「すべて」を既定にして並べ、押すと絞り込む。並びは選択欄 → チップ → 経路 → 所持個体', async (t) => {
  installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
  ];
  const app = context(fakeOwned(), records);
  const chipStates = (view) => view.element.querySelectorAll('.start-chip').map((chip) => [chip.textContent, chip.getAttribute('aria-pressed')]);
  const SHEEP = 'No.1モコロン最短 1 回 · 1 体 · Alice・パルボックス';

  const view = inheritanceView(app, parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  // 開始を切り替えても経路の先頭の位置が変わらないよう、所持個体は経路の下（R-07）
  assert.deepEqual(view.element.children.map((node) => node.className).slice(1),
    ['selection-panel route-query', 'route-hint', 'start-filter', 'route-surgery', 'route-split', 'route-result-slot', 'route-owned']);
  assert.equal(view.element.querySelector('.swap-button'), null);
  assert.deepEqual(chipStates(view), [['すべて', 'true'], [SHEEP, 'false']]);
  assert.match(view.element.querySelector('.start-chips').className, /has-starts/);
  assert.equal(view.element.querySelector('.start-chips').querySelector('.picker-trigger').textContent, '他のパル…');
  // 「すべて」のときはチップが次の手順なので、経路の欄は空（説明の文は出さない）
  assert.equal(view.element.querySelector('.route-result-slot').children.length, 0);
  await view.element.querySelectorAll('.start-chip')[1].dispatch('click');
  assert.equal(app.navigations.at(-1), '#/route?to=CuteFox&p=CraftSpeed_up2&from=SheepBall');
  view.destroy();

  // 選んだ候補は押された見た目になり、もう一度押すか「すべて」で開始を外す
  const narrowed = inheritanceView(app, parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  assert.deepEqual(chipStates(narrowed), [['すべて', 'false'], [SHEEP, 'true']]);
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

test('継承ルート: 所持パルのデータがないときも形は同じで、パッシブの欄を出さず「所持パルを読み込むと…」と「設定を開く」を出す', (t) => {
  installDom(t);
  const view = inheritanceView(context(fakeOwned(null)), parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  // 前の 2 列の形（開始 ⇄ 目標）はない（R-05）
  assert.equal(view.element.querySelector('.pair-selection'), null);
  assert.equal(view.element.querySelector('.swap-button'), null);
  assert.ok(view.element.querySelector('.route-query'));
  assert.equal(view.element.querySelector('.route-passives').hidden, true);
  // 開始は選択欄だけ（候補のチップも「すべて」もない。ふつうの見た目の「パルを選択」）
  const start = view.element.querySelector('.start-filter');
  assert.equal(start.querySelectorAll('.start-chip').length, 0);
  assert.equal(start.querySelector('.picker-trigger').textContent, 'パルを選択');
  assert.doesNotMatch(start.querySelector('.start-chips').className, /has-starts/);
  // 1 文と行き先のボタン（設定のセーブ連携。copy-dead-ends の setupHint。R-28）
  assert.equal(view.element.querySelector('.route-hint').hidden, false);
  const hint = view.element.querySelector('.route-hint').querySelector('.setup-hint');
  assert.equal(hint.querySelector('p').textContent, '所持パルを読み込むと、パッシブを持つ個体から探せます。');
  assert.equal(hint.querySelector('a').textContent, 'セーブ連携を開く');
  assert.equal(hint.querySelector('a').getAttribute('href') ?? hint.querySelector('a').href, '#/settings?open=status');
  assert.doesNotMatch(view.element.textContent, /設定タブ/);
  assert.equal(view.element.querySelector('.empty-state').querySelector('p').textContent, '開始のパルを選んでください。');
  view.destroy();
});

test('継承ルート: 所持パルの読み込みの前はパッシブの欄を出したまま（形を変えない）。読み込みを終えてデータがなければ 1 行に替え、データが来たら戻す', (t) => {
  installDom(t);
  const owned = fakeOwned(null, { ready: false });
  const view = inheritanceView(context(owned), parseHash('#/route?to=CuteFox'));
  const children = [...view.element.children];
  const passivesHidden = () => view.element.querySelector('.route-passives').hidden;
  const hintHidden = () => view.element.querySelector('.route-hint').hidden;
  assert.deepEqual([passivesHidden(), hintHidden()], [false, true]);
  owned.state.ready = true;
  owned.emit();
  assert.deepEqual([passivesHidden(), hintHidden()], [true, false]);
  const loaded = fakeOwned().state;
  Object.assign(owned.state, { data: loaded.data, owned: loaded.owned, linkedWorldId: 'W' });
  owned.emit();
  assert.deepEqual([passivesHidden(), hintHidden()], [false, true]);
  // 部品は作り直さず、並びも同じ
  assert.deepEqual([...view.element.children], children);
  view.destroy();
});

test('パッシブの選択欄: 継承ルートは目標と横に並べる欄（.route-query）に置き（所持パルがないときは出さない）、所持パル画面は置かない', (t) => {
  installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
  ];
  const inQuery = (view) => Boolean(view.element.querySelector('.route-query')?.querySelector('.passive-selector'));
  const route = inheritanceView(context(fakeOwned(), records), parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.equal(inQuery(route), true);
  assert.equal(route.element.querySelector('.route-passives').hidden, false);
  route.destroy();
  // 所持パルがないときは隠す（所持パルを読み込む 1 行に替える）
  const noOwned = inheritanceView(context(fakeOwned(null)), parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.equal(noOwned.element.querySelector('.route-passives').hidden, true);
  noOwned.destroy();
  const owned = ownedView(context(fakeOwned()), parseHash('#/owned'));
  assert.ok(owned.element.querySelector('.passive-selector'));
  assert.equal(owned.element.querySelector('.route-query'), null);
  owned.destroy();
});

test('継承ルート: パッシブを選ぶ前は追加のボタンが「運びたいパッシブを選ぶ」（前の常時の案内の文はない）。候補がないときはチップの行の下に 1 行', (t) => {
  installDom(t);
  const app = context(fakeOwned(), []);
  const none = inheritanceView(app, parseHash('#/route?to=CuteFox'));
  assert.equal(passiveAdd(none).textContent, '運びたいパッシブを選ぶ');
  assert.doesNotMatch(none.element.textContent, /運びたいパッシブを選ぶと/);
  assert.equal(none.element.querySelector('.start-note').hidden, true);
  assert.equal(none.element.querySelector('.empty-state').querySelector('p').textContent, '開始のパルを選んでください。');
  none.destroy();
  // 職人気質を持つのはモコロン（パルボックス）とタマゴのフラリーナ。登録の配合がないので目標に届かない
  const unreachable = inheritanceView(app, parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.equal(passiveAdd(unreachable).textContent, 'パッシブを追加…');
  assert.equal(unreachable.element.querySelectorAll('.start-chip').length, 0);
  const note = unreachable.element.querySelector('.start-note');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, '該当する所持パルは 1 体いますが、登録済みの配合では目標にたどり着けません。タマゴ・グローバルパルボックスの個体は含めていません。');
  unreachable.destroy();
  const nobody = inheritanceView(app, parseHash('#/route?to=CuteFox&p=Legend'));
  assert.equal(nobody.element.querySelector('.start-note').textContent, '選んだパッシブをすべて持つ所持パルはいません。');
  nobody.destroy();
});

test('継承ルート: 開始の所持個体は親にできる個体だけをパッシブの多い順に 5 体まで出し、6 体以上なら残りを「ほか N 体」に畳む（残りの行は開いたときに作る）', (t) => {
  installDom(t);
  const sheep = (id, level, extra = [], location = { kind: 'palbox', playerUid: P1, slotIndex: level }) => ({
    instanceId: id, characterId: 'SheepBall', gender: 'Male', level, rank: 1, passives: ['CraftSpeed_up2', ...extra], talent: {}, location,
  });
  const data = {
    version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', hostName: 'Alice', updatedAt: '2026-10-05T00:00:00.000Z' },
    snapshot: {
      version: 1, world: { name: 'テスト', hostName: 'Alice' }, players: [{ uid: P1, name: 'Alice', level: 50 }], bases: [], stats: {},
      pals: [
        sheep('s1', 10), sheep('s2', 20), sheep('s3', 30, ['Rare']), sheep('s4', 40), sheep('s5', 50), sheep('s6', 5), sheep('s7', 1),
        // タマゴとグローバルパルボックスの個体は出さない（開始の候補と同じ。R-15）
        sheep('egg', 0, [], { kind: 'egg-ground', playerUid: P1 }), sheep('gl', 60, [], { kind: 'global', playerUid: '' }),
      ],
    },
  };
  const records = [{ id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 }];
  const view = inheritanceView(context(fakeOwned(data), records), parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  const box = view.element.querySelector('.route-owned-box');
  const levels = (node) => node.querySelectorAll('.owned-row').map((row) => row.querySelector('.owned-level').textContent);
  const [top, more] = box.querySelectorAll('.route-owned-rows');
  // パッシブの多い s3 が先、あとはレベルの高い順
  assert.equal(levels(top).length, 5);
  assert.match(levels(top)[0], /30/);
  assert.equal(box.querySelector('.route-owned-more').hidden, false);
  assert.equal(box.querySelector('summary').textContent, 'ほか 2 体');
  // 「ほか N 体」の行は開いたときに作る（閉じたままでは作らない）
  assert.equal(levels(more).length, 0);
  const details = box.querySelector('.route-owned-more');
  details.open = true;
  details.dispatch('toggle');
  assert.equal(levels(more).length, 2);
  assert.equal(box.querySelectorAll('.owned-row').length, 7);
  assert.equal(box.querySelector('.route-owned-more-note').hidden, true);
  details.open = false;
  details.dispatch('toggle');
  assert.equal(levels(more).length, 0);
  // 「該当する個体を所持していません」の文は隠す（箱の最後の子）
  assert.equal(box.children.at(-1).hidden, true);
  view.destroy();
});

test('継承ルート: 記録に相手親の性別があれば、相手親の注記の末尾に「（記録では ♀）」を添える（所持個体の数とは別に示す）', (t) => {
  installDom(t);
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', parent1Gender: 'M', parent2Gender: 'F', confirmCount: 1 },
  ];
  const view = inheritanceView(context(fakeOwned(), records), parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  assert.equal(view.element.querySelector('.route-owned-note').textContent, '相手親のツッパニャン: ♂1 ♀0（うちパッシブ一致 0 体）（記録では ♀）所持パルで見る');
  // 段には「性別の向きは未確認」の注記（警告ではない）
  assert.equal(view.element.querySelector('.route-note').textContent, '性別の向きは未確認');
  assert.equal(view.element.querySelector('.route-warning'), null);
  view.destroy();
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
  // 新しい登録の確定は「登録して連携」で、何が始まるかを左に添える（C-29）
  const save = dialog.querySelectorAll('button').find((node) => node.textContent === '登録して連携');
  assert.equal(save.disabled, true);
  assert.equal(dialog.querySelector('.owned-dialog-note').textContent, '登録すると、読み込み・所持パルの共有・配合の自動登録（ホストのとき）を始めます');
  // ① の上に、エクスプローラーで開く場所と［コピー］（C-23）
  assert.match(dialog.querySelector('.owned-path-hint').textContent, /エクスプローラーのアドレス欄に %LOCALAPPDATA%\\Pal\\Saved\\SaveGames を貼ると開けます/);
  const path = dialog.querySelector('.owned-path');
  const status = () => dialog.querySelector('.owned-path-status');
  assert.equal(status().textContent, '');
  // パスを貼る前も、チェックリストの各行に書き方（<Steam ID>・<ワールド ID>）を添える（貼ってもリストの高さが変わらない）
  assert.equal(dialog.querySelector('.owned-draft-path').textContent, '…\\SaveGames\\<Steam ID>\\<ワールド ID>\\LocalData.sav');
  // 形の違うパスは赤字で直し方、読み取れたら ID の頭（C-24）
  path.value = '%LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\7656';
  await path.dispatch('input');
  assert.match(status().textContent, /まで含めて貼ってください$/);
  assert.match(status().className, /todo/);
  path.value = WORLD_PATH;
  await path.dispatch('input');
  assert.equal(status().textContent, '✓ Steam 7656 ／ ワールド ABCD…');
  assert.match(status().className, /ok/);
  // ドロップするファイルを 2 組（全員／ホストする PC〔協力プレイで交代でホストする人も。host-rotation・server の participant-ui〕）に並べ、ドロップしたものに印を付ける。各行に、貼ったパスから作った実際のパスを添える（長い ID は頭 4 字。F082・C-27）
  assert.deepEqual(dialog.querySelectorAll('.owned-draft-title').map((node) => node.textContent), ['全員', 'ホストする PC（協力プレイで交代でホストする人も）']);
  const labels = () => dialog.querySelectorAll('.owned-draft-items').flatMap((list) => list.children)
    .map((item) => item.textContent.replace(item.querySelector('.owned-draft-path')?.textContent ?? '', '').replace(item.querySelector('.owned-draft-note')?.textContent ?? '', ''));
  assert.deepEqual(labels(), ['— LocalData.sav', '— Level.sav', '— LevelMeta.sav', '— Players\\ の中のファイル全部', '— ..\\GlobalPalStorage.sav（任意）']);
  // 「Players\ の中のファイル全部」の行にだけ、後から次元ストレージを使い始めた人の _dps.sav も足せることを添える（dps-missing）
  assert.deepEqual(dialog.querySelectorAll('.owned-draft-note').map((node) => node.textContent), ['後からパル次元ストレージを使い始めた人の _dps.sav も、ここにドロップして足せます']);
  assert.deepEqual(dialog.querySelectorAll('.owned-draft-path').map((node) => node.textContent), [
    '…\\SaveGames\\7656\\ABCD…\\LocalData.sav', '…\\SaveGames\\7656\\ABCD…\\Level.sav', '…\\SaveGames\\7656\\ABCD…\\LevelMeta.sav',
    '…\\SaveGames\\7656\\ABCD…\\Players\\', '…\\SaveGames\\7656\\GlobalPalStorage.sav',
  ]);
  await dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('Level.sav', 'LevelMeta.sav') });
  await tick();
  await dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('LocalData.sav', '00000000000000000000000000000001.sav') });
  await tick();
  assert.deepEqual(labels().slice(0, 4), ['✓ LocalData.sav', '✓ Level.sav', '✓ LevelMeta.sav', '✓ Players\\ の中のファイル全部（1 件）']);
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
  // 閉じる「×」は文字ではなく SVG のアイコン（名前は aria-label「閉じる」）
  // （ほかは ① の場所の［コピー］だけ）
  assert.deepEqual(dialog.querySelectorAll('button').map((node) => node.textContent || node.getAttribute('aria-label')), ['閉じる', 'コピー', 'キャンセル', '保存']);
  // 編集は登録済みのワールドなので「登録済み」と出す
  assert.match(dialog.querySelector('.owned-path-status').textContent, /登録済みのワールドです/);
  assert.equal(dialog.querySelector('.icon-button').querySelector('svg').getAttribute('class'), 'close-icon');
  card.destroy();
});

// 専用サーバーのセーブ（…\SaveGames\0\<ワールド ID>）。ブラウザでは登録しない（server の participant-ui・決定 16）
const SERVER_WORLD_PATH = 'D:\\Server\\bin\\Pal\\Saved\\SaveGames\\0\\ABCDEF0123456789ABCDEF0123456789';
const SERVER_PATH_TEXT = '専用サーバーのセーブは、サーバーの PC の常駐プログラムが読み込みます（ブラウザでは登録しません）';
const toastTexts = (body) => body.querySelectorAll('.toast-message').map((node) => node.textContent);

test('設定画面（server の participant-ui）: 登録のモーダルに専用サーバーのセーブのパスを貼ると、常駐プログラムが読むことを出し、ドロップと保存を受けない', async (t) => {
  const { body } = installDom(t);
  const calls = [];
  const owned = fakeOwned(null);
  owned.previewRegistration = async (input) => { calls.push(['preview', input.steamId]); return { ...input, kind: 'host', role: 'host', name: 'World9', hostName: '', palCount: 1, replaced: [] }; };
  owned.commitRegistration = async () => { calls.push(['commit']); return { persisted: true, result: 'imported' }; };
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  await card.element.querySelectorAll('button').find((node) => node.textContent === '＋ ワールドを登録').dispatch('click');
  const dialog = body.querySelector('.world-dialog');
  const path = dialog.querySelector('.owned-path');
  const status = dialog.querySelector('.owned-path-status');
  const save = dialog.querySelectorAll('button').find((node) => node.textContent === '登録して連携');
  path.value = SERVER_WORLD_PATH;
  await path.dispatch('input');
  assert.deepEqual([status.textContent, status.className], [SERVER_PATH_TEXT, 'owned-path-status todo']);
  assert.ok(dialog.querySelector('.owned-drop').className.split(' ').includes('disabled'));
  await dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('Level.sav', 'LevelMeta.sav') });
  await tick();
  assert.deepEqual(calls, []);
  assert.ok(toastTexts(body).includes(SERVER_PATH_TEXT), toastTexts(body).join('\n'));
  assert.equal(save.disabled, true);
  // 協力プレイのパスに直せば、今までどおり受ける
  path.value = WORLD_PATH;
  await path.dispatch('input');
  assert.equal(status.textContent, '✓ Steam 7656 ／ ワールド ABCD…');
  await dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('Level.sav', 'LevelMeta.sav', 'LocalData.sav') });
  await tick();
  assert.deepEqual(calls, [['preview', '7656']]);
  // 読み込んだ後でも、サーバーのパスに替えたら保存できない
  path.value = SERVER_WORLD_PATH;
  await path.dispatch('input');
  assert.deepEqual([status.textContent, save.disabled], [SERVER_PATH_TEXT, true]);
  card.destroy();
});

test('設定画面（server の participant-ui）: 前にブラウザで登録した専用サーバーのセーブ（steamId 0）は、行に削除を勧める 1 行を出し、編集ではファイルを足せない', async (t) => {
  const { body } = installDom(t);
  const owned = fakeOwned();
  owned.state.auto.worlds[0].steamId = '0';
  owned.state.auto.worlds.push({ id: 'C', dir: 'C', steamId: '7656', kind: 'host', name: '協力', hostName: 'Alice', status: 'ok', role: 'host', playedAt: '', files: ['Level.sav'] });
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  const [server, coop] = card.element.querySelectorAll('.owned-registered-item');
  assert.equal(server.querySelector('.owned-server-note').textContent, '専用サーバーのセーブの登録です。共有と自動登録がサーバーの PC の常駐プログラムと重なるため、この登録は削除してください。');
  // 閉じたままでも見える（ワールドの行の開閉の中に入れない）
  assert.equal(server.querySelector('.owned-world-details').querySelector('.owned-server-note'), null);
  assert.equal(coop.querySelector('.owned-server-note'), null);
  await server.querySelectorAll('button').find((node) => node.textContent === '編集').dispatch('click');
  const dialog = body.querySelector('.world-dialog');
  assert.equal(dialog.querySelector('.owned-path-status').textContent, SERVER_PATH_TEXT);
  await dialog.querySelector('.owned-drop').dispatch('drop', { dataTransfer: dropped('Level.sav') });
  await tick();
  assert.ok(toastTexts(body).includes(SERVER_PATH_TEXT));
  assert.equal(dialog.querySelectorAll('button').find((node) => node.textContent === '保存').disabled, true);
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
  // 状態の印は 1 つの部品（statusChip）。オンは ready、オフ・対象外は neutral（前のクラス名 owned-world-state は残す）
  const toneOf = (node) => node.className.split(' ').filter((name) => name.startsWith('is-'));
  assert.ok(host.querySelector('.owned-world-state').className.split(' ').includes('status-chip'));
  assert.deepEqual(toneOf(host.querySelector('.owned-world-state')), ['is-ready']);
  assert.deepEqual(toneOf(guest.querySelector('.owned-world-state')), ['is-neutral']);
  host.open = true;
  await host.dispatch('toggle');
  const box = host.querySelector('.owned-breeding');
  const toggle = box.querySelector('input');
  assert.equal(toggle.checked, true);
  toggle.checked = false;
  await toggle.dispatch('change');
  // チェックを外すと、行の状態もすぐ変わる
  assert.match(host.querySelector('.owned-world-state').textContent, /配合の自動登録: オフ/);
  // ホストの行のチェックの下に、ページを閉じている間は止まることの 1 行（roles）
  assert.match(box.querySelector('.owned-role-note').textContent, /このページを開いている間（タブが裏でもよい）、ゲームが保存するたびにセーブを読みます。閉じている間に孵化したタマゴは登録できません。/);
  // プレイヤーの対応はワールドの行の外の独立した欄（「使うワールド」の下。roles。C-03）
  assert.equal(box.querySelector('.owned-breeding-player'), null);
  const players = card.element.querySelector('.owned-players');
  assert.equal(players.hidden, false);
  assert.equal(players.querySelector('h3').textContent, 'プレイヤーの対応（セーブのプレイヤー → ノートの ID）');
  const select = players.querySelector('.owned-breeding-player').querySelector('select');
  assert.match(players.querySelector('.owned-breeding-player').textContent, /^Alice/);
  assert.equal(select.getAttribute('aria-label'), 'Aliceのノートの ID');
  // 手で選んでいなければ、同じ名前のユーザーを使うことを出す
  assert.equal(select.value, '');
  assert.equal(select.querySelectorAll('option')[0].textContent, 'Alice（同じ名前）');
  select.value = '仲間';
  await select.dispatch('change');
  assert.deepEqual(calls, [['enabled', false, 'W'], ['mapping', P1, '仲間', 'W']]);
  // 参加しているだけのワールドでは、自動登録はホストの画面が行うこと（「自動登録は動きません」とは言わない。X-06）
  assert.match(guest.querySelector('.owned-breeding').textContent, /この PC では読み込みません。配合牧場の自動登録はホストの画面が行います（ホストが/);
  // 協力プレイで交代でホストするなら［編集］でホストの組のファイルを足すこと（host-rotation・server の participant-ui）
  assert.equal(guest.querySelector('.owned-rotation-note').textContent, '協力プレイで交代でホストするなら、［編集］で Level.sav・LevelMeta.sav・Players のファイルを足してください（ホストしたときに共有と自動登録が動きます）。');
  assert.equal(host.querySelector('.owned-rotation-note'), null);
  assert.doesNotMatch(card.element.textContent, /自動登録は動きません/);
  assert.ok(!guest.querySelector('.owned-toggle'));
  // 描き直しても、開いた行は開いたまま
  owned.state.auto.worlds[0].playedAt = '2026-10-06T00:00:00.000Z';
  owned.emit();
  assert.equal(card.element.querySelectorAll('.owned-world-details')[0].open, true);
  // 参加のワールドの最後の共有がサーバーのセーブなら、自動登録はサーバーの PC の常駐プログラムが行うこと（server の participant-ui）
  owned.state.shared = { ...owned.state.shared, worlds: [{ worldId: 'G', uploadedAt: '2026-10-06T00:00:00.000Z', saveKind: 'server' }] };
  owned.emit();
  const serverGuest = card.element.querySelectorAll('.owned-world-details')[1];
  assert.equal(serverGuest.querySelector('.owned-role-note').textContent, 'この PC では読み込みません。配合牧場の自動登録は、サーバーの PC の常駐プログラムが行います（プレイヤーの対応であなたが選ばれているとき）。');
  assert.match(serverGuest.querySelector('.owned-rotation-note').textContent, /^協力プレイで交代でホストするなら/);
  card.destroy();
});

test('設定画面（autoreg-visibility）: ワールドの行の登録者の上に「登録待ち n 件」。登録済みと違う行は親 2 体の絵・「登録を開く」・「破棄」だけで、子は出さない', async (t) => {
  installDom(t);
  const listeners = new Set();
  let summary = {
    unmapped: [{ uid: P2, name: 'Bob', parents: ['SheepBall', 'PinkCat'] }, { uid: P2, name: 'Bob', parents: ['CatMage', 'PinkCat'] }],
    conflict: [{ id: 'p0000abcd', parents: ['SheepBall', 'SwordCutlassfish'] }],
  };
  const discarded = [];
  const autoRegister = {
    enabled: () => true, setEnabled() {}, mapping: () => ({}), setMapping() {},
    pendingSummary: (worldId) => (worldId === 'W' ? summary : { unmapped: [], conflict: [] }),
    discardPending(id, worldId) { discarded.push([id, worldId]); summary = { ...summary, conflict: [] }; listeners.forEach((listener) => listener()); return true; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const owned = fakeOwned();
  const ctx = { ...context(owned), autoRegister };
  ctx.store.state.users = ['Alice', '仲間'];
  const card = ownedSettingsCard(ctx, { win: DROP_WIN });
  // 登録待ちはプレイヤーの対応の欄の中、選択より上（roles で欄ごと移した）
  const box = card.element.querySelector('.owned-players');
  const pending = box.querySelector('.owned-pending');
  assert.equal(pending.hidden, false);
  assert.equal(pending.querySelector('.owned-pending-head').textContent, '登録待ち 3 件（登録者未設定 2・登録済みと違う 1）');
  const order = box.children.map((node) => node.className);
  assert.ok(order.indexOf('owned-pending') < order.indexOf('owned-breeding-players'));
  const row = pending.querySelector('.owned-pending-item');
  assert.equal(row.querySelector('.owned-pending-pair').getAttribute('aria-label'), 'モコロン＋オオタチウオ');
  assert.equal(row.querySelector('a').href, '#/search?p1=SheepBall&p2=SwordCutlassfish');
  assert.deepEqual(row.querySelectorAll('button').map((node) => node.textContent), ['破棄']);
  // 子（配合表の答え）は出さない
  assert.doesNotMatch(pending.textContent, /ヤクモマル|→/);
  // 破棄は確かめてから
  const click = row.querySelector('button').dispatch('click');
  const dialog = document.body.querySelectorAll('dialog').find((node) => node.open);
  assert.match(dialog.textContent, /自動登録しません/);
  await dialog.querySelectorAll('button').find((node) => node.textContent === '破棄').dispatch('click');
  await click;
  assert.deepEqual(discarded, [['p0000abcd', 'W']]);
  assert.equal(pending.querySelector('.owned-pending-head').textContent, '登録待ち 2 件（登録者未設定 2）');
  assert.equal(pending.querySelector('.owned-pending-list'), null);
  // 0 件なら出さない
  summary = { unmapped: [], conflict: [] };
  listeners.forEach((listener) => listener());
  assert.equal(pending.hidden, true);
  card.destroy();
  assert.equal(listeners.size, 0);
});

test('設定画面（autoreg-visibility）: 許可切れは状態の行（「許可が必要」と「読み込みを許可」）にまとめ、長い文の代わりに止まった時刻と勧めを出す', (t) => {
  installDom(t);
  const owned = fakeOwned();
  const stoppedAt = new Date(2026, 9, 15, 14, 32).toISOString();
  Object.assign(owned.state, { auto: { ...owned.state.auto, status: 'permission', error: 'セーブを読む許可が必要です', stoppedAt } });
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  assert.equal(card.element.querySelector('.owned-auto-state').textContent, '許可が必要');
  const grant = card.element.querySelectorAll('button').find((node) => node.textContent === '読み込みを許可');
  assert.equal(grant.hidden, false);
  const note = card.element.querySelector('.owned-auto-error');
  assert.match(note.textContent, /から読めていません。この間に拾ったタマゴは自動登録されていない場合があります。Chrome の確認で「毎回のアクセスを許可」/);
  assert.doesNotMatch(note.textContent, /セーブを読む許可が必要です/);
  assert.match(note.className, /is-hint/);
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
  // 許可のボタンは案内の帯だけ（データ元の 1 行はなくした。D29）
  assert.equal(view.element.querySelector('.owned-source-grant'), null);
  view.destroy();
});

test('所持パル画面: 登録した後に増えたプレイヤーの Players のファイルを、追加するよう案内し、「ワールドを編集」でそのワールドの編集のモーダルを開く（copy-dead-ends。前は「設定タブの「セーブ連携」で…」の文だけ）', async (t) => {
  const { body } = installDom(t);
  const P2 = '0000000a-0000-0000-0000-00000000000b';
  const data = {
    version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 'W', name: 'テスト', updatedAt: '2026-10-05T00:00:00.000Z' },
    snapshot: { ...snapshot, players: [...snapshot.players, { uid: P2, name: 'Bob', level: 10 }, { uid: '0000000c-0000-0000-0000-00000000000d', name: '', level: 0 }],
      files: { used: ['Level.sav', 'Players/00000000000000000000000000000001.sav'], skipped: [] } },
  };
  const view = ownedView(context(fakeOwned(data)), parseHash('#/owned'));
  const text = view.element.querySelector('.owned-notices').textContent;
  assert.match(text, /^登録されていないプレイヤーのファイルがあります: Bob（Players\\0000000A00000000000000000000000B\.sav）。ワールドを編集$/);
  assert.doesNotMatch(text, /0000000C|設定タブ/);
  await view.element.querySelector('.owned-notices').querySelector('button').dispatch('click');
  assert.equal(body.querySelector('dialog').querySelector('h2').textContent, 'ワールドを編集');
  view.destroy();
});

test('所持パル画面（dps-missing）: ホストはパル次元ストレージの読み漏れを［ワールドを編集］つきで、参加者は自分のプレイヤーが候補のときだけ案内する（自分が変わったら描き直す）', async (t) => {
  const { body } = installDom(t);
  const P2 = '00000000-0000-0000-0000-000000000002';
  const data = {
    version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 'W', name: 'テスト', updatedAt: '2026-10-05T00:00:00.000Z' },
    snapshot: { ...snapshot, players: [...snapshot.players, { uid: P2, name: 'Bob', level: 10 }], stats: { inLocker: 118, inLockerMissing: 27 },
      files: { used: ['Level.sav', 'Players/00000000000000000000000000000001.sav', 'Players/00000000000000000000000000000001_dps.sav', 'Players/00000000000000000000000000000002.sav'], skipped: [] } },
  };
  const host = ownedView(context(fakeOwned(data)), parseHash('#/owned'));
  const notices = host.element.querySelector('.owned-notices');
  assert.match(notices.textContent, /^Level\.sav ではパル次元ストレージに 118 体いますが、27 体を読めていません。Players.00000000000000000000000000000002_dps\.sav（Bob）が登録されていないかもしれません。ワールドを編集$/);
  await notices.querySelector('button').dispatch('click');
  assert.equal(body.querySelector('dialog').querySelector('h2').textContent, 'ワールドを編集');
  host.destroy();

  // 参加者: 共有のデータの Bob に dpsGap がある。自分（ideals.selfUids）が Bob のときだけ
  const shared = fakeOwned(data, { role: 'guest', meta: { worldId: 'W', worldName: 'テスト', hostName: 'Alice', source: 'shared', saveUpdatedAt: '2026-10-05T00:00:00.000Z', sharedAt: '2026-10-05T00:01:00.000Z', uploadedBy: 'ホスト', palCount: 3 } });
  shared.state.owned = { ...shared.state.owned, players: shared.state.owned.players.map((player) => (player.uid === P2 ? { ...player, dpsGap: 27 } : { ...player, dpsGap: undefined })) };
  let self = new Set();
  const selfListeners = new Set();
  const ctx = { ...context(shared), ideals: { selfUids: () => self }, self: { subscribe: (listener) => { selfListeners.add(listener); return () => selfListeners.delete(listener); } } };
  const guest = ownedView(ctx, parseHash('#/owned'));
  const guestNotices = () => guest.element.querySelector('.owned-notices').textContent;
  assert.doesNotMatch(guestNotices(), /次元ストレージ/);
  self = new Set([P2]);
  for (const listener of selfListeners) listener();
  assert.match(guestNotices(), /ワールド全体で、パル次元ストレージの 27 体が出ていません。ホストの登録にあなたの Players.00000000000000000000000000000002_dps\.sav がないかもしれません。ホストに足してもらってください。/);
  guest.destroy();
});

// モーダルを開いて、パスを貼り、ファイルをドロップするまで
async function openRegister(t, owned) {
  const { body } = installDom(t);
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  await card.element.querySelectorAll('button').find((node) => node.textContent === '＋ ワールドを登録').dispatch('click');
  const dialog = body.querySelector('.world-dialog');
  const path = dialog.querySelector('.owned-path');
  const save = dialog.querySelectorAll('button').find((node) => node.textContent === '登録して連携');
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

test('設定画面: 共有の削除はワールドの行の中で、そのワールドについて行う（所持パルの CSV は「書き出し」カードへ移した）', async (t) => {
  const { body } = installDom(t);
  const calls = [];
  const owned = fakeOwned();
  owned.state.shared.worlds = [{ worldId: 'W', worldName: 'テスト', hostName: 'Alice', uploadedAt: '2026-10-06T00:00:00.000Z', palCount: 4 }];
  owned.state.auto.worlds.push({ id: 'X', dir: 'X', kind: 'host', name: '別', hostName: '', status: 'ok', role: '', playedAt: '', files: ['Level.sav'] });
  owned.deleteShared = async (worldId) => { calls.push(['delete', worldId]); return true; };
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  const [shared, other] = card.element.querySelectorAll('.owned-world-details');
  const buttonsOf = (row) => row.querySelector('.owned-world-pals')?.querySelectorAll('button').map((node) => node.textContent) ?? [];
  // 共有したワールドは共有の削除だけ
  assert.deepEqual(buttonsOf(shared), ['共有した所持パルを削除']);
  shared.querySelector('.owned-world-pals').querySelector('button').dispatch('click'); // 確認のダイアログが閉じるまで終わらないので待たない
  await tick();
  body.querySelector('dialog').querySelectorAll('button').find((node) => node.textContent === '削除').dispatch('click');
  await tick();
  await tick();
  assert.deepEqual(calls, [['delete', 'W']]);
  // 共有していないワールドは「所持パル」の欄ごと出さない
  assert.equal(other.querySelector('.owned-world-pals'), null);
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
  const holder = holderSelect(view);
  const options = [...holder.children];
  // 行の中のパルの絵と名前・★ の要素（セルの中身を入れ直すと別の要素になる）
  const firstTile = rows[0].children[0].children[0];
  const firstLevel = rows[0].children[1].children[0];
  // 読み直した（新しいデータだが中身は同じ）
  owned.state.owned = normalizeOwned(snapshot, { pals, passives });
  owned.emit();
  assert.deepEqual(view.element.querySelectorAll('.owned-row'), rows);
  assert.equal(rows[0].children[0].children[0], firstTile);
  assert.equal(rows[0].children[1].children[0], firstLevel);
  assert.deepEqual([...holder.children], options);
  // 1 体だけレベルが上がった: 行の要素は同じで、その行の中身だけ入れ直す
  const leveled = { ...snapshot, pals: snapshot.pals.map((pal) => (pal.instanceId === 'a' ? { ...pal, level: 13 } : pal)) };
  owned.state.owned = normalizeOwned(leveled, { pals, passives });
  owned.emit();
  const after = view.element.querySelectorAll('.owned-row');
  assert.deepEqual(after, rows);
  assert.match(after[0].textContent, /Lv 13/);
  // 変わったセル（Lv・★）の中身だけを入れ直し、ほかのセル（パルの絵と名前など）はそのまま（前は行の中身を全部入れ直した）
  assert.notEqual(after[0].children[1].children[0], firstLevel);
  assert.equal(after[0].children[0].children[0], firstTile);
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
  const holder = holderSelect(view);
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
  // 1 回の区切りぶん進める（同じ描画の前に、絞り込みのパネルの「+n」を数える仕事も入っている）
  while (list.children.length === 200 && frames.length) frames.shift()();
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
  assert.equal(rows.length, shownCount(view));
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
  assert.ok(shown.every((row) => /^個体値 HP (9\d|100)・/.test(row.querySelector('.owned-talent').getAttribute('aria-label'))));
  t.mock.timers.runAll();
  assert.equal(view.element.querySelectorAll('.owned-row').length, shown.length);
  assert.equal(shownCount(view), shown.length);
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
  assert.equal(view.element.querySelector('.result-note').textContent, '2001 / 2001 体 · ♂1000 ♀1001');
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
  assert.equal(list.querySelectorAll('.owned-row').length, shownCount(view));
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

test('設定画面: セーブ連携の確認の途中（checking）もエラーの行を消さず、エラーがなくなっても 1 行分の場所を残す（点滅しない）', (t) => {
  installDom(t);
  const message = '「テスト」を読めません（壊れています）。ファイルを登録し直してください';
  const owned = fakeOwned();
  const ready = owned.state.auto;
  owned.state.auto = { ...ready, status: 'error', error: message };
  const card = ownedSettingsCard(context(owned), { win: DROP_WIN });
  const error = card.element.querySelector('.owned-auto-error');
  const state = card.element.querySelector('.owned-auto-state');
  const placeholder = () => error.className.split(' ').includes('is-empty');
  assert.deepEqual([error.textContent, error.hidden, placeholder()], [message, false, false]);
  // 確かめている途中（ストアはエラーを結果が出るまで残す）
  Object.assign(owned.state, { busy: true, auto: { ...ready, status: 'checking', error: message } });
  owned.emit();
  assert.equal(card.element.querySelector('.owned-auto-error'), error);
  assert.deepEqual([error.textContent, error.hidden, placeholder()], [message, false, false]);
  assert.equal(state.textContent, '確認中…');
  // 読み込みの状態の印は 1 つの部品（statusChip）。確認中は neutral、読めないときは error、読めたら ready（同じ要素の tone だけを付け替える）
  const toneOf = () => state.className.split(' ').filter((name) => name.startsWith('is-'));
  assert.ok(state.className.split(' ').includes('status-chip'));
  assert.deepEqual(toneOf(), ['is-neutral']);
  // 読めた（エラーなし）: 文は消すが、見えないまま場所は残す
  Object.assign(owned.state, { busy: false, auto: { ...ready, status: 'ready', error: '' } });
  owned.emit();
  assert.deepEqual([error.textContent, error.hidden, placeholder()], ['', false, true]);
  assert.equal(state.textContent, '読み込み済み');
  assert.deepEqual(toneOf(), ['is-ready']);
  assert.equal(card.element.querySelector('.owned-auto-state'), state);
  Object.assign(owned.state, { auto: { ...ready, status: 'permission', error: '' } });
  owned.emit();
  assert.deepEqual([state.textContent, toneOf()], ['許可が必要', ['is-warning']]);
  Object.assign(owned.state, { auto: { ...ready, status: 'error', error: message } });
  owned.emit();
  assert.deepEqual([state.textContent, toneOf()], ['エラー', ['is-error']]);
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
  // 親にできる個体だけを数える（a。タマゴの c は数えない。開始の候補と同じ数え方。route-cleanup）
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '1 体');
  const more = { ...snapshot, pals: [...snapshot.pals, { instanceId: 'z', characterId: 'PinkCat', gender: 'Male', passives: ['CraftSpeed_up2'], talent: {}, location: { kind: 'palbox', playerUid: P1 } }] };
  owned.state.data = { ...owned.state.data };
  owned.state.owned = normalizeOwned(more, { pals, passives });
  owned.emit();
  assert.equal(passiveAdd(view), add);
  assert.equal(view.element.querySelector('.picker-search'), search);
  assert.equal(document.activeElement, search);
  assert.equal(search.value, '職人');
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '2 体');
  // 見出しは継承ルートの数え方
  assert.match(view.element.querySelector('.passive-options').textContent, /^所持パルが持っているもの（タマゴ・グローバルパルボックスを除く）/);
  view.destroy();
});

test('所持パル画面: キーワードで多くの行の一致の理由が変わるときは、先頭の 60 行をすぐ書き換え、残りは区切って書き換える（行の要素は同じ。owned-rows で 200 行から 60 行にした）', (t) => {
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
  // すぐ書き換えるのは先頭の 60 行（views/owned.js の FILL_NOW。2,000 行でキーワードの入力が 100ms 以上止まらないように）
  assert.equal(hits().filter(Boolean).length, 60);
  assert.ok(hits().slice(0, 60).every(Boolean));
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
  assert.equal(document.activeElement.getAttribute('data-focus-key'), 'passive-chip:パッシブ:WorldTree_ATK');
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
  // タマゴを外すと、タマゴの c を数えない（候補を開いたまま）
  await placeChip(view, 'egg').dispatch('click');
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '1 体');
  assert.ok(view.element.querySelector('.picker-search'));
  // キーワードで絞っても数え直す
  const query = view.element.querySelectorAll('input').find((node) => node.type === 'search' && node.className !== 'picker-search');
  query.value = 'ツッパニャン';
  await query.dispatch('input');
  assert.equal(optionCount(view, 'CraftSpeed_up2'), '');
  view.destroy();
});

test('所持パル画面: 戻る・進むで条件を入れ直したとき（restored）は、キーワード・個体値・場所のチップ・並べ替えの入力欄も合わせる', (t) => {
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
  const hpCheck = inputs().find((node) => node.getAttribute('aria-label') === 'HPを条件にする');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 3);
  // app.js が履歴のエントリの条件を filter に入れ直す（OWNED_MEMORY で確かめた形。並べ替えの向きの無い前のエントリは、そのキーの既定の向き）
  Object.assign(states.get('owned').filter, cleanSaved({ query: 'もこ', talent: { hp: 5, shot: 0, defense: 0 }, places: ['party', 'palbox', 'base', 'dps', 'unknown'], sort: 'level' }, OWNED_MEMORY));
  view.applyRoute(parseHash('#/owned'), { reason: 'history' });
  assert.equal(keyword.value, '');
  view.applyRoute(parseHash('#/owned'), { reason: 'history', restored: true });
  assert.equal(keyword.value, 'もこ');
  assert.equal(hp.value, '5');
  assert.equal(hpCheck.checked, true);
  assert.deepEqual(placeChips(view).map(([group, pressed]) => [group, pressed]), [['party', 'true'], ['palbox', 'true'], ['global', 'false'], ['egg', 'false']]);
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
  const holder = holderSelect(view);
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
  assert.equal(view.element.querySelector('.result-note').textContent, '1 / 1 体 · ♂1 ♀0');
  await passiveAdd(view).dispatch('click');
  assert.equal(optionCount(view, 'Rare'), '1 体');
  view.destroy();
});

test('所持パル画面: 所持パルのデータが無いまま開いて読み込みが終わったら、「読み込み中…」から案内に描き直す', (t) => {
  installDom(t);
  const owned = fakeOwned(null, { ready: false });
  const view = ownedView(context(owned), parseHash('#/owned'));
  // 読み込み中は「〜を読み込み中…」にそろえ、role=status（loadingState。アイコンは付けない）
  const loading = view.element.querySelector('.owned-list').children[0];
  assert.equal(loading.textContent, '所持パルを読み込み中…');
  assert.equal(loading.getAttribute('role'), 'status');
  assert.equal(loading.querySelector('.empty-icon'), null);
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
  // 所持者: 無い・形の合わない値は既定の自分（mine）、「すべて」（''）はそのまま
  assert.deepEqual([undefined, '', 'mine', 7, 'xxx'].map((holder) => cleanSaved({ holder }, OWNED_MEMORY).holder), ['mine', '', 'mine', 'mine', 'mine']);
});

test('継承ルート: URL のパッシブは重複と内部名の形でない値を除き、マスターにまだ無い内部名は残す', (t) => {
  installDom(t);
  const view = inheritanceView(context(fakeOwned()), parseHash('#/route?to=CuteFox&p=Rare,Rare,知らないパッシブ,Unknown_Passive_X'));
  assert.deepEqual(view.element.querySelectorAll('.passive-remove').map((node) => node.getAttribute('aria-label')), ['希少 を外す', 'Unknown_Passive_X を外す']);
  view.destroy();
});

// ---------------------------------------------------------------------------
// owned-toolbar: 絞り込みの固定パネル・場所のチップ・所持者・効いている条件のチップ・リンク
// ---------------------------------------------------------------------------
const P2 = 'abcd1234-0000-0000-0000-000000000000';
const P3 = '1a2b3c4d-0000-0000-0000-000000000000';
const B1 = 'base-1';
const B2 = 'base-2';
// Alice（ホスト）: パルボックスの a1、拠点 1 に預けた a2、グローバルの gl。Bob: 手持ちの b1、拠点 2 に預けた b2。拠点 1 に置いたタマゴ e1
const holderSnapshot = {
  version: 1, world: { name: 'テスト', hostName: 'Alice' },
  players: [{ uid: P1, name: 'Alice', level: 50 }, { uid: P2, name: 'Bob', level: 40 }],
  bases: [{ id: B1, number: 1 }, { id: B2, number: 2 }],
  pals: [
    { instanceId: 'a1', characterId: 'SheepBall', gender: 'Female', passives: ['Rare'], talent: { hp: 50 }, location: { kind: 'palbox', playerUid: P1, slotIndex: 0 } },
    { instanceId: 'a2', characterId: 'PinkCat', gender: 'Male', passives: [], talent: {}, lastOwnerUid: P1, location: { kind: 'base', baseId: B1 } },
    { instanceId: 'b1', characterId: 'Kitsunebi', gender: 'Male', passives: ['Legend'], talent: {}, location: { kind: 'party', playerUid: P2 } },
    { instanceId: 'b2', characterId: 'Penguin', gender: 'Female', passives: ['Rare', 'Legend'], talent: {}, lastOwnerUid: P2, location: { kind: 'base', baseId: B2 } },
    { instanceId: 'e1', characterId: 'FlowerDoll', passives: [], talent: {}, location: { kind: 'egg-ground', baseId: B1 } },
    { instanceId: 'gl', characterId: 'PinkCat', passives: [], talent: {}, location: { kind: 'global' } },
  ],
  stats: {},
};
const holderData = (snap = holderSnapshot) => ({ version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', hostName: 'Alice', updatedAt: '2026-10-05T00:00:00.000Z' }, snapshot: snap });
const rowIds = (view) => view.element.querySelectorAll('.owned-row').map((row) => row.getAttribute('aria-label'));
const button = (view, label) => view.element.querySelectorAll('button').find((node) => node.textContent === label);
const inputLabeled = (view, label) => view.element.querySelectorAll('input').find((node) => node.getAttribute('aria-label') === label);
const keywordOf = (view) => view.element.querySelectorAll('input').find((node) => node.type === 'search' && node.className !== 'picker-search');
const starsOf = (view) => view.element.querySelectorAll('select').find((node) => node.children.some((child) => child.textContent === '★1 以上'));
const sortOf = (view) => view.element.querySelectorAll('select').find((node) => node.getAttribute('aria-label') === '並べ替え');
const radio = (view, group, value) => view.element.querySelector(`[aria-label="${group}"]`).querySelectorAll('[role="radio"]').find((node) => node.getAttribute('data-value') === value);
const memoryApp = (owned, states = new Map()) => Object.assign(context(owned), {
  viewState(view) { if (!states.has(view)) states.set(view, {}); return states.get(view); },
  replace() {},
});

test('所持パル画面: 絞り込みは sticky のパネル（2 段＋状態の行）にまとめ、パネルの高さを画面の --panel-h に書き続ける', (t) => {
  installDom(t);
  const observer = installResizeObserver(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  const panel = view.element.querySelector('.owned-panel');
  assert.equal(panel.tagName, 'section');
  assert.equal(panel.getAttribute('aria-label'), '所持パルの絞り込み');
  assert.deepEqual(panel.children.map((node) => node.className), ['owned-panel-main', 'owned-panel-sub', 'owned-status-row']);
  // 並び: 見出し → 案内の帯 → パネル → 一覧（件数の行はパネルの中）
  // 列見出しは一覧の入れ物の前の別の要素（owned-rows）
  assert.deepEqual(view.element.children.map((node) => node.className), ['view-heading', 'owned-summary', 'farm-band', 'owned-panel', 'owned-list-head', 'owned-list']);
  assert.ok(panel.querySelector('.owned-status-row').querySelector('.result-note'));
  // 状態の行は [件数][条件のチップ][+n][目標の印][すべて解除][並べ替え]（D31 で「リンクをコピー」は機能ごとなくした）
  assert.deepEqual(panel.querySelector('.owned-status-row').children.map((node) => node.className.split(' ').at(-1)),
    ['owned-count', 'filter-chips', 'filter-more-slot', 'owned-marks-toggle', 'owned-reset', 'owned-fold-all', 'owned-sort-field']);
  assert.doesNotMatch(view.element.textContent, /リンクをコピー/);
  observer.resize(panel, 172.5);
  // 見出しの置き方（D28。理想個体のパネルと同じ部品・同じ決まり）: 1 段目は入力の上の見出しの行（field-head）。パッシブの条件はパッシブの見出しの
  // 行に置き、2 段目に「パッシブ」の見出しを 2 回出さない。2 段目は 2 行（所持者・個体値・★・属性 ／ 場所）で、見出しは入力の左
  const [main, sub] = panel.children;
  const passiveHead = main.querySelector('.passive-selector').children[0];
  assert.equal(passiveHead.className, 'field-head');
  assert.equal(passiveHead.querySelector('.field-label').textContent, 'パッシブ');
  assert.equal(passiveHead.querySelector('[role="radiogroup"]').getAttribute('aria-label'), 'パッシブの条件');
  assert.deepEqual(panel.querySelectorAll('.field-label').filter((node) => node.textContent === 'パッシブ').length, 1);
  assert.deepEqual(sub.children.map((line) => line.className), ['panel-line', 'panel-line']);
  assert.deepEqual(sub.children.map((line) => line.querySelectorAll('.panel-item').map((item) => item.children[0].textContent)),
    [['所持者', '個体値（以上）', '★'], ['場所']]);
  assert.ok(sub.children[0].querySelector('.owned-element-button'));
  // 並べ替えの選択にも見出し（状態の行の中。読み上げの名前は今までどおり「並べ替え」）
  const sortField = panel.querySelector('.owned-status-row').querySelector('.owned-sort-field');
  assert.equal(sortField.querySelector('.field-label').textContent, '並べ替え');
  assert.equal(sortField.querySelector('select').getAttribute('aria-label'), '並べ替え');
  assert.equal(view.element.style.getPropertyValue('--panel-h'), '172.5px');
  view.destroy();
  assert.equal(observer.observed(panel), false);
});

test('所持パル画面: 所持者は理想個体と同じ意味（そのプレイヤーが預けた拠点のパルとホストのグローバルパルボックスも含む）', async (t) => {
  installDom(t);
  const owned = fakeOwned(holderData());
  const view = ownedView(context(owned), parseHash('#/owned'));
  assert.deepEqual(rowIds(view), ['モコロン', 'ツッパニャン', 'ペンタマ', 'キツネビ', 'フラリーナ']);
  assert.deepEqual(holderSelect(view).children.map((node) => [node.value, node.textContent]), [['', 'すべて'], [`player:${P1}`, 'Alice'], [`player:${P2}`, 'Bob']]);
  holderSelect(view).value = `player:${P1}`;
  await holderSelect(view).dispatch('change');
  // 前は所持者がそのプレイヤーの個体（a1）だけだった。拠点 1 に預けた a2 も出る
  assert.deepEqual(rowIds(view), ['モコロン', 'ツッパニャン']);
  assert.equal(view.element.querySelector('.result-note').textContent, '2 / 6 体 · ♂1 ♀1');
  assert.deepEqual(filterChips(view), ['所持者: Alice']);
  // グローバルパルボックスのチップを押すと、理想個体の所持者「Alice」の候補（palsOfPlayers）と同じ個体の集合になる
  await placeChip(view, 'global').dispatch('click');
  const expected = palsOfPlayers(owned.state.owned, new Set([P1])).map((pal) => pal.name).sort();
  assert.deepEqual(rowIds(view).sort(), expected);
  view.destroy();
});

test('所持パル画面: 所持者の選択肢は「すべて・自分のプレイヤー名（自分）・ほかのプレイヤー」で、覚えている条件がなければ自分（D29。前は「自分の個体」と自分のプレイヤーが別に並び、既定は「すべて」）', async (t) => {
  installDom(t);
  const owned = fakeOwned(holderData());
  // 自分は Bob（理想個体と同じ自分の個体: ideals.mine()）
  const ideals = { mine: () => palsOfPlayers(owned.state.owned, new Set([P2])), selfUids: () => new Set([P2]) };
  const states = new Map();
  const view = ownedView({ ...memoryApp(owned, states), ideals }, parseHash('#/owned'));
  document.body.append(view.element);
  assert.deepEqual(holderSelect(view).children.map((node) => [node.value, node.textContent]), [['', 'すべて'], ['mine', 'Bob（自分）'], [`player:${P1}`, 'Alice']]);
  assert.equal(holderSelect(view).value, 'mine');
  assert.deepEqual(rowIds(view), ['ペンタマ', 'キツネビ']);
  assert.equal(states.get('owned').filter.holder, 'mine');
  // 既定なので条件のチップは出さない
  assert.deepEqual(filterChips(view), []);
  // 「すべて」は既定と違うので条件のチップに出し、× で既定（自分）に戻す
  holderSelect(view).value = '';
  await holderSelect(view).dispatch('change');
  assert.equal(rowIds(view).length, 5);
  assert.deepEqual(filterChips(view), ['所持者: すべて']);
  // チップの × は飾り（aria-hidden）の SVG のアイコン（ui/icons.js の close。パッシブのチップの × と同じ）。名前はチップの aria-label
  const chipX = view.element.querySelector('.filter-chips').querySelector('.filter-chip-x');
  assert.equal(chipX.getAttribute('aria-hidden'), 'true');
  assert.equal(chipX.textContent, '');
  assert.equal(chipX.querySelector('svg').getAttribute('class'), 'close-icon');
  assert.equal(view.element.querySelector('.filter-chips').querySelector('.filter-chip').getAttribute('aria-label'), '所持者: すべて を外す');
  await view.element.querySelector('.filter-chips').querySelector('.filter-chip').dispatch('click');
  assert.equal(holderSelect(view).value, 'mine');
  assert.deepEqual(rowIds(view), ['ペンタマ', 'キツネビ']);
  // ほかのプレイヤーを選んで「すべて解除」しても自分に戻す
  holderSelect(view).value = `player:${P1}`;
  await holderSelect(view).dispatch('change');
  assert.deepEqual(filterChips(view), ['所持者: Alice']);
  await button(view, 'すべて解除').dispatch('click');
  assert.equal(holderSelect(view).value, 'mine');
  view.destroy();
  // 前の保存・URL の自分の player:<uid> と mine は、どちらも自分の選択肢として読む（自分の UID が複数でも、自分の選択肢は 1 つ）
  for (const hash of [`#/owned?holder=player:${P2}`, '#/owned?holder=mine']) {
    const opened = ownedView({ ...context(owned), ideals }, parseHash(hash));
    assert.equal(holderSelect(opened).value, 'mine', hash);
    assert.deepEqual(rowIds(opened), ['ペンタマ', 'キツネビ'], hash);
    assert.deepEqual(filterChips(opened), [], hash);
    opened.destroy();
  }
  // 絞り込みの名前のある URL で所持者がないときは、前と同じ「すべて」（前に写したリンク・場所の分からないパルの「見る」の意味を変えない）
  const linked = ownedView({ ...context(owned), ideals }, parseHash('#/owned?place=palbox,base'));
  assert.equal(holderSelect(linked).value, '');
  assert.deepEqual(filterChips(linked), ['所持者: すべて', '場所: パルボックス・拠点']);
  linked.destroy();
});

test('所持パル画面: 自分のプレイヤーが分からない（参加している人で「自分」が未設定など）ときは「すべて」にし、自分の選択肢は出さない（0 件にしない。D29）', async (t) => {
  installDom(t);
  const ideals = { mine: () => null, selfUids: () => new Set() };
  const view = ownedView({ ...context(fakeOwned(holderData())), ideals }, parseHash('#/owned'));
  assert.deepEqual(holderSelect(view).children.map((node) => [node.value, node.textContent]), [['', 'すべて'], [`player:${P1}`, 'Alice'], [`player:${P2}`, 'Bob']]);
  assert.equal(holderSelect(view).value, '');
  assert.equal(rowIds(view).length, 5);
  assert.deepEqual(filterChips(view), []);
  assert.doesNotMatch(view.element.querySelector('.result-note').textContent, /分かりません/);
  view.destroy();
});

test('所持パル画面: 自分のプレイヤーが後から分かったら（ログインの ID・ユーザーの一覧が届いた）、所持者の選択肢と一覧を描き直す', async (t) => {
  installDom(t);
  const owned = fakeOwned(holderData());
  let self = new Set();
  const ideals = { mine: () => (self.size ? palsOfPlayers(owned.state.owned, self) : null), selfUids: () => self };
  const listeners = new Set();
  const app = context(owned);
  app.store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const view = ownedView({ ...app, ideals }, parseHash('#/owned'));
  assert.equal(rowIds(view).length, 5);
  self = new Set([P2]);
  for (const listener of listeners) listener(app.store.state);
  assert.equal(holderSelect(view).value, 'mine');
  assert.deepEqual(rowIds(view), ['ペンタマ', 'キツネビ']);
  view.destroy();
  assert.equal(listeners.size, 0);
});

test('所持パル画面: 同じ名前のプレイヤーが 2 人以上いれば、所持者の名前に UID の頭 8 字を添える', (t) => {
  installDom(t);
  const snap = { ...holderSnapshot, players: [...holderSnapshot.players, { uid: P3, name: 'Alice', level: 3 }] };
  const view = ownedView(context(fakeOwned(holderData(snap))), parseHash('#/owned'));
  assert.deepEqual(holderSelect(view).children.map((node) => node.textContent), ['すべて', 'Alice（00000000）', 'Bob', 'Alice（1A2B3C4D）']);
  view.destroy();
});

test('所持パル画面: 場所のチップは件数を出さず、件数 0 の場所は出さない。拠点の ▾（拠点ごとのチェックの板）はない（D29。拠点のチップと違いが分からないため）', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned(holderData())), parseHash('#/owned'));
  document.body.append(view.element);
  assert.deepEqual(placeChips(view), [
    ['party', 'true', '手持ち'], ['palbox', 'true', 'パルボックス'], ['base', 'true', '拠点'], ['global', 'false', 'グローバルパルボックス'], ['egg', 'true', 'タマゴ'],
  ]);
  assert.deepEqual(['dps', 'unknown'].map((group) => placeChip(view, group).hidden), [true, true]);
  // 読み上げの名前も見えている文字だけ（前は「パルボックス（1 体）」）
  assert.equal(placeChip(view, 'palbox').getAttribute('aria-label'), null);
  // 拠点が 2 つあっても、拠点のチップの右に ▾ は出さない
  assert.equal(view.element.querySelector('.place-chip-more'), null);
  assert.equal(view.element.querySelector('.place-bases'), null);
  // 拠点のチップは、どの拠点の個体も（拠点に置いたタマゴはタマゴのチップ）
  await placeChip(view, 'palbox').dispatch('click');
  await placeChip(view, 'party').dispatch('click');
  await placeChip(view, 'egg').dispatch('click');
  assert.deepEqual(rowIds(view).sort(), ['ツッパニャン', 'ペンタマ'].sort());
  view.destroy();
});

test('所持パル画面: 属性は ▾ で開くトグルで選び、2 つ選ぶとどちらかを持つ個体（OR）。ボタンには選んだ数を出し、名前は aria-label と条件のチップに出す', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned(holderData())), parseHash('#/owned'));
  document.body.append(view.element);
  const open = view.element.querySelector('.owned-element-button');
  assert.equal(open.getAttribute('aria-haspopup'), 'dialog');
  await open.dispatch('click');
  const toggle = (key) => view.element.querySelectorAll('.element-toggle').find((node) => node.getAttribute('data-value') === key);
  assert.equal(view.element.querySelectorAll('.element-toggle').length, 9);
  await toggle('Fire').dispatch('click');
  assert.equal(toggle('Fire').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(rowIds(view), ['キツネビ']);
  await toggle('Ice').dispatch('click');
  assert.deepEqual(rowIds(view), ['ペンタマ', 'キツネビ']);
  assert.equal(open.querySelector('.owned-element-count').textContent, '2');
  assert.equal(open.getAttribute('aria-label'), '属性: 炎・氷');
  assert.deepEqual(filterChips(view), ['属性: 炎・氷']);
  view.destroy();
});

test('所持パル画面: パッシブの条件「なし」はパッシブが 0 個の個体だけで、パッシブの欄を押せなくする。「だけ」はほかを持たない個体', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  document.body.append(view.element);
  // 押しボタンの名前は理想個体の「全部持つ／だけ」とそろえる（A9。1100px でパネルの 2 段目は折り返さない）
  assert.deepEqual(['include', 'only', 'none'].map((value) => radio(view, 'パッシブの条件', value).textContent), ['全部持つ', 'だけ', 'なし']);
  await pickPassive(view, 'CraftSpeed_up2');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 2);
  await radio(view, 'パッシブの条件', 'none').dispatch('click');
  // パッシブのない b だけ（g はグローバル）
  assert.deepEqual(rowIds(view), ['ツッパニャン']);
  assert.equal(passiveAdd(view).disabled, true);
  assert.deepEqual(filterChips(view), ['パッシブなし']);
  await radio(view, 'パッシブの条件', 'only').dispatch('click');
  assert.equal(passiveAdd(view).disabled, false);
  // 職人気質だけを持つのはタマゴの c（a は希少も持つ）
  assert.deepEqual(rowIds(view), ['フラリーナ']);
  assert.deepEqual(filterChips(view), ['パッシブ: 職人気質', 'パッシブの条件: だけ']);
  view.destroy();
});

test('所持パル画面: 効いている条件のチップの × は、その条件だけを既定に戻し、部品の表示もそろえる。何もなければ「すべて解除」は押せない', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  document.body.append(view.element);
  assert.deepEqual(filterChips(view), []);
  assert.equal(button(view, 'すべて解除').disabled, true);
  // 押せない理由（setDisabled の title）。押せるようになったら消す
  assert.equal(button(view, 'すべて解除').title, '既定から変えた条件はありません');
  starsOf(view).value = '1';
  await starsOf(view).dispatch('change');
  inputLabeled(view, 'HPの個体値（以上）').value = '10';
  await inputLabeled(view, 'HPの個体値（以上）').dispatch('input');
  await pickPassive(view, 'CraftSpeed_up2');
  keywordOf(view).value = 'もこ';
  await keywordOf(view).dispatch('input');
  assert.deepEqual(filterChips(view), ['パッシブ: 職人気質', '★1 以上', 'HP 10 以上', 'キーワード: もこ']);
  assert.equal(button(view, 'すべて解除').disabled, false);
  assert.equal(button(view, 'すべて解除').title, '');
  const chip = (text) => view.element.querySelectorAll('.filter-chip').find((node) => node.querySelector('.filter-chip-text').textContent === text);
  assert.equal(chip('HP 10 以上').getAttribute('aria-label'), 'HP 10 以上 を外す');
  await chip('HP 10 以上').dispatch('click');
  assert.deepEqual(filterChips(view), ['パッシブ: 職人気質', '★1 以上', 'キーワード: もこ']);
  assert.equal(inputLabeled(view, 'HPの個体値（以上）').value, '');
  assert.equal(inputLabeled(view, 'HPを条件にする').checked, false);
  assert.equal(starsOf(view).value, '1');
  await chip('パッシブ: 職人気質').dispatch('click');
  assert.equal(view.element.querySelector('.passive-chips').querySelectorAll('.passive-chip').length, 0);
  await chip('キーワード: もこ').dispatch('click');
  assert.equal(keywordOf(view).value, '');
  await chip('★1 以上').dispatch('click');
  assert.equal(starsOf(view).value, '');
  assert.deepEqual(filterChips(view), []);
  assert.equal(view.element.querySelectorAll('.owned-row').length, 3);
  view.destroy();
});

test('所持パル画面: 「すべて解除」と 0 件のときの「条件をすべて解除」で既定に戻し、作ったときに値を入れた部品（キーワード・パル・★・個体値）もそろえる', async (t) => {
  installDom(t);
  const owned = fakeOwned(holderData());
  const view = ownedView(context(owned), parseHash(`#/owned?pal=PinkCat&q=ツッパ&stars=1&hp=10&el=Neutral&pm=only&holder=player:${P1}&place=palbox,base`));
  document.body.append(view.element);
  assert.deepEqual(rowIds(view), []);
  assert.match(view.element.querySelector('.owned-list').textContent, /条件に合うパルはいません/);
  // 0 件の空の表示に解除のボタン
  const reset = view.element.querySelector('.owned-list').querySelector('button');
  assert.equal(reset.textContent, '条件をすべて解除');
  await reset.dispatch('click');
  assert.equal(view.element.querySelectorAll('.owned-row').length, 5);
  const shown = () => ({
    keyword: keywordOf(view).value, stars: starsOf(view).value, hp: inputLabeled(view, 'HPの個体値（以上）').value,
    pal: view.element.querySelector('.picker-trigger').getAttribute('aria-label'), mode: radio(view, 'パッシブの条件', 'include').getAttribute('aria-checked'),
    holder: holderSelect(view).value, places: placeChips(view).map(([group, pressed]) => `${group}:${pressed}`).join(','), chips: filterChips(view),
  });
  const expected = { keyword: '', stars: '', hp: '', pal: 'パル: パルを選択', mode: 'true', holder: '', places: 'party:true,palbox:true,base:true,global:false,egg:true', chips: [] };
  assert.deepEqual(shown(), expected);
  // 「すべて解除」も同じ（並べ替えは条件ではないので残す）
  view.applyRoute(parseHash('#/owned?pal=PinkCat&q=ツッパ&stars=1&hp=10&sort=level'), { reason: 'navigate' });
  assert.equal(view.element.querySelectorAll('.owned-row').length, 0);
  await button(view, 'すべて解除').dispatch('click');
  assert.deepEqual(shown(), expected);
  assert.equal(sortOf(view).value, 'level');
  view.destroy();
});

test('所持パル画面: 古い保存の条件（タマゴ・グローバルのチェック、所持者の拠点・グローバル、場所の 1 つ）と古い URL を読み替える（migrateFilter）', (t) => {
  installDom(t);
  const pick = (filter) => ({ holder: filter.holder, places: filter.places, bases: 'bases' in filter });
  // 観賞用ケージ（display）は save-extras で足した場所（拠点の次）
  const all = ['party', 'palbox', 'base', 'display', 'dps', 'global', 'egg', 'unknown'];
  assert.deepEqual(DEFAULT_PLACES, ['party', 'palbox', 'base', 'display', 'dps', 'egg', 'unknown']);
  assert.deepEqual(migrateFilter({}).places, DEFAULT_PLACES);
  assert.deepEqual(migrateFilter({ place: 'egg' }).places, ['egg']);
  assert.deepEqual(migrateFilter({ place: '' }).places, DEFAULT_PLACES);
  assert.deepEqual(migrateFilter({ eggs: false }).places, ['party', 'palbox', 'base', 'display', 'dps', 'unknown']);
  assert.deepEqual(migrateFilter({ globals: true }).places, all);
  // 矛盾した古い組み合わせ（場所「タマゴ」でタマゴを隠す・場所「グローバル」でグローバルを出さない）は 0 件にせず、
  // 場所を選んでいない既定（タマゴ・グローバルの表示はそのまま）に戻す（B14。前は places が [] で 0 件だった）
  assert.deepEqual(migrateFilter({ place: 'egg', eggs: false }).places, ['party', 'palbox', 'base', 'display', 'dps', 'unknown']);
  assert.deepEqual(migrateFilter({ place: 'global', globals: false }).places, DEFAULT_PLACES);
  assert.deepEqual(migrateFilter({ place: 'global' }).places, DEFAULT_PLACES);
  assert.deepEqual(migrateFilter({ place: 'global', globals: true }).places, ['global']);
  // 所持者の拠点（base:<id>）は、場所を「拠点＋タマゴ」にするだけ（D29 で拠点ごとの絞り込み〔bases〕をなくした。前は bases: [id]）
  assert.deepEqual(pick(migrateFilter({ holder: `base:${B1}` })), { holder: '', places: ['base', 'egg'], bases: false });
  assert.deepEqual(pick(migrateFilter({ holder: `base:${B1}`, eggs: false })), { holder: '', places: ['base'], bases: false });
  assert.deepEqual(pick(migrateFilter({ holder: 'global', globals: true })), { holder: '', places: ['global'], bases: false });
  // D29 より前の保存の拠点（bases）は、場所を拠点とタマゴの中だけにする（選んでいた場所に拠点・タマゴがなければ「拠点＋タマゴ」）
  assert.deepEqual(pick(migrateFilter({ places: DEFAULT_PLACES, bases: [B1] })), { holder: 'mine', places: ['base', 'egg'], bases: false });
  assert.deepEqual(pick(migrateFilter({ places: ['palbox', 'base'], bases: [B1] })), { holder: 'mine', places: ['base'], bases: false });
  assert.deepEqual(pick(migrateFilter({ places: ['palbox'], bases: [B1] })), { holder: 'mine', places: ['base', 'egg'], bases: false });
  assert.deepEqual(pick(migrateFilter({ places: ['palbox'], bases: [] })), { holder: 'mine', places: ['palbox'], bases: false });
  assert.equal(migrateFilter({ holder: `player:${P1}` }).holder, `player:${P1}`);
  // 新しい形はそのまま（古い項目は持たない。場所は決まった順に並べる。壊れた値は既定）
  assert.deepEqual(migrateFilter({ holder: 'mine', places: ['egg', 'palbox', 'xxx'], elements: ['Fire', 'Bad'], passiveMode: 'none', query: 'x', eggs: false }), {
    holder: 'mine', places: ['palbox', 'egg'], placesVersion: 2, elements: ['Fire'], palId: '', passives: [], passiveMode: 'none', query: 'x', sort: 'dex', dir: 'asc', stars: 0, talent: { hp: 0, shot: 0, defense: 0 },
  });
  // 観賞用ケージ（display）を足す前の版の既定（グローバル以外のすべて）・すべての場所の保存とリンクは、display を足して読み替える
  //（前は「不明」として出ていたケージの個体が消えないように。save-extras・Codex のレビュー）。版 2 の条件で利用者がケージだけを外したものはそのまま
  const legacyDefault = ['party', 'palbox', 'base', 'dps', 'egg', 'unknown'];
  assert.deepEqual(migrateFilter({ places: legacyDefault }).places, DEFAULT_PLACES);
  assert.deepEqual(migrateFilter({ places: [...legacyDefault, 'global'] }).places, all);
  assert.deepEqual(migrateFilter({ places: legacyDefault, placesVersion: 2 }).places, legacyDefault);
  assert.deepEqual(migrateFilter({ places: ['palbox', 'base'] }).places, ['palbox', 'base']);
  assert.deepEqual(filterFromParams(new URLSearchParams('place=party,palbox,base,dps,egg,unknown')).places, DEFAULT_PLACES);
  assert.deepEqual(cleanSaved({ places: legacyDefault, placesVersion: 1 }, OWNED_MEMORY).placesVersion, undefined);
  // 覚えている条件がないときの所持者は自分（mine。D29 で「すべて」から変えた）。自分のプレイヤーが分からなければ画面は「すべて」として扱う
  assert.deepEqual(migrateFilter(null), {
    holder: 'mine', places: DEFAULT_PLACES, placesVersion: 2, elements: [], palId: '', passives: [], passiveMode: 'include', query: '', sort: 'dex', dir: 'asc', stars: 0, talent: { hp: 0, shot: 0, defense: 0 },
  });
  // 旧コードの保存（タブを切り替えて戻った viewState）から開く: 所持者「拠点 1」・タマゴを隠す・グローバルを表示 → 場所「拠点」（どの拠点も）
  const states = new Map([['owned', { filter: { holder: `base:${B1}`, place: '', palId: '', passives: [], query: '', sort: 'dex', eggs: false, globals: true, stars: 0, talent: { hp: 0, shot: 0, defense: 0 } } }]]);
  const view = ownedView(memoryApp(fakeOwned(holderData()), states), parseHash('#/owned'));
  assert.deepEqual(rowIds(view).sort(), ['ツッパニャン', 'ペンタマ'].sort());
  assert.deepEqual(filterChips(view), ['場所: 拠点']);
  assert.equal(holderSelect(view).value, '');
  assert.equal('eggs' in states.get('owned').filter, false);
  assert.equal('bases' in states.get('owned').filter, false);
  view.destroy();
  // 旧コードのタブが作ったリンク（所持者の拠点・グローバル・場所の 1 つ）
  // 拠点の指定（所持者の base:<id>・D29 より前の base=）は、場所を拠点とタマゴにするだけ（どの拠点も）
  for (const [hash, expected] of [[`#/owned?holder=base:${B1}`, ['ツッパニャン', 'ペンタマ', 'フラリーナ']], ['#/owned?holder=global', ['ツッパニャン']], ['#/owned?place=egg', ['フラリーナ']], [`#/owned?holder=player:${P2}`, ['ペンタマ', 'キツネビ']],
    [`#/owned?base=${B1}`, ['ツッパニャン', 'ペンタマ', 'フラリーナ']], [`#/owned?place=palbox,base&base=${B1}`, ['ツッパニャン', 'ペンタマ']]]) {
    const old = ownedView(context(fakeOwned(holderData())), parseHash(hash));
    assert.deepEqual(rowIds(old).sort(), expected.sort(), hash);
    old.destroy();
  }
});

test('所持パル画面: URL の値は確かめてから使い、知らない場所・属性・範囲の外の数・知らないパルは捨てる', (t) => {
  installDom(t);
  const states = new Map();
  const view = ownedView(memoryApp(fakeOwned(holderData()), states), parseHash(`#/owned?place=egg,xxx&el=Fire,Bad&stars=9&hp=150&at=90&pm=bad&pal=Nope&p=Rare,知らない&q=${'あ'.repeat(120)}&sort=zzz&base=${'x'.repeat(41)},${B1}`));
  const filter = states.get('owned').filter;
  assert.deepEqual(filter.places, ['egg']);
  assert.deepEqual(filter.elements, ['Fire']);
  // 拠点（base）は場所の読み替えにだけ使い、条件には残さない（D29）
  assert.equal('bases' in filter, false);
  assert.equal(filter.stars, 0);
  assert.deepEqual(filter.talent, { hp: 0, shot: 90, defense: 0 });
  assert.equal(filter.passiveMode, 'include');
  assert.equal(filter.palId, '');
  assert.deepEqual(filter.passives, ['Rare']);
  assert.equal(filter.query.length, 100);
  assert.equal(filter.sort, 'dex');
  view.destroy();
});

test('所持パル画面: 利用者が条件を変えたら（キーワードは間引いた後に 1 回）、一覧の先頭がパネルの下に隠れているときだけ一覧の先頭を見せる。データの更新では動かさない', async (t) => {
  installDom(t);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned'));
  const list = view.element.querySelector('.owned-list');
  const panel = view.element.querySelector('.owned-panel');
  let shown = 0;
  list.scrollIntoView = (options) => { assert.deepEqual(options, { block: 'start' }); shown++; };
  // 一覧の先頭（top 200）がパネルの下端（252）より上
  await placeChip(view, 'egg').dispatch('click');
  assert.equal(shown, 1);
  keywordOf(view).value = 'もこ';
  await keywordOf(view).dispatch('input');
  assert.equal(shown, 2);
  owned.state.owned = normalizeOwned(snapshot, { pals, passives });
  owned.emit();
  assert.equal(shown, 2);
  // 一覧の先頭が固定の部分（パネルと、貼り付いた列見出し〔高さ 52〕）の下にあれば動かさない
  panel.getBoundingClientRect = () => ({ top: 56, bottom: 140, left: 0, width: 900 });
  await placeChip(view, 'egg').dispatch('click');
  assert.equal(shown, 2);
  view.destroy();
});

test('所持パル画面: パルを選ぶと「理想個体 →」（正のランクのパッシブだけを渡す）をパルの見出しの行に、パッシブを選ぶと「継承ルート →」をパッシブの見出しの行に出す', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  const links = () => view.element.querySelectorAll('.owned-panel-link').filter((node) => !node.hidden).map((node) => [node.textContent, node.href, node.getAttribute('aria-label')]);
  assert.deepEqual(links(), []);
  view.applyRoute(parseHash('#/owned?pal=SheepBall&p=Rare,Deffence_down1'), { reason: 'navigate' });
  assert.deepEqual(links(), [
    ['理想個体 →', '#/ideal?to=SheepBall&p=Rare', 'この条件で理想個体を開く'],
    ['継承ルート →', '#/route?p=Rare%2CDeffence_down1', 'このパッシブを運ぶ継承ルートを開く'],
  ]);
  // 置き場所は、もとにした欄の見出しの行（D28。前は状態の行の右端で、条件のチップの場所を狭めていた）
  const main = view.element.querySelector('.owned-panel-main');
  assert.equal(main.querySelector('.picker').children[0].querySelector('.owned-panel-link').textContent, '理想個体 →');
  assert.equal(main.querySelector('.passive-selector').children[0].querySelector('.owned-panel-link').textContent, '継承ルート →');
  assert.equal(view.element.querySelector('.owned-status-row').querySelector('.owned-panel-link'), null);
  // パッシブの条件「なし」では継承ルートへのリンクを出さない
  await radio(view, 'パッシブの条件', 'none').dispatch('click');
  assert.deepEqual(links().map(([text]) => text), ['理想個体 →']);
  view.destroy();
});

// ---------------------------------------------------------------------------
// owned-rows: 列見出し・4 セル・固定枠・行の操作・目標の印
// ---------------------------------------------------------------------------
const headButton = (view, key) => view.element.querySelector('.owned-list-head').querySelectorAll('button').find((node) => node.getAttribute('data-value') === key);
// HP の個体値の並び（行の 4 セルの最初のセル）
const hpOrder = (view) => view.element.querySelectorAll('.owned-row').map((row) => Number(row.querySelector('.talent-cell').textContent));

test('所持パル画面: 列見出しは一覧の前の別の要素（toolbar）で、「HP」を押すと HP の高い順、もう一度で低い順。並べ替えの選択とそろい、URL にも載る', async (t) => {
  installDom(t);
  const sheep = (instanceId, hp) => ({ instanceId, characterId: 'SheepBall', gender: 'Male', level: 5, passives: [], talent: { hp, shot: 10, defense: 10 }, location: { kind: 'palbox', playerUid: P1 } });
  const states = new Map();
  const view = ownedView(memoryApp(fakeOwned(manyData(0, [sheep('m', 50), sheep('h', 90), sheep('l', 10)])), states), parseHash('#/owned'));
  const head = view.element.querySelector('.owned-list-head');
  // 名前は状態の行の選択（並べ替え）と分ける（B13。前はどちらも「並べ替え」）
  assert.deepEqual([head.getAttribute('role'), head.getAttribute('aria-label')], ['toolbar', '列見出しで並べ替え']);
  // 列見出しは syncList の行に混ぜない（一覧の入れ物の外）
  assert.equal(view.element.querySelector('.owned-list').querySelector('.owned-list-head'), null);
  assert.deepEqual(head.querySelectorAll('button').map((node) => node.getAttribute('data-value')), ['dex', 'level', 'stars', 'passives', 'hp', 'shot', 'defense', 'talent', 'place']);
  // 押している見出しだけが Tab で止まる（aria-pressed と、向きまで書いた名前）
  assert.deepEqual([headButton(view, 'dex').getAttribute('aria-pressed'), headButton(view, 'dex').tabIndex, headButton(view, 'hp').tabIndex], ['true', 0, -1]);
  assert.equal(headButton(view, 'hp').getAttribute('aria-label'), 'HP の個体値で並べ替え（高い順）');
  // 同じ意味は同じ言い方（列見出しは「〈名前〉で並べ替え（〈向き〉）」、選択は「〈名前〉が〈向き〉」。A9）
  assert.equal(headButton(view, 'passives').getAttribute('aria-label'), 'パッシブのランクで並べ替え（高い順）');
  assert.equal(headButton(view, 'place').getAttribute('aria-label'), '所持者・場所で並べ替え（ボックス順）');
  assert.deepEqual(sortOf(view).children.map((node) => node.textContent), ['図鑑番号順', '入手の新しい順', 'パッシブのランクが高い順', 'レベルが高い順', 'パル濃縮（★）が多い順',
    '個体値の合計が高い順', '個体値の合計が低い順', 'HP の個体値が高い順', '攻撃の個体値が高い順', '防御の個体値が高い順', 'ボックス順']);
  await headButton(view, 'hp').dispatch('click');
  assert.deepEqual(hpOrder(view), [90, 50, 10]);
  assert.deepEqual([headButton(view, 'hp').getAttribute('aria-pressed'), headButton(view, 'dex').getAttribute('aria-pressed')], ['true', 'false']);
  assert.equal(sortOf(view).value, 'hp');
  assert.deepEqual([states.get('owned').filter.sort, states.get('owned').filter.dir], ['hp', 'desc']);
  // もう一度押すと低い順。選択にもその向きの選択肢が（選んでいる間だけ）出る
  await headButton(view, 'hp').dispatch('click');
  assert.deepEqual(hpOrder(view), [10, 50, 90]);
  assert.equal(headButton(view, 'hp').getAttribute('aria-label'), 'HP の個体値で並べ替え（低い順）');
  assert.equal(headButton(view, 'hp').querySelector('.owned-head-arrow').textContent, '▲');
  assert.equal(sortOf(view).value, 'hp:asc');
  assert.equal(sortOf(view).children.find((node) => node.value === 'hp:asc').textContent, 'HP の個体値が低い順');
  // 選択で選び直すと、見出しもそろう（反対の向きの選択肢は消える）
  sortOf(view).value = 'level';
  await sortOf(view).dispatch('change');
  assert.equal(headButton(view, 'level').getAttribute('aria-pressed'), 'true');
  assert.equal(sortOf(view).children.some((node) => node.value === 'hp:asc'), false);
  // ←→ で見出しの間を移る（タブの止まり先も移る）
  headButton(view, 'level').focus();
  await head.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(document.activeElement, headButton(view, 'stars'));
  assert.deepEqual([headButton(view, 'stars').tabIndex, headButton(view, 'level').tabIndex], [0, -1]);
  view.destroy();
  // URL の並べ替え（sort・dir）。前の値 sort=talent-low は個体値の合計の低い順
  const fromUrl = ownedView(memoryApp(fakeOwned(manyData(0, [sheep('m', 50), sheep('h', 90), sheep('l', 10)])), new Map()), parseHash('#/owned?sort=hp&dir=asc'));
  assert.deepEqual(hpOrder(fromUrl), [10, 50, 90]);
  fromUrl.applyRoute(parseHash('#/owned?sort=talent-low'), { reason: 'navigate' });
  assert.equal(sortOf(fromUrl).value, 'talent:asc');
  assert.deepEqual(hpOrder(fromUrl), [10, 50, 90]);
  fromUrl.destroy();
  // 前の viewState（sort: talent-low・向きなし）も読み替える
  assert.deepEqual([migrateFilter({ sort: 'talent-low' }).sort, migrateFilter({ sort: 'talent-low' }).dir], ['talent', 'asc']);
  assert.equal(migrateFilter({ sort: 'hp' }).dir, 'desc');
});

test('所持パル画面: 行は固定の枠。パッシブ 5 個以上は 3 個と「+N」（押すと残りを板に出す）、拠点の個体は拠点の名前と預けた人の 1 行、パッシブなしは文字を出さない', async (t) => {
  const { body } = installDom(t);
  const many = ['Rare', 'Legend', 'CraftSpeed_up2', 'Noukin', 'Deffence_down1'];
  const snap = { ...holderSnapshot, pals: [
    ...holderSnapshot.pals,
    { instanceId: 'five', characterId: 'Kitsunebi', gender: 'Female', passives: many, talent: {}, location: { kind: 'party', playerUid: P1 } },
  ] };
  const view = ownedView(context(fakeOwned(holderData(snap))), parseHash('#/owned'));
  body.append(view.element);
  const rows = () => view.element.querySelectorAll('.owned-row');
  const five = rows().find((node) => node.querySelectorAll('.passive-chip').length === 3);
  // ランクの高い順（希少 4・伝説 4 は保存の順、職人気質 3）に 3 個と「+2」
  assert.deepEqual(five.querySelectorAll('.passive-chip').map((node) => node.textContent), ['希少', '伝説', '職人気質']);
  const more = five.querySelector('.passive-more');
  // 読み上げの名前にも見えている「+2」を入れる（B13。前は「ほかのパッシブ 2 個」）
  assert.deepEqual([more.textContent, more.getAttribute('aria-label'), more.title], ['+2', '+2（ほかのパッシブ 2 個）', '脳筋\nうたれ弱い']);
  await more.dispatch('click');
  const board = body.querySelector('.hint-popover');
  assert.deepEqual(board.querySelectorAll('.passive-chip').map((node) => node.textContent), ['脳筋', 'うたれ弱い']);
  // 拠点の個体は「拠点 1」と「Alice が預けた」だけ（前は 拠点 1／拠点 1／預けた人 Alice の 3 行）
  const based = rows().find((node) => node.getAttribute('aria-label') === 'ツッパニャン' && /拠点 1/.test(node.textContent));
  assert.deepEqual(based.querySelector('.owned-where').children.map((node) => node.textContent), ['拠点 1', 'Alice が預けた']);
  // 拠点に置いたタマゴは拠点と場所。パッシブなしは枠だけ（「パッシブなし」の文字は出さない）
  const egg = rows().find((node) => node.querySelector('.badge-egg'));
  assert.deepEqual(egg.querySelector('.owned-where').children.map((node) => node.textContent), ['拠点 1', 'タマゴ（地面）・拠点 1']);
  assert.doesNotMatch(view.element.querySelector('.owned-list').textContent, /パッシブなし/);
  assert.equal(based.querySelectorAll('.passive-chip').length, 0);
  view.destroy();
  // 画面を閉じると、開いていた「+N」の板も閉じる
  assert.equal(body.querySelector('.hint-popover'), null);
});

test('所持パル画面: 行に操作のボタンは出さない（D29。前は触れた行に「親にして検索」。パル名のリンクからパル詳細へ進め、親・逆引き・継承ルートの検索はフェーズ 3 の個体の詳細にまとめる）', async (t) => {
  installDom(t);
  const owned = await import('../../web/js/views/owned.js');
  assert.equal('ownedRowLinks' in owned, false);
  const view = ownedView(context(fakeOwned(holderData())), parseHash('#/owned'));
  document.body.append(view.element);
  const list = view.element.querySelector('.owned-list');
  const target = list.querySelectorAll('.owned-row').find((node) => /キツネビ/.test(node.getAttribute('aria-label')));
  const link = target.querySelector('[data-focus="pal"]');
  link.focus();
  await list.dispatch('focusin', { target: link });
  await list.dispatch('pointerover', { target: target.querySelector('.owned-talent') });
  assert.equal(list.querySelectorAll('.owned-row-actions').length, 0);
  assert.equal(list.querySelectorAll('.owned-row-action').length, 0);
  // パル名はパル詳細（配合の親・子の一覧がある）へのリンク
  assert.equal(link.href, '#/pal/Kitsunebi');
  view.destroy();
});

test('所持パル画面: 保存した目標の印（完成品・欲しいパッシブ）を行の下の段に出し（D25。前は名前の下）、キーワードで印の文字も探せる。「目標の印」で隠せ、目標がなければ切り替えも出さない', async (t) => {
  installDom(t);
  let goals = [
    { id: 'g1', name: 'モコロンの理想', palId: 'SheepBall', passives: ['Rare'], mode: 'include', targets: { hp: 50, shot: 0, defense: 0 } },
    { id: 'g2', name: 'ペンタマ', palId: 'Penguin', passives: ['Rare', 'CraftSpeed_up2'], mode: 'include', targets: { hp: 0, shot: 0, defense: 0 } },
  ];
  const listeners = new Set();
  const ideals = { list: () => goals, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, mine: () => [], selfUids: () => new Set() };
  const states = new Map();
  const view = ownedView({ ...memoryApp(fakeOwned(holderData()), states), ideals }, parseHash('#/owned'));
  const rowOf = (pattern) => view.element.querySelectorAll('.owned-row').find((node) => pattern.test(node.getAttribute('aria-label')));
  const marksOf = (pattern) => rowOf(pattern)?.querySelector('.owned-band')?.querySelectorAll('.badge-mark').map((node) => node.textContent) ?? [];
  // モコロン（希少・HP 50）は完成品、ペンタマ（希少・伝説）は欲しいパッシブを持つ
  assert.deepEqual(marksOf(/モコロン/), ['完成品: モコロンの理想']);
  assert.deepEqual(marksOf(/ペンタマ/), ['ペンタマの欲しいパッシブ']);
  assert.deepEqual(marksOf(/キツネビ/), []);
  const toggle = view.element.querySelector('.owned-marks-toggle');
  assert.equal(toggle.hidden, false);
  assert.match(toggle.title, /^保存した目標の完成品と/);
  // キーワード「完成品」で印の文字も探す
  keywordOf(view).value = '完成品';
  await keywordOf(view).dispatch('input');
  assert.deepEqual(rowIds(view), ['モコロン']);
  // 「目標の印」を外すと印を出さず、印では探さない（viewState に覚える）
  const check = toggle.querySelector('input');
  check.checked = false;
  await check.dispatch('change');
  assert.equal(states.get('owned').showMarks, false);
  assert.equal(view.element.querySelectorAll('.badge-mark').length, 0);
  assert.deepEqual(rowIds(view), []);
  check.checked = true;
  await check.dispatch('change');
  keywordOf(view).value = '';
  await keywordOf(view).dispatch('input');
  // 目標を外すと（ideals の通知）印も消え、目標が 0 件なら切り替えを隠す。行の要素は使い回す（印のセルだけ書き換える）
  const row = rowOf(/モコロン/);
  goals = [];
  for (const listener of listeners) listener();
  assert.equal(view.element.querySelectorAll('.badge-mark').length, 0);
  assert.equal(toggle.hidden, true);
  assert.equal(rowOf(/モコロン/), row);
  view.destroy();
  assert.equal(listeners.size, 0);
});

// ---- フェーズ 1b・1c の終わりのレビューの直し（所持パルの行。B2・B5・B12） ----

const goalsStore = (initial) => {
  let goals = initial;
  const listeners = new Set();
  return {
    set(next) { goals = next; for (const listener of listeners) listener(); },
    listeners,
    ideals: { list: () => goals, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, mine: () => [], selfUids: () => new Set() },
  };
};
const rareGoals = (count) => Array.from({ length: count }, (_, i) => ({
  id: `g${i}`, name: `目標${i + 1}`, palId: 'SheepBall', passives: ['Rare'], mode: 'include', targets: { hp: i % 2 ? 0 : 50, shot: 0, defense: 0 },
}));

test('所持パル画面: 目標の印は行の下の段に 4 個と「+N」（押すと残りを板に一覧）。キーワードはすべての印で探せる（B2: 目標の数だけ印の要素が増えていた。D25 で 1 個から 4 個にした）', async (t) => {
  const { body } = installDom(t);
  const goals = goalsStore(rareGoals(100));
  const view = ownedView({ ...memoryApp(fakeOwned(holderData())), ideals: goals.ideals }, parseHash('#/owned'));
  body.append(view.element);
  const row = () => view.element.querySelectorAll('.owned-row').find((node) => /モコロン/.test(node.getAttribute('aria-label')));
  const band = () => row().querySelector('.owned-band');
  assert.deepEqual(band().querySelectorAll('.badge-mark').map((node) => node.textContent), ['完成品: 目標1', '完成品: 目標2', '完成品: 目標3', '完成品: 目標4']);
  // 省略されても読めるよう、印ごとに title に全文
  assert.deepEqual(band().querySelectorAll('.badge-mark').map((node) => node.title), ['完成品: 目標1', '完成品: 目標2', '完成品: 目標3', '完成品: 目標4']);
  const more = row().querySelector('.mark-more');
  assert.deepEqual([more.tagName, more.textContent, more.getAttribute('aria-label')], ['button', '+96', '+96（ほかの目標の印 96 個）']);
  assert.equal(more.title.split('\n').length, 96);
  // 行の要素は目標の数で増えない（印 4 個と「+N」だけ）
  assert.ok(descendants(row()).length < 45, `行の要素が多すぎます: ${descendants(row()).length}`);
  // 板は開いたときに作る（残りの 96 個）
  assert.equal(body.querySelector('.mark-list'), null);
  await more.dispatch('click');
  assert.equal(body.querySelector('.mark-list').querySelectorAll('.badge-mark').length, 96);
  assert.equal(body.querySelector('.mark-list').querySelectorAll('.badge-mark')[95].textContent, '完成品: 目標100');
  // 行に出ていない 100 番目の目標の印でも、キーワードで探せる
  keywordOf(view).value = '目標100';
  await keywordOf(view).dispatch('input');
  assert.deepEqual(rowIds(view), ['モコロン']);
  view.destroy();
  assert.equal(body.querySelector('.mark-list'), null);
});

test('所持パル画面: 目標の印だけが変わったときは名前のリンクを作り直さず、フォーカスを残す。「+N」は作り直しても同じ役目のボタンへ戻す（B5）', (t) => {
  installDom(t);
  const goals = goalsStore(rareGoals(1));
  const view = ownedView({ ...memoryApp(fakeOwned(holderData())), ideals: goals.ideals }, parseHash('#/owned'));
  const row = () => view.element.querySelectorAll('.owned-row').find((node) => /モコロン/.test(node.getAttribute('aria-label')));
  const link = row().querySelector('[data-focus="pal"]');
  assert.equal(link.tagName, 'a');
  link.focus();
  // 目標を足す（印だけが変わる）。前は名前のリンクごと作り直して、フォーカスが body に落ちた
  goals.set(rareGoals(5));
  assert.deepEqual(row().querySelectorAll('.badge-mark').map((node) => node.textContent), ['完成品: 目標1', '完成品: 目標2', '完成品: 目標3', '完成品: 目標4']);
  assert.equal(row().querySelector('.mark-more').textContent, '+1');
  assert.equal(row().querySelector('[data-focus="pal"]'), link);
  assert.equal(document.activeElement, link);
  // 「+N」にフォーカスがあるまま数が変わったら、新しい「+N」へ
  row().querySelector('.mark-more').focus();
  goals.set(rareGoals(8));
  assert.equal(row().querySelector('.mark-more').textContent, '+4');
  assert.equal(document.activeElement, row().querySelector('.mark-more'));
  view.destroy();
});

// ---- フェーズ 1b・1c の終わりのレビューの直し（所持パルのパネル。B6〜B10・A13 の所持パルの分） ----

test('所持パル画面: 条件を変えて一覧の先頭を見せるとき、同じ操作でパネルの高さが変わっていたら、今の高さを --panel-h に書いてから動かす（B6）', async (t) => {
  installDom(t);
  const observer = installResizeObserver(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  const list = view.element.querySelector('.owned-list');
  const panel = view.element.querySelector('.owned-panel');
  observer.resize(panel, 172.39);
  assert.equal(view.element.style.getPropertyValue('--panel-h'), '172.39px');
  let written = null;
  list.scrollIntoView = () => { written = view.element.style.getPropertyValue('--panel-h'); };
  // パッシブのチップの改行などでパネルが 210.39px になった（ResizeObserver の知らせはまだ来ていない）。
  // 前は scroll-margin-top が前の高さのままで、1 行目の上 約 30px が列見出しに隠れた
  panel.getBoundingClientRect = () => ({ top: 64, bottom: 274.39, height: 210.39, left: 0, width: 900 });
  await placeChip(view, 'egg').dispatch('click');
  assert.equal(written, '210.39px');
  view.destroy();
});

test('所持パル画面: 一覧の先頭がパネルの下に隠れるまでスクロールしているときに案内の帯が出入りしたら、その分だけスクロールして一覧を同じ位置に保つ。ページの上の方では動かさない（B7）', (t) => {
  const { windowEvents } = installDom(t);
  const scrolls = [];
  windowEvents.scrollBy = (x, y) => scrolls.push(y);
  const owned = fakeOwned();
  const view = ownedView(context(owned), parseHash('#/owned'));
  const list = view.element.querySelector('.owned-list');
  const notices = view.element.querySelector('.owned-notices');
  // 帯 1 本で一覧が 40px 下がる。一覧の先頭はパネルと列見出しの下（パネルの下端 252＋列見出し 52）に隠れている
  const base = notices.children.length;
  let top = -500;
  list.getBoundingClientRect = () => ({ top: top + (notices.children.length - base) * 40, bottom: 0, left: 0, width: 900 });
  owned.state.auto = { ...owned.state.auto, status: 'permission', error: '読み込みの許可が要ります' };
  owned.emit();
  assert.equal(notices.children.length, base + 1);
  assert.deepEqual(scrolls, [40]);
  owned.state.auto = { ...owned.state.auto, status: 'ready', error: '' };
  owned.emit();
  assert.equal(notices.children.length, base);
  assert.deepEqual(scrolls, [40, -40]);
  // ページの上の方（一覧の先頭が見えている）では動かさない（出てきた帯が見えるように）
  top = 400;
  owned.state.auto = { ...owned.state.auto, status: 'permission', error: '読み込みの許可が要ります' };
  owned.emit();
  assert.equal(notices.children.length, base + 1);
  assert.deepEqual(scrolls, [40, -40]);
  view.destroy();
});

test('所持パル画面: 状態の行で 1 行に入り切らずに隠れた条件のチップは inert にし、「+n」のボタンで板に出して × で外せる。隠れるチップにフォーカスがあれば「+n」へ（B8）', async (t) => {
  installDom(t);
  installResizeObserver(t);
  // チップの入れ物の中の位置（2 個目までが 1 行目、3 個目からは 2 行目に回って隠れる）
  const create = document.createElement;
  document.createElement = (name) => {
    const node = create(name);
    node.getBoundingClientRect = function rect() {
      if (this.className !== 'filter-chip-item' || !this.parentElement) return { left: 100, top: 200, bottom: 252, width: 220 };
      const index = this.parentElement.children.indexOf(this);
      return { left: 100, top: index < 2 ? 200 : 228, bottom: index < 2 ? 224 : 252, width: 80 };
    };
    return node;
  };
  const view = ownedView(context(fakeOwned(holderData())), parseHash('#/owned?p=Rare&stars=1&hp=10&q=モコ'));
  document.body.append(view.element);
  const wraps = () => view.element.querySelector('.filter-chips').children;
  assert.deepEqual(filterChips(view), ['パッシブ: 希少', '★1 以上', 'HP 10 以上', 'キーワード: モコ']);
  assert.deepEqual(wraps().map((node) => Boolean(node.inert)), [false, false, true, true]);
  const more = view.element.querySelector('.filter-more');
  assert.deepEqual([more.tagName, more.textContent, more.getAttribute('aria-label'), more.getAttribute('aria-hidden')], ['button', '+2', '+2（隠れている条件 2 個）', null]);
  assert.equal(more.className.split(' ').includes('is-empty'), false);
  // 押すと隠れたチップを板に並べ、最初のチップへ
  await more.dispatch('click');
  const board = () => view.element.querySelector('.filter-more-popover');
  const boardChips = () => board()?.querySelectorAll('.filter-chip').map((node) => node.querySelector('.filter-chip-text').textContent);
  assert.deepEqual(boardChips(), ['HP 10 以上', 'キーワード: モコ']);
  assert.equal(document.activeElement, board().querySelectorAll('.filter-chip')[0]);
  // 板の × で外すと、同じ番号（無ければ前）の項目へ
  await board().querySelectorAll('.filter-chip')[0].dispatch('click');
  assert.deepEqual(filterChips(view), ['パッシブ: 希少', '★1 以上', 'キーワード: モコ']);
  assert.deepEqual(boardChips(), ['キーワード: モコ']);
  assert.equal(document.activeElement, board().querySelectorAll('.filter-chip')[0]);
  // 隠れたチップがなくなったら板を閉じ、状態の行の最後のチップへ
  await board().querySelectorAll('.filter-chip')[0].dispatch('click');
  assert.equal(board(), null);
  assert.deepEqual(filterChips(view), ['パッシブ: 希少', '★1 以上']);
  assert.equal(more.className.split(' ').includes('is-empty'), true);
  assert.equal(document.activeElement.querySelector('.filter-chip-text').textContent, '★1 以上');
  // フォーカスのあるチップが前に足された条件で 2 行目へ回ったら、「+n」へ（隠れたチップは inert でフォーカスを持てない）
  view.applyRoute(parseHash(`#/owned?holder=player:${P1}&p=Rare&stars=1`), { reason: 'navigate' });
  view.element.querySelectorAll('.filter-chip').find((node) => node.textContent.startsWith('★1')).focus();
  view.applyRoute(parseHash(`#/owned?holder=player:${P1}&el=Fire&p=Rare&stars=1`), { reason: 'navigate' });
  assert.deepEqual(filterChips(view), ['所持者: Alice', '属性: 炎', 'パッシブ: 希少', '★1 以上']);
  assert.equal(document.activeElement, more);
  view.destroy();
});

test('所持パル画面: 「すべて解除」を押すと（押せなくなるので）キーワードへフォーカスを移す（B9。拠点の板の「すべての拠点」は D29 で板ごとなくした）', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned(holderData())), parseHash('#/owned'));
  document.body.append(view.element);
  starsOf(view).value = '1';
  await starsOf(view).dispatch('change');
  const reset = button(view, 'すべて解除');
  reset.focus();
  await reset.dispatch('click');
  assert.equal(reset.disabled, true);
  assert.equal(document.activeElement, keywordOf(view));
  assert.deepEqual(filterChips(view), []);
  view.destroy();
});

test('所持パル画面: 「まとめて ▾」のメニューは開くと最初の項目へ、↑↓・Home・End で項目の間を移り（端で回る）、項目は Tab で止まらない。Esc で閉じてボタンへ（B10）', async (t) => {
  const { events } = installDom(t);
  const view = ownedView(context(fakeOwned()), parseHash('#/owned'));
  document.body.append(view.element);
  const open = view.element.querySelector('.talent-preset-button');
  await open.dispatch('click');
  const menu = view.element.querySelector('.talent-preset-menu');
  const items = menu.querySelectorAll('[role="menuitem"]');
  assert.deepEqual(items.map((node) => [node.textContent, node.tabIndex]), [['すべて 90 以上', -1], ['すべて 100', -1]]);
  assert.equal(document.activeElement, items[0]);
  const key = async (name, expected) => {
    const result = await menu.dispatch('keydown', { key: name });
    assert.equal(result.defaultPrevented, true, name);
    assert.equal(document.activeElement, items[expected], name);
  };
  await key('ArrowDown', 1);
  await key('ArrowDown', 0);
  await key('ArrowUp', 1);
  await key('Home', 0);
  await key('End', 1);
  await events.dispatch('keydown', { key: 'Escape' });
  assert.equal(view.element.querySelector('.talent-preset-menu'), null);
  assert.equal(document.activeElement, open);
  view.destroy();
});

test('所持パル画面: 条件のチップの × の後は次のチップ → 前のチップ → キーワードへ。列見出しは ←・Home・End で端まで移り、端で回る（A13 の所持パルの分）', async (t) => {
  installDom(t);
  const view = ownedView(context(fakeOwned(holderData())), parseHash('#/owned?p=Rare&stars=1&hp=10'));
  document.body.append(view.element);
  const chip = (text) => view.element.querySelectorAll('.filter-chip').find((node) => node.querySelector('.filter-chip-text').textContent === text);
  assert.deepEqual(filterChips(view), ['パッシブ: 希少', '★1 以上', 'HP 10 以上']);
  chip('★1 以上').focus();
  await chip('★1 以上').dispatch('click');
  assert.equal(document.activeElement, chip('HP 10 以上'));
  await chip('HP 10 以上').dispatch('click');
  assert.equal(document.activeElement, chip('パッシブ: 希少'));
  await chip('パッシブ: 希少').dispatch('click');
  assert.equal(document.activeElement, keywordOf(view));
  // 列見出し: 先頭で ← は最後へ、Home・End で端へ
  const head = view.element.querySelector('.owned-list-head');
  headButton(view, 'dex').focus();
  await head.dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(document.activeElement, headButton(view, 'place'));
  await head.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(document.activeElement, headButton(view, 'dex'));
  await head.dispatch('keydown', { key: 'End' });
  assert.equal(document.activeElement, headButton(view, 'place'));
  await head.dispatch('keydown', { key: 'Home' });
  assert.equal(document.activeElement, headButton(view, 'dex'));
  assert.deepEqual([headButton(view, 'dex').tabIndex, headButton(view, 'place').tabIndex], [0, -1]);
  view.destroy();
});

test('所持パル画面: 属性の板は開くと中の最初の部品へフォーカスを移し、Esc で閉じて開いたボタンへ戻す（A13 の所持パルの分。まとめて・リンクはそれぞれのテスト。拠点の板は D29 でなくした）', async (t) => {
  const { events } = installDom(t);
  const view = ownedView(context(fakeOwned(holderData())), parseHash('#/owned?el=Ice'));
  document.body.append(view.element);
  // 属性は選んでいる最初の属性（無ければ先頭）へ
  const elements = view.element.querySelector('.owned-element-button');
  await elements.dispatch('click');
  assert.equal(document.activeElement.getAttribute('data-value'), 'Ice');
  await events.dispatch('keydown', { key: 'Escape' });
  assert.equal(view.element.querySelector('.owned-element-popover'), null);
  assert.equal(document.activeElement, elements);
  view.destroy();
});

// ---- フェーズ 1b・1c の終わりのユーザーの答え（D25〜D27） ----

const mokoronRow = (view) => view.element.querySelectorAll('.owned-row').find((node) => /モコロン/.test(node.getAttribute('aria-label')));
const hasBand = (view) => view.element.querySelector('.owned-list').className.split(' ').includes('has-band');

test('所持パル画面: 目標の印は名前の下ではなく行の下の段（行の幅いっぱい）に 4 つまで横に並べ、5 つ目からは「+N」。キーワードに一致した理由も同じ段の印の後ろに出す（D25）', async (t) => {
  const { body } = installDom(t);
  const goals = goalsStore(rareGoals(6));
  const view = ownedView({ ...memoryApp(fakeOwned(holderData())), ideals: goals.ideals }, parseHash('#/owned'));
  body.append(view.element);
  const row = mokoronRow(view);
  const band = row.querySelector('.owned-band');
  // 段は行の 5 つの欄の後ろ。名前の下（パルの欄）には印を出さない
  assert.equal(row.children.indexOf(band), 5);
  assert.equal(row.querySelector('.owned-pal').querySelectorAll('.badge-mark').length, 0);
  assert.deepEqual(band.children.map((node) => [node.className, node.textContent]), [
    ['owned-badge badge-mark', '完成品: 目標1'], ['owned-badge badge-mark', '完成品: 目標2'], ['owned-badge badge-mark', '完成品: 目標3'],
    ['owned-badge badge-mark', '完成品: 目標4'], ['owned-badge mark-more hint-trigger', '+2'],
  ]);
  const more = band.querySelector('.mark-more');
  assert.deepEqual([more.getAttribute('aria-label'), more.title, more.getAttribute('data-focus')], ['+2（ほかの目標の印 2 個）', '完成品: 目標5\n完成品: 目標6', 'marks-more']);
  // 板の部品は初めて押したときに作り、その 1 回で開く（2,000 行ぶんを最初から作らない）。もう一度押すと閉じ、また押すと開く
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  await more.dispatch('click');
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(body.querySelector('.mark-list').querySelectorAll('.badge-mark').map((node) => node.textContent), ['完成品: 目標5', '完成品: 目標6']);
  await more.dispatch('click');
  assert.equal(body.querySelector('.mark-list'), null);
  await more.dispatch('click');
  assert.ok(body.querySelector('.mark-list'));
  // 印がちょうど 4 つなら「+N」は出さない
  goals.set(rareGoals(4));
  assert.deepEqual(mokoronRow(view).querySelector('.owned-band').children.map((node) => node.textContent), ['完成品: 目標1', '完成品: 目標2', '完成品: 目標3', '完成品: 目標4']);
  // キーワードに一致した理由（希少の説明「作業速度」）は、同じ段の印の後ろに 1 行で
  keywordOf(view).value = '作業速度';
  await keywordOf(view).dispatch('input');
  const withHits = mokoronRow(view).querySelector('.owned-band');
  assert.deepEqual(withHits.children.map((node) => node.className), [
    'owned-badge badge-mark', 'owned-badge badge-mark', 'owned-badge badge-mark', 'owned-badge badge-mark', 'owned-hits',
  ]);
  assert.deepEqual(withHits.querySelector('.owned-hits').querySelectorAll('.owned-hit').map((node) => node.textContent), ['パッシブ：希少（攻撃 +15% 防御 +15% 作業速度 +20%）']);
  assert.equal(mokoronRow(view).querySelector('.owned-passives').querySelector('.owned-hits'), null);
  // 印がなくなっても理由は段に残り、理由もなくなれば段ごと外す
  goals.set([]);
  assert.deepEqual(mokoronRow(view).querySelector('.owned-band').children.map((node) => node.className), ['owned-hits']);
  keywordOf(view).value = '';
  await keywordOf(view).dispatch('input');
  assert.equal(mokoronRow(view).querySelector('.owned-band'), null);
  view.destroy();
});

test('所持パル画面: 行の高さは「目標の印」を出していて保存した目標が 1 つ以上あるか、キーワードがあるときだけ下の段の分高くし（一覧の has-band。全部の行が同じ高さ）、データの読み直しでは変えない（D25）', async (t) => {
  installDom(t);
  const goals = goalsStore([]);
  const owned = fakeOwned(holderData());
  const view = ownedView({ ...memoryApp(owned), ideals: goals.ideals }, parseHash('#/owned'));
  assert.equal(hasBand(view), false);
  // 目標を保存した（印のない行も同じ高さにする）
  goals.set(rareGoals(1));
  assert.equal(hasBand(view), true);
  // 読み直しで印の付く個体がいなくなっても、高さは変えない（利用者が目標・キーワード・印の表示を変えたときだけ）
  owned.state.owned = normalizeOwned({ ...holderSnapshot, pals: holderSnapshot.pals.filter((pal) => pal.instanceId !== 'a1') }, { pals, passives });
  owned.emit();
  assert.equal(view.element.querySelectorAll('.owned-band').length, 0);
  assert.equal(hasBand(view), true);
  // 「目標の印」を外すと低くする
  const check = view.element.querySelector('.owned-marks-toggle').querySelector('input');
  check.checked = false;
  await check.dispatch('change');
  assert.equal(hasBand(view), false);
  // キーワードがあれば、印を出していなくても高くする（空白だけはキーワードにならない）
  keywordOf(view).value = '  ';
  await keywordOf(view).dispatch('input');
  assert.equal(hasBand(view), false);
  keywordOf(view).value = 'ペンタマ';
  await keywordOf(view).dispatch('input');
  assert.equal(hasBand(view), true);
  keywordOf(view).value = '';
  await keywordOf(view).dispatch('input');
  assert.equal(hasBand(view), false);
  check.checked = true;
  await check.dispatch('change');
  assert.equal(hasBand(view), true);
  // 目標を全部外すと低くする
  goals.set([]);
  assert.equal(hasBand(view), false);
  view.destroy();
});

test('所持パル画面: 行の高さが切り替わったとき、一覧の先頭が固定の部分の下に隠れていれば、見ていた行を同じ位置に保つ（D25）', async (t) => {
  const { body, windowEvents } = installDom(t);
  const scrolls = [];
  // スクロールすると一覧が上へ動く
  let listTop = 100;
  windowEvents.scrollBy = (x, y) => { scrolls.push(y); listTop -= y; };
  const goals = goalsStore(rareGoals(1));
  const view = ownedView({ ...memoryApp(fakeOwned(holderData())), ideals: goals.ideals }, parseHash('#/owned'));
  body.append(view.element);
  const list = view.element.querySelector('.owned-list');
  // 行は一覧の上端から、行の高さ（下の段があれば 80px・なければ 64px）ずつ並ぶ。固定の部分の下端はパネル 252＋列見出し 52 = 304
  const rowHeight = () => (list.className.split(' ').includes('has-band') ? 80 : 64);
  list.getBoundingClientRect = () => ({ top: listTop, bottom: listTop + list.children.length * rowHeight(), left: 0, width: 900 });
  t.mock.method(FakeElement.prototype, 'getBoundingClientRect', function rect() {
    if (this.parentElement !== list) return { left: 100, top: 200, bottom: 252, width: 220 };
    const top = listTop + list.children.indexOf(this) * rowHeight();
    return { left: 0, top, bottom: top + rowHeight(), width: 900 };
  });
  const check = view.element.querySelector('.owned-marks-toggle').querySelector('input');
  // 見ていた行は 3 行目（上端 260）。80px → 64px で 228 に上がるので、その分だけ戻す（一覧の上端は 132 になる）
  check.checked = false;
  await check.dispatch('change');
  assert.deepEqual(scrolls, [-32]);
  // 戻すと 3 行目（上端 260）が 292 に下がるので、その分だけ戻す
  check.checked = true;
  await check.dispatch('change');
  assert.deepEqual(scrolls, [-32, 32]);
  // 一覧の先頭が見えているときは動かさない（上の行の高さは変わっても、見ている行より上に動く行はない）
  listTop = 400;
  check.checked = false;
  await check.dispatch('change');
  assert.deepEqual(scrolls, [-32, 32]);
  view.destroy();
});

test('所持パル画面: 2,000 行を超えて見えている範囲だけ描くときも、行の高さを切り替えたら覚えた高さを捨てて見積もりを変える（D25）', (t) => {
  installDom(t);
  const goals = goalsStore([]);
  // 図鑑順以外（種族の見出しの行を混ぜない）で、行の数をそのまま数える
  const view = ownedView({ ...memoryApp(fakeOwned(manyData(2100))), ideals: goals.ideals }, parseHash('#/owned?sort=level'));
  const list = view.element.querySelector('.owned-list');
  assert.ok(list.className.split(' ').includes('is-virtual'));
  // 上下の余白の合計 = 描いていない行の数 × 見積もり（偽の DOM の行には高さがないので、どの行も見積もりのまま）
  const spaces = () => list.children.filter((node) => node.className === 'virtual-spacer')
    .reduce((sum, node) => sum + Number.parseFloat(node.style.getPropertyValue('--space')), 0);
  const unpainted = () => 2100 - list.children[1].children.length;
  assert.equal(spaces(), unpainted() * 64);
  // 目標を保存したら、全部の行を 80px で見積もる
  goals.set(rareGoals(1));
  assert.equal(hasBand(view), true);
  assert.equal(spaces(), unpainted() * 80);
  goals.set([]);
  assert.equal(spaces(), unpainted() * 64);
  view.destroy();
});

// ---------------------------------------------------------------------------
// participant-self: 設定の「このワールドでの自分」・設定の行き先（settingsHash）・自分を変えたときの所持パルの描き直し
// ---------------------------------------------------------------------------
const SELF_WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const selfKeyOf = (userId) => `pal-note.ideals.self.test.${userId}.${SELF_WORLD}`;
// 選択肢の値と保存する値はプレイヤーの鍵（server の identity。InstanceId のないプレイヤーは 'u:<uid>'）
const keyOf = (uid) => `u:${uid}`;
// 参加している人の画面（登録したワールドはなく、ホストが共有した所持パルを見ている）。プレイヤーは Alice・Bob・Bob（同じ名前）
function guestOwned(players = [{ uid: P1, name: 'Alice' }, { uid: P2, name: 'Bob' }, { uid: P3, name: 'Bob' }]) {
  const owned = fakeOwned(null);
  const snap = { ...holderSnapshot, players: players.map((player) => ({ ...player, level: 10 })) };
  Object.assign(owned.state, {
    owned: normalizeOwned(snap, { pals, passives }),
    meta: { worldId: SELF_WORLD, worldName: '仲間のワールド', hostName: 'Alice', source: 'shared', saveUpdatedAt: '2026-10-05T00:00:00.000Z', importedAt: '', sharedAt: '2026-10-05T00:01:00.000Z', uploadedBy: 'Alice', palCount: 6 },
  });
  return owned;
}
// ホストの画面（登録したワールド SELF_WORLD を読み込んでいる）。プレイヤーは Alice と Frank
function hostOwned() {
  const snap = { ...holderSnapshot, players: [{ uid: P1, name: 'Alice', level: 50 }, { uid: P2, name: 'Frank', level: 10 }] };
  const data = { ...holderData(snap), world: { id: SELF_WORLD, dir: `s/${SELF_WORLD}`, name: 'テスト', hostName: 'Alice', updatedAt: '2026-10-05T00:00:00.000Z' } };
  const owned = fakeOwned(data);
  owned.state.auto.worlds[0].id = SELF_WORLD;
  Object.assign(owned.state, { linkedWorldId: SELF_WORLD, meta: { ...owned.state.meta, worldId: SELF_WORLD } });
  return owned;
}
// ログインした store（購読つき）・この端末の保存・このワールドでの自分・理想個体の登録（app.js と同じく identity に self・selfLastUid を渡す）
function selfApp(owned, { userId = '仲間', users = ['仲間', 'Alice'], autoRegister = null } = {}) {
  const app = context(owned);
  const listeners = new Set();
  Object.assign(app.store.state, { userId, users, passcode: '入力', renaming: false, records: [] });
  app.store.subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  app.store.emit = () => listeners.forEach((listener) => listener(app.store.state));
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  app.self = createSelfStore({ store: app.store, storage });
  app.autoRegister = autoRegister;
  app.ideals = createIdealStore({
    store: app.store, owned, storage,
    identity: (worldId) => ({
      userId: app.store.state.userId, users: app.store.state.users, mapping: autoRegister?.mapping(worldId) ?? {}, self: app.self.get(worldId),
      selfLastUid: app.self.lastUid(worldId),
    }),
  });
  app.replacements = [];
  app.replace = (hash) => app.replacements.push(hash);
  return { app, values, listeners };
}
// 自動登録の設定（オン・登録者の対応はなし）
function fakeAutoRegister() {
  const mappings = [];
  return { mappings, enabled: () => true, mapping: () => ({}), setMapping: (uid, userId, worldId) => mappings.push([uid, userId, worldId]), subscribe: () => () => {} };
}
const selfSelectOf = (root) => root.querySelector('.owned-self-row').querySelector('select');

test('設定画面（このワールドでの自分）: 参加している人（共有のプレイヤー）にも出し、プレイヤーを選ぶとこの端末に保存し、自分の個体がその人になる', (t) => {
  installDom(t);
  const owned = guestOwned();
  const { app, values } = selfApp(owned);
  const card = ownedSettingsCard(app, { win: DROP_WIN });
  const row = card.element.querySelector('.owned-self-row');
  assert.equal(row.hidden, false);
  assert.match(row.textContent, /このワールドでの自分/);
  assert.match(row.textContent, /理想個体の完成の判定と、自分の個体の絞り込みに使います（この端末だけ）/);
  const select = selfSelectOf(card.element);
  assert.equal(select.getAttribute('aria-label'), 'このワールドでの自分');
  // 名前の違う人（仲間）は自動では決まらない。同じ名前の 2 人には UID の頭 8 字を添える（所持者の選択肢と同じ名前）
  assert.deepEqual(select.children.map((node) => node.textContent), ['未設定（自分の個体を判定しません）', 'Alice', 'Bob（ABCD1234）', 'Bob（1A2B3C4D）']);
  assert.equal(select.value, '');
  assert.equal(app.ideals.mine(), null);
  select.value = keyOf(P2);
  select.dispatch('change');
  assert.equal(values.get(selfKeyOf('仲間')), keyOf(P2));
  assert.deepEqual([...app.ideals.selfUids()], [P2]);
  assert.equal(select.value, keyOf(P2));
  // 「未設定」に戻すと消す
  select.value = '';
  select.dispatch('change');
  assert.equal(values.has(selfKeyOf('仲間')), false);
  card.destroy();
});

test('設定画面（このワールドでの自分）: 自動で決まる人は先頭の選択肢に名前を出し、ログアウト中・データのないとき・ワールドの分からないときは出さない', (t) => {
  installDom(t);
  const owned = guestOwned();
  const { app } = selfApp(owned, { userId: 'Alice', users: ['Alice'] });
  const card = ownedSettingsCard(app, { win: DROP_WIN });
  const row = card.element.querySelector('.owned-self-row');
  assert.equal(selfSelectOf(card.element).children[0].textContent, '自動（Alice）');
  // ログアウトした
  app.store.state.passcode = '';
  app.store.emit();
  assert.equal(row.hidden, true);
  app.store.state.passcode = '入力';
  app.store.emit();
  assert.equal(row.hidden, false);
  // 所持パルのデータがない・ワールド ID の形が違う
  owned.state.meta = { ...owned.state.meta, worldId: 'W' };
  owned.emit();
  assert.equal(row.hidden, true);
  owned.state.meta = { ...owned.state.meta, worldId: SELF_WORLD };
  owned.state.owned = null;
  owned.emit();
  assert.equal(row.hidden, true);
  card.destroy();
});

test('設定画面（このワールドでの自分）: 別のタブで変えたら選択を合わせ、同じ内容の描き直しでは選択肢を作り直さない', (t) => {
  installDom(t);
  const owned = guestOwned();
  const { app, values } = selfApp(owned);
  const card = ownedSettingsCard(app, { win: DROP_WIN });
  const select = selfSelectOf(card.element);
  const options = [...select.children];
  owned.state.busy = true;
  owned.emit();
  app.store.emit();
  assert.deepEqual([...select.children], options);
  // 前の版の値（プレフィックスのない UID）も、そのプレイヤーの選択肢に合わせる
  values.set(selfKeyOf('仲間'), P3);
  app.self.reload(selfKeyOf('仲間'));
  assert.equal(select.value, keyOf(P3));
  assert.deepEqual([...select.children], options);
  card.destroy();
});

test('設定画面（行き先）: #/settings?world=<ID>&open=auto で開くと、自分が決まっていなければ「このワールドでの自分」にフォーカスし、URL から外す', async (t) => {
  installDom(t);
  const { settingsView } = await import('../../web/js/views/settings.js');
  const { app } = selfApp(guestOwned());
  const view = settingsView(app, parseHash(`#/settings?world=${SELF_WORLD.toLowerCase()}&open=auto`));
  // 戻る・進む・読み込み直しでもう一度動かないよう、world・open を外す
  assert.deepEqual(app.replacements, ['#/settings']);
  // 作った直後はまだ文書に付いていないので、付いた後に移る
  document.body.append(view.element);
  await tick();
  assert.equal(document.activeElement, selfSelectOf(view.element));
  // 同じ画面のまま（通知を押したなど）来たときは、その場で移る。open のない URL では何もしない
  document.activeElement = document.body;
  view.applyRoute(parseHash('#/settings'));
  assert.equal(document.activeElement, document.body);
  view.applyRoute(parseHash('#/settings?open=auto'));
  assert.equal(document.activeElement, selfSelectOf(view.element));
  assert.deepEqual(app.replacements, ['#/settings', '#/settings']);
  view.destroy();
});

test('設定画面（行き先）: 自動登録の「対応が未設定」から来たら、そのワールドの行を開いて未設定の登録者にフォーカスする（自分が決まっていれば自分の選択へは移らない）', async (t) => {
  installDom(t);
  const { settingsView } = await import('../../web/js/views/settings.js');
  const autoRegister = fakeAutoRegister();
  const { app } = selfApp(hostOwned(), { userId: 'Alice', users: ['Alice'], autoRegister });
  const before = settingsView(app, parseHash('#/settings'));
  // 行き先なしで開いたときは、ワールドの行は閉じたまま
  assert.equal(before.element.querySelector('.owned-world-details').open, false);
  before.destroy();
  const view = settingsView(app, parseHash(`#/settings?world=${SELF_WORLD}&open=auto`));
  document.body.append(view.element);
  await tick();
  assert.equal(view.element.querySelector('.owned-world-details').open, true);
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Frankのノートの ID');
  // 登録者の対応を変えたら、自分の決め方も変わるので判定し直す（このワールドでの自分の自動の名前も描き直す）
  document.activeElement.value = 'Alice';
  await document.activeElement.dispatch('change');
  assert.deepEqual(autoRegister.mappings, [[P2, 'Alice', SELF_WORLD]]);
  // 未設定の登録者がなければ自動登録のチェック、行がないワールド（参加しているだけ）は自分の選択か見出しへ
  view.destroy();
  const mapped = fakeAutoRegister();
  mapped.mapping = () => ({ [P2]: 'Alice' });
  const second = selfApp(hostOwned(), { userId: 'Alice', users: ['Alice'], autoRegister: mapped });
  const toggleView = settingsView(second.app, parseHash(`#/settings?world=${SELF_WORLD}&open=auto`));
  document.body.append(toggleView.element);
  await tick();
  assert.equal(document.activeElement.type, 'checkbox');
  toggleView.destroy();
  const other = settingsView(second.app, parseHash('#/settings?world=FEDCBA9876543210FEDCBA9876543210&open=auto'));
  document.body.append(other.element);
  await tick();
  assert.equal(document.activeElement, selfSelectOf(other.element));
  other.destroy();
});

test('設定画面（行き先）: 所持パルの状態を読み込む前に来たら、読み込んだ後に行い、データのない画面では見出しへ移る', async (t) => {
  installDom(t);
  const { settingsView } = await import('../../web/js/views/settings.js');
  const owned = fakeOwned(null, { ready: false });
  const { app } = selfApp(owned);
  const view = settingsView(app, parseHash(`#/settings?world=${SELF_WORLD}&open=auto`));
  document.body.append(view.element);
  await tick();
  assert.equal(document.activeElement, document.body);
  owned.state.ready = true;
  owned.emit();
  const heading = view.element.querySelector('.owned-settings').querySelector('h2');
  assert.equal(document.activeElement, heading);
  assert.equal(heading.tabIndex, -1);
  view.destroy();
});

test('所持パル画面（このワールドでの自分）: 所持者が自分（既定）のまま自分を選ぶと、同じデータのまま選択肢・件数・行を描き直す', (t) => {
  installDom(t);
  const owned = guestOwned([{ uid: P1, name: 'Alice' }, { uid: P2, name: 'Bob' }]);
  const { app } = selfApp(owned);
  const view = ownedView(app, parseHash('#/owned'));
  // 自分が分からない間は「すべて」として出す（D29）
  assert.equal(holderSelect(view).value, '');
  assert.equal(rowIds(view).length, 5);
  app.self.set(SELF_WORLD, P2);
  assert.equal(holderSelect(view).value, 'mine');
  assert.deepEqual(holderSelect(view).children.map((node) => node.textContent), ['すべて', 'Bob（自分）', 'Alice']);
  assert.deepEqual(rowIds(view), ['ペンタマ', 'キツネビ']);
  // 自分を変えると、その人の個体に描き直す
  app.self.set(SELF_WORLD, P1);
  assert.deepEqual(holderSelect(view).children.map((node) => node.textContent), ['すべて', 'Alice（自分）', 'Bob']);
  // Alice の個体（パルボックス・拠点に預けたもの。グローバルパルボックスは既定の場所にない）
  assert.equal(rowIds(view).length, 2);
  // 同じ本人のままの知らせでは描き直さない
  const rows = view.element.querySelectorAll('.owned-row');
  app.self.reload('pal-note.ideals.self.');
  assert.deepEqual(view.element.querySelectorAll('.owned-row'), rows);
  view.destroy();
});

// ---------------------------------------------------------------------------
// フェーズ 1d の終わりのレビューの直し: 設定の行き先の意図（open）・このワールドでの自分の選択・行を作り直さない行き先
// ---------------------------------------------------------------------------
// 設定の画面を行き先つきで作り、付けた後にフォーカスが移るのを待つ
async function openSettings(app, hash) {
  const { settingsView } = await import('../../web/js/views/settings.js');
  const view = settingsView(app, parseHash(hash));
  document.body.append(view.element);
  await tick();
  return view;
}
const closeSettings = (view) => { view.destroy(); view.element.remove(); };
const cardHeading = (root) => root.querySelector('.owned-settings').querySelector('h2');

test('設定画面（行き先の意図）: ID とセーブの名前が違うホストで対応も自分も未設定のとき、registrant は未設定の登録者、self は自分の選択へ（auto は前の決め方のまま自分）', async (t) => {
  installDom(t);
  const { app } = selfApp(hostOwned(), { userId: '仲間', users: ['仲間'], autoRegister: fakeAutoRegister() });
  // 自動登録の「プレイヤーの対応が未設定です」: そのワールドの行を開いて、未設定の登録者へ（自分も決まっていないが、自分へは移らない）
  let view = await openSettings(app, `#/settings?world=${SELF_WORLD}&open=registrant`);
  assert.equal(view.element.querySelector('.owned-world-details').open, true);
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Aliceのノートの ID');
  closeSettings(view);
  // 理想個体の「設定で選ぶ」: このワールドでの自分（行は開かない）
  view = await openSettings(app, `#/settings?world=${SELF_WORLD}&open=self`);
  assert.equal(document.activeElement, selfSelectOf(view.element));
  assert.equal(view.element.querySelector('.owned-world-details').open, false);
  closeSettings(view);
  // 前の版の通知・ブックマーク（open=auto）: 前の決め方のまま（自分が決まっていなければ自分）
  view = await openSettings(app, `#/settings?world=${SELF_WORLD}&open=auto`);
  assert.equal(document.activeElement, selfSelectOf(view.element));
  assert.equal(view.element.querySelector('.owned-world-details').open, true);
  closeSettings(view);
  // どれも URL から行き先を外す。知らない意図は何もしない（URL も変えない）
  document.activeElement = document.body;
  view = await openSettings(app, `#/settings?world=${SELF_WORLD}&open=other`);
  assert.equal(document.activeElement, document.body);
  assert.deepEqual(app.replacements, ['#/settings', '#/settings', '#/settings']);
  closeSettings(view);
});

test('設定画面（行き先の意図）: registrant は未設定の登録者がいなければ自分の選択、自分の行もなければ見出しへ移る', async (t) => {
  installDom(t);
  const mapped = fakeAutoRegister();
  mapped.mapping = () => ({ [P1]: '仲間', [P2]: '仲間' });
  const { app } = selfApp(hostOwned(), { userId: '仲間', users: ['仲間'], autoRegister: mapped });
  let view = await openSettings(app, `#/settings?world=${SELF_WORLD}&open=registrant`);
  assert.equal(view.element.querySelector('.owned-world-details').open, true);
  assert.equal(document.activeElement, selfSelectOf(view.element));
  closeSettings(view);
  // 所持パルのデータがない（自分の行が出ない）
  const empty = selfApp(fakeOwned(null));
  view = await openSettings(empty.app, `#/settings?world=${SELF_WORLD}&open=registrant`);
  assert.equal(document.activeElement, cardHeading(view.element));
  closeSettings(view);
});

test('設定画面（行き先の意図）: status（データがない・読めない）は状態の欄の操作へ移り、行を開かず、Space で切り替わる自動登録のチェックには移らない', async (t) => {
  installDom(t);
  // 自分は同じ名前で決まり、登録者も全員対応づけてある（前の決め方 auto では、自動登録のチェックへ移っていた）
  const mapped = fakeAutoRegister();
  mapped.mapping = () => ({ [P2]: 'Alice' });
  const owned = hostOwned();
  const { app } = selfApp(owned, { userId: 'Alice', users: ['Alice'], autoRegister: mapped });
  const before = await openSettings(app, `#/settings?world=${SELF_WORLD}&open=auto`);
  assert.equal(document.activeElement.type, 'checkbox');
  closeSettings(before);
  const view = await openSettings(app, `#/settings?world=${SELF_WORLD}&open=status`);
  assert.equal(document.activeElement.textContent, '今すぐ読み込む');
  assert.equal(view.element.querySelector('.owned-world-details').open, false);
  // 許可が要るときは「読み込みを許可」
  owned.state.auto = { ...owned.state.auto, status: 'permission' };
  owned.emit();
  view.applyRoute(parseHash(`#/settings?world=${SELF_WORLD}&open=status`));
  assert.equal(document.activeElement.textContent, '読み込みを許可');
  // 読み込み中で押せないときは見出し
  owned.state.auto = { ...owned.state.auto, status: 'ready' };
  owned.state.busy = true;
  owned.emit();
  view.applyRoute(parseHash(`#/settings?world=${SELF_WORLD}&open=status`));
  assert.equal(document.activeElement, cardHeading(view.element));
  assert.equal(view.element.querySelector('.owned-world-details').open, false);
  closeSettings(view);
  // 登録したワールドがない（参加している人。状態の欄は出ない）は見出し
  const guest = selfApp(guestOwned());
  const other = await openSettings(guest.app, '#/settings?open=status');
  assert.equal(document.activeElement, cardHeading(other.element));
  closeSettings(other);
});

test('設定画面（行き先）: 設定を開いたまま行き先が来ても、登録したワールドの行は作り直さず開くだけ（処理中のボタン・ほかの開いた行はそのまま）', async (t) => {
  installDom(t);
  const owned = hostOwned();
  const OTHER = 'FEDCBA9876543210FEDCBA9876543210';
  owned.state.auto.worlds.push({ ...owned.state.auto.worlds[0], id: OTHER, dir: OTHER, name: '別のワールド', playedAt: '' });
  const { app } = selfApp(owned, { userId: '仲間', users: ['仲間'], autoRegister: fakeAutoRegister() });
  const view = await openSettings(app, '#/settings');
  const items = view.element.querySelectorAll('.owned-registered-item');
  const [first, second] = view.element.querySelectorAll('.owned-world-details');
  // ほかのワールドの行を開いておき、行き先のワールドの「編集」を処理している途中（runButton が aria-busy を付けて押せなくする想定）
  second.open = true;
  await second.dispatch('toggle');
  const csv = items[0].querySelector('.owned-registered-actions').querySelectorAll('button').find((node) => node.textContent === '編集');
  assert.equal(csv.disabled, false);
  csv.disabled = true;
  csv.setAttribute('aria-busy', 'true');
  view.applyRoute(parseHash(`#/settings?world=${SELF_WORLD}&open=registrant`));
  assert.deepEqual(view.element.querySelectorAll('.owned-registered-item'), items);
  assert.equal(first.open, true);
  assert.equal(second.open, true);
  assert.equal(csv.disabled, true);
  assert.equal(csv.getAttribute('aria-busy'), 'true');
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Aliceのノートの ID');
  // 読み直し（同じ内容）でも作り直さない
  owned.emit();
  assert.deepEqual(view.element.querySelectorAll('.owned-registered-item'), items);
  closeSettings(view);
});

test('設定画面（登録者）: 対応を変えても行を作り直さず（フォーカスが残る）、本人の変化として知らせて自分の自動の名前を描き直す。別のタブの変更では選択を合わせる', async (t) => {
  installDom(t);
  const autoRegister = fakeAutoRegister();
  let mapping = {};
  autoRegister.mapping = () => mapping;
  autoRegister.setMapping = (uid, userId) => { mapping = userId ? { ...mapping, [uid]: userId } : {}; };
  const { app } = selfApp(hostOwned(), { userId: '仲間', users: ['仲間'], autoRegister });
  let changes = 0;
  app.self.subscribe(() => changes++);
  const view = await openSettings(app, `#/settings?world=${SELF_WORLD}&open=registrant`);
  const items = view.element.querySelectorAll('.owned-registered-item');
  const select = document.activeElement;
  assert.equal(select.getAttribute('aria-label'), 'Aliceのノートの ID');
  assert.equal(selfSelectOf(view.element).children[0].textContent, '未設定（自分の個体を判定しません）');
  select.value = '仲間';
  await select.dispatch('change');
  assert.equal(changes, 1);
  assert.deepEqual(view.element.querySelectorAll('.owned-registered-item'), items);
  assert.equal(document.activeElement, select);
  assert.equal(selfSelectOf(view.element).children[0].textContent, '自動（Alice）');
  // 別のタブで対応を変えた（app.js が storage イベントで self.changed を呼ぶ）: 登録者の選択も合わせる
  mapping = { [P2]: '仲間' };
  app.self.changed();
  const frank = view.element.querySelectorAll('select').find((node) => node.getAttribute('aria-label') === 'Frankのノートの ID');
  assert.equal(frank.value, '仲間');
  assert.equal(selfSelectOf(view.element).children[0].textContent, '自動（Frank）');
  closeSettings(view);
});

test('設定画面（このワールドでの自分）: ID の変更中は選べず（理由は title）、変更中に change が来ても保存しない。終わったら選べる', (t) => {
  installDom(t);
  const { app, values } = selfApp(guestOwned());
  const card = ownedSettingsCard(app, { win: DROP_WIN });
  const select = selfSelectOf(card.element);
  assert.equal(select.disabled, false);
  app.store.state.renaming = true;
  app.store.emit();
  assert.equal(select.disabled, true);
  assert.equal(select.title, 'ID の変更が終わってから選んでください');
  select.value = keyOf(P2);
  select.dispatch('change');
  assert.equal(values.has(selfKeyOf('仲間')), false);
  assert.equal(select.value, '');
  app.store.state.renaming = false;
  app.store.emit();
  assert.equal(select.disabled, false);
  assert.equal(select.title, '');
  select.value = keyOf(P2);
  select.dispatch('change');
  assert.equal(values.get(selfKeyOf('仲間')), keyOf(P2));
  card.destroy();
});

test('設定画面（このワールドでの自分）: InstanceId のあるプレイヤーは選択肢の値がキャラクターの鍵（i:）で、前の版の値（UID）もその選択肢に合わせる（server の identity）', (t) => {
  installDom(t);
  const IID_ALICE = '11111111-2222-3333-4444-555555555555';
  const IID_BOB = '66666666-7777-8888-9999-aaaaaaaaaaaa';
  const owned = guestOwned([{ uid: P1, name: 'Alice', instanceId: IID_ALICE }, { uid: P2, name: 'Bob', instanceId: IID_BOB }, { uid: P3, name: 'Carol' }]);
  const { app, values } = selfApp(owned);
  // 前の版の画面が UID のまま保存していた
  values.set(selfKeyOf('仲間'), P2);
  app.self.reload(selfKeyOf('仲間'));
  const card = ownedSettingsCard(app, { win: DROP_WIN });
  const select = selfSelectOf(card.element);
  assert.deepEqual(select.children.map((node) => node.value), ['', `i:${IID_ALICE}`, `i:${IID_BOB}`, keyOf(P3)]);
  assert.equal(select.value, `i:${IID_BOB}`);
  assert.deepEqual([...app.ideals.selfUids()], [P2]);
  select.value = `i:${IID_ALICE}`;
  select.dispatch('change');
  assert.equal(values.get(selfKeyOf('仲間')), `i:${IID_ALICE}`);
  assert.deepEqual([...app.ideals.selfUids()], [P1]);
  // 選んだプレイヤーの UID（H 以外）を覚える（InstanceId のない共有で引くため。self-player.js）
  select.value = `i:${IID_BOB}`;
  select.dispatch('change');
  assert.equal(values.get(selfKeyOf('仲間')), `i:${IID_BOB}|${P2}`);
  card.destroy();
});

test('設定画面（このワールドでの自分）: 保存した i: を InstanceId のない共有（版 12 の GAS・古い画面）で見分けられなければ、そう出して自動の規則も使わない。覚えた UID で引ければその人を選ぶ（server の identity）', async (t) => {
  installDom(t);
  const IID_ALICE = '11111111-2222-3333-4444-555555555555';
  // ログイン中の Alice と同じ名前のプレイヤー（P1）がいる共有。InstanceId はない
  const owned = guestOwned();
  const { app, values } = selfApp(owned, { userId: 'Alice', users: ['Alice', '仲間'] });
  const key = app.self.key(SELF_WORLD);
  values.set(key, `i:${IID_ALICE}`);
  app.self.reload(key);
  const card = ownedSettingsCard(app, { win: DROP_WIN });
  const select = selfSelectOf(card.element);
  assert.equal(select.children[0].textContent, '選んだ自分（この共有では見分けられません）');
  assert.equal(select.value, '');
  assert.deepEqual([...app.ideals.selfUids()], []);
  assert.equal(app.ideals.mine(), null);
  card.destroy();
  // 前の版の通知・ブックマーク（open=auto）は、自分が決まっていないので自分の選択へ
  let view = await openSettings(app, `#/settings?world=${SELF_WORLD}&open=auto`);
  assert.equal(document.activeElement, selfSelectOf(view.element));
  closeSettings(view);
  // 覚えた UID（P2）があれば、その人を選び、自動の名前も出す
  values.set(key, `i:${IID_ALICE}|${P2}`);
  app.self.reload(key);
  view = await openSettings(app, `#/settings?world=${SELF_WORLD}`);
  const again = selfSelectOf(view.element);
  assert.deepEqual([again.children[0].textContent, again.value], ['自動（Alice）', keyOf(P2)]);
  assert.deepEqual([...app.ideals.selfUids()], [P2]);
  closeSettings(view);
});

test('設定画面（このワールドでの自分）: 表示するワールドが替わった直後に、まだ前のワールドの選択肢で選んでも保存せず、離れたら今のワールドの選択肢に作り直す', async (t) => {
  installDom(t);
  const owned = guestOwned();
  const { app, values } = selfApp(owned);
  const card = ownedSettingsCard(app, { win: DROP_WIN });
  document.body.append(card.element);
  const select = selfSelectOf(card.element);
  const before = select.children.map((node) => node.textContent);
  // 選んでいる途中に、別のワールド（プレイヤーは Carol だけ）に替わった。選択肢はフォーカスが外れるまで作り直さない
  select.focus();
  const OTHER = 'FEDCBA9876543210FEDCBA9876543210';
  owned.state.meta = { ...owned.state.meta, worldId: OTHER };
  owned.state.owned = normalizeOwned({ ...holderSnapshot, players: [{ uid: P3, name: 'Carol', level: 1 }] }, { pals, passives });
  owned.emit();
  assert.deepEqual(select.children.map((node) => node.textContent), before);
  // 前のワールドの Bob を選んでも、どちらのワールドのキーにも保存しない
  select.value = keyOf(P2);
  await select.dispatch('change');
  assert.equal(values.has(selfKeyOf('仲間')), false);
  assert.equal(values.has(`pal-note.ideals.self.test.仲間.${OTHER}`), false);
  document.activeElement = document.body;
  await select.dispatch('blur');
  await settle();
  assert.deepEqual(select.children.map((node) => node.textContent), ['未設定（自分の個体を判定しません）', 'Carol']);
  assert.equal(select.value, '');
  // 作り直した後は、今のワールドに保存する
  select.value = keyOf(P3);
  await select.dispatch('change');
  assert.equal(values.get(`pal-note.ideals.self.test.仲間.${OTHER}`), keyOf(P3));
  card.destroy();
});

test('設定画面: 「このワールドでの自分」の説明は選択の説明（aria-describedby）で、登録者の行のプレイヤーの名前は自分の選択肢と同じ付け方', (t) => {
  installDom(t);
  // 同じ名前の 2 人（Bob）と名前のないプレイヤーがいるホスト
  const owned = hostOwned();
  owned.state.local.snapshot = { ...owned.state.local.snapshot, players: [{ uid: P1, name: 'Bob', level: 1 }, { uid: P2, name: 'Bob', level: 1 }, { uid: P3, name: '', level: 1 }] };
  owned.state.owned = normalizeOwned(owned.state.local.snapshot, { pals, passives });
  const { app } = selfApp(owned, { userId: '仲間', users: ['仲間'], autoRegister: fakeAutoRegister() });
  const card = ownedSettingsCard(app, { win: DROP_WIN });
  const select = selfSelectOf(card.element);
  const note = card.element.querySelector('.owned-self-note');
  assert.ok(note.id);
  assert.equal(select.getAttribute('aria-describedby'), note.id);
  const names = select.children.slice(1).map((node) => node.textContent);
  assert.deepEqual(names, ['Bob（00000000）', 'Bob（ABCD1234）', '不明なプレイヤー（1A2B3C4D）']);
  const rows = card.element.querySelectorAll('.owned-breeding-player');
  assert.deepEqual(rows.map((row) => row.children[0].textContent), names);
  assert.deepEqual(rows.map((row) => row.children[1].getAttribute('aria-label')), names.map((name) => `${name}のノートの ID`));
  card.destroy();
});

test('継承ルート: 「N 通り」の中は相手親を持っている配合を先に（同じ側は図鑑順のまま）。相手親はタマゴ・グローバルパルボックスを数えず、見出しに持っている段の数', (t) => {
  installDom(t);
  // 運ぶモコロン（♀・職人気質）と、相手親の候補: ツッパニャン（No.2）はグローバルパルボックスだけ、クレメーオは ♂ を持っている
  const data = {
    version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', hostName: 'Alice', updatedAt: '2026-10-05T00:00:00.000Z' },
    snapshot: {
      version: 1, world: { name: 'テスト', hostName: 'Alice' }, players: [{ uid: P1, name: 'Alice', level: 50 }], bases: [], stats: {},
      pals: [
        { instanceId: 'a', characterId: 'SheepBall', gender: 'Female', level: 12, rank: 1, passives: ['CraftSpeed_up2'], talent: {}, location: { kind: 'palbox', playerUid: P1, slotIndex: 0 } },
        { instanceId: 'b', characterId: 'PinkCat', gender: 'Male', level: 3, rank: 1, passives: [], talent: {}, location: { kind: 'global', playerUid: '' } },
        { instanceId: 'c', characterId: 'CatMage', gender: 'Male', level: 3, rank: 1, passives: [], talent: {}, location: { kind: 'party', playerUid: P1 } },
      ],
    },
  };
  const records = [
    { id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 },
    { id: 'r2', parent1Id: 'SheepBall', parent2Id: 'CatMage', childId: 'CuteFox', confirmCount: 1 },
  ];
  const view = inheritanceView(context(fakeOwned(data), records), parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  const notes = view.element.querySelectorAll('.route-owned-note').map((node) => node.textContent);
  assert.deepEqual(notes, [
    '相手親のクレメーオ: ♂1 ♀0（うちパッシブ一致 0 体）所持パルで見る',
    '相手親のツッパニャン: タマゴ等だけ（親にできる個体なし）所持パルで見る',
  ]);
  // 式の並びも同じ順（相手親を持っているクレメーオが先）
  const partners = view.element.querySelectorAll('.breeding-equation').map((node) => node.querySelectorAll('strong')[1].textContent);
  assert.deepEqual(partners, ['クレメーオ', 'ツッパニャン']);
  assert.equal(view.element.querySelector('.route-owned-badge').textContent, '相手親 1/1 段で所持');
  view.destroy();
});

test('ワールドの登録（roles）: 背景のクリックでは閉じず、ダイアログのどこに落としても受け取り、LocalData.sav だけで参加と判定したらホストの組を薄くする', async (t) => {
  const owned = fakeOwned();
  owned.previewRegistration = async (input) => ({ ...input, kind: 'guest', role: 'guest', name: '', hostName: '', palCount: 0, replaced: [] });
  const { dialog, path, save: register } = await openRegister(t, owned);
  // 背景（ダイアログ自身）のクリックでは閉じない（C-26）
  await dialog.dispatch('click', { target: dialog });
  assert.equal(dialog.open, true);
  path.value = WORLD_PATH;
  await path.dispatch('input');
  // 枠の外（ダイアログ）に落としても受け取る
  await dialog.dispatch('drop', { target: dialog, dataTransfer: dropped('LocalData.sav'), preventDefault() {} });
  await tick();
  await tick();
  const [, host] = dialog.querySelectorAll('.owned-draft-group');
  assert.match(host.className, /is-dim/);
  assert.equal(host.querySelector('.owned-draft-title').textContent, 'ホストする PC（協力プレイで交代でホストする人も。なくても参加者として登録できます）');
  // 参加者として登録する結果欄には、協力プレイで交代でホストするならホストの組のファイルも足すこと（host-rotation・server の participant-ui）
  assert.equal(dialog.querySelector('.owned-dialog-result').textContent, '参加者として登録します（協力プレイで交代でホストするなら Level.sav・LevelMeta.sav・Players のファイルも足すと、ホストしたときに共有と自動登録が動きます）');
  assert.equal(register.disabled, false);
});

test('所持パル画面（配合牧場の帯）: 牧場の情報があれば「配合牧場（N か所 · タマゴ M 個）」の帯を出し、既定は閉じてカードを作らない。開閉は viewState に残し、「右に開く」はドロワー', (t) => {
  installDom(t);
  const owned = fakeOwned();
  owned.state.owned.farms = [{ id: 'F1', baseId: '', parents: ['a'], status: 'ok', eggs: [], eggCount: 2 }, { id: 'F2', baseId: '', parents: [], status: 'ok', eggs: [], eggCount: 0 }];
  const memory = {};
  const opened = [];
  const app = { ...context(owned), viewState: () => memory, drawer: { open: (entry) => opened.push(entry), current: () => null, subscribe: () => () => {} } };
  const view = ownedView(app, parseHash('#/owned'));
  const band = view.element.querySelector('.farm-band');
  assert.equal(band.hidden, false);
  const toggle = band.querySelector('.farm-band-toggle');
  assert.equal(toggle.textContent, '配合牧場（2 か所 · タマゴ 2 個）');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(band.querySelectorAll('.farm-card').length, 0);
  toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(band.querySelectorAll('.farm-card').length, 2);
  assert.equal(memory.farmsOpen, true);
  view.destroy();
  // 開いたまま作り直しても開いている（タブを替えて戻ったとき）
  const again = ownedView(app, parseHash('#/owned'));
  assert.equal(again.element.querySelector('.farm-band-toggle').getAttribute('aria-expanded'), 'true');
  again.element.querySelector('.farm-band-open').dispatch('click');
  assert.deepEqual(opened, [{ kind: 'farms', id: '' }]);
  again.destroy();
  // ケーキ切れの牧場（cakes が []。ケーキの分かる牧場だけ）があれば、閉じた 1 行に「· ケーキ切れ n」（警告の色。分からない null は数えない）
  owned.state.owned.farms = [
    { id: 'F1', baseId: '', parents: ['a'], status: 'ok', eggs: [], eggCount: 2, cakes: [] },
    { id: 'F2', baseId: '', parents: [], status: 'ok', eggs: [], eggCount: 0, cakes: null },
    { id: 'F3', baseId: '', parents: [], status: 'ok', eggs: [], eggCount: 0, cakes: [{ itemId: 'Cake', count: 1 }] },
  ];
  memory.farmsOpen = false;
  const cakes = ownedView(app, parseHash('#/owned'));
  const line = cakes.element.querySelector('.farm-band-toggle');
  assert.equal(line.textContent, '配合牧場（3 か所 · タマゴ 2 個 · ケーキ切れ 1）');
  assert.equal(line.querySelector('.farm-band-alert').textContent, 'ケーキ切れ 1');
  cakes.destroy();
  // 牧場の情報がないデータでは帯を出さない
  owned.state.owned.farms = null;
  const none = ownedView(context(owned), parseHash('#/owned'));
  assert.equal(none.element.querySelector('.farm-band').hidden, true);
  none.destroy();
});

test('継承ルート（route-progress）: 選んだパッシブをすべて持つ個体がいなければ、パッシブ 1 つずつの経路と「理想個体で合わせる」。見出しの右に「理想個体でこの目標を見る」', (t) => {
  installDom(t);
  const records = [{ id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 }];
  const view = inheritanceView(context(fakeOwned(), records), parseHash('#/route?to=CuteFox&p=Rare,Legend'));
  const split = view.element.querySelector('.route-split');
  assert.equal(split.hidden, false);
  assert.equal(split.querySelector('.route-split-title').textContent, '1 つずつなら運べます');
  const items = split.querySelectorAll('li').map((item) => item.textContent);
  assert.deepEqual(items, ['希少を運ぶ: 最短 1 回（開始 モコロン）', '伝説: 所持パルから運べません']);
  assert.equal(split.querySelector('.route-split-link').href, '#/route?to=CuteFox&p=Rare');
  assert.equal(split.querySelector('.route-split-ideal').href, `#/ideal?to=CuteFox&p=${encodeURIComponent('Rare,Legend')}`);
  assert.equal(view.element.querySelector('.route-cross').href, `#/ideal?to=CuteFox&p=${encodeURIComponent('Rare,Legend')}`);
  view.destroy();
  // すべて持つ個体がいれば（開始の候補が出る）出さない
  const all = inheritanceView(context(fakeOwned(), records), parseHash('#/route?to=CuteFox&p=CraftSpeed_up2,Rare'));
  assert.equal(all.element.querySelector('.route-split').hidden, true);
  all.destroy();
});

test('継承ルート（route-progress）: 段に「牧場に配置中」「タマゴあり」「✓ 所持」と次の段の印。相手親の数のチップを押すと右のドロワーにその種族の所持個体', (t) => {
  installDom(t);
  const records = [{ id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 }];
  const egg = { instanceId: 'fox-egg', characterId: 'CuteFox', passives: ['CraftSpeed_up2'], talent: {}, location: { kind: 'egg-ground', playerUid: P1 } };
  const data = { version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', hostName: 'Alice', updatedAt: '2026-10-05T00:00:00.000Z' }, snapshot: { ...snapshot, pals: [...snapshot.pals, egg] } };
  const owned = fakeOwned(data);
  owned.state.owned.farms = [{ id: 'F1', baseId: '', parents: ['a', 'b'], status: 'ok', eggs: [], eggCount: 0 }];
  const opened = [];
  const app = { ...context(owned, records), drawer: { open: (entry) => opened.push(entry) } };
  const view = inheritanceView(app, parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  const note = view.element.querySelector('.route-owned-note');
  assert.equal(note.querySelector('.route-farm-badge').textContent, '牧場に配置中（拠点の牧場）');
  const eggBadge = note.querySelector('.route-egg-badge');
  assert.equal(eggBadge.textContent, 'タマゴあり');
  assert.equal(eggBadge.href, '#/owned?pal=CuteFox&place=egg&p=CraftSpeed_up2');
  // 段の子（キツネビ）を運ぶパッシブつきで（タマゴでなく）持っていないので、最初の段が次の段
  const step = view.element.querySelector('.route-breeding-card');
  assert.ok(step.className.split(' ').includes('route-step-next'));
  assert.equal(step.getAttribute('aria-current'), 'step');
  assert.equal(step.querySelector('.route-step-done'), null);
  // 相手親のチップ（文はそのまま）を押すとドロワー
  const chip = note.querySelector('.route-partner-chip');
  assert.equal(chip.tagName, 'button');
  assert.match(chip.textContent, /^相手親のツッパニャン: ♂1 ♀0（うちパッシブ一致 0 体）$/);
  chip.dispatch('click');
  assert.deepEqual(opened, [{ kind: 'species', id: 'PinkCat', params: { p: 'CraftSpeed_up2' } }]);
  view.destroy();
  // 牧場の情報がない（farms: null）なら「牧場に配置中」を出さない。段の子を持っていれば ✓
  owned.state.owned.farms = null;
  owned.state.owned.pals = [...owned.state.owned.pals, { ...owned.state.owned.pals.find((pal) => pal.id === 'fox-egg'), id: 'fox', egg: false, place: 'palbox', placeGroup: 'palbox' }];
  const done = inheritanceView({ ...context(owned, records) }, parseHash('#/route?from=SheepBall&to=CuteFox&p=CraftSpeed_up2'));
  assert.equal(done.element.querySelector('.route-farm-badge'), null);
  const doneStep = done.element.querySelector('.route-breeding-card');
  assert.ok(doneStep.className.split(' ').includes('is-done'));
  assert.equal(doneStep.querySelector('.route-step-done').textContent, '✓ 所持');
  done.destroy();
});

test('1 種族の所持個体（species。ドロワーの中身）: 親にできる個体とタマゴ・グローバルを分け、選んだパッシブをすべて持つ個体を上に', async (t) => {
  installDom(t);
  const { speciesOwnedPanel } = await import('../../web/js/views/species-owned.js');
  const panel = speciesOwnedPanel(context(fakeOwned()), 'PinkCat', { passives: [] });
  assert.equal(panel.title, 'ツッパニャンの所持個体');
  assert.equal(panel.element.querySelector('.species-owned-summary').textContent, '所持 2 体 · 親になれる ♂1 ♀0');
  const lists = panel.element.querySelectorAll('.species-owned-rows');
  assert.deepEqual(lists.map((list) => list.querySelectorAll('.owned-row').map((row) => row.getAttribute('data-instance'))), [['b'], ['g']]);
  panel.destroy();
  assert.equal(speciesOwnedPanel(context(fakeOwned()), 'NoSuchPal'), null);
  const none = speciesOwnedPanel(context(fakeOwned()), 'Anubis', { passives: ['Rare'] });
  assert.equal(none.element.querySelector('.species-owned-summary').textContent, '所持していません。');
  none.destroy();
});

test('1 種族の所持個体（species）: 同じ種族をたくさん持っていても、見出しごとに 100 行までを描き、残りは「所持パルで開く」へ案内する', async (t) => {
  installDom(t);
  const { speciesOwnedPanel, SPECIES_OWNED_SHOWN } = await import('../../web/js/views/species-owned.js');
  const many = Array.from({ length: 230 }, (_, i) => ({
    ...snapshot.pals[0], instanceId: `p${i}`, characterId: 'PinkCat', gender: i % 2 ? 'Male' : 'Female',
    location: i < 180 ? { ...snapshot.pals[0].location, kind: 'palbox', playerUid: P1 } : { ...snapshot.pals[0].location, kind: 'global', playerUid: '' },
  }));
  const owned = fakeOwned({ version: 1, importedAt: '2026-10-05T00:00:00.000Z', source: 'handles', world: { id: 'W', dir: 's/W', name: 'テスト', hostName: 'Alice', updatedAt: '2026-10-05T00:00:00.000Z' }, snapshot: { ...snapshot, pals: many } });
  const panel = speciesOwnedPanel(context(owned), 'PinkCat');
  assert.equal(SPECIES_OWNED_SHOWN, 100);
  assert.match(panel.element.querySelector('.species-owned-summary').textContent, /^所持 230 体/);
  const lists = panel.element.querySelectorAll('.species-owned-rows');
  assert.deepEqual(lists.map((list) => list.querySelectorAll('.owned-row').length), [100, 50]);
  const notes = panel.element.querySelectorAll('.species-owned-more');
  assert.deepEqual(notes.map((note) => [note.hidden, note.textContent]), [[false, 'ほか 80 体は「所持パルで開く」で見られます。'], [true, '']]);
  assert.equal(panel.element.querySelector('.species-owned-open').hidden, false);
  panel.destroy();
});

test('所持パル画面（種族の見出し）: 図鑑順のときだけ種族の見出し（数・♂♀・タマゴ・最高 Lv と行き先）を混ぜ、畳むと個体の行が消えて viewState に残る。「種族を畳む／開く」', (t) => {
  installDom(t);
  const memory = {};
  const app = { ...context(fakeOwned()), viewState: () => memory, replace: () => {} };
  const view = ownedView(app, parseHash('#/owned?holder='));
  const heads = () => view.element.querySelectorAll('.owned-species');
  assert.ok(heads().length >= 2);
  assert.equal(heads()[0].querySelector('.owned-species-name').textContent, 'No.1 モコロン');
  const sheep = heads()[0];
  assert.match(sheep.querySelector('.owned-species-facts').textContent, /^1 体 · ♂0 ♀1 · 最高 Lv 12$/);
  assert.deepEqual(sheep.querySelectorAll('a').map((node) => node.href), ['#/ideal?to=SheepBall', '#/route?to=SheepBall', '#/search?c=SheepBall']);
  // 行き先のリンクの名前には種族の名前を入れる（見えている文を含む）
  assert.deepEqual(sheep.querySelectorAll('a').map((node) => node.getAttribute('aria-label')), ['モコロンの理想個体', 'モコロンへの継承ルート', 'モコロンが産まれる配合']);
  const toggle = sheep.querySelector('.owned-species-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  const rowsOf = (palId) => view.element.querySelectorAll('.owned-row').filter((row) => row.getAttribute('data-instance') === 'a').length;
  assert.equal(rowsOf('SheepBall'), 1);
  toggle.dispatch('click');
  assert.equal(rowsOf('SheepBall'), 0);
  assert.equal(heads()[0].querySelector('.owned-species-toggle').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(memory.collapsed, ['SheepBall']);
  view.destroy();
  // 作り直しても畳んだまま（タブを替えて戻ったとき）。「種族を開く／畳む」
  const again = ownedView(app, parseHash('#/owned?holder='));
  assert.equal(again.element.querySelectorAll('.owned-row').filter((row) => row.getAttribute('data-instance') === 'a').length, 0);
  const fold = again.element.querySelector('.owned-fold-all');
  assert.equal(fold.hidden, false);
  assert.equal(fold.textContent, '種族を畳む');
  fold.dispatch('click');
  assert.equal(again.element.querySelectorAll('.owned-row').length, 0);
  assert.equal(fold.textContent, '種族を開く');
  fold.dispatch('click');
  assert.ok(again.element.querySelectorAll('.owned-row').length > 0);
  again.destroy();
  // 図鑑順以外では見出しを出さない
  const byLevel = ownedView(app, parseHash('#/owned?holder=&sort=level'));
  assert.equal(byLevel.element.querySelectorAll('.owned-species').length, 0);
  assert.equal(byLevel.element.querySelector('.owned-fold-all').hidden, true);
  byLevel.destroy();
});

test('継承ルート（implants）: 選んだ運びたいパッシブのうちパル手術台で付けられるものに 1 行（開始の行の下・経路の上）。開始のチップ・探索は変えない', (t) => {
  installDom(t);
  const records = [{ id: 'r1', parent1Id: 'SheepBall', parent2Id: 'PinkCat', childId: 'CuteFox', confirmCount: 1 }];
  const app = context(fakeOwned(), records);
  const note = (view) => view.element.querySelector('.route-surgery');
  // 職人気質（インプラント）を運ぶ: 開始の候補（モコロン）はそのまま、1 行を足す
  const view = inheritanceView(app, parseHash('#/route?to=CuteFox&p=CraftSpeed_up2'));
  assert.equal(note(view).hidden, false);
  assert.equal(note(view).textContent, '職人気質はパル手術台で付けられます（インプラント）。運ばずに、できた個体に付けることもできます。');
  assert.ok(view.element.querySelectorAll('.start-chip').length >= 2);
  // 2 つ以上は種類を名前ごとに。付けられないもの（希少）は数えない
  view.applyRoute(parseHash('#/route?to=CuteFox&p=CraftSpeed_up2,Rare,MoveSpeed_up_3,PAL_ALLAttack_up1'));
  assert.equal(note(view).textContent, '職人気質（インプラント）・神速（使い切りインプラント）・勇敢（インプラント不要）はパル手術台で付けられます。運ばずに、できた個体に付けることもできます。');
  // 付けられるものがない・目標がないときは出さない
  view.applyRoute(parseHash('#/route?to=CuteFox&p=Rare'));
  assert.equal(note(view).hidden, true);
  view.applyRoute(parseHash('#/route?p=MoveSpeed_up_3'));
  assert.equal(note(view).hidden, true);
  view.destroy();
});

// ---------------------------------------------------------------------------
// server の mapping: 設定の「プレイヤーの対応」を GAS で動いているときは誰でも選べる（行は表示しているデータのプレイヤーと以前の持ち主）
// ---------------------------------------------------------------------------
const MAP_WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const MAP_HOST = '00000000-0000-0000-0000-000000000001';
const MAP_U = '11111111-2222-3333-4444-555555555555';
const MAP_GONE = '33333333-4444-5555-6666-777777777777';
// GAS で動いている自動登録（対応はノート。setMapping は Promise。fail を入れるとその文で断る）
function gasAutoRegister({ mapping = {}, fail = '' } = {}) {
  const calls = [];
  return {
    calls, map: { ...mapping }, fail,
    enabled: () => true, setEnabled() {}, subscribe: () => () => {},
    mappingMode: () => 'gas',
    mapping() { return this.map; },
    refreshMapping(worldId, maxAge) { calls.push(['refresh', worldId, maxAge]); return Promise.resolve(); },
    setMapping(uid, userId, worldId) {
      calls.push(['map', uid, userId, worldId]);
      if (this.fail) return Promise.reject(new Error(this.fail));
      this.map = userId ? { ...this.map, [uid]: userId } : Object.fromEntries(Object.entries(this.map).filter(([key]) => key !== uid));
      return Promise.resolve();
    },
    pendingSummary: () => ({ unmapped: [], conflict: [] }),
  };
}
// サーバーのワールドの共有を表示している（H はプレイヤーにいない。以前のホストと、ワールドにいない人が預けたパルがある）
function serverShared(role) {
  const owned = fakeOwned(null);
  Object.assign(owned.state, {
    role,
    owned: {
      players: [{ uid: MAP_U, name: 'Bob', instanceId: 'abcdef01-0000-0000-0000-000000000001' }], pals: [],
      formers: [{ uid: MAP_HOST, kind: 'host', pals: 66, farms: 2 }, { uid: MAP_GONE, kind: 'unknown', pals: 5, farms: 0 }],
    },
    meta: { worldId: MAP_WORLD, worldName: 'テストのワールド', hostName: '', source: 'shared', saveUpdatedAt: '2026-10-18T00:00:00.000Z', importedAt: '', sharedAt: '2026-10-18T00:01:00.000Z', uploadedBy: 'サーバー', palCount: 0 },
  });
  return owned;
}
function gasContext(owned, autoRegister) {
  const ctx = { ...context(owned), autoRegister };
  Object.assign(ctx.store.state, { passcode: '入力', users: ['仲間', 'Bob'] });
  return ctx;
}
const playerRows = (root) => root.querySelector('.owned-players').querySelectorAll('.owned-breeding-player');

test('設定画面（server の mapping）: GAS で動いていれば、参加者・共有を見ている人にも選択を出し、以前のホスト・不明なプレイヤーの行に預けた数を添える', async (t) => {
  for (const role of ['guest', 'none']) {
    installDom(t);
    const autoRegister = gasAutoRegister({ mapping: { [MAP_GONE]: 'Bob' } });
    const card = ownedSettingsCard(gasContext(serverShared(role), autoRegister), { win: DROP_WIN });
    const section = card.element.querySelector('.owned-players');
    assert.equal(section.hidden, false, role);
    assert.match(section.textContent, /ノートに保存し、仲間と共有します（どの PC からでも選べます）/);
    assert.doesNotMatch(section.textContent, /ホストの PC で設定します/);
    const rows = playerRows(card.element);
    assert.deepEqual(rows.map((row) => row.querySelector('span').textContent), ['Bob', '以前のホスト（0000…0001）拠点 66 体・牧場 2 か所', '不明なプレイヤー（33333333）拠点 5 体']);
    assert.deepEqual(rows.map((row) => row.querySelector('.owned-former-count')?.textContent ?? ''), ['', '拠点 66 体・牧場 2 か所', '拠点 5 体']);
    const selects = rows.map((row) => row.querySelector('select'));
    assert.deepEqual(selects.map((select) => select.getAttribute('aria-label')), ['Bobのノートの ID', '以前のホスト（0000…0001）のノートの ID', '不明なプレイヤー（33333333）のノートの ID']);
    // Bob は同じ名前のユーザー、以前の持ち主には同じ名前の人がいない。選んだ対応を出す
    assert.deepEqual(selects.map((select) => select.children[0].textContent), ['Bob（同じ名前）', '未設定（登録しない）', '未設定（登録しない）']);
    assert.deepEqual(selects.map((select) => select.value), ['', '', 'Bob']);
    // 正確にしたい牧場は親を預け直す、の 1 行。登録待ちはこの PC の候補なので出さない
    assert.match(section.querySelector('.owned-former-note').textContent, /親を預け直してください/);
    assert.equal(section.querySelector('.owned-pending'), null);
    // 描くときに GAS の対応を読み直す（15 秒）
    assert.deepEqual(autoRegister.calls[0], ['refresh', MAP_WORLD, 15000]);
    // 以前のホストを選ぶ: 表示しているワールドに書き、欄は作り直さない（選んだ select のまま）
    selects[1].value = '仲間';
    await selects[1].dispatch('change');
    assert.deepEqual(autoRegister.calls.at(-1), ['map', MAP_HOST, '仲間', MAP_WORLD]);
    assert.equal(playerRows(card.element)[1].querySelector('select'), selects[1]);
    card.destroy();
  }
});

test('設定画面（server の mapping）: 描いた後に GAS の対応を読み終えたら（自動登録の知らせ）、所持パルの変化を待たずに欄を出す', (t) => {
  installDom(t);
  // 開いたときはまだ GAS から読めていない（前の版の扱い）。共有を見ている人には欄を出さない
  const listeners = new Set();
  const autoRegister = { ...gasAutoRegister(), mode: 'legacy', subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
  autoRegister.mappingMode = () => autoRegister.mode;
  const card = ownedSettingsCard(gasContext(serverShared('none'), autoRegister), { win: DROP_WIN });
  const section = card.element.querySelector('.owned-players');
  assert.equal(section.hidden, true);
  // 読み終えた（auto-register.js は playerMaps の知らせで changed を呼ぶ）
  autoRegister.mode = 'gas';
  listeners.forEach((listener) => listener());
  assert.equal(section.hidden, false);
  assert.deepEqual(playerRows(card.element).map((row) => row.querySelector('select').getAttribute('aria-label')), ['Bobのノートの ID', '以前のホスト（0000…0001）のノートの ID', '不明なプレイヤー（33333333）のノートの ID']);
  card.destroy();
});

test('設定画面（server の mapping）: 対応を保存できなければトーストで知らせ、元の対応で欄を作り直す', async (t) => {
  installDom(t);
  const autoRegister = gasAutoRegister({ fail: 'サーバに接続できません' });
  const owned = serverShared('guest');
  const card = ownedSettingsCard(gasContext(owned, autoRegister), { win: DROP_WIN });
  const select = playerRows(card.element)[0].querySelector('select');
  select.value = '仲間';
  await select.dispatch('change');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(document.body.querySelectorAll('.toast-message').some((node) => node.textContent === 'サーバに接続できません'));
  const rebuilt = playerRows(card.element)[0].querySelector('select');
  assert.notEqual(rebuilt, select);
  assert.equal(rebuilt.value, '');
  card.destroy();
});

test('設定画面（server の mapping）: ホストは GAS で動いていても登録待ちを出し、前の版で動いているときの参加者は今までどおり案内だけ', (t) => {
  installDom(t);
  // ホスト（手元のデータを表示している）
  const owned = fakeOwned();
  const autoRegister = gasAutoRegister();
  autoRegister.pendingSummary = () => ({ unmapped: [{ uid: P1, name: 'Alice', parents: ['SheepBall', 'PinkCat'] }], conflict: [] });
  const card = ownedSettingsCard(gasContext(owned, autoRegister), { win: DROP_WIN });
  const section = card.element.querySelector('.owned-players');
  assert.equal(section.querySelector('.owned-pending').hidden, false);
  assert.deepEqual(playerRows(card.element).map((row) => row.querySelector('span').textContent), ['Alice']);
  card.destroy();
  // 参加者（手元にも同じワールドのデータがある）には出さない（登録待ちは、この PC がホストとして読んだ候補だけ）
  const guestLocal = ownedSettingsCard(gasContext(fakeOwned(undefined, { role: 'guest' }), autoRegister), { win: DROP_WIN });
  assert.deepEqual(playerRows(guestLocal.element).map((row) => row.querySelector('span').textContent), ['Alice']);
  assert.equal(guestLocal.element.querySelector('.owned-players').querySelector('.owned-pending'), null);
  guestLocal.destroy();
  // 前の版（古い GAS）の参加者
  const legacy = { ...gasAutoRegister(), mappingMode: () => 'legacy' };
  const guest = ownedSettingsCard(gasContext(serverShared('guest'), legacy), { win: DROP_WIN });
  assert.equal(guest.element.querySelector('.owned-players').textContent, 'プレイヤーの対応（セーブのプレイヤー → ノートの ID）プレイヤーの対応はホストの PC で設定します。自分の個体は「このワールドでの自分」で選べます。');
  assert.equal(playerRows(guest.element).length, 0);
  guest.destroy();
  // ログインしていなければ（前の版の扱い）共有を見ている人には出さない
  const viewer = gasContext(serverShared('none'), gasAutoRegister());
  viewer.store.state.passcode = '';
  const hidden = ownedSettingsCard(viewer, { win: DROP_WIN });
  assert.equal(hidden.element.querySelector('.owned-players').hidden, true);
  hidden.destroy();
});
