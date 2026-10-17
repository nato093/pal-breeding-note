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
function setup(t, state = hostState(), { selfUids } = {}) {
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
  const part = saveStatus({ owned, autoRegister, store, now: () => NOW, ...(selfUids ? { selfUids } : {}) });
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
  // 「設定を開く」は設定のセーブ連携の状態の欄（許可・今すぐ読み込む。router.js の settingsHash の 'status'。前は設定の先頭 '#/settings'）
  assert.equal(panel.querySelector('a').href, `#/settings?world=${'A'.repeat(32)}&open=status`);
  const reload = panel.querySelectorAll('button').find((node) => node.textContent === '今すぐ読み込む');
  await reload.dispatch('click');
  assert.deepEqual(log, [['refreshAuto', { enable: true }]]);
  // 開いている間に状態が変わっても閉じない（同じパネル・同じボタン）
  emit({ auto: { enabled: true, status: 'permission', worlds: [{ id: 'W1' }], error: '許可が必要です' } });
  assert.equal(part.element.querySelector('.save-status-panel'), panel);
  // 読んでいる登録のワールドが分かれば、そのワールドを渡す（開いている間も書き換える）
  emit({ linkedWorldId: 'C'.repeat(32) });
  assert.equal(panel.querySelector('a').href, `#/settings?world=${'C'.repeat(32)}&open=status`);
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

test('ヘッダーのセーブ連携（autoreg-visibility）: 許可切れは permissionNotice の短い文・止まった時刻・「毎回のアクセスを許可」の勧めをポップオーバーに出す', async (t) => {
  const stoppedAt = new Date(NOW - 28 * 60 * 1000).toISOString();
  const { trigger, part } = setup(t, hostState({ auto: { enabled: true, status: 'permission', worlds: [{ id: 'W1' }], error: '古い長い文', stoppedAt } }));
  assert.equal(trigger.title, 'セーブを読む許可が必要です（押すと許可を求めます）');
  // 許可が要るときに押すと許可を求めるので、ポップオーバーは model を直接見る
  const { saveStatusModel } = await import('../../web/js/ui/save-status.js');
  assert.equal(saveStatusModel(hostState({ auto: { enabled: true, status: 'permission', worlds: [{ id: 'W1' }], error: '古い長い文', stoppedAt } }), { now: NOW }).text, '許可が必要');
  part.destroy();
});

// パル次元ストレージの読み漏れ（dps-missing）
const BOB = '00000000-0000-0000-0000-000000000002';
const HOST_GAP = 'Level.sav ではパル次元ストレージに 118 体いますが、27 体を読めていません。Players\\00000000000000000000000000000002_dps.sav（Bob）が登録されていないかもしれません。';
const GUEST_GAP = 'パル次元ストレージの 27 体が出ていません。ホストの登録にあなたの Players\\00000000000000000000000000000002_dps.sav がないかもしれません。ホストに足してもらってください。';
const gapHost = (stats = { inLocker: 118, inLockerMissing: 27 }) => hostState({
  data: { source: 'handles', snapshot: {
    files: { used: ['Level.sav', 'Players/00000000000000000000000000000001.sav', 'Players/00000000000000000000000000000001_dps.sav', 'Players/00000000000000000000000000000002.sav'], skipped: [] },
    players: [{ uid: '00000000-0000-0000-0000-000000000001', name: '自分', level: 50 }, { uid: BOB, name: 'Bob', level: 40 }], stats,
  } },
});
const gapGuest = () => guestState({ owned: { pals: [{}, {}], players: [{ uid: BOB, name: 'Bob', level: 40, dpsGap: 27 }] } });

test('ヘッダーのセーブ連携（dps-missing）: パル次元ストレージの読み漏れは、押す前の説明とポップオーバーの困りごとに所持パルの案内と同じ文で出す（チップの色は変えない）', async (t) => {
  const host = model(gapHost());
  assert.equal(host.tone, 'ok');
  assert.ok(host.title.split('\n').includes(HOST_GAP));
  // 読み漏れがない・数のない古い stats では出さない
  assert.equal(model(gapHost({ inLocker: 118, inLockerMissing: 0 })).title.includes('次元ストレージ'), false);
  assert.equal(model(gapHost({})).title.includes('次元ストレージ'), false);
  // 参加者は自分が候補のときだけ
  assert.ok(model(gapGuest(), { selfUids: new Set([BOB]) }).title.split('\n').includes(GUEST_GAP));
  assert.equal(model(gapGuest(), { selfUids: new Set(['other']) }).title.includes('次元ストレージ'), false);
  assert.equal(model(gapGuest()).title.includes('次元ストレージ'), false);

  const { trigger, part } = setup(t, gapHost());
  await trigger.dispatch('click');
  const issues = part.element.querySelector('.save-status-issues');
  assert.equal(issues.hidden, false);
  assert.deepEqual(issues.querySelectorAll('li').map((node) => node.textContent), [HOST_GAP]);
  part.destroy();
});

test('ヘッダーのセーブ連携（dps-missing）: 参加者の困りごとには、自分のプレイヤー（selfUids。app.js は ideals.selfUids）が候補のときだけ出す', async (t) => {
  const mine = setup(t, gapGuest(), { selfUids: () => new Set([BOB]) });
  await mine.trigger.dispatch('click');
  assert.deepEqual(mine.part.element.querySelector('.save-status-issues').querySelectorAll('li').map((node) => node.textContent), [GUEST_GAP]);
  assert.ok(mine.trigger.title.split('\n').includes(GUEST_GAP));
  mine.part.destroy();
});

test('ヘッダーのセーブ連携（dps-missing）: 自分が候補でない参加者には出さない', async (t) => {
  const other = setup(t, gapGuest());
  await other.trigger.dispatch('click');
  assert.equal(other.part.element.querySelector('.save-status-issues').hidden, true);
  other.part.destroy();
});

test('セーブ連携の状態（share-upload）: 同じセーブが共有済みは、押す前の説明とパネルの「共有」の行に出す（チップの色は変えない）', async (t) => {
  const state = hostState({
    local: { world: { signature: 'sig-1' } },
    upload: { status: 'same', at: at(2), error: '', worldId: 'A'.repeat(32), result: 'unchanged', signature: 'sig-1', stamp: '638650000000000001', published: { saveStamp: '638650000000000001', uploadedBy: 'Alice', uploadedAt: at(2) } },
  });
  const result = model(state);
  assert.equal(result.tone, 'ok');
  assert.match(result.title, /同じセーブが共有済み（Alice の PC から）/);
  // 前のセーブを送った結果は出さない
  assert.doesNotMatch(model({ ...state, local: { world: { signature: 'sig-2' } } }).title, /共有済み/);
  const { trigger, part } = setup(t, state);
  await trigger.dispatch('click');
  const panel = part.element.querySelector('.save-status-panel');
  assert.match(panel.textContent, /共有同じセーブが共有済み（Alice の PC から）/);
  assert.equal(part.element.querySelector('.save-status-issues').hidden, true);
  part.destroy();
});

test('ヘッダーのセーブ連携（save-watch）: パネルの「監視」の行に見張りの方式と最後の保存を出す（自動の読み込みが有効で登録があるときだけ）', async (t) => {
  const lastSave = { at: new Date(2026, 9, 12, 9, 28, 30).toISOString(), files: 7, spanMs: 800 };
  const { trigger, part, emit } = setup(t, hostState({ watch: { mode: 'observer', lastSave } }));
  await trigger.dispatch('click');
  const panel = part.element.querySelector('.save-status-panel');
  assert.match(panel.textContent, /監視ファイルの変更 · 最後の保存 09:28:30（7 ファイル・0\.8 秒）/);
  emit({ watch: { mode: 'poll', lastSave: null } });
  assert.match(panel.textContent, /監視5 秒ごとの確認/);
  assert.doesNotMatch(panel.textContent, /最後の保存/);
  emit({ watch: { mode: 'timer', lastSave: null } });
  assert.match(panel.textContent, /監視定期の確認（タブが裏だと 1 分ごと）/);
  // 見張っていない・自動の読み込みが無効なときは出さない
  emit({ watch: { mode: '', lastSave: null } });
  assert.doesNotMatch(panel.textContent, /監視/);
  emit({ watch: { mode: 'observer', lastSave }, auto: { enabled: false, status: 'off', worlds: [], worldId: '', error: '' } });
  assert.doesNotMatch(panel.textContent, /監視/);
  part.destroy();
  // 違う日の保存は日付も出す。state.watch のない古い形でも落ちない
  const { watchSummary } = await import('../../web/js/ui/owned-status.js');
  const yesterday = { at: new Date(2026, 9, 11, 23, 59, 5).toISOString(), files: 1, spanMs: 0 };
  assert.equal(watchSummary(hostState({ watch: { mode: 'poll', lastSave: yesterday } }), { now: () => NOW }), '5 秒ごとの確認 · 最後の保存 10/11 23:59:05（1 ファイル・0.0 秒）');
  assert.equal(watchSummary(hostState(), { now: () => NOW }), '');
});

// ---- ホストの交代（sync-fixes の host-rotation） ----
const GUEST_WORLD = 'B'.repeat(32);
// 直近に 30 秒ごとの変化を 2 回見た記録（owned.js の state.play）
const playing = (worldId = GUEST_WORLD, role = 'guest') => ({ worldId, role, value: 60000, changes: [{ at: NOW - 40000, gap: 30000 }, { at: NOW - 10000, gap: 30000 }] });
const checkedNow = { worlds: [], current: null, fetchedAt: at(0), fetchedWorldId: GUEST_WORLD, error: '' };
// ゲーム中の参加者。共有は今確かめ、共有のセーブは 20 分前（guestState）
const lagging = (overrides = {}) => guestState({ linkedWorldId: GUEST_WORLD, play: playing(), shared: checkedNow, ...overrides });

test('セーブ連携の状態（host-rotation）: 参加者がゲーム中なのに共有が止まっていれば、チップを警告にして「共有が止まっています」（送れない・読めないの警告より後、共有待ちより前）', () => {
  const stopped = model(lagging());
  assert.deepEqual([stopped.tone, stopped.text, stopped.action], ['warn', '共有が止まっています', null]);
  assert.match(stopped.title, /^ゲーム中のようですが、共有は 20 分前のセーブのままです。今のホストの PC でこのページが開いているか確かめてください/);
  // 共有がないときも（共有待ちより前）
  const none = model(lagging({ meta: { worldId: GUEST_WORLD, worldName: '', hostName: '' } }));
  assert.deepEqual([none.tone, none.text], ['warn', '共有が止まっています']);
  assert.match(none.title, /このワールドはまだ共有されていません/);
  // ゲーム中でない・共有を最近確かめていない・共有が新しいときは今までどおり
  assert.equal(model(lagging({ play: null })).text, '「仲間の島」· 共有 09:20');
  assert.equal(model(lagging({ shared: { ...checkedNow, fetchedAt: at(2) } })).text, '「仲間の島」· 共有 09:20');
  assert.equal(model(lagging({ meta: { ...guestState().meta, saveUpdatedAt: at(1) } })).tone, 'ok');
  assert.equal(model(lagging({ play: null, meta: { worldId: GUEST_WORLD, worldName: '', hostName: '' } })).text, '共有待ち');
  // 送れない警告の方が先
  assert.equal(model(lagging({ upload: { status: 'error', at: '', error: '通信できません', worldId: '' } })).text, '共有できません');
  // 共有を確かめたのが別のワールド（今のワールドを確かめていない）なら出さない（Codex のレビュー）
  assert.equal(model(lagging({ shared: { ...checkedNow, fetchedWorldId: 'C'.repeat(32) } })).text, '「仲間の島」· 共有 09:20');
});

test('ヘッダーのセーブ連携（host-rotation）: 共有が止まっている案内はパネルの困りごとにも同じ文で出し、「ゲーム」の行に参加中（推定）', async (t) => {
  const { trigger, part } = setup(t, lagging());
  assert.equal(trigger.textContent, '共有が止まっています');
  assert.equal(trigger.className, 'save-status-button tone-warn');
  await trigger.dispatch('click');
  const panel = part.element.querySelector('.save-status-panel');
  const issues = part.element.querySelector('.save-status-issues').querySelectorAll('li').map((node) => node.textContent);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^ゲーム中のようですが、共有は 20 分前のセーブのままです。/);
  assert.match(panel.textContent, /ゲーム参加中（推定）/);
  part.destroy();
});

test('ヘッダーのセーブ連携（host-rotation）: パネルの「ゲーム」の行は、ホストならホスト中（推定）とホスト用のセーブあり（保存が続けて見えていない）を分ける', async (t) => {
  const world = 'A'.repeat(32);
  const { trigger, part, emit } = setup(t, hostState({ linkedWorldId: world, play: playing(world, 'host') }));
  await trigger.dispatch('click');
  const panel = part.element.querySelector('.save-status-panel');
  assert.match(panel.textContent, /ゲームホスト中（推定）/);
  emit({ play: { worldId: world, role: 'host', value: 1, changes: [] } });
  assert.match(panel.textContent, /ゲームホスト用のセーブあり（ゲームの保存は続けて見えていません）/);
  // ホストのチップは変えない
  assert.equal(trigger.className, 'save-status-button tone-ok');
  part.destroy();
});
