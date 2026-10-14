// 所持パルの状態（連携・共有・更新時刻）の文言と、所持パルのタブの案内の帯。所持パルのタブ・設定・ヘッダーのセーブ連携の状態
// （ui/save-status.js）で使う。どのワールドの・いつのデータか・読み込み中かは、ヘッダーのセーブ連携の状態だけに出す（2026-10-14 の
// ユーザーのフィードバック〔D29〕で、所持パル・理想個体・継承ルートの画面に出していたデータ元の 1 行〔ownedSourceLine〕はなくした）
import { el, button } from './dom.js';
import { isObject, int } from '../core/boundary.js';

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

export function roleLabel(state) {
  return state.role === 'host' ? 'ホスト（この PC にワールドのセーブがあります）'
    : state.role === 'guest' ? '参加者（ホストが共有した所持パルを表示します）' : '';
}

// 共有の結果の案内（送っている間〔sending〕は出さない。ヘッダーのセーブ連携の状態が読み込み中の印を出す）
const uploadText = {
  done: '共有しました', stale: '共有されているセーブの方が新しいため、そちらを表示しています', error: '共有できませんでした',
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

// セーブのファイル（ワールド）が登録されていないときの案内。ボタン「ワールドを登録」でこの画面から登録のモーダルを開く
const UNREGISTERED_TEXT = 'セーブのファイルが登録されていません。';

/**
 * 所持パルのタブの上に出す案内。対応が要るものだけ（読み込み中・確認中・共有中は出さない。ヘッダーのセーブ連携の状態が知らせる）。
 * 案内は 1 文と行き先のボタン（「設定タブの〜」とだけ書かない。copy-dead-ends）。action はボタンの名前（views/owned.js の noticeActions。
 * grant＝読む許可・register＝ワールドの登録のモーダル・settings＝設定のセーブ連携〔読んでいるワールドの行〕へ・editWorld＝読んでいるワールドの
 * 編集のモーダル・unknownPlace＝場所の分からないパル）
 */
export function ownedNotices(state) {
  const notices = [];
  if (!state.ready) return notices;
  const auto = state.auto ?? {};
  const hasData = Boolean(state.meta?.source);
  if (!auto.enabled) {
    // 共有された所持パルなどを表示できているときは出さない
    if (!hasData) notices.push({ text: UNREGISTERED_TEXT, kind: 'info', action: 'register' });
  } else if (auto.status === 'permission') {
    notices.push({ text: auto.error, kind: 'warning', action: 'grant' });
  } else if (auto.status === 'empty') {
    notices.push({ text: UNREGISTERED_TEXT, kind: 'warning', action: 'register' });
  } else if (auto.status === 'error') {
    notices.push({ text: auto.error || 'セーブを読めませんでした', kind: 'warning', action: 'settings' });
  }
  // 参加者は、データがないときだけ（どこから取ったかはヘッダーのセーブ連携の状態に出る）
  if (state.role === 'guest' && !hasData) notices.push({ text: 'ホストがまだこのワールドの所持パルを共有していません。', kind: 'info' });
  if (state.error) notices.push({ text: `セーブを読み込めませんでした: ${state.error}`, kind: 'warning' });
  const upload = state.upload ?? {};
  if (uploadText[upload.status] && upload.status !== 'done') {
    notices.push({ text: `${uploadText[upload.status]}${upload.error ? `（${upload.error}）` : ''}`, kind: upload.status === 'error' ? 'warning' : 'info' });
  }
  if (state.shared?.error && !hasData) notices.push({ text: `共有された所持パルを読めませんでした: ${state.shared.error}`, kind: 'warning' });
  // 読み込めなかったファイルや、場所の分からないパルがあれば知らせる（この PC で読み込んだとき。読んでいる間も前回の分を残す）
  const snapshot = state.meta?.source === 'local' ? state.data?.snapshot : null;
  if (snapshot) {
    for (const file of snapshot.files?.skipped ?? []) notices.push({ text: `${file.path} を読めませんでした（${file.reason}）`, kind: 'warning' });
    const used = snapshot.files?.used ?? [];
    const noPlayers = !used.some((path) => /^Players\/[0-9a-f]{32}\.sav$/i.test(path));
    if (noPlayers) {
      notices.push({ text: 'Players フォルダのセーブを読めなかったため、手持ち・パルボックスのパルは場所が「不明」になります。', kind: 'warning' });
    } else if (state.data.source === 'handles') {
      // 登録した後に仲間が増えると、その人の Players のファイルは登録されていない
      const files = new Set(used.map((path) => path.toLowerCase()));
      const missing = (snapshot.players ?? []).filter((player) => player.uid && player.level > 0 && !files.has(`players/${player.uid.replace(/-/g, '').toLowerCase()}.sav`));
      if (missing.length) {
        const names = missing.map((player) => `${player.name || '名前なし'}（Players\\${player.uid.replace(/-/g, '').toUpperCase()}.sav）`);
        notices.push({ text: `登録されていないプレイヤーのファイルがあります: ${names.join('、')}。`, kind: 'warning', action: 'editWorld' });
      }
    }
    // 解析の数（この PC で読んだデータだけにある。古い IndexedDB では無い・形が違うことがあるので、数として確かめてから使う）。
    // 参照されていないタマゴ（orphanEggs）は、ふだんから 0 でないことがあるので出さない
    const stats = isObject(snapshot.stats) ? snapshot.stats : {};
    const unknown = int(stats.unknownLocation, { min: 0, fallback: 0 });
    if (unknown && !noPlayers) notices.push({ text: `場所が分からないパルが ${unknown} 体います`, kind: 'info', action: 'unknownPlace' });
    const malformed = isObject(stats.malformed) ? Object.values(stats.malformed).reduce((sum, count) => sum + int(count, { min: 0, fallback: 0 }), 0) : 0;
    if (malformed) notices.push({ text: 'セーブの一部を読めませんでした（ゲームの更新で形が変わったかもしれません）', kind: 'warning' });
  }
  return notices;
}

/**
 * 案内を一覧にする。actions に notice.action と同じ名前のボタン（{ label, run }）があれば、案内の中に出す。
 */
export function noticeList(notices, list = el('ul', 'owned-notices'), actions = {}) {
  list.replaceChildren(...notices.map((notice) => {
    const item = el('li', `owned-notice ${notice.kind ? `notice-${notice.kind}` : ''}`.trim(), notice.text);
    const action = actions[notice.action];
    if (action) item.append(button(action.label, action.run, 'button secondary owned-notice-action'));
    return item;
  }));
  list.hidden = !notices.length;
  return list;
}
