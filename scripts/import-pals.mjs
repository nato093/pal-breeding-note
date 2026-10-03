// パルのマスターデータを生成する（data/pals.csv・web/data/pals.js・gas/PalMaster.js）。
// 取り込むのは許可した列だけ（INV-2）。配合に関する情報は取得も出力もしない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALCALC, PALWORLD_HELPER, rawUrl, ALL_SOURCE_URLS } from './sources.mjs';

export const CSV_COLUMNS = ['palId', 'dexNo', 'variant', 'dexLabel', 'nameJa', 'nameEn', 'elements', 'icon', 'active'];
export const JS_FIELDS = ['id', 'no', 'variant', 'label', 'ja', 'en', 'el', 'icon', 'active'];

// 名前の重複など、取り込み元のままでは選び分けられないものの手当て（プレビューでユーザーが確認した）
const OVERRIDES = {
  // ゲーム内の図鑑に載っていないことをユーザーが確認（2026-10-04）。パル選択には出さないが、ID は残す
  PlantSlime_Flower: { nameJa: 'ナエモチ（花）', nameEn: 'Gumoss (Flower)', active: false },
};

const COLLAB_DEX_FROM = 10000;

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pal-breeding-note' } });
  if (!res.ok) throw new Error(`取得失敗 ${res.status}: ${url}`);
  return res.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ''));
}

const csvCell = (v) => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const normName = (s) => String(s || '').trim().toLowerCase();

export function buildPals({ db, elementsCsv, iconFiles }) {
  const elementRows = parseCsv(elementsCsv);
  const header = elementRows[0];
  const nameCol = header.indexOf('Name');
  const elCol = header.indexOf('Elements');
  if (nameCol < 0 || elCol < 0) throw new Error('属性 CSV に Name / Elements 列がない');
  const elementsByName = new Map(elementRows.slice(1).map((r) => [normName(r[nameCol]), r[elCol]]));
  // 英名の表記が取り込み元どうしで食い違うことがある（例: Snock Terra / Snock Lux）ので、図鑑ラベル（163B）でも引けるようにする
  const dexCol = header.indexOf('Paldex');
  const elementsByLabel = new Map(dexCol < 0 ? [] : elementRows.slice(1).map((r) => [String(r[dexCol]).trim(), r[elCol]]));
  const icons = new Set(iconFiles);

  const report = { missingJa: [], missingElements: [], missingIcon: [], duplicateJa: [] };
  const pals = db.Pals.map((p) => {
    const id = p.InternalName;
    const no = p.Id.PalDexNo;
    const variant = Boolean(p.Id.IsVariant);
    const nameEn = p.LocalizedNames.en || p.Name;
    const over = OVERRIDES[id] || {};
    const label = `${no}${variant ? 'B' : ''}`;
    const elementsRaw = elementsByName.get(normName(nameEn)) || (no < COLLAB_DEX_FROM ? elementsByLabel.get(label) : undefined);
    if (!p.LocalizedNames.ja) report.missingJa.push(id);
    if (!elementsRaw) report.missingElements.push(id);
    const hasIcon = icons.has(`T_${id}_icon_normal.webp`);
    if (!hasIcon) report.missingIcon.push(id);
    return {
      palId: id,
      dexNo: no,
      variant,
      dexLabel: no >= COLLAB_DEX_FROM ? 'コラボ' : label,
      nameJa: over.nameJa || p.LocalizedNames.ja || nameEn,
      nameEn: over.nameEn || nameEn,
      elements: elementsRaw ? elementsRaw.split('/').map((s) => s.trim()).filter(Boolean) : [],
      icon: hasIcon ? `${id}.webp` : '',
      active: over.active !== undefined ? over.active : true,
    };
  });

  pals.sort((a, b) => a.dexNo - b.dexNo || Number(a.variant) - Number(b.variant) || a.palId.localeCompare(b.palId));

  const seen = new Map();
  pals.forEach((p) => {
    if (seen.has(p.nameJa)) report.duplicateJa.push(`${p.nameJa}: ${seen.get(p.nameJa)} / ${p.palId}`);
    else seen.set(p.nameJa, p.palId);
  });
  const ids = new Set();
  pals.forEach((p) => {
    if (!/^[A-Za-z0-9_]+$/.test(p.palId)) throw new Error(`想定外の ID: ${p.palId}`);
    if (ids.has(p.palId)) throw new Error(`ID の重複: ${p.palId}`);
    ids.add(p.palId);
  });

  const elementNames = Object.fromEntries(
    db.Elements.map((e) => [e.Name, (e.LocalizedNames.ja || e.Name).replace(/属性$/, '')]),
  );
  return { pals, report, elementNames };
}

