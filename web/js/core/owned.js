// セーブから読み込んだ所持パル（スナップショット）や、スプレッドシートで共有された所持パルを、
// 画面・継承ルート・表計算で使う形にする。DOM には触れない。
// スナップショットの形は web/js/save/palworld.js の buildSnapshot、共有の列は core/owned-shared.js を参照。
import { OWNED_FIELDS, cleanOwnedFarms } from './owned-shared.js';
import { isObject, int, text, idText, list, cleanSharedPlayers, cleanSharedBases, PLAYERS_MAX, BASES_MAX } from './boundary.js';
import { normalizeQuery } from './kana.js';
import humanList from '../../data/humans.js';
import { ELEMENTS } from '../../data/pals.js';
import { ACTIVE_SKILLS, PARTNER_SKILLS, ACTIVE_SKILL_DESCS, PARTNER_SKILL_DESCS } from '../../data/skills.js';

// 野生のボス（アルファ）などは CharacterID に接頭辞が付く（例: BOSS_IceHorse）。
const PREFIXES = ['BOSS_', 'GYM_', 'RAID_', 'PREDATOR_'];

export const PLACE_LABELS = Object.freeze({
  party: '手持ち',
  palbox: 'パルボックス',
  base: '拠点',
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
export const PLACE_ORDER = ['party', 'palbox', 'base', 'dps', 'global', 'egg', 'unknown'];

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

const shortUid = (uid) => String(uid ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();

// 協力プレイのホストの PlayerUId（SAVE_FORMAT.md）
const HOST_UID = '00000000-0000-0000-0000-000000000001';

export function playerName(players, uid) {
  if (!uid) return '';
  return players.get(uid)?.name || `不明なプレイヤー（${shortUid(uid)}）`;
}

const GENDERS = { Male: 'M', Female: 'F' };

// 種類で決まる項目（キーワードで探す）。マスターにないもの（人間など）は空
function speciesInfo(pal) {
  return {
    en: pal?.en ?? '', elements: (pal?.el ?? []).map((element) => ELEMENTS[element] ?? element),
    partnerSkill: PARTNER_SKILLS[pal?.id] ?? '', partnerSkillDesc: PARTNER_SKILL_DESCS[pal?.id] ?? '',
  };
}

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

/**
 * スナップショットを画面用の一覧にする。
 * @param {object} snapshot buildSnapshot の結果
 * @param {{ pals: object[], passives: object[] }} masters
 * @returns {{ world: object, players: object[], bases: object[], pals: object[], stats: object }}
 */
export function normalizeOwned(snapshot, { pals, passives, humans = humanList }) {
  const resolve = createSpeciesResolver(pals);
  const resolveHuman = createHumanResolver(humans);
  const palsById = new Map(pals.map((pal) => [pal.id, pal]));
  const passiveById = new Map(passives.map((passive) => [passive.id, passive]));
  // 読み戻したセーブの解析結果は、要素ごとに形を確かめる（壊れた要素だけを捨てる）。uid・拠点の ID は個体の所持者・場所と比べるので切り詰めない
  const objects = (value) => list(value, { map: (item) => (isObject(item) ? item : null) });
  const players = new Map(objects(snapshot?.players).filter((player) => idText(player.uid, 40))
    .map((player) => [player.uid, { ...player, name: text(player.name, 50) }]));
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
    const kind = Object.hasOwn(PLACE_LABELS, location.kind) ? location.kind : 'unknown';
    const egg = kind.startsWith('egg-');
    // 所持者: 手持ち・パルボックス・次元ストレージは入れ物の持ち主、タマゴは置いた人／持っている人
    // 拠点に置かれたタマゴ（地面・孵化器・保管箱）は拠点の持ち物として扱う
    const atBase = egg && kind !== 'egg-inventory' && Boolean(location.baseId) && bases.has(location.baseId);
    const holderUid = !atBase && (['party', 'palbox', 'dps'].includes(kind) || egg) ? location.playerUid || source.ownerUid || '' : '';
    let holder;
    if (kind === 'base' || atBase) holder = baseLabel(location.baseId);
    else if (kind === 'global') holder = globalHolder;
    else if (kind === 'egg-guild') holder = 'ギルド保管庫';
    else holder = playerName(players, holderUid) || '不明';
    let placeDetail = PLACE_LABELS[kind];
    // パルボックスはページと位置まで出す（共有の placeLabel にも入るので、参加している人にも出る）
    const boxAt = kind === 'palbox' ? palboxPosition(location.slotIndex) : null;
    if (boxAt) placeDetail = `${PLACE_LABELS.palbox} ${boxAt.page} ページ・${boxAt.row} 行 ${boxAt.column} 列`;
    else if (kind === 'base') placeDetail = baseLabel(location.baseId);
    else if (egg && location.baseId && bases.has(location.baseId)) placeDetail = `${PLACE_LABELS[kind]}・${baseLabel(location.baseId)}`;
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
      place: kind,
      placeGroup: placeGroup(kind),
      placeLabel: text(placeDetail, 200),
      holderUid,
      holder: text(holder, 60),
      lastOwnerUid: source.lastOwnerUid ?? '',
      lastOwner: playerName(players, source.lastOwnerUid),
      baseId: location.baseId ?? '',
    });
  }
  return {
    world: snapshot?.world ?? {},
    // 一覧に出すプレイヤーと拠点は、共有と同じ件数まで（所持者の名前は、上ですべてのプレイヤーから引いている）
    players: [...players.values()].slice(0, PLAYERS_MAX),
    bases: [...bases.values()].sort((a, b) => (a.number || Infinity) - (b.number || Infinity)).slice(0, BASES_MAX)
      .map((base) => ({ ...base, label: baseLabel(base.id) })),
    pals: entries,
    // 配合牧場（親が読めた牧場だけ）。理想個体の配合の計画で、置いてある組と比べる。牧場を読む前の解析結果では null（情報がない）
    farms: Array.isArray(snapshot?.breedFarms) ? objects(snapshot.breedFarms).filter((farm) => farm.status !== 'uncertain')
      .map((farm) => ({ id: farm.id, baseId: farm.baseId ?? '', parents: list(farm.parents, { map: (parent) => (isObject(parent) ? parent.instanceId : null) }) })) : null,
    stats: snapshot?.stats ?? {},
  };
}

