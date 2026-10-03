export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

export function button(text, action, className = 'button') {
  const node = el('button', className, text);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}

export function link(text, href, className = '') {
  const node = el('a', className, text);
  node.href = href;
  return node;
}

export function field(label, input) {
  const wrapper = el('label', 'field');
  wrapper.append(el('span', 'field-label', label), input);
  return wrapper;
}

export function empty(text, action) {
  const node = el('div', 'empty-state');
  node.append(el('span', 'empty-symbol', '◇'), el('p', '', text));
  if (action) node.append(action);
  return node;
}

export function formatTime(value, full = false) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '未取得';
  return new Intl.DateTimeFormat('ja-JP', full
    ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export async function runButton(node, action, onError) {
  if (node.disabled) return;
  node.disabled = true;
  node.setAttribute('aria-busy', 'true');
  try { return await action(); } catch (error) { onError(error); }
  finally { node.disabled = false; node.removeAttribute('aria-busy'); }
}
