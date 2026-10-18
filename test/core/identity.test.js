// プレイヤーの同一性（server の identity。docs/server/README.md の「テーマ間の取り決め」と T1）。プレイヤーの鍵（i:・u:）、
// ワールドにいない UID（以前の持ち主）、HOST_UID の決め打ちを H がいるワールドに限ること、このワールドでの自分の引き方、登録者の決め方。
// 値はダミー（H は協力プレイのホストの枠の決まった値）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import {
  HOST_UID, playerGuid, playerMapKey, playerKeyOf, legacyPlayerKey, playerUidOfKey, hostIsPlayer, formerLabel, shortUid,
  cleanOwnedPlayer, validateOwnedUpload,
} from '../../web/js/core/owned-shared.js';
import { normalizeOwned, sharedUpload, ownedFromShared, shortUid as ownedShortUid } from '../../web/js/core/owned.js';
import { cleanSharedPlayers } from '../../web/js/core/boundary.js';
import { ownPlayerUids, palsOfPlayers } from '../../web/js/core/ideal-goals.js';
import { resolveRegistrant } from '../../web/js/core/auto-breeding.js';

const H = HOST_UID;
// サーバーに変換した後の作成者の UID（ダミー）・仲間の UID・ワールドにいない別の UID
const U = 'abcdef01-0000-0000-0000-000000000000';
const B = 'bbbbbbbb-0000-0000-0000-000000000000';
const X = '12345678-0000-0000-0000-000000000000';
// キャラクターの InstanceId（往復しても変わらない）
const IID_A = '11111111-2222-3333-4444-555555555555';
const IID_B = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const ZERO = '00000000-0000-0000-0000-000000000000';
const WORLD = 'ABCDEF0123456789ABCDEF0123456789';

test('プレイヤーの鍵: GUID の検査・鍵の検査（i: は GUID、u: は英数字とハイフン 40 字まで。小文字にそろえる）', () => {
  assert.equal(HOST_UID, '00000000-0000-0000-0000-000000000001');
  assert.equal(playerGuid(IID_A.toUpperCase()), IID_A);
  assert.equal(playerGuid(` ${IID_A} `), IID_A);
  for (const bad of [ZERO, '1111-2222', `${IID_A}0`, IID_A.replace(/-/g, ''), null, 7, {}]) assert.equal(playerGuid(bad), '', String(bad));
  assert.equal(playerMapKey(`I:${IID_A.toUpperCase()}`), `i:${IID_A}`);
  assert.equal(playerMapKey(`u:${U.toUpperCase()}`), `u:${U}`);
  // プレフィックスのない UID・形の違う鍵は ''
  for (const bad of [U, `i:${ZERO}`, 'i:abc', `u:${'a'.repeat(41)}`, 'u:', 'u:a b', `x:${IID_A}`, '', null]) assert.equal(playerMapKey(bad), '', String(bad));
});

test('プレイヤーの鍵: playerKeyOf は InstanceId があれば i:、なければ u:uid。前の版の UID は legacyPlayerKey で u: に読み替える', () => {
  assert.equal(playerKeyOf({ uid: U, instanceId: IID_A.toUpperCase() }), `i:${IID_A}`);
  assert.equal(playerKeyOf({ uid: U.toUpperCase() }), `u:${U}`);
  assert.equal(playerKeyOf({ uid: U, instanceId: 'x' }), `u:${U}`);
  assert.equal(playerKeyOf({ uid: '', instanceId: '' }), '');
  assert.equal(playerKeyOf(null), '');
  assert.equal(legacyPlayerKey(U.toUpperCase()), `u:${U}`);
  assert.equal(legacyPlayerKey(`i:${IID_A}`), `i:${IID_A}`);
  assert.equal(legacyPlayerKey(`u:${U}`), `u:${U}`);
  for (const bad of ['<script>', 'f'.repeat(41), 'i:bad', '', undefined]) assert.equal(legacyPlayerKey(bad), '', String(bad));
});

