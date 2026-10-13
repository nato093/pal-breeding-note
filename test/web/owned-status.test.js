// 所持パルの読み込みの状態の文（スロット）・データ元の 1 行・案内（ui/owned-status.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { activityText, sourceText, ownedSourceLine, ownedNotices, dateTime } from '../../web/js/ui/owned-status.js';
import { formatTime } from '../../web/js/ui/dom.js';

const NOW = new Date(2026, 9, 13, 13, 42, 10).getTime();
const SAVED = new Date(2026, 9, 10, 9, 0).toISOString();

// 所持パルの状態（owned.js の state と同じ形。必要なところだけ）
function ownedState(overrides = {}) {
  return {
    ready: true, busy: false, progress: '', error: '', activity: '', checkedAt: new Date(NOW - 30 * 1000).toISOString(),
    auto: { enabled: true, status: 'ready', worlds: [{ id: 'W' }], worldId: '', error: '' },
    role: 'host', shared: { worlds: [], current: null, fetchedAt: '', error: '' }, upload: { status: '', at: '', error: '', worldId: '' },
    data: { source: 'handles', snapshot: { files: { used: ['Level.sav', 'Players/00000000000000000000000000000001.sav'], skipped: [] }, players: [], stats: {} } },
    owned: { pals: Array.from({ length: 1194 }, (_, i) => ({ id: `p${i}` })), stats: {} },
    meta: { worldId: 'W', worldName: 'テスト', hostName: 'Alice', source: 'local', saveUpdatedAt: SAVED, importedAt: SAVED, sharedAt: '', uploadedBy: '', palCount: 1194 },
    ...overrides,
  };
}

test('状態の文: 読み込みの状態（activity）ごとの短い文。何もしていなければ最後に確かめた時刻', () => {
  assert.deepEqual(activityText(ownedState({ activity: 'checking' }), NOW), { kind: 'busy', text: '確認中…' });
  assert.deepEqual(activityText(ownedState({ activity: 'reading', progress: 'Level.sav を読み込み中…' }), NOW), { kind: 'busy', text: 'Level.sav を読み込み中…' });
  assert.deepEqual(activityText(ownedState({ activity: 'reading' }), NOW), { kind: 'busy', text: 'セーブを読み込み中…' });
  assert.deepEqual(activityText(ownedState({ activity: 'sharing' }), NOW), { kind: 'busy', text: '共有中…' });
  assert.deepEqual(activityText(ownedState(), NOW), { kind: 'idle', text: `最終確認 ${formatTime(NOW - 30 * 1000)}` });
  // 違う日は 月/日 時:分、まだ確かめていなければ「—」、保存済みのデータを確かめる前は「確認中…」
  assert.deepEqual(activityText(ownedState({ checkedAt: new Date(2026, 9, 12, 23, 5).toISOString() }), NOW), { kind: 'idle', text: `最終確認 ${formatTime(new Date(2026, 9, 12, 23, 5), true)}` });
  assert.deepEqual(activityText(ownedState({ checkedAt: '' }), NOW), { kind: 'idle', text: '最終確認 —' });
  assert.deepEqual(activityText(ownedState({ ready: false }), NOW), { kind: 'busy', text: '確認中…' });
  // 古い形の状態（activity・checkedAt がない）でも壊れない
  assert.deepEqual(activityText({ ready: true }, NOW), { kind: 'idle', text: '最終確認 —' });
});

test('データ元の 1 行: 「ワールド」（ホスト）· この PC／共有 · N 体 · セーブ M/D HH:MM。データがなければ空', () => {
  assert.equal(sourceText(ownedState()), `「テスト」（ホスト Alice） · この PC · 1194 体 · セーブ ${dateTime(SAVED)}`);
  const shared = ownedState({ meta: { ...ownedState().meta, source: 'shared', sharedAt: SAVED, uploadedBy: 'Alice' }, owned: null });
  assert.equal(sourceText(shared), `「テスト」（ホスト Alice） · 共有 · 1194 体 · セーブ ${dateTime(SAVED)}`);
  assert.equal(sourceText(ownedState({ meta: { worldId: 'W', worldName: 'テスト', hostName: '' } })), '');
  assert.equal(sourceText(ownedState({ meta: null })), '');
  assert.equal(sourceText({ ready: true }), '');
});

