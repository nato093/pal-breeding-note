// テスト専用: 合成 GVAS バイト列を組み立てる小さな writer（実セーブのバイトは使わない）。
// 書式は palsav の FArchiveWriter と同じ。

const enc = new TextEncoder();

/** 可変長のバイト列ビルダー。 */
export class ByteWriter {
  constructor() {
    this.buf = new Uint8Array(256);
    this.dv = new DataView(this.buf.buffer);
    this.len = 0;
  }

  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }

  u8(v) { this.ensure(1); this.buf[this.len++] = v & 0xff; return this; }
  bool(v) { return this.u8(v ? 1 : 0); }
  u16(v) { this.ensure(2); this.dv.setUint16(this.len, v, true); this.len += 2; return this; }
  i32(v) { this.ensure(4); this.dv.setInt32(this.len, v, true); this.len += 4; return this; }
  u32(v) { this.ensure(4); this.dv.setUint32(this.len, v >>> 0, true); this.len += 4; return this; }
  f32(v) { this.ensure(4); this.dv.setFloat32(this.len, v, true); this.len += 4; return this; }
  f64(v) { this.ensure(8); this.dv.setFloat64(this.len, v, true); this.len += 8; return this; }

  /** 64bit 整数（number または BigInt / 10 進文字列）。 */
  i64(v) {
    this.ensure(8);
    this.dv.setBigInt64(this.len, BigInt(v), true);
    this.len += 8;
    return this;
  }

  u64(v) {
    this.ensure(8);
    this.dv.setBigUint64(this.len, BigInt(v), true);
    this.len += 8;
    return this;
  }

  bytes(b) {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
    return this;
  }

  /** FString。Latin-1 に収まれば 8bit、そうでなければ UTF-16LE（負の長さ）。 */
  fstring(s) {
    if (s === '') return this.i32(0);
    if (/^[\x00-\xff]*$/.test(s)) {
      this.i32(s.length + 1);
      this.ensure(s.length + 1);
      for (let i = 0; i < s.length; i++) this.buf[this.len++] = s.charCodeAt(i);
      this.buf[this.len++] = 0;
      return this;
    }
    this.i32(-(s.length + 1));
    this.ensure((s.length + 1) * 2);
    for (let i = 0; i < s.length; i++) {
      this.dv.setUint16(this.len, s.charCodeAt(i), true);
      this.len += 2;
    }
    this.dv.setUint16(this.len, 0, true);
    this.len += 2;
    return this;
  }

  /** GUID 文字列（palsav 形式）→ 16 バイト。 */
  guid(s) {
    const h = s.replace(/-/g, '');
    if (h.length !== 32) throw new Error(`bad guid ${s}`);
    // A, B, C, D を u32 LE で
    for (let i = 0; i < 4; i++) this.u32(parseInt(h.slice(i * 8, i * 8 + 8), 16));
    return this;
  }

  /** 中身を書く関数から、サイズ付きで埋め込む。 */
  sub(fn) {
    const w = new ByteWriter();
    fn(w);
    return w.toBytes();
  }

  toBytes() {
    return this.buf.slice(0, this.len);
  }
}

/**
 * プロパティ列を書く writer。各メソッドは 1 プロパティ（タグ + 値）を書く。
 * 最後に none() で 'None' 終端を書く。
 */
export class GvasWriter extends ByteWriter {
  /** タグを書き、値（fn が書く）をサイズ付きで追加。header は型ごとのタグ追加部分。 */
  tag(name, type, header, valueFn, { guidFlag = 0, index = 0 } = {}) {
    const value = this.sub(valueFn);
    this.fstring(name).fstring(type).u32(value.length).u32(index);
    if (header) header(this);
    this.u8(guidFlag);
    if (guidFlag) this.guid('11111111-2222-3333-4444-555555555555');
    return this.bytes(value);
  }

  none() { return this.fstring('None'); }

  int(name, v, opts) { return this.tag(name, 'IntProperty', null, (w) => w.i32(v), opts); }
  int64(name, v) { return this.tag(name, 'Int64Property', null, (w) => w.i64(v)); }
  uint32(name, v) { return this.tag(name, 'UInt32Property', null, (w) => w.u32(v)); }
  uint16(name, v) { return this.tag(name, 'UInt16Property', null, (w) => w.u16(v)); }
  float(name, v) { return this.tag(name, 'FloatProperty', null, (w) => w.f32(v)); }
  double(name, v) { return this.tag(name, 'DoubleProperty', null, (w) => w.f64(v)); }
  str(name, v) { return this.tag(name, 'StrProperty', null, (w) => w.fstring(v)); }
  name(name, v) { return this.tag(name, 'NameProperty', null, (w) => w.fstring(v)); }

  bool(name, v) {
    if (typeof name !== 'string') return super.bool(name); // ByteWriter.bool(v) 互換
    // BoolProperty は値がタグ側にあり、サイズ 0
    this.fstring(name).fstring('BoolProperty').u32(0).u32(0);
    super.bool(v);
    return this.u8(0);
  }

