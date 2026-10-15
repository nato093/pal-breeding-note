// ゲーム本体（Pal-Windows.pak）から、UI のアイコン（属性・作業適性・タマゴ・ケーキ・配合牧場・性別・インプラント・パルリバーサー）を取り出し、
// 表示の 2 倍の大きさに縮めて web/img/{element,work,item,ui}/ に書き出す（UI 改善フェーズ 4 の game-assets）。
// 使い方:
//   npm run extract:ui-icons -- "<Palworld のインストール先>"                     … UI_ICONS の全部を書き出す
//   npm run extract:ui-icons -- "<Palworld のインストール先>" --list <接頭辞>     … pak の中の接頭辞で始まるテクスチャの大きさと形式を出すだけ
//     例: --list Pal/Content/Pal/Texture/UI/InGame/T_Icon_element_s_
//   インストール先を省くと、環境変数 PALWORLD_DIR か既定の場所（extract-passive-icons.mjs と同じ）
// 読み取りのみ。形式は DXT1・DXT5・B8G8R8A8 だけ読める（それ以外は止まる。BC7 などが要るときは、復号を足す前にユーザーに確かめる）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPak, readTexture, textureInfo, encodePng } from './extract-passive-icons.mjs';

const UI = 'Pal/Content/Pal/Texture/UI/';
const ITEM = 'Pal/Content/Others/InventoryItemIcon/Texture/';
const n2 = (n) => String(n).padStart(2, '0');

/** 新しく足す画像の合計の上限（data/SOURCES.md の「画像の扱い」と同じ値） */
export const UI_ICONS_MAX_BYTES = 200 * 1024;

// 属性: 番号と属性の対応はゲームの WBP_PalElementIcon の IconMap（列挙 → テクスチャ）で確かめた（v1.0.5、2026-10-15）。
// 列挙（EPalElementType）の順とは違うので、推測で並べない。出力名は web/data/pals.js の ELEMENTS の鍵
const ELEMENT_ICONS = ['Neutral', 'Fire', 'Water', 'Electric', 'Grass', 'Dark', 'Dragon', 'Ground', 'Ice'];
// 作業適性: 番号と作業の対応はゲームの WBP_IconPalWork の IconMap で確かめた（v1.0.5、2026-10-15）。09 の原油抽出（OilExtraction）は
// 使うパルがいないので取り出さない。13（Anyone）は作業適性の列ではない。出力名は web/data/work.js の作業の鍵
const WORK_ICONS = { EmitFlame: 0, Watering: 1, Seeding: 2, GenerateElectricity: 3, Handcraft: 4, Collection: 5, Deforest: 6, Mining: 7,
  ProductMedicine: 8, Cool: 10, Transport: 11, MonsterFarm: 12 };
// タマゴ: アイテムの ID（PalEgg_〈種類〉_NN）の種類ごと。大きいタマゴ（_02〜_05）も同じアイコン（DT_ItemIconDataTable_Common に _01 の行だけ）。
// Normal は接尾辞なしのテクスチャ。Unknown は中身の分からないタマゴ
const EGG_ICONS = { Normal: '', Dark: '_Dark_01', Dragon: '_Dragon_01', Earth: '_Earth_01', Electricity: '_Electricity_01', Fire: '_Fire_01',
  Ice: '_Ice_01', Leaf: '_Leaf_01', Water: '_Water_01', WorldTree: '_WorldTree_01', MutationPal: '_MutationPal', Unknown: '_Unknown' };
// ケーキ: アイテムの ID（Cake・Cake02〜05）。テクスチャ名は 02〜05 だけ food が小文字
const CAKE_ICONS = { Cake: 'T_itemicon_Food_Cake', Cake02: 'T_itemicon_food_Cake02', Cake03: 'T_itemicon_food_Cake03',
  Cake04: 'T_itemicon_food_Cake04', Cake05: 'T_itemicon_food_Cake05' };

/**
 * 書き出す画像: 出力名（web/img/ の下、拡張子なし）→ { texture: pak の中のパス（拡張子なし）, size: 書き出す大きさ（表示の 2 倍） }。
 * 表示の大きさ: 属性 16〜20px・作業適性 16px・タマゴ 20px・ケーキ 20px・配合牧場 20px・性別 16px・インプラントとパルリバーサー 24px（implants）
 */
