// ヘッダーの同期状況（配合の記録の取得時刻と件数）。押すと最新に更新する。
import { el, button, formatShortTime } from './dom.js';
import { toast } from './toast.js';

/**
 * 同期状況の文の部品。取得に失敗しても（error があっても）前回の時刻と件数を残す。
 * time が空のときは label だけを出す（保存中・更新中・未取得）。
 */
export function syncStatusText(state, now = Date.now()) {
  const only = (label) => ({ label, time: '', count: '', error: '' });
  if (state.syncing) return only(`サーバに保存中… ${state.syncDone} / ${state.syncTotal} 件`);
  if (state.loading) return only('記録を更新中…');
  if (!state.serverTime) return only(state.error || '仲間だけの配合ノート');
  return {
    label: state.cached ? '前回取得' : '最新取得',
    time: `${formatShortTime(state.serverTime, now)}${state.cached ? ' 時点' : ''}`,
    count: `${state.records.length} 件`,
    error: state.error,
  };
}

/** 部品をつないだ文（button の textContent と同じ）。 */
export function syncStatusLine(parts) {
  return parts.time ? `${parts.label} ${parts.time} · ${parts.count}` : parts.label;
}

/**
 * ヘッダーの同期状況のボタンと、失敗したときのチップ（ボタンの隣）。
 * locked: 押せないとき（ログイン画面）。中身は文字と hidden・disabled だけを書き換える。
 */
export function syncStatus({ store, locked = () => false }) {
  const element = el('div', 'sync-line');
  // 「最新取得／前回取得」の語は、狭い窓で隠す（CSS）
  const label = el('span', 'sync-label');
  const rest = el('span', 'sync-time');
  const trigger = button('', refresh, 'sync-status');
  trigger.title = '最新に更新';
  trigger.append(label, rest);
  const failure = el('span', 'sync-error', '更新できませんでした');
  failure.hidden = true;
  element.append(trigger, failure);
  let refreshing = false;

  // 取得している間は disabled にせず（フォーカスを失わない）、2 回目の押下を無視する
  async function refresh() {
    if (refreshing || trigger.disabled) return;
    refreshing = true;
    trigger.setAttribute('aria-busy', 'true');
    try {
      await store.refresh();
      toast('最新の記録に更新しました');
    } catch (error) {
      toast(error.message);
    } finally {
      refreshing = false;
      trigger.removeAttribute('aria-busy');
    }
  }

  function update(state = store.state) {
    const parts = syncStatusText(state);
    label.textContent = parts.time ? `${parts.label} ` : '';
    rest.textContent = parts.time ? `${parts.time} · ${parts.count}` : parts.label;
    failure.hidden = !parts.error;
    failure.title = parts.error;
    trigger.disabled = Boolean(state.syncing || state.renaming || locked());
  }

  return { element, button: trigger, update };
}
