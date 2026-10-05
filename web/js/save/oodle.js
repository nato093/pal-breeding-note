// Oodle（Kraken / Mermaid / Selkie）の展開処理。
// Rust 製の oozextract 0.4.2（MIT License, https://github.com/lvlvllvlvllvlvl/oozextract）を JavaScript に移植したもの。
//
// 移植元のライセンス（MIT License）:
//   Copyright (c) oozextract contributors (https://github.com/lvlvllvlvllvlvl/oozextract)
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//   SOFTWARE.
//
// 関数名は移植元（Rust）の関数に対応させてある（例: Core#decodeBytes = decoder/mod.rs の decode_bytes）。

const SMALL_BLOCK = 0x4000;
const LARGE_BLOCK = 0x40000;

const TYPE_LZNA = 0x5;
const TYPE_KRAKEN = 0x6;
const TYPE_MERMAID = 0xA;
const TYPE_BITKNIT = 0xB;
const TYPE_LEVIATHAN = 0xC;

// エントロピー符号のネスト上限（壊れたデータでのスタック溢れ防止）
const MAX_DEPTH = 32;
const MAX_RAW_SIZE = 0x7FFFFFFF;

const EMPTY = new Uint8Array(0);

function corrupt(where) {
  return new Error(`Oodle データが壊れています（${where}）`);
}

function unsupported(name) {
  return new Error(`未対応の Oodle 形式: ${name}`);
}

// ---------------------------------------------------------------------------
// テーブル
// ---------------------------------------------------------------------------

// decoder/huffman.rs BASE_PREFIX
const BASE_PREFIX = [0x0, 0x0, 0x2, 0x6, 0xE, 0x1E, 0x3E, 0x7E, 0xFE, 0x1FE, 0x2FE, 0x3FE];

// 11 ビットのビット反転（huffman.rs reverse_lut 相当）
const REV11 = new Uint16Array(2048);
for (let i = 0; i < 2048; i++) {
  let r = 0;
  for (let b = 0; b < 11; b++) {
    if (i & (1 << b)) r |= 1 << (10 - b);
  }
  REV11[i] = r;
}

// decoder/mod.rs decode_golomb_rice_lengths の K_RICE_CODE_BITS2VALUE を計算で作る（移植元の表と全要素一致を確認済み）。
// バイト v を上位ビットから読み、1 で終わる各値の「0 の個数」を 4 ビットずつ詰める
// （値 0〜3 は各バイトの下位 4 ビット、値 4〜7 は上位 4 ビット）。最上位 4 ビットは末尾の 0 の個数。
const RICE_BITS2VALUE = new Int32Array(256);
RICE_BITS2VALUE[0] = 0x80000000 | 0;
for (let v = 1; v < 256; v++) {
  let x = 0;
  let zeros = 0;
  let k = 0;
  for (let b = 7; b >= 0; b--) {
    if ((v >> b) & 1) {
      x |= zeros << (k < 4 ? 8 * k : 8 * (k - 4) + 4);
      k++;
      zeros = 0;
    } else {
      zeros++;
    }
  }
  RICE_BITS2VALUE[v] = x | (zeros << 28);
}

// K_RICE_CODE_BITS2LEN = 各バイトの立っているビット数
const RICE_BITS2LEN = new Uint8Array(256);
for (let i = 1; i < 256; i++) RICE_BITS2LEN[i] = RICE_BITS2LEN[i >> 1] + (i & 1);

// decode_multi_array の BITMASKS（BITMASKS[n] = 2^(n+1) - 1）
const BITMASKS = new Int32Array(32);
for (let i = 0; i < 32; i++) BITMASKS[i] = i === 31 ? -1 : (2 ** (i + 1)) - 1;

// ---------------------------------------------------------------------------
// 公開 API（ooz/mod.rs Extractor 相当）
// ---------------------------------------------------------------------------

/**
 * Oodle 圧縮データを展開する。
 * @param {Uint8Array} src  Oodle stream (block headers + quanta), may have trailing bytes
 * @param {number} rawSize  exact decompressed size
 * @returns {Uint8Array} decompressed bytes (length === rawSize)
 * @throws {Error} on corrupt / unsupported input (never hangs, never reads/writes out of bounds silently)
 */
export function decompressOodle(src, rawSize) {
  if (!ArrayBuffer.isView(src)) {
    if (src instanceof ArrayBuffer) src = new Uint8Array(src);
    else throw new TypeError('decompressOodle: src には Uint8Array を渡してください');
  } else if (!(src instanceof Uint8Array)) {
    src = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  }
  if (!Number.isSafeInteger(rawSize) || rawSize < 0 || rawSize > MAX_RAW_SIZE) {
    throw new RangeError(`decompressOodle: rawSize が不正です: ${rawSize}`);
  }
  if (rawSize === 0) return new Uint8Array(0);
  // 256KB ブロックごとに最低 3 バイトは必要。明らかに足りない場合は巨大な確保をせずに失敗させる
  if (Math.ceil(rawSize / LARGE_BLOCK) * 3 > src.length) throw corrupt('size');

  const out = new Uint8Array(rawSize);
  const core = new Core(out);
  const srcLen = src.length;
  let pos = 0;
  let written = 0;
  let decoderType = 0;
  let uncompressed = false;
  let useChecksums = false;
  let blockSize = LARGE_BLOCK;

  while (written < rawSize) {
    if ((written & 0x3FFFF) === 0) {
      // parse_header: ブロックヘッダ（2 バイト）
      if (srcLen - pos < 2) throw corrupt('block header');
      const b1 = src[pos];
      const b2 = src[pos + 1];
      pos += 2;
      if ((b1 & 0xF) !== 0xC || ((b1 >> 4) & 3) !== 0) throw corrupt('block header');
      // (b1 >> 7) は restart_decoder（LZNA / Bitknit でのみ使う）
      uncompressed = ((b1 >> 6) & 1) === 1;
      decoderType = b2 & 0x7F;
      useChecksums = (b2 >> 7) !== 0;
      if (decoderType !== TYPE_KRAKEN && decoderType !== TYPE_MERMAID && decoderType !== TYPE_LEVIATHAN &&
        decoderType !== TYPE_LZNA && decoderType !== TYPE_BITKNIT) {
        throw unsupported(`decoder type 0x${decoderType.toString(16)}`);
      }
      blockSize = (decoderType === TYPE_LZNA || decoderType === TYPE_BITKNIT) ? SMALL_BLOCK : LARGE_BLOCK;
    }

    // extract_block
    const dstLeft = Math.min(rawSize - written, blockSize);

    if (uncompressed) {
      if (srcLen - pos < dstLeft) throw corrupt('uncompressed block');
      out.set(src.subarray(pos, pos + dstLeft), written);
      pos += dstLeft;
      written += dstLeft;
      continue;
    }

    // parse_quantum_header
    let compSize = 0;
    if (blockSize === LARGE_BLOCK) {
      if (srcLen - pos < 3) throw corrupt('quantum header');
      const v = (src[pos] << 16) | (src[pos + 1] << 8) | src[pos + 2];
      pos += 3;
      const size = v & 0x3FFFF;
      if (size !== 0x3FFFF) {
        compSize = size + 1;
      } else if ((v >> 18) === 1) {
        // memset クォンタム
        if (srcLen - pos < 1) throw corrupt('quantum header');
        out.fill(src[pos], written, written + dstLeft);
        pos += 1;
        written += dstLeft;
        continue;
      } else {
        throw corrupt('quantum header');
      }
    } else {
      if (srcLen - pos < 2) throw corrupt('quantum header');
      const v = (src[pos] << 8) | src[pos + 1];
      pos += 2;
      const size = v & 0x3FFF;
      if (size !== 0x3FFF) {
        compSize = size + 1;
      } else {
        const kind = v >> 14;
        if (kind === 0) {
          // whole match クォンタム（parse_whole_match）
          if (srcLen - pos < 2) throw corrupt('whole match');
          const w = (src[pos] << 8) | src[pos + 1];
          pos += 2;
          let dist;
          if (w < 0x8000) {
            let x = 0;
            let shift = 0;
            for (;;) {
              if (pos >= srcLen || shift > 28) throw corrupt('whole match');
              const b = src[pos++];
              if ((b & 0x80) === 0) {
                x += (b + 0x80) * (2 ** shift);
                shift += 7;
              } else {
                x += (b - 0x80) * (2 ** shift);
                break;
              }
            }
            dist = w + 0x8000 + x * 0x8000 + 1;
          } else {
            dist = w - 0x8000 + 1;
          }
          if (dist > written) throw corrupt('whole match');
          // 重なる場合は LZ と同じく前から複写する（pyooz と同じ動作。oozextract は memmove）
          lzReplicate(out, written, written - dist, dstLeft);
        } else if (kind === 1) {
          if (srcLen - pos < 1) throw corrupt('quantum header');
          out.fill(src[pos], written, written + dstLeft);
          pos += 1;
        } else if (kind === 2) {
          if (srcLen - pos < dstLeft) throw corrupt('uncompressed quantum');
          out.set(src.subarray(pos, pos + dstLeft), written);
          pos += dstLeft;
        } else {
          throw corrupt('quantum header');
        }
        written += dstLeft;
        continue;
      }
    }

    // 圧縮クォンタム
    if (useChecksums) {
      // チェックサム（3 バイト）は検証せずに読み飛ばす（oozextract はこの欄を読まない）
      if (srcLen - pos < 3) throw corrupt('quantum header');
      pos += 3;
    }
    if (srcLen - pos < compSize) throw corrupt('quantum');
    if (blockSize === LARGE_BLOCK && compSize === dstLeft) {
      // 圧縮後のサイズが展開後と同じクォンタムは無圧縮で格納されている
      // （pyooz と同じ動作。oozextract はこの場合もチャンクとして解釈する）
      out.set(src.subarray(pos, pos + compSize), written);
      pos += compSize;
      written += dstLeft;
      continue;
    }
    if (decoderType === TYPE_LZNA) throw unsupported('LZNA');
    if (decoderType === TYPE_BITKNIT) throw unsupported('Bitknit');
    core.input = src.subarray(pos, pos + compSize);
    pos += compSize;
    const used = core.decodeQuantum(decoderType, written, dstLeft);
    if (used !== compSize) throw corrupt('quantum size');
    written += dstLeft;
  }
  return out;
}

// ---------------------------------------------------------------------------
// コピー系のヘルパー（decoder/pointer.rs 相当）
// ---------------------------------------------------------------------------

// copy_bytes: 同じバッファなら memmove
function copyBytes(dstBuf, d, srcBuf, s, n) {
  if (n <= 0) {
    if (n < 0) throw corrupt('copy');
    return;
  }
  if (d < 0 || s < 0 || d + n > dstBuf.length || s + n > srcBuf.length) throw corrupt('copy');
  if (dstBuf === srcBuf) {
    if (d !== s) dstBuf.copyWithin(d, s, s + n);
  } else if (n < 48) {
    for (let i = 0; i < n; i++) dstBuf[d + i] = srcBuf[s + i];
  } else {
    dstBuf.set(srcBuf.subarray(s, s + n), d);
  }
}

function memset(buf, d, v, n) {
  if (n <= 0) {
    if (n < 0) throw corrupt('memset');
    return;
  }
  if (d < 0 || d + n > buf.length) throw corrupt('memset');
  if (n < 32) {
    for (let i = 0; i < n; i++) buf[d + i] = v;
  } else {
    buf.fill(v, d, d + n);
  }
}

// repeat_copy_64: LZ のマッチコピー（out 内で src → dst へ n バイト）
function matchCopy(out, dst, src, n) {
  if (src < 0 || src + n > out.length || dst + n > out.length) throw corrupt('match');
  const d = dst - src;
  if (d >= 8 || d >= n) {
    // 1 バイトずつ前から写すのと同じ結果になる
    if (n <= 64) {
      for (let i = 0; i < n; i++) out[dst + i] = out[src + i];
    } else {
      lzReplicate(out, dst, src, n);
    }
  } else if (d !== 0) {
    // 距離 8 未満: oozextract と同じく 8 バイト単位の memmove
    for (let k = 0; k < n; k += 8) {
      out.copyWithin(dst + k, src + k, src + Math.min(k + 8, n));
    }
  }
}

// 前から 1 バイトずつ写すのと同じ結果（距離 1 以上なら重なってもよい）
function lzReplicate(out, dst, src, n) {
  const d = dst - src;
  if (d <= 0) throw corrupt('match');
  if (d >= n) {
    out.copyWithin(dst, src, src + n);
    return;
  }
  out.copyWithin(dst, src, dst);
  let done = d;
  while (done < n) {
    const p = done - (done % d);
    const len = Math.min(p, n - done);
    out.copyWithin(dst + done, dst + done - p, dst + done - p + len);
    done += len;
  }
}

