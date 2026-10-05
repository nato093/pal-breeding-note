import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { runningVersion, createVersionWatcher, servedVersion } from '../../web/js/version.js';
import { updateBanner } from '../../web/js/ui/update-banner.js';

const OLD = 'aaaaaaa';
const NEW = 'bbbbbbb';

// fetch を差し替え、要求を記録して responder の結果を返す。
function stubFetch(t, responder) {
  const before = globalThis.fetch;
  t.after(() => { globalThis.fetch = before; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return responder(url, options);
  };
  return requests;
}

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body, text: async () => JSON.stringify(body) });

function watcher(t, responder, options = {}) {
  let time = 1_000_000;
  const updates = [];
  const requests = stubFetch(t, responder);
  const instance = createVersionWatcher({
    current: OLD, bundledNoteIds: ['old-note'], onUpdate: (update) => updates.push(update), now: () => time, ...options,
  });
  return { instance, updates, requests, advance: (ms) => { time += ms; } };
}

test('版: 配信時に付けた ?v= から実行中の版を読む（無い・形式外なら空）', () => {
  assert.equal(runningVersion(`https://example.test/js/version.js?v=${NEW}`), NEW);
  assert.equal(runningVersion('https://example.test/js/version.js'), '');
  assert.equal(runningVersion('https://example.test/js/version.js?v=<script>'), '');
  assert.equal(runningVersion(), '');
});

test('版の監視: 新しい版なら、同梱に無い更新内容の title を付けて知らせる', async (t) => {
  const { instance, updates, requests } = watcher(t, () => json({ version: NEW, notes: [
    { id: 'new-note', title: '新しい機能' }, { id: 'old-note', title: '前からある機能' }, { id: 'long', title: 'あ'.repeat(30) }, { id: 'empty', title: '' },
  ] }));
  await instance.check();
  assert.deepEqual(updates, [{ version: NEW, notes: [{ id: 'new-note', title: '新しい機能' }, { id: 'long', title: `${'あ'.repeat(19)}…` }] }]);
  assert.match(requests[0].url, /^version\.json\?t=\d+$/);
  assert.equal(requests[0].options.cache, 'no-store');
});

test('版の監視: 更新内容を足していない配信でも、版が違えば知らせる。同じ版・知らせた版では知らせない', async (t) => {
  let remote = OLD;
  const { instance, updates, advance } = watcher(t, () => json({ version: remote, notes: [{ id: 'old-note', title: '前からある機能' }] }));
  await instance.check();
  assert.deepEqual(updates, []);
  remote = NEW;
  advance(60_000);
  await instance.check();
  advance(60_000);
  await instance.check();
  assert.deepEqual(updates, [{ version: NEW, notes: [] }]);
});

test('版の監視: 60 秒以内の再確認と、確認中の重ねての確認は飛ばす', async (t) => {
  let release;
  const { instance, requests, advance } = watcher(t, () => new Promise((resolve) => { release = () => resolve(json({ version: OLD })); }));
  // 応答を待っている間は、間隔が空いても重ねて読みに行かない
  const first = instance.check();
  advance(60_000);
  await instance.check();
  assert.equal(requests.length, 1);
  advance(-60_000);
  release();
  await first;
  advance(30_000);
  await instance.check();
  assert.equal(requests.length, 1);
  advance(30_000);
  const third = instance.check();
  release();
  await third;
  assert.equal(requests.length, 2);
});

test('版の監視: 取得できない・形が不正・タイムアウトは無視し、ローカル（版なし）では読みに行かない', async (t) => {
  const responses = [
    () => json({}, false),
    () => ({ ok: true, json: async () => { throw new SyntaxError('JSON ではない'); } }),
    () => json({ version: '../evil' }),
    () => json(null),
    () => { throw new TypeError('通信できない'); },
    (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('中断')))),
  ];
  let index = 0;
  const { instance, updates, requests, advance } = watcher(t, (url, options) => responses[index++](url, options), { timeout: 5 });
  for (let i = 0; i < responses.length; i += 1) {
    await instance.check();
    advance(60_000);
  }
  assert.equal(requests.length, responses.length);
  assert.deepEqual(updates, []);
  const local = watcher(t, () => json({ version: NEW }), { current: '' });
  await local.instance.check();
  assert.equal(local.requests.length, 0);
});

