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

test('静的検査: パッシブの欄は空のとき 1 行分で、行の数を固定しない（改行が要るときだけ増える）', async () => {
  const css = await readFile(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  // テンプレート文字列の中では \d・\s が消えるので、String.raw で組み立てる（値が NaN だと NaN どうしの比較で通ってしまう）
  const escape = (text) => text.replace(/[[\]().:"]/g, '\\$&');
  const rule = (selector) => css.match(new RegExp(String.raw`^${escape(selector)} \{([^}]*)\}`, 'm'))?.[1] ?? '';
  const px = (selector, property) => {
    const value = Number(rule(selector).match(new RegExp(String.raw`(?:^|[;\s])${property}: (\d+)px`))?.[1]);
    assert.ok(Number.isFinite(value), `${selector} の ${property} が読めません`);
    return value;
  };
  // 1 行分 = 追加欄の高さ。理想個体・継承ルート（.route-query）も含め、2 行分・3 行分を取る規則はない（2026-10-13 のユーザーの判断）
  assert.equal(px('.passive-row', 'min-height'), px('.passive-add', 'min-height'));
  assert.match(rule('.passive-row'), /flex-wrap: wrap/);
  assert.deepEqual(css.match(/^[^{}\n]*\.passive-row[^{}\n]*(?=\{)/gm).map((selector) => selector.trim()), ['.passive-row']);
});
