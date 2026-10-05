// oodle.js のテスト専用: 簡易 Oodle エンコーダー（Kraken / Mermaid / Leviathan と各種エントロピー符号）。
// 圧縮率は気にせず、展開器のさまざまな経路を通るストリームを作るためのもの。
// このエンコーダーで作ったストリームは、開発時に pyooz と oozextract 0.4.2 でも展開して内容が一致することを確認している。

export function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function rng(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

const ilog2 = (x) => 31 - Math.clz32(x);

// ---------------------------------------------------------------------------
// ビットライター
// ---------------------------------------------------------------------------

export class BitWriterMSB {
  constructor() { this.bytes = []; this.cur = 0; this.n = 0; }
  bit(b) { this.cur = (this.cur << 1) | (b & 1); if (++this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; } }
  write(v, nbits) { for (let i = nbits - 1; i >= 0; i--) this.bit((v >>> i) & 1); }
  finish() { if (this.n) { this.bytes.push((this.cur << (8 - this.n)) & 255); this.cur = 0; this.n = 0; } return Uint8Array.from(this.bytes); }
}

export class BitWriterLSB {
  constructor() { this.bytes = []; this.cur = 0; this.n = 0; }
  bit(b) { this.cur |= (b & 1) << this.n; if (++this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; } }
  write(v, nbits) { for (let i = 0; i < nbits; i++) this.bit((v >>> i) & 1); }
  code(c, len) { for (let i = len - 1; i >= 0; i--) this.bit((c >>> i) & 1); }
  finish() { if (this.n) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; } return Uint8Array.from(this.bytes); }
}

// ---------------------------------------------------------------------------
// エントロピーブロック（decode_bytes の形式）
// long = true のときは先頭バイトの最上位ビットが 0 になる形式にする
// ---------------------------------------------------------------------------

export function storedBlock(data, long = false) {
  const n = data.length;
  if (n > 0x3FFFF) return null;
  if (n <= 0xFFF && !long) return concat([Uint8Array.of(0x80 | (n >> 8), n & 255), data]);
  return concat([Uint8Array.of(n >> 16, (n >> 8) & 255, n & 255), data]);
}

export function blockHeader(type, srcSize, dstSize, long = false) {
  if (srcSize >= dstSize || dstSize > 0x40000) return null;
  if (!long && srcSize <= 0x3FF && dstSize - srcSize - 1 <= 0x3FF) {
    const bits = 0x800000 | (type << 20) | ((dstSize - srcSize - 1) << 10) | srcSize;
    return Uint8Array.of(bits >> 16, (bits >> 8) & 255, bits & 255);
  }
  const d = dstSize - 1;
  const w = (((d & 0x3FFF) << 18) | srcSize) >>> 0;
  return Uint8Array.of((type << 4) | (d >> 14), w >>> 24, (w >>> 16) & 255, (w >>> 8) & 255, w & 255);
}

function withHeader(type, payload, dstSize, long) {
  const h = blockHeader(type, payload.length, dstSize, long);
  return h ? concat([h, payload]) : null;
}

function writeUnary(bw, q) { for (let i = 0; i < q; i++) bw.bit(0); bw.bit(1); }

// convert_to_ranges 用: シンボル集合を [初期ギャップ][(範囲, ギャップ)]*[最終範囲] で表す
function symbolRanges(present) {
  const runs = [];
  for (let s = 0; s < 256; s++) {
    if (!present[s]) continue;
    const r = runs[runs.length - 1];
    if (r && r.end === s) r.end++; else runs.push({ start: s, end: s + 1 });
  }
  const items = []; // { v, bits, value }
  const gap = (g) => { const v = ilog2(g + 1) - 1; items.push({ v, bits: v + 1, value: g + 1 - (1 << (v + 1)) }); };
  const num = (n) => { const v = ilog2(n); items.push({ v, bits: v, value: n - (1 << v) }); };
  if (runs[0].start > 0) gap(runs[0].start);
  for (let i = 0; i < runs.length - 1; i++) { num(runs[i].end - runs[i].start); gap(runs[i + 1].start - runs[i].end); }
  return items; // fluff = items.length
}

function writeFluff(bw, fluff, numSymbols) {
  if (numSymbols === 256) { if (fluff !== 0) throw new Error('fluff'); return; }
  const x = Math.min(257 - numSymbols, numSymbols) * 2;
  if (fluff >= x) throw new Error('fluff range');
  const y = ilog2(x - 1) + 1;
  const z = (1 << y) - x;
  if (fluff < z) bw.write(fluff, y - 1);
  else bw.write(fluff + z, y);
}

// --- Huffman --------------------------------------------------------------

function huffLengths(freq, maxLen) {
  for (let scale = 0; scale < 32; scale++) {
    const items = [];
    for (let s = 0; s < 256; s++) if (freq[s]) items.push({ w: Math.max(1, Math.floor(freq[s] / 2 ** scale)), syms: [s] });
    if (items.length < 2) return null;
    const depth = new Int32Array(256);
    const nodes = items;
    while (nodes.length > 1) {
      nodes.sort((a, b) => a.w - b.w);
      const a = nodes.shift(), b = nodes.shift();
      for (const s of a.syms) depth[s]++;
      for (const s of b.syms) depth[s]++;
      nodes.push({ w: a.w + b.w, syms: a.syms.concat(b.syms) });
    }
    let mx = 0;
    for (let s = 0; s < 256; s++) mx = Math.max(mx, depth[s]);
    if (mx <= maxLen) return Uint8Array.from(depth);
  }
  return null;
}

// make_lut と同じ順で正準符号を割り当てる（order = 表に現れるシンボル順）
function canonicalCodes(len, order) {
  const code = new Int32Array(256);
  let slot = 0;
  for (let L = 1; L <= 11; L++) {
    for (const s of order) if (len[s] === L) { code[s] = slot >> (11 - L); slot += 1 << (11 - L); }
  }
  if (slot !== 2048) throw new Error('kraft');
  return code;
}

function huffTableNew(bw, len, F) {
  const present = Array.from(len, (l) => l > 0);
  const syms = [];
  for (let s = 0; s < 256; s++) if (present[s]) syms.push(s);
  const ranges = symbolRanges(present);
  const n = syms.length;
  bw.bit(1); bw.bit(0);
  bw.write(F, 2);
  bw.write(n - 1, 8);
  writeFluff(bw, ranges.length, n);
  let rs = 0x1e;
  const us = [];
  for (const s of syms) {
    const d = len[s] - ((rs >> 2) + 1);
    us.push(d >= 0 ? 2 * d : -2 * d - 1);
    rs += d;
  }
  for (const u of us) writeUnary(bw, u >> F);
  for (const it of ranges) writeUnary(bw, it.v);
  for (const u of us) bw.write(u & ((1 << F) - 1), F);
  for (const it of ranges) bw.write(it.value, it.bits);
  return syms;
}

