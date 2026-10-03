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

function doGet() {
  // データは返さない（パスコード付きの POST だけがデータに触れる）
  return jsonOut_({ ok: true, service: 'pal-breeding-note', api: API_VERSION });
}

function doPost(e) {
  var body = e && e.postData ? e.postData.contents : '';
  return jsonOut_(handleRequest_(body));
}

function handleRequest_(body) {
  try {
    if (typeof body !== 'string' || body.length === 0) return fail_('BAD_REQUEST');
    if (body.length > MAX_BODY_CHARS) return fail_('TOO_LARGE');

    var req;
    try {
      req = JSON.parse(body);
    } catch (parseError) {
      return fail_('BAD_JSON');
    }
    if (!req || typeof req !== 'object' || Array.isArray(req)) return fail_('BAD_REQUEST');

    var auth = authenticate_(req.passcode);
    if (!auth.ok) return fail_(auth.code);

    var actions = actions_();
    if (typeof req.action !== 'string' || !Object.prototype.hasOwnProperty.call(actions, req.action)) {
      return fail_('BAD_ACTION');
    }
    var action = actions[req.action];
    if (action.testOnly && auth.env !== 'test') return fail_('FORBIDDEN');

    var result = action.run(req, auth.env);
    return Object.assign({ ok: true, env: auth.env, api: API_VERSION }, result);
  } catch (err) {
    if (err && err.code === 'BUSY') return fail_('BUSY');
    // リクエスト本文（パスコードを含む）はログに出さない
    console.error('handleRequest_ failed: ' + (err && err.stack ? err.stack : err));
    return fail_('INTERNAL');
  }
}

function fail_(code) {
  return { ok: false, code: code };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
