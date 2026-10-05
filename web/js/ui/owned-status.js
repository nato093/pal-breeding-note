// 所持パルの状態（連携・共有・更新時刻）の文言。所持パルのタブと設定タブで使う。
import { el } from './dom.js';

export function dateTime(value) {
  const time = new Date(value);
  return value && Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time) : '不明';
}

export function worldName(meta) {
  if (!meta) return '';
  const name = meta.worldName || meta.name ? `「${meta.worldName || meta.name}」` : `ワールド ${String(meta.worldId ?? meta.id ?? '').slice(0, 8)}`;
  return `${name}${meta.hostName ? `（ホスト ${meta.hostName}）` : ''}`;
}

/** 連携の方法（設定されていなければ ''）。 */
export function linkLabel(state) {
  if (state.bridge.enabled) return 'セーブ連携ツール';
  if (state.folder) return 'フォルダ';
  return '';
}

export function roleLabel(state) {
  return state.role === 'host' ? 'ホスト（この PC にワールドのセーブがあります）'
    : state.role === 'guest' ? '参加している側（ホストが共有した所持パルを表示します）' : '';
}

const uploadText = {
  sending: '共有中…', done: '共有しました', stale: '共有されているセーブの方が新しいため、そちらを表示しています', error: '共有できませんでした',
};

/** 所持パルの更新時刻（セーブ・共有）。 */
export function timeLines(state) {
  const meta = state.meta;
  if (!meta?.source) return [];
  const lines = [`セーブの更新: ${dateTime(meta.saveUpdatedAt)}`];
  if (meta.sharedAt) lines.push(`共有: ${dateTime(meta.sharedAt)}${meta.uploadedBy ? `（${meta.uploadedBy}）` : ''}`);
  if (meta.source === 'local' && meta.importedAt) lines.push(`この PC で読み込み: ${dateTime(meta.importedAt)}`);
  return lines;
}

/** 所持パルのタブの上に出す案内（設定の操作はしない）。 */
export function ownedNotices(state) {
  const notices = [];
  if (!state.ready) return [{ text: '保存済みのデータを確認中…' }];
  if (state.busy) notices.push({ text: state.progress || '読み込み中…' });
  if (!linkLabel(state)) {
    notices.push({ text: 'セーブ連携・フォルダが設定されていません。自分のセーブを読み込むには、設定タブの「所持パル（セーブ連携）」で設定してください。', kind: 'info' });
  } else if (state.bridge.enabled && ['offline', 'error', 'empty'].includes(state.bridge.status)) {
    notices.push({ text: `${state.bridge.error || 'セーブ連携ツールにつながりません'}（設定タブで確認できます）`, kind: 'warning' });
  }
  if (state.role === 'guest') {
    notices.push({ text: state.meta?.source ? '参加しているワールドのため、ホストが共有した所持パルを表示しています。'
      : 'ホストがまだこのワールドの所持パルを共有していません。', kind: 'info' });
  }
  if (state.error) notices.push({ text: `セーブを読み込めませんでした: ${state.error}`, kind: 'warning' });
  if (state.upload.status && state.upload.status !== 'done') {
    notices.push({ text: `${uploadText[state.upload.status]}${state.upload.error ? `（${state.upload.error}）` : ''}`, kind: state.upload.status === 'error' ? 'warning' : 'info' });
  }
  if (state.shared.error && !state.meta?.source) notices.push({ text: `共有された所持パルを読めませんでした: ${state.shared.error}`, kind: 'warning' });
  // 読み込めなかったファイルや、場所の分からないパルがあれば知らせる（この PC で読み込んだとき）
  const snapshot = state.meta?.source === 'local' ? state.data?.snapshot : null;
  if (snapshot && !state.busy) {
    for (const file of snapshot.files?.skipped ?? []) notices.push({ text: `${file.path} を読めませんでした（${file.reason}）`, kind: 'warning' });
    if (!(snapshot.files?.used ?? []).some((path) => /^Players\/[0-9a-f]{32}\.sav$/i.test(path))) {
      notices.push({ text: 'Players フォルダのセーブを読めなかったため、手持ち・パルボックスのパルは場所が「不明」になります。', kind: 'warning' });
    }
  }
  return notices;
}

export function noticeList(notices, list = el('ul', 'owned-notices')) {
  list.replaceChildren(...notices.map((notice) => el('li', `owned-notice ${notice.kind ? `notice-${notice.kind}` : ''}`.trim(), notice.text)));
  list.hidden = !notices.length;
  return list;
}
