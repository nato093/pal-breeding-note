// 所持パルの案内（ui/owned-status.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownedNotices } from '../../web/js/ui/owned-status.js';
import { installDom } from '../helpers/dom.js';

const SAVED = new Date(2026, 9, 10, 9, 0).toISOString();

// 所持パルの状態（owned.js の state と同じ形。必要なところだけ）
function ownedState(overrides = {}) {
  return {
    ready: true, busy: false, progress: '', error: '',
    auto: { enabled: true, status: 'ready', worlds: [{ id: 'W' }], worldId: '', error: '' },
    role: 'host', shared: { worlds: [], current: null, fetchedAt: '', error: '' }, upload: { status: '', at: '', error: '', worldId: '' },
    data: { source: 'handles', snapshot: { files: { used: ['Level.sav', 'Players/00000000000000000000000000000001.sav'], skipped: [] }, players: [], stats: {} } },
    owned: { pals: Array.from({ length: 1194 }, (_, i) => ({ id: `p${i}` })), stats: {} },
    meta: { worldId: 'W', worldName: 'テスト', hostName: 'Alice', source: 'local', saveUpdatedAt: SAVED, importedAt: SAVED, sharedAt: '', uploadedBy: '', palCount: 1194 },
    ...overrides,
  };
}

test('データ元の 1 行（ownedSourceLine）と状態のスロットの文（activityText・sourceText）はなくした（上のバーのセーブ連携の表示と重なるため。D29）', async () => {
  const status = await import('../../web/js/ui/owned-status.js');
  assert.deepEqual(['ownedSourceLine', 'activityText', 'sourceText'].filter((name) => name in status), []);
});

test('案内: 読み込み中・確認中・共有中は帯に出さない（上のバーのセーブ連携の表示が点で知らせる）。読んでいる間も前回の警告は残す', () => {
  const skipped = { files: { used: ['Level.sav'], skipped: [{ path: 'Players/x.sav', reason: '壊れています' }] }, players: [], stats: {} };
  const state = ownedState({ data: { source: 'handles', snapshot: skipped } });
  const idle = ownedNotices(state).map((notice) => notice.text);
  assert.ok(idle.some((text) => /Players\/x\.sav を読めませんでした/.test(text)));
  const busy = ownedNotices({ ...state, busy: true, progress: 'Level.sav を読み込み中…', upload: { status: 'sending', at: '', error: '', worldId: 'W' } }).map((notice) => notice.text);
  assert.deepEqual(busy, idle);
  assert.deepEqual(ownedNotices(ownedState({ ready: false })), []);
});

test('案内: 自動の読み込みがオフでも、所持パルを表示できているときは登録の案内を出さない。データがないときは 1 文と「ワールドを登録」（copy-dead-ends。前は「設定でワールドを登録してください」と設定へ移るボタン）', () => {
  const off = { enabled: false, status: 'off', worlds: [], worldId: '', error: '' };
  const shared = ownedState({ auto: off, role: '', data: { world: {} }, meta: { ...ownedState().meta, source: 'shared' } });
  assert.deepEqual(ownedNotices(shared), []);
  const none = ownedNotices(ownedState({ auto: off, role: '', data: null, owned: null, meta: null }));
  assert.deepEqual(none, [{ text: 'セーブのファイルが登録されていません。', kind: 'info', action: 'register' }]);
  // 参加している側でデータがないとき（「参加しているワールドのため…」は出さない。取得元は上のバーのセーブ連携の表示に出る）
  const guest = ownedNotices(ownedState({ role: 'guest', data: null, owned: null, meta: null }));
  assert.deepEqual(guest.map((notice) => notice.text), ['ホストがまだこのワールドの所持パルを共有していません。']);
  // データのある参加者は、自動登録はホストの画面が行うことの 1 行（roles。共有が新しいときは、ホスト名で言う）
  const guestShared = ownedNotices(ownedState({ role: 'guest', meta: { ...ownedState().meta, source: 'shared' } }), { now: () => Date.parse(SAVED) });
  assert.equal(guestShared.length, 1);
  assert.match(guestShared[0].text, /^この PC では読み込みません。配合牧場の自動登録は Alice の画面が行います/);
  // 自動の読み込みを使っているのに登録がない（empty）ときも、同じ案内とボタン
  const empty = ownedNotices(ownedState({ auto: { enabled: true, status: 'empty', worlds: [], worldId: '', error: 'セーブのファイルが登録されていません' } }));
  assert.deepEqual(empty, [{ text: 'セーブのファイルが登録されていません。', kind: 'warning', action: 'register' }]);
});

