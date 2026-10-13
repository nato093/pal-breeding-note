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

test('静的検査: 理想個体・所持パルのある継承ルート（.route-query）のパッシブの欄は、空でも 2 行分の高さを取り、行を上に詰める', async () => {
  const css = await readFile(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  const rule = (selector) => css.match(new RegExp(`^${selector.replace(/[[\]().:"]/g, '\$&')} \{([^}]*)\}`, 'm'))?.[1] ?? '';
  const px = (selector, property) => Number(rule(selector).match(new RegExp(`(?:^|[;\s])${property}: (\d+)px`))?.[1]);
  // 2 行分 = 1 行目の追加欄 ＋ 行の間 ＋ 2 行目のチップ（どれかの高さを変えたら、2 行分も合わせる）
  const twoRows = px('.passive-add', 'min-height') + px('.passive-row', 'gap') + px('.passive-chip', 'min-height');
  assert.equal(px('.route-query .passive-row', 'min-height'), twoRows);
  // 余った高さで 1 行目が真ん中へ下がらないように
  assert.match(rule('.route-query .passive-row'), /align-content: flex-start/);
  // 所持パルなど、ほかの欄は 1 行分のまま（2 行分を取るのは .route-query の中だけ）
  assert.equal(px('.passive-row', 'min-height'), px('.passive-add', 'min-height'));
  assert.deepEqual(css.match(/^[^{}\n]*\.passive-row[^{}\n]*(?=\{)/gm).map((selector) => selector.trim()), ['.passive-row', '.route-query .passive-row']);
});
