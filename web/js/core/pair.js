export function pairKey(a, b) {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

export function normalizeRecord(rec) {
  if (rec.parent1Id <= rec.parent2Id) return { ...rec };
  return {
    ...rec,
    parent1Id: rec.parent2Id,
    parent2Id: rec.parent1Id,
    parent1Gender: rec.parent2Gender,
    parent2Gender: rec.parent1Gender,
  };
}

export function identityKey(rec) {
  return `${pairKey(rec.parent1Id, rec.parent2Id)}>${rec.childId}`;
}
