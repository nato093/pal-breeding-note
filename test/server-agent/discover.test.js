import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dedicatedServerName, discoverWorld, listWorldFiles, readInstances } from '../../tools/server-agent/discover.mjs';

// ダミーの値（実在のワールド ID・インスタンス ID ではない）
const WORLD_A = 'AAAAAAAA000000000000000000000001';
const WORLD_B = 'BBBBBBBB000000000000000000000002';
const PLAYER = '0000000000000000000000000000000A';
const INST_A = 'TESTINSTA0000001';
const INST_B = 'TESTINSTB0000002';
const SECRET = 'dummy-admin-secret-0000';

function tempRoot(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pal-agent-discover-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, text = 'x') => {
    const file = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  return { root, write };
}

const ini = (worldId) => `[/Script/Pal.PalGameLocalSettings]\r\nDedicatedServerName=${worldId}\r\n[/Script/Engine.GameUserSettings]\r\nbUseVSync=False\r\n`;

// ServerSync のインスタンスの形（instance.json と PalWorldSettings.ini にはパスワードのダミーを入れる）
function instance(write, id, worldId) {
  const base = `ServerSync/${id}`;
  write(`${base}/instance.json`, JSON.stringify({ adminPassword: SECRET }));
  write(`${base}/bin/PalServer.exe`);
  write(`${base}/bin/Pal/Saved/Config/WindowsServer/PalWorldSettings.ini`, `OptionSettings=(AdminPassword="${SECRET}")`);
  if (worldId !== null) write(`${base}/bin/Pal/Saved/Config/WindowsServer/GameUserSettings.ini`, ini(worldId));
  if (worldId) {
    write(`${base}/bin/Pal/Saved/SaveGames/0/${worldId}/Level.sav`);
    write(`${base}/bin/Pal/Saved/SaveGames/0/${worldId}/LevelMeta.sav`);
  }
}

function serverSync(t, entries) {
  const { root, write } = tempRoot(t);
  const local = path.join(root, 'Local');
  const map = {};
  for (const [id, worldId] of entries) {
    instance(write, id, worldId);
    map[id] = path.join(root, 'ServerSync', id);
  }
  write('Local/ServerSync/instances.json', JSON.stringify(map));
  return { root, write, local };
}

// 読んだファイルを覚える fs（instance.json・PalWorldSettings.ini を読まないことを確かめる）
function recordingFs() {
  const read = [];
  return {
    read,
    fs: { ...fsPromises, readFile: (file, ...rest) => { read.push(String(file)); return fsPromises.readFile(file, ...rest); } },
  };
}

test('常駐の発見: ServerSync のインスタンスの GameUserSettings.ini の DedicatedServerName でワールドを見つける', async (t) => {
  const { root, local } = serverSync(t, [[INST_A, WORLD_A]]);
  const { fs: recorded, read } = recordingFs();
  const found = await discoverWorld({ localAppData: local, fs: recorded });
  const instanceDir = path.join(root, 'ServerSync', INST_A);
  assert.deepEqual(found, {
    ok: true, source: 'serversync', worldId: WORLD_A,
    worldDir: path.join(instanceDir, 'bin', 'Pal', 'Saved', 'SaveGames', '0', WORLD_A),
    savedDir: path.join(instanceDir, 'bin', 'Pal', 'Saved'),
    serverDir: path.join(instanceDir, 'bin'),
    instanceId: INST_A, instanceDir,
  });
  assert.ok(read.length > 0);
  assert.ok(read.every((file) => /instances\.json$|GameUserSettings\.ini$/.test(file)), 'instance.json・PalWorldSettings.ini は読まない');
  assert.ok(!JSON.stringify(found).includes(SECRET));
});

