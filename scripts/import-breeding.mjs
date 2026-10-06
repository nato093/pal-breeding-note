// 配合表を生成する（web/data/breeding.js）。
// INV-2 の例外: 配合牧場からの自動登録で「タマゴの中身が親の組み合わせどおりか」を照合するためだけに使う。
// 画面での表示や検索には使わない（web/js/core/breeding.js 以外から読まない）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALCALC, BREEDING_SOURCE_URL } from './sources.mjs';
import pals from '../web/data/pals.js';

export const NO_CHILD = 0xffff;
const GENDERS = { WILDCARD: '', MALE: 'M', FEMALE: 'F' };

// 上三角（i <= j）の並びでの位置
export const pairIndex = (n, i, j) => (i <= j ? i * n - (i * (i - 1)) / 2 + (j - i) : pairIndex(n, j, i));

export function buildBreeding({ rows, ids }) {
  const n = ids.length;
  if (n >= NO_CHILD) throw new Error(`パルが多すぎます: ${n}`);
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const pairs = new Uint16Array((n * (n + 1)) / 2).fill(NO_CHILD);
  const genderRules = [];
  const ruleKeys = new Map();
  const dropped = new Set();
  for (const row of rows) {
    const p1 = indexOf.get(row.Parent1InternalName);
    const p2 = indexOf.get(row.Parent2InternalName);
    const child = indexOf.get(row.ChildInternalName);
    if (p1 === undefined || p2 === undefined || child === undefined) {
      for (const id of [row.Parent1InternalName, row.Parent2InternalName, row.ChildInternalName]) if (!indexOf.has(id)) dropped.add(id);
      continue;
    }
    const g1 = GENDERS[row.Parent1Gender];
    const g2 = GENDERS[row.Parent2Gender];
    if (g1 === undefined || g2 === undefined) throw new Error(`未知の性別: ${row.Parent1Gender} / ${row.Parent2Gender}`);
    if (g1 || g2) {
      // 親の並びをそろえて、同じ条件の食い違いを見つける
      const [a, b] = p1 <= p2 ? [[p1, g1], [p2, g2]] : [[p2, g2], [p1, g1]];
      const key = `${a[0]}${a[1]}|${b[0]}${b[1]}`;
      if (ruleKeys.has(key)) {
        if (ruleKeys.get(key) !== child) throw new Error(`同じ組み合わせで子が食い違います: ${row.Parent1InternalName} × ${row.Parent2InternalName}`);
        continue;
      }
      ruleKeys.set(key, child);
      genderRules.push({ p1: ids[a[0]], g1: a[1], p2: ids[b[0]], g2: b[1], child: ids[child] });
      continue;
    }
    const at = pairIndex(n, p1, p2);
    if (pairs[at] !== NO_CHILD && pairs[at] !== child) {
      throw new Error(`同じ組み合わせで子が食い違います: ${row.Parent1InternalName} × ${row.Parent2InternalName}`);
    }
    pairs[at] = child;
  }
  return { ids, pairs, genderRules, dropped: [...dropped].sort() };
}

export function encodePairs(pairs) {
  const bytes = new Uint8Array(pairs.length * 2);
  const view = new DataView(bytes.buffer);
  pairs.forEach((v, i) => view.setUint16(i * 2, v, true));
  return Buffer.from(bytes).toString('base64');
}

export function renderBreeding({ ids, pairs, genderRules }, source) {
  const data = { source, ids, pairs: encodePairs(pairs), genderRules };
  return '// 自動生成（scripts/import-breeding.mjs）。手で編集しない。\n'
    + '// 自動登録の照合にだけ使う（INV-2 の例外）。画面での表示や検索には使わない。\n'
    + `export default ${JSON.stringify(data)};\n`;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log(`取得元: ${BREEDING_SOURCE_URL}`);
  const res = await fetch(BREEDING_SOURCE_URL, { headers: { 'User-Agent': 'pal-breeding-note' } });
  if (!res.ok) throw new Error(`取得失敗 ${res.status}: ${BREEDING_SOURCE_URL}`);
  const { Breeding: rows } = await res.json();
  const built = buildBreeding({ rows, ids: pals.map((p) => p.id) });
  const text = renderBreeding(built, `${PALCALC.repo}@${PALCALC.sha}`);
  fs.writeFileSync(path.join(root, 'web/data/breeding.js'), text);
  const filled = built.pairs.filter((v) => v !== NO_CHILD).length;
  console.log(`書き出し: web/data/breeding.js（${Math.round(text.length / 1024)} KB）`);
  console.log(`行 ${rows.length} / 組 ${filled} / ${built.pairs.length}・性別で変わる組 ${built.genderRules.length}`);
  if (built.dropped.length) console.warn(`警告: パルのマスターにない ID の行を捨てました: ${built.dropped.join(' ')}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