test('プレイヤーの鍵: playerUidOfKey はその回のプレイヤーの uid に引く（i: は InstanceId、u: と前の版の UID は uid。大文字小文字は問わない）', () => {
  // 協力プレイ（作成者は H）とサーバー（作成者は U）で、同じキャラクターの鍵が同じ人に引ける
  const coop = [{ uid: H, name: 'Alice', instanceId: IID_A }, { uid: B, name: 'Bob', instanceId: IID_B }];
  const server = [{ uid: U, name: 'Alice', instanceId: IID_A }, { uid: B, name: 'Bob', instanceId: IID_B }];
  assert.equal(playerUidOfKey(coop, `i:${IID_A}`), H);
  assert.equal(playerUidOfKey(server, `i:${IID_A}`), U);
  assert.equal(playerUidOfKey(server, `I:${IID_B.toUpperCase()}`), B);
  assert.equal(playerUidOfKey(server, `u:${B.toUpperCase()}`), B);
  assert.equal(playerUidOfKey(server, B), B);
  // プレイヤーにいない・形の違う値・プレイヤーの配列がない
  assert.equal(playerUidOfKey(server, `u:${H}`), '');
  assert.equal(playerUidOfKey(server, `i:${IID_A.replace('1111', '9999')}`), '');
  assert.equal(playerUidOfKey(server, 'bad key!'), '');
  assert.equal(playerUidOfKey(null, `u:${B}`), '');
});

test('以前の持ち主: H がプレイヤーにいるかは配列でも Map でも見る。表示名は H なら「以前のホスト」、ほかは「不明なプレイヤー（頭 8 字）」', () => {
  assert.equal(hostIsPlayer([{ uid: H }]), true);
  assert.equal(hostIsPlayer([{ uid: U }, null]), false);
  assert.equal(hostIsPlayer(new Map([[H, { uid: H }]])), true);
  assert.equal(hostIsPlayer(new Map()), false);
  assert.equal(hostIsPlayer(null), false);
  assert.equal(formerLabel(H), '以前のホスト');
  assert.equal(formerLabel(X), '不明なプレイヤー（12345678）');
  // UID の頭 8 字は core/owned.js からも同じものを読める
  assert.equal(ownedShortUid, shortUid);
});

test('共有のプレイヤー: instanceId は GUID の形のときだけ小文字で写す（GAS の cleanOwnedPlayer と画面の cleanSharedPlayers で同じ）', () => {
  const input = [
    { uid: U, name: 'Alice', instanceId: IID_A.toUpperCase() },
    { uid: B, name: 'Bob', instanceId: 'not-a-guid' },
    { uid: X, name: 'Carol', instanceId: ZERO },
    { uid: H, name: 'Dave' },
  ];
  const gas = input.map(cleanOwnedPlayer);
  const page = cleanSharedPlayers(input);
  assert.deepEqual(gas.map((player) => player.instanceId), [IID_A, undefined, undefined, undefined]);
  assert.deepEqual(page, gas);
});

// サーバーのワールド（H はプレイヤーにいない。拠点・観賞用ケージの個体と牧場の親に、以前のホストの H と不明な X が残る）
const pal = (instanceId, location, lastOwnerUid = '') => ({
  instanceId, source: 'level', characterId: 'SheepBall', nickname: '', gender: 'Female', level: 10, rank: 1, passives: [],
  talent: { hp: 1, shot: 2, defense: 3 }, isRare: false, ownerUid: '', lastOwnerUid,
  location: { kind: 'palbox', playerUid: '', baseId: 'base-1', containerId: '', slotIndex: 0, mapObjectId: '', itemId: '', position: null, ...location },
});
const parent = (instanceId, depositorUid) => ({ instanceId, characterId: 'SheepBall', gender: 'Male', depositorUid });
const serverSnapshot = {
  version: 1,
  world: { name: '', hostName: '' },
  players: [{ uid: U, name: 'Alice', level: 50, instanceId: IID_A.toUpperCase() }, { uid: B, name: 'Bob', level: 40, instanceId: IID_B }],
  bases: [{ id: 'base-1', number: 1, guildId: '', containerId: '', position: null }],
  pals: [
    pal('h1', { kind: 'base' }, H), pal('h2', { kind: 'base' }, H), pal('h3', { kind: 'display' }, H),
    // パルボックスの最後の持ち主は数えない（所有の判定に使わない）
    pal('h4', { kind: 'palbox', playerUid: U }, H),
    pal('x1', { kind: 'base' }, X), pal('u1', { kind: 'base' }, U), pal('g1', { kind: 'global' }),
  ],
  breedFarms: [
    { id: 'F1', baseId: 'base-1', status: 'ok', parents: [parent('h1', H), parent('h2', H)], eggs: [] },
    { id: 'F2', baseId: 'base-1', status: 'ok', parents: [parent('h3', H), parent('u1', U)], eggs: [] },
    { id: 'F3', baseId: 'base-1', status: 'uncertain', parents: [parent('x1', X)], eggs: [] },
  ],
  stats: {},
};
// 同じワールドの協力プレイ（作成者は H のプレイヤー。仲間がホストだった間に作成者が預けた個体に U が残る）
const coopSnapshot = {
  ...serverSnapshot,
  world: { name: 'テスト', hostName: 'Alice' },
  players: [{ uid: H, name: 'Alice', level: 50, instanceId: IID_A }, { uid: B, name: 'Bob', level: 40, instanceId: IID_B }],
  pals: [pal('h1', { kind: 'base' }, H), pal('u1', { kind: 'base' }, U), pal('g1', { kind: 'global' })],
  breedFarms: [],
};

