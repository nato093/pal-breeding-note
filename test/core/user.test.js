import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUserId } from '../../web/js/core/user.js';
import { createGas } from '../gas/harness.js';

for (const [value, accepted] of [
  ['あ'.repeat(20), true], ['あ'.repeat(21), false],
  ['😀'.repeat(10), true], ['😀'.repeat(11), false],
  [`${'😀'.repeat(9)}ああ`, true], [`${'😀'.repeat(10)}あ`, false],
  [` \u0000${'😀'.repeat(10)}\u007f `, true],
]) {
  test(`ID検証: UTF-16 の長さでブラウザーと GAS が同じ境界を判定する ${JSON.stringify(value)}`, () => {
    const checked = validateUserId(value);
    assert.equal(checked.ok, accepted);
    if (accepted) assert.ok(checked.value.length <= 20);
    else assert.deepEqual(checked.errors, [{ field: 'userId', code: 'TOO_LONG' }]);
    const { gas } = createGas();
    assert.deepEqual(JSON.parse(JSON.stringify(gas.validateUserId(value))), checked);
  });
}
