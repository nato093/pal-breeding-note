import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from '../helpers/dom.js';
import releaseNotes from '../../web/js/release-notes.js';
import { TITLE_MAX, BODY_MAX, notificationTime, cleanNotification, createNotificationStore } from '../../web/js/notifications.js';
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