function writeGamma2(bw, n) { // 値 r = n + 1 (>= 2) を lz 個の 0 + (lz + 2) ビットで
  const r = n + 1;
  const lz = ilog2(r) - 1;
  if (lz > 7) throw new Error('gamma');
  for (let i = 0; i < lz; i++) bw.bit(0);
  bw.write(r, lz + 2);
}

function huffTableOld(bw, len, F) {
  const present = (s) => len[s] > 0;
  bw.bit(0); bw.bit(1);
  bw.write(F, 2);
  bw.bit(present(0) ? 1 : 0);
  let sym = 0;
  let avg = 32;
  let first = true;
  while (sym < 256) {
    if (!(first && present(0))) {
      let run = 0;
      while (sym + run < 256 && !present(sym + run)) run++;
      writeGamma2(bw, run);
      sym += run;
      if (sym >= 256) break;
    }
    first = false;
    let cnt = 0;
    while (sym + cnt < 256 && present(sym + cnt)) cnt++;
    writeGamma2(bw, cnt);
    for (let i = 0; i < cnt; i++) {
      const c = len[sym + i];
      const d = c - ((avg + 2) >> 2);
      const v = d >= 0 ? 2 * d : -2 * d - 1;
      const lz = v >> F;
      if (lz >= (20 >> F)) throw new Error('old table range');
      for (let k = 0; k < lz; k++) bw.bit(0);
      bw.bit(1);
      bw.write(v & ((1 << F) - 1), F);
      avg = c + ((3 * avg + 2) >> 2);
    }
    sym += cnt;
  }
  const order = [];
  for (let s = 0; s < 256; s++) if (present(s)) order.push(s);
  return order;
}

function huffTableSparse(bw, len) {
  const order = [];
  for (let s = 0; s < 256; s++) if (len[s]) order.push(s);
  if (order.length > 255) throw new Error('sparse');
  let mx = 0;
  for (const s of order) mx = Math.max(mx, len[s]);
  let cb = 0;
  while ((1 << cb) < mx) cb++;
  if (cb > 4) throw new Error('sparse');
  bw.bit(0); bw.bit(0);
  bw.write(order.length, 8);
  bw.write(cb, 3);
  for (const s of order) { bw.write(s, 8); bw.write(len[s] - 1, cb); }
  return order;
}

// 3 本のストリーム（i % 3 = 0: 前方 A, 1: 後方 C, 2: 前方 B）を [A][B][C を逆順] に並べる
function huffStreams(data, len, code) {
  const ws = [new BitWriterLSB(), new BitWriterLSB(), new BitWriterLSB()];
  for (let i = 0; i < data.length; i++) ws[i % 3].code(code[data[i]], len[data[i]]);
  const a = ws[0].finish(), c = ws[1].finish().reverse(), b = ws[2].finish();
  if (a.length > 0xFFFF) throw new Error('split');
  return { a, b, c, bytes: concat([Uint8Array.of(a.length & 255, a.length >> 8), a, b, c]) };
}

export function huffmanBlock(data, { table = 'new', ways = 2, F = 1 } = {}, long = false) {
  const freq = new Int32Array(256);
  for (const x of data) freq[x]++;
  const len = huffLengths(freq, 11);
  if (!len) return null;
  try {
    const bw = new BitWriterMSB();
    const order = table === 'new' ? huffTableNew(bw, len, F) : table === 'old' ? huffTableOld(bw, len, F) : huffTableSparse(bw, len);
    const code = canonicalCodes(len, order);
    const tab = bw.finish();
    let payload;
    if (ways === 1) {
      payload = huffStreams(data, len, code).bytes;
      if (payload.length < 3) return null;
    } else {
      const half = (data.length + 1) >> 1;
      const s1 = huffStreams(data.subarray(0, half), len, code);
      const s2 = huffStreams(data.subarray(half), len, code);
      if (s2.b.length + s2.c.length < 2) return null;
      const m = s1.bytes.length;
      payload = concat([Uint8Array.of(m & 255, (m >> 8) & 255, m >> 16), s1.bytes, s2.bytes]);
    }
    return withHeader(ways === 1 ? 2 : 4, concat([tab, payload]), data.length, long);
  } catch {
    return null;
  }
}

// --- tANS -----------------------------------------------------------------

// init_lut と同じ表（エンコーダー側の再実装）
function tansTable(aSyms, bList, lBits) {
  const L = 1 << lBits;
  const lut = Array.from({ length: L }, () => ({ sym: 0, bx: 0, w: 0 }));
  const slotsLeft = L - aSyms.length;
  const pointers = [0, 0, 0, 0];
  const sa = slotsLeft >> 2;
  let sb = sa + ((slotsLeft & 3) > 0 ? 1 : 0); pointers[1] = sb;
  sb += sa + ((slotsLeft & 3) > 1 ? 1 : 0); pointers[2] = sb;
  sb += sa + ((slotsLeft & 3) > 2 ? 1 : 0); pointers[3] = sb;
  aSyms.forEach((s, i) => { lut[slotsLeft + i] = { sym: s, bx: lBits, w: 0 }; });
  let weightsSum = 0;
  for (const { sym, weight } of bList) {
    if (weight > 4) {
      const symBits = ilog2(weight);
      let z = lBits - symBits;
      const le = { sym, bx: z, w: (L - 1) & (weight << z) };
      let add = 1 << z;
      let x = (1 << (symBits + 1)) - weight;
      for (let j = 0; j < 4; j++) {
        let d = pointers[j];
        const y = (weight + ((weightsSum - j - 1) & 3)) >> 2;
        if (x >= y) {
          for (let k = 0; k < y; k++) { lut[d++] = { ...le }; le.w += add; }
          x -= y;
        } else {
          for (let k = 0; k < x; k++) { lut[d++] = { ...le }; le.w += add; }
          z--; add >>= 1; le.bx = z; le.w = 0;
          for (let k = 0; k < y - x; k++) { lut[d++] = { ...le }; le.w += add; }
          x = weight;
        }
        pointers[j] = d;
      }
    } else {
      let bits = ((1 << weight) - 1) << (weightsSum & 3);
      bits |= bits >> 4;
      let ww = weight;
      for (let k = 0; k < weight; k++) {
        const idx = ilog2(bits & -bits);
        bits &= bits - 1;
        const d = pointers[idx]++;
        const wb = ilog2(ww);
        lut[d] = { sym, bx: lBits - wb, w: (L - 1) & (ww << (lBits - wb)) };
        ww++;
      }
    }
    weightsSum += weight;
  }
  return lut;
}

