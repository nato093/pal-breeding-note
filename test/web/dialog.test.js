import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { openDialog, confirmDialog } from '../../web/js/ui/dialog.js';

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
