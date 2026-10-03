import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function renderShared(sources) {
  const parts = sources.map(({ name, source }) => {
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
  for (const name of ['pair.js', 'validate.js']) {
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
