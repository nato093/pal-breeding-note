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

// owned-rows: 列見出しの並べ替え（HP・攻撃・防御・良いパッシブ順・ボックス順と向きの反転）・目標の印・行の部品の生成。
// 2,000 行・20,000 行（同じ種族が 6 割の偏った分布）でも、入力 1 回（絞り込み＋並べ替え）が 100ms 以内
async function biasedOwned(count, seed) {
  const { normalizeOwned } = await import('../../web/js/core/owned.js');
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const pick = (items) => items[Math.floor(random() * items.length)];
  const palIds = pals.map((pal) => pal.id);
  const passiveIds = passives.map((passive) => passive.id);
  const uid = '00000000-0000-0000-0000-000000000001';
  const base = 'b1b1b1b1-1111-4111-8111-111111111111';
  const kinds = ['palbox', 'palbox', 'palbox', 'party', 'base', 'dps', 'global', 'egg-incubator'];
  return normalizeOwned({
    version: 1, world: { name: 'World9', hostName: 'Alice' }, players: [{ uid, name: 'Alice', level: 50 }], bases: [{ id: base, number: 1 }], stats: {},
    pals: Array.from({ length: count }, (_, i) => {
      const kind = pick(kinds);
      return {
        instanceId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
        characterId: random() < 0.6 ? 'SheepBall' : pick(palIds), gender: pick(['Male', 'Female']), level: 1 + Math.floor(random() * 60),
        rank: 1 + Math.floor(random() * 5), nickname: random() < 0.1 ? `ニックネーム${i}` : '',
        passives: Array.from({ length: Math.floor(random() * 5) }, () => pick(passiveIds)), skills: ['AirCanon', 'FireBall'],
        talent: { hp: Math.floor(random() * 101), shot: Math.floor(random() * 101), defense: Math.floor(random() * 101) },
        lastOwnerUid: uid, location: { kind, playerUid: uid, baseId: kind === 'base' || kind === 'egg-incubator' ? base : '', slotIndex: i % 960 },
      };
    }),
  }, { pals, passives });
}

test('性能: 所持パル 2,000 行・20,000 行（同じ種族が 6 割）で、どの並べ替え（向きの反転を含む）も絞り込みと合わせて 100ms 以内', async () => {
  const { filterOwned, sortOwned, OWNED_SORTS } = await import('../../web/js/core/owned.js');
  for (const count of [2000, OWNED_MAX_ROWS]) {
    const owned = await biasedOwned(count, 0x534f5254);
    const times = [];
    for (const [key, , dir] of OWNED_SORTS) {
      for (const direction of [dir, dir === 'asc' ? 'desc' : 'asc']) {
        const start = performance.now();
        const list = sortOwned(filterOwned(owned.pals, { places: ['party', 'palbox', 'base', 'dps', 'egg'] }), key, direction);
        const elapsed = performance.now() - start;
        times.push(elapsed);
        assert.ok(list.length > 0);
        assert.ok(elapsed < 100, `${count} 行の並べ替え（${key}・${direction}）が 100ms を超えました: ${elapsed.toFixed(2)} ms`);
      }
    }
    console.log(`並べ替え（絞り込みと合わせて）・${count} 行: 最大 ${Math.max(...times).toFixed(2)} ms（${times.length} 通り）`);
  }
});

test('性能: 目標 100 件 × 所持パル 20,000 行の目標の印（goalMarks）と、印の文字を含むキーワードの絞り込みが 100ms 以内', async () => {
  const { goalMarks, cleanGoal } = await import('../../web/js/core/ideal-goals.js');
  const { filterOwned, prepareKeywords } = await import('../../web/js/core/owned.js');
  const owned = await biasedOwned(OWNED_MAX_ROWS, 0x4d41524b);
  for (const pal of owned.pals) prepareKeywords(pal);
  const species = ['SheepBall', ...pals.slice(0, 99).map((pal) => pal.id)];
  const goals = species.map((palId, i) => cleanGoal({
    // 半分は欲しいパッシブなし（個体値だけの目標。完成品が多い）、半分はパッシブ 2 つ
    id: `g${i}`, name: `目標${i}`, palId, passives: i % 2 ? [] : passives.slice(i % 50, (i % 50) + 2).map((passive) => passive.id), mode: 'include',
    targets: { hp: 50, shot: 0, defense: 0 }, cake: 'none', order: 'next', addedAt: '', worlds: {},
  }));
  let start = performance.now();
  const marks = goalMarks(goals, owned.pals);
  const marking = performance.now() - start;
  console.log(`目標の印（目標 100 件・20,000 行）: ${marking.toFixed(2)} ms（印のある個体 ${marks.size}）`);
  assert.ok(marking < 100, `目標の印が 100ms を超えました: ${marking.toFixed(2)} ms`);
  start = performance.now();
  const found = filterOwned(owned.pals, { query: '完成品', extraTexts: marks });
  const searching = performance.now() - start;
  console.log(`印の文字を含むキーワード「完成品」・20,000 行: ${searching.toFixed(2)} ms（${found.length} 行）`);
  assert.ok(searching < 100, `印の文字のキーワードが 100ms を超えました: ${searching.toFixed(2)} ms`);
});

