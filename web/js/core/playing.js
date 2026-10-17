// ゲーム中の推定（sync-fixes の host-rotation）。セーブの「変化の値」を読むたびに記録し、ゲームの保存（約 30 秒ごと。P0 の実測で
// 27.7〜30.4 秒）が続けて見えているかで決める。値は、ホストは Level.sav の中の保存時刻、参加者は LocalData.sav の更新日時（どちらもミリ秒）。
// 変化の間（gap）は見た時刻の差ではなく値の差で測る（裏のタブで確認が 60 秒ごとに遅れても、同期で更新日時が元の時刻に戻されて値が過去に
// 動いても、だまされない）。受け取る側の PC の同期の書き込みは 1 回の変化なので、「続けて 2 回」の条件で除ける（docs/sync-fixes/README.md の P0）
import { ownedSaveStamp } from './owned-shared.js';

// 変化を見た時刻が、この間の中にあるものだけを数える（2 分変化がなければ自然に外れる）
export const PLAY_WINDOW_MS = 2 * 60 * 1000;
// 続く 2 回の変化の間（値の差）がこの範囲なら、ゲームの保存が続いているとみなす
export const PLAY_GAP_MIN_MS = 20 * 1000;
export const PLAY_GAP_MAX_MS = 90 * 1000;
// 残す変化の数（判定に要るのは直近の 2 回）
const CHANGES_MAX = 3;

/** 空の記録（ワールド・役割が分からず、基準の値もない） */
export const emptyPlay = () => ({ worldId: '', role: '', value: null, changes: [] });

/** Level.sav の中の保存時刻（100 ns のティック）をミリ秒に。読めなければ NaN */
export function playTicksMs(ticks) {
  const stamp = ownedSaveStamp(ticks);
  return stamp ? Number(BigInt(stamp) / 10000n) : NaN;
}

const isRecord = (value) => Boolean(value) && typeof value === 'object' && typeof value.worldId === 'string' && typeof value.role === 'string'
  && Array.isArray(value.changes);

/**
 * 読んだ値を記録に足した新しい記録（変わらなければ同じ物）。ワールドか役割が違えば、その値を基準にして数え直す（変化には数えない。ページを
 * 開いた直後の最初の読み込みも同じ）。値が同じなら変えない。値が読めなければ、同じワールド・役割なら記録のまま、違えば基準のない空の記録。
 * @param {{ worldId: string, role: string, value: number, at: number }} seen at は見た時刻（ミリ秒）
 * @returns {{ worldId: string, role: string, value: number | null, changes: { at: number, gap: number }[] }}
 */
export function trackPlay(record, { worldId = '', role = '', value, at } = {}) {
  const base = isRecord(record) ? record : emptyPlay();
  const same = base.worldId === worldId && base.role === role;
  if (!Number.isFinite(value)) return same ? base : { ...emptyPlay(), worldId, role };
  if (!same || !Number.isFinite(base.value)) return { worldId, role, value, changes: [] };
  if (value === base.value) return base;
  const changes = [...base.changes, { at, gap: value - base.value }].slice(-CHANGES_MAX);
  return { worldId, role, value, changes };
}

/**
 * ゲーム中か。記録のワールドと役割が、今のワールドと役割（target）と同じときだけ（登録の削除・役割の変化の後の古い記録で真にしない）。
 * 見た時刻が直近 PLAY_WINDOW_MS の中にある変化のうち、続く 2 回（前の変化もその中）で、後の変化の間（値の差）が
 * PLAY_GAP_MIN_MS〜PLAY_GAP_MAX_MS のものがあれば真
 */
export function isPlaying(record, { worldId = '', role = '' } = {}, now = Date.now()) {
  if (!isRecord(record) || !worldId || !role || record.worldId !== worldId || record.role !== role) return false;
  const recent = (change) => Number.isFinite(change?.at) && now - change.at <= PLAY_WINDOW_MS;
  const changes = record.changes;
  for (let i = 1; i < changes.length; i++) {
    const gap = changes[i]?.gap;
    if (recent(changes[i - 1]) && recent(changes[i]) && gap >= PLAY_GAP_MIN_MS && gap <= PLAY_GAP_MAX_MS) return true;
  }
  return false;
}
