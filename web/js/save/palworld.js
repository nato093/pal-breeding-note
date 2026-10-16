// Palworld のセーブ（解凍済み GVAS）から、パル一覧に必要な情報だけを取り出す。
// 依存なし・ブラウザ用。gvas.js の GvasReader を使う。
// 参照: palsav (PalworldSaveTools, MIT) の rawdata/*.py。

import { GvasReader, GvasError, readGvas, readGvasHeader, guidAt, ZERO_GUID } from './gvas.js';

// ---------------------------------------------------------------------------
// .sav ラッパー（圧縮ヘッダ）
// ---------------------------------------------------------------------------

/** .sav の save type バイト。 */
export const SAVE_TYPE = Object.freeze({ CNK: 0x30, PLM: 0x31, PLZ: 0x32 });

/**
 * .sav（圧縮済み）のヘッダを読む。解凍そのものは行わない。
 * 'CNK' ラッパー付きの場合は内側のヘッダを返し、wrapper に 'CNK' を入れる（palsav と同じ解釈）。
 * @param {Uint8Array|ArrayBuffer} bytes .sav ファイルの中身
 * @returns {{ rawSize: number, compressedSize: number, magic: string, saveType: number,
 *   dataOffset: number, wrapper: string, compression: 'oodle'|'zlib'|'zlib2' }}
 *   compression: 'oodle' = PlM（Oodle）、'zlib2' = PlZ かつ save type 0x32（zlib を 2 回）、'zlib' = それ以外の PlZ（1 回）
 */
export function readSavHeader(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 12) throw new Error('sav: file too small');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const ascii3 = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2]);
  let rawSize = dv.getUint32(0, true);
  let compressedSize = dv.getUint32(4, true);
  let magic = ascii3(8);
  let saveType = u8[11];
  let dataOffset = 12;
  let wrapper = '';
  if (magic === 'CNK') {
    if (u8.length < 24) throw new Error('sav: CNK header too small');
    wrapper = 'CNK';
    rawSize = dv.getUint32(12, true);
    compressedSize = dv.getUint32(16, true);
    magic = ascii3(20);
    saveType = u8[23];
    dataOffset = 24;
  }
  if (magic !== 'PlZ' && magic !== 'PlM') {
    if (ascii3(0) === 'GVA' && u8[3] === 0x53) throw new Error('sav: already a raw GVAS file (not compressed)');
    throw new Error(`sav: unknown magic ${JSON.stringify(magic)}`);
  }
  const compression = magic === 'PlM' ? 'oodle' : (saveType === SAVE_TYPE.PLZ ? 'zlib2' : 'zlib');
  return { rawSize, compressedSize, magic, saveType, dataOffset, wrapper, compression };
}

/** GVAS ヘッダの SaveGame クラス名 → 種別。 */
export const SAVE_CLASS_KIND = Object.freeze({
  '/Script/Pal.PalWorldSaveGame': 'level',
  '/Script/Pal.PalWorldBaseInfoSaveGame': 'levelMeta',
  '/Script/Pal.PalWorldPlayerSaveGame': 'player',
  '/Script/Pal.PalDimensionPalStorageSaveGame': 'dps',
  '/Script/Pal.PalGlobalPalStorageSaveGame': 'global',
});

/**
 * 解凍済み GVAS の種別を判定する（ファイル名に頼らない振り分け用）。
 * @param {Uint8Array|ArrayBuffer} gvasBytes
 * @returns {'level'|'levelMeta'|'player'|'dps'|'global'|'unknown'}
 */
export function detectSaveKind(gvasBytes) {
  const h = readGvasHeader(gvasBytes);
  return SAVE_CLASS_KIND[h.saveGameClassName] || 'unknown';
}

/**
 * Players/<PlayerUId>.sav / <PlayerUId>_dps.sav のファイル名から PlayerUId（GUID 文字列）を得る。
 * ファイル名は FGuid の A,B,C,D を %08X で並べたもの。
 * @param {string} fileName 例 'ABCD1234000000000000000000000000_dps.sav'
 * @returns {string} 例 'abcd1234-0000-0000-0000-000000000000'、解釈できなければ ''
 */
