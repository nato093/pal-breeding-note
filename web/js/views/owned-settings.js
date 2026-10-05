// 設定タブの「所持パル（セーブ連携）」。連携ツール・フォルダの設定、表示するワールド、共有の削除などを扱う。
import { el, button, runButton } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { dateTime, worldName, linkLabel, roleLabel, timeLines } from '../ui/owned-status.js';
import { ownedRows, rowsToCsv } from '../core/owned.js';
import { findWorldsInEntries, entriesFromFileList, entriesFromDataTransfer } from '../save/source.js';

function option(value, label) {
  const node = el('option', '', label);
  node.value = value;
  return node;
}

function bridgeWorldLabel(world) {
  const name = world.role === 'guest' ? `参加したワールド ${String(world.id).slice(0, 8)}` : worldName(world);
  return `${name} · ${dateTime(world.playedAt || world.updatedAt)}${world.role === 'guest' ? '' : ' 保存'}`;
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

export function ownedSettingsCard(context) {
  const owned = context.owned;
  const card = el('section', 'settings-card owned-settings');
  card.append(el('h2', '', '所持パル（セーブ連携）'),
    el('p', 'muted', 'ワールドのホストの PC でセーブを読み込むと、所持パルを仲間に共有します（スプレッドシートに保存）。参加している側の人は、ホストが共有した所持パルを見られます。'));
  const status = el('dl', 'owned-settings-status');

  // セーブ連携ツール
  const bridgeToggle = el('input');
  bridgeToggle.type = 'checkbox';
  const bridgeLabel = el('label', 'owned-toggle');
  bridgeLabel.append(bridgeToggle, el('span', '', 'セーブ連携ツールから自動で読み込む'));
  const bridgeState = el('span', 'owned-bridge-state');
  const bridgeWorld = el('select', 'owned-world');
  bridgeWorld.setAttribute('aria-label', '読み込むワールド');
  const bridgeNow = button('今すぐ読み込む', () => runButton(bridgeNow, () => owned.refreshBridge(), (error) => toast(error.message)), 'button secondary');
  const bridgeRow = el('div', 'owned-import-row');
  bridgeRow.append(bridgeLabel, bridgeState, bridgeWorld, bridgeNow);
  const bridgeError = el('p', 'owned-bridge-error');
  const bridgeHelp = el('p', 'owned-help muted',
    'ブラウザはセーブの場所（AppData）を直接開けないため、この PC で連携ツールを起動しておきます（npm run save-bridge か scripts/save-bridge.cmd）。起動中は所持パルを開くたびに新しいセーブを読みます。他の人のワールドに参加しているときは、そのワールドのホストが共有した所持パルを表示します。');

  // フォルダ
  const folderInput = el('input');
  folderInput.type = 'file';
  folderInput.hidden = true;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.multiple = true;
  const folderButton = button('フォルダを選んで読み込む', () => folderInput.click(), 'button secondary');
  const drop = el('div', 'owned-drop', 'またはワールドのフォルダをここにドロップ');
  const folderWorlds = el('div', 'owned-folder-worlds');
  const folderRow = el('div', 'owned-import-row');
  folderRow.append(folderButton, drop, folderInput);
  const folderHelp = el('p', 'owned-help muted',
    'セーブの場所: %LOCALAPPDATA%\\Pal\\Saved\\SaveGames\\<Steam ID>\\<ワールド ID>（Steam ID のフォルダを選ぶとグローバルパルボックスも読みます）。ブラウザが「アップロード」の確認を出しますが、ファイルはこの PC の中で読み、所持パルの一覧だけを共有します。');

  // 表示するワールド・データ
  const viewWorld = el('select', 'owned-world');
  viewWorld.setAttribute('aria-label', '表示するワールド');
  const viewRow = el('div', 'owned-import-row');
  viewRow.append(el('span', 'field-label', '表示するワールド'), viewWorld);
  const unlinkButton = button('連携の設定を解除', async () => {
    if (!await confirmDialog('セーブ連携の設定を解除しますか？', '連携ツール・フォルダの設定と、このブラウザに読み込んだセーブを消します。共有された所持パルは引き続き見られます。', { confirmText: '解除', danger: true })) return;
    await owned.unlink();
    toast('セーブ連携の設定を解除しました');
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

  card.append(status, bridgeRow, bridgeError, bridgeHelp, folderRow, folderWorlds, folderHelp, viewRow, dataRow);

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
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.toggle('dragging', true); });
  drop.addEventListener('dragleave', () => drop.classList.toggle('dragging', false));
  drop.addEventListener('drop', async (event) => {
    event.preventDefault();
    drop.classList.toggle('dragging', false);
    if (owned.state.busy) { toast('読み込み中です。終わってからもう一度ドロップしてください'); return; }
    try { await importWorlds(await entriesFromDataTransfer(event.dataTransfer)); } catch (error) { toast(error.message); }
  });
  bridgeToggle.addEventListener('change', () => {
    owned.setBridgeEnabled(bridgeToggle.checked);
    if (bridgeToggle.checked) owned.refreshBridge().catch((error) => toast(error.message));
  });
  bridgeWorld.addEventListener('change', () => {
    owned.selectBridgeWorld(bridgeWorld.value).catch((error) => toast(error.message));
  });
  viewWorld.addEventListener('change', () => owned.setViewWorld(viewWorld.value));

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

    bridgeToggle.checked = state.bridge.enabled;
    bridgeState.textContent = !state.bridge.enabled ? '' : {
      checking: '確認中…', ready: '接続中', offline: '連携ツールが見つかりません', error: 'エラー', empty: 'ワールドなし', off: '',
    }[state.bridge.status] ?? '';
    bridgeState.className = `owned-bridge-state state-${state.bridge.status}`;
    bridgeError.textContent = state.bridge.enabled ? state.bridge.error : '';
    bridgeError.hidden = !bridgeError.textContent;
    bridgeNow.hidden = !state.bridge.enabled;
    const worlds = state.bridge.worlds ?? [];
    bridgeWorld.replaceChildren(option('', worlds[0] ? `最後に遊んだワールド（いまは ${bridgeWorldLabel(worlds[0])}）` : '最後に遊んだワールド'));
    for (const world of worlds) bridgeWorld.append(option(world.dir, bridgeWorldLabel(world)));
    bridgeWorld.value = worlds.some((world) => world.dir === state.bridge.worldDir) ? state.bridge.worldDir : '';
    bridgeWorld.hidden = !state.bridge.enabled || worlds.length < 2;

    const shared = state.shared.worlds ?? [];
    viewWorld.replaceChildren(option('', state.linkedWorldId ? '連携しているワールド' : 'いちばん新しく共有されたワールド'));
    for (const world of shared) viewWorld.append(option(world.worldId, `${worldName(world)} · ${world.palCount} 体 · ${dateTime(world.uploadedAt)} 共有`));
    viewWorld.value = shared.some((world) => world.worldId === state.viewWorldId) ? state.viewWorldId : '';
    // 連携しているときは、連携しているワールドを出す
    viewWorld.disabled = Boolean(state.linkedWorldId) || state.busy;
    viewRow.hidden = !shared.length;

    for (const node of [bridgeNow, folderButton, bridgeToggle, bridgeWorld]) node.disabled = state.busy;
    drop.classList.toggle('disabled', state.busy);
    csvButton.disabled = !state.owned;
    unlinkButton.hidden = !linkLabel(state) && !state.local;
    // 共有の削除はホスト（この PC のセーブを共有した人）だけ
    deleteButton.hidden = !(state.role === 'host' && state.meta?.sharedAt);
  }

  const unsubscribe = owned.subscribe(render);
  render(owned.state);
  owned.load().catch(() => {});
  return { element: card, destroy: unsubscribe };
}
