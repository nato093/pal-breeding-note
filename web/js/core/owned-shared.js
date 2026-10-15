// 所持パルをスプレッドシートで共有するときの形。画面・GAS（npm run build:gas で gas/Shared.js に複写）・開発用 API で同じ定義を使う。
// GAS に複写するため import は使わない。

// 1 体ぶんの列（この順番で配列にして送る）。列を足すときは末尾に足し、GAS を更新する
export const OWNED_FIELDS = [
  'instanceId', 'palId', 'palName', 'characterId', 'nickname', 'gender', 'level', 'rank', 'stars',
  'passiveIds', 'passive1', 'passive2', 'passive3', 'passive4', 'talentHp', 'talentShot', 'talentDefense',
  'lucky', 'alpha', 'egg', 'place', 'placeLabel', 'holderUid', 'holder', 'baseId', 'lastOwner',
  'skillIds', 'eggItemId',
];
// 後から足した列（OWNED_FIELDS の末尾）。足す前の画面（開いたままのページ）からの共有も受け付けて空として扱い、
// GAS は setup() を実行し直してシートに列が足されるまで書かずに読む。eggItemId はタマゴのアイテム ID（名前と突然変異。farm-board）
export const OWNED_ADDED_FIELDS = ['skillIds', 'eggItemId'];
// 覚えているアクティブスキルの ID（| 区切り）は、ほかの列より長くなる
const OWNED_TEXT_MAX = { skillIds: 1000, eggItemId: 64 };
export const OWNED_MAX_ROWS = 20000;
// 配合牧場（ワールドの行に JSON で 1 セル）。牧場の ID・拠点・親（個体 ID、2 体まで）と、farm-data で足した短い鍵:
//   s: 'u'（親が読めない牧場。親は送らない）、eggs: [{ id, p, m }]（牧場の上のタマゴの中身。p はパル ID、m: 1 は突然変異。1 牧場 20 個まで）、
//   n（タマゴの数。中身を省いても分かる）、of（ワールドの牧場の総数。セルに入らず牧場を切ったときだけ付く＝一部だけ）。
// 数は 200 件まで、セルの上限（5 万字）は OWNED_FARMS_MAX_CHARS（JSON にした後の字数）で守る（fitOwnedFarms）。
// 古い GAS・古い画面はこの鍵を知らずに捨てる（id・baseId・parents だけの今までの形になる）
export const OWNED_MAX_FARMS = 200;
export const OWNED_FARMS_MAX_CHARS = 45000;
export const OWNED_FARM_EGGS_MAX = 20;
// 1 牧場のタマゴの数の上限（セーブの解析が読む数。web/js/save/palworld.js の MAX_FARM_EGGS）
const OWNED_FARM_EGG_COUNT_MAX = 64;

/** 突然変異のタマゴのアイテム ID か（PalEgg_MutationPal_*。親と関係ない子が入る） */
export function isMutationEggItem(itemId) {
  return /^PalEgg_MutationPal/i.test(String(itemId ?? ''));
}

/** 配合牧場の一覧を検証して整える（形の合わないものは捨てる。知らない鍵は落とす）。 */
export function cleanOwnedFarms(value) {
  if (!Array.isArray(value)) return [];
  // 数の上限で切ったときは、元の数を of に残す（受け取った側が「一部だけ」と分かるように）
  const cut = value.length > OWNED_MAX_FARMS ? Math.min(value.length, 10000) : 0;
  const farms = [];
  for (const farm of value.slice(0, OWNED_MAX_FARMS)) {
    if (!farm || typeof farm !== 'object') continue;
    const id = ownedText(farm.id, 40);
    const parents = Array.isArray(farm.parents) ? farm.parents.filter((parent) => typeof parent === 'string').map((parent) => ownedText(parent, 40)).filter(Boolean) : [];
    if (!id || parents.length > 2) continue;
    const clean = { id, baseId: ownedText(farm.baseId, 40), parents };
    if (farm.s === 'u') clean.s = 'u';
    if (Array.isArray(farm.eggs)) {
      const eggs = [];
      for (const egg of farm.eggs.slice(0, OWNED_FARM_EGGS_MAX)) {
        if (!egg || typeof egg !== 'object') continue;
        const eggId = ownedText(egg.id, 40);
        if (!eggId) continue;
        const item = { id: eggId };
        if (typeof egg.p === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(egg.p)) item.p = egg.p;
        if (egg.m === 1) item.m = 1;
        eggs.push(item);
      }
      clean.eggs = eggs;
    }
    if (Number.isInteger(farm.n) && farm.n >= 0 && farm.n <= OWNED_FARM_EGG_COUNT_MAX) clean.n = farm.n;
    const of = Number.isInteger(farm.of) && farm.of > 0 && farm.of <= 10000 ? farm.of : 0;
    if (of || cut) clean.of = Math.max(of, cut);
    farms.push(clean);
  }
  return farms;
}

