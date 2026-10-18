// セーブの識別と新旧（core/owned-shared.js。sync-fixes の owned-gas）。GAS（gas/Shared.js）・画面・開発用 API で同じ定義を使う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSaves, ownedSaveStamp, ownedUploadIdentity, ownedSaveKey, parseOwnedSaveKey, decideOwnedUpload, cleanPresenceInput, validateOwnedUpload, OWNED_FIELDS,
  HOST_UID, OWNED_EXTRAS_MAX_CHARS, OWNED_FORMERS_MAX, OWNED_ITEMS_MAX, ownedSaveKind, cleanOwnedItems, cleanOwnedExtras, ownedExtrasText, parseOwnedExtras,
  fitOwnedExtras,
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

// ---------------------------------------------------------------------------
// 共有のワールドの追加の情報（OwnedWorlds の列 extras。server）。値はダミー（H は協力プレイのホストの枠の決まった値）
// ---------------------------------------------------------------------------

const H = HOST_UID;
const X = '12345678-0000-0000-0000-000000000000';
const AT = '2026-10-18T10:00:00.000Z';

test('cleanOwnedExtras（server）: セーブの種類・通算の時間・以前の持ち主・在庫を検査して決まった形（鍵の順も）にし、知らない鍵は落とす。分かることがなければ null', () => {
  const clean = cleanOwnedExtras({
    saveKind: 'server', clock: '00638650000000000005', formers: [{ uid: H, kind: 'host', pals: 66, farms: 2 }, { uid: X, pals: 1, farms: 0, name: 'x' }],
    items: [{ id: 'PalGenderReverse', t: 3, p: [{ l: '拠点 1 の箱', n: 3 }] }], name: 'World9', at: AT,
  });
  assert.deepEqual(clean, {
    saveKind: 'server', clock: '638650000000000005', formers: [{ uid: H, pals: 66, farms: 2 }, { uid: X, pals: 1, farms: 0 }],
    items: [{ id: 'PalGenderReverse', t: 3, p: [{ l: '拠点 1 の箱', n: 3 }] }],
  });
  // GAS の応答と読み直した world を同じ JSON にするため、鍵の順も決まる
  assert.deepEqual(Object.keys(clean), ['saveKind', 'clock', 'formers', 'items']);
  assert.deepEqual(cleanOwnedExtras(clean), clean);
  // 古い画面・古い GAS の共有（分かることがない）は null
  for (const empty of [null, undefined, 'x', [], {}, { name: 'W' }, { saveKind: 'cloud', clock: '0', formers: 'x', items: {} }]) {
    assert.equal(cleanOwnedExtras(empty), null, JSON.stringify(empty));
  }
  // 1 つでも分かれば、分からない項目は '' と null
  assert.deepEqual(cleanOwnedExtras({ saveKind: 'coop' }), { saveKind: 'coop', clock: '', formers: null, items: null });
  assert.deepEqual(cleanOwnedExtras({ formers: [] }), { saveKind: '', clock: '', formers: [], items: null });
  assert.equal(cleanOwnedExtras({ clock: 638650000000000 }).clock, '638650000000000');
  assert.deepEqual(['server', 'coop', 'Server', '', null].map(ownedSaveKind), ['server', 'coop', '', '', '']);
  // 以前の持ち主: uid は英数字とハイフン 40 字まで（大文字小文字はそのまま）、数は 0〜20000 の整数。同じ uid の後は捨てる
  const formers = cleanOwnedExtras({ formers: [
    { uid: X.toUpperCase(), pals: 1, farms: 0 }, { uid: X.toUpperCase(), pals: 9, farms: 9 }, { uid: 'a b', pals: 1, farms: 1 }, { uid: 'a'.repeat(41), pals: 1, farms: 1 },
    { uid: 'u1', pals: -1, farms: 0 }, { uid: 'u2', pals: 1.5, farms: 0 }, { uid: 'u3', pals: '1', farms: 0 }, { uid: 'u4', pals: 20001, farms: 0 }, { uid: 'u5', pals: 0 }, null, 'u6',
  ] }).formers;
  assert.deepEqual(formers, [{ uid: X.toUpperCase(), pals: 1, farms: 0 }]);
  // formersPartial は true のときだけ（以前の持ち主が分からなければ付けない）。数の上限を超えたら切って付ける
  assert.equal(cleanOwnedExtras({ formers: [], formersPartial: true }).formersPartial, true);
  assert.equal('formersPartial' in cleanOwnedExtras({ formers: [], formersPartial: 'yes' }), false);
  assert.equal('formersPartial' in cleanOwnedExtras({ saveKind: 'coop', formersPartial: true }), false);
  const many = cleanOwnedExtras({ formers: Array.from({ length: OWNED_FORMERS_MAX + 5 }, (_, i) => ({ uid: `u${i}`, pals: 1, farms: 0 })) });
  assert.deepEqual([many.formers.length, many.formersPartial], [OWNED_FORMERS_MAX, true]);
  assert.deepEqual(Object.keys(many), ['saveKind', 'clock', 'formers', 'formersPartial', 'items']);
});

