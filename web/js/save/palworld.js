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
 * @param {string} fileName 例 '4DE16E79000000000000000000000000_dps.sav'
 * @returns {string} 例 '4de16e79-0000-0000-0000-000000000000'、解釈できなければ ''
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

/** SaveParameter 配下の whitelist（prefix は '.SaveParameter' の位置）。 */
function palFieldSpec(prefix) {
  return {
    [prefix]: PAL_FIELDS,
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

// SaveParameter のうち使うものだけ読む（他はサイズで飛ばす）
const PAL_FIELDS = [
  'CharacterID', 'NickName', 'Gender', 'Level', 'Rank', 'Talent_HP', 'Talent_Shot', 'Talent_Defense',
  'PassiveSkillList', 'IsRarePal', 'IsPlayer', 'OwnerPlayerUId', 'OldOwnerPlayerUIds', 'SlotId',
];

const uid = (v) => (typeof v === 'string' && v !== ZERO_GUID ? v : '');
const str = (v) => (typeof v === 'string' ? v : '');
const num = (v, d) => (typeof v === 'number' ? v : d);

function genderOf(v) {
  if (typeof v !== 'string') return '';
  const s = v.startsWith('EPalGenderType::') ? v.slice(16) : v;
  return s === 'Male' || s === 'Female' ? s : '';
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
    talent: { hp: num(sp.Talent_HP, 0), shot: num(sp.Talent_Shot, 0), defense: num(sp.Talent_Defense, 0) },
    isRare: sp.IsRarePal === true,
    isPlayer: sp.IsPlayer === true,
    ownerUid: uid(sp.OwnerPlayerUId),
    lastOwnerUid: old.length ? uid(old[old.length - 1]) : '',
    containerId: uid(cont.ID),
    slotIndex: num(slot.SlotIndex, 0),
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

function bump(obj, key, n = 1) {
  obj[key] = (obj[key] || 0) + n;
}

const SP_SKIP = makeWhitelistSkip({ '': ['SaveParameter'], ...palFieldSpec('.SaveParameter') });

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
    const farm = { id: '', baseCampId: '', status: 'ok', parentInstanceIds: [], eggMapObjectIds: [], eggContainerIds: [] };
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
      r.i64();
      g.players = [{ uid: uid(playerUid), name: r.fstring() }];
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
      x.i64();
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
    x.i64();
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
    'WorkSaveData',
  ],
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

/**
 * Level.sav（解凍済み GVAS）を読む。結果はプレーンなデータのみ（Worker 間で structured clone 可能、元バッファを参照しない）。
 * @param {Uint8Array|ArrayBuffer} gvasBytes
 * @returns {object} level（buildSnapshot に渡す）
 */
export function parseLevel(gvasBytes) {
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
      const sp = readSaveParameterList(new GvasReader(raw, { skip: SP_SKIP }));
      if (!sp) throw new Error('no SaveParameter');
      const p = palFromParams(sp);
      if (p.isPlayer) {
        players.push({ uid: uid(key.PlayerUId), instanceId: uid(key.InstanceId), name: p.nickname, level: p.level });
      } else {
        pals.push({ instanceId: uid(key.InstanceId), ...p });
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

  // 卵が入っているアイテムコンテナとスロット
  const eggSlot = new Map(); // localId → { containerId, slotIndex }
  const eggContainers = new Set();
  for (const e of ws.ItemContainerSaveData || []) {
    const containerId = uid(e.key && e.key.ID);
    const slots = (e.value && e.value.Slots) || [];
    for (const s of slots) {
      const raw = s && s.RawData;
      if (!(raw instanceof Uint8Array) || raw.length === 0) continue;
      try {
        const slot = decodeItemSlot(raw);
        if (eggByLocalId.has(slot.localId) && !eggSlot.has(slot.localId)) {
          eggSlot.set(slot.localId, { containerId, slotIndex: slot.slotIndex });
          eggContainers.add(containerId);
        }
      } catch {
        bump(malformed, 'itemSlots');
      }
    }
  }

  // 卵の入ったコンテナを持つマップオブジェクト（宝箱・地面の卵・孵化器など）
  const containerOwners = {};
  for (const mo of ws.MapObjectSaveData || []) {
    const modules = (mo.ConcreteModel && mo.ConcreteModel.ModuleMap) || [];
    for (const m of modules) {
      if (m.key !== ITEM_CONTAINER_MODULE) continue;
      const raw = m.value && m.value.RawData;
      if (!(raw instanceof Uint8Array) || raw.length < 16) continue;
      const containerId = guidAt(raw, 0);
      if (!eggContainers.has(containerId) || containerOwners[containerId]) continue;
      const mapObjectId = str(mo.MapObjectId);
      let model = { baseCampId: '', position: null, buildPlayerUid: '' };
      try {
        const { baseCampId, position, buildPlayerUid } = decodeMapModel(mo.Model.RawData);
        model = { baseCampId, position, buildPlayerUid };
      } catch {
        bump(malformed, 'mapObjectModels');
      }
      containerOwners[containerId] = { mapObjectId, kind: eggPlaceKind(mapObjectId), ...model };
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

  // 配合牧場（自動登録の照合に使う）
  const breedFarms = parseBreedFarms(ws, malformed);

  const inLockerInstanceIds = (ws.InLockerCharacterInstanceIDArray || []).map((x) => uid(x && x.InstanceId)).filter(Boolean);

  return {
    kind: 'level',
    savedAtTicks: properties.Timestamp ?? null,
    players,
    pals,
    guilds,
    bases,
    guildStorages,
    eggs,
    containerOwners,
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
    'LastOnlineDateTime',
  ],
  '.SaveData.IndividualId': ['PlayerUId', 'InstanceId'],
  '.SaveData.OtomoCharacterContainerId': ['ID'],
  '.SaveData.PalStorageContainerId': ['ID'],
  '.SaveData.InventoryInfo': (name) => name.endsWith('ContainerId'),
});

/**
 * Players/<PlayerUId>.sav（解凍済み GVAS）を読む。
 * @param {Uint8Array|ArrayBuffer} gvasBytes
 * @returns {{ uid: string, instanceId: string, otomoContainerId: string, palStorageContainerId: string,
 *   inventoryContainers: Record<string, string>, lastOnlineTicks: number|string|null }}
 *   inventoryContainers は InventoryInfo の *ContainerId（キーは末尾の 'ContainerId' を除いた名前）
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
export function parsePalStorage(gvasBytes) {
  const malformed = {};
  const spPath = SPA + '.SaveParameter';
  const r = new GvasReader(gvasBytes, { skip: STORAGE_SKIP });
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
    pals.push({ instanceId: uid(iid.InstanceId), keyPlayerUid: uid(iid.PlayerUId), arrayIndex: i, ...palFromParams(sp) });
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
    talent: { ...p.talent },
    isRare: p.isRare,
    ownerUid: p.ownerUid,
    lastOwnerUid: p.lastOwnerUid,
    location: loc,
  };
}

const unwrap = (x) => (x && typeof x === 'object' && 'data' in x && !('kind' in x) ? x.data : x);

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

  for (const d of dps || []) {
    const data = d && d.data;
    if (!data || !Array.isArray(data.pals)) continue;
    for (const [k, v] of Object.entries(data.malformed || {})) bump(stats.malformed, `dps.${k}`, v);
    const playerUid = normUid(d.playerUid);
    for (const p of data.pals) {
      add(palEntry('dps', p.instanceId, p, location('dps', { playerUid, slotIndex: p.arrayIndex })));
    }
  }

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
      .map((egg) => ({ localId: egg.localId, characterId: (egg.pal && egg.pal.characterId) || egg.characterIdRaw })));
    return { id: f.id, baseId: f.baseCampId, status, parents, eggs };
  });

  const m = meta && meta.kind === 'levelMeta' ? meta : null;
  if (m) for (const [k, v] of Object.entries(m.malformed || {})) bump(stats.malformed, `meta.${k}`, v);
  const world = {
    name: m ? m.worldName : '',
    hostName: m ? m.hostPlayerName : '',
    savedAt: ticksToIso(level.savedAtTicks) || (m ? ticksToIso(m.timestampTicks) : ''),
    inGameDay: m ? m.inGameDay : 0,
  };

  return {
    version: 1,
    world,
    players: [...playerMap.values()],
    guilds,
    bases,
    pals,
    breedFarms,
    stats,
  };
}
