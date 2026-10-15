// セーブから読み込んだ所持パル（スナップショット）や、スプレッドシートで共有された所持パルを、
// 画面・継承ルート・表計算で使う形にする。DOM には触れない。
// スナップショットの形は web/js/save/palworld.js の buildSnapshot、共有の列は core/owned-shared.js を参照。
import { OWNED_FIELDS, cleanOwnedFarms, fitOwnedFarms, isMutationEggItem, OWNED_FARM_EGGS_MAX } from './owned-shared.js';
import { isObject, int, intOrNull, text, idText, internalName, list, cleanSharedPlayers, cleanSharedBases, PLAYERS_MAX, BASES_MAX } from './boundary.js';
import { normalizeQuery, queryTerms } from './kana.js';
import humanList from '../../data/humans.js';
import { ELEMENTS } from '../../data/pals.js';
import passiveList from '../../data/passives.js';
import { ACTIVE_SKILLS, PARTNER_SKILLS, ACTIVE_SKILL_DESCS, PARTNER_SKILL_DESCS } from '../../data/skills.js';
import { EGG_NAMES, CAKE_NAMES } from '../../data/items.js';
import palWork, { WORKS } from '../../data/work.js';

// 野生のボス（アルファ）などは CharacterID に接頭辞が付く（例: BOSS_IceHorse）。
const PREFIXES = ['BOSS_', 'GYM_', 'RAID_', 'PREDATOR_'];

export const PLACE_LABELS = Object.freeze({
  party: '手持ち',
  palbox: 'パルボックス',
  base: '拠点',
  // 拠点の観賞用ケージ（MapObjectId が DisplayCharacter。save-extras。古い画面は知らない場所を「不明」として受ける）
  display: '観賞用ケージ',
  dps: 'パル次元ストレージ',
  global: 'グローバルパルボックス',
  'egg-ground': 'タマゴ（地面）',
  'egg-incubator': 'タマゴ（孵化器）',
  'egg-chest': 'タマゴ（保管箱）',
  'egg-inventory': 'タマゴ（所持品）',
  'egg-guild': 'タマゴ（ギルド保管庫）',
  unknown: '不明',
});

// 一覧の「場所」の絞り込みに出す順番
export const PLACE_ORDER = ['party', 'palbox', 'base', 'display', 'dps', 'global', 'egg', 'unknown'];

export const placeGroup = (kind) => (String(kind).startsWith('egg-') ? 'egg' : kind);

export function placeGroupLabel(group) {
  return group === 'egg' ? 'タマゴ' : PLACE_LABELS[group] ?? '不明';
}

// パルボックスの並び。1 ページ 30 枠・横 6 列（ゲームの PalBoxSlotNumInPage。2026-10-08 にゲーム内で確認）
export const PALBOX_PAGE_SIZE = 30;
export const PALBOX_COLUMNS = 6;

