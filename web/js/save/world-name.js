// ワールドの名前の扱い。セーブの解析（palworld.js。Worker で動く）と所持パルの状態（owned.js。画面で動く）の両方が使うので、
// 解析の本体を画面に読み込まないよう分けてある（server の identity）

/**
 * サーバー（ServerSync）が保存したときの汎用のワールド名（Autosave_W・Autosave_World。大文字小文字は問わない）か。
 * サーバーの LevelMeta.sav はゲーム内のワールド名の代わりにこの名前になる。名前としては使わない
 */
export function isGenericWorldName(name) {
  return /^autosave_w(orld)?$/i.test(String(name ?? '').trim());
}
