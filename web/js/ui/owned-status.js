// 所持パルの状態（連携・共有・更新時刻）の文言と、所持パルのタブの案内の帯。所持パルのタブ・設定・ヘッダーのセーブ連携の状態
// （ui/save-status.js）で使う。どのワールドの・いつのデータか・読み込み中かは、ヘッダーのセーブ連携の状態だけに出す（2026-10-14 の
// ユーザーのフィードバック〔D29〕で、所持パル・理想個体・継承ルートの画面に出していたデータ元の 1 行〔ownedSourceLine〕はなくした）
import { el, button, formatShortTime } from './dom.js';
import { toast } from './toast.js';
import { isObject, int } from '../core/boundary.js';
import { userIdKey } from '../core/user.js';
import { dpsMissing } from '../core/owned.js';
import { isPlaying } from '../core/playing.js';

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

/**
 * 参加しているワールドの自動登録の説明（設定の参加のワールドの行と、参加者の 1 行。参加者に「自動登録は動きません」と言わない。X-06）。
 * host は共有した人の名前。なければ「ホスト」（名前のときだけ前後に空白を入れる）
 */
export function guestAutoText(host = '') {
  const subject = host ? `${host} ` : 'ホスト';
  return `この PC では読み込みません。配合牧場の自動登録は${host ? ' ' : ''}${subject}の画面が行います（${subject}が自動登録をオンにしていて、プレイヤーの対応であなたが選ばれているとき）。`;
}

// ---- サーバーのワールド（server の participant-ui） ----
/**
 * 表示しているデータがサーバー（Palworld の専用サーバー）のセーブか（owned.js の meta.saveKind。共有のデータなら共有された値）。
 * サーバーと協力プレイを往復するので、最後の共有で決める。協力プレイ・古い共有（saveKind なし）は今までの文
 */
export const isServerSave = (meta) => meta?.saveKind === 'server';
// サーバーのワールドの参加者の 1 行（設定の参加のワールドの行と、参加者の 1 行）。サーバーで遊んでいる間は、サーバーの PC の常駐プログラムが
// 共有と配合牧場の自動登録を行う（ホストの画面は要らない）
export const SERVER_AUTO_TEXT = 'この PC では読み込みません。配合牧場の自動登録は、サーバーの PC の常駐プログラムが行います（プレイヤーの対応であなたが選ばれているとき）。';

/**
 * 役割ごとの 1 行。ホスト・参加者（role 'guest'）・未連携で共有を見ている人。共有を見ていない未連携の人は null
 *（「セーブ未登録」の案内は所持パルの案内に任せる）。参加者・共有を見ている人で、共有のプレイヤーにログイン中の ID と同じ名前の人が
 * いなければ hint に 1 行（X-07。一致したとき・GAS のプレイヤーの対応〔mapping。mappingMode が 'gas'〕で自分の ID に対応づいた人が
 * いるときは出さない）。
 * 参加者の文は、最後に共有した人を今のホストと決めつけない（ホストは仲間内で交代する。sync-fixes の host-rotation）: 新しい共有を別の人が
 * 送ったときだけその人の名前で言い、古い共有（SHARED_STALE_MS より前）・自分が送った共有では「ホスト」と言って、共有した PC を添える。
 * 古い共有は警告の短い文にするが、共有が止まっている案内（shareLagNotice）が出るときは古さをそちらに任せ、info の形にする（同じ内容の
 * 警告を 2 つ並べない）。
 * 最後の共有がサーバーのセーブなら、サーバーの PC の常駐プログラムの文（serverSummary）
 * @returns {null | { text: string, kind: 'info' | 'warning', hint: string }}
 */
