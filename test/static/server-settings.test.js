import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOptionSettings, iniValue, iniSettings, worldOptionSettings, compareSettings, formatIniValue, replaceOptionSettings, formatRows,
} from '../../scripts/server-settings.mjs';

const SECRET_A = 'dummy-admin-pass,(x)';
const SECRET_S = 'dummy-server-pass';
const INI = [
  '[/Script/Pal.PalGameWorldSettings]',
  `OptionSettings=(ServerName="Test World",ServerPassword="${SECRET_S}",AdminPassword="${SECRET_A}",ServerPlayerMaxNum=2,`
  + 'CrossplayPlatforms=(Steam,Xbox,PS5,Mac),DeathPenalty=All,PalEggDefaultHatchingTime=72,ExpRate=1.000000,bActiveUNKO=False,'
  + 'AutoSaveSpan=30,bAutoResetGuildNoOnlinePlayers=False,DenyTechnologyList=(),BanListURL="https://example.invalid/ban.txt")',
  '',
].join('\r\n');

const WORLD = {
  OptionWorldData: {
    Settings: {
      ServerName: 'Default Palworld Server', ServerPassword: 'x', AdminPassword: 'y', ServerPlayerMaxNum: 32,
      CrossplayPlatforms: ['EPalAllowConnectPlatform::Steam', 'EPalAllowConnectPlatform::Xbox', 'EPalAllowConnectPlatform::PS5', 'EPalAllowConnectPlatform::Mac'],
      DeathPenalty: 'EPalOptionWorldDeathPenalty::Item', PalEggDefaultHatchingTime: 1, ExpRate: 1, bActiveUNKO: true,
      autoSaveSpan: 30, bAutoResetGuildNoOnlinePlayers: true, DenyTechnologyList: [], FishingDifficultyRate: 1,
      BanListURL: 'https://example.invalid/ban.txt',
    },
  },
};

test('ini の OptionSettings を、引用符と括弧の中のカンマで切らずに分ける', () => {
  const { entries } = parseOptionSettings(INI);
  assert.deepEqual(entries.map((entry) => entry.key), [
    'ServerName', 'ServerPassword', 'AdminPassword', 'ServerPlayerMaxNum', 'CrossplayPlatforms', 'DeathPenalty', 'PalEggDefaultHatchingTime',
    'ExpRate', 'bActiveUNKO', 'AutoSaveSpan', 'bAutoResetGuildNoOnlinePlayers', 'DenyTechnologyList', 'BanListURL',
  ]);
  assert.equal(entries.find((entry) => entry.key === 'CrossplayPlatforms').raw, '(Steam,Xbox,PS5,Mac)');
  assert.equal(parseOptionSettings('[x]\r\nNoSettings=1'), null);
});

test('値を比べられる形にする（文字列・真偽値・数・配列・列挙）', () => {
  assert.equal(iniValue('"a,b"'), 'a,b');
  assert.equal(iniValue('True'), true);
  assert.equal(iniValue('False'), false);
  assert.equal(iniValue('1.000000'), 1);
  assert.equal(iniValue('-1'), -1);
  assert.deepEqual(iniValue('(Steam,Xbox)'), ['Steam', 'Xbox']);
  assert.deepEqual(iniValue('()'), []);
  assert.equal(iniValue('All'), 'All');
});

test('パスワードの項目は、読んだ設定にも差にも出ない', () => {
  const server = iniSettings(INI);
  const coop = worldOptionSettings(WORLD);
  assert.ok(!Object.keys(server).some((key) => /password/i.test(key)));
  assert.ok(!Object.keys(coop).some((key) => /password/i.test(key)));
  const text = formatRows(compareSettings(coop, server));
  assert.ok(!text.includes(SECRET_A) && !text.includes(SECRET_S) && !/password/i.test(text));
});

