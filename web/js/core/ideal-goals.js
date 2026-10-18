// 登録した理想個体（目標）の形と、完成品の判定。遺伝の仕組み（core/ideal.js）は使わない。
import { sanitizeText } from './validate.js';
import { ownedWorldId, HOST_UID, hostIsPlayer, formerLabel, playerUidOfKey, legacyPlayerKey, playerGuid } from './owned-shared.js';
import { userIdKey } from './user.js';

export const GOAL_MODES = Object.freeze(['include', 'only']);
export const GOAL_CAKES = Object.freeze(['none', 'talent', 'special']);
export const GOAL_STATS = Object.freeze(['hp', 'shot', 'defense']);
export const GOAL_NAME_MAX = 30;
// 1 人が登録できる数と、1 件で覚えるワールドの数（端末の保存を膨らませないため）
export const GOAL_LIMIT = 100;
const WORLD_LIMIT = 20;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PAL_ID = /^[A-Za-z0-9_]{1,64}$/;
// パルの ID の形。Object の組み込みの名前（constructor・__proto__ など）は外す（観測などの辞書を palId で引いたときに継承したものを拾うため）
const palIdOk = (id) => typeof id === 'string' && PAL_ID.test(id) && !Object.hasOwn(Object.prototype, id);

const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const oneOf = (list, value, fallback) => (list.includes(value) ? value : fallback);
// 個体値の目標は 0〜100 の整数だけ受け付ける。読めない値は 0（条件なし〔画面ではチェックなし・空欄〕）ではなく 100 にして、誤って完成扱いにしない
const target = (value) => (Number.isInteger(value) && value >= 0 && value <= 100 ? value : 100);

function cleanWorld(value) {
  if (!value || typeof value !== 'object' || value.checked !== true || !validTime(value.observedAt)) return null;
  const complete = value.complete === true;
  return {
    checked: true, complete,
    completedAt: complete && validTime(value.completedAt) ? value.completedAt : '',
    observedAt: value.observedAt,
    worldName: sanitizeText(value.worldName, 100),
  };
}

/**
 * 登録した理想個体を検証して整える。形が合わないものは null（捨てる）。
 * worlds はワールドごとの完成の記録（checked: そのワールドで判定したか、complete: 完成しているか、
 * completedAt: 未完成から完成に変わったのを見た時刻〈通知に使う〉、observedAt: 判定に使ったセーブの時刻）。
 * 前に保存した並べ方（order）は読まない（画面の並べ方の選択はなくなった。残っていても捨てずに読み、保存し直すと消える）。
 */
export function cleanGoal(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !ID.test(value.id)) return null;
  if (!palIdOk(value.palId)) return null;
  const passives = Array.isArray(value.passives) ? [...new Set(value.passives.filter(palIdOk))].slice(0, 4) : [];
  const targets = Object.fromEntries(GOAL_STATS.map((key) => [key, target(value.targets?.[key])]));
  const worlds = {};
  const entries = value.worlds && typeof value.worlds === 'object' && !Array.isArray(value.worlds) ? Object.entries(value.worlds) : [];
  for (const [worldId, world] of entries) {
    const id = ownedWorldId(worldId);
    const clean = cleanWorld(world);
    if (id && clean) worlds[id] = clean;
  }
  // ワールドが多すぎるときは、最近判定したものを残す
  const kept = Object.entries(worlds).sort(([, a], [, b]) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, WORLD_LIMIT);
  return {
    id: value.id,
    name: sanitizeText(value.name, GOAL_NAME_MAX) || value.palId,
    palId: value.palId,
    passives,
    mode: oneOf(GOAL_MODES, value.mode, 'include'),
    targets,
    cake: oneOf(GOAL_CAKES, value.cake, 'none'),
    addedAt: validTime(value.addedAt) ? value.addedAt : '',
    worlds: Object.fromEntries(kept),
  };
}

