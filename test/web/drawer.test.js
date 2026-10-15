import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fakeHistory, FakeElement, descendants } from '../helpers/dom.js';
import { createDrawer, handlePalLink, cleanDrawerState, DRAWER_STACK_MAX, DRAWER_VERSION } from '../../web/js/ui/drawer.js';
import { toast } from '../../web/js/ui/toast.js';

const hasClass = (node, name) => node.className.split(' ').includes(name);
const byClass = (root, name) => descendants(root).find((node) => hasClass(node, name));
const buttonOf = (root, label) => descendants(root).find((node) => node.tagName === 'button'
  && (node.getAttribute('aria-label') === label || node.textContent === label));

// 仮の中身（パルの名前だけ）。destroyed に片づけた ID を残す
function setup(t, { state = null, scope = { env: 'test', user: 'alice' }, missing = [] } = {}) {
  const { body } = installDom(t);
  const app = new FakeElement('div');
  const main = new FakeElement('main');
  const title = new FakeElement('h1');
  title.textContent = '配合を探す';
  main.append(title);
  app.append(main);
  body.append(app);
  const history = fakeHistory({ state: state ?? { palEntry: 'e1' } });
  const destroyed = [];
  const made = [];
  let where = scope;
  const render = {
    pal: (entry) => {
      if (missing.includes(entry.id)) return null;
      made.push(entry.id);
      const element = new FakeElement('div');
      element.textContent = `中身 ${entry.id}`;
      return { title: `パル ${entry.id}`, element, destroy: () => destroyed.push(entry.id) };
    },
  };
  const drawer = createDrawer({ context: {}, render, main, history, doc: document, scope: () => where, url: () => '/Pal/#/search' });
  app.append(drawer.element);
  history.onPop = (next) => drawer.sync(next);
  return { body, app, main, title, history, drawer, destroyed, made, setScope: (next) => { where = next; } };
}

test('ドロワー: 開くと aside が見え、見出しにフォーカスし、URL を変えずに履歴を 1 件積む（history.state のほかの鍵は残す）', (t) => {
  const { drawer, history } = setup(t);
  const opener = new FakeElement('a');
  document.body.append(opener);
  drawer.open({ kind: 'pal', id: 'SheepBall' }, { opener });
  const aside = drawer.element;
  assert.equal(aside.tagName, 'aside');
  assert.equal(aside.hidden, false);
  assert.equal(document.activeElement, byClass(aside, 'side-drawer-title'));
  assert.equal(byClass(aside, 'side-drawer-title').textContent, 'パル SheepBall');
  assert.deepEqual(history.calls, ['push']);
  assert.equal(history.url, '/Pal/#/search');
  assert.equal(history.state.palEntry, 'e1');
  assert.deepEqual(history.state.drawer, { v: DRAWER_VERSION, env: 'test', user: 'alice', entry: { kind: 'pal', id: 'SheepBall' }, stack: [], pushed: true });
  assert.equal(document.documentElement.getAttribute('data-side-drawer'), 'open');
  // 「ページで開く」は全画面のパル詳細
  assert.equal(byClass(aside, 'side-drawer-page').href, '#/pal/SheepBall');
  assert.equal(byClass(aside, 'side-drawer-page').hidden, false);
});

