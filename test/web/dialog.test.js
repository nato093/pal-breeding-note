import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { openDialog, confirmDialog } from '../../web/js/ui/dialog.js';
import { toast } from '../../web/js/ui/toast.js';

test('ダイアログ: 既定では背景クリックで閉じ、終了処理と元のフォーカスを保つ', async (t) => {
  const { body } = installDom(t);
  let closed = 0;
  const modal = openDialog('既定のダイアログ', { onClose: () => closed++ });
  await modal.dialog.dispatch('click', { target: modal.body });
  assert.equal(modal.dialog.open, true);
  await modal.dialog.dispatch('click');
  assert.equal(modal.dialog.open, false);
  assert.equal(modal.dialog.isConnected, false);
  assert.equal(closed, 1);
  assert.equal(document.activeElement, body);
});

test('確認ダイアログ: 背景クリックで閉じた場合は未承認になる', async (t) => {
  const { body } = installDom(t);
  const accepted = confirmDialog('保存の確認', '続けますか？');
  const dialog = body.querySelector('dialog');
  await dialog.dispatch('click');
  assert.equal(await accepted, false);
  assert.equal(dialog.open, false);
});

test('トースト: 開いているダイアログに出し、閉じたら残りを次の表示先へ移して元に戻すを押せるようにする', async (t) => {
  const { body } = installDom(t);
  const outer = openDialog('外側');
  const inner = openDialog('内側');
  let undone = 0;
  toast('削除しました', { action: () => { undone++; } });
  const node = inner.dialog.querySelector('.toast');
  assert.ok(node);
  await inner.close();
  assert.ok(outer.dialog.contains(node));
  await outer.close();
  assert.ok(body.querySelector('.toast-region').contains(node));
  await node.querySelector('button').dispatch('click');
  assert.equal(undone, 1);
});

test('ダイアログ: ×・Esc・背景・キャンセルは requestClose を通り、beforeClose が false なら閉じない。通らずに閉じたら forced で知らせる', async (t) => {
  installDom(t);
  const reasons = [];
  let allow = false;
  const modal = openDialog('確かめるダイアログ', { beforeClose: (reason) => { reasons.push(reason); return allow; } });
  await modal.dialog.querySelector('.dialog-close').dispatch('click');
  assert.equal(modal.dialog.open, true);
  const escaped = await modal.dialog.dispatch('cancel');
  assert.equal(escaped.defaultPrevented, true);
  assert.equal(modal.dialog.open, true);
  await modal.dialog.dispatch('click');
  assert.equal(modal.requestClose('cancel'), false);
  assert.deepEqual(reasons, ['dismiss', 'escape', 'backdrop', 'cancel']);
  assert.equal(modal.dialog.open, true);
  allow = true;
  assert.equal(modal.requestClose('cancel'), true);
  assert.equal(modal.dialog.open, false);
  // close() は確かめずに閉じる（保存に成功した後など）
  reasons.length = 0;
  const saved = openDialog('保存', { beforeClose: (reason) => { reasons.push(reason); return false; } });
  await saved.close();
  assert.equal(saved.dialog.open, false);
  assert.deepEqual(reasons, []);
  // requestClose を通らずに閉じた（closeDialogs など）ときは、閉じた後に forced
  const forced = openDialog('ログアウト', { beforeClose: (reason) => { reasons.push(reason); return false; } });
  await forced.dialog.close();
  assert.deepEqual(reasons, ['forced']);
  assert.equal(forced.dialog.isConnected, false);
});

test('ダイアログ: initialFocus に開いた後フォーカスし、確認ダイアログの本文は aria-describedby で結ぶ', async (t) => {
  const { body } = installDom(t);
  const target = document.createElement('button');
  const modal = openDialog('最初のフォーカス', { initialFocus: target });
  modal.body.append(target);
  assert.equal(document.activeElement, target);
  await modal.close();
  const accepted = confirmDialog('保存の確認', '続けますか？');
  const dialog = body.querySelector('dialog');
  const description = dialog.querySelector('p');
  assert.equal(dialog.getAttribute('aria-describedby'), description.id);
  assert.equal(description.textContent, '続けますか？');
  await dialog.querySelectorAll('button').find((node) => node.textContent === 'キャンセル').dispatch('click');
  assert.equal(await accepted, false);
});
