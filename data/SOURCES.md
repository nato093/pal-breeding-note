# マスターデータの出典

`data/pals.csv`・`web/data/pals.js`・`gas/PalMaster.js` は `npm run build:pals`（`scripts/import-pals.mjs`）で生成する。手で編集しない。
取得元のコミット SHA は `scripts/sources.mjs` で固定している。

| 項目 | 取得元 | ライセンス・権利 |
|---|---|---|
| ID（内部名）・図鑑番号・亜種・日本語名・英名・属性の日本語名 | [tylercamp/palcalc](https://github.com/tylercamp/palcalc) の `PalCalc.Model/db.json` | コードは MIT。データはゲームファイル由来（© Pocketpair, Inc.） |
| 属性 | [MagitekZed/palworld-helper](https://github.com/MagitekZed/palworld-helper) の `data/pals_work_suitability.csv` | リポジトリのライセンスなし。属性は事実情報として利用 |
| パル画像 | 同上の `icons/pals/` | リポジトリのライセンスなし。画像は © Pocketpair, Inc.（ユーザー判断で利用） |

## 取り込まないもの（INV-2）

配合に関する情報は取得も出力もしない。PalCalc の `breeding.json`、`BreedingPower` などの配合計算に使える値は対象外。
このアプリで「既知の配合」とみなすのは、利用者が登録したレコードだけ。

## 画像の扱い

- 画像はリポジトリにコミットしない。`npm run fetch:icons` で取得し、GitHub Actions の配信時に成果物にだけ入れる。
- 撤回するときは `.github/workflows/pages.yml` から画像の取得を外して再配信し、残っている Actions の成果物を削除する。全パルが SVG アバターに切り替わる。

## 手当て

- `PlantSlime_Flower`: 取り込み元では `PlantSlime` と同じ 12 番・同じ名前（ナエモチ）で、画像もない。ゲーム内の図鑑に載っていないことをユーザーが確認した（2026-10-04）ため、`active=false` にしてパル選択に出さない。ID はマスターに残す（この ID を含む行がシートにあっても、マスター外として弾かないため）。
- `ElecSnail_Ground`: 英名が取り込み元どうしで食い違う（Snock Terra / Snock Lux）ため、属性は図鑑ラベル `163B` で突合している。
