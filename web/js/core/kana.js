export function normalizeQuery(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/[\u3041-\u3096]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .trim();
}

export function palMatches(pal, query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return true;
  return [pal.ja, pal.en, pal.id, pal.label, pal.no]
    .some((value) => normalizeQuery(value).includes(normalized));
}
