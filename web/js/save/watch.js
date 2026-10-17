// セーブのファイルの見張り（sync-fixes の save-watch）。ゲームが保存したら、一式を書き終えたところで画面に知らせる。
// - Worker の中（createSaveWatcher）: FileSystemObserver を第一に、落ちたファイルは 5 秒ごとの getFile() の確認で拾う。変化はワールドごとに
//   まとめ、最後の変化から quietMs（ホストのワールドは Level.sav が変わってから数える）か、最初の変化から maxWaitMs で settled を送る
// - 画面のスレッド（createWatchClient）: Worker を作り、見張る対象を世代番号と組で送る。Worker を作れなければ app.js の定期の確認だけ
// 最上位では self・Worker・FileSystemObserver に触れない（test/static/build-release.test.js が Node で import する）。
//
// **Observer に渡すのは、ワールドのフォルダの直下のファイル（Level.sav・LevelMeta.sav・LocalData.sav）だけ**。Chrome は見張っている
// ファイルの入ったフォルダを押さえるので、Players の中を見張ると、SaveSync が同期を受け取るときに Players を消せずに止まり、ワールドの
// フォルダが LocalData.sav だけになる（2026-10-17 の P0 の事故と再現。docs/sync-fixes/README.md の「P0 の結果」）。Players・
// ../GlobalPalStorage.sav の変化は 5 秒ごとの getFile() の確認で拾う（getFile() と中身の読み込みはフォルダを押さえない）。
// 画面側（owned.js の watchTargets）が observe を付けるのは直下のファイルだけで、ここでも observable() で絞る（二重に守る）

/** Observer に渡してよいファイル（ワールドのフォルダからの相対パス）。 */
export const OBSERVE_FILES = Object.freeze(['Level.sav', 'LevelMeta.sav', 'LocalData.sav']);

/** Observer に渡してよいか。ワールドのフォルダの直下の 3 つだけ（'/'・'\\' を含むパスは下か上のフォルダのファイル）。 */
export function observable(path) {
  return typeof path === 'string' && !/[\\/]/.test(path) && OBSERVE_FILES.includes(path);
}

// ファイルの印（`${lastModified}:${size}`。消えたら 'missing'、ほかの失敗は 'error:<name>'）と更新日時（読めなければ null）
async function markOf(handle) {
  try {
    const file = await handle.getFile();
    return { mark: `${file.lastModified}:${file.size}`, time: file.lastModified };
  } catch (error) {
    return { mark: error?.name === 'NotFoundError' ? 'missing' : `error:${error?.name || 'Error'}`, time: null };
  }
}

// 通知の、変わったハンドル（2026-10-15・17 の Chrome 155 は changedHandle の 1 つ。changedHandles〔配列〕の形でも読む）
const changedOf = (record) => {
  if (record?.changedHandles) return [...record.changedHandles];
  return record?.changedHandle ? [record.changedHandle] : [];
};

/**
 * Worker の中で動く見張りの本体。タイマーと Observer は注入する（テストは偽物を使う）。
 * post で送るのは { type: 'mode', generation, mode: 'observer' | 'poll' } と
 * { type: 'settled', generation, worldId, changed: string[], firstAt, lastAt, reason: 'quiet' | 'max' }
 *（firstAt・lastAt は変わったファイルの更新日時〔ミリ秒〕の最小・最大。消えた・読めないファイルは changed に入れるが時刻には使わない。
 * 時刻のあるファイルがなければ null）。
 * @returns {{ watch: (input: { generation: number, targets: { worldId: string, host: boolean,
 *   files: { path: string, handle: object, observe?: boolean }[] }[] }) => Promise<void>, stop: () => void }}
 */