test('案内: 「設定タブの〜」とだけ書かず、1 文と行き先のボタンにする（読めないエラーは設定のセーブ連携、登録されていないプレイヤーはワールドの編集）', () => {
  const error = ownedNotices(ownedState({ auto: { enabled: true, status: 'error', worlds: [{ id: 'W' }], worldId: '', error: '「テスト」を読めません（壊れています）。ファイルを登録し直してください' } }));
  assert.deepEqual(error, [{ text: '「テスト」を読めません（壊れています）。ファイルを登録し直してください', kind: 'warning', action: 'settings' }]);
  const players = ownedNotices(ownedState({ data: { source: 'handles', snapshot: {
    files: { used: ['Level.sav', 'Players/00000000000000000000000000000001.sav'], skipped: [] }, stats: {},
    players: [{ uid: '00000000-0000-0000-0000-000000000002', name: 'Bob', level: 10 }],
  } } }));
  assert.deepEqual(players, [{ text: '登録されていないプレイヤーのファイルがあります: Bob（Players\\00000000000000000000000000000002.sav）。', kind: 'warning', action: 'editWorld' }]);
  for (const notice of [...error, ...players]) assert.doesNotMatch(notice.text, /設定タブ/);
});

test('案内: この PC で読んだセーブに場所の分からないパル・読めなかった項目があれば知らせる（古い形の stats でも壊れない）', () => {
  const withStats = (stats, used = ['Level.sav', 'Players/00000000000000000000000000000001.sav']) => ownedNotices(ownedState({
    data: { source: 'handles', snapshot: { files: { used, skipped: [] }, players: [], stats } },
  }));
  assert.deepEqual(withStats({ unknownLocation: 3 }), [{ text: '場所が分からないパルが 3 体います', kind: 'info', action: 'unknownPlace' }]);
  assert.deepEqual(withStats({ malformed: { 'level.itemSlots': 2, 'player.properties': 1 } }), [{ text: 'セーブの一部を読めませんでした（ゲームの更新で形が変わったかもしれません）', kind: 'warning' }]);
  // 参照されていないタマゴ（ふだんから 0 でないことがある）は出さない
  assert.deepEqual(withStats({ unknownLocation: 0, orphanEggs: 37, malformed: {} }), []);
  // Players の警告が出ているときは、場所の分からないパルの案内を重ねない
  const players = withStats({ unknownLocation: 5 }, ['Level.sav']).map((notice) => notice.text);
  assert.equal(players.length, 1);
  assert.match(players[0], /Players フォルダのセーブを読めなかった/);
  // 古い IndexedDB（stats がない・形が違う）
  for (const stats of [undefined, null, 'x', [], { unknownLocation: 'many', malformed: 'x' }, { unknownLocation: -2, malformed: [3] }, { malformed: { a: 'x', b: null } }]) {
    assert.deepEqual(withStats(stats), [], JSON.stringify(stats));
  }
  // 共有のデータには stats がない（数えない）
  assert.deepEqual(ownedNotices(ownedState({ meta: { ...ownedState().meta, source: 'shared' }, owned: { pals: [], stats: { unknownLocation: 3 } } })), []);
});

test('許可切れの案内（autoreg-visibility）: permissionNotice は許可待ちのときだけ、短い文・勧め・止まった時刻（あれば）を返し、所持パルの案内も同じ文', async () => {
  const { permissionNotice, PERMISSION_TEXT, PERMISSION_HINT, ownedNotices } = await import('../../web/js/ui/owned-status.js');
  const now = () => new Date(2026, 9, 15, 15, 0).getTime();
  const state = (auto) => ({ ready: true, auto: { enabled: true, worlds: [{ id: 'W' }], error: '', ...auto } });
  assert.equal(permissionNotice(state({ status: 'ready' }), { now }), null);
  assert.equal(permissionNotice(state({ status: 'permission', enabled: false }), { now }), null);
  assert.deepEqual(permissionNotice(state({ status: 'permission' }), { now }), { text: PERMISSION_TEXT, hint: PERMISSION_HINT, since: '' });
  assert.equal(PERMISSION_TEXT, 'セーブを読む許可が必要です');
  assert.match(PERMISSION_HINT, /毎回のアクセスを許可/);
  const stopped = permissionNotice(state({ status: 'permission', stoppedAt: new Date(2026, 9, 15, 14, 32).toISOString() }), { now });
  assert.equal(stopped.since, '14:32 から読めていません。この間に拾ったタマゴは自動登録されていない場合があります');
  // 日が違えば日付も
  assert.match(permissionNotice(state({ status: 'permission', stoppedAt: new Date(2026, 9, 14, 23, 5).toISOString() }), { now }).since, /^10\/14 23:05 から/);
  // 所持パルの案内: 1 文と止まった時刻、勧めは小さな 2 行目（hint）
  const [notice] = ownedNotices(state({ status: 'permission', error: '古い長い文', stoppedAt: '' }));
  assert.deepEqual([notice.text, notice.hint, notice.action], ['セーブを読む許可が必要です。', `${PERMISSION_HINT}。`, 'grant']);
});

