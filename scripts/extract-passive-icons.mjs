// ゲーム本体（Pal-Windows.pak）から、パッシブの表示に使う画像（ランクの矢印・背景の三角模様）を取り出して web/img/passive/ に書き出す。
// 枠・左の帯・色はゲーム画面（WBP_MainMenu_Pal_Skill_Passive）に合わせて CSS で描く。
// 使い方: npm run extract:passive-icons -- "<Palworld のインストール先>"
//   例: "C:\Program Files (x86)\Steam\steamapps\common\Palworld"（省略時は環境変数 PALWORLD_DIR か、この既定の場所）
// 読み取りのみ。pak は v11（暗号化なし・Oodle 圧縮）を想定する。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decompressOodle } from '../web/js/save/oodle.js';

const TEXTURE_DIR = 'Pal/Content/Pal/Texture/UI/Main_Menu/';
// 書き出す名前 → ゲーム内のテクスチャ名
export const PASSIVE_TEXTURES = {
  'rank-down': 'T_icon_skillstatus_rank_arrow_00',
  'rank-1': 'T_icon_skillstatus_rank_arrow_01',
  'rank-2': 'T_icon_skillstatus_rank_arrow_02',
  'rank-3': 'T_icon_skillstatus_rank_arrow_03',
  'rank-4': 'T_icon_skillstatus_rank_arrow_04',
  'rank-5': 'T_icon_skillstatus_rank_arrow_05',
  pattern: 'T_prt_pal_skill_base_02',
};

class Reader {
  constructor(buffer, pos = 0) { this.b = buffer; this.p = pos; }
  u8() { return this.b[this.p++]; }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  u64() { const v = Number(this.b.readBigUInt64LE(this.p)); this.p += 8; return v; }
  bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  string() {
    const n = this.i32();
    if (n === 0) return '';
    if (n < 0) return this.bytes(-n * 2).toString('utf16le').replace(/\0+$/, '');
    return this.bytes(n).toString('utf8').replace(/\0+$/, '');
  }
}

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, buffer, done, length - done, position + done);
    if (!n) throw new Error('pak の読み込みが途中で終わりました');
    done += n;
  }
  return buffer;
}

export function openPak(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const footer = new Reader(readAt(fd, size - 221, 221));
  footer.bytes(16);
  const encrypted = footer.u8();
  if (footer.u32() !== 0x5a6f12e1 || footer.u32() !== 11 || encrypted) throw new Error('暗号化または未対応の pak 形式です');
  const indexOffset = footer.u64();
  const indexSize = footer.u64();
  footer.bytes(20);
  const methods = Array.from({ length: 5 }, () => footer.bytes(32).toString('latin1').replace(/\0.*$/s, ''));
  const index = new Reader(readAt(fd, indexOffset, indexSize));
  index.string(); // mount point
  index.u32(); // entry count
  index.u64(); // path hash seed
  if (index.u32()) index.bytes(36); // path hash index
  if (!index.u32()) throw new Error('ディレクトリ索引がありません');
  const dirOffset = index.u64();
  const dirSize = index.u64();
  index.bytes(20);
  const encoded = index.bytes(index.u32());
  const directory = new Reader(readAt(fd, dirOffset, dirSize));
  const paths = new Map();
  for (let d = directory.u32(); d > 0; d--) {
    const parent = directory.string().replace(/^\/+/, '');
    for (let f = directory.u32(); f > 0; f--) {
      const name = directory.string();
      const at = directory.i32();
      if (at >= 0) paths.set(parent + name, at);
    }
  }
  function get(name) {
    if (!paths.has(name)) throw new Error(`pak に見つかりません: ${name}`);
    const r = new Reader(encoded, paths.get(name));
    const bits = r.u32();
    const comp = (bits >>> 23) & 63;
    const count = (bits >>> 6) & 65535;
    if (bits & (1 << 22)) throw new Error(`暗号化されたエントリーです: ${name}`);
    const num = (bit) => ((bits >>> bit) & 1 ? r.u32() : r.u64());
    const offset = num(31);
    const usize = num(30);
    if (comp) num(29);
    const head = new Reader(readAt(fd, offset, 53 + 4 + count * 16));
    head.u64(); head.u64(); head.u64();
    const actual = head.u32();
    head.bytes(20);
    const blocks = [];
    if (actual) for (let n = head.u32(); n > 0; n--) blocks.push([head.u64(), head.u64()]);
    const flags = head.u8();
    const blockSize = head.u32();
    if (flags & 1) throw new Error(`暗号化されたエントリーです: ${name}`);
    if (!actual) return readAt(fd, offset + head.p, usize);
    if (methods[actual - 1] !== 'Oodle') throw new Error(`未対応の圧縮方式: ${methods[actual - 1]}`);
    const parts = [];
    let remain = usize;
    for (const [start, end] of blocks) {
      const n = Math.min(blockSize, remain);
      parts.push(Buffer.from(decompressOodle(readAt(fd, offset + start, end - start), n)));
      remain -= n;
    }
    return Buffer.concat(parts);
  }
  return { get, close: () => fs.closeSync(fd) };
}