// copy_64_add: out[dst+i] = lit[l+i] + out[rhs+i]（8 ビットで折り返す）
function copy64Add(out, dst, litBuf, l, rhs, n) {
  if (n <= 0) {
    if (n < 0) throw corrupt('copy');
    return;
  }
  if (rhs < 0 || dst + n > out.length || rhs + n > out.length || l + n > litBuf.length) throw corrupt('copy');
  for (let i = 0; i < n; i++) out[dst + i] = litBuf[l + i] + out[rhs + i];
}

function rotl(x, n) {
  return (x << n) | (x >>> (32 - n));
}

function ctz32(x) {
  return 31 - Math.clz32(x & -x);
}

// ---------------------------------------------------------------------------
// ビットリーダー（decoder/bit_reader.rs BitReader 相当）
// bits は 32 ビット（int32 として保持し、右シフトは >>> を使う）
// ---------------------------------------------------------------------------

class BitReader {
  constructor(buf, p, pEnd) {
    this.buf = buf;
    this.p = p;
    this.pEnd = pEnd;
    this.bits = 0;
    this.bitpos = 24;
  }

  refill() {
    let bitpos = this.bitpos;
    if (bitpos > 24) throw corrupt('bits');
    if (bitpos > 0) {
      const buf = this.buf;
      const pEnd = this.pEnd;
      let p = this.p;
      let bits = this.bits;
      do {
        if (p < pEnd) bits |= buf[p] << bitpos;
        bitpos -= 8;
        p++;
      } while (bitpos > 0);
      this.p = p;
      this.bits = bits;
      this.bitpos = bitpos;
    }
  }

  refillBackwards() {
    let bitpos = this.bitpos;
    if (bitpos > 24) throw corrupt('bits');
    if (bitpos > 0) {
      const buf = this.buf;
      const pEnd = this.pEnd;
      let p = this.p;
      let bits = this.bits;
      do {
        p--;
        if (p < 0) throw corrupt('bits');
        if (p >= pEnd) bits |= buf[p] << bitpos;
        bitpos -= 8;
      } while (bitpos > 0);
      this.p = p;
      this.bits = bits;
      this.bitpos = bitpos;
    }
  }

  readBit() {
    this.refill();
    return this.readBitNoRefill();
  }

  readBitNoRefill() {
    const r = this.bits >>> 31;
    this.bits <<= 1;
    this.bitpos += 1;
    return r !== 0;
  }

  readBitsNoRefill(n) {
    const r = this.bits >>> (32 - n);
    this.bits <<= n;
    this.bitpos += n;
    return r;
  }

  // n = 0 も可
  readBitsNoRefillZero(n) {
    const r = (this.bits >>> 1) >>> (31 - n);
    this.bits <<= n;
    this.bitpos += n;
    return r;
  }

  // read_more_than24bits / read_more_than_24_bits_b
  readMoreThan24Bits(n, backwards) {
    let rv;
    if (n <= 24) {
      rv = this.readBitsNoRefillZero(n);
    } else {
      rv = this.readBitsNoRefill(24) << (n - 24);
      if (backwards) this.refillBackwards();
      else this.refill();
      rv += this.readBitsNoRefill(n - 24);
    }
    if (backwards) this.refillBackwards();
    else this.refill();
    return rv;
  }

  // read_distance / read_distance_b（u32 演算の結果を i32 として返す）
  readDistance(v, backwards) {
    let rv;
    if (v < 0xF0) {
      const n = (v >> 4) + 4;
      const w = rotl(this.bits | 1, n);
      this.bitpos += n;
      const m = (2 << n) - 1;
      this.bits = w & ~m;
      rv = (((w & m) << 4) + (v & 0xF) - 248) | 0;
    } else {
      const n = v - 0xF0 + 4;
      const w = rotl(this.bits | 1, n);
      this.bitpos += n;
      const m = (2 << n) - 1;
      this.bits = w & ~m;
      rv = (8322816 + ((w & m) << 12)) | 0;
      if (backwards) this.refillBackwards();
      else this.refill();
      rv = (rv + (this.bits >>> 20)) | 0;
      this.bitpos += 12;
      this.bits <<= 12;
    }
    if (backwards) this.refillBackwards();
    else this.refill();
    return rv;
  }

  // read_length / read_length_b
  readLength(backwards) {
    let n = Math.clz32(this.bits);
    if (n > 12) throw corrupt('length');
    this.bitpos += n;
    this.bits <<= n;
    if (backwards) this.refillBackwards();
    else this.refill();
    n += 7;
    this.bitpos += n;
    const rv = (this.bits >>> (32 - n)) - 64;
    this.bits <<= n;
    if (backwards) this.refillBackwards();
    else this.refill();
    return rv;
  }

  readFluff(numSymbols) {
    if (numSymbols === 256) return 0;
    let x = 257 - numSymbols;
    if (x > numSymbols) x = numSymbols;
    x *= 2;
    const y = (31 - Math.clz32(x - 1)) + 1;
    const v = this.bits >>> (32 - y);
    const z = (1 << y) - x;
    if ((v >>> 1) >= z) {
      this.bits <<= y;
      this.bitpos += y;
      return v - z;
    }
    this.bits <<= y - 1;
    this.bitpos += y - 1;
    return v >>> 1;
  }
}

// ---------------------------------------------------------------------------
// Core（decoder/mod.rs Core 相当）
// 「ポインタ」は (バッファ, 位置) の組で表す。バッファは
//   input（クォンタムの圧縮データ）/ out（出力全体）/ scratch / tmp（各 256KB）
// ---------------------------------------------------------------------------

class Core {
  constructor(out) {
    this.out = out;
    this.input = EMPTY;
    this.scratch = new Uint8Array(LARGE_BLOCK);
    this.tmp = new Uint8Array(LARGE_BLOCK);
    // decode_bytes の decoded_size / decode_multi_array の total_size_out の受け渡し用
    this.decodedSize = 0;
    this.totalSize = 0;
    this.hdrType = 0;
    this.hdrSrcSize = 0;
    this.hdrDstSize = 0;
    this.depth = 0;
    // Huffman
    this.syms = new Uint8Array(1280);
    this.codePrefix = new Int32Array(12);
    this.codeLen = new Uint8Array(512);
    this.lenLut = new Uint8Array(2064);
    this.symLut = new Uint8Array(2064);
    this.bits2len = new Uint8Array(2048);
    this.bits2sym = new Uint8Array(2048);
    this.rangeSym = new Int32Array(130);
    this.rangeNum = new Int32Array(130);
    // tANS
    this.rice = new Uint8Array(528);
    this.tansA = new Uint8Array(256);
    this.tansB = new Uint32Array(256);
    this.tansAUsed = 0;
    this.tansBUsed = 0;
    this.tansLut = new Int32Array(2048);
    this.tansState = new Int32Array(5);
    // Kraken / Leviathan（必要になったときに確保）
    this.offsBuf = null;
    this.lenBuf = null;
    this.u32Buf = null;
    this.offsCount = 0;
    this.lenCount = 0;
    this.kLit = 0;
    this.kLitSize = 0;
    this.kCmd = 0;
    this.kCmdSize = 0;
    this.levLitArrays = null;
    this.levCmd = 0;
    this.levCmdSize = 0;
    this.levMultiCmd = null;
    this.levLitState = {
      mode: 0, lit: 0, lam: 0, andMask: 0,
      andStreams: new Int32Array(16), o1Streams: new Int32Array(16), o1Next: new Uint8Array(16),
    };
    // Mermaid（必要になったときに確保）
    this.off16 = null;
    this.off32a = null;
    this.off32b = null;
    this.off16Count = 0;
    this.off16Idx = 0;
    this.off32CountA = 0;
    this.off32CountB = 0;
    this.mLit = 0;
    this.mLitEnd = 0;
    this.mCmd = 0;
    this.mCmd2Offs = 0;
    this.mCmd2OffsEnd = 0;
    this.mLength = 0;
    this.mSavedDist = 0;
  }

  // decode_quantum: 256KB クォンタムを 128KB チャンク単位で展開する
  decodeQuantum(decoderType, offset, outLen) {
    const inp = this.input;
    const srcEnd = inp.length;
    let src = 0;
    let dst = offset;
    const dstEnd = offset + outLen;
    while (dstEnd > dst) {
      const dstCount = Math.min(dstEnd - dst, 0x20000);
      if (srcEnd - src < 4) throw corrupt('chunk header');
      const chunkhdr = (inp[src] << 16) | (inp[src + 1] << 8) | inp[src + 2];
      let srcUsed;
      if ((chunkhdr & 0x800000) === 0) {
        // LZ なし（エントロピー符号のみ）
        srcUsed = this.decodeBytes(this.out, dst, src, srcEnd, dstCount, false, 0);
        if (this.decodedSize !== dstCount) throw corrupt('chunk');
      } else {
        src += 3;
        srcUsed = chunkhdr & 0x7FFFF;
        const mode = (chunkhdr >> 19) & 0xF;
        if (srcUsed > srcEnd - src) throw corrupt('chunk');
        if (srcUsed < dstCount) {
          if (decoderType === TYPE_MERMAID) this.mermaidProcess(mode, src, srcUsed, dst, dstCount);
          else if (decoderType === TYPE_KRAKEN) this.krakenProcess(mode, src, srcUsed, dst, dstCount);
          else this.leviathanProcess(mode, src, srcUsed, dst, dstCount);
        } else if (srcUsed > dstCount || mode !== 0) {
          throw corrupt('chunk');
        } else {
          copyBytes(this.out, dst, inp, src, dstCount);
        }
      }
      src += srcUsed;
      dst += dstCount;
    }
    return src;
  }

  // -------------------------------------------------------------------------
  // エントロピー符号（decode_bytes 以下）
  // -------------------------------------------------------------------------

  // decode_bytes / get_block_size 共通: ブロックのヘッダを読む。
  // 種類・圧縮サイズ・展開サイズを this.hdrType / hdrSrcSize / hdrDstSize に入れ、ヘッダの長さを返す
  readEntropyHeader(src, srcEnd) {
    const inp = this.input;
    if (srcEnd - src < 2) throw corrupt('entropy');
    const b0 = inp[src];
    const type = (b0 >> 4) & 7;
    this.hdrType = type;
    if (type === 0) {
      // 無圧縮: 短い形式は 12 ビット、長い形式は 18 ビットのサイズ
      if (b0 >= 0x80) {
        this.hdrSrcSize = this.hdrDstSize = ((b0 << 8) | inp[src + 1]) & 0xFFF;
        return 2;
      }
      if (srcEnd - src < 3) throw corrupt('entropy');
      const n = (b0 << 16) | (inp[src + 1] << 8) | inp[src + 2];
      if ((n & ~0x3FFFF) !== 0) throw corrupt('entropy');
      this.hdrSrcSize = this.hdrDstSize = n;
      return 3;
    }
    if (b0 >= 0x80) {
      // 短いヘッダ（10 ビットのサイズ）
      if (srcEnd - src < 3) throw corrupt('entropy');
      const bits = (b0 << 16) | (inp[src + 1] << 8) | inp[src + 2];
      this.hdrSrcSize = bits & 0x3FF;
      this.hdrDstSize = this.hdrSrcSize + ((bits >> 10) & 0x3FF) + 1;
      return 3;
    }
    // 長いヘッダ（18 ビットのサイズ）
    if (srcEnd - src < 5) throw corrupt('entropy');
    const bits = ((inp[src + 1] << 24) | (inp[src + 2] << 16) | (inp[src + 3] << 8) | inp[src + 4]) >>> 0;
    this.hdrSrcSize = bits & 0x3FFFF;
    this.hdrDstSize = (((bits >>> 18) | (b0 << 14)) & 0x3FFFF) + 1;
    if (this.hdrSrcSize >= this.hdrDstSize) throw corrupt('entropy');
    return 5;
  }

