import pals from '../data/pals.js';
import { buildIndex } from './core/index.js';
import { buildCarrierGraph } from './core/route.js';
import { ApiError } from './api.js';

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
  };
}

function readJson(storage, key) {
  try { return JSON.parse(storage.get(key)); } catch { return null; }
}

export function createStore({ api, storage = safeStorage(null), namespace = 'pal-note', now = Date.now }) {
  const listeners = new Set();
  let sequence = 0;
  let appliedSequence = 0;
  let session = 0;
  let pending = 0;
  let lastRefresh = -Infinity;
  const state = {
    passcode: storage.get(`${namespace}.passcode`) ?? '', env: null,
    records: [], warnings: [], serverTime: '', cached: false, loading: false, error: '',
    index: buildIndex([], pals), graph: new Map(),
  };
  const emit = () => listeners.forEach((listener) => listener(state));

  function clearData() {
    state.env = null;
    state.records = [];
    state.warnings = [];
    state.serverTime = '';
    state.cached = false;
    state.index = buildIndex([], pals);
    state.graph = new Map();
    storage.remove(`${namespace}.authenticated`);
    for (const env of ['prod', 'test']) storage.remove(cacheKey(env, namespace));
  }

  function apply(snapshot, env, currentSequence, cached = false) {
    if (!shouldApplyResponse(currentSequence, appliedSequence)) return false;
    appliedSequence = currentSequence;
    state.records = snapshot.records;
    state.warnings = snapshot.warnings;
    state.serverTime = snapshot.serverTime;
    state.env = env;
    state.cached = cached;
    state.error = '';
    state.index = buildIndex(state.records, pals);
    state.graph = buildCarrierGraph(state.index);
    if (!cached) {
      storage.set(cacheKey(env, namespace), JSON.stringify(snapshot));
      storage.set(`${namespace}.authenticated`, env);
    }
    emit();
    return true;
  }

  const authenticatedEnv = storage.get(`${namespace}.authenticated`);
  if (state.passcode && ['prod', 'test'].includes(authenticatedEnv)) {
    const cached = readJson(storage, cacheKey(authenticatedEnv, namespace));
    if (cached && Array.isArray(cached.records) && Array.isArray(cached.warnings) && cached.serverTime) {
      apply(cached, authenticatedEnv, ++sequence, true);
    }
  }

  async function request(action, input) {
    if (!state.passcode) throw new ApiError('AUTH');
    const currentSequence = ++sequence;
    const currentSession = session;
    pending++;
    state.loading = true;
    emit();
    try {
      const response = await api.request(action, state.passcode, input);
      if (currentSession !== session) throw new ApiError('AUTH');
      apply(action === 'snapshot' ? response : response.snapshot, response.env, currentSequence);
      return response;
    } catch (error) {
      if (currentSession !== session) throw error;
      state.error = error.message;
      if (error.code === 'AUTH') {
        session++;
        state.passcode = '';
        storage.remove(`${namespace}.passcode`);
        clearData();
      }
      emit();
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
    setPasscode(passcode) {
      const value = passcode.trim();
      if (value !== state.passcode) { session++; clearData(); }
      state.passcode = value;
      state.error = '';
      if (value) storage.set(`${namespace}.passcode`, value);
      else storage.remove(`${namespace}.passcode`);
      emit();
    },
    async refresh({ throttled = false } = {}) {
      if (!state.passcode || (throttled && now() - lastRefresh < 30000)) return;
      lastRefresh = now();
      return request('snapshot');
    },
    mutate(action, input) { return request(action, { ...input, opId: crypto.randomUUID() }); },
  };
}