// ---- テクスチャ（DXT1 / DXT5）→ RGBA ----

const c565 = (c) => [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];

function decodeDxt(data, width, height, format) {
  const out = Buffer.alloc(width * height * 4);
  const blockBytes = format === 'PF_DXT5' ? 16 : 8;
  let p = 0;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      let alpha = null;
      let alphaBits = 0n;
      if (format === 'PF_DXT5') {
        const a0 = data[p];
        const a1 = data[p + 1];
        alpha = [a0, a1];
        if (a0 > a1) for (let i = 1; i <= 6; i++) alpha.push(((7 - i) * a0 + i * a1) / 7 | 0);
        else { for (let i = 1; i <= 4; i++) alpha.push(((5 - i) * a0 + i * a1) / 5 | 0); alpha.push(0, 255); }
        alphaBits = data.readUIntLE(p + 2, 6) ? BigInt(data.readUIntLE(p + 2, 6)) : 0n;
        p += 8;
      }
      const c0 = data.readUInt16LE(p);
      const c1 = data.readUInt16LE(p + 2);
      const bits = data.readUInt32LE(p + 4);
      const r0 = c565(c0);
      const r1 = c565(c1);
      const colors = c0 > c1 || format === 'PF_DXT5'
        ? [[...r0, 255], [...r1, 255], [...r0.map((v, i) => (2 * v + r1[i]) / 3 | 0), 255], [...r0.map((v, i) => (v + 2 * r1[i]) / 3 | 0), 255]]
        : [[...r0, 255], [...r1, 255], [...r0.map((v, i) => (v + r1[i]) / 2 | 0), 255], [0, 0, 0, 0]];
      p += 8;
      for (let i = 0; i < 16; i++) {
        const x = bx + (i % 4);
        const y = by + (i >> 2);
        if (x >= width || y >= height) continue;
        const color = colors[(bits >>> (2 * i)) & 3];
        const o = (y * width + x) * 4;
        out[o] = color[0]; out[o + 1] = color[1]; out[o + 2] = color[2];
        out[o + 3] = alpha ? alpha[Number((alphaBits >> BigInt(3 * i)) & 7n)] : color[3];
      }
    }
  }
  if (p > data.length) throw new Error('テクスチャのデータが足りません');
  return out;
}

export function readTexture(uexp) {
  const at = uexp.indexOf(Buffer.from('PF_'));
  if (at < 16) throw new Error('テクスチャの形式が見つかりません');
  const width = uexp.readInt32LE(at - 16);
  const height = uexp.readInt32LE(at - 12);
  const format = uexp.toString('latin1', at, uexp.indexOf(0, at));
  if (!['PF_DXT1', 'PF_DXT5'].includes(format)) throw new Error(`未対応のテクスチャ形式: ${format}`);
  const size = Math.ceil(width / 4) * Math.ceil(height / 4) * (format === 'PF_DXT5' ? 16 : 8);
  const marker = Buffer.alloc(8);
  marker.writeUInt32LE(size, 0);
  marker.writeUInt32LE(size, 4);
  const k = uexp.indexOf(marker, at);
  if (k < 0) throw new Error('最初の mip のデータが見つかりません');
  return { width, height, format, rgba: decodeDxt(uexp.subarray(k + 16, k + 16 + size), width, height, format) };
}

// ---- PNG ----

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function main() {
  const gameDir = process.argv[2] || process.env.PALWORLD_DIR || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Palworld';
  const pakFile = path.join(gameDir, 'Pal', 'Content', 'Paks', 'Pal-Windows.pak');
  if (!fs.existsSync(pakFile)) throw new Error(`pak が見つかりません: ${pakFile}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.join(root, 'web', 'img', 'passive');
  fs.mkdirSync(outDir, { recursive: true });
  const pak = openPak(pakFile);
  try {
    for (const [name, texture] of Object.entries(PASSIVE_TEXTURES)) {
      const { width, height, format, rgba } = readTexture(pak.get(`${TEXTURE_DIR}${texture}.uexp`));
      fs.writeFileSync(path.join(outDir, `${name}.png`), encodePng(width, height, rgba));
      console.log(`書き出し: web/img/passive/${name}.png（${texture}, ${width}×${height}, ${format}）`);
    }
  } finally {
    pak.close();
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