export function roleSummary(state, { userId = '', now = Date.now, mapping = {}, mappingMode = 'legacy' } = {}) {
  if (!state) return null;
  if (state.role === 'host') return { text: HOST_SUMMARY, kind: 'info', hint: '' };
  const meta = state.meta ?? {};
  const shared = meta.source === 'shared';
  const host = meta.uploadedBy || meta.hostName || '';
  const sharedAt = meta.sharedAt || meta.saveUpdatedAt || '';
  const ago = shared ? timeAgo(sharedAt, now()) : '';
  const stale = shared && Number.isFinite(Date.parse(sharedAt)) && now() - Date.parse(sharedAt) > SHARED_STALE_MS;
  const hint = shared ? nameMismatch(state.owned?.players ?? [], userId, { mapping, mappingMode }) : '';
  if (shared && isServerSave(meta)) return serverSummary(state, { ago, stale, hint, now });
  if (state.role === 'guest') {
    if (!shared) return { text: guestAutoText(host), kind: 'info', hint: '' };
    // 共有した PC（送った人は ID で比べる。分からなければ添えない）
    const mine = Boolean(userId && meta.uploadedBy) && userIdKey(meta.uploadedBy) === userIdKey(userId);
    const from = mine ? '（あなたの PC から）' : meta.uploadedBy ? `（${meta.uploadedBy} の PC から）` : '';
    if (stale && !shareLagNotice(state, { now })) {
      return {
        text: `最後の共有は ${ago}${from}です。今ホストしている人の PC でこのページが閉じていると、共有も配合牧場の自動登録も止まります。`,
        kind: 'warning', hint,
      };
    }
    return { text: `${guestAutoText(mine || stale ? '' : host).replace(/。$/, '')} · 最後の共有 ${ago}${from}`, kind: 'info', hint };
  }
  if (!shared) return null;
  return { text: `${host ? `${host} が` : 'ホストが'}共有した所持パルを表示しています · 最後の共有 ${ago}`, kind: stale ? 'warning' : 'info', hint };
}

// サーバーのワールドの共有を見ている参加者・閲覧者の 1 行。共有はサーバーの PC の常駐プログラムが送る（送った人は常駐の ID なので名指し
// しない）。サーバーは遊ぶときだけ動かす（決定 4）ので、古い共有はふつうのこととして info。警告は、常駐の応答ではサーバーが稼働中なのに
// 共有が古いときだけ（共有が止まっている案内〔shareLagNotice〕が出るときはそちらに任せる）
function serverSummary(state, { ago, stale, hint, now }) {
  if (stale && serverRunning(state, { now }) && !shareLagNotice(state, { now })) {
    return { text: `サーバーは稼働中ですが、最後の共有は ${ago}です。サーバーの PC の常駐プログラムを確かめてください。`, kind: 'warning', hint };
  }
  const lead = state.role === 'guest' ? SERVER_AUTO_TEXT.replace(/。$/, '') : 'サーバーの PC の常駐プログラムが共有した所持パルを表示しています';
  return { text: `${lead} · 最後の共有 ${ago}`, kind: 'info', hint };
}

// ---- ゲーム中の推定と、共有が止まっていることの案内（sync-fixes の host-rotation） ----
// 参加者がゲーム中なのに、共有のセーブがこれより古い（または共有がない）と、今のホストの画面が閉じているとみなす
export const SHARE_LAG_MS = 5 * 60 * 1000;
// 共有をこの間の中に確かめたときだけ案内する（参加者のタブは裏では共有を読まない〔D26〕ので、表に戻った直後の古い共有で誤って出さない）。
// 確かめたのは今のワールドで（owned.js の shared.fetchedWorldId）、取得に失敗していないこと（ワールドを替えた直後の失敗で、前のワールドを
// 確かめた時刻を使って「まだ共有されていません」と誤って出さない。Codex のレビュー）
export const SHARE_CHECKED_MS = 60 * 1000;

/** この PC が今のワールド・今の役割でゲーム中か（owned.js の state.play。core/playing.js の isPlaying） */
export function playingNow(state, now = Date.now()) {
  return isPlaying(state?.play, { worldId: state?.linkedWorldId ?? '', role: state?.role ?? '' }, now);
}

