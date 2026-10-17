// セーブの識別と新旧（core/owned-shared.js。sync-fixes の owned-gas）。GAS（gas/Shared.js）・画面・開発用 API で同じ定義を使う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSaves, ownedSaveStamp, ownedUploadIdentity, ownedSaveKey, parseOwnedSaveKey, decideOwnedUpload, cleanPresenceInput, validateOwnedUpload, OWNED_FIELDS,
} from '../../web/js/core/owned-shared.js';
import { ticksText } from '../../web/js/save/palworld.js';

const HASH = 'c'.repeat(64);

test('ownedSaveStamp: 1〜20 桁の数字（0 でない）だけを受け、先頭の 0 を除く。2^53 未満の整数も受ける', () => {
  assert.equal(ownedSaveStamp('638650000000000001'), '638650000000000001');
  assert.equal(ownedSaveStamp(' 00638650000000000001 '), '638650000000000001');
  assert.equal(ownedSaveStamp(12345), '12345');
  for (const value of ['', '0', '000', '-1', '1.5', '12a', '1'.repeat(21), 0, -3, 1.5, 2 ** 60, null, undefined, {}, true]) {
    assert.equal(ownedSaveStamp(value), '', String(value));
  }
});

test('compareSaves: 両方に stamp があれば桁をそろえて比べ（更新日時は見ない）、片方だけなら更新日時で比べる', () => {
  const later = '2026-10-05T10:00:00.000Z';
  const earlier = '2026-10-05T09:00:00.000Z';
  // 桁の違い（文字列として比べると '9' > '10' になる）
  assert.equal(compareSaves({ stamp: '10', updatedAt: earlier }, { stamp: '9', updatedAt: later }), 1);
  assert.equal(compareSaves({ stamp: '9' }, { stamp: '0010' }), -1);
  assert.equal(compareSaves({ stamp: '638650000000000001' }, { stamp: '638650000000000002' }), -1);
  // 2^53 を超えるティックの 1 の違い（数にすると同じになる）
  assert.equal(Number('638650000000000001') === Number('638650000000000002'), true);
  // 同じ stamp なら更新日時が違っても同じセーブ（同期で更新日時が書き換わる）
  assert.equal(compareSaves({ stamp: '638650000000000001', updatedAt: later }, { stamp: '0638650000000000001', updatedAt: earlier }), 0);
  // 片方だけに stamp（古い共有・古い画面・前のキャッシュ）
  assert.equal(compareSaves({ stamp: '5', updatedAt: earlier }, { updatedAt: later }), -1);
  assert.equal(compareSaves({ updatedAt: later }, { stamp: 'abc', updatedAt: earlier }), 1);
  assert.equal(compareSaves({ updatedAt: later }, { updatedAt: later }), 0);
  // 読めない更新日時は 0（今の timeOf と同じ）
  assert.equal(compareSaves({ updatedAt: 'いつか' }, { updatedAt: later }), -1);
  assert.equal(compareSaves({}, {}), 0);
  assert.equal(compareSaves(null, undefined), 0);
});

test('ticksText: セーブのティック（数・10 進の文字列・BigInt）を 10 進の文字列にする', () => {
  assert.equal(ticksText('638650000000000001'), '638650000000000001');
  assert.equal(ticksText(621355968010000), '621355968010000');
  assert.equal(ticksText(638650000000000001n), '638650000000000001');
  for (const value of [null, undefined, '', 0, -1, 1.5, 'x', '0', 0n]) assert.equal(ticksText(value), '', String(value));
});

test('セーブの識別: 5 つがそろえば識別、1 つでも欠ける・形が違えば null。saveKey の先頭の uploadedAt がその行と違えば識別なし', () => {
  const at = '2026-10-05T10:00:00.000Z';
  const world = { saveStamp: '0638650000000000001', contentHash: HASH.toUpperCase(), format: 1, fileCount: 6, missingCount: 0 };
  const identity = ownedUploadIdentity(world);
  assert.deepEqual(identity, { stamp: '638650000000000001', hash: HASH, format: 1, fileCount: 6, missingCount: 0 });
  for (const broken of [{ saveStamp: '' }, { contentHash: 'c'.repeat(63) }, { format: 0 }, { format: '1' }, { fileCount: -1 }, { missingCount: 1.5 }, { fileCount: 10001 }]) {
    assert.equal(ownedUploadIdentity({ ...world, ...broken }), null, JSON.stringify(broken));
  }
  assert.equal(ownedUploadIdentity(null), null);
  const key = ownedSaveKey(at, identity);
  assert.equal(key, `${at}|638650000000000001|${HASH}|1|6|0`);
  assert.deepEqual(parseOwnedSaveKey(key, at), identity);
  assert.equal(parseOwnedSaveKey(key, '2026-10-05T10:00:00.001Z'), null);
  assert.equal(ownedSaveKey(at, null), '');
  for (const text of ['', null, `${at}|1|${HASH}|1|6`, `${at}|1|${HASH}|1|6|0|x`, `${at}|x|${HASH}|1|6|0`, `${at}|1|${HASH}|-1|6|0`]) assert.equal(parseOwnedSaveKey(text, at), null, String(text));
  // validateOwnedUpload は world の中で受ける（最上位の項目は増やさない）。force は true だけ
  const upload = (extra) => validateOwnedUpload({ worldId: 'A'.repeat(32), saveUpdatedAt: at, world: { name: 'W', ...extra }, columns: OWNED_FIELDS, rows: [] });
  assert.deepEqual([upload(world).value.identity, upload(world).value.force], [identity, false]);
  assert.deepEqual([upload({ ...world, force: true }).value.force, upload({ force: 'true' }).value.force, upload({}).value.identity], [true, false, null]);
});

