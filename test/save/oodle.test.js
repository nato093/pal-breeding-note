// oodle.js のテスト。実行: node --test oodle.test.mjs
// 実データ（Palworld のセーブ）は testdata ディレクトリがあるときだけ使う（リポジトリには含めない）。
// testdata の場所は環境変数 OODLE_TESTDATA、なければ ./testdata/ または ../testdata/ を探す。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decompressOodle } from '../../web/js/save/oodle.js';
import * as E from './oodle-test-encoder.js';
import { buildCase, codecCases } from './oodle-test-encoder.js';

const sha1 = (b) => createHash('sha1').update(b).digest('hex');
const isOodleError = (e) => e instanceof Error && /^(Oodle データが壊れています|未対応の Oodle 形式)/.test(e.message);

function findTestdata() {
  const cands = [
    process.env.OODLE_TESTDATA,
    fileURLToPath(new URL('./testdata/', import.meta.url)),
    fileURLToPath(new URL('../testdata/', import.meta.url)),
  ].filter(Boolean);
  return cands.find((d) => existsSync(d)) ?? null;
}
const TESTDATA = findTestdata();

// .sav: 0-3 展開後サイズ, 4-7 圧縮サイズ, 8-10 'PlM', 11 保存形式, 12〜 Oodle ストリーム
function readSav(path) {
  const d = readFileSync(path);
  assert.equal(d.toString('latin1', 8, 11), 'PlM', 'PlM 形式のセーブではない');
  const raw = d.readUInt32LE(0);
  const comp = d.readUInt32LE(4);
  return { raw, stream: new Uint8Array(d.buffer, d.byteOffset + 12, comp) };
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

// 壊れた入力: 例外（Oodle のエラー）か、正しい長さの出力のどちらかでなければならない
function decodeCorrupt(stream, raw, label) {
  try {
    const out = decompressOodle(stream, raw);
    assert.equal(out.length, raw, label);
    return 'ok';
  } catch (e) {
    assert.ok(isOodleError(e), `${label}: 想定外の例外 ${e && e.constructor && e.constructor.name}: ${e && e.message}`);
    return 'error';
  }
}

function mutate(stream, r, kind) {
  const m = stream.slice();
  const n = 1 + (r() % 3);
  for (let i = 0; i < n; i++) {
    const p = r() % m.length;
    if (kind === 'flip') m[p] ^= 1 << (r() % 8);
    else m[p] = r() & 255;
  }
  return m;
}

// codecCases() の各ストリームの SHA-1（エンコーダーが変わっていないことの確認用）
const PINNED = new Map(Object.entries({
  'kraken {"mode":0,"scaling":0} entropy=stored data=text n=70000': 'fd44a7ae9a59569668113f91ae8c0a1960985cc3',
  'mermaid {"mode":0,"off16Entropy":false,"preferFar":true} entropy=stored data=skew n=140000': '98db933675880d1ea589744c1746f7d2a58e9962',
  'leviathan {"mode":0,"scaling":0,"multiCmd":true} entropy=stored data=records n=60000': '2cec35d3540b33b9062eb57f500640eb2f33af7c',
  'entropy-only {"codec":"kraken"} entropy=stored data=runs n=30000': '8d559ea5638de49be5efa365c641bde4298b0c9d',
  'kraken {"mode":1,"scaling":1} entropy=huff data=skew n=73001': 'b6f11ee4dfd17ac1ebb5320c77adbe0f53a0708f',
  'mermaid {"mode":0,"off16Entropy":true,"preferFar":false} entropy=huff data=records n=142003': 'cfa321d71609318266ae3d00f31133cabfc9b5ee',
  'leviathan {"mode":1,"scaling":1,"multiCmd":false} entropy=huff data=runs n=64001': 'a4107b080fd5c36a733a513e6b692951cd7b6ad0',
  'entropy-only {"codec":"mermaid"} entropy=huff data=repeats n=30997': 'f05d2bc4966c50c1009ee228bff4fdba53fdcaf6',
  'kraken {"mode":0,"scaling":77} entropy=huff2 data=records n=76002': 'be21a51e6952b6cc84d5a28aa8f8d1033314a666',
  'mermaid {"mode":1,"off16Entropy":false,"preferFar":false} entropy=huff2 data=runs n=144006': '8e089b490eaea12210c8ceada0f2b4697a974c84',
  'leviathan {"mode":2,"scaling":50,"multiCmd":true} entropy=huff2 data=repeats n=68002': '495c22720fb0fd865e473d2a8a2ee1105b459721',
  'entropy-only {"codec":"leviathan"} entropy=huff2 data=text n=31994': 'a524fd8c46cb00348f5ef78eae83427e772dc4fd',
  'kraken {"mode":1,"scaling":0} entropy=huffOld data=runs n=79003': '8451fcb2083563757d66d30cdca2da8a609adffb',
  'mermaid {"mode":1,"off16Entropy":true,"preferFar":true} entropy=huffOld data=repeats n=146009': '30cea766432a070cd1b56c6253aadb1b0248af31',
  'leviathan {"mode":3,"scaling":0,"multiCmd":false} entropy=huffOld data=text n=72003': '8645bd497f6f65b10e4353d6fe4e60ad1d105b63',
  'entropy-only {"codec":"kraken"} entropy=huffOld data=skew n=32991': '3cf61a15be24f70a7a176f2c64b7c7522b823ceb',
  'kraken {"mode":0,"scaling":1} entropy=huffSparse data=repeats n=82004': '0655718bc280f15e9236f4b19e9f22c118d2e1a3',
  'mermaid {"mode":0,"off16Entropy":false,"preferFar":false} entropy=huffSparse data=text n=148012': '446d74f482398ba1a52f06b2ea3252fa178e9724',
  'leviathan {"mode":4,"scaling":1,"multiCmd":true} entropy=huffSparse data=skew n=76004': '6ffeb47f900427f82e303ce947437aa323c6ff7e',
  'entropy-only {"codec":"mermaid"} entropy=huffSparse data=records n=33988': '0eca1eccc536a7e4e75c8137e4faf0f942edee1a',
  'kraken {"mode":1,"scaling":77} entropy=tans data=text n=85005': 'd08f8dfe0ca96870b25fbfa6e9755d1e1c2e2e65',
  'mermaid {"mode":0,"off16Entropy":true,"preferFar":false} entropy=tans data=skew n=150015': '9dd02412e69a0e8cb5b45c34d648d33fa469f7ab',
  'leviathan {"mode":5,"scaling":50,"multiCmd":false} entropy=tans data=records n=80005': 'b143749d49d6ea7255c28ecce872999c3206c16f',
  'entropy-only {"codec":"leviathan"} entropy=tans data=runs n=34985': 'a4b5791fa11650c9833709bd39b5d7d51cb1ff79',
  'kraken {"mode":0,"scaling":0} entropy=tansSparse data=skew n=88006': 'd8aec10437745b22b87269cf1bee734795051ce9',
  'mermaid {"mode":1,"off16Entropy":false,"preferFar":true} entropy=tansSparse data=records n=152018': 'a15877f5732ec02218474b6bb2cb15e342ec130e',
  'leviathan {"mode":0,"scaling":0,"multiCmd":true} entropy=tansSparse data=runs n=84006': '26ef6b0cdcb05c3ef5395c4cea781f0ee144f813',
  'entropy-only {"codec":"kraken"} entropy=tansSparse data=repeats n=35982': 'fa553e030003b2a154f160474e541980846f1d05',
  'kraken {"mode":1,"scaling":1} entropy=rle data=records n=91007': '17e0f2522dc791e4105ef92b74044f89b775c266',
  'mermaid {"mode":1,"off16Entropy":true,"preferFar":false} entropy=rle data=runs n=154021': '3334ac5ccb2936a7425ba1a6f110e43fa14b1ab7',
  'leviathan {"mode":1,"scaling":1,"multiCmd":false} entropy=rle data=repeats n=88007': '4a1a8750456325219e8ebf19f7eb4a0cc5eb68f1',
  'entropy-only {"codec":"mermaid"} entropy=rle data=text n=36979': '16c590cfbc4f88d8794eea6ad48c27c16aa1549f',
  'kraken {"mode":0,"scaling":77} entropy=rlePrefix data=runs n=94008': 'b8e317f68a26200d4fbfa4b99a80f59f56a8602f',
  'mermaid {"mode":0,"off16Entropy":false,"preferFar":false} entropy=rlePrefix data=repeats n=156024': '84432fd7816bb563e00d196b8903dae414d388ee',
  'leviathan {"mode":2,"scaling":50,"multiCmd":true} entropy=rlePrefix data=text n=92008': '139459dfd1d61a6dde531ecbdb54d7a7f46d1ccd',
  'entropy-only {"codec":"leviathan"} entropy=rlePrefix data=skew n=37976': 'd6442ae77b28b67201cb472224f70b144a1b865c',
  'kraken {"mode":1,"scaling":0} entropy=recursive data=repeats n=97009': 'c1d2a02e29b99267daba6e5bfe3f46bc1ae49361',
  'mermaid {"mode":0,"off16Entropy":true,"preferFar":true} entropy=recursive data=text n=158027': 'f3427ad867a7cfd455d4c16fd4c47bba06e36e7f',
  'leviathan {"mode":3,"scaling":0,"multiCmd":false} entropy=recursive data=skew n=96009': 'b3cd0dcd71da289aebc8f0a205b6b716f8424114',
  'entropy-only {"codec":"kraken"} entropy=recursive data=records n=38973': 'a079129ff54f387eb59e4f9d6c7f78cc1e1192df',
  'kraken {"mode":0,"scaling":1} entropy=multi data=text n=100010': 'e00b652f67d58640724257d6644533290c74d1ae',
  'mermaid {"mode":1,"off16Entropy":false,"preferFar":false} entropy=multi data=skew n=160030': 'dc937333d957a77b88b433a0d7d30efb83f84494',
  'leviathan {"mode":4,"scaling":1,"multiCmd":true} entropy=multi data=records n=100010': '482b83a3c58acc83688c0d1e9b6fa901b2705c95',
  'entropy-only {"codec":"mermaid"} entropy=multi data=runs n=39970': '7c69a5ba30e81b7929b3a08004e034c7cd848c02',
  'leviathan {"mode":0,"scaling":0,"multiCmd":false} entropy=huff data=repeats n=300000': '37da6ce5b79eee492c8ecb156b52d4beecb8c68a',
  'leviathan {"mode":1,"scaling":0,"multiCmd":true} entropy=huff data=repeats n=300000': 'acb9b02b27a75cf9860f6a01b03931d7eeaae093',
  'leviathan {"mode":2,"scaling":0,"multiCmd":false} entropy=huff data=repeats n=300000': '2f0fc470a62f8bcb66716c3d20f2f8ef397accba',
  'leviathan {"mode":3,"scaling":0,"multiCmd":true} entropy=huff data=repeats n=300000': '181faa8e567d655f9dda11153f0c6ed06931b7a8',
  'leviathan {"mode":4,"scaling":0,"multiCmd":false} entropy=huff data=repeats n=300000': '8759b20aad323f78f024b5bb2c1466bc9b02b432',
  'leviathan {"mode":5,"scaling":0,"multiCmd":true} entropy=huff data=repeats n=300000': '2aa62269a4b4302519d41dabd8744cde33c2626b',
  'kraken {"mode":0,"scaling":0,"entropyOnlyEvery":2} entropy=huffOld data=text n=600000': '7f4cb5300b90e679a0ed4611415b0d5f15303ce5',
  'mermaid {"mode":0,"off16Entropy":true} entropy=tans data=runs n=600000': '77c88f5323f3129b945afabc8337349f44303b27',
}));

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe('実データ（testdata）', { skip: TESTDATA ? false : 'testdata ディレクトリがない' }, () => {
  const files = TESTDATA ? readdirSync(TESTDATA).filter((f) => f.endsWith('.sav') && existsSync(`${TESTDATA}/${f}.raw`)).sort() : [];
  for (const f of files) {
    test(f, () => {
      const { raw, stream } = readSav(`${TESTDATA}/${f}`);
      const ref = readFileSync(`${TESTDATA}/${f}.raw`);
      const t = performance.now();
      const out = decompressOodle(stream, raw);
      const ms = performance.now() - t;
      assert.equal(out.length, ref.length);
      const diff = firstDiff(out, ref);
      assert.equal(diff, -1, `出力が ${diff} バイト目から異なる`);
      assert.equal(sha1(out), sha1(ref));
      console.log(`  ${f}: ${stream.length} -> ${raw} bytes, ${ms.toFixed(1)} ms`);
    });
  }
});

describe('壊れた実データ', { skip: TESTDATA ? false : 'testdata ディレクトリがない' }, () => {
  for (const [f, flips] of [['LevelMeta.sav', 300], ['Level.sav', 40]]) {
    test(`${f}: 切り詰め`, { skip: TESTDATA && existsSync(`${TESTDATA}/${f}`) ? false : 'ファイルがない' }, () => {
      const { raw, stream } = readSav(`${TESTDATA}/${f}`);
      const cuts = [0, 1, 2, 4, 5, 6, 12, 100, stream.length >> 2, stream.length >> 1, stream.length - 2, stream.length - 1];
      for (const n of cuts) {
        assert.throws(() => decompressOodle(stream.subarray(0, n), raw), isOodleError, `${n} バイトに切り詰め`);
      }
    });
    test(`${f}: ランダムなビット反転・バイト書き換え・サイズ違い`, { timeout: 120000, skip: TESTDATA && existsSync(`${TESTDATA}/${f}`) ? false : 'ファイルがない' }, () => {
      const { raw, stream } = readSav(`${TESTDATA}/${f}`);
      const r = E.rng(12345);
      for (let i = 0; i < flips; i++) decodeCorrupt(mutate(stream, r, i & 1 ? 'flip' : 'byte'), raw, `変異 ${i}`);
      for (const d of [-1000, -1, 1, 1000]) decodeCorrupt(stream, raw + d, `rawSize ${d}`);
      assert.throws(() => decompressOodle(stream, raw + 1), isOodleError);
    });
  }
});

describe('ストリームの構造（手作り）', () => {
  const bytes = (n, seed = 1) => { const r = E.rng(seed); return Uint8Array.from({ length: n }, () => r() & 255); };

  test('無圧縮ブロック（1 ブロック / 複数ブロック）', () => {
    const a = bytes(100);
    assert.deepEqual(decompressOodle(E.concat([Uint8Array.of(0xCC, 0x06), a]), 100), a);
    const b = bytes(0x40000 + 5000, 2);
    const s = E.concat([Uint8Array.of(0x4C, 0x0A), b.subarray(0, 0x40000), Uint8Array.of(0x4C, 0x0A), b.subarray(0x40000)]);
    assert.deepEqual(decompressOodle(s, b.length), b);
  });

  test('memset クォンタム', () => {
    const s = E.concat([Uint8Array.of(0x8C, 0x0A, 0x07, 0xFF, 0xFF, 0x42), Uint8Array.of(0x8C, 0x06, 0x07, 0xFF, 0xFF, 0x07)]);
    const out = decompressOodle(s, 0x40000 + 10);
    assert.ok(out.subarray(0, 0x40000).every((x) => x === 0x42));
    assert.ok(out.subarray(0x40000).every((x) => x === 0x07));
  });

  test('圧縮サイズ = 展開サイズのクォンタム（無圧縮で格納）', () => {
    const a = bytes(5000, 3);
    assert.deepEqual(decompressOodle(E.concat([Uint8Array.of(0x8C, 0x0A, 0x00, 0x13, 0x87), a]), 5000), a);
  });

  test('クォンタム内の raw チャンク・2 チャンク', () => {
    const a = E.concat([new Uint8Array(0x20000).fill(9), bytes(0x10000, 4)]);
    const s = E.oodleStream(a, 0x06, E.krakenChunkEncoder({ mode: 1 }));
    assert.deepEqual(decompressOodle(s, a.length), a);
  });

  test('チェックサムフラグ（クォンタムヘッダの後の 3 バイトを読み飛ばす）', () => {
    const a = new Uint8Array(100).fill(7);
    const s = E.concat([Uint8Array.of(0x8C, 0x8A, 0x00, 0x00, 0x63, 0xAA, 0xBB, 0xCC), a]);
    assert.deepEqual(decompressOodle(s, 100), a);
    // memset クォンタムにはチェックサムがない
    assert.ok(decompressOodle(Uint8Array.of(0x8C, 0x8A, 0x07, 0xFF, 0xFF, 0x41), 10).every((x) => x === 0x41));
  });

  test('16KB クォンタム（LZNA / Bitknit 用のヘッダ）の memset・無圧縮・whole match', () => {
    const q = bytes(0x4000, 5);
    // memset
    assert.ok(decompressOodle(Uint8Array.of(0x8C, 0x05, 0x7F, 0xFF, 0x42), 0x4000).every((x) => x === 0x42));
    // 無圧縮 + whole match（距離 0x4000）
    const s1 = E.concat([Uint8Array.of(0x8C, 0x05, 0xBF, 0xFF), q, Uint8Array.of(0x3F, 0xFF, 0xBF, 0xFF)]);
    assert.deepEqual(decompressOodle(s1, 0x8000), E.concat([q, q]));
    // 重なりのある whole match（距離 16）は前から複写した結果になる
    const s2 = E.concat([Uint8Array.of(0x8C, 0x0B, 0xBF, 0xFF), q, Uint8Array.of(0x3F, 0xFF, 0x80, 0x0F)]);
    const out = decompressOodle(s2, 0x4000 + 100);
    for (let i = 0; i < 100; i++) assert.equal(out[0x4000 + i], q[0x4000 - 16 + (i % 16)]);
    // 長い距離（可変長）
    const big = bytes(0x40000 - 0x4000, 6);
    const parts = [Uint8Array.of(0x8C, 0x05)];
    for (let o = 0; o < big.length; o += 0x4000) parts.push(Uint8Array.of(0xBF, 0xFF), big.subarray(o, o + 0x4000));
    const dist = big.length; // 0x3C000: w < 0x8000 の形式
    const x = Math.floor((dist - 1 - 0x8000) / 0x8000);
    const w = dist - 1 - 0x8000 - x * 0x8000;
    parts.push(Uint8Array.of(0x3F, 0xFF, w >> 8, w & 255, 0x80 + x));
    const out2 = decompressOodle(E.concat(parts), big.length + 0x4000);
    assert.deepEqual(out2.subarray(big.length), big.subarray(0, 0x4000));
  });

  test('未対応の形式（LZNA / Bitknit の圧縮クォンタム、不明な種類）', () => {
    assert.throws(() => decompressOodle(Uint8Array.of(0x8C, 0x05, 0x00, 0x03, 1, 2, 3, 4), 100), /未対応の Oodle 形式: LZNA/);
    assert.throws(() => decompressOodle(Uint8Array.of(0x8C, 0x0B, 0x00, 0x03, 1, 2, 3, 4), 100), /未対応の Oodle 形式: Bitknit/);
    assert.throws(() => decompressOodle(Uint8Array.of(0x8C, 0x07, 0x00, 0x00, 0x03, 1, 2, 3, 4), 100), /未対応の Oodle 形式/);
  });

  test('末尾の余分なバイトは無視する・rawSize 0', () => {
    const a = bytes(300, 7);
    assert.deepEqual(decompressOodle(E.concat([Uint8Array.of(0xCC, 0x06), a, bytes(50, 8)]), 300), a);
    assert.equal(decompressOodle(new Uint8Array(0), 0).length, 0);
  });

  test('入力の型（ArrayBuffer / Buffer / DataView / 部分ビュー）と引数の検査', () => {
    const a = bytes(64, 9);
    const s = E.concat([Uint8Array.of(0xCC, 0x06), a]);
    assert.deepEqual(decompressOodle(s.buffer.slice(0), 64), a);
    assert.deepEqual(decompressOodle(Buffer.from(s), 64), a);
    assert.deepEqual(decompressOodle(new DataView(s.buffer), 64), a);
    const padded = E.concat([Uint8Array.of(1, 2, 3), s]);
    assert.deepEqual(decompressOodle(padded.subarray(3), 64), a);
    assert.throws(() => decompressOodle('abc', 3), TypeError);
    assert.throws(() => decompressOodle(s, -1), RangeError);
    assert.throws(() => decompressOodle(s, 1.5), RangeError);
    // 入力に対して明らかに大きすぎる rawSize は確保の前に失敗する
    assert.throws(() => decompressOodle(s, 0x7FFFFFFF), isOodleError);
  });

  test('ヘッダの異常', () => {
    assert.throws(() => decompressOodle(Uint8Array.of(0x8D, 0x06, 0, 0, 0), 10), isOodleError);
    assert.throws(() => decompressOodle(Uint8Array.of(0x9C, 0x06, 0, 0, 0), 10), isOodleError);
    assert.throws(() => decompressOodle(Uint8Array.of(0x8C, 0x06, 0x0B, 0xFF, 0xFF, 0), 10), isOodleError);
    assert.throws(() => decompressOodle(Uint8Array.of(0x8C, 0x06, 0x00, 0x00, 0x05, 0x80, 0x00, 0x02, 1, 2, 3), 10), isOodleError);
  });
});

describe('合成ストリーム（Kraken / Mermaid / Leviathan × 各エントロピー符号）', () => {
  const cases = codecCases();
  const built = new Map();
  for (const c of cases) {
    test(c.name, () => {
      const { data, stream } = buildCase(c);
      built.set(c.name, stream);
      const out = decompressOodle(stream, data.length);
      const diff = firstDiff(out, data);
      assert.equal(diff, -1, `出力が ${diff} バイト目から異なる`);
      if (PINNED.size) assert.equal(sha1(stream), PINNED.get(c.name), 'エンコーダーの出力が確認済みのものと違う');
    });
  }
  test('壊れた合成ストリーム', { timeout: 120000 }, () => {
    const r = E.rng(777);
    let errors = 0;
    for (const c of cases.filter((x) => x.size < 200000)) {
      const stream = built.get(c.name) ?? buildCase(c).stream;
      for (let i = 0; i < 25; i++) if (decodeCorrupt(mutate(stream, r, i & 1 ? 'flip' : 'byte'), c.size, c.name) === 'error') errors++;
      for (const n of [0, 3, stream.length >> 1, stream.length - 1]) {
        assert.throws(() => decompressOodle(stream.subarray(0, n), c.size), isOodleError, `${c.name}: ${n} バイトに切り詰め`);
      }
    }
    assert.ok(errors > 0);
  });
});

describe('遠い距離', () => {
  // X ... 0 ... [X 前半][乱数][X 後半]: 距離が 8MB を超える一致（Kraken/Leviathan の 0xF0 以上の距離符号、
  // Mermaid の 0xC00000 以上の遠距離オフセット）を作る。間は memset クォンタムになる。
  function farData(total, seed) {
    const r = E.rng(seed);
    const X = Uint8Array.from({ length: 65536 }, () => r() & 255);
    const d = new Uint8Array(total);
    d.set(X, 0);
    const tail = total - 65536 - 1024;
    d.set(X.subarray(0, 32768), tail);
    for (let i = 0; i < 1024; i++) d[tail + 32768 + i] = r() & 255;
    d.set(X.subarray(32768), tail + 32768 + 1024);
    return d;
  }
  const enc = E.makeEncoder('huff', E.rng(3));
  const prehash = [[0, 65536]];
  const nine = farData(9 << 20, 1);
  const thirteen = farData(13 << 20, 2);
  const cases = [
    ['Kraken 9MB mode 0', () => E.oodleStream(nine, 0x06, E.krakenChunkEncoder({ mode: 0, enc, prehash })), nine],
    ['Kraken 9MB scaling 77', () => E.oodleStream(nine, 0x06, E.krakenChunkEncoder({ mode: 1, enc, scaling: 77, prehash })), nine],
    ['Leviathan 9MB', () => E.oodleStream(nine, 0x0C, E.leviathanChunkEncoder({ mode: 1, enc, prehash })), nine],
    ['Mermaid 13MB mode 0', () => E.oodleStream(thirteen, 0x0A, E.mermaidChunkEncoder({ mode: 0, enc, prehash })), thirteen],
  ];
  for (const [name, mk, data] of cases) {
    test(name, { timeout: 60000 }, () => {
      const out = decompressOodle(mk(), data.length);
      assert.equal(firstDiff(out, data), -1);
    });
  }
  test('Mermaid: 64KB 内に 4095 個を超える遠距離オフセット', () => {
    const r = E.rng(9);
    const A = Uint8Array.from({ length: 0x20000 }, () => r() & 255);
    const d = new Uint8Array(0x60000);
    d.set(A, 0);
    for (let o = 0x20000; o < d.length; o += 8) { const from = r() % (0x20000 - 8); d.set(A.subarray(from, from + 8), o); }
    const s = E.oodleStream(d, 0x0A, E.mermaidChunkEncoder({ mode: 1, preferFar: true }));
    assert.equal(firstDiff(decompressOodle(s, d.length), d), -1);
  });
});

