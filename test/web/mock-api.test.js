import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import { createDevelopmentApi } from '../../dev/mock-api.js';
import { createApi } from '../../web/js/api.js';

const ids = pals.filter((pal) => pal.active).slice(0, 5).map((pal) => pal.id);
const input = (overrides = {}) => ({ id: crypto.randomUUID(), parent1Id: ids[0], parent2Id: ids[1], childId: ids[2],
  parent1Gender: '', parent2Gender: '', registrant: '', memo: '', ...overrides });
const request = (action, extra = {}) => ({ action, passcode: 'ローカル動作確認', ...(action === 'snapshot' ? {} : { opId: crypto.randomUUID() }), ...extra });

test('モック: 初期データは空、seed を明示した場合だけマスター ID で架空データを作る', async () => {
  const api = createDevelopmentApi();
  const initial = await api(request('snapshot'));
  assert.deepEqual(initial.records, []);
  assert.equal(initial.env, 'test');
  const seeded = await createDevelopmentApi({ seed: '12' })(request('snapshot'));
  assert.equal(seeded.records.length, 12);
  const master = new Set(pals.map((pal) => pal.id));
  assert.ok(seeded.records.every((record) => [record.parent1Id, record.parent2Id, record.childId].every((id) => master.has(id))));
  assert.ok(seeded.records.every((record) => record.memo.includes('ランダム')));
});

test('モック: 登録の正規化、ID 冪等性、ID の競合、重複、ペア競合を判定する', async () => {
  const api = createDevelopmentApi();
  const record = input({ parent1Id: ids[1], parent2Id: ids[0], parent1Gender: 'M', parent2Gender: 'F' });
  const create = await api(request('create', { record }));
  assert.equal(create.ok, true);
  assert.ok(create.record.parent1Id <= create.record.parent2Id);
  assert.equal(create.snapshot.records.length, 1);
  assert.equal((await api(request('create', { record }))).idempotent, true);
  assert.equal((await api(request('create', { record: { ...record, memo: '変更' } }))).code, 'ID_CONFLICT');
  assert.equal((await api(request('create', { record: { ...record, id: crypto.randomUUID() } }))).code, 'DUPLICATE');
  const different = input({ childId: ids[3] });
  const conflict = request('create', { record: different });
  assert.equal((await api(conflict)).code, 'PAIR_CONFLICT');
  assert.equal((await api({ ...conflict, opId: crypto.randomUUID(), allowDifferentChild: true })).ok, true);
});

test('モック: 全操作の opId 再送は一回分だけ反映し、有効な全件を毎回返す', async () => {
  const api = createDevelopmentApi();
  const createRequest = request('create', { record: input() });
  const first = await api(createRequest);
  const repeated = await api(createRequest);
  assert.equal(first.record.id, repeated.record.id);
  assert.equal(repeated.snapshot.records.length, 1);
  const confirmRequest = request('confirm', { id: first.record.id });
  await api(confirmRequest);
  const confirmed = await api(confirmRequest);
  assert.equal(confirmed.record.confirmCount, 2);
  const updateRequest = request('update', { id: first.record.id, expectedEtag: confirmed.record.etag,
    record: { ...input(), id: undefined } });
  delete updateRequest.record.id;
  updateRequest.record.memo = '編集したメモ';
  const updated = await api(updateRequest);
  assert.equal(updated.ok, true);
  assert.equal((await api(updateRequest)).record.etag, updated.record.etag);
  const deleteRequest = request('delete', { id: first.record.id, expectedEtag: updated.record.etag });
  const deleted = await api(deleteRequest);
  assert.equal(deleted.record.deleted, true);
  assert.equal(deleted.snapshot.records.length, 0);
  assert.equal((await api(deleteRequest)).record.etag, deleted.record.etag);
  const restoreRequest = request('restore', { id: first.record.id, expectedEtag: deleted.record.etag });
  const restored = await api(restoreRequest);
  assert.equal(restored.record.deleted, false);
  assert.equal(restored.snapshot.records.length, 1);
  assert.equal((await api(restoreRequest)).record.etag, restored.record.etag);
});