export function createSaveWatcher({
  Observer = null, post = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  every = (fn, ms) => setInterval(fn, ms), stopEvery = (id) => clearInterval(id),
  pollMs = 5000, quietMs = 1000, maxWaitMs = 10000, rearmWaits = [10, 50, 250, 1000],
} = {}) {
  // 見張りを張り直す・止めるたびに増やす（古い見張りの通知・タイマー・張り直しの結果を捨てる）
  let epoch = 0;
  let generation = 0;
  let worlds = [];
  let poller = null;
  let polling = false;
  let mode = '';
  // 待っているタイマー（id → 張り直しの待ちなら resolve）。止めたら全部消し、待っている張り直しも終わらせる
  const timers = new Map();

  const live = (token) => token === epoch;
  function later(fn, ms) {
    const id = setTimer(() => { timers.delete(id); fn(); }, ms);
    timers.set(id, null);
    return id;
  }
  function drop(id) {
    if (id === null || id === undefined) return;
    clearTimer(id);
    timers.delete(id);
  }
  const sleep = (ms) => new Promise((resolve) => {
    const id = setTimer(() => { timers.delete(id); resolve(); }, ms);
    timers.set(id, resolve);
  });

  // Observer で見張ってよいファイル（呼び出し側の印と、直下のファイルかの両方）
  const observedFiles = (world) => world.files.filter((file) => file.observe && observable(file.path));

  // observe() する。待っている間に見張りを止めた・張り直した（古い世代）なら、張れてしまった分ごとその Observer を切る（halt() の後に
  // 張れると、もう worlds にないので誰も切らず、そのワールドのフォルダを Chrome が押さえたままになる）。張れて今の世代なら true
  async function observeLive(world, file, token) {
    const { observer } = world;
    if (!live(token) || !observer) return false;
    try {
      await observer.observe(file.handle);
    } finally {
      if (!live(token)) {
        try { observer.disconnect(); } catch { /* 切るだけ */ }
      }
    }
    return live(token);
  }

  // 見張りの方式。張り直しの途中のファイルも Observer で見張っているとみなす（保存のたびに disappeared で張り直すので、そのたびに揺らさない）
  function report() {
    const next = worlds.some((world) => world.observer && observedFiles(world).some((file) => file.watching)) ? 'observer' : 'poll';
    if (next === mode) return;
    mode = next;
    post({ type: 'mode', generation, mode });
  }

  function halt() {
    epoch++;
    for (const world of worlds) {
      try { world.observer?.disconnect(); } catch { /* 止めるだけ */ }
    }
    worlds = [];
    for (const [id, resolve] of timers) {
      clearTimer(id);
      resolve?.();
    }
    timers.clear();
    if (poller !== null) {
      stopEvery(poller);
      poller = null;
    }
    polling = false;
    mode = '';
  }

  // 変化（か、変化の知らせ）を 1 つ数える。最初の変化で maxWait のタイマー。ホストのワールドは Level.sav の変化を見るまで quiet を
  // 数えない（LocalData.sav は Level.sav より最大 2.74 秒早く書かれる。Level.sav から後は数 ms でそろう。P0）
  function touch(world, path, token) {
    if (!live(token)) return;
    const batch = world.batch ??= { quiet: null, max: null, level: false };
    if (batch.max === null) batch.max = later(() => settle(world, 'max', token), maxWaitMs);
    if (path === 'Level.sav') batch.level = true;
    if (world.host && !batch.level) return;
    drop(batch.quiet);
    batch.quiet = later(() => settle(world, 'quiet', token), quietMs);
  }

  function settle(world, reason, token) {
    if (!live(token) || !world.batch) return;
    const { quiet, max } = world.batch;
    world.batch = null;
    drop(quiet);
    drop(max);
    // 前の見直しが終わってから（同じワールドの見直しを重ねない）
    world.settling = world.settling.then(() => review(world, reason, token)).catch(() => {});
  }

  // ワールドの全ファイルを照らし合わせ、前に知らせたときから印の変わったファイルを知らせる。何も変わっていなければ知らせない
  async function review(world, reason, token) {
    const marks = [];
    for (const file of world.files) {
      const result = await markOf(file.handle);
      if (!live(token)) return;
      marks.push({ file, ...result });
    }
    const changed = marks.filter(({ file, mark }) => mark !== file.base);
    for (const { file, mark } of marks) {
      file.base = mark;
      file.seen = mark;
    }
    if (!changed.length) return;
    const times = changed.map(({ time }) => time).filter((time) => Number.isFinite(time));
    post({
      type: 'settled', generation, worldId: world.id, changed: changed.map(({ file }) => file.path),
      firstAt: times.length ? Math.min(...times) : null, lastAt: times.length ? Math.max(...times) : null, reason,
    });
  }

  // 1 つのファイルを照らし合わせ、前に見た印から変わっていれば変化として数える
  async function check(world, file, token) {
    const { mark } = await markOf(file.handle);
    if (!live(token) || mark === file.seen) return;
    file.seen = mark;
    touch(world, file.path, token);
  }

  // 張り直す。ゲームはファイルを置き換えて保存するので、保存のたびに disappeared・errored で見張りが止まる（P0 では毎回 1 回目で成功）。
  // getFile() が通ったら await observe() し、成功したら張り直す間の変化を見落とさないよう照らし合わせる。通らなければ rearmWaits の段で
  // 試し、全部の段で通らなければ、そのファイルは 5 秒ごとの確認だけにする（次の watch() で張り直す）
  async function rearm(world, file, token) {
    if (file.rearming) return;
    file.rearming = true;
    try {
      for (const wait of rearmWaits) {
        await sleep(wait);
        if (!live(token)) return;
        try {
          await file.handle.getFile();
          if (!(await observeLive(world, file, token))) return;
        } catch {
          if (!live(token)) return;
          continue;
        }
        file.watching = true;
        report();
        await check(world, file, token);
        return;
      }
      file.watching = false;
      report();
    } finally {
      if (live(token)) file.rearming = false;
    }
  }

  // Observer の通知。どのファイルの通知かは root（observe したハンドル）で決める（ワールドごとの Observer なので、直下のファイル名で分かる）
  function noticed(world, token, records) {
    if (!live(token)) return;
    const watched = observedFiles(world);
    for (const record of records ?? []) {
      if (record?.type === 'unknown') {
        // 何が変わったか分からない: そのワールドの全ファイルを照らし合わせる
        for (const file of world.files) check(world, file, token);
        continue;
      }
      const names = [record?.root?.name, ...changedOf(record).map((handle) => handle?.name)];
      const file = watched.find((item) => item.handle === record?.root) ?? watched.find((item) => names.includes(item.path));
      if (!file) continue;
      if (record.type === 'disappeared' || record.type === 'errored') {
        // 置き換えで消えた（いつもの道）。変化として数え、張り直す
        touch(world, file.path, token);
        rearm(world, file, token);
      } else {
        // appeared・modified・moved
        check(world, file, token);
      }
    }
  }

  async function observe(world, token) {
    const files = observedFiles(world);
    if (typeof Observer !== 'function' || !files.length) return;
    try {
      world.observer = new Observer((records) => noticed(world, token, records));
    } catch {
      world.observer = null;
      return;
    }
    for (const file of files) {
      try {
        if (!(await observeLive(world, file, token))) return;
        file.watching = true;
      } catch {
        if (!live(token)) return;
        rearm(world, file, token);
      }
    }
  }

  // 5 秒ごとに、全ワールドの全ファイル（Players・GlobalPalStorage.sav も）を照らし合わせる。前の回が終わっていなければ飛ばす
  async function poll(token) {
    if (!live(token) || polling) return;
    polling = true;
    try {
      for (const world of worlds) {
        for (const file of world.files) {
          await check(world, file, token);
          if (!live(token)) return;
        }
      }
    } finally {
      if (live(token)) polling = false;
    }
  }

  return {
    /** 前の見張りを全部止めてから張る。最初に全ファイルの印を取って基準にする（ここでは知らせない）。 */
    async watch({ generation: next = 0, targets = [] } = {}) {
      halt();
      const token = epoch;
      generation = next;
      worlds = (Array.isArray(targets) ? targets : []).map((target) => ({
        id: String(target?.worldId ?? ''), host: Boolean(target?.host), observer: null, batch: null, settling: Promise.resolve(),
        files: (Array.isArray(target?.files) ? target.files : []).filter((file) => file?.handle && typeof file.path === 'string')
          .map(({ path, handle, observe: wanted }) => ({ path, handle, observe: wanted === true, base: '', seen: '', watching: false, rearming: false })),
      }));
      for (const world of worlds) {
        for (const file of world.files) {
          const { mark } = await markOf(file.handle);
          if (!live(token)) return;
          file.base = mark;
          file.seen = mark;
        }
      }
      poller = every(() => { poll(token); }, pollMs);
      for (const world of worlds) {
        await observe(world, token);
        if (!live(token)) return;
      }
      report();
    },
    stop: halt,
  };
}

