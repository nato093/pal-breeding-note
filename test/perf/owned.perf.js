import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { OWNED_FIELDS, OWNED_MAX_ROWS } from '../../web/js/core/owned-shared.js';
import { cleanOwnedPayload } from '../../web/js/core/boundary.js';
import { ownedFromShared } from '../../web/js/core/owned.js';

// data-boundary の予算: 共有を読み直すときの整え直し（cleanOwnedPayload）と画面用の変換（ownedFromShared）を合わせて 200ms 以内
test('性能: 共有の所持パル 20,000 行（27 列）の整え直しと画面用の変換が 200ms 以内', () => {
  let state = 0x4f574e44;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const pick = (items) => items[Math.floor(random() * items.length)];
  const palIds = pals.map((pal) => pal.id);
  const passiveIds = passives.map((passive) => passive.id);
  const places = ['party', 'palbox', 'base', 'dps', 'global', 'egg-incubator'];
  const rows = Array.from({ length: OWNED_MAX_ROWS }, (_, i) => {
    const owned = Array.from({ length: Math.floor(random() * 5) }, () => pick(passiveIds));
    const value = {
      instanceId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, palId: pick(palIds), palName: '', characterId: pick(palIds),
      nickname: random() < 0.1 ? `ニックネーム${i}` : '', gender: pick(['M', 'F']), level: String(1 + Math.floor(random() * 60)),
      rank: String(1 + Math.floor(random() * 5)), stars: String(Math.floor(random() * 5)), passiveIds: owned.join('|'),
      passive1: '', passive2: '', passive3: '', passive4: '',
      talentHp: String(Math.floor(random() * 101)), talentShot: String(Math.floor(random() * 101)), talentDefense: String(Math.floor(random() * 101)),
      lucky: random() < 0.01 ? '1' : '', alpha: '', egg: '', place: pick(places), placeLabel: 'パルボックス 3 ページ・2 行 4 列',
      holderUid: '00000000-0000-0000-0000-000000000001', holder: 'Alice', baseId: '', lastOwner: '', skillIds: 'AirCanon|FireBall',
    };
    return OWNED_FIELDS.map((field) => value[field] ?? '');
  });
  const world = {
    worldId: 'ABCDEF0123456789ABCDEF0123456789', worldName: 'World9', hostName: 'Alice', saveUpdatedAt: '2026-10-05T10:00:00.000Z',
    uploadedAt: '2026-10-05T10:01:00.000Z', uploadedBy: 'ホスト', palCount: rows.length, players: [{ uid: '00000000-0000-0000-0000-000000000001', name: 'Alice' }], bases: [], farms: [],
  };
  const measure = (label, operation) => {
    const start = performance.now();
    const value = operation();
    const elapsed = performance.now() - start;
    console.log(`${label}: ${elapsed.toFixed(2)} ms`);
    return { value, elapsed };
  };
  const cleaned = measure('共有の行の整え直し（cleanOwnedPayload）20,000 行', () => cleanOwnedPayload({ world, columns: OWNED_FIELDS, rows }));
  const shown = measure('画面用の変換（ownedFromShared）20,000 行', () => ownedFromShared(cleaned.value, { pals, passives }));
  const total = cleaned.elapsed + shown.elapsed;
  console.log(`合計: ${total.toFixed(2)} ms`);
  assert.equal(cleaned.value.rows.length, OWNED_MAX_ROWS);
  assert.equal(shown.value.pals.length, OWNED_MAX_ROWS);
  assert.ok(total < 200, `共有の所持パル 20,000 行の読み込みが 200ms を超えました: ${total.toFixed(2)} ms`);
});

