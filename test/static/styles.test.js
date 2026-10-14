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
  assert.equal(px('.passive-chips', 'min-height'), px('.passive-add', 'min-height'));
  assert.deepEqual(css.match(/^[^{}\n]*\.passive-row[^{}\n]*(?=\{)/gm).map((selector) => selector.trim()), ['.passive-row']);
  // 改行するときは、チップをプルダウン（追加欄）の右にそろえて左詰めで並べる（D28）。追加欄とチップの領域を横に並べ（.passive-row は
  // 折り返さない）、チップの領域（.passive-chips。前は display: contents で、2 行目が追加欄の下から始まった）の中で折り返す
  assert.doesNotMatch(rule('.passive-row'), /flex-wrap: wrap/);
  assert.match(rule('.passive-chips'), /(?:^|[;\s])display: flex[;\s]/);
  assert.match(rule('.passive-chips'), /flex-wrap: wrap/);
  assert.match(rule('.passive-chips'), /min-width: 0[;\s]/);
  assert.doesNotMatch(css, /\.passive-chips[^{}]*\{[^}]*display: contents/);
  // チップの 1 行目は追加欄と同じ高さの真ん中（上の余白 × 2 ＋ チップの高さ ＝ 追加欄の高さ）
  const padTop = Number(rule('.passive-chips').match(/(?:^|[;\s])padding: (\d+)px 0[;\s]/)?.[1]);
  assert.equal(padTop * 2 + px('.passive-chip', 'min-height'), px('.passive-add', 'min-height'));
});

