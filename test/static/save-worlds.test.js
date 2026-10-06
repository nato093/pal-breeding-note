import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findWorlds, resolveSaveFile } from '../../scripts/save-worlds.mjs';

function tempSaves(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-saves-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, text = 'x', time = null) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
    if (time) fs.utimesSync(path.join(root, rel), time, time);
  };
  write('7656/AAAA/Level.sav', 'level-a');
  write('7656/AAAA/Players/00000000000000000000000000000001.sav');
  write('7656/AAAA/Players/savesync.sav');
  write('7656/AAAA/backup/world/x/Level.sav');
  write('7656/GlobalPalStorage.sav', 'global');
  write('secret.sav', 'secret');
  write('7656/BBBB/Level.sav', 'x', new Date('2026-01-01T00:00:00Z'));
  return { root, write };
}

test('セーブの一覧: ワールドを新しい順に見つけ、バックアップや別のファイルは含めない', (t) => {
  const { root } = tempSaves(t);
  const worlds = findWorlds(root);
  assert.deepEqual(worlds.map((w) => [w.dir, w.role, w.files]), [
    ['7656/AAAA', 'host', ['Level.sav', 'Players/00000000000000000000000000000001.sav', '../GlobalPalStorage.sav']],
    ['7656/BBBB', 'host', ['Level.sav', '../GlobalPalStorage.sav']],
  ]);
  assert.equal(resolveSaveFile(root, '7656/AAAA', '../../secret.sav'), null);
  assert.equal(resolveSaveFile(root, '7656/AAAA', 'Players/../../BBBB/Level.sav'), null);
  assert.equal(resolveSaveFile(root, '7656/AAAA', '../GlobalPalStorage.sav'), path.join(root, '7656', 'GlobalPalStorage.sav'));
});

test('セーブの一覧: 前にホストしたワールドに参加したら（LocalData.sav の方が新しい）参加と判定する', (t) => {
  const { root, write } = tempSaves(t);
  // ホストで保存すると Level.sav と LocalData.sav はほぼ同時に書かれる
  write('7656/CCCC/Level.sav', 'x', new Date('2026-10-05T10:00:00Z'));
  write('7656/CCCC/LocalData.sav', 'x', new Date('2026-10-05T10:00:01Z'));
  // 参加すると LocalData.sav だけが新しくなる
  write('7656/DDDD/Level.sav', 'x', new Date('2026-10-05T09:00:00Z'));
  write('7656/DDDD/LocalData.sav', 'x', new Date('2026-10-05T09:00:30Z'));
  write('7656/EEEE/LocalData.sav', 'x', new Date('2026-10-05T08:00:00Z'));
  const roles = Object.fromEntries(findWorlds(root).map((w) => [w.id, w.role]));
  assert.deepEqual([roles.CCCC, roles.DDDD, roles.EEEE], ['host', 'guest', 'guest']);
});

test('セーブの一覧: ワールドのフォルダを直接指定しても、外のファイルやリンク先は読まない', (t) => {
  const { root } = tempSaves(t);
  const world = path.join(root, '7656', 'AAAA');
  assert.deepEqual(findWorlds(world).map((w) => [w.dir, w.files]), [['.', ['Level.sav', 'Players/00000000000000000000000000000001.sav']]]);
  try {
    fs.symlinkSync(path.join(root, 'secret.sav'), path.join(world, 'Players', '00000000000000000000000000000002.sav'));
  } catch {
    t.diagnostic('この環境ではシンボリックリンクを作れないため、リンク先の確認を省く（Windows の既定の権限など）');
    return;
  }
  assert.equal(resolveSaveFile(world, '.', 'Players/00000000000000000000000000000002.sav'), null);
  assert.ok(!findWorlds(world)[0].files.includes('Players/00000000000000000000000000000002.sav'));
});
