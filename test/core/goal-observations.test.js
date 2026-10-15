import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanObservations, parseObservations, observeSpecies, firstObservation, mergeObservation, mergeObservations, cleanPair, OBSERVATIONS_VERSION,
} from '../../web/js/core/goal-observations.js';

const time = (second) => new Date(Date.UTC(2026, 9, 4, 0, 0, second)).toISOString();

test('観測: 初めての観測はその時点の組を覚えるだけで知らせない（作れても readyAt は空）', () => {
  assert.deepEqual(firstObservation(['A|B'], time(1)), { craftable: true, readyAt: '', observedAt: time(1), pairs: ['A|B'], found: [] });
  assert.deepEqual(firstObservation([], 'こわれた'), { craftable: false, readyAt: '', observedAt: '', pairs: [], found: [] });
});

test('観測: 作れるようになったら readyAt、作れる間に増えた組は found、作れなくなると found も消え、一度見た組は知らせ直さない', () => {
  let entry = firstObservation([], time(1));
  entry = observeSpecies(entry, ['A|B'], time(2), time(10));
  assert.deepEqual([entry.craftable, entry.readyAt, entry.found], [true, time(10), []]);
  entry = observeSpecies(entry, ['A|B', 'C|D'], time(3), time(11));
  assert.deepEqual(entry.found, [{ pair: 'C|D', at: time(11) }]);
  assert.equal(entry.readyAt, time(10));
  // 作れなくなったら readyAt も found も消える
  entry = observeSpecies(entry, [], time(4), time(12));
  assert.deepEqual([entry.craftable, entry.readyAt, entry.found], [false, '', []]);
  // また作れるようになれば新しい readyAt。一度見た組（C|D）は増えた組として知らせない
  entry = observeSpecies(entry, ['A|B'], time(5), time(13));
  entry = observeSpecies(entry, ['A|B', 'C|D'], time(6), time(14));
  assert.equal(entry.readyAt, time(13));
  assert.deepEqual(entry.found, []);
  // 組を覚える前の観測（pairs が null）は、次の判定で今の組を覚えるだけ
  const unknown = observeSpecies({ craftable: true, readyAt: time(1), observedAt: time(1), pairs: null, found: [] }, ['A|B', 'E|F'], time(7), time(15));
  assert.deepEqual([unknown.found, unknown.pairs], [[], ['A|B', 'E|F']]);
});

test('観測: 保存の形を整え（版・種族の ID・時刻・組の形）、読めないものは空の形にする', () => {
  const clean = cleanObservations({
    version: OBSERVATIONS_VERSION,
    species: { SheepBall: { craftable: true, readyAt: time(1), observedAt: time(2), pairs: ['B|A', 'こわれた'], found: [{ pair: 'A|B', at: time(3) }, { pair: 'x', at: time(3) }] }, 'bad id': {} },
    migration: { wishlist: { migrated: { SheepBall: 'wish-SheepBall', PinkCat: 'bad id!' }, pending: ['Alpaca', 'Alpaca', 7], doneAt: 'こわれた' } },
  });
  assert.deepEqual(clean.species, { SheepBall: { craftable: true, readyAt: time(1), observedAt: time(2), pairs: ['A|B'], found: [{ pair: 'A|B', at: time(3) }] } });
  assert.deepEqual(clean.migration.wishlist, { migrated: { SheepBall: 'wish-SheepBall' }, pending: ['Alpaca'], doneAt: '' });
  assert.deepEqual(parseObservations('こわれた'), { version: 1, species: {}, migration: { wishlist: { migrated: {}, pending: [], doneAt: '' } } });
  assert.deepEqual(cleanObservations({ version: 99, species: { SheepBall: {} } }).species, {});
  assert.equal(cleanPair('B|A'), 'A|B');
  assert.equal(cleanPair('A'), '');
});

test('観測: Object の組み込みの名前（constructor・__proto__ など）は種族・移行の記録・組から外す（辞書を palId で引いたときに継承したものを拾わない）', () => {
  const entry = { craftable: true, readyAt: '2026-10-15T00:00:00.000Z', observedAt: '2026-10-15T00:00:00.000Z', pairs: ['constructor|SheepBall', 'FlowerDoll|SheepBall'], found: [] };
  const source = JSON.parse(JSON.stringify({ version: 1, species: { constructor: entry, toString: entry, SheepBall: entry }, migration: { wishlist: { migrated: { constructor: 'g1', SheepBall: 'g2' }, pending: ['hasOwnProperty', 'CatMage'], doneAt: '' } } })
    .replace('"toString"', '"__proto__"'));
  const clean = cleanObservations(source);
  assert.deepEqual(Object.keys(clean.species), ['SheepBall']);
  assert.deepEqual(clean.species.SheepBall.pairs, ['FlowerDoll|SheepBall']);
  assert.equal(Object.hasOwn(clean.species, 'constructor'), false);
  assert.deepEqual(clean.migration.wishlist.migrated, { SheepBall: 'g2' });
  assert.deepEqual(clean.migration.wishlist.pending, ['CatMage']);
  assert.equal(cleanPair('constructor|SheepBall'), '');
});

test('観測: 2 つの観測を併せる（組と found の和、craftable は新しい方、readyAt は早い方）。保存の値どうしは移行の記録も和', () => {
  const a = { craftable: true, readyAt: time(5), observedAt: time(6), pairs: ['A|B'], found: [{ pair: 'C|D', at: time(7) }] };
  const b = { craftable: true, readyAt: time(3), observedAt: time(4), pairs: ['E|F'], found: [{ pair: 'C|D', at: time(5) }] };
  assert.deepEqual(mergeObservation(a, b), { craftable: true, readyAt: time(3), observedAt: time(6), pairs: ['A|B', 'E|F'], found: [{ pair: 'C|D', at: time(5) }] });
  // 新しい方が作れないなら作れない（readyAt・found は消える）
  assert.deepEqual(mergeObservation(a, { ...b, craftable: false, readyAt: '', observedAt: time(9), found: [] }).craftable, false);
  assert.equal(mergeObservation(null, b), b);
  const merged = mergeObservations(
    { version: 1, species: { SheepBall: a }, migration: { wishlist: { migrated: { SheepBall: 'wish-SheepBall' }, pending: ['Alpaca'], doneAt: '' } } },
    { version: 1, species: { SheepBall: b, PinkCat: b }, migration: { wishlist: { migrated: { Alpaca: 'wish-Alpaca' }, pending: [], doneAt: time(1) } } },
  );
  assert.deepEqual(Object.keys(merged.species).sort(), ['PinkCat', 'SheepBall']);
  assert.deepEqual(merged.migration.wishlist.migrated, { Alpaca: 'wish-Alpaca', SheepBall: 'wish-SheepBall' });
  // 片方で移したものは未移行に残さない
  assert.deepEqual(merged.migration.wishlist.pending, []);
});
