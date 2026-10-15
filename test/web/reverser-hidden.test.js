import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReverserHidden, reverserTarget, cleanReverserHidden, REVERSER_HIDDEN_MAX } from '../../web/js/reverser-hidden.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    failing: false,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      if (this.failing) throw new Error('QuotaExceededError');
      values.set(key, String(value));
    },
    removeItem(key) {
      if (this.failing) throw new Error('QuotaExceededError');
      values.delete(key);
    },
  };
}

test('パルリバーサーの案内を消した目標: 見分け方は種族＋欲しいパッシブ（順不同）＋個体値の目標で、形の合わない値は空', () => {
  assert.equal(reverserTarget('SheepBall', ['Rare', 'CraftSpeed_up2'], [100, 0, 90]), '["SheepBall",["CraftSpeed_up2","Rare"],[100,0,90]]');
  // パッシブの順が違っても同じ目標
  assert.equal(reverserTarget('SheepBall', ['CraftSpeed_up2', 'Rare'], [100, 0, 90]), reverserTarget('SheepBall', ['Rare', 'CraftSpeed_up2'], [100, 0, 90]));
  assert.equal(reverserTarget('SheepBall', [], [0, 0, 0]), '["SheepBall",[],[0,0,0]]');
  // 種族・パッシブの ID の形、パッシブ 5 個以上、個体値の範囲・整数でない・数の違い
  for (const [palId, passives, talents] of [
    ['', [], [0, 0, 0]], ['Sheep Ball', [], [0, 0, 0]], ['SheepBall', ['a-b'], [0, 0, 0]], ['SheepBall', ['A', 'B', 'C', 'D', 'E'], [0, 0, 0]],
    ['SheepBall', [], [101, 0, 0]], ['SheepBall', [], [-1, 0, 0]], ['SheepBall', [], [1.5, 0, 0]], ['SheepBall', [], [0, 0]], ['SheepBall', 'Rare', [0, 0, 0]],
  ]) {
    assert.equal(reverserTarget(palId, passives, talents), '', JSON.stringify([palId, passives, talents]));
  }
});

test('パルリバーサーの案内を消した目標: 読み戻しは配列だけ・形の合う項目だけ（並べ直した・空白を入れたものは捨てる）・重なりは前の方・200 件まで', () => {
  const ok = reverserTarget('SheepBall', ['Rare'], [100, 100, 100]);
  assert.deepEqual(cleanReverserHidden({ a: ok }), []);
  assert.deepEqual(cleanReverserHidden('壊れた'), []);
  assert.deepEqual(cleanReverserHidden([ok, ok, 1, null, '{壊れた', '["SheepBall",["Rare"],[100,100,100]', '["SheepBall", ["Rare"], [100,100,100]]',
    '["SheepBall",["Rare","Noukin"],[100,100,100]]', '["SheepBall",["Rare"],[100,100,101]]', 'x'.repeat(600)]), [ok]);
  const many = Array.from({ length: 250 }, (_, i) => reverserTarget('SheepBall', [], [i % 101, Math.floor(i / 101), 0]));
  assert.equal(cleanReverserHidden(many).length, REVERSER_HIDDEN_MAX);
});

test('パルリバーサーの案内を消した目標: 環境・ID ごとの別のキーに新しい順で持ち、1 件戻す・全部戻す。ログインの前と書けない端末では開いている間だけ覚える', () => {
  const storage = memoryStorage();
  const hidden = createReverserHidden({ storage, namespace: 'ns' });
  const a = reverserTarget('SheepBall', ['Rare'], [100, 100, 100]);
  const b = reverserTarget('SheepBall', ['Rare'], [90, 100, 100]);
  assert.equal(hidden.key('test', 'Taro'), 'ns.reverserHidden.test.taro');
  assert.equal(hidden.key('', 'Taro'), '');
  hidden.hide('test', 'Taro', a);
  hidden.hide('test', 'Taro', b);
  hidden.hide('test', 'Taro', a);
  assert.deepEqual(hidden.list('test', 'Taro'), [a, b]);
  assert.deepEqual(JSON.parse(storage.values.get('ns.reverserHidden.test.taro')), [a, b]);
  assert.equal(hidden.has('test', 'TARO', b), true);
  // 別の環境・別の人には効かない
  assert.equal(hidden.has('prod', 'Taro', a), false);
  assert.equal(hidden.has('test', 'Jiro', a), false);
  hidden.show('test', 'Taro', a);
  assert.deepEqual(hidden.list('test', 'Taro'), [b]);
  hidden.clear('test', 'Taro');
  assert.deepEqual(hidden.list('test', 'Taro'), []);
  assert.equal(storage.values.has('ns.reverserHidden.test.taro'), false);
  // 200 件を超えたら古いものから捨てる
  for (let i = 0; i < 205; i++) hidden.hide('test', 'Taro', reverserTarget('SheepBall', [], [i % 101, Math.floor(i / 101), 0]));
  assert.equal(hidden.list('test', 'Taro').length, REVERSER_HIDDEN_MAX);
  assert.equal(hidden.list('test', 'Taro')[0], reverserTarget('SheepBall', [], [204 % 101, 2, 0]));
  // 書けない端末: 開いている間は覚え、書けるようになったら端末に書く
  storage.failing = true;
  hidden.hide('test', 'Hanako', a);
  assert.deepEqual(hidden.list('test', 'Hanako'), [a]);
  assert.equal(storage.values.has('ns.reverserHidden.test.hanako'), false);
  storage.failing = false;
  hidden.hide('test', 'Hanako', b);
  assert.deepEqual(JSON.parse(storage.values.get('ns.reverserHidden.test.hanako')), [b, a]);
  // ログインの前（ID がない）
  hidden.hide('test', '', a);
  assert.equal(hidden.has('test', '', a), true);
  // 端末のストレージがない
  const none = createReverserHidden({ storage: null });
  none.hide('test', 'Taro', a);
  assert.equal(none.has('test', 'Taro', a), true);
  // 読めない端末（getItem が投げる）は空として扱う
  const throwing = createReverserHidden({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} } });
  assert.deepEqual(throwing.list('test', 'Taro'), []);
});