test('許可切れの案内（autoreg-visibility）: grantWithReport は許可されなかったとき（一部でも・読み直しが許可待ちで止まった）に直し方のトーストを出す', async (t) => {
  installDom(t);
  const { grantWithReport, PERMISSION_DENIED } = await import('../../web/js/ui/owned-status.js');
  const shown = () => document.body.querySelectorAll('.toast-message').map((node) => node.textContent);
  await grantWithReport({ grantAndRefresh: () => Promise.resolve({ granted: 4, total: 4, result: 'imported' }) });
  assert.deepEqual(shown(), []);
  await grantWithReport({ grantAndRefresh: () => Promise.resolve({ granted: 1, total: 4, result: 'imported' }) });
  assert.deepEqual(shown(), [PERMISSION_DENIED]);
  await grantWithReport({ grantAndRefresh: () => Promise.reject(Object.assign(new Error('セーブを読む許可が必要です'), { code: 'permission' })) });
  assert.deepEqual(shown(), [PERMISSION_DENIED, PERMISSION_DENIED]);
  await grantWithReport({ grantAndRefresh: () => Promise.reject(new Error('読めませんでした')) });
  assert.deepEqual(shown().at(-1), '読めませんでした');
});

test('今すぐ読み込む（save-watch）: refreshNow は一式を採用せずに読み直しを待つ（held）ときだけ知らせ、結果をそのまま返す', async (t) => {
  installDom(t);
  const { refreshNow, HELD_TEXT } = await import('../../web/js/ui/owned-status.js');
  const shown = () => document.body.querySelectorAll('.toast-message').map((node) => node.textContent);
  const calls = [];
  const owned = (result) => ({ refreshAuto: (options) => { calls.push(options); return Promise.resolve(result); } });
  assert.equal(await refreshNow(owned('imported')), 'imported');
  assert.deepEqual(shown(), []);
  assert.equal(await refreshNow(owned('held')), 'held');
  assert.deepEqual(shown(), [HELD_TEXT]);
  assert.deepEqual(calls, [{ enable: true }, { enable: true }]);
  await assert.rejects(refreshNow({ refreshAuto: () => Promise.reject(new Error('読めませんでした')) }), /読めませんでした/);
});

