import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../../web/data/breeding.js';
import pals from '../../web/data/pals.js';
import { decodeBreeding, breedChild, isGenderDependent } from '../../web/js/core/breeding.js';

const table = decodeBreeding(data);

test('配合表: パルのマスターと同じ ID の並びで、取り込み元が分かる', () => {
  assert.deepEqual(table.ids, pals.map((p) => p.id));
  assert.match(data.source, /^tylercamp\/palcalc@[0-9a-f]{40}$/);
});

test('配合表: 同じ種族どうしは同じ種族、それ以外は表の子', () => {
  assert.equal(breedChild(table, 'GuardianDog', 'M', 'GuardianDog', 'F'), 'GuardianDog');
  // 手元のセーブで、牧場の親とタマゴの中身が一致した組み合わせ（2026-10-06）
  assert.equal(breedChild(table, 'SheepBall', 'F', 'SwordCutlassfish', 'M'), 'GuardianDog');
  assert.equal(breedChild(table, 'SwordCutlassfish', 'M', 'SheepBall', 'F'), 'GuardianDog');
});

test('配合表: 性別で子が変わる組み合わせ（CatMage×FoxMage）', () => {
  assert.equal(breedChild(table, 'CatMage', 'F', 'FoxMage', 'M'), 'CatMage_Fire');
  assert.equal(breedChild(table, 'FoxMage', 'F', 'CatMage', 'M'), 'FoxMage_Dark');
  assert.equal(breedChild(table, 'CatMage', '', 'FoxMage', ''), '');
  assert.ok(isGenderDependent(table, 'FoxMage', 'CatMage'));
});

test('配合表: マスターにない ID は分からない（空）', () => {
  assert.equal(breedChild(table, 'NoSuchPal', 'M', 'SheepBall', 'F'), '');
});
