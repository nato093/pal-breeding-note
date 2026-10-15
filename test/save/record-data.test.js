// 捕獲数（paldex）: Players/<uid>.sav の SaveData.RecordData の PalCaptureCount（MapProperty<NameProperty, IntProperty>）。
// 合成バイト列だけを使う（実セーブのバイトは含めない。ID・名前はダミー）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZERO_GUID } from '../../web/js/save/gvas.js';
import { parseLevel, parsePlayer, buildSnapshot } from '../../web/js/save/palworld.js';
import { normalizeOwned, ownCaptures, ownedFromShared, sharedUpload } from '../../web/js/core/owned.js';
import pals from '../../web/data/pals.js';
import passives from '../../web/data/passives.js';
import { GvasWriter, gvasWithHeader, finishGvas } from '../helpers/gvas-writer.js';

const P1 = '00000000-0000-0000-0000-000000000001';
const P2 = '00000000-0000-0000-0000-000000000002';
const C_PARTY = '00000011-0000-0000-0000-00000000cccc';
const IC_COMMON = '00000021-0000-0000-0000-00000000cccc';

// プレイヤーのキャラクター（Level.sav の CharacterSaveParameterMap）
const charBlob = (fill) => {
  const w = new GvasWriter();
  w.structProps('SaveParameter', 'PalIndividualCharacterSaveParameter', fill);
  return w.none().u32(0).guid(ZERO_GUID).u32(0).toBytes();
};
function level() {
  const lv = gvasWithHeader({ className: '/Script/Pal.PalWorldSaveGame' });
  lv.structProps('worldSaveData', 'PalWorldSaveData', (ws) => {
    const chars = [
      [P1, '00000101-0000-0000-0000-00000000cccc', charBlob((s) => s.bool('IsPlayer', true).str('NickName', 'Alice').byte('Level', 30))],
      [P2, '00000102-0000-0000-0000-00000000cccc', charBlob((s) => s.bool('IsPlayer', true).str('NickName', 'Bob').byte('Level', 20))],
      [P1, '00000103-0000-0000-0000-00000000cccc', charBlob((s) => {
        s.name('CharacterID', 'SheepBall').structProps('SlotId', 'PalCharacterSlotId', (t) => {
          t.structProps('ContainerId', 'PalContainerId', (u) => u.nativeStruct('ID', 'Guid', (x) => x.guid(C_PARTY)));
          t.int('SlotIndex', 0);
        });
      })],
    ];
    ws.map('CharacterSaveParameterMap', 'StructProperty', 'StructProperty', chars.map(([uid, instanceId, blob]) => [[uid, instanceId], blob]),
      (k, [uid, instanceId]) => k.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(uid)).nativeStruct('InstanceId', 'Guid', (x) => x.guid(instanceId)).str('DebugName', '').none(),
      (v, blob) => v.byteArray('RawData', blob).none());
  });
  return parseLevel(finishGvas(lv));
}

// プレイヤーのセーブ。record(s) が RecordData の中身を書く（省けば RecordData なし）
function player(uid, record) {
  const pw = gvasWithHeader({ className: '/Script/Pal.PalWorldPlayerSaveGame' });
  pw.structProps('SaveData', 'PalWorldPlayerSaveData', (s) => {
    s.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(uid));
    s.structProps('OtomoCharacterContainerId', 'PalContainerId', (t) => t.nativeStruct('ID', 'Guid', (x) => x.guid(C_PARTY)));
    // RecordData は所持品より前に置く（読めずに飛ばしても、後ろの項目が読めることを確かめる）
    if (record) s.structProps('RecordData', 'PalLoggedinPlayerSaveDataRecordData', record);
    s.structProps('InventoryInfo', 'PalPlayerDataInventoryInfo', (t) => t.structProps('CommonContainerId', 'PalContainerId', (u) => u.nativeStruct('ID', 'Guid', (x) => x.guid(IC_COMMON))));
  });
  return parsePlayer(finishGvas(pw));
}
const captureMap = (entries) => (s) => s.map('PalCaptureCount', 'NameProperty', 'IntProperty', entries, (k, key) => k.fstring(key), (v, value) => v.i32(value));

test('捕獲数: RecordData の PalCaptureCount を [{ id, count }] で読む（セーブのキーのまま・0 回は省く）。図鑑の登録などほかの項目は読まない', () => {
  const read = player(P1, (s) => {
    captureMap([['SheepBall', 12], ['WereWolf_Ice', 3], ['Human', 4], ['PinkCat', 0], ['BOSS_Anubis', 2], ['Anubis', 5]])(s);
    s.map('PaldeckUnlockFlag', 'NameProperty', 'BoolProperty', [['SheepBall', true]], (k, key) => k.fstring(key), (v, value) => v.u8(value ? 1 : 0));
    s.int('SomethingElse', 7);
  });
  assert.deepEqual(read.captures, [
    { id: 'SheepBall', count: 12 }, { id: 'WereWolf_Ice', count: 3 }, { id: 'Human', count: 4 }, { id: 'BOSS_Anubis', count: 2 }, { id: 'Anubis', count: 5 },
  ]);
  assert.deepEqual(read.malformed, {});
  assert.deepEqual(read.inventoryContainers, { Common: IC_COMMON });
  // 中身が空の記録は「捕まえていない」（[]）
  assert.deepEqual(player(P1, captureMap([])).captures, []);
});