test('以前の持ち主: normalizeOwned の formers は拠点・観賞用ケージの預けた人と牧場の親を預けた人のうち、プレイヤーにいない UID ごと（H を先、残りは UID の順）', () => {
  const server = normalizeOwned(serverSnapshot, { pals, passives });
  assert.deepEqual(server.formers, [
    { uid: H, kind: 'host', pals: 3, farms: 2 },
    { uid: X, kind: 'unknown', pals: 1, farms: 1 },
  ]);
  // 協力プレイ: H はプレイヤーなので以前の持ち主ではない。U は不明なプレイヤー
  assert.deepEqual(normalizeOwned(coopSnapshot, { pals, passives }).formers, [{ uid: U, kind: 'unknown', pals: 1, farms: 0 }]);
  // 牧場を読む前の古いスナップショット・以前の持ち主のいないワールドは空
  assert.deepEqual(normalizeOwned({ ...coopSnapshot, pals: [], breedFarms: undefined }, { pals, passives }).formers, []);
  // 共有の行からは分からない
  assert.equal(ownedFromShared({ world: {}, rows: [] }, { pals, passives }).formers, null);
});

test('以前の持ち主: H がいないワールドの預けた人は「以前のホスト」、H がいる協力プレイは今までどおりホストの名前。グローバルパルボックスの所持者に H の名前を使うのは H がいるワールドだけ', () => {
  const byId = (data) => Object.fromEntries(data.pals.map((item) => [item.id, item]));
  const server = byId(normalizeOwned(serverSnapshot, { pals, passives }));
  assert.equal(server.h1.lastOwner, '以前のホスト');
  assert.equal(server.h3.lastOwner, '以前のホスト');
  assert.equal(server.x1.lastOwner, '不明なプレイヤー（12345678）');
  assert.equal(server.u1.lastOwner, 'Alice');
  assert.equal(server.g1.holder, 'ホスト');
  assert.equal(byId(normalizeOwned({ ...serverSnapshot, world: { hostName: 'Bob' } }, { pals, passives })).g1.holder, 'Bob');
  const coop = byId(normalizeOwned(coopSnapshot, { pals, passives }));
  assert.equal(coop.h1.lastOwner, 'Alice');
  assert.equal(coop.u1.lastOwner, '不明なプレイヤー（ABCDEF01）');
  assert.equal(coop.g1.holder, 'Alice');
});

