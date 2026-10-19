# フェーズ 2: 構成の整理（D1・D2・D5・D6 ほか。10 テーマ）

> この文書だけを読めば、フェーズ 2 の各テーマを経緯も含めて把握し、そのまま実装に入れるように書いた。
> 書いた日: 2026-10-12。コードの行番号は HEAD `ad648b7`（web/ に未コミットの変更なし）で開いて確かめたもの。**フェーズ 1 の実装で行はずれる**ので、着手のときに関数名で探し直すこと。
> 正の材料: 統合プラン `~/.claude/plans/ui-jaunty-lampson.md`（写しは [appendix/plan-snapshot.md](appendix/plan-snapshot.md)）、別プラン（Fable 5.1）の §3・§6・§9（写しは [appendix/other-session-plan.md](appendix/other-session-plan.md)）、案の全文 [appendix/catalog.md](appendix/catalog.md)、Codex のプランレビュー [appendix/codex-reviews.md](appendix/codex-reviews.md)、却下した案 [appendix/rejected.md](appendix/rejected.md)。

## このフェーズの目的

- 9 本のタブ（配合検索・逆引き・継承ルート・一覧・下書き・ウィッシュリスト・所持パル・理想個体・設定）を、**配合を探す／継承ルート／所持パル／理想個体（目標を含む）／設定 の 5 本**にする。
- 「探す」「登録する」「知らせる」がそれぞれ 3 系統あった重複（統合プランの「全体の所見」1）をまとめ、設定・通知・参加者向けの案内の行き止まりをなくす。
- 決定事項（ユーザーの回答）: **D1** 配合検索・逆引き・一覧は 1 画面「配合を探す」に統合（条件帯 [親1][親2][子][登録者][並べ替え][キーワード]、旧 URL は読み替え）／**D2** ヘッダーの「＋ 登録」は外して文脈のボタンへ、下書きタブは廃止して配合を探すの全件表示の上の折り畳み帯へ／**D5** ウィッシュリストは理想個体の「目標」に統合（種族だけの目標）／**D6** 全件表示の並べ替えの既定は「更新日の新しい順」、キーワード検索を足す（437536b・b719187 の判断を更新）。D3（ドロワー）はフェーズ 3、D4（個体値の目標）・D7（ヘッダー）・D8（着手順）はフェーズ 1 で済んでいる前提。

### タブの数の移り変わり

| テーマを終えた時点 | タブ |
|---|---|
| フェーズ 1 の終わり | 9 本（変わらない） |
| find-merge | 7 本（逆引き・一覧が配合を探すへ） |
| register-entry | 6 本（下書きが配合を探すの帯へ） |
| goals-merge | **5 本**（ウィッシュリストが理想個体の目標へ） |

## テーマの順番（依存の順）