/**
 * ヘッダーのセーブ連携のパネルの「この PC」の行の 1 行目（ゲーム中の推定）。ホストはゲームの保存が続けて見えているか（「ホスト中（推定）」）と、
 * ホスト用のセーブがあるだけか（同期で受け取った・ゲームを終えた後）を分ける。参加者はゲーム中のときだけ。ほかは ''
 */
export function playSummary(state, { now = Date.now } = {}) {
  const playing = playingNow(state, now());
  if (state?.role === 'host') return playing ? 'ホスト中（推定）' : 'ホスト用のセーブあり（ゲームの保存は続けて見えていません）';
  return state?.role === 'guest' && playing ? '参加中（推定）' : '';
}

// 共有が止まっている案内の直し方。協力プレイは今のホストの PC のページ。サーバーのワールド（最後の共有がサーバーのセーブ）は、まずサーバーの
// PC の常駐プログラムを確かめ、協力プレイに戻した場合（往復する。決定 5）の直し方も添える
const COOP_LAG_HELP = '今のホストの PC でこのページが開いているか確かめてください。あなたがホストなら、このワールドの編集で Level.sav・LevelMeta.sav・Players のファイルを足してください。';
const SERVER_LAG_HELP = `サーバーで遊んでいるなら、サーバーの PC で常駐プログラムが動いているか確かめてください。協力プレイに戻したなら、${COOP_LAG_HELP}`;

/**
 * 参加者がゲーム中なのに、共有が止まっている（共有のセーブが SHARE_LAG_MS より古い・このワールドの共有がない）ときの案内。所持パルの案内
 *（［ワールドを編集］のボタン）とヘッダーのチップ（「共有が止まっています」、共有がなければ「共有されていません」）に同じ文で出す。ヘッダーには
 * 押すボタンがないので、文にはボタンの名前を書かない。今のワールドの共有を SHARE_CHECKED_MS の中に確かめていなければ（取得の失敗を含む）出さない
 * @returns {null | { text: string, kind: 'warning', action: 'editWorld' }}
 */
export function shareLagNotice(state, { now = Date.now } = {}) {
  if (state?.role !== 'guest') return null;
  const time = now();
  if (!playingNow(state, time)) return null;
  const shared = state.shared ?? {};
  const checked = Date.parse(shared.fetchedAt ?? '');
  if (shared.error || shared.fetchedWorldId !== state.linkedWorldId || !Number.isFinite(checked) || time - checked > SHARE_CHECKED_MS) return null;
  const meta = state.meta ?? {};
  // ページを開いているほかの PC の短い一覧を添える（分からなければ添えない。page-presence）
  const help = `${isServerSave(meta) ? SERVER_LAG_HELP : COOP_LAG_HELP}${openPagesBrief(state, { now: () => time })}`;
  if (meta.source !== 'shared') return { text: `ゲーム中のようですが、このワールドはまだ共有されていません。${help}`, kind: 'warning', action: 'editWorld' };
  const saved = Date.parse(meta.saveUpdatedAt ?? '');
  if (Number.isFinite(saved) && time - saved < SHARE_LAG_MS) return null;
  const ago = timeAgo(meta.saveUpdatedAt, time);
  return { text: `ゲーム中のようですが、共有は ${ago ? `${ago}の` : '古い'}セーブのままです。${help}`, kind: 'warning', action: 'editWorld' };
}

// ---- ページを開いている PC（sync-fixes の page-presence。owned.js の state.pages） ----
// この間の中に応答があった PC は「●」で役割・ゲーム中・共有できるを出す（ページは 1 分ごとに送る。裏のタブでタイマーが遅れる分を見込む）。
// それより前は「○ 最近の応答なし」（閉じたとは限らないので、古いページの役割は出さない）。PAGE_KEEP_MS より前は出さない
export const PAGE_FRESH_MS = 3 * 60 * 1000;
export const PAGE_KEEP_MS = 6 * 60 * 60 * 1000;
// 1 台の PC で複数のページ（タブ）が応答しているときの役割の選び方（先のものを選ぶ）と、役割ごとの文（[ゲーム中, ゲーム中でない]）
const PAGE_ROLES = ['host', 'guest', 'none'];
const PAGE_ROLE_TEXT = { host: ['ホスト中', 'ホスト用のセーブあり'], guest: ['参加中', '参加者'], none: ['セーブ未連携', 'セーブ未連携'] };

