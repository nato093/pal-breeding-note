// 設定の「セーブ連携」。登録したワールド（モーダルで登録・編集・削除）、使うワールドの切り替え、
// 表示しているワールドでの自分、配合牧場からの自動登録（ワールドごと）、共有の削除を扱う。所持パルの CSV は設定の「書き出し」カード（settings）。
import { el, button, link, runButton, statusChip, setChipTone, setDisabled, downloadBlob, dateStamp } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { dateTime, worldName, roleLabel, permissionNotice, grantWithReport, HOST_SUMMARY, guestAutoText } from '../ui/owned-status.js';
import { palIcon, palsById } from '../ui/pal-icon.js';
import { buildHash } from '../router.js';
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

// ワールドの行の表記「「テスト」（ホスト Alice）· 10/10 09:00 に遊んだ」（C-43。前の「ホスト」とファイル数はなくした。参加は行のチップ）。
// 読めない状態（許可が必要など）は後ろに
function registeredLabel(world) {
  const parts = [shortName(world)];
  if (world.playedAt) parts.push(`${dateTime(world.playedAt)} に遊んだ`);
  if (WORLD_STATES[world.status]) parts.push(WORLD_STATES[world.status]);
  return parts.join(' · ');
}

/** 所持パルの CSV を保存する（BOM つき。設定の「書き出し」カード） */
export function downloadOwnedCsv(owned, importedAt) {
  const csv = rowsToCsv(ownedRows(owned, { importedAt }));
  downloadBlob(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }), `owned-pals-${dateStamp()}.csv`);
}

