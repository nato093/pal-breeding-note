import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import releaseNotes from '../../web/js/release-notes.js';
import { TITLE_MAX, BODY_MAX, NOTIFICATION_KINDS, notificationTime, cleanNotification, groupNotifications, createNotificationStore } from '../../web/js/notifications.js';
import { notificationMenu, openNotificationList } from '../../web/js/ui/notifications.js';

function memoryStorage() {
  const values = new Map();
  return {
    values, fail: false,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (this.fail) throw new Error('QuotaExceededError');
      values.set(key, String(value));
    },
  };
}

function setup({ userId = '自分', passcode = '入力', sources, storage = memoryStorage() } = {}) {
  const store = { state: { userId, passcode } };
  const notifications = createNotificationStore({ store, storage, sources });
  return { store, storage, notifications };
}

test('更新内容のお知らせ: 通知欄に収まる長さで、新しい順に並び、id が重複しない', () => {
  assert.ok(releaseNotes.length > 0);
  const ids = new Set();
  let previous = Infinity;
  for (const note of releaseNotes) {
    assert.match(note.id, /^\S+$/, note.title);
    assert.equal(ids.has(note.id), false, `id が重複しています: ${note.id}`);
    ids.add(note.id);
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/, note.id);
    const time = notificationTime(note.date);
    assert.ok(Number.isFinite(time), note.id);
    assert.ok(time <= previous, `新しい順に並べてください: ${note.id}`);
    previous = time;
    assert.ok(note.title.length > 0 && note.title.length <= TITLE_MAX, `title は ${TITLE_MAX} 字以内: ${note.id}（${note.title.length} 字）`);
    assert.ok((note.body ?? '').length <= BODY_MAX, `body は ${BODY_MAX} 字以内: ${note.id}（${note.body.length} 字）`);
    assert.deepEqual(cleanNotification({ ...note }), { ...note, time, body: note.body ?? '' });
  }
});

test('通知: どの種類の通知も同じ形にそろえ、長すぎる文は省き、壊れた通知は出さない', () => {
  const longTitle = 'あ'.repeat(TITLE_MAX + 5);
  const { notifications } = setup({
    sources: [
      () => [
        { id: 'a', date: '2026-10-01', title: '古い', body: '' },
        { id: 'b', date: '2026-10-03T09:00:00+09:00', title: longTitle, body: 'い'.repeat(BODY_MAX + 1) },
        { id: 'c', date: 'いつか', title: '日付なし' },
        { id: '', date: '2026-10-03', title: 'ID なし' },
        { id: 'd', date: '2026-10-02', title: '\u0007' },
      ],
      () => [
        { id: 'a', date: '2026-10-05', title: '重複' },
        { id: 'e', date: '2026-10-03', title: '同じ日' },
      ],
    ],
  });
  const list = notifications.list();
  assert.deepEqual(list.map((item) => item.id), ['b', 'e', 'a']);
  assert.equal(list[0].title, `${'あ'.repeat(TITLE_MAX - 1)}…`);
  assert.equal(list[0].body.length, BODY_MAX);
});

test('通知（読み戻しの検証）: id が 200 字を超える通知は出さず、href は画面内のハッシュ 300 字までにする', () => {
  const { notifications } = setup({
    sources: [() => [
      { id: 'x'.repeat(201), date: '2026-10-03', title: '長い ID' },
      { id: 'y'.repeat(200), date: '2026-10-03', title: 'ちょうど 200 字' },
      { id: 'long-href', date: '2026-10-02', title: '長いリンク', href: `#/${'a'.repeat(299)}` },
      { id: 'href', date: '2026-10-02', title: 'リンク', href: `#/${'a'.repeat(298)}` },
      { id: 'outside', date: '2026-10-01', title: '外のリンク', href: 'https://example.com/' },
    ]],
  });
  const list = notifications.list();
  assert.deepEqual(list.map((item) => item.id), ['y'.repeat(200), 'long-href', 'href', 'outside']);
  assert.deepEqual(list.map((item) => item.href?.length ?? 0), [0, 0, 300, 0]);
});

