import { pairKey } from './pair.js';

function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function append(map, key, record) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(record);
}

export function buildIndex(records, pals) {
  const sortedPals = [...pals].sort((a, b) => a.no - b.no
    || Number(a.variant) - Number(b.variant) || compareId(a.id, b.id));
  const palOrder = new Map(sortedPals.map((pal, rank) => [pal.id, rank]));
  const comparePal = (a, b) => (palOrder.get(a) ?? Infinity) - (palOrder.get(b) ?? Infinity)
    || compareId(a, b);
  const orderedRecords = [...records].sort((a, b) => compareId(a.id, b.id));
  const byPair = new Map();
  const byChild = new Map();
  const byParent = new Map();
  for (const record of orderedRecords) {
    append(byPair, pairKey(record.parent1Id, record.parent2Id), record);
    append(byChild, record.childId, record);
    append(byParent, record.parent1Id, record);
    if (record.parent1Id !== record.parent2Id) append(byParent, record.parent2Id, record);
  }
  for (const [parent, list] of byParent) {
    const partner = (record) => record.parent1Id === parent ? record.parent2Id : record.parent1Id;
    list.sort((a, b) => comparePal(partner(a), partner(b)) || compareId(a.id, b.id));
  }
  // 逆引きには起点の親がないため、図鑑順で小さい親、もう一方の親、レコード ID の順にする。
  const parents = (record) => [record.parent1Id, record.parent2Id].sort(comparePal);
  for (const list of byChild.values()) {
    list.sort((a, b) => {
      const ap = parents(a);
      const bp = parents(b);
      return comparePal(ap[0], bp[0]) || comparePal(ap[1], bp[1]) || compareId(a.id, b.id);
    });
  }
  return { records: orderedRecords, byPair, byChild, byParent, palOrder };
}

export function findByPair(index, a, b) {
  return index.byPair.get(pairKey(a, b)) ?? [];
}

export function findByChild(index, c) {
  return index.byChild.get(c) ?? [];
}

export function findByParent(index, p) {
  return index.byParent.get(p) ?? [];
}