| 順 | テーマ | 先に終わっているべきもの | 工数 |
|---|---|---|---|
| 1 | [find-merge](#find-merge-配合を探すに統合) | render-contract・popovers（フェーズ 1）。copy-dead-ends（h1＝タブ名）・stable-render（syncList）・keep-state も入っている前提 | L |
| 2 | [owned-overlay](#owned-overlay-配合の画面に所持数を重ねる) | stable-render（フェーズ 1）・find-merge | M |
| 3 | [register-entry](#register-entry-登録の入口と下書きの帯) | find-merge | M |
| 4 | [register-dialog](#register-dialog-登録モーダルの見直し) | register-entry・owned-overlay | M |
| 5 | [goals-merge](#goals-merge-ウィッシュリストを目標に統合) | find-merge・ideal-panel（フェーズ 1）・owned-overlay | L |
| 6 | [route-cleanup](#route-cleanup-継承ルートの整理) | popovers・owned-rows（フェーズ 1）・owned-overlay | M |
| 7 | [bell](#bell-ベルと通知の整理) | autoreg-success（フェーズ 1）・goals-merge（目標の通知の形） | M |
| 8 | [autoreg-visibility](#autoreg-visibility-自動登録の状況を見えるように) | header-frame（フェーズ 1）・bell | M |
| 9 | [settings](#settings-設定の整理) | header-frame・bell・goals-merge | M |
| 10 | [roles](#roles-役割ごとの案内とワールドの登録) | participant-self（フェーズ 1）・settings | M |

- **統合プランの表との違い**: 統合プランの表では owned-overlay が goals-merge の後（5 番目）にある。register-dialog の参照列の「所持 ♂n ♀m」（F018）と、goals-merge の目標の行の「所持 n 体（親になれる数）」は、owned-overlay で作る共通の集計を使うので、**owned-overlay を find-merge の直後（2 番目）に移した**（owned-overlay 自体の依存は stable-render と、重ねる先の配合を探すだけなので、前に移しても困らない）。roles は settings が組み直したセーブ連携のカード・ワールドの登録モーダルの上に積むので、settings の後にした（統合プランでも同じ並び）。
- 実装は直列（同じファイルを触るテーマが多い）。1 テーマ＝1 ブランチ `feature/<テーマ key>` → 日本語のコミット → `main` に `--no-ff` でマージ。push と配信はユーザーの確認後。

## 全テーマ共通のやり方と受け入れ条件（このフェーズで特に効くもの）

1. **1 テーマの手順**: この文書の節と、付録の案の全文（catalog.md の `### <ID>`。「直し」を優先して読む。ただし統合プランの要点・この文書と食い違えばこちらが優先）・別プランの F 番号の節を読む → 現状のコードを開いて確かめる → 振る舞いが変わる所はテストを先に直す・足す（`node --test`）→ 実装 → `npm test` → モック（`npm run dev` → `http://localhost:5173/?mock=1&seed=80`）で画面を確かめる → `web/js/release-notes.js` の先頭に 1 件（title 20 字・body 60 字以内。**移動・削除した機能は「どこへ移ったか」を書く**。不具合の修正でも足す）。
2. **INV-2**: 配合の候補は登録済みの記録だけから引く。配合表（`web/data/breeding.js`）を読めるのは `auto-register.js` だけ、遺伝の仕組み（`core/ideal.js`）を読めるのは `views/ideal.js` だけ（`test/import.test.js:27-44`）。このフェーズで新しく作るモジュールは、どちらも import しない。自動登録の候補の子（`candidate.record.childId`）は配合表で決めた値なので、**画面に出さない**（照合にだけ使う INV-2 の例外 (a)）。
3. **セキュリティ**: `innerHTML`・`outerHTML`・`insertAdjacentHTML`・style 属性の文字列は使わない（`test/static/security.test.js:15-22`）。SVG は `createElementNS`、名前・メモ・説明は `textContent`、動的な配置は `style.setProperty`。CSP（`web/index.html:6`）は緩めない（`img-src 'self' data:` は今のまま使える）。
4. **保存データの互換**: 新しく保存する値は、フェーズ 1 の data-boundary の検証を通す。古い localStorage・古い通知・旧コードのまま開いているタブが混ざっても壊れない。**旧コードのタブは storage イベントで読み直して自分の形で書き戻す**（`app.js:324-329` → 各ストアの `reload`）ので、旧コードが知らない項目を既存のキーの中に足さない（別のキーに持つ）。
5. **性能の予算**（Chrome で測る）: 所持パル 2,000 行で最初の 200 行が 100ms 以内・全行が 1 秒以内、DOM は 80,000 ノード以下・JS ヒープの増加は 150MB 以下。20,000 行・偏った種族の分布でも入力が 100ms 以上止まらない。このフェーズで関係するのは owned-overlay の集計（所持パルのデータが変わったときに 1 回だけ）と、配合を探すの全件表示。
6. **描画の契約**（フェーズ 1 の render-contract・stable-render）: ビューは `applyRoute(route)`（URL の条件を部品に同期）と `update(state)`（データの描き直し）を持つ。同じ画面の中での条件の変更は `context.update(hash)`（フェーズ 1a の決まりで、既定は今と同じ「1 選択＝1 履歴」の pushState。履歴を増やさない変更（文字の入力・開閉など）は `context.update(hash, { replace: true })`）、画面をまたぐ移動は `context.navigate(hash)`。行は `syncList(container, items, { key, create })` で差分更新し、部品は `{ element, update, destroy }` を返す。document・window のリスナーは AbortController で外す。
7. **壊れるテスト**: 文言・DOM 構造を固定しているテストが多い。各テーマの「テスト」に、今の行番号で挙げた（フェーズ 1 で書き換わっていることがあるので、着手のときに `grep` で探し直す）。文言の更新と振る舞いの回帰確認は分けてコミットするとレビューしやすい。
8. **フェーズの終わり**: 観点別のエージェントと Codex（読み取り専用）で差分をレビューし、直してから次のフェーズへ。Codex は、先にシェルが起動するかを確かめる（この環境では起動に失敗し、ファイルの読み取りは node_repl で行えていた。codex-reviews.md の「7 回目」）。Codex を使う前にユーザーに目的を説明して許可を得る（プロジェクトの CLAUDE.md・グローバルの規約）。
9. **タブの定義の場所**: フェーズ 1d の copy-dead-ends で、`app.js:103` の `tabs` は `web/js/views/tabs.js` の `TABS`（と `tabLabel`）に移っている（phase-1d の copy-dead-ends の手順）。この文書の「`app.js:103` の `tabs` から外す」「ラベルを『配合を探す』に」は `TABS` で行う（各画面の h1 も `tabLabel` から引くので、ラベルを変えれば見出しも変わる）。（2026-10-12 の最終確認で足した）

## フェーズ 2 の完了の条件（全テーマを終えたとき）

- [ ] レールのタブが 5 本（配合を探す／継承ルート／所持パル／理想個体／設定）。ヘッダーに「＋ 登録」がない。
- [ ] 旧 URL（`#/reverse?c=X`・`#/list`・`#/drafts`・`#/wishlist`）を開くと、履歴を増やさずに統合後の画面に着く（ブックマーク・保存済みの通知の href も同じ）。
- [ ] 旧ウィッシュリストのデータ（`pal-note.wishlist.<env>.<user>`）がある状態で起動すると目標に移り、既読と通知が引き継がれる。繰り返し起動しても同じ結果。100 件を超える分は「未移行」として残り、移行元は消えない。
- [ ] 旧コードのタブ（フェーズ 1 の版）を開いたまま新しい版を開いても、下書きの性別・目標の観測の状態・移行の記録が消えない。
- [ ] 設定から「データの状態」「通知」カードが消え、「書き出し」「この端末のデータ」がある。プロジェクトの CLAUDE.md:16 と `ui/notifications.js` の「設定タブの通知一覧」の記述が直っていて、変更記録がある。
- [ ] `npm test` が通る。`npm run test:perf` が予算内。モックで 10 テーマの画面を確かめた（下の各テーマの「完了の条件」）。
- [ ] `docs/OPERATIONS.md`・`README.md` のタブ名・手順の記述を新しい構成に合わせた。

---

## find-merge: 配合を探すに統合

### 目的
配合検索・逆引き・一覧の 3 画面を、条件帯 1 本の「配合を探す」（`#/search`）にまとめる。親・子・登録者・並べ替え・キーワードを同じ画面で組み合わせ、何も選ばなければ全件を出す。

### 経緯
- **D1**（別セッションでのユーザーの回答。本セッションの「配合検索と逆引きを統合」を含む）。別プランの F007〜F013、本セッションの S-01（3 枠の 1 画面）・G-34（タブの再編）・S-36（件数）・S-38（子ごとの要約チップ）・S-44（空の案内）・S-45（同じ組の複数の結果）・V-37（カードの列）・S-24（条件帯の固定）・S-25（キーワード）・S-26（登録者の選択）・S-27（見出しでまとめる）・S-31（既定の並べ替え）・S-33（件数の言い方）・G-29（NEW）・V-25（増えた行を光らせる）。
- 調査の時点では、一覧まで含めて 1 画面にする S-02 は「2026-10-04 に一覧のパル絞り込みを外したばかり（b719187）」として却下、S-31 は「既定は parent-dex のまま」、S-25 は「パル名は対象にしない」と判断していた。**D1・D6 でこれらは覆った**（rejected.md の S-02・S-29 の「統合プランとの関係: 覆った」）。案の「直し」に残る「一覧は今の役割で残す」「既定は parent-dex」「パル名は探さない」は採らない。
- **D6**: 並べ替えの既定は「更新日の新しい順」。キーワードは親・子の名前・メモ・登録者を空白区切りで探す。親・子の並びでは「見出し（モコロン 3 件）＋短い式」でまとめ、1 件 2 行の展開（`core/record-sort.js:9-14` の parentRows。b719187）をやめる（F012）。
- Codex のプランレビュー 1 回目 11（逆引き URL の正規化とリンクの移行）・6 回目 5（旧 URL の切り替えの時期）: **旧 URL は、移行先ができたテーマで読み替える**。このテーマでは `#/reverse?c=` と `#/list` だけ。`#/drafts` は register-entry、`#/wishlist` は goals-merge で読み替える。
- 別プラン §9「抜けの補足」: 検索結果 0 件のときの「この組み合わせを登録」（`views/search.js:25-28`）は統合画面でも残す。登録者の選択は件数が多ければ検索つきにし、同じ名前は見分ける。

### 依存
- render-contract（`context.update`・`applyRoute`・`update` の分離）、popovers（パル選択の部品。記録を探す画面で登録件数を出す S-19 はフェーズ 1 の popovers で入る）。
- stable-render（`ui/dom.js` の `syncList`・画面用の変更番号）、keep-state（履歴エントリごとの条件・位置の保存、最後のタブの許可リスト）、copy-dead-ends（h1＝タブ名）、header-frame（`--header-h` などの CSS 変数）も入っている前提。

### このテーマでやらないこと
- 下書きの帯・登録の入口（register-entry）、所持数の重ね表示と「手持ちで組める」（owned-overlay）、「目標に登録」（goals-merge）、相手親の配合ツリー「▸ この親の配合 n 件」（フェーズ 3 の route-progress）、パル詳細のドロワー化（フェーズ 3 の pal-detail）。
- パル詳細（`#/pal/<id>`）の 2 つの欄はこのテーマでは残す（フェーズ 3 でドロワーのハブに作り直す）。
- 仲間の新しい登録をベルの通知元に足すこと（G-29 の判断で見送り）。

### 現状（HEAD ad648b7 で確認）
- タブは `web/js/app.js:103` の `tabs`（9 本）。ビューの対応は `app.js:208`。`router.js:1` の `views` が受け付ける画面名で、知らない名前は `search` になる（`router.js:10`）。旧 URL の読み替えの仕組みはない。
- 配合検索 `views/search.js`（38 行）: 親1・親2 の 2 枠。両方なら `findByPair`、片方なら `findByParent(p1 || p2)`（`:24`）。未選択の案内は「親を選んで、仲間と記録した配合を探しましょう。親1だけでも探せます。」（`:22`。実際は親2だけでも探せる。S-44）。0 件の「この組み合わせを登録」（`:26-28`）は `childId` を渡さない。件数の行は 2 件以上の同じ組で「同じ組み合わせで結果が複数登録されています」になり件数が消える（`:31`）。
- 逆引き `views/reverse.js`（28 行）: 子 1 枠で `findByChild`（`:19`）。0 件で「この子の配合を登録」（`:21-23`）。件数の行がない（S-36）。
- 一覧 `views/list.js`（52 行）: 見出し「みんなの配合ノート」（`:9`）、登録者名の自由入力の部分一致（`:10-12`・`:39-40`。ひらがな・カタカナはそろえない）、並べ替え 5 種（`:13-18`。既定は先頭の `parent-dex`）、絞り込みは `viewState('list')` のメモリだけ（`:21-23`）。親の並びでは `parentRows` で 1 件を 2 行に展開し「80 件の配合 · 160 件を表示」（`:41-43`）。sticky はない。
- カード `ui/breeding-card.js:45-63`: 式（`breedingEquation` `:28-43`。`focusParent` で「相手 → 子」、`leftParent` で左の親を決める）・登録者と更新日・メモ（`:53`。`.card-memo` で 2 段目に全文）・編集と削除。
- キーワードの正規化は `core/kana.js` の `normalizeQuery`（ひらがな→カタカナ・NFKC・小文字）。所持パルの語分けは `core/owned.js:259` の `keywordTerms`（空白区切り）。
- 旧画面へのリンクを作っている所: `views/route.js:196`（「目標の逆引きを見る」→ `#/reverse?c=`）、`wishlist.js:184`・`views/wishlist.js:52`（`#/reverse?c=`）、`auto-register.js:221`（食い違いの通知の href が `'#/list'`）。保存済みの通知には古い href が残る（自動登録の通知は localStorage に最大 50 件）。
- CSS: `.list-filters`（`app.css:685-688`）、`.card-stack`（`:521`。1 列）、`.result-note`（`:568`。件数の行に高さの確保なし → フェーズ 1 の stable-render で min-height が入る）。

### 実装の手順
1. **ルーターの読み替え**（`web/js/router.js`）
   - `views` から `reverse`・`list` を外す（`drafts`・`wishlist` は後のテーマまで残す）。
   - 旧画面の表 `const LEGACY = { reverse: 'search', list: 'search' };` を作り、`export function canonicalHash(hash)` を足す: 旧画面名なら新しいハッシュ（`#/reverse?c=X` → `#/search?c=X`、`#/list` → `#/search`、`#/list?sort=updated` → `#/search?sort=updated`）を、そうでなければ `null` を返す。表の値は、後のテーマで「画面名とパラメータを返す関数」に広げてよい（register-entry は `drafts=1` を足す）。
   - `parseHash` も旧画面名を読み替えた結果を返す（`remember()` やテストが旧ハッシュを渡しても新しい画面になるように）。
   - `startRouter` の `change()` で、`k` の除去と同じ場所で `canonicalHash` を当て、違えば `browser.history.replaceState(browser.history.state, '', …)` で書き換えてから `onChange` を呼ぶ（**履歴を増やさない**）。register-entry・goals-merge はこの表に 1 行ずつ足す。
2. **検索の中身を core に切り出す**（新規 `web/js/core/record-search.js`。DOM を持たない）
   ```js
   // 登録済みの記録だけを引く（INV-2）。配合表・core/ideal.js は使わない。
   export const RECORD_SORTS = Object.freeze([
     ['updated', '更新日の新しい順'], ['parent-dex', '親の図鑑番号順'], ['parent-name', '親の五十音順'],
     ['child-dex', '子の図鑑番号順'], ['child-name', '子の五十音順'],
   ]);
   export function searchRecords(index, records, { p1 = '', p2 = '', c = '', by = '', noRegistrant = false, terms = [] }, palsById) {} // → 記録の配列
   export function groupRecords(records, sort, palOrder, palsById) {} // → [{ key, palId, records }]（updated のときは見出しなしの 1 群）
   export function registrantCounts(records, users, me) {} // → [{ value, label, count }]
   ```
   - 引き方: 親1＋親2 → `findByPair`、親が片方 → `findByParent`、子だけ → `findByChild`、何もなし → `records`（`state.records`）。複数の条件は積集合（親＋子なら `findByParent` の結果を `childId === c` で絞る。3 つとも → 一致する登録があるかの確認）。
   - 登録者: `by` があれば `userIdKey(record.registrant) === userIdKey(by)`、`noRegistrant` なら `record.registrant === ''`。`registrantCounts` は「すべて（N）」「自分（ID）（n）」を先頭に、残りを件数の多い順（同数は五十音）、記録にしか出てこない古い名前（名前の変更の前など）も、登録者が空の記録があれば「登録者未指定（k）」も返す。
   - キーワード: 語はすべて含む（AND）。1 件ごとの探す文字列（親1・親2・子の和名・英名・図鑑番号、登録者、メモを `normalizeQuery` して空白でつないだもの）は `WeakMap<record, string>` に覚える（記録は変更のたびに新しいオブジェクトになるので古い値は自然に捨てられる）。語分けは `core/kana.js` に `export function queryTerms(query)` を足し（中身は今の `keywordTerms` と同じ）、`core/owned.js:259` の `keywordTerms` はそれを呼ぶだけにする（振る舞いは変えない）。
   - 並べ替え: `updated` は `recordComparator('updated', …)`（`core/record-sort.js:16-31`）をそのまま。親・子の並びは**1 件 1 回**にし、`groupRecords` で見出しの単位に分ける。親の並びでは、並び順で先に来る方の親の群に入れる（同じ親どうしは 1 群）。子の並びでは子の群。群の中は相手の親（子の並びでは親の組）の順、最後は記録 ID。もう一方の親から探したいときは親1 の欄で選べば出る（全件表示で 2 回出す必要がなくなった）。`parentRows` は呼び出し元がなくなったら `core/record-sort.js` から消し、`test/core/record-sort.test.js` の該当分も直す。
3. **URL の形**（`#/search` のパラメータ）: `p1`・`p2`・`c`（パル ID）、`by`（登録者の ID）、`noreg=1`（登録者未指定）、`sort`（既定の `updated` は書かない）、`q`（キーワード）。旧 `list` の画面は URL を読まなかった（`views/list.js:7` は route を受け取らない）ので、旧 URL の互換は `#/list` → `#/search` だけでよい。
4. **画面 `views/search.js` を作り直す**（`reverse.js`・`list.js` は消す）
   - 見出し: h1「配合を探す」（copy-dead-ends の見出し＝タブ名に合わせる）。
   - 条件帯 `div.find-bar`（sticky。`top: var(--header-h)`、z-index はヘッダーの変数の「固定のパネル」の値、背景あり）: [親1][親2][子]（`palPicker`。ラベルは「親1」「親2」「子」。aria-label が重ならないこと。フォーカスの引き継ぎがラベルで探すため）、[登録者]（select。選択肢は `registrantCounts`。12 件を超えたら、owned-toolbar で作る「検索つきの選択」部品があればそれを使う。同じ名前は出ないので uid の短縮は要らない）、[並べ替え]（`RECORD_SORTS`）、[キーワード]（`input type=search`、placeholder「パル名・メモ・登録者（空白で複数）」）。1100px で 1 行に収まらなければ 2 段まで（高さの予算 約 120px）。
   - 条件の変更は `context.update(buildHash('search', params), opts)`。**キーワードの入力は `{ replace: true }`**（1 文字ごとに履歴を積まない）。**パル・登録者・並べ替えの選択は、フェーズ 1a の決まり（`context.update` の既定＝「1 選択＝1 履歴」。今の `navigateSelection` と同じく、戻るで前の選択に戻れる）**に合わせる（フェーズ 1 の実物が違う決まりになっていればそれに合わせ、迷ったら今の振る舞いを保つ）。キーワードは `input` で、`event.isComposing` の間は何もしない。`compositionend` と、変換していない `input` のときだけ `context.update`。入力中の欄の値は `applyRoute` で上書きしない（`document.activeElement === input` なら値を触らない）。
   - `applyRoute(route)`: パルの欄・select・入力の値を route に同期し、`update(state)` を呼ぶ。無効なパル ID は今の `validId`（`views/shared.js:13-20`）と同じく外して `context.replace`。
   - 件数の行（条件帯の右端、または帯の直下の固定の高さの行）: 常に「N 件」。同じ組で 2 件以上なら「2 件 · 同じ組み合わせで結果が複数あります」、すべての記録に親の性別が入っていて組ごとに違うときだけ末尾を「親の性別で子が変わります」（S-45 の判断。「誤りかもしれません」は使わない）。以前の「· M 件を表示」は出さない。
   - 一覧: `updated` のときはカードを 2 列（`.card-grid`。`repeat(auto-fill, minmax(440px, 1fr))` を目安に、幅 1100px で 2 列になり式が折り返さないことを画面で確かめて最小幅を決める）。親・子の並びのときは群ごとに見出しの行（`role="heading"`・`aria-level=2`。「[アイコン] No.1 モコロン · 3 件」）を差し込み、群の中のカードは短い式（親の並び＝`focusParent` で「相手 → 子」、子の並び＝「親 ＋ 親」。`breedingEquation` に `omitChild` を足す）。見出しは sticky にしない・畳まない（S-27 の判断）。
   - カードは 2 行（1 行目: 式、2 行目: 登録者 · 更新 · メモ）。メモは 1 行で省略（`white-space: nowrap; text-overflow: ellipsis`）し、`title` に全文。削除・統合・重複の確認のプレビュー（`app.js:184,193`、`ui/record-editor.js:131,141`、`views/drafts.js:38`）は全文のまま（`breedingCard` に `compactMemo` を足して、配合を探すからだけ指定する）。式の列は上限つきで左に寄せる（`grid-template-columns: minmax(0,240px) 18px minmax(0,240px) 18px minmax(0,240px)`。V-37 の判断）。
   - 行は `syncList` で差分更新する。キーは表示の向きを含める（例: `${groupPalId}:${record.id}`。stable-render の決まり）。見出しの行も同じ syncList に `heading:<palId>` のキーで混ぜる（並びが群ごとに決まるため）。（追記 2026-10-13: stable-render で、配合のカードは views/shared.js の `renderCards(target, items, context, { empty })`〔items は `[{ record, leftParent?, focusParent? }]`〕と `cardKey`〔`id|向き|etag|updatedAt`。中身の版も含む〕になった。カードのボタンには `data-focus`〔`edit`・`remove`〕。`.card-stack` は `overflow-anchor: none`〔並べ替えで行を使い回してもブラウザが画面を追いかけない〕。新しく増えたキーは `listKeys` で前のキーと比べて分かる）
   - 子ごとの要約チップ（S-38 の判断）: 親が片方だけで結果が 6 件以上のとき、件数の行の下に 1 行で「[アイコン] 子の名前 n」を並べる（はみ出したら横スクロール）。押すと `c` を入れる（＝子で絞る。もう一度押すと外す）。
   - 空の状態: 何も選んでいなくて記録が 0 件 → 「まだ配合が登録されていません」＋「配合を登録」。条件で 0 件 → 親 2 体なら「この組み合わせはまだ登録されていません」＋「この組み合わせを登録」（`context.register({ parent1Id, parent2Id, childId })`。子も渡す）、親が片方なら「この親を使う配合はまだ登録されていません」＋「この親で配合を登録」、子だけなら「この子の配合はまだ登録されていません」＋「この子の配合を登録」、登録者・キーワードで 0 件なら「条件に合う登録はありません」＋「条件をすべて解除」。
   - NEW（G-29 の判断）: 画面を開いたときに `${namespace}.search.seenAt.${userIdKey}` を読み、他人の登録で `createdAt` がそれより新しいカードに「新」のチップ（色だけに頼らない）。時刻は画面を離れるとき（`destroy`）に更新する。件数の行に「新着 n 件」を出し、押すと並べ替えを `updated` にする。localStorage の読み書きは try/catch（読めなければ新着なしとして扱う）。初めて開いたとき（値がない）は全部を新着にせず、今の時刻を書くだけ。
   - 増えた行を光らせる（V-25 の判断）: 表示中に syncList で**新しく増えたキー**の行に `is-new` を付け、`prefers-reduced-motion: no-preference` のときだけ 1.2 秒で消える淡い背景。最初の描画と条件の変更では付けない。
5. **タブとリンクを移す**
   - `app.js:103` の `tabs` から `reverse`・`list` を外し、`search` のラベルを「配合を探す」に。`app.js:26,28,208` の import と対応を消し、`views/reverse.js`・`views/list.js` を削除。`ui/nav-icons.js:4,6` の `reverse`・`list` のアイコンを消す（追記 2026-10-14: visual-parts の後は、アイコンの定義は `web/js/ui/icons.js` の `ICONS` にある。nav-icons.js は `navIcon(view)` だけ）。空の状態の `empty(…, { icon: 'list' })` を使う画面も合わせて直す。レールのグループの区切りの CSS（`data-view` の margin。G-34 の根拠 `app.css:1230-1232` 付近）を新しい並びに合わせる。
   - keep-state の「最後のタブは許可した画面名だけ localStorage に」の許可リストから `reverse`・`list` を外す（古い値が残っていても `search` に落ちる）。sessionStorage・history.state に残った旧画面の条件は、版が合わないものとして捨てる。（追記 2026-10-13、keep-state の実装: 許可リストは app.js の `tabs` から作るので、タブを外せば外れる。一覧の条件は app.js の `CONDITIONS.list` と views/list.js の `LIST_MEMORY` で保存しているので、一緒に消す。旧画面のエントリは画面名と URL が合わないので読み戻されない）
   - 追記（2026-10-13、D28）: 所持パルの行の操作は「親にして検索」（`views/owned.js` の `ownedRowLinks`。行き先 `buildHash('search', { p1 })`）の 1 つだけになった（2026-10-13 のユーザーのフィードバックで所持パルの行の「目標に」「ここから継承ルート」はなくした）。タブの名前を「配合を探す」にするときは、ボタンの文字（`text`）と title の「配合検索」も合わせて直す（例「親にして探す」）。（追記 2026-10-14、D29: 所持パルの行の操作はなくした〔`ownedRowLinks` もない〕ので、この直しは要らない。親・逆引き・継承ルートの検索はフェーズ 3 の owned-detail のドロワーに置く）
   - リンクを新しい形に: `views/route.js:196` → `buildHash('search', { c: to })`、文言「目標の配合を見る」。`wishlist.js:184`・`views/wishlist.js:52` → `buildHash('search', { c })`（通知の id は変わらないので既読は保たれる。goals-merge でこのファイルごとなくなる）。`auto-register.js:221`（食い違いの通知）→ `buildHash('search', { p1: candidate.record.parent1Id, p2: candidate.record.parent2Id })`（D-03 の前倒し。フェーズ 1 の inv2-notice・autoreg-success で関数が書き換わっているので、`conflictNotice` を探して直す）。保存済みの古い通知の `'#/list'` は手順 1 の読み替えで開ける。
6. **後片づけ**: `.list-filters` などの使わなくなった CSS を消す。`docs/OPERATIONS.md:99` の「一覧（所持パル・みんなの配合ノート）…最初から全部出す」は「所持パル・配合を探すの全件表示」に言い換える（全部出す方針は変えない）。`README.md:19` の「検索（配合検索・逆引き・継承ルート）」を「配合を探す・継承ルート」に。

### 触るファイル
- 変更: `web/js/router.js`、`web/js/app.js`、`web/js/views/search.js`（作り直し）、`web/js/views/shared.js`（必要なら）、`web/js/ui/breeding-card.js`（`omitChild`・`compactMemo`）、`web/js/core/kana.js`（`queryTerms`）、`web/js/core/owned.js`（`keywordTerms` を `queryTerms` に委ねる）、`web/js/core/record-sort.js`（`parentRows` を消す）、`web/js/ui/nav-icons.js`、`web/js/views/route.js`、`web/js/wishlist.js`、`web/js/views/wishlist.js`、`web/js/auto-register.js`（conflictNotice の href）、`web/css/app.css`、`web/js/release-notes.js`、`docs/OPERATIONS.md`、`README.md`
- 新規: `web/js/core/record-search.js`、`test/core/record-search.test.js`
- 削除: `web/js/views/reverse.js`、`web/js/views/list.js`

### テスト
- 新規 `test/core/record-search.test.js`: 引き方の組み合わせ（親1＋親2・片親（親1 でも親2 でも）・子・親＋子・3 つ・なし→全件）、登録者（ID の大小・全半角をそろえる・未指定）、キーワード（ひらがな／カタカナ・英名・図鑑番号・メモ・登録者、空白区切りの AND）、並べ替え 5 種と群の分け方（親の並びで 1 件 1 回・先に来る親の群）、`registrantCounts`（自分が先頭・古い名前・未指定）。
- `test/web/router.test.js`: `#/reverse?c=X` → `#/search?c=X`、`#/list` → `#/search`、`replaceState` で履歴が増えないこと（`:28-66` と同じ偽のブラウザで、`history.state` が保たれること）。`buildHash('reverse')` は `#/search` になる。
- `test/web/views.test.js`: `:8-10` の import、`:22-31`（初期の欄は 3 つ）、`:33-51`（件数の文は「1 件」に）、`:70-77`（`:75` の文言）、`:79-89`、`:101-133` の一覧のテスト（既定が `updated`・1 件 1 回・群の見出し・「· 4 件を表示」がない・登録者が select・キーワード）を配合を探すのテストに書き換える。**`views.test.js:54-67`（継承ルートの旧 URL `exclude=`）は回帰テストとして残す**（cleanup-dead-code の決まり。入れ替えボタンの確認は route-cleanup で外す）。
- `test/web/app.test.js`: `:159,204,221,244,274` は `hash: '#/list'` で起動している（同期・送信のテストで、一覧の中身には依存していないはず）。読み替えで `#/search` に着くことを確かめ、必要なら `#/search` に直す。`:303-323` の逆引きの × のケース（`['#/reverse?c=SheepBall', '#/reverse', '生まれる子']`）は `['#/search?c=SheepBall', '#/search', '子']` に。`:325-356`（タブの記憶）は「一覧」「逆引き」のタブがなくなるので、配合を探すの登録者・キーワードの記憶に書き換える（`:332`・`:345-346`・`:354`）。
- `test/web/wishlist.test.js:136,153,394`・`test/web/app.test.js:497,504` の href `#/reverse?c=` → `#/search?c=`（goals-merge でさらに書き換わる）。`test/web/notifications.test.js:134-162` の `#/reverse?c=MoonQueen` は href の形の例なのでそのままでよい。
- `test/web/auto-register.test.js`: 食い違いの通知の href を確かめている所があれば `#/search?p1=&p2=` に（別プラン §9 の C の `auto-register.test.js:235,241,356,406,474` 付近）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 引くのは登録済みの記録（`state.records`・`state.index`）だけ。`core/record-search.js` は `core/index.js`・`core/kana.js`・`core/user.js`・`core/record-sort.js` 以外を import しない。
- 互換: 旧 URL の読み替えは「履歴を増やさない」こと（戻るで旧 URL に戻ってまた読み替える、を繰り返さない）。keep-state が保存した旧画面の条件・最後のタブ（`reverse`・`list`）は捨てる。
- セキュリティ: メモ・登録者名は `textContent`。title にも文字列をそのまま入れる。
- 性能: 記録が数千件でも、キーワードの文字列は WeakMap で 1 回だけ作る。群分けは並べ替え 1 回。描画は syncList で差分だけ。カードの `content-visibility` の推定の高さは新しいカードの高さに合わせる（sticky の要素には付けない）。

### release-notes の案
- id: `<実装日>-find-merge`／title: 「配合を探すに統合」（8 字）／body: 「配合検索・逆引き・一覧を「配合を探す」にまとめました。親・子・登録者・キーワードで絞れます。」（46 字）

### 完了の条件
- [x] `npm test` が通る（新しい `record-search.test.js` を含む）。
- [x] モックで: 親1／親2／子のどれから選んでも登録済みの配合が出る。親＋子で「A と何を組めば C か」が引ける。何も選ばないと全件が更新日の新しい順で出る。キーワード「もこ」でモコロンを含む記録と、メモに「モコ」を含む記録が出る。
- [x] `#/reverse?c=SheepBall`・`#/list` を開くと配合を探すに着き、戻るで旧 URL に戻らない。
- [x] 実測: 親を選んでも結果の先頭が動かない（今は +27px）。scrollY=2500 で並べ替えを変えても条件帯が画面に残る（今は先頭へ戻り、帯も流れる）。
- [x] レールのタブが 7 本。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 引くのは登録済みの記録だけで、`core/record-search.js` は index・kana・user・record-sort 以外を import しない（`test/import.test.js`）。互換 — 旧 URL の読み替えで履歴が増えない。keep-state が残した旧画面の条件と最後のタブ（reverse・list）は捨てられる。`seenAt` が読めなくても壊れない。セキュリティ — メモ・登録者名は textContent（`test/static/security.test.js`）。性能 — 記録が数千件でも、キーワードの入力で 100ms 以上止まらない（探す文字列は WeakMap で 1 回だけ作る）。

### TODO
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


### 実装の記録（2026-10-15、ブランチ `feature/find-merge`）

実装のときに決めたこと・文書と違う形にしたこと（後のテーマ owned-overlay・register-entry・register-dialog・goals-merge と、フェーズ 3 の pal-detail・route-progress はこちらを正とする）。文書の file:line（ad648b7）は関数名・文字列で探し直した。

1. **ルーター（手順 1）**: `views` から `reverse`・`list` を外し、`LEGACY = { reverse: 'search', list: 'search' }`（画面名 → 移った先の画面名。クエリはそのまま渡す）と **`canonicalHash(hash) → string | null`** を足した。`parseHash` も旧画面名を読み替えた route を返す（`#/reverse?c=X` → view `search`・params `c=X`。旧画面の id は捨てる）。`buildHash('reverse')` は `#/search`。`startRouter` は `k` を外した後に `canonicalHash` を当て、違えば `history.replaceState(history.state, '', …)`（state は保つ）してから onChange を呼ぶ。register-entry・goals-merge は `LEGACY` に 1 行ずつ足す（`drafts=1` のように行き先でクエリを足すなら、表の値を関数に広げる）。
2. **`queryTerms`（手順 2）**: フェーズ 1 ですでに `core/kana.js` にあり、`core/owned.js` の `keywordTerms` もそれを呼んでいた（変更なし）。
3. **`core/record-search.js`（手順 2）**: 文書の 3 関数に加えて、**`searchBase(index, records, { p1, p2, c, terms }, palsById)`**（登録者の条件を除いた検索）・**`byRegistrant(records, { by, noRegistrant })`**・**`childCounts(records, palOrder)`**（子ごとのチップ）・**`pairNote(records)`**（件数の行の添え書き。`'multi'`・`'gender'`・`''`）・**`recordSort(value)`**（知らない値は既定）・`RECORD_SORT_DEFAULT`（`'updated'`）を export した。`searchRecords` は `byRegistrant(searchBase(…))`。画面は登録者の選択肢の件数を「登録者以外の条件で絞った中の件数」にするため、`searchBase` と `byRegistrant` を分けて呼ぶ。
   - `registrantCounts(records, { users, me })` の戻り値は `[{ value, label, count, kind }]`（kind は `all`・`self`・`user`・`none`）。自分は 0 件でも出す。名前は `users`（store の今の ID の一覧）に同じ ID があればその書き方、なければ記録の中でいちばん多い書き方。
   - `groupRecords(records, sort, palOrder, palsById, { focusParent })` の 5 つ目の引数を足した: **親を 1 体だけ選んでいるとき（focusParent）、parent-* ではその親を含む記録をすべてその親の群に入れる**（前の配合検索と同じ「相手 → 子」の並び。入れないと、選んだ親より並び順で先に来る相手の群に分かれる）。同じ順位の並び（五十音で同じ名前など）は図鑑順 → ID で決める。
   - `core/record-sort.js` に **`palComparator(sort, palOrder, palsById)`** を足し、`recordComparator` と `groupRecords` で使う。`parentRows` は消した。
4. **カード（手順 4）**: 文書の `compactMemo` は **`compact`** という名前にした（メモだけでなく形が変わるため）。`breedingCard(record, context, { …, omitChild, compact, isNew })`: `compact` は `article.breeding-card.is-compact` で、メモを `span.card-memo`（title に全文）として `.card-meta` の中に入れる。`isNew` は `statusChip('新', 'info', 'new-chip')` を meta の先頭に。`breedingEquation(record, { focusParent, leftParent, omitChild })` の `omitChild` は「→ 子」を出さない。確認のプレビュー（削除・統合・重複）と下書きは今までどおり全文。
   - **2 列のカードで式が折り返す**ので形を変えた: 1100px の 2 列（カード 457px）で操作を 1 行目に置くと、パルの絵と名前の列が約 110px になり、6 文字の名前（ヴィオレッタなど）も折り返した。**操作（編集・削除。28px に詰めた）を 2 行目の右端に移し、式をカードの幅いっぱい**にした（列 約 135px。7 文字まで折り返さない。8・9 文字のコラボの 7 体〔グリーンスライム・どうくつコウモリなど〕だけ 2 行になる）。カードの高さは 77px（8 文字以上の名前がある行は 93px）。式の列は `minmax(0, 1fr) 18px` × 3 で、見出しの下の短い式（相手 → 子・親 ＋ 親）も同じ列の幅（左の 2 列）にそろえた（文書の `minmax(0, 240px)` は、短い式で矢印の後ろが大きく空いたのでやめた）。
5. **画面 `views/search.js`（手順 4）**: `section.view.find-view` の中に h1・**`section.find-bar`**（sticky。`aria-label="配合の条件"`。高さは `trackHeight` で `--panel-h`）・`div.find-child-chips`・`div.find-results`。
   - 帯の 1 段目 `div.find-bar-main`: [親1] ＋ [親2] → [子]（`palPicker`。ラベルは「親1」「親2」「子」。注記は `recordCountNotes` の親・子）と `label.field.find-keyword`（キーワード。placeholder「パル名・メモ・登録者（空白で複数）」）。2 段目 `div.find-bar-sub`: `panelLine(panelItem('登録者', searchSelect), panelItem('並べ替え', select))` と右端の **`p.result-note.find-count`**（aria-live=polite。`span.find-count-text`「N 件」・`span.find-count-note`・`button.find-new`）。見出しと区切りの CSS は理想個体・所持パルのパネルの共通の決まり（`:is(.ideal-panel, .owned-panel, .find-bar)` にした）。**帯の高さは 1100px で 104.88px**（予算 約 120px）。
   - 登録者は `ui/search-select.js` の `searchSelect`（12 人を超えると検索つき）。値は `''`（すべて）・`by:<ID>`・`noreg`、URL は `by=<ID>`・`noreg=1`。選択肢は「名前 · N 件」（自分は「ID（自分） · N 件」）。URL の登録者が記録にいなければ「名前 · 0 件」を足して選んだままにする。開いている間に件数が変わったら `renderWhenIdle` で離れた後に合わせる。
   - 条件の変更は `changeRoute(context, hash, options)`（views/shared.js。**3 つ目の引数 options を足し、`context.update(hash, options)` に渡す**）。パル・登録者・並べ替えは既定（1 選択＝1 履歴）、キーワードは `{ replace: true }`（`onTextInput` で間引き 150ms・変換中は呼ばない。`flushInputs` で app.js が移る前に当てる）。URL は今の route のクエリを写して変える（知らないパラメータは残す。register-entry の `drafts=1` もそのまま通る）。入力中のキーワードの欄は `applyRoute` で上書きしない。
   - 並べ替えを変えたときと、`applyRoute` の理由が `update`（利用者が条件を変えた）のときは、結果の先頭が帯の下に隠れていればそこへ移す（`revealResults`。`.find-results` の `scroll-margin-top: var(--panel-h)`）。並べ替えは 2,000 行以下なら `withTransition`。
   - 件数の行の添え書きは**親を 2 体選んだときだけ**（全件・片親で「同じ組み合わせで結果が複数あります」はほぼいつも当たり意味がないため）。「· 同じ組み合わせで結果が複数あります」・すべての記録に親の性別があって子ごとに向きが違えば「· 親の性別で子が変わります」。
   - 子ごとのチップは、親が 1 体だけで、登録者・キーワードで絞った後の「その親の結果（子の条件を除く）」が 6 件以上のとき。`button.find-child-chip`（絵・名前・件数。`aria-pressed`）、押すと `c` を入れる・押されていれば外す。件数の多い順。
   - 空の状態: 記録が 0 件 →「まだ配合が登録されていません。」＋「配合を登録」（`context.register({})`）。登録者・キーワードがあり、それを外せば結果がある →「条件に合う登録はありません。」＋「条件をすべて解除」（親・子・登録者・キーワードを外す。並べ替えは残す。フォーカスはキーワードの欄）。親 2 体 →「この組み合わせを登録」（子を選んでいれば子も渡す）、親 1 体 →「この親で配合を登録」、**親 1 体と子 →「この親からこの子が産まれる配合はまだ登録されていません。」＋「この親と子で配合を登録」**（文書にない場合を足した）、子だけ →「この子の配合を登録」。アイコンは `search`（記録 0 件・条件の 0 件だけ）。
   - 新着: `context.seen`（**新しい `web/js/search-seen.js` の `createSearchSeen({ storage, namespace })` → `{ key, read(env, userId), write(env, userId, time?) }`**。キーは文書の `${namespace}.search.seenAt.${userIdKey}` に**環境を足した `${namespace}.search.seenAt.${env}.${userIdKey}`**〔記録は環境ごとのため〕。ISO の時刻だけ読み、読み書きの失敗は投げない）。最初にデータがある描画で読み、値がなければ今の取得の時刻（`store.state.serverTime`、なければ今）を書くだけ。他人の登録で `createdAt` がそれより後なら「新」。`destroy` で今の取得の時刻を書く（取得の時刻にしたのは、端末の時計とサーバの時計のずれで新着を見落とさないため）。「新着 n 件」は表示中の結果の中の数で、押すと更新日の新しい順。すでに更新日の新しい順なら aria-disabled（理由は title）。**ID の変更で新しい ID へ移す**（user-rename.js。移し先にあれば新しい方を残す）。
   - 増えた行を光らせる: 前の描画と条件が同じ（データの更新）で、前に出していなかった記録 ID のカードに `is-new`（同じ配合の楽観更新・etag の変化では光らせない）。CSS は `@keyframes find-new-row`（1.2 秒で淡い primary の地が消える）で、`animation` は既存の `prefers-reduced-motion: no-preference` のブロックの中に書いた（test/static/styles.test.js が最初のブロックの外の動きを禁じている）。
   - パルを選ぶと選択欄の中身（絵と 2 行の名前）が 40.6px になり帯が 0.6px 伸びたので、`.find-bar .picker-trigger { height: 40px }` で固定した（所持パル・理想個体のパネルにも同じ 0.6px があるが、このテーマでは触っていない）。
6. **タブと保存（手順 5）**: `views/tabs.js` の `TABS` から `reverse`・`list` を外し、`search` を「配合を探す」に（7 本）。app.js の import・`views`・`CONDITIONS.list`（`LIST_MEMORY`）を消した。最後のタブと読み込み直しの保存は `TABS` から作るので、古い `lastView`（`list`・`reverse`）とタブの行き先は使われない（`#/` で開くとハッシュのまま＝配合を探す）。ui/icons.js の `ICONS` の `reverse`・`list` を消した。ロゴの aria-label は「パル配合ノート（配合を探すへ）」。レールの区切りは `[data-view="drafts"]`・`[data-view="owned"]`（register-entry・goals-merge で下書き・ウィッシュリストが消えたら、記録のグループごと区切りを直す）。
7. **旧画面へのリンク（手順 5）**: 継承ルートの「目標の逆引きを見る」→「目標の配合を見る」（`#/search?c=`）、ウィッシュリストの通知の href と本文（「押すと配合を探すで…」）・一覧の行のリンク（「配合を見る →」）、理想個体の目標を持っていないときの「逆引きで親を探す」→「配合を探すで親を探す」、自動登録の食い違いの通知の href → `buildHash('search', { p1, p2 })`（その組）、パル詳細の「配合検索へ」→「配合を探すへ」。保存済みの通知の `#/list`・`#/reverse?c=` はルーターが読み替える。
8. **テスト**: 1,498 → 1,515 件（`npm test` exit 0）。足したもの: test/core/record-search.test.js（9 件）、test/web/search-seen.test.js（2 件）、router.test.js（2 件: 読み替え・replaceState で state を保つ）、views.test.js（配合を探す: 全件・子だけ・並べ替えと見出し・登録者・キーワード・光らせる・0 件の 6 通り・新着・子のチップ・キーワードの間引き・先頭へ移す）、user-rename.test.js（新着の基準の移動）、auto-register.test.js（食い違いの通知の href）。書き換えたもの: app.test.js（一覧で起動していた削除・同期のテストは `#/search` で起動。一覧の登録者名で確かめていた「タブを切り替えても残す」「読み込み直し」「ページを離れるとき」「間引きの間にタブ」「別のワールドのエントリ」は、配合を探すのキーワード〔URL とタブの行き先〕と所持パルのキーワード〔viewState〕で確かめる形にした。最後のタブが `list`・`reverse` のときを足した）・view-memory.test.js（例の画面名 `list` → `route`。`#/list` は parseHash が配合を探すに読み替えるため）・record-sort.test.js（parentRows の 2 件を消し palComparator を足した）・icons・ideal-view・wishlist の文言。
9. **画面（モック・1100×900。`Claude outputs/ui-audit-2026-10/shots/find-merge/`）**: 全件 80 件が更新日の新しい順で 2 列（`01-all-1100-light.png`）、親の図鑑番号順・子の五十音順で見出しの下に短い式（`02-…`・`03-…`）。親1 → 親2 → 子と選んでも結果の先頭は 230.56px のまま（前は +27px）。戻るで前の選択へ。`#/reverse?c=SheepBall` は `#/search?c=SheepBall`（子にモコロン）に着き、戻ると前の `#/search`（旧 URL に戻らない）。`#/list` → `#/search`。scrollY=2500 で並べ替えを変えると、帯（top 56px）は画面に残り、結果の先頭（169px）へ移る（`05-…`）。キーワード「すらいむ」で 3 件、履歴は増えず欄にフォーカスのまま。0 件で「条件をすべて解除」→ 80 件・キーワードの欄にフォーカス。ダーク（`07-parent-name-1100-dark.png`）。横のはみ出しなし（scrollWidth 1085 ＜ 1100）。
10. **性能**: 記録 5,000 件（node で `searchBase`・`registrantCounts`・`groupRecords` を続けて）: 全件 6.9ms、初回のキーワード（探す文字列を作る）15.3ms、2 回目以降 0.6〜2.1ms。描画は syncList の差分だけ。
11. **後のテーマへの申し送り**:
    - owned-overlay: カードの式は `breedingEquation(record, { focusParent, leftParent, omitChild })`、カードは `breedingCard(…, { compact, isNew })`。配合を探すのカードは views/search.js の `createRow` で作る（`renderCards` は使っていない）ので、`annotate` を足すときは `createRow` から渡す。「両親を所持している組を上へ」は `groupRecords` の後の安定ソートで足せる。URL のパラメータを足すときは `hashWith(changes)`（知らないパラメータは残る）。
    - register-entry: 配合を探すの文脈のボタンは帯（`find-bar`）か件数の行の近くに置く。空の状態の登録の入口は上の 5 の 6 通り。`#/drafts` の読み替えは router.js の `LEGACY` に足す（`drafts=1` を付けるなら表の値を関数に）。下書きの帯は `find-bar` と `find-results` の間（`find-child-chips` の前）。
    - goals-merge: 空の状態の「目標に登録」（S-?）を足すなら `emptyNode` の分かれ道に。`#/wishlist` の読み替えも `LEGACY`。ウィッシュリストの通知の href はこのテーマで `#/search?c=` にした（id は変えていない）。
    - pal-detail（3）: パル詳細の「配合を探すへ」のリンクと、配合を探すの子の欄（`c`）で「この子の配合」が引ける。

---

## owned-overlay: 配合の画面に所持数を重ねる

### 目的
配合を探す・継承ルート（と後のテーマの登録モーダル・目標の一覧）に、「その親を何体持っているか」「今の所持で組めるか」を出す。集計は core/owned.js の共通処理 1 つにまとめ、画面ごとに数え方がばらばらな状態（R-15）をなくす。

### 経緯
- 統合プランの owned-overlay（R-15・S-15・S-16・D-44・R-16・R-17・R-21、別プランの F014）。F014 は Codex の独立レビュー #1（「記録あり／所持／利用可能」の区別）から来た。
- Codex のプランレビュー 1 回目 10: 「所持数」と「親になれる数」を分ける。**`core/ideal.js` の `isParentCandidate` を流用すると、INV-2 の import 制限（`test/import.test.js:38-44`: core/ideal.js を読めるのは views/ideal.js だけ）に触れる** → 同じ規則の判定を core/owned.js に持つ。案 R-15 の「直し」にある「isParentCandidate（core/ideal.js から import する）」は**採らない**。
- 2 回目 C: 「手持ちで組める」は ♂×♀ が必須。**組める＝別々の個体 ID の ♂ と ♀**。記録に親の性別があればその向き、空欄なら両方の向き。性別の分からない個体は数えない。
- 「相手親は所持しているパルだけ」で絞るチェック（R-17 の `own=1`・`excludePartners`）は、437536b で消した「相手親の除外」の復活になるので**戻さない**（統合プランの判断事項 2）。並べ替えで所持しているものを先に出すだけにする。
- **統合プランの表では goals-merge の後にあったが、この文書では 2 番目に移した**（register-dialog の参照列と goals-merge の目標の行が、ここで作る集計を使うため）。

### 依存
- stable-render（フェーズ 1）。find-merge（配合を探すの画面に重ねるため）。

### このテーマでやらないこと
- 2 回の配合で作れる・あと 1 種で作れる（D-44 の判断で見送り）。新しい画面は作らない。
- 持ち主の内訳のポップオーバー（S-15・R-16 の判断で見送り。個体を見るのはフェーズ 3 のドロワー＝route-progress の F032）。
- 運び手の性別による相手親の絞り込み（R-17 の判断で見送り）。
- 継承ルートの開始候補のチップの作り直し（route-cleanup）。

### 現状（HEAD ad648b7 で確認）
- 所持の集計は `core/owned.js:353-361` の `ownedBySpecies`（種族ごとの個体の配列）と、`:446-450` の `partnerOwnership`（相手親の所持数。**タマゴは除くがグローバルパルボックスは数える**）。性別ごとの数はどこにもない。
- 継承ルートの開始候補 `core/owned.js:428-444` の `ownedRouteStarts` は**タマゴもグローバルも候補に入れる**（`views/route.js:14` の `holderSummary` に「（タマゴ）」の分岐）。理想個体は `core/ideal.js:189` の `isParentCandidate`（`!pal.egg && pal.place !== 'global'`）で両方を外す。3 つの数え方がばらばら（R-15）。`docs/OPERATIONS.md:97` は今の継承ルートの扱い（開始候補にタマゴとグローバルも含める・相手親はグローバルを含めタマゴは数えない）を書いている。
- 相手親の注記は `views/route.js:164-175` の `annotateFor`: 「相手親の X: 所持 N 体（うちパッシブ一致 M 体）」／「未所持」（`.route-owned-note`・`.unowned`）。`ui/route-view.js:5-25` の `stepView` が配合ごとに付ける。「N 通り・どれか 1 つ」の中は相手親の図鑑順（`core/route.js:33-34`）。
- 配合検索・逆引き・一覧・パル詳細のカード（`breedingCard`）には所持の情報が出ない（S-15）。

### 実装の手順
1. **共通の集計を core/owned.js に足す**（DOM なし。`ownedBySpecies` の近くに置く）
   ```js
   /** 親にできる個体（タマゴ・グローバルパルボックスの個体は親にしない）。
    *  core/ideal.js の isParentCandidate と同じ規則。INV-2 の import 制限で core/ideal.js は読めないので、ここにも持つ。 */
   export const canBeParent = (pal) => Boolean(pal.palId) && !pal.egg && pal.place !== 'global';
   /** 種族ごとの所持数。total・eggs・globals は全個体、male・female・unknown は親にできる個体の性別ごとの数。 */
   export function ownedCounts(pals) {} // → Map<palId, { total, eggs, globals, male, female, unknown }>
   /** 記録の両親を今の所持で組めるか（別々の個体の ♂ と ♀。記録に性別があればその向き、空欄なら両方の向き）。 */
   export function canPairRecord(counts, record) {} // → boolean
   ```
   - `canPairRecord`: 同じ種族どうしは `male >= 1 && female >= 1`。違う種族は、`parent1Gender === 'M' || parent2Gender === 'F'` なら「親1 が ♂・親2 が ♀」の向きだけ、`'F'`／`'M'` なら逆の向きだけ、両方空なら 2 つの向きのどちらかで組めればよい。両親の性別が同じ記録（不正）は組めない扱い。
   - `core/ideal.js:189` の `isParentCandidate` はそのまま（理想個体は変えない）。`canBeParent` と規則がずれないよう、`test/core/owned.test.js` で両方を import して同じ結果になることを確かめるテストを足す（import の制限は web/js の中だけなので、テストからは両方を読める）。
2. **表示の部品**（新規 `web/js/ui/owned-badge.js`）
   ```js
   export function ownedBadge(counts, palId, { role = 'parent' } = {}) {} // → HTMLElement
   ```
   - 親（`role: 'parent'`）: 0 体なら薄い字の「未所持」。1 体以上なら「♂2 ♀1」（親にできる数。性別の記号はフェーズ 1 の visual-parts の `genderMark()` と色のトークン）。親にできる個体が 0 でタマゴなどだけなら「タマゴ等のみ」。`title` に「所持 4 体（うちタマゴ 1・グローバルパルボックス 0・性別不明 0 は親にできません）」。
   - 子（`role: 'child'`）: 1 体以上のときだけ「所持 N」。
   - どちらも `a` 要素で `buildHash('owned', { pal: palId })`（所持パルの `pal` パラメータは `views/owned.js:83-89` が受け付ける）へ。
3. **カードに重ねる**: `breedingEquation`／`breedingCard`（`ui/breeding-card.js:28-63`）に `annotate(palId, role)` を足す。指定があれば、各タイルを `div.equation-slot` で包み、タイルの下に返された要素を置く（ないときは今の DOM のまま。route-view・確認のプレビューは変わらない）。
4. **配合を探すで使う**（`views/search.js`）
   - 所持パルのデータ（`context.owned?.state?.owned?.pals`）があるときだけ、`ownedCounts` を**データが変わったときに 1 回だけ**作り（`owned.state.owned` の同一性で覚える）、カードの親に「♂n ♀m／未所持」、子に「所持 N」を出す。`context.owned.subscribe` で `owned.state.owned` が変わったら `update` を呼ぶ（`views/route.js:204-209` と同じ形）。開いたときに `owned.load().catch(() => {})`。
   - 件数の行に 2 つの切り替え（所持パルのデータがあるときだけ出す。押しボタン `aria-pressed`）: 「両親を所持している組を上へ」（URL `ownedfirst=1`。`canPairRecord` が真の記録を、群の中で安定に先へ。F014・S-16）、「今の所持で作れる」（URL `make=1`。`canPairRecord` が真で、子を所持していない記録だけに絞る。D-44）。どちらも既定はオフ。
5. **継承ルートで使う**（`views/route.js`）
   - `annotateFor` を `ownedCounts` で作り直す: 「相手親の X: ♂2 ♀1（うちパッシブ一致 M 体）」、0 なら「相手親の X: 未所持」（`.unowned` は今のまま薄く）。末尾に「所持パルで見る」（`buildHash('owned', { pal: X })`）。パッシブ一致の数も `canBeParent` の個体で数える。
   - `partnerOwnership`（`core/owned.js:446-450`）は `canBeParent` で数えるように変える（グローバルパルボックスの個体も相手親に数えなくなる。R-15）。呼び出し元がなくなれば消してよい。
   - 「N 通り・どれか 1 つ」の中を、所持パルのデータがあるとき「相手親を組める（♂か♀を 1 体以上）→ 未所持」の順に**安定に**並べ替える（同じ群の中は今の図鑑順。R-17 の判断）。並べ替えは `routeView` に渡す前に `views/route.js` で `steps[].options` を並べ直す（`ui/route-view.js` は変えない）。
   - 経路の見出しの右に「相手親 2/3 段で所持」のバッジ（その段のどれかの配合の相手親を所持していれば所持とする）。所持パルがあるときだけ、`findRoutes` の結果を**同じ回数の中だけで**、相手親を所持していない段の少ない順に安定に並べ直す（R-21 の判断）。`routeView` に `badge(route)` の任意の引数を足して見出しに置く。
   - 開始候補（`ownedRouteStarts`）の運び手を `canBeParent` で絞り、`holderSummary` の「（タマゴ）」の分岐を消す（R-15 の判断）。これで候補が 0 になったときだけ、候補がないときの文に「タマゴ・グローバルパルボックスの個体は含めていません」を添える。**`docs/OPERATIONS.md:97` の継承ルートの記述をこの規則に直す**。
6. （register-dialog・goals-merge は、この `ownedCounts`・`ownedBadge`・`canPairRecord` を使う。ここでは作るだけ）

### 触るファイル
- 変更: `web/js/core/owned.js`、`web/js/ui/breeding-card.js`、`web/js/views/search.js`、`web/js/views/route.js`、`web/js/ui/route-view.js`（`badge` の引数だけ）、`web/css/app.css`、`web/js/release-notes.js`、`docs/OPERATIONS.md`
- 新規: `web/js/ui/owned-badge.js`

### テスト
- `test/core/owned.test.js`: `canBeParent`（タマゴ・グローバル・人間を外す）、`ownedCounts`（性別ごと・タマゴ・グローバル・性別不明）、`canPairRecord`（同じ種族、違う種族で記録の性別あり／なし、両親が同じ性別の不正な記録、♂だけ・♀だけ）、`core/ideal.js` の `isParentCandidate` と同じ結果になること。`ownedRouteStarts` が運び手からタマゴ・グローバルを外すこと（`test/core/owned.test.js` の該当テスト。別プラン §9 の C の `owned.test.js:95-102` 付近）。
- `test/web/owned-view.test.js:247-273`（継承ルート）: `:269` の「相手親のツッパニャン: 所持 2 体（うちパッシブ一致 0 体）」→ 新しい文（例「相手親のツッパニャン: ♂1 ♀1（うちパッシブ一致 0 体）」。フィクスチャの性別に合わせる）。`:255-264` の `.route-start`（候補の一覧）は route-cleanup で消えるので、ここでは文言だけ合わせる。
- `test/web/views.test.js`: 配合を探すで、所持パルのデータがないときは注記も切り替えも出ないこと、あるときに「♂n ♀m」「未所持」が出ること、「両親を所持している組を上へ」「今の所持で作れる」の並びと絞り込み。
- `test/web/route-view.test.js`: `badge` を渡したときに見出しに出ること（渡さなければ今の DOM のまま＝既存のテストはそのまま通る）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 組めるかは「登録済みの記録の両親」と「所持パル」だけで決める。配合表・`core/ideal.js` は使わない（`core/owned.js` は今どおり `core/ideal.js` を import しない）。
- 互換: 継承ルートの相手親の数え方と開始候補が変わる（グローバルパルボックスの個体を数えない・タマゴを開始候補にしない）。release-notes と OPERATIONS.md に書く。
- 性能: `ownedCounts` は所持パルのデータが変わったときに 1 回（2,000〜20,000 体でも O(n)）。`canPairRecord` は Map を引くだけ。配合を探すの再描画のたびに数え直さない。

### release-notes の案
- id: `<実装日>-owned-overlay`／title: 「配合に所持数を表示」（9 字）／body: 「配合のカードに親の所持数（♂♀）を出し、両親を所持している組を上へ並べられます。」（40 字）

### 完了の条件
- [x] `npm test` が通る。
- [x] モックに所持パルを注入して（フェーズ 0 の注入スクリプト）、配合を探すのカードに「♂n ♀m／未所持」が出る。切り替えで並びと件数が変わる。所持パルがないときは何も出ない。
- [x] 継承ルートの相手親の注記が「♂n ♀m」になり、「N 通り」の中で所持している相手親が先に来る。見出しに「相手親 n/m 段で所持」。
- [x] 所持パル 2,000 体で、配合を探すの条件を変えても入力が 100ms 以上止まらない（集計が毎回走っていない）。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 組めるかは登録済みの記録の両親と所持パルだけで決め、`core/owned.js` は `core/ideal.js` を import しない（`test/import.test.js`）。`canBeParent` と `isParentCandidate` が同じ結果（テスト）。互換 — 継承ルートの数え方の変化を release-notes と `docs/OPERATIONS.md:97` に書いた。確認回数と相手親の除外は戻していない（判断事項 2）。セキュリティ — `test/static/security.test.js` が通る。性能 — 上の 2,000 体の確認。

### TODO
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

### 実装の記録（2026-10-15、ブランチ `feature/owned-overlay`）

実装のときに決めたこと・文書と違う形にしたこと（後の register-dialog・goals-merge・route-cleanup と、フェーズ 3 の route-progress・pal-detail はこちらを正とする）。

1. **集計（手順 1）**: 文書のとおり core/owned.js に **`canBeParent(pal)`**（`Boolean(pal?.palId) && !pal.egg && pal.place !== 'global'`）・**`ownedCounts(pals) → Map<palId, { total, eggs, globals, male, female, unknown }>`**（total・eggs・globals は全個体、male・female・unknown は親にできる個体）・**`canPairRecord(counts, record)`** を足した。canPairRecord は「両親が同じ性別の記録（不正）は組めない」を同じ種族どうしの判定より先に見る（同じ種族の ♂♂ の記録でも組めない）。test/core/owned.test.js で `core/ideal.js` の `isParentCandidate` と全個体で同じ結果になることを確かめる（テストからは両方を読める）。
2. **数え方の変更（手順 5。R-15）**: `ownedRouteStarts` の運び手と `partnerOwnership` を canBeParent で数える（前は運び手にタマゴ・グローバルを含め、相手親はグローバルを含めていた）。継承ルートの候補がないときの文は、パッシブを持つ個体のうち親にできない個体があれば「タマゴ・グローバルパルボックスの個体は含めていません。」を添える。`holderSummary` の「（タマゴ）」の分かれ道を消した。**運びたいパッシブの選択欄の数（`passiveCounts`。「所持パルが持っているもの（タマゴを含む）」）は変えていない**（route-cleanup で選択欄の形を変えるときに合わせる）。開始の X の所持個体の一覧（`carrierList`）もタマゴを含めたまま（route-cleanup で `ownedRow` に替える）。
3. **印（手順 2）**: `web/js/ui/owned-badge.js` の **`ownedBadge(counts, palId, { role })`** と、カードの key に入れる **`ownedBadgeText(counts, palId, role)`**。**クラス名は `.owned-count`**（文書にない決め。所持パルの行の印にすでに `.owned-badge` があるため）。親: `a.owned-count`（`genderMark('M'|'F', { inline: true })` と数の `span.owned-count-num`。0 の性別も出す）、0 体は `span.owned-count.is-none`「未所持」（押せない）、親にできる個体がなければ `a.owned-count.is-blocked`「タマゴ等のみ」。子: 1 体以上のときだけ `a.owned-count.is-child`「所持 N」。title は「所持 N 体（うちタマゴ a・グローバルパルボックス b・性別不明 c は親にできません）」（親にできない個体があるときだけ括弧）。行き先は `#/owned?pal=<ID>`。
4. **カード（手順 3）**: `breedingEquation(record, { …, annotate })`・`breedingCard(…, { annotate })` の `annotate(palId, role)` が要素を返せば `div.equation-slot` に タイル＋印 を入れる。CSS の `.breeding-equation > .pal-tile` の規則（36px・アイコン 34px・子の色）は `.equation-slot > .pal-tile` にも当てた（当てないとタイルが 64px の既定に戻り、カードが 120px になった）。印は名前の左端（左に 41px）にそろえる。カードの高さは 77px → 92px（8 文字以上の名前は 108px）。
5. **配合を探す（手順 4）**: 所持パル（`context.owned.state.owned`）の同一性で `ownedCounts` を 1 回だけ作り、カードの item に `owned: ownedSig(record)`（3 体の `ownedBadgeText`）を足して key に入れる（数が変わったカードだけ作り直す）。`owned.subscribe` で `state.owned` が変わったら描き直し、開いたときに `owned.load()`。帯の 2 段目の `panelItem('所持', div.find-toggles)`（`role=group`。所持パルのデータがあるときだけ出す）に **「両親を持つ組を上へ」（`ownedfirst=1`）・「今の所持で作れる」（`make=1`）**（文書の「両親を所持している組を上へ」は帯に入るよう短くした。全文は title）。見た目は所持パルの場所のチップ（`.place-chip`。オンは地の色と ✓）。ownedfirst は `groupRecords` の後に群の中で組める記録を安定に先へ、make は組めて子を持っていない記録だけ。所持パルのデータがないときは URL にあっても効かない。make で 0 件のときは「今の所持パルで作れる配合はありません。」＋「「今の所持で作れる」を外す」。「条件をすべて解除」は make も外す（ownedfirst は並べ替えと同じく残す）。帯の高さは 104.88px のまま（2 段目に入る）。
6. **継承ルート（手順 5）**: `statsOf(pals)`（`ownedBySpecies` と `ownedCounts` を所持パルのデータごとに 1 回）。注記は `span.route-owned-note` に「相手親の X: ♂n ♀m（うちパッシブ一致 M 体）」と `a.route-owned-link`「所持パルで見る」。未所持は「相手親の X: 未所持」（リンクなし）、親にできる個体がなければ「相手親の X: タマゴ等のみ（親にできる個体なし）」（`.unowned`）。並べ替えは `arrangeRoutes(routes, stats)`（findRoutes の結果は書き換えず写しを返す）: 「N 通り」の中を相手親を組める（親にできる ♂ か ♀ が 1 体以上）配合 → 組めない配合に安定に、経路は同じ長さの中だけ相手親を持っていない段の少ない順に。見出しのバッジは `routeView(routes, { annotate, badge })` の **`badge(route)`**（任意。返した要素を `div.route-card-head` に h2 と並べる。null なら今の形）で「相手親 n/m 段で所持」（全段なら `.is-all`）。
7. **テスト**: 1,515 → 1,521 件（`npm test` exit 0）。足したもの: owned.test.js（canBeParent と isParentCandidate の突き合わせ・ownedCounts、canPairRecord）、views.test.js（所持の印・データの変化で描き直す・データがないとき何も出さない、切り替えの並びと絞り込みと 0 件の案内）、owned-view.test.js（N 通りの並び・タマゴ等のみ・見出しのバッジ）、route-view.test.js（badge）。書き換えたもの: owned.test.js の開始候補（タマゴの PinkCat を候補にしない・相手親にグローバルを数えない）、owned-view.test.js の相手親の注記の文。
   - 全体のテストで 2 回、app.test.js の時刻か順番に依存するテスト（「同期状況を押すと…」「タブを切り替えても…」）が 1 回ずつ落ち、単独・ファイル単位で何度流しても通った（直前の find-merge の後にも 1 回）。フェーズの終わりにもう一度確かめる。
8. **画面（モック・1100×900・所持パル 138 体を注入。`Claude outputs/ui-audit-2026-10/shots/find-merge/`）**: カードに「未所持」「♂3 ♀7」「所持 5」（`10-owned-badges-1100-light.png`）、帯に「所持 [両親を持つ組を上へ][今の所持で作れる]」。モックの配合は乱数で、組める記録がなかったので「今の所持で作れる」は 0 件の案内（`11-…`）。ダーク（`12-…`）。
9. **性能**: `ownedCounts` は 2,000 体で 0.3ms・20,000 体で 2.6ms（所持パルのデータが変わったときだけ）、`canPairRecord` 5,000 回で 1.2〜1.5ms。条件を変えたときは数え直さない（`countsFor` の同一性）。
10. **後のテーマへの申し送り**:
    - register-dialog: 参照列の「所持 ♂n ♀m」は `ownedCounts` と `ownedBadge(counts, palId)`（または数だけなら `counts.get(id)` の male・female）。性別の押しボタンの既定を決めるなら canPairRecord の向きの決め方が使える。
    - goals-merge: 目標の行の「所持 n 体（親になれる数）」は `ownedCounts` の total と male＋female。
    - route-cleanup: 開始候補はもう親にできる個体だけ。運びたいパッシブの数（passiveCounts）と開始の X の所持個体の一覧はタマゴを含めたままなので、チップ・ownedRow に替えるときに数え方をそろえる。注記と見出しのバッジは views/route.js の `annotateFor`・`badgeFor`・`arrangeRoutes`。
    - route-progress（3）: 相手親の「所持パルで見る」はドロワーにするときの入口。

---

## register-entry: 登録の入口と下書きの帯

### 目的
ヘッダーの常設「＋ 登録」をやめ、登録の入口を「いま見ている配合」の文脈のボタンに置く。下書きのタブを廃止し、配合を探すの全件表示の上の折り畳み帯にする。

### 経緯
- **D2**（両セッションで同じ方向の回答）。別プランの F001（常設ボタンの撤去と文脈のボタン）・F020（下書きの帯）、本セッションの G-02・G-04・X-10・D-24・D-25・G-06（ショートカットの N）。
- 案の「直し」との違い: G-04 の判断は「配合検索に結果があるときの『この組で別の結果を登録』は入れない」、G-06 の判断は「N は入れない」だったが、**統合プランの要点（F001 と「ショートカット N」）が優先**する。G-01（ヘッダーのボタンを格下げして残す）と G-05（状況で出し分け）は取り消し・却下（判定の取り違えで入口が消えるため）。
- 自動登録が動くのは「ホストの PC・Chromium・自動登録オン・ページを開いている間」だけ（`auto-register.js:95-106` の `current()`、`views/owned-settings.js:223-224`）。手入力が主の人（参加者・未連携・別ワールド）がいるので、入口は「なくす」のではなく「文脈に移す」（X-10）。
- Codex のプランレビュー 1 回目 12（下書き 0 件のときの入口と N の時期）: **下書きが 0 件でも「下書きに追加」はできる**ようにし、N は入力欄・日本語変換中・モーダル中・長押しでは動かさない。6 回目 5: `#/drafts` の読み替えはこのテーマで入れる。
- 下書きの行は「読み取り専用の式＋登録・編集・削除」（F020）。今の行の中で直接パルを選ぶ形（`views/drafts.js:101-108`）はやめる。D-26（行の中で登録者・メモも編集）は却下済み。

### 依存
- find-merge（配合を探すの画面と、ルーターの旧画面の表）。

### このテーマでやらないこと
- 登録モーダルの中身（閉じたときの下書きへの退避・性別・参照列。register-dialog）。
- 通知から入力済みで登録画面を開くこと（G-02 の判断で見送り）。
- 下書きの送信中の行を残す（D-33。却下）、行を選んで一括操作（D-32。却下）。

### 現状（HEAD ad648b7 で確認）
- 常設の「＋ 登録」: `app.js:133-137`（`register-button`、aria-label「配合を登録」）。`app.js:139-140` で `.header-actions` にベルと並べ、`:153` で `#app` の直下に置く。`:264` でログイン画面のときだけ隠す。フェーズ 1 の header-frame でヘッダーの中に移っているはず。
- 登録の入口はほかに、配合検索・逆引き・一覧の 0 件の空の状態（`views/search.js:26-28`・`views/reverse.js:21-23`・`views/list.js:45-46`）、パル詳細の「この子の配合を登録」（`views/pal.js:21`。常に primary）、カードの編集、下書きの画面。find-merge の後は配合を探すの空の状態に集まっている。
- 下書きの画面 `views/drafts.js:140-263`: 見出しに「一括登録」「一括削除」（`:147-158`）、ツールバーに「＋ 下書きに登録」（モーダル。`:159`）と件数、一覧の下に「＋ 空の下書きを追加」（`:167-170`）。行 `draftRow`（`:94-138`）は 3 つの `palPicker` を式の形に並べ、その場で選ぶ。空の状態の文は 2 つのボタン名を並べた 40 字ほど（`:231`）。行が消えたら次の行の最初のパル選択へフォーカス（`:245-250` の `moveFocus`）。
- 送信の処理 `registerDrafts`（`views/drafts.js:61-92`）と確かめ（`prepare` `:22-45`）、ストア `web/js/drafts.js`（`createDraftStore`）はこのまま使える。
- レールの `drafts` タブ（`app.js:103`）、`router.js:1` の `drafts`、`nav-icons.js:7`。

### 実装の手順
1. **ヘッダーの「＋ 登録」を外す**: `app.js` の `register` ボタン・`actions.append(…, register)`・`register.hidden` の行（header-frame で移った先）を消す。追記（header-frame の実装、2026-10-12）: 移った先は `header.append(brand, envChip, headerStatus, save.element, bell.element, register, account.element)`。app.test.js のログイン画面で隠す部品の一覧 `signedInParts` とヘッダーの並びのテストからも `register-button` を外す。`.register-button` の CSS（`app.css` の `register-button` を含むセレクタ。`:827-828` の動きの指定にも名前がある）を片づける。
2. **文脈のボタン**（どの時点でも、配合を探すに出る登録のボタンは 1 つだけにする）
   - 配合を探すで、パルの条件（親1・親2・子）がない（全件表示）とき: 見出しの右に「＋ 配合を登録」（`button secondary small`。`context.register()`）。
   - パルの条件があって結果が 1 件以上のとき: 件数の行の右に、親 2 体なら「この組み合わせで別の結果を登録」（親 2 体を初期値）、親が片方なら「この親で配合を登録」（親1 を初期値）、子だけなら「この子の配合を登録」（子を初期値）。
   - 結果が 0 件のときは、find-merge で作った空の状態のボタン（primary）だけ。
   - パル詳細（`views/pal.js:18-21`）: 「この子の配合を登録」は、このパルが生まれる配合が 1 件でもあれば `button secondary`（控えめ）、0 件なら今どおり primary（F075）。
3. **下書きの帯**（新規 `web/js/ui/drafts-band.js`）
   ```js
   export function draftsBand(context, { open = false, onToggle } = {}) {} // → { element, update({ open }), destroy() }
   export async function registerDrafts(context, ids) {} // views/drafts.js から移す（中身は変えない）
   ```
   - 帯の頭の行: 開閉のボタン（`aria-expanded`・`aria-controls`。文言「下書き n 件（この端末だけ）」。summary の中にボタンを入れない＝C-44 の考え方）、右に「すべて登録」（primary small。0 件と送信中は押せない）と「＋ 下書きに追加」（secondary small。`context.register({}, { draft: true })`）。**0 件でも帯は出し、「＋ 下書きに追加」は押せる**。
   - 帯の中身（開いたときだけ）: 保存の失敗の警告（`drafts.saveFailed`。今の `:163-165` の文）、行の一覧、末尾に小さく「すべて削除」（今の一括削除と同じ確認つき）。
   - 行（`draftRow` を作り直す）: 読み取り専用の式（親1 ＋ 親2 → 子。空の枠は破線の「未選択」）、登録者・メモ、エラーの文、操作「登録」（未選択があれば押せない）・「編集」（`context.register(current, { draft: true })`）・「削除」（確認なしで消し、トーストで「元に戻す」。delete-undo の「端末だけのものは確認なし＋元に戻す」）。`{ element, update(draft, status), destroy }` を返す。
   - 行の差分更新は stable-render の `syncList`（今の `:216-239` の考え方と同じ。送信中の下書きは隠す）。行が消えたら、次の行（なければ前の行）の「編集」ボタンへフォーカスを移す（同じ「登録」「削除」へ移すと Enter の長押しで続けて押してしまうため。今の `:243-244` の注意を引き継ぐ）。行がなくなったら「＋ 下書きに追加」へ。
   - ダブルクリックの 2 回目を次の行に当てない仕組み（`:110-111` の `singleClick`）は残す。
4. **配合を探すに帯を置く**: パルの条件がない（全件表示の）とき、条件帯の下・一覧の上に `draftsBand`。開閉は URL の `drafts=1`（`context.update(hash, { replace: true })` で切り替え。履歴は増やさない）で持つ。パルの条件があるときは帯を出さない。
5. **`#/drafts` の読み替え**: find-merge で作った旧画面の表に `drafts` を足す（`#/drafts` → `#/search?drafts=1`）。`router.js:1` の `views` から `drafts` を外し、`app.js:103` の `tabs`・`:31,208` の import と対応、`nav-icons.js:7` を消す（追記 2026-10-14: visual-parts の後は、アイコンの定義は `web/js/ui/icons.js` の `ICONS` にある。nav-icons.js は `navIcon(view)` だけ）。`views/drafts.js` を削除（`registerDrafts` は手順 3 で移した）。keep-state の最後のタブの許可リストから `drafts` を外す。
6. **ショートカット「N」**（`app.js` に 1 か所）: `document` の `keydown` で `event.key` が `n`／`N` のとき、次のどれかなら何もしない: `event.isComposing`、`event.repeat`（長押し）、Ctrl・Alt・Meta つき、ログイン画面、開いているダイアログがある（`document.querySelector('dialog[open]')`）、フォーカスが `input`・`select`・`textarea`・`[contenteditable]` の中、パル選択などの候補が開いている（`[aria-expanded="true"]` のトリガーにフォーカス）。それ以外は `preventDefault` して `context.register()`（配合を探すでパルの条件があればそれを初期値に）。リスナーは起動時に 1 回だけ足す。

### 触るファイル
- 変更: `web/js/app.js`、`web/js/router.js`、`web/js/views/search.js`、`web/js/views/pal.js`、`web/js/ui/nav-icons.js`、`web/css/app.css`、`web/js/release-notes.js`
- 新規: `web/js/ui/drafts-band.js`
- 削除: `web/js/views/drafts.js`

### テスト
- `test/web/app.test.js:69-74`（`assertLoginOnly`）と `:116` の `register-button` を外す。`:391-418`（下書きタブで下書きを作る）を、`#/drafts` で開くと配合を探すの帯が開いた状態で出る → 「＋ 下書きに追加」→ 下書きの帯に行が出る → 「登録」で記録に加わる、に書き換える（`:396-398` のタブの aria-current は配合を探すのタブに）。N のテスト（入力欄・ダイアログ・変換中・repeat では開かない）を足す。
- `test/web/drafts.test.js`: import を `ui/drafts-band.js` に。`:80-83`（下書きのタブを開ける）→ `#/drafts` が `#/search?drafts=1` になること。行の中でパルを選ぶ前提のテスト（`:122-146` 空の行で直接選ぶ、`:307-354` 開いている候補を保つ）は、読み取り専用の行に合わせて「編集で開いたモーダルで直す」「別の行の送信が終わってもフォーカスと行を保つ」に書き換える。`:113,127` の「＋ 空の下書きを追加」は「＋ 下書きに追加」（モーダル）に。`:397-425` のフォーカスの移し先は「編集」ボタンに。`:442-474` の「＋ 下書きに登録」は「＋ 下書きに追加」に。送信・重複・一括登録・ログアウト・別タブのテスト（`:148-300`・`:356-396`・`:489-` ）は帯の要素で同じことを確かめる。
- `test/web/views.test.js`: 配合を探すの登録のボタンが状態ごとに 1 つだけ出ること、パル詳細のボタンの強さ。

### INV-2・互換・セキュリティ・性能の注意
- 互換: 下書きの保存の形（`pal-note.drafts.<env>.<user>`）は変えない。`#/drafts` のブックマークは帯が開いた配合を探すに着く。
- 手入力の人の手数: 今は「＋ 登録」1 手。全件表示なら見出しのボタンで 1 手、ほかの画面からは N か、配合を探すへ移って 1 手。release-notes に「どこへ移ったか」を書く。

### release-notes の案
- id: `<実装日>-register-entry`／title: 「登録の入口を移しました」（11 字）／body: 「右上の「＋ 登録」は配合を探す・パル詳細のボタンへ。下書きは配合を探すの上の帯に移りました。」（46 字）

### 完了の条件
- [x] `npm test` が通る。
- [x] ヘッダーに「＋ 登録」がない。配合を探すの全件表示・結果あり・0 件・パル詳細のそれぞれで、登録のボタンが 1 つ出る。
- [x] 下書き 0 件でも帯が出て「＋ 下書きに追加」で作れる。`#/drafts` で帯が開いた状態になる。
- [x] 実測: 下書きの一括登録で layout-shift が今（0.13・340px 伸びる）より小さい。
- [x] 入力欄・日本語変換中・モーダル中・長押しで N が反応しない（ブラウザで確かめる）。
- [x] レールのタブが 6 本。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — 下書きの保存の形を変えていない（旧コードのタブと混ざっても壊れない）。`#/drafts` のブックマークが、履歴を増やさずに帯の開いた配合を探すに着く。セキュリティ — `test/static/security.test.js` が通る。INV-2 — 対象外。性能 — 帯の行は syncList の差分更新。

### TODO
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

### 実装の記録（2026-10-15、ブランチ `feature/register-entry`）

実装のときに決めたこと・文書と違う形にしたこと（後の register-dialog・goals-merge・settings と、フェーズ 3 の pal-detail・drawer はこちらを正とする）。

1. **ヘッダー（手順 1）**: app.js の `register` ボタンと `register.hidden` の行、`.register-button` の CSS（色・ホバー・処理中・動き・押せないときの色の 6 か所）を消した。ヘッダーの並びは ロゴ → テスト環境 → 同期状況 → セーブ連携 → ベル → ID。
2. **文脈のボタン（手順 2）**: **場所は文書と変えて、どの状態でも配合を探すの見出しの右（`div.view-heading-actions` の `button.find-register`。secondary small）にした**（件数の行は sticky の帯の 2 段目の右端にあり、「この組み合わせで別の結果を登録」〔約 200px〕を足すと所持の切り替えと合わせて 1100px で折り返すため。入口が 1 か所に決まる利点もある）。文言: 全件（親・子なし）「＋ 配合を登録」、親 2 体「この組み合わせで別の結果を登録」、親 1 体「この親で配合を登録」、子だけ「この子の配合を登録」。初期値は `registerInitial()`（親 2 体はその組、親 1 体は親1 に、親と子なら子も）。結果が 0 件・読み込み中は隠し、空の状態の primary のボタンだけにする。パル詳細の「この子の配合を登録」は、描くたびに産まれる配合の数で `button secondary`／`button primary` を切り替える。
3. **帯（手順 3）**: `web/js/ui/drafts-band.js` の **`draftsBand(context, { open, onToggle }) → { element, update({ open }), destroy() }`** と **`registerDrafts(context, ids)`**（中身は前の views/drafts.js のまま。`prepare`・`submit` も移した）。`section.drafts-band`（aria-label「下書き」）の頭の行 `div.drafts-band-head` に `button.drafts-band-toggle`（aria-expanded・aria-controls。▸ の印〔CSS の三角〕と「下書き n 件（この端末だけ）」）と「すべて登録」（primary small。0 件・送信中・記録の読み込み前は押せない。理由は title）・「＋ 下書きに追加」（secondary small。`context.register({}, { draft: true })`。ログアウト中は押せない）。中身 `div.drafts-band-body`（閉じている間は hidden。行は閉じていても作っておく）に保存の失敗の警告・行の一覧（syncList。空なら「下書きはありません。「＋ 下書きに追加」から作れます。」）・「すべて削除」（**文書は「確認つき」だが、フェーズ 1d の delete-undo の決まり〔端末だけのものは確認なし＋元に戻す〕のまま**）。帯は drafts と store を購読して描き直す。
4. **行（手順 3）**: 読み取り専用の式（`palTile(id, { clickable: false })`。選んでいない枠は破線の `span.draft-empty`「未選択」）。**2 行の形**にした: 1 行目は式（3 体の列は 1fr ずつ・最大 760px）、2 行目は 登録者 · メモ · 理由の文（`span.draft-message`。1 行で省略し全文は title）と右端の操作「登録」「編集」（`data-focus="edit"`）「削除」。**理由の文で行の高さが変わらない**（文書の完了の条件の「一括登録の layout-shift を今より小さく」のため。前は行の下に 1 行足していた）。登録が押せない理由は「親1・親2・子を「編集」で選ぶと登録できます」（行の中で選べなくなったため文を変えた）。行が消えたら syncList が次の行（なければ前の行）の「編集」へ、行がなくなったら「＋ 下書きに追加」（`fallbackFocus`）へ移す。ダブルクリックの 2 回目を次の行に当てない `singleClick` は残した。
5. **配合を探すに置く（手順 4）**: 条件帯の下・子のチップの前の `div.find-drafts` に、親・子を選んでいない（全件表示の）ときだけ作る（登録者・キーワード・並べ替えで絞っていても出す）。`context.drafts` がない（ビューのテスト）ときは作らない。開閉は URL の `drafts=1`（`changeRoute(…, { replace: true })`。履歴は増やさない）。親・子を選ぶと帯を壊し、外すと作り直す。
6. **読み替え（手順 5）**: router.js の `LEGACY` の値を `{ view, add }`（足すクエリ）にし、`drafts: { view: 'search', add: { drafts: '1' } }` を足した（`#/drafts?x=1` → `#/search?x=1&drafts=1`）。`views` から `drafts` を外し、`TABS`・app.js の import と対応・ICONS の `drafts` を消した（タブは 6 本）。最後のタブの許可リストは TABS から作るので、古い `lastView` の `drafts` は使われない。レールの区切りは `[data-view="drafts"]` のままで、下書きのタブがなくなったので区切りは所持パルの前だけ（ウィッシュリストは探すのグループに続く。goals-merge でウィッシュリストが消えれば 探す｜所持｜設定）。
7. **ショートカット N（手順 6）**: app.js で `document.addEventListener('keydown', …)` を 1 回。`n`/`N` のとき、変換中・長押し（repeat）・Ctrl/Alt/Meta・ログイン画面・未ログイン・`dialog[open]` がある・フォーカスが input/select/textarea/contenteditable・フォーカスが `aria-expanded="true"` の要素なら何もしない。それ以外は `preventDefault` して `context.register(currentView.registerInitial?.())`（配合を探す以外の画面は初期値なし）。
8. **テスト**: 1,521 → 1,527 件（`npm test` exit 0）。drafts.test.js は帯を相手に書き換えた（帯の開閉・0 件の追加・行が読み取り専用で「編集」のモーダルで選ぶ・名前の「すべて登録」「すべて削除」「＋ 下書きに追加」・フォーカスの移し先は「編集」・操作中の行を付け直さない）。app.test.js: ヘッダーの並びと `signedInParts` から `register-button` を外し、`#/drafts` から帯で下書きを作って登録するテスト・N のテスト（document の keydown を記録する偽物に変えた）を足し、更新の帯のテストは見出しの「＋ 配合を登録」でダイアログを開く。views.test.js: 文脈のボタンの 5 通りと 0 件、帯の出し入れと drafts=1、パル詳細のボタンの強さ。router.test.js: `#/drafts` の読み替え。
9. **画面（モック・1100×900。`Claude outputs/ui-audit-2026-10/shots/find-merge/`）**: `#/drafts` → `#/search?drafts=1`（帯が開いて 6 件。ヘッダーに「＋ 登録」なし・タブ 6 本・見出しの右に「＋ 配合を登録」。`20-drafts-band-1100-light.png`）。基準の計測と同じ形（登録できる 1 行と空の 19 行）で「すべて登録」: layout-shift は **0.0413**（基準 0.1307。入力の直後）、ページの高さは +12px（基準 +340px。登録した 1 行が消え、結果のカードが 1 枚増えた分）。19 行の 2 行目に「未選択の項目があります。」（`24-drafts-after-register-20rows-1100-light.png`）。帯を閉じると URL から drafts が外れる。キーワードの欄で N を押すと文字が入るだけ、本文で N を押すと親1 にモコロンが入った登録のダイアログ（`25-shortcut-n-1100-light.png`）。
10. **後のテーマへの申し送り**:
    - register-dialog: 登録のモーダルを閉じたときに下書きへ退避するなら、帯は drafts の購読で自動で増える（帯の件数・行）。モーダルの「下書きに保存」は `context.register({}, { draft: true })` のまま。
    - goals-merge: 配合を探すの空の状態・見出しの右に「目標に登録」を足すなら、見出しの右は `div.view-heading-actions`（今は登録のボタン 1 つ）。
    - settings: 端末のデータの書き出しで下書きを扱うときも、保存の形は `<namespace>.drafts.<env>.<userIdKey>` のまま。

---

## register-dialog: 登録モーダルの見直し

### 目的
登録モーダルで、閉じても入力が消えない（下書きに退避）・親の性別を記録できる（下書きを通っても消えない）・登録済みの配合と所持数を見ながら選べる・入力で欄がずれない、を実現する。

### 経緯
- 統合プランの register-dialog（本セッションの D-14〜D-20、別プランの F017・F018・F019）。
- **F019**: 新規の入力があるまま閉じたら下書きに自動で退避し、トースト「下書きに残しました」＋「破棄」。編集と「続けて登録」の直後（親1 だけ残った状態）は退避しない。D-16 の判断（閉じる前に確認を出す）より、統合プランの「自動で退避」が優先。Codex のプランレビュー 1 回目 15: ×・Esc・キャンセルを**同じ経路**にする「閉じる前」の共通の口を ui/dialog.js に。
- **F017・D-15**: 親1・親2 の ♂／♀ トグル（任意）。性別で子が変わる組（フォレーナ×クレメーオ。`core/ideal.js:134`）の向きを手でも記録できるようにする。10-04 の 437536b で性別の欄を消した経緯があるが、統合プランで「任意のトグル」として戻すと決めた（D-15 の判断の「入力は増やさない」は採らない）。
- Codex のプランレビュー 6 回目 3（高）: **下書きを通ると性別が消える**（`web/js/drafts.js:14-22` の `cleanDraft` は性別を保存しない、`views/drafts.js:30` の一括登録は性別を空にする）。→ 正規化・内容の比較（`sameDraftContent`）・編集の再開・一括登録まで性別を通し、保存は**旧コードのタブが書き直しても消えないよう、下書き id ごとの別のキー**に持つ。
- **F018・D-14**: 左にフォーム・右に参照列（その親の登録済みの配合・所持 ♂n ♀m）。重複の警告は右列の固定の高さの枠に（今は警告が出るたびにメモ欄が 71px・35px 下がる）。
- F017 の注意: 性別を足すと、手で登録した記録にも継承ルートの「性別条件は未検証」が付くようになる（`ui/route-view.js:31`）。言い換えは route-cleanup で行う（このテーマでは条件を変えない）。

### 依存
- register-entry（下書きの帯）。owned-overlay（参照列の所持数に `ownedCounts`・`ownedBadge` を使う）。

### このテーマでやらないこと
- 配合牧場から親を入れるチップ（D-21。却下）、右側のサイドパネルの編集画面（D-22。却下）。
- 残り字数の表示・フォーカスで広がるメモ（D-20 の判断で見送り）。
- 継承ルート・理想個体の「性別条件は未検証」の条件の変更（route-cleanup・ideal 側）。
- ワールドの登録モーダル（roles）。

### 現状（HEAD ad648b7 で確認）
- `ui/dialog.js:3-26` の `openDialog`: × は `dialog.close()`（`:10-11`）、背景のクリックは `closeOnBackdrop` のとき閉じる（`:23`）、Esc は既定の動き（cancel → close）。閉じる前に割り込む口はない。登録モーダルは `closeOnBackdrop: false`（`ui/record-editor.js:48-51`）だが、Esc・×・キャンセル（`:114` の `modal.close`）で確認なしに閉じ、入力が消える（計測: 開いているモーダル 1→0）。
- `ui/record-editor.js`: 親の性別は、編集で親 2 体が同じなら元の性別を残し、どちらかを変えたら両方空（`:78-85` の `sameParents`）。新規は常に空。警告 `.editor-warning`（`:55`・`:87-101`）は文字だけ（「この組み合わせは登録済み: → スプラドン」）で、`:not(:empty)` のときだけ余白が付く（`app.css:613`）。下書き版の保存 `saveDraft`（`:176-191`）は性別を渡さない（`:180-181`）。選択欄は記号なしの 3 列（`app.css:611`）、高さは 800×600 に固定（`app.css:606-607`。437536b で入れたもの）。登録者は全ユーザーをサーバの順に並べる（`:61-71`）。検証のエラーはフォームの下にまとめて出すだけ（`:118-122`）。性別のエラー文は「性別データが正しくありません。管理者に確認してください。」（`:17`）。
- 下書き `web/js/drafts.js`: `CONTENT`（`:9`）に性別がない。`cleanDraft`（`:14-22`）は決まった項目だけ残す（旧コードのタブが storage イベントで読み直して保存し直すと、足した項目は消える）。`sameDraftContent`（`:39-41`）。キーは `${namespace}.drafts.${env}.${userIdKey}`（`:54`）。
- 名前の変更 `user-rename.js:31-74` の `moveUserStorage`: 配列のキーだけを移す（`:50` で配列でなければ飛ばす）。**オブジェクトの形のキーを足すと、名前の変更で移らない**。

### 実装の手順
1. **閉じる前の共通の口**（`ui/dialog.js`）
   ```js
   export function openDialog(title, { className = '', onClose, closeOnBackdrop = true, beforeClose, initialFocus } = {}) {
     // beforeClose(reason) が false を返したら閉じない。reason: 'dismiss'（×）| 'cancel'（キャンセル）| 'escape' | 'backdrop' | 'forced'
     // 戻り値: { dialog, body, footer, close, requestClose }（close は確かめずに閉じる＝保存の成功のあとに使う）
   }
   ```
   - ×・背景・キャンセルのボタン（呼び出し側は `modal.requestClose('cancel')`）・Esc（`cancel` イベントを `preventDefault` してから `requestClose('escape')`）を同じ `requestClose` に通す。
   - ブラウザが `preventDefault` を無視して閉じた場合（Chrome は利用者の操作なしで続けて止めると閉じることがある）に備え、`close` イベントで「`requestClose` を通らずに閉じた」なら `beforeClose('forced')` を呼ぶ（戻り値は使えない）。
   - `initialFocus`（要素）を受け取り、`showModal()` の後にそこへフォーカス（D-17）。`confirmDialog` の本文の `p` に id を付けて `aria-describedby` で結ぶ（D-17）。
2. **登録モーダルの下書きへの退避**（`ui/record-editor.js`）
   - 基準の入力（開いたとき、と「続けて登録」の `prepareNext` の直後）を覚える。**新規（`!original && !draft`）で、今の入力が基準と違い、パルかメモが 1 つでも入っている**ときだけ退避の対象（＝編集・下書き版・続けて登録の直後に親1 だけ残った状態・初期値のまま閉じた、は退避しない）。
   - `beforeClose`: 対象でなければ `true`。対象なら `validateRecordInput(value(), new Set(['', ...palsById.keys()]))` で確かめ、`context.drafts.add(fields, context.drafts.scope())` に**性別を含めて**保存。`null`（ログインしていない・名前の変更中）か、保存後に `context.drafts.saveFailed` なら、足した下書きを取り消して（`remove`）`errors` に「下書きに残せませんでした。登録するか、内容を控えてから閉じてください。」を出し `false`（フォームを残す）。成功したら `toast('下書きに残しました', { actionLabel: '破棄', action: () => context.drafts.remove(id, key) })` を出して `true`。
   - `forced`（止められずに閉じた）で保存に失敗したときは、トースト「入力を下書きに残せませんでした」＋「開き直す」（`context.register(input)`）。
   - 送信・下書きの保存が成功して閉じるときは `close()`（確かめない）。キャンセルのボタンは `requestClose('cancel')`。
3. **親の性別のトグル**（新規 `web/js/ui/gender-toggle.js`）
   ```js
   export function genderToggle({ label, value = '', onChange } = {}) {} // → { element, getValue, setValue, destroy }
   ```
   - `role="radiogroup"`（aria-label「親1の性別」など）に 3 つ: ♂（`M`）・♀（`F`）・指定なし（`''`）。記号と色は visual-parts の `genderMark()` とトークン。キーボードは矢印で移る。
   - 親1・親2 のパル選択の下に置く。編集では元の性別を入れる。**その枠のパルを変えたら、その枠の性別だけ空に戻す**（D-15 の判断の「枠ごとに比べる」）。`value()` は `sameParents` をやめてトグルの値を返す。
   - `validationMessages.INVALID_GENDER`（`:17`）を「性別のデータが正しくありません。開き直してください。」に。
4. **下書きの性別を別のキーに持つ**（`web/js/drafts.js`）
   - 新しいキー `${namespace}.draftGenders.${env}.${userIdKey}` に `{ [draftId]: { parent1Gender, parent2Gender } }`（`M`／`F` だけ。両方空の下書きは持たない）。
   - メモリ上の下書きは性別を含む形（`{ …今の項目, parent1Gender, parent2Gender }`）。`load` で下書きのキーと性別のキーを読んで合わせ、`save` で**下書きのキーには今の項目だけ**（旧コードの `cleanDraft` と同じ形）、性別のキーには id ごとの性別を書く（下書きにない id の性別は書かない＝消した下書きの性別も一緒に消える）。
   - `CONTENT`（`:9`）に `parent1Gender`・`parent2Gender` を足す（`sameDraftContent` が性別も比べる。送信の成功で消すのは送った内容と同じ下書きだけ、の決まり（`drafts.js:154` の `finish`）が性別でも効く）。`cleanDraft` は性別を `M`／`F`／`''` に整える。
   - `reload(key)`: 性別のキーが変わったときも下書きのキャッシュを捨てる（別タブの変更を読む）。`app.js:324-329` の storage イベントはそのままで届く。
   - `ui/record-editor.js` の `saveDraft`（`:176-191`）と、`ui/drafts-band.js` に移した `prepare`（今の `views/drafts.js:30` の「性別を空にする」）で性別を通す。
5. **名前の変更でキーを移す**（`user-rename.js`）
   - `moveUserStorage` に「オブジェクトのキー」の扱いを足す（`{ prefix, kind: 'object', merge }`）。`draftGenders` は移す元を優先して合わせる（同じ id があれば元の値）。goals-merge の観測のキーも同じ仕組みを使う。
   - `createRenamer` の `moveLocal`（`:94-102`）で、性別のキーの元と先も `drafts.reload` に渡す。
6. **レイアウト**（`ui/record-editor.js`・`app.css:606-615`）
   - 左にフォーム（約 460px）・右に参照列（約 300px）。左: 選択欄を式の並び「親1 ＋ 親2 → 子」（`.editor-pickers` を 5 列のグリッド、`equation-symbol` を入れる。D-19）、その下に性別のトグル、登録者（狭い select）とメモ（2 行の textarea）を横に並べる（D-20）、エラー。
   - 右（参照列）: 先頭に**高さを固定した確認の枠**（`min-height` を常に持つ。未選択のときは空）。親 2 体を選ぶと「登録済み: [子の画像] スプラドン」（`palTile`。3 件を超えたら「ほか N 件」。子の画像を押すと子のパル選択に入る）／未登録なら「まだ登録されていない組み合わせです」／子を選んで別の子が登録済みなら警告の色＋子の選択欄の枠を warning の色（D-14）。その下に「その親の登録済みの配合」（`findByParent` の上位数件）と、所持パルのデータがあれば親ごとの「所持 ♂n ♀m」（owned-overlay の `ownedBadge`）。
   - 高さの固定をやめる: `height: auto; max-height: 90dvh`（D-14 で警告の高さを決めたうえで。D-19 の判断）。パル選択の候補はすでにモーダルの外に浮かせているので触らない（`pal-picker.js:83-106`）。
7. **選び方・エラー**（D-17・D-18・D-20）
   - 開いたとき、最初の未選択のパル選択のトリガーにフォーカス（`initialFocus`）。
   - 検証に失敗したら、最初の未選択の `palPicker` のトリガーに `aria-invalid="true"` と error の枠を付けてフォーカスし、エラー文の要素と `aria-describedby` で結ぶ。選び直したら外す（`palPicker` に `setInvalid(message)` を足すか、呼び出し側でトリガーに付ける）。
   - 登録者の選択肢を「自分を先頭、残りは五十音順」（`setRegistrant` の `users` を並べ替える）。
   - ログイン画面: ID が入っていればパスワード、なければ ID にフォーカス、ID の欄に `maxLength = 20`（`app.js:216-223`。D-17）。

### 触るファイル
- 変更: `web/js/ui/dialog.js`、`web/js/ui/record-editor.js`、`web/js/drafts.js`、`web/js/ui/drafts-band.js`（`prepare` の性別）、`web/js/ui/pal-picker.js`（`setInvalid` を足すなら）、`web/js/user-rename.js`、`web/js/app.js`（ログイン画面のフォーカス）、`web/css/app.css`、`web/js/release-notes.js`
- 新規: `web/js/ui/gender-toggle.js`

### テスト
- `test/web/dialog.test.js`: `beforeClose` が ×・キャンセル・Esc・背景で同じ理由つきで呼ばれ、`false` で閉じないこと、`requestClose` を通らずに閉じたときに `'forced'` で呼ばれること、`initialFocus`。
- `test/web/record-editor.test.js`: 新規の入力で閉じると下書きに 1 件でき（性別つき）、トーストの「破棄」で消えること。編集・下書き版・続けて登録の直後・初期値のままでは下書きができないこと。下書きの保存に失敗したらモーダルが残ること。性別のトグル（枠のパルを変えるとその枠だけ空）。`:307`（「この組み合わせは登録済み: → セレムーン」）を新しい確認の枠の内容に。エラーで最初の未選択の欄にフォーカスし `aria-invalid` が付くこと。
- `test/web/drafts.test.js`: 性別が下書き→編集の再開→一括登録まで通ること、旧コードの形（性別のキーがない・下書きのキーに性別がない）を読めること、**旧コードの `cleanDraft` で下書きのキーが書き直されても性別のキーが残ること**、下書きを消すと性別も消えること、別タブで性別のキーが変わったら読み直すこと。
- `test/web/user-rename.test.js`: 性別のキーが新しい名前へ移ること（移し先にあれば元を優先して合わせる）。
- `test/web/app.test.js`: ログイン画面の初期フォーカス。

### INV-2・互換・セキュリティ・性能の注意
- 互換: 旧コードのタブは性別のキーを知らないので触らない。旧コードが下書きを編集してパルを変えた場合、その下書きの性別は残ったまま（id が同じため）。気になるなら「パルが変わったら性別を捨てる」ために、性別のキーに親の ID も控えておき、合わなければ捨てる（推奨）。
- 互換: 性別つきの手入力の記録が増えると、継承ルートに「性別条件は未検証」が付く段が増える（route-cleanup で言い換えるまで）。
- 保存データ: 性別の値は `M`／`F`／`''` 以外を捨てる（data-boundary の検証に通す）。

### release-notes の案
- id: `<実装日>-register-dialog`／title: 「登録画面を見直し」（8 字）／body: 「閉じても入力は下書きに残ります。親の ♂♀ も記録でき、右に登録済みの配合と所持数を出します。」（47 字）

### 完了の条件
- [x] `npm test` が通る。
- [x] モックで: 入力して Esc・×・キャンセルのどれで閉じても下書きの帯に 1 件増え、「破棄」で消える。編集・続けて登録の直後は増えない。
- [x] 性別を付けた下書きを帯から「登録」すると、記録に性別が入る（カードに ♂♀ が出る）。
- [x] 実測: 親・子を選んでもメモ欄が動かない（今は +71px・+35px）。
- [x] 旧コードの版を別タブで開いたまま、新しい版で性別つきの下書きを作り、旧タブで別の下書きを足しても、性別が消えない（ブラウザで確かめる）。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — 下書きのキーに性別を足していない（性別は `draftGenders` の別のキー）。旧コードの `cleanDraft` で下書きのキーが書き直されても性別が残り、下書きを消すと性別も消え、名前の変更で性別のキーが移る（`drafts.test.js`・`user-rename.test.js`）。性別の値は `M`／`F`／`''` 以外を捨てる（data-boundary）。INV-2 — 確認の枠の「登録済み」は登録済みの記録だけで、配合表を使わない。セキュリティ — `test/static/security.test.js` が通る。性能 — 対象外。

### TODO
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

### 実装の記録（2026-10-15、ブランチ `feature/register-dialog`）

実装のときに決めたこと・文書と違う形にしたこと（後の goals-merge・settings・roles はこちらを正とする）。

1. **閉じる前の口（手順 1）**: `openDialog(title, { …, beforeClose, initialFocus })` は `{ dialog, body, footer, close, requestClose }` を返す。×（`'dismiss'`）・Esc（`'escape'`）・背景（`'backdrop'`。`closeOnBackdrop` のとき）・キャンセル（呼び出し側が `requestClose('cancel')`）が `requestClose` を通る。Esc は、ダイアログの中に `aria-expanded="true"` の要素（開いている候補）があれば何もせず、ui/popover.js の cancel の処理に任せる（候補が先に閉じる。前と同じ）。`close()` は確かめずに閉じる。どちらも通らずに閉じたら、閉じた後に `beforeClose('forced')`（`closeDialogs` のログアウトなど）。Esc・背景のリスナーは閉じたら外す（AbortController）。`confirmDialog` のキャンセルも `requestClose('cancel')`、本文の `p` を `aria-describedby` で結ぶ。
2. **退避（手順 2）**: 基準の入力（`markBaseline`）は開いたとき（初期値を入れた後）と「続けて登録」の直後。新規（編集でも下書き版でもない）・`context.drafts` がある・基準から変わった・パルかメモが入っている、のときだけ退避する。`validateRecordInput`（パルの未選択は許す）を通して性別ごと `drafts.add`。失敗（ログインしていない・ID の変更中・`saveFailed`）なら足した下書きを消し、`'forced'` 以外はフォームを残して「下書きに残せませんでした。登録するか、内容を控えてから閉じてください。」（検証の失敗ならその文）で `false`。`'forced'` で失敗したら、ログイン中だけエラーのトースト「入力を下書きに残せませんでした」＋「開き直す」（`context.register(input)`）。成功は「下書きに残しました」＋「破棄」（`drafts.remove`）。
3. **性別（手順 3）**: `web/js/ui/gender-toggle.js` の **`genderToggle({ label, value, onChange }) → { element, getValue, setValue, destroy }`**（ui/segmented.js の radiogroup に ♂〔`M`〕・♀〔`F`〕・指定なし〔`''`〕。`.gender-toggle`。選んだ ♂・♀ は `--gender-male`・`--gender-female` の地）。親1・親2 の選択欄の下の `div.editor-genders`（選択欄と同じ 5 列の格子）。初期値は `initial.parent1Gender`・`parent2Gender`（編集・下書きの編集）。パル選択の onChange でその枠の性別だけ空に（`sameParents` はやめた）。`value()` はパルを選んでいない枠の性別を空にして返す。`INVALID_GENDER` の文は「性別のデータが正しくありません。開き直してください。」。
4. **下書きの性別のキー（手順 4）**: `${namespace}.draftGenders.${env}.${userIdKey}` に `{ [下書き id]: { parent1Gender, parent2Gender, parent1Id, parent2Id } }`（**文書の推奨どおり親の ID を控え、読むときに今の下書きの親と違う枠の性別は捨てる**。前の版のタブでパルを変えた下書きに前のパルの性別を残さない）。性別のある下書きがなければキーを消す。下書きのキーには前の版の `cleanDraft` と同じ 7 項目だけ（`STORED`）。メモリ上の下書きは `parent1Gender`・`parent2Gender` を持ち（パルのない枠は空）、`CONTENT` に足したので `sameDraftContent`・送信の成功で消す判定・内容が変わったら登録 ID を使い回さない、が性別でも効く。`reload(key)` は性別のキーを受けたら同じ環境・ID の下書きのキーを読み直す（app.js の storage イベントはそのまま）。`DRAFT_GENDERS` を export。帯の `prepare` は性別を通し（前は空にしていた）、行の式に性別の印を出す。
5. **名前の変更（手順 5）**: `moveUserStorage` にオブジェクトの形のキーの扱い（今は `draftGenders` だけ。移し先と合わせ、同じ id は元を優先・元を消す）。`moveLocal` で性別のキーの元と先も `drafts.reload` に渡す。goals-merge の観測のキー（`goalsObs`）は同じ並びに足せる。
6. **レイアウト（手順 6）**: **文書の「左にフォーム（選択欄を含む）・右に参照列」は、選択欄を上の全幅の行に出した**（左の列〔約 460px〕に 3 つの選択欄を式の並びで入れると 1 欄 約 135px で、選んだパルの名前が 2〜3 文字しか見えないため）。上: `div.editor-pickers`（5 列の格子。見出しは入力の上・記号は入力の行・選択欄の高さは 40px に固定）と `div.editor-genders`。下: `div.editor-columns`（左 1fr: `div.editor-details`〔登録者 170px・メモ 2 行〕とエラー、右 290px: `aside.editor-reference`）。参照列は**高さ 236px に固定**（中はスクロール）: `div.editor-check`（高さ 92px 以上。未選択「親1・親2 を選ぶと、登録済みの配合を確かめます。」／未登録「まだ登録されていない組み合わせです。」／登録済み「この組み合わせは登録済み:」と子の絵のボタン〔3 件まで・「ほか N 件」。押すと子の欄に入る〕／別の子が登録済みなら `.is-warning` と子の選択欄の枠を warning の色）、`div.editor-parent-records`（親1、なければ親2 の登録済みの配合 4 件まで。相手 → 子）、`div.editor-owned`（所持パルのデータがあれば「所持 親1 ♂n ♀m 親2 未所持」。`ownedBadge`。開いたときの所持パルで 1 回数える）。モーダルの高さの固定（800×600）をやめ `max-height: 90dvh`、幅は 820px まで。
7. **フォーカスとエラー（手順 7）**: 開いたら最初の未選択のパルの欄（どれも選んであれば登録のボタン）へ。`openDialog` の `initialFocus` は、選択欄がダイアログを開いた後に作られるので登録のモーダルでは使わず、作った後に移す。検証のエラーにパルの欄があれば、最初の未選択の欄のトリガーに `aria-invalid="true"`・`aria-describedby`（エラーの要素）・`.is-invalid`（danger の枠）を付けてフォーカス、選び直したら外す（pal-picker には `setInvalid` を足さず、呼び出し側で付けた）。登録者は自分を先頭、残りは五十音順（今の値が一覧になければ先頭に足す）。ログイン画面の ID に `maxLength = 20`（初期フォーカスは copy-dead-ends で入っていた）。
8. **テスト**: 1,527 → 1,538 件（`npm test` exit 0）。dialog.test.js（requestClose の理由と false・close・forced、initialFocus と aria-describedby）、record-editor.test.js（×・Esc・キャンセルで退避と「破棄」、退避しない 4 通り、残せないときと forced、フォーカス・aria-invalid・登録者の並び、確認の枠の警告・子の絵・所持数・親の登録済み。親を変えた編集はその枠の性別だけ空に〔前は両方空のテストを書き換えた〕・形のテスト）、drafts.test.js（性別の別のキー・帯から登録で記録に入る・消したらキーも消える、前の版の書き直しで残る・パルを変えた枠は捨てる・別タブの性別のキーで読み直す・形の合わない値・性別だけの変更）、user-rename.test.js（性別のキーの移動と合わせ方）、app.test.js（ID の maxLength）。
9. **画面（モック・1100×900。`Claude outputs/ui-audit-2026-10/shots/find-merge/`）**: 「＋ 配合を登録」で開くとフォーカスは親1。親1 → 親2 → 子（登録済みと違う子）と選んでも、メモ欄の top は 402.89px・フッターは 632.3px のまま（基準は +71px・+35px）。確認の枠は「この組み合わせは登録済み: カモノスケ」から警告の色に（`30-record-dialog-1100-light.png`・`31-…-dark.png`）。親1 を ♂ にして Esc で閉じると「下書きに残しました」＋「破棄」、帯が 19 → 20 件（`32-after-escape-1100-light.png`）。
   - **確かめていないこと**: 完了の条件の「旧コードの版を別タブで開いたまま、新しい版で性別つきの下書きを作り、旧タブで別の下書きを足しても性別が消えない」は、旧版（integrate/phase-1d の版）を同時に配信する用意がないのでブラウザでは確かめていない（drafts.test.js で旧版の書き直しの形を再現して確かめた）。
10. **後のテーマへの申し送り**:
    - goals-merge: 観測のキー（オブジェクトの形）は user-rename.js の「オブジェクトの形のキー」の並びに prefix を足す。ウィッシュリストの削除の元に戻すも、ideals・drafts と同じく今のキーだけにする（フェーズ 1d の申し送り）。
    - roles・settings: ダイアログで「閉じる前」に確かめたいときは `beforeClose`（false で閉じない）と `requestClose('cancel')`。ワールドの登録のモーダルの「背景で閉じない」は `closeOnBackdrop: false`。
    - route-cleanup: 手入力の記録に性別が付くようになったので、継承ルートの「性別条件は未検証」が付く段が増える（言い換えは route-cleanup）。

---

## goals-merge: ウィッシュリストを目標に統合

### 目的
ウィッシュリストを理想個体の「目標」にまとめ、タブを廃止する。「種族だけの目標」（パッシブなし・個体値の条件なし。画面のタグは「パルだけ」）として同じ一覧に並べ、配合の登録の観測（作れる・配合が増えた）と、所持個体での完成を、それぞれ知らせる。旧データは安全に移す。

### 経緯
- **D5**（別セッションでのユーザーの回答）。別プランの F071（統合）・F027（通知の文に親）・F004（レールのバッジ）、本セッションの D-34（目標に登録のトグル）・D-35（行に登録済みの組）・D-36（所持の状況）・D-37（言い換え）・D-38（行からのリンク）・D-40（常時の説明文を消す）。
- 調査の時点では、2 つを 1 つの「目標」にまとめる D-43 は「工数 L・移行・通知 ID の互換・名前の変更の作り直しが費用に見合わない」として却下していた。**D5 で覆った**（rejected.md の D-43）。却下の理由に挙がった移行・通知 ID・名前の変更は、下の手順で全部扱う。
- 別プラン §9「P1 ウィッシュ統合」と Codex のプランレビュー 6 回目 1・2・4（どれも本セッションでの指摘）:
  - **6 回目 1（高）**: 観測の状態を目標の中に足すと、旧コードのタブが保存し直したときに消える（`core/ideal-goals.js:56` の `cleanGoal` は決まった項目しか残さない）→ **観測の状態と移行の記録は、旧コードが書き換えない別のキー**（`${namespace}.goalsObs.<env>.<userIdKey>`）に持つ。名前の変更と別タブの更新（storage）でも移す。
  - **6 回目 2（高）**: 同じ条件の目標との重複（`parseGoals` `:79` は重複の後ろを捨てる、名前の変更 `user-rename.js:56` は単純に連結する）と 100 件の上限（`parseGoals` `:84`）→ 移行専用の併合を書き、上限を超える分は「未移行」として残し、**全件を移せるまで移行元を消さない**。
  - **6 回目 4（中）**: 保存の成否の確かめ方（`ideals.add` は保存に失敗しても `'added'` を返す `ideals.js:135-136`、`markRead` も失敗を返さない `notifications.js:89`）→ **移行専用の書き込みで成否を確かめ、読み戻してから移行元を消す**。
  - **6 回目 5（中）**: `#/wishlist` の読み替えはこのテーマで入れる。移行に失敗している間は、旧ウィッシュリストを読み取り専用で開ける入口を残す。
- **保存の形は変えない**（統合プランの「本プランの方を残したもの」）: 目標そのものは今の配列・今の項目のまま。種族だけの目標は「パッシブなし・個体値の条件なし（0）」で表せるので新しい項目は要らない。`{ version, goals }` で包むと、名前の変更の移行（`user-rename.js:50` の `Array.isArray`）と読み込み（`core/ideal-goals.js:74`）が空として扱って壊れる。別プランの「保存形式 v2」は採らない。
- 通知の文: F027 の「A＋B で作れます（ほか N 組）」は**登録済みの記録の親**なので INV-2 に触れない（配合表の答えを出す「予想は X」とは別）。D-37 の判断に合わせ、「作成可能」は「配合が登録されました」に言い換える。

### 依存
- find-merge（通知・行のリンク先 `#/search?c=`、配合を探すの空の状態）、ideal-panel（フェーズ 1。「目標（N）」のボタンとダイアログの表）、owned-overlay（「所持 n 体（親になれる m）」の集計）。
- talent-target（フェーズ 1。個体値の 0 を「条件なし」と表示する）、participant-self（「自分」の判定）も入っている前提。

### このテーマでやらないこと
- 目標の一覧の並び・集計チップ・種族ごとのまとまり・未完成の行の「パッシブ 3/4 · 攻撃あと 8」（フェーズ 3 の goals-detail）。
- 目標の共有（F047。フェーズ 4 の任意）。
- 継承ルートの目標のパルにトグルを置くこと（D-34 の判断で、置くのはパル詳細と配合を探すだけ）。
- 理想個体の登録の保存の形の変更（上のとおり変えない）。

### 現状（HEAD ad648b7 で確認）
- ウィッシュリストのストア `web/js/wishlist.js`: キー `${namespace}.wishlist.${env}.${userIdKey}`（`:62-65`）、1 件の形 `{ palId, addedAt, craftable, readyAt, observedAt, pairs, found }`（`cleanWish` `:20-33`）。観測は確定データ（`store.state.confirmedRecords`）で、各ウィッシュの `observedAt` より新しいサーバ時刻のときだけ（`observe` `:107-134`）。作れるようになったら `readyAt`、作れる間に新しい親の組が見つかったら `found` に足す。追加した時点で作れるものは知らせない（`add` `:145-156`）。
- 通知 `wishlistNotificationSource`（`wishlist.js:181-204`）: id は `wishlist:${env}:${palId}:${readyAt}` と `wishlist:${env}:${palId}:${pair}:${at}`、title「◯◯が作成可能になりました」「◯◯の配合が増えました」、href `#/reverse?c=`（find-merge で `#/search?c=`）。
- 画面 `views/wishlist.js`: 常時の説明文（`:20-22`、47 字）、作れる行は全体が逆引きへのリンク（`:50-57`）、作れるかは画面のデータ（送信待ちを含む）で `findByChild`（`:68`）。追加はこの画面の選択欄からだけ（`:27-41`。D-34）。
- 理想個体の登録 `web/js/ideals.js`: キー `${namespace}.ideals.${env}.${userIdKey}`（`:25-28`）、`save` は保存の失敗を `saveFailed` にするだけ（`:40-48`）、`add` は `'added'`／`'duplicate'`／`'full'`／`null`（`:124-137`）。完成の判定は `worlds[worldId]`（`judged` `:75-82`）。通知の id は `ideal:${env}:${goal.id}:${worldId}:${completedAt}`（`:169`）。
- `core/ideal-goals.js`: `cleanGoal`（`:41-68`）・`parseGoals`（`:71-85`。同じ id・同じ `goalKey` は先を残し、100 件で切る）・`goalKey`（`:91-93`）・`goalMatches`（`:146-154`。個体値は `<= 0` で条件なし）。`GOAL_LIMIT = 100`（`:15`）。
- 名前の変更 `user-rename.js:37-44` は `wishlist`・`ideals` のキーを配列として移す（移し先があれば元を先にして連結）。オブジェクトの形のキーは扱わない（`:50`。register-dialog でオブジェクトの移動を足している）。
- `app.js`: `createWishlistStore`（`:57`）、通知の元（`:81`）、名前の変更（`:83`）、`wishlist.subscribe`（`:320`）、storage イベント（`:326`）、`context.wishlist`（`:162`）、タブ（`:103`）、ビュー（`:32,208`）。

### 実装の手順
1. **種族だけの目標**（`core/ideal-goals.js` に足す）
   ```js
   /** 種族だけの目標（パッシブなし・個体値の条件なし。画面のタグは「パルだけ」）。保存の形は今の目標のまま。 */
   export function speciesGoal(palId, { name, addedAt = '' } = {}) {} // → cleanGoal に通せる値（mode 'include'・targets 0・cake 'none'）
   export const isSpeciesGoal = (goal) => goal.passives.length === 0 && goal.mode === 'include' && GOAL_STATS.every((key) => goal.targets[key] === 0);
   ```
   - `mode: 'only'` でパッシブなしは「パッシブを持たない個体」という本当の条件なので、種族だけの目標に含めない。
2. **観測のキー**（新規 `web/js/core/goal-observations.js`。DOM なし）
   ```js
   // 保存の形（${namespace}.goalsObs.<env>.<userIdKey>）。旧コードのタブはこのキーを知らないので書き換えない。
   // { version: 1,
   //   species: { [palId]: { craftable, readyAt, observedAt, pairs: string[] | null, found: [{ pair, at }] } },
   //   migration: { wishlist: { migrated: { [palId]: goalId }, pending: string[], doneAt: string } } }
   export function cleanObservations(value) {} // 形の合わないものは捨てる（data-boundary の検証を通す）
   export function observeSpecies(entry, currentPairs, serverTime, time) {} // wishlist.js:120-133 の 1 件分の判定をそのまま移す
   export function mergeObservation(a, b) {} // pairs・found の和、craftable は新しい observedAt の方、readyAt は早い方
   ```
3. **ideals ストアに観測を持たせる**（`web/js/ideals.js`）
   - 観測のキーの読み書きを、目標と同じ「最新に対して書き換える・保存の失敗を `saveFailed` に」の型で足す（`obsScope()`・`loadObs`・`saveObs`）。
   - `store.subscribe` で、`wishlist.js:107-134` と同じ条件（ログイン中・キャッシュでない・名前の変更中でない・サーバ時刻が読める）で、**目標のある種族ごと**に観測を進める（各種族の `observedAt` より新しいサーバ時刻のときだけ）。確定データ（`confirmedRecords`）から子ごとの親の組を作る（`wishlist.js:94-105` の `confirmedPairs` を移す）。
   - `add`: その種族の観測がなければ、今の組で作り、通知はしない（`wishlist.js:145-156` と同じ。登録した時点で作れるものは知らせない）。`remove`: その種族の目標がほかになければ観測も消す（ウィッシュを外すと通知が消えたのと同じ）。`restore`: 観測を作り直して判定し直す。
   - `observation(palId)` を公開する（行の表示に使う）。
   - `reload(key)`: 観測のキーと旧ウィッシュリストのキーにも反応する（後者は手順 4 の移行をやり直す）。
4. **移行**（新規 `web/js/goals-migration.js`。ideals ストアから、ログイン中のスコープごとに 1 回と、旧キーの storage イベントのたびに呼ぶ）
   ```js
   export function migrateWishlist({ storage, namespace, env, userKey, now = Date.now, palName }) {}
   // → { status: 'none' | 'done' | 'partial' | 'failed', migrated: number, pending: number }
   ```
   - 旧キー `${namespace}.wishlist.${env}.${userKey}` を読み、`parseWishes`（`wishlist.js:35-48` と `cleanWish` をこのファイルに移す）で整える。なければ `none`。
   - 目標（`parseGoals`）と観測（`cleanObservations`）を読む。ウィッシュを 1 件ずつ:
     - `migration.wishlist.migrated[palId]` があれば飛ばす（**目標が消えていても作り直さない**＝ユーザーが外した。旧コードのタブがウィッシュリストを書き戻しても、外した目標は戻らない）。
     - 同じ条件の目標（`goalKey(speciesGoal(palId))` が同じ）があれば、その id に併合する（目標は増やさない）。
     - なければ、目標が 100 件（`GOAL_LIMIT`）に達していれば `pending` に入れて次へ。達していなければ**決まった id `wish-${palId}`**（`cleanGoal` の id の形 `/^[A-Za-z0-9_-]{1,64}$/` に合う。パル ID は英数字と `_` だけ）の目標を作る（名前はパルの和名、`addedAt` はウィッシュの `addedAt`）。同じ id がすでに別の条件で使われていれば `wish-${palId}-2` などにずらす。新しい目標は今の目標の後ろに、ウィッシュリストの並び順で足す。
     - 観測 `species[palId]` に、ウィッシュの `{ craftable, readyAt, observedAt, pairs, found }` を `mergeObservation` で併せる。`migrated[palId] = goalId`。
   - **書く順番**（`storage.setItem` を try/catch で包み、成否を自分で確かめる。`ideals.add`・`ideals.save` は使わない）: ① 目標のキーを書く → ② 観測のキー（移行の記録を含む）を書く → ③ 両方を読み戻し、移した目標の id と観測があることを確かめる → ④ 既読の写し（下の注）→ ⑤ `pending` が空なら旧キーを消して `doneAt` を書く。どこかで失敗したら `failed` を返し、旧キーは消さない（次の起動で続きから。目標の id が決まっていて `goalKey` で併合するので、やり直しても同じ結果）。
   - **既読の写し（④）について**: 新しい通知も**旧と同じ id の形**（`wishlist:${env}:${palId}:${readyAt}`・`wishlist:${env}:${palId}:${pair}:${at}`）で出す（手順 6）ので、既読はそのまま引き継がれ、写す作業は要らない。統合プランの手順「旧通知の既読を新しい id へ写す」は、この形なら空になる。**もし id の形を変えるなら**、`${namespace}.notifications.read.${userKey}`（環境を含まない）を読み、対応する新しい id を足して書き、読み戻して確かめてから ⑤ に進む。
   - 名前の変更の途中（`store.state.renaming`）は動かさない。
5. **名前の変更と別タブ**（`user-rename.js`）: register-dialog で足した「オブジェクトのキーの移動」に `${namespace}.goalsObs.${env}.` を足す（併せ方: `species` は元を優先して `mergeObservation`、`migrated` と `pending` は和）。`createRenamer` の `moveLocal` で観測のキーも `ideals.reload` に渡す。旧ウィッシュリストのキーは、移し終わるまで今どおり移す（配列）。
6. **通知の元を差し替える**（`web/js/ideals.js` に `goalObservationSource({ store, ideals })` を足し、`app.js:81` の `wishlistNotificationSource` と入れ替える）
   - id は旧と同じ形（上の注）。title は「◯◯の配合が登録されました」（作れるようになった）・「◯◯の配合が増えました」（作れる間に新しい組）。body は「A＋B で作れます（ほか N 組）」・「A＋B でも作れます」（**登録済みの記録の親**。配合表は使わない）。href は `buildHash('search', { c: palId })`。
   - **知らせる種族**: 観測はすべての目標の種族について持つ（行に「配合: 登録済み n 件」を出すため）が、**通知は「種族だけの目標」がある種族だけ**に出す（ウィッシュリストと同じ意味にとどめ、パッシブつきの目標に新しい通知を増やさない）。すべての目標で知らせたいとユーザーが言えば、この条件を外すだけでよい。
   - 種類のチップでは、bell の `notificationCategory` で goal（目標）に分類される（id の頭 `wishlist:`・`ideal:`。通知に kind は付けない）。
7. **目標の一覧**（`views/ideal.js`。ideal-panel で作った「目標（N）」のボタンとダイアログの表）
   - 見出し・ボタンを「目標」に。種族だけの目標も同じ表に並べ、名前の横に「パルだけ」のタグ。
   - 行に: 完成の状態（今の `goalStatus` `views/ideal.js:141-149`。種族だけの目標は「自分の個体にその種族のタマゴ以外が 1 体でもいれば完成」になる）、「配合: 登録済み n 件 →」（画面のデータの `findByChild(state.index, palId).length`、リンク `buildHash('search', { c: palId })`。0 件なら「配合: 未登録」）、所持パルのデータがあれば「所持 n 体（親になれる m）」（owned-overlay の `ownedCounts`）、操作「呼び出す」（パルだけの目標は `#/ideal?to=<palId>`）・「外す」（確認なしで外してトーストで「元に戻す」）。
   - 空の状態の文（D-40）: 「目標はまだありません。条件を選んで「目標として保存」を押すか、パル詳細の「目標に登録」から足すと、完成や配合の登録をベルで知らせます。」
   - 移行が `partial`・`failed` のとき、表の上に 1 行: 「ウィッシュリストの n 件をまだ目標に移せていません（目標が 100 件の上限です）」／「ウィッシュリストを目標に移せませんでした」＋「旧ウィッシュリストを見る」（読み取り専用のダイアログ。旧キーを `parseWishes` で読み、パルのタイルと「配合あり／未登録」だけを並べる。追加・削除はできない）。
   - `#/ideal?goals=1` で開いたら目標のダイアログを開き、`goals` を URL から外す（`context.replace`）。
8. **「目標に登録」のトグル**（新規 `web/js/ui/goal-toggle.js`）
   ```js
   export function goalToggle(context, palId) {} // → { element, update, destroy }（ideals.subscribe で表示を同期）
   ```
   - 押しボタン（`aria-pressed`）。未登録なら「☆ 目標に登録」、登録済み（`ideals.has(speciesGoal(palId))`）なら「★ 目標に登録済み」。押すと `ideals.add(speciesGoal(palId, { name }))` か外す（トーストに「元に戻す」。`'full'` なら「目標は 100 件までです」、`null` なら「ログインしてから登録してください」）。星の形は `nav-icons.js:10` の path を、visual-parts で作った `ui/icons.js` に移して使う（追記 2026-10-14: visual-parts で `ICONS.wishlist` に移した。`icon('wishlist')` で引ける。ウィッシュリストのタブを外すときは名前を `star` などに変えて残す）。
   - 置き場所: パル詳細のヒーローの操作（`views/pal.js:18-21`）、配合を探すで子だけを選んで 0 件のときの空の状態（「☆ 目標に登録（作れるようになったら知らせます）」を主な操作、「この子の配合を登録」を 2 番目）。
9. **レールのバッジ**（F004）: 理想個体のタブに「完成した目標 n」（表示中のワールドで `worlds[worldId].complete` の目標の数。0 なら隠す）。`app.js` で `ideals` と `owned` を購読し、バッジの文字・`hidden`・タブの aria-label（「理想個体（完成した目標 2 件）」）だけを書き換える（`render` は呼ばない）。
10. **タブとファイルを片づける**: `#/wishlist` を旧画面の表に足す（`#/wishlist` → `#/ideal?goals=1`）。`router.js:1` の `views`・`app.js:103` の `tabs`・`:32,208` の import と対応・`nav-icons.js:10` から `wishlist` を外す（追記 2026-10-14: visual-parts の後は、アイコンの定義は `web/js/ui/icons.js` の `ICONS` にある。nav-icons.js は `navIcon(view)` だけ）。`views/wishlist.js` と `web/js/wishlist.js` を削除（`parseWishes`・`cleanWish` は `goals-migration.js` へ移した）。`app.js:57,81,83,162,320,326` の `wishlist` を消す。`createRenamer` の引数から `wishlist` を外し、`localSaveFailed`（`user-rename.js:91`）は drafts と ideals だけを見る。keep-state の最後のタブの許可リストから `wishlist` を外す。

### 触るファイル
- 変更: `web/js/core/ideal-goals.js`、`web/js/ideals.js`、`web/js/views/ideal.js`、`web/js/views/pal.js`、`web/js/views/search.js`、`web/js/user-rename.js`、`web/js/app.js`、`web/js/router.js`、`web/js/ui/nav-icons.js`、`web/js/ui/icons.js`（visual-parts で作ったもの）、`web/css/app.css`、`web/js/release-notes.js`、`docs/OPERATIONS.md`（ウィッシュリスト・理想個体の記述）
- 新規: `web/js/core/goal-observations.js`、`web/js/goals-migration.js`、`web/js/ui/goal-toggle.js`、`test/web/goals-migration.test.js`、`test/core/goal-observations.test.js`
- 削除: `web/js/wishlist.js`、`web/js/views/wishlist.js`、`test/web/wishlist.test.js`（中身は下のテストへ移す）

### テスト
- 新規 `test/web/goals-migration.test.js`（偽の storage。`setItem` を失敗させられるもの）:
  - ウィッシュ 3 件 → 目標 3 件（id `wish-<palId>`）と観測ができ、旧キーが消える。**2 回目を走らせても変わらない**。
  - 同じ条件の目標がすでにある種族は、目標を増やさず観測だけ併せる。
  - 目標が 98 件のときウィッシュ 5 件 → 2 件だけ移り、`pending` 3 件・旧キーは残る（`partial`）。目標を外して空きができた後にもう一度走らせると残りが移る。
  - 目標のキーの書き込みが失敗 → 何も消えない（`failed`）。観測のキーの書き込みが失敗 → 旧キーは残り、次の実行で続きから。読み戻しで目標が見つからない → 旧キーを消さない。
  - ユーザーが移した目標を外した後、旧キーにウィッシュが書き戻されても（旧コードのタブ）、その目標は作り直さない。
  - **旧コードの `cleanGoal`・`parseGoals` で目標のキーを書き直しても、移した目標と観測が残る**（観測は別のキー）。
- `test/core/goal-observations.test.js`: `observeSpecies`（作れるようになる・作れる間に組が増える・作れなくなると `found` が消える・初めての観測は知らせない）を `test/web/wishlist.test.js` の観測のテストから移す。`cleanObservations`・`mergeObservation`。
- `test/web/ideals.test.js`: 目標の追加で観測ができる（その時点で作れても知らせない）、最後の目標を外すと観測も消える、通知の id が旧ウィッシュリストと同じ形、**通知は種族だけの目標がある種族だけ**、観測のキーの storage イベントで読み直す。別プラン §9 の C の `ideals.test.js:50,167` 付近は、identity・形を変えていなければそのまま通るはず（変えたら直す）。
- `test/web/user-rename.test.js`: 観測のキーが新しい名前へ移る（移し先にあれば併せる）。
- `test/web/app.test.js:456-505`（ウィッシュリストのフロー）を、パル詳細の「☆ 目標に登録」→ 仲間の登録 → ベルに「◯◯の配合が登録されました」（href `#/search?c=`）→ 目標の行に「配合: 登録済み 1 件」、に書き換える。`#/wishlist` を開くと理想個体の目標のダイアログが開くことを足す。
- `test/web/ideal-view.test.js`: 目標の表に種族だけの目標（「パルだけ」のタグ）が並ぶ・「配合: 登録済み n 件」・空の状態の文・`goals=1`。ideal-panel で書き換わった後の行で探す。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 観測と通知は確定した登録済みの記録（`confirmedRecords`）だけで決める。通知の文に出す親も登録済みの記録のもの。配合表・`core/ideal.js` は使わない（`goals-migration.js`・`core/goal-observations.js` は `core/ideal-goals.js`・`core/pair.js`・`core/user.js` だけを読む）。
- 互換: 旧コードのタブは、目標のキーを今の形で読み書きする（移した目標も普通の目標として扱える）。観測のキーと移行の記録は知らないので触らない。旧コードのタブはウィッシュリストのキーを書き戻すことがあるが、移行は `migrated` の記録で同じ結果になる。
- 互換: 移行の途中で閉じても、次の起動で続きから（決まった id・`goalKey` の併合・旧キーは最後に消す）。
- セキュリティ: 旧キーの中身は信用しない（`parseWishes` と data-boundary の検証を通し、パル ID はマスターにあるものだけ）。名前は `textContent`。
- 性能: 観測はサーバ時刻が新しくなったときだけ・目標のある種族（100 件まで）だけ。

### release-notes の案
- id: `<実装日>-goals-merge`／title: 「ウィッシュリストを目標に」（12 字）／body: 「ウィッシュリストは理想個体の「目標」に移りました。パルだけの目標も登録でき、配合の登録を知らせます。」（50 字）

### 完了の条件
- [x] `npm test` が通る（移行のテストを含む）。
- [x] モックで、旧ウィッシュリストのデータ（`pal-note.local.wishlist.test.<ID>` に手で入れる）から起動すると、目標の一覧に「パルだけ」の目標として並び、旧キーが消える。もう一度読み込んでも増えない。
- [x] 旧ウィッシュリストで既読だった「作成可能になりました」の通知が、移行後も既読のまま。
- [x] 目標を 98 件にしてから 5 件のウィッシュで起動すると、「まだ目標に移せていません」と「旧ウィッシュリストを見る」が出る。旧キーは残り、目標を外して空きを作ってから読み込み直すと残りが移って旧キーが消える。
- [x] 同じ条件の目標（`goalKey` が同じ）がすでにある種族は、目標が増えず観測だけが併せられる（`goals-migration.test.js`）。
- [x] 書き込みの失敗（目標のキー・観測のキー）と読み戻しの不一致では旧キーが消えず、次の起動で続きから同じ結果になる（`goals-migration.test.js`。書く順番は「目標 → 観測と移行の記録 → 読み戻し → 既読の写し（id が同じ形なので空）→ 旧キーを消す」）。
- [x] 旧コードのタブ（フェーズ 1 の版）を開いたまま移行しても、旧タブが目標のキーを書き直した後に観測の状態と移行の記録（`goalsObs` の別のキー）が残り、旧タブがウィッシュリストを書き戻しても外した目標が戻らない（ブラウザとテスト）。
- [x] 名前の変更で `goalsObs` のキーが新しい名前へ移り、別のタブでの変更（storage）で観測を読み直す（`user-rename.test.js`・`ideals.test.js`）。
- [x] パル詳細と、配合を探すで子だけを選んで 0 件のときに「☆ 目標に登録」が出る。レールの理想個体に「完成した目標 n」のバッジ（0 なら出ない）。
- [x] `#/wishlist` が履歴を増やさずに目標のダイアログ（`#/ideal?goals=1`）を開く。レールのタブが 5 本。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 観測と通知の文の親は登録済みの記録（`confirmedRecords`）だけで、`goals-migration.js`・`core/goal-observations.js` は配合表・`core/ideal.js` を import しない（`test/import.test.js`）。互換 — 目標のキーの形を変えていない（`{ version, goals }` で包んでいない）。セキュリティ — 旧キーの中身は `parseWishes` と data-boundary を通し、名前は textContent（`test/static/security.test.js`）。性能 — 観測はサーバ時刻が新しくなったときだけ、目標のある種族だけ。

### TODO
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

### 実装の記録（2026-10-15、ブランチ `feature/goals-merge`）

実装のときに決めたこと・文書と違う形にしたこと（後の bell・settings と、フェーズ 3 の pal-detail・goals-detail はこちらを正とする）。

1. **種族だけの目標（手順 1）**: `core/ideal-goals.js` の **`speciesGoal(palId, { name, addedAt })`**（`passives: []`・`mode: 'include'`・`targets` 0・`cake: 'none'`・`worlds: {}`。id は呼び出し側）と **`isSpeciesGoal(goal)`**。
2. **観測（手順 2）**: `web/js/core/goal-observations.js` に **`cleanObservations`・`parseObservations`・`cleanEntry`・`cleanPair`・`firstObservation`・`observeSpecies`・`mergeObservation`・`mergeObservations`（保存の値どうし。名前の変更用）・`OBSERVATIONS_VERSION`**。形は文書のとおり（`{ version: 1, species, migration: { wishlist: { migrated, pending, doneAt } } }`）。種族の ID は形（英数字と `_`）だけで確かめる（core/ はマスターを読まない）。
3. **ideals ストア（手順 3）**: 観測のキー `<namespace>.goalsObs.<env>.<userIdKey>` の読み書き（`loadObs`・`saveObs`・`latestObs`。保存の失敗は `saveFailed` に含める）と `observeRecords()`（ログイン中・キャッシュでない・名前の変更中でない・サーバ時刻が読めるとき、目標のある種族ごとに、その種族の `observedAt` より新しいデータのときだけ進める。確定データ `confirmedRecords` から子ごとの親の組）。`add` は観測がなければ `firstObservation`（知らせない）。**`remove` はその種族の目標がほかになければ観測も消し、戻り値に `observation` を足した（`{ goal, index, observation }`）。`restore(goal, index, key, observation)` の 4 つ目でそれを戻す**（文書の「観測を作り直して判定し直す」だと、作れるようになった時刻が消えて通知が戻らないため）。公開: **`observation(palId)`・`observations()`・`migration()`・`legacyWishes()`**。`reload(key)` は観測のキー・旧ウィッシュリストのキー（今の ID のものなら移行をやり直す）にも反応する。
4. **移行（手順 4）**: `web/js/goals-migration.js` の **`migrateWishlist({ storage, namespace, env, userKey, now }) → { status, migrated, pending }`** と `cleanWish`・`parseWishes`・キーの関数。**書く順番は文書と少し変えた: ① 目標を書いて読み戻す（見つからなければ移行の記録を書かずに `failed`）→ ② 観測と移行の記録を書いて読み戻す → ③ 既読の写しは不要 → ④ すべて移せたら `doneAt` を書いて旧キーを消す**（テストで、目標の書き込みが消えた〔読み戻しの不一致〕のに観測に「移した」と記録すると、次の実行で目標を作り直さない不具合が見つかったため）。空・壊れた旧キーは片づけて `none`。ideals ストアがログインした環境・ID ごとに 1 回（`migratedScope`）と、旧キーの storage イベントで呼ぶ。名前の変更中は呼ばない。
5. **名前の変更（手順 5）**: user-rename.js の「オブジェクトの形のキー」の並びに `goalsObs`（併せ方は `mergeObservations`）を足した。`createRenamer` の引数から `wishlist` を外し、`localSaveFailed` は drafts・ideals・self だけ。`moveLocal` で旧ウィッシュリストと観測のキーの元と先を `ideals.reload` に渡す。旧ウィッシュリストのキー（配列）は移し終わるまで今どおり移す。
6. **通知（手順 6）**: ideals.js の **`goalObservationSource({ store, ideals })`** を app.js の通知の元にした（`wishlistNotificationSource` と入れ替え）。id は前と同じ形、title は「〈パル〉の配合が登録されました」「〈パル〉の配合が増えました」、body は「A＋B で作れます（ほか N 組）。」（観測で見た組の先頭）・「A＋B でも作れます。」、href は `#/search?c=`。知らせるのは種族だけの目標がある種族だけ。
7. **目標の一覧（手順 7）**: 行の名前の欄（`div.ideal-goal-name`）に名前・「パルだけ」（`statusChip('パルだけ', 'info', 'ideal-goal-tag')`）・下の行に「配合: 登録済み n 件 →」／「配合: 未登録」（`a.ideal-goal-records`。画面のデータの `findByChild`。押すとダイアログを閉じて配合を探す）と「所持 n 体（親になれる m）」（所持パルのデータごとに `ownedCounts` を 1 回）。**種族だけの目標の条件の要約は「条件なし（そのパルがいれば完成）」**、呼び出すは `#/ideal?to=<palId>`（g を付けない）。外すと「元に戻す」で観測も戻す。空の文は文書のとおり。移行が partial・failed なら表の上に 1 行と「旧ウィッシュリストを見る」（読み取り専用のダイアログ。パルのタイルと「配合あり／未登録」）。`#/ideal?goals=1` で開いたら（app.js が同じ画面で受けたときも）目標のダイアログを開いて `goals` を URL から外す。
8. **「☆ 目標に登録」（手順 8）**: `web/js/ui/goal-toggle.js` の **`goalToggle(context, palId, { className, label }) → { element, update, destroy }`**（`aria-pressed`。星は ui/icons.js の **`star`**〔前の `wishlist` を改名。登録済みは塗る〕、文は「目標に登録」／「目標に登録済み」。押すと add・外す〔トーストに「元に戻す」〕。`'full'`・`null` は理由のトースト）。置き場所: パル詳細のヒーローの操作、配合を探すで子だけを選んで 0 件の空の状態（primary「目標に登録（作れるようになったら知らせます）」と secondary「この子の配合を登録」。syncList が同じ文の空の表示を作り直さないので、描いた後に出ている方の押しボタンだけ購読を残す `keepEmptyGoal`）、理想個体の目標を ♂♀ で持っていないときの次の一手（前の「ウィッシュリストに追加」）。
9. **レールのバッジ（手順 9）**: 理想個体のタブに `span.nav-badge`「完成 n」（表示しているワールドで `worlds[worldId].complete` の目標の数。0 なら hidden）とタブの aria-label「理想個体（完成した目標 n 件）」。ideals と owned を購読して書き換える（画面は描き直さない）。
10. **片づけ（手順 10）**: router.js の `LEGACY` に `wishlist: { view: 'ideal', add: { goals: '1' } }`。TABS・views・app.js からウィッシュリストを外し（タブは 5 本）、`web/js/wishlist.js`・`web/js/views/wishlist.js`・`test/web/wishlist.test.js` とウィッシュリストの CSS を消した。レールの区切りは所持パルの前だけ（探す｜所持｜設定）。
11. **テスト**: 1,538 → 1,533 件（ウィッシュリストのテスト 22 件を消し、移行 7 件・観測 4 件・目標の観測 4 件ほかを足した。`npm test` exit 0）。goals-migration.test.js（3 件・2 回目で変わらない／同じ条件に併合／98 件で partial と続き／書き込みの失敗と読み戻しの不一致〔目標が消えたら記録しない〕／外した目標を作り直さない／前の版の目標の書き直しで残る／旧キーを信用しない）、goal-observations.test.js、ideals.test.js（足した時点は知らせず作れるようになったら同じ id で知らせる・増えた組・種族だけの目標だけ・外すと消えて元に戻すと戻る・キャッシュ・名前の変更中・古いデータ・別タブの観測のキー・移行と旧キーの書き戻し）、user-rename.test.js（goalsObs の移動と併せ方・名前の変更のテストを目標で）、app.test.js（パル詳細の「目標に登録」→ 仲間の登録 → ベル「配合が登録されました」→ `#/wishlist` で目標のダイアログ・「配合: 登録済み 1 件」、旧ウィッシュリストからの起動）、ideal-view.test.js（目標に登録の押しボタンと登録できないときの文・行の名前の欄・空の文）、views.test.js（タブ 5 本）。
12. **画面（モック・1100×900・所持パル 138 体）**: 旧ウィッシュリスト 3 件を入れて読み込み直すと、目標 `wish-SheepBall`・`wish-Anubis`・`wish-KingBahamut` ができ旧キーが消えた。`#/wishlist` → `#/ideal` で目標のダイアログ（3 行とも「パルだけ」・「配合: 未登録」・「所持 n 体（親になれる m）」・完成済み。`40-goals-dialog-1100-light.png`）。パル詳細で「☆ 目標に登録」→「目標に登録済み」（`41-pal-goal-toggle-1100-light.png`）。タブは 5 本で、理想個体に「完成 4」。
   - **確かめていないこと**: 目標を 98 件にした状態での「まだ目標に移せていません」の画面と、旧版のタブを同時に開いたままの移行は、ブラウザでは確かめていない（goals-migration.test.js で確かめた）。
13. **後のテーマへの申し送り**:
    - bell: 目標の観測の通知は id の頭 `wishlist:`（kind なし）、完成の通知は `ideal:`。種類のチップでは両方を「目標」に分類する。
    - settings: 端末のデータの書き出しで目標を扱うときは、観測のキー `goalsObs` も対象にするか決める（目標のキーの形は変わっていない）。
    - goals-detail（3）: 行の名前の欄（`.ideal-goal-name`）に集計を足す。観測は `ideals.observation(palId)`。
    - pal-detail（3）: ヒーローの「目標に登録」は `goalToggle(context, palId)`。

---

## route-cleanup: 継承ルートの整理

### 目的
継承ルートの「開始候補」を 2 重に出す作りと、所持パルの有無で形が組み変わる 2 形態をやめ、経路を上・所持個体を下に置いて、操作しても経路の先頭が動かないようにする。常時の説明文を減らし、「性別条件は未検証」の意味を分かる形にする。

### 経緯
- 統合プランの route-cleanup（本セッションの R-01・R-05・R-07・R-08・R-13・R-23・R-25・R-27・R-28・V-21、別プランの F030・F038）。
- Codex のプランレビュー 1 回目 16: **「性別条件は未検証」の警告は残す**。統合プランは「消さずに短く言い換え、『記録された親の性別』と『所持個体から組めるか』を分けて示す（経路は種族単位で探すため。`core/route.js:11`）」とした。案 R-25 の判断（警告を multiChild のときだけにする）と、R-24（2 つの文に分ける。却下）より、**統合プランの書き方が優先**。
- 別プランの F031（不足パッシブの一括渡し）は事実確認で却下（継承ルートの `p` は「選んだパッシブを全部持つ 1 個体」の条件）。F033（横の経路図）は「候補を最初から全部出す」（98b7962・`docs/OPERATIONS.md:99`）と衝突するので任意の後回し。
- 判断が分かれていた点（このテーマの既定）:
  - R-01 の「『すべて』のときに先頭の候補の経路を『おすすめ』で出す」は、判断で「『すべて』の意味が変わるのでユーザーに確認」とされた → **既定では入れない**（入れるならユーザーに確かめる）。
  - R-08 の「チップは先頭 8 件だけ・残りは『ほか N 種 ▸』」は、`docs/OPERATIONS.md:99` の「継承ルートの候補は、件数が多くても最初から全部出す」と衝突しうる → **既定では入れない**（チップは全部出す）。入れるならユーザーに確かめる。
  - 「相手親は所持しているパルだけ」のチェック（own=1）は戻さない（判断事項 2）。

### 依存
- popovers（パッシブの 1 行部品・パル選択）、owned-rows（フェーズ 1。`ownedRow` が `{ element, update, destroy }`）、owned-overlay（相手親の ♂♀ の数・所持順の並べ替え・見出しのバッジ）。
- cleanup-dead-code（フェーズ 1。`excludePartners`・`filterPartners`・`representative` を片づけ済み）、copy-dead-ends（`setupHint`）も入っている前提。

### このテーマでやらないこと
- 不足パッシブごとの「X を運ぶ: 最短 N 回」・段ごとの牧場とタマゴ・相手親の個体のドロワー・継承ルート⇄理想個体の相互リンク（フェーズ 3 の route-progress）。
- 理想個体の「性別条件は未検証」（`core/ideal.js:178-180`・`views/ideal.js:122`）の条件の変更（ideal 側の範囲。このテーマでは継承ルートだけ）。
- 「↓」を戻す・相手親を脇に置く配置（R-23 の事実確認で要ユーザー判断）。

### 現状（HEAD ad648b7 で確認。フェーズ 1 の部分更新・パッシブ部品で書き換わっている）
- `views/route.js:70-97` の `arrange`: 所持パルがあれば「目標＋運びたいパッシブ」と開始のチップの形、なければ「開始 ⇄ 目標」の 2 列（`:83-91` の入れ替えボタン `swap-button`）。所持パルは後から読み込まれるので、開いた直後に形が組み変わる（R-05）。
- 開始の候補を 2 回出す（R-01）: チップの行（`renderStartFilter` `:100-113`。画像＋「N回」、件数と持ち主は `title` だけ `:108`）と、その下の「パッシブを持つ所持パルから始める」の一覧（`renderOwned` の `:138-161`。「最短 N 回の配合」「N 体 · 持っている人」「この経路を見る」）。どちらも `from` を入れるだけ。5e9ff09 でチップを足したときに一覧を残した。
- 並びは「選択欄 → 開始のチップ → 説明 → 所持パルの欄 → 経路」（`:79`）。開始を選ぶと所持パルの欄が所持個体の一覧（`carrierList` `:20-31`。「Lv 55 · Bob · パルボックス 4 ページ・3 行 1 列」とパッシブだけで、性別・★・個体値がない）に置き換わり、高さが変わって経路が上下する（R-07・R-13）。
- 常時の説明「この経路はスキルを運ぶ個体の流れです。相手親は別途用意します」（`:57`。30 字）、パッシブ未選択のとき 41 字の案内（`:134`）、所持パルのデータがないとき 73 字の「設定タブの『セーブ連携』で…」（`:121`。リンクなし。R-28）。
- 警告 `ui/route-view.js:31-33`: `step.multiChild` か、段の配合の記録に親の性別があれば「性別条件は未検証」。自動登録は親の性別を必ず記録する（`core/auto-breeding.js` の `validPair`）ので、自動登録の配合を含む段にほぼ必ず付く。
- 段番号の丸は 22px で、段と段を結ぶ線はない。入れ替えボタンはホバーで半回転（`app.css:829-830`。V-21）。

### 実装の手順
1. **形を 1 つにする**（R-05）: `arrange` と 2 列の形（`pair-selection`・`swap-button` とその CSS `app.css:389`・`:829-830`）を消し、常に「[目標][運びたいパッシブ]」の行＋「開始: [すべて][候補のチップ…][開始の選択欄]」の行にする。候補（`starts`）が 1 件もないときは「すべて」のチップを出さず、開始の選択欄は通常の見た目（placeholder「パルを選択」・ラベル「開始」）。開始も目標もないときの空の文は「開始と目標のパルを選んでください。」。
2. **所持パルがないとき**（R-28）: 所持パルのデータ（`owned.state.owned`）が `null` のときだけ、パッシブの欄を出さず、選択欄の下に 1 行「所持パルを読み込むと、パッシブを持つ個体から探せます」＋「設定を開く」（copy-dead-ends の `setupHint`。行き先 `#/settings?open=auto`）。未連携でも共有があればパッシブの欄を出す（X-05 の条件）。
3. **開始候補をチップに一本化**（R-01・F030）: 一覧（`:138-161`）と「この経路を見る」を消す。チップを 2 段に: 1 段目「アイコン＋名前」、2 段目「最短 N 回 · n 体 · 持ち主」（`holderSummary` を流用。目標を所持しているときは「所持 · n 体」）。並びは今の `ownedRouteStarts` の順（手数 → パッシブの多い個体 → 個体数）の最後を `palId` の文字列ではなく図鑑順にする（F030）。所持パルの読み込み前は、チップの行を空で置いて高さを保つ。候補がないときの文（「該当する所持パルは N 体いますが、登録済みの配合では目標にたどり着けません。」など。今の `:140-145`）はチップの行の下に 1 行で残す。
4. **並びを変える**（R-07）: 「選択欄 → 開始のチップ → 経路（results）→ 開始の所持個体（ownedSection）」。開始を切り替えても経路の先頭の位置が変わらない。
5. **所持個体を `ownedRow` に**（R-13）: `carrierList` を消し、owned-rows の `ownedRow` を並べる（列幅は理想個体の組と同じセレクタを共有。compact 版は作らない）。見出し「開始の X でパッシブを持つ所持個体」の右に「所持パルで開く」（`buildHash('owned', { pal: from, p: passives.join(',') })`）。6 体以上なら上から 5 体と「ほか N 体」の details。行は `{ element, update, destroy }` を syncList で。
6. **説明文を減らす**（R-27・F038）: 常時の説明（`:57`）をやめ、**最初の経路のカードの見出しに small で 1 回だけ**「左のパルがパッシブを運びます。相手親は別に用意してください。」。41 字の案内はパッシブの欄の placeholder「運びたいパッシブを選ぶ」に吸収して消す。
7. **段の線と運ぶパッシブ**（R-23 の判断）: CSS だけで、`.route-chain` の段番号の丸どうしを 2px の縦線（outline-variant）でつなぐ。運ぶパッシブは、経路のカードの見出しの横に compact の `passiveChip` で 1 回だけ（`routeView` に `passives` を渡す）。「↓」・出てくる動き・旗の SVG は入れない。
8. **警告を言い換える**（R-25・統合プラン）: `ui/route-view.js:31-33` を 2 つに分ける。
   - `step.multiChild` のとき: 警告のチップ「同じ組で別の子も登録あり」。押すとその組の配合を探す（`buildHash('search', { p1: step.from, p2: option.partner })`。複数の配合があるときは最初の組）。
   - 段の配合の記録に親の性別があるとき（ほぼ自動登録）: 短い注記のチップ「性別の向きは未確認」。`title`（または G-56 の「?」の説明部品）に「経路は種族だけで探しています。記録の ♂♀ の向きと、手持ちの個体の性別が合うかは確かめていません。」。
   - 「所持個体から組めるか」は、owned-overlay の相手親の注記（「♂2 ♀1」）で別に示す。記録に相手親の性別が入っていれば、注記の末尾に「（記録では ♀）」のように添える。
   - 文言は `.route-warning`（警告の色）と `.route-note`（注記の色）で分け、どちらも段に 1 回だけ。
9. **入れ替えのホバー**（V-21）: 入れ替えボタンごと消えるので、`app.css:829-830` の指定も消す。

### 触るファイル
- 変更: `web/js/views/route.js`、`web/js/ui/route-view.js`、`web/js/core/owned.js`（`ownedRouteStarts` の最後の比較を図鑑順に）、`web/css/app.css`、`web/js/release-notes.js`、`docs/OPERATIONS.md`（継承ルートの記述）

### テスト
- `test/web/owned-view.test.js:247-273`: 候補の一覧（`.route-start`）がなくなり、チップの 2 段目に「最短 1 回 · 1 体 · Alice・パルボックス」が出ること、`route-owned-box` の中が `ownedRow` になり「所持パルで開く」があること。`:275-303`: 並び（`selection-panel route-query` → `start-filter` → 経路 → 所持個体）、チップの文字（今は `'No.1モコロン1回'` → 2 段の文字）。`:305-313`（所持パルがないときの 2 列の形）は、パッシブの欄が出ず「所持パルを読み込むと…」と「設定を開く」が出ることに書き換え（`:308-309` の `pair-selection`・`swap-button` はなくなる）。
- `test/web/views.test.js:54-67`: `exclude=` を無視して経路を出す確認は回帰テストとして残し、`:61-66` の説明文・入れ替えボタンの確認だけ消す（説明は最初の経路の見出しに移った、を確かめる）。
- `test/web/route-view.test.js:30,61,75`: 「性別条件は未検証」→ 性別つきの段は「性別の向きは未確認」、multiChild の段は「同じ組で別の子も登録あり」（`:69-77` のケース）。`:41` の「↓ がない」は残す。
- 所持個体が 6 体以上のときの「ほか N 体」、候補が 0 件のときの文。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 経路は登録済みの記録のグラフ（`buildCarrierGraph`）だけ。性別の向きを配合表で確かめることはしない（だから「未確認」と書く）。
- 互換: `#/route?…&exclude=` の旧 URL は今どおり無視して経路を出す（回帰テスト）。
- 性能: チップを全部出す方針なので、持っている種類の多いパッシブでチップが何行にもなる。チップの行は折り返してよいが、経路は下に移した（R-07）ので、チップの増減で経路の先頭が動くのは「チップの行の高さが変わったとき」だけ。気になれば R-08 の上限をユーザーに相談する。

### release-notes の案
- id: `<実装日>-route-cleanup`／title: 「継承ルートを整理」（8 字）／body: 「開始の候補はチップにまとめ、経路を上に出します。所持個体は所持パルと同じ行で見られます。」（44 字）

### 完了の条件
- [x] `npm test` が通る。
- [x] モックで: 所持パルの読み込み前後で形が組み変わらない。開始のチップを押しても経路の先頭の位置が変わらない。入れ替えボタンがない。
- [x] 所持パルがないとき、パッシブの欄が出ず「設定を開く」で設定の該当の欄が開く。
- [x] 自動登録の配合を含む段に「性別の向きは未確認」、同じ組で別の子がある段に「同じ組で別の子も登録あり」（押すと配合を探す）。
- [x] 実測: 継承ルートでパッシブを足しても、その下が 44px 下がらない（パッシブの 1 行部品と合わせて）。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 経路は登録済みの記録のグラフだけで、性別の向きを配合表で確かめない。互換 — `exclude=` の旧 URL でも経路が出る（`views.test.js:54-67` の回帰テスト）。確認回数と相手親の除外は戻していない（判断事項 2）。継承ルートの候補は最初から全部出す（`docs/OPERATIONS.md:99`）。セキュリティ — `test/static/security.test.js` が通る。性能 — 上の 44px の確認。

### TODO
- [x] `arrange`・2 列の形・入れ替えボタンと CSS を消し、形を 1 つに（テストを先に）
- [x] 所持パルがないときの 1 行と「設定を開く」
- [x] 候補の一覧を消し、チップを 2 段に（並びの最後を図鑑順に）
- [x] 並びを「選択欄 → チップ → 経路 → 所持個体」に
- [x] `carrierList` を `ownedRow` に、「所持パルで開く」と「ほか N 体」
- [x] 常時の説明を最初の経路の見出しへ、41 字の案内を placeholder へ
- [x] 段の縦線と運ぶパッシブのチップ
- [x] 警告を「同じ組で別の子も登録あり」と「性別の向きは未確認」に分ける
- [x] 既存テストの書き換え（owned-view・views・route-view）と release-notes・OPERATIONS.md

### 実装の記録（2026-10-15、ブランチ `feature/route-cleanup`）

実装のときに決めたこと・文書と違う形にしたこと（フェーズ 3 の route-progress はこちらを正とする）。

1. **形を 1 つに（手順 1・9）**: `arrange`・`layout`・2 列の形（`pair-selection`）・入れ替えのボタン（`swap-button`。ripple.js の対象・CSS のホバーの半回転も）を消した。画面の子は作るときに 1 回だけ並べる: 見出し → `div.selection-panel.route-query`（目標・`div.route-passives`）→ `div.route-hint`（所持パルがないときの 1 行）→ `div.start-filter`（「開始」・`div.start-chips`・候補がないときの `p.start-note`）→ `div.route-result-slot`（経路）→ `section.route-owned`（開始の所持個体）。画面の section に `route-view` のクラス（所持パルの行の列の間を `.owned-view`・`.ideal-view` と同じに詰めるため）。開始の選択欄は 1 回だけ作り（`popupHost: document.body`）、候補のチップがあるときは placeholder「他のパル…」と点線（`.start-chips.has-starts`）、ないときは「パルを選択」とふつうの見た目。placeholder の切り替えのために **`palPicker(...).update({ placeholder })`** を足した。開始の行は `min-height: 46px`（チップの 2 段の高さ）で、所持パルの読み込みの前後と候補の有無で高さが変わらない。
2. **所持パルがないとき（手順 2）**: 読み込みを終えて（`owned.state.ready`）データがない（`owned.state.owned` が null）ときだけ、パッシブの欄を隠して `setupHint`「所持パルを読み込むと、パッシブを持つ個体から探せます。」＋「設定を開く」。**行き先は文書の `open=auto` ではなく `settingsHash(linkedWorldId, 'status')`**（ほかの「所持パルのデータがない」の行き先〔ヘッダーのセーブ連携・理想個体・所持パル〕と同じ。設定のセーブ連携の状態の見出しへフォーカスする）。読み込みの前は「ある」とみなして形を変えない。所持パルのストアの購読は `data` に加えて `ready` の変化でも描き直す。`context.owned` がない（テストの views.test.js）ときはパッシブの欄を隠し、1 行も出さない。
3. **開始の候補をチップに一本化（手順 3）**: 一覧（`.route-start`）と「この経路を見る」を消した。チップは `palTile`（1 段目。CSS で `display: contents` にして絵を 2 段の左に置く）と `small.start-chip-count`（2 段目「最短 N 回 · n 体 · 持ち主」。目標そのものを持っていれば「所持 · n 体 · 持ち主」。**文書の「所持 · n 体」に持ち主も付けた**〔ほかの候補と同じ形で、だれが持っているか分かるように〕）。**2 段目は 15em で省略し、全文はチップの title（「モコロン · 最短 1 回 · …」）**（持ち主が 2 人以上だと 1 枚が 400px 近くになり、開始の選択欄が次の行に落ちたため）。並びは **`ownedRouteStarts({ palOrder })`** の最後の比較を図鑑順に（`state.index.palOrder`。渡さなければ前の ID の順）。候補がないときの文（「該当する所持パルは N 体いますが、…」「選んだパッシブをすべて持つ所持パルはいません。」と、外した個体があれば「タマゴ・グローバルパルボックスの個体は含めていません。」）はチップの行の下に 1 行。
4. **並び（手順 4）**: 選択欄 → チップ → 経路 → 所持個体。モックで開始のチップを 1 つ目 → 2 つ目と押しても、最初の経路のカードの上端は同じ（348px）。
5. **所持個体を所持パルの行に（手順 5）**: `carrierList` を消し、views/owned.js の **`ownedRowItem`** を `syncList` で並べる（`{ highlight: { wanted: passives } }` で運ぶパッシブに印。行の key は個体の id）。上の 5 体は `div.route-owned-rows`、6 体以上の残りは `details.route-owned-more`（summary「ほか N 体」）の中の 2 つ目の `div.route-owned-rows`。列と見た目は理想個体の組の行と同じセレクタ（`:is(.ideal-pair, .route-owned-rows) .owned-row` と個体値の小さな見出し）。見出し「開始の X でパッシブを持つ所持個体」の右に「所持パルで開く」（`buildHash('owned', { pal: from, p })`。所持者を付けないので所持パルは「すべて」で開く）。行は画面を閉じる・欄を隠すときに `clearList` で片づける。
6. **数え方をそろえた（owned-overlay の申し送り）**: 運びたいパッシブの選択欄の所持数（`passiveCounts`）と開始の所持個体を、開始の候補と同じく親にできる個体（`canBeParent`）だけにした。選択欄の見出しは「所持パルが持っているもの（タマゴ・グローバルパルボックスを除く）」。開始の所持個体が親にできない個体だけなら「親にできる個体を所持していません（タマゴ・グローバルパルボックスの個体は含めていません）。」。
7. **説明を減らす（手順 6）**: 常時の説明（`.route-explanation`）と 41 字の案内を消した。説明は **`routeView(routes, { note })`** で最初のカードの見出しの下に `small.route-card-note`（文は ui/route-view.js の **`ROUTE_NOTE`**）。パッシブの選択欄に **`passiveSelector({ placeholder })`** を足し、1 個も選んでいないときの追加のボタンを「運びたいパッシブを選ぶ」にした（選んだ後は「パッシブを追加…」）。経路を出せないときの空の文は「開始と目標のパルを選んでください。」（どちらもない）・「目標のパルを選んでください。」・「開始のパルを選んでください。」。開始の候補のチップがあって「すべて」のときは、チップが次の手順なので経路の欄は空。
8. **段の線と運ぶパッシブ（手順 7）**: 段番号の丸は式の 1 行目にそろえて上から置き（`--step-top: 13px`。「N 通り」の枠の段は 10px）、`.route-breeding-card:not(:last-child)::before` の 2px の線（outline-variant）を丸の中心から次の段の丸の中心まで引く（モックで丸の中心と線の上端・左右の位置が合うことを測った）。運ぶパッシブは **`routeView(routes, { passives })`** で、**最初のカードの見出しの横だけ**に compact の `passiveChip`（`span.route-card-passives`、role=group・aria-label「運ぶパッシブ」）。文書の「経路のカードの見出しの横に 1 回だけ」を、説明と同じく最初のカードだけと読んだ（カードごとに同じチップが並ぶとうるさいため。選んだパッシブは上の選択欄にも出ている）。所持パルがないとき（パッシブの欄を隠したとき）は出さない。
9. **段の注意を分けた（手順 8）**: ui/route-view.js の `stepNotes`。`step.multiChild` は警告のリンク「同じ組で別の子も登録あり」（`a.status-chip.is-warning.route-warning`。行き先は `#/search?p1=<開始>&p2=<相手>`）。**相手は core/route.js に足した `step.multiPartner`（別の子もある最初の相手）**（文書の「最初の組」だと、別の子のない組の配合を開くことがあるため）。記録に親の性別がある段は注記「性別の向きは未確認」（`span.status-chip.is-neutral.route-note`、title「経路は種族だけで探しています。記録の ♂♀ の向きと、手持ちの個体の性別が合うかは確かめていません。」）。どちらも段に 1 回だけ、`div.route-step-notes` に入れる。相手親の注記は、記録に相手親の性別があれば末尾に「（記録では ♀）」（相手親と開始が同じ種族の記録は、どちらの性別か分からないので付けない）。
10. **テスト**: 1,533 → 1,539 件（`npm test` exit 0）。owned-view.test.js（チップの 2 段目と title・一覧がない・所持個体の行と「所持パルで開く」／並びと「すべて」のときの空の経路／所持パルがないときの 1 行と「設定を開く」／読み込みの前後で形を変えない／placeholder と候補がないときの文／6 体以上の「ほか N 体」・タマゴとグローバルを出さない／「（記録では ♀）」と「性別の向きは未確認」／パッシブの所持数を親にできる個体で）、route-view.test.js（「性別の向きは未確認」と title・段に 1 回／「同じ組で別の子も登録あり」のリンク／passives と note は最初のカードだけ）、views.test.js（`exclude=` の回帰は残し、説明が最初の経路の見出しの下に 1 回・入れ替えのボタンがない／applyRoute で選択欄を作り直さない／開始の選択欄は 2 つ目。候補を本文の外に出すので、テストの `pickerRows` は document.body からも読む）、core（`multiPartner`・`ownedRouteStarts` の図鑑順）。
11. **画面（モック・1100×900・所持パル 138 体）**: ニャルル・サディストで、開始のチップ 2 枚（2 段目を省略して 1 行に収まる）・最初のカードの見出し「最短 2 回の配合 [サディスト] 相手親 1/2 段で所持」と説明・段の縦線・開始のベイントールの所持個体 5 行と「所持パルで開く」（`43`〜`45`・`47`）。段の注意 2 種類は、モックの記録に親の性別がないので架空の記録で部品を描いて確かめた（`48`・`49`）。127.0.0.1（注入した所持パルがないオリジン）で、パッシブの欄がなく 1 行と「設定を開く」→ 設定のセーブ連携の見出しへ（`50`）。パッシブを足しても選択欄の行の高さは変わらない（80.59px のまま）。候補のチップが出る・候補がないときの文が出るときは開始の行の高さが変わる（文書の「性能」の注意どおり。候補がないときの文で 28px）。
    - **確かめていないこと**: 本番の自動登録の配合（親の性別つき）での段の注意の見え方と、パッシブの種類の多い所持パルでチップが何行にもなるときの見え方（R-08 の上限は入れていない）。画面は最小幅 920px なので、幅 390px の確認はしていない。
12. **後のテーマへの申し送り**:
    - route-progress（3）: 経路のカードの部品は `routeView(routes, { annotate, badge, passives, note })`、段の情報は `step.multiChild`・`step.multiPartner`、開始の所持個体は `section.route-owned`（views/route.js の `renderOwned`）。

---

## bell: ベルと通知の整理

### 目的
ベルを「既読も含めた履歴の唯一の入口」にし、設定の「通知」カードを消す。種類と未読で絞れ、1 件ずつ既読にでき、赤い数字は自分宛ての未読だけを数える。行き先・パルの画像で、押したら該当の箇所に着くようにする。

### 経緯
- 統合プランの bell（本セッションの G-20・G-22・G-24・G-25・G-26・G-28、別プランの F022・F024・F025・F026・F028）。
- **順番の決まり**（別プランの F025 と統合プランの「別プランから取り入れたもの」）: 先にベルの下端に「すべての通知を見る →」を作り、**既読を含む履歴の入口ができてから**設定の「通知」カードを消す。プロジェクトの CLAUDE.md:16（「右上のベルの通知欄と、設定タブの「通知一覧」に出る」）と `ui/notifications.js:54`（コメント）・`:89`（空の文）を直し、**規約ファイルの変更記録を残す**。
- Codex のプランレビュー 1 回目 14: 通知の正規化（`notifications.js:24-32` の `cleanNotification`）に**許可した種類・パル ID・worldId・batchId を通す**（今は id・date・title・body・href 以外を捨てる）。
- 案の判断との違い: G-20・G-26 の判断は「未読｜すべての切り替え・すべて既読・種類で畳む操作は入れない」、G-21（開いただけで既読にしない）は却下だったが、**統合プランの要点（F024: 種類のチップと未読だけ・個別の既読と「すべて既読」）が優先**（rejected.md の G-21「覆った」）。開いただけで全部を既読にするのをやめる代わりに、G-22（既読記録のない端末はお知らせを既読から開始）を必ず入れる（そうしないと新しい人に 37 件の未読が残り続ける）。
- G-24 の判断: 取り消した機能のお知らせ `ideal-alpha` は配列から消し（同じ id は二度と使わない）、`ideal-generations` は id を変えずに本文を今の仕様に直す。`retired` の印は作らない。

### 依存
- autoreg-success（フェーズ 1。自動登録の成功の通知・同じ読み込みの分を 1 行にまとめる表示・`cleanNotification` に kind・worldId・batchId を通す部分。入っていれば、このテーマは palId と種類のチップを足す）。
- goals-merge（目標の通知が `wishlist:`・`ideal:` の id で出ている）。

### このテーマでやらないこと
- 通知一覧の検索と日付（G-27。後回し）。
- 裏のタブの題名・ファビコン（autoreg-visibility）。
- 通知の元に「仲間の新しい配合」を足すこと（G-29 の判断で見送り。配合を探すの NEW で代わり）。

### 現状（HEAD ad648b7 で確認）
- `ui/notifications.js`: ベルは開いた時点の未読だけを出し（`:78`・`:84-90`）、**開いた瞬間に全部を既読にする**（`:108`）。空のときは「新しい通知はありません。これまでの通知は設定タブの「通知一覧」で見られます。」（`:89`）。数字は全部の未読の合計（`:69-75`）。行は日付・未読チップ・タイトル・本文の文字だけ（`notificationList` `:10-29`）。既読も含めた一覧 `openNotificationList`（`:35-52`）は開いたときに未読を既読にする。
- 既読も含めた一覧を開けるのは設定の「通知」カードだけ（`views/settings.js:103-105`、並べるのは `:108`）。
- `web/js/notifications.js`: `cleanNotification`（`:24-32`）、`releaseNoteSource`（`:34`。id に `release:` を付ける）、既読は `${namespace}.notifications.read.${userIdKey}`（`:43-46`。環境を含まない）、`readIds`（`:54-57`）は保存がなければ空から始める（新しい人・新しい端末では 37 件すべてが未読。G-22）、`markRead`（`:82-92`）。
- お知らせ `web/js/release-notes.js`: `2026-10-08-ideal-alpha`（`:28-31`）は同じ日の `2026-10-08-ideal-groups`（`:17-19`）で「アルファの条件はなくしました」と取り消されている。`2026-10-08-ideal-generations`（`:36-39`）の「並べ方の選択・タマゴも候補」は今の仕様と違う。`2026-10-04-notifications`（`:136-139`）の本文は「読んだ通知は設定タブの「通知一覧」で見られます」。href を書いた項目はない（仕組みはある。G-25）。
- 通知の id の頭: `release:`・`wishlist:`（goals-merge の後も同じ形）・`ideal:`・`auto-breed:`。

### 実装の手順
1. **正規化を広げる**（`web/js/notifications.js` の `cleanNotification`）: autoreg-success（1d）で入れた `kind`（`NOTIFICATION_KINDS` ＝ `'auto-registered'`。まとめ表示の `groupNotifications` が使う）・`worldId`・`batchId` は**そのまま**にして、次を足す（2026-10-12 の最終確認で、1d の kind と食い違わない形に直した）。
   - **種類のチップの分類は保存しない**: `export function notificationCategory(item)` → `'release' | 'goal' | 'auto' | 'other'` を足し、表示のときに決める（`kind === 'auto-registered'` か id の頭が `auto-breed:` → auto、`release:` → release、`wishlist:`・`ideal:` → goal、それ以外 → other）。`kind` に分類の値を入れない（入れると 1d のまとめ表示の判定が壊れる。`cleanNotification` は kind を既定で付けないので `test/web/notifications.test.js:41` もそのまま通る）。
   - `palId`: マスターにあるパル ID だけ（1 体）。（`worldId` は `ownedWorldId` で整う値だけ、`batchId` は 64 字以内、は autoreg-success で入っている。）
   - 通知の元で palId を入れる: 目標の観測＝その種族、理想個体の完成＝目標の種族、自動登録の成功＝登録した記録の子（登録済みなので出してよい）、異常（表と違う）＝新しいタマゴの種族（セーブで見たもの）、**食い違い＝親1**（候補の子は配合表で決めた値なので使わない。INV-2）、未設定のプレイヤー＝なし。
2. **既読の始め方**（G-22。`createNotificationStore` の `readIds`）: その ID の既読の保存先が**まだない**（`storage.getItem(key) === null`）ときだけ、その時点のお知らせ（`release:` の id）を全部既読として保存してから始める。storage が使えない端末（読み出しが例外）は今どおり空から（毎回入れ直さない）。目標・自動登録の通知は未読のまま。
3. **ベルのパネル**（`ui/notifications.js` の `notificationMenu`）
   - 追記（2026-10-13、フェーズ 1a のレビューの直し `fix/phase-1a-review-render`）: `notificationMenu(notifications, { onOpen })` の onOpen で、app.js がヘッダーのほかのパネル（セーブ連携・ID）を閉じる（1 つだけ開く）。トリガーの `aria-controls` は開いている間だけ付ける。作り直すときもこの 2 つを引き継ぐ。
   - 頭: 「通知」と「すべて既読」（いま表示している通知を既読に）。
   - チップの行: 「すべて／更新内容／目標／自動登録」（`aria-pressed`。1 つだけ選ぶ）と「未読だけ」（押しボタン）。選んだ状態はベルの中に覚える（開き直しても残る。ページを読み込み直すと既定の「すべて」）。
   - 一覧: `notifications.list()` を種類・未読で絞って新しい順。行は詰めて（日付は右端・本文は 1 行で省略）、左に 32px のアイコン（palId があれば `palIcon`、なければ種類の小さな SVG。お知らせ＝1 種類の記号）。未読の行に「未読」のチップと「既読にする」の小さなボタン（`aria-label`）。行き先のある行を押したら、その id だけ既読にしてパネルを閉じる（画面の移動はリンクに任せる＝今の `:22-25` と同じ）。autoreg-success の「同じ読み込みの分を 1 行」の行は、まとめた id を全部既読にする。
   - **開いただけでは既読にしない**（`:108` の `markRead` をやめる）。
   - 下端に「すべての通知を見る →」: パネルを閉じて `openNotificationList(notifications)`。一覧のダイアログも同じ行の部品・同じチップを使い、開いただけでは既読にしない（「すべて既読」で既読に）。
   - 空の文は「新しい通知はありません。」だけ（`:89`。「未読だけ」で 0 件なら「未読の通知はありません。」）。`:54` のコメントも直す。
4. **数字**（G-26 の判断）: 赤い数字は `notificationCategory(item) !== 'release'` の未読の数（まとめた行は 1 つと数える。autoreg-success の `groupNotifications` の後で数える）。お知らせだけが未読なら数字のない小さな点。aria-label は「通知（要確認 2 件・お知らせ 3 件）」のように両方を書く（0 の方は省く）。ベルの揺れ（`app.css` の `.notification-badge::after` 付近）は、要確認の未読が**増えたとき**に 1 回だけ。`prefers-reduced-motion` では揺らさない。数え方は `export function unreadCounts(notifications)` → `{ actionable, release }` として外にも出す（autoreg-visibility の題名で使う）。
5. **設定の「通知」カードを消す**（`views/settings.js:103-105`・`:108`）。手順 3 の入口ができてから消す。
6. **文言と規約を直す**
   - `release-notes.js:136-139`（`2026-10-04-notifications`）の body を「右上のベルで更新内容などを知らせます。読んだ通知はベルの「すべての通知を見る」で見られます。」（46 字）に。id は変えない。
   - `2026-10-08-ideal-alpha`（`:28-31`）を配列から消す。`2026-10-08-ideal-generations`（`:36-39`）の body を「完全体作成組では、子を親と入れ替えながら作る手順も数えます。20 秒ごとに更新します。」（43 字）に。先頭のコメント（`:1-2`）に「機能をなくしたら元の告知を消すか書き直す。id は再利用しない」「開く先があれば href（#/… だけ）を書く」を足す。
   - 開く先のあるお知らせに `href` を足す（G-25。例: `2026-10-10-owned-keyword` → `#/owned`、`2026-10-08-ideal-groups` → `#/ideal`、このフェーズの各テーマのお知らせ → その画面）。
   - **プロジェクトの `CLAUDE.md:16`**: 「（右上のベルの通知欄と、設定タブの「通知一覧」に出る）」→「（右上のベルの通知欄と、ベルの「すべての通知を見る」に出る）」。同じ節の末尾に変更記録を 1 行（例「> 変更記録（<日付>）: 設定の「通知」カードを廃止し、履歴はベルの「すべての通知を見る」から開く形にしたため、通知の出る場所の記述を直した。影響: 規約の意味は変わらない」）。**CLAUDE.md は設定で Edit が拒否されている可能性がある**（グローバルの規約「評価基準の保護」）。拒否されたら、文案をユーザーに示して手で直してもらう。
7. **行き先を該当の箇所まで**（F026）: 自動登録の「プレイヤーの対応が未設定です」の href を `#/settings?world=<worldId>&open=auto`（participant-self・copy-dead-ends で作った行き先。まだなら直す。今は `'#/settings'` `auto-register.js:228`）。（追記 2026-10-15: フェーズ 1d の participant-self と、フェーズ 1d の終わりのレビューの直しで済んだ。行き先は意図つきの `settingsHash(worldId, 'registrant')`〔`#/settings?world=<worldId>&open=registrant`〕で、前の版の通知も読み出すときに読み替える。phase-1d の「フェーズ 1d の終わりのレビューの直し」の 6）食い違い・異常の href は find-merge・autoreg-visibility で `#/search?p1=&p2=`。

### 触るファイル
- 変更: `web/js/notifications.js`、`web/js/ui/notifications.js`、`web/js/ideals.js`（通知に palId）、`web/js/auto-register.js`（palId・href）、`web/js/views/settings.js`、`web/js/release-notes.js`、`web/css/app.css`、`CLAUDE.md`（プロジェクト。変更記録つき）

### テスト
- `test/web/notifications.test.js:30-42`（お知らせの形）: `cleanNotification` は kind を既定で付けない（href を足したお知らせは期待値に href が入る）。`notificationCategory`（id の頭と `auto-registered`）・palId を通す／不正な値を捨てるテスト、`unreadCounts`、既読の保存先がない端末ではお知らせを既読から始める（保存先が使えない端末では始めない）テストを足す。`:179-` の通知一覧のテストは「開いただけでは既読にしない」に。
- `test/web/app.test.js:420-455`（ベル）: 初めての端末ではお知らせが既読から始まり数字が出ない → 目標か自動登録の通知を 1 件起こすと赤い数字 1 → 開いても既読にならない → 行を押すとその 1 件だけ既読 → 「すべての通知を見る →」で一覧が開く、に書き換える（`:447` の設定の「通知一覧」ボタンはなくなる）。
- `test/web/views.test.js:139-144`（設定のカードの順）から「通知」を外す（settings でさらに変わる）。
- `test/web/auto-register.test.js`: 未設定の通知の href・palId（別プラン §9 の C の `:235,241` 付近）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 通知に出すパルの画像は、登録済みの記録・セーブで見たもの・目標の種族だけ。自動登録の候補の子（配合表の答え）は出さない。
- 互換: 既読の保存の形は変えない（id の配列）。古い通知（保存済みの自動登録の通知）に kind・palId がなくても、id の頭から種類が決まり、画像は種類の記号になる。
- 互換: 「開いたら全部既読」をやめるので、今まで既読だったものはそのまま既読、新しく来たものは押すか「すべて既読」まで未読。release-notes で知らせる。
- セキュリティ: href は今どおり `#/` で始まるものだけ（`notifications.js:30`）。本文・タイトルは `textContent`。

### release-notes の案
- id: `<実装日>-bell`／title: 「通知を種類で絞れます」（10 字）／body: 「ベルで種類と未読で絞り、1 件ずつ既読にできます。これまでの通知は「すべての通知を見る」から。」（47 字）

### 完了の条件
- [x] `npm test` が通る（お知らせの title・body の長さを含む）。
- [x] モックで: 新しい ID でログインしても数字が 37 にならない。種類のチップと「未読だけ」で絞れる。開いても既読にならず、行を押すとその 1 件だけ既読。「すべての通知を見る →」で履歴が開く。
- [ ] 設定に「通知」カードがない（済）。プロジェクトの CLAUDE.md:16 が直っていて変更記録がある（または、ユーザーに文案を渡した）（**未。フェーズ 2 の報告で文案を示して確認を取る**）。
- [x] 取り消した機能のお知らせ（アルファの条件）が出ない。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 通知の画像と文に、自動登録の候補の子（配合表の答え）を出さない。互換 — 既読の保存の形（id の配列）を変えていない。kind・palId のない古い通知も id の頭で種類が決まる。セキュリティ — href は `#/` で始まるものだけ、本文は textContent（`test/static/security.test.js`）。性能 — 対象外。

### TODO
- [x] `cleanNotification` に palId、`notificationCategory`（kind・worldId・batchId は autoreg-success のまま。テストを先に）
- [x] 各通知の元で palId を入れる（食い違いは親1）
- [x] 既読の保存先がない端末はお知らせを既読から始める
- [x] パネルの頭・チップ・「未読だけ」・行の部品・個別の既読・すべて既読
- [x] 「開いたら全部既読」をやめ、「すべての通知を見る →」と一覧のダイアログを同じ部品に
- [x] 赤い数字と点・aria-label・揺れ・`unreadCounts`
- [x] 設定の「通知」カードを消す
- [x] release-notes の本文の直し・ideal-alpha の削除・先頭のコメント・href
- [ ] プロジェクトの CLAUDE.md:16 と変更記録（拒否されたらユーザーへ）（**未。フェーズ 2 の報告で確認を取る**）
- [x] 未設定の通知の行き先
- [x] テストの書き換え（notifications・app・views・auto-register）と release-notes

### 実装の記録（2026-10-15、ブランチ `feature/bell`）

実装のときに決めたこと・文書と違う形にしたこと（後の autoreg-visibility・settings はこちらを正とする）。

1. **正規化（手順 1）**: `notificationTags` に **`palId`**（web/data/pals.js にあるパル ID だけ）を足した（`cleanNotification` と自動登録の保存した通知の読み戻し `cleanSavedNotice` の両方に効く）。`kind`・`worldId`・`batchId` は 1d のまま。**`notificationCategory(item)`**（`'auto'`〔kind `auto-registered` か id の頭 `auto-breed:`〕・`'release'`・`'goal'`〔`wishlist:`・`ideal:`〕・`'other'`）は保存せず表示のときに決める。
2. **通知の元の palId**: 目標の観測（`goalObservationSource`）＝その種族、理想個体の完成（`idealNotificationSource`）＝目標の種族、自動登録の成功（`registeredNotice`）＝登録した記録の子、見送り（`anomalyNotice`）＝セーブで見たタマゴの中身（`m.actual`）、保留（`conflictNotice`）＝親1、未設定のプレイヤー＝なし。
3. **既読の始め方（手順 2。G-22）**: `createNotificationStore` の `readIds` が、保存先の `getItem(key) === null` のときだけ、その時点の `release:` の通知を全部既読として保存してから始める（`initialIds`）。`getItem` が例外の端末・storage のない端末は今までどおり空から。保存に失敗しても、開いている間は既読として扱う。
4. **ベルのパネル（手順 3）**: ui/notifications.js を作り直した。共通の中身 `notificationBrowser(notifications, filter, { heading, limit, onNavigate })`（頭・チップ・行。ベルのパネルと通知一覧で同じ）と行の部品 `notificationRow`。絞り込みの状態は **`notificationFilter()`**（`{ category, unreadOnly }`）をベルの中に 1 つ持ち、パネルを開き直しても残り、「すべての通知を見る →」で開く通知一覧にも同じものを渡す（一覧で変えた種類もベルに残る）。
   - **パネルは既読も含めて新しい順に 30 行まで**（`PANEL_ROWS`。文書は行数を決めていなかった。お知らせだけで 40 件を超え、自動登録は 200 件まで残るため）。それより前は通知一覧で。
   - 「すべて既読」は**いま絞っている通知の全部**（パネルに出ていない 31 行目以降も含む）を既読に。未読がなければ押せない。パネルでは見出し「通知」の行の右、通知一覧ではチップの行の右端（ダイアログに題名があるため）。
   - 行: 左に 32px の絵（palId があれば `palIcon`、なければ種類の記号。更新内容＝新しく足したアイコン **`info`**、目標＝`star`、自動登録＝`owned`、その他＝`bell`）、題名と日付（右）の 1 行、本文 1 行（省略。全文は行の title。まとめた行の「ほか N 件」は省略しても残る塊）。右の列（64px。既読の行も幅を取って日付をそろえる）に、未読なら「未読」のチップと「既読にする」（✓ のアイコン、aria-label「「〈題名〉」を既読にする」）。未読の行は地の色を薄く付けた。行き先のある行を押すとその行の id（まとめた行は全部）を既読にして閉じる。
   - 「既読にする」を押した後のフォーカスは、同じ行の本体（開く先のない行も tabindex=-1 で受ける）→「未読だけ」で行ごと消えたら同じ位置の次の行 →「すべて既読」の順。
   - 空の文は「新しい通知はありません。」（「未読だけ」なら「未読の通知はありません。」）。前の「これまでの通知」のボタンは「すべての通知を見る →」に替えた。
   - 開いただけでは既読にしない（パネル・通知一覧とも）。
5. **数字（手順 4）**: **`unreadCounts(notifications)` → `{ actionable, release }`**（notifications.js。`groupNotifications(unread())` の行で数える）。赤い数字は actionable、release だけなら `.notification-badge.is-dot`（数字のない点）。aria-label「通知（要確認 2 件・お知らせ 3 件）」（0 の方は省く）。要確認の未読が増えたときにボタンへ `is-ringing` を付けて 1 回揺らす（`animationend` で外す。CSS は最初の `prefers-reduced-motion: no-preference` の中）。
6. **設定の「通知」カード（手順 5）**: 消した（views/settings.js。カードは「データの状態・記録を書き出す・整合性の警告・アカウント」）。
7. **文言（手順 6）**: release-notes.js の先頭のコメントに「機能をなくしたら元の告知を消すか書き直す（id は再利用しない）。開く先があれば href（#/… だけ）を書く」。`2026-10-08-ideal-alpha` を消し、`2026-10-08-ideal-generations`・`2026-10-04-notifications` の本文を文書のとおりに直した。href を足したもの: このフェーズの 6 件（find-merge・owned-overlay・register-entry・register-dialog → `#/search`、goals-merge → `#/ideal?goals=1`、route-cleanup → `#/route`）と `2026-10-10-owned-keyword`（`#/owned`）・`2026-10-08-ideal-groups`（`#/ideal`）。
   - **プロジェクトの CLAUDE.md:16 は、まだ直していない**。ユーザーの指示（変える前に理由と影響を示して確認を取る）に従い、フェーズ 2 の報告で文案と理由・影響を示して確認を取る（文案は手順 6 のとおり。「（右上のベルの通知欄と、設定タブの「通知一覧」に出る）」→「（右上のベルの通知欄と、ベルの「すべての通知を見る」に出る）」と変更記録 1 行）。
8. **行き先（手順 7）**: 未設定の通知の行き先は 1d で `settingsHash(worldId, 'registrant')` に済んでいた（変更なし）。
9. **テスト**: 1,539 → 1,545 件（`npm test` exit 0）。notifications.test.js（既読の始め方〔記録のない ID・記録のある ID・読み出しが例外の端末・保存の失敗〕、`notificationCategory`・`unreadCounts`、palId の確かめ、ベルの 30 行・開いても既読にしない・揺れ、点と aria-label、チップと「未読だけ」・開き直しても残る・行の「既読にする」とフォーカス・「すべて既読」・行を押すとその 1 件、「すべての通知を見る →」でチップを引き継ぐ、通知一覧の「すべて既読」。既読から始まる端末にしないテストは `setup({ read: [] })`）、app.test.js（初めての端末で数字なし・別のタブの既読で点・開いても既読にしない・設定の「通知一覧」がない／「すべての通知を見る →」と閉じたらベルへ）、views.test.js（設定のカード）、auto-register.test.js（成功・保留・見送りの palId）。
10. **画面（モック・1100×900）**: 未読のお知らせ 2 件と自動登録の通知（成功 3 件・未設定 1 件）と目標の通知で、数字「3」・パネル（30 行・チップ・絵・未読の右の列・下端）・「自動登録」＋「未読だけ」で 2 行・「既読にする」で数字が減ってフォーカスが次の行の ✓ へ・通知一覧（チップの行の右端に「すべて既読」）を確かめた（`51`〜`56`。ダークも）。
11. **後のテーマへの申し送り**:
    - autoreg-visibility: 裏のタブの題名は `unreadCounts(notifications).actionable` を使う。
    - settings: 「通知」カードはもうない（カードの並びの整理はここから）。

---

## autoreg-visibility: 自動登録の状況を見えるように

### 目的
自動登録が止まったとき・裏のタブで何か起きたときに、気づけて、その場で直せるようにする。許可切れの案内を 1 つにまとめ、裏のタブでは題名とファビコンに数を出し、登録されずに残っている候補を見られるようにする。

### 経緯
- 統合プランの autoreg-visibility（本セッションの X-19・C-31・X-18・G-31・G-36・D-02・D-03・D-08）。本セッションだけの案（別プランに対応する F 番号はない）。
- Chrome は「今回のみ」で許可したファイルの読む許可を、タブがしばらく裏にあると外す（X-19 の調査。公式ブログ）。外れると 1 分ごとの読み直しで「許可が必要」になり、共有も自動登録も止まる（`owned.js:435-436`・`auto-register.js:99`）。`requestPermission` はクリックの中でしか呼べないので、裏のタブでは直せない。
- X-18 の判断（第 1 段だけ作る）: (1) 自動登録の件数を通知に残す（＝フェーズ 1 の autoreg-success で済み）、(2) 裏の間だけ題名とファビコンに数（更新内容のお知らせは数えない）、(3) 戻ったときに許可が切れていれば許可のボタンを出す（＝フェーズ 1 の header-frame のヘッダーの状態「● 許可が必要」とポップオーバーで代わる）。OS の通知・まとめカードは、使ってみて足りなければ後で。新しく作るのは `web/js/attention.js` だけ。
- X-19・C-31 の判断: 許可切れの長い文（80 字）を短くし、「拒否した場合は…」は許可されなかったとき（`grantAndRefresh` の `granted < total`）だけ出す。止まった時刻 `stoppedAt` を持たせて「14:32 から読めていません」。外れた回数の記録と警告色はやらない。何分で外れるかは実機で確かめるまで書かない。
- G-36 の判断: レールの所持パルに、読み込みが止まっているとき「!」。下書き・ウィッシュリストのバッジは、タブ自体がなくなったので不要（目標の完成のバッジは goals-merge で入れた）。
- D-08 の判断: 登録されずに残っている候補（`farms.pending`）を、件数と**親だけ**で一覧にする（子は配合表で決めた値なので出さない。INV-2）。

### 依存
- header-frame（フェーズ 1。ヘッダーのセーブ連携の状態とポップオーバー）、bell（`unreadCounts`・通知の種類）。autoreg-success（成功の通知と href）。

### このテーマでやらないこと
- OS の通知（Notification API）・戻ったときの「離れている間に」のまとめカード（X-18 の第 2 段。必要と分かってから）。
- 手動登録のトーストの「表示」（D-02 の判断で見送り）。
- 未設定の候補に「手動で登録」のボタン（D-08 の判断で見送り。すぐ上のプレイヤーの対応で片づく）。

### 現状（HEAD ad648b7 で確認）
- 許可切れ: `owned.js:436` が 80 字の文（「…「読み込みを許可」を押してください（拒否した場合は、Chrome のサイトの設定で許可を戻すか、ファイルを登録し直してください）」）を `state.auto.error` に入れる（`stop` `:405-411`）。所持パル（`ui/owned-status.js:48-49`。ボタンつき）と設定（`views/owned-settings.js:378-385`。「許可が必要」・同じ文・ボタンの 3 つが同時に出る）とヘッダー（header-frame）に出る。止まった時刻は持っていない（`state.auto` `:165` に時刻がない）。`grantAndRefresh`（`:630-636`）は `{ granted, total }` を返すが、呼ぶ側（`owned-settings.js:194`）は使っていない。`docs/OPERATIONS.md:83` は許可を求められるのを「初めて読むとき（またはブラウザを開き直したとき）」としていて、裏で外れる場合を書いていない。（追記 2026-10-14、D29: owned-status で足した所持パル・理想個体・継承ルートのデータ元の 1 行〔「読み込みを許可」つき〕はなくした。許可切れの表示は所持パルの案内の帯・設定・ヘッダーの 3 か所のまま〔ヘッダーを押すと許可を求める〕。owned.js の `state.activity`・`checkedAt` もなくしたので、「読み込み停止」の判定は `auto.status` と手順 2 の `stoppedAt` で行う）
- 題名とファビコン: `web/index.html:8-9` で固定（「パル配合ノート」・`favicon.svg`）。web/js で `document.title` を変えている所はない。CSP は `img-src 'self' data:`（`index.html:6`）なので data: の SVG をファビコンにできる。
- レールのタブはアイコンとラベルだけ（`app.js:105-114`）。
- 自動登録のトーストは件数だけ（`auto-register.js:294`）。`toast` は `action`・`actionLabel` に対応している（`ui/toast.js:19-36`）。
- 異常の通知（表と違う）には href がない（`auto-register.js:211-215`）。食い違いの通知の href は find-merge で `#/search?p1=&p2=` にした。
- 保留の候補: `farms.pending`（最大 200 件。`auto-register.js:17`・`:152-153`・`:178`）。画面では見えない。登録者が決まらない候補は `resolveRegistrant`、食い違いは `findConflict` で判定（`:247-263`）。

### 実装の手順
1. **許可切れの案内を 1 つの関数に**（`ui/owned-status.js` に足す）
   ```js
   export function permissionNotice(state, { now = Date.now } = {}) {} // → null | { text, hint, since }
   ```
   - `text`: 「セーブを読む許可が必要です」。`hint`: 「Chrome の確認で『毎回のアクセスを許可』を選ぶと、ゲーム中（タブが裏）も止まりません」。`since`: `state.auto.stoppedAt` があれば「14:32 から読めていません。この間に拾ったタマゴは自動登録されていない場合があります」。
   - ヘッダーのポップオーバー（header-frame）・所持パルの案内（`ownedNotices` の `:48-49`）・設定の状態の行（`owned-settings.js:378-385`）の 3 か所で、この 1 つを使う。設定では状態の行を「⚠ 許可が必要［読み込みを許可］」にまとめ、`autoError` は permission のときは出さない（C-31 の判断）。
2. **止まった時刻**（`web/js/owned.js`）: `state.auto.stoppedAt` を足す。`status` が `permission` に**なったとき**だけ今の時刻を入れ（続けて permission の間は上書きしない）、`ready` になったら空にする。`owned.js:436` の文は手順 1 の `text` と同じ短い文に。
3. **拒否したとき**: 「読み込みを許可」の 3 か所のボタンで `grantAndRefresh()` の結果が `granted < total` なら、トースト「許可されませんでした。Chrome のサイトの設定で許可を戻すか、ファイルを登録し直してください」。
4. **裏のタブの題名とファビコン**（新規 `web/js/attention.js`）
   ```js
   export function createAttention({ document, notifications, owned, baseTitle = 'パル配合ノート' }) {}
   // → { setScreen(label), update(), destroy() }
   ```
   - 表のとき: 題名は「画面名 · パル配合ノート」（G-31。パル詳細はパル名。画面名は `app.js:103` の `tabs` のラベル。`render()` のたびに `setScreen`）。ファビコンは `favicon.svg` のまま。
   - 裏のとき（`document.visibilityState === 'hidden'`）: 要確認の未読（bell の `unreadCounts().actionable`。更新内容のお知らせは数えない）が 1 以上なら題名の頭に「(3) 」、読み込みが止まっている（`owned.state.auto.status === 'permission'`）なら「(!) 読み込み停止 · 」。ファビコンを、今の 2 つの path（`web/favicon.svg` の値を定数で持つ）に右上の丸（数字 1〜9 と「9+」、止まったときは「!」）を重ねた SVG を `data:image/svg+xml,${encodeURIComponent(svg)}` にして `link[rel=icon]` の `href` を差し替える。表に戻ったら元に戻す。
   - SVG の文字列は定数と整数だけで組み立てる（利用者の文字列を入れない）。**style 属性は使わない**（`fill`・`font-size` などの属性で書く。`test/static/security.test.js:20` の検査に当たらないように）。
   - `notifications.subscribe`・`owned.subscribe`・`visibilitychange` で `update`。`app.js` で 1 回作る。
5. **レールの「!」**（G-36 の判断）: 所持パルのタブに、`owned.state.auto.status` が `permission`・`error`・`empty` のとき警告色の「!」。aria-label を「所持パル（読み込みが止まっています）」に。`app.js` で `owned` を購読し、バッジの文字と `hidden` だけを書き換える（goals-merge の理想個体のバッジと同じ作り）。
6. **自動登録のトーストに「見る」**（D-02 の判断）: `createAutoRegister` に `navigate`（`context.navigate`）を渡し、成功のトースト（`auto-register.js:294`）に `{ actionLabel: '見る', action: () => navigate(href) }`。href は autoreg-success の成功の通知と同じ（1 件なら `#/search?p1=&p2=`、2 件以上なら `#/search?sort=updated`）。
7. **異常の通知の行き先**（D-03）: `anomalyNotice`（`auto-register.js:211-215`。inv2-notice で本文が変わっている）に `href: buildHash('search', { p1: m.parents[0], p2: m.parents[1] })`。通知の id は変えない（既読を保つ）。保存済みの古い通知には付かない（新しく出る通知から。古いものは最大 50 件で自然に消える）。
8. **保留の候補の一覧**（D-08 の判断）
   - `auto-register.js` に `pendingSummary(worldId = linkedWorld())` を足す: 保存した `farms.pending` を読み、今の判定（`resolveRegistrant`・`findConflict`）で `{ unmapped: [{ uid, name, parents: [a, b] }], conflict: [{ key, parents: [a, b] }] }` を返す。**候補の子（`candidate.record.childId`）は返さない**。
   - `discardPending(worldId, key)` を足す（`finish` と同じく `readFarms`・`writeFarms` を通す）。
   - 設定のワールドの行（ホスト）の、プレイヤーの対応の欄のすぐ上に「登録待ち 3 件（登録者未設定 2・登録済みと違う 1）」。0 件なら出さない。「登録済みと違う」の行は親 2 体のアイコン・「登録を開く」（`#/search?p1=&p2=`）・「破棄」の 3 つだけ。未設定の行はボタンを足さない（すぐ下の対応の select で片づく）。roles でプレイヤーの対応が独立した欄に移るので、そのときこの行も一緒に移す。
9. **文書**: `docs/OPERATIONS.md:83` に「タブがしばらく裏にあると Chrome が許可を外すことがあるので、『毎回のアクセスを許可』を勧める」を足す（何分で外れるかは実機で確かめるまで書かない）。

### 触るファイル
- 変更: `web/js/owned.js`、`web/js/ui/owned-status.js`、`web/js/views/owned-settings.js`、`web/js/auto-register.js`、`web/js/app.js`、`web/css/app.css`、`web/js/release-notes.js`、`docs/OPERATIONS.md`、`test/helpers/dom.js`（`document.title`・`link[rel=icon]` を足す）
- 新規: `web/js/attention.js`、`test/web/attention.test.js`

### テスト
- 新規 `test/web/attention.test.js`（偽の document と偽の通知・所持パルのストア）: 表のときは「画面名 · パル配合ノート」、裏で要確認の未読 3 件なら「(3) 」とファビコンの href が data: に、お知らせだけの未読は数えない、止まったら「(!) 読み込み停止 · 」、表に戻るとファビコンが `favicon.svg` に戻る。SVG に `style=` が入らないこと。
- `test/web/owned-store.test.js`: `stoppedAt` が permission になったときだけ入り、続けても変わらず、ready で消える。
- `test/web/owned-view.test.js`: 許可切れの案内が 3 か所で同じ文、設定の状態の行のまとまり。`:408` の参加者の文は roles で変わる。
- `test/web/auto-register.test.js`: `pendingSummary` の件数と、**結果に子が含まれないこと**、`discardPending`、トーストの「見る」、異常の通知の href。
- `test/web/app.test.js`: レールの所持パルの「!」。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: 保留の候補の一覧と通知には、親と理由だけを出す。候補の子は配合表の答えなので出さない（`pendingSummary` が返さないことをテストで固定する）。
- セキュリティ: ファビコンの SVG は定数と整数だけ。data: URL は今の CSP で許されている（`img-src 'self' data:`）。CSP は変えない。
- 性能: 題名とファビコンの更新は、数か状態が変わったときだけ（同じ値なら書き換えない）。

### release-notes の案
- id: `<実装日>-autoreg-visibility`／title: 「自動登録の状況を表示」（10 字）／body: 「裏のタブでは題名とアイコンに件数を出し、許可が切れたら止まった時刻と直し方を出します。」（43 字）

### 完了の条件
- [x] `npm test` が通る。
- [x] モックで（許可切れは偽の状態で）: 所持パル・設定・ヘッダーに同じ短い文と「毎回のアクセスを許可」の勧め、止まった時刻が出る。
- [x] ブラウザで: タブを裏にして要確認の通知を起こすと題名とファビコンに数が出て、戻ると消える。お知らせだけでは出ない。
- [x] 設定のワールドの行に「登録待ち n 件」が出て、子のパルが画面のどこにも出ない。
- [x] OPERATIONS.md:83 を直した。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 保留の候補の一覧と通知に子が出ない（`pendingSummary` のテストで固定）。互換 — 保存の形を変えていない。セキュリティ — ファビコンの SVG は定数と整数だけで、CSP を変えていない（`test/static/security.test.js`）。性能 — 題名とファビコンは数か状態が変わったときだけ書き換える。

### TODO
- [x] `permissionNotice` を作り、3 か所で使う（テストを先に）
- [x] `state.auto.stoppedAt` と短い文
- [x] 許可されなかったときのトースト
- [x] `attention.js`（題名・ファビコン）とテスト、テストの偽の DOM の拡張
- [x] レールの所持パルの「!」
- [x] 自動登録のトーストに「見る」
- [x] 異常の通知の href
- [x] `pendingSummary`・`discardPending` と設定の「登録待ち」の行（子を出さない）
- [x] OPERATIONS.md:83 と release-notes

### 実装の記録（2026-10-15、ブランチ `feature/autoreg-visibility`）

実装のときに決めたこと・文書と違う形にしたこと（後の settings・roles はこちらを正とする）。

1. **許可切れの案内（手順 1）**: ui/owned-status.js に **`permissionNotice(state, { now })`** → `null | { text, hint, since }` と定数 **`PERMISSION_TEXT`**（「セーブを読む許可が必要です」）・**`PERMISSION_HINT`**・**`PERMISSION_DENIED`**。`since` は `formatShortTime`（同じ日なら「14:32」、違えば「10/14 23:05」）＋「から読めていません。この間に拾ったタマゴは自動登録されていない場合があります」。3 か所:
   - ヘッダーのセーブ連携（ui/save-status.js）: ボタンの title は「セーブを読む許可が必要です（押すと許可を求めます）」、ポップオーバーの困っていることは文・止まった時刻・勧めの 3 行。
   - 所持パルの案内（`ownedNotices`）: 文と止まった時刻を 1 文、勧めは **`noticeList` に足した `notice.hint`**（`small.owned-notice-hint` の 2 行目）。
   - 設定の状態の行: チップ「許可が必要」と「読み込みを許可」のまま、その下の `p.owned-auto-error` に長い文の代わりに止まった時刻と勧め（`.is-hint` で補足の色）。
2. **止まった時刻（手順 2）**: `state.auto.stoppedAt`（ISO）。`stop('permission')` のときに**まだ空なら**入れる（確認の途中の `checking` を挟んでも上書きしない）。`ready` で空にする。owned.js の許可切れの文は `PERMISSION_TEXT` と同じ短い文。
3. **許可されなかったとき（手順 3）**: **`grantWithReport(owned)`**（ui/owned-status.js）を 3 か所のボタンで使う。`grantAndRefresh()` が `{ granted < total }` で解決したとき、または許可待ちで止まって `code: 'permission'` で失敗したとき（今の作りでは一部でも許可されないと読み直しが止まって失敗する）に `PERMISSION_DENIED` のトースト。ほかの失敗はそのエラーの文。クリックの中で await を挟まずに `grantAndRefresh` を呼ぶのは前のまま。
4. **題名とファビコン（手順 4）**: **`web/js/attention.js`** の **`createAttention({ document, notifications, owned, baseTitle })` → `{ setScreen, update, destroy }`** と `faviconSvg(label)`・`badgeLabel(count)`。app.js は通知のストアを作った直後に 1 回作り、`markTabs`（どちらの描き方でも呼ぶ）で `setScreen(タブの名前 / パル詳細はパルの名前)`、ログイン画面で `setScreen('')`。裏のとき: 要確認の未読（`unreadCounts().actionable`）があれば「(3) 」、許可待ちなら「(!) 読み込み停止 · 」（**両方あれば両方**。文書はどちらか一方の書き方だった）。ファビコンの丸は止まっているとき「!」を優先、ほかは 1〜9・「9+」。丸の文字は決まった値の集合（`!`・`1`〜`9`・`9+`）だけを通す。ファビコンの path は web/favicon.svg のライトの色を定数で持つ（ダークの `<style>` は使わない）。`link[rel=icon]` がない document（アプリのテストの偽物）でも題名だけ書き換える。テストの偽の DOM（test/helpers/dom.js）に `head`（`link[rel=icon]`）と `title` を足した（`document.querySelector` は足していない。app.js の `dialog[open]` の判定の動きが変わるため）。
5. **レールの「!」（手順 5）**: 所持パルのタブに `span.nav-badge.is-warning`。`auto.enabled` で `status` が `permission`・`error`・`empty` のとき「!」とタブの aria-label「所持パル（読み込みが止まっています）」。**隠している間は文字も空**（タブの文字に混ざらないように。理想個体のバッジと同じ）。
6. **トーストの「見る」（手順 6）**: `createAutoRegister({ navigate })`（app.js は `(hash) => context.navigate(hash)`。context は後で作るので押したときに引く）。1 件ならその組、2 件以上なら `#/search?sort=updated`。
7. **見送りの通知の行き先（手順 7）**: `anomalyNotice` に `href: buildHash('search', { p1, p2 })`（id は同じ。前に保存した通知には付かない）。
8. **登録待ち（手順 8）**: auto-register.js に **`pendingSummary(worldId)`** → `{ unmapped: [{ uid, name, parents }], conflict: [{ id, parents }] }` と **`discardPending(id, worldId)`**。**候補の key は子を含む（`親|親>子`）ので返さず、破棄に使う `id` は key の FNV-1a の 16 進（`p` ＋ 8 桁）にした**（文書は `key` を返す書き方だった。INV-2）。登録者が決まって食い違いもない候補（次の判定で登録する）・登録済みと同じ候補・親の性別で子が変わる別の結果（配合表を読み込んだ後だけ判定できる）は数えない。破棄は `finish`（このタブでは送り直さない）と `changed()`。判定の後（`run` の終わり）にも `changed()` で知らせる。設定（views/owned-settings.js）は自動登録の欄のチェックの下・登録者の選択の上に `div.owned-pending`（`renderPending` が中身だけ書き換える。`autoRegister.subscribe` と描き直しのたび）。「登録済みと違う」の行は親 2 体の絵（role=img・aria-label「A＋B」）・「登録を開く」・「破棄」（**確かめのダイアログを挟んだ**。取り消せないため）。
9. **文書（手順 9）**: docs/OPERATIONS.md の読む許可の項に、裏で外れることがあることと勧め・3 か所の案内・止まった時刻・拒否のトーストを書き、所持パルのタブの「!」・題名とファビコン・トーストの「見る」・見送りの通知の行き先・登録待ちの項を足した（文書の「:83」は今は 110 行目）。
10. **テスト**: 1,545 → 1,562 件（`npm test` exit 0）。新規 test/web/attention.test.js（表の題名・裏の数とファビコン・お知らせは数えない・「9+」・止まったとき・両方・同じ値なら書かない・destroy・丸の文字の集合・head のない document）、owned-store.test.js（`stoppedAt`）、owned-status.test.js（`permissionNotice`・所持パルの案内の hint・`grantWithReport` のトースト）、owned-view.test.js（所持パルの案内の文、設定の登録待ちの行と破棄・0 件で隠す・子を出さない、設定の許可切れの状態の行）、save-status.test.js（ヘッダーの title）、auto-register.test.js（トーストの「見る」・`pendingSummary` の分け方と子を返さない・`discardPending`・見送りの通知の href）、app.test.js（題名、所持パルのタブの「!」）。
11. **画面（モック・1100×900）**: 題名「配合を探す · パル配合ノート」→ パル詳細で「モコロン · パル配合ノート」、`visibilityState` を hidden にして `visibilitychange` を起こすと「(1) モコロン · パル配合ノート」とファビコンが data: の SVG（丸の「1」。`57-favicon-badge.png`）、表に戻すと元に戻る。
    - **確かめていないこと**: モックには登録したワールドがなく許可も扱えないので、許可切れの 3 か所の表示・設定の「登録待ち」の行・所持パルのタブの「!」はブラウザでは確かめていない（テストで確かめた）。本物の Chrome で、タブを裏にして許可が外れるまでの時間も確かめていない。
12. **後のテーマへの申し送り**:
    - roles: 登録者の対応を独立した欄に移すときは、`div.owned-pending`（`pendingBoxes`・`renderPending`）も一緒に移す。
    - settings: 設定の状態の行（`stateRow`・`autoError`）の並びを変えるときも、許可切れは `permissionNotice` を使う。

---

## settings: 設定の整理

### 目的
設定を「セーブ連携・アカウント・データ・このアプリについて」の順に組み直し、ヘッダー・ベルと重なるカードを消す。書き出しを 1 枚にまとめ、端末にだけあるデータ（下書き・目標・既読・自動登録の記録）を書き出し・読み込みできるようにする。重複した表示とボタンの入れ子を直す。

### 経緯
- 統合プランの settings（本セッションの C-10・C-11・C-12・C-17・C-18・C-20・C-36・C-40・C-43・C-44、別プランの F079・F081・F082）。
- 「データの状態」カードは**ヘッダーで代わる**（header-frame の同期状況は押すと最新に更新・日付と件数。G-17）。C-10（カードを 1 行に縮めて残す）は C-09 の代案で、統合プランはカードを消す方を採ったので**入れない**。
- **判断事項 11**: CSV は設定の「書き出し」カードにまとめる（各タブへの移動 C-13 は取り消し）。調査では C-14（書き出しを 1 枚に）は C-13 の代案として却下していたが、**判断事項 11 で覆った**（rejected.md の C-14）。
- **F081**（別プランのみ・本セッションで照合済み: 端末のデータを書き出す機能は今はない）: 「この端末のデータ」カード。下書き・目標・既読・自動登録の記録の件数と JSON の書き出し・読み込み。ログアウトの確認文に端末に残る旨。
- 「通知」カードは bell で消した（順番の決まりのとおり、ベルの入口を先に作った）。

### 依存
- header-frame（ヘッダーの同期状況・ID のポップオーバー）、bell（通知カードの廃止）、goals-merge（目標・観測のキーの形が決まっている）。register-dialog（下書きの性別のキー）。

### このテーマでやらないこと
- 設定の左の目次（C-19。却下）、表示と自動読み込みのワールドを分ける（C-35。却下）。
- プレイヤーの対応の欄の切り出し・ワールドの登録モーダルの手順（roles）。ただし登録モーダルの結果欄の高さと実際のパス（F082）はこのテーマ。
- 設定を 2 列にする（C-17 の判断では任意。このテーマでは左寄せの 1 列にとどめる）。

### 現状（HEAD ad648b7 で確認）
- `views/settings.js`: 見出し「ノートの設定」（`:70`。copy-dead-ends で「設定」）、並びは データの状態（`:71-77`）→ セーブ連携（`ownedSettingsCard`）→ 記録を書き出す（`:97-99`）→ 整合性の警告（`:100-102`。0 件でも「警告はありません。」で出る `:127`）→ 通知（`:103-105`。bell で消える）→ アカウント（`:78-96`）（`:108`）。名前の変更の説明はカード（`:114`）とモーダル（`:46`）の両方に出る（C-40）。ログアウトの確認（`:90`）は「この端末のパスワードと配合キャッシュを消去します。…」で、下書きなどが残ることは書いていない。
- 配合の CSV `exportCsv`（`:16-30`）と所持パルの CSV `downloadCsv`（`views/owned-settings.js:30-42`。BOM つき）が別々にダウンロードの処理を持つ。所持パルの CSV はワールドの行の中（`:261-284`）と、ワールドがないときの「所持パルを CSV で保存」（`:287-291`）。
- セーブ連携のカード `views/owned-settings.js:185-409`: 状態の `dl`（この PC・表示中・更新。`:389-395`。表示中・更新は所持パルの画面・ヘッダーと同じ内容。participant-self で「このワールドでの自分」の select が入っているはず）、ワールドの行の表記「「テスト」（ホスト Alice） · ホスト · 5 ファイル · …に遊んだ」（`registeredLabel` `:23-28`。「ホスト」が 2 回・ファイル数。C-43）、行の `summary` の中に「編集」「削除」のボタン（`:321-341`。ボタンの入れ子。C-44）。
- ワールドの登録モーダル（`openWorldDialog` `:65-183`）: 結果欄 `.owned-dialog-result`（`:89`）は中身で高さが変わる。チェックリスト（`renderDraft` `:108-121`）はパスの例だけで、貼ったパスの実際の値を使わない（F082）。
- `app.css:742` `.settings-view { max-width: 800px; margin: 0 auto; }`（設定だけ中央寄せ。C-17）。
- 権利表記は `README.md:40-41` だけ。版（`version.js` の `runningVersion`）は画面に出ていない（C-20）。

### 実装の手順
1. **ダウンロードの共通化**: `ui/dom.js` に `export function downloadBlob(blob, filename)` を足し（今の `exportCsv` `:21-29` と `downloadCsv` `:33-41` の a 要素・`revokeObjectURL` の処理を移す）、両方と手順 5 の書き出しで使う。
2. **カードを組み直す**（`views/settings.js`）: 並びを「セーブ連携 → アカウント → データ → このアプリについて（小さな文字）」に。
   - 「データの状態」カード（`:71-77`）を消す。
   - 「データ」の見出しの下に 3 つ: 整合性の警告（**0 件ならカードごと隠す**。1 件以上なら「整合性の警告（n 件）」。C-11）、書き出し、この端末のデータ。
   - 警告が 1 件以上のとき、レールの「設定」に件数のバッジ（既存の `notification-badge` の見た目。C-12 の判断）。押すと `#/settings?open=warnings` で警告のカードへスクロールして見出しにフォーカス。`app.js` で `store` を購読し、バッジの文字と `hidden` だけ書き換える。
3. **書き出し**カード（F079・判断事項 11）: 「配合の CSV」（今の `exportCsv`）と「所持パルの CSV（表示中のワールド）」（`owned.state.owned` と `meta.saveUpdatedAt` で `downloadCsv`。データがなければ押せない理由つきで無効）。ワールドの行の中の「CSV で保存」（`owned-settings.js:264-271`）とカードの「所持パルを CSV で保存」（`:287-291`）は消す（「共有した所持パルを削除」はワールドの行に残す）。
4. **アカウント**カード: 「ログイン中: X ［名前を変更］［ログアウト］」だけにし、名前の変更の説明はモーダルの側だけに残す（C-40。止まっているときの「…終わっていません」は残す）。ログアウトの確認文に「下書き・目標・既読などはこの端末に残ります（同じ ID でログインすると戻ります）。」を足す。
5. **この端末のデータ**カード（F081）
   - 件数: 下書き n（`drafts.list().length`）・目標 n（`ideals.list().length`）・既読 n（既読の id の数）・自動登録の記録 n（自動登録の通知の数）。
   - 「書き出す」: 次の JSON をダウンロード（`pal-note-device-<env>-<日付>.json`）。
     ```json
     { "format": "pal-breeding-note/device-data", "version": 1, "exportedAt": "…", "env": "prod", "userId": "…",
       "drafts": [], "draftGenders": {}, "goals": [], "goalsObs": {}, "notificationsRead": [],
       "autoBreedingNotices": [], "playerMappings": { "<worldId>": { "<playerUid>": "<userId>" } } }
     ```
     含めないもの: パスワード・記録のキャッシュ・所持パル（IndexedDB。セーブから読み直せる）・自動登録の牧場の記録（`autoBreeding.farms`。端末をまたぐと照合を取り違える）・理想個体の計画の記憶・画面の状態。
   - 「読み込む」: `input type=file`（`accept="application/json,.json"`）。1MB を超えるファイルは読まない。`JSON.parse` を try/catch、`format`・`version` が合わなければ断る。**環境（テスト／本番）が違えば断る**。ID が違えば確認（「別の ID（X）のデータです。取り込みますか？」）。各項目を今の検証で整える（下書きは `cleanDraft`、目標は `cleanGoal`／`parseGoals`、観測は `cleanObservations`、既読は文字列 200 字以内・5,000 件まで、対応はワールド ID・uid・ID の形）。取り込む前に「下書き 3・目標 5・既読 120 件を取り込みます」の確認。
   - 取り込みは**今のデータに足す**（上書きしない）: 下書きは id で和（今のものを優先）、目標は `goalKey` で重複を除き 100 件まで（入らなかった数を出す）、観測は `mergeObservation`、既読は和、対応は今の値を優先。書き込みは各ストアの関数を通す（キャッシュと別タブの決まりを守るため。直接 localStorage に書かない）。そのために `drafts.importMany(list)`・`ideals.importGoals(goals, observations)` を足す（どちらも保存の成否を返す）。終わったら「取り込みました（目標 2 件は重複・上限で取り込みませんでした）」。
   - 「この端末だけ」の小さなチップを、下書きの帯（register-entry の「（この端末だけ）」）と目標のダイアログの見出しにそろえる（言葉は「この端末だけ」に統一する）。
6. **セーブ連携のカードの重複を直す**（`views/owned-settings.js`）
   - 状態の `dl`（`:389-395`）の「表示中」「更新」の行を消す（ヘッダーと所持パルで見られる）。「この PC」は `roleLabel` の括弧書きをやめ、状態の行に「ホスト」「参加」の短いチップで出す（C-36）。participant-self の「このワールドでの自分」は残す。
   - ワールドの行の表記を「「テスト」（ホスト Alice）· 10/10 09:00 に遊んだ」に（kind の「ホスト」とファイル数を消す。参加のワールドだけ「参加」のチップ。状態「許可が必要」などは今どおり後ろ。C-43）。
   - `summary` の中は ▸・ワールド名・自動登録のチップだけにし、「編集」「削除」は `details` の外（行の右端）に置く（C-44）。
7. **ワールドの登録モーダル**（F082）: 結果欄 `.owned-dialog-result` を固定の高さ 2 行（`min-height`。長い文は 2 行で切って `title`）。チェックリストの各行に、① に貼ったパスから作った実際のパス（`…\SaveGames\7656…\ABCD…\Level.sav` のように省略）を薄い字で添える（パスがまだなければ今の書き方）。
8. **見た目**: `app.css:742` の中央寄せをやめ、ほかのタブと同じ左寄せにする（`max-width` を外す。C-17）。一番下に小さな文字の 2 行（C-20 の判断）: 「Palworld のゲームデータ・名称・画像の権利は © Pocketpair, Inc. に帰属します。非公式・非営利のファンツールです。」（`README.md:40-41` と同じ意味）と、配信版のときだけ版の短いハッシュ（`runningVersion()`）。ログイン画面の注記の下にも同じ権利表記を 1 行（copy-dead-ends で削った文と重ならないように）。

### 触るファイル
- 変更: `web/js/views/settings.js`、`web/js/views/owned-settings.js`、`web/js/ui/dom.js`、`web/js/drafts.js`（`importMany`）、`web/js/ideals.js`（`importGoals`）、`web/js/app.js`（設定のバッジ・ログイン画面の権利表記）、`web/css/app.css`、`web/js/release-notes.js`、`docs/OPERATIONS.md`（CSV の置き場所・端末のデータ）
- 新規: `web/js/device-data.js`（書き出しの組み立てと読み込みの検証・併合。DOM なし）、`test/web/device-data.test.js`

### テスト
- 新規 `test/web/device-data.test.js`: 書き出しに含める・含めない項目、読み込みの断り（形・版・環境・大きさ・壊れた JSON）、併合（今のものを優先・目標の重複と上限・既読の和）、ID が違うときの確認の呼び出し。
- `test/web/views.test.js:139-145`（カードの順）: 所持パルのないテストの文脈では「アカウント」「書き出し」「この端末のデータ」（警告 0 件は隠れる）。`:144` のログイン中の ID は新しい文に。
- `test/web/owned-view.test.js:234`（状態の dl）・`:236`（ワールドの行の表記と、`summary` の外の編集・削除）・`:553,562`（ワールドの行の CSV ボタンがなくなる）。
- `test/web/app.test.js:486-490`: 設定の「最新に更新」がなくなるので、ヘッダーの同期状況のボタン（header-frame で作ったもの。`byClass('sync-status')`）を押す形に。`:510` の「これまでの配合の登録者名もすべて新しい名前になります」は、モーダルの中で確かめる形に。
- `test/web/drafts.test.js`・`test/web/ideals.test.js`: `importMany`・`importGoals` の成否。

### INV-2・互換・セキュリティ・性能の注意
- セキュリティ: 読み込むファイルは信用しない。大きさの上限・形の検証・各ストアの検証を通し、文字はすべて `textContent`。読み込んだ内容で HTML を作らない。パスワードは書き出さない。
- 互換: 書き出しの形に `version` を持たせ、将来の形の違いを断れるようにする。読み込みは足すだけで、今のデータを消さない。
- 互換: 「データの状態」をなくすので、手で最新に更新する入口はヘッダーの同期状況だけになる（header-frame で押せることを確かめてから消す）。

### release-notes の案
- id: `<実装日>-settings`／title: 「設定を整理」（5 字）／body: 「書き出しを 1 枚にまとめ、端末のデータの書き出し・読み込みを足しました。データの状態はヘッダーへ。」（50 字）

### 完了の条件
- [x] `npm test` が通る。
- [x] モックで: 設定の並びが「セーブ連携・アカウント・データ・このアプリについて」。警告 0 件でカードが出ず、1 件以上でレールにバッジ。配合と所持パルの CSV が書き出しカードから保存できる。
- [x] この端末のデータを書き出し、別のブラウザ（または storage を消した後）で読み込むと、下書き・目標・既読が戻る。別の環境のファイルは断られる。
- [x] ワールドの行の summary の中にボタンがない（読み上げで確かめる）。ワールドの登録モーダルの結果欄で、ほかの部品が上下しない。
- [x] 設定が中央寄せでない。
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: セキュリティ — 読み込むファイルは大きさの上限・形の検証・各ストアの検証を通し、文字は textContent、パスワードを書き出さない（`device-data.test.js`・`test/static/security.test.js`）。互換 — 書き出しの形に `version` があり、読み込みは足すだけで今のデータを消さない。取り込んだ目標の個体値は「0＝条件なし」の形のまま（判断事項 10）。CSV は書き出しカードにまとめた（判断事項 11）。INV-2・性能 — 対象外。

### TODO
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

### 実装の記録（2026-10-15、ブランチ `feature/settings`）

実装のときに決めたこと・文書と違う形にしたこと（後の roles と、フェーズ 3 以降はこちらを正とする）。

1. **ダウンロード（手順 1）**: ui/dom.js に **`downloadBlob(blob, filename)`** と **`dateStamp(now)`**（YYYYMMDD）。配合の CSV（views/settings.js の `exportCsv`）・所持パルの CSV（views/owned-settings.js の **`downloadOwnedCsv(owned, importedAt)`**。BOM つき）・端末のデータの書き出しで使う。
2. **並び（手順 2・8）**: views/settings.js を組み直した。セーブ連携（`ownedSettingsCard`）→ アカウント → `section.settings-group`（`h2.settings-group-title`「データ」と、`h3` のカード 3 つ）→ `footer.settings-about`。「データの状態」カードを消した（手で最新に更新するのはヘッダーの同期状況だけ）。`.settings-view` の `max-width`・中央寄せを外した。**データの中のカードの見出しは `h3`**（文書は書いていなかった。見出しの順を h1 → h2〔カード・グループ〕→ h3 にそろえた）。
3. **整合性の警告（手順 2）**: 0 件ならカードごと隠し、1 件以上なら見出し「整合性の警告（n 件）」。レールの設定のタブに `span.nav-badge.is-error`（ベルと同じ赤）とタブの aria-label「設定（整合性の警告 n 件）」。**警告があるあいだ設定のタブの行き先を `#/settings?open=warnings` にする**（app.js の `setTabHref` で。覚える行き先〔`tabHrefs`〕は今までどおり）。router.js の **`SETTINGS_OPEN` に `warnings`** を足し、設定の `applyRoute` が警告のカードの見出し（tabIndex=-1）へスクロールしてフォーカスする（描いた後の次の回。画面を閉じた後は動かない）。
4. **書き出し（手順 3）**: `section.settings-export`「書き出し」に「配合の CSV」と「所持パルの CSV（表示中のワールド）」（データがなければ `setDisabled` で理由つきで押せない。所持パルの画面がない文脈では出さない）。ワールドの行の「CSV で保存」とカードの「所持パルを CSV で保存」を消した。ワールドの行の「所持パル」の欄は、共有した所持パルの削除があるときだけ出す（前の「このワールドを読み込むか…保存できます」の文もなくした）。
5. **アカウント（手順 4）**: `div.settings-account-row` に「ログイン中: X」・「ID を変更」・「ログアウト」（ID の変更の再試行も同じ行）。名前の変更の説明はモーダルの側だけ（止まっているときの「…終わっていません」は行の下に出す）。ログアウトの確認文に「下書き・目標・既読などはこの端末に残ります（同じ ID でログインすると戻ります）。」。
6. **この端末のデータ（手順 5）**: 新規 **`web/js/device-data.js`**（DOM なし）: `DEVICE_FORMAT`・`DEVICE_VERSION`・`DEVICE_MAX_BYTES`・**`buildDeviceData`**・**`parseDeviceData(text, { env, userId })` → `{ ok, reason } | { ok, data, otherUser }`**・`deviceFileName`・`draftsToAdd`・**`mergeGoals`**・**`mergeObservationSpecies`**・`importSummary`。書き出しの形は文書のとおり（下書きは保存の形と `draftGenders`）。読み込みの数の上限: 下書き 500・目標 200（ストアの上限 100 で止まる）・既読 5,000・自動登録の通知 300・対応 50 ワールド × 100。取り込みは各ストアの関数: **`drafts.importMany(values)` → `{ added, saved }`**・**`ideals.importGoals(goals, observations)` → `{ added, skipped, saved }`**（**ワールドごとの完成〔`worlds`〕は持ち込まず、表示しているワールドで知らせずに判定し直す**。新しい端末で古い完成を知らせないため。文書は書いていなかった）・`notifications.markRead`（今の未読のうち既読にするものだけ）・**`autoRegister.importNotices(values)` → 足した数**（保存した通知と同じ `cleanSavedNotice`・`safeAutoNotice`・`unmappedHref` を通す。**文書の併合の規則には自動登録の通知がなかったが、書き出しに含めるので取り込みも足した**）・`autoRegister.setMapping`（今の対応がない uid だけ）。件数の既読は通知のストアに足した **`readList()`**。カードの見出しに「この端末だけ」のチップ（`device-only-chip`）。目標のダイアログの見出しの横にも同じチップ。**下書きの帯は前から「下書き n 件（この端末だけ）」と同じ言葉なので変えていない**。ID が違うファイルは「別の ID（X）のデータです。取り込みますか？」、取り込む前に「下書き 3・目標 5・既読 120 件を取り込みます。今のデータは消さずに足します。」、終わったら「取り込みました: …件（目標 n 件は重複・上限で取り込みませんでした）」。保存に失敗したストアがあればエラーのトーストで知らせる。
7. **セーブ連携のカードの重複（手順 6）**: 状態の `dl`（`.owned-settings-status`）を消し、状態の行の頭に役割のチップ（`statusChip` の `owned-role-chip`。ホスト＝ready・参加＝info。title に前の括弧書き）。ワールドの行の表記は「「テスト」（ホスト Alice） · 10/10 09:00 に遊んだ」（状態は後ろ）と、参加のワールド（kind か role が guest）だけ `statusChip('参加', 'info', 'owned-world-role')`。編集・削除は `details` の外の `div.owned-registered-actions`（行は 2 列の grid）。行の署名に `role` を足した。
8. **登録のモーダル（手順 7）**: 結果欄 `.owned-dialog-result` は 2 行分の `min-height` と 2 行の line-clamp（全文は title。前は空のとき `display: none` で、出たときに下が動いた）。チェックリストの各行に `small.owned-draft-path`（貼ったパスの Steam ID とワールド ID から作る。6 字を超える ID は頭 4 字＋「…」）。
9. **権利表記（手順 8）**: views/settings.js の **`RIGHTS_NOTE`** を設定の最下部とログイン画面（`p.login-note.login-rights`）に。版は `runningVersion()` があるときだけ「版: 〈頭 7 字〉」。
10. **テスト**: 1,562 → 1,571 件（`npm test` exit 0）。新規 test/web/device-data.test.js（書き出しの項目と含めないもの・読み込みの断り〔大きさ・JSON・形式・版・環境〕と otherUser・値の整え方・併せ方と確認の文）、drafts.test.js（`importMany`）、ideals.test.js（`importGoals`）、auto-register.test.js（`importNotices`）、views.test.js（並び・警告の出し入れ・端末のデータの読み込みの流れ）、owned-view.test.js（状態の行・ワールドの行の表記と summary の外のボタン・書き出しカードの所持パルの CSV・共有の削除だけの欄・登録モーダルの実際のパス）、app.test.js（設定のタブのバッジと警告のカードへのフォーカス、ID の変更の説明はモーダルで、ログイン中の文）、router.test.js（`SETTINGS_OPEN`）。
11. **画面（モック・1100×900）**: 設定の並び（セーブ連携・アカウント・データ〔書き出し・この端末のデータ〕・権利表記）と左寄せ（`58`・`60`）。「書き出す」で `pal-note-device-test-20261015.json` → 目標と観測のキーを消す（目標 0）→「読み込む」で確かめのダイアログ（`59`）→ 目標 4 件が戻った。本番の環境のファイルは「本番のデータです。いまはテストなので読み込めません。」で断られた。
    - **確かめていないこと**: モックには登録したワールドがないので、役割のチップ・ワールドの行の新しい表記と右端のボタン・登録モーダルの実際のパスはブラウザでは確かめていない（テストで確かめた）。整合性の警告のバッジもモックでは出ない（テストで確かめた）。別のブラウザでの読み込みは、同じブラウザでキーを消して試した。
12. **後のテーマへの申し送り**:
    - roles: 登録者の対応を独立した欄に移すときは、登録待ち（`div.owned-pending`）も一緒に移す（autoreg-visibility の申し送り）。セーブ連携のカードの状態の行（役割のチップ）は roles の役割ごとの案内とつなげてよい。

---

## roles: 役割ごとの案内とワールドの登録

### 目的
ホスト・参加者・未連携（共有を見ているだけ）の人それぞれに、正しい案内を出す。参加者に「自動登録は動きません」と誤解させない。プレイヤーの対応を独立した欄にして呼び名をそろえる。ワールドの登録モーダルを、迷わず登録できる手順にする。モックで役割を切り替えて確かめられるようにする。

### 経緯
- 統合プランの roles（本セッションの X-05・X-06・X-07・X-12・C-03・C-04・C-06・C-23・C-24・C-26・C-27・C-28・C-29。付録の範囲 C-23〜C-29 のうち **C-25（「ファイルを選ぶ」ボタン）は却下なので入れない**）。
- 統合プランの「全体の所見」6: 参加者には「自動登録は動きません」と誤解を招く案内が出る（`views/owned-settings.js:224`）。実際はホストのセーブにワールド全部の牧場が入っていて、参加者が牧場で産ませたタマゴもホストの画面が登録する（X-06）。
- 参加者の「このワールドでの自分」（F054）はフェーズ 1 の participant-self で入れた（保存は `${namespace}.ideals.self.<env>.<userIdKey>.<worldId>`）。このテーマはその上に、案内・呼び名・対応の欄を整える。
- X-06 の事実確認: 参加者向けの文は条件つきにする（ホストが自動登録をオンにしていて、あなたが登録者として対応づいているときだけ登録される）。X-07 の判断: 名前が一致したときの文は出さない。X-12 の判断: モックはまず `as=viewer`（共有ワールドを 1 つ入れる）だけ。ホスト・参加者のハンドルのスタブは必要になってから。
- C-04 の判断: 呼び名は「**プレイヤーの対応**」に決める（小見出し「プレイヤーの対応（セーブのプレイヤー → ノートの名前）」）。「登録者」は配合を登録した人の意味（カード・配合を探す）だけに残す。
- 撮影で確かめられなかった画面（参加者の画面・ワールド登録済みの設定）は、このテーマのモックの役割の切り替えと実機で確かめる（統合プランの「リスクと前提」）。

### 依存
- participant-self（フェーズ 1）、settings（セーブ連携のカード・ワールドの登録モーダルの結果欄とパス）、autoreg-visibility（「登録待ち」の行を対応の欄と一緒に移す）。

### このテーマでやらないこと
- 「ファイルを選ぶ」ボタン（C-25。却下）、ワールド登録後のトーストに「所持パルを見る」（C-30。却下）、共有だけの人の「所持パルを使わない」（X-11。却下）。
- 参加者にも接続中の仲間・Day・Lv を出す（フェーズ 4 の save-extras）。
- 自動登録の登録者の決め方そのもの（`resolveRegistrant`）の変更。

### 現状（HEAD ad648b7 で確認）
- 参加者のワールドの行を開くと「参加しているワールドなので、自動登録は動きません。」（`views/owned-settings.js:223-226`）。所持パルの参加者の案内は「参加しているワールドのため、ホストが共有した所持パルを表示しています。」（`ui/owned-status.js:53-56`）だけで、自動登録のことも、ホストの画面が今動いているかも分からない。共有の時刻は `timeLines`（`:32-39`）に小さく出るだけ。ホストのチェックのラベルは「新しく産まれたタマゴから、配合を自動で登録する」（`owned-settings.js:235`）だけで、ページを閉じると止まることは書いていない。
- プレイヤーと ID の対応は、ホストのワールドで、使うワールドとして読み込んでいる行を開いたときだけ出る（`breedingPanel` `:237-256`、players はホストのときだけ `:302`）。小見出しは「登録者（親を拠点に預けた人 → このノートの ID）」（`:243`）、読み込む前の文は「登録者は、このワールドを「使うワールド」にして読み込むと選べます。」（`:239`）。理想個体の案内（`views/ideal.js:143`・`:374`。participant-self で「設定で選ぶ」のボタンになっている）と自動登録の通知（`auto-register.js:227`「…設定で登録者を選んでください。」）で呼び名がそろっていない。
- 理想個体の登録の各行に、同じ長い「未確認（セーブのどのプレイヤーが自分か分かりません。…）」が並ぶ（`views/ideal.js:143`。C-06）。
- ワールドの登録モーダル（`openWorldDialog` `:65-183`）: ① はプレースホルダーだけ（`:75-78`）で、エクスプローラーで開く場所は OPERATIONS.md にしかない（C-23）。正しい形のパスを貼っても文が出ない（② の枠の薄さが変わるだけ。C-24）。パスの欄とファイルの一覧は等幅で `\` が `¥` に見える（`app.css:878`・`:869`）。ドロップを受けるのは高さ 64px の枠だけで、ページは dragover・drop を止めていない（枠の外に落とすとブラウザが .sav を開く）。モーダルは背景のクリックで閉じる（`:67` に `closeOnBackdrop` の指定がない＝既定の true。C-26）。チェックリストは常にホスト用（`:116-119`。C-28）。確定ボタンは「保存」だが、登録すると共有と自動登録も始まる（C-29）。
- `test/import.test.js:32-34`: `auto-breeding.js` を読めるのは `auto-register.js` と `views/owned-settings.js` だけで、設定は `import { mappedUser } from '../core/auto-breeding.js'` の形でなければならない。
- モック: `app.js:47` は `createDevelopmentApi({ seed })` だけを渡す。`dev/mock-api.js:26` の `ownedWorlds` は空で始まる。

### 実装の手順
1. **役割ごとの 1 行**（`ui/owned-status.js` に足す）
   ```js
   export function roleSummary(state, { userId, now = Date.now } = {}) {} // → { text, kind: 'info' | 'warning' } | null
   ```
   - ホスト: 「このページを開いている間（タブが裏でもよい）1 分ごとにセーブを読みます。閉じている間に孵化したタマゴは登録できません。」
   - 参加者（`role === 'guest'`）: 「この PC では読み込みません。配合牧場の自動登録は {ホスト} の画面が行います（{ホスト} が自動登録をオンにしていて、あなたが登録者として対応づいているとき）· 最後の共有 3 分前」。{ホスト} は `meta.uploadedBy`（なければ `meta.hostName`、どちらもなければ「ホスト」）。最後の共有が 10 分より前なら `warning` にして「最後の共有は 2 時間前です。{ホスト} の画面が閉じていると、配合牧場の自動登録も止まります。」。
   - 未連携で共有を見ている人: 「{ホスト} が共有した所持パルを表示しています · 最後の共有 3 分前」。共有がなければ `null`（「セーブ未登録」の案内は copy-dead-ends の setupHint に任せる）。
   - 経過時間の言い方は header-frame の同期状況と同じ部品を使う。追記（header-frame の実装、2026-10-12）: header-frame は経過時間を出さず（G-18 の判断）、短い時刻 `formatShortTime(value, now, fallback)`（ui/dom.js。今日なら 時:分、違う日なら 月/日 時:分）を足した。経過時間を出すならここで足す。
   - 使う所: 設定の参加者のワールドの行（`owned-settings.js:224` を差し替え）、ホストのワールドの行（チェックの下）、所持パルの案内（`ownedNotices` の `:53-56` を差し替え）、ヘッダーの状態のポップオーバー（header-frame。役割の説明の欄）。
2. **名前が合わないとき**（X-07 の判断）: 参加者・未連携の人で、共有の players（`owned.state.owned.players`）に、ログイン中の ID と同じ名前（`userIdKey` で比べる）のプレイヤーがいないときだけ、手順 1 の参加者の文の下に 1 行: 「このワールドに「Bob」という名前のプレイヤーがいません（Alice・Carol・ぼぶ）。あなたが親 2 体を預けた配合は、ホストに設定の「プレイヤーの対応」で Bob を選んでもらうまで登録されません。」。「このワールドでの自分」（participant-self）を選んでも、ホストの対応は変わらないことを（ ）で添える。一致したときは何も出さない。
3. **プレイヤーの対応を独立した欄に**（C-03・C-04）
   - セーブ連携のカードの「使うワールド」の下に、小見出し「プレイヤーの対応（セーブのプレイヤー → ノートの名前）」の欄を置く。中身は今の `breedingPanel` のプレイヤーの部分（`:242-256`）を切り出したもの。説明は 1 行「配合の自動登録の登録者と、理想個体の『自分の個体』に使います」。autoreg-visibility の「登録待ち n 件」もこの欄の上に移す。
   - 出すのは**この PC がホストで、表示中のワールドのプレイヤーが分かるとき**だけ（自動登録はホストの PC でしか動かないので、参加者がここで選んでも登録には効かない）。参加者には代わりに「プレイヤーの対応はホストの PC で設定します」と、participant-self の「このワールドでの自分」を案内する。読み込む前は「このワールドを読み込むと、プレイヤーの対応を選べます」（`:239` の言い換え）。
   - ワールドの行の中（`breedingPanel`）には、自動登録のオン・オフだけを残す。
   - **この欄は `views/owned-settings.js` の中に置く**（`mappedUser` の import をほかのファイルに移すと `test/import.test.js:32-34` を直す必要がある。どうしても分けるなら、テストの許可リストを変更記録つきで直す）。
   - 呼び名をそろえる: `auto-register.js:227` の未設定の通知の本文を「{名前}の配合を登録できません。設定の「プレイヤーの対応」で選んでください。」（60 字を超える名前は `clip` で省かれる）、`views/ideal.js` の案内（participant-self で直した文）・`docs/OPERATIONS.md:62,130,132` の「登録者の対応」を「プレイヤーの対応」に。
4. **理想個体の「未確認」を 1 回だけ**（C-06）: 目標の行（`goalStatus` `views/ideal.js:141-149`）は「未確認」だけにし、理由は目標のダイアログの表の上に 1 回だけ「自分のプレイヤーが分からないため、完成を確かめられません［設定で選ぶ］」（participant-self の行き先。追記 2026-10-15: 今は意図つきの `settingsHash(worldId, 'self')`〔`#/settings?world=<id>&open=self`〕。所持パルのデータがない「未確認」は `settingsHash(worldId, 'status')`。phase-1d の「フェーズ 1d の終わりのレビューの直し」の 6）。所持パルのデータがない「未確認」も同じく 1 回だけ。
5. **ワールドの登録モーダル**（`openWorldDialog`）
   - C-23: ① の下に「エクスプローラーのアドレス欄に `%LOCALAPPDATA%\Pal\Saved\SaveGames` を貼ると開けます」＋［コピー］（`navigator.clipboard.writeText(SAVE_ROOT)`。失敗したらトースト「コピーできませんでした」）。
   - C-24: パスを読み取れたら入力欄の下に「✓ Steam 7656…1234 ／ ワールド ABCD…」、読み取れなければ赤字で「…\SaveGames\<数字>\<32 桁の英数字> まで含めて貼ってください」（空欄のときは何も出さない）、登録済みのワールドの ID なら「登録済みのワールドです（ファイルを足します）」。この行も固定の高さ。パスの欄とファイルの一覧の等幅をやめる（`app.css:878`・`:869`）。
   - C-26: `openDialog(…, { closeOnBackdrop: false })`。ダイアログ全体をドロップ先にし（枠は目印として残す）、開いている間は `window` の `dragover`・`drop` を `preventDefault`（AbortController で、閉じたら外す）。
   - C-27・C-28 の判断: チェックリストを 2 つの組に分けた入れ子のリストにする（SVG は使わない）。「全員: LocalData.sav」と「ホストの PC だけ: Level.sav・LevelMeta.sav・Players\（中のファイル全部）・GlobalPalStorage.sav（任意）」。settings で入れた実際のパスの表示を、`<Steam ID>`・`<ワールド ID>` の置き換えに使う。LocalData.sav だけをドロップして参加と判定したら（`previewed.kind !== 'host'`）、ホストの組を薄くして「参加として登録できます」。✓／— と `.done` の色は今のもの。
   - C-29: 新規の登録のとき、保存のボタンの左に「登録すると、読み込み・所持パルの共有・配合の自動登録（ホストのとき）を始めます」、ボタンの名前を「登録して連携」（編集のときは「保存」のまま）。
6. **モックの役割の切り替え**（X-12 の判断）
   - `app.js:47` で `createDevelopmentApi({ seed, as: new URLSearchParams(location.search).get('as') })` を渡す（`app.js` に「mock」の文字を書かない。`test/static/security.test.js:34-44`）。
   - `dev/mock-api.js`: `as === 'viewer'` のとき、`ownedWorlds` に固定の共有ワールドを 1 つ入れる（3 人・拠点 2・牧場 3・パル 30 体程度。行の形は `OWNED_FIELDS`、world の形は `:156-160` の `ownedUpload` と同じ）。`host`・`guest` は、ファイルのハンドルのスタブが要るので、必要になってから足す（このテーマでは作らない）。
   - `test/web` に、`ownedNotices`・`roleSummary` へ役割（host／guest／共有だけ）と `linkLabel`・データの有無の組み合わせを渡すテストを足す: データがあるのに「セーブのファイルが登録されていません」が出ない、参加者に「自動登録は動きません」「設定タブの『登録者の対応』」が出ない。開発用なので release-notes は不要（このテーマの release-notes は手順 1〜5 の分）。

### 触るファイル
- 変更: `web/js/ui/owned-status.js`、`web/js/views/owned-settings.js`、`web/js/views/ideal.js`、`web/js/auto-register.js`（未設定の通知の本文）、`web/js/app.js`（`as` を渡す）、`dev/mock-api.js`、`web/css/app.css`、`web/js/release-notes.js`、`docs/OPERATIONS.md`

### テスト
- `test/web/owned-view.test.js:408`（「参加しているワールドなので、自動登録は動きません」）→ 参加者の新しい文。プレイヤーの対応の欄がワールドの行の外に出たこと（ホストで表示中のワールドのときだけ）・参加者には出ないこと。ワールドの登録モーダル（`:315-` の登録のテスト）: パスの判定の文・登録済みの文・2 組のチェックリスト・参加のときの薄い組・「登録して連携」・背景のクリックで閉じないこと。
- 新規（`test/web/owned-view.test.js` か新しいファイル）: `roleSummary` の 3 役割と 10 分の境目、名前が合わないときの 1 行（一致・同じ名前が 2 人・共有なし）。
- `test/web/auto-register.test.js`: 未設定の通知の本文（別プラン §9 の C の `:235,241` 付近）。
- `test/web/ideal-view.test.js`: 目標の行は「未確認」だけ、理由は表の上に 1 回。
- `test/web/mock-api.test.js`: `as=viewer` で共有ワールドが 1 つ返ること。`test/import.test.js:32-34` が通ること（対応の欄を owned-settings.js に置いたまま）。

### INV-2・互換・セキュリティ・性能の注意
- INV-2: `mappedUser` の import の場所を変えない（`test/import.test.js:32-34`）。設定は配合表を使わない。
- 互換: プレイヤーの対応の保存（`${namespace}.autoBreeding.players.<env>.<worldId>`）は変えない。欄の場所と呼び名だけが変わる。
- セキュリティ: クリップボードには定数の文字列だけを書く。パスの判定の文に、貼った文字列を出すときは `textContent`。モックのコードは `web/` に入れない（`dev/` のまま）。

### release-notes の案
- id: `<実装日>-roles`／title: 「参加者向けの案内を改善」（11 字）／body: 「自動登録はホストの画面が行うことと最後の共有を出し、ワールドの登録の手順を役割ごとに示します。」（47 字）

### 完了の条件
- [x] `npm test` が通る（`import.test.js`・`security.test.js` を含む）。
- [x] `?mock=1&seed=80&as=viewer` で、未連携で共有を見ている人の所持パル・理想個体・設定を撮れる。「自動登録は動きません」「設定タブの『登録者の対応』」がどこにも出ない。
- [x] ホストの設定でプレイヤーの対応がワールドの行の外に出ていて、呼び名が理想個体・通知・設定でそろっている。
- [x] ワールドの登録モーダルで、正しいパス・違う形のパス・登録済みのパスを貼るとそれぞれの文が出て、モーダルのどこにドロップしても受け取り、背景のクリックで閉じない。
- [ ] 実機（参加者の PC）で、参加者の文と最後の共有の時刻が出る（撮影で確かめられなかった画面）。（**未。実機での確認が要る。モックの as=viewer とテストでは確かめた**）
- [x] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — プレイヤーの対応の保存キー（`autoBreeding.players.<env>.<worldId>`）を変えていない。INV-2 — `mappedUser` の import の場所を変えていない（`test/import.test.js:32-34`）。セキュリティ — クリップボードには定数だけを書き、貼った文字列は textContent。モックのコードは `web/` に入れていない（`test/static/security.test.js`）。性能 — 対象外。

### TODO
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

### 実装の記録（2026-10-15、ブランチ `feature/roles`）

実装のときに決めたこと・文書と違う形にしたこと（フェーズ 3 以降はこちらを正とする）。

1. **役割ごとの 1 行（手順 1）**: ui/owned-status.js に **`roleSummary(state, { userId, now })` → `null | { text, kind, hint }`**・**`HOST_SUMMARY`**・**`guestAutoText(host)`**・**`timeAgo(value, now)`**（「たった今」「3 分前」「2 時間前」「4 日前」。header-frame は経過時間を出さないので、ここで足した）・`SHARED_STALE_MS`（10 分）。参加者の文の括弧書きは、文書の「あなたが登録者として対応づいているとき」を、呼び名をそろえて「**プレイヤーの対応であなたが選ばれているとき**」にした。10 分ちょうどは info、超えたら warning（「最後の共有は 11 分前です。{ホスト} の画面が閉じていると、配合牧場の自動登録も止まります。」）。共有を見ているだけの人は「{ホスト} が共有した所持パルを表示しています · 最後の共有 3 分前」（古ければ warning）。使う所:
   - 設定のホストのワールドの行: 自動登録のチェックの下に `p.owned-role-note`（`HOST_SUMMARY`）。
   - 設定の参加のワールドの行: 前の「参加しているワールドなので、自動登録は動きません。」を `guestAutoText()` に（行ごとのホスト名は分からないので「ホスト」）。
   - 所持パルの案内（`ownedNotices(state, { userId, now })`）: 参加者でデータがあれば役割の 1 行（名前が合わないときは `hint` の 2 行目）。データがなければ前のとおり「ホストがまだ…共有していません。」。**共有を見ているだけの人には所持パルの案内を出さない**（文書の使う所が参加者だけのため。ヘッダーで見られる）。
   - ヘッダーのセーブ連携のポップオーバー: 「この PC」の行を役割の 1 行（と 2 行目）に（前は `roleLabel` の括弧書き）。
2. **名前が合わないとき（手順 2）**: `roleSummary` の `hint`。参加者・共有を見ている人で、共有の players にログイン中の ID と `userIdKey` で同じ名前の人がいないときだけ（players が空なら出さない）。名前は 5 人まで「・」でつなぎ、多ければ「ほか」。
3. **プレイヤーの対応（手順 3）**: views/owned-settings.js の中に `section.owned-players`（「使うワールド」の下、「このワールドでの自分」の上）。見出し「プレイヤーの対応（セーブのプレイヤー → ノートの名前）」と説明「配合の自動登録の登録者と、理想個体の「自分の個体」に使います。」、登録待ち（`div.owned-pending`。autoreg-visibility から移した）、プレイヤーごとの select。**select の読み上げの名前を「Alice の登録者」から「Aliceのノートの名前」に変えた**（「登録者」は配合を登録した人の意味だけに残す。C-04）。出すのはこの PC がホストで読み込んでいるワールドがあるとき（プレイヤーがまだ分からなければ「このワールドを読み込むと、プレイヤーの対応を選べます。」）、参加者には「プレイヤーの対応はホストの PC で設定します。自分の個体は「このワールドでの自分」で選べます。」、それ以外（共有を見ているだけ・自動登録のない文脈）は隠す。ワールドの行の中（`breedingPanel`）は自動登録のオン・オフだけ。設定の行き先（registrant・auto）は、この欄の未設定の select へ移す（そのワールドを読み込んでいるときだけ。行も開く）。行の署名から players・mapping を外し、欄は自分の署名で作り直す。`mappedUser` の import は owned-settings.js のまま（`test/import.test.js`）。
   - 呼び名: 自動登録の未設定の通知の本文を「{名前}の配合を登録できません。設定の「プレイヤーの対応」で選んでください。」（前に保存した通知の本文はそのまま）。docs/OPERATIONS.md の「登録者の対応」も直した。理想個体の案内は participant-self で「設定で選ぶ」になっていて「登録者」の語がないので変えていない。
4. **理想個体の「未確認」（手順 4）**: `goalStatus` は「未確認」だけを返し、行ごとの行き先のボタンをなくした。目標のダイアログの表の上に `p.ideal-goals-reason`（role=status）を 1 回だけ: 自分のプレイヤーが分からない →「自分のプレイヤーが分からないため、完成を確かめられません。」と［設定で選ぶ］（`settingsHash(worldId, 'self')`）、所持パルのデータがない →「所持パルのデータがないため、完成を確かめられません。」と［セーブ連携を開く］（`'status'`）。リンクのクラスは前の `ideal-goal-action` のまま（押すとダイアログを閉じる）。
5. **ワールドの登録モーダル（手順 5）**:
   - C-23: ① の見出しの下に「エクスプローラーのアドレス欄に %LOCALAPPDATA%\Pal\Saved\SaveGames を貼ると開けます」と［コピー］（aria-label「セーブのフォルダの場所をコピー」。`navigator.clipboard.writeText(SAVE_ROOT)`。成功は「コピーしました」、使えない・失敗は「コピーできませんでした」）。
   - C-24: パスの欄の下に `p.owned-path-status`（1 行分の高さを保つ）。読み取れたら「✓ Steam 7656…1234 ／ ワールド ABCD…」（Steam ID は 10 字を超えたら頭 4 字と末尾 4 字）、登録済みのワールドなら後ろに「（登録済みのワールドです。ファイルを足します）」、形が違えば赤字で「…\SaveGames\<数字>\<32 桁の英数字> まで含めて貼ってください」。読み取れないパスのまま書き換えたときも入力のたびに合わせる。パスの欄とチェックリストの等幅をやめた。
   - C-26: `openDialog(…, { closeOnBackdrop: false })`。ダイアログ全体に dragover・drop（枠に落とした分は枠が受け取るので二重に数えない）。開いている間は window の dragover・drop を `preventDefault`（AbortController。閉じたら外す）。
   - C-27・C-28: チェックリストを入れ子の 2 組（`li.owned-draft-group` と `span.owned-draft-title`・`ul.owned-draft-items`）。「全員」（LocalData.sav）と「ホストの PC だけ」（Level.sav・LevelMeta.sav・Players\・GlobalPalStorage.sav〔任意〕）。LocalData.sav だけで参加と判定したら、ホストの組に `is-dim` と見出し「ホストの PC だけ（参加として登録できます）」。settings で入れた実際のパスの表示はそのまま。
   - C-29: 新しく登録するとき、フッターの左に「登録すると、読み込み・所持パルの共有・配合の自動登録（ホストのとき）を始めます」、確定のボタンを「登録して連携」（編集は「保存」のまま）。
6. **モックの役割の切り替え（手順 6）**: app.js が `createDevelopmentApi({ seed, as })` を渡す（「mock」の語は書いていない）。dev/mock-api.js の `as === 'viewer'` で、ホスト Alice が 3 分前に共有したワールド「みんなのワールド」（**`VIEWER_WORLD_ID`**。3 人・拠点 2・牧場 3・パル 30 体。行は `OWNED_FIELDS`、検証は `validateOwnedUpload` を通す）を入れる。host・guest は作っていない。
7. **テスト**: 1,571 → 1,574 件（`npm test` exit 0。`import.test.js`・`security.test.js` を含む）。owned-status.test.js（`roleSummary` の 3 役割・10 分の境目・名前が合わないとき〔全半角・空〕・`timeAgo`・参加者の所持パルの案内に「自動登録は動きません」「登録されていません」が出ない）、owned-view.test.js（ホストの行の 1 行・プレイヤーの対応の欄が行の外・参加の行の文・登録待ちの場所・select の名前・登録モーダルのパスの判定と 2 組・「登録して連携」と添え書き・［コピー］・登録済みの判定・背景で閉じない・ダイアログへのドロップ・参加のときの薄い組）、ideal-view.test.js・app.test.js（「未確認」と表の上の理由）、auto-register.test.js（未設定の通知の本文）、mock-api.test.js（`as=viewer`）。
8. **登録モーダルの書体と高さ（画面の確認で直した）**: 等幅をやめても、日本語の書体（BIZ UDPGothic など）は `\` を `¥` で描くので、パスの欄・場所の案内・判定の 1 行・チェックリストは英字の書体（Segoe UI・Arial）を先にした。パスを貼るとチェックリストに実際のパスの行が増えてダイアログが高くなり、中央寄せで上に 42px 動いたので、**パスを貼る前も各行に書き方（`…\SaveGames\<Steam ID>\<ワールド ID>\Level.sav`）を出す**ようにした（空・形の違うパス・正しいパスで、ダイアログの部品の位置が同じことを測った）。
9. **画面（モック・1100×900）**: `http://127.0.0.1:5191/?mock=1&seed=80&as=viewer`（注入した所持パルのないオリジン）に ID「Dave」でログインして所持パルを開くと、共有ワールド「みんなのワールド」の 30 体（所持パルの案内は出ない）。ヘッダーのセーブ連携の「この PC」に「Alice が共有した所持パルを表示しています · 最後の共有 3 分前」と「このワールドに「Dave」という名前のプレイヤーがいません（Alice・Bob・Carol）。…」（`61`〜`63`）。設定はプレイヤーの対応の欄を出さず「このワールドでの自分」に Alice・Bob・Carol（`64`）。登録モーダルでパスの判定の 3 つの文・2 組のチェックリスト・「登録して連携」と添え書き・背景のクリックで閉じない（`65`・`66`）。
   - **確かめていないこと**: モックに登録したワールドがないので、ホストの設定のプレイヤーの対応の欄・ホストの行の 1 行・参加者（role が guest）の所持パルの案内はブラウザでは確かめていない（テストで確かめた）。実機（参加者の PC）での参加者の文と最後の共有の時刻は未確認（完了の条件の「実機」の項目）。
   - 画面の確認の途中、長く使ったブラウザのタブで描画（requestAnimationFrame）が止まり、撮影・クリックが進まなくなった。新しいタブ・ブラウザの開き直しで直り、roles の前の版でも同じタブでは止まったので、アプリの不具合ではない（記録のみ）。
10. **後のテーマへの申し送り**:
    - フェーズ 4 の save-extras: 参加者にも接続中の仲間・Day・Lv を出すときは、`roleSummary` の 1 行の後ろに足す。
    - ホスト・参加者のモック（ファイルのハンドルのスタブ）は、必要になったら dev/mock-api.js の `as` に足す。

---

## 判断が要る点・統合プランとの違い（まとめ）

実装の前にコードと案を照らして分かったこと。既定は「推奨」のとおりに進め、ユーザーが違う指示をしたらそれに従う。

| # | 点 | この文書の扱い（推奨） | 根拠 |
|---|---|---|---|
| 1 | owned-overlay の順番 | find-merge の直後（2 番目）に移した | register-dialog の参照列（F018）と goals-merge の目標の行が `ownedCounts` を使う |
| 2 | 継承ルートの開始チップの上限 8 件（R-08） | 入れない（全部出す） | `docs/OPERATIONS.md:99`「継承ルートの候補は、件数が多くても最初から全部出す」（98b7962）と衝突しうる |
| 3 | 継承ルートの「すべて」で先頭の候補の経路を「おすすめ」で出す（R-01 の 3) ） | 入れない | R-01 の判断が「『すべて』の意味が変わるのでユーザーに確認」としている |
| 4 | 「性別条件は未検証」 | 継承ルートで「同じ組で別の子も登録あり」と「性別の向きは未確認」に分けて残す。理想個体（`core/ideal.js:178-180`）は変えない | Codex のプランレビュー 1 回目 16「警告は残す」と統合プランの要点。R-25 の判断（multiChild だけにする）は採らない |
| 5 | 目標の観測の通知の範囲 | 観測はすべての目標の種族で持ち、通知は「種族だけの目標」がある種族だけ | 統合プランに指定がない。ウィッシュリストと同じ意味にとどめ、パッシブつきの目標に通知を増やさない |
| 6 | 移行の「旧通知の既読を新しい id へ写す」 | 新しい通知も旧と同じ id の形で出すので、写す作業は要らない（id を変えるなら写す手順を入れる） | 既読は id で判定する（`notifications.js:54-57`）。CLAUDE.md の「id は一度出したら変えない」とも合う |
| 7 | オブジェクトの形の保存キー（下書きの性別・目標の観測）の名前の変更 | `moveUserStorage` にオブジェクトの移動を足す | 今は配列でないキーを飛ばす（`user-rename.js:50`） |
| 8 | R-15 の「isParentCandidate を core/ideal.js から import」 | 採らない。同じ規則の `canBeParent` を core/owned.js に持つ | `test/import.test.js:38-44`（core/ideal.js を読めるのは views/ideal.js だけ）。統合プランの owned-overlay も「core/ideal.js は流用しない」 |
| 9 | 継承ルートの開始候補からタマゴ・グローバルを外す（R-15） | 入れる（`docs/OPERATIONS.md:97` を直す） | R-15 はテーマの案に入っていて、判断も採用。今の文書の規則が変わるので release-notes に書く |
| 10 | 下書きの行の中でパルを選ぶ形 | やめて読み取り専用にする（F020）。行の中で選ぶ前提のテスト（`drafts.test.js:122-146`・`:307-354`）は書き換え | 統合プランの「行は式＋登録・編集・削除」 |
| 11 | プロジェクトの CLAUDE.md の書き換え | bell で直す。Edit が拒否されたらユーザーに文案を渡す | グローバルの規約「評価基準の保護」で CLAUDE.md の Edit が拒否されている可能性 |
| 12 | 「この端末だけ」と「この端末のみ」 | 「この端末だけ」に統一 | 統合プラン内で両方の言い方がある（F020・F081） |
| 13 | 案の判断と統合プランの食い違い（G-04・G-06・S-25・S-31・G-20・G-21・G-26・C-14・D-16・D-43・S-02） | 統合プランの要点が優先（各テーマの「経緯」に書いた） | 案は検証の後に、別プランとの突き合わせ・ユーザーの決定・Codex のレビューを経て統合プランに入った |

## フェーズ 2 の終わりのレビューの直し

フェーズ 2 の終わりのレビュー（Codex 8 件〔読み取り専用〕・観点別のエージェント 3 体〔安定性・互換・操作性〕・計測）の指摘を、重なりを除いて 31 項目にまとめた。差分とレビューの出力は `Claude outputs/ui-audit-2026-10/phase-2-review/`（`diff-web.patch`・`diff-test.patch`・`codex.md`・`measure/`・`ux/`）。直しは 2 本のブランチで、どちらも統合ブランチ `integrate/phase-2` へ --no-ff でマージした。細かな UI・文言はユーザーの指示（D27）のとおり聞かずに決めた。

### データと振る舞い（2026-10-15、ブランチ `fix/phase-2-review-data`）

1. **端末のデータの読み込みで palId が `constructor` の目標が通り、観測の辞書の継承したプロパティを拾って例外になる（高。Codex 1）**
   - 原因: `cleanGoal`・`cleanObservations` は palId の形（英数字と `_`）だけを見ていたので、`constructor`・`__proto__`・`toString` などが通った。`observations.species[palId]` が `Object.prototype` の関数を返し、`entry.found` で例外（読み込んだ後は起動のたびに続く）。
   - 直し: core/ideal-goals.js と core/goal-observations.js に **`palIdOk(id)`**（形が合い、`Object.prototype` の自分のプロパティの名前でない）を置き、目標の palId・パッシブ・観測の種族・移行の記録・組（`cleanPair`）に使う。device-data.js の読み込み（`parseDeviceData`）は、**マスターにないパルの目標も外す**（名前も画像も出せず、完成も確かめられないため）。辞書を palId で引く所（`mergeObservationSpecies`・`goalObservationSource`）は `Object.hasOwn` で自分のプロパティだけを引く。
   - テスト: goal-observations.test.js・ideal-goals.test.js（組み込みの名前を外す）、device-data.test.js（constructor・toString・マスターにないパルの目標を外し、constructor を含む種族の一覧で併せても例外にならない）。
2. **子だけを選んで 0 件のまま子を変えると、「目標に登録」が前の子を登録する（中。Codex 2）**: syncList は同じ文の空の表示を使い回すので、文に子の名前を入れた（「キツネビの配合はまだ登録されていません。」）。押しボタンは文が変わると作り直される。テスト: app.test.js（2 体の子を順に選び、押すと後の子だけが目標になる）・views.test.js の文。
3. **並べ替えで子を省いたカード（子ごとの群の下）を使い回し、群なしの並びでも子が出ない（中。Codex 3）**: 行のキーに `omitChild` を入れた。群の見出しのキーにも群の分け方（親・子）を入れた。テスト: views.test.js（親を選んで「子の図鑑番号順」→「更新日の新しい順」→ 戻す）。計測の layout-shift（群分けの並びどうしで 0〜0.2006。並べ替えの直後の利用者の入力による変化）は直しの後は測り直していない。
4. **端末のデータでプレイヤーの対応を取り込んでも、本人の変化を知らせない（中。Codex 4）**: 1 件以上足したら `context.self.changed()`（なければ `ideals.identityChanged()`。設定の select と同じ）。あわせて、知らないワールドの対応で取り込みを止めていた `break` を `continue` にした。
5. **取り込みで既読を当ててから自動登録の記録を足すので、復元した通知が未読で残る（中。Codex 5）**: 自動登録の記録を先に足し、その後で未読の一覧から既読を当てる。
6. **自動登録の記録の取り込みが今の通知を押し出し、足した数を多く数える（中）**: auto-register.js の **`fitNotices(current, incoming, cap)`**（今の通知を全部残したまま、取り込む通知を新しい順に 1 件ずつ、上限〔既存のキーは 50 件・成功は `capRegistered`〕に入る分だけ足す）。`importNotices` は **`{ added, skipped }`** を返し、設定の結果の文に「（自動登録の記録 N 件は重複・上限で取り込みませんでした）」を出す。テスト: auto-register.test.js（49 件の端末に新しい 3 件 → 1 件だけ入り、今の 49 件は残る）・views.test.js（取り込みの順番・本人の変化・入らなかった数の文）。
7. **戻る・進むでキーワードの欄と検索の条件が食い違う（中。Codex 6）**: `applyRoute` の reason が `update` 以外（`history`・`navigate`・`tab`・`boot`）なら、待っている入力を捨てて（`typed.cancel()`）フォーカスがあっても欄を URL に合わせる（自分の入力による `update` では今までどおり上書きしない）。テスト: views.test.js。
8. **継承ルートの「ほか N 体」を閉じていても全行を同期で作る（中。Codex 7）**: 開いたとき（details の `toggle`）に作り、閉じたら外す。作るのは **100 行まで**（`CARRIERS_MORE_MAX`）で、残りは「ほか N 体は「所持パルで開く」で見られます。」（`p.route-owned-more-note`）。テスト: owned-view.test.js（閉じたままは 0 行、開くと 2 行、閉じると 0 行）。
9. **目標の通知「配合が登録されました」の本文が、削除された組を指す（中）**: 観測の `pairs` は一度見た組を残す（重ねて知らせないため）。本文の組は今の確定データから作る（ideals に **`pairsOf(palId)`** を公開）。テスト: ideals.test.js。
10. **G-22（既読の記録のない ID はお知らせを既読から）が、既読の記録を持たずに前から使っている人にも効き、フェーズ 2 のお知らせが全部既読になる（低）**: 直近 7 日のお知らせは未読のまま（`createNotificationStore({ now })`。既定は `Date.now`）。新しく使い始めた人にも直近 7 日の分は未読で出る（決めたこと）。テスト: notifications.test.js（時刻を渡して 7 日の境目）、app.test.js（時刻を固定。`t.mock.timers` の `Date`）。
11. **端末のデータの書き出した ID を整えずに比べる（低）**: `validateUserId` で整え、`userIdKey` で比べる（全半角・大文字小文字の違いだけなら同じ人）。ID にならない値は知らせない。テスト: device-data.test.js。
12. **前のウィッシュリストの移行が上限で partial のまま、目標を外しても移らない（低）**: 外した後に移行が partial なら、次のマイクロタスクで `migrate(true)`（繰り返しても同じ結果の移行）。テスト: ideals.test.js（100 件の目標と前のウィッシュリスト 1 件 → partial、1 件外すと done）。
13. **「目標に登録」のダブルクリックで登録してすぐ外す（低）**: クリックの `detail` が 2 以上なら捨てる（下書きの行と同じ）。テスト: app.test.js。

### 画面と文言（2026-10-15、ブランチ `fix/phase-2-review-ui`）

16. **所持の印のクラス `.owned-count` が、所持パルの数の行 `p.result-note.owned-count` と衝突していた（中）**: 印は **`.owned-tally`**（数は `.owned-tally-num`。数は本文の色 `on-surface`）に改名した。CSS（`.editor-owned` を含む）・テストも合わせた。
17. **配合を探すで、フォーカスした部品が sticky の帯の下に隠れる（中）**: `.find-view` の帯と見出し以外の子孫に `scroll-margin-top: var(--panel-h)`（理想個体と同じ決まり）。
18. **下書きの帯を閉じたまま「すべて登録」で残った下書きの理由が見えない（中）**: 残ったら帯を開き（`onToggle(true)`）、最初に理由の出た行の「編集」へフォーカスを移す。どの下書きにも未選択の枠があれば「すべて登録」は押せず、理由「どの下書きにも未選択の枠があります。「編集」で親1・親2・子を選ぶと登録できます」。1 件も登録できなかったときの文は「登録できませんでした。N 件は理由を付けて下書きに残っています」（エラーのトースト）。テスト: drafts.test.js。
19. **「＋ 下書きに追加」のモーダルで Esc を押すと入力が黙って消える（中）**: 下書き版の新規（`draftId` なし）も閉じるときに下書きへ残す（トースト「下書きに残しました」と「破棄」）。新しく作るモーダルの「キャンセル」は、閉じても入力が下書きに残るので **「閉じる」** にした（配合・下書きの編集は変更を捨てるので「キャンセル」のまま）。テスト: record-editor.test.js。
20. **ショートカット N の案内がない・止める条件が広い（中）**: 配合を探すの見出しの登録のボタンとパル詳細の「この子の配合を登録」に `title`「キーボードの N でも開けます」と `aria-keyshortcuts="N"`。止めるのは、フォーカスのある部品が `aria-haspopup` で候補を開いているときだけ（開いた下書きの帯・details では止めない）。パル詳細では N でそのパルを子にして開く（`registerInitial`）。**切る設定はまだない**（WCAG 2.1.4。TODO の「次にやること」に書いた）。テスト: app.test.js。
21. **「目標に登録」と「目標として保存」の混在（中）**: 「☆ 目標に保存」「目標に保存済み」「★ 目標に保存済み」にそろえた（トーストも「目標に保存しました」）。文言のテストの使わない言い回しに「目標に登録」「目標として保存」を足した。
22. **「登録者の対応」「ノートの名前」（低〜中）**: 「プレイヤーの対応」「ノートの ID」にそろえ（端末のデータの確認の文・結果の文・プレイヤーの対応の欄の見出しと select の名前）、端末のデータの説明に「プレイヤーの対応」を足した。文言のテストに「登録者の対応」「ノートの名前」を足した。docs/OPERATIONS.md の呼び名も合わせた。
23. **ベルで最後の行・「すべて既読」の後にフォーカスが body に落ちる（低）**: パネルの見出し（`h2`、tabIndex −1）へ、通知一覧（見出しはダイアログの題名）では「未読だけ」へ移す。本文の `.notification-content:focus { outline: 0 }` は `:focus:not(:focus-visible)` にした（キーボードでは枠を出す）。テスト: notifications.test.js。
24. **「目標に保存」を押すとボタンの幅が変わり隣が動く（低）**: 文の span（`.goal-toggle-text`）に長い方の文を `data-size` で持たせ、CSS の `::after`（高さ 0・見えない）で幅を取る。画面で 150.70px のまま・隣の left 595.17px のまま（パル詳細）。
25. **警告があるあいだ設定のタブがいつも警告のカードへ行く（低）**: 設定を開いたときの警告（`JSON.stringify(store.state.warnings)`）を覚え、同じ警告のあいだは覚えた行き先へ。警告が変わったらまた警告のカードへ。テスト: app.test.js。
26. **目標のダイアログの「この端末だけ」が見出しの行の中央に浮く（低）**: `.dialog-header > .device-only-chip { margin-right: auto }`（題名の右 10px）。「配合: 登録済み N 件 →」は折り返さない。
27. 性別の押しボタンの title を「オス」「メス」に、継承ルートの所持パルのない案内のボタンを「セーブ連携を開く」に、「タマゴ等のみ」を「タマゴ等だけ」に（印と相手親の注記）。
28. 読み上げ: 下書きの行（「下書き: モコロン＋フラリーナ → セレムーン」）と行の操作（「下書き（…）を登録・編集・削除」。見た目の title は「編集」「削除」のまま）、所持の印（「ニャルルの所持: オス 3・メス 0」）にパルの名前を入れた。テストのアイコンのボタンは title で探す。
29. 隠したファイルの入力に `aria-hidden`、設定の件数の「既読」を「通知の既読」に。
30. 登録モーダルの確認の枠の `min-height` を 92px → 118px（警告 2 行分。計測で警告が出ると参照の列の中だけ +24.87px 伸びていた）。

更新内容の通知は 1 件（`2026-10-15-phase-2-fixes`「不具合と表記を直しました」）。

### 直さなかったもの・記録だけ

- 14（Codex 8。低）: 通知の画像の `palId` を、旧版のタブも読み書きする既存のキー（`autoBreeding.notices`）の通知にも保存している。旧版のタブが書き戻すと `palId` が落ち、その行の画像が種類の記号に戻るだけ（データは壊れない）。保存データの互換の決まり（3）の**例外として記録**し、直していない（別のキーに移すと既読・移行の手当てが要り、害に見合わない）。
- 15（互換。低）: **旧版のタブで ID を変えると**、旧版の `moveUserStorage` はこのフェーズで足したキー（`draftGenders`・`goalsObs`・`search.seenAt`）を知らないので移さず、前の ID のキーに残る。新しい ID では下書きの性別・目標の観測（次の判定で最初の観測からやり直す）・新着の基準が空から始まる。旧版のコードは直せないので手当てはない（フェーズ 1d の self のキーと同じ。配信の後に旧版のタブを開き直すまでの間だけ）。
- 31（記録だけ）: 幅 920px で配合を探すの帯の 2 段目が折り返す。下書きの全部登録の layout-shift 0.2589（押した直後の入力による変化）。登録モーダルの参照の列のリンク（`breedingEquation` と `ownedBadge`。押すとモーダルの裏の画面が移る）は、安定性の担当が直す候補に挙げた（フェーズ 3 の drawer で詳細を開く形にするときに合わせて見る）。
- フェーズ 2 より前から: ワールドの登録はドロップだけ（ファイルを選ぶボタンがない）・パル選択は Enter だけでは選ばれない。
- 未確認: 実機（参加者の PC）での参加者の文と最後の共有の時刻、本番の自動登録での配合の段の注意、旧版のタブと同時に開いたときの保存、通知が 98 件ある状態の画面（各テーマの「実装の記録」）。

### テストと画面

- `npm test`: exit 0・1,589 件すべて通過（1,574 件から 15 件足した）。`npm run test:perf`: 12 件すべて通過。
- 画面（モック `?mock=1&seed=80&as=viewer`・1100×900）: 所持の印 `.owned-tally` 160 個・`.owned-count` 0 個、印の数の色 rgb(23, 44, 43)。「目標に保存」⇄「目標に保存済み」で幅が変わらない。目標のダイアログの「この端末だけ」が題名の横。登録モーダルの下のボタン「閉じる・続けて登録・登録」、下書き版「閉じる・続けて下書きに保存・下書きに保存」、確認の枠 118px、性別の title「オス・メス・性別を記録しない」。撮影は `Claude outputs/ui-audit-2026-10/shots/find-merge/review-fix-01-search.png`〜`review-fix-04-editor.png`。
