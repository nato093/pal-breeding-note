import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { syncStatusText, syncStatusLine, syncStatus } from '../../web/js/ui/sync-status.js';

const NOW = new Date(2026, 9, 12, 9, 30).getTime();
const base = { syncing: false, syncDone: 0, syncTotal: 0, loading: false, serverTime: '', cached: false, error: '', fetchError: '', records: [{}, {}, {}], renaming: false };
const line = (state) => syncStatusLine(syncStatusText({ ...base, ...state }, NOW));

test('同期状況: 今日の取得は 時:分、前の日の取得は 月/日 時:分、キャッシュは「前回取得 … 時点」', () => {
  assert.equal(line({ serverTime: new Date(2026, 9, 12, 9, 5).toISOString() }), '最新取得 09:05 · 3 件');
  assert.equal(line({ serverTime: new Date(2026, 9, 11, 23, 59).toISOString() }), '最新取得 10/11 23:59 · 3 件');
  assert.equal(line({ serverTime: new Date(2026, 9, 12, 8, 0).toISOString(), cached: true }), '前回取得 08:00 時点 · 3 件');
  assert.deepEqual(syncStatusText({ ...base, serverTime: new Date(2026, 9, 12, 8, 0).toISOString(), cached: true }, NOW),
    { label: '前回取得', time: '08:00 時点', count: '3 件', error: '' });
});

test('同期状況: 取得に失敗しても前回の時刻と件数を残し、エラーは別に返す（保存の失敗では返さない）', () => {
  const failed = { ...base, serverTime: new Date(2026, 9, 12, 9, 5).toISOString(), error: 'サーバに接続できません', fetchError: 'サーバに接続できません' };
  const parts = syncStatusText(failed, NOW);
  assert.equal(syncStatusLine(parts), '最新取得 09:05 · 3 件');
  assert.equal(parts.error, 'サーバに接続できません');
  // 配合の保存（mutate）の失敗は store の error だけに入る。同期状況の隣の「更新できませんでした」は出さない
  assert.equal(syncStatusText({ ...failed, fetchError: '' }, NOW).error, '');
  // 一度も取得できていなければ、エラーをそのまま出す
  assert.equal(line({ error: 'サーバに接続できません' }), 'サーバに接続できません');
  assert.equal(line({}), '仲間だけの配合ノート');
});

test('同期状況: 保存中・更新中は今までと同じ文', () => {
  assert.equal(line({ syncing: true, syncDone: 1, syncTotal: 2, serverTime: new Date(NOW).toISOString() }), 'サーバに保存中… 1 / 2 件');
  assert.equal(line({ loading: true, serverTime: new Date(NOW).toISOString(), error: '前の失敗' }), '記録を更新中…');
});

test('同期状況のボタン: 取得している間の 2 回目の押下は無視し、保存中・名前の変更中・ログイン画面では押せない', async (t) => {
  installDom(t);
  let release;
  let refreshes = 0;
  let locked = false;
  const store = {
    state: { ...base, serverTime: new Date().toISOString() },
    refresh() {
      refreshes++;
      return new Promise((resolve) => { release = resolve; });
    },
  };
  const part = syncStatus({ store, locked: () => locked });
  part.update(store.state);
  const trigger = part.button;
  // 取得した直後に日付が変わっても落ちないよう、違う日の形（月/日 時:分）も許す
  assert.match(trigger.textContent, /^最新取得 (\d{1,2}\/\d{1,2} )?\d{2}:\d{2} · 3 件$/);
  assert.equal(part.element.querySelector('.sync-label').textContent, '最新取得 ');
  const first = trigger.dispatch('click');
  await trigger.dispatch('click');
  assert.equal(refreshes, 1);
  assert.equal(trigger.getAttribute('aria-busy'), 'true');
  // 取得中も disabled にしない（フォーカスを失わない）
  assert.equal(trigger.disabled, false);
  release();
  await first;
  assert.equal(trigger.getAttribute('aria-busy'), null);
  for (const state of [{ syncing: true, syncDone: 0, syncTotal: 1 }, { renaming: true }]) {
    part.update({ ...store.state, ...state });
    assert.equal(trigger.disabled, true);
  }
  locked = true;
  part.update(store.state);
  assert.equal(trigger.disabled, true);
  // 保存中の文は、狭い窓で隠す「最新取得」の語の欄に入れない
  part.update({ ...store.state, syncing: true, syncDone: 0, syncTotal: 1 });
  assert.equal(part.element.querySelector('.sync-label').textContent, '');
});
