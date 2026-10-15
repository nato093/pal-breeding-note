import pals from '../data/pals.js';
import { userIdKey } from './core/user.js';
import { pairKey } from './core/pair.js';
import { ownedWorldId } from './core/owned-shared.js';
import { cleanGoal, parseGoals, goalKey, goalMatches, ownPals, ownPlayerUids, isSpeciesGoal, GOAL_LIMIT } from './core/ideal-goals.js';
import { mergeGoals, mergeObservationSpecies } from './device-data.js';
import { parseObservations, firstObservation, observeSpecies, cleanEntry } from './core/goal-observations.js';
import { migrateWishlist, parseWishes, wishlistKey } from './goals-migration.js';
import { buildHash } from './router.js';

const palsById = new Map(pals.map((pal) => [pal.id, pal]));
const palName = (id) => palsById.get(id)?.ja ?? '不明なパル';

const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

// 登録した理想個体（目標）は、この端末にだけ ID・環境ごとに残す（ウィッシュリストと同じ）。
// 完成の判定は、表示しているワールドの所持パル（セーブから読んだもの・共有されたもの）で、ワールドごとに行う。
// 判定に使ったセーブの時刻（observedAt）より新しいデータを受けたときだけ判定し直す。起動時の保存済みデータや、
// 古いデータのままの別のタブで、新しいデータでの判定を巻き戻さないため。
// 判定するのは自分の個体だけ（identity: ログイン中の ID・ユーザー一覧・セーブのプレイヤーとの対応・このワールドでの自分。
// core/ideal-goals.js の ownPals）。自分のプレイヤーが分からないときは判定しない。
// 目標の種族ごとの「配合の登録の観測」（前のウィッシュリストの判定。goals-merge）は、前の版のタブが書き換えない別のキー
// <namespace>.goalsObs.<env>.<userIdKey> に持つ（core/goal-observations.js）。確定データ（confirmedRecords）で、各種族の observedAt より
// 新しいサーバ時刻のときだけ進める。前のウィッシュリストは、ログインした環境・ID ごとに 1 回（と旧キーが変わったとき）目標へ移す。
// そのワールドで初めて判定したときは、完成していても知らせない（登録した時点で完成していたものなど）。
// 未完成から完成に変わるのを見たときだけ completedAt を付けて知らせ、未完成に戻ったら外す（通知も消える）。
// 本人（自分のプレイヤー）が変わったとき（設定の「このワールドでの自分」・登録者の対応）は identityChanged で、同じセーブの時刻のまま
// 判定し直す。そのとき完成していたものは知らせない（選んだ時点で完成しているものは「完成済み」の表示だけ）。
export function createIdealStore({
  store, owned, storage, namespace = 'pal-note', now = Date.now, uuid = () => crypto.randomUUID(),
  identity = () => ({ userId: store.state.userId, users: store.state.users ?? [], mapping: {} }),
}) {
  const listeners = new Set();
  const cache = new Map();
  const obsCache = new Map();
  let saveFailed = false;
  let obsFailed = false;
  const emit = () => listeners.forEach((listener) => listener());

  function scope() {
    const { env, userId, passcode } = store.state;
    return env && userId && passcode ? `${namespace}.ideals.${env}.${userIdKey(userId)}` : '';
  }
  // 観測のキー（目標のキーと同じ環境・ID）
  function obsScope() {
    const { env, userId, passcode } = store.state;
    return env && userId && passcode ? `${namespace}.goalsObs.${env}.${userIdKey(userId)}` : '';
  }
  function loadObs(key) {
    if (!key) return parseObservations(null);
    if (!obsCache.has(key)) {
      let source = null;
      try { source = storage?.getItem(key) ?? null; } catch { /* 読めない端末は観測なしとして扱う。 */ }
      obsCache.set(key, parseObservations(source));
    }
    return obsCache.get(key);
  }
  function saveObs(key, value) {
    obsCache.set(key, value);
    obsFailed = true;
    try {
      storage.setItem(key, JSON.stringify(value));
      obsFailed = false;
    } catch { /* 保存の失敗は saveFailed で画面に知らせる。 */ }
    emit();
  }
  // 別のタブの保存を消さないよう、書き換えは保存先の最新の内容に対して行う
  function latestObs(key) {
    if (!obsFailed) obsCache.delete(key);
    return structuredCopy(loadObs(key));
  }
  const structuredCopy = (value) => JSON.parse(JSON.stringify(value));

  // 子ごとの、産まれる親の組（確定データから作る。送信待ちを含まない＝失敗する登録で知らせない）
  let pairSource = null;
  let pairsByChild = new Map();
  function confirmedPairs() {
    const records = store.state.confirmedRecords ?? [];
    if (records !== pairSource) {
      pairSource = records;
      pairsByChild = new Map();
      for (const record of records) {
        if (!pairsByChild.has(record.childId)) pairsByChild.set(record.childId, new Set());
        pairsByChild.get(record.childId).add(pairKey(record.parent1Id, record.parent2Id));
      }
    }
    return pairsByChild;
  }
  const pairsOf = (palId) => [...confirmedPairs().get(palId) ?? []];

  // 目標のある種族の観測を進める（キャッシュ・名前の変更中・時刻の読めないデータでは進めない。observedAt より新しいデータのときだけ）
  function observeRecords() {
    const key = scope();
    const okey = obsScope();
    const { cached, serverTime, renaming } = store.state;
    const current = Date.parse(serverTime);
    if (!key || !okey || cached || renaming || !Number.isFinite(current)) return;
    const species = [...new Set(load(key).map((goal) => goal.palId))];
    const stale = (obs, palId) => !(Date.parse(obs.species[palId]?.observedAt) >= current);
    if (!species.some((palId) => stale(loadObs(okey), palId))) return;
    const next = latestObs(okey);
    if (!species.some((palId) => stale(next, palId))) return;
    const time = new Date(now()).toISOString();
    for (const palId of species) {
      if (!stale(next, palId)) continue;
      const entry = next.species[palId];
      next.species[palId] = entry ? observeSpecies(entry, pairsOf(palId), serverTime, time) : firstObservation(pairsOf(palId), serverTime);
    }
    saveObs(okey, next);
  }

  // ---- 前のウィッシュリストの移行（ログインした環境・ID ごとに 1 回と、旧キーが変わったとき） ----
  let migratedScope = '';
  let migration = { status: 'none', migrated: 0, pending: 0 };
  function migrate(force = false) {
    const key = scope();
    if (!key || store.state.renaming || !storage) return;
    if (!force && migratedScope === key) return;
    migratedScope = key;
    const { env, userId } = store.state;
    migration = migrateWishlist({ storage, namespace, env, userKey: userIdKey(userId), now });
    if (migration.migrated || migration.status === 'done') {
      cache.delete(key);
      obsCache.delete(obsScope());
    }
    emit();
    observeRecords();
  }

  function load(key) {
    if (!key) return [];
    if (!cache.has(key)) {
      let source = null;
      try { source = storage?.getItem(key) ?? null; } catch { /* 読めない端末は登録なしとして扱う。 */ }
      cache.set(key, parseGoals(source));
    }
    return cache.get(key);
  }

  function save(key, goals) {
    cache.set(key, goals);
    saveFailed = true;
    try {
      storage.setItem(key, JSON.stringify(goals));
      saveFailed = false;
    } catch { /* 容量超過・保存の拒否は saveFailed で画面に知らせる。 */ }
    emit();
  }

  // 別のタブの保存を消さないよう、書き換えは保存先の最新の内容に対して行う（保存に失敗している間は手元の内容が最新）。
  function latest(key) {
    if (!saveFailed) cache.delete(key);
    return load(key);
  }

  /** 表示しているワールドの自分の個体。所持パルがなければ undefined、自分のプレイヤーが分からなければ null。 */
  function mine() {
    const data = owned?.state?.owned;
    return data ? ownPals(data, identity(owned.state.meta?.worldId ?? '')) : undefined;
  }

  /** 表示しているワールドの自分のプレイヤーの UID（所持パルの所持者の「（自分）」）。所持パルがない・分からなければ空 */
  function selfUids() {
    const data = owned?.state?.owned;
    return data ? ownPlayerUids(data.players ?? [], identity(owned.state.meta?.worldId ?? '')) : new Set();
  }

  /** 判定に使える自分の個体（表示しているワールドで、ワールド ID とセーブの時刻が分かる読み込み済みのもの）。なければ null。 */
  function current() {
    const state = owned?.state;
    const worldId = ownedWorldId(state?.meta?.worldId);
    const at = state?.meta?.saveUpdatedAt;
    if (!state?.owned || !worldId || !validTime(at)) return null;
    const pals = mine();
    return pals ? { worldId, worldName: state.meta.worldName ?? '', at, pals } : null;
  }

  const stale = (goal, view) => !(Date.parse(goal.worlds[view.worldId]?.observedAt) >= Date.parse(view.at));
  // そのワールドの記録が、今のデータより新しいセーブで判定したもの（新しいセーブを開いている別のタブが書いた）
  const newer = (goal, view) => Date.parse(goal.worlds[view.worldId]?.observedAt) > Date.parse(view.at);

  // 1 件の、そのワールドでの記録を新しいデータで作り直す。mode は
  // 'notify'（新しいセーブ。未完成から完成に変わったら知らせる）・'quiet'（登録した時点。完成していても知らせない）・
  // 'identity'（本人が変わった。同じセーブのまま判定し直し、前から完成していたものは前の completedAt を残し、ほかは知らせない）
  function judged(goal, view, byPal, mode) {
    const complete = goalMatches(goal, byPal.get(goal.palId) ?? []).length > 0;
    const before = goal.worlds[view.worldId];
    const checked = before?.checked === true;
    let completedAt = '';
    // 完成を見た時刻は、判定したセーブの時刻にする（別のタブがほぼ同時に判定しても同じ値になり、通知が重ならない）
    if (complete && mode === 'notify') completedAt = checked && !before.complete ? view.at : (checked ? before.completedAt : '');
    // 本人を変えても完成のままなら、出ている通知を消さない。新しく完成した（前の本人では未完成）ものは知らせない。
    // 記録は complete になるので、次に新しいセーブを読んだときの 'notify' でも知らせない
    else if (complete && mode === 'identity') completedAt = checked && before.complete ? before.completedAt : '';
    return { ...goal, worlds: { ...goal.worlds, [view.worldId]: { checked: true, complete, completedAt, observedAt: view.at, worldName: view.worldName } } };
  }

  const bySpecies = (pals) => {
    const map = new Map();
    for (const pal of pals) {
      if (!map.has(pal.palId)) map.set(pal.palId, []);
      map.get(pal.palId).push(pal);
    }
    return map;
  };

  function observe() {
    const key = scope();
    // 名前の変更中は書き換えない（変更の後で、新しい名前の保存先へ移すため。終わったら store の通知で判定し直す）
    if (!key || store.state.renaming) return;
    const view = current();
    if (!view || !load(key).some((goal) => stale(goal, view))) return;
    const goals = latest(key);
    if (!goals.some((goal) => stale(goal, view))) return;
    const byPal = bySpecies(view.pals);
    save(key, goals.map((goal) => (stale(goal, view) ? judged(goal, view, byPal, 'notify') : goal)));
  }

  store.subscribe(() => {
    migrate();
    observe();
    observeRecords();
  });
  owned?.subscribe(observe);
  migrate();
  observe();
  observeRecords();

  return {
    scope,
    get saveFailed() { return saveFailed || obsFailed; },
    list(key = scope()) { return load(key); },
    /** 目標の種族の配合の登録の観測（行の「配合」と通知に使う）。なければ null */
    observation(palId) { return loadObs(obsScope()).species[palId] ?? null; },
    /** 観測のすべて（通知の元が読む） */
    observations() { return loadObs(obsScope()); },
    /** 前のウィッシュリストの移行の結果（{ status, migrated, pending }。status は 'none'・'done'・'partial'・'failed'） */
    migration() { return migration; },
    /** 移せていない前のウィッシュリスト（読み取り専用の一覧に出す。移行が partial・failed のときだけ意味がある） */
    legacyWishes() {
      const { env, userId } = store.state;
      if (!scope()) return [];
      let source = null;
      try { source = storage?.getItem(wishlistKey(namespace, env, userIdKey(userId))) ?? null; } catch { return []; }
      return parseWishes(source);
    },
    mine,
    selfUids,
    /**
     * 本人（自分のプレイヤー）が変わったら呼ぶ（このワールドでの自分・登録者の対応を変えた、別のタブで変わった）。
     * 同じセーブの時刻でも、表示しているワールドを判定し直す（通知はしない）。自分が分からなくなったときは、記録を消さずに
     * 購読者だけを呼ぶ（画面の「未確認」を描き直させる）。名前の変更中は書き換えない（app.js が、終わった後の store の通知で 1 回呼ぶ）。
     * そのワールドの記録が今のデータより新しいセーブで判定したもの（新しいセーブを開いている別のタブが書いた）は、判定し直さずに残す
     *（古いデータで未完成に巻き戻すと、新しいセーブのタブがそれを読んで「未完成 → 完成」と知らせ直すため）
     */
    identityChanged() {
      const key = scope();
      if (!key || store.state.renaming) return false;
      const view = current();
      if (!view) { emit(); return false; }
      const goals = latest(key);
      if (!goals.some((goal) => !newer(goal, view))) { emit(); return false; }
      const byPal = bySpecies(view.pals);
      save(key, goals.map((goal) => (newer(goal, view) ? goal : judged(goal, view, byPal, 'identity'))));
      return true;
    },
    /**
     * 本人の署名（表示しているワールド ID と自分のプレイヤーの UID の並び）。所持パルがなければ ''。
     * 理想個体の再計算の署名に入れる（本人が変わったときだけ計算し直し、読み直しで同じなら計算しない）
     */
    identityKey() {
      const data = owned?.state?.owned;
      if (!data) return '';
      const worldId = owned.state.meta?.worldId ?? '';
      return `${ownedWorldId(worldId)}|${[...ownPlayerUids(data.players ?? [], identity(worldId))].sort().join(',')}`;
    },
    find(id) { return load(scope()).find((goal) => goal.id === id) ?? null; },
    has(conditions) {
      const goal = cleanGoal({ ...conditions, id: 'check' });
      return Boolean(goal) && load(scope()).some((item) => goalKey(item) === goalKey(goal));
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /**
     * 登録する。同じ条件があれば 'duplicate'、上限なら 'full'、ログイン前・名前の変更中・形が合わなければ null。
     * 表示しているワールドの所持パルがあれば、その時点の完成を知らせずに記録する（登録した時点で完成していても知らせない）。
     */
    add(conditions) {
      const key = scope();
      if (!key || store.state.renaming) return null;
      let goal = cleanGoal({ ...conditions, id: 'new', addedAt: new Date(now()).toISOString(), worlds: {} });
      if (!goal) return null;
      const goals = latest(key);
      if (goals.some((item) => goalKey(item) === goalKey(goal))) return 'duplicate';
      if (goals.length >= GOAL_LIMIT) return 'full';
      goal = { ...goal, id: uuid() };
      const view = current();
      if (view) goal = judged(goal, view, bySpecies(view.pals), 'quiet');
      save(key, [goal, ...goals]);
      // その種族の観測がなければ、今の組を覚える（登録した時点で作れても知らせない。前のウィッシュリストの追加と同じ）
      const okey = obsScope();
      if (okey && !loadObs(okey).species[goal.palId]) {
        const next = latestObs(okey);
        next.species[goal.palId] ??= firstObservation(pairsOf(goal.palId), store.state.serverTime);
        saveObs(okey, next);
      }
      return 'added';
    },
    /**
     * 書き出したファイルの目標と観測を足す（settings の「この端末のデータ」の読み込み）。goalKey と id で重複を除き、上限（GOAL_LIMIT）まで
     * 今の目標の後ろに足す（今のものを優先）。足した目標のワールドごとの完成は持ち込まず、表示しているワールドの所持パルで知らせずに判定する
     *（add と同じ）。観測は足した目標の種族だけ mergeObservation で併せ、どちらにもなければ今の組を覚える。
     * { added, skipped（重複・上限で入らなかった数）, saved }。ログイン前・名前の変更中は null
     */
    importGoals(values, observations = null) {
      const key = scope();
      if (!key || store.state.renaming || !Array.isArray(values)) return null;
      const incoming = values.map((value) => cleanGoal({ ...value, worlds: {} })).filter(Boolean);
      const existing = latest(key);
      const { goals, added, skipped } = mergeGoals(existing, incoming);
      if (!added) return { added: 0, skipped, saved: true };
      const view = current();
      const species = view ? bySpecies(view.pals) : null;
      const next = goals.map((goal, index) => (index < existing.length || !view ? goal : judged(goal, view, species, 'quiet')));
      save(key, next);
      const okey = obsScope();
      if (okey) {
        const palIds = [...new Set(next.slice(existing.length).map((goal) => goal.palId))];
        const merged = mergeObservationSpecies(latestObs(okey), observations, palIds);
        for (const palId of palIds) merged.species[palId] ??= firstObservation(pairsOf(palId), store.state.serverTime);
        saveObs(okey, merged);
      }
      return { added, skipped, saved: !saveFailed && !obsFailed };
    },
    /** 外す。その種族の目標がほかになければ観測も消す（通知も消える）。戻すための { goal, index, observation } を返す */
    remove(id, key = scope()) {
      const goals = latest(key);
      const index = goals.findIndex((goal) => goal.id === id);
      if (index < 0 || store.state.renaming) return null;
      const goal = goals[index];
      save(key, goals.filter((item, at) => at !== index));
      let observation = null;
      const okey = key === scope() ? obsScope() : '';
      if (okey && !goals.some((item, at) => at !== index && item.palId === goal.palId)) {
        const next = latestObs(okey);
        observation = next.species[goal.palId] ?? null;
        if (observation) {
          delete next.species[goal.palId];
          saveObs(okey, next);
        }
      }
      return { goal, index, observation };
    },
    // 外した時点の ID・環境に戻し（観測も戻す）、外している間に届いたデータで判定し直す。名前を変えた後や、同じ条件を登録し直した後は戻さない
    restore(goal, index, key, observation = null) {
      if (!key || key !== scope() || store.state.renaming) return false;
      const goals = latest(key);
      if (goals.length >= GOAL_LIMIT || goals.some((item) => item.id === goal.id || goalKey(item) === goalKey(goal))) return false;
      save(key, [...goals.slice(0, index), goal, ...goals.slice(index)]);
      const entry = cleanEntry(observation);
      const okey = obsScope();
      if (okey) {
        const next = latestObs(okey);
        if (!next.species[goal.palId]) {
          next.species[goal.palId] = entry ?? firstObservation(pairsOf(goal.palId), store.state.serverTime);
          saveObs(okey, next);
        }
      }
      observe();
      observeRecords();
      return true;
    },
    // 別のタブで書き換わったら読み直し、そのタブが古いデータで登録した分も判定する。観測のキー・前のウィッシュリストのキーにも反応する
    reload(key) {
      if (typeof key !== 'string') return;
      if (key.startsWith(`${namespace}.goalsObs.`)) {
        if (obsCache.delete(key)) emit();
        observeRecords();
        return;
      }
      if (key.startsWith(`${namespace}.wishlist.`)) {
        const { env, userId } = store.state;
        if (scope() && key === wishlistKey(namespace, env, userIdKey(userId))) migrate(true);
        return;
      }
      if (!cache.delete(key)) return;
      emit();
      observe();
      observeRecords();
    },
  };
}

/** 完成した理想個体の通知。目標の名前は変えられないので、通知の文は完成を見たときから変わらない。 */
export function idealNotificationSource({ store, ideals }) {
  return () => ideals.list().flatMap((goal) => Object.entries(goal.worlds)
    .filter(([, world]) => world.completedAt)
    .map(([worldId, world]) => ({
      // 既読の保存先は環境共通のため、環境を含める。
      id: `ideal:${store.state.env}:${goal.id}:${worldId}:${world.completedAt}`,
      date: world.completedAt,
      title: '理想個体が完成しました',
      body: `「${goal.name}」の条件を満たす個体が${world.worldName ? `「${world.worldName}」` : ''}の所持パルにいます。`,
      href: buildHash('ideal', { to: goal.palId, p: goal.passives.join(','), g: goal.id }),
      // 通知欄の行の画像（目標の種族）
      palId: goal.palId,
    })));
}

/**
 * 目標の種族の配合の登録の通知（前のウィッシュリストの通知。goals-merge）。id は前のウィッシュリストと同じ形
 *（wishlist:<env>:<palId>:<readyAt>・wishlist:<env>:<palId>:<pair>:<at>）なので、既読はそのまま引き継がれる。
 * 知らせるのは「種族だけの目標」がある種族だけ（観測はすべての目標の種族で持つが、パッシブつきの目標に通知を増やさない）。
 * 文の親は登録済みの記録の親（配合表は使わない。INV-2）
 */
export function goalObservationSource({ store, ideals }) {
  return () => {
    const observations = ideals.observations();
    const targets = new Set(ideals.list().filter(isSpeciesGoal).map((goal) => goal.palId));
    return [...targets].flatMap((palId) => {
      const entry = observations.species[palId];
      if (!entry) return [];
      const name = palName(palId);
      const href = buildHash('search', { c: palId });
      const pairText = (pair) => pair.split('|').map(palName).join('＋');
      const ready = entry.readyAt ? [{
        id: `wishlist:${store.state.env}:${palId}:${entry.readyAt}`,
        date: entry.readyAt,
        title: `${name}の配合が登録されました`,
        body: entry.pairs?.length ? `${pairText(entry.pairs[0])} で作れます${entry.pairs.length > 1 ? `（ほか ${entry.pairs.length - 1} 組）` : ''}。` : '配合を探すで確認できます。',
        href, palId,
      }] : [];
      return [...ready, ...entry.found.map(({ pair, at }) => ({
        id: `wishlist:${store.state.env}:${palId}:${pair}:${at}`,
        date: at,
        title: `${name}の配合が増えました`,
        body: `${pairText(pair)} でも作れます。`,
        href, palId,
      }))];
    });
  };
}