export function hasPassives(pal, passiveIds) {
  return passiveIds.every((id) => pal.passives.includes(id));
}

const GENDER_WORDS = { M: ['オス', '♂'], F: ['メス', '♀'] };

// キーワードで探す項目。数値（レベル・★・個体値）は専用の絞り込みがあるので含めない。
// スキルとパッシブは、名前と説明を同じ順番で並べる（一致した理由を出すときに、説明から名前を引く）
function keywordFields(pal) {
  return {
    name: [pal.name, pal.en, pal.characterId],
    nickname: [pal.nickname],
    elements: pal.elements ?? [],
    partnerSkill: [pal.partnerSkill],
    partnerSkillDesc: [pal.partnerSkillDesc],
    skills: pal.skillNames ?? [],
    skillDescs: pal.skillDescs ?? [],
    passives: pal.passiveNames,
    passiveDescs: pal.passiveDescs ?? [],
    gender: GENDER_WORDS[pal.gender] ?? [],
    status: [pal.egg && 'タマゴ', pal.lucky && 'ラッキー', pal.alpha && 'アルファ'],
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

// 個体の探す文字列（all）と、そのうち一致した理由に使う項目（notes。keywordNotes が見る）
function keywordEntries(pal) {
  let entries = keywordCache.get(pal);
  if (entries) return entries;
  entries = { all: [], notes: [] };
  const fields = keywordFields(pal);
  for (const field of Object.keys(fields)) {
    const values = fields[field];
    const note = NOTE_KEYS.has(field);
    for (let index = 0; index < values.length; index++) {
      const text = values[index] ? normalizedText(values[index]) : '';
      if (!text) continue;
      const entry = { field, index, text };
      entries.all.push(entry);
      if (note) entries.notes.push(entry);
    }
  }
  keywordCache.set(pal, entries);
  return entries;
}
const keywordTexts = (pal) => keywordEntries(pal).all;

/** キーワードで探すための文字列を先に作っておく（データを読み込んだ後、入力の前に区切って呼ぶ） */
export function prepareKeywords(pal) {
  keywordEntries(pal);
}

/**
 * キーワードを、探す語に分ける（空白で区切ると、すべてを含む個体に絞る）。
 * ひらがなとカタカナ・全角と半角・大文字と小文字の違いはそろえる。
 */
export function keywordTerms(query) {
  return normalizeQuery(query).split(/\s+/).filter(Boolean);
}

/** 語がすべて、いずれかの項目に含まれるか。 */
export function matchesKeywords(pal, terms) {
  const texts = keywordTexts(pal);
  return terms.every((term) => texts.some((entry) => entry.text.includes(term)));
}

// 一覧に出していない項目のうち、一致したら行に出すもの（見出し・名前の項目・説明の項目）
const NOTE_FIELDS = [
  { label: 'アクティブスキル', names: (pal) => pal.skillNames ?? [], descs: (pal) => pal.skillDescs ?? [], field: 'skills', descField: 'skillDescs' },
  { label: 'パートナースキル', names: (pal) => [pal.partnerSkill], descs: (pal) => [pal.partnerSkillDesc], field: 'partnerSkill', descField: 'partnerSkillDesc' },
  // パッシブの名前は一覧に出ているので、説明で一致したときだけ出す
  { label: 'パッシブ', names: (pal) => pal.passiveNames, descs: (pal) => pal.passiveDescs ?? [], field: '', descField: 'passiveDescs' },
];
// 一致した理由に使う項目（NOTE_FIELDS の field と descField。keywordNotes はこの項目の文字列だけを見る）
const NOTE_KEYS = new Set(NOTE_FIELDS.flatMap(({ field, descField }) => [field, descField]).filter(Boolean));

/**
 * 一致した理由として行に出すもの。スキルは名前か説明で、パッシブは説明で語を含むもの。説明は、説明で一致したときだけ付ける。
 * @returns {{ label: string, name: string, desc: string }[]}
 */
export function keywordNotes(pal, terms) {
  const hit = new Set();
  for (const entry of keywordEntries(pal).notes) {
    if (terms.some((term) => entry.text.includes(term))) hit.add(`${entry.field}:${entry.index}`);
  }
  if (!hit.size) return [];
  const notes = [];
  for (const { label, names, descs, field, descField } of NOTE_FIELDS) {
    const descList = descs(pal);
    names(pal).forEach((name, index) => {
      const byDesc = hit.has(`${descField}:${index}`);
      if (name && (byDesc || hit.has(`${field}:${index}`))) notes.push({ label, name, desc: byDesc ? descList[index] : '' });
    });
  }
  return notes;
}

/**
 * 一覧の絞り込み。
 * @param {object[]} pals normalizeOwned の pals
 * @param {{ holder?: string, place?: string, palId?: string, passives?: string[], query?: string, eggs?: boolean, globals?: boolean,
 *   stars?: number, talent?: { hp?: number, shot?: number, defense?: number } }} filter
 *   holder は 'player:<uid>' / 'base:<baseId>' / 'global' / ''（すべて）。stars はパル濃縮（★の数）の下限、talent は個体値の下限
 */
export function filterOwned(pals, {
  holder = '', place = '', palId = '', passives = [], query = '', eggs = true, globals = true, stars = 0, talent = {},
} = {}) {
  const terms = keywordTerms(query);
  const minStars = Number(stars) || 0;
  const min = { hp: Number(talent.hp) || 0, shot: Number(talent.shot) || 0, defense: Number(talent.defense) || 0 };
  return pals.filter((pal) => {
    if (pal.stars < minStars) return false;
    if (pal.talent.hp < min.hp || pal.talent.shot < min.shot || pal.talent.defense < min.defense) return false;
    if (!eggs && pal.egg) return false;
    if (!globals && pal.place === 'global') return false;
    if (place && pal.placeGroup !== place) return false;
    if (holder.startsWith('player:') && pal.holderUid !== holder.slice(7)) return false;
    if (holder.startsWith('base:') && pal.baseId !== holder.slice(5)) return false;
    if (holder === 'global' && pal.place !== 'global') return false;
    if (palId && pal.palId !== palId) return false;
    if (passives.length && !hasPassives(pal, passives)) return false;
    if (terms.length && !matchesKeywords(pal, terms)) return false;
    return true;
  });
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const OWNED_SORTS = Object.freeze([
  ['dex', '図鑑番号順'],
  ['passives', 'パッシブの数が多い順'],
  ['level', 'レベルの高い順'],
  ['stars', 'パル濃縮（★）の多い順'],
  ['talent', '個体値の合計が高い順'],
  ['place', '場所順'],
]);

export function sortOwned(pals, key = 'dex') {
  const dex = (a, b) => a.no - b.no || Number(a.variant) - Number(b.variant) || compareText(a.characterId, b.characterId);
  const talent = (pal) => pal.talent.hp + pal.talent.shot + pal.talent.defense;
  const placeRank = (pal) => PLACE_ORDER.indexOf(pal.placeGroup);
  const comparators = {
    dex: (a, b) => dex(a, b) || b.level - a.level,
    passives: (a, b) => b.passives.length - a.passives.length || dex(a, b),
    level: (a, b) => b.level - a.level || dex(a, b),
    stars: (a, b) => b.stars - a.stars || b.level - a.level || dex(a, b),
    talent: (a, b) => talent(b) - talent(a) || dex(a, b),
    place: (a, b) => placeRank(a) - placeRank(b) || compareText(a.holder, b.holder) || dex(a, b),
  };
  return [...pals].sort(comparators[key] ?? comparators.dex);
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
 * 継承ルートの開始候補: 指定のパッシブをすべて持つ所持パルの種類ごとに、登録済みの配合で目標までの最短経路を調べる。
 * 経路の探索は shortestRoute（登録済みの配合だけを使う）に任せる。
 * @param {{ graph: Map, pals: object[], to: string, passives: string[], shortestRoute: Function }} input
 * @returns {{ palId: string, carriers: object[], route: object|null, length: number }[]} 近い順（たどり着けないものは除く）
 */
export function ownedRouteStarts({ graph, pals, to, passives, shortestRoute }) {
  const candidates = [];
  for (const [palId, list] of ownedBySpecies(pals)) {
    const carriers = list.filter((pal) => hasPassives(pal, passives));
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
    || (a.palId < b.palId ? -1 : a.palId > b.palId ? 1 : 0));
}

/** 相手親の所持数（タマゴは除く）と、そのうち指定のパッシブをすべて持つ数。 */
export function partnerOwnership(bySpecies, palId, passives) {
  const list = (bySpecies.get(palId) ?? []).filter((pal) => !pal.egg);
  return { total: list.length, matching: passives.length ? list.filter((pal) => hasPassives(pal, passives)).length : 0 };
}

// ---------------------------------------------------------------------------
// スプレッドシートでの共有（ホストがアップロードし、全員が読む）
// ---------------------------------------------------------------------------

/** 画面用の一覧を、共有の行（OWNED_FIELDS の順の配列）にする。文字列はそのまま送り、式の無害化は GAS 側で行う。 */
export function sharedUpload(owned) {
  const rows = owned.pals.map((pal) => {
    const value = {
      instanceId: pal.id, palId: pal.palId, palName: pal.name, characterId: pal.characterId, nickname: pal.nickname,
      gender: pal.gender, level: String(pal.level), rank: String(pal.rank), stars: String(pal.stars),
      passiveIds: pal.passives.join('|'), talentHp: String(pal.talent.hp), talentShot: String(pal.talent.shot), talentDefense: String(pal.talent.defense),
      lucky: pal.lucky ? '1' : '', alpha: pal.alpha ? '1' : '', egg: pal.egg ? '1' : '', place: pal.place, placeLabel: pal.placeLabel,
      holderUid: pal.holderUid, holder: pal.holder, baseId: pal.baseId, lastOwner: pal.lastOwner, skillIds: pal.skills.join('|'),
    };
    for (let i = 0; i < 4; i++) value[`passive${i + 1}`] = pal.passiveNames[i] ?? '';
    return OWNED_FIELDS.map((field) => value[field] ?? '');
  });
  return {
    players: owned.players.map((player) => ({ uid: player.uid, name: player.name })),
    bases: owned.bases.map((base) => ({ id: base.id, label: base.label })),
    // 牧場の情報がなければ送らない（「牧場なし」と区別するため）
    ...(Array.isArray(owned.farms) ? { farms: owned.farms.map((farm) => ({ id: farm.id, baseId: farm.baseId, parents: farm.parents })) } : {}),
    columns: OWNED_FIELDS,
    rows,
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
  const [ID, PAL_ID, PAL_NAME, CHARACTER, NICKNAME, GENDER, LEVEL_AT, RANK_AT, STARS, PASSIVE_IDS, HP, SHOT, DEFENSE, LUCKY, ALPHA, EGG, PLACE, PLACE_LABEL, HOLDER_UID, HOLDER, BASE_ID, LAST_OWNER, SKILL_IDS] = [
    'instanceId', 'palId', 'palName', 'characterId', 'nickname', 'gender', 'level', 'rank', 'stars', 'passiveIds', 'talentHp', 'talentShot', 'talentDefense',
    'lucky', 'alpha', 'egg', 'place', 'placeLabel', 'holderUid', 'holder', 'baseId', 'lastOwner', 'skillIds',
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
      lucky: get(LUCKY) === '1', place: kind, placeGroup: placeGroup(kind), placeLabel: text(get(PLACE_LABEL), 200) || PLACE_LABELS[kind],
      holderUid: get(HOLDER_UID), holder: text(get(HOLDER), 60) || '不明', lastOwnerUid: '', lastOwner: get(LAST_OWNER), baseId: get(BASE_ID),
    });
  }
  return {
    world: { name: text(world.worldName, 100), hostName: text(world.hostName, 50) },
    players: cleanSharedPlayers(world.players).map((player) => ({ uid: player.uid, name: player.name || '不明', level: 0 })),
    bases: cleanSharedBases(world.bases).map((base) => ({ id: base.id, label: base.label || '拠点' })),
    pals: entries,
    // 牧場を共有する前の GAS・ホストの画面から受けたデータには farms がない（null: 牧場の情報がない）
    farms: Array.isArray(world.farms) ? cleanOwnedFarms(world.farms) : null,
    stats: {},
  };
}
