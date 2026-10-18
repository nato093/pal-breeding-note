import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger, redact } from '../../tools/server-agent/log.mjs';

// ダミーの値
const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
const UID = '0123abcd-0000-0000-0000-000000000001';
const INSTANCE_ID = 'TESTINSTA0000001';
const INSTANCE_DIR = 'G:\\ServerSync\\TESTINSTA0000001';
const PROFILE = 'C:\\Users\\dummy-user';
const SECRET = 'dummy-shared-pass-0000';

test('常駐のログ: ID・パス・IP を伏せる', () => {
  const options = { secrets: [SECRET], instanceDirs: [INSTANCE_DIR], userProfile: PROFILE, instanceIds: [INSTANCE_ID] };
  const cases = [
    [`world ${WORLD} uid ${UID}`, 'world ABCDEF01… uid 0123abcd…'],
    [`Players/${WORLD}_dps.sav`, 'Players/ABCDEF01…_dps.sav'],
    [`${INSTANCE_DIR}\\bin\\Pal\\Saved\\SaveGames\\0\\${WORLD}`, '<instance>\\bin\\Pal\\Saved\\SaveGames\\0\\ABCDEF01…'],
    ['g:/serversync/testinsta0000001/bin', '<instance>/bin'],
    [JSON.stringify({ dir: `${INSTANCE_DIR}\\bin` }), '{"dir":"<instance>\\\\bin"}'],
    [`${PROFILE}\\AppData\\Local\\pal-note-agent`, '%USERPROFILE%\\AppData\\Local\\pal-note-agent'],
    ['D:\\Users\\other-person\\x', '%USERPROFILE%\\x'],
    [JSON.stringify('C:\\Users\\other-person\\x'), '"%USERPROFILE%\\\\x"'],
    [`instance ${INSTANCE_ID}`, 'instance TEST…'],
    ['from 203.0.113.20:8211 and 127.0.0.1:54866', 'from <ip>:8211 and <ip>:54866'],
    ['steam 76561190000000000', 'steam 7656…'],
    [`passcode=${SECRET}`, 'passcode=<secret>'],
    ['version 1.2.3 and count 1767', 'version 1.2.3 and count 1767'],
  ];
  for (const [input, expected] of cases) assert.equal(redact(input, options), expected, input);
  // 64 桁の 16 進（中身の印）は伏せる対象ではない
  const hash = 'f'.repeat(64);
  assert.equal(redact(hash), hash);
});

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pal-agent-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('常駐のログ: ファイルと標準出力に 1 行ずつ書き、debug は verbose のときだけ', (t) => {
  const dir = path.join(tempDir(t), 'test');
  const out = [];
  const log = createLogger({ dir, stdout: { write: (line) => out.push(line) }, now: () => Date.parse('2026-10-18T05:00:00Z'),
    redaction: { instanceDirs: [INSTANCE_DIR] } });
  log.info('attach', { worldId: WORLD, dir: `${INSTANCE_DIR}\\bin`, pals: 1767, ok: true });
  log.debug('detail', { n: 1 });
  log.setRedaction({ secrets: [SECRET] });
  log.error('login-failed', { error: Object.assign(new Error(`AUTH ${SECRET}`), { code: 'AUTH' }) });
  const text = fs.readFileSync(path.join(dir, 'agent.log'), 'utf8');
  assert.equal(log.file, path.join(dir, 'agent.log'));
  assert.deepEqual(text.split('\n').filter(Boolean), [
    '2026-10-18T05:00:00.000Z [info] attach worldId="ABCDEF01…" dir="<instance>\\\\bin" pals=1767 ok=true',
    '2026-10-18T05:00:00.000Z [error] login-failed error="AUTH: AUTH <secret>"',
  ]);
  assert.equal(out.join(''), text);
  const verbose = createLogger({ dir, stdout: null, verbose: true });
  verbose.debug('detail', { n: 1 });
  assert.match(fs.readFileSync(path.join(dir, 'agent.log'), 'utf8'), /\[debug\] detail n=1/);
});

test('常駐のログ: 大きさの上限で回し、3 世代だけ残す', (t) => {
  const dir = tempDir(t);
  const log = createLogger({ dir, stdout: null, maxBytes: 200 });
  for (let i = 0; i < 40; i++) log.info('tick', { i, pad: 'x'.repeat(40) });
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['agent.log', 'agent.log.1', 'agent.log.2']);
  for (const file of files) assert.ok(fs.statSync(path.join(dir, file)).size <= 200, file);
  assert.match(fs.readFileSync(path.join(dir, 'agent.log'), 'utf8'), /i=39/);
  // 書けなくても止めない
  const out = [];
  const broken = createLogger({ dir, stdout: { write: (line) => out.push(line) },
    fs: { ...fs, appendFileSync: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } } });
  broken.info('a');
  broken.info('b');
  assert.equal(out.filter((line) => line.includes('log-write-failed')).length, 1);
});
