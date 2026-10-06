// 設定タブの「所持パル（セーブ連携）」。セーブのファイルの登録・フォルダの読み込み、表示するワールド、共有の削除などを扱う。
import { el, button, runButton } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { dateTime, worldName, linkLabel, roleLabel, timeLines } from '../ui/owned-status.js';
import { ownedRows, rowsToCsv } from '../core/owned.js';
import { findWorldsInEntries, entriesFromFileList, entriesFromDataTransfer } from '../save/source.js';
import { parseWorldPath, handlesFromDrop, handleDropSupported, kindOf, REQUIRED_FILES } from '../save/handles.js';

function option(value, label) {
  const node = el('option', '', label);
  node.value = value;
  return node;
}

const AUTO_STATES = { checking: '確認中…', ready: '読み込み済み', permission: '許可が必要', empty: '登録なし', error: 'エラー', off: '' };
const WORLD_STATES = { permission: '許可が必要', missing: 'ファイルが見つかりません', error: '読めません' };

function registeredLabel(world) {
  const name = world.name ? worldName(world) : `ワールド ${String(world.id).slice(0, 8)}`;
  const kind = world.kind === 'guest' ? '参加だけ' : 'ホスト';
  const parts = [name, `${kind}で登録`, `${world.files?.length ?? 0} ファイル`];
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

export function ownedSettingsCard(context, { win = globalThis } = {}) {
  const owned = context.owned;
  const card = el('section', 'settings-card owned-settings');
  card.append(el('h2', '', '所持パル（セーブ連携）'),
    el('p', 'muted', 'ワールドのホストの PC でセーブを読み込むと、所持パルを仲間に共有します（スプレッドシートに保存）。参加している側の人は、ホストが共有した所持パルを見られます。'));
  const status = el('dl', 'owned-settings-status');

  // ---- セーブのファイルの登録（自動で読み込む） ----
  const supported = handleDropSupported(win);
  const autoBox = el('div', 'owned-register');
  autoBox.append(el('h3', '', 'セーブのファイルを登録して自動で読み込む'));
  const autoState = el('span', 'owned-auto-state');
  const autoWorld = el('select', 'owned-world');
  autoWorld.setAttribute('aria-label', '読み込むワールド');
  const autoNow = button('今すぐ読み込む', () => runButton(autoNow, () => owned.refreshAuto({ enable: true }), (error) => toast(error.message)), 'button secondary');
  // 許可はクリックの中で（await を挟まずに）求める
  const grant = button('読み込みを許可', () => runButton(grant, () => owned.grantAndRefresh(), (error) => toast(error.message)), 'button primary');
  const autoRow = el('div', 'owned-import-row');
  autoRow.append(autoState, autoWorld, grant, autoNow);
  const autoError = el('p', 'owned-auto-error');
  const registered = el('ul', 'owned-registered');

  const pathInput = el('input', 'owned-path');
  pathInput.type = 'text';
  pathInput.placeholder = '%LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\<Steam ID>\\<ワールド ID>';
  pathInput.setAttribute('aria-label', 'ワールドのフォルダのパス');
  const pathLabel = el('label', 'owned-step');
  pathLabel.append(el('span', 'field-label', '① ワールドのフォルダのパスを貼る'), pathInput);
  const pathHelp = el('p', 'owned-help muted',
    'エクスプローラーでワールドのフォルダ（%LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\<Steam ID>\\<32 桁のワールド ID>）を開き、アドレス欄をクリックしてコピーしたパスを貼ります。最後に遊んだワールドは、フォルダの更新日時がいちばん新しいものです。');
  const fileGuide = el('div', 'owned-file-guide');
  const fileDrop = dropZone('② ここにファイルをドロップ（何回かに分けても足せます）', (event) => {
    // ハンドルは drop イベントの中で受け取る必要がある
    const pending = handlesFromDrop(event.dataTransfer);
    addDropped(pending).catch((error) => toast(error.message));
  });
  const draftList = el('ul', 'owned-draft');
  const draftActions = el('div', 'owned-import-row');
  const preview = el('div', 'owned-preview');
  const registerHelp = el('p', 'owned-help muted',
    'ブラウザはセーブの場所（AppData）のフォルダを開けませんが、ドロップしたファイルは覚えておけます。登録は、ワールドごとに 1 回です。読み込むときに許可を求められたら「毎回のアクセスを許可」を選ぶと、次からは確認なしで読みます。ファイルはこの PC の中で読み、所持パルの一覧だけを共有します。');
  if (supported) {
    autoBox.append(autoRow, autoError, registered, pathLabel, pathHelp, fileGuide, fileDrop, draftList, draftActions, preview, registerHelp);
  } else {
    autoBox.append(el('p', 'owned-help muted', 'ファイルの登録は Chrome・Edge で使えます。このブラウザでは、下の「フォルダを選んで読み込む」を使ってください（毎回の操作になります）。'));
  }

  // 登録の下書き（貼ったパスのワールドに、ドロップしたファイルを足していく）
  let draft = null;
  let previewed = null;

  function resetDraft(target = null) {
    draft = target ? { ...target, files: new Map() } : null;
    previewed = null;
    renderDraft();
  }

  async function addDropped(pending) {
    const dropped = await pending;
    if (!dropped.supported) { toast('このブラウザでは、ファイルを登録できません'); return; }
    if (!draft) { toast('先に ① でワールドのフォルダのパスを貼ってください'); return; }
    if (dropped.failed) toast('フォルダは登録できません。フォルダを開いて、中のファイルを選んでドロップしてください');
    if (dropped.duplicates.length) toast(`同じ名前のファイルが 2 つ以上あります（${dropped.duplicates.join('、')}）。1 つずつドロップしてください`);
    if (dropped.ignored.length) toast(`対象外のファイルは登録しません（${dropped.ignored.join('、')}）`);
    for (const file of dropped.files) draft.files.set(file.path, file);
    previewed = null;
    renderDraft();
  }

  function renderGuide(target) {
    fileGuide.replaceChildren();
    if (!target) return;
    // 場所は、貼ったワールドのフォルダからの相対パスで出す
    const files = (title, lines) => {
      const list = el('dl', 'owned-file-list');
      for (const [path, note] of lines) list.append(el('dt', '', path), el('dd', '', note));
      return [el('p', 'owned-step-title', title), list];
    };
    fileGuide.append(
      el('p', 'owned-step-title', `ワールドのフォルダ: ${target.folder}`),
      el('p', 'owned-help muted', 'このフォルダの中の、次のファイルをドロップします（場所はこのフォルダからの相対パス）。'),
      ...files('自分がホストのワールド', [
        ['Level.sav', '必須（パル・拠点など）'],
        ['LevelMeta.sav', '必須（ワールド名・ホスト名）'],
        ['LocalData.sav', '必須（ホストか参加かの判定）'],
        ['Players\\ の中のファイル全部', '手持ち・パルボックスの場所に使う（Players フォルダを開いて全部選ぶ）'],
        ['..\\GlobalPalStorage.sav', '任意（1 つ上のフォルダ。グローバルパルボックスを出すとき）'],
      ]),
      ...files('参加しただけのワールド', [['LocalData.sav', '必須（ホストが共有した所持パルを表示する）']]),
    );
  }

  function renderDraft() {
    draftList.replaceChildren();
    draftActions.replaceChildren();
    preview.replaceChildren();
    fileDrop.classList.toggle('disabled', !draft);
    if (!draft) return;
    const known = owned.state.auto.worlds.find((world) => world.id === draft.worldId);
    const paths = [...new Set([...(known?.files ?? []), ...draft.files.keys()])];
    const kind = kindOf(paths);
    for (const path of REQUIRED_FILES[kind]) {
      const mark = draft.files.has(path) ? '✓ ドロップ済み' : known?.files?.includes(path) ? '✓ 登録済み' : '— まだ';
      draftList.append(el('li', '', `${path} ${mark}`));
    }
    const players = paths.filter((path) => path.startsWith('Players/')).length;
    if (kind === 'host') draftList.append(el('li', '', `Players のファイル ${players} 件`));
    if (paths.includes('../GlobalPalStorage.sav')) draftList.append(el('li', '', 'GlobalPalStorage.sav ✓'));
    if (!draft.files.size) return;
    const check = button('確認する', () => runButton(check, async () => {
      previewed = await owned.previewRegistration({ worldId: draft.worldId, steamId: draft.steamId, files: [...draft.files.values()] });
      renderPreview();
    }, (error) => toast(error.message)), 'button primary');
    const clear = button('ドロップしたファイルをやめる', () => { draft.files.clear(); previewed = null; renderDraft(); }, 'button quiet');
    draftActions.append(check, clear);
    renderPreview();
  }

  function renderPreview() {
    preview.replaceChildren();
    if (!previewed) return;
    const lines = [];
    if (previewed.kind === 'host') {
      lines.push(`${worldName({ worldName: previewed.name, hostName: previewed.hostName, worldId: previewed.worldId })} · ${previewed.palCount} 体`);
      lines.push(previewed.role === 'guest' ? 'LocalData.sav の方が新しいため、いまは「参加している側」と判定します（前にホストしたときのセーブが残っています）' : 'この PC がホストのワールドとして読み込みます');
    } else {
      lines.push(`ワールド ${previewed.worldId} に参加している側として登録します（ホストが共有した所持パルを表示します）`);
    }
    if (previewed.replaced.length) lines.push(`登録済みの ${previewed.replaced.join('・')} を置き換えます`);
    for (const line of lines) preview.append(el('p', '', line));
    const commit = button('このワールドで登録', () => runButton(commit, async () => {
      const outcome = await owned.commitRegistration(previewed);
      toast(outcome.persisted ? '登録しました。次からは自動で読み込みます' : 'このブラウザに保存できないため、ページを開いている間だけ使います');
      pathInput.value = '';
      renderGuide(null);
      resetDraft();
    }, (error) => toast(error.message)), 'button primary');
    const cancel = button('やめる', () => { previewed = null; renderPreview(); }, 'button quiet');
    preview.append(el('p', 'owned-help muted', 'ワールド名が違うときは、貼ったパスとドロップしたファイルの場所を確かめてください。'), commit, cancel);
  }

  pathInput.addEventListener('input', () => {
    const target = parseWorldPath(pathInput.value);
    renderGuide(target);
    if (!target) { resetDraft(); return; }
    if (draft?.worldId !== target.worldId) resetDraft(target);
  });

  // ---- フォルダ（手動） ----
  const folderInput = el('input');
  folderInput.type = 'file';
  folderInput.hidden = true;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.multiple = true;
  const folderButton = button('フォルダを選んで読み込む', () => folderInput.click(), 'button secondary');
  const drop = dropZone('またはワールドのフォルダをここにドロップ', async (event) => {
    if (owned.state.busy) { toast('読み込み中です。終わってからもう一度ドロップしてください'); return; }
    try { await importWorlds(await entriesFromDataTransfer(event.dataTransfer)); } catch (error) { toast(error.message); }
  });
  const folderWorlds = el('div', 'owned-folder-worlds');
  const folderRow = el('div', 'owned-import-row');
  folderRow.append(folderButton, drop, folderInput);
  const folderBox = el('div', 'owned-manual');
  folderBox.append(el('h3', '', '手動で読み込む（その場で 1 回だけ）'), folderRow, folderWorlds, el('p', 'owned-help muted',
    'セーブの場所: %LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\<Steam ID>\\<ワールド ID>（Steam ID のフォルダを選ぶとグローバルパルボックスも読みます）。ブラウザが「アップロード」の確認を出しますが、ファイルはこの PC の中で読みます。自動では読み直さないため、ゲームを進めたら読み込み直してください。'));

  // 表示するワールド・データ
  const viewWorld = el('select', 'owned-world');
  viewWorld.setAttribute('aria-label', '表示するワールド');
  const viewRow = el('div', 'owned-import-row');
  viewRow.append(el('span', 'field-label', '表示するワールド'), viewWorld);
  const unlinkButton = button('連携の設定を解除', async () => {
    if (!await confirmDialog('セーブ連携の設定を解除しますか？', '登録したセーブのファイル・フォルダの設定と、このブラウザに読み込んだセーブを消します。共有された所持パルは引き続き見られます。', { confirmText: '解除', danger: true })) return;
    try {
      await owned.unlink();
      toast('セーブ連携の設定を解除しました');
    } catch (error) { toast(error.message); }
  }, 'button quiet danger-text');
  const csvButton = button('所持パルを CSV で保存', () => {
    if (owned.state.owned) downloadCsv(owned.state.owned, owned.state.meta?.saveUpdatedAt ?? '');
  }, 'button secondary');
  const deleteButton = button('共有した所持パルを削除', async () => {
    if (!await confirmDialog('共有した所持パルを削除しますか？', 'スプレッドシートから、このワールドの所持パルを消します。仲間の画面にも表示されなくなります。セーブは変わりません。', { confirmText: '削除', danger: true })) return;
    await runButton(deleteButton, async () => { await owned.deleteShared(); toast('共有した所持パルを削除しました'); }, (error) => toast(error.message));
  }, 'button quiet danger-text');
  const dataRow = el('div', 'owned-import-row');
  dataRow.append(csvButton, unlinkButton, deleteButton);

  card.append(status, autoBox, folderBox, viewRow, dataRow);

  async function importWorlds(entries) {
    const worlds = findWorldsInEntries(entries);
    folderWorlds.replaceChildren();
    if (!worlds.length) { toast('Level.sav か LocalData.sav のあるワールドのフォルダが見つかりません'); return; }
    const load = async (world) => {
      try {
        const data = await owned.importFolderWorld(world);
        toast(data ? `${data.snapshot.pals.length} 体を読み込みました` : '参加しているワールドとして、ホストが共有した所持パルを表示します');
      } catch (error) { toast(error.message); }
    };
    if (worlds.length === 1) { await load(worlds[0]); return; }
    const select = el('select');
    select.setAttribute('aria-label', '読み込むワールド');
    worlds.forEach((world, index) => select.append(option(String(index), `${world.dir}${world.role === 'guest' ? '（参加）' : ''} · ${dateTime(world.playedAt)}`)));
    const go = button('このワールドを読み込む', () => runButton(go, () => load(worlds[Number(select.value) || 0]), (error) => toast(error.message)), 'button primary');
    folderWorlds.append(el('p', 'muted', `${worlds.length} 件のワールドが見つかりました（最後に遊んだ順）`), select, go);
  }

  folderInput.addEventListener('change', async () => {
    const entries = entriesFromFileList(folderInput.files ?? []);
    folderInput.value = '';
    await importWorlds(entries);
  });
  autoWorld.addEventListener('change', () => {
    owned.selectAutoWorld(autoWorld.value).catch((error) => toast(error.message));
  });
  viewWorld.addEventListener('change', () => owned.setViewWorld(viewWorld.value));

  function renderRegistered(state) {
    registered.replaceChildren();
    for (const world of state.auto.worlds) {
      const item = el('li', 'owned-registered-item');
      const remove = button('登録を削除', async () => {
        if (!await confirmDialog('このワールドの登録を削除しますか？', 'このブラウザに登録したファイルの記録を消します。セーブと、共有された所持パルは変わりません。', { confirmText: '削除', danger: true })) return;
        await runButton(remove, async () => { await owned.removeWorld(world.id); toast('登録を削除しました'); }, (error) => toast(error.message));
      }, 'button quiet danger-text');
      remove.disabled = state.busy;
      item.append(el('span', '', registeredLabel(world)), remove);
      registered.append(item);
    }
    registered.hidden = !state.auto.worlds.length;
  }

  function render(state) {
    const items = [
      ['連携', linkLabel(state) || '設定されていません'],
      ['この PC', roleLabel(state) || 'まだ判定していません'],
      ['表示中', state.meta ? `${worldName(state.meta)}${state.meta.source ? ` · ${state.owned?.pals.length ?? 0} 体` : '（データなし）'}` : 'なし'],
    ];
    const lines = timeLines(state);
    if (lines.length) items.push(['更新', lines.join(' · ')]);
    status.replaceChildren();
    for (const [term, detail] of items) status.append(el('dt', '', term), el('dd', '', detail));

    const hasWorlds = state.auto.worlds.length > 0;
    autoState.textContent = state.auto.enabled ? AUTO_STATES[state.auto.status] ?? '' : (hasWorlds ? '自動の読み込みはオフ（フォルダで読み込み中）' : '');
    autoState.className = `owned-auto-state state-${state.auto.status}`;
    autoError.textContent = state.auto.enabled ? state.auto.error : '';
    autoError.hidden = !autoError.textContent;
    autoNow.hidden = !hasWorlds;
    grant.hidden = !(state.auto.enabled && state.auto.status === 'permission');
    const choices = state.auto.worlds.filter((world) => world.playedAt);
    autoWorld.replaceChildren(option('', choices[0] ? `最後に遊んだワールド（いまは ${registeredLabel(choices[0]).split(' · ')[0]}）` : '最後に遊んだワールド'));
    for (const world of state.auto.worlds) autoWorld.append(option(world.id, registeredLabel(world).split(' · ')[0]));
    autoWorld.value = state.auto.worlds.some((world) => world.id === state.auto.worldId) ? state.auto.worldId : '';
    autoWorld.hidden = !state.auto.enabled || state.auto.worlds.length < 2;
    renderRegistered(state);

    const shared = state.shared.worlds ?? [];
    viewWorld.replaceChildren(option('', state.linkedWorldId ? '連携しているワールド' : 'いちばん新しく共有されたワールド'));
    for (const world of shared) viewWorld.append(option(world.worldId, `${worldName(world)} · ${world.palCount} 体 · ${dateTime(world.uploadedAt)} 共有`));
    viewWorld.value = shared.some((world) => world.worldId === state.viewWorldId) ? state.viewWorldId : '';
    // 連携しているときは、連携しているワールドを出す
    viewWorld.disabled = Boolean(state.linkedWorldId) || state.busy;
    viewRow.hidden = !shared.length;

    for (const node of [autoNow, folderButton, autoWorld]) node.disabled = state.busy;
    drop.classList.toggle('disabled', state.busy);
    csvButton.disabled = !state.owned;
    unlinkButton.hidden = !linkLabel(state) && !state.local && !hasWorlds;
    // 共有の削除はホスト（この PC のセーブを共有した人）だけ
    deleteButton.hidden = !(state.role === 'host' && state.meta?.sharedAt);
  }

  const unsubscribe = owned.subscribe(render);
  render(owned.state);
  renderDraft();
  owned.load().catch(() => {});
  return { element: card, destroy: unsubscribe };
}