test('ドロワー: 開いたまま別の中身を開くと履歴を増やさずに差し替え、「← 前へ」で前の中身に戻る（積むのは 5 件まで）', (t) => {
  const { drawer, history, destroyed } = setup(t);
  drawer.open({ kind: 'pal', id: 'A' });
  const back = buttonOf(drawer.element, '前の内容へ戻る');
  assert.equal(back.hidden, true);
  drawer.open({ kind: 'pal', id: 'B' });
  assert.deepEqual(history.calls, ['push', 'replace']);
  assert.deepEqual(destroyed, ['A']);
  assert.equal(back.hidden, false);
  assert.deepEqual(history.state.drawer.stack, [{ kind: 'pal', id: 'A' }]);
  // 差し替えても自分で積んだエントリの印は残す
  assert.equal(history.state.drawer.pushed, true);
  back.dispatch('click');
  assert.deepEqual(drawer.current(), { kind: 'pal', id: 'A' });
  assert.equal(back.hidden, true);
  assert.equal(history.length, 2);
  for (const id of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) drawer.open({ kind: 'pal', id });
  assert.equal(history.state.drawer.stack.length, DRAWER_STACK_MAX);
  assert.deepEqual(history.state.drawer.stack.map((item) => item.id), ['C', 'D', 'E', 'F', 'G']);
  // 同じ中身をもう一度開いても作り直さない
  const before = destroyed.length;
  drawer.open({ kind: 'pal', id: 'H' });
  assert.equal(destroyed.length, before);
});

test('ドロワー: × で閉じると、自分で積んだエントリなら戻り、フォーカスを開いた所へ戻す。開いた所が消えていたら本文の見出しへ', (t) => {
  const { drawer, history, title, destroyed } = setup(t);
  const opener = new FakeElement('a');
  document.body.append(opener);
  drawer.open({ kind: 'pal', id: 'A' }, { opener });
  buttonOf(drawer.element, 'パネルを閉じる').dispatch('click');
  assert.equal(drawer.element.hidden, true);
  assert.deepEqual(history.calls, ['push', 'back']);
  assert.equal(history.state.drawer, undefined);
  assert.equal(history.state.palEntry, 'e1');
  assert.equal(document.activeElement, opener);
  assert.deepEqual(destroyed, ['A']);
  assert.equal(document.documentElement.getAttribute('data-side-drawer'), null);
  // 進むで開き直す
  history.forward();
  assert.deepEqual(drawer.current(), { kind: 'pal', id: 'A' });
  // 開いた所が消えていたら本文の h1 へ（tabIndex -1）
  drawer.open({ kind: 'pal', id: 'B' }, { opener });
  opener.remove();
  document.activeElement = byClass(drawer.element, 'side-drawer-title');
  buttonOf(drawer.element, 'パネルを閉じる').dispatch('click');
  assert.equal(document.activeElement, title);
  assert.equal(title.tabIndex, -1);
});

test('ドロワー: 自分で積んでいないエントリ（読み込み直し・同じ画面の条件の変更で引き継いだ）で閉じると、戻らずに drawer だけを消す', (t) => {
  const { drawer, history } = setup(t, { state: { palEntry: 'e2', drawer: { v: 1, env: 'test', user: 'alice', entry: { kind: 'pal', id: 'A' }, stack: [], pushed: false } } });
  drawer.sync();
  assert.equal(drawer.isOpen(), true);
  assert.deepEqual(history.calls, []);
  buttonOf(drawer.element, 'パネルを閉じる').dispatch('click');
  assert.deepEqual(history.calls, ['replace']);
  assert.deepEqual(history.state, { palEntry: 'e2' });
  // 引き継ぐ値は「自分で積んでいない」印つき
  drawer.open({ kind: 'pal', id: 'B' });
  assert.equal(drawer.carry().drawer.pushed, false);
  assert.deepEqual(drawer.carry().drawer.entry, { kind: 'pal', id: 'B' });
  drawer.close({ reason: 'route' });
  assert.deepEqual(drawer.carry(), {});
});