test('役割の 1 行（roles）: ホスト・参加者（10 分の境目で warning）・共有を見ている人。共有を見ていない未連携は null', async () => {
  const { roleSummary, HOST_SUMMARY, timeAgo, ownedNotices } = await import('../../web/js/ui/owned-status.js');
  const now = () => Date.parse('2026-10-15T12:00:00.000Z');
  const minutesAgo = (minutes) => new Date(now() - minutes * 60000).toISOString();
  const shared = (role, minutes, players = [{ uid: 'u1', name: 'Alice' }, { uid: 'u2', name: '仲間' }]) => ({
    ready: true, role, auto: { enabled: role === 'guest', status: 'ready', worlds: [] },
    meta: { source: 'shared', worldId: 'W', worldName: 'テスト', hostName: 'Host', uploadedBy: 'Alice', sharedAt: minutesAgo(minutes), saveUpdatedAt: minutesAgo(minutes + 1) },
    owned: { players, pals: [] },
  });
  assert.deepEqual(roleSummary({ role: 'host', meta: { source: 'local' } }, { now }), { text: HOST_SUMMARY, kind: 'info', hint: '' });
  const guest = roleSummary(shared('guest', 3), { userId: '仲間', now });
  assert.deepEqual([guest.kind, guest.hint], ['info', '']);
  assert.equal(guest.text, 'この PC では読み込みません。配合牧場の自動登録は Alice の画面が行います（Alice が自動登録をオンにしていて、プレイヤーの対応であなたが選ばれているとき） · 最後の共有 3 分前（Alice の PC から）');
  // 参加者に「自動登録は動きません」「設定タブの『登録者の対応』」と言わない
  assert.doesNotMatch(guest.text, /動きません|設定タブ|登録者の対応/);
  // 10 分を超えたら warning と、今ホストしている人の画面が閉じていると止まること（最後に共有した人を今のホストと決めつけない。host-rotation）
  const stale = roleSummary(shared('guest', 11), { userId: '仲間', now });
  assert.equal(stale.kind, 'warning');
  assert.match(stale.text, /最後の共有は 11 分前（Alice の PC から）です。今ホストしている人の画面が閉じていると、共有も配合牧場の自動登録も止まります。$/);
  assert.equal(roleSummary(shared('guest', 10), { userId: '仲間', now }).kind, 'info');
  // 共有を見ているだけの人
  assert.equal(roleSummary(shared('', 125), { userId: '仲間', now }).text, 'Alice が共有した所持パルを表示しています · 最後の共有 2 時間前');
  assert.equal(roleSummary({ ready: true, role: '', meta: null }, { now }), null);
  // 名前が合わないとき（大文字小文字・全半角は userIdKey でそろえる）だけ 2 行目
  const mismatch = roleSummary(shared('guest', 3, [{ uid: 'u1', name: 'Alice' }, { uid: 'u3', name: 'ぼぶ' }]), { userId: 'Bob', now });
  assert.equal(mismatch.hint, 'このワールドに「Bob」という名前のプレイヤーがいません（Alice・ぼぶ）。あなたが親 2 体を預けた配合は、ホストに設定の「プレイヤーの対応」で Bob を選んでもらうまで登録されません（「このワールドでの自分」を選んでも、ホストの対応は変わりません）。');
  assert.equal(roleSummary(shared('guest', 3, [{ uid: 'u1', name: 'ＢＯＢ' }]), { userId: 'bob', now }).hint, '');
  assert.equal(roleSummary(shared('guest', 3, []), { userId: 'Bob', now }).hint, '');
  assert.deepEqual([timeAgo(minutesAgo(0), now()), timeAgo(minutesAgo(59), now()), timeAgo(minutesAgo(60 * 49), now())], ['たった今', '59 分前', '2 日前']);
  // 所持パルの案内: データのある参加者は役割の 1 行（データがなければ共有を待つ 1 行）。「セーブのファイルが登録されていません」は出さない
  const notices = ownedNotices(shared('guest', 3, [{ uid: 'u1', name: 'Alice' }]), { userId: 'Bob', now });
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /配合牧場の自動登録は Alice の画面が行います/);
  assert.match(notices[0].hint, /「Bob」という名前のプレイヤーがいません/);
  assert.doesNotMatch(JSON.stringify(notices), /登録されていません。|動きません/);
});

// ---- パル次元ストレージの読み漏れ（dps-missing） ----
const ALICE = '00000000-0000-0000-0000-000000000001';
const BOB = '00000000-0000-0000-0000-000000000002';
const CAROL = '00000000-0000-0000-0000-000000000003';
const file = (uid, suffix = '') => `Players/${uid.replace(/-/g, '')}${suffix}.sav`;
const gapState = ({ stats = { inLocker: 118, inLockerMissing: 27 }, used = [file(ALICE), file(ALICE, '_dps'), file(BOB)], players } = {}) => ownedState({
  data: { source: 'handles', snapshot: {
    files: { used: ['Level.sav', ...used], skipped: [] }, stats,
    players: players ?? [{ uid: ALICE, name: 'Alice', level: 50 }, { uid: BOB, name: 'Bob', level: 40 }],
  } },
});

test('次元ストレージの読み漏れ（ホスト）: 候補が 1 人なら、数と候補のファイル名・名前を挙げて［ワールドを編集］へ', async () => {
  const { dimensionGap, dimensionNotice } = await import('../../web/js/ui/owned-status.js');
  const state = gapState();
  const text = 'Level.sav ではパル次元ストレージに 118 体いますが、27 体を読めていません。Players\\00000000000000000000000000000002_dps.sav（Bob）が登録されていないかもしれません。';
  assert.deepEqual(dimensionGap(state.data.snapshot), { text, kind: 'warning', action: 'editWorld' });
  assert.deepEqual(dimensionNotice(state), { text, kind: 'warning', action: 'editWorld' });
  assert.deepEqual(ownedNotices(state), [{ text, kind: 'warning', action: 'editWorld' }]);
  for (const notice of ownedNotices(state)) assert.doesNotMatch(notice.text, /設定タブ/);
});