  // decode_bytes: 戻り値は消費した入力バイト数。展開サイズは this.decodedSize
  // （forceMemmove は移植元との対応のために残している。無圧縮ブロックは常に複写する）
  decodeBytes(dstBuf, dst, src, srcEnd, outputSize, forceMemmove, scratchPos) {
    const srcOrg = src;
    src += this.readEntropyHeader(src, srcEnd);
    const chunkType = this.hdrType;
    const srcSize = this.hdrSrcSize;
    const dstSize = this.hdrDstSize;
    if (srcSize > outputSize || dstSize > outputSize || srcSize > srcEnd - src) throw corrupt('entropy');
    if (chunkType === 0) {
      this.decodedSize = srcSize;
      copyBytes(dstBuf, dst, this.input, src, srcSize);
      return src + srcSize - srcOrg;
    }
    // 以下の各デコーダは [dst, dst + dstSize) をすべて書くので、範囲を先に確認しておく
    if (dst < 0 || dst + dstSize > dstBuf.length) throw corrupt('entropy');
    if (dstBuf === this.scratch) scratchPos += dstSize;
    if (++this.depth > MAX_DEPTH) throw corrupt('entropy depth');

    let used;
    switch (chunkType) {
      case 2:
      case 4:
        used = this.decodeBytesType12(src, srcSize, dstBuf, dst, dstSize, chunkType >> 1);
        break;
      case 5:
        used = this.decodeRecursive(src, srcSize, dstBuf, dst, dstSize, scratchPos);
        break;
      case 3:
        used = this.decodeRle(src, srcSize, dstBuf, dst, dstSize, scratchPos);
        break;
      case 1:
        used = this.decodeTans(src, srcSize, dstBuf, dst, dstSize);
        break;
      default:
        throw corrupt('entropy type');
    }
    this.depth--;
    if (used !== srcSize) throw corrupt('entropy');
    this.decodedSize = dstSize;
    return src + srcSize - srcOrg;
  }

  // decode_bytes_type12: Huffman（type 1 = 2 分割, type 2 = 4 分割）
  decodeBytesType12(src, srcSize, dstBuf, dst, dstSize, type) {
    const inp = this.input;
    const srcEnd = src + srcSize;
    const br = new BitReader(inp, src, srcEnd);
    br.refill();

    const codePrefix = this.codePrefix;
    for (let i = 0; i < 12; i++) codePrefix[i] = BASE_PREFIX[i];
    const syms = this.syms;
    syms.fill(0);
    let numSyms;
    if (!br.readBitNoRefill()) {
      numSyms = this.huffReadCodeLengthsOld(br, syms, codePrefix);
    } else if (!br.readBitNoRefill()) {
      numSyms = this.huffReadCodeLengthsNew(br, syms, codePrefix);
    } else {
      throw corrupt('huffman');
    }
    src = br.p - (((24 - br.bitpos) / 8) | 0);

    // シンボルが 1 種類だけの表は、移植元（src - src_end を返すためサイズ検査で必ず失敗）でも pyooz でもエラーになる
    if (numSyms === 1) throw corrupt('huffman');

    this.makeLut(codePrefix, syms);

    if (type === 1) {
      if (srcEnd - src < 3) throw corrupt('huffman');
      const splitMid = inp[src] | (inp[src + 1] << 8);
      src += 2;
      if (splitMid > srcEnd - src) throw corrupt('huffman');
      this.huffDecode(dstBuf, dst, dst + dstSize, src, src + splitMid, srcEnd);
    } else {
      if (srcEnd - src < 6) throw corrupt('huffman');
      const half = (dstSize + 1) >> 1;
      const splitMid = inp[src] | (inp[src + 1] << 8) | (inp[src + 2] << 16);
      src += 3;
      if (splitMid > srcEnd - src) throw corrupt('huffman');
      const srcMid = src + splitMid;
      const splitLeft = inp[src] | (inp[src + 1] << 8);
      src += 2;
      if (splitLeft + 2 > srcEnd - src) throw corrupt('huffman');
      if (srcEnd - srcMid < 3) throw corrupt('huffman');
      const splitRight = inp[srcMid] | (inp[srcMid + 1] << 8);
      if (splitRight + 2 > srcEnd - (srcMid + 2)) throw corrupt('huffman');
      this.huffDecode(dstBuf, dst, dst + half, src, src + splitLeft, srcMid);
      this.huffDecode(dstBuf, dst + half, dst + dstSize, srcMid + 2, srcMid + 2 + splitRight, srcEnd);
    }
    return srcSize;
  }

  huffReadCodeLengthsOld(br, syms, codePrefix) {
    if (br.readBitNoRefill()) {
      let sym = 0;
      let numSymbols = 0;
      let avgBitsX4 = 32;
      const forcedBits = br.readBitsNoRefill(2);
      const thres = (1 << (31 - (20 >> forcedBits))) >>> 0;
      let skipInitialZeros = br.readBit();
      while (sym !== 256) {
        if (skipInitialZeros) {
          skipInitialZeros = false;
        } else {
          // 0 の連続
          if ((br.bits & 0xFF000000) === 0) throw corrupt('huffman');
          sym += br.readBitsNoRefill(2 * (Math.clz32(br.bits) + 1)) - 2 + 1;
          if (sym >= 256) break;
        }
        br.refill();
        if ((br.bits & 0xFF000000) === 0) throw corrupt('huffman');
        let n = br.readBitsNoRefill(2 * (Math.clz32(br.bits) + 1)) - 2 + 1;
        if (sym + n > 256) throw corrupt('huffman');
        br.refill();
        numSymbols += n;
        do {
          if ((br.bits >>> 0) < thres) throw corrupt('huffman');
          const lz = Math.clz32(br.bits);
          const v = br.readBitsNoRefill(lz + forcedBits + 1) + ((lz - 1) << forcedBits);
          const codelen = (-(v & 1) ^ (v >> 1)) + ((avgBitsX4 + 2) >> 2);
          if (codelen < 1 || codelen > 11) throw corrupt('huffman');
          avgBitsX4 = codelen + ((3 * avgBitsX4 + 2) >> 2);
          br.refill();
          syms[codePrefix[codelen]++] = sym;
          sym++;
          n--;
        } while (n !== 0);
      }
      if (sym !== 256 || numSymbols < 2) throw corrupt('huffman');
      return numSymbols;
    }
    // 疎なシンボル表
    const numSymbols = br.readBitsNoRefill(8);
    if (numSymbols === 0) throw corrupt('huffman');
    if (numSymbols === 1) {
      syms[0] = br.readBitsNoRefill(8);
    } else {
      const codelenBits = br.readBitsNoRefill(3);
      if (codelenBits > 4) throw corrupt('huffman');
      for (let i = 0; i < numSymbols; i++) {
        br.refill();
        const s = br.readBitsNoRefill(8);
        const codelen = br.readBitsNoRefillZero(codelenBits) + 1;
        if (codelen > 11) throw corrupt('huffman');
        syms[codePrefix[codelen]++] = s;
      }
    }
    return numSymbols;
  }

  huffReadCodeLengthsNew(br, syms, codePrefix) {
    const forcedBits = br.readBitsNoRefill(2);
    const numSymbols = br.readBitsNoRefill(8) + 1;
    const fluff = br.readFluff(numSymbols);
    const codeLen = this.codeLen;
    codeLen.fill(0);
    const br2 = {
      p: br.p - ((24 - br.bitpos + 7) >> 3),
      pEnd: br.pEnd,
      bitpos: (br.bitpos - 24) & 7,
    };
    this.decodeGolombRiceLengths(codeLen, 0, numSymbols + fluff, br2);
    this.decodeGolombRiceBits(codeLen, 0, numSymbols, forcedBits, br2);

    // ビットリーダーを付け直す
    br.bitpos = 24;
    br.p = br2.p;
    br.bits = 0;
    br.refill();
    br.bits <<= br2.bitpos;
    br.bitpos += br2.bitpos;

    let runningSum = 0x1e;
    for (let i = 0; i < numSymbols; i++) {
      let v = codeLen[i];
      v = (-(v & 1)) ^ (v >> 1);
      const len = (v + (runningSum >> 2) + 1) & 0xFF;
      codeLen[i] = len;
      if (len < 1 || len > 11) throw corrupt('huffman');
      runningSum += v;
    }

    const nRanges = this.convertToRanges(numSymbols, fluff, codeLen, br);
    let cp = 0;
    for (let r = 0; r < nRanges; r++) {
      let s = this.rangeSym[r];
      const num = this.rangeNum[r];
      for (let j = 0; j < num; j++) {
        syms[codePrefix[codeLen[cp + j]]++] = s;
        s++;
      }
      cp += num;
    }
    return numSymbols;
  }

  decodeGolombRiceLengths(dst, dstOff, dstLen, br2) {
    const inp = this.input;
    let p = br2.p;
    const pEnd = br2.pEnd;
    if (p < 0 || p >= pEnd) throw corrupt('rice');
    let count = -br2.bitpos;
    let v = inp[p] & (255 >> br2.bitpos);
    p++;
    for (;;) {
      if (v === 0) {
        count += 8;
      } else {
        const x = RICE_BITS2VALUE[v];
        const lo = (count + (x & 0x0F0F0F0F)) | 0;
        const l1 = dstLen < 4 ? dstLen : 4;
        for (let k = 0; k < l1; k++) dst[dstOff + k] = lo >>> (8 * k);
        if (dstLen > 4) {
          const hi = (x >> 4) & 0x0F0F0F0F;
          const l2 = dstLen - 4 < 4 ? dstLen - 4 : 4;
          for (let k = 0; k < l2; k++) dst[dstOff + 4 + k] = hi >>> (8 * k);
        }
        const step = RICE_BITS2LEN[v];
        if (dstLen <= step) {
          // 行き過ぎた分を戻す
          for (let k = dstLen; k < step; k++) v &= v - 1;
          break;
        }
        dstOff += step;
        dstLen -= step;
        count = x >> 28;
      }
      if (p >= pEnd) throw corrupt('rice');
      v = inp[p];
      p++;
    }
    let bitpos = 0;
    if ((v & 1) === 0) {
      if (v === 0) throw corrupt('rice');
      bitpos = 8 - ctz32(v);
      p--;
    }
    br2.p = p;
    br2.bitpos = bitpos;
  }

  // decode_golomb_rice_bits: 各値の下位 bitcount ビットを足す。
  // 移植元の 64 ビット演算（8 バイトまとめてシフト・加算）を 32 ビット 2 つで再現する
  decodeGolombRiceBits(dst, dstOff, dstLen, bitcount, br2) {
    if (bitcount === 0) return;
    const inp = this.input;
    let p = br2.p;
    const bitpos = br2.bitpos;
    const bitsRequired = bitpos + bitcount * dstLen;
    const bytesRequired = (bitsRequired + 7) >> 3;
    if (bytesRequired >= br2.pEnd - p) throw corrupt('rice');
    br2.p = p + (bitsRequired >> 3);
    br2.bitpos = bitsRequired & 7;
    const nb = 8 * bitcount;
    const mask = (1 << bitcount) - 1;
    while (dstLen > 0) {
      if (p < 0 || p + 4 > inp.length) throw corrupt('rice');
      const be = ((inp[p] << 24) | (inp[p + 1] << 16) | (inp[p + 2] << 8) | inp[p + 3]) >>> 0;
      const val = (be >>> (32 - nb - bitpos)) & ((1 << nb) - 1);
      p += bitcount;
      const len = dstLen < 8 ? dstLen : 8;
      let lo = 0;
      let hi = 0;
      for (let k = 0; k < len; k++) {
        if (k < 4) lo |= dst[dstOff + k] << (8 * k);
        else hi |= dst[dstOff + k] << (8 * (k - 4));
      }
      hi = (hi << bitcount) | (lo >>> (32 - bitcount));
      lo <<= bitcount;
      let addLo = 0;
      let addHi = 0;
      for (let k = 0; k < 8; k++) {
        const g = (val >>> (nb - bitcount * (k + 1))) & mask;
        if (k < 4) addLo |= g << (8 * k);
        else addHi |= g << (8 * (k - 4));
      }
      const s = (lo >>> 0) + (addLo >>> 0);
      lo = s >>> 0;
      hi = (hi + addHi + (s > 0xFFFFFFFF ? 1 : 0)) | 0;
      for (let k = 0; k < len; k++) {
        dst[dstOff + k] = k < 4 ? lo >>> (8 * k) : hi >>> (8 * (k - 4));
      }
      dstOff += len;
      dstLen -= len;
    }
  }