/**
 * 今のワールド（表示しているワールド）でページを開いている PC。PC（device）ごとにまとめ、3 分以内に応答があった PC を先に、応答の新しい順。
 * 一覧が分からない（古い GAS・まだ受け取っていない・別のワールドの一覧）なら null。経過はサーバーの時刻で測る（受け取ったときのサーバーの
 * 時刻＋その後に経った時間。PC の時計がずれていても境目がずれない）。
 * サーバーの PC の常駐プログラム（presence の resident。server の participant-ui）は、ログインの ID によらず「サーバー」と呼び、tags の先頭に
 *「常駐」、labels は「サーバー稼働中」（常駐が送る playing＝サーバーが保存を続けている）か「サーバー停止中」だけにする。サーバーは遊ぶときだけ
 * 動かすので、停止中はふつうのこと（警告にしない）
 * @returns {null | { device: string, user: string, label: string, name: string, tags: string[], labels: string[], fresh: boolean, self: boolean,
 *   resident: boolean, at: string, time: number, ago: string, role: string, playing: boolean, canShare: boolean }[]}
 *   tags は「常駐」・「PC 2」（同じ人の 2 台目から。常駐は常駐どうしで数える。番号は今の一覧〔6 時間以内〕に残る PC の ID の順なので、見る人に
 *   よって入れ替わらない。ID の順で先の古い PC が一覧から消えると繰り上がることがある）・「この PC」、label は呼び名（user。常駐は「サーバー」）、
 *   name は label に tags を添えたもの。
 *   role・playing・canShare・labels（「ホスト中」「共有できる」）は、その PC の 3 分以内のページの応答だけでまとめたもの（古い PC は ''・false・[]）
 */
export function openPages(state, { now = Date.now } = {}) {
  const pages = state?.pages;
  const worldId = state?.meta?.worldId;
  if (!pages || !Array.isArray(pages.list) || !worldId || pages.worldId !== worldId) return null;
  const time = now();
  const serverTime = Date.parse(pages.serverTime);
  const current = Number.isFinite(serverTime) && Number.isFinite(pages.receivedAt) && pages.receivedAt > 0
    ? serverTime + Math.max(0, time - pages.receivedAt) : time;
  const devices = new Map();
  for (const page of pages.list) {
    const at = Date.parse(page?.at);
    if (!Number.isFinite(at) || current - at > PAGE_KEEP_MS || typeof page.device !== 'string' || !page.device) continue;
    devices.set(page.device, [...(devices.get(page.device) ?? []), { ...page, time: at }]);
  }
  const pcs = [...devices].map(([device, list]) => {
    const newest = list.reduce((best, page) => (page.time > best.time ? page : best));
    const recent = list.filter((page) => current - page.time <= PAGE_FRESH_MS);
    const role = PAGE_ROLES.find((value) => recent.some((page) => page.role === value)) ?? '';
    const resident = list.some((page) => page.resident === true);
    return {
      device, user: typeof newest.user === 'string' ? newest.user : '', time: newest.time, at: newest.at, fresh: recent.length > 0,
      self: Boolean(pages.device) && device === pages.device, role, resident,
      playing: recent.some((page) => (resident ? page.resident === true : page.role === role) && page.playing === true),
      canShare: recent.some((page) => page.canShare === true),
    };
  });
  // 番号を数える組（同じ人。常駐はどの ID でも「サーバー」と出すので、常駐どうしで数え、同じ ID のページと混ぜない）
  const groupOf = (pc) => (pc.resident ? '\u0000resident' : userIdKey(pc.user));
  const sameUser = new Map();
  for (const pc of pcs) sameUser.set(groupOf(pc), [...(sameUser.get(groupOf(pc)) ?? []), pc.device].sort());
  return pcs
    .sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.time - a.time || a.device.localeCompare(b.device))
    .map((pc) => {
      const number = sameUser.get(groupOf(pc)).indexOf(pc.device) + 1;
      const tags = [...(pc.resident ? ['常駐'] : []), ...(number > 1 ? [`PC ${number}`] : []), ...(pc.self ? ['この PC'] : [])];
      const [active, idle] = PAGE_ROLE_TEXT[pc.role] ?? PAGE_ROLE_TEXT.none;
      const labels = !pc.fresh ? []
        : pc.resident ? [pc.playing ? 'サーバー稼働中' : 'サーバー停止中'] : [pc.playing ? active : idle, ...(pc.canShare ? ['共有できる'] : [])];
      const label = pc.resident ? 'サーバー' : pc.user || '名前なし';
      return { ...pc, label, name: `${label}${tags.length ? `（${tags.join('・')}）` : ''}`, tags, labels, ago: timeAgo(pc.at, current) };
    });
}

