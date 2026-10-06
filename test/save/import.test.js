import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { saveFileRole, decompressSav, readWorldFiles } from '../../web/js/save/import.js';
import { ZERO_GUID } from '../../web/js/save/gvas.js';
import { GvasWriter, gvasWithHeader, finishGvas } from '../helpers/gvas-writer.js';

// zlib 形式（PlZ）の .sav に包む。saveType 0x32 は 2 回圧縮
function wrap(gvas, saveType = 0x31) {
  let body = deflateSync(gvas);
  if (saveType === 0x32) body = deflateSync(body);
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  view.setUint32(0, gvas.length, true);
  view.setUint32(4, body.length, true);
  header.set([0x50, 0x6c, 0x5a, saveType], 8);
  return new Uint8Array([...header, ...body]);
}

const P1 = '00000000-0000-0000-0000-000000000001';
const BOX = '00000011-0000-0000-0000-00000000aaaa';

function levelGvas() {
  const charBlob = (fill) => {
    const w = new GvasWriter();
    w.structProps('SaveParameter', 'PalIndividualCharacterSaveParameter', fill);
    return w.none().u32(0).guid(ZERO_GUID).u32(0).toBytes();
  };
  const lv = gvasWithHeader({ className: '/Script/Pal.PalWorldSaveGame' });
  lv.structProps('worldSaveData', 'PalWorldSaveData', (ws) => {
    const chars = [
      [P1, '00000101-0000-0000-0000-00000000aaaa', charBlob((s) => s.bool('IsPlayer', true).str('NickName', 'アリス'))],
      [P1, '00000102-0000-0000-0000-00000000aaaa', charBlob((s) => {
        s.name('CharacterID', 'SheepBall').array('PassiveSkillList', 'NameProperty', ['CraftSpeed_up2']);
        s.structProps('SlotId', 'PalCharacterSlotId', (t) => {
          t.structProps('ContainerId', 'PalContainerId', (u) => u.nativeStruct('ID', 'Guid', (x) => x.guid(BOX)));
          t.int('SlotIndex', 0);
        });
      })],
    ];
    ws.map('CharacterSaveParameterMap', 'StructProperty', 'StructProperty', chars.map(([p, i, b]) => [[p, i], b]),
      (k, [p, i]) => k.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(p)).nativeStruct('InstanceId', 'Guid', (x) => x.guid(i)).str('DebugName', '').none(),
      (v, b) => v.byteArray('RawData', b).none());
  });
  return finishGvas(lv);
}

function playerGvas() {
  const pw = gvasWithHeader({ className: '/Script/Pal.PalWorldPlayerSaveGame' });
  pw.structProps('SaveData', 'PalWorldPlayerSaveData', (s) => {
    s.nativeStruct('PlayerUId', 'Guid', (x) => x.guid(P1));
    s.structProps('PalStorageContainerId', 'PalContainerId', (t) => t.nativeStruct('ID', 'Guid', (x) => x.guid(BOX)));
  });
  return finishGvas(pw);
}

test('セーブの読み込み: ファイル名から役割を決める（バックアップや別の名前は対象外）', () => {
  assert.equal(saveFileRole('Level.sav'), 'level');
  assert.equal(saveFileRole('world/LevelMeta.sav'), 'meta');
  assert.equal(saveFileRole('../GlobalPalStorage.sav'), 'global');
  assert.equal(saveFileRole('Players/00000000000000000000000000000001.sav'), 'player');
  assert.equal(saveFileRole('Players\\4DE16E79000000000000000000000000_dps.sav'), 'dps');
  assert.equal(saveFileRole('Players/savesync.sav'), '');
  assert.equal(saveFileRole('WorldOption.sav'), '');
  assert.equal(saveFileRole('00000000000000000000000000000001.sav'), '');
});

test('セーブの読み込み: zlib（1 回・2 回）の .sav を解凍し、大きさの食い違いは失敗にする', async () => {
  const gvas = levelGvas();
  assert.deepEqual(await decompressSav(wrap(gvas)), gvas);
  assert.deepEqual(await decompressSav(wrap(gvas, 0x32)), gvas);
  const broken = wrap(gvas);
  new DataView(broken.buffer).setUint32(0, gvas.length + 1, true);
  await assert.rejects(decompressSav(broken), /大きさ/);
});

test('セーブの読み込み: ワールド一式からスナップショットを作り、読めないファイルは飛ばして知らせる', async () => {
  const progress = [];
  const snapshot = await readWorldFiles([
    { path: 'Players/00000000000000000000000000000001.sav', bytes: wrap(playerGvas()) },
    { path: 'Level.sav', bytes: wrap(levelGvas()) },
    { path: 'Players/4DE16E79000000000000000000000000.sav', bytes: new Uint8Array([1, 2, 3]) },
    { path: 'WorldOption.sav', bytes: new Uint8Array(4) },
  ], { onProgress: (message) => progress.push(message) });
  assert.equal(progress[0], 'Level.sav を読み込み中…');
  assert.deepEqual(snapshot.players, [{ uid: P1, name: 'アリス', level: 1 }]);
  assert.deepEqual(snapshot.pals.map((p) => [p.characterId, p.location.kind, p.location.playerUid, p.passives]), [
    ['SheepBall', 'palbox', P1, ['CraftSpeed_up2']],
  ]);
  assert.deepEqual(snapshot.files.used, ['Level.sav', 'Players/00000000000000000000000000000001.sav']);
  assert.deepEqual(snapshot.files.skipped.map((f) => f.path), ['Players/4DE16E79000000000000000000000000.sav']);
  await assert.rejects(readWorldFiles([{ path: 'LevelMeta.sav', bytes: new Uint8Array(4) }]), /Level\.sav が見つかりません/);
  await assert.rejects(readWorldFiles([{ path: 'Level.sav', bytes: new Uint8Array(20) }]), /Level\.sav を読めませんでした/);
});

test('ホストか参加かの判定: LocalData.sav が Level.sav より 10 秒以上新しければ参加', async () => {
  const { judgeRole } = await import('../../web/js/save/source.js');
  assert.equal(judgeRole({ levelTime: 100000, localTime: 109999 }), 'host');
  assert.equal(judgeRole({ levelTime: 100000, localTime: 110000 }), 'guest');
  // 同じ保存で LocalData.sav が先に書かれることもある
  assert.equal(judgeRole({ levelTime: 100000, localTime: 82000 }), 'host');
  assert.equal(judgeRole({ levelTime: 100000 }), 'host');
  assert.equal(judgeRole({ localTime: 100000 }), 'guest');
  assert.equal(judgeRole({}), '');
});
