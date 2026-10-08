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

### 例外: 理想個体の提案に使う遺伝の仕組み

「理想個体」タブ（`web/js/views/ideal.js`）では、所持パルのどの 2 体を配合すると、欲しいパッシブと個体値の子が産まれやすいかを確率で出す。そのために、次のものを `web/js/core/ideal.js` に定数・規則として持つ。

| 項目 | 内容 | 確認したもの |
|---|---|---|
| パッシブの遺伝 | 両親のパッシブの和集合（重複を除く）から 1〜4 個（40/30/20/10%）を同じ確率で選んで継ぎ、枠が残れば 0〜3 個（40/30/20/10%）をランダムに足す。スペシャルケーキは継ぐ数を抽選せず 4 個まで継ぐ | Palworld v1.0.5（Steam build 25246127）の `BP_PalGameSetting`（`Combi_PassiveInheritNum`・`Combi_PassiveRandomAddNum`）、`DA_BreedingItemEffectData`、配合の処理の逆アセンブル。PalCalc の `README-PALWORLD-MECHANICS.md` と一致 |
| 個体値の遺伝 | ステータスごとに、どちらかの親の値（50/50）を写すか 0〜100 の乱数。写すステータスの組み合わせは `Combi_TalentInheritNum = [3, 2, 1]` と処理の分岐から（HP 2/3・攻撃と防御 5/9）。キノコケーキ・豪華野菜ケーキは +1〜5 | 同じビルドの `BP_PalGameSetting`・`DA_BreedingItemEffectData`・配合の処理の逆アセンブル。v1.0 より前の実測 190 体（PalCalc のリポジトリ）と合う |
| 同じ種族どうしの子 | ♂X × ♀X の子は X | ゲームの配合の規則（突然変異を除く） |
| 親の性別で子が変わる組み合わせ | フォレーナ（`FoxMage`）♂ × クレメーオ（`CatMage`）♀ → クレメーナ、フォレーナ♀ × クレメーオ♂ → フォレーオ。この組だけは、登録の性別を入れ替えた向きを同じ子とみなさない（ほかの組み合わせは入れ替えても同じ子とみなす） | 同じビルドの `DT_PalCombiUnique`（全 258 行のうち、親の性別の指定があるのはこの 2 行だけ）。PalCalc の `breeding.json` の性別の規則、PalDB の記述と一致（2026-10-08、Codex で調査し手元でも確認） |

- 使うのは理想個体の提案だけ。配合検索・逆引き・継承ルートは、これまでどおり登録したレコードだけを使う。読み込む場所はテスト（`test/import.test.js`）で限っている
- 異種の配合の候補は、登録済みのレコード（子が目標のもの）だけから出す。配合表（`web/data/breeding.js`）は使わない
- マスター（`pals.js`・`passives.js`）には、これまでどおり遺伝の情報を持たせない
- ゲームの更新で仕組みが変わったら、`web/js/core/ideal.js` の定数と `test/core/ideal.test.js` を見直す

> 変更記録（2026-10-08）: ユーザー指示により、理想個体の提案に限って、遺伝の仕組みの定数と「同じ種族どうしの子は同じ種族」という規則を使うことを許可した。理由: 欲しいパッシブと個体値の子が産まれる確率を比べるには、遺伝の仕組みが欠かせないため。異種の配合は登録済みのレコードだけを使い、登録されていない配合を「既知の配合」として表示することはしない（同じ種族どうしは規則として扱う）。影響: README の「配合の計算式は使いません」に例外ができる。ゲームの更新で仕組みが変わると、提案の確率がずれる。

> 変更記録（2026-10-08）: ユーザー指示により、親の性別が記録された登録（自動登録など）は性別を入れ替えた向きも同じ子が産まれるとみなして候補にし、性別で子が変わるフォレーナ×クレメーオの組だけは除くことにした。理由: ゲームで性別により子が変わるのはこの 1 組だけで、自動登録の向きだけでは候補が半分になるため。影響: `DT_PalCombiUnique` に性別の指定がある行が増えたら、`web/js/core/ideal.js` の `GENDER_DEPENDENT` を見直す。

## 画像の扱い

- 画像はリポジトリにコミットしない。`npm run fetch:icons` で取得し、GitHub Actions の配信時に成果物にだけ入れる。
- 撤回するときは `.github/workflows/pages.yml` から画像の取得を外して再配信し、残っている Actions の成果物を削除する。全パルが SVG アバターに切り替わる。
- 例外: パッシブの表示に使う画像（ランクの矢印 6 枚と背景の三角模様 1 枚、`web/img/passive/`）は、配信時に取得できないためコミットする。ゲーム本体の `Pal-Windows.pak` の `Pal/Content/Pal/Texture/UI/Main_Menu/` から `npm run extract:passive-icons` で取り出したもの（対応は `scripts/extract-passive-icons.mjs` の `PASSIVE_TEXTURES`、v1.0.5 で確認、2026-10-05）。撤回するときは `web/img/passive/` を消す（パッシブ名の表示は残る）。
- 例外: 人間のキャラクターのアイコン（154 枚、`web/img/humans/`）と日本語名（`web/data/humans.js`）も、ゲーム本体から `npm run extract:humans` で取り出してコミットする。表は `DT_PalCharacterIconDataTable_Common`（アイコン）・`DT_PalHumanParameter_Common`（名前の ID）・`DT_HumanNameText_Common`（名前。ゲームの元の言語が日本語）。撤回するときは `web/img/humans/` を消し、`web/data/humans.js` を空の配列（`export default [];`）にする（キャラクター ID の表示に戻る）。

## 手当て

- `PlantSlime_Flower`: 取り込み元では `PlantSlime` と同じ 12 番・同じ名前（ナエモチ）で、画像もない。ゲーム内の図鑑に載っていないことをユーザーが確認した（2026-10-04）ため、`active=false` にしてパル選択に出さない。ID はマスターに残す（この ID を含む行がシートにあっても、マスター外として弾かないため）。
- `ElecSnail_Ground`: 英名が取り込み元どうしで食い違う（Snock Terra / Snock Lux）ため、属性は図鑑ラベル `163B` で突合している。
