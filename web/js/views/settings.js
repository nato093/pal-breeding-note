import { el, button, runButton, statusChip, setDisabled, downloadBlob, dateStamp } from '../ui/dom.js';
import { palsById } from '../ui/pal-icon.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { openRenameDialog, confirmLogout } from '../ui/account-actions.js';
import { toCsv } from '../core/csv.js';
import { identityKey } from '../core/pair.js';
import { ownedWorldId } from '../core/owned-shared.js';
import { buildHash, parseHash, SETTINGS_OPEN } from '../router.js';
import { runningVersion } from '../version.js';
import { buildDeviceData, deviceFileName, parseDeviceData, importSummary, DEVICE_MAX_BYTES } from '../device-data.js';
import { viewHeading, watchView } from './shared.js';
import { tabLabel } from './tabs.js';
import { ownedSettingsCard, downloadOwnedCsv } from './owned-settings.js';

const warningMessages = {
  DUPLICATE_RECORD: '同じ配合が重複して登録されています。', DUPLICATE_ID: '登録の識別情報が重複しています。',
  UNKNOWN_PAL: 'マスターにないパルが含まれています。', BAD_COUNT: '確認回数が正しくありません。',
};

// 権利表記（README と同じ意味。設定の最下部とログイン画面）
export const RIGHTS_NOTE = 'Palworld のゲームデータ・名称・画像の権利は © Pocketpair, Inc. に帰属します。非公式・非営利のファンツールです。';

function exportCsv(records) {
  const columns = ['ID', '親1 ID', '親1 名前', '親2 ID', '親2 名前', '子 ID', '子 名前', '親1 性別', '親2 性別', '登録者', 'メモ', '確認回数', '登録日時', '更新日時'];
  const rows = records.map((record) => [record.id, record.parent1Id, palsById.get(record.parent1Id)?.ja ?? '',
    record.parent2Id, palsById.get(record.parent2Id)?.ja ?? '', record.childId, palsById.get(record.childId)?.ja ?? '',
    record.parent1Gender, record.parent2Gender, record.registrant, record.memo, record.confirmCount, record.createdAt, record.updatedAt]);
  downloadBlob(new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }), `pal-breedings-${dateStamp()}.csv`);
}

// この端末の既読の id
const readIds = (context) => context.notifications?.readList?.() ?? [];

// 登録者の対応（登録したワールドと読んでいるワールドの分）
function playerMappings(context) {
  const autoRegister = context.autoRegister;
  if (!autoRegister) return {};
  const ids = new Set([...(context.owned?.state?.auto?.worlds ?? []).map((world) => world.id), context.owned?.state?.local?.world?.id].filter(Boolean));
  return Object.fromEntries([...ids].map((id) => [id, autoRegister.mapping(id)]));
}

// 取り込む（各ストアの関数を通す。今のデータは消さずに足す）。取り込んだ結果の文を返す
function importDeviceData(context, data) {
  const parts = [];
  const failed = [];
  const drafts = context.drafts?.importMany(data.drafts);
  if (drafts?.added) parts.push(`下書き ${drafts.added}`);
  if (drafts && !drafts.saved) failed.push('下書き');
  const goals = context.ideals?.importGoals(data.goals, data.goalsObs);
  if (goals?.added) parts.push(`目標 ${goals.added}`);
  if (goals && !goals.saved) failed.push('目標');
  // 自動登録の記録は既読より先に足す（後から足すと、取り込んだ既読が当たらず未読で残る）
  const notices = context.autoRegister?.importNotices?.(data.autoBreedingNotices) ?? { added: 0, skipped: 0 };
  if (notices.added) parts.push(`自動登録の記録 ${notices.added}`);
  const unread = new Set(context.notifications?.unread().map((item) => item.id) ?? []);
  const read = data.notificationsRead.filter((id) => unread.has(id));
  if (read.length) {
    context.notifications.markRead(read);
    parts.push(`通知の既読 ${read.length}`);
  }
  let mapped = 0;
  for (const [worldId, mapping] of Object.entries(data.playerMappings)) {
    const current = context.autoRegister?.mapping(worldId) ?? null;
    if (!current) continue;
    for (const [uid, userId] of Object.entries(mapping)) {
      if (current[uid]) continue;
      context.autoRegister.setMapping(uid, userId, worldId);
      mapped++;
    }
  }
  if (mapped) {
    parts.push(`プレイヤーの対応 ${mapped}`);
    // 自分のプレイヤーが変わったかもしれない（理想個体の「自分の個体」。設定の select で選んだときと同じ）
    if (context.self?.changed) context.self.changed();
    else context.ideals?.identityChanged?.();
  }
  const over = [goals?.skipped ? `目標 ${goals.skipped} 件` : '', notices.skipped ? `自動登録の記録 ${notices.skipped} 件` : ''].filter(Boolean);
  const skipped = over.length ? `（${over.join('・')}は重複・上限で取り込みませんでした）` : '';
  const text = parts.length ? `取り込みました: ${parts.join('・')} 件${skipped}` : `新しく取り込むものはありませんでした${skipped}`;
  return { text, failed };
}