test('常駐の発見: 候補のインスタンスが複数なら、更新日時で選ばずに設定の instance を求める', async (t) => {
  const { root, local } = serverSync(t, [[INST_A, WORLD_A], [INST_B, WORLD_B], ['TESTINSTC0000003', null], ['TESTINSTD0000004', '']]);
  // 片方を新しくしても選ばない
  fs.utimesSync(path.join(root, 'ServerSync', INST_B, 'bin', 'Pal', 'Saved', 'SaveGames', '0', WORLD_B, 'Level.sav'), new Date(), new Date());
  const both = await discoverWorld({ localAppData: local });
  assert.equal(both.ok, false);
  assert.equal(both.exitCode, 2);
  assert.match(both.reason, /instance/);
  assert.deepEqual(both.candidates, ['TEST…', 'TEST…']);
  assert.ok(!JSON.stringify(both).includes(INST_A) && !JSON.stringify(both).includes(INST_B), '理由にインスタンス ID を全部は出さない');
  const chosen = await discoverWorld({ localAppData: local, instance: INST_B.toLowerCase() });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.worldId, WORLD_B);
  assert.equal(chosen.instanceId, INST_B);
  // 先頭が複数に当たる・どれにも当たらない
  assert.equal((await discoverWorld({ localAppData: local, instance: 'TESTINST' })).ok, false);
  const none = await discoverWorld({ localAppData: local, instance: 'NOPE' });
  assert.equal(none.ok, false);
  assert.match(none.reason, /instance/);
});

test('常駐の発見: 見つからないときは終了コード 2 の理由を返す', async (t) => {
  const { local } = serverSync(t, [['TESTINSTC0000003', null], ['TESTINSTD0000004', '']]);
  const result = await discoverWorld({ localAppData: local });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.match(result.reason, /見つかりません/);
  const empty = tempRoot(t);
  assert.equal((await discoverWorld({ localAppData: path.join(empty.root, 'none') })).ok, false);
});

test('常駐の発見: 設定の serverRoot（Steam の PalServer の Pal\\Saved と ServerSync の save）から探す', async (t) => {
  const { root, write } = tempRoot(t);
  write('PalServer/PalServer.exe');
  write('PalServer/Pal/Saved/Config/WindowsServer/GameUserSettings.ini', ini(WORLD_B.toLowerCase()));
  write(`PalServer/Pal/Saved/SaveGames/0/${WORLD_B}/Level.sav`);
  const found = await discoverWorld({ serverRoot: path.join(root, 'PalServer') });
  assert.equal(found.ok, true);
  assert.equal(found.source, 'serverRoot');
  assert.equal(found.worldId, WORLD_B);
  assert.equal(found.serverDir, path.join(root, 'PalServer'));
  assert.equal(found.instanceId, '');
  // ServerSync の save（bin\Pal\Saved へのジャンクション）だけがある形
  write('Other/Pal/Saved/Config/WindowsServer/GameUserSettings.ini', ini(WORLD_A));
  write(`Other/Pal/Saved/SaveGames/0/${WORLD_A}/Level.sav`);
  fs.mkdirSync(path.join(root, 'Linked'));
  fs.symlinkSync(path.join(root, 'Other', 'Pal', 'Saved'), path.join(root, 'Linked', 'save'), 'junction');
  const linked = await discoverWorld({ serverRoot: path.join(root, 'Linked') });
  assert.equal(linked.ok, true);
  assert.equal(linked.worldDir, path.join(root, 'Other', 'Pal', 'Saved', 'SaveGames', '0', WORLD_A));
  assert.equal(linked.serverDir, path.join(root, 'Other'));
  // DedicatedServerName が指すフォルダがない
  write('Empty/Pal/Saved/Config/WindowsServer/GameUserSettings.ini', ini(WORLD_A));
  const missing = await discoverWorld({ serverRoot: path.join(root, 'Empty') });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /serverRoot/);
});

test('常駐の発見: 設定の worldDir はサーバーのセーブのフォルダだけ。ServerSync のインスタンスに結び付ける', async (t) => {
  const { root, local, write } = serverSync(t, [[INST_A, WORLD_A]]);
  const worldDir = path.join(root, 'ServerSync', INST_A, 'bin', 'Pal', 'Saved', 'SaveGames', '0', WORLD_A);
  const found = await discoverWorld({ worldDir: `${worldDir}${path.sep}`, localAppData: local });
  assert.equal(found.ok, true);
  assert.equal(found.source, 'worldDir');
  assert.equal(found.worldDir, worldDir);
  assert.equal(found.instanceId, INST_A);
  assert.equal(found.serverDir, path.join(root, 'ServerSync', INST_A, 'bin'));
  // 協力プレイのフォルダ（SaveGames\<SteamID>\<ワールド ID>）は断る
  write(`Coop/SaveGames/76561190000000000/${WORLD_A}/Level.sav`);
  const coop = await discoverWorld({ worldDir: path.join(root, 'Coop', 'SaveGames', '76561190000000000', WORLD_A), localAppData: local });
  assert.equal(coop.ok, false);
  assert.match(coop.reason, /サーバーのセーブ/);
  // ないフォルダ・別のインスタンスを指定
  assert.equal((await discoverWorld({ worldDir: path.join(root, 'x', 'SaveGames', '0', WORLD_B), localAppData: local })).ok, false);
  assert.equal((await discoverWorld({ worldDir, localAppData: local, instance: 'OTHER' })).ok, false);
});

