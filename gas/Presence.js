/**
 * ページを開いている PC（presence。docs/sync-fixes/README.md の 3・8）。シートには書かず、CacheService に置く。
 * - ページごとのキー presence:<env>:<worldId>:<pageId>（値は { user, device, role, playing, canShare, at }。6 時間）
 * - ワールドの索引のキー presence:<env>:<worldId>（ページの ID と記録した時刻の一覧。期限切れを除き、1 ワールド 50 件まで）
 * 索引の読み・足し・除去は短い鍵の中で行う。共有の鍵（ScriptLock）と別の鍵は使えない（DocumentLock は Web アプリの実行では null。
 * UserLock は匿名で実行する Web アプリでは誰の鍵か定まらない）ので、ScriptLock を 0.5 秒だけ試す。取れなければ索引だけを諦め、
 * ページのキーは書く（次の送信〔60 秒ごと〕で索引に戻る）。キャッシュの失敗は本体の操作（ownedSince など）を失敗させない。
 * ID は画面が作るランダムな値で、認証にも本人の証明にも使わない（共通パスワードの認証なので、名前と役割は自己申告）。
 */

var PRESENCE_LOCK_MS_ = 500;

function presenceIndexKey_(env, worldId) {
  return 'presence:' + env + ':' + worldId;
}

function presencePageKey_(env, worldId, pageId) {
  return presenceIndexKey_(env, worldId) + ':' + pageId;
}

// 索引（[{ id, at }]。at はミリ秒）。壊れていれば空
function readPresenceIndex_(cache, key) {
  var parsed = ownedJson_(cache.get(key), []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(function (item) {
    return item && typeof item.id === 'string' && typeof item.at === 'number' && isFinite(item.at);
  });
}

/** presence を 1 件記録する。{ saved }（索引まで書けたら true） */
function writePresence_(env, worldId, input) {
  var cache = CacheService.getScriptCache();
  var nowMs = Date.now();
  var entry = {
    user: input.user, device: input.device, role: input.role, playing: input.playing, canShare: input.canShare,
    at: new Date(nowMs).toISOString()
  };
  try {
    cache.put(presencePageKey_(env, worldId, input.pageId), JSON.stringify(entry), OWNED_PRESENCE_TTL_S);
  } catch (error) {
    console.error('writePresence_ page failed: ' + error);
    return { saved: false };
  }
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(PRESENCE_LOCK_MS_);
  } catch (error) {
    locked = false;
  }
  if (!locked) return { saved: false };
  try {
    var key = presenceIndexKey_(env, worldId);
    var index = readPresenceIndex_(cache, key).filter(function (item) {
      return item.id !== input.pageId && nowMs - item.at < OWNED_PRESENCE_TTL_S * 1000;
    });
    // 新しい順（同じ時刻なら今記録したページを先に）
    index.unshift({ id: input.pageId, at: nowMs });
    index.sort(function (a, b) { return b.at - a.at; });
    cache.put(key, JSON.stringify(index.slice(0, OWNED_PRESENCE_MAX)), OWNED_PRESENCE_TTL_S);
    return { saved: true };
  } catch (error) {
    console.error('writePresence_ index failed: ' + error);
    return { saved: false };
  } finally {
    lock.releaseLock();
  }
}

/** そのワールドの presence の一覧（新しい順。期限切れ・壊れた値は除く）。読めなければ null（分からない） */
function readPresence_(env, worldId) {
  try {
    var cache = CacheService.getScriptCache();
    var nowMs = Date.now();
    var index = readPresenceIndex_(cache, presenceIndexKey_(env, worldId)).filter(function (item) {
      return nowMs - item.at < OWNED_PRESENCE_TTL_S * 1000;
    });
    if (!index.length) return [];
    var keys = index.map(function (item) { return presencePageKey_(env, worldId, item.id); });
    var values = cache.getAll(keys) || {};
    var list = [];
    keys.forEach(function (key) {
      var value = ownedJson_(values[key], null);
      if (!value || typeof value !== 'object') return;
      var at = ownedTime_(value.at);
      if (!isFinite(at) || nowMs - at >= OWNED_PRESENCE_TTL_S * 1000) return;
      list.push({
        user: String(value.user == null ? '' : value.user), device: String(value.device == null ? '' : value.device),
        role: value.role, playing: value.playing === true, canShare: value.canShare === true, at: value.at
      });
    });
    list.sort(function (a, b) { return ownedTime_(b.at) - ownedTime_(a.at); });
    return list;
  } catch (error) {
    console.error('readPresence_ failed: ' + error);
    return null;
  }
}

/**
 * presence があれば記録し、一覧を返す（{ presence, saved }）。形の違う presence は記録しない（saved: false）。
 * ここでの失敗は投げない（呼び出した操作を失敗させない）
 */
function presenceExchange_(env, worldId, value) {
  var saved = false;
  if (value !== undefined && value !== null) {
    var input = cleanPresenceInput(value);
    if (input) {
      try {
        saved = writePresence_(env, worldId, input).saved;
      } catch (error) {
        console.error('presenceExchange_ failed: ' + error);
      }
    }
  }
  return { presence: readPresence_(env, worldId), saved: saved };
}

/** ページを開いている PC を記録し、そのワールドの一覧を返す。presence の形が違えば VALIDATION */
function actionPresence_(req, env) {
  var worldId = ownedWorldId(req.worldId);
  if (!worldId) return validationFailure_('worldId', 'INVALID_WORLD');
  if (!cleanPresenceInput(req.presence)) return validationFailure_('presence', 'INVALID_PRESENCE');
  var result = presenceExchange_(env, worldId, req.presence);
  return { presence: result.presence, saved: result.saved, serverTime: new Date().toISOString() };
}
