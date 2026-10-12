# TODO（パル配合ノート UI 改善の実装）

> [README.md](README.md) を先に読む。ここは進み具合の記録。テーマの中身（手順・テスト・注意）は、各テーマの見出しのリンク先（フェーズの文書の節）にある。
> 各テーマの TODO は、フェーズの文書の「### TODO」をそのまま写した（2026-10-12）。フェーズの文書の TODO を直したら、ここも直す。

## 使い方

- 終わった項目は `- [ ]` を `- [x]` にする。途中のものは `- [ ]` のまま、行の末尾に「（途中: …）」と書く。
- テーマを終えたら、見出しの下の「状態」の行を「済」にし、ブランチ名とマージのコミット（`git log --oneline -1` の短いハッシュ）を書き添える。
- 上から順に、1 テーマずつ進める（実装は直列）。順番を変えたときは、理由をそのテーマの見出しの下に一言書く。
- セッションを終えるとき・途中で止めるときは、末尾の「[次にやること](#次にやること)」を書き直す（どのテーマの・どの項目の途中か、気づいたこと、ユーザーに確かめ中のこと）。
- 各テーマの完了の条件は、リンク先の節の「### 完了の条件」。TODO を全部チェックしても、完了の条件を満たすまでテーマを終えない（性能の予算を超えたら、そのテーマを終えずに直す）。完了の条件の最後の行「**共通の受け入れ条件**」（INV-2・保存データの互換・セキュリティ・性能。README の [5-1](README.md#5-1-全テーマ共通の受け入れ条件)）も満たすこと。
- 任意の項目は、ユーザーが採ると決めたものだけ行う。

## 進み具合の概要

| フェーズ | テーマ数 | TODO の数 | 済のテーマ |
|---|---|---|---|
| 0 準備 | — | 9 | 済 |
| 1-0 | 1 | 17 | 1 |
| 1a | 7 | 96 | 0 |
| 1b | 4 | 45 | 0 |
| 1c | 3 | 44 | 0 |
| 1d | 6 | 74 | 0 |
| 2 | 10 | 119 | 0 |
| 3 | 7 | 79 | 0 |
| 4 | 4 | 49 | 0 |
| 任意 | 4 | 23 | — |
| **合計** | **42＋任意 4** | **532＋任意 23** | **1** |

TODO の数は、テーマの TODO とフェーズの終わりの作業の合計（1b と 1c の終わりの作業はまとめて 1c の行に数えた）。2026-10-12 に、理想個体の計算の修正（フェーズ 1-0 の ideal-calc。README の「2-8」）を足し、implants のパルリバーサーの項目を 2 つに分けた（D17）。

## フェーズ 0: 準備

統合プランのフェーズ 0 の「調査結果の書き出し」「計測の手順を置く」は、このドキュメントを作るときに済ませた（付録と `Claude outputs/ui-audit-2026-10/`）。残りは確認と基準の再現。

- [x] 0-1. **着手の合意**: README の「3-1 決定事項」「3-7 実装前・実装中にユーザーに確かめる点」を短く示し、このドキュメントのとおりに実装へ進めてよいか、ユーザーの合意を得る（統合プランは承認のダイアログで明示的には承認されていない。README の「2-6」）。フェーズ 1-0 の ideal-calc は、ユーザーが「内容は承認済み」と答えている（README の「2-8」）ので、合意を取り直さない（済: 2026-10-12、セッション `300704ce`。「ドキュメントのとおり（D1〜D18・3-3・3-7 の既定の扱い）」で合意。あわせて、各テーマは `feature/<key>` でコミットし `main` へ `--no-ff` でマージまで進めてよい（push はしない）、止まって報告する単位はテーマごと、と答えた）
- [x] 0-2. **`.gitignore` の扱いを確かめる**（済: 2026-10-12、セッション `c342c7a9`。ユーザーの判断で `.mso/`・`.playwright-cli/`・`Claude outputs/` を `.gitignore` に足し、ブランチ `docs/ui-refactor-plan` で単独のコミットにして `main` にマージした。経緯は README の「8-2」）
- [x] 0-3. **`docs/ui-refactor/` をコミットするかを確かめる**（済: 2026-10-12、同じセッション。公開リポジトリなので、ユーザー名を含むパス・Steam ID・ワールドの ID を伏せてからコミットし、`main` にマージした。push はしていない）。以後も、どのブランチでも `git add -A`・`git add .` を使わない
- [x] 0-4. **Codex の利用を確かめる**: フェーズ末のレビューで Codex（読み取り専用）を使ってよいか、目的を説明して許可を得る（プロジェクトの CLAUDE.md・グローバルの規約）。使う前に、シェルが起動するかを小さく試す（この環境では起動に失敗したことがある）（済: 2026-10-12。ユーザーの回答は「積極的にフル活用して良い。読み込ませる情報に制限もない。」。レビューも実装の委譲も、テーマごとに許可を取り直さなくてよい。Skill ツールからの呼び出しは権限の確認で止まったので、`bash ~/.claude/skills/delegate-codex/codex-delegate.sh --stdin` を Bash で直接呼ぶ）
- [x] 0-5. **コードが調査のときのままか確かめる**: `git diff c5c0683 --stat -- web/ test/` が空か（2026-10-12 に文書と `.gitignore` をコミットしたので、`git log -1` は `c5c0683` ではない。web/・test/ は変えていない）。変わったファイルがあれば、該当するテーマの文書の file:line を開き直す前提で進める（済: 2026-10-12。空だった。HEAD は `63fc066`）
- [x] 0-6. **付録とスクリーンショットを確かめる**: `docs/ui-refactor/appendix/` の 7 本（catalog・rejected・measurements・codex-reviews・other-session-plan・plan-snapshot・ideal-calc-plan）が開ける。`Claude outputs/ui-audit-2026-10/shots/{find,record,owned}/` に PNG（計 110 個）と `owned/inject.js`・`owned/inject2.js`・`owned/measure.js`・`record/measure.js`・`find/init-goto.js` がある（済: 2026-10-12。7 本と PNG 110 個（find 37・record 39・owned 34）、スクリプト 5 本がある）
- [x] 0-7. **テストの基準**: `npm test` と `npm run test:perf` が、何も変えていない状態で通ることを確かめ、`test:perf` の値を phase-1a-foundation.md の「計測の記録」に書く（この値が、ideal-calc の「変える前の値」になる）（済: 2026-10-12。`npm test` 1,024 件・`test:perf` 3 件が通った。値は計測の記録）
- [x] 0-8. **基準の計測を再現する**: `npm run dev` → `http://localhost:5173/?mock=1&seed=80`（新規登録で入る）→ 所持パルは `Claude outputs/ui-audit-2026-10/shots/owned/inject.js` で注入（手順は appendix/measurements.md の「モックでの再現の仕方」）。README「7-2」の表のうち 2 行以上（例: 配合検索で親を選ぶと 27px 下がる・ヘッダー scrollY=800 でベルが画面外）を同じ値で再現できることを確かめ、計測の記録に書く。終わったらブラウザと開発サーバを止める（済: 2026-10-12。2 行を同じ値で再現した（計測の記録）。注意: モックの配合は `Math.random` で作るので、seed が同じでも中身は毎回変わる。撮影のときの「ソルレイス」に配合があるとは限らないので、一覧の先頭の配合の親を選んで測った）
- [x] 0-9. **次にやることを更新する**: 下の「次にやること」を「フェーズ 1-0 の ideal-calc」に書き換える（済: ideal-calc に入った。今の状態は末尾の「次にやること」）

---

## フェーズ 1-0: 理想個体の計算の修正

詳細: [phase-1-0-ideal-calc.md](phase-1-0-ideal-calc.md)（冒頭の「このフェーズの目的」「コードで確かめた結果」と、末尾の「後のテーマへの申し送り」を先に読む）。フェーズ 0 の後、フェーズ 1a より前に入れる。

### 0. [ideal-calc](phase-1-0-ideal-calc.md#ideal-calc-両親合わせてパッシブがそろう組も完全体作成組にし交換推奨と変更ありを全体の速さの目安で決める)（L）

両親合わせてパッシブがそろう組も完全体作成組にし、交換推奨と「変更あり」を全体の速さの目安で決める

- 状態: 済 ／ ブランチ: `feature/ideal-calc` ／ マージのコミット: `76001f7`
- 実装で決めたこと・文書との違いは phase-1-0-ideal-calc.md の「実装の記録」。D19（別の子も登録されている組は速さで比べない）をユーザーに確かめて足した
- 順番: UI 改善の統合プランにはないテーマ。2026-10-12 に足し、1a の前に置いた（今の行番号がそのまま使え、後のテーマが新しい計算の上で作れるため。README の「2-8」）

- [x] 変える前に `npm run test:perf` の値を測って記録する
- [x] `generationTable` に `parentExtras` を足す（実効の値に正規化・キャッシュのキー・`ignorePassives` は 0 のまま）
- [x] `value()` に範囲の検査を足す（範囲外は Infinity）
- [x] `idealPlan` の世代の計算の条件を「同じ種族・和集合がそろう・各親 4 個以下」にし、表を作る条件を mask の組み合わせで決める
- [x] `comparePlan` を丸めた比較キーと `prefer` の優先にする（`prefer` を idealPlan に足す）
- [x] `idealPlan` に `watch` を足し、`measures` を返す（:833 の省略を watch の組では求める・blocked）
- [x] `farmAdvice` にまとまりと R の比較を入れる（`measureOf` なしは今と同じ）
- [x] views/ideal.js の `renderResults` を新しい流れにし、「変更あり」を交換推奨の行き先に絞る
- [x] 「そのまま」の文と、説明の :160・:161・:162・:165・:166・:411 を直す
- [x] ideal.test.js・ideal-farms.test.js・ideal-view.test.js を直し・足す
- [x] ideal.perf.js に fixture を足し、表の作成と使い回しを分けて測る
- [x] data/SOURCES.md に変更記録つきで追記する
- [x] release-notes に 1 件足す
- [x] 画面で 4 体の条件を確かめる

### フェーズ 1-0 の終わり

- [x] `npm test`・`npm run test:perf` が通る（perf は変える前の値と同じ条件で比べ、表の作成と使い回しの値を phase-1a-foundation.md の「計測の記録」に書いた）
- [x] 観点別のエージェントと Codex（読み取り専用。使う前に許可・シェルが動くか小さく試す）で差分をレビューし、直した（Codex 1 件・レビュー担当 6 件。直した点は「実装の記録」。Codex のシェルは今回も起動しなかったが、node_repl で読み取りと計算ができた）
- [x] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）

---

## フェーズ 1a: 土台

詳細: [phase-1a-foundation.md](phase-1a-foundation.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 1. [inv2-notice](phase-1a-foundation.md#inv2-notice-自動登録の通知から配合表の答えを外す)（S）

自動登録の通知から配合表の答えを外す

- 状態: 済 ／ ブランチ: `feature/inv2-notice` ／ マージのコミット: `9688079`
- 文書と違う形にしたこと: release-notes の本文は、見送りの通知にはタマゴの中身も出るので「親・タマゴの中身・登録済みの子だけを出します」にした（44 字）。テストの :406-407 相当は登録済みの子が 2 つで、並びは登録の順なので、どちらの順でも通る形にした。コメントの「配合表は〜」の言い回しも、`grep -n "表は"` が旧本文を読む所だけになるように直した

- [x] auto-register.js に `AUTO_NOTICE_TITLES`・`anomalyText`・`conflictText` を足す
- [x] `anomalyNotice` を新しい文にする（expected を使わない）
- [x] `conflictNotice` を新しい文にする（候補の子を使わない・href は今のまま）
- [x] `safeAutoNotice` を足し、`readNotices` で通す
- [x] ファイル冒頭のコメントを直す
- [x] auto-register.test.js の title・body の期待値を直す（:128・149・280・393-394・406-407・474）
- [x] 生成した通知に配合表の答えが無いテスト（突然変異タマゴを含む）を足す
- [x] 旧本文の通知から起動するテストと、`safeAutoNotice` の単体テストを足す
- [x] release-notes に 1 件足す
- [x] `npm test`・モックのベルで確かめる

### 2. [render-contract](phase-1a-foundation.md#render-contract-同じ画面なら作り直さない遷移の契約)（M）

同じ画面なら作り直さない遷移の契約

- 状態: 済 ／ ブランチ: `feature/render-contract` ／ マージのコミット: `a1faa29`
- 文書と違う形にしたこと: 開始チップとパッシブの欄はビューの中で作り直すため（手順 6 の「要素が残る」は誤り）、views/shared.js に `keepFocus` を足し、開始チップに `data-focus-key` を付けた（keep-state で ui/focus.js に置き換える）。ほかに `syncPicker`・各ビューの `readRoute`（生成時は applyRoute を呼ばない）・理想個体の g での入力欄の合わせ直し（`showConditions`）・同じ URL への update は何もしない、を足した（phase-1a の render-contract の「実装の記録」）

- [x] router.js に `sameScreen` を足し、onChange に第 2 引数を渡す
- [x] app.js の render を「同じ画面なら applyRoute・違えば作り直し」にし、`shownRoute`・`shownAuth`・`intent` を持つ
- [x] `context.update` を足し、`context.navigate` に intent を、`context.replace` に state の保持と route の更新を入れる
- [x] views/shared.js に `changeRoute` を足し、navigateSelection と watchView を直す
- [x] search.js・reverse.js を applyRoute の形にする
- [x] route.js を applyRoute の形にする（setPassives・⇄・開始チップを changeRoute に）
- [x] ideal.js を applyRoute の形にする（g の処理を移す・目標が変わったら名前を消す）
- [x] owned.js の URL の条件の読み込みを applyRoute に移す
- [x] app.test.js:319 の期待値を直し、作り直さない・作り直す・ログアウト・replace の state のテストを足す
- [x] views・router のテストを足す
- [x] release-notes に 1 件足す
- [x] モックで要素が同じこと・フォーカス・名前・戻る/進むを確かめる（実機の戻る・進むの手応えはヘッドレスでは確かめられない）

### 3. [data-boundary](phase-1a-foundation.md#data-boundary-読み戻しの境界の共通の検証)（M）

読み戻しの境界の共通の検証

- 状態: 済 ／ ブランチ: `feature/data-boundary` ／ マージのコミット: `d29d395`
- 文書と違う形にしたこと: `isObject`・`idText`・`screenHref`・`cleanSnapshot` などを足し、cleanRecords は届いた項目だけを直す（欠けた項目は足さない）、cleanOwnedPayload は文字列でない列名を '' にして列の位置を保つ、ワールドの行・プレイヤー・拠点は知っている項目だけを写す（後のテーマで項目を足すときはそこにも足す）、既読は保存するときも 2,000 件まで（phase-1a の data-boundary の「実装の記録」）

- [x] core/boundary.js（int・intOrNull・text・oneOf・isoTime・list・worldId・cleanSaved）と単体テストを作る
- [x] core/owned.js の normalizeOwned・ownedFromShared の数値・ID の重複・パッシブ・文字数・件数を直す
- [x] owned.js の validData を cleanLocalData に、validShared を cleanSharedCache にする
- [x] core/boundary.js に cleanOwnedWorlds・cleanOwnedPayload を足し、api.js の共有の応答で通す
- [x] cleanRecords・cleanUsers を足し、api.js の応答と store.js のキャッシュの読み出しで通す
- [x] 既読・自動登録の通知・対応表・viewWorldId の読み出しを直す
- [x] cleanNotification に id・href の長さの上限を足す
- [x] owned・api・store・owned-store・notifications・auto-register のテストを足す
- [x] test/perf に 20,000 行の計測を足す（test/perf/owned.perf.js。負荷の高い時間帯で合計 146〜171 ms・予算 200ms）
- [x] release-notes に 1 件足す
- [x] モックで壊れたデータから起動して確かめる（所持パルの個体値 150 → 「HP 100」、配合のキャッシュに null を混ぜても配合検索が出る）

### 4. [header-frame](phase-1a-foundation.md#header-frame-固定ヘッダー状態id重なり順の変数)（M）

固定ヘッダー・状態・ID・重なり順の変数

- 状態: 済 ／ ブランチ: `feature/header-frame` ／ マージのコミット: `517bcea`
- 文書と違う形にしたこと: セーブ連携の状態の最大幅（22em・14em）をやめてワールド名だけを縮める形にし（測ると 22em では時刻と自動登録が切れた）、`ui/header-popup.js`（popovers で置き換える）・`formatShortTime`・`syncStatus` の部品を足し、`accountMenu({ store, renamer })` にした。読み込み中の印は `auto.status === 'checking'` の間も立てる（phase-1a の header-frame の「実装の記録」）

- [x] app.css に `--header-h` と `--z-*` を足し、既存の z-index を置き換える
- [x] テスト環境の帯をヘッダーの中のチップにする
- [x] `.header-actions` をなくし、ベル・登録をヘッダーの中へ移す（DOM の順番＝Tab の順番）
- [x] ui/sync-status.js（syncStatusText）を作り、同期状況を押せる button にする（aria-live を外す・失敗しても前回値）
- [x] api.js:20 の TIMEOUT の文を直す
- [x] ui/save-status.js（saveStatusModel・saveStatus とポップオーバー）を作る
- [x] auto-register.js に subscribe を足し、setEnabled・setMapping で知らせる
- [x] openRenameDialog・confirmLogout を ui/account-actions.js に移し、ui/account-menu.js（右端の ID）を作る
- [x] ヘッダーの CSS（sticky・高さ固定・nowrap・scrollbar-gutter・scroll-padding-top・min-width 920px）を直す
- [x] 幅が足りないときの隠す順番を @media で入れ、実機で閾値を確かめる（モックの 1280〜920px で測った。閾値は文書のまま。実機の Windows Chrome は未確認）
- [x] app.test.js:72・116 を直し、並び・同期状況・失敗時のテストを足す
- [x] save-status・auto-register・account-menu のテストを足す（sync-status のテストも足した）
- [x] release-notes に 1 件足す
- [x] モックと実機で、固定・幅・許可・テスト環境を確かめる（モックで固定・幅・拡大・テスト環境・失敗のチップ・ライトとダーク。許可の画面と実機の幅 960px の窓は未確認）

### 5. [stable-render](phase-1a-foundation.md#stable-render-差分更新区切った描画再計算の省略ずれの解消)（L）

差分更新・区切った描画・再計算の省略・ずれの解消

- 状態: 済 ／ ブランチ: `feature/stable-render` ／ マージのコミット: `c4f26c4`
- ideal-calc の後の形で書き直した（2026-10-12。README の「3-6」の末尾。D9〜D18。D18 で画面が止まる時間の上限を決めた）
- 文書と違う形にしたこと: 表 1 つで 300ms を超える条件（最大 491ms）があったので表の作成も区切り、組のループの区切りを 1,024 組ごと・最後の選び方をヒープ・見る組のキーを ID の表から引く形にし（20,000 行の偏った分布で 55 → 12 秒、区切りの最大 160 → 32ms）、所持パルは先頭の 200 行だけすぐ書き換えて残りを区切り・キーワードの文字列を使い回す形にした（`startSliced` の `firstBudget`・`syncOptions`・`renderWhenIdle`・`hasGenerationTable`・`prepareKeywords` を足した。20,000 行・同じ種族 6 割の理想個体は合計約 12 秒で D18 の「Worker を検討」に当たるが、Worker にはしていない。phase-1a の stable-render の「実装の記録」）

- [x] store.js に revision と署名による index の据え置きを入れ、watchView と設定の警告を直す（設定は前回取得の時刻も同じ署名で描き直す）
- [x] ui/dom.js に syncList・listKeys・clearList（フォーカスの復元つき）とテストを作る
- [x] renderCards を syncList にし、検索・逆引き・パル詳細・一覧を寄せる（キーに表示の向きと版）
- [x] 所持パルの行を fillOwnedRow と ownedRowItem（署名で更新）に分ける（一致の理由だけ変わったら理由の行だけ入れ直す）
- [x] 所持パルの描画の仕事（先頭 200 行・16ms の区切り・古い仕事の破棄・destroy）を入れる
- [x] 自動の更新の後に先頭の行の位置を戻す（anchorOf・restoreAnchor）
- [x] ui/virtual-list.js を作り、2,000 行を超えたら仮想にする
- [x] core/ideal.js に idealPlanSteps を足し（ideal-calc の `prefer`・`watch`・`measures` を通す）、ui/slice.js と views/ideal.js の署名（牧場の署名と `prefer` を含む）・区切った計算を入れる（表の作成の前に「計算中」を描く。表の作成が 300ms を超えたら表の作成も分けて回す＝D18。表の作成も区切った）
- [x] 所持パル・理想個体・継承ルート・設定の選択肢を署名で作り直さないようにする（フォーカス中は待つ）
- [x] debounce・onTextInput を作り、キーワード・個体値・登録者名に使う（テストの inputDelay）
- [x] .result-note の min-height と同期バーの場所を残す隠し方を入れる
- [x] 新しい版の案内を下端の固定スナックバーにし、ダイアログが開いていたら再読み込みを保留する
- [x] ui/motion.js（withTransition）を作り、所持パルと一覧の並べ替えに使う
- [x] 性能テスト（owned.perf.js・ideal.perf.js の追加分）と、ブラウザでの予算の計測をする（2,000 行・20,000 行とも予算の中。phase-1a の「計測の記録」）
- [x] release-notes に 1 件足す

### 6. [keep-state](phase-1a-foundation.md#keep-state-位置と条件の保持フォーカスの一般化)（M）

位置と条件の保持・フォーカスの一般化

- 状態: 済 ／ ブランチ: `feature/keep-state` ／ マージのコミット: `83232f2`
- 文書と違う形にしたこと: 入力欄の合わせ直しは applyRoute の `restored`（エントリの条件を入れ直したとき）だけにし、起動では G-48 の保存を全画面に入れてから今のエントリで上書き、ワールドはどちらかが分からなければ比べず分かった所で所持者だけ外し、リンクの印は root（ヘッダーのリンクも先頭へ）に付けて ID のない新しいエントリは違う画面なら先頭、フォーカスは group が無ければ key と同じ名前の group へ移す形にした（`restoreScroll`・`routeKey`・`intIn`・`bool`・`passiveChip` の `focusGroup` を足し、`keepFocus` を消した。phase-1a の keep-state の「実装の記録」）

- [x] ui/view-memory.js（エントリ・G-48 の保存・最後のタブ・clear）と単体テストを作る（restoreScroll も同じファイル）
- [x] 所持パル・理想個体・一覧の条件の schema を各ビューから export する（`OWNED_MEMORY`・`IDEAL_MEMORY`・`LIST_MEMORY`）
- [x] app.js でエントリの ID を付け（ensureEntry・update の pushState）、scrollRestoration を manual にする
- [x] 移る前・スクロール・pagehide・hidden で今のエントリを保存する（タブ・リンクの click で intent を付ける。click は root に付けた）
- [x] render に「条件を当てる → 描く → 位置を戻す」を入れ、restoreScroll（やり直し・取りやめ）を作る
- [x] owned・ideal の applyRoute で viewState から入力欄を合わせ直す（エントリの条件を入れ直したとき＝`restored` だけ）
- [x] 起動時の最後のタブ（ハッシュが空のときだけ）とタブの行き先の読み戻しを入れる
- [x] ログアウト・名前の変更・ワールドの切り替えで消す
- [x] ui/focus.js を作り、各部品に data-focus-key を付け、app.js の決め打ちを置き換える（keepFocus も置き換えて消した）
- [x] app.css:785-788 のポップインを消す
- [x] コメント（app.js:115・owned.js:75・ideal.js:180）を直す（一覧の list.js も）
- [x] app.test.js の fake に sessionStorage・scrollTo・pushState を足し、位置・条件・最後のタブ・消去のテストを書く（pushState は render-contract で入っていた）
- [x] release-notes に 1 件足す
- [x] モックで位置・戻る/進む・読み込み直し・フォーカスを確かめる（phase-1a の「計測の記録」。読み込み直しは開発 API を包んでユーザーを残して確かめた。ダークは見ていない）

### 7. [popovers](phase-1a-foundation.md#popovers-ポップオーバーの共通化パル選択パッシブ選択)（M）

ポップオーバーの共通化・パル選択・パッシブ選択

- 状態: 済 ／ ブランチ: `feature/popovers` ／ マージのコミット: `b0c285e`
- 文書と違う形にしたこと: `createPopover` に `tag`・`focusOut`・`place`・`onOpen` を足し（外側の pointerdown ではフォーカスを戻さない）、選んでいる行を見せるのは scrollIntoView ではなく一覧だけを動かす `scrollWithin`（offsetTop で測る。開く動きの途中で rect が縮むため）にし、describe に `orderLabel` を足し、登録件数は 1 件以上だけ文字を出し、所持パルのパル選択の候補を右端にそろえた（幅 920px で横にスクロールしたため）。注記は views/shared.js の `ownedSpeciesNotes`・`recordCountNotes`・`routeDistanceNotes`・`passivePresets`、語の分け方は core/kana.js の `queryTerms`（phase-1a の popovers の「実装の記録」）

- [x] ui/popover.js（placeFloating・createPopover）を作り、pal-picker の配置と閉じる処理を移す（scrollWithin も同じファイル）
- [x] core/pal-search.js（頭の 0・段階・英名・属性・パートナースキル・ID の完全一致）を作り、filterPals を置き換える
- [x] pal-picker に describe（order・badges・dim。orderLabel を足した）と update を足し、選んでいる行と矢印の行を分ける（G-61・S-22）
- [x] speciesGenderCounts・distancesTo を足し、検索・逆引き・継承ルート・理想個体・所持パルの選択欄に注記を渡す
- [x] passiveSelector を 1 行の部品（ボタン＋チップ・ポップオーバー・検索・群・その場の onChange・update で閉じない）に作り替える
- [x] negatives・groups（I-49）・presets（I-51）を入れる
- [x] passiveChip に compact を足し、views/ideal.js の余計なパッシブ・配合では作れない警告・「○○を運ぶ経路」をチップにする
- [x] 所持パル・理想個体・継承ルートの呼び出し側を「作り直さず update」にする（O-14 の数え方）
- [x] header-frame のセーブ連携の状態と ID のメニューを ui/popover.js に移す（`ui/header-popup.js` の `headerPopup` を置き換えて消した）
- [x] CSS（1 行・候補・選択中と矢印・バッジ・compact・高さ）を入れる
- [x] pal-picker・ideal-view・owned-view のテストの期待値を直す（record-editor・app・views のテストも）
- [x] pal-search・popover・passive-picker・route・owned のテストを足す（kana の queryTerms も）
- [x] release-notes に 1 件足す
- [x] モックで、ずれ・続けて選ぶ・フォーカス・自動の更新中も閉じない・注記を確かめる（phase-1a の「計測の記録」。モックでは自動の読み直しでデータが変わらないので、データの変化は登録・所持者・キーワードで起こした。日本語変換中の入力は見ていない）

### フェーズ 1a の終わり

- 状態: 済（2026-10-13）。レビューの直しは `fix/phase-1a-review-nav`（マージ `7679322`）と `fix/phase-1a-review-render`（マージ `e55c843`）。指摘は Codex 7 件・観点別のエージェント 3 体（遷移と状態 6 件・データとヘッダー 7 件・描画と部品 8 件）・計測と画面の確認 4 件で、重なりを除いた 26 項目のうち 25 項目を直した（直さなかった 1 件: 手元のセーブのプレイヤーを 100 人で切る。Palworld のサーバの上限は 32 人で、共有も前から 100 人で切っているため）。直したことは phase-1a-foundation.md の各節の「実装の記録」、計測は「計測の記録」の 2026-10-13 の行

- [x] `npm test`・`npm run test:perf` が通る（1,246 件・7 件）
- [x] 計測の取り直し（[phase-1a の「フェーズ 1a の終わりにすること」](phase-1a-foundation.md#フェーズ-1a-の終わりにすること)の表: 配合検索で親を選ぶ・パッシブを足す・所持パルの行・フォーカス・ヘッダー・パル詳細・一覧の並べ替え）。値は[計測の記録](phase-1a-foundation.md#計測の記録実装した人が書き足す)に書く
- [ ] ブラウザでしか確かめられないこと（戻る／進む・日本語変換中の入力・候補を開いたままの同期・20 秒の更新・幅 920px／1100px・拡大 125〜150%・ヘッダー／候補／トースト／ダイアログの重なり・許可の要求）
- [ ] 新旧データの混在（古い IndexedDB・古い共有データ・旧本文の通知・古い sessionStorage・旧コードのタブ）から起動して壊れない
- [ ] 観点別のエージェントと Codex（読み取り専用。使う前に許可・シェルが動くか小さく試す）で差分をレビューし、直した
- [ ] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）

---

## フェーズ 1b: 理想個体

詳細: [phase-1b-1c-ideal-owned.md](phase-1b-1c-ideal-owned.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 8. [talent-target](phase-1b-1c-ideal-owned.md#talent-target-個体値の目標をチェックつき空欄条件なしに)（S）

個体値の目標を「チェックつき・空欄＝条件なし」に

- 状態: 未着手 ／ ブランチ: `feature/talent-target` ／ マージのコミット: （未）
- 順番: 統合プランの表では ideal-panel の後。ideal-panel で今の入力欄を動かした後に部品へ差し替える手戻りをなくすため、先にした（phase-1b-1c の「テーマの順番」。逆でも成り立つ）

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

### 9. [ideal-panel](phase-1b-1c-ideal-owned.md#ideal-panel-理想個体の条件を-sticky-の-2-段パネルに)（M）

理想個体の条件を sticky の 2 段パネルに

- 状態: 未着手 ／ ブランチ: `feature/ideal-panel` ／ マージのコミット: （未）

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

### 10. [ideal-results](phase-1b-1c-ideal-owned.md#ideal-results-要約数値説明を短くそろえ組の親で達否を見せる)（M）

要約・数値・説明を短くそろえ、組の親で達否を見せる

- 状態: 未着手 ／ ブランチ: `feature/ideal-results` ／ マージのコミット: （未）
- ideal-calc の後の形で書き直した（2026-10-12。README の「3-6」の末尾。D9〜D17）

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

### 11. [ideal-farms](phase-1b-1c-ideal-owned.md#ideal-farms-牧場の状態を残し牧場の判定を絵と押せる行に)（M）

牧場の状態を残し、牧場の判定を絵と押せる行に

- 状態: 未着手 ／ ブランチ: `feature/ideal-farms` ／ マージのコミット: （未）
- ideal-calc の後の形で書き直した（2026-10-12。README の「3-6」の末尾。D9〜D17）

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

## フェーズ 1c: 所持パル

詳細: [phase-1b-1c-ideal-owned.md](phase-1b-1c-ideal-owned.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 12. [owned-status](phase-1b-1c-ideal-owned.md#owned-status-読み込みの状態を固定スロットにデータ元を-1-行に)（M）

読み込みの状態を固定スロットに、データ元を 1 行に

- 状態: 未着手 ／ ブランチ: `feature/owned-status` ／ マージのコミット: （未）

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

### 13. [owned-toolbar](phase-1b-1c-ideal-owned.md#owned-toolbar-所持パルの絞り込みを-sticky-のパネルに)（M）

所持パルの絞り込みを sticky のパネルに

- 状態: 未着手 ／ ブランチ: `feature/owned-toolbar` ／ マージのコミット: （未）

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

### 14. [owned-rows](phase-1b-1c-ideal-owned.md#owned-rows-列見出し4-セル固定枠で行の高さをそろえる)（L）

列見出し・4 セル・固定枠で、行の高さをそろえる

- 状態: 未着手 ／ ブランチ: `feature/owned-rows` ／ マージのコミット: （未）

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

### フェーズ 1b・1c の終わり

- [ ] `npm test`・`npm run test:perf`（新しい `test/perf/owned.perf.js` を含む。2,000 行の予算）が通る
- [ ] 計測の取り直し（[phase-1b-1c の「フェーズの終わりにすること」](phase-1b-1c-ideal-owned.md#フェーズの終わりにすること)の表: 所持パルでパッシブを足す・結果が減る絞り込み・行の高さ・理想個体のパッシブ追加・読み直しの帯）
- [ ] ブラウザでしか確かめられないこと（日本語変換中の入力・パッシブの板を開いたままの 20 秒の更新・幅 920px／1100px・拡大 125〜150%・ヘッダー／パネル／牧場の帯／列見出し／ポップオーバー／トースト／ダイアログの重なり）
- [ ] 観点別のエージェント（安定性・INV-2・セキュリティ・性能・テスト）と Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
- [ ] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）

---

## フェーズ 1d: 小さく効く修正

詳細: [phase-1d-small-fixes.md](phase-1d-small-fixes.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 15. [participant-self](phase-1d-small-fixes.md#participant-self-参加者のこのワールドでの自分)（S）

参加者の「このワールドでの自分」

- 状態: 未着手 ／ ブランチ: `feature/participant-self` ／ マージのコミット: （未）

- [ ] `web/js/self-player.js` を作る（キー・get・set・reload・subscribe・saveFailed）とテスト
- [ ] `ownPlayerUids` に `selfUid` を足し、コメントとテストを直す
- [ ] `app.js` で self を作り、identity・context・storage イベント・renamer につなぐ
- [ ] `ideals.js` の `judged` を mode にし、`identityChanged`・`identityKey` を足す（同じセーブ時刻・通知なしのテスト）
- [ ] 設定に「このワールドでの自分」の行（作り直さない select・署名で描き直し）
- [ ] 登録者の select の変更でも `identityChanged` を呼ぶ（推奨）
- [ ] `settingsHash` と、設定の `applyRoute`・`reveal`（行を開く・フォーカス・URL から外す）
- [ ] 理想個体の 2 か所の案内を「設定で選ぶ」ボタンに（ダイアログを閉じる）
- [ ] 理想個体・所持パルを `context.self` の変化で描き直す（署名に `identityKey`）
- [ ] 自動登録の unmapped の通知の行き先と、古い通知の読み替え
- [ ] 名前の変更で self のキーを移す（`moveUserStorage`・`moveLocal`）
- [ ] 期待値の変わるテスト（auto-register.test.js:235、ideal-view.test.js:493-505）を直す
- [ ] release-notes に 1 件、モックで「完了の条件」を確かめる

### 16. [autoreg-success](phase-1d-small-fixes.md#autoreg-success-自動登録の成功を通知に残す)（S）

自動登録の成功を通知に残す

- 状態: 未着手 ／ ブランチ: `feature/autoreg-success` ／ マージのコミット: （未）

- [ ] `cleanNotification` に kind・worldId・batchId を通す（`NOTIFICATION_KINDS`）とテスト
- [ ] `groupNotifications` を作り、テストする
- [ ] ベル（未読の数・パネル）と通知一覧をまとめ表示にする
- [ ] `registeredNotice` を作り、登録が確定するごとに `saveNotices` で残す
- [ ] `saveNotices` で成功 20 件・それ以外 50 件に分けて残す
- [ ] 拠点名の引き方（なければ「配合牧場」）
- [ ] 既存のテスト（auto-register.test.js:241・356・406・474）を直し、新しいテストを足す
- [ ] release-notes に 1 件、画面で確かめる

### 17. [cleanup-dead-code](phase-1d-small-fixes.md#cleanup-dead-code-使われなくなったコードcss-の片付け)（M）

使われなくなったコード・CSS の片付け

- 状態: 未着手 ／ ブランチ: `feature/cleanup-dead-code` ／ マージのコミット: （未）
- ideal-calc の後の形で書き直した（2026-10-12。README の「3-6」の末尾。D9〜D17）

- [ ] ideal.test.js の idealPairs のテストを (a)(b)(c) に分け、一時スクリプトで値を比べてから idealPlan・直接の関数へ移す
- [ ] ideal.perf.js を idealPlan だけにする
- [ ] `core/ideal.js` の ORDERS・compare・compareGenerations・idealPairs を消す
- [ ] `GOAL_ORDERS` と cleanGoal の order、画面の `order: 'next'` を消し、テストを直す
- [ ] README.md:23 の理想個体の説明を直す
- [ ] `core/route.js` の filterPartners・excludePartners・representative を消し、route.test.js を直す（views.test.js・router.test.js は残す）
- [ ] `--md-sys-color-on-error-container` を定義し、定義の有無を確かめる静的テストを足す
- [ ] 未使用の CSS を grep で確かめて消し、`.tab-symbol` の上書き・▸ の transition を直す
- [ ] `empty()` とログイン画面の「◇」を消す
- [ ] `storageWarning(what)` を作り、3 か所を置き換える
- [ ] OPERATIONS.md に diag の 1 項目、README に強み、SOURCES.md に「作らない機能」、COMPARISON.md を書く
- [ ] release-notes に 1 件

### 18. [copy-dead-ends](phase-1d-small-fixes.md#copy-dead-ends-見出し用語案内の行き止まり)（M）

見出し・用語・案内の行き止まり

- 状態: 未着手 ／ ブランチ: `feature/copy-dead-ends` ／ マージのコミット: （未）

- [ ] `views/tabs.js`（`TABS`・`tabLabel`）を作り、app.js と全画面の見出しをそこから引く
- [ ] パル詳細の h1 を「No.〈番号〉 〈名前〉」にし、hero の名前の重なりをなくす
- [ ] 継承ルート・理想個体の h3 を h2 にし、CSS とテストを直す
- [ ] README に表記の決まり、`test/static/wording.test.js` を作る
- [ ] 表記ゆれ（産まれる・♂♀・＋・グローバルパルボックス・新しいバージョン・参加者・パッシブ・ID）を直す
- [ ] ログイン画面の文を減らし、ラベル・エラー文・最初のフォーカスを直す
- [ ] `setupHint` を作り、「設定タブの〜」を 1 文＋ボタンにする（owned.js:433 の文も）
- [ ] ベルの空の文を「これまでの通知」ボタンに
- [ ] `errorState`・`loadingState` を作り、`dataPending` で再試行を出す。読み込み中の文と句点をそろえる
- [ ] `empty` にアイコンの枠を足し、5 か所に出す
- [ ] 一覧・所持パル・配合検索・理想個体の 0 件に次の操作を付ける
- [ ] 期待値の変わるテストを直し、新しいテストを足す
- [ ] release-notes に 1 件、画面で確かめる

### 19. [delete-undo](phase-1d-small-fixes.md#delete-undo-トーストと削除元に戻すの決まり)（S）

トーストと、削除・元に戻すの決まり

- 状態: 未着手 ／ ブランチ: `feature/delete-undo` ／ マージのコミット: （未）

- [ ] toast.js に時間の定数・kind・止める・閉じるボタン・閉じる動き・2 つのリストを入れる
- [ ] toast.test.js を作る
- [ ] トーストの位置（下中央）・エラーの見た目・残り時間の線の CSS を直す
- [ ] スナックバーとの位置関係（`--snackbar-offset`）を決め、stable-render の幅の式を見直す
- [ ] syncInBackground と操作の失敗のトーストを `kind: 'error'` にする
- [ ] 配合の削除の確認を `leftParent` 付きにし、確認の文を定数から作る
- [ ] drafts.js に `removeAll`・`restoreMany` を足す
- [ ] 下書きの一括削除を確認なし＋元に戻すにし、drafts.test.js の 3 つのテストを直す
- [ ] dialog.test.js の移し替えのテストが通ることを確かめる
- [ ] release-notes に 1 件、画面で確かめる

### 20. [visual-parts](phase-1d-small-fixes.md#visual-parts-見た目の部品の統一)（M）

見た目の部品の統一

- 状態: 未着手 ／ ブランチ: `feature/visual-parts` ／ マージのコミット: （未）

- [ ] 性別の色のトークン（ライト・ダーク）と、styles.test.js の確かめ
- [ ] `genderMark()` を作り、palTile と所持パルの人間の行を置き換える（理想個体の文は色だけ）
- [ ] outline・属性チップ（`--element-chip`）・式の「＋」の色を直す
- [ ] `.picker` の並び・ラベルの間隔・select の ∨・パッシブの × を直す
- [ ] `statusChip()` を作り、8 種類の状態の印を置き換える（クラス名は残す）
- [ ] 押せないボタンの見た目と `setDisabled()`、理由を出す 4 か所
- [ ] `ui/icons.js` を作り、navIcon・actionIcon・ベルをそこから呼ぶ
- [ ] 閉じる「×」4 か所を SVG に替え、テストを aria-label で探す形に
- [ ] favicon.svg のダーク対応と、ロゴの「◇」を空にして aria-hidden
- [ ] data/SOURCES.md に画像の作り方の表
- [ ] （任意）ロゴの描き直しをユーザーに確かめる
- [ ] release-notes に 1 件、ライト・ダークで画面を確かめる

### フェーズ 1d の終わり

詳細: [phase-1d-small-fixes.md の該当の節](phase-1d-small-fixes.md#フェーズ-1d-の終わりのチェックリスト)

- [ ] `npm test`・`npm run test:perf` が通る
- [ ] `web/js/release-notes.js` に 6 件（各テーマ 1 件。新しい順・title 20 字・body 60 字以内）
- [ ] シナリオ: 参加者として「このワールドでの自分」を選ぶと、登録済みの目標が「完成済み」になり、選んだ時点の完成は通知されない。その後の共有の更新で新しく完成した目標はベルに出る
- [ ] プロジェクトの CLAUDE.md は変えていない（CLAUDE.md:16 の変更はフェーズ 2 の bell）
- [ ] 観点別のエージェントと Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
- [ ] フェーズ 1 全体の区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）

---

## フェーズ 2: 構成の整理（9 → 5 タブ）

詳細: [phase-2-structure.md](phase-2-structure.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 21. [find-merge](phase-2-structure.md#find-merge-配合を探すに統合)（L）

配合を探すに統合

- 状態: 未着手 ／ ブランチ: `feature/find-merge` ／ マージのコミット: （未）

- [ ] `router.js` に `canonicalHash` と旧画面の表を足し、`startRouter` で replaceState する（テストを先に）
- [ ] `core/kana.js` に `queryTerms`、`core/owned.js` の `keywordTerms` を委ねる
- [ ] `core/record-search.js`（`searchRecords`・`groupRecords`・`registrantCounts`・`RECORD_SORTS`）とテスト
- [ ] `breeding-card.js` に `omitChild`・`compactMemo`
- [ ] `views/search.js` を条件帯＋件数の行＋一覧で作り直す（`applyRoute`／`update`、syncList）
- [ ] 件数の行の文言（S-45）と子ごとの要約チップ（S-38）
- [ ] 空の状態の 5 通りと、登録の初期値に子も渡す
- [ ] NEW のチップと「新着 n 件」、増えた行を光らせる
- [ ] `app.js` のタブ・import・ビューの対応、`nav-icons.js`、レールの区切りの CSS
- [ ] `views/reverse.js`・`views/list.js`・`parentRows` を消し、使わない CSS を片づける
- [ ] 旧画面へのリンク（route.js:196・wishlist.js:184・views/wishlist.js:52・自動登録の食い違いの通知）を新しい形に
- [ ] keep-state の許可リストから旧画面名を外す
- [ ] 既存テストの書き換え（views・app・router・wishlist・auto-register）
- [ ] OPERATIONS.md・README.md の記述と release-notes

### 22. [owned-overlay](phase-2-structure.md#owned-overlay-配合の画面に所持数を重ねる)（M）

配合の画面に所持数を重ねる

- 状態: 未着手 ／ ブランチ: `feature/owned-overlay` ／ マージのコミット: （未）
- 順番: 統合プランの表では goals-merge の後（5 番目）。register-dialog の参照列と goals-merge の目標の行がここで作る集計を使うため、find-merge の直後に移した（phase-2 の「テーマの順番」）

- [ ] `core/owned.js` に `canBeParent`・`ownedCounts`・`canPairRecord` とテスト
- [ ] `ui/owned-badge.js`（親・子の表示、所持パルへのリンク）
- [ ] `breedingEquation`／`breedingCard` に `annotate` を足す
- [ ] 配合を探すで所持パルを購読し、カードに重ねる
- [ ] 「両親を所持している組を上へ」「今の所持で作れる」の切り替えと URL
- [ ] 継承ルートの相手親の注記を ♂♀ の数とリンクに
- [ ] 「N 通り」の中の所持順の並べ替え（安定ソート）
- [ ] 経路の見出しのバッジと、同じ回数の中の並べ直し
- [ ] 開始候補の運び手を `canBeParent` で絞り、0 件のときの添え書き
- [ ] 既存テストの文言の更新（owned-view・owned）
- [ ] OPERATIONS.md:97 の継承ルートの規則と release-notes

### 23. [register-entry](phase-2-structure.md#register-entry-登録の入口と下書きの帯)（M）

登録の入口と下書きの帯

- 状態: 未着手 ／ ブランチ: `feature/register-entry` ／ マージのコミット: （未）

- [ ] ヘッダーの「＋ 登録」と CSS を消す（テストを先に直す）
- [ ] 配合を探すの文脈のボタン（全件・結果あり・0 件）
- [ ] パル詳細の「この子の配合を登録」の強さを登録件数で変える
- [ ] `ui/drafts-band.js` の帯（頭の行・中身・すべて登録・すべて削除）
- [ ] 読み取り専用の下書きの行と syncList・フォーカスの移し先
- [ ] `registerDrafts` を移し、`views/drafts.js` を消す
- [ ] 配合を探すに帯を置き、`drafts=1` で開閉
- [ ] `#/drafts` の読み替えとタブ・アイコン・keep-state の許可リスト
- [ ] ショートカット N
- [ ] drafts・app・views のテストの書き換えと release-notes

### 24. [register-dialog](phase-2-structure.md#register-dialog-登録モーダルの見直し)（M）

登録モーダルの見直し

- 状態: 未着手 ／ ブランチ: `feature/register-dialog` ／ マージのコミット: （未）

- [ ] `ui/dialog.js` に `beforeClose`・`requestClose`・`initialFocus` と `confirmDialog` の `aria-describedby`（テストを先に）
- [ ] 登録モーダルの基準の入力と「退避の対象」の判定
- [ ] 下書きへの退避・失敗時にフォームを残す・トーストの「破棄」
- [ ] `ui/gender-toggle.js` と、枠ごとの性別のリセット
- [ ] `drafts.js` の性別のキー（読み・書き・比較・reload）
- [ ] `saveDraft`・`prepare` で性別を通す
- [ ] `user-rename.js` にオブジェクトのキーの移動を足す
- [ ] 左右 2 列のレイアウトと固定の高さの確認の枠・参照列
- [ ] 式の並び・高さの固定をやめる・登録者とメモを 1 行に
- [ ] 最初の未選択の欄へのフォーカスとエラーの `aria-invalid`
- [ ] ログイン画面の初期フォーカスと ID の maxLength
- [ ] テスト（dialog・record-editor・drafts・user-rename・app）と release-notes

### 25. [goals-merge](phase-2-structure.md#goals-merge-ウィッシュリストを目標に統合)（L）

ウィッシュリストを目標に統合

- 状態: 未着手 ／ ブランチ: `feature/goals-merge` ／ マージのコミット: （未）

- [ ] `speciesGoal`・`isSpeciesGoal`（`core/ideal-goals.js`）
- [ ] `core/goal-observations.js`（形・1 件の判定・併合）とテスト
- [ ] ideals ストアに観測のキー・観測・`observation(palId)`・add／remove／restore の連動
- [ ] `goals-migration.js`（併合・上限・書く順番・読み戻し）とテスト（テストを先に）
- [ ] 名前の変更で観測のキーを移す
- [ ] 通知の元を `goalObservationSource` に（id は旧と同じ形・種族だけの目標がある種族だけ）
- [ ] 目標の一覧の行（パルだけのタグ・配合・所持・呼び出す・外す）と空の状態
- [ ] 移行が終わっていないときの 1 行と、旧ウィッシュリストの読み取り専用のダイアログ
- [ ] `ui/goal-toggle.js` とパル詳細・配合を探すの空の状態
- [ ] レールの「完成した目標 n」
- [ ] `#/wishlist` の読み替え・タブ・ファイルの削除・`context.wishlist` の片づけ
- [ ] 既存テストの書き換え（app・ideals・ideal-view・user-rename）と release-notes・OPERATIONS.md

### 26. [route-cleanup](phase-2-structure.md#route-cleanup-継承ルートの整理)（M）

継承ルートの整理

- 状態: 未着手 ／ ブランチ: `feature/route-cleanup` ／ マージのコミット: （未）

- [ ] `arrange`・2 列の形・入れ替えボタンと CSS を消し、形を 1 つに（テストを先に）
- [ ] 所持パルがないときの 1 行と「設定を開く」
- [ ] 候補の一覧を消し、チップを 2 段に（並びの最後を図鑑順に）
- [ ] 並びを「選択欄 → チップ → 経路 → 所持個体」に
- [ ] `carrierList` を `ownedRow` に、「所持パルで開く」と「ほか N 体」
- [ ] 常時の説明を最初の経路の見出しへ、41 字の案内を placeholder へ
- [ ] 段の縦線と運ぶパッシブのチップ
- [ ] 警告を「同じ組で別の子も登録あり」と「性別の向きは未確認」に分ける
- [ ] 既存テストの書き換え（owned-view・views・route-view）と release-notes・OPERATIONS.md

### 27. [bell](phase-2-structure.md#bell-ベルと通知の整理)（M）

ベルと通知の整理

- 状態: 未着手 ／ ブランチ: `feature/bell` ／ マージのコミット: （未）

- [ ] `cleanNotification` に palId、`notificationCategory`（kind・worldId・batchId は autoreg-success のまま。テストを先に）
- [ ] 各通知の元で palId を入れる（食い違いは親1）
- [ ] 既読の保存先がない端末はお知らせを既読から始める
- [ ] パネルの頭・チップ・「未読だけ」・行の部品・個別の既読・すべて既読
- [ ] 「開いたら全部既読」をやめ、「すべての通知を見る →」と一覧のダイアログを同じ部品に
- [ ] 赤い数字と点・aria-label・揺れ・`unreadCounts`
- [ ] 設定の「通知」カードを消す
- [ ] release-notes の本文の直し・ideal-alpha の削除・先頭のコメント・href
- [ ] プロジェクトの CLAUDE.md:16 と変更記録（拒否されたらユーザーへ）
- [ ] 未設定の通知の行き先
- [ ] テストの書き換え（notifications・app・views・auto-register）と release-notes

### 28. [autoreg-visibility](phase-2-structure.md#autoreg-visibility-自動登録の状況を見えるように)（M）

自動登録の状況を見えるように

- 状態: 未着手 ／ ブランチ: `feature/autoreg-visibility` ／ マージのコミット: （未）

- [ ] `permissionNotice` を作り、3 か所で使う（テストを先に）
- [ ] `state.auto.stoppedAt` と短い文
- [ ] 許可されなかったときのトースト
- [ ] `attention.js`（題名・ファビコン）とテスト、テストの偽の DOM の拡張
- [ ] レールの所持パルの「!」
- [ ] 自動登録のトーストに「見る」
- [ ] 異常の通知の href
- [ ] `pendingSummary`・`discardPending` と設定の「登録待ち」の行（子を出さない）
- [ ] OPERATIONS.md:83 と release-notes

### 29. [settings](phase-2-structure.md#settings-設定の整理)（M）

設定の整理

- 状態: 未着手 ／ ブランチ: `feature/settings` ／ マージのコミット: （未）

- [ ] `downloadBlob` を `ui/dom.js` に移し、2 つの CSV で使う
- [ ] カードの並び替え・「データの状態」の削除・見出し「データ」
- [ ] 整合性の警告を 0 件で隠し、レールの設定にバッジ
- [ ] 書き出しカード（配合・所持パルの CSV）とワールドの行の CSV の削除
- [ ] アカウントカードの短縮とログアウトの確認文
- [ ] `device-data.js`（書き出し・検証・併合）とテスト（テストを先に）
- [ ] 「この端末のデータ」カードと `importMany`・`importGoals`
- [ ] 状態の dl の削減・役割のチップ・ワールドの行の表記・summary の外のボタン
- [ ] 登録モーダルの結果欄の固定の高さと実際のパス
- [ ] 左寄せと最下部の権利表記・版、ログイン画面の権利表記
- [ ] テストの書き換え（views・owned-view・app）と release-notes・OPERATIONS.md

### 30. [roles](phase-2-structure.md#roles-役割ごとの案内とワールドの登録)（M）

役割ごとの案内とワールドの登録

- 状態: 未着手 ／ ブランチ: `feature/roles` ／ マージのコミット: （未）

- [ ] `roleSummary` とテスト（3 役割・10 分の境目）
- [ ] 設定のホスト・参加者のワールドの行、所持パルの案内、ヘッダーのポップオーバーで使う
- [ ] 名前が合わないときの 1 行
- [ ] プレイヤーの対応を独立した欄に（owned-settings.js の中、ホストだけ）と「登録待ち」の移動
- [ ] 呼び名「プレイヤーの対応」に統一（設定・理想個体・通知・OPERATIONS.md）
- [ ] 理想個体の「未確認」の理由を 1 回だけ
- [ ] 登録モーダル: 開き方の 1 行と［コピー］、パスの判定の文、等幅をやめる
- [ ] 登録モーダル: 背景で閉じない・全体をドロップ先・window の drop を止める
- [ ] 登録モーダル: 2 組のチェックリストと参加のときの表示、「登録して連携」
- [ ] モックの `as=viewer` とテスト
- [ ] テストの書き換え（owned-view・auto-register・ideal-view・mock-api）と release-notes・OPERATIONS.md

### フェーズ 2 の終わり

詳細: [phase-2-structure.md の該当の節](phase-2-structure.md#フェーズ-2-の完了の条件全テーマを終えたとき)

- [ ] レールのタブが 5 本（配合を探す／継承ルート／所持パル／理想個体／設定）。ヘッダーに「＋ 登録」がない
- [ ] 旧 URL（`#/reverse?c=X`・`#/list`・`#/drafts`・`#/wishlist`）を開くと、履歴を増やさずに統合後の画面に着く（ブックマーク・保存済みの通知の href も同じ）
- [ ] 旧ウィッシュリストのデータがある状態で起動すると目標に移り、既読と通知が引き継がれる。繰り返し起動しても同じ結果。100 件を超える分は「未移行」として残り、移行元は消えない
- [ ] 旧コードのタブ（フェーズ 1 の版）を開いたまま新しい版を開いても、下書きの性別・目標の観測の状態・移行の記録が消えない
- [ ] 設定から「データの状態」「通知」カードが消え、「書き出し」「この端末のデータ」がある。プロジェクトの CLAUDE.md:16 と `ui/notifications.js` の記述が直っていて、変更記録がある
- [ ] `docs/OPERATIONS.md`・`README.md` のタブ名・手順の記述を新しい構成に合わせた
- [ ] `npm test`・`npm run test:perf` が通る。計測の取り直し（一覧で並べ替え・登録モーダルで親・子を選ぶ・下書きの一括登録）
- [ ] 観点別のエージェントと Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
- [ ] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）

---

## フェーズ 3: ドロワーと横断の導線

詳細: [phase-3-4-drawer-data.md](phase-3-4-drawer-data.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 31. [drawer](phase-3-4-drawer-data.md#drawer-右のサイドドロワー土台)（M）

右のサイドドロワー（土台）

- 状態: 未着手 ／ ブランチ: `feature/drawer` ／ マージのコミット: （未）

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

### 32. [pal-detail](phase-3-4-drawer-data.md#pal-detail-パル詳細を種族のハブに)（M）

パル詳細を種族のハブに

- 状態: 未着手 ／ ブランチ: `feature/pal-detail` ／ マージのコミット: （未）

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

### 33. [owned-detail](phase-3-4-drawer-data.md#owned-detail-所持パルの個体の詳細をドロワーで)（S）

所持パルの個体の詳細をドロワーで

- 状態: 未着手 ／ ブランチ: `feature/owned-detail` ／ マージのコミット: （未）

- [ ] `web/js/ui/owned-detail.js` に `ownedDetail(context, instanceId, { terms })` を書く
- [ ] 中身（アイコン・名前・Lv・★・個体値の 4 セル・パッシブと説明・スキル・属性・場所の図・リンク）
- [ ] キーワード一致の全文（`keywordNotes` の全部）
- [ ] 行の操作に「詳細」を足し、パッシブ・個体値・場所のセルのクリックでも開く（委譲・文字選択中は除く）
- [ ] 開いている行の `aria-current` と背景
- [ ] 読み直しで同じ個体を引き直す・いなければ案内
- [ ] ドロワーの中身の表に `owned` を足す
- [ ] テスト（owned-detail・owned-view）
- [ ] OPERATIONS.md と release-notes

### 34. [farm-data](phase-3-4-drawer-data.md#farm-data-牧場のタマゴを残して共有する牧場の表示の土台)（M）

牧場のタマゴを残して共有する（牧場の表示の土台）

- 状態: 未着手 ／ ブランチ: `feature/farm-data` ／ マージのコミット: （未）

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

### 35. [farm-board](phase-3-4-drawer-data.md#farm-board-配合牧場ボード牧場の印孵化待ちのタマゴ)（M）

配合牧場ボード・牧場の印・孵化待ちのタマゴ

- 状態: 未着手 ／ ブランチ: `feature/farm-board` ／ マージのコミット: （未）

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

### 36. [route-progress](phase-3-4-drawer-data.md#route-progress-継承ルートの進み具合と横断の導線)（M）

継承ルートの進み具合と横断の導線

- 状態: 未着手 ／ ブランチ: `feature/route-progress` ／ マージのコミット: （未）

- [ ] 全部持つ個体がいないときのパッシブごとの経路と「理想個体で合わせる」（R-30）
- [ ] 理想個体の `renderMissing` の文言に最短の回数と開始を添え、運べないものは文字だけ（R-32）
- [ ] `annotateFor` に「牧場に配置中」「タマゴあり」（R-33）
- [ ] `routeView` に `progress`（✓ と次の段）と `summary`（相手親 未所持 n/m 段）（R-34・F032）
- [ ] 相手親の注記をチップにし、`species` のドロワー（`web/js/ui/species-owned.js`）
- [ ] 継承ルート ⇄ 理想個体の明示のリンク（I-58）
- [ ] 配合を探すの「▸ この親の配合 n 件」（2 段・同じ種族で止める・viewState）（F015）
- [ ] テスト（route-view・owned-view・ideal-view・find-merge）と期待値の更新
- [ ] OPERATIONS.md と release-notes

### 37. [goals-detail](phase-3-4-drawer-data.md#goals-detail-目標の一覧の詳細と所持パルの種族のまとまり)（M）

目標の一覧の詳細と、所持パルの種族のまとまり

- 状態: 未着手 ／ ブランチ: `feature/goals-detail` ／ マージのコミット: （未）

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

### フェーズ 3 の終わり

- [ ] `npm test`・`npm run test:perf`（20,000 行・偏った分布を含む）が通る
- [ ] 計測の取り直し: 配合検索 → パル詳細（scrollY=500）が「ドロワーで開き、本文はそのまま」になった。ヘッダー／パネル／候補／トースト／ダイアログ／ドロワーの重なり
- [ ] 古い共有データ（新しい項目のないもの）・旧コードのタブが混ざった状態から起動して壊れない
- [ ] GAS の反映をユーザーに依頼した: farm-data（`npm run gas:push` のみ）・farm-board（`eggItemId` の列 → `setup()`）
- [ ] 観点別のエージェントと Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
- [ ] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）

---

## フェーズ 4: セーブ情報・ゲーム素材・新機能

詳細: [phase-3-4-drawer-data.md](phase-3-4-drawer-data.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 38. [game-assets](phase-3-4-drawer-data.md#game-assets-ゲームの-ui-アイコンと作業適性を取り込む)（L）

ゲームの UI アイコンと作業適性を取り込む

- 状態: 未着手 ／ ブランチ: `feature/game-assets` ／ マージのコミット: （未）

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

### 39. [save-extras](phase-3-4-drawer-data.md#save-extras-セーブから読める追加の情報入手時刻お気に入り接続中の仲間dayケーキの残りほか)（M）

セーブから読める追加の情報（入手時刻・お気に入り・接続中の仲間・Day・ケーキの残りほか）

- 状態: 未着手 ／ ブランチ: `feature/save-extras` ／ マージのコミット: （未）

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

### 40. [implants](phase-3-4-drawer-data.md#implants-パル手術台とインプラントパルリバーサー)（L）

パル手術台とインプラント・パルリバーサー

- 状態: 未着手 ／ ブランチ: `feature/implants` ／ マージのコミット: （未）
- ideal-calc の後の形で書き直した（2026-10-12。README の「3-6」の末尾。D9〜D17）

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

### 41. [paldex](phase-3-4-drawer-data.md#paldex-パルの図鑑pal-の格子)（M）

パルの図鑑（`#/pal` の格子）

- 状態: 未着手 ／ ブランチ: `feature/paldex` ／ マージのコミット: （未）

- [ ] `web/js/views/paldex.js` と、`views/pal.js` の ID なしの分岐
- [ ] 見出し・「子として登録 N / 298」・絞り込み（viewState）
- [ ] 格子（48px 固定・lazy・件数・影・点・星・`syncList` で印だけ更新）
- [ ] `palIcon(pal, { silhouette })` と CSS の filter（ライト・ダークの濃さの調整）
- [ ] パル詳細に「図鑑」のリンク
- [ ] `check-save --probe` で RecordData を確かめる
- [ ] 捕獲数の読み取り（PLAYER_SKIP・parsePlayer・失敗しても続く）と自分の分の表示
- [ ] テスト（paldex・save）と性能の計測
- [ ] SAVE_FORMAT.md・OPERATIONS.md・release-notes

### フェーズ 4 の終わり

詳細: [phase-3-4-drawer-data.md の該当の節](phase-3-4-drawer-data.md#フェーズ-34-の終わりにすること)

- [ ] `npm test`・`npm run test:perf` が通る
- [ ] 実セーブで確かめた項目を `docs/SAVE_FORMAT.md` に書いた。取り込んだ画像の権利表記と撤回の手順を `data/SOURCES.md` に書いた
- [ ] GAS の反映をユーザーに依頼した: save-extras（入手時刻・お気に入りの列、Day を共有するならワールドの列 → `setup()`）
- [ ] 観点別のエージェントと Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
- [ ] 全体の最終報告（変更したファイル・実行したコマンド・画面の確かめ方・残した課題）

---

## 任意（ユーザーが採ると決めたものだけ）

詳細: [phase-3-4-drawer-data.md](phase-3-4-drawer-data.md) の「任意の項目」。採らないと決めたら、見出しの下に「採らない（日付）」と書く。合計の数には入れていない。

### [optional-goal-share](phase-3-4-drawer-data.md#optional-goal-share-目標を仲間と共有するf047)

目標を仲間と共有する（F047）

- 状態: 未決定 ／ ブランチ: `feature/optional-goal-share` ／ マージのコミット: （未）

- [ ] ユーザーに採るかと共有する項目を確かめる
- [ ] GAS のシートと 3 つの操作・検証
- [ ] api.js・開発用 API
- [ ] 目標の一覧に「仲間の目標」の群
- [ ] 仲間の目標の通知
- [ ] テスト（gas・mock-api・ideals）
- [ ] OPERATIONS.md・release-notes・GAS の反映の依頼

### [optional-undo](phase-3-4-drawer-data.md#optional-undo-元に戻すを-8-秒にctrlzf085)

元に戻すを 8 秒に・Ctrl+Z（F085）

- 状態: 未決定 ／ ブランチ: `feature/optional-undo` ／ マージのコミット: （未）

- [ ] ユーザーに採るかを確かめる
- [ ] 操作つきのトーストを 8 秒・カウントダウンの CSS
- [ ] Ctrl+Z の受け付け（入力欄・変換中・モーダルは除く）
- [ ] 確認の文の秒数
- [ ] テスト（app・toast）
- [ ] OPERATIONS.md・release-notes

### [optional-empty-art](phase-3-4-drawer-data.md#optional-empty-art-空の状態の線画f086)

空の状態の線画（F086）

- 状態: 未決定 ／ ブランチ: `feature/optional-empty-art` ／ マージのコミット: （未）

- [ ] ユーザーに採るかと絵柄の方針を確かめる
- [ ] 線画 4 種を SVG で描く
- [ ] `empty()` に線画の引数と 4 画面への適用
- [ ] SOURCES.md の使い分けの表
- [ ] テストと release-notes

### [optional-route-graph](phase-3-4-drawer-data.md#optional-route-graph-継承ルートの横の経路図f033)

継承ルートの横の経路図（F033）

- 状態: 未決定 ／ ブランチ: `feature/optional-route-graph` ／ マージのコミット: （未）

- [ ] ユーザーに採るかを確かめる
- [ ] 候補ごとの 1 行の横の図（アイコン・相手親・所持の点）
- [ ] ノードを押すと段のカードへ移る
- [ ] テスト（カードの数は変わらない）
- [ ] OPERATIONS.md・release-notes

---

## 次にやること

- **フェーズ 1b の 1 番目 talent-target から**（[phase-1b-1c-ideal-owned.md](phase-1b-1c-ideal-owned.md) の冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）。フェーズ 1a は 2026-10-13 に済ませ、報告した。下の「ユーザーに確かめ中」の答えを先に反映する。
- ユーザーに確かめ中（フェーズ 1a の終わりの報告で聞いた。答えを受けたらここを直す）: (1) 拡大 150%（1100px の窓で中身 733px）では body の min-width 920px のため横スクロールが出て、登録と ID が右外に出る。今の制約のままでよいか。(2) ログイン画面のヘッダーの同期状況は、押せないボタンとしてログインのエラーの文も出る（エラーはフォームにも出ている）。ログイン画面では隠すか、今のままか。 (3) 所持パル 20,000 行で同じ種族が 6 割（3,700 万組）だと、理想個体の計算の合計が約 7 秒かかる（レビューの直しの後。前は約 12 秒。画面は止まらず「計算中」が続く）。D18 の『合計が 5 秒を超えたら Worker を検討』に当たる。Worker にするか（import の制限と data/SOURCES.md の変更が要る）、このままか。(4) `npm run test:perf` は PC の負荷で、区切りの最大（上限 50ms）が 48ms、20,000 行の検証（上限 200ms）が 191ms まで来ることがあり、落ちるおそれがある。(5) 理想個体・継承ルートのパッシブの欄は横に半分の幅（幅 1100px で 463px）なので、3 個目のチップで 2 行になり、下の欄が 1 回だけ 38px 下がる（1・2・4 個目は動かない。所持パルは 4 個とも 1 行）。今のままか、2 行分の高さを取る・欄を広げる・チップを小さくするか（phase-1a の popovers の「実装の記録」11）。
- 進め方（2026-10-12 のユーザーの回答）: ドキュメントのとおり（D1〜D19・3-3・3-7 の既定の扱い）。各テーマは `feature/<key>` でコミットし、`main` へ `--no-ff` でマージまで進める（push はしない）。**フェーズの終わりにまとめて報告する（2026-10-12 に変更）**。Codex はレビューにも実装にもフル活用してよい（読み込ませる情報に制限なし）。
- 気づいたこと: (1) Codex は Skill ツールから呼ぶと権限の確認で止まる。`bash ~/.claude/skills/delegate-codex/codex-delegate.sh --stdin` に JSON（`mode`・`timeout_s`・`project_dir`・`task`）を渡して Bash で直接呼ぶ。Codex の中ではシェルが起動しないが、node_repl で読み取り・テスト・計算はできる。(2) モックの配合は `Math.random` なので、計測では配合のある親を選び直す。(3) `npm run test:perf` は PC の負荷で 1.5〜2 倍揺れる。前後を比べるときは `git stash` で続けて測る。(4) 画像の 4 体の画面の確認は `Claude outputs/ui-audit-2026-10/shots/owned/inject-kabuki.js`・`check-kabuki.js`。(5) モックは読み込み直すとユーザーを作り直すので、配合のキャッシュから起動した後の全件取得で USER_NOT_FOUND になりログイン画面に戻る（キャッシュの読み出しを確かめるときは、読み込み直した直後の描画を記録する）。(6) core/ の中のファイルには、コメントでも `localStorage`・`window`・`document`・`fetch`・`api.js`・`store.js` の語を書かない（test/core/shared.test.js の静的検査）。(7) 性能の予算の注入は `Claude outputs/ui-audit-2026-10/shots/owned/inject-rows-2000.js`・`inject-rows-20000.js`（inject.js の写し。画面に出る行がちょうどその数）。ログイン画面ではヘッダーの同期状況のボタンにもエラーの文が出るので、playwright で「新規登録」を押すときは `exact: true` にする。JS ヒープは CDP の `HeapProfiler.collectGarbage` の後に `Runtime.getHeapUsage` で測った。
- 最終更新: 2026-10-13（セッション `300704ce`。フェーズ 0・フェーズ 1-0（ideal-calc）・フェーズ 1a（7 テーマとレビューの直し）を済ませた。ideal-calc のレビューで D19 を足した）