test('次元ストレージの読み漏れ（ホスト）: 候補が複数なら全員を挙げ、欠けの数は人数で割らない。候補がいなければ「ファイルが足りないか、保存の途中に読んだ」', async () => {
  const { dimensionGap } = await import('../../web/js/ui/owned-status.js');
  const two = gapState({ used: [file(ALICE), file(BOB)], players: [{ uid: ALICE, name: 'Alice', level: 50 }, { uid: BOB, name: '', level: 40 }] });
  assert.equal(dimensionGap(two.data.snapshot).text,
    'Level.sav ではパル次元ストレージに 118 体いますが、27 体を読めていません。Players\\00000000000000000000000000000001_dps.sav（Alice）、Players\\00000000000000000000000000000002_dps.sav（名前なし）が登録されていないかもしれません。');
  // 全員の _dps.sav を読めているのに欠けている（保存の途中など）。ボタンは出さない
  const none = gapState({ used: [file(ALICE), file(ALICE, '_dps'), file(BOB), file(BOB, '_dps')] });
  assert.deepEqual(ownedNotices(none), [{ text: 'Level.sav ではパル次元ストレージに 118 体いますが、27 体を読めていません（ファイルが足りないか、保存の途中に読んだ可能性があります）。', kind: 'warning' }]);
  // .sav も登録されていない人は、登録されていないプレイヤーのファイルの案内と並べる（その人を候補にはしない）
  const unregistered = ownedNotices(gapState({ used: [file(ALICE), file(ALICE, '_dps')], players: [{ uid: ALICE, name: 'Alice', level: 50 }, { uid: CAROL, name: 'Carol', level: 3 }] }));
  assert.deepEqual(unregistered.map((notice) => notice.action ?? ''), ['editWorld', '']);
  assert.match(unregistered[0].text, /^登録されていないプレイヤーのファイルがあります: Carol/);
  assert.match(unregistered[1].text, /読めていません（ファイルが足りないか/);
});

test('次元ストレージの読み漏れ（ホスト）: 欠けがない・数のない古い stats（IndexedDB）は案内を出さない', async () => {
  const { dimensionGap } = await import('../../web/js/ui/owned-status.js');
  assert.deepEqual(ownedNotices(gapState({ stats: { inLocker: 118, inLockerMissing: 0 } })), []);
  for (const stats of [{}, null, 'x', { unknownLocation: 0 }, { inLocker: 118 }, { inLocker: 'many', inLockerMissing: 'x' }]) {
    assert.deepEqual(ownedNotices(gapState({ stats })), [], JSON.stringify(stats));
  }
  assert.equal(dimensionGap(undefined), null);
});

test('次元ストレージの読み漏れ（参加者）: 共有のデータで自分（selfUids）が候補のときだけ、自分の _dps.sav をホストに足してもらう案内。ほかの人が候補・古い共有では出さない', async () => {
  const { dimensionNotice } = await import('../../web/js/ui/owned-status.js');
  const sharedState = (players, role = 'guest') => ownedState({
    role, auto: { enabled: role === 'guest', status: 'ready', worlds: [], worldId: '', error: '' }, data: { world: {} },
    owned: { pals: [], players, stats: {} }, meta: { ...ownedState().meta, source: 'shared', sharedAt: SAVED, uploadedBy: 'Alice' },
  });
  const players = [{ uid: ALICE, name: 'Alice', level: 50 }, { uid: BOB, name: 'Bob', level: 40, dpsGap: 27 }];
  const text = 'パル次元ストレージの 27 体が出ていません。ホストの登録にあなたの Players\\00000000000000000000000000000002_dps.sav がないかもしれません。ホストに足してもらってください。';
  assert.deepEqual(dimensionNotice(sharedState(players), { selfUids: new Set([BOB]) }), { text, kind: 'warning' });
  const guest = ownedNotices(sharedState(players), { selfUids: new Set([BOB]), now: () => Date.parse(SAVED) });
  assert.deepEqual(guest.map((notice) => notice.text).slice(1), [text]);
  // 自分が候補でない・自分が分からない・候補のない古い共有では出さない
  assert.equal(dimensionNotice(sharedState(players), { selfUids: new Set([ALICE]) }), null);
  assert.equal(dimensionNotice(sharedState(players)), null);
  assert.equal(dimensionNotice(sharedState([{ uid: BOB, name: 'Bob', level: 40 }]), { selfUids: new Set([BOB]) }), null);
  assert.equal(ownedNotices(sharedState(players), { selfUids: new Set([ALICE]), now: () => Date.parse(SAVED) }).some((notice) => /次元ストレージ/.test(notice.text)), false);
  // 連携していない人が共有を見ているときも、自分が候補なら同じ案内
  assert.deepEqual(ownedNotices(sharedState(players, ''), { selfUids: new Set([BOB]) }), [{ text, kind: 'warning' }]);
  // ホストの画面の案内（この PC で読んだセーブ）は、自分のプレイヤーによらない
  assert.equal(dimensionNotice(gapState(), { selfUids: new Set() }).action, 'editWorld');
});