export function playerUidFromFileName(fileName) {
  const m = /([0-9a-fA-F]{32})(?:_dps)?(?:\.sav)?(?:\.raw)?$/.exec(String(fileName).split(/[\\/]/).pop());
  if (!m) return '';
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 24)}${h.slice(24, 32)}`;
}

// ---------------------------------------------------------------------------
// 共通ヘルパー
// ---------------------------------------------------------------------------

/**
 * 親パスごとの「読む子プロパティ」から skip 関数を作る。値は名前の配列か (name) => boolean。
 * spec に無い親の子はすべて読む。
 */
function makeWhitelistSkip(spec) {
  const m = new Map();
  for (const [parent, allow] of Object.entries(spec)) {
    if (typeof allow === 'function') m.set(parent, allow);
    else {
      const set = new Set(allow);
      m.set(parent, (name) => set.has(name));
    }
  }
  return (path, name, parent) => {
    const allow = m.get(parent);
    return allow !== undefined && !allow(name);
  };
}

/** SaveParameter 配下の whitelist（prefix は '.SaveParameter' の位置）。fields は読む項目（調べるときだけ足す。check-save の --probe） */
function palFieldSpec(prefix, fields = PAL_FIELDS) {
  return {
    [prefix]: fields,
    [prefix + '.SlotId']: ['ContainerId', 'SlotIndex'],
    [prefix + '.SlotId.ContainerId']: ['ID'],
  };
}

/** 回復モード用: 壊れた（または未知の型の）プロパティを数えて飛ばす。 */
function recoverInto(malformed, errors, key) {
  return (err) => {
    bump(malformed, key);
    if (errors.length < 5) errors.push(err.message);
    return true;
  };
}

// SaveParameter のうち使うものだけ読む（他はサイズで飛ばす）。OwnedTime 以降は save-extras（入手時刻・魂の強化・病気と空腹と SAN。
// 魂の強化と病気・空腹は Level では既定〔0・None〕のとき書かれない。docs/SAVE_FORMAT.md）
const PAL_FIELDS = [
  'CharacterID', 'NickName', 'Gender', 'Level', 'Rank', 'Talent_HP', 'Talent_Shot', 'Talent_Defense',
  'PassiveSkillList', 'EquipWaza', 'MasteredWaza', 'IsRarePal', 'IsPlayer', 'OwnerPlayerUId', 'OldOwnerPlayerUIds', 'SlotId',
  'OwnedTime', 'Rank_HP', 'Rank_Attack', 'Rank_Defence', 'Rank_CraftSpeed', 'WorkerSick', 'HungerType', 'SanityValue',
];

const uid = (v) => (typeof v === 'string' && v !== ZERO_GUID ? v : '');
const str = (v) => (typeof v === 'string' ? v : '');
const num = (v, d) => (typeof v === 'number' ? v : d);

/** 列挙の値（'EPalStatusHungerType::Starvation'）の後ろの名前。既定の値（ないときと同じ）・文字列でなければ '' */
function enumName(v, fallback) {
  if (typeof v !== 'string') return '';
  const name = v.includes('::') ? v.slice(v.lastIndexOf('::') + 2) : v;
  return name && name !== fallback ? name.slice(0, 64) : '';
}

function genderOf(v) {
  if (typeof v !== 'string') return '';
  const s = v.startsWith('EPalGenderType::') ? v.slice(16) : v;
  return s === 'Male' || s === 'Female' ? s : '';
}

/** 覚えているアクティブスキル（装備中の EquipWaza と、習得済みの MasteredWaza。片方にしかないものもある）の ID。装備中を先にする。 */
function skillsOf(sp) {
  const ids = [sp.EquipWaza, sp.MasteredWaza].flatMap((list) => (Array.isArray(list) ? list : []))
    .filter((s) => typeof s === 'string')
    .map((s) => (s.startsWith('EPalWazaID::') ? s.slice(12) : s))
    .filter((s) => s && s !== 'None');
  return [...new Set(ids)];
}

/**
 * SaveParameter（軽量オブジェクト）をパルの共通形にする。無いプロパティは UE の既定値。
 * @param {Record<string, any>} sp
 */
function palFromParams(sp) {
  const passives = Array.isArray(sp.PassiveSkillList) ? sp.PassiveSkillList.filter((s) => typeof s === 'string') : [];
  const old = Array.isArray(sp.OldOwnerPlayerUIds) ? sp.OldOwnerPlayerUIds : [];
  const slot = sp.SlotId && typeof sp.SlotId === 'object' ? sp.SlotId : {};
  const cont = slot.ContainerId && typeof slot.ContainerId === 'object' ? slot.ContainerId : {};
  return {
    characterId: str(sp.CharacterID),
    nickname: str(sp.NickName),
    gender: genderOf(sp.Gender),
    level: num(sp.Level, 1),
    rank: num(sp.Rank, 1),
    passives,
    skills: skillsOf(sp),
    talent: { hp: num(sp.Talent_HP, 0), shot: num(sp.Talent_Shot, 0), defense: num(sp.Talent_Defense, 0) },
    isRare: sp.IsRarePal === true,
    isPlayer: sp.IsPlayer === true,
    ownerUid: uid(sp.OwnerPlayerUId),
    lastOwnerUid: old.length ? uid(old[old.length - 1]) : '',
    containerId: uid(cont.ID),
    slotIndex: num(slot.SlotIndex, 0),
    // 入手した時刻（ホストの PC のローカル時刻のティック。持ち主のない個体〔NPC・タマゴ〕にはない）
    ownedAt: ticksToLocalIso(sp.OwnedTime),
    // 魂の強化（パルの魂で上げた段階。HP・攻撃・防御・作業速度）
    soul: { hp: num(sp.Rank_HP, 0), attack: num(sp.Rank_Attack, 0), defense: num(sp.Rank_Defence, 0), craft: num(sp.Rank_CraftSpeed, 0) },
    // 病気（拠点の作業の病気の種類）・空腹（Default 以外）・SAN（書かれないときは 100）
    condition: { sick: enumName(sp.WorkerSick, 'None'), hunger: enumName(sp.HungerType, 'Default'), sanity: num(sp.SanityValue, 100) },
  };
}

function isEmptyCharacterId(id) {
  return id === '' || id === 'None';
}

/** UE の DateTime ticks（100ns 単位、0001-01-01 UTC 起点）を ISO 文字列に。 */
export function ticksToIso(ticks) {
  if (ticks === null || ticks === undefined || ticks === '') return '';
  const t = Number(ticks);
  if (!Number.isFinite(t) || t <= 0) return '';
  const ms = t / 10000 - 62135596800000;
  const d = new Date(Math.round(ms));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * ホストの PC のローカル時刻で書かれた DateTime のティック（個体の OwnedTime・Level の Timestamp）を、本当の時刻（ISO）にする。
 * ticksToIso は UTC として読むので、日本時間の PC では 9 時間ずれる。ページ（解析の Worker も）はホストの PC で動くので、ブラウザの
 * タイムゾーンで年月日時を組み立てる。2^53 を超えるティックは 10 進の文字列で届くので BigInt で割る。0・読めない値は ''
 */
export function ticksToLocalIso(ticks) {
  let ms;
  try {
    if (ticks === null || ticks === undefined || ticks === '') return '';
    const big = typeof ticks === 'bigint' ? ticks : BigInt(typeof ticks === 'number' ? Math.trunc(ticks) : String(ticks).trim());
    if (big <= 0n) return '';
    ms = Number(big / 10000n - 62135596800000n);
  } catch {
    return '';
  }
  const wall = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(wall.getTime())) return '';
  const local = new Date(2000, 0, 1);
  local.setFullYear(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  local.setHours(wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds(), wall.getUTCMilliseconds());
  return Number.isNaN(local.getTime()) ? '' : local.toISOString();
}

function bump(obj, key, n = 1) {
  obj[key] = (obj[key] || 0) + n;
}

const SP_SKIP = makeWhitelistSkip({ '': ['SaveParameter'], ...palFieldSpec('.SaveParameter') });
// 調べるとき（check-save の --probe）だけ、読む項目を足した skip を作る
const spSkipWith = (extra) => (extra.length ? makeWhitelistSkip({ '': ['SaveParameter'], ...palFieldSpec('.SaveParameter', [...PAL_FIELDS, ...extra]) }) : SP_SKIP);
// 足した項目の生の値（書かれていない項目は入れない）
const probeValues = (sp, extra) => Object.fromEntries(extra.filter((name) => sp[name] !== undefined).map((name) => [name, sp[name]]));

/** RawData 内の 'SaveParameter' を持つプロパティ列を読む。 */
function readSaveParameterList(reader) {
  const props = reader.readProperties('');
  return props.SaveParameter && typeof props.SaveParameter === 'object' ? props.SaveParameter : null;
}

// ---------------------------------------------------------------------------
// MapObject の ConcreteModel クラス（palsav の MAP_OBJECT_NAME_TO_CONCRETE_MODEL_CLASS のうち卵関連）
// ConcreteModel.RawData には型名が入っていないので MapObjectId から引く。
// ---------------------------------------------------------------------------

const EGG_RELATED_MODEL_CLASS = new Map(Object.entries({
  palegg: 'PalMapObjectPalEggModel',
  palegg_fire: 'PalMapObjectPalEggModel',
  palegg_water: 'PalMapObjectPalEggModel',
  palegg_leaf: 'PalMapObjectPalEggModel',
  palegg_electricity: 'PalMapObjectPalEggModel',
  palegg_ice: 'PalMapObjectPalEggModel',
  palegg_earth: 'PalMapObjectPalEggModel',
  palegg_dark: 'PalMapObjectPalEggModel',
  palegg_dragon: 'PalMapObjectPalEggModel',
  hatchingpalegg: 'PalMapObjectHatchingEggModel',
  electrichatchingpalegg: 'PalMapObjectHatchingEggModel',
  multielectrichatchingpalegg: 'PalMapObjectMultiHatchingEggModel',
  multihatchingpalegg: 'PalMapObjectMultiHatchingEggModel',
  multielectrichatchingpaleggwithbreed: 'PalMapObjectMultiHatchingEggModel',
  enemycamp_hatchingpalegg: 'PalBuildObject',
  enemycamp_electrichatchingpalegg: 'PalBuildObject',
  enemycamp_multielectrichatchingpalegg: 'PalBuildObject',
}));

/**
 * MapObjectId → 卵の置き場所の種類。
 * @param {string} mapObjectId
 * @returns {'egg-ground'|'egg-incubator'|'egg-chest'}
 */
export function eggPlaceKind(mapObjectId) {
  const cls = EGG_RELATED_MODEL_CLASS.get(String(mapObjectId).toLowerCase());
  if (cls === 'PalMapObjectPalEggModel') return 'egg-ground';
  if (cls === 'PalMapObjectHatchingEggModel' || cls === 'PalMapObjectMultiHatchingEggModel') return 'egg-incubator';
  return 'egg-chest';
}

// ---------------------------------------------------------------------------
// RawData デコーダ（palsav rawdata/*.py と同じ並び）
// ---------------------------------------------------------------------------

/** rawdata/map_model.py: 所属拠点・初期位置・建てたプレイヤー。 */
function decodeMapModel(raw) {
  const r = new GvasReader(raw);
  const instanceId = r.guid();
  r.skipBytes(16); // concrete_model_instance_id
  const baseCampId = r.guid();
  r.skipBytes(16 + 8); // group_id_belong_to, hp(current, max)
  r.skipBytes(32); // rotation (quat)
  const position = r.vector();
  r.skipBytes(24); // scale3d
  r.skipBytes(48); // repair_work_id, owner_spawner_level_object_instance_id, owner_instance_id
  const buildPlayerUid = r.guid();
  return { instanceId: uid(instanceId), baseCampId: uid(baseCampId), position, buildPlayerUid: uid(buildPlayerUid) };
}

// ---- 配合牧場（親の割り当てと、産んだタマゴ）----

const MAX_FARM_EGGS = 64;

/** BreedFarm の ConcreteModel.RawData: 具象 ID・モデル ID・(4 バイト)・産んだタマゴの MapObject ID の配列。 */
function decodeBreedFarm(raw) {
  const r = new GvasReader(raw);
  r.skipBytes(16); // concrete_model_instance_id
  const modelId = r.guid();
  r.skipBytes(4);
  const count = r.u32();
  if (count > MAX_FARM_EGGS || count * 16 > r.remaining) throw r.error(`breed farm egg count ${count} is out of range`);
  const eggMapObjectIds = [];
  for (let i = 0; i < count; i++) eggMapObjectIds.push(r.guid());
  return { modelId, eggMapObjectIds };
}

/** rawdata/work.py: 作業の持ち主（建物のモデル ID）。id(16)・workable_bounds(112)・base_camp_id(16) の後。 */
function decodeWorkOwner(raw) {
  const r = new GvasReader(raw);
  r.skipBytes(16 + 112 + 16);
  return uid(r.guid());
}

/** rawdata/work.py の WorkAssign: 割り当てられた個体の InstanceId。id(16)・location_index(4)・assign_type(1)・player_uid(16) の後。 */
function decodeWorkAssign(raw) {
  const r = new GvasReader(raw);
  r.skipBytes(16 + 4 + 1 + 16);
  return uid(r.guid());
}

/**
 * 配合牧場ごとに、割り当てられた親の個体 ID と、産んだタマゴの入ったコンテナを集める。
 * 読めない・食い違う牧場は status: 'uncertain'（自動登録に使わない）。
 */
function parseBreedFarms(ws, malformed) {
  const farms = [];
  const wantedEggObjects = new Set();
  for (const mo of ws.MapObjectSaveData || []) {
    if (str(mo.MapObjectId).toLowerCase() !== 'breedfarm') continue;
    const farm = { id: '', baseCampId: '', status: 'ok', parentInstanceIds: [], eggMapObjectIds: [], eggContainerIds: [], cakeContainerId: '' };
    // 牧場のケーキの入れ物（ModuleMap の ItemContainer。RawData の先頭 16 バイトが入れ物 ID。save-extras）
    const cakeModule = ((mo.ConcreteModel && mo.ConcreteModel.ModuleMap) || []).find((x) => x.key === ITEM_CONTAINER_MODULE);
    const cakeRaw = cakeModule && cakeModule.value && cakeModule.value.RawData;
    if (cakeRaw instanceof Uint8Array && cakeRaw.length >= 16) farm.cakeContainerId = uid(guidAt(cakeRaw, 0));
    try {
      const model = decodeMapModel(mo.Model.RawData);
      farm.id = model.instanceId;
      farm.baseCampId = model.baseCampId;
      const concrete = decodeBreedFarm(mo.ConcreteModel.RawData);
      if (concrete.modelId !== farm.id) throw new Error('breed farm model id mismatch');
      if (concrete.eggMapObjectIds.includes(ZERO_GUID)) throw new Error('breed farm egg id is zero');
      farm.eggMapObjectIds = concrete.eggMapObjectIds;
      for (const id of farm.eggMapObjectIds) wantedEggObjects.add(id);
    } catch {
      bump(malformed, 'breedFarms');
      farm.status = 'uncertain';
    }
    if (farm.id) farms.push(farm);
  }
  if (!farms.length) return [];

  const farmById = new Map(farms.map((f) => [f.id, f]));
  for (const work of ws.WorkSaveData || []) {
    let farm;
    try {
      farm = farmById.get(decodeWorkOwner(work.RawData));
    } catch {
      continue; // 牧場以外の作業の形の違いは数えない
    }
    if (!farm) continue;
    for (const assign of work.WorkAssignMap || []) {
      try {
        const instanceId = decodeWorkAssign(assign.value.RawData);
        if (!instanceId || farm.parentInstanceIds.includes(instanceId)) farm.status = 'uncertain';
        else farm.parentInstanceIds.push(instanceId);
      } catch {
        bump(malformed, 'breedFarms');
        farm.status = 'uncertain';
      }
    }
  }
  for (const farm of farms) if (farm.parentInstanceIds.length > 2) farm.status = 'uncertain';

  // 産んだタマゴ（地面に置かれた MapObject）のアイテムコンテナ
  const eggContainerOf = new Map();
  for (const mo of ws.MapObjectSaveData || []) {
    const raw = mo.Model && mo.Model.RawData;
    if (!(raw instanceof Uint8Array) || raw.length < 16) continue;
    const id = guidAt(raw, 0);
    if (!wantedEggObjects.has(id)) continue;
    const m = ((mo.ConcreteModel && mo.ConcreteModel.ModuleMap) || []).find((x) => x.key === ITEM_CONTAINER_MODULE);
    const containerRaw = m && m.value && m.value.RawData;
    if (containerRaw instanceof Uint8Array && containerRaw.length >= 16) eggContainerOf.set(id, guidAt(containerRaw, 0));
  }
  for (const farm of farms) {
    farm.eggContainerIds = farm.eggMapObjectIds.map((id) => eggContainerOf.get(id)).filter(Boolean);
    delete farm.eggMapObjectIds;
  }
  return farms;
}

/** rawdata/base_camp.py */
function decodeBaseCamp(raw) {
  const r = new GvasReader(raw);
  const id = r.guid();
  r.fstring(); // name（テンプレート文字列。使わない）
  r.u8v(); // state
  const t = r.transform();
  r.f32(); // area_range
  const groupId = r.guid();
  return { id, groupId: uid(groupId), position: t.translation };
}

/** rawdata/worker_director.py: 拠点のパルが入るコンテナ。 */
function decodeWorkerDirector(raw) {
  const r = new GvasReader(raw);
  r.skipBytes(16 + 80 + 2); // id, spawn_transform, order, battle
  return uid(r.guid());
}

/**
 * rawdata/group.py: ギルド名と拠点の並び（＋取れればメンバー名）。
 * バージョン依存の末尾は失敗しても無視する。
 */
function decodeGroup(raw, groupType) {
  const r = new GvasReader(raw);
  const g = { id: r.guid(), type: groupType, name: '', baseIds: [], players: [] };
  r.fstring(); // group_name
  const handles = r.u32();
  r.skipBytes(handles * 32); // individual_character_handle_ids
  const shortType = groupType.replace('EPalGroupType::', '');
  if (shortType === 'Guild' || shortType === 'IndependentGuild' || shortType === 'Organization') r.u8v(); // org_type
  if (shortType === 'Guild') {
    r.skipBytes(4);
    g.baseIds = r.tarray((x) => x.guid());
    r.skipBytes(8); // unknown_1, base_camp_level
    r.skipBytes(r.u32() * 16); // map_object_instance_ids_base_camp_points
    g.name = r.fstring();
    try {
      r.skipBytes(16); // last_guild_name_modifier_player_uid
      r.skipBytes(r.u32() * 60); // guild_markers
      g.players = readGuildPlayers(r);
    } catch {
      g.players = [];
    }
  } else if (shortType === 'IndependentGuild') {
    r.skipBytes(4); // base_camp_level
    r.skipBytes(r.u32() * 16);
    g.name = r.fstring();
    try {
      const playerUid = r.guid();
      r.fstring(); // guild_name_2
      // last_online_real_time（ワールドが動いた通算の時間のティック。GameTimeSaveData.RealDateTimeTicks と同じ時計。save-extras）
      const lastOnlineTicks = r.i64();
      g.players = [{ uid: uid(playerUid), name: r.fstring(), lastOnlineTicks }];
    } catch {
      g.players = [];
    }
  }
  return g;
}

// ギルド末尾の 2 形式（2026-07 更新後 / 前）。ちょうど末尾に届く方を採用する（palsav と同じ判定）
function readGuildPlayers(r) {
  const start = r.pos;
  try {
    r.skipBytes(r.u32()); // guild_chest_allowed_roles
    r.skipBytes(4 + 16); // unknown_i32, admin_player_uid
    const players = r.tarray((x) => {
      const p = { uid: uid(x.guid()) };
      p.lastOnlineTicks = x.i64(); // last_online_real_time
      p.name = x.fstring();
      x.u8v(); // role
      return p;
    });
    const perms = r.u32();
    for (let i = 0; i < perms; i++) {
      r.u8v();
      r.skipBytes(r.u32());
    }
    r.skipBytes(4);
    if (r.eof()) return players;
  } catch {
    // v1 を試す
  }
  r.pos = start;
  r.skipBytes(16); // admin_player_uid
  const players = r.tarray((x) => {
    const p = { uid: uid(x.guid()) };
    p.lastOnlineTicks = x.i64(); // last_online_real_time
    p.name = x.fstring();
    return p;
  });
  return players;
}

/** rawdata/item_container_slots.py */
function decodeItemSlot(raw) {
  const r = new GvasReader(raw);
  const slotIndex = r.i32();
  const count = r.i32();
  const staticId = r.fstring();
  r.skipBytes(16); // created_world_id
  const localId = r.guid();
  return { slotIndex, count, staticId, localId };
}

/**
 * rawdata/dynamic_item.py の try_read_egg。卵でなければ null。
 * @returns {{ localId: string, staticId: string, characterId: string, params: object|null }|null}
 */
function decodeDynamicItemEgg(raw) {
  if (raw.length === 0) return null;
  const r = new GvasReader(raw, { skip: SP_SKIP });
  r.skipBytes(16); // created_world_id
  const localId = r.guid();
  const staticId = r.fstring();
  try {
    r.skipBytes(4);
    const characterId = r.fstring();
    const params = readSaveParameterList(r);
    return { localId, staticId, characterId, params };
  } catch (e) {
    if (e instanceof GvasError) return null; // 武器・防具など（palsav も例外で判定）
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Level.sav
// ---------------------------------------------------------------------------

const WS = '.worldSaveData';
const MO = WS + '.MapObjectSaveData.MapObjectSaveData';
const WK = WS + '.WorkSaveData.WorkSaveData';

const LEVEL_SKIP = makeWhitelistSkip({
  '': ['worldSaveData', 'Timestamp'],
  [WS]: [
    'CharacterSaveParameterMap', 'MapObjectSaveData', 'BaseCampSaveData', 'ItemContainerSaveData',
    'DynamicItemSaveData', 'GroupSaveDataMap', 'GuildExtraSaveDataMap', 'InLockerCharacterInstanceIDArray',
    'WorkSaveData', 'GameTimeSaveData',
  ],
  // ワールドが動いた通算の時間（RealDateTimeTicks。ギルドのメンバーの最終ログインと同じ時計で、プレイ中の判定に使う）と、
  // ゲーム内の時刻（GameDateTimeTicks。1 日 = 864e9 ティック。Day）。save-extras
  [WS + '.GameTimeSaveData']: ['RealDateTimeTicks', 'GameDateTimeTicks'],
  [WS + '.CharacterSaveParameterMap.Key']: ['PlayerUId', 'InstanceId'],
  [WS + '.CharacterSaveParameterMap.Value']: ['RawData'],
  [MO]: ['MapObjectId', 'Model', 'ConcreteModel'],
  [MO + '.Model']: ['RawData'],
  [MO + '.ConcreteModel']: ['ModuleMap', 'RawData'],
  [MO + '.ConcreteModel.ModuleMap.Value']: ['RawData'],
  [WS + '.BaseCampSaveData.Value']: ['RawData', 'WorkerDirector'],
  [WS + '.BaseCampSaveData.Value.WorkerDirector']: ['RawData'],
  [WS + '.ItemContainerSaveData.Key']: ['ID'],
  [WS + '.ItemContainerSaveData.Value']: ['Slots'],
  [WS + '.ItemContainerSaveData.Value.Slots.Slots']: ['RawData'],
  [WS + '.DynamicItemSaveData.DynamicItemSaveData']: ['RawData'],
  [WS + '.GroupSaveDataMap.Value']: ['GroupType', 'RawData'],
  [WS + '.GuildExtraSaveDataMap.Value']: ['GuildItemStorage'],
  [WS + '.GuildExtraSaveDataMap.Value.GuildItemStorage']: ['RawData'],
  [WS + '.InLockerCharacterInstanceIDArray.StructProperty']: ['PlayerUId', 'InstanceId'],
  [WK]: ['RawData', 'WorkAssignMap'],
  [WK + '.WorkAssignMap.Value']: ['RawData'],
});

const ITEM_CONTAINER_MODULE = 'EPalMapObjectConcreteModelModuleType::ItemContainer';
const CHARACTER_CONTAINER_MODULE = 'EPalMapObjectConcreteModelModuleType::CharacterContainer';
// 牧場の入れ物のケーキ（Cake・Cake02〜Cake05。ほかのアイテムは数えない）
const CAKE_ITEM = /^Cake\d*$/i;
// アイテムの在庫に数えるもの（implants）: インプラント（PalPassiveSkillChange_〈パッシブ〉・…_Consumable_〈パッシブ〉）とパルリバーサー
const STOCK_ITEM = /^(?:PalPassiveSkillChange_[A-Za-z0-9_]+|PalGenderReverse)$/i;
// 在庫を数えた拠点の MapObject の種類（拠点の箱・配合牧場・ほかの設備）
const stockObject = (mapObjectId) => (/^ItemChest/i.test(mapObjectId) ? 'chest' : /^BreedFarm/i.test(mapObjectId) ? 'farm' : 'other');

/**
 * Level.sav（解凍済み GVAS）を読む。結果はプレーンなデータのみ（Worker 間で structured clone 可能、元バッファを参照しない）。
 * @param {Uint8Array|ArrayBuffer} gvasBytes
 * @param {{ extraPalFields?: string[] }} [options] extraPalFields は個体の SaveParameter から足して読む項目（check-save の --probe だけ。
 *   個体の probe に生の値が入る）。ふだんは渡さない
 * @returns {object} level（buildSnapshot に渡す）
 */
export function parseLevel(gvasBytes, { extraPalFields = [] } = {}) {
  const extra = Array.isArray(extraPalFields) ? extraPalFields.filter((name) => typeof name === 'string') : [];
  const spSkip = spSkipWith(extra);
  const malformed = {};
  const errors = [];
  // 構造の一部が壊れていても（または未知の型でも）サイズで飛ばして続行し、malformed.properties に数える
  const { header, properties } = readGvas(gvasBytes, { skip: LEVEL_SKIP, onError: recoverInto(malformed, errors, 'properties') });
  if (SAVE_CLASS_KIND[header.saveGameClassName] !== 'level') {
    throw new Error(`parseLevel: unexpected save class ${header.saveGameClassName}`);
  }
  const ws = properties.worldSaveData || {};

  // キャラクター（プレイヤーとパル）
  const players = [];
  const pals = [];
  for (const e of ws.CharacterSaveParameterMap || []) {
    try {
      const key = e.key || {};
      const raw = e.value && e.value.RawData;
      if (!(raw instanceof Uint8Array)) throw new Error('no RawData');
      const sp = readSaveParameterList(new GvasReader(raw, { skip: spSkip }));
      if (!sp) throw new Error('no SaveParameter');
      const p = palFromParams(sp);
      if (p.isPlayer) {
        players.push({ uid: uid(key.PlayerUId), instanceId: uid(key.InstanceId), name: p.nickname, level: p.level });
      } else {
        pals.push({ instanceId: uid(key.InstanceId), ...p, ...(extra.length ? { probe: probeValues(sp, extra) } : {}) });
      }
    } catch {
      bump(malformed, 'characters');
    }
  }

  // ギルド
  const guilds = [];
  for (const e of ws.GroupSaveDataMap || []) {
    const v = e.value || {};
    const type = str(v.GroupType);
    if (type !== 'EPalGroupType::Guild' && type !== 'EPalGroupType::IndependentGuild') continue;
    try {
      const g = decodeGroup(v.RawData, type);
      if (!g.id) g.id = uid(e.key);
      guilds.push(g);
    } catch {
      bump(malformed, 'groups');
    }
  }

  // 拠点
  const bases = [];
  for (const e of ws.BaseCampSaveData || []) {
    try {
      const v = e.value || {};
      const b = decodeBaseCamp(v.RawData);
      let containerId = '';
      try {
        containerId = decodeWorkerDirector(v.WorkerDirector.RawData);
      } catch {
        bump(malformed, 'workerDirectors');
      }
      bases.push({ id: uid(e.key) || b.id, guildId: b.groupId, containerId, position: b.position });
    } catch {
      bump(malformed, 'bases');
    }
  }

  // ギルド倉庫
  const guildStorages = [];
  for (const e of ws.GuildExtraSaveDataMap || []) {
    try {
      const raw = e.value.GuildItemStorage.RawData;
      guildStorages.push({ guildId: uid(e.key), containerId: uid(guidAt(raw, 0)) });
    } catch {
      bump(malformed, 'guildStorages');
    }
  }

  // 卵（DynamicItemSaveData のうち卵として読めるもの）
  const eggByLocalId = new Map();
  let dynamicItems = 0;
  for (const e of ws.DynamicItemSaveData || []) {
    dynamicItems++;
    const raw = e && e.RawData;
    if (!(raw instanceof Uint8Array)) continue;
    try {
      const egg = decodeDynamicItemEgg(raw);
      if (egg) eggByLocalId.set(egg.localId, egg);
    } catch {
      bump(malformed, 'dynamicItems');
    }
  }

  // 配合牧場（自動登録の照合に使う）。ケーキの入れ物を下のスロットのループで読むので先に集める
  const breedFarms = parseBreedFarms(ws, malformed);
  // 牧場の入れ物 ID → ケーキ（アイテム ID → 個数。スロットの順）。入れ物が見つからない牧場はケーキが分からない（null のまま）。
  // 読めないスロットがあった入れ物（unreadCakes）も数を確かめられないので分からない（null。「ケーキ切れ」と出さない）
  const farmCakes = new Map(breedFarms.filter((farm) => farm.cakeContainerId).map((farm) => [farm.cakeContainerId, null]));
  const unreadCakes = new Set();
  // アイテムの在庫（implants）: 入れ物 ID → アイテム ID → 個数（インプラントとパルリバーサーだけ。どの入れ物を在庫に数えるかは buildSnapshot が
  // 持ち主で決める）
  const itemCounts = new Map();

  // 卵が入っているアイテムコンテナとスロット
  const eggSlot = new Map(); // localId → { containerId, slotIndex }
  const eggContainers = new Set();
  for (const e of ws.ItemContainerSaveData || []) {
    const containerId = uid(e.key && e.key.ID);
    const slots = (e.value && e.value.Slots) || [];
    const cakes = farmCakes.has(containerId) ? new Map() : null;
    if (cakes) farmCakes.set(containerId, cakes);
    for (const s of slots) {
      const raw = s && s.RawData;
      if (!(raw instanceof Uint8Array) || raw.length === 0) {
        // 牧場の入れ物の中身の分からないスロット（RawData がない・0 バイト）も、ケーキの数を確かめられない（実セーブの 13,464 スロットには
        // なかった。2026-10-16 に確かめた。ほかの入れ物は今までどおり読み飛ばす）
        if (cakes) unreadCakes.add(containerId);
        continue;
      }
      try {
        const slot = decodeItemSlot(raw);
        if (eggByLocalId.has(slot.localId) && !eggSlot.has(slot.localId)) {
          eggSlot.set(slot.localId, { containerId, slotIndex: slot.slotIndex });
          eggContainers.add(containerId);
        }
        if (cakes && slot.count > 0 && CAKE_ITEM.test(slot.staticId)) cakes.set(slot.staticId, (cakes.get(slot.staticId) || 0) + slot.count);
        if (slot.count > 0 && STOCK_ITEM.test(slot.staticId)) {
          let counted = itemCounts.get(containerId);
          if (!counted) itemCounts.set(containerId, (counted = new Map()));
          counted.set(slot.staticId, (counted.get(slot.staticId) || 0) + slot.count);
        }
      } catch {
        bump(malformed, 'itemSlots');
        if (cakes) unreadCakes.add(containerId);
      }
    }
  }
  for (const farm of breedFarms) {
    const cakes = farm.cakeContainerId && !unreadCakes.has(farm.cakeContainerId) ? farmCakes.get(farm.cakeContainerId) : null;
    farm.cakes = cakes ? [...cakes].map(([itemId, count]) => ({ itemId, count })) : null;
    delete farm.cakeContainerId;
  }

  // 観賞用ケージ（MapObjectId が DisplayCharacter。ModuleMap の CharacterContainer の RawData の先頭 16 バイトが入れ物 ID）。
  // 中の個体の SlotId はこの入れ物を指す（前は場所が「不明」になっていた。save-extras）
  const displayCages = [];
  for (const mo of ws.MapObjectSaveData || []) {
    if (!/^DisplayCharacter/i.test(str(mo.MapObjectId))) continue;
    const m = ((mo.ConcreteModel && mo.ConcreteModel.ModuleMap) || []).find((x) => x.key === CHARACTER_CONTAINER_MODULE);
    const raw = m && m.value && m.value.RawData;
    if (!(raw instanceof Uint8Array) || raw.length < 16) continue;
    let baseCampId = '';
    try {
      baseCampId = decodeMapModel(mo.Model.RawData).baseCampId;
    } catch {
      bump(malformed, 'mapObjectModels');
    }
    displayCages.push({ containerId: uid(guidAt(raw, 0)), baseCampId });
  }

  // 卵の入ったコンテナを持つマップオブジェクト（宝箱・地面の卵・孵化器など）と、在庫を数えたコンテナを持つマップオブジェクト（拠点の箱・
  // ワールドの宝箱など。implants）。在庫の持ち主（itemOwners）は卵の持ち主（containerOwners）と別に持ち、卵の場所の判定は前と同じ
  // 入れ物・同じ順（最初に見つかったマップオブジェクト）で決める
  const containerOwners = {};
  const itemOwners = {};
  for (const mo of ws.MapObjectSaveData || []) {
    const modules = (mo.ConcreteModel && mo.ConcreteModel.ModuleMap) || [];
    for (const m of modules) {
      if (m.key !== ITEM_CONTAINER_MODULE) continue;
      const raw = m.value && m.value.RawData;
      if (!(raw instanceof Uint8Array) || raw.length < 16) continue;
      const containerId = guidAt(raw, 0);
      const forEgg = eggContainers.has(containerId) && !containerOwners[containerId];
      const forItems = itemCounts.has(containerId) && !itemOwners[containerId];
      if (!forEgg && !forItems) continue;
      const mapObjectId = str(mo.MapObjectId);
      let model = { baseCampId: '', position: null, buildPlayerUid: '' };
      try {
        const { baseCampId, position, buildPlayerUid } = decodeMapModel(mo.Model.RawData);
        model = { baseCampId, position, buildPlayerUid };
      } catch {
        bump(malformed, 'mapObjectModels');
      }
      if (forEgg) containerOwners[containerId] = { mapObjectId, kind: eggPlaceKind(mapObjectId), ...model };
      if (forItems) itemOwners[containerId] = { mapObjectId, baseCampId: model.baseCampId };
    }
  }

  const eggs = [];
  for (const egg of eggByLocalId.values()) {
    const slot = eggSlot.get(egg.localId);
    eggs.push({
      localId: egg.localId,
      staticId: egg.staticId,
      characterIdRaw: egg.characterId,
      pal: egg.params ? palFromParams(egg.params) : null,
      containerId: slot ? slot.containerId : '',
      slotIndex: slot ? slot.slotIndex : -1,
    });
  }

  const inLockerInstanceIds = (ws.InLockerCharacterInstanceIDArray || []).map((x) => uid(x && x.InstanceId)).filter(Boolean);

  const gameTime = ws.GameTimeSaveData && typeof ws.GameTimeSaveData === 'object' ? ws.GameTimeSaveData : {};
  return {
    kind: 'level',
    savedAtTicks: properties.Timestamp ?? null,
    // ワールドが動いた通算の時間とゲーム内の時刻（ティック。読めなければ null。save-extras）
    realDateTimeTicks: gameTime.RealDateTimeTicks ?? null,
    gameDateTimeTicks: gameTime.GameDateTimeTicks ?? null,
    players,
    pals,
    guilds,
    bases,
    guildStorages,
    eggs,
    containerOwners,
    displayCages,
    // アイテムの在庫（implants）: 入れ物ごとのインプラント・パルリバーサーの数と、その入れ物を持つマップオブジェクト（拠点の中か）
    itemCounts: [...itemCounts].map(([containerId, counted]) => ({ containerId, items: [...counted].map(([itemId, count]) => ({ itemId, count })) })),
    itemOwners,
    inLockerInstanceIds,
    breedFarms,
    counts: {
      characters: (ws.CharacterSaveParameterMap || []).length,
      dynamicItems,
      eggs: eggs.length,
      mapObjects: (ws.MapObjectSaveData || []).length,
      itemContainers: (ws.ItemContainerSaveData || []).length,
    },
    malformed,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Players/<uid>.sav
// ---------------------------------------------------------------------------

const PLAYER_SKIP = makeWhitelistSkip({
  '': ['SaveData', 'Timestamp'],
  '.SaveData': [
    'PlayerUId', 'IndividualId', 'OtomoCharacterContainerId', 'PalStorageContainerId', 'InventoryInfo',
    'LastOnlineDateTime', 'RecordData',
  ],
  '.SaveData.IndividualId': ['PlayerUId', 'InstanceId'],
  '.SaveData.OtomoCharacterContainerId': ['ID'],
  '.SaveData.PalStorageContainerId': ['ID'],
  '.SaveData.InventoryInfo': (name) => name.endsWith('ContainerId'),
  // 捕獲数だけ（paldex。図鑑の登録 PaldeckUnlockFlag は画面で使わないので読まない。調べるのは check-save の --probe の [7]）
  '.SaveData.RecordData': ['PalCaptureCount'],
});

// 捕獲数の種類の上限（パルは 300 体ほど。人間などパルでないキーも入る）
const CAPTURES_MAX = 2000;

/**
 * 捕獲数（RecordData の PalCaptureCount。MapProperty<NameProperty, IntProperty> を { key, value } の並びで読んだもの）を
 * [{ id: キャラクター ID, count }] にする（paldex）。キーはセーブのまま（大文字小文字の違い・人間などは画面の側〔core/owned.js〕が引く）。
 * 0 回は省く。項目がない（古いセーブ・読めなくて飛ばした）・形が違う（使える項目が 1 つもない）なら null（分からない）
 */
function capturesOf(value) {
  if (!Array.isArray(value)) return null;
  const list = [];
  let valid = 0;
  for (const entry of value) {
    const id = entry && typeof entry.key === 'string' ? entry.key.slice(0, 64) : '';
    if (!id || !Number.isInteger(entry.value) || entry.value < 0) continue;
    valid++;
    if (entry.value > 0 && list.length < CAPTURES_MAX) list.push({ id, count: entry.value });
  }
  return value.length && !valid ? null : list;
}

/**
 * Players/<PlayerUId>.sav（解凍済み GVAS）を読む。
 * @param {Uint8Array|ArrayBuffer} gvasBytes
 * @returns {{ uid: string, instanceId: string, otomoContainerId: string, palStorageContainerId: string,
 *   inventoryContainers: Record<string, string>, lastOnlineTicks: number|string|null, captures: { id: string, count: number }[] | null }}
 *   inventoryContainers は InventoryInfo の *ContainerId（キーは末尾の 'ContainerId' を除いた名前）。captures は捕獲数（capturesOf）
 */
export function parsePlayer(gvasBytes) {
  const malformed = {};
  const errors = [];
  const { header, properties } = readGvas(gvasBytes, { skip: PLAYER_SKIP, onError: recoverInto(malformed, errors, 'properties') });
  if (SAVE_CLASS_KIND[header.saveGameClassName] !== 'player') {
    throw new Error(`parsePlayer: unexpected save class ${header.saveGameClassName}`);
  }
  const sd = properties.SaveData || {};
  const cid = (v) => uid(v && typeof v === 'object' ? v.ID : '');
  const inventoryContainers = {};
  for (const [k, v] of Object.entries(sd.InventoryInfo || {})) {
    if (k.endsWith('ContainerId')) {
      const id = cid(v);
      if (id) inventoryContainers[k.slice(0, -'ContainerId'.length)] = id;
    }
  }
  return {
    kind: 'player',
    uid: uid(sd.PlayerUId),
    instanceId: uid(sd.IndividualId && sd.IndividualId.InstanceId),
    otomoContainerId: cid(sd.OtomoCharacterContainerId),
    palStorageContainerId: cid(sd.PalStorageContainerId),
    inventoryContainers,
    lastOnlineTicks: sd.LastOnlineDateTime ?? null,
    // 読めない捕獲数（壊れた・知らない型）は readGvas の回復で飛ばして malformed に数える（所持パルの取り込みは続く）
    captures: capturesOf(sd.RecordData && typeof sd.RecordData === 'object' ? sd.RecordData.PalCaptureCount : undefined),
    malformed,
    errors,
  };
}

// ---------------------------------------------------------------------------
// <uid>_dps.sav / GlobalPalStorage.sav
// ---------------------------------------------------------------------------

const SPA = '.SaveParameterArray.SaveParameterArray';
const STORAGE_SKIP = makeWhitelistSkip({
  '': ['SaveParameterArray'],
  [SPA]: ['SaveParameter', 'InstanceId'],
  [SPA + '.InstanceId']: ['PlayerUId', 'InstanceId'],
  ...palFieldSpec(SPA + '.SaveParameter'),
});

/**
 * パル保管庫（Players/<uid>_dps.sav = 次元パル保管庫、GlobalPalStorage.sav = グローバルパル保管庫）を読む。
 * 空きスロット（CharacterID が 'None' / 空）は除く。壊れたスロットは malformed に数えて続行。
 * @param {Uint8Array|ArrayBuffer} gvasBytes
 * @returns {{ kind: 'dps'|'global', slotCount: number, pals: object[], malformed: Record<string, number> }}
 *   pals[i].arrayIndex は SaveParameterArray の添字（保管庫のスロット）。pals[i].containerId / slotIndex は
 *   SaveParameter.SlotId の値で、dps では預ける前のパルボックスの位置を指す（場所の判定には使わない）
 */
export function parsePalStorage(gvasBytes, { extraPalFields = [] } = {}) {
  const malformed = {};
  const spPath = SPA + '.SaveParameter';
  // extraPalFields は parseLevel と同じ（check-save の --probe だけ）
  const extra = Array.isArray(extraPalFields) ? extraPalFields.filter((name) => typeof name === 'string') : [];
  const skip = extra.length ? makeWhitelistSkip({
    '': ['SaveParameterArray'], [SPA]: ['SaveParameter', 'InstanceId'], [SPA + '.InstanceId']: ['PlayerUId', 'InstanceId'],
    ...palFieldSpec(SPA + '.SaveParameter', [...PAL_FIELDS, ...extra]),
  }) : STORAGE_SKIP;
  const r = new GvasReader(gvasBytes, { skip });
  const header = r.readHeader();
  const kind = SAVE_CLASS_KIND[header.saveGameClassName];
  if (kind !== 'dps' && kind !== 'global') {
    throw new Error(`parsePalStorage: unexpected save class ${header.saveGameClassName}`);
  }
  // 1 スロットの SaveParameter が壊れていても、サイズで次へ進む
  r.onError = (err, path) => {
    if (path !== spPath) return false;
    bump(malformed, 'slots');
    return true;
  };
  const props = r.readProperties('');
  const arr = Array.isArray(props.SaveParameterArray) ? props.SaveParameterArray : [];
  const pals = [];
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i] || {};
    const sp = e.SaveParameter;
    if (!sp || typeof sp !== 'object') continue; // malformed（onError で計数済み）
    if (isEmptyCharacterId(str(sp.CharacterID))) continue;
    const iid = e.InstanceId || {};
    pals.push({
      instanceId: uid(iid.InstanceId), keyPlayerUid: uid(iid.PlayerUId), arrayIndex: i, ...palFromParams(sp),
      ...(extra.length ? { probe: probeValues(sp, extra) } : {}),
    });
  }
  return { kind, slotCount: arr.length, pals, malformed };
}

// ---------------------------------------------------------------------------
// LevelMeta.sav
// ---------------------------------------------------------------------------

/**
 * LevelMeta.sav（解凍済み GVAS）を読む。小さいので全部読む。
 * @param {Uint8Array|ArrayBuffer} gvasBytes
 * @returns {{ worldName: string, hostPlayerName: string, hostPlayerLevel: number, inGameDay: number,
 *   timestampTicks: number|string|null, version: number|null, saveData: Record<string, any> }}
 */
export function parseLevelMeta(gvasBytes) {
  const malformed = {};
  const errors = [];
  const { header, properties } = readGvas(gvasBytes, { onError: recoverInto(malformed, errors, 'properties') });
  if (SAVE_CLASS_KIND[header.saveGameClassName] !== 'levelMeta') {
    throw new Error(`parseLevelMeta: unexpected save class ${header.saveGameClassName}`);
  }
  const sd = properties.SaveData && typeof properties.SaveData === 'object' ? properties.SaveData : {};
  return {
    kind: 'levelMeta',
    worldName: str(sd.WorldName),
    hostPlayerName: str(sd.HostPlayerName),
    hostPlayerLevel: num(sd.HostPlayerLevel, 0),
    inGameDay: num(sd.InGameDay, 0),
    timestampTicks: properties.Timestamp ?? null,
    version: num(properties.Version, null),
    saveData: { ...sd },
    malformed,
    errors,
  };
}

// ---------------------------------------------------------------------------
// スナップショット
// ---------------------------------------------------------------------------

function location(kind, extra) {
  return {
    kind,
    playerUid: '',
    baseId: '',
    containerId: '',
    slotIndex: -1,
    mapObjectId: '',
    itemId: '',
    position: null,
    ...extra,
  };
}

function palEntry(source, instanceId, p, loc) {
  return {
    instanceId,
    source,
    characterId: p.characterId,
    nickname: p.nickname,
    gender: p.gender,
    level: p.level,
    rank: p.rank,
    passives: p.passives.slice(),
    skills: p.skills.slice(),
    talent: { ...p.talent },
    isRare: p.isRare,
    ownerUid: p.ownerUid,
    lastOwnerUid: p.lastOwnerUid,
    location: loc,
    // save-extras: 入手した時刻（ISO。ないときは ''）・魂の強化・病気と空腹と SAN
    ownedAt: p.ownedAt || '',
    soul: { ...p.soul },
    condition: { ...p.condition },
  };
}

const unwrap = (x) => (x && typeof x === 'object' && 'data' in x && !('kind' in x) ? x.data : x);

// プレイ中とみなす最終ログインと通算の時間の差（10 秒 = 1 億ティック）と、ゲーム内の 1 日のティック
const ONLINE_TICKS = 1e8;
const TICKS_PER_DAY = 864e9;

// GUID 文字列、またはファイル名形式（32 桁の 16 進）を GUID 文字列にそろえる
const normUid = (s) => {
  const v = String(s || '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(v) ? playerUidFromFileName(v) : v;
};

/**
 * 各ファイルの解析結果をまとめて、正規化したスナップショットを作る。
 * @param {object} input
 * @param {object} input.level parseLevel の結果（必須）
 * @param {object[]} [input.players] parsePlayer の結果（または { data }）の配列
 * @param {{ playerUid: string, data: object }[]} [input.dps] 次元パル保管庫（parsePalStorage の結果）
 * @param {object} [input.globalStorage] parsePalStorage の結果、または { playerUid, data }
 * @param {object} [input.meta] parseLevelMeta の結果
 * @returns {object} snapshot（version: 1）
 */
export function buildSnapshot({ level, players = [], dps = [], globalStorage = null, meta = null }) {
  if (!level || level.kind !== 'level') throw new Error('buildSnapshot: level (parseLevel result) is required');
  const stats = {
    pals: 0,
    byKind: {},
    bySource: {},
    unknownLocation: 0,
    duplicates: 0,
    orphanEggs: 0,
    orphanEggsDetail: { noParams: 0, noContainer: 0, unreferencedContainer: 0 },
    malformed: {},
    // パル次元ストレージの読み漏れ（dps-missing）: Level.sav の InLockerCharacterInstanceIDArray の個体の数と、そのうち読めた _dps.sav に
    // ない数（数だけ。個体の ID は残さない）。この 2 つがない古い解析結果は、画面の側で「分からない」として案内を出さない
    inLocker: 0,
    inLockerMissing: 0,
  };
  for (const [k, v] of Object.entries(level.malformed || {})) bump(stats.malformed, `level.${k}`, v);

  const playerSaves = players.map(unwrap).filter((p) => p && p.kind === 'player');
  for (const p of playerSaves) for (const [k, v] of Object.entries(p.malformed || {})) bump(stats.malformed, `player.${k}`, v);

  // コンテナ → 場所
  const charContainer = new Map(); // containerId → { kind, playerUid, baseId }
  const itemContainer = new Map(); // containerId → { kind, playerUid, guildId }
  for (const p of playerSaves) {
    if (p.otomoContainerId) charContainer.set(p.otomoContainerId, { kind: 'party', playerUid: p.uid, baseId: '' });
    if (p.palStorageContainerId) charContainer.set(p.palStorageContainerId, { kind: 'palbox', playerUid: p.uid, baseId: '' });
    for (const id of Object.values(p.inventoryContainers || {})) {
      itemContainer.set(id, { kind: 'egg-inventory', playerUid: p.uid, guildId: '' });
    }
  }

  // ギルドと拠点（拠点番号はギルドの base_ids の順に 1..n。並びに無い拠点は 0）
  const guilds = level.guilds.map((g) => ({
    id: g.id,
    name: g.name,
    baseIds: g.baseIds.slice(),
    playerUids: g.players.map((p) => p.uid).filter(Boolean),
  }));
  const baseNumber = new Map();
  for (const g of level.guilds) g.baseIds.forEach((id, i) => { if (!baseNumber.has(id)) baseNumber.set(id, i + 1); });
  const bases = level.bases.map((b) => ({
    id: b.id,
    number: baseNumber.get(b.id) || 0,
    guildId: b.guildId,
    containerId: b.containerId,
    position: b.position ? { ...b.position } : null,
  }));
  bases.sort((a, b) => (a.guildId < b.guildId ? -1 : a.guildId > b.guildId ? 1 : (a.number || 1e9) - (b.number || 1e9)));
  for (const b of bases) {
    if (b.containerId) charContainer.set(b.containerId, { kind: 'base', playerUid: '', baseId: b.id });
  }
  // 観賞用ケージ（拠点に置く。中の個体は拠点の持ち物として扱う。save-extras）。ほかの入れ物と重なれば、そちらを優先する
  for (const cage of level.displayCages || []) {
    if (cage.containerId && !charContainer.has(cage.containerId)) charContainer.set(cage.containerId, { kind: 'display', playerUid: '', baseId: cage.baseCampId || '' });
  }
  for (const gs of level.guildStorages || []) {
    if (gs.containerId) itemContainer.set(gs.containerId, { kind: 'egg-guild', playerUid: '', guildId: gs.guildId });
  }

  // プレイヤー一覧（Level のキャラクター → ギルドのメンバー名 → プレイヤーセーブの順で補完）
  const playerMap = new Map();
  for (const p of level.players) {
    if (p.uid && !playerMap.has(p.uid)) playerMap.set(p.uid, { uid: p.uid, name: p.name, level: p.level });
  }
  for (const g of level.guilds) {
    for (const m of g.players) {
      if (!m.uid) continue;
      const cur = playerMap.get(m.uid);
      if (!cur) playerMap.set(m.uid, { uid: m.uid, name: m.name, level: 0 });
      else if (!cur.name) cur.name = m.name;
    }
  }
  for (const p of playerSaves) {
    if (p.uid && !playerMap.has(p.uid)) playerMap.set(p.uid, { uid: p.uid, name: '', level: 0 });
  }
  // 捕獲数（paldex。ホストの画面だけ・共有しない）。読めたプレイヤーだけに付ける（古いセーブ・読めなかったプレイヤーには項目がない）
  for (const p of playerSaves) {
    if (p.uid && Array.isArray(p.captures)) playerMap.get(p.uid).captures = p.captures.map(({ id, count }) => ({ id, count }));
  }
  // プレイ中（この保存の時点で接続していた）か。ギルドのメンバーの最終ログイン（last_online_real_time）と、ワールドが動いた通算の時間
  //（RealDateTimeTicks）が 10 秒（1 億ティック）以内なら true、離れていれば false、どちらかが読めなければ null（分からない）。
  // 2 つは同じ時計（日時ではない）で、接続中の人は保存のたびに同じ値になる（2026-10-15 に 11 世代で差 0〜0.02 秒。docs/SAVE_FORMAT.md）
  const real = Number(level.realDateTimeTicks);
  const online = new Map();
  for (const g of level.guilds) {
    for (const m of g.players) {
      const last = Number(m.lastOnlineTicks);
      if (!m.uid || !Number.isFinite(real) || real <= 0 || m.lastOnlineTicks === undefined || !Number.isFinite(last)) continue;
      online.set(m.uid, online.get(m.uid) === true || Math.abs(real - last) <= ONLINE_TICKS);
    }
  }
  for (const p of playerMap.values()) p.online = online.has(p.uid) ? online.get(p.uid) : null;

  // パル（instanceId で重複除去）
  const pals = [];
  const byId = new Map();
  const inLocker = new Set(level.inLockerInstanceIds || []);
  const add = (entry) => {
    const key = entry.instanceId;
    if (key) {
      const prev = byId.get(key);
      if (prev !== undefined) {
        stats.duplicates++;
        // Level 側が場所不明 or 保管庫に入っている印がある場合は保管庫側を採用
        const old = pals[prev];
        if (old.source === 'level' && (old.location.kind === 'unknown' || inLocker.has(key)) && entry.source !== 'level') {
          pals[prev] = entry;
        }
        return;
      }
      byId.set(key, pals.length);
    }
    pals.push(entry);
  };

  for (const p of level.pals) {
    const c = p.containerId ? charContainer.get(p.containerId) : undefined;
    const loc = location(c ? c.kind : 'unknown', {
      playerUid: c ? c.playerUid : '',
      baseId: c ? c.baseId : '',
      containerId: p.containerId,
      slotIndex: p.slotIndex,
    });
    add(palEntry('level', p.instanceId, p, loc));
  }

  // 正しく読めた _dps.sav の個体の ID（次元ストレージの読み漏れを数える）
  const dpsIds = new Set();
  for (const d of dps || []) {
    const data = d && d.data;
    if (!data || !Array.isArray(data.pals)) continue;
    for (const [k, v] of Object.entries(data.malformed || {})) bump(stats.malformed, `dps.${k}`, v);
    const playerUid = normUid(d.playerUid);
    for (const p of data.pals) {
      if (p.instanceId) dpsIds.add(p.instanceId);
      add(palEntry('dps', p.instanceId, p, location('dps', { playerUid, slotIndex: p.arrayIndex })));
    }
  }
  // Level.sav の一覧は全員の次元ストレージの個体（キーの PlayerUId は 0 で誰の分かは分からない。グローバルパルボックスは含まない。
  // 2026-10-16 に実セーブで 118 件が 2 人の _dps.sav の 27＋91 と全部一致）。読めた _dps.sav にない個体の数を、集合の差で数える
  stats.inLocker = inLocker.size;
  stats.inLockerMissing = [...inLocker].filter((id) => !dpsIds.has(id)).length;

  const gsInput = globalStorage && globalStorage.data ? globalStorage : (globalStorage ? { playerUid: '', data: globalStorage } : null);
  if (gsInput && gsInput.data && Array.isArray(gsInput.data.pals)) {
    for (const [k, v] of Object.entries(gsInput.data.malformed || {})) bump(stats.malformed, `global.${k}`, v);
    const playerUid = normUid(gsInput.playerUid);
    for (const p of gsInput.data.pals) {
      add(palEntry('global', p.instanceId, p, location('global', { playerUid, slotIndex: p.arrayIndex })));
    }
  }

  // 卵: コンテナの持ち主で場所を決める。どこにも属さない卵は orphan として数えるだけ
  for (const egg of level.eggs) {
    let kind = '';
    let extra = {};
    const owner = egg.containerId ? level.containerOwners[egg.containerId] : undefined;
    if (!egg.containerId) {
      stats.orphanEggsDetail.noContainer++;
    } else if (owner) {
      kind = owner.kind;
      extra = {
        playerUid: owner.buildPlayerUid || '',
        baseId: owner.baseCampId || '',
        mapObjectId: owner.mapObjectId,
        position: owner.position ? { ...owner.position } : null,
      };
    } else if (itemContainer.has(egg.containerId)) {
      const ic = itemContainer.get(egg.containerId);
      kind = ic.kind;
      extra = { playerUid: ic.playerUid };
    } else {
      stats.orphanEggsDetail.unreferencedContainer++;
    }
    if (!kind) {
      stats.orphanEggs++;
      continue;
    }
    if (!egg.pal) stats.orphanEggsDetail.noParams++; // 場所はあるがパル情報なし（一覧には出す）
    const p = egg.pal || palFromParams({});
    if (!p.characterId) p.characterId = egg.characterIdRaw;
    const loc = location(kind, { containerId: egg.containerId, slotIndex: egg.slotIndex, itemId: egg.staticId, ...extra });
    add(palEntry('egg', egg.localId, p, loc));
  }

  for (const p of pals) {
    bump(stats.byKind, p.location.kind);
    bump(stats.bySource, p.source);
    if (p.location.kind === 'unknown') stats.unknownLocation++;
  }
  stats.pals = pals.length;

  // 配合牧場: 親（Level のパル）とタマゴ（コンテナの中身）を引き当てる。親が引けない牧場は uncertain
  const levelPalById = new Map(level.pals.map((p) => [p.instanceId, p]));
  const eggsByContainer = new Map();
  for (const egg of level.eggs) {
    if (!egg.containerId) continue;
    if (!eggsByContainer.has(egg.containerId)) eggsByContainer.set(egg.containerId, []);
    eggsByContainer.get(egg.containerId).push(egg);
  }
  const breedFarms = (level.breedFarms || []).map((f) => {
    let status = f.status;
    const parents = [];
    for (const instanceId of f.parentInstanceIds) {
      const p = levelPalById.get(instanceId);
      if (!p) {
        status = 'uncertain';
        continue;
      }
      // 預けた人が分からないときは空のまま（ログイン中のユーザーで登録する）。持ち主で代わりにしない
      parents.push({ instanceId, characterId: p.characterId, gender: p.gender, depositorUid: p.lastOwnerUid });
    }
    const eggs = f.eggContainerIds.flatMap((id) => (eggsByContainer.get(id) || [])
      // itemId はタマゴのアイテム（突然変異タマゴは PalEgg_MutationPal_*）
      .map((egg) => ({ localId: egg.localId, characterId: (egg.pal && egg.pal.characterId) || egg.characterIdRaw, itemId: egg.staticId })));
    // ケーキ（牧場の入れ物のケーキの種類と個数。[] はケーキ切れ、null は入れ物が読めない。ホストの画面だけ・共有しない。save-extras）
    const cakes = Array.isArray(f.cakes) ? f.cakes.map((cake) => ({ itemId: cake.itemId, count: cake.count })) : null;
    return { id: f.id, baseId: f.baseCampId, status, parents, eggs, cakes };
  });

  // アイテムの在庫（implants。ホストの画面だけ・共有しない）: 数えた入れ物のうち、ギルド保管庫・プレイヤーの所持品と、拠点の中のマップオブジェクト
  //（baseCampId のある拠点の箱・配合牧場・ほかの設備）の入れ物だけを、アイテムと場所ごとに合わせる。拠点の外の入れ物（ワールドの宝箱
  // TreasureBox_* など。baseCampId が空）と持ち主の分からない入れ物は数えない（数えると実セーブでパルリバーサーが 3 個から 88 個に化けた）
  const stock = new Map();
  for (const entry of level.itemCounts || []) {
    const ic = itemContainer.get(entry.containerId);
    const owner = level.itemOwners ? level.itemOwners[entry.containerId] : undefined;
    const place = ic && ic.kind === 'egg-guild' ? { where: 'guild', id: ic.guildId, object: '' }
      : ic && ic.kind === 'egg-inventory' ? { where: 'player', id: ic.playerUid, object: '' }
        : owner && owner.baseCampId ? { where: 'base', id: owner.baseCampId, object: stockObject(owner.mapObjectId) } : null;
    if (!place) continue;
    for (const { itemId, count } of entry.items) {
      const key = `${itemId}\u0001${place.where}\u0001${place.id}\u0001${place.object}`;
      const prev = stock.get(key);
      if (prev) prev.count += count;
      else stock.set(key, { itemId, count, ...place });
    }
  }

  const m = meta && meta.kind === 'levelMeta' ? meta : null;
  if (m) for (const [k, v] of Object.entries(m.malformed || {})) bump(stats.malformed, `meta.${k}`, v);
  // ゲーム内の日数は LevelMeta.sav の InGameDay。読めなければ Level.sav のゲーム内の時刻から（floor(GameDateTimeTicks ÷ 864e9) と一致する）
  const gameTicks = Number(level.gameDateTimeTicks);
  const world = {
    name: m ? m.worldName : '',
    hostName: m ? m.hostPlayerName : '',
    savedAt: ticksToIso(level.savedAtTicks) || (m ? ticksToIso(m.timestampTicks) : ''),
    inGameDay: m && m.inGameDay > 0 ? m.inGameDay : Number.isFinite(gameTicks) && gameTicks > 0 ? Math.floor(gameTicks / TICKS_PER_DAY) : 0,
  };

  return {
    version: 1,
    world,
    players: [...playerMap.values()],
    guilds,
    bases,
    pals,
    breedFarms,
    // アイテムの在庫（[{ itemId, count, where: 'base'|'guild'|'player', id: 拠点・ギルド・プレイヤーの ID, object: 'chest'|'farm'|'other'|'' }]。
    // 場所の呼び名は画面の側〔core/owned.js の normalizeOwned〕が付ける。implants）
    items: [...stock.values()],
    stats,
  };
}
