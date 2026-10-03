/**
 * 共有パスコードの認証。
 * どちらのパスコードに一致したかで、本番シート（prod）かテスト用シート（test）かを決める。
 * AI はテスト用パスコードだけを扱い、本番データには触れない（INV-4）。
 */

// 読み間違えやすい文字（I, O, 0, 1）を除いた 32 文字。1 文字 5 bit × 16 文字 = 80 bit
var PASSCODE_ALPHABET_ = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function normalizePasscode_(value) {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

function authenticate_(input) {
  var props = PropertiesService.getScriptProperties();
  var prod = normalizePasscode_(props.getProperty('PASSCODE'));
  var test = normalizePasscode_(props.getProperty('TEST_PASSCODE'));
  // 設定ミスでテスト用パスコードが本番に届く事態を防ぐため、不完全な設定では全拒否する
  if (!prod || !test || prod === test) return { ok: false, code: 'CONFIG' };

  var given = normalizePasscode_(input);
  if (given && given === prod) return { ok: true, env: 'prod' };
  if (given && given === test) return { ok: true, env: 'test' };
  return { ok: false, code: 'AUTH' };
}

function generatePasscode_() {
  var seed = Utilities.getUuid() + Utilities.getUuid() + Date.now();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  var out = '';
  for (var i = 0; i < 16; i++) {
    // 256 は 32 で割り切れるので、下位 5 bit を使えば偏りが出ない
    out += PASSCODE_ALPHABET_.charAt(bytes[i] & 31);
  }
  return out.match(/.{4}/g).join('-');
}