// 頻度を合計 L の重みに正規化（出現シンボルはすべて >= 1）
function normalizeWeights(freq, L) {
  const syms = [];
  let total = 0;
  for (let s = 0; s < 256; s++) if (freq[s]) { syms.push(s); total += freq[s]; }
  if (syms.length < 2 || syms.length > L) return null;
  const w = new Int32Array(256);
  let sum = 0;
  for (const s of syms) { w[s] = Math.max(1, Math.floor(freq[s] * L / total)); sum += w[s]; }
  while (sum !== L) {
    let best = -1;
    for (const s of syms) {
      if (sum > L) { if (w[s] > 1 && (best < 0 || w[s] > w[best])) best = s; }
      else if (best < 0 || freq[s] / w[s] > freq[best] / w[best]) best = s;
    }
    if (sum > L) { w[best]--; sum--; } else { w[best]++; sum++; }
  }
  return w;
}

function tansTableBits(bw, w, lBits, format, q) {
  const syms = [];
  for (let s = 0; s < 256; s++) if (w[s]) syms.push(s);
  if (format === 'sparse') {
    const sorted = syms.slice().sort((a, b) => w[a] - w[b] || a - b);
    if (sorted.length < 2 || sorted.length > 9) return false;
    const last = sorted[sorted.length - 1];
    const listed = sorted.slice(0, -1);
    let prev = 0, maxDelta = 0;
    for (const s of listed) { maxDelta = Math.max(maxDelta, w[s] - prev); prev = w[s]; }
    let mdb = 1;
    while ((1 << mdb) <= maxDelta) mdb++;
    if (mdb > lBits || w[last] < prev || w[last] <= 1) return false;
    bw.bit(0);
    bw.write(listed.length - 1, 3);
    bw.write(mdb, ilog2(lBits) + 1);
    prev = 0;
    for (const s of listed) { bw.write(s, 8); bw.write(w[s] - prev, mdb); prev = w[s]; }
    bw.write(last, 8);
    return true;
  }
  const present = new Array(256).fill(false);
  for (const s of syms) present[s] = true;
  const ranges = symbolRanges(present);
  const n = syms.length;
  bw.bit(1);
  bw.write(q, 3);
  bw.write(n - 1, 8);
  writeFluff(bw, ranges.length, n);
  let average = 6;
  const codes = [];
  for (const s of syms) {
    const t = w[s] - 1;
    const ad4 = average >> 2;
    let limit = 2 * ad4;
    let u;
    if (t <= limit) { const d = t - ad4; u = d >= 0 ? 2 * d : -2 * d - 1; } else u = t;
    let v = u;
    if (v <= limit) v = ad4 + ((v >>> 1) ^ -(v & 1));
    if (v !== t) return false;
    if (limit > v) limit = v;
    average += limit - ad4;
    const nextra = ilog2(u + (1 << q));
    if (nextra > 15) return false;
    codes.push({ rice: nextra - q, r: u + (1 << q) - (1 << nextra), nextra });
  }
  for (const c of codes) writeUnary(bw, c.rice);
  for (const it of ranges) writeUnary(bw, it.v);
  for (const it of ranges) bw.write(it.value, it.bits);
  for (const c of codes) bw.write(c.r, c.nextra);
  return true;
}

export function tansBlock(data, { lBits = 11, format = 'rice', q = 1 } = {}, long = false) {
  const n = data.length;
  if (n < 16) return null;
  const L = 1 << lBits;
  const freq = new Int32Array(256);
  for (let i = 0; i < n - 5; i++) freq[data[i]]++;
  const w = normalizeWeights(freq, L);
  if (!w) return null;
  const aSyms = [], bList = [];
  for (let s = 0; s < 256; s++) { if (w[s] === 1) aSyms.push(s); else if (w[s] > 1) bList.push({ sym: s, weight: w[s] }); }
  const lut = tansTable(aSyms, bList, lBits);
  const bw = new BitWriterMSB();
  bw.bit(0); // 予約ビット
  bw.write(lBits - 8, 2);
  if (!tansTableBits(bw, w, lBits, format, q)) return null;
  const tab = bw.finish();
  const bySym = Array.from({ length: 256 }, () => []);
  lut.forEach((e, X) => bySym[e.sym].push(X));
  // 終状態 = 末尾 5 バイト。後ろから符号化する
  const st = [data[n - 5], data[n - 4], data[n - 3], data[n - 2], data[n - 1]];
  const fBits = [], bBits = [];
  for (let i = n - 6; i >= 0; i--) {
    const step = i % 10;
    const j = step % 5;
    const Y = st[j];
    let found = -1;
    for (const X of bySym[data[i]]) { const e = lut[X]; if (Y >= e.w && Y < e.w + (1 << e.bx)) { found = X; break; } }
    if (found < 0) return null;
    const e = lut[found];
    (step < 5 ? fBits : bBits).push([Y - e.w, e.bx]);
    st[j] = found;
  }
  const fw = new BitWriterLSB(), bwr = new BitWriterLSB();
  fw.write(st[0], lBits); fw.write(st[2], lBits); fw.write(st[4], lBits);
  bwr.write(st[1], lBits); bwr.write(st[3], lBits);
  for (let k = fBits.length - 1; k >= 0; k--) fw.write(fBits[k][0], fBits[k][1]);
  for (let k = bBits.length - 1; k >= 0; k--) bwr.write(bBits[k][0], bBits[k][1]);
  const payload = concat([tab, fw.finish(), bwr.finish().reverse()]);
  if (payload.length < 8) return null;
  return withHeader(1, payload, n, long);
}

// --- RLE ------------------------------------------------------------------

// decode_rle_unpacked 用のバッファ（先頭: データ, 末尾: 逆順のコマンド）
function rleUnpacked(data, r) {
  const lits = [];
  const cmds = [];
  let rleByte = 0;
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && data[i + run] === data[i]) run++;
    if (run >= 3) {
      if (data[i] !== rleByte) { cmds.push([1]); lits.push(data[i]); rleByte = data[i]; }
      let left = run;
      while (left >= 128) { const k = Math.min(1792, left >> 7); const v = 0x8FF + k; cmds.push([v & 255, v >> 8]); left -= k * 128; }
      if (left >= 3 && left <= 15 && (r() & 1)) cmds.push([(left << 4) | 0xF]); // 1 バイト命令（コピー 0）
      else if (left > 0) { const v = 4096 + (left << 6); cmds.push([v & 255, v >> 8]); }
      i += run;
      continue;
    }
    let j = i;
    while (j < data.length) {
      let rr = 1;
      while (j + rr < data.length && data[j + rr] === data[j]) rr++;
      if (rr >= 3) break;
      j += rr;
    }
    let n = j - i;
    for (let t = i; t < j; t++) lits.push(data[t]);
    while (n >= 64 && (r() & 1)) { const k = Math.min(1792, n >> 6); const v = 511 + k; cmds.push([v & 255, v >> 8]); n -= k * 64; }
    while (n > 0) {
      if (n >= 15 && (r() & 1)) { cmds.push([0]); n -= 15; continue; }
      const k = Math.min(n, 63); const v = 4096 + k; cmds.push([v & 255, v >> 8]); n -= k;
    }
    i = j;
  }
  const cmdBytes = [];
  for (let k = cmds.length - 1; k >= 0; k--) for (const b of cmds[k]) cmdBytes.push(b);
  return Uint8Array.from([...lits, ...cmdBytes]);
}

