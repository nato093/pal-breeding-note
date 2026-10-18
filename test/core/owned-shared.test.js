// セーブの識別と新旧（core/owned-shared.js。sync-fixes の owned-gas）。GAS（gas/Shared.js）・画面・開発用 API で同じ定義を使う
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSaves, ownedSaveStamp, ownedUploadIdentity, ownedSaveKey, parseOwnedSaveKey, decideOwnedUpload, cleanPresenceInput, validateOwnedUpload, OWNED_FIELDS,
  HOST_UID, OWNED_EXTRAS_MAX_CHARS, OWNED_FORMERS_MAX, OWNED_ITEMS_MAX, ownedSaveKind, cleanOwnedItems, cleanOwnedExtras, ownedExtrasText, parseOwnedExtras,
  fitOwnedExtras, OWNED_FORMAT, OWNED_ADDED_FIELDS, cleanOwnedFarms, fitOwnedFarms, OWNED_FARM_CAKES_MAX, OWNED_FARMS_MAX_CHARS, cleanOwnedCaptures,
  cleanOwnedPlayer, fitOwnedPlayers, OWNED_CAPTURES_MAX, OWNED_PLAYERS_MAX_CHARS,
  validatePlayerMapSet, planPlayerMapSet, cleanPlayerMapEntries, PLAYER_MAP_SET_MAX, PLAYER_MAP_WORLD_MAX,
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