/** 保存した JSON を読み、検証した一覧にする（同じ ID・同じ目標は先に出たものを残す。名前の変更で 2 つの登録をつないだときなど）。 */
export function parseGoals(source) {
  let values;
  try { values = JSON.parse(source); } catch { return []; }
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const goals = [];
  for (const value of values) {
    const goal = cleanGoal(value);
    if (!goal || seen.has(goal.id) || seen.has(goalKey(goal))) continue;
    seen.add(goal.id);
    seen.add(goalKey(goal));
    goals.push(goal);
  }
  return goals.slice(0, GOAL_LIMIT);
}

/**
 * 種族だけの目標（パッシブなし・個体値の条件なし〔0〕。画面のタグは「パルだけ」。前のウィッシュリストの 1 件。goals-merge）。
 * 保存の形は今の目標のまま（cleanGoal に通せる値。id は呼び出し側が付ける）
 */
export function speciesGoal(palId, { name = '', addedAt = '' } = {}) {
  return { palId, name: name || palId, passives: [], mode: 'include', targets: { hp: 0, shot: 0, defense: 0 }, cake: 'none', addedAt, worlds: {} };
}

/** 種族だけの目標か（mode 'only' でパッシブなしは「パッシブを持たない個体」という条件なので含めない） */
export const isSpeciesGoal = (goal) => goal.passives.length === 0 && goal.mode === 'include' && GOAL_STATS.every((key) => goal.targets[key] === 0);

/**
 * 同じ目標かを比べるための文字列。完成の条件（パル・欲しいパッシブ・パッシブの条件・個体値の目標）だけで比べる
 * （ケーキは作り方なので含めない。含めると、同じ完成で通知が重なる）。パッシブの順番は問わない。
 */
export function goalKey(goal) {
  return JSON.stringify([goal.palId, [...goal.passives].sort(), goal.mode, GOAL_STATS.map((key) => goal.targets[key])]);
}

/**
 * 設定の「このワールドでの自分」（self。プレイヤーの鍵 'i:'・'u:' か前の版の UID）を、その回のプレイヤーの uid に引く。引けなければ ''。
 * 'i:' を引けず、どのプレイヤーにも InstanceId がない（版 12 の GAS・古い画面が送った共有）ときは、キャラクターがいなくなったのか
 * InstanceId が届かなかっただけなのか分からない。そのときは、そのキャラクターで前に引けた UID（lastUid。H 以外。self-player.js が覚える）で引き、
 * 引けなければ null（同じ名前などで別の人に切り替えない）
 * @returns {string|null}
 */
export function selfPlayerUid(players, self, lastUid = '') {
  const list = Array.isArray(players) ? players : [];
  const uid = playerUidOfKey(list, self);
  if (uid || !legacyPlayerKey(self).startsWith('i:') || list.some((player) => playerGuid(player?.instanceId))) return uid;
  const last = legacyPlayerKey(lastUid);
  return (last.startsWith('u:') && last !== `u:${HOST_UID}` ? playerUidOfKey(list, last) : '') || null;
}

/**
 * 自分（ログイン中の ID）にあたるセーブのプレイヤー。決め方は次の順:
 * 1. 設定の「このワールドでの自分」（self。プレイヤーの鍵 'i:'・'u:' か前の版の UID〔selfUid でも受ける〕。その回のプレイヤーに引けるときだけ。
 *    引ければその 1 人だけ。InstanceId のない共有では selfLastUid でも引く〔selfPlayerUid〕。それでも見分けられなければ空）
 * 2. 設定の「登録者の対応」（配合牧場の自動登録。プレイヤーの UID → ノートの ID）で自分の ID を選んだプレイヤー
 * 3. 対応を選んでいないプレイヤーのうち、ノートの ID と同じ名前のプレイヤー
 * 2・3 は配合牧場の自動登録の core/auto-breeding.js の mappedUser と同じ規則（そちらは自動登録の外から読まないので、ここに置く）。
 * 1〜3 で 1 人以上決まったときだけ、プレイヤーにいない UID（以前の持ち主。サーバーのワールドの H など）のうち、対応で自分の ID を選んだものを
 * 足す（1 人も決まらないときに足すと、所持者の「自分」が出ないのに自分の個体だけがある、になる）。
 * ログインしていなければ（userId が空）空。
 * @param {{ uid: string, name: string, instanceId?: string }[]} players
 * @param {{ userId: string, users?: string[], mapping?: Record<string, string>, self?: string, selfUid?: string, selfLastUid?: string }} identity
 *   mapping はプレイヤーの UID → ID
 * @returns {Set<string>} プレイヤーの UID（以前の持ち主の UID を含む）
 */