test('静的検査: 所持パルの場所のチップ（押して切り替える）はオンに ✓ を付け、状態の行の条件のチップ（× で外す）とは地の色で分ける（D28）', async () => {
  const css = await readFile(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  const escape = (text) => text.replace(/[[\]().:"]/g, '\\$&');
  const rule = (selector) => css.match(new RegExp(String.raw`^${escape(selector)} \{([^}]*)\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.place-chip[aria-pressed="true"]::before'), /content: '✓'/);
  // 条件のチップは枠と明るい地のタグ（場所のチップのオンと同じ secondary-container の地にしない）
  assert.match(rule('.filter-chip'), /border: 1px solid/);
  assert.doesNotMatch(rule('.filter-chip'), /secondary-container/);
});

test('静的検査: 色のロール（--md-sys-color-*）は参照しているものをすべて定義し、error-container の上の文字（on-error-container）はライトとダークの両方で定義する', async () => {
  const css = await readFile(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  // ライトは最初の :root、ダークは @media (prefers-color-scheme: dark) の中の :root
  const light = css.match(/^:root \{([^}]*)\}/m)?.[1] ?? '';
  const dark = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/)?.[1] ?? '';
  const defined = (block) => new Set([...block.matchAll(/(--md-sys-color-[a-z-]+):/g)].map((match) => match[1]));
  const lightNames = defined(light);
  const darkNames = defined(dark);
  assert.ok(lightNames.size > 10 && darkNames.size > 10, 'ライトとダークの :root が読めません');
  // 「変更あり」の札などの文字色。定義がないと値が無効になり、文字色が親から継がれる（前はこうなっていた）
  assert.ok(lightNames.has('--md-sys-color-on-error-container'));
  assert.ok(darkNames.has('--md-sys-color-on-error-container'));
  // 参照している色はすべてライト（既定）に定義がある。ダークは上書きだけで、ダークにしかない色もない
  const used = new Set([...css.matchAll(/var\((--md-sys-color-[a-z-]+)/g)].map((match) => match[1]));
  assert.ok(used.has('--md-sys-color-on-error-container'));
  for (const name of used) assert.ok(lightNames.has(name), `${name} の定義がありません`);
  for (const name of darkNames) assert.ok(lightNames.has(name), `${name} はダークにしか定義がありません`);
});

test('静的検査: 動き（transition・animation）は、動きを減らす設定でないとき（prefers-reduced-motion: no-preference）だけ付ける', async () => {
  const css = await readFile(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  // ブロックの中身（入れ子の { } を数えて閉じ括弧まで）を外した残りに、transition・animation の指定がない
  const start = css.indexOf('@media (prefers-reduced-motion: no-preference) {');
  assert.ok(start >= 0);
  let depth = 0;
  let end = css.indexOf('{', start);
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  const outside = css.slice(0, start) + css.slice(end + 1);
  // 「animation: none」（止める指定）は外にあってよい
  const motions = [...outside.matchAll(/(?:^|[;{\s])(transition|animation)\s*:\s*([^;}]+)/g)].filter((match) => match[2].trim() !== 'none');
  assert.deepEqual(motions.map((match) => match[0].trim()), []);
  // 開閉の ▸ は回る動きを、ブロックの中で付ける
  const inside = css.slice(start, end + 1);
  assert.match(inside, /\.owned-world-summary::before[^{]*\{\s*transition: transform/);
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
  // 出すものがないときに 1 行の場所を残す規則（.ideal-farms:empty）は、D30 でなくした（詳細ごと hidden にする）
  assert.equal(rule('.ideal-farms:empty'), '');
});

// WCAG 2.x の相対輝度とコントラスト比（#rrggbb）
function contrast(a, b) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
// ライトは最初の :root、ダークは @media (prefers-color-scheme: dark) の中の :root
async function themes() {
  const css = await readFile(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  const light = css.match(/^:root \{([^}]*)\}/m)?.[1] ?? '';
  const dark = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/)?.[1] ?? '';
  const value = (block, name) => block.match(new RegExp(String.raw`(?:^|[;\s])${name}: ([^;]+);`))?.[1].trim() ?? '';
  return { css, light: (name) => value(light, name), dark: (name) => value(dark, name) || value(light, name), darkOnly: (name) => value(dark, name) };
}

test('静的検査: 性別の色はトークン（--gender-male・--gender-female・--on-gender）でライトとダークに持ち、♀ はエラーの赤を使わない。文字は地に 4.5:1 以上（visual-parts）', async () => {
  const { css, light, dark, darkOnly } = await themes();
  for (const name of ['--gender-male', '--gender-female', '--on-gender']) {
    assert.match(light(name), /^#[0-9a-f]{6}$/, `ライトの ${name}`);
    assert.match(darkOnly(name), /^#[0-9a-f]{6}$/, `ダークの ${name}`);
  }
  const escape = (text) => text.replace(/[[\]().:"]/g, '\$&');
  const rule = (selector) => css.match(new RegExp(String.raw`^${escape(selector)} \{([^}]*)\}`, 'm'))?.[1] ?? '';
  assert.match(rule('.gender-M'), /var\(--gender-male\)/);
  assert.match(rule('.gender-F'), /var\(--gender-female\)/);
  // 前は ♂ が水属性の色、♀ がエラーの赤（ごみ箱のボタンと同じ色）だった
  for (const selector of ['.gender-M', '.gender-F']) assert.doesNotMatch(rule(selector), /--danger|--md-sys-color-error|--Water/, selector);
  // 文の中の色（ライトは白と背景、ダークは行の地と背景）と、丸い地の上の文字（--on-gender）
  for (const name of ['--gender-male', '--gender-female']) {
    for (const ground of ['#ffffff', light('--md-sys-color-surface')]) assert.ok(contrast(light(name), ground) >= 4.5, `${name} / ${ground}`);
    for (const ground of [dark('--md-sys-color-surface-container-low'), dark('--md-sys-color-surface')]) assert.ok(contrast(dark(name), ground) >= 4.5, `ダークの ${name} / ${ground}`);
    assert.ok(contrast(light(name), light('--on-gender')) >= 4.5, `${name} の地の文字`);
    assert.ok(contrast(dark(name), dark('--on-gender')) >= 4.5, `ダークの ${name} の地の文字`);
  }
});

test('静的検査: 入力欄の枠（outline）は背景と白に 3:1 以上。属性チップの白い文字は 4.5:1 以上で、チップだけの色（--element-chip）にしてアバターの属性の色は変えない（visual-parts）', async () => {
  const { css, light, dark } = await themes();
  for (const ground of ['#ffffff', light('--md-sys-color-surface')]) assert.ok(contrast(light('--md-sys-color-outline'), ground) >= 3, `outline / ${ground}`);
  for (const ground of [dark('--md-sys-color-surface'), dark('--md-sys-color-surface-container-low')]) assert.ok(contrast(dark('--md-sys-color-outline'), ground) >= 3, `ダークの outline / ${ground}`);
  assert.match(css, /^\.element-chip \{[^}]*background: var\(--element-chip, var\(--element, var\(--Neutral\)\)\)/m);
  const elements = ['Neutral', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Ground', 'Dark', 'Dragon'];
  for (const element of elements) {
    const own = css.match(new RegExp(String.raw`^\.element-${element} \{([^}]*)\}`, 'm'))?.[1] ?? '';
    const chip = own.match(/--element-chip: (#[0-9a-f]{6})/)?.[1] ?? light(`--${element}`);
    assert.ok(contrast(chip, '#ffffff') >= 4.5, `${element} のチップ ${chip}`);
  }
  // .pal-avatar（属性の色の丸）が使う元の色はそのまま
  assert.deepEqual(elements.map((element) => light(`--${element}`)), ['#787d88', '#d25337', '#247fbc', '#498132', '#937309', '#258790', '#9a693d', '#8159a7', '#665bc2']);
  // 配合の式の「＋」は文字の色（on-surface-variant。前は outline で背景に 1.79:1）
  assert.match(css, /^\.equation-symbol \{[^}]*color: var\(--md-sys-color-on-surface-variant\)/m);
});

test('静的検査: 押せないボタンは opacity で薄くせず（M3 の無効の色）、押して処理している間（aria-busy）は今の色のまま。select の開閉の印はパル選択と同じ ∨（CSS の data URI）', async () => {
  const { css, light, darkOnly } = await themes();
  const escape = (text) => text.replace(/[[\]().:"]/g, '\$&');
  const rule = (selector) => css.match(new RegExp(String.raw`^${escape(selector)} \{([^}]*)\}`, 'm'))?.[1] ?? '';
  assert.match(rule('button:disabled'), /cursor: default/);
  assert.doesNotMatch(rule('button:disabled'), /opacity/);
  // 無効の色は処理中のボタン（runButton が disabled と aria-busy を付ける）には当てない
  assert.match(css, /^button:disabled:not\(\[aria-busy="true"\]\)[^{]*\{[^}]*color: color-mix\(in srgb, var\(--md-sys-color-on-surface\) 38%, transparent\)/m);
  assert.match(css, /:disabled[^{]*:not\(\[aria-busy="true"\]\)[^{]*\{[^}]*background: color-mix\(in srgb, var\(--md-sys-color-on-surface\) 12%, transparent\)/);
  // select は OS の ▼ をやめ、色ごとの data URI（data URI の SVG は currentColor を使えない）
  assert.match(css, /^select \{[^}]*appearance: none[^}]*background-image: var\(--select-arrow\)/m);
  for (const value of [light('--select-arrow'), darkOnly('--select-arrow')]) assert.match(value, /^url\("data:image\/svg\+xml,/);
  assert.notEqual(light('--select-arrow'), darkOnly('--select-arrow'));
  // パッシブのチップの × は 24×24px（WCAG 2.5.8）
  assert.match(rule('.passive-remove'), /inline-size: 24px/);
  assert.match(rule('.passive-remove'), /block-size: 24px/);
});

test('静的検査: 状態の印は 1 つの部品（.status-chip と tone）。tone ごとの地と文字はライトとダークで 4.5:1 以上で、前のクラス名に色・角・地の規則を残さない（visual-parts）', async () => {
  const { css, light, dark } = await themes();
  // var(--x) をライト・ダークの値にする（ダークに上書きがなければライトの値）
  const resolve = (get, value) => value.replace(/^var\((--[a-z-]+)\)$/, (_, name) => get(name));
  assert.match(css, /^\.status-chip \{[^}]*border-radius: 4px[^}]*font-size: 11px[^}]*white-space: nowrap/m);
  for (const tone of ['ready', 'warning', 'error', 'info', 'neutral']) {
    const body = css.match(new RegExp(String.raw`^\.status-chip\.is-${tone} \{([^}]*)\}`, 'm'))?.[1] ?? '';
    const background = body.match(/background: (var\(--[a-z-]+\))/)?.[1];
    const color = body.match(/(?:^|[;\s])color: (var\(--[a-z-]+\))/)?.[1];
    assert.ok(background && color, `${tone} の地と文字`);
    for (const [theme, get] of [['ライト', light], ['ダーク', dark]]) {
      const ratio = contrast(resolve(get, background), resolve(get, color));
      assert.ok(ratio >= 4.5, `${theme}の ${tone}: ${ratio.toFixed(2)}`);
    }
  }
  // 前のクラス名（テストと画面の中の探し方のために残す）の規則は、置き場所の調整（幅・折り返し・余白）だけ（コメントは除いて見る）
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const name of ['unread-chip', 'warning-chip', 'wishlist-status', 'owned-auto-state', 'owned-world-state', 'ideal-changed', 'ideal-placed', 'ideal-goal-status']) {
    for (const [, selector, body] of plain.matchAll(new RegExp(String.raw`([^{}]*\.${name}(?![\w-])[^{}]*)\{([^}]*)\}`, 'g'))) {
      assert.doesNotMatch(body, /background|(?:^|[;\s])color:|border-radius/, selector.trim());
    }
  }
});
