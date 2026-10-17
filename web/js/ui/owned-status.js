// 所持パルの状態（連携・共有・更新時刻）の文言と、所持パルのタブの案内の帯。所持パルのタブ・設定・ヘッダーのセーブ連携の状態
// （ui/save-status.js）で使う。どのワールドの・いつのデータか・読み込み中かは、ヘッダーのセーブ連携の状態だけに出す（2026-10-14 の
// ユーザーのフィードバック〔D29〕で、所持パル・理想個体・継承ルートの画面に出していたデータ元の 1 行〔ownedSourceLine〕はなくした）
import { el, button, formatShortTime } from './dom.js';
import { toast } from './toast.js';
import { isObject, int } from '../core/boundary.js';
import { userIdKey } from '../core/user.js';
import { dpsMissing } from '../core/owned.js';

// 許可切れの案内（autoreg-visibility。ヘッダーのセーブ連携・所持パルの案内・設定の状態の 3 か所で permissionNotice の同じ文を出す）。
// Chrome は「今回のみ」で許可したファイルの読む許可を、タブがしばらく裏にあると外すことがある（何分で外れるかは実機で確かめていない）
export const PERMISSION_TEXT = 'セーブを読む許可が必要です';
export const PERMISSION_HINT = 'Chrome の確認で「毎回のアクセスを許可」を選ぶと、ゲーム中（タブが裏）も止まりません';
export const PERMISSION_DENIED = '許可されませんでした。Chrome のサイトの設定で許可を戻すか、ファイルを登録し直してください';

/**
 * 許可切れの案内。自動の読み込みが許可待ちで止まっていなければ null。
 * since は止まった時刻（owned.js の state.auto.stoppedAt）があるときだけ「14:32 から読めていません。…」（日が違えば日付も）
 * @returns {null | { text: string, hint: string, since: string }}
 */
export function permissionNotice(state, { now = Date.now } = {}) {
  const auto = state?.auto ?? {};
  if (!auto.enabled || auto.status !== 'permission') return null;
  const since = auto.stoppedAt
    ? `${formatShortTime(auto.stoppedAt, now(), '')} から読めていません。この間に拾ったタマゴは自動登録されていない場合があります` : '';
  return { text: PERMISSION_TEXT, hint: PERMISSION_HINT, since };
}

// ---- 役割ごとの案内（roles。X-05・X-06・X-07） ----
// ホストの 1 行（設定のホストのワールドの行の自動登録のチェックの下・ヘッダーのセーブ連携）。ゲームの保存はセーブのファイルの見張り
//（save/watch.js。sync-fixes の save-watch）が知らせ、見張れないブラウザでも定期の確認で読む
export const HOST_SUMMARY = 'このページを開いている間（タブが裏でもよい）、ゲームが保存するたびにセーブを読みます。閉じている間に孵化したタマゴは登録できません。';
// 共有が古いとみなす経過（ホストの画面が閉じている目安）
export const SHARED_STALE_MS = 10 * 60 * 1000;