export function ownPlayerUids(players, { userId, users = [], mapping = {}, self = '', selfUid = '', selfLastUid = '' }) {
  const me = userId ? userIdKey(userId) : '';
  const known = new Set(users.map(userIdKey));
  const mine = new Set();
  if (!me) return mine;
  const mappedTo = (chosen) => (known.has(userIdKey(chosen)) ? userIdKey(chosen) : '');
  // このワールドでの自分。別のワールドの値・プレイヤーが消えたときは、ここで決めずに 2・3 の規則に戻る。InstanceId のない共有で
  // 見分けられないときは、別の人を自分にしない
  const chosenSelf = selfPlayerUid(players, self || selfUid, selfLastUid);
  if (chosenSelf === null) return mine;
  if (chosenSelf) mine.add(chosenSelf);
  else {
    for (const player of players) {
      const chosen = mapping[player.uid];
      const user = chosen ? mappedTo(chosen) : known.has(userIdKey(player.name)) ? userIdKey(player.name) : '';
      if (user === me) mine.add(player.uid);
    }
  }
  if (!mine.size) return mine;
  const present = new Set(players.map((player) => player.uid));
  for (const [uid, chosen] of Object.entries(mapping)) if (!present.has(uid) && chosen && mappedTo(chosen) === me) mine.add(uid);
  return mine;
}

/**
 * プレイヤーの個体: 手持ち・パルボックス・パル次元ストレージ・持っているタマゴ（所持者がそのプレイヤー）、
 * そのプレイヤーが預けた拠点のパル、ホストならグローバルパルボックスの個体。
 * @param {{ players: object[], pals: object[] }} data normalizeOwned / ownedFromShared の結果
 * @param {Set<string>} uids プレイヤーの UID
 */
export function palsOfPlayers(data, uids) {
  // 共有されたデータには預けた人の UID がなく、名前だけがある。同じ名前のプレイヤーが複数いるときは、どちらか分からないので数えない
  const players = data.players ?? [];
  const count = new Map();
  for (const player of players) count.set(player.name, (count.get(player.name) ?? 0) + 1);
  const names = new Set(players.filter((player) => player.name && uids.has(player.uid) && count.get(player.name) === 1).map((player) => player.name));
  // プレイヤーにいない UID（以前の持ち主）は、送った側が付けた表示名（formerLabel。「以前のホスト」など）で比べる。同じ名前のプレイヤーが
  // いれば、どちらか分からないので数えない
  const present = new Set(players.map((player) => player.uid));
  for (const uid of uids) if (!present.has(uid) && !count.has(formerLabel(uid))) names.add(formerLabel(uid));
  // 拠点に置かれたタマゴ（地面・孵化器・保管箱）には最後の持ち主が入らないので、誰の個体にもしない（孵化させて受け取った人の個体になる）
  // 観賞用ケージ（display。save-extras）の個体も拠点の個体と同じく、預けた人（最後の持ち主）の個体にする
  // グローバルパルボックスは協力プレイのホスト（H）のもの。H がプレイヤーにいないワールド（サーバー）では、以前のホストを自分に対応づけて
  // uids に H があっても数えない
  const hostGlobal = uids.has(HOST_UID) && hostIsPlayer(players);
  return data.pals.filter((pal) => (pal.holderUid && uids.has(pal.holderUid))
    || ((pal.place === 'base' || pal.place === 'display') && (pal.lastOwnerUid ? uids.has(pal.lastOwnerUid) : Boolean(pal.lastOwner) && names.has(pal.lastOwner)))
    || (pal.place === 'global' && hostGlobal));
}

