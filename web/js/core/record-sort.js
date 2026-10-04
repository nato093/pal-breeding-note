const japaneseNames = new Intl.Collator('ja');

function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function recordComparator(sort, palOrder, palsById) {
  if (sort === 'updated') {
    return (a, b) => compareId(b.updatedAt, a.updatedAt) || compareId(a.id, b.id);
  }
  const fields = sort.startsWith('parent') ? ['parent1Id', 'parent2Id', 'childId'] : ['childId', 'parent1Id', 'parent2Id'];
  const comparePal = sort.endsWith('name')
    ? (a, b) => japaneseNames.compare(palsById.get(a)?.ja ?? '', palsById.get(b)?.ja ?? '')
    : (a, b) => (palOrder.get(a) ?? Infinity) - (palOrder.get(b) ?? Infinity);
  return (a, b) => {
    for (const field of fields) {
      const difference = comparePal(a[field], b[field]);
      if (difference) return difference;
    }
    return compareId(a.id, b.id);
  };
}
