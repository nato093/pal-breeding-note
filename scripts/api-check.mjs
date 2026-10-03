// 本番の GAS API に対して、テスト用シートで業務ルールを一通り確かめる（Node から。CORS・CSP はブラウザ側で確認する）。
// テスト用パスコードは .env.local から読み、表示しない。応答の env が test でなければ即中断する（本番データに触れない）。
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { API_URL } from '../web/js/config.js';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const passcode = env.PAL_TEST_PASSCODE;
if (!passcode) { console.error('.env.local に PAL_TEST_PASSCODE がありません'); process.exit(1); }
const unexpected = [];

async function call(action, payload = {}) {
  const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ ...payload, action, passcode }), redirect: 'follow' });
  const json = JSON.parse(await res.text());
  if (json.ok && json.env === undefined) {
    unexpected.push(`${action}: ${Object.keys(json).join(",")}`);
    return { ok: false, code: "UNEXPECTED_RESPONSE" };
  }
  if (json.ok && json.env !== "test") {
    console.error(`テスト環境以外の応答を受けたため中断します（action=${action} env=${json.env} keys=${Object.keys(json).join(',')}）`);
    process.exit(2);
  }
  return json;
}

// 前回の中断などでテスト用シートに残った有効レコードを片付ける（テスト環境でだけ実行される）
const leftovers = await call('snapshot');
for (const r of leftovers.records ?? []) await call('delete', { opId: randomUUID(), id: r.id, expectedEtag: r.etag });

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const created = [];
const rec = (p1, p2, c, extra = {}) => ({ id: randomUUID(), parent1Id: p1, parent2Id: p2, childId: c, parent1Gender: '', parent2Gender: '', registrant: '', memo: '', ...extra });
const find = (res, id) => res.snapshot?.records.find((r) => r.id === id);

// 1. 登録と数式対策の往復・正規化
const a = rec('SheepBall', 'FlowerDoll', 'MoonQueen', { memo: '=1+1', registrant: '@テスト', parent1Gender: 'M' });
const opA = randomUUID();
const r1 = await call('create', { opId: opA, record: a });
created.push(a.id);
check('登録できる', r1.ok === true && find(r1, a.id), r1.code);
check('メモの数式が文字のまま往復する', r1.record?.memo === '=1+1' && r1.record?.registrant === '@テスト', `${r1.record?.memo} / ${r1.record?.registrant}`);
check('親が正規化され性別も入れ替わる', r1.record?.parent1Id === 'FlowerDoll' && r1.record?.parent2Gender === 'M');

// 2. 冪等性（同じ opId・同じ id）
const r2 = await call('create', { opId: opA, record: a });
check('同じ opId の再送は同じ結果', r2.ok === true && r2.record?.id === a.id);
const count2 = r2.snapshot.records.filter((r) => r.id === a.id).length;
check('再送で行が増えない', count2 === 1, `件数 ${count2}`);

// 3. 重複とペア競合
const dup = rec('FlowerDoll', 'SheepBall', 'MoonQueen');
const r3 = await call('create', { opId: randomUUID(), record: dup });
check('同じ配合は DUPLICATE', r3.code === 'DUPLICATE' && r3.existing?.id === a.id, r3.code);
const c = rec('SheepBall', 'FlowerDoll', 'GuardianDog');
const r4 = await call('create', { opId: randomUUID(), record: c });
check('同ペア別の子は PAIR_CONFLICT', r4.code === 'PAIR_CONFLICT', r4.code);
const r5 = await call('create', { opId: randomUUID(), record: c, allowDifferentChild: true });
created.push(c.id);
check('確認後（新しい opId）は登録できる', r5.ok === true, r5.code);

// 4. 確認 +1 の冪等性
const opConfirm = randomUUID();
await call('confirm', { opId: opConfirm, id: a.id });
const r6 = await call('confirm', { opId: opConfirm, id: a.id });
check('同じ opId の +1 は 1 回分だけ', find(r6, a.id)?.confirmCount === 2, `確認回数 ${find(r6, a.id)?.confirmCount}`);

// 5. 編集と競合
const r7 = await call('update', { opId: randomUUID(), id: a.id, expectedEtag: 'stale-etag-0000', record: { ...a, id: undefined, memo: 'x' } });
check('古い etag の編集は CONFLICT', r7.code === 'CONFLICT', r7.code);
const cur = find(r6, a.id);
const { id: _omit, ...aBody } = a;
const r8 = await call('update', { opId: randomUUID(), id: a.id, expectedEtag: cur.etag, record: { ...aBody, memo: 'メモを更新' } });
check('最新の etag なら編集できる（確認回数は維持）', r8.ok === true && r8.record?.memo === 'メモを更新' && r8.record?.confirmCount === 2, r8.code);

// 6. 削除と取り消し
const cRec = find(r8, c.id);
const r9 = await call('delete', { opId: randomUUID(), id: c.id, expectedEtag: cRec.etag });
check('削除できる', r9.ok === true && r9.record?.deleted === true && !find(r9, c.id), r9.code);
const r10 = await call('restore', { opId: randomUUID(), id: c.id, expectedEtag: r9.record.etag });
check('取り消し（復元）できる', r10.ok === true && find(r10, c.id), r10.code);

// 7. 統合
const d = rec('MoonQueen', 'GuardianDog', 'SheepBall');
const r11 = await call('create', { opId: randomUUID(), record: d });
created.push(d.id);
const aNow = find(r11, a.id);
const dNow = find(r11, d.id);
const r12 = await call('merge', { opId: randomUUID(), sourceId: d.id, targetId: a.id, expectedEtags: { source: dNow.etag, target: aNow.etag } });
check('統合で片方が消え、もう片方に +1', r12.ok === true && !find(r12, d.id) && find(r12, a.id)?.confirmCount === 3, r12.code);

// 8. 並列登録
const parallel = ['Alpaca', 'Anubis', 'Baphomet', 'Bastet_Ice', 'BadCatgirl'].map((child) => rec('SheepBall', 'MoonQueen', child));
const t0 = Date.now();
const results = await Promise.all(parallel.map((p, i) => call('create', { opId: randomUUID(), record: p, allowDifferentChild: i > 0 || undefined })));
parallel.forEach((p) => created.push(p.id));
const okCount = results.filter((r) => r.ok).length;
const conflictCount = results.filter((r) => r.code === 'PAIR_CONFLICT').length;
check('並列 5 件: 取りこぼしなし（成功＋想定どおりの競合で 5 件）', okCount + conflictCount === 5, `成功 ${okCount}・競合 ${conflictCount}・その他 ${results.filter((r) => !r.ok && r.code !== "PAIR_CONFLICT").map((r) => r.code).join(",") || "なし"}・${Date.now() - t0}ms`);

// 後片付け（論理削除）
const final = await call('snapshot');
for (const id of created) {
  const r = final.records.find((x) => x.id === id);
  if (r) await call('delete', { opId: randomUUID(), id, expectedEtag: r.etag });
}
const after = await call('snapshot');
check('後片付け後、作成したレコードが残っていない', created.every((id) => !after.records.some((r) => r.id === id)), `警告 ${after.warnings.length} 件`);

check("想定外の応答（env なし）がない", unexpected.length === 0, unexpected.join(" / "));
process.exit(failed ? 1 : 0);
