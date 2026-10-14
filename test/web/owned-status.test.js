// 所持パルの案内（ui/owned-status.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownedNotices } from '../../web/js/ui/owned-status.js';

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
  assert.deepEqual(ownedNotices(ownedState({ role: 'guest', meta: { ...ownedState().meta, source: 'shared' } })), []);
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
