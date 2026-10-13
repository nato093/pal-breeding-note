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

test('静的検査: scroll-margin-top にヘッダーの高さを足さない（html の scroll-padding-top がヘッダーと 8px を受け持つ。足すと着地点がヘッダーの分だけ下がる）', async () => {
  const css = await readFile(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  assert.match(css, /^html \{[^}]*scroll-padding-top: calc\(var\(--header-h\) \+ 8px\)/m);
  const margins = [...css.matchAll(/scroll-margin-top:\s*([^;}]+)/g)].map((match) => match[1].trim());
  assert.ok(margins.length >= 3, margins.join(' / '));
  for (const value of margins) assert.doesNotMatch(value, /--header-h/, value);
});

test('静的検査: 所持パルの行の高さの見積もり（JS の ROW_ESTIMATE・ROW_ESTIMATE_BAND）と CSS の --owned-row-h・--owned-row-band-h をそろえ（差は下の段の --owned-band-h。D25）、配合牧場の詳細の閉じた 1 行の高さは --farm-fold-h だけで決める', async () => {
  const css = await readFile(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  const owned = await readFile(new URL('../../web/js/views/owned.js', import.meta.url), 'utf8');
  const constant = (name) => Number(owned.match(new RegExp(String.raw`^const ${name} = (\d+);`, 'm'))?.[1]);
  const variable = (name) => Number(css.match(new RegExp(String.raw`${name}: (\d+)px;`))?.[1]);
  const estimate = constant('ROW_ESTIMATE');
  const bandEstimate = constant('ROW_ESTIMATE_BAND');
  assert.ok(Number.isFinite(estimate) && estimate > 0, 'ROW_ESTIMATE が読めません');
  assert.ok(Number.isFinite(bandEstimate) && bandEstimate > estimate, 'ROW_ESTIMATE_BAND が読めません');
  assert.equal(estimate, variable('--owned-row-h'));
  assert.equal(bandEstimate, variable('--owned-row-band-h'));
  assert.equal(bandEstimate - estimate, variable('--owned-band-h'));
  // 下の段を取る一覧（has-band）の行は --owned-row-band-h（全部の行が同じ高さ）
  assert.match(css, /^\.owned-list\.has-band \.owned-row \{[^}]*(?:^|[;\s])height: var\(--owned-row-band-h\)/m);
  const escape = (text) => text.replace(/[[\]().:"]/g, '\\$&');
  const rule = (selector) => css.match(new RegExp(String.raw`^${escape(selector)} \{([^}]*)\}`, 'm'))?.[1] ?? '';
  // 全体の summary の min-height（44px）に引きずられない（--farm-fold-h を変えたら、閉じた 1 行も場所だけのときも同じ高さになる）
  assert.match(rule('.ideal-farms-summary'), /(?:^|[;\s])height: var\(--farm-fold-h\)/);
  assert.match(rule('.ideal-farms-summary'), /(?:^|[;\s])min-height: 0[;\s]/);
  assert.match(rule('.ideal-farms:empty'), /(?:^|[;\s])height: var\(--farm-fold-h\)/);
});