test('モック: 編集の etag 競合と配合の変更による確認回数リセットを判定する', async () => {
  const api = createDevelopmentApi();
  const record = (await api(request('create', { record: input() }))).record;
  const confirmed = (await api(request('confirm', { id: record.id }))).record;
  const updatedInput = input({ childId: ids[3] });
  delete updatedInput.id;
  const conflicting = await api(request('update', { id: record.id, expectedEtag: record.etag, record: updatedInput }));
  assert.equal(conflicting.code, 'CONFLICT');
  assert.equal(conflicting.latest.confirmCount, 2);
  const updated = await api(request('update', { id: record.id, expectedEtag: confirmed.etag, record: updatedInput }));
  assert.equal(updated.record.confirmCount, 1);
  assert.equal((await api(request('delete', { id: record.id, expectedEtag: record.etag }))).code, 'CONFLICT');
});

test('モック: 編集の重複を統合し、統合の再送で確認回数を増やさない', async () => {
  const api = createDevelopmentApi();
  const source = (await api(request('create', { record: input() }))).record;
  const target = (await api(request('create', { record: input({ parent2Id: ids[3] }) }))).record;
  const changed = input({ parent2Id: ids[3] });
  delete changed.id;
  assert.equal((await api(request('update', { id: source.id, expectedEtag: source.etag, record: changed }))).code, 'DUPLICATE');
  const merge = request('merge', { sourceId: source.id, targetId: target.id, expectedEtags: { source: source.etag, target: target.etag } });
  assert.equal((await api({ ...merge, expectedEtags: { source: '古い', target: target.etag } })).code, 'CONFLICT');
  const result = await api(merge);
  assert.equal(result.removed, source.id);
  assert.equal(result.record.confirmCount, 2);
  assert.equal(result.snapshot.records.length, 1);
  assert.equal((await api(merge)).record.confirmCount, 2);
});

test('モック: 復元の競合と既存登録への統合を判定する', async () => {
  const api = createDevelopmentApi();
  const original = input();
  const created = (await api(request('create', { record: original }))).record;
  const deleted = (await api(request('delete', { id: created.id, expectedEtag: created.etag }))).record;
  assert.equal((await api(request('restore', { id: created.id, expectedEtag: created.etag }))).code, 'CONFLICT');
  const target = (await api(request('create', { record: { ...original, id: crypto.randomUUID() } }))).record;
  const restore = request('restore', { id: deleted.id, expectedEtag: deleted.etag });
  const result = await api(restore);
  assert.equal(result.mergedInto, target.id);
  assert.equal(result.record.confirmCount, 2);
  assert.equal(result.snapshot.records.length, 1);
  assert.equal((await api(restore)).record.confirmCount, 2);
});

test('モック: 未知の項目・マスター外 ID・無効な性別・文字数・存在しない登録を拒否する', async () => {
  const api = createDevelopmentApi();
  assert.equal((await api(request('create', { record: input(), extra: true }))).errors[0].code, 'UNKNOWN_FIELD');
  assert.equal((await api(request('create', { record: input({ childId: '存在しない' }) }))).code, 'VALIDATION');
  assert.equal((await api(request('create', { record: input({ parent1Gender: '不正' }) }))).code, 'VALIDATION');
  assert.equal((await api(request('create', { record: input({ memo: 'あ'.repeat(201) }) }))).code, 'VALIDATION');
  assert.equal((await api(request('create', { record: input({ confirmCount: 99 }) }))).errors[0].code, 'UNKNOWN_FIELD');
  assert.equal((await api(request('confirm', { id: crypto.randomUUID() }))).code, 'NOT_FOUND');
  assert.equal((await api({ action: 'snapshot', passcode: '' })).code, 'AUTH');
});

test('モック: 本物の API クライアントへ差し替えて同じ応答形で使える', async () => {
  const api = createApi({ transport: createDevelopmentApi() });
  const initial = await api.request('snapshot', 'ローカル動作確認');
  assert.deepEqual(initial.records, []);
  const created = await api.request('create', 'ローカル動作確認', { opId: crypto.randomUUID(), record: input() });
  assert.equal(created.snapshot.records.length, 1);
});

test('モック: セッションのパスコードと違う入力を AUTH として拒否する', async () => {
  const api = createDevelopmentApi();
  assert.equal((await api(request('snapshot'))).ok, true);
  assert.equal((await api({ ...request('snapshot'), passcode: '別の入力' })).code, 'AUTH');
  const configured = createDevelopmentApi({ passcode: '試験用の入力' });
  assert.equal((await configured(request('snapshot'))).code, 'AUTH');
  assert.equal((await configured({ action: 'snapshot', passcode: '試験用の入力' })).ok, true);
});
