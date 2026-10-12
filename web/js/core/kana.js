export function normalizeQuery(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .trim();
}

/** 検索語を、空白で区切った語に分ける（ひらがなとカタカナ・全角と半角・大文字と小文字はそろえる）。 */
export function queryTerms(query) {
  return normalizeQuery(query).split(/\s+/).filter(Boolean);
}

export function palMatches(pal, query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return true;
  return [pal.ja, pal.en, pal.id, pal.label, pal.no]
    .some((value) => normalizeQuery(value).includes(normalized));
}
