// ヘッダーのセーブ連携の状態（所持パルの読み込み・共有・自動登録）。押すと詳しい状態と操作のポップオーバーを開く。
// 許可が切れているときは、押したクリックの中で（await を挟まずに）読む許可を求める。
import { el, button, link, runButton, formatShortTime } from './dom.js';
import { toast } from './toast.js';
import { dateTime, worldName, timeLines, permissionNotice, grantWithReport, roleSummary, presenceItems, dimensionNotice, uploadNotice, watchSummary } from './owned-status.js';
import { createPopover } from './popover.js';
import { settingsHash } from '../router.js';

// 古いデータの目安。この PC で読むデータはゲームが保存するたび（約 30 秒ごと。見張れないブラウザでは定期の確認）に読み直すので 5 分、
// 共有のデータは 60 分（実機で直してよい）
export const STALE_LOCAL_MS = 5 * 60 * 1000;
export const STALE_SHARED_MS = 60 * 60 * 1000;

const timeOf = (value) => {
  const time = new Date(value).getTime();
  return value && Number.isFinite(time) ? time : NaN;
};
const olderThan = (value, limit, now) => now - timeOf(value) > limit;

/** チップの文（ワールド名・時刻・自動登録の 3 つの部品をつないだもの）。 */
export function saveStatusLine({ world = '', time = '', auto = '' }) {
  return `${world ? `${world}· ` : ''}${time}${auto ? ` · ${auto}` : ''}`;
}

/**
 * 表示の中身を決める（DOM なし）。上の行ほど優先する。
 * busy は読み込み中（文は変えず、点を流れる光にする。前の文を残すのは saveStatus の側）。
 * selfUids は自分のプレイヤー（パル次元ストレージの読み漏れの参加者の案内。ui/owned-status.js の dimensionNotice）。
 * @returns {{ tone: 'ok' | 'busy' | 'warn' | 'stale' | 'none', text: string, world: string, time: string, auto: string,
 *   title: string, action: 'grant' | null, busy: boolean }}
 */
export function saveStatusModel(state, { autoEnabled = () => false, now = Date.now(), selfUids = new Set() } = {}) {
  const meta = state.meta;
  const busy = Boolean(state.busy || (state.auto?.enabled && state.auto.status === 'checking'));
  const result = (tone, parts, title, action = null) => ({
    tone, text: saveStatusLine(parts), world: parts.world ?? '', time: parts.time ?? '', auto: parts.auto ?? '', title, action, busy,
  });
  if (!state.ready) return result('busy', { time: '所持パルを確認中…' }, '保存済みの所持パルを確認しています');
  const auto = state.auto ?? {};
  const permission = permissionNotice(state, { now: () => now });
  if (permission) return result('warn', { time: '許可が必要' }, `${permission.text}（押すと許可を求めます）`, 'grant');
  if (auto.enabled && ['error', 'empty'].includes(auto.status)) return result('warn', { time: 'セーブを読めません' }, auto.error || 'セーブを読めませんでした');
  if (state.upload?.status === 'error') return result('warn', { time: '共有できません' }, `共有できませんでした${state.upload.error ? `（${state.upload.error}）` : ''}`);
  if (state.shared?.error && !meta?.source) return result('warn', { time: '共有を読めません' }, `共有された所持パルを読めませんでした: ${state.shared.error}`);
  if (!meta?.source) {
    return state.role === 'guest'
      ? result('none', { time: '共有待ち' }, 'ホストがまだこのワールドの所持パルを共有していません')
      : result('none', { time: 'セーブ未連携' }, 'セーブのファイルが登録されていません');
  }
  const world = meta.worldName ? `「${meta.worldName}」` : `ワールド ${String(meta.worldId ?? '').slice(0, 8)}`;
  // ゲーム内の日数・プレイ中・Lv（save-extras）も、押す前の説明（title）に出す
  const lines = [worldName(meta), ...timeLines(state), ...presenceItems(state, { now: () => now }).map(([term, detail]) => `${term}: ${detail}`)];
  // パル次元ストレージの読み漏れ（dps-missing）も押す前の説明に出す（チップの色は変えない。所持パルは読めた分で出ている）
  const gap = dimensionNotice(state, { selfUids });
  if (gap) lines.push(gap.text);
  // 共有の送信の結果（同じセーブが共有済み・共有の方が新しい。share-upload）も押す前の説明に出す（チップの色は変えない）
  const sent = uploadNotice(state);
  if (sent) lines.push(sent.text);
  if (meta.source === 'local') {
    const stale = Boolean(auto.enabled) && olderThan(meta.importedAt, STALE_LOCAL_MS, now);
    if (stale) lines.push(`最後に読み込んだのは ${dateTime(meta.importedAt)} です（ふだんはゲームが保存するたびに読み直します）`);
    const parts = { world, time: `セーブ ${formatShortTime(meta.saveUpdatedAt, now, '不明')}` };
    if (state.role === 'host') parts.auto = `自動登録 ${autoEnabled(meta.worldId) ? 'オン' : 'オフ'}`;
    return result(stale ? 'stale' : 'ok', parts, lines.join('\n'));
  }
  const sharedAt = meta.sharedAt || meta.saveUpdatedAt;
  const stale = olderThan(sharedAt, STALE_SHARED_MS, now);
  if (stale) lines.push(`最後に共有されたのは ${dateTime(sharedAt)} です`);
  return result(stale ? 'stale' : 'ok', { world, time: `共有 ${formatShortTime(sharedAt, now, '不明')}` }, lines.join('\n'));
}

