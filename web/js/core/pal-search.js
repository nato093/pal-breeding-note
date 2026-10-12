// パル選択の検索（DOM なし）。名前・英名・図鑑番号のほか、属性とパートナースキルでも探す。
// 配合の候補ではなくマスターの名前を引くだけなので、配合表・遺伝の仕組みは使わない（INV-2）。
import { ELEMENTS } from '../../data/pals.js';
import { PARTNER_SKILLS } from '../../data/skills.js';
import { normalizeQuery, queryTerms } from './kana.js';

// 一致の段階（小さいほど上に並べる）
export const TIERS = Object.freeze({ NUMBER: 0, NUMBER_PREFIX: 1, NAME_PREFIX: 2, NAME: 3, ELEMENT: 4, PARTNER: 5 });

// そろえた文字列を使い回す（パルは約 300 体なので、検索のたびにそろえ直さない）
const normalized = new Map();
const norm = (value) => {
  const key = String(value ?? '');
  let text = normalized.get(key);
  if (text === undefined) normalized.set(key, text = normalizeQuery(key));
  return text;
};

// 数字だけの語・数字で始まる語は、頭の 0 を外して番号と比べる（「030」→ 30 番）
const numberTerm = (term) => (/^\d/.test(term) ? term.replace(/^0+(?=\d)/, '') : term);

function termTier(pal, term, { partnerSkills, elements }) {
  const number = numberTerm(term);
  const labels = [norm(pal.no), norm(pal.label)];
  if (labels.includes(number)) return { tier: TIERS.NUMBER };
  if (labels[1].startsWith(number)) return { tier: TIERS.NUMBER_PREFIX };
  const names = [norm(pal.ja), norm(pal.en)];
  if (names.some((name) => name.startsWith(term))) return { tier: TIERS.NAME_PREFIX };
  if (names.some((name) => name.includes(term)) || norm(pal.id) === term) return { tier: TIERS.NAME };
  // 属性は語が属性の名前に完全に一致したときだけ（「闇」「闇属性」「Dark」）
  if ((pal.el ?? []).some((key) => elements[key] && [norm(elements[key]), norm(`${elements[key]}属性`), norm(key)].includes(term))) {
    return { tier: TIERS.ELEMENT };
  }
  // パートナースキルは 2 文字以上の語がスキルの名前に含まれるときだけ
  const skill = partnerSkills[pal.id];
  if (skill && term.length >= 2 && norm(skill).includes(term)) return { tier: TIERS.PARTNER, note: `パートナースキル: ${skill}` };
  return null;
}

const byDex = (a, b) => a.pal.no - b.pal.no || Number(a.pal.variant) - Number(b.pal.variant);

/**
 * 語（空白区切り。所持パルのキーワードと同じ）をすべて含むパルを、一致の段階と図鑑順で並べる。
 * パルの段階は語ごとの段階の最大。note は名前以外（パートナースキル）で一致したときの添え書き。語が無ければ全部を図鑑順で返す。
 * @returns {{ pal: object, tier: number, note: string }[]}
 */
export function searchPals(pals, query, { partnerSkills = PARTNER_SKILLS, elements = ELEMENTS } = {}) {
  const terms = queryTerms(query);
  const results = [];
  for (const pal of pals) {
    let tier = 0;
    let note = '';
    let matched = true;
    for (const term of terms) {
      const hit = termTier(pal, term, { partnerSkills, elements });
      if (!hit) { matched = false; break; }
      tier = Math.max(tier, hit.tier);
      if (hit.note && !note) note = hit.note;
    }
    if (matched) results.push({ pal, tier, note });
  }
  return results.sort((a, b) => a.tier - b.tier || byDex(a, b));
}
