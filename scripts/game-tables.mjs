// ゲーム本体の DataTable のうち、型の情報（プロパティの名前と型）を持たない形（unversioned。UE5 の cook）で保存された表を読む道具。
// 行の構造体のプロパティの並びは、実行ファイル（Palworld-Win64-Shipping.exe）の中の反射データ（UHT が生成する FStructParams と
// FPropertyParams）から取る。取り出しのスクリプト（extract-work.mjs。後の implants の手術台の表 DT_OperatingTablePassiveSkillDataTable も）が使う。
// 読み取りのみ。v1.0.5（2026-10-15）で確かめた。
//
// 使い方:
//   const exe = openExecutable(gameFiles(gameDir).exe);
//   const schema = exe.structSchema('PalCharacterParameterDatabaseRow');   // 行の構造体の名前（先頭の F は付けない）
//   const rows = readDataTable(schema, pak.get(`${table}.uexp`), nameMap(pak.get(`${table}.uasset`)), { keep: (name) => … });
//   rows は Map<行の名前, { プロパティ名: 値 }>。keep で残すプロパティを限る（読み進めるために全部を読むが、残さない値は捨てる）。
//   入れ子の構造体（Struct）は形が反射データから引けないので、overrides に { プロパティ名: readers.vector } のように読み方を渡す。
import fs from 'node:fs';
import path from 'node:path';

/** インストール先から pak と実行ファイルのパス */
export function gameFiles(gameDir) {
  return {
    pak: path.join(gameDir, 'Pal', 'Content', 'Paks', 'Pal-Windows.pak'),
    exe: path.join(gameDir, 'Pal', 'Binaries', 'Win64', 'Palworld-Win64-Shipping.exe'),
  };
}

// EPropertyGenFlags（UE5）の型の番号 → 名前
const GEN_TYPES = ['Byte', 'Int8', 'Int16', 'Int', 'Int64', 'UInt16', 'UInt32', 'UInt64', 'UnsizedInt', 'UnsizedUInt', 'Float', 'Double', 'Bool',
  'SoftClass', 'WeakObject', 'LazyObject', 'SoftObject', 'Class', 'Object', 'Interface', 'Name', 'Str', 'Array', 'Map', 'Set', 'Struct', 'Delegate',
  'InlineMulticastDelegate', 'SparseMulticastDelegate', 'Text', 'Enum', 'FieldPath', 'LargeWorldCoordinatesReal'];

/**
 * 実行ファイルを開き、反射データから構造体のプロパティの並びを引けるようにする。
 * @returns {{ structSchema(name: string): object[] }}
 */
