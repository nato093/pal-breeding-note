// 自動生成・手で編集しない。scripts/build-gas.mjs で生成。

function pairKey(a, b) {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function normalizeRecord(rec) {
  if (rec.parent1Id <= rec.parent2Id) return { ...rec };
  return {
    ...rec,
    parent1Id: rec.parent2Id,
    parent2Id: rec.parent1Id,
    parent1Gender: rec.parent2Gender,
    parent2Gender: rec.parent1Gender,
  };
}

function identityKey(rec) {
  return `${pairKey(rec.parent1Id, rec.parent2Id)}>${rec.childId}`;
}

function sanitizeText(s, max) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);
}

function validateRecordInput(input, palIdSet) {
  const source = input ?? {};
  const value = {};
  const errors = [];
  for (const field of ['parent1Id', 'parent2Id', 'childId']) {
    value[field] = source[field];
    if (!palIdSet.has(value[field])) errors.push({ field, code: 'INVALID_PAL_ID' });
  }
  for (const field of ['parent1Gender', 'parent2Gender']) {
    value[field] = source[field] ?? '';
    if (!['M', 'F', ''].includes(value[field])) errors.push({ field, code: 'INVALID_GENDER' });
  }
  for (const [field, max] of [['registrant', 30], ['memo', 200]]) {
    // 切り詰める前に検証し、長すぎる入力を黙って保存しない。
    value[field] = sanitizeText(source[field], Infinity);
    if (value[field].length > max) errors.push({ field, code: 'TOO_LONG' });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

function needsSheetQuote(s) {
  return /^[=+\-@']/.test(String(s ?? ''));
}

function quoteForSheet(s) {
  const text = String(s ?? '');
  return needsSheetQuote(text) ? `'${text}` : text;
}

function userIdKey(userId) {
  return userId.normalize('NFKC').toLowerCase();
}

function validateUserId(input) {
  if (typeof input !== 'string') {
    return { ok: false, errors: [{ field: 'userId', code: input == null ? 'REQUIRED' : 'INVALID_TYPE' }] };
  }
  const value = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const code = !value ? 'REQUIRED' : value.length > 20 ? 'TOO_LONG' : '';
  return code ? { ok: false, errors: [{ field: 'userId', code }] } : { ok: true, value };
}

// 所持パルをスプレッドシートで共有するときの形。画面・GAS（npm run build:gas で gas/Shared.js に複写）・開発用 API で同じ定義を使う。
// GAS に複写するため import は使わない。

// 1 体ぶんの列（この順番で配列にして送る）。列を足すときは末尾に足し、GAS を更新する
const OWNED_FIELDS = [
  'instanceId', 'palId', 'palName', 'characterId', 'nickname', 'gender', 'level', 'rank', 'stars',
  'passiveIds', 'passive1', 'passive2', 'passive3', 'passive4', 'talentHp', 'talentShot', 'talentDefense',
  'lucky', 'alpha', 'egg', 'place', 'placeLabel', 'holderUid', 'holder', 'baseId', 'lastOwner',
  'skillIds', 'eggItemId', 'ownedAt',
];
// 後から足した列（OWNED_FIELDS の末尾）。足す前の画面（開いたままのページ）からの共有も受け付けて空として扱い、
// GAS は setup() を実行し直してシートに列が足されるまで書かずに読む。eggItemId はタマゴのアイテム ID（名前と突然変異。farm-board）、
// ownedAt は入手した時刻（ISO。入手の新しい順と NEW。save-extras）
const OWNED_ADDED_FIELDS = ['skillIds', 'eggItemId', 'ownedAt'];
// 覚えているアクティブスキルの ID（| 区切り）は、ほかの列より長くなる
const OWNED_TEXT_MAX = { skillIds: 1000, eggItemId: 64, ownedAt: 30 };
// プレイヤーの Lv（players の JSON の中。save-extras）の上限
const OWNED_PLAYER_LEVEL_MAX = 999;
// パル次元ストレージの読み漏れの数（players の JSON の中の dpsGap。dps-missing）の上限（共有できる行数と同じ）
const OWNED_DPS_GAP_MAX = 20000;
// ゲーム内の日数（ワールドの行の列 inGameDay。save-extras）の上限
const OWNED_DAY_MAX = 1000000;
const OWNED_MAX_ROWS = 20000;
// 配合牧場（ワールドの行に JSON で 1 セル）。牧場の ID・拠点・親（個体 ID、2 体まで）と、farm-data で足した短い鍵:
//   s: 'u'（親が読めない牧場。親は送らない）、eggs: [{ id, p, m }]（牧場の上のタマゴの中身。p はパル ID、m: 1 は突然変異。1 牧場 20 個まで）、
//   n（タマゴの数。中身を省いても分かる）、of（ワールドの牧場の総数。セルに入らず牧場を切ったときだけ付く＝一部だけ）。
// 数は 200 件まで、セルの上限（5 万字）は OWNED_FARMS_MAX_CHARS（JSON にした後の字数）で守る（fitOwnedFarms）。
// 古い GAS・古い画面はこの鍵を知らずに捨てる（id・baseId・parents だけの今までの形になる）
const OWNED_MAX_FARMS = 200;
const OWNED_FARMS_MAX_CHARS = 45000;
const OWNED_FARM_EGGS_MAX = 20;
// 1 牧場のタマゴの数の上限（セーブの解析が読む数。web/js/save/palworld.js の MAX_FARM_EGGS）
const OWNED_FARM_EGG_COUNT_MAX = 64;
// 読めない牧場（s: 'u'）の親の代わり（個体 ID は英数字と - なので、どの個体にも当たらない）。古い画面は s を捨てるので、親を空にすると
// 空き牧場として「空いた牧場に置くなら」を勧めてしまう。2 体の親がいる牧場として扱わせ、どの個体とも組にならないようにする
const OWNED_FARM_UNREADABLE_PARENTS = ['?1', '?2'];

/** 突然変異のタマゴのアイテム ID か（PalEgg_MutationPal_*。親と関係ない子が入る） */
function isMutationEggItem(itemId) {
  return /^PalEgg_MutationPal/i.test(String(itemId ?? ''));
}

/** 配合牧場の一覧を検証して整える（形の合わないものは捨てる。知らない鍵は落とす）。 */
function cleanOwnedFarms(value) {
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
    if (farm.s === 'u') {
      clean.s = 'u';
      clean.parents = [...OWNED_FARM_UNREADABLE_PARENTS];
    }
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
function fitOwnedFarms(farms) {
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

function ownedWorldId(value) {
  const id = String(value ?? '').trim().toUpperCase();
  return /^[0-9A-F]{32}$/.test(id) ? id : '';
}

// ---------------------------------------------------------------------------
// プレイヤーの同一性（server の identity。docs/server/README.md の「テーマ間の取り決め」）
// ---------------------------------------------------------------------------

// 協力プレイのホストの PlayerUId（H。docs/SAVE_FORMAT.md）。人ではなく「その時のホスト」の枠で、ホストの交代（SaveSync）とサーバーへの
// 変換（ServerSync）で中の人が替わる。サーバーのワールドではプレイヤーにいない（個体の預けた人にだけ残る）
const HOST_UID = '00000000-0000-0000-0000-000000000001';
// GUID（8-4-4-4-12 桁の 16 進）。0 だけの GUID は「なし」
const PLAYER_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLAYER_ZERO_GUID = '00000000-0000-0000-0000-000000000000';
// 鍵 'u:' の中の UID（小文字にした後の英数字とハイフン 1〜40 字。共有の uid の上限と同じ）
const PLAYER_KEY_UID = /^[0-9a-z-]{1,40}$/;

/** GUID の形（0 だけの GUID を除く）なら小文字にして返す。違えば ''（キャラクターの InstanceId の検査） */
function playerGuid(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PLAYER_GUID.test(text) && text !== PLAYER_ZERO_GUID ? text : '';
}

/**
 * プレイヤーの鍵を検査して小文字にそろえる: 'i:<キャラクターの InstanceId〔GUID〕>' か 'u:<PlayerUId>'。違えば ''。
 * プレフィックスのない UID（前の版の値）も ''（読み替えは legacyPlayerKey）
 */
function playerMapKey(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (text.startsWith('i:')) return playerGuid(text.slice(2)) ? text : '';
  if (text.startsWith('u:')) return PLAYER_KEY_UID.test(text.slice(2)) ? text : '';
  return '';
}

/**
 * プレイヤー（{ uid, instanceId? }）の鍵。キャラクターの InstanceId があれば 'i:<InstanceId>'（協力プレイとサーバーを往復して PlayerUId が
 * H ⇔ U と入れ替わっても変わらない）、なければ 'u:<uid>'（InstanceId のない古いデータ・ワールドにいない UID）。どちらもなければ ''
 */
function playerKeyOf(player) {
  if (!player || typeof player !== 'object') return '';
  const instanceId = playerGuid(player.instanceId);
  if (instanceId) return `i:${instanceId}`;
  return typeof player.uid === 'string' ? playerMapKey(`u:${player.uid}`) : '';
}

/** 前の版の値（プレフィックスのない UID）も受けて鍵にする（'u:<uid>' に読み替える）。鍵ならそのまま（小文字）、どちらでもなければ '' */
function legacyPlayerKey(value) {
  const key = playerMapKey(value);
  if (key) return key;
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PLAYER_KEY_UID.test(text) ? `u:${text}` : '';
}

/**
 * 鍵（前の版の UID も受ける）を、その回のプレイヤー（{ uid, instanceId? } の配列）の uid に引く。'i:' はその InstanceId のプレイヤー、
 * 'u:' は同じ uid（大文字小文字は問わない）のプレイヤー。いなければ ''
 */
function playerUidOfKey(players, value) {
  const key = legacyPlayerKey(value);
  if (!key || !Array.isArray(players)) return '';
  const id = key.slice(2);
  const byInstance = key.startsWith('i:');
  for (const player of players) {
    if (!player || typeof player !== 'object' || typeof player.uid !== 'string' || !player.uid) continue;
    if (byInstance ? playerGuid(player.instanceId) === id : player.uid.toLowerCase() === id) return player.uid;
  }
  return '';
}

/** プレイヤー（配列か、uid → プレイヤーの Map）に H がいるか（協力プレイのワールド。サーバーのワールドにはいない） */
function hostIsPlayer(players) {
  if (players instanceof Map) return players.has(HOST_UID);
  return Array.isArray(players) && players.some((player) => Boolean(player) && player.uid === HOST_UID);
}

/** プレイヤー・ギルドの UID の頭 8 字（- を除いた大文字。名前の分からない・同じ名前のプレイヤーを見分けるとき） */
const shortUid = (uid) => String(uid ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * プレイヤーにいない UID（以前の持ち主。拠点の個体の預けた人・牧場の親を預けた人）の表示名。H は「以前のホスト」、ほかは
 * 「不明なプレイヤー（頭 8 字）」。共有の lastOwner の列にもこの文字が載るので、参加者の画面はこの文字で比べる（core/ideal-goals.js）
 */
function formerLabel(uid) {
  return uid === HOST_UID ? '以前のホスト' : `不明なプレイヤー（${shortUid(uid)}）`;
}

/**
 * 共有のプレイヤー 1 人（uid・name と、save-extras で足した level〔1〜999 の整数〕・online〔true・false〕、dps-missing で足した
 * dpsGap〔1〜OWNED_DPS_GAP_MAX の整数。ホストの画面で、Level.sav のパル次元ストレージの個体のうち読めていない数。そのプレイヤーの
 * _dps.sav が登録されていないかもしれない人〔候補〕だけに付く〕、server の identity で足した instanceId〔キャラクターの InstanceId。
 * GUID の形のときだけ小文字で〕）。uid がなければ null。
 * level・online・dpsGap・instanceId は分からなければ鍵ごと付けない（古い画面・古い GAS は uid・name だけを残す）
 */
function cleanOwnedPlayer(player) {
  if (!player || typeof player !== 'object') return null;
  const clean = { uid: ownedText(player.uid, 40), name: ownedText(player.name, 50) };
  if (!clean.uid) return null;
  if (Number.isInteger(player.level) && player.level > 0 && player.level <= OWNED_PLAYER_LEVEL_MAX) clean.level = player.level;
  if (typeof player.online === 'boolean') clean.online = player.online;
  if (Number.isInteger(player.dpsGap) && player.dpsGap > 0 && player.dpsGap <= OWNED_DPS_GAP_MAX) clean.dpsGap = player.dpsGap;
  const instanceId = playerGuid(player.instanceId);
  if (instanceId) clean.instanceId = instanceId;
  return clean;
}

/** ゲーム内の日数（1〜1000000 の整数）。違えば null（列に書かない・分からない） */
function ownedInGameDay(value) {
  const day = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(day) && day > 0 && day <= OWNED_DAY_MAX ? day : null;
}

// ---------------------------------------------------------------------------
// セーブの識別と新旧（sync-fixes の owned-gas）
// ---------------------------------------------------------------------------

// 共有の書き込みの結果の種類（GAS の ownedUpload の応答の result）。stored（書いたか）も今どおり返す
const OWNED_RESULTS = ['new', 'newer', 'stale', 'unchanged', 'resent', 'same'];
// 共有の形の版の番号（画面が送る world.format。sync-fixes の share-upload）。同じセーブの送り直しで版が上がれば、decideOwnedUpload は
// 前の中身を書き直す（resent）。今の形は 4（後から足した列〔OWNED_ADDED_FIELDS〕のない 26 列の形を 1 とし、列を足すごとに上げた数）。
// 古い GAS に合わせて末尾の列を外して送るときは、外した列の数だけ下げて送る（劣った中身として扱わせ、全部の列で送り直したときに
// 書き直されるように。web/js/owned.js の uploadLocal）ので、OWNED_ADDED_FIELDS の数より大きく保つ。上げ方: 列を足したら 1 つ上げる
//（足した列を外した形が前の形と同じ版になる）。列を足さずに形を変えたら（players の JSON の鍵を足すなど）OWNED_ADDED_FIELDS の数＋1
// 上げる（列を外して送る新しい形が、前の版の全部の列の形より下にならないように）
const OWNED_FORMAT = 4;
// 識別の数の上限（共有の形の版・読めたファイルの数・読めなかったファイルの数）
const OWNED_FORMAT_MAX = 1000;
const OWNED_FILE_COUNT_MAX = 10000;

/**
 * Level.sav の中の保存時刻（生のティック。10 進の文字列か、2^53 未満の整数）。1〜20 桁の数字で 0 でなければ、先頭の 0 を除いた文字列。
 * 違えば ''（分からない）。ティックはホストの PC のローカル時刻なので、仲間が全員同じタイムゾーンで遊ぶ前提で新旧を比べる
 */
function ownedSaveStamp(value) {
  const raw = typeof value === 'number' ? (Number.isSafeInteger(value) && value > 0 ? String(value) : '')
    : typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,20}$/.test(raw)) return '';
  return raw.replace(/^0+/, '');
}

const timeValue = (value) => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
};

/**
 * 2 つのセーブの新旧。a が新しければ 1、古ければ -1、同じなら 0。a・b は { stamp, updatedAt }。
 * 両方に stamp（生のティック）があれば、桁をそろえて比べる（同期でファイルの更新日時が変わっても、同じセーブは同じと分かる）。
 * どちらかになければ updatedAt（ISO。セーブのファイルの更新日時）で比べる（識別のない古い共有・古い画面のデータ）
 */
function compareSaves(a, b) {
  const left = ownedSaveStamp(a?.stamp);
  const right = ownedSaveStamp(b?.stamp);
  if (left && right) {
    if (left.length !== right.length) return left.length > right.length ? 1 : -1;
    return left === right ? 0 : left > right ? 1 : -1;
  }
  const x = timeValue(a?.updatedAt);
  const y = timeValue(b?.updatedAt);
  return x === y ? 0 : x > y ? 1 : -1;
}

const countIn = (value, max) => (Number.isInteger(value) && value >= 0 && value <= max ? value : null);

// 識別の 5 つ（stamp・hash・format・fileCount・missingCount）が全部そろっていれば識別、1 つでも欠ける・形が違えば null（識別なし）
function saveIdentity(stamp, hash, format, fileCount, missingCount) {
  const clean = {
    stamp: ownedSaveStamp(stamp),
    hash: typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : '',
    format: Number.isInteger(format) && format >= 1 && format <= OWNED_FORMAT_MAX ? format : null,
    fileCount: countIn(fileCount, OWNED_FILE_COUNT_MAX),
    missingCount: countIn(missingCount, OWNED_FILE_COUNT_MAX),
  };
  return clean.stamp && clean.hash && clean.format !== null && clean.fileCount !== null && clean.missingCount !== null ? clean : null;
}

/** 共有の world の中の識別（saveStamp・contentHash・format・fileCount・missingCount）。そろっていなければ null */
function ownedUploadIdentity(world) {
  if (!world || typeof world !== 'object') return null;
  return saveIdentity(world.saveStamp, world.contentHash, world.format, world.fileCount, world.missingCount);
}

const identityText = (identity) => `${identity.stamp}|${identity.hash}|${identity.format}|${identity.fileCount}|${identity.missingCount}`;

/** OwnedWorlds の列 saveKey の値（uploadedAt|stamp|hash|format|fileCount|missingCount）。識別がなければ '' */
function ownedSaveKey(uploadedAt, identity) {
  return identity ? `${uploadedAt}|${identityText(identity)}` : '';
}

/**
 * saveKey を読む。先頭の uploadedAt がその行の uploadedAt と違えば（識別を知らない古い版の GAS が後からその行を書いた）、識別なし（null）
 */
function parseOwnedSaveKey(text, uploadedAt) {
  const parts = String(text ?? '').split('|');
  if (parts.length !== 6 || !uploadedAt || parts[0] !== uploadedAt) return null;
  const int = (value) => (/^\d{1,6}$/.test(value) ? Number(value) : null);
  return saveIdentity(parts[1], parts[2], int(parts[3]), int(parts[4]), int(parts[5]));
}

/**
 * 共有の書き込みの結果の種類（docs/sync-fixes/README.md の 3 の表）。
 * current: 今公開されているワールド { saveUpdatedAt, uploadedBy, identity }（なければ null）。incoming: 届いた共有 { saveUpdatedAt, uploadedBy, identity, force }。
 * identity は ownedUploadIdentity・parseOwnedSaveKey の値（なければ null）。
 * @returns {{ result: string, write: boolean }}
 */
function decideOwnedUpload(current, incoming) {
  if (!current) return { result: 'new', write: true };
  const now = current.identity;
  const next = incoming.identity;
  if (now && next) {
    const order = compareSaves({ stamp: next.stamp }, { stamp: now.stamp });
    if (order > 0) return { result: 'newer', write: true };
    if (order < 0) return { result: 'stale', write: false };
    if (identityText(now) === identityText(next)) return { result: 'unchanged', write: false };
    // 同じセーブ: 同じ人の送り直しで中身がよくなった（飛ばしたファイルが戻った・形の版が上がった）か、登録の確定（別の人でもよい）なら書く
    const notWorse = next.format >= now.format && next.fileCount >= now.fileCount && next.missingCount <= now.missingCount;
    const better = next.format > now.format || next.fileCount > now.fileCount || next.missingCount < now.missingCount;
    const samePerson = Boolean(incoming.uploadedBy) && incoming.uploadedBy === current.uploadedBy;
    if (notWorse && ((samePerson && better) || incoming.force === true)) return { result: 'resent', write: true };
    return { result: 'same', write: false };
  }
  // どちらかに識別がない（古い画面・列を足す前・古い版の GAS が書いた行）: 今の更新日時の比較
  const order = compareSaves({ updatedAt: incoming.saveUpdatedAt }, { updatedAt: current.saveUpdatedAt });
  if (order < 0) return { result: 'stale', write: false };
  // 今の行に識別があり、届いた方にない（古い画面）同じ時刻は書かない。同期を受け取った PC の古いタブ（プレイヤーの入れ替え後・登録が少ない）が、
  // 同じセーブの完全な共有を劣った中身で上書きしうるため。今の行に識別がなければ、今どおり同じ時刻なら上書き
  if (order === 0 && now && !next) return { result: 'same', write: false };
  return { result: 'newer', write: true };
}

// ---------------------------------------------------------------------------
// 共有のワールドの追加の情報（OwnedWorlds の列 extras。server。docs/server/README.md の「テーマ間の取り決め」）
// ---------------------------------------------------------------------------

// 列 extras は 1 つの JSON（{ at: uploadedAt, saveKind, clock, formers, formersPartial?, items }）。画面は同じ鍵で world の中に入れて送り
//（GAS の最上位の項目は増やさない。古い GAS は捨てるだけ）、GAS は読んだ値を world に広げて返す。
// - saveKind: セーブの種類。'server'（専用サーバー）・'coop'（協力プレイ）、分からなければ ''
// - clock: ワールドが動いた通算の時間（Level.sav の RealDateTimeTicks。10 進の文字列）。分からなければ ''
// - formers: ワールドにいない UID（以前の持ち主）ごとの { uid, pals: 拠点・観賞用ケージの個体の数, farms: 親を預けた牧場の数 }（数は 0〜
//   OWNED_MAX_ROWS の整数）。分からなければ null。formersPartial: true は、セルに入らない・数の上限を超えたので一部だけ
// - items: アイテムの在庫 [{ id, t: 合計, p?: [{ l: 場所の呼び名, n: 数 }]（多い順に 3 か所まで） }]。[] は持っていない、null は分からない
// セルは全体（at を含む JSON）で OWNED_EXTRAS_MAX_CHARS 字以下にする（fitOwnedExtras。Sheets の 1 セルは 5 万字まで）
const OWNED_EXTRAS_MAX_CHARS = 45000;
const OWNED_FORMERS_MAX = 1000;
const OWNED_ITEMS_MAX = 200;
const OWNED_ITEM_PLACES_MAX = 3;
const OWNED_ITEM_COUNT_MAX = 1000000;
// 在庫に数えるアイテム（web/js/core/owned.js の STOCK_ITEM と同じ）
const OWNED_ITEM_ID = /^(?:PalPassiveSkillChange_[A-Za-z0-9_]{1,100}|PalGenderReverse)$/i;
// 以前の持ち主の UID（共有のプレイヤーの uid と同じ 40 字まで。大文字小文字は変えない〔共有の lastOwner の文字と同じ UID で作るため〕）
const OWNED_FORMER_UID = /^[0-9A-Za-z-]{1,40}$/;
// 字数を測るときの at（GAS が書く uploadedAt と同じ ISO の 24 字）
const OWNED_EXTRAS_AT_SAMPLE = '2000-01-01T00:00:00.000Z';

/** セーブの種類（'server'・'coop'）。違えば ''（分からない） */
const ownedSaveKind = (value) => (value === 'server' || value === 'coop' ? value : '');

const itemCount = (value) => (Number.isInteger(value) && value > 0 && value <= OWNED_ITEM_COUNT_MAX ? value : 0);

/**
 * アイテムの在庫（items）を検査して整える。配列でなければ null（分からない）。ID の形が違う・合計が 1〜1,000,000 の整数でない項目と、
 * 大文字小文字をそろえて同じ ID の後の項目は捨て、OWNED_ITEMS_MAX 種まで。場所の内訳（p）は配列のときだけ、形の合う 3 か所まで
 */
function cleanOwnedItems(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const items = [];
  for (const item of value) {
    if (items.length >= OWNED_ITEMS_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' && OWNED_ITEM_ID.test(item.id) ? item.id : '';
    const total = itemCount(item.t);
    if (!id || !total || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    const clean = { id, t: total };
    if (Array.isArray(item.p)) {
      clean.p = [];
      for (const place of item.p) {
        if (clean.p.length >= OWNED_ITEM_PLACES_MAX) break;
        const label = place && typeof place === 'object' ? ownedText(place.l, 60) : '';
        const count = place && typeof place === 'object' ? itemCount(place.n) : 0;
        if (label && count) clean.p.push({ l: label, n: count });
      }
    }
    items.push(clean);
  }
  return items;
}

// 以前の持ち主の一覧を検査して整える（形の合わない項目と、同じ uid の後の項目は捨てる）。数で切るかは呼ぶ側が元の長さで決める
function cleanOwnedFormers(value) {
  const seen = new Set();
  const formers = [];
  for (const former of value.slice(0, OWNED_FORMERS_MAX)) {
    if (!former || typeof former !== 'object') continue;
    const uid = typeof former.uid === 'string' && OWNED_FORMER_UID.test(former.uid) ? former.uid : '';
    const pals = countIn(former.pals, OWNED_MAX_ROWS);
    const farms = countIn(former.farms, OWNED_MAX_ROWS);
    if (!uid || pals === null || farms === null || seen.has(uid)) continue;
    seen.add(uid);
    formers.push({ uid, pals, farms });
  }
  return formers;
}

// 追加の情報の決まった形（鍵の順も決める。GAS の応答と読み直したときの world を同じ JSON にするため）
const extrasOf = (saveKind, clock, formers, formersPartial, items) => ({
  saveKind, clock, formers, ...(formers && formersPartial ? { formersPartial: true } : {}), items,
});

/**
 * 追加の情報（画面が送る world・GAS のセルの JSON）を検査して整える。知らない鍵は落とす。分かることが 1 つもなければ null
 *（古い画面・古い GAS の共有）。分かることがあれば { saveKind, clock, formers, formersPartial?, items }（分からない項目は '' か null）
 */
function cleanOwnedExtras(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const saveKind = ownedSaveKind(value.saveKind);
  const clock = ownedSaveStamp(value.clock);
  const formers = Array.isArray(value.formers) ? cleanOwnedFormers(value.formers) : null;
  const items = cleanOwnedItems(value.items);
  if (!saveKind && !clock && !formers && !items) return null;
  const partial = Boolean(formers) && (value.formersPartial === true || value.formers.length > OWNED_FORMERS_MAX);
  return extrasOf(saveKind, clock, formers, partial, items);
}

/** OwnedWorlds の列 extras の値（{ at: uploadedAt, ...extras } の JSON）。extras がなければ ''（分からない） */
function ownedExtrasText(uploadedAt, extras) {
  return extras ? JSON.stringify({ at: uploadedAt, ...extras }) : '';
}

/**
 * 列 extras を読む。JSON でない・at がその行の uploadedAt と違う（巻き戻した古い GAS は知らない列を書き換えずに残すので、その間に共有された行の
 * 前の値）なら null（使わない）
 */
function parseOwnedExtras(text, uploadedAt) {
  if (!uploadedAt) return null;
  let value;
  try { value = JSON.parse(String(text ?? '')); } catch { return null; }
  return value && typeof value === 'object' && value.at === uploadedAt ? cleanOwnedExtras(value) : null;
}

/**
 * 追加の情報（cleanOwnedExtras の形）を、列 extras のセル（at を含む JSON）が OWNED_EXTRAS_MAX_CHARS 字以下になるよう縮める（入らないときだけ）。
 * (1) そのまま入れば、そのまま (2) 入らなければ、全部の在庫の場所の内訳（p）を外して合計だけにする
 * (3) まだ入らなければ、以前の持ち主を数（拠点の個体と牧場の和）の多い順に入る分だけ残し（並びは元のまま）、formersPartial を付ける。
 * 在庫は 200 種で、内訳を外せば 1 種 150 字ほど（3 万字ほど）なので、(3) で必ず入る
 */
function fitOwnedExtras(extras) {
  if (!extras) return null;
  const size = (value) => ownedExtrasText(OWNED_EXTRAS_AT_SAMPLE, value).length;
  if (size(extras) <= OWNED_EXTRAS_MAX_CHARS) return extras;
  const items = Array.isArray(extras.items) ? extras.items.map(({ p: _places, ...item }) => item) : extras.items;
  const bare = extrasOf(extras.saveKind, extras.clock, extras.formers, extras.formersPartial, items);
  if (size(bare) <= OWNED_EXTRAS_MAX_CHARS || !bare.formers) return bare;
  const ranked = bare.formers.map((former, index) => ({ former, index }))
    .sort((a, b) => (b.former.pals + b.former.farms) - (a.former.pals + a.former.farms) || a.index - b.index);
  const kept = new Set();
  let length = size(extrasOf(bare.saveKind, bare.clock, [], true, items));
  for (const { former, index } of ranked) {
    const add = JSON.stringify(former).length + (kept.size ? 1 : 0);
    if (length + add > OWNED_EXTRAS_MAX_CHARS) break;
    kept.add(index);
    length += add;
  }
  return extrasOf(bare.saveKind, bare.clock, bare.formers.filter((_, index) => kept.has(index)), true, items);
}

// ---------------------------------------------------------------------------
// ページを開いている PC（presence。sync-fixes の owned-gas・page-presence）
// ---------------------------------------------------------------------------

const OWNED_PRESENCE_ROLES = ['host', 'guest', 'none'];
// 1 ワールドで覚えるページの数と、覚える長さ（秒。サーバーのキャッシュの上限と同じ 6 時間）
const OWNED_PRESENCE_MAX = 50;
const OWNED_PRESENCE_TTL_S = 21600;
// ページと PC の ID（画面が作るランダムな値。認証にも本人の証明にも使わない）
const PRESENCE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** 画面が送る presence（{ pageId, device, user, role, playing, canShare }）を検査して整える。形が違えば null */
function cleanPresenceInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.pageId !== 'string' || !PRESENCE_ID.test(value.pageId)) return null;
  if (typeof value.device !== 'string' || !PRESENCE_ID.test(value.device)) return null;
  if (!OWNED_PRESENCE_ROLES.includes(value.role) || typeof value.playing !== 'boolean' || typeof value.canShare !== 'boolean') return null;
  if (value.user !== undefined && typeof value.user !== 'string') return null;
  return {
    pageId: value.pageId, device: value.device, user: ownedText(value.user, 20),
    role: value.role, playing: value.playing, canShare: value.canShare,
  };
}

/**
 * 所持パルのアップロードを検証して整える。
 * @returns {{ ok: true, value: object } | { ok: false, errors: { field: string, code: string }[] }}
 */
function validateOwnedUpload(input) {
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
      // ゲーム内の日数（save-extras）。GAS の OWNED_UPLOAD_FIELDS_ の最上位の項目を増やさないよう world の中で受ける（古い GAS は捨てるだけ）
      inGameDay: ownedInGameDay(world.inGameDay),
      saveUpdatedAt: new Date(saveTime).toISOString(),
      players: players.map(cleanOwnedPlayer).filter(Boolean),
      bases: bases.map((base) => ({ id: ownedText(base && base.id, 40), label: ownedText(base && base.label, 60) })).filter((base) => base.id),
      // 牧場を送らない古い画面からの共有では null（牧場の情報がない）。セルに入るよう縮める（GAS・開発用 API・画面で同じ上限）
      farms: source.farms === undefined || source.farms === null ? null : fitOwnedFarms(cleanOwnedFarms(source.farms)),
      // セーブの識別（owned-gas）。最上位の項目を増やさないよう world の中で受ける（古い GAS は捨てるだけ）。形が違えば識別なし（null）で、
      // 断らずに今の更新日時で比べる。force は登録の確定のときだけ true
      identity: ownedUploadIdentity(world),
      force: world.force === true,
      // 追加の情報（server。列 extras）も world の中で受ける。セルに入るよう縮める（GAS は行を書き始める前に、ここで確かめた値を書く）。
      // 分かることがなければ null
      extras: fitOwnedExtras(cleanOwnedExtras(world)),
      rows: cleanRows,
    },
  };
}
