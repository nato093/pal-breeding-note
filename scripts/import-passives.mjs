// パッシブスキルのマスターを生成する（data/passives.csv・web/data/passives.js）。
// 取り込むのは名前・ランク・効果の説明だけ。配合での遺伝の確率などは取得も出力もしない（INV-2）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALCALC, rawUrl } from './sources.mjs';

export const PASSIVE_CSV_COLUMNS = ['passiveId', 'nameJa', 'nameEn', 'rank', 'standard', 'descriptionJa'];
export const PASSIVE_JS_FIELDS = ['id', 'ja', 'en', 'rank', 'std', 'desc'];

const csvCell = (v) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ゲーム内で名前が付いていないもの（開発用・未使用。名前が '-' や 'xx Text'）は除く
const named = (text) => typeof text === 'string' && text !== '' && text !== '-' && !/_?Text$/.test(text);

export function buildPassives(db) {
  const passives = [];
  const ids = new Set();
  for (const p of db.PassiveSkills ?? []) {
    const ja = p.LocalizedNames?.ja;
    if (!named(ja)) continue;
    const id = p.InternalName;
    if (!/^[A-Za-z0-9_]+$/.test(id)) throw new Error(`想定外の ID: ${id}`);
    if (ids.has(id)) throw new Error(`ID の重複: ${id}`);
    ids.add(id);
    const desc = p.LocalizedDescriptions?.ja;
    passives.push({
      id,
      ja,
      en: named(p.LocalizedNames?.en) ? p.LocalizedNames.en : (p.Name || id),
      rank: Number.isFinite(p.Rank) ? p.Rank : 0,
      std: p.IsStandardPassiveSkill === true,
      desc: named(desc) ? desc.replace(/\r?\n/g, ' ') : '',
    });
  }
  // 良いものから順に（ランクの高い順）、同じランクは ID 順
  passives.sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return passives;
}

export function renderPassives(passives) {
  const csv = [PASSIVE_CSV_COLUMNS.join(',')]
    .concat(passives.map((p) => [p.id, p.ja, p.en, p.rank, p.std, p.desc].map(csvCell).join(',')))
    .join('\n') + '\n';
  const js = '// 自動生成（scripts/import-passives.mjs）。手で編集しない。\n'
    + 'export default [\n  '
    + passives.map((p) => JSON.stringify(Object.fromEntries(PASSIVE_JS_FIELDS.map((key) => [key, p[key]])))).join(',\n  ')
    + '\n];\n';
  return { csv, js };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const url = rawUrl(PALCALC, PALCALC.files.db);
  console.log(`取得元: ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'pal-breeding-note' } });
  if (!res.ok) throw new Error(`取得失敗 ${res.status}: ${url}`);
  const passives = buildPassives(await res.json());
  const out = renderPassives(passives);
  fs.writeFileSync(path.join(root, 'data/passives.csv'), out.csv);
  fs.writeFileSync(path.join(root, 'web/data/passives.js'), out.js);
  console.log(`パッシブ ${passives.length} 件（通常のパッシブ ${passives.filter((p) => p.std).length} 件）`);
  console.log('書き出し: data/passives.csv, web/data/passives.js');
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