/** 自分の個体（palsOfPlayers の自分の分）。自分のプレイヤーが分からなければ null。 */
export function ownPals(data, identity) {
  const mine = ownPlayerUids(data.players ?? [], identity);
  return mine.size ? palsOfPlayers(data, mine) : null;
}

/**
 * 登録した理想個体の条件を満たす個体（完成品）。目標と同じ種族で、パッシブの条件（全部持つ／欲しいものだけ）と
 * 個体値の目標（0 は条件なし〔画面ではチェックなし・空欄〕）を満たすもの。所持しているので、グローバルパルボックスの個体も含める。
 * 性別は問わない。タマゴは数えない（孵化させて受け取ったら完成）。
 * @param {{ palId: string, passives: string[], mode: 'include'|'only', targets: object }} goal cleanGoal で整えたもの
 * @param {object[]} pals normalizeOwned の pals
 */
export function goalMatches(goal, pals) {
  if (!goal.palId) return [];
  const meets = goalTest(goal);
  return pals.filter((pal) => pal.palId === goal.palId && meets(pal));
}

/**
 * 目標の条件を満たすタマゴ（孵化させれば完成。farm-board の F048・N-16）。goalMatches と同じ条件をタマゴだけに当てる（goalMatches・完成の
 * 判定・通知・親の候補は変えない。95423e5 の「タマゴは孵化するまで使わない」のまま）。mine（自分の個体）を渡すと、そのうちのタマゴと、
 * 拠点に置かれた持ち主のないタマゴ（孵化させた人の個体になる）だけ。中身の分からないタマゴ（palId が空）は種族が合わないので外れる
 * @param {object} goal cleanGoal で整えたもの
 * @param {object[]} pals 全部の個体
 * @param {object[] | null} [mine] 自分の個体（省くと全部のタマゴ）
 */
export function eggMatches(goal, pals, mine = null) {
  if (!goal.palId) return [];
  const meets = goalTest(goal, { egg: true });
  const own = Array.isArray(mine) ? ownIds(mine) : null;
  return (eggsBySpecies(pals).get(goal.palId) ?? []).filter((pal) => (!own || own.has(pal.id) || !pal.holderUid) && meets(pal));
}

// 目標の一覧は目標ごとに同じ個体の配列を渡すので、配列から作る索引は配列ごとに 1 回だけ作って覚える（WeakMap。配列が捨てられたら消える）。
// 同じ種族の目標 100 件 × 同じ種族の 20,000 行で、目標ごとに全部の個体を見直すと、近い個体だけで約 1.3 秒・孵化待ちで約 0.4 秒
// 止まった（フェーズ 3 の終わりのレビュー）。個体の配列は作り直されるので（読み直し・ideals.mine()）、中身が変わっても古い索引は使わない
const memo = (build) => {
  const cache = new WeakMap();
  return (list) => {
    let value = cache.get(list);
    if (value === undefined) cache.set(list, (value = build(list)));
    return value;
  };
};
const ownIds = memo((mine) => new Set(mine.map((pal) => pal.id)));
const eggsBySpecies = memo((pals) => {
  const groups = new Map();
  for (const pal of pals) {
    if (!pal.egg || !pal.palId) continue;
    const group = groups.get(pal.palId);
    if (group) group.push(pal);
    else groups.set(pal.palId, [pal]);
  }
  return groups;
});
// タマゴでない個体を種族ごとに分け、個体値を型付き配列に写し、パッシブ → その種類を持つ個体の位置の一覧を持つ
const speciesIndex = memo((pals) => {
  const groups = new Map();
  for (const pal of pals) {
    if (pal.egg || !pal.palId) continue;
    let group = groups.get(pal.palId);
    if (!group) groups.set(pal.palId, (group = { pals: [], byPassive: new Map() }));
    const at = group.pals.length;
    group.pals.push(pal);
    const own = pal.passives;
    for (let i = 0; i < own.length; i++) {
      if (own.indexOf(own[i]) !== i) continue;
      const list = group.byPassive.get(own[i]);
      if (list) list.push(at);
      else group.byPassive.set(own[i], [at]);
    }
  }
  for (const group of groups.values()) {
    const size = group.pals.length;
    group.talent = { hp: new Int16Array(size), shot: new Int16Array(size), defense: new Int16Array(size) };
    group.distinct = new Uint8Array(size);
    // 個体値の目標ごとの、目標に届く個体の位置（talentReach。目標の一覧の手術で完成できる個体の数え上げに使う）
    group.reach = new Map();
    group.pals.forEach((pal, at) => {
      for (const key of GOAL_STATS) group.talent[key][at] = pal.talent[key];
      group.distinct[at] = distinctCount(pal.passives);
    });
  }
  return groups;
});

