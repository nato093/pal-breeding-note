# フェーズ 1b・1c: 理想個体と所持パルの安定化（実装ドキュメント）

> このドキュメントだけを読めば、フェーズ 1b（理想個体）と 1c（所持パル）の 7 テーマを、経緯も含めて把握して実装できるように書いた。
> 書いた日: 2026-10-12。コードの行番号は HEAD `c5c0683`（web/ に未コミットの変更なし）で、**実際にファイルを開いて確かめた**もの。実装の前にもう一度開いて確かめること（フェーズ 1a の変更で行はずれる）。
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
| header-frame | CSS 変数 `--header-h`（ヘッダーの高さ）と重なり順の変数（ヘッダー・固定のパネル・候補・レール・トースト・ダイアログ・ドロワー）。このドキュメントでは `--z-header`・`--z-panel`（条件のパネル）・`--z-sticky`（2 段目の固定＝牧場の帯・列見出し）・`--z-popover` と書く（値は phase-1a の header-frame の表）。ヘッダーにセーブ連携の状態（ワールド・セーブ時刻・自動登録）が出る |
| stable-render | `ui/dom.js` の `syncList(container, items, { key, create })`（create は `{ element, update, destroy }`）。画面用の変更番号。理想個体の「データ・index・実効の条件・本人」の署名で再計算を省く仕組みと、idealPlan の区切った計算。所持パルの最初の 200 行を先に出して残りを区切って足す仕組み（古い仕事の無効化つき）。件数の行（`.result-note`）の min-height。View Transition のヘルパー。（追記 2026-10-13、実装の後: 理想個体は `idealPlanSteps` を `startSliced` で回し、結果を描くのは views/ideal.js の `showPlan(result, plan)`。計算中は前の結果を残して `.ideal-results` に `aria-busy`・`is-computing`。選択欄は views/shared.js の `syncOptions`・`renderWhenIdle` で、同じなら作り直さない。所持パルの行は views/owned.js の中の `ownedRowItem`（行に出す値と一致の理由の署名を分け、理由だけ変わったら理由の行だけ入れ直す。1 回の描き直しで書き換えるのは先頭の 200 行までで、残りは区切る）。ビューのテストの context は `inputDelay: 0`・`sliceBudget: Infinity`。phase-1a の stable-render の「実装の記録」） |
| keep-state | 画面ごとの条件とスクロール位置の保持（viewState・history.state）。条件の適用 → 描画 → 位置の復元の順番（追記 2026-10-13、実装の後: 部品は ui/view-memory.js の `createViewMemory`・`restoreScroll`。保存する条件の形は views/owned.js の `OWNED_MEMORY`・views/ideal.js の `IDEAL_MEMORY` で、**条件の項目を足す・変えるテーマはこの形も直す**（形にない項目は保存されず、読み込み直すと消える）。戻る・進むで条件を入れ直したときは applyRoute に `restored: true` が来るので、入力欄も合わせる。phase-1a の keep-state の「実装の記録」） |
| popovers | `ui/popover.js`（固定配置の計算。`{ element, update, destroy }`、document/window のリスナーは AbortController で外す）。パッシブ選択の 1 行部品（`passiveSelector` が `{ element, update({ selected, counts }), destroy }` を返す。開いている間に update が来ても閉じない） |
| data-boundary | 読み戻しの検証（個体値 0〜100 の整数など）。このフェーズで足す値も同じ検証を通す |

- 1a の時点で `ResizeObserver` のモックが `test/helpers/dom.js` と `test/web/app.test.js` に入っていなければ、このフェーズの最初のテーマ（ideal-panel）で足す（別プラン §9 の C）。

## このフェーズ全体の決まり