// ポップオーバーに出す、困っていること（なければ空）。許可切れは permissionNotice の文・止まった時刻・勧め、
// パル次元ストレージの読み漏れは所持パルの案内と同じ文（dimensionNotice）
function problems(state, now, { selfUids = new Set() } = {}) {
  const items = [];
  const auto = state.auto ?? {};
  const permission = permissionNotice(state, { now: () => now });
  if (permission) items.push(`${permission.text}。`, ...(permission.since ? [`${permission.since}。`] : []), `${permission.hint}。`);
  else if (auto.enabled && ['error', 'empty'].includes(auto.status) && auto.error) items.push(auto.error);
  if (state.upload?.status === 'error') items.push(`共有できませんでした${state.upload.error ? `（${state.upload.error}）` : ''}`);
  if (state.shared?.error && !state.meta?.source) items.push(`共有された所持パルを読めませんでした: ${state.shared.error}`);
  if (state.error) items.push(`セーブを読み込めませんでした: ${state.error}`);
  const gap = dimensionNotice(state, { selfUids });
  if (gap) items.push(gap.text);
  return items;
}

/**
 * ヘッダーの部品。中身は textContent・className・title だけを書き換える（作り直さない）。
 * ヘッダーはアプリと同じ寿命だが、テストのために destroy で購読を全部外せる。
 * selfUids は自分のプレイヤーの UID を返す関数（app.js は ideals.selfUids。参加者のパル次元ストレージの読み漏れの案内）
 */