/**
 * 目標の一覧の 1 行に要るもの（goals-detail）: 完成品（goalMatches と同じ個体・同じ並び）と、完成品がなければいちばん近い個体（goalNearest と同じ）。
 * 種族ごとの索引を使い、目標ごとには欲しいパッシブを持つ個体の数え上げと個体値の型付き配列だけを見る。
 * canAdd（パッシブ ID → 後から付けられるか）を渡すと、完成品がないときだけ、足りないパッシブをすべて後から付ければ完成する個体のうち、
 * いちばん良い 1 体と数（addable）も同じ数え上げで求める（implants の「手術で完成できる」。views/ideal.js が手術台の表〔core/implants.js の
 * canImplant〕を渡す。この関数は表を知らない。目標の一覧は完成品があれば「完成済み」で、手術の判定を使わない）。
 * 1 体と数だけにするのは、目標 100 件 × 同じ種族 20,000 行で全部の個体を並べると 0.7 秒止まったため（全部は goalAddable）
 * @param {object} goal cleanGoal で整えたもの
 * @param {object[]} pals 自分の個体
 * @param {{ canAdd?: ((passiveId: string) => boolean) | null }} [options]
 * @returns {{ found: object[], nearest: ReturnType<typeof goalNearest>, addable: { pal: object, add: string[], count: number } | null }}
 *   addable は canAdd がない・完成品がある・そういう個体がいなければ null（並びは goalAddable の先頭と同じ）
 */
export function goalProgress(goal, pals, { canAdd = null } = {}) {
  return progressOf(goal, pals, false, canAdd);
}

// 目標の種族の索引と、欲しいパッシブのうち持っている数（持っている個体だけ、パッシブ → 個体の位置の一覧から数える）。種族がいなければ null
function scanOf(goal, pals) {
  const group = goal?.palId && Array.isArray(pals) ? speciesIndex(pals).get(goal.palId) : null;
  if (!group) return null;
  const wanted = [...new Set(goal.passives)];
  const counts = new Uint8Array(group.pals.length);
  let most = 0;
  for (const id of wanted) {
    for (const at of group.byPassive.get(id) ?? []) if (++counts[at] > most) most = counts[at];
  }
  const target = GOAL_STATS.map((key) => (goal.targets[key] > 0 ? goal.targets[key] : 0));
  return { group, wanted, counts, most, target, only: goal.mode === 'only' };
}

