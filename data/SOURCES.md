# マスターデータの出典

類似ツールとの機能の対応と、このアプリで作らない機能の理由は [docs/COMPARISON.md](../docs/COMPARISON.md) と下の「[作らない機能](#作らない機能)」にまとめた。

`data/pals.csv`・`web/data/pals.js`・`gas/PalMaster.js` は `npm run build:pals`（`scripts/import-pals.mjs`）で生成する。手で編集しない。
取得元のコミット SHA は `scripts/sources.mjs` で固定している。

| 項目 | 取得元 | ライセンス・権利 |
|---|---|---|
| ID（内部名）・図鑑番号・亜種・日本語名・英名・属性の日本語名 | [tylercamp/palcalc](https://github.com/tylercamp/palcalc) の `PalCalc.Model/db.json` | コードは MIT。データはゲームファイル由来（© Pocketpair, Inc.） |
| 属性 | [MagitekZed/palworld-helper](https://github.com/MagitekZed/palworld-helper) の `data/pals_work_suitability.csv` | リポジトリのライセンスなし。属性は事実情報として利用 |
| パル画像 | 同上の `icons/pals/` | リポジトリのライセンスなし。画像は © Pocketpair, Inc.（ユーザー判断で利用） |
| パッシブの内部名・日本語名・英名・ランク・効果の説明（`data/passives.csv`・`web/data/passives.js`） | PalCalc の同じ `db.json`（`npm run build:passives` = `scripts/import-passives.mjs`） | 同上。日本語名はゲーム本体の `DT_SkillNameText_Common` と一致することを確認（2026-10-05、名前のある 488 件） |
| アクティブスキル・パートナースキルの日本語名と説明文（`web/data/skills.js`） | ゲーム本体の `DT_SkillNameText_Common`・`DT_SkillDescText_Common`・`DT_PalFirstActivatedInfoText` ほか（`npm run extract:skills` = `scripts/extract-skills.mjs`。2026-10-10 に取り出し） | © Pocketpair, Inc. |
| タマゴ・ケーキの日本語名（`web/data/items.js` の `EGG_NAMES`・`CAKE_NAMES`。所持パルのタマゴの行・配合牧場のカードとケーキの残り） | ゲーム本体の `DT_ItemNameText_Common` の `ITEM_NAME_PalEgg_*`・`ITEM_NAME_Cake*`（`npm run extract:skills` = `scripts/extract-skills.mjs`。タマゴは 2026-10-15、ケーキは 2026-10-16 に取り出し） | © Pocketpair, Inc. |
| 作業適性（`web/data/work.js`。パル詳細の「作業適性」の行・所持パルのキーワード「採掘3」） | ゲーム本体の `DT_PalMonsterParameter_Common` の `WorkSuitability_*`（Lv）と `DT_UI_Common_Text_Common` の `COMMON_WORK_SUITABILITY_*`（作業の名前）。型の情報のない表なので、列の並びは実行ファイルの反射データから取る（`npm run extract:work` = `scripts/extract-work.mjs`・`scripts/game-tables.mjs`。v1.0.5 で 2026-10-15 に取り出し） | © Pocketpair, Inc. |

> 変更記録（2026-10-15）: ユーザーの確認を得て、タマゴの日本語名の表（`web/data/items.js`）の行を足した（UI 改善フェーズ 3 の farm-board）。影響: 配信物にゲーム由来の文字列の表が 1 つ増える（画像は増えない）。配合に関する情報（INV-2）は含まない。

> 変更記録（2026-10-16）: ユーザーの決定（UI 改善フェーズ 4 の save-extras。配合牧場のケーキの残りを出す）により、タマゴの日本語名の行を「タマゴ・ケーキの日本語名」にし、同じ表のケーキの名前（`ITEM_NAME_Cake`・`Cake02`〜`Cake05` の 5 件。`CAKE_NAMES`）を同じファイルに足した。影響: 配信物の文字列が 5 件増える（画像は game-assets で取り込み済み）。配合に関する情報（INV-2）は含まない。

> 変更記録（2026-10-15）: ユーザーの決定（UI 改善フェーズ 4 の game-assets）により、作業適性の行を足した。理由: パル詳細と所持パルのキーワードで作業適性を使うため。文書の案（palworld-helper の CSV から `pals.js` に取り込む）ではなく、ゲーム本体の表から別の生成ファイル `web/data/work.js` に取り出した（取り込み元をゲーム本体にそろえ、`pals.js` の項目の許可リストを変えないため）。影響: 配信物にゲーム由来の表が 1 つ増える（約 18KB）。同じ表にある配合の値（`CombiRank` など）は書き出さない（下の「取り込まないもの」。`test/import.test.js` が値の形を確かめる）。

## セーブの読み込みに使うコード

| 部分 | 元にしたもの | ライセンス |
|---|---|---|
| Oodle の展開（`web/js/save/oodle.js`） | [oozextract](https://github.com/lvlvllvlvllvlvl/oozextract) 0.4.2（Rust）を JavaScript に移植 | MIT（oozextract の Cargo.toml の表記）。oozextract のリポジトリにある Silesia コーパスの Kraken・Mermaid・Selkie・Leviathan と実際のセーブで、別の展開ツール（pyooz）の結果とバイト単位で一致することを確認（2026-10-05） |
| GVAS とセーブの構造（`web/js/save/gvas.js`・`palworld.js`） | [PalworldSaveTools](https://github.com/deafdudecomputers/PalworldSaveTools) の `palsav` の読み取り処理を参考に独自に実装 | 参考元は MIT |

セーブの構成は [SAVE_FORMAT.md](../docs/SAVE_FORMAT.md) にまとめた。

## 取り込まないもの（INV-2）

パルとパッシブのマスターには、配合に関する情報を持たせない。`BreedingPower` などの配合計算に使える値や、パッシブの遺伝の確率（`RandomInheritanceWeight` など）は取り込まない。作業適性（`web/data/work.js`）を取り出すゲーム本体の表（`DT_PalMonsterParameter_Common`）にある配合の値（`CombiRank`・`MaleProbability` など）も取り込まない（取り出しは `WorkSuitability_*` の列だけを残す）。
このアプリで「既知の配合」とみなし、画面に表示・検索するのは、利用者が登録したレコードだけ。

### 作らない機能

類似ツールにあっても、このアプリでは作らないもの（同じ検討を繰り返さないため。ほかのツールとの対応は [docs/COMPARISON.md](../docs/COMPARISON.md)）。

- 配合表の表示（登録していない配合の結果を、検索・候補・通知に出すこと）: 自分たちが試した配合だけを出すため。配合表は下の例外のとおり、自動登録の照合にだけ使う
- 配合ランク（`BreedingPower`）を使った計算・並べ替え: 上のとおり、配合の計算に使える値を取り込まない
- 突然変異の予測: 登録していない配合の結果を出すことになる
- 外部の配合表（攻略サイト）へのリンク: 画面から、登録していない配合へ誘導しない
- 継承ルートの経由・回避するパルの指定と、完成までの所要時間の目安: INV-2 ではなく使い勝手の判断で見送った（回避は前に消した「相手親の除外」と同じになる。所要時間はワールドの設定や孵化の時間で大きく変わり、誤解を招く）

> 変更記録（2026-10-14）: UI 改善の片付けで類似ツールとの対応表（docs/COMPARISON.md）を作るのに合わせて「作らない機能」を足し、冒頭からリンクした。理由: INV-2 で使えない機能（配合表・配合ランク・突然変異の予測・外部の配合表へのリンク）と見送った機能が、検討のたびに候補に上がっていたため。あわせて、画面からなくなった並べ方の名前「世代を重ねて最短の順」を、下の例外の節で今の言い方（子を入れ替えながら作る世代の計算）に直した。影響: 規則そのもの（取り込むもの・取り込まないもの・例外の範囲）は変えていない。

### 例外: 自動登録の照合に使う配合表

| 項目 | 取得元 | ライセンス・権利 |
|---|---|---|
| 親の組み合わせ → 子（`web/data/breeding.js`） | PalCalc の `PalCalc.Model/breeding.json`（同じ固定 SHA。`npm run build:breeding` = `scripts/import-breeding.mjs`） | コードは MIT。データはゲームファイル由来（© Pocketpair, Inc.） |

- 使うのは、配合牧場からの自動登録で「タマゴの中身が、親の組み合わせどおりか」を照合するときだけ（`web/js/auto-register.js`）。合ったものだけを、利用者の配合として登録する
- ただし突然変異タマゴ（アイテムの ID が `PalEgg_MutationPal` で始まる。中身は親と関係ない）は中身を照合せず、牧場の上で前に読んだときと同じ親のもとに新しく現れたものだけを、その親の組み合わせの配合表の子として登録する（親の組で産んだことは確かなため。中身の種族は登録にも通知にも出さない。牧場の外で見つかった突然変異タマゴは使わない。`web/js/core/auto-breeding.js` の `isMutationEgg`）
- 画面での表示・検索・候補の提示には使わない。読み込める場所はテスト（`test/import.test.js`）で限っている
- 登録されるのは、実際に牧場で産まれたタマゴの結果だけなので、「自分が試したものだけを表示する」という INV-2 の意図は変わらない

> 変更記録（2026-10-15）: UI 改善のフェーズ 1d の終わりのレビューで、前からの動き（突然変異タマゴは中身を照合せず、親の組み合わせの配合表の子として登録する）がこの節に書かれておらず、README の「試した配合だけ」・docs/COMPARISON.md の「照合にだけ配合表を使う」と食い違って読めたので、事実として 1 文足した（README と COMPARISON もこの文に合わせた）。影響: 規則・例外の範囲とコードの動きは変えていない。

> 変更記録（2026-10-06）: ユーザー指示により、配合牧場からの自動登録の照合用に限って `breeding.json` の取り込みを許可した。理由: もともと取り込まなかったのは「自分が試したものだけを表示する」ためで、照合にだけ使うならその意図に反しないため。影響: `web/data/breeding.js`（約 120 KB）が配信物に入る（自動登録が動くときだけ読み込む）。PalCalc の更新に合わせて `npm run build:breeding` で作り直す。

### 例外: 理想個体の提案に使う遺伝の仕組み

「理想個体」タブ（`web/js/views/ideal.js`）では、所持パルのどの 2 体を配合すると、欲しいパッシブと個体値の子が産まれやすいかを確率で出す。そのために、次のものを `web/js/core/ideal.js` に定数・規則として持つ。

| 項目 | 内容 | 確認したもの |
|---|---|---|
| パッシブの遺伝 | 両親のパッシブの和集合（重複を除く）から 1〜4 個（40/30/20/10%）を同じ確率で選んで継ぎ、枠が残れば 0〜3 個（40/30/20/10%）をランダムに足す。どちらの親が持つパッシブかは見ない（親 A のリストに、親 B のうち入っていないものを足した和集合から、取り除きながら同じ確率で選ぶ）。スペシャルケーキは継ぐ数を抽選せず 4 個まで継ぐ | Palworld v1.0.5（Steam build 25246127）の `BP_PalGameSetting`（`Combi_PassiveInheritNum`・`Combi_PassiveRandomAddNum`）、`DA_BreedingItemEffectData`、配合の処理の逆アセンブル（パッシブを継ぐ処理は RVA 0x2E8F8A0）。PalCalc の `README-PALWORLD-MECHANICS.md` と一致 |
| 個体値の遺伝 | ステータスごとに、どちらかの親の値（50/50）を写すか 0〜100 の乱数。写すステータスの組み合わせは `Combi_TalentInheritNum = [3, 2, 1]` と処理の分岐から（HP 2/3・攻撃と防御 5/9）。キノコケーキ・豪華野菜ケーキは +1〜5 | 同じビルドの `BP_PalGameSetting`・`DA_BreedingItemEffectData`・配合の処理の逆アセンブル。v1.0 より前の実測 190 体（PalCalc のリポジトリ）と合う |
| 同じ種族どうしの子 | ♂X × ♀X の子は X | ゲームの配合の規則（突然変異を除く） |
| 親の性別で子が変わる組み合わせ | フォレーナ（`FoxMage`）♂ × クレメーオ（`CatMage`）♀ → クレメーナ、フォレーナ♀ × クレメーオ♂ → フォレーオ。この組だけは、登録の性別を入れ替えた向きを同じ子とみなさない（ほかの組み合わせは入れ替えても同じ子とみなす） | 同じビルドの `DT_PalCombiUnique`（全 258 行のうち、親の性別の指定があるのはこの 2 行だけ）。PalCalc の `breeding.json` の性別の規則、PalDB の記述と一致（2026-10-08、Codex で調査し手元でも確認） |

- 使うのは理想個体の提案だけ。配合検索・逆引き・継承ルートは、これまでどおり登録したレコードだけを使う。読み込む場所はテスト（`test/import.test.js`）で限っている
- 異種の配合の候補は、登録済みのレコード（子が目標のもの）だけから出す。配合表（`web/data/breeding.js`）は使わない
- マスター（`pals.js`・`passives.js`）には、これまでどおり遺伝の情報を持たせない
- 子を入れ替えながら作る世代の計算（子を親と入れ替えながら完成品までのタマゴの平均を求める）も、同じ遺伝の仕組みで計算する。対象は、同じ種族で、両親合わせて欲しいパッシブがそろう組（どちらの親が持っていても同じ。上のパッシブの遺伝のとおり）。加えて置く仮定は次の 2 つ
  - 子の性別が半々であること。ゲームは種族ごとのオスの確率（`MaleProbability`）で子の性別を決め、親の性別は見ない（同じビルドの配合の処理の逆アセンブル、RVA 0x2E89200）が、計算は半々の近似のまま
  - ランダムに足されるパッシブが、欲しいものでも親の余計なものでもない新しいパッシブであること。ゲームは、継いだもの以外の候補（`AddPal` の 85 件。不死身・伝説・世界樹は入らない）から重み付きで選ぶ（RVA 0x3150BE0）ので、欲しいもの・親の余計なものが偶然付くこともわずかにある。計算はその分を数えない（下限）
- 配合牧場の交換推奨は、各牧場の「1÷完成までの平均」（完全体作成組以外は 1 個のタマゴで完成する確率）の合計を全体の速さの目安にし、それが上がるときだけ勧める。目安なので、入れ替えながら作る過程や牧場どうしの子の融通は数えない（牧場が 1 か所なら正確）。同じ組み合わせで別の子も登録されている組が関わる牧場は、速さが目標の産まれる前提の値なので比べず、おすすめの順のとおりにする。この判定（`web/js/core/ideal-farms.js`）は遺伝の仕組みを持たず、`web/js/core/ideal.js` が求めた数だけを比べる
- ゲームの更新で仕組みが変わったら、`web/js/core/ideal.js` の定数と `test/core/ideal.test.js` を見直す

> 変更記録（2026-10-12）: ユーザー指示により、理想個体の「完全体作成組」（子を入れ替えながら作る世代の計算）を、両親それぞれが欲しいパッシブを全部持つ組から、同じ種族で両親合わせて欲しいパッシブがそろう組に広げ、配合牧場の交換推奨と「変更あり」を全体の速さの目安が上がるときだけにした。上の 4 点（パッシブはどちらの親かを見ないこと・ランダムに足す分は下限であること・子の性別は種族ごとの確率で計算は半々の近似であること・交換推奨は目安であること）は、そのためにゲームファイル（v1.0.5 build 25246127）の配合の処理を逆アセンブルし直して確かめ、書き足した。理由: 欲しいパッシブを一部しか持たない個体との組の方が早いのに、交換推奨が出なかった（平均が同じ組でも、個体値の期待値や個体 ID の差だけで交換推奨が出ていた）ため。例外の範囲（理想個体の提案だけ・異種は登録済みのレコードだけ）は広げていない。影響: 和集合がそろう組で世代の表が大きくなり、条件を変えて初めて計算するときに時間がかかることがある（表は 8 件まで覚える）。性別の比を取り込むかは、これまでどおり後回し。

> 変更記録（2026-10-08）: ユーザー指示により、理想個体の提案に限って、遺伝の仕組みの定数と「同じ種族どうしの子は同じ種族」という規則を使うことを許可した。理由: 欲しいパッシブと個体値の子が産まれる確率を比べるには、遺伝の仕組みが欠かせないため。異種の配合は登録済みのレコードだけを使い、登録されていない配合を「既知の配合」として表示することはしない（同じ種族どうしは規則として扱う）。影響: README の「配合の計算式は使いません」に例外ができる。ゲームの更新で仕組みが変わると、提案の確率がずれる。

> 変更記録（2026-10-08）: ユーザー指示により、理想個体のアルファの条件をなくしたので、アルファの子の確率 5% は使わなくなった（表から外した）。影響: なし（理想個体の確率は、これまでどおり遺伝の仕組みの定数だけで計算する）。

> 変更記録（2026-10-08）: ユーザー指示により、理想個体のアルファの条件（アルファだけ／アルファ以外）を確率に入れるため、アルファの子の確率 5% を使うことにした。理由: 配合でもアルファが産まれ、アルファだけを狙う人には確率が 20 分の 1 になるため。ほかの定数と違い、ゲーム本体のデータでは確かめていない（wiki.gg・コミュニティの値）。影響: 実際の確率が違えば、アルファの条件を付けたときの確率と並びがずれる。

> 変更記録（2026-10-08）: ユーザー指示により、親の性別が記録された登録（自動登録など）は性別を入れ替えた向きも同じ子が産まれるとみなして候補にし、性別で子が変わるフォレーナ×クレメーオの組だけは除くことにした。理由: ゲームで性別により子が変わるのはこの 1 組だけで、自動登録の向きだけでは候補が半分になるため。影響: `DT_PalCombiUnique` に性別の指定がある行が増えたら、`web/js/core/ideal.js` の `GENDER_DEPENDENT` を見直す。

## 画像の扱い

- 画像はリポジトリにコミットしない。`npm run fetch:icons` で取得し、GitHub Actions の配信時に成果物にだけ入れる。
- 撤回するときは `.github/workflows/pages.yml` から画像の取得を外して再配信し、残っている Actions の成果物を削除する。全パルが SVG アバターに切り替わる。
- 例外: パッシブの表示に使う画像（ランクの矢印 6 枚と背景の三角模様 1 枚、`web/img/passive/`）は、配信時に取得できないためコミットする。ゲーム本体の `Pal-Windows.pak` の `Pal/Content/Pal/Texture/UI/Main_Menu/` から `npm run extract:passive-icons` で取り出したもの（対応は `scripts/extract-passive-icons.mjs` の `PASSIVE_TEXTURES`、v1.0.5 で確認、2026-10-05）。撤回するときは `web/img/passive/` を消す（パッシブ名の表示は残る）。
- 例外: 人間のキャラクターのアイコン（154 枚、`web/img/humans/`）と日本語名（`web/data/humans.js`）も、ゲーム本体から `npm run extract:humans` で取り出してコミットする。表は `DT_PalCharacterIconDataTable_Common`（アイコン）・`DT_PalHumanParameter_Common`（名前の ID）・`DT_HumanNameText_Common`（名前。ゲームの元の言語が日本語）。撤回するときは `web/img/humans/` を消し、`web/data/humans.js` を空の配列（`export default [];`）にする（キャラクター ID の表示に戻る）。
- 例外: UI のアイコン（44 枚、`web/img/{element,work,item,ui}/`。属性・作業適性・タマゴ・ケーキ・配合牧場・性別の記号と、後の implants で使うインプラント・パルリバーサー）も、ゲーム本体の `Pal-Windows.pak` から `npm run extract:ui-icons` で取り出し、表示の 2 倍の大きさに縮めてコミットする（対応は `scripts/extract-ui-icons.mjs` の `UI_ICONS`。v1.0.5 で確認、2026-10-15）。取り出す前に `--list <接頭辞>` で実在と形式を確かめる。撤回するときは `web/img/{element,work,item,ui}/` の 4 つのフォルダを消す（属性は文字のチップ、性別は文字の ♂♀ の丸い印、ほかはアイコンなしの文字の表示に戻る）。
  - 新しく足す画像（この 4 つのフォルダ）は合計 200KB まで（2026-10-15 は 44 枚・約 88KB。取り出しのスクリプトは超えたら止まり、`test/static/extract-ui-icons.test.js` も確かめる）。

| 置き場所 | 中身 | テクスチャ（`Pal/Content/` の下） | 元の形式・大きさ → 書き出し |
|---|---|---|---|
| `element/〈属性〉.png`（9） | 属性（ひし形の地つき） | `Pal/Texture/UI/InGame/T_Icon_element_s_00`〜`08`（00 無・01 炎・02 水・03 雷・04 草・05 闇・06 竜・07 地・08 氷。ゲームの `WBP_PalElementIcon` の IconMap で確かめた対応。列挙の順とは違う） | DXT5 48×48 → 40 |
| `work/〈作業の鍵〉.png`（12） | 作業適性 | `Pal/Texture/UI/InGame/T_icon_palwork_00`〜`12`（`WBP_IconPalWork` の IconMap。09 の原油抽出は使うパルがいないので取り出さない） | DXT5 64×64 → 32 |
| `item/egg-〈種類〉.png`（12） | タマゴ（無属性 Normal・Dark・Dragon・Earth・Electricity・Fire・Ice・Leaf・Water・WorldTree・突然変異 MutationPal・中身不明 Unknown） | `Others/InventoryItemIcon/Texture/T_itemicon_Material_PalEgg`（無属性）・`…_PalEgg_〈種類〉_01`・`…_PalEgg_MutationPal`・`…_PalEgg_Unknown`（大きいタマゴも同じアイコン） | DXT5 256 → 40 |
| `item/cake-〈アイテム ID〉.png`（5） | ケーキ（Cake・Cake02〜05） | 同じ所の `T_itemicon_Food_Cake`・`T_itemicon_food_Cake02`〜`05` | DXT5 256 → 40 |
| `item/PalPassiveSkillChange.png`・`…_Consumable.png`・`item/PalGenderReverse.png` | インプラント 2・パルリバーサー（implants で使う） | 同じ所の `T_itemicon_Material_PalPassiveSkillChange`（`_Consumable`）・`T_itemicon_Material_PalGenderReverse` | DXT5 256 → 48 |
| `ui/breed-farm.png` | 配合牧場 | `Pal/Texture/BuildObject/PNG/T_icon_buildObject_BreedFarm` | DXT5 256 → 40 |
| `ui/gender-M.png`・`ui/gender-F.png` | 性別の記号（形だけ使い、色は CSS のトークン） | `Pal/Texture/UI/Main_Menu/T_Icon_PanGender_Male`・`_Female` | B8G8R8A8 34×34 → 32 |

### 置き場所ごとの画像の作り方

| 置き場所 | 作り方 |
|---|---|
| ファビコン・ヘッダーのロゴ | 手描きの SVG（アプリ独自の印。ゲームのロゴやパルスフィアは使わない）。ファビコン（`web/favicon.svg`）は SVG の中の `@media (prefers-color-scheme: dark)` でダークの色にする。Codex の画像生成は下絵にだけ使ってよい |
| 左のナビのアイコン・操作のボタン（編集・削除・ベル）・閉じるなどの記号 | 手描きの SVG（`web/js/ui/icons.js`。24px の格子・線 2・色は文字色〔currentColor〕） |
| 空の状態の絵 | 新しく描かない。そのタブのナビのアイコン |
| 図鑑の未登録の影 | パル画像（実物の webp）に CSS の filter |
| 属性・作業適性・ケーキ・タマゴ・牧場・性別 | ゲームの実物（上の例外の UI のアイコン。`web/js/ui/pal-icon.js` の `gameIcon`・`elementIcon` など）。読めないときは文字の表示（手描きで似せた絵は作らない） |
| 性別 | 丸い印はゲームの記号の形（`mask-image`）を色のトークン（`--gender-male`・`--gender-female`。`web/css/app.css`）で塗る。文の中の印（`.gender-inline`）と、画像が読めないときは文字の ♂♀ |
| パル画像・パッシブの画像・人間のアイコン・代わりのアバター | 今のまま（上の節のとおり） |

Codex の画像生成で作った画像は、配信する画像には使わない（ゲームの実物と並べると絵柄が浮き、ライトとダークで色も変えられないため）。

> 変更記録（2026-10-15）: ユーザーの決定（UI 改善フェーズ 4 の game-assets）により、UI のアイコン 44 枚（属性 9・作業適性 12・タマゴ 12・ケーキ 5・配合牧場 1・性別 2・インプラント 2・パルリバーサー 1）を例外に足し、合計の上限（200KB）の 1 行と、置き場所ごとの表の「属性・作業適性…」「性別」の行を実物に直した。理由: 文字や色で代用していた記号を、ゲームと同じ見た目にするため（後の implants の画像も同じ道具で一度に取り出した）。影響: 配信物とリポジトリに約 88KB の画像が増える。撤回は 4 つのフォルダを消すだけで、画面は前の文字の表示に戻る。

> 変更記録（2026-10-14）: UI 改善（visual-parts）で、アイコンを `web/js/ui/icons.js` に集め、ファビコンをダークに対応させたのに合わせて「置き場所ごとの画像の作り方」の表と、生成画像を配信物に使わない決まりを足した。理由: 画像の置き場所ごとの作り方が決まっておらず、ゲームの実物・手描きの SVG・生成画像のどれを使うかが、検討のたびに候補に上がっていたため。影響: 規則そのもの（取り込むもの・取り込まないもの・例外の範囲）は変えていない。配信物に生成画像が入らないことを決まりにした。

## 手当て

- `PlantSlime_Flower`: 取り込み元では `PlantSlime` と同じ 12 番・同じ名前（ナエモチ）で、画像もない。ゲーム内の図鑑に載っていないことをユーザーが確認した（2026-10-04）ため、`active=false` にしてパル選択に出さない。ID はマスターに残す（この ID を含む行がシートにあっても、マスター外として弾かないため）。
- `ElecSnail_Ground`: 英名が取り込み元どうしで食い違う（Snock Terra / Snock Lux）ため、属性は図鑑ラベル `163B` で突合している。