test('案内（share-upload）: 同じセーブが共有済み・共有の方が新しいは、今読んでいるセーブを送った結果のときだけ出す。送れなかったときは警告', async () => {
  const { uploadNotice } = await import('../../web/js/ui/owned-status.js');
  const local = { world: { signature: 'sig-1' } };
  const upload = (extra) => ({
    status: '', at: '', error: '', worldId: 'W', result: '', signature: 'sig-1', stamp: '638650000000000001',
    published: { saveStamp: '638650000000000001', uploadedBy: 'Alice', uploadedAt: SAVED }, ...extra,
  });
  const notices = (extra) => ownedNotices(ownedState({ local, upload: upload(extra) }));
  assert.deepEqual(notices({ status: 'same', result: 'unchanged' }), [{ text: '同じセーブが共有済み（Alice の PC から）', kind: 'info' }]);
  assert.deepEqual(notices({ status: 'same', result: 'same', published: { saveStamp: '1', uploadedBy: '', uploadedAt: SAVED } }), [{ text: '同じセーブが共有済み', kind: 'info' }]);
  assert.deepEqual(notices({ status: 'stale', result: 'stale' }), [{ text: '共有されているセーブの方が新しいため、そちらを表示しています', kind: 'info' }]);
  // 送っている間・自分の共有が載ったときは出さない
  for (const status of ['', 'sending', 'done']) assert.deepEqual(notices({ status }), [], status);
  // 前のセーブを送った結果（その後に新しいセーブを読んだ）は出さない
  assert.deepEqual(notices({ status: 'same', signature: 'sig-0' }), []);
  assert.equal(uploadNotice(ownedState({ local, upload: upload({ status: 'stale', signature: 'sig-0' }) })), null);
  // 送れなかった知らせは、どのセーブの分でも出す
  assert.deepEqual(notices({ status: 'error', error: 'サーバに接続できません', signature: 'sig-0' }), [{ text: '共有できませんでした（サーバに接続できません）', kind: 'warning' }]);
  // 前の形の state（印がない）でも今までどおり
  assert.deepEqual(ownedNotices(ownedState({ upload: { status: 'stale', at: '', error: '', worldId: 'W' } })).map((notice) => notice.text), ['共有されているセーブの方が新しいため、そちらを表示しています']);
});

// ---- ホストの交代（sync-fixes の host-rotation） ----
const ROTATION_NOW = Date.parse('2026-10-15T12:00:00.000Z');
const msAgo = (ms) => new Date(ROTATION_NOW - ms).toISOString();
// 直近に 30 秒ごとの変化を 2 回見た記録（owned.js の state.play。core/playing.js の trackPlay の形）
const playRecord = (worldId = 'W', role = 'guest') => ({ worldId, role, value: 60000, changes: [{ at: ROTATION_NOW - 40000, gap: 30000 }, { at: ROTATION_NOW - 10000, gap: 30000 }] });
// ゲーム中の参加者。共有は 5 秒前に確かめ、共有のセーブは 12 分前
const guestPlaying = (overrides = {}) => ({
  ready: true, role: 'guest', linkedWorldId: 'W', error: '',
  auto: { enabled: true, status: 'ready', worlds: [{ id: 'W' }], worldId: '', error: '' },
  play: playRecord(), upload: { status: '', at: '', error: '', worldId: '' },
  shared: { worlds: [], current: null, fetchedAt: msAgo(5000), fetchedWorldId: 'W', error: '' },
  meta: { source: 'shared', worldId: 'W', worldName: 'テスト', hostName: 'Host', uploadedBy: 'Alice', sharedAt: msAgo(12 * 60000), saveUpdatedAt: msAgo(12 * 60000) },
  owned: { players: [], pals: [] }, data: { world: {} },
  ...overrides,
});
const LAG_HELP = '今のホストの PC でこのページが開いているか確かめてください（あなたがホストなら［ワールドを編集］で Level.sav・LevelMeta.sav・Players のファイルを足してください）。';

