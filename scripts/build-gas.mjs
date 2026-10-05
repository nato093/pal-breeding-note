import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// GAS と画面で共有するファイル（web/js/core/ の中。import は使えない）
export const SHARED_FILES = ['pair.js', 'validate.js', 'user.js', 'owned-shared.js'];

export function renderShared(sources) {
  // Windows の作業ツリー（CRLF）でも同じ内容になるよう、改行を LF にそろえてから組み立てる
  const parts = sources.map(({ name, source: raw }) => {
    const source = raw.replace(/\r\n/g, '\n');
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
    if (/\bimport\s*(?:[\s"'{*(]|\.)/.test(withoutComments)) {
      throw new Error(`${name}: GAS 共有コードに import は使用できません`);
    }
    return source.replace(/^export /gm, '').trimEnd();
  });
  return `// 自動生成・手で編集しない。scripts/build-gas.mjs で生成。\n\n${parts.join('\n\n')}\n`;
}

export async function buildShared() {
  const sources = [];
  for (const name of SHARED_FILES) {
    const source = await readFile(path.join(projectDir, 'web/js/core', name), 'utf8');
    sources.push({ name, source });
  }
  const shared = renderShared(sources);
  await writeFile(path.join(projectDir, 'gas/Shared.js'), shared, 'utf8');
  return shared;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await buildShared();
    console.log('gas/Shared.js を生成しました');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
