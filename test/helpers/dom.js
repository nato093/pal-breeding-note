export function descendants(node) {
  return [node, ...node.children.flatMap(descendants)];
}

function matches(node, selector) {
  if (selector.startsWith('.')) return node.className.split(' ').includes(selector.slice(1));
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  const match = selector.match(/^([\w-]+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
  if (!match) throw new Error(`テスト用 DOM で未対応のセレクター: ${selector}`);
  const [, tag, attribute, value] = match;
  return (!tag || node.tagName === tag) && (!attribute || (value === undefined
    ? node.attributes.has(attribute) || Boolean(node[attribute]) : node.getAttribute(attribute) === value));
}

export class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.text = '';
    this.className = '';
    const properties = new Map();
    this.style = {
      setProperty: (key, value) => properties.set(key, String(value)),
      getPropertyValue: (key) => properties.get(key) ?? '',
    };
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
      toggle: (name, force) => {
        const current = this.className.split(' ').filter(Boolean);
        const enabled = force ?? !current.includes(name);
        this.className = [...current.filter((item) => item !== name), ...(enabled ? [name] : [])].join(' ');
      },
    };
  }
  set textContent(value) { this.replaceChildren(); this.text = value; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set value(value) { this.inputValue = value; }
  get value() { return this.inputValue ?? (this.tagName === 'select' ? this.children[0]?.value ?? '' : ''); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.text = '';
    if (this.tagName === 'select') this.inputValue = undefined;
    this.append(...nodes);
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(name, action, options = {}) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(action);
    this.listeners.set(name, listeners);
    options.signal?.addEventListener('abort', () => {
      this.listeners.set(name, (this.listeners.get(name) ?? []).filter((item) => item !== action));
    }, { once: true });
  }
  async dispatch(name, values = {}) {
    let prevented = false;
    let stopped = false;
    const event = { target: this, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, ...values };
    for (const action of [...this.listeners.get(name) ?? []]) await action(event);
    if (name === 'click' && this.type === 'submit' && !this.disabled && !prevented) {
      await document.getElementById(this.getAttribute('form'))?.requestSubmit();
    }
    if (name === 'cancel' && this.tagName === 'dialog' && !prevented) await this.close();
    return { defaultPrevented: prevented, propagationStopped: stopped };
  }
  querySelectorAll(selector) { return this.children.flatMap(descendants).filter((node) => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(node) { return descendants(this).includes(node); }
  requestSubmit() { return this.dispatch('submit'); }
  focus() { document.activeElement = this; }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 100, top: 200, bottom: 252, width: 220 }; }
  get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  showModal() { this.open = true; }
  close() { this.open = false; return this.dispatch('close'); }
}

export function installDom(t) {
  for (const name of ['document', 'window']) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    t.after(() => before ? Object.defineProperty(globalThis, name, before) : Reflect.deleteProperty(globalThis, name));
  }
  const body = new FakeElement('body');
  const events = new FakeElement('document');
  const windowEvents = new FakeElement('window');
  windowEvents.innerWidth = 1280;
  windowEvents.innerHeight = 900;
  globalThis.window = windowEvents;
  globalThis.document = {
    body, activeElement: body,
    createElement: (name) => new FakeElement(name),
    createElementNS: (namespace, name) => {
      const node = new FakeElement(name);
      node.namespaceURI = namespace;
      return node;
    },
    getElementById: (id) => descendants(body).find((node) => node.id === id),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener: (...args) => events.addEventListener(...args),
  };
  return { body, events, windowEvents };
}
