// Unreal Engine GVAS (SaveGame) 読み取り器。依存なし・ブラウザ用（Uint8Array / DataView / TextDecoder のみ）。
// 参照実装: PalworldSaveTools の palsav (MIT) の archive.py / gvas.py。パスの付け方は palsav と同じ。
//
// 値の形（軽量）:
//   struct → 子プロパティのプレーンオブジェクト（Vector/Quat/Guid/DateTime 等のネイティブ型は専用の形）
//   map → [{ key, value }]、array / set → 配列、ByteProperty の配列 → Uint8Array（元バッファの subarray）
//   Enum/Name/Str → 文字列、数値 → number、Int64/UInt64/DateTime → 安全なら number、超えたら 10 進文字列
//   Guid → 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'（palsav の UUID.__str__ と同じ）

/** GVAS ファイル先頭のマジック 'GVAS'（リトルエンディアン u32）。 */
export const GVAS_MAGIC = 0x53415647;

/** すべてゼロの GUID 文字列。 */
export const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

/**
 * Map のキー / 値、Set の要素の struct 型ヒント（palsav paltypes.py の PALWORLD_TYPE_HINTS と同じ）。
 * GVAS には Map の key/value の struct 型名が保存されないため、パスから引く。
 */
export const PALWORLD_TYPE_HINTS = Object.freeze({
  '.worldSaveData.CharacterContainerSaveData.Key': 'StructProperty',
  '.worldSaveData.CharacterSaveParameterMap.Key': 'StructProperty',
  '.worldSaveData.CharacterSaveParameterMap.Value': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Key': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value.InstanceDataMap.Key': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value.InstanceDataMap.Value': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value': 'StructProperty',
  '.worldSaveData.ItemContainerSaveData.Key': 'StructProperty',
  '.worldSaveData.MapObjectSaveData.MapObjectSaveData.ConcreteModel.ModuleMap.Value': 'StructProperty',
  '.worldSaveData.MapObjectSaveData.MapObjectSaveData.Model.EffectMap.Value': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Key': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Key': 'Guid',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Value': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Value.ItemMap.Value': 'StructProperty',
  '.worldSaveData.WorkSaveData.WorkSaveData.WorkAssignMap.Value': 'StructProperty',
  '.worldSaveData.BaseCampSaveData.Key': 'Guid',
  '.worldSaveData.BaseCampSaveData.Value': 'StructProperty',
  '.worldSaveData.BaseCampSaveData.Value.ModuleMap.Value': 'StructProperty',
  '.worldSaveData.ItemContainerSaveData.Value': 'StructProperty',
  '.worldSaveData.CharacterContainerSaveData.Value': 'StructProperty',
  '.worldSaveData.GroupSaveDataMap.Key': 'Guid',
  '.worldSaveData.GroupSaveDataMap.Value': 'StructProperty',
  '.worldSaveData.EnemyCampSaveData.EnemyCampStatusMap.Value': 'StructProperty',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.MapObjectSaveData.MapObjectSaveData.Model.EffectMap.Value': 'StructProperty',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.MapObjectSaveData.MapObjectSaveData.ConcreteModel.ModuleMap.Value': 'StructProperty',
  '.worldSaveData.InvaderSaveData.Key': 'Guid',
  '.worldSaveData.InvaderSaveData.Value': 'StructProperty',
  '.worldSaveData.OilrigSaveData.OilrigMap.Value': 'StructProperty',
  '.worldSaveData.SupplySaveData.SupplyInfos.Key': 'Guid',
  '.worldSaveData.SupplySaveData.SupplyInfos.Value': 'StructProperty',
  '.worldSaveData.GuildExtraSaveDataMap.Key': 'Guid',
  '.worldSaveData.GuildExtraSaveDataMap.Value': 'StructProperty',
  '.worldSaveData.EnemyCampSaveData.EnemyCampStatusMap.Value.TreasureBoxInfoMapBySpawnerName.Value': 'StructProperty',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.RewardSaveDataMap.Key': 'Guid',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.RewardSaveDataMap.Value': 'StructProperty',
  '.SaveData.Local_MaxFriendshipPalIds.Key': 'StructProperty',
  '.worldSaveData.InvaderDeclarationSaveData.ValidatedStartPointIds.StructProperty': 'Guid',
  '.SaveData.Local_MaxFriendshipPalIds.Value': 'StructProperty',
});

