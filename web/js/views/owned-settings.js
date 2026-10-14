// 設定の「セーブ連携」。登録したワールド（モーダルで登録・編集・削除）、使うワールドの切り替え、
// 表示しているワールドでの自分、配合牧場からの自動登録（ワールドごと）、所持パルの CSV・共有の削除を扱う。
import { el, button, runButton, statusChip, setChipTone } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { dateTime, worldName, roleLabel, timeLines } from '../ui/owned-status.js';
import { ownedRows, rowsToCsv, shortUid } from '../core/owned.js';
import { parseWorldPath, handlesFromDrop, handleDropSupported, REQUIRED_FILES } from '../save/handles.js';
import { mappedUser } from '../core/auto-breeding.js';
import { ownPlayerUids } from '../core/ideal-goals.js';
import { ownedWorldId } from '../core/owned-shared.js';
import { syncOptions } from './shared.js';

function option(value, label) {
  const node = el('option', '', label);
  node.value = value;
  return node;
}

const AUTO_STATES = { checking: '確認中…', ready: '読み込み済み', permission: '許可が必要', empty: '登録なし', error: 'エラー', off: '' };
// 読み込みの状態の印の色（状態のチップの tone。ui/dom.js の statusChip）
const AUTO_TONES = { ready: 'ready', permission: 'warning', empty: 'error', error: 'error' };
const WORLD_STATES = { permission: '許可が必要', missing: 'ファイルが見つかりません', error: '読めません' };
const SAVE_ROOT = '%LOCALAPPDATA%\\Pal\\Saved\\SaveGames';

const shortName = (world) => (world.name ? worldName(world) : `ワールド ${String(world.id).slice(0, 8)}`);

/**
 * セーブのプレイヤーの名前。所持パル・理想個体の所持者（views/shared.js の holderChoices）と同じ名前にする
 *（名前がない・同じ名前が 2 人以上なら UID の頭 8 字を添える）
 */
function playerLabels(players) {
  const counts = new Map();
  for (const player of players) counts.set(player.name, (counts.get(player.name) ?? 0) + 1);
  return (player) => (!player.name || counts.get(player.name) > 1 ? `${player.name || '不明なプレイヤー'}（${shortUid(player.uid)}）` : player.name);
}

// 画面を作った直後（まだ文書に付いていない）は、付いた後、画面を移ったときの位置の合わせ（app.js が 1 フレーム後に先頭へ戻す）も
// 済んでから行う。フレームのない環境（テスト）は次の回
function afterAttach(fn) {
  const frame = globalThis.requestAnimationFrame;
  if (typeof frame === 'function') frame(() => frame(fn));
  else setTimeout(fn, 0);
}

function registeredLabel(world) {
  const parts = [shortName(world), world.kind === 'guest' ? '参加者' : 'ホスト', `${world.files?.length ?? 0} ファイル`];
  if (world.playedAt) parts.push(`${dateTime(world.playedAt)} に遊んだ${world.role === 'guest' ? '（参加）' : ''}`);
  if (WORLD_STATES[world.status]) parts.push(WORLD_STATES[world.status]);
  return parts.join(' · ');
}

