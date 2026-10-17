// この PC がワールドのホストか、参加しているだけかを決める。

// ホストで保存すると LocalData.sav が先に書かれ、Level.sav はその少し後に書かれる（P0 の実測で中央値 0.79 秒・最大 2.74 秒。ゲームを終えたときの
// 保存だけは LocalData.sav が最後）。その間は、LocalData.sav が前の保存の Level.sav より保存の間隔（約 30 秒。27.7〜30.4 秒）ほど新しい。
// 参加すると LocalData.sav だけが書かれるため、これより新しければ Level.sav は前にホストしたとき（か同期で受け取ったとき）の残りとみなす。
// 保存の途中の差より十分長くしてある。本物の参加では Level.sav は前のホストか同期の時刻のままなので、判定が最大約 1 分遅れるだけ。
export const GUEST_AFTER_MS = 60000;

/**
 * ワールドのフォルダの Level.sav と LocalData.sav の更新日時（ミリ秒、ないファイルは 0）から、この PC がホストか参加かを決める。
 * @returns {'host'|'guest'|''}
 */
export function judgeRole({ levelTime = 0, localTime = 0 } = {}) {
  if (!levelTime) return localTime ? 'guest' : '';
  return localTime - levelTime >= GUEST_AFTER_MS ? 'guest' : 'host';
}