export function openExecutable(file) {
  const d = fs.readFileSync(file);
  if (d.toString('latin1', 0, 2) !== 'MZ') throw new Error(`実行ファイルではありません: ${file}`);
  const pe = d.readUInt32LE(0x3c);
  const count = d.readUInt16LE(pe + 6);
  const optSize = d.readUInt16LE(pe + 20);
  const imageBase = d.readBigUInt64LE(pe + 24 + 24);
  const sections = [];
  for (let i = 0; i < count; i++) {
    const p = pe + 24 + optSize + i * 40;
    sections.push({ name: d.toString('latin1', p, p + 8).replace(/\0+$/, ''), rva: d.readUInt32LE(p + 12), size: d.readUInt32LE(p + 16), off: d.readUInt32LE(p + 20) });
  }
  const offToVa = (o) => {
    const s = sections.find((x) => x.off <= o && o < x.off + x.size);
    return s ? imageBase + BigInt(s.rva + o - s.off) : -1n;
  };
  const vaToOff = (va) => {
    const r = Number(BigInt(va) - imageBase);
    const s = sections.find((x) => x.rva <= r && r < x.rva + x.size);
    return s ? s.off + r - s.rva : -1;
  };
  const cstr = (o) => (o < 0 ? null : d.toString('latin1', o, d.indexOf(0, o)));
  const ptrStr = (o) => {
    const v = d.readBigUInt64LE(o);
    return v === 0n ? null : cstr(vaToOff(v));
  };
  // ポインターを置く節（.rdata・.data）から、targets（VA）を指す 8 バイトの位置を探す
  const dataSections = sections.filter((s) => s.name === '.rdata' || s.name === '.data');
  function refsTo(targets) {
    const wanted = new Set(targets.map(String));
    const out = [];
    for (const s of dataSections) {
      for (let o = s.off; o + 8 <= s.off + s.size; o += 8) {
        if (d.readUInt32LE(o + 4) !== Number(imageBase >> 32n)) continue;
        if (wanted.has(String(d.readBigUInt64LE(o)))) out.push(o);
      }
    }
    return out;
  }
  // 名前の文字列（前が 0 の、0 で終わる文字列）の位置
  function findString(text) {
    const out = [];
    const needle = Buffer.from(`${text}\0`, 'latin1');
    for (let i = d.indexOf(needle); i >= 0; i = d.indexOf(needle, i + 1)) if (i === 0 || d[i - 1] === 0) out.push(i);
    return out;
  }
  // FStructParams（NameUTF8 は +0x18、SizeOf +0x20、AlignOf +0x28、PropertyArray +0x30、NumProperties +0x38）
  function structParams(name) {
    const found = [];
    for (const ref of refsTo(findString(name).map(offToVa))) {
      const sp = ref - 0x18;
      const sizeOf = Number(d.readBigUInt64LE(sp + 0x20));
      const alignOf = Number(d.readBigUInt64LE(sp + 0x28));
      const array = d.readBigUInt64LE(sp + 0x30);
      const num = d.readInt32LE(sp + 0x38);
      if (sizeOf > 0 && sizeOf < 0x100000 && [1, 2, 4, 8, 16].includes(alignOf) && num >= 0 && num < 2000) found.push({ array, num });
    }
    return found;
  }
  // FPropertyParams の並び（名前 +0x00、型の番号 +0x18 の下位 6 ビット）
  function properties({ array, num }) {
    const at = vaToOff(array);
    return Array.from({ length: num }, (_, i) => {
      const p = vaToOff(d.readBigUInt64LE(at + i * 8));
      const gen = d[p + 0x18] & 0x3f;
      return { name: ptrStr(p), type: GEN_TYPES[gen] ?? `gen${gen}` };
    });
  }
  /**
   * 構造体のプロパティの並び（保存の順）。配列・集合の要素（inner）、マップのキーと値（key・value）、列挙の元の型（underlying）は
   * 親に入れる（ConstructFProperties と同じく、後ろから組み立てる）。見つからない・2 つ以上あるときは投げる
   */
  function structSchema(name) {
    const found = structParams(name);
    if (found.length !== 1) throw new Error(`構造体 ${name} の反射データが ${found.length} 件です（1 件のはず）`);
    const list = properties(found[0]);
    let i = list.length;
    const build = () => {
      const p = { ...list[--i] };
      if (p.type === 'Array' || p.type === 'Set') p.inner = build();
      else if (p.type === 'Map') { p.key = build(); p.value = build(); }
      else if (p.type === 'Enum') p.underlying = build();
      return p;
    };
    const top = [];
    while (i > 0) top.unshift(build());
    return top;
  }
  return { structSchema };
}

// ---- 値の読み方 ----

const fname = (names, b, o) => {
  const index = b.readInt32LE(o);
  const number = b.readInt32LE(o + 4);
  if (index < 0 || index >= names.length) throw new Error(`名前の番号が範囲外です: ${index}`);
  return number ? `${names[index]}_${number - 1}` : names[index];
};
function fstring(b, o) {
  const n = b.readInt32LE(o);
  if (n >= 0) return { v: n ? b.toString('utf8', o + 4, o + 4 + n - 1) : '', next: o + 4 + n };
  return { v: b.toString('utf16le', o + 4, o + 4 - n * 2 - 2), next: o + 4 - n * 2 };
}
const SIZES = { Int8: 1, Byte: 1, Int16: 2, UInt16: 2, Int: 4, UInt32: 4, Int64: 8, UInt64: 8 };

/** 入れ子の構造体などの読み方（overrides に渡す）。(b, o, names) → { v, next } */
export const readers = {
  // FVector（double 3 つ）
  vector: (b, o) => ({ v: [b.readDoubleLE(o), b.readDoubleLE(o + 8), b.readDoubleLE(o + 16)], next: o + 24 }),
};