export function settingsView(context, route = parseHash('#/settings')) {
  const { store } = context;
  const element = el('section', 'view settings-view');
  element.append(viewHeading(tabLabel('settings')));

  // ---- アカウント（「ログイン中: X」と名前の変更・ログアウト。名前の変更の説明はモーダルの側だけ。C-40） ----
  const access = el('section', 'settings-card settings-account');
  const accountId = el('p', 'settings-account-id');
  const renameNote = el('p', 'muted settings-rename-note');
  const rename = button('ID を変更', () => openRenameDialog(context), 'button secondary');
  // 途中で止まった ID の変更は、同じ内容でやり直す（別の ID への変更と混ざらないように）
  const retry = button('ID の変更を再試行', async () => {
    await runButton(retry, async () => {
      const userId = await context.renamer.retry();
      toast(`ID を「${userId}」に変更しました`);
    }, (error) => toast(error.message, { kind: 'error' }));
  }, 'button primary');
  const logout = button('ログアウト', () => confirmLogout(store), 'button quiet danger-text');
  const accountRow = el('div', 'settings-account-row');
  accountRow.append(accountId);
  if (context.renamer) accountRow.append(rename, retry);
  accountRow.append(logout);
  access.append(el('h2', '', 'アカウント'), accountRow, ...(context.renamer ? [renameNote] : []));

  // ---- データ（整合性の警告〔0 件なら隠す〕・書き出し・この端末のデータ） ----
  const dataGroup = el('section', 'settings-group');
  const warnings = el('section', 'settings-card settings-warnings');
  const warningsTitle = el('h3', '', '整合性の警告');
  warningsTitle.tabIndex = -1;
  const warningList = el('div', 'warning-list');
  warnings.append(warningsTitle, warningList);
  warnings.hidden = true;

  // 書き出し（配合の CSV・表示中のワールドの所持パルの CSV。判断事項 11）
  const exportCard = el('section', 'settings-card settings-export');
  const recordsCsv = button('配合の CSV', () => exportCsv(store.state.records), 'button secondary');
  const ownedCsv = button('所持パルの CSV（表示中のワールド）', () => {
    const owned = context.owned?.state;
    if (owned?.owned) downloadOwnedCsv(owned.owned, owned.meta?.saveUpdatedAt ?? '');
  }, 'button secondary');
  const exportRow = el('div', 'settings-actions');
  exportRow.append(recordsCsv, ...(context.owned ? [ownedCsv] : []));
  exportCard.append(el('h3', '', '書き出し'), el('p', 'muted', '有効な登録全件と、表示しているワールドの所持パルを、パルの名前付きの CSV に保存します。'), exportRow);

  // この端末のデータ（下書き・目標・既読・自動登録の記録と登録者の対応。F081）
  const deviceCard = el('section', 'settings-card settings-device');
  const deviceTitle = el('h3', '', 'この端末のデータ');
  deviceTitle.append(statusChip('この端末だけ', 'neutral', 'device-only-chip'));
  const deviceCounts = el('p', 'settings-device-counts');
  const fileInput = el('input', 'visually-hidden');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.setAttribute('aria-label', 'この端末のデータのファイル');
  fileInput.tabIndex = -1;
  // 選ぶのは「読み込む」のボタン（隠した入力は読み上げにも出さない）
  fileInput.setAttribute('aria-hidden', 'true');
  const exportDevice = button('書き出す', () => {
    const data = buildDeviceData({
      env: store.state.env, userId: store.state.userId,
      drafts: context.drafts?.list() ?? [], goals: context.ideals?.list() ?? [], observations: context.ideals?.observations?.() ?? null,
      read: readIds(context), notices: context.autoRegister?.notices?.() ?? [], mappings: playerMappings(context),
    });
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), deviceFileName(store.state.env));
  }, 'button secondary');
  const importDevice = button('読み込む', () => fileInput.click(), 'button secondary');
  fileInput.addEventListener('change', () => readDeviceFile(fileInput.files?.[0]));
  const deviceRow = el('div', 'settings-actions');
  deviceRow.append(exportDevice, importDevice, fileInput);
  deviceCard.append(deviceTitle, el('p', 'muted', '下書き・目標・通知の既読・自動登録の記録・プレイヤーの対応は、この端末にだけ残ります。書き出したファイルを別の端末で読み込むと、今のデータに足します（パスワードと所持パルは含みません）。'),
    deviceCounts, deviceRow);
  async function readDeviceFile(file) {
    fileInput.value = '';
    if (!file) return;
    if (file.size > DEVICE_MAX_BYTES) { toast('ファイルが大きすぎます（1MB まで）。', { kind: 'error' }); return; }
    let text = '';
    try { text = await file.text(); } catch { toast('ファイルを読めませんでした。', { kind: 'error' }); return; }
    const parsed = parseDeviceData(text, { env: store.state.env, userId: store.state.userId });
    if (!parsed.ok) { toast(parsed.reason, { kind: 'error' }); return; }
    if (parsed.otherUser && !await confirmDialog('別の ID のデータです', `別の ID（${parsed.otherUser}）のデータです。取り込みますか？`, { confirmText: '取り込む' })) return;
    const summary = importSummary(parsed.data);
    if (!summary) { toast('取り込むデータがありませんでした。'); return; }
    if (!await confirmDialog('この端末のデータを取り込みますか？', summary, { confirmText: '取り込む' })) return;
    const result = importDeviceData(context, parsed.data);
    toast(result.failed.length ? `${result.text}。この端末に${result.failed.join('・')}を保存できませんでした（ページを閉じると消えます）` : result.text,
      { kind: result.failed.length ? 'error' : 'info' });
    renderDevice();
  }
  function renderDevice() {
    const counts = [
      ['下書き', context.drafts?.list().length ?? 0], ['目標', context.ideals?.list().length ?? 0],
      ['通知の既読', readIds(context).length], ['自動登録の記録', context.autoRegister?.notices?.().length ?? 0],
    ];
    const text = counts.map(([label, count]) => `${label} ${count}`).join(' · ');
    if (deviceCounts.textContent !== text) deviceCounts.textContent = text;
    const loggedIn = Boolean(store.state.passcode && store.state.env);
    setDisabled(exportDevice, !loggedIn, loggedIn ? '' : 'ログインして記録を読み込んでから書き出せます');
    setDisabled(importDevice, !loggedIn || Boolean(store.state.renaming), store.state.renaming ? 'ID の変更が終わってから読み込めます' : loggedIn ? '' : 'ログインして記録を読み込んでから読み込めます');
  }
  function renderExport() {
    const hasOwned = Boolean(context.owned?.state?.owned);
    setDisabled(ownedCsv, !hasOwned, hasOwned ? '' : '所持パルのデータがありません（セーブ連携で読み込むか、ホストが共有すると保存できます）');
  }
  dataGroup.append(el('h2', 'settings-group-title', 'データ'), warnings, exportCard, deviceCard);

  // ---- このアプリについて（小さな文字。権利表記と、配信版のときだけ版の短いハッシュ。C-20） ----
  const about = el('footer', 'settings-about');
  const version = runningVersion();
  about.append(el('p', '', RIGHTS_NOTE), ...(version ? [el('p', '', `版: ${version.slice(0, 7)}`)] : []));

  // 並び: セーブ連携 → アカウント → データ → このアプリについて（「データの状態」はヘッダーの同期状況で代わる。通知の履歴はベルの
  //「すべての通知を見る」。C-17）
  const ownedCard = context.owned ? ownedSettingsCard(context) : null;
  element.append(...(ownedCard ? [ownedCard.element] : []), access, dataGroup, about);

  // アカウントは、配合の一覧が変わらない操作（名前の変更の完了・再試行）でも変わるので、store が変わるたびに描き直す
  function renderAccount(state) {
    accountId.textContent = `ログイン中: ${state.userId}`;
    const pending = context.renamer?.pending();
    renameNote.textContent = pending ? `「${pending.oldId}」から「${pending.newId}」への ID の変更が終わっていません。再試行してください。` : '';
    renameNote.hidden = !pending;
    rename.hidden = Boolean(pending);
    retry.hidden = !pending;
    // 名前の変更中は、ログアウトや別の変更をさせない
    rename.disabled = state.renaming;
    logout.disabled = state.renaming;
  }
  // 整合性の警告は、記録が同じでも変わる（記録の変更番号が増えない）ので、それらが変わったときも描き直す
  const dataKey = (state) => JSON.stringify([state.warnings, state.env]);
  let shownData = '';
  const unsubscribeAccount = store.subscribe((state) => {
    renderAccount(state);
    renderDevice();
    if (dataKey(state) !== shownData) renderData(state);
  });
  renderAccount(store.state);
  function renderData(state) {
    shownData = dataKey(state);
    renderDevice();
    renderExport();
    const list = state.warnings ?? [];
    // 0 件ならカードごと隠す（C-11）
    warnings.hidden = !list.length;
    warningsTitle.textContent = `整合性の警告（${list.length} 件）`;
    warningList.replaceChildren();
    for (const warning of list) {
      const row = el('div', 'integrity-warning');
      row.append(el('p', '', `${warning.rowNumber ? `${warning.rowNumber} 行目: ` : ''}${warningMessages[warning.code] ?? '保存先の内容を管理者に確認してください。'}`));
      if (warning.code === 'DUPLICATE_RECORD') {
        const source = state.records.find((record) => record.id === warning.id);
        const target = source && state.records.find((record) => record.id !== source.id && identityKey(record) === identityKey(source));
        if (target) {
          const merge = button('統合', async () => {
            await runButton(merge, () => context.merge(source, target), (error) => toast(error.message, { kind: 'error' }));
          }, 'button secondary');
          row.append(merge);
        }
      }
      warningList.append(row);
    }
  }
  const view = watchView(store, element, renderData);
  // 下書き・目標・既読・自動登録が変わったら件数を、所持パルが変わったら所持パルの CSV の押せるかを書き直す
  const unsubscribes = [
    context.drafts?.subscribe?.(renderDevice), context.ideals?.subscribe?.(renderDevice), context.notifications?.subscribe?.(renderDevice),
    context.autoRegister?.subscribe?.(renderDevice), context.owned?.subscribe?.(renderExport),
  ].filter(Boolean);
  // 設定の行き先（`#/settings?world=<ID>&open=<意図>`。router.js の settingsHash・SETTINGS_OPEN）: セーブ連携の、意図の所
  //（このワールドでの自分・そのワールドの未設定の登録者・状態の欄の操作。前の版の auto は前の決め方）へフォーカスする。
  // warnings は整合性の警告のカード（レールの設定のバッジ）。
  // 作るときと、同じ画面のまま URL が変わったとき（設定を開いたまま通知を押したなど）に読む。
  // 読んだら URL から world・open を外す（戻る・進む・読み込み直しで、もう一度開いてフォーカスを動かさない）
  function applyRoute(next) {
    const open = next?.params?.get('open');
    if (!SETTINGS_OPEN.includes(open)) return;
    if (open === 'warnings') revealWarnings();
    else ownedCard?.reveal({ worldId: ownedWorldId(next.params.get('world')), open });
    context.replace?.(buildHash('settings'));
  }
  let destroyed = false;
  function revealWarnings() {
    const move = () => {
      if (destroyed) return;
      const target = warnings.hidden ? dataGroup.querySelector('.settings-group-title') : warningsTitle;
      target?.scrollIntoView?.({ block: 'start' });
      if (target && target.tabIndex < 0) target.focus?.({ preventScroll: true });
    };
    const frame = globalThis.requestAnimationFrame;
    if (typeof frame === 'function') frame(() => frame(move));
    else setTimeout(move, 0);
  }
  applyRoute(route);
  return {
    element, applyRoute,
    destroy() { destroyed = true; view.destroy(); unsubscribeAccount(); for (const unsubscribe of unsubscribes) unsubscribe(); ownedCard?.destroy(); },
  };
}
