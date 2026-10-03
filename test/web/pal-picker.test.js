import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPals } from '../../web/js/ui/pal-picker.js';
import pals from '../../web/data/pals.js';

test('パル選択: 非アクティブを除き、図鑑番号の完全一致を先頭へ並べる', () => {
  assert.ok(filterPals('').every((pal) => pal.active));
  const matches = filterPals('１');
  assert.equal(matches[0].no, 1);
  assert.ok(matches.some((pal) => pal.no > 1));
  assert.equal(filterPals('もころん')[0].ja, 'モコロン');
});

test('パル選択: 検索が空のとき最近使ったパルを先頭へ並べる', () => {
  const recent = pals.filter((pal) => pal.active).slice(10, 12).map((pal) => pal.id);
  assert.deepEqual(filterPals('', recent).slice(0, 2).map((pal) => pal.id), recent);
});