test('データ元の 1 行の部品: 文は textContent と title、状態のスロットは要素を作り直さずに文と印だけを書き換える', (t) => {
  installDom(t);
  const asked = [];
  const line = ownedSourceLine({ actions: { grant: { label: '読み込みを許可', run: () => asked.push('grant') } }, now: () => NOW });
  const { element } = line;
  assert.equal(element.className, 'owned-source');
  // 1 分ごとに読み上げない（エラーは案内の帯で知らせる）
  assert.equal(element.getAttribute('aria-live'), null);
  const [text, slot, grant, settings] = element.children;
  assert.deepEqual([text.className, slot.className.split(' ')[0], settings.className], ['owned-source-text', 'owned-activity', 'owned-source-settings']);
  assert.equal(settings.textContent, '設定 →');
  assert.equal(settings.href, '#/settings');
  line.update(ownedState({ meta: { ...ownedState().meta, sharedAt: SAVED, uploadedBy: 'Alice' } }));
  assert.equal(text.textContent, `「テスト」（ホスト Alice） · この PC · 1194 体 · セーブ ${dateTime(SAVED)}`);
  // 共有した人・この PC で読み込んだ時刻は title に
  assert.match(text.title, /^「テスト」.*\nセーブの更新: .*\n共有: .*（Alice）\nこの PC で読み込み: /);
  const label = slot.querySelector('.owned-activity-text');
  assert.equal(label.textContent, `最終確認 ${formatTime(NOW - 30 * 1000)}`);
  assert.ok(!slot.className.split(' ').includes('is-busy'));
  line.update(ownedState({ activity: 'checking', busy: true, auto: { ...ownedState().auto, status: 'checking' } }));
  assert.deepEqual(element.children, [text, slot, grant, settings]);
  assert.equal(slot.querySelector('.owned-activity-text'), label);
  assert.equal(label.textContent, '確認中…');
  assert.ok(slot.className.split(' ').includes('is-busy'));
  line.update(ownedState());
  assert.ok(!slot.className.split(' ').includes('is-busy'));
  // 許可のボタンは、許可が要るときだけ見せる（ほかのときも場所は残す。自動の読み込みを使っていなければ出さない）
  assert.equal(grant.textContent, '読み込みを許可');
  assert.deepEqual([grant.hidden, grant.disabled, grant.className.split(' ').includes('is-placeholder')], [false, true, true]);
  line.update(ownedState({ auto: { ...ownedState().auto, status: 'permission', error: 'セーブを読むには許可が必要です' } }));
  assert.deepEqual([grant.hidden, grant.disabled, grant.className.split(' ').includes('is-placeholder')], [false, false, false]);
  // 確かめている途中（checking）は、前の見せ方のまま（点滅しない）
  line.update(ownedState({ busy: true, activity: 'checking', auto: { ...ownedState().auto, status: 'checking', error: 'セーブを読むには許可が必要です' } }));
  assert.equal(grant.disabled, false);
  grant.dispatch('click');
  assert.deepEqual(asked, ['grant']);
  line.update(ownedState({ auto: { ...ownedState().auto, enabled: false, status: 'off' } }));
  assert.equal(grant.hidden, true);
  // データがないときは文を空にする（行の場所は残す）
  line.update(ownedState({ meta: null, owned: null }));
  assert.equal(text.textContent, '');
  assert.equal(element.hidden, false);
  line.destroy();
});

test('データ元の 1 行の部品: showGrant: false（所持パルの画面。許可は案内の帯に出す）なら、許可が要るときも 1 行のボタンは見せず、自動の読み込みを使っている間は場所だけ残す（D27）', (t) => {
  installDom(t);
  const line = ownedSourceLine({ actions: { grant: { label: '読み込みを許可', run: () => {} } }, showGrant: false, now: () => NOW });
  const grant = line.element.querySelector('.owned-source-grant');
  const shown = () => [grant.hidden, grant.disabled, grant.className.split(' ').includes('is-placeholder')];
  line.update(ownedState());
  assert.deepEqual(shown(), [false, true, true]);
  line.update(ownedState({ auto: { ...ownedState().auto, status: 'permission', error: 'セーブを読むには許可が必要です' } }));
  assert.deepEqual(shown(), [false, true, true]);
  line.update(ownedState({ auto: { ...ownedState().auto, enabled: false, status: 'off' } }));
  assert.equal(grant.hidden, true);
  line.destroy();
});

test('案内: 読み込み中・確認中・共有中は帯に出さない（状態のスロットへ）。読んでいる間も前回の警告は残す', () => {
  const skipped = { files: { used: ['Level.sav'], skipped: [{ path: 'Players/x.sav', reason: '壊れています' }] }, players: [], stats: {} };
  const state = ownedState({ data: { source: 'handles', snapshot: skipped } });
  const idle = ownedNotices(state).map((notice) => notice.text);
  assert.ok(idle.some((text) => /Players\/x\.sav を読めませんでした/.test(text)));
  const busy = ownedNotices({ ...state, busy: true, progress: 'Level.sav を読み込み中…', activity: 'reading', upload: { status: 'sending', at: '', error: '', worldId: 'W' } }).map((notice) => notice.text);
  assert.deepEqual(busy, idle);
  assert.deepEqual(ownedNotices(ownedState({ ready: false })), []);
});

test('案内: 自動の読み込みがオフでも、所持パルを表示できているときは「設定でワールドを登録」を出さない。データがないときはボタンつきで出す', () => {
  const off = { enabled: false, status: 'off', worlds: [], worldId: '', error: '' };
  const shared = ownedState({ auto: off, role: '', data: { world: {} }, meta: { ...ownedState().meta, source: 'shared' } });
  assert.deepEqual(ownedNotices(shared), []);
  const none = ownedNotices(ownedState({ auto: off, role: '', data: null, owned: null, meta: null }));
  assert.deepEqual(none, [{ text: '自分のセーブを読むには、設定でワールドを登録してください。', kind: 'info', action: 'settings' }]);
  // 参加している側でデータがないとき（「参加しているワールドのため…」は出さない。取得元は 1 行に出る）
  const guest = ownedNotices(ownedState({ role: 'guest', data: null, owned: null, meta: null }));
  assert.deepEqual(guest.map((notice) => notice.text), ['ホストがまだこのワールドの所持パルを共有していません。']);
  assert.deepEqual(ownedNotices(ownedState({ role: 'guest', meta: { ...ownedState().meta, source: 'shared' } })), []);
  // 自動の読み込みを使っているのに登録がない（empty）ときも、同じ案内とボタン
  const empty = ownedNotices(ownedState({ auto: { enabled: true, status: 'empty', worlds: [], worldId: '', error: '自分のセーブを読むには、設定でワールドを登録してください' } }));
  assert.deepEqual(empty, [{ text: '自分のセーブを読むには、設定でワールドを登録してください。', kind: 'warning', action: 'settings' }]);
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
