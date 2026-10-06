// 配合牧場（セーブの snapshot.breedFarms）から、自動登録する配合を見つける。DOM には触れない。
// 親 2 体から配合表で求めた子と、牧場が産んだタマゴの中身が一致したものだけを候補にする。
import { breedChild } from './breeding.js';
import { identityKey, normalizeRecord } from './pair.js';
import { userIdKey } from './user.js';

const GENDER = { Male: 'M', Female: 'F' };

/**
 * @param {object} snapshot buildSnapshot の結果（breedFarms がない古いものは空として扱う）
 * @param {{ resolveSpecies: (characterId: string) => { palId: string }, table: object }} deps
 * @returns {{ candidates: object[], mismatches: object[] }}
 */
export function findFarmBreedings(snapshot, { resolveSpecies, table }) {
  const byKey = new Map();
  const mismatches = [];
  for (const farm of snapshot?.breedFarms ?? []) {
    if (farm.status !== 'ok' || farm.parents.length !== 2 || !farm.eggs.length) continue;
    const parents = farm.parents.map((p) => ({ palId: resolveSpecies(p.characterId).palId, gender: GENDER[p.gender] ?? '', depositorUid: p.depositorUid ?? '' }));
    if (parents.some((p) => !p.palId || !p.gender) || parents[0].gender === parents[1].gender) continue;
    const [a, b] = parents;
    const expected = breedChild(table, a.palId, a.gender, b.palId, b.gender);
    for (const egg of farm.eggs) {
      const actual = resolveSpecies(egg.characterId).palId;
      const evidence = { farmId: farm.id, eggLocalId: egg.localId, depositorUids: [a.depositorUid, b.depositorUid] };
      if (!expected || actual !== expected) {
        mismatches.push({ ...evidence, parents: [a.palId, b.palId], expected, actual: actual || egg.characterId });
        continue;
      }
      const record = normalizeRecord({ parent1Id: a.palId, parent1Gender: a.gender, parent2Id: b.palId, parent2Gender: b.gender, childId: expected });
      const key = identityKey(record);
      if (!byKey.has(key)) byKey.set(key, { key, record, evidence: [] });
      byKey.get(key).evidence.push(evidence);
    }
  }
  return { candidates: [...byKey.values()], mismatches };
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