/** パルボックスの通し番号（セーブの SlotId.SlotIndex。0 始まり）から、ページと行・列（どれも 1 始まり）を求める。 */
export function palboxPosition(slotIndex) {
  const index = Number(slotIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  const inPage = index % PALBOX_PAGE_SIZE;
  return { page: Math.floor(index / PALBOX_PAGE_SIZE) + 1, row: Math.floor(inPage / PALBOX_COLUMNS) + 1, column: (inPage % PALBOX_COLUMNS) + 1 };
}

/**
 * パルボックスの位置の文字（placeLabel。共有の列にもこのまま載る）。書式を変えると、共有から位置（parseBoxLabel）が読めなくなるので変えない
 * （古い画面から共有された行も同じ書式で読む）
 */
export function palboxLabel({ page, row, column }) {
  return `${PLACE_LABELS.palbox} ${page} ページ・${row} 行 ${column} 列`;
}

const BOX_LABEL = /^パルボックス (\d{1,4}) ページ・(\d) 行 (\d) 列$/;
const BOX_ROWS = PALBOX_PAGE_SIZE / PALBOX_COLUMNS;
/**
 * placeLabel（palboxLabel の書式）からパルボックスの位置を読む（共有のデータには位置の列がないので、文字から読み戻す）。
 * 書式が違う・範囲の外なら null（古い共有の「パルボックス」など。画面は文字だけを出す）
 * @returns {{ page: number, row: number, column: number } | null}
 */
export function parseBoxLabel(label) {
  if (typeof label !== 'string') return null;
  const match = BOX_LABEL.exec(label);
  if (!match) return null;
  const [page, row, column] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (page < 1 || row < 1 || row > BOX_ROWS || column < 1 || column > PALBOX_COLUMNS) return null;
  return { page, row, column };
}

/**
 * 人間のキャラクター（密猟団・賞金首など。パルのマスターにはない）の名前とアイコンを引く。
 * 賞金首は BOSS_ 付きの行に専用の名前とアイコンがあるので、そのままの ID を先に引き、なければ接頭辞を外して引く。
 */
export function createHumanResolver(humans = humanList) {
  const byLower = new Map(humans.map((human) => [human.id.toLowerCase(), human]));
  return (characterId) => {
    const raw = String(characterId ?? '').toLowerCase();
    const found = byLower.get(raw) ?? byLower.get(raw.replace(/^(boss|gym|raid|predator)_/, ''));
    return found ? { ja: found.ja, icon: found.icon } : null;
  };
}

// 大文字小文字の違い（セーブ側の表記ゆれ）も吸収して、マスターの ID を引く。
export function createSpeciesResolver(pals) {
  const byLower = new Map(pals.map((pal) => [pal.id.toLowerCase(), pal.id]));
  return (characterId) => {
    const raw = String(characterId ?? '');
    let base = raw;
    let alpha = false;
    for (const prefix of PREFIXES) {
      if (base.toUpperCase().startsWith(prefix)) {
        base = base.slice(prefix.length);
        alpha = prefix === 'BOSS_';
        break;
      }
    }
    return { palId: byLower.get(base.toLowerCase()) ?? '', alpha };
  };
}

/** プレイヤー・ギルドの UID の頭 8 字（- を除いた大文字。名前の分からない・同じ名前のプレイヤーを見分けるとき） */
export const shortUid = (uid) => String(uid ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();

// 協力プレイのホストの PlayerUId（SAVE_FORMAT.md）
const HOST_UID = '00000000-0000-0000-0000-000000000001';

export function playerName(players, uid) {
  if (!uid) return '';
  return players.get(uid)?.name || `不明なプレイヤー（${shortUid(uid)}）`;
}

const GENDERS = { Male: 'M', Female: 'F' };

const NO_WORK = Object.freeze({});

// 種類で決まる項目（キーワードで探す）。マスターにないもの（人間など）は空。work は作業適性（{ 作業の鍵: Lv }。web/data/work.js の
// 種族の値をそのまま指す。共有の個体も種族から引くので、共有の列は要らない。game-assets）
function speciesInfo(pal) {
  return {
    en: pal?.en ?? '', elements: (pal?.el ?? []).map((element) => ELEMENTS[element] ?? element),
    partnerSkill: PARTNER_SKILLS[pal?.id] ?? '', partnerSkillDesc: PARTNER_SKILL_DESCS[pal?.id] ?? '',
    work: palWork[pal?.id] ?? NO_WORK,
  };
}

/**
 * 作業適性の名前と Lv の並び（WORKS の順。Lv 1 以上だけ）。パル詳細・キーワードの一致の理由が使う
 * @param {Record<string, number> | undefined} work
 * @returns {{ key: string, name: string, level: number }[]}
 */
export function workEntries(work) {
  if (!work) return [];
  return Object.keys(WORKS).filter((key) => Number.isInteger(work[key]) && work[key] > 0).map((key) => ({ key, name: WORKS[key].ja, level: work[key] }));
}

// 作業の名前（そろえた文字）→ 作業の鍵。キーワードの「採掘3」（名前の直後の数字は Lv の下限）を読む
const WORK_BY_NAME = new Map(Object.entries(WORKS).map(([key, { ja }]) => [normalizeQuery(ja), key]));
const workTermCache = new Map();
/** 語（そろえた後）が「作業の名前＋数字」なら { key, level }、ほかは null */
function workTerm(term) {
  if (!workTermCache.has(term)) {
    // 数字は何桁でも Lv の下限（「採掘100」は当たる個体なし。文字の部分一致には戻さない）
    const match = /^(.+?)(\d+)$/.exec(term);
    const key = match ? WORK_BY_NAME.get(match[1]) : undefined;
    if (workTermCache.size >= 1000) workTermCache.clear();
    workTermCache.set(term, key ? { key, level: Math.max(1, Number(match[2])) } : null);
  }
  return workTermCache.get(term);
}
const workMatches = (pal, { key, level }) => (pal.work?.[key] ?? 0) >= level;

// セーブとゲームの表で、ID の大文字小文字が違うものがある（セーブの Railbolt と名前の表の RailBolt）
const byLowerId = (object) => new Map(Object.entries(object).map(([id, text]) => [id.toLowerCase(), text]));
const activeSkillNames = byLowerId(ACTIVE_SKILLS);
const activeSkillDescs = byLowerId(ACTIVE_SKILL_DESCS);

// 覚えているアクティブスキル（ID と名前・説明）。名前の表にないものは ID のまま出す
function skillInfo(ids) {
  const skills = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : [];
  return {
    skills,
    skillNames: skills.map((id) => activeSkillNames.get(id.toLowerCase()) ?? id),
    skillDescs: skills.map((id) => activeSkillDescs.get(id.toLowerCase()) ?? ''),
  };
}

// 読み戻した値の範囲（core/boundary.js）。欠けている・壊れているときは今までと同じ既定の値にする
const TALENT = { min: 0, max: 100, fallback: 0 };
const LEVEL = { min: 1, max: 999, fallback: 1 };
const RANK = { min: 1, max: 5, fallback: 1 };
const STARS_RANGE = { min: 0, max: 4, fallback: 0 };
// 1 牧場のタマゴ（セーブの解析が読む数。web/js/save/palworld.js の MAX_FARM_EGGS）
const FARM_EGGS_MAX = 64;
// パッシブは 5 個以上も切り詰めない（理想個体の計算が別に扱う）。重複を除き 16 個まで。
// 共有の 20,000 行で行ごとに Set や関数を作らないよう、ループで書く（数が少ないので重複は includes で見る）
const PASSIVES_MAX = 16;
function cleanPassives(ids) {
  if (!Array.isArray(ids)) return [];
  const result = [];
  for (const value of ids) {
    const id = text(value, 64);
    if (!id || result.includes(id)) continue;
    result.push(id);
    if (result.length >= PASSIVES_MAX) break;
  }
  return result;
}
const talentOf = (hp, shot, defense) => ({ hp: int(hp, TALENT), shot: int(shot, TALENT), defense: int(defense, TALENT) });

// ---- save-extras（入手時刻・魂の強化・病気と空腹と SAN・プレイ中・Day）。どれも欠けている（古いスナップショット・共有）なら「不明」 ----
// 入手した時刻は toISOString の形（ミリ秒つき・Z）だけを残す（同じ形の文字列どうしなら、文字の順で時刻の順に比べられる。NEW の判定）
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** 時刻の文字列（toISOString の形）ならそのまま、違えば '' */
export const ownedTime = (value) => (typeof value === 'string' && ISO_MS.test(value) && Number.isFinite(Date.parse(value)) ? value : '');
const SOUL = { min: 0, max: 100, fallback: 0 };
// 魂の強化（{ hp, attack, defense, craft }。段階の数）。スナップショットにない（読む前のセーブ）・共有では null
function soulOf(value) {
  if (!isObject(value)) return null;
  return { hp: int(value.hp, SOUL), attack: int(value.attack, SOUL), defense: int(value.defense, SOUL), craft: int(value.craft, SOUL) };
}
// 病気（種類の名前。なければ ''）・空腹（Default 以外の種類。なければ ''）・SAN（0〜100。読めなければ null）。ないとき null
function conditionOf(value) {
  if (!isObject(value)) return null;
  const sanity = typeof value.sanity === 'number' && Number.isFinite(value.sanity) ? Math.min(100, Math.max(0, Math.round(value.sanity * 10) / 10)) : null;
  return { sick: internalName(value.sick, 64), hunger: internalName(value.hunger, 64), sanity };
}
// プレイヤーの Lv（0 は分からない）とプレイ中（true・false、分からなければ null）
const PLAYER_LEVEL = { min: 0, max: 999, fallback: 0 };
const playerExtras = (player) => ({ level: int(player.level, PLAYER_LEVEL), online: typeof player.online === 'boolean' ? player.online : null });

// ---- 捕獲数（paldex。Players/<uid>.sav の RecordData の PalCaptureCount。ホストの画面だけ・共有しない） ----
const CAPTURE_COUNT_MAX = 10000000;
const CAPTURE_ENTRIES_MAX = 2000;
/**
 * スナップショットのプレイヤーの捕獲数（[{ id: キャラクター ID, count }]）を { パル ID: 回数 } にする。キャラクター ID はマスターの ID に
 * 引き（大文字小文字の違い・BOSS_ などの接頭辞もそろえ、同じ種族は合わせる）、人間などマスターにないキーと 0 回は捨てる。
 * 捕獲数のない古いスナップショット・形の違う値（配列でない、空でないのに形の合う項目が 1 つもない）は null（分からない。「捕獲 0 回」と
 * 区別する）。空の配列は「捕まえていない」（{}）
 */
function capturesOf(value, resolve) {
  if (!Array.isArray(value)) return null;
  const total = new Map();
  let valid = 0;
  for (const entry of value.slice(0, CAPTURE_ENTRIES_MAX)) {
    if (!isObject(entry) || typeof entry.id !== 'string' || !Number.isInteger(entry.count) || entry.count < 0) continue;
    valid++;
    const palId = resolve(entry.id).palId;
    if (palId && entry.count > 0) total.set(palId, Math.min(CAPTURE_COUNT_MAX, (total.get(palId) ?? 0) + entry.count));
  }
  return value.length && !valid ? null : Object.fromEntries(total);
}

/**
 * 自分のプレイヤー（uids。ideals の selfUids）の捕獲数を種族ごとに合わせる（パル詳細の「捕獲 N」と図鑑のマスの数。paldex）。
 * 自分が分からない・自分のプレイヤーに捕獲数がない（参加者の画面・共有のデータ・古いスナップショット）なら null（出さない）
 * @param {{ uid: string, captures?: Record<string, number> }[]} players normalizeOwned のプレイヤー
 * @param {Set<string>} uids
 * @returns {Map<string, number> | null}
 */
export function ownCaptures(players, uids) {
  if (!uids?.size) return null;
  let total = null;
  for (const player of players ?? []) {
    if (!uids.has(player?.uid) || !isObject(player.captures)) continue;
    total ??= new Map();
    for (const [palId, count] of Object.entries(player.captures)) total.set(palId, (total.get(palId) ?? 0) + count);
  }
  return total;
}
// ゲーム内の日数（1 以上。0・欠けている・読めなければ null）
const cleanDay = (value) => {
  const day = intOrNull(value, { min: 0, max: 1000000 });
  return day > 0 ? day : null;
};
// 牧場のケーキ（[{ itemId, count }]。[] はケーキ切れ、null は分からない。ホストの画面だけ）
const CAKES_MAX = 16;
function cakesOf(value) {
  if (!Array.isArray(value)) return null;
  return list(value, {
    max: CAKES_MAX,
    map: (cake) => (isObject(cake) && internalName(cake.itemId) && int(cake.count, { min: 0, fallback: 0 }) > 0
      ? { itemId: cake.itemId, count: int(cake.count, { min: 0, max: 1000000, fallback: 0 }) } : null),
  });
}

// ---- アイテムの在庫（implants。インプラントとパルリバーサー。ホストの画面だけ・共有しない） ----
// 在庫に数えるアイテム（web/js/save/palworld.js の STOCK_ITEM と同じ）と、場所の数（多い順に 3 つまで）
const STOCK_ITEM = /^(?:PalPassiveSkillChange_[A-Za-z0-9_]{1,100}|PalGenderReverse)$/i;
const STOCK_PLACES = 3;
const STOCK_ENTRIES_MAX = 5000;
const STOCK_COUNT = { min: 0, max: 1000000, fallback: 0 };
// 拠点の中の入れ物の呼び名（拠点 1 の箱・拠点 1 の配合牧場・拠点 1 の設備）
const STOCK_OBJECTS = Object.freeze({ chest: '箱', farm: '配合牧場', other: '設備' });
// 名前の後に文を続ける（英数字で終わる名前の後だけ空ける。「拠点 1 の箱」「Alice の所持品」）
const joinName = (name, rest) => `${name}${/[0-9A-Za-z]$/.test(name) ? ' ' : ''}${rest}`;
/**
 * スナップショットの items（buildSnapshot。アイテムと場所ごとの数）を、アイテム ID → { total, places: [{ label, count }] } にまとめる
 *（places は数の多い順に 3 つまで）。items のない古いスナップショットは null（分からない）
 */
function stockOf(value, { baseLabel, players }) {
  if (!Array.isArray(value)) return null;
  // アイテムは大文字小文字をそろえて合わせる（セーブの ID の書き方が違っても同じアイテム。表の ID は最初に見えた書き方）
  const byItem = new Map();
  for (const entry of list(value, { max: STOCK_ENTRIES_MAX, map: (item) => (isObject(item) ? item : null) })) {
    const itemId = typeof entry.itemId === 'string' && STOCK_ITEM.test(entry.itemId) ? entry.itemId : '';
    const count = int(entry.count, STOCK_COUNT);
    const id = idText(entry.id, 40);
    if (!itemId || !count) continue;
    // 入れ物の種類は知っている名前だけ（壊れた値・組み込みの名前〔constructor など〕はほかの設備）
    const object = typeof entry.object === 'string' && Object.hasOwn(STOCK_OBJECTS, entry.object) ? entry.object : 'other';
    const label = entry.where === 'base' ? joinName(baseLabel(id), `の${STOCK_OBJECTS[object]}`)
      : entry.where === 'guild' ? 'ギルド保管庫'
        : entry.where === 'player' && id ? joinName(playerName(players, id), 'の所持品') : '';
    if (!label) continue;
    const key = itemId.toLowerCase();
    let item = byItem.get(key);
    if (!item) byItem.set(key, (item = { itemId, places: new Map() }));
    item.places.set(label, (item.places.get(label) ?? 0) + count);
  }
  return Object.fromEntries([...byItem.values()].map(({ itemId, places }) => {
    const sorted = [...places].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return [itemId, { total: sorted.reduce((sum, [, count]) => sum + count, 0), places: sorted.slice(0, STOCK_PLACES).map(([label, count]) => ({ label, count })) }];
  }));
}

/**
 * アイテムの在庫（implants）。手元で読んだホストのデータ（normalizeOwned）にだけある。参加者（共有のデータ）・在庫を読む前の
 * スナップショットでは null（分からない）。読んだデータにないアイテムは { total: 0, places: [] }（在庫なし）
 * @param {object | null | undefined} owned normalizeOwned / ownedFromShared の結果
 * @param {string} itemId アイテム ID（PalPassiveSkillChange_*・PalGenderReverse。大文字小文字は問わない）
 * @returns {{ total: number, places: { label: string, count: number }[] } | null}
 */
export function itemStock(owned, itemId) {
  const items = owned?.items;
  if (!items || typeof items !== 'object' || typeof itemId !== 'string' || !itemId) return null;
  if (Object.hasOwn(items, itemId)) return items[itemId];
  const lower = itemId.toLowerCase();
  const found = Object.keys(items).find((key) => key.toLowerCase() === lower);
  return found ? items[found] : { total: 0, places: [] };
}

/**
 * 在庫の文（「在庫 5（拠点 1 の箱）」「在庫 7（拠点 1 の箱 5・ギルド保管庫 2）」「在庫なし」）。分からない（null）なら ''。
 * short は場所を付けない（「在庫 5」。括弧の中に入れるとき）
 */
export function stockText(stock, { short = false } = {}) {
  if (!stock) return '';
  if (!stock.total) return '在庫なし';
  if (short) return `在庫 ${stock.total}`;
  // 1 か所なら場所だけ、2 か所以上は数の多い 2 か所と数（残りがあれば「ほか」）
  const shown = stock.places.slice(0, 2);
  if (!shown.length) return `在庫 ${stock.total}`;
  if (shown.length === 1 && shown[0].count === stock.total) return `在庫 ${stock.total}（${shown[0].label}）`;
  const more = shown.reduce((sum, place) => sum + place.count, 0) < stock.total;
  return `在庫 ${stock.total}（${shown.map((place) => `${place.label} ${place.count}`).join('・')}${more ? ' ほか' : ''}）`;
}

/**
 * スナップショットを画面用の一覧にする。
 * @param {object} snapshot buildSnapshot の結果
 * @param {{ pals: object[], passives: object[] }} masters
 * @returns {{ world: object, players: object[], bases: object[], pals: object[], items: object | null, stats: object }}
 */
export function normalizeOwned(snapshot, { pals, passives, humans = humanList }) {
  const resolve = createSpeciesResolver(pals);
  const resolveHuman = createHumanResolver(humans);
  const palsById = new Map(pals.map((pal) => [pal.id, pal]));
  const passiveById = new Map(passives.map((passive) => [passive.id, passive]));
  // 読み戻したセーブの解析結果は、要素ごとに形を確かめる（壊れた要素だけを捨てる）。uid・拠点の ID は個体の所持者・場所と比べるので切り詰めない
  const objects = (value) => list(value, { map: (item) => (isObject(item) ? item : null) });
  // プレイヤーの Lv とプレイ中（save-extras）は形を確かめて入れ直す（古いスナップショットのプレイヤーには online がない＝分からない）。
  // 捕獲数（paldex）はパル ID ごとの回数にして、読めたプレイヤーだけに captures を付ける（古いスナップショットには項目がない）
  const players = new Map(objects(snapshot?.players).filter((player) => idText(player.uid, 40))
    .map(({ captures: raw, ...player }) => {
      const captures = capturesOf(raw, resolve);
      return [player.uid, { ...player, name: text(player.name, 50), ...playerExtras(player), ...(captures ? { captures } : {}) }];
    }));
  const bases = new Map(objects(snapshot?.bases).filter((base) => idText(base.id, 40)).map((base) => [base.id, base]));
  // ギルドが複数あるワールドでは、拠点の番号がギルドごとに重なるのでギルド名を添える
  const guildNames = new Map(objects(snapshot?.guilds).map((guild) => [guild.id, guild.name]));
  const multiGuild = new Set([...bases.values()].map((base) => base.guildId)).size > 1;
  const baseLabel = (id) => {
    const base = bases.get(id);
    const label = base?.number ? `拠点 ${base.number}` : '拠点';
    if (!multiGuild || !base) return label;
    const guild = guildNames.get(base.guildId);
    return `${label}（${guild && !/^[0-9a-f]{32}$/i.test(guild) ? guild : `ギルド ${shortUid(base.guildId)}`}）`;
  };
  // グローバルパルボックスは、セーブを読み込んだ PC のアカウント（協力プレイのホスト）のもの
  const globalHolder = players.get(HOST_UID)?.name || text(snapshot?.world?.hostName, 50) || 'ホスト';
  const entries = [];
  const seen = new Set();
  for (const source of objects(snapshot?.pals)) {
    // 個体 ID（1〜64 字）がない個体・同じ ID の後の個体は捨てる（先勝ち。共有も同じ）
    const id = idText(source.instanceId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const characterId = text(source.characterId, 200);
    const { palId, alpha } = resolve(characterId);
    const human = palId ? null : resolveHuman(characterId);
    const location = isObject(source.location) ? source.location : {};
    // 配列（["party"]）なども Object.hasOwn では文字列に直されて通るので、文字列であることを先に確かめる
    const kind = typeof location.kind === 'string' && Object.hasOwn(PLACE_LABELS, location.kind) ? location.kind : 'unknown';
    const egg = kind.startsWith('egg-');
    // 所持者: 手持ち・パルボックス・次元ストレージは入れ物の持ち主、タマゴは置いた人／持っている人
    // 拠点に置かれたタマゴ（地面・孵化器・保管箱）は拠点の持ち物として扱う
    const atBase = egg && kind !== 'egg-inventory' && Boolean(location.baseId) && bases.has(location.baseId);
    const holderUid = !atBase && (['party', 'palbox', 'dps'].includes(kind) || egg) ? location.playerUid || source.ownerUid || '' : '';
    let holder;
    // 観賞用ケージは拠点に置くので、拠点の個体と同じく拠点の持ち物として扱う（save-extras）
    if (kind === 'base' || kind === 'display' || atBase) holder = baseLabel(location.baseId);
    else if (kind === 'global') holder = globalHolder;
    else if (kind === 'egg-guild') holder = 'ギルド保管庫';
    else holder = playerName(players, holderUid) || '不明';
    let placeDetail = PLACE_LABELS[kind];
    // パルボックスはページと位置まで出す（共有の placeLabel にも入るので、参加している人にも出る）
    const boxAt = kind === 'palbox' ? palboxPosition(location.slotIndex) : null;
    if (boxAt) placeDetail = palboxLabel(boxAt);
    else if (kind === 'base') placeDetail = baseLabel(location.baseId);
    else if ((egg || kind === 'display') && location.baseId && bases.has(location.baseId)) placeDetail = `${PLACE_LABELS[kind]}・${baseLabel(location.baseId)}`;
    const passiveIds = cleanPassives(source.passives);
    const pal = palsById.get(palId);
    const rank = int(source.rank, RANK);
    entries.push({
      id,
      palId,
      characterId,
      name: text(pal?.ja ?? (human?.ja || characterId), 50),
      ...speciesInfo(pal),
      human,
      no: pal?.no ?? Infinity,
      variant: Boolean(pal?.variant),
      known: Boolean(pal),
      alpha,
      egg,
      nickname: text(source.nickname, 50),
      gender: Object.hasOwn(GENDERS, source.gender) ? GENDERS[source.gender] : '',
      level: egg ? 0 : int(source.level, LEVEL),
      rank,
      stars: rank - 1,
      passives: passiveIds,
      passiveNames: passiveIds.map((passiveId) => passiveById.get(passiveId)?.ja ?? passiveId),
      passiveDescs: passiveIds.map((passiveId) => passiveById.get(passiveId)?.desc ?? ''),
      // スキルを読むようになる前に読み込んだセーブには skills がない
      ...skillInfo(source.skills),
      talent: isObject(source.talent) ? talentOf(source.talent.hp, source.talent.shot, source.talent.defense) : talentOf(),
      lucky: source.isRare === true,
      // タマゴのアイテム ID（PalEgg_Fire_01・突然変異は PalEgg_MutationPal_*。タマゴの名前と突然変異の印。farm-board）
      eggItemId: egg ? text(location.itemId, 64) : '',
      place: kind,
      placeGroup: placeGroup(kind),
      placeLabel: text(placeDetail, 200),
      // パルボックスの位置（ページ・行・列。ボックス順の並べ替えと行の小さな図）。パルボックス以外・位置が分からなければ null
      box: boxAt,
      holderUid,
      holder: text(holder, 60),
      lastOwnerUid: source.lastOwnerUid ?? '',
      lastOwner: playerName(players, source.lastOwnerUid),
      baseId: location.baseId ?? '',
      // save-extras: 入手した時刻（ISO。持ち主のない個体・読む前のセーブは ''）・魂の強化と状態（読む前のセーブは null。共有しない）
      ownedAt: ownedTime(source.ownedAt),
      soul: soulOf(source.soul),
      condition: conditionOf(source.condition),
    });
  }
  const farms = Array.isArray(snapshot?.breedFarms) ? objects(snapshot.breedFarms).map((farm) => {
    const eggs = list(farm.eggs, { max: FARM_EGGS_MAX, map: (egg) => (isObject(egg) && idText(egg.localId) ? {
      id: egg.localId, palId: resolve(text(egg.characterId, 200)).palId, mutant: isMutationEggItem(text(egg.itemId, 200)),
    } : null) });
    return {
      id: farm.id, baseId: farm.baseId ?? '', parents: list(farm.parents, { map: (parent) => (isObject(parent) ? parent.instanceId : null) }),
      status: farm.status === 'uncertain' ? 'uncertain' : 'ok', eggs, eggCount: eggs.length,
      // 牧場のケーキ（[{ itemId, count }]。[] はケーキ切れ、null は分からない〔ケーキを読む前のセーブ・入れ物が読めない〕。共有しない）
      cakes: cakesOf(farm.cakes),
    };
  }) : null;
  attachFarms(entries, farms);
  const world = isObject(snapshot?.world) ? snapshot.world : {};
  return {
    // ゲーム内の日数（inGameDay）は 1 以上の数か null（save-extras）
    world: { ...world, inGameDay: cleanDay(world.inGameDay) },
    // 一覧に出すプレイヤーと拠点は、共有と同じ件数まで（所持者の名前は、上ですべてのプレイヤーから引いている）
    players: [...players.values()].slice(0, PLAYERS_MAX),
    bases: [...bases.values()].sort((a, b) => (a.number || Infinity) - (b.number || Infinity)).slice(0, BASES_MAX)
      .map((base) => ({ ...base, label: baseLabel(base.id) })),
    pals: entries,
    // 配合牧場（状態つき）。理想個体の配合の計画で、置いてある組と比べる。牧場を読む前の解析結果では null（情報がない）。
    // 親が読めない・食い違う牧場（uncertain。parents は引けた親だけ）も捨てずに残し、判定の側で使わない・判定を保留する
    //（core/ideal-farms.js の readyFarms・farmCompleteness）。状態のない古い解析結果は ok。
    // eggs は牧場の上のタマゴ（{ id: タマゴの個体 ID, palId: 中身〔マスターにないものは ''〕, mutant: 突然変異 }。セーブの順。64 個まで）、
    // eggCount はその数（farm-data。共有で中身を省いたときは eggs が null で、数だけが分かる）
    farms,
    // 牧場そのものが一部だけか（共有で牧場を切ったとき。手元のセーブはいつも全部）。farmsCounted は牧場の数とタマゴの数が分かる形か
    //（共有で n のない古い形は false。空いて見える牧場が読めない牧場かもしれないので、空き牧場の判定をしない）
    farmsPartial: false,
    farmsCounted: true,
    // アイテムの在庫（インプラント・パルリバーサー。itemStock で引く。implants）。在庫を読む前のスナップショットは null
    items: stockOf(snapshot?.items, { baseLabel, players }),
    stats: snapshot?.stats ?? {},
  };
}

export function hasPassives(pal, passiveIds) {
  return passiveIds.every((id) => pal.passives.includes(id));
}

const GENDER_WORDS = { M: ['オス', '♂'], F: ['メス', '♀'] };

// キーワードで探す項目。数値（レベル・★・個体値）は専用の絞り込みがあるので含めない。
// スキルとパッシブは、名前と説明を同じ順番で並べる（一致した理由を出すときに、説明から名前を引く。NOTE_SPECS）
// タマゴのアイテム ID → 日本語名（ゲーム本体の表。セーブの ID と大文字小文字が違うことがあるので、小文字にそろえて引く）
const eggNames = new Map(Object.entries(EGG_NAMES).map(([id, name]) => [id.toLowerCase(), name]));
/** タマゴの名前（「暗黒デカタマゴ」など。表にない ID・空なら ''。farm-board） */
export const eggName = (itemId) => eggNames.get(String(itemId ?? '').toLowerCase()) ?? '';

// ケーキのアイテム ID（小文字）→ [表の ID, 日本語名]（配合牧場のケーキの残り。save-extras）
const cakeNames = new Map(Object.entries(CAKE_NAMES).map(([id, name]) => [id.toLowerCase(), [id, name]]));
/**
 * ケーキの名前と表の ID（ゲームのアイコンのファイル名 item/cake-〈ID〉.png に使う）。表にない ID は名前に ID をそのまま出し、icon は ''
 * @returns {{ name: string, icon: string }}
 */
export function cakeInfo(itemId) {
  const found = cakeNames.get(String(itemId ?? '').toLowerCase());
  return found ? { name: found[1], icon: found[0] } : { name: String(itemId ?? ''), icon: '' };
}

/** 突然変異のタマゴか（アイテム ID か、牧場の上のタマゴの印で見る） */
export const isMutantEgg = (pal) => Boolean(pal?.egg && (isMutationEggItem(pal.eggItemId) || pal.farm?.mutant));

/**
 * 個体に配合牧場の印を付ける（farm: { id, baseId, role: 'parent' | 'egg', mutant } | null。farm-board）。牧場の親と、牧場の上のタマゴ
 *（共有で中身を省いた牧場〔eggs: null〕のタマゴには付かない）。読めない牧場の親も、引けた分は親として付ける
 */
function attachFarms(entries, farms) {
  const byId = new Map();
  for (const farm of farms ?? []) {
    for (const id of farm.parents) if (!byId.has(id)) byId.set(id, { id: farm.id, baseId: farm.baseId, role: 'parent', mutant: false });
    for (const egg of farm.eggs ?? []) if (!byId.has(egg.id)) byId.set(egg.id, { id: farm.id, baseId: farm.baseId, role: 'egg', mutant: egg.mutant });
  }
  for (const entry of entries) entry.farm = byId.get(entry.id) ?? null;
}

function keywordFields(pal) {
  return {
    name: [pal.name, pal.en, pal.characterId],
    nickname: [pal.nickname],
    elements: pal.elements ?? [],
    // 作業適性の名前（「採掘」。Lv は一致の理由に出す。「採掘3」の Lv の比べ方は matchesKeywords）
    work: workEntries(pal.work).map((entry) => entry.name),
    partnerSkill: [pal.partnerSkill],
    partnerSkillDesc: [pal.partnerSkillDesc],
    skills: pal.skillNames ?? [],
    skillDescs: pal.skillDescs ?? [],
    passives: pal.passiveNames,
    passiveDescs: pal.passiveDescs ?? [],
    gender: GENDER_WORDS[pal.gender] ?? [],
    // 配合牧場の親と牧場の上のタマゴは「配合牧場」、突然変異のタマゴは「突然変異」でも探せる（farm-board）
    // 病気・空腹の個体は「病気」「空腹」でも探せる（save-extras。ホストの画面だけ）
    status: [pal.egg && 'タマゴ', pal.egg && eggName(pal.eggItemId), pal.lucky && 'ラッキー', pal.alpha && 'アルファ', pal.farm && '配合牧場', isMutantEgg(pal) && '突然変異',
      pal.condition?.sick && '病気', pal.condition?.hunger && '空腹'],
    holder: [pal.holder],
    place: [pal.placeLabel],
    // 預けた人は拠点の個体にだけ出しているので、探すのもそれに合わせる
    lastOwner: pal.place === 'base' ? [pal.lastOwner] : [],
  };
}

// 入力のたびに全員の文字列をそろえ直さないよう、個体ごとに覚えておく
const keywordCache = new WeakMap();
// 同じ文字列（種族名・スキルとパッシブの名前と説明・場所など）は多くの個体で同じなので、そろえた結果を使い回す
//（20,000 行で初めてキーワードを入れたときに、入力が止まらないように。増えすぎたら捨てる）
const normalizedTexts = new Map();
const NORMALIZED_MAX = 50000;
function normalizedText(value) {
  const key = String(value);
  let text = normalizedTexts.get(key);
  if (text === undefined) {
    if (normalizedTexts.size >= NORMALIZED_MAX) normalizedTexts.clear();
    text = normalizeQuery(key);
    normalizedTexts.set(key, text);
  }
  return text;
}

// 個体の探す文字列（そろえた文字と、どの項目の何番目か。keywordNotes が一致した理由を引く）
function keywordEntries(pal) {
  let entries = keywordCache.get(pal);
  if (entries) return entries;
  entries = [];
  const fields = keywordFields(pal);
  for (const field of Object.keys(fields)) {
    const values = fields[field];
    for (let index = 0; index < values.length; index++) {
      const text = values[index] ? normalizedText(values[index]) : '';
      if (text) entries.push({ field, index, text });
    }
  }
  keywordCache.set(pal, entries);
  return entries;
}
const keywordTexts = keywordEntries;

/** キーワードで探すための文字列を先に作っておく（データを読み込んだ後、入力の前に区切って呼ぶ） */
export function prepareKeywords(pal) {
  keywordEntries(pal);
}

/**
 * キーワードを、探す語に分ける（空白で区切ると、すべてを含む個体に絞る）。
 * ひらがなとカタカナ・全角と半角・大文字と小文字の違いはそろえる。
 */
export function keywordTerms(query) {
  return queryTerms(query);
}

/**
 * 語がすべて、いずれかの項目に含まれるか。extra は個体の固定の文字ではない、画面が足す文字（目標の印など。keywordCache には入れない）。
 * 作業の名前の直後に数字の語（「採掘3」）は、その作業の Lv が数字以上の個体だけに当たる（文字の部分一致では見ない。game-assets）
 */
export function matchesKeywords(pal, terms, extra) {
  const texts = keywordTexts(pal);
  // 足す文字は、個体の文字で見つからなかった語のときだけ、1 つずつそろえて見る（印の多い個体で、入力のたびに配列を作らない）
  return terms.every((term) => {
    const work = workTerm(term);
    if (work) return workMatches(pal, work);
    return texts.some((entry) => entry.text.includes(term)) || (extra?.length > 0 && extra.some((text) => normalizedText(text).includes(term)));
  });
}

// 一致した理由の項目（行に出す見出し・名前の項目・説明の項目）。1 つの語の中ではこの順に並べる（行の左から右の順に近い並び）。
// keywordFields のすべての項目を持つ（どの語にも、何に一致したかを必ず出すため。D29）
const NOTE_SPECS = [
  { label: 'パル名', field: 'name' },
  { label: 'ニックネーム', field: 'nickname' },
  { label: '属性', field: 'elements' },
  // 名前に Lv を付けて出す（「作業適性：採掘 Lv3」）
  { label: '作業適性', field: 'work', withLevel: true },
  { label: '性別', field: 'gender' },
  { label: '特徴', field: 'status' },
  { label: 'パッシブ', field: 'passives', descField: 'passiveDescs' },
  { label: 'パートナースキル', field: 'partnerSkill', descField: 'partnerSkillDesc' },
  { label: 'アクティブスキル', field: 'skills', descField: 'skillDescs' },
  { label: '所持者', field: 'holder' },
  { label: '場所', field: 'place' },
  { label: '預けた人', field: 'lastOwner' },
];
/** 画面が足す文字（目標の印など。keywordNotes の extra）の見出し */
const EXTRA_LABEL = '目標の印';

/**
 * 一致した理由として行に出すもの（2026-10-14 のユーザーのフィードバック〔D29〕「必ず何に一致したから表示したのか分かるように」。前は一覧に
 * 出していないスキルと説明だけで、パル名・属性などで一致したときは何も出さなかった）。語の順に、その語が当たった項目の値をすべて
 * （1 つの語の中は NOTE_SPECS の順）。スキル・パッシブは説明で一致したときだけ説明を付ける。同じ項目の同じ値は 1 回だけ（別の語が説明に当たったら
 * 説明を足す）。拠点の個体の所持者（拠点の名前）は、場所と同じ値なら場所として出す。extra は画面が足す文字（目標の印。見出し「目標の印」）。
 * 絞り込み（matchesKeywords）で残った個体なら、どの語にも 1 つ以上の理由がある
 * @returns {{ label: string, name: string, desc: string }[]}
 */
export function keywordNotes(pal, terms, extra) {
  if (!terms.length) return [];
  const entries = keywordEntries(pal);
  const notes = [];
  const seen = new Map();
  const add = (label, name, desc) => {
    const key = `${label}\u0001${name}`;
    const found = seen.get(key);
    if (!found) {
      const note = { label, name, desc };
      seen.set(key, note);
      notes.push(note);
    } else if (desc && !found.desc) found.desc = desc;
  };
  let fields = null;
  let works = null;
  const workText = (index) => {
    works ??= workEntries(pal.work);
    return works[index] ? `${works[index].name} Lv${works[index].level}` : '';
  };
  for (const term of terms) {
    // 「採掘3」は作業適性の Lv で当たった（その作業を Lv つきで出す）
    const work = workTerm(term);
    if (work) {
      if (!workMatches(pal, work)) continue;
      works ??= workEntries(pal.work);
      const index = works.findIndex((entry) => entry.key === work.key);
      if (index >= 0) add('作業適性', workText(index), '');
      continue;
    }
    let hit = null;
    for (const entry of entries) {
      if (!entry.text.includes(term)) continue;
      hit ??= new Set();
      hit.add(`${entry.field}:${entry.index}`);
    }
    if (hit) {
      fields ??= keywordFields(pal);
      for (const { label, field, descField, withLevel } of NOTE_SPECS) {
        const names = fields[field];
        const descs = descField ? fields[descField] : null;
        for (let index = 0; index < names.length; index++) {
          const name = names[index];
          const byDesc = Boolean(descs) && hit.has(`${descField}:${index}`);
          if (!name || !(byDesc || hit.has(`${field}:${index}`))) continue;
          // 拠点の個体は所持者の欄にも拠点の名前が入る（場所と同じ値）。場所として 1 回だけ出す
          if (field === 'holder' && name === fields.place[0]) continue;
          add(label, withLevel ? workText(index) : String(name), byDesc ? descs[index] : '');
        }
      }
    }
    for (const text of extra ?? []) if (normalizedText(text).includes(term)) add(EXTRA_LABEL, text, '');
  }
  return notes;
}

/**
 * 一覧の絞り込み（全員を 1 回だけ走査する）。
 * @param {object[]} pals normalizeOwned の pals
 * @param {{ ids?: Set<string> | null, places?: string[] | null, elements?: string[], palId?: string, passives?: string[],
 *   passiveMode?: 'include' | 'only' | 'none', query?: string, stars?: number, talent?: { hp?: number, shot?: number, defense?: number } }} filter
 *   ids は所持者で許す個体の ID（null は絞らない。理想個体と同じ意味の集合〔ideal-goals.js の palsOfPlayers など〕を呼び出し側が作る）。
 *   places は場所のグループ（placeGroup の値。null は絞らない、[] は何も出さない。拠点ごとの絞り込み〔bases〕は D29 でなくした）。
 *   elements は属性（マスターの ID〔Fire など〕。どれかを持つ個体）。
 *   passiveMode は include＝選んだパッシブを全部持つ、only＝全部持ち、ほかを持たない、none＝パッシブが 0 個（選んだパッシブは見ない）。
 *   stars はパル濃縮（★の数）の下限、talent は個体値の下限。extraTexts は個体 ID ごとに、キーワードで一緒に探す文字（目標の印など）
 */
export function filterOwned(pals, {
  ids = null, places = null, elements = [], palId = '', passives = [], passiveMode = 'include', query = '', stars = 0, talent = {},
  extraTexts = null,
} = {}) {
  const terms = keywordTerms(query);
  const minStars = Number(stars) || 0;
  const min = { hp: Number(talent.hp) || 0, shot: Number(talent.shot) || 0, defense: Number(talent.defense) || 0 };
  const placeSet = Array.isArray(places) ? new Set(places) : null;
  // 個体の elements は日本語の名前（speciesInfo）なので、マスターの ID を名前にしてから比べる
  const elementNames = elements?.length ? new Set(elements.map((key) => ELEMENTS[key] ?? key)) : null;
  const none = passiveMode === 'none';
  const wanted = none ? [] : [...new Set(passives ?? [])];
  const only = passiveMode === 'only';
  return pals.filter((pal) => {
    if (ids && !ids.has(pal.id)) return false;
    if (placeSet && !placeSet.has(pal.placeGroup)) return false;
    if (pal.stars < minStars) return false;
    if (pal.talent.hp < min.hp || pal.talent.shot < min.shot || pal.talent.defense < min.defense) return false;
    if (elementNames && !(pal.elements ?? []).some((name) => elementNames.has(name))) return false;
    if (palId && pal.palId !== palId) return false;
    if (none ? pal.passives.length > 0 : wanted.length && !hasPassives(pal, wanted)) return false;
    if (only && pal.passives.length !== wanted.length) return false;
    if (terms.length && !matchesKeywords(pal, terms, extraTexts?.get(pal.id))) return false;
    return true;
  });
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 一覧の並べ替え: [キー, 既定の向きの名前, 既定の向き, 反対の向きの名前]。列見出しを押すとそのキー（既定の向き）、もう一度で反対の向き。
 * HP・攻撃・防御は 1 つの個体値（O-21）、passives はパッシブのランクの合計（O-24。前の名前は「良いパッシブ順」）、place はボックス順（O-22）。
 * 名前は「〈何〉が〈向き〉」にそろえる（列見出しの読み上げ「〈何〉で並べ替え（〈向き〉）」と同じ言い方）
 */
export const OWNED_SORTS = Object.freeze([
  ['dex', '図鑑番号順', 'asc', '図鑑番号が大きい順'],
  // 入手した時刻（save-extras。孵化させた子を見つける）。入手の時刻のない個体（タマゴ・持ち主のない個体・古いデータ）はどちらの向きでも最後
  ['ownedAt', '入手の新しい順', 'desc', '入手の古い順'],
  ['passives', 'パッシブのランクが高い順', 'desc', 'パッシブのランクが低い順'],
  ['level', 'レベルが高い順', 'desc', 'レベルが低い順'],
  ['stars', 'パル濃縮（★）が多い順', 'desc', 'パル濃縮（★）が少ない順'],
  ['talent', '個体値の合計が高い順', 'desc', '個体値の合計が低い順'],
  ['hp', 'HP の個体値が高い順', 'desc', 'HP の個体値が低い順'],
  ['shot', '攻撃の個体値が高い順', 'desc', '攻撃の個体値が低い順'],
  ['defense', '防御の個体値が高い順', 'desc', '防御の個体値が低い順'],
  ['place', 'ボックス順', 'asc', 'ボックスの逆順'],
].map((entry) => Object.freeze(entry)));
const SORT_BY_KEY = new Map(OWNED_SORTS.map((entry) => [entry[0], entry]));
// 前の並べ替えの値（talent-target の「個体値の合計が低い順」）。viewState・URL に残っていたら、キーと向きに読み替える
const LEGACY_SORTS = { 'talent-low': { key: 'talent', dir: 'asc' } };

/**
 * 並べ替えの値（キー。前の値 talent-low も受ける）と向きを、使えるキーと向きにする。知らないキーは図鑑番号順、知らない向きはそのキーの既定
 * @returns {{ key: string, dir: 'asc' | 'desc' }}
 */
export function sortKey(value, dir) {
  if (Object.hasOwn(LEGACY_SORTS, value)) return { ...LEGACY_SORTS[value] };
  const entry = SORT_BY_KEY.get(value) ?? SORT_BY_KEY.get('dex');
  return { key: entry[0], dir: dir === 'asc' || dir === 'desc' ? dir : entry[2] };
}

/** 並べ替えの名前（向きつき。「HP の個体値が低い順」など） */
export function sortLabel(value, dir) {
  const { key, dir: resolved } = sortKey(value, dir);
  const entry = SORT_BY_KEY.get(key);
  return resolved === entry[2] ? entry[1] : entry[3];
}

// パッシブのランク（マスターにないものは 0。負のパッシブは負のランク）
const passiveRanks = new Map(passiveList.map((passive) => [passive.id, Number(passive.rank) || 0]));
const rankSum = (pal) => {
  let sum = 0;
  for (const id of pal.passives) sum += passiveRanks.get(id) ?? 0;
  return sum;
};
// ボックスの位置（パルボックスの外・位置の分からない個体は、同じ所持者・場所のグループの最後）
const boxIndex = (pal) => (pal.box ? (pal.box.page * 100 + pal.box.row) * 100 + pal.box.column : Infinity);

/**
 * 一覧を並べる（元の配列は変えない）。key は OWNED_SORTS のキー（前の値 talent-low も受ける）、dir は向き（省くとそのキーの既定）。
 * 向きは最初の比較（そのキーの比べ方）だけを反転し、同じ値の比べ方（図鑑番号など）はそのまま。最後は必ず個体 ID の順（同じ入力なら同じ並び）
 */
export function sortOwned(pals, key = 'dex', dir) {
  const sort = sortKey(key, dir);
  const dex = (a, b) => a.no - b.no || Number(a.variant) - Number(b.variant) || compareText(a.characterId, b.characterId);
  const talent = (pal) => pal.talent.hp + pal.talent.shot + pal.talent.defense;
  const placeRank = (pal) => PLACE_ORDER.indexOf(pal.placeGroup);
  // [最初の比較（既定の向き）, 同じ値のときの比べ方]
  const comparators = {
    dex: [dex, (a, b) => b.level - a.level],
    passives: [(a, b) => rankSum(b) - rankSum(a), (a, b) => b.passives.length - a.passives.length || dex(a, b)],
    level: [(a, b) => b.level - a.level, dex],
    stars: [(a, b) => b.stars - a.stars, (a, b) => b.level - a.level || dex(a, b)],
    talent: [(a, b) => talent(b) - talent(a), dex],
    hp: [(a, b) => b.talent.hp - a.talent.hp, dex],
    shot: [(a, b) => b.talent.shot - a.talent.shot, dex],
    defense: [(a, b) => b.talent.defense - a.talent.defense, dex],
    place: [(a, b) => compareText(a.holder, b.holder) || placeRank(a) - placeRank(b) || boxIndex(a) - boxIndex(b), dex],
    // 時刻の文字列は同じ形（ownedTime）なので、文字の順で比べる
    ownedAt: [(a, b) => compareText(b.ownedAt ?? '', a.ownedAt ?? ''), dex],
  };
  const [first, rest] = comparators[sort.key];
  const sign = sort.dir === SORT_BY_KEY.get(sort.key)[2] ? 1 : -1;
  // 入手の時刻のない個体は、向きによらず最後（並べ替えの最初の比較の前に分ける）
  if (sort.key === 'ownedAt') {
    const missing = (pal) => (pal.ownedAt ? 0 : 1);
    return [...pals].sort((a, b) => missing(a) - missing(b) || sign * first(a, b) || rest(a, b) || compareText(a.id, b.id));
  }
  // パッシブのランクの順は個体ごとのランクの合計を先に求める（比べるたびに数えない）
  const list = sort.key === 'passives' ? pals.map((pal) => ({ pal, sum: rankSum(pal) })) : null;
  if (list) {
    list.sort((a, b) => sign * (b.sum - a.sum) || rest(a.pal, b.pal) || compareText(a.pal.id, b.pal.id));
    return list.map((item) => item.pal);
  }
  return [...pals].sort((a, b) => sign * first(a, b) || rest(a, b) || compareText(a.id, b.id));
}

/** 種類（パル ID）ごとの所持個体。マスター外（人間など）は含めない。 */
export function ownedBySpecies(pals) {
  const map = new Map();
  for (const pal of pals) {
    if (!pal.palId) continue;
    if (!map.has(pal.palId)) map.set(pal.palId, []);
    map.get(pal.palId).push(pal);
  }
  return map;
}

/**
 * 種族（パル ID）ごとの所持数と性別の内訳（パル選択の「♂3 ♀2」）。タマゴとマスター外（人間など）は数えない。
 * total は性別の分からない個体も含む数。
 * @returns {Map<string, { M: number, F: number, total: number }>}
 */
export function speciesGenderCounts(pals) {
  const map = new Map();
  for (const pal of pals) {
    if (!pal.palId || pal.egg) continue;
    let entry = map.get(pal.palId);
    if (!entry) map.set(pal.palId, entry = { M: 0, F: 0, total: 0 });
    if (pal.gender === 'M') entry.M++;
    else if (pal.gender === 'F') entry.F++;
    entry.total++;
  }
  return map;
}

/**
 * 配合の親にできる個体か。タマゴ・グローバルパルボックスの個体・マスター外（人間など）は親にしない。
 * 遺伝の仕組み（core/ideal.js の isParentCandidate）と同じ規則。INV-2 の読み込みの制限で core/ideal.js は理想個体の画面からしか
 * 読めないので、配合を探す・継承ルート・登録の画面のためにここにも持つ（テストで同じ結果になることを確かめる）
 */
export const canBeParent = (pal) => Boolean(pal?.palId) && !pal.egg && pal.place !== 'global';

/**
 * 種族（パル ID）ごとの所持数（配合を探す・継承ルート・登録の画面に重ねる共通の集計。所持パルのデータが変わったときに 1 回だけ作る）。
 * total・eggs・globals は全個体（タマゴ・グローバルパルボックスの数）、male・female・unknown は親にできる個体（canBeParent）の性別ごとの数。
 * マスター外（人間など）は数えない
 * @returns {Map<string, { total: number, eggs: number, globals: number, male: number, female: number, unknown: number }>}
 */
export function ownedCounts(pals) {
  const map = new Map();
  for (const pal of pals ?? []) {
    if (!pal?.palId) continue;
    let entry = map.get(pal.palId);
    if (!entry) map.set(pal.palId, entry = { total: 0, eggs: 0, globals: 0, male: 0, female: 0, unknown: 0 });
    entry.total++;
    if (pal.egg) entry.eggs++;
    else if (pal.place === 'global') entry.globals++;
    if (!canBeParent(pal)) continue;
    if (pal.gender === 'M') entry.male++;
    else if (pal.gender === 'F') entry.female++;
    else entry.unknown++;
  }
  return map;
}

/** 親にできる ♂・♀ の数（ownedCounts の 1 件。なければ 0） */
const parentsOf = (counts, palId) => counts?.get(palId) ?? { male: 0, female: 0 };

/**
 * 記録の両親を今の所持で組めるか（別々の個体の ♂ と ♀。親にできる個体だけ）。同じ種族どうしは ♂ と ♀ が 1 体ずつ。
 * 違う種族は、記録に親の性別があればその向きだけ（親1 が ♂ か親2 が ♀ なら「親1 ♂・親2 ♀」）、空欄なら 2 つの向きのどちらか。
 * 両親が同じ性別の記録（不正）は組めない
 */
export function canPairRecord(counts, record) {
  const one = parentsOf(counts, record.parent1Id);
  const two = parentsOf(counts, record.parent2Id);
  const g1 = record.parent1Gender ?? '';
  const g2 = record.parent2Gender ?? '';
  if (g1 && g1 === g2) return false;
  if (record.parent1Id === record.parent2Id) return one.male > 0 && one.female > 0;
  const oneMale = one.male > 0 && two.female > 0;
  const oneFemale = one.female > 0 && two.male > 0;
  if (g1 === 'M' || g2 === 'F') return oneMale;
  if (g1 === 'F' || g2 === 'M') return oneFemale;
  return oneMale || oneFemale;
}

/** データにあるパッシブ（多い順）。 */
export function passiveCounts(pals) {
  const counts = new Map();
  for (const pal of pals) for (const id of pal.passives) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

// 表計算（CSV・今後の GAS 連携）に出す列。列名を変えるときは GAS 側と合わせる。
export const OWNED_COLUMNS = Object.freeze([
  ['instanceId', '個体ID'], ['world', 'ワールド'], ['palId', 'パルID'], ['name', 'パル名'], ['characterId', 'キャラクターID'],
  ['nickname', 'ニックネーム'], ['gender', '性別'], ['level', 'レベル'], ['stars', '凝縮'],
  ['passive1', 'パッシブ1'], ['passive2', 'パッシブ2'], ['passive3', 'パッシブ3'], ['passive4', 'パッシブ4'], ['passiveIds', 'パッシブID'],
  ['talentHp', '個体値HP'], ['talentShot', '個体値攻撃'], ['talentDefense', '個体値防御'],
  ['lucky', 'ラッキー'], ['alpha', 'アルファ'], ['holder', '所持者'], ['place', '場所'], ['lastOwner', '最後の持ち主'], ['importedAt', '読み込み日時'],
]);

/**
 * 表計算に入れる文字列を、式として扱われない形にする（ニックネームやプレイヤー名は他の人が付けたもの）。
 * 先頭が = + - @ タブ 改行 の文字列（数値は除く）は ' を付ける。スプレッドシート（GAS）へ送るときも同じ値を使う。
 */
export function sheetText(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r\n]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
}

const localTime = (iso) => {
  const time = new Date(iso);
  if (!Number.isFinite(time.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${time.getFullYear()}/${pad(time.getMonth() + 1)}/${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
};

export function ownedRows(owned, { importedAt = '' } = {}) {
  const world = owned.world?.name ?? '';
  return owned.pals.map((pal) => {
    const row = {
      instanceId: pal.id, world, palId: pal.palId, name: pal.name, characterId: pal.characterId, nickname: pal.nickname,
      gender: pal.gender === 'M' ? 'オス' : pal.gender === 'F' ? 'メス' : '', level: pal.egg ? '' : pal.level, stars: pal.stars,
      passiveIds: pal.passives.join('|'),
      talentHp: pal.talent.hp, talentShot: pal.talent.shot, talentDefense: pal.talent.defense,
      lucky: pal.lucky ? 'はい' : '', alpha: pal.alpha ? 'はい' : '', holder: pal.holder, place: pal.placeLabel,
      lastOwner: pal.lastOwner, importedAt: localTime(importedAt),
    };
    for (let i = 0; i < 4; i++) row[`passive${i + 1}`] = pal.passiveNames[i] ?? '';
    for (const key of Object.keys(row)) row[key] = sheetText(row[key]);
    return row;
  });
}

export function rowsToCsv(rows) {
  const cell = (value) => {
    const safe = String(sheetText(value) ?? '');
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = OWNED_COLUMNS.map(([, label]) => cell(label)).join(',');
  const body = rows.map((row) => OWNED_COLUMNS.map(([key]) => cell(row[key])).join(','));
  return [header, ...body].join('\r\n') + '\r\n';
}

/**
 * 継承ルートの開始候補: 指定のパッシブをすべて持つ所持パル（親にできる個体）の種類ごとに、登録済みの配合で目標までの最短経路を調べる。
 * 経路の探索は shortestRoute（登録済みの配合だけを使う）に任せる。
 * 並びは手数 → パッシブの多い個体 → 個体数 → 図鑑順（palOrder の小さい順。無いパルは後ろで ID の順。F030）。
 * @param {{ graph: Map, pals: object[], to: string, passives: string[], shortestRoute: Function, palOrder?: Map<string, number> }} input
 * @returns {{ palId: string, carriers: object[], route: object|null, length: number }[]} 近い順（たどり着けないものは除く）
 */
export function ownedRouteStarts({ graph, pals, to, passives, shortestRoute, palOrder = new Map() }) {
  const candidates = [];
  for (const [palId, list] of ownedBySpecies(pals)) {
    // 運び手は親にできる個体だけ（タマゴ・グローバルパルボックスの個体は外す。R-15。理想個体と同じ規則）
    const carriers = list.filter((pal) => canBeParent(pal) && hasPassives(pal, passives));
    if (!carriers.length) continue;
    if (palId === to) { candidates.push({ palId, carriers, route: null, length: 0 }); continue; }
    if (!graph.has(palId)) continue;
    const route = shortestRoute(graph, palId, to);
    if (route) candidates.push({ palId, carriers, route, length: route.length });
  }
  const best = (pal) => pal.passives.length;
  return candidates.sort((a, b) => a.length - b.length
    || Math.max(...b.carriers.map(best)) - Math.max(...a.carriers.map(best))
    || b.carriers.length - a.carriers.length
    || (palOrder.get(a.palId) ?? Infinity) - (palOrder.get(b.palId) ?? Infinity)
    || (a.palId < b.palId ? -1 : a.palId > b.palId ? 1 : 0));
}

/** 相手親の所持数（親にできる個体だけ。タマゴ・グローバルパルボックスの個体は数えない）と、そのうち指定のパッシブをすべて持つ数。 */
export function partnerOwnership(bySpecies, palId, passives) {
  const list = (bySpecies.get(palId) ?? []).filter(canBeParent);
  return { total: list.length, matching: passives.length ? list.filter((pal) => hasPassives(pal, passives)).length : 0 };
}

// ---------------------------------------------------------------------------
// スプレッドシートでの共有（ホストがアップロードし、全員が読む）
// ---------------------------------------------------------------------------

/** 画面用の一覧を、共有の行（OWNED_FIELDS の順の配列）にする。文字列はそのまま送り、式の無害化は GAS 側で行う。 */
// 画面用の 1 牧場を共有の形にする（短い鍵。owned-shared.js の cleanOwnedFarms）
function sharedFarm(farm) {
  const count = Number.isInteger(farm.eggCount) ? farm.eggCount : Array.isArray(farm.eggs) ? farm.eggs.length : 0;
  if (farm.status === 'uncertain') return { id: farm.id, baseId: farm.baseId, parents: [], s: 'u', n: count };
  const shared = { id: farm.id, baseId: farm.baseId, parents: farm.parents, n: count };
  if (Array.isArray(farm.eggs)) {
    shared.eggs = farm.eggs.slice(0, OWNED_FARM_EGGS_MAX).map((egg) => ({ id: egg.id, ...(egg.palId ? { p: egg.palId } : {}), ...(egg.mutant ? { m: 1 } : {}) }));
  }
  return shared;
}

export function sharedUpload(owned) {
  const rows = owned.pals.map((pal) => {
    const value = {
      instanceId: pal.id, palId: pal.palId, palName: pal.name, characterId: pal.characterId, nickname: pal.nickname,
      gender: pal.gender, level: String(pal.level), rank: String(pal.rank), stars: String(pal.stars),
      passiveIds: pal.passives.join('|'), talentHp: String(pal.talent.hp), talentShot: String(pal.talent.shot), talentDefense: String(pal.talent.defense),
      lucky: pal.lucky ? '1' : '', alpha: pal.alpha ? '1' : '', egg: pal.egg ? '1' : '', place: pal.place, placeLabel: pal.placeLabel,
      holderUid: pal.holderUid, holder: pal.holder, baseId: pal.baseId, lastOwner: pal.lastOwner, skillIds: pal.skills.join('|'),
      eggItemId: pal.eggItemId ?? '', ownedAt: pal.ownedAt ?? '',
    };
    for (let i = 0; i < 4; i++) value[`passive${i + 1}`] = pal.passiveNames[i] ?? '';
    return OWNED_FIELDS.map((field) => value[field] ?? '');
  });
  return {
    // プレイヤーの Lv とプレイ中（save-extras）は players の JSON の中に足す（古い GAS は捨てるだけで、共有は止まらない）。
    // 分からない値（Lv 0・プレイ中 null）は送らない
    players: owned.players.map((player) => ({
      uid: player.uid, name: player.name,
      ...(Number.isInteger(player.level) && player.level > 0 ? { level: player.level } : {}),
      ...(typeof player.online === 'boolean' ? { online: player.online } : {}),
    })),
    bases: owned.bases.map((base) => ({ id: base.id, label: base.label })),
    // 牧場の情報がなければ送らない（「牧場なし」と区別するため）。牧場ごとにタマゴの数（n）と中身（eggs。20 個まで）を足し、セルに入るよう
    // 縮めてから送る（farm-data。owned-shared.js の fitOwnedFarms）。読めない牧場は親を空にして s: 'u'（古い GAS・旧コードの画面が s を
    // 捨てても、親のない牧場は置いてある組として扱われない〔ideal-farms の targetFarms は親 2 体の牧場だけ〕）
    ...(Array.isArray(owned.farms) ? { farms: fitOwnedFarms(cleanOwnedFarms(owned.farms.map(sharedFarm))) } : {}),
    columns: OWNED_FIELDS,
    rows,
  };
}

/**
 * 共有の牧場（短い鍵）を画面用の形に戻す（farm-data）。s: 'u' は読めない牧場、eggs がなければ中身が分からない（null）、eggCount は n。
 * n のない古い形（古い GAS・古いホストの画面）は、タマゴの情報なし（eggs: null・eggCount: 0）で farmsCounted: false。
 * of（元の牧場の数）が受け取った数より多ければ、牧場が一部だけ（farmsPartial）
 */
function sharedFarms(value, palsById) {
  if (!Array.isArray(value)) return { farms: null, farmsPartial: false, farmsCounted: false };
  const raw = cleanOwnedFarms(value);
  const farms = raw.map((farm) => ({
    id: farm.id, baseId: farm.baseId, parents: farm.s === 'u' ? [] : farm.parents, status: farm.s === 'u' ? 'uncertain' : 'ok',
    eggs: Array.isArray(farm.eggs) ? farm.eggs.map((egg) => ({ id: egg.id, palId: palsById.has(egg.p) ? egg.p : '', mutant: egg.m === 1 })) : null,
    eggCount: Number.isInteger(farm.n) ? farm.n : Array.isArray(farm.eggs) ? farm.eggs.length : 0,
    // ケーキは共有しない（ホストの画面だけ。save-extras）
    cakes: null,
  }));
  return {
    farms,
    farmsPartial: raw.some((farm) => Number.isInteger(farm.of) && farm.of > raw.length),
    farmsCounted: raw.length === 0 || raw.some((farm) => Number.isInteger(farm.n)),
  };
}

/**
 * 共有された行を、画面用の一覧（normalizeOwned と同じ形）にする。パルとパッシブの名前は手元のマスターを優先する。
 * @param {{ world: object, columns: string[], rows: string[][] }} shared
 */
export function ownedFromShared(shared, { pals, passives, humans = humanList }) {
  const resolveHuman = createHumanResolver(humans);
  const palsById = new Map(pals.map((pal) => [pal.id, pal]));
  const passiveById = new Map(passives.map((passive) => [passive.id, passive]));
  const world = isObject(shared?.world) ? shared.world : {};
  const columns = Array.isArray(shared?.columns) ? shared.columns : OWNED_FIELDS;
  const index = new Map(columns.map((field, i) => [field, i]));
  // 列の位置は 1 回だけ引き、行ごとには位置で読む（20,000 行で列名を何度も探さない）
  const at = (field) => index.get(field) ?? -1;
  const [ID, PAL_ID, PAL_NAME, CHARACTER, NICKNAME, GENDER, LEVEL_AT, RANK_AT, STARS, PASSIVE_IDS, HP, SHOT, DEFENSE, LUCKY, ALPHA, EGG, PLACE, PLACE_LABEL, HOLDER_UID, HOLDER, BASE_ID, LAST_OWNER, SKILL_IDS, EGG_ITEM, OWNED_AT] = [
    'instanceId', 'palId', 'palName', 'characterId', 'nickname', 'gender', 'level', 'rank', 'stars', 'passiveIds', 'talentHp', 'talentShot', 'talentDefense',
    'lucky', 'alpha', 'egg', 'place', 'placeLabel', 'holderUid', 'holder', 'baseId', 'lastOwner', 'skillIds', 'eggItemId', 'ownedAt',
  ].map(at);
  const PASSIVE_NAMES = [at('passive1'), at('passive2'), at('passive3'), at('passive4')];
  const entries = [];
  const seen = new Set();
  // 読み戻した共有の行は、要素ごとに形を確かめる（配列でない行・個体 ID（1〜64 字）がない行・同じ ID の後の行は捨てる）
  for (const cells of Array.isArray(shared?.rows) ? shared.rows : []) {
    if (!Array.isArray(cells)) continue;
    const get = (i) => (i < 0 ? '' : String(cells[i] ?? ''));
    const id = idText(get(ID));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const sharedPalId = get(PAL_ID);
    const palId = palsById.has(sharedPalId) ? sharedPalId : '';
    const pal = palsById.get(palId);
    const passiveText = get(PASSIVE_IDS);
    const passiveIds = passiveText ? cleanPassives(passiveText.split('|')) : [];
    const place = get(PLACE);
    const kind = Object.hasOwn(PLACE_LABELS, place) ? place : 'unknown';
    const egg = get(EGG) === '1' || kind.startsWith('egg-');
    const characterId = text(get(CHARACTER), 200);
    const human = pal ? null : resolveHuman(characterId);
    const gender = get(GENDER);
    const skillText = get(SKILL_IDS);
    const placeLabel = text(get(PLACE_LABEL), 200) || PLACE_LABELS[kind];
    entries.push({
      id, palId, characterId, human,
      name: text(pal?.ja ?? (human?.ja || get(PAL_NAME) || characterId), 50),
      ...speciesInfo(pal),
      no: pal?.no ?? Infinity, variant: Boolean(pal?.variant), known: Boolean(pal), alpha: get(ALPHA) === '1', egg,
      nickname: text(get(NICKNAME), 50), gender: gender === 'M' || gender === 'F' ? gender : '',
      level: egg ? 0 : int(get(LEVEL_AT), LEVEL), rank: int(get(RANK_AT), RANK),
      stars: int(get(STARS), STARS_RANGE),
      passives: passiveIds,
      passiveNames: passiveIds.map((passiveId, i) => passiveById.get(passiveId)?.ja ?? (get(PASSIVE_NAMES[i] ?? -1) || passiveId)),
      passiveDescs: passiveIds.map((passiveId) => passiveById.get(passiveId)?.desc ?? ''),
      // skillIds は後から足した列。スキルを送らない古い画面から共有されたときは空
      ...skillInfo(skillText ? skillText.split('|') : []),
      talent: talentOf(get(HP), get(SHOT), get(DEFENSE)),
      lucky: get(LUCKY) === '1',
      // eggItemId は後から足した列（farm-board）。列のない共有（GAS の setup() の前・古い画面）では空
      eggItemId: egg ? text(get(EGG_ITEM), 64) : '',
      place: kind, placeGroup: placeGroup(kind), placeLabel,
      // 共有には位置の列がないので、placeLabel の文字から読む（書式の違う古い共有は null で、文字だけを出す）
      box: kind === 'palbox' ? parseBoxLabel(placeLabel) : null,
      holderUid: get(HOLDER_UID), holder: text(get(HOLDER), 60) || '不明', lastOwnerUid: '', lastOwner: get(LAST_OWNER), baseId: get(BASE_ID),
      // ownedAt は後から足した列（save-extras）。列のない共有（GAS の setup() の前・古い画面）では空。魂の強化と状態は共有しない（null）
      ownedAt: ownedTime(get(OWNED_AT)), soul: null, condition: null,
    });
  }
  const farmData = sharedFarms(world.farms, palsById);
  attachFarms(entries, farmData.farms);
  return {
    // inGameDay は後から足したワールドの列（save-extras。列のない GAS・古いホストの画面の共有では null）
    world: { name: text(world.worldName, 100), hostName: text(world.hostName, 50), inGameDay: cleanDay(world.inGameDay) },
    // Lv とプレイ中は players の JSON の中（save-extras。古い共有では Lv 0・プレイ中 null＝分からない）
    players: cleanSharedPlayers(world.players).map((player) => ({ uid: player.uid, name: player.name || '不明', ...playerExtras(player) })),
    bases: cleanSharedBases(world.bases).map((base) => ({ id: base.id, label: base.label || '拠点' })),
    pals: entries,
    // 牧場を共有する前の GAS・ホストの画面から受けたデータには farms がない（null: 牧場の情報がない）
    ...farmData,
    // アイテムの在庫は共有しない（ホストの画面だけ。implants）
    items: null,
    stats: {},
  };
}
