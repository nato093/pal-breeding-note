import { clip, TITLE_MAX } from './notifications.js';

// 配信時に scripts/build-release.mjs が、このファイルを含む全モジュールの参照に ?v=<版> を付ける。
// ローカルの開発やテストでは版が無いので、監視しない。
export const runningVersion = (url = import.meta.url) => {
  const version = new URL(url).searchParams.get('v');
  return version && /^[0-9a-f]{7,40}$/.test(version) ? version : '';
};

export const CHECK_INTERVAL = 5 * 60 * 1000;
const MIN_GAP = 60 * 1000;
const TIMEOUT = 10 * 1000;

async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// version.json（配信時に書き出す）を読み、実行中と違う版が配信されていたら onUpdate で知らせる。
// 同梱の更新内容に無い通知があれば、その title も渡す（帯に出す）。
export function createVersionWatcher({ current, bundledNoteIds = [], onUpdate, now = Date.now, timeout = TIMEOUT }) {
  const bundled = new Set(bundledNoteIds);
  let inFlight = false;
  let lastCheck = -Infinity;
  let notified = '';

  async function check() {
    if (!current || inFlight || now() - lastCheck < MIN_GAP) return;
    inFlight = true;
    lastCheck = now();
    try {
      const response = await fetchWithTimeout(`version.json?t=${now()}`, { cache: 'no-store' }, timeout);
      if (!response.ok) return;
      const remote = await response.json();
      const version = typeof remote?.version === 'string' ? remote.version : '';
      if (!/^[0-9a-f]{7,40}$/.test(version) || version === current || version === notified) return;
      notified = version;
      const notes = (Array.isArray(remote.notes) ? remote.notes : [])
        .filter((note) => typeof note?.id === 'string' && !bundled.has(note.id))
        .map((note) => ({ id: note.id, title: clip(note.title, TITLE_MAX) }))
        .filter((note) => note.title);
      onUpdate({ version, notes });
    } catch {
      // 通信できないときは、次の確認に任せる。
    } finally {
      inFlight = false;
    }
  }

  return { check };
}

// 読み込み直す前に、今のページ（ハッシュを除く）を取り直し、新しい版が配信されているかを確かめる。
// 取り直した HTML がキャッシュに入るので、続く再読み込みで新しい版を読む。
export async function servedVersion(pageUrl, timeout = TIMEOUT) {
  const response = await fetchWithTimeout(pageUrl.split('#')[0], { cache: 'reload' }, timeout);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.text()).match(/<meta name="app-version" content="([0-9a-f]{7,40})">/)?.[1] ?? '';
}