// withNearest: 完成品があっても、いちばん近い個体を求める（goalNearest）
function progressOf(goal, pals, withNearest, canAdd = null) {
  const scan = scanOf(goal, pals);
  if (!scan) return { found: [], nearest: null, addable: null };
  const { group, wanted, counts, most, target, only } = scan;
  const size = group.pals.length;
  const [hp, shot, defense] = target;
  const { talent, distinct } = group;
  const found = [];
  if (most === wanted.length) {
    for (let at = 0; at < size; at++) {
      if (counts[at] !== most || (only && distinct[at] !== most)) continue;
      if (talent.hp[at] >= hp && talent.shot[at] >= shot && talent.defense[at] >= defense) found.push(group.pals[at]);
    }
  }
  // 完成品があれば手術で完成できる個体は数えない（目標の一覧は完成済みと出す。性能 3: 種族の個体をもう 1 周しない）
  const addable = canAdd && !found.length ? bestAddable(scan, canAdd) : null;
  if (found.length && !withNearest) return { found, nearest: null, addable };
  // いちばん近い個体: 欲しいパッシブを持つ数が最も多い個体のうち、足りない個体値の合計が少ない順 → 個体 ID
  let best = -1;
  let bestLack = Infinity;
  for (let at = 0; at < size; at++) {
    if (counts[at] !== most) continue;
    const lack = Math.max(0, hp - talent.hp[at]) + Math.max(0, shot - talent.shot[at]) + Math.max(0, defense - talent.defense[at]);
    if (lack < bestLack || (lack === bestLack && group.pals[at].id < group.pals[best].id)) {
      best = at;
      bestLack = lack;
    }
  }
  const pal = group.pals[best];
  const short = Object.fromEntries(GOAL_STATS.map((key, i) => [key, Math.max(0, target[i] - pal.talent[key])]));
  return { found, nearest: { pal, passives: { have: most, total: wanted.length }, short, extra: only ? Math.max(0, distinct[best] - most) : 0 }, addable };
}

// 個体が持てるパッシブの数（ゲームの枠）
const PASSIVE_SLOTS = 4;
// 種族の索引ごとに覚える、個体値の目標の数（目標が違う個体値で 100 件あっても、覚える量を抑える）
const REACH_MEMORY = 16;

// 個体値の目標（[hp, shot, defense]。0 は条件なし）に届く個体の位置（昇順）。種族の索引（個体の配列ごとに作り直す）に目標ごとに覚える
function talentReach(group, [hp, shot, defense]) {
  const key = `${hp},${shot},${defense}`;
  const known = group.reach.get(key);
  if (known) return known;
  const { talent } = group;
  const list = [];
  for (let at = 0; at < group.pals.length; at++) {
    if (talent.hp[at] >= hp && talent.shot[at] >= shot && talent.defense[at] >= defense) list.push(at);
  }
  if (group.reach.size < REACH_MEMORY) group.reach.set(key, list);
  return list;
}

/**
 * 足りないパッシブ（1 個以上）をすべて後から付ければ完成する個体の位置ごとに visit(at) を呼ぶ。完成品（足りないものがない個体）は入れない。
 * 条件: 個体値の目標を満たす・付けられないパッシブ（canAdd が false）は全部持っている・「欲しいものだけ」なら余計なパッシブの数が
 * 足りないパッシブの数以下（付けるときに余計なものの枠へ上書きするので、その数までしか消せない）・付けた後の数が枠を超えない
 *（持っている数＋足りない数−上書きする余計な数。「全部持つ」は余計なものへも上書きできるので、欲しいものが 4 個までならいつも収まる）
 */
function scanAddable({ group, wanted, counts, target, only }, canAdd, visit) {
  const [hp, shot, defense] = target;
  const hard = wanted.filter((id) => !canAdd(id));
  const { talent, distinct } = group;
  // 付けられないパッシブがあれば、それを全部持つ個体だけを見る（いちばん少ない持ち主の一覧から引き、残りは数えて確かめる）
  let positions = null;
  let hardCounts = null;
  if (hard.length) {
    const lists = hard.map((id) => group.byPassive.get(id) ?? []);
    positions = lists.reduce((a, b) => (b.length < a.length ? b : a));
    if (!positions.length) return;
    hardCounts = new Uint8Array(group.pals.length);
    for (const list of lists) for (const at of list) hardCounts[at]++;
  }
  // 個体値の目標があれば、目標に届く個体の一覧の方が短ければそちらから引く（目標の一覧は同じ個体値の目標〔既定の 100・100・100〕が多く、
  // 届く個体はわずかなので、種族の全部の個体をもう 1 周しない。性能 3）
  if (hp || shot || defense) {
    const reach = talentReach(group, target);
    if (!positions || reach.length < positions.length) positions = reach;
    if (!positions.length) return;
  }
  const check = (at) => {
    const missing = wanted.length - counts[at];
    if (missing < 1 || (hardCounts && hardCounts[at] !== hard.length)) return;
    if (talent.hp[at] < hp || talent.shot[at] < shot || talent.defense[at] < defense) return;
    const extra = distinct[at] - counts[at];
    if (only && extra > missing) return;
    const overwrite = only ? extra : Math.min(extra, missing);
    if (distinct[at] + missing - overwrite > PASSIVE_SLOTS) return;
    visit(at);
  };
  if (positions) for (const at of positions) check(at);
  else for (let at = 0; at < group.pals.length; at++) check(at);
}

