import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWorldPath, savePathForName, handlesFromDrop, handleDropSupported, inspectFiles, readFiles, createHandleSource,
} from '../../web/js/save/handles.js';
import { fakeHandle, hostFiles, memoryPersist, T0 } from '../helpers/file-handles.js';

const WORLD = '4A431AC14B58A7E31A76B2A991F79FE8';

test('セーブのファイル: 貼ったパスから Steam ID とワールド ID を取り出す', () => {
  assert.deepEqual(parseWorldPath(`"C:\\Users\\a\\AppData\\Local\\Pal\\Saved\\SaveGames\\76561198382155809\\${WORLD.toLowerCase()}\\Players"`), {
    steamId: '76561198382155809', worldId: WORLD, folder: `C:\\Users\\a\\AppData\\Local\\Pal\\Saved\\SaveGames\\76561198382155809\\${WORLD.toLowerCase()}`,
  });
  assert.equal(parseWorldPath(`%LOCALAPPDATA%/Pal/Saved/SaveGames/0/${WORLD}`).steamId, '0');
  assert.equal(parseWorldPath(`C:\\SaveGames\\7656\\${WORLD}0`), null);
  assert.equal(parseWorldPath('C:\\SaveGames\\7656'), null);
  assert.equal(parseWorldPath(''), null);
});

test('セーブのファイル: ドロップしたファイルの名前を、ワールドのフォルダからの相対パスにする', () => {
  assert.equal(savePathForName('level.SAV'), 'Level.sav');
  assert.equal(savePathForName('LocalData.sav'), 'LocalData.sav');
  assert.equal(savePathForName('GlobalPalStorage.sav'), '../GlobalPalStorage.sav');
  assert.equal(savePathForName('0123456789ABCDEF0123456789ABCDEF_dps.sav'), 'Players/0123456789ABCDEF0123456789ABCDEF_dps.sav');
  assert.equal(savePathForName('WorldOption.sav'), '');
  assert.equal(savePathForName('Level.sav.json'), '');
});

test('セーブのファイル: ドロップからハンドルを集め、フォルダ・対象外・同じ名前を分ける', async () => {
  const item = (value) => ({ kind: 'file', getAsFileSystemHandle: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value)) });
  const result = await handlesFromDrop({
    items: [
      item(fakeHandle('Level.sav')), item(fakeHandle('WorldOption.sav')), item({ kind: 'directory', name: 'Players' }),
      item(new DOMException('blocked', 'AbortError')), item(fakeHandle('LEVEL.sav')), { kind: 'string' },
    ],
  });
  // 同じ場所に入るファイルが 2 つあると、どちらが正しいか分からないので、どちらも受け取らない
  assert.deepEqual(result.files.map((file) => file.path), []);
  assert.deepEqual([result.supported, result.ignored, result.failed, result.duplicates], [true, ['WorldOption.sav'], 2, ['Level.sav', 'LEVEL.sav']]);
  const old = await handlesFromDrop({ items: [{ kind: 'file' }] });
  assert.equal(old.supported, false);
  assert.equal(handleDropSupported({}), false);
  assert.equal(handleDropSupported({ DataTransferItem: { prototype: { getAsFileSystemHandle() {} } } }), true);
});

test('セーブのファイル: 必要なファイルが読めないときは、ホストか参加かを決めない', async () => {
  const files = hostFiles();
  assert.deepEqual(await inspectFiles('host', files).then((r) => [r.status, r.role]), ['ok', 'host']);
  files['LocalData.sav'].time = T0 + 30000;
  assert.deepEqual(await inspectFiles('host', files).then((r) => [r.status, r.role]), ['ok', 'guest']);
  files['Players/00000000000000000000000000000001.sav'].gone = true;
  const optional = await inspectFiles('host', files);
  assert.deepEqual([optional.status, optional.missing], ['ok', ['Players/00000000000000000000000000000001.sav']]);
  files['LocalData.sav'].gone = true;
  assert.deepEqual(await inspectFiles('host', files).then((r) => [r.status, r.role]), ['missing', '']);
  files['Level.sav'].permission = 'prompt';
  assert.equal((await inspectFiles('host', files)).status, 'permission');
  assert.deepEqual(await inspectFiles('guest', { 'LocalData.sav': fakeHandle('LocalData.sav') }).then((r) => [r.status, r.role]), ['ok', 'guest']);
});

