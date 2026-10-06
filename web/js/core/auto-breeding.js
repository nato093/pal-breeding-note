// 配合牧場（セーブの snapshot.breedFarms）とタマゴから、自動登録する配合を見つける。DOM には触れない。
// タマゴには親の情報がなく、牧場には親を入れ替える前に産んだタマゴが拾うまで残る（実セーブで確認）。
// そこで、前に読んだときになかった「新しく現れたタマゴ」だけを見る。
// - 牧場の上: 前に読んだときと親が同じ牧場のタマゴを、その親の配合とみなす（突然変異タマゴも、表の子で登録する）
// - 牧場の外（孵化器・所持品など。産まれてすぐ拾われたもの）: 中身が、牧場の親（いま、または前に読んだときの）から
//   配合表で求めた子と一致すれば、その組み合わせの配合とみなす。同じ子になる組み合わせが複数あれば、どれも候補にする
// 子は配合表で決める。タマゴの中身は、表と合うかの確かめにだけ使う。
import { breedChild } from './breeding.js';
import { identityKey, normalizeRecord } from './pair.js';
import { userIdKey } from './user.js';

const GENDER = { Male: 'M', Female: 'F' };
// 覚えておく「見たことのあるタマゴ」の数。孵化したり、読めないファイルに移ったりして見えなくなっても、しばらくは忘れない
const SEEN_EGGS_MAX = 2000;
// 前に読んだときの親の組として使えるか（♂♀がそろっている）
const validPair = (pair) => Boolean(pair?.a?.palId && pair?.b?.palId && pair.a.gender && pair.b.gender && pair.a.gender !== pair.b.gender);
// 突然変異タマゴ（親と関係ない子が入る）。親の組み合わせで産んだことには変わりないので、表の子で登録する
export const isMutationEgg = (egg) => /^PalEgg_MutationPal/i.test(egg.itemId ?? '');

// 牧場の親 2 体（♂♀がそろい、種族が分かるとき）。だめなら null
function pairOf(farm, resolveSpecies) {
  if (farm.status !== 'ok' || farm.parents.length !== 2) return null;
  const [a, b] = farm.parents.map((p) => ({ palId: resolveSpecies(p.characterId).palId, gender: GENDER[p.gender] ?? '', depositorUid: p.depositorUid ?? '' }));
  if (!a.palId || !b.palId || !a.gender || !b.gender || a.gender === b.gender) return null;
  return { a, b };
}

/**
 * @param {object} snapshot buildSnapshot の結果（breedFarms がない古いものは空として扱う）
 * @param {{ resolveSpecies: (characterId: string) => { palId: string }, table: object,
 *   history: { farms: Record<string, { parents: string, eggs: string[], pair?: object }>, eggs: string[] | null } | null }} deps
 *   history は前に読んだときの記録（牧場ごとの親とタマゴ、見たことのあるタマゴ）。null なら初めて読むので、記録するだけ
 * @returns {{ candidates: object[], anomalies: object[], history: object }}
 *   anomalies: 牧場の上の新しいふつうのタマゴなのに表と合わないもの（ゲームの更新に表が追いついていないなど）
 */
