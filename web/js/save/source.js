// この PC がワールドのホストか、参加しているだけかを決める。

// ホストで保存すると Level.sav と LocalData.sav はほぼ同時に書かれる（実測で LocalData.sav が後になるのは 1 秒ほど）。
// 参加すると LocalData.sav だけが書かれるため、これより新しければ Level.sav は前にホストしたときの残りとみなす。
// 参加し直すにはゲームの再起動などが要るので、この間隔より短くはならない。
export const GUEST_AFTER_MS = 10000;

/**
 * ワールドのフォルダの Level.sav と LocalData.sav の更新日時（ミリ秒、ないファイルは 0）から、この PC がホストか参加かを決める。
 * @returns {'host'|'guest'|''}
 */
export function judgeRole({ levelTime = 0, localTime = 0 } = {}) {
  if (!levelTime) return localTime ? 'guest' : '';
  return localTime - levelTime >= GUEST_AFTER_MS ? 'guest' : 'host';
}