/**
 * 画面のスレッドの側。見張る対象（targets）を世代番号と組で Worker に送り、違う世代の知らせは捨てる。targets が空なら Worker を止める。
 * Worker を作れない（Node・古いブラウザ）・error・messageerror なら onMode('timer')（app.js の定期の確認だけ。このページの間は作り直さない）。
 * FileSystemFileHandle は postMessage で送れる（構造化複製できる）。
 */
export function createWatchClient({
  createWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }),
  onSettled = () => {}, onMode = () => {},
} = {}) {
  let worker = null;
  let generation = 0;
  let broken = false;

  function close() {
    if (!worker) return;
    try { worker.terminate(); } catch { /* 止めるだけ */ }
    worker = null;
  }
  function fail() {
    close();
    broken = true;
    onMode('timer');
  }
  function start() {
    if (worker || broken) return worker;
    try {
      worker = createWorker();
    } catch {
      broken = true;
      return null;
    }
    worker.addEventListener('message', ({ data }) => {
      if (!data || data.generation !== generation) return;
      if (data.type === 'settled') onSettled(data);
      else if (data.type === 'mode') onMode(data.mode);
    });
    worker.addEventListener('error', fail);
    worker.addEventListener('messageerror', fail);
    return worker;
  }

  const client = {
    update(targets = []) {
      generation++;
      if (!targets.length) {
        close();
        return;
      }
      if (!start()) {
        onMode('timer');
        return;
      }
      try {
        worker.postMessage({ type: 'watch', generation, targets });
      } catch {
        fail();
      }
    },
    stop() {
      client.update([]);
    },
  };
  return client;
}
