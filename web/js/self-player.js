// このワールドでの自分（セーブのプレイヤーの鍵）を、ID・環境・ワールドごとにこの端末に 1 つだけ残す（DOM には触れない）。
// 参加している人や、ゲーム内の名前とノートの ID が違う人が、設定で自分を選ぶ。理想個体の完成の判定と、理想個体・所持パルの
// 所持者の「自分」に使う（core/ideal-goals.js の ownPlayerUids の self。その回のプレイヤーに引けるときだけ効く）。
// 値はプレイヤーの鍵（core/owned-shared.js の playerKeyOf。キャラクターの InstanceId の 'i:'、なければ UID の 'u:'）。協力プレイとサーバーを
// 往復して PlayerUId が入れ替わっても、同じキャラクターを指す（server の identity）。前の版の値（プレフィックスのない UID）は 'u:' として読み、
// migrate で 'i:' に書き直す。
// 自動登録の「登録者の対応」（auto-register.js の setMapping）には入れない（A → B と変えたときに A の対応が残り、両方が自分になるため）。
// 仲間には共有しない（GAS は変えない）。
import { userIdKey } from './core/user.js';
import { ownedWorldId, HOST_UID, legacyPlayerKey, playerKeyOf } from './core/owned-shared.js';

// キーの末尾のワールド ID（ownedWorldId の形。ID に「.」があっても、別の人のキーを今のログインの分に数えないため）
const WORLD = /^[0-9A-F]{32}$/;

/** 保存キーの頭（別のタブの storage イベントの見分けと、名前の変更での移し替えに使う） */
export const SELF_PREFIX = (namespace) => `${namespace}.ideals.self.`;

/** 保存キー 'pal-note.ideals.self.<env>.<userIdKey>.<ワールド ID〔大文字〕>'。どれか欠ける・ワールド ID の形が違えば '' */
export function selfKey(namespace, env, userId, worldId) {
  const user = typeof userId === 'string' && userId ? userIdKey(userId) : '';
  const world = ownedWorldId(worldId);
  return namespace && env && user && world ? `${SELF_PREFIX(namespace)}${env}.${user}.${world}` : '';
}

/**
 * このワールドでの自分の保存。ログイン中（store.state の env・userId・passcode）の分だけ読み書きする。
 * 保存できない端末（localStorage が使えない・容量不足）でも、ページを開いている間は効くよう、手元にも持つ。
 * 購読者は「本人が変わった」ときに呼ぶ（選んだ・別のタブで変わった・登録者の対応が変わった〔changed〕）。app.js が完成の判定をし直し、
 * 理想個体・所持パル・設定が描き直す
 * @returns {{ key(worldId): string, get(worldId): string, set(worldId, playerKey): boolean, readonly saveFailed: boolean,
 *   reload(storageKey, options?): void, migrate(worldId, players, options?): boolean, changed(): void, subscribe(listener): () => void }}
 */
