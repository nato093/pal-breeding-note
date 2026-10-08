import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('静的検査: 押せないボタンは読み込み中のカーソルにせず、押して処理している間（aria-busy）だけ読み込み中にする', async () => {
  const css = await readFile(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  const rule = (selector) => css.match(new RegExp(`^${selector.replace(/[[\]().:"]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
  // 「登録済み」など、処理中ではなく押す必要がないだけのボタンで、カーソルが読み込み中のままにならない
  assert.match(rule('button:disabled'), /cursor: default/);
  assert.match(rule('button[aria-busy="true"]'), /cursor: wait/);
  // 同じ詳細度なので、処理中の指定が後にないと無効の指定に負ける
  assert.ok(css.indexOf('button[aria-busy="true"] {') > css.indexOf('button:disabled {'));
});
