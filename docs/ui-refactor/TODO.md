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
| 1a | 7 | 96 | 7 |
| 1b | 4 | 45 | 4 |
| 1c | 3 | 44 | 3 |
| 1d | 6 | 74 | 6 |
| 2 | 10 | 119 | 10 |
| 3 | 7 | 79 | 0 |
| 4 | 4 | 49 | 0 |
| 任意 | 4 | 23 | — |
| **合計** | **42＋任意 4** | **532＋任意 23** | **31** |

TODO の数は、テーマの TODO とフェーズの終わりの作業の合計（1b と 1c の終わりの作業はまとめて 1c の行に数えた）。2026-10-12 に、理想個体の計算の修正（フェーズ 1-0 の ideal-calc。README の「2-8」）を足し、implants のパルリバーサーの項目を 2 つに分けた（D17）。

## フェーズ 0: 準備

統合プランのフェーズ 0 の「調査結果の書き出し」「計測の手順を置く」は、このドキュメントを作るときに済ませた（付録と `Claude outputs/ui-audit-2026-10/`）。残りは確認と基準の再現。

- [x] 0-1. **着手の合意**: README の「3-1 決定事項」「3-7 実装前・実装中にユーザーに確かめる点」を短く示し、このドキュメントのとおりに実装へ進めてよいか、ユーザーの合意を得る（統合プランは承認のダイアログで明示的には承認されていない。README の「2-6」）。フェーズ 1-0 の ideal-calc は、ユーザーが「内容は承認済み」と答えている（README の「2-8」）ので、合意を取り直さない（済: 2026-10-12、セッション `300704ce`。「ドキュメントのとおり（D1〜D18・3-3・3-7 の既定の扱い）」で合意。あわせて、各テーマは `feature/<key>` でコミットし `main` へ `--no-ff` でマージまで進めてよい（push はしない）、止まって報告する単位はテーマごと、と答えた）
- [x] 0-2. **`.gitignore` の扱いを確かめる**（済: 2026-10-12、セッション `c342c7a9`。ユーザーの判断で `.mso/`・`.playwright-cli/`・`Claude outputs/` を `.gitignore` に足し、ブランチ `docs/ui-refactor-plan` で単独のコミットにして `main` にマージした。経緯は README の「8-2」）
- [x] 0-3. **`docs/ui-refactor/` をコミットするかを確かめる**（済: 2026-10-12、同じセッション。公開リポジトリなので、ユーザー名を含むパス・Steam ID・ワールドの ID を伏せてからコミットし、`main` にマージした。push はしていない）。以後も、どのブランチでも `git add -A`・`git add .` を使わない
- [x] 0-4. **Codex の利用を確かめる**: フェーズ末のレビューで Codex（読み取り専用）を使ってよいか、目的を説明して許可を得る（プロジェクトの CLAUDE.md・グローバルの規約）。使う前に、シェルが起動するかを小さく試す（この環境では起動に失敗したことがある）（済: 2026-10-12。ユーザーの回答は「積極的にフル活用して良い。読み込ませる情報に制限もない。」。レビューも実装の委譲も、テーマごとに許可を取り直さなくてよい。Skill ツールからの呼び出しは権限の確認で止まったので、`bash ~/.claude/skills/delegate-codex/codex-delegate.sh --stdin` を Bash で直接呼ぶ）
- [x] 0-5. **コードが調査のときのままか確かめる**: `git diff ad648b7 --stat -- web/ test/` が空か（2026-10-12 に文書と `.gitignore` をコミットしたので、`git log -1` は `ad648b7` ではない。web/・test/ は変えていない）。変わったファイルがあれば、該当するテーマの文書の file:line を開き直す前提で進める（済: 2026-10-12。空だった。HEAD は `ba99101`）
- [x] 0-6. **付録とスクリーンショットを確かめる**: `docs/ui-refactor/appendix/` の 7 本（catalog・rejected・measurements・codex-reviews・other-session-plan・plan-snapshot・ideal-calc-plan）が開ける。`Claude outputs/ui-audit-2026-10/shots/{find,record,owned}/` に PNG（計 110 個）と `owned/inject.js`・`owned/inject2.js`・`owned/measure.js`・`record/measure.js`・`find/init-goto.js` がある（済: 2026-10-12。7 本と PNG 110 個（find 37・record 39・owned 34）、スクリプト 5 本がある）
- [x] 0-7. **テストの基準**: `npm test` と `npm run test:perf` が、何も変えていない状態で通ることを確かめ、`test:perf` の値を phase-1a-foundation.md の「計測の記録」に書く（この値が、ideal-calc の「変える前の値」になる）（済: 2026-10-12。`npm test` 1,024 件・`test:perf` 3 件が通った。値は計測の記録）
- [x] 0-8. **基準の計測を再現する**: `npm run dev` → `http://localhost:5173/?mock=1&seed=80`（新規登録で入る）→ 所持パルは `Claude outputs/ui-audit-2026-10/shots/owned/inject.js` で注入（手順は appendix/measurements.md の「モックでの再現の仕方」）。README「7-2」の表のうち 2 行以上（例: 配合検索で親を選ぶと 27px 下がる・ヘッダー scrollY=800 でベルが画面外）を同じ値で再現できることを確かめ、計測の記録に書く。終わったらブラウザと開発サーバを止める（済: 2026-10-12。2 行を同じ値で再現した（計測の記録）。注意: モックの配合は `Math.random` で作るので、seed が同じでも中身は毎回変わる。撮影のときの「ソルレイス」に配合があるとは限らないので、一覧の先頭の配合の親を選んで測った）
- [x] 0-9. **次にやることを更新する**: 下の「次にやること」を「フェーズ 1-0 の ideal-calc」に書き換える（済: ideal-calc に入った。今の状態は末尾の「次にやること」）

---

## フェーズ 1-0: 理想個体の計算の修正

詳細: [phase-1-0-ideal-calc.md](phase-1-0-ideal-calc.md)（冒頭の「このフェーズの目的」「コードで確かめた結果」と、末尾の「後のテーマへの申し送り」を先に読む）。フェーズ 0 の後、フェーズ 1a より前に入れる。

### 0. [ideal-calc](phase-1-0-ideal-calc.md#ideal-calc-両親合わせてパッシブがそろう組も完全体作成組にし交換推奨と変更ありを全体の速さの目安で決める)（L）

両親合わせてパッシブがそろう組も完全体作成組にし、交換推奨と「変更あり」を全体の速さの目安で決める

- 状態: 済 ／ ブランチ: `feature/ideal-calc` ／ マージのコミット: `f4375c9`
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

- 状態: 済 ／ ブランチ: `feature/inv2-notice` ／ マージのコミット: `4655987`
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

- 状態: 済 ／ ブランチ: `feature/render-contract` ／ マージのコミット: `55b54f3`
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

- 状態: 済 ／ ブランチ: `feature/data-boundary` ／ マージのコミット: `422bd53`
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

- 状態: 済 ／ ブランチ: `feature/header-frame` ／ マージのコミット: `72cd9ee`
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

- 状態: 済 ／ ブランチ: `feature/stable-render` ／ マージのコミット: `c40bcee`
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

- 状態: 済 ／ ブランチ: `feature/keep-state` ／ マージのコミット: `46875ef`
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

- 状態: 済 ／ ブランチ: `feature/popovers` ／ マージのコミット: `5f031e6`
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

- 状態: 済（2026-10-13）。レビューの直しは `fix/phase-1a-review-nav`（マージ `20b468f`）と `fix/phase-1a-review-render`（マージ `5358f2f`）。指摘は Codex 7 件・観点別のエージェント 3 体（遷移と状態 6 件・データとヘッダー 7 件・描画と部品 8 件）・計測と画面の確認 4 件で、重なりを除いた 26 項目のうち 25 項目を直した（直さなかった 1 件: 手元のセーブのプレイヤーを 100 人で切る。Palworld のサーバの上限は 32 人で、共有も前から 100 人で切っているため）。直したことは phase-1a-foundation.md の各節の「実装の記録」、計測は「計測の記録」の 2026-10-13 の行

