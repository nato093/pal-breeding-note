// ゲーム中の推定（web/js/core/playing.js。sync-fixes の host-rotation）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackPlay, isPlaying, emptyPlay, playTicksMs, PLAY_WINDOW_MS } from '../../web/js/core/playing.js';

const W = 'ABCDEF0123456789ABCDEF0123456789';
const OTHER = 'FEDCBA9876543210FEDCBA9876543210';
const HOST = { worldId: W, role: 'host' };
// 値（ファイルの中の時刻・更新日時。ミリ秒）と見た時刻を順に記録する
const track = (seen, target = HOST) => seen.reduce((record, [value, at]) => trackPlay(record, { ...target, value, at }), emptyPlay());

test('ゲーム中の推定: 最初の読み込みは基準だけ（変化に数えない）。値が同じなら記録を変えない', () => {
  const first = trackPlay(emptyPlay(), { ...HOST, value: 1_000_000, at: 10 });
  assert.deepEqual(first, { worldId: W, role: 'host', value: 1_000_000, changes: [] });
  assert.equal(trackPlay(first, { ...HOST, value: 1_000_000, at: 40_000 }), first);
  assert.equal(isPlaying(first, HOST, 10), false);
});

test('ゲーム中の推定: 1 回の変化だけではゲーム中としない。続けて 2 回（30 秒ごと）ならゲーム中', () => {
  const once = track([[0, 0], [30_000, 31_000]]);
  assert.equal(isPlaying(once, HOST, 31_000), false);
  const twice = track([[0, 0], [30_000, 31_000], [60_000, 61_000]]);
  assert.deepEqual(twice.changes, [{ at: 31_000, gap: 30_000 }, { at: 61_000, gap: 30_000 }]);
  assert.equal(isPlaying(twice, HOST, 61_000), true);
  // 間の境目（20 秒・90 秒は入る）
  assert.equal(isPlaying(track([[0, 0], [30_000, 1], [50_000, 2]]), HOST, 2), true);
  assert.equal(isPlaying(track([[0, 0], [30_000, 1], [120_000, 2]]), HOST, 2), true);
  assert.equal(isPlaying(track([[0, 0], [30_000, 1], [49_999, 2]]), HOST, 2), false);
  assert.equal(isPlaying(track([[0, 0], [30_000, 1], [120_001, 2]]), HOST, 2), false);
});

test('ゲーム中の推定: 間は見た時刻ではなく値の差で測る（裏のタブで確認が 60 秒ごとに遅れても、保存ごとに見ればゲーム中）', () => {
  // 確認は 60 秒ごと（見た時刻の差 60 秒）でも、2 回の保存の値の差が 30 秒
  const late = track([[0, 0], [30_000, 60_000], [60_000, 120_000]]);
  assert.equal(isPlaying(late, HOST, 120_000), true);
  // 確認が遅れて 2 回分の保存をまとめて見た（値の差 60 秒）も入る
  assert.equal(isPlaying(track([[0, 0], [60_000, 60_000], [120_000, 120_000]]), HOST, 120_000), true);
});

test('ゲーム中の推定: 離れた 2 回（同期の書き込み 1 回＋ずっと後の 1 回）はゲーム中としない', () => {
  // 同期でセーブが届いた（値が 3 時間進んだ）後、ずっと後にもう 1 回（値が 2 時間進んだ）
  const synced = track([[0, 0], [3 * 3600_000, 10_000], [5 * 3600_000, 70_000]]);
  assert.equal(isPlaying(synced, HOST, 70_000), false);
});

test('ゲーム中の推定: 値が過去に動いた（同期で更新日時が元の時刻に戻された）変化は、間に数えない', () => {
  const back = track([[600_000, 0], [570_000, 1_000], [540_000, 31_000]]);
  assert.deepEqual(back.changes.map((change) => change.gap), [-30_000, -30_000]);
  assert.equal(isPlaying(back, HOST, 31_000), false);
  // 戻された後に、ゲームの保存が続けて 2 回見えればゲーム中
  const resumed = trackPlay(trackPlay(back, { ...HOST, value: 570_000, at: 61_000 }), { ...HOST, value: 600_000, at: 91_000 });
  assert.equal(isPlaying(resumed, HOST, 91_000), true);
});

test('ゲーム中の推定: 2 分たって変化がなければ外れる（前の変化が 2 分より前でも外れる）', () => {
  const playing = track([[0, 0], [30_000, 30_000], [60_000, 60_000]]);
  assert.equal(isPlaying(playing, HOST, 60_000 + PLAY_WINDOW_MS - 60_000), true);
  assert.equal(isPlaying(playing, HOST, 30_000 + PLAY_WINDOW_MS), true);
  assert.equal(isPlaying(playing, HOST, 30_000 + PLAY_WINDOW_MS + 1), false);
  // 残すのは直近の 3 件。古い変化は消える
  const long = track([[0, 0], [30_000, 1], [60_000, 2], [90_000, 3], [120_000, 4]]);
  assert.deepEqual(long.changes.map((change) => change.at), [2, 3, 4]);
});

test('ゲーム中の推定: ワールドか役割が変われば、その値を基準にして数え直す。今のワールドと役割が記録と違えば偽', () => {
  const playing = track([[0, 0], [30_000, 30_000], [60_000, 60_000]]);
  assert.equal(isPlaying(playing, { worldId: OTHER, role: 'host' }, 60_000), false);
  assert.equal(isPlaying(playing, { worldId: W, role: 'guest' }, 60_000), false);
  assert.equal(isPlaying(playing, { worldId: '', role: '' }, 60_000), false);
  const other = trackPlay(playing, { worldId: OTHER, role: 'host', value: 90_000, at: 90_000 });
  assert.deepEqual(other, { worldId: OTHER, role: 'host', value: 90_000, changes: [] });
  const guest = trackPlay(playing, { worldId: W, role: 'guest', value: 90_000, at: 90_000 });
  assert.deepEqual(guest, { worldId: W, role: 'guest', value: 90_000, changes: [] });
  // 値が読めないとき: 同じワールド・役割なら記録のまま、違えば基準のない空の記録
  assert.equal(trackPlay(playing, { ...HOST, value: NaN, at: 90_000 }), playing);
  assert.deepEqual(trackPlay(playing, { worldId: OTHER, role: 'host', value: NaN, at: 90_000 }), { worldId: OTHER, role: 'host', value: null, changes: [] });
  // 記録の形が違っても落ちない
  for (const broken of [null, undefined, 'x', { worldId: W }, { worldId: W, role: 'host', changes: 'x' }]) {
    assert.equal(isPlaying(broken, HOST, 0), false);
    assert.deepEqual(trackPlay(broken, { ...HOST, value: 5, at: 0 }), { worldId: W, role: 'host', value: 5, changes: [] });
  }
});

test('ゲーム中の推定: Level.sav の中の保存時刻（100 ns のティック）をミリ秒にする（読めなければ NaN）', () => {
  assert.equal(playTicksMs('638650000000000000'), 63865000000000);
  assert.equal(playTicksMs('638650000300000000') - playTicksMs('638650000000000000'), 30_000);
  for (const value of ['', 'x', null, undefined, '0']) assert.ok(Number.isNaN(playTicksMs(value)), String(value));
});
