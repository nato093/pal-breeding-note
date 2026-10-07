import pals from '../data/pals.js';
import { buildIndex } from './core/index.js';
import { buildCarrierGraph } from './core/route.js';
import { ApiError, validSnapshot } from './api.js';
import { userIdKey } from './core/user.js';
import { normalizeRecord } from './core/pair.js';

const mutationErrors = new Set(['DUPLICATE', 'PAIR_CONFLICT', 'ID_CONFLICT', 'VALIDATION', 'CONFLICT', 'NOT_FOUND']);
const PENDING_ETAG = 'pending:';

// サーバ応答前の見た目を作る。応答の全件に重ね直しても結果が変わらないようにする。
const optimistic = {
  create: ({ record }, { etag, time }) => (records) => records.some((item) => item.id === record.id) ? records
    : [...records, { ...normalizeRecord(record), confirmCount: 1, createdAt: time, updatedAt: time, etag }],
  update: ({ id, record }, { time }) => (records) => records.map((item) => item.id === id
    ? { ...item, ...normalizeRecord(record), updatedAt: time } : item),
  delete: ({ id }) => (records) => records.filter((item) => item.id !== id),
  merge: ({ sourceId }) => (records) => records.filter((item) => item.id !== sourceId),
  restore: ({ id }, { removed }) => (records) => !removed || records.some((item) => item.id === id) ? records : [...records, removed],
};

export function cacheKey(env, namespace = 'pal-note') {
  if (!['prod', 'test'].includes(env)) throw new Error('環境を確認できません');
  return `${namespace}.cache.${env}`;
}

export function shouldApplyResponse(sequence, appliedSequence) {
  return sequence > appliedSequence;
}

export function safeStorage(storage) {
  return {
    get(key) { try { return storage?.getItem(key) ?? null; } catch { return null; } },
    set(key, value) { try { storage?.setItem(key, value); } catch { /* 保存できなくても操作は続ける。 */ } },
    remove(key) { try { storage?.removeItem(key); } catch { /* 保存が無効な端末にも対応する。 */ } },
    // 保存できたかを返す（保存できないと困る記録に使う）。
    trySet(key, value) {
      if (!storage) return false;
      try { storage.setItem(key, value); return true; } catch { return false; }
    },
  };
}

function readJson(storage, key) {
  try { return JSON.parse(storage.get(key)); } catch { return null; }
}