export const UI_ICONS = Object.freeze({
  ...Object.fromEntries(ELEMENT_ICONS.map((name, i) => [`element/${name}`, { texture: `${UI}InGame/T_Icon_element_s_${n2(i)}`, size: 40 }])),
  ...Object.fromEntries(Object.entries(WORK_ICONS).map(([key, i]) => [`work/${key}`, { texture: `${UI}InGame/T_icon_palwork_${n2(i)}`, size: 32 }])),
  ...Object.fromEntries(Object.entries(EGG_ICONS).map(([kind, suffix]) => [`item/egg-${kind}`, { texture: `${ITEM}T_itemicon_Material_PalEgg${suffix}`, size: 40 }])),
  ...Object.fromEntries(Object.entries(CAKE_ICONS).map(([id, texture]) => [`item/cake-${id}`, { texture: `${ITEM}${texture}`, size: 40 }])),
  'item/PalPassiveSkillChange': { texture: `${ITEM}T_itemicon_Material_PalPassiveSkillChange`, size: 48 },
  'item/PalPassiveSkillChange_Consumable': { texture: `${ITEM}T_itemicon_Material_PalPassiveSkillChange_Consumable`, size: 48 },
  'item/PalGenderReverse': { texture: `${ITEM}T_itemicon_Material_PalGenderReverse`, size: 48 },
  'ui/breed-farm': { texture: 'Pal/Content/Pal/Texture/BuildObject/PNG/T_icon_buildObject_BreedFarm', size: 40 },
  // 性別は Main_Menu の平らな記号（B8G8R8A8）。形だけ使い、色は CSS のトークン（--gender-male・--gender-female）で塗る（mask-image）
  'ui/gender-M': { texture: `${UI}Main_Menu/T_Icon_PanGender_Male`, size: 32 },
  'ui/gender-F': { texture: `${UI}Main_Menu/T_Icon_PanGender_Female`, size: 32 },
});

/**
 * 縮小（面積の重みつきの平均。色はアルファで重みを付けて混ぜ、縁が黒ずまないようにする）。長い方の辺を size にし、縦横比は保つ。
 * 元の方が小さければそのまま返す（拡大しない）
 * @returns {{ width: number, height: number, rgba: Buffer }}
 */
export function downscale(rgba, width, height, size) {
  const scale = size / Math.max(width, height);
  if (scale >= 1) return { width, height, rgba };
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const out = Buffer.alloc(outW * outH * 4);
  const sx = width / outW;
  const sy = height / outH;
  for (let y = 0; y < outH; y++) {
    const y0 = y * sy;
    const y1 = y0 + sy;
    for (let x = 0; x < outW; x++) {
      const x0 = x * sx;
      const x1 = x0 + sx;
      let r = 0; let g = 0; let b = 0; let a = 0; let area = 0;
      for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
          const w = wy * (Math.min(x1, px + 1) - Math.max(x0, px));
          const o = (py * width + px) * 4;
          const alpha = rgba[o + 3] * w;
          r += rgba[o] * alpha; g += rgba[o + 1] * alpha; b += rgba[o + 2] * alpha;
          a += alpha;
          area += w;
        }
      }
      const o = (y * outW + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / area);
    }
  }
  return { width: outW, height: outH, rgba: out };
}

// pak の中の接頭辞で始まるテクスチャの、パス・幅と高さ・形式（書き出さない）
function listTextures(pak, prefix) {
  let others = 0;
  let count = 0;
  for (const asset of pak.list(prefix).filter((name) => name.endsWith('.uasset'))) {
    const base = asset.slice(0, -'.uasset'.length);
    const info = pak.has(`${base}.uexp`) ? textureInfo(pak.get(`${base}.uexp`)) : null;
    if (!info) { others++; continue; }
    count++;
    console.log(`${base}\t${info.width}×${info.height}\t${info.format}${pak.has(`${base}.ubulk`) ? '\t(.ubulk)' : ''}`);
  }
  console.log(`テクスチャ ${count} 件（ほかのアセット ${others} 件）`);
}

function writeIcons(pak, root) {
  let total = 0;
  for (const [name, { texture, size }] of Object.entries(UI_ICONS)) {
    const bulk = pak.has(`${texture}.ubulk`) ? pak.get(`${texture}.ubulk`) : null;
    const source = readTexture(pak.get(`${texture}.uexp`), bulk);
    const image = downscale(source.rgba, source.width, source.height, size);
    const png = encodePng(image.width, image.height, image.rgba);
    const file = path.join(root, 'web', 'img', `${name}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png);
    total += png.length;
    console.log(`書き出し: web/img/${name}.png（${texture.split('/').pop()}, ${source.width}×${source.height} ${source.format} → ${image.width}×${image.height}, ${png.length} バイト）`);
  }
  console.log(`合計 ${Object.keys(UI_ICONS).length} 枚・${total} バイト（上限 ${UI_ICONS_MAX_BYTES} バイト）`);
  if (total > UI_ICONS_MAX_BYTES) throw new Error('画像の合計が上限を超えました（data/SOURCES.md の「画像の扱い」）。大きさを見直してください');
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--list');
  const prefix = at >= 0 ? args[at + 1] ?? '' : null;
  if (at >= 0) args.splice(at, 2);
  const gameDir = args[0] || process.env.PALWORLD_DIR || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Palworld';
  const pakFile = path.join(gameDir, 'Pal', 'Content', 'Paks', 'Pal-Windows.pak');
  if (!fs.existsSync(pakFile)) throw new Error(`pak が見つかりません: ${pakFile}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pak = openPak(pakFile);
  try {
    if (prefix !== null) listTextures(pak, prefix);
    else writeIcons(pak, root);
  } finally {
    pak.close();
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(error.message); process.exit(1); }
}
