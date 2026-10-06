// 配合表（web/data/breeding.js）を引く。INV-2 の例外として、自動登録の照合にだけ使う。
// 画面での表示や検索には使わない。
const NO_CHILD = 0xffff;

function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * @param {{ ids: string[], pairs: string, genderRules: { p1: string, g1: string, p2: string, g2: string, child: string }[] }} data
 */
export function decodeBreeding(data) {
  const ids = Array.isArray(data?.ids) ? data.ids : [];
  const n = ids.length;
  const bytes = decodeBase64(String(data?.pairs ?? ''));
  if (bytes.length !== n * (n + 1)) throw new Error('配合表の大きさが合いません');
  const view = new DataView(bytes.buffer);
  const pairs = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < pairs.length; i++) {
    const v = view.getUint16(i * 2, true);
    if (v !== NO_CHILD && v >= n) throw new Error('配合表に範囲外の子があります');
    pairs[i] = v;
  }
  const index = new Map(ids.map((id, i) => [id, i]));
  const genderRules = (Array.isArray(data?.genderRules) ? data.genderRules : [])
    .filter((r) => index.has(r.p1) && index.has(r.p2) && index.has(r.child));
  return { ids, index, n, pairs, genderRules };
}

const genderFits = (gender, rule) => !rule || gender === rule;

/** 親 a・b（性別は 'M' / 'F' / ''）から生まれる子の ID。分からなければ ''。 */
export function breedChild(table, a, aGender, b, bGender) {
  const i = table.index.get(a);
  const j = table.index.get(b);
  if (i === undefined || j === undefined) return '';
  if (a === b) return a;
  for (const r of table.genderRules) {
    if (r.p1 === a && r.p2 === b && genderFits(aGender, r.g1) && genderFits(bGender, r.g2)) return r.child;
    if (r.p1 === b && r.p2 === a && genderFits(bGender, r.g1) && genderFits(aGender, r.g2)) return r.child;
  }
  const [x, y] = i <= j ? [i, j] : [j, i];
  const child = table.pairs[x * table.n - (x * (x - 1)) / 2 + (y - x)];
  return child === NO_CHILD ? '' : table.ids[child];
}

/** 親の性別で子が変わる組み合わせか */
export function isGenderDependent(table, a, b) {
  return table.genderRules.some((r) => (r.p1 === a && r.p2 === b) || (r.p1 === b && r.p2 === a));
}