test('通知（読み戻しの検証）: 既読の ID は 2,000 件まで（新しく足した末尾の方を残す）、長すぎる ID と文字列でない値は無視する', () => {
  const storage = memoryStorage();
  const key = 'pal-note.notifications.read.自分';
  const ids = releaseNotes.map((note) => `release:${note.id}`);
  // 古い既読 3,000 件の後に、いちばん新しい更新内容の既読がある
  storage.values.set(key, JSON.stringify([...Array.from({ length: 3000 }, (_, i) => `old:${i}`), 5, null, 'z'.repeat(201), ids[0]]));
  const { notifications } = setup({ storage });
  assert.equal(notifications.unread().some((item) => item.id === ids[0]), false);
  notifications.markRead([ids[1]]);
  const saved = JSON.parse(storage.values.get(key));
  assert.equal(saved.length, 2000);
  assert.deepEqual(saved.slice(-2), [ids[0], ids[1]]);
  assert.equal(saved.includes('old:1001'), false);
  assert.equal(saved.includes('old:1002'), true);
});

test('通知: 未読は ID ごとにこの端末に残し、ログアウト中は数えない', () => {
  const { storage, notifications } = setup();
  const ids = releaseNotes.map((note) => `release:${note.id}`);
  assert.deepEqual(notifications.unread().map((item) => item.id), ids);
  let changes = 0;
  notifications.subscribe(() => { changes += 1; });
  notifications.markRead(ids.slice(0, 1));
  assert.deepEqual(notifications.unread().map((item) => item.id), ids.slice(1));
  assert.deepEqual(JSON.parse(storage.values.get('pal-note.notifications.read.自分')), ids.slice(0, 1));
  notifications.markRead(ids.slice(0, 1));
  assert.equal(changes, 1);
  assert.equal(setup({ storage }).notifications.unread().length, ids.length - 1);
  assert.equal(setup({ storage, userId: '仲間' }).notifications.unread().length, ids.length);
  assert.deepEqual(setup({ storage, passcode: '' }).notifications.unread(), []);
});

test('通知: 別のタブの既読を消さずに足し、保存できなくても開いている間は既読にする', () => {
  const { storage, notifications } = setup();
  const key = 'pal-note.notifications.read.自分';
  const [first, second, third] = releaseNotes.map((note) => `release:${note.id}`);
  notifications.unread();
  storage.values.set(key, JSON.stringify([first]));
  notifications.markRead([second]);
  assert.deepEqual(JSON.parse(storage.values.get(key)), [first, second]);
  storage.values.set(key, JSON.stringify([first, second, third]));
  notifications.reload(key);
  assert.equal(notifications.unread().some((item) => item.id === third), false);
  storage.values.set(key, '壊れた値');
  notifications.reload(key);
  assert.equal(notifications.unread().length, releaseNotes.length);
  storage.fail = true;
  notifications.markRead([first]);
  assert.equal(notifications.unread().some((item) => item.id === first), false);
});

test('ベル: 未読の数を出し、外側を押すか Esc で閉じる', async (t) => {
  const { body, events } = installDom(t);
  const many = Array.from({ length: 120 }, (_, index) => ({ id: `n${index}`, date: '2026-10-04', title: `通知${index}` }));
  const { notifications } = setup({ sources: [() => many] });
  const menu = notificationMenu(notifications);
  body.append(menu.element);
  const [trigger] = menu.element.children;
  const badge = menu.element.querySelector('.notification-badge');
  assert.equal(badge.textContent, '99+');
  await trigger.dispatch('click');
  assert.equal(menu.element.querySelectorAll('.notification-item').length, 120);
  assert.equal(badge.hidden, true);
  await events.dispatch('pointerdown', { target: trigger });
  assert.ok(menu.element.querySelector('.notification-panel'));
  await events.dispatch('pointerdown', { target: body });
  assert.equal(menu.element.querySelector('.notification-panel'), null);
  await trigger.dispatch('click');
  await events.dispatch('keydown', { key: 'Escape' });
  assert.equal(menu.element.querySelector('.notification-panel'), null);
  assert.equal(document.activeElement, trigger);
  many.push({ id: 'new', date: '2026-10-05', title: '新しい通知' });
  menu.update();
  assert.equal(badge.textContent, '1');
  await trigger.dispatch('click');
  assert.equal(menu.element.querySelector('.notification-title').tagName, 'strong');
  menu.close();
  assert.equal(menu.element.querySelector('.notification-panel'), null);
});