test('共有の形の版（OWNED_FORMAT。server）: soul・condition の列と JSON の形（instanceId・captures・c・extras）を 1 回にまとめて 4＋5＋1＝10。狭めた形も前の形（4）より上', () => {
  // 前の配信（GAS 版 12・画面 c1a29e7）の形の版。共有の書き込みは、同じセーブなら形の版が上がったときだけ書き直す（decideOwnedUpload の resent）
  const PREVIOUS_FORMAT = 4;
  assert.equal(OWNED_FORMAT, PREVIOUS_FORMAT + OWNED_ADDED_FIELDS.length + 1);
  assert.equal(OWNED_FORMAT, 10);
  // 全部の後から足した列を外した 26 列の形（10−5＝5）と、版 12 の GAS に合わせて soul・condition を外した 29 列の形（10−2＝8）
  const narrowest = OWNED_FORMAT - OWNED_ADDED_FIELDS.length;
  const forV12 = OWNED_FORMAT - (OWNED_FIELDS.length - OWNED_FIELDS.indexOf('soul'));
  assert.deepEqual([narrowest, forV12], [5, 8]);
  assert.ok(narrowest > PREVIOUS_FORMAT && forV12 > PREVIOUS_FORMAT);
  // 前の画面の全部の列（29 列・版 4）で書いた行を、新しい画面の狭めた送り直し（同じ人・同じセーブ）が書き直す（resent）
  const id = (format) => ({ stamp: '638650000000000001', hash: HASH, format, fileCount: 6, missingCount: 0 });
  const current = { saveUpdatedAt: AT, uploadedBy: 'Alice', identity: id(PREVIOUS_FORMAT) };
  for (const format of [narrowest, forV12, OWNED_FORMAT]) {
    assert.deepEqual(decideOwnedUpload(current, { saveUpdatedAt: AT, uploadedBy: 'Alice', identity: { ...id(format), hash: 'd'.repeat(64) } }), { result: 'resent', write: true }, String(format));
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

// ---------------------------------------------------------------------------
// ホストの画面だけだった情報の共有（server の share-extras）: 魂の強化と状態の列・牧場のケーキ（c）・捕獲数（captures）
// ---------------------------------------------------------------------------

test('列 soul・condition（share-extras）: OWNED_FIELDS の末尾の後から足した列。31 列・版 12 の 29 列・26 列の共有を受け、足りない列は空。長さの上限', () => {
  assert.deepEqual(OWNED_FIELDS.slice(-2), ['soul', 'condition']);
  assert.deepEqual(OWNED_ADDED_FIELDS.slice(-2), ['soul', 'condition']);
  const row = (overrides = {}) => OWNED_FIELDS.map((field) => (field === 'instanceId' ? 'p1' : overrides[field] ?? ''));
  const upload = (width, cells = row()) => validateOwnedUpload({
    worldId: 'A'.repeat(32), saveUpdatedAt: AT, world: { name: 'W' }, columns: OWNED_FIELDS.slice(0, width), rows: [cells.slice(0, width)],
  });
  const full = upload(OWNED_FIELDS.length, row({ soul: '10|0|0|1', condition: 'Cold|Starvation|62' }));
  assert.deepEqual(full.value.rows[0].slice(-2), ['10|0|0|1', 'Cold|Starvation|62']);
  for (const width of [OWNED_FIELDS.length - 2, OWNED_FIELDS.length - OWNED_ADDED_FIELDS.length]) {
    const narrow = upload(width);
    assert.equal(narrow.ok, true, String(width));
    assert.deepEqual([narrow.value.rows[0].length, ...narrow.value.rows[0].slice(-2)], [OWNED_FIELDS.length, '', ''], String(width));
  }
  assert.equal(upload(OWNED_FIELDS.length - OWNED_ADDED_FIELDS.length - 1).errors[0].code, 'INVALID_COLUMNS');
  const long = upload(OWNED_FIELDS.length, row({ soul: '1'.repeat(30), condition: 'x'.repeat(200) })).value.rows[0];
  assert.deepEqual([long.at(-2).length, long.at(-1).length], [20, 140]);
});

test('牧場のケーキ c（share-extras）: [{ i: アイテム ID, n: 個数 }] を検査して 8 種まで残す（読めない牧場にも）。[] はケーキ切れ、壊れた値・配列でないは鍵を付けない（分からない）', () => {
  const farm = (c) => cleanOwnedFarms([{ id: 'F1', baseId: 'b1', parents: ['p1', 'p2'], n: 0, ...(c === undefined ? {} : { c }) }])[0];
  assert.deepEqual(farm([{ i: 'Cake02', n: 51 }, { i: 'Cake03', n: 18 }]).c, [{ i: 'Cake02', n: 51 }, { i: 'Cake03', n: 18 }]);
  assert.deepEqual(farm([]).c, []);
  for (const broken of [undefined, null, 'x', {}, [null], [{ i: 'bad id', n: 1 }], [{ i: 'Cake02', n: 0 }]]) {
    assert.equal('c' in farm(broken), false, JSON.stringify(broken));
  }
  // 形の合う項目だけを残す（ID の形・個数 1〜1,000,000 の整数）。知らない鍵は落とす
  assert.deepEqual(farm([{ i: 'Cake02', n: 1.5 }, { i: 'Cake03', n: 1000001 }, { i: 'Cake04', n: '3' }, { i: 'Cake05', n: 7, x: 1 }, 'Cake06']).c, [{ i: 'Cake05', n: 7 }]);
  assert.equal(farm(Array.from({ length: 12 }, (_, i) => ({ i: `Cake${i}`, n: 1 }))).c.length, OWNED_FARM_CAKES_MAX);
  // 読めない牧場（s: 'u'）のケーキも残す（入れ物は親と別に読める）
  const unreadable = cleanOwnedFarms([{ id: 'F2', baseId: 'b1', parents: [], s: 'u', n: 1, c: [{ i: 'Cake02', n: 2 }] }])[0];
  assert.deepEqual([unreadable.s, unreadable.c], ['u', [{ i: 'Cake02', n: 2 }]]);
});

test('fitOwnedFarms（share-extras）: セルに入らなければ タマゴの中身（eggs）→ ケーキ（c）→ 牧場 の順に外す', () => {
  const id = (prefix, i) => `${prefix}${i}`.padEnd(40, 'x');
  const cakes = Array.from({ length: OWNED_FARM_CAKES_MAX }, (_, j) => ({ i: `Cake${String(j).padStart(60, '0')}`, n: 1000000 }));
  const farms = (count, { eggs = 0 } = {}) => cleanOwnedFarms(Array.from({ length: count }, (_, i) => ({
    id: id('F', i), baseId: id('B', i), parents: [id('P', i), id('Q', i)], n: eggs, c: cakes,
    ...(eggs ? { eggs: Array.from({ length: eggs }, (_, j) => ({ id: id(`E${i}-`, j), p: 'SheepBall', m: 1 })) } : {}),
  })));
  const size = (value) => JSON.stringify(value).length;
  // (2) タマゴの中身を外せば入る: ケーキは残す
  const withEggs = farms(40, { eggs: 20 });
  assert.ok(size(withEggs) > OWNED_FARMS_MAX_CHARS);
  const counted = fitOwnedFarms(withEggs);
  assert.ok(counted.every((farm) => !('eggs' in farm) && farm.n === 20 && farm.c.length === OWNED_FARM_CAKES_MAX));
  // (3) タマゴの中身を外しても入らなければケーキも外す（牧場は全部残る・of を付けない）
  const many = farms(100);
  assert.ok(size(many) > OWNED_FARMS_MAX_CHARS);
  const bare = fitOwnedFarms(many);
  assert.ok(size(bare) <= OWNED_FARMS_MAX_CHARS, String(size(bare)));
  assert.deepEqual([bare.length, bare.some((farm) => 'c' in farm || 'of' in farm)], [100, false]);
  // (4) それでも入らなければ牧場を切る（ケーキのない形で、残した牧場に of）。JSON で 2 字になる文字の ID で、ケーキを外しても入らない牧場
  const quoted = cleanOwnedFarms(Array.from({ length: 200 }, (_, i) => ({
    id: `F${i}`.padEnd(40, '"'), baseId: `B${i}`.padEnd(40, '"'), parents: [`P${i}`.padEnd(40, '"'), `Q${i}`.padEnd(40, '"')], n: 0, c: cakes,
  })));
  const cut = fitOwnedFarms(quoted);
  assert.ok(size(cut) <= OWNED_FARMS_MAX_CHARS, String(size(cut)));
  assert.ok(cut.length > 0 && cut.length < 200, String(cut.length));
  assert.ok(cut.every((farm) => !('c' in farm) && farm.of === 200));
});

test('cleanOwnedCaptures（share-extras）: { パル ID: 回数 } を検査（ID の形・1〜10,000,000 の整数・1,000 種まで）。{} は捕まえていない、object でない・壊れた値だけなら null', () => {
  assert.deepEqual(cleanOwnedCaptures({ SheepBall: 12, Werewolf_Ice: 3 }), { SheepBall: 12, Werewolf_Ice: 3 });
  assert.deepEqual(cleanOwnedCaptures({}), {});
  for (const broken of [null, undefined, 'x', 3, [], [['SheepBall', 1]], { SheepBall: 0 }, { 'bad id': 1 }, { SheepBall: '3' }]) {
    assert.equal(cleanOwnedCaptures(broken), null, JSON.stringify(broken));
  }
  assert.deepEqual(cleanOwnedCaptures({ SheepBall: 1.5, PinkCat: 10000001, Anubis: 7, 'x y': 1 }), { Anubis: 7 });
  const many = Object.fromEntries(Array.from({ length: OWNED_CAPTURES_MAX + 10 }, (_, i) => [`Pal${i}`, 1]));
  assert.equal(Object.keys(cleanOwnedCaptures(many)).length, OWNED_CAPTURES_MAX);
  // '__proto__' などの鍵でも object の作りを変えない（自分の項目として残る）
  const odd = cleanOwnedCaptures(JSON.parse('{"__proto__": 5, "SheepBall": 1}'));
  assert.deepEqual([Object.getPrototypeOf(odd), Object.keys(odd)], [Object.prototype, ['__proto__', 'SheepBall']]);
  // プレイヤー: 分かるときだけ captures（ほかの鍵の後）
  assert.deepEqual(cleanOwnedPlayer({ uid: 'u1', name: 'Alice', captures: { SheepBall: 2 }, x: 1 }), { uid: 'u1', name: 'Alice', captures: { SheepBall: 2 } });
  assert.deepEqual(cleanOwnedPlayer({ uid: 'u1', name: 'Alice', captures: 'x' }), { uid: 'u1', name: 'Alice' });
});

test('fitOwnedPlayers（share-extras）: players のセルを 45,000 字以下に。入らなければ後ろの人から捕獲数（captures）だけを外し、instanceId などほかの鍵は全員残す', () => {
  const IID = (i) => `${String(i).padStart(8, '0')}-1111-2222-3333-444444444444`;
  const captures = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`Pal_${String(i).padStart(10, '0')}`, 1000 + i]));
  const players = Array.from({ length: 20 }, (_, i) => cleanOwnedPlayer({
    uid: `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`, name: `Player${i}`, level: 50, online: i % 2 === 0, instanceId: IID(i), captures,
  }));
  const small = players.slice(0, 2);
  assert.equal(fitOwnedPlayers(small), small);
  assert.ok(JSON.stringify(players).length > OWNED_PLAYERS_MAX_CHARS);
  const fitted = fitOwnedPlayers(players);
  assert.ok(JSON.stringify(fitted).length <= OWNED_PLAYERS_MAX_CHARS, String(JSON.stringify(fitted).length));
  // 前の人は捕獲数が残り、後ろの人から外れる（間に残った人はいない）
  const kept = fitted.map((player) => 'captures' in player);
  const first = kept.indexOf(false);
  assert.ok(first > 0 && kept.slice(first).every((value) => !value), JSON.stringify(kept));
  // ほかの鍵（uid・name・level・online・instanceId）は全員そのまま
  assert.deepEqual(fitted.map(({ captures: _captures, ...rest }) => rest), players.map(({ captures: _captures, ...rest }) => rest));
  assert.equal(fitted.length, players.length);
  // 元の一覧は変えない
  assert.ok(players.every((player) => 'captures' in player));
  // validateOwnedUpload（GAS・開発用 API）も同じ規則で縮める
  const checked = validateOwnedUpload({ worldId: 'A'.repeat(32), saveUpdatedAt: AT, world: { name: 'W' }, players, columns: OWNED_FIELDS, rows: [] });
  assert.deepEqual(checked.value.players, fitted);
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

// プレイヤーの対応（server の mapping。GAS の PlayerMap と開発用 API で同じ検査と規則）
const mapKey = (n) => `i:11111111-2222-4333-8444-${String(n).padStart(12, '0')}`;
const MAP_WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const checkUserId = (value) => (typeof value === 'string' && value.trim() && value.length <= 20
  ? { ok: true, value: value.trim() } : { ok: false, errors: [{ field: 'userId', code: typeof value === 'string' ? 'TOO_LONG' : 'REQUIRED' }] });

test('validatePlayerMapSet（mapping）: 形を確かめて整える。空白だけの ID は外す印、同じ鍵は後の方。findUser でノートの ID の表記にし、なければ USER_NOT_FOUND', () => {
  const input = {
    action: 'playerMapSet', passcode: 'x', userId: ' Bob ', worldId: MAP_WORLD.toLowerCase(), onlyMissing: true,
    entries: [{ key: mapKey(1).toUpperCase(), userId: 'taro', playerName: ' Alice\u0000 ' }, { key: mapKey(2), userId: '  ' }, { key: mapKey(1), userId: 'hanako' }],
  };
  assert.deepEqual(validatePlayerMapSet(input, { checkUserId }), { ok: true, value: {
    userId: 'Bob', worldId: MAP_WORLD, onlyMissing: true, entries: [{ key: mapKey(2), userId: '', playerName: '' }, { key: mapKey(1), userId: 'hanako', playerName: '' }],
  } });
  const users = ['Taro'];
  const findUser = (value) => users.find((user) => user.toLowerCase() === value.toLowerCase()) ?? '';
  assert.deepEqual(validatePlayerMapSet({ ...input, entries: input.entries.slice(0, 2) }, { checkUserId, findUser }).value.entries, [
    { key: mapKey(1), userId: 'Taro', playerName: 'Alice' }, { key: mapKey(2), userId: '', playerName: '' },
  ]);
  assert.deepEqual(validatePlayerMapSet(input, { checkUserId, findUser }), { ok: false, errors: [{ field: 'entries.2.userId', code: 'USER_NOT_FOUND' }] });
  assert.deepEqual(validatePlayerMapSet({ ...input, onlyMissing: undefined }, { checkUserId }).value.onlyMissing, false);
  assert.deepEqual(validatePlayerMapSet(null, { checkUserId }).errors, [
    { field: 'userId', code: 'REQUIRED' }, { field: 'worldId', code: 'INVALID_WORLD' }, { field: 'entries', code: 'INVALID_ENTRIES' },
  ]);
  assert.equal(validatePlayerMapSet({ ...input, entries: Array.from({ length: PLAYER_MAP_SET_MAX }, (_, i) => ({ key: mapKey(i), userId: '' })) }, { checkUserId }).ok, true);
});

test('planPlayerMapSet（mapping）: onlyMissing はある鍵（外した印を含む）を書かず、同じ内容も書かない（どちらも skipped）。鍵を増やして 200 を超えるときだけ TOO_MANY', () => {
  const at = '2026-10-18T00:00:00.000Z';
  const current = [
    { key: mapKey(1), userId: 'Taro', playerName: 'Alice', updatedBy: 'Bob', updatedAt: at },
    { key: mapKey(2), userId: '', playerName: '', updatedBy: 'Bob', updatedAt: at },
  ];
  const input = (entries, onlyMissing = false) => ({ userId: 'Carol', worldId: MAP_WORLD, entries, onlyMissing });
  const later = '2026-10-18T01:00:00.000Z';
  const plan = planPlayerMapSet(current, input([
    { key: mapKey(1), userId: 'Taro', playerName: 'Alice' }, { key: mapKey(2), userId: 'Taro', playerName: '' }, { key: mapKey(3), userId: 'Hanako', playerName: '' },
  ]), later);
  assert.deepEqual([plan.ok, plan.changed, plan.skipped], [true, 2, 1]);
  assert.deepEqual(plan.writes.map((entry) => [entry.key, entry.userId, entry.updatedBy, entry.updatedAt]), [[mapKey(2), 'Taro', 'Carol', later], [mapKey(3), 'Hanako', 'Carol', later]]);
  assert.deepEqual(plan.entries.map((entry) => entry.key), [mapKey(1), mapKey(2), mapKey(3)]);
  const missing = planPlayerMapSet(current, input([{ key: mapKey(1), userId: 'Hanako', playerName: '' }, { key: mapKey(2), userId: 'Taro', playerName: '' }], true), later);
  assert.deepEqual([missing.changed, missing.skipped, missing.writes], [0, 2, []]);
  // 上限: 200 から鍵を増やすときだけ断る（手で増えて 200 を超えていても、今ある鍵の書き換えはできる）
  const full = Array.from({ length: PLAYER_MAP_WORLD_MAX + 3 }, (_, i) => ({ key: mapKey(i), userId: '', playerName: '', updatedBy: '', updatedAt: '' }));
  assert.deepEqual(planPlayerMapSet(full.slice(0, PLAYER_MAP_WORLD_MAX), input([{ key: mapKey(999), userId: '', playerName: '' }]), later),
    { ok: false, errors: [{ field: 'worldId', code: 'TOO_MANY' }] });
  assert.equal(planPlayerMapSet(full, input([{ key: mapKey(0), userId: 'Taro', playerName: '' }]), later).changed, 1);
});

test('cleanPlayerMapEntries（mapping）: 形の違う要素（鍵・ID が文字列でない・ID が 20 字を超える）を捨て、同じ鍵は後の要素。200 件まで', () => {
  const entry = (n, extra = {}) => ({ key: mapKey(n), userId: 'Taro', playerName: 'Alice', updatedBy: 'Bob', updatedAt: '2026-10-18T00:00:00.000Z', ...extra });
  assert.deepEqual(cleanPlayerMapEntries([entry(1), null, entry(2, { key: 'x' }), entry(3, { userId: 1 }), entry(4, { userId: 'あ'.repeat(21) }), entry(1, { userId: '', updatedAt: 'x', extra: 1 })]),
    [{ ...entry(1), userId: '', updatedAt: '' }]);
  assert.deepEqual(cleanPlayerMapEntries('x'), []);
  assert.equal(cleanPlayerMapEntries(Array.from({ length: PLAYER_MAP_WORLD_MAX + 5 }, (_, i) => entry(i))).length, PLAYER_MAP_WORLD_MAX);
});