test('配信中の版: ハッシュを除いた今のページを取り直し、埋め込んだ版を読む', async (t) => {
  const requests = stubFetch(t, () => ({ ok: true, text: async () => `<head>\n  <meta name="app-version" content="${NEW}">` }));
  assert.equal(await servedVersion('https://example.test/Pal/?k=1#/settings'), NEW);
  assert.equal(requests[0].url, 'https://example.test/Pal/?k=1');
  assert.equal(requests[0].options.cache, 'reload');
  stubFetch(t, () => ({ ok: true, text: async () => '<head>' }));
  assert.equal(await servedVersion('https://example.test/Pal/'), '');
  stubFetch(t, () => ({ ok: false, status: 503, text: async () => '' }));
  await assert.rejects(servedVersion('https://example.test/Pal/'), /503/);
});

function banner(t, { busy = () => '', served = async () => NEW } = {}) {
  installDom(t);
  const reloads = [];
  const delayed = [];
  const instance = updateBanner({ current: OLD, busy, served, reload: () => reloads.push(true), delay: (action) => delayed.push(action) });
  document.body.append(instance.element);
  const [reloadButton, close] = instance.element.querySelectorAll('button');
  const text = () => instance.element.querySelector('.update-banner-text').textContent;
  return { instance, reloads, delayed, reloadButton, close, text };
}

test('更新の帯: 新しい更新内容の title と件数を出し、読み込み直すと反映されることを伝える', (t) => {
  const { instance, text } = banner(t);
  assert.equal(instance.element.hidden, true);
  assert.equal(instance.element.getAttribute('role'), 'status');
  instance.show({ version: NEW, notes: [{ id: 'a', title: '新しい機能' }, { id: 'b', title: '修正' }] });
  assert.equal(instance.element.hidden, false);
  assert.equal(text(), '新しいバージョンがあります：新しい機能（ほか 1 件）読み込み直すと反映されます。');
  instance.show({ version: 'ccccccc', notes: [] });
  assert.equal(text(), '新しいバージョンがあります読み込み直すと反映されます。');
});

test('更新の帯: 新しい版が配信されていれば読み込み直し、取り消されたらまた押せるようにする', async (t) => {
  const { instance, reloads, delayed, reloadButton } = banner(t);
  instance.show({ version: NEW, notes: [] });
  await reloadButton.dispatch('click');
  assert.equal(reloads.length, 1);
  assert.equal(reloadButton.disabled, true);
  delayed[0]();
  assert.equal(reloadButton.disabled, false);
  assert.equal(reloadButton.textContent, '読み込み直す');
});

test('更新の帯: 保存中・確認中に始まった操作・配信の途中・確認の失敗では読み込み直さない', async (t) => {
  let waiting = '保存中です';
  const busy = banner(t, { busy: () => waiting });
  busy.instance.show({ version: NEW, notes: [] });
  await busy.reloadButton.dispatch('click');
  assert.match(busy.text(), /保存中です/);
  assert.equal(busy.reloads.length, 0);

  // 押したときは空いていたが、配信中の版を確かめている間に操作が始まった
  let calls = 0;
  const started = banner(t, { busy: () => (calls++ ? '読み込み中です' : '') });
  started.instance.show({ version: NEW, notes: [] });
  await started.reloadButton.dispatch('click');
  assert.match(started.text(), /読み込み中です/);
  assert.equal(started.reloads.length, 0);
  assert.equal(started.reloadButton.disabled, false);

  for (const [served, message] of [[async () => OLD, /配信の途中です/], [async () => '', /配信の途中です/], [async () => { throw new Error('x'); }, /確認できませんでした/]]) {
    const view = banner(t, { served });
    view.instance.show({ version: NEW, notes: [] });
    await view.reloadButton.dispatch('click');
    assert.match(view.text(), message);
    assert.equal(view.reloads.length, 0);
    assert.equal(view.reloadButton.disabled, false);
  }
  waiting = '';
});

test('更新の帯: 閉じた版ではもう出さず、さらに新しい版が来たら出す', async (t) => {
  const { instance, close } = banner(t);
  instance.show({ version: NEW, notes: [] });
  await close.dispatch('click');
  assert.equal(instance.element.hidden, true);
  instance.show({ version: NEW, notes: [] });
  assert.equal(instance.element.hidden, true);
  instance.show({ version: 'ccccccc', notes: [] });
  assert.equal(instance.element.hidden, false);
});
