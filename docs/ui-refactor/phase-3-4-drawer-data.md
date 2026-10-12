# フェーズ 3・4: ドロワーと横断の導線／セーブ情報・ゲーム素材・新機能（実装ドキュメント）

> この文書だけを読めば、フェーズ 3・4 の各テーマを経緯も含めて把握し、そのまま着手できるように書いている。
> 書いた日: 2026-10-12。コードの行番号は `main`（c5c0683）を開いて確かめたもの。フェーズ 1・2 の実装で行がずれるので、着手時に必ず開き直す。

## 0. この文書の読み方

### 0-1. 正となる材料（迷ったらここへ戻る）

| 材料 | 場所 | 使いどころ |
|---|---|---|
| 統合プラン（決定事項 D1〜D8・全テーマの表・判断事項・共通の受け入れ条件） | `~/.claude/plans/ui-jaunty-lampson.md`（写し: [appendix/plan-snapshot.md](appendix/plan-snapshot.md)） | テーマの範囲。ここに書いた手順と食い違ったら統合プランの決定事項が優先 |
| 別セッション（Fable 5.1）のプラン（F 番号・§9 の Codex 指摘の決まり） | `~/.claude/plans/pasted-content-id-901c-mossy-quail.md`（写し: [appendix/other-session-plan.md](appendix/other-session-plan.md)） | F 番号の元の提案、§9「実装時に必ず守る決定事項」 |
| 採用した案の全件（現状・直し・根拠・検証メモ） | [appendix/catalog.md](appendix/catalog.md) のフェーズ 3（9512 行目〜）・フェーズ 4（10727 行目〜） | 案 ID（S-04 など）の詳細 |
| Codex のプランレビュー 7 回 | [appendix/codex-reviews.md](appendix/codex-reviews.md) | 「なぜこの形か」の根拠（例: farm-data を route-progress より前に分けた理由） |
| 画面の実測 | [appendix/measurements.md](appendix/measurements.md) | 計測の手順・基準値 |
| 却下した案 | [appendix/rejected.md](appendix/rejected.md) | 「やらないこと」の根拠 |

### 0-2. フェーズ 1・2 で入る土台（この文書が前提にする名前）

フェーズ 3・4 は、フェーズ 1・2 の土台の上に作る。下の名前は統合プランで決めたもの。**実装済みの名前が違っていたら、フェーズ 1・2 の文書とコードを正とし、この文書の手順を読み替える。**

| 土台 | 入るテーマ | この文書での使い方 |
|---|---|---|
| `context.update(hash)`、ビューの `applyRoute(route)` と `update(state)` の分離、遷移の理由（タブ・画面内の条件変更・戻る/進む）の区別、replaceState でも history.state を保つ | render-contract（1a） | ドロワーは currentView と別に持ち、URL の変化でビューを作り直してもドロワーを壊さない |
| ヘッダーの高さ・重なり順の CSS 変数（ヘッダー・固定のパネル・候補・レール・トースト・ダイアログ・ドロワー）、セーブ連携の状態のポップオーバー | header-frame（1a） | ドロワーの `top` と `z-index`、接続中の仲間（F006）の表示先 |
| `ui/dom.js` の `syncList(container, items, { key, create })`（`create` は `{element, update, destroy}`）、画面用の変更番号、区切って描く仕事の無効化 | stable-render（1a） | ドロワーの中の一覧・図鑑の格子・牧場ボードの差分更新 |
| history.state にはエントリの ID だけを入れ、条件とスクロール位置（版・環境・利用者・ワールドつき）は sessionStorage にエントリごとに持つ（phase-1a の「プランと違っていた点」13） | keep-state（1a） | ドロワーの状態を history.state に**足す**（上書きしない） |
| `ui/popover.js`（固定配置・`{element, update, destroy}`・AbortController）、パル選択の所持数・登録件数・検索の拡張、パッシブ選択の 1 行部品 | popovers（1a） | ホバーの解説（F059）、ヘッダーのパル検索、パル詳細のパル切り替え |
| 牧場の状態の保持（`status: 'uncertain'` を捨てない）と完全性の判定、牧場の A／B の記号 | ideal-farms（1b） | farm-data・farm-board・route-progress がそのまま使う |
| 所持パルの場所チップ（手持ち・パルボックス・拠点・次元・タマゴ・グローバル）と URL の表現、所持者の意味を palsOfPlayers にそろえる | owned-toolbar（1c） | 所持パルへのリンク（完成した目標・孵化待ちのタマゴ・牧場） |
| `ownedRow` の `{element, update, destroy}` 化、個体値の 4 セル＋ミニバー、★4 枠、パッシブ 2×2、場所の 6×5 SVG（正規化に page/row/col）、行のホバーの操作 | owned-rows（1c） | 個体の詳細（owned-detail）・パル詳細の上位 5 体・牧場の親 |
| 「このワールドでの自分」と `ownPlayerUids` の変更 | participant-self（1d） | 捕獲数（S-14）を自分の分だけ出す |
| 見出しの整理（パル詳細はパル名）・`setupHint({ text, action })`・用語表 | copy-dead-ends（1d） | 文言はこの用語表に従う |
| 性別の `genderMark()`・状態チップの共通部品・`ui/icons.js` | visual-parts（1d） | ゲームのアイコン（game-assets）を差し込む先 |
| 「配合を探す」1 画面（`#/search?p1=&p2=&c=`）と旧 URL の読み替え | find-merge（2） | パル詳細の「すべて見る」のリンク先・F015 の展開先 |
| 「＋ 登録」の文脈ボタン（パル詳細の「この子の配合を登録」） | register-entry（2） | そのまま使う |
| 目標の一覧（ダイアログ）・種族だけの目標・観測の状態（`goalsObs`） | goals-merge（2） | 「目標にする」ボタン・goals-detail |
| 所持数と親になれる数の共通の集計（core/owned.js） | owned-overlay（2） | パル詳細の所持の 1 行 |
| 継承ルートの開始チップへの一本化・経路を所持個体の欄より上へ | route-cleanup（2） | route-progress の差し込み先 |

### 0-3. 全テーマ共通の受け入れ条件（統合プランから。どのテーマでも守る）

- **INV-2**: 配合の候補は登録済みの記録だけから引く。配合表（`web/data/breeding.js`）を読めるのは自動登録だけ、遺伝の仕組み（`web/js/core/ideal.js`）を読めるのは `web/js/views/ideal.js` だけ（`test/import.test.js:27-44` で固定）。**タマゴの中身を「A×B→C」の式で出さない**（親の組から子を予測して見せない）。
- **セキュリティ**: innerHTML・outerHTML・insertAdjacentHTML と style 属性の文字列を使わない（`test/static/security.test.js:15-22`）。SVG は `createElementNS`、名前や説明は `textContent`、動的な配置は `style.setProperty('--x', …)`。画像はビルド時に取り込んで `web/img/` に置き、CSP（`web/index.html:6`）は緩めない。
- **保存データ**: 新しく保存・共有する値は data-boundary の検証を通す。古い IndexedDB・古い共有データ・古い通知・古い sessionStorage・旧コードのタブが混ざっても壊れない。
- **性能の予算**（Chrome で測る）: 所持パル 2,000 行で最初の 200 行が 100ms 以内・全行が 1 秒以内、DOM 80,000 ノード以下・JS ヒープの増加 150MB 以下。2,000 行を超えたら見えている範囲だけ描く。20,000 行・偏った種族の分布でも入力が 100ms 以上止まらない。**予算を超えたら、そのテーマを終えずに直す。**
- **進め方**: 1 テーマ＝1 ブランチ（`feature/<テーマ key>`）→ 日本語のコミット → `main` に `--no-ff` でマージ。push と配信はユーザーの確認後。振る舞いが変わる所はテストを先に直す・足す → 実装 → `npm test` → モックで画面を確かめる → `web/js/release-notes.js` の先頭に 1 件（title 20 字・body 60 字以内。`web/js/notifications.js:6-7` の `TITLE_MAX`・`BODY_MAX`。超えると `npm test` が落ちる）。`id` は一度出したら変えない。release-notes の id の日付は、実装した日に置き換える（この文書では `YYYY-MM-DD` と書く）。
- **GAS の変更**は、仲間に共有すると決めたデータ（farm-data・save-extras の一部）だけ。反映（`npm run gas:push`、列を足したときは GAS エディタで `setup()`）はユーザーの操作が要る。**クライアントを先に配信しても壊れない形にする**（下の 0-4）。
- **フェーズ 4 の前提**: どのテーマも、先に実際のセーブ（`npm run check:save -- "<ワールドのフォルダ>"`。読み取りのみ）とゲーム本体で項目・形式を確かめてから作る。項目がない・テクスチャの形式が違うときは、その案を止めてユーザーに報告する。確かめた結果は `docs/SAVE_FORMAT.md` に書く。
- **フェーズの終わり**: 観点別のエージェントと Codex（読み取り専用）で差分をレビューし、直してから次へ。`npm run test:perf` も流す。

### 0-4. 共有データを広げるときの決まり（farm-data・save-extras・implants で共通）

コードで確かめた事実（統合プランに書かれていない注意）:

1. **GAS は知らない最上位の項目を受け付けない**。`gas/Owned.js:77-78` は `OWNED_UPLOAD_FIELDS_`（`gas/Owned.js:7`）にない項目があると `UNKNOWN_FIELD` で共有全体を断る。新しいクライアントが古い GAS に新しい最上位の項目を送ると、所持パルの共有そのものが止まる。
2. **牧場の JSON の中の知らない項目は、古い GAS が黙って捨てる**。`cleanOwnedFarms`（`web/js/core/owned-shared.js:22-33`。`npm run build:gas` で `gas/Shared.js:89-99` に写る）は `id`・`baseId`・`parents` だけを残す。プレイヤーの JSON も `validateOwnedUpload`（`owned-shared.js:86`）が `uid`・`name` だけを残す。
3. したがって、**新しい値は既存の `farms` の各牧場・`players` の各プレイヤーの中に足す**（古い GAS では落ちるだけで、今の表示に戻る）。新しい列（個体の列・ワールドの列）が要るときは、`OWNED_ADDED_FIELDS`（`owned-shared.js:13`）の仕組みで末尾に足し、`setup()` をやり直すまで GAS は書かずに読む（今の `skillIds` と同じ）。
4. ワールドの行の `farms` の列はすでにある（`gas/Sheets.js:35` の `OWNED_WORLD_OPTIONAL_HEADERS_ = ['farms']`）。**farms の中身を広げるだけなら `setup()` は要らず、`npm run gas:push` だけでよい**（統合プランの farm-data の「setup() のやり直しが要る」は、farms の列がないシートのときだけ）。
5. スプレッドシートの 1 セルは 50,000 字まで。`OWNED_MAX_FARMS = 200` は「1 件 180 字」の見積もり（`owned-shared.js:17-19`）で、タマゴを足すと保証が崩れる。上限の扱いは farm-data で決める。
6. **画面の読み戻しの検証も、知っている項目だけを写す**（data-boundary の実装、2026-10-12 追記）。共有のワールドの行は core/boundary.js の `cleanWorld`（GAS の `readOwnedWorlds_` と同じ項目）、プレイヤーは `cleanSharedPlayers`（uid・name）、拠点は `cleanSharedBases`（id・label）が写す。**ワールドの行・プレイヤー・拠点に項目を足すときは、ここにも足す**（足さないと、GAS が返しても画面で落ちる）。牧場は `cleanOwnedFarms` を通すので、farm-data がそちらを広げればそのまま通る。個体の列は `cleanOwnedPayload` が列名ごとに 200 字（`skillIds` は 1000 字）で残すので、長い列を足すときは core/boundary.js の `CELL_LONG` にも足す。手元のセーブ（IndexedDB）の要素ごとの検証は core/owned.js の `normalizeOwned` で行う（owned.js の `cleanLocalData` は外形だけ）。

## 1. フェーズの目的とテーマの順番

### フェーズ 3: ドロワーと横断の導線（D3）

- **目的**: 「他の内容を見ながら参照する」共通の土台として、右のサイドドロワー（非モーダル・本文に重ねて押し出さない。D3）を作り、パル詳細・個体の詳細・牧場・相手親の個体を、今の画面を見たまま確かめられるようにする。あわせて、セーブにあるのに捨てている牧場のタマゴを残し（farm-data）、牧場・継承ルート・目標の「進み具合」を手入力なしで見せる。
- **順番（依存の順）**:
  1. **drawer**（土台）← header-frame・render-contract・keep-state・popovers・stable-render
  2. **pal-detail** ← drawer・goals-merge・find-merge・register-entry・owned-overlay・owned-rows
  3. **owned-detail** ← drawer・owned-rows
  4. **farm-data** ← data-boundary・ideal-farms（drawer とは独立。順番を前にしてもよい）
  5. **farm-board** ← farm-data・owned-rows・owned-toolbar・goals-merge・drawer
  6. **route-progress** ← route-cleanup・farm-data・drawer・find-merge・owned-overlay
  7. **goals-detail** ← goals-merge・owned-rows・owned-toolbar・ideal-panel

### フェーズ 4: セーブ情報・ゲーム素材・新機能

- **目的**: セーブから読めるのに使っていない情報（入手時刻・お気に入り・接続中の仲間・Day・ケーキの残り・手術台の在庫・捕獲数）と、ゲーム本体の素材（属性・作業適性・卵・ケーキ・牧場・性別のアイコン、手術台の表）を取り込み、ゲームと同じ見た目と「仲間で共有」を伸ばす。どれも配合の計算式は使わない（INV-2）。
- **順番（依存の順）**:
  8. **game-assets** ← visual-parts（pal-detail・popovers・owned-rows・ideal-panel・farm-board の表示先があると効果が出る）
  9. **save-extras** ← owned-rows・data-boundary・header-frame・owned-detail・farm-board
  10. **implants** ← ideal-results・goals-detail・route-progress（同じ欄の文言を触る）・save-extras（アイテムの入れ物の読み方）・ideal-calc（完全体作成組の定義。パルリバーサーの案内の計算が使う）
  11. **paldex** ← pal-detail・drawer（game-assets の後だと属性アイコンも使える）
  12. **任意**（F047 目標の共有・F085 元に戻す 8 秒と Ctrl+Z・F086 空の状態の線画・F033 継承ルートの横の経路図）。ユーザーが採ると決めたものだけ。

### 新しく読むデータの共有範囲（統合プランの決定。フェーズ 3・4 の全テーマで守る）

| データ | 共有の範囲 | テーマ |
|---|---|---|
| 牧場のタマゴ（中身の種族・突然変異・個数） | 共有（farms の JSON） | farm-data |
| タマゴのアイテム ID（名前・突然変異のバッジ） | 共有（個体の列を末尾に足す） | farm-board |
| 入手時刻・お気に入り | 共有（`OWNED_ADDED_FIELDS` で足す） | save-extras |
| 接続中の仲間・Day・Lv | ホストの画面。参加者に出すなら共有（players の JSON とワールドの列） | save-extras |
| インプラント・パルリバーサー・ケーキの在庫、牧場のケーキの残り | ホストだけ（共有しない） | save-extras・implants |
| 捕獲数 | 読み込んだ人の分だけ（共有しない） | paldex |

## 2. この文書で、コードを確かめてプランと違っていた点・プランにない注意

| # | 内容 | 根拠 | この文書での扱い |
|---|---|---|---|
| 1 | CSS 変数 `--drawer` はすでに**左のレールの幅**（96px）に使われている | `web/css/app.css:60`・`:236`・`:292`・`:1227` | 右のドロワーは `--side-drawer-width` など別の名前にする（drawer） |
| 2 | 非モーダルの `<dialog>` でドロワーを作ると、トーストが一番手前の `dialog[open]` に出る仕組みに吸い込まれる。テストの偽 DOM には `show()` がない | `web/js/ui/toast.js:7`、`test/helpers/dom.js:110`（`showModal` だけ） | ドロワーは `<aside>` で作る（drawer） |
| 3 | farm-data の「setup() のやり直しが要る」は、farms の列がすでにあるので通常は不要。必要なのは `npm run gas:push` | `gas/Sheets.js:35` | farm-data。ただし farm-board・save-extras で個体の列を足すときは `setup()` が要る |
| 4 | GAS は知らない最上位の項目で共有全体を断る | `gas/Owned.js:77-78` | 0-4 の決まり。「一部だけ」の印は牧場の中に持つ（farm-data） |
| 5 | セーブの解析は 1 牧場あたりタマゴ 64 個まで読む（「20 個で止まる」は wiki の値で未確認） | `web/js/save/palworld.js:259` の `MAX_FARM_EGGS = 64` | 共有は 20 個まで（統合プランどおり）。「もうすぐいっぱい」はゲームで上限を確かめてから（farm-board） |
| 6 | 接続中の判定に要る `worldSaveData.GameTimeSaveData.RealDateTimeTicks` は、Level.sav の読み取りの許可リストにない。`Players/*.sav` の `LastOnlineDateTime`（読んでいる）は判定に使えない | `web/js/save/palworld.js:489-512`（LEVEL_SKIP）・`:744`、メモリ `palworld-invite-code-and-presence.md` | save-extras で許可リストに足す |
| 7 | ギルドの各メンバーの `last_online_real_time` は `x.i64()` で読み飛ばしている | `web/js/save/palworld.js:406`・`:423`・`:442` | save-extras で読む |
| 8 | ゲーム内の Day（`inGameDay`）はすでにスナップショットにある。プレイヤーの Lv もホストの画面にはあるが、参加者では常に 0 | `web/js/save/palworld.js:822`・`:1079`、`web/js/core/owned.js:519` | save-extras |
| 9 | パル選択の「完全一致を自動で強調」を `position` で行うと、Enter で選ばれてしまい「Enter は矢印で選んだときだけ」の決まり（df0ab4e）に反する。最近選んだパルの印も禁止のテストがある | `web/js/ui/pal-picker.js:150`、`test/web/pal-picker.test.js:100`・`:174-208` | 強調は見た目のクラスだけ（pal-detail の F078） |
| 10 | 完成の判定はタマゴを**わざと**外している（19f673c） | `web/js/core/ideal-goals.js:139-153` | 孵化待ちの判定は別の関数 `eggMatches` にする（farm-board） |
| 11 | パル詳細の画像は `width/height` 属性が 160 で、CSS で 128px に縮めている | `web/js/ui/pal-icon.js:37-38`、`web/css/app.css:496` | 128 にそろえる（pal-detail） |
| 12 | 元に戻すのトーストは、確認の文が「3 秒間は元に戻せます」、CSS のカウントダウンが 3s。統合プランの delete-undo（6 秒）と任意の F085（8 秒）で秒数が食い違う | `web/js/app.js:192`、`web/css/app.css:777` | F085 を採るなら delete-undo の 6 秒を 8 秒に置き換える（任意の節） |
| 13 | 理想個体の「足りないパッシブ」の文を、route-progress（R-32）と implants（X-20）の 2 テーマが触る。テストが文言に依存 | `web/js/views/ideal.js:387-395`、`test/web/ideal-view.test.js:157`・`:161` | route-progress で直した文を implants が引き継ぐ |
| 14 | `pals.js` の項目は許可リストでテストされている。作業適性を足すと許可リスト（`JS_FIELDS`）の変更になる | `scripts/import-pals.mjs:8-9`、`test/import.test.js:11-18` | game-assets で SOURCES.md の「取り込まないもの」と合わせて直す |

---

# フェーズ 3: ドロワーと横断の導線

## drawer: 右のサイドドロワー（土台）

### 目的
本文を押し出さずに右から重ねて開く、非モーダルのドロワーの共通部品を作る。パル詳細・個体の詳細・牧場・相手親の個体など「見ながら確かめたいもの」を、今の画面（一覧・検索結果・計画）とスクロール位置を失わずに出す。

### 経緯
- **D3**（別セッションでのユーザー回答）: 「他の内容を見ながら参照する仕組み」は**右のサイドドロワー（非モーダル・本文に重ねる）を共通の土台に**する。
- 元の案: **S-03**（カードのパルを押したらサイドシートでパル詳細）と **F073**（パル詳細を右ドロワーで開き、所持個体と配合を一覧から離れず見る）。S-03 の検証では「スクロール位置の問題だけなら、view が変わったときに先頭へ戻すだけで直る（keep-state で対応）。シートは非モーダルの扱い・トースト・モーダルとの重なり・幅 1100px の配置を決める必要があり L」とされた。D3 の決定でシートを作ることが確定し、細部は Codex の指摘で決めた。
- **Codex（別プラン §9「P2 抜けの補足」）**: 「ドロワーは currentView と独立に状態を持ち、タブ切替時の保持／解除・直リンク・戻る・キーボードで本文へ戻る操作を定義する」。統合プランの drawer の行はこれをそのまま要件にしている。
- 幅: 統合プランで「本文に重ねて押し出さない。幅は 1100px で一覧が窮屈にならない範囲」。押し縮める案（観点:layout の `padding-right: 440px`）は、1100px で一覧の列が崩れるので採らない。
- 「目標の一覧」はドロワーではなくダイアログ（ideal-panel の F036・goals-detail）。取り消した案: I-17 のサイドシート案の一部。

### 依存
- header-frame（ヘッダーの高さと重なり順の CSS 変数）、render-contract（`context.update` で同じ画面なら作り直さない・遷移の理由の区別）、keep-state（history.state の扱い）、popovers（`ui/popover.js` の重なり順）、stable-render（`syncList`）。

### このテーマでやらないこと
- 中身（パル詳細・個体の詳細・牧場ボード）は作らない。動作確認用の最小の中身（パル名と画像だけ）でテストする。中身は pal-detail・owned-detail・farm-board・route-progress で足す。
- 本文を押し縮める配置、ドロワーを 2 つ同時に開くこと、ドロワーの幅を利用者が変えること。
- `#/pal/<id>` の全画面のパル詳細はなくさない（直リンク用に残す。pal-detail で中身を共通化する）。

### 現状
- パルのタイルはどれも `#/pal/<id>` へのリンク（`web/js/ui/pal-icon.js:70` の `link('', buildHash('pal', {}, id), 'pal-tile')`）。押すと `render()`（`web/js/app.js:252-285`）が今の画面を `destroy()` して（`:259`）パル詳細を作り（`:275`）、`main` を丸ごと入れ替える（`:276`）。
- 計測（[measurements.md](appendix/measurements.md) の撮影 find・計測 7）: 500px スクロールした配合検索からパル名を押すと、パル詳細が scrollY=364 の途中から出て、見出しが画面の外（top −261）。戻るとブラウザが元の位置に戻す（計測 8）。
- ダイアログの部品はモーダルだけ（`web/js/ui/dialog.js:3-26`。`:24` で `showModal()`）。サイドシートの部品はない。
- トーストは一番手前の `dialog[open]`（なければ body）に出る（`web/js/ui/toast.js:7`）。
- `--drawer` は左のレールの幅（`web/css/app.css:60` で 96px。`:236` のナビ、`:292` のヘッダーの位置、`:1227` の `#app` の左余白）。
- トースト領域は右下に固定（`web/css/app.css:617`: `right: 24px; width: min(460px, …); z-index: 20`）。delete-undo（1d）で本文の下中央へ移る。
- ログアウトのときは `closeDialogs()`（`web/js/app.js:307`）が開いているダイアログを閉じる。
- 別タブの変更は `storage` イベント（`web/js/app.js:324-329`）で各ストアが読み直す。

### 実装の手順
1. **新しいファイル `web/js/ui/drawer.js` を作る**。公開する形:
   ```js
   /**
    * 右のサイドドロワー（非モーダル・本文に重ねる・1 度に 1 つ）。
    * @param {{ context: object, render: Record<string, (entry: DrawerEntry, context: object) => DrawerContent|null>,
    *   history?: History, doc?: Document }} options
    * @returns {{ element: HTMLElement, open(entry: DrawerEntry, options?: { opener?: Element }): void,
    *   close(options?: { fromHistory?: boolean }): void, current(): DrawerEntry|null, restore(state: object): void,
    *   destroy(): void }}
    */
   export function createDrawer({ context, render, history = window.history, doc = window.document })
   // DrawerEntry:   { kind: 'pal'|'owned'|'farms'|'species', id: string, params?: Record<string, string> }
   // DrawerContent: { title: string, element: HTMLElement, destroy(): void }（データの購読は中身が自分で持つ）
   ```
   - 中身を作る関数（`render`）は app.js が種類ごとの表（`{ pal, owned, farms, species }`）で渡す。drawer.js は中身を知らない（テストしやすくするため）。このテーマでは表は空でよく、テストでは仮の中身を渡す。
2. **DOM と見た目**: `<aside class="side-drawer" aria-labelledby="…" hidden>` の中に、`header.side-drawer-header`（`h2` の見出し・「← 前へ」・「本文へ戻る」・「ページで開く」・×）と `div.side-drawer-body`。**`<dialog>` は使わない**（toast.js が `dialog[open]` にトーストを出すため。`closeDialogs()` にも巻き込まれない）。
   - app.js の `root.append(...)`（`web/js/app.js:153`）で `main` の後ろに 1 つだけ置く。
   - CSS（`web/css/app.css`）: 新しい変数 `--side-drawer-width: clamp(360px, 36vw, 480px)`（**`--drawer` は使わない**）。`position: fixed; top: var(--header-h); right: 0; bottom: 0; width: var(--side-drawer-width); overflow-y: auto; background: var(--md-sys-color-surface-container-low); box-shadow: var(--elevation-3); border-left: 1px solid var(--md-sys-color-outline-variant)`。`z-index: var(--z-drawer)`（header-frame の変数。並びは「固定のパネル（`--z-panel`）＜ ヘッダー（`--z-header`）＜ ドロワー（`--z-drawer`）＜ 新しいバージョンのスナックバー（`--z-snackbar`）＜ トースト（`--z-toast`）＜ body に浮かせた候補・メニュー（`--z-popover`）。モーダルのダイアログは top layer で最上層」。数字を直接書かない）。ドロワーの中で開くパル選択・パッシブ選択の候補（`popupHost: document.body` の `picker-popover-floating`）がドロワーより上に出ることを確かめる。
   - 開いている間は `document.documentElement.dataset.sideDrawer = 'open'` を付け、トースト領域と新しい版のスナックバーを `var(--side-drawer-width)` だけ左へずらす（`:root[data-side-drawer="open"] .toast-region { … }`）。本文には `inert` を付けない（非モーダル）。
   - 開閉の動きは `transform: translateX` の 160ms。`prefers-reduced-motion: reduce` では動かさない。
3. **状態の持ち方（currentView と独立）**: drawer.js の中に `{ entry, stack: DrawerEntry[]（最大 5）, content, opener }` を持つ。app.js の `render()`／render-contract の `context.update` は、ビューを作り直してもドロワーの DOM と状態に触れない。
4. **URL と履歴**（「直リンク」「戻るで閉じる」）:
   - 開くとき: ドロワーが閉じていれば `history.pushState({ ...history.state, drawer: { v: 1, env, user: userIdKey, entry } }, '', location.href)`（**URL は変えない**。hash が変わらないので `hashchange` は起きず、ルーターは動かない）。開いている間に中身を差し替えるときは `replaceState` で `drawer.entry` だけを更新し、前の中身は `stack` に積む（「← 前へ」で戻る。ブラウザの履歴は増やさない）。
   - × と Esc で閉じるとき: 今の履歴エントリーが自分で積んだもの（`history.state?.drawer` がある）なら `history.back()` し、`popstate` で閉じる。そうでなければ（読み込み直した後など）そのまま閉じて、`replaceState` で `drawer` を消す。
   - `popstate`: `history.state?.drawer` がなければ閉じる。あれば（進むで戻ってきた）`restore(history.state)` で開き直す。keep-state の条件・スクロールの復元と同じ `popstate` で動くので、keep-state 側は `drawer` の鍵を消さずに残す（**history.state は必ず展開してから書く**）。
   - 読み込み直したとき: 起動時に `history.state?.drawer` があり、`v`・環境・利用者が今と合えば開き直す。合わなければ `replaceState` で消す（keep-state と同じ版・環境・利用者の検査）。
   - `#/pal/<id>` は今までどおり全画面のパル詳細（直リンク・新しいタブ用）。ドロワーの見出しの「ページで開く」は `buildHash('pal', {}, id)`。
5. **タブの切り替えでの保持／解除**: `route.view` が変わる遷移（レールのタブ・別画面へのリンク）ではドロワーを閉じる（`replaceState` で `drawer` を消す。履歴は戻さない）。同じ画面の中の条件変更（render-contract が「同じ画面なら更新」を選んだ遷移）では開いたまま。ログアウト・名前の変更・ワールドの切り替えでは必ず閉じる（app.js の `forget()`（`web/js/app.js:124-128`）と、`store.subscribe` のログアウトの分岐（`:306-309`）から `drawer.close()`）。
6. **パルのタイルのクリックを引き取る**: `drawer.js` に `installPalLinks(root, drawer)` を足し、`root`（`document`）に `click` の委譲リスナーを 1 つ置く。`event.button === 0` で修飾キー（Ctrl・Shift・Meta・Alt）なし、対象が `a.pal-tile[href^="#/pal/"]` で、**`dialog` の中ではない**ときだけ `preventDefault()` して `drawer.open({ kind: 'pal', id }, { opener: a })`。Ctrl・中クリック・新しいタブは今までどおり全画面のページ。`href` は残す（アクセシビリティ・直リンク・既存のテスト）。
7. **キーボード**:
   - Esc: フォーカスがドロワーの中にあり、ドロワーの中のポップオーバーが開いていない（`ui/popover.js` が Esc を先に消費する）ときに閉じる。モーダルのダイアログが開いているときは何もしない。
   - 閉じたらフォーカスを開いた要素（`opener`）へ戻す。`opener` がもうない（行が消えた）ときは本文の見出し（`main h1`）へ。`focus({ preventScroll: true })`。
   - 「本文へ戻る」ボタン（見出しの行。普段は小さく、フォーカスで目立つ）: ドロワーを開いたまま、フォーカスを `opener`（なければ `main`）へ移す。
   - 開いたら見出し（`h2`、`tabIndex = -1`）にフォーカスを移す。フォーカスをドロワーの中に閉じ込めない（非モーダル）。
