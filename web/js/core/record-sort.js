const japaneseNames = new Intl.Collator('ja');

function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 親1・親2は保存時に ID 順で決まるため、どちらの親の位置からも引けるよう 1 件を親ごとの行に展開する。
// 行の parent1Id が左に表示する親で、record は元の配合（同じ親同士は 1 行）。
export function parentRows(records) {
  return records.flatMap((record) => record.parent1Id === record.parent2Id ? [{ ...record, record }] : [
    { ...record, record },
    { ...record, parent1Id: record.parent2Id, parent2Id: record.parent1Id, record },
  ]);
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