/** 読み取り失敗（データ不足・未知の型など）。offset と path を持つ。 */
export class GvasError extends Error {
  /**
   * @param {string} message
   * @param {number} offset 失敗した位置（reader の先頭からのバイト数）
   * @param {string} path 読んでいたプロパティのパス
   */
  constructor(message, offset, path) {
    super(`${message} (offset ${offset}${path ? `, path ${path}` : ''})`);
    this.name = 'GvasError';
    this.offset = offset;
    this.path = path;
  }
}

// ---- 文字列デコード ----

const HEX = [];
for (let i = 0; i < 256; i++) HEX.push((i < 16 ? '0' : '') + i.toString(16));

const utf16Decoder = new TextDecoder('utf-16le');

// 短い 8bit 文字列のキャッシュ。プロパティ名・型名は何百万回も繰り返すので、毎回 String を作らない。
const STR_CACHE_BITS = 12;
const STR_CACHE_MASK = (1 << STR_CACHE_BITS) - 1;
const STR_CACHE_MAX_LEN = 48;
const strCache = new Array(1 << STR_CACHE_BITS).fill('');

function latin1Slow(u8, a, b) {
  // String.fromCharCode は Latin-1 をそのまま写す（TextDecoder('latin1') は実際は windows-1252 なので使わない）
  let s = '';
  for (let i = a; i < b; i += 8192) {
    s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(b, i + 8192)));
  }
  return s;
}

function latin1(u8, a, b) {
  const n = b - a;
  if (n <= 0) return '';
  if (n > STR_CACHE_MAX_LEN) return latin1Slow(u8, a, b);
  let h = n;
  for (let i = a; i < b; i++) h = (Math.imul(h, 31) + u8[i]) | 0;
  h = (h ^ (h >>> 15)) & STR_CACHE_MASK;
  const c = strCache[h];
  if (c.length === n) {
    let i = 0;
    while (i < n && c.charCodeAt(i) === u8[a + i]) i++;
    if (i === n) return c;
  }
  const s = latin1Slow(u8, a, b);
  strCache[h] = s;
  return s;
}

/**
 * 16 バイトの FGuid を palsav / UE (DigitsWithHyphens, 小文字) と同じ文字列にする。
 * @param {Uint8Array} u8
 * @param {number} p 先頭位置
 * @returns {string}
 */
export function guidAt(u8, p) {
  return HEX[u8[p + 3]] + HEX[u8[p + 2]] + HEX[u8[p + 1]] + HEX[u8[p]] + '-' +
    HEX[u8[p + 7]] + HEX[u8[p + 6]] + '-' + HEX[u8[p + 5]] + HEX[u8[p + 4]] + '-' +
    HEX[u8[p + 11]] + HEX[u8[p + 10]] + '-' + HEX[u8[p + 9]] + HEX[u8[p + 8]] +
    HEX[u8[p + 15]] + HEX[u8[p + 14]] + HEX[u8[p + 13]] + HEX[u8[p + 12]];
}

function toU8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new TypeError('expected Uint8Array or ArrayBuffer');
}

const TWO32 = 4294967296;

/**
 * GVAS のバイナリ読み取り器。RawData（バイト配列に埋め込まれたプロパティ列）にも同じクラスを使える。
 * 位置は渡したバイト列の先頭からの相対値。
 */