/** 経過時間の短い言い方（「たった今」「3 分前」「2 時間前」「4 日前」） */
export function timeAgo(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor(Math.max(0, now - time) / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes} 分前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 時間前` : `${Math.floor(hours / 24)} 日前`;
}

/** 参加しているワールドの自動登録の説明（設定の参加のワールドの行と、参加者の 1 行。参加者に「自動登録は動きません」と言わない。X-06） */
export function guestAutoText(host = 'ホスト') {
  return `この PC では読み込みません。配合牧場の自動登録は ${host} の画面が行います（${host} が自動登録をオンにしていて、プレイヤーの対応であなたが選ばれているとき）。`;
}

/**
 * 役割ごとの 1 行。ホスト・参加者（role 'guest'）・未連携で共有を見ている人。共有を見ていない未連携の人は null
 *（「セーブ未登録」の案内は所持パルの案内に任せる）。参加者・共有を見ている人で、共有のプレイヤーにログイン中の ID と同じ名前の人が
 * いなければ hint に 1 行（X-07。一致したときは出さない）
 * @returns {null | { text: string, kind: 'info' | 'warning', hint: string }}
 */
export function roleSummary(state, { userId = '', now = Date.now } = {}) {
  if (!state) return null;
  if (state.role === 'host') return { text: HOST_SUMMARY, kind: 'info', hint: '' };
  const meta = state.meta ?? {};
  const shared = meta.source === 'shared';
  const host = meta.uploadedBy || meta.hostName || 'ホスト';
  const sharedAt = meta.sharedAt || meta.saveUpdatedAt || '';
  const ago = shared ? timeAgo(sharedAt, now()) : '';
  const stale = shared && Number.isFinite(Date.parse(sharedAt)) && now() - Date.parse(sharedAt) > SHARED_STALE_MS;
  const hint = shared ? nameMismatch(state.owned?.players ?? [], userId) : '';
  if (state.role === 'guest') {
    const base = guestAutoText(host);
    if (!shared) return { text: base, kind: 'info', hint: '' };
    return stale
      ? { text: `${base}最後の共有は ${ago}です。${host} の画面が閉じていると、配合牧場の自動登録も止まります。`, kind: 'warning', hint }
      : { text: `${base.replace(/。$/, '')} · 最後の共有 ${ago}`, kind: 'info', hint };
  }
  if (!shared) return null;
  return { text: `${host} が共有した所持パルを表示しています · 最後の共有 ${ago}`, kind: stale ? 'warning' : 'info', hint };
}

// 共有のプレイヤーにログイン中の ID と同じ名前（userIdKey で比べる）の人がいないときの 1 行
function nameMismatch(players, userId) {
  if (!userId || !players.length || players.some((player) => player.name && userIdKey(player.name) === userIdKey(userId))) return '';
  const names = [...new Set(players.map((player) => player.name).filter(Boolean))];
  const shown = names.length > 5 ? `${names.slice(0, 5).join('・')} ほか` : names.join('・');
  return `このワールドに「${userId}」という名前のプレイヤーがいません（${shown}）。あなたが親 2 体を預けた配合は、ホストに設定の「プレイヤーの対応」で ${userId} を選んでもらうまで登録されません（「このワールドでの自分」を選んでも、ホストの対応は変わりません）。`;
}

/**
 * 「読み込みを許可」のボタンの動き（3 か所で同じ）。クリックの中で、await を挟まずに呼ぶこと（owned.grantAndRefresh が許可を求める）。
 * 許可されなかった（一部でも。読み直しが許可待ちで止まる）ときは、直し方のトースト。ほかの失敗はそのエラーの文
 */
export function grantWithReport(owned) {
  return owned.grantAndRefresh().then(({ granted, total }) => {
    if (granted < total) toast(PERMISSION_DENIED, { kind: 'error' });
  }, (error) => toast(error?.code === 'permission' ? PERMISSION_DENIED : error.message, { kind: 'error' }));
}

// ---- プレイ中の仲間・ゲーム内の日数・Lv（save-extras。F006） ----
// プレイ中は「その保存の時点で接続していた」（ギルドの最終ログインとワールドの通算の時間が一致）。ゲームを閉じた後も最後の保存には
// 残るので、文には必ず保存（共有）の時刻を添え、所持者の選択肢の「（プレイ中）」は保存が新しいときだけ付ける。
// ゲームは約 30 秒ごとに保存し、ホストの画面は保存のたびに読む（見張れないブラウザでは定期の確認で、タブが裏だと 1 分ごとまで遅れる）ので、
// この PC のデータは 5 分、共有は 10 分（ホストの PC との時計のずれの分）
export const PRESENCE_FRESH_LOCAL_MS = 5 * 60 * 1000;
export const PRESENCE_FRESH_SHARED_MS = SHARED_STALE_MS;
// Lv の行に並べる人数（残りは「ほか n 人」）
const LEVELS_SHOWN = 8;

/**
 * 表示中のデータのプレイ中・日数・Lv。データがなければ null。
 * @returns {null | { day: number | null, known: boolean, online: object[], levels: object[], at: string, label: string, fresh: boolean }}
 *   known はプレイ中が分かるプレイヤーがいるか（古いデータ・古い共有では false）、at は添える時刻（プレイ中はその保存の時点の状態なので、
 *   共有でも共有した時刻ではなくホストのセーブの時刻。Codex のレビュー）、label は「セーブ」「ホストのセーブ」、fresh はその保存が新しい
 *  （いまもプレイ中とみなせる）か
 */
export function presenceOf(state, { now = Date.now } = {}) {
  const owned = state?.owned;
  const meta = state?.meta;
  if (!owned || !meta?.source) return null;
  const players = Array.isArray(owned.players) ? owned.players : [];
  const shared = meta.source === 'shared';
  const saved = Date.parse(meta.saveUpdatedAt);
  const fresh = Number.isFinite(saved) && now() - saved <= (shared ? PRESENCE_FRESH_SHARED_MS : PRESENCE_FRESH_LOCAL_MS);
  const day = Number.isInteger(owned.world?.inGameDay) && owned.world.inGameDay > 0 ? owned.world.inGameDay : null;
  return {
    day,
    known: players.some((player) => typeof player.online === 'boolean'),
    online: players.filter((player) => player.online === true),
    levels: players.filter((player) => Number.isInteger(player.level) && player.level > 0),
    at: meta.saveUpdatedAt || '',
    label: shared ? 'ホストのセーブ' : 'セーブ',
    fresh,
  };
}

/** いまプレイ中とみなす人の UID（保存が新しいときだけ。所持者の選択肢の「（プレイ中）」） */
export function onlineUids(state, { now = Date.now } = {}) {
  const info = presenceOf(state, { now });
  return info?.fresh ? new Set(info.online.map((player) => player.uid)) : new Set();
}

/** onlineUids の印（同じなら選択肢を作り直さない。データが同じでも、時間がたって保存が古くなると変わる） */
export const onlineKey = (state, options) => [...onlineUids(state, options)].sort().join(',');

/**
 * ヘッダーのセーブ連携のパネルの行 [見出し, 文]。ゲーム内の日数・プレイ中（「Alice・Bob（セーブ 03:07 の時点）」。参加者は「ホストのセーブ」。
 * 分からなければ出さない）・
 * Lv（「Alice 52 · Bob 47」。分かる人だけ）
 */
export function presenceItems(state, { now = Date.now } = {}) {
  const info = presenceOf(state, { now });
  if (!info) return [];
  const items = [];
  if (info.day) items.push(['ゲーム内', `${info.day} 日目`]);
  if (info.known) {
    const names = info.online.map((player) => player.name || '名前なし');
    items.push(['プレイ中', `${names.length ? names.join('・') : 'いません'}（${info.label} ${formatShortTime(info.at, now(), '時刻不明')} の時点）`]);
  }
  if (info.levels.length) {
    const shown = info.levels.slice(0, LEVELS_SHOWN).map((player) => `${player.name || '名前なし'} ${player.level}`);
    const rest = info.levels.length - shown.length;
    items.push(['Lv', `${shown.join(' · ')}${rest > 0 ? ` · ほか ${rest} 人` : ''}`]);
  }
  return items;
}

export function dateTime(value) {
  const time = new Date(value);
  return value && Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time) : '不明';
}

export function worldName(meta) {
  if (!meta) return '';
  const name = meta.worldName || meta.name ? `「${meta.worldName || meta.name}」` : `ワールド ${String(meta.worldId ?? meta.id ?? '').slice(0, 8)}`;
  return `${name}${meta.hostName ? `（ホスト ${meta.hostName}）` : ''}`;
}

export function roleLabel(state) {
  return state.role === 'host' ? 'ホスト（この PC にワールドのセーブがあります）'
    : state.role === 'guest' ? '参加者（ホストが共有した所持パルを表示します）' : '';
}

/**
 * 共有の送信の結果の案内（所持パルの案内・ヘッダーのセーブ連携のパネルで同じ文。sync-fixes の share-upload）。
 * 今読んでいるセーブ（state.local の印）を送った結果のときだけ出す。same は同じセーブを別の人（か同じ ID の別のタブ・PC）が共有済み、
 * stale は共有されているセーブの方が新しい。送っている間・自分の共有が載った（done）ときは出さない。送れなかった（error）ときは
 * 呼ぶ側が別に出す（ヘッダーは警告の色にする）
 * @returns {null | { text: string, kind: 'info' }}
 */
export function uploadNotice(state) {
  const upload = state?.upload ?? {};
  if (!['same', 'stale'].includes(upload.status)) return null;
  // 前のセーブを送った結果（その後に新しいセーブを読んだ）は出さない
  if ((upload.signature ?? '') !== (state.local?.world?.signature ?? '')) return null;
  if (upload.status === 'stale') return { text: '共有されているセーブの方が新しいため、そちらを表示しています', kind: 'info' };
  const who = upload.published?.uploadedBy;
  return { text: `同じセーブが共有済み${who ? `（${who} の PC から）` : ''}`, kind: 'info' };
}

// ---- セーブのファイルの見張り（sync-fixes の save-watch。owned.js の state.watch） ----
export const WATCH_MODE_TEXT = Object.freeze({
  observer: 'ファイルの変更', poll: '5 秒ごとの確認', timer: '定期の確認（タブが裏だと 1 分ごと）',
});

// 時:分:秒（今日でなければ月/日も）
function clockTime(value, now) {
  const time = new Date(value);
  const today = new Date(now);
  const sameDay = time.getFullYear() === today.getFullYear() && time.getMonth() === today.getMonth() && time.getDate() === today.getDate();
  return new Intl.DateTimeFormat('ja-JP', {
    ...(sameDay ? {} : { month: 'numeric', day: 'numeric' }), hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(time);
}

/**
 * ヘッダーのセーブ連携のパネルの「監視」の行（「ファイルの変更 · 最後の保存 12:03:30（7 ファイル・0.8 秒）」）。自動の読み込みが有効で
 * 登録があり、見張りの方式が分かるときだけ（なければ ''）。最後の保存は、今のワールドで見張りが知らせた一式の書き終わりの時刻・変わった
 * ファイルの数・書き始めから書き終わりまで
 */
export function watchSummary(state, { now = Date.now } = {}) {
  if (!state?.auto?.enabled || !state.auto.worlds?.length) return '';
  const mode = WATCH_MODE_TEXT[state.watch?.mode];
  if (!mode) return '';
  const last = state.watch.lastSave;
  if (!last || !Number.isFinite(Date.parse(last.at))) return mode;
  const span = Number.isFinite(last.spanMs) ? `・${(Math.max(0, last.spanMs) / 1000).toFixed(1)} 秒` : '';
  return `${mode} · 最後の保存 ${clockTime(last.at, now())}（${last.files} ファイル${span}）`;
}

/** 所持パルの更新時刻（セーブ・共有）。 */
export function timeLines(state) {
  const meta = state.meta;
  if (!meta?.source) return [];
  const lines = [`セーブの更新: ${dateTime(meta.saveUpdatedAt)}`];
  if (meta.sharedAt) lines.push(`共有: ${dateTime(meta.sharedAt)}${meta.uploadedBy ? `（${meta.uploadedBy}）` : ''}`);
  if (meta.source === 'local' && meta.importedAt) lines.push(`この PC で読み込み: ${dateTime(meta.importedAt)}`);
  return lines;
}

// セーブのファイル（ワールド）が登録されていないときの案内。ボタン「ワールドを登録」でこの画面から登録のモーダルを開く
const UNREGISTERED_TEXT = 'セーブのファイルが登録されていません。';

// ---- パル次元ストレージの読み漏れ（dps-missing） ----
// Level.sav には全員の次元ストレージの個体の一覧があるが、中身は各プレイヤーの Players\<UID>_dps.sav にある。登録の後に次元ストレージを
// 使い始めた人の _dps.sav は登録されておらず、その人の個体が出ない。欠けの数は分かっても、だれの分かは分からない（一覧のキーは 0）ので、
// 候補（Players\<UID>.sav は読めたのに _dps.sav を読めていない人）を「かもしれない」として挙げる（人数で割らない・1 人に決めない）

/**
 * ホストの画面（この PC で読んだセーブ）の案内。読めていない個体がなければ・数のない古い解析結果なら null。
 * 候補がいればファイル名と名前を挙げ、ワールドの編集（editWorld）へ。候補がいなければ、ファイルが足りないか保存の途中に読んだかもしれない
 * @returns {null | { text: string, kind: 'warning', action?: 'editWorld' }}
 */
export function dimensionGap(snapshot) {
  const gap = dpsMissing(snapshot);
  if (!gap?.missing) return null;
  const head = `Level.sav ではパル次元ストレージに ${gap.expected} 体いますが、${gap.missing} 体を読めていません`;
  if (!gap.candidates.length) return { text: `${head}（ファイルが足りないか、保存の途中に読んだ可能性があります）。`, kind: 'warning' };
  const files = gap.candidates.map((player) => `Players\\${player.file}（${player.name || '名前なし'}）`);
  return { text: `${head}。${files.join('、')}が登録されていないかもしれません。`, kind: 'warning', action: 'editWorld' };
}

/**
 * パル次元ストレージの読み漏れの案内（所持パルの案内・ヘッダーのセーブ連携・理想個体の結果の上で同じ文）。
 * この PC で読んだセーブを出しているときはホストの案内（dimensionGap）。共有を出しているときは、自分のプレイヤー（selfUids。
 * 「このワールドでの自分」などで決めたもの。ideals.selfUids）がホストの画面の候補（dpsGap のあるプレイヤー）のときだけ、
 * 自分の _dps.sav をホストに足してもらう案内。ほかの人が候補のときは出さない
 * @param {{ selfUids?: Set<string> }} [options]
 * @returns {null | { text: string, kind: 'warning', action?: 'editWorld' }}
 */
export function dimensionNotice(state, { selfUids = new Set() } = {}) {
  const source = state?.meta?.source;
  if (source === 'local') return dimensionGap(state.data?.snapshot);
  if (source !== 'shared') return null;
  const mine = (state.owned?.players ?? []).filter((player) => selfUids.has(player.uid) && Number.isInteger(player.dpsGap) && player.dpsGap > 0);
  if (!mine.length) return null;
  const count = Math.max(...mine.map((player) => player.dpsGap));
  const files = mine.map((player) => `Players\\${player.uid.replace(/-/g, '').toUpperCase()}_dps.sav`);
  return {
    text: `パル次元ストレージの ${count} 体が出ていません。ホストの登録にあなたの ${files.join('・')} がないかもしれません。ホストに足してもらってください。`,
    kind: 'warning',
  };
}

/**
 * 所持パルのタブの上に出す案内。対応が要るものだけ（読み込み中・確認中・共有中は出さない。ヘッダーのセーブ連携の状態が知らせる）。
 * 案内は 1 文と行き先のボタン（「設定タブの〜」とだけ書かない。copy-dead-ends）。action はボタンの名前（views/owned.js の noticeActions。
 * grant＝読む許可・register＝ワールドの登録のモーダル・settings＝設定のセーブ連携〔読んでいるワールドの行〕へ・editWorld＝読んでいるワールドの
 * 編集のモーダル・unknownPlace＝場所の分からないパル）。selfUids は自分のプレイヤー（参加者のパル次元ストレージの読み漏れの案内。dimensionNotice）
 */
export function ownedNotices(state, { userId = '', now = Date.now, selfUids = new Set() } = {}) {
  const notices = [];
  if (!state.ready) return notices;
  const auto = state.auto ?? {};
  const hasData = Boolean(state.meta?.source);
  if (!auto.enabled) {
    // 共有された所持パルなどを表示できているときは出さない
    if (!hasData) notices.push({ text: UNREGISTERED_TEXT, kind: 'info', action: 'register' });
  } else if (auto.status === 'permission') {
    // 許可切れは 1 文と止まった時刻、勧め（「毎回のアクセスを許可」）は小さな 2 行目
    const notice = permissionNotice(state);
    notices.push({ text: `${notice.text}。${notice.since ? `${notice.since}。` : ''}`, hint: `${notice.hint}。`, kind: 'warning', action: 'grant' });
  } else if (auto.status === 'empty') {
    notices.push({ text: UNREGISTERED_TEXT, kind: 'warning', action: 'register' });
  } else if (auto.status === 'error') {
    notices.push({ text: auto.error || 'セーブを読めませんでした', kind: 'warning', action: 'settings' });
  }
  // 参加者: データがなければ共有を待つ 1 行、あれば役割の 1 行（自動登録はホストの画面が行うこと・最後の共有。roles）と、名前が合わないときの 2 行目
  if (state.role === 'guest' && !hasData) notices.push({ text: 'ホストがまだこのワールドの所持パルを共有していません。', kind: 'info' });
  if (state.role === 'guest' && hasData) {
    const summary = roleSummary(state, { userId, now });
    if (summary) notices.push({ text: summary.text, kind: summary.kind, ...(summary.hint ? { hint: summary.hint } : {}) });
  }
  // パル次元ストレージの読み漏れ（共有を出しているとき。自分が候補のときだけ。この PC で読んだセーブの分は、下の読めなかったファイルの後）
  if (state.meta?.source === 'shared') {
    const gap = dimensionNotice(state, { selfUids });
    if (gap) notices.push(gap);
  }
  if (state.error) notices.push({ text: `セーブを読み込めませんでした: ${state.error}`, kind: 'warning' });
  // 共有の結果（送っている間〔sending〕・共有した〔done〕ときは出さない。ヘッダーのセーブ連携の状態が読み込み中の印を出す）
  const upload = state.upload ?? {};
  if (upload.status === 'error') notices.push({ text: `共有できませんでした${upload.error ? `（${upload.error}）` : ''}`, kind: 'warning' });
  const sent = uploadNotice(state);
  if (sent) notices.push(sent);
  if (state.shared?.error && !hasData) notices.push({ text: `共有された所持パルを読めませんでした: ${state.shared.error}`, kind: 'warning' });
  // 読み込めなかったファイルや、場所の分からないパルがあれば知らせる（この PC で読み込んだとき。読んでいる間も前回の分を残す）
  const snapshot = state.meta?.source === 'local' ? state.data?.snapshot : null;
  if (snapshot) {
    for (const file of snapshot.files?.skipped ?? []) notices.push({ text: `${file.path} を読めませんでした（${file.reason}）`, kind: 'warning' });
    const used = snapshot.files?.used ?? [];
    const noPlayers = !used.some((path) => /^Players\/[0-9a-f]{32}\.sav$/i.test(path));
    if (noPlayers) {
      notices.push({ text: 'Players フォルダのセーブを読めなかったため、手持ち・パルボックスのパルは場所が「不明」になります。', kind: 'warning' });
    } else if (state.data.source === 'handles') {
      // 登録した後に仲間が増えると、その人の Players のファイルは登録されていない
      const files = new Set(used.map((path) => path.toLowerCase()));
      const missing = (snapshot.players ?? []).filter((player) => player.uid && player.level > 0 && !files.has(`players/${player.uid.replace(/-/g, '').toLowerCase()}.sav`));
      if (missing.length) {
        const names = missing.map((player) => `${player.name || '名前なし'}（Players\\${player.uid.replace(/-/g, '').toUpperCase()}.sav）`);
        notices.push({ text: `登録されていないプレイヤーのファイルがあります: ${names.join('、')}。`, kind: 'warning', action: 'editWorld' });
      }
    }
    // パル次元ストレージの読み漏れ（Level.sav の一覧のうち、読めた _dps.sav にない個体。dps-missing）
    const gap = dimensionGap(snapshot);
    if (gap) notices.push(gap);
    // 解析の数（この PC で読んだデータだけにある。古い IndexedDB では無い・形が違うことがあるので、数として確かめてから使う）。
    // 参照されていないタマゴ（orphanEggs）は、ふだんから 0 でないことがあるので出さない
    const stats = isObject(snapshot.stats) ? snapshot.stats : {};
    const unknown = int(stats.unknownLocation, { min: 0, fallback: 0 });
    if (unknown && !noPlayers) notices.push({ text: `場所が分からないパルが ${unknown} 体います`, kind: 'info', action: 'unknownPlace' });
    const malformed = isObject(stats.malformed) ? Object.values(stats.malformed).reduce((sum, count) => sum + int(count, { min: 0, fallback: 0 }), 0) : 0;
    if (malformed) notices.push({ text: 'セーブの一部を読めませんでした（ゲームの更新で形が変わったかもしれません）', kind: 'warning' });
  }
  return notices;
}

/**
 * 案内を一覧にする。actions に notice.action と同じ名前のボタン（{ label, run }）があれば、案内の中に出す。
 * notice.hint があれば、文の下に小さな 2 行目（許可切れの勧め）
 */
export function noticeList(notices, list = el('ul', 'owned-notices'), actions = {}) {
  list.replaceChildren(...notices.map((notice) => {
    const item = el('li', `owned-notice ${notice.kind ? `notice-${notice.kind}` : ''}`.trim(), notice.text);
    if (notice.hint) item.append(el('small', 'owned-notice-hint', notice.hint));
    const action = actions[notice.action];
    if (action) item.append(button(action.label, action.run, 'button secondary owned-notice-action'));
    return item;
  }));
  list.hidden = !notices.length;
  return list;
}