// 並び: 付ける数の少ない順（＝持っている欲しいパッシブの多い順）→ Lv の高い順 → 個体 ID
const addableOrder = (group, counts) => (a, b) => counts[b] - counts[a] || (group.pals[b].level ?? 0) - (group.pals[a].level ?? 0)
  || (group.pals[a].id < group.pals[b].id ? -1 : group.pals[a].id > group.pals[b].id ? 1 : 0);
const addableEntry = ({ group, wanted }, at) => ({ pal: group.pals[at], add: wanted.filter((id) => !group.pals[at].passives.includes(id)) });

// いちばん良い 1 体と数（並べない。goalProgress）
function bestAddable(scan, canAdd) {
  const order = addableOrder(scan.group, scan.counts);
  let best = -1;
  let count = 0;
  scanAddable(scan, canAdd, (at) => {
    count++;
    if (best < 0 || order(at, best) < 0) best = at;
  });
  return best < 0 ? null : { ...addableEntry(scan, best), count };
}

/**
 * 足りないパッシブ（1 個以上）をすべて後から付ければ完成する個体の全部（条件は goalProgress の addable と同じ。並び: 付ける数の少ない順 →
 * Lv の高い順 → 個体 ID）。core/implants.js の goalNear が手術台の表を渡す
 * @param {object} goal cleanGoal で整えたもの
 * @param {object[]} pals 個体
 * @param {(passiveId: string) => boolean} canAdd 後から付けられるパッシブか
 * @returns {{ pal: object, add: string[] }[]}
 */
export function goalAddable(goal, pals, canAdd) {
  const scan = scanOf(goal, pals);
  if (!scan) return [];
  const positions = [];
  scanAddable(scan, canAdd, (at) => positions.push(at));
  return positions.sort(addableOrder(scan.group, scan.counts)).map((at) => addableEntry(scan, at));
}

/**
 * 未完成の目標に、いちばん近い自分の個体と、足りないもの（goals-detail の I-24）。種族が同じでタマゴでない個体だけ。
 * 決め方: 欲しいパッシブを持つ数が多い順 → 目標に足りない個体値の合計が少ない順 → 個体 ID。個体値の目標 0（条件なし）の能力は不足 0
 * @param {object} goal cleanGoal で整えたもの
 * @param {object[]} pals 自分の個体
 * @returns {{ pal: object, passives: { have: number, total: number }, short: { hp: number, shot: number, defense: number }, extra: number } | null}
 *   extra は「欲しいものだけ」のときの余計なパッシブの数（それ以外は 0）。同じ種族がいなければ null
 */
export function goalNearest(goal, pals) {
  return progressOf(goal, pals, true).nearest;
}

// 個体のパッシブの種類の数（同じパッシブが重なっていても 1 つ）。パッシブは 4 個までなので、Set を作らずに数える
function distinctCount(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) if (list.indexOf(list[i]) === i) count++;
  return count;
}

// 目標の完成の条件（種族は見ない）を、目標ごとに 1 回だけ組み立てる。個体ごとに Set や配列を作らない
//（同じ種族の目標 100 件 × 同じ種族の 20,000 行で、個体ごとに Set を作ると 1 秒以上止まったため）
function goalTest(goal, { egg = false } = {}) {
  const wanted = [...new Set(goal.passives)];
  const only = goal.mode === 'only';
  // 個体値の目標（GOAL_STATS の hp・shot・defense。0 以下は条件なし）
  const [hp, shot, defense] = GOAL_STATS.map((key) => (goal.targets[key] > 0 ? goal.targets[key] : 0));
  return (pal) => {
    // 完成の判定はタマゴを数えない（egg: true は孵化待ちのタマゴだけを見る eggMatches）
    if (Boolean(pal.egg) !== egg) return false;
    const own = pal.passives;
    for (let i = 0; i < wanted.length; i++) if (!own.includes(wanted[i])) return false;
    if (only && distinctCount(own) !== wanted.length) return false;
    const { talent } = pal;
    return (hp === 0 || talent.hp >= hp) && (shot === 0 || talent.shot >= shot) && (defense === 0 || talent.defense >= defense);
  };
}