8. **データの更新**: 中身は自分で `context.store`・`context.owned` などを購読し、`destroy()` で外す。drawer.js は中身の `destroy()` を、閉じる・差し替える・ログアウトのときに必ず呼ぶ。区切って描く仕事は stable-render の番号で無効にする。中身が対象を見失った（個体が消えた・パル ID が不正）ときは `render` が `null` を返し、drawer.js が「見つかりません」と「閉じる」を出す。
9. **app.js への組み込み**: `const drawer = createDrawer({ context, render: drawerContents })` を `context` を作った後に作り、`context.drawer = drawer` として各ビュー・部品から `context.drawer.open(...)` を呼べるようにする。`installPalLinks(document, drawer)` を一度だけ呼ぶ。
10. **テスト用の偽 DOM**: `<aside>` なので `show()` は要らない。`history.pushState`・`popstate` を使うので、`test/helpers/dom.js` の `installDom`（`:114` 以降）に `window.history`（state・pushState・replaceState・back を持つ小さな偽物）と `window.location` がなければ足す。
11. `docs/OPERATIONS.md` に「パルを押すと右に詳細を開く（Ctrl・中クリックで全画面）。Esc・×・ブラウザの戻るで閉じる。タブを替えると閉じる」を 1 項目足す。

### 触るファイル
- 新規: `web/js/ui/drawer.js`、`test/web/drawer.test.js`
- 変更: `web/js/app.js`（作成・`context.drawer`・`installPalLinks`・ログアウトとタブ切り替えでの close）、`web/css/app.css`（`.side-drawer`・`--side-drawer-width`・トースト領域のずれ）、`test/helpers/dom.js`（history の偽物）、`docs/OPERATIONS.md`、`web/js/release-notes.js`

### テスト
- 新設 `test/web/drawer.test.js`:
  - 開く → `aside` が見え、見出しにフォーカス、`history.pushState` が 1 回、URL は変わらない。
  - 開いたまま別のパルを開く → `replaceState`、「← 前へ」で前の中身に戻る、`stack` は 5 件まで。
  - × → `history.back()` が呼ばれ、`popstate`（state に drawer なし）で閉じ、フォーカスが `opener` に戻る。`opener` が消えていたら `main h1` へ。
  - Esc（ドロワーの中にフォーカス）で閉じる。ポップオーバーが開いているときの Esc ではドロワーは閉じない。
  - `route.view` が変わる遷移で閉じ、同じ画面の条件変更では閉じない。
  - ログアウトで閉じ、中身の `destroy()` が呼ばれる。
  - 起動時に history.state の `drawer` の環境・利用者が違えば開かずに消す。
  - `installPalLinks`: 普通のクリックで `preventDefault` してドロワー、Ctrl＋クリックと `dialog` の中では何もしない。
  - トーストが `aside` の中に出ない（`dialog` を使っていないことの回帰）。
- `test/web/app.test.js` に、パルのタイルを押すとドロワーが開き、`main` は作り直されない（ビューの関数が呼ばれない）ことを 1 件足す。
- 期待値が変わる既存のテスト: なし（`href` は残すので `test/web/breeding-card.test.js:46`・`:55`・`:70` の `.pal-tile` の数は変わらない）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: ドロワーは入れ物だけ。中身が出すものは各テーマの決まりに従う。
- セキュリティ: 見出しは `textContent`。幅は CSS 変数、動的な位置は `style.setProperty`。
- 互換: history.state は keep-state と共有するので、**必ず `{ ...history.state, drawer }` の形で書き、ほかの鍵を消さない**。旧コードの state（drawer なし）では何もしない。ドロワーを開く pushState は、keep-state のエントリ ID（history.state の中）をそのまま引き継ぐので、同じ ID の履歴エントリが 2 つになる。本文の URL と位置は同じなので条件と位置の保存を共有してよい見込みだが、keep-state の実物で「閉じて戻ったときに位置が飛ばない」ことを確かめる（2026-10-12 の最終確認で足した確かめる点）。
- 性能: ドロワーを開くたびに本文を描き直さない（`app.test.js` で確かめる）。中身の差し替えは「前の中身の `destroy()` → 新しい中身の作成」だけ。
- 重なり: ヘッダー・固定のパネル・候補・トースト・ダイアログ・ドロワーの重なりは、ブラウザで幅 920px・1100px・拡大 125〜150% で確かめる（統合プランの「ブラウザでしか確かめられないこと」）。

### release-notes の案
- id: `YYYY-MM-DD-side-drawer`
- title: 「パルを右のパネルで確認」（11 字）
- body: 「パルを押すと右に詳細が開き、今の画面を見たまま確かめられます。Esc か × で閉じます。」（45 字）
- 中身がパル名と画像だけの段階では配信しない。pal-detail と同じ配信なら 1 件にまとめてよい（配信する単位で 1 件）。

### 完了の条件
- [ ] `npm test` が通る（新しい drawer のテストを含む）。
- [ ] モック（`npm run dev` → `http://localhost:5173/?mock=1&seed=80`）で、500px スクロールした配合検索からパルを押すとドロワーが開き、本文の scrollY が変わらない（基準: 今は全画面に替わり scrollY=364 から表示）。
- [ ] ブラウザの戻るで閉じ、進むで開き直す。タブを替えると閉じる。Esc で閉じてフォーカスが押したタイルに戻る。
- [ ] 幅 920px・1100px・拡大 125〜150% で、ヘッダー・固定のパネル・候補・トースト・ダイアログとドロワーの重なりが崩れない（ドロワーの中のパル選択の候補がドロワーより上に出る）。
- [ ] Ctrl＋クリックで今までどおり全画面のパル詳細が新しいタブで開く。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — history.state は `{ ...history.state, drawer }` の形で書き、keep-state の鍵を消さない。環境・利用者の違う state では開かない（`drawer.test.js`）。セキュリティ — 見出しは textContent、位置は `style.setProperty`（`test/static/security.test.js`）。性能 — ドロワーを開いても本文を作り直さない（`app.test.js` の 1 件）。INV-2 — 入れ物だけ（中身の決まりは各テーマ）。

### TODO
- [ ] `web/js/ui/drawer.js` の `createDrawer`（open・close・current・restore・destroy、stack 5 件）を書く
- [ ] `<aside class="side-drawer">` の見出し行（h2・← 前へ・本文へ戻る・ページで開く・×）を作る
- [ ] CSS: `--side-drawer-width`、固定配置、`--z-drawer`、開閉の動き、減らす設定、トースト・スナックバーのずれ
- [ ] history: 開くとき pushState（URL 不変）・差し替えは replaceState・× は back・popstate で閉じる/開き直す
- [ ] 読み込み直したときの復元（版・環境・利用者の検査）
- [ ] `route.view` が変わる遷移・ログアウト・名前の変更・ワールドの切り替えで閉じる
- [ ] `installPalLinks`（普通のクリックだけ引き取る。修飾キーと dialog の中は除く）
- [ ] Esc・フォーカスの戻し先・「本文へ戻る」
- [ ] app.js に組み込む（`context.drawer`、種類ごとの中身の表）
- [ ] `test/helpers/dom.js` に history の偽物、`test/web/drawer.test.js` と `app.test.js` の 1 件
- [ ] ブラウザで重なりと戻る/進むを確かめる
- [ ] OPERATIONS.md の 1 項目と release-notes

---

## pal-detail: パル詳細を種族のハブに

### 目的
パル詳細を「その種族について知りたいこと・次にすること」の入口にする。ドロワーでも全画面でも同じ中身（ヒーロー・所持個体・配合の件数と上位 3 件・行き先のボタン）を出し、ヘッダーのパル検索（「/」）からどの画面でも開けるようにする。

### 経緯
- **F073・F075**（別プラン）: パル詳細を右ドロワーで開き（D3）、所持数・理想個体・目標・登録の主ボタンを持つ種族のハブにする。
- 本セッションの案:
  - **S-04**: 2 つの配合一覧を件数と上位 3 件＋配合検索へのリンクに縮める（逆引き・配合検索と同じ一覧を 2 か所で持っている重複をなくす）。
  - **S-06**: 英名とパートナースキル（名前と説明）。作業適性はマスターにないので範囲外。
  - **S-08**: 所持個体の上位 5 体を、既定で閉じた折りたたみで。
  - **S-09**: 「ウィッシュリストに追加」と「理想個体を作る」のボタン → D5（ウィッシュリストを目標に統合）で「目標にする」に読み替え。
  - **S-10**: 見出しをパル名に、ヒーローを 2 列の図鑑風に、画像の width/height を表示の 128 に。属性のアイコンはゲームから取り出せるまで作らない。
  - **S-11**: 別のパルへ移るパル選択。「← 戻る」とレールの表示の変更はしない（ブラウザの戻ると同じで、得るものが少ない）。
  - **S-12**: 行き先のボタン列はパル詳細のヒーローだけで使う（5 画面に置くと混む）。ほかの画面には足りない双方向のリンクを 1 つずつ（route-progress の I-58）。
  - **O-41**: 「所持 5 体（♂3 ♀2）· タマゴ 1 → 所持パルで見る」。個体 ID で行へ飛んで強調する案は見送り（content-visibility の行への移動・強調の解除・viewState の上書きの扱いが要り、費用に見合わない）。
  - **I-57**: パル詳細から理想個体へ（`#/ideal?to=`）。
  - **G-03**: ヘッダーにパル検索（G-07 のコマンドパレットは入れない）。**G-06**: ショートカットのうち「/」（「N」は register-entry で入れた）。
- 統合プランでこのテーマに入れた別プランの項目: **F077**（パル選択に「データあり」の群と件数）・**F078**（キー操作）・**F059**（ホバーの解説: ホバーで軽い板・クリック／Enter で固定）。F077 の大部分（所持している種族を先に・登録件数・目標までの回数）は popovers（1a）で入るので、ここでは群の見出しとヘッダーのパル検索への適用だけを足す。
- F078 の「完全一致の自動強調」は**見た目のクラスだけ**にする（別プラン §5 バッチ 3 の注記。「Enter は矢印で選んだときだけ」の決まり df0ab4e と `test/web/pal-picker.test.js:174-208` を守る）。
- F059 の元の提案: 委譲のリスナー 1 つで、`data-pal-id`／`data-passive-id` から 150〜250ms 後にポップオーバー（pal-picker の固定配置の計算を `ui/popover.js` に共用化）。パル: 画像・属性・所持 ♂n ♀m・配合 n 件。パッシブ: 名前・ランク・説明・所持 n 体。チップは button にしてクリック／Enter でも開く。

### 依存
- drawer、goals-merge（種族だけの目標と `ideals.has`/`add` の形）、find-merge（`#/search?c=`・`#/search?p1=`）、register-entry（「この子の配合を登録」の控えめ表示）、owned-overlay（所持数と親になれる数の集計）、owned-rows（`ownedRow` の部品）、popovers（パル選択・`ui/popover.js`）、copy-dead-ends（見出しの規則）。

### このテーマでやらないこと
- 作業適性・属性のゲームアイコン（game-assets）、捕獲数（paldex）、図鑑の格子（paldex）。
- 所持パルの特定の行へ個体 ID で飛んで強調する機能（O-41 の判断で見送り）。
- 「← 戻る」ボタン、パル詳細でレールのタブを選ばれた表示にすること（S-11 の判断）。
- ほかの画面に `palActions` のボタン列を置くこと（S-12 の判断）。
- 子の性別比などの INV-2 例外の拡大（判断事項 4）。

### 現状
- `web/js/views/pal.js:7-35`: ID がなければ「パルが見つかりません」と「配合検索へ」（`:9-13`）。見出しは汎用の「パルの配合ノート」（`:15`）。ヒーローは `palTile`（大）と `elementChips` だけ（`:16-17`）。ボタンは「ここから継承ルート」「ここへの継承ルート」「この子の配合を登録」（`:18-21`）。「このパルが生まれる配合」（`findByChild`）と「このパルを親に使う配合（相手 → 子）」（`findByParent`・`focusParent`）を全件出す（`:22-33`）。購読は `store` だけ（`watchView`、`:26`）で、所持パルを見ていない。
- 画像の属性は 160（`web/js/ui/pal-icon.js:37-38`）で、CSS で 128px に縮めている（`web/css/app.css:496`）。ヒーローの右半分が空く（撮影 `Claude outputs/ui-audit-2026-10/shots/find/22-pal-detail.png`）。生まれる配合と親に使う配合が縦に長く続く（`35-pal-detail-many.png` で 1521px）。
- パートナースキルの名前と説明は `web/data/skills.js:337`（`PARTNER_SKILLS`）・`:966`（`PARTNER_SKILL_DESCS`）にあり、所持パルのキーワードの一致の注記でしか使っていない（`web/js/core/owned.js:92-97`・`:270-275`）。説明には数値の穴「○」がある（`docs/SAVE_FORMAT.md:84` の決まり）。
- `#/owned?pal=&p=&holder=&place=` を作るコードはない（`web/js/views/owned.js:83-90` が受け取るだけ。owned-toolbar で場所チップの URL に変わる）。
- 理想個体への入口はタブと通知だけ（`web/js/ideals.js:173`、`web/js/views/ideal.js:129`）。
- パル選択: `web/js/ui/pal-picker.js:16-166`。キー操作は検索欄の ↑↓・Enter・Esc だけ（`:140-151`）。トリガーで文字を打っても開かない。Enter は `position >= 0` のときだけ選ぶ（`:150`）。
- ヘッダーにパル検索はない。`app.js` に `keydown` の処理はない（あるのは `web/js/ui/notifications.js` と `pal-picker.js:140` だけ）。
- パッシブの説明は `title` だけ（`web/js/ui/passive-picker.js:20`）。キーボードで出ない。
- ナビのアイコンの表（`web/js/ui/nav-icons.js:2-12`）に `pal` はない。
- テスト: `test/web/views.test.js:91-99`（親に使う配合は相手 → 子、`＋` を含まない）。

### 実装の手順
1. **中身を共通の関数に切り出す**。新しいファイル `web/js/ui/pal-detail.js`:
   ```js
   /**
    * パル 1 種の詳細（全画面のページとドロワーで共通）。DOM と購読を持ち、destroy で外す。
    * @param {object} context app.js の context
    * @param {string} palId マスターの ID
    * @param {{ mode: 'page'|'drawer', onSwitch?: (palId: string) => void }} options
    * @returns {{ element: HTMLElement, title: string, destroy(): void } | null}  不正な ID は null
    */
   export function palDetail(context, palId, { mode, onSwitch })
   ```
   - `web/js/views/pal.js` はこれを包むだけにする（ページの `section.view`・ID なしのときの扱い）。ドロワーの中身の表（drawer の手順 9）に `pal: (entry, context) => palDetail(context, entry.id, { mode: 'drawer', onSwitch: (id) => context.drawer.open({ kind: 'pal', id }) })` を足す。
2. **見出しとパル切り替え（S-10・S-11）**: 見出しは「No.117 ソルレイス」（`No.${pal.label} ${pal.ja}`。copy-dead-ends で決めた規則が違えばそれに従う）。見出しの右に小さな `palPicker({ label: 'パルを切り替え', value: palId, onChange })`（aria-label をほかの選択欄と重ねない。render-contract の後もフォーカスの引き継ぎがラベルで動くなら、それに当たらないように）。ページでは `onChange` で `context.navigate(buildHash('pal', {}, id))`、ドロワーでは `onSwitch(id)`。
3. **ヒーローを 2 列に（S-06・S-10）**: 左は画像（`palIcon(pal, { large: true })`。`pal-icon.js:37-38` の 160 を 128 に直す）と `elementChips(pal)`。背景は第 1 属性の色（`.element-<第 1 属性>` の `--element` の淡いグラデーション。`web/css/app.css:502-510`）。右に縦に並べる:
   - 英名（`pal.en`）。
   - 「パートナースキル: 〈名前〉」と説明。説明は 2 行を超えたら `details` で畳む。「○」はそのまま出す（所持パルの注記と同じ。`docs/OPERATIONS.md:108`）。名前の表にない種族では行ごと出さない。
   - 所持の 1 行（手順 4）。
   - 行き先のボタン（手順 5）。
4. **所持の 1 行と上位 5 体（O-41・S-08・F075）**:
   - `context.owned` を購読する（`owned.subscribe`。`owned.load()` も呼ぶ。直接開いたときにデータが入るように。`web/js/views/route.js:204-210` と同じ形）。データが変わったら、この欄だけを差し替える（`details` の開閉は保つ）。所持パルのデータがない人には欄ごと出さない。
   - 数は owned-overlay で入れた共通の集計（「所持数」と「親になれる数」を分けたもの。タマゴ・グローバルは親にしない）を使う。表示: 「所持 5 体（♂3 ♀2）· タマゴ 1 · 親になれる ♂2 ♀2 → 所持パルで見る」。リンクは `buildHash('owned', { pal: palId })`（owned-toolbar の URL の形。場所の指定を付けない＝既定の場所）。
   - その下に既定で閉じた `details`「所持個体（上位 5 体）」: その種族の個体を owned-rows の「良いパッシブ順」（なければ `sortOwned(list, 'passives')`、`web/js/core/owned.js:337-350`）で並べた上位 5 体を `ownedRow` で出す。行の更新は `syncList`（key は個体 ID）。
5. **行き先のボタン（S-09・S-12・I-57・F075）**: パル詳細のヒーローだけに置く（`palActions` を共通部品にしない）。並び:
   - 「ここから継承ルート」（`#/route?from=`）、「ここへの継承ルート」（`#/route?to=`）、「理想個体で親を探す」（`#/ideal?to=`）。
   - 「目標にする」: goals-merge で作った `ui/goal-toggle.js` の `goalToggle(context, palId)` をそのまま置く（goals-merge の手順 8 で、すでにパル詳細のヒーローに置いてある。新しい目標の値を自分で組み立てない）。中身は `core/ideal-goals.js` の `speciesGoal(palId, { name: pal.ja })`（パッシブなし・mode `'include'`・個体値の条件なし（0）・cake `'none'`。個体値の保存は「0＝条件なし」のまま。判断事項 10。`order` は cleanup-dead-code で消したので付けない）を `ideals.add` する。登録済み（`ideals.has(speciesGoal(palId))`）なら「★ 目標に登録済み」で、押すと外す（トーストで「元に戻す」）。読み込み前・名前の変更中（`add` が null）は押せない理由つきの無効表示（visual-parts の部品）。`ideals.subscribe` で表示を最新に保つ（goal-toggle が持っている）。
   - 「この子の配合を登録」: register-entry の決まり（登録が 1 件でもあれば secondary）をそのまま使う。
   - アイコンは `navIcon` を 16px で使う。
6. **配合の件数と上位 3 件（S-04）**: 「このパルが生まれる配合 n 件」「このパルを親に使う配合 n 件（相手 → 子）」の 2 節。各節は上位 3 件のカード（`breedingCard`。親に使う配合は今どおり `focusParent: palId`）と、4 件以上のときだけ「すべて見る →」（`buildHash('search', { c: palId })`・`buildHash('search', { p1: palId })`。find-merge の URL）。0 件なら「まだ登録されていません」。並びは find-merge の既定（更新日の新しい順）にそろえる。
7. **ヘッダーのパル検索と「/」（G-03・G-06）**: header-frame のヘッダーに `palPicker({ label: 'パルを探す', placeholder: 'パルを探す（/）', popupHost: document.body, onChange })` を 1 つ置く（ラベルは visually-hidden、トリガーは小さく。CSS でヘッダー用の小さい見た目を足す。`web/css/app.css:394-412` の大きなトリガーのままではヘッダーに入らない）。選んだら `context.drawer.open({ kind: 'pal', id })` して選択を空に戻す（`setValue('')`）。header-frame で決めた「幅が足りないときの隠す順番」にこの部品を入れる。追記（header-frame の実装、2026-10-12）: ヘッダーで縮むのはセーブ連携の状態のワールド名だけ（`.header-status` は `flex: none`）。1100px（テスト環境のチップあり）の残りは、ワールド名を縮めて 50px ほどしかないので、この部品の幅の分だけ閾値（1200・1100・980px）を測り直す（phase-1a の header-frame の「実装の記録」4）。
   - 「/」: `document` の `keydown` で、修飾キーなし・`event.isComposing` でない・フォーカスが `input`・`textarea`・`select`・`[contenteditable]` でない・モーダルのダイアログが開いていないときに `preventDefault()` して、ヘッダーのパル選択を開く（register-entry の「N」と同じ判定の関数を共通にする）。
8. **パル選択の群（F077）**: popovers で入れた件数の仕組みに、群の見出しを足す。`palPicker` に `groupOf?: (palId) => 'data'|'other'` と見出しの文字を渡せるようにし、検索が空のときだけ「データあり（N）」「その他」の 2 群に分けて出す。ヘッダーのパル検索とパル詳細のパル切り替えでは「データあり」＝子か親として登録がある種族、または所持している種族。件数は popovers と同じく、データの更新時に 1 回集計して Map で引く（候補ごとに数え直さない）。
9. **パル選択のキー操作（F078）**: `web/js/ui/pal-picker.js`:
   - トリガーの `keydown`: 印字できる 1 文字（`event.key.length === 1`・修飾キーなし・変換中でない）・ArrowDown・ArrowUp で `open()` し、文字なら検索欄にその文字を入れて `renderOptions()`。
   - 検索欄: Home・End（先頭・末尾）、PageUp・PageDown（10 件ずつ）を足す。
   - 完全一致か候補が 1 件のとき、その行に `suggested` のクラスだけを付ける（**`position` は動かさない**。Enter は今どおり矢印で選んだときだけ）。
10. **ホバーの解説（F059）**: 新しいファイル `web/js/ui/hover-card.js`:
    ```js
    /** パルのタイル（data-pal-id）とパッシブのチップ（data-passive-id）の解説の板。委譲のリスナーを root に 1 組だけ置く。 */
    export function installHoverCards(root, { context, delay = 200 }) // → { destroy() }
    ```
    - `palTile` に `data-pal-id`、`passiveChip` に `data-passive-id` を付ける（`pal-icon.js:67-85`・`passive-picker.js:10-27`）。
    - `pointerover`／`focusin` から `delay` ミリ秒後に `ui/popover.js` で軽い板を出し、`pointerout`／`focusout`・スクロール・Esc で消す。
    - パル: 画像・No.・名前・属性・「所持 ♂n ♀m」・「登録 n 件」。**パルのタイルはクリックでドロワーを開く**（drawer の手順 6）ので、板はホバーとフォーカスだけで出す（クリックで固定しない）。
    - パッシブ: 名前・ランク・説明・「所持 n 体」（数え方は popovers の決まり）。チップはクリック／Enter で板を固定し、もう一度押すか外側を押すと外す。チップがリンクの中にあるときは固定しない（入れ子の操作を作らない）。
    - 板が出る所では `title` を外す（二重に出さない）。固定できるチップには `tabIndex = 0` と `aria-describedby`。
11. **全画面のページ**: `views/pal.js` は `palDetail(context, route.id, { mode: 'page' })` を `section.view` に入れ、`null` なら今の「パルが見つかりません」（paldex が入った後は図鑑へ）。
12. `docs/OPERATIONS.md` にパル詳細の記述（所持の 1 行・上位 5 体・「すべて見る」・ヘッダーの検索と「/」・ホバーの解説）を足す。

### 触るファイル
- 新規: `web/js/ui/pal-detail.js`、`web/js/ui/hover-card.js`、`test/web/pal-detail.test.js`
- 変更: `web/js/views/pal.js`、`web/js/ui/pal-icon.js`（128・`data-pal-id`）、`web/js/ui/passive-picker.js`（`data-passive-id`）、`web/js/ui/pal-picker.js`（群・キー操作・`suggested`）、`web/js/ui/nav-icons.js`（`pal` のアイコンが要るなら）、`web/js/app.js`（ヘッダーのパル検索・「/」・ドロワーの中身の表・`installHoverCards`）、`web/css/app.css`（ヒーロー 2 列・ヘッダーの小さいパル選択・板）、`docs/OPERATIONS.md`、`web/js/release-notes.js`

### テスト
- 新設 `test/web/pal-detail.test.js`:
  - 見出しが「No.〈label〉 〈ja〉」、英名とパートナースキルが出る（名前の表にない種族では行がない）。
  - 所持パルのデータがないと所持の欄がない。あると「所持 n 体（♂a ♀b）· タマゴ k」と `#/owned?pal=` のリンク、上位 5 体が `details` の中に 5 行まで。
  - 生まれる配合が 4 件以上で「すべて見る」（`#/search?c=`）、3 件以下では出ない。
  - 「目標にする」（goals-merge の `goalToggle`）で `ideals.add` が `speciesGoal(palId, { name })`（`order` なし・個体値 0）で呼ばれ、登録済みなら「★ 目標に登録済み」になり、押すと外れる。
  - 所持パルを読み直しても `details` の開閉が保たれる。
  - ドロワーの mode でパル切り替えが `onSwitch` を呼ぶ。
- `test/web/pal-picker.test.js` に足す: トリガーで文字を打つと開いて検索欄に入る、Home/End/PageUp/PageDown、候補 1 件で `suggested` が付いても Enter で選ばれない（`:174-208` の決まりの回帰）、群の見出し。`:100`（履歴・最近の印を使わない）は守る。
- `test/web/app.test.js`: 「/」でヘッダーのパル選択が開く、入力欄・変換中・ダイアログ中では開かない。
- 期待値が変わる既存のテスト: `test/web/views.test.js:91-99`（見出しと節の文言を新しい形に。親に使う配合が相手 → 子で `＋` を含まないことは残す）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 件数とカードは登録済みのレコード（`findByChild`・`findByParent`）を数えるだけ。所持の欄はセーブの個体だけ。配合表・`core/ideal.js` を import しない（`test/import.test.js:27-44`）。
- セキュリティ: 説明文・名前は `textContent`。属性の背景色はクラス、板の位置は `style.setProperty`。
- 互換: `#/pal/<id>` の直リンクは変えない。
- 性能: パル選択の件数・群はデータの更新時に 1 回集計して Map で引く（Codex 1 回目の指摘 20）。ホバーの板は委譲のリスナー 1 組だけ（行ごとにリスナーを付けない）。

### release-notes の案
- id: `YYYY-MM-DD-pal-detail-hub`
- title: 「パル詳細に所持と行き先」（11 字）
- body: 「所持個体とパートナースキル、目標・理想個体へのボタンを出します。「/」でパルを探せます。」（44 字）

### 完了の条件
- [ ] `npm test` が通る。
- [ ] モックで、配合を探すの結果からパルを押すとドロワーにハブが出て、所持の 1 行・上位 5 体・件数と上位 3 件・ボタンがそろう（撮影 22 の右半分の空きがない）。
- [ ] どの画面でも「/」→ 名前を打つ → ↓ → Enter でドロワーが開く。入力欄の中の「/」は文字として入る。
- [ ] パル選択で、完全一致の行が強調されても Enter だけでは選ばれない。
- [ ] パッシブのチップにフォーカスすると説明の板が出て、Esc で消える。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 件数とカードは登録済みの記録だけを数え、配合表・`core/ideal.js` を import しない（`test/import.test.js`）。互換 — `#/pal/<id>` の直リンクが今どおり開く。「目標にする」は goals-merge の種族だけの目標で、目標の保存の形（個体値は 0＝条件なし）を変えない。セキュリティ — 説明文・名前は textContent（`test/static/security.test.js`）。性能 — パル選択の件数と群はデータの更新時に 1 回の集計、ホバーの板は委譲のリスナー 1 組。

### TODO
- [ ] `web/js/ui/pal-detail.js` に `palDetail(context, palId, { mode, onSwitch })` を切り出し、`views/pal.js` を包むだけにする
- [ ] 見出しをパル名にし、パル切り替えの `palPicker` を置く
- [ ] ヒーロー 2 列（画像 128・属性チップ・英名・パートナースキル）
- [ ] 所持の 1 行（owned-overlay の集計）と上位 5 体の `details`（`syncList`）
- [ ] 行き先のボタン（継承ルート 2・理想個体・目標にする・この子の配合を登録）
- [ ] 配合の 2 節を件数＋上位 3 件＋「すべて見る」に
- [ ] ドロワーの中身の表に `pal` を足す
- [ ] ヘッダーのパル検索と「/」のショートカット（N と共通の判定）
- [ ] パル選択の群の見出し（F077）とキー操作・`suggested`（F078）
- [ ] `web/js/ui/hover-card.js`（F059）と `data-pal-id`・`data-passive-id`
- [ ] テスト（pal-detail・pal-picker・app）と `views.test.js:91` の期待値の更新
- [ ] OPERATIONS.md と release-notes

---

## owned-detail: 所持パルの個体の詳細をドロワーで

### 目的
所持パルの一覧の並びを見たまま、1 体ずつの全部の情報（パッシブの説明・パートナースキル・アクティブスキル・個体値・場所の図・キーワード一致の全文）をドロワーで確かめられるようにする。

### 経緯
- **O-37**（N-15 を吸収）: 行を押すと右にサイドパネルを開き、その個体の全部の情報を一覧を見たまま確かめる。検証で「1100px で 5 列の一覧に 360px のパネルを並べるとパッシブの列が崩れる」とされたが、D3 で**本文に重ねる**ドロワーに決まったので解消した。
- O-37 の判断: 中身は大きいアイコン・Lv・★・性別・ニックネーム・個体値（O-44 のバー）・パッシブ（チップ＋説明の文）・パートナースキル（名前＋説明）・アクティブスキル。下に「パル詳細」と O-38 と同じリンク。**↑↓ での移動と横に並べる配置は後回し**。行の押せる範囲は、名前・アイコン以外のセル（パッシブ・個体値・場所）にし、パル詳細へのリンクとぶつからないようにする。
- 統合プランの owned-rows（1c）で「キーワード一致の理由は 1 行（全文はフェーズ 3 のドロワー）」と決めたので、全文はここで出す。
- 場所の 6×5 の図は owned-rows（1c）で正規化に page/row/col を持たせて作った部品（V-10）をそのまま使う（O-37 の判断の「後回し」は、owned-rows で先に入るので解消）。
- アクティブスキルの「装備中を先に」は O-43 をしないと分からない（セーブの解析は装備中を先に並べて重複を除いた 1 つの配列にしている。`web/js/save/palworld.js:142-148`）。ここでは「覚えているアクティブスキル」として今の並びのまま出す。

### 依存
- drawer、owned-rows（`ownedRow` の部品・個体値の 4 セルとバー・★4 枠・場所の 6×5 SVG・行のホバーの操作）。