test('ドロワー: Esc（中にフォーカス）で閉じる。中の候補が開いている・モーダルのダイアログがあるときは閉じない', async (t) => {
  const { drawer, body } = setup(t);
  drawer.open({ kind: 'pal', id: 'A' });
  // 中の候補（aria-expanded の部品）が開いている
  const picker = new FakeElement('button');
  picker.setAttribute('aria-expanded', 'true');
  drawer.content().element.append(picker);
  await drawer.element.dispatch('keydown', { key: 'Escape' });
  assert.equal(drawer.isOpen(), true);
  picker.setAttribute('aria-expanded', 'false');
  // モーダルのダイアログが開いている
  const dialog = new FakeElement('dialog');
  dialog.open = true;
  body.append(dialog);
  document.querySelector = (selector) => body.querySelector(selector);
  await drawer.element.dispatch('keydown', { key: 'Escape' });
  assert.equal(drawer.isOpen(), true);
  dialog.remove();
  await drawer.element.dispatch('keydown', { key: 'Enter' });
  assert.equal(drawer.isOpen(), true);
  const result = await drawer.element.dispatch('keydown', { key: 'Escape' });
  assert.equal(drawer.isOpen(), false);
  assert.equal(result.defaultPrevented, true);
});

test('ドロワー: 画面の移動・ログアウトでは戻らずに閉じて中身を片づけ、今のエントリに drawer があれば消す', (t) => {
  const { drawer, history, destroyed } = setup(t);
  drawer.open({ kind: 'pal', id: 'A' });
  drawer.close({ reason: 'logout' });
  assert.equal(drawer.isOpen(), false);
  assert.deepEqual(destroyed, ['A']);
  assert.deepEqual(history.calls, ['push', 'replace']);
  assert.equal(history.state.drawer, undefined);
  // drawer のないエントリでは履歴を触らない
  drawer.close({ reason: 'route' });
  assert.deepEqual(history.calls, ['push', 'replace']);
});

test('ドロワー: 起動・戻る・進むでは history.state に合わせる。版・環境・利用者が違えば開かずに消し、ログインしていなければ開かない', (t) => {
  const saved = (changes) => ({ palEntry: 'e1', drawer: { v: 1, env: 'test', user: 'alice', entry: { kind: 'pal', id: 'A' }, stack: [{ kind: 'pal', id: 'Z' }], pushed: true, ...changes } });
  for (const changes of [{ env: 'production' }, { user: 'bob' }, { v: 2 }]) {
    const { drawer, history } = setup(t, { state: saved(changes) });
    drawer.sync();
    assert.equal(drawer.isOpen(), false, JSON.stringify(changes));
    assert.deepEqual(history.state, { palEntry: 'e1' });
  }
  const { drawer, history, setScope } = setup(t, { state: saved({}) });
  setScope(null);
  drawer.sync();
  assert.equal(drawer.isOpen(), false);
  assert.equal(history.state.drawer.entry.id, 'A');
  setScope({ env: 'test', user: 'alice' });
  drawer.sync();
  assert.deepEqual(drawer.current(), { kind: 'pal', id: 'A' });
  assert.equal(buttonOf(drawer.element, '前の内容へ戻る').hidden, false);
  // 形の合わない値は捨てる
  assert.equal(cleanDrawerState({ v: 1, env: 'test', user: 'a', entry: { kind: 'unknown', id: 'A' } }), null);
  assert.equal(cleanDrawerState({ v: 1, env: 'test', user: 'a', entry: { kind: 'pal', id: '' } }), null);
});

test('ドロワー: ドロワーの中の部品から別の中身を開いても、閉じたときのフォーカスは本文の開いた所へ戻る（中の部品は入れ替えで消える）', (t) => {
  const { drawer } = setup(t);
  const opener = new FakeElement('a');
  document.body.append(opener);
  drawer.open({ kind: 'pal', id: 'A' }, { opener });
  const inside = new FakeElement('button');
  byClass(drawer.element, 'side-drawer-body').append(inside);
  drawer.open({ kind: 'pal', id: 'B' }, { opener: inside });
  buttonOf(drawer.element, 'パネルを閉じる').dispatch('click');
  assert.equal(document.activeElement, opener);
});