// B1（フェーズ 1b・1c の終わりのレビュー）: 目標が 1 つの種族に偏り、所持パルもその種族ばかりのとき。前の goalMarks は目標ごとに
// その種族の全個体を見て、個体ごとに Set を作っていたので、目標 100 件 × 20,000 行で 1〜2.6 秒止まった（上のテストは目標を 100 種族に
// 散らしていて気づけなかった）。印の計算と、印の文字を含むキーワードの入力（1 回目と 2 回目以降）が、それぞれ 100ms 以内
test('性能: 同じ種族の目標 100 件 × 同じ種族の所持パル 20,000 行の目標の印（goalMarks）と、印の文字を含むキーワードの絞り込みが 100ms 以内', async () => {
  const { goalMarks, cleanGoal, goalKey } = await import('../../web/js/core/ideal-goals.js');
  const { normalizeOwned, filterOwned, prepareKeywords } = await import('../../web/js/core/owned.js');
  let state = 0x42315f31;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const pick = (items) => items[Math.floor(random() * items.length)];
  const passiveIds = passives.map((passive) => passive.id);
  const uid = '00000000-0000-0000-0000-000000000001';
  const owned = normalizeOwned({
    version: 1, world: { name: 'World9', hostName: 'Alice' }, players: [{ uid, name: 'Alice', level: 50 }], bases: [], stats: {},
    pals: Array.from({ length: OWNED_MAX_ROWS }, (_, i) => ({
      instanceId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, characterId: 'SheepBall', gender: pick(['Male', 'Female']),
      level: 1 + Math.floor(random() * 60), rank: 1, nickname: '', passives: Array.from({ length: Math.floor(random() * 5) }, () => pick(passiveIds)),
      skills: ['AirCanon'], talent: { hp: Math.floor(random() * 101), shot: Math.floor(random() * 101), defense: Math.floor(random() * 101) },
      location: { kind: 'palbox', playerUid: uid, slotIndex: i % 960 },
    })),
  }, { pals, passives });
  for (const pal of owned.pals) prepareKeywords(pal);
  // 半分は個体値だけの目標（HP 30〜79 以上。完成品が約半分の個体に付く）、半分は欲しいパッシブ 2 つ（4 件に 1 件は「だけ」）。
  // 保存した目標は同じ条件のものを 1 つにまとめる（parseGoals）ので、どの目標も条件を変えてある
  const goals = Array.from({ length: 100 }, (_, i) => cleanGoal({
    id: `g${i}`, name: `目標${i}`, palId: 'SheepBall', passives: i % 2 ? [] : passiveIds.slice(i % 50, (i % 50) + 2), mode: i % 4 === 0 ? 'only' : 'include',
    targets: { hp: i % 2 ? 30 + (i >> 1) : 50, shot: 0, defense: 0 }, cake: 'none', order: 'next', addedAt: '', worlds: {},
  }));
  assert.equal(new Set(goals.map(goalKey)).size, goals.length);
  let start = performance.now();
  const marks = goalMarks(goals, owned.pals);
  const marking = performance.now() - start;
  let entries = 0;
  for (const list of marks.values()) entries += list.length;
  console.log(`目標の印（同じ種族の目標 100 件・同じ種族の 20,000 行）: ${marking.toFixed(2)} ms（印のある個体 ${marks.size}・印 ${entries} 個）`);
  assert.ok(entries > 100000, `印が少なすぎます（偏った分布になっていない）: ${entries}`);
  assert.ok(marking < 100, `同じ種族の目標の印が 100ms を超えました: ${marking.toFixed(2)} ms`);
  for (const [label, query] of [['1 回目の「完成品」', '完成品'], ['「目標1」', '目標1'], ['どこにも当たらない「ぬぬぬ」', 'ぬぬぬ']]) {
    start = performance.now();
    const found = filterOwned(owned.pals, { query, extraTexts: marks });
    const searching = performance.now() - start;
    console.log(`印の文字を含むキーワード${label}・同じ種族の 20,000 行: ${searching.toFixed(2)} ms（${found.length} 行）`);
    assert.ok(searching < 100, `印の文字のキーワード${label}が 100ms を超えました: ${searching.toFixed(2)} ms`);
  }
});