test('通知: 開く先は画面内のハッシュだけを残す', () => {
  const { notifications } = setup({ sources: [() => [
    { id: 'a', date: '2026-10-04', title: '画面内', href: '#/reverse?c=MoonQueen' },
    { id: 'b', date: '2026-10-03', title: '外部', href: 'https://example.com/' },
    { id: 'c', date: '2026-10-02', title: 'スクリプト', href: 'javascript:alert(1)' },
  ]] });
  assert.deepEqual(notifications.list().map((item) => item.href), ['#/reverse?c=MoonQueen', undefined, undefined]);
});

const linked = () => [
  { id: 'a', date: '2026-10-04', title: '作れる', href: '#/reverse?c=MoonQueen' },
  { id: 'b', date: '2026-10-03', title: 'お知らせ' },
  { id: 'c', date: '2026-10-02', title: '消える通知' },
];
const titles = (node) => node.querySelectorAll('.notification-title').map((title) => title.textContent);

test('ベル: 開いている間に元が消えた通知を外し、開く先のある通知を押すと閉じる', async (t) => {
  const { body } = installDom(t);
  const items = linked();
  const { notifications } = setup({ sources: [() => items] });
  const menu = notificationMenu(notifications);
  body.append(menu.element);
  await menu.element.children[0].dispatch('click');
  const panel = menu.element.querySelector('.notification-panel');
  assert.deepEqual(titles(panel), ['作れる', 'お知らせ', '消える通知']);
  assert.equal(panel.querySelectorAll('.notification-link').length, 1);
  items.pop();
  notifications.changed();
  assert.deepEqual(titles(panel), ['作れる', 'お知らせ']);
  const link = panel.querySelector('.notification-link');
  assert.equal(link.href, '#/reverse?c=MoonQueen');
  await link.dispatch('click');
  assert.equal(menu.element.querySelector('.notification-panel'), null);
});

test('ベル: 開いている間に通知が全部消えたら、新しい通知がないと出す', async (t) => {
  const { body } = installDom(t);
  const items = linked();
  const { notifications } = setup({ sources: [() => items] });
  const menu = notificationMenu(notifications);
  body.append(menu.element);
  await menu.element.children[0].dispatch('click');
  items.length = 0;
  notifications.changed();
  assert.match(menu.element.querySelector('.notification-panel').textContent, /新しい通知はありません/);
});

test('通知一覧: 開いている間に元が消えた通知を外し、開く先のある通知を押すと閉じる', async (t) => {
  installDom(t);
  const items = linked();
  const { notifications } = setup({ sources: [() => items] });
  notifications.markRead(['b']);
  const modal = openNotificationList(notifications);
  assert.deepEqual(titles(modal.dialog), ['作れる', 'お知らせ', '消える通知']);
  items.pop();
  notifications.changed();
  assert.deepEqual(titles(modal.dialog), ['作れる', 'お知らせ']);
  // 未読の印は開いた時点のまま残す。
  assert.equal(modal.dialog.querySelectorAll('.unread-chip').length, 1);
  await modal.dialog.querySelector('.notification-link').dispatch('click');
  assert.equal(modal.dialog.open, false);
  items.pop();
  notifications.changed();
  assert.deepEqual(titles(modal.dialog), ['作れる', 'お知らせ']);
});

