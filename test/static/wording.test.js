// 画面の文言の用語表（README.md の「表記の決まり」）を守っているかを確かめる。
// コメント（// … と /* … */）を除いた本文だけを調べ、使わない言い回しが残っていないことを見る
//（コメントや内部の説明を誤って拾わないように。文字列・テンプレート・正規表現の中の // や /* はコメントとして扱わない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// 使わない言い回し（左）と、代わりに使う言葉（右。失敗したときの説明）
const BANNED = [
  ['生まれ', '産まれる'],
  ['グローバルボックス', 'グローバルパルボックス'],
  ['オスとメス', '♂ と ♀'],
  ['参加だけ', '参加者'],
  ['参加している側', '参加者'],
  ['参加している人', '参加者'],
  ['新しい版', '新しいバージョン'],
  ['スキルをつなぐ', '継承ルート（見出しはタブ名）'],
  ['スキルを運ぶ', 'パッシブを運ぶ'],
  ['設定タブ', '1 文と行き先のボタン（setupHint・案内の帯のボタン・settingsHash）'],
  ['この端末のみ', 'この端末だけ'],
  ['名前を変更', 'ID を変更'],
  ['名前の変更', 'ID の変更'],
  ['新しい名前', '新しい ID'],
];
// 配った通知の履歴なので直さないファイル（id は既読の判定に使い、文は配った時点のまま残す）
const ALLOWED = new Set(['web/js/release-notes.js']);

/** JS の本文からコメントを除く（文字列・テンプレート〔${} の中も〕・正規表現はそのまま残す） */
export function stripComments(source) {
  let out = '';
  let i = 0;
  // 直前の意味のある文字（/ が正規表現の始まりか割り算かを決める。簡易）
  let prev = '';
  const regexAfter = /^$|[(,=:[!&|?{};+\-*%<>~^]$/;
  const keywordBefore = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
  function quoted(quote) {
    out += source[i++];
    while (i < source.length) {
      const c = source[i++];
      out += c;
      if (c === '\\') { out += source[i++] ?? ''; continue; }
      if (c === quote || c === '\n') return;
    }
  }
  function template() {
    out += source[i++];
    while (i < source.length) {
      const c = source[i];
      if (c === '\\') { out += c + (source[i + 1] ?? ''); i += 2; continue; }
      if (c === '`') { out += c; i++; return; }
      if (c === '$' && source[i + 1] === '{') { out += '${'; i += 2; prev = '{'; code(true); continue; }
      out += c;
      i++;
    }
  }
  function regex() {
    out += source[i++];
    let inClass = false;
    while (i < source.length) {
      const c = source[i++];
      out += c;
      if (c === '\\') { out += source[i++] ?? ''; continue; }
      if (c === '\n') return;
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
    }
    while (/[a-z]/i.test(source[i] ?? '')) out += source[i++];
  }
  // untilBrace: テンプレートの ${ … } の中（対応する } で戻る）
  function code(untilBrace) {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      const next = source[i + 1];
      if (c === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
      if (c === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2);
        const stop = end < 0 ? source.length : end + 2;
        // 行番号がずれないよう、コメントの中の改行は残す
        out += ` ${source.slice(i, stop).replace(/[^\n]/g, '')}`;
        i = stop;
        continue;
      }
      if (c === '\'' || c === '"') { quoted(c); prev = c; continue; }
      if (c === '`') { template(); prev = '`'; continue; }
      if (c === '/' && (regexAfter.test(prev) || keywordBefore.test(out.slice(-12)))) { regex(); prev = '/'; continue; }
      if (c === '{') depth++;
      if (c === '}') {
        if (untilBrace && depth === 0) { out += c; i++; return; }
        depth--;
      }
      out += c;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  }
  code(false);
  return out;
}

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await filesIn(url));
    else if (entry.name.endsWith('.js')) files.push(url);
  }
  return files;
}

test('文言: コメントの除き方（文字列・テンプレート・正規表現の中の // や /* は残し、コメントだけを除く）', () => {
  const source = [
    "// 生まれる（行のコメント）",
    "const a = 'http://example.test/*x*/'; /* 新しい版（範囲のコメント） */",
    'const b = `${a // 設定タブ（テンプレートの中のコメント）\n}// 残す`;',
    'const c = /\\/\\/ 残す/g.test(a) ? 1 / 2 : 3; // 参加だけ',
    "const d = x / y / z; // グローバルボックス",
    "if (a) return /[/]産まれる/.source; /* 名前を変更 */",
  ].join('\n');
  const stripped = stripComments(source);
  for (const [word] of BANNED) assert.doesNotMatch(stripped, new RegExp(word), word);
  for (const kept of ["'http://example.test/*x*/'", '}// 残す`', '/\\/\\/ 残す/g', '1 / 2', 'x / y / z', '/[/]産まれる/.source']) {
    assert.ok(stripped.includes(kept), kept);
  }
});

test('文言: web/js の画面の文に、用語表で使わないと決めた言い回しがない（コメント・配った通知の履歴は除く）', async () => {
  const root = new URL('../../web/js/', import.meta.url);
  const found = [];
  for (const file of await filesIn(root)) {
    const path = `web/js/${decodeURIComponent(file.pathname.slice(root.pathname.length))}`;
    if (ALLOWED.has(path)) continue;
    const lines = stripComments(await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      for (const [word, instead] of BANNED) if (line.includes(word)) found.push(`${path}:${index + 1}: 「${word}」→「${instead}」`);
    });
  }
  assert.deepEqual(found, []);
});

test('文言: 配った通知の履歴（release-notes.js）は許可リストにあり、ほかのファイルは許可しない', async () => {
  assert.deepEqual([...ALLOWED], ['web/js/release-notes.js']);
  // 許可リストのファイルは実在する（名前を変えたら許可リストも直す）
  await readFile(new URL('../../web/js/release-notes.js', import.meta.url), 'utf8');
});
