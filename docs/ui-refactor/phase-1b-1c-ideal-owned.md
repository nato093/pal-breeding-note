# フェーズ 1b・1c: 理想個体と所持パルの安定化（実装ドキュメント）

> このドキュメントだけを読めば、フェーズ 1b（理想個体）と 1c（所持パル）の 7 テーマを、経緯も含めて把握して実装できるように書いた。
> 書いた日: 2026-10-12。コードの行番号は HEAD `ad648b7`（web/ に未コミットの変更なし）で、**実際にファイルを開いて確かめた**もの。実装の前にもう一度開いて確かめること（フェーズ 1a の変更で行はずれる）。
>
> 方針の優先順位: 統合プラン（`~/.claude/plans/ui-jaunty-lampson.md`。写しは [appendix/plan-snapshot.md](appendix/plan-snapshot.md)）の決定事項 D1〜D8・判断事項 ＞ このドキュメント ＞ 付録の案の文面（[appendix/catalog.md](appendix/catalog.md)）。案の「判断:」の直しとプランの要点が食い違うときはプランが優先する（食い違いは各テーマの「経緯」に書いた）。
> 別セッションのプラン（F 番号）は [appendix/other-session-plan.md](appendix/other-session-plan.md)（§3 タブ別・§6 バッチ 1 の実装計画・§9 Codex 2 回目レビューの決まり）。Codex のプランレビューは [appendix/codex-reviews.md](appendix/codex-reviews.md)、計測は [appendix/measurements.md](appendix/measurements.md)。

## このフェーズの目的

- **D8（着手順）**: 最初に「毎日使う画面」＝理想個体・所持パルを安定させる。入力するたびに下がずれる・条件が画面外に消える・説明が長すぎる・行の高さが揺れる、をなくす。
- 理想個体（1b）: 条件を sticky の 2 段パネルにまとめ、個体値の目標を「チェックつき・空欄＝条件なし」（D4）にし、結果の要約・数値・説明を短くそろえ、配合牧場の判定を絵と押せる行にする。
- 所持パル（1c）: 読み込みの状態で一覧が動かないようにし、絞り込みを sticky のパネルにまとめ（場所はチップ、所持者は理想個体と同じ意味）、行を列見出しつき・固定の高さにする。
- 共通の受け入れ条件（INV-2・セキュリティ・保存データ・性能の予算）はテーマごとに「注意」の節で具体化した。

## テーマの順番（依存の順）

前提: **フェーズ 1a（inv2-notice → render-contract → data-boundary → header-frame → stable-render → keep-state → popovers）が終わっていること。** その前にテーマ 0 の ideal-calc（[phase-1-0-ideal-calc.md](phase-1-0-ideal-calc.md)）も入っている。1b の理想個体の 4 テーマは、ideal-calc の後の計算と判定（同じ種族で両親合わせてそろう組も完全体作成組・交換推奨は全体の速さの目安 R・「変更あり」は交換推奨の行き先だけ）を前提に書いた（2026-10-12 追記。README の D9〜D16）。

| 順 | テーマ | 工数 | 主な依存 |
|---|---|---|---|
| 1 | **talent-target**（個体値の入力部品・D4） | S | なし（1a の後ならいつでも） |
| 2 | **ideal-panel**（条件の sticky パネル・目標のダイアログ） | M | header-frame（`--header-h`）・render-contract（`applyRoute`）・popovers（パッシブの 1 行部品・`ui/popover.js`）・talent-target |
| 3 | **ideal-results**（要約・数値・説明・♂♀ 行の強調） | M | ideal-panel（要約の場所）・popovers（`ui/popover.js`）・stable-render（結果の差分更新） |
| 4 | **ideal-farms**（牧場の状態の保持・牧場の判定の行） | M | ideal-results（カードの札・説明部品）・ideal-panel（`--panel-h`） |
| 5 | **owned-status**（読み込み状態の固定スロット・データ元の 1 行） | M | header-frame（ヘッダーの状態表示と役割を分ける） |
| 6 | **owned-toolbar**（絞り込みの sticky パネル） | M | talent-target・popovers・owned-status（要約の行） |
| 7 | **owned-rows**（列見出し・4 セル・固定枠・行の操作） | L | owned-toolbar（パネルの高さ）・stable-render（`syncList`・分割描画）・ideal-results（強調の API） |

- **統合プランの表では ideal-panel が talent-target より上にある**。依存だけを見ればどちらが先でもよいが、talent-target を先にすると、ideal-panel で今の入力欄を動かして間引きを足した後に、部品へ差し替える手戻りがない。このドキュメントは talent-target を先にした（ユーザーの決定ではなく、作業の順番の工夫。逆にしても問題はない）。
- 1 テーマ＝1 ブランチ（`feature/<テーマ key>`）→ 日本語のコミット → `main` へ `--no-ff` でマージ。push と配信はユーザーの確認後（統合プラン「実装の進め方」）。
- 各テーマの手順: このドキュメントの節を読む → 現状のコードを確かめる → 振る舞いが変わる所はテストを先に直す・足す → 実装 → `npm test` → モック（`npm run dev` → `http://localhost:5173/?mock=1&seed=80`。所持系の注入はフェーズ 0 で置いたスクリプト `Claude outputs/ui-audit-2026-10/shots/owned/inject.js`）で画面を確かめ、計測を取り直す → `web/js/release-notes.js` の先頭に 1 件。

## フェーズ 1a から受け取るもの（前提の API）

フェーズ 1a の文書（`docs/ui-refactor/` の 1a の phase ファイル）を正とする。**名前や形が違っていたら、このドキュメントの記述を 1a の名前に読み替える**。ここに書くのは統合プランと別プラン §9 に書かれた形。

| 1a のテーマ | このフェーズで使うもの |
|---|---|
| render-contract | `context.update(hash)`（同じ画面なら作り直さない遷移）。ビューは `applyRoute(route)`（URL の条件・部品を最新の route に同期）と `update(state)`（データの描き直し）を持つ。理想個体の `to`・`passives`（今は views/ideal.js:178-179 の定数）は `applyRoute` で読み直す変数になっている。`navigateSelection`・`setPassives` は同じ画面なら `context.update` を使う。（追記 2026-10-12、実装の後: URL は生成時と applyRoute で同じ `readRoute(next)` が読む。g を読んだときは `showConditions()` が個体値・パッシブの条件・ケーキの入力欄を合わせる。作り直すパッシブの欄のフォーカスは views/shared.js の `keepFocus`。phase-1a の render-contract の「実装の記録」）（追記 2026-10-13: keep-state で `keepFocus` は消し、ui/focus.js の `captureFocus`／`restoreFocus` にした。applyRoute の 2 つ目の引数は `{ reason, restored }`） |
| header-frame | CSS 変数 `--header-h`（ヘッダーの高さ）と重なり順の変数（ヘッダー・固定のパネル・候補・レール・トースト・ダイアログ・ドロワー）。このドキュメントでは `--z-header`・`--z-panel`（条件のパネル）・`--z-sticky`（2 段目の固定＝牧場の帯・列見出し）・`--z-popover` と書く（値は phase-1a の header-frame の表）。ヘッダーにセーブ連携の状態（ワールド・セーブ時刻・自動登録）が出る（追記 2026-10-13、フェーズ 1a のレビューの直し `fix/phase-1a-review-render`: ヘッダーのパネル〔ベル・セーブ連携・ID〕は 1 つだけ開く〔各部品の `onOpen` で app.js がほかを閉じる〕。同期状況の「更新できませんでした」は store の `state.fetchError`〔全件の取得の失敗だけ〕を見る。phase-1a の header-frame の「実装の記録」） |
| stable-render | `ui/dom.js` の `syncList(container, items, { key, create })`（create は `{ element, update, destroy }`）。画面用の変更番号。理想個体の「データ・index・実効の条件・本人」の署名で再計算を省く仕組みと、idealPlan の区切った計算。所持パルの最初の 200 行を先に出して残りを区切って足す仕組み（古い仕事の無効化つき）。件数の行（`.result-note`）の min-height。View Transition のヘルパー。（追記 2026-10-13、実装の後: 理想個体は `idealPlanSteps` を `startSliced` で回し、結果を描くのは views/ideal.js の `showPlan(result, plan)`。計算中は前の結果を残して `.ideal-results` に `aria-busy`・`is-computing`。選択欄は views/shared.js の `syncOptions`・`renderWhenIdle` で、同じなら作り直さない。所持パルの行は views/owned.js の中の `ownedRowItem`（行に出す値と一致の理由の署名を分け、理由だけ変わったら理由の行だけ入れ直す。1 回の描き直しで書き換えるのは先頭の 200 行までで、残りは区切る）。ビューのテストの context は `inputDelay: 0`・`sliceBudget: Infinity`。phase-1a の stable-render の「実装の記録」）（追記 2026-10-13、フェーズ 1a のレビューの直し `fix/phase-1a-review-render`: 理想個体の計算の署名の「データ」は所持パルの参照ではなく、候補の個体の計算に効く値〔views/ideal.js の `candidateSignature`。ID・種族・性別・パッシブ・個体値〕。**計算に効く個体の値を足すテーマは candidateSignature にも足す**。計算に効かない値だけが変わったときは、組の個体を新しいデータの個体に入れ替えて描き直す〔`withLatestPals`〕。描くのは `drawPlan(result, plan, changed)`、`showPlan` は「変更あり」の基準を更新してから drawPlan を呼ぶ。所持パルの区切って足す経路は既存の行を消さず、見えている範囲だけ描く一覧は `render(items, { anchor })` で見ていた行の位置に戻す。syncList の空の表示は同じ文なら作り直さない〔中のボタンは今の値を読む〕） |
| keep-state | 画面ごとの条件とスクロール位置の保持（viewState・history.state）。条件の適用 → 描画 → 位置の復元の順番（追記 2026-10-13、実装の後: 部品は ui/view-memory.js の `createViewMemory`・`restoreScroll`。保存する条件の形は views/owned.js の `OWNED_MEMORY`・views/ideal.js の `IDEAL_MEMORY` で、**条件の項目を足す・変えるテーマはこの形も直す**（形にない項目は保存されず、読み込み直すと消える）。戻る・進むで条件を入れ直したときは applyRoute に `restored: true` が来るので、入力欄も合わせる。phase-1a の keep-state の「実装の記録」）（追記 2026-10-13、フェーズ 1a のレビューの直し `fix/phase-1a-review-render`: `OWNED_MEMORY` の passives と URL の p は、内部名の形〔core/boundary.js の `internalName`〕と重複だけを見て、マスターにあるかは見ない。マスターにまだ無い内部名も所持パルに付いていれば候補に出て選べるため） |
| popovers | `ui/popover.js`（固定配置の計算。`{ element, update, destroy }`、document/window のリスナーは AbortController で外す）。パッシブ選択の 1 行部品（`passiveSelector` が `{ element, update({ selected, counts }), destroy }` を返す。開いている間に update が来ても閉じない）（追記 2026-10-13、実装の後: `createPopover` に `tag`・`focusOut`・`place`・`onOpen` を足し、一覧のスクロールは `scrollWithin`。`update` は `{ selected, counts, groups, presets }` を受け、候補の行は `[data-value="<ID>"]`。理想個体の欲しいパッシブは I-49 の 2 群・negatives 'last'・登録した組み合わせ（views/shared.js の `passivePresets`）、所持数は親の候補（`isParentCandidate`）を所持者で絞って数える。パル選択の `describe` は `{ order, badges, dim, orderLabel }`。文字のパッシブは小さなチップ（`passiveChip(id, { compact: true })`・`passiveList(ids, { compact: true })`、views/ideal.js の `.ideal-extras`・`.ideal-carry`）。ideal-results で作り直すときはこの形を引き継ぐ。phase-1a の popovers の「実装の記録」）（追記 2026-10-13、フェーズ 1a のレビューの直し `fix/phase-1a-review-render`: 浮かせた候補は、外でのホイール・タッチのスクロールでは閉じ、それ以外のスクロール〔開いたままの描き直しでページが縮んだなど〕では anchor へ置き直す。`aria-controls` は開いている間だけ） |
| data-boundary | 読み戻しの検証（個体値 0〜100 の整数など）。このフェーズで足す値も同じ検証を通す |

- 1a の時点で `ResizeObserver` のモックが `test/helpers/dom.js` と `test/web/app.test.js` に入っていなければ、このフェーズの最初のテーマ（ideal-panel）で足す（別プラン §9 の C）。

## このフェーズ全体の決まり

1. **sticky の重なり**: ヘッダー（`top: 0`）→ 画面の条件パネル（`top: var(--header-h)`）→ 2 段目の固定（理想個体の牧場の帯・所持パルの列見出し。`top: calc(var(--header-h) + var(--panel-h))`）。`--panel-h` は**画面の section 要素に**書く（`element.style.setProperty('--panel-h', '<n>px')`。ほかの画面と値がぶつからない）。高さは ResizeObserver で測る（下の `trackHeight`）。`scrollIntoView` の着地点は `scroll-margin-top: calc(var(--header-h) + var(--panel-h) + 8px)`。
2. **高さの予算**: viewport 幅 1100px 固定（本文の幅は 1100 − ナビのレール 96 − 余白 48 ＝ 約 956px）。sticky の条件パネルは 2 段＋状態の行で**約 120〜130px まで**。幅 920px（header-frame の min-width）では折り返して高くなってよいが、横スクロールは出さない。
3. **高さを測る小さな共通関数**（ideal-panel で足す。1a に同じものがあればそれを使う）: `ui/dom.js` に

   ```js
   /** target の高さを host の CSS 変数 name に書き続ける。ResizeObserver がない環境（テスト）では 1 回だけ測る。 */
   export function trackHeight(target, host, name = '--panel-h') → () => void  // 戻り値は監視をやめる関数（追記 2026-10-13 fix/phase-1bc-review-owned: その measure() で今すぐ測って書く。owned-toolbar の記録 17 の B6）
   ```
   値は `style.setProperty`（style 属性の文字列は使わない）。
4. **INV-2 の import の制限**: test/import.test.js:38-44 は `core/ideal.js` を import してよいのを `web/js/views/ideal.js` だけに限っている。**新しく作る `ui/*.js`・`views/owned.js` から `core/ideal.js` を import しない**（`TALENT_KEYS`・`CAKES`・`PASSIVE_MODES` が要るときは、views/ideal.js から引数で渡すか、`core/ideal-goals.js` の `GOAL_STATS` を使う）。配合表（breeding.js）は読まない。
5. **セキュリティ**: innerHTML と style 属性の文字列は使わない（test/static/security.test.js）。SVG は `document.createElementNS`、名前や説明は `textContent`、動的な値（バーの長さ・位置）は `style.setProperty('--v', …)`。外部の画像・CDN は使わない（CSP は変えない）。
6. **release-notes**: title 20 字以内・body 60 字以内（`web/js/notifications.js:6-7` の `TITLE_MAX`・`BODY_MAX`。超えると `npm test` が落ちる）。id は `<実装した日 YYYY-MM-DD>-<slug>`（例 `2026-10-13-talent-blank`）で、一度出したら変えない。各テーマの案の文字数は、テスト（`test/web/notifications.test.js:39-40`）と同じ `String.length`（`text.length`）で数えた値（2026-10-12 の最終確認で数え直した）。
7. **テストの直し方**: 文言・DOM の形の期待値の更新（別プラン §9 の C の一覧が正）と、振る舞いの回帰テストを分けてコミットの中で整理する。消してよいのは「その見た目がなくなった」ことを確かめていたテストだけで、振る舞い（絞り込みの結果・並びなど）のテストは形を変えて残す。

---

## talent-target: 個体値の目標を「チェックつき・空欄＝条件なし」に

### 目的
個体値の目標の「0 は気にしない」という番兵の書き方をやめ、「☑ HP 以上 [100]」のチェックつき入力にする。チェックを外す・空欄で条件なし（D4）。理想個体と所持パルで同じ部品を使い、見せ方をそろえる。

### 経緯
- **D4**（別セッションでのユーザーの回答）: 「0 は気にしない」をやめ、チェックを外す・空欄＝条件なし。「以下」「ちょうど 0」は対象外。
- **判断事項 10・「本プランの方を残したもの」**: 保存の形は今の「0＝条件なし」のまま。画面の境界で「空欄・未チェック ⇄ 0」を変換する。別プラン §6 1-1b・§9 の「null を保存して版 2（`{ version: 2, goals }`）にする」案は**採らない**。理由（別プランの指摘の照合 `wvwt1mxpl` の talent の 3・5 で確認）: (1) 計算上 0 と「条件なし」は同じ結果（0 以上はどの個体も満たす。core/ideal-goals.js:152 `goal.targets[key] <= 0 || …`、core/ideal.js の randomAtLeast(0)=1）。(2) 全体を `{version, goals}` で包むと、名前の変更の移行（web/js/user-rename.js:50 の `Array.isArray`）と読み込み（core/ideal-goals.js:74 の `parseGoals`）が空として扱う。(3) 旧コードのまま開いているタブが storage イベントで読み直すと、null を 100 に書き戻す（core/ideal-goals.js:23 の `target()` は整数でない値を 100 にする）。Codex の 6 回目のプランレビューで「個体値の保存を 0 のままにする判断は問題なし」とされた。
- 本セッションの案: I-01（空欄＝指定なし・数字＝以上に表示をそろえる）・I-02（判断では「チェックは足さない」だったが **D4 で上書き**してチェックを付ける）・I-05（「すべて 100」）・O-19（所持パルの「すべて 90 以上」「すべて 100」）・X-30（「以下」は作らず、所持パルの並べ替え「個体値の合計が低い順」で低い個体を探す）。別プランの F040。
- ユーザーの疑問「0 にしたい場合どうするのか」への答え: 目標は「その値以上」なので 0 は条件なしと同じ。低い個体は所持パルの「個体値の合計が低い順」で探す（X-30）。

### 依存
フェーズ 1a（とくに data-boundary の個体値の検証）。ほかの 1b・1c のテーマより先に入れる（ideal-panel と owned-toolbar がこの部品を置く）。

### このテーマでやらないこと
- 保存の形の変更（null・版 2・移行）。`core/ideal.js` の計算（`talentTargets`・`randomAtLeast` など）。`core/ideal-goals.js` の `cleanGoal`・`goalKey`・`goalMatches` の判定。
- 個体値の「以下」「ちょうど 0」。ケーキで届くかの 3 段階の色（I-35 の一部。作り込みすぎと判断）。
- 条件パネルの配置（ideal-panel・owned-toolbar で行う）。このテーマでは今の場所の入力欄を部品に差し替えるだけ。

### 現状
- 理想個体: web/js/views/ideal.js:202-220 で TALENT_KEYS ごとに `<input type=number>` を作る。placeholder は `'0'`（:210）、値は `String(conditions.targets[key])`（:211。0 なら「0」と出る）、input のたびに `Math.trunc(Number(v)) || 0` で 0〜100 に丸めて `renderResults()`（:213-216。101 以上を入れても欄は書き戻さない）。見出しは「個体値の目標（0 は気にしない）」（:258）。既定は `{ hp: 100, shot: 100, defense: 100 }`（:182）。登録一覧の要約は `goal.targets[key] || '気にしない'`（:133）。
- 所持パル: web/js/views/owned.js:131-150。placeholder `'0'`（:139）、0 なら空欄（:140 `if (filter.talent[key])`）、aria-label「HPの個体値（以上）」（:141）、見出し「個体値（以上）」（:154）。既定は 0（:79）。filterOwned は `Number(x) || 0` を下限として比べる（web/js/core/owned.js:309,312）。
- 並べ替えは 6 通りで、個体値は「合計が高い順」だけ（core/owned.js:328-335、比較は :346）。
- 文書: docs/OPERATIONS.md:116「個体値の目標（HP・攻撃・防御。0 は気にしない）」、:119「目標のある各ステータスに目標以上…の親がいて」。コードのコメント: core/ideal.js:83、core/ideal-goals.js:22（「0（気にしない）」）、:141（goalMatches の説明「0 は気にしない」）。

### 実装の手順
1. **新しいファイル `web/js/ui/talent-input.js`** を作る。`core/ideal.js` は import しない（決まり 4）。

   ```js
   /**
    * 個体値の下限の入力（ステータスごとに ☑ ラベル 以上 [数値]）。値の形は保存と同じ { hp, shot, defense }（0〜100 の整数。0 は条件なし）。
    * @param {{ keys: string[], labels: Record<string, string>, value: Record<string, number>,
    *   ariaLabel: (key: string) => string, presets?: { label: string, value: Record<string, number> }[],
    *   onChange: (value: Record<string, number>) => void, debounce?: number }} options
    * @returns {{ element: HTMLElement, update(value: Record<string, number>): void, destroy(): void }}
    */
   export function talentInput(options)
   ```
   - 各ステータスは `label.talent-input-item` の中に `input[type=checkbox]`（aria-label は `${labels[key]}を条件にする`）・`span`（ラベル）・`input[type=number]`（min 0・max 100・step 1・inputMode numeric・placeholder `'—'`・title `'空欄かチェックなしは条件なし'`・aria-label は `options.ariaLabel(key)`）・`span.talent-input-unit`（「以上」）。
   - 部品の中に、ステータスごとの `checked` と `draft`（入力欄の文字列）を持つ。外からの値 v の反映（作るとき・`update`）: `v > 0` なら `checked = true`・`draft = String(v)`、`v === 0` なら `checked = false`・`draft` は前の値のまま（はじめは `''`）。未チェックの入力欄は `disabled` にせず `.is-off` で薄くする（値は保持して薄く。D4）。
   - 出す値: `checked && draft !== '' ? clamp(draft) : 0`（clamp は `Math.max(0, Math.min(100, Math.trunc(Number(draft)) || 0))`）。
   - イベント: 数値欄の `input` → 数字が入ったら自動でチェックを付ける → `debounce`（既定 150ms。統合プランの ideal-panel の「個体値の入力は 150ms 間引き」と別プランの Codex D）の後に `onChange`。`change`（確定）→ 間引きを待たずに `onChange`、そのうえで欄を丸めた値に書き戻す（101 → 100。0 を入れたら空欄にしてチェックを外す）。`blur` で空欄ならチェックを外す。チェックボックスの `change` → すぐ `onChange`。チェックを付けて欄が空なら数値欄にフォーカス。
   - `presets` はボタン（`button secondary small`）で、押すと全ステータスを書き換えて 1 回だけ `onChange`（間引きなし）。
   - 日本語変換中（`event.isComposing`）は `onChange` しない。
   - `destroy()` は間引きのタイマーを止める。リスナーは部品の要素にだけ付ける（document には付けない）。
2. **理想個体**（web/js/views/ideal.js:202-220 を置き換え）:

   ```js
   const talent = talentInput({
     keys: TALENT_KEYS, labels: TALENT_LABELS, value: conditions.targets,
     ariaLabel: (key) => `${TALENT_LABELS[key]}の目標`,
     presets: [{ label: 'すべて 100', value: { hp: 100, shot: 100, defense: 100 } }],
     onChange: (value) => { conditions.targets = { ...value }; renderResults(); },
   });
   ```
   aria-label は今と同じ「HPの目標」にする（テストの探し方を変えないため。I-01 の判断）。g で目標を呼び出したとき（:188-195）と、render-contract の `applyRoute` で条件が変わったときは `talent.update(conditions.targets)`（render-contract の実装では、applyRoute で g を読んだときの入力欄の合わせ直しを `showConditions()` に置いた。その中の個体値の行を置き換える）。見出しは「個体値の目標（以上）」（:258）。
3. **所持パル**（web/js/views/owned.js:131-150 を置き換え）: aria-label は今の「HPの個体値（以上）」のまま。presets は `[{ label: 'すべて 90 以上', value: { hp: 90, shot: 90, defense: 90 } }, { label: 'すべて 100', value: { hp: 100, shot: 100, defense: 100 } }]`（O-19）。`onChange` で `filter.talent = { ...value }; renderResults();`。見出しは「個体値（以上）」のまま。
4. **要約の書き方**（views/ideal.js:133 の `goalSummary`）: ``${TALENT_LABELS[key]} ${goal.targets[key] ? `${goal.targets[key]} 以上` : '—'}``。例「HP —・攻撃 100 以上・防御 90 以上」（I-01 の判断）。
5. **並べ替え「個体値の合計が低い順」**（X-30）: core/owned.js の `OWNED_SORTS`（:328-335）の「個体値の合計が高い順」の次に `['talent-low', '個体値の合計が低い順']`、`sortOwned` の comparators（:341-348）に `'talent-low': (a, b) => talent(a) - talent(b) || dex(a, b)`。owned-rows で並べ替えに向き（dir）を足すときは、`'talent-low'` を `{ key: 'talent', dir: 'asc' }` に読み替えて残す（viewState・URL の互換）。
6. **文言とコメント**: docs/OPERATIONS.md:116 を「個体値の目標（HP・攻撃・防御。チェックを外すか空欄で条件なし。保存は 0）」に、:119 の「目標のある各ステータス」は「条件のある各ステータス」に。core/ideal.js:83 と core/ideal-goals.js:22・:141 のコメントの「気にしない」を「条件なし（画面ではチェックなし・空欄）」に（計算は変えない）。
7. CSS（web/css/app.css）: `.talent-input`（flex・gap 8px 12px・1 行）、`.talent-input-item`（inline-flex・gap 4px）、数値欄の幅 4.5em（今の :917 と同じ。理想個体は :1063 の 5.5em を 4.5em にそろえる）、`.is-off input[type=number] { opacity: .5 }`。既存の `.owned-talent-filter`（:915-917）は部品に置き換わったら消す。

### 触るファイル
- 新規: `web/js/ui/talent-input.js`、`test/web/talent-input.test.js`
- 変更: `web/js/views/ideal.js`（:133・:202-220・:258）、`web/js/views/owned.js`（:131-150）、`web/js/core/owned.js`（:328-348）、`web/css/app.css`（:915-917・:1063）、`docs/OPERATIONS.md`（:116・:119）、`web/js/core/ideal.js`（:83 のコメントだけ）、`web/js/core/ideal-goals.js`（:22・:141 のコメントだけ）、`web/js/release-notes.js`

### テスト
- **追加** `test/web/talent-input.test.js`: (1) 値 0 は未チェック・空欄、v>0 はチェックつき・`String(v)`。(2) 数字を入れると自動でチェックが付き、150ms 後に 1 回だけ onChange（タイマーはモック）。(3) change で 101→100 に書き戻し、0 は空欄・未チェックにする。(4) チェックを外すと onChange の値が 0、欄の文字は残り `.is-off`。(5) presets を押すと 1 回で全部変わる。(6) `update()` で外から反映。(7) destroy 後はタイマーが走らない。
- **追加** `test/core/owned.test.js`: 「個体値の合計が低い順」の並び（今の :103 付近の並べ替えのテストの隣）。
- **期待値が変わる既存のテスト**:
  - `test/web/ideal-view.test.js:432` の `['0', '100', '90']` → `['', '100', '90']`（I-01 の判断）。同じテストで HP のチェックボックスが未チェックであることも確かめる。
  - `test/web/ideal-view.test.js:94-118`（「攻撃の目標」に値を入れて結果が変わる）: input イベントの後に 150ms 待つ（タイマーのモック）か、change を送る形に直す。:105・:114 の「同じ入力欄が残る」は部品になっても成り立つ（入力欄を作り直さないので）。
  - `test/web/owned-view.test.js:116-125`・`:186-194`（「HPの個体値（以上）」への入力）: 同じく間引きを待つか change を送る。
  - **変えないもの**: `test/core/ideal-goals.test.js:79,90`・`test/web/ideal-view.test.js:95`（既定 '100'）。0 を有効な下限として残すため（別プラン §9 の C の注記と同じ）。

### INV-2・互換・セキュリティ・性能の注意
- 保存の形を変えないので、旧コードのタブ・古い localStorage・名前の変更（user-rename.js）と混ざっても壊れない。新しいコードが 0 を書くのは「条件なし」のときだけで、旧コードも同じ意味に読む。
- `ui/talent-input.js` から `core/ideal.js` を import しない（test/import.test.js:38-44）。キーとラベルは呼び出し側が渡す。
- 間引きで再計算の回数が減る（理想個体の idealPlan は重い）。間引き中に画面を離れたら destroy でタイマーを止める（止めないと破棄後に renderResults が走る）。

### release-notes の案
- id: `<実装日>-talent-blank`
- title: 「個体値は空欄で条件なし」（11 字）
- body: 「個体値の目標はチェックを外すか空欄で条件なしです。所持パルに「個体値の合計が低い順」も足しました。」（49 字）

### 完了の条件
- [x] `npm test` が通る（release-notes の文字数を含む）。
- [x] 理想個体: HP のチェックを外すと要約が「HP —」になり、結果が「HP 0」を入れていたときと同じになる。保存済みの目標（HP 0）を呼び出すと HP は未チェック・空欄で出る。
- [x] 所持パル: 「すべて 90 以上」で 3 つとも 90 が入り、1 回だけ絞り込みが走る。「個体値の合計が低い順」が選べる。
- [x] 101 を入れて確定すると 100 に戻る。日本語変換中は絞り込みが走らない。
- [x] 旧コードのタブを開いたまま新しいコードで目標を登録し、旧タブで読み直しても個体値が 100 に変わらない（保存の形が同じことの確認）。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — 目標の保存の形が「0＝条件なし」のまま（上の旧コードのタブの確認。null・版 2 は入れていない。判断事項 10）。INV-2 — `ui/talent-input.js` が `core/ideal.js` を import しない（`test/import.test.js`）。セキュリティ — `test/static/security.test.js` が通る。性能 — 間引きの途中で画面を離れても destroy でタイマーが止まり、破棄の後に結果を描かない。

### TODO
- [x] `ui/talent-input.js` を作る（値の形・チェックと draft・間引き・presets・destroy）
- [x] `test/web/talent-input.test.js` を書き、先に落ちることを確かめる
- [x] 理想個体の入力欄（views/ideal.js:202-220）を部品に差し替え、g の呼び出し時に `update` する
- [x] 見出しを「個体値の目標（以上）」に、`goalSummary` の「気にしない」を「—」「N 以上」に
- [x] 所持パルの入力欄（views/owned.js:131-150）を部品に差し替え、「すべて 90 以上」「すべて 100」を付ける
- [x] `OWNED_SORTS` と `sortOwned` に「個体値の合計が低い順」を足し、core のテストを足す
- [x] ideal-view.test.js:432 と、入力のたびに結果を見るテスト（ideal-view:94-118・owned-view:116-125・186-194）を間引きに合わせて直す
- [x] CSS を部品に合わせ、`.owned-talent-filter` の不要な規則を消す
- [x] docs/OPERATIONS.md:116・119 とコードのコメントの「気にしない」を直す
- [x] release-notes に 1 件足し、モックで両画面を確かめる

### 実装の記録（2026-10-13、ブランチ `feature/talent-target`）

実装のときに決めたこと・文書と違う形にしたこと（後のテーマ ideal-panel・owned-toolbar はこちらを正とする）。

1. **部品の形（API）**: `talentInput({ keys, labels, value, ariaLabel, presets = [], onChange, debounce = 150 })` → `{ element, update(value), flush(), destroy() }`（web/js/ui/talent-input.js）。文書の形に **`flush()`**（間引いて待っている入力をすぐ知らせる）を足した。ビューの `flushInputs()`（app.js が履歴のエントリへ条件を書く前に呼ぶ）がこれを呼ぶ。`destroy()` は待っている入力を取り消し、その後は onChange を呼ばない。ビューは `debounce: context.inputDelay ?? 150` を渡す（ビューのテストの context は `inputDelay: 0` なので、input を送った直後に結果を確かめる今のテストはそのまま通る。文書のテストの項の「150ms 待つか change を送る形に直す」は要らなかった）。
   - DOM: `div.talent-input` の中に、ステータスごとの `label.talent-input-item`（`input[type=checkbox]`〔aria-label「HPを条件にする」〕・`span.talent-input-label`〔ラベル〕・`input[type=number]`〔aria-label は `ariaLabel(key)`〕・`span.talent-input-unit`〔「以上」〕）、その後ろにプリセットの `button.button.secondary.small`。チェックのない欄の `label` に `.is-off`。
   - 呼び出し側: 理想個体は views/ideal.js の `talent`（`showConditions()` で `talent.update(conditions.targets)`。onChange で `conditions.targets = { ...value }`）、所持パルは views/owned.js の `talents`（`showFilter()` で `talents.update(filter.talent)`。onChange で `filter.talent = { ...value }`）。保存の形（`IDEAL_MEMORY` の targets・`OWNED_MEMORY` の talent）は変えていない。
2. **update の決まり（手順 1 の直し）**: 文書の「v === 0 なら draft は前の値のまま」だと、同じ画面のまま登録した目標（HP 0）を「呼び出す」と、前の HP 100 が薄く残り、完了の条件「HP は未チェック・空欄で出る」を満たさない。→ **出している値と同じステータスは触らない**（利用者がチェックを外して薄く残した数字・打っている途中の数字を残す）、**違うステータスだけ入れ直す**（v>0 はチェックつき・`String(v)`、0 は未チェック・空欄）。update は待っている間引きを取り消し、onChange は呼ばない。後のテーマで描くたびに update を呼んでも、利用者が外したチェックの薄い数字は消えない。
3. **確定（change）**: 待っている入力があるときだけ知らせる（前のコードの `apply.flush()` と同じ。間引きの後の確定で同じ値を 2 回知らせない）。欄の書き戻し（101 → 100・小数の切り捨て・0 → 空欄でチェックを外す）では出す値は変わらない。負の値・読めない値も 0（空欄・チェックなし）。
4. **空欄のチェックを押して外すとき**: 「空欄で離れたらチェックを外す（blur）」と「チェックボックス・ラベルを押す」が重なると、blur で外した直後の click でチェックがまた付き、空欄のチェックを押して外せなかった。→ 部品の要素の `pointerdown`（数値欄の外）で印を付け、その blur では外さない（チェックの change・数値欄の focus で印を消す）。
5. **日本語変換**: compositionstart〜compositionend の間の input・change は知らせず、compositionend で打った文字として扱う（ui/dom.js の `onTextInput` と同じ考え方）。Chrome の `type=number` で実際に変換が始まるかは確かめていない（モックでは合成のイベントで確かめた）。
6. **CSS（手順 7 の直し）**: 数値欄の幅は文書の 4.5em ではなく **両画面とも 5.5em**（今の理想個体の幅）。4.5em では Chrome の増減のボタンの分で「100」の右の 0 が切れた（scrollWidth 67 > clientWidth 57。所持パルの前の欄も 100 は切れていた）。`.talent-input` は `flex-wrap: wrap`（所持パルは 3 列のグリッドの 1 マスに置いたままなので、1 行には収まらない）。`.owned-talent-filter` と `.ideal-conditions .owned-talent-filter input` の規則は消した。
7. **幅と高さ（ideal-panel・owned-toolbar への申し送り）**: 部品を 1 行に並べた幅は、理想個体（3 つ＋「すべて 100」）584px、所持パル（3 つ＋プリセット 2 つ）710px（1 つの欄 148〜154px、「すべて 90 以上」114px・「すべて 100」93px。幅 1280px で測った）。ideal-panel の 2 段目の案（所持者 150px＋segmented＋個体値＋segmented で約 830px）・owned-toolbar の 2 段目の案（パル 180px＋★ 100px＋個体値＋パッシブ 1fr＋segmented＋属性）は、この幅のままでは本文の 956px に収まらない見込み。詰めるなら「以上」を見出しに 1 回だけにする・増減のボタンを隠して欄を狭める・プリセットをメニューにする、など（どれも利用者に見える判断なので、そのテーマで確かめる）。今の場所での高さは phase-1a の「計測の記録」の talent-target の行（所持パルの絞り込みは幅 1100px で 323 → 435px、理想個体の条件は 161 → 231px）。
8. **文言**: 理想個体の「計算のしくみ」の「目標のある各ステータスに目標以上…」（views/ideal.js の `explanation()`）は文書の手順にないので変えていない（docs/OPERATIONS.md:119 だけ「条件のある各ステータス」にした）。core/ideal.js の `talentTargets` の説明（:115 付近の `@param targets`）のコメントの「気にしない」も、:83 と同じく「条件なし〔画面ではチェックなし・空欄〕」にした（コメントだけ）。
9. **旧コードのタブ（完了の条件 5）**: 保存の形は変えていない（core/ideal-goals.js の `cleanGoal`・`parseGoals`・`target()` などの保存・読み込みのコードは変えず、コメントだけ）。ideal-view.test.js の新しいテストで、HP のチェックを外して登録すると保存は `{ hp: 0, shot: 100, defense: 100 }` であることを確かめた（新しいコードが 0 を書くのは条件なしのときだけで、旧コードも同じ意味に読む）。旧コードのタブを実際に開いて読み直す確認はしていない。
10. **テスト**: test/web/talent-input.test.js（11 件。値 0 と v>0 の出し方・自動のチェックと 150ms の間引き・確定の書き戻し・チェックを外すと 0 で数字は薄く残る・空欄のチェックでフォーカスと blur で外す・押して外すときの衝突・日本語変換・プリセット 1 回・update・flush と destroy・debounce 0）を、部品を作る前に落ちる（モジュールがない）ことを確かめてから足した。期待値を直したもの: ideal-view の g の 2 つ（`['0', '100', '90']` → `['', '100', '90']` と HP のチェックなし）・「パッシブの所持数は…切り替えも出さない」（チェックボックスは個体値の 3 つだけ）・owned-view の restored（表示の切り替えのチェックだけを見る＋HP のチェック）・app.test.js の読み込み直し（同じ）。足したもの: ideal-view（チェックを外すと HP 0 と同じ結果・登録の要約「HP —」・「すべて 100」）、owned-view（「すべて 90 以上」「すべて 100」で filterOwned が 1 回だけ・チェックを外すと条件なし／「個体値の合計が低い順」の並び）、core/owned.test.js（高い順・低い順と選択肢の位置）。

---

## ideal-panel: 理想個体の条件を sticky の 2 段パネルに

### 目的
理想個体の条件（7 ブロック）を、スクロールしても見える 2 段のパネルにまとめる。常時 1 行を使っている登録の行と、開くと全部が下がる「登録した理想個体」の折りたたみをやめ、見出しの「目標（N）」ボタン→ダイアログにする。

### 経緯
- **D8**（毎日使う画面の安定化を最初に）。別プランの **F034**（条件 7 ブロックを sticky の 2 段パネル）・**F036**（登録一覧を見出し右のボタン→ダイアログの表に。フェーズ 2 の goals-merge で「目標」の一覧になる）。
- 本セッションの案: **I-18**（登録名の欄をなくし「☆ 登録」ボタンと小さな入力に。判断: 名前の変更・条件の更新は入れない＝外して登録し直す。理由は、通知の文が名前を変えない前提で作られている ideals.js:163-174 のと、goalKey の重複判定・完成の記録のリセットまで要るため）・**I-19**（目標を選ぶまで登録の操作を出さない）・**I-20**（判断: 「前の条件のまま」の帯は出さず、登録される条件の要約をボタンの title とトーストに出す）・**I-34**（スクロールしても条件が見える固定バー。sticky パネルに吸収）・**I-41**（パッシブの条件とケーキを押しボタン＝segmented に）・**I-53**（目標を選んだら所持の状況 ♂/♀ を出す）。
- **判断事項 8**: 目標の名前は自動（パル名＋パッシブ）。保存のときに小さな入力で変えられる。
- 別プランの Codex D: 個体値の入力のたびの計算を 150ms 間引き（talent-target の部品で実現）。名前の入力が URL の遷移で消える問題は、ダイアログ化と render-contract で解消。
- 別プラン §6 1-2 の sticky の重なり（Codex P1-4）: ヘッダーの高さを変数に、パネルは `top: var(--header-h)`、2 段目は `top: calc(var(--header-h) + var(--panel-h))`、`--panel-h` は ResizeObserver で測る。

### 依存
header-frame（`--header-h`・重なり順）、render-contract（`applyRoute`。目標・パッシブを変えても作り直さない）、popovers（パッシブの 1 行部品・`ui/popover.js`）、talent-target。

### このテーマでやらないこと
- 目標の名前の変更・条件の更新（I-18 の判断）。目標の一覧の並び替え（未完成を上に）・種族ごとのまとまり（フェーズ 3 の goals-detail）。ウィッシュリストの統合（フェーズ 2 の goals-merge）。
- 要約の文の中身（ideal-results）。配合牧場の行（ideal-farms）。「?」の説明ダイアログの中身（ideal-results。ここでは置き場所だけ用意してよい）。
- 「登録者の対応」の案内文（views/ideal.js:143・:374。フェーズ 1d の participant-self が直す）。

### 現状
- 並び（web/js/views/ideal.js:355）: 見出し → `goalsBox`（`details.ideal-goals`、:305-313。開いているかは viewState の `goalsOpen`）→ `query`（目標の palPicker とパッシブ、:197-200）→ `panel`（所持者・パッシブの条件・個体値・ケーキ、:254-259）→ `registerRow`（名前の入力と「この条件を登録」、:276-283。ログインしていれば常に出る :283）→ 要約 `note`（:261）→ `missingBox` → `farmBox` → `results` → `explanation()`（:151-173）。
- パッシブの条件・ケーキは native select（:257・:259。選択肢は core/ideal.js:42-45 の PASSIVE_MODES、:30-34 の CAKES。ケーキの文は「キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）」のように長い）。
- 登録: `defaultName()`（:274）・`goalConditions()`（:275）・`renderRegister()`（:284-290。目標なし・登録済みならボタン無効）・`registerGoal()`（:291-302。結果ごとのトースト）。一覧: `removeGoal`（:315-325。トーストで元に戻す）・`goalRow`（:326-337）・`renderGoals`（:338-353。完成済みを上に、中身が同じなら描き直さない）。
- 所持の状況: idealPlan は `complete`（欲しいパッシブを全部持つ ♂/♀）と `sameSpecies`（目標と同じ種族の ♂/♀）を数える（web/js/core/ideal.js:703-704・719-721）が、戻り値（:877）に `sameSpecies` はなく、画面は `complete` も使っていない。
- sticky の要素は本文に 1 つもない（app.css で `position: sticky` はダイアログの :586・:601 だけ）。CSS: `.ideal-conditions`（:1034-1035）、`.ideal-register`（:1073-1075）、`.ideal-goals`（:1076-1083）。
- 計測（appendix/measurements.md 撮影 owned #10）: scrollY=250 で欲しいパッシブを足すと画面を作り直し、1 番目の組が 466→486 に動き、フォーカスが body に落ちる（render-contract と popovers で直る前提）。

### 実装の手順
1. **並びを組み直す**（views/ideal.js:355）: `heading`（h1「理想個体」＋右端に `[目標（N）]` ボタンと `[?]` ボタンの置き場 `.view-heading-actions`）→ `panel`（`section.ideal-panel`、sticky）→ 要約の行（`note`。1 行固定）→ `missingBox` → `farmBox` → `results`。`goalsBox` と `registerRow` と末尾の `explanation()` の呼び出しは外す（`explanation` の中身は ideal-results で「?」のダイアログに移す。このテーマで先に外すなら、ideal-results までは「?」ボタンで今の 14 項目をそのまま出すダイアログを仮に付ける）。
2. **パネルの 2 段**（`.ideal-panel` は CSS grid。1 段目・2 段目とも 1 行・折り返さない。各欄の見出しは小さなキャプション 1 行）:
   - 1 段目: `[目標 palPicker 240px][欲しいパッシブ（popovers の 1 行部品）1fr][所持の状況 170px][☆ 目標として保存 auto]`
   - 2 段目: `[所持者 select 150px][パッシブの条件 segmented][個体値（talent-input）＋すべて 100][ケーキ segmented]`（短いラベルで約 830px。本文 956px に収まる）
     （追記 2026-10-13、talent-target の実装の後: 部品の個体値の 3 つ＋「すべて 100」は 1 行で 584px あり、このままでは 956px に収まらない見込み。talent-target の「実装の記録」7）
     （追記 2026-10-13、ユーザーの決定 D20 で直した: **所持の状況は 1 段目から外して 2 段目の右端へ**。1 段目は `[目標 240px][欲しいパッシブ 1fr][☆ 目標として保存 auto]`。**欲しいパッシブのチップが 1 行に入りきらないときは改行し、パネルがその分（約 38px）伸びる**（横に省略・「+N」にはしない）。2 段目は 2 行に折り返してよいが、パネル全体はできるだけ低く（見出しを入力の左に置く・個体値の部品を詰める）。実装は下の「実装の記録」1・2）
   - CSS: `position: sticky; top: var(--header-h); z-index: var(--z-panel); background: var(--md-sys-color-surface); border-bottom: 1px solid var(--line); max-height: 130px;`（追記 2026-10-13: D20 によりパネルは伸びるので `max-height` は付けない）。祖先に `overflow` があると sticky が効かないので、`.app-main`・`.view` に overflow が付いていないことを確かめる。
   - 高さ: `trackHeight(panel, element)` で `--panel-h` を画面の section に書く（決まり 3）。destroy で監視をやめる。
3. **segmented の部品**（新規 `web/js/ui/segmented.js`。route.js:33-38 の `startChip` は継承ルートの開始チップで役割が違うので触らず、見た目の CSS だけ寄せる）:

   ```js
   /** 押しボタンの選択（1 つだけ選ぶ）。choices は [value, 短いラベル, title?] の配列。 */
   export function segmented({ label, choices, value, onChange }) → { element, update(value), destroy() }
   ```
   - `div[role=radiogroup][aria-label=label]` の中に `button[role=radio][aria-checked]`。選んでいるものだけ `tabindex=0`、ほかは -1。←→ キーで移動して選ぶ（ロービングタブインデックス）。選んでいるボタンは `secondary-container` の地。
   - パッシブの条件: `[['include', '全部持つ', '欲しいものを全部持つ（他も可）'], ['only', 'だけ', '欲しいものだけを持つ']]`。ケーキ: `[['none', 'なし', 'ケーキ・野菜ケーキ'], ['talent', 'キノコ等', 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）'], ['special', 'スペシャル', 'スペシャルケーキ（パッシブを 4 個まで継ぐ）']]`。title は core/ideal.js の CAKES・PASSIVE_MODES の文をそのまま使う（views/ideal.js から渡す。決まり 4）。値と計算は変えない。
4. **所持の状況**（I-53）: core/ideal.js:877 の戻り値に `sameSpecies` を足す（1 語）。パネル 1 段目（追記 2026-10-13: D20 で **2 段目の右端**に移した）に `a.ideal-holding`（幅固定、目標がないときは「—」で幅を保つ）: `所持 ♂${s.M} ♀${s.F}` ＋ 欲しいパッシブがあれば ` · 全部持つ ♂${c.M} ♀${c.F}`。title「親の候補の数（タマゴ・グローバルパルボックスを除き、所持者の絞り込みの後）」。href は `buildHash('owned', { pal: to, p: passives.join(',') })`。`renderResults` の中で idealPlan の結果から書き換える（文字だけ書き換え、要素は作り直さない）。
5. **目標として保存**（I-18〜I-20）: 1 段目の右端に `button.ideal-save`「☆ 目標として保存」。
   - 目標がないときは `visibility: hidden`（場所は残してずれを防ぐ。I-19）。登録済み（`ideals.has(goalConditions())`）なら「★ 保存済み」で無効。ログインしていない（`!ideals`）なら出さない。
   - title に `goalSummary(goalConditions())`（登録される条件。I-20）。
   - 押すと `ui/popover.js` で小さな板を開く: 名前の入力（`maxLength = GOAL_NAME_MAX`、値は `defaultName()` を入れて全選択）・「この端末に保存します」の注記・[保存]・[キャンセル]。Enter で保存、Esc で閉じてボタンへフォーカスを戻す。保存は今の `registerGoal()` の分岐（:294-301）をそのまま使い、成功のトーストを「「名前」を保存しました（HP —・攻撃 100 以上…）。完成したら右上のベルで知らせます」にする。
   - 開いている間に `applyRoute` で目標・パッシブが変わったら板を閉じる（古い条件で保存しないため）。
6. **目標のダイアログ**（F036）: 見出しの `[目標（N）]`（N は `ideals.list().length`。`ideals.subscribe` で数だけ書き換え。`ideals.saveFailed` のときはボタンに「!」と title「この端末に保存できませんでした」）。押すと `openDialog('目標', { className: 'ideal-goals-dialog' })`（web/js/ui/dialog.js:3）。
   - 中身は今の `goalRow`・`goalStatus`・`removeGoal`・保存失敗の警告（:310-311）を移した表（列: パル・名前／パッシブの小さなチップ／条件の要約／状態／[呼び出す][外す]）。並びは今と同じ（完成済みを上に。未完成を上にするのはフェーズ 3）。空のときは「保存した目標はまだありません。条件を選んで「☆ 目標として保存」を押すと、ここに並び、完成したら右上のベルで知らせます。」。
   - 開いている間は `ideals.subscribe` と所持パルの更新で行を描き直す（今の `shownGoals` の比較を使い、同じなら描き直さない）。閉じたら購読をやめる。
   - [呼び出す] は `goalHash(goal)` へ移ったうえで**ダイアログを閉じる**（ダイアログは遷移で自動では閉じない。`closeDialogs` を呼ぶのはログアウトのときだけ: web/js/app.js:307）。
   - 画面の destroy でダイアログが開いていたら閉じる。
7. **要約の行を 1 行に固定**: `.result-note` を `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 1lh;`、`title` に全文。中身の短縮は ideal-results。
8. **個体値の間引き**は talent-target の部品の既定（150ms）を使う。所持者・segmented の変更はすぐ再計算。
9. 古い CSS（`.ideal-register`・`.ideal-goals` の details 用）を消し、`.ideal-panel`・`.ideal-holding`・`.ideal-save`・`.segmented`・`.ideal-goals-dialog` を足す。

### 触るファイル
- 新規: `web/js/ui/segmented.js`、`test/web/segmented.test.js`
- 変更: `web/js/views/ideal.js`（:197-200・:254-259・:261・:274-353・:355）、`web/js/core/ideal.js`（:877 に sameSpecies）、`web/js/ui/dom.js`（`trackHeight`。1a にあれば不要）、`web/css/app.css`（:1034-1035・:1073-1083 ほか）、`test/helpers/dom.js`・`test/web/app.test.js`（ResizeObserver のモック。1a で入っていなければ）、`web/js/release-notes.js`

### テスト
- **追加** `test/web/segmented.test.js`: クリックで aria-checked が移り onChange が 1 回、←→ で移動、update で外から反映。
- **追加**（ideal-view.test.js）: (1) パネルが `.ideal-panel` にまとまり、目標を変えても（`applyRoute`）パネルの要素が同じものである（作り直さない）。(2) 目標がないと保存ボタンが見えない、登録済みなら「★ 保存済み」で無効、title に要約。(3) 保存の板で名前を変えて Enter → その名前で登録される。(4) 「目標（N）」→ダイアログに行が出て、[外す]→トーストの元に戻すで戻る。[呼び出す] でダイアログが閉じる。(5) 所持の状況が「所持 ♂n ♀m」になる。
- **追加**（`test/core/ideal.test.js`）: idealPlan の戻り値に sameSpecies が入る。
- **期待値が変わる既存のテスト**（別プラン §9 の C の ideal-view の行のうち、このテーマの分）:
  - `:110-119`・`:250`・`:433-434`・`:479-488`: ケーキとパッシブの条件を select の option で探している → `[role=radiogroup]` のボタンを押す形に。
  - `:399-407`（「登録する名前」の入力・「この条件を登録」・summary の「登録した理想個体（1 件）」）、`:411-416`、`:438-454`（登録済みで無効・外す・空の文）→ 保存ボタン・保存の板・ダイアログの形に。
  - `:77`（`.ideal-help` の「計算のしくみ」）→ ideal-results で直す（このテーマで explanation を外すならここで直す）。
  - `test/web/views.test.js:65`（navigate 前提）は render-contract で直っている前提。

### INV-2・互換・セキュリティ・性能の注意
- 所持の状況は idealPlan の数（登録済みの配合と同じ種族だけ）で、配合表は使わない。`ui/segmented.js` は core/ideal.js を import しない。
- viewState の `goalsOpen`（:307-308）は使わなくなる。古い viewState に残っていても読まないだけで害はない（keep-state の版の決まりで捨ててもよい）。
- 保存の板・ダイアログは textContent だけで組む。
- sticky パネルの高さが変わると下が動くので、パネルの中で高さが変わる要素（パッシブのチップ・所持の状況）は幅と高さを固定する。パッシブの 1 行部品は popovers で 1 行に収まる前提（選んだチップが多いときは横に省略）。（追記 2026-10-13: D20 で、パッシブのチップは横に省略せず、入りきらないときは改行してパネルが伸びる形にした。所持の状況・保存ボタンは幅を固定した）

### release-notes の案
- id: `<実装日>-ideal-panel`
- title: 「理想個体の条件を上に固定」（12 字）
- body: 「条件をスクロールしても見える 2 段にまとめました。登録した目標は見出しの「目標」ボタンから開きます。」（51 字）

### 完了の条件
- [x] `npm test` が通る。
- [x] モックで、結果を下までスクロールしても条件パネルがヘッダーの下に見えている（幅 1100px で 2 段、パネルの高さ 130px 以下）。（2026-10-13: 見えている〔top 56〕。高さは D20 の形で 140.4px と 130px を超えた。理由は「実装の記録」2）
- [x] scrollY=250 で欲しいパッシブを足しても、1 番目の組の top が変わらない（基準: 466→486）。フォーカスがパッシブの部品に残る。（改行が要るときはパネルが 37px 伸びる。アヌビスでは配合牧場の欄が伸びる分だけ動く。「実装の記録」10）
- [x] 個体値・segmented・所持者を変えても、パネルの高さが変わらない（`--panel-h` の値が同じ）。
- [x] 目標を選ぶ前は保存ボタンが見えず、場所は空いたまま（選んだときに右が動かない）。
- [x] 「目標（N）」のダイアログから外す・元に戻す・呼び出すができ、呼び出すとダイアログが閉じる。
- [x] 幅 920px・拡大 125% で横スクロールが出ない（パネルは折り返してよい）。（拡大 125%・150% 相当の 880・733px では body の min-width 920px の横スクロール〔40・187px〕が前からあり、ユーザーの判断で変えない〔phase-1a の header-frame の記録〕。パネルははみ出さない）
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 所持の状況は idealPlan の数だけで配合表を使わず、`ui/segmented.js` は `core/ideal.js` を import しない（`test/import.test.js`）。互換 — 目標の保存の形（`cleanGoal` の項目）を変えていない。古い viewState の `goalsOpen` が残っていても壊れない。セキュリティ — 保存の板・ダイアログは textContent だけ（`test/static/security.test.js`）。性能 — 個体値の入力は 150ms の間引きを通ってから再計算する。

### TODO
- [x] ResizeObserver のモックと `trackHeight` があるか確かめ、なければ足す
- [x] `ui/segmented.js` とテストを作る
- [x] views/ideal.js の並びを「見出し → パネル → 要約 → 牧場 → 結果」に組み直す
- [x] パネルの 2 段（目標・パッシブ・保存／所持者・パッシブの条件・個体値・ケーキ・所持の状況。D20）を組み、sticky と `--panel-h` を付ける
- [x] パッシブの条件・ケーキを segmented に差し替える
- [x] idealPlan の戻り値に sameSpecies を足し、所持の状況のリンクを出す
- [x] 「☆ 目標として保存」と保存の板（名前・Enter・Esc・条件が変わったら閉じる）を作る
- [x] 登録一覧の details を「目標（N）」→ダイアログに移す（購読・閉じる・呼び出すで閉じる）
- [x] 要約の行を 1 行固定にする（中身は ideal-results）
- [x] ideal-view.test.js の select 前提・登録の行前提のテストを直し、新しいテストを足す
- [x] 古い CSS を消して新しい CSS を足し、1100px・920px・125% で確かめる
- [x] release-notes に 1 件足す

### 実装の記録（2026-10-13、ブランチ `feature/ideal-panel`）

実装のときに決めたこと・文書と違う形にしたこと（後のテーマ ideal-results・ideal-farms・owned-toolbar はこちらを正とする）。

1. **パネルの形（D20 で手順 2 を直した）**: `section.ideal-panel`（aria-label「理想個体の条件」。sticky・`top: var(--header-h)`・`z-index: var(--z-panel)`・surface の地・下の線）の中に 2 段。
   - 1 段目 `div.ideal-panel-main`: grid `240px minmax(0, 1fr) auto`。目標の palPicker（`div.picker`）・欲しいパッシブ（`div.field.passive-selector`）・`div.ideal-save-slot`。見出しは入力の上で、picker と passive-selector は subgrid（見出しの行と入力の行をそろえる。パッシブが改行して入力の行が高くなっても、目標の選択欄と保存ボタンは 1 行目に置く）。1100px でパッシブの欄は 534.7px。
   - 2 段目 `div.ideal-panel-sub`: flex・折り返し。`label.ideal-panel-item`（見出し「所持者」＋select）・`div.ideal-panel-item`（「条件」＋segmented）・「個体値（以上）」＋talent-input・「ケーキ」＋segmented・右端の `a.ideal-holding`（所持の状況。D20 で 1 段目から移した）。見出しは入力の左（`span.field-label`。押しボタンの見出しは radiogroup の名前と重ねて読まれないよう aria-hidden）。
   - 文書の `max-height: 130px` は付けていない（D20: パッシブのチップが改行したらパネルが伸びる。max-height だと下が切れる）。
   - 個体値の部品はパネルの中だけ CSS で詰めた（各欄の「以上」を隠して見出しを「個体値（以上）」の 1 回に、数値欄の増減のボタンを隠して 3.6em・高さ 32px。↑↓ キーの増減は残る）。部品の API・aria-label（「HPの目標」「HPを条件にする」）は変えていない。ラベルを「攻」「防」に縮めることはしていない（1100px で 1 行目に入ったため）。所持者の select・押しボタン・プリセットも高さ 32px。
2. **高さ（実測。ユーザーに示した例の「約 125px」と違う）**: 幅 1100px・パッシブ 0 個で **140.4px**（1280px も同じ。920px は 2 段目が 3 行で 164px）。内訳: 上下の余白 4＋6・段の間 5・下の線 1・1 段目 55.4（見出し 14.4＋2＋入力 40。パル選択と追加欄の高さ 40px は他画面と同じ部品）・2 段目 69（32＋5＋32）。2 段目の欄を 1 行に並べると 所持者 192・条件 159・個体値 492・ケーキ 251・所持の状況 204 で約 1,330px あり、本文の幅 941px（1100px − ナビ 96 − 余白 48 − スクロールバー 15）に入らないので 2 行になる（1 行目に 所持者・条件・個体値、2 行目に ケーキ・所持の状況。ユーザーに示した例と同じ並び）。パッシブのチップが改行すると +37px（1100px で 3 個目にダイヤモンドボディなど長い名前が来たとき 177.4px。920px で 4 個は 3 行で 239px）。130px に収めるには 1 段目の見出しを消す（約 −16px）しかなく、ユーザーが選んだ例（見出しは入力の上）と違うのでしていない。
3. **`trackHeight`**（`web/js/ui/dom.js`。決まり 3 の形のまま）: `trackHeight(target, host, name = '--panel-h') → () => void`。ResizeObserver の border-box の高さを 0.01px に丸めて `host.style.setProperty(name, …)` で書き、同じ値なら書き直さない。ResizeObserver が無い環境（テスト）では getBoundingClientRect で 1 回だけ測る。理想個体は `trackHeight(panel, element)`（**`--panel-h` は画面の section `section.view.ideal-view` に書く**）で、画面の destroy で監視をやめる。パネルより後ろの要素（要約・牧場・結果とその中）に `scroll-margin-top: calc(var(--header-h) + var(--panel-h, 0px) + 8px)`（フォーカス・scrollIntoView の先がパネルの下に隠れない）。ideal-farms の 2 段目の帯は `top: calc(var(--header-h) + var(--panel-h))` で使う。テストのモックは `test/helpers/dom.js` の `installResizeObserver(t) → { resize(target, 高さ), observed(target) }` と、`test/web/app.test.js` の `boot(t, { resize: true })`（同じ resize・observed を返す）。
4. **`segmented`**（新規 `web/js/ui/segmented.js`）: `segmented({ label, choices, value, onChange }) → { element, update(value), destroy() }`。`div.segmented[role=radiogroup][aria-label=label]` の中に `button.segmented-option[role=radio][data-value][aria-checked][tabindex]`。choices は `[value, 短いラベル, title?]`。押す・←→↑↓（端では反対の端へ回る）・Home・End で選び、選んでいるものを押しても onChange は呼ばない。`update` は onChange を呼ばず、知らない値ならどれも選ばず先頭を tabindex=0 にする。選んでいるものは secondary-container の地（継承ルートの開始チップと同じ）。理想個体は `shortChoices(PASSIVE_MODES, { include: '全部持つ', only: 'だけ' })`・`shortChoices(CAKES, { none: 'なし', talent: 'キノコ等', special: 'スペシャル' })`（title は core/ideal.js の長い文。views/ideal.js から渡す）。owned-toolbar の「全部／だけ／なし」もこれを使える。
5. **要約の行**: `p.result-note.ideal-note`（1 行に固定・省略記号。`showNote(text)` が textContent と title に同じ文を入れる）。中身は今の `summaryText` のまま。ideal-results で `.ideal-summary` に組み直すときは、1 行に固定する CSS（`.ideal-note`）を引き継ぐ。
6. **見出しと「?」の置き場**: `header.view-heading` の h1 の右に `div.view-heading-actions`（`button.ideal-goals-button`「目標（N）」と `button.icon-button.view-help-button`「?」・aria-label「計算のしくみの説明」）。見出しは sticky にしていない（パネルの上でスクロールで隠れる）。**計算のしくみは結果の下から外し、「?」で `openDialog('計算のしくみ', { className: 'ideal-help-dialog' })` に今の 14 項目（`ul.ideal-help`）をそのまま出す**（手順 1 の「先に外すなら仮のダイアログ」を採った）。ideal-results は `openHelp()` の中身を 4 見出しにする。
7. **目標のダイアログ（手順 6）**: 「目標（N）」で `openDialog('目標', { className: 'ideal-goals-dialog' })`。中は保存の失敗の警告（`p.form-errors`・role=alert）と `ul.ideal-goal-list`（`syncList`。キーは目標の ID、行の `update` は状態の文と `.done`・`.ready` だけ。目標の中身は変えられないため）と足の「閉じる」。行の列: `div.ideal-goal-title`（パルの絵＋名前）／パッシブの小さなチップ（無ければ「—」）／`small.ideal-goal-summary`（`goalSummary`）／`span.ideal-goal-status`／「呼び出す」（`a.button.secondary.small`・`data-focus-key="goal:<id>"`・押すとダイアログを閉じて、遷移はリンクのまま）／外す（`「名前」を目標から外す`。トーストの「元に戻す」で戻る）。並びは今と同じ完成済みが上。空のときは `li.ideal-goal-empty`「保存した目標はまだありません。…」。行を外してフォーカスを失ったら次の行、無ければ「閉じる」へ（syncList の fallbackFocus）。開いている間だけ行を描き（`ideals.subscribe` と所持パルの更新で `renderGoals`）、閉じたら `clearList`。画面の destroy で開いていたダイアログ（目標・計算のしくみ）を閉じる。`ideals.saveFailed` のときはボタンを「目標（N）!」にして title「この端末に保存できませんでした」。
8. **目標として保存（手順 5）**: `div.ideal-save-slot > button.button.secondary.ideal-save`（min-width 10.5em で「☆ 目標として保存」「★ 保存済み」の幅が同じ）。目標がないときは `.is-placeholder`（visibility: hidden）と disabled で場所を残す（1100px で目標なし・ありとも左 919px・幅 142px、パッシブの欄の幅 534.7px で変わらない）。**保存済みは disabled ではなく `aria-disabled="true"`**（文書の「無効」。disabled にすると、保存した直後に押していたボタンからフォーカスが落ちるため。押しても何もしない）。ログインしていない（`!ideals`）ときは slot ごと hidden。板は `createPopover({ anchor: saveButton, wrapper: slot, className: 'picker-popover ideal-save-popover', focusOut: true })`（role=dialog・aria-label「目標として保存」。右端にそろえた幅 320px）で、名前の欄（aria-label「目標の名前」。開くと `defaultName()` を入れて全選択）・「この端末に保存します。完成したら右上のベルで知らせます。」・キャンセル・保存。Enter（変換中は除く）で保存、Esc・キャンセルで閉じてボタンへ。applyRoute で目標かパッシブが変わったら閉じる。目標を外した・保存済みになったときも閉じる。成功のトーストは「「名前」を保存しました（`goalSummary`）。完成したら右上のベルで知らせます」、ほかの結果の文も「登録」を「保存」にした。保存の形（`goalConditions()`。`order: 'next'` を含む）は変えていない。
9. **所持の状況（手順 4）**: `a.ideal-holding`（2 段目の右端・幅 17em・右寄せ・省略記号）。`drawPlan` で idealPlan の結果から「所持 ♂${sameSpecies.M} ♀${sameSpecies.F}」＋欲しいパッシブがあれば「 · 全部持つ ♂${complete.M} ♀${complete.F}」（文書の文のまま。ユーザーに示した例は「/ 全部」）、href は `buildHash('owned', { pal: to, p })`（href 属性で付け外し）。結果が無い（目標なし・データなし・初めての計算中）ときは「—」で href なし。前の結果を残したまま計算しているときは、要約と同じく前の数のまま。
10. **固定と動き（完了の条件の画面の確認。phase-1a の「計測の記録」の ideal-panel の行）**: 下までスクロールしてもパネルはヘッダーの下（top 56）。scrollY=250 でパッシブを 1・2 個足しても 1 番目の組の top は動かない（ホルス・1100×600 で 49 → 49）。改行が要る 3 個目ではパネルが 37px 伸び、Chrome のスクロールのアンカーで scrollY が 250 → 287 に補正され、1 番目の組の top は 49 のまま（パネルが 37px 分多く重なる）。スクロールしていないとき（クロスケンタウロス・scrollY 0）は 1 番目の組が 299 → 336（+37）下がる。注入データのアヌビスでは、伝説を足すと配合牧場の判定が「そのまま」→「交換推奨」に変わって牧場の欄が 133 → 172px（+39）伸び、1 番目の組も 39px 下がる（パネルと要約の行は動かない。牧場の欄の高さは ideal-farms で直す）。フォーカスは 1〜3 個目で候補の検索欄、4 個目で最後のチップの ×。個体値・押しボタン・所持者・「すべて 100」・← キーで変えても `--panel-h` は 140.39px のまま。
11. **テスト**: `test/web/segmented.test.js`（5 件。部品を作る前にモジュールがなくて落ちることを確かめた）、`test/web/dom.test.js` に trackHeight（2 件）、`test/core/ideal.test.js` に sameSpecies（区切った計算の固定のハッシュの比較は、区切る前の実装に無い sameSpecies を外して比べる）、ideal-view に パネルの形・ResizeObserver・所持の状況・保存の板（Enter・Esc・キャンセル・目標なし・ログインなし）・目標のダイアログ（外す・元に戻す・呼び出す・閉じた後）・保存の失敗と古い viewState の goalsOpen、app.test.js に `--panel-h` と画面を離れたときの監視の終わり。期待値を直したもの: ケーキ・パッシブの条件を select から押しボタンに（ideal-view 5 か所・app.test.js の読み込み直し）、登録の行・一覧の折りたたみを保存の板・ダイアログに（ideal-view の登録・g・applyRoute・外す、app.test.js の「呼び出す」）、`.ideal-help` を「?」のダイアログに、`.route-query` を `.ideal-panel-main` に、見出し「個体値の目標（以上）」を「個体値（以上）」に。
12. **そのほか**: docs/OPERATIONS.md の理想個体の節（目標として保存・目標のダイアログ・パネル・押しボタン）を新しい画面に合わせた（触るファイルの一覧にはなかった）。viewState の `goalsOpen` は読まなくなった（残っていても害はない）。候補の一覧はパネルの中で下に開くので、窓の高さがおよそ 585px より低いと、パネルが固定された状態で候補の下の端が窓の外に出ることがある（候補の一覧の高さは今の `min(60vh, 520px)` のまま）。
13. **フェーズ 1b・1c の終わりのレビューの直し（2026-10-13、ブランチ `fix/phase-1bc-review-ideal`。指摘 A7・A8・A9・A13・A15。カードと牧場の分は ideal-results の 13・ideal-farms の 16、所持パルの分は owned-toolbar・owned-rows の 18）**:
    - **A7 所持者の名前と所持の状況のリンク**: 所持パルの ownedView の中の `holderChoices(data)` を **views/shared.js の `holderChoices(data, ideals)`** に移し、理想個体の所持者の選択肢もこれで作る（自分のプレイヤー〔`ideals.selfUids()`〕は「（自分）」を付けて先頭、名前がない・同じ名前が 2 人以上なら UID の頭 8 字）。要約の「◯◯ の個体」は選択肢の名前なので、自分のプレイヤーを選ぶと「Alice（自分） の個体」になる（テストの期待値を直した）。所持の状況のリンクは `buildHash('owned', { pal, p, holder })`（所持パルの URL の受け口 `holder=player:<uid>`／`mine`。数は所持者で絞った後なので、開いた先もそろえる）。場所の条件はリンクに入れていない（所持パルの既定の場所なのでタマゴも出る。所持の状況の数はタマゴを除く）。
    - **A8**: 個体値の目標の数値欄の aria-label を「HPの目標」→「**HPの目標（以上）**」にした（「以上」は見出しに 1 回だけ出すので名前に入れる。所持パルの「HPの個体値（以上）」と同じ形）。チェックの「HPを条件にする」は変えていない。テスト（ideal-view・app.test.js）の探し方も直した。
    - **A9 用語**: g の目標が見つからないときのトースト「登録した理想個体が見つかりません」→「**保存した目標が見つかりません**」。パッシブの選択の段の見出しとボタンの aria-label「登録した組み合わせ」→「**保存した目標の組み合わせ**」（ui/passive-picker.js。所持パル・継承ルートにも出る）。
    - **A15 パッシブの板の高さ**: ui/passive-picker.js の **`fitList()`** が、開いたときと `update` のたびに（組み合わせの段が変わると一覧の上端が動く）、一覧の上端から窓の下端まで 12px 空けた高さ（最小 160px）を一覧の CSS 変数 **`--passive-options-max`** に書き、`.passive-options { max-height: min(60vh, 520px, var(--passive-options-max, 520px)) }` で効かせる。上端は **`listTop()`**: 開くときの動き（`@starting-style` の scaleY(.9) translateY(-4px)）の途中でも同じ値になるよう、**板を置いた要素の getBoundingClientRect ＋板と一覧の offsetTop** で測る（はじめは一覧の getBoundingClientRect で測り、上端が約 30px 上に出て 150% 相当でまだ 22px はみ出した）。画面（`review-fix-ideal/a6-a15.js`。目標を 3 つ保存して組み合わせの段を出す）: 853×600・deviceScaleFactor 1.5 の scrollY 1200 で、理想個体の板は 115〜597（前 115〜631。窓 600。一覧 250px）、スクロールしていないときも 183〜597（一覧 182px）、検索しても同じ。1100×900 は一覧 520px のまま（前と同じ）。所持パルの板は 60vh（360px）のまま 114〜561。固定でない画面（継承ルート）にも同じ上限が効く（最小 160px なので、窓の下の端の近くで開くとページを動かして見る）。上の 12 の「窓がおよそ 585px より低いと候補の下の端が窓の外に出る」は、パッシブの板についてはこれで直った（目標のパル選択の候補は今のまま）。
    - **A13**: 保存の板の「保存」をマウスで押す経路のテスト（板の focusout の relatedTarget が「保存」のときに閉じない。owned-toolbar の記録 12 の ui/popover.js の直しを外すと落ちることを確かめた）を足した。
14. **フェーズ 1b・1c の後のユーザーのフィードバック（2026-10-13、ブランチ `fix/phase-1bc-feedback`。D28「項目の区切りと見出しが一目で分かる形に。理想個体のパネルも同じ見せ方に」）**: 所持パルの絞り込みのパネル（owned-toolbar の記録 20）と同じ部品・同じ CSS の決まりにした。細かな UI は D27 のとおり担当が決めた。
    - **共通の部品（views/shared.js に足した）**: **`fieldHead(field, ...extras) → div.field-head`**（最初の子が見出し `span.field-label` の欄〔パル選択・パッシブ選択〕の見出しを、見出しの行 `div.field-head` に入れ、extras を後ろに並べる）、**`panelItem(caption, control, { tag, hidden, className }) → .panel-item`**（2 段目の欄。前の画面ごとの `panelItem`〔`.ideal-panel-item`・`.owned-panel-item`〕を 1 つにして名前を `.panel-item` にした）、**`panelLine(...items) → div.panel-line`**（2 段目の 1 行）。
    - **共通の CSS（`:is(.ideal-panel, .owned-panel)`）**: 見出しは 11px・太字・字間 .04em・on-surface-variant（値〔入力・押しボタン・チップの文字〕より小さく色を落とす）。1 段目の見出しの行は高さ 24px（中の押しボタンは高さ 24px・12px に詰める）、見出しと入力の間は 2 → 3px。2 段目は `div.ideal-panel-sub`／`div.owned-panel-sub` の中に `.panel-line` を縦に並べ（間 5px）、行の中の 2 つ目からの欄の左に**縦の区切り線**（背景の 1px × 18px。outline の色。要素を足さない）と左右 9px・10px の間。各行の先頭の見出しは `min-width: 3.3em`（所持者・場所・ケーキで入力の左端がそろう）。
    - **理想個体の形**: パッシブの条件（全部持つ／だけ）を**欲しいパッシブの見出しの行**へ移した（前は 2 段目の「条件」で、何の条件か分かりにくかった）。2 段目は 1 行目 [所持者][個体値（以上）]、2 行目 [ケーキ] と右端の所持の状況。所持の状況 `a.ideal-holding` は幅を 17em 固定から最大 17em にし、数があるとき（href があるとき）は所持パルの結果の行と同じ薄い primary の地（`--result-bar`）・太字（結果だと分かるように。後ろに欄がないので幅が変わっても折り返しは動かない）。保存の板の「名前」の見出しも同じ 11px になった。
    - **高さ（ヘッドレスの Chromium・ライト/ダーク同じ。`shots/owned/feedback/panels.js`）**: 1100px・パッシブ 0 個で **140.39 → 150.5px**（目安 155px 以内。見出しの行が 14.4 → 24px になった分）、パッシブ 4 個（ダイヤモンドボディを含む）で 177.39 → 187px。1280px も 150.5・187px。**920px は 163.98 → 150.5px**（2 段目が 3 行 → 2 行。「条件」が 1 段目へ移ったため）、4 個で 239 → 225px。どの幅も横のはみ出しなし。2 段目の 1 行目の余りは 1100px で 240px。
    - 採らなかった案: 1 段目と 2 段目の間の横の区切り線（+6px で目安 155px を超える）、ケーキを 1 行目へ（所持者・個体値・ケーキで 1100px の本文に入らない）。
    - テスト（ideal-view.test.js のパネルのテスト）: パッシブの条件が見出しの行 `.field-head` にあること、2 段目が 2 つの `.panel-line`（[所持者][個体値（以上）]／[ケーキ][所持の状況]）で「条件」の見出しがないこと。変える前のコードで落ちることを確かめた。
15. **2026-10-14 のユーザーのフィードバック（ブランチ `fix/feedback2-owned`。D29。所持パルで指摘した内容が理想個体にも当たる分。細部は担当が決めた）**:
    - データ元の 1 行をパネルの下から外した（owned-status の記録 17）。子の並びは「見出し → パネル → 要約 → 足りないパッシブ → 帯 → 詳細 → 結果」。
    - **所持者**: 所持パルと同じ `holderChoices`（すべて・自分のプレイヤー名〔「Alice（自分）」〕・ほかのプレイヤー）と、既定の `HOLDER_DEFAULT`（`'mine'`）・`holderValue`（views/shared.js。owned-toolbar の記録 21）。`IDEAL_MEMORY.holder` は無い・形の合わない値を `'mine'` にし、作ったときの条件の既定も `holder: 'mine'`。選択（select の値）・パッシブの所持数（`ofHolder`）・所持の状況とそのリンクの `holder`（自分なら `holder=mine`、「すべて」なら付けない）・要約（`holderName`）・計算の署名・配合牧場の基準の鍵（`memoryId`）・空き牧場の判定（`plan.holder`）は、画面の値 `holderNow()` を使う。**既定では親の候補も配合牧場の判定も自分の個体で行う**（空き牧場の案内は所持者が「すべて」のときだけなので、既定では出ない）。選んでいたプレイヤーがいなくなったら、`''` ではなく既定（自分）に戻す。
    - 自分が分からないときは「すべて」で計算するので、`noPairs` の「セーブのどのプレイヤーが自分か分かりません。設定タブの「登録者の対応」で選ぶか、所持者を「すべて」にしてください。」はなくした（届かない）。
    - **要約の所持者**: 前は自分の個体のとき「自分の個体」、プレイヤーのとき「Alice の個体」だった。自分も選択肢の名前「Alice（自分）」になったので、どの所持者も「〈名前〉 の個体」にした（例「上位 4 組（全 20 組・候補 11 体） · 登録済みの配合 1 件 · Alice（自分） の個体」。既定で自分なので、ふだんから要約の最後に付く。要約の文の形は理想個体の結果の表示の担当が後で見直す）。
    - **自分が後から分かったとき**: `context.store` の購読で、自分のプレイヤーの並び（`selfKey()`）が選択肢を作ったとき（`shownSelf`）と変わったら `update()`（watchView は記録の変更番号が変わったときだけ描くので、別に見る）。
    - 画面（`Claude outputs/ui-audit-2026-10/shots/owned/feedback2/ideal-route.js`。アヌビス・1100／920px・ライト／ダーク）: 所持者「Alice（自分）」、所持の状況のリンク `#/owned?pal=Anubis&holder=mine&place=…`、`--panel-h` 150.5px・要約の top 282.5px・牧場の帯の sticky の top 206.5px（下までスクロールしてパネルの下端と帯の上端がどちらも 206.5px）。横のはみ出しなし。
    - テスト（ideal-view.test.js）: 選択肢と既定・前の保存の自分の `player:<uid>`・いなくなったら既定・自分が分からないときは「すべて」で組が出る・自分が後から分かったとき・所持の状況のリンクの `holder`・要約の「Alice（自分） の個体」・データ元の 1 行がない。変える前のコードで落ちることを確かめた。app.test.js の戻る・進むと読み込み直しのテストは、所持パルのデータがなく自分が分からない（自分の選択肢が出ない）ので、所持者を「すべて」で確かめる形にした。

16. **2026-10-14 のユーザーのフィードバック（ブランチ `fix/feedback2-ideal`。D30。理想個体の分。細部は担当が決めた）**:
    - **計算のしくみの「?」とダイアログをなくした**（ユーザーの原文「計算の仕組みの説明は不要。」）。見出しの右は「目標（N）」だけ。消したもの: views/ideal.js の `helpButton`・`openHelp`・`helpModal`・`HELP_SECTIONS`・`helpSections`、CSS の `.view-help-button`・`.ideal-help-dialog`・`.ideal-help`。上の 6 の「計算のしくみは結果の下から外し、「?」で…」と ideal-results の記録 5 の形は、もうない。
      **INV-2 の判断**: ideal-results の文書は「INV-2 の例外 (b) の説明の一文「異種の親は登録済みの配合だけを使います」を、ダイアログに必ず残す」と決めていた。ユーザーの判断で説明ごとなくした（2026-10-14）。INV-2 そのもの（配合の候補は登録済みの記録だけ・配合表を読めるのは auto-register.js だけ・`core/ideal.js` を import できるのは `views/ideal.js` だけ）は、コード（core/ideal.js の `breedingLayouts` が index の記録だけを引く）と `test/import.test.js`・`test/static/security.test.js` で守られたまま。画面にその説明が出ないだけ。
    - **子の並び**: 「見出し → パネル → 足りないパッシブ → 帯 → 詳細 → 結果」（要約の行を外した。ideal-results の 15）。
    - **ケーキの「最速」の印（ユーザーの原文「ケーキ以外の条件を入れたら、どのケーキだと最速で作成できるかも提案してほしい。」）**:
      - 部品: `segmented` に **`badge(value, { text, note })`** を足した（ui/segmented.js）。value の押しボタンに `span.segmented-badge`（aria-hidden）と `span.visually-hidden`「（text）」を足し、title に note を 1 行足す（ほかの押しボタンの印は外す。null・知らない値なら外すだけ。同じ指定なら作り直さない）。読み上げの名前は「キノコ等（最速）」。押しボタンの選び方・キー操作は変えていない。
      - 見せ方: いちばん早いケーキの押しボタンの右上の角に、9px・primary の地の「最速」を重ねる（`.segmented-badge`: absolute・top -5px・right -3px・line-height 11px。`.segmented-option` に position: relative）。title の 2 行目は「この条件でいちばん早く完成できるケーキ（押すと切り替えます）」（`CAKE_NOTE`）。今の選択が最速のときも、その押しボタンに印を出す。
      - 決めた理由: 押しボタンそのものに印を付ければ、押すだけでそのケーキに切り替わり（「押すだけで切り替えられる」）、文を 1 つも足さない（ユーザーの「不要な表示を減らしたい」）。ボタンの中に並べるとボタンの幅が変わって右の押しボタンが動くので、角に重ねた。今の選択が最速のときも出すのは、比べ終えたことと今のままでよいことが分かるため（出さないと、切り替えたとたんに印が消えて、提案がどこへ行ったか分からない）。数値（どれだけ早いか）は (1) の判断に合わせて出さない。作れないケーキに印（「作れない」）は付けない（表示を減らす。押せば結果の欄に理由が出る）。
      - 位置（1100px・ライト。`shots/owned/feedback2-ideal/badge-rect.js`）: 印 245.5〜272.23 × 227.5〜238.5、押しボタン「キノコ等」の上端 231.5、文字の上端 240.42、所持者の欄の下端 226.5（どちらにも重ならない。間 1px・1.9px）。押しボタンの幅と left は印があってもなくても同じ（なし 42.31／キノコ等 65.63／スペシャル 77.72・left 162.3／204.61／270.23）。パネルの高さは 1100・920px とも、パッシブ 0 個で 150.5px・4 個（改行）で 187px（D28・D29 と同じ）。
      - 計算は views/ideal.js（下の ideal-results の 15 の「ケーキの提案の計算」）。

---

## ideal-results: 要約・数値・説明を短くそろえ、組の親で達否を見せる

### 目的
理想個体の結果の上の要約（最大 8 項目）を短いチップにし、「20 秒ごと」を実際の確認時刻に変える。1,684 字の「計算のしくみ」を「?」のダイアログに移す。組の数値の言い方を「完成まで 平均 約 N 個」にそろえ、組の ♂♀ 行で欲しいパッシブと個体値の目標との差が一目で分かるようにする。

### 経緯
- 別プランの **F038・F039**（計算のしくみを「?」→ダイアログ 4 見出し各 2〜3 文、要約は「上位 2 組（全 6 組・候補 5 体）」＋除外のチップ、「最終確認 HH:MM」は右端）・**F042**（組の ♂♀ 行で欲しいパッシブは ✓ つき・余計は薄く、個体値は目標以上を太字・未満は差を薄く。`ownedRow` に `highlight`）。
- 本セッションの案: **I-12**（「20 秒ごとに確認」→最終確認の時刻とセーブの時刻）・**I-13**（要約を短く。判断: 除外は 1 項目にまとめて内訳は別に。プランではチップ＋共通の説明部品）・**I-14**（事実確認: :165 の交換の決め方と :166 の「変更あり」の消える条件は、ほかに説明がないので削らずに残す）・**I-37**（同じ見込みの個体値厳選組を畳む。判断: 牧場に置く K 組と先頭の 1 組は残し、番号は振り直さない、理由を 1 行添える）・**I-38**（同じ量を 4 通りに書いているのをそろえ、「世代を重ねて」をやめる）・**I-39**（「多くても」→「平均の上限」）・**I-40**（組の種類のタグに色とアイコン。判断: ランク枠の png は使わない）・**I-54**（「配合では作れません」の文とボタンの食い違い）・**I-55**（判断: 結果欄の文言だけ整える）・**G-56**（共通の「?」の説明部品）。
- **G-56 の判断との違い**: 判断は「トップレイヤーの popover は位置合わせの費用が隠れているので、行内に展開する」だった。フェーズ 1a の popovers で `ui/popover.js`（固定配置の計算）ができるので位置合わせの費用はなくなり、行内に展開すると sticky パネルや結果が動いてしまう（このフェーズの目的に反する）。そこで**説明部品は `ui/popover.js` の上に作り、クリック／Enter で開く**（統合プランの ideal-results の「共通の説明部品（クリック／Enter で開く。一致の理由・除外の内訳にも使う。G-56）」と、別プラン §9 の「一致理由・除外内訳・計算説明はクリック／Enter で開ける共通説明部品（バッチ 1 で用意）」に合わせる）。
- INV-2 の例外 (b)（理想個体の確率計算だけ遺伝の仕組みを使う）の一文「異種の親は登録済みの配合だけを使います」はダイアログに必ず残す。
- **ideal-calc の後**（2026-10-12 追記）: 組の定義（同じ種族で両親合わせて欲しいパッシブがそろう組も完全体作成組）と、配合牧場・「変更あり」の決め方（全体の速さの目安 R・交換推奨の行き先だけ）が変わった。ダイアログとタグの説明（手順 5・6）は ideal-calc で直した文（phase-1-0-ideal-calc.md の手順 6）に合わせて書き直した。上から K 組が牧場に置く組とは限らないので、I-37 の「牧場に置く K 組は畳まない」は外した（手順 7）。

### 依存
ideal-panel（要約の行の場所・見出しの「?」の置き場）、popovers（`ui/popover.js`）、stable-render（結果の差分更新。カードの `data-key`）、ideal-calc（説明の文・組の定義）。（追記 2026-10-13: ideal-panel で、要約の行は `p.result-note.ideal-note`〔1 行固定〕、「?」は見出しの `button.view-help-button` で、計算のしくみは今の 14 項目のまま `openHelp()` のダイアログに移してある。ideal-panel の「実装の記録」5・6）

追記（2026-10-12、ideal-calc の実装）: 組のカードの ambiguous の注記は「同じ組み合わせで別の子も登録されています。どちらかの登録が間違っている可能性があります。確率は目標のパルが産まれた場合のものです。」になった（D19）。説明の :165 も、補助の判定の言い回しと D19 の一文を足した（phase-1-0-ideal-calc.md の「実装の記録」の 4・5）。「?」のダイアログに移すときは、この文を使う。

### このテーマでやらないこと
- 計算そのもの（core/ideal.js の確率・並び）の変更。子の性別比（判断事項 4）。キノコケーキで届くかの 3 段階の色。
- 「登録者の対応」の案内（views/ideal.js:143・:374。participant-self）。
- 牧場の行・カードの「配置中」以外の牧場の札（ideal-farms）。所持パルの行の 4 セル化（owned-rows。このテーマでは強調に必要な最小の形にする）。
- 説明部品を理想個体以外（継承ルートの説明・設定など）に広げること（使い心地を見てから）。

### 現状
- 要約: `summaryText`（web/js/views/ideal.js:436-451）が件数・候補・所持者・配合・性別不明・パッシブ 5 個以上・除外・`REFRESH_NOTE`（:21「20 秒ごとに確認」）の最大 8 項目を ' · ' でつなぎ、:473 で `note.textContent` に入れる。
- 数値の言い方: `eggsText`（:51-58。「平均 約 N 個に 1 個」）、`generationsText`（:64-68。「世代を重ねて 平均 約 N 個（多くても約 M 個）」）、`pairMeasure`（:82-100。個体値厳選組は「世代を重ねて」を「個体値がそろうまで」に置き換え :90、完全体作成組の 2 行目は「この 2 体のままなら 約 N 個に 1 個」:96）。
- タグ: `pairCard`（:102-126）の `.ideal-tier`（:108）・「変更あり」（:109）・「◯◯に配置中」（:110）。CSS は app.css:1042-1046 で、個体値厳選組（`group-talent`）にだけ色の規則がない。
- 説明: `explanation()`（:151-173）が 14 項目の details を結果の下に置く（:160・:161・:162・:165・:166 の文は ideal-calc で直っている）。
- 欲しいパッシブが候補にないとき: `renderMissing`（:387-395）が「…を持つ個体が候補にいないため、配合では作れません。…足りないパッシブは別に手に入れてください。」（:391）と「〇〇を運ぶ経路」のボタン（:393）を並べる。
- 候補なし: `noPairs`（:371-383）。:375「（パル名）（と登録済みの配合の親）を、オスとメスで所持していません。」、:378 スペシャルケーキの 85 字の文、:379「♂ と ♀」、:380「オスとメスの組を作れる個体がいません。」。
- 組の親: `pairCard` は `ownedRow(pair.male)`・`ownedRow(pair.female)`（:123）をそのまま使い、目標との比較はない。`ownedRow`（web/js/views/owned.js:51-69）は `notes` しか受け取らず、個体値は 1 つの文字列（:17-19 `talentText`、:67）。
- 更新: 開いている間 20.5 秒ごとに `owned.autoRefresh()`（:518-525）。確認した時刻はどこにも残していない。セーブの時刻は `owned.state.meta.saveUpdatedAt`（web/js/owned.js:226 付近の recompute）にある。

### 実装の手順
1. **共通の説明部品**（新規 `web/js/ui/hint.js`）:

   ```js
   /**
    * 押すと説明の小さな板を開くボタン（クリック・Enter・Space で開閉、Esc と外側のクリックで閉じてボタンにフォーカスを戻す）。
    * trigger を渡すと、その要素（タグなど）を開くボタンとして使う。content は文字列か、板の中身を作る関数（textContent だけで組む）。
    */
   export function hint({ label, content, trigger }) → { element, destroy() }
   ```
   - ボタンは `button.hint-button`（既定は「?」・16px の丸）。`aria-label="${label}の説明"`・`aria-expanded`・`aria-controls`。板は `ui/popover.js` で固定配置（ボタンの下、はみ出すなら上）。板は 1 度に 1 つ（ほかが開いたら閉じる）。
   - 板を開いても周りの要素は動かない（固定配置）。20 秒ごとの再描画でボタンが作り直されたら板も閉じる（destroy）。
2. **要約の行**（`summaryText` を `renderSummary(result)` に変える。`note` は `div.ideal-summary` にし、中を固定の 3 つの子にする）:
   - `span.ideal-summary-text`: `上位 ${pairs.length} 組（全 ${total} 組・候補 ${candidates} 体）` ＋ ` · 登録済みの配合 ${n} 件`（異種の配合がなければ ` · 同じ種族どうし`）＋ 所持者で絞っていれば ` · ${holderName()} の個体`。
   - `button.ideal-excluded`（除外があるときだけ。ないときは `hidden` ではなく `visibility: hidden` で幅を残す）: 「除外 ${unknownGender + tooMany + blocked}」。`hint({ label: '除外', trigger })` の中身は 1 行ずつ「性別不明の n 体」「パッシブが 5 個以上の n 体（入れ替えの計算から除外）」「パッシブの条件を満たせない n 組」。
   - `span.ideal-checked`（右端・小さく）: `最終確認 ${formatTime(lastChecked)} · セーブ ${dateTime(meta.saveUpdatedAt)}`（formatTime は web/js/ui/dom.js、dateTime は web/js/ui/owned-status.js）。owned-status のテーマで、データ元の 1 行（ワールド・取得元・セーブ時刻）を要約の上に出すので、そのときに「セーブ …」の部分はそちらに任せて外す。
   - 1 行固定（ideal-panel で付けた CSS）。全文は `title`。
3. **確認した時刻**: `refresh`（:519-522）を `owned.autoRefresh().then(() => { lastChecked = Date.now(); renderChecked(); })` にし、`renderChecked` は `span.ideal-checked` の文字だけを書き換える（結果を作り直さない）。画面を開いた直後（`owned.load().then(refresh)`）も同じ。`REFRESH_NOTE` は消す。
4. **数値の言い方をそろえる**（I-38・I-39）:
   - `eggsText(rate)`: 「この組では届きません」／「ほぼ毎回」／「平均 100 万個以上」／`平均 約 ${n} 個`（「に 1 個」をやめる）。
   - `generationsText(eggs, upper)`: `完成まで 平均 約 N 個` ＋ 上限があれば `（平均の上限 約 M 個）`。
   - `pairMeasure`:
     - 完全体作成組（世代の平均あり）: 太字 `完成まで 平均 約 N 個（…）`、小さい字 `子と入れ替えながら · この 2 体のままなら 約 M 個 · 1 個のタマゴで X% · キノコケーキは目安`（届かないときは「この 2 体のままでは届きません」）。
     - 完全体作成組（1 回で作れる組）: 太字 `完成まで ${eggsText(chance)}`、小さい字 `1 個のタマゴで X% · パッシブ X% × 個体値 Y%`。
     - パッシブ厳選組: 太字 `${what}まで ${eggsText(gatherChance)}`（what は「欲しいパッシブが全部そろう」「欲しいパッシブ n 個のうち m 個がそろう」）、小さい字 `1 個のタマゴで X% · 個体値は見ていません`。
     - 個体値厳選組: 太字 `個体値がそろうまで 平均 約 N 個（…）`（世代の平均がなければ `個体値がそろうまで ${eggsText(talentChance)}`）、小さい字 `1 個のタマゴで X% · パッシブは見ていません · キノコケーキは目安`。
5. **計算のしくみ → 「?」のダイアログ**（I-14・F038）: `explanation()` を消し、見出しの「?」（ideal-panel の置き場）を `openDialog('計算のしくみ')` にする。中身は次の 4 見出し（h3 と p。文はこのまま使ってよい）:
   - **並び方と組の種類**（ideal-calc の後の文）: 「配合牧場に上から置く順に、別々の個体で最大 20 組を並べます。同じ個体は 2 回使いません。牧場には、配合牧場の判定で交換を勧めた組を置いてください（上から K 組が、いつも最終の配置とは限りません）。」「「完全体作成組」は欲しいパッシブと個体値の目標を全部満たす子を作れる組です。2 体で欲しいパッシブがそろい、目標のある各ステータスに目標以上の親がいて 1 回で作れる組（種族は問わない）と、同じ種族で両親合わせて欲しいパッシブがそろい、産まれた子と入れ替えながら作る組（どちらの親が持っていても同じ。欲しい以外のパッシブが少ないほど早い）です。「パッシブ厳選組」は完全体作成組に当たらず、両親を合わせると片親だけより多く欲しいパッシブが集まる組（途中まで集める組や、異なる種族の組も含む）、「個体値厳選組」はパッシブを見ずに個体値をそろえる組です。」「異種の親は登録済みの配合だけを使います。タマゴとグローバルパルボックスの個体は親にしません。」
   - **数字の意味**: 「「完成まで 平均 約 N 個」は、完成品が産まれるまでに産ませるタマゴの平均です。同じ種族の組は、産まれた子を親と入れ替えながら続けた場合の平均です。」「ランダムに付くパッシブで偶然そろう分は数えないので、実際より少し多めに出ます。突然変異とアルファの子は数えません。」「Palworld v1.0.5 のゲームの仕組み（パッシブは両親の分から 1〜4 個、個体値は親から写るか 0〜100 の乱数）で計算しています。」
   - **ケーキ**: 「キノコケーキ・豪華野菜ケーキは個体値に +1〜5 するため目安で並べ、目安と離れるときは「平均の上限」を添えます。」「スペシャルケーキは両親のパッシブから 4 個まで継ぎ、足りない枠はランダムで埋まります。そのため欲しいパッシブが 4 個未満の「欲しいものだけ」は作れません。」
   - **配合牧場と「変更あり」**（ideal-calc の後の文）: 「入れ替えると、牧場全体の完成の速さの目安（各牧場の 1÷完成までの平均 の合計。完全体作成組以外は 1 個のタマゴで完成する確率）が上がるときだけ交換を勧めます。上がらなければ「そのまま」です。どの牧場もまだ完成できない（準備の組だけの）ときは、どの牧場も悪くならず、1 か所以上が良くなるときだけ勧めます。親の片方が同じ組を優先し、1 体の入れ替えで済むようにします。」「「変更あり」は、交換推奨の行き先の組のうち、牧場の中身が最後に変わったときにはなかった組に付き、牧場の親を入れ替えたとセーブから分かると消えます。」「開いている間はセーブ（参加している人はホストの共有）を確かめ直し、受け取ったパルも入れて並べ直します。」（ideal-farms で、保留中は「変更あり」が付かないこと（D13）を 1 文足す）
6. **タグに説明と色・アイコン**（I-40・G-56 に吸収した I-15）:
   - `.ideal-tier` を `button` にして `hint({ label: GROUP_LABELS[group], trigger: tag, content })`。説明（ideal-calc の後の定義）: 完全体作成組「この 2 体（子と入れ替えながらを含む）で、欲しいパッシブと個体値の目標を全部満たす子を狙える組です。同じ種族なら、両親合わせて欲しいパッシブがそろえば入ります。」、パッシブ厳選組「完全体作成組に当たらず、両親を合わせると欲しいパッシブが片親より多く集まる組です。個体値は見ません。」、個体値厳選組「パッシブは見ずに、個体値の目標をそろえる組です。」、変更あり「交換推奨の行き先の組のうち、牧場の中身が最後に変わったときにはなかった組です。」、配置中「セーブで、この組がその牧場に入っていると分かった組です。」。
   - アイコン（12px のインライン SVG を `createElementNS` で作る。王冠＝完全体作成組、2 つの輪がつながる形＝パッシブ厳選組、3 本のバー＝個体値厳選組）。作る関数は views/ideal.js の中に置く（フェーズ 1d の visual-parts で `ui/icons.js` に移す）。
   - CSS: `.ideal-tier.group-talent { background: var(--md-sys-color-secondary-container); color: var(--md-sys-color-on-secondary-container); }`。「変更あり」の 1 回だけの拡大は `@media (prefers-reduced-motion: no-preference)`（app.css:756）の中に書く。
7. **同じ見込みの組を畳む**（I-37）: 結果を並べるとき、個体値厳選組（`group === 'talent'`）が続き、見込み（`talentGenerations` があればそれ、なければ `talentChance`）が同じ組の 2 組目以降を `details.ideal-same`（summary「同じ見込みの組 ほか n 組」）の中に入れる。ただし (a) 牧場の判定が指している組（keep の rank・swap の to。ideal-farms の前は今の `renderFarms` に渡す判定）、(b) 同じ並びの先頭の 1 組、は畳まない（2026-10-12: ideal-calc の後は上から K 組が牧場に置く組とは限らないので、もとの (a)「牧場に置く上から K 組」は外した。D14 と同じ理由）。番号（`step-number`）は振り直さない。summary の下に理由を 1 行: 候補のどの個体も目標に届かないステータスがあれば「攻撃 100 以上の親が候補にいないため、どの組も同じ見込みです。」（キノコケーキのときは目標 −5 で判定）、それ以外は「どの組も見込みが同じです。」。畳んだカードも DOM に残す（テストの `cards(view)` が `.ideal-pair` を数えるため）。開閉は viewState に残す。
8. **欲しいパッシブがないときの案内**（I-54）: :391 を `${names} を持つ親の候補がいません。` ＋（組があれば）`いまは個体値厳選組だけを出しています。` に、:393 のボタン名を `${name}を運ぶ継承ルート` にする（「別に手に入れて」は言わない）。
9. **候補なしの文**（I-55）: :375 → `${palName(to)}の ♂ と ♀（または登録済みの配合で${palName(to)}が産まれる親の組）を所持していません。`、:378 → 「スペシャルケーキでは、欲しいパッシブが 4 個未満だと「欲しいものだけ」の子は産まれません。」、:380 → 「♂ と ♀ の組を作れる個体がいません。」。:374 は participant-self が直すので触らない。
10. **組の ♂♀ 行の強調**（F042）: `ownedRow(pal, { notes, highlight })` に `highlight: { wanted: string[], targets: { hp, shot, defense } }` を足す（web/js/views/owned.js:51）。
    - パッシブ: `wanted` に入っているチップに `.is-wanted` と先頭の「✓」（`span.passive-check`。aria-label「欲しいパッシブ」）、入っていないチップに `.is-extra`（opacity .55）。
    - 個体値: owned-rows で 4 セルになるまでの間、`.owned-talent` の中を `span.talent-cell[data-key]` ×3 にする（区切りの「 / 」は文字のノードで残す。highlight がないときの textContent は今と同じ「HP 70 / 攻 100 / 防 64」になり、所持パルのテストは変わらない）。highlight があるとき: 目標 > 0 で値 ≥ 目標なら `.met`（primary・太字）、値 < 目標なら `.short` と後ろに `span.talent-diff`「−20」（muted）。目標 0 は何もしない。セルの aria-label「攻撃 80（目標 100 まで あと 20）」。
    - `pairCard` は `ownedRow(pair.male, { highlight: { wanted: passives, targets: conditions.targets } })`（:123）。
11. 要約・タグの説明・強調は、20 秒ごとの再計算で結果が同じなら描き直さない（stable-render の署名）。

### 触るファイル
- 新規: `web/js/ui/hint.js`、`test/web/hint.test.js`
- 変更: `web/js/views/ideal.js`（:21・:51-126・:151-173・:355・:371-395・:436-451・:473・:490-493・:518-525）、`web/js/views/owned.js`（:17-19・:51-69 の highlight）、`web/css/app.css`（:1042-1046・:1070-1071 を消す・新しい規則）、`web/js/release-notes.js`

### テスト
- **追加** `test/web/hint.test.js`: クリックで aria-expanded が true になり板が出る、Esc で閉じてボタンにフォーカスが戻る、ほかの hint を開くと前のが閉じる、destroy で板が消える。
- **追加**（ideal-view.test.js）: (1) 要約が「上位 1 組（全 2 組・候補 3 体） · 同じ種族どうし」で、除外のボタンが「除外 1」、押すと「性別不明の 1 体」が出る。(2) 20 秒ごとの確認の後に「最終確認」の時刻が変わり、カードの要素は作り直されない。(3) 同じ見込みの個体値厳選組が畳まれ、先頭の 1 組と牧場の判定が指す組は外に残る（上から K 組でも、判定が指していなければ畳まれる）。(4) 組の行で欲しいパッシブに ✓、目標未満の個体値に差が出る。(5) 「?」でダイアログが開き、「異種の親は登録済みの配合だけを使います」を含む。
- **期待値が変わる既存のテスト**:
  - `test/web/ideal-view.test.js:74`（要約の完全一致）→ `.ideal-summary-text` の新しい文に。
  - `:77`（`.ideal-help` の「計算のしくみ」）→「?」ボタンの aria-label「計算のしくみの説明」とダイアログの中身に。
  - `:72`（/平均 約 6 個に 1 個 · パッシブ 60% × 個体値 28%/）→ 太字「完成まで 平均 約 6 個」・小さい字「1 個のタマゴで … · パッシブ 60% × 個体値 28%」。
  - `:98`・`:244`（/世代を重ねて 平均/）→ /完成まで 平均/。`:198-200`（eggsText の期待値 3 件。「に 1 個」をなくす）。`:249` のコメントと「多くても」→「平均の上限」。
  - `:59`・`:97`・`:106`・`:312-321`（`talentsOf` が `.owned-talent` の textContent を比べる）: highlight で「−20」が入るカードがあれば期待値を直す（差のある組だけ）。owned-rows で 4 セルにするときに、`talentsOf` を aria-label で読む形に直す。
  - `:528-534`（牧場の文）は ideal-farms で直す。

### INV-2・互換・セキュリティ・性能の注意
- ダイアログの「異種の親は登録済みの配合だけを使います」を残す（INV-2 の例外 b の説明）。数値は idealPlan の結果だけで、配合表は使わない。
- `ui/hint.js` は textContent だけで中身を作る（content に HTML の文字列を受けない）。SVG のアイコンは `createElementNS`。
- 「最終確認」の書き換えは文字のノードだけ（20 秒ごとに結果を作り直さない）。畳む判定は表示する最大 20 組だけで行い、計算を増やさない。

### release-notes の案
- id: `<実装日>-ideal-results`
- title: 「理想個体の表示を短く」（10 字）
- body: 「要約と数値の言い方をそろえ、説明は「?」から開きます。組の親で欲しいパッシブと個体値の差を示します。」（50 字）

### 完了の条件
- [x] `npm test` が通る。（1,290 件・exit 0）
- [x] 要約が 1 行に収まり、条件を変えても要約の行の高さが変わらない（下の牧場・結果が動かない）。（1100px で高さ 18.6px・top 272.4 のまま。920px でも 1 行。牧場の欄は判定の中身で伸び縮みする〔ideal-farms〕。「実装の記録」10）
- [x] 「計算のしくみ」が結果の下から消え、「?」から 4 見出しのダイアログで読める。INV-2 の例外の一文と「変更あり」の消える条件・交換の決め方が残っている。
- [x] 組の数値がすべて「…まで 平均 約 N 個」の形で、「世代を重ねて」「に 1 個」「多くても」が画面に出ない。
- [x] 組の ♂♀ 行で、欲しいパッシブに ✓、余計なパッシブが薄く、目標未満の個体値に差（−N）が出る。（差は値の下に小さく出す。「実装の記録」9）
- [x] 45 秒開いたままでも（20 秒の確認を 2 回またいでも）、カードの DOM が作り直されず、最終確認の時刻だけが変わる（MutationObserver で確かめる）。
- [x] 説明の板を開いても、周りの要素の位置が変わらない。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 計算のしくみのダイアログに例外 (b) の一文が残り、数値は idealPlan の結果だけ。`ui/hint.js` は `core/ideal.js` を import しない（`test/import.test.js`）。セキュリティ — `ui/hint.js` は HTML の文字列を受けず textContent だけで作る（`test/static/security.test.js`）。性能 — 20 秒ごとの確認でカードを作り直さない（上の MutationObserver の確認）。互換 — 保存するデータは増えていない。（同じ見込みの組の開閉は viewState の中だけで、IDEAL_MEMORY・localStorage には足していない）

### TODO
- [x] `ui/hint.js` とテストを作る（popover.js の上に、開閉・Esc・1 度に 1 つ）
- [x] 要約を `.ideal-summary`（文・除外ボタン・最終確認）に組み直す
- [x] `refresh` で確認した時刻を覚え、時刻の文字だけを書き換える
- [x] `eggsText`・`generationsText`・`pairMeasure` の言い方をそろえる
- [x] `explanation()` を消し、「?」→ 4 見出しのダイアログにする
- [x] タグを説明つきのボタンにし、色とアイコンを付ける
- [x] 同じ見込みの個体値厳選組を畳む（判定が指す組・先頭は残す）
- [x] `renderMissing` と `noPairs` の文言を直す（:374 は触らない）
- [x] `ownedRow` に `highlight` を足し、`pairCard` から渡す
- [x] ideal-view.test.js の文言の期待値を直し、新しいテストを足す
- [x] release-notes に 1 件足し、モックで確かめる

### 実装の記録（2026-10-13、ブランチ `feature/ideal-results`）

実装のときに決めたこと・文書と違う形にしたこと（後のテーマ ideal-farms・owned-status・owned-rows はこちらを正とする）。

1. **説明部品 `ui/hint.js`（手順 1）**: `hint({ label, content, trigger })` → `{ element, close(), destroy() }`。文書の形に **`close()`** を足した（呼び出し側から開いている板を閉じる。除外が 0 になったときに使う）。板は `createPopover({ anchor: ボタン, wrapper: ボタン, host: document.body, className: 'picker-popover hint-popover', place: { minWidth: 280, maxHeight: 320 } })`（`picker-popover-floating` の固定配置。ボタンの下、下に 200px 足りず上が広ければ上）で、`role="status"`（開いてから中身を入れるので読み上げられる）。content は文字列（`p.hint-text` にする）・要素・その配列、またはそれを返す関数（開くたびに呼ぶ）。trigger を渡すと、その要素に `.hint-trigger` を付けて開くボタンにし、**aria-label は付けない**（見えている文が名前。「除外 3」の数を名前から消さないため）。渡さないと `button.hint-button`「?」（aria-label「〈label〉の説明」）。板は 1 度に 1 つ（開いている部品をモジュールの中で覚え、ほかが開いたら閉じる）。Esc で閉じてボタンへフォーカスを戻す。**外側を押して閉じたときは戻さない**（文書は「Esc と外側のクリックで閉じてボタンにフォーカスを戻す」。ui/popover.js の決まり〔外側の pointerdown では押した先に任せる〕に合わせた。押した先が入力欄などのときにフォーカスを奪わないため）。浮かせた板なので、外でのホイール・タッチのスクロールと窓の大きさの変更でも閉じる（popover.js のまま）。CSS は `.hint-button`（16px の丸）・`.hint-popover`。
2. **要約の行（手順 2）**: `p.result-note.ideal-note` を **`div.result-note.ideal-summary`** にし、1 行に固定する CSS は `.ideal-summary` に移した（flex・`height: 1lh`。`.ideal-note` は消した）。中は固定の 3 つの子で、作り直さず文字だけ書き換える:
   - `span.ideal-summary-text`: `summaryLine(result)`「上位 N 組（全 M 組・候補 K 体） · 登録済みの配合 n 件（異種の配合がなければ 同じ種族どうし） · Alice の個体」。省略記号で、title に全文。所持者の部分は文書の「` · ${holderName()} の個体`」だと自分の個体のとき「自分の個体 の個体」になるので、**自分の個体は「 · 自分の個体」** にした。結果がないとき（目標なし・データなし・初めての計算中）は空、組が 0 のときも「上位 0 組（全 0 組・候補 N 体）」のまま出す（理由は結果の欄の文）。
   - `button.ideal-excluded`（`hint` の trigger）: 「除外 N」（N＝unknownGender＋tooMany＋blocked）。押すと内訳（「性別不明の n 体」「パッシブが 5 個以上の n 体（入れ替えの計算から除外）」「パッシブの条件を満たせない n 組」の 0 でないもの）。0 のときは `.is-placeholder`（visibility: hidden）と disabled で幅を残し、開いていた板は閉じる。
   - `span.ideal-checked`（右端・11px）: 下の 3。
   - 書き換えは `renderSummary(result)`（null で空にする）と `renderChecked()`。ideal-panel の `showNote` はなくした。
3. **最終確認（手順 3）**: `refresh` を async にし、`await owned.autoRefresh()` の結果が `'error'`（読めなかった）でなければ `lastChecked = Date.now()` → **`renderChecked()`**（文書の `.then(…)` から、読めなかった確認では時刻を進めない形にした）。文は「最終確認 時:分（`formatTime`） · セーブ 月/日 時:分（`dateTime(owned.state.meta.saveUpdatedAt)`）」。確かめる前は「最終確認 —」、セーブの時刻がなければ前半だけ、`context.owned` のない画面では空。`update()`（所持パルのデータが変わったとき）でも呼ぶ（セーブの時刻を追う）。時:分なので、同じ分の中の確認では文字は変わらず書き換えもしない。**owned-status で「セーブ …」を外すときは renderChecked の 2 つ目の部分を消し、「最終確認」をスロットに任せるなら `span.ideal-checked` ごと外してよい**（要約の行の子は 2 つになる）。`REFRESH_NOTE` は消した。
4. **数値の言い方（手順 4）**: 文書のとおり。`generationsText(eggs, upper, lead = '完成まで')` に lead を足し、個体値厳選組は「個体値がそろうまで」を渡す（前の文字の置き換えをやめた）。「この 2 体のままなら 約 M 個」は eggsText から「平均 」を外した形（「ほぼ毎回」「100 万個以上」もそのまま続く）。
5. **計算のしくみ（手順 5）**: `HELP_SECTIONS`（4 見出し・各 2〜3 文）と `helpSections()` → `div.ideal-help > section.ideal-help-section > h3＋p`。ダイアログは ideal-panel の `openHelp()`（`openDialog('計算のしくみ', { className: 'ideal-help-dialog' })`。幅を 640px にした）のまま。文は文書の案に次を足し引きした: (a)「目標のある各ステータス」→「条件のある各ステータス」（talent-target で docs/OPERATIONS.md を直したのに合わせた）、(b) 配合牧場の 1 つ目の段落は ideal-calc の「実装の記録」5 の文（「入れ替えに関わる牧場がどれもまだ完成できない（準備の組だけの）ときは、それらの牧場がどれも悪くならず…」）と D19 の一文を使った、(c) 今の説明の「空いている牧場に何を置くかは、おすすめの順を見て決めてください。」は文書の案になかったので外した（ideal-farms の空き牧場の案内〔D16〕で出す）。説明の文字数は 1,684 → 1,187 字（textContent）。
6. **組の札（手順 6）**: `pairCard(pair, rank, { cake, placed, changed, highlight, hints })`。札は `button`（`.ideal-tier.group-<目的>`・`.ideal-changed`・`.ideal-placed`）で、中は（組の目的だけ）`svg.ideal-tier-icon` と文の `span`。説明の文は `TAG_HINTS`（文書の文のまま）。札は pairCard の中の **`tag(className, text, help, icon)`** で作り、作った hint は `hints` に入れる。drawPlan は `showResults(nodes, hints)` で、前のカードの hint を destroy してから結果の欄を入れ替える（作り直すと開いていた板も閉じる。画面の destroy でも閉じる）。**ideal-farms で足す札（「→ ◯◯へ」・持ち主が違う組）は `tag(…)` で足せば、説明つきのボタンになる**。アイコンは views/ideal.js の `groupIcon(group)`（`GROUP_SHAPES`・`svgNode`。createElementNS。visual-parts で ui/icons.js に移す）。個体値厳選組の色は secondary-container。「変更あり」は出たときに一度だけ 1.18 倍になって戻る（`changed-pop`。`prefers-reduced-motion: no-preference` の中）。
7. **同じ見込みの組（手順 7）**: drawPlan の **`foldSame(pairs, nodes, pointed, short)`** と `sameGroup(short)`。見込みの比べ方は `sameProspect`（どちらも個体値厳選組で、世代の平均の有無が同じで、`talentGenerations`〔なければ `talentChance`〕が有効数字 12 桁で同じ）。**`pointed`**（畳まない組）は drawPlan の `advice` から作る（swap は `to`、keep・none は `rank` ≥ 0）。**畳まない組が同じ見込みの並びの間に入ったら、まとまりを分ける**（並びを変えないため。文書は分け方を決めていなかった）。形は **`details.ideal-same > summary.ideal-same-summary`（`span.ideal-same-title`「同じ見込みの組 ほか n 組」＋`small.ideal-same-reason`）＋畳んだ `.ideal-pair`**。**理由は summary の中**に置いた（閉じていても読める。文書の「summary の下に理由を 1 行」）。理由の判定は計算のときの `plan.short`（候補〔目標の配合の種族・親になれる・性別が分かる個体〕のだれも届かないステータス。キノコケーキは目標−5）で、複数あれば「HP 100 以上・攻撃 100 以上の親が候補にいないため、…」。開閉は `memory.sameOpen`（viewState。IDEAL_MEMORY には入れないので、タブの切り替えでは残り、読み込み直すと閉じる）。開く印は ▸（所持パルの登録したワールドの折りたたみと同じ形）。文書のテスト (3) の括弧「上から K 組でも、判定が指していなければ畳まれる」は、テストのデータで作れなかった（同じ見込みの組が上から K 組に並ぶと、交換推奨か「そのまま」がその組を指すため）ので、「先頭と判定が指す組は外に残り、その次の同じ見込みの組は畳まれる」で確かめた。**ideal-farms で判定が指す組を変えるときは `pointed` を直す**。
8. **文言（手順 8・9）**: 文書のとおり。欲しいパッシブがないときは「[小さなチップ] を持つ親の候補がいません。」＋（組があれば）「いまは個体値厳選組だけを出しています。」、ボタンは「[チップ]を運ぶ継承ルート」。noPairs の登録者の対応の文（:374）は触っていない。
9. **組の ♂♀ 行の強調（手順 10）**: **`ownedRow(pal, { notes, highlight })`・`fillOwnedRow(row, pal, { notes = [], highlight } = {})`**（オプションは 1 つの object。ideal-farms の `marks`・owned-rows の 4 セルもここに足す）。中は views/owned.js の `passiveCell(ids, wanted)` と `talentCell(talent, targets)` に分けた。
   - パッシブ: wanted が 1 個以上のときだけ、欲しいチップに `.is-wanted` と先頭の `span.passive-check`「✓」（role=img・aria-label「欲しいパッシブ」）、それ以外に `.is-extra`（opacity .55）。**欲しいパッシブを選んでいないときは何も付けない**（全部が薄くなるのを避けた。文書は決めていなかった）。
   - 個体値: **targets があるときだけ** `.owned-talent` の中を `span.talent-cell[data-key][role=img]` ×3 と `span.talent-sep`「 / 」（aria-hidden）にする。文書の「区切りは文字のノードで」は、テストの偽 DOM に文字のノード（createTextNode・文字列の append）がないので span にした。**targets がないとき（所持パルの画面）は今までどおり 1 つの文**（行ごとに 5〜8 個の要素を増やさない。DOM も textContent も変わらない）。目標 > 0 で値 ≥ 目標は `.met`（primary・太字）と aria-label「攻撃 100（目標 100 以上）」、未満は `.short`（細字・on-surface-variant）と `span.talent-diff`「−20」と aria-label「攻撃 80（目標 100 まで あと 20）」、目標 0 は aria-label「防御 100」だけ。
   - **差は値の右ではなく、値の下に小さく出す**（CSS で `.talent-cell` を縦並びの inline-flex に）。右に並べると 3 つで約 230px あり、理想個体のカードの個体値の列 190px では 2 行に折り返した（アヌビス＋伝説で 18 行中 17 行）。下に出すと値の並びは 1 行のまま（折り返し 0 行）で、差のある欄の高さは 20 → 33px（行の高さはパッシブの 2 段やパルの絵で決まり、変わらない）。owned-rows で 4 セル・バーにするときに、この形も作り直す。
   - テストの `talentsOf`（`.owned-talent` の textContent）は、差の付いた分の期待値を直した（例「HP 90−10 / 攻 90−10 / 防 90−10」）。owned-rows で aria-label で比べる形にする。
10. **画面の確認（phase-1a の「計測の記録」の ideal-results の行）**: 要約の行は 1 行（1100px で 18.6px）で、個体値・キノコ等・だけ・スペシャル（除外 90）・所持者 Bob・すべて 100 と変えても top 272.4・高さとも同じ。札の説明を開いても、パネル・要約・牧場・全カードの位置と scrollY は同じ（板は札の 4px 下、body の中）。45 秒開いたまま（20 秒の確認を 2 回またぎ、分が変わる）で、`.ideal-view` の中の変化は `.ideal-checked` の文字の 1 回だけ（11:50 → 11:51）、カード 9 枚は同じ要素。ライトとダーク。
11. **テスト**: test/web/hint.test.js（5 件。部品を作る前にモジュールがなくて落ちることを確かめた）。ideal-view.test.js に 7 件（要約の 3 つの子と除外の内訳・除外 0 で幅を残す・条件を変えても子は同じ／所持者の文／20 秒の確認で最終確認だけ変わる〔`t.mock.timers` で Date も進める。読めなかった確認では変えない〕／同じ見込みの組を畳む〔先頭・判定が指す組・理由・キノコケーキの理由・viewState の開閉〕／♂♀ 行の強調と所持パルの行が変わらない／札の説明と作り直しで板が閉じる／計算のしくみの INV-2 の一文と数値の言い方）。どれも変える前のコードで落ちることを確かめた（views/ideal.js・views/owned.js だけを戻して実行）。期待値を直したもの: 要約の文と `.ideal-summary` の形、組の数値の言い方、eggsText の 4 件、計算のしくみの 4 見出し、欲しいパッシブがないとき・候補がないときの文、「〇〇を運ぶ継承ルート」、差の付いた個体値（talentsOf の 4 か所）。
12. **そのほか**: docs/OPERATIONS.md の理想個体の節（数値の言い方・札・畳み・強調・要約・最終確認・計算のしくみ）を新しい画面に合わせた（触るファイルの一覧にはなかった）。CSS は `.ideal-note` と前の `.ideal-help` を消し、`.ideal-summary`・`.ideal-excluded`・`.ideal-checked`・`.hint-button`・`.hint-popover`・札のボタン・`.ideal-tier.group-talent`・`.ideal-tier-icon`・強調（`.is-extra`・`.passive-check`・`.talent-cell`・`.talent-diff`）・`.ideal-same`・新しい `.ideal-help` を足した。計算（core/ideal.js）は変えていない。モックでは、世代の平均が出る組で「この 2 体のままでは届きません · 1 個のタマゴで 0%」と出る組がある（前から。この 2 体のまま 1 個で完成する確率が 0 の組）。
13. **フェーズ 1b・1c の終わりのレビューの直し（2026-10-13、ブランチ `fix/phase-1bc-review-ideal`。指摘 A1 のカードの分・A13・A14）**:
    - **A1 描き直しのフォーカス（カード）**: 描くたびにカードをすべて作り直す（20 秒ごとの読み直しで出す値が変わったとき・計算し直したとき）ので、札・行の部品にあったフォーカスが body に落ちていた。→ 押せる部品に `data-focus-key` を付け、**`drawPlan(result, plan, changed)` は `captureFocus(element)` → `paintPlan(result, plan, changed, focus)`（前の drawPlan の中身）→ `restoreFocus(element, focus)`** にした（ui/focus.js。フォーカスが画面の中に残っていれば何もしない）。目印: カード `card:<key>`（key は `planPairKey`）、札 `tag:<key>:<group|changed|placed|farmTo|owners>`（「変更あり」などが消えたら `data-focus-fallback` で同じ組の `tag:<key>:group`）、♂♀ 行の部品 `pair:<key>:<M|F>:<data-focus>`（`ownedRow` の `data-focus`〔名前のリンク pal・「+N」passive-more／marks-more〕から作る。「+N」が消えたら同じ行の pal）、畳みの見出し `same:<まとまりの最初の組の key>`、足りないパッシブの「を運ぶ継承ルート」`carry:<パッシブ ID>`。開いていた札の説明の板は閉じたまま（上の 6 のとおり。フォーカスだけ同じ札へ戻る）。**名前が変わったもの**: pairCard の中の `tag(kind, className, text, help, icon)`（kind を足した）、`sameGroup(short, firstKey)`、drawPlan の中身は `paintPlan`。
    - **A14 SVG と静的検査**: 組の目的のアイコンの `svgNode`（views/ideal.js）・状態の行の回る輪の `svgNode`（ui/owned-status.js）・ナビのアイコンの `shape`（ui/nav-icons.js）は、**ui/dom.js の `svgElement(tag, attributes)`**（createElementNS。属性名が style か on* なら大文字小文字によらず投げる）で作る（`svgNode` はなくした）。test/static/security.test.js は、属性名が文字列でない setAttribute を ui/dom.js の 1 か所だけに限り、style.cssText・バッククォートの style・setAttributeNS も止める。test/import.test.js は import の指定（' " `、クエリ・#、別の経路）を file からの相対で解決して、core/ideal.js を読むのが views/ideal.js だけかを見る（`importsIn`。配合表〔data/breeding.js〕の検査は前の正規表現のまま）。
    - **A13**: test/web/hint.test.js に板の role=status を足した。
14. **フェーズ 1b・1c の終わりのユーザーの答え（2026-10-13、ブランチ `fix/phase-1bc-answers`。D25・D27 の理想個体の分）**:
    - **0 組の要約（D27）**: `summaryLine` は `result.total` が 0 のとき「組なし（候補 N 体）」（前は「上位 0 組（全 0 組・候補 N 体）」）。続きの「 · 登録済みの配合 n 件（なければ 同じ種族どうし）」「 · Alice の個体」は今までどおり（区切りも同じ「 · 」。決めた理由: 要約の形を 0 組でも変えず、件数の部分だけを短くした）。上の 2 の「組が 0 のときも『上位 0 組…』のまま出す」はこの形に変わった。画面: モックの inject-farms.js で、所持パルにいる種族を順に開いてウミヘビで「組なし（候補 4 体） · 同じ種族どうし」（`answers/zero-pairs-1100-light.png`）。
    - **所持の状況のリンク（D27。ideal-panel の I-53 の所持の状況）**: 親の候補の数（`isParentCandidate`＝タマゴでなくグローバルパルボックスでない）と同じ集まりになるよう、リンクに **`place`＝所持パルの既定の場所（`DEFAULT_PLACES`。views/owned.js から import）からタマゴを除いたもの**（`party,palbox,base,dps,unknown`）を渡す。前は所持者だけを渡し、開いた先にタマゴ（地面・孵化器）も出て件数が合わなかった。画面（inject-farms.js）: アヌビスの「所持 ♂10 ♀9」→ 開いた先「19 / 138 体 · ♂10 ♀9」、伝説ありの「全部持つ ♂3 ♀2」→「5 / 138 体 · ♂3 ♀2」。性別の分からない個体（タマゴ以外）は数に入らず開いた先には出る（理想個体では「除外」に数える。実際のセーブではタマゴ以外はふつう性別がある）。
    - **組の ♂♀ 行（D25 の影響）**: 所持パルの一覧の行は、目標の印を行の下の段に出すようになり、行の高さが 64px／80px の 2 つになった（owned-rows の記録 19）。**理想個体の組のカードの「別の配合牧場で使用中」は今までどおり名前の下のバッジの 1 行**（`ownedRow` の新しい options `badges`。前は `marks`）で、カードの行は下の段を取らない 64px（前は 80px。キーワードの理由の 1 行の場所が空いていた分だけ低くなった）。個体値の 4 セルの見出し・差・バーは 53px の中に収まる（画面で 18 行とも 64px、いちばん高いセル 52px、はみ出しなし。`answers/ideal-card-1100-*.png`・`ideal-inuse-1100-light.png`）。

15. **2026-10-14 のユーザーのフィードバック（ブランチ `fix/feedback2-ideal`。D30。理想個体の分。細部は担当が決めた）**:
    - **組のカード**（原文「完成まで平均何個のような表示は不要。」「「同じ種族どうし」という文言は不要。」「「子と入れ替えながら · この 2 体のままでは届きません · 1 個のタマゴで 0% · キノコケーキは目安」このような文言は不要。」）: カードは **`div.ideal-pair-head`（`span.step-number`＋`div.ideal-tags`）と ♂♀ の 2 行**、登録の注意（ambiguous・swapped・unverified）があれば下に `ul.ideal-notes` だけ。消したもの: `.ideal-chance`（太字の数値の行と小さな内訳の文）・`span.ideal-source`（「同じ種族どうし」「登録済みの配合 A♂ × B♀」。親の種族は ♂♀ の行で分かるので、異種の文もいっしょになくした）・`li.ideal-extras`（余計なパッシブの確率の注記「これがなければ、パッシブの確率は X% → Y%」。余計なパッシブは ♂♀ の行で薄く見せている）、関数 `percent`・`eggsText`・`generationsText`・`countText`・`pairMeasure`・`sourceText`（export を外した）と pairCard の `cake`。ambiguous の注記から「確率は目標のパルが産まれた場合のものです。」を外した（確率を出さないため。D19 の「どちらかの登録が間違っている可能性があります。」は残す）。上の 4（数値の言い方）・6 の pairCard の形・8 は、この形に変わった。
      - 見た目（「空いた所を詰める」）: `.ideal-pair` の余白を 10px 18px 12px → **8px 18px 6px**、`.ideal-pair-head` を grid（26px・1fr・auto）→ flex（番号と札の 1 行）、最後の ♂♀ 行の下の線を消した（`.ideal-pair > .owned-row:last-child`）。カードの高さは 1100px で 171px（札の行 29px＋行 64px×2＋余白）。♂♀ 行の 64px は、パッシブの欄が 2 段分の高さを持つので詰めていない（行の高さがそろったまま、1 段のときは下が空く）。ラッキーなどのバッジのある行も、カードの下端から 13px 上に収まる（`card-badge-1100-light.png`）。
    - **個体値の差（−N。D23）をなくした**（原文「個体値を設定した場合、その個体値からどのくらい足りないかを「-6」のように表示しているがこれは不要。」）: views/owned.js の `fillTalentCell` は `span.talent-diff` を作らない（CSS の `.talent-diff` も消した）。目標未満は `.short`（細字・on-surface-variant）とバーの目標の縦線のまま、読み上げは「攻撃 80（目標 100 未満）」（前は「目標 100 まで あと 20」）。所持パルの画面の行は targets を渡さないので変わらない。上の 9 の「差は値の下に小さく出す」は、この形に変わった。
    - **要約の行をなくした**（原文「「上位 7 組（全 56 組・候補 18 体） · 登録済みの配合 1 件 · Alice（自分） の個体」のような長い説明も不要。」。原文の名前は実際のプレイヤー名なので Alice に置き換えた）: `div.result-note.ideal-summary`（`span.ideal-summary-text`・除外の `button.ideal-excluded` と hint）、`summaryLine`・`renderSummary`・`excludedLines`・`excludedHint`、CSS の `.ideal-summary`・`.ideal-summary-text`・`.ideal-excluded` を消した。組が 0 のときの「組なし（候補 N 体）」（上の 14・D27）もいっしょになくなり、理由は結果の欄の案内（`noPairs`。所持者で絞っていれば「（所持者を「Alice（自分）」に絞っています）」）だけ。性別不明・パッシブ 5 個以上の除外の数は、画面のどこにも出なくなった（計算は変えていない）。
    - **ケーキの提案の計算（ideal-panel の 16 の印の中身）**:
      - 物差し: **`planSpeed(result)`**（core/ideal.js）＝ 1 番の組が完全体作成組ならその `eggs`（完成までのタマゴの平均。並び〔comparePlan〕と同じ物差しで、キノコケーキは目安）、完全体作成組がなければ `null`（そのケーキでは作れない）。**`fastestCake(speeds)`**: CAKES の順（なし → キノコ等 → スペシャル。手間の少ない順）に見て、作れるケーキのいちばん小さい値が、そのケーキの値の **0.9 倍（`CAKE_FASTER`）より大きい**（ほかが 1 割以上少なくならない）最初のケーキ。3 通りのどれかがまだ分からない・どれも作れないときは `null`（印なし）。
      - 決めた理由: 物差しを並びと同じにすると、提案したケーキに切り替えたときに 1 番に出る組の速さと食い違わない。「1 割」は D17（パルリバーサーの案内）の「1 割以上少ない」と同じ物差しで、キノコケーキ・スペシャルケーキは手間（素材）がかかるので、ほぼ同じ速さなら手間の少ない方がよい（例: 個体値 90 の 2 体で目標 90 なら、なし 3.25 個・キノコ等 3.14 個で差 3% →「なし」）。「完全体作成組がないケーキは作れない扱い」は親の指示のまま（欲しいパッシブを候補のだれも持たない〔`result.missing`〕ときは、どのケーキでも作れないので計算せずに 3 通りとも null）。
      - 区切り: **`cakeSpeedSteps(input, cakes, onSpeed)`**（core/ideal.js）は、ケーキごとに `idealPlanSteps({ ...input, cake, limit: 1 })`（牧場の優先・見張りなし。どちらも 1 番の物差しを変えない）を `yield*` で回し、求め終えたケーキから onSpeed で知らせる（途中で止めても、求め終えた分は覚えておける）。views/ideal.js は、今のケーキの計画を描いた後（`run.done` の後・`finishPlan` の後・同じ条件に戻った `key === shownKey` の後）に **`compareCakes(plan, result, spent)`** で、今のケーキの速さを覚え、まだ分からないケーキを `startSliced`（今の計画と同じ budget 30ms。最初の区切りは同じ処理の中で使った時間を引いた残り、`finishPlan` からは 0）で求め、終わったら **`showFastest()`** で印を付ける。今の計画を計算し直すとき（区切りに入るとき）は **`stopCakes()`** で止め、描いた後に残りのケーキから続ける（今の選択の計画を先に出す）。
      - 覚え方と捨て方: **`cakeKey`**＝計算の署名（`key`）からケーキと牧場の署名・優先する組を除いたもの（`state.revision`・index の番号・env・目標・パッシブ・条件・個体値の目標・所持者・自分の個体・`candidateSignature`）。renderResults のはじめに **`setCakeKey(nextCakeKey)`** で、変わったら古い計算を捨てて印を外し（覚えている条件ならすぐ印を出す）、`clearPlan`（目標なし・データなし）では空にする。速さは **`cakeSpeeds`**（Map。新しく使った条件から **`CAKE_MEMORY` 8 件**）に覚えるので、ケーキを切り替えても比べ直さず、10 秒ごとの読み直しで計算に効く値が同じなら計算し直さない（レベルだけ変わったデータでは続きの区切りが入らないことをテストで確かめた）。画面を閉じたら止める。
      - 計算の量: 条件を変えるたびに、今の計画に加えて 2 通りの計画（limit 1）を求める（ケーキの比べ方の分だけ、合計の計算はおよそ 3 倍。止まらないが、印が出るまでの時間は延びる。phase-1a の「計測の記録」）。世代の表の覚えは 8 件のまま（`GENERATION_TABLE_LIMIT`。3 通りの表がちょうど 8 件に収まる。ふやすとキノコケーキの表の `firstTalent` の分だけメモリが増えるので変えていない）。前の条件の表は追い出されやすくなる（条件を行き来すると表を作り直すことがある）。
    - テスト（ideal-view.test.js）: カードの形（[番号][札]＋♂♀ の 2 行・数値と内訳の文がない `NUMBERS`）・要約の行と「?」がない・差がない（読み上げは「目標 N 未満」）・ケーキの提案 3 件（最速の印・押して切り替え・目標 90 で「なし」・スペシャルが最速・作れないケーキ・どれも作れない／区切って今の計画を先に・条件を変えたら捨てる・覚えた条件は計算し直さない・閉じたら止める）。`talentsOf` は差の注を外す形、カードの比べ方は `cardText`（textContent＋個体値の読み上げ）にした。期待値を数値の文で確かめていたテスト（ケーキで計算し直す・チェックで条件なし・組の目的・画像の 4 体など）は、カードの作り直し・組の個体・読み上げで確かめる形にした。変える前の views/ideal.js・views/owned.js・ui/segmented.js に戻すと 20 件が落ちることを確かめた。core（ideal.test.js 3 件）と segmented（1 件）は、関数がなくて落ちることを確かめた。

---

## ideal-farms: 牧場の状態を残し、牧場の判定を絵と押せる行に

### 目的
先に、親が読めない牧場を捨てずに状態つきで残し、牧場の情報が欠けているときは交換推奨などの判定を保留する（誤った交換を勧めない）。そのうえで、牧場の判定を文の羅列から「[牧場の名前][♂タイル]×[♀タイル]→[状態]」の押せる行にし、押すと該当の組へ移れるようにする。

### 経緯
- **Codex のプランレビュー**: 2 回目 F（親が不明な牧場を正規化で捨てると件数が欠ける。web/js/save/palworld.js:1061・web/js/core/owned.js:207 → 表示用には不明の状態を残し、自動登録・親の組の判定からだけ外す）、4 回目 新 1（牧場を省いたデータでは、core/ideal-farms.js:38 が受け取った牧場の数で置く組を決めるので交換推奨が誤る → 牧場の情報が欠けたら交換推奨・空き牧場・使用中の印の判定を保留）、6 回目 7（この土台がフェーズ 3 の farm-data にあると遅い → **ideal-farms に前倒しし、farm-data で再利用**）。
- 別プランの **F037**（牧場の判定を sticky 行に、交換推奨は 2×2 の小表で入れ替わるセルだけ色、行を押すと該当カードへ scrollIntoView、交換先のカードに札）。
- 本セッションの案: **I-27**（同じ拠点の牧場を A／B で区別。記号は全体の牧場で数え、目標ごとに変えない）・**I-28**（牧場ごとの絵のカード）・**I-29**（判断: K は変えず、空き牧場は数と「空いた牧場に置くなら おすすめ K+1〜K+n 番」だけ。割り当ては決めない）・**I-30**（「おすすめ N 番」から組へ飛ぶ。ハッシュのリンクはルーターが画面の切り替えと解釈するので使わない）・**I-31**（判断: 牧場のデータがあり K≥1 のときだけ、K 番目の後に境目の線）・**I-32**（判断: 別の牧場に入っている個体に「別の配合牧場で使用中」の印だけ。固定・除外の設定は作らない。判定は所持者で絞る前の候補で）・**X-28**（判断: 入れる・外す個体を 1 行 1 体で持ち主つきに、自分の個体は太字、2 体の持ち主が違う組に「Carol・Bob の個体」。段取りの手順書・コピーは作らない）。
- **ideal-calc の後**（2026-10-12 追記。README の D9〜D16）: 判定は ideal-calc の `farmAdvice(farms, pairs, { measureOf })`（個体をやり取りする牧場のまとまりごとに、全体の速さの目安 R が上がるときだけ交換推奨。上がらなければまとまりの牧場を全部「そのまま」）。「変更あり」は交換推奨の行き先の組だけ。交換を見送った牧場は、K 番より下の組や一覧にない組のまま「そのまま」になる。そのうえで、ユーザーが次を決めた（セッション `c342c7a9`）:
  - **D13**: 判定の保留中は「変更あり」を付けない（交換推奨がないので、ideal-calc の絞り込みで空になる）。
  - **D14**: I-31 の境目の線はやめ、カードの札（「◯◯に配置中」「→ ◯◯へ」）で置く組を示す。
  - **D15**: 一覧にない「そのまま」の組は、牧場の行に「完成まで 平均 約 N 個」などの数字を出し、行は押せない。一覧にある組は、押すとそのカードへ移る。
  - **D16**: 空き牧場には、牧場に残す組・交換先の組に使う個体を除いた、おすすめの上位の組を案内する（I-29 の「おすすめ K+1〜K+m 番」は、上から K 組が牧場に置く組とは限らないので使わない）。

### 依存
ideal-results（カードの札・説明部品・畳み）、ideal-panel（`--panel-h`）、stable-render（カードの `data-key`）、ideal-calc（`farmAdvice` の `measureOf`・`idealPlan` の `measures`・「変更あり」の絞り込み）。（追記 2026-10-13: `--panel-h` は ideal-panel が `trackHeight` で画面の section に書き、パネルが伸びる〔D20〕と変わる。今は牧場の欄の中身〔「そのまま」→「交換推奨」の詳細の行〕が変わると下の結果が動く〔アヌビスで +39px〕。ideal-panel の「実装の記録」3・10）（追記 2026-10-13、ideal-results の実装の後: カードの札は pairCard の中の `tag(className, text, help, icon)`〔説明つきの button。作った `hint` は drawPlan の `hints` に入れ、`showResults` が作り直すときに閉じる〕。同じ見込みの組の畳みは drawPlan の `foldSame` で、判定が指す組〔畳まない組〕は `pointed`〔swap の to・keep と none の rank〕。要約の行は `div.result-note.ideal-summary`。ideal-results の「実装の記録」2・6・7）

追記（2026-10-12、ideal-calc の実装）: `farmAdvice` は、今の組か交換先の組が「同じ組み合わせで別の子も登録されている組」（`ambiguous`）のまとまりを比べず、おすすめの順のとおりにする（D19）。今の牧場の行には、その旨の注記（`small.ideal-warning`「⚠ 牧場の組（交換先の組）は、…どちらかの登録が間違っている可能性があるので、速さでは比べず、おすすめの順で判定しています。」）がある。行を絵と押せる行に作り直すときも、この注記は残す（phase-1-0-ideal-calc.md の「実装の記録」）。

### このテーマでやらないこと
- 牧場のタマゴ（palId・突然変異）の保持と共有、共有の JSON の上限と「一部だけ」の印（フェーズ 3 の farm-data）。全牧場の帯（フェーズ 3 の farm-board）。
- **共有の形の変更と GAS の更新**（下の「現状」のとおり、共有では状態を運べない。参加者の画面で読めない牧場を知るのは farm-data から）。
- どの組をどの空き牧場に置くかの割り当て、使う牧場の選択、親の固定・除外（I-29・I-32 の判断）。継承ルートの相手親の持ち主の内訳（X-28 の (3)。フェーズ 2 の owned-overlay・route-cleanup で扱う）。
- 牧場の建物のアイコン（フェーズ 4 の game-assets。ここでは名前と状態のチップで足りる）。

### 現状
- 正規化: `normalizeOwned` は `snapshot.breedFarms` のうち `status !== 'uncertain'` だけを残し、`{ id, baseId, parents }` にする（web/js/core/owned.js:206-208）。解析側は、親が引けない牧場（web/js/save/palworld.js:1058-1062）や食い違う牧場（:309・:327・:331・:335）を `uncertain` にする。uncertain の牧場の `parents` には引けた親だけが入る。
- **自動登録はすでに uncertain を使っていない**: core/auto-breeding.js:51-53 は `snapshot.breedFarms` を直接読み、`farm.status === 'ok'` でないと親の組を空にする。`owned.farms` は使わない。だから「自動登録から外す」ための変更は要らない。
- 共有: `sharedUpload` は `owned.farms` を `{ id, baseId, parents }` で送る（core/owned.js:472）。GAS の `cleanOwnedFarms`（web/js/core/owned-shared.js:22-33 を `npm run build:gas` で gas/Shared.js に写したもの）は決まった項目しか残さないので、`status` を足しても GAS が捨てる。受け取り側 `ownedFromShared` は `cleanOwnedFarms(world.farms)`（core/owned.js:523）。
- 判定: `targetFarms`（web/js/core/ideal-farms.js:15-28）は親が 2 体（:20）・♂♀・目標が産まれる向きの牧場だけ。`farmAdvice`（:37-65）は `pairs.slice(0, farms.length)`（:38）で K を決め、keep／swap／none を返す。views/ideal.js:476-487 で `targetFarms(farms, candidates.filter(isParentCandidate), result.layouts)`（**所持者で絞った候補**）→ `farmAdvice` → `planChanges` → `renderFarms`。
  - **ideal-calc の後**: `targetFarms` は `breedingLayouts(state.index, to)` で計画より先に求め、`farmAdvice(placedFarms, result.pairs, { measureOf })` は牧場のまとまりごとに R で比べる（見送ったまとまりは全部「そのまま」で `to`・`in`・`out` なし。形は `status: 'keep'` で、`rank` が -1（一覧にない）か K 以上。ふつうの keep は `0 ≤ rank < K`。phase-1-0-ideal-calc.md の手順 3-3）。`measureOf` は、今の牧場の組を `result.measures`、交換先の組を `result.pairs` から引く（同じ手順 5-4）。`result.measures`（`Map<key, { status: 'ok', rank, eggs, gathered, gatherChance, talentEggs, chance } | { status: 'blocked' }>`）に、一覧にない牧場の組の物差しもある。「変更あり」は `planChanges` の `changed` と、採用した交換推奨の行き先の組との共通部分。
- 画面: `renderFarms`（views/ideal.js:406-433）は見出し「配合牧場（この目標の組を置いている K か所 · 交換推奨 n か所）」と、牧場ごとの文（`palText`（:398）の「名前♂（HP・攻・防）」をつなぐ）を出す。牧場の名前は拠点の名前だけ（`farmName`、:400-403）なので同じ拠点の 2 つの牧場が同じ名前になる。カードのタグは「◯◯に配置中」（:110・:489）。カードに id はない（:103 は aria-label だけ）。

### 実装の手順
1. **牧場の状態を残す**（core/owned.js:206-208）: uncertain も残し、`{ id, baseId, parents, status: farm.status === 'uncertain' ? 'uncertain' : 'ok' }` にする。`ownedFromShared`（:523）は `cleanOwnedFarms(...)` の結果に `status: 'ok'` を付ける（`cleanOwnedFarms` 自体は GAS に写すので変えない）。
2. **共有は今の形のまま**（core/owned.js:472）: `owned.farms.filter((farm) => farm.status === 'ok').map(({ id, baseId, parents }) => ({ id, baseId, parents }))`。uncertain を送ると、旧コードの画面と GAS が普通の牧場として扱ってしまうため。**このため参加者の画面では、ホスト側の読めない牧場を知る手段がない**（判定は「欠けていない」として動く。今と同じ）。共有に状態を運ぶのはフェーズ 3 の farm-data（読めない牧場は親を空にして `s: 'u'` で送る。GAS の反映は `npm run gas:push`。farms の列はすでにあるので `setup()` は通常は要らない。phase-3-4-drawer-data.md の「0-4」）。
3. **core/ideal-farms.js に純粋な関数を足す**（DOM なし。core/ideal.js は import しない）:

   ```js
   /** 判定に使える牧場（状態が ok か、状態のない古いデータ）。 */
   export const readyFarms = (farms) => (farms ?? []).filter((farm) => !farm.status || farm.status === 'ok');
   /** 牧場の情報がそろっているか。uncertain の牧場がある、または partial（farm-data で足す「一部だけ」の印）なら complete: false。 */
   export function farmCompleteness(farms, { partial = false } = {}) → { complete: boolean, uncertain: number, partial: boolean }
   /** 空いている牧場（状態が ok で親が 2 体未満）。 */
   export function emptyFarms(farms) → farm[]
   /** 牧場の表示名。拠点ごとに farm.id の順で A, B…（その拠点に 2 つ以上あるときだけ）。全体の牧場で数え、目標ごとに変えない。 */
   export function farmNames(farms, baseLabel /* (baseId) => string */) → Map<farmId, string>   // 例「拠点 1 の牧場 A」
   /** 目標の牧場（targetIds）以外の牧場に入っている個体 → その牧場 ID。 */
   export function farmsInUse(farms, targetIds /* Set<farmId> */) → Map<palId, farmId>
   ```
   - `targetFarms` の最初で `readyFarms` を通す（uncertain の牧場は親の組の判定に使わない）。
4. **views/ideal.js の判定の組み立て**（:476-487 を置き換え）:
   - `const all = owned.state.owned.farms`（null なら牧場の情報なし＝今と同じく何も出さない）。`const names = farmNames(all, baseLabel)`（baseLabel は `owned.state.owned.bases` の label。今の `farmName` の代わり）。
   - `placedFarms = targetFarms(all, holderFiltered, layouts)`（今と同じ。K と keep／swap の基準）。
   - `ownFarms = targetFarms(all, unfiltered, layouts)`（**所持者で絞る前**の親の候補。I-32 の「使用中」の基準）。`inUse = farmsInUse(all, new Set(ownFarms.map((farm) => farm.id)))`。
   - `const { complete, uncertain } = farmCompleteness(all)`。**complete なら** `farmAdvice(placedFarms, result.pairs, { measureOf })`（ideal-calc の形）。**complete でなければ** `farmAdvice` を呼ばず、空き牧場・使用中の印も出さない（判定の保留）。`planChanges` は今どおり呼ぶ（牧場が ok → uncertain に変わると、その牧場は `targetFarms` から外れて署名が変わるので、基準は作り直され、前の印は消える。保留が解けて ok に戻ると、また作り直される。保留中は印を出さないので、表示への影響は「保留の前の印が、保留が解けた後に戻らない」ことだけ。2026-10-12 の点検で、前の版の「署名に入らないので基準は変わらない」を直した）が、**保留中は「変更あり」を付けない**（D13。採用した交換推奨がないので、ideal-calc の絞り込みで空になる。件数の文も出さない）。「配置中」の札（セーブの事実）は出す。ideal-results の計算のしくみのダイアログの「配合牧場と『変更あり』」に「牧場の判定を保留している間は『変更あり』は付きません。」を 1 文足す。
5. **sticky の牧場の帯**（`.ideal-farm-strip`。F037 の「sticky 行」）: `position: sticky; top: calc(var(--header-h) + var(--panel-h)); z-index: var(--z-sticky); height: 44px;`。目標を選んでいて牧場の情報があるときは常に出し（中身がなくても高さを保つ。「牧場 0 件でもスロットの高さは保つ」）、牧場ごとに 1 つのボタン `[牧場 A][♂アイコン]×[♀アイコン]→[✓ 2 番｜✓ そのまま｜⇄ 1 番へ｜—]`（「✓ そのまま」は番号なし。交換を見送って、今の組がおすすめの一覧にないとき。このセルは押せない。D15）。入り切らない分は「ほか n か所」（押すと下の詳細へスクロール）。保留中は「牧場の判定を保留（読めない牧場が n か所あります）」の 1 行。この目標の組を置いた牧場がなければ「この目標の組を置いた牧場はありません」（空き牧場があれば「空き n か所」）。
6. **牧場の詳細**（`section.ideal-farms`、帯の下の通常の流れ。I-28・X-28）:
   - 見出し: `配合牧場（この目標の組を置いている K か所 · 交換推奨 n か所 · 空き m か所）`（空き・交換は complete のときだけ）。
   - 牧場ごとの行: 名前・今の 2 体を `palTile`（小）＋性別＋`passiveList`・状態のチップ（「そのまま（おすすめ 2 番）」「交換推奨 → おすすめ 1 番」「おすすめにない組（ほかに置く組がありません）」）。
   - **ideal-calc で交換を見送った「そのまま」の行**（D15）: チップは「そのまま」、その横に「入れ替えても全体の速さの目安が上がりません」（ideal-calc の文）。
     - 今の組がおすすめの一覧にある（K 番より下を含む）: チップに番号を付け（「そのまま（おすすめ 5 番）」）、行を押すとそのカードへ移る（手順 7）。
     - 一覧にない: 「おすすめの一覧にない組 · 完成まで 平均 約 N 個」の 1 行を足し、行は押せない（`button` にしない）。数字は `result.measures` の物差しを ideal-results の `pairMeasure` と同じ言い方で出す（完全体作成組は `eggs`、パッシブ厳選組は `gatherChance` で「欲しいパッシブが全部そろうまで …」か、途中まで集める組なら「欲しいパッシブ n 個のうち m 個がそろうまで …」、個体値厳選組は `talentEggs`。blocked は「パッシブの条件を満たせない組」）。物差しが返らない組（ideal-calc の手順 3-5 の「返らない組」）は数字を出さない。
     - 画面の例（ユーザーに示した形）:

       ```
       拠点 1 の牧場 A   A♂ × B♀
         [そのまま] 入れ替えても全体の速さの目安が上がりません
         おすすめの一覧にない組 · 完成まで 平均 約 4,868 個
         （押せない）

       拠点 1 の牧場 B   E♂ × F♀
         [そのまま（おすすめ 3 番）]   → 押すと 3 番のカードへ
       ```
   - 交換推奨は 2×2 の小表（列: 今／交換後、行: ♂／♀）。入れ替わるセルだけ `error-container` の色。その下に入れる・外す個体を 1 行 1 体で: `palTile`・持ち主（拠点の個体は「◯◯が預けた」）・場所・パッシブのチップ。自分の個体（`ideals.mine()` の id）の行は太字。
   - 空き牧場（I-29。complete で、所持者が「すべて」のときだけ）: 「空き m か所（拠点 1・拠点 2）。空いた牧場に置くなら おすすめ 3 番・5 番」。番号はボタンで、押すとその組へ移る。仲間の拠点の牧場も含むので「勧める」程度の文にする。
     - **案内する組（D16）**: 判定のあとの実際の置き場（keep の牧場の今の組・見送って「そのまま」の牧場の今の組・swap の行き先の組・none の牧場に残る個体（`out` にない個体））に使う個体を集め、おすすめを上から見て、♂・♀ のどちらもその集まりに入っていない組を、空きの数 m だけ選ぶ（選んだ組の個体も集まりに足し、空きの組どうしでも個体を重ねない）。足りなければある分だけ。ideal-calc の前の「K+1〜K+m 番」は、上から K 組が牧場に置く組とは限らないので使わない。
     - 例: 1 番 A♂×D♀ の A が牧場 A に「そのまま」で残っているなら、1 番は案内しない。
   - 使用中（I-32）: カードの親の行と、入れる個体の行に「別の配合牧場で使用中（拠点 2 の牧場 B）」の印（`ownedRow` の `marks` に渡す。下の 9）。計画からは外さない。
   - 保留中は行（今の組の絵）だけを出し、状態のチップは「判定を保留」。理由の 1 行「読めない牧場が n か所あるため、交換推奨・空き牧場・使用中の判定を保留しています」。
7. **組へ移る**（I-30）: カード（`pairCard`）に `data-key = planPairKey(male, female)` を付け、`scroll-margin-top: calc(var(--header-h) + var(--panel-h) + 44px + 8px)`（帯の高さを足す）。帯・詳細の行を押したら、keep（と見送った「そのまま」で一覧にある組）なら `rank` の組、swap なら `to` の組のカードを `data-key` で探し（一覧にない「そのまま」の組は押せないので、ここに来ない。D15）、畳まれていれば（ideal-results の `details.ideal-same`）開いてから `scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })`、カードに `.is-flash` を 1 秒（reduced motion では色だけ）。ハッシュのリンクは使わない。強調はカードの class なので、20 秒ごとの再計算で作り直されても次の描画で付け直す（`data-key` で覚えておく）。
8. **カードの札**: 「◯◯に配置中」の名前を `farmNames` の名前に（I-27）。交換先の組のカードに「→ 拠点 1 の牧場 A へ」の札（F037）。2 体の持ち主が違う組に「Carol・Bob の個体」の札（X-28。持ち主は手持ち・ボックスなら `holder`、拠点の個体なら `lastOwner || holder`。どちらかが分からなければ出さない）。
9. **境目の線（I-31）は作らない**（D14。2026-10-12）: ideal-calc の後は、交換を見送った牧場が K 番より下の組や一覧にない組のまま残るので、「↑ 牧場に置く K 組 ／ ↓ 予備」の線は誤りになる。置く組は手順 8 の札（「◯◯に配置中」「→ ◯◯へ」）で示す。ideal-results の畳みは、牧場の判定が指す組を畳まない（K は渡さない）。
10. **`ownedRow` に `marks`**（views/owned.js:51）: `marks: string[]` を `.owned-badges` に `span.owned-badge.badge-mark` で出す（owned-rows の O-52 の印も同じ口を使う）。
11. CSS: `.ideal-farm-strip`・`.ideal-farm-cell`・`.ideal-farm-swap`（2×2）・`.is-flash`（`@media (prefers-reduced-motion: no-preference)` の中で背景の色を 1 秒で戻す）。今の `.ideal-farm*`（app.css:1048-1057）は新しい形に合わせて書き直す。

### 触るファイル
- 変更: `web/js/core/owned.js`（:206-208・:472・:523）、`web/js/core/ideal-farms.js`（:15-28 と新しい関数）、`web/js/views/ideal.js`（:102-126・:397-433・:476-493）、`web/js/views/owned.js`（`ownedRow` の `marks`）、`web/css/app.css`（:1048-1057 ほか）、`web/js/release-notes.js`
- 変えない: `web/js/core/owned-shared.js`（GAS に写すため）、`gas/*`、`web/js/core/auto-breeding.js`

### テスト
- **追加** `test/core/ideal-farms.test.js`: `readyFarms`・`farmCompleteness`（uncertain が 1 つで complete: false）・`emptyFarms`（親 0〜1 体・ok だけ）・`farmNames`（同じ拠点に 2 つで A／B、id の順で安定、1 つなら記号なし）・`farmsInUse`・`targetFarms` が uncertain を使わない。
- **追加** `test/core/owned.test.js`: uncertain の牧場が `status: 'uncertain'` で残り、`sharedUpload` の farms には入らない（ok だけ・status なし）。`ownedFromShared` の farms に `status: 'ok'` が付く。
- **追加**（ideal-view.test.js）: (1) 牧場の行・帯を押すと該当のカードに `scrollIntoView` が呼ばれる（test/helpers/dom.js:101 のモックを呼ばれたか数える形に）。(2) uncertain の牧場があると交換推奨が出ず「判定を保留」が出る。(3) 同じ拠点の 2 つの牧場が「牧場 A」「牧場 B」。(4) 空き牧場の数と番号の案内（D16: 牧場に残す組・交換先の組の個体を使う組は案内しない。空きが 2 つなら、個体の重ならない 2 組）。(5) 別の牧場に入っている親に「別の配合牧場で使用中」。(6) 境目の線（`.ideal-farm-boundary`）がない（D14）。(7) 保留中は「変更あり」のタグと件数の文が出ない（D13）。(8) 交換を見送って一覧にない「そのまま」の行に「おすすめの一覧にない組 · 完成まで 平均 約 N 個」が出て、行が `button` でない。一覧にある「そのまま」の行は押すとそのカードへ移る（D15）。
- **期待値が変わる既存のテスト**（ideal-calc の後の形。ideal-calc で :508 のテストの fixture を「実際に平均が減る個体」に変えているので、その fixture のまま新しい行の形に直す）: `test/web/ideal-view.test.js:528-534`（見出しの文・「そのまま（おすすめ 1 番）」・「交換推奨 → おすすめ 2 番」・「外す: … / 入れる: …」の 1 文・「拠点の牧場に配置中」）、`:537-548`（牧場の情報がないとき）、`:569-582`・`:606`（「変更あり」と状態の文）を新しい行の形（状態のチップの文、入れる・外す個体の行）に。`test/core/ideal-farms.test.js` の既存 3 件は振る舞いを変えないので通るはず（`targetFarms` に status のない古い形を渡しても `readyFarms` が通す）。

### INV-2・互換・セキュリティ・性能の注意
- 牧場の親はセーブの事実で、判定は idealPlan の結果だけを使う（INV-2 に触れない）。配合表は読まない。
- **古い IndexedDB のデータ**（status のない farms）・**古い共有データ**（status なし）・**旧コードのタブ**（共有の形は変えない）が混ざっても壊れない: status がない牧場は ok として扱う。
- 保留の判定は「uncertain が 1 つでもあれば」。ほかのギルドの牧場が常に読めないワールドでは保留が続く。実データで頻繁に起きるようなら、保留の範囲を「その牧場の拠点に目標の組の候補がいるとき」に狭める（そのときは Codex のレビューの意図＝欠けた牧場で誤った交換を勧めない、を守ること）。
- `scrollIntoView` は利用者が押したときだけ。DOM は textContent と `createElementNS` で作る。

### release-notes の案
- id: `<実装日>-ideal-farm-rows`
- title: 「配合牧場の判定を絵で表示」（12 字）
- body: 「牧場ごとに今の組と交換先をパルの絵で出し、押すとその組へ移ります。読めない牧場があれば判定を保留します。」（52 字）

### 完了の条件
- [x] `npm test` が通る。（1,304 件・exit 0）
- [x] モック（`inject.js`。拠点 1 にアヌビスの組が 2 つ・拠点 2 にジェッドランの組）で、拠点 1 の 2 つの牧場が「牧場 A」「牧場 B」と出る。（「拠点 1 の牧場 A」「拠点 1 の牧場 B」。帯・詳細・札とも）
- [x] 牧場の行を押すと該当の組がパネルと帯の下に見える位置へ移り、1 秒光る（動きを減らす設定では色だけ）。畳まれた組なら開いてから移る。（帯の「⇄ 1 番へ」で 1 番のカードの上端 494・帯の下端 240、1.2 秒後に `.is-flash` が消える。動きを減らす設定ではすぐ移り animation は none・色だけ。畳まれた組は空き牧場の案内の「3 番」で開いてから移った。「実装の記録」6・計測の記録）
- [x] 注入データの牧場の 1 つを uncertain にすると、交換推奨・空き・使用中が出ず「判定を保留」の理由が出る。「変更あり」のタグと件数の文も出ない（D13）。（拠点 2 のジェッドランの牧場を uncertain にした `ideal-farms/inject-uncertain.js` で、アヌビスの帯が「牧場の判定を保留（読めない牧場が 1 か所あります）」。「変更あり」はテストで確かめた）
- [x] 境目の線がなく、置く組がカードの札（「◯◯に配置中」「→ ◯◯へ」）で分かる（D14）。
- [x] 交換を見送って今の組が一覧にない牧場の行に「おすすめの一覧にない組 · 完成まで 平均 約 N 個」が出て、押せない。一覧にある「そのまま」の組は押すとカードへ移る（D15）。（一覧にない方はモックのキツネビ〔`ideal-farms/inject-skip.js`〕で「約 9.6 個」「約 14 個」・div。一覧にある方はモックで作れなかったのでテストで確かめた）
- [x] 空き牧場の案内に、牧場に残す組・交換先の組の個体を使う組が出ない（D16）。（アヌビスで「空き 2 か所（拠点 2）。空いた牧場に置くなら おすすめ 3 番・4 番」。1 番は交換先・2 番は牧場 A に残る組）
- [x] 牧場の帯は、目標を変えて牧場が 0↔1 になっても高さが変わらない（結果の top が動かない）。（帯は 0 か所〔ホルス〕・1 か所〔ジェッドラン〕・2 か所〔アヌビス〕・保留とも top 299・高さ 44。帯の下の詳細の高さは 70.5／131.3／447 で変わるので、結果の top は 429.5／490.3／806 と動く。「実装の記録」12・ユーザーに確かめる点）
- [x] ホストの画面で共有した JSON の farms に uncertain の牧場と status が入っていない（開発用 API のモックで確かめる）。（モックではホストの自動の共有にセーブのファイルの登録が要るので、注入したセーブを画面と同じ `normalizeOwned` → `sharedUpload` で共有の形にし、開発用 API の `ownedUpload` に送った。送った値・保存された値とも farm-3 なし・status なし）
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — status のない古い IndexedDB・古い共有データの牧場は ok として扱われ（既存の `test/core/ideal-farms.test.js` 3 件がそのまま通る）、共有の形と GAS は変えていない（上の JSON の確認）。INV-2 — 判定はセーブの事実と idealPlan の結果だけで、配合表を読まない。セキュリティ — 帯と行は textContent と createElementNS（`test/static/security.test.js`）。性能 — 帯の高さは固定で、20 秒ごとの再計算の後も強調を `data-key` で付け直す。（どれも満たした。互換は既存の 3 件と、status のない古い牧場・共有の牧場のテスト。描くときの牧場の計算は牧場と候補の数に比例する小さなもので、計算〔idealPlan〕は増やしていない）

### TODO
- [x] `normalizeOwned` で uncertain の牧場を status つきで残し、`ownedFromShared` に status: 'ok' を付ける
- [x] `sharedUpload` で ok の牧場だけを今の形で送る（GAS・旧画面の互換）
- [x] core/ideal-farms.js に `readyFarms`・`farmCompleteness`・`emptyFarms`・`farmNames`・`farmsInUse` を足し、`targetFarms` で `readyFarms` を通す
- [x] core のテスト（ideal-farms・owned）を足す
- [x] views/ideal.js の判定の組み立てを、所持者で絞る前の候補・完全性・保留に合わせて組み直す（complete なら ideal-calc の `farmAdvice(…, { measureOf })`、保留中は「変更あり」なし＝D13）
- [x] sticky の牧場の帯を作る（高さ固定・押すと組へ移る・保留の 1 行・一覧にない「そのまま」は番号なしで押せない）
- [x] 牧場の詳細（絵の行・2×2・入れる／外す個体の行・空き・使用中）を作る（見送った「そのまま」の行の数字＝D15、空き牧場の組の選び方＝D16）
- [x] カードに `data-key`・札（牧場 A に配置中・交換先・持ち主が違う）を付ける（境目の線は作らない＝D14）
- [x] `ownedRow` に `marks` を足す
- [x] ideal-view.test.js の牧場の文のテストを直し、新しいテストを足す
- [x] CSS を書き直し、モックで A／B・移動・保留を確かめる
- [x] release-notes に 1 件足す

### 実装の記録（2026-10-13、ブランチ `feature/ideal-farms`）

実装のときに決めたこと・文書と違う形にしたこと（後のテーマ owned-rows・フェーズ 3 の farm-data・farm-board はこちらを正とする）。

1. **牧場の状態（手順 1・2）**: `normalizeOwned` の farms は `{ id, baseId, parents, status }`。status は解析の status が `'uncertain'` のときだけ `'uncertain'`、ほか（`'ok'`・状態のない古い解析結果）は `'ok'`。uncertain の牧場の parents は引けた親だけ。`sharedUpload` は `!farm.status || farm.status === 'ok'` の牧場だけを `{ id, baseId, parents }` で送る（status は送らない）。`ownedFromShared` は `cleanOwnedFarms(world.farms)` の各牧場に `status: 'ok'` を付ける。`core/owned-shared.js`・GAS・`core/auto-breeding.js` は変えていない。**牧場の状態の名前は `'ok'`・`'uncertain'` の 2 つ**（farm-data で共有の `s: 'u'` を戻すときもこの名前にする）。
2. **core/ideal-farms.js の関数（手順 3。farm-data・farm-board が使う名前）**:
   - `readyFarms(farms)`: status がないか `'ok'` の牧場（文書のまま）。`targetFarms` は最初にこれを通す。
   - `farmCompleteness(farms, { partial = false } = {}) → { complete, uncertain, partial }`: **uncertain は「判定に使えない牧場」（`readyFarms` に入らない牧場）の数**（文書は uncertain の数。知らない状態の牧場も判定に使わないので、数えて保留にする）。farms が null なら `{ complete: true, uncertain: 0, partial: false }`。farm-data は `farmsPartial` を `partial` に渡す。
   - `emptyFarms(farms)`: `readyFarms` のうち親が 2 体未満。farm-data の「古い形の共有では空き牧場の判定をしない」は呼び出し側（views/ideal.js の `farmContext`）か、この関数に足す。
   - `farmNames(farms, baseLabel) → Map<farmId, name>`（farms の順）: 名前は `${baseLabel(baseId)} の牧場`（baseLabel が空なら「拠点の牧場」）、拠点に 2 つ以上あれば牧場の ID を文字列の順に並べて ` A`・` B`…（27 個目から AA）。uncertain の牧場も数える（読めない牧場が出ても記号が変わらない）。
   - `farmsInUse(farms, targetIds) → Map<palId, farmId>`: `readyFarms` のうち targetIds にない牧場の親（同じ個体が 2 か所にいれば先の牧場）。
3. **判定の組み立て（手順 4）**: views/ideal.js の **`farmContext(data, layouts)`** が、描くときのデータ（`plan.data`）から `{ names, complete, uncertain, inUse, empties, baseLabel }` を作る（文書は計算の前に組み立てる形だった）。計算に効かない値だけが変わった読み直し（`drawLatest`）では計算をし直さず、ほかの目標の牧場が読めなくなった・空いたなどは計算の署名に入らないので、**描くときに求め直す**ため。そのため `displayKey` に全部の牧場（JSON）と拠点の名前を足した（変わったら描き直す）。`plan` に `layouts`・`holder` を足した。使用中の基準の `ownFarms` は complete のときだけ `targetFarms(all, 全部の親の候補, layouts)` で求める。保留中は `farmAdvice` を呼ばない。`planChanges` は今どおり呼び、`showPlan` は complete のときだけ交換推奨の行き先で「変更あり」を絞る。**drawPlan も保留中は「変更あり」と件数の文を出さない**（描いた後にほかの牧場が読めなくなったとき。この目標の牧場は同じなので基準は変わらず、読めるようになれば印は戻る。テストで確かめた）。
4. **牧場の帯（手順 5）**: `div.ideal-farm-strip[role=group][aria-label=配合牧場の判定]`。画面の子の並びは「見出し → パネル → 要約 → 足りないパッシブ → **帯** → 詳細（`section.ideal-farms`）→ 結果」。目標を選んでいて牧場の情報（`owned.farms` が配列）があるときは、計算の前・計算中・データの待ちでも `hidden` を外して場所を取る（ないときは hidden）。高さは `.ideal-view` の `--farm-strip-h: 44px`（下に 6px の余白・下の線）。セルは `button.ideal-farm-cell.<keep|swap|none>`（押せないときは `div.ideal-farm-cell.<…>.is-static`）で、中は `.ideal-farm-cell-name`・`.ideal-farm-cell-pals`（26px の絵と性別の印）・`→`・`.ideal-farm-cell-state`。状態の文は「✓ N 番」（見送ったが一覧にある組も）「✓ そのまま」（一覧にない。押せない）「⇄ N 番へ」、置く組のない牧場（none）は**一覧にあれば「— N 番」で押せる・なければ「—」で押せない**（文書は「—」だけ。押せるかは決めていなかった）。aria-label・title は「拠点 1 の牧場 B（アヌビス♂ × アヌビス♀）: 交換推奨 → おすすめ 1 番」。**並べる数は固定の 3 か所**（`STRIP_FARMS`。幅を測って決める形にはしていない。1100px でセルは 262〜272px なので 3 か所と「ほか n か所」が 941px に入る。920px ではセルが縮み牧場の名前を省略する）、残りは `button.ideal-farm-more`「ほか n か所」（押すと詳細へ `scrollIntoView({ block: 'start' })`）。保留中は `span.ideal-farm-strip-note.is-pending`（警告の色）、この目標の組を置いた牧場がなければ「この目標の組を置いた牧場はありません（空き n か所）」（空きは詳細の案内と同じ条件のときだけ）。
5. **牧場の詳細（手順 6）**: 見出し「配合牧場（この目標の組を置いている K か所 · 交換推奨 n か所 · 空き m か所）」（保留中は K だけ、空きは m > 0 のときだけ）。出すのは、この目標の組の牧場か空き牧場の案内があるとき（保留中で牧場がなければ出さない。帯が理由を出す）。行は `li.ideal-farm.<keep|swap|none|pending>` の中に `button.ideal-farm-main`（押せないときは `div`）: `strong.ideal-farm-name`・`.ideal-farm-pair`（`.ideal-farm-pal` ×2）・`.ideal-farm-status.<…>`（チップ）・見送ったときは `.ideal-farm-reason`「入れ替えても全体の速さの目安が上がりません」（チップの横。幅が足りなければ折り返す）。**個体は palTile ではなく `.ideal-farm-pal`（28px の `palIcon`・名前と性別・個体値「HP 60・攻 72・防 55」・小さなパッシブのチップ）**にした（palTile は図鑑番号と 64px の高さがあり、押せる行の button の中に入れるため。個体値は文書にないが、同じ種族の 2 体を見分けるのに要る〔前の文の「名前♂（HP・攻・防）」と同じ〕）。
   - 一覧にない「そのまま」は `small.ideal-farm-measure`「おすすめの一覧にない組 · 完成まで 平均 約 N 個」。言い方は `measureText`: 完全体作成組 `完成まで ${eggsText(1 / eggs)}`、パッシブ厳選組「欲しいパッシブが全部そろうまで …」／「欲しいパッシブ n 個のうち m 個がそろうまで …」（n は欲しいパッシブの数）、個体値厳選組 `個体値がそろうまで ${eggsText(1 / talentEggs)}`、blocked は「パッシブの条件を満たせない組」、物差しが返らなければ「おすすめの一覧にない組」だけ。
   - 交換推奨は `table.ideal-farm-swap`（thead「今」「交換後」、行の見出し ♂／♀〔`th[scope=row]`〕。入れ替わる行の 2 つのセルに `td.is-changed`〔error-container〕）と `ul.ideal-farm-moves > li.ideal-farm-move.<out|in>`（`.is-mine` で太字）: `.ideal-farm-move-label`（外す／入れる）・`.ideal-farm-pal`・`.ideal-farm-owner`（拠点のパルは「Bob が預けた」〔lastOwner がなければ所持者＝拠点の名前〕、ほかは所持者）・`.ideal-farm-place`（placeLabel）・小さなパッシブ・使用中の印。外す行を先、入れる行を後にした。置く組のない牧場で外す個体があれば、「外す個体は、ほかの牧場の交換推奨に使います」と外す行（前の文「（ほかの牧場に入れます）」を言い換えた）。
   - 空き牧場の案内は `p.ideal-farm-empty`「空き m か所（拠点 2）。空いた牧場に置くなら おすすめ [3 番]・[4 番]」（番号は `button.ideal-farm-pick`、aria-label「おすすめ 3 番の組へ移る」）。拠点は空き牧場の拠点の名前を重ねずに。選べる組がなければ「おすすめには、牧場に置く組と個体が重ならない組がありません。」。出すのは complete で、計算したときの所持者が「すべて」のとき。選び方は `emptyPicks(advice, pairs, m)`（文書の D16 のとおり。none の牧場は out にない個体を残る個体とした）。
   - 保留中の行はチップ「判定を保留」で押せない。`p.ideal-farm-pending`「読めない牧場が n か所あるため、交換推奨・空き牧場・使用中の判定を保留しています」。D19 の注記（`small.ideal-warning`）は判定したときだけ。
6. **組へ移る（手順 7）**: カードに `data-key`（`planPairKey`）。`jumpTo(key)` は `.ideal-pair` の中から data-key で探し（CSS のエスケープを使わない）、親が `details.ideal-same` で閉じていれば開き（`sameOpen` も true にする。開閉のイベントと同じ扱い）、`scrollIntoView({ block: 'center', behavior })`（`matchMedia('(prefers-reduced-motion: reduce)')` なら `'auto'`）、`.is-flash` を付けて 1 秒（`FLASH_MS`）で外す。光らせている組は `flash = { key, timer }` で覚え、drawPlan で作り直したカードにも付け直す（画面の destroy でタイマーを止める）。CSS は `.ideal-pair.is-flash` の背景を secondary-container、動きを減らさない設定では `farm-flash`（1 秒で地の色へ戻す）。scroll-margin-top は、帯が出ているとき帯より後ろの要素に `--farm-strip-h` を足す規則（`.ideal-view:has(> .ideal-farm-strip:not([hidden])) > .ideal-farm-strip ~ *`）。**フォーカスは押したボタンに残す**（カードへ移さない。文書は決めていなかった）→ フェーズ 1b・1c の終わりのレビュー（A3）で、カードへ移す形に変えた（下の 16）。
7. **カードの札（手順 8）**: 札はどれも ideal-results の `tag(…)`（説明つきのボタン）。「配置中」は `joinName(名前, 'に配置中')`（英数字で終わる名前の後だけ空ける。「拠点 1 の牧場 A に配置中」「拠点の牧場に配置中」）。交換推奨の行き先の組に `button.ideal-farm-to`「→ 拠点 1 の牧場 B へ」（説明「配合牧場の判定で、この組をその牧場の今の組と入れ替えることを勧めています（交換推奨）。」）。持ち主が違う組に `button.ideal-owners`「Alice・Carol の個体」（♂・♀ の順。説明「♂ は Alice、♀ は Carol の個体です（拠点のパルは預けた人）。」。持ち主は拠点のパルなら `lastOwner`、ほかは `holder`〔「不明」は分からない扱い〕）。保留中は「配置中」と持ち主の札だけ。畳まない組（`pointed`）は、判定したときは swap の to と rank ≥ 0（none も）、保留中は牧場に入っている組の順位。空き牧場の案内が指す組は畳む（押すと開いて移る）。
8. **境目の線（手順 9）**: 作っていない（テストで `.ideal-farm-boundary` がないことを確かめる）。
9. **`ownedRow` の `marks`（手順 10。owned-rows が使う口）**: `ownedRow(pal, { notes, highlight, marks })`・`fillOwnedRow(row, pal, { notes = [], highlight, marks = [] })`。marks の文ごとに `.owned-badges` に `span.owned-badge.badge-mark`（warning-container の色）。理想個体のカードは「別の配合牧場で使用中（拠点 1 の牧場 C）」を渡す（complete のときだけ）。**`rowSignature` には marks を入れていない**（所持パルの一覧は marks を使わない）。owned-rows の O-52 で所持パルの一覧に印を出すときは、行の署名にも印を足すこと。
10. **計算のしくみ**: 「配合牧場と『変更あり』」の 2 つ目の段落の末尾に「牧場の判定を保留している間は「変更あり」は付きません。」を足した。docs/OPERATIONS.md の配合牧場の判定の節も新しい画面に合わせた（触るファイルの一覧にはなかった）。
11. **テスト**: test/core/ideal-farms.test.js に 5 件（readyFarms・farmCompleteness／targetFarms が uncertain を使わない／emptyFarms／farmNames〔A・B・C、並びが変わっても同じ、AA〕／farmsInUse）を足し、関数を作る前に落ちる（export がない）ことを確かめた。test/core/owned.test.js は牧場のテストを status つき・共有は ok だけ・status なしに直し、読み戻しの検証の 1 件の期待値に status を足した。ideal-view.test.js は 9 件を足し（帯と詳細の行を押して移る・光る・作り直しても付け直す・動きを減らす設定／帯の場所と「ほか n か所」／保留／保留中の「変更あり」／空き牧場の案内と畳まれた組へ移る・所持者で絞ると出さない・置いた牧場がないとき／見送った組の個体を案内しない／使用中の印と自分の個体の太字／持ち主の札／一覧にある見送りの「そのまま」）、どれも views/ideal.js・views/owned.js を変える前に戻すと落ちることを確かめた（15 件が落ちた）。期待値を直したもの: 画面の子の並び（帯）、牧場のテスト 4 件（行の形・2×2・外す／入れる行・「拠点の牧場 B に配置中」・見送りの数字）、計算のしくみの一文。**テストの偽 DOM（test/helpers/dom.js）は変えていない**。`scrollIntoView` は `t.mock.method(FakeElement.prototype, 'scrollIntoView')` で呼ばれた要素と引数を見る（文書の「:101 のモックを数える形に」の代わり）。
12. **固定の高さと結果を見られる範囲（ユーザーに確かめる点）**: 高さ 900px の窓で、ヘッダー 56＋条件のパネル 140.4（パッシブのチップが改行すると 177.4）＋帯 44 ＝ 240.4px が固定され、結果を見られるのは 659.6px（改行時 622.6px）。帯の高さは牧場の数・判定・保留で変わらないが、**帯の下の詳細は判定で高さが変わる**（モックのアヌビス〔2 か所・交換推奨 1・空きの案内〕で 447px。ホルス〔0 か所・空きの案内〕70.5px、ジェッドラン〔1 か所〕131.3px）。そのため 1 番目の組は、開いた直後は 806px（窓の下の端の近く）から始まり、目標を変えると結果の top は 429.5〜806px で動く。ideal-panel の「実装の記録」10 の「牧場の欄の高さは ideal-farms で直す」は、帯の高さだけを直した形。詳細を結果の下へ移す・閉じた状態で出すなどにするかは、ユーザーに確かめる。→ D22 で詳細を既定で閉じた 1 行にした（下の 15）。
13. **uncertain の牧場が出る条件（文書の「注意」の見立て）**: 解析（web/js/save/palworld.js）で uncertain になるのは、(a) 牧場の建物の Model／ConcreteModel が読めない（形の違い・件数の範囲外・ゼロ GUID。malformed.breedFarms に数える）、(b) 作業の割り当ての個体 ID が空か同じ牧場に重複、(c) 割り当てが 3 体以上、(d) 割り当てた親が Level.sav のキャラクターにいない（壊れて読めなかった個体・消えた個体の参照）。キャラクターはワールド全体が Level.sav に入るので、**ほかのギルドの拠点・仲間の拠点の牧場だからといって uncertain にはならない**。手元のセーブ（ホストの 14 ワールド。読み取りのみ）では、牧場のある 4 ワールドのうち今の形の 3 ワールド（牧場 13）はすべて ok、最後の保存が 2024-02 の古い形の 1 ワールドだけが 5 か所とも (a)（読めない形）で uncertain だった（そのワールドではいつも保留になる。前は牧場ごと捨てて判定を出さなかった）。ギルドが 2 つ以上あるワールドは手元になかった。→ ふつうのワールドで保留が続く見込みは低いので、文書のとおり「uncertain が 1 つでもあれば保留」にした。続くようなら、保留の範囲を「読めない牧場の引けた親にこの目標の親の候補がいる、または引けた親が 2 体未満でその拠点にこの目標の親の候補がいる牧場があるとき」に狭める案（実装していない）。
14. **後のテーマへの申し送り**: farm-data は 1・2 の名前を使い、`farmCompleteness(all, { partial: farmsPartial })` を views/ideal.js の `farmContext` で渡す。共有の uncertain（`s: 'u'`・親は空）を受けたら status `'uncertain'` に戻す（そうすると参加者の画面でも保留になる）。farm-board は `farmNames` と帯の部品（`.ideal-farm-cell`）・`jumpTo` の形を参考にする。owned-rows は 9 の `marks`。
15. **詳細を既定で閉じた（D22。2026-10-13、ブランチ `fix/ideal-farms-collapse`）**: 12 の「結果の top が判定と目標で動く」をユーザーに確かめ、「詳細は既定で閉じる（押すと開く・開閉は覚える）。帯から組へ移る動きは今どおり」となった。
    - 形: `section.ideal-farms` の中を `details.ideal-farms-fold > summary.ideal-farms-summary > h3`（見出しの文は今のまま「配合牧場（この目標の組を置いている K か所 · 交換推奨 n か所 · 空き m か所）」。交換推奨・空きを出す条件も 5 のまま）＋`div.ideal-farms-body`（「変更あり」の件数・保留の理由・牧場の行・空き牧場の案内）にした。h3 は summary の中に置ける（summary は見出しを 1 つ含められる）ので、見出しの役目と既存のテストの `box.querySelector('h3')` を残した。閉じていても中身は DOM にある（テストの偽 DOM は open を見ないので、牧場のテストの期待値は変えていない）。
    - **details は作り直さない**: 画面を作るときに 1 つだけ作り、`renderFarmBox` は見出しの文（変わったときだけ）と `farmBody` の中身だけを書き換える。そのため 20 秒ごとの確認・計算に効かない読み直し・判定の変化（交換推奨 ↔ そのまま など）・目標の切り替えでも開閉は変わらない（ideal-results の `details.ideal-same` は描くたびに作り直して `sameOpen` から開閉を戻す形だが、こちらは見出しにフォーカスがあっても外れない）。出すもの（この目標の組の牧場・空き牧場の案内）がないときは details を section から外し、出すものができたら付け直す（開閉はそのまま）。
    - **開閉は viewState の `farmsOpen`**（`toggle` で書く。ideal-results の「実装の記録」7 の `sameOpen` と同じ仕組み）。IDEAL_MEMORY（sessionStorage と履歴のエントリに保存する条件の形）には入れない。開閉は見え方の好みで計算の条件ではないので、戻る・進むで条件といっしょに変わらないようにするため（タブを切り替えて戻ると開いたまま、読み込み直すと閉じる。ログアウトで消える）。viewState がない画面（テストなど）は、画面の中で同じ要素が開閉を持つ。
    - **場所を残す**: 帯が出ているとき（目標を選んでいて牧場の情報があるとき）は、詳細に出すものがない・計算中でも、閉じた 1 行の高さ（`--farm-fold-h`）の見えない場所を残す（`.ideal-farms:empty` を visibility: hidden に。帯の「中身がなくても場所を残す」と同じ）。これで閉じている間は、目標や判定が変わっても結果の top が変わらない。帯が出ないとき（目標なし・牧場の情報なし）は `hidden` で場所も取らない。高さは 44px（全体の `summary { min-height: 44px }` に合わせた。はじめ 36px にしたら閉じた 1 行が 44px になり、場所だけのときと 8px ずれた）。見出しは 1 行に固定し、入らない幅では省略記号（全文は summary の title）。
    - **帯の「ほか n か所」は詳細を開いてから移る**（残りの牧場は詳細にしかないため。`farmsOpen` も true にする）。帯のセル・詳細の行・空き牧場の「3 番」から組へ移る動き（`jumpTo`）は変えていない（帯から移るときは詳細を開かない）。
    - 画面（phase-1a の「計測の記録」の D22 の行）: 1100×900 のアヌビス（2 か所・交換推奨 1・空き 2）で、閉じた 1 行は top 378.98・高さ 44、1 番目の組の top は 432.98（12 の 806px は owned-status の 1 行〔約 30px〕が入る前の値）。開くと詳細 453.31px・1 番目の組 842.3。閉じたままホルス・ジェッドラン・アヌビス・ホルスで所持者 Bob（出すものなし）とも結果の top 432.98。保留中（`inject-uncertain.js`）も「配合牧場（この目標の組を置いている 2 か所）」の 1 行で、開くと理由と「判定を保留」の行。
    - テスト: ideal-view.test.js に 1 件（既定で閉じる・summary は見出しだけ・帯から移っても開かない・開閉を viewState に残す・描き直しと判定の変化で同じ要素のまま開いている・出すものがなくなっても場所を残し戻れば開いたまま・タブの切り替えで残る・目標なしと牧場の情報なしでは hidden）を足し、「ほか n か所」のテストに「開いてから移る」を足した。どちらも変える前のコードで落ちることを確かめた。docs/OPERATIONS.md の配合牧場の画面の文も直した。
16. **フェーズ 1b・1c の終わりのレビューの直し（2026-10-13、ブランチ `fix/phase-1bc-review-ideal`。指摘 A1 の牧場の分・A2〜A6・A12）**:
    - **A1 描き直しのフォーカス（帯・詳細）**: 帯のセル `farm-cell:<牧場 ID>`・「ほか n か所」`farm-more`・詳細の行の上の段 `farm-row:<牧場 ID>`・空き牧場の番号 `farm-pick:<組の key>`（番号が変わっても、同じ組へ移る番号へ戻す）・詳細の見出し `farm-fold`（details は作り直さないが、出すものがないと外す）に `data-focus-key`。帯と詳細は今までどおり `replaceChildren` で作り直し、ideal-results の 13 の captureFocus／restoreFocus で同じ部品へ戻す（帯を syncList にはしていない）。画面（`review-fix-ideal/a1-a3-a4.js`。1100×900・inject-farms.js）: 帯のセル・詳細の行・空き牧場の番号・組の目的の札・配置中の札・行のパル名のそれぞれで、レベルだけを変えた更新（作り直し）と結果に入る個体を足した更新（計算し直し）の後も、フォーカスは同じ data-focus-key の新しい要素（body に落ちない）。札の説明の板を Enter で開いたまま結果が変わると、板は閉じ、フォーカスは同じ組の札（:focus-visible のまま）。21.5 秒待っても（20 秒ごとの確認・データは同じ）帯のセルは同じ要素のまま。
    - **A2 保留が解けたときの「変更あり」**: `showPlan` は交換推奨の行き先で絞る前の `planChanges(...).changed` を `shown.changed` に残し、**絞るのは `paintPlan` で判定できるとき**（交換推奨の行き先の組 `farmTo` だけ）にした。前は保留中に計算し直すと絞った後の空の集合を残し、読めるようになっても（計算に効かないので drawLatest で描き直すだけ）開き直すまで「変更あり」が出なかった。D10・D13 の決まりは変えていない（上の 3 の「drawPlan も保留中は出さない」も同じ）。
    - **A3 組へ移ったときのフォーカス（上の 6 を変えた）**: `jumpTo` は scrollIntoView の後に、**カードへ `tabIndex = -1` と `focus({ preventScroll: true })`**。6 の「フォーカスは押したボタンに残す」をやめた理由: ページ内リンクの作法で、読み上げでは移った先（「n 番目の組」）が読まれ、キーボードでは次の Tab がカードの中（組の目的の札）から続く。押したボタンに残すと、読み上げでは何も起きないように聞こえ、Tab で帯から詳細・結果を順にたどり直すことになっていた。動かすのは scrollIntoView に任せる（focus でも動かすと、なめらかな動きを止めて別の位置へ動かしうる）。カードにフォーカスがあるまま作り直したら、新しいカードにも tabIndex -1 を付けて戻す（ほかのカードには付けない）。画面: Enter で 2 つ目の組へ移ると scrollY 249、カードの中心は帯の下の見える範囲の中心から +4px、:focus-visible の枠（ライト・ダーク）。次の Tab は同じカードの組の目的の札。マウスで押したときは枠を出さない。
    - **A4 着地点**: `.ideal-view` の子の `scroll-margin-top` を `var(--panel-h, 0px)`、帯より後ろを `calc(var(--panel-h, 0px) + var(--farm-strip-h))` にした（html の `scroll-padding-top` がヘッダーと 8px を受け持つので、前はヘッダーの分と 8px〔約 64px〕余分に下がっていた。所持パルの owned-toolbar の記録 10 と同じ）。test/static/styles.test.js が scroll-margin-top に --header-h を足していないことを確かめる。画面: 詳細へ scrollIntoView({ block: 'start' }) で top 247.98（ヘッダー 56＋8＋パネル 140.38＋帯 44＝248.38）、パネルと帯の下に隠れた札・行のパル名へ focus() すると、帯の下端の 7.5px 下に出る。組へ移る（block: 'center'）は、カードの中心が帯の下の見える範囲の中心に来る（前は 32px 下）。
    - **A5 帯のセルの読み上げ**: セルの絵（`.ideal-farm-cell-pals`）は aria-hidden にし、その後ろに `span.visually-hidden`「（名前♂ × 名前♀）」。押せるセルは今までどおり aria-label が名前。画面の aria snapshot（inject-skip.js の押せないセル）: 「拠点 1 の牧場 C （キツネビ♂ × キツネビ♀） ✓ そのまま」。
    - **A6 フォーカスの枠**: `.ideal-pair .owned-row` を `contain: layout style` にした（`.owned-row` の `contain: strict` の paint の切り取りで、左の余白 0 のパル名のリンクの枠の左が切れていた。組の行は content-visibility: visible なので size も要らない）。帯の中は `.ideal-farm-strip :focus-visible { outline-offset: -2px }`（帯は overflow: hidden なので枠を内側に描く。所持パルの .filter-chip と同じ）。画面: パル名の枠の外側は行の左端の 4px 左まで見え、帯の先頭のセルの枠は帯の中（撮影 `review-fix-ideal/a6-*.png`）。測るときは、入るときの枠の動き（focus-in。6px → 2px）が終わってから。
    - **A12**: `.ideal-farms-summary` に `min-height: 0`（閉じた 1 行の高さは `--farm-fold-h` だけで決める。上の 15 の「全体の summary の min-height 44px に合わせた」は偶然そろっていただけだった）。test/static/styles.test.js が、`.ideal-farms-summary` と `.ideal-farms:empty` が `--farm-fold-h` を使うことを確かめる。
    - スクリプトと撮影: `Claude outputs/ui-audit-2026-10/shots/owned/review-fix-ideal/`（a1-a3-a4.js・a4-focus.js・a6-a15.js・a5-dark.js・a9-mode-label.js と png）。
17. **フェーズ 1b・1c の終わりのユーザーの答え（2026-10-13、ブランチ `fix/phase-1bc-answers`。D27）**:
    - **詳細の閉じた 1 行の文**: 「配合牧場（この目標の組を置いている K か所 · 交換推奨 n か所 · 空き m か所）」→「**配合牧場の詳細（置いている K か所・交換推奨 n・空き m）**」。交換推奨・空きを出す条件は前と同じ（交換推奨は判定できるとき〔保留中でない〕、空きは空き牧場の案内を出すとき）で、**0 のときは出さない**（自分で決めた。閉じた 1 行は開くかどうかの手がかりなので 0 は省き、牧場ごとの判定〔✓ そのまま・⇄ N 番へ〕は上の帯で見える）。「置いている K か所」はいつも出す（0 か所でも。空き牧場の案内だけのとき「置いている 0 か所・空き 2」）。区切りは「・」。保留中は「置いている K か所」だけ（前と同じ。保留は帯の文で分かる）。画面（inject-farms.js のアヌビス）: 「配合牧場の詳細（置いている 2 か所・交換推奨 1・空き 2）」（`answers/farm-fold-1100-light.png`）。
    - 帯の「— N 番」（押せる）と、詳細の開閉の記憶が同じタブの間だけ（viewState）なのは今のまま（D27）。
    - テスト（ideal-view.test.js）は見出しの期待値 8 か所を新しい文に直した（交換推奨 0 の 3 か所は数を出さない形）。

18. **2026-10-14 のユーザーのフィードバック（ブランチ `fix/feedback2-ideal`。D30。理想個体の分。細部は担当が決めた）**:
    - **帯**（原文「「この目標の組を置いた牧場はありません」の文言も不要。」）: この目標の組を置いた牧場がない（保留でもない）ときは、文を出さず **`farmStrip.hidden`** で場所も取らない。`renderStrip` が中身に合わせて hidden を決める（前は renderResults のはじめに「目標を選んでいて牧場の情報があれば」場所を取っていた）。保留中の「牧場の判定を保留（読めない牧場が n か所あります）」は残した（読めない牧場がこの目標の牧場かもしれないため）。足りないパッシブの案内・帯・詳細を消すのは **`clearFarms()`**（`clearPlan` と、初めての計算の「計算中…」のとき）。上の 4 の「計算の前・計算中・データの待ちでも hidden を外して場所を取る」と「この目標の組を置いた牧場はありません（空き n か所）」は、この形に変わった。空き牧場の数は詳細の閉じた 1 行（「配合牧場の詳細（置いている 0 か所・空き 2）」）に出る。
    - **詳細**: 出すもの（この目標の組の牧場・空き牧場の案内）がないときは `renderFarmBox` が **`farmBox.hidden`** にする（details を外すのは今までどおり。開閉は覚えたまま）。CSS の `.ideal-farms:empty { height: var(--farm-fold-h); visibility: hidden; }`（上の 15 の「場所を残す」）を消し、test/static/styles.test.js はこの規則がないことを確かめる形にした。上の 15 の「閉じている間は、目標や判定が変わっても結果の top が変わらない」は成り立たなくなった（ユーザーの判断: 目標を変えたときに下が動くのは利用者の操作なのでよい）。牧場の中身がセーブで変わった（この目標の組を牧場に置いた・外した）ときも帯と詳細が出入りして結果が動く（ゲームの中の利用者の操作なので同じ扱い）。
    - **一覧にない「そのまま」**（D15 の数字）: 行の下の `small.ideal-farm-measure`「おすすめの一覧にない組 · 完成まで 平均 約 N 個」と `measureText`・`perEggs` を消し、チップを **「そのまま（おすすめにない組）」**（`farmState`）にした。決めた理由: 「おすすめの一覧にない組」の情報は、押せない行の理由として残す方がよいが、行を 1 つ減らせる（表示を減らす）ので、置く組のない牧場のチップ「おすすめにない組（ほかに置く組がありません）」と同じくチップに入れた。帯のセルの title・読み上げもこのチップの文になる。上の 5 の「一覧にない「そのまま」は small.ideal-farm-measure…」は、この形に変わった。CSS の `.ideal-farm-measure` を消した。
    - **空き牧場の案内**（前の担当〔`fix/feedback2-owned`〕の申し送り「既定が自分になったので、空き牧場の案内が「すべて」を選ばないと出なくなった」）: **所持者が「すべて」か自分（既定。`'mine'`）のとき**に出す。ほかのプレイヤーを 1 人選んでいるときは出さない（その人の個体の組を空き牧場に案内することになるため）。あわせて、**組が 1 つもないとき（`result.total` が 0）も出さない**（案内する組がないのに「おすすめには、牧場に置く組と個体が重ならない組がありません。」と詳細の 1 行が出ていた。自分を既定にしたことで、組のない目標でも出るようになったため）。上の 5 の「出すのは complete で、計算したときの所持者が「すべて」のとき」は、この形に変わった。
    - 画面（モック・inject-farms.js・Alice。`shots/owned/feedback2-ideal/scenarios.js`）: アヌビスで所持者が自分（牧場の親に Bob・Carol の個体がいるので、この目標の組の牧場はない）は帯なし・詳細「配合牧場の詳細（置いている 0 か所・空き 2）」で 1 番目の組の top 326.5px、所持者すべては帯（拠点 1 の牧場 A「✓ 2 番」・B「⇄ 1 番へ」）と「配合牧場の詳細（置いている 2 か所・交換推奨 1・空き 2）」で 376.5px。組が 0 のグランモス（♀ だけ）は帯も詳細も出さず、結果の欄の案内だけ。1100・920px とも横のはみ出しなし。

---

## owned-status: 読み込みの状態を固定スロットに、データ元を 1 行に

### 目的
1 分ごとの読み直しのたびに出入りする「読み込み中…」「共有中…」の帯をやめ、要約の行の右端の幅が固定されたスロットに出す（一覧が上下しない）。「どのワールドの・どこから・いつのデータか」の 1 行を所持パル・理想個体・継承ルートで共通にし、データがないときだけ設定へのボタンを出す。

### 経緯
- 本セッションの案: **O-27**（判断: `state.busy` の意味とタイミングは自動登録の安全装置なので**変えない**。web/js/auto-register.js:99 が `o.busy` で止まる。画面用に `state.activity` を足す）・**O-32**（「ファイル未登録」はデータがないときだけ、ボタンつきで。所持パルの画面で設定を操作しないという前の設計＝views/owned.js:92 のコメントを変えることになる）・**O-35**（判断: 読み取り専用の 1 行。ワールドの切り替えと「今すぐ読み込む」は設定に残し、行の右に「設定 →」）・**O-36**（判断: 理想個体と同じタイマーを所持パルにも。時刻は O-35 の 1 行に任せる）・**C-08**（確認中もエラーの行を消さず、状態の文字幅を固定）・**C-32**（判断: 場所の分からないパルを所持パルの案内に 1 行。内訳とファイルの一覧は出さない）。別プランの **F062**（読み込み中は要約行の右端の固定スロットに）。
- 統合プランの header-frame（1a）がヘッダーにセーブ連携の状態（ワールド・セーブ時刻・自動登録・許可が必要）を出す。この画面の 1 行は「この画面の結果がどのデータか」を示すもので、ヘッダーと役割を分ける（ヘッダーは全体の状態と操作、画面の 1 行は読み取り専用）。

### 依存
header-frame（ヘッダーの状態表示。文言の作り方をそろえる）。理想個体の要約（ideal-results）の上に 1 行を置くので、ideal-results の後。

### このテーマでやらないこと
- `state.busy` の意味・タイミングの変更（自動登録の判定が壊れる）。読み込みの仕組み（owned.js の serial・autoTask の流れ）の変更。
- 3 タブにワールドの切り替え・「今すぐ読み込む」を置くこと（O-35 の判断。誤操作の影響が大きい）。
- 読み込みの詳細（場所ごとの数・読んだファイルの一覧）。参加者の画面での `stats`（共有データにはない）。
- 設定の「データの状態」カードの削除（フェーズ 2 の settings）。

### 現状
- ストア（web/js/owned.js）: `state` に `ready・busy・progress・error`（:163）・`auto.status/error`・`shared.fetchedAt`・`upload.status`（:162-175）。`serial`（:267-278）は読み直すか決める前に `busy = true` を emit し、終わったら `busy = false; progress = ''`。`autoTask`（:420-）は始めに `auto.status = 'checking'; auto.error = ''` を emit（:423-425）し、変わっていなければ `'unchanged'` を返す。結果が出たら `status = 'ready'`（:448）、必要ならエラーを入れ直す（:449-450）。`'empty'` の文は「セーブのファイルが登録されていません。設定タブの「セーブ連携」の「＋ ワールドを登録」で登録してください」（:433）。`uploadLocal` は `upload.status = 'sending'`（:336）。`pollAuto` は 60 秒ごと（web/js/app.js:340）で共有を読まない（owned.js:558-565 付近）。`autoRefresh`（:550-557 付近）は 20 秒以上空いていれば読み、それ以外は `fetchShared`（30 秒の制限、:286）。
- 案内（web/js/ui/owned-status.js:42-80 の `ownedNotices`）: `!state.ready` で「保存済みのデータを確認中…」だけ（:44）、`busy` の間は「読み込み中…」を足す（:45）、`linkLabel` が空（自動の読み込みがオフ）ならデータがあっても 67 字の「セーブのファイルが登録されていません。…」（:46-47）、参加者向けの文（:53-56）、共有中（:58-60）、読めなかったファイルと Players の警告は `!state.busy` のときだけ（:63-64）。案内は絞り込みより上（views/owned.js:157）なので、出入りのたびに一覧が約 40〜45px 上下する。
- 所持パルの要約: `renderSummary`（views/owned.js:164-171）が「「テスト」（ホスト Alice） · 4 体」（`.owned-world`）と「セーブの更新: … · 共有: …」（`.owned-times`、`timeLines` は owned-status.js:32-39）と案内を出す。理想個体・継承ルートには、どのワールドのいつのデータかが出ない。
- 設定（web/js/views/owned-settings.js:375-）: `autoState` の文字（:378。「確認中…」⇔「読み込み済み」で幅が変わる）、`autoError.hidden = !autoError.textContent`（:380-381。確認のたびに消えてまた出る）。
- `stats`（`unknownLocation`・`malformed` など）は buildSnapshot（web/js/save/palworld.js:1040-1045 ほか）で数えるが、画面では使っていない。`normalizeOwned` は `stats: snapshot.stats`（core/owned.js:209）、共有からは `stats: {}`（:524）。
- 所持パルの画面は開いた時に 1 回だけ `autoRefresh`（views/owned.js:243）。開いたままでは共有を読み直さない（理想個体は 20.5 秒ごと、views/ideal.js:518-525）。

### 実装の手順
1. **画面用の `state.activity`**（web/js/owned.js）: `state` に `activity: ''`（`'' | 'checking' | 'reading' | 'sharing'`）と `checkedAt: ''` を足す。
   - `autoTask` の始め（:423 の隣）で `activity = 'checking'`。`runImportTask` の始め（:371 の隣）と `previewTask` の読み込み（:522 の隣）で `activity = 'reading'`。`uploadLocal` の送信（:336）で `activity = 'sharing'`。
   - `serial` の終わり（:273）で `pending` が 0 なら `activity = state.upload.status === 'sending' ? 'sharing' : ''`。`uploadLocal` の終わりで `!state.busy` なら `activity = ''`。
   - `autoTask` の結果が出たとき（どの return でも）と `fetchShared` の成功で `checkedAt = new Date(now()).toISOString()`。
   - `busy` と `progress` は今のまま（自動登録はこれを見る）。
2. **確認の始めにエラーを消さない**（C-08）: :424 の `state.auto.error = ''` を消し、:448 の `state.auto.status = 'ready'` の直後で `state.auto.error = ''` にしてから :449-450 の文を入れる。`stop()`（:407-412）は今どおりエラーを入れる。`'empty'` の文（:433）は「自分のセーブを読むには、設定でワールドを登録してください」に短くする（O-32 とそろえる）。
3. **案内（`ownedNotices`）を対応が要るものだけに**（O-27・O-32・C-32）:
   - :44 の「保存済みのデータを確認中…」と :45 の busy の行を消す（スロットへ）。:63-64 の `!state.busy` の条件を外す（読んでいる間も前回の警告を残す）。
   - :46-47 を「`!state.meta?.source`（表示できるデータがない）かつ自動の読み込みがオフ」のときだけにし、文を「自分のセーブを読むには、設定でワールドを登録してください。」、`action: 'settings'`。
   - :53-56 の参加者向けは、データがないときの「ホストがまだこのワールドの所持パルを共有していません。」だけ残す（「参加しているワールドのため…」は消す。取得元は 1 行に出る）。
   - :58-60 の共有は `sending` を出さない（スロットへ）。`stale`・`error` は残す。
   - 場所の分からない個体（C-32）: `state.owned.stats.unknownLocation > 0` で、Players の警告（:67-68）が出ていないとき「場所が分からないパルが N 体います」＋ `action: 'unknownPlace'`。`malformed` の合計が 0 でなければ「セーブの一部を読めませんでした（ゲームの更新で形が変わったかもしれません）」（kind: warning）。`stats` はこの PC で読んだデータにしかない。`orphanEggs` は出さない（ふだんから 0 でないことがあるため。実データで確かめるまで）。
4. **案内のボタン**（views/owned.js:98 の `noticeActions`）に `settings: { label: 'セーブ連携を開く', run: () => context.navigate('#/settings') }` と `unknownPlace: { label: '見る', run: () => context.navigate(buildHash('owned', { place: 'unknown' })) }` を足す（行き先の `?open=auto` はフェーズ 1d の participant-self・copy-dead-ends が作る）。
5. **データ元の 1 行**（O-35。web/js/ui/owned-status.js に足す）:

   ```js
   /** 状態の文（スロット用）。activity が空なら最後に確認した時刻。 */
   export function activityText(state) → { kind: 'busy' | 'idle', text: string }   // 例「確認中…」「Level.sav を読み込み中…」「共有中…」「最終確認 13:42」
   /** データ元の 1 行: 「テスト」（ホスト Alice）· この PC／共有 · 1194 体 · セーブ 10/10 09:00。データがなければ ''。 */
   export function sourceText(state) → string
   /** 1 行の部品（右端に固定幅の状態スロット。許可が切れたら「読み込みを許可」、右に「設定 →」）。 */
   export function ownedSourceLine({ actions }) → { element, update(state), destroy() }
   ```
   - `element` は `div.owned-source`（1 行・高さ固定・ellipsis・title に全文）＝ `span.owned-source-text` ＋ `span.owned-activity`（幅 11em 固定。`kind: 'busy'` のときは小さな回る SVG＋文。`prefers-reduced-motion` では回さない）＋ 許可のボタン（`state.auto.status === 'permission'` のときだけ。`visibility` で場所を残す）＋ `a.owned-source-settings`「設定 →」（`#/settings`）。
   - `aria-live` は付けない（1 分ごとに読み上げない。エラーは案内の帯で知らせる）。
6. **所持パルの要約**（views/owned.js:93-99・:164-171）: `.owned-world`・`.owned-times` の 2 行を `ownedSourceLine` の 1 行に置き換える（「共有: …（Alice）」と「この PC で読み込み: …」は title に入れる）。案内（`notices`）はその下に残す（対応が要るものだけになったので、ふだんは出ない）。
7. **理想個体と継承ルートに 1 行**: 理想個体は要約（ideal-results の `.ideal-summary`）の上に `ownedSourceLine`。ideal-results で要約の右端に出していた「セーブ …」は外し、「最終確認」はスロットの表示に任せる（`checkedAt`）。継承ルートは所持パルの欄（`ownedSection`、web/js/views/route.js:58・`renderOwned` :115-）の先頭に置く（所持パルのデータがあるときだけ）。どちらも `owned.subscribe` で `update(state)` だけを呼ぶ（結果は描き直さない）。（追記 2026-10-13、ideal-results の実装の後: 要約の行は `div.result-note.ideal-summary` の固定の 3 つの子〔`span.ideal-summary-text`・`button.ideal-excluded`・`span.ideal-checked`〕。「最終確認 … · セーブ …」は views/ideal.js の `renderChecked()` が `span.ideal-checked` に書くので、「セーブ …」はその 2 つ目の部分を消し、「最終確認」をスロットに任せるなら `span.ideal-checked` ごと外す。確認の時刻は `refresh` の `lastChecked`〔読めなかった確認では進めない〕。ideal-results の「実装の記録」2・3）
8. **参加者も開いている間は読み直す**（O-36）: views/shared.js に

   ```js
   /** 開いている間、interval ごとに owned.autoRefresh() を呼ぶ（タブが裏にある間は呼ばない）。戻り値で止める。 */
   export function keepRefreshing(owned, { interval = 20500 } = {}) → () => void
   ```
   を足し、理想個体（views/ideal.js:518-525 の自前のタイマーを置き換え）と所持パル（views/owned.js:243 の隣）で使う。destroy で止める。GAS の呼び出しは `fetchShared` の 30 秒の制限（owned.js:286）で抑えられる（ownedWorlds の一覧だけで、本体の行は `uploadedAt` が変わったときだけ読む）。
9. **設定の状態の幅**（C-08、views/owned-settings.js:378-381）: `autoError` は `hidden` を切り替えず、空のときは `visibility: hidden` で 1 行分の場所を残す。`.owned-auto-state` に `min-width: 7em`（app.css:843 付近）。
10. CSS: `.owned-source`（1 行・高さ 28px）・`.owned-activity`（幅 11em・右寄せ・tabular-nums）・回る SVG（`@media (prefers-reduced-motion: no-preference)` の中だけで回す）。`.owned-summary`・`.owned-world`・`.owned-times`（app.css:1202-1204）を整理する。

### 触るファイル
- 変更: `web/js/owned.js`（:162-175・:267-278・:325-360・:369-375・:420-450・:520-526・:282-320）、`web/js/ui/owned-status.js`（:42-80 と新しい関数）、`web/js/views/owned.js`（:92-99・:164-171・:243）、`web/js/views/ideal.js`（要約の上・:518-525）、`web/js/views/route.js`（`renderOwned` の先頭）、`web/js/views/shared.js`（`keepRefreshing`）、`web/js/views/owned-settings.js`（:378-381）、`web/css/app.css`（:843・:1202-1214）、`web/js/release-notes.js`

### テスト
- **追加** `test/web/owned-store.test.js`: (1) 変わっていないセーブの確認で `activity` が 'checking' → '' になり、`busy` の動きは今と同じ（:261-267 の確認は残す）。(2) 読み込みで 'reading'、共有で 'sharing'。(3) 確認の始めに `auto.error` が消えず、結果が出たら更新される。(4) `checkedAt` が入る。
- **追加**（owned-view.test.js）: (1) busy の間も案内の数が変わらない（帯が出入りしない）。(2) データがあって自動の読み込みがオフなら「設定でワールドを登録」の案内が出ない。データがなければ出て、ボタン「セーブ連携を開く」で `#/settings` へ。(3) `stats.unknownLocation` があれば「場所が分からないパルが N 体います」と「見る」。(4) 開いている間、タイマーで `autoRefresh` が呼ばれ、destroy で止まる。
- **追加**（ideal-view.test.js・route-view.test.js）: データ元の 1 行が出て、所持パルの更新でその行だけが変わる。
- **期待値が変わる既存のテスト**:
  - `test/web/owned-view.test.js:71`（`.owned-world` の「「テスト」（ホスト Alice） · 4 体」）・`:72`（`.owned-times` の「セーブの更新: … 共有: …（ホスト）」）→ `.owned-source-text` の 1 行と title に。
  - `:213-218`（「セーブのファイルが登録されていません。.*設定タブ」と「読み込む|連携 のボタンが 0 個」）→ データがないときの新しい文と「セーブ連携を開く」のボタンが 1 つ、に（所持パルの画面で設定を操作しない、という前の設計を変えたことをテスト名にも書く）。
  - `:417-428`（許可の案内の中のボタン）: 案内の帯の中のボタンは残す。1 行にも許可のボタンが出るので、ボタンの数を確かめていれば直す。
  - `test/web/ideal-view.test.js:266-`（20 秒ごとの読み直し）: `keepRefreshing` に置き換えても、閉じた後に読まないことを確かめる形は同じ。

### INV-2・互換・セキュリティ・性能の注意
- **`busy` の意味を変えない**（auto-register.js:99 と test/web/auto-register.test.js:161）。`activity` は画面だけが読む。
- 古い IndexedDB（`stats` がない・形が違う）でも、`stats?.unknownLocation` を数値として確かめてから使う（data-boundary の検証を通す）。
- タイマーは裏のタブでは呼ばない（`visibilityState === 'hidden'`）。参加者の数だけ GAS の ownedWorlds の呼び出しが 30 秒に 1 回増える（O-36 のリスクとして受け入れ済み）。
- 1 行の文は textContent。SVG は `createElementNS`。

### release-notes の案
- id: `<実装日>-owned-status`
- title: 「読み込み中も一覧が動かない」（13 字）
- body: 「読み込みの状態は要約の右端に出します。理想個体と継承ルートにも、どのワールドのいつのデータかを出します。」（52 字）

### 完了の条件
- [x] `npm test` が通る（auto-register のテストを含む）。（1,321 件・exit 0）
- [x] モックで所持パルを開いたまま、1 分ごとの確認と 20 秒ごとの読み直しをまたいでも、絞り込みと一覧の top が変わらない（帯が出入りしない。layout-shift 0）。（70 秒で絞り込み 157.69・一覧 627.66 のまま、layout-shift 0。確認中・読み込み中・共有中の状態を入れても 0。phase-1a の「計測の記録」）
- [x] 状態のスロットの幅が「確認中…」「最終確認 13:42」で変わらない。設定のセーブ連携でもエラーの行が点滅せず、横のボタンが動かない。（スロットは 121px のまま。設定は状態の文 84px・「今すぐ読み込む」の左 308.5px・エラーの行の高さ 18.59px のまま。モックではファイルを登録できないので、設定は状態を入れて確かめた）
- [x] 所持パルを表示できているときは「ファイル未登録」の帯が出ない。データがないときはボタンで設定へ行ける。
- [x] 理想個体と継承ルートに「「ワールド」· この PC／共有 · N 体 · セーブ M/D HH:MM」の 1 行が出る。
- [x] 参加者（共有だけを見る）で所持パルを開いたまま、ホストの共有の更新が 30 秒程度で反映される。（実測は最大 約 41 秒。20.5 秒ごとの読み直しと共有の 30 秒の制限が重なるため。実装の記録 11。ユーザーに確かめる）
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — `busy` の意味を変えていない（`test/web/auto-register.test.js:161` が通る）。`stats` のない古い IndexedDB でも壊れない。性能 — 定期の読み直しは裏のタブ（`visibilityState === 'hidden'`）では動かない。セキュリティ — 1 行の文は textContent（`test/static/security.test.js`）。INV-2 — 対象外。

### TODO
- [x] owned.js に `activity` と `checkedAt` を足し、各所で入れる（busy は変えない）
- [x] 確認の始めに `auto.error` を消さないようにし、'empty' の文を短くする
- [x] owned-store のテストを足す
- [x] `ownedNotices` から busy・確認中・共有中を外し、未登録の案内をデータがないときだけにする
- [x] 場所の分からないパル・読めなかった項目の 1 行と「見る」を足す
- [x] `activityText`・`sourceText`・`ownedSourceLine` を作る
- [x] 所持パルの要約を 1 行に置き換え、案内のボタン（設定・見る）を足す
- [x] 理想個体の要約の上と継承ルートの所持パルの欄に 1 行を置く
- [x] `keepRefreshing` を作り、理想個体と所持パルで使う
- [x] 設定の `autoError` と `.owned-auto-state` の幅を固定する
- [x] owned-view・ideal-view・route-view のテストを直し・足す
- [x] release-notes に 1 件足し、1 分以上開いたままで動かないことを確かめる

### 実装の記録（2026-10-13、ブランチ `feature/owned-status`）

実装のときに決めたこと・文書と違う形にしたこと（後のテーマ owned-toolbar・owned-rows・フェーズ 1d の participant-self・copy-dead-ends・cleanup-dead-code・フェーズ 2 の autoreg-visibility・roles はこちらを正とする）。

1. **`state.activity`・`state.checkedAt`（web/js/owned.js。手順 1）**: `activity` は `'' | 'checking' | 'reading' | 'sharing'`（画面だけが読む。`busy`・`progress` の意味とタイミングは変えていない。auto-register のテストが通る）。入れる所は文書のとおり: `autoTask` の始めに `'checking'`、`runImportTask` の始めと `previewTask` のホストの読み込みで `'reading'`、`uploadLocal` の送信で `'sharing'`、`serial` の終わり（pending 0）で `upload.status === 'sending' ? 'sharing' : ''`、`uploadLocal` の終わりで `!busy` なら `''`。`fetchShared` では `activity` を変えない（参加者の 30 秒ごとの共有の読み直しは「確認中…」を出さず、終わったら時刻だけが変わる）。
   - **`checkedAt`（ISO の文字列）は、確かめ終えて読めたときだけ入れる**: `autoTask` が `'unchanged'`・`'guest'`・`'imported'` を返すとき（中の `checked()`）と `fetchShared` が成功したとき（`shared.fetchedAt` と同じ値）。文書の「autoTask の結果が出たとき（どの return でも）」から、`stop()`（許可・登録なし・読めない）と読み込みの失敗では進めない形にした。ideal-results の「読めなかった確認では時刻を進めない」（その記録 3 とテスト）を引き継ぎ、読めていないのに「最終確認 13:42」と出さないため。
2. **確認の始めのエラー（手順 2）**: `autoTask` の始めの `state.auto.error = ''` を消し、`status = 'ready'` の直後で消してから「選んだワールドの登録がないため…」などを入れ直す。`'empty'` の文は「自分のセーブを読むには、設定でワールドを登録してください」（句点なし。案内の帯は下の `REGISTER_TEXT` で句点つき）。
3. **案内（`ownedNotices`。手順 3）**: `!ready` のときは空。`auto.enabled` でないときは、表示できるデータ（`meta.source`）がないときだけ `REGISTER_TEXT`「自分のセーブを読むには、設定でワールドを登録してください。」（kind info・action `'settings'`）。`auto.status` が `'permission'` は今のまま（action `'grant'`）、**`'empty'` も同じ `REGISTER_TEXT`＋action `'settings'`（kind warning）にした**（文書は `'empty'` の扱いを決めていなかった。前の「〜（設定タブで確認できます）」だと短くした文と重なるため）。`'error'` は今のまま「〜（設定タブで確認できます）」。参加者は「ホストがまだこのワールドの所持パルを共有していません。」だけ（データがあるときの「参加しているワールドのため…」は消した）。共有の `sending` は出さない（`uploadText` から消した）。読めなかったファイル・Players の警告は `!busy` の条件を外した。
   - 場所の分からないパル（C-32）: この PC で読んだデータ（`meta.source === 'local'` の `data.snapshot.stats`。文書の `state.owned.stats` と同じ値で、共有のデータには無い）の `unknownLocation` を core/boundary.js の `int(…, { min: 0, fallback: 0 })` で数にしてから、0 より大きく Players の警告が出ていないとき「場所が分からないパルが N 体います」（kind info・action `'unknownPlace'`）。`malformed` は `isObject` の値ごとに `int` で数えた合計が 0 でなければ「セーブの一部を読めませんでした（ゲームの更新で形が変わったかもしれません）」（kind warning）。`orphanEggs` は出さない。手元の実セーブ（ホストの 14 ワールド。読み取りのみ・数だけ）: 今の形（2026-09〜10 の 3 ワールド）と 2025-12 の 3 ワールドは unknownLocation 0・malformed なし、2025-12 の 1 ワールドは unknownLocation 454、2024-02 の古い形の 7 ワールドはどれも malformed あり（itemSlots など）で、多くが unknownLocation もあり。orphanEggs は今の形でも 13〜37 個ある（文書のとおり出さない）。
   - 使わなくなった `linkLabel`（ui/owned-status.js）は消した（**cleanup-dead-code の「`linkLabel` は消さない（:46 で使っている）」はもう当てはまらない**。roles のテストの「`linkLabel`・データの有無の組み合わせ」は、`auto.enabled` とデータの有無に読み替える）。
4. **確かめている間の案内（文書になかった手当て）**: `autoTask` は始めに `auto.status` を `'checking'` にするので、案内をそのまま描くと、1 分ごとの確認のたびに許可・エラーの帯が消えてまた出る。→ views/owned.js の `renderSummary` は、**`state.busy` か `auto.status === 'checking'` の間は前の案内のまま描かず**、終わったら描き直す（案内の JSON が同じなら要素も作り直さない。`noticesKey`）。header-frame の `saveStatus` が読み込み中に前の文を残すのと同じ考え方。データ元の 1 行の許可のボタンも、`checking` の間は前の見せ方のまま。
5. **`activityText(state, now = Date.now())`（手順 5）**: 文書の形に `now` を足した。`!ready` → `{ kind: 'busy', text: '確認中…' }`、`checking` → 「確認中…」、`reading` → `progress`（なければ「セーブを読み込み中…」）、`sharing` → 「共有中…」、ほかは `{ kind: 'idle', text: '最終確認 ' + formatShortTime(checkedAt, now, '—') }`（今日なら 時:分、違う日なら 月/日 時:分、まだなら「最終確認 —」）。`activity`・`checkedAt` のない古い形の state でも壊れない。
6. **`sourceText(state)`**: `[worldName(meta), 'この PC' か '共有', '${n} 体', 'セーブ ' + dateTime(meta.saveUpdatedAt)].join(' · ')`（n は `state.owned.pals.length`、無ければ `meta.palCount`）。`meta.source` が無ければ ''。
7. **`ownedSourceLine({ actions, now })` → `{ element, update(state), destroy() }`（手順 5・10）**: `div.owned-source`（高さ 28px・1 行・12px）＝ `span.owned-source-text`（省略記号。title に 1 行の文＋`timeLines` を改行でつないだもの＝「セーブの更新: …」「共有: …（Alice）」「この PC で読み込み: …」）＋ `span.owned-activity`（幅 11em＝121px・11px・tabular-nums。中は `svg.owned-activity-spinner`〔createElementNS・aria-hidden〕と `span.owned-activity-text`。busy のとき `.is-busy`、title に同じ文）＋ `actions.grant` があれば `button.button.secondary.small.owned-source-grant`（`auto.enabled` でなければ hidden、許可が要らなければ `.is-placeholder`〔visibility hidden〕と disabled）＋ `a.owned-source-settings`「設定 →」（`#/settings`）。aria-live なし。`update` は同じ値を書かない（文・title・hidden・disabled とも、変わったものだけ）。`destroy` は今は何もしない（形をそろえるため）。
   - **状態のスロットは右寄せではなく、回る輪の場所を残した左寄せにした**（文書は「右寄せ」）。右寄せだと文の長さが変わるたびに文の箱の左端が動き、Chrome の layout-shift が 1 回 0.0001 ずつ出たため（輪を `display: none` にしても同じ）。輪は `visibility` で出し入れし、回すのは `.is-busy` のときの `@media (prefers-reduced-motion: no-preference)` の中だけ（`@keyframes owned-spin`）。
   - **許可のボタンの場所を残すのは、自動の読み込みを使っている（`auto.enabled`）ときだけ**にした（文書は「visibility で場所を残す」。使っていない人〔参加者・未登録〕には出ることがないので、文の幅を 112px 狭めない）。`.button.small` の min-height 32px は `.owned-source .owned-source-grant` で 24px にした（行の 28px に収める）。
8. **所持パル（手順 4・6）**: `section.owned-summary` の中を `[ownedSourceLine の element, ul.owned-notices]` にした（`.owned-world`・`.owned-times` の 2 行はなくした）。`noticeActions` は `grant`（今のまま）・`settings`（「セーブ連携を開く」→ `context.navigate('#/settings')`）・`unknownPlace`（「見る」→ **`changeRoute(context, buildHash('owned', { place: 'unknown' }))`**。文書は `context.navigate`。同じ画面なので作り直さず applyRoute で絞る）。1 行の許可のボタンは `noticeActions.grant` と同じもの。CSS の `.owned-times` は消し、`.owned-world` は設定の「使うワールド」の select が使っているので残した。
9. **理想個体（手順 7）**: 画面の子の並びは「見出し → パネル → **`div.owned-source`** → 要約 → 足りないパッシブ → 帯 → 詳細 → 結果」（`context.owned` が無い画面では 1 行を作らない）。**要約の行の `span.ideal-checked` ごと外し**（子は `span.ideal-summary-text`・`button.ideal-excluded` の 2 つ）、`renderChecked`・`lastChecked`・`REFRESH_INTERVAL` と `formatTime`・`dateTime` の import を消した。`owned.subscribe` の中で最初に `sourceLine.update(ownedState)` を呼び、データが同じなら今までどおり結果は描き直さない。開いたときの 1 回の `autoRefresh` は `owned.load()` の後に、閉じていなくて裏のタブでないときだけ。1100px の実測: `--panel-h` 140.39px・帯の sticky の top 196.39px（下までスクロールしてパネルの下端 196.39・帯の上端 196.38 で重ならない）・要約の行の高さ 18.59px はどれも前と同じ。要約の top は 272.4 → 302.39、帯の top は 299 → 328.98（+30px＝1 行の 28px＋パネルの下の余白 2px）。920px でも 1 行 28px・`--panel-h` 163.98px・横のスクロールなし。
10. **継承ルート（手順 7）**: `renderOwned` で所持パルのデータがあるときだけ、`section.route-owned` の先頭に同じ 1 行の要素を付け直す（作り直さない）。`owned.subscribe` の中で最初に `sourceLine.update` を呼び、`data` が同じなら今までどおり描き直さない。下の余白は `.route-owned > .owned-source { margin-bottom: 10px }`。
11. **`keepRefreshing(owned, { interval = 20500 } = {}) → () => void`（views/shared.js。手順 8）**: `setInterval` の中で `globalThis.document?.visibilityState === 'hidden'` なら呼ばず、ほかは `owned.autoRefresh().catch(() => {})`。理想個体（前の自前のタイマーを置き換え）と所持パル（開いたときの 1 回の隣）で使い、destroy で止める。テストの偽の document に visibilityState が無くても動く。**参加者（共有だけ）の反映は、実測で最大 約 41 秒**（モックで別の PC のホストが共有し直してから所持パルの 1 行の体数が変わるまで 40.3・41.1 秒）。`fetchShared` の 30 秒の制限に 20.5 秒の間隔が 2 回目で届くため（平均は約 20 秒）。間隔を 10.25 秒にすれば最大 約 31 秒になる（共有の一覧の取得は 30 秒に 1 回のまま増える。ホストのセーブの読み直しは 20 秒以上空けるので変わらない）が、文書の 20500 のままにした（ユーザーに確かめる）。
12. **設定のセーブ連携（手順 9）**: `autoError` は文が変わったときだけ textContent を書き、空なら `.is-empty`（visibility hidden・`min-height: 1lh` で 1 行分の場所を残す）。`hidden` は「登録したワールドがなく、エラーの文もない」ときだけ（`'empty'` などワールドのないエラーは今どおり出す）。`.owned-auto-state` に `min-width: 7em`（12px で 84px。「読み込み済み」72px も入る）。
13. **テスト**: test/web/owned-store.test.js に 5 件（activity と busy の動き・reading と sharing〔読み込みが先に終わっても共有中〕・確認の始めに auto.error を残す・empty の文・checkedAt〔読めなかったときは進めない・共有の成功〕）。新しい test/web/owned-status.test.js に 6 件（activityText・sourceText・ownedSourceLine の部品・案内の busy・未登録の案内とデータの有無・stats と古い形）。owned-view.test.js に 7 件（データがないときの案内と「セーブ連携を開く」・データがあれば出さない・busy でも帯が出入りせず許可の案内も残る・場所が分からないパルと「見る」・20 秒ごとの読み直しと裏のタブ・継承ルートの 1 行・設定のエラーの行）、ideal-view.test.js に 1 件（1 行の場所と書き換え。前の「20 秒ごとの確認で最終確認だけ変わる」を置き換えた）。どれも変える前のコードで落ちることを確かめた。**継承ルートのテストは route-view.test.js ではなく owned-view.test.js に置いた**（route-view.test.js は ui/route-view.js の部品だけを確かめていて、`inheritanceView` と所持パルの偽物は owned-view.test.js にあるため）。期待値を直したもの: 所持パルの見出しの 2 行（`.owned-source-text` と title に）・未登録の案内の文とボタン（テスト名に前の設計を変えたことを書いた）・empty の文・理想個体の子の並びと要約の子。テストの偽 DOM（test/helpers/dom.js）は変えていない。
14. **そのほか**: docs/OPERATIONS.md の所持パルの共有・表示・理想個体の読み直しの記述を新しい画面に合わせた（触るファイルの一覧にはなかった）。release-notes は文書の案のまま（id `2026-10-13-owned-status`）。
15. **後のテーマへの申し送り**:
    - owned-toolbar: 「要約の行」はデータ元の 1 行（`div.owned-source`、高さ 28px）と、その下の案内の帯（`ul.owned-notices`。ふだんは出ない）。絞り込みのパネルの中に状態の行（`.owned-status-row`）を作るなら、この 1 行の要素をそのまま置く（作り直さない）。件数の行（`.owned-view > .result-note`「N 体」）は絞り込みの下のまま。
    - owned-rows: このテーマで行は変えていない。
    - participant-self: 所持パルの `update(state)` は emit のたびに `renderSummary`（1 行と案内）を呼び、行の一覧はデータが変わったときだけ。理想個体の `owned.subscribe` は最初に 1 行を書き換えてから、`owned`・`ready` が同じなら return する（本人の変更で描き直す経路はこの return の前か、別の購読に足す）。案内の「セーブ連携を開く」（`noticeActions.settings`）は `#/settings` へ行くだけなので、`settingsHash(worldId)`・`?open=auto` を作ったらここを差し替える。
    - copy-dead-ends: `ui/owned-status.js` の未登録の案内は `REGISTER_TEXT`＋action `'settings'`（ボタン「セーブ連携を開く」）になった（文書の `register`〔ワールドを登録のダイアログ〕にするかはそのテーマで決める）。`owned.js` の `'empty'` の文は「自分のセーブを読むには、設定でワールドを登録してください」。`'error'` の「（設定タブで確認できます）」と登録されていないプレイヤーの文、views/route.js の「所持パルのデータがありません。設定タブの…」は残っている。
    - autoreg-visibility: 許可切れは、所持パルの案内の帯（action `'grant'`）・データ元の 1 行の「読み込みを許可」（3 画面）・設定・ヘッダーの 4 か所に出る。`permissionNotice` を作ったら案内の帯はそれを使い、1 行のボタンは `auto.status === 'permission'` で出す今の形のままでよい。`activity` の名前（`checking`・`reading`・`sharing`）と `checkedAt` は題名・ファビコンの「読み込み停止」の判定に使える（止まった時刻 `stoppedAt` は別に足す）。
    - roles: 共有だけを見ている人の「〜が共有した所持パルを表示しています」は、データ元の 1 行の「共有」と重なる（1 行は title に「共有: 時刻（ID）」）。`ownedNotices` の参加者の文はデータがないときだけになった。
16. **フェーズ 1b・1c の終わりのユーザーの答え（2026-10-13、ブランチ `fix/phase-1bc-answers`。D26・D27）**:
    - **D26 読み直しの間隔**: views/shared.js の `keepRefreshing` の既定の間隔を 20500 → **10000**、owned.js の `SHARED_INTERVAL` を 30000 → **10000** にした（上の 11 の「最大 約 41 秒」をユーザーに確かめた答え）。共有の読み直しはタイマーが少し早く来た回は次の回に回るので、反映は最大 約 20 秒（平均は 10 秒台）。ホストのセーブの読み直しは今までどおり 20 秒以上空ける（`AUTO_INTERVAL`。10 秒ごとの呼び出しの 2 回に 1 回）。裏のタブでは呼ばない決まりはそのまま。調べた結果は README の 3-1 の D26。画面（モック・`answers/participant-reflect.js`。参加者の開いたままの所持パルに、別の PC のホスト〔Bob〕が共有し直してからデータ元の 1 行の体数が変わるまで）: 初めての共有 6.3 秒、共有し直し 4 回で 18.4・6.1・14.0・11.6 秒（前は 40.3・41.1 秒）。テスト: owned-view・ideal-view の 20 秒ごとのテストを 10 秒に直し、owned-store.test.js に「共有の読み直しは 10 秒以上空ける」を足した（変える前のコードで落ちる）。
    - **D27 許可のボタン**: `ownedSourceLine({ actions, showGrant = true, now })` に **`showGrant`** を足した。false（所持パルの画面）なら許可が切れても 1 行のボタンを見せず（`.is-placeholder`・disabled のまま）、自動の読み込みを使っている間は場所だけ残す（上の 7 の決まりのまま。1 行の「設定 →」が動かない）。許可のボタンは案内の帯（action `'grant'`）だけに出る。理想個体・継承ルートは帯がないので 1 行に出す今のまま。画面（`window.__owned` に許可切れを入れて知らせ直す。`answers/d27.js`）: 所持パル — 1 行のボタンは visibility hidden・disabled、「設定 →」の left は許可切れの前後とも 1021、帯に「セーブを読むには許可が必要です［読み込みを許可］」。理想個体 — 1 行のボタンが見えて押せる（`answers/grant-owned-1100-light.png`）。
    - 後のテーマへ: autoreg-visibility（2）で `permissionNotice` を作るときも、所持パルの画面は帯だけ（`showGrant: false`）。
17. **2026-10-14 のユーザーのフィードバック（ブランチ `fix/feedback2-owned`。D29「（ワールド名・ホスト・この PC・体数・セーブの時刻の 1 行の）表示は、上部のバーにも同じ情報が書かれているので不要」「最終確認時刻と設定ページへのリンクは、左下のサイドパネルから設定タブに遷移できるから不要」。原文のワールド名・プレイヤー名はこの文書では伏せる）**: データ元の 1 行を 3 画面からなくした。
    - **消したもの**: ui/owned-status.js の `ownedSourceLine`（上の 7。D27 の `showGrant` も）・`activityText`（上の 5）・`sourceText`（上の 6）・輪の `spinner`、CSS の `.owned-source*`・`.owned-activity*`・`@keyframes owned-spin`・`.route-owned > .owned-source`・`.owned-summary` の margin、web/js/owned.js の `state.activity`・`state.checkedAt`・`checked()`（上の 1。どこからも読まれなくなった。`busy`・`progress` の意味とタイミングは変えていない〔自動登録が見る。auto-register のテストが通る〕）。`dateTime`・`worldName`・`roleLabel`・`timeLines` は設定とヘッダーのセーブ連携の状態が使うので残した。
    - **所持パル**: `section.owned-summary` の中は案内の帯 `ul.owned-notices` だけ。案内がないときは入れ物ごと `hidden`（パネルが見出しのすぐ下に来る）。1100px（138 体・案内なし）で パネルの top 117.69px・列見出しの sticky の top 240px（ヘッダー 56＋パネル 184）・いちばん上の行の top 341.69px。920px はパネル 221px・列見出しの top 277px。上の 4 の「確かめている間は前の案内のまま」と、owned-toolbar の記録 17 の B7（案内の帯の出入りで一覧を同じ位置に保つ）はそのまま。
    - **理想個体・継承ルート**: 1 行の要素を作らない。どのワールドの・いつのデータか・読み込み中かは、ヘッダーのセーブ連携の状態（`ui/save-status.js`。読み込み中は点が流れる）だけに出る。
    - **許可が切れたとき**: ヘッダーのセーブ連携の状態が「許可が必要」（tone-warn・title「…（押すと許可を求めます）」）になり、押すとその場で `owned.grantAndRefresh()` を呼ぶ（header-frame の作りのまま）。理想個体・継承ルートの画面の中には「読み込みを許可」を出さない（最小の形で残す必要はなかった）。所持パルは今までどおり案内の帯にもボタンが出る。画面（`feedback2/grant.js`。`owned-status/wrap.js` の `window.__owned` に許可切れを入れ、`grantAndRefresh` を数えるものに差し替え）: 3 画面ともヘッダーが「許可が必要」、ヘッダーを座標で押すと 1 回ずつ許可を求めた。画面の中の「読み込みを許可」は所持パルの帯の 1 つだけ。
    - テスト: owned-status.test.js（3 つの関数を export しない。前の activityText・sourceText・ownedSourceLine のテストは消した）、owned-store.test.js（activity・checkedAt を持たず busy の動きは同じ。前の activity と checkedAt の 3 件はこの 1 件と消した分に置き換えた）、owned-view.test.js（所持パル・継承ルートに 1 行がない・案内がなければ入れ物ごと隠す・帯の許可のボタンだけ）、ideal-view.test.js（1 行がない・許可切れでも画面に許可のボタンを出さない・確認の間も結果を描き直さない）。どれも変える前のコードで落ちることを確かめた。
    - 後のテーマへ（上の 15・16 の申し送りを直す）: participant-self — 所持パルの `update(state)` は emit のたびに `renderSummary`（案内の帯だけ）を呼ぶ。理想個体の `owned.subscribe` は `owned`・`ready` が同じなら何もしない（1 行の書き換えはなくなった）。autoreg-visibility — 許可切れは所持パルの案内の帯（action `'grant'`）・設定・ヘッダーの 3 か所（1 行のボタンはない。`showGrant` もない）。題名・ファビコンの「読み込み停止」の判定は `auto.status`（と足す `stoppedAt`）で行う（`activity`・`checkedAt` はなくした）。roles — 共有だけを見ている人の「〜が共有した所持パルを表示しています」は、ヘッダーのセーブ連携の状態（「「ワールド」· 共有 時:分」）と重なる。copy-dead-ends — 1 行の「設定 →」はなくなった。

---

## owned-toolbar: 所持パルの絞り込みを sticky のパネルに

### 目的
3 列 4 段（約 290px）の絞り込みを、スクロールしても見える 2 段＋状態の行のパネルにまとめる。場所はチップ（複数選択）に統一し、所持者は理想個体と同じ意味（預けた拠点のパルも含む）にそろえる。効いている条件をチップで見せ、「すべて解除」「リンクをコピー」を置く。

### 経緯
- 別プランの **F056**（sticky の 2 段パネル）・**F057**（場所の 3 経路＝場所の select・タマゴ／グローバルのチェック・所持者の拠点／グローバルを「場所」チップに統一し、所持者はプレイヤーだけ。理想個体の所持者と意味をそろえる）・**F060**（パッシブの条件「全部持つ／だけ／なし」）・**F061**（件数の行に「クリア」「リンクをコピー」）。別プラン §9 の Codex の決まり: 「所持者フィルタは view 側で許可個体 id の Set を作って filterOwned に渡す（players も要る）」「所持者・登録者・拠点の select は件数閾値（例 12）を超えたら検索付きにし、同名プレイヤーは uid 短縮で識別」。
- 本セッションの案: **O-01**（固定のツールバー）・**O-03**（判断: 新しい帯は作らず O-04 の行を sticky に）・**O-04**（効いている条件のチップ・「N / 全 M 体」・すべて解除・0 件の空の状態に解除のボタン）・**O-05**（利用者が条件を変えたら結果の先頭を見せる）・**O-06**（場所を件数つきのチップに、2 つのチェックをなくす。件数 0 のチップは出さない。所持者の「グローバルパルボックス」もなくす。古い viewState・URL を読み替える）・**O-15**（属性のトグル。判断: キーワードに「闇属性」を足す案はやめ、属性で OR に絞る）・**O-40**（件数の行に理想個体・継承ルートへのリンク）・**O-50**（判断: 段 1 だけ＝件数の行に ♂♀ の内訳）。
- **案の判断とプランが食い違う所（プランを優先）**: O-08 の判断は「所持パルの所持者の意味はそろえない（ボックス整理では拠点のパルを混ぜたくない）」、O-09 の判断は「『自分の個体』は足さない」だった。統合プランは F057 と Codex の決まりに合わせて「所持者はプレイヤーだけ『すべて／自分の個体／各プレイヤー』にし、意味を理想個体の palsOfPlayers にそろえる」とした。ボックス整理で拠点のパルを分けたいときは、場所のチップ（「拠点」を外す、拠点ごとのチップ）で分けられるので、O-08 の懸念はこちらで受ける。
- フェーズ 1d の participant-self は、ここで作る「自分の個体」の許可 id の Set を、本人の変更のときに作り直す（docs/ui-refactor/phase-1d-small-fixes.md の participant-self の節）。

### 依存
talent-target（個体値の部品）・popovers（パッシブの 1 行部品・`ui/popover.js`）・owned-status（要約の 1 行）・header-frame（`--header-h`）・stable-render（件数の行の高さ・キーワードの間引き）。

### このテーマでやらないこと
- 列見出し・行の見た目（owned-rows）。行の差分更新（stable-render・owned-rows）。
- 「種類ごとにまとめる」表示の切り替え（O-50 の段 2。要望があれば後で）。種族ごとの見出しと集計チップ（フェーズ 3 の goals-detail の F067・F068）。
- 継承ルートに所持者の絞り込みを足すこと（O-08 に吸収した R-14。採らない）。
- 目標の印での絞り込み（owned-rows の O-52 で印を出し、キーワードで探せるようにする）。

### 現状
- 絞り込みの値（web/js/views/owned.js:77-80）: `{ holder: '', place: '', palId: '', passives: [], query: '', sort: 'dex', eggs: true, globals: false, stars: 0, talent: { hp: 0, shot: 0, defense: 0 } }`。viewState に残す。URL の `holder・place・pal・p` を優先して読み、読んだら `context.replace(buildHash('owned'))` で URL から外す（:83-90）。
- 部品（:101-157）: 所持者の select（プレイヤー・拠点・グローバルを見出しなしで並べる :180-186）・場所の select（:187-192。チェックで選択肢が変わる）・キーワード・並べ替え・「タマゴも表示」「グローバルボックスを表示」のチェック（:110-120）・★・個体値・パル・パッシブ（:196-208。選ぶたびに作り直してフォーカスを戻す）。CSS は 3 列のグリッド（app.css:910-918）。
- 件数は「N 体」だけ（:219）。0 件は `empty('条件に合うパルはいません。')`（:221。`empty(text, action)` は action を受け取れる: web/js/ui/dom.js:27）。
- `filterOwned`（web/js/core/owned.js:304-324）: `holder` は `player:<uid>`（`holderUid` の一致だけ :316）・`base:<id>`・`global`、`place` は 1 つ、`eggs`・`globals` は別。`filterOwned` を呼ぶのは views/owned.js:217 だけ（grep で確認）。
- 理想個体の所持者（views/ideal.js:229-253）: 「すべて／自分の個体（`ideals.mine()`）／各プレイヤー（`palsOfPlayers`。預けた拠点のパルとホストならグローバルも含む: web/js/core/ideal-goals.js:121-131）」。
- 計測（appendix/measurements.md 撮影 owned）: #3 パッシブを足すと件数と一覧が +44px、#4 結果が減ってページが縮み画面全体が 242px 動く、#1 絞り込みの欄は y≈248〜540（約 290px）で一覧は y≈590 から。

### 実装の手順
1. **絞り込みの値の形を変える**（views/owned.js:77-80）:

   ```js
   {
     holder: '' | 'mine' | `player:${uid}`,
     places: string[],          // 選んだ場所のグループ（PLACE_ORDER の値）。既定は 'global' 以外のすべて
     bases: string[],           // 拠点の ID（空ならすべての拠点）
     elements: string[],        // 属性（ELEMENTS の名前。OR）
     palId: '', passives: [], passiveMode: 'include' | 'only' | 'none',
     query: '', sort: 'dex', stars: 0, talent: { hp: 0, shot: 0, defense: 0 },
   }
   ```
   - （追記 2026-10-13、keep-state の後）絞り込みは sessionStorage と履歴のエントリにも残り、読み戻すときに views/owned.js の `OWNED_MEMORY` で項目ごとに確かめる。新しい形（places・bases など）を `OWNED_MEMORY` に足し、古い項目（place・eggs・globals・holder の base:/global）は形に残して `migrateFilter` に渡す（形から消すと、古い保存の値が読み戻しで捨てられて読み替えられない）。形を大きく変えるなら ui/view-memory.js の `MEMORY_VERSION` を上げて前の保存を捨ててもよい。
   - **古い値の読み替え**（viewState と URL。関数 `migrateFilter(old)` を views/owned.js に置き、テストする）: `place: 'egg'`（1 つ）→ `places: ['egg']`、`place: ''` → 既定、`eggs: false` → `places` から 'egg' を外す、`globals: true` → `places` に 'global' を足す、`holder: 'base:<id>'` → `holder: ''`・`bases: [id]`・`places` を `['base', 'egg']`（拠点のタマゴも拠点の持ち物なので）、`holder: 'global'` → `holder: ''`・`places: ['global']`。
2. **`filterOwned` の引数を変える**（core/owned.js:304-324。呼ぶのは views/owned.js だけ）:

   ```js
   filterOwned(pals, { ids /* Set<palId>|null: 所持者で許す個体 */, places /* string[]|null */, bases /* string[] */, elements /* string[] */,
     palId, passives, passiveMode = 'include', query, stars, talent })
   ```
   - `places` が null なら場所で絞らない。`bases` が空でなければ `pal.baseId` が入っている個体だけ（拠点の個体と拠点のタマゴ）。`elements` が空でなければ `pal.elements` にどれかを含む個体。`passiveMode`: include＝全部持つ（今の `hasPassives`）、only＝全部持ち、ほかを持たない、none＝パッシブが 0 個（このとき選んだパッシブは無視し、パッシブの部品を無効にする）。
   - 古い引数（`holder`・`place`・`eggs`・`globals`）は消す（呼び出しが 1 か所なので）。core のテストを新しい引数に書き換える。
3. **所持者**（O-08・O-09・F057）: 選択肢は「すべて」「自分の個体」（`context.ideals` があるとき）、プレイヤー（自分を先頭にして「Alice（自分）」。自分は `ownPlayerUids`。同じ名前のプレイヤーが 2 人以上いれば「Alice（1A2B3C4D）」と uid の頭 8 字を添える）。拠点とグローバルは選択肢から外す（場所のチップへ）。選択肢が 12 件を超えたら検索つきの選択（下の 7）。
   - 許可する個体の Set は view で作る: `mine` → `context.ideals.mine()`（null なら「自分のプレイヤーが分かりません」の案内を件数の行に出し、結果は 0 件）、`player:<uid>` → `palsOfPlayers(state.owned, new Set([uid]))`。データか所持者が変わったときだけ作り直す（入力のたびに作らない）。
4. **場所のチップ**（O-06）: `[手持ち 6][パルボックス 120][拠点 40][パル次元ストレージ 3][タマゴ 4][グローバルパルボックス 25][不明 2]`。件数は `state.owned.pals` を `placeGroup` ごとに数える（絞り込みの前の数）。件数 0 のチップは出さない。`aria-pressed` で複数選択。拠点が 2 つ以上あるときは「拠点」のチップの右に小さな ▾ を付け、押すと拠点ごとのチェック（`bases`）を `ui/popover.js` で開く（拠点が 12 を超えたら検索欄つき）。
5. **属性のトグル**（O-15）: 9 個の色付きチップを 1 行に並べる幅はない（下の 6 の配置）ので、「属性 ▾」のボタン（選んだ属性の小さなチップをボタンの中に出す）を押すと、9 個のトグル（element-chip の見た目。app.css:511-512）を `ui/popover.js` で開く。複数は OR。
6. **パネルの配置**（本文 956px に収める。`section.owned-panel`、`position: sticky; top: var(--header-h); z-index: var(--z-panel);`、`trackHeight` で `--panel-h`）:
   - 1 段目: `[所持者 150px][場所のチップ（件数つき）][キーワード 1fr（最小 180px）][並べ替え 150px]`
   - 2 段目: `[パル 180px][★ 100px][個体値（talent-input）＋プリセット][パッシブ（1 行部品）1fr][パッシブの条件 segmented「全部／だけ／なし」][属性 ▾]`
     （追記 2026-10-13、talent-target の実装の後: 部品の個体値の 3 つ＋プリセット 2 つは 1 行で 710px ある。talent-target の「実装の記録」7）
   - 状態の行（28px）: `12 / 340 体 · ♂5 ♀6 タマゴ 1`（O-04・O-50。グローバルを外していて数があれば title に「グローバル 25 体は非表示」）＋効いている条件のチップ（既定から変えた条件だけ。例「所持者: Alice ×」「★2 以上 ×」「攻撃 90 以上 ×」「パッシブ: 職人気質 ×」「属性: 闇 ×」。入り切らなければ「+n」）＋[すべて解除]＋[リンクをコピー]＋右端に O-40 のリンク（パルを選んでいれば「この条件で理想個体 →」＝ `buildHash('ideal', { to: palId, p: 正のランクのパッシブ })`、パッシブを選んでいれば「このパッシブを運ぶ継承ルート →」＝ `buildHash('route', { p })`。継承ルートでは目標を選ぶ手順が残る）。
   - 合計の高さは約 125px（キャプションを各欄の上に 1 行、操作は 36px）。幅 920px では折り返してよい。
   - （追記 2026-10-13、ユーザーの決定 D20: 理想個体と同じ決め方にする。**パッシブのチップが 1 行に入りきらないときは横に省略せず改行し、パネルがその分伸びる**（`--panel-h` は ui/dom.js の `trackHeight` で画面の section に書く）。段は折り返してよいが、全体はできるだけ低く。理想個体の形〔見出しを入力の左に置く・個体値の「以上」は見出しに 1 回・増減のボタンを隠す CSS は `.ideal-panel` の中だけ〕と測った値は ideal-panel の「実装の記録」）
   - 統合プランの F056 の 1 段目は「[所持者][場所チップ][パル][キーワード][並べ替え]」だが、場所のチップ（約 420px）とパル（240px）を同じ段に置くと 956px を超えるので、パルを 2 段目に、属性をボタンにした（下の「コードで確かめてプランと違っていた点」）。
7. **検索つきの選択**（新規 `web/js/ui/search-select.js`。所持者のほか、フェーズ 2 の登録者でも使う）:

   ```js
   /** 選択肢が threshold（既定 12）を超えたら、検索欄つきのポップオーバーで選ぶ select の代わり。以下なら普通の select を返す。 */
   export function searchSelect({ label, options /* [value, label][] */, value, onChange, threshold = 12 }) → { element, update({ options, value }), destroy() }
   ```
   検索は `core/kana.js` の `normalizeQuery` で部分一致。`ui/popover.js` を使う。
8. **すべて解除・リンクをコピー**（O-04・F061）: 「すべて解除」は値を既定に戻し、部品に `update` で反映（作ったときに一度だけ値を入れた部品＝個体値・キーワード・パル・★も忘れずに同期する。O-04 のリスク）。0 件の空の状態にも `empty('条件に合うパルはいません。', button('条件をすべて解除', reset))`。「リンクをコピー」は `buildHash('owned', params)` を作って `navigator.clipboard.writeText(location.origin + location.pathname + hash)`（失敗したら入力欄に出して選択）→ トースト「リンクをコピーしました」。
   - URL の受け口（:83-90）を広げる: `holder`・`place`（カンマ区切り。1 つの古い形も同じ）・`base`・`el`・`pal`・`p`・`pm`（パッシブの条件）・`q`・`sort`・`stars`・`hp`・`at`・`df`。値は検証してから使う（data-boundary）。URL から外す動き（:89）は keep-state の決まりに合わせる。
9. **条件を変えたら結果の先頭を見せる**（O-05）: 利用者が条件を変えたとき（データの更新では行わない。キーワードは間引きの後に 1 回）、一覧の先頭（`.owned-list`）の top がパネルの下端より上にあるときだけ `results.scrollIntoView({ block: 'start' })`（`scroll-margin-top: calc(var(--header-h) + var(--panel-h))`）。並べ替えのときも同じ。
10. 部品は作り直さず `update` する（パッシブの部品は popovers の `update({ selected, counts })`。今の :196-208 のように選ぶたびに作り直してフォーカスを戻す形はやめる）。パッシブの所持数は今の絞り込みの後の数（popovers の O-14）。
11. CSS: `.owned-panel`（grid）・`.place-chips`・`.owned-status-row`・`.filter-chip`（× つき）。今の `.owned-filters`（app.css:910-918）・`.owned-toggles`（:1215）・`.owned-toggle`（:841-842）は消す。

### 触るファイル
- 新規: `web/js/ui/search-select.js`、`test/web/search-select.test.js`
- 変更: `web/js/views/owned.js`（:71-245 の大部分）、`web/js/core/owned.js`（:297-324）、`web/css/app.css`（:841-842・:910-918・:1215・:1278）、`web/js/release-notes.js`

### テスト
- **追加** `test/core/owned.test.js`: 新しい `filterOwned`（`ids`・`places`・`bases`・`elements`・`passiveMode` の 3 つ）。
- **追加**（owned-view.test.js）: (1) `migrateFilter` が古い viewState（`place`・`eggs`・`globals`・`holder: base:/global`）と古い URL（`?place=egg`・`?holder=base:…`）を読み替える。(2) 所持者「Alice」で預けた拠点のパルも出る（理想個体と同じ）。(3) 場所のチップの件数と、件数 0 のチップが出ないこと。(4) 効いている条件のチップの × で、その条件だけが既定に戻り部品の表示もそろう。(5) すべて解除・0 件の解除ボタン。(6) リンクをコピーした URL で開くと同じ絞り込みになる。(7) パッシブの条件「なし」で、パッシブが 0 個の個体だけ。(8) 属性 2 つで OR。(9) 同じ名前のプレイヤーに uid の頭が付く。
- **追加** `test/web/search-select.test.js`: 12 以下は select、超えたら検索欄で絞って選べる。
- **期待値が変わる既存のテスト**（別プラン §9 の C の owned-view の行）:
  - `test/web/owned-view.test.js:73`（件数「3 体」）→「3 / 4 体 · …」の形に（`.result-note` の新しい文）。
  - `:75-77`・`:80-97`（「タマゴも表示」「グローバルボックスを表示」のチェックと、グローバルの選択肢）→ 場所のチップ（タマゴ・グローバル）を押す形に。
  - `:99-140`（タブを切り替えても残る・URL の指定を優先して外す）: `eggs` のチェック（:113・:124）→ 場所のチップに。URL の `p=` を読んで外す動きは残す。
  - `test/core/owned.test.js:93-102`（`filterOwned` の holder・place・eggs）→ 新しい引数に。

### INV-2・互換・セキュリティ・性能の注意
- 配合の計算は使わない（所持数を数えるだけ）。理想個体の `palsOfPlayers`（core/ideal-goals.js）は所持パルの画面から使ってよい（core/ideal.js ではない）。
- 古い viewState・古い URL・旧コードのタブのリンクが混ざっても、`migrateFilter` で読み替えて壊れない。URL の値は検証してから使う（未知の場所・長すぎる文字は捨てる）。
- 2,000 行でも、条件の変更 1 回の絞り込みと件数の集計は 1 回の走査で行う（許可 id の Set と場所の件数はデータが変わったときだけ作る）。キーワードは間引き（stable-render）・日本語変換中は絞らない。
- クリップボードは失敗しても例外を出さない（権限がない・HTTP など）。

### release-notes の案
- id: `<実装日>-owned-toolbar`
- title: 「所持パルの絞り込みを固定」（12 字）
- body: 「絞り込みを上に固定し、場所はチップで選べます。所持者は預けた拠点のパルも含み、条件のリンクを写せます。」（51 字）

### 完了の条件
- [x] `npm test` が通る。（2026-10-13: exit 0・1,345 件）
- [x] 幅 1100px でパネルが 2 段＋状態の行（高さ 130px 以下）に収まり、129 行の一覧の下の方でも条件と件数が見える。（2 段＋状態の行には収まり、下までスクロールしてもパネルの top 56・件数が見える。高さは 172.39px で 130px を超える〔理想個体 140.4px〕が、2026-10-13 にユーザーが「1100px で 172px のままでよい」と決めた〔README の D24。約 135px・約 156px の別案は採らない〕。実装の記録 8）
- [x] scrollY=380 でパッシブを足しても一覧の先頭の行の top が変わらない（基準: +44px）。結果が減っても条件と件数を見失わない（基準: 画面全体が 242px 動く）。（2026-10-13: 一覧の先頭が見えている位置では 1・2 個目で動かず、改行が要る 3 個目でパネルが伸びた 38px だけ下がる〔D20〕。scrollY=380 は一覧の先頭がパネルの下に隠れているので、手順 9〔O-05〕で一覧の先頭がパネルの下端＋8px に来る。結果が減ってもパネルと件数は top 56・198 のまま。計測の記録）
- [x] 所持者「Alice」の件数が、理想個体の所持者「Alice」の候補と同じ個体の集合になる（タマゴ・グローバルの場所のチップの状態を同じにしたとき）。（2026-10-13: Alice・Bob × 4 種族で同じ数。テストでは palsOfPlayers と同じ集合）
- [x] 古い viewState（タマゴのチェックを外した状態）から開いても同じ絞り込みになる。（2026-10-13: 124 / 138 体・タマゴのチップだけ外れる）
- [x] リンクをコピー → 新しいタブで開く → 同じ件数。（2026-10-13）
- [x] 2,000 行の注入データで、キーワードの入力が 100ms 以上止まらない（Performance パネルの Long Task で確かめる）。（owned-rows へ移した（D24）。owned-toolbar の時点では Long Task 81〜120ms〔main も 126〜157ms〕。owned-rows で直した〔先祖の `:has()` をクラスに置き換えた・すぐ書き換える行を 60 行に・行の署名を個体ごとに覚えた〕。owned-rows の「完了の条件」と「実装の記録」）
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — 古い viewState・古い URL・旧コードのタブが作ったリンクを `migrateFilter` で読み替え、URL の値は検証してから使う（上の確認）。INV-2 — 所持数を数えるだけで、`core/ideal.js` を import しない（`test/import.test.js`）。セキュリティ — `test/static/security.test.js` が通り、クリップボードの失敗で例外を出さない。性能 — 上の 2,000 行の確認に加え、許可 id の Set と場所の件数はデータが変わったときだけ作る。（INV-2〔test/import.test.js〕・セキュリティ〔security.test.js・クリップボードの失敗で例外なし〕・互換〔migrateFilter・古い URL・古い viewState〕・許可 id の Set と場所の件数をデータごとに作ること は確かめた。2,000 行のキーワード入力の Long Task は owned-rows へ移した（D24）。owned-rows で満たした）

### TODO
- [x] 絞り込みの値の新しい形と `migrateFilter` を作り、テストする
- [x] `filterOwned` の引数を `ids・places・bases・elements・passiveMode` に変え、core のテストを書き換える
- [x] 所持者の選択肢（すべて・自分の個体・プレイヤー）と許可 id の Set を作る
- [x] 場所のチップ（件数・0 件は隠す）と拠点の ▾ を作る
- [x] 属性 ▾ のトグルを作る
- [x] `ui/search-select.js` とテストを作る
- [x] パネルを 2 段＋状態の行に組み、sticky と `--panel-h` を付ける
- [x] 効いている条件のチップ・すべて解除・0 件の解除ボタン・リンクをコピーを作る（部品の同期を含む）
- [x] URL の受け口を広げ、値を検証する
- [x] 理想個体・継承ルートへのリンクと ♂♀ の内訳を状態の行に出す
- [x] 条件を変えたら結果の先頭を見せる（利用者の操作のときだけ）
- [x] 部品を作り直さず `update` する形にする
- [x] owned-view のテストを直し・足し、古い CSS を消す
- [x] release-notes に 1 件足し、1100px・920px で確かめる

### 実装の記録（2026-10-13、ブランチ `feature/owned-toolbar`）

実装のときに決めたこと・文書と違う形にしたこと（後のテーマ owned-rows・フェーズ 1d の participant-self・フェーズ 2 の登録者の選択〔`searchSelect`〕はこちらを正とする）。

1. **絞り込みの値の形（手順 1）**: views/owned.js の filter は `{ holder: '' | 'mine' | 'player:<uid>', places, bases, elements, palId, passives, passiveMode, query, sort, stars, talent }`。`places` は PLACE_ORDER の順に並べた場所のグループ（既定は `DEFAULT_PLACES`＝グローバルパルボックス以外のすべて。export）、`elements` は**マスターの ID**（`Fire` など。`data/pals.js` の `ELEMENTS` のキー。URL も同じ）。入れ物は viewState と共有し、作るとき・戻る/進む（restored）のたびに `migrateFilter` の結果で中身を入れ替える（`adopt`。前の形の項目は消す）。
   - `OWNED_MEMORY` に新しい項目を足し、**前の形の項目（`place`・`eggs`・`globals`、所持者の `base:<id>`・`global`）は形に残して `migrateFilter` に渡す**（`MEMORY_VERSION` は 1 のまま。前の形の項目は、無ければ `undefined` を返すので今の形の保存には書かれない。`places` も配列でなければ `undefined`＝前の形の保存として place・eggs・globals から作る）。
   - `migrateFilter(old)`（export）: どの値も `OWNED_MEMORY` で確かめてから、文書の読み替え（place 1 つ → `[place]`、eggs: false → 'egg' を外す、globals: true → 'global' を足す、`base:<id>` → 所持者なし・`bases: [id]`・`places: ['base', 'egg']`〔eggs: false なら `['base']`〕、`global` → 所持者なし・`['global']`）。前の作りと同じ意味にするため、place を選んでいて eggs: false などのときは前と同じく 0 件になる。
2. **URL（手順 8）**: `filterFromParams(params)`（export）が `holder`・`place`（カンマ区切り。前の 1 つの形も同じ）・`base`・`el`・`pal`・`p`・`pm`・`q`・`stars`・`hp`・`at`・`df` を `migrateFilter` で確かめる（知らない場所・属性・パル、範囲の外の数〔丸めずに既定〕、41 字以上の拠点 ID は捨てる。`q` は 100 字まで）。**どれか 1 つでもあれば URL が条件のすべてを決め、URL に無い条件は既定に戻す**（文書は決めていなかった。前の作りは holder・place・pal・p を URL どおりにし〔無ければ空〕、キーワード・★などは残していた。今はキーワードなども URL に載るので、その延長でリンクの条件をそのまま再現する形にした。ユーザーに確かめる）。`sort` は並べ替えなので、あるときだけ入れる。URL から外す動き（`context.replace(buildHash('owned'))`）は今のまま。同じ画面の applyRoute で URL を入れたときは、キーワードの待っている入力を取り消して、入力欄も URL の値に合わせる（render-contract の「打ちかけのキーワードは消さない」のテストは、この決まりに合わせて書き換えた）。
   - リンクをコピーは `filterParams(filter)`（export）。**`place` は既定でも必ず入れる**（開いたタブが覚えている条件より URL を使わせるため）。リンクは文書のとおり `location.origin + location.pathname + hash`（開発用の `?mock=1` は付かないので、画面の確認では付け足して開いた）。
3. **`filterOwned`（手順 2）**: `filterOwned(pals, { ids, places, bases, elements, palId, passives, passiveMode, query, stars, talent })`。全員を 1 回だけ走査。`ids` は所持者で許す個体の Set（null は絞らない）、`places` は null で絞らない・`[]` で 0 件。**`bases` は文書のとおり「その拠点にいる個体とその拠点に置いたタマゴ（`baseId` がその拠点）だけ」**で、ほかの場所のチップ（パルボックスなど）を押していてもそれらは出ない（拠点のチップの ▾ で選ぶので「拠点の中だけを絞る」と受け取られるおそれがある。ユーザーに確かめる）。`passiveMode` の `only` は「選んだものを全部持ち、ほかを持たない」で、**選んだパッシブが 0 個のときはパッシブを持たない個体**（理想個体の `goalMatches` と同じ）。`none` は選んだパッシブを見ない。`shortUid` を export した。
4. **所持者（手順 3）**: `searchSelect`（ラベル「所持者」）の選択肢は「すべて」「自分の個体」（`context.ideals` があるとき）・プレイヤー（自分は先頭に「Alice（自分）」、同じ名前が 2 人以上なら「Alice（1A2B3C4D）」、名前が空なら「不明なプレイヤー（…）」）。自分のプレイヤーは **ideals.js に足した `ideals.selfUids()`**（`ownPlayerUids(players, identity(worldId))`。所持パルがなければ空の Set）で決める。許す個体の Set は `allowedIds(data)` が **データ・所持者・自分の UID の並びが同じ間は使い回す**（入力のたびに作らない）。`mine` で `ideals.mine()` が null（自分が分からない）なら 0 件で、件数の行を「0 / M 体 · 自分のプレイヤーが分かりません」、空の表示を「自分のプレイヤーが分からないため、自分の個体で絞れません（所持者を「すべて」にすると全員の個体が出ます）。」＋「条件をすべて解除」にした。選択肢の作り直しは、前の `syncOptions` の代わりに `renderWhenIdle(holderSelect.element, …)` で包み、選んでいる途中（フォーカス中）は離れるまで待つ（離れた後に選んでいた所持者が無くなっていれば「すべて」に戻して描き直すのも前と同じ）。
5. **検索つきの選択 `searchSelect`（手順 7。新規 web/js/ui/search-select.js）**: `searchSelect({ label, options /* [value, label][] */, value, onChange, threshold = 12 })` → `{ element, update({ options?, value? }), destroy() }`。`element` は `div.search-select` で、選択肢が threshold 以下なら中は `select[aria-label=label]`、超えたら `button.search-select-trigger`（aria-haspopup listbox・aria-label「所持者: Alice」）と `ui/popover.js` の板（`input.picker-search`〔aria-label「所持者を検索」〕・`p.picker-status`〔「N 件」／「当てはまる候補がありません。」〕・`div.picker-options[role=listbox]` に `button.picker-option.search-select-option[role=option][data-value][aria-selected]`）。検索は `core/kana.js` の `queryTerms`・`normalizeQuery` の部分一致。Enter は矢印で選んだときだけ（パル選択と同じ）、Esc で閉じてボタンへ。`update` は onChange を呼ばず、選択肢が同じなら作り直さない。件数が閾値をまたぐと中身を入れ替えるので、**フォーカス中に作り直さないのは呼び出し側で待つ**（views/shared.js の `renderWhenIdle`）。知らない値のときは、ボタンに先頭の選択肢の名前を出す。
6. **場所のチップと拠点 ▾（手順 4）**: `div.place-chips[role=group][aria-label=場所]` に PLACE_ORDER の 7 つの `button.place-chip[data-value][aria-pressed]`（`span.place-chip-label`＝`placeGroupLabel` の名前〔文書の例どおり略さない〕・`span.place-chip-count`。aria-label「パルボックス（69 体）」）。件数は `state.owned.pals` をデータごとに 1 回だけ数え（`statsOf`）、0 のチップは `hidden`。拠点が 2 つ以上なら拠点のチップの右に `button.place-chip-more`「▾」（aria-label「拠点を選ぶ」／「拠点を選ぶ（N か所を選択中）」）。板 `div.place-bases`（role=dialog）は拠点ごとの `label.place-base`（チェック〔aria-label「拠点 1（19 体）」〕・名前・件数。`syncList` で使い回す）と「すべての拠点」。拠点が 12 を超えたら板の先頭に検索欄。データにない拠点（別のワールド・なくなった拠点）は、読み込んだ後に外す（`pruneBases`。app.js の `forgetHolders` は所持者だけを外すので、拠点はこちらで外す）。
7. **属性 ▾（手順 5）**: `button.owned-element-button`（「属性」＋選んだ数の `span.owned-element-count`、aria-label・title「属性: 炎・闇」）で、板（role=dialog）に 9 個の `button.element-chip.element-toggle.element-<ID>[aria-pressed]`。**文書の「選んだ属性の小さなチップをボタンの中に出す」は数にした**（チップを出すと 2 つでボタンが約 120px になり、2 段目が 3 行に回ってパネルが 172 → 209px に伸びた。名前は aria-label・title と状態の行の条件のチップに出る）。
8. **パネルの配置（手順 6・D20・D21。文書の 6 の並びから変えた）**: `section.owned-panel`（aria-label「所持パルの絞り込み」・sticky・`top: var(--header-h)`・`z-index: var(--z-panel)`）。**`--panel-h` は `trackHeight(panel, element)` で `section.view.owned-view` に書く**（画面の destroy で監視をやめる）。
   - 1 段目 `div.owned-panel-main`（grid `200px minmax(0, 1fr) 200px`・見出しは入力の上・subgrid。理想個体の [目標][欲しいパッシブ][保存] と同じ組み方）: パル（palPicker）・パッシブ（passiveSelector。1100px で 517px）・キーワード（`label.field.owned-keyword`。placeholder は「名前・スキル・属性など」に縮め、title に「空白で区切ると…」）。
   - 2 段目 `div.owned-panel-sub`（flex・折り返し・見出しは入力の左）: `.owned-holder-item`（所持者）・`.owned-places`（場所）・パッシブの条件（見出し「パッシブ」。segmented「全部／だけ／なし」、title に長い説明）・個体値（見出し「個体値（以上）」。`div.owned-talent-filter` に talentInput と「まとめて ▾」）・`.owned-stars-item`（見出し「★」・select の aria-label「パル濃縮（★）」）・`.owned-element-slot`（属性 ▾）。1100px では 1 行目 所持者 192＋場所 717、2 行目 パッシブの条件 203＋個体値 482＋★ 118＋属性 64 で、どちらも本文 941px に入る。幅 1080px 以下（920px など）は `order` で ★・属性を所持者の横へ寄せる（場所が 1 行を使うため。4 行 → 3 行）。
   - 状態の行 `div.owned-status-row`（下の 9）。
   - **個体値の部品を詰める CSS は理想個体と共通にした**（`:is(.ideal-panel, .owned-panel) .talent-input …`。「以上」を隠す・増減のボタンを隠して 3.6em・32px）。理想個体のパネルは 140.39px のまま（確かめた）。
   - **「すべて 90 以上」「すべて 100」は 1 つの小さなメニュー `button.talent-preset-button`「まとめて ▾」（aria-haspopup menu・aria-label「個体値をまとめて入れる」）にまとめた**（ボタン 2 つのままだと 2 段目の 2 行目が 1,035px で 941px に入らず、2 段目が 3 行・パネル 209px になった）。項目は `button.talent-preset-item[role=menuitem]`。押すと `talents.update` で 3 つとも入れ、絞り込みは 1 回だけ。talentInput の presets は使っていない（部品は変えていない）。
   - パッシブの欄の見出しを「パッシブ（すべて持つ個体）」から「**パッシブ**」にした（条件が「全部／だけ／なし」になったため）。× のフォーカスの目印は `passive-chip:パッシブ:<ID>` に変わった。
   - **高さ（実測。ヘッドレスの Chromium・ライト/ダーク同じ）**: 幅 1100px・パッシブ 0 個で **172.39px**（状態の行を含む。文書の目安 130px より 42px、理想個体の 140.4px より 32px 高い。内訳は上下の余白 4＋6・段の間 5×2・下の線 1・1 段目 54.4・2 段目 69〔32＋5＋32〕・状態の行 28）。1280px も 172.39px（パッシブの欄 697px で 3 個でも改行しない）。1100px で 3 個目に長い名前（鬼神など）が来ると改行して 210.39px（+38px。D20）。920px は 209.39px（2 段目 3 行）・3 個で 247.39px。どの幅も横のスクロール・はみ出しなし。**理想個体より高いのは状態の行（28px＋段の間 5px）があるため**で、2 段目は 2 行が下限（所持者・場所のチップ・パッシブの条件・個体値・★・属性を 1 行に並べると約 1,850px）。別案（どれも未実装・ユーザーに確かめる）: (a) 1 段目の見出しをやめる（約 −16px → 約 156px。理想個体で採らなかった案）、(b) 2 段目の 2 行目（パッシブの条件・個体値・★・属性）を「詳しい条件 ▾」に畳み、ふだんは 1 行にする（約 −37px → 約 135px。効いている条件は状態の行のチップで見える）、(c) 状態の行の高さを 24px にする（−4px）。場所のチップの名前を縮める（「ボックス」「次元」「グローバル」）のは段の数が変わらないので効かない。
9. **状態の行（手順 6・8・O-04・O-40・O-50）**: `div.owned-status-row`（高さ 28px・1 行）に左から `p.result-note.owned-count`「129 / 138 体 · ♂59 ♀65 タマゴ 5」（タマゴ 0 は出さない。グローバルパルボックスを外していて数があれば title「グローバル 9 体は非表示」）・`div.filter-chips`（role=group・aria-label「効いている条件」。高さ 24px で入り切らない分は隠す）・`span.filter-more`「+n」（隠れたチップの名前を title に。場所は空けておく）・`button.owned-reset`「すべて解除」（条件が無ければ disabled）・「リンクをコピー」・**並べ替えの select（aria-label「並べ替え」。2 段目に入らないのでここへ移した）**・`a.owned-panel-link`「理想個体 →」「継承ルート →」。
   - 条件のチップは既定から変えた条件だけで、順は 所持者・場所・拠点・属性・パル・パッシブ（1 つずつ）・パッシブの条件（だけ／なし）・★・個体値（HP・攻撃・防御）・キーワード。文: 「所持者: Alice（自分）」「場所: タマゴを除く」「場所: パルボックス・拠点」（3 つ以下は並べ、多いときは除いたもの、グローバルを足しただけなら「グローバルパルボックスも含む」）「拠点: 拠点 1」「属性: 炎・闇」「パル: アヌビス」「パッシブ: 伝説」「パッシブの条件: だけ」「パッシブなし」（なしのときはパッシブのチップを出さない）「★2 以上」「HP 90 以上」「キーワード: ア」。`span.filter-chip-item > button.filter-chip[data-focus]`（aria-label「HP 90 以上 を外す」・`span.filter-chip-text`・`span.filter-chip-x`）を `syncList` で使い回し、× で外したら次のチップ（無ければ前、どれも無ければキーワード）へフォーカス。
   - 「+n」の数え方と O-05 の位置の確かめは、**次の描画の前（requestAnimationFrame）にまとめて読む**（`afterLayout`。入力の処理の中で、描き換えた 2,000 行のレイアウトを強制しないため。rAF の無いテストではすぐ読む）。チップの入れ物の幅が変わったら ResizeObserver で数え直す。
   - すべて解除・0 件の「条件をすべて解除」（`empty(…, button('条件をすべて解除'))`）: 値を既定に戻し（**並べ替えは条件ではないので残す**）、作ったときに値を入れた部品（キーワード・パル・★・個体値）も含め全部の部品をそろえる（`showFilter`）。0 件の表示から押したときは、そのボタンが消えるのでキーワードへフォーカス。
   - リンクをコピー: `navigator.clipboard.writeText` → トースト「リンクをコピーしました」。失敗（権限なし・HTTP で clipboard が無い）は例外を出さず、ボタンの下の板 `div.owned-link-field`（role=dialog）に読み取り専用の欄を出して全選択（「コピーできませんでした。下のリンクを選んでコピーしてください。」）。
   - 理想個体・継承ルートへのリンク（O-40）: **文は短く「理想個体 →」「継承ルート →」にし、文書の文は aria-label・title に「この条件で理想個体を開く」「このパッシブを運ぶ継承ルートを開く」**（文書の長い文だと、2 つ出たときに条件のチップの場所が約 50px しか残らなかった）。理想個体は `buildHash('ideal', { to, p: 正のランクのパッシブ })`、継承ルートは `buildHash('route', { p })`（パッシブの条件「なし」では出さない）。
10. **条件を変えたら結果の先頭を見せる（手順 9・O-05）**: 利用者の操作（所持者・場所・拠点・属性・パル・パッシブ・パッシブの条件・個体値・★・キーワード〔間引きの後に 1 回〕・並べ替え・条件のチップの ×・すべて解除）の後だけ、一覧 `.owned-list` の top がパネルの下端より上なら `scrollIntoView({ block: 'start' })`。データの更新・applyRoute（URL・戻る/進む）では動かさない。**`scroll-margin-top` は文書の `calc(var(--header-h) + var(--panel-h))` ではなく `var(--panel-h)`**（html の `scroll-padding-top` がヘッダー＋8px を受け持つので、足すとヘッダーの分だけ下に離れる。今は一覧の先頭がパネルの下端＋8px に来る。行 `.owned-row` も同じ）。
11. **部品を作り直さない（手順 10）**: パッシブは `passive.update({ selected, counts, disabled })`。**passive-picker.js の `update` に `disabled` を足した**（追加のボタンとチップの × を押せなくし、開いていれば閉じる。選んだチップは残す。部品の `is-disabled`）。パッシブの条件「なし」の間に使う。
12. **ui/popover.js の focusOut の直し（文書になかった）**: 板の中の別の部品（属性のトグル・拠点のチェック・保存の板のボタンなど）を押すと、Chrome では focusout の後の microtask の時点ではまだ body なので板が閉じ、押した部品の click が届かなかった。→ focusout の `relatedTarget` が板の中なら閉じない（外へ出るときは今までどおり）。**main では理想個体の「目標として保存」の板の「保存」を押しても保存されずに閉じていた**（main の worktree で、板の「保存」を押して確かめた。ideal-panel の記録の確認は Enter で保存していた）ので、この直しで直った。release-notes に別に 1 件足した（`2026-10-13-ideal-save-click`）。所持パルの 4 つの板（拠点・属性・まとめて・リンク）は、余白を押しても閉じないよう板そのものに `tabIndex = -1`。
13. **見えている範囲だけ描く一覧と位置の戻し**: 自動の更新で見ていた行を戻す基準（`anchorOf`）と `virtualRows` の `topOffset` を、ヘッダーの下端からパネルの下端（`panel.getBoundingClientRect().bottom`）にした（パネルの下に隠れた行を基準にしない）。
14. **CSS（手順 11）**: `.owned-filters`・`.owned-filter-group`・`.owned-passive-slot`・`.owned-toggles` を消した。**`.owned-toggle` は設定の画面（views/owned-settings.js の自動登録のオン・オフ）が使っているので残した**。足したもの: `.owned-panel*`・`.place-chip*`・`.place-bases*`・`.owned-element-*`・`.element-toggle*`・`.owned-talent-filter`・`.talent-preset-*`・`.owned-status-row`・`.filter-chip*`・`.filter-more`・`.owned-link-*`・`.owned-sort`・`.owned-panel-link`・`.search-select*`。
15. **テスト**: 新しい test/web/search-select.test.js（4 件）、test/core/owned.test.js（新しい `filterOwned` の 3 件）、passive-picker.test.js（disabled 1 件）、ideals.test.js（`selfUids` 1 件）、popover.test.js（relatedTarget 1 件）、owned-view.test.js に 14 件（パネルと `--panel-h`・所持者が理想個体と同じ意味〔palsOfPlayers と同じ集合〕・自分の個体と「（自分）」・同じ名前の UID・場所のチップの件数と拠点 ▾・属性の OR・パッシブの条件・条件のチップの ×・すべて解除と 0 件の解除・リンクをコピー〔新しい画面で同じ件数・失敗の欄〕・migrateFilter〔古い viewState・古い URL〕・URL の検証・O-05・O-40）。どれも変える前のコードで落ちることを確かめた（search-select はモジュールが無い、owned-view は `migrateFilter`・`DEFAULT_PLACES` の import で読めない）。**期待値を直したもの**: 件数の行「3 体」→「3 / 4 体 · ♂1 ♀1 タマゴ 1」（owned-view・app.test.js）、「タマゴも表示」「グローバルボックスを表示」のチェック → 場所のチップ（owned-view 4 か所・app.test.js の読み込み直し）、所持者の select の探し方（`[aria-label="所持者"]`）、「すべて 90 以上」は「まとめて」を開いてから、パッシブの欄のラベル（`passive-chip:パッシブ:…`）、並び（ペンタマはキツネビより図鑑番号が前）、rAF を 1 回ずつ回すテストは「+n」の数えの分を進める。**振る舞いを変えたもの**: URL の条件が来たら、URL に無い条件（キーワードなど）も既定に戻し、打ちかけのキーワードも URL に合わせる（既存のテスト 2 つの書き換え。テスト名・コメントに前の動きを書いた）。`test/perf/owned.perf.js` の `filterOwned` の呼び出しから使わなくなった `globals: true` を外した。テストの偽 DOM（test/helpers/dom.js）は変えていない。
16. **後のテーマへの申し送り**:
    - owned-rows: 列見出しは `top: calc(var(--header-h) + var(--panel-h))`（`--panel-h` は `section.view.owned-view` に書いてある）。並べ替えは今は状態の行の select（`select.owned-sort`・aria-label「並べ替え」・`filter.sort`）にあるので、列見出しで並べ替えるときはこの select と `filter.sort` を合わせる（どちらかを残すかはそのテーマで決める）。`.owned-list` と `.owned-row` の `scroll-margin-top: var(--panel-h)` は、列見出しを足したらその高さも足す。O-05 の「一覧の先頭」も列見出しの上端にするか確かめる。
    - participant-self: 許す個体の Set は ownedView の中の `allowedIds(data)` が作り、変数 `holderIds` に覚える（データ・所持者・自分の UID の並びが同じ間は使い回す）。「自分」が変わったら `holderIds = null` → `renderFilters(owned.state)`（所持者の選択肢の「（自分）」も `ideals.selfUids()` で作り直す）→ `renderResults({ keepPosition: true })` を呼べばよい（今は自分の UID の並びが変わったときだけ、次に描くときに作り直す）。自分が分からないときの文は `renderCount` と `emptyText`（`renderResults` の中）にある。
    - フェーズ 2 の登録者の選択: 上の 5 の `searchSelect` を使う。
    - 性能: 2,000 行でキーワードを打つと Long Task が 81〜120ms 出た（main も同じ条件で 126〜157ms。計測の記録）。CPU プロファイルでは JS の自分の時間は約 50ms で、残りはブラウザの再計算（行の描き直し）。行の形を変える owned-rows で見直す。
17. **フェーズ 1b・1c の終わりのレビューの直し（2026-10-13、ブランチ `fix/phase-1bc-review-owned`。指摘 B3・B4・B6〜B10・B13・B14。行の分は owned-rows の記録 17）**:
    - **B3 リンクをコピー**: `copyLink` は要求の番号 `copySeq` を持ち、`navigator.clipboard.writeText` の返事の後に `destroyed`・番号を確かめてから板・トーストを出す（成功も失敗も同じ）。前は返事を待つ間に画面を閉じると、閉じた画面の板と document のリスナーが付き直していた。
    - **B4 検索つきの選択（ui/search-select.js）**: `onKey` の始めで `event.isComposing || event.keyCode === 229` なら何もしない（変換を確定する Enter で候補を選び、変換中の矢印で候補が動き、変換を取り消す Esc で板が閉じていた）。フェーズ 2 の登録者の選択も同じ部品なので、そのまま効く。
    - **B6 一覧の先頭を見せる位置**: ui/dom.js の **`trackHeight(target, host, name)` の戻り値（監視をやめる関数）に `measure()` を足した**（今すぐ測って書く。ResizeObserver の無い環境でも同じ形）。`revealResults` は requestAnimationFrame の中で `scrollIntoView` の直前に `stopTracking.measure()` を呼ぶ。同じ操作でパネルの高さが変わったとき（パッシブのチップの改行など）、rAF の時点では ResizeObserver の知らせが来ておらず `--panel-h`（scroll-margin-top が使う）が前の値だったため。画面（1100×900・138 体）でパネルに 38px の仮の要素を足して同じタスクで場所のチップを押すと、一覧の上端 − 列見出しの下端は 前 −35.3px → 0px（`review-fix-owned/b6-b7.js`）。理想個体のパネル（同じ `trackHeight`）で先頭を見せる所を作るときも、この `measure()` を呼ぶ。
    - **B7 案内の帯の出入り**: `renderSummary` は案内の中身（`noticesKey`）が変わるとき、一覧の先頭がパネルと列見出しの下に隠れている（`results` の top < `fixedBottom()` − 1）ならだけ、書き換える前後の一覧の top の差だけ `window.scrollBy` で戻す。ページの上の方では動かさない（出てきた帯が見えるように）。画面（`window.__owned` に許可切れを入れて知らせ直す）で scrollY 2000 の見ている行は 前 210.08 → 184.08px・後 210.08 のまま、scrollY 0 では前後とも帯の分（54px）下がる。データの更新のときの `anchorOf`（`renderResults({ keepPosition })`）は、この補正の後に取られる。
    - **B8 状態の行の条件のチップ**: 1 行目からはみ出して隠れたチップの入れ物 `span.filter-chip-item` は **`inert`**（Tab で止まらず、読み上げにも出ない）。`renderChips` は同期の前に全部の `inert` を外し（外した後のフォーカスの行き先になれるように）、`measureChips`（次の描画の前）が付け直す。隠れるチップにフォーカスがあれば「+n」へ、「+n」にフォーカスがあるまま隠れるチップがなくなれば最後のチップ（無ければキーワード）へ。**「+n」は `span.filter-more-slot` の中の `button.filter-more`**（前は aria-hidden の `span.filter-more`。aria-label「+2（隠れている条件 2 個）」・aria-haspopup dialog・title に名前。隠れたチップがないときは今までどおり `.is-empty` で場所だけ残す）で、押すと `createPopover` の板 `div.filter-more-popover`（role=dialog・aria-label「隠れている条件」）に `div.filter-more-list` と隠れたチップと同じ形の `button.filter-chip`（× で外せる。開くと最初のチップへ、外すと同じ番号〔無ければ前〕のチップへ、なくなれば板を閉じて状態の行の最後のチップへ）。チップの形は `chipButton(condition, onClear)` にまとめた。`.filter-chip:focus-visible` は `outline-offset: -2px`（入れ物が 1 行分の高さではみ出しを隠すので、外側の枠の上下が切れていた）。テストの `filterChips` は状態の行の `.filter-chips` の中だけを数える。
    - **B9 押した後に押せなくなるボタン**: 「すべて解除」を押したら（押したときにフォーカスがあれば）キーワードへ、拠点の板の「すべての拠点」を押したら、押せなくする前に板の先頭（検索欄か最初の拠点のチェック）へフォーカスを移す（disabled のボタンからフォーカスが body に落ち、拠点の板は focusOut で閉じていた）。aria-disabled にはしていない。
    - **B10 「まとめて ▾」**: 項目 `button.talent-preset-item[role=menuitem]` は `tabIndex = -1`、板の keydown で ↑↓（端で回る）・Home・End。Tab は今までどおり板を閉じて「まとめて」へ戻る（`createPopover` の focusOut）。
    - **B13**: 「リンクをコピー」は板（コピーできなかったときの欄）を開いている間だけ `aria-expanded`（作った直後と `onClose` で外す。`createPopover` は anchor にいつも `aria-expanded="false"` を付けるため）。**列見出しの toolbar の aria-label を「並べ替え」から「列見出しで並べ替え」にした**（状態の行の select「並べ替え」と分ける）。
    - **B14 古い保存**: `migrateFilter` は、前の形の `place` と `eggs`・`globals` の組み合わせで `places` が空になったら（`{ place: 'egg', eggs: false }`・`{ place: 'global', globals: false か無し }`）、`place` を選んでいない既定（eggs・globals の表示はそのまま）に戻す（記録 1 の「前と同じく 0 件になる」を変えた）。
    - テスト（owned-view.test.js・search-select.test.js・dom.test.js）: 上の直しの回帰（どれも変える前のコードで落ちる）と、A13 の所持パルの分（条件のチップの × の後のフォーカス〔次 → 前 → キーワード〕・列見出しの ←・Home・End と端の回り込み・拠点／属性の板を開いたときのフォーカスと Esc・リンクの板の Esc）。
18. **フェーズ 1b・1c の終わりのレビューの直し（理想個体側。2026-10-13、ブランチ `fix/phase-1bc-review-ideal`。A7・A9・A10 の所持パルの分）**:
    - 所持者の選択肢を作る ownedView の中の `holderChoices(data)` を **views/shared.js の `holderChoices(data, ideals)`** に移した（理想個体の所持者を同じ名前にするため。中身は同じ）。participant-self で「自分」を変えるときは、上の 16 の申し送りの `renderFilters` がこれを呼ぶ。
    - パッシブの条件の押しボタン「全部」を「**全部持つ**」にした（理想個体の「全部持つ／だけ」とそろえる。指摘の条件「パネルの 2 段目が 1100px で折り返さず、高さが変わらないときだけ」を満たした）。画面（`review-fix-ideal/a9-mode-label.js`）: 1100px・1280px で 2 段目は 2 行のまま、2 行目の右端 1029 → 1055px（行の右端 1061px。残り 6px）、パネル 172.39px のまま。920px も 3 行・209.39px のまま。残りが 6px なので、文字の幅の違うフォントでは 2 行目の最後（属性 ▾）が 3 行目に回りうる。
    - 「目標の印」の title「登録した目標の…」→「保存した目標の…」。
    - release-notes: owned-toolbar の body「条件のリンクを写せます」→「「リンクをコピー」で条件を渡せます」、移った機能の行き先を 1 件足した（`2026-10-13-owned-moved`「所持者の拠点は場所のチップの ▾、並べ替えは状態の行と列見出し、「すべて 90 以上」は「まとめて ▾」へ移しました。」）。上の 12 で足した `2026-10-13-ideal-save-click` は消した（未配信で、同じ配信で「目標として保存」が初めて出るため。12 の直しはそのまま）。
19. **フェーズ 1b・1c の終わりのユーザーの答え（2026-10-13、ブランチ `fix/phase-1bc-answers`。D27 の「全部持つ」）**: 上の 18 の「1100px で 2 段目の右端までの余りが 6px」をユーザーに確かめ、「1100px で 24px 以上の余りを作る。作れないなら『全部』に戻す」となった。→ **「全部持つ」のまま、押しボタン（ui/segmented.js）の左右の余白を 12px → 8px にした**（`:is(.ideal-panel, .owned-panel) .segmented-option`。理想個体のパネルの押しボタンも同じ見た目にそろえた）。パッシブの条件の押しボタンは 178.1 → 154.1px、**1100px の 2 段目の 2 行目の余りは 6.1 → 30.1px**、パネルは 172.39px のまま（1280px も 172.39px・余り 210px、920px は 209.39px・3 行のまま）。理想個体のパネルは 140.39px（1100px）・163.98px（920px）のまま。試した形（`answers/mode-room.js` で style.setProperty を当てて測った）: 余白 9px は 24.1px（ぎりぎり）、余白 10px と 2 段目の間 14 → 10px は 30.1px（1 行目も +4px）。間を詰めると欄の区切りが分かりにくくなるので、押しボタンの余白だけにした。
    - 気づいたこと（直していない）: 2 段目の 1 行目（所持者と場所のチップ）も 1100px で余りが 17.9px しかない。場所のチップの件数の桁が増える（パルボックスが 3 桁 → 4 桁など）と、チップが 2 行目に回ってパネルが伸びうる（今のモックは 69 体）。
20. **フェーズ 1b・1c の後のユーザーのフィードバック（2026-10-13、ブランチ `fix/phase-1bc-feedback`。D28「項目の区切りが分かりづらく、ぱっと見でどれが何の設定項目なのか分かりづらい」）**: パネルを、まとまりと見出しが一目で分かる形に作り直した（理想個体のパネルと同じ部品・同じ CSS の決まり。共通の部品と CSS は ideal-panel の記録 14）。細かな UI は D27 のとおり担当が決めた。
    - **1 段目**: 見出しの行（`div.field-head`）を作り、**パッシブの条件（全部持つ／だけ／なし）をパッシブの見出しの行へ移した**（前は 2 段目に「パッシブ」の見出しでもう 1 回出していた。条件をかける欄の隣に置き、2 段目の幅も空く）。**「理想個体 →」はパルの見出しの行の右端、「継承ルート →」はパッシブの見出しの行の右端へ移した**（前は状態の行の右端で、2 つと目標の印が出て件数の文が長いと、条件のチップの場所が見積もりで約 110px しか残らなかった。リンクの文・aria-label・出す条件は記録 9 のまま。`.owned-panel-link` は `margin-left: auto`・12px・太字）。
    - **2 段目**: `div.owned-panel-sub` の中を 2 行（`.panel-line`）にした。1 行目 **[所持者][個体値（以上）][★][属性 ▾]**（理想個体の 1 行目 [所持者][個体値（以上）] とそろえる）、2 行目 **[場所のチップ]**。前の `.owned-panel-item` は `.panel-item`（views/shared.js の `panelItem`）、個体値の欄に `.owned-talent-item` を付けた。前の幅 1080px 以下の `order`（所持者・★・属性を前へ）は 1 行目の中だけで、個体値を後ろへ回し（`order: 1`）、行の頭に来る個体値には区切り線を付けない。1100px の 1 行目の余りは **31.05px**（D27 の 24px 以上を保つ。前は 2 行目の余り 30.1px）。場所の行の余りは 131.63px（記録 19 の「気づいたこと」の 1 行目の余り 17.9px は、場所が 1 行を使うので当たらなくなった）。
    - **場所のチップ**: 押して切り替えるチップなので、**オンは ✓（`::before`）と secondary-container の地、オフは枠だけ**。幅 1080px 以下は 11px・左右 7px に詰めて 920px でも 1 行に収める（余り 60.2px）。
    - **状態の行（結果の行）**: 高さ 28 → 30px、角の丸い**薄い primary の地の帯**（`--result-bar`: `color-mix(in srgb, primary 8%, surface)`。ダークも同じ式）にして、条件の欄と結果を分けた。件数は `strong.owned-count-shown`（出ている数を 13px・太字）・`span`（「 / M 体」）・`span.owned-count-detail`（内訳。薄いまま）に分けた（文は前と同じ。テストは textContent を見る）。**効いている条件のチップ（`.filter-chip`）は、枠（outline）と明るい地（surface-container-low）・× を薄くしたタグ**にした（前は場所のチップのオンと同じ secondary-container の地で見分けにくかった）。**並べ替えに見出し**: `label.owned-sort-field` に `span.field-label`「並べ替え」（aria-hidden。読み上げの名前は select の aria-label「並べ替え」のまま）と select（高さ 26 → 24px）。並びは [件数][条件のチップ][+n][目標の印][すべて解除][リンクをコピー][並べ替え]。1100px で目標の印も出て件数の文が長いときの条件のチップの場所は、見積もりで約 200px（各部品の幅を測った値から計算。画面で全部をそろえては測っていない）。
    - **高さ（ヘッドレスの Chromium・ライト/ダーク同じ。`shots/owned/feedback/panels.js`）**: 1100px・パッシブ 0 個で **172.39 → 184px**（目安 190px 以内。見出しの行 14.4 → 24px と状態の行 28 → 30px の分）、パッシブ 4 個（ダイヤモンドボディを含め 2 行）で 210.39 → 222px。1280px も 184・222px。920px は 209.39 → 221px（2 段目は [所持者][★][属性]／[個体値]／[場所] の 3 行のまま）、4 個で 297px（チップが 3 行。phase-1a の popovers の記録の D28）。どの幅も横のはみ出しなし。
    - **画面の確かめ（`feedback/interact.js`）**: 見出しの行の「だけ」を押してもパネルは 184px のまま、パッシブの板はパッシブの行の真下に開く、Tab の順はパル選択 → パッシブの条件（選んでいる押しボタン）→ 継承ルート → → パッシブを追加 → チップの × → キーワード → 所持者。
    - 採らなかった案: 1 段目と 2 段目の間の横の区切り線（+6px で目安の 190px を超える）、結果の行の先頭に「結果」の文字（条件のチップの場所が減る。地の色と太い件数で足りる）、場所のチップの名前を縮める（記録 6 のまま略さない）、オフの場所のチップにも空の □ を付ける（6 個で約 96px 増えて 1 行に入らない）。
    - テスト: owned-view.test.js のパネルのテスト（見出しの行・「パッシブ」の見出しが 1 回・2 段目の 2 行・並べ替えの見出し）とリンクのテスト（置き場所）、styles.test.js（場所のチップのオンの ✓・条件のチップの枠）。どれも変える前のコードで落ちることを確かめた。
21. **2026-10-14 のユーザーのフィードバック（ブランチ `fix/feedback2-owned`。D29。細部は D27 のとおり担当が決めた）**:
    - **場所のチップの数をなくした**（「場所の選択肢にパルの数が書かれているが、これも不要」）: `span.place-chip-label`・`span.place-chip-count` と aria-label「パルボックス（69 体）」をやめ、チップは名前の文字だけの `button.place-chip`（読み上げの名前も見えている文字）。0 体の場所のチップを隠す決まりはそのまま（`statsOf` は場所ごとの数〔`counts`〕だけを持つ。件数の行の title「グローバル N 体は非表示」にも使う）。
    - **拠点の ▾ をなくした**（「…その違いが分からない。拠点1～4の選択プルダウンは不要」）: `button.place-chip-more`・`span.place-bases-slot`・板 `div.place-bases`（`baseRow`・`renderBases`・`pruneBases`・`BASE_SEARCH_OVER`・拠点の検索欄・「すべての拠点」）と CSS、条件のチップ「拠点: …」、絞り込みの値の `bases`、core/owned.js の `filterOwned` の `bases` を消した（上の 3・6 と 17 の B9 の拠点の分）。上の 1・2 の読み替えは: 所持者 `base:<id>` → 場所 `['base', 'egg']`（eggs: false なら `['base']`）、D29 より前の保存の `bases`・URL の `base` → 選んでいた場所を拠点・タマゴの中だけにする（どちらも選んでいなければ `['base', 'egg']`）。どの拠点かは見ない。`OWNED_MEMORY.bases` は前の形の値として残し（配列でなければ undefined で、今の形の保存には書かない）、`migrateFilter` の結果には `bases` を入れない（`adopt` で入れ物からも消える）。`filterParams`（リンクをコピー）は `base` を書かない。
    - **所持者の選択肢と既定**（「所持者はデフォルトで自分の個体が選択された状態とし、自分の個体という選択肢ではなく、それは自分の名前の選択肢になるようにして」）:
      - views/shared.js の **`holderChoices(data, ideals)`** は「すべて（`''`）・自分（`mine`。名前は自分のプレイヤー名に「（自分）」。自分の UID が複数あれば名前を「・」でつなぐ）・ほかのプレイヤー（`player:<uid>`）」。前の「自分の個体」（`mine`）と、自分の `player:<uid>`（「Alice（自分）」）の 2 つを 1 つにした（中身は前の「自分の個体」と同じ `ideals.mine()`）。自分の選択肢は自分のプレイヤーが分かるとき（`ideals.selfUids()` が空でない）だけ出す。自分だと分かる印は前と同じ「（自分）」にした（選択肢・条件のチップ・理想個体の要約で同じ名前になる）。
      - **既定は `HOLDER_DEFAULT`（`'mine'`。views/shared.js）**。`OWNED_MEMORY.holder` は、無い・形の合わない値を `'mine'` にする（「すべて」の `''` はそのまま）。覚えている条件のある人（同じタブの sessionStorage）は、その値のまま。
      - **`holderValue(holder, ideals)`（views/shared.js）が条件の値を画面の値にする**: `mine` は自分のプレイヤーが分からなければ `''`（すべて）、自分の `player:<uid>`（前の保存・URL）は `mine`。条件の値（`filter.holder`）は書き換えないので、自分が後から分かったら自分になる。所持パルは `holderNow()` を、選択の値・許す個体（`allowedIds`。前の `{ ids, unknown }` から Set だけを返す形にした）・条件のチップ・リンクをコピーに使う。上の 4 の「0 / M 体 · 自分のプレイヤーが分かりません」と 0 件の文（`emptyText`）はなくした（届かない）。
      - 条件のチップ「所持者: …」は、画面の値が既定の画面の値（`holderValue('mine')`）と違うときだけ。「すべて」も既定と違えば「所持者: すべて」（自分が分からないときは既定が「すべて」なので出ない）。× と「すべて解除」は `mine` に戻す。選んでいたプレイヤーがデータから消えたら、`''` ではなく `mine` に戻す。
      - **URL**: 絞り込みの名前のある URL に `holder` がなければ、前と同じ「すべて」（`filterFromParams` の `params.get('holder') ?? ''`。前に写したリンク・場所が分からないパルの「見る」の意味を変えない）。`holder=mine` は自分、自分の `holder=player:<uid>` も自分として読む。リンクをコピーは画面の値（自分なら `holder=mine`、すべてなら付けない）。
      - **自分が後から分かったとき**: `context.store` の購読で、自分のプレイヤーの並び（`selfKey()`）が選択肢を作ったとき（`renderHolders` の `shownSelf`）と変わったら、`renderFilters` と `renderResults({ keepPosition: true })`（ユーザーの一覧が後から届く・ID が変わるなど）。許す個体の Set（`holderIds`）は自分の UID の並びも鍵にしているので作り直される。
      - web/js/app.js の `forgetHolders`（表示するワールドが替わったとき）は、プレイヤー（`player:…`）を選んでいたときだけ `mine` に戻す（`mine` と「すべて」はどのワールドでも同じ意味なので残す。前はどれも `''`）。
    - 画面（モック・138 体・Alice でログイン。`Claude outputs/ui-audit-2026-10/shots/owned/feedback2/owned.js`。1100／920px・ライト／ダーク）: 開くと所持者「Alice（自分）」・「69 / 138 体」・条件のチップなし、選択肢は「すべて・Alice（自分）・Bob・Carol」。場所のチップは「✓ 手持ち」「✓ パルボックス」…（数なし）で ▾ なし。パネルの高さは 1100px 184px・920px 221px のまま（場所のチップは短くなったが、行の数は同じ）。横のはみ出しなし。「すべて」にすると「所持者: すべて」のチップが出る。
    - テスト（owned-view.test.js）: 場所のチップの文字と aria-label がない・▾ がない、migrateFilter と古い保存・古い URL の読み替え（`bases` を残さない）、所持者の選択肢と既定・条件のチップ・× と「すべて解除」・URL の `mine` と自分の `player:<uid>`・所持者のない URL は「すべて」、自分が分からないとき、自分が後から分かったとき、`OWNED_MEMORY` の holder。core/owned.test.js（`filterOwned` に `bases` を渡しても絞らない）。どれも変える前のコードで落ちることを確かめた。期待値を直したもの: `placeChips`（aria-label → 見えている文字）、`migrateFilter(null)` の holder（`''` → `'mine'`）と `bases` がないこと、B9・A13 のテスト（拠点の板の部分を外した）。
    - 後のテーマへ（上の 16 の申し送りを直す）: participant-self — 「自分」を変えたら、所持パルは今の `context.store` の購読と同じ処理（`selfKey()` が `shownSelf` と違えば `renderFilters`・`renderResults({ keepPosition: true })`）を `context.self` の購読からも呼べばよい（`holderIds` は自分の UID の並びを鍵にしているので null にしなくてよい）。自分が分からないときの文は、今は出さない（所持者の選択肢に自分が出ないことが、自分が未設定の印）。

---

## owned-rows: 列見出し・4 セル・固定枠で、行の高さをそろえる

### 目的
所持パルの一覧の先頭に sticky の列見出し（押すと並べ替え）を置き、行を固定の高さにする（個体値は 4 セル＋ミニバー、★は 4 枠、パッシブは 2×2 の固定枠、場所は短い表記＋ボックスの位置の小さな図）。行から理想個体・継承ルート・配合を探すへ進めるようにし、目標の完成品・欲しいパッシブ持ちの印を出す。

### 経緯
- 別プランの **F069**（sticky の列見出し、押すと並べ替え・もう一度で昇降）・**F043**（個体値を HP／攻／防／計の 4 セル＋ミニバー。理想個体の 190px の特例をなくす）・**F066**（★は 4 枠、パッシブは 2×2 固定、「☆なし」「パッシブなし」の文字を外す、場所は「パルボックス P2 · 1-6」＋6×5 の図、タマゴの Lv は「—」）・**F063**（行のホバー／フォーカスで「目標に」「ここから継承ルート」「親1 にして配合を探す」）。
- 別プラン §9 の Codex の決まり: 行部品は `{ element, update, destroy }`・復元は `focus({ preventScroll: true })`・**列見出しは syncList の管理行に混ぜず、行の入れ物と分けて同じ grid の定義を共有**・**「+N」は 3 個＋残り N のポップオーバー（行内展開はしない）**・**content-visibility の推定の高さ（app.css:933 の 60px）を新しい行の高さに合わせ、sticky の要素には付けない**・**列見出しの並べ替えは単項目ソート（HP／攻／防）を OWNED_SORTS に足し、全ソートに最後の id の比較と aria-sort**・**場所の図は正規化の結果に構造化した位置（page/row/col）を持たせる。共有の placeLabel は互換のため短くしない**。
- 本セッションの案: **O-21**（能力ごとの個体値順）・**O-22**（判断: 「場所順」をボックスの並びに。共有の列は足さず placeLabel から読む）・**O-24**（判断: 「パッシブの数が多い順」を「良いパッシブ順（ランクの合計）」に置き換え、キーは 'passives' のまま）・**O-10**（判断: 拠点の個体の「拠点 1／拠点 1／預けた人」の重なりを表示で直す。CSV の列名は変えない）・**O-25**（判断: 行の中だけランクの高い順に並べる。負のパッシブを薄くはしない）・**O-30**（行の推定の高さ）・**O-44**（個体値のミニバー。判断: CSS 変数でバーを描き SVG は使わない、ケーキの 3 段階と合計の表示は入れない、aria-label に数値）・**O-45**（★の 4 枠。判断: CSS の ★／☆ の色分けでもよい）・**O-52**（判断: 印は「完成品: 目標名」と「目標名の欲しいパッシブ」の 2 つ、表示の切り替えは既定オン、キーワードで探せる。継承ルートの印は保存がないので作れない）・**O-38**（判断: 列は足さず、行の右端に重ねる。p には正のランクのパッシブだけ）・**V-10**（判断: 6×5 の小さな図。合わなければ文字だけ）。

### 依存
owned-toolbar（パネルの高さ `--panel-h`・並べ替えの選択）、stable-render（`syncList`・最初の 200 行と区切った描画・古い仕事の無効化）、ideal-results（`ownedRow` の `highlight`）、ideal-farms（`ownedRow` の `marks`）。（追記 2026-10-13、ideal-results の実装の後: `ownedRow(pal, { notes, highlight })`・`fillOwnedRow(row, pal, { notes = [], highlight } = {})` で、中は views/owned.js の `passiveCell(ids, wanted)`〔wanted が 1 個以上のときだけ `.is-wanted`＋`span.passive-check`・`.is-extra`〕と `talentCell(talent, targets)`〔targets があるときだけ `span.talent-cell[data-key][role=img]` ×3＋`span.talent-sep`、`.met`／`.short`＋`span.talent-diff`。targets がない所持パルの画面は 1 つの文のまま〕。差は値の下に小さく出している〔個体値の列 190px に収めるため〕。4 セルにするときは talentCell を置き換え、所持パルの画面でもセルにする。ideal-results の「実装の記録」9）

### このテーマでやらないこと
- 個体の詳細のドロワー・キーワード一致の全文（フェーズ 3 の owned-detail。ここでは 1 行に省略し title に全文）。
- 「目標に関係しない個体から」の並べ替え（O-52 の判断にはあるが統合プランの要点にない）。牧場の親の印（フェーズ 3 の farm-board の O-51）。入手時刻の NEW・お気に入り（フェーズ 4 の save-extras）。
- ゲームから取り出す★・属性のアイコン（フェーズ 4 の game-assets）。共有の列（OWNED_FIELDS）を足すこと。
- 2,000 行を超えたときの「見えている範囲だけ描く」形（stable-render で入れる。ここでは行の高さを固定してその前提をそろえる）。

### 現状
- `ownedRow`（web/js/views/owned.js:51-69）: 列は `[パル][Lv・★][パッシブ][個体値][所持者・場所]`（CSS は app.css:920-927 の `grid-template-columns: minmax(180px, 1.3fr) 80px minmax(0, 2fr) 150px minmax(0, 1fr)`）。★は `pal.stars ? '★'.repeat(n) : '☆なし'`（:55）、タマゴの Lv は「孵化前」（:55）、所持者・場所・「預けた人」（:56-58）、パッシブは保存の順で `passiveList`、なければ「パッシブなし」（:60）、キーワード一致の理由は 1 件 1 段落（:61-66）、個体値は「HP 70 / 攻 100 / 防 64」の文字（:17-19・:67。150px で折り返す）。
- 一覧は `results.replaceChildren()` の後に全件を `append`（:220-223）。`.owned-row` は `content-visibility: auto; contain-intrinsic-size: auto 60px`（app.css:933）。理想個体の組は `.ideal-pair .owned-row` で個体値の列を 190px にする特例（app.css:1065）。
- 並べ替え（core/owned.js:328-350）: 図鑑番号・パッシブの数（:343 `b.passives.length - a.passives.length`、負のパッシブも 1 個）・レベル・★・個体値の合計・場所（:347 場所のグループ→所持者の名前→図鑑。ボックスの並びではない）。最後の決め手に id はない。
- 位置: `palboxPosition`（core/owned.js:41-46）で page/row/column を求めるが、`placeLabel` の文字（:157-158「パルボックス 2 ページ・1 行 2 列」）にするだけで値として残さない。共有の行も placeLabel だけ（core/owned.js:462・:513）。
- 拠点の個体は holder も placeLabel も拠点の名前（core/owned.js:151・:159）なので、行に「拠点 2／拠点 2／預けた人 Alice」と 3 行出る。
- 計測（appendix/measurements.md 撮影 owned #7）: 同じ 129 行で scrollHeight が 10011／10001／9574／9757 と揺れる（推定 60px と実際の約 50〜85px のずれ）。

### 実装の手順
1. **正規化に位置の値**（core/owned.js）: `normalizeOwned` の push（:163-199）に `box: boxAt ? { page, row, column } : null`（:157 の `boxAt` をそのまま）。`ownedFromShared`（:499-515）は `placeLabel` を `/^パルボックス (\d+) ページ・(\d+) 行 (\d+) 列$/` で読み、合えば `box`。読み取りの関数 `parseBoxLabel(label)` を `palboxPosition` の隣に置き、:158 の書式と同じテストで結び付ける（書式を変えると共有から位置が読めなくなるため）。共有の列は足さない。
2. **並べ替えに向きと新しい項目**（core/owned.js:328-350）:
   - `OWNED_SORTS` を `[key, ラベル, 既定の向き]` にし、`hp`（HP の個体値）・`shot`（攻撃）・`defense`（防御）を足す（O-21）。`passives` のラベルを「良いパッシブ順」にし、比較を「ランクの合計（マスターにない ID は 0、負は引く）→ パッシブの数 → 図鑑」にする（O-24。ランクは web/data/passives.js の rank）。`place` を「ボックス順」にし、比較を「所持者 → 場所のグループ → box（page・row・column）→ 図鑑」にする（O-22）。
   - `sortOwned(pals, key, dir)`: 向きは最初の比較だけを反転し、**最後に必ず `compareText(a.id, b.id)`**（同じ入力なら同じ並び）。talent-target の `'talent-low'` は `('talent', 'asc')` に読み替える。
3. **行の部品**（views/owned.js。`ownedRow` を置き換え）:

   ```js
   /** 所持パルの 1 行。options: { notes, highlight, marks, actions }。 */
   export function ownedRowItem(pal, options) → { element, update(pal, options), destroy() }
   /** 互換のための薄い包み（理想個体のカード・テストで使う）。 */
   export const ownedRow = (pal, options) => ownedRowItem(pal, options).element;
   ```
   - 変わったセルだけ書き換える（`update` は同じ pal なら何もしない）。キーは `pal.id`。stable-render の `syncList(results, list, { key: (pal) => pal.id, create: (pal) => ownedRowItem(pal, …) })` で並べる。最初の 200 行と区切った追加・古い仕事の無効化は stable-render の仕組みに乗せる。（追記 2026-10-13: stable-render では `ownedRowItem` を views/owned.js の `ownedView` の中に置いた〔キーワードの語を使うため〕。export にするときは、今の「先頭の 200 行だけすぐ書き換え、残りは区切って書き換える」〔`fillBudget`・`deferred`〕と「一致の理由だけ変わったら理由の行だけ入れ直す」〔`replaceNotes`〕を保つ。2,000 行でキーワードの入力が止まらないための仕組み。`fillOwnedRow`・`rowSignature` は export 済み。行の高さが固定になったら、ui/virtual-list.js の高さの測り直しを省いてよい）
   - **★（O-45）**: `span.owned-stars`（aria-label「パル濃縮 ★2」、0 なら「パル濃縮なし」）の中に塗りの `span`（★×n）と輪郭の `span`（☆×(4−n)）。色はトークン `--condense`（ライト・ダークの両方で見やすい青。ゲームの青い星に寄せる）。要素を増やさないため SVG にはしない。
   - **Lv**: タマゴは「—」（タマゴのバッジは残る）。
   - **パッシブ（F066・O-25）**: 行の中だけランクの高い順（同じランクは保存の順）に並べ、2×2 の固定の枠（2 段分の高さを常に確保）。5 個以上なら 3 個＋「+N」のボタン（`hint` の部品で残りのチップを板に出す。行内には広げない）。「パッシブなし」の文字は出さない（枠が空）。`highlight`（ideal-results）・`.is-wanted`・`.is-extra` はそのまま使う。
   - **キーワード一致の理由**: `.owned-hits`（1 行・ellipsis・title に全文）の中に、1 件ごとに `span.owned-hit`（中に `.owned-hit-name`・`.owned-hit-desc`）を横に並べる。
   - **個体値（F043・O-44）**: `.owned-talent` の中に `span.talent-cell` ×4（HP・攻・防・計）。各セルは数字だけ（ラベルは列見出しにある）で、背景のバーは `style.setProperty('--v', value)` と CSS の `linear-gradient`（計は `--v` に合計/3）。tabular-nums・右寄せ・最小 3ch。`highlight.targets` があれば `--t` で目標の縦線、`.met`／`.short`＋差（ideal-results の形をここに移す）。`.owned-talent` の aria-label「個体値 HP 70・攻撃 100・防御 64・合計 234」。列の幅は所持パル・理想個体とも同じ値（例 184px）にし、app.css:1065 の 190px の特例をなくす。
   - **所持者・場所（O-10・V-10）**: 拠点の個体（`holder === placeLabel`）は `strong` に拠点の名前、`small` に「Alice が預けた」（場所の行を出さない）。パルボックスは `strong` に所持者、`small` に `P${page} · ${row}-${column}` ＋ 6×5 の小さな図（`span.box-map` 1 つ。CSS の背景で 6×5 の格子を描き、子の `span` 1 つを `--r`・`--c` で該当の枠に置く。title に placeLabel の全文）。box がなければ今の placeLabel の文字。
   - **印（O-52）**: `marks`（ideal-farms で足した口）に、目標の印を足す。印は core/ideal-goals.js に足す純粋な関数で作る:

     ```js
     /** 登録した目標から、個体ごとの印（「完成品: 目標名」「目標名 の欲しいパッシブ」）。種族ごとにまとめてから判定する。 */
     export function goalMarks(goals, pals) → Map<palId /* 個体 id */, string[]>
     ```
     完成品は `goalMatches`、欲しいパッシブは「同じ種族で、目標のパッシブを 1 つ以上持つ（完成品でない）」。データか目標が変わったときに 1 回だけ作る（`context.ideals.subscribe` と所持パルの更新）。状態の行に「目標の印」のチェック（既定オン。目標が 0 件なら隠す）。キーワードでも印の文字で探せるよう、`filterOwned` に `extraTexts: Map<個体 id, string[]>` を渡して `matchesKeywords` で一緒に見る（keywordCache は個体の固定の文字だけなので、印はそこに入れない）。
   - **行の操作（F063・O-38）**: `actions: true`（所持パルの画面だけ。理想個体のカード・タマゴ・人間〈known が false〉では出さない）。2,000 行ぶんを最初から作らないよう、`.owned-list` に 1 つだけ `pointerover`・`focusin` のリスナーを付け、初めて触れた行にだけ操作の `div.owned-row-actions`（行の右端に absolute で重ねる。`.owned-row` は `position: relative`）を足す: 「目標に」＝ `buildHash('ideal', { to: palId, p: 正のパッシブ })`、「ここから継承ルート」＝ `buildHash('route', { from: palId, p: 正のパッシブ })`、「親1 にして配合を探す」＝ `buildHash('search', { p1: palId })`（フェーズ 2 の find-merge で行き先が変わるので、リンクを作る関数を 1 か所にまとめておく）。アイコンは web/js/ui/nav-icons.js の絵を使い、title と aria-label を付ける。
4. **列見出し**（F069）: `.owned-list` の直前に `div.owned-list-head`（行の入れ物とは別。syncList に混ぜない）。`position: sticky; top: calc(var(--header-h) + var(--panel-h)); z-index: var(--z-sticky);`、`content-visibility` は付けない。列の幅は CSS 変数 `--owned-cols` で行と共有する（`.owned-row, .owned-list-head { grid-template-columns: var(--owned-cols); }`）。
   - 見出しのボタン: パル（図鑑）／Lv（レベル）・★（パル濃縮）／パッシブ（良いパッシブ）／HP・攻・防・計（個体値）／所持者・場所（ボックス順）。押すとその並べ替え、もう一度押すと向きが反転。並べ替えの select（owned-toolbar の 1 段目）と同期する。
   - 支援技術向け: `aria-sort` は表（table・grid）の列見出し（columnheader）にしか使えず、この一覧は表の役割を持たない（行は article）。そこで見出しは `div[role=toolbar][aria-label=並べ替え]` の中の `button[aria-pressed]` にし、aria-label を「HP の個体値で並べ替え（高い順）」のように向きまで書く。（一覧全体を `role=table`／`row`／`cell` にする方法もあるが、行の中のリンクと操作が多く、読み上げが重くなるので採らない。）
5. **行の高さ**（O-30）: 行の中身を固定の高さにそろえる（パッシブ 2 段・場所 2 行・キーワードの理由 1 行・バッジ 1 行）。実際の高さを測り、`contain-intrinsic-size: auto <その値>px` にする（app.css:933。sticky の列見出しには付けない）。
6. **継承ルートの開始の個体の一覧**（web/js/views/route.js:20-31 の `carrierList`）にも★の 4 枠を出すのは、フェーズ 2 の route-cleanup で `ownedRow` に置き換えるときに行う（ここでは触らない）。
7. **要素の数の予算**: 1 行の要素は 35 個以下（今は約 30）。6×5 の図を `rect` 30 個の SVG で描くと 2,000 行で 6 万要素になり、所持パルの画面の予算（80,000 ノード）を超えるので、図は要素 2 つにする。行の操作は触れた行にだけ作る。

### 触るファイル
- 新規: `test/perf/owned.perf.js`（2,000 行・20,000 行・偏った種族の分布での絞り込み・並べ替え・行の部品の生成）
- 変更: `web/js/views/owned.js`（:17-69・:210-224 と見出し）、`web/js/core/owned.js`（:41-46 の隣・:163-199・:297-350・:499-515）、`web/js/core/ideal-goals.js`（`goalMarks`）、`web/js/views/ideal.js`（`ownedRow` の呼び方。中身はそのまま）、`web/css/app.css`（:920-956・:1065）、`web/js/release-notes.js`

### テスト
- **追加** `test/core/owned.test.js`: (1) `box` がセーブ（slotIndex 0 → 1・1・1）と共有（placeLabel から）で同じになる。`parseBoxLabel` と :158 の書式の往復。(2) HP・攻撃・防御の並べ替え、良いパッシブ順（負のパッシブを引く）、ボックス順、向きの反転、同じ値なら id の順。(3) `'talent-low'` の読み替え。
- **追加** `test/core/ideal-goals.test.js`: `goalMarks`（完成品・欲しいパッシブ・タマゴは数えない）。
- **追加**（owned-view.test.js）: (1) 列見出しの「HP」を押すと HP の高い順、もう一度で低い順、select も同期。(2) ★の aria-label「パル濃縮 ★2」。(3) 5 個以上のパッシブで「+N」が出て、押すと残りが出る。(4) 拠点の個体の場所の行が 1 つになる。(5) パルボックスが「P2 · 1-2」と図。(6) 行にフォーカスすると操作が出て、リンクの href に正のパッシブだけが入る。タマゴの行には出ない。(7) 目標の印が出て、キーワード「完成品」で探せる。(8) データの更新で同じ個体の行の要素が使い回される（syncList）。
- **期待値が変わる既存のテスト**（別プラン §9 の C）:
  - `test/web/owned-view.test.js:68`（/Alice.*パルボックス 2 ページ・1 行 2 列/）→「P2 · 1-2」と title、`:69`（/★★/）→ aria-label、`:70`（/孵化前/）→「—」とタマゴのバッジ。
  - `:142-171`（キーワード一致の理由）: `.owned-hit` と `.owned-hit-name`・`.owned-hit-desc` は残るので、件数と文字の確かめ方はそのまま通るはず。1 行の入れ物 `.owned-hits` を足したことだけ確かめる。
  - `test/web/ideal-view.test.js:59`（`talentsOf` が textContent）・`:97`・`:106`・`:312-321` → `.owned-talent` の aria-label で比べる形に。
  - `test/core/owned.test.js:103`（`sortOwned(owned.pals, 'passives')` の先頭）→ 良いパッシブ順の期待値に。

### INV-2・互換・セキュリティ・性能の注意
- 印は登録した目標とセーブの情報だけ（配合の計算・配合表は使わない）。`goalMarks` は core/ideal-goals.js（core/ideal.js ではない）。
- 共有のデータの形（OWNED_FIELDS・placeLabel の書式）は変えない。古い共有で placeLabel の書式が違えば box は null で、文字だけを出す。CSV の列名（core/owned.js:376 の「最後の持ち主」）は変えない。
- 図・★・バーは要素と CSS 変数（`style.setProperty`）で描き、style 属性の文字列や innerHTML は使わない。
- **性能の予算**（共通の受け入れ条件）: 2,000 行で最初の 200 行が 100ms 以内・全行が 1 秒以内、所持パルの画面の DOM は 80,000 ノード以下、JS ヒープの増加は 150MB 以下。予算を超えたらこのテーマを終えずに直す。2,000 行を超えたら見えている範囲だけ描く形（stable-render）に切り替わること、20,000 行・偏った種族の分布でも入力が 100ms 以上止まらないことも確かめる（`npm run test:perf` は今 test/perf/ideal.perf.js と route.perf.js だけなので、所持パルの絞り込み・並べ替えの `test/perf/owned.perf.js`〈2,000 行・20,000 行・偏った種族の分布〉を新しく足す）。

### release-notes の案
- id: `<実装日>-owned-rows`
- title: 「所持パルの列見出しで並べ替え」（14 字）
- body: 「列見出しを押すと並べ替えます。個体値は数字とバー、★は 4 枠、場所はボックスの位置の図で出します。」（50 字）

### 完了の条件
- [x] `npm test` と `npm run test:perf` が通る。（2026-10-13: npm test exit 0・1,353 件。test:perf は 2 回とも通過〔共有の所持パル 20,000 行の整え直しと変換 199.46 / 194.83 ms・予算 200。PC の負荷で揺れ、変える前のコードでも同じ条件で 163〜220ms。変換だけを前後で交互に 12 回ずつ測ると中央値 88.5 → 88.1ms で差はない〕。計測の記録）
- [x] 129 行の一覧で scrollHeight を 4 回測って同じ値になる（基準: 10011／10001／9574／9757）。（2026-10-13: 開いた直後・全部の行を出した後・HP で並べ替えた後・図鑑番号順に戻した後とも 10,762px。開いたまま 65 秒〔20 秒ごとの読み直しを 3 回〕5 秒ごとに測っても 10,762px）
- [x] 列見出しがパネルの下に貼り付き、押すと並べ替わる（View Transition は並べ替えのときだけ。動きを減らす設定では使わない）。（2026-10-13: scrollY 5000 で列見出しの top 228.38〔パネルの下端 228.39〕・いちばん上に見える。「HP」を座標で押すと HP の高い順〔並べ替えの選択も hp〕、もう一度で低い順。一覧の先頭が隠れていたので O-05 で一覧の先頭が列見出しの下端〔268〕に来る。動きは並べ替えのときだけ `withTransition`〔動きを減らす設定では付けない〕）
- [x] 2,000 行の注入データで、最初の 200 行が 100ms 以内・全行が 1 秒以内に出て、`document.getElementsByTagName('*').length` が 80,000 以下、ヒープの増加が 150MB 以下。（2026-10-13: 配合検索から開いて 3 回、最初の 200 行 31〜39ms・全行 520〜649ms・57,500 ノード・ヒープの増加 2.7〜2.8MB。開く間の Long Task は 62〜83ms）
- [x] 2,000 行の注入データで、キーワードの入力が 100ms 以上止まらない（Long Task。PerformanceObserver の longtask で測ってよい）（D24 で owned-toolbar から移した）。（2026-10-13: 「アヌビス」「ぽち」を 220ms 間隔で 1 字ずつ・幅 1100／1280px で 3 回とも、50ms を超える Long Task なし〔同じ条件の main は 155・158ms〕。ただし playwright-cli の前のコマンドで作った行のまま測ると〔ツールのスナップショットでアクセシビリティのツリーができている状態〕、行をたくさん外す「ぽ」で 88〜115ms が出る。「実装の記録」12・計測の記録）
- [x] パッシブ 5 個以上・拠点の個体・タマゴ・人間の行も、ほかの行と同じ高さ。（2026-10-13: 129 行と、パッシブ 6 個のアヌビスを足した 130 行で、どの行も 80px）
- [x] 行の操作から理想個体・継承ルート・配合検索へ、パッシブを選び直さずに進める。（2026-10-13: 行にポインターを乗せると操作が出て〔opacity 1〕、「目標に（理想個体）」を押すと `#/ideal?to=SheepBall&p=PAL_sadist,Nocturnal,Witch`〔引きこもり −1 は渡さない〕。パルの名前のリンクから Tab で「目標に」へ届き、操作が見える）
- [x] 理想個体の組のカードでも、4 セルと強調（✓・差）が崩れない。（2026-10-13: アヌビス＋伝説・個体値 100 の組で、4 セルに小さな見出し〔HP・攻・防・計〕、目標以上は太字、未満は値の下に差〔「70−30」〕と目標の縦線、欲しいパッシブに ✓。行は 80px、個体値の列は 184px）
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 印は登録した目標とセーブの情報だけで、`goalMarks` は `core/ideal-goals.js` に置く（`test/import.test.js`）。互換 — 共有の形（OWNED_FIELDS・placeLabel の書式）と CSV の列名を変えていない。古い共有で box が null でも文字で出る。セキュリティ — 図・★・バーは要素と `style.setProperty`（`test/static/security.test.js`）。性能 — 上の 2,000 行の確認に加え、20,000 行・偏った種族の分布で入力が 100ms 以上止まらない（`test/perf/owned.perf.js` とブラウザ）。（2026-10-13: INV-2 — `goalMarks` は core/ideal-goals.js で、目標とセーブの情報だけ〔test/import.test.js〕。互換 — OWNED_FIELDS・placeLabel の書式・CSV の列名は変えていない、位置のない古い共有の「パルボックス」は box が null で文字だけ〔core のテスト〕、前の並べ替えの値 talent-low は読み替える〔viewState・URL のテスト〕。セキュリティ — ★・図・バーは要素と `style.setProperty`・CSS の attr()〔security.test.js〕。性能 — 20,000 行は見えている範囲だけ描き、開いて 71〜82ms・886 ノード・ヒープの増加 0.3MB、入力の Long Task は最大 76ms。test/perf/owned.perf.js に並べ替え〔20,000 行で最大 28〜37ms〕・目標の印〔目標 100 件で 33〜39ms〕・行の部品〔1 行 33 要素〕を足した）

### TODO
- [x] 正規化に `box` を足し、`parseBoxLabel` を作ってテストで書式と結び付ける
- [x] `OWNED_SORTS` に向きと HP・攻撃・防御を足し、良いパッシブ順・ボックス順・id の決め手を入れる
- [x] `ownedRowItem`（`{ element, update, destroy }`）を作り、`ownedRow` を包みにする
- [x] ★の 4 枠・タマゴの「—」・パッシブの 2×2 と「+N」・キーワードの理由の 1 行を作る
- [x] 個体値の 4 セルとバー（CSS 変数）を作り、理想個体の強調を移し、190px の特例を消す
- [x] 所持者・場所の表示（拠点の重なりをなくす・P2 · 1-2・6×5 の図）を作る
- [x] `goalMarks` と目標の印（表示の切り替え・キーワードで探せる）を作る
- [x] 行の操作を、触れた行にだけ作る形で足す
- [x] 列見出し（別の入れ物・`--owned-cols`・押すと並べ替え・select と同期）を作る
- [x] syncList と区切った描画に乗せ、行の推定の高さを実際の高さに合わせる
- [x] owned-view・ideal-view・owned のテストを直し・足す
- [x] 2,000 行・20,000 行で予算を測り、超えたら直す
- [x] release-notes に 1 件足す

### 実装の記録（2026-10-13、ブランチ `feature/owned-rows`）

実装のときに決めたこと・文書と違う形にしたこと（後のフェーズ 1d の visual-parts・cleanup-dead-code、フェーズ 2 の find-merge・route-cleanup、フェーズ 3 の owned-detail・farm-board・goals-detail はこちらを正とする）。

1. **パルボックスの位置 box（手順 1）**: `normalizeOwned` の個体に `box: { page, row, column } | null`（パルボックスで位置が分かるときだけ。どれも 1 始まり）。書式は core/owned.js の **`palboxLabel({ page, row, column })`**（「パルボックス 2 ページ・1 行 2 列」。placeLabel に入り、共有の列にもそのまま載る）に寄せ、読み取りは **`parseBoxLabel(label) → { page, row, column } | null`**（`palboxPosition` の隣。ページ 1〜9999・行 1〜5・列 1〜6 の外や、書式の違う文字は null）。`ownedFromShared` は place が palbox の行だけ placeLabel から読む。テストで書式と読み取りの往復・セーブと共有で同じ box・古い共有（「パルボックス」）は null を確かめた。共有の列（OWNED_FIELDS）・CSV の列名は変えていない。
2. **並べ替え（手順 2）**: `OWNED_SORTS` は **`[キー, 既定の向きの名前, 既定の向き, 反対の向きの名前]`**（文書の 3 つに、反対の向きの名前を足した）。キーは dex・passives（良いパッシブ順＝ランクの合計。マスターにない ID は 0）・level・stars・talent・hp・shot・defense・place（ボックス順＝所持者 → 場所のグループ → box〔位置の分からない個体はその後〕→ 図鑑）。`sortOwned(pals, key, dir)` は最初の比較だけを反転し（place は「所持者 → 場所 → 位置」をまとめて 1 つの比較として反転）、最後は必ず個体 ID の順。**`sortKey(value, dir) → { key, dir }`**（前の値 `talent-low` は talent・asc、知らないキーは dex、知らない向きはそのキーの既定）と **`sortLabel(key, dir)`** を export。
   - 画面の状態は `filter.sort`（キー）と **`filter.dir`**（'asc' | 'desc'）。`OWNED_MEMORY` に `dir` を足し、`sort` は前の値 talent-low も受けて `migrateFilter` が読み替える。URL は `sort`（既定〔図鑑・昇順〕でなければ）と **`dir`**（そのキーの既定の向きでなければ）。前のリンクの `sort=talent-low` も読む。
   - 状態の行の並べ替えの選択は、値が「キー」か「キー:向き」（`sortValue`）。選択肢は OWNED_SORTS の既定の向き 9 つと、talent-target で足した「個体値の合計が低い順」（`talent:asc`。X-30。高い順の次）。**列見出しで選んだ反対の向き（「HP の個体値が低い順」など）は、選んでいる間だけそのキーの次に足す**（文書は選択と見出しの同期だけで、選択に向きをどう出すかは決めていなかった。選択肢を倍にしないため）。選択肢の入れ替えは views/shared.js の `syncOptions`（選んでいる途中は離れてから）。
3. **列見出し（手順 4）**: `div.owned-list-head[role=toolbar][aria-label=並べ替え]` を `.owned-list` の前に置く（syncList の行には混ぜない）。中は `button.owned-head-button[data-value=キー][aria-pressed]`（`span.owned-head-text`＋向きの `span.owned-head-arrow`〔▼ 降順・▲ 昇順。押しているものだけ〕）で、Lv・★ は `div.owned-head-level`、HP・攻・防・計は `div.owned-head-talent`（行の 4 セルと同じ grid）にまとめる。aria-label・title は「HP の個体値で並べ替え（高い順）」（押していない見出しは、押したときの既定の向き）。**押している見出しだけが Tab で止まり（tabIndex 0）、←→・Home・End で見出しの間を移る**（toolbar の決まり）。押すと同じキーなら向きを反対に、違うキーならそのキーの既定の向きで `applySort()`（選択と見出しをそろえ、2,000 行以下なら `withTransition`、O-05）。行が 0 のとき・データがないときは hidden。sticky の `top: calc(var(--header-h) + var(--panel-h))`・`z-index: var(--z-sticky)`、高さは `.owned-view` の **`--owned-head-h: 32px`**。
   - O-05（owned-toolbar の申し送り）: **一覧の先頭は列見出しの下端に合わせる**。`.owned-list`・`.owned-row` の `scroll-margin-top: calc(var(--panel-h) + var(--owned-head-h))`、views/owned.js の **`fixedBottom()`**（パネルの下端＋列見出しの高さ）を、条件を変えたときの「一覧の先頭が隠れているか」・自動の更新で見ていた行を戻す基準（`anchorOf`）・見えている範囲だけ描く一覧の `topOffset` に使う（前の `panelBottom` を置き換えた）。
4. **列の幅 `--owned-cols`（手順 4・5）**: `:root` の **`--owned-cols: minmax(170px, 1.3fr) 72px minmax(0, 2fr) 184px minmax(0, 1fr)`**（[パル][Lv・★][パッシブ][個体値 4 セル][所持者・場所]）を行と列見出しが使う。理想個体の組の行も同じ値（190px の特例は消した）。**幅 1000px 以下は `minmax(150px, 1.2fr) 56px minmax(0, 2fr) 152px minmax(0, 1fr)` と間 10px に詰める**（幅 920px でパッシブの欄が約 165 → 221px。README 3-6 で回ってきた X-02 の一部。文書の X-02 の直しの「主の欄 980px 未満で場所を名前の下へ」は、1100px の本文〔941px〕でもいつも当たって列見出しの形と合わないので採らず、@media で列の幅だけを詰めた。container query は先祖の固定配置の基準を変えるので使っていない。右のドロワー〔D3〕は本文に重ねるので、本文の幅は窓で決まる）。
5. **行の部品（手順 3）**: views/owned.js の **`ownedRowItem(pal, options) → { element, pal, update(pal, options) → boolean, showActions() → boolean, destroy() }`**（export）と **`ownedRow(pal, options) = ownedRowItem(pal, options).element`**。options は `{ notes, highlight, marks, actions, hints }`（`hints` を足した: 「+N」の説明の部品を入れる配列。理想個体のカードは `pairCard` の hints を渡し、カードを作り直すときに destroy される。省くと行が持ち、行の destroy で消す）。`update` はセルごとの署名を比べて**変わったセルだけ**中身を入れ直す（pal・Lv・パッシブ・一致の理由・個体値・所持者と場所・行の操作）。前の `fillOwnedRow`・`replaceNotes`・`talentCell`・`passiveCell` はなくした（呼ぶ所がなくなった）。
   - 一覧の中では `ownedView` の **`listRow`** が ownedRowItem を包み、区切った書き換えに乗せる。**すぐ書き換える既にある行は先頭から 200 行 → 60 行（`FILL_NOW`）**にし、残りは区切って書き換える（区切る行は、一致の理由・印を求めるのも書き換えるときにする）。作ったばかりの行はいつもすぐ中身を入れる。stable-render の「実装の記録」9 の「200 行まで」はこの値に変わった（2,000 行でキーワードを打つたびに 200 行の理由を書き換えると止まったため。窓に入る行は約 10 行）。
   - **`rowSignature(pal, notes = [], marks = [])`**（export。3 つ目に印を足した。ideal-farms の申し送り）。行に出す値の部分は個体のデータごとに 1 回だけ作って覚える（WeakMap。box も入れた）。
   - DOM: `article.owned-row` の子は `div.owned-pal`（palTile か人間の `span.pal-tile.owned-unknown`、バッジがあれば `span.owned-badges`〔1 行・入り切らない分は隠し title に全部〕）・`div.owned-level`（「Lv 12」の文字〔タマゴは「—」〕と `span.owned-stars`）・`div.owned-passives`（チップと「+N」・`p.owned-hits`）・`div.owned-talent[role=img]`（`span.talent-cell[data-key]` ×4）・`div.owned-where`（`strong`＋`small`）、触れた後は `div.owned-row-actions`。
6. **★・タマゴ・パッシブ・一致の理由（手順 3）**: ★は **`span.owned-stars[role=img][data-off]` の 1 要素**（塗りの ★ は文字、輪郭の ☆ は CSS の `::after { content: attr(data-off) }`。aria-label「パル濃縮 ★2」／「パル濃縮なし」）。文書の「塗りの span と輪郭の span」から 1 要素にしたのは、2,000 行の要素の数を減らすため。色はトークン **`--condense`**（ライト #2b67c9・ダーク #8db7ff）、☆ は outline の色。パッシブは**セル `div.owned-passives` そのものを 2 列 × 2 段（24px）の grid** にし（前の `span.passive-list` の入れ物をなくした）、チップは行の中だけ小さく（高さ 24px・12px・長い名前は省略、全文は今までどおり title）。5 個以上は 3 個と `button.passive-more`「+N」（aria-label「ほかのパッシブ N 個」・title に名前。押すと `ui/hint.js` の板に残りのチップ）。一致の理由は `p.owned-hits`（grid の 3 段目・1 行・省略・title に「アクティブスキル：名前（説明）」を改行でつないだ全文）の中に `span.owned-hit`（`.owned-hit-name`・`.owned-hit-desc`）を横に並べる。
7. **個体値の 4 セル（手順 3・D23）**: `span.talent-cell[data-key=hp|shot|defense|total]` に数字だけ（計は合計）、`--v` に値（計は合計の 1/3 を丸めたもの）、CSS の 2 枚の linear-gradient で下に 3px のバーと地。目標があるセルは `.has-target` と `--t`（目標の縦の目印）、目標以上は `.met`、未満は `.short` と `span.talent-diff`「−N」を**値の下**に（D23）。**読み上げは欄 `div.owned-talent[role=img]` の aria-label にまとめる**（「個体値 HP 70・攻撃 100・防御 64・合計 234」、目標があれば「HP 70（目標 100 まで あと 30）」）。セルは aria-label を持たない（ideal-results ではセルが role=img だった）。**理想個体の組のカードは列見出しがないので、CSS の `::before` で各セルの上に小さな見出し（HP・攻・防・計）を出す**（文書は決めていなかった）。テストの `talentsOf`（ideal-view.test.js）は aria-label を読み、注を縮めて比べる形にした（ideal-results の申し送り）。
8. **所持者・場所（手順 3）**: 拠点の個体（`place === 'base'` で holder と placeLabel が同じ）は `strong` に拠点の名前、`small` に「Alice が預けた」（預けた人がいなければ 1 行）。パルボックスで box があれば `strong` に所持者、`small.owned-box` に「P2 · 1-2」と **`span.box-map`（要素 1 つ。`--r`・`--c` を図に書き、6×5 の枠は背景の線、位置の印は `::after`）**、欄の title に placeLabel の全文。box がなければ今までの placeLabel の文字。
9. **行の操作（手順 3。F063・O-38）**: リンクを作るのは **`ownedRowLinks(pal) → [{ key, icon, label, href }]`**（export。目標に〔`buildHash('ideal', { to, p: 正のランクのパッシブ })`〕・ここから継承ルート〔`buildHash('route', { from, p })`〕・親1 にして配合を探す〔`buildHash('search', { p1 })`〕。**フェーズ 2 の find-merge で行き先を変えるときはここだけを直す**）。`.owned-list` の `pointerover`・`focusin` で、触れた行の `showActions()` が `div.owned-row-actions` に 3 つの `a.owned-row-action`（ui/nav-icons.js の `navIcon` の絵・aria-label と title が文）を作る（パルのマスターにない人間・タマゴ・理想個体のカードの行では作らない）。行の右端の中ほどに重ね、ポインターが乗っている・フォーカスが中にあるときだけ見せる。パルの名前のリンクから Tab で届く。
10. **目標の印（手順 3。O-52）**: core/ideal-goals.js の **`goalMarks(goals, pals) → Map<個体 id, string[]>`**（種族ごとにまとめてから目標ごとにその種族だけを見る。完成品は「完成品: 目標名」、完成品でなく目標の欲しいパッシブを 1 つ以上持つ個体は「目標名の欲しいパッシブ」〔英数字で終わる名前の後だけ空ける。views/ideal.js の joinName と同じ〕、タマゴは数えない、並びは目標の順）。所持パルの画面は、データか目標の中身（`goalsKey`: id・名前・種族・パッシブ・条件・個体値）が変わったときだけ作り直し、`ideals.subscribe` では目標の中身が変わったときだけ描き直す（完成の判定の書き直しでは描かない）。**表示の切り替えは状態の行の `label.owned-marks-toggle`「目標の印」**（既定オン。viewState の `showMarks` に覚え、`OWNED_MEMORY` には入れない〔表示の好みで条件ではない。読み込み直すとオン〕。目標がない・`context.ideals` がないときは隠す）。印を出しているときだけ、`filterOwned` の **`extraTexts`**（個体 id → 文字の配列。`matchesKeywords(pal, terms, extra)`）で印の文字もキーワードで探す（keywordCache には入れない）。印は名前の下の `span.owned-badge.badge-mark`。
11. **行の高さ（手順 5）**: **行は 80px に固定**（`--owned-row-h`・views/owned.js の `ROW_ESTIMATE`、`contain-intrinsic-size: auto var(--owned-row-h)`、`contain: strict`）。中身はパッシブ 2 段＋**キーワードの理由の 1 行をいつも取り**（文書のとおり。はじめはキーワードがあるときだけ一覧に `has-query` を付けて 66 → 84px にしたが、1 字目と消したときに全部の行の高さとスタイルが変わって 2,000 行で 50〜60ms かかったのでやめた）、セルは上にそろえる。129 行で 10,762px。理想個体の組の行も同じ高さ。一覧の入れ物 `.owned-list` と `.virtual-rows` は grid ではなく block にした（行がそれぞれ grid）。
12. **2,000 行でキーワードの入力が止まらないようにしたこと（D24。owned-toolbar の計測の記録の続き）**:
    - **主な原因は先祖に付けた `:has()`** だった（Chrome の trace の SelectorStats・invalidationTracking で確かめた）。とくに `body:has(.update-banner:not([hidden])) .toast-region` は、行を出し入れするたびに body から下の約 3,000 要素のスタイルを計算し直させ（区切って足すフレームごとに 15〜23ms）、その :has() の確かめにページ全体（約 5 万要素）をたどって 1 回 約 4ms かかっていた。`#app:has(.navigation[hidden])`・`.owned-list:has(> .empty-state:only-child)` も、行の出し入れのたびに :has() の確かめ直しをさせていた。→ html の `.has-update-banner`（ui/update-banner.js）・`#app.is-login`（app.js）・`.owned-list.is-empty`（views/owned.js）のクラスに置き換えた（前の 2 つは別のコミット）。置き換えた後は、1 字打ったときにスタイルを計算し直す要素は数個〜約 200。**後のテーマで、先祖（body・#app・一覧の入れ物）に `:has()` を足さない**（子の数が多い入れ物の `:has(> …)` も同じ）。
    - すぐ書き換える既にある行を 60 行に（上の 5）、行の署名を個体ごとに覚えた（上の 5）。
    - 試してやめたこと: 外す行の多いときに `replaceChildren` でまとめて入れ替える（一度画面に出た行では 1 行ずつ外すより遅かった）、外す行を `content-visibility: hidden` で隠して後で区切って外す（隠すためのスタイルの計算が外すのと同じくらい重かった）。syncList は変えていない。
    - **計測の注意（後のテーマも同じ）**: playwright-cli は各コマンドの終わりにページのスナップショット（アクセシビリティのツリー）を取り、その後は DOM の出し入れが 3〜5 倍重くなる（前のコマンドで作った 2,000 行から 1,950 行を外すと 92〜158ms、同じコマンドの中で作った行なら 17〜27ms）。owned-toolbar の記録の 81〜120ms・main の 126〜157ms もこの状態の値。支援技術を使っていない利用者と同じ条件にするには、**同じ run-code の中で画面を開き直して行を作ってから測る**（`shots/owned/owned-rows/longtask3.js`）。この形では 2,000 行の入力の Long Task は出ない（main は 155〜158ms）。前のコマンドで作った行のままだと、行をたくさん外す「ぽ」で 88〜115ms が出る（スクリーンリーダーなどでアクセシビリティのツリーがあるときに近い）。
13. **要素の数（手順 7）**: 1 行の要素はパッシブ 4 個・バッジなしで 33（`test/perf/owned.perf.js` が 35 以下を確かめる）、バッジがあると 1 つにつき +1（入れ物 +1）、触れた行の操作は +15。2,000 行で 57,500 ノード（ブラウザ）。
14. **テスト**: test/core/owned.test.js に 4 件（並べ替えの読み替え・HP／攻撃／防御・良いパッシブ順と向き・同じ値の ID の順、ボックス順、box と parseBoxLabel の往復と古い共有）と extraTexts、test/core/ideal-goals.test.js に goalMarks、owned-view.test.js に 4 件（列見出し〔toolbar・押す・向き・選択との同期・←→・URL の sort／dir・talent-low〕、固定の枠〔「+N」と板・拠点の 1 行・パッシブなし・閉じると板も閉じる〕、行の操作〔触れた行だけ・正のパッシブ・タマゴと人間に出ない〕、目標の印〔印・キーワード・切り替え・目標を外す・行の使い回し〕）を足し、どれも変える前のコード（web/ を `git stash`）で落ちることを確かめた。期待値を直したもの: パッシブの並び（ランクの高い順）・場所の「P2 · 1-2」と title・★の aria-label と data-off・タマゴの「—」・4 セルと aria-label（owned-view・ideal-view の talentsOf・highlight のテスト）・行の要素の使い回し（セルの中身だけ入れ直す）・HP の絞り込みの確かめ方・パネルの後の子の並び（列見出し）・migrateFilter の dir・O-05（固定の部分の下端）・すぐ書き換える行（200 → 60）・孵化した個体の場所。test/perf/owned.perf.js に 3 件（2,000・20,000 行の 18 通りの並べ替え、目標 100 件の印と印のキーワード、行の部品の生成と要素の数）。app.test.js・version.test.js に `.is-login`・`.has-update-banner` の付け外し。テストの偽 DOM（test/helpers/dom.js）は変えていない。
15. **そのほか**: docs/OPERATIONS.md の所持パルの表示（行・列見出し・行の操作・目標の印・位置の書式・URL の dir）と理想個体の組の行を新しい画面に合わせた（触るファイルの一覧にはなかった）。release-notes は文書の案のまま（id `2026-10-13-owned-rows`）。web/js/views/route.js の `carrierList`（継承ルートの開始の個体の一覧）は手順 6 のとおり触っていない（場所は全文の placeLabel のまま）。
16. **後のテーマへの申し送り**:
    - visual-parts（1d）: ★の色 `--condense`、個体値のバー `--talent-bar`・`--talent-track`、行の中の小さなチップ（`.owned-passives .passive-chip`）、行の操作の絵（`navIcon` を流用）、6×5 の図（`.box-map`）。目標の印は `badge-mark`（牧場で使用中と同じ色）。
    - cleanup-dead-code（1d）: 行の `.talent-sep`・`.owned-passives .passive-list`・前の `.owned-hit`（段落）の CSS は消した。`fillOwnedRow` はなくした。
    - find-merge（2）: 行の操作の「親1 にして配合を探す」は `ownedRowLinks` の search を新しい行き先に。
    - route-cleanup（2）: 開始の個体の一覧を `ownedRow` にするときは、`ownedRowItem` の options（actions は出さない）と、行の高さ 80px・`--owned-cols` を使う。
    - owned-detail（3）: 行の操作に「詳細」を足すなら `ownedRowLinks` と `showActions`（触れた行にだけ作る）に足す。一致の理由の全文は今は title。
    - farm-board（3）: 牧場の親の印（O-51）は `marks` で渡し、`rowSignature` の 3 つ目にも入れる（一覧の `rowOptionsOf` に足す）。
    - goals-detail（3）: 目標と個体の対応は `goalMarks` と同じく種族ごとにまとめてから見る。目標の中身の比べ方は views/owned.js の `goalsKey`。
    - 計測: 上の 12 の「計測の注意」。2,000 行の画面の計測は `longtask3.js`・`perf-open.js`（同じコマンドの中で行を作る）。
17. **フェーズ 1b・1c の終わりのレビューの直し（2026-10-13、ブランチ `fix/phase-1bc-review-owned`。指摘 B1・B2・B5・B11・B12・B13 の「+N」。パネルの分は owned-toolbar の記録 17）**:
    - **B1 目標の印の計算（core/ideal-goals.js）**: 前の `goalMarks` は目標ごとにその種族の全個体を `goalMatches` で見て、個体ごとに Set を作っていたので、同じ種族の目標 100 件 × 同じ種族の 20,000 行で 1〜2.6 秒止まった（目標を 100 種族に散らした前の性能テストでは出なかった）。→ **種族ごとに「欲しいパッシブ → 目標の番号」の表を作り、個体ごとに 1 回、その種族の目標を並びの順に見る**（欲しいパッシブのある目標は、個体のパッシブから引いて 1 つ以上持つ目標だけを確かめる。印の配列は個体ごとに 1 回で作る）。返す形（`Map<個体 id, string[]>`）・印の文・並びは前と同じ（乱数で前後を 300 回突き合わせた）。**`goalMatches` も目標ごとに判定（`goalTest`）を 1 回だけ組み立て、個体ごとに Set を作らない**（「だけ」のパッシブの種類の数は `distinctCount`。完成の判定〔web/js/ideals.js〕も速くなる）。core/owned.js の `matchesKeywords` は足す文字（印）を、個体の文字で見つからなかった語のときだけ 1 つずつ `normalizedText` でそろえて見る（前は入力のたびに個体ごとに配列を作っていた。印の文字列を配列ごとにつないで覚える形も試したが、1 回目の入力が遅くなり 2 回目以降も速くならなかったのでやめた）。
      - 性能テスト（test/perf/owned.perf.js に 1 件）: 同じ種族（モコロン）の 20,000 行・同じ種族の目標 100 件（半分は欲しいパッシブなし・HP 30〜79 以上、半分は欲しいパッシブ 2 つ・4 件に 1 件は「だけ」。parseGoals が同じ条件の目標を 1 つにまとめるので、条件はどれも違う）で、印 468,886 個の計算が **28〜39ms**（変える前は 1,181ms で落ちた）、印の文字を含むキーワード（1 回目の「完成品」・「目標1」・どこにも当たらない「ぬぬぬ」）が 17〜35ms（予算 100ms。`npm run test:perf` を 3 回）。**測り方**: この PC はほかのアプリで CPU が 56〜60% 使われていて値が 2〜4 倍に揺れるので、前後は**同じ node のプロセスの中で、変える前のモジュール（`git show fa4ce9e:…` を作業用の場所に取り出したもの）と今のものを交互に 3 回ずつ**測った（印: 前 1,067〜1,544ms・後 33〜61ms）。ブラウザ（20,000 行の注入データ・アヌビスの目標 100 件を storage イベントで入れる。`review-fix-owned/rows-20000.js`）では、目標を入れた直後の描き直しの Long Task が 前 829〜1,130ms → 後 62〜97ms、キーワード「アヌビス」「完成品」の入力は 50ms を超える Long Task が後 0〜1 回（51ms）。予算は変えていない。区切って計算する形（仕事の番号で古い計算を捨てる）は、同期で予算に入ったので入れていない。
    - **B2 行の印の数（利用者に見える形が変わる。ユーザーに確かめる）**: 行の中の印は **`MARK_SLOTS = 1` 個**と、残りがあれば `button.owned-badge.mark-more`「+N」（aria-label「+N（ほかの目標の印 N 個）」・title に残りの印・`data-focus="marks-more"`）。押すと `ui/hint.js` の板に**残りの印**を `div.mark-list` に並べる（板の中身は開いたときに作る）。バッジの行の title にはすべての印。はじめは指摘の例どおり 2 個にしたが、パルの列（1100px で約 170px）に印が 2 個入らず、どちらも「完成品: …」に縮んで読めなかった（画面で確かめた。撮影は 1 個の形で撮り直した `review-fix-owned/b2-marks-*.png`）ので 1 個にした。ニックネームと印は長いと縮めて省略し（`min-width: 2em`）、「+N」はいつも見える。キーワードで印を探すのは今までどおりすべての印（`filterOwned` の `extraTexts`。DOM と別）。2,000 行・アヌビスの目標 100 件で 62,009 ノード（前の形なら印だけで約 11 万）。
    - **B5 パルのセルの書き換え**: 前の `fillPalCell` を **`palCellTile(pal)`（名前のリンク）と `palCellBadges(pal, marks, hints)`（バッジの 1 行）**に分け、`ownedRowItem` の `update` は `tile`（種族・名前・人間のアイコン・性別）と `badges`（ニックネーム・タマゴ・ラッキー・アルファ・印）を別々に書き換える（印だけが変わっても名前のリンクを作り直さない）。さらに **`update` は書き換える前にフォーカスのある部品の `data-focus` を覚え、書き換えた後にフォーカスが落ちていれば同じ `data-focus` の部品へ戻す**。行の中の目印: 名前のリンク `pal`・パッシブの「+N」`passive-more`・印の「+N」`marks-more`・行の操作 `action-ideal`／`action-route`／`action-search`。行に `data-focus` が付いたので、syncList は**フォーカスのある行が消えたとき、次の行（無ければ前の行）の名前のリンクへ移す**（前は行に目印がなく、フォーカスが body に落ちていた。ui/dom.js の決まりどおり）。理想個体の組のカードの行にも同じ目印が付く（カードは syncList の行ではないので影響しない）。
    - **B11 パルボックスの場所の読み上げ**: 短い表記「P2 · 1-2」と図の `small.owned-box` を `aria-hidden`、その後ろに **`span.visually-hidden`**（app.css に足した共通の「見た目は隠して読み上げだけ」のクラス）で場所の全文「パルボックス 2 ページ・1 行 2 列」。画面の aria snapshot は「strong: Bob / text: パルボックス 2 ページ・5 行 2 列」。パルボックスの行の要素は +1（パッシブ 4 個・バッジなしで 35〔手持ちなどは 33 のまま〕。性能テストの 1 行 35 以下はぎりぎり。行に要素を足すテーマは、パルボックスの行で数える）、2,000 行で 58,752 ノード（前 57,500）。
    - **B12 行の操作の数**: `ownedRowItem` に **`hideActions(next = 今のフォーカス)`**（操作の入れ物を外す。next が操作の中なら外さずに false）を足した。一覧は `actionRows = { pointer, focus }` の 2 つだけに操作を付け、`pointerover`・`pointerleave`・`focusin`・`focusout`（一覧の外へ出たとき）で付け替え、どちらでもなくなった行から外す。前は触れた行に付いたまま増え続けた（1 行 +15 要素）。2,000 行で 30 行に順にポインターを乗せても 62,009 ノードのまま・操作 1 つ。
    - **B13 「+N」の名前**: パッシブの「+N」の aria-label を「+2（ほかのパッシブ 2 個）」にした（見えている「+2」を名前に入れる）。
    - テスト: owned-view.test.js に 3 件（印 1 個と「+N」・板・キーワード、印だけが変わったときのフォーカス、行の操作の 2 つまで）と、最初の一覧のテストに読み上げの確認を戻した。test/core/ideal-goals.test.js に「だけ」の重なったパッシブ。どれも変える前のコードで落ちる（「だけ」は前後で同じ結果の確認）。画面の確認のスクリプトと撮影は `Claude outputs/ui-audit-2026-10/shots/owned/review-fix-owned/`。
    - 後のテーマへ: visual-parts（1d）で印の色を変えるときは `.badge-mark, .mark-more` を一緒に。farm-board（3）の牧場の親の印も `marks` で渡すと 1 個と「+N」になる（理想個体の「別の配合牧場で使用中」は 1 個なので今は変わらない）。owned-detail（3）で行に部品を足すときは、フォーカスを戻す `data-focus` を付ける。
18. **フェーズ 1b・1c の終わりのレビューの直し（理想個体側。2026-10-13、ブランチ `fix/phase-1bc-review-ideal`。A9・A12 の所持パルの分）**:
    - **並べ替えの名前（A9。core/owned.js の `OWNED_SORTS` と views/owned.js の `HEAD_COLUMNS`・`HEAD_WORDS`）**: 選択の名前を「〈何〉が〈向き〉」、列見出しの読み上げを「〈何〉で並べ替え（〈向き〉）」にそろえた。「図鑑番号の大きい順」→「図鑑番号が大きい順」、「レベルの高い順／低い順」→「レベルが高い順／低い順」、「パル濃縮（★）の多い順／少ない順」→「…が多い順／少ない順」、**「良いパッシブ順」→「パッシブのランクが高い順」**（反対は今までどおり「パッシブのランクが低い順」）。列見出しのパッシブの読み上げは「良いパッシブで並べ替え（良い順）」→「パッシブのランクで並べ替え（高い順）」、所持者・場所は「（ボックスの順／逆の順）」→「（ボックス順／ボックスの逆順）」。キー・向き・URL・並べ方は変えていない。
    - **A12**: test/static/styles.test.js が、views/owned.js の `ROW_ESTIMATE` と app.css の `--owned-row-h` が同じ値かを確かめる（上の 11 の「行は 80px に固定」の 2 か所）。
19. **フェーズ 1b・1c の終わりのユーザーの答え（2026-10-13、ブランチ `fix/phase-1bc-answers`。D25。上の 17 の B2〔印 1 個と「+N」〕・11〔行は 80px に固定〕を変えた）**:
    - **行の下の段**: `ownedRowItem` の行は、5 つの欄の後ろに **`div.owned-band`**（grid の 2 段目・`grid-column: 1 / -1`。行の幅いっぱい）を、**目標の印か一致の理由があるときだけ**作る。中は左から目標の印 `span.owned-badge.badge-mark`（**`MARK_SLOTS = 4` 個まで**。それぞれ title に全文）、5 つ目からの `button.owned-badge.mark-more`「+N」（4 つ見せて残りの数。aria-label「+N（ほかの目標の印 N 個）」・title に残り・`data-focus="marks-more"`。押すと板 `div.mark-list` に残り）、その後ろにキーワードの一致の理由 `p.owned-hits`（前はパッシブの欄の 3 段目）。印と理由は別々に書き換える（`write('marks')`・`write('hits')`。理由だけが変わっても印の要素は同じ）。段は行の操作（触れた行の右端）より前に置く（Tab の順: 名前 → パッシブの「+N」→ 段の「+N」→ 行の操作）。
    - **見せ方（自分で決めた）**: 印は `flex: 0 1 auto; min-width: 3em; max-width: 18em`（長い目標名は縮めて省略）、理由は `flex: 1 1 0; min-width: 8em`（印が 4 つでも理由が少し見える。入りきらない分は省略して title に全文）、印と理由の間は 6px。1100px の行の段は 909px で、印 4 つ（各 81〜82px）＋「+2」（30px）の後ろに理由が 525px、920px は 744px で理由が 360px（`answers/band-*.png`。ライト・ダーク）。印の色は前と同じ `.badge-mark, .mark-more`。
    - **行の高さ**: 一覧の入れ物 `.owned-list` に **`has-band`** を付けている間だけ、**全部の行を 80px**（`--owned-row-band-h`）、ほかは **64px**（`--owned-row-h`）。差の 16px が段（`--owned-band-h`。行の grid は `grid-template-rows: minmax(0, 1fr)` と `grid-auto-rows: var(--owned-band-h)` で、段は印・理由があるときだけ 2 段目に入る）。`has-band` は **「目標の印」のチェックがオンで保存した目標が 1 つ以上ある（`shownMarks`）か、キーワードの語がある（`keywordTerms` が空でない。空白だけは入らない〔自分で決めた〕）**とき。どちらも利用者の操作でしか変わらないので、データの読み直し（10 秒ごとなど）では行の高さが変わらない（印の付く個体がいなくなっても 80px のまま）。切り替えは入れ物のクラス 1 つ（`.owned-list.has-band .owned-row { height; contain-intrinsic-size }`。行の子のスタイルは計算し直させない）。前の記録 11 の「キーワードがあるときだけ has-query で 66 → 84px にしたら 1 字目で 50〜60ms かかったのでやめた」とは違い、今回は 2,000 行でキーワードの 1 字目・消したときとも 50ms を超える Long Task は出なかった（下の計測）。
    - JS の見積もりは **`ROW_ESTIMATE = 64`・`ROW_ESTIMATE_BAND = 80`**。test/static/styles.test.js（A12）は、この 2 つと CSS の `--owned-row-h`・`--owned-row-band-h`、差と `--owned-band-h`、`.owned-list.has-band .owned-row` の height を確かめる。パッシブの欄は 2 段（24＋3＋24＝51px）、1 段目の中身は 53px（パルの欄 52px）。
    - **見ていた行を保つ**: `renderResults({ keepPosition, reveal })` は、段の出し入れで高さが変わるとき、**一覧の先頭が固定の部分（パネル＋列見出し）の下に隠れていて、利用者が条件を変えたのでなければ**（`reveal` でない。条件を変えたときは後で一覧の先頭を見せるので要らない）、高さを変える前に `anchorOf` で見ていた行を覚え、変えた後に `restoreAnchor` で戻す（「目標の印」の切り替え・戻る/進む・URL。目標の保存と削除は前から keepPosition）。一覧の先頭が見えているときは読まない（2,000 行のレイアウトを入力の中で強制しない）。見えている範囲だけ描く一覧（2,000 行を超えたとき）は、ui/virtual-list.js に足した **`setEstimate(value)`**（見積もりを変え、測って覚えた高さを捨てる）を render の前に呼ぶ。画面: 138 体・scrollY 3000 で、固定の部分のすぐ下の 37 行目は「目標の印」を外す・付ける・目標を全部外す・保存し直すのどれでも top 250.08 のまま（scrollY は 3000 ↔ 2424。`answers/anchor.js`）。20,000 行（見えている範囲だけ描く）: 一覧の高さは 20,000 × 64 = 1,280,000px、キーワード「アヌビス」で 12,220 × 80 = 977,600px、消すと 1,280,000px（`answers/virtual-check.js`）。
    - **理想個体のカードの行**: 「別の配合牧場で使用中」は名前の下のバッジの 1 行のまま（options に **`badges`** を足し、views/ideal.js はそれで渡す。`marks` は所持パルの一覧の目標の印＝下の段）。カードの行は 64px（ideal-results の記録 14）。
    - **「+N」の説明の板は押したときに作る**（views/owned.js の `laterHint`。初めて押したときに ui/hint.js の `hint` を作り、足した **`open()`** でその 1 回で開く。印の「+N」・パッシブの「+N」とも）。全部の行に「+N」がある 2,000 行で、「ぽち」を消して 36 → 2,000 行に戻すと、前に作って捨てた板の部品（popover の要素・リスナー）の GC で 146〜391ms の Long Task が 5 回中 3 回出た（long-animation-frame で見ると rAF の tick の中のスクリプト 260ms・強制レイアウト 0。消す前に CDP で GC を済ませると 4 回とも出ない）。作るのを押したときにすると 4 回 × 2 幅とも出ず、開いたときのヒープの増加も 5.8 → 4.5MB。aria-expanded（false）と `.hint-trigger` は前と同じく最初から付ける。
    - **要素の数**: 段のある行は +6（入れ物・印 4・「+N」）。いちばん多い行（パッシブ 4 個・パルボックスの位置・印 5 つ以上）は 41（`test/perf/owned.perf.js` の 1 行の上限 35 は印のない行のまま、印のある行は 41 以下、全部の行に印 6 個の 2,000 行が行だけで 78,000 以下〔68,480〕を足した。上限 41 にした理由: 2,000 × 41 = 82,000 は 80,000 を超えるが、実際の分布ではパッシブの数がばらけ、全部の行に印のあるブラウザの 2,000 行でも 70,701 ノードだったため。要素を減らす工夫として、段は印か理由があるときだけ作り、「+N」の板の部品は押したときに作る）。行の外の要素は約 270。
    - **計測**（ブラウザ・1100×900。phase-1a の「計測の記録」）: 2,000 行・目標なし（64px）で、開いて最初の 200 行 18〜22ms・全行 217〜248ms・58,752 ノード・ヒープの増加 3.1〜3.2MB。2,000 行の全部の行に印 5 つ（`answers/inject-rows-2000-marks.js`〔inject-rows-2000.js の写し。種族を 20 に絞り HP を 40 以上〕と `goals-all.js`〔20 種族 × 5 件＝上限の 100 件〕。印がないのはタマゴ 5 と人間 1 の 6 行）で、最初の 200 行 18〜20ms・全行 237〜269ms・**70,701 ノード**・ヒープの増加 4.4〜4.5MB・行 80px。キーワード「アヌビス」「ぽち」の入力と消すとき、「目標の印」の切り替え（2,000 行の高さが変わる）で 50ms を超える Long Task なし（1100・1280px で各 2 回。`answers/longtask-band.js`）。目標なしの 2,000 行で、キーワードの 1 字目（64 → 80px）と消すとき（80 → 64px）も 50ms を超える Long Task なし。129 行の scrollHeight は目標なし 8,698px（64 × 129＋ほか）・目標あり 10,762px（前と同じ）で、開いたまま 25 秒（10 秒ごとの読み直しを 2 回）5 秒ごとに測っても変わらない（`answers/rows.js`・`stable-plain.js`）。
    - テスト: owned-view.test.js に 4 件（下の段に 4 つと「+N」・理由が印の後ろ・段ごと外す、has-band の条件と読み直しで変わらないこと、見ていた行を保つ、見えている範囲だけ描く一覧の見積もり）、virtual-list.test.js に `setEstimate` 1 件。どれも変える前のコードで落ちる。期待値を直したもの: B2（4 個と「+96」）・B5（5 件で「+1」）・目標の印のテスト（段の中を読む）。ideal-view.test.js の使用中の印に「名前の下・段なし」を足した。
    - 後のテーマへ: farm-board（3）の牧場の親の印を所持パルの一覧に出すなら `marks`（下の段・4 つまで）。理想個体のカードのように名前の下に出すなら `badges`。owned-detail（3）で段に部品を足すときは、段は印か理由があるときだけ作ることと、高さは一覧の has-band が決めることを守る。visual-parts（1d）で印の色を変えるときは `.badge-mark, .mark-more`（段とカードの両方）。
20. **フェーズ 1b・1c の後のユーザーのフィードバック（2026-10-13、ブランチ `fix/phase-1bc-feedback`。D28。記録 9 の行の操作を変えた）**: 「一覧のパルはすでに所持しているので理想個体にすることはない」「所持パルからの継承ルートも、目標パルとパッシブから探すので不要」「親にする検索はあってもよいが、1 つだけになるならデザインを変えた方がよい」。
    - **`ownedRowLinks(pal)` は「親にして検索」の 1 件だけを返す**（形は配列のまま。項目は `{ key: 'search', icon: 'search', text: '親にして検索', label: '〈種族名〉を親にして検索', title: '〈種族名〉を親1 にして配合検索を開く', href: buildHash('search', { p1 }) }`。前の `label` は見えない名前だけだったので、見えている文字 `text` と title を足した）。「目標に（理想個体）」（`#/ideal?to=&p=`）と「ここから継承ルート」（`#/route?from=&p=`）はなくし、正のパッシブを選ぶ `positivePassives` も消した（URL の受け口は変えていない。`#/route?from=` はパル詳細の「ここから継承ルート」が使う）。行の目印の `data-focus` は `action-search` だけ（`action-ideal`・`action-route` はなくなった）。`actionsKey` は種族だけ。
    - **見せ方（自分で決めた）**: 絵だけの 30px のボタン 3 つの浮き板をやめ、**検索の絵（`navIcon('search')`・16px）と文字「親にして検索」の 1 つの丸いボタン**（`a.owned-row-action` の中に `span.owned-row-action-text`。高さ 30px・幅 114px・枠 outline・地 surface-container-low・文字 primary 12px 太字・影 elevation-2。ホバーで primary の薄い地と枠）。文字は今のタブの名前「配合検索」と、ユーザーの言葉「親にする検索」から短くした（所持者・場所の列〔1100px で約 133px〕をなるべく隠さない幅）。読み上げの名前は見えている文字を含む「〈種族名〉を親にして検索」。置き場所は今までどおり行の右端（right 10px）で、縦は上の段の真ん中（`top: calc(var(--owned-row-h) / 2)`。下の段のある 80px の行でも同じ位置）。ポインターが乗った行・フォーカスが中にある行だけに見せ、触れた行にだけ作る仕組み（`showActions`・`hideActions`・`actionRows` の 2 つまで）と行の高さ（64px／80px）は変えていない。キーボードは名前のリンクから Tab 1 回でボタンへ。
    - **要素の数**: 行の操作の要素は 15 → 6（入れ物・リンク・svg と線・文字）。2,000 行（`inject-rows-2000.js`・1100×900）で 30 行に順にポインターを乗せても操作は 1 つ・58,750 ノード（乗せる前 58,744）。開いて最初の 200 行 15〜28ms・全行 206〜227ms・58,750 ノード・ヒープの増加 3.1MB（`owned-rows/perf-open.js` を 2 回）、キーワード「アヌビス」「ぽち」の入力で 50ms を超える Long Task なし（`owned-rows/longtask3.js` を 2 回）。撮影は `shots/owned/feedback/action-pointer-*.png`・`action-keyboard-*.png`（1100・920px、ライト・ダーク）。
    - テスト: owned-view.test.js の行の操作のテスト（1 つ・文字・読み上げの名前・title・href・`action-search`、`action-ideal`・`action-route` がない）と B12 のテスト（フォーカスの目印を `action-search` に）。変える前のコードで落ちることを確かめた。
    - 後のテーマへ（記録 16 の申し送りを直す）: find-merge（2）でタブの名前を「配合を探す」にするときは、`ownedRowLinks` の行き先に加えて文字と title の「配合検索」も直す（例「親にして探す」）。owned-detail（3）で「詳細」を足すときは `ownedRowLinks` に 2 件目を足すと同じ形のボタンが横に並ぶ（2 つで約 190px。所持者・場所の列をほぼ隠すので、画面で決める）。ドロワーの中のリンクに「目標に」「ここから継承ルート」は出さない。
21. **2026-10-14 のユーザーのフィードバック（ブランチ `fix/feedback2-owned`。D29。細部は担当が決めた）**:
    - **行の操作をなくした**（「親にして検索の選択肢が、「所持者・場所」の内容に被って表示されてしまう…そもそもなくしても良い」。親が決めた形）: `ownedRowLinks`・`canAct`・`ownedRowItem` の `actions` オプションと `showActions`・`hideActions`・`fillActions`、一覧の `rowParts`・`rowOf`・`actionRows`・`touchRow` と pointerover／pointerleave／focusin／focusout の付け替え、CSS の `.owned-row-actions`・`.owned-row-action*`、ui/nav-icons.js の import を消した（上の 9・17 の B12・20）。行の目印の `data-focus` は `pal`・`passive-more`・`marks-more` だけ。パル名のリンク（`#/pal/<id>`。配合の親・子の一覧がある）から進める。親にして配合を探す・逆引き・継承ルートの検索は、フェーズ 3 の owned-detail のドロワーにまとめる（phase-3-4 の owned-detail の節に書いた）。`test/perf/owned.perf.js` の `{ actions: true }` も外した。
    - **キーワードに一致した理由を、一致したすべての項目で出す**（「必ず何に一致したから表示したのか分かるようにしたい。例えば「闇」と調べたら闇属性が一致するが、その場合、「属性：闇」のように、何かしらは表示するようにして」）:
      - core/owned.js の **`keywordNotes(pal, terms, extra)`**: 語の順に、その語が当たった項目の値をすべて `{ label, name, desc }` で返す。項目と、1 つの語の中の並びは `NOTE_SPECS` の パル名（日本語名・英名・内部名）・ニックネーム・属性・性別（オス・メス・♂・♀）・特徴（タマゴ・ラッキー・アルファ）・パッシブ・パートナースキル・アクティブスキル・所持者・場所・預けた人（行の左から右の順に近い並び）。`extra`（画面が足す目標の印）は見出し「目標の印」。スキル・パッシブは説明で当たったときだけ説明を付け、同じ見出しの同じ値は 1 回だけ（別の語が説明に当たったら説明を足す）。拠点の個体の所持者（拠点の名前）は、場所と同じ値なら場所として 1 回だけ。絞り込み（`matchesKeywords`）で残った個体なら、どの語にも 1 つ以上の理由がある。前の `NOTE_FIELDS`・`NOTE_KEYS` と、`keywordEntries` の `notes`（理由に使う項目だけの配列）はなくし、`keywordEntries` は全部の項目の配列だけを返す（`prepareKeywords` で先に作るのは今までどおり）。
      - 一覧の `rowOptionsOf` は、目標の印も `keywordNotes` の `extra` に渡す（`filterOwned` の `extraTexts` と同じ文字）。
      - **行の見せ方（views/owned.js の `fillHits`。自分で決めた）**: 下の段の `p.owned-hits` に、見出しごとに 1 つの `span.owned-hit`「パッシブ：職人気質（作業速度 +50%）・希少」（同じ見出しの値は「・」でつなぎ、説明は名前の後ろの（ ））を **`HIT_GROUPS = 4`** 個まで並べ、残りの見出しは `span.owned-hit-more`「ほか N 件」。段落の title は 1 件 1 行の全文、各 `span.owned-hit` の title はその見出しの全文。前の `span.owned-hit-name`・`span.owned-hit-desc`（説明を薄い字の別の要素）はやめ、説明も同じ要素の文にした（要素を増やさないため）。段落は flex で、**16 字以下の見出し（`HIT_SHORT`。「パル名：アヌビス」「属性：闇」など）は `is-short` で縮めず**、長いもの（説明つきなど）だけを長いほど縮めて省略する（はじめは全部を縮めたので、説明の長い項目と並ぶと「パル名：ア…」になった。画面で確かめて直した）。
      - 要素の数: 理由の段落は 1＋見出し 4＋「ほか」で 6 まで。いちばん要素の多い行（パッシブ 4 個・パルボックスの位置・印 5 つ以上）に理由が付いても 47（`test/perf/owned.perf.js` に 1 行 47 以下を足した）。全部の行に印 6 個とキーワードの理由（目標の印・パッシブの 2 見出し）の 2,000 行で行だけ 74,480（78,000 以下を足した）。
    - 画面（`feedback2/owned.js`。1100・920px、ライト・ダーク）: 「闇」で「属性：闇 · アクティブスキル：ダークボール（…）・スプレッドダーク（…）」や「パッシブ：魔女（闇属性攻撃ダメージ増加30% …） · アクティブスキル：スプレッドダーク（…）」、「アヌビス」で「パル名：アヌビス · パートナースキル：砂漠の守護神（発動すると、アヌビスが…）」、「伝説」で「パッシブ：伝説」、所持者「すべて」で「Bob」に「所持者：Bob」「預けた人：Bob」、「も」で「パル名：モコロン · パッシブ：引きこもり・不眠（夜になっても眠らず…） · パートナースキル：モコモコの盾」。行にポインターを乗せても操作は出ない（0 個）。
    - 性能: `npm run test:perf` のキーワードの入力（絞り込み・並べ替え・描く行の署名と一致の理由）は、2,000 行の初めての「も」が 24〜55ms（同じ時間帯に main の worktree で 18〜24ms）、20,000 行が 21〜37ms で、どれも 100ms 以内。ブラウザ（2,000 行・`owned-rows/longtask3.js`・1100px。所持者を「すべて」にして測った）の「アヌビス」「ぽち」の入力の Long Task は「アヌビス」で 50〜79ms が 1 回ずつ（4 回）・「ぽち」は 0。同じ時間帯に別のサーバ（ポート 5192）で main を同じ手順で測ると「アヌビス」で 0〜72ms（2 回）で、どちらも 100ms を超えない（D28 の記録の「50ms を超える Long Task なし」より大きいのは、この PC の負荷の揺れ〔main も同じ〕）。
    - テスト: core/owned.test.js（理由の項目・並び・語ごと・説明・拠点・目標の印・同じ値 1 回・どこにも当たらない語）、owned-view.test.js（行の理由・見出しごとにまとめる・4 つと「ほか N 件」・`is-short`・title、行の操作がない・`ownedRowLinks` を export しない）。どれも変える前のコードで落ちることを確かめた。期待値を直したもの: スキルとパートナースキルの並び（パートナースキルが先）、「無 ラッキー」「職人気質」などで理由が出る、`.owned-hit-name` → `.owned-hit` の文。D28 の行の操作のテストと B12 のテストは消した。
    - 後のテーマへ（上の 16・17・19・20 の申し送りを直す）: owned-detail（3）— 行の操作はない。ドロワーの開き方（セルのクリックと、キーボードの手段）は phase-3-4 の owned-detail の追記のとおり画面で決める。一致の全文はドロワーで `keywordNotes(pal, terms, extra)` の全部。find-merge（2）— `ownedRowLinks` はなくなったので、行の行き先や「配合検索」の文字を直す作業はない。visual-parts（1d）— 行の操作の絵はない。cleanup-dead-code（1d）— `.owned-hit-name`・`.owned-hit-desc`・`.place-chip-count`・`.place-bases*`・`.owned-source*` は消した。


---

## フェーズの終わりにすること

1. **レビュー**: 観点別のエージェント（安定性・INV-2・セキュリティ・性能・テスト）と Codex（読み取り専用）で、フェーズ 1b・1c の差分を確認し、直してから次（フェーズ 1d）へ。Codex を使う前に、ユーザーに目的を説明して許可を得る（プロジェクトの CLAUDE.md）。この環境では Codex のシェルの起動が失敗したことがある（appendix/codex-reviews.md）ので、先に小さな試しで動くかを確かめる。
2. **計測を取り直す**（統合プラン「検証」の表のうち、このフェーズの分）:

   | 操作 | 今（実測） | 目標 |
   |---|---|---|
   | 所持パルでパッシブを足す（scrollY=380） | 下が 44px 下がる | 動かない |
   | 所持パルで結果が減る絞り込み（scrollY=380） | 画面全体が 242px 動く | sticky のパネルで条件と件数を見失わない |
   | 所持パルの行（129 行） | scrollHeight が 9574〜10011px で揺れる | 揺れない |
   | 理想個体でパッシブ追加 | フォーカスが body に落ち、1 番目の組が 20px 動く | 選択欄に残り、動かない |
   | 1 分ごと・20 秒ごとの読み直し | 帯の出入りで一覧が上下する（約 40〜45px） | 動かない |

3. **ブラウザでしか確かめられないこと**: 日本語変換中の入力（キーワード・個体値）、候補やパッシブの板を開いたままの 20 秒の更新、幅 920px・1100px・拡大 125〜150%、ヘッダー・パネル・牧場の帯・列見出し・ポップオーバー・トースト・ダイアログの重なり。
4. **報告**: 変更したファイル・実行したコマンド・画面の確かめ方を短く報告して、フェーズ 1d へ進む。

## コードで確かめてプランと違っていた点（まとめ）

1. **talent-input から core/ideal.js を import できない**: test/import.test.js:38-44 が core/ideal.js を読めるのを views/ideal.js だけに限っている。部品はキーとラベルを引数で受け取る（または core/ideal-goals.js の `GOAL_STATS`）。
2. **自動登録は uncertain の牧場をもともと使っていない**: core/auto-breeding.js:51-53 は `snapshot.breedFarms` を直接読み、`status === 'ok'` でなければ親の組を空にする。ideal-farms の「自動登録から外す」は変更不要で、作業は `owned.farms` と `targetFarms` だけ。
3. **共有では牧場の状態を運べない**: GAS の `cleanOwnedFarms`（core/owned-shared.js:22-33 の写し）は決まった項目しか残さない。フェーズ 1 では uncertain の牧場を共有に送らず（今と同じ形）、参加者の画面で読めない牧場を知るのはフェーズ 3 の farm-data（GAS の反映は `npm run gas:push`。`setup()` は通常は要らない）から。
4. **所持パルのパネルの配置**: プランの F056 の 1 段目「[所持者][場所チップ][パル][キーワード][並べ替え]」は、本文の幅（約 956px）に場所のチップ（約 420px）とパル（240px）が並ばない。パルを 2 段目に移し、属性の 9 個のトグル（O-15）はボタン＋ポップオーバーにし、件数と条件のチップは状態の行（3 行目、約 28px）にした。合計は約 125px で予算内。
5. **aria-sort**: 列見出しの `aria-sort` は表（table・grid）の columnheader にしか使えない。一覧は表の役割を持たないので、`role=toolbar` の `aria-pressed` のボタン＋向きを書いた aria-label にした。
6. **所持者の意味（O-08・O-09）**: 案の判断は「意味をそろえない・『自分の個体』は足さない」だったが、統合プラン（F057・Codex の決まり）に従い、そろえて「自分の個体」も足す。拠点のパルを分けたいときは場所のチップで分ける。
7. **G-56 の説明部品**: 判断は「行内に展開」だったが、1a で `ui/popover.js` ができるので位置合わせの費用はなくなり、行内に広げると sticky や結果が動く。`ui/popover.js` の上に、クリック／Enter で開く部品として作る。
8. **ダイアログは遷移で閉じない**: `closeDialogs` を呼ぶのはログアウトのとき（web/js/app.js:307）だけ。目標のダイアログの「呼び出す」では自分で閉じる。
9. **ideal-results の強調と owned-rows の 4 セルの順番**: 1b の強調（F042）は 1c の 4 セル（F043）より先に入るので、ideal-results では個体値を区切りの文字つきの 3 つの span にして（強調がなければ今の文字と同じ）、owned-rows で 4 セルに置き換える。
10. **2,000 行の DOM の予算**: 6×5 の図を `rect` 30 個の SVG にすると 2,000 行で 6 万要素になり予算（80,000 ノード）を超える。図は要素 2 つ、★は文字の 2 つの span、行の操作は触れた行にだけ作る。
11. **`stats` は共有のデータにない**: `ownedFromShared` は `stats: {}`（core/owned.js:524）。場所の分からないパルの 1 行（C-32）はこの PC で読んだデータのときだけ出る。
12. **行番号の小さなずれ**: 設定の状態表示は views/owned-settings.js:378-381（案では :379-382・:381-382）。ほかの行番号はこのドキュメントに書いた値が正。
13. **テーマの順番**: プランの表は ideal-panel → talent-target の順だが、手戻りを減らすため talent-target を先にした（どちらでも成り立つ）。