export function renderOutputs({ pals, elementNames }) {
  const csv = [CSV_COLUMNS.join(',')]
    .concat(pals.map((p) => CSV_COLUMNS.map((c) => csvCell(c === 'elements' ? p.elements.join('|') : p[c])).join(',')))
    .join('\n') + '\n';

  const jsRows = pals.map((p) => JSON.stringify({
    id: p.palId, no: p.dexNo, variant: p.variant, label: p.dexLabel, ja: p.nameJa, en: p.nameEn,
    el: p.elements, icon: p.icon, active: p.active,
  }));
  const js = '// 自動生成（scripts/import-pals.mjs）。手で編集しない。\n'
    + `export const ELEMENTS = ${JSON.stringify(elementNames)};\n\n`
    + `export default [\n  ${jsRows.join(',\n  ')}\n];\n`;

  const master = Object.fromEntries(pals.map((p) => [p.palId, p.nameJa]));
  const gas = '// 自動生成（scripts/import-pals.mjs）。手で編集しない。\n'
    + '// サーバ側でのパル ID の検証と、シートに書く表示名に使う。\n'
    + `var PAL_MASTER_ = ${JSON.stringify(master, null, 1)};\n`;
  return { csv, js, gas };
}

function renderPreview(pals) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = pals.map((p) => `<figure class="${p.icon ? '' : 'noicon'}">${
    p.icon ? `<img src="../web/img/pals/${esc(p.icon)}" alt="" loading="lazy">` : '<div class="ph">画像なし</div>'
  }<figcaption><b>${esc(p.dexLabel)}</b> ${esc(p.nameJa)}<br><small>${esc(p.elements.join(' / ') || '属性不明')} ・ ${esc(p.palId)}</small></figcaption></figure>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>パル一覧プレビュー</title>
<style>body{font-family:system-ui,sans-serif;margin:16px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
figure{margin:0;border:1px solid #ccc;border-radius:10px;padding:8px;text-align:center}figure img{width:72px;height:72px;object-fit:contain}
.noicon{background:#fff3f0}.ph{height:72px;display:grid;place-items:center;color:#999}small{color:#666}</style>
<h1>パル一覧プレビュー（${pals.length} 体）</h1><main>${cards}</main>`;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log('取得元:');
  ALL_SOURCE_URLS.forEach((u) => console.log(`  ${u}`));

  const [dbText, elementsCsv, iconListText] = await Promise.all([
    fetchText(rawUrl(PALCALC, PALCALC.files.db)),
    fetchText(rawUrl(PALWORLD_HELPER, PALWORLD_HELPER.files.elements)),
    fetchText(ALL_SOURCE_URLS[2]),
  ]);
  const iconFiles = JSON.parse(iconListText).map((f) => f.name);
  const built = buildPals({ db: JSON.parse(dbText), elementsCsv, iconFiles });
  const out = renderOutputs(built);

  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
    console.log(`書き出し: ${rel}`);
  };
  write('data/pals.csv', out.csv);
  write('web/data/pals.js', out.js);
  write('gas/PalMaster.js', out.gas);
  write('preview/index.html', renderPreview(built.pals));

  const r = built.report;
  console.log(`\nパル ${built.pals.length} 体`);
  console.log(`日本語名なし: ${r.missingJa.length} ${r.missingJa.join(' ')}`);
  console.log(`属性なし: ${r.missingElements.length} ${r.missingElements.join(' ')}`);
  console.log(`画像なし: ${r.missingIcon.length} ${r.missingIcon.join(' ')}`);
  console.log(`日本語名の重複: ${r.duplicateJa.length} ${r.duplicateJa.join(' ')}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