test('プレイヤーの InstanceId: normalizeOwned → sharedUpload → validateOwnedUpload → ownedFromShared で往復する（形の違う値は付けない）', () => {
  const owned = normalizeOwned({ ...serverSnapshot, players: [...serverSnapshot.players, { uid: X, name: 'Carol', instanceId: ZERO }] }, { pals, passives });
  assert.deepEqual(owned.players.map((player) => player.instanceId), [IID_A, IID_B, undefined]);
  const upload = sharedUpload(owned);
  assert.deepEqual(upload.players.map((player) => player.instanceId), [IID_A, IID_B, undefined]);
  const checked = validateOwnedUpload({ worldId: WORLD, saveUpdatedAt: '2026-10-18T00:00:00.000Z', world: { name: 'テスト' }, ...upload });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value.players.map((player) => player.instanceId), [IID_A, IID_B, undefined]);
  const shared = ownedFromShared({ world: { worldName: 'テスト', players: checked.value.players }, columns: upload.columns, rows: checked.value.rows }, { pals, passives });
  assert.deepEqual(shared.players.map((player) => [player.uid, player.instanceId]), [[U, IID_A], [B, IID_B], [X, undefined]]);
  // 共有の lastOwner の列に「以前のホスト」が載る
  assert.equal(shared.pals.find((item) => item.id === 'h1').lastOwner, '以前のホスト');
  // InstanceId を知らない古い共有は今までどおり（鍵ごと付かない）
  assert.equal('instanceId' in ownedFromShared({ world: { players: [{ uid: U, name: 'Alice' }] }, rows: [] }, { pals, passives }).players[0], false);
});

test('このワールドでの自分: self は鍵（i:・u:・前の版の UID）で受け、その回のプレイヤーに引く。往復で UID が変わっても同じキャラクター', () => {
  const users = ['Alice', 'Bob', 'Carol'];
  const coop = [{ uid: H, name: 'Alice', instanceId: IID_A }, { uid: B, name: 'Bob', instanceId: IID_B }];
  const server = [{ uid: U, name: 'Alice', instanceId: IID_A }, { uid: B, name: 'Bob', instanceId: IID_B }];
  const own = (players, identity) => [...ownPlayerUids(players, { userId: 'Carol', users, ...identity })];
  assert.deepEqual(own(coop, { self: `i:${IID_A}` }), [H]);
  assert.deepEqual(own(server, { self: `i:${IID_A}` }), [U]);
  assert.deepEqual(own(server, { self: `u:${B}` }), [B]);
  // 前の版の UID（self でも selfUid でも）
  assert.deepEqual(own(server, { self: B }), [B]);
  assert.deepEqual(own(server, { selfUid: B }), [B]);
  // 引けない値（サーバーの u:H）は今の規則（対応・同じ名前）に戻る
  assert.deepEqual(own(server, { self: `u:${H}` }), []);
  assert.deepEqual([...ownPlayerUids(server, { userId: 'Bob', users, self: `u:${H}` })], [B]);
});

test('このワールドでの自分: 自分が決まったときだけ、プレイヤーにいない UID のうち対応で自分の ID を選んだもの（以前のホストなど）を足す', () => {
  const users = ['Alice', 'Bob', 'Carol'];
  const server = [{ uid: U, name: 'Alice', instanceId: IID_A }, { uid: B, name: 'Bob', instanceId: IID_B }];
  // 同じ名前で自分が決まる → 以前のホスト（H）を足す。別の人に対応づけた X は足さない
  assert.deepEqual([...ownPlayerUids(server, { userId: 'alice', users, mapping: { [H]: 'Alice', [X]: 'Bob' } })], [U, H]);
  // このワールドでの自分で決まっても足す
  assert.deepEqual([...ownPlayerUids(server, { userId: 'Alice', users, self: `i:${IID_A}`, mapping: { [H]: 'ALICE' } })], [U, H]);
  // 自分が 1 人も決まらないときは足さない（Carol はプレイヤーにいない）
  assert.deepEqual([...ownPlayerUids(server, { userId: 'Carol', users, mapping: { [H]: 'Carol' } })], []);
  // ノートにない ID・空の対応は足さない
  assert.deepEqual([...ownPlayerUids(server, { userId: 'Alice', users, mapping: { [H]: '退会した人', [X]: '' } })], [U]);
  // 協力プレイ（H がプレイヤー）は今までどおり、H の対応はプレイヤーの規則で効く
  const coop = [{ uid: H, name: 'Host', instanceId: IID_A }, { uid: B, name: 'Bob', instanceId: IID_B }];
  assert.deepEqual([...ownPlayerUids(coop, { userId: 'Alice', users, mapping: { [H]: 'Alice' } })], [H]);
});

