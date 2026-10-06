# マスターデータの出典

`data/pals.csv`・`web/data/pals.js`・`gas/PalMaster.js` は `npm run build:pals`（`scripts/import-pals.mjs`）で生成する。手で編集しない。
取得元のコミット SHA は `scripts/sources.mjs` で固定している。

| 項目 | 取得元 | ライセンス・権利 |
|---|---|---|
| ID（内部名）・図鑑番号・亜種・日本語名・英名・属性の日本語名 | [tylercamp/palcalc](https://github.com/tylercamp/palcalc) の `PalCalc.Model/db.json` | コードは MIT。データはゲームファイル由来（© Pocketpair, Inc.） |
| 属性 | [MagitekZed/palworld-helper](https://github.com/MagitekZed/palworld-helper) の `data/pals_work_suitability.csv` | リポジトリのライセンスなし。属性は事実情報として利用 |
| パル画像 | 同上の `icons/pals/` | リポジトリのライセンスなし。画像は © Pocketpair, Inc.（ユーザー判断で利用） |
| パッシブの内部名・日本語名・英名・ランク・効果の説明（`data/passives.csv`・`web/data/passives.js`） | PalCalc の同じ `db.json`（`npm run build:passives` = `scripts/import-passives.mjs`） | 同上。日本語名はゲーム本体の `DT_SkillNameText_Common` と一致することを確認（2026-10-05、名前のある 488 件） |

## セーブの読み込みに使うコード

| 部分 | 元にしたもの | ライセンス |
|---|---|---|
| Oodle の展開（`web/js/save/oodle.js`） | [oozextract](https://github.com/lvlvllvlvllvlvl/oozextract) 0.4.2（Rust）を JavaScript に移植 | MIT（oozextract の Cargo.toml の表記）。oozextract のリポジトリにある Silesia コーパスの Kraken・Mermaid・Selkie・Leviathan と実際のセーブで、別の展開ツール（pyooz）の結果とバイト単位で一致することを確認（2026-10-05） |
| GVAS とセーブの構造（`web/js/save/gvas.js`・`palworld.js`） | [PalworldSaveTools](https://github.com/deafdudecomputers/PalworldSaveTools) の `palsav` の読み取り処理を参考に独自に実装 | 参考元は MIT |

セーブの構成は [SAVE_FORMAT.md](../docs/SAVE_FORMAT.md) にまとめた。

## 取り込まないもの（INV-2）

パルとパッシブのマスターには、配合に関する情報を持たせない。`BreedingPower` などの配合計算に使える値や、パッシブの遺伝の確率（`RandomInheritanceWeight` など）は取り込まない。
このアプリで「既知の配合」とみなし、画面に表示・検索するのは、利用者が登録したレコードだけ。

### 例外: 自動登録の照合に使う配合表

| 項目 | 取得元 | ライセンス・権利 |
|---|---|---|
| 親の組み合わせ → 子（`web/data/breeding.js`） | PalCalc の `PalCalc.Model/breeding.json`（同じ固定 SHA。`npm run build:breeding` = `scripts/import-breeding.mjs`） | コードは MIT。データはゲームファイル由来（© Pocketpair, Inc.） |

- 使うのは、配合牧場からの自動登録で「タマゴの中身が、親の組み合わせどおりか」を照合するときだけ（`web/js/auto-register.js`）。合ったものだけを、利用者の配合として登録する
- 画面での表示・検索・候補の提示には使わない。読み込める場所はテスト（`test/import.test.js`）で限っている
- 登録されるのは、実際に牧場で産まれたタマゴの結果だけなので、「自分が試したものだけを表示する」という INV-2 の意図は変わらない

> 変更記録（2026-10-06）: ユーザー指示により、配合牧場からの自動登録の照合用に限って `breeding.json` の取り込みを許可した。理由: もともと取り込まなかったのは「自分が試したものだけを表示する」ためで、照合にだけ使うならその意図に反しないため。影響: `web/data/breeding.js`（約 120 KB）が配信物に入る（自動登録が動くときだけ読み込む）。PalCalc の更新に合わせて `npm run build:breeding` で作り直す。

## 画像の扱い

- 画像はリポジトリにコミットしない。`npm run fetch:icons` で取得し、GitHub Actions の配信時に成果物にだけ入れる。
- 撤回するときは `.github/workflows/pages.yml` から画像の取得を外して再配信し、残っている Actions の成果物を削除する。全パルが SVG アバターに切り替わる。
- 例外: パッシブの表示に使う画像（ランクの矢印 6 枚と背景の三角模様 1 枚、`web/img/passive/`）は、配信時に取得できないためコミットする。ゲーム本体の `Pal-Windows.pak` の `Pal/Content/Pal/Texture/UI/Main_Menu/` から `npm run extract:passive-icons` で取り出したもの（対応は `scripts/extract-passive-icons.mjs` の `PASSIVE_TEXTURES`、v1.0.5 で確認、2026-10-05）。撤回するときは `web/img/passive/` を消す（パッシブ名の表示は残る）。
- 例外: 人間のキャラクターのアイコン（154 枚、`web/img/humans/`）と日本語名（`web/data/humans.js`）も、ゲーム本体から `npm run extract:humans` で取り出してコミットする。表は `DT_PalCharacterIconDataTable_Common`（アイコン）・`DT_PalHumanParameter_Common`（名前の ID）・`DT_HumanNameText_Common`（名前。ゲームの元の言語が日本語）。撤回するときは `web/img/humans/` を消し、`web/data/humans.js` を空の配列（`export default [];`）にする（キャラクター ID の表示に戻る）。

## 手当て

- `PlantSlime_Flower`: 取り込み元では `PlantSlime` と同じ 12 番・同じ名前（ナエモチ）で、画像もない。ゲーム内の図鑑に載っていないことをユーザーが確認した（2026-10-04）ため、`active=false` にしてパル選択に出さない。ID はマスターに残す（この ID を含む行がシートにあっても、マスター外として弾かないため）。
- `ElecSnail_Ground`: 英名が取り込み元どうしで食い違う（Snock Terra / Snock Lux）ため、属性は図鑑ラベル `163B` で突合している。