test('ドロワー: 中身は作るときに受け取る setTitle で見出しを後から直せる。入れ替わった後の古い中身からは効かない', (t) => {
  // setup は DOM を入れるためだけに使い、setTitle を受け取る中身のドロワーを別に作る
  setup(t);
  const setters = [];
  const made = createDrawer({
    context: {}, main: new FakeElement('main'), history: fakeHistory({ state: {} }), doc: document, scope: () => ({ env: 'test', user: 'alice' }), url: () => '/',
    render: {
      pal: (entry, _context, { setTitle }) => {
        setters.push(setTitle);
        return { title: `パル ${entry.id}`, element: new FakeElement('div'), destroy() {} };
      },
    },
  });
  document.body.append(made.element);
  made.open({ kind: 'pal', id: 'A' });
  const title = () => byClass(made.element, 'side-drawer-title').textContent;
  setters[0]('アヌビス「あぬびす」');
  assert.equal(title(), 'アヌビス「あぬびす」');
  made.open({ kind: 'pal', id: 'B' });
  setters[0]('古い中身');
  assert.equal(title(), 'パル B');
  setters[1]('新しい題名');
  assert.equal(title(), '新しい題名');
});

test('ドロワー: 中身が対象を見失ったら「見つかりません」と「閉じる」を出す', (t) => {
  const { drawer } = setup(t, { missing: ['Gone'] });
  drawer.open({ kind: 'pal', id: 'Gone' });
  assert.equal(byClass(drawer.element, 'side-drawer-title').textContent, '見つかりません');
  assert.equal(byClass(drawer.element, 'side-drawer-page').hidden, true);
  buttonOf(drawer.element, '閉じる').dispatch('click');
  assert.equal(drawer.isOpen(), false);
});

test('ドロワー: パルのタイルの普通のクリックだけ引き取り、修飾キー・中クリック・ダイアログの中・タイル以外は今までどおり', (t) => {
  const { drawer, app } = setup(t);
  const tile = new FakeElement('a');
  tile.className = 'pal-tile';
  tile.href = '#/pal/SheepBall';
  const name = new FakeElement('strong');
  tile.append(name);
  app.append(tile);
  const event = (values = {}) => {
    const value = { target: name, button: 0, prevented: false, ...values };
    value.preventDefault = () => { value.prevented = true; };
    return value;
  };
  for (const values of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    const click = event(values);
    assert.equal(handlePalLink(click, app, drawer), false, JSON.stringify(values));
    assert.equal(click.prevented, false);
  }
  assert.equal(drawer.isOpen(), false);
  const click = event();
  assert.equal(handlePalLink(click, app, drawer), true);
  assert.equal(click.prevented, true);
  assert.deepEqual(drawer.current(), { kind: 'pal', id: 'SheepBall' });
  // ダイアログの中のタイル
  const dialog = new FakeElement('dialog');
  const inner = new FakeElement('a');
  inner.className = 'pal-tile';
  inner.href = '#/pal/Anubis';
  dialog.append(inner);
  app.append(dialog);
  assert.equal(handlePalLink(event({ target: inner }), app, drawer), false);
  // タイルでないリンク
  const plain = new FakeElement('a');
  plain.href = '#/pal/Anubis';
  app.append(plain);
  assert.equal(handlePalLink(event({ target: plain }), app, drawer), false);
});

test('ドロワー: <dialog> を使わないので、開いている間のトーストはドロワーの中ではなく本文（body）に出る', (t) => {
  const { drawer, body } = setup(t);
  drawer.open({ kind: 'pal', id: 'A' });
  toast('保存しました');
  const region = body.children.find((node) => hasClass(node, 'toast-region'));
  assert.ok(region);
  assert.equal(drawer.element.contains(region), false);
  assert.equal(descendants(drawer.element).some((node) => node.tagName === 'dialog'), false);
});

test('ドロワー: 「本文へ戻る」はドロワーを開いたまま、フォーカスを開いた所（なければ本文の見出し）へ移す', (t) => {
  const { drawer, title } = setup(t);
  drawer.open({ kind: 'pal', id: 'A' });
  buttonOf(drawer.element, '本文へ戻る').dispatch('click');
  assert.equal(drawer.isOpen(), true);
  assert.equal(document.activeElement, title);
});