  // convert_to_ranges: 結果は this.rangeSym / this.rangeNum、戻り値は範囲の数
  convertToRanges(numSymbols, p, syms, br) {
    let symIdx = 0;
    let symlen = numSymbols;
    if (p & 1) {
      br.refill();
      const v = syms[symlen++];
      if (v >= 8) throw corrupt('ranges');
      symIdx = br.readBitsNoRefill(v + 1) + (1 << (v + 1)) - 1;
    }
    let symsUsed = 0;
    const numRanges = p >> 1;
    for (let i = 0; i < numRanges; i++) {
      br.refill();
      let v = syms[symlen++];
      if (v >= 9) throw corrupt('ranges');
      const num = br.readBitsNoRefillZero(v) + (1 << v);
      v = syms[symlen++];
      if (v >= 8) throw corrupt('ranges');
      const space = br.readBitsNoRefill(v + 1) + (1 << (v + 1)) - 1;
      this.rangeSym[i] = symIdx;
      this.rangeNum[i] = num;
      symsUsed += num;
      symIdx += num + space;
    }
    if (symIdx >= 256 || symsUsed >= numSymbols || symIdx + numSymbols - symsUsed > 256) {
      throw corrupt('ranges');
    }
    this.rangeSym[numRanges] = symIdx;
    this.rangeNum[numRanges] = numSymbols - symsUsed;
    return numRanges + 1;
  }

  // make_lut: 結果は this.bits2len / this.bits2sym
  makeLut(prefixCur, syms) {
    const lenLut = this.lenLut;
    const symLut = this.symLut;
    lenLut.fill(0);
    symLut.fill(0);
    let currslot = 0;
    for (let i = 1; i < 11; i++) {
      const start = BASE_PREFIX[i];
      const count = prefixCur[i] - start;
      if (count !== 0) {
        const stepsize = 1 << (11 - i);
        const numToSet = count << (11 - i);
        if (currslot + numToSet > 2048) throw corrupt('huffman');
        lenLut.fill(i, currslot, currslot + numToSet);
        for (let j = 0; j < count; j++) {
          const d = currslot + stepsize * j;
          symLut.fill(syms[start + j], d, d + stepsize);
        }
        currslot += numToSet;
      }
    }
    const n11 = prefixCur[11] - BASE_PREFIX[11];
    if (n11 !== 0) {
      if (currslot + n11 > 2064 || BASE_PREFIX[11] + n11 > 1280) throw corrupt('huffman');
      lenLut.fill(11, currslot, currslot + n11);
      symLut.set(syms.subarray(BASE_PREFIX[11], BASE_PREFIX[11] + n11), currslot);
      currslot += n11;
    }
    if (currslot !== 2048) throw corrupt('huffman');
    const bits2len = this.bits2len;
    const bits2sym = this.bits2sym;
    for (let i = 0; i < 2048; i++) {
      const r = REV11[i];
      bits2len[i] = lenLut[r];
      bits2sym[i] = symLut[r];
    }
  }

  // HuffReader::decode_bytes: 3 本のビット列（前方 2 本 + 後方 1 本）を並行して読む
  huffDecode(out, dst, dstEnd, src, srcMid, srcEnd) {
    const inp = this.input;
    const lenTab = this.bits2len;
    const symTab = this.bits2sym;
    const srcMidOrg = srcMid;
    let srcBits = 0;
    let srcBitpos = 0;
    let midBits = 0;
    let midBitpos = 0;
    let endBits = 0;
    let endBitpos = 0;
    let k;
    let n;
    if (src < 0 || src > srcMid || srcMid > srcEnd || srcEnd > inp.length) throw corrupt('huffman');

    if (srcEnd - srcMid >= 4 && dstEnd - dst >= 6) {
      dstEnd -= 5;
      srcEnd -= 4;
      while (dst < dstEnd && src <= srcMid && srcMid <= srcEnd) {
        srcBits |= (inp[src] | (inp[src + 1] << 8) | (inp[src + 2] << 16) | (inp[src + 3] << 24)) << srcBitpos;
        src += (31 - srcBitpos) >> 3;
        endBits |= ((inp[srcEnd] << 24) | (inp[srcEnd + 1] << 16) | (inp[srcEnd + 2] << 8) | inp[srcEnd + 3]) << endBitpos;
        srcEnd -= (31 - endBitpos) >> 3;
        midBits |= (inp[srcMid] | (inp[srcMid + 1] << 8) | (inp[srcMid + 2] << 16) | (inp[srcMid + 3] << 24)) << midBitpos;
        srcMid += (31 - midBitpos) >> 3;
        srcBitpos |= 0x18;
        endBitpos |= 0x18;
        midBitpos |= 0x18;

        k = srcBits & 0x7FF;
        n = lenTab[k];
        srcBits >>>= n;
        srcBitpos -= n;
        out[dst] = symTab[k];

        k = endBits & 0x7FF;
        n = lenTab[k];
        endBits >>>= n;
        endBitpos -= n;
        out[dst + 1] = symTab[k];

        k = midBits & 0x7FF;
        n = lenTab[k];
        midBits >>>= n;
        midBitpos -= n;
        out[dst + 2] = symTab[k];

        k = srcBits & 0x7FF;
        n = lenTab[k];
        srcBits >>>= n;
        srcBitpos -= n;
        out[dst + 3] = symTab[k];

        k = endBits & 0x7FF;
        n = lenTab[k];
        endBits >>>= n;
        endBitpos -= n;
        out[dst + 4] = symTab[k];

        k = midBits & 0x7FF;
        n = lenTab[k];
        midBits >>>= n;
        midBitpos -= n;
        out[dst + 5] = symTab[k];

        dst += 6;
      }
      dstEnd += 5;

      src -= srcBitpos >> 3;
      srcBitpos &= 7;
      srcEnd += 4 + (endBitpos >> 3);
      endBitpos &= 7;
      srcMid -= midBitpos >> 3;
      midBitpos &= 7;
      if (srcEnd > inp.length) throw corrupt('huffman');
    }

    while (dst < dstEnd) {
      if (srcMid - src <= 1) {
        if (srcMid - src === 1) srcBits |= inp[src] << srcBitpos;
      } else {
        srcBits |= (inp[src] | (inp[src + 1] << 8)) << srcBitpos;
      }
      k = srcBits & 0x7FF;
      n = lenTab[k];
      srcBitpos -= n;
      srcBits >>>= n;
      out[dst++] = symTab[k];
      src += (7 - srcBitpos) >> 3;
      srcBitpos &= 7;

      if (dst < dstEnd) {
        if (srcEnd - srcMid <= 1) {
          if (srcEnd - srcMid === 1) {
            const m = inp[srcMid];
            endBits |= m << endBitpos;
            midBits |= m << midBitpos;
          }
        } else {
          const v = inp[srcEnd - 2] | (inp[srcEnd - 1] << 8);
          endBits |= (((v >> 8) | (v << 8)) & 0xFFFF) << endBitpos;
          midBits |= (inp[srcMid] | (inp[srcMid + 1] << 8)) << midBitpos;
        }
        k = endBits & 0x7FF;
        out[dst++] = symTab[k];
        n = lenTab[k];
        endBitpos -= n;
        endBits >>>= n;
        srcEnd -= (7 - endBitpos) >> 3;
        endBitpos &= 7;
        if (dst < dstEnd) {
          k = midBits & 0x7FF;
          out[dst++] = symTab[k];
          n = lenTab[k];
          midBitpos -= n;
          midBits >>>= n;
          srcMid += (7 - midBitpos) >> 3;
          midBitpos &= 7;
        }
      }
      if (src > srcMid || srcMid > srcEnd) throw corrupt('huffman');
    }
    if (src !== srcMidOrg || srcEnd !== srcMid) throw corrupt('huffman');
  }

  decodeRecursive(src, srcSize, dstBuf, dst, dstSize, scratchPos) {
    const inp = this.input;
    const srcOrg = src;
    const dstEnd = dst + dstSize;
    const srcEnd = src + srcSize;
    if (srcSize < 6) throw corrupt('recursive');
    const b = inp[src];
    const n = b & 0x7F;
    if (n < 2) throw corrupt('recursive');
    if ((b & 0x80) === 0) {
      src++;
      for (let i = 0; i < n; i++) {
        const used = this.decodeBytes(dstBuf, dst, src, srcEnd, dstEnd - dst, true, scratchPos);
        dst += this.decodedSize;
        src += used;
      }
      if (dst !== dstEnd) throw corrupt('recursive');
      return src - srcOrg;
    }
    const arrayData = new Int32Array(2);
    const used = this.decodeMultiArray(src, srcEnd, dstBuf, dst, dstEnd, arrayData, 1, true, scratchPos);
    dst += this.totalSize;
    if (dst !== dstEnd) throw corrupt('recursive');
    return used;
  }

  // decode_multi_array: arrayData には (位置, サイズ) を arrayCount 組書き込む。総サイズは this.totalSize
  decodeMultiArray(src, srcEnd, dstBuf, dst, dstEnd, arrayData, arrayCount, forceMemmove, scratchPos) {
    const inp = this.input;
    const scratch = this.scratch;
    const srcOrg = src;
    if (srcEnd - src < 4) throw corrupt('multi array');
    let numArrays = inp[src++];
    if ((numArrays & 0x80) === 0) throw corrupt('multi array');
    numArrays &= 0x3F;
    let totalSize = 0;

    if (numArrays === 0) {
      for (let i = 0; i < arrayCount; i++) {
        const chunkDst = dst;
        const used = this.decodeBytes(dstBuf, chunkDst, src, srcEnd, dstEnd - dst, forceMemmove, scratchPos);
        const size = this.decodedSize;
        dst += size;
        arrayData[2 * i] = chunkDst;
        arrayData[2 * i + 1] = size;
        src += used;
        totalSize += size;
      }
      this.totalSize = totalSize;
      return src - srcOrg;
    }

    // まず全部を scratch に展開する
    const entData = new Int32Array(63);
    const entSize = new Int32Array(63);
    let scratchCur = scratchPos;
    for (let i = 0; i < numArrays; i++) {
      const chunkDst = scratchCur;
      const used = this.decodeBytes(scratch, chunkDst, src, srcEnd, Infinity, forceMemmove, scratchCur);
      const size = this.decodedSize;
      entData[i] = chunkDst;
      entSize[i] = size;
      scratchCur += size;
      totalSize += size;
      src += used;
    }

    if (srcEnd - src < 3) throw corrupt('multi array');
    const q = inp[src] | (inp[src + 1] << 8);
    src += 2;
    const numIndexes = this.getBlockSize(src, srcEnd, totalSize);
    if (numIndexes === 0) throw corrupt('multi array');
    let numLens = numIndexes - arrayCount;
    const lenlog2 = scratchCur;
    scratchCur += numIndexes;
    const indexes = scratchCur;
    scratchCur += numIndexes;
    if (scratchCur > scratch.length) throw corrupt('multi array');

    if ((q & 0x8000) !== 0) {
      const used = this.decodeBytes(scratch, indexes, src, srcEnd, numIndexes, true, scratchCur);
      if (this.decodedSize !== numIndexes) throw corrupt('multi array');
      src += used;
      for (let i = 0; i < numIndexes; i++) {
        const t = scratch[indexes + i];
        scratch[lenlog2 + i] = t >> 4;
        scratch[indexes + i] = t & 0xF;
      }
      numLens = numIndexes;
    } else {
      const chunkSize = numIndexes - arrayCount;
      if (chunkSize < 0) throw corrupt('multi array');
      let used = this.decodeBytes(scratch, indexes, src, srcEnd, numIndexes, false, scratchCur);
      if (this.decodedSize !== numIndexes) throw corrupt('multi array');
      src += used;
      used = this.decodeBytes(scratch, lenlog2, src, srcEnd, chunkSize, false, scratchCur);
      if (this.decodedSize !== chunkSize) throw corrupt('multi array');
      src += used;
      for (let i = 0; i < chunkSize; i++) {
        if (scratch[lenlog2 + i] > 16) throw corrupt('multi array');
      }
    }

    const intervals = new Uint32Array(numLens);
    const varbitsComplen = q & 0x3FFF;
    if (varbitsComplen > srcEnd - src) throw corrupt('multi array');
    const inLen = inp.length;
    let f = src;
    let bitsF = 0;
    let bitposF = 24;
    const srcEndActual = src + varbitsComplen;
    let b = srcEndActual;
    let bitsB = 0;
    let bitposB = 24;
    let li = 0;
    for (let i = 0; i < (numLens >> 1); i++) {
      bitsF |= readBeUpTo4(inp, f) >>> (24 - bitposF);
      f += (bitposF + 7) >> 3;
      if (b - 4 < 0 || b > inLen) throw corrupt('multi array');
      bitsB |= (inp[b - 4] | (inp[b - 3] << 8) | (inp[b - 2] << 16) | (inp[b - 1] << 24)) >>> (24 - bitposB);
      b -= (bitposB + 7) >> 3;

      const nf = scratch[lenlog2 + i * 2];
      const nb = scratch[lenlog2 + i * 2 + 1];

      bitsF = rotl(bitsF | 1, nf);
      bitposF += nf - 8 * ((bitposF + 7) >> 3);
      bitsB = rotl(bitsB | 1, nb);
      bitposB += nb - 8 * ((bitposB + 7) >> 3);

      const mf = BITMASKS[nf];
      const mb = BITMASKS[nb];
      intervals[li++] = bitsF & mf;
      bitsF &= ~mf;
      intervals[li++] = bitsB & mb;
      bitsB &= ~mb;
    }
    if ((numLens & 1) === 1) {
      bitsF |= readBeUpTo4(inp, f) >>> (24 - bitposF);
      const nf = scratch[lenlog2 + numLens - 1];
      bitsF = rotl(bitsF | 1, nf);
      intervals[li++] = bitsF & BITMASKS[nf];
    }

    if (scratch[indexes + numIndexes - 1] !== 0) throw corrupt('multi array');

    let indi = 0;
    let leni = 0;
    const incrementLeni = (q & 0x8000) !== 0;
    for (let a = 0; a < arrayCount; a++) {
      const start = dst;
      if (indi >= numIndexes) throw corrupt('multi array');
      for (;;) {
        const source = scratch[indexes + indi];
        indi++;
        if (source === 0) break;
        if (source > numArrays || leni >= numLens) throw corrupt('multi array');
        const curLen = intervals[leni++];
        if (curLen > entSize[source - 1] || curLen > dstEnd - dst) throw corrupt('multi array');
        const blk = entData[source - 1];
        entSize[source - 1] -= curLen;
        entData[source - 1] += curLen;
        copyBytes(dstBuf, dst, scratch, blk, curLen);
        dst += curLen;
      }
      if (incrementLeni) leni++;
      arrayData[2 * a] = start;
      arrayData[2 * a + 1] = dst - start;
    }
    if (indi !== numIndexes || leni !== numLens) throw corrupt('multi array');
    for (let i = 0; i < numArrays; i++) {
      if (entSize[i] !== 0) throw corrupt('multi array');
    }
    this.totalSize = totalSize;
    return srcEndActual - srcOrg;
  }

