// 常駐の localStorage の代わり（docs/server/README.md の T5）。getItem・setItem・removeItem は同期でメモリに持ち、
// 1 秒まとめて state.json.tmp に書いてから state.json へ rename する（途中で落ちても前の state.json が残る）。
// ウイルス対策・インデックスが rename を一時的に止めることがあるので、EPERM・EBUSY は 100ms おきに 3 回やり直す。
// パスワードと全件のキャッシュ（store.js が書く <ns>.passcode・<ns>.authenticated・<ns>.cache.*）はメモリだけに置き、ファイルに書かない。
import fs from 'node:fs';
import path from 'node:path';

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAY_MS = 100;
const RETRIES = 3;

/** ファイルに書かないキーか（store.js のパスワード・ログインの印・全件のキャッシュ） */
export function volatileKey(key, namespace = 'pal-note') {
  return key === `${namespace}.passcode` || key === `${namespace}.authenticated` || key.startsWith(`${namespace}.cache.`);
}

const wait = (ms, setTimer) => new Promise((resolve) => setTimer(resolve, ms));
// 起動のときの読み込みは同期なので、やり直しの間も同期で待つ
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * @param {{ file: string, namespace?: string, delayMs?: number, fs?: object, setTimer?: Function, clearTimer?: Function,
 *   onError?: (code: string) => void, now?: () => number }} options
 *   fs は readFileSync・copyFileSync と promises（mkdir・writeFile・rename）を持つもの（テストで差し替える）。
 *   onError は書けなかったとき・壊れた state.json を見つけたとき（BROKEN_STATE）の code（文にパスを入れない）。
 *   壊れた state.json（JSON として読めない・オブジェクトでない・値が文字列でない）は写しを state.json.broken-<時刻> に残して空から始め、
 *   brokenState() で知らせる。state.json そのものは、次の書き込み（呼び出し側が止めた状態などを足した後の中身）で置き換わるまで残す
 *   （置き換わる前に終わっても、次の起動でまた壊れていると分かる）。
 *   state.json があるのに読めなければ、EPERM・EBUSY・EACCES は 100ms おきに 3 回やり直し、それでも読めなければ
 *   例外（code STATE_UNREADABLE）にする（空から始めて上書きしないため。main は想定外の終了にする）
 */