/** 3 分以内に応答した常駐のどれかが、サーバーが保存を続けている（playing）と送っているか（サーバー稼働中。決定 14 で常駐は 2 台以上もありうる） */
export function serverRunning(state, { now = Date.now } = {}) {
  return (openPages(state, { now }) ?? []).some((pc) => pc.resident && pc.fresh && pc.playing);
}

/**
 * ヘッダーのセーブ連携のパネルの「ページを開いている PC」の行（1 台 1 行。表の幅いっぱい）。「● Alice · 1 分前 · ホスト中 · 共有できる」
 *「○ Bob · 最近の応答なし（3 時間前）」「● サーバー（常駐） · たった今 · サーバー稼働中」。分からない・6 時間以内の応答がなければ []
 */
export function openPagesLines(state, { now = Date.now } = {}) {
  return (openPages(state, { now }) ?? []).map((pc) => (pc.fresh
    ? `● ${[pc.name, pc.ago, ...pc.labels].join(' · ')}`
    : `○ ${pc.name} · 最近の応答なし（${pc.ago}）`));
}

/**
 * 共有が止まっている案内（shareLagNotice）に添える短い一覧。3 分以内に応答があったほかの PC（この PC は除く）。分からなければ ''
 */
export function openPagesBrief(state, { now = Date.now } = {}) {
  const pcs = openPages(state, { now });
  if (!pcs) return '';
  const others = pcs.filter((pc) => pc.fresh && !pc.self);
  if (!others.length) return 'ほかの PC のこのページからは、3 分以内の応答がありません。';
  return `3 分以内に応答があったほかの PC: ${others.map((pc) => `${pc.label}（${[...pc.tags, ...pc.labels].join('・')}）`).join('、')}。`;
}

// 共有のプレイヤーにログイン中の ID と同じ名前（userIdKey で比べる）の人も、プレイヤーの対応で自分の ID に対応づいた人もいないときの 1 行。
// mapping は表示しているワールドの対応（uid → ID。auto-register.js の mapping）。mappingMode が 'gas' なら対応はノートにあり、どの PC からでも
// 選べる（server の mapping）。'legacy'（前の版）なら、ホストの PC の対応だけが効く（mapping はこの PC の対応なので、出す・出さないに使わない）
function nameMismatch(players, userId, { mapping = {}, mappingMode = 'legacy' } = {}) {
  if (!userId || !players.length || players.some((player) => player.name && userIdKey(player.name) === userIdKey(userId))) return '';
  if (mappingMode === 'gas' && players.some((player) => typeof mapping[player.uid] === 'string' && userIdKey(mapping[player.uid]) === userIdKey(userId))) return '';
  const names = [...new Set(players.map((player) => player.name).filter(Boolean))];
  const shown = names.length > 5 ? `${names.slice(0, 5).join('・')} ほか` : names.join('・');
  const lead = `このワールドに「${userId}」という名前のプレイヤーがいません（${shown}）。あなたが親 2 体を預けた配合は、`;
  if (mappingMode === 'gas') return `${lead}設定の「プレイヤーの対応」で自分のプレイヤーに ${userId} を選ぶと登録されます（どの PC からでも選べます）。`;
  return `${lead}ホストに設定の「プレイヤーの対応」で ${userId} を選んでもらうまで登録されません（「このワールドでの自分」を選んでも、ホストの対応は変わりません）。`;
}