function downloadCsv(owned, importedAt) {
  const csv = rowsToCsv(ownedRows(owned, { importedAt }));
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = el('a');
  anchor.href = url;
  const now = new Date();
  anchor.download = `owned-pals-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dropZone(text, onDrop) {
  const zone = el('div', 'owned-drop', text);
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.toggle('dragging', true); });
  zone.addEventListener('dragleave', () => zone.classList.toggle('dragging', false));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.toggle('dragging', false);
    onDrop(event);
  });
  return zone;
}

function previewText(previewed) {
  if (previewed.kind !== 'host') return `参加しているワールドとして登録します（ホストの PC なら ${REQUIRED_FILES.host.filter((p) => p !== 'LocalData.sav').join('・')} もドロップしてください）`;
  const name = `${worldName({ worldName: previewed.name, hostName: previewed.hostName, worldId: previewed.worldId })} · ${previewed.palCount} 体`;
  return previewed.role === 'guest' ? `${name}（LocalData.sav の方が新しいため、いまは参加者と判定します）` : name;
}

/**
 * ワールドの登録・編集のモーダル。① パス → ② ドロップで読んで確かめ、「保存」で登録する（所持パルもそのまま共有する）。
 */
export function openWorldDialog(context, { world = null, win = globalThis } = {}) {
  const owned = context.owned;
  const modal = openDialog(world ? 'ワールドを編集' : 'ワールドを登録', { className: 'world-dialog' });
  const supported = handleDropSupported(win);

  let draft = null;
  let previewed = null;
  let checking = 0;
  // 保存の途中は、ドロップ・パスの変更・もう一度の保存を受け付けない（二重に登録しない）
  let saving = false;
  const pathInput = el('input', 'owned-path');
  pathInput.type = 'text';
  pathInput.placeholder = `${SAVE_ROOT}\\<Steam ID>\\<ワールド ID>`;
  pathInput.setAttribute('aria-label', 'ワールドのフォルダのパス');
  const pathField = el('label', 'owned-step');
  pathField.append(el('span', 'field-label', '① ワールドのフォルダのパス'), pathInput);
  const fileDrop = dropZone('ここにファイルをドロップ（何回かに分けても足せます）', (event) => {
    // ハンドルは drop イベントの中で受け取る必要がある
    const pending = handlesFromDrop(event.dataTransfer);
    addDropped(pending, draft).catch((error) => toast(error.message, { kind: 'error' }));
  });
  const draftList = el('ul', 'owned-draft');
  const dropField = el('div', 'owned-step');
  dropField.append(el('span', 'field-label', '② ファイルをドロップ'), fileDrop, draftList);
  const result = el('p', 'owned-dialog-result');
  result.setAttribute('aria-live', 'polite');
  const save = button('保存', async () => {
    if (saving || !previewed) return;
    saving = true;
    renderDraft();
    try {
      const outcome = await owned.commitRegistration(previewed);
      toast(outcome.persisted ? '保存しました。次からは自動で読み込みます' : 'このブラウザに保存できないため、ページを開いている間だけ使います');
      modal.close();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    } finally {
      saving = false;
      renderDraft();
    }
  }, 'button primary');

  // ドロップするファイル（ホストのワールド。参加しているだけなら LocalData.sav だけ）
  function renderDraft() {
    draftList.replaceChildren();
    fileDrop.classList.toggle('disabled', !draft || saving);
    pathInput.disabled = saving;
    const known = draft ? owned.state.auto.worlds.find((item) => item.id === draft.worldId) : null;
    const paths = draft ? [...new Set([...(known?.files ?? []), ...draft.files.keys()])] : [];
    const has = (path) => paths.includes(path);
    const item = (label, done) => draftList.append(el('li', done ? 'done' : '', `${done ? '✓' : '—'} ${label}`));
    for (const path of REQUIRED_FILES.host) item(path, has(path));
    const players = paths.filter((path) => path.startsWith('Players/')).length;
    item(`Players\\ の中のファイル全部${players ? `（${players} 件）` : ''}`, players > 0);
    item('..\\GlobalPalStorage.sav（任意）', has('../GlobalPalStorage.sav'));
    save.disabled = saving || !previewed;
  }

  // ドロップしたら、その場で読んで確かめる（間違ったフォルダのファイルなら、保存の前に気づける）
  async function check() {
    // パスを変えたときなど、ファイルがなくても進行中の確認の結果は捨てる（前のワールドで保存しない）
    const ticket = ++checking;
    previewed = null;
    renderDraft();
    // 登録済みのワールドで Steam ID だけ直したときは、ファイルをドロップしなくても確かめて保存できる
    const known = draft ? owned.state.auto.worlds.find((item) => item.id === draft.worldId) : null;
    const steamChanged = Boolean(known && draft.steamId && draft.steamId !== known.steamId);
    if (!draft?.files.size && !steamChanged) { result.textContent = ''; return; }
    result.textContent = '読み込んで確かめています…';
    result.className = 'owned-dialog-result';
    try {
      const checked = await owned.previewRegistration({ worldId: draft.worldId, steamId: draft.steamId, files: [...draft.files.values()] });
      if (ticket !== checking) return;
      previewed = checked;
      result.textContent = previewText(checked);
      result.className = 'owned-dialog-result ok';
    } catch (error) {
      if (ticket !== checking) return;
      result.textContent = error.message;
      result.className = 'owned-dialog-result todo';
    }
    renderDraft();
  }

  // target: ドロップしたときのワールド。ファイルを受け取るまでの間にパスを変えたら、そのファイルは使わない
  async function addDropped(pending, target) {
    const dropped = await pending;
    if (target && draft !== target) { toast('パスを変えたため、さっきドロップしたファイルは使いません。もう一度ドロップしてください'); return; }
    if (!dropped.supported) { toast('このブラウザでは、ファイルを登録できません', { kind: 'error' }); return; }
    if (saving) { toast('保存しています。終わってからドロップしてください'); return; }
    if (!draft) { toast('先に ① にワールドのフォルダのパスを貼ってください'); return; }
    if (dropped.failed) toast('フォルダは登録できません。フォルダを開いて、中のファイルを選んでドロップしてください', { kind: 'error' });
    if (dropped.duplicates.length) toast(`同じ名前のファイルが 2 つ以上あります（${dropped.duplicates.join('、')}）。1 つずつドロップしてください`);
    if (dropped.ignored.length) toast(`対象外のファイルは登録しません（${dropped.ignored.join('、')}）`);
    for (const file of dropped.files) draft.files.set(file.path, file);
    await check();
  }

  function setTarget(target) {
    if (draft?.worldId === target?.worldId && draft?.steamId === target?.steamId) return;
    // 同じワールドで Steam ID だけ直したときは、ドロップしたファイルを残して確かめ直す
    const files = draft && target && draft.worldId === target.worldId ? draft.files : new Map();
    draft = target ? { ...target, files } : null;
    check();
  }
  pathInput.addEventListener('input', () => setTarget(parseWorldPath(pathInput.value)));
  // 編集: 登録したワールドのパスを入れておく（足したいファイルをドロップするだけでよい）
  if (world) {
    pathInput.value = world.steamId ? `${SAVE_ROOT}\\${world.steamId}\\${world.id}` : '';
    draft = { worldId: world.id, steamId: world.steamId ?? '', folder: pathInput.value, files: new Map() };
  }

  if (supported) modal.body.append(pathField, dropField, result);
  else modal.body.append(el('p', 'owned-help muted', 'ファイルの登録は Chrome・Edge で使えます。Chrome か Edge で開いてください。'));
  modal.footer.append(button('キャンセル', modal.close, 'button secondary'));
  if (supported) modal.footer.append(save);
  renderDraft();
  return modal;
}

export function ownedSettingsCard(context, { win = globalThis } = {}) {
  const owned = context.owned;
  const autoRegister = context.autoRegister;
  const card = el('section', 'settings-card owned-settings');

  // ---- 状態（読み込み・許可） ----
  const autoState = statusChip('', 'neutral', 'owned-auto-state');
  const autoNow = button('今すぐ読み込む', () => runButton(autoNow, () => owned.refreshAuto({ enable: true }), (error) => toast(error.message, { kind: 'error' })), 'button secondary');
  // 許可はクリックの中で（await を挟まずに）求める
  const grant = button('読み込みを許可', () => runButton(grant, () => owned.grantAndRefresh(), (error) => toast(error.message, { kind: 'error' })), 'button primary');
  const stateRow = el('div', 'owned-import-row');
  stateRow.append(autoState, grant, autoNow);
  const autoError = el('p', 'owned-auto-error');

  // ---- 使うワールド（所持パルの表示・自動の読み込み・配合の自動登録に効く） ----
  const worldSelect = el('select', 'owned-world');
  worldSelect.setAttribute('aria-label', '使うワールド');
  const worldRow = el('label', 'owned-import-row owned-world-row');
  worldRow.append(el('span', 'field-label', '使うワールド'), worldSelect);
  let worldMode = '';
  worldSelect.addEventListener('change', () => {
    const run = worldMode === 'auto' ? owned.selectAutoWorld(worldSelect.value) : owned.setViewWorld(worldSelect.value);
    Promise.resolve(run).catch((error) => toast(error.message, { kind: 'error' }));
  });
  const status = el('dl', 'owned-settings-status');

  // ---- 登録したワールド ----
  const registered = el('ul', 'owned-registered');
  const add = button('＋ ワールドを登録', () => openWorldDialog(context, { win }), 'button primary');
  const worldsHead = el('div', 'owned-worlds-head');
  worldsHead.append(el('h3', '', '登録したワールド'), add);
  const emptyNote = el('p', 'owned-help muted', 'まだ登録していません。「＋ ワールドを登録」から、ワールドのセーブのファイルを登録してください。');

  // ---- 配合牧場からの自動登録（ワールドの行を開いたところで、そのワールドについて設定する） ----
  // onToggle: オン・オフを切り替えたとき（行の「配合の自動登録: オン」をすぐ書き換える）。
  // parts: 設定の行き先（reveal）がフォーカスする部品（自動登録のチェック・登録者の選択と、未設定か）を入れる
  function breedingPanel(world, view, users, onToggle, parts) {
    const panel = el('div', 'owned-breeding');
    panel.append(el('p', 'owned-step-title', '配合牧場からの自動登録'));
    if (world.kind === 'guest') {
      panel.append(el('p', 'owned-help muted', '参加しているワールドなので、自動登録は動きません。'));
      return panel;
    }
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = view.enabled;
    toggle.addEventListener('change', () => {
      autoRegister.setEnabled(toggle.checked, world.id);
      onToggle(toggle.checked);
    });
    const label = el('label', 'owned-toggle');
    label.append(toggle, el('span', '', '新しく産まれたタマゴから、配合を自動で登録する'));
    panel.append(label);
    parts.toggle = toggle;
    // 登録者を選ぶには、セーブのプレイヤーが要る（読み込んだワールドのものだけ分かる）
    if (!view.players) {
      panel.append(el('p', 'owned-help muted', '登録者は、このワールドを「使うワールド」にして読み込むと選べます。'));
      return panel;
    }
    const players = el('div', 'owned-breeding-players');
    players.append(el('p', 'owned-step-title', '登録者（親を拠点に預けた人 → このノートの ID）'));
    for (const player of view.players) {
      const select = el('select');
      select.setAttribute('aria-label', `${player.name || 'プレイヤー'}の登録者`);
      const sameName = mappedUser(player, { users });
      select.append(option('', sameName ? `${sameName}（同じ名前）` : '未設定（登録しない）'));
      for (const user of users) select.append(option(user, user));
      select.value = users.includes(view.mapping[player.uid]) ? view.mapping[player.uid] : '';
      select.addEventListener('change', () => {
        autoRegister.setMapping(player.uid, select.value, world.id);
        // 対応表は自分のプレイヤーの決め方にも使う（このワールドでの自分を選んでいないとき）。同じセーブのまま判定し直し、自動の名前も描き直す
        context.ideals?.identityChanged?.();
        renderSelf();
      });
      // 未設定（対応も同じ名前のユーザーもない）＝自動登録で「プレイヤーの対応が未設定です」になる
      parts.registrants.push({ select, unmapped: () => select.value === '' && !sameName });
      const row = el('label', 'owned-breeding-player');
      row.append(el('span', '', player.name || `プレイヤー ${player.uid.slice(0, 8)}`), select);
      players.append(row);
    }
    panel.append(players);
    return panel;
  }

  // ---- 所持パル（ワールドの行を開いたところで、そのワールドについて操作する） ----
  function ownedPanel(world, view) {
    const panel = el('div', 'owned-world-pals');
    panel.append(el('p', 'owned-step-title', '所持パル'));
    const csv = button('CSV で保存', () => runButton(csv, async () => {
      const found = await owned.ownedOf(world.id);
      if (!found) { toast('このワールドの所持パルがまだありません'); return; }
      downloadCsv(found.owned, found.importedAt);
    }, (error) => toast(error.message, { kind: 'error' })), 'button secondary');
    busyButtons.push([csv, () => !view.hasOwned]);
    const row = el('div', 'owned-import-row');
    row.append(csv);
    // 共有した所持パルの削除は、この PC がホストとして共有したワールドだけ
    if (view.sharedAt && world.kind !== 'guest') {
      const remove = button('共有した所持パルを削除', async () => {
        if (!await confirmDialog('共有した所持パルを削除しますか？', 'スプレッドシートから、このワールドの所持パルを消します。仲間の画面にも表示されなくなります。セーブは変わりません。', { confirmText: '削除', danger: true })) return;
        await runButton(remove, async () => { await owned.deleteShared(world.id); toast('共有した所持パルを削除しました'); }, (error) => toast(error.message, { kind: 'error' }));
      }, 'button quiet danger-text');
      busyButtons.push([remove, () => false]);
      row.append(remove);
    }
    panel.append(row);
    if (!view.hasOwned) panel.append(el('p', 'owned-help muted', 'このワールドを読み込むか、ホストが共有すると保存できます。'));
    return panel;
  }

  // 登録したワールドがないとき（ホストが共有したワールドを見ているとき）は、表示しているワールドを CSV で保存できる
  const csvButton = button('所持パルを CSV で保存', () => {
    if (owned.state.owned) downloadCsv(owned.state.owned, owned.state.meta?.saveUpdatedAt ?? '');
  }, 'button secondary');
  const dataRow = el('div', 'owned-import-row');
  dataRow.append(csvButton);

  // ---- このワールドでの自分（表示しているワールドのプレイヤーから 1 人。理想個体の完成の判定と自分の個体の絞り込みに使う。この端末だけ） ----
  // 状態の欄（status）は描くたびに作り直すので、その外に作り直さない行として置く。選択肢は表示する内容が変わったときだけ作り直す
  const selfSelect = el('select', 'owned-self');
  selfSelect.setAttribute('aria-label', 'このワールドでの自分');
  const selfRow = el('label', 'owned-import-row owned-self-row');
  selfRow.append(el('span', 'field-label', 'このワールドでの自分'), selfSelect,
    el('small', 'muted owned-self-note', '理想個体の完成の判定と、自分の個体の絞り込みに使います（この端末だけ）'));
  selfRow.hidden = true;
  // 選択肢を作ったときのワールド（選んだらこのワールドに保存する）と、描いた内容の署名
  let selfWorld = '';
  let renderedSelf = '';
  // 選ばないときに自分になるプレイヤーがいるか（登録者の対応か同じ名前）
  let selfAuto = false;
  selfSelect.addEventListener('change', () => {
    if (!selfWorld || !context.self) return;
    if (!context.self.set(selfWorld, selfSelect.value) && context.self.saveFailed) toast('この端末に保存できませんでした（ページを閉じると消えます）', { kind: 'error' });
  });
  // 出すのは、ログイン中で、表示しているワールド（ホストでも参加者でも。参加者は共有から来たプレイヤー）にプレイヤーがいるときだけ
  function renderSelf() {
    const state = owned.state;
    const { env, userId, passcode } = context.store.state;
    const worldId = ownedWorldId(state.meta?.worldId);
    const players = state.owned?.players ?? [];
    const shown = Boolean(context.self && env && userId && passcode && worldId && players.length);
    selfRow.hidden = !shown;
    if (!shown) {
      selfWorld = '';
      renderedSelf = '';
      selfAuto = false;
      return;
    }
    selfWorld = worldId;
    const users = context.store.state.users ?? [];
    // 選ばないときに自分になるプレイヤー（登録者の対応か同じ名前。理想個体・所持パルと同じ決め方）
    const auto = ownPlayerUids(players, { userId, users, mapping: autoRegister && state.meta?.worldId ? autoRegister.mapping(state.meta.worldId) : {} });
    const label = playerLabels(players);
    const autoNames = players.filter((player) => auto.has(player.uid)).map(label);
    selfAuto = autoNames.length > 0;
    const saved = context.self.get(worldId);
    const value = players.some((player) => player.uid === saved) ? saved : '';
    const signature = JSON.stringify([worldId, players.map((player) => [player.uid, player.name]), saved, autoNames, users]);
    if (signature === renderedSelf) return;
    renderedSelf = signature;
    const choices = [['', selfAuto ? `自動（${autoNames.join('・')}）` : '未設定（自分の個体を判定しません）'],
      ...players.map((player) => [player.uid, label(player)])];
    // 選んでいる途中（フォーカス中）は作り直さず、離れてから作り直す（views/shared.js の syncOptions）
    syncOptions(selfSelect, choices, () => {
      if (selfSelect.value !== value) selfSelect.value = value;
    });
  }
  // このワールドでの自分が決まっていない（選んでいない〔選んだプレイヤーがいない〕・登録者の対応も同じ名前もない）
  const selfUnknown = () => {
    if (selfRow.hidden || selfAuto) return false;
    const saved = context.self.get(selfWorld);
    return !saved || !(owned.state.owned?.players ?? []).some((player) => player.uid === saved);
  };

  const cardTitle = el('h2', '', 'セーブ連携');
  card.append(cardTitle, stateRow, autoError, worldRow, status, selfRow, worldsHead, emptyNote, registered, dataRow);

  // ワールドの行は開閉でき、開くとそのワールドの自動登録の設定が出る。開いている行は描き直しても開いたまま。
  // 選んでいる途中に作り直さないよう、表示する内容が変わったときだけ描き直す
  const openWorlds = new Set();
  let renderedWorlds = '';
  // ワールドの行ごとの、設定の行き先（reveal）がフォーカスする部品（ワールドの ID → { details, toggle, registrants }）
  let worldParts = new Map();
  // 読み込み中（busy）に押せないボタン。行を作り直さずに disabled だけを書き換える（60 秒ごとの読み直しで開いている select を閉じない）
  let busyButtons = [];
  const setBusy = (busy) => {
    // 押して処理している途中のボタン（runButton が aria-busy を付ける）は、押せないままにする
    for (const [node, extra] of busyButtons) node.disabled = busy || extra() || node.getAttribute('aria-busy') === 'true';
  };
  function renderRegistered(state) {
    const env = context.store.state.env;
    const users = env ? context.store.state.users ?? [] : [];
    const players = state.role === 'host' ? state.local?.snapshot?.players ?? [] : [];
    const sharedAt = new Map((state.shared.worlds ?? []).map((world) => [world.worldId, world.uploadedAt ?? '']));
    const views = state.auto.worlds.map((world) => ({
      label: registeredLabel(world),
      enabled: autoRegister ? autoRegister.enabled(world.id) : false,
      mapping: autoRegister && env ? autoRegister.mapping(world.id) : {},
      // 登録者を選べるのは、いま読み込んでいるワールドだけ（ほかのワールドのプレイヤーは分からない）
      players: env && players.length && state.local?.world.id === world.id ? players : null,
      // 所持パルがあるか（この PC で読み込んだ、または共有されている）と、共有した時刻
      hasOwned: state.local?.world.id === world.id || sharedAt.has(world.id),
      sharedAt: sharedAt.get(world.id) ?? '',
    }));
    // 署名に busy は入れない（読み込みのたびに一覧を 2 回作り直していた）。busy はボタンの disabled だけで表す
    const signature = JSON.stringify([state.auto.worlds.map((w) => [w.id, w.kind]), views, users, Boolean(autoRegister)]);
    if (signature !== renderedWorlds) {
      renderedWorlds = signature;
      busyButtons = [];
      worldParts = new Map();
      registered.replaceChildren();
      state.auto.worlds.forEach((world, index) => {
        const item = el('li', 'owned-registered-item');
        // 行の中のボタンを押しても開閉しないようにする
        const edit = button('編集', (event) => { event?.preventDefault?.(); openWorldDialog(context, { world, win }); }, 'button quiet');
        const remove = button('削除', async (event) => {
          event?.preventDefault?.();
          if (!await confirmDialog('このワールドの登録を削除しますか？', 'このブラウザに登録したファイルの記録を消します。セーブと、共有された所持パルは変わりません。', { confirmText: '削除', danger: true })) return;
          await runButton(remove, async () => { await owned.removeWorld(world.id); toast('登録を削除しました'); }, (error) => toast(error.message, { kind: 'error' }));
        }, 'button quiet danger-text');
        busyButtons.push([edit, () => false], [remove, () => false]);
        const actions = el('span', 'owned-registered-actions');
        actions.append(edit, remove);
        const summary = el('summary', 'owned-world-summary');
        // 閉じたままでも、開くと何があるか（配合の自動登録の設定と、いまの状態）が分かるようにする
        const parts = [el('span', 'owned-world-label', views[index].label)];
        // 状態の印（状態のチップ。オンは ready、オフ・対象外は neutral）
        const stateChip = statusChip('', 'neutral', 'owned-world-state');
        const showState = (on) => {
          setChipTone(stateChip, on ? 'ready' : 'neutral');
          stateChip.textContent = world.kind === 'guest' ? '配合の自動登録: 対象外' : `配合の自動登録: ${on ? 'オン' : 'オフ'}`;
        };
        showState(world.kind !== 'guest' && views[index].enabled);
        if (autoRegister) parts.push(stateChip);
        summary.append(...parts, actions);
        const details = el('details', 'owned-world-details');
        details.open = openWorlds.has(world.id);
        details.addEventListener('toggle', () => { if (details.open) openWorlds.add(world.id); else openWorlds.delete(world.id); });
        details.append(summary);
        const targets = { details, toggle: null, registrants: [] };
        worldParts.set(world.id, targets);
        if (autoRegister) details.append(breedingPanel(world, views[index], users, showState, targets));
        details.append(ownedPanel(world, views[index]));
        item.append(details);
        registered.append(item);
      });
    }
    setBusy(state.busy);
    registered.hidden = !state.auto.worlds.length;
    emptyNote.hidden = state.auto.worlds.length > 0;
  }

  // 登録したワールドがあれば、自動で読み込むワールドを選ぶ。なければ、共有されたワールドから表示するものを選ぶ
  // 選択肢（id と表示名）の並びが変わったときだけ作り直す。それ以外は value と disabled だけ（開いている select を閉じない）
  function renderWorldSelect(state) {
    const registeredWorlds = state.auto.enabled ? state.auto.worlds : [];
    worldMode = registeredWorlds.length ? 'auto' : 'view';
    let choices;
    let value;
    if (worldMode === 'auto') {
      const latest = registeredWorlds.find((world) => world.playedAt);
      choices = [['', `自動（いま遊んでいるワールド${latest ? `: ${shortName(latest)}` : ''}）`], ...registeredWorlds.map((world) => [world.id, shortName(world)])];
      value = registeredWorlds.some((world) => world.id === state.auto.worldId) ? state.auto.worldId : '';
    } else {
      const shared = state.shared.worlds ?? [];
      choices = [['', '自動（いちばん新しく共有されたワールド）'], ...shared.map((world) => [world.worldId, `${worldName(world)} · ${world.palCount} 体`])];
      value = shared.some((world) => world.worldId === state.viewWorldId) ? state.viewWorldId : '';
    }
    syncOptions(worldSelect, choices, () => {
      if (worldSelect.value !== value) worldSelect.value = value;
    });
    worldSelect.disabled = state.busy;
    worldRow.hidden = choices.length < 2;
  }

  function render(state) {
    const hasWorlds = state.auto.worlds.length > 0;
    const needsPermission = state.auto.enabled && state.auto.status === 'permission';
    autoState.textContent = state.auto.enabled ? AUTO_STATES[state.auto.status] ?? '' : '';
    setChipTone(autoState, AUTO_TONES[state.auto.status] ?? 'neutral');
    // 確かめている途中もエラーは残り（owned.js）、エラーがないときも見えないまま 1 行分の場所を残す（点滅しない・下が上下しない）。
    // 登録したワールドがなければ、エラーがあるときだけ出す
    const errorText = state.auto.enabled ? state.auto.error : '';
    if (autoError.textContent !== errorText) autoError.textContent = errorText;
    autoError.classList.toggle('is-empty', !errorText);
    autoError.hidden = !hasWorlds && !errorText;
    autoNow.hidden = !hasWorlds;
    grant.hidden = !needsPermission;
    stateRow.hidden = !hasWorlds;
    autoNow.disabled = state.busy;
    renderWorldSelect(state);

    const items = [];
    if (state.role) items.push(['この PC', roleLabel(state)]);
    items.push(['表示中', state.meta ? `${worldName(state.meta)}${state.meta.source ? ` · ${state.owned?.pals.length ?? 0} 体` : '（データなし）'}` : 'なし']);
    const lines = timeLines(state);
    if (lines.length) items.push(['更新', lines.join(' · ')]);
    status.replaceChildren();
    for (const [term, detail] of items) status.append(el('dt', '', term), el('dd', '', detail));

    renderRegistered(state);
    renderSelf();
    add.disabled = state.busy;
    csvButton.disabled = !state.owned;
    dataRow.hidden = hasWorlds;
    // 読み込む前に来た設定の行き先は、読み込んだ後に行う
    if (pendingReveal && state.ready) {
      const next = pendingReveal;
      pendingReveal = null;
      reveal(next);
    }
  }

  // ---- 設定の行き先（`#/settings?world=<ID>&open=auto`。router.js の settingsHash） ----
  // そのワールドの行を開き、設定することにフォーカスする。所持パルの状態を読み込む前なら、読み込んだ後に行う
  let pendingReveal = null;
  let destroyed = false;
  function reveal({ worldId = '' } = {}) {
    if (destroyed) return;
    if (!owned.state.ready) { pendingReveal = { worldId }; return; }
    pendingReveal = null;
    const id = ownedWorldId(worldId);
    const world = id ? owned.state.auto.worlds.find((item) => ownedWorldId(item.id) === id) : null;
    if (world) {
      openWorlds.add(world.id);
      renderedWorlds = '';
      renderRegistered(owned.state);
    }
    renderSelf();
    const move = () => {
      if (destroyed) return;
      const target = revealTarget(id, world);
      target.scrollIntoView?.({ block: 'center' });
      target.focus({ preventScroll: true });
    };
    if (card.isConnected === false) afterAttach(move);
    else move();
  }
  // フォーカスの先（上から順に最初に当てはまるもの）: ① 表示しているワールドがそのワールド（ワールドの指定がなければ表示しているワールド）で、
  // 自分が決まっていない → このワールドでの自分。② 開いたワールドの行の、未設定の登録者の選択。③ その行の自動登録のチェック。
  // ④ このワールドでの自分（出ていれば）。⑤ カードの見出し
  function revealTarget(id, world) {
    if (selfUnknown() && (!id || selfWorld === id)) return selfSelect;
    const parts = world ? worldParts.get(world.id) : null;
    const registrant = parts?.registrants.find((item) => item.unmapped());
    if (registrant) return registrant.select;
    if (parts?.toggle) return parts.toggle;
    if (!selfRow.hidden) return selfSelect;
    cardTitle.tabIndex = -1;
    return cardTitle;
  }

  const unsubscribe = owned.subscribe(render);
  // ユーザーの一覧・対応表は名前の変更でも変わる（表示が同じなら描き直さない）。ログイン・ログアウトで自分の行を出し入れする
  const unsubscribeStore = context.store.subscribe(() => {
    renderRegistered(owned.state);
    renderSelf();
  });
  // 別のタブでこのワールドでの自分を変えたとき
  const unsubscribeSelf = context.self?.subscribe(renderSelf) ?? (() => {});
  render(owned.state);
  owned.load().catch(() => {});
  return {
    element: card, reveal,
    destroy() { destroyed = true; unsubscribe(); unsubscribeStore(); unsubscribeSelf(); },
  };
}