  // get_block_size: 次のブロックの展開サイズ（無圧縮ならそのサイズ）を返す
  getBlockSize(src, srcEnd, destCapacity) {
    src += this.readEntropyHeader(src, srcEnd);
    if (this.hdrType >= 6 || this.hdrSrcSize > srcEnd - src || this.hdrDstSize > destCapacity) {
      throw corrupt('block size');
    }
    return this.hdrDstSize;
  }

  decodeRle(src, srcSize, dstBuf, dst, dstSize, scratchPos) {
    const inp = this.input;
    if (srcSize === 0) throw corrupt('rle');
    if (srcSize === 1) {
      memset(dstBuf, dst, inp[src], dstSize);
      return 1;
    }
    if (inp[src] !== 0) {
      // コマンド列の先頭部分がさらに圧縮されている
      const scratch = this.scratch;
      const dstPtr = scratchPos;
      const n = this.decodeBytes(scratch, dstPtr, src, src + srcSize, Infinity, true, scratchPos);
      const decSize = this.decodedSize;
      if (n <= 0) throw corrupt('rle');
      const cmdLen = srcSize - n + decSize;
      copyBytes(scratch, dstPtr + decSize, inp, src + n, srcSize - n);
      this.decodeRleUnpacked(scratch, dstPtr, dstPtr + cmdLen, dstBuf, dst, dstSize);
    } else {
      this.decodeRleUnpacked(inp, src + 1, src + srcSize, dstBuf, dst, dstSize);
    }
    return srcSize;
  }

  // decode_rle_unpacked: コマンドは末尾から、データは先頭から読む
  decodeRleUnpacked(cmdBuf, cmdPtr, cmdEnd, dstBuf, dst, dstSize) {
    const dstEnd = dst + dstSize;
    let rleByte = 0;
    while (cmdPtr < cmdEnd) {
      const cmd = cmdBuf[cmdEnd - 1];
      if (cmd === 0 || cmd > 0x2F) {
        cmdEnd -= 1;
        const bytesToCopy = ~cmd & 0xF;
        const bytesToRle = cmd >> 4;
        if (bytesToCopy + bytesToRle > dstEnd - dst || bytesToCopy > cmdEnd - cmdPtr) throw corrupt('rle');
        copyBytes(dstBuf, dst, cmdBuf, cmdPtr, bytesToCopy);
        cmdPtr += bytesToCopy;
        dst += bytesToCopy;
        memset(dstBuf, dst, rleByte, bytesToRle);
        dst += bytesToRle;
      } else if (cmd >= 0x10) {
        cmdEnd -= 2;
        if (cmdEnd < cmdPtr) throw corrupt('rle');
        const data = (cmdBuf[cmdEnd] | (cmdBuf[cmdEnd + 1] << 8)) - 4096;
        const bytesToCopy = data & 0x3F;
        const bytesToRle = data >> 6;
        if (bytesToCopy + bytesToRle > dstEnd - dst || bytesToCopy > cmdEnd - cmdPtr) throw corrupt('rle');
        copyBytes(dstBuf, dst, cmdBuf, cmdPtr, bytesToCopy);
        cmdPtr += bytesToCopy;
        dst += bytesToCopy;
        memset(dstBuf, dst, rleByte, bytesToRle);
        dst += bytesToRle;
      } else if (cmd === 1) {
        rleByte = cmdBuf[cmdPtr];
        cmdPtr += 1;
        cmdEnd -= 1;
      } else if (cmd >= 9) {
        cmdEnd -= 2;
        if (cmdEnd < cmdPtr) throw corrupt('rle');
        const bytesToRle = ((cmdBuf[cmdEnd] | (cmdBuf[cmdEnd + 1] << 8)) - 0x8FF) * 128;
        if (bytesToRle > dstEnd - dst) throw corrupt('rle');
        memset(dstBuf, dst, rleByte, bytesToRle);
        dst += bytesToRle;
      } else {
        cmdEnd -= 2;
        if (cmdEnd < cmdPtr) throw corrupt('rle');
        const bytesToCopy = ((cmdBuf[cmdEnd] | (cmdBuf[cmdEnd + 1] << 8)) - 511) * 64;
        if (bytesToCopy > cmdEnd - cmdPtr || bytesToCopy > dstEnd - dst) throw corrupt('rle');
        copyBytes(dstBuf, dst, cmdBuf, cmdPtr, bytesToCopy);
        dst += bytesToCopy;
        cmdPtr += bytesToCopy;
      }
    }
    if (cmdPtr !== cmdEnd || dst !== dstEnd) throw corrupt('rle');
  }

  // decode_tans
  decodeTans(src, srcSize, dstBuf, dst, dstSize) {
    const inp = this.input;
    const inLen = inp.length;
    if (srcSize < 8 || dstSize < 5) throw corrupt('tans');
    let srcEnd = src + srcSize;
    const br = new BitReader(inp, src, srcEnd);
    br.refill();
    if (br.readBitNoRefill()) throw corrupt('tans');
    const lBits = br.readBitsNoRefill(2) + 8;
    this.tansDecodeTable(br, lBits);
    src = br.p - (((24 - br.bitpos) / 8) | 0);
    if (src >= srcEnd) throw corrupt('tans');
    this.tansInitLut(lBits);
    const lut = this.tansLut;
    const lMask = (1 << lBits) - 1;

    // 初期状態を読む
    if (src < 0 || src + 4 > inLen) throw corrupt('tans');
    let bitsF = inp[src] | (inp[src + 1] << 8) | (inp[src + 2] << 16) | (inp[src + 3] << 24);
    src += 4;
    srcEnd -= 4;
    if (srcEnd < 0 || srcEnd + 4 > inLen) throw corrupt('tans');
    let bitsB = (inp[srcEnd] << 24) | (inp[srcEnd + 1] << 16) | (inp[srcEnd + 2] << 8) | inp[srcEnd + 3];
    let bitposF = 32;
    let bitposB = 32;

    const s0 = bitsF & lMask;
    const s1 = bitsB & lMask;
    bitsF >>>= lBits;
    bitposF -= lBits;
    bitsB >>>= lBits;
    bitposB -= lBits;

    const s2 = bitsF & lMask;
    const s3 = bitsB & lMask;
    bitsF >>>= lBits;
    bitposF -= lBits;
    bitsB >>>= lBits;
    bitposB -= lBits;

    if (src + 4 > inLen) throw corrupt('tans');
    bitsF |= (inp[src] | (inp[src + 1] << 8) | (inp[src + 2] << 16) | (inp[src + 3] << 24)) << bitposF;
    src += (31 - bitposF) >> 3;
    bitposF |= 24;

    const s4 = bitsF & lMask;
    bitsF >>>= lBits;
    bitposF -= lBits;

    let ptrF = src - (bitposF >> 3);
    bitposF &= 7;
    let ptrB = srcEnd + (bitposB >> 3);
    bitposB &= 7;

    // TansDecoder::decode（10 ステップ周期: 前方 5 回 → 後方 5 回。前方は偶数ステップ、後方は奇数ステップで補充）
    const st = this.tansState;
    st[0] = s0;
    st[1] = s1;
    st[2] = s2;
    st[3] = s3;
    st[4] = s4;
    const dstEnd = dst + dstSize - 5;
    if (ptrF > ptrB) throw corrupt('tans');
    for (let step = 0; dst < dstEnd; step = step === 9 ? 0 : step + 1) {
      let e;
      let bx;
      if (step < 5) {
        if ((step & 1) === 0) {
          if (ptrF + 4 > inLen) throw corrupt('tans');
          bitsF |= (inp[ptrF] | (inp[ptrF + 1] << 8) | (inp[ptrF + 2] << 16) | (inp[ptrF + 3] << 24)) << bitposF;
          ptrF += (31 - bitposF) >> 3;
          bitposF |= 24;
        }
        e = lut[st[step]];
        bx = (e >>> 16) & 0xFF;
        bitposF -= bx;
        st[step] = (bitsF & ((1 << bx) - 1)) + (e & 0xFFFF);
        bitsF >>>= bx;
      } else {
        if ((step & 1) === 1) {
          if (ptrB - 4 < 0) throw corrupt('tans');
          bitsB |= ((inp[ptrB - 4] << 24) | (inp[ptrB - 3] << 16) | (inp[ptrB - 2] << 8) | inp[ptrB - 1]) << bitposB;
          ptrB -= (31 - bitposB) >> 3;
          bitposB |= 24;
        }
        e = lut[st[step - 5]];
        bx = (e >>> 16) & 0xFF;
        bitposB -= bx;
        st[step - 5] = (bitsB & ((1 << bx) - 1)) + (e & 0xFFFF);
        bitsB >>>= bx;
      }
      dstBuf[dst++] = e >>> 24;
    }

    if (ptrB + (bitposF >> 3) + (bitposB >> 3) !== ptrF) throw corrupt('tans');
    // 最後の 5 バイトは状態そのもの
    for (let i = 0; i < 5; i++) {
      if ((st[i] & ~0xFF) !== 0) throw corrupt('tans');
      dstBuf[dstEnd + i] = st[i];
    }
    return srcSize;
  }