test('decideOwnedUpload: 結果の種類の表（docs/sync-fixes/README.md の 3）', () => {
  const id = (stamp, extra = {}) => ({ stamp, hash: HASH, format: 1, fileCount: 6, missingCount: 0, ...extra });
  const current = (identity, uploadedBy = 'Alice', saveUpdatedAt = '2026-10-05T10:00:00.000Z') => ({ identity, uploadedBy, saveUpdatedAt });
  const incoming = (identity, extra = {}) => ({ identity, uploadedBy: 'Alice', saveUpdatedAt: '2026-10-05T10:00:00.000Z', ...extra });
  const decide = (a, b) => decideOwnedUpload(a, b);
  assert.deepEqual(decide(null, incoming(null)), { result: 'new', write: true });
  assert.deepEqual(decide(current(id('5')), incoming(id('6'))), { result: 'newer', write: true });
  assert.deepEqual(decide(current(id('5')), incoming(id('4'), { saveUpdatedAt: '2027-01-01T00:00:00.000Z' })), { result: 'stale', write: false });
  assert.deepEqual(decide(current(id('5')), incoming(id('5'), { uploadedBy: 'Bob' })), { result: 'unchanged', write: false });
  const better = [{ fileCount: 7 }, { format: 2 }];
  for (const extra of better) assert.equal(decide(current(id('5')), incoming(id('5', { hash: 'd'.repeat(64), ...extra }))).result, 'resent', JSON.stringify(extra));
  assert.equal(decide(current(id('5', { missingCount: 2 })), incoming(id('5', { missingCount: 1 }))).result, 'resent');
  // 別の人・劣った中身・よいところと悪いところがある・同じ質
  assert.equal(decide(current(id('5')), incoming(id('5', { fileCount: 7 }), { uploadedBy: 'Bob' })).result, 'same');
  assert.equal(decide(current(id('5')), incoming(id('5', { fileCount: 5 }))).result, 'same');
  assert.equal(decide(current(id('5')), incoming(id('5', { fileCount: 7, missingCount: 1 }))).result, 'same');
  assert.equal(decide(current(id('5')), incoming(id('5', { hash: 'd'.repeat(64) }))).result, 'same');
  // 名前のない共有は同じ人とみなさない
  assert.equal(decide(current(id('5'), ''), incoming(id('5', { fileCount: 7 }), { uploadedBy: '' })).result, 'same');
  // 登録の確定（force）は別の人でも、悪くならなければ
  assert.equal(decide(current(id('5')), incoming(id('5', { hash: 'd'.repeat(64) }), { uploadedBy: 'Bob', force: true })).result, 'resent');
  assert.equal(decide(current(id('5')), incoming(id('5', { fileCount: 5 }), { force: true })).result, 'same');
  // 識別のない方がある: 更新日時で比べる。今の行に識別があり、届いた方にない（古い画面）同じ時刻は same（同期を受け取った PC の古いタブの
  // 劣った中身で、同じセーブの完全な共有を上書きしない）。今の行に識別がなければ、今どおり同じ時刻なら上書き
  assert.deepEqual(decide(current(id('5')), incoming(null)), { result: 'same', write: false });
  assert.deepEqual(decide(current(id('5')), incoming(null, { uploadedBy: 'Bob' })), { result: 'same', write: false });
  assert.deepEqual(decide(current(id('5')), incoming(null, { saveUpdatedAt: '2026-10-05T10:00:00.001Z' })), { result: 'newer', write: true });
  assert.deepEqual(decide(current(id('5')), incoming(null, { saveUpdatedAt: '2026-10-05T09:59:59.999Z' })), { result: 'stale', write: false });
  assert.deepEqual(decide(current(null), incoming(id('5'))), { result: 'newer', write: true });
  assert.deepEqual(decide(current(null), incoming(null)), { result: 'newer', write: true });
});

test('cleanPresenceInput: ページ・PC の ID・役割・真偽を検査し、名前は 20 字に整える。知らない項目は落とす', () => {
  const value = { pageId: 'page-0001', device: 'device_01', user: ' 仲間\u0000'.padEnd(30, 'x'), role: 'host', playing: true, canShare: false, at: 'x', extra: 1 };
  assert.deepEqual(cleanPresenceInput(value), { pageId: 'page-0001', device: 'device_01', user: '仲間xxxxxxxxxxxxxxxxxx'.slice(0, 20), role: 'host', playing: true, canShare: false });
  assert.equal(cleanPresenceInput({ ...value, user: undefined }).user, '');
  for (const broken of [null, [], 'x', { ...value, pageId: 'short' }, { ...value, pageId: 'a'.repeat(65) }, { ...value, device: 'has space!' },
    { ...value, role: 'owner' }, { ...value, playing: 1 }, { ...value, canShare: 'false' }, { ...value, user: 5 }]) {
    assert.equal(cleanPresenceInput(broken), null, JSON.stringify(broken));
  }
});

test('共有の形の版（OWNED_FORMAT。share-upload）: 狭めて送るときに外した列の数だけ下げても 1 以上（識別の検査を通る）', async () => {
  const { OWNED_FORMAT, OWNED_ADDED_FIELDS, ownedUploadIdentity } = await import('../../web/js/core/owned-shared.js');
  assert.ok(Number.isInteger(OWNED_FORMAT) && OWNED_FORMAT > OWNED_ADDED_FIELDS.length);
  const identity = (format) => ownedUploadIdentity({ saveStamp: '638650000000000001', contentHash: 'a'.repeat(64), format, fileCount: 3, missingCount: 0 });
  for (let removed = 0; removed <= OWNED_ADDED_FIELDS.length; removed++) assert.equal(identity(OWNED_FORMAT - removed).format, OWNED_FORMAT - removed);
});