// 名前の後に文を続ける（英数字で終わる名前の後だけ空ける。views/ideal.js の joinName と同じ）
const joinName = (name, rest) => `${name}${/[0-9A-Za-z]$/.test(name) ? ' ' : ''}${rest}`;

/**
 * 登録した目標から、所持パルの行に出す個体ごとの印（O-52）。完成品（goalMatches）は「完成品: 目標名」、
 * 完成品でなく、同じ種族で目標の欲しいパッシブを 1 つ以上持つ個体は「目標名の欲しいパッシブ」。タマゴは数えない。
 * 個体を種族ごとにまとめてから、目標ごとにその種族の個体だけを見る（目標と個体が多くても、目標 × 全個体を見ない）。
 * 欲しいパッシブのある目標は、種族ごとに作った「パッシブ → それを持つ個体」の表から、欲しいパッシブを 1 つ以上持つ個体だけを見る
 *（持たない個体は完成品にも欲しいパッシブの印にもならない）。同じ種族の目標が多くても、個体ごとの材料は 1 回だけ作る。
 * 印の並びは目標の並び。登録した目標とセーブの情報だけを使う（配合の計算・配合表は使わない）
 * @param {object[]} goals cleanGoal で整えた目標
 * @param {object[]} pals normalizeOwned / ownedFromShared の pals
 * @returns {Map<string, string[]>} 個体 ID → 印の文（印のない個体は入れない）
 */
export function goalMarks(goals, pals) {
  const marks = new Map();
  if (!goals?.length) return marks;
  // 種族ごとの目標（目標の並びのまま）。目標ごとに、完成の判定・印の文を 1 回だけ作り、欲しいパッシブ → 目標の番号の表を作る
  const species = new Map();
  for (const goal of goals) {
    let entry = species.get(goal.palId);
    if (!entry) species.set(goal.palId, entry = { goals: [], wanting: new Map(), hits: null });
    const wanted = [...new Set(goal.passives)];
    const index = entry.goals.length;
    entry.goals.push({ meets: goalTest(goal), done: `完成品: ${goal.name}`, partly: joinName(goal.name, 'の欲しいパッシブ'), wanted: wanted.length > 0 });
    for (const id of wanted) {
      let list = entry.wanting.get(id);
      if (!list) entry.wanting.set(id, list = []);
      list.push(index);
    }
  }
  for (const entry of species.values()) entry.hits = new Int32Array(entry.goals.length);
  // 個体ごとに、その種族の目標を並びの順に 1 回ずつ見る（印の配列は個体ごとに 1 回で作る）。欲しいパッシブのある目標は、
  // 個体のパッシブから引いた「欲しいパッシブを 1 つ以上持つ目標」だけを確かめる
  let stamp = 0;
  for (const pal of pals) {
    if (pal.egg) continue;
    const entry = species.get(pal.palId);
    if (!entry) continue;
    stamp++;
    for (const id of pal.passives) {
      const indexes = entry.wanting.get(id);
      if (indexes) for (const index of indexes) entry.hits[index] = stamp;
    }
    let list = null;
    for (let index = 0; index < entry.goals.length; index++) {
      const goal = entry.goals[index];
      let text = null;
      if (!goal.wanted) {
        if (goal.meets(pal)) text = goal.done;
      } else if (entry.hits[index] === stamp) text = goal.meets(pal) ? goal.done : goal.partly;
      if (text === null) continue;
      if (list) list.push(text);
      else list = [text];
    }
    if (list) marks.set(pal.id, list);
  }
  return marks;
}