  enumProp(name, enumType, v) {
    return this.tag(name, 'EnumProperty', (w) => w.fstring(enumType), (w) => w.fstring(v));
  }

  /** ByteProperty。enumType 'None' なら数値、それ以外は enum 名。 */
  byte(name, v, enumType = 'None') {
    return this.tag(name, 'ByteProperty', (w) => w.fstring(enumType), (w) => (enumType === 'None' ? w.u8(v) : w.fstring(v)));
  }

  /** ネイティブ直列化の StructProperty（Vector / Guid / DateTime など）。body は生の値を書く。 */
  nativeStruct(name, structType, body) {
    return this.tag(name, 'StructProperty', (w) => w.fstring(structType).bytes(new Uint8Array(16)), body);
  }

  /** プロパティ列の struct（body に GvasWriter が渡る。none() は自動）。 */
  structProps(name, structType, body) {
    return this.tag(name, 'StructProperty', (w) => w.fstring(structType).bytes(new Uint8Array(16)), (w) => {
      const pw = new GvasWriter();
      body(pw);
      pw.none();
      w.bytes(pw.toBytes());
    });
  }

  /** 単純型の配列（NameProperty / IntProperty など）。 */
  array(name, inner, values) {
    return this.tag(name, 'ArrayProperty', (w) => w.fstring(inner), (w) => {
      w.u32(values.length);
      for (const v of values) writeItem(w, inner, v);
    });
  }

  /** ByteProperty の配列（RawData）。 */
  byteArray(name, bytes) {
    return this.tag(name, 'ArrayProperty', (w) => w.fstring('ByteProperty'), (w) => w.u32(bytes.length).bytes(bytes));
  }

  /** struct の配列。elem(w, value) が各要素を書く（プロパティ列なら none() まで）。 */
  structArray(name, structType, values, elem) {
    return this.tag(name, 'ArrayProperty', (w) => w.fstring('StructProperty'), (w) => {
      const inner = new GvasWriter();
      for (const v of values) elem(inner, v);
      const body = inner.toBytes();
      w.u32(values.length).fstring(name).fstring('StructProperty').u64(body.length)
        .fstring(structType).bytes(new Uint8Array(16)).u8(0).bytes(body);
    });
  }

  /** MapProperty。entries: [[key, value]]、writeKey / writeValue が中身を書く。 */
  map(name, keyType, valueType, entries, writeKey, writeValue) {
    return this.tag(name, 'MapProperty', (w) => w.fstring(keyType).fstring(valueType), (w) => {
      w.u32(0).u32(entries.length);
      for (const [k, v] of entries) {
        const kw = new GvasWriter();
        writeKey(kw, k);
        w.bytes(kw.toBytes());
        const vw = new GvasWriter();
        writeValue(vw, v);
        w.bytes(vw.toBytes());
      }
    });
  }

  /** SetProperty（要素は writeElem が書く）。 */
  set(name, inner, values, writeElem) {
    return this.tag(name, 'SetProperty', (w) => w.fstring(inner), (w) => {
      w.u32(0).u32(values.length);
      for (const v of values) {
        const ew = new GvasWriter();
        writeElem(ew, v);
        w.bytes(ew.toBytes());
      }
    });
  }

  /** 任意の型名で生の値を書く（未知の型のテスト用）。 */
  raw(name, type, valueBytes) {
    return this.tag(name, type, null, (w) => w.bytes(valueBytes));
  }
}

function writeItem(w, type, v) {
  switch (type) {
    case 'NameProperty':
    case 'StrProperty':
    case 'EnumProperty':
      return w.fstring(v);
    case 'IntProperty':
      return w.i32(v);
    case 'UInt32Property':
      return w.u32(v);
    case 'FloatProperty':
      return w.f32(v);
    case 'BoolProperty':
      return w.u8(v ? 1 : 0);
    case 'Int64Property':
      return w.i64(v);
    default:
      throw new Error(`writeItem: ${type}`);
  }
}

/**
 * GVAS ヘッダ（palsav の GvasHeader.write と同じ並び）。
 * @returns {GvasWriter} ヘッダを書いた writer（続けてプロパティを書く）
 */
export function gvasWithHeader({
  className = '/Script/Test.TestSaveGame',
  saveGameVersion = 3,
  customVersions = [['40d2fba7-4b48-4ce5-b038-5a75884e499e', 7]],
} = {}) {
  const w = new GvasWriter();
  w.u32(0x53415647).i32(saveGameVersion).i32(522);
  if (saveGameVersion >= 3) w.i32(1008);
  w.u16(5).u16(1).u16(1).u32(0).fstring('++UE5+Release-5.1');
  w.i32(3).u32(customVersions.length);
  for (const [g, v] of customVersions) w.guid(g).i32(v);
  w.fstring(className);
  return w;
}

/** プロパティ列 + 'None' + 4 バイトの trailer を付けて完成させる。 */
export function finishGvas(w) {
  w.none();
  w.u32(0);
  return w.toBytes();
}
