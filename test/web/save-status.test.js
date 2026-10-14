import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import { saveStatusModel, saveStatus, STALE_LOCAL_MS, STALE_SHARED_MS } from '../../web/js/ui/save-status.js';

const NOW = new Date(2026, 9, 12, 9, 30).getTime();
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60 * 1000).toISOString();

// owned.state の形（owned.js の createOwnedStore と同じ項目）
function ownedState(overrides = {}) {
  return {
    ready: true, busy: false, progress: '', error: '',
    auto: { enabled: false, status: 'off', worlds: [], worldId: '', error: '' },
    role: '', linkedWorldId: '',
    shared: { worlds: [], current: null, fetchedAt: '', error: '' },
    upload: { status: '', at: '', error: '', worldId: '' },
    data: null, owned: null, meta: null,
    ...overrides,
  };
}
const hostState = (overrides = {}) => ownedState({
  role: 'host',
  auto: { enabled: true, status: 'ready', worlds: [{ id: 'W1' }], worldId: '', error: '' },
  meta: { worldId: 'A'.repeat(32), worldName: 'もふもふ', hostName: '自分', source: 'local', saveUpdatedAt: at(3), importedAt: at(1), sharedAt: at(1), uploadedBy: '自分', palCount: 3 },
  owned: { pals: [{}, {}, {}] },
  ...overrides,
});
const guestState = (overrides = {}) => ownedState({
  role: 'guest',
  meta: { worldId: 'B'.repeat(32), worldName: '仲間の島', hostName: 'ホスト', source: 'shared', saveUpdatedAt: at(20), importedAt: '', sharedAt: at(10), uploadedBy: 'ホスト', palCount: 2 },
  ...overrides,
});
const model = (state, options = {}) => saveStatusModel(state, { now: NOW, ...options });

test('セーブ連携の状態: 上の行ほど優先して、状態ごとの文・色・押したときの動きを決める', () => {
  const cases = [
    ['未確認', ownedState({ ready: false }), 'busy', '所持パルを確認中…', null],
    ['許可が必要', hostState({ auto: { enabled: true, status: 'permission', worlds: [{ id: 'W1' }], error: '許可が必要です' }, upload: { status: 'error', error: '失敗' } }), 'warn', '許可が必要', 'grant'],
    ['読めない', hostState({ auto: { enabled: true, status: 'error', worlds: [], error: '「島」を読めません' } }), 'warn', 'セーブを読めません', null],
    ['ファイルがない', ownedState({ auto: { enabled: true, status: 'empty', worlds: [], error: '登録されていません' } }), 'warn', 'セーブを読めません', null],
    ['共有できない', hostState({ upload: { status: 'error', at: '', error: '通信できません', worldId: '' } }), 'warn', '共有できません', null],
    ['共有を読めない', ownedState({ shared: { worlds: [], current: null, fetchedAt: '', error: '接続できません' } }), 'warn', '共有を読めません', null],
    ['データなし', ownedState(), 'none', 'セーブ未連携', null],
    ['参加者の共有待ち', ownedState({ role: 'guest', meta: { worldId: 'B'.repeat(32), worldName: '', hostName: '' } }), 'none', '共有待ち', null],
  ];
  for (const [name, state, tone, text, action] of cases) {
    const result = model(state);
    assert.equal(result.tone, tone, name);
    assert.equal(result.text, text, name);
    assert.equal(result.action, action, name);
  }
  // 自動の読み込みがオフなら、止まっている理由（status）があっても警告にしない
  assert.equal(model(ownedState({ auto: { enabled: false, status: 'permission', worlds: [], error: '' } })).tone, 'none');
  // 共有のデータを出しているなら、共有の読み直しの失敗は警告にしない
  assert.equal(model(guestState({ shared: { worlds: [], current: null, fetchedAt: '', error: '接続できません' } })).tone, 'ok');
});