### このテーマでやらないこと
- ↑↓ キーで次の個体へ移る操作、一覧とドロワーを横に並べる配置（O-37 の判断）。
- アクティブスキルの装備中と習得済みの区別（O-43。セーブの解析の変更が要る）。
- 魂の強化・病気など未読のセーブの項目（save-extras の F070。読めたらこのドロワーに足す）。
- 理想個体の組のカードの中の行（`pairCard` の `ownedRow`）からドロワーを開くこと（行の操作は所持パルのタブだけ。I-57 の注意「理想個体のカードに操作が出ない」）。

### 現状
- 行（`web/js/views/owned.js:51-69` の `ownedRow`）に出るのは、画像・Lv・★・パッシブ・個体値の文字・所持者と場所だけ。パートナースキルとアクティブスキルはキーワードが一致したときだけ notes で出る（`:61-66`、`web/js/core/owned.js:270-295`）。属性は NOTE_FIELDS にないので、一致しても行に出ない。パッシブの説明は `title` だけ（`web/js/ui/passive-picker.js:20`）。
- パル詳細へのリンクはアイコンと名前を含む `palTile` 全体（`web/js/ui/pal-icon.js:70`）。
- 正規化した個体には `skills`・`skillNames`・`skillDescs`（`web/js/core/owned.js:105-112`・`:184`）、`partnerSkill`・`partnerSkillDesc`・`elements`・`en`（`:92-97`・`:168`）、`passiveNames`・`passiveDescs`（`:181-182`）がある。共有の個体（`ownedFromShared`、`:482-526`）も同じ形（スキルは `skillIds` の列が入った共有だけ）。
- 行は `content-visibility: auto`（`web/css/app.css:933`）で全件を描いている（owned-rows で推定の高さが直る）。

### 実装の手順
1. 新しいファイル `web/js/ui/owned-detail.js`:
   ```js
   /**
    * 所持パルの 1 体の詳細（ドロワーの中身）。owned を購読し、データが変わったら同じ個体 ID で描き直す。
    * @param {object} context
    * @param {string} instanceId 個体 ID（タマゴは localId）
    * @param {{ terms?: string[] }} options 所持パルで入れていたキーワード（一致の全文を出すため）
    * @returns {{ element: HTMLElement, title: string, destroy(): void } | null}
    */
   export function ownedDetail(context, instanceId, { terms = [] } = {})
   ```
   - ドロワーの中身の表に `owned: (entry, context) => ownedDetail(context, entry.id, { terms: entry.params?.q ? keywordTerms(entry.params.q) : [] })` を足す。
2. **中身**（上から）:
   - 大きいアイコン（`palIcon(pal, { large: true })`。人間は `humanIcon`）、名前・ニックネーム・性別（`genderMark()`）・Lv（タマゴは「孵化前」ではなく owned-rows の「—」に合わせる）・★4 枠。
   - 個体値: owned-rows の 4 セル＋ミニバー（HP・攻・防・計）。
   - パッシブ: ランク順のチップ（`passiveChip`）と、その下に説明の文（`passiveDescs`）を 1 行ずつ。5 個以上でも全部出す（行の「+N」はここで全部見える）。
   - パートナースキル（名前＋説明）、属性（文字チップ。game-assets の後はアイコン）、覚えているアクティブスキル（名前＋説明。名前の表にないものは ID のまま）。
   - キーワード一致の全文: `terms` があれば `keywordNotes(pal, terms)` の全部を、説明つきで出す（行では 1 行に切っている）。
   - 場所: 所持者・場所の短い表記（owned-rows の「パルボックス P2 · 1-6」）と 6×5 の SVG、拠点の個体は「預けた人」。
   - リンク: 「パル詳細」（ドロワーの中で `context.drawer.open({ kind: 'pal', id: pal.palId })`。stack に積まれ「← 前へ」で戻れる）、owned-rows の行の操作と同じ「目標に」「ここから継承ルート」「親1 にして配合を探す」。
3. **行から開く**（`web/js/views/owned.js` の一覧と owned-rows の行の部品）:
   - 行の操作（ホバー／フォーカスで出るボタン）に「詳細」（`aria-label`「〈名前〉の詳細」）を足す。キーボードではこのボタンで開く。
   - 行の名前・アイコン以外のセル（パッシブ・個体値・場所）のクリックでも開く。ただし `window.getSelection()?.toString()` が空でないとき（文字を選んでいる）と、押した所がボタン・リンク・チップの固定の操作のときは開かない。委譲のリスナーを一覧の入れ物に 1 つだけ置く（行ごとに付けない）。
   - 開いている個体の行に `aria-current="true"` と淡い背景（`syncList` の `update` で付け外し）。
   - `opener` は押した行の「詳細」ボタン（閉じたらそこへフォーカスを戻す。行が絞り込みで消えていたら drawer の決まりで見出しへ）。
4. **データが変わったとき**: `owned.subscribe` で、同じ個体 ID を新しい `state.owned.pals` から引き直して描き直す。見つからなければ「この個体は最新のセーブにいません（移動・引き渡し・解放）」と「閉じる」を出す（`null` を返して drawer に任せてもよい）。描き直しは中身だけで、ドロワーのスクロール位置は保つ。
5. `docs/OPERATIONS.md` の所持パルの節に「行の詳細ボタン（または行のパッシブ・個体値・場所）で、右に個体の詳細」を足す。

### 触るファイル
- 新規: `web/js/ui/owned-detail.js`、`test/web/owned-detail.test.js`
- 変更: `web/js/views/owned.js`（行の「詳細」・委譲のクリック・`aria-current`）、owned-rows で作った行の部品のファイル、`web/js/app.js`（ドロワーの中身の表に `owned`）、`web/css/app.css`、`docs/OPERATIONS.md`、`web/js/release-notes.js`

### テスト
- 新設 `test/web/owned-detail.test.js`:
  - パッシブの説明・パートナースキル・アクティブスキル（名前の表にない ID はそのまま）・個体値・場所が出る。
  - `terms` を渡すと、一致の全文（説明つき）が出る。
  - 所持パルを読み直して同じ個体がいれば描き直し、いなければ「最新のセーブにいません」。
  - 「パル詳細」でドロワーの stack に積まれる。
- `test/web/owned-view.test.js` に足す: 行の「詳細」でドロワーが開く、文字を選んでいるときのクリックでは開かない、パル名（リンク）のクリックはパル詳細を開く（個体の詳細ではない）。
- 期待値が変わる既存のテスト: 行の DOM に「詳細」のボタンが増えるので、行の中のボタンの数を数えているテストがあれば直す（owned-rows で行の操作を入れたときのテスト）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 出すのはセーブの所持データとゲームのマスターだけ。
- 互換: スキルを読む前に読み込んだセーブ・`skillIds` の列のない共有では、スキルの欄を「このセーブには記録がありません」にする（空のまま欄を消さない）。
- セキュリティ: 説明文は他人のセーブ由来ではなくマスター由来だが、ニックネーム・プレイヤー名は他人が付けたものなので必ず `textContent`。
- 性能: 一覧の行にリスナーを足さない（委譲 1 つ）。2,000 行を超えて見えている範囲だけ描く状態（stable-render）でも、開いている個体の印が付け外しできること。

### release-notes の案
- id: `YYYY-MM-DD-owned-detail`
- title: 「個体の詳しい情報」（8 字）
- body: 「所持パルの行を押すと、スキルの説明や場所の図を右のパネルで見られます。」（35 字）

### 完了の条件
- [ ] `npm test` が通る。
- [ ] モック（`Claude outputs/ui-audit-2026-10/shots/owned/inject.js` で 138 体を入れた状態）で、所持パルの行の「詳細」を押すとドロワーに全部の情報が出て、一覧のスクロール位置と絞り込みが変わらない。
- [ ] キーワード「闇」で絞った状態で開くと、一致の全文（説明つき）が出る。
- [ ] 20 秒・1 分ごとの読み直しの後も、同じ個体が開いたまま（いなくなれば案内が出る）。
- [ ] Esc で閉じると、フォーカスが押した行の「詳細」に戻る。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 出すのは所持データとゲームのマスターだけ。互換 — スキルのない古いセーブ・`skillIds` の列のない共有で「このセーブには記録がありません」と出る。セキュリティ — ニックネーム・プレイヤー名は textContent（`test/static/security.test.js`）。性能 — 行にリスナーを足さず（委譲 1 つ）、2,000 行を超えて見えている範囲だけ描く状態でも、開いている個体の印が付け外しできる。

### TODO
- [ ] `web/js/ui/owned-detail.js` に `ownedDetail(context, instanceId, { terms })` を書く
- [ ] 中身（アイコン・名前・Lv・★・個体値の 4 セル・パッシブと説明・スキル・属性・場所の図・リンク）
- [ ] キーワード一致の全文（`keywordNotes` の全部）
- [ ] 行の操作に「詳細」を足し、パッシブ・個体値・場所のセルのクリックでも開く（委譲・文字選択中は除く）
- [ ] 開いている行の `aria-current` と背景
- [ ] 読み直しで同じ個体を引き直す・いなければ案内
- [ ] ドロワーの中身の表に `owned` を足す
- [ ] テスト（owned-detail・owned-view）
- [ ] OPERATIONS.md と release-notes

---

## farm-data: 牧場のタマゴを残して共有する（牧場の表示の土台）

### 目的
セーブの解析では読めているのに画面用の変換で捨てている「どの牧場にどのタマゴがあるか」を、画面用の形と仲間への共有の形に残す。共有のセル（1 セル 50,000 字）に必ず収まるように上限と縮め方を決め、牧場の情報が一部だけのときは判定を保留できるようにする。

### 経緯
- **N-05**（配合牧場のタマゴを捨てずに持ち、共有にも載せる）。検証で「『タマゴを捨てる』は言い過ぎ。牧場のタマゴは所持パルの一覧に egg の個体（instanceId＝タマゴの localId）として出ている。失われているのは『どの牧場のタマゴか』の対応だけ」と直った。判断: `eggs: [{ palId, mutant }]` を残し、共有には牧場ごとに中身の配列を足し、20 個までに切る。`OWNED_MAX_FARMS` の「1 件 180 字」の見積もりを計算し直す。
- **Codex のプランレビュー**（[codex-reviews.md](appendix/codex-reviews.md)）:
  - 1 回目 6: 「route-progress（タマゴあり）が farm-board より前にあり、依存が逆」→ farm-board を「データの保持と共有」（このテーマ）と「画面」（farm-board）に分け、前者を route-progress より前へ。
  - 1 回目 7・2 回目 E: 「新しいデータの共有経路とセルの上限が未定義」→ 共有の JSON は書き出した後 45,000 字まで、牧場 200 件・タマゴの中身は 1 牧場 20 個まで。超えたらタマゴを個数だけ → それでも超えたら牧場を入る分だけ、「一部だけ」の印。GAS も同じ上限で farms だけを縮める（個体の行の共有は止めない）。
  - 2 回目 F・6 回目 7: 「親が不明な牧場のタマゴを残す」「牧場の状態の保持の時期」→ 牧場の状態の保持（`status: 'uncertain'` を捨てない）と完全性の判定は**フェーズ 1 の ideal-farms に前倒し**。このテーマはそれを使う。
  - 4 回目 新 1: 「牧場を省いた共有データで交換推奨が誤る（`core/ideal-farms.js:38` は受け取った牧場の数で決める）」→ 牧場を省いたデータでは、交換推奨・空き牧場・使用中の印の判定を保留して「牧場の情報が一部のため判定を保留」と出す。**タマゴの中身だけを省いた場合は保留しない**（2 つの状態を分けて持つ）。
- コードで確かめた追加の事実（統合プランにない）: farms の列はすでにある（`gas/Sheets.js:35`）ので、**`setup()` は通常は要らず `npm run gas:push` だけ**。GAS は知らない最上位の項目を断る（`gas/Owned.js:77-78`）ので、新しい値は各牧場の中に足す（0-4 の決まり）。

### 依存
- data-boundary（共有の応答・IndexedDB の読み戻しの検証）、ideal-farms（牧場の `status` の保持・完全性の判定・A／B の記号）。drawer とは独立（順番を前にしてもよい）。

### このテーマでやらないこと
- 画面（牧場ボード・バッジ・孵化待ち）は作らない（farm-board）。このテーマだけでは画面の見た目はほぼ変わらない。
- タマゴのアイテム ID の列（タマゴの名前・突然変異のバッジ）は farm-board で個体の列として足す。ここでは牧場ごとの突然変異の印（`m`）だけ。
- 牧場のケーキの残り（save-extras の N-09。ホストだけで共有しない）。
- 親の組から子を予測して持つこと（INV-2）。

### 現状
- セーブの解析: `parseBreedFarms`（`web/js/save/palworld.js:292-353`）が牧場ごとに親の個体 ID とタマゴの入れ物を集め、`buildSnapshot`（`:1047-1071`）が `breedFarms: [{ id, baseId, status: 'ok'|'uncertain', parents: [{ instanceId, characterId, gender, depositorUid }], eggs: [{ localId, characterId, itemId }] }]` を作る。1 牧場のタマゴは 64 個まで読む（`:259` の `MAX_FARM_EGGS`）。
- 画面用の変換: `normalizeOwned` の farms（`web/js/core/owned.js:206-208`）は `status !== 'uncertain'` の牧場だけを `{ id, baseId, parents: [instanceId] }` にして、タマゴを捨てる（ideal-farms で `status` は残るようになる）。牧場を読む前の解析結果では `null`（情報がない）。
- 牧場のタマゴは所持パルの一覧に egg の個体として入っている（`web/js/save/palworld.js:1023-1036`。instanceId＝タマゴの localId、`location.itemId` にアイテム ID）。場所は「タマゴ（地面）・拠点 N」（`web/js/core/owned.js:160`）。`itemId` は正規化で落ちる（`:163-199` に項目がない）。
- 共有: `sharedUpload`（`web/js/core/owned.js:456-476`）が farms を `{ id, baseId, parents }` で送る（`:472`。farms が null なら送らない）。`cleanOwnedFarms`（`web/js/core/owned-shared.js:22-33`）が 200 件・`id`/`baseId`/親 ID を 40 字まで・親 2 体までに整える。「1 件は JSON で 180 字ほど」（`:17-19`）。GAS は `quoteForSheet(JSON.stringify(world.farms))`（`gas/Owned.js:126`）で 1 セルに入れる。参加者は `ownedFromShared` で受け取る（`web/js/core/owned.js:523`。farms がなければ null）。
- 判定: `farmAdvice`（`web/js/core/ideal-farms.js:37-65`）は渡された牧場の数で「置く組の数」を決める（`:38`）。
- 永続化: IndexedDB にはスナップショット（`breedFarms` を含む）をそのまま保存し、表示のたびに `normalizeOwned` を通す（`web/js/owned.js:218`・`:338`）。**保存済みのスナップショットにも `eggs` は入っている**ので、正規化を直せば読み込み直しなしで反映される。

### 実装の手順
1. **画面用の形を決める**（`web/js/core/owned.js` の `normalizeOwned`。ideal-farms で入った形に足す）:
   ```js
   farms: [{
     id, baseId, status: 'ok'|'uncertain',          // ideal-farms で保持
     parents: string[],                             // 親の個体 ID（uncertain の牧場は読めた分だけ）
     eggs: { id: string, palId: string, mutant: boolean }[] | null,  // null = 中身が分からない（共有で省かれた）
     eggCount: number,                              // タマゴの数（eggs が null でも分かる）
   }] | null,
   farmsPartial: boolean,                           // 牧場そのものが一部だけ（共有で省かれた）
   ```
   - `eggs` は `snapshot.breedFarms[].eggs` から作る: `id`＝`localId`、`palId`＝`createSpeciesResolver(pals)(characterId).palId`（マスターにないものは空文字）、`mutant`＝`/^PalEgg_MutationPal/i.test(itemId)`（`web/js/core/auto-breeding.js:18` の `isMutationEgg` と同じ判定）。**`core/auto-breeding.js` は import しない**（配合表を読むモジュールで、読める場所を `test/import.test.js:32` で `auto-register.js`・`views/owned-settings.js` に限っている）。判定の関数 `isMutationEggItem(itemId)` を `web/js/core/owned-shared.js` に置き、`auto-breeding.js` の `isMutationEgg` もそれを使うように寄せる。並びはセーブの順。
   - ローカルのスナップショットでは `farmsPartial: false`、`eggs` は全部（64 個まで）。
2. **共有の形と上限**（`web/js/core/owned-shared.js`。`npm run build:gas` で `gas/Shared.js` に写る。import は使わない決まり）:
   ```js
   export const OWNED_FARMS_MAX_CHARS = 45000;   // JSON.stringify した後の文字数（セルは 50,000 字。quoteForSheet の分の余裕）
   export const OWNED_FARM_EGGS_MAX = 20;        // 1 牧場の中身を送る数
   // 共有の 1 牧場: { id, baseId, parents, s?: 'u', eggs?: [{ id, p, m? }], n?: number, of?: number }
   //   s: 'u' は uncertain、eggs は中身（p = palId、m = 1 で突然変異）、n はタマゴの数、of はワールドの牧場の総数
   export function cleanOwnedFarms(value)        // 今の検証に s・eggs（20 個まで・id 40 字・p は /^[A-Za-z0-9_]{1,64}$/）・n（0〜64 の整数）・of（整数）を足す
   export function fitOwnedFarms(farms)          // 45,000 字に収める（下の順）。返り値は縮めた配列
   ```
   - `fitOwnedFarms` の順: (1) そのまま `JSON.stringify` して 45,000 字以下ならそのまま。(2) 超えたら全部の牧場の `eggs` を外して `n` だけにする（中身を省いた。牧場は全部ある）。(3) まだ超えたら、牧場を先頭から入る分だけ残し、残した全部の牧場に `of`（元の総数）を付ける（一部だけ）。
   - 短い鍵（`s`・`p`・`m`・`n`・`of`）にするのは字数を減らすため（1 個のタマゴで約 60 字。20 個 × 200 牧場でも (2)(3) で必ず収まる）。
   - `validateOwnedUpload`（`owned-shared.js:48-93`）の farms は `fitOwnedFarms(cleanOwnedFarms(source.farms))` にする（GAS・開発用 API・画面で同じ上限）。
3. **送る側**（`sharedUpload`、`web/js/core/owned.js:472`）: 画面用の farms を共有の形（`s`・`eggs`（`{ id, p, m }`）・`n`）にしてから `fitOwnedFarms` を通して送る。`of` は送る側では付けない（縮めたときだけ付く）。**読めない牧場（`status: 'uncertain'`）は `{ id, baseId, parents: [], s: 'u', n }` で送る**（読めた親は送らない）。フェーズ 1 の ideal-farms が uncertain の牧場を共有に送らないことにした理由は「古い GAS と旧コードの画面が `s` を捨てて普通の牧場として扱う」ためで、親を空にしておけば `s` が捨てられても、旧コードの `targetFarms` は親 2 体の牧場しか使わない（`web/js/core/ideal-farms.js:20`）ので、置いてある組と取り違えない（2026-10-12 の最終確認で足した決まり）。
4. **受け取る側**（`ownedFromShared`、`web/js/core/owned.js:523`）: 共有の形を画面用の形に戻す。`eggs` があれば `eggs: [{ id, palId: p, mutant: m === 1 }]`、なければ `eggs: null`（中身が分からない）、`eggCount` は `n ?? eggs.length ?? 0`。`farmsPartial` は `farms.some((farm) => Number.isInteger(farm.of) && farm.of > farms.length)`。**古い GAS・古いホストの画面からの共有**（`s`・`eggs`・`n`・`of` がない）は `eggs: null`・`eggCount: 0`・`status: 'ok'`・`farmsPartial: false` として受け、牧場の表示は「タマゴの情報なし」にする（0 個と取り違えない）。**古い形の共有**（どの牧場にも `n` がない＝古い GAS か古いホストの画面）では、親のない牧場が読めない牧場かもしれないので、空き牧場の判定（ideal-farms の `emptyFarms`）をしない（置いてある組と交換推奨は今どおり）。
5. **完全性の判定**（ideal-farms で入れた関数を広げる）: 「牧場そのものが欠けている」＝ `farmsPartial` または読めない牧場がある、のときは、交換推奨・空き牧場・使用中の印の判定を保留して「牧場の情報が一部のため判定を保留」と出す。`eggs: null`（中身だけを省いた）のときは保留しない。関数の名前と置き場所は ideal-farms の実装に合わせ、ここでは `farmsPartial` の条件を足すだけにする。
6. **data-boundary**: IndexedDB のスナップショットの `breedFarms[].eggs`（配列・各項目の文字列の長さ・数 64 まで）と、共有の応答の farms（上の `cleanOwnedFarms`）を検証に入れる。
7. **GAS**: `npm run build:gas` で `gas/Shared.js` を作り直す（`cleanOwnedFarms`・`fitOwnedFarms`）。`gas/Owned.js` は変えない（`validateOwnedUpload` の中で縮めるので、`:126` の書き込みはそのまま 45,000 字以下になる）。反映はユーザーが `npm run gas:push`（farms の列がないシートだけ `setup()`）。**クライアントを先に配信しても、古い GAS は新しい項目を捨てて今の形で保存するだけで、共有は止まらない**（0-4）。
8. **`docs/SAVE_FORMAT.md`**: 「配合牧場」の節に、画面用の `eggs`・共有の短い鍵・上限と縮め方を書く。`OWNED_MAX_FARMS` のコメント（`owned-shared.js:17-19`）を「上限は `OWNED_FARMS_MAX_CHARS` で守る」に直す。
9. `scripts/check-save.mjs` の牧場の出力（`:65-73`）に、正規化の後の `eggs` の数と突然変異の数を足す（読み取りのみ。表の子の出力は今のまま）。

### 触るファイル
- 変更: `web/js/core/owned.js`（normalizeOwned・sharedUpload・ownedFromShared）、`web/js/core/owned-shared.js`（cleanOwnedFarms・fitOwnedFarms・定数）、`gas/Shared.js`（build:gas で生成）、data-boundary の検証のファイル、ideal-farms の完全性の判定、`scripts/check-save.mjs`、`docs/SAVE_FORMAT.md`、`web/js/release-notes.js`
- 変えない: `gas/Owned.js`・`gas/Sheets.js`・`web/js/api.js`（送る項目名は `farms` のまま）

### テスト
- 期待値が変わる既存のテスト: `test/core/owned.test.js:47-62`（`withFarms.farms` の `deepEqual` に `status`・`eggs`・`eggCount` が増える。`farms: null`・`'farms' in sharedUpload(owned) === false`・`[]` の扱いは残す）。`test/gas/owned.test.js:49-54`（farms の往復。新しい項目が残ること、古い形も受けること）。
- 足すテスト:
  - `test/core/shared.test.js`: `fitOwnedFarms` の 3 段階（そのまま／中身を外して数だけ／牧場を切って `of`）。結果の `JSON.stringify` が常に 45,000 字以下（牧場 200・タマゴ 20 個・ID 40 字の最悪の場合）。`cleanOwnedFarms` が不正な `eggs`・`n`・`of` を捨て、古い形（親だけ）を受ける。
  - `test/core/owned.test.js`: 正規化の `eggs`（突然変異の判定・マスターにない中身は空文字）、`ownedFromShared` の `eggs: null` と `farmsPartial`、古い共有（新しい鍵なし）で `eggCount: 0`・`eggs: null`。`sharedUpload` が uncertain の牧場を `parents: []`・`s: 'u'` で送り、`ownedFromShared` が `s: 'u'` を `status: 'uncertain'` に戻す（完全性の判定で保留になる）。`n` のない古い形では空き牧場を数えない。
  - `test/gas/owned.test.js`: 大きな farms を送ってもワールドの行の farms のセルが 45,000 字以下で、個体の行は全部保存される。
  - ideal-farms のテスト（`test/core/ideal-farms.test.js` など）: `farmsPartial` のとき判定を保留、`eggs: null` だけでは保留しない。
- 変わらないテスト: `test/save/breed-farm.test.js`（解析は変えない）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: タマゴの中身はセーブの実物なので持ってよい。**親の組から配合表で子を求めて持たない・出さない**。
- 互換（新旧の混在）: 新しい画面＋古い GAS → 新しい鍵は捨てられ今の形で保存（共有は止まらない）。古いホストの画面＋新しい GAS → 新しい鍵なしで保存 → 参加者は「タマゴの情報なし」。新しい GAS の応答を古い画面が受ける → 古い `cleanOwnedFarms` が新しい鍵を捨てる（今の表示のまま）。旧コードのタブが IndexedDB を書き換えても、スナップショットの形は変わらない。uncertain の牧場は親を空にして送るので、古い GAS が `s` を捨てても、読めない牧場の親が「置いてある組」として扱われることはない（上の手順 3）。
- セキュリティ: 共有の文字列は `ownedText` で制御文字を外し長さを切る（今の決まり）。表示は farm-board で `textContent`。
- 性能: `fitOwnedFarms` は最悪でも牧場 200 件の `JSON.stringify` を数回だけ。

### release-notes の案
- id: `YYYY-MM-DD-farm-eggs-shared`
- title: 「牧場のタマゴも共有」（9 字）
- body: 「ホストの共有に配合牧場のタマゴの数と中身を含めます。参加者の牧場の表示に使います。」（41 字）
- 画面に変化がないので、farm-board と同じ配信なら farm-board の 1 件にまとめてよい。

### 完了の条件
- [ ] `npm test` が通る（上の最悪の場合のテストを含む）。
- [ ] `npm run check:save -- "<ワールドのフォルダ>"` で、牧場ごとのタマゴの数・突然変異の数が出て、今までの出力と矛盾しない。
- [ ] モックで、ホストの画面の共有 → 参加者（モックの役割の切り替え。roles で入る `?as=guest`）の画面で、牧場の `eggs` が受け取れる。古い形の共有を入れても壊れない。
- [ ] GAS の反映（`npm run gas:push`）の手順を、フェーズの報告でユーザーに伝える。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 親の組から配合表で子を求めて持たない・出さない。互換 — 新しい画面＋古い GAS、古いホストの画面＋新しい GAS、古い共有の 3 通りで、共有が止まらず画面も壊れない（読めない牧場の親を「置いてある組」と取り違えない）。セキュリティ — 共有の文字列は `ownedText` で整える。性能 — `fitOwnedFarms` は牧場 200 件でも `JSON.stringify` 数回で 45,000 字以下に収める。

### TODO
- [ ] 画面用の farms に `eggs`（id・palId・mutant）・`eggCount`、全体に `farmsPartial` を足す
- [ ] `owned-shared.js` に `OWNED_FARMS_MAX_CHARS`・`OWNED_FARM_EGGS_MAX`・短い鍵の検証・`fitOwnedFarms` を書く
- [ ] `validateOwnedUpload` で `fitOwnedFarms(cleanOwnedFarms(…))` にする
- [ ] `sharedUpload` を共有の形＋縮めてから送るように（読めない牧場は親を空にして `s: 'u'`）
- [ ] `ownedFromShared` で共有の形を戻し、古い形は「タマゴの情報なし」に（古い形では空き牧場を判定しない）
- [ ] ideal-farms の完全性の判定に `farmsPartial` を足す（中身だけ省いたときは保留しない）
- [ ] data-boundary の検証に `breedFarms[].eggs` と共有の farms を入れる
- [ ] `npm run build:gas` で gas/Shared.js を作り直す
- [ ] テスト（shared・owned・gas・ideal-farms）と owned.test.js:53 の期待値の更新
- [ ] check-save の出力、SAVE_FORMAT.md と owned-shared.js のコメント
- [ ] release-notes と、ユーザーへの `gas:push` の依頼

---

## farm-board: 配合牧場ボード・牧場の印・孵化待ちのタマゴ

### 目的
全部の配合牧場（空き・片親・読めない牧場も含む）の親・タマゴの数と中身・預けた人を 1 か所で見られるようにし、所持パルの行に「配合牧場」の印、タマゴに名前と突然変異のバッジを付ける。孵化させれば目標を満たすタマゴがあることも知らせる。

### 経緯
- **N-06**（O-55・G-13・N-07 を吸収）: 配合牧場ボード。検証の判断で、最初の版は「所持パルのタブの上部に折りたためる『配合牧場（N か所・タマゴ M 個）』の帯（開いた状態は記憶）・牧場ごとのカードに拠点名・♂♀の親・タマゴ n 個・中身のパル画像・突然変異は枠・読めない牧場は『読めませんでした』」に絞った。ヘッダーのチップ・自動登録の記録・交換推奨のチップは「使われ方を見てから」。**交換推奨は理想個体のタブにすでにあり、ボードにも出すと二重になる**ので出さない。
- **F049**（全牧場の表示: 空き・片親・タマゴ数・預けた人）と **F050**（牧場とタマゴをどこからでも見る右ドロワー）: 統合プランで「所持パルの上部の折りたためる帯と、ドロワーで」に決めた。F050 のヘッダーのミニバーは作らず、ドロワーの入口は header-frame の状態のポップオーバー・理想個体の牧場の欄・所持パルの帯の「右に開く」に置く。
- **O-51**: 牧場の親と牧場の上のタマゴに「配合牧場」のバッジ。判断: 場所の絞り込みに項目は足さず、キーワード（`keywordFields` の status）に「配合牧場」を足す。理想個体から行へ飛ぶ機能はやめる。
- **O-47**: タマゴをゲームのタマゴのアイコンと名前で。判断: 段 A（S）＝ `eggItemId` を残し（共有は `OWNED_ADDED_FIELDS` の末尾に 1 列）、`PalEgg_MutationPal_*` なら「突然変異」のバッジ、「孵化前」の位置に `ITEM_NAME_<ID>` から引いたタマゴの名前（名前の表は `scripts/extract-skills.mjs` の読み方で取る）。段 B（実物のアイコン）は game-assets。**手描き SVG で属性の色に塗る案はやらない**（推定で突然変異のときに外れる）。
- **N-16**・**F048**: 孵化待ちで目標を満たすタマゴ。判断: 近さの点数はやめ、「条件を満たすタマゴ」だけ。完成の判定（`goalMatches`）と同じ条件をタマゴだけに当てる別の関数。**完成の判定・通知・親の候補（`isParentCandidate`）は変えない**（19f673c で「タマゴは孵化するまで牧場に置けないので、親の候補にも完成の判定にも使わない」と決めた）。
- **N-08**（タマゴが 20 個に近づいたら知らせる）: 判断で「ユーザーがゲームで上限を確かめてから、牧場のカードにだけ出す。ベルの通知は声が出てから」。上限の 20 は wiki の値で未確認（解析は 64 個まで読む。`web/js/save/palworld.js:259`）。
- **INV-2**: タマゴの中身を「A×B→C」の式で出さない（統合プランの行に明記）。並べるのは中身のアイコンだけ。

