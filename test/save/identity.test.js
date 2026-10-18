// スナップショットのプレイヤーの同一性とサーバーのワールド（server の identity）。キャラクターの InstanceId・ワールドの通算の時間（clock）・
// 汎用のワールド名（Autosave_W）。解析の結果（parseLevel・parsePlayer・parseLevelMeta の形）をそのまま組んで buildSnapshot に渡す（値はダミー）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, isGenericWorldName } from '../../web/js/save/palworld.js';

const P1 = 'abcdef01-0000-0000-0000-000000000000';
const P2 = 'bbbbbbbb-0000-0000-0000-000000000000';
const P3 = 'cccccccc-0000-0000-0000-000000000000';
const P4 = 'dddddddd-0000-0000-0000-000000000000';
const IID_1 = '11111111-2222-3333-4444-555555555555';
const IID_2 = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const IID_3 = '12121212-3434-5656-7878-909090909090';

const level = (extra = {}) => ({ kind: 'level', players: [], pals: [], guilds: [], bases: [], eggs: [], ...extra });
const meta = (worldName) => ({ kind: 'levelMeta', worldName, hostPlayerName: '', inGameDay: 3, timestampTicks: null, malformed: {} });

test('スナップショットのプレイヤーの instanceId: Level のプレイヤーのキー、なければ Players/<uid>.sav の IndividualId、ギルドだけの人は空', () => {
  const snap = buildSnapshot({
    level: level({
      // P1 は Level のキャラクターに InstanceId がある。P2 は Level にいるが InstanceId が読めなかった（0 の GUID は解析で '' になる）
      players: [{ uid: P1, instanceId: IID_1, name: 'Alice', level: 50 }, { uid: P2, instanceId: '', name: 'Bob', level: 40 }],
      guilds: [{ id: 'g1', name: 'ギルド', baseIds: [], players: [{ uid: P1, name: 'Alice' }, { uid: P4, name: 'Dave' }] }],
    }),
    players: [
      // Level にもいる人の Players の sav は、Level の値を上書きしない
      { kind: 'player', uid: P1, instanceId: IID_3 },
      { kind: 'player', uid: P2, instanceId: IID_2 },
      // Players の sav だけの人
      { kind: 'player', uid: P3, instanceId: IID_3 },
    ],
  });
  assert.deepEqual(snap.players.map((player) => [player.uid, player.instanceId]), [[P1, IID_1], [P2, IID_2], [P4, ''], [P3, IID_3]]);
});

test('サーバーの汎用のワールド名（Autosave_W・Autosave_World）は名前にしない。ほかの名前はそのまま', () => {
  for (const name of ['Autosave_W', 'autosave_w', ' AUTOSAVE_WORLD ']) assert.equal(isGenericWorldName(name), true, name);
  for (const name of ['テストのワールド', 'Autosave_W2', 'My Autosave_W', '', null]) assert.equal(isGenericWorldName(name), false, String(name));
  assert.equal(buildSnapshot({ level: level(), meta: meta('Autosave_W') }).world.name, '');
  assert.equal(buildSnapshot({ level: level(), meta: meta('テストのワールド') }).world.name, 'テストのワールド');
});

test('ワールドの通算の時間（clock）: Level.sav の RealDateTimeTicks の 10 進の文字列。読めなければ空', () => {
  assert.equal(buildSnapshot({ level: level({ realDateTimeTicks: 9919376670000 }) }).world.clock, '9919376670000');
  // 2^53 を超える値は 10 進の文字列で届く。先頭の 0 は除く
  assert.equal(buildSnapshot({ level: level({ realDateTimeTicks: '12345678901234567890' }) }).world.clock, '12345678901234567890');
  assert.equal(buildSnapshot({ level: level({ realDateTimeTicks: '0099' }) }).world.clock, '99');
  // 21 桁以上・0・数でない値は読めない
  for (const value of ['123456789012345678901', null, undefined, 0, -1, 'x']) assert.equal(buildSnapshot({ level: level({ realDateTimeTicks: value }) }).world.clock, '', String(value));
});