test('セーブのファイル: 読むときに飛ばすのは、Level.sav 以外の消えたファイルだけ', async () => {
  const files = hostFiles();
  files['Players/00000000000000000000000000000001.sav'].gone = true;
  const read = await readFiles(files, Object.keys(files));
  assert.deepEqual(read.files.map((file) => file.path), ['Level.sav', 'LevelMeta.sav', 'LocalData.sav']);
  assert.deepEqual(read.skipped.map((file) => file.path), ['Players/00000000000000000000000000000001.sav']);
  files['LevelMeta.sav'].error = 'NotReadableError';
  await assert.rejects(readFiles(files, Object.keys(files)), (error) => error.code === 'NOT_READABLE');
  files['LevelMeta.sav'].error = '';
  files['LevelMeta.sav'].permission = 'prompt';
  await assert.rejects(readFiles(files, Object.keys(files)), (error) => error.code === 'NEEDS_PERMISSION');
  files['Level.sav'].gone = true;
  await assert.rejects(readFiles(files, ['Level.sav']), /Level\.sav が見つかりません/);
  // 必須のファイル（ホストなら LocalData.sav も）は、消えていても飛ばさない
  const host = hostFiles();
  host['LocalData.sav'].gone = true;
  await assert.rejects(readFiles(host, Object.keys(host), ['Level.sav', 'LevelMeta.sav', 'LocalData.sav']), (error) => error.code === 'MISSING');
});

test('セーブのファイル: 登録を保存し、最後に遊んだ順に並べ、ファイルの変化で印を変える', async () => {
  const persist = memoryPersist();
  const source = createHandleSource({ persist, key: 'k' });
  const older = hostFiles(T0);
  const newer = hostFiles(T0 + 60000);
  assert.equal((await source.commit({ worldId: 'A', steamId: '1', files: older })).persisted, true);
  await source.commit({ worldId: 'B', steamId: '1', files: { 'LocalData.sav': newer['LocalData.sav'] } });
  const worlds = await source.list();
  assert.deepEqual(worlds.map((w) => [w.id, w.kind, w.role, w.status]), [['B', 'guest', 'guest', 'ok'], ['A', 'host', 'host', 'ok']]);
  const before = worlds[1].signature;
  older['Players/00000000000000000000000000000001.sav'].size = 2;
  assert.notEqual((await source.list())[1].signature, before);
  // 開き直しても登録が残る
  const again = createHandleSource({ persist, key: 'k' });
  assert.deepEqual((await again.list()).map((w) => w.id), ['B', 'A']);
  // 追加のドロップは同じワールドに足す
  await again.commit({ worldId: 'A', steamId: '1', files: { '../GlobalPalStorage.sav': fakeHandle('GlobalPalStorage.sav') } });
  assert.equal(Object.keys(again.get('A').files).length, 5);
  assert.equal(again.get('A').revision, 2);
});

test('セーブのファイル: 許可は登録したすべてのファイルに求め、保存できない削除は失敗にする', async () => {
  const persist = memoryPersist();
  const source = createHandleSource({ persist, key: 'k' });
  const files = hostFiles();
  await source.commit({ worldId: 'A', steamId: '1', files });
  for (const handle of Object.values(files)) handle.permission = 'prompt';
  assert.equal((await source.list())[0].status, 'permission');
  assert.deepEqual(await source.requestPermission(), { granted: 4, total: 4 });
  assert.equal((await source.list())[0].status, 'ok');
  persist.strict = false;
  await assert.rejects(source.remove('A'), /削除できませんでした/);
  assert.equal(source.has('A'), true);
  // 保存できなかった登録があっても、保存済みの登録の削除の失敗は見逃さない
  await source.commit({ worldId: 'C', steamId: '1', files: hostFiles() });
  assert.equal(source.get('C').persisted, false);
  // 保存済みのワールドにファイルを足して保存に失敗しても、前の版は保存されているので保存済みのまま
  assert.equal((await source.commit({ worldId: 'A', steamId: '1', files: { '../GlobalPalStorage.sav': fakeHandle('GlobalPalStorage.sav') } })).persisted, false);
  assert.equal(source.get('A').persisted, true);
  await assert.rejects(source.remove('A'), /削除できませんでした/);
  await source.remove('C');
  assert.equal(source.has('C'), false);
  // 保存できない環境で登録したもの（このページを開いている間だけ）は、メモリから消せる
  const session = createHandleSource({ persist, key: 'other' });
  assert.equal((await session.commit({ worldId: 'B', steamId: '1', files: hostFiles() })).persisted, false);
  await session.remove('B');
  assert.equal(session.has('B'), false);
});