export function rleBlock(data, { prefix = null, seed = 1 } = {}, long = false) {
  if (data.length === 0) return null;
  const r = rng(seed);
  let allSame = true;
  for (let i = 1; i < data.length; i++) if (data[i] !== data[0]) { allSame = false; break; }
  if (allSame && data.length > 2 && (r() & 1)) return withHeader(3, Uint8Array.of(data[0]), data.length, long);
  const u = rleUnpacked(data, r);
  let payload;
  if (prefix) {
    const k = Math.max(1, u.length >> 1);
    const inner = prefix(u.subarray(0, k));
    if (!inner || inner[0] === 0) return null;
    payload = concat([inner, u.subarray(k)]);
  } else {
    payload = concat([Uint8Array.of(0), u]);
  }
  return withHeader(3, payload, data.length, long);
}

// --- recursive / multi array ------------------------------------------------

export function recursiveBlock(data, parts, encode, long = false) {
  if (data.length < parts) return null;
  const pieces = [];
  let o = 0;
  for (let i = 0; i < parts; i++) {
    const end = i === parts - 1 ? data.length : Math.floor(data.length * (i + 1) / parts);
    const b = encode(data.subarray(o, end));
    if (!b) return null;
    pieces.push(b);
    o = end;
  }
  const payload = concat([Uint8Array.of(parts), ...pieces]);
  if (payload.length < 6) return null;
  return withHeader(5, payload, data.length, long);
}

// decode_multi_array の形式。arrays = 出力配列の列。
// direct = true: num_arrays_in_file = 0（各配列を直接符号化）
export function multiArrayPayload(arrays, encode, { sources = 3, combined = false, direct = false, r = rng(1) } = {}) {
  if (direct) {
    const parts = [Uint8Array.of(0x80)];
    for (const a of arrays) { const b = encode(a); if (!b) return null; parts.push(b); }
    return concat(parts);
  }
  const srcData = Array.from({ length: sources }, () => []);
  const indexes = [], lens = [];
  let total = 0;
  for (const arr of arrays) {
    let o = 0;
    while (o < arr.length) {
      const n = Math.min(arr.length - o, 1 + (r() % 40));
      const s = r() % sources;
      for (let t = 0; t < n; t++) srcData[s].push(arr[o + t]);
      indexes.push(s + 1);
      lens.push(n);
      o += n;
    }
    total += arr.length;
    indexes.push(0);
    if (combined) lens.push(1);
  }
  if (indexes.length > total) return null; // get_block_size の制約（num_indexes <= 合計サイズ）
  const parts = [Uint8Array.of(0x80 | sources)];
  for (const d of srcData) { const b = encode(Uint8Array.from(d)); if (!b) return null; parts.push(b); }
  const lenlog2 = lens.map((L) => ilog2(L));
  const fw = new BitWriterMSB(), bw2 = new BitWriterMSB();
  lens.forEach((L, i) => (i % 2 === 0 ? fw : bw2).write(L - (1 << lenlog2[i]), lenlog2[i]));
  // 前方の読み出しは 4 バイト先読みするので間を空ける
  const varbits = concat([fw.finish(), new Uint8Array(4), bw2.finish().reverse()]);
  if (varbits.length > 0x3FFF) return null;
  const q = (combined ? 0x8000 : 0) | varbits.length;
  parts.push(Uint8Array.of(q & 255, q >> 8));
  if (combined) {
    const comb = Uint8Array.from(indexes.map((ix, i) => (lenlog2[i] << 4) | ix));
    parts.push(encode(comb, (r() & 1) === 1));
  } else {
    parts.push(encode(Uint8Array.from(indexes), (r() & 1) === 1), encode(Uint8Array.from(lenlog2)));
  }
  parts.push(varbits);
  if (parts.some((p) => !p)) return null;
  return concat(parts);
}

export function multiArrayBlock(data, encode, opts = {}, long = false) {
  const payload = multiArrayPayload([data], encode, opts);
  if (!payload) return null;
  return withHeader(5, payload, data.length, long);
}

// ---------------------------------------------------------------------------
// エントロピー符号の選択（失敗したら無圧縮）
// ---------------------------------------------------------------------------

export function makeEncoder(kind, r, depth = 0) {
  const sub = () => makeEncoder(['stored', 'huff', 'huff2', 'rle', 'tans'][r() % 5], r, depth + 1);
  return (data, long = false) => {
    let b = null;
    switch (kind) {
      case 'stored': break;
      case 'huff': b = huffmanBlock(data, { table: 'new', ways: 2, F: r() % 4 }, long); break;
      case 'huff2': b = huffmanBlock(data, { table: 'new', ways: 1, F: r() % 4 }, long); break;
      case 'huffOld': b = huffmanBlock(data, { table: 'old', ways: 1 + (r() & 1), F: r() % 4 }, long); break;
      case 'huffSparse': b = huffmanBlock(data, { table: 'sparse', ways: 1 + (r() & 1) }, long); break;
      case 'tans': b = tansBlock(data, { lBits: 8 + (r() % 4), format: 'rice', q: r() % 4 }, long); break;
      case 'tansSparse': b = tansBlock(data, { lBits: 8 + (r() % 4), format: 'sparse' }, long); break;
      case 'rle': b = rleBlock(data, { seed: r() }, long); break;
      case 'rlePrefix': b = rleBlock(data, { seed: r(), prefix: (d) => (depth < 2 ? sub()(d) : null) || storedBlock(d) }, long); break;
      case 'recursive': if (depth < 2) b = recursiveBlock(data, 2 + (r() % 3), sub(), long); break;
      case 'multi': if (depth < 2) b = multiArrayBlock(data, sub(), { sources: 2 + (r() % 3), combined: (r() & 1) === 1, r }, long); break;
      default: throw new Error('kind ' + kind);
    }
    return b || storedBlock(data, long);
  };
}