test('cleanOwnedItems（server・在庫の形）: 配列でなければ null。ID の形・合計（1〜1,000,000 の整数）を検査し、大文字小文字をそろえて同じ ID は先勝ち、200 種まで。場所の内訳は 3 か所まで', () => {
  assert.deepEqual([cleanOwnedItems(null), cleanOwnedItems({}), cleanOwnedItems('x')], [null, null, null]);
  assert.deepEqual(cleanOwnedItems([]), []);
  const items = cleanOwnedItems([
    { id: 'PalPassiveSkillChange_Rare', t: 5, p: [{ l: '拠点 1 の箱', n: 3 }, { l: 'ギルド保管庫', n: 2 }] },
    { id: 'palpassiveskillchange_rare', t: 9 },
    { id: 'PalGenderReverse', t: 2, p: [{ l: ' A ', n: 1 }, { l: '', n: 1 }, { l: 'B', n: 0 }, null, { l: 'C', n: 1 }, { l: 'D', n: 1 }, { l: 'E', n: 1 }] },
    { id: 'PalEgg_Fire_01', t: 1 }, { id: 'PalGenderReverse2', t: 1 }, { id: 'PalPassiveSkillChange_X', t: 0 },
    { id: 'PalPassiveSkillChange_Y', t: 1000001 }, { id: 'PalPassiveSkillChange_Z', t: '3' },
    { id: 'PalPassiveSkillChange_W', t: 1, p: 'x', extra: 1 }, null, 'PalGenderReverse',
  ]);
  assert.deepEqual(items, [
    { id: 'PalPassiveSkillChange_Rare', t: 5, p: [{ l: '拠点 1 の箱', n: 3 }, { l: 'ギルド保管庫', n: 2 }] },
    { id: 'PalGenderReverse', t: 2, p: [{ l: 'A', n: 1 }, { l: 'C', n: 1 }, { l: 'D', n: 1 }] },
    { id: 'PalPassiveSkillChange_W', t: 1 },
  ]);
  assert.equal(cleanOwnedItems([{ id: 'PalGenderReverse', t: 1, p: [{ l: 'l'.repeat(70), n: 1 }] }])[0].p[0].l.length, 60);
  assert.equal(cleanOwnedItems(Array.from({ length: OWNED_ITEMS_MAX + 50 }, (_, i) => ({ id: `PalPassiveSkillChange_${i}`, t: 1 }))).length, OWNED_ITEMS_MAX);
});

test('列 extras の値（server）: at（その行の uploadedAt）つきの JSON。at が違う（巻き戻した古い GAS が後から行を書いた）・JSON でない・分からないなら読まない', () => {
  const extras = cleanOwnedExtras({ saveKind: 'server', clock: '5', formers: [{ uid: H, pals: 1, farms: 0 }] });
  const text = ownedExtrasText(AT, extras);
  assert.deepEqual(JSON.parse(text), { at: AT, ...extras });
  assert.deepEqual(parseOwnedExtras(text, AT), extras);
  assert.equal(parseOwnedExtras(text, '2026-10-18T10:00:00.001Z'), null);
  assert.equal(parseOwnedExtras(text, ''), null);
  for (const broken of ['', 'x', '[]', 'null', '{"saveKind":"server"}', JSON.stringify({ at: AT })]) assert.equal(parseOwnedExtras(broken, AT), null, broken);
  assert.equal(ownedExtrasText(AT, null), '');
  // 読むときも検査する（シートを手で直した値など）
  assert.deepEqual(parseOwnedExtras(JSON.stringify({ at: AT, saveKind: 'cloud', clock: 'x', formers: [{ uid: H, pals: 1, farms: 0 }, { uid: '' }], extra: 1 }), AT), {
    saveKind: '', clock: '', formers: [{ uid: H, pals: 1, farms: 0 }], items: null,
  });
});

