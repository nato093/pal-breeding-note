// ゲームの UI アイコンと作業適性の取り出し（scripts/extract-ui-icons.mjs・extract-work.mjs・game-tables.mjs。UI 改善フェーズ 4 の game-assets）。
// ゲーム本体は読まない（形の決まった小さなデータで、縮小・表の読み方・書き出した画像を確かめる）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { UI_ICONS, UI_ICONS_MAX_BYTES, downscale } from '../../scripts/extract-ui-icons.mjs';
import { readDataTable } from '../../scripts/game-tables.mjs';
import { buildWork } from '../../scripts/extract-work.mjs';
import { ELEMENTS } from '../../web/data/pals.js';
import { WORKS } from '../../web/data/work.js';

test('downscale: 面積の平均で縮め（透明な画素の色は混ぜない）、縦横比を保ち、元より大きくはしない', () => {
  // 4×4 → 2×2。左上の 2×2 は赤（不透明）と透明が半々、右上は青、下半分は白
  const rgba = Buffer.alloc(4 * 4 * 4);
  const put = (x, y, [r, g, b, a]) => rgba.set([r, g, b, a], (y * 4 + x) * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) put(x, y, y >= 2 ? [255, 255, 255, 255] : x >= 2 ? [0, 0, 255, 255] : [0, 0, 0, 0]);
  put(0, 0, [255, 0, 0, 255]);
  put(1, 1, [255, 0, 0, 255]);
  const small = downscale(rgba, 4, 4, 2);
  assert.deepEqual([small.width, small.height], [2, 2]);
  // 赤が 2 画素・透明が 2 画素 → 色は赤のまま、アルファは半分（透明の黒で暗くならない）
  assert.deepEqual([...small.rgba.subarray(0, 4)], [255, 0, 0, 128]);
  assert.deepEqual([...small.rgba.subarray(4, 8)], [0, 0, 255, 255]);
  assert.deepEqual([...small.rgba.subarray(8, 12)], [255, 255, 255, 255]);
  // 縦横比を保つ（長い方の辺を size に）・元より大きくしない
  assert.deepEqual((({ width, height }) => [width, height])(downscale(Buffer.alloc(8 * 4 * 4), 8, 4, 4)), [4, 2]);
  const same = downscale(rgba, 4, 4, 32);
  assert.equal(same.rgba, rgba);
});