export class GvasReader {
  /**
   * @param {Uint8Array|ArrayBuffer} bytes 読み取るバイト列（コピーしない）
   * @param {object} [options]
   * @param {(path: string, name: string, parentPath: string, type: string) => boolean} [options.skip]
   *   true を返したプロパティは値を読まずにサイズ分飛ばし、結果にも入れない
   * @param {Record<string, string>|Map<string, string>} [options.typeHints] Map/Set の struct 型ヒント
   * @param {(error: GvasError, path: string) => boolean} [options.onError] 指定すると回復モード。
   *   プロパティの読み取りに失敗したとき内側の階層から順に呼ばれ、true を返した階層でそのプロパティを
   *   サイズ分飛ばして続行する（結果には入れない）
   */
  constructor(bytes, options = {}) {
    const u8 = toU8(bytes);
    this.u8 = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.pos = 0;
    this.end = u8.length;
    this.skip = options.skip || null;
    this.onError = options.onError || null;
    const hints = options.typeHints || PALWORLD_TYPE_HINTS;
    this.hints = hints instanceof Map ? hints : new Map(Object.entries(hints));
    this.path = '';
  }

  /**
   * 同じ設定（skip / typeHints）で別のバイト列を読む reader を作る。
   * @param {Uint8Array} bytes
   * @param {object} [options] 上書きする設定
   * @returns {GvasReader}
   */
  fork(bytes, options = {}) {
    return new GvasReader(bytes, {
      skip: 'skip' in options ? options.skip : this.skip,
      typeHints: options.typeHints || this.hints,
      onError: 'onError' in options ? options.onError : this.onError,
    });
  }

  /** 残りバイト数。 */
  get remaining() {
    return this.end - this.pos;
  }

  /** 末尾まで読んだか。 */
  eof() {
    return this.pos >= this.end;
  }

  truncated(n) {
    return new GvasError(`unexpected end of data: need ${n} byte(s), ${this.end - this.pos} left`, this.pos, this.path);
  }

  error(message) {
    return new GvasError(message, this.pos, this.path);
  }

  // ---- プリミティブ ----

  u8v() {
    if (this.pos >= this.end) throw this.truncated(1);
    return this.u8[this.pos++];
  }

  i8() {
    if (this.pos >= this.end) throw this.truncated(1);
    return this.dv.getInt8(this.pos++);
  }

  bool() {
    return this.u8v() !== 0;
  }

  u16() {
    const p = this.pos;
    if (p + 2 > this.end) throw this.truncated(2);
    this.pos = p + 2;
    return this.dv.getUint16(p, true);
  }

  i16() {
    const p = this.pos;
    if (p + 2 > this.end) throw this.truncated(2);
    this.pos = p + 2;
    return this.dv.getInt16(p, true);
  }

  u32() {
    const p = this.pos;
    if (p + 4 > this.end) throw this.truncated(4);
    this.pos = p + 4;
    return this.dv.getUint32(p, true);
  }

  i32() {
    const p = this.pos;
    if (p + 4 > this.end) throw this.truncated(4);
    this.pos = p + 4;
    return this.dv.getInt32(p, true);
  }

  /** @returns {number|string} 2^53 を超える値は 10 進文字列 */
  i64() {
    const p = this.pos;
    if (p + 8 > this.end) throw this.truncated(8);
    this.pos = p + 8;
    const lo = this.dv.getUint32(p, true);
    const hi = this.dv.getInt32(p + 4, true);
    if (hi >= -0x200000 && hi < 0x200000) return hi * TWO32 + lo;
    return (BigInt(hi) * 4294967296n + BigInt(lo)).toString();
  }

  /** @returns {number|string} 2^53 を超える値は 10 進文字列 */
  u64() {
    const p = this.pos;
    if (p + 8 > this.end) throw this.truncated(8);
    this.pos = p + 8;
    const lo = this.dv.getUint32(p, true);
    const hi = this.dv.getUint32(p + 4, true);
    if (hi < 0x200000) return hi * TWO32 + lo;
    return (BigInt(hi) * 4294967296n + BigInt(lo)).toString();
  }

