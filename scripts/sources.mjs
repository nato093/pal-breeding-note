// マスターデータと画像の取得元。再現性のためコミット SHA で固定する。
// INV-2: 配合に関するデータ（PalCalc の breeding.json など）はここに載せない＝取得しない。

export const PALCALC = {
  repo: 'tylercamp/palcalc',
  sha: '8566b9addf72e62bc424c59293afd97eacb038ec',
  license: 'MIT',
  files: { db: 'PalCalc.Model/db.json' },
};

export const PALWORLD_HELPER = {
  repo: 'MagitekZed/palworld-helper',
  sha: 'ae4d6044cf136065f29dfa77b190e861c1de1bd3',
  license: 'なし（画像は © Pocketpair, Inc.）',
  files: { elements: 'data/pals_work_suitability.csv', iconDir: 'icons/pals' },
};

export const rawUrl = (src, file) => `https://raw.githubusercontent.com/${src.repo}/${src.sha}/${file}`;

export const iconSourceFile = (palId) => `${PALWORLD_HELPER.files.iconDir}/T_${palId}_icon_normal.webp`;

export const ALL_SOURCE_URLS = [
  rawUrl(PALCALC, PALCALC.files.db),
  rawUrl(PALWORLD_HELPER, PALWORLD_HELPER.files.elements),
  `https://api.github.com/repos/${PALWORLD_HELPER.repo}/contents/${PALWORLD_HELPER.files.iconDir}?ref=${PALWORLD_HELPER.sha}`,
];