/**
 * 配合牧場の一覧を、JSON にした後 OWNED_FARMS_MAX_CHARS 字以下に収める（入らないときだけ縮める）。
 * (1) そのまま入れば、そのまま (2) 入らなければ、全部の牧場のタマゴの中身（eggs）を外して数（n）だけにする（牧場は全部ある）
 * (3) まだ入らなければ、牧場を先頭から入る分だけ残し、残した全部の牧場に of（元の牧場の数）を付ける（一部だけ。判定は保留する）
 */
export function fitOwnedFarms(farms) {
  const list = Array.isArray(farms) ? farms : [];
  const size = (value) => JSON.stringify(value).length;
  if (size(list) <= OWNED_FARMS_MAX_CHARS) return list;
  const counted = list.map((farm) => {
    if (!Array.isArray(farm.eggs)) return farm;
    const { eggs, ...rest } = farm;
    return { ...rest, n: Number.isInteger(farm.n) ? farm.n : eggs.length };
  });
  if (size(counted) <= OWNED_FARMS_MAX_CHARS) return counted;
  const kept = [];
  let length = 2;
  for (const farm of counted) {
    const next = { ...farm, of: Math.max(Number.isInteger(farm.of) ? farm.of : 0, list.length) };
    const add = size(next) + (kept.length ? 1 : 0);
    if (length + add > OWNED_FARMS_MAX_CHARS) break;
    kept.push(next);
    length += add;
  }
  return kept;
}

function ownedText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);
}

export function ownedWorldId(value) {
  const id = String(value ?? '').trim().toUpperCase();
  return /^[0-9A-F]{32}$/.test(id) ? id : '';
}

/**
 * 所持パルのアップロードを検証して整える。
 * @returns {{ ok: true, value: object } | { ok: false, errors: { field: string, code: string }[] }}
 */
export function validateOwnedUpload(input) {
  const source = input ?? {};
  const errors = [];
  const fail = (field, code) => errors.push({ field, code });
  const worldId = ownedWorldId(source.worldId);
  if (!worldId) fail('worldId', 'INVALID_WORLD');
  const saveTime = Date.parse(source.saveUpdatedAt);
  if (typeof source.saveUpdatedAt !== 'string' || !Number.isFinite(saveTime)) fail('saveUpdatedAt', 'INVALID_TIME');
  const world = source.world && typeof source.world === 'object' ? source.world : {};
  const players = Array.isArray(source.players) ? source.players.slice(0, 100) : [];
  const bases = Array.isArray(source.bases) ? source.bases.slice(0, 200) : [];
  // 列は OWNED_FIELDS の先頭から。後から足した列のない古い形も受け付ける
  const columns = Array.isArray(source.columns) ? source.columns : [];
  const width = columns.length >= OWNED_FIELDS.length - OWNED_ADDED_FIELDS.length && columns.length <= OWNED_FIELDS.length
    && columns.every((field, i) => field === OWNED_FIELDS[i]) ? columns.length : 0;
  if (!width) fail('columns', 'INVALID_COLUMNS');
  const rows = Array.isArray(source.rows) ? source.rows : null;
  if (!rows) fail('rows', 'INVALID_ROWS');
  else if (rows.length > OWNED_MAX_ROWS) fail('rows', 'TOO_MANY');
  else if (rows.some((row) => !Array.isArray(row) || row.length !== (width || OWNED_FIELDS.length)
    || row.some((cell) => !['string', 'number', 'boolean'].includes(typeof cell)))) fail('rows', 'INVALID_ROWS');
  if (errors.length) return { ok: false, errors };
  const seen = new Set();
  const cleanRows = [];
  for (const row of rows) {
    // 古い形で届いた行は、足りない列を空にして OWNED_FIELDS の幅にそろえる
    const cells = OWNED_FIELDS.map((field, i) => ownedText(row[i], OWNED_TEXT_MAX[field] ?? 200));
    if (!cells[0] || seen.has(cells[0])) continue;
    seen.add(cells[0]);
    cleanRows.push(cells);
  }
  return {
    ok: true,
    value: {
      worldId,
      worldName: ownedText(world.name, 100),
      hostName: ownedText(world.hostName, 50),
      saveUpdatedAt: new Date(saveTime).toISOString(),
      players: players.map((player) => ({ uid: ownedText(player && player.uid, 40), name: ownedText(player && player.name, 50) })).filter((player) => player.uid),
      bases: bases.map((base) => ({ id: ownedText(base && base.id, 40), label: ownedText(base && base.label, 60) })).filter((base) => base.id),
      // 牧場を送らない古い画面からの共有では null（牧場の情報がない）。セルに入るよう縮める（GAS・開発用 API・画面で同じ上限）
      farms: source.farms === undefined || source.farms === null ? null : fitOwnedFarms(cleanOwnedFarms(source.farms)),
      rows: cleanRows,
    },
  };
}