### 依存
- farm-data（`eggs`・`eggCount`・`farmsPartial`・牧場の `status`）、owned-rows（`ownedRow` の部品とバッジの置き場所）、owned-toolbar（場所チップの URL）、goals-merge（目標の一覧の行）、drawer、ideal-farms（A／B の記号・完全性の判定）。

### このテーマでやらないこと
- 交換推奨のチップ（理想個体にある。二重にしない）、ヘッダーの常設のミニバー、自動登録の記録の新しい保存（autoreg-success・bell で扱う）。
- 牧場のケーキの残り（save-extras の N-09）、孵化の残り時間（save-extras の F088）。
- タマゴの実物のアイコン（game-assets。ここでは名前と突然変異のバッジまで）。
- 場所の絞り込みに「配合牧場」を足すこと（O-51 の判断）。
- 子の予測（配合表）を出すこと。

### 現状
- 牧場が画面に出るのは理想個体の「配合牧場（この目標の組を置いている N か所 · 交換推奨 N か所）」の欄だけ（`web/js/views/ideal.js:405-433`。`targetFarms` で目標の組に絞る、`web/js/core/ideal-farms.js:15-28`）と、組のカードの「◯◯に配置中」（`web/js/views/ideal.js:110`）。目標と関係ない牧場・空き牧場・タマゴの数を見る場所はない。
- 所持パルの行のバッジはニックネーム・タマゴ・ラッキー・アルファだけ（`web/js/views/owned.js:41-46`）。タマゴの行は「孵化前」（`:55`。owned-rows で Lv は「—」に変わる）。タマゴのアイテム ID は解析で読んでいる（`web/js/save/palworld.js:1036` の `location.itemId`）が、`normalizeOwned`（`web/js/core/owned.js:163-199`）と共有の列（`web/js/core/owned-shared.js:5-10`）にない。
- キーワードの status は「タマゴ・ラッキー・アルファ」（`web/js/core/owned.js:233`）。
- 完成の判定 `goalMatches`（`web/js/core/ideal-goals.js:146-154`）は `pal.egg` を外す（`:149`）。拠点に置かれたタマゴ（地面・孵化器・保管箱）には持ち主が入らない（`:127-130`、`web/js/core/owned.js:148`）。
- 通知の元は 4 つ（`web/js/app.js:81`）。
- タマゴの名前の表はない。`scripts/extract-skills.mjs` は `DT_ItemNameText_Common` を読んで説明文の参照を置き換えている（`docs/SAVE_FORMAT.md:84`）。

### 実装の手順
1. **個体に牧場の印を持たせる**（`web/js/core/owned.js`）: `normalizeOwned` と `ownedFromShared` の最後で、farms から「個体 ID → `{ farmId, baseId, role: 'parent'|'egg' }`」の Map を作り、各個体に `farm: { id, baseId, role } | null` を足す（共有では `eggs` が null の牧場のタマゴには付かない）。`keywordFields` の status に `pal.farm && '配合牧場'` を足す（`:233`）。
2. **タマゴのアイテム ID**: `normalizeOwned` で egg の個体に `eggItemId: location.itemId ?? ''` を足す。共有は `OWNED_FIELDS` の末尾に `'eggItemId'` を足し、`OWNED_ADDED_FIELDS` にも足す（`owned-shared.js:5-13`。足す前の画面からの共有も受け付ける）。`sharedUpload`・`ownedFromShared` で往復させる。長さの上限は 64 字（`OWNED_TEXT_MAX`）。
   - GAS: `npm run build:gas` → ユーザーが `npm run gas:push` と **`setup()`**（個体の列が増えるので要る。足すまでは GAS は書かずに読む）。
3. **タマゴの名前の表**: `scripts/extract-skills.mjs` に、`DT_ItemNameText_Common` の `ITEM_NAME_PalEgg_*` の行を `EGG_NAMES`（`{ 'PalEgg_Fire_01': '炎のタマゴ', … }` の形。実際の名前はゲームのデータどおり）として書き出す処理を足す。出力先は `web/data/skills.js` に足すか、新しい `web/data/items.js`（`export const EGG_NAMES = {…}`）。`data/SOURCES.md` の表に 1 行足す（ゲーム本体 `DT_ItemNameText_Common`・© Pocketpair, Inc.）。表にない ID（ゲームの更新で増えたもの）は名前なし（今の「タマゴ」）に戻す。
4. **行のバッジ**（owned-rows の行の部品）: `pal.farm` があれば「配合牧場」のバッジ（`title` は「拠点 1 の配合牧場 A」。A／B は ideal-farms の記号）。タマゴは、名前があれば「孵化前」の代わりにタマゴの名前（例「大きな炎のタマゴ」）、`isMutationEggItem(eggItemId)` なら「突然変異」のバッジ（状態チップの共通部品）。キーワードの status に `'突然変異'` も足す。
5. **牧場ボードの部品**: 新しいファイル `web/js/ui/farm-board.js`:
   ```js
   /**
    * 全部の配合牧場のカード。所持パルの帯とドロワーで同じものを使う。
    * @param {object} context
    * @param {{ mode: 'band'|'drawer' }} options
    * @returns {{ element: HTMLElement, title: string, update(state: object): void, destroy(): void }}
    */
   export function farmBoard(context, { mode })
   ```
   - 1 牧場＝1 カード（`syncList`、key は牧場 ID）。拠点の並び（`bases` の順）→ 同じ拠点の中は A／B の順。
   - カードの中身: 「拠点 1 の牧場 A」（`farmName` と同じ表記。`web/js/views/ideal.js:400-403`）、♂・♀の親（`palTile`・`genderMark()`・パッシブの小さいチップ・個体値の合計。個体は `pals` から個体 ID で引く）、預けた人（`lastOwner`）、状態のチップ（「配合中」＝♂♀がそろう／「片親」＝1 体／「同性」＝同じ性別 2 体／「空き」＝0 体／「読めませんでした」＝`status: 'uncertain'`）、「タマゴ n 個」と中身のパル画像の列（`eggs` があれば。突然変異は枠。最大 20 個、残りは「ほか n 個」）、`eggs: null` なら「タマゴ n 個（中身はホストの画面で見られます）」。
   - その組の登録済みの配合の件数（`findByPair(state.index, ♂の palId, ♀の palId)` の件数）を「この組の登録 n 件 →」として `#/search?p1=&p2=` にリンク（**登録済みの記録の件数だけ。子の名前・予測は出さない**）。
   - `farmsPartial` なら上に「牧場の情報が一部です（共有の上限のため）」。牧場が 0 件でも帯の高さは保ち「配合牧場はまだありません」。
   - 牧場のカードの親を押すと個体の詳細（`context.drawer.open({ kind: 'owned', id })`）。
6. **置き場所**:
   - 所持パル（`web/js/views/owned.js`）: 要約の下、絞り込みのパネルの上に `details.farm-band`「配合牧場（N か所 · タマゴ M 個）」。既定は閉じる。開閉は `context.viewState('owned').farmsOpen`（タブを替えても残る）。帯の右に「右に開く」（ドロワーで同じボードを開く）。所持パルの sticky のパネルより上（スクロールで流れる位置）に置く。
   - ドロワー: 中身の表に `farms: (entry, context) => farmBoard(context, { mode: 'drawer' })`。入口は、header-frame の状態のポップオーバー（ui/save-status.js の `headerPopup` の中身。操作は `.header-panel-actions` に並ぶ）に「配合牧場を見る」、理想個体の牧場の欄（ideal-farms の sticky 行）の見出しに「全部の牧場」。
7. **孵化待ちのタマゴ（F048・N-16）**: `web/js/core/ideal-goals.js` に足す:
   ```js
   /** 目標の条件を満たすタマゴ（孵化させれば完成）。goalMatches と同じ条件をタマゴだけに当てる。goalMatches は変えない。 */
   export function eggMatches(goal, pals)
   ```
   - 対象のタマゴ: 自分の個体のうちタマゴのもの（`ideals.mine()` の egg）と、**拠点に置かれた持ち主のないタマゴ**（`pal.egg && !pal.holderUid`。孵化させた人の個体になるので、自分の判定に入れる）。中身が読めないタマゴ（`palId` が空）は外す。
   - 表示 1（理想個体の結果の上。`web/js/views/ideal.js` の `note` の下）: 目標を選んでいて該当があれば「孵化させると完成: タマゴ 2 個（拠点 1・タマゴ（地面）ほか）」と 1 行。押すと所持パルを「場所＝タマゴ＋その種族＋欲しいパッシブ」で開く（owned-toolbar の URL）。0 個なら行を出さない（高さは ideal-panel の固定スロットに入れて揺れないようにする）。
   - 表示 2（目標の一覧の行。goals-merge のダイアログ）: 未完成の行に「（孵化待ちに 1 個）」を添える。**ベルは鳴らさない**（完成の通知は今までどおり孵化して受け取ったとき）。
8. **N-08（任意・確認が要る）**: ユーザーにゲームでの牧場のタマゴの上限を確かめてもらう（質問 1 件）。確かめた値を `web/js/ui/farm-board.js` の定数 `FARM_EGG_CAP`（確かめた日とどこで確かめたかをコメントに）にし、上限の 2 個手前から「もうすぐいっぱい（18/20）」のチップをカードにだけ出す。確かめられないうちは出さない。
9. `docs/OPERATIONS.md` の所持パルの節に、配合牧場の帯・バッジ・キーワード「配合牧場」「突然変異」・孵化待ちを書く。`docs/SAVE_FORMAT.md` に `eggItemId` の列とタマゴの名前の表を書く。

### 触るファイル
- 新規: `web/js/ui/farm-board.js`、`test/web/farm-board.test.js`、（新しくするなら）`web/data/items.js`
- 変更: `web/js/core/owned.js`（`farm`・`eggItemId`・キーワード）、`web/js/core/owned-shared.js`（列・`isMutationEggItem`）、`gas/Shared.js`（build:gas）、`web/js/core/ideal-goals.js`（`eggMatches`）、`web/js/views/owned.js`（帯）、owned-rows の行の部品（バッジ）、`web/js/views/ideal.js`（孵化待ちの 1 行・牧場の欄の「全部の牧場」）、goals-merge の目標の一覧（行の添え書き）、header-frame の状態のポップオーバー、`web/js/app.js`（ドロワーの中身の表）、`scripts/extract-skills.mjs`、`data/SOURCES.md`、`docs/OPERATIONS.md`、`docs/SAVE_FORMAT.md`、`web/js/release-notes.js`

### テスト
- 新設 `test/web/farm-board.test.js`: 状態のチップ（配合中・片親・同性・空き・読めませんでした）、タマゴの数と中身の画像（20 個を超えたら「ほか n 個」）、`eggs: null` の文、`farmsPartial` の文、登録の件数のリンク、**子の名前や「→」の式が出ないこと**（INV-2 の回帰。カードの textContent に `→` の子の表記がない）。
- `test/core/ideal-goals.test.js`: `eggMatches` がタマゴだけを返し（完成品は返さない）、`goalMatches` の結果は変わらない。拠点の持ち主のないタマゴを含める。中身が読めないタマゴは外す。
- `test/core/owned.test.js`: 個体の `farm`（親とタマゴ）、`eggItemId`、キーワード「配合牧場」「突然変異」。共有の往復で `eggItemId` が残り、列の足りない古い共有も受ける。
- `test/core/shared.test.js`: `OWNED_FIELDS` の幅の検証（`validateOwnedUpload:61-62`）が新しい列のあり・なしの両方を受ける。
- `test/gas/owned.test.js`: 列のないシート（setup 前）に書かずに読み、setup 後に書く（今の `skillIds` と同じ形のテスト）。
- `test/static/extract-skills.test.js`: `EGG_NAMES` の取り出し（既存の作りに合わせて）。
- 期待値が変わる既存のテスト: `test/web/owned-view.test.js:70`（タマゴの行の「孵化前」。owned-rows で「—」に変わった後、名前の表があればタマゴの名前）、所持パルの画面の要素の並びを数えるテスト（帯が増える）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 出すのはセーブの実物（親・タマゴの中身）と登録済みの配合の件数だけ。**牧場の親から配合表で子を求めて出さない**。カードに「→ 子」を書かない。
- 互換: `eggs: null`（古い共有）・`farms: null`（牧場を読む前の版）・`eggItemId` の列のない共有で、表示を「情報なし」にして壊れない。
- セキュリティ: プレイヤー名・ニックネームは `textContent`。
- 性能: 帯は閉じている間はカードを作らない（開いたときに作る）。所持パルの 2,000 行の予算に影響しないこと（帯は一覧の外）。

### release-notes の案
- id: `YYYY-MM-DD-farm-board`
- title: 「配合牧場の一覧」（7 字）
- body: 「所持パルの上に全部の牧場の親・タマゴ・預けた人を出します。孵化で完成するタマゴも示します。」（45 字）

### 完了の条件
- [ ] `npm test` が通る。
- [ ] モック（inject.js の配合牧場 3 か所・牧場の上のタマゴ）で、所持パルの帯に 3 か所のカードが出て、タマゴの中身の画像と状態のチップが正しい。閉じた状態がタブを替えても残る。
- [ ] 所持パルのキーワード「配合牧場」で牧場の親とタマゴに絞れる。
- [ ] 理想個体で、条件を満たすタマゴがあるときだけ「孵化させると完成」の 1 行が出て、押すと所持パルのタマゴの絞り込みに着く。
- [ ] GAS の反映（`npm run gas:push` と `setup()`）の手順をユーザーに伝える。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — カードに「→ 子」を書かず、タマゴの中身を「A×B→C」の式で出さない。互換 — `eggs: null`・`farms: null`・`eggItemId` の列のない共有で「情報なし」と出て壊れない。セキュリティ — 名前は textContent（`test/static/security.test.js`）。性能 — 帯は閉じている間カードを作らず、所持パル 2,000 行の予算を守る。

### TODO
- [ ] 個体に `farm`（親・タマゴ）を足し、キーワードの status に「配合牧場」「突然変異」
- [ ] `eggItemId` を正規化と共有の列（`OWNED_ADDED_FIELDS`）に足し、build:gas
- [ ] `scripts/extract-skills.mjs` で `EGG_NAMES` を取り出し、SOURCES.md に 1 行
- [ ] 行のバッジ（配合牧場・突然変異・タマゴの名前）
- [ ] `web/js/ui/farm-board.js`（カード・状態のチップ・タマゴの画像・登録の件数のリンク・一部だけの文）
- [ ] 所持パルの帯（既定は閉じる・viewState・「右に開く」）とドロワーの入口
- [ ] `eggMatches` と、理想個体の「孵化させると完成」・目標の行の添え書き
- [ ] N-08 の上限をユーザーに確かめてもらい、確かめた後にだけチップを出す
- [ ] テスト（farm-board・ideal-goals・owned・shared・gas・extract-skills）
- [ ] OPERATIONS.md・SAVE_FORMAT.md・release-notes と、`gas:push`・`setup()` の依頼

---

## route-progress: 継承ルートの進み具合と横断の導線

### 目的
継承ルートを「表示するだけ」から「今どこまで進んでいるかが分かる計画」にする。全部のパッシブを持つ個体がいなくても止まらずに次の手を出し、継承ルート・理想個体・配合を探すの間を条件を選び直さずに行き来できるようにする。

### 経緯
- **R-30**: 複数のパッシブを「すべて持つ個体」がいないとき、パッシブごとの経路を出し、理想個体で合わせる導線。判断: すべて持つ個体がいないときだけ、パッシブごとに `ownedRouteStarts` を 1 回ずつ呼んで「X を運ぶ: 最短 N 回（開始 ○○）／運べない」の行を並べ、各行はそのパッシブ 1 個の継承ルートの URL へ。その下に「理想個体で合わせる」。その場で広げる表示はやめる。**別プランの F031（不足パッシブの一括渡し）は検証で却下**（継承ルートの `p` は「選んだパッシブを全部持つ 1 個体」の条件なので、1 個ずつのリンクが正しい）。
- **R-32**: 理想個体で足りないパッシブを押すと継承ルートの要約をパネルで → 判断: パネルは作らず、リンクの文言に `ownedRouteStarts` の結果を添える（「伝説を運ぶ経路（最短 2 回・開始アヌビス）」「伝説: 所持パルから運べません」）。運べないときはリンクをやめて文字だけ。
- **R-33**: 牧場に置いた親・タマゴの情報を経路の各段に重ねる → 判断: 「牧場に配置中（拠点名）」と「タマゴあり」の 2 つのバッジだけ。進み具合の推定（何段目まで進んだか）は出さない。牧場のデータは共有にも入っている（参加者でも使える）。
- **R-34**: 経路を「追う」と保存してベルで知らせる → 判断: 保存と通知は後回し。経路を表示するたびに、各段の子の種族を選んだパッシブつきで所持していれば ✓、最初の ✓ のない段を強調する。判定は種族とパッシブだけ。
- **I-58**（R-31 を吸収）: 継承ルートと理想個体で目標とパッシブを写し合い、行き来できるようにする → 判断: 見えない自動の写し合いはやめ、明示のリンクだけ。継承ルートの見出しの近くに「理想個体でこの目標を見る」、理想個体では欲しいパッシブが 2 個以上で足りないものがないときに「継承ルートで運ぶ」。
- **F032**: 相手親の所持数を押せるチップにし、ドロワーで個体を見る（D3）。h3 の右に「相手親 未所持 1/2 段」。
- **F015**: 逆引き（統合後は配合を探すの「子」の検索）の各親に「▸ この親の配合 n 件」の展開（2 段まで・同じ種族の繰り返しは止める・展開の状態は viewState）。
- **Codex 1 回目 6**: 「タマゴあり」のデータは farm-data の後でないと持てない → farm-data を先にした。

### 依存
- route-cleanup（開始候補のチップへの一本化・経路を所持個体の欄より上へ・「パッシブを持つ所持パルから始める」の箱をなくす）、farm-data（牧場とタマゴ）、drawer（相手親の個体）、find-merge（F015 の展開先と `#/search` の URL）、owned-overlay（相手親の ♂♀ 数）。

### このテーマでやらないこと
- 経路の保存・追跡・ベルの通知（R-34 の判断）、進み具合の段の推定（R-33 の判断）。
- 不足パッシブを一括で渡す 1 つのボタン（F031 は却下）。
- 継承ルートの中で確率を計算すること（INV-2 の例外 (b) は理想個体だけ）。
- 経由・回避・必須の条件、2 本目以降の経路の折りたたみ（見送った案。437536b・98b7962）。
- 手術台の近道（implants の X-24 で 1 行の案内を足す）。

### 現状
- 開始の候補は選んだパッシブを**すべて**持つ個体だけ（`hasPassives` は every。`web/js/core/owned.js:213-215`、`ownedRouteStarts` は `:428-443`）。2 個以上選ぶと「選んだパッシブをすべて持つ所持パルはいません。」で止まりやすい（`web/js/views/route.js:140-145`。route-cleanup で箱はなくなるが、空のときの文は残る）。
- 相手親の注記は押せない `span`（`web/js/views/route.js:164-175` の `annotateFor`。「相手親の X: 所持 n 体（うちパッシブ一致 m 体）」）。経路の描画は `web/js/ui/route-view.js:5-48`（段ごとに `annotate(step, option)` を呼ぶ。`:11`）。
- 継承ルートから理想個体へのリンクはない（`buildHash('ideal'` は `views/ideal.js` と `ideals.js` だけ）。理想個体から継承ルートへは、足りないパッシブ 1 個ずつの「〇〇を運ぶ経路」だけ（`web/js/views/ideal.js:387-395`。文言は `:391`「…配合では作れません。…足りないパッシブは別に手に入れてください。」、リンクは `:393`）。
- 継承ルートの URL は `to`・`from`・`p`（`web/js/views/route.js:43-45`）、理想個体は `to`・`p`（`web/js/views/ideal.js:178-179`）で同じ形。
- 継承ルートは牧場もタマゴも使っていない。所持パルの更新では `owned.state.data` が変わったときだけ描き直す（`web/js/views/route.js:204-209`）。
- 「目標の逆引きを見る」は `#/reverse?c=`（`web/js/views/route.js:196`。find-merge で移る）。
- テスト: `test/web/owned-view.test.js:246-267`（継承ルート: 相手親の所持数の文 `'相手親のツッパニャン: 所持 2 体（うちパッシブ一致 0 体）'`）、`test/web/ideal-view.test.js:153-161`（「伝説を運ぶ経路」と「足りないパッシブは別に手に入れてください」）、`test/web/route-view.test.js`。

### 実装の手順
1. **パッシブごとの経路（R-30）**（`web/js/views/route.js`）: `to` があり、パッシブが 2 個以上で、`ownedRouteStarts` の結果が空で、すべて持つ個体も 0 体のとき、空の文の下に「1 つずつなら運べます」の小見出しと、パッシブごとの行を出す:
   - 各パッシブ `id` について `ownedRouteStarts({ graph, pals, to, passives: [id], shortestRoute })` を呼び、先頭の候補で「〈パッシブ名〉を運ぶ: 最短 N 回（開始 〈パル名〉）」→ `buildHash('route', { to, p: id })` のリンク。目標そのものを持っていれば「〈パッシブ名〉: 目標のパルが持っています」。候補がなければ「〈パッシブ名〉: 所持パルから運べません」（リンクなし）。
   - その下に「理想個体で合わせる →」（`buildHash('ideal', { to, p: passives.join(',') })`）。
   - 計算はデータか条件が変わったときだけ（`update(state)` の中で、render-contract の署名が変わったとき）。BFS はパッシブの数（最大 4）倍。
2. **理想個体の足りないパッシブの文言（R-32）**（`web/js/views/ideal.js` の `renderMissing`、`:387-395`）: 足りないパッシブごとに `ownedRouteStarts`（目標・そのパッシブ 1 個）を呼び、
   - 候補があれば「〈名前〉を運ぶ経路（最短 N 回・開始 〈パル名〉）」のリンク（文言の先頭は今の「〈名前〉を運ぶ経路」のまま。`test/web/ideal-view.test.js:157` の正規表現が当たる）。
   - なければリンクをやめて「〈名前〉: 所持パルから運べません」の文字だけ。
   - 警告の文は「欲しいパッシブのうち、〈名前〉を持つ個体が親の候補にいないため、配合だけでは作れません。」に直す（「別に手に入れてください」は implants で手術台の案内に置き換える。ここでは文を変える場合 `test/web/ideal-view.test.js:161` を直す）。
   - `views/ideal.js` から `core/route.js`（`shortestRoute`）と `core/owned.js`（`ownedRouteStarts`）を import してよい（INV-2 の制限は `core/ideal.js` と配合表だけ）。
3. **牧場とタマゴのバッジ（R-33）**: `annotateFor`（`web/js/views/route.js:164-175`）が返す注記に、2 つのバッジを足す:
   - 「牧場に配置中（拠点 1 の牧場 A）」: `owned.farms` のうち、親 2 体の種族が `{ step.from, option.partner }`（性別は問わない）の牧場があるとき。`farms` が null なら出さない。
   - 「タマゴあり」: その段の子（`option.record.childId`）の種族で、選んだパッシブをすべて持つタマゴ（`pal.egg && hasPassives(pal, passives)`。牧場の上かどうかは問わない）があるとき。押すと所持パルを「場所＝タマゴ＋その種族＋パッシブ」で開く。
   - バッジは状態チップの共通部品。牧場とタマゴの Map は `update` で 1 回作り、段ごとに引く。
4. **段の ✓ と次の段（R-34）**: `routeView`（`web/js/ui/route-view.js:39-48`）に `progress?: (step) => boolean` を足し、`chain`（`:27-37`）で段のカードに「✓ 所持」（その段の子の種族を、選んだパッシブをすべて持つタマゴでない個体で所持）を付ける。最初の ✓ のない段に `route-step-next` のクラス（太い枠）。`views/route.js` から `progress` を渡す。所持パルの更新（`:205-209`）で描き直す。パッシブを選んでいないときは出さない。
5. **相手親のチップ（F032）**: 注記の「相手親の X: 所持 n 体（うちパッシブ一致 m 体）」を `button` のチップにし（文言は今のまま。`test/web/owned-view.test.js:267` を壊さない）、押すと `context.drawer.open({ kind: 'species', id: option.partner, params: { p: passives.join(',') } })`。未所持はチップにしない（今の `unowned` の span）。owned-overlay の ♂♀ 数があれば「所持 3（♂2♀1）」にしてよい（そのときは `:267` の期待値を直す）。
   - 経路の見出し（`route-view.js:43-44` の h3）の右に「相手親 未所持 1/2 段」（全段そろえば「相手親そろう」）。`routeView` に `summary?: (route) => string` を渡す。
6. **相手親の個体のドロワー**: 新しいファイル `web/js/ui/species-owned.js`:
   ```js
   /** 1 種族の所持個体の一覧（ドロワーの中身）。パッシブを渡すと、持っている個体を上に・一致を強調する。 */
   export function speciesOwnedPanel(context, palId, { passives = [] } = {}) // → { element, title, destroy } | null
   ```
   - 中身は `ownedRow`（`syncList`）で、タマゴは別の見出しで下に。ドロワーの中身の表に `species` を足す。行の「詳細」で個体の詳細（owned-detail）へ。
7. **継承ルート ⇄ 理想個体（I-58）**:
   - 継承ルート: `to` を選んでいるとき、見出しの近く（route-cleanup で整えた条件の行の右）に「理想個体でこの目標を見る →」（`buildHash('ideal', { to, p: passives.join(',') })`）。
   - 理想個体: 欲しいパッシブが 2 個以上で、足りないものがない（`result.missing` が空）とき、条件の行の右に「継承ルートで運ぶ →」（`buildHash('route', { to, p: passives.join(',') })`）。足りないものがあるときは手順 2 の各パッシブのリンクだけ（重ねない）。
8. **配合を探すの「▸ この親の配合 n 件」（F015）**: find-merge の結果のうち「子」で探した（`c=` がある）ときのカードで、各親のタイルの下に「▸ この親の配合 n 件」（`findByChild(state.index, 親の palId)` の件数。0 件なら出さない）。押すとカードの中に字下げして、その親が生まれる配合（式だけの短い形）を出す。**2 段まで**、同じ種族が経路にすでに出ていれば展開しない。展開の状態は `context.viewState('search').expanded`（`Set` を配列で）。
9. `docs/OPERATIONS.md` の継承ルートの節に、パッシブごとの経路・バッジ・✓・相手親のチップ・理想個体へのリンクを書く（「候補は最初から全部出す」（`docs/OPERATIONS.md:99`）は変えない）。

### 触るファイル
- 新規: `web/js/ui/species-owned.js`
- 変更: `web/js/views/route.js`、`web/js/ui/route-view.js`、`web/js/views/ideal.js`（`renderMissing`・「継承ルートで運ぶ」）、find-merge の画面（F015）、`web/js/app.js`（ドロワーの中身の表に `species`）、`web/css/app.css`、`docs/OPERATIONS.md`、`web/js/release-notes.js`

### テスト
- `test/web/route-view.test.js`: `progress` で ✓ と `route-step-next`、`summary` の「相手親 未所持 n/m 段」。
- `test/web/owned-view.test.js`（継承ルートのテスト群、`:246` 付近）: パッシブ 2 個で全部持つ個体がいないとき、パッシブごとの行とリンク（`#/route?to=&p=`）・「理想個体で合わせる」。牧場に配置中・タマゴありのバッジ（`farms: null` では出ない）。相手親のチップを押すとドロワー（`species`）。「理想個体でこの目標を見る」のリンク。
- `test/web/ideal-view.test.js:153-161`: 「伝説を運ぶ経路（最短 N 回・開始 …）」、運べないときは文字だけ、警告の文の変更、「継承ルートで運ぶ」の出る条件。
- find-merge のテスト: 「▸ この親の配合 n 件」が 0 件で出ない、2 段で止まる、同じ種族で止まる、展開の状態が viewState に残る。
- 期待値が変わる既存のテスト: `test/web/ideal-view.test.js:161`（文を変えたとき）、`test/web/owned-view.test.js:267`（♂♀ 数を足したとき）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 経路は今までどおり登録済みの配合だけ（`findRoutes`・`shortestRoute`）。F015 の展開も登録済みの記録だけ。継承ルートで確率を出さない。別々の経路を「1 本で完成する保証」のように書かない（「1 つずつなら運べます」程度）。
- 互換: `farms: null`（古いデータ）・`eggs: null`（中身を省いた共有）ではバッジを出さない。
- 性能: パッシブごとの BFS は最大 4 回。データか条件が変わったときだけ計算する（20 秒・1 分の読み直しで同じデータなら計算しない）。理想個体の `renderMissing` の BFS も同じ（理想個体の再計算の抑制 `web/js/views/ideal.js:510-515` を壊さない）。

### release-notes の案
- id: `YYYY-MM-DD-route-progress`
- title: 「継承ルートの進み具合」（10 字）
- body: 「各段に牧場に配置中・タマゴあり・所持の✓を出し、パッシブごとの経路へのリンクを足しました。」（45 字）

### 完了の条件
- [ ] `npm test` が通る。
- [ ] モックで、継承ルートで目標とパッシブ 2 個を選び、全部持つ個体がいないときにパッシブごとの行と「理想個体で合わせる」が出る。
- [ ] 経路の段に「牧場に配置中」「タマゴあり」「✓ 所持」が出て、相手親のチップでドロワーに個体が出る。
- [ ] 理想個体の足りないパッシブのリンクに「最短 N 回・開始 …」が出て、運べないものはリンクにならない。
- [ ] 継承ルート ⇄ 理想個体のリンクで、目標とパッシブを選び直さずに行き来できる。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 経路と F015 の展開は登録済みの記録だけで、継承ルートに確率を出さない。互換 — `farms: null`・`eggs: null` ではバッジを出さない。セキュリティ — `test/static/security.test.js` が通る。性能 — 20 秒・1 分の読み直しで同じデータなら経路を計算し直さない（理想個体の再計算の抑制を壊さない）。