export function findNewBreedings(snapshot, { resolveSpecies, table, history }) {
  const byKey = new Map();
  const anomalies = [];
  const farms = {};
  const add = (pair, childId, evidence) => {
    const { a, b } = pair;
    const record = normalizeRecord({ parent1Id: a.palId, parent1Gender: a.gender, parent2Id: b.palId, parent2Gender: b.gender, childId });
    const key = identityKey(record);
    if (!byKey.has(key)) byKey.set(key, { key, record, evidence: [] });
    byKey.get(key).evidence.push({ ...evidence, depositorUids: [a.depositorUid, b.depositorUid] });
  };

  // ---- 牧場の上のタマゴ ----
  const pairs = []; // 牧場の外のタマゴの照合に使う親の組（いまと、前に読んだとき）
  const farmEggIds = new Set();
  for (const farm of snapshot?.breedFarms ?? []) {
    // 親の個体（並びは問わない）。読めない牧場は空にして、次に読んだときの比べ先にもしない
    const parentsKey = farm.status === 'ok' ? farm.parents.map((p) => p.instanceId).sort().join('|') : '';
    const pair = pairOf(farm, resolveSpecies);
    farms[farm.id] = { parents: parentsKey, eggs: farm.eggs.map((e) => e.localId), ...(pair ? { pair } : {}) };
    for (const egg of farm.eggs) farmEggIds.add(egg.localId);
    if (pair) pairs.push({ farmId: farm.id, pair });
    const before = history?.farms?.[farm.id];
    if (validPair(before?.pair) && before.parents !== parentsKey) pairs.push({ farmId: farm.id, pair: before.pair });
    if (!before || !pair || before.parents !== parentsKey) continue;
    const seen = new Set(before.eggs);
    const fresh = farm.eggs.filter((e) => !seen.has(e.localId));
    if (!fresh.length) continue;
    const expected = breedChild(table, pair.a.palId, pair.a.gender, pair.b.palId, pair.b.gender);
    for (const egg of fresh) {
      const actual = resolveSpecies(egg.characterId).palId;
      const evidence = { farmId: farm.id, eggLocalId: egg.localId };
      if (!expected || (actual !== expected && !isMutationEgg(egg))) {
        anomalies.push({ ...evidence, depositorUids: [pair.a.depositorUid, pair.b.depositorUid], parents: [pair.a.palId, pair.b.palId], expected, actual: actual || egg.characterId });
        continue;
      }
      add(pair, expected, evidence);
    }
  }

  // 拾った直後に撤去した牧場の、前に読んだときの親も照合に使う
  for (const [farmId, before] of Object.entries(history?.farms ?? {})) {
    if (!(farmId in farms) && validPair(before?.pair)) pairs.push({ farmId, pair: before.pair });
  }

  // ---- 牧場の外のタマゴ（産まれてすぐ拾われ、牧場の上では見えなかったもの） ----
  const eggs = (snapshot?.pals ?? []).filter((p) => p.source === 'egg');
  const seenEggs = history?.eggs ? new Set(history.eggs) : null;
  for (const farm of Object.values(history?.farms ?? {})) for (const id of farm.eggs ?? []) seenEggs?.add(id);
  if (seenEggs) {
    for (const egg of eggs) {
      if (seenEggs.has(egg.instanceId) || farmEggIds.has(egg.instanceId)) continue;
      // 突然変異タマゴは中身から親を決められないので、牧場の外では使わない
      if (isMutationEgg({ itemId: egg.location?.itemId })) continue;
      const actual = resolveSpecies(egg.characterId).palId;
      if (!actual) continue;
      for (const { farmId, pair } of pairs) {
        if (breedChild(table, pair.a.palId, pair.a.gender, pair.b.palId, pair.b.gender) === actual) add(pair, actual, { farmId, eggLocalId: egg.instanceId });
      }
    }
  }
  // 見たことのあるタマゴは、前に見たものも残す（一度見えなくなってから別の場所に現れても、新しいタマゴと数えない）
  const seen = [...new Set([...(history?.eggs ?? []), ...eggs.map((e) => e.instanceId), ...farmEggIds])].slice(-SEEN_EGGS_MAX);
  return { candidates: [...byKey.values()], anomalies, history: { farms, eggs: seen } };
}

/**
 * セーブのプレイヤーに対応するアプリのユーザー。手で選んだものを優先し、なければ同じ名前のユーザー。
 * @returns {string} 見つからなければ ''
 */
export function mappedUser(player, { mapping = {}, users = [] }) {
  const exists = (userId) => users.find((u) => userIdKey(u) === userIdKey(userId));
  const chosen = mapping[player.uid];
  if (chosen) return exists(chosen) ?? '';
  return player.name ? exists(player.name) ?? '' : '';
}

/**
 * 誰の登録にするか。親 2 体を同じ人が拠点に預けていればその人に対応するユーザー、
 * 預けた人が違う・分からない（牧場ごとに食い違う場合も）ならログイン中のユーザー。
 * @returns {{ userId: string } | { unmapped: string }}
 */
export function resolveRegistrant(candidate, { players = [], mapping = {}, users = [], currentUserId }) {
  const owners = new Set(candidate.evidence.map(({ depositorUids: [x, y] }) => (x && x === y ? x : '')));
  const [owner] = owners;
  if (owners.size !== 1 || !owner) return { userId: currentUserId };
  const player = players.find((p) => p.uid === owner) ?? { uid: owner, name: '' };
  const userId = mappedUser(player, { mapping, users });
  return userId ? { userId } : { unmapped: owner };
}