export const ENTROPY_KINDS = ['stored', 'huff', 'huff2', 'huffOld', 'huffSparse', 'tans', 'tansSparse', 'rle', 'rlePrefix', 'recursive', 'multi'];

// ---------------------------------------------------------------------------
// LZ 解析の補助（ハッシュチェーン、距離 >= 8）
// ---------------------------------------------------------------------------

class Matcher {
  constructor(data) { this.data = data; this.head = new Int32Array(65536).fill(-1); this.prev = new Int32Array(data.length).fill(-1); }
  hash(p) { const d = this.data; return ((d[p] << 8) ^ (d[p + 1] << 4) ^ d[p + 2] ^ (d[p + 3] << 12)) & 0xFFFF; }
  insert(p) { if (p + 4 > this.data.length) return; const h = this.hash(p); this.prev[p] = this.head[h]; this.head[h] = p; }
  find(pos, end, minDist, ok = () => true) {
    const d = this.data;
    if (pos + 4 > end) return null;
    let cand = this.head[this.hash(pos)];
    let best = null;
    for (let tries = 0; cand >= 0 && tries < 48; tries++, cand = this.prev[cand]) {
      const dist = pos - cand;
      if (dist < minDist || !ok(dist, cand)) continue;
      let l = 0;
      while (pos + l < end && d[cand + l] === d[pos + l]) l++;
      if (l >= 4 && (!best || l > best.len)) best = { dist, len: l };
    }
    return best;
  }
}

function matchLen(data, from, pos, end) {
  let l = 0;
  while (pos + l < end && data[from + l] === data[pos + l]) l++;
  return l;
}

// ---------------------------------------------------------------------------
// ストリーム（ブロックヘッダ + クォンタム）
// ---------------------------------------------------------------------------

// chunkEncoder(data, chunkStart, chunkLen) -> チャンク（ヘッダ込み）
export function oodleStream(data, decoderType, chunkEncoder, { memset = true, storedQuanta = true } = {}) {
  const parts = [];
  let storedToggle = 0;
  for (let blk = 0; blk < data.length; blk += 0x40000) {
    const len = Math.min(0x40000, data.length - blk);
    const q = data.subarray(blk, blk + len);
    let allSame = true;
    for (let i = 1; i < len; i++) if (q[i] !== q[0]) { allSame = false; break; }
    if (memset && allSame) {
      parts.push(Uint8Array.of(0x8C, decoderType, 0x07, 0xFF, 0xFF, q[0]));
      continue;
    }
    const chunks = [];
    for (let c = blk; c < blk + len; c += 0x20000) chunks.push(chunkEncoder(data, c, Math.min(0x20000, blk + len - c)));
    const body = concat(chunks);
    if (body.length >= len) {
      // 圧縮できない: 無圧縮ブロック、または圧縮サイズ = 展開サイズのクォンタム
      if ((storedToggle++ & 1) || len === 0x40000 || !storedQuanta) parts.push(Uint8Array.of(0xCC, decoderType), q);
      else { const v = len - 1; parts.push(Uint8Array.of(0x8C, decoderType, v >> 16, (v >> 8) & 255, v & 255), q); }
      continue;
    }
    const v = body.length - 1;
    parts.push(Uint8Array.of(0x8C, decoderType, v >> 16, (v >> 8) & 255, v & 255), body);
  }
  return concat(parts);
}

export function rawChunk(data, c, len) {
  const h = 0x800000 | len;
  return concat([Uint8Array.of(h >> 16, (h >> 8) & 255, h & 255), data.subarray(c, c + len)]);
}

function lzChunk(mode, payload, data, c, len) {
  if (!payload || payload.length >= len || payload.length > 0x7FFFF) return rawChunk(data, c, len);
  const h = 0x800000 | (mode << 19) | payload.length;
  return concat([Uint8Array.of(h >> 16, (h >> 8) & 255, h & 255), payload]);
}

// エントロピー符号のみのチャンク
export function entropyOnlyChunk(encode) {
  return (data, c, len) => {
    const b = encode(data.subarray(c, c + len), true);
    if (!b || (b[0] & 0x80) || b.length >= len) return rawChunk(data, c, len);
    return b;
  };
}

// --- unpack_offsets のビット列（Kraken / Leviathan 共通） -------------------

function writeDistance(bw, D) {
  const t = D + 248;
  const hi = t >> 4;
  const n = ilog2(hi);
  if (n >= 4 && n <= 18) {
    bw.write(hi - (1 << n), n);
    return ((n - 4) << 4) | (t & 0xF);
  }
  // 0xF0 以上: D = 8322816 + ((2^n + x) << 12) + y
  const e = D - 8322816;
  const hi2 = Math.floor(e / 4096);
  const n2 = ilog2(hi2);
  if (e < 0 || n2 < 4 || n2 > 19) throw new Error('distance range');
  bw.write(hi2 - (1 << n2), n2);
  bw.write(e & 0xFFF, 12);
  return 0xF0 + n2 - 4;
}

function writeLength(bw, L) {
  const v = L + 64;
  const n = ilog2(v) - 6;
  if (n > 12) throw new Error('length range');
  for (let i = 0; i < n; i++) bw.bit(0);
  bw.write(v, n + 7);
}

function offsetBits(offsets, u32s, scaling) {
  const A = new BitWriterMSB(), B = new BitWriterMSB();
  const g = u32s.length + 1;
  const gn = ilog2(g);
  for (let i = 0; i < gn; i++) B.bit(0);
  B.write(g, gn + 1);
  const packed = [], extra = [];
  offsets.forEach((D, i) => {
    const bw = i % 2 === 0 ? A : B;
    if (scaling === 0) {
      packed.push(writeDistance(bw, D));
    } else {
      const low = scaling === 1 ? 0 : D % scaling;
      const qv = (D - low) / scaling;
      const offs = qv + 8;
      const k = ilog2(offs) - 3;
      packed.push((k << 3) | ((offs >> k) - 8));
      bw.write(offs & ((1 << k) - 1), k);
      extra.push(low);
    }
  });
  u32s.forEach((v, i) => writeLength(i % 2 === 0 ? A : B, v));
  return { bits: concat([A.finish(), B.finish().reverse()]), packed: Uint8Array.from(packed), extra: Uint8Array.from(extra) };
}

// 長さ列の値（>= 3）。255 以上は u32 に回す
function pushLen(lens, u32s, v) {
  const pk = v - 3;
  if (pk >= 255) { lens.push(255); u32s.push(pk - 255); } else lens.push(pk);
}

// --- Kraken ----------------------------------------------------------------