// 登録モーダルのチェックリストに添える、① に貼ったパスから作った実際のパス（長い ID は頭 4 字に縮める。F082）。パスがまだなければ
// <Steam ID>・<ワールド ID> の書き方（どちらでも 1 行を取り、パスを貼ってもリストの高さが変わらない＝ダイアログが上下しない）
const shortId = (id) => (id.length > 6 ? `${id.slice(0, 4)}…` : id);
function actualPath(draft, path) {
  const steam = draft?.worldId ? shortId(draft.steamId ?? '') : '<Steam ID>';
  const world = draft?.worldId ? shortId(draft.worldId) : '<ワールド ID>';
  if (path === '../GlobalPalStorage.sav') return `…\\SaveGames\\${steam}\\GlobalPalStorage.sav`;
  return `…\\SaveGames\\${steam}\\${world}\\${path.replace(/\//g, '\\')}`;
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
  // 開いている間は、ダイアログの外にファイルを落としてもブラウザが開かないよう window の dragover・drop を止める（閉じたら外す。C-26）
  const dropGuard = new AbortController();
  // 背景のクリックでは閉じない（パスを貼ってファイルを落とす途中で、外を押して消えないように。C-26）
  const modal = openDialog(world ? 'ワールドを編集' : 'ワールドを登録', { className: 'world-dialog', closeOnBackdrop: false, onClose: () => dropGuard.abort() });
  const supported = handleDropSupported(win);
  const stop = (event) => event.preventDefault();
  win.addEventListener?.('dragover', stop, { signal: dropGuard.signal });
  win.addEventListener?.('drop', stop, { signal: dropGuard.signal });

  let draft = null;
  let previewed = null;
  let checking = 0;
  // 保存の途中は、ドロップ・パスの変更・もう一度の保存を受け付けない（二重に登録しない）
  let saving = false;
  const pathInput = el('input', 'owned-path');
  pathInput.type = 'text';
  pathInput.placeholder = `${SAVE_ROOT}\\<Steam ID>\\<ワールド ID>`;
  pathInput.setAttribute('aria-label', 'ワールドのフォルダのパス');
  // 貼ったパスの判定（読み取れた ID・形が違う・登録済み）。空欄のときも 1 行分の高さを保つ（C-24）
  const pathStatus = el('p', 'owned-path-status');
  pathStatus.setAttribute('aria-live', 'polite');
  // エクスプローラーで開く場所と［コピー］（クリップボードには定数だけを書く。C-23）
  const copy = button('コピー', () => {
    const writing = win.navigator?.clipboard?.writeText?.(SAVE_ROOT);
    Promise.resolve(writing).then(() => {
      if (!writing) throw new Error('unsupported');
      toast('コピーしました');
    }).catch(() => toast('コピーできませんでした', { kind: 'error' }));
  }, 'button quiet small');
  copy.setAttribute('aria-label', 'セーブのフォルダの場所をコピー');
  const pathHint = el('p', 'owned-help muted owned-path-hint');
  pathHint.append(el('span', '', `エクスプローラーのアドレス欄に ${SAVE_ROOT} を貼ると開けます`), copy);
  const pathField = el('div', 'owned-step');
  pathField.append(el('span', 'field-label', '① ワールドのフォルダのパス'), pathHint, pathInput, pathStatus);
  const onDrop = (event) => {
    // ハンドルは drop イベントの中で受け取る必要がある
    const pending = handlesFromDrop(event.dataTransfer);
    addDropped(pending, draft).catch((error) => toast(error.message, { kind: 'error' }));
  };
  const fileDrop = dropZone('ここにファイルをドロップ（ダイアログのどこに落としても受け取ります。何回かに分けても足せます）', onDrop);
  // ダイアログ全体をドロップ先にする（枠は目印。枠に落とした分は枠が受け取るので、ここでは数えない）
  modal.dialog.addEventListener('dragover', stop);
  modal.dialog.addEventListener('drop', (event) => {
    event.preventDefault();
    if (fileDrop.contains(event.target)) return;
    onDrop(event);
  });
  const draftList = el('ul', 'owned-draft');
  const dropField = el('div', 'owned-step');
  dropField.append(el('span', 'field-label', '② ファイルをドロップ'), fileDrop, draftList);
  // 結果欄は 2 行分の高さを保つ（文の長さで下の部品が上下しない。長い文は 2 行で切り、全文は title。F082）
  const result = el('p', 'owned-dialog-result');
  result.setAttribute('aria-live', 'polite');
  const showResult = (text, state = '') => {
    result.textContent = text;
    result.title = text;
    result.className = `owned-dialog-result${state ? ` ${state}` : ''}`;
  };
  // 新しく登録するときは、確定で何が始まるかを添え、名前も「登録して連携」にする（編集は「保存」のまま。C-29）
  const save = button(world ? '保存' : '登録して連携', async () => {
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

  // ドロップするファイル。2 つの組に分ける: 全員（LocalData.sav）と、ホストの PC だけ（Level.sav・LevelMeta.sav・Players\ ・GlobalPalStorage.sav）。
  // LocalData.sav だけで参加と判定したら、ホストの組を薄くして「参加として登録できます」（C-27・C-28）
  function renderDraft() {
    draftList.replaceChildren();
    fileDrop.classList.toggle('disabled', !draft || saving);
    pathInput.disabled = saving;
    const known = draft ? owned.state.auto.worlds.find((item) => item.id === draft.worldId) : null;
    const paths = draft ? [...new Set([...(known?.files ?? []), ...draft.files.keys()])] : [];
    const has = (path) => paths.includes(path);
    // 各行に、① に貼ったパスから作った実際のパスを薄い字で添える（パスがまだなければ書き方だけ）
    const item = (list, label, done, path = '') => {
      const node = el('li', done ? 'done' : '', `${done ? '✓' : '—'} ${label}`);
      const actual = path ? actualPath(draft, path) : '';
      if (actual) node.append(el('small', 'owned-draft-path', actual));
      list.append(node);
    };
    const group = (title, className = '') => {
      const node = el('li', `owned-draft-group${className ? ` ${className}` : ''}`);
      const list = el('ul', 'owned-draft-items');
      node.append(el('span', 'owned-draft-title', title), list);
      draftList.append(node);
      return { node, list };
    };
    const everyone = group('全員');
    item(everyone.list, 'LocalData.sav', has('LocalData.sav'), 'LocalData.sav');
    const guestOnly = Boolean(previewed && previewed.kind !== 'host');
    const host = group(guestOnly ? 'ホストの PC だけ（参加として登録できます）' : 'ホストの PC だけ', guestOnly ? 'is-dim' : '');
    for (const path of REQUIRED_FILES.host.filter((file) => file !== 'LocalData.sav')) item(host.list, path, has(path), path);
    const players = paths.filter((path) => path.startsWith('Players/')).length;
    item(host.list, `Players\\ の中のファイル全部${players ? `（${players} 件）` : ''}`, players > 0, 'Players/');
    item(host.list, '..\\GlobalPalStorage.sav（任意）', has('../GlobalPalStorage.sav'), '../GlobalPalStorage.sav');
    save.disabled = saving || !previewed;
    renderPathStatus();
  }
  // 貼ったパスの判定の 1 行（文字は textContent）
  function renderPathStatus() {
    const known = draft ? owned.state.auto.worlds.find((item) => item.id === draft.worldId) : null;
    const value = pathInput.value.trim();
    const shortSteam = (id) => (id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);
    const [text, state] = !value ? ['', '']
      : draft ? [`✓ Steam ${shortSteam(draft.steamId)} ／ ワールド ${draft.worldId.slice(0, 4)}…${known ? '（登録済みのワールドです。ファイルを足します）' : ''}`, 'ok']
        : ['…\\SaveGames\\<数字>\\<32 桁の英数字> まで含めて貼ってください', 'todo'];
    if (pathStatus.textContent !== text) pathStatus.textContent = text;
    pathStatus.className = `owned-path-status${state ? ` ${state}` : ''}`;
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
    if (!draft?.files.size && !steamChanged) { showResult(''); return; }
    showResult('読み込んで確かめています…');
    try {
      const checked = await owned.previewRegistration({ worldId: draft.worldId, steamId: draft.steamId, files: [...draft.files.values()] });
      if (ticket !== checking) return;
      previewed = checked;
      showResult(previewText(checked), 'ok');
    } catch (error) {
      if (ticket !== checking) return;
      showResult(error.message, 'todo');
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
  pathInput.addEventListener('input', () => {
    setTarget(parseWorldPath(pathInput.value));
    // 読み取れないパスのままの書き換え（同じ null のまま）でも判定の文を合わせる
    renderPathStatus();
  });
  // 編集: 登録したワールドのパスを入れておく（足したいファイルをドロップするだけでよい）
  if (world) {
    pathInput.value = world.steamId ? `${SAVE_ROOT}\\${world.steamId}\\${world.id}` : '';
    draft = { worldId: world.id, steamId: world.steamId ?? '', folder: pathInput.value, files: new Map() };
  }

  if (supported) modal.body.append(pathField, dropField, result);
  else modal.body.append(el('p', 'owned-help muted', 'ファイルの登録は Chrome・Edge で使えます。Chrome か Edge で開いてください。'));
  if (supported && !world) modal.footer.append(el('p', 'owned-dialog-note', '登録すると、読み込み・所持パルの共有・配合の自動登録（ホストのとき）を始めます'));
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
  // この PC の役割（ホスト・参加）の短いチップ（前は状態の dl の「この PC」の括弧書き。C-36）
  const roleChip = statusChip('', 'neutral', 'owned-role-chip');
  const autoNow = button('今すぐ読み込む', () => runButton(autoNow, () => owned.refreshAuto({ enable: true }), (error) => toast(error.message, { kind: 'error' })), 'button secondary');
  // 許可はクリックの中で（await を挟まずに）求める。許可されなかったときのトーストは grantWithReport（3 か所で同じ）
  const grant = button('読み込みを許可', () => runButton(grant, () => grantWithReport(owned), () => {}), 'button primary');
  const stateRow = el('div', 'owned-import-row');
  stateRow.append(roleChip, autoState, grant, autoNow);
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

  // ---- 登録したワールド ----
  const registered = el('ul', 'owned-registered');
  const add = button('＋ ワールドを登録', () => openWorldDialog(context, { win }), 'button primary');
  const worldsHead = el('div', 'owned-worlds-head');
  worldsHead.append(el('h3', '', '登録したワールド'), add);
  const emptyNote = el('p', 'owned-help muted', 'まだ登録していません。「＋ ワールドを登録」から、ワールドのセーブのファイルを登録してください。');

  // ---- 配合牧場からの自動登録（ワールドの行を開いたところで、そのワールドについて設定する。プレイヤーの対応は独立した欄。roles） ----
  // onToggle: オン・オフを切り替えたとき（行の「配合の自動登録: オン」をすぐ書き換える）。
  // parts: 設定の行き先（reveal）がフォーカスする部品（自動登録のチェック）を入れる
  function breedingPanel(world, view, onToggle, parts) {
    const panel = el('div', 'owned-breeding');
    panel.append(el('p', 'owned-step-title', '配合牧場からの自動登録'));
    if (world.kind === 'guest') {
      // 参加者に「自動登録は動きません」と言わない（ホストの画面が登録する。X-06）
      panel.append(el('p', 'owned-help muted owned-role-note', guestAutoText()));
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
    // ホストの 1 行（ページを閉じている間は止まること。roles）
    panel.append(label, el('p', 'owned-help muted owned-role-note', HOST_SUMMARY));
    parts.toggle = toggle;
    return panel;
  }

  // ---- プレイヤーの対応（セーブのプレイヤー → ノートの名前。roles で、ワールドの行の中から「使うワールド」の下の独立した欄にした。C-03・C-04）。
  // 選べるのは、この PC がホストで、読み込んでいるワールドのプレイヤーが分かるときだけ（自動登録はホストの PC でしか動かないので、参加者が
  // 選んでも登録には効かない）。参加者には、ホストの PC で設定することと「このワールドでの自分」を案内する。登録待ち（autoreg-visibility）もこの欄の上
  const playersSection = el('section', 'owned-players');
  playersSection.hidden = true;
  // 設定の行き先（reveal の registrant・auto）がフォーカスする未設定の選択（読み込んでいるワールドの分）
  let playerParts = { worldId: '', registrants: [] };
  let renderedPlayers = null;
  function playersView(state) {
    const env = context.store.state.env;
    const users = env ? context.store.state.users ?? [] : [];
    const worldId = state.local?.world.id ?? '';
    const players = env && state.role === 'host' && worldId ? state.local?.snapshot?.players ?? [] : [];
    const mapping = autoRegister && env && worldId ? autoRegister.mapping(worldId) : {};
    return { role: state.role, worldId, players, users, mapping, signature: JSON.stringify([state.role, worldId, players.map((player) => [player.uid, player.name]), users, mapping, Boolean(autoRegister)]) };
  }
  function renderPlayers(state) {
    const view = playersView(state);
    if (view.signature === renderedPlayers) return;
    renderedPlayers = view.signature;
    playerParts = { worldId: view.worldId, registrants: [] };
    pendingBoxes = new Map();
    pendingShown.clear();
    const shown = Boolean(autoRegister) && (view.role === 'host' || view.role === 'guest');
    playersSection.hidden = !shown;
    if (!shown) { playersSection.replaceChildren(); return; }
    const nodes = [el('h3', '', 'プレイヤーの対応（セーブのプレイヤー → ノートの名前）')];
    if (view.role === 'guest') {
      nodes.push(el('p', 'owned-help muted', 'プレイヤーの対応はホストの PC で設定します。自分の個体は「このワールドでの自分」で選べます。'));
      playersSection.replaceChildren(...nodes);
      return;
    }
    nodes.push(el('p', 'owned-help muted', '配合の自動登録の登録者と、理想個体の「自分の個体」に使います。'));
    // 登録されずに残っている候補（中身は renderPending が書く）
    const pendingBox = el('div', 'owned-pending');
    pendingBox.hidden = true;
    if (view.worldId) pendingBoxes.set(view.worldId, pendingBox);
    nodes.push(pendingBox);
    if (!view.players.length) {
      nodes.push(el('p', 'owned-help muted', 'このワールドを読み込むと、プレイヤーの対応を選べます。'));
      playersSection.replaceChildren(...nodes);
      return;
    }
    // プレイヤーの名前は「このワールドでの自分」・所持者の選択肢と同じ（名前がない・同じ名前が 2 人以上なら UID の頭 8 字を添える）
    const nameOf = playerLabels(view.players);
    const list = el('div', 'owned-breeding-players');
    for (const player of view.players) {
      const select = el('select');
      select.setAttribute('aria-label', `${nameOf(player)}のノートの名前`);
      const sameName = mappedUser(player, { users: view.users });
      select.append(option('', sameName ? `${sameName}（同じ名前）` : '未設定（登録しない）'));
      for (const user of view.users) select.append(option(user, user));
      select.value = view.users.includes(view.mapping[player.uid]) ? view.mapping[player.uid] : '';
      select.addEventListener('change', () => {
        autoRegister.setMapping(player.uid, select.value, view.worldId);
        // 選択はもう新しい対応になっているので、この変更では欄を作り直さない（作り直すと、選んだ select からフォーカスが外れる）
        renderedPlayers = playersView(owned.state).signature;
        // 対応表は自分のプレイヤーの決め方にも使う（このワールドでの自分を選んでいないとき）。本人の変化として知らせる（app.js が同じセーブの
        // まま判定し直し、理想個体・所持パル・この画面の自分の自動の名前が描き直る。別のタブで変えたときも同じ経路。app.js の storage イベント）
        if (context.self?.changed) context.self.changed();
        else context.ideals?.identityChanged?.();
      });
      // 未設定（対応も同じ名前のユーザーもない）＝自動登録で「プレイヤーの対応が未設定です」になる
      playerParts.registrants.push({ select, unmapped: () => select.value === '' && !sameName });
      const row = el('label', 'owned-breeding-player');
      row.append(el('span', '', nameOf(player)), select);
      list.append(row);
    }
    nodes.push(list);
    playersSection.replaceChildren(...nodes);
  }

  // ---- 登録待ち（autoreg-visibility。D-08）: 登録されずに残っている候補を、件数と親だけで出す（候補の子は配合表で決めた値なので
  // 出さない。INV-2。auto-register.js の pendingSummary が子を返さない）。「登録済みと違う」の行は親 2 体の絵・「登録を開く」・「破棄」だけ。
  // 登録者未設定の行は数だけ（すぐ下の登録者の選択で片づく）
  let pendingBoxes = new Map();
  const pendingShown = new Map();
  function renderPending() {
    for (const [worldId, box] of pendingBoxes) {
      const summary = autoRegister?.pendingSummary?.(worldId) ?? { unmapped: [], conflict: [] };
      const key = JSON.stringify(summary);
      if (pendingShown.get(worldId) === key) continue;
      pendingShown.set(worldId, key);
      const total = summary.unmapped.length + summary.conflict.length;
      box.hidden = !total;
      if (!total) { box.replaceChildren(); continue; }
      const kinds = [summary.unmapped.length ? `登録者未設定 ${summary.unmapped.length}` : '', summary.conflict.length ? `登録済みと違う ${summary.conflict.length}` : ''].filter(Boolean);
      const nodes = [el('p', 'owned-pending-head', `登録待ち ${total} 件（${kinds.join('・')}）`)];
      if (summary.conflict.length) {
        const list = el('ul', 'owned-pending-list');
        for (const item of summary.conflict) {
          const [a, b] = item.parents;
          const pair = el('span', 'owned-pending-pair');
          const name = (id) => palsById.get(id)?.ja ?? id;
          pair.setAttribute('role', 'img');
          pair.setAttribute('aria-label', `${name(a)}＋${name(b)}`);
          pair.title = `${name(a)}＋${name(b)}`;
          pair.append(palIcon(palsById.get(a)), el('span', 'owned-pending-plus', '＋'), palIcon(palsById.get(b)));
          const discard = button('破棄', async () => {
            if (!await confirmDialog('この登録待ちを破棄しますか？', `${name(a)}＋${name(b)} のタマゴの配合を、自動登録しません。登録済みの配合は変わりません。`, { confirmText: '破棄', danger: true })) return;
            autoRegister.discardPending(item.id, worldId);
          }, 'button quiet small danger-text');
          const row = el('li', 'owned-pending-item');
          row.append(pair, link('登録を開く', buildHash('search', { p1: a, p2: b }), 'button quiet small'), discard);
          list.append(row);
        }
        nodes.push(list);
      }
      box.replaceChildren(...nodes);
    }
  }

  // ---- 共有した所持パル（ワールドの行を開いたところで。この PC がホストとして共有したワールドだけ。CSV は「書き出し」カードへ移した） ----
  function ownedPanel(world, view) {
    const panel = el('div', 'owned-world-pals');
    panel.append(el('p', 'owned-step-title', '所持パル'));
    const row = el('div', 'owned-import-row');
    if (view.sharedAt && world.kind !== 'guest') {
      const remove = button('共有した所持パルを削除', async () => {
        if (!await confirmDialog('共有した所持パルを削除しますか？', 'スプレッドシートから、このワールドの所持パルを消します。仲間の画面にも表示されなくなります。セーブは変わりません。', { confirmText: '削除', danger: true })) return;
        await runButton(remove, async () => { await owned.deleteShared(world.id); toast('共有した所持パルを削除しました'); }, (error) => toast(error.message, { kind: 'error' }));
      }, 'button quiet danger-text');
      busyButtons.push([remove, () => false]);
      row.append(remove);
    }
    panel.append(row);
    return panel;
  }

  // ---- このワールドでの自分（表示しているワールドのプレイヤーから 1 人。理想個体の完成の判定と自分の個体の絞り込みに使う。この端末だけ） ----
  // 状態の欄（status）は描くたびに作り直すので、その外に作り直さない行として置く。選択肢は表示する内容が変わったときだけ作り直す
  const selfSelect = el('select', 'owned-self');
  selfSelect.setAttribute('aria-label', 'このワールドでの自分');
  // 説明は選択の説明として読み上げる（設定の画面は 1 つだけなので、ID は固定でよい）
  const selfNote = el('small', 'muted owned-self-note', '理想個体の完成の判定と、自分の個体の絞り込みに使います（この端末だけ）');
  selfNote.id = 'owned-self-note';
  selfSelect.setAttribute('aria-describedby', selfNote.id);
  const selfRow = el('label', 'owned-import-row owned-self-row');
  selfRow.append(el('span', 'field-label', 'このワールドでの自分'), selfSelect, selfNote);
  selfRow.hidden = true;
  // 表示しているワールド（選んだらこのワールドに保存する）・選択肢を作ったときのワールド（選んでいる途中は作り直さないので、表示する
  // ワールドが替わった直後は前のワールドの選択肢のことがある）と、描いた内容の署名
  let selfWorld = '';
  let optionsWorld = '';
  let renderedSelf = '';
  // 選ばないときに自分になるプレイヤーがいるか（登録者の対応か同じ名前）
  let selfAuto = false;
  selfSelect.addEventListener('change', () => {
    if (!context.self) return;
    // ID の変更中（押せなくしてある）・選択肢がまだ前のワールドのものなら、保存せずに今のワールドの選択肢に作り直す
    //（前のワールドのプレイヤーを、今のワールドのキーに保存しない）
    if (context.store.state.renaming || !selfWorld || optionsWorld !== selfWorld) {
      renderedSelf = '';
      renderSelf();
      return;
    }
    if (!context.self.set(selfWorld, selfSelect.value) && context.self.saveFailed) toast('この端末に保存できませんでした（ページを閉じると消えます）', { kind: 'error' });
  });
  // 出すのは、ログイン中で、表示しているワールド（ホストでも参加者でも。参加者は共有から来たプレイヤー）にプレイヤーがいるときだけ
  function renderSelf() {
    const state = owned.state;
    const { env, userId, passcode, renaming } = context.store.state;
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
    // ID の変更中は選べない（途中で選ぶと、移し終えた前の ID のキーに書いて失われることがあり、完成の判定もし直せない。
    // 変更中に別のタブで変わった分は、変更が終わってから判定し直す。app.js）
    setDisabled(selfSelect, renaming, 'ID の変更が終わってから選んでください');
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
      optionsWorld = worldId;
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
  card.append(cardTitle, stateRow, autoError, worldRow, playersSection, selfRow, worldsHead, emptyNote, registered);

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
  // 行に描く内容と、その署名（署名に busy は入れない。読み込みのたびに一覧を 2 回作り直していた。busy はボタンの disabled だけで表す）
  function registeredViews(state) {
    const sharedAt = new Map((state.shared.worlds ?? []).map((world) => [world.worldId, world.uploadedAt ?? '']));
    const views = state.auto.worlds.map((world) => ({
      label: registeredLabel(world),
      enabled: autoRegister ? autoRegister.enabled(world.id) : false,
      // 共有した時刻（共有した所持パルの削除を出すか）
      sharedAt: sharedAt.get(world.id) ?? '',
    }));
    // 参加のチップは kind と role で決まる
    return { views, signature: JSON.stringify([state.auto.worlds.map((w) => [w.id, w.kind, w.role]), views, Boolean(autoRegister)]) };
  }
  function renderRegistered(state) {
    const { views, signature } = registeredViews(state);
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
        // 編集・削除は summary の外（行の右端）に置く（summary の中にボタンを入れない。読み上げで開閉の部品と混ざるため。C-44）
        const actions = el('div', 'owned-registered-actions');
        actions.append(edit, remove);
        const summary = el('summary', 'owned-world-summary');
        // 閉じたままでも、開くと何があるか（配合の自動登録の設定と、いまの状態）が分かるようにする
        const parts = [el('span', 'owned-world-label', views[index].label)];
        if (world.kind === 'guest' || world.role === 'guest') parts.push(statusChip('参加', 'info', 'owned-world-role'));
        // 状態の印（状態のチップ。オンは ready、オフ・対象外は neutral）
        const stateChip = statusChip('', 'neutral', 'owned-world-state');
        const showState = (on) => {
          setChipTone(stateChip, on ? 'ready' : 'neutral');
          stateChip.textContent = world.kind === 'guest' ? '配合の自動登録: 対象外' : `配合の自動登録: ${on ? 'オン' : 'オフ'}`;
        };
        showState(world.kind !== 'guest' && views[index].enabled);
        if (autoRegister) parts.push(stateChip);
        summary.append(...parts);
        const details = el('details', 'owned-world-details');
        details.open = openWorlds.has(world.id);
        details.addEventListener('toggle', () => { if (details.open) openWorlds.add(world.id); else openWorlds.delete(world.id); });
        details.append(summary);
        const targets = { details, toggle: null };
        worldParts.set(world.id, targets);
        if (autoRegister) details.append(breedingPanel(world, views[index], showState, targets));
        // 共有した所持パルの削除があるときだけ「所持パル」の欄を出す
        if (views[index].sharedAt && world.kind !== 'guest') details.append(ownedPanel(world, views[index]));
        item.append(details, actions);
        registered.append(item);
      });
    }
    setBusy(state.busy);
    renderPlayers(state);
    renderPending();
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
    // 登録したワールドがなければ、エラーがあるときだけ出す。許可切れは状態の行（「許可が必要」と「読み込みを許可」）が文の代わりで、
    // この行には止まった時刻と「毎回のアクセスを許可」の勧めを出す（permissionNotice。ヘッダー・所持パルと同じ文。C-31）
    const permission = permissionNotice(state);
    const errorText = permission ? [permission.since, permission.hint].filter(Boolean).map((text) => `${text}。`).join('') : state.auto.enabled ? state.auto.error : '';
    if (autoError.textContent !== errorText) autoError.textContent = errorText;
    autoError.classList.toggle('is-empty', !errorText);
    autoError.classList.toggle('is-hint', Boolean(permission));
    autoError.hidden = !hasWorlds && !errorText;
    autoNow.hidden = !hasWorlds;
    grant.hidden = !needsPermission;
    stateRow.hidden = !hasWorlds;
    autoNow.disabled = state.busy;
    renderWorldSelect(state);

    // この PC の役割（表示中のワールド・更新の時刻はヘッダーのセーブ連携と所持パルで見られるので出さない。C-36）
    const role = state.role === 'host' ? 'ホスト' : state.role === 'guest' ? '参加' : '';
    if (roleChip.textContent !== role) roleChip.textContent = role;
    setChipTone(roleChip, role === 'ホスト' ? 'ready' : role ? 'info' : 'neutral');
    roleChip.hidden = !role;
    roleChip.title = role ? roleLabel(state) : '';

    renderRegistered(state);
    renderSelf();
    add.disabled = state.busy;
    // 読み込む前に来た設定の行き先は、読み込んだ後に行う
    if (pendingReveal && state.ready) {
      const next = pendingReveal;
      pendingReveal = null;
      reveal(next);
    }
  }

  // ---- 設定の行き先（`#/settings?world=<ID>&open=<意図>`。router.js の settingsHash・SETTINGS_OPEN） ----
  // 意図の所へフォーカスする（登録者の意図と前の版の auto は、そのワールドの行を開く）。所持パルの状態を読み込む前なら、読み込んだ後に行う
  let pendingReveal = null;
  let destroyed = false;
  function reveal({ worldId = '', open = 'auto' } = {}) {
    if (destroyed) return;
    if (!owned.state.ready) { pendingReveal = { worldId, open }; return; }
    pendingReveal = null;
    const id = ownedWorldId(worldId);
    const world = id ? owned.state.auto.worlds.find((item) => ownedWorldId(item.id) === id) : null;
    if (world && (open === 'registrant' || open === 'auto')) openWorld(world);
    renderSelf();
    const move = () => {
      if (destroyed) return;
      const target = revealTarget(open, id, world);
      target.scrollIntoView?.({ block: 'center' });
      target.focus({ preventScroll: true });
    };
    if (card.isConnected === false) afterAttach(move);
    else move();
  }
  // 行がもうあれば開くだけにする（作り直すと、処理中のボタン〔runButton〕が押せるボタンに替わり、ほかの行の開いた選択も閉じる）。
  // まだ描いていなければ、開いた状態で描く
  function openWorld(world) {
    openWorlds.add(world.id);
    const parts = worldParts.get(world.id);
    if (parts) {
      parts.details.open = true;
      return;
    }
    renderedWorlds = '';
    renderRegistered(owned.state);
  }
  // フォーカスの先（意図ごとに、上から順に最初に当てはまるもの。隠れている・押せないものは飛ばす。どれもなければカードの見出し）
  // - self: このワールドでの自分
  // - registrant: 開いたワールドの行の、未設定の登録者の選択 → このワールドでの自分
  // - status: 状態の欄の操作（読み込みの許可 → 今すぐ読み込む。データがない・読めないときの行き先。自動登録のチェックのような、押すと
  //   設定が変わるものへは移らない）
  // - auto（前の版）: ① 表示しているワールドがそのワールド（ワールドの指定がなければ表示しているワールド）で、自分が決まっていない →
  //   このワールドでの自分。② 未設定の登録者。③ その行の自動登録のチェック。④ このワールドでの自分
  function revealTarget(open, id, world) {
    const parts = world ? worldParts.get(world.id) : null;
    // 未設定のプレイヤーの対応の選択（そのワールドを読み込んでいるときだけ。プレイヤーの対応の欄）
    const registrant = world && playerParts.worldId === world.id ? playerParts.registrants.find((item) => item.unmapped())?.select : null;
    const candidates = {
      self: [selfSelect],
      registrant: [registrant, selfSelect],
      status: stateRow.hidden ? [] : [grant, autoNow],
      auto: [selfUnknown() && (!id || selfWorld === id) ? selfSelect : null, registrant, parts?.toggle, selfSelect],
    }[open] ?? [];
    const usable = (node) => node && !node.hidden && !node.disabled && !(node === selfSelect && selfRow.hidden);
    const target = candidates.find(usable);
    if (target) return target;
    cardTitle.tabIndex = -1;
    return cardTitle;
  }

  const unsubscribe = owned.subscribe(render);
  // ユーザーの一覧・対応表は名前の変更でも変わる（表示が同じなら描き直さない）。ログイン・ログアウトで自分の行を出し入れする。
  // ID の変更の始まりと終わりで、このワールドでの自分を押せなくする・戻す
  const unsubscribeStore = context.store.subscribe(() => {
    renderRegistered(owned.state);
    renderSelf();
  });
  // 本人が変わったとき（このワールドでの自分・登録者の対応。別のタブの変更も）。対応表が変わったら登録者の選択も合わせる
  const unsubscribeSelf = context.self?.subscribe(() => {
    renderRegistered(owned.state);
    renderSelf();
  }) ?? (() => {});
  // 自動登録の候補が変わったら（読み込んで判定した・破棄した・対応や設定を変えた）、登録待ちの行だけ書き直す
  const unsubscribeAuto = autoRegister?.subscribe?.(renderPending) ?? (() => {});
  render(owned.state);
  owned.load().catch(() => {});
  return {
    element: card, reveal,
    destroy() { destroyed = true; unsubscribe(); unsubscribeStore(); unsubscribeSelf(); unsubscribeAuto(); },
  };
}