  f32() {
    const p = this.pos;
    if (p + 4 > this.end) throw this.truncated(4);
    this.pos = p + 4;
    return this.dv.getFloat32(p, true);
  }

  f64() {
    const p = this.pos;
    if (p + 8 > this.end) throw this.truncated(8);
    this.pos = p + 8;
    return this.dv.getFloat64(p, true);
  }

  /** 16 バイトの GUID を文字列で返す。 */
  guid() {
    const p = this.pos;
    if (p + 16 > this.end) throw this.truncated(16);
    this.pos = p + 16;
    return guidAt(this.u8, p);
  }

  /** 1 バイトのフラグ + (あれば) GUID。無ければ null。 */
  optionalGuid() {
    if (this.u8v() === 0) return null;
    return this.guid();
  }

  /** n バイトを Uint8Array（subarray、コピーなし）で返す。 */
  bytes(n) {
    const p = this.pos;
    if (n < 0 || p + n > this.end) throw this.truncated(n);
    this.pos = p + n;
    return this.u8.subarray(p, p + n);
  }

  /** n バイト読み飛ばす。 */
  skipBytes(n) {
    if (n < 0 || this.pos + n > this.end) throw this.truncated(n);
    this.pos += n;
  }

  /** FString: 正の長さ = 8bit (Latin-1)、負の長さ = UTF-16LE。どちらも終端 NUL を含む。 */
  fstring() {
    const len = this.i32();
    if (len === 0) return '';
    const p = this.pos;
    if (len > 0) {
      if (p + len > this.end) throw this.truncated(len);
      this.pos = p + len;
      return latin1(this.u8, p, p + len - 1);
    }
    const n = -len * 2;
    if (p + n > this.end) throw this.truncated(n);
    this.pos = p + n;
    return utf16Decoder.decode(this.u8.subarray(p, p + n - 2));
  }

  /** u32 の個数 + 要素（fn で読む）。 */
  tarray(fn) {
    const count = this.u32();
    if (count > this.end - this.pos) throw this.error(`array count ${count} exceeds remaining data`);
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = fn(this);
    return out;
  }

  /** FVector (UE5: double × 3)。 */
  vector() {
    return { x: this.f64(), y: this.f64(), z: this.f64() };
  }

  /** FQuat (double × 4)。 */
  quat() {
    return { x: this.f64(), y: this.f64(), z: this.f64(), w: this.f64() };
  }

  /** RawData でよく出る FTransform（rotation, translation, scale3d）。 */
  transform() {
    return { rotation: this.quat(), translation: this.vector(), scale3d: this.vector() };
  }

  // ---- GVAS ヘッダ ----

  /**
   * GVAS ヘッダを読む。
   * @returns {object} header
   */
  readHeader() {
    this.path = '<header>';
    const magic = this.u32();
    if (magic !== GVAS_MAGIC) throw this.error(`not a GVAS file (magic 0x${magic.toString(16)})`);
    const saveGameVersion = this.i32();
    const packageFileVersionUE4 = this.i32();
    // SaveGameVersion 3 から UE5 のパッケージバージョンが入る
    const packageFileVersionUE5 = saveGameVersion >= 3 ? this.i32() : 0;
    const engineVersion = {
      major: this.u16(),
      minor: this.u16(),
      patch: this.u16(),
      changelist: this.u32(),
      branch: this.fstring(),
    };
    const customVersionFormat = this.i32();
    if (customVersionFormat !== 3) throw this.error(`unsupported custom version format ${customVersionFormat}`);
    const customVersions = this.tarray((r) => ({ guid: r.guid(), version: r.i32() }));
    const saveGameClassName = this.fstring();
    this.path = '';
    return {
      magic, saveGameVersion, packageFileVersionUE4, packageFileVersionUE5, engineVersion,
      customVersionFormat, customVersions, saveGameClassName,
    };
  }