/**
 * 表示しているワールドのプレイヤーの対応（roleSummary・ownedNotices に渡す mapping と mappingMode。auto-register.js の mapping・mappingMode）。
 * 自動登録がない・表示しているワールドがなければ {}（前の版の文になる）
 */
export function mappingOptions(autoRegister, state) {
  const worldId = state?.meta?.worldId;
  if (typeof autoRegister?.mapping !== 'function' || !worldId) return {};
  return { mapping: autoRegister.mapping(worldId) ?? {}, mappingMode: autoRegister.mappingMode?.(worldId) ?? 'legacy' };
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

// 「今すぐ読み込む」で、保存の途中に読んだ・読めないファイルがあるため一式を採用せずに読み直しを待つ（owned.js の 'held'。save-watch）ときの知らせ
export const HELD_TEXT = 'セーブの一部をまだ読めないため、少し待ってから自動で読み直します';

/**
 * 「今すぐ読み込む」のボタンの動き（2 か所で同じ）。読み直しを待つ（'held'）ときは、何も起きないように見えないよう知らせる。
 * 失敗は呼び出し側（runButton）がトーストにする
 */
export function refreshNow(owned) {
  return owned.refreshAuto({ enable: true }).then((result) => {
    if (result === 'held') toast(HELD_TEXT);
    return result;
  });
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
 *   共有でも共有した時刻ではなくホストのセーブの時刻。Codex のレビュー）、label は「セーブ」「ホストのセーブ」（最後の共有がサーバーのセーブ
 *   なら「サーバーのセーブ」）、fresh はその保存が新しい（いまもプレイ中とみなせる）か
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
    label: !shared ? 'セーブ' : isServerSave(meta) ? 'サーバーのセーブ' : 'ホストのセーブ',
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
 * ヘッダーのセーブ連携のパネルの行 [見出し, 文]。ゲーム内の日数・プレイ中（「Alice・Bob（セーブ 03:07 の時点）」。参加者は「ホストのセーブ」、
 * サーバーのワールドは「サーバーのセーブ」。分からなければ出さない）・
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

/**
 * ワールドの呼び名（「「名前」（ホスト Alice）」。名前がなければ「ワールド 頭 8 字」）。サーバーのワールド（isServerSave。サーバーのセーブには
 * ホスト名がない）は「（サーバー）」を添える
 */
export function worldName(meta) {
  if (!meta) return '';
  const name = meta.worldName || meta.name ? `「${meta.worldName || meta.name}」` : `ワールド ${String(meta.worldId ?? meta.id ?? '').slice(0, 8)}`;
  return `${name}${isServerSave(meta) ? '（サーバー）' : meta.hostName ? `（ホスト ${meta.hostName}）` : ''}`;
}

export function roleLabel(state) {
  if (state.role === 'host') return 'ホスト（この PC にワールドのセーブがあります）';
  if (state.role !== 'guest') return '';
  return state.meta?.source === 'shared' && isServerSave(state.meta)
    ? '参加者（サーバーの PC の常駐プログラムが共有した所持パルを表示します）' : '参加者（ホストが共有した所持パルを表示します）';
}

/**
 * 共有の送信の結果の知らせ（ヘッダーのセーブ連携のパネルの「共有」の行と、押す前の説明。sync-fixes の share-upload）。対応は要らないので、
 * 所持パルの案内の帯には出さない（同期を受け取っただけの PC で帯に出たままにならないように）。
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
  if (upload.status === 'stale') return { text: '共有されているセーブの方が新しいため、そちらを表示しています。', kind: 'info' };
  const who = upload.published?.uploadedBy ?? '';
  // 共有したのが送ったときの自分の ID なら、同じ ID の別のタブか PC（ID は大文字小文字・全半角をそろえて比べる）
  const mine = Boolean(who && upload.userId) && userIdKey(who) === userIdKey(upload.userId);
  const from = mine ? 'あなたの別のタブか PC から' : who ? ` ${who} の PC から` : '';
  return { text: `同じセーブは${from}共有済みです。`, kind: 'info' };
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
 * 自分の _dps.sav をホストに足してもらう案内。ほかの人が候補のときは出さない。数はワールド全体の欠け（だれの分かは分からない）
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
    text: `ワールド全体で、パル次元ストレージの ${count} 体が出ていません。ホストの登録にあなたの ${files.join('、')} がないかもしれません。ホストに足してもらってください。`,
    kind: 'warning',
  };
}

/**
 * 所持パルのタブの上に出す案内。対応が要るものだけ（読み込み中・確認中・共有中は出さない。ヘッダーのセーブ連携の状態が知らせる）。
 * 案内は 1 文と行き先のボタン（「設定タブの〜」とだけ書かない。copy-dead-ends）。action はボタンの名前（views/owned.js の noticeActions。
 * grant＝読む許可・register＝ワールドの登録のモーダル・settings＝設定のセーブ連携〔読んでいるワールドの行〕へ・editWorld＝読んでいるワールドの
 * 編集のモーダル・unknownPlace＝場所の分からないパル・mapping＝設定のプレイヤーの対応〔表示しているワールドの未設定の行〕へ）。selfUids は
 * 自分のプレイヤー（参加者のパル次元ストレージの読み漏れの案内。dimensionNotice）
 */
export function ownedNotices(state, { userId = '', now = Date.now, selfUids = new Set(), mapping = {}, mappingMode = 'legacy' } = {}) {
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
  // 参加者: データがなければ共有を待つ 1 行、あれば役割の 1 行（自動登録はホストの画面が行うこと・最後の共有。roles）と、名前が合わないときの 2 行目。
  // ゲーム中なのに共有が止まっていれば、その案内（共有がなければ共有を待つ 1 行の代わり。host-rotation）
  const lag = shareLagNotice(state, { now });
  if (state.role === 'guest' && !hasData) notices.push(lag ?? { text: 'ホストがまだこのワールドの所持パルを共有していません。', kind: 'info' });
  if (state.role === 'guest' && hasData) {
    const summary = roleSummary(state, { userId, now, mapping, mappingMode });
    // 名前が合わない 2 行目が GAS の対応の文（本人が設定で選べる）なら、行き先のボタン（プレイヤーの対応を開く。最終レビュー）
    const pick = summary?.hint && mappingMode === 'gas' ? { action: 'mapping' } : {};
    if (summary) notices.push({ text: summary.text, kind: summary.kind, ...(summary.hint ? { hint: summary.hint } : {}), ...pick });
    if (lag) notices.push(lag);
  }
  // パル次元ストレージの読み漏れ（共有を出しているとき。自分が候補のときだけ。この PC で読んだセーブの分は、下の読めなかったファイルの後）
  if (state.meta?.source === 'shared') {
    const gap = dimensionNotice(state, { selfUids });
    if (gap) notices.push(gap);
  }
  if (state.error) notices.push({ text: `セーブを読み込めませんでした: ${state.error}`, kind: 'warning' });
  // 共有の結果は、送れなかったときだけ（送っている間〔sending〕はヘッダーのセーブ連携の状態が読み込み中の印を出す。同じセーブが共有済み・
  // 共有の方が新しい〔uploadNotice〕は対応が要らないので、ヘッダーのセーブ連携のパネルだけに出す）
  const upload = state.upload ?? {};
  if (upload.status === 'error') notices.push({ text: `共有できませんでした${upload.error ? `（${upload.error}）` : ''}`, kind: 'warning' });
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
