// 配合牧場（セーブの snapshot.breedFarms）から、自動登録する配合を見つける。DOM には触れない。
// 牧場には、親を入れ替える前に産んだタマゴが拾うまで残るため（実セーブで確認）、タマゴから親は決められない。
// そこで、前に読んだときと親が同じ牧場に「新しく現れたタマゴ」だけを、いまの親が産んだものとみなす。
// 子は配合表で決める。タマゴの中身は、表と合うかの確かめにだけ使う。
import { breedChild } from './breeding.js';
import { identityKey, normalizeRecord } from './pair.js';
import { userIdKey } from './user.js';

const GENDER = { Male: 'M', Female: 'F' };
// 突然変異タマゴ（親と関係ない子が入る）。親の組み合わせで産んだことには変わりないので、表の子で登録する
export const isMutationEgg = (egg) => /^PalEgg_MutationPal/i.test(egg.itemId ?? '');

/**
 * @param {object} snapshot buildSnapshot の結果（breedFarms がない古いものは空として扱う）
 * @param {{ resolveSpecies: (characterId: string) => { palId: string }, table: object,
 *   history: Record<string, { parents: string, eggs: string[] }> | null }} deps
 *   history は前に読んだときの牧場ごとの親とタマゴ。null なら初めて読むので、記録するだけで候補は出さない
 * @returns {{ candidates: object[], anomalies: object[], history: object }}
 *   anomalies: 新しいふつうのタマゴなのに表と合わないもの（ゲームの更新に表が追いついていないなど）
 */
export function findNewBreedings(snapshot, { resolveSpecies, table, history }) {
  const byKey = new Map();
  const anomalies = [];
  const next = {};
  for (const farm of snapshot?.breedFarms ?? []) {
    // 親の個体（並びは問わない）。読めない牧場は空にして、次に読んだときの比べ先にもしない
    const parentsKey = farm.status === 'ok' ? farm.parents.map((p) => p.instanceId).sort().join('|') : '';
    next[farm.id] = { parents: parentsKey, eggs: farm.eggs.map((e) => e.localId) };
    const before = history?.[farm.id];
    if (!before || !parentsKey || before.parents !== parentsKey || farm.parents.length !== 2) continue;
    const seen = new Set(before.eggs);
    const fresh = farm.eggs.filter((e) => !seen.has(e.localId));
    if (!fresh.length) continue;
    const parents = farm.parents.map((p) => ({ palId: resolveSpecies(p.characterId).palId, gender: GENDER[p.gender] ?? '', depositorUid: p.depositorUid ?? '' }));
    if (parents.some((p) => !p.palId || !p.gender) || parents[0].gender === parents[1].gender) continue;
    const [a, b] = parents;
    const expected = breedChild(table, a.palId, a.gender, b.palId, b.gender);
    for (const egg of fresh) {
      const actual = resolveSpecies(egg.characterId).palId;
      const evidence = { farmId: farm.id, eggLocalId: egg.localId, depositorUids: [a.depositorUid, b.depositorUid] };
      if (!expected || (actual !== expected && !isMutationEgg(egg))) {
        anomalies.push({ ...evidence, parents: [a.palId, b.palId], expected, actual: actual || egg.characterId });
        continue;
      }
      const record = normalizeRecord({ parent1Id: a.palId, parent1Gender: a.gender, parent2Id: b.palId, parent2Gender: b.gender, childId: expected });
      const key = identityKey(record);
      if (!byKey.has(key)) byKey.set(key, { key, record, evidence: [] });
      byKey.get(key).evidence.push(evidence);
    }
  }
  return { candidates: [...byKey.values()], anomalies, history: next };
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