test('役割の 1 行（host-rotation）: 参加者の名指しは 3 通り。新しい共有を別の人が送った → その人の名前と PC、古い共有 → 「ホスト」と最後に共有した PC、自分が送った共有 → 「ホスト」と「あなたの PC から」', async () => {
  const { roleSummary } = await import('../../web/js/ui/owned-status.js');
  const now = () => ROTATION_NOW;
  const state = (minutes, uploadedBy = 'Alice') => guestPlaying({ meta: { ...guestPlaying().meta, uploadedBy, sharedAt: msAgo(minutes * 60000) } });
  const fresh = roleSummary(state(3), { userId: 'Bob', now });
  assert.deepEqual([fresh.kind, fresh.text], ['info', 'この PC では読み込みません。配合牧場の自動登録は Alice の画面が行います（Alice が自動登録をオンにしていて、プレイヤーの対応であなたが選ばれているとき） · 最後の共有 3 分前（Alice の PC から）']);
  const stale = roleSummary(state(120), { userId: 'Bob', now });
  assert.deepEqual([stale.kind, stale.text], ['warning', 'この PC では読み込みません。配合牧場の自動登録は ホスト の画面が行います（ホスト が自動登録をオンにしていて、プレイヤーの対応であなたが選ばれているとき）。最後の共有は 2 時間前（Alice の PC から）です。今ホストしている人の画面が閉じていると、共有も配合牧場の自動登録も止まります。']);
  assert.doesNotMatch(stale.text, /Alice の画面/);
  // 自分が送った共有（ID は大文字小文字・全半角をそろえて比べる）
  const mine = roleSummary(state(3, 'ＢＯＢ'), { userId: 'bob', now });
  assert.deepEqual([mine.kind, mine.text], ['info', 'この PC では読み込みません。配合牧場の自動登録は ホスト の画面が行います（ホスト が自動登録をオンにしていて、プレイヤーの対応であなたが選ばれているとき） · 最後の共有 3 分前（あなたの PC から）']);
  const mineStale = roleSummary(state(30, 'Bob'), { userId: 'Bob', now });
  assert.equal(mineStale.kind, 'warning');
  assert.match(mineStale.text, /配合牧場の自動登録は ホスト の画面が行います.*最後の共有は 30 分前（あなたの PC から）です。今ホストしている人の画面が閉じていると、共有も配合牧場の自動登録も止まります。$/);
  // 送った人が分からない古い共有の形は、今までどおりホスト名で（PC は添えない）
  const unknown = roleSummary(state(3, ''), { userId: 'Bob', now });
  assert.equal(unknown.text, 'この PC では読み込みません。配合牧場の自動登録は Host の画面が行います（Host が自動登録をオンにしていて、プレイヤーの対応であなたが選ばれているとき） · 最後の共有 3 分前');
});

