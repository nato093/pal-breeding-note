// 左のナビゲーションのアイコン。24px の格子に線 2px・角丸の線画で描き、色は文字色に合わせる。
const PATHS = {
  search: ['<circle cx="10.5" cy="10.5" r="6.5"/>', '<path d="m15.5 15.5 5 5"/>'],
  reverse: ['<path d="M9 14 4 9l5-5"/>', '<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'],
  route: ['<circle cx="6" cy="19" r="2.5"/>', '<circle cx="18" cy="5" r="2.5"/>', '<path d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.5"/>'],
  list: ['<path d="M9 6h11M9 12h11M9 18h11"/>', '<path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="3"/>'],
  drafts: ['<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>', '<path d="m13.5 6.5 4 4"/>'],
  owned: ['<rect x="3" y="4" width="18" height="5" rx="1.5"/>', '<path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/>', '<path d="M10 13h4"/>'],
  ideal: ['<path d="M7 4h10l4 5-9 11L3 9z"/>', '<path d="M3 9h18"/>', '<path d="m10 4-2 5 4 11 4-11-2-5"/>'],
  wishlist: ['<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>'],
  settings: ['<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/>', '<circle cx="15" cy="7" r="2"/>', '<circle cx="9" cy="17" r="2"/>'],
};

const NS = 'http://www.w3.org/2000/svg';

function shape(markup) {
  const [, tag, attributes] = markup.match(/^<(\w+)\s+(.*?)\/>$/);
  const node = document.createElementNS(NS, tag);
  for (const [, key, value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(key, value);
  return node;
}

export function navIcon(view) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'tab-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const markup of PATHS[view] ?? []) svg.append(shape(markup));
  return svg;
}