- [x] `npm test`・`npm run test:perf` が通る（1,246 件・7 件）
- [x] 計測の取り直し（[phase-1a の「フェーズ 1a の終わりにすること」](phase-1a-foundation.md#フェーズ-1a-の終わりにすること)の表: 配合検索で親を選ぶ・パッシブを足す・所持パルの行・フォーカス・ヘッダー・パル詳細・一覧の並べ替え）。値は[計測の記録](phase-1a-foundation.md#計測の記録実装した人が書き足す)に書く
- [x] ブラウザでしか確かめられないこと（戻る／進む・日本語変換中の入力・候補を開いたままの同期・20 秒の更新・幅 920px／1100px・拡大 125〜150%・ヘッダー／候補／トースト／ダイアログの重なり・許可の要求）
- [x] 新旧データの混在（古い IndexedDB・古い共有データ・旧本文の通知・古い sessionStorage・旧コードのタブ）から起動して壊れない
- [x] 観点別のエージェントと Codex（読み取り専用。使う前に許可・シェルが動くか小さく試す）で差分をレビューし、直した
- [x] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）

---

## フェーズ 1b: 理想個体

詳細: [phase-1b-1c-ideal-owned.md](phase-1b-1c-ideal-owned.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 8. [talent-target](phase-1b-1c-ideal-owned.md#talent-target-個体値の目標をチェックつき空欄条件なしに)（S）

個体値の目標を「チェックつき・空欄＝条件なし」に

- 状態: 済（2026-10-13） ／ ブランチ: `feature/talent-target` ／ マージのコミット: `09cf920`
- 順番: 統合プランの表では ideal-panel の後。ideal-panel で今の入力欄を動かした後に部品へ差し替える手戻りをなくすため、先にした（phase-1b-1c の「テーマの順番」。逆でも成り立つ）

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

### 9. [ideal-panel](phase-1b-1c-ideal-owned.md#ideal-panel-理想個体の条件を-sticky-の-2-段パネルに)（M）

理想個体の条件を sticky の 2 段パネルに

- 状態: 済（2026-10-13） ／ ブランチ: `feature/ideal-panel` ／ マージのコミット: `e43126d`
- 文書と違う形にしたこと: ユーザーの決定 D20（所持の状況を 2 段目の右端へ・パッシブのチップは改行してパネルが伸びる・`max-height` なし）。高さは 1100px・パッシブ 0 個で 140.4px（130px を超えた）。保存済みのボタンは disabled ではなく aria-disabled、計算のしくみは先に「?」のダイアログへ移した（中身は 14 項目のまま）（phase-1b-1c の ideal-panel の「実装の記録」）

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

### 10. [ideal-results](phase-1b-1c-ideal-owned.md#ideal-results-要約数値説明を短くそろえ組の親で達否を見せる)（M）

要約・数値・説明を短くそろえ、組の親で達否を見せる

- 状態: 済（2026-10-13） ／ ブランチ: `feature/ideal-results` ／ マージのコミット: `39e969a`
- ideal-calc の後の形で書き直した（2026-10-12。README の「3-6」の末尾。D9〜D17）
- 文書と違う形にしたこと: `hint` に `close()` を足し、外側を押して閉じたときはフォーカスを戻さない（popover.js の決まり）。要約は `div.result-note.ideal-summary`、所持者が自分の個体のときは「 · 自分の個体」。読めなかった確認では最終確認を進めない。計算のしくみは「条件のある各ステータス」と ideal-calc の文。畳みは間に畳まない組が入ったら分け、理由は summary の中。強調は欲しいパッシブを選んだときだけ・個体値のセルは理想個体のカードだけで、差は値の下に小さく出す（phase-1b-1c の ideal-results の「実装の記録」）

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

### 11. [ideal-farms](phase-1b-1c-ideal-owned.md#ideal-farms-牧場の状態を残し牧場の判定を絵と押せる行に)（M）

牧場の状態を残し、牧場の判定を絵と押せる行に

- 状態: 済（2026-10-13） ／ ブランチ: `feature/ideal-farms` ／ マージのコミット: `a858567`
- 直し: `fix/ideal-farms-collapse`（D22。帯の下の詳細を既定で閉じた 1 行にし、開閉は覚える。閉じている間は目標・判定が変わっても結果の top が動かない。phase-1b-1c の ideal-farms の「実装の記録」15）
- ideal-calc の後の形で書き直した（2026-10-12。README の「3-6」の末尾。D9〜D17）
- 文書と違う形にしたこと: 牧場の名前・完全性・使用中・空きは描くときのデータから求める（`farmContext`）。`farmCompleteness` の uncertain は判定に使えない牧場の数。帯は固定の 3 か所＋「ほか n か所」、置く組のない牧場は一覧にあれば「— N 番」で押せる。詳細の個体は palTile ではなく絵・名前・個体値・パッシブの小さな形。フォーカスは押したボタンに残す。帯の高さは固定だが、帯の下の詳細の高さは判定で変わる（結果の top はアヌビスで 806px。ユーザーに確かめる）（phase-1b-1c の ideal-farms の「実装の記録」）

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

---

## フェーズ 1c: 所持パル

詳細: [phase-1b-1c-ideal-owned.md](phase-1b-1c-ideal-owned.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 12. [owned-status](phase-1b-1c-ideal-owned.md#owned-status-読み込みの状態を固定スロットにデータ元を-1-行に)（M）

読み込みの状態を固定スロットに、データ元を 1 行に

- 状態: 済（2026-10-13） ／ ブランチ: `feature/owned-status` ／ マージのコミット: `5433291`
- 文書と違う形にしたこと: `checkedAt` は読めた確認（unchanged・guest・imported）と共有の成功だけで進める。`activityText` に `now` を足した。`'empty'` も「設定でワールドを登録」の案内とボタンにした。確かめている間（busy・checking）は案内を前のまま描かない。状態のスロットは輪の場所を残した左寄せ（右寄せは layout-shift が出た）。許可のボタンの場所は自動の読み込みを使うときだけ残す。理想個体の要約の「最終確認」は 1 行のスロットに移し、`span.ideal-checked` ごと外した。「見る」は `changeRoute`。`linkLabel` を消した。継承ルートのテストは owned-view.test.js に置いた。参加者の反映は最大 約 41 秒（ユーザーに確かめる）（phase-1b-1c の owned-status の「実装の記録」）

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

### 13. [owned-toolbar](phase-1b-1c-ideal-owned.md#owned-toolbar-所持パルの絞り込みを-sticky-のパネルに)（M）

所持パルの絞り込みを sticky のパネルに

- 状態: 済（2026-10-13） ／ ブランチ: `feature/owned-toolbar` ／ マージのコミット: `c520c8a`（2,000 行のキーワード入力の Long Task は、ユーザーの判断〔D24〕で owned-rows の完了の条件へ移した）
- 文書と違う形にしたこと: パネルは 1 段目 [パル][パッシブ 1fr][キーワード]・2 段目 [所持者][場所][パッシブの条件][個体値＋「まとめて ▾」][★][属性 ▾]・状態の行（件数・条件のチップ・すべて解除・リンクをコピー・並べ替え・理想個体／継承ルートへ）にした（1100px・パッシブ 0 個で 172.39px。130px・理想個体の 140.4px より高い。ユーザーに確かめる）。「すべて 90 以上」「すべて 100」は 1 つのメニュー、属性 ▾ の中は選んだ数、O-40 のリンクの文は短く。URL の条件が来たら URL に無い条件は既定に戻す。拠点を選ぶとその拠点の個体とタマゴだけ。`ideals.selfUids()`・passiveSelector の `disabled`・ui/popover.js の focusOut の relatedTarget（理想個体の保存の板の「保存」を押しても保存されなかったのが直った。release-notes に別に 1 件）を足した。`.owned-toggle` は設定が使うので残した。2,000 行のキーワード入力で Long Task 81〜120ms（main も 126〜157ms）が残る（phase-1b-1c の owned-toolbar の「実装の記録」）

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

### 14. [owned-rows](phase-1b-1c-ideal-owned.md#owned-rows-列見出し4-セル固定枠で行の高さをそろえる)（L）

列見出し・4 セル・固定枠で、行の高さをそろえる

- 状態: 済（2026-10-13） ／ ブランチ: `feature/owned-rows` ／ マージのコミット: （未）
- 文書と違う形にしたこと: `OWNED_SORTS` は `[キー, 名前, 既定の向き, 反対の向きの名前]`、向きは `filter.dir`（URL の `dir`）。並べ替えの選択は「個体値の合計が低い順」を残し、見出しで選んだ反対の向きは選んでいる間だけ選択に足す。行は 80px に固定し、キーワードの理由の 1 行をいつも取る（中身は上にそろえる）。★は文字 1 要素（☆ は CSS の data-off）、6×5 の図も要素 1 つ、パッシブはセルそのものを 2×2 の grid に（1 行 33 要素）。すぐ書き換える既にある行は 200 → 60 行（`FILL_NOW`）。行の操作のリンクは `ownedRowLinks(pal)`。目標の印の切り替えは状態の行（viewState の `showMarks`）。幅 1000px 以下は列を詰める（X-02 の一部。container query は使わない）。2,000 行の入力が止まる主な原因は先祖の `:has()`（`#app`・`body`・`.owned-list`）で、クラスに置き換えた（別のコミット）。playwright-cli のコマンドの後のスナップショットで DOM の出し入れが 3〜5 倍重くなることが分かり、計測は同じコマンドの中で行を作り直して測る形も足した（phase-1b-1c の owned-rows の「実装の記録」）

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

直し: `fix/phase-1bc-review-owned`（フェーズ 1b・1c の終わりのレビューの B1〜B14〔所持パル〕: 同じ種族の目標の印の計算・行の印を 1 個と「+N」・コピーの返事・変換中の入力・フォーカスと一覧の位置・条件のチップの「+n」・古い保存。中身は phase-1b-1c の owned-toolbar・owned-rows の「実装の記録」17）

直し: `fix/phase-1bc-review-ideal`（フェーズ 1b・1c の終わりのレビューの A1〜A15〔理想個体と共通・文書〕: 描き直しのフォーカス・保留が解けた後の「変更あり」・組へ移ったらカードへフォーカス・着地点・帯のセルの読み上げ・フォーカスの枠・所持者の名前とリンク・個体値の欄の名前・用語の揺れ〔並べ替えの名前・「全部持つ」〕・お知らせ・OPERATIONS.md・JS と CSS の値・テストと静的検査・150% のパッシブの板。中身は phase-1b-1c の ideal-panel・ideal-results の「実装の記録」13、ideal-farms の 16、owned-toolbar・owned-rows の 18）

### フェーズ 1b・1c の終わり

- 状態: 済（2026-10-13）。レビューの直しは `fix/phase-1bc-review-owned`（マージ `0c92401`）と `fix/phase-1bc-review-ideal`（マージ `1924c16`）。ユーザーの答えの反映は `fix/phase-1bc-answers`（マージ `856fca9`。D25〜D27。README の 3-1）。指摘は Codex 6 件・観点別のエージェント 3 体（安定性 7 件・互換 3 件・操作性 15 件）・計測 3 件で、重なりを除いた 31 項目のうち 29 項目（所持パル B1〜B14・理想個体と共通 A1〜A15）を直した。直さなかった 2 項目: 足りないパッシブの案内が出入りすると帯・結果が動く（利用者が自分でパッシブを足し外ししたときだけ。D20 と同じ考え方）、モーダルのダイアログを開いたまま裏のページがホイールでスクロールする（前からあり・全ダイアログ共通。「次にやること」の気づいたことに書いた）。互換の「パルボックスが 10,000 ページを超えると図と文字が食い違う」は実際には起きないので項目から外した。計測は phase-1a-foundation.md の「計測の記録」の 2026-10-13 の「フェーズ 1b・1c の終わり」の行

- [x] `npm test`・`npm run test:perf`（新しい `test/perf/owned.perf.js` を含む。2,000 行の予算）が通る
- [x] 計測の取り直し（[phase-1b-1c の「フェーズの終わりにすること」](phase-1b-1c-ideal-owned.md#フェーズの終わりにすること)の表: 所持パルでパッシブを足す・結果が減る絞り込み・行の高さ・理想個体のパッシブ追加・読み直しの帯）
- [x] ブラウザでしか確かめられないこと（日本語変換中の入力・パッシブの板を開いたままの 20 秒の更新・幅 920px／1100px・拡大 125〜150%・ヘッダー／パネル／牧場の帯／列見出し／ポップオーバー／トースト／ダイアログの重なり）（日本語変換中の入力は playwright で本物の IME を作れないので見ていない。変換中の矢印・Enter は B4 のテストで確かめた）
- [x] 観点別のエージェント（安定性・INV-2・セキュリティ・性能・テスト）と Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
- [x] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）（2026-10-13）

フィードバックの反映: `fix/phase-1bc-feedback`（D28。README の 3-1。所持パルの行の操作は「親にして検索」の 1 つ・パッシブ欄は改行してもプルダウンの右にそろえる・所持パルと理想個体のパネルの見出しと区切りをそろえる。中身は phase-1b-1c の ideal-panel の「実装の記録」14・owned-toolbar の 20・owned-rows の 20 と、phase-1a の popovers の「実装の記録」の D28）

2 回目のフィードバックの反映（所持パルと共通）: `fix/feedback2-owned`（D29。README の 3-1。データ元の 1 行・場所のチップの数・拠点の ▾・所持パルの行の操作をなくし、キーワードの理由を一致したすべての項目で出し、所持者の選択肢を自分のプレイヤー名にして既定を自分にした〔理想個体も〕。中身は phase-1b-1c の owned-status の「実装の記録」17・owned-toolbar の 21・owned-rows の 21・ideal-panel の 15。理想個体の結果の表示の分は別の担当が後で入れる → 下の D30）

2 回目のフィードバックの反映（理想個体）: `fix/feedback2-ideal`（D30。README の 3-1。数値の行・内訳の文・「同じ種族どうし」・個体値の差〔−N〕・要約の行・計算のしくみの「?」・「この目標の組を置いた牧場はありません」をなくし、ケーキ 3 通りを比べていちばん早いケーキの押しボタンに「最速」の印を付け、空き牧場の案内を所持者が自分のときも出す。中身は phase-1b-1c の ideal-panel の「実装の記録」16・ideal-results の 15・ideal-farms の 18）

所持パルの「リンクをコピー」をなくした: `fix/remove-copy-link`（D31。README の 3-1。2026-10-14 のユーザーの指示「機能自体不要」。ボタン・コピーできなかったときの板・クリップボードへの書き込み・`filterParams` を消し、URL の受け口〔`filterFromParams`・`migrateFilter`〕は残した。パネルの高さは変わらない。中身は phase-1b-1c の owned-toolbar の「実装の記録」22）

---

## フェーズ 1d: 小さく効く修正

詳細: [phase-1d-small-fixes.md](phase-1d-small-fixes.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 15. [participant-self](phase-1d-small-fixes.md#participant-self-参加者のこのワールドでの自分)（S）

参加者の「このワールドでの自分」

- 状態: 済（2026-10-14） ／ ブランチ: `feature/participant-self` ／ マージのコミット: `c634da9`（統合ブランチ `integrate/phase-1d` へのマージ）

- [x] `web/js/self-player.js` を作る（キー・get・set・reload・subscribe・saveFailed）とテスト
- [x] `ownPlayerUids` に `selfUid` を足し、コメントとテストを直す
- [x] `app.js` で self を作り、identity・context・storage イベント・renamer につなぐ
- [x] `ideals.js` の `judged` を mode にし、`identityChanged`・`identityKey` を足す（同じセーブ時刻・通知なしのテスト）
- [x] 設定に「このワールドでの自分」の行（作り直さない select・署名で描き直し）
- [x] 登録者の select の変更でも `identityChanged` を呼ぶ（推奨）
- [x] `settingsHash` と、設定の `applyRoute`・`reveal`（行を開く・フォーカス・URL から外す）
- [x] 理想個体の 2 か所の案内を「設定で選ぶ」ボタンに（ダイアログを閉じる）
- [x] 理想個体・所持パルを `context.self` の変化で描き直す（署名に `identityKey`）
- [x] 自動登録の unmapped の通知の行き先と、古い通知の読み替え
- [x] 名前の変更で self のキーを移す（`moveUserStorage`・`moveLocal`）
- [x] 期待値の変わるテスト（auto-register.test.js:235、ideal-view.test.js:493-505）を直す
- [x] release-notes に 1 件、モックで「完了の条件」を確かめる

### 16. [autoreg-success](phase-1d-small-fixes.md#autoreg-success-自動登録の成功を通知に残す)（S）

自動登録の成功を通知に残す

- 状態: 済（2026-10-14） ／ ブランチ: `feature/autoreg-success` ／ マージのコミット: `a141500`（統合ブランチ `integrate/phase-1d` へのマージ）

- [x] `cleanNotification` に kind・worldId・batchId を通す（`NOTIFICATION_KINDS`）とテスト
- [x] `groupNotifications` を作り、テストする
- [x] ベル（未読の数・パネル）と通知一覧をまとめ表示にする
- [x] `registeredNotice` を作り、登録が確定するごとに `saveNotices` で残す
- [x] `saveNotices` で成功 20 件・それ以外 50 件に分けて残す
- [x] 拠点名の引き方（なければ「配合牧場」）
- [x] 既存のテスト（auto-register.test.js:241・356・406・474）を直し、新しいテストを足す
- [x] release-notes に 1 件、画面で確かめる

### 17. [cleanup-dead-code](phase-1d-small-fixes.md#cleanup-dead-code-使われなくなったコードcss-の片付け)（M）

使われなくなったコード・CSS の片付け

- 状態: 済（2026-10-14） ／ ブランチ: `feature/cleanup-dead-code` ／ マージのコミット: `2ca4c29`（統合ブランチ `integrate/phase-1d` へのマージ）
- ideal-calc の後の形で書き直した（2026-10-12。README の「3-6」の末尾。D9〜D17）

- [x] ideal.test.js の idealPairs のテストを (a)(b)(c) に分け、一時スクリプトで値を比べてから idealPlan・直接の関数へ移す
- [x] ideal.perf.js を idealPlan だけにする
- [x] `core/ideal.js` の ORDERS・compare・compareGenerations・idealPairs を消す
- [x] `GOAL_ORDERS` と cleanGoal の order、画面の `order: 'next'` を消し、テストを直す
- [x] README.md:23 の理想個体の説明を直す
- [x] `core/route.js` の filterPartners・excludePartners・representative を消し、route.test.js を直す（views.test.js・router.test.js は残す）
- [x] `--md-sys-color-on-error-container` を定義し、定義の有無を確かめる静的テストを足す
- [x] 未使用の CSS を grep で確かめて消し、`.tab-symbol` の上書き・▸ の transition を直す
- [x] `empty()` とログイン画面の「◇」を消す
- [x] `storageWarning(what)` を作り、3 か所を置き換える
- [x] OPERATIONS.md に diag の 1 項目、README に強み、SOURCES.md に「作らない機能」、COMPARISON.md を書く
- [x] release-notes に 1 件

### 18. [copy-dead-ends](phase-1d-small-fixes.md#copy-dead-ends-見出し用語案内の行き止まり)（M）

見出し・用語・案内の行き止まり

- 状態: 済（2026-10-14） ／ ブランチ: `feature/copy-dead-ends` ／ マージのコミット: `8e01de9`（統合ブランチ `integrate/phase-1d` へのマージ）

- [x] `views/tabs.js`（`TABS`・`tabLabel`）を作り、app.js と全画面の見出しをそこから引く
- [x] パル詳細の h1 を「No.〈番号〉 〈名前〉」にし、hero の名前の重なりをなくす
- [x] 継承ルート・理想個体の h3 を h2 にし、CSS とテストを直す
- [x] README に表記の決まり、`test/static/wording.test.js` を作る
- [x] 表記ゆれ（産まれる・♂♀・＋・グローバルパルボックス・新しいバージョン・参加者・パッシブ・ID）を直す
- [x] ログイン画面の文を減らし、ラベル・エラー文・最初のフォーカスを直す
- [x] `setupHint` を作り、「設定タブの〜」を 1 文＋ボタンにする（owned.js:433 の文も）
- [x] ベルの空の文を「これまでの通知」ボタンに
- [x] `errorState`・`loadingState` を作り、`dataPending` で再試行を出す。読み込み中の文と句点をそろえる
- [x] `empty` にアイコンの枠を足し、5 か所に出す
- [x] 一覧・所持パル・配合検索・理想個体の 0 件に次の操作を付ける
- [x] 期待値の変わるテストを直し、新しいテストを足す
- [x] release-notes に 1 件、画面で確かめる

### 19. [delete-undo](phase-1d-small-fixes.md#delete-undo-トーストと削除元に戻すの決まり)（S）

トーストと、削除・元に戻すの決まり

- 状態: 済（2026-10-14） ／ ブランチ: `feature/delete-undo` ／ マージのコミット: `149e103`（統合ブランチ `integrate/phase-1d` へのマージ）

- [x] toast.js に時間の定数・kind・止める・閉じるボタン・閉じる動き・2 つのリストを入れる
- [x] toast.test.js を作る
- [x] トーストの位置（下中央）・エラーの見た目・残り時間の線の CSS を直す
- [x] スナックバーとの位置関係（`--snackbar-offset`）を決め、stable-render の幅の式を見直す
- [x] syncInBackground と操作の失敗のトーストを `kind: 'error'` にする
- [x] 配合の削除の確認を `leftParent` 付きにし、確認の文を定数から作る
- [x] drafts.js に `removeAll`・`restoreMany` を足す
- [x] 下書きの一括削除を確認なし＋元に戻すにし、drafts.test.js の 3 つのテストを直す
- [x] dialog.test.js の移し替えのテストが通ることを確かめる
- [x] release-notes に 1 件、画面で確かめる

### 20. [visual-parts](phase-1d-small-fixes.md#visual-parts-見た目の部品の統一)（M）

見た目の部品の統一

- 状態: 済（2026-10-14） ／ ブランチ: `feature/visual-parts` ／ マージのコミット: `3363c74`（統合ブランチ `integrate/phase-1d` へのマージ）

- [x] 性別の色のトークン（ライト・ダーク）と、styles.test.js の確かめ
- [x] `genderMark()` を作り、palTile と所持パルの人間の行を置き換える（理想個体の文は色だけ）
- [x] outline・属性チップ（`--element-chip`）・式の「＋」の色を直す
- [x] `.picker` の並び・ラベルの間隔・select の ∨・パッシブの × を直す
- [x] `statusChip()` を作り、8 種類の状態の印を置き換える（クラス名は残す）
- [x] 押せないボタンの見た目と `setDisabled()`、理由を出す 4 か所
- [x] `ui/icons.js` を作り、navIcon・actionIcon・ベルをそこから呼ぶ
- [x] 閉じる「×」4 か所を SVG に替え、テストを aria-label で探す形に
- [x] favicon.svg のダーク対応と、ロゴの「◇」を空にして aria-hidden
- [x] data/SOURCES.md に画像の作り方の表
- [ ] （任意）ロゴの描き直しをユーザーに確かめる（見送り: 2026-10-14。任意のため）
- [x] release-notes に 1 件、ライト・ダークで画面を確かめる

### フェーズ 1d の終わり

詳細: [phase-1d-small-fixes.md の該当の節](phase-1d-small-fixes.md#フェーズ-1d-の終わりのチェックリスト)

- 状態: 済（2026-10-15）。レビューの直しは `fix/phase-1d-review-notices`（マージ `0773bb5`）と `fix/phase-1d-review-self`（マージ `a451cd2`）。指摘は Codex 5 件・観点別のエージェント 3 体（安定性 4・互換 5・操作性 11）・計測 1 件で、重なりを除いた 24 項目。直したもの: 通知・下書き・トースト・文言・見た目の 12 項目（`fix/phase-1d-review-notices`）と、このワールドでの自分・設定の行き先・ID の変更の 12 項目（`fix/phase-1d-review-self`。うち 2 項目は文書の直し）。中身は phase-1d の「フェーズ 1d の終わりのレビューの直し」。直さなかったもの: キーボードでは 6 秒以内にトーストへ届きにくい件（任意の F085〔Ctrl+Z で元に戻す〕で解決する話）、wishlist.js の `restore` が消した時点のキーと今のキーが違っても戻す件（フェーズ 2 の goals-merge で目標に統合するときに直す）。計測は phase-1a-foundation.md の「計測の記録」の 2026-10-15 の「フェーズ 1d の終わり」の行。6 テーマとレビューの直しは統合ブランチ `integrate/phase-1d` へのマージで、main への反映はユーザーの確認の後（下の「次にやること」）

- [x] `npm test`・`npm run test:perf` が通る（`fix/phase-1d-review-self` で 1,498 件・性能 12 件）
- [x] `web/js/release-notes.js` に 6 件（各テーマ 1 件。新しい順・title 20 字・body 60 字以内）
- [x] シナリオ: 参加者として「このワールドでの自分」を選ぶと、登録済みの目標が「完成済み」になり、選んだ時点の完成は通知されない。その後の共有の更新で新しく完成した目標はベルに出る（計測の記録の 2026-10-15 の「シナリオ: 参加者の「このワールドでの自分」」の行）
- [x] プロジェクトの CLAUDE.md は変えていない（CLAUDE.md:16 の変更はフェーズ 2 の bell）（e11f91d からの差分に CLAUDE.md はない）
- [x] 観点別のエージェントと Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
- [x] フェーズ 1 全体の区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）（2026-10-15。ユーザーの確認を得て main を integrate/phase-1d〔4a5c375〕に進め、push した）

---

## フェーズ 2: 構成の整理（9 → 5 タブ）

詳細: [phase-2-structure.md](phase-2-structure.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 21. [find-merge](phase-2-structure.md#find-merge-配合を探すに統合)（L）

配合を探すに統合

- 状態: 済（2026-10-15） ／ ブランチ: `feature/find-merge` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）

- [x] `router.js` に `canonicalHash` と旧画面の表を足し、`startRouter` で replaceState する（テストを先に）
- [x] `core/kana.js` に `queryTerms`、`core/owned.js` の `keywordTerms` を委ねる
- [x] `core/record-search.js`（`searchRecords`・`groupRecords`・`registrantCounts`・`RECORD_SORTS`）とテスト
- [x] `breeding-card.js` に `omitChild`・`compactMemo`
- [x] `views/search.js` を条件帯＋件数の行＋一覧で作り直す（`applyRoute`／`update`、syncList）
- [x] 件数の行の文言（S-45）と子ごとの要約チップ（S-38）
- [x] 空の状態の 5 通りと、登録の初期値に子も渡す
- [x] NEW のチップと「新着 n 件」、増えた行を光らせる
- [x] `app.js` のタブ・import・ビューの対応、`nav-icons.js`、レールの区切りの CSS
- [x] `views/reverse.js`・`views/list.js`・`parentRows` を消し、使わない CSS を片づける
- [x] 旧画面へのリンク（route.js:196・wishlist.js:184・views/wishlist.js:52・自動登録の食い違いの通知）を新しい形に
- [x] keep-state の許可リストから旧画面名を外す
- [x] 既存テストの書き換え（views・app・router・wishlist・auto-register）
- [x] OPERATIONS.md・README.md の記述と release-notes

### 22. [owned-overlay](phase-2-structure.md#owned-overlay-配合の画面に所持数を重ねる)（M）

配合の画面に所持数を重ねる

- 状態: 済（2026-10-15） ／ ブランチ: `feature/owned-overlay` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）
- 順番: 統合プランの表では goals-merge の後（5 番目）。register-dialog の参照列と goals-merge の目標の行がここで作る集計を使うため、find-merge の直後に移した（phase-2 の「テーマの順番」）

- [x] `core/owned.js` に `canBeParent`・`ownedCounts`・`canPairRecord` とテスト
- [x] `ui/owned-badge.js`（親・子の表示、所持パルへのリンク）
- [x] `breedingEquation`／`breedingCard` に `annotate` を足す
- [x] 配合を探すで所持パルを購読し、カードに重ねる
- [x] 「両親を所持している組を上へ」「今の所持で作れる」の切り替えと URL
- [x] 継承ルートの相手親の注記を ♂♀ の数とリンクに
- [x] 「N 通り」の中の所持順の並べ替え（安定ソート）
- [x] 経路の見出しのバッジと、同じ回数の中の並べ直し
- [x] 開始候補の運び手を `canBeParent` で絞り、0 件のときの添え書き
- [x] 既存テストの文言の更新（owned-view・owned）
- [x] OPERATIONS.md:97 の継承ルートの規則と release-notes

### 23. [register-entry](phase-2-structure.md#register-entry-登録の入口と下書きの帯)（M）

登録の入口と下書きの帯

- 状態: 済（2026-10-15） ／ ブランチ: `feature/register-entry` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）

- [x] ヘッダーの「＋ 登録」と CSS を消す（テストを先に直す）
- [x] 配合を探すの文脈のボタン（全件・結果あり・0 件）
- [x] パル詳細の「この子の配合を登録」の強さを登録件数で変える
- [x] `ui/drafts-band.js` の帯（頭の行・中身・すべて登録・すべて削除）
- [x] 読み取り専用の下書きの行と syncList・フォーカスの移し先
- [x] `registerDrafts` を移し、`views/drafts.js` を消す
- [x] 配合を探すに帯を置き、`drafts=1` で開閉
- [x] `#/drafts` の読み替えとタブ・アイコン・keep-state の許可リスト
- [x] ショートカット N
- [x] drafts・app・views のテストの書き換えと release-notes

### 24. [register-dialog](phase-2-structure.md#register-dialog-登録モーダルの見直し)（M）

登録モーダルの見直し

- 状態: 済（2026-10-15） ／ ブランチ: `feature/register-dialog` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）

- [x] `ui/dialog.js` に `beforeClose`・`requestClose`・`initialFocus` と `confirmDialog` の `aria-describedby`（テストを先に）
- [x] 登録モーダルの基準の入力と「退避の対象」の判定
- [x] 下書きへの退避・失敗時にフォームを残す・トーストの「破棄」
- [x] `ui/gender-toggle.js` と、枠ごとの性別のリセット
- [x] `drafts.js` の性別のキー（読み・書き・比較・reload）
- [x] `saveDraft`・`prepare` で性別を通す
- [x] `user-rename.js` にオブジェクトのキーの移動を足す
- [x] 左右 2 列のレイアウトと固定の高さの確認の枠・参照列
- [x] 式の並び・高さの固定をやめる・登録者とメモを 1 行に
- [x] 最初の未選択の欄へのフォーカスとエラーの `aria-invalid`
- [x] ログイン画面の初期フォーカスと ID の maxLength
- [x] テスト（dialog・record-editor・drafts・user-rename・app）と release-notes

### 25. [goals-merge](phase-2-structure.md#goals-merge-ウィッシュリストを目標に統合)（L）

ウィッシュリストを目標に統合

- 状態: 済（2026-10-15） ／ ブランチ: `feature/goals-merge` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）

- [x] `speciesGoal`・`isSpeciesGoal`（`core/ideal-goals.js`）
- [x] `core/goal-observations.js`（形・1 件の判定・併合）とテスト
- [x] ideals ストアに観測のキー・観測・`observation(palId)`・add／remove／restore の連動
- [x] `goals-migration.js`（併合・上限・書く順番・読み戻し）とテスト（テストを先に）
- [x] 名前の変更で観測のキーを移す
- [x] 通知の元を `goalObservationSource` に（id は旧と同じ形・種族だけの目標がある種族だけ）
- [x] 目標の一覧の行（パルだけのタグ・配合・所持・呼び出す・外す）と空の状態
- [x] 移行が終わっていないときの 1 行と、旧ウィッシュリストの読み取り専用のダイアログ
- [x] `ui/goal-toggle.js` とパル詳細・配合を探すの空の状態
- [x] レールの「完成した目標 n」
- [x] `#/wishlist` の読み替え・タブ・ファイルの削除・`context.wishlist` の片づけ
- [x] 既存テストの書き換え（app・ideals・ideal-view・user-rename）と release-notes・OPERATIONS.md

### 26. [route-cleanup](phase-2-structure.md#route-cleanup-継承ルートの整理)（M）

継承ルートの整理

- 状態: 済（2026-10-15） ／ ブランチ: `feature/route-cleanup` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）

- [x] `arrange`・2 列の形・入れ替えボタンと CSS を消し、形を 1 つに（テストを先に）
- [x] 所持パルがないときの 1 行と「設定を開く」
- [x] 候補の一覧を消し、チップを 2 段に（並びの最後を図鑑順に）
- [x] 並びを「選択欄 → チップ → 経路 → 所持個体」に
- [x] `carrierList` を `ownedRow` に、「所持パルで開く」と「ほか N 体」
- [x] 常時の説明を最初の経路の見出しへ、41 字の案内を placeholder へ
- [x] 段の縦線と運ぶパッシブのチップ
- [x] 警告を「同じ組で別の子も登録あり」と「性別の向きは未確認」に分ける
- [x] 既存テストの書き換え（owned-view・views・route-view）と release-notes・OPERATIONS.md

### 27. [bell](phase-2-structure.md#bell-ベルと通知の整理)（M）

ベルと通知の整理

- 状態: 済（2026-10-15。プロジェクトの CLAUDE.md:16 の直しだけ未で、フェーズ 2 の報告で確認を取る） ／ ブランチ: `feature/bell` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）

- [x] `cleanNotification` に palId、`notificationCategory`（kind・worldId・batchId は autoreg-success のまま。テストを先に）
- [x] 各通知の元で palId を入れる（食い違いは親1）
- [x] 既読の保存先がない端末はお知らせを既読から始める
- [x] パネルの頭・チップ・「未読だけ」・行の部品・個別の既読・すべて既読
- [x] 「開いたら全部既読」をやめ、「すべての通知を見る →」と一覧のダイアログを同じ部品に
- [x] 赤い数字と点・aria-label・揺れ・`unreadCounts`
- [x] 設定の「通知」カードを消す
- [x] release-notes の本文の直し・ideal-alpha の削除・先頭のコメント・href
- [ ] プロジェクトの CLAUDE.md:16 と変更記録（拒否されたらユーザーへ）（**未。フェーズ 2 の報告で文案を示して確認を取る**）
- [x] 未設定の通知の行き先
- [x] テストの書き換え（notifications・app・views・auto-register）と release-notes

### 28. [autoreg-visibility](phase-2-structure.md#autoreg-visibility-自動登録の状況を見えるように)（M）

自動登録の状況を見えるように

- 状態: 済（2026-10-15） ／ ブランチ: `feature/autoreg-visibility` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）

- [x] `permissionNotice` を作り、3 か所で使う（テストを先に）
- [x] `state.auto.stoppedAt` と短い文
- [x] 許可されなかったときのトースト
- [x] `attention.js`（題名・ファビコン）とテスト、テストの偽の DOM の拡張
- [x] レールの所持パルの「!」
- [x] 自動登録のトーストに「見る」
- [x] 異常の通知の href
- [x] `pendingSummary`・`discardPending` と設定の「登録待ち」の行（子を出さない）
- [x] OPERATIONS.md:83 と release-notes

### 29. [settings](phase-2-structure.md#settings-設定の整理)（M）

設定の整理

- 状態: 済（2026-10-15） ／ ブランチ: `feature/settings` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）

- [x] `downloadBlob` を `ui/dom.js` に移し、2 つの CSV で使う
- [x] カードの並び替え・「データの状態」の削除・見出し「データ」
- [x] 整合性の警告を 0 件で隠し、レールの設定にバッジ
- [x] 書き出しカード（配合・所持パルの CSV）とワールドの行の CSV の削除
- [x] アカウントカードの短縮とログアウトの確認文
- [x] `device-data.js`（書き出し・検証・併合）とテスト（テストを先に）
- [x] 「この端末のデータ」カードと `importMany`・`importGoals`
- [x] 状態の dl の削減・役割のチップ・ワールドの行の表記・summary の外のボタン
- [x] 登録モーダルの結果欄の固定の高さと実際のパス
- [x] 左寄せと最下部の権利表記・版、ログイン画面の権利表記
- [x] テストの書き換え（views・owned-view・app）と release-notes・OPERATIONS.md

### 30. [roles](phase-2-structure.md#roles-役割ごとの案内とワールドの登録)（M）

役割ごとの案内とワールドの登録

- 状態: 済（2026-10-15。実機〔参加者の PC〕での参加者の文の確認だけ未） ／ ブランチ: `feature/roles` ／ マージのコミット: （統合ブランチ `integrate/phase-2` へのマージ。下の「次にやること」）

- [x] `roleSummary` とテスト（3 役割・10 分の境目）
- [x] 設定のホスト・参加者のワールドの行、所持パルの案内、ヘッダーのポップオーバーで使う
- [x] 名前が合わないときの 1 行
- [x] プレイヤーの対応を独立した欄に（owned-settings.js の中、ホストだけ）と「登録待ち」の移動
- [x] 呼び名「プレイヤーの対応」に統一（設定・理想個体・通知・OPERATIONS.md）
- [x] 理想個体の「未確認」の理由を 1 回だけ
- [x] 登録モーダル: 開き方の 1 行と［コピー］、パスの判定の文、等幅をやめる
- [x] 登録モーダル: 背景で閉じない・全体をドロップ先・window の drop を止める
- [x] 登録モーダル: 2 組のチェックリストと参加のときの表示、「登録して連携」
- [x] モックの `as=viewer` とテスト
- [x] テストの書き換え（owned-view・auto-register・ideal-view・mock-api）と release-notes・OPERATIONS.md

### フェーズ 2 の終わり

詳細: [phase-2-structure.md の該当の節](phase-2-structure.md#フェーズ-2-の完了の条件全テーマを終えたとき)

- 状態: 済（2026-10-15。ユーザーの確認を得て、プロジェクトの CLAUDE.md:16 を直し、main を統合ブランチ `integrate/phase-2` に進めて push した）。レビューの直しは `fix/phase-2-review-data`（マージ `d8e0e4b`）と `fix/phase-2-review-ui`（マージ `1e34eef`）。指摘は Codex 8 件・観点別のエージェント 3 体（安定性・互換・操作性）・計測で、重なりを除いた 31 項目。直したもの: データと振る舞いの 13 項目（`fix/phase-2-review-data`）と、画面と文言の 15 項目（`fix/phase-2-review-ui`）。中身は phase-2 の「フェーズ 2 の終わりのレビューの直し」。直さなかったもの: 通知の画像の `palId` を既存のキーにも保存している件（旧版のタブが書き戻すと画像が種類の記号に戻るだけ。互換の決まりの例外として記録）、旧版のタブで ID を変えるとこのフェーズで足したキーが前の ID に残る件（旧版のコードは直せない）、記録だけの 3 件（幅 920px の帯の折り返し・下書きの全部登録の layout-shift・登録モーダルの参照の列のリンク）。計測は phase-1a-foundation.md の「計測の記録」の 2026-10-15 の「フェーズ 2 の終わり」の行

- [x] レールのタブが 5 本（配合を探す／継承ルート／所持パル／理想個体／設定）。ヘッダーに「＋ 登録」がない（計測の `d-shots.js`。ライトとダーク）
- [x] 旧 URL（`#/reverse?c=X`・`#/list`・`#/drafts`・`#/wishlist`）を開くと、履歴を増やさずに統合後の画面に着く（ブックマーク・保存済みの通知の href も同じ）（app.test.js・router.test.js）
- [x] 旧ウィッシュリストのデータがある状態で起動すると目標に移り、既読と通知が引き継がれる。繰り返し起動しても同じ結果。100 件を超える分は「未移行」として残り、移行元は消えない（goals-migration.test.js・ideals.test.js・app.test.js。レビューの直しで、目標を外して空いたら移す形にした）
- [x] 旧コードのタブ（フェーズ 1 の版）を開いたまま新しい版を開いても、下書きの性別・目標の観測の状態・移行の記録が消えない（テストで確認: 前の版のタブの書き戻しを写した drafts.test.js・goals-migration.test.js、観測と移行の記録は旧版が知らない別のキー。ブラウザで旧版のタブと同時に開く確認は未）
- [x] 設定から「データの状態」「通知」カードが消え、「書き出し」「この端末のデータ」がある。プロジェクトの CLAUDE.md:16 と `ui/notifications.js` の記述が直っていて、変更記録がある（CLAUDE.md:16 は 2026-10-15 にユーザーの確認を得て「ベルの「すべての通知を見る」に出る」に直し、変更記録を足した）
- [x] `docs/OPERATIONS.md`・`README.md` のタブ名・手順の記述を新しい構成に合わせた（レビューの直しで OPERATIONS.md の呼び名〔目標に保存・プレイヤーの対応・タマゴ等だけ〕も合わせた）
- [x] `npm test`・`npm run test:perf` が通る。計測の取り直し（一覧で並べ替え・登録モーダルで親・子を選ぶ・下書きの一括登録）
- [x] 観点別のエージェントと Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
- [x] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）（2026-10-15。ユーザーの確認を得て main へ反映して push した）

---

## フェーズ 3: ドロワーと横断の導線

詳細: [phase-3-4-drawer-data.md](phase-3-4-drawer-data.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 31. [drawer](phase-3-4-drawer-data.md#drawer-右のサイドドロワー土台)（M）

右のサイドドロワー（土台）

- 状態: 済（2026-10-15） ／ ブランチ: `feature/drawer` ／ マージのコミット: `4640a51`

- [x] `web/js/ui/drawer.js` の `createDrawer`（open・close・current・restore・destroy、stack 5 件）を書く
- [x] `<aside class="side-drawer">` の見出し行（h2・← 前へ・本文へ戻る・ページで開く・×）を作る
- [x] CSS: `--side-drawer-width`、固定配置、`--z-drawer`、開閉の動き、減らす設定、トースト・スナックバーのずれ
- [x] history: 開くとき pushState（URL 不変）・差し替えは replaceState・× は back・popstate で閉じる/開き直す
- [x] 読み込み直したときの復元（版・環境・利用者の検査）
- [x] `route.view` が変わる遷移・ログアウト・名前の変更・ワールドの切り替えで閉じる
- [x] `installPalLinks`（普通のクリックだけ引き取る。修飾キーと dialog の中は除く）（app.js の root の click から呼ぶ `handlePalLink` にした。phase-3-4 の drawer の「実装の記録」2）
- [x] Esc・フォーカスの戻し先・「本文へ戻る」
- [x] app.js に組み込む（`context.drawer`、種類ごとの中身の表）
- [x] `test/helpers/dom.js` に history の偽物、`test/web/drawer.test.js` と `app.test.js` の 1 件
- [x] ブラウザで重なりと戻る/進むを確かめる
- [x] OPERATIONS.md の 1 項目と release-notes

### 32. [pal-detail](phase-3-4-drawer-data.md#pal-detail-パル詳細を種族のハブに)（M）

パル詳細を種族のハブに

- 状態: 済（2026-10-15） ／ ブランチ: `feature/pal-detail` ／ マージのコミット: `5839ad2`

- [x] `web/js/ui/pal-detail.js` に `palDetail(context, palId, { mode, onSwitch })` を切り出し、`views/pal.js` を包むだけにする
- [x] 見出しをパル名にし、パル切り替えの `palPicker` を置く
- [x] ヒーロー 2 列（画像 128・属性チップ・英名・パートナースキル）
- [x] 所持の 1 行（owned-overlay の集計）と上位 5 体の `details`（`syncList`）
- [x] 行き先のボタン（継承ルート 2・理想個体・目標にする・この子の配合を登録）
- [x] 配合の 2 節を件数＋上位 3 件＋「すべて見る」に
- [x] ドロワーの中身の表に `pal` を足す
- [x] ヘッダーのパル検索と「/」のショートカット（N と共通の判定）
- [x] パル選択の群の見出し（F077）とキー操作・`suggested`（F078）
- [x] `web/js/ui/hover-card.js`（F059）と `data-pal-id`・`data-passive-id`
- [x] テスト（pal-detail・pal-picker・app）と `views.test.js:91` の期待値の更新
- [x] OPERATIONS.md と release-notes

### 33. [owned-detail](phase-3-4-drawer-data.md#owned-detail-所持パルの個体の詳細をドロワーで)（S）

所持パルの個体の詳細をドロワーで

- 状態: 済（2026-10-15） ／ ブランチ: `feature/owned-detail` ／ マージのコミット: `f4c3a63`

- [x] `web/js/ui/owned-detail.js` に `ownedDetail(context, instanceId, { terms })` を書く
- [x] 中身（アイコン・名前・Lv・★・個体値の 4 セル・パッシブと説明・スキル・属性・場所の図・リンク）
- [x] キーワード一致の全文（`keywordNotes` の全部）
- [x] 行の操作に「詳細」を足し、パッシブ・個体値・場所のセルのクリックでも開く（委譲・文字選択中は除く）（D29: 行の操作はないので、セルのクリックとキーボードの手段で）
- [x] 開いている行の `aria-current` と背景
- [x] 読み直しで同じ個体を引き直す・いなければ案内
- [x] ドロワーの中身の表に `owned` を足す
- [x] テスト（owned-detail・owned-view）
- [x] OPERATIONS.md と release-notes

### 34. [farm-data](phase-3-4-drawer-data.md#farm-data-牧場のタマゴを残して共有する牧場の表示の土台)（M）

牧場のタマゴを残して共有する（牧場の表示の土台）

- 状態: 済（2026-10-15。GAS の反映〔npm run gas:push〕はフェーズの報告の後にユーザー） ／ ブランチ: `feature/farm-data` ／ マージのコミット: `c4d2400`

- [x] 画面用の farms に `eggs`（id・palId・mutant）・`eggCount`、全体に `farmsPartial` を足す
- [x] `owned-shared.js` に `OWNED_FARMS_MAX_CHARS`・`OWNED_FARM_EGGS_MAX`・短い鍵の検証・`fitOwnedFarms` を書く
- [x] `validateOwnedUpload` で `fitOwnedFarms(cleanOwnedFarms(…))` にする
- [x] `sharedUpload` を共有の形＋縮めてから送るように（読めない牧場は親を空にして `s: 'u'`）
- [x] `ownedFromShared` で共有の形を戻し、古い形は「タマゴの情報なし」に（古い形では空き牧場を判定しない）
- [x] ideal-farms の完全性の判定に `farmsPartial` を足す（中身だけ省いたときは保留しない）
- [x] data-boundary の検証に `breedFarms[].eggs` と共有の farms を入れる
- [x] `npm run build:gas` で gas/Shared.js を作り直す
- [x] テスト（shared・owned・gas・ideal-farms）と owned.test.js:53 の期待値の更新
- [x] check-save の出力、SAVE_FORMAT.md と owned-shared.js のコメント
- [ ] release-notes と、ユーザーへの `gas:push` の依頼（release-notes は済。依頼はフェーズの報告で）

### 35. [farm-board](phase-3-4-drawer-data.md#farm-board-配合牧場ボード牧場の印孵化待ちのタマゴ)（M）

配合牧場ボード・牧場の印・孵化待ちのタマゴ

- 状態: 済（2026-10-15。GAS の反映〔npm run gas:push と setup()〕はフェーズの報告の後にユーザー。N-08 はユーザーの答えでチップを出さない） ／ ブランチ: `feature/farm-board` ／ マージのコミット: `7ba9db2`

- [x] 個体に `farm`（親・タマゴ）を足し、キーワードの status に「配合牧場」「突然変異」
- [x] `eggItemId` を正規化と共有の列（`OWNED_ADDED_FIELDS`）に足し、build:gas
- [x] `scripts/extract-skills.mjs` で `EGG_NAMES` を取り出し、SOURCES.md に 1 行
- [x] 行のバッジ（配合牧場・突然変異・タマゴの名前）
- [x] `web/js/ui/farm-board.js`（カード・状態のチップ・タマゴの画像・登録の件数のリンク・一部だけの文）
- [x] 所持パルの帯（既定は閉じる・viewState・「右に開く」）とドロワーの入口
- [x] `eggMatches` と、理想個体の「孵化させると完成」・目標の行の添え書き
- [x] N-08 の上限をユーザーに確かめてもらい、確かめた後にだけチップを出す（2026-10-15 の答え「分からない」で出さない）
- [x] テスト（farm-board・ideal-goals・owned・shared・gas・extract-skills）
- [ ] OPERATIONS.md・SAVE_FORMAT.md・release-notes と、`gas:push`・`setup()` の依頼（文書と release-notes は済。依頼はフェーズの報告で）

### 36. [route-progress](phase-3-4-drawer-data.md#route-progress-継承ルートの進み具合と横断の導線)（M）

継承ルートの進み具合と横断の導線

- 状態: 済（2026-10-15） ／ ブランチ: `feature/route-progress` ／ マージのコミット: `235c302`

- [x] 全部持つ個体がいないときのパッシブごとの経路と「理想個体で合わせる」（R-30）
- [x] 理想個体の `renderMissing` の文言に最短の回数と開始を添え、運べないものは文字だけ（R-32）
- [x] `annotateFor` に「牧場に配置中」「タマゴあり」（R-33）
- [x] `routeView` に `progress`（✓ と次の段）と `summary`（相手親 未所持 n/m 段）（R-34・F032）
- [x] 相手親の注記をチップにし、`species` のドロワー（`web/js/ui/species-owned.js`）
- [x] 継承ルート ⇄ 理想個体の明示のリンク（I-58）
- [x] 配合を探すの「▸ この親の配合 n 件」（2 段・同じ種族で止める・viewState）（F015）
- [x] テスト（route-view・owned-view・ideal-view・find-merge）と期待値の更新
- [x] OPERATIONS.md と release-notes

### 37. [goals-detail](phase-3-4-drawer-data.md#goals-detail-目標の一覧の詳細と所持パルの種族のまとまり)（M）

目標の一覧の詳細と、所持パルの種族のまとまり

- 状態: 済（2026-10-15。集計チップ F067 はユーザーの答えで作らない） ／ ブランチ: `feature/goals-detail` ／ マージのコミット: `2c41e4e`

- [x] `goalNearest(goal, pals)` を `core/ideal-goals.js` に足す
- [x] 目標の一覧の見出し・開くボタンに完成の数（未確認なら出さない）
- [x] 並びを未完成が上・完成済みは薄く（`syncList`）
- [x] 行を 36px・名前 1 回・状態のピル・未確認の案内に
- [x] 未完成の行に「パッシブ 3/4 · 攻撃あと 8」・未所持・孵化待ち
- [x] 完成済みの行と通知の href を所持パルの URL（グローバルを含む）に
- [x] 所持パルの図鑑順の種族の見出し（畳み・viewState・行の高さの計算）
- [x] 要約の集計チップ（押すと絞り込み）（2026-10-15 のユーザーの答え「作らない」で作っていない）
- [x] テスト（ideal-goals・目標の一覧・ideals・owned-view）と期待値の更新
- [x] OPERATIONS.md と release-notes

### フェーズ 3 の終わり

- 状態: 済（2026-10-15）。レビューの直しは `fix/phase-3-review`（直し（1）`9089a72`・直し（2）`f5d95ae`・文書。統合ブランチ `integrate/phase-3` へ --no-ff でマージ）。指摘は Codex 8 件・観点別のエージェント 4 体（安定性 11・互換と INV-2 とセキュリティ 7・操作性 15・性能 4）・計測 1 件で、重なりを除いた 23 項目を直した（中身と直さなかったものは phase-3-4-drawer-data.md の「フェーズ 3 の終わりのレビューの直し」）。計測は phase-1a-foundation.md の「計測の記録」の 2026-10-15 の「フェーズ 3 の終わり」の行。main への反映と push はユーザーの確認の後（下の「次にやること」）

- [x] `npm test`・`npm run test:perf`（20,000 行・偏った分布を含む）が通る（1,655 件・13 件）
- [x] 計測の取り直し: 配合検索 → パル詳細（scrollY=500）が「ドロワーで開き、本文はそのまま」になった。ヘッダー／パネル／候補／トースト／ダイアログ／ドロワーの重なり（ヘッダーの部品へフォーカスを戻すと本文が動く不具合を見つけて直した）
- [x] 古い共有データ（新しい項目のないもの）・旧コードのタブが混ざった状態から起動して壊れない（新旧の画面 × 新旧の GAS の往復。新しい画面 → 古い GAS は断られるので、GAS を先に更新する）
- [x] GAS の反映をユーザーに依頼した: farm-data（`npm run gas:push` のみ）・farm-board（`eggItemId` の列 → `setup()`）（2026-10-15 のフェーズ 3 の報告で。配信〔main への push〕より先に）。**ただし `update-deployment` は本番に届いておらず、版を確かめないまま配信した**（本番の URL は版 8 のまま。2026-10-16 に見つけ、版 9 にして直した。下の「次にやること」の 1 つ目）
- [x] 観点別のエージェントと Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
- [x] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）

---

## フェーズ 4: セーブ情報・ゲーム素材・新機能

詳細: [phase-3-4-drawer-data.md](phase-3-4-drawer-data.md)（冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）

### 38. [game-assets](phase-3-4-drawer-data.md#game-assets-ゲームの-ui-アイコンと作業適性を取り込む)（L）

ゲームの UI アイコンと作業適性を取り込む

- 状態: 済（2026-10-15。実装の記録は phase-3-4-drawer-data.md の game-assets の節。統合ブランチ `integrate/phase-4` へマージした）／ ブランチ: `feature/game-assets` ／ マージのコミット: `6126736`

- [x] `openPak` に `list(prefix)` を足す
- [x] `scripts/extract-ui-icons.mjs`（`--list`・`UI_ICONS` の表・縮小・形式の確認）と npm の scripts
- [x] `--list` で実在と形式を確かめ、属性の番号の対応をゲームの画面で確かめる（→ 番号の対応はゲームの `WBP_PalElementIcon`・`WBP_IconPalWork` の IconMap で確かめた。DXT 以外は性別の B8G8R8A8 だけで、`readTexture` に足した）
- [x] アイコンを書き出して `web/img/` に置き、SOURCES.md に例外・使い分けの表・容量の上限・撤回の手順
- [x] `elementIcon`・`elementChips`・`palTile({ elements })` と、表示先（パル詳細・候補・行・目標）（→ 所持パルの行は要素を足さない `elements: 'css'`）
- [x] `import-pals.mjs` で作業適性を取り込み（許可リスト・CombiRank を読まない）、build:pals（→ ユーザーの決定でゲーム本体から `scripts/extract-work.mjs`〔`npm run extract:work`〕で別の生成ファイル `web/data/work.js` に。`import-pals.mjs`・`pals.js` の許可リストは変えていない）
- [x] パル詳細の作業適性の行と、キーワード「採掘」「採掘3」
- [x] タマゴ・ケーキ・牧場・性別のアイコン（文字は残す）
- [x] X-25: 見送った（2026-10-15 のユーザーの答え）。DT_PalWildSpawner は読めるが、ダンジョン・世界樹・仮の行が混ざり、実際にワールドに置かれているかは DT_PalSpawnerPlacement まで読まないと分からないため（`pal-sources.js` とチップは作らない）
- [x] テスト（import・breeding-card・pal-detail・owned）
- [x] OPERATIONS.md と release-notes

### 39. [save-extras](phase-3-4-drawer-data.md#save-extras-セーブから読める追加の情報入手時刻お気に入り接続中の仲間dayケーキの残りほか)（M）

セーブから読める追加の情報（入手時刻・お気に入り・接続中の仲間・Day・ケーキの残りほか）

- 状態: 済（2026-10-16。実装の記録は phase-3-4-drawer-data.md の save-extras の節。統合ブランチ `integrate/phase-4` へマージした。お気に入りと孵化の残り時間は 2026-10-15 のユーザーの答えで見送った）／ ブランチ: `feature/save-extras` ／ マージのコミット: `990161b`

- [x] `check-save.mjs --probe`（個体の項目・最終ログインと RealDateTimeTicks・場所不明の入れ物・牧場の入れ物・孵化器）を書いて実セーブで確かめる（→ インプラントとパルリバーサーの入れ物・RecordData も）
- [x] 結果を SAVE_FORMAT.md に書き、ない項目をユーザーに報告する
- [x] 入手時刻（OwnedTime か firstSeen）・並べ替え・NEW（lastViewed）（→ OwnedTime。NEW の基準は別のキー `owned.seenAt`）
- [x] お気に入り（読み取り・ハート・キーワード・共有の列）（→ 見送った。2026-10-15 のユーザーの答え）
- [x] 接続中の仲間（GameTimeSaveData・ギルドの最終ログイン・online）と Day・Lv の表示
- [x] players の共有に level・online・lastOnlineAt を足す（Day の共有はユーザーに確かめる）（→ level・online。lastOnlineAt は作らない。Day はワールドの列 `inGameDay`）
- [x] 観賞用ケージの場所（原因と分かったときだけ）
- [x] 牧場のケーキの残り（入れ物があるときだけ。ホストだけ）
- [x] 魂の強化・病気（項目があるときだけ。ドロワーと行のバッジ）
- [x] 孵化の残り時間は調査の結果しだい（→ 見送った。2026-10-15 のユーザーの答え）
- [x] テスト（save・owned・shared・gas・owned-view）と期待値の更新
- [x] build:gas、OPERATIONS.md、release-notes、ユーザーへの `gas:push`・`setup()` の依頼（→ 依頼はフェーズの報告で）

### 40. [implants](phase-3-4-drawer-data.md#implants-パル手術台とインプラントパルリバーサー)（L）

パル手術台とインプラント・パルリバーサー

- 状態: 前半・後半とも実装済（2026-10-16。前半はパル手術台の表・在庫・案内・`s`・継承ルートの 1 行・「手術で完成できる」、後半はパルリバーサーの案内〔D17〕。実装の記録は phase-3-4-drawer-data.md の implants の節）。完了の条件のうち、実セーブ（ホストの画面）での手術台の案内の確認が残り。統合ブランチ `integrate/phase-4` へマージした ／ ブランチ: `feature/implants` ／ マージのコミット: `471712b`
- ideal-calc の後の形で書き直した（2026-10-12。README の「3-6」の末尾。D9〜D17）

- [x] `scripts/extract-implants.mjs` で手術台の表を取り出し、`web/data/implants.js` を生成（パッシブ ID の照合）（→ v1.0.5 で 54 行。パルリバーサーの名前 `GENDER_REVERSE_NAME` も）
- [x] SOURCES.md に出典と INV-2 の注記
- [x] `web/js/core/implants.js`（`implantOf`・`goalNear`）（→ 数え上げは core/ideal-goals.js の `goalProgress` の `canAdd`〔1 体と数〕と `goalAddable`〔全部〕）
- [x] 在庫の読み取り（拠点の箱・ギルド保管庫・Essential。ワールドの宝箱は除く）と `itemStock`（→ 所持品は全部の入れ物・拠点は箱・配合牧場・ほかの設備。呼び名は画面の側。`stockText`）
- [x] タマゴの場所の判定の回帰テスト（→ 合成のセーブと、手元のワールド 4 つで前の版と同じ）
- [x] 理想個体の足りないパッシブに手術台の案内と在庫（文言の変更とテストの更新）（→ 警告の文は route-progress の後の文のまま）
- [x] 「手術で付ける分を除いて計画する」のリンク・`s` の検証・帯・目標の保存の扱い（→ 保存は押せなくして理由）
- [x] パルリバーサーの案内の計算（`core/ideal.js`。新しくできる組だけを見る・総当たりと一致するテスト・性能テスト）（→ `genderFlipSteps`・`genderFlipHints`。同じ組み合わせで別の子も登録されている組は案内しない）
- [x] パルリバーサーの案内の表示（上位 3 体＋ほか n 体・「パルリバーサーを使わずに作る」・戻すリンク）と、消した記録の保存（この端末だけ・data-boundary・user-rename）（→ 戻すリンクは見出しの右。記録は web/js/reverser-hidden.js）
- [x] 継承ルートの手術台の 1 行
- [x] 目標の一覧の「手術で完成できる」（ベルは鳴らさない）
- [x] 計算のしくみの 1 文・OPERATIONS.md:122 の直し・SAVE_FORMAT.md・release-notes（→ 計算のしくみは D30 でなくしたので不要。OPERATIONS.md のパルリバーサーの案内と release-notes の 2 件目も後半で足した）

### 41. [paldex](phase-3-4-drawer-data.md#paldex-パルの図鑑pal-の格子)（M）

パルの図鑑（`#/pal` の格子）

- 状態: 実装済（2026-10-16。実装の記録は phase-3-4-drawer-data.md の paldex の節。完了の条件のうち、実セーブをホストの画面〔ブラウザ〕で読んだ捕獲数の表示は `check:save` の出力で代えた）。／ ブランチ: `feature/paldex` ／ マージのコミット: `1d19ffb`

- [x] `web/js/views/paldex.js` と、`views/pal.js` の ID なしの分岐（→ 不正な ID も「パルが見つかりません」と知らせて図鑑）
- [x] 見出し・「子として登録 N / 298」・絞り込み（viewState）（→ `viewState('paldex').filter`。「未所持」は所持パルのデータがあるときだけ）
- [x] 格子（48px 固定・lazy・件数・影・点・星・`syncList` で印だけ更新）（→ 絞り込みも hidden で、マスは作り直さない）
- [x] `palIcon(pal, { silhouette })` と CSS の filter（ライト・ダークの濃さの調整）（→ `size` も。ライトは黒の 35%・ダークは白の 30%）
- [x] パル詳細に「図鑑」のリンク（→ ページとドロワーのパル切り替えの横。ヘッダーのパル検索の「図鑑を開く」〔任意〕は入れていない）
- [x] `check-save --probe` で RecordData を確かめる（→ Map<Name, Int>。246 件・224 件、引けないのは Human だけ）
- [x] 捕獲数の読み取り（PLAYER_SKIP・parsePlayer・失敗しても続く）と自分の分の表示（→ パル ID には normalizeOwned で引く。PaldeckUnlockFlag は読まない）
- [x] テスト（paldex・save）と性能の計測
- [x] SAVE_FORMAT.md・OPERATIONS.md・release-notes

### フェーズ 4 の終わり

詳細: [phase-3-4-drawer-data.md の該当の節](phase-3-4-drawer-data.md#フェーズ-34-の終わりにすること)

- 状態: レビューの直しまで済（2026-10-16）。直しは `fix/phase-4-review-ideal`（`1cc2371`）と `fix/phase-4-review-owned`（`a5a3cfa`）を統合ブランチ `integrate/phase-4` へ --no-ff でマージした（`c9325e9`）。指摘は Codex 2 件・観点別のエージェント 4 体（安定性 6・互換と INV-2 とセキュリティ 5・操作性 13・性能と計測 4）で、重なりを除いた 25 項目を直した（中身と直さなかったものは phase-3-4-drawer-data.md の「フェーズ 4 の終わりのレビューの直し」）。計測は phase-1a-foundation.md の「計測の記録」の 2026-10-16 の行。GAS の反映・main への反映と push はユーザーの確認の後（下の「次にやること」）

- [x] `npm test`・`npm run test:perf` が通る（1,753 件・15 件。test:perf は統合の後の 1 回目に 1 件落ち、測り直しの 5 回は全部通った）
- [x] 実セーブで確かめた項目を `docs/SAVE_FORMAT.md` に書いた。取り込んだ画像の権利表記と撤回の手順を `data/SOURCES.md` に書いた（表の撤回の形もレビューの直しで足した）
- [ ] GAS の反映（`npm run gas:push` → `npx clasp update-deployment <deployment ID>`）をユーザーに依頼した: save-extras（`OwnedPals` の `ownedAt` の列・`OwnedWorlds` の `inGameDay` の列 → `setup()`。お気に入りは見送った）
- [ ] 配信（main の push）の前に、`npx clasp list-deployments` で本番の URL の版が上がったことを確かめた（ユーザーの「済んだ」だけで進めない。フェーズ 3 は版 8 のまま配信した）
- [x] 観点別のエージェントと Codex（読み取り専用。使う前に許可）で差分をレビューし、直した
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

- **フェーズ 4 の報告の後: GAS の反映 → main への反映と push（ユーザーの確認の後）→ 任意の 4 項目を採るかを確かめる**（2026-10-16 のセッション `65ff2896` で、フェーズ 4 の 4 テーマ〔game-assets `6126736`・save-extras `990161b`・implants `471712b`・paldex `1d19ffb`〕とレビューの直し〔`fix/phase-4-review-ideal`・`fix/phase-4-review-owned`。マージ `c9325e9`〕を統合ブランチ `integrate/phase-4`〔main の c199921 から〕に入れ、フェーズ 4 を報告した。着手の前の調査〔実セーブとゲーム本体・読み取りのみ〕の後のユーザーの答えは README の 3-1 の D32。**GAS の反映は配信より先に**: `npm run gas:push` → `npx clasp update-deployment <deployment ID>` → `npx clasp list-deployments` で本番の版が上がったことを確かめる → GAS エディタで `setup()`〔`OwnedPals` の `ownedAt`・`OwnedWorlds` の `inGameDay` の列〕→ main を `integrate/phase-4` に進めて push → ホストの画面を読み込み直す〔OPERATIONS.md の「入手時刻・ゲーム内の日数・プレイ中の共有」〕。配信の後に見ること: 実セーブをブラウザのホストの画面で読んだ表示〔入手時刻の NEW・プレイ中・牧場のケーキ・手術台の在庫・パルリバーサーの案内・捕獲数〕、作業適性と病気などの値がゲームの画面と合うか、フェーズ 3 から持ち越しの共有のワールドの一覧の応答時間・タマゴの名前・継承ルートの段の印。任意の 4 項目〔optional-*〕は未決定〔報告で採るかを聞く〕。気づいたこと: (a) 作業中のブランチに別のセッションの文書のコミット〔`b1c0b18`。GAS の反映に update-deployment と版の確認〕が入ることがあった〔そのまま取り込んだ〕。コミットの前に `git branch --show-current` と `git log --oneline -3` を見る。(b) 直しを並行に 2 本作るときは、片方を `git worktree add "Claude outputs/worktrees/<名前>"` の別の作業フォルダで作るとブランチがぶつからない〔web/img/pals は git で無視されるので写す〕。(c) サブエージェントは `Claude outputs/` の報告のファイルを書けないことがある〔親が写す〕。(d) 開発用 API の配合は seed ごとに同じになった〔mulberry32。気づいたこと 2 の「配合のある親を選び直す」は要らない〕）。以下はフェーズ 4 に着手する前の書き置き: **フェーズ 4 の 1 番目 game-assets から**（2026-10-15 のセッション `de16cfd8` でフェーズ 3 の 7 テーマ〔drawer `4640a51`・pal-detail `5839ad2`・owned-detail `f4c3a63`・farm-data `c4d2400`・farm-board `7ba9db2`・route-progress `235c302`・goals-detail `2c41e4e`〕とレビューの直し `fix/phase-3-review` を統合ブランチ `integrate/phase-3` に入れ、フェーズ 3 を報告した。GAS の反映〔`npm run gas:push` → `npx clasp update-deployment` → GAS エディタの `setup()`。eggItemId の列〕をユーザーに依頼し、「済んだ」との返事を受けて main を `integrate/phase-3` に進めて push した。**このとき `update-deployment` は本番に届いていなかった**〔本番の URL は 2026-10-10 の版 8 のまま。版を確かめずに配信した〕。配信の後はホストの共有が `INVALID_COLUMNS` で断られ、画面に「共有できませんでした（入力内容を確認してください。）」と出ていた。2026-10-16 に見つけ、ユーザーが `update-deployment` をやり直して本番の URL を版 9 にした〔`gas:push` は「Script is already up to date.」＝前回の push は済んでいた。版 9 の中身が HEAD の gas/ と同じことを clasp clone で確かめた〕。フェーズ 4 も統合ブランチ〔`integrate/phase-4`。main から〕に各テーマを --no-ff でマージし、main への反映と push はフェーズの報告の後にユーザーの確認を取る。phase-3-4-drawer-data.md の「# フェーズ 4」の冒頭〔どのテーマも先に実際のセーブ〈`npm run check:save`〉とゲーム本体で確かめてから作る〕と game-assets の節から。フェーズ 3 で足した部品は README の 5-4、申し送りは各テーマの「実装の記録」と「フェーズ 3 の終わりのレビューの直し」〔ドロワーの中身の `setTitle`・history.state.drawer の `id`・`focusInPlace`・`goalProgress`・読めない牧場の仮の親〕。任意の 4 項目〔optional-*〕は未決定。配信の後に見ること: 共有のワールドの一覧の応答が大きくなった〔全ワールドの farms〕ことによる GAS の応答時間、実セーブでのタマゴの名前と継承ルートの段の印）。以下はフェーズ 3 の途中の書き置き: - **フェーズ 3 の 6 番目 route-progress から**（2026-10-15 のセッション `de16cfd8`。統合ブランチ `integrate/phase-3`〔main の be98c04 から〕に drawer〔`4640a51`〕・pal-detail〔`5839ad2`〕・owned-detail〔`f4c3a63`〕・farm-data〔`c4d2400`〕・farm-board〔`7ba9db2`〕を --no-ff で入れた。各テーマの「実装の記録」は phase-3-4-drawer-data.md。ユーザーの答え〔2026-10-15〕: 牧場のタマゴの共有の形は文書のとおり・共有の個体の列 eggItemId を足す・タマゴの名前の表を取り出して data/SOURCES.md に 1 行・N-08 のチップは出さない。**フェーズの報告で、GAS の反映〔`npm run gas:push` と GAS エディタの `setup()`〕をユーザーに依頼する**。この後 route-progress → goals-detail → フェーズ 3 の終わり〔npm test・test:perf・計測・観点別のエージェントと Codex のレビュー・直し・報告〕。main への反映と push は報告の後にユーザーの確認を得てから）。以下はフェーズ 3 に着手する前の書き置き: **フェーズ 3 の 1 番目 drawer から**（2026-10-15、フェーズ 2 の 10 テーマとレビューの直し 2 本〔`fix/phase-2-review-data`・`fix/phase-2-review-ui`〕を統合ブランチ `integrate/phase-2` に入れ、フェーズ 2 を報告した。ユーザーの確認を得て、プロジェクトの CLAUDE.md:16 を「ベルの「すべての通知を見る」に出る」に直し〔変更記録つき〕、main を `integrate/phase-2` に進めて push した。フェーズ 3 は別のセッションで進める〔[phase-3-4-drawer-data.md](phase-3-4-drawer-data.md) の「0. この文書の読み方」と drawer の節から〕。フェーズ 3 も統合ブランチ〔`integrate/phase-3`。main から〕に各テーマを --no-ff でマージする）。フェーズ 2 で変わった土台（後のフェーズが使う）: phase-2 の各テーマの「実装の記録」の申し送りと「フェーズ 2 の終わりのレビューの直し」（所持の印は `.owned-tally`〔`.owned-count` は所持パルの数の行〕、自動登録の `importNotices` は `{ added, skipped }`、`createNotificationStore({ now })` と G-22 の直近 7 日、ideals の `pairsOf`、ショートカット N はビューの `registerInitial`〔パル詳細も持つ〕。N を切る設定〔WCAG 2.1.4〕はまだない。登録モーダルの参照の列のリンクは drawer で詳細を開く形にするときに合わせて見る）。以下はフェーズ 2 に着手する前の書き置き: **フェーズ 2 の 1 番目 find-merge から**（2026-10-15、フェーズ 1d を報告し、ユーザーの確認を得て main を統合ブランチ `integrate/phase-1d`〔4a5c375〕に進めて push した。フェーズ 2 も統合ブランチ `integrate/phase-2` に各テーマを --no-ff でマージし、main への反映と push はフェーズの報告の後にユーザーの確認を取る）（[phase-2-structure.md](phase-2-structure.md) の find-merge の節。file:line は ad648b7 の時点なので、関数名・文字列で探し直す）。フェーズ 1d の終わりのレビューの直しで変わった土台（後のフェーズが使う）: 設定へ移る案内は router.js の `settingsHash(worldId, open)` に合う意図〔`self`・`registrant`・`status`。省くと前の版の `auto`〕を渡す、本人の決め方を self の外で変えたら `self.changed()`、自動登録の成功の通知は別のキー `autoBreeding.registered`（phase-1d の「フェーズ 1d の終わりのレビューの直し」の 2 本の節と、README の 5-4）。以下はフェーズ 1d の終わりに着手する前の書き置き: **フェーズ 1d の終わり（npm test・test:perf・計測・レビュー・報告）**（[phase-1d-small-fixes.md](phase-1d-small-fixes.md) の「フェーズ 1d の終わりのチェックリスト」と、README の 5-2 の 7）。visual-parts は 2026-10-14 に `feature/visual-parts` で済ませた（マージは親のセッションが確かめてから。性別は ui/pal-icon.js の `genderMark(gender, { inline })` と色のトークン `--gender-male`・`--gender-female`・`--on-gender`、状態の印は ui/dom.js の `statusChip(text, tone, className)`・`setChipTone(node, tone)`〔tone は ready・warning・error・info・neutral〕、押せないボタンは `setDisabled(node, disabled, reason, { focusable })` と M3 の無効の色、アイコンは ui/icons.js の `ICONS`・`icon(name, { className })`〔`navIcon(view)` はそのまま。`actionIcon(label, name, action, className)` の 2 つ目は名前に変わった〕、閉じる × は `icon('close', { className: 'close-icon' })`、select の ∨ は `--select-arrow`。フェーズ 2 の find-merge・register-entry・goals-merge、フェーズ 3 の pal-detail・owned-detail・farm-board、フェーズ 4 の game-assets は、phase-1d の visual-parts の「実装の記録」12 の申し送りを見る。とくにナビのアイコンを消すときは nav-icons.js ではなく icons.js の `ICONS`）。以下は visual-parts に着手する前の書き置き: **フェーズ 1d の 6 番目 visual-parts から**（[phase-1d-small-fixes.md](phase-1d-small-fixes.md) の visual-parts の節。file:line は ad648b7 の時点なので、関数名・文字列で探し直す）。delete-undo は 2026-10-14 に `feature/delete-undo` で済ませた（マージは親のセッションが確かめてから。トーストは ui/toast.js の `toast(message, { action, actionLabel, duration, kind })`〔`kind: 'error'` は role=alert・× つき〕と定数 `TOAST_DURATION`・`ACTION_DURATION`・`ERROR_DURATION`、表示先は `.toast-region` の中の `.toast-list`〔aria-live〕と `.toast-alerts`、位置は本文の幅の下中央で、新しいバージョンのスナックバーも下中央・トーストはその上〔`--snackbar-height`・`--snackbar-offset`〕、下書きの一括削除は `drafts.removeAll`・`drafts.restoreMany`。visual-parts はトーストの × を SVG に替えるので、phase-1d の delete-undo の「実装の記録」10 の申し送りを見る。フェーズ 2 の autoreg-visibility・register-entry、フェーズ 3 の drawer、任意の F085 も同じ所を見る）。以下は delete-undo に着手する前の書き置き: **フェーズ 1d の 5 番目 delete-undo から**（[phase-1d-small-fixes.md](phase-1d-small-fixes.md) の delete-undo の節。file:line は ad648b7 の時点なので、関数名・文字列で探し直す）。copy-dead-ends は 2026-10-14 に `feature/copy-dead-ends` で済ませた（マージは親のセッションが確かめてから。タブの名前は views/tabs.js の `TABS`・`tabLabel`、空の状態のアイコンは `empty(text, action, { icon })`、読み込み中・失敗は ui/dom.js の `loadingState`・`errorState`（「もう一度読み込む」）、設定などへ移る案内は `setupHint`、用語表は README.md の「表記の決まり」と test/static/wording.test.js。delete-undo・visual-parts とフェーズ 2 の find-merge・bell・roles・goals-merge は、phase-1d の copy-dead-ends の「実装の記録」11 の申し送りを見る。とくに delete-undo は、初回の取得の失敗の文がヘッダー・画面・トーストの 3 か所に出る件）。以下は copy-dead-ends に着手する前の書き置き: **フェーズ 1d の 4 番目 copy-dead-ends から**（[phase-1d-small-fixes.md](phase-1d-small-fixes.md) の copy-dead-ends の節。file:line は ad648b7 の時点なので、関数名・文字列で探し直す）。cleanup-dead-code は 2026-10-14 に `feature/cleanup-dead-code` で済ませた（マージは親のセッションが確かめてから。`empty(text, action)` は「◇」を作らなくなり〔`div.empty-state` の中は文の `p` と操作だけ〕、保存失敗の警告は ui/dom.js の `storageWarning(what, className)`、色は `--md-sys-color-on-error-container` を定義した。copy-dead-ends・visual-parts は phase-1d の cleanup-dead-code の「実装の記録」12 の申し送りを見る）。autoreg-success は 2026-10-14 に `feature/autoreg-success` で済ませた（マージは親のセッションが確かめてから。通知の `kind`・`worldId`・`batchId`、`notificationTags`・`groupNotifications`〔行の `ids`・`count`・`items`・`more`〕、自動登録の通知の残す数 `capNotices` の形は phase-1d の autoreg-success の「実装の記録」。フェーズ 2 の bell・autoreg-visibility と copy-dead-ends はその 9 の申し送りを見る）。participant-self も 2026-10-14 に `feature/participant-self` で済ませた（マージは親のセッションが確かめてから。設定の行き先 `settingsHash`・「このワールドでの自分」の行・`identityChanged` の形は participant-self の「実装の記録」。copy-dead-ends はその 13 の申し送りを見る）。以下は participant-self に着手する前の書き置き: **フェーズ 1d の 1 番目 participant-self から**（[phase-1d-small-fixes.md](phase-1d-small-fixes.md) の冒頭の「テーマの順番」「共通の決まり」「プランと違っていた点」を先に読む）。フェーズ 1b・1c（7 テーマとレビューの直し 2 本）は 2026-10-13 に済ませた。participant-self で「自分」を変えるときは、phase-1b-1c の owned-toolbar の「実装の記録」16 の申し送りと、所持者の選択肢の `holderChoices`（views/shared.js。所持パルと理想個体で同じ。owned-toolbar の 18）を見る。 2026-10-14 の D29 で、所持者の「自分の個体」は自分のプレイヤー名の選択肢（値 `mine`）になって既定になり、自分が後から分かったときの描き直し（`context.store` の購読）も入ったので、owned-toolbar の記録 21 と ideal-panel の 15 も見る（phase-1d の participant-self に追記した）。
- ユーザーの答え（2026-10-13）: (1) 今の制約のまま (2) ログイン画面では隠す（fix/phase-1a-answers で直した） (3) Worker にしない (4) test:perf の余裕は、落ちたら測り直す（予算は変えない） (5) 2 行分の高さを最初から取る（fix/phase-1a-answers で直した）。その後、ユーザーの判断で固定をやめ、空のときは 1 行分・改行が要るときだけ行が増える形にした（fix/passive-row-natural。phase-1a の popovers の「実装の記録」）。フェーズ 1b・1c の答え（2026-10-13。README の 3-1 の D20〜D27）: パッシブ欄は改行してパネルが伸びてよい・所持の状況は 2 段目の右端（D20）、1 段目の見出しは入力の上・見出しの行は固定しない（D21）、配合牧場の詳細は既定で閉じる（D22）、個体値の差は値の下・持ち主の札はそのまま（D23）、所持パルのパネル 172px のまま・条件を変えたら結果の先頭を見せる（D24）、目標の印は行の下の段に 4 つまで・行は 80px／64px の 2 つ（D25）、読み直しを 10 秒ごとにして仲間への反映は最大 約 20 秒（D26）、細部（所持パルの許可のボタンは帯だけ・詳細の 1 行と 0 組の要約を短く・所持の状況のリンクに場所・「全部持つ」は余白を詰めて残す）と「**細かな UI は聞かずに決めて報告に書く**」（D27）。フェーズ 1b・1c の後の画面の確認のフィードバック（2026-10-13。D28。`fix/phase-1bc-feedback`）: 所持パルの行の操作は「親にして検索」だけ（「目標に」「ここから継承ルート」はなくした。文字のラベルつきの 1 つのボタン）、パッシブ欄は改行してもチップをプルダウンの右にそろえる、所持パル・理想個体のパネルは見出しの書き方と区切りをそろえる（パッシブの条件はパッシブの見出しの行へ・2 段目は行ごとに区切り線・場所のチップはオンに ✓・状態の行は結果の行の地と並べ替えの見出し。高さは 1100px・パッシブ 0 個で所持パル 184px・理想個体 150.5px）。2 回目の画面の確認のフィードバック（2026-10-14。D29。`fix/feedback2-owned`。所持パル側と共通の分）: データ元の 1 行はなくす（上のバーと重なる・設定は左のナビから）、場所のチップの数と拠点の ▾ はなくす、キーワードは何に一致したかを必ず出す（「属性：闇」）、所持者は自分のプレイヤー名を既定に（「自分の個体」の選択肢はなくす。理想個体も）、所持パルの行の操作はなくす（親・逆引き・継承ルートの検索はフェーズ 3 の owned-detail のドロワーへ）。同じ 2 回目のフィードバックの理想個体の分（2026-10-14。D30。`fix/feedback2-ideal`）: 組のカードの数値（完成まで 平均 約 N 個）と内訳の文・「同じ種族どうし」・個体値の差（−N）・結果の上の要約の行・計算のしくみの説明（「?」。INV-2 の例外 b の一文もいっしょに、ユーザーの判断でなくした）・「この目標の組を置いた牧場はありません」（牧場がなければ帯を出さない）はなくす、ケーキ以外の条件でいちばん早く作れるケーキを提案する（3 通りを比べ、押しボタンに「最速」の印。差が 1 割未満なら手間の少ない方）、空き牧場の案内は所持者が自分のときも出す
- 進め方（2026-10-12 のユーザーの回答）: ドキュメントのとおり（D1〜D27・3-3・3-7 の既定の扱い）。細かな UI は聞かずに最適な形に決めて実装し、報告に「こう決めた」と書く（D27。2026-10-13）。各テーマは `feature/<key>` でコミットし、`main` へ `--no-ff` でマージまで進める（push はしない）。**フェーズの終わりにまとめて報告する（2026-10-12 に変更）**。Codex はレビューにも実装にもフル活用してよい（読み込ませる情報に制限なし）。
- 親が決めた点（フェーズ 1b・1c のレビューの直しで担当が挙げたもの。D27 により聞かずに決めた）: (a) 所持パルの並べ替えの名前を「〈何〉が〈向き〉」にそろえ、「良いパッシブ順」を「パッシブのランクが高い順」にした（owned-rows の 18。そのまま） (b) 理想個体で自分のプレイヤーを所持者に選ぶと、要約が「Alice（自分） の個体」になる（ideal-panel の 13。そのまま） (c) 所持の状況のリンクにタマゴとグローバルを除いた場所も渡す (d) 所持パルの「全部持つ」は余白を詰めて 1100px の余りを 30px にした（(c)(d) は `fix/phase-1bc-answers`）。気になる点はユーザーが画面で確かめてから直す
- 次に気にすること: 所持パルのパネルの 2 段目の 1 行目（D28 の後は所持者・個体値・★・属性）は 1100px で余りが 約 31px。文字の幅の違うフォントで折り返すと、行の頭に区切り線が付いたまま回る（幅 1080px 以下だけ並びを変えて区切り線を外している）。場所のチップは D28 で 1 行を使うので、件数の桁が増えても 1100px で約 130px の余りがある（前の「所持者と場所で余り 約 18px」は当たらなくなった）。1 行の要素の数の上限は印のある行で 41 にした（2,000 行・全部の行に印 4 つ以上で 70,701 ノード。全部の行が最も多い形だと理論上 82,000 で予算 80,000 を超えうる。fix/phase-1bc-answers の記録）
- 気づいたこと: (1) Codex は Skill ツールから呼ぶと権限の確認で止まる。`bash ~/.claude/skills/delegate-codex/codex-delegate.sh --stdin` に JSON（`mode`・`timeout_s`・`project_dir`・`task`）を渡して Bash で直接呼ぶ。Codex の中ではシェルが起動しないが、node_repl で読み取り・テスト・計算はできる。(2) モックの配合は `Math.random` なので、計測では配合のある親を選び直す。(3) `npm run test:perf` は PC の負荷で 1.5〜2 倍揺れる。前後を比べるときは `git stash` で続けて測る。(4) 画像の 4 体の画面の確認は `Claude outputs/ui-audit-2026-10/shots/owned/inject-kabuki.js`・`check-kabuki.js`。(5) モックは読み込み直すとユーザーを作り直すので、配合のキャッシュから起動した後の全件取得で USER_NOT_FOUND になりログイン画面に戻る（キャッシュの読み出しを確かめるときは、読み込み直した直後の描画を記録する）。(6) core/ の中のファイルには、コメントでも `localStorage`・`window`・`document`・`fetch`・`api.js`・`store.js` の語を書かない（test/core/shared.test.js の静的検査）。(7) 性能の予算の注入は `Claude outputs/ui-audit-2026-10/shots/owned/inject-rows-2000.js`・`inject-rows-20000.js`（inject.js の写し。画面に出る行がちょうどその数）。ログイン画面ではヘッダーの同期状況のボタンにもエラーの文が出るので、playwright で「新規登録」を押すときは `exact: true` にする。JS ヒープは CDP の `HeapProfiler.collectGarbage` の後に `Runtime.getHeapUsage` で測った。(8) playwright-cli は各コマンドの後にアクセシビリティのツリーを作るので、行の多い画面の Long Task は同じコマンドの中で画面を開き直して測る（`Claude outputs/ui-audit-2026-10/shots/owned/owned-rows/longtask3.js`）。(9) ブラウザの tagName は大文字（テストの偽 DOM は小文字）。比べるときは `toLowerCase()`。(10) 先祖の要素（body・#app・一覧の入れ物）に `:has()` を足さない（行を出し入れするたびに body から下のスタイルを計算し直させ、2,000 行のキーワードの入力が止まった。phase-1b-1c の owned-rows の「実装の記録」12）。(11) モーダルのダイアログを開いたまま、裏のページがホイールでスクロールする（前からあり、全ダイアログ共通。未対応）。(12) この PC は Palworld などの負荷（CPU 56〜60%）で test:perf が 2〜4 倍揺れる。落ちたら測り直し、前後は同じ node のプロセスで交互に測る（予算は変えない）。(13) ポップオーバーは開くときに `@starting-style` の scaleY(.9) で縮めて出すので、開いた直後の getBoundingClientRect は板の中の位置がずれる。板の中の位置は offsetTop で測る（ui/passive-picker.js の `listTop`）。フォーカスの枠も入るときに 6px → 2px へ動く（focus-in）ので、枠を測るのは終わってから。(14) 画面の確認の playwright のスクリプトは、Bash の heredoc にバッククォートや `${}` を含めると失敗することがあるので、Write でファイルにしてから `run-code --filename` で流す。(15) Bash の heredoc の中の `\\` は 1 つの `\` に変わる（Python の書き換えのスクリプトに `\\n` と書くと本当の改行になった）。バックスラッシュを含む書き換えは Write・Edit で行う。run-code の中では `import()`（node:fs など）が使えず、run-code の間で globalThis の値も残らない（残したい値はページの sessionStorage に置く）。(16) モックの配合には親の性別がない（親の性別が付くのは配合牧場からの自動登録だけ）。配合カードの ♂♀ を画面で見るときは、`page.evaluate` で `/js/ui/breeding-card.js` を import して性別つきの記録のカードを一覧に足す（`Claude outputs/ui-audit-2026-10/shots/visual-parts/cards.js`）。 (18) 長く使ったブラウザのタブで requestAnimationFrame が止まり、playwright-cli の撮影・クリックが進まなくなることがある（アプリの不具合ではない）。`tab-new` で新しいタブを開くか、ブラウザを開き直す。playwright-cli -s=fm の撮影の保存先は `Claude outputs/ui-audit-2026-10/shots/find-merge` の下だけ許される。モックは最初に受けたパスワードだけを受け付けるので、ログインできないときは localStorage を消して読み込み直してから新規登録する。(17) 2026-10-14、テーマのブランチを main へ --no-ff でマージしようとしたら、Claude Code の自動モードの判定で止められた（共有の資源の変更として）。このフェーズは統合ブランチ `integrate/phase-1d` に各テーマを --no-ff でマージし、main への反映はユーザーの確認を取ってから行う形にした（README の 5-2 の 1・4）。
- 最終更新: 2026-10-15（フェーズ 2 の 10 テーマ〔find-merge〜roles〕と終わり〔計測・レビュー・レビューの直し `fix/phase-2-review-data`〔マージ `d8e0e4b`〕と `fix/phase-2-review-ui`〔マージ `1e34eef`〕〕まで済ませ、統合ブランチ `integrate/phase-2` に入れ、ユーザーの確認を得て CLAUDE.md:16 を直し、main へ反映して push した。それより前: フェーズ 1d の終わり〔計測・レビュー・レビューの直し `fix/phase-1d-review-notices`〔マージ `0773bb5`〕と `fix/phase-1d-review-self`〔マージ `a451cd2`〕〕まで済ませ、6 テーマとレビューの直しを統合ブランチ `integrate/phase-1d` に入れた。2026-10-14 の更新: フェーズ 1d の visual-parts〔`feature/visual-parts`。マージは親のセッションが確かめてから〕まで済ませた。それより前: セッション `96293c69`。2 回目のフィードバックのうち理想個体の分〔`fix/feedback2-ideal`。D30。マージは親のセッションが確かめてから〕。その前に、所持パル側と共通の分〔`fix/feedback2-owned`。D29。マージ `73348e6`〕。2026-10-13 の更新: フェーズ 1b・1c の後のユーザーのフィードバックの反映〔`fix/phase-1bc-feedback`。D28〕のほか、フェーズ 1b・1c〔talent-target・ideal-panel・ideal-results・ideal-farms・owned-status・owned-toolbar・owned-rows〕と、そのレビューの直し 2 本〔所持パル・理想個体と共通〕、ユーザーの答えの反映〔`fix/phase-1bc-answers`。D25〜D27〕を済ませた）
