const japaneseNames = new Intl.Collator('ja');

function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * パル ID どうしの比べ方。sort が '…-name' なら和名の五十音順（日本語の照合）、ほかは図鑑順（palOrder の小さい順。無いパルは後ろ）。
 * 同じ順位のときは 0（呼び出し側が次の項目で比べる）
 */
export function palComparator(sort, palOrder = new Map(), palsById = new Map()) {
  return sort.endsWith('name')
    ? (a, b) => japaneseNames.compare(palsById.get(a)?.ja ?? '', palsById.get(b)?.ja ?? '')
    : (a, b) => (palOrder.get(a) ?? Infinity) - (palOrder.get(b) ?? Infinity);
}

export function recordComparator(sort, palOrder, palsById) {
  if (sort === 'updated') {
    return (a, b) => compareId(b.updatedAt, a.updatedAt) || compareId(a.id, b.id);
  }
  const fields = sort.startsWith('parent') ? ['parent1Id', 'parent2Id', 'childId'] : ['childId', 'parent1Id', 'parent2Id'];
  const comparePal = palComparator(sort, palOrder, palsById);
  return (a, b) => {
    for (const field of fields) {
      const difference = comparePal(a[field], b[field]);
      if (difference) return difference;
    }
    return compareId(a.id, b.id);
  };
}