### TODO
- [ ] 全部持つ個体がいないときのパッシブごとの経路と「理想個体で合わせる」（R-30）
- [ ] 理想個体の `renderMissing` の文言に最短の回数と開始を添え、運べないものは文字だけ（R-32）
- [ ] `annotateFor` に「牧場に配置中」「タマゴあり」（R-33）
- [ ] `routeView` に `progress`（✓ と次の段）と `summary`（相手親 未所持 n/m 段）（R-34・F032）
- [ ] 相手親の注記をチップにし、`species` のドロワー（`web/js/ui/species-owned.js`）
- [ ] 継承ルート ⇄ 理想個体の明示のリンク（I-58）
- [ ] 配合を探すの「▸ この親の配合 n 件」（2 段・同じ種族で止める・viewState）（F015）
- [ ] テスト（route-view・owned-view・ideal-view・find-merge）と期待値の更新
- [ ] OPERATIONS.md と release-notes

---

## goals-detail: 目標の一覧の詳細と、所持パルの種族のまとまり

### 目的
目標の一覧（ダイアログ）を、完成の数がいつも見え・まだ作るものが上に来て・あと何が足りないかが分かる形にし、完成した目標から所持パルの該当の個体へ 1 回で移れるようにする。あわせて、所持パルの一覧を種族ごとに束ねて畳めるようにし、要約に押せる集計チップを置く。

### 経緯
- **I-17**: 登録した理想個体の一覧を右のサイドシートへ → **一部を取り消し**（目標の一覧はサイドシートではなくダイアログ。ideal-panel の F036 で「見出し右の『目標（N）』ボタン → ダイアログの表」になり、goals-merge で「目標」の一覧になった）。残す部分: 閉じていても完成の数が見える（「目標（5 件 · 完成 2）」）、件数が増えても位置が変わらない。
- **I-21**: 検索と「未完成／完成済み」の切り替え → 判断: 検索と 3 択は入れない（実際の登録は 10 件前後）。並びを「未完成を上・完成済みは下に薄く」に変える。判断の中の「どちらが先かユーザーに確かめる」は、統合プランの判断事項 8「一覧は未完成を上に」で決着済み。
- **I-22**: 行を小さくし（64px の画像 → ほかの一覧と同じ 36px）、名前の二重表示（「ジェッドラン ジェッドラン 完全個体」）をやめ、状態を色つきのピルに。「未確認」の長い理由は title だけにせず、ピルの横に短い案内のリンクを残す。
- **I-24**: 未完成の行に目標との差 → 判断: パネルは作らない。`goalMatches` の隣に、自分の個体のうち同じ種族でタマゴでないものから近い個体を選ぶ関数を足す。決め方は「欲しいパッシブを持つ数が多い順 → 目標に足りない個体値の合計が少ない順」。行に「パッシブ 3/4 · 攻撃あと 8」（同じ種族を持っていなければ「未所持」）。進み具合を 1 つの割合にまとめない。
- **I-25**: 「完成済み」と完成の通知から所持パルの該当の個体へ → 判断: 状態の文を `#/owned?pal=&p=` のリンクに、通知は href だけを同じ所持パルの URL に（本文は変えない）。**world に場所を保存しない**（パルを動かすとすぐ古くなる）。個体値の条件を URL に足すのはやめる。注意: 完成の判定はグローバルパルボックスの個体も数える（`web/js/core/ideal-goals.js:141`）が、所持パルの既定はグローバルを出さない（`web/js/views/owned.js:78`・`web/js/core/owned.js:314`）ので、リンクだけでは完成した個体が出ないことがある → owned-toolbar の場所チップでグローバルを含める。
- **F068**（別プラン）: 所持パルを図鑑順で並べているとき、種族の見出し（アイコン・名前・「5 体 · ♂3 ♀2 · タマゴ 1 · 最高 Lv 37」）で束ねて畳む。畳みは viewState。
- **F067**（別プラン）: 所持パルの要約の 2 行目に押せる集計チップ（12 体／9 種／♂6 ♀5／タマゴ 2／所持者別／拠点別）。押すと対応する絞り込みを立てる。
- 統合プランは F067・F068 をこのテーマに入れた（「種族ごとのまとまり（所持パルの図鑑順で見出し・畳みは viewState）と集計チップ」）。中身は所持パルの画面の機能なので、owned-rows・owned-toolbar の後に作る。

### 依存
- goals-merge（目標の一覧・種族だけの目標・観測の状態 `goalsObs`）、ideal-panel（目標の一覧のダイアログ）、owned-rows（行の部品・2,000 行を超えたら見えている範囲だけ描く仕組み）、owned-toolbar（場所チップ・所持者・URL・件数の行の ♂♀ の内訳）、participant-self（`ideals.mine()` の「自分」）。

### このテーマでやらないこと
- 目標の一覧の検索・3 択の切り替え（I-21 の判断）。
- 目標の一覧をサイドシート／ドロワーにすること（取り消し済み）。
- 完成した個体の場所を目標に保存すること（I-25 の判断）。
- 手術で完成できる判定（implants の X-26。ここで作るピルの形に後から足す）。
- 孵化待ちのタマゴの判定（farm-board で入れた `eggMatches` の表示を使うだけ）。
- 所持パルの「種類ごとにまとめる」別の表示（O-50 は owned-toolbar で件数の行の内訳として入った）。

### 現状
- 統合プランの前（今の main）: 一覧は画面の一番上の `details`（`web/js/views/ideal.js:304-313`・`:355`）。開くと条件と結果が押し下がる（撮影 35 で 2 件で約 300px）。`summary` は「登録した理想個体（N 件）」だけ（`:350`）。行は完成済みを上（`:344-345`）、64px の `palTile` と登録名の `strong`（`:330`）、状態は小さな文字（`:333`、`goalStatus` は `:141-149`）。**ideal-panel・goals-merge の後はダイアログの表になる**ので、着手時はその実装を読む。
- 完成の判定 `goalMatches`（`web/js/core/ideal-goals.js:146-154`）は合う・合わないだけを返す。
- 完成の通知の href は理想個体（`web/js/ideals.js:173` の `buildHash('ideal', { to, p, g })`）。通知の id（`:169`。完成時刻を含む）は既読の判定に使う。
- 所持パルの一覧は平らに並ぶ（`web/js/views/owned.js:217-223`）。要約は「ワールド名 · N 体」と時刻（`:164-171`）。`ownedBySpecies`（`web/js/core/owned.js:353-361`）は継承ルートでしか使っていない。

### 実装の手順
1. **近い個体の関数（I-24）**: `web/js/core/ideal-goals.js` に足す:
   ```js
   /**
    * 未完成の目標に、いちばん近い自分の個体と、足りないもの。
    * 決め方: 欲しいパッシブを持つ数が多い順 → 目標に足りない個体値の合計が少ない順 → 個体 ID。種族が同じでタマゴでない個体だけ。
    * @returns {{ pal: object, passives: { have: number, total: number }, short: { hp: number, shot: number, defense: number }, extra: number } | null}
    *   short は目標までの不足（0 は届いている。目標 0＝条件なしは常に 0）。extra は「欲しいものだけ」のときの余計なパッシブの数。同じ種族がいなければ null
    */
   export function goalNearest(goal, pals)
   ```
   - 個体値の目標は保存どおり「0＝条件なし」（判断事項 10）。`short[key] = goal.targets[key] <= 0 ? 0 : Math.max(0, goal.targets[key] - pal.talent[key])`。
2. **一覧の見出しと並び（I-17・I-21）**: 目標の一覧のダイアログの見出しを「目標（5 件 · 完成 2）」に。ダイアログを開くボタン（ideal-panel の「目標（N）」）も「目標（5 · 完成 2）」。完成の数は `ideals.mine()` が `null`／`undefined`（未確認）のときは出さない。並びは「未完成（登録の新しい順）→ 完成済み（薄く・`opacity`）」。並べ替えで行がちらつかないよう、行は `syncList`（key は目標の id）。
3. **行を小さく（I-22）**: 行は 36px のアイコン（`palIcon`。`palTile` ではなく名前を出さない）＋目標の名前（1 回だけ）＋パッシブの小さいチップ＋条件の要約 1 行＋状態のピル（visual-parts の状態チップ: 「未完成」「完成済み」「未確認」）。「未確認」のピルの横に短い案内（participant-self で入れた「設定で選ぶ」ボタン、`#/settings?world=<id>&open=auto`）。
4. **未完成の行の差（I-24）**: `goalNearest` の結果で「パッシブ 3/4 · 攻撃あと 8」（不足のある能力だけ。全部届いていれば「個体値は届いています」。「欲しいものだけ」で余計なパッシブがあれば「余計なパッシブ 1」）。同じ種族がいなければ「未所持」。farm-board の孵化待ちがあれば「（孵化待ちに 1 個）」を後ろに。種族だけの目標（パッシブなし・個体値の条件なし）は、所持していれば完成なので差を出さない。
5. **完成から所持パルへ（I-25）**: 完成済みの行の状態（「完成済み: Alice · パルボックス P2 · 1-6 ほか 1 体」）をリンクにする。URL は owned-toolbar の形で「パル＝目標の種族、パッシブ＝目標のパッシブ、場所＝タマゴ以外の全部（**グローバルを含める**）」。個体値は URL に入れない（所持パルの個体値の欄で絞れる）。
   - 通知（`web/js/ideals.js:164-175`）は **href だけ**を同じ所持パルの URL に変える。id・本文・日付は変えない（既読を保つ）。goals-merge で通知の作りが変わっていれば、その実装の href だけを変える。
   - 所持パルは URL の指定で前の絞り込みを上書きする（`web/js/views/owned.js:83-89`。owned-toolbar で形が変わる）。上書きしたことは件数の行の条件チップで分かる（owned-toolbar の O-04）。
6. **所持パルの種族のまとまり（F068）**: 並べ替えが図鑑順のときだけ、種族が変わる位置に見出しの行を入れる。
   - 見出し: 24px のアイコン・名前・「5 体 · ♂3 ♀2 · タマゴ 1 · 最高 Lv 37」・畳むボタン（`aria-expanded`）。見出しの右に小さいリンク「理想個体」（`#/ideal?to=`）・「継承ルート」（`#/route?to=`）・「配合を探す」（`#/search?c=`）。
   - 行の一覧は owned-rows の `syncList` に、見出しを `key: 'species:<palId>'` の行として混ぜる（`create` は見出しの部品）。畳んだ種族の個体の行は items から外す。見出しの行は高さを固定し、owned-rows の「2,000 行を超えたら見えている範囲だけ描く」の行の高さの計算に入れる。sticky の列見出しの行とは分ける（owned-rows の決まり）。
   - 畳んだ種族は `context.viewState('owned').collapsed`（palId の配列）に持つ。「すべて開く／すべて畳む」を件数の行の右に。
   - 図鑑順以外の並べ替えでは見出しを出さない。
7. **要約の集計チップ（F067）**: 所持パルの要約の 2 行目（owned-status で入った 1 行の下）にチップを並べる: 「129 体」「22 種」「♂60 ♀58」「タマゴ 5」「Alice 40 · Bob 30 …」（所持者別。owned-toolbar の所持者の意味＝palsOfPlayers）「拠点 1 · 15 体」（拠点別）。数は**絞り込む前の全体**。押すと対応する絞り込み（所持者・場所チップ）を立てて、押した状態で表示する。絞り込んだ後の数は件数の行（owned-toolbar）の「N / 全 M 体」に任せる（重複して出さない）。集計はデータの更新時に 1 回だけ。
8. `docs/OPERATIONS.md` の理想個体の節（目標の一覧）と所持パルの節（種族のまとまり・集計チップ）を書き直す。

### 触るファイル
- 変更: `web/js/core/ideal-goals.js`（`goalNearest`）、goals-merge・ideal-panel で作った目標の一覧のダイアログのファイル（見出し・並び・行・差・リンク）、`web/js/ideals.js`（通知の href）、`web/js/views/owned.js` と owned-rows の行の一覧（種族の見出し）、owned-status の要約（集計チップ）、`web/css/app.css`、`docs/OPERATIONS.md`、`web/js/release-notes.js`

### テスト
- `test/core/ideal-goals.test.js`: `goalNearest` の選び方（パッシブの数 → 不足の合計 → ID）、目標 0 の能力は不足 0、タマゴを選ばない、同じ種族がいなければ null、「欲しいものだけ」の余計なパッシブの数。
- 目標の一覧のテスト（goals-merge で作ったテスト。`test/web/ideal-view.test.js` の目標の部分）: 見出し「目標（N 件 · 完成 M）」、未確認のとき完成の数を出さない、未完成が上、行に名前が 1 回だけ、「パッシブ 3/4 · 攻撃あと 8」、完成済みの行のリンク（グローバルを含む場所）。
- `test/web/ideals.test.js`（通知）: href が所持パルの URL で、id と本文は変わらない（既読が保たれる）。
- `test/web/owned-view.test.js`: 図鑑順で種族の見出しが出て、畳むと個体の行が消え、viewState に残る。図鑑順以外では見出しがない。集計チップを押すと絞り込みが立つ。
- 期待値が変わる既存のテスト: `test/web/ideal-view.test.js:399-409`（今の「登録した理想個体（1 件）」「最強モコロン.*完成済み: Alice · パルボックス」。ideal-panel・goals-merge で先に変わっているはずなので、その後の形から直す。別プラン §9 の C の一覧にある行）。`test/web/ideals.test.js:70`（完成の通知の href `#/ideal?to=SheepBall&p=Rare&g=id-1` を所持パルの URL に）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 所持している個体どうしを比べるだけで、配合を出さない。
- 互換: 目標の保存の形は変えない（goals-merge の決まり。`cleanGoal` は決まった項目しか残さないので、行の表示のための値を目標に足さない）。通知の id を変えない。
- 性能: `goalNearest` は目標 100 件 × 同じ種族の個体（ふつうは数体〜数十体）。目標の一覧を開いている間だけ計算する。種族の見出しは owned-rows の性能の予算（2,000 行で最初の 200 行が 100ms 以内）を守る。

### release-notes の案
- id: `YYYY-MM-DD-goals-detail`
- title: 「目標の一覧を見やすく」（10 字）
- body: 「未完成を上にし、あと何が足りないかを出します。完成した目標から所持パルの個体へ移れます。」（44 字）
- 種族のまとまりと集計チップを別に配信するなら、もう 1 件「所持パルを種族で束ねる」（11 字）・「図鑑順のとき種族の見出しで束ねて畳めます。上の数のチップを押すとその条件で絞れます。」（42 字）。

### 完了の条件
- [ ] `npm test` が通る。
- [ ] モックで目標を 3 件（1 件は完成）登録し、ダイアログの見出しに「目標（3 件 · 完成 1）」、未完成が上、未完成の行に差が出る。
- [ ] 完成済みの行と完成の通知から、所持パルの該当の個体（グローバルの個体を含む）に着く。通知の既読が変わらない。
- [ ] 所持パルの図鑑順で種族の見出しが出て、畳んだ状態がタブを替えても残る。2,000 行の注入で性能の予算を守る。
- [ ] 集計チップを押すと所持者・場所の絞り込みが立つ。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 所持している個体どうしを比べるだけで、配合を出さない。互換 — 目標の保存の形と通知の id を変えていない（行の表示の値を目標に足さない）。セキュリティ — `test/static/security.test.js` が通る。性能 — 上の 2,000 行の確認。

### TODO
- [ ] `goalNearest(goal, pals)` を `core/ideal-goals.js` に足す
- [ ] 目標の一覧の見出し・開くボタンに完成の数（未確認なら出さない）
- [ ] 並びを未完成が上・完成済みは薄く（`syncList`）
- [ ] 行を 36px・名前 1 回・状態のピル・未確認の案内に
- [ ] 未完成の行に「パッシブ 3/4 · 攻撃あと 8」・未所持・孵化待ち
- [ ] 完成済みの行と通知の href を所持パルの URL（グローバルを含む）に
- [ ] 所持パルの図鑑順の種族の見出し（畳み・viewState・行の高さの計算）
- [ ] 要約の集計チップ（押すと絞り込み）
- [ ] テスト（ideal-goals・目標の一覧・ideals・owned-view）と期待値の更新
- [ ] OPERATIONS.md と release-notes

---

# フェーズ 4: セーブ情報・ゲーム素材・新機能

> どのテーマも、**先に実際のセーブ（`npm run check:save`。読み取りのみで拡張する）とゲーム本体で確かめてから作る**。項目がない・形式が違うときは、その案を止めてユーザーに報告する（統合プランの「リスクと前提」）。ゲーム本体の場所は、取り出しのスクリプトの引数か環境変数 `PALWORLD_DIR`（既定は `C:\Program Files (x86)\Steam\steamapps\common\Palworld`。調査では `G:/SteamLibrary/steamapps/common/Palworld` を使った）。

## game-assets: ゲームの UI アイコンと作業適性を取り込む

### 目的
文字や色で代用している記号（属性・作業適性・タマゴ・ケーキ・配合牧場・性別）を、ゲーム本体から取り出した実物のアイコンにそろえる。取り出しの道具に「pak の中の一覧」と「表示の 2 倍への縮小」を足し、取り出す前に実在と形式を確かめられるようにする。作業適性はマスターに取り込み、パル詳細とキーワードで使う。

### 経緯
- **X-17**: 取り出しに足りないもの（名前での一覧・DXT 以外の形式・縮小・容量の上限）→ 判断: 第 1 段は `--list` だけ。`openPak` に一覧を足して、テクスチャ名の実在と形式（DXT かどうか）を確かめる。DXT なら今の部品で取り出し、2 倍に縮める処理（ボックス縮小・数十行）だけ足す。BC7 と B8G8R8A8 の復号は、一覧で DXT 以外と分かったときだけ。容量の上限は SOURCES.md に 1 行。
- **V-01**（C-22 を吸収）: UI アイコンの取り出しと画像の扱いの方針 → 判断: 第 1 段は属性 9 種。BC7 などの未対応の形式ならそこで止め、SVG で代用するかをユーザーに聞く。性別・★・作業適性・タマゴは使う画面の案が採用されてから個別に。SOURCES.md に例外の 1 項目と「実物と自作の使い分け」の短い表。
- **V-02**: 属性をゲームの丸い属性アイコンで（パル詳細・パル選択の候補・所持パル・ウィッシュリスト → 目標）。`palTile` にオプトインの `{ elements }` を足すので、配合カードなど既存の表示とテストを壊さない。読めないときは文字チップに戻す（`humanIcon` と同じ形）。
- **O-61**（N-01・N-02・V-11 を吸収）・**N-03**: 作業適性 → 判断: 段 1 は `import-pals.mjs` で palworld-helper の CSV から作業適性と Lv を取り込み、`pals.js` に `work` を足す（同じ表にある配合の値 CombiRank は取り込まない。テストで確かめる）。パル詳細のヒーローに出し、所持パルのキーワードで「採掘」「採掘3」が当たるようにする。**所持パルの行とパル選択の候補には常に出さない**（行が詰まる）。凝縮での補正・並べ替え・専用の select はやらない。段 2 でアイコン。
- **X-25**: 未所持の親に入手先のタグ → 判断: 段階 1 だけ。PalCalc の db.json（固定 SHA）から野生の Lv（`MinWildLevel`・`MaxWildLevel`）を取り、継承ルートの「未所持」と理想個体の「所持していません」に「野生 Lv12–18」のチップ。**項目が db.json にあるかは未確認**。アルファ・商人・釣り・エリア名は個別の案にし直す。地図の画像は使わない（CSP と形式）。
- **I-42**: ケーキの選択肢にアイコン → 判断: I-41（ケーキを押しボタンに。ideal-panel）の後。形式が DXT のときだけ。牧場の建築物のアイコンはやめる → ただし統合プランの game-assets の行では「卵・ケーキ・牧場のアイコン」と牧場も入れている（F083 で `T_icon_buildObject_BreedFarm` の実在を確認済み）ので、牧場のアイコンは farm-board の見出しと「配合牧場」のバッジに使う。
- **F083**（別プラン。pak の索引で実在を確認済み）: 属性 `T_Icon_element_s_00..08`、作業適性 `T_icon_palwork_*`、ラッキー `T_icon_pal_rare`、濃縮 `T_icon_condense`、卵 `T_itemicon_Material_PalEgg_*`、ケーキ `T_itemicon_Food_Cake*`、牧場 `T_icon_buildObject_BreedFarm`。性別は Main_Menu の `T_Icon_PanGender_*` が B8G8R8A8 で未対応だが、**OperatingTable の `T_icon_Operating_Gender_*` は DXT5 で今の `readTexture` で取れる**。★とアルファ専用の印はない。F076 は属性 `T_Icon_element_00〜08`（48×48 DXT5）と書いており、`_s_` の有無は一覧で確かめる。
- **F076**: 属性をゲーム実物にし、パルのタイル・パル選択に常設し、属性で絞る（パル選択の属性の絞り込みは popovers で S-17 として検索に入っている）。
- **F044**: 確率・ケーキ・突然変異タマゴにゲーム素材のアイコン。統合プランではケーキのアイコンと突然変異タマゴの印まで。確率の桁を卵のアイコンの数で示す案は任意（下の手順 8）。突然変異率の出典は未確認なので出さない。
- 判断事項 5: **ゲームから取り出す画像の範囲は属性 9 種から順に（作業適性・卵・ケーキ・牧場・性別まで）。Codex の画像生成は配信物に使わない**。レールとロゴは自作 SVG（visual-parts）。

### 依存
- visual-parts（`genderMark()`・`ui/icons.js`・状態チップ・画像の作り方の表を SOURCES.md へ）。表示先として pal-detail（ヒーロー）・popovers（パル選択の候補）・owned-rows（行）・ideal-panel（ケーキの押しボタン）・farm-board（タマゴ・牧場）・goals-merge（目標の行）が先にあると効果が出る。

### このテーマでやらないこと
- 生成画像（Codex の画像生成）を配信物に使うこと（判断事項 5）。パル画像の取り出し直し（全 298 体あり）。
- ★とアルファの印（pak にない。visual-parts の自作 SVG のまま）。ラッキー・アルファの角の印（V-05 は後回し）。
- 作業適性の並べ替え・専用の select・凝縮での補正・所持パルの行への常時表示（O-61・N-03 の判断）。
- 入手先のうちアルファ・パル商人・釣り・エリア名（X-25 の判断）。
- BC7 の復号（一覧で必要と分かったら、そこで止めてユーザーに聞く）。

### 現状
- 取り出し: `scripts/extract-passive-icons.mjs`。`TEXTURE_DIR` は Main_Menu に固定（`:12`）、`PASSIVE_TEXTURES` の表（`:14-22`）、`openPak`（`:50`）は `{ get, has, close }` だけを返す（`:112`。パスの一覧 `paths` は内部の変数、`:72-80`）。`readTexture`（`:161-176`）は `PF_DXT1`・`PF_DXT5` だけで、それ以外は「未対応のテクスチャ形式」で止まる（`:167`）。`encodePng`（`:198`）は等倍。`scripts/extract-humans.mjs:11` が同じ部品を import して使っている。
- コミット済みの画像は `web/img/passive/`（7 枚）と `web/img/humans/`（154 枚・128px・合計 2.1MB。表示は 64px）だけ。パル画像（`web/img/pals/`）は配信時に取得してコミットしない（`data/SOURCES.md:65-70`）。
- 属性: パル詳細のヒーローにだけ文字チップ（`web/js/ui/pal-icon.js:60-64` の `elementChips`、呼ぶのは `web/js/views/pal.js:17` だけ）。パル選択の候補（`web/js/ui/pal-picker.js:134`）・所持パルの行（`web/js/views/owned.js:26`）は `palTile` だけで属性が出ない。属性の色は `.element-X`（`web/css/app.css:502-510`）。属性の表 `ELEMENTS`（`web/data/pals.js:2`）は Neutral・Fire・Water・Grass・Electric・Ice・Ground・Dark・Dragon の 9 種。
- 作業適性: マスターにない（`scripts/import-pals.mjs:8-9` の `CSV_COLUMNS`・`JS_FIELDS`）。属性は palworld-helper の `data/pals_work_suitability.csv`（`scripts/sources.mjs:12-17`。固定 SHA）の `Elements` 列から取っている（`scripts/import-pals.mjs:59-60`）。マスターの項目は許可リストでテストしている（`test/import.test.js:11-18`）。
- 性別は ♂♀ の文字（`web/js/ui/pal-icon.js:73`、`web/js/views/owned.js:35`。visual-parts で `genderMark()` に一本化）。ケーキは理想個体の select（`web/js/views/ideal.js:259`。ideal-panel で押しボタンに）。タマゴは文字のバッジ（`web/js/views/owned.js:43`）。
- CSP: `web/index.html:6`（画像は `'self'` と `data:`）。

### 実装の手順
1. **pak の一覧（X-17）**: `scripts/extract-passive-icons.mjs` の `openPak` の返り値に `list(prefix = '')`（`paths` のキーのうち `prefix` で始まるもの）を足す（`get`・`has`・`close` は変えない。`extract-humans.mjs` を壊さない）。
2. **新しいスクリプト `scripts/extract-ui-icons.mjs`**（`extract-humans.mjs` と同じく部品を import。パッシブのスクリプトは変えずに済む）:
   - `npm run extract:ui-icons -- "<Palworld のインストール先>" [--list <接頭辞>]`（`package.json` の scripts に足す）。
   - `--list`: 一覧のパス・`readTexture` で読めた幅と高さ・`PF_` の形式を出して終わる（書き出さない）。まず `--list Pal/Content/Pal/Texture/UI/` で、F083 の名前（`T_Icon_element_s_00..08`・`T_icon_palwork_*`・`T_itemicon_Material_PalEgg_*`・`T_itemicon_Food_Cake*`・`T_icon_buildObject_BreedFarm`・`T_icon_Operating_Gender_*`）の実在と形式を確かめ、結果を SOURCES.md の下書きに写す。
   - 書き出しの表 `UI_ICONS = { 'element/Fire': { path: '…/T_Icon_element_s_01', size: 32 }, … }`（出力名 → pak のパスと書き出す大きさ）。**属性の番号と属性の対応はゲームの画面で確かめて固定する**（推測で並べない。確かめた日をコメントに）。
   - 縮小: `downscale(rgba, width, height, size)`（ボックス縮小。表示の 2 倍の大きさに）。属性・作業適性は表示 16px → 32px、卵は 20px → 40px、ケーキは 24px → 48px、牧場は 20px → 40px、性別は 14px → 28px。
   - 形式: DXT1・DXT5 は今の `readTexture`。`PF_B8G8R8A8` は並びを入れ替えるだけなので `readTexture` に足してよい（性別を Main_Menu から取る必要が出たときだけ）。**BC7 など、それ以外が出たらそこで止めてユーザーに聞く**（SVG で代用するか）。
   - 出力: `web/img/element/<Element>.png`（9 枚）、`web/img/work/<作業の鍵>.png`、`web/img/item/egg-<属性>.png`・`egg-mutant.png`（突然変異のタマゴがあれば）・`cake-<種類>.png`、`web/img/ui/breed-farm.png`・`gender-M.png`・`gender-F.png`。
3. **SOURCES.md**（`data/SOURCES.md` の「画像の扱い」）: 例外の 1 項目（取り出すテクスチャの名前の表・v1.0.5 で確かめた日・`npm run extract:ui-icons` で取り出す・撤回は `web/img/{element,work,item,ui}/` を消せば文字の表示に戻る）と、「実物と自作の使い分け」の短い表（C-22: ゲームの情報を示す部品＝実物、アプリの枠＝自作 SVG、生成画像は配信物に使わない）。合計の容量の上限（例: 新しく足す画像は合計 200KB まで）を 1 行。
4. **属性のアイコン（V-02・F076）**: `web/js/ui/pal-icon.js`:
   - `elementIcon(element, { size = 16 } = {})`: `img`（`alt` は「炎属性」など、`width`・`height` を指定、`loading = 'lazy'`）。読めなければ今の文字チップ（`element-chip element-<X>`）に差し替える（`error` で 1 回だけ。`humanIcon` と同じ形）。
   - `elementChips(pal)` をアイコン＋名前にする。
   - `palTile(id, { elements: true })` のオプトインで、名前の行の右に 14〜16px のアイコン（2 属性なら 2 つ）。既定は false（配合カードなど既存の表示とテストを変えない）。
   - 使う所: パル詳細のヒーロー、パル選択の候補の行（popovers の候補の部品に `elements: true`）、所持パルの行の種族のセル（owned-rows）、目標の一覧の行（goals-detail）、ホバーの解説の板（pal-detail の F059）。
5. **作業適性（O-61・N-03）**:
   - `scripts/import-pals.mjs`: `pals_work_suitability.csv` の作業適性の列（**列名は取り込み元の CSV を開いて確かめる**。火おこし・水やり・種まき・発電・手作業・採集・伐採・採掘・製薬・冷却・運搬・牧場 などの 12〜13 列が見込み）を読み、`work: { 鍵: Lv }`（Lv 1 以上だけ）にする。`CSV_COLUMNS` に `work`（`kindling:2|mining:3` のような 1 列）、`JS_FIELDS` に `work` を足す。**CombiRank など配合の値は読まない**（`test/import.test.js:20-24` の検査はそのまま通ること。読む列を許可リストで限る）。
   - `data/SOURCES.md` の表（`:9`）の「属性」の行を「属性・作業適性」にし、「取り込まないもの」（`:23-26`）に CombiRank を明記する。
   - 作業の名前は日本語の表（`WORK_LABELS = { kindling: '火おこし', … }`）を `web/data/pals.js` の生成に含めるか、`web/js/core/` に置く（ゲーム内の表記に合わせる。ゲーム本体の名前の表から取れるなら取り出す）。
   - パル詳細のヒーロー（pal-detail）に「作業適性: [アイコン] 採掘 3 · [アイコン] 運搬 2」（アイコンがなければ文字だけ）。
   - 所持パルのキーワード（`web/js/core/owned.js:221-239` の `keywordFields`）に作業の名前を足す。「採掘3」のように名前の直後に数字があれば「Lv 3 以上」として解釈する（`keywordTerms` の後で、語が `^(作業の名前)(\d)$` に合えば、その作業の Lv で比べる。合わなければ今の部分一致）。一致の理由（`keywordNotes`）に「作業適性：採掘 Lv3」。
   - `speciesInfo`（`:92-97`）に `work` を足す（共有の個体も種族から引くので列は要らない）。