test('性能: 所持パルの行の部品（ownedRowItem）を 200 行作るのが 100ms 以内・2,000 行が 1 秒以内で、1 行の要素は 35 個以下（印のある行は 41 個以下。全部の行に印があっても 2,000 行で 80,000 以下）', async (t) => {
  const { installDom, descendants } = await import('../helpers/dom.js');
  installDom(t);
  const { ownedRowItem } = await import('../../web/js/views/owned.js');
  const owned = await biasedOwned(2000, 0x524f5753);
  // パッシブ 4 個・バッジなしの行（ふだんのいちばん要素の多い行）
  const four = owned.pals.find((pal) => pal.passives.length === 4 && !pal.nickname && !pal.egg && !pal.lucky && !pal.alpha && pal.known);
  const elements = descendants(ownedRowItem(four, {}).element).length;
  console.log(`1 行の要素（パッシブ 4 個・バッジなし）: ${elements} 個`);
  assert.ok(elements <= 35, `1 行の要素が 35 個を超えました: ${elements}`);
  let start = performance.now();
  const first = owned.pals.slice(0, 200).map((pal) => ownedRowItem(pal, {}));
  const firstMs = performance.now() - start;
  start = performance.now();
  const rest = owned.pals.slice(200).map((pal) => ownedRowItem(pal, {}));
  const allMs = firstMs + performance.now() - start;
  const total = [...first, ...rest].reduce((sum, row) => sum + descendants(row.element).length, 0);
  console.log(`行の部品の生成（テスト用の DOM）: 先頭 200 行 ${firstMs.toFixed(2)} ms・2,000 行 ${allMs.toFixed(2)} ms・要素 ${total} 個`);
  assert.ok(firstMs < 100, `200 行の生成が 100ms を超えました: ${firstMs.toFixed(2)} ms`);
  assert.ok(allMs < 1000, `2,000 行の生成が 1 秒を超えました: ${allMs.toFixed(2)} ms`);
  assert.ok(total <= 80000, `2,000 行の要素が 80,000 を超えました: ${total}`);
  // 全部の行に目標の印が 5 つ以上ある（行の下の段に 4 つと「+N」。D25）。いちばん要素の多い行は、パッシブ 4 個・パルボックスの位置（図と読み上げの文）・
  // 印の段（入れ物＋印 4＋「+N」＝6）で 41。2,000 行の画面全体（行のほかに約 1,000〜1,500。ブラウザの計測の記録）で 80,000 に収めるため、
  // 行だけで 78,000 以下を確かめる（この分布ではパッシブの数がばらけるので、実際は 41 × 2,000 より少ない）
  const marks = Array.from({ length: 6 }, (_, i) => `完成品: 目標${i + 1}`);
  const boxed = owned.pals.find((pal) => pal.passives.length === 4 && !pal.nickname && !pal.egg && !pal.lucky && !pal.alpha && pal.known && pal.box);
  const heaviest = descendants(ownedRowItem(boxed, { marks }).element).length;
  console.log(`1 行の要素（パッシブ 4 個・パルボックスの位置・印 6 個〔4 個と「+N」〕）: ${heaviest} 個`);
  assert.ok(heaviest <= 41, `印のある行の要素が 41 個を超えました: ${heaviest}`);
  const marked = owned.pals.map((pal) => ownedRowItem(pal, { marks }));
  const markedTotal = marked.reduce((sum, row) => sum + descendants(row.element).length, 0);
  console.log(`全部の行に印 6 個（2,000 行）の要素: ${markedTotal} 個`);
  assert.ok(markedTotal <= 78000, `印のある 2,000 行の要素が 78,000 を超えました: ${markedTotal}`);
});
