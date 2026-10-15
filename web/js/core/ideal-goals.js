// 登録した理想個体（目標）の形と、完成品の判定。遺伝の仕組み（core/ideal.js）は使わない。
import { sanitizeText } from './validate.js';
import { ownedWorldId } from './owned-shared.js';
import { userIdKey } from './user.js';

// 協力プレイのホストの PlayerUId（SAVE_FORMAT.md）。グローバルパルボックスはホストのもの
const HOST_UID = '00000000-0000-0000-0000-000000000001';

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
 * 自分（ログイン中の ID）にあたるセーブのプレイヤー。決め方は次の順:
 * 1. 設定の「このワールドでの自分」（selfUid。そのワールドのプレイヤーにいるときだけ。いればその 1 人だけ）
 * 2. 設定の「登録者の対応」（配合牧場の自動登録。プレイヤーの UID → ノートの ID）で自分の ID を選んだプレイヤー
 * 3. 対応を選んでいないプレイヤーのうち、ノートの ID と同じ名前のプレイヤー
 * 2・3 は配合牧場の自動登録の core/auto-breeding.js の mappedUser と同じ規則（そちらは自動登録の外から読まないので、ここに置く）。
 * ログインしていなければ（userId が空）空。
 * @param {{ uid: string, name: string }[]} players
 * @param {{ userId: string, users?: string[], mapping?: Record<string, string>, selfUid?: string }} identity mapping はプレイヤーの UID → ID
 * @returns {Set<string>} プレイヤーの UID
 */
export function ownPlayerUids(players, { userId, users = [], mapping = {}, selfUid = '' }) {
  const me = userId ? userIdKey(userId) : '';
  const known = new Set(users.map(userIdKey));
  const mine = new Set();
  if (!me) return mine;
  // このワールドでの自分。別のワールドの値・プレイヤーが消えたときは、ここで決めずに 2・3 の規則に戻る
  if (selfUid && players.some((player) => player.uid === selfUid)) return new Set([selfUid]);
  for (const player of players) {
    const chosen = mapping[player.uid];
    const user = chosen ? (known.has(userIdKey(chosen)) ? userIdKey(chosen) : '') : known.has(userIdKey(player.name)) ? userIdKey(player.name) : '';
    if (user === me) mine.add(player.uid);
  }
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
  // 拠点に置かれたタマゴ（地面・孵化器・保管箱）には最後の持ち主が入らないので、誰の個体にもしない（孵化させて受け取った人の個体になる）
  return data.pals.filter((pal) => (pal.holderUid && uids.has(pal.holderUid))
    || (pal.place === 'base' && (pal.lastOwnerUid ? uids.has(pal.lastOwnerUid) : Boolean(pal.lastOwner) && names.has(pal.lastOwner)))
    || (pal.place === 'global' && uids.has(HOST_UID)));
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

// 個体のパッシブの種類の数（同じパッシブが重なっていても 1 つ）。パッシブは 4 個までなので、Set を作らずに数える
function distinctCount(list) {
  let count = 0;
  for (let i = 0; i < list.length; i++) if (list.indexOf(list[i]) === i) count++;
  return count;
}

// 目標の完成の条件（種族は見ない）を、目標ごとに 1 回だけ組み立てる。個体ごとに Set や配列を作らない
//（同じ種族の目標 100 件 × 同じ種族の 20,000 行で、個体ごとに Set を作ると 1 秒以上止まったため）
function goalTest(goal) {
  const wanted = [...new Set(goal.passives)];
  const only = goal.mode === 'only';
  // 個体値の目標（GOAL_STATS の hp・shot・defense。0 以下は条件なし）
  const [hp, shot, defense] = GOAL_STATS.map((key) => (goal.targets[key] > 0 ? goal.targets[key] : 0));
  return (pal) => {
    if (pal.egg) return false;
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