  // Tans_DecodeTable: 結果は this.tansA[0..tansAUsed]（重み 1）/ this.tansB[0..tansBUsed]（(sym << 16) + 重み）
  tansDecodeTable(br, lBits) {
    const A = this.tansA;
    const B = this.tansB;
    let aUsed = 0;
    let bUsed = 0;
    const L = 1 << lBits;
    br.refill();
    if (br.readBitNoRefill()) {
      const q = br.readBitsNoRefill(3);
      const numSymbols = br.readBitsNoRefill(8) + 1;
      if (numSymbols < 2) throw corrupt('tans');
      const fluff = br.readFluff(numSymbols);
      const rice = this.rice;
      rice.fill(0);
      const br2 = {
        p: br.p - ((24 - br.bitpos + 7) >> 3),
        pEnd: br.pEnd,
        bitpos: (br.bitpos - 24) & 7,
      };
      this.decodeGolombRiceLengths(rice, 0, numSymbols + fluff, br2);
      br.bitpos = 24;
      br.p = br2.p;
      br.bits = 0;
      br.refill();
      br.bits <<= br2.bitpos;
      br.bitpos += br2.bitpos;

      const nRanges = this.convertToRanges(numSymbols, fluff, rice, br);
      br.refill();

      let cur = 0;
      let average = 6;
      let somesum = 0;
      for (let r = 0; r < nRanges; r++) {
        let symbol = this.rangeSym[r];
        const num = this.rangeNum[r];
        for (let k = 0; k < num; k++) {
          br.refill();
          const nextra = rice[cur++] + q;
          if (nextra > 15) throw corrupt('tans');
          let v = br.readBitsNoRefillZero(nextra) + (1 << nextra) - (1 << q);
          const averageDiv4 = average >> 2;
          let limit = 2 * averageDiv4;
          if (v <= limit) v = averageDiv4 + ((v >>> 1) ^ -(v & 1));
          if (limit > v) limit = v;
          v += 1;
          average += limit - averageDiv4;
          A[aUsed] = symbol;
          B[bUsed] = ((symbol << 16) + v) >>> 0;
          if (v === 1) aUsed++;
          if (v >= 2) bUsed++;
          somesum += v;
          symbol++;
        }
      }
      if (somesum !== L) throw corrupt('tans');
    } else {
      const seen = new Uint8Array(256);
      const count = br.readBitsNoRefill(3) + 1;
      const bitsPerSym = (31 - Math.clz32(lBits)) + 1;
      const maxDeltaBits = br.readBitsNoRefill(bitsPerSym);
      if (maxDeltaBits === 0 || maxDeltaBits > lBits) throw corrupt('tans');
      let weight = 0;
      let totalWeights = 0;
      for (let k = 0; k < count; k++) {
        br.refill();
        const sym = br.readBitsNoRefill(8);
        if (seen[sym]) throw corrupt('tans');
        const delta = br.readBitsNoRefill(maxDeltaBits);
        weight += delta;
        if (weight === 0) throw corrupt('tans');
        seen[sym] = 1;
        if (weight === 1) A[aUsed++] = sym;
        else B[bUsed++] = (sym << 16) + weight;
        totalWeights += weight;
      }
      br.refill();
      const sym = br.readBitsNoRefill(8);
      if (seen[sym]) throw corrupt('tans');
      if (L - totalWeights < weight || L - totalWeights <= 1) throw corrupt('tans');
      B[bUsed++] = (sym << 16) + (L - totalWeights);
      A.subarray(0, aUsed).sort();
      B.subarray(0, bUsed).sort();
    }
    this.tansAUsed = aUsed;
    this.tansBUsed = bUsed;
  }

  // TansDecoder::init_lut: 各要素は (symbol << 24) | (bits_x << 16) | w。x は (1 << bits_x) - 1
  tansInitLut(lBits) {
    const L = 1 << lBits;
    const lut = this.tansLut;
    lut.fill(0, 0, L);
    const A = this.tansA;
    const B = this.tansB;
    const aUsed = this.tansAUsed;
    const bUsed = this.tansBUsed;
    const slotsLeft = L - aUsed;
    if (slotsLeft < 0) throw corrupt('tans');
    const pointers = [0, 0, 0, 0];
    const sa = slotsLeft >> 2;
    let sb = sa + ((slotsLeft & 3) > 0 ? 1 : 0);
    pointers[1] = sb;
    sb += sa + ((slotsLeft & 3) > 1 ? 1 : 0);
    pointers[2] = sb;
    sb += sa + ((slotsLeft & 3) > 2 ? 1 : 0);
    pointers[3] = sb;

    // 重み 1 の要素
    for (let i = 0; i < aUsed; i++) {
      lut[slotsLeft + i] = (A[i] << 24) | (lBits << 16);
    }

    // 重み 2 以上の要素
    let weightsSum = 0;
    for (let i = 0; i < bUsed; i++) {
      const weight = B[i] & 0xFFFF;
      const symbol = (B[i] >>> 16) & 0xFF;
      if (weight > 4) {
        const symBits = 31 - Math.clz32(weight);
        let z = lBits - symBits;
        if (z < 0) throw corrupt('tans');
        let leBits = z;
        let leW = ((L - 1) & (weight << z)) & 0xFFFF;
        let whatToAdd = 1 << z;
        let x = (1 << (symBits + 1)) - weight;
        for (let j = 0; j < 4; j++) {
          let d = pointers[j];
          const y = (weight + ((weightsSum - j - 1) & 3)) >> 2;
          if (x >= y) {
            if (d + y > L) throw corrupt('tans');
            for (let k = 0; k < y; k++) {
              lut[d++] = (symbol << 24) | (leBits << 16) | leW;
              leW = (leW + whatToAdd) & 0xFFFF;
            }
            x -= y;
          } else {
            if (d + y > L) throw corrupt('tans');
            for (let k = 0; k < x; k++) {
              lut[d++] = (symbol << 24) | (leBits << 16) | leW;
              leW = (leW + whatToAdd) & 0xFFFF;
            }
            z--;
            if (z < 0) throw corrupt('tans');
            whatToAdd >>= 1;
            leBits = z;
            leW = 0;
            for (let k = 0; k < y - x; k++) {
              lut[d++] = (symbol << 24) | (leBits << 16) | leW;
              leW = (leW + whatToAdd) & 0xFFFF;
            }
            x = weight;
          }
          pointers[j] = d;
        }
      } else {
        if (weight <= 0) throw corrupt('tans');
        let bits = ((1 << weight) - 1) << (weightsSum & 3);
        bits |= bits >>> 4;
        let ww = weight;
        for (let k = 0; k < weight; k++) {
          const idx = ctz32(bits);
          bits &= bits - 1;
          const d = pointers[idx]++;
          if (d >= L) throw corrupt('tans');
          const weightBits = 31 - Math.clz32(ww);
          const bxw = lBits - weightBits;
          lut[d] = (symbol << 24) | (bxw << 16) | (((L - 1) & (ww << bxw)) & 0xFFFF);
          ww++;
        }
      }
      weightsSum += weight;
    }

    // どの状態からも次の状態が L 未満になることを確認（範囲外参照の防止。正しい表では常に成り立つ）
    for (let i = 0; i < L; i++) {
      const e = lut[i];
      const bx = (e >>> 16) & 0xFF;
      if (bx > lBits || (e & 0xFFFF) + (1 << bx) - 1 > L - 1) throw corrupt('tans');
    }
  }

  // -------------------------------------------------------------------------
  // unpack_offsets（Kraken / Leviathan 共通）
  // 結果は this.offsBuf[0..offsCount] / this.lenBuf[0..lenCount]
  // -------------------------------------------------------------------------

  unpackOffsets(src, srcEnd, pBuf, packedOffs, packedOffsExtra, multiDistScale, packedLitlen, offsCount, lenCount) {
    const inp = this.input;
    const a = new BitReader(inp, src, srcEnd);
    a.refill();
    const b = new BitReader(inp, srcEnd, src);
    b.refillBackwards();

    // excess_flag は常に false
    if ((b.bits >>> 0) < 0x2000) throw corrupt('offsets');
    let n = Math.clz32(b.bits);
    b.bitpos += n;
    b.bits <<= n;
    b.refillBackwards();
    n += 1;
    const u32Size = (b.bits >>> (32 - n)) - 1;
    b.bitpos += n;
    b.bits <<= n;
    b.refillBackwards();

    const offs = this.offsBuf;
    if (multiDistScale === 0) {
      // 従来の距離符号
      for (let i = 0; i < offsCount; i += 2) {
        offs[i] = -a.readDistance(pBuf[packedOffs++], false) | 0;
        if (i + 1 < offsCount) offs[i + 1] = -b.readDistance(pBuf[packedOffs++], true) | 0;
      }
    } else {
      // 新しい距離符号
      for (let i = 0; i < offsCount; i += 2) {
        let cmd = pBuf[packedOffs++];
        if ((cmd >> 3) > 26) throw corrupt('offsets');
        let o = ((8 + (cmd & 7)) << (cmd >> 3)) | a.readMoreThan24Bits(cmd >> 3, false);
        offs[i] = 8 - o;
        if (i + 1 < offsCount) {
          cmd = pBuf[packedOffs++];
          if ((cmd >> 3) > 26) throw corrupt('offsets');
          o = ((8 + (cmd & 7)) << (cmd >> 3)) | b.readMoreThan24Bits(cmd >> 3, true);
          offs[i + 1] = 8 - o;
        }
      }
      if (multiDistScale !== 1) {
        // combine_scaled_offset_arrays
        for (let i = 0; i < offsCount; i++) {
          offs[i] = (Math.imul(offs[i], multiDistScale) - pBuf[packedOffsExtra + i]) | 0;
        }
      }
    }

    if (u32Size > 512) throw corrupt('offsets');
    const u32 = this.u32Buf;
    for (let i = 0; i < u32Size; i++) {
      u32[i] = (i & 1) === 0 ? a.readLength(false) : b.readLength(true);
    }

    a.p -= (24 - a.bitpos) >> 3;
    b.p += (24 - b.bitpos) >> 3;
    if (a.p !== b.p) throw corrupt('offsets');

    const lens = this.lenBuf;
    let u32Idx = 0;
    for (let i = 0; i < lenCount; i++) {
      let v = pBuf[packedLitlen++];
      if (v === 255) {
        if (u32Idx >= u32Size) throw corrupt('offsets');
        v = u32[u32Idx++] + 255;
      }
      lens[i] = v + 3;
    }
    if (u32Idx !== u32Size) throw corrupt('offsets');
    this.offsCount = offsCount;
    this.lenCount = lenCount;
  }

  ensureLzBuffers() {
    if (this.offsBuf === null) {
      this.offsBuf = new Int32Array(0x20000);
      this.lenBuf = new Int32Array(0x8000);
      this.u32Buf = new Uint32Array(512);
    }
  }

  // -------------------------------------------------------------------------
  // Kraken（algorithm/kraken.rs）
  // -------------------------------------------------------------------------

  krakenProcess(mode, src, srcUsed, dst, dstSize) {
    if (mode > 1) throw corrupt('kraken mode');
    this.ensureLzBuffers();
    const offset = dst;
    this.krakenReadLzTable(src, src + srcUsed, dst, dstSize, offset);
    this.krakenProcessLzRuns(mode === 0, dst, dstSize, offset);
  }

  krakenReadLzTable(src, srcEnd, dst, dstSize, offset) {
    const inp = this.input;
    const scratch = this.scratch;
    let sp = 0;
    if (srcEnd - src < 13) throw corrupt('kraken');
    if (offset === 0) {
      copyBytes(this.out, dst, inp, src, 8);
      dst += 8;
      src += 8;
    }
    const flag = inp[src];
    if ((flag & 0x80) !== 0) {
      // excess bytes（移植元でも未対応）
      throw corrupt('kraken flag');
    }

    // リテラル列（最大 dstSize）
    let n = this.decodeBytes(scratch, sp, src, srcEnd, dstSize, false, sp);
    this.kLit = sp;
    this.kLitSize = this.decodedSize;
    src += n;
    sp += this.decodedSize;

    // コマンド列（最大 dstSize）
    n = this.decodeBytes(scratch, sp, src, srcEnd, dstSize, false, sp);
    src += n;
    this.kCmd = sp;
    this.kCmdSize = this.decodedSize;
    sp += this.decodedSize;

    if (srcEnd - src < 3) throw corrupt('kraken');

    let offsScaling = 0;
    let packedOffsExtra = -1;
    let offsStreamSize;
    const packedOffs = sp;
    if ((inp[src] & 0x80) !== 0) {
      // 距離を 2 つの表で符号化する方式
      offsScaling = inp[src] - 127;
      src++;
      n = this.decodeBytes(scratch, packedOffs, src, srcEnd, this.kCmdSize, false, sp);
      offsStreamSize = this.decodedSize;
      src += n;
      sp += offsStreamSize;
      if (offsScaling !== 1) {
        packedOffsExtra = sp;
        n = this.decodeBytes(scratch, packedOffsExtra, src, srcEnd, offsStreamSize, false, sp);
        if (this.decodedSize !== offsStreamSize) throw corrupt('kraken');
        src += n;
        sp += this.decodedSize;
      }
    } else {
      n = this.decodeBytes(scratch, packedOffs, src, srcEnd, this.kCmdSize, false, sp);
      offsStreamSize = this.decodedSize;
      src += n;
      sp += offsStreamSize;
    }

    // 長さ列（最大 dstSize / 4）
    const packedLen = sp;
    n = this.decodeBytes(scratch, packedLen, src, srcEnd, dstSize >> 2, false, sp);
    const lenStreamSize = this.decodedSize;
    src += n;
    sp += lenStreamSize;

    this.unpackOffsets(src, srcEnd, scratch, packedOffs, packedOffsExtra, offsScaling, packedLen,
      offsStreamSize, lenStreamSize);
  }

