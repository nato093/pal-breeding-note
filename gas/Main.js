/**
 * パル配合ノート API（GAS Web App）の入口。
 *
 * すべての応答を JSON で返す。例外時に GAS 既定の HTML エラーページが返ると、
 * ブラウザでは原因の読めない CORS エラーになるため、必ず try/catch で JSON 化する。
 *
 * @OnlyCurrentDoc
 */

var API_VERSION = 1;
var MAX_BODY_CHARS = 16 * 1024;
// 所持パルのアップロード（1 ワールド分の全個体）だけは大きい本文を受ける
var MAX_UPLOAD_CHARS = 4 * 1024 * 1024;

function doGet() {
  // データは返さない（パスワード付きの POST だけがデータに触れる）
  return jsonOut_({ ok: true, service: 'pal-breeding-note', api: API_VERSION });
}

function doPost(e) {
  var body = e && e.postData ? e.postData.contents : '';
  return jsonOut_(handleRequest_(body));
}

function handleRequest_(body) {
  // 認証の後の失敗の応答にも env を付ける（サーバーの PC の常駐が、失敗の応答でも違う環境に送っていると気づけるように。画面は失敗の env を読まない）
  var env = '';
  try {
    if (typeof body !== 'string' || body.length === 0) return fail_('BAD_REQUEST');
    // 所持パルのアップロード以外は、読む前に大きさで断る
    if (body.length > MAX_UPLOAD_CHARS || (body.length > MAX_BODY_CHARS && body.indexOf('"ownedUpload"') === -1)) return fail_('TOO_LARGE');

    var req;
    try {
      req = JSON.parse(body);
    } catch (parseError) {
      return fail_('BAD_JSON');
    }
    if (!req || typeof req !== 'object' || Array.isArray(req)) return fail_('BAD_REQUEST');
    if (req.action !== 'ownedUpload' && body.length > MAX_BODY_CHARS) return fail_('TOO_LARGE');

    var auth = authenticate_(req.passcode);
    if (!auth.ok) return fail_(auth.code);
    env = auth.env;

    var actions = actions_();
    if (typeof req.action !== 'string' || !Object.prototype.hasOwnProperty.call(actions, req.action)) {
      return withEnv_(fail_('BAD_ACTION'), env);
    }
    var action = actions[req.action];
    if (action.testOnly && auth.env !== 'test') return withEnv_(fail_('FORBIDDEN'), env);

    var result = action.run(req, auth.env);
    if (result.ok === false) return withEnv_(result, env);
    return Object.assign({ ok: true, env: auth.env, api: API_VERSION }, result);
  } catch (err) {
    if (err && (err.code === 'BUSY' || err.code === 'SHEET_HEADER')) return withEnv_(fail_(err.code), env);
    // リクエスト本文（パスワードを含む）はログに出さない
    console.error('handleRequest_ failed: ' + (err && err.stack ? err.stack : err));
    return withEnv_(fail_('INTERNAL'), env);
  }
}

function fail_(code) {
  return { ok: false, code: code };
}

// 失敗の応答に、認証した環境を足す（認証の前の失敗〔env が空〕はそのまま。どの環境か分からない）
function withEnv_(response, env) {
  return env ? Object.assign({}, response, { env: env }) : response;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