export function krakenChunkEncoder({ mode = 1, enc = makeEncoder('stored', rng(1)), scaling = 0, entropyOnlyEvery = 0, maxDist = 1 << 30, prehash = [] } = {}) {
  let chunkNo = 0;
  return (data, c, len) => {
    chunkNo++;
    if (entropyOnlyEvery && chunkNo % entropyOnlyEvery === 0) return entropyOnlyChunk(enc)(data, c, len);
    if (len <= 16) return rawChunk(data, c, len);
    const end = c + len;
    const mt = new Matcher(data);
    for (const [a, b] of prehash) for (let p = a; p < Math.min(b, c); p++) mt.insert(p);
    for (let p = Math.max(0, c - 0x20000); p < c; p++) mt.insert(p);
    const pre = [];
    let pos = c;
    if (c === 0) { pre.push(data.subarray(0, 8)); pos = 8; }
    const lits = [], cmds = [], lens = [], offs = [], u32s = [];
    const recent = [8, 8, 8];
    let lastOff = 8;
    let litStart = pos;
    while (pos < end) {
      let m = null, oi = 3;
      for (let k = 0; k < 3; k++) {
        if (pos - recent[k] < 0) continue;
        const l = matchLen(data, pos - recent[k], pos, end);
        if (l >= 2 && (!m || l > m.len)) { m = { dist: recent[k], len: l }; oi = k; }
      }
      const fm = mt.find(pos, end, 8, (dd) => dd <= maxDist);
      if (fm && (!m || fm.len > m.len + 2)) { m = fm; oi = 3; }
      if (!m) { mt.insert(pos); pos++; continue; }
      for (let p = litStart; p < pos; p++) lits.push(mode === 0 ? (data[p] - data[p - lastOff]) & 255 : data[p]);
      const litlen = pos - litStart;
      let f = litlen >= 3 ? 3 : litlen;
      if (litlen >= 3) pushLen(lens, u32s, litlen);
      if (m.len <= 16) f |= (m.len - 2) << 2;
      else { f |= 15 << 2; pushLen(lens, u32s, m.len - 14); }
      f |= oi << 6;
      cmds.push(f);
      if (oi === 3) { offs.push(m.dist); recent.unshift(m.dist); recent.length = 3; }
      else recent.unshift(recent.splice(oi, 1)[0]);
      lastOff = m.dist;
      for (let p = pos; p < pos + m.len; p++) mt.insert(p);
      pos += m.len;
      litStart = pos;
    }
    for (let p = litStart; p < end; p++) lits.push(mode === 0 ? (data[p] - data[p - lastOff]) & 255 : data[p]);
    if (lens.length > len >> 2) return rawChunk(data, c, len);
    let payload = null;
    try {
      const ob = offsetBits(offs, u32s, scaling);
      const parts = [...pre, enc(Uint8Array.from(lits), true), enc(Uint8Array.from(cmds))];
      if (scaling) {
        parts.push(Uint8Array.of(scaling + 127), enc(ob.packed));
        if (scaling !== 1) parts.push(enc(ob.extra));
      } else {
        parts.push(enc(ob.packed, true));
      }
      parts.push(enc(Uint8Array.from(lens)), ob.bits);
      payload = concat(parts);
    } catch {
      // 符号化できない場合は raw チャンクにする
    }
    return lzChunk(mode, payload, data, c, len);
  };
}

// --- Mermaid ---------------------------------------------------------------

function mermaidLen(stream, L) {
  if (L <= 251) { stream.push(L); return; }
  const b = 252 + ((L - 252) & 3);
  const w = (L - b) / 4;
  if (w > 0xFFFF) throw new Error('mermaid len');
  stream.push(b, w & 255, w >> 8);
}

const MAX_LONG = 251 + 4 * 0xFFFF; // 長さ列で表せる最大の追加分

export function mermaidChunkEncoder({ mode = 1, enc = makeEncoder('stored', rng(1)), off16Entropy = false, preferFar = false, prehash = [] } = {}) {
  return (data, c, len) => {
    if (len <= 16) return rawChunk(data, c, len);
    const end = c + len;
    const mt = new Matcher(data);
    for (const [a, b] of prehash) for (let p = a; p < Math.min(b, c); p++) mt.insert(p);
    for (let p = Math.max(0, c - 0x40000); p < c; p++) mt.insert(p);
    const pre = [];
    let pos = c;
    if (c === 0) { pre.push(data.subarray(0, 8)); pos = 8; }
    const lits = [], cmds = [], off16 = [], off32 = [[], []], lenStream = [];
    let cmd2offs = 0;
    let recent = 8;
    for (let sub = 0; sub < 2; sub++) {
      const subStart = c + sub * 0x10000;
      if (subStart >= end) break;
      const subEnd = Math.min(end, subStart + 0x10000);
      if (sub === 1) cmd2offs = cmds.length;
      if (pos < subStart) pos = subStart;
      let litStart = pos;
      const lit = (n) => {
        for (let p = litStart; p < litStart + n; p++) lits.push(mode === 0 ? (data[p] - data[p - recent]) & 255 : data[p]);
        litStart += n;
      };
      // 保留中のリテラルを単独のコマンドで出す
      const flush = (n) => {
        while (n >= 64) { const k = Math.min(n, 64 + MAX_LONG); lit(k); cmds.push(0); mermaidLen(lenStream, k - 64); n -= k; }
        while (n > 0) { const k = Math.min(n, 7); lit(k); cmds.push(0x80 | k); n -= k; }
      };
      while (pos < subEnd) {
        let m = null;
        if (pos - recent >= 0) {
          const l = matchLen(data, pos - recent, pos, subEnd);
          if (l >= 2) m = { dist: recent, len: l, kind: 'rec' };
        }
        const fm = mt.find(pos, subEnd, 8);
        if (fm && (!m || fm.len > m.len + 2)) {
          const from = pos - fm.dist;
          const farOk = from <= subStart && fm.len >= 8;
          if (fm.dist <= 0xFFFF && !(preferFar && farOk)) m = { ...fm, kind: 'near' };
          else if (farOk) m = { ...fm, kind: 'far' };
        }
        if (!m) { mt.insert(pos); pos++; continue; }
        let pending = pos - litStart;
        let left = m.len;
        if (m.kind === 'rec') {
          if (pending > 7) { flush(pending - 7); pending = 7; }
          lit(pending);
          const ml = Math.min(left, 15);
          cmds.push(0x80 | (ml << 3) | pending);
          left -= ml;
        } else if (m.kind === 'near') {
          if (left >= 91) {
            flush(pending);
            const n = Math.min(left, 91 + MAX_LONG);
            cmds.push(1); mermaidLen(lenStream, n - 91);
            left -= n;
          } else {
            if (pending > 7) { flush(pending - 7); pending = 7; }
            lit(pending);
            const ml = Math.min(left, 15);
            cmds.push((ml << 3) | pending);
            left -= ml;
          }
          off16.push(m.dist);
          recent = m.dist;
        } else {
          flush(pending);
          let n;
          if (left >= 29) { n = Math.min(left, 29 + MAX_LONG); cmds.push(2); mermaidLen(lenStream, n - 29); }
          else { n = left; cmds.push(n - 5); }
          off32[sub].push(subStart - (pos - m.dist));
          left -= n;
          recent = m.dist;
        }
        while (left > 0) { const ml = Math.min(left, 15); cmds.push(0x80 | (ml << 3)); left -= ml; }
        for (let p = pos; p < pos + m.len; p++) mt.insert(p);
        pos += m.len;
        litStart = pos;
      }
      lit(subEnd - litStart); // 末尾のリテラルは暗黙
      pos = subEnd;
    }
    if (len <= 0x10000) cmd2offs = cmds.length;
    let payload = null;
    try {
      const parts = [...pre, enc(Uint8Array.from(lits)), enc(Uint8Array.from(cmds))];
      if (len > 0x10000) parts.push(Uint8Array.of(cmd2offs & 255, cmd2offs >> 8));
      if ((off16Entropy && off16.length) || off16.length >= 0xFFFF) {
        parts.push(Uint8Array.of(0xFF, 0xFF), enc(Uint8Array.from(off16, (x) => x >> 8)), enc(Uint8Array.from(off16, (x) => x & 255)));
      } else {
        parts.push(Uint8Array.of(off16.length & 255, off16.length >> 8), Uint8Array.from(off16.flatMap((x) => [x & 255, x >> 8])));
      }
      const s1 = off32[0].length, s2 = off32[1].length;
      const e1 = Math.min(s1, 4095), e2 = Math.min(s2, 4095);
      const t = (e1 << 12) | e2;
      parts.push(Uint8Array.of(t & 255, (t >> 8) & 255, t >> 16));
      if (e1 === 4095) parts.push(Uint8Array.of(s1 & 255, s1 >> 8));
      if (e2 === 4095) parts.push(Uint8Array.of(s2 & 255, s2 >> 8));
      for (let sub = 0; sub < 2; sub++) {
        const base = c + sub * 0x10000;
        for (const off of off32[sub]) {
          if (base >= 0xC00000 - 1 && off >= 0xC00000) {
            const hb = Math.floor((off - 0xC00000) / 0x400000);
            const lo = off - hb * 0x400000;
            parts.push(Uint8Array.of(lo & 255, (lo >> 8) & 255, lo >> 16, hb));
          } else {
            parts.push(Uint8Array.of(off & 255, (off >> 8) & 255, off >> 16));
          }
        }
      }
      parts.push(Uint8Array.from(lenStream));
      payload = concat(parts);
    } catch {
      // 符号化できない場合は raw チャンクにする
    }
    return lzChunk(mode, payload, data, c, len);
  };
}