test('自分の個体: グローバルパルボックスは H がプレイヤーにいるワールドだけ。以前の持ち主は共有のデータでも表示名で数える', () => {
  const pal = (id, extra) => ({ id, palId: 'X', egg: false, holderUid: '', lastOwnerUid: '', lastOwner: '', place: 'palbox', ...extra });
  const items = [
    pal('baseH', { place: 'base', lastOwnerUid: H }), pal('displayH', { place: 'display', lastOwnerUid: H }),
    pal('baseX', { place: 'base', lastOwnerUid: X }), pal('global', { place: 'global' }), pal('mine', { holderUid: U }),
  ];
  const ids = (data, uids) => palsOfPlayers(data, new Set(uids)).map((item) => item.id);
  // サーバー: 以前のホストを自分に対応づけて uids に H があっても、グローバルパルボックスは数えない
  const server = [{ uid: U, name: 'Alice' }, { uid: B, name: 'Bob' }];
  assert.deepEqual(ids({ players: server, pals: items }, [U, H]), ['baseH', 'displayH', 'mine']);
  // 協力プレイ: H がプレイヤーならホストのグローバルパルボックス
  const coop = [{ uid: H, name: 'Alice' }, { uid: B, name: 'Bob' }];
  assert.deepEqual(ids({ players: coop, pals: items }, [H]), ['baseH', 'displayH', 'global']);
  // 共有のデータ（預けた人の UID がなく、送った側の表示名だけ）
  const shared = [
    pal('sharedH', { place: 'base', lastOwner: '以前のホスト' }), pal('sharedX', { place: 'base', lastOwner: '不明なプレイヤー（12345678）' }),
    pal('sharedOld', { place: 'base', lastOwner: '不明なプレイヤー（00000000）' }),
  ];
  assert.deepEqual(ids({ players: server, pals: shared }, [U, H]), ['sharedH']);
  assert.deepEqual(ids({ players: server, pals: shared }, [U, H, X]), ['sharedH', 'sharedX']);
  // 同じ名前のプレイヤーがいれば、どちらか分からないので数えない
  assert.deepEqual(ids({ players: [...server, { uid: 'p9', name: '以前のホスト' }], pals: shared }, [U, H]), []);
});

test('登録者: 2 体の預けた人の UID が違っても、どちらも同じユーザーに対応していればそのユーザー（以前のホストと作成者の今の UID など）', () => {
  const candidate = (...pairs) => ({ evidence: pairs.map((depositorUids) => ({ farmId: 'f', eggLocalId: 'e', depositorUids })) });
  const players = [{ uid: U, name: 'Alice' }, { uid: B, name: 'Bob' }];
  const users = ['Alice', 'Bob', 'me'];
  const opts = { players, users, mapping: { [H]: 'alice' }, currentUserId: 'me' };
  // 親 2 体とも以前のホスト → 対応のユーザー
  assert.deepEqual(resolveRegistrant(candidate([H, H]), opts), { userId: 'Alice' });
  // 以前のホスト（対応）と U（同じ名前）→ どちらも Alice
  assert.deepEqual(resolveRegistrant(candidate([H, U]), opts), { userId: 'Alice' });
  assert.deepEqual(resolveRegistrant(candidate([H, H], [U, U], [U, H]), opts), { userId: 'Alice' });
  // 対応が違う人・分からない人と組んだときはログイン中のユーザー
  assert.deepEqual(resolveRegistrant(candidate([H, B]), opts), { userId: 'me' });
  assert.deepEqual(resolveRegistrant(candidate([H, '']), opts), { userId: 'me' });
  assert.deepEqual(resolveRegistrant(candidate([H, H], [B, B]), opts), { userId: 'me' });
  // 以前のホストの対応がなければ、2 体とも H の牧場は未設定、H と U はログイン中のユーザー
  const unmapped = { ...opts, mapping: {} };
  assert.deepEqual(resolveRegistrant(candidate([H, H]), unmapped), { unmapped: H });
  assert.deepEqual(resolveRegistrant(candidate([H, U]), unmapped), { userId: 'me' });
});
