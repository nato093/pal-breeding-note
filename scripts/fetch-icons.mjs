// パル画像を取得して web/img/pals/ に置く（リポジトリにはコミットしない）。
// 取得に失敗しても終了コードは 0。画像のないパルは画面側で SVG アバターになる。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALWORLD_HELPER, rawUrl, iconSourceFile } from './sources.mjs';
import pals from '../web/data/pals.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'web/img/pals');
const CONCURRENCY = 8;

const targets = pals.filter((p) => p.icon).map((p) => ({ id: p.id, file: p.icon }));

fs.mkdirSync(outDir, { recursive: true });

let ok = 0;
let skipped = 0;
const failed = [];

async function fetchOne({ id, file }) {
  const dest = path.join(outDir, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { skipped++; return; }
  try {
    const res = await fetch(rawUrl(PALWORLD_HELPER, iconSourceFile(id)));
    if (!res.ok) throw new Error(String(res.status));
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    ok++;
  } catch (err) {
    failed.push(`${id}(${err.message})`);
  }
}

const queue = targets.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) await fetchOne(queue.shift());
}));

console.log(`パル画像: 取得 ${ok} / 既存 ${skipped} / 失敗 ${failed.length}（対象 ${targets.length}）`);
if (failed.length) console.log(`失敗: ${failed.join(' ')}`);