test('セーブ連携の状態: ホストはワールド名・セーブの時刻・自動登録のオンとオフ、参加者は共有の時刻を出す', () => {
  const host = model(hostState(), { autoEnabled: (worldId) => worldId === 'A'.repeat(32) });
  assert.equal(host.tone, 'ok');
  assert.equal(host.text, '「もふもふ」· セーブ 09:27 · 自動登録 オン');
  assert.deepEqual([host.world, host.time, host.auto], ['「もふもふ」', 'セーブ 09:27', '自動登録 オン']);
  assert.match(host.title, /「もふもふ」（ホスト 自分）/);
  assert.match(host.title, /セーブの更新: 10\/12 09:27/);
  assert.equal(model(hostState(), { autoEnabled: () => false }).auto, '自動登録 オフ');
  // 役割が分からない（ホストと判定できない）ときは、自動登録を出さない
  assert.equal(model(hostState({ role: '' })).auto, '');
  const guest = model(guestState());
  assert.equal(guest.tone, 'ok');
  assert.equal(guest.text, '「仲間の島」· 共有 09:20');
  // 名前のないワールドは ID の先頭 8 字
  assert.equal(model(guestState({ meta: { ...guestState().meta, worldName: '' } })).world, 'ワールド BBBBBBBB');
});

test('セーブ連携の状態: 今日なら 時:分、違う日なら 月/日 時:分', () => {
  const yesterday = new Date(2026, 9, 11, 23, 5).toISOString();
  assert.equal(model(hostState({ meta: { ...hostState().meta, saveUpdatedAt: yesterday } })).time, 'セーブ 10/11 23:05');
  assert.equal(model(guestState({ meta: { ...guestState().meta, sharedAt: yesterday } })).time, '共有 10/11 23:05');
  assert.equal(model(hostState({ meta: { ...hostState().meta, saveUpdatedAt: '' } })).time, 'セーブ 不明');
});

test('セーブ連携の状態: 自動の読み込みが止まった手元のデータ・古い共有のデータは、文はそのまま点を灰色にする', () => {
  const minutes = STALE_LOCAL_MS / 60000;
  const fresh = hostState({ meta: { ...hostState().meta, importedAt: at(minutes - 1) } });
  assert.equal(model(fresh).tone, 'ok');
  const old = model(hostState({ meta: { ...hostState().meta, importedAt: at(minutes + 1) } }));
  assert.equal(old.tone, 'stale');
  assert.equal(old.text, model(fresh).text);
  assert.match(old.title, /最後に読み込んだのは/);
  // 自動の読み込みがオフなら、手元のデータが古くても印を付けない（読み直さないので）
  assert.equal(model(hostState({ auto: { enabled: false, status: 'off', worlds: [], error: '' }, meta: { ...hostState().meta, importedAt: at(90) } })).tone, 'ok');
  const sharedMinutes = STALE_SHARED_MS / 60000;
  assert.equal(model(guestState({ meta: { ...guestState().meta, sharedAt: at(sharedMinutes - 1) } })).tone, 'ok');
  const oldShared = model(guestState({ meta: { ...guestState().meta, sharedAt: at(sharedMinutes + 1) } }));
  assert.equal(oldShared.tone, 'stale');
  assert.match(oldShared.title, /最後に共有されたのは/);
});

test('セーブ連携の状態: 読み込み中は busy の印だけを付ける', () => {
  assert.equal(model(hostState({ busy: true })).busy, true);
  assert.equal(model(hostState({ auto: { enabled: true, status: 'checking', worlds: [{ id: 'W1' }], error: '' } })).busy, true);
  assert.equal(model(hostState()).busy, false);
});