6. **卵・ケーキ・牧場・性別のアイコン（I-42・O-47 段 B・F044）**:
   - タマゴの行（owned-rows）: 種族の画像の右下に、属性別のタマゴのアイコン（20px）を重ねる。アイテム ID（farm-board の `eggItemId`）から `PalEgg_<属性>_NN` の属性を読み、突然変異（`PalEgg_MutationPal_*`）は突然変異のアイコンか枠。分からなければ今の文字のバッジ。
   - ケーキの押しボタン（ideal-panel の I-41）: 各ボタンの左にケーキのアイコン（24px）。名前の文字は残す。
   - 配合牧場: farm-board の帯の見出しと、行の「配合牧場」のバッジに牧場のアイコン。
   - 性別: `genderMark()`（visual-parts）を、`img` かマスク（`mask-image: url(...)`。CSS の中の固定の URL なので CSP に触れない）でゲームの記号にする。**`textContent` の ♂♀ は残す**（読み上げとテストのため。見た目だけ隠す）。
7. **野生の Lv（X-25。確かめてから）**: `scripts/import-pals.mjs` の取り込み元 db.json（固定 SHA）に `MinWildLevel`・`MaxWildLevel` があるかを先に確かめる。あれば `web/data/pal-sources.js`（`export default { palId: [min, max] }`。野生にいない種は入れない）に書き出し、継承ルートの「相手親の X: 未所持」の後ろと、理想個体の「所持していません」の下に「野生 Lv12–18」（なければ「野生にいない」）の小さなチップ。配合の値は入れない。SOURCES.md に出典。項目がなければこの手順はやめて報告する。
8. **確率の桁を卵の数で（F044。任意）**: 理想個体の組の「平均 約 N 個」の横に、対数で 1〜5 個の卵のアイコン（`title` に平均の値）。ユーザーが要ると言ったときだけ。
9. `docs/OPERATIONS.md` の「表示と画像」の節に、取り出しの手順（`npm run extract:ui-icons -- --list …` → 書き出し）と、作業適性のキーワード（「採掘3」）を書く。

### 触るファイル
- 新規: `scripts/extract-ui-icons.mjs`、`web/img/element/*.png`・`web/img/work/*.png`・`web/img/item/*.png`・`web/img/ui/*.png`、（X-25 をするなら）`web/data/pal-sources.js`
- 変更: `scripts/extract-passive-icons.mjs`（`openPak` に `list`。必要なら `readTexture` に B8G8R8A8）、`package.json`（`extract:ui-icons`）、`scripts/import-pals.mjs`・`data/pals.csv`・`web/data/pals.js`・`gas/PalMaster.js`（`npm run build:pals` で生成）、`web/js/ui/pal-icon.js`、popovers の候補の部品、owned-rows の行、goals-detail の行、ideal-panel のケーキのボタン、farm-board、visual-parts の `genderMark()`、`web/js/core/owned.js`（キーワード・`speciesInfo`）、`web/css/app.css`、`data/SOURCES.md`、`docs/OPERATIONS.md`、`web/js/release-notes.js`

### テスト
- `test/import.test.js`: `JS_FIELDS` に `work` が入っても、許可リストの検査（`:11-18`）と配合データを含めない検査（`:20-24`）が通る。`work` の値が作業の鍵と 1〜5 の整数だけ（CombiRank などが混じらない）ことを足す。
- `test/web/breeding-card.test.js`: `palTile` の既定（`elements` なし）で属性のアイコンが出ない（既存の `.pal-tile` の数の検査 `:46`・`:55`・`:70` が変わらない）。
- `test/web/pal-detail.test.js`: 属性のアイコンが読めないとき文字チップに戻る（`error` を起こす）。作業適性の行。
- `test/core/owned.test.js`: キーワード「採掘」「採掘3」（Lv 3 以上だけ）と一致の理由。
- `test/static/security.test.js`: 変わらず通る（`img` の `src` は `new URL(..., import.meta.url)`、マスクは CSS の固定 URL）。
- スクリプトの単体テスト（任意）: `downscale` の大きさ・`list` の接頭辞。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 作業適性と野生の Lv は配合ではない。**同じ取り込み元の表にある配合の値（CombiRank など）は取り込まない**（許可リストとテスト）。入手先から「これを配合すれば作れる」とは出さない。
- セキュリティ・CSP: 画像はビルド時に取り出して `web/img/` に置く（`img-src 'self'`）。外部の画像・地図は使わない。SVG を文字列で流し込まない。
- 権利: ゲーム画像のコミットは SOURCES.md の例外として書き、撤回の手順を添える（パッシブ・人間のアイコンと同じ扱い）。
- 互換: 画像が読めない環境（撤回後・取り出し前）では文字の表示に戻る。
- 性能: アイコンは `loading = 'lazy'` と `width`・`height` の指定で配置を揺らさない。所持パル 2,000 行で、行ごとの `img` が増える分を測る（予算を超えたら行の属性アイコンは出さず、パル詳細と候補だけにする）。

### release-notes の案
- id: `YYYY-MM-DD-game-icons`
- title: 「属性をゲームのアイコンで」（12 字）
- body: 「パル詳細・パル選択・所持パルの属性をゲームと同じアイコンで出し、作業適性も出します。」（42 字）
- 取り出しだけ（`--list`・縮小）の変更は開発の道具なので通知は要らない（X-17 の判断）。

### 完了の条件
- [ ] `npm run extract:ui-icons -- "<インストール先>" --list Pal/Content/Pal/Texture/UI/` で、F083 の名前の実在と形式を確かめ、結果を SOURCES.md に書いた（DXT 以外があれば止めてユーザーに報告した）。
- [ ] 属性の番号と属性の対応をゲームの画面で確かめて表に固定した。
- [ ] `npm test` が通る（マスターの許可リストの検査を含む）。
- [ ] モックで、パル詳細・パル選択の候補・所持パルの行・目標の行に属性のアイコンが出て、画像を消すと文字チップに戻る。
- [ ] 所持パルのキーワード「採掘3」で、採掘 Lv3 以上の種族だけに絞れる。
- [ ] 新しく足した画像の合計が SOURCES.md に書いた上限以下。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 取り込み元の表にある配合の値（CombiRank など）を取り込んでいない（許可リストのテスト）。セキュリティ — 画像はビルド時に `web/img/` へ置き、外部の画像を使わず CSP を変えていない（`test/static/security.test.js`）。互換 — 画像がないときは文字の表示に戻る。性能 — 所持パル 2,000 行でアイコンを足しても予算内（超えたら行には出さず、パル詳細と候補だけにした）。

### TODO
- [ ] `openPak` に `list(prefix)` を足す
- [ ] `scripts/extract-ui-icons.mjs`（`--list`・`UI_ICONS` の表・縮小・形式の確認）と npm の scripts
- [ ] `--list` で実在と形式を確かめ、属性の番号の対応をゲームの画面で確かめる
- [ ] アイコンを書き出して `web/img/` に置き、SOURCES.md に例外・使い分けの表・容量の上限・撤回の手順
- [ ] `elementIcon`・`elementChips`・`palTile({ elements })` と、表示先（パル詳細・候補・行・目標）
- [ ] `import-pals.mjs` で作業適性を取り込み（許可リスト・CombiRank を読まない）、build:pals
- [ ] パル詳細の作業適性の行と、キーワード「採掘」「採掘3」
- [ ] タマゴ・ケーキ・牧場・性別のアイコン（文字は残す）
- [ ] X-25: db.json に野生の Lv があるか確かめ、あれば `pal-sources.js` とチップ
- [ ] テスト（import・breeding-card・pal-detail・owned）
- [ ] OPERATIONS.md と release-notes

---

## save-extras: セーブから読める追加の情報（入手時刻・お気に入り・接続中の仲間・Day・ケーキの残りほか）

### 目的
セーブに入っているのに読み飛ばしている情報を取り込む。孵化した子を見つけやすくし（新しく入った順・NEW）、ゲームで付けたお気に入りを使い、「いま誰がプレイ中か・ゲーム内の何日目か」をヘッダーで分かるようにし、牧場のケーキ切れに気づけるようにする。どれも**先に実際のセーブで項目を確かめてから**足す。

### 経緯
- **O-26**・**F053**: 前回から増えた個体に NEW と「新しく入った順」。O-26 の判断: まず `npm run check:save` で `OwnedTime` が実セーブにあるかを確かめる。あれば `PAL_FIELDS` に足して入手の新しい順に並べ、NEW は「ワールドごとに最後に所持パルを開いた時刻より後に入手した個体」（端末に保存するのは時刻 1 つだけ）。初めて開いたときは NEW を付けない。光る動きは付けない。F053 は IndexedDB に `firstSeen`（初めて見た時刻）を持つ案。統合プランで「入手時刻（OwnedTime。なければ IndexedDB の firstSeen）」に決めた。
- **O-57**: ゲーム内のお気に入り（`IsFavoritePal`）→ 判断: 実セーブにあれば `PAL_FIELDS` に足し、行の名前の横にハートの SVG、キーワード「お気に入り」。共有は `OWNED_ADDED_FIELDS` の末尾に 1 列（`setup()` のやり直し）。理想個体の「お気に入りは親に使わない」は入れない。既定値 false は書かれないことがあるので、ないときは false。
- **C-33**（O-64・O-65 を吸収）: 場所が「不明」になる個体を減らす → 判断: 2 段。(1) 実セーブの `unknownLocation` とその入れ物を確かめ、観賞用ケージ（`MapObjectId` が `DisplayCharacter`）が原因なら CharacterContainer の入れ物 ID を拾って「観賞用ケージ」の場所を足す。(2) 孵化器で孵化したまま取り出していない個体は、実セーブで孵化器に残った例を用意できたときだけ。
- **N-09**（G-15・O-63 を吸収）・**F051**: 牧場のケーキの残り → 判断: 範囲を「牧場ごとのケーキの種類と残り」だけ。まず実セーブで BreedFarm の ModuleMap に ItemContainer があるか確かめ、無ければやめる。理想個体の牧場の欄に「スペシャルケーキ ×7」「ケーキ切れ」。余力があれば、目標の組を置いている牧場の実際のケーキを理想個体のケーキの選択の既定にする。ヘッダーの在庫・所持品／保管庫の合計は入れない。統合プランの共有範囲で「ホストだけ」。
- **F006**: 接続中の仲間・最終ログイン・Day・Lv。ギルドの各メンバーの `last_online_real_time`（`readGuildPlayers` が `x.i64()` で読み飛ばしている）と、`worldSaveData.GameTimeSaveData.RealDateTimeTicks`（読み取りの許可リストの外）が一致すれば、その保存の時点で接続中（2026-10-08 に実機で確認。差 0 秒。接続していない人は数百秒以上ずれる。メモリ `palworld-invite-code-and-presence.md`）。`Players/*.sav` の更新時刻と `LastOnlineDateTime` は判定に使えない（保存のたびに全員分が書き直される）。統合プランで「ヘッダーの状態のポップオーバーに。参加者にも出すなら共有の列と GAS の再デプロイ」。
- **F070**: 魂の強化（Rank_HP など）・病気・空腹・SAN・作業適性（CraftSpeeds）。項目名は編集ツールの知識で未検証 → 構造を確かめてから。作業適性のマスターへの取り込みは game-assets でした。
- **F088**: 孵化器の残り時間・WorldOption の孵化時間設定 → 調査が先。保存の場所は未確認。
- 却下・後回し: O-62 ゲーム内の日数（このテーマで一部）、「最終ログインが古い人の所持パルは古い」という見せ方（オフラインの人のパルはホストのセーブの中で変わらないので誤解を招く。[rejected.md](appendix/rejected.md)）。

### 依存
- owned-rows（行のバッジと並べ替えの列見出し）、data-boundary（新しい値の検証）、header-frame（状態のポップオーバー）、owned-detail（魂の強化などを出す場所）、farm-board（ケーキの残りを出す牧場のカード）。

### このテーマでやらないこと
- 理想個体で「お気に入りは親に使わない」の切り替え（O-57 の判断）。
- ケーキの在庫の合計・ヘッダーの在庫・所持品や保管庫のケーキ（N-09 の判断）。インプラント・パルリバーサーの在庫（implants の X-21）。
- 経路の追跡や通知（route-progress の判断）。捕獲数（paldex）。
- 確かめられなかった項目の推測での実装。

### 現状
- 個体の読む項目は 16 個（`web/js/save/palworld.js:124-127` の `PAL_FIELDS`）。`OwnedTime`・`IsFavoritePal`・`Rank_*`・`WorkerSick` などはない。DateTime はティック（100ns・0001-01-01 起点）の数で読める（`web/js/save/gvas.js:565-566`）。ティックを ISO にする `ticksToIso`（`web/js/save/palworld.js:180`）がある。
- 個体の項目は `palFromParams`（`:152-173`）→ `palEntry`（`:849-866` 付近）→ `normalizeOwned`（`web/js/core/owned.js:120-211`）を通る。共有の列は `OWNED_FIELDS`（`web/js/core/owned-shared.js:5-10`）、後から足した列は `OWNED_ADDED_FIELDS`（`:13`）。
- 並べ替えは 6 種（`web/js/core/owned.js:328-335`）。入手順はない。
- 場所を決める入れ物は手持ち・パルボックス（Players の入れ物）・拠点（WorkerDirector）・次元・グローバル（`web/js/save/palworld.js:904-935`）。ほかは `unknown`（`:1043` で数える）。
- ギルドのメンバーの最終ログインは読み飛ばし（`:406`・`:423`・`:442` の `i64()`）。Level.sav の許可リスト（`:489-512`）に `GameTimeSaveData` はない。`Players/*.sav` の `LastOnlineDateTime` は読んでいる（`:744`）が、スナップショットに渡していない。
- ゲーム内の Day は `LevelMeta.sav` から読み（`:822`）、スナップショットの `world.inGameDay` に入る（`:1079`）が、どこにも出していない。プレイヤーの Lv はホストの画面のスナップショットにある（`:545`）が、参加者では 0（`web/js/core/owned.js:519`）。共有のプレイヤーは `uid`・`name` だけ（`web/js/core/owned-shared.js:86`）。
- 牧場の入れ物は読んでいない（`parseBreedFarms`、`web/js/save/palworld.js:292-353` は ConcreteModel.RawData と WorkSaveData だけ）。アイテムの入れ物は全スロットを `decodeItemSlot`（`:450-458`）で読むが、残すのはタマゴのスロットだけ（`:613-632`）。
- `scripts/check-save.mjs`（76 行）は、プレイヤー・場所ごとの数・マスターにないキャラクター・名前のないパッシブ・参照されないタマゴ・牧場の親とタマゴを出す。項目の有無や入れ物の中身は出さない。

### 実装の手順
1. **調べる（読み取りのみ）**: `scripts/check-save.mjs` に `--probe` を足す。実セーブ（ユーザーのワールドのフォルダ）で次を出す:
   - 個体の SaveParameter に `OwnedTime`・`IsFavoritePal`・`FavoriteIndex`・`Rank_HP`・`Rank_Attack`・`Rank_Defence`・`Rank_CraftSpeed`・`WorkerSick`・`HungerType`・`SanityValue`・`CraftSpeeds` があるか（ある個体の数と値の例 3 件）。実装: `parseLevel` に任意の引数 `{ extraPalFields: string[] }` を足し、`palFieldSpec`（`web/js/save/palworld.js:105-111`）の許可リストにその名前を足して読む（`--probe` のときだけ。普段の読み込みは変えない）。
   - `worldSaveData.GameTimeSaveData.RealDateTimeTicks` と、ギルドのメンバーごとの `last_online_real_time`（`readGuildPlayers` で読んだ値）・その差（秒）。
   - `stats.unknownLocation` の個体の入れ物 ID と、その入れ物を持つ MapObject の `MapObjectId`（`DisplayCharacter` があるか）。
   - BreedFarm の `ConcreteModel.ModuleMap` のキーと、ItemContainer のスロット（`staticId`・`count`）。
   - 孵化器（`PalMapObjectHatchingEggModel` など）の ModuleMap・RawData の長さ（F088。バックアップ 2 世代を並べて、減っていく値を探すための 16 進の先頭）。
   - 結果を `docs/SAVE_FORMAT.md` に書く（あった項目・なかった項目・確かめた日）。**ない項目の手順は飛ばし、フェーズの報告でユーザーに伝える。**
2. **入手時刻と NEW（O-26・F053）**:
   - `OwnedTime` があれば: `PAL_FIELDS` に足し、`palFromParams` で `ownedAt: ticksToIso(sp.OwnedTime)`（0 や読めない値は空文字）、`palEntry`・`normalizeOwned` で個体の `ownedAt`。共有は `OWNED_FIELDS` の末尾に `ownedAt`（`OWNED_ADDED_FIELDS` にも）。
   - `OwnedTime` がなければ: IndexedDB に `${namespace}.owned.firstSeen.<worldId>`（個体 ID → 初めて見た時刻の ISO。20,000 件まで、古い順に捨てる）を持ち、読み込むたびに新しい個体 ID だけを足す（ホストの読み込みと参加者の共有の読み直しの両方。`web/js/owned.js` の読み込みの後）。個体の `ownedAt` はこれから付ける（共有はしない）。
   - 並べ替え `['ownedAt', '入手の新しい順']` を `OWNED_SORTS`（`web/js/core/owned.js:328-335`）に足す（`ownedAt` の新しい順 → 個体 ID。`ownedAt` が空の個体は最後）。owned-rows の列見出しの並べ替えにも出す。
   - NEW: `localStorage` の `${namespace}.owned.lastViewed.<env>.<userIdKey>.<worldId>`（時刻 1 つ）より後の `ownedAt` の個体に「NEW」のバッジ（状態チップ）。保存がない（初めて開いた）ときは付けず、今の時刻を保存する。所持パルの画面を離れるとき（`destroy`）に、そのとき見ていたデータのセーブの時刻を保存する。ログアウト・名前の変更でキーを移す（user-rename.js）。data-boundary の検証を通す。
3. **お気に入り（O-57）**: `IsFavoritePal` があれば `PAL_FIELDS` に足し、`favorite: sp.IsFavoritePal === true`（ないときは false）。行の名前の横にハートの SVG（`createElementNS`・`title`「お気に入り」）、キーワードの status に「お気に入り」。共有は `OWNED_FIELDS` の末尾に `favorite`（`'1'`／空。`OWNED_ADDED_FIELDS` にも）。
4. **接続中の仲間・Day・Lv（F006）**:
   - 解析: `LEVEL_SKIP`（`web/js/save/palworld.js:489-512`）に `GameTimeSaveData`（`[WS + '.GameTimeSaveData']: ['RealDateTimeTicks']`）を足し、`parseLevel` の結果に `realDateTimeTicks`。`readGuildPlayers`（`:416-447`）と IndependentGuild（`:406`）の `i64()` を `lastOnlineTicks` として読む（v1・v2 の両方）。
   - `buildSnapshot`: `players` の各プレイヤーに `lastOnlineAt`（ISO）と `online`（`|lastOnlineTicks − realDateTimeTicks|` が 10 秒以内。単位はティックなので 10 秒＝1 億ティック）を足す。読めないときは `online: null`（分からない）。`world.realTimeAt`（RealDateTimeTicks の ISO）も足す。
   - 表示（ホストの画面）: header-frame の状態のポップオーバーに「プレイ中: Alice・Bob（保存 03:07 の時点）」「ゲーム内 123 日目」「Lv: Alice 45 · Bob 38」。所持パルの要約（owned-status の 1 行）に「· 123 日目」。所持者の選択肢の名前に「（プレイ中）」を添える（owned-toolbar の所持者の部品）。
   - 共有（参加者にも出す）: `sharedUpload` の players に `level`・`online`・`lastOnlineAt` を足す（players の JSON の中なので、古い GAS は捨てるだけ。0-4）。`validateOwnedUpload`（`web/js/core/owned-shared.js:86`）で `level`（0〜99 の整数）・`online`（true/false/null）・`lastOnlineAt`（ISO）を通す。Day は**ワールドの行の新しい列** `inGameDay`（`gas/Sheets.js:35` の `OWNED_WORLD_OPTIONAL_HEADERS_` に足す → `setup()` が要る）か、players の JSON に入れずにホストだけの表示にするかを、着手時にユーザーに確かめる（質問 1 件。既定はホストだけ）。`ownedFromShared`（`web/js/core/owned.js:519`）で `level` を受け取る（今は 0 固定）。参加者の画面では「共有 03:07 の時点でプレイ中」と、共有の時刻を必ず添える。
5. **場所不明の解消（C-33）**: 手順 1 で `DisplayCharacter` が原因と分かったときだけ。`parseLevel` の MapObject の走査で、`ModuleMap` の CharacterContainer（`EPalMapObjectConcreteModelModuleType::CharacterContainer`。名前は実セーブで確かめる）の入れ物 ID を集め、`buildSnapshot` の `charContainer` に `{ kind: 'display', baseId }` で入れる。`PLACE_LABELS` に `display: '観賞用ケージ'`、`PLACE_ORDER` に足す（`web/js/core/owned.js:13-28`）。共有の `place` に新しい値が流れるが、古い画面は知らない場所を `unknown` として受ける（`web/js/core/owned.js:497`）ので壊れない。孵化器で孵化済みの個体は、実例があるときだけ別の手順で。`test/save` のフィクスチャを足す。
6. **牧場のケーキの残り（N-09・F051。ホストだけ）**: 手順 1 で BreedFarm の ModuleMap に ItemContainer があると分かったときだけ。`parseBreedFarms` で牧場の入れ物 ID を取り、`parseLevel` のスロットのループ（`:613-632`）でその入れ物の `staticId`・`count` を集めて、`breedFarms[].cake = { itemId, count }`（ケーキ以外のアイテムは無視。ケーキの ID は `Cake`・`Cake02`〜`Cake05` などを実セーブとゲームの名前の表で確かめる）。`normalizeOwned` の farms に `cake`（**共有には載せない**）。
   - 表示: farm-board のカードと、理想個体の牧場の欄（ideal-farms の sticky 行）に「スペシャルケーキ ×7」、0 個なら「ケーキ切れ」（状態チップの警告の色）。ケーキの名前は `EGG_NAMES` と同じ取り出し（farm-board の手順 3）で `CAKE_NAMES` を足す。
   - 任意: 理想個体のケーキの選択の既定を、目標の組を置いている牧場の実際のケーキにする（ユーザーが選んだ値があればそちらを優先）。
7. **魂の強化・病気など（F070）**: 手順 1 で項目があったものだけ。`PAL_FIELDS` に足して個体に `soul: { hp, attack, defense, craft }`・`condition: { sick, hunger, sanity }`。表示は owned-detail のドロワー（「魂の強化 HP+5 · 攻+10」）と、拠点・手持ちの個体の行に「病気」「空腹」のバッジだけ（行を太らせない）。共有は今は足さない（使われてから）。
8. **孵化の残り時間（F088）**: 手順 1 の調査で、減っていく値と WorldOption の孵化時間設定（`PalEggDefaultHatchingTime`）が確かめられたときだけ、farm-board のタマゴと孵化待ちの 1 行に「あと 12 分」。確かめられなければ調査の結果を `docs/SAVE_FORMAT.md` に残して終える。
9. `docs/SAVE_FORMAT.md` の「使う項目」（`:72-78`）と新しい節（接続中の判定・牧場のケーキ）、`docs/OPERATIONS.md` の所持パルの節を書く。

### 触るファイル
- 変更: `scripts/check-save.mjs`（`--probe`）、`web/js/save/palworld.js`（`PAL_FIELDS`・`LEVEL_SKIP`・ギルドの最終ログイン・`buildSnapshot`・牧場の入れ物・観賞用ケージ）、`web/js/core/owned.js`（`ownedAt`・`favorite`・並べ替え・キーワード・場所・players）、`web/js/core/owned-shared.js`（列・players の検証）、`gas/Shared.js`（build:gas）、（Day を共有するなら）`gas/Sheets.js`・`gas/Owned.js`、`web/js/owned.js`（firstSeen）、`web/js/user-rename.js`（lastViewed のキー）、header-frame の状態のポップオーバー、owned-status の要約、owned-rows の行、owned-detail、farm-board、ideal-farms の牧場の行、`docs/SAVE_FORMAT.md`、`docs/OPERATIONS.md`、`web/js/release-notes.js`

### テスト
- `test/save/breed-farm.test.js`・`test/save/import.test.js`（`test/helpers/gvas-writer.js` でセーブを組み立てる今の作りに合わせて）: `OwnedTime`・`IsFavoritePal` があれば個体に入り、なければ空・false。ギルドの最終ログインと `RealDateTimeTicks` の差で `online`。牧場の ItemContainer のケーキ。観賞用ケージの場所（足した場合）。**今の項目の読み取りが変わらない**回帰。
- `test/core/owned.test.js`: `ownedAt` の並べ替え（空は最後・最後は ID）、`favorite` のキーワード、共有の往復（新しい列のない古い共有も受ける）、players の `level`・`online` の往復（古い共有では 0・null）。
- `test/core/shared.test.js`: `validateOwnedUpload` が players の新しい値を検証して通し、不正な値を捨てる。新しい列のあり・なしの幅を受ける。
- `test/gas/owned.test.js`: 列のないシートに書かずに読み、`setup()` 後に書く。
- `test/web/owned-view.test.js`: NEW（初回は付かない・lastViewed より後だけ）、お気に入りのハート。
- 期待値が変わる既存のテスト: 共有の列の数を数えるテスト（`OWNED_FIELDS` の長さ）、`test/core/owned.test.js` の正規化の `deepEqual`（個体の項目が増える）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: どれも配合ではない（個体・プレイヤー・アイテムの事実）。
- 互換: 新しい列は `OWNED_ADDED_FIELDS` で末尾に足し、足す前の画面からの共有も受ける。players の新しい値は JSON の中なので古い GAS は捨てるだけ。`setup()` をやり直すまで GAS は新しい列を書かない。IndexedDB の古いスナップショット（新しい項目なし）では値なしとして扱う。`firstSeen` は data-boundary の検証を通す。
- セキュリティ: プレイヤー名は `textContent`。ハートは `createElementNS`。
- 性能: `PAL_FIELDS` を足すと解析の時間が少し増える（今は手元のセーブで 143ms。`docs/SAVE_FORMAT.md:70`）。`check:save` で前後を測って SAVE_FORMAT.md に書く。`firstSeen` は 20,000 件までで、差分だけを書く。
- 共有の範囲（統合プランの決定）: 入手時刻・お気に入りは共有、接続中の仲間・Day・Lv は参加者に出すなら共有、ケーキの残りはホストだけ。

### release-notes の案
- id: `YYYY-MM-DD-save-extras`
- title: 「新しく入った個体に印」（10 字）
- body: 「入手の新しい順とNEW・お気に入りの印、プレイ中の仲間とゲーム内の日数を出します。」（41 字）
- ケーキの残りを別に配信するなら、もう 1 件「牧場のケーキの残り」（9 字）・「配合牧場ごとのケーキの種類と残りを出し、切れたら印を付けます。ホストの画面だけです。」（42 字）。

### 完了の条件
- [ ] `npm run check:save -- "<ワールドのフォルダ>" --probe` で各項目の有無を確かめ、`docs/SAVE_FORMAT.md` に書いた。なかった項目はユーザーに報告した。
- [ ] `npm test` が通る。
- [ ] 実セーブ（ホストの画面）で、ゲームで孵化させた個体が「入手の新しい順」の先頭に来て、2 回目に開いたときから NEW が付く。
- [ ] ゲームでプレイ中の仲間がヘッダーのポップオーバーに「プレイ中」と出て、Day が合う。
- [ ] （確かめられた場合）牧場のカードと理想個体の牧場の欄にケーキの残りが出る。
- [ ] 解析の時間の増え方を測って書いた。GAS の反映（`gas:push`・`setup()`）をユーザーに伝えた。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — 新しい列は `OWNED_ADDED_FIELDS` で末尾に足し、足す前の画面の共有・古い GAS・新しい項目のない古いスナップショットで壊れない。共有の範囲は統合プランの決定のとおり（入手時刻・お気に入りは共有、ケーキの残りはホストだけ）。セキュリティ — 名前は textContent、ハートは createElementNS（`test/static/security.test.js`）。性能 — 解析の時間の増え方を測って SAVE_FORMAT.md に書いた。INV-2 — 対象外（個体・プレイヤー・アイテムの事実だけ）。

### TODO
- [ ] `check-save.mjs --probe`（個体の項目・最終ログインと RealDateTimeTicks・場所不明の入れ物・牧場の入れ物・孵化器）を書いて実セーブで確かめる
- [ ] 結果を SAVE_FORMAT.md に書き、ない項目をユーザーに報告する
- [ ] 入手時刻（OwnedTime か firstSeen）・並べ替え・NEW（lastViewed）
- [ ] お気に入り（読み取り・ハート・キーワード・共有の列）
- [ ] 接続中の仲間（GameTimeSaveData・ギルドの最終ログイン・online）と Day・Lv の表示
- [ ] players の共有に level・online・lastOnlineAt を足す（Day の共有はユーザーに確かめる）
- [ ] 観賞用ケージの場所（原因と分かったときだけ）
- [ ] 牧場のケーキの残り（入れ物があるときだけ。ホストだけ）
- [ ] 魂の強化・病気（項目があるときだけ。ドロワーと行のバッジ）
- [ ] 孵化の残り時間は調査の結果しだい
- [ ] テスト（save・owned・shared・gas・owned-view）と期待値の更新
- [ ] build:gas、OPERATIONS.md、release-notes、ユーザーへの `gas:push`・`setup()` の依頼

---

## implants: パル手術台とインプラント・パルリバーサー

### 目的
理想個体で欲しいパッシブを候補のだれも持たないとき、「別に手に入れてください」で止めずに、パル手術台で付けられるか・必要なインプラント・手元の在庫を示す。手術で付ける分を除いた計画へのリンク、性別を変えると完成が 1 割以上早まる個体のパルリバーサーの案内（D17）、「手術で完成できる」目標の判定も足す。**計画の既定は配合だけ**（判断事項 3。パルリバーサーの案内も、計画の一覧と並びは変えない）。

