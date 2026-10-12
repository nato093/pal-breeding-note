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
