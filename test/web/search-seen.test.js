import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchSeen } from '../../web/js/search-seen.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

test('配合を探すの新着の基準: 環境・ID ごとに ISO の時刻を 1 つ読み書きし、形の合わない値・ログイン前は使わない', () => {
  const storage = memoryStorage({ 'ns.search.seenAt.test.alice': '2026-10-05T00:00:00.000Z', 'ns.search.seenAt.prod.alice': '壊れた値' });
  const seen = createSearchSeen({ storage, namespace: 'ns', now: () => '2026-10-15T12:00:00.000Z' });
  // ID は大小・全角半角をそろえたキー
  assert.equal(seen.read('test', 'ＡＬＩＣＥ'), '2026-10-05T00:00:00.000Z');
  assert.equal(seen.read('prod', 'Alice'), null);
  assert.equal(seen.read('', 'Alice'), null);
  assert.equal(seen.read('test', ''), null);
  seen.write('prod', 'Alice');
  assert.equal(storage.values.get('ns.search.seenAt.prod.alice'), '2026-10-15T12:00:00.000Z');
  seen.write('prod', 'Alice', '2026-10-16T00:00:00Z');
  assert.equal(seen.read('prod', 'Alice'), '2026-10-16T00:00:00Z');
  // ISO でない時刻・ログイン前は書かない
  seen.write('prod', 'Alice', 'あした');
  seen.write('', 'Alice');
  assert.equal(seen.read('prod', 'Alice'), '2026-10-16T00:00:00Z');
  assert.equal(storage.values.size, 2);
});

test('配合を探すの新着の基準: 端末に読み書きできなくても投げない', () => {
  const broken = () => { throw new Error('使えない'); };
  const seen = createSearchSeen({ storage: { getItem: broken, setItem: broken } });
  assert.equal(seen.read('test', 'Alice'), null);
  assert.doesNotThrow(() => seen.write('test', 'Alice'));
  const none = createSearchSeen({ storage: null });
  assert.equal(none.read('test', 'Alice'), null);
  assert.doesNotThrow(() => none.write('test', 'Alice'));
});