  // ---- プロパティ ----

  /**
   * 'None' まで続くプロパティ列を読む。
   * @param {string} [path] 親のパス（ルートは ''）
   * @returns {Record<string, any>}
   */
  readProperties(path = '') {
    const out = {};
    const skip = this.skip;
    for (;;) {
      this.path = path;
      const name = this.fstring();
      if (name === 'None') return out;
      const type = this.fstring();
      const size = this.u32();
      const index = this.u32(); // 固定長配列の ArrayIndex（palsav は size と合わせて u64 として読む）
      const childPath = path + '.' + name;
      this.path = childPath;
      if (skip !== null && skip(childPath, name, path, type)) {
        this.skipTagHeader(type);
        this.skipBytes(size);
        continue;
      }
      let value;
      if (this.onError === null) {
        value = this.readProperty(type, size, childPath);
      } else {
        // 回復モード: 壊れたプロパティはサイズ分飛ばして続行（onError が true を返した階層で回復）
        const tagPos = this.pos;
        try {
          value = this.readProperty(type, size, childPath);
        } catch (e) {
          if (!(e instanceof GvasError) || !this.onError(e, childPath)) throw e;
          this.pos = tagPos;
          this.skipTagHeader(type);
          this.skipBytes(size);
          continue;
        }
      }
      if (index === 0) out[name] = value;
      else out[name + '[' + index + ']'] = value;
    }
  }

  /** プロパティタグの型ごとのヘッダを読み飛ばす（skip 用）。 */
  skipTagHeader(type) {
    switch (type) {
      case 'StructProperty':
        this.skipFString();
        this.skipBytes(16);
        break;
      case 'ArrayProperty':
      case 'SetProperty':
      case 'ByteProperty':
      case 'EnumProperty':
        this.skipFString();
        break;
      case 'MapProperty':
        this.skipFString();
        this.skipFString();
        break;
      case 'BoolProperty':
        this.skipBytes(1);
        break;
      default:
        // それ以外の UE プロパティはタグに GUID フラグしか持たない
        break;
    }
    if (this.u8v() !== 0) this.skipBytes(16);
  }

  skipFString() {
    const len = this.i32();
    this.skipBytes(len >= 0 ? len : -len * 2);
  }

  /**
   * タグ（name/type/size の後）から 1 つのプロパティの値を読む。
   * @param {string} type 'IntProperty' など
   * @param {number} size 値部分のバイト数
   * @param {string} path このプロパティのパス
   */
  readProperty(type, size, path) {
    switch (type) {
      case 'StructProperty': {
        const structType = this.fstring();
        this.skipBytes(16); // struct guid（常にゼロ）
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.readStructValue(structType, path);
      }
      case 'ArrayProperty': {
        const inner = this.fstring();
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.readArrayValue(inner, size, path);
      }
      case 'IntProperty':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.i32();
      case 'NameProperty':
      case 'StrProperty':
      case 'ObjectProperty':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.fstring();
      case 'BoolProperty': {
        const v = this.u8v() !== 0;
        if (this.u8v() !== 0) this.skipBytes(16);
        return v;
      }
      case 'EnumProperty': {
        this.skipFString(); // enum 型名
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.fstring();
      }
      case 'ByteProperty': {
        const enumName = this.fstring();
        if (this.u8v() !== 0) this.skipBytes(16);
        return enumName === 'None' ? this.u8v() : this.fstring();
      }
      case 'FloatProperty':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.f32();
      case 'DoubleProperty':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.f64();
      case 'Int64Property':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.i64();
      case 'UInt64Property':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.u64();
      case 'UInt32Property':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.u32();
      case 'UInt16Property':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.u16();
      case 'Int16Property':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.i16();
      case 'Int8Property':
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.i8();
      case 'FixedPoint64Property':
        // palsav は i32 として読む。サイズで判断する
        if (this.u8v() !== 0) this.skipBytes(16);
        return size === 8 ? this.i64() : this.i32();
      case 'SoftObjectProperty': {
        // FSoftObjectPath = アセットパス + サブパス（どちらも FString）
        if (this.u8v() !== 0) this.skipBytes(16);
        const start = this.pos;
        const asset = this.fstring();
        if (this.pos - start < size) {
          const sub = this.fstring();
          return sub ? asset + ':' + sub : asset;
        }
        return asset;
      }
      case 'MapProperty': {
        const keyType = this.fstring();
        const valueType = this.fstring();
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.readMapValue(keyType, valueType, path);
      }
      case 'SetProperty': {
        const inner = this.fstring();
        if (this.u8v() !== 0) this.skipBytes(16);
        return this.readSetValue(inner, path);
      }
      default:
        throw this.error(`unknown property type: ${type}`);
    }
  }

