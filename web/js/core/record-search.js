// 配合を探す（views/search.js）の検索の中身。登録済みの記録だけを引く（INV-2。配合表・遺伝の仕組みは使わない）。
import { findByChild, findByPair, findByParent } from './index.js';
import { normalizeQuery } from './kana.js';
import { userIdKey } from './user.js';
import { palComparator, recordComparator } from './record-sort.js';

/** 並べ替え [値, 名前]。先頭が既定（更新日の新しい順。D6） */
export const RECORD_SORTS = Object.freeze([
  ['updated', '更新日の新しい順'], ['parent-dex', '親の図鑑番号順'], ['parent-name', '親の五十音順'],
  ['child-dex', '子の図鑑番号順'], ['child-name', '子の五十音順'],
].map((sort) => Object.freeze(sort)));
export const RECORD_SORT_DEFAULT = 'updated';

/** 並べ替えの値として使えるものだけを返す（知らない値は既定） */
export const recordSort = (value) => (RECORD_SORTS.some(([key]) => key === value) ? value : RECORD_SORT_DEFAULT);

function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// キーワードで探す文字列。パルは和名・英名・ID・図鑑番号、記録は 3 体のパル・登録者・メモ（どれも normalizeQuery でそろえる）。
// 項目の間は改行でつなぐ（語は空白で区切られているので、項目をまたいで一致しない）。記録は変更のたびに新しいオブジェクトになるので、
// WeakMap に覚えた古い値は自然に捨てられる
const palTexts = new WeakMap();
const recordTexts = new WeakMap();
function palText(pal) {
  if (!pal) return '';
  let value = palTexts.get(pal);
  if (value === undefined) palTexts.set(pal, value = [pal.ja, pal.en, pal.id, pal.label, pal.no].map(normalizeQuery).filter(Boolean).join('\n'));
  return value;
}
function recordText(record, palsById) {
  let value = recordTexts.get(record);
  if (value === undefined) {
    value = [record.parent1Id, record.parent2Id, record.childId].map((id) => palText(palsById.get(id)))
      .concat(normalizeQuery(record.registrant), normalizeQuery(record.memo)).join('\n');
    recordTexts.set(record, value);
  }
  return value;
}

/**
 * 登録者の条件を除いた検索（親・子・キーワード）。親 2 体 → その組、親 1 体 → その親を使う配合、子だけ → その子の配合、何もなし → records。
 * 親と子の両方があれば、親の結果を子で絞る（積集合）。terms（core/kana.js の queryTerms で分けた語）はすべて含むもの（AND）
 */
export function searchBase(index, records, { p1 = '', p2 = '', c = '', terms = [] } = {}, palsById = new Map()) {
  let list = p1 && p2 ? findByPair(index, p1, p2) : p1 || p2 ? findByParent(index, p1 || p2) : c ? findByChild(index, c) : records;
  if (c && (p1 || p2)) list = list.filter((record) => record.childId === c);
  if (terms.length) list = list.filter((record) => {
    const text = recordText(record, palsById);
    return terms.every((term) => text.includes(term));
  });
  return list;
}

/** 登録者の条件。by（ID。大小・全角半角はそろえて比べる）か、noRegistrant（登録者が空の記録） */
export function byRegistrant(records, { by = '', noRegistrant = false } = {}) {
  if (by) {
    const key = userIdKey(by);
    return records.filter((record) => userIdKey(record.registrant ?? '') === key);
  }
  return noRegistrant ? records.filter((record) => !record.registrant) : records;
}

/** 親・子・登録者・キーワードの条件で、登録済みの記録を引く */
export function searchRecords(index, records, filter = {}, palsById = new Map()) {
  return byRegistrant(searchBase(index, records, filter, palsById), filter);
}

/**
 * 登録者の選択肢 [{ value, label, count, kind }]（count は records の中の件数）。並びは すべて（kind 'all'・value ''）→ 自分（'self'。
 * me があれば 0 件でも出す）→ ほかの登録者（'user'。件数の多い順・同数は五十音）→ 登録者未指定（'none'。空の記録があるときだけ）。
 * 名前は users（今の ID の一覧）に同じ ID（大小・全角半角をそろえて）があればその書き方、なければ記録の中でいちばん多い書き方
 *（名前の変更の前の古い名前など、記録にしか出てこない名前も出す）
 */
export function registrantCounts(records, { users = [], me = '' } = {}) {
  const canonical = new Map(users.filter((user) => typeof user === 'string' && user).map((user) => [userIdKey(user), user]));
  const groups = new Map();
  let none = 0;
  for (const record of records) {
    const name = record.registrant ?? '';
    if (!name) { none += 1; continue; }
    const key = userIdKey(name);
    let group = groups.get(key);
    if (!group) groups.set(key, group = { count: 0, names: new Map() });
    group.count += 1;
    group.names.set(name, (group.names.get(name) ?? 0) + 1);
  }
  const nameOf = (key, group) => canonical.get(key)
    ?? [...group.names].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  const meKey = me ? userIdKey(me) : '';
  const others = [...groups].filter(([key]) => key !== meKey).map(([key, group]) => ({ value: nameOf(key, group), count: group.count }));
  const collator = new Intl.Collator('ja');
  others.sort((a, b) => b.count - a.count || collator.compare(a.value, b.value));
  return [
    { value: '', label: 'すべて', count: records.length, kind: 'all' },
    ...(me ? [{ value: me, label: `${me}（自分）`, count: groups.get(meKey)?.count ?? 0, kind: 'self' }] : []),
    ...others.map(({ value, count }) => ({ value, label: value, count, kind: 'user' })),
    ...(none ? [{ value: '', label: '登録者未指定', count: none, kind: 'none' }] : []),
  ];
}

