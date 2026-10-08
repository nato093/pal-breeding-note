// セーブから読み込んだ所持パル（スナップショット）や、スプレッドシートで共有された所持パルを、
// 画面・継承ルート・表計算で使う形にする。DOM には触れない。
// スナップショットの形は web/js/save/palworld.js の buildSnapshot、共有の列は core/owned-shared.js を参照。
import { OWNED_FIELDS, cleanOwnedFarms } from './owned-shared.js';
import humanList from '../../data/humans.js';

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
  const players = new Map((snapshot?.players ?? []).map((player) => [player.uid, player]));
  const bases = new Map((snapshot?.bases ?? []).map((base) => [base.id, base]));
  // ギルドが複数あるワールドでは、拠点の番号がギルドごとに重なるのでギルド名を添える
  const guildNames = new Map((snapshot?.guilds ?? []).map((guild) => [guild.id, guild.name]));
  const multiGuild = new Set([...bases.values()].map((base) => base.guildId)).size > 1;
  const baseLabel = (id) => {
    const base = bases.get(id);
    const label = base?.number ? `拠点 ${base.number}` : '拠点';
    if (!multiGuild || !base) return label;
    const guild = guildNames.get(base.guildId);
    return `${label}（${guild && !/^[0-9a-f]{32}$/i.test(guild) ? guild : `ギルド ${shortUid(base.guildId)}`}）`;
  };
  // グローバルパルボックスは、セーブを読み込んだ PC のアカウント（協力プレイのホスト）のもの
  const globalHolder = players.get(HOST_UID)?.name || snapshot?.world?.hostName || 'ホスト';
  const list = [];
  for (const source of snapshot?.pals ?? []) {
    const { palId, alpha } = resolve(source.characterId);
    const human = palId ? null : resolveHuman(source.characterId);
    const location = source.location ?? {};
    const kind = PLACE_LABELS[location.kind] ? location.kind : 'unknown';
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
    const passiveIds = (source.passives ?? []).filter((id) => typeof id === 'string' && id);
    const pal = palsById.get(palId);
    list.push({
      id: source.instanceId,
      palId,
      characterId: source.characterId,
      name: pal?.ja ?? (human?.ja || source.characterId),
      human,
      no: pal?.no ?? Infinity,
      variant: Boolean(pal?.variant),
      known: Boolean(pal),
      alpha,
      egg,
      nickname: source.nickname ?? '',
      gender: GENDERS[source.gender] ?? '',
      level: egg ? 0 : Number(source.level) || 1,
      rank: Number(source.rank) || 1,
      stars: Math.max(0, Math.min(4, (Number(source.rank) || 1) - 1)),
      passives: passiveIds,
      passiveNames: passiveIds.map((id) => passiveById.get(id)?.ja ?? id),
      talent: {
        hp: Number(source.talent?.hp) || 0,
        shot: Number(source.talent?.shot) || 0,
        defense: Number(source.talent?.defense) || 0,
      },
      lucky: source.isRare === true,
      place: kind,
      placeGroup: placeGroup(kind),
      placeLabel: placeDetail,
      holderUid,
      holder,
      lastOwnerUid: source.lastOwnerUid ?? '',
      lastOwner: playerName(players, source.lastOwnerUid),
      baseId: location.baseId ?? '',
    });
  }
  return {
    world: snapshot?.world ?? {},
    players: [...players.values()],
    bases: [...bases.values()].sort((a, b) => (a.number || Infinity) - (b.number || Infinity)).map((base) => ({ ...base, label: baseLabel(base.id) })),
    pals: list,
    // 配合牧場（親が読めた牧場だけ）。理想個体の配合の計画で、置いてある組と比べる。牧場を読む前の解析結果では null（情報がない）
    farms: Array.isArray(snapshot?.breedFarms) ? snapshot.breedFarms.filter((farm) => farm.status !== 'uncertain')
      .map((farm) => ({ id: farm.id, baseId: farm.baseId ?? '', parents: farm.parents.map((parent) => parent.instanceId) })) : null,
    stats: snapshot?.stats ?? {},
  };
}

export function hasPassives(pal, passiveIds) {
  return passiveIds.every((id) => pal.passives.includes(id));
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
  const q = String(query).trim().toLocaleLowerCase('ja');
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
    if (q && ![pal.name, pal.nickname, pal.characterId, ...pal.passiveNames].some((text) => String(text).toLocaleLowerCase('ja').includes(q))) return false;
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
      holderUid: pal.holderUid, holder: pal.holder, baseId: pal.baseId, lastOwner: pal.lastOwner,
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
  const world = shared?.world ?? {};
  const columns = Array.isArray(shared?.columns) ? shared.columns : OWNED_FIELDS;
  const index = new Map(columns.map((field, i) => [field, i]));
  const list = [];
  for (const cells of shared?.rows ?? []) {
    const get = (field) => String(cells[index.get(field)] ?? '');
    const id = get('instanceId');
    if (!id) continue;
    const palId = palsById.has(get('palId')) ? get('palId') : '';
    const pal = palsById.get(palId);
    const passiveIds = get('passiveIds').split('|').filter(Boolean);
    const kind = PLACE_LABELS[get('place')] ? get('place') : 'unknown';
    const egg = get('egg') === '1' || kind.startsWith('egg-');
    list.push({
      id, palId, characterId: get('characterId'), human: pal ? null : resolveHuman(get('characterId')),
      name: pal?.ja ?? (resolveHuman(get('characterId'))?.ja || get('palName') || get('characterId')),
      no: pal?.no ?? Infinity, variant: Boolean(pal?.variant), known: Boolean(pal), alpha: get('alpha') === '1', egg,
      nickname: get('nickname'), gender: ['M', 'F'].includes(get('gender')) ? get('gender') : '',
      level: egg ? 0 : Number(get('level')) || 1, rank: Number(get('rank')) || 1,
      stars: Math.max(0, Math.min(4, Number(get('stars')) || 0)),
      passives: passiveIds,
      passiveNames: passiveIds.map((passiveId, i) => passiveById.get(passiveId)?.ja ?? (get(`passive${i + 1}`) || passiveId)),
      talent: { hp: Number(get('talentHp')) || 0, shot: Number(get('talentShot')) || 0, defense: Number(get('talentDefense')) || 0 },
      lucky: get('lucky') === '1', place: kind, placeGroup: placeGroup(kind), placeLabel: get('placeLabel') || PLACE_LABELS[kind],
      holderUid: get('holderUid'), holder: get('holder') || '不明', lastOwnerUid: '', lastOwner: get('lastOwner'), baseId: get('baseId'),
    });
  }
  return {
    world: { name: world.worldName ?? '', hostName: world.hostName ?? '' },
    players: (world.players ?? []).filter((player) => player?.uid).map((player) => ({ uid: player.uid, name: player.name || '不明', level: 0 })),
    bases: (world.bases ?? []).filter((base) => base?.id).map((base) => ({ id: base.id, label: base.label || '拠点' })),
    pals: list,
    // 牧場を共有する前の GAS・ホストの画面から受けたデータには farms がない（null: 牧場の情報がない）
    farms: Array.isArray(world.farms) ? cleanOwnedFarms(world.farms) : null,
    stats: {},
  };
}