  /**
   * struct の中身を読む。ネイティブ直列化される UE 型以外はプロパティ列。
   * @param {string} structType
   * @param {string} path
   */
  readStructValue(structType, path) {
    switch (structType) {
      case 'Guid':
        return this.guid();
      case 'Vector':
        return { x: this.f64(), y: this.f64(), z: this.f64() };
      case 'DateTime':
        return this.u64(); // ticks (100ns, 0001-01-01 起点)
      case 'Quat':
        return { x: this.f64(), y: this.f64(), z: this.f64(), w: this.f64() };
      case 'LinearColor':
        return { r: this.f32(), g: this.f32(), b: this.f32(), a: this.f32() };
      case 'Color':
        return { b: this.u8v(), g: this.u8v(), r: this.u8v(), a: this.u8v() };
      // 以下は palsav に無いが UE ではネイティブ直列化される型
      case 'Rotator':
        return { pitch: this.f64(), yaw: this.f64(), roll: this.f64() };
      case 'Vector2D':
        return { x: this.f64(), y: this.f64() };
      case 'IntPoint':
        return { x: this.i32(), y: this.i32() };
      case 'IntVector':
        return { x: this.i32(), y: this.i32(), z: this.i32() };
      case 'Timespan':
        return this.i64();
      default:
        return this.readProperties(path);
    }
  }

  /**
   * ArrayProperty の中身。
   * @param {string} inner 要素の型
   * @param {number} size 値部分のバイト数
   * @param {string} path
   */
  readArrayValue(inner, size, path) {
    const count = this.u32();
    switch (inner) {
      case 'ByteProperty':
        if (size === count + 4) return this.bytes(count);
        return this.readItems('NameProperty', count, path); // enum 名の配列
      case 'StructProperty': {
        // 要素共通のタグ: prop 名, 型, サイズ, struct 型, guid, guid フラグ
        const propName = this.fstring();
        this.skipFString(); // 'StructProperty'
        this.skipBytes(8);
        const structType = this.fstring();
        this.skipBytes(16);
        if (this.u8v() !== 0) this.skipBytes(16);
        if (count > this.end - this.pos) throw this.error(`array count ${count} exceeds remaining data`);
        const elemPath = path + '.' + propName;
        const out = new Array(count);
        for (let i = 0; i < count; i++) out[i] = this.readStructValue(structType, elemPath);
        return out;
      }
      default:
        return this.readItems(inner, count, path);
    }
  }

  readItems(type, count, path) {
    if (count > this.end - this.pos) throw this.error(`array count ${count} exceeds remaining data`);
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = this.readItem(type, null, path);
    return out;
  }

