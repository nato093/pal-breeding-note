import { userIdKey } from './core/user.js';
import { ownedWorldId } from './core/owned-shared.js';
import { cleanGoal, parseGoals, goalKey, goalMatches, ownPals, GOAL_LIMIT } from './core/ideal-goals.js';
import { buildHash } from './router.js';

const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

// 登録した理想個体（目標）は、この端末にだけ ID・環境ごとに残す（ウィッシュリストと同じ）。
// 完成の判定は、表示しているワールドの所持パル（セーブから読んだもの・共有されたもの）で、ワールドごとに行う。
// 判定に使ったセーブの時刻（observedAt）より新しいデータを受けたときだけ判定し直す。起動時の保存済みデータや、
// 古いデータのままの別のタブで、新しいデータでの判定を巻き戻さないため。
// 判定するのは自分の個体だけ（identity: ログイン中の ID・ユーザー一覧・セーブのプレイヤーとの対応。core/ideal-goals.js の ownPals）。
// 自分のプレイヤーが分からないときは判定しない。
// そのワールドで初めて判定したときは、完成していても知らせない（登録した時点で完成していたものなど）。
// 未完成から完成に変わるのを見たときだけ completedAt を付けて知らせ、未完成に戻ったら外す（通知も消える）。
export function createIdealStore({
  store, owned, storage, namespace = 'pal-note', now = Date.now, uuid = () => crypto.randomUUID(),
  identity = () => ({ userId: store.state.userId, users: store.state.users ?? [], mapping: {} }),
}) {
  const listeners = new Set();
  const cache = new Map();
  let saveFailed = false;
  const emit = () => listeners.forEach((listener) => listener());

  function scope() {
    const { env, userId, passcode } = store.state;
    return env && userId && passcode ? `${namespace}.ideals.${env}.${userIdKey(userId)}` : '';
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

  // 1 件の、そのワールドでの記録を新しいデータで作り直す。notify が false なら完成していても知らせない
  function judged(goal, view, byPal, notify) {
    const complete = goalMatches(goal, byPal.get(goal.palId) ?? []).length > 0;
    const before = goal.worlds[view.worldId];
    const checked = notify && before?.checked === true;
    // 完成を見た時刻は、判定したセーブの時刻にする（別のタブがほぼ同時に判定しても同じ値になり、通知が重ならない）
    const completedAt = !complete ? '' : checked && !before.complete ? view.at : (checked ? before.completedAt : '');
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
    save(key, goals.map((goal) => (stale(goal, view) ? judged(goal, view, byPal, true) : goal)));
  }

  store.subscribe(observe);
  owned?.subscribe(observe);
  observe();

  return {
    scope,
    get saveFailed() { return saveFailed; },
    list(key = scope()) { return load(key); },
    mine,
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
      if (view) goal = judged(goal, view, bySpecies(view.pals), false);
      save(key, [goal, ...goals]);
      return 'added';
    },
    remove(id, key = scope()) {
      const goals = latest(key);
      const index = goals.findIndex((goal) => goal.id === id);
      if (index < 0 || store.state.renaming) return null;
      save(key, goals.filter((goal, at) => at !== index));
      return { goal: goals[index], index };
    },
    // 外した時点の ID・環境に戻し、外している間に届いたデータで判定し直す。名前を変えた後や、同じ条件を登録し直した後は戻さない
    restore(goal, index, key) {
      if (!key || key !== scope() || store.state.renaming) return false;
      const goals = latest(key);
      if (goals.length >= GOAL_LIMIT || goals.some((item) => item.id === goal.id || goalKey(item) === goalKey(goal))) return false;
      save(key, [...goals.slice(0, index), goal, ...goals.slice(index)]);
      observe();
      return true;
    },
    // 別のタブで書き換わったら読み直し、そのタブが古いデータで登録した分も判定する。
    reload(key) {
      if (!cache.delete(key)) return;
      emit();
      observe();
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
    })));
}
