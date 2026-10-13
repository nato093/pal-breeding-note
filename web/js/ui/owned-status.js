// 所持パルの状態（連携・共有・更新時刻）の文言。所持パルのタブと設定タブで使う。
// データ元の 1 行（ownedSourceLine）は、所持パル・理想個体・継承ルートの画面に「どのワールドの・どこから・いつのデータか」を出す
// （ヘッダーのセーブ連携の状態〔ui/save-status.js〕は全体の状態と操作、この 1 行は画面の結果がどのデータかを示す読み取り専用のもの）。
import { el, button, link, formatShortTime, svgElement } from './dom.js';
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
    : state.role === 'guest' ? '参加している側（ホストが共有した所持パルを表示します）' : '';
}

// 共有の結果の案内（送っている間〔sending〕は状態のスロットに出す）
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

const REGISTER_TEXT = '自分のセーブを読むには、設定でワールドを登録してください。';

/**
 * 所持パルのタブの上に出す案内。対応が要るものだけ（読み込み中・確認中・共有中は状態のスロット〔activityText〕に出す）。
 * action は案内の中のボタンの名前（views/owned.js の noticeActions。grant＝読む許可・settings＝設定のセーブ連携へ・unknownPlace＝場所の分からないパル）
 */
export function ownedNotices(state) {
  const notices = [];
  if (!state.ready) return notices;
  const auto = state.auto ?? {};
  const hasData = Boolean(state.meta?.source);
  if (!auto.enabled) {
    // 共有された所持パルなどを表示できているときは出さない
    if (!hasData) notices.push({ text: REGISTER_TEXT, kind: 'info', action: 'settings' });
  } else if (auto.status === 'permission') {
    notices.push({ text: auto.error, kind: 'warning', action: 'grant' });
  } else if (auto.status === 'empty') {
    notices.push({ text: REGISTER_TEXT, kind: 'warning', action: 'settings' });
  } else if (auto.status === 'error') {
    notices.push({ text: `${auto.error}（設定タブで確認できます）`, kind: 'warning' });
  }
  // 参加している側は、データがないときだけ（どこから取ったかはデータ元の 1 行に出る）
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
        notices.push({ text: `登録されていないプレイヤーのファイルがあります: ${names.join('、')}。設定タブの「セーブ連携」で、そのワールドの「編集」から追加できます。`, kind: 'warning' });
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
 * 状態のスロットの文。読み込みの状態（state.activity）があればその文（kind 'busy'）、なければ最後に確かめた時刻（kind 'idle'）。
 * 例「確認中…」「Level.sav を読み込み中…」「共有中…」「最終確認 13:42」
 */
export function activityText(state, now = Date.now()) {
  if (!state?.ready) return { kind: 'busy', text: '確認中…' };
  if (state.activity === 'checking') return { kind: 'busy', text: '確認中…' };
  if (state.activity === 'reading') return { kind: 'busy', text: state.progress || 'セーブを読み込み中…' };
  if (state.activity === 'sharing') return { kind: 'busy', text: '共有中…' };
  return { kind: 'idle', text: `最終確認 ${formatShortTime(state.checkedAt, now, '—')}` };
}

/** データ元の 1 行の文: 「テスト」（ホスト Alice） · この PC／共有 · 1194 体 · セーブ 10/10 09:00。表示できるデータがなければ '' */
export function sourceText(state) {
  const meta = state?.meta;
  if (!meta?.source) return '';
  const count = state.owned?.pals?.length ?? meta.palCount ?? 0;
  return [worldName(meta), meta.source === 'local' ? 'この PC' : '共有', `${count} 体`, `セーブ ${dateTime(meta.saveUpdatedAt)}`].join(' · ');
}

// 読み込み中に回す小さな輪（何もしていないときは隠し、動きを減らす設定では回さない。CSS の .owned-activity-spinner）
function spinner() {
  const svg = svgElement('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true', focusable: 'false', class: 'owned-activity-spinner' });
  svg.append(svgElement('circle', { cx: 8, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-dasharray': '26 12' }));
  return svg;
}

/**
 * データ元の 1 行の部品（読み取り専用）。[ワールド · この PC／共有 · N 体 · セーブ 時刻][状態のスロット（幅固定）][読み込みを許可][設定 →]。
 * 中身は作り直さず、文と印だけを書き換える（1 分ごとの確認・20 秒ごとの読み直しで、行の高さも各部品の幅も変わらない）。
 * actions.grant（{ label, run }）があれば、許可が切れたときに押せるボタンを出す（自動の読み込みを使っていれば、ほかのときも見えないまま場所を残す）。
 * aria-live は付けない（1 分ごとに読み上げない。困っていることは所持パルの案内の帯で知らせる）
 */
export function ownedSourceLine({ actions = {}, now = () => Date.now() } = {}) {
  const element = el('div', 'owned-source');
  const text = el('span', 'owned-source-text');
  const slot = el('span', 'owned-activity');
  const label = el('span', 'owned-activity-text');
  slot.append(spinner(), label);
  element.append(text, slot);
  const grant = actions.grant ? button(actions.grant.label, actions.grant.run, 'button secondary small owned-source-grant is-placeholder') : null;
  if (grant) {
    grant.disabled = true;
    element.append(grant);
  }
  element.append(link('設定 →', '#/settings', 'owned-source-settings'));
  let written = '';
  let needsGrant = false;
  function update(state) {
    const source = sourceText(state);
    const title = source ? [source, ...timeLines(state)].join('\n') : '';
    const activity = activityText(state, now());
    const auto = state?.auto ?? {};
    // 確かめている途中（checking）は前の見せ方のまま（確認のたびに点滅しない）
    if (auto.status !== 'checking') needsGrant = Boolean(auto.enabled && auto.status === 'permission');
    const key = JSON.stringify([source, title, activity, auto.enabled === true, needsGrant]);
    if (key === written) return;
    written = key;
    // 同じ値の書き込みもしない（変わった文と印だけを書き換える）
    if (text.textContent !== source) text.textContent = source;
    if (text.title !== title) text.title = title;
    if (label.textContent !== activity.text) label.textContent = activity.text;
    if (slot.title !== activity.text) slot.title = activity.text;
    slot.classList.toggle('is-busy', activity.kind === 'busy');
    if (grant) {
      if (grant.hidden !== !auto.enabled) grant.hidden = !auto.enabled;
      if (grant.disabled !== !needsGrant) grant.disabled = !needsGrant;
      grant.classList.toggle('is-placeholder', !needsGrant);
    }
  }
  return { element, update, destroy() {} };
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