// onUserIdChange(previous, next, env): サーバの表記に合わせて ID を変えたとき（別の端末で大小・全半角だけ名前を変えたなど）
export function createStore({ api, storage = safeStorage(null), namespace = 'pal-note', now = Date.now, onUserIdChange = () => {} }) {
  const listeners = new Set();
  let sequence = 0;
  let appliedSequence = 0;
  let session = 0;
  let pending = 0;
  let lastRefresh = -Infinity;
  // サーバで確定した全件と、送信待ちの操作。画面には確定分に送信待ちを重ねて出す。
  let confirmed = [];
  const queue = [];
  // 送信待ちが空のときから数えた操作の数。済んだ数は、ここから送信待ちの残りを引いて出す。
  let queued = 0;
  let worker = null;
  // 実行中の通信（裏の送信も含む）。名前を変える前に、すべて終わるのを待つ。
  const running = new Set();
  // 自分の操作で新しくなった版（見えていた etag → 次の etag）。続けて操作したときの etag を引き継ぐ。
  const successors = new Map();
  const removedRecords = new Map();
  const state = {
    passcode: storage.get(`${namespace}.passcode`) ?? '', userId: storage.get(`${namespace}.userId`) ?? '', users: [], env: null,
    records: [], warnings: [], serverTime: '', cached: false, loading: false, syncing: false, error: '', renaming: false,
    // 送信の進み具合（失敗して取り消した操作も済んだ数に入れる）。送信待ちが空なら両方 0。
    syncDone: 0, syncTotal: 0,
    index: buildIndex([], pals), graph: new Map(),
    // サーバで確定した全件（送信待ちを重ねる前）。確定した変化だけを見たいときに使う。
    confirmedRecords: [],
  };
  const emit = () => listeners.forEach((listener) => listener(state));

  function track(promise) {
    running.add(promise);
    const done = () => running.delete(promise);
    promise.then(done, done);
    return promise;
  }

  async function idle() {
    while (worker || running.size) await Promise.allSettled([worker, ...running]);
  }

  function render() {
    state.records = queue.reduce((records, operation) => operation.apply(records), confirmed);
    state.confirmedRecords = confirmed;
    state.syncing = queue.length > 0;
    state.syncTotal = queue.length ? queued : 0;
    state.syncDone = state.syncTotal - queue.length;
    state.index = buildIndex(state.records, pals);
    state.graph = buildCarrierGraph(state.index);
    emit();
  }

  function clearData() {
    // 送信中の操作は、応答を受けた send が実際のエラーで終える。
    for (const operation of queue.splice(0)) if (!operation.sent) operation.reject(new ApiError('AUTH'));
    confirmed = [];
    successors.clear();
    removedRecords.clear();
    state.syncing = false;
    state.syncDone = 0;
    state.syncTotal = 0;
    state.env = null;
    state.records = [];
    state.confirmedRecords = [];
    state.warnings = [];
    state.users = [];
    state.serverTime = '';
    state.cached = false;
    state.index = buildIndex([], pals);
    state.graph = new Map();
    storage.remove(`${namespace}.authenticated`);
    for (const env of ['prod', 'test']) storage.remove(cacheKey(env, namespace));
  }

  function logout(error = '') {
    session++;
    lastRefresh = -Infinity;
    state.passcode = '';
    state.error = error;
    storage.remove(`${namespace}.passcode`);
    clearData();
    emit();
  }

  function apply(snapshot, env, currentSequence, cached = false) {
    if (!shouldApplyResponse(currentSequence, appliedSequence)) return false;
    const canonical = snapshot.users.find((userId) => userIdKey(userId) === userIdKey(state.userId));
    if (canonical === undefined) {
      const error = new ApiError('USER_NOT_FOUND');
      logout(error.message);
      throw error;
    }
    appliedSequence = currentSequence;
    // 別の端末で大小・全半角だけ名前を変えたら、サーバの表記にそろえる（古いキャッシュでは戻さない）。
    if (!cached && canonical !== state.userId) {
      const previous = state.userId;
      state.userId = canonical;
      storage.set(`${namespace}.userId`, canonical);
      onUserIdChange(previous, canonical, env);
    }
    confirmed = snapshot.records;
    state.warnings = snapshot.warnings;
    state.users = snapshot.users;
    state.serverTime = snapshot.serverTime;
    state.env = env;
    state.cached = cached;
    state.error = '';
    if (!cached) {
      storage.set(cacheKey(env, namespace), JSON.stringify(snapshot));
      storage.set(`${namespace}.authenticated`, env);
    }
    render();
    return true;
  }

  const authenticatedEnv = storage.get(`${namespace}.authenticated`);
  if (state.passcode && state.userId && ['prod', 'test'].includes(authenticatedEnv)) {
    const cached = readJson(storage, cacheKey(authenticatedEnv, namespace));
    if (validSnapshot(cached) && cached.serverTime) {
      try { apply(cached, authenticatedEnv, ++sequence, true); } catch { /* 削除済みの ID ではキャッシュを利用しない。 */ }
    }
  }

  async function request(action, input, { background = false, settled } = {}) {
    if (!state.passcode || !state.userId) throw new ApiError('AUTH');
    const currentSequence = ++sequence;
    const currentSession = session;
    if (!background) {
      pending++;
      state.loading = true;
      emit();
    }
    try {
      const response = await track(api.request(action, state.passcode, input));
      if (currentSession !== session) throw new ApiError('AUTH');
      // 送信待ちから外してから、応答の全件に残りの操作を重ね直す。
      settled?.();
      if (!apply(action === 'snapshot' ? response : response.snapshot, response.env, currentSequence) && settled) render();
      return response;
    } catch (error) {
      if (currentSession !== session) throw error;
      if (action === 'snapshot' || !mutationErrors.has(error.code)) state.error = error.message;
      if (error.code === 'AUTH') {
        logout(error.message);
      }
      emit();
      throw error;
    } finally {
      if (!background) {
        pending--;
        state.loading = pending > 0;
        emit();
      }
    }
  }

  function latestEtag(etag) {
    const seen = new Set();
    while (successors.has(etag) && !seen.has(etag)) {
      seen.add(etag);
      etag = successors.get(etag);
    }
    return etag;
  }

  async function send(operation) {
    const input = { ...operation.input, opId: operation.opId };
    if (input.expectedEtag) input.expectedEtag = latestEtag(input.expectedEtag);
    if (input.expectedEtags) {
      input.expectedEtags = { source: latestEtag(input.expectedEtags.source), target: latestEtag(input.expectedEtags.target) };
    }
    const remove = () => {
      const position = queue.indexOf(operation);
      if (position >= 0) queue.splice(position, 1);
      return position >= 0;
    };
    // 登録に失敗した配合への続きの操作は、対象が存在しないので送らずに取り消す。
    if ([input.expectedEtag, input.expectedEtags?.source, input.expectedEtags?.target].some((etag) => etag?.startsWith(PENDING_ETAG))) {
      remove();
      render();
      operation.reject(new ApiError('CANCELED'));
      return;
    }
    operation.sent = true;
    try {
      const response = await request(operation.action, input, { background: true, settled: remove });
      const before = operation.action === 'create' ? operation.etag
        : operation.action === 'merge' ? input.expectedEtags.target : input.expectedEtag;
      // 冪等な応答は etag を確かめずに今の版を返すため、他の人の更新を自分の更新として引き継がない。
      const own = !response.idempotent || operation.action === 'create';
      if (before && own && response.record.etag && !response.mergedInto) successors.set(before, response.record.etag);
      operation.resolve(response);
    } catch (error) {
      if (remove()) render();
      operation.reject(error);
    }
  }

  async function drain() {
    try {
      while (queue.length) await send(queue[0]);
    } finally { worker = null; }
  }

  async function authenticate(action, userId, passcode) {
    if (state.renaming) throw new ApiError('RENAMING');
    const currentSession = ++session;
    const currentSequence = ++sequence;
    const password = passcode.trim();
    pending++;
    state.loading = true;
    state.error = '';
    emit();
    try {
      const response = await track(api.request(action, password, { userId }));
      if (currentSession !== session) throw new ApiError('AUTH');
      if (!response.users.some((id) => userIdKey(id) === userIdKey(response.userId))) throw new ApiError('RESPONSE');
      clearData();
      state.passcode = password;
      state.userId = response.userId;
      storage.set(`${namespace}.passcode`, password);
      storage.set(`${namespace}.userId`, state.userId);
      lastRefresh = now();
      apply(response, response.env, currentSequence);
      return response;
    } catch (error) {
      if (currentSession === session) {
        if (error.code === 'AUTH') logout(error.message);
        else { state.error = error.message; emit(); }
      }
      throw error;
    } finally {
      pending--;
      state.loading = pending > 0;
      emit();
    }
  }

  return {
    state, storage,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    login(userId, passcode) { return authenticate('login', userId, passcode); },
    signup(userId, passcode) { return authenticate('signup', userId, passcode); },
    logout,
    // 配合の全件を返さない操作（所持パルの共有など）。認証が外れたときはログアウトする。
    async call(action, input) {
      if (!state.passcode || !state.userId) throw new ApiError('AUTH');
      if (state.renaming) throw new ApiError('RENAMING');
      const currentSession = session;
      try {
        const response = await track(api.request(action, state.passcode, input));
        if (currentSession !== session) throw new ApiError('AUTH');
        return response;
      } catch (error) {
        if (error.code === 'AUTH' && currentSession === session) logout(error.message);
        throw error;
      }
    },
    async refresh({ throttled = false } = {}) {
      if (!state.passcode || !state.userId || state.renaming || (throttled && now() - lastRefresh < 30000)) return;
      lastRefresh = now();
      // 書き込み中に読んだ全件は書き込み前の内容のことがあり、画面を巻き戻すため送信を待つ。
      while (worker) await worker;
      if (!state.passcode || !state.userId || state.renaming) return;
      return request('snapshot');
    },
    // 画面にはすぐ反映し、サーバへは裏で 1 件ずつ順番に送る。失敗したらその操作だけを取り消す。
    mutate(action, input) {
      if (!state.passcode || !state.userId) return Promise.reject(new ApiError('AUTH'));
      if (state.renaming) return Promise.reject(new ApiError('RENAMING'));
      const opId = crypto.randomUUID();
      const operation = { action, input, opId, etag: `${PENDING_ETAG}${opId}` };
      if (action === 'delete') {
        const removed = state.records.find((record) => record.id === input.id);
        if (removed) removedRecords.set(input.id, removed);
      }
      operation.apply = optimistic[action](input, {
        etag: operation.etag, time: new Date(now()).toISOString(), removed: removedRecords.get(input.id),
      });
      const done = new Promise((resolve, reject) => Object.assign(operation, { resolve, reject }));
      if (!queue.length) queued = 0;
      queued++;
      queue.push(operation);
      render();
      worker ??= drain();
      return done;
    },
    // 名前の変更を始める。新しい通信を止め、送信待ちと実行中の通信が終わるのを待つ。
    async beginRename() {
      if (!state.passcode || !state.userId || !state.env) throw new ApiError('AUTH');
      if (state.renaming) throw new ApiError('RENAMING');
      state.renaming = true;
      emit();
      await idle();
    },
    endRename() {
      state.renaming = false;
      emit();
    },
    // 名前の変更をサーバに送る。成功したら、beforeApply で端末内のデータを移してから、新しい名前で全件を反映する。
    async sendRename({ opId, oldId, newId }, beforeApply = () => {}) {
      const currentSequence = ++sequence;
      const currentSession = session;
      pending++;
      state.loading = true;
      emit();
      try {
        const response = await track(api.request('rename', state.passcode, { opId, userId: oldId, newUserId: newId }));
        if (currentSession !== session) throw new ApiError('AUTH');
        beforeApply(response);
        state.userId = response.userId;
        storage.set(`${namespace}.userId`, response.userId);
        lastRefresh = now();
        apply(response, response.env, currentSequence);
        return response;
      } catch (error) {
        if (currentSession === session && error.code === 'AUTH') logout(error.message);
        throw error;
      } finally {
        pending--;
        state.loading = pending > 0;
        emit();
      }
    },
  };
}
