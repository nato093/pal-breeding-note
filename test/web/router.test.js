import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, extractInvitation, invitationLink, shareLink } from '../../web/js/router.js';

test('ルーティング: 各画面で招待コードだけを除去し、検索条件を残す', () => {
  for (const hash of ['#/search?p1=A&p2=B&k=招待', '#/reverse?c=C&k=招待', '#/route?from=A&to=C&k=招待',
    '#/list?k=招待', '#/pal/A?k=招待', '#/settings?k=招待']) {
    const original = parseHash(hash);
    const extracted = extractInvitation(hash);
    const cleaned = parseHash(extracted.hash);
    assert.equal(extracted.passcode, '招待');
    assert.equal(cleaned.params.has('k'), false);
    original.params.delete('k');
    assert.deepEqual([...cleaned.params], [...original.params]);
    assert.equal(cleaned.view, original.view);
    assert.equal(cleaned.id, original.id);
  }
});

test('ルーティング: URL の特殊文字、空値、不正なパスを扱う', () => {
  assert.equal(buildHash('search', { p1: '', p2: undefined }), '#/search');
  assert.equal(parseHash('#/unknown').view, 'search');
  assert.equal(parseHash('#/pal/%').id, '');
  assert.equal(parseHash(buildHash('pal', {}, '名前/番号')).id, '名前/番号');
  assert.equal(extractInvitation('#/search?p1=A').passcode, null);
  assert.equal(parseHash(buildHash('search', { k: 'a+b /?' })).params.get('k'), 'a+b /?');
});

test('招待リンク: サブディレクトリを維持する', () => {
  const url = new URL(invitationLink('https://example.test', '/Pal/', '招待+コード'));
  assert.equal(url.pathname, '/Pal/');
  assert.equal(parseHash(url.hash).params.get('k'), '招待+コード');
});

test('共有リンク: ハッシュとクエリの k を除去し、検索条件を維持する', () => {
  const url = new URL(shareLink('https://example.test/Pal/?k=secret#/route?from=A&to=B&k=secret'));
  assert.equal(url.searchParams.has('k'), false);
  assert.equal(url.hash, '#/route?from=A&to=B');
  assert.doesNotMatch(url.href, /secret/);
});