// 自動登録の成功の通知（auto-register.js の registeredNotice と同じ形）
const WORLD = 'ABCDEF0123456789ABCDEF0123456789';
// まとめた行の本文の末尾
const more = (count) => ` ほか ${count} 件`;
const success =(id, body, { batchId = '2026-10-14T01:00:00.000Z', worldId = WORLD, date = batchId } = {}) => ({
  id, date, kind: 'auto-registered', worldId, batchId, title: '配合を自動登録しました', body, href: `#/search?p1=${id}&p2=B`,
});

test('通知: 種類・ワールド・まとめの単位（kind・worldId・batchId）は正しい値だけを残し、ない通知には付けない', () => {
  assert.deepEqual(NOTIFICATION_KINDS, ['auto-registered']);
  const base = { id: 'a', date: '2026-10-14', title: '題名', body: '本文' };
  const time = notificationTime(base.date);
  assert.deepEqual(cleanNotification(base), { ...base, time });
  // ワールド ID は大文字にそろえる
  assert.deepEqual(cleanNotification({ ...base, kind: 'auto-registered', worldId: WORLD.toLowerCase(), batchId: '2026-10-14T01:00:00.000Z' }),
    { ...base, time, kind: 'auto-registered', worldId: WORLD, batchId: '2026-10-14T01:00:00.000Z' });
  for (const wrong of [
    { kind: 'release' }, { kind: 'AUTO-REGISTERED' }, { kind: ['auto-registered'] },
    { worldId: 'W1' }, { worldId: WORLD.slice(1) }, { worldId: `${WORLD}0` }, { worldId: 12 },
    { batchId: '' }, { batchId: '2026 10 14' }, { batchId: '<b>' }, { batchId: 'x'.repeat(65) }, { batchId: 7 },
  ]) assert.deepEqual(cleanNotification({ ...base, ...wrong }), { ...base, time }, JSON.stringify(wrong));
  assert.equal(cleanNotification({ ...base, batchId: 'x'.repeat(64) }).batchId, 'x'.repeat(64));
});

test('通知のまとめ: 自動登録の成功は、同じワールド・同じ読み込み（batchId）の分を 1 行にし、いちばん上の通知の位置に置く', () => {
  const list = [
    success('s1', 'モコロン♀＋オオタチウオ♂ → ヤクモマル（拠点 1）'),
    { id: 'other', date: '2026-10-14', title: 'ほかの通知', body: '' },
    success('s2', 'ツッパニャン♂＋モコロン♀ → タマコッコ（拠点 1）'),
    // 読み込みが違う・ワールドが違う・batchId がない・kind がないものはまとめない
    success('s3', '別の読み込み', { batchId: '2026-10-14T00:59:00.000Z' }),
    success('s4', '別のワールド', { worldId: '0123456789ABCDEF0123456789ABCDEF' }),
    { ...success('s5', 'batchId なし'), batchId: undefined },
    { ...success('s6', 'kind なし'), kind: undefined },
    success('s7', 'クレメーナ♂＋フォレーオ♀ → クレメーナ（配合牧場）'),
  ].map(cleanNotification);
  const rows = groupNotifications(list);
  assert.deepEqual(rows.map((row) => row.ids), [['s1', 's2', 's7'], ['other'], ['s3'], ['s4'], ['s5'], ['s6']]);
  assert.deepEqual(rows.map((row) => row.count), [3, 1, 1, 1, 1, 1]);
  // 本文は最初の通知の本文に「ほか N 件」、題名・日時・行き先も最初の通知のもの
  const [first] = rows;
  assert.equal(first.body, 'モコロン♀＋オオタチウオ♂ → ヤクモマル（拠点 1）' + more(2));
  assert.deepEqual([first.id, first.title, first.date, first.time, first.href, first.kind], ['s1', '配合を自動登録しました', list[0].date, list[0].time, '#/search?p1=s1&p2=B', 'auto-registered']);
  assert.deepEqual(first.items.map((item) => item.body), [list[0].body, list[2].body, list[7].body]);
  // 足した「ほか N 件」は more にも入れる（通知欄が折り返しで分けずに出す）
  assert.equal(first.more, 'ほか 2 件');
  // 1 件だけの行は元の本文のまま
  assert.equal(rows[2].body, '別の読み込み');
  assert.equal(rows[2].more, undefined);
  assert.equal(rows[1].body, '');
  assert.deepEqual(groupNotifications([]), []);
});