// PNG の幅と高さ（IHDR）
const pngSize = (file) => {
  const b = fs.readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test('UI のアイコン: 表の全部が web/img/ にあり、大きさは表のとおり、合計は上限（200KB）以下。属性・作業適性の名前はマスターの鍵', () => {
  let total = 0;
  for (const [name, { size }] of Object.entries(UI_ICONS)) {
    const file = `web/img/${name}.png`;
    assert.ok(fs.existsSync(file), file);
    const [width, height] = pngSize(file);
    assert.ok(Math.max(width, height) <= size, `${file}: ${width}×${height}`);
    total += fs.statSync(file).size;
  }
  assert.ok(total <= UI_ICONS_MAX_BYTES, `合計 ${total} バイト`);
  assert.equal(UI_ICONS_MAX_BYTES, 200 * 1024);
  // web/img/{element,work,item,ui}/ には表にない画像を置かない（撤回は 4 つのフォルダを消すだけ）
  const files = ['element', 'work', 'item', 'ui'].flatMap((dir) => fs.readdirSync(`web/img/${dir}`).map((file) => `${dir}/${file.replace(/\.png$/, '')}`));
  assert.deepEqual(files.sort(), Object.keys(UI_ICONS).sort());
  const keysIn = (dir) => Object.keys(UI_ICONS).filter((name) => name.startsWith(`${dir}/`)).map((name) => name.slice(dir.length + 1)).sort();
  assert.deepEqual(keysIn('element'), Object.keys(ELEMENTS).sort());
  assert.deepEqual(keysIn('work'), Object.keys(WORKS).filter((key) => WORKS[key].icon).sort());
  for (const key of Object.keys(WORKS)) if (WORKS[key].icon) assert.equal(WORKS[key].icon, `${key}.png`);
  // 性別は 2 つ、ケーキは 5 つ、タマゴは 12（属性 10・突然変異・中身不明）
  assert.deepEqual(keysIn('ui'), ['breed-farm', 'gender-F', 'gender-M']);
  assert.equal(keysIn('item').filter((name) => name.startsWith('cake-')).length, 5);
  assert.equal(keysIn('item').filter((name) => name.startsWith('egg-')).length, 12);
});

// 型の情報のない DataTable の 1 行（断片の並び 1 つ: 飛ばす 0・既定値なし・最後・数 n）と、末尾の 4 バイト
function table(names, rows) {
  const parts = [Buffer.from([0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]), Buffer.alloc(4)];
  parts[1].writeInt32LE(rows.length, 0);
  for (const [name, values] of rows) {
    const head = Buffer.alloc(10);
    head.writeInt32LE(names.indexOf(name), 0);
    head.writeUInt16LE((values.length << 9) | 0x100, 8);
    const body = Buffer.alloc(values.length * 4);
    values.forEach((value, i) => body.writeInt32LE(value, i * 4));
    parts.push(head, body);
  }
  parts.push(Buffer.alloc(4));
  return Buffer.concat(parts);
}

test('readDataTable: プロパティの並びで行を読み、keep で残す列を限る（作業適性だけを残し、配合の値は捨てる。INV-2）。読み切れなければ投げる', () => {
  const schema = [{ name: 'CombiRank', type: 'Int' }, { name: 'WorkSuitability_Mining', type: 'Int' }, { name: 'WorkSuitability_Cool', type: 'Int' }];
  const names = ['Anubis', 'PinkCat'];
  const uexp = table(names, [['Anubis', [470, 6, 0]], ['PinkCat', [1460, 1, 2]]]);
  const rows = readDataTable(schema, uexp, names, { keep: (name) => name.startsWith('WorkSuitability_') });
  assert.deepEqual([...rows], [
    ['Anubis', { WorkSuitability_Mining: 6, WorkSuitability_Cool: 0 }],
    ['PinkCat', { WorkSuitability_Mining: 1, WorkSuitability_Cool: 2 }],
  ]);
  // 並びが合わない（列が足りない）と、最後まで読み切れない
  assert.throws(() => readDataTable(schema.slice(0, 2), uexp, names), /読み切れませんでした|範囲外/);
  // 作業適性の形: 作業の鍵 → 1 以上の整数だけ。どのパルも持たない作業（Cool が 0 だけなら）は外す。マスターの ID で引く（大文字小文字をそろえる）
  const { work, keys, missing } = buildWork(new Map([
    ['Anubis', { WorkSuitability_Mining: 6, WorkSuitability_Cool: 0, CombiRank: 470 }],
    ['pinkcat', { WorkSuitability_Mining: 1 }],
  ]), ['WorkSuitability_Mining', 'WorkSuitability_Cool'], ['Anubis', 'PinkCat', 'NotInTable']);
  assert.deepEqual(work, { Anubis: { Mining: 6 }, PinkCat: { Mining: 1 } });
  assert.deepEqual(keys, ['Mining']);
  assert.deepEqual(missing, ['NotInTable']);
});

// 行の中身を手で組んだ DataTable（行の名前の後ろに body をそのまま置く）
function rawTable(names, rows) {
  const head = Buffer.from([0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, rows.length, 0, 0, 0]);
  const parts = [head];
  for (const [name, body] of rows) {
    const key = Buffer.alloc(8);
    key.writeInt32LE(names.indexOf(name), 0);
    parts.push(key, body);
  }
  parts.push(Buffer.alloc(4));
  return Buffer.concat(parts);
}
const u16 = (...values) => Buffer.from(values.flatMap((v) => [v & 0xff, v >> 8]));
const i32 = (...values) => Buffer.concat(values.map((v) => { const b = Buffer.alloc(4); b.writeInt32LE(v, 0); return b; }));

test('readDataTable: 断片の並び（飛ばす・既定値の印・最後）と既定値のビット列（1 バイト・2 バイト）を読む', () => {
  // 断片 1: A を飛ばし、B・C・D は既定値の印つき（C だけ既定値＝値なし）。断片 2: E（最後）
  const five = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, type: 'Int' }));
  const body = Buffer.concat([u16(1 | 0x80 | (3 << 9), 0x100 | (1 << 9)), Buffer.from([0b010]), i32(7, 9, 11)]);
  assert.deepEqual([...readDataTable(five, rawTable(['Row'], [['Row', body]]), ['Row'])], [['Row', { B: 7, D: 9, E: 11 }]]);
  // 既定値の印が 9〜16 個なら 2 バイト（P0 と P9 が既定値）
  const ten = Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, type: 'Int' }));
  const body10 = Buffer.concat([u16(0x80 | 0x100 | (10 << 9)), Buffer.from([0b1, 0b10]), i32(1, 2, 3, 4, 5, 6, 7, 8)]);
  assert.deepEqual(readDataTable(ten, rawTable(['Row'], [['Row', body10]]), ['Row']).get('Row'), { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5, P6: 6, P7: 7, P8: 8 });
  // 配列（要素の型は inner）・名前（FName）・真偽
  const mixed = [{ name: 'Tags', type: 'Array', inner: { name: 'Tags', type: 'Name' } }, { name: 'On', type: 'Bool' }];
  const names = ['Row', 'Fire', 'Ice'];
  const bodyMixed = Buffer.concat([u16(0x100 | (2 << 9)), i32(2, 1, 0, 2, 0), Buffer.from([1])]);
  assert.deepEqual(readDataTable(mixed, rawTable(names, [['Row', bodyMixed]]), names).get('Row'), { Tags: ['Fire', 'Ice'], On: true });
  // 知らない型（入れ子の構造体など）は、読み方を渡すまで止まる
  assert.throws(() => readDataTable([{ name: 'Pos', type: 'Struct' }], rawTable(['Row'], [['Row', u16(0x100 | (1 << 9))]]), ['Row']), /overrides/);
});
