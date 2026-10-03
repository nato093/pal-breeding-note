import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuery, palMatches } from '../../web/js/core/kana.js';

test('normalizeQuery: ひらがな、カタカナ、半角カナと濁点を統一する', () => {
  for (const query of ['あおば', 'アオバ', 'ｱｵﾊﾞ', ' あおは\u3099 ']) assert.equal(normalizeQuery(query), 'アオバ');
  assert.equal(normalizeQuery('ゔぁ'), 'ヴァ');
});

test('normalizeQuery: 全角英数を半角小文字にし、前後の空白を除く', () => {
  assert.equal(normalizeQuery('　ＡＢＣ１２３　'), 'abc123');
  assert.equal(normalizeQuery(null), '');
  assert.equal(normalizeQuery(12), '12');
});

test('palMatches: 日本語、英語、ID、ラベル、番号の部分一致', () => {
  const pal = { id: 'Sample_Alpha', ja: 'アオバ', en: 'Green Sample', label: '12B', no: 12 };
  for (const query of ['あお', 'ｱｵ', 'GREEN', '_alpha', '２ｂ', '１２', '', '　']) {
    assert.equal(palMatches(pal, query), true, query);
  }
  assert.equal(palMatches(pal, '見つからない'), false);
  assert.equal(palMatches({ id: 'A' }, 'undefined'), false);
});