test('差を、合わせる候補・要確認・サーバーだけの値・片方にしかない値に分ける（キーの大文字小文字は区別しない）', () => {
  const rows = compareSettings(worldOptionSettings(WORLD), iniSettings(INI));
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  assert.equal(byKey.DeathPenalty.kind, 'game');
  assert.equal(byKey.DeathPenalty.coop, 'Item');
  assert.equal(byKey.PalEggDefaultHatchingTime.kind, 'game');
  assert.equal(byKey.bActiveUNKO.kind, 'game');
  assert.equal(byKey.bAutoResetGuildNoOnlinePlayers.kind, 'review');
  assert.equal(byKey.ServerPlayerMaxNum.kind, 'server');
  assert.equal(byKey.ServerName.kind, 'server');
  assert.equal(byKey.FishingDifficultyRate.kind, 'only-coop');
  // 同じ値（数の書き方・列挙の頭・配列）は差にしない。autoSaveSpan と AutoSaveSpan は同じキー
  for (const key of ['ExpRate', 'CrossplayPlatforms', 'AutoSaveSpan', 'DenyTechnologyList', 'BanListURL']) assert.ok(!byKey[key], key);
  assert.deepEqual(rows.map((row) => row.kind).slice(0, 3), ['game', 'game', 'game']);
  // 出力ではサーバーの名前を伏せる
  assert.ok(!formatRows(rows).includes('Test World'));
});

test('書き換えは対象の Key=Value だけで、ほかは同じバイトのまま（改行・小数の桁・引用符を保つ）', () => {
  const next = replaceOptionSettings(INI, new Map([['DeathPenalty', 'Item'], ['palEggDefaultHatchingTime', 1], ['bActiveUNKO', true], ['ExpRate', 2]]));
  assert.equal(next, INI
    .replace('DeathPenalty=All', 'DeathPenalty=Item')
    .replace('PalEggDefaultHatchingTime=72', 'PalEggDefaultHatchingTime=1')
    .replace('bActiveUNKO=False', 'bActiveUNKO=True')
    .replace('ExpRate=1.000000', 'ExpRate=2.000000'));
  assert.ok(next.includes(`AdminPassword="${SECRET_A}"`));
  assert.throws(() => replaceOptionSettings(INI, { AdminPassword: 'z' }), /パスワード/);
  assert.equal(formatIniValue('x', '"old"'), '"x"');
  assert.equal(formatIniValue(['Steam'], '(Steam,Xbox)'), '(Steam)');
});

test('数は、もとの桁で書くと値が変わるときは丸めず、サーバーの float の形（6 桁）で書く（最終レビュー）', () => {
  assert.equal(formatIniValue(1.5, '1'), '1.500000');
  assert.equal(formatIniValue(0.5, '1'), '0.500000');
  assert.equal(formatIniValue(1.25, '1.0'), '1.250000');
  assert.equal(formatIniValue(0.3, '1'), '0.300000');
  // 値が変わらなければ、もとの書き方（整数・桁）を保つ。WorldOption.sav の float32 の誤差の内は同じ値とみる
  assert.equal(formatIniValue(2, '1'), '2');
  assert.equal(formatIniValue(2, '1.000000'), '2.000000');
  assert.equal(formatIniValue(Math.fround(1.2), '1.000000'), '1.200000');
  assert.equal(formatIniValue(Math.fround(1.2), '1'), '1.200000');
  assert.equal(formatIniValue(Math.fround(0.3), '1.0'), '0.3');
  // 書き換えた後に読み直すと、協力プレイの値になっている
  const next = replaceOptionSettings(INI.replace('ExpRate=1.000000', 'ExpRate=1'), { ExpRate: 1.5, PalEggDefaultHatchingTime: 0.5 });
  assert.equal(iniSettings(next).ExpRate, 1.5);
  assert.equal(iniSettings(next).PalEggDefaultHatchingTime, 0.5);
});

test('書き換えた後に読み直して、協力プレイの値と違う項目があれば書かずに止める（最終レビュー）', () => {
  // 引用符のない文字列に数の形の値を書くと、読み直すと数になる
  assert.throws(() => replaceOptionSettings(INI, { DeathPenalty: '5' }), /DeathPenalty/);
});