test('捕獲数: RecordData がない・PalCaptureCount がない・形が違う（値が真偽・数でない）なら null（分からない）。壊れていても所持パルの取り込みは続く', () => {
  assert.equal(player(P1).captures, null);
  assert.equal(player(P1, (s) => s.int('Other', 1)).captures, null);
  // 値が IntProperty でない（Map<Name, Bool>）・Map でない（IntProperty）
  assert.equal(player(P1, (s) => s.map('PalCaptureCount', 'NameProperty', 'BoolProperty', [['SheepBall', true]], (k, key) => k.fstring(key), (v, value) => v.u8(value ? 1 : 0))).captures, null);
  assert.equal(player(P1, (s) => s.int('PalCaptureCount', 3)).captures, null);
  // 壊れた Map（要素の数がデータより多い）: 回復して飛ばし、malformed に数える。後ろの所持品の入れ物は読める
  const broken = player(P1, (s) => s.tag('PalCaptureCount', 'MapProperty', (w) => w.fstring('NameProperty').fstring('IntProperty'), (w) => w.u32(0).u32(999999)));
  assert.equal(broken.captures, null);
  assert.deepEqual(broken.malformed, { properties: 1 });
  assert.deepEqual(broken.inventoryContainers, { Common: IC_COMMON });
  const snap = buildSnapshot({ level: level(), players: [broken] });
  assert.equal(snap.pals.length, 1);
  assert.equal('captures' in snap.players.find((p) => p.uid === P1), false);
  assert.deepEqual(snap.stats.malformed, { 'player.properties': 1 });
});

test('捕獲数: スナップショットは読めたプレイヤーだけに captures。画面の形はパル ID ごとの回数（大文字小文字・BOSS_ をそろえて合わせ、人間は捨てる）', () => {
  const snap = buildSnapshot({
    level: level(),
    players: [player(P1, captureMap([['SheepBall', 12], ['werewolf_ice', 3], ['Human', 4], ['BOSS_Anubis', 2], ['Anubis', 5]])), player(P2)],
  });
  assert.deepEqual(snap.players.map((p) => [p.name, p.captures ?? null]), [
    ['Alice', [{ id: 'SheepBall', count: 12 }, { id: 'werewolf_ice', count: 3 }, { id: 'Human', count: 4 }, { id: 'BOSS_Anubis', count: 2 }, { id: 'Anubis', count: 5 }]],
    ['Bob', null],
  ]);
  assert.doesNotThrow(() => structuredClone(snap));
  const owned = normalizeOwned(snap, { pals, passives });
  const alice = owned.players.find((p) => p.uid === P1);
  assert.deepEqual(alice.captures, { SheepBall: 12, Werewolf_Ice: 3, Anubis: 7 });
  assert.equal('captures' in owned.players.find((p) => p.uid === P2), false);
  // 自分の分（ideals の selfUids）だけを合わせる。自分が分からない・捕獲数のないプレイヤーだけなら null
  assert.deepEqual([...ownCaptures(owned.players, new Set([P1]))], [['SheepBall', 12], ['Werewolf_Ice', 3], ['Anubis', 7]]);
  assert.equal(ownCaptures(owned.players, new Set()), null);
  assert.equal(ownCaptures(owned.players, new Set([P2])), null);
  // 形の違う値（壊れた値）: 配列でない・空でないのに形の合う項目が 1 つもないものは分からない（null。「捕獲 0 回」と区別する）。
  // 混ざっていれば形の合う項目だけ。空の配列は「捕まえていない」
  const P3 = '00000000-0000-0000-0000-000000000003';
  const P4 = '00000000-0000-0000-0000-000000000004';
  const odd = normalizeOwned({ ...snap, players: [
    { uid: P1, name: 'Alice', captures: 'x' },
    { uid: P2, name: 'Bob', captures: [{ id: 3, count: 1 }, { id: 'PinkCat', count: -2 }, null, { id: 'PinkCat', count: 4 }, { id: 'SheepBall', count: 1.5 }] },
    { uid: P3, name: 'Carol', captures: [{ id: 'SheepBall', count: 'broken' }, null] },
    { uid: P4, name: 'Dave', captures: [] },
  ] }, { pals, passives });
  assert.deepEqual(odd.players.map((p) => p.captures ?? null), [null, { PinkCat: 4 }, null, {}]);
  assert.equal(ownCaptures(odd.players, new Set([P3])), null);
  assert.deepEqual([...ownCaptures(odd.players, new Set([P4]))], []);
});

test('捕獲数は共有しない: 送る形（sharedUpload）に入れず、共有から作る画面のデータ（ownedFromShared）にもない', () => {
  const snap = buildSnapshot({ level: level(), players: [player(P1, captureMap([['SheepBall', 12]]))] });
  const owned = normalizeOwned(snap, { pals, passives });
  const upload = sharedUpload(owned);
  assert.doesNotMatch(JSON.stringify(upload), /captures|SheepBall"?:\s*12/);
  // 捕獲数を足して送る画面があっても、共有から作るデータには入れない
  const shared = ownedFromShared({ world: { players: upload.players.map((p) => ({ ...p, captures: { SheepBall: 12 } })), bases: [] }, rows: [] }, { pals, passives });
  assert.deepEqual(shared.players.map((p) => p.uid), [P1, P2]);
  assert.equal(shared.players.some((p) => 'captures' in p), false);
  assert.equal(ownCaptures(shared.players, new Set([P1])), null);
});