/**
 * 並べ替えて見出しの単位に分ける → [{ key, palId, records }]。
 * - updated（既定）: 見出しなしの 1 群（palId ''）。更新日の新しい順
 * - parent-*: 1 件 1 回。2 体の親のうち並び順で先に来る親の群に入れる（同じ親どうしは 1 群）。群の中は相手の親 → 子 → 記録 ID の順
 * - child-*: 子の群。群の中は親の組（並び順で先の親 → もう一方）→ 記録 ID の順
 * 群は palId の並び順（図鑑順か五十音順。同じ順位は図鑑順 → ID）。
 * focusParent（親を 1 体だけ選んでいるとき）があれば、parent-* ではその親を含む記録をすべてその親の群に入れる（「相手 → 子」で並べる）
 */
export function groupRecords(records, sort = RECORD_SORT_DEFAULT, palOrder = new Map(), palsById = new Map(), { focusParent = '' } = {}) {
  const key = recordSort(sort);
  if (key === 'updated') return [{ key: 'all', palId: '', records: [...records].sort(recordComparator('updated')) }];
  const comparePal = palComparator(key, palOrder, palsById);
  const order = (a, b) => comparePal(a, b) || (palOrder.get(a) ?? Infinity) - (palOrder.get(b) ?? Infinity) || compareId(a, b);
  const byParent = key.startsWith('parent');
  const first = (record) => (order(record.parent1Id, record.parent2Id) <= 0 ? record.parent1Id : record.parent2Id);
  const groupOf = (record) => (focusParent && (record.parent1Id === focusParent || record.parent2Id === focusParent) ? focusParent : first(record));
  const partner = (record, palId) => (record.parent1Id === palId ? record.parent2Id : record.parent1Id);
  const groups = new Map();
  for (const record of records) {
    const palId = byParent ? groupOf(record) : record.childId;
    if (!groups.has(palId)) groups.set(palId, []);
    groups.get(palId).push(record);
  }
  const inside = byParent
    ? (palId) => (a, b) => order(partner(a, palId), partner(b, palId)) || order(a.childId, b.childId) || compareId(a.id, b.id)
    : () => (a, b) => {
      const [a1, b1] = [first(a), first(b)];
      return order(a1, b1) || order(partner(a, a1), partner(b, b1)) || compareId(a.id, b.id);
    };
  return [...groups].sort(([a], [b]) => order(a, b)).map(([palId, list]) => ({ key: palId, palId, records: list.sort(inside(palId)) }));
}

/**
 * 子ごとの件数 [{ childId, count }]（件数の多い順・同数は並び順）。親を 1 体だけ選んだときの要約のチップに使う
 */
export function childCounts(records, palOrder = new Map()) {
  const counts = new Map();
  for (const record of records) counts.set(record.childId, (counts.get(record.childId) ?? 0) + 1);
  return [...counts].map(([childId, count]) => ({ childId, count }))
    .sort((a, b) => b.count - a.count || (palOrder.get(a.childId) ?? Infinity) - (palOrder.get(b.childId) ?? Infinity) || compareId(a.childId, b.childId));
}

/**
 * 件数の行の添え書き: 同じ組で 2 件以上の結果があれば 'multi'。そのうち、すべての記録に親の性別が入っていて、同じ組の中で子ごとに
 * 性別の向きが違うなら 'gender'（親の性別で子が変わる）。どちらでもなければ ''
 */
export function pairNote(records) {
  const pairs = new Map();
  for (const record of records) {
    const key = [record.parent1Id, record.parent2Id].sort().join('+');
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(record);
  }
  const multi = [...pairs.values()].filter((list) => new Set(list.map((record) => record.childId)).size > 1);
  if (!multi.length) return '';
  // 親の性別の向き（ID の小さい親の性別）。同じ親どうしは向きがないので数えない
  const direction = (record) => {
    if (record.parent1Id === record.parent2Id) return '';
    return record.parent1Id < record.parent2Id ? record.parent1Gender : record.parent2Gender;
  };
  const gendered = multi.every((list) => list.every((record) => direction(record)));
  if (gendered && multi.every((list) => {
    const byChild = new Map();
    for (const record of list) {
      if (!byChild.has(record.childId)) byChild.set(record.childId, new Set());
      byChild.get(record.childId).add(direction(record));
    }
    const sets = [...byChild.values()];
    // 子ごとに向きが 1 つに決まり、子どうしで向きが重ならない
    return sets.every((set) => set.size === 1) && new Set(sets.map((set) => [...set][0])).size === sets.length;
  })) return 'gender';
  return 'multi';
}