test('通知のまとめ: 本文が長くても「ほか N 件」を残して 60 字に収める', () => {
  const long = 'あ'.repeat(BODY_MAX);
  const rows = groupNotifications([success('s1', long), success('s2', '二件目'), success('s3', '三件目')].map(cleanNotification));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body.length, BODY_MAX);
  assert.ok(rows[0].body.endsWith(`…${more(2)}`), rows[0].body);
});

test('ベル: 同じ読み込みの自動登録 3 件が未読なら、数は 1・パネルは 1 行で、開くと 3 件とも既読になる', async (t) => {
  const { body } = installDom(t);
  const items = [
    success('s1', 'モコロン♀＋オオタチウオ♂ → ヤクモマル（拠点 1）'),
    success('s2', '二件目'),
    success('s3', '三件目'),
  ];
  const { notifications } = setup({ sources: [() => items] });
  const menu = notificationMenu(notifications);
  body.append(menu.element);
  const [trigger] = menu.element.children;
  const badge = menu.element.querySelector('.notification-badge');
  assert.equal(badge.textContent, '1');
  assert.equal(trigger.getAttribute('aria-label'), '通知（未読 1 件）');
  await trigger.dispatch('click');
  const panel = menu.element.querySelector('.notification-panel');
  assert.equal(panel.querySelectorAll('.notification-item').length, 1);
  assert.deepEqual(titles(panel), ['配合を自動登録しました']);
  assert.equal(panel.querySelector('.notification-body').textContent, 'モコロン♀＋オオタチウオ♂ → ヤクモマル（拠点 1）' + more(2));
  // 「ほか N 件」は折り返しで分けない塊にする
  assert.equal(panel.querySelector('.notification-more').textContent, 'ほか 2 件');
  const link = panel.querySelector('.notification-link');
  assert.equal(link.href, '#/search?p1=s1&p2=B');
  // まとめた通知の本文は、行に重ねたときの説明に全部出す
  assert.equal(link.title, 'モコロン♀＋オオタチウオ♂ → ヤクモマル（拠点 1）\n二件目\n三件目');
  assert.deepEqual(notifications.unread(), []);
  assert.equal(badge.hidden, true);
  menu.close();
  // 同じ読み込みに後から 1 件増えても、未読の数はまとめた行の数
  items.push(success('s4', '四件目'), success('s5', '五件目'));
  notifications.changed();
  assert.equal(badge.textContent, '1');
});

test('通知一覧: 同じ読み込みの自動登録は 1 行にまとめ、どれかが未読なら未読の印を付けて、全部を既読にする', (t) => {
  installDom(t);
  const items = [success('s1', '一件目'), success('s2', '二件目'), { id: 'b', date: '2026-10-13', title: 'お知らせ' }];
  const { notifications } = setup({ sources: [() => items] });
  notifications.markRead(['s1', 'b']);
  const modal = openNotificationList(notifications);
  assert.equal(modal.dialog.querySelectorAll('.notification-item').length, 2);
  assert.deepEqual(titles(modal.dialog), ['配合を自動登録しました', 'お知らせ']);
  assert.equal(modal.dialog.querySelector('.notification-body').textContent, `一件目${more(1)}`);
  assert.equal(modal.dialog.querySelectorAll('.unread-chip').length, 1);
  assert.deepEqual(notifications.unread(), []);
  // 開いている間にまとめた行が増えたら描き直す
  items.push(success('s3', '三件目'));
  notifications.changed();
  assert.equal(modal.dialog.querySelector('.notification-body').textContent, `一件目${more(2)}`);
});