export function saveStatus({ owned, autoRegister, store, now = () => Date.now(), onOpen, openFarms, selfUids = () => new Set() }) {
  const element = el('div', 'save-status');
  const trigger = button('', onClick, 'save-status-button');
  trigger.setAttribute('aria-haspopup', 'dialog');
  const text = el('span', 'save-status-text');
  const world = el('span', 'save-status-world');
  const worldSep = el('span', 'save-status-sep');
  const time = el('span', 'save-status-time');
  const autoSep = el('span', 'save-status-sep');
  const auto = el('span', 'save-status-auto');
  text.append(world, worldSep, time, autoSep, auto);
  trigger.append(text);
  element.append(trigger);
  // 画面に出している文（読み込み中は前の文を残す）と、書き込んだ内容の印（同じなら DOM を触らない）
  let shown = null;
  let written = '';
  // 押したときの動き（読み込み中に前の文を残していても、今の状態で決める）
  let action = null;

  // 詳しい状態と操作のパネル。中身は開いたときだけ作り、開いている間の update は閉じずに書き換える
  let renderPanel = null;
  const popup = createPopover({
    anchor: trigger, wrapper: element, tag: 'section', className: 'header-panel save-status-panel',
    onOpen: () => { renderPanel = buildPanel(); onOpen?.(); },
    onClose: () => { renderPanel = null; popup.element.replaceChildren(); },
  });
  // ボタンの aria-haspopup="dialog" と合わせる（モーダルではない小さなパネル）
  popup.element.setAttribute('role', 'dialog');
  popup.element.setAttribute('aria-label', 'セーブ連携');
  function buildPanel() {
    const panel = popup.element;
    const details = el('dl', 'save-status-details');
    const issues = el('ul', 'save-status-issues');
    // 許可はクリックの中で（await を挟まずに）求める
    const grant = button('読み込みを許可', () => grantPermission(), 'button primary');
    const reload = button('今すぐ読み込む', () => runButton(reload, () => owned.refreshAuto({ enable: true }), (error) => toast(error.message, { kind: 'error' })), 'button secondary');
    // 設定のセーブ連携のカード（状態の欄の操作〔許可・今すぐ読み込む〕か見出しへフォーカス。router.js の settingsHash の 'status'）
    const settings = link('設定を開く', settingsHash('', 'status'), 'save-status-settings');
    settings.addEventListener('click', () => popup.close({ focus: false }));
    // 全部の配合牧場を右のドロワーで（牧場の情報があるときだけ。farm-board）
    const farms = button('配合牧場を見る', () => {
      popup.close({ focus: false });
      openFarms?.(trigger);
    }, 'button secondary');
    farms.hidden = true;
    const actions = el('div', 'header-panel-actions');
    actions.append(grant, reload, farms, settings);
    panel.replaceChildren(el('h2', '', 'セーブ連携'), details, issues, actions);
    const render = () => {
      const state = owned.state;
      const items = [];
      // 役割の説明（ホスト・参加者・共有を見ている人。roles）
      const role = roleSummary(state, { userId: store?.state?.userId ?? '', now });
      if (role) items.push(['この PC', role.hint ? `${role.text}\n${role.hint}` : role.text]);
      items.push(['表示中', state.meta ? `${worldName(state.meta)}${state.meta.source ? ` · ${state.owned?.pals.length ?? state.meta.palCount ?? 0} 体` : '（データなし）'}` : 'なし']);
      const lines = timeLines(state);
      if (lines.length) items.push(['更新', lines.join('\n')]);
      // セーブのファイルの見張りの方式と最後の保存（自動の読み込みが有効で登録があるときだけ。save-watch）
      const watching = watchSummary(state, { now });
      if (watching) items.push(['監視', watching]);
      // 共有の送信の結果（「同じセーブが共有済み（Alice の PC から）」など。share-upload）
      const sent = uploadNotice(state);
      if (sent) items.push(['共有', sent.text]);
      // ゲーム内の日数・プレイ中の仲間（保存か共有の時刻つき）・Lv（save-extras。F006）
      items.push(...presenceItems(state, { now }));
      if (state.busy && state.progress) items.push(['読み込み', state.progress]);
      details.replaceChildren(...items.flatMap(([term, detail]) => [el('dt', '', term), el('dd', '', detail)]));
      const found = problems(state, now(), { selfUids: selfUids() });
      issues.replaceChildren(...found.map((item) => el('li', '', item)));
      issues.hidden = !found.length;
      grant.hidden = !(state.auto.enabled && state.auto.status === 'permission');
      reload.hidden = !state.auto.worlds?.length;
      farms.hidden = !openFarms || !Array.isArray(state.owned?.farms);
      reload.disabled = state.busy;
      settings.href = settingsHash(state.linkedWorldId || state.meta?.worldId || '', 'status');
    };
    render();
    return render;
  }

  function grantPermission() {
    grantWithReport(owned);
  }

  function onClick() {
    if (action === 'grant') {
      popup.close({ focus: false });
      grantPermission();
      return;
    }
    if (popup.isOpen()) popup.close({ focus: false });
    else popup.open();
  }

  function update() {
    const model = saveStatusModel(owned.state, { autoEnabled: (worldId) => autoRegister?.enabled(worldId) ?? false, now: now(), selfUids: selfUids() });
    // 読み込み中は文を変えない（幅が揺れない）。最初の「確認中」だけは置き換える
    if (!(model.busy && shown && shown.tone !== 'busy')) shown = model;
    action = model.action;
    const title = model.busy && owned.state.progress ? `${owned.state.progress}\n${shown.title}` : shown.title;
    const key = JSON.stringify([shown.text, shown.tone, action, model.busy, title]);
    if (key !== written) {
      written = key;
      world.textContent = shown.world;
      worldSep.textContent = shown.world ? '· ' : '';
      time.textContent = shown.time;
      autoSep.textContent = shown.auto ? ' · ' : '';
      auto.textContent = shown.auto;
      trigger.className = `save-status-button tone-${shown.tone}${model.busy ? ' is-busy' : ''}`;
      trigger.title = title;
      trigger.setAttribute('aria-label', `セーブ連携: ${shown.text}`);
      if (action === 'grant') trigger.removeAttribute('aria-haspopup');
      else trigger.setAttribute('aria-haspopup', 'dialog');
    }
    renderPanel?.();
  }

  const unsubscribe = [owned.subscribe(update), store?.subscribe(update), autoRegister?.subscribe?.(update)].filter(Boolean);
  update();
  return {
    element, update, close: () => popup.close({ focus: false }),
    destroy() {
      popup.destroy();
      for (const off of unsubscribe) off();
    },
  };
}