### 経緯
- **X-20**: 手術台の表を取り込み（`implants.js`）、理想個体の「足りないパッシブ」に手術台で付けられるかと必要なインプラントを出す。ゲーム本体 v1.0.5 を読み取り専用で確かめた事実:
  - 表 `Pal/Content/Pal/DataTable/MapObject/DT_OperatingTablePassiveSkillDataTable`（54 行・uexp 1,442 バイト）。1 行は「パッシブ ID・数値・必要なアイテム」の 3 項目。(a) アイテム不要 19 行（勇敢・硬い皮膚・すばしこい・まじめ・社畜・不眠・ワーカーホリックなど。数値は 10,000 か 50,000）、(b) 何度でも使える「インプラント：〜」と 50,000 が要る 14 行（職人気質・屈強な肉体・走るのが得意・脳筋など）、(c) 「使い切りインプラント：〜」が要る 21 行（ダイヤモンドボディ・神速・鬼神・超絶技巧・永久機関・世界樹の 7 種・不死身・ベビーシッターなど）。
  - 伝説・希少・魔女・永炎・侵略者・ヌシ・救世主の使い切りインプラントはアイテムの表にはあるが、手術台の表に行がなく、v1.0.5 では付けられない。
  - 表のパッシブ ID は `web/data/passives.js` の id と一致する（`Deffence_up3`・`MoveSpeed_up_3`・`Test_PalEgg_HatchingSpeed_Up` などで確認）。
  - 文言: `MAPOBJECT_NAME_OperatingTable`＝「パル手術台」、`OPERATINGTABLE_Info`＝「手術によってパッシブスキルの移植と性別変更が出来ます」、`OPERATINGTABLE_Dialog_Confirm`＝「…選択した枠に既にパッシブスキルが付与されている場合、新しいパッシブスキルに上書きされます」。
  - ユーザーのセーブ（2026-10-11）には手術台が 4 台、拠点の箱 ItemChest_04 に使い切りインプラント（ダイヤモンドボディ 5・神速 4 など）。
  - 注意: 「パル手術台がまだありません」の判定には MapObjectId の新しい読み取りが要るので、最初の版から外す。`test/web/ideal-view.test.js:157`・`:161` が「伝説を運ぶ経路」と「足りないパッシブは別に手に入れてください」に依存。
