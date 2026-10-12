import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, descendants } from '../helpers/dom.js';
import { accountMenu } from '../../web/js/ui/account-menu.js';

function setup(t, { pending = null, renamer = true } = {}) {
  const dom = installDom(t);
  const listeners = new Set();
  const log = [];
  const store = {
    state: { userId: 'とても長い名前のユーザー', renaming: false },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    logout() { log.push('logout'); },
  };
  const context = { store, renamer: renamer ? { pending: () => pending, rename: async (name) => name } : null };
  const menu = accountMenu(context);
  dom.body.append(menu.element);
  const trigger = menu.element.querySelector('.account-button');
  const emit = (patch) => {
    Object.assign(store.state, patch);
    for (const listener of listeners) listener(store.state);
  };
  const item = (text) => menu.element.querySelectorAll('button').find((node) => node.textContent === text);
  return { ...dom, menu, trigger, emit, item, log, listeners };
}

test('ID のメニュー: ボタンに ID を出し、開いたときだけ「名前を変更」「ログアウト」を作る', async (t) => {
  const { menu, trigger, item, emit } = setup(t);
  assert.equal(trigger.textContent, 'とても長い名前のユーザー');
  assert.equal(trigger.getAttribute('aria-label'), 'ログイン中の ID: とても長い名前のユーザー（名前の変更・ログアウト）');
  assert.equal(item('ログアウト'), undefined);
  await trigger.dispatch('click');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.match(menu.element.querySelector('.account-panel').textContent, /ログイン中の IDとても長い名前のユーザー/);
  assert.ok(item('名前を変更'));
  assert.ok(item('ログアウト'));
  // 名前の変更中は押せない（開いたまま書き換える）
  emit({ renaming: true });
  assert.equal(item('名前を変更').disabled, true);
  assert.equal(item('ログアウト').disabled, true);
  emit({ renaming: false, userId: '新しい名前' });
  assert.equal(trigger.textContent, '新しい名前');
  assert.equal(item('ログアウト').disabled, false);
  // 閉じると中身は DOM から消える
  await trigger.dispatch('click');
  assert.equal(menu.element.querySelector('.account-panel'), null);
  assert.equal(item('ログアウト'), undefined);
});

test('ID のメニュー: 「ログアウト」は確認してからログアウトし、キャンセルではしない', async (t) => {
  const { body, trigger, item, log, menu } = setup(t);
  const dialogButton = (text) => descendants(body).find((node) => node.tagName === 'button' && node.textContent === text && node.parentElement?.className === 'dialog-footer');
  await trigger.dispatch('click');
  await item('ログアウト').dispatch('click');
  // メニューは閉じ、ボタンへフォーカスを戻してから確認を開く
  assert.equal(menu.element.querySelector('.account-panel'), null);
  assert.match(body.querySelector('dialog').textContent, /ログアウトしますか/);
  await dialogButton('キャンセル').dispatch('click');
  assert.deepEqual(log, []);
  assert.equal(document.activeElement, trigger);
  await trigger.dispatch('click');
  await item('ログアウト').dispatch('click');
  await dialogButton('ログアウト').dispatch('click');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(log, ['logout']);
});

test('ID のメニュー: 「名前を変更」で名前の変更のダイアログを開く', async (t) => {
  const { body, trigger, item } = setup(t);
  await trigger.dispatch('click');
  await item('名前を変更').dispatch('click');
  const dialog = body.querySelector('dialog');
  assert.equal(dialog.querySelector('h2').textContent, '名前を変更');
  assert.equal(dialog.querySelector('input').value, 'とても長い名前のユーザー');
});

test('ID のメニュー: 途中で止まった名前の変更があるとき・renamer が無いときは「名前を変更」を出さない', async (t) => {
  for (const options of [{ pending: { oldId: 'a', newId: 'b' } }, { renamer: false }]) {
    const { trigger, item, menu } = setup(t, options);
    await trigger.dispatch('click');
    assert.ok(!item('名前を変更') || item('名前を変更').hidden);
    assert.ok(item('ログアウト'));
    menu.destroy();
  }
});

test('ID のメニュー: destroy で購読を外し、開いていれば閉じる', async (t) => {
  const { menu, trigger, listeners } = setup(t);
  await trigger.dispatch('click');
  menu.destroy();
  assert.equal(listeners.size, 0);
  assert.equal(menu.element.querySelector('.account-panel'), null);
});