test('fitOwnedExtras（server）: セル（at を含む JSON）を 45,000 字以下に。入らなければ在庫の場所の内訳を外し、まだ入らなければ以前の持ち主を数の多い順に残して formersPartial', () => {
  const cell = (extras) => ownedExtrasText(new Date().toISOString(), extras).length;
  assert.equal(fitOwnedExtras(null), null);
  const small = cleanOwnedExtras({ saveKind: 'coop', formers: [{ uid: H, pals: 1, farms: 0 }] });
  assert.equal(fitOwnedExtras(small), small);
  // 在庫の最大（200 種・いちばん長い ID・内訳 3 か所）は内訳を外せば入る。以前の持ち主はそのまま
  const place = { l: '拠点'.repeat(30), n: 1000000 };
  const items = Array.from({ length: OWNED_ITEMS_MAX }, (_, i) => ({ id: `PalPassiveSkillChange_${String(i).padStart(100, 'x')}`, t: 1000000, p: [place, place, place] }));
  const formers = Array.from({ length: 20 }, (_, i) => ({ uid: `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, pals: i, farms: 0 }));
  const full = cleanOwnedExtras({ saveKind: 'server', clock: '638650000000000005', formers, items });
  assert.ok(cell(full) > OWNED_EXTRAS_MAX_CHARS);
  const bare = fitOwnedExtras(full);
  assert.ok(cell(bare) <= OWNED_EXTRAS_MAX_CHARS, String(cell(bare)));
  assert.deepEqual([bare.formers, 'formersPartial' in bare, bare.items.length], [full.formers, false, OWNED_ITEMS_MAX]);
  assert.ok(bare.items.every((item) => !('p' in item) && item.t === 1000000));
  assert.deepEqual(cleanOwnedExtras(bare), bare);
  // 以前の持ち主も多い（1,000 件）: 数（拠点の個体と牧場の和）の多い順に残し、並びは元のまま。formersPartial を付ける
  const crowd = Array.from({ length: OWNED_FORMERS_MAX }, (_, i) => ({ uid: `${String(i).padStart(8, '0')}-0000-0000-0000-00000000000${i % 10}`, pals: (i * 7) % 50, farms: i % 3 }));
  const fitted = fitOwnedExtras(cleanOwnedExtras({ saveKind: 'server', clock: '638650000000000005', formers: crowd, items }));
  assert.ok(cell(fitted) <= OWNED_EXTRAS_MAX_CHARS, String(cell(fitted)));
  assert.equal(fitted.formersPartial, true);
  assert.ok(fitted.formers.length > 0 && fitted.formers.length < crowd.length, String(fitted.formers.length));
  const total = (former) => former.pals + former.farms;
  const kept = new Set(fitted.formers.map((former) => former.uid));
  const dropped = crowd.filter((former) => !kept.has(former.uid));
  assert.ok(Math.min(...fitted.formers.map(total)) >= Math.max(...dropped.map(total)));
  assert.deepEqual(fitted.formers, crowd.filter((former) => kept.has(former.uid)));
  assert.deepEqual(Object.keys(fitted), ['saveKind', 'clock', 'formers', 'formersPartial', 'items']);
  assert.deepEqual(cleanOwnedExtras(fitted), fitted);
});

test('validateOwnedUpload（server）: 追加の情報は world の中で受けて extras に整え（セルに入るよう縮める）、分かることがなければ null', () => {
  const upload = (world) => validateOwnedUpload({ worldId: 'A'.repeat(32), saveUpdatedAt: AT, world: { name: 'W', ...world }, columns: OWNED_FIELDS, rows: [] });
  assert.equal(upload({}).value.extras, null);
  assert.equal(upload({ saveKind: 'cloud', formers: 'x' }).value.extras, null);
  assert.deepEqual(upload({ saveKind: 'server', clock: '5', formers: [{ uid: H, kind: 'host', pals: 3, farms: 2 }] }).value.extras, {
    saveKind: 'server', clock: '5', formers: [{ uid: H, pals: 3, farms: 2 }], items: null,
  });
  const crowd = Array.from({ length: OWNED_FORMERS_MAX }, (_, i) => ({ uid: `u${String(i).padStart(39, '0')}`, pals: 20000, farms: 20000 }));
  const fitted = upload({ saveKind: 'server', formers: crowd }).value.extras;
  assert.ok(ownedExtrasText(AT, fitted).length <= OWNED_EXTRAS_MAX_CHARS);
  assert.equal(fitted.formersPartial, true);
});