// --- Leviathan ---------------------------------------------------------------

export function leviathanChunkEncoder({ mode = 1, enc = makeEncoder('stored', rng(1)), scaling = 0, multiCmd = false, r = rng(5), prehash = [] } = {}) {
  return (data, c, len) => {
    if (len <= 32) return rawChunk(data, c, len);
    const end = c + len;
    const mt = new Matcher(data);
    for (const [a, b] of prehash) for (let p = a; p < Math.min(b, c); p++) mt.insert(p);
    for (let p = Math.max(0, c - 0x20000); p < c; p++) mt.insert(p);
    const pre = [];
    let pos = c;
    if (c === 0) { pre.push(data.subarray(0, 8)); pos = 8; }
    const matchZoneEnd = len >= 16 ? end - 16 : c;
    const cmds = [], cmdStart = [], offs = [], u32s = [];
    const frontLens = [], backLens = [];
    const runs = []; // [開始, 終了, 直前の距離]
    const recent = [8, 8, 8, 8, 8, 8, 8];
    let lastOff = 8;
    let litStart = pos;
    // 命令内のリテラルは match_zone_end より前で終わらせる（pyooz はどのモードでもこれを要求する）
    const strictLit = true;
    while (pos < end) {
      let m = null, oi = 7;
      for (let k = 0; k < 7; k++) {
        if (pos - recent[k] < 0) continue;
        const l = matchLen(data, pos - recent[k], pos, end);
        if (l >= 2 && (!m || l > m.len)) { m = { dist: recent[k], len: l }; oi = k; }
      }
      const fm = mt.find(pos, end, 8);
      if (fm && (!m || fm.len > m.len + 2)) { m = fm; oi = 7; }
      const litlen = pos - litStart;
      if (m && strictLit && litlen > 0 && litStart + litlen >= matchZoneEnd) m = null;
      if (m && m.len > 8) {
        const maxl = end - pos - 8;
        m.len = maxl < 9 ? 8 : Math.min(m.len, maxl);
      }
      if (!m) { mt.insert(pos); pos++; continue; }
      const lc = litlen >= 3 ? 3 : litlen;
      if (litlen >= 3) frontLens.push(litlen);
      let mc;
      if (m.len >= 9) { mc = 7; backLens.push(m.len - 6); } else mc = m.len - 2;
      cmds.push((oi << 5) | (lc << 3) | mc);
      cmdStart.push(litStart);
      runs.push([litStart, pos, lastOff]);
      if (oi === 7) { offs.push(m.dist); recent.unshift(m.dist); recent.length = 7; }
      else recent.unshift(recent.splice(oi, 1)[0]);
      lastOff = m.dist;
      for (let p = pos; p < pos + m.len; p++) mt.insert(p);
      pos += m.len;
      litStart = pos;
    }
    runs.push([litStart, end, lastOff]);
    if (offs.length > Math.floor(len / 3)) return rawChunk(data, c, len);
    const lensAll = [...frontLens, ...backLens.slice().reverse()];
    const packedLens = [];
    for (const v of lensAll) pushLen(packedLens, u32s, v);
    if (packedLens.length > Math.floor(len / 5)) return rawChunk(data, c, len);
    const nStreams = mode === 2 ? 2 : mode === 3 ? 4 : (mode === 4 || mode === 5) ? 16 : 1;
    const litStreams = Array.from({ length: nStreams }, () => []);
    for (const [a, b, lo] of runs) {
      for (let p = a; p < b; p++) {
        const delta = (data[p] - data[p - lo]) & 255;
        if (mode === 0) litStreams[0].push(delta);
        else if (mode === 1) litStreams[0].push(data[p]);
        else if (mode === 2) litStreams[p === a ? 1 : 0].push(delta);
        else if (mode === 3) litStreams[(p - c) & 3].push(delta);
        else if (mode === 5) litStreams[(p - c) & 15].push(delta);
        else litStreams[data[p - 1] >> 4].push(data[p]);
      }
    }
    let payload = null;
    try {
      const ob = offsetBits(offs, u32s, scaling);
      const parts = [...pre];
      if (scaling) {
        parts.push(Uint8Array.of(scaling + 127), enc(ob.packed));
        if (scaling !== 1) parts.push(enc(ob.extra));
      } else {
        parts.push(enc(ob.packed, true));
      }
      parts.push(enc(Uint8Array.from(packedLens)));
      if (mode <= 1) {
        parts.push(enc(Uint8Array.from(litStreams[0])));
      } else {
        const arrs = litStreams.map((s) => Uint8Array.from(s));
        const opts = { r, sources: 1 + (r() % 4), combined: (r() & 1) === 1, direct: (r() % 3) === 0 };
        const p = multiArrayPayload(arrs, enc, opts) || multiArrayPayload(arrs, enc, { direct: true });
        if (!p) throw new Error('multi lit');
        parts.push(p);
      }
      if (!multiCmd) {
        parts.push(enc(Uint8Array.from(cmds), true));
      } else {
        const streams = Array.from({ length: 8 }, () => []);
        cmds.forEach((x, i) => streams[(cmdStart[i] - c) & 7].push(x));
        const arrs = streams.map((s) => Uint8Array.from(s));
        const opts = { r, sources: 1 + (r() % 3), combined: (r() & 1) === 1, direct: (r() % 3) === 0 };
        const p = multiArrayPayload(arrs, enc, opts) || multiArrayPayload(arrs, enc, { direct: true });
        if (!p) throw new Error('multi cmd');
        parts.push(Uint8Array.of(0x83), p);
      }
      parts.push(ob.bits);
      payload = concat(parts);
    } catch {
      // 符号化できない場合は raw チャンクにする
    }
    return lzChunk(mode, payload, data, c, len);
  };
}