  krakenProcessLzRuns(mode0, dst, dstSize, offset) {
    const out = this.out;
    const scratch = this.scratch;
    const dstEnd = dst + dstSize;
    if (offset === 0) dst += 8;
    let cmd = this.kCmd;
    const cmdEnd = cmd + this.kCmdSize;
    const lens = this.lenBuf;
    const lenCount = this.lenCount;
    let lenIdx = 0;
    const offs = this.offsBuf;
    const offsCount = this.offsCount;
    let offsIdx = 0;
    let lit = this.kLit;
    const litEnd = lit + this.kLitSize;
    // recent_offs[3..6]（[0..2] は参照されない）
    let r3 = -8;
    let r4 = -8;
    let r5 = -8;
    let lastOffset = -8;

    while (cmd < cmdEnd) {
      const f = scratch[cmd++];
      let litlen = f & 3;
      const offsIndex = f >> 6;
      let matchlen = (f >> 2) & 0xF;

      if (litlen === 3) {
        if (lenIdx >= lenCount) throw corrupt('kraken');
        litlen = lens[lenIdx++];
      }
      if (litlen > dstEnd - dst || litlen > litEnd - lit) throw corrupt('kraken');
      if (mode0) {
        copy64Add(out, dst, scratch, lit, dst + lastOffset, litlen);
      } else {
        copyBytes(out, dst, scratch, lit, litlen);
      }
      dst += litlen;
      lit += litlen;

      // 直近の距離の並べ替え
      let offset;
      if (offsIndex === 0) {
        offset = r3;
      } else if (offsIndex === 1) {
        offset = r4;
        r4 = r3;
        r3 = offset;
      } else if (offsIndex === 2) {
        offset = r5;
        r5 = r4;
        r4 = r3;
        r3 = offset;
      } else {
        if (offsIdx >= offsCount) throw corrupt('kraken');
        offset = offs[offsIdx++];
        r5 = r4;
        r4 = r3;
        r3 = offset;
      }
      lastOffset = offset;

      if (matchlen !== 15) {
        matchlen += 2;
      } else {
        if (lenIdx >= lenCount) throw corrupt('kraken');
        matchlen = 14 + lens[lenIdx++];
      }
      if (matchlen > dstEnd - dst) throw corrupt('kraken');
      matchCopy(out, dst, dst + offset, matchlen);
      dst += matchlen;
    }

    if (offsIdx !== offsCount || lenIdx !== lenCount) throw corrupt('kraken');
    const finalLen = dstEnd - dst;
    if (finalLen !== litEnd - lit) throw corrupt('kraken');
    if (mode0) {
      copy64Add(out, dst, scratch, lit, dst + lastOffset, finalLen);
    } else {
      copyBytes(out, dst, scratch, lit, finalLen);
    }
  }

  // -------------------------------------------------------------------------
  // Mermaid / Selkie（algorithm/mermaid.rs）
  // -------------------------------------------------------------------------

  mermaidProcess(mode, src, srcUsed, dst, dstSize) {
    if (this.off16 === null) {
      this.off16 = new Uint16Array(0x10000);
      this.off32a = new Uint32Array(0x10000);
      this.off32b = new Uint32Array(0x10000);
    }
    const offset = dst;
    this.mermaidReadLzTable(mode, src, src + srcUsed, dst, dstSize, offset);
    this.mermaidProcessLzRuns(mode, src + srcUsed, dst, dstSize, offset);
  }

  mermaidReadLzTable(mode, src, srcEnd, dst, dstSize, offset) {
    const inp = this.input;
    const tmp = this.tmp;
    if (mode > 1) throw corrupt('mermaid mode');
    if (srcEnd - src < 10) throw corrupt('mermaid');
    if (offset === 0) {
      copyBytes(this.out, dst, inp, src, 8);
      dst += 8;
      src += 8;
    }
    let tp = 0;

    // リテラル列
    let n = this.decodeBytes(tmp, tp, src, srcEnd, dstSize, false, 0);
    this.mLit = tp;
    this.mLitEnd = tp + this.decodedSize;
    src += n;
    tp += this.decodedSize;

    // コマンド列
    n = this.decodeBytes(tmp, tp, src, srcEnd, dstSize, false, 0);
    const cmdCount = this.decodedSize;
    this.mCmd = tp;
    src += n;
    tp += cmdCount;

    this.mCmd2OffsEnd = cmdCount;
    if (dstSize <= 0x10000) {
      this.mCmd2Offs = cmdCount;
    } else {
      if (srcEnd - src < 2) throw corrupt('mermaid');
      this.mCmd2Offs = inp[src] | (inp[src + 1] << 8);
      src += 2;
      if (this.mCmd2Offs > cmdCount) throw corrupt('mermaid');
    }

    if (srcEnd - src < 2) throw corrupt('mermaid');
    const off16Count = inp[src] | (inp[src + 1] << 8);
    src += 2;
    const off16 = this.off16;
    if (off16Count === 0xFFFF) {
      // 近距離オフセットがエントロピー符号化されている（上位・下位バイト別）
      const hi = tp;
      n = this.decodeBytes(tmp, hi, src, srcEnd, dstSize >> 1, false, 0);
      const hiCount = this.decodedSize;
      src += n;
      tp += hiCount;
      const lo = tp;
      n = this.decodeBytes(tmp, lo, src, srcEnd, dstSize >> 1, false, 0);
      const loCount = this.decodedSize;
      src += n;
      tp += loCount;
      if (loCount !== hiCount) throw corrupt('mermaid');
      for (let i = 0; i < loCount; i++) off16[i] = tmp[lo + i] | (tmp[hi + i] << 8);
      this.off16Count = loCount;
    } else {
      if (off16Count * 2 > srcEnd - src) throw corrupt('mermaid');
      for (let i = 0; i < off16Count; i++) off16[i] = inp[src + 2 * i] | (inp[src + 2 * i + 1] << 8);
      src += off16Count * 2;
      this.off16Count = off16Count;
    }
    this.off16Idx = 0;

    if (srcEnd - src < 3) throw corrupt('mermaid');
    const t = inp[src] | (inp[src + 1] << 8) | (inp[src + 2] << 16);
    src += 3;
    this.off32CountA = 0;
    this.off32CountB = 0;
    if (t !== 0) {
      let size1 = t >> 12;
      let size2 = t & 0xFFF;
      if (size1 === 4095) {
        if (srcEnd - src < 2) throw corrupt('mermaid');
        size1 = inp[src] | (inp[src + 1] << 8);
        src += 2;
      }
      if (size2 === 4095) {
        if (srcEnd - src < 2) throw corrupt('mermaid');
        size2 = inp[src] | (inp[src + 1] << 8);
        src += 2;
      }
      src += this.mermaidDecodeFarOffsets(src, srcEnd, this.off32a, size1, offset);
      this.off32CountA = size1;
      src += this.mermaidDecodeFarOffsets(src, srcEnd, this.off32b, size2, offset + 0x10000);
      this.off32CountB = size2;
    }
    this.mLength = src;
  }

  mermaidDecodeFarOffsets(src, srcEnd, arr, count, offset) {
    const inp = this.input;
    let p = src;
    if (offset < 0xC00000 - 1) {
      for (let i = 0; i < count; i++) {
        if (srcEnd - p < 3) throw corrupt('mermaid');
        const off = inp[p] | (inp[p + 1] << 8) | (inp[p + 2] << 16);
        p += 3;
        if (off > offset) throw corrupt('mermaid');
        arr[i] = off;
      }
    } else {
      for (let i = 0; i < count; i++) {
        if (srcEnd - p < 3) throw corrupt('mermaid');
        let off = inp[p] | (inp[p + 1] << 8) | (inp[p + 2] << 16);
        p += 3;
        if (off >= 0xC00000) {
          if (p >= srcEnd) throw corrupt('mermaid');
          off += inp[p] << 22;
          p++;
        }
        if (off > offset) throw corrupt('mermaid');
        arr[i] = off;
      }
    }
    return p - src;
  }

  mermaidProcessLzRuns(mode, srcEnd, dst, dstSize, offset) {
    this.mSavedDist = -8;
    for (let iteration = 0; iteration < 2; iteration++) {
      const dstSizeCur = dstSize > 0x10000 ? 0x10000 : dstSize;
      let cmdStart;
      let cmdEnd;
      let off32;
      let off32Count;
      if (iteration === 0) {
        off32 = this.off32a;
        off32Count = this.off32CountA;
        cmdStart = this.mCmd;
        cmdEnd = this.mCmd + this.mCmd2Offs;
      } else {
        off32 = this.off32b;
        off32Count = this.off32CountB;
        cmdStart = this.mCmd + this.mCmd2Offs;
        cmdEnd = this.mCmd + this.mCmd2OffsEnd;
      }
      const startoff = (offset === 0 && iteration === 0) ? 8 : 0;
      this.mermaidProcessChunk(mode === 0, dst, dstSizeCur, srcEnd, startoff, cmdStart, cmdEnd, off32, off32Count);
      dst += dstSizeCur;
      dstSize -= dstSizeCur;
      if (dstSize === 0) break;
    }
    if (this.mLength !== srcEnd) throw corrupt('mermaid');
  }

  // MermaidLzTable::process（64KB 単位）
  mermaidProcessChunk(addMode, dst, dstSize, srcEnd, startoff, cmd, cmdEnd, off32, off32Count) {
    const out = this.out;
    const tmp = this.tmp;
    const inp = this.input;
    const off16 = this.off16;
    const off16Count = this.off16Count;
    let off16Idx = this.off16Idx;
    const dstEnd = dst + dstSize;
    let lengthStream = this.mLength;
    let lit = this.mLit;
    const litEnd = this.mLitEnd;
    let off32Idx = 0;
    let recentOffs = this.mSavedDist;
    const dstBegin = dst;
    let length;
    let from;
    dst += startoff;

    while (cmd < cmdEnd) {
      const c = tmp[cmd++];
      if (c >= 24) {
        // 短いリテラル（0〜7）+ 近距離マッチ（0〜15）
        const litlen = c & 7;
        const ml = (c >> 3) & 0xF;
        if (litlen + ml > dstEnd - dst || litlen > litEnd - lit) throw corrupt('mermaid');
        if (addMode) {
          if (litlen !== 0) {
            from = dst + recentOffs;
            if (from < 0) throw corrupt('mermaid');
            for (let i = 0; i < litlen; i++) out[dst + i] = tmp[lit + i] + out[from + i];
          }
        } else {
          for (let i = 0; i < litlen; i++) out[dst + i] = tmp[lit + i];
        }
        dst += litlen;
        lit += litlen;
        if ((c >> 7) === 0) {
          if (off16Idx >= off16Count) throw corrupt('mermaid');
          recentOffs = -off16[off16Idx++];
        }
        from = dst + recentOffs;
        if (recentOffs <= -8 && from >= 0) {
          for (let i = 0; i < ml; i++) out[dst + i] = out[from + i];
        } else {
          matchCopy(out, dst, from, ml);
        }
        dst += ml;
      } else if (c > 2) {
        // 遠距離マッチ（8〜28 バイト）
        length = c + 5;
        if (off32Idx >= off32Count) throw corrupt('mermaid');
        from = dstBegin - off32[off32Idx++];
        recentOffs = from - dst;
        if (dstEnd - dst < length) throw corrupt('mermaid');
        matchCopy(out, dst, from, length);
        dst += length;
      } else {
        if (lengthStream >= srcEnd) throw corrupt('mermaid');
        length = inp[lengthStream];
        if (length > 251) {
          if (srcEnd - lengthStream < 3) throw corrupt('mermaid');
          length += (inp[lengthStream + 1] | (inp[lengthStream + 2] << 8)) * 4;
          lengthStream += 2;
        }
        lengthStream += 1;
        if (c === 0) {
          // 長いリテラル
          length += 64;
          if (dstEnd - dst < length || litEnd - lit < length) throw corrupt('mermaid');
          if (addMode) {
            copy64Add(out, dst, tmp, lit, dst + recentOffs, length);
          } else {
            copyBytes(out, dst, tmp, lit, length);
          }
          dst += length;
          lit += length;
        } else if (c === 1) {
          // 長い近距離マッチ
          length += 91;
          if (off16Idx >= off16Count) throw corrupt('mermaid');
          from = dst - off16[off16Idx++];
          recentOffs = from - dst;
          if (dstEnd - dst < length) throw corrupt('mermaid');
          matchCopy(out, dst, from, length);
          dst += length;
        } else {
          // 長い遠距離マッチ
          length += 29;
          if (off32Idx >= off32Count) throw corrupt('mermaid');
          from = dstBegin - off32[off32Idx++];
          recentOffs = from - dst;
          if (dstEnd - dst < length) throw corrupt('mermaid');
          matchCopy(out, dst, from, length);
          dst += length;
        }
      }
    }

    // 残りはリテラル
    length = dstEnd - dst;
    if (litEnd - lit < length) throw corrupt('mermaid');
    if (addMode) {
      copy64Add(out, dst, tmp, lit, dst + recentOffs, length);
    } else {
      copyBytes(out, dst, tmp, lit, length);
    }
    lit += length;

    this.mSavedDist = recentOffs;
    this.mLength = lengthStream;
    this.mLit = lit;
    this.off16Idx = off16Idx;
  }