- **X-21**: アイテムの在庫の読み取り（N-09 と同じ土台）をインプラントとパルリバーサーに広げ、**拠点の外の宝箱は数えない** → 判断: 段階 1 は、`PalPassiveSkillChange_*`・`PalGenderReverse` の `staticId` を入れ物ごとに数え、`baseCampId` のある入れ物（拠点の箱・ギルド保管庫・BreedFarm）と Players の Essential・Inventory だけを `snapshot.items` にまとめる。ワールドの宝箱（`baseCampId` が空）は捨てる（数えるとパルリバーサーが 3 個から 88 個に化ける。調査の数）。画面には `itemStock(owned, id)` を 1 つだけ用意し、手元で読んだホストのデータがあるときだけ「在庫 5（拠点 1 の箱）」。参加者への GAS 共有は要望が出てから。
- **X-22**: 理想個体の計画に「手術台で付ける」を入れる → 判断: **core は変えない**。手術台で付けられるパッシブがあれば、「手術で付ける分（神速・勇敢）を除いて計画する」のリンクを 1 つ。リンク先は `p` から該当の ID を外した理想個体の URL で、画面の上に「神速・勇敢はパル手術台で付ける前提」の帯（帯の情報は URL の新しいパラメータ `s`）。「欲しいものだけ」で余計なパッシブを上書きできる扱い・在庫の引き当ては入れない。既定の動作と「完全体」の意味は変わらない。
- **X-23**: パルリバーサー（性別の変更）→ 判断: 段階 1 だけ。候補が片方の性別にしかいないとき（全部持つ個体が ♂ 2 体だけ、などを含む）、組がないときの文と完全体作成組の見出しのそばに「♂ が 3 体いますが ♀ がいません。パル手術台でパルリバーサーを使えば 1 体を ♀ にできます」。在庫は X-21 があるときだけ。性別を変えられない種族（`OPERATINGTABLE_Error_CantReverseGender`）の一覧は未確認なので「変えられない種族もあります」と添える。性別を変えたうえで組を作る計画（段階 2）はしない。
  - **D17 で置き換え**（2026-10-12、セッション `c342c7a9`。README の [3-1](README.md#3-1-決定事項d1d18ユーザーの回答)）: ideal-calc の後は、欲しいパッシブを全部持つ個体がいなくても、両親合わせてそろえば完全体作成組になるので、「全部持つ個体が片方の性別だけ」という条件は使えない。ユーザーは次を決めた。
    - 目標の種族の親の候補を **1 体ずつ**性別を変えて確かめ、今の 1 番の完全体作成組より完成までの平均が **1 割以上少ない**とき（完全体作成組が 1 組もなければ、完全体作成組ができるとき）に案内する。完全体作成組があっても、速くなるなら出す。
    - 候補が複数なら、**いちばん速い 3 体＋「ほか n 体」**。
    - 「**パルリバーサーを使わずに作る**」ボタンを置き、押すとその目標（**種族＋欲しいパッシブ＋個体値の目標**。ケーキとパッシブの条件の種類は含めない）では以後案内しない。計算と計画は変えず、案内を消すだけ。
    - 消した記録は**この端末だけ**に保存し、理想個体の画面に「非表示にしたパルリバーサーの案内（n 件）を戻す」リンクを出す（押すと全部戻す）。
    - 案内の計算は、計画の一覧と並びを変えない（判断事項 3）。段階 2（性別を変えた組を計画に入れる）は今もしない。
- **X-24**: 継承ルートで手術台の近道 → 判断: 開始のチップ・探索の条件・個体の一覧は変えず、「選んだパッシブをすべて持つ所持パルはいません。」の下と経路の見出しのそばに「神速はパル手術台で付けられます（使い切りインプラント）。運ばずに、できた個体に付けることもできます」を 1 行だけ。X-20 と同じ版で入れ、release-notes は 1 件にまとめる。
- **X-26**: 「未完成」から手術で完成できる個体と必要なインプラントを分けて出す → 判断: `goalNear(goal, pals, implants)` を足す。判定は手術台の表だけで、在庫は見ない。条件は「目標の種族で個体値の目標を満たす・足りないパッシブがすべて手術台で付けられる・『だけ』なら余計なパッシブの数が足りないパッシブの数以下（上書きできる枠の数）」。ピルは「手術で完成できる」、1 行で「アヌビス♂ Lv52（拠点 1）＋神速（使い切りインプラント）」。在庫は X-21 があるときだけ添える。**ベルは鳴らさない**（完成の通知は今までどおり「完成済み」のときだけ）。
- 判断事項 3: 手術台を計画に入れるか → **案内 → 手術分を除くリンクまで**。既定は配合だけ。

### 依存
- ideal-results（理想個体の結果の欄・説明の部品）、goals-detail（状態のピルの形・未完成の行の差）、route-progress（`renderMissing` の文言を同じ欄で直している。その後の形を引き継ぐ）、save-extras（アイテムの入れ物の読み方・`check-save --probe`）、game-assets（取り出しの部品 `openPak` の `list`）、ideal-calc（完全体作成組の定義・`parentExtras` の世代の表。パルリバーサーの案内の計算が使う）、stable-render（区切った計算 `startSliced`）、data-boundary（消した案内の記録の読み戻し）。

### このテーマでやらないこと
- `core/ideal.js` の計算（`idealPlan`・`passiveChance`・`goalMatches`）に手術を入れること（X-22 の判断。確率のテスト・性能のテスト・「完全体」の意味に広がる）。パルリバーサーの案内（D17）のための関数は `core/ideal.js` に別に足すが、`idealPlan` の一覧と並びは変えない。
- 在庫の引き当て（複数の目標で使い切りのインプラントを取り合う計算）、在庫を判定の条件にすること。
- 性別を変えた組を計画の一覧に入れること（D17 は案内だけ）、継承ルートの探索の変更（偽の開始を混ぜない）。
- 消したパルリバーサーの案内の記録を仲間と共有すること（この端末だけ）。
- 参加者への在庫の共有（GAS）。「パル手術台がまだありません」の判定。
- 手術の金額の計算（数値の意味は未確認。表の数値は出さない）。

### 現状
- 欲しいパッシブを候補のだれも持たないとき: `renderMissing`（`web/js/views/ideal.js:387-395`）の文「…配合では作れません。個体値厳選組を並べています。足りないパッシブは別に手に入れてください。」（`:391`）と「〇〇を運ぶ経路」のボタン（`:393`）だけ（route-progress で文言とボタンが変わる）。計算のしくみ（`:163`）と運用の手順書（`docs/OPERATIONS.md:122`）も「別に手に入れて」で止まる。
- リポジトリに手術台・インプラント・`PalPassiveSkillChange`・`OperatingTable`・`GenderReverse` の記述は 1 つもない。
- `idealPlan`（`web/js/core/ideal.js:694-` 付近）: 足りないパッシブ（`:731` の `missing`）があると `breedable = false`（`:733`）。完全体の表は ♂ と ♀ の両方に全部持つ個体がいるときだけ（`:749` の `complete.M && complete.F`）。性別ごとの候補数は返さない。
  - **ideal-calc の後**: 完全体の表は「同じ種族の ♂・♀ で欲しいパッシブの和集合がそろう組があるとき」に、必要な `parentExtras` で作る。同じ種族で両親合わせてそろう組は完全体作成組（`eggs` は子を入れ替えながらの平均と 1 回で作れる確率の小さい方）。戻り値に `measures`（`watch` の組の物差し）がある。
- 組がないときの文（`web/js/views/ideal.js:371-383` の `noPairs`）: 「（パル名）…を、オスとメスで所持していません」（`:375`）・「オスとメスの組を作れる個体がいません。」（`:380`）。
- アイテムの入れ物: `decodeItemSlot`（`web/js/save/palworld.js:450-458`）で全スロットを読むが、残すのはタマゴだけ（`:613-632`）。入れ物の持ち主（`containerOwners`）もタマゴの入った入れ物だけ（`:634-654`）。プレイヤーの所持品の入れ物 ID は `parsePlayer` が `InventoryInfo` の `*ContainerId` で読み（`:702-748`）、`buildSnapshot` がタマゴ用に `egg-inventory`、ギルド保管庫を `egg-guild` に対応づけている（`:904-935`）。
- 完成の判定 `goalMatches`（`web/js/core/ideal-goals.js:146-154`）は 2 値。
- 継承ルートの空の文: `web/js/views/route.js:144`（route-cleanup で置き場所が変わる）。
- **INV-2 の import の制限**: `core/ideal.js` を読めるのは `views/ideal.js` だけ（`test/import.test.js:38-44`）。新しい `core/implants.js` は `core/ideal.js` を import しない。

### 実装の手順
1. **手術台の表を取り出す**: 新しいスクリプト `scripts/extract-implants.mjs`（`scripts/extract-humans.mjs` と同じく `openPak`・名前の表の読み方を使う。行は形式の情報を持たない並びなので、名前の表のインデックスで 3 項目を読む。`extract-humans.mjs:103` のコメントの読み方）。`npm run extract:implants -- "<インストール先>"`。
   - 出力 `web/data/implants.js`:
     ```js
     // 自動生成（scripts/extract-implants.mjs）。手で編集しない。ゲーム本体 v1.0.5 の DT_OperatingTablePassiveSkillDataTable。
     export default [
       { passiveId: 'Deffence_up3', item: 'PalPassiveSkillChange_xxx', itemName: '使い切りインプラント：ダイヤモンドボディ', kind: 'consumable' },
       // kind: 'free'（アイテム不要）| 'reusable'（何度でも使えるインプラント）| 'consumable'（使い切り）
     ];
     export const GENDER_REVERSE_ITEM = 'PalGenderReverse';
     ```
   - 数値（10,000・50,000）は意味が未確認なので出力しない。アイテムの名前は `DT_ItemNameText_Common` の `ITEM_NAME_<ID>`。
   - 取り出した後に、表のパッシブ ID がすべて `web/data/passives.js` にあることを確かめる（なければスクリプトが止まる）。
   - `data/SOURCES.md` の表に 1 行（ゲーム本体・© Pocketpair, Inc.・v1.0.5・取り出した日）と、「INV-2: 手術台は配合ではない。取り込むのはパッシブ・アイテム・種類だけ」を書く。
2. **判定の関数**: 新しいファイル `web/js/core/implants.js`（DOM に触れない・`core/ideal.js` を import しない）:
   ```js
   import implants from '../../data/implants.js';
   export const implantOf = (passiveId) => byPassive.get(passiveId) ?? null;  // { item, itemName, kind } | null
   /** 手術で完成できる個体（goalMatches の隣）。在庫は見ない。 */
   export function goalNear(goal, pals)  // → { pal, add: string[] }[]（add は手術で付けるパッシブ）
   ```
   - `goalNear` の条件: `pal.palId === goal.palId`・タマゴでない・個体値の目標を満たす（`0＝条件なし`）・足りないパッシブ（`goal.passives` のうち持っていないもの）が 1 個以上ですべて `implantOf` がある・「欲しいものだけ」なら余計なパッシブの数 ≤ 足りないパッシブの数・手術後のパッシブの数が 4 を超えない（持っている数＋足りない数 − 上書きする余計な数 ≤ 4）。`goalMatches` で完成している個体は返さない。
   - `goalNear` は `core/ideal-goals.js` に置いてもよい（`goalMatches` の隣。`implants.js` を引数で渡す形にすれば import の向きを増やさない）。
3. **在庫の読み取り（X-21・ホストだけ）**:
   - `parseLevel`（`web/js/save/palworld.js`）: スロットのループ（`:613-632`）で、`staticId` が `/^PalPassiveSkillChange_/` か `PalGenderReverse`（N-09 のケーキも同じ仕組みに載せる）のものを入れ物ごとに数える（`itemCounts: Map<containerId, Map<staticId, count>>`）。MapObject の ItemContainer の持ち主の対応を、タマゴの入れ物だけでなく**数えた入れ物にも**作る（`:634-654` の `eggContainers.has` の条件を「タマゴの入れ物か、数えた入れ物」に。タマゴの場所の判定の結果は変えない）。
   - `buildSnapshot`: 入れ物ごとの数を、`baseCampId` のある MapObject（拠点の箱・BreedFarm）・ギルド保管庫・プレイヤーの Essential と Inventory の入れ物だけで合計し、`snapshot.items = { [staticId]: { total, places: [{ label, count }] } }`（場所は数の多い順に 3 つまで。ラベルは「拠点 1 の箱」「ギルド保管庫」「Alice の重要アイテム」）。`baseCampId` が空の MapObject（ワールドの宝箱）は数えない。
   - `normalizeOwned` の結果に `items`（そのまま）。`ownedFromShared` では `items: null`（共有しない）。
   - 画面の関数 `itemStock(owned, staticId)` → `{ total, places } | null`（null は「分からない」。参加者・古いスナップショット）。
   - **タマゴの場所の判定を巻き込まない**ことを `test/save` の回帰テストで確かめる（X-21 の注意）。
4. **理想個体の足りないパッシブ（X-20）**: `renderMissing`（route-progress の後の形）で、足りないパッシブごとに:
   - 手術台で付けられる（`implantOf(id)`）: 「〈名前〉: パル手術台で付けられます（〈アイテム名〉）」。`kind: 'free'` は「アイテム不要」。在庫が分かれば「在庫 5（拠点 1 の箱）」、0 個なら「在庫なし」を添える。
   - 付けられない（伝説など）: 「〈名前〉: 手術台では付けられません」。
   - 運ぶ経路（route-progress の R-32 のリンク）は、運べるときだけ今どおり並べる（手術と運ぶの両方を比べられる）。
   - 警告の文は「欲しいパッシブのうち、〈名前〉を持つ個体が親の候補にいないため、配合だけでは作れません。」（「別に手に入れてください」は使わない。`test/web/ideal-view.test.js:161` を直す）。
5. **手術分を除いて計画する（X-22）**: 足りないパッシブ（または欲しいパッシブ全体）のうち手術台で付けられるものがあれば、「手術で付ける分（神速・勇敢）を除いて計画する →」のリンク。URL は `buildHash('ideal', { to, p: 残りのパッシブ, s: 除いたパッシブ })`。
   - 理想個体の `applyRoute`（render-contract）で `s` を読む: パッシブ ID の形・最大 4 個・すべて `implantOf` がある・`p` と重ならない、を満たさないものは捨てて `replace`。
   - `s` があるとき、結果の上に帯「神速・勇敢はパル手術台で付ける前提です（必要: 使い切りインプラント：神速 …）」と「手術を含めずに計画する」（`s` を外して `p` に戻すリンク）。
   - keep-state の history.state・目標の保存（`goalConditions`）に `s` を混ぜない（目標は配合で作る条件のまま）。「目標として保存」は `s` があるとき、保存する条件に除いたパッシブを戻すか押せなくするかを決める（既定: 押せなくして「手術を含めずに計画すると保存できます」）。
6. **パルリバーサーの案内（X-23 を D17 で置き換え。2026-10-12）**:
   - **計算**（`web/js/core/ideal.js` に足す。名前の例 `genderFlipHints`。import は `./index.js` だけのまま）:
     - 入力は `idealPlan` と同じ条件（pals・index・target・passives・mode・targets・cake）と、その計画の結果（今の 1 番の完全体作成組の `eggs`。完全体作成組がなければ null）。
     - 目標の種族の親の候補（`isParentCandidate`・性別が分かる・`palId === target`）を 1 体ずつ X として、X の性別を変えたときに**新しくできる組**（X と、もとは X と同じ性別だった同じ種族の個体の組、と、X の種族が反対の向きで入る layouts の異なる種族の組）の完全体作成組の `eggs` を、`idealPlan` と同じ計算（ideal-calc の後の rank 0 の条件・`parentExtras` の世代の表・`oneShot`）で求め、その最小を X の値にする。
     - **全部計算し直したときと同じ結果になる理由**: X の性別を変えても、X を含まない組は変わらない。それらの組は今の 1 番以上なので「1 番より 1 割以上少ない」に入らない。X のもとの性別の組は消えるだけ。だから、新しくできる組だけを見れば、「1 体ずつ性別を変えて計画を計算し直し、1 番と比べる」のと同じ答えになる（ユーザーが選んだ「目標の種族を 1 体ずつ全部」）。小さな乱数の入力で、1 体ずつ性別を変えて `idealPlan` を呼ぶ総当たりと一致することをテストで確かめる。
     - 案内する条件: X の値が「今の 1 番の `eggs` × 0.9」以下（ideal-calc の丸めた比較キーで比べる）。完全体作成組が 1 組もなければ、X の値が有限なら案内する。
     - 戻り値: 条件を満たす X を値の小さい順に並べ、上位 3 体 `{ pal, to: 'M'|'F', partner, eggs }` と、残りの数 `more`。今の 1 番の `eggs`（`before`）も返す。
     - 世代の表: 新しくできる組の和集合のために、`idealPlan` より大きい `parentExtras` の表が要ることがある（キャッシュは 8 件のまま）。
     - 区切った計算: stable-render の `startSliced` で、計画の計算の後に続けて進める（ジェネレーターにして、組の内側で `yield`）。（追記 2026-10-13: stable-render の `idealPlanSteps` は 1,024 組ごと・世代の表の作成の中でも `yield` し、表は `generationTableSteps` で 1 つずつ作る。組ごとに `♂|♀` のキーの文字列を作ると数千万組で遅くなるので、見る組は ID の表から引く〔phase-1a の stable-render の「実装の記録」2・3〕。案内の計算も同じ形にする。理想個体の画面は `showPlan` でまとめて描くので、案内もその中で一緒に描く）**計画と案内がそろってから一緒に描く**（案内だけ後から出して結果を押し下げない。フェーズ 1 の「表示がずれない」を守る）。案内の欄は結果の見出しのそばの 1 か所。
   - **表示**（`views/ideal.js`。`noPairs` の文と結果の見出しのそば）:
     - 1 行目「パル手術台でパルリバーサーを使うと、性別を変えて早く完成できる個体がいます（性別を変えられない種族もあります）」。在庫が分かれば「在庫 3（ギルド保管庫）」。
     - 1 体ごとに「♂C を ♀ にすると（相手 ♂A）、完成まで 約 4,868 個 → 約 3,592 個」。完全体作成組がないときは「♂C を ♀ にすると（相手 ♂A）、完全体作成組ができます（完成まで 約 3,592 個）」。3 体まで、残りは「ほか n 体」。
     - ボタン「パルリバーサーを使わずに作る」: 押すと、この目標の案内を以後出さない（計算と計画は変えない）。
     - 消した案内が 1 件以上あれば、理想個体の画面に小さく「非表示にしたパルリバーサーの案内（n 件）を戻す」（n はこの端末・この利用者で消した目標の数）。押すと全部戻して描き直す。
   - **消した記録**（この端末だけ。仲間と共有しない）:
     - 目標の見分け方は **種族＋欲しいパッシブ（順不同）＋個体値の目標**: `JSON.stringify([palId, [...passives].sort(), [hp, shot, defense]])`（個体値は `talentTargets` で 0＝条件なしにそろえた値）。ケーキとパッシブの条件の種類（`mode`）は含めない。`core/ideal-goals.js` の `goalKey` は `mode` を含むので使わない。
     - 保存のキーは `${namespace}.reverserHidden.${env}.${userIdKey(userId)}`、値は目標の見分け方の文字列の配列（新しい順・200 件まで）。**`${namespace}.ideals.${env}.` の下に置かない**（目標のストアのキー `${namespace}.ideals.${env}.${userIdKey}`（web/js/ideals.js:27）と接頭辞を分け、名前の変更の移し方（user-rename.js:37-44 の `lists` は接頭辞ごとに 1 行。読み直しは :96-99 で古い ID と新しい ID の 2 つのキーだけ）に 1 行足すだけで済むようにするため）。名前の変更で移るよう、user-rename.js:37-44 の `lists` に `{ prefix: \`${namespace}.reverserHidden.${env}.\` }` を足す（配列なので今の移し方のまま移る）。
     - 読み戻しは data-boundary（`core/boundary.js`）の `list`・`text` で検証し、壊れていたら空として扱う。保存に失敗しても画面は動く（その間だけ覚える）。
7. **継承ルートの 1 行（X-24）**: 継承ルートで選んだ運びたいパッシブのうち手術台で付けられるものについて、空のときの文の下と経路の見出しのそばに「神速はパル手術台で付けられます（使い切りインプラント）。運ばずに、できた個体に付けることもできます」。開始のチップ・探索・個体の一覧は変えない。
8. **手術で完成できる目標（X-26）**: goals-detail の目標の一覧の行で、`goalMatches` が空で `goalNear` があるとき、ピル「手術で完成できる」（状態チップの共通部品。色は「完成済み」と「未完成」の間）と 1 行「アヌビス♂ Lv52（拠点 1）＋神速（使い切りインプラント：神速）」（複数なら最初の 1 体と「ほか n 体」）。在庫が分かれば添える。**通知（ベル）は鳴らさない**（`web/js/ideals.js` の完成の判定は変えない）。
9. 計算のしくみの説明（ideal-results の「?」のダイアログ）に「手術台は計画に入れていません。手術で付けられるパッシブは案内とリンクだけです」を 1 文。`docs/OPERATIONS.md:122` の「別に手に入れてください」の記述を直し、手術台の案内・`s` のリンク・パルリバーサーの案内を書く。

### 触るファイル
- 新規: `scripts/extract-implants.mjs`、`web/data/implants.js`、`web/js/core/implants.js`、`test/core/implants.test.js`
- 変更: `package.json`（`extract:implants`）、`web/js/save/palworld.js`（在庫の数え方・持ち主の対応）、`web/js/core/owned.js`（`items`）、`web/js/core/ideal.js`（パルリバーサーの案内の計算。`idealPlan` は変えない）、`web/js/user-rename.js`（消した案内の記録を移す）、`web/js/views/ideal.js`（`renderMissing`・`s`・パルリバーサー）、`web/js/views/route.js`（1 行）、goals-detail の目標の一覧、`data/SOURCES.md`、`docs/OPERATIONS.md`、`docs/SAVE_FORMAT.md`（アイテムの在庫の節）、`web/js/release-notes.js`

### テスト
- 新設 `test/core/implants.test.js`: `implantOf`（アイテム不要・何度でも・使い切り・付けられないもの）、`goalNear` の条件（個体値が届かない・足りないパッシブに付けられないものがある・「だけ」で余計が多い・4 個を超える・完成している個体は返さない）。
- `test/import.test.js`: `web/data/implants.js` を読むのは `core/implants.js`（と views）だけでもよいが、少なくとも `core/ideal.js` の import の制限（`:38-44`）が通ること。`implants.js` のパッシブ ID がすべて `passives.js` にあることを足す。
- `test/save/*`: 在庫の数え方（拠点の箱・ギルド保管庫・Essential を数え、ワールドの宝箱を数えない）、**タマゴの場所の判定が変わらない**回帰。
- `test/web/ideal-view.test.js:153-161`: 手術台の案内・付けられないもの・在庫の添え書き・警告の文の変更、`s` のリンクと帯（不正な `s` は捨てる）。
- パルリバーサーの案内（D17）:
  - `test/core/ideal.test.js`: 小さな乱数の入力で、1 体ずつ性別を変えて `idealPlan` を呼ぶ総当たりの結果（1 番より 1 割以上少ない個体と値）と一致する。1 割ちょうどの境目、完全体作成組がないとき（できるなら案内）、上位 3 体と `more`、異なる種族の組で速くなる場合、`idealPlan` の一覧と並びが変わらない。
  - `test/web/ideal-view.test.js`: 案内の文（「→」の前後の数）と「ほか n 体」、「パルリバーサーを使わずに作る」で消え、個体値の目標を変えると別の目標として出る（ケーキ・パッシブの条件の種類を変えても消えたまま）、「非表示にした…を戻す」で全部戻る、壊れた記録を読んでも落ちない。
  - user-rename のテスト: 名前の変更で消した案内の記録が移る。
- `test/web/route-view.test.js` か `owned-view.test.js` の継承ルートのテスト: 手術台の 1 行。
- goals-detail のテスト: 「手術で完成できる」のピル、ベルの通知が増えない（`test/web/ideals.test.js`）。
- 性能: `npm run test:perf`（`test/perf/ideal.perf.js`）の計画の値が変わらないこと（`idealPlan` を変えないので）。パルリバーサーの案内の計算を足す: 同じ種族の ♂1000×♀1000 で、計画と同じく 1 回 2 秒以内、30ms の区切りで 1 回の区切りが 50ms 以内、新しく要る世代の表の作成は 300ms 以内（D18。stable-render の予算。超えたら stable-render で分けて回す形にした表の作成を使う）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 手術台は配合ではないので、配合の表示・検索・提示は増えない。取り出すのは手術台の表（パッシブ・アイテム・種類）だけで、配合の値は取り込まない。理想個体の配合の候補は今まで通り（同じ種族どうしは規則・異種は登録済みの配合だけ）。
- INV-2（パルリバーサー）: 性別を変えたときの平均は、例外 (b) の遺伝の仕組み（`core/ideal.js`）の中で求める。異種の組は今までどおり登録済みの配合（layouts）だけ。`core/ideal.js` を import するのは `views/ideal.js` だけのまま。
- 互換: `s` のない URL・古いスナップショット（`items` なし）・参加者（在庫なし）では今の表示（在庫の添え書きなし）。消した案内の記録は新しいキー（既存のキーの中に足さない）で、旧コードのタブは読まない。
- セキュリティ: アイテム名・パル名は `textContent`。
- 性能: `idealPlan` を変えないので計画の性能の予算は変わらない。パルリバーサーの案内の計算は、新しくできる組だけを見る（計画と同じ程度の組の数）ので、区切った計算に載せて上の性能テストで確かめる。在庫の数え方は入れ物 3,974 個（ユーザーのセーブ）でも 1 回の走査。解析の時間を `check:save` で測る。

### release-notes の案
- id: `YYYY-MM-DD-operating-table`
- title: 「手術台で付けられるパッシブ」（13 字）
- body: 「足りないパッシブをパル手術台で付けられるか、必要なインプラントと在庫を理想個体に出します。」（45 字）
- X-24（継承ルートの 1 行）は X-20 と同じ 1 件にまとめる（X-24 の判断）。
- パルリバーサーの案内（D17）は機能が別なので 2 件目を足す: id `YYYY-MM-DD-gender-reverse`、title「パルリバーサーで速くなる組」（13 字）、body「性別を変えると完成が1割以上早まる個体を、パルリバーサーの案内として理想個体に出します。」（44 字）。

### 完了の条件
- [ ] `npm run extract:implants` で 54 行を取り出し、パッシブ ID がすべて `passives.js` にある。SOURCES.md に出典を書いた。
- [ ] `npm test` が通る（タマゴの場所の判定の回帰を含む）。`npm run test:perf` で計画（`idealPlan`）の値が変わらず、足したパルリバーサーの案内の性能テストが予算内。
- [ ] 実セーブ（ホストの画面）で、ダイヤモンドボディを欲しいパッシブにすると「パル手術台で付けられます（使い切りインプラント：ダイヤモンドボディ）· 在庫 5（拠点 1 の箱）」が出る。伝説は「手術台では付けられません」。
- [ ] 「手術で付ける分を除いて計画する」で、帯つきの計画に移り、「手術を含めずに計画する」で戻れる。
- [ ] 性別を変えると 1 番より 1 割以上早く完成する個体がいる目標で、パルリバーサーの案内が上位 3 体＋「ほか n 体」で出る（完全体作成組がない目標では、完全体作成組ができるときに出る）。「パルリバーサーを使わずに作る」で消え、計画の一覧は変わらない。「非表示にした…を戻す」で戻る（D17）。
- [ ] 目標の一覧で「手術で完成できる」が出て、ベルは鳴らない。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 手術台の表から配合の値を取り込まず、理想個体の配合の候補は今までどおり。計画の既定は配合だけ（判断事項 3）。互換 — `s` のない URL・`items` のない古いスナップショット・参加者では今の表示のまま。セキュリティ — アイテム名は textContent（`test/static/security.test.js`）。性能 — 上の `test:perf` の確認。

### TODO
- [ ] `scripts/extract-implants.mjs` で手術台の表を取り出し、`web/data/implants.js` を生成（パッシブ ID の照合）
- [ ] SOURCES.md に出典と INV-2 の注記
- [ ] `web/js/core/implants.js`（`implantOf`・`goalNear`）
- [ ] 在庫の読み取り（拠点の箱・ギルド保管庫・Essential。ワールドの宝箱は除く）と `itemStock`
- [ ] タマゴの場所の判定の回帰テスト
- [ ] 理想個体の足りないパッシブに手術台の案内と在庫（文言の変更とテストの更新）
- [ ] 「手術で付ける分を除いて計画する」のリンク・`s` の検証・帯・目標の保存の扱い
- [ ] パルリバーサーの案内の計算（`core/ideal.js`。新しくできる組だけを見る・総当たりと一致するテスト・性能テスト）
- [ ] パルリバーサーの案内の表示（上位 3 体＋ほか n 体・「パルリバーサーを使わずに作る」・戻すリンク）と、消した記録の保存（この端末だけ・data-boundary・user-rename）
- [ ] 継承ルートの手術台の 1 行
- [ ] 目標の一覧の「手術で完成できる」（ベルは鳴らさない）
- [ ] 計算のしくみの 1 文・OPERATIONS.md:122 の直し・SAVE_FORMAT.md・release-notes

---

## paldex: パルの図鑑（`#/pal` の格子）

### 目的
行き止まりの `#/pal`（ID なし）を、全パルを図鑑順に並べた格子にする。仲間で子として登録がある種は件数、ない種は実物の画像を影にして示し、所持に点・目標に星を付ける。「仲間の発見の進み具合」が一目で分かるようにする（このアプリならではの価値）。

### 経緯
- **S-13**（N-11 を吸収）: 全パルの図鑑の格子 → 判断: **タブは足さない**（今回の整理はタブを減らすのが目的。9 → 5）。`#/pal`（ID なし）を図鑑の格子にし、パル詳細の見出しのパル切り替えの横に「図鑑」のリンク。格子は図鑑順の 48px の `palIcon`（`loading=lazy`）。子として登録がある種は件数、ない種は薄く、所持している種は点、ウィッシュリストにある種は星（D5 で「目標」に読み替え）。上に「子として登録 N / 総数」と「すべて／未登録／未所持」の絞り込み。**未所持をまとめてウィッシュリストに足す操作は入れない**（ウィッシュリストの意味とずれる）。
- **X-14**: 未登録のパルは影の画像を作らず、実物の webp に CSS の filter をかけて影にする（298 枚とも透過あり。画像を 1 枚も足さない。ダークでの濃さは画面で調整。「未登録」を形だけで伝えないよう aria-label）。
- **S-14**（N-12 を吸収）: セーブの RecordData から捕獲数 → 判断: 第 1 段階はホストが読んだセーブの範囲に限る。`Players/<uid>.sav` の RecordData から `PalCaptureCount`（と、あれば `PaldeckUnlockFlag`）を読み、パル詳細に「捕獲 N」（自分の分）と格子に小さな数。捕獲ボーナスのしきい値（/10）はゲームのデータで確かめるまで出さない。仲間の分の共有は別の案。統合プランで「読み込んだ人の分だけ」（共有しない）。
- **Codex 1 回目 20**: 「図鑑は今の画像部品を使い、48px の枠と画像が無いときの寸法を固定するところから始める。所持数・登録件数はデータの更新時に一度だけ集計して Map で引く」。
- INV-2: 薄く出すのは「登録がない」ことだけで、配合表から作れるかどうかは出さない。

### 依存
- pal-detail（パル詳細の共通の中身・パル切り替え）、drawer（格子のパルを押すとドロワー）、participant-self（「自分」のプレイヤー。捕獲数を自分の分だけ出す）、goals-merge（目標の種族）、stable-render（`syncList`）。game-assets の後なら属性のアイコンも使える（任意）。

### このテーマでやらないこと
- レールにタブを足すこと（S-13 の判断）。
- 未所持の種族をまとめて目標に足す操作（N-11 から外した）。
- 捕獲ボーナスのしきい値、仲間の捕獲数の共有、逆引きに「図鑑にまだない子」を足すこと（S-14 の判断）。
- 影の画像を新しく作ること（X-14。CSS の filter だけ）。
- 配合表から「作れる」を出すこと（INV-2）。

### 現状
- `#/pal`（ID なし・不正な ID）は `replace` の後に「パルが見つかりません」と「配合検索へ」だけ（`web/js/views/pal.js:9-13`）。ルーターは `#/pal` に ID がなくても `pal` の画面にする（`web/js/router.js:1-11`）。
- 有効なパルは `pals.js` の `active: true` で 298 体、画像も `web/img/pals/` に 298 枚（配信時に `fetch-icons.mjs` で取得。リポジトリには入れない。`.gitignore:18`・`.github/workflows/pages.yml:30-31`）。298 枚とも VP8X＋ALPH（透過あり）。画像が読めないときは属性の色の円に頭文字の SVG（`web/js/ui/pal-icon.js:7-29`）。
- 子として登録がある種は `state.index.byChild`（`web/js/core/index.js:20-24`）で引ける。所持は `ownedBySpecies`（`web/js/core/owned.js:353-361`）。
- 捕獲数の記録（`Players/*.sav` の RecordData）は読んでいない（`web/js/save/palworld.js:702-712` の `PLAYER_SKIP` の許可リスト）。`gvas.js` は MapProperty を読める（`web/js/save/gvas.js:438`・`:538`）。

### 実装の手順
1. **図鑑の画面**: 新しいファイル `web/js/views/paldex.js`:
   ```js
   /** #/pal（ID なし）: 全パルの図鑑の格子。records・owned・goals の変化で印だけを差分更新する。 */
   export function paldexView(context, route) // → { element, applyRoute?(route), update?(), destroy() }
   ```
   - `web/js/views/pal.js` は ID がない（`route.id` が空）ときに `paldexView` を返す。不正な ID は今の「パルが見つかりません」（＋「図鑑へ」）。
   - 見出し「図鑑」（copy-dead-ends の規則に合わせる）、その下に「子として登録 N / 298」と、絞り込みの押しボタン「すべて／未登録／未所持」（`context.viewState('paldex').filter`）。
2. **格子**: 図鑑順（`no` → `variant`）の `active` のパル 298 体。1 マス＝48px の `palIcon`（`width`・`height` を 48 に固定、`loading = 'lazy'`、画像がないときも同じ寸法の SVG）＋番号・名前（小さく）＋印。
   - 子として登録がある種: 右上に件数（`byChild.get(id)?.length`）。
   - 登録がない種: `palIcon(pal, { silhouette: true })`（X-14。`.pal-icon-silhouette img { filter: brightness(0) opacity(.35) }`、ダークは `filter: brightness(0) invert(1) opacity(.25)` など画面を見て調整）。`aria-label`「〈名前〉（子としての登録なし）」。
   - 所持している種: 左下に点（`aria-label` に「所持」）。目標の種族: 右下に星。
   - マスは `a.pal-tile` 相当のリンク（`#/pal/<id>`）にして、drawer の `installPalLinks` でドロワーが開く。
   - 格子は `syncList`（key は palId）。records・owned・goals の更新では印の差分だけを `update` で直す（格子を作り直さない）。集計（件数・所持・目標の種族の Set）はデータの更新時に 1 回。
3. **入口**: パル詳細の見出しのパル切り替えの横（pal-detail の手順 2）に「図鑑」のリンク（`#/pal`）。ヘッダーのパル検索の候補の先頭にも「図鑑を開く」を置いてよい（任意）。
4. **捕獲数（S-14・ホストだけ・自分の分）**:
   - 先に `npm run check:save -- "<ワールドのフォルダ>" --probe`（save-extras で作ったもの）に RecordData の出力を足し、`PalCaptureCount` の型（Map<Name, Int> か）と、あれば `PaldeckUnlockFlag` を確かめる。**形が違えば止めて報告**。
   - `PLAYER_SKIP`（`web/js/save/palworld.js:702-712`）に `RecordData` の `PalCaptureCount`（と確かめた項目）を足し、`parsePlayer` の結果に `captures: { [palId]: count }`（キャラクター ID は `createSpeciesResolver` で palId に）。読み取りの失敗が所持パルの取り込み全体に響かないよう、`recoverInto` で数えて飛ばす。
   - `buildSnapshot` の `players` の各プレイヤーに `captures`。`normalizeOwned` の players はそのまま渡る。`ownedFromShared` では持たない（共有しない）。
   - 表示: 自分のプレイヤー（participant-self の `ownPlayerUids`）の `captures` を合計し、パル詳細に「捕獲 N」、格子のマスに小さな数。自分が分からない・参加者のときは出さない。
   - `docs/SAVE_FORMAT.md` に RecordData の節、`test/save` にフィクスチャ。
5. `docs/OPERATIONS.md` に図鑑の項目（入口・印の意味・絞り込み・捕獲数はホストの画面の自分の分だけ）を足す。

### 触るファイル
- 新規: `web/js/views/paldex.js`、`test/web/paldex.test.js`
- 変更: `web/js/views/pal.js`、`web/js/ui/pal-icon.js`（`silhouette`・48px の指定）、`web/css/app.css`（格子・影・印）、pal-detail（「図鑑」のリンク・捕獲数）、`web/js/save/palworld.js`（RecordData）、`scripts/check-save.mjs`（RecordData の出力）、`docs/SAVE_FORMAT.md`、`docs/OPERATIONS.md`、`web/js/release-notes.js`

### テスト
- 新設 `test/web/paldex.test.js`: `#/pal` で 298 マス、登録がある種の件数、ない種の影のクラスと aria-label、所持の点・目標の星、絞り込み（未登録・未所持）、records の更新で格子を作り直さず印だけが変わる（同じ要素が残る）。
- `test/save/*`: RecordData の捕獲数（ある・ない・形が違う）と、読めなくても所持パルの取り込みが続く。
- 期待値が変わる既存のテスト: `test/web/views.test.js` などで `#/pal`（ID なし）の「パルが見つかりません」を見ているテストがあれば図鑑に直す。`test/web/router.test.js:16`（`#/pal/%` の ID が空）はそのまま。
- 性能: 298 マス＋画像 298 枚（lazy）で、最初の表示と records の更新が 100ms を超えないこと（Chrome で測る）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 薄く出すのは「子としての登録がない」ことだけ。配合表（`breeding.js`）・`core/ideal.js` を import しない。
- 互換: 捕獲数のない古いスナップショット・参加者では出さない。
- セキュリティ: 影は CSS の filter だけ（画像を足さない）。名前は `textContent`。
- 性能: 画像は lazy、マスの寸法は固定（配置が揺れない）。集計はデータの更新時に 1 回（Codex 1 回目 20）。filter の描画の負担は画面外の lazy で抑える。

### release-notes の案
- id: `YYYY-MM-DD-paldex`
- title: 「パルの図鑑」（5 字）
- body: 「全パルを図鑑順に並べ、子として登録がない種は影で出します。所持は点、目標は星で示します。」（44 字）
- 捕獲数を別に配信するなら、もう 1 件「捕獲数を表示」（6 字）・「ホストの画面で、自分が捕まえた数をパル詳細と図鑑に出します。」（30 字）。

### 完了の条件
- [ ] `npm test` が通る。
- [ ] モックで `#/pal` を開くと 298 マスの格子が出て、登録のない種が影（ライト・ダークの両方で見える）、所持に点・目標に星。マスを押すとドロワーでパル詳細。
- [ ] 「未登録」「未所持」の絞り込みが viewState に残る。
- [ ] 実セーブで RecordData の形を確かめ、ホストの画面で自分の捕獲数が出る（確かめられなければ止めて報告）。
- [ ] 性能: 最初の表示と更新が 100ms を超えない。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 薄く出すのは「子としての登録がない」ことだけで、配合表・`core/ideal.js` を import しない（`test/import.test.js`）。互換 — 捕獲数のない古いスナップショットと参加者では出さない。セキュリティ — 影は CSS の filter だけ、名前は textContent（`test/static/security.test.js`）。性能 — 上の 100ms の確認。

### TODO
- [ ] `web/js/views/paldex.js` と、`views/pal.js` の ID なしの分岐
- [ ] 見出し・「子として登録 N / 298」・絞り込み（viewState）
- [ ] 格子（48px 固定・lazy・件数・影・点・星・`syncList` で印だけ更新）
- [ ] `palIcon(pal, { silhouette })` と CSS の filter（ライト・ダークの濃さの調整）
- [ ] パル詳細に「図鑑」のリンク
- [ ] `check-save --probe` で RecordData を確かめる
- [ ] 捕獲数の読み取り（PLAYER_SKIP・parsePlayer・失敗しても続く）と自分の分の表示
- [ ] テスト（paldex・save）と性能の計測
- [ ] SAVE_FORMAT.md・OPERATIONS.md・release-notes

---

# 任意の項目（ユーザーが採ると決めたものだけ）

統合プランのフェーズ 4 の「任意」の行: 目標の共有（F047。GAS が要る）、元に戻す 8 秒と Ctrl+Z（F085）、空の状態の AI 線画（F086）、継承ルートの横の経路図（F033。「候補は最初から全部出す」と両立する形で）。**どれも着手の前にユーザーに採るかを確かめる**（番号つきの質問で 1 件ずつ）。

## optional-goal-share: 目標を仲間と共有する（F047）

### 目的
端末だけにある目標（理想個体の目標）を仲間と共有し、「だれが何を狙っているか」と「自分の個体が仲間の目標を満たす」を分かるようにする（「仲間で共有」を伸ばすオリジナルの機能）。

### 経緯
- **F047**（別プラン）: GAS に Goals[_test] シートと goals・goalUpsert・goalDelete、一覧を「自分の」「仲間の」2 群に、仲間の目標を自分の個体が満たすと通知「○○さんの『名前』に合う個体を持っています」。価値 4・工数 L・確信 0.6。依存: 目標の一覧の形（goals-merge）と GAS の新しいシート。
- 統合プランでは任意。GAS の再デプロイ（新しいシート・`setup()`）が要るので、共有範囲の決定（「GAS の変更は仲間に共有すると決めたデータだけ」）に従い、ユーザーの決定が先。

### 依存
- goals-merge・goals-detail（目標の一覧の形）、participant-self（自分のプレイヤー）、bell（通知の種類・既読）。

### このテーマでやらないこと
- 目標を共同で編集すること（作った人だけが変える）。他人の目標で自分の画面の計画を変えること。

### 現状
- 目標は `localStorage` の `${namespace}.ideals.<env>.<user>`（`web/js/ideals.js`）。共有はない。GAS のシートは `gas/Sheets.js` の表で決まる（Breedings・Users・ownedPals・ownedWorlds など）。

### 実装の手順
1. ユーザーに採るかを確かめる（共有する項目: 目標の種族・パッシブ・条件・名前・作った人。完成の記録は共有しない）。
2. GAS: `gas/Sheets.js` に `goals` のシート（本番・テスト）、`gas/Service.js`・`gas/Actions.js` に `goals`（一覧）・`goalUpsert`・`goalDelete`（作った人だけ）。検証は `web/js/core/ideal-goals.js` の `cleanGoal` と同じ規則を共有の定義（`owned-shared.js` と同じく build:gas で写す形）に置く。1 人 100 件まで。
3. 画面: `web/js/api.js` に 3 つの操作を足し、目標の一覧（goals-merge のダイアログ）に「仲間の目標」の群（作った人・名前・条件・「自分の個体で完成済み」）。
4. 通知: 仲間の目標を自分の個体（`ideals.mine()`）が満たしたら、新しい種類の通知（`goal-shared:<env>:<goalId>:<worldId>:<セーブの時刻>`）。bell の種類のチップに「目標」として入れる。
5. `docs/OPERATIONS.md` と、GAS の反映（`gas:push`・`setup()`）の手順。

### 触るファイル
- `gas/Sheets.js`・`gas/Service.js`・`gas/Actions.js`・`gas/Setup.js`、共有の定義のファイル（build:gas）、`web/js/api.js`、`dev/mock-api.js`、`web/js/ideals.js`、目標の一覧、`web/js/notifications.js` の source、`docs/OPERATIONS.md`、`web/js/release-notes.js`

### テスト
- `test/gas/*`: 作成・更新・削除（他人の目標は消せない）・上限・検証。`test/web/mock-api.test.js`。`test/web/ideals.test.js`: 仲間の目標の通知（同じ id で重ならない）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2 に関係しない（目標の条件だけ）。セキュリティ: 他人が付けた名前は `textContent`、GAS 側でも `sanitizeText`。互換: 古い GAS では一覧の取得が失敗するので、失敗しても自分の目標は今どおり動く。

### release-notes の案
- id: `YYYY-MM-DD-goal-share`、title: 「目標を仲間と共有」（8 字）、body: 「仲間の目標を一覧で見られ、自分の個体が合うとベルで知らせます。」（31 字）

### 完了の条件
- [ ] ユーザーが採ると決めた。
- [ ] `npm test` が通る。モックで 2 人の ID で目標を作り、互いの一覧に出て、合う個体の通知が 1 回だけ出る。
- [ ] GAS の反映の手順をユーザーに伝えた。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 共有するのは目標の条件だけ。互換 — 古い GAS で一覧の取得に失敗しても、自分の目標は今どおり動く。目標の保存の形（個体値は 0＝条件なし）を変えない。セキュリティ — 他人が付けた名前は textContent（GAS 側も `sanitizeText`）。

### TODO
- [ ] ユーザーに採るかと共有する項目を確かめる
- [ ] GAS のシートと 3 つの操作・検証
- [ ] api.js・開発用 API
- [ ] 目標の一覧に「仲間の目標」の群
- [ ] 仲間の目標の通知
- [ ] テスト（gas・mock-api・ideals）
- [ ] OPERATIONS.md・release-notes・GAS の反映の依頼

---

## optional-undo: 元に戻すを 8 秒に・Ctrl+Z（F085）

### 目的
操作つきのトースト（元に戻す）を見落とさずに押せるようにし、キーボードでも取り消せるようにする。

### 経緯
- **F085**（別プラン）: action つきのトーストは 8,000ms、`mouseenter`／`focusin` でタイマーを止める、文書の Ctrl+Z（入力欄の外）で最後の action を実行。配合 1 件の削除は確認をやめて元に戻すだけに、一括削除は確認を残す。同時に `web/css/app.css:777` の countdown 3s・`web/js/app.js:192` の文言・`test/web/app.test.js:156-231` も変える。
- 統合プランの判断事項 7: **共有する配合の削除の確認は残す**（端末だけのものは確認なし＋元に戻す）。→ F085 の「配合 1 件の削除の確認をやめる」は採らない（取り消した案 S-47 と同じ）。
- delete-undo（1d）で「操作つきは 6 秒・ホバー／フォーカス中は止める」が入る。F085 を採るなら、その 6 秒を 8 秒に変え、Ctrl+Z を足す。

### 依存
- delete-undo（トーストの位置・6 秒・止める仕組み・role=alert）。

### このテーマでやらないこと
- 共有する配合の削除の確認をなくすこと（判断事項 7）。複数段の元に戻す（最後の 1 件だけ）。

### 現状
- トーストは既定 3,000ms（`web/js/ui/toast.js:19`）、操作つきでも同じ。カウントダウンの CSS は 3s（`web/css/app.css:777`）。削除の確認の文は「削除後、3 秒間は元に戻せます。」（`web/js/app.js:192`）。Ctrl+Z の処理はない。

### 実装の手順
1. ユーザーに採るかを確かめる。
2. `web/js/ui/toast.js`: 操作つきの既定を 8,000ms に（delete-undo で入った秒数の定数を変える）。カウントダウンの CSS（`web/css/app.css:777`）も 8s に。
3. 「最後の操作つきのトースト」を toast.js の中に 1 つ持ち、`installUndoShortcut(document)` で Ctrl+Z（Mac は Meta+Z）を受ける。入力欄・`textarea`・`[contenteditable]`・変換中・モーダルのダイアログの中では動かさない（ブラウザの取り消しを奪わない）。押したら action を実行してトーストを消す。期限が切れたら何もしない。
4. `web/js/app.js:192` の確認の文の秒数（delete-undo で変えた文）を 8 秒に。
5. `docs/OPERATIONS.md` に Ctrl+Z を書く。

### 触るファイル
- `web/js/ui/toast.js`・`web/css/app.css`・`web/js/app.js`・`docs/OPERATIONS.md`・`web/js/release-notes.js`

### テスト
- `test/web/app.test.js:156-231`（削除と元に戻すの流れの秒数・文言）を直す。toast のテストに、8 秒・ホバーで止まる・Ctrl+Z で action・入力欄の中の Ctrl+Z では動かない、を足す。

### INV-2・互換・セキュリティ・性能の注意
- 共有する配合の確認は残す。Ctrl+Z はブラウザの入力欄の取り消しを奪わない。

### release-notes の案
- id: `YYYY-MM-DD-undo-8s`、title: 「元に戻すを長く」（7 字）、body: 「元に戻すを 8 秒に延ばし、Ctrl+Z でも取り消せるようにしました。」（36 字）

### 完了の条件
- [ ] ユーザーが採ると決めた。`npm test` が通る。
- [ ] 削除の後 8 秒以内に Ctrl+Z で元に戻る。入力欄の中の Ctrl+Z は文字の取り消しのまま。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — 共有する配合の削除の確認は残す（判断事項 7）。Ctrl+Z は入力欄の取り消しを奪わない。セキュリティ — `test/static/security.test.js` が通る。

### TODO
- [ ] ユーザーに採るかを確かめる
- [ ] 操作つきのトーストを 8 秒・カウントダウンの CSS
- [ ] Ctrl+Z の受け付け（入力欄・変換中・モーダルは除く）
- [ ] 確認の文の秒数
- [ ] テスト（app・toast）
- [ ] OPERATIONS.md・release-notes

---

## optional-empty-art: 空の状態の線画（F086）

### 目的
何もないときの画面（検索の前・結果 0 件など）に、小さな線画を 1 枚出して空白の印象を和らげる。

### 経緯
- **F086**（別プラン）: AI 画像生成が役立つのは空の状態 4 種の 160px の淡い線画（卵・牧場・ノートの小物、primary＋outline の 2 色で明暗の両方に）・ログインの背景・フォルダのドロップの図解。役立たないのはゲームの要素・ナビのアイコン・バッジ（ゲームの実物が取れるので、真似ると偽物に寄る）。依存: 絵柄の方針（ゲームを真似ない）をユーザーが決める。
- 統合プランの判断事項 6: **空の状態の絵はナビのアイコン**（copy-dead-ends で入る）。AI の線画は任意。判断事項 5: **Codex の画像生成は配信物に使わない**。取り消した案 V-17（線画のイラスト）。→ 採るなら、生成画像ではなく**手で描いた SVG（createElementNS で組む線画）**にするか、生成画像を下絵にして SVG に描き直す（配信物は SVG）。

### 依存
- copy-dead-ends（空の状態の部品・ナビのアイコン）、visual-parts（`ui/icons.js`）。

### このテーマでやらないこと
- ゲームの要素（パル・パッシブ・卵の実物）を描くこと。生成画像（PNG）をそのまま配信すること（判断事項 5）。

### 現状
- 空の状態は `empty(text, action)`（`web/js/ui/dom.js:27-31`）の文字だけ。copy-dead-ends でナビのアイコンが付く。

### 実装の手順
1. ユーザーに採るか・絵柄の方針を確かめる（ゲームを真似ない・2 色・SVG）。
2. `web/js/ui/icons.js`（visual-parts）に空の状態の線画 4 種を `createElementNS` の SVG で足す（`fill: none; stroke: currentColor` で明暗の両方に合う）。
3. `empty()` に `illustration` の引数を足し、検索の前・結果 0 件・所持パルなし・目標なしの 4 か所で使う。
4. `data/SOURCES.md` の「実物と自作の使い分け」の表に、自作の線画を足す（下絵に生成画像を使ったなら道具・日付・プロンプトの要旨を記録）。

### 触るファイル
- `web/js/ui/icons.js`・`web/js/ui/dom.js`・使う 4 画面・`web/css/app.css`・`data/SOURCES.md`・`web/js/release-notes.js`

### テスト
- `test/static/security.test.js` が通る（SVG を文字列で入れない）。空の状態のテストで線画の要素がある。

### INV-2・互換・セキュリティ・性能の注意
- SVG は `createElementNS`。容量は 1 枚数 KB 以下。

### release-notes の案
- id: `YYYY-MM-DD-empty-art`、title: 「空の画面に絵」（6 字）、body: 「何もないときの画面に、小さな線画を出します。」（22 字）

### 完了の条件
- [ ] ユーザーが採ると決め、絵柄を確かめた。`npm test` が通る。ライト・ダークで線画が見える。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: セキュリティ — 線画は createElementNS（`test/static/security.test.js`）。配信する絵に Codex の生成画像を使わない（判断事項 5。下絵に使ったなら SOURCES.md に記録）。

### TODO
- [ ] ユーザーに採るかと絵柄の方針を確かめる
- [ ] 線画 4 種を SVG で描く
- [ ] `empty()` に線画の引数と 4 画面への適用
- [ ] SOURCES.md の使い分けの表
- [ ] テストと release-notes

---

## optional-route-graph: 継承ルートの横の経路図（F033）

### 目的
継承ルートの各経路を、パルを横に並べた 1 行の図で一目で分かるようにする。**候補は最初から全部出す決まりは守る**（折りたたまない）。

### 経緯
- **F033**（別プラン）: 候補 5 本を段ごとの縦のカードで全部広げると 15 枚。候補ごとに 1 行の横のグラフ（ノード＝種族のアイコン、辺の上に相手親の小さなアイコンと所持の点）、行を押すと縦のカードを広げ、最短の 1 本だけを既定で広げる。→ 「候補は最初から全部出す」（`docs/OPERATIONS.md:99`・98b7962）と衝突するので保留。別プランの判断: 「横グラフの追加だけなら可。ドロワーの後に再検討」。統合プランの任意: 「『候補は最初から全部出す』と両立する形で」。
- 見送った案: 2 本目以降の経路の折りたたみ（437536b・98b7962 の判断）。

### 依存
- route-cleanup・route-progress（経路のカードの形・✓・相手親のチップ）。

### このテーマでやらないこと
- 経路の折りたたみ・最短の 1 本だけを広げること（「最初から全部出す」の決まり）。

### 現状
- 経路は `routeView`（`web/js/ui/route-view.js:39-48`）が候補ごとに `section.route-card` と段ごとのカードを出す。図はない。

### 実装の手順
1. ユーザーに採るかを確かめる。
2. `routeView` の各候補の見出しの下に、1 行の横の図（`div.route-graph`。開始の種族 → 各段の子の種族を 24px のアイコンで並べ、間に「＋相手親」の小さなアイコンと所持の点（route-progress の ✓・相手親の所持））。SVG の線は `createElementNS`。
3. 縦のカードは今までどおり全部出す（図は要約として足すだけ）。図のノードを押すとその段のカードへ `scrollIntoView`。
4. `docs/OPERATIONS.md` の継承ルートの節に 1 文。

### 触るファイル
- `web/js/ui/route-view.js`・`web/css/app.css`・`docs/OPERATIONS.md`・`web/js/release-notes.js`

### テスト
- `test/web/route-view.test.js`: 図が候補の数だけあり、縦のカードの数は変わらない（「折りたたみなし」の回帰。`:44`・`:64` 付近の検査）。

### INV-2・互換・セキュリティ・性能の注意
- 経路は登録済みの配合だけ（今のまま）。SVG は `createElementNS`。

### release-notes の案
- id: `YYYY-MM-DD-route-graph`、title: 「継承ルートの経路図」（9 字）、body: 「各経路の上に、パルを横に並べた 1 行の図を出します。」（27 字）

### 完了の条件
- [ ] ユーザーが採ると決めた。`npm test` が通る。候補が 5 本でも全部のカードが出たまま、各候補に 1 行の図がある。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 経路は登録済みの配合だけ。互換 — 継承ルートの候補を最初から全部出す決まり（`docs/OPERATIONS.md:99`）を守る。セキュリティ — SVG は createElementNS（`test/static/security.test.js`）。

### TODO
- [ ] ユーザーに採るかを確かめる
- [ ] 候補ごとの 1 行の横の図（アイコン・相手親・所持の点）
- [ ] ノードを押すと段のカードへ移る
- [ ] テスト（カードの数は変わらない）
- [ ] OPERATIONS.md・release-notes

---

# フェーズ 3・4 の終わりにすること

- [ ] 各テーマのブランチを `main` に `--no-ff` でマージし終えた（push と配信はユーザーの確認後）。
- [ ] `npm test` と `npm run test:perf`（20,000 行・偏った分布を含む）が通る。
- [ ] 観点別のエージェントと Codex（読み取り専用。使う前に目的を説明して許可を得る）で、フェーズの差分をレビューし、直した。
- [ ] モックで統合プランの「検証」の表の操作を繰り返し、基準（[measurements.md](appendix/measurements.md)）と比べた。とくに「配合検索 → パル詳細（scrollY=500）: 新しい画面が途中から表示 → ドロワーで開き、本文はそのまま」。
- [ ] ブラウザでしか確かめられないこと（戻る／進む・日本語変換中の入力・20 秒の更新・幅 920px・1100px・拡大 125〜150%・ヘッダー／パネル／候補／トースト／ダイアログ／ドロワーの重なり）を確かめた。
- [ ] 古い IndexedDB・古い共有データ（新しい鍵や列のないもの）・旧コードのタブが混ざった状態から起動して壊れない。
- [ ] GAS の反映（`npm run gas:push`、列を足したテーマでは `setup()`）をユーザーに依頼した: farm-data（push のみ）・farm-board（`eggItemId` の列 → setup）・save-extras（入手時刻・お気に入りの列、Day を共有するならワールドの列 → setup）・任意の F047（新しいシート → setup）。
- [ ] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）をした。

## テーマごとの TODO の数

| テーマ | TODO の数 |
|---|---|
| drawer | 12 |
| pal-detail | 12 |
| owned-detail | 9 |
| farm-data | 11 |
| farm-board | 10 |
| route-progress | 9 |
| goals-detail | 10 |
| game-assets | 11 |
| save-extras | 12 |
| implants | 12（2026-10-12 にパルリバーサーの項目を 2 つに分けた）|
| paldex | 9 |
| optional-goal-share（F047） | 7 |
| optional-undo（F085） | 6 |
| optional-empty-art（F086） | 5 |
| optional-route-graph（F033） | 5 |
