// 左のナビのタブ（並びと名前）。各画面の見出し（h1）もここから引く（タブの名前を変えると、見出しも同じ名前になる）。
// 並びは 探す｜記録｜所持｜設定 の順（区切りの余白は CSS が data-view で付ける）。逆引き・一覧は配合を探すに統合した（find-merge）
export const TABS = Object.freeze([
  ['search', '配合を探す'], ['route', '継承ルート'], ['drafts', '下書き'],
  ['wishlist', 'ウィッシュリスト'], ['owned', '所持パル'], ['ideal', '理想個体'], ['settings', '設定'],
].map((tab) => Object.freeze(tab)));

/** タブの名前（タブにない画面は ''） */
export const tabLabel = (view) => TABS.find(([key]) => key === view)?.[1] ?? '';