  /**
   * Map のキー / 値、Set / Array の要素（タグなしの値）を読む。
   * @param {string} type
   * @param {string|null} structType type が StructProperty のときの struct 型
   * @param {string} path
   */
  readItem(type, structType, path) {
    switch (type) {
      case 'StructProperty':
        return this.readStructValue(structType, path);
      case 'NameProperty':
      case 'StrProperty':
      case 'EnumProperty':
      case 'ObjectProperty':
      case 'SoftObjectProperty':
        return this.fstring();
      case 'IntProperty':
        return this.i32();
      case 'BoolProperty':
        return this.u8v() !== 0;
      case 'ByteProperty':
        return this.u8v();
      case 'UInt32Property':
        return this.u32();
      case 'Int64Property':
        return this.i64();
      case 'UInt64Property':
        return this.u64();
      case 'FloatProperty':
        return this.f32();
      case 'DoubleProperty':
        return this.f64();
      case 'UInt16Property':
        return this.u16();
      case 'Int16Property':
        return this.i16();
      case 'Int8Property':
        return this.i8();
      case 'Guid':
        return this.guid(); // palsav 互換（array_type 'Guid'）
      default:
        throw this.error(`unknown value type: ${type}`);
    }
  }

  /**
   * MapProperty の中身。キー / 値が struct の場合は型ヒント（path + '.Key' / '.Value'）を使う。
   * @returns {{ key: any, value: any }[]}
   */
  readMapValue(keyType, valueType, path) {
    const keyPath = path + '.Key';
    const valuePath = path + '.Value';
    const keyStruct = keyType === 'StructProperty' ? (this.hints.get(keyPath) || 'Guid') : null;
    const valueStruct = valueType === 'StructProperty' ? (this.hints.get(valuePath) || 'StructProperty') : null;
    // 削除キー（差分保存用。セーブでは通常 0）
    const removed = this.u32();
    for (let i = 0; i < removed; i++) this.readItem(keyType, keyStruct, keyPath);
    const count = this.u32();
    if (count > this.end - this.pos) throw this.error(`map count ${count} exceeds remaining data`);
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      const key = this.readItem(keyType, keyStruct, keyPath);
      const value = this.readItem(valueType, valueStruct, valuePath);
      out[i] = { key, value };
    }
    return out;
  }

  /**
   * SetProperty の中身。struct の要素のパスは palsav と同じく path + '.StructProperty'。
   * （palsav は非 struct の Set をプロパティ列として読むが、ここでは UE どおり値として読む）
   */
  readSetValue(inner, path) {
    let elemPath = path;
    let structType = null;
    if (inner === 'StructProperty') {
      elemPath = path + '.StructProperty';
      structType = this.hints.get(elemPath) || 'StructProperty';
    }
    const removed = this.u32();
    for (let i = 0; i < removed; i++) this.readItem(inner, structType, elemPath);
    const count = this.u32();
    if (count > this.end - this.pos) throw this.error(`set count ${count} exceeds remaining data`);
    const out = new Array(count);
    for (let i = 0; i < count; i++) out[i] = this.readItem(inner, structType, elemPath);
    return out;
  }
}

/**
 * GVAS バイト列（解凍済み）を読む。
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {object} [options]
 * @param {(path: string, name: string, parentPath: string, type: string) => boolean} [options.skip]
 *   プロパティのドット区切りパス（palsav と同じ規則。例 '.worldSaveData.FoliageGridSaveDataMap'）を受け取り、
 *   true なら値を読まずに飛ばす
 * @param {Record<string, string>} [options.typeHints] 既定は PALWORLD_TYPE_HINTS
 * @param {(error: GvasError, path: string) => boolean} [options.onError] 回復モード（GvasReader 参照）
 * @returns {{ header: object, properties: Record<string, any>, trailer: Uint8Array }}
 */
export function readGvas(bytes, options = {}) {
  const r = new GvasReader(bytes, options);
  const header = r.readHeader();
  const properties = r.readProperties('');
  const trailer = r.bytes(r.remaining);
  return { header, properties, trailer };
}

/**
 * GVAS ヘッダだけを読む（ファイル種別の判定用）。
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {object}
 */
export function readGvasHeader(bytes) {
  return new GvasReader(bytes).readHeader();
}