test('共有が止まっている案内（host-rotation）: 参加者がゲーム中で、共有のセーブが 5 分以上古い・共有がないときだけ。共有を 60 秒より前にしか確かめていなければ出さない', async () => {
  const { shareLagNotice, ownedNotices } = await import('../../web/js/ui/owned-status.js');
  const now = () => ROTATION_NOW;
  const old = shareLagNotice(guestPlaying(), { now });
  assert.deepEqual(old, { text: `ゲーム中のようですが、共有は 12 分前のセーブのままです。${LAG_HELP}`, kind: 'warning', action: 'editWorld' });
  // 共有がない（このワールドはまだ共有されていない）
  assert.deepEqual(shareLagNotice(guestPlaying({ meta: { worldId: 'W', worldName: '', hostName: '' } }), { now }),
    { text: `ゲーム中のようですが、このワールドはまだ共有されていません。${LAG_HELP}`, kind: 'warning', action: 'editWorld' });
  // 共有が新しい（5 分より新しいセーブ）
  assert.equal(shareLagNotice(guestPlaying({ meta: { ...guestPlaying().meta, saveUpdatedAt: msAgo(4 * 60000) } }), { now }), null);
  assert.notEqual(shareLagNotice(guestPlaying({ meta: { ...guestPlaying().meta, saveUpdatedAt: msAgo(5 * 60000) } }), { now }), null);
  // ゲーム中でない（変化が 1 回だけ・2 分より前・別のワールドや役割の記録）
  for (const play of [
    { worldId: 'W', role: 'guest', value: 1, changes: [{ at: ROTATION_NOW - 1000, gap: 30000 }] },
    { ...playRecord(), changes: playRecord().changes.map((change) => ({ ...change, at: change.at - 2 * 60000 })) },
    playRecord('OTHER'), playRecord('W', 'host'),
  ]) assert.equal(shareLagNotice(guestPlaying({ play }), { now }), null, JSON.stringify(play));
  // 共有を最近確かめていない（裏のタブから表に戻った直後の古い共有）
  for (const fetchedAt of ['', msAgo(61000), 'x']) {
    assert.equal(shareLagNotice(guestPlaying({ shared: { ...guestPlaying().shared, fetchedAt } }), { now }), null, fetchedAt);
  }
  assert.notEqual(shareLagNotice(guestPlaying({ shared: { ...guestPlaying().shared, fetchedAt: msAgo(60000) } }), { now }), null);
  // ホストには出さない
  assert.equal(shareLagNotice(guestPlaying({ role: 'host', play: playRecord('W', 'host') }), { now }), null);
  // 所持パルの案内: 役割の 1 行の後に［ワールドを編集］つきで。共有がないときは、共有を待つ 1 行の代わりに
  const notices = ownedNotices(guestPlaying(), { userId: 'Bob', now });
  assert.deepEqual(notices.map((notice) => [notice.kind, notice.action ?? '']), [['warning', ''], ['warning', 'editWorld']]);
  assert.equal(notices[1].text, old.text);
  const none = ownedNotices(guestPlaying({ meta: { worldId: 'W', worldName: '', hostName: '' }, owned: null, data: null }), { now });
  assert.deepEqual(none.map((notice) => notice.text), [`ゲーム中のようですが、このワールドはまだ共有されていません。${LAG_HELP}`]);
  const waiting = ownedNotices(guestPlaying({ meta: { worldId: 'W', worldName: '', hostName: '' }, owned: null, data: null, play: null }), { now });
  assert.deepEqual(waiting.map((notice) => notice.text), ['ホストがまだこのワールドの所持パルを共有していません。']);
});

test('ゲーム中の推定の行（host-rotation）: ホストは「ホスト中（推定）」と「ホスト用のセーブあり」を分け、参加者はゲーム中のときだけ', async () => {
  const { playSummary } = await import('../../web/js/ui/owned-status.js');
  const now = () => ROTATION_NOW;
  assert.equal(playSummary(guestPlaying({ role: 'host', play: playRecord('W', 'host') }), { now }), 'ホスト中（推定）');
  assert.equal(playSummary(guestPlaying({ role: 'host', play: playRecord('W', 'guest') }), { now }), 'ホスト用のセーブあり（ゲームの保存は続けて見えていません）');
  assert.equal(playSummary(guestPlaying({ role: 'host', play: undefined }), { now }), 'ホスト用のセーブあり（ゲームの保存は続けて見えていません）');
  assert.equal(playSummary(guestPlaying(), { now }), '参加中（推定）');
  assert.equal(playSummary(guestPlaying({ play: playRecord('OTHER') }), { now }), '');
  assert.equal(playSummary(guestPlaying({ role: '' }), { now }), '');
});

test('共有が止まっている案内（host-rotation・Codex のレビュー）: 共有を確かめたワールドが今のワールドと違う・共有の取得に失敗しているときは出さない', async () => {
  const { shareLagNotice } = await import('../../web/js/ui/owned-status.js');
  const now = () => ROTATION_NOW;
  assert.notEqual(shareLagNotice(guestPlaying(), { now }), null);
  for (const change of [{ fetchedWorldId: 'OTHER' }, { fetchedWorldId: '' }, { fetchedWorldId: undefined }, { error: '接続できません' }]) {
    assert.equal(shareLagNotice(guestPlaying({ shared: { ...guestPlaying().shared, ...change } }), { now }), null, JSON.stringify(change));
  }
  // W の取得に成功した直後に W2 に替わり、W2 の取得が失敗した（W2 を「まだ共有されていません」と誤って出さない）
  const switched = guestPlaying({
    linkedWorldId: 'W2', play: playRecord('W2'), meta: { worldId: 'W2', worldName: '', hostName: '' },
    shared: { ...guestPlaying().shared, error: '接続できません' },
  });
  assert.equal(shareLagNotice(switched, { now }), null);
  assert.equal(shareLagNotice({ ...switched, shared: { ...switched.shared, error: '' } }, { now }), null);
});