test('常駐の発見: 読むファイルは直下の Level.sav・LevelMeta.sav と Players の中だけ（savesync.sav・backup・LocalData.sav・GlobalPalStorage.sav は入らない）', async (t) => {
  const { root, write } = tempRoot(t);
  const world = `SaveGames/0/${WORLD_A}`;
  for (const rel of ['Level.sav', 'LevelMeta.sav', 'LocalData.sav', 'WorldOption.sav', `Players/${PLAYER}.sav`, `Players/${PLAYER}_dps.sav`,
    'Players/savesync.sav', 'savesync.sav', `backup/world/2026.10.18-05.00.00/Level.sav`, `backup/world/2026.10.18-05.00.00/Players/${PLAYER}.sav`, 'notes.txt']) {
    write(`${world}/${rel}`);
  }
  write('SaveGames/0/GlobalPalStorage.sav');
  const dir = path.join(root, ...world.split('/'));
  assert.deepEqual(await listWorldFiles(dir), {
    'Level.sav': path.join(dir, 'Level.sav'),
    'LevelMeta.sav': path.join(dir, 'LevelMeta.sav'),
    [`Players/${PLAYER}.sav`]: path.join(dir, 'Players', `${PLAYER}.sav`),
    [`Players/${PLAYER}_dps.sav`]: path.join(dir, 'Players', `${PLAYER}_dps.sav`),
  });
  assert.deepEqual(await listWorldFiles(path.join(root, 'none')), {});
});

test('常駐の発見: ワールドのフォルダの外を指すリンクは使わない', async (t) => {
  const { root, write } = tempRoot(t);
  const dir = path.join(root, 'SaveGames', '0', WORLD_A);
  write(`SaveGames/0/${WORLD_A}/Level.sav`);
  write(`Outside/${PLAYER}.sav`, 'secret');
  // Windows でも管理者なしで作れるジャンクション（ほかの OS ではふつうのリンク）
  fs.symlinkSync(path.join(root, 'Outside'), path.join(dir, 'Players'), 'junction');
  assert.deepEqual(Object.keys(await listWorldFiles(dir)), ['Level.sav']);
});

test('常駐の発見: GameUserSettings.ini の DedicatedServerName は決まった節の 32 桁の 16 進だけ', () => {
  assert.equal(dedicatedServerName(ini(WORLD_A.toLowerCase())), WORLD_A);
  assert.equal(dedicatedServerName(`[Other]\nDedicatedServerName=${WORLD_A}\n`), '');
  assert.equal(dedicatedServerName('[/Script/Pal.PalGameLocalSettings]\nDedicatedServerName=\n'), '');
  assert.equal(dedicatedServerName('[/Script/Pal.PalGameLocalSettings]\nDedicatedServerName=..\\..\\x\n'), '');
  assert.equal(dedicatedServerName(''), '');
});

test('常駐の発見: instances.json は UTF-16 の BOM でも読み、形の違う行は捨てる', async (t) => {
  const { root, write } = tempRoot(t);
  const body = JSON.stringify({ [INST_A]: 'G:\\ServerSync\\x', '../bad': 'G:\\y', [INST_B]: 3 });
  const file = write('Local/ServerSync/instances.json');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]));
  assert.deepEqual(await readInstances(path.join(root, 'Local')), [{ id: INST_A, dir: 'G:\\ServerSync\\x' }]);
  fs.writeFileSync(file, '{ broken');
  assert.deepEqual(await readInstances(path.join(root, 'Local')), []);
});