export function createSelfStore({ store, storage, namespace = 'pal-note' }) {
  const listeners = new Set();
  // 読んだ値（キー → プレイヤーの鍵。無ければ ''）と、この端末に書けなかった値（ページを開いている間はこちらを使う）
  const cache = new Map();
  const unsaved = new Map();
  const emit = () => listeners.forEach((listener) => listener());
  // 次の store の通知まで遅らせている知らせ（reload の defer）。遅らせている間だけ store を購読する（購読は後から足すので、
  // その通知を受けるほかの購読者〔ideals.js の判定・各画面〕の後で知らせる）
  let stopDeferred = null;
  function defer() {
    if (stopDeferred) return;
    stopDeferred = store.subscribe?.(() => {
      stopDeferred?.();
      stopDeferred = null;
      emit();
    }) ?? null;
    // 購読できない store（テストの偽物）では、遅らせずに知らせる
    if (!stopDeferred) emit();
  }

  function key(worldId) {
    const { env, userId, passcode } = store.state;
    return passcode ? selfKey(namespace, env, userId, worldId) : '';
  }

  // 今のログインのキーか（'<namespace>.ideals.self.<env>.<userIdKey>.<ワールド ID>'）
  function isCurrent(storageKey) {
    const { env, userId, passcode } = store.state;
    const user = passcode && typeof userId === 'string' && userId ? userIdKey(userId) : '';
    const prefix = `${SELF_PREFIX(namespace)}${env}.${user}.`;
    return Boolean(env && user) && storageKey.startsWith(prefix) && WORLD.test(storageKey.slice(prefix.length));
  }

  function read(storageKey) {
    if (unsaved.has(storageKey)) return unsaved.get(storageKey);
    if (!cache.has(storageKey)) {
      let value = null;
      try { value = storage?.getItem(storageKey) ?? null; } catch { /* 読めない端末は未設定として扱う。 */ }
      // 前の版の値（プレフィックスのない UID）は 'u:' に読み替える。形の合わない値は ''
      cache.set(storageKey, legacyPlayerKey(value));
    }
    return cache.get(storageKey);
  }

  return {
    key,
    /** 保存したプレイヤーの鍵（前の版の UID は 'u:'。形が合わなければ ''）。その回のプレイヤーに引けるかは使う側（ownPlayerUids）が確かめる */
    get(worldId) {
      const storageKey = key(worldId);
      return storageKey ? read(storageKey) : '';
    },
    /**
     * プレイヤーの鍵（前の版の UID も受けて 'u:' にする）を保存する。'' なら消す。保存できたら true。ログイン前・形の合わない値は何もせず
     * false。保存できなければ手元にだけ残して saveFailed を立て、false
     */
    set(worldId, playerKey) {
      const storageKey = key(worldId);
      const value = playerKey ? legacyPlayerKey(playerKey) : '';
      if (!storageKey || (playerKey && !value)) return false;
      let saved = false;
      try {
        if (value) storage.setItem(storageKey, value);
        else storage.removeItem(storageKey);
        saved = true;
      } catch { /* 保存できない端末・容量超過は saveFailed で知らせる。 */ }
      if (saved) {
        unsaved.delete(storageKey);
        cache.set(storageKey, value);
      } else unsaved.set(storageKey, value);
      emit();
      return saved;
    },
    /**
     * 今のログイン（env・ID）の分で、この端末に書けずに手元にだけ残している値があるか（ID の変更は、これが立っている間は始めない。
     * user-rename.js）。前にログインしていた別の ID の分は数えない
     */
    get saveFailed() { return [...unsaved.keys()].some(isCurrent); },
    /**
     * 別のタブの storage イベント・ID の変更の後。キーが SELF_PREFIX で始まれば読み直して知らせる（SELF_PREFIX そのものなら全部）。
     * 保存先に書かれた値の方が新しいので、そのキーの書けずに残していた値も捨てる。
     * defer: 知らせを次の store の通知まで遅らせる（ID の変更で端末のデータを移した直後は、まだログイン中の ID が前の ID のままで、
     * 知らせると各画面が前の ID のキー〔移して消した〕を読んで、自分が一度「分からない」になるため）
     */
    reload(storageKey, { defer: later = false } = {}) {
      if (typeof storageKey !== 'string' || !storageKey.startsWith(SELF_PREFIX(namespace))) return;
      cache.clear();
      if (storageKey === SELF_PREFIX(namespace)) unsaved.clear();
      else unsaved.delete(storageKey);
      if (later) defer();
      else emit();
    },
    /**
     * UID の鍵（'u:'。前の版の値も）を、同じ UID のその回のプレイヤー（{ uid, instanceId? } の配列）のキャラクターの鍵（'i:'）に書き直す
     *（往復で UID が入れ替わっても同じキャラクターを指すように）。H は hostLocal（この PC がホストとして読んだ手元のデータ）のときだけ
     *（参加者の画面の H は、そのときホストしている仲間のキャラクター）。ID の変更中・書けずに手元にだけ残している値・書けない端末では
     * 何もしない（前の値のままでも、その回の UID には引ける）。書き直したら知らせて true
     */
    migrate(worldId, players, { hostLocal = false } = {}) {
      const storageKey = key(worldId);
      if (!storageKey || store.state.renaming || unsaved.has(storageKey) || !Array.isArray(players)) return false;
      const current = read(storageKey);
      if (!current.startsWith('u:')) return false;
      const uid = current.slice(2);
      if (uid === HOST_UID && !hostLocal) return false;
      const player = players.find((item) => typeof item?.uid === 'string' && item.uid.toLowerCase() === uid);
      const next = player ? playerKeyOf(player) : '';
      if (!next.startsWith('i:')) return false;
      try {
        storage.setItem(storageKey, next);
      } catch {
        return false;
      }
      cache.set(storageKey, next);
      emit();
      return true;
    },
    /** 本人の決め方が、このストアの外で変わった（登録者の対応を変えた・別のタブで変わった）。購読者に知らせる */
    changed() { emit(); },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