function readValue(p, b, o, names, overrides) {
  if (overrides[p.name]) return overrides[p.name](b, o, names);
  switch (p.type) {
    case 'Name': return { v: fname(names, b, o), next: o + 8 };
    case 'Int8': return { v: b.readInt8(o), next: o + 1 };
    case 'Int16': return { v: b.readInt16LE(o), next: o + 2 };
    case 'Int': return { v: b.readInt32LE(o), next: o + 4 };
    case 'Int64': return { v: Number(b.readBigInt64LE(o)), next: o + 8 };
    case 'UInt16': return { v: b.readUInt16LE(o), next: o + 2 };
    case 'UInt32': return { v: b.readUInt32LE(o), next: o + 4 };
    case 'UInt64': return { v: Number(b.readBigUInt64LE(o)), next: o + 8 };
    case 'Float': return { v: b.readFloatLE(o), next: o + 4 };
    case 'Double': return { v: b.readDoubleLE(o), next: o + 8 };
    case 'Bool': return { v: Boolean(b[o]), next: o + 1 };
    case 'Byte': return { v: b[o], next: o + 1 };
    case 'Enum': {
      const size = SIZES[p.underlying?.type];
      if (!size) throw new Error(`未対応の列挙の型 ${p.underlying?.type}（${p.name}）`);
      return { v: size === 1 ? b[o] : size === 2 ? b.readUInt16LE(o) : size === 4 ? b.readInt32LE(o) : Number(b.readBigInt64LE(o)), next: o + size };
    }
    case 'Str': return fstring(b, o);
    case 'Object': case 'Class': return { v: b.readInt32LE(o), next: o + 4 };
    // FSoftObjectPath（パッケージ名・アセット名の FName と、サブパスの FString）→ 「/Game/…/T_x.T_x」
    case 'SoftObject': case 'SoftClass': {
      const sub = fstring(b, o + 16);
      return { v: `${fname(names, b, o)}.${fname(names, b, o + 8)}${sub.v ? `:${sub.v}` : ''}`, next: sub.next };
    }
    case 'Array': case 'Set': {
      const n = b.readInt32LE(o);
      let q = o + 4;
      const out = [];
      for (let k = 0; k < n; k++) {
        const r = readValue(p.inner, b, q, names, overrides);
        out.push(r.v);
        q = r.next;
      }
      return { v: out, next: q };
    }
    default: throw new Error(`未対応の型 ${p.type}（${p.name}）。overrides に読み方を渡してください`);
  }
}

// 1 つの構造体（unversioned。先頭の断片の並び〔飛ばす数・既定値の印・最後の印・数〕と、既定値の印のビット列の後に、値を順に置く）
function readStruct(schema, b, o, names, { keep, overrides }) {
  const fragments = [];
  let zeroCount = 0;
  for (;;) {
    const x = b.readUInt16LE(o);
    o += 2;
    const fragment = { skip: x & 0x7f, zeroes: Boolean(x & 0x80), last: Boolean(x & 0x100), num: x >> 9 };
    fragments.push(fragment);
    if (fragment.zeroes) zeroCount += fragment.num;
    if (fragment.last) break;
  }
  const mask = [];
  if (zeroCount) {
    for (let k = 0; k < zeroCount; k++) mask.push(Boolean(b[o + (k >> 3)] & (1 << (k & 7))));
    o += zeroCount <= 8 ? 1 : zeroCount <= 16 ? 2 : Math.ceil(zeroCount / 32) * 4;
  }
  const out = {};
  let index = 0;
  let zi = 0;
  for (const fragment of fragments) {
    index += fragment.skip;
    for (let k = 0; k < fragment.num; k++, index++) {
      const p = schema[index];
      if (!p) throw new Error(`プロパティの並びの範囲外です（${index}）`);
      // 既定値（0・空）の印のものは値を置かない
      if (fragment.zeroes && mask[zi++]) continue;
      const r = readValue(p, b, o, names, overrides);
      if (keep(p.name)) out[p.name] = r.v;
      o = r.next;
    }
  }
  return { v: out, next: o };
}

/**
 * DataTable（.uexp）を読む。先頭は 00 03・行の構造体（4 バイト）・0（4 バイト）・行数、各行は行の名前（FName）と構造体。
 * 最後まで読み切れなかった（並びと中身が合わない）ときは投げる。
 * @param {object[]} schema openExecutable(...).structSchema(...) の結果
 * @param {Buffer} uexp
 * @param {string[]} names .uasset の名前表（extract-humans.mjs の nameMap）
 * @param {{ keep?: (name: string) => boolean, overrides?: Record<string, Function> }} [options] keep は残すプロパティ（既定は全部）
 * @returns {Map<string, object>}
 */
export function readDataTable(schema, uexp, names, { keep = () => true, overrides = {} } = {}) {
  if (uexp.readUInt16LE(0) !== 0x0300 || uexp.readInt32LE(6) !== 0) throw new Error('想定と違う DataTable の先頭です');
  const count = uexp.readInt32LE(10);
  let o = 14;
  const rows = new Map();
  for (let i = 0; i < count; i++) {
    const key = fname(names, uexp, o);
    const r = readStruct(schema, uexp, o + 8, names, { keep, overrides });
    rows.set(key, r.v);
    o = r.next;
  }
  // 末尾は 4 バイト（パッケージの終わりの印）。それより多く残る・はみ出すなら、並びの読み違い
  if (o > uexp.length || uexp.length - o > 4) throw new Error(`DataTable を読み切れませんでした（${o} / ${uexp.length} バイト）`);
  return rows;
}