// ヘッダーの部品を、偽の owned・autoRegister・store で作る
function setup(t, state = hostState()) {
  const dom = installDom(t);
  const listeners = { owned: new Set(), store: new Set(), auto: new Set() };
  const subscribe = (set) => (listener) => { set.add(listener); return () => set.delete(listener); };
  const log = [];
  let enabled = true;
  const owned = {
    state,
    subscribe: subscribe(listeners.owned),
    grantAndRefresh() { log.push('grant'); return Promise.resolve({ granted: 1, total: 1 }); },
    refreshAuto(options) { log.push(['refreshAuto', options]); return Promise.resolve('ok'); },
  };
  const autoRegister = { enabled: () => enabled, subscribe: subscribe(listeners.auto) };
  const store = { state: {}, subscribe: subscribe(listeners.store) };
  const part = saveStatus({ owned, autoRegister, store, now: () => NOW });
  dom.body.append(part.element);
  const trigger = part.element.querySelector('.save-status-button');
  const emit = (patch = {}) => {
    Object.assign(owned.state, patch);
    for (const listener of listeners.owned) listener(owned.state);
  };
  return { ...dom, part, owned, trigger, emit, log, listeners, autoRegister, setEnabled(on) { enabled = on; for (const listener of listeners.auto) listener(); } };
}

test('ヘッダーのセーブ連携: 状態が変わっても同じボタンの文字とクラスだけを書き換える', (t) => {
  const { part, trigger, emit, setEnabled } = setup(t);
  assert.equal(trigger.textContent, '「もふもふ」· セーブ 09:27 · 自動登録 オン');
  assert.equal(trigger.className, 'save-status-button tone-ok');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
  const parts = part.element.querySelectorAll('span');
  // 自動登録の設定の変化でも書き換える
  setEnabled(false);
  assert.equal(trigger.textContent, '「もふもふ」· セーブ 09:27 · 自動登録 オフ');
  emit({ upload: { status: 'error', at: '', error: '通信できません', worldId: '' } });
  assert.equal(part.element.querySelector('.save-status-button'), trigger);
  const after = part.element.querySelectorAll('span');
  assert.ok(after.length === parts.length && after.every((node, index) => node === parts[index]));
  assert.equal(trigger.textContent, '共有できません');
  assert.equal(trigger.className, 'save-status-button tone-warn');
  assert.match(trigger.title, /通信できません/);
  // 名前を出さないときは、区切りも出さない
  assert.equal(part.element.querySelector('.save-status-world').textContent, '');
  assert.equal(part.element.querySelectorAll('.save-status-sep').map((node) => node.textContent).join(''), '');
});

test('ヘッダーのセーブ連携: 読み込み中は前の文（警告も）を残し、点の印と title の進み具合だけを足す', (t) => {
  const { trigger, emit } = setup(t, hostState({ auto: { enabled: true, status: 'permission', worlds: [{ id: 'W1' }], error: '許可が必要です' } }));
  assert.equal(trigger.textContent, '許可が必要');
  emit({ busy: true, progress: 'セーブを読み込み中…', auto: { enabled: true, status: 'checking', worlds: [{ id: 'W1' }], error: '' } });
  assert.equal(trigger.textContent, '許可が必要');
  assert.equal(trigger.className, 'save-status-button tone-warn is-busy');
  assert.match(trigger.title, /^セーブを読み込み中…/);
  emit({ busy: false, progress: '', auto: { enabled: true, status: 'ready', worlds: [{ id: 'W1' }], error: '' } });
  assert.equal(trigger.textContent, '「もふもふ」· セーブ 09:27 · 自動登録 オン');
  assert.equal(trigger.className, 'save-status-button tone-ok');
});

test('ヘッダーのセーブ連携: 許可が要るときは、クリックの処理の中で await を挟まずに許可を求める', async (t) => {
  const { trigger, log, part } = setup(t, hostState({ auto: { enabled: true, status: 'permission', worlds: [{ id: 'W1' }], error: '許可が必要です' } }));
  assert.equal(trigger.getAttribute('aria-haspopup'), null);
  const clicking = trigger.dispatch('click');
  // dispatch はハンドラーを同期で呼び始めるので、await の前に呼ばれていればここで記録がある
  assert.deepEqual(log, ['grant']);
  await clicking;
  assert.equal(part.element.querySelector('.save-status-panel'), null);
});