  // -------------------------------------------------------------------------
  // Leviathan（algorithm/leviathan.rs）
  // -------------------------------------------------------------------------

  leviathanProcess(mode, src, srcUsed, dst, dstSize) {
    this.ensureLzBuffers();
    const offset = dst;
    this.leviathanReadLzTable(mode, src, src + srcUsed, dst, dstSize, offset);
    this.leviathanProcessLzRuns(mode, dst, dstSize, offset);
  }

  leviathanReadLzTable(chunkType, src, srcEnd, dst, dstSize, offset) {
    const inp = this.input;
    const tmp = this.tmp;
    let tp = 0;
    if (chunkType > 5) throw corrupt('leviathan mode');
    if (srcEnd - src < 13) throw corrupt('leviathan');
    if (offset === 0) {
      copyBytes(this.out, dst, inp, src, 8);
      dst += 8;
      src += 8;
    }

    let offsScaling = 0;
    let packedOffsExtra = -1;
    const offsLimit = Math.floor(dstSize / 3);
    let offsStreamSize;
    const packedOffs = tp;
    let n;
    if ((inp[src] & 0x80) === 0) {
      n = this.decodeBytes(tmp, packedOffs, src, srcEnd, offsLimit, false, 0);
      offsStreamSize = this.decodedSize;
      src += n;
      tp += offsStreamSize;
    } else {
      offsScaling = inp[src] - 127;
      src++;
      n = this.decodeBytes(tmp, packedOffs, src, srcEnd, offsLimit, false, 0);
      offsStreamSize = this.decodedSize;
      src += n;
      tp += offsStreamSize;
      if (offsScaling !== 1) {
        packedOffsExtra = tp;
        n = this.decodeBytes(tmp, packedOffsExtra, src, srcEnd, offsLimit, false, 0);
        if (this.decodedSize !== offsStreamSize) throw corrupt('leviathan');
        src += n;
        tp += this.decodedSize;
      }
    }

    // 長さ列（最大 dstSize / 5）
    const packedLen = tp;
    n = this.decodeBytes(tmp, packedLen, src, srcEnd, Math.floor(dstSize / 5), false, 0);
    const lenStreamSize = this.decodedSize;
    src += n;
    tp += lenStreamSize;

    // リテラル列（1 本または 2 / 4 / 16 本）
    const litArrays = new Int32Array(32);
    let decodeCount;
    if (chunkType <= 1) {
      n = this.decodeBytes(tmp, tp, src, srcEnd, dstSize, true, 0);
      litArrays[0] = tp;
      litArrays[1] = this.decodedSize;
      decodeCount = this.decodedSize;
      src += n;
    } else {
      const arrayCount = chunkType === 2 ? 2 : chunkType === 3 ? 4 : 16;
      n = this.decodeMultiArray(src, srcEnd, tmp, tp, Infinity, litArrays, arrayCount, true, 0);
      decodeCount = this.totalSize;
      src += n;
    }
    tp += decodeCount;
    this.levLitArrays = litArrays;

    if (src >= srcEnd) throw corrupt('leviathan');
    const flag = inp[src];
    if ((flag & 0x80) === 0) {
      n = this.decodeBytes(tmp, tp, src, srcEnd, dstSize, true, 0);
      src += n;
      this.levCmd = tp;
      this.levCmdSize = this.decodedSize;
      this.levMultiCmd = null;
      tp += this.decodedSize;
    } else {
      if (flag !== 0x83) throw corrupt('leviathan');
      src++;
      const multiCmd = new Int32Array(16);
      n = this.decodeMultiArray(src, srcEnd, tmp, tp, Infinity, multiCmd, 8, true, 0);
      src += n;
      this.levCmd = -1;
      this.levCmdSize = this.totalSize;
      this.levMultiCmd = multiCmd;
      tp += this.totalSize;
    }

    this.unpackOffsets(src, srcEnd, tmp, packedOffs, packedOffsExtra, offsScaling, packedLen,
      offsStreamSize, lenStreamSize);
  }

  leviathanProcessLzRuns(mode, dst, dstSize, offset) {
    if (mode > 5) throw corrupt('leviathan mode');
    const dstCur = offset === 0 ? dst + 8 : dst;
    this.leviathanProcessLz(mode, dstCur, dst, dst + dstSize, 0);
  }

  // process_lz: 6 種類のリテラル方式を mode で切り替える
  //   0: Sub, 1: Raw, 2: LamSub, 3: SubAnd<4>, 4: O1, 5: SubAnd<16>
  leviathanProcessLz(mode, dst, chunkStart, dstEnd, windowBase) {
    const out = this.out;
    const tmp = this.tmp;
    const lens = this.lenBuf;
    let lenFront = 0;
    let lenBack = this.lenCount;
    const offs = this.offsBuf;
    const offsCount = this.offsCount;
    let offsIdx = 0;
    const lits = this.levLitArrays;
    const matchZoneEnd = (dstEnd - chunkStart) >= 16 ? dstEnd - 16 : chunkStart;
    const recent = new Int32Array(16);
    for (let i = 8; i <= 14; i++) recent[i] = -8;
    let offset = -8;

    // リテラル方式ごとの状態（levLiterals で使う）
    const L = this.levLitState;
    L.mode = mode;
    L.lit = lits[0];
    L.lam = lits[2];
    if (mode === 3 || mode === 5) {
      L.andMask = mode === 3 ? 3 : 15;
      for (let i = 0; i <= L.andMask; i++) L.andStreams[i] = lits[2 * ((i - chunkStart) & L.andMask)];
    } else if (mode === 4) {
      for (let i = 0; i < 16; i++) {
        const p = lits[2 * i];
        if (p >= tmp.length) throw corrupt('leviathan');
        L.o1Next[i] = tmp[p];
        L.o1Streams[i] = p + 1;
      }
    }

    // コマンド列（1 本、または dst & 7 で選ぶ 8 本）
    const multi = this.levMultiCmd;
    let cmdLeft = 0;
    let streams = null;
    let cmdStream;
    let slot = 0;
    if (multi === null) {
      cmdStream = this.levCmd;
    } else {
      cmdLeft = this.levCmdSize;
      streams = new Int32Array(8);
      for (let i = 0; i < 8; i++) streams[i] = multi[2 * ((i - chunkStart) & 7)];
      slot = dst & 7;
      cmdStream = streams[slot];
    }
    const cmdStreamEnd = cmdStream + this.levCmdSize;

    for (;;) {
      let cmd;
      if (streams !== null) {
        if (cmdLeft === 0) break;
        cmdLeft--;
        if (cmdStream < 0 || cmdStream >= tmp.length) throw corrupt('leviathan');
        cmd = tmp[cmdStream];
        streams[slot] = cmdStream + 1;
      } else {
        if (cmdStream >= cmdStreamEnd) break;
        cmd = tmp[cmdStream++];
      }

      const offsIndex = cmd >> 5;
      let matchlen = (cmd & 7) + 2;
      recent[15] = offsIdx < offsCount ? offs[offsIdx] : 0;

      // copy_literals（リテラル長の決め方と検査はモードごとに違う）
      const code = (cmd >> 3) & 3;
      let litlen = code;
      if (code === 3) {
        if (lenFront >= lenBack) throw corrupt('leviathan');
        litlen = mode === 4 ? lens[lenFront++] : lens[lenFront++] & 0xFFFFFF;
        if (mode === 4 && litlen <= 0) throw corrupt('leviathan');
        if ((mode === 3 || mode === 5) && matchZoneEnd >= dst && litlen > matchZoneEnd - dst) throw corrupt('leviathan');
      }
      if (mode === 2 && code !== 0) {
        if (litlen === 0) throw corrupt('leviathan');
        if (matchZoneEnd >= dst && litlen >= matchZoneEnd - dst) throw corrupt('leviathan');
      }
      if (litlen !== 0 || mode <= 1) dst = this.levLiterals(L, dst, litlen, offset);

      offset = recent[offsIndex + 8];
      // 直近の距離の並べ替え
      recent.copyWithin(offsIndex + 1, offsIndex, offsIndex + 8);
      recent[8] = offset;
      if (offsIndex === 7) offsIdx++;

      const copyfrom = dst + offset;
      if (copyfrom < windowBase) throw corrupt('leviathan');
      if (matchlen === 9) {
        if (lenBack <= lenFront) throw corrupt('leviathan');
        matchlen = lens[--lenBack] + 6;
        if (dstEnd - dst >= 8 && matchlen > dstEnd - dst - 8) throw corrupt('leviathan');
      }
      if (matchlen > dstEnd - dst) throw corrupt('leviathan');
      matchCopy(out, dst, copyfrom, matchlen);
      dst += matchlen;

      if (streams !== null) {
        slot = dst & 7;
        cmdStream = streams[slot];
      }
    }

    if (offsIdx < offsCount || lenFront !== lenBack) throw corrupt('leviathan');

    // copy_final_literals
    if (dst < dstEnd) {
      this.levLiterals(L, dst, dstEnd - dst, offset);
    } else if (dst !== dstEnd) {
      throw corrupt('leviathan');
    }
  }

  // Leviathan のリテラルを n バイト書く（各 LeviathanMode の copy_literal 相当）。戻り値は新しい dst
  levLiterals(L, dst, n, offset) {
    const out = this.out;
    const tmp = this.tmp;
    const mode = L.mode;
    if (mode === 0) {
      // Sub: 直前の距離の位置との差分
      copy64Add(out, dst, tmp, L.lit, dst + offset, n);
      L.lit += n;
      return dst + n;
    }
    if (mode === 1) {
      // Raw
      copyBytes(out, dst, tmp, L.lit, n);
      L.lit += n;
      return dst + n;
    }
    if (dst + n > out.length) throw corrupt('leviathan');
    if (mode === 2) {
      // LamSub: 先頭の 1 バイトだけ別の列から読む
      if (L.lam >= tmp.length || dst + offset < 0) throw corrupt('leviathan');
      out[dst] = tmp[L.lam++] + out[dst + offset];
      copy64Add(out, dst + 1, tmp, L.lit, dst + 1 + offset, n - 1);
      L.lit += n - 1;
      return dst + n;
    }
    if (mode === 4) {
      // O1: 直前のバイトの上位 4 ビットで列を選ぶ（差分なし）
      if (dst < 1) throw corrupt('leviathan');
      let context = out[dst - 1];
      for (let i = 0; i < n; i++) {
        const s = context >> 4;
        if (L.o1Streams[s] >= tmp.length) throw corrupt('leviathan');
        context = L.o1Next[s];
        out[dst++] = context;
        L.o1Next[s] = tmp[L.o1Streams[s]++];
      }
      return dst;
    }
    // SubAnd<4> / SubAnd<16>: 位置の下位ビットで列を選ぶ差分
    for (let i = 0; i < n; i++) {
      const s = dst & L.andMask;
      const p = L.andStreams[s];
      if (p >= tmp.length || dst + offset < 0) throw corrupt('leviathan');
      out[dst] = tmp[p] + out[dst + offset];
      L.andStreams[s] = p + 1;
      dst++;
    }
    return dst;
  }
}

// 最大 4 バイトをビッグエンディアンで読む（末尾付近では読めるだけ。移植元の get_be_bytes(f, min(4, len - f)) と同じ）
function readBeUpTo4(inp, f) {
  const len = inp.length;
  if (f < 0 || f > len) throw corrupt('multi array');
  const n = len - f < 4 ? len - f : 4;
  let v = 0;
  for (let i = 0; i < n; i++) v = (v << 8) | inp[f + i];
  return v >>> 0;
}