// stable-render の予算: 所持パル 20,000 行・偏った種族の分布でも、キーワードの入力 1 回で 100ms 以上止まらない。
// 画面（views/owned.js）がする仕事と同じ: 絞り込み・並べ替えと、描く行の署名（一致の理由つき）。2,000 行を超えたら見えている範囲
//（前後を含めて 60 行）だけを描き、2,000 行以下なら全行を描く
test('性能: 所持パル 20,000 行（同じ種族が 6 割）で、キーワードの入力 1 回（絞り込み・並べ替え・描く行の署名）が 100ms 以内', async () => {
  const { normalizeOwned, filterOwned, sortOwned, keywordTerms, keywordNotes, prepareKeywords } = await import('../../web/js/core/owned.js');
  const { rowSignature } = await import('../../web/js/views/owned.js');
  let state = 0x4b455957;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const pick = (items) => items[Math.floor(random() * items.length)];
  const palIds = pals.map((pal) => pal.id);
  const passiveIds = passives.map((passive) => passive.id);
  const uid = '00000000-0000-0000-0000-000000000001';
  const snapshotOf = (count) => ({
    version: 1, world: { name: 'World9', hostName: 'Alice' }, players: [{ uid, name: 'Alice', level: 50 }], bases: [], stats: {},
    pals: Array.from({ length: count }, (_, i) => ({
      instanceId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      characterId: random() < 0.6 ? 'SheepBall' : pick(palIds), gender: pick(['Male', 'Female']), level: 1 + Math.floor(random() * 60),
      rank: 1 + Math.floor(random() * 5), nickname: random() < 0.1 ? `ニックネーム${i}` : '',
      passives: Array.from({ length: Math.floor(random() * 5) }, () => pick(passiveIds)), skills: ['AirCanon', 'FireBall'],
      talent: { hp: Math.floor(random() * 101), shot: Math.floor(random() * 101), defense: Math.floor(random() * 101) },
      location: { kind: 'palbox', playerUid: uid, slotIndex: i % 900 },
    })),
  });
  const input = (owned, query) => {
    const start = performance.now();
    const terms = keywordTerms(query);
    const list = sortOwned(filterOwned(owned.pals, { query }), 'dex');
    const drawn = list.length > 2000 ? list.slice(0, 60) : list;
    let length = 0;
    for (const pal of drawn) length += rowSignature(pal, terms.length ? keywordNotes(pal, terms) : []).length;
    return { elapsed: performance.now() - start, rows: list.length, drawn: drawn.length, length };
  };
  const big = normalizeOwned(snapshotOf(OWNED_MAX_ROWS), { pals, passives });
  assert.equal(big.pals.length, OWNED_MAX_ROWS);
  // 読み込んだ直後に、探す文字列を区切って作る（1 回 8ms まで）。入力の前に済む
  const slices = [];
  for (let next = 0; next < big.pals.length;) {
    const start = performance.now();
    while (next < big.pals.length && performance.now() - start < 8) {
      const end = Math.min(big.pals.length, next + 200);
      for (; next < end; next++) prepareKeywords(big.pals[next]);
    }
    slices.push(performance.now() - start);
  }
  console.log(`キーワードの下ごしらえ（20,000 行・区切る）: 合計 ${slices.reduce((a, b) => a + b, 0).toFixed(2)} ms・${slices.length} 回・最大 ${Math.max(...slices).toFixed(2)} ms`);
  for (const [label, query] of [['「も」', 'も'], ['「もこ」', 'もこ'], ['スキルの説明「空気」', '空気'], ['空にする', '']]) {
    const { elapsed, rows, drawn } = input(big, query);
    console.log(`キーワードの入力・20,000 行・${label}: ${elapsed.toFixed(2)} ms（${rows} 行・描く ${drawn} 行）`);
    assert.ok(elapsed < 100, `20,000 行の${label}が 100ms を超えました: ${elapsed.toFixed(2)} ms`);
  }
  // 2,000 行（全行を描く）。下ごしらえをせずに初めてのキーワード
  const small = normalizeOwned(snapshotOf(2000), { pals, passives });
  for (const [label, query] of [['初めての「も」', 'も'], ['「もこ」', 'もこ'], ['空にする', '']]) {
    const { elapsed, rows, drawn } = input(small, query);
    console.log(`キーワードの入力・2,000 行・${label}: ${elapsed.toFixed(2)} ms（${rows} 行・描く ${drawn} 行）`);
    assert.ok(elapsed < 100, `2,000 行の${label}が 100ms を超えました: ${elapsed.toFixed(2)} ms`);
  }
});