test('ヘッダーのセーブ連携: 押すとポップオーバーを開き、開いている間の更新では閉じずに文だけ書き換える', async (t) => {
  const { trigger, part, emit, events, body, log } = setup(t);
  assert.equal(part.element.querySelector('.save-status-panel'), null);
  await trigger.dispatch('click');
  const panel = part.element.querySelector('.save-status-panel');
  assert.ok(panel);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.match(panel.textContent, /この PC.*ホスト/);
  assert.match(panel.textContent, /表示中「もふもふ」（ホスト 自分） · 3 体/);
  const buttons = () => panel.querySelectorAll('button').filter((node) => !node.hidden).map((node) => node.textContent);
  assert.deepEqual(buttons(), ['今すぐ読み込む']);
  // 「設定を開く」は設定のセーブ連携（表示しているワールドの行を開いてフォーカス。router.js の settingsHash。前は設定の先頭 '#/settings'）
  assert.equal(panel.querySelector('a').href, `#/settings?world=${'A'.repeat(32)}&open=auto`);
  const reload = panel.querySelectorAll('button').find((node) => node.textContent === '今すぐ読み込む');
  await reload.dispatch('click');
  assert.deepEqual(log, [['refreshAuto', { enable: true }]]);
  // 開いている間に状態が変わっても閉じない（同じパネル・同じボタン）
  emit({ auto: { enabled: true, status: 'permission', worlds: [{ id: 'W1' }], error: '許可が必要です' } });
  assert.equal(part.element.querySelector('.save-status-panel'), panel);
  // 読んでいる登録のワールドが分かれば、その行へ（開いている間も書き換える）
  emit({ linkedWorldId: 'C'.repeat(32) });
  assert.equal(panel.querySelector('a').href, `#/settings?world=${'C'.repeat(32)}&open=auto`);
  assert.equal(panel.querySelectorAll('button').find((node) => node.textContent === '今すぐ読み込む'), reload);
  assert.deepEqual(buttons(), ['読み込みを許可', '今すぐ読み込む']);
  assert.match(panel.textContent, /許可が必要です/);
  // 許可のボタンもクリックの中で求める
  const grant = panel.querySelectorAll('button').find((node) => node.textContent === '読み込みを許可');
  const granting = grant.dispatch('click');
  assert.deepEqual(log.at(-1), 'grant');
  await granting;
  // 外側を押すと閉じ、Esc でも閉じてボタンへ戻る
  await events.dispatch('pointerdown', { target: panel });
  assert.ok(part.element.querySelector('.save-status-panel'));
  await events.dispatch('pointerdown', { target: body });
  assert.equal(part.element.querySelector('.save-status-panel'), null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  emit({ auto: { enabled: true, status: 'ready', worlds: [{ id: 'W1' }], error: '' } });
  await trigger.dispatch('click');
  await events.dispatch('keydown', { key: 'Escape' });
  assert.equal(part.element.querySelector('.save-status-panel'), null);
  assert.equal(document.activeElement, trigger);
  // 「設定を開く」で閉じる（画面の切り替えはリンクに任せる）
  await trigger.dispatch('click');
  await part.element.querySelector('a').dispatch('click');
  assert.equal(part.element.querySelector('.save-status-panel'), null);
});

test('ヘッダーのセーブ連携: destroy で購読を全部外す', (t) => {
  const { part, listeners } = setup(t);
  assert.deepEqual([listeners.owned.size, listeners.store.size, listeners.auto.size], [1, 1, 1]);
  part.destroy();
  assert.deepEqual([listeners.owned.size, listeners.store.size, listeners.auto.size], [0, 0, 0]);
});