// ---------------------------------------------------------------------------
// テスト用の合成データとストリーム一覧（oodle.test.mjs から使う）
// ---------------------------------------------------------------------------

const WORDS = ['the', 'pal', 'level', 'save', 'data', 'name', 'id', 'value', 'struct', 'array', 'guid', 'player', 'item', 'None'];

export function genData(kind, n, seed) {
  const r = rng(seed);
  const d = new Uint8Array(n);
  if (kind === 'text') {
    for (let o = 0; o < n;) {
      const w = WORDS[r() % WORDS.length] + ((r() % 7) === 0 ? '.\n' : ' ');
      for (let i = 0; i < w.length && o < n; i++) d[o++] = w.charCodeAt(i);
    }
  } else if (kind === 'skew') {
    for (let i = 0; i < n; i++) { let v = 0; while (v < 200 && (r() & 3) !== 0) v++; d[i] = (v * 7) & 255; }
  } else if (kind === 'records') {
    for (let i = 0; i < n; i++) {
      const k = i % 37;
      d[i] = k < 4 ? (Math.floor(i / 37) >> (8 * k)) & 255 : k < 20 ? (k * 13) & 255 : ((r() % 5) === 0 ? r() & 255 : 0);
    }
  } else if (kind === 'runs') {
    for (let o = 0; o < n;) {
      const b = r() & 255;
      const l = 1 + (r() % ((r() & 1) ? 400 : 8));
      for (let i = 0; i < l && o < n; i++) d[o++] = (r() % 9) === 0 ? r() & 255 : b;
    }
  } else if (kind === 'repeats') {
    // 長い一致（300〜3000）と長いリテラル（300〜1000）
    for (let o = 0; o < n;) {
      const lit = 300 + (r() % 700);
      for (let i = 0; i < lit && o < n; i++) d[o++] = r() & 255;
      if (o > 4000) {
        const l = 300 + (r() % 2700);
        const from = r() % (o - 3000);
        for (let i = 0; i < l && o < n; i++) d[o++] = d[from + i];
      }
    }
  } else {
    for (let i = 0; i < n; i++) d[i] = r() & 255;
  }
  return d;
}

const DATA_KINDS = ['text', 'skew', 'records', 'runs', 'repeats'];

// 合成ストリームの一覧（各ストリームは開発時に pyooz と oozextract 0.4.2 でも同じ内容に展開できることを確認済み）
export function codecCases() {
  const cases = [];
  let seed = 1000;
  const add = (codec, opts, entropy, dataKind, size) => {
    seed++;
    cases.push({ name: `${codec} ${JSON.stringify(opts)} entropy=${entropy} data=${dataKind} n=${size}`, codec, opts, entropy, dataKind, size, seed });
  };
  ENTROPY_KINDS.forEach((ent, i) => {
    add('kraken', { mode: i & 1, scaling: [0, 1, 77][i % 3] }, ent, DATA_KINDS[i % 5], 70000 + i * 3001);
    add('mermaid', { mode: (i >> 1) & 1, off16Entropy: (i & 1) === 1, preferFar: i % 3 === 0 }, ent, DATA_KINDS[(i + 1) % 5], 140000 + i * 2003);
    add('leviathan', { mode: i % 6, scaling: [0, 1, 50][i % 3], multiCmd: (i & 1) === 0 }, ent, DATA_KINDS[(i + 2) % 5], 60000 + i * 4001);
    add('entropy-only', { codec: ['kraken', 'mermaid', 'leviathan'][i % 3] }, ent, DATA_KINDS[(i + 3) % 5], 30000 + i * 997);
  });
  for (let mode = 0; mode < 6; mode++) add('leviathan', { mode, scaling: 0, multiCmd: mode % 2 === 1 }, 'huff', 'repeats', 300000);
  add('kraken', { mode: 0, scaling: 0, entropyOnlyEvery: 2 }, 'huffOld', 'text', 600000);
  add('mermaid', { mode: 0, off16Entropy: true }, 'tans', 'runs', 600000);
  return cases;
}

const TYPE = { kraken: 0x06, mermaid: 0x0A, leviathan: 0x0C };

export function buildCase(c) {
  const data = genData(c.dataKind, c.size, c.seed);
  const enc = makeEncoder(c.entropy, rng(c.seed * 7));
  let stream;
  if (c.codec === 'kraken') stream = oodleStream(data, TYPE.kraken, krakenChunkEncoder({ ...c.opts, enc }));
  else if (c.codec === 'mermaid') stream = oodleStream(data, TYPE.mermaid, mermaidChunkEncoder({ ...c.opts, enc }));
  else if (c.codec === 'leviathan') stream = oodleStream(data, TYPE.leviathan, leviathanChunkEncoder({ ...c.opts, enc, r: rng(c.seed) }));
  else stream = oodleStream(data, TYPE[c.opts.codec], entropyOnlyChunk(enc));
  return { data, stream };
}