export function createKvStorage({
  file, namespace = 'pal-note', delayMs = 1000, fs: fileSystem = fs, setTimer = setTimeout, clearTimer = clearTimeout,
  onError = () => {}, now = Date.now,
}) {
  const tmp = `${file}.tmp`;
  const memory = new Map();
  let timer = null;
  let dirty = false;
  let writing = null;
  let failed = false;
  let broken = '';
  let brokenFound = false;

  // 読み込み（同期。ストアを組み立てる前に済ませる）。壊れた中身は写しを残して空から始める
  // 読めない（ENOENT 以外）ときは空から始めない（古い系統の守りの止めた状態などを上書きで失うため）。やり直しても読めなければ例外にする
  let stored = null;
  for (let attempt = 0; ; attempt++) {
    try {
      stored = fileSystem.readFileSync(file, 'utf8');
      break;
    } catch (error) {
      if (error?.code === 'ENOENT') break;
      if (!RETRY_CODES.has(error?.code) || attempt >= RETRIES) {
        throw Object.assign(new Error(`常駐の状態のファイルを読めません（${error?.code || 'ERROR'}）`), { code: 'STATE_UNREADABLE' });
      }
      sleepSync(RETRY_DELAY_MS);
    }
  }
  if (stored !== null) {
    let saved = null;
    try { saved = JSON.parse(stored); } catch { saved = null; }
    // この KV が書く形（文字列の値だけのオブジェクト）でなければ壊れている（値を黙って捨てると、止めた状態などを失ったことに気づかない）
    const valid = saved && typeof saved === 'object' && !Array.isArray(saved)
      && Object.entries(saved).every(([key, value]) => typeof value === 'string' || volatileKey(key, namespace));
    if (valid) {
      for (const [key, value] of Object.entries(saved)) {
        if (typeof value === 'string' && !volatileKey(key, namespace)) memory.set(key, value);
      }
    } else {
      brokenFound = true;
      broken = `${file}.broken-${new Date(now()).toISOString().replace(/[:.]/g, '-')}`;
      try { fileSystem.copyFileSync(file, broken); } catch { broken = ''; }
      onError('BROKEN_STATE');
    }
  }

  const serialize = () => {
    const out = {};
    for (const key of [...memory.keys()].sort()) if (!volatileKey(key, namespace)) out[key] = memory.get(key);
    return JSON.stringify(out);
  };

  async function renameWithRetry() {
    for (let attempt = 0; ; attempt++) {
      try {
        await fileSystem.promises.rename(tmp, file);
        return;
      } catch (error) {
        if (!RETRY_CODES.has(error?.code) || attempt >= RETRIES) throw error;
        await wait(RETRY_DELAY_MS, setTimer);
      }
    }
  }

  // 書けなければ dirty に戻す。続けて失敗しないよう、書き直すのは次の変更か flush のとき（1 秒ごとに同じ失敗を繰り返さない）
  async function writeNow() {
    dirty = false;
    try {
      await fileSystem.promises.mkdir(path.dirname(file), { recursive: true });
      await fileSystem.promises.writeFile(tmp, serialize(), 'utf8');
      await renameWithRetry();
      failed = false;
    } catch (error) {
      dirty = true;
      failed = true;
      onError(error?.code || 'WRITE_ERROR');
    }
  }

  // 書き込みは 1 つずつ。書いている間の変更は、終わった後にまとめて書く
  function run() {
    timer = null;
    if (writing || !dirty) return writing ?? Promise.resolve();
    writing = writeNow().finally(() => {
      writing = null;
      if (dirty && !failed && !timer) timer = setTimer(run, delayMs);
    });
    return writing;
  }

  function schedule() {
    dirty = true;
    failed = false;
    if (!timer && !writing) timer = setTimer(run, delayMs);
  }

  const storage = {
    getItem(key) {
      const value = memory.get(String(key));
      return value === undefined ? null : value;
    },
    setItem(key, value) {
      const name = String(key);
      const text = String(value);
      if (memory.get(name) === text) return;
      memory.set(name, text);
      if (!volatileKey(name, namespace)) schedule();
    },
    removeItem(key) {
      const name = String(key);
      if (!memory.has(name)) return;
      memory.delete(name);
      if (!volatileKey(name, namespace)) schedule();
    },
    /**
     * 予約中の書き込みを今すぐ済ませる（終わるときに呼ぶ）。書けなければ dirty のまま
     * @returns {Promise<boolean>} 全部を書けたか（false なら、このまま終わると書けていない変更を失う）
     */
    async flush() {
      if (writing) await writing;
      if (timer) { clearTimer(timer); timer = null; }
      if (dirty) await run();
      return !dirty;
    },
    /** 予約中の書き込みがあるか（終わるときの確認とテスト） */
    pending: () => dirty || Boolean(timer) || Boolean(writing),
    /** 壊れていた state.json の写し（なければ ''） */
    brokenFile: () => broken,
    /** 起動のときに state.json が壊れていて、空から始めたか（写しを残せなかったときも true） */
    brokenState: () => brokenFound,
  };
  return storage;
}

/** idbPersist（web/js/owned.js）と同じ形の、メモリだけの保存先（所持パルの手元のデータ・ハンドルの登録。常駐は起動のたびに読み直す） */
export function memoryPersist() {
  const map = new Map();
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, value) { map.set(key, value); },
    async remove(key) { map.delete(key); },
    async setStrict(key, value) { map.set(key, value); },
    async removeStrict(key) { map.delete(key); },
  };
}