1. **sticky の重なり**: ヘッダー（`top: 0`）→ 画面の条件パネル（`top: var(--header-h)`）→ 2 段目の固定（理想個体の牧場の帯・所持パルの列見出し。`top: calc(var(--header-h) + var(--panel-h))`）。`--panel-h` は**画面の section 要素に**書く（`element.style.setProperty('--panel-h', '<n>px')`。ほかの画面と値がぶつからない）。高さは ResizeObserver で測る（下の `trackHeight`）。`scrollIntoView` の着地点は `scroll-margin-top: calc(var(--header-h) + var(--panel-h) + 8px)`。
2. **高さの予算**: viewport 幅 1100px 固定（本文の幅は 1100 − ナビのレール 96 − 余白 48 ＝ 約 956px）。sticky の条件パネルは 2 段＋状態の行で**約 120〜130px まで**。幅 920px（header-frame の min-width）では折り返して高くなってよいが、横スクロールは出さない。
3. **高さを測る小さな共通関数**（ideal-panel で足す。1a に同じものがあればそれを使う）: `ui/dom.js` に

   ```js
   /** target の高さを host の CSS 変数 name に書き続ける。ResizeObserver がない環境（テスト）では 1 回だけ測る。 */
   export function trackHeight(target, host, name = '--panel-h') → () => void  // 戻り値は監視をやめる関数
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
- [ ] `npm test` が通る（release-notes の文字数を含む）。
- [ ] 理想個体: HP のチェックを外すと要約が「HP —」になり、結果が「HP 0」を入れていたときと同じになる。保存済みの目標（HP 0）を呼び出すと HP は未チェック・空欄で出る。
- [ ] 所持パル: 「すべて 90 以上」で 3 つとも 90 が入り、1 回だけ絞り込みが走る。「個体値の合計が低い順」が選べる。
- [ ] 101 を入れて確定すると 100 に戻る。日本語変換中は絞り込みが走らない。
- [ ] 旧コードのタブを開いたまま新しいコードで目標を登録し、旧タブで読み直しても個体値が 100 に変わらない（保存の形が同じことの確認）。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — 目標の保存の形が「0＝条件なし」のまま（上の旧コードのタブの確認。null・版 2 は入れていない。判断事項 10）。INV-2 — `ui/talent-input.js` が `core/ideal.js` を import しない（`test/import.test.js`）。セキュリティ — `test/static/security.test.js` が通る。性能 — 間引きの途中で画面を離れても destroy でタイマーが止まり、破棄の後に結果を描かない。

### TODO
- [ ] `ui/talent-input.js` を作る（値の形・チェックと draft・間引き・presets・destroy）
- [ ] `test/web/talent-input.test.js` を書き、先に落ちることを確かめる
- [ ] 理想個体の入力欄（views/ideal.js:202-220）を部品に差し替え、g の呼び出し時に `update` する
- [ ] 見出しを「個体値の目標（以上）」に、`goalSummary` の「気にしない」を「—」「N 以上」に
- [ ] 所持パルの入力欄（views/owned.js:131-150）を部品に差し替え、「すべて 90 以上」「すべて 100」を付ける
- [ ] `OWNED_SORTS` と `sortOwned` に「個体値の合計が低い順」を足し、core のテストを足す
- [ ] ideal-view.test.js:432 と、入力のたびに結果を見るテスト（ideal-view:94-118・owned-view:116-125・186-194）を間引きに合わせて直す
- [ ] CSS を部品に合わせ、`.owned-talent-filter` の不要な規則を消す
- [ ] docs/OPERATIONS.md:116・119 とコードのコメントの「気にしない」を直す
- [ ] release-notes に 1 件足し、モックで両画面を確かめる

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
   - CSS: `position: sticky; top: var(--header-h); z-index: var(--z-panel); background: var(--md-sys-color-surface); border-bottom: 1px solid var(--line); max-height: 130px;`。祖先に `overflow` があると sticky が効かないので、`.app-main`・`.view` に overflow が付いていないことを確かめる。
   - 高さ: `trackHeight(panel, element)` で `--panel-h` を画面の section に書く（決まり 3）。destroy で監視をやめる。
3. **segmented の部品**（新規 `web/js/ui/segmented.js`。route.js:33-38 の `startChip` は継承ルートの開始チップで役割が違うので触らず、見た目の CSS だけ寄せる）:

   ```js
   /** 押しボタンの選択（1 つだけ選ぶ）。choices は [value, 短いラベル, title?] の配列。 */
   export function segmented({ label, choices, value, onChange }) → { element, update(value), destroy() }
   ```
   - `div[role=radiogroup][aria-label=label]` の中に `button[role=radio][aria-checked]`。選んでいるものだけ `tabindex=0`、ほかは -1。←→ キーで移動して選ぶ（ロービングタブインデックス）。選んでいるボタンは `secondary-container` の地。
   - パッシブの条件: `[['include', '全部持つ', '欲しいものを全部持つ（他も可）'], ['only', 'だけ', '欲しいものだけを持つ']]`。ケーキ: `[['none', 'なし', 'ケーキ・野菜ケーキ'], ['talent', 'キノコ等', 'キノコケーキ・豪華野菜ケーキ（個体値 +1〜5）'], ['special', 'スペシャル', 'スペシャルケーキ（パッシブを 4 個まで継ぐ）']]`。title は core/ideal.js の CAKES・PASSIVE_MODES の文をそのまま使う（views/ideal.js から渡す。決まり 4）。値と計算は変えない。
4. **所持の状況**（I-53）: core/ideal.js:877 の戻り値に `sameSpecies` を足す（1 語）。パネル 1 段目に `a.ideal-holding`（幅固定、目標がないときは「—」で幅を保つ）: `所持 ♂${s.M} ♀${s.F}` ＋ 欲しいパッシブがあれば ` · 全部持つ ♂${c.M} ♀${c.F}`。title「親の候補の数（タマゴ・グローバルパルボックスを除き、所持者の絞り込みの後）」。href は `buildHash('owned', { pal: to, p: passives.join(',') })`。`renderResults` の中で idealPlan の結果から書き換える（文字だけ書き換え、要素は作り直さない）。
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
- sticky パネルの高さが変わると下が動くので、パネルの中で高さが変わる要素（パッシブのチップ・所持の状況）は幅と高さを固定する。パッシブの 1 行部品は popovers で 1 行に収まる前提（選んだチップが多いときは横に省略）。

### release-notes の案
- id: `<実装日>-ideal-panel`
- title: 「理想個体の条件を上に固定」（12 字）
- body: 「条件をスクロールしても見える 2 段にまとめました。登録した目標は見出しの「目標」ボタンから開きます。」（51 字）

### 完了の条件
- [ ] `npm test` が通る。
- [ ] モックで、結果を下までスクロールしても条件パネルがヘッダーの下に見えている（幅 1100px で 2 段、パネルの高さ 130px 以下）。
- [ ] scrollY=250 で欲しいパッシブを足しても、1 番目の組の top が変わらない（基準: 466→486）。フォーカスがパッシブの部品に残る。
- [ ] 個体値・segmented・所持者を変えても、パネルの高さが変わらない（`--panel-h` の値が同じ）。
- [ ] 目標を選ぶ前は保存ボタンが見えず、場所は空いたまま（選んだときに右が動かない）。
- [ ] 「目標（N）」のダイアログから外す・元に戻す・呼び出すができ、呼び出すとダイアログが閉じる。
- [ ] 幅 920px・拡大 125% で横スクロールが出ない（パネルは折り返してよい）。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 所持の状況は idealPlan の数だけで配合表を使わず、`ui/segmented.js` は `core/ideal.js` を import しない（`test/import.test.js`）。互換 — 目標の保存の形（`cleanGoal` の項目）を変えていない。古い viewState の `goalsOpen` が残っていても壊れない。セキュリティ — 保存の板・ダイアログは textContent だけ（`test/static/security.test.js`）。性能 — 個体値の入力は 150ms の間引きを通ってから再計算する。

### TODO
- [ ] ResizeObserver のモックと `trackHeight` があるか確かめ、なければ足す
- [ ] `ui/segmented.js` とテストを作る
- [ ] views/ideal.js の並びを「見出し → パネル → 要約 → 牧場 → 結果」に組み直す
- [ ] パネルの 2 段（目標・パッシブ・所持の状況・保存／所持者・パッシブの条件・個体値・ケーキ）を組み、sticky と `--panel-h` を付ける
- [ ] パッシブの条件・ケーキを segmented に差し替える
- [ ] idealPlan の戻り値に sameSpecies を足し、所持の状況のリンクを出す
- [ ] 「☆ 目標として保存」と保存の板（名前・Enter・Esc・条件が変わったら閉じる）を作る
- [ ] 登録一覧の details を「目標（N）」→ダイアログに移す（購読・閉じる・呼び出すで閉じる）
- [ ] 要約の行を 1 行固定にする（中身は ideal-results）
- [ ] ideal-view.test.js の select 前提・登録の行前提のテストを直し、新しいテストを足す
- [ ] 古い CSS を消して新しい CSS を足し、1100px・920px・125% で確かめる
- [ ] release-notes に 1 件足す

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
ideal-panel（要約の行の場所・見出しの「?」の置き場）、popovers（`ui/popover.js`）、stable-render（結果の差分更新。カードの `data-key`）、ideal-calc（説明の文・組の定義）。

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
- [ ] `npm test` が通る。
- [ ] 要約が 1 行に収まり、条件を変えても要約の行の高さが変わらない（下の牧場・結果が動かない）。
- [ ] 「計算のしくみ」が結果の下から消え、「?」から 4 見出しのダイアログで読める。INV-2 の例外の一文と「変更あり」の消える条件・交換の決め方が残っている。
- [ ] 組の数値がすべて「…まで 平均 約 N 個」の形で、「世代を重ねて」「に 1 個」「多くても」が画面に出ない。
- [ ] 組の ♂♀ 行で、欲しいパッシブに ✓、余計なパッシブが薄く、目標未満の個体値に差（−N）が出る。
- [ ] 45 秒開いたままでも（20 秒の確認を 2 回またいでも）、カードの DOM が作り直されず、最終確認の時刻だけが変わる（MutationObserver で確かめる）。
- [ ] 説明の板を開いても、周りの要素の位置が変わらない。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 計算のしくみのダイアログに例外 (b) の一文が残り、数値は idealPlan の結果だけ。`ui/hint.js` は `core/ideal.js` を import しない（`test/import.test.js`）。セキュリティ — `ui/hint.js` は HTML の文字列を受けず textContent だけで作る（`test/static/security.test.js`）。性能 — 20 秒ごとの確認でカードを作り直さない（上の MutationObserver の確認）。互換 — 保存するデータは増えていない。

### TODO
- [ ] `ui/hint.js` とテストを作る（popover.js の上に、開閉・Esc・1 度に 1 つ）
- [ ] 要約を `.ideal-summary`（文・除外ボタン・最終確認）に組み直す
- [ ] `refresh` で確認した時刻を覚え、時刻の文字だけを書き換える
- [ ] `eggsText`・`generationsText`・`pairMeasure` の言い方をそろえる
- [ ] `explanation()` を消し、「?」→ 4 見出しのダイアログにする
- [ ] タグを説明つきのボタンにし、色とアイコンを付ける
- [ ] 同じ見込みの個体値厳選組を畳む（判定が指す組・先頭は残す）
- [ ] `renderMissing` と `noPairs` の文言を直す（:374 は触らない）
- [ ] `ownedRow` に `highlight` を足し、`pairCard` から渡す
- [ ] ideal-view.test.js の文言の期待値を直し、新しいテストを足す
- [ ] release-notes に 1 件足し、モックで確かめる

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
ideal-results（カードの札・説明部品・畳み）、ideal-panel（`--panel-h`）、stable-render（カードの `data-key`）、ideal-calc（`farmAdvice` の `measureOf`・`idealPlan` の `measures`・「変更あり」の絞り込み）。

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
- [ ] `npm test` が通る。
- [ ] モック（`inject.js`。拠点 1 にアヌビスの組が 2 つ・拠点 2 にジェッドランの組）で、拠点 1 の 2 つの牧場が「牧場 A」「牧場 B」と出る。
- [ ] 牧場の行を押すと該当の組がパネルと帯の下に見える位置へ移り、1 秒光る（動きを減らす設定では色だけ）。畳まれた組なら開いてから移る。
- [ ] 注入データの牧場の 1 つを uncertain にすると、交換推奨・空き・使用中が出ず「判定を保留」の理由が出る。「変更あり」のタグと件数の文も出ない（D13）。
- [ ] 境目の線がなく、置く組がカードの札（「◯◯に配置中」「→ ◯◯へ」）で分かる（D14）。
- [ ] 交換を見送って今の組が一覧にない牧場の行に「おすすめの一覧にない組 · 完成まで 平均 約 N 個」が出て、押せない。一覧にある「そのまま」の組は押すとカードへ移る（D15）。
- [ ] 空き牧場の案内に、牧場に残す組・交換先の組の個体を使う組が出ない（D16）。
- [ ] 牧場の帯は、目標を変えて牧場が 0↔1 になっても高さが変わらない（結果の top が動かない）。
- [ ] ホストの画面で共有した JSON の farms に uncertain の牧場と status が入っていない（開発用 API のモックで確かめる）。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — status のない古い IndexedDB・古い共有データの牧場は ok として扱われ（既存の `test/core/ideal-farms.test.js` 3 件がそのまま通る）、共有の形と GAS は変えていない（上の JSON の確認）。INV-2 — 判定はセーブの事実と idealPlan の結果だけで、配合表を読まない。セキュリティ — 帯と行は textContent と createElementNS（`test/static/security.test.js`）。性能 — 帯の高さは固定で、20 秒ごとの再計算の後も強調を `data-key` で付け直す。

### TODO
- [ ] `normalizeOwned` で uncertain の牧場を status つきで残し、`ownedFromShared` に status: 'ok' を付ける
- [ ] `sharedUpload` で ok の牧場だけを今の形で送る（GAS・旧画面の互換）
- [ ] core/ideal-farms.js に `readyFarms`・`farmCompleteness`・`emptyFarms`・`farmNames`・`farmsInUse` を足し、`targetFarms` で `readyFarms` を通す
- [ ] core のテスト（ideal-farms・owned）を足す
- [ ] views/ideal.js の判定の組み立てを、所持者で絞る前の候補・完全性・保留に合わせて組み直す（complete なら ideal-calc の `farmAdvice(…, { measureOf })`、保留中は「変更あり」なし＝D13）
- [ ] sticky の牧場の帯を作る（高さ固定・押すと組へ移る・保留の 1 行・一覧にない「そのまま」は番号なしで押せない）
- [ ] 牧場の詳細（絵の行・2×2・入れる／外す個体の行・空き・使用中）を作る（見送った「そのまま」の行の数字＝D15、空き牧場の組の選び方＝D16）
- [ ] カードに `data-key`・札（牧場 A に配置中・交換先・持ち主が違う）を付ける（境目の線は作らない＝D14）
- [ ] `ownedRow` に `marks` を足す
- [ ] ideal-view.test.js の牧場の文のテストを直し、新しいテストを足す
- [ ] CSS を書き直し、モックで A／B・移動・保留を確かめる
- [ ] release-notes に 1 件足す

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
7. **理想個体と継承ルートに 1 行**: 理想個体は要約（ideal-results の `.ideal-summary`）の上に `ownedSourceLine`。ideal-results で要約の右端に出していた「セーブ …」は外し、「最終確認」はスロットの表示に任せる（`checkedAt`）。継承ルートは所持パルの欄（`ownedSection`、web/js/views/route.js:58・`renderOwned` :115-）の先頭に置く（所持パルのデータがあるときだけ）。どちらも `owned.subscribe` で `update(state)` だけを呼ぶ（結果は描き直さない）。
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
- [ ] `npm test` が通る（auto-register のテストを含む）。
- [ ] モックで所持パルを開いたまま、1 分ごとの確認と 20 秒ごとの読み直しをまたいでも、絞り込みと一覧の top が変わらない（帯が出入りしない。layout-shift 0）。
- [ ] 状態のスロットの幅が「確認中…」「最終確認 13:42」で変わらない。設定のセーブ連携でもエラーの行が点滅せず、横のボタンが動かない。
- [ ] 所持パルを表示できているときは「ファイル未登録」の帯が出ない。データがないときはボタンで設定へ行ける。
- [ ] 理想個体と継承ルートに「「ワールド」· この PC／共有 · N 体 · セーブ M/D HH:MM」の 1 行が出る。
- [ ] 参加者（共有だけを見る）で所持パルを開いたまま、ホストの共有の更新が 30 秒程度で反映される。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — `busy` の意味を変えていない（`test/web/auto-register.test.js:161` が通る）。`stats` のない古い IndexedDB でも壊れない。性能 — 定期の読み直しは裏のタブ（`visibilityState === 'hidden'`）では動かない。セキュリティ — 1 行の文は textContent（`test/static/security.test.js`）。INV-2 — 対象外。

### TODO
- [ ] owned.js に `activity` と `checkedAt` を足し、各所で入れる（busy は変えない）
- [ ] 確認の始めに `auto.error` を消さないようにし、'empty' の文を短くする
- [ ] owned-store のテストを足す
- [ ] `ownedNotices` から busy・確認中・共有中を外し、未登録の案内をデータがないときだけにする
- [ ] 場所の分からないパル・読めなかった項目の 1 行と「見る」を足す
- [ ] `activityText`・`sourceText`・`ownedSourceLine` を作る
- [ ] 所持パルの要約を 1 行に置き換え、案内のボタン（設定・見る）を足す
- [ ] 理想個体の要約の上と継承ルートの所持パルの欄に 1 行を置く
- [ ] `keepRefreshing` を作り、理想個体と所持パルで使う
- [ ] 設定の `autoError` と `.owned-auto-state` の幅を固定する
- [ ] owned-view・ideal-view・route-view のテストを直し・足す
- [ ] release-notes に 1 件足し、1 分以上開いたままで動かないことを確かめる

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
   - 状態の行（28px）: `12 / 340 体 · ♂5 ♀6 タマゴ 1`（O-04・O-50。グローバルを外していて数があれば title に「グローバル 25 体は非表示」）＋効いている条件のチップ（既定から変えた条件だけ。例「所持者: Alice ×」「★2 以上 ×」「攻撃 90 以上 ×」「パッシブ: 職人気質 ×」「属性: 闇 ×」。入り切らなければ「+n」）＋[すべて解除]＋[リンクをコピー]＋右端に O-40 のリンク（パルを選んでいれば「この条件で理想個体 →」＝ `buildHash('ideal', { to: palId, p: 正のランクのパッシブ })`、パッシブを選んでいれば「このパッシブを運ぶ継承ルート →」＝ `buildHash('route', { p })`。継承ルートでは目標を選ぶ手順が残る）。
   - 合計の高さは約 125px（キャプションを各欄の上に 1 行、操作は 36px）。幅 920px では折り返してよい。
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
- [ ] `npm test` が通る。
- [ ] 幅 1100px でパネルが 2 段＋状態の行（高さ 130px 以下）に収まり、129 行の一覧の下の方でも条件と件数が見える。
- [ ] scrollY=380 でパッシブを足しても一覧の先頭の行の top が変わらない（基準: +44px）。結果が減っても条件と件数を見失わない（基準: 画面全体が 242px 動く）。
- [ ] 所持者「Alice」の件数が、理想個体の所持者「Alice」の候補と同じ個体の集合になる（タマゴ・グローバルの場所のチップの状態を同じにしたとき）。
- [ ] 古い viewState（タマゴのチェックを外した状態）から開いても同じ絞り込みになる。
- [ ] リンクをコピー → 新しいタブで開く → 同じ件数。
- [ ] 2,000 行の注入データで、キーワードの入力が 100ms 以上止まらない（Performance パネルの Long Task で確かめる）。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — 古い viewState・古い URL・旧コードのタブが作ったリンクを `migrateFilter` で読み替え、URL の値は検証してから使う（上の確認）。INV-2 — 所持数を数えるだけで、`core/ideal.js` を import しない（`test/import.test.js`）。セキュリティ — `test/static/security.test.js` が通り、クリップボードの失敗で例外を出さない。性能 — 上の 2,000 行の確認に加え、許可 id の Set と場所の件数はデータが変わったときだけ作る。

### TODO
- [ ] 絞り込みの値の新しい形と `migrateFilter` を作り、テストする
- [ ] `filterOwned` の引数を `ids・places・bases・elements・passiveMode` に変え、core のテストを書き換える
- [ ] 所持者の選択肢（すべて・自分の個体・プレイヤー）と許可 id の Set を作る
- [ ] 場所のチップ（件数・0 件は隠す）と拠点の ▾ を作る
- [ ] 属性 ▾ のトグルを作る
- [ ] `ui/search-select.js` とテストを作る
- [ ] パネルを 2 段＋状態の行に組み、sticky と `--panel-h` を付ける
- [ ] 効いている条件のチップ・すべて解除・0 件の解除ボタン・リンクをコピーを作る（部品の同期を含む）
- [ ] URL の受け口を広げ、値を検証する
- [ ] 理想個体・継承ルートへのリンクと ♂♀ の内訳を状態の行に出す
- [ ] 条件を変えたら結果の先頭を見せる（利用者の操作のときだけ）
- [ ] 部品を作り直さず `update` する形にする
- [ ] owned-view のテストを直し・足し、古い CSS を消す
- [ ] release-notes に 1 件足し、1100px・920px で確かめる

---

## owned-rows: 列見出し・4 セル・固定枠で、行の高さをそろえる

### 目的
所持パルの一覧の先頭に sticky の列見出し（押すと並べ替え）を置き、行を固定の高さにする（個体値は 4 セル＋ミニバー、★は 4 枠、パッシブは 2×2 の固定枠、場所は短い表記＋ボックスの位置の小さな図）。行から理想個体・継承ルート・配合を探すへ進めるようにし、目標の完成品・欲しいパッシブ持ちの印を出す。

### 経緯
- 別プランの **F069**（sticky の列見出し、押すと並べ替え・もう一度で昇降）・**F043**（個体値を HP／攻／防／計の 4 セル＋ミニバー。理想個体の 190px の特例をなくす）・**F066**（★は 4 枠、パッシブは 2×2 固定、「☆なし」「パッシブなし」の文字を外す、場所は「パルボックス P2 · 1-6」＋6×5 の図、タマゴの Lv は「—」）・**F063**（行のホバー／フォーカスで「目標に」「ここから継承ルート」「親1 にして配合を探す」）。
- 別プラン §9 の Codex の決まり: 行部品は `{ element, update, destroy }`・復元は `focus({ preventScroll: true })`・**列見出しは syncList の管理行に混ぜず、行の入れ物と分けて同じ grid の定義を共有**・**「+N」は 3 個＋残り N のポップオーバー（行内展開はしない）**・**content-visibility の推定の高さ（app.css:933 の 60px）を新しい行の高さに合わせ、sticky の要素には付けない**・**列見出しの並べ替えは単項目ソート（HP／攻／防）を OWNED_SORTS に足し、全ソートに最後の id の比較と aria-sort**・**場所の図は正規化の結果に構造化した位置（page/row/col）を持たせる。共有の placeLabel は互換のため短くしない**。
- 本セッションの案: **O-21**（能力ごとの個体値順）・**O-22**（判断: 「場所順」をボックスの並びに。共有の列は足さず placeLabel から読む）・**O-24**（判断: 「パッシブの数が多い順」を「良いパッシブ順（ランクの合計）」に置き換え、キーは 'passives' のまま）・**O-10**（判断: 拠点の個体の「拠点 1／拠点 1／預けた人」の重なりを表示で直す。CSV の列名は変えない）・**O-25**（判断: 行の中だけランクの高い順に並べる。負のパッシブを薄くはしない）・**O-30**（行の推定の高さ）・**O-44**（個体値のミニバー。判断: CSS 変数でバーを描き SVG は使わない、ケーキの 3 段階と合計の表示は入れない、aria-label に数値）・**O-45**（★の 4 枠。判断: CSS の ★／☆ の色分けでもよい）・**O-52**（判断: 印は「完成品: 目標名」と「目標名の欲しいパッシブ」の 2 つ、表示の切り替えは既定オン、キーワードで探せる。継承ルートの印は保存がないので作れない）・**O-38**（判断: 列は足さず、行の右端に重ねる。p には正のランクのパッシブだけ）・**V-10**（判断: 6×5 の小さな図。合わなければ文字だけ）。

### 依存
owned-toolbar（パネルの高さ `--panel-h`・並べ替えの選択）、stable-render（`syncList`・最初の 200 行と区切った描画・古い仕事の無効化）、ideal-results（`ownedRow` の `highlight`）、ideal-farms（`ownedRow` の `marks`）。

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
- [ ] `npm test` と `npm run test:perf` が通る。
- [ ] 129 行の一覧で scrollHeight を 4 回測って同じ値になる（基準: 10011／10001／9574／9757）。
- [ ] 列見出しがパネルの下に貼り付き、押すと並べ替わる（View Transition は並べ替えのときだけ。動きを減らす設定では使わない）。
- [ ] 2,000 行の注入データで、最初の 200 行が 100ms 以内・全行が 1 秒以内に出て、`document.getElementsByTagName('*').length` が 80,000 以下、ヒープの増加が 150MB 以下。
- [ ] パッシブ 5 個以上・拠点の個体・タマゴ・人間の行も、ほかの行と同じ高さ。
- [ ] 行の操作から理想個体・継承ルート・配合検索へ、パッシブを選び直さずに進める。
- [ ] 理想個体の組のカードでも、4 セルと強調（✓・差）が崩れない。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 印は登録した目標とセーブの情報だけで、`goalMarks` は `core/ideal-goals.js` に置く（`test/import.test.js`）。互換 — 共有の形（OWNED_FIELDS・placeLabel の書式）と CSV の列名を変えていない。古い共有で box が null でも文字で出る。セキュリティ — 図・★・バーは要素と `style.setProperty`（`test/static/security.test.js`）。性能 — 上の 2,000 行の確認に加え、20,000 行・偏った種族の分布で入力が 100ms 以上止まらない（`test/perf/owned.perf.js` とブラウザ）。

### TODO
- [ ] 正規化に `box` を足し、`parseBoxLabel` を作ってテストで書式と結び付ける
- [ ] `OWNED_SORTS` に向きと HP・攻撃・防御を足し、良いパッシブ順・ボックス順・id の決め手を入れる
- [ ] `ownedRowItem`（`{ element, update, destroy }`）を作り、`ownedRow` を包みにする
- [ ] ★の 4 枠・タマゴの「—」・パッシブの 2×2 と「+N」・キーワードの理由の 1 行を作る
- [ ] 個体値の 4 セルとバー（CSS 変数）を作り、理想個体の強調を移し、190px の特例を消す
- [ ] 所持者・場所の表示（拠点の重なりをなくす・P2 · 1-2・6×5 の図）を作る
- [ ] `goalMarks` と目標の印（表示の切り替え・キーワードで探せる）を作る
- [ ] 行の操作を、触れた行にだけ作る形で足す
- [ ] 列見出し（別の入れ物・`--owned-cols`・押すと並べ替え・select と同期）を作る
- [ ] syncList と区切った描画に乗せ、行の推定の高さを実際の高さに合わせる
- [ ] owned-view・ideal-view・owned のテストを直し・足す
- [ ] 2,000 行・20,000 行で予算を測り、超えたら直す
- [ ] release-notes に 1 件足す

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
