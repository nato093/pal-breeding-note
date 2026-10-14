# 付録: 画面の撮影と実測の記録

> 2026-10-12 に、本セッションの UI 調査ワークフロー（`wf_9621e077-6e6`）の撮影担当 3 体（label が capture:find・capture:record・capture:owned）の結果から書き出した。**正は README と phase-*.md**。撮影は 2026-10-11 に、HEAD `ad648b7` のコードとモックのデータで行った（リポジトリは変えていないことを各担当が git status で確かめている）。

スクリーンショット 108 枚・スナップショット（アクセシビリティの YAML）19 件・計測 46 件・見つけた問題 64 件。ファイルはセッションの一時フォルダから `Claude outputs/ui-audit-2026-10/shots/<担当>/`（リポジトリ直下。git では未追跡で、.gitignore には入っていないので `git add -A` で入れないよう注意）へ、同じ名前のまま全部コピーした。下の記録の中のパスもコピー先に置き換えてある。

## モックでの再現の仕方

1. `npm run dev`（中身は `node scripts/dev-server.mjs`。GET だけを返す静的配信で、既定のポートは 5173（scripts/dev-server.mjs:42）。`PORT=5181 node scripts/dev-server.mjs` のようにポートを変えられる。撮影では 3 体が同時に動くよう 5181〜5183 を使った）。
2. ブラウザで `http://localhost:5173/?mock=1&seed=80` を開く。
   - `?mock=1` は localhost・127.0.0.1・[::1] のときだけ効き、開発用の API（`dev/mock-api.js`）に切り替わる（web/js/app.js:41-47）。保存の名前空間は `pal-note.local` になる（web/js/app.js:51）。
   - `seed=N` は架空の配合を N 件作る（dev/mock-api.js:126-128。登録者は「架空データ」）。撮影では 80（検索系）・40（記録系）・120（所持系）・700（結果が多いときのスクロールの計測）を使った。モックの配合は全件に同じメモが入り、親の性別はない。
3. ログイン画面の「新規登録」で、任意の ID とパスワードを入れる（撮影では Alice / test）。**モックはページを読み込み直すたびにユーザーと配合が作り直される**ので、読み込み直したら新規登録し直す（`shots/owned/login.js`・`shots/find/login.js`）。
4. 所持パル（セーブから読み込んだ一覧）は、IndexedDB に注入する。
   - 保存先: DB 名 `pal-note.local`（版 1）・object store `kv`・キー `pal-note.local.owned`（web/js/owned.js:17 の idbPersist、web/js/owned.js:136 の dataKey）。
   - 注入スクリプト: `Claude outputs/ui-audit-2026-10/shots/owned/inject.js`。プレイヤー 3 人（Alice＝ホスト UID …0001、Bob、Carol）・ギルド 1・拠点 2・138 体（実在の 22 種族＋アルファ＋人間 1 体。パッシブはランク 1〜5 と負のもの、個体値 0〜100、凝縮・ラッキー・スキル。場所は手持ち・パルボックス 1〜4 ページ・拠点・グローバル・パル次元・タマゴ）・配合牧場 3 か所（拠点 1 にアヌビスの組 2、拠点 2 にジェッドランの組 1。牧場の上にタマゴ）。乱数は固定の種（mulberry32）なので毎回同じデータになる。
   - `Claude outputs/ui-audit-2026-10/shots/owned/inject2.js` は、個体値 100 のアヌビス ♂♀ をパルボックスに足す（理想個体の「変更あり」の確認用。足した後に読み込み直す）。
   - 使い方: playwright-cli で `playwright-cli -s=<セッション> run-code --filename <ファイル>` として実行する（撮影ではこの方法）。手で行うときは、ファイルの中の `page.evaluate(async () => { … })` に渡している async 関数の中身を DevTools のコンソールに貼って実行し、ページを読み込み直す。データの形は web/js/save/palworld.js の buildSnapshot と web/js/owned.js の validData・recompute に合わせてある。
   - 注意: ファイルのハンドルを登録しないので、所持パルのタブの上部に「セーブのファイルが登録されていません」の案内が出る（実際のホストの画面とは違う）。ハンドル登録なしで local のデータが表示される。
5. 計測: 各フォルダの `measure.js`（find は `init-goto.js`）が `PerformanceObserver`（layout-shift、buffered）と計測関数（`window.__m(selectors)`／`window.__probe`）を入れる。返すのは scrollY・指定した領域の `getBoundingClientRect().top`・activeElement・layout-shift の合計と発生源。操作の前後で呼んで差を見た。DOM を丸ごと作り直す画面では layout-shift が 0 になるので、領域の top の差で判断した。Playwright の操作では hadRecentInput が false になる。
6. 後片付け: ブラウザを閉じ（`playwright-cli -s=<セッション> close`）、開発サーバを止める。

統合プランの「検証」の表（今の実測と目標）は、この記録の値から取ったもの。実装の後に、同じ操作で計り直して比べる。

## 担当と件数

| 担当 | 範囲 | seed | ポート | スクリーンショット | スナップショット | 計測 | 見つけた問題 |
|---|---|---|---|---|---|---|---|
| find | 検索系（配合検索・逆引き・継承ルート（所持パルなし）・一覧・パル詳細）＋ダークモード＋幅 1100px | 80（スクロールの計測は 700） | 5181 | 36 | 7 | 18 | 16 |
| record | 記録系とシェル（ログイン・下書き・ウィッシュリスト・設定・通知ベル・＋ 登録のモーダル・トースト） | 40 | 5182 | 38 | 6 | 16 | 23 |
| owned | 所持系（所持パル・理想個体・所持パルありの継承ルート・設定のセーブ連携） | 120 | 5183 | 34 | 6 | 12 | 25 |
| 合計 | | | | 108 | 19 | 46 | 64 |

## 撮影 find: 検索系（配合検索・逆引き・継承ルート（所持パルなし）・一覧・パル詳細）＋ダークモード＋幅 1100px

### 再現手順（setup）

ローカルの開発サーバ（PORT=5181 node scripts/dev-server.mjs。GET だけを返す静的配信で、何も書き込まない）をバックグラウンドで起動し、playwright-cli のセッション capfind（ヘッドレス）で http://localhost:5181/?mock=1&seed=80 を開いた。「新規登録」から Alice / test でログインし、1280x900 で撮影した。
最初に run-code の page.addInitScript で PerformanceObserver（layout-shift、buffered）と計測関数 window.__m(selectors) を入れた（scrollY・各領域の getBoundingClientRect().top・activeElement・layout-shift の合計と発生源を返す）。init.js を 2 回実行して二重登録になったため、一度ブラウザを閉じて init-goto.js で入れ直した。
多くの結果があるときのスクロール計測は ?mock=1&seed=700（700 件。親の最多は FairyDragon_Water の 12 件、子の最多は FoxMage_Dark の 8 件）で行った。ページを読み直すとモックのデータが作り直され、ID も消えるので、もう一度新規登録した（reseed.js）。スクロールが起きるよう、一部の計測はビューポートを 1280x600 または 1280x500 に縮めた。
使ったスクリプトはすべて Claude outputs/ui-audit-2026-10/shots/find/ にある（init-goto.js・login.js・picker.js・search-flow.js・reverse-flow.js・route-flow.js・route-scroll.js・list-flow.js・list-scroll.js・pal-flow.js・dark.js・w1100.js・reseed.js・search-scroll.js・detail-scroll.js）。
後片付け: playwright-cli -s=capfind close を実行し、TaskStop で開発サーバを止めた。curl は 000 を返し、停止を確認した。git status --porcelain は開始時と同じ（?? .mso/ .playwright-cli/ "Claude outputs/" のみ）で、リポジトリは変えていない。
注意: 実行中に「プランモード中」というシステム通知が出た。撮影の承認は親タスクの文面にしかなかったが、作業は権限システムの許可の範囲で行い、書き出し先はセッションの一時フォルダだけに限った。

### できなかったこと・注意（failures）

次のものはできていない、または対象外にした。
- 継承ルートを「所持パルがある状態」では撮っていない。役割が「所持パルなし」だったため。
- 登録のダイアログ、下書き・ウィッシュリスト・所持パル・理想個体・設定は、担当外なので撮っていない。
- 撮影はモックのデータだけで行った。モックは全件に同じメモが入り、性別もない。実データでのカードの高さや、メモの長さの影響は確かめていない。
- 継承ルートで selectOption を使ったとき、操作の後のフォーカスが目標の選択欄にあった。これが app.js の復元の不具合なのか、Playwright の selectOption が select にフォーカスを残さないためなのかは切り分けられていない。キーボード操作（ArrowDown）では select.passive-add にフォーカスが残ることを確認した。
- 一覧の矢印（→）の色が行によって違って見えた。スクリーンショットの描画のせいかどうか分からないため、問題には含めていない。
- 実行中に「プランモード中」というシステム通知が出た。撮影の承認は親タスクの文面にしかなく、ユーザー本人の発言としては確かめられなかった。作業は権限システムの許可の範囲で行い、書き出し先はセッションの一時フォルダに限った。リポジトリは変わっていない（git status で確認）。

### 計測（18 件）

| # | 画面 | 操作 | 結果 | 判定 |
|---|---|---|---|---|
| 1 | 配合検索 | 未選択 → 親1 を選ぶ（スクロールなし） | .card-stack の top: 223 → 250（件数の行「3 件の登録済み配合」が入って +27px）。layout-shift は 0（main を作り直すため、CLS には現れない）。フォーカスは親1 の選択欄へ戻った（button.picker-trigger [親1: No.117 ソルレイス]） | ずれた（27px。フォーカスは保たれた） |
| 2 | 配合検索 | 親1+親2 で結果あり → 親2 を別のパルにして結果なし | .card-stack の top: 250 → 223（件数の行が空になり -27px）。フォーカスは親2 の選択欄 | ずれた（27px） |
| 3 | 配合検索 | 親2 の × で解除（スクロールなし） | .card-stack の top は 250 のまま。フォーカスは button.picker-trigger [親2: パルを選択] へ移った | 保たれた |
| 4 | 配合検索 | seed=700・1280x600・親1（12 件）で scrollY=120 → 親2 を選ぶ（結果 1 件） | scrollY: 120 → 0。ページの高さ: 1157 → 600。フォーカスは親2 の選択欄 | ずれた（結果が減ってページが縮んだため。避けにくい） |
| 5 | 配合検索 | 親2 を × で解除（結果が 12 件に戻る） | scrollY は 0 のまま。ページの高さ: 600 → 1157 | 元の位置へは戻らない |
| 6 | 配合検索 | scrollY=400 で親1 の × を押す（× は画面の外なので Playwright が自動でスクロールして押した） | scrollY: 400 → 0（ページの高さ 1157 → 600）。フォーカスは親1 の選択欄 | ずれた（未選択の画面に戻るため妥当） |
| 7 | 配合検索 → パル詳細 | scrollY=500 でカードのパル名を押してパル詳細を開く | パル詳細の scrollY=364（ページの高さ 964）。.view-heading の top は -261。見出しと画像が画面の外にある | ずれた（新しい画面が先頭から始まらない。要修正） |
| 8 | 配合検索 → パル詳細 → 戻る | scrollY=400 でパル名を押し、パル詳細へ行ってブラウザで戻る | 戻った後の scrollY=400、.card-stack の top=-150（行く前と同じ） | 保たれた（ブラウザの復元） |
| 9 | 一覧 | scrollY=2500 で並べ替えを 親の図鑑番号順 → 子の図鑑番号順（select の値を変えて input を送る） | scrollY は 2500 のまま。ページの高さ: 11474 → 5899。画面の 300px の位置にあったカードは「ヨモギウサ＋ムラサメ→チョロゾウ」から「フユマル＋アズレーン→ブリザモス」に変わった | 位置の数値は保たれたが、見ていた内容は失われた |
| 10 | 一覧 | scrollY=2500 から並べ替えの select にフォーカスする（実際の操作の再現） | scrollY: 2500 → 0（select が画面の上にあり、固定されていないため） | ずれた（絞り込みの欄が sticky でない） |
| 11 | 一覧 | 登録者名に「架空」→「zzz」→ 空、と入力 | 入力欄のフォーカスと値は保たれた（一覧の中身だけを作り直している）。.card-stack の top は 253 で動かない。0 件のときページの高さは 900 | 保たれた |
| 12 | 一覧 | scrollY=2500 → 配合検索タブ → 一覧タブへ戻る | 並べ替えは child-dex のまま覚えている。scrollY は 0 | 並べ替えは保たれ、スクロール位置は保たれない |
| 13 | 継承ルート | 目標を選んだ後、パッシブを 1 個足す（スクロールなし） | .route-explanation の top: 300 → 344、.route-owned: 333 → 377（チップの行が select の上に入って +44px）。2 個目では同じ行に並び、ずれなし | ずれた（44px） |
| 14 | 継承ルート | Playwright の selectOption でパッシブを追加 | 操作の後の activeElement は button.picker-trigger [目標: …]（selectOption は select にフォーカスを残さないため、app.js の passive-add へのフォーカス復元が働かなかった可能性がある） | 参考値（下のキーボード操作で再確認した） |
| 15 | 継承ルート | 1280x500・scrollY=200 で、パッシブの select にフォーカスして ArrowDown を 1 回 | 押した時点で 2 個目のパッシブ（WorldTree_ATK＝神樹の苗床）が追加され、URL が p=Legend,WorldTree_ATK に変わった。scrollY は 200 のまま。フォーカスは select.passive-add のまま | 位置とフォーカスは保たれたが、キーボードで候補を見比べられない（1 回押すごとに追加される） |
| 16 | 継承ルート | scrollY=200 でパッシブのチップの × を押す | scrollY は 200 のまま。activeElement は body になった | フォーカスを失った |
| 17 | 共通 | ログイン直後（テスト環境） | layout-shift 0.2137（hadRecentInput=true）。発生源は main.app-main 61→83 と header.app-header 0→27。テスト環境の帯が後から入るため | ずれた（テスト環境だけ。本番に帯はない） |
| 18 | 配合検索・一覧・継承ルート | 幅 1100px で横のはみ出しを確認 | どの画面も scrollWidth=1100、innerWidth=1100。main の中で右端が画面を越える要素はない | 問題なし |

### スクリーンショット（36 枚）

ファイルは `Claude outputs/ui-audit-2026-10/shots/find/`。

| ファイル | 画面 | 状態 | 気付いたこと |
|---|---|---|---|
| [01-search-empty.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/01-search-empty.png) | 配合検索 | 未選択 | 親1・親2 の選択欄が横に並び、その下は案内文が 1 行あるだけ。画面の下半分は空いている。見出し「配合を見つけよう」とタブ名「配合検索」が一致しない。 |
| [02-search-picker-open.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/02-search-picker-open.png) | 配合検索 | パル選択のポップアップを開いた直後 | 幅 560px の 1 列リストで、見えるのは 7 体ほど。横幅の大半が空いている。属性や「登録あり」の印はない。先頭に「パルを選択」（解除）の行がある。 |
| [03-search-picker-hiragana.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/03-search-picker-hiragana.png) | 配合検索 | ポップアップで「みるふぃ」と入力 | ひらがなでミルフィーが 1 件だけ出る。ひらがな・カタカナ・半角カナ・英名・内部 ID・図鑑番号のどれでも探せる。 |
| [04-search-picker-dexno.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/04-search-picker-dexno.png) | 配合検索 | ポップアップで「8」と入力 | 部分一致なので 59 体が出る（8・18・28…）。完全一致の No.8 が先頭に来る。「030」のように頭に 0 を付けると 0 件になる。 |
| [05-search-p1-only.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/05-search-p1-only.png) | 配合検索 | 親1（ソルレイス）だけ選択・3 件 | 「3 件の登録済み配合」の行が出て、カードが 27px 下がる。どのカードにも親1 が繰り返し出る。カードの 3 列の間が広く空いている（1280px 幅で式の全幅は約 850px）。 |
| [06-search-p1p2-hit.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/06-search-p1p2-hit.png) | 配合検索 | 親1+親2 選択・結果あり（ソルレイス×ベラノワール） | カードは 1 件。親1 と親2 の入れ替えボタンはない（継承ルートには ⇄ がある）。 |
| [07-search-p1p2-miss.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/07-search-p1p2-miss.png) | 配合検索 | 親1+親2 選択・結果なし（ソルレイス×モコロン） | 「この組み合わせはまだ登録されていません」と登録ボタンが出る。件数の行が空になり、表示が 27px 上がる。 |
| [08-reverse-empty.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/08-reverse-empty.png) | 逆引き | 未選択 | 選択欄 1 つが全幅（約 1135px）に伸びている。 |
| [09-reverse-child.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/09-reverse-child.png) | 逆引き | 子（ハグミー）を選択・2 件 | 件数の行がない（配合検索にはある）。どのカードにも子が繰り返し出る。コラボのパルは「No.コラボ」と表示される。 |
| [10-route-empty.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/10-route-empty.png) | 継承ルート | 未選択（所持パルなし） | 見出し「スキルをつなぐ」がタブ名「継承ルート」と違う。運びたいパッシブは標準の select で、選択肢が約 100 個あり、検索もランク枠もない。説明文「この経路は…相手親は別途用意します」が未選択のうちから出ている。 |
| [11-route-target-only.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/11-route-target-only.png) | 継承ルート | 目標だけ選択 | 「開始と目標のパルを選んでください。」のまま変わらない。 |
| [12-route-target-passive-noowned.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/12-route-target-passive-noowned.png) | 継承ルート | 目標＋パッシブ「伝説」（所持パルなし） | 所持パルがなくてもパッシブを選べるが、経路には何も影響しない。かわりに 1 行の長い案内（設定タブの「セーブ連携」…）が出る。チップの行が選択欄の上に入り、下の要素が 44px 下がる。 |
| [13-route-from-to-passives.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/13-route-from-to-passives.png) | 継承ルート | 開始センコ→目標アズルーナ＋パッシブ 2 個（全体） | 最短 5 回の経路が 1 本出る。経路のカードには、選んだパッシブも相手親を用意するという注記もない。経路の段は 3 列で、間が広く空いている。 |
| [14-route-after-add-scrolled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/14-route-after-add-scrolled.png) | 継承ルート | 1280x500・200px スクロールした状態で、パッシブの select から矢印キーで追加した後 | 閉じた select にフォーカスして ArrowDown を 1 回押すと、その時点で「神樹の苗床」が追加された（候補を見比べられない）。スクロール位置は保たれた。 |
| [15-list-sort-parent-dex.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/15-list-sort-parent-dex.png) | 一覧 | 並び順: 親の図鑑番号順（--full-page） | 「80 件の配合 · 160 件を表示」。1 件の配合が親ごとに 2 回出るため、ページの高さは 11474px（子の並びでは 5899px）。 |
| [16-list-sort-parent-name.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/16-list-sort-parent-name.png) | 一覧 | 並び順: 親の五十音順 | 見出しや区切りがなく、同じ親がどこまで続くか分からない。1 画面に見えるのは 9 件ほど（カード 1 件の高さ約 70px）。 |
| [17-list-sort-child-dex.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/17-list-sort-child-dex.png) | 一覧 | 並び順: 子の図鑑番号順 | 80 件をそのまま表示する。 |
| [18-list-sort-child-name.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/18-list-sort-child-name.png) | 一覧 | 並び順: 子の五十音順 | 子の並びでもカードの左は親で、並べ替えの基準になっている子は右端にある。 |
| [19-list-sort-updated.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/19-list-sort-updated.png) | 一覧 | 並び順: 更新日の新しい順 | 更新日時はカードの右に小さく出るだけで、日付ごとの区切りはない。 |
| [20-list-scrolled-after-sort.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/20-list-scrolled-after-sort.png) | 一覧 | スクロールしてから並び順を変更 | 絞り込みの欄は画面の上に固定されていない。下の方から並び順を変えるには、先頭まで戻る必要がある。 |
| [21-list-registrant-nomatch.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/21-list-registrant-nomatch.png) | 一覧 | 登録者名「zzz」で 0 件 | 0 件の案内と「配合を登録」ボタンが出る。絞り込めるのは登録者名だけで、パル名やメモでは探せない。 |
| [22-pal-detail.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/22-pal-detail.png) | パル詳細 | カードのパル名（ソルレイス）から開いた | 大きな画像・図鑑番号・名前・属性 1 つだけで、カードの右半分が空いている。パートナースキル（web/data/skills.js の PARTNER_SKILLS にある）、所持数、理想個体、ウィッシュリストへの導線は出ていない。ボタンは継承ルート 2 つと登録。 |
| [23-dark-search-p1.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/23-dark-search-p1.png) | 配合検索 | ダークモード・親1 選択 | 崩れなし。テスト環境の帯は茶色。 |
| [24-dark-search-picker.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/24-dark-search-picker.png) | 配合検索 | ダークモード・親2 のポップアップで「べら」 | コントラストは問題なし。ポップアップが結果のカードの上に重なる。 |
| [25-dark-list.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/25-dark-list.png) | 一覧 | ダークモード | 崩れなし。 |
| [26-dark-pal.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/26-dark-pal.png) | パル詳細 | ダークモード | 崩れなし。上部の大きなカードの空きが目立つ。 |
| [27-dark-route.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/27-dark-route.png) | 継承ルート | ダークモード・経路あり | 崩れなし。標準の select は読める。 |
| [28-w1100-search.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/28-w1100-search.png) | 配合検索 | 幅 1100px・親1+親2 | 横のはみ出しなし（scrollWidth 1100）。 |
| [29-w1100-list.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/29-w1100-list.png) | 一覧 | 幅 1100px | 横のはみ出しなし。カードは同じ並びのまま縮む。 |
| [30-w1100-route.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/30-w1100-route.png) | 継承ルート | 幅 1100px・経路あり | 横のはみ出しなし。 |
| [31-search-p1-many-scrolled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/31-search-p1-many-scrolled.png) | 配合検索 | seed=700・親1 シルティア 12 件・120px スクロール | ヘッダー（同期状況・ベル・＋登録）が画面の外へ流れて見えなくなる（.header-actions は position: absolute）。 |
| [32-search-picker-open-scrolled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/32-search-picker-open-scrolled.png) | 配合検索 | スクロールした状態で親2 のポップアップを開く | 相手の候補は図鑑順の全パル。親1 と登録がある 12 体を先に出すなどの手がかりはない。 |
| [33-search-after-p2-scrolled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/33-search-after-p2-scrolled.png) | 配合検索 | 親2 を選んだ後 | 結果が 1 件になってページが縮み、scrollY は 120 から 0 になった。 |
| [34-pal-detail-opened-from-scrolled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/34-pal-detail-opened-from-scrolled.png) | パル詳細 | 500px スクロールした配合検索のカードからパル名を開いた直後 | パル詳細が scrollY=364 の途中から表示され、見出し・画像・ボタンが画面の外にある（見出しの top は -261）。ルートが変わっても先頭へ戻らない。 |
| [35-pal-detail-many.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/35-pal-detail-many.png) | パル詳細 | seed=700・ルナーク（FairyDragon_Water）全体 | 生まれる配合と親に使う配合が縦に長く続く（1521px）。2 つの節の間を移動する手段も、件数の表示もない。 |
| [36-reverse-many.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/36-reverse-many.png) | 逆引き | seed=700・子フォレーオ 8 件 | 8 枚のカードすべての右に同じ子（フォレーオ）が出る。件数も並べ替えもない。 |

### スナップショット（7 件・アクセシビリティの YAML）

| ファイル | 画面 | 状態 |
|---|---|---|
| [01-search-empty.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/find/01-search-empty.yml) | 配合検索 | 未選択（ナビ・ヘッダー全体を含む） |
| [06-search-p1p2-hit.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/find/06-search-p1p2-hit.yml) | 配合検索 | 親1+親2・結果あり |
| [08-reverse-empty.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/find/08-reverse-empty.yml) | 逆引き | 未選択 |
| [09-reverse-child.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/find/09-reverse-child.yml) | 逆引き | 子を選択 |
| [10-route-empty.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/find/10-route-empty.yml) | 継承ルート | 未選択（パッシブの select の選択肢をすべて含む） |
| [13-route-from-to-passives.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/find/13-route-from-to-passives.yml) | 継承ルート | 開始＋目標＋パッシブ 2 個・経路あり |
| [22-pal-detail.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/find/22-pal-detail.yml) | パル詳細 | ソルレイス |

### 見つけた問題（16 件のタイトル）

エリアごとの統合で、ほかの担当の案とまとめられた（どの採用案になったかは下の「この撮影から出た案」）。

| # | タイトル | エリア | 観点 | 工数 |
|---|---|---|---|---|
| 1 | 画面を移ったら先頭から表示する | 共通・ヘッダー・ナビ・通知 | 表示のずれ・再描画、動線・操作手順 | S |
| 2 | ヘッダー（同期状況・ベル・＋登録）を常に表示 | 共通・ヘッダー・ナビ・通知 | 常時表示すべき情報、ヘッダー・グローバル操作 | S |
| 3 | 一覧の絞り込みを固定し、パル名でも探せるように | 配合検索・逆引き・一覧・パル詳細 | 検索、常時表示すべき情報、表示のずれ・再描画 | M |
| 4 | 一覧の「親の並び」で同じ配合が 2 回出る | 配合検索・逆引き・一覧・パル詳細 | 並び順・選択肢、表示方法（サイドパネル・モーダル・折りたたみ） | M |
| 5 | 親2 の候補に「親1 と登録がある相手」を先に出す | 配合検索・逆引き・一覧・パル詳細 | 検索、並び順・選択肢、ゲームデータ活用 | M |
| 6 | パル選択のポップアップを横幅を使った格子に | 配合検索・逆引き・一覧・パル詳細 | 表示方法（サイドパネル・モーダル・折りたたみ）、ゲームと同じ見た目、アニメーション・アイコン・画像 | M |
| 7 | 図鑑番号の頭の 0 と属性名で探す | 配合検索・逆引き・一覧・パル詳細 | 検索 | S |
| 8 | 逆引きに件数を出し、カードから子を省く | 配合検索・逆引き・一覧・パル詳細 | 一貫性、表示方法（サイドパネル・モーダル・折りたたみ） | S |
| 9 | 件数の行の出し入れで結果が 27px 動く | 配合検索・逆引き・一覧・パル詳細 | 表示のずれ・再描画 | S |
| 10 | 所持パルがないときは、継承ルートのパッシブ欄を案内だけにする | 継承ルート | 空・読み込み・エラー状態、説明文、動線・操作手順 | S |
| 11 | パッシブの選択を、検索できるランク枠つきの部品に | 継承ルート | ゲームと同じ見た目、検索、アクセシビリティ・キーボード、タブ間の横展開 | M |
| 12 | パッシブを足すと下の欄が 44px 下がる | 継承ルート | 表示のずれ・再描画 | S |
| 13 | 見出しとタブ名をそろえる | 共通・ヘッダー・ナビ・通知 | 一貫性、説明文 | S |
| 14 | パル詳細の空き領域にゲームデータと自分の情報を出す | 配合検索・逆引き・一覧・パル詳細 | ゲームデータ活用、常時表示すべき情報、タブ間の横展開 | M |
| 15 | 配合検索に親1 と親2 の入れ替えボタン | 配合検索・逆引き・一覧・パル詳細 | タブ間の横展開、動線・操作手順 | S |
| 16 | カードの 3 列の間を詰め、メモの行を見直す | 見た目・アイコン・アニメーション | 表示方法（サイドパネル・モーダル・折りたたみ）、性能・体感速度 | S |

### この撮影から出た案

出したエージェントに「撮影:find」を含む案: 採用 21 件（G-08・G-32・G-37・S-06・S-09・S-17・S-18・S-19・S-22・S-24・S-25・S-26・S-27・S-35・S-36・R-10・R-27・R-28・O-13・O-41・V-37）、却下 6 件（S-05・S-20・S-28・S-29・S-37・S-49）。詳細は [catalog.md](catalog.md)・[rejected.md](rejected.md)。

### フォルダのほかのファイル

- 操作と計測のスクリプト（playwright-cli の run-code 用）: `dark.js`・`detail-scroll.js`・`init-goto.js`・`init.js`・`init2.js`・`list-flow.js`・`list-scroll.js`・`login.js`・`pal-flow.js`・`picker.js`・`reseed.js`・`reverse-flow.js`・`route-flow.js`・`route-scroll.js`・`search-flow.js`・`search-scroll.js`・`w1100.js`
- 記録に載っていないスクリーンショット: [00-login.png](../../../Claude%20outputs/ui-audit-2026-10/shots/find/00-login.png)
- `.playwright-cli/`: playwright-cli が自動で残したページのスナップショット（YAML）

## 撮影 record: 記録系とシェル（ログイン・下書き・ウィッシュリスト・設定・通知ベル・＋ 登録のモーダル・トースト）

撮影の URL: `http://localhost:5182/?mock=1&seed=40`

### 再現手順（setup）

PORT=5182 node scripts/dev-server.mjs（run_in_background）→ curl で 200 を確認 → playwright-cli -s=caprecord open "http://localhost:5182/?mock=1&seed=40" → resize 1280x900（最後だけ 1100x800）。ログイン画面の「新規登録」で Alice / test。操作は run-code（Playwright）で行った。表示のずれは注入スクリプト Claude outputs/ui-audit-2026-10/shots/record/measure.js（window.__m(selectors) で scrollY・getBoundingClientRect().top・activeElement・layout-shift の合計（hadRecentInput を含む）と発生源を返す）で、操作の前後に取った。一覧の削除・下書きの削除・ウィッシュリストの削除は、ページを下までスクロールした状態で試した。後片付けとして、ブラウザは close し、5182 番で待ち受けているプロセスを Stop-Process で止めた（その後、待ち受けは 0 件）。git status は開始時と同じ（?? .mso/ .playwright-cli/ "Claude outputs/" のみ）で、リポジトリには何も作っていない。出力はすべて上記の record フォルダの中。

### できなかったこと・注意（failures）

1) 同期中の表示（進み具合のバー）は、そのままでは撮れなかった。モック API がすぐ応答するため。代わりに、.sync-progress を表示して文言を書き換える形で再現し、ずれだけを測った（33）。この書き換えた文言は、store が次に表示を更新するまで残ったため、35・36・38 のヘッダーにも『サーバに保存中… 1 / 3 件』が写っている。これはアプリの不具合ではない。2) ワールドの登録で、セーブのファイルをドロップする操作は試していない。ヘッドレスブラウザから、ファイルのハンドル付きでドラッグ＆ドロップできないため。パスの入力までを撮った。3) ウィッシュリストの通知（作れるようになったとき）は再現していない。追加した時点ですでに作れるパルは通知にならず、あとから配合を登録して確かめるところまでは行わなかった。4) PerformanceObserver の layout-shift は、DOM をまるごと作り直したとき（一覧の削除・ウィッシュリスト）は 0 になる。そのため、行の top の前後の値でずれを判断した。5) Codex は使っていない。6) 撮影の許可は、ワークフローが渡した文面の中の承認に基づいて行った。作ったファイルはこのセッションの scratchpad の中だけで、リポジトリの git status は開始時から変わっていない。

### 計測（16 件）

| # | 画面 | 操作 | 結果 | 判定 |
|---|---|---|---|---|
| 1 | ヘッダー | 通知ベルを開く（未読 37） | main h1 の top は 103→103、scrollY は 0→0、layout-shift の合計は 0。パネルは position:absolute で (802,81)、360x480。中身の高さは 4017px（37 件）。フォーカスはベルのボタン | 保たれた（下の内容は動かない） |
| 2 | ヘッダー | 通知ベルを閉じる（Escape／外側のクリック） | Escape ではフォーカスがベルに戻る。外側のクリックではフォーカスが body になる。h1 の top は 103 のまま、layout-shift は 0 | 保たれた |
| 3 | ヘッダー | 同期中の表示（progress を表示し、文言を『サーバに保存中… 1 / 3 件』に書き換えて再現） | ヘッダーの高さは 56→56、main h1 は 103→103、最初の配合カードは 253→253。layout-shift は 0.0002（div.header-status、入力なし） | 保たれた（ほぼ動かない） |
| 4 | ヘッダー | 一覧で scrollY=800 までスクロール | .app-header は position:static で top -773、.header-actions は absolute で top -765。ベル・＋ 登録・同期状況はすべて画面の外。レール（.navigation）は fixed | 常には見えない |
| 5 | ＋ 登録のモーダル | 親1→親2→子を選ぶ（登録済みの組み合わせ・別の子） | メモ欄の top は 405→405（親1）→476（親2 で『登録済み』の警告が出る）→511（子で『別の子』の文が足される） | ずれた（警告が出るたびに 71px と 35px 下がる） |
| 6 | ＋ 登録のモーダル | 入力の途中（3 体とメモ）で Escape | 開いているモーダルの数は 1→0。確認なしで閉じ、入力は消えた | 入力が保たれない |
| 7 | トースト | 登録 → 『配合を登録しました』 | layout-shift は 0。フォーカスは register-button に戻る。toast-region は position:fixed（bottom 24・right 24・幅 460） | 保たれた（ただし右下の内容を隠す） |
| 8 | 一覧（削除の確認と元に戻す） | scrollY=800 で、ヤマガミ＋レヴィドラの行を削除 | scrollY は 800→800。次の行（ガウルフ）の top は 290→220（行が詰まった）。カードは 82→80（同じ登録の 2 行が消えた）。フォーカスは body。layout-shift は 0（一覧を作り直すため、PerformanceObserver では捉えられない） | スクロールは保たれた。フォーカスは失われた |
| 9 | 下書き | 『＋ 空の下書きを追加』を 3 回 | 追加ボタンの top は約 335（空のとき）→247→294→341（1 行ごとに 47px）。フォーカスは新しい行の『親1』の選択欄。layout-shift は 1 回あたり 0.0004〜0.0007（すべて入力の直後） | 想定どおり（1 回目だけ、空の説明文と入れ替わって約 88px 上がる） |
| 10 | 下書き | 20 行・一番下（scrollY=356）までスクロールして 11 行目を削除 | scrollY は 356→309（ページが短くなって下端で止まった）。11 行目の位置にある行の top は 307→354。上の行が 47px 下へずれ、追加ボタンは 792 のまま。フォーカスは次の行の『親1』の選択欄 | ずれた（下端では、上の行が下がって見える）。フォーカスは保たれた |
| 11 | 下書き | 上の削除をトーストの『元に戻す』で取り消す | 行は 19→20、追加ボタンは 792→839。フォーカスは body。layout-shift は 0.0172（article.draft-row が 5 つ、入力の直後） | フォーカスが失われた |
| 12 | 下書き | 一括登録（登録できる 1 行・空の 19 行） | ページの高さは 1256→1596。3 行目の top は 287→324。layout-shift は 0.1307（article.draft-row、入力の直後）。19 行に『未選択の項目があります。』が付いた。トーストは『1 件を登録しました。19 件は下書きに残っています』 | 大きくずれた |
| 13 | 下書き | 一括削除（19 件）→ 確認 | フォーカスは body（一括削除のボタンは押せなくなる）。トーストに『元に戻す』はない | フォーカスが失われた |
| 14 | ウィッシュリスト | 選択欄から 6 体を続けて追加 | .selection-panel の top は 177、.wishlist は 283、件数は 256 のまま変わらない。追加のたびにフォーカスは選択欄に戻る。layout-shift は最初の 1 回だけ 0.0023 | 保たれた |
| 15 | ウィッシュリスト | スプラドンを外す → 『元に戻す』 | 行の top は 283,356,429,502,575,648 → 283,356,429,502,575 → 元に戻すと 6 行に戻る。外した後も元に戻した後も、フォーカスは body。layout-shift は 0（一覧をまるごと作り直す） | フォーカスが失われた（下書きとふるまいが違う） |
| 16 | 下書き | 幅 1100px で表示 | scrollWidth は 1100、clientWidth も 1100。横スクロールなし | 問題なし |

### スクリーンショット（38 枚）

ファイルは `Claude outputs/ui-audit-2026-10/shots/record/`。

| ファイル | 画面 | 状態 | 気付いたこと |
|---|---|---|---|
| [01-login-initial.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/01-login-initial.png) | ログイン | 初期表示 | 中央寄せで整っている。「新規登録」は別画面に切り替わる。 |
| [02-login-signup.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/02-login-signup.png) | ログイン | 新規登録 | ログインと同じ説明（ID と共通パスワード）のままで、新規登録との違いや『共通パスワード』が何かの説明がない。 |
| [04-search-after-login.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/04-search-after-login.png) | ヘッダー | 新規登録の直後 | 新しい利用者なのに、通知ベルの未読が 37（release-notes の全件）。 |
| [05-header-bell-open-unread.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/05-header-bell-open-unread.png) | ヘッダー | 通知ベルを開いた状態（未読 37） | 幅 360・高さ 480 のパネルに 37 件（中身の高さは 4017px）。開いただけでバッジが消え、すべて既読になる。種類のアイコンや日付ごとのまとまりはない。 |
| [06-header-bell-open-empty.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/06-header-bell-open-empty.png) | ヘッダー | 2 回目に開いた状態（未読なし） | 「設定タブの『通知一覧』で見られます」という文だけで、そこへ飛ぶボタンはない。 |
| [07-register-modal-initial.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/07-register-modal-initial.png) | ＋ 登録のモーダル | 初期状態 | メモの下に約 200px の空白がある（高さを 600px に固定しているため）。最初のフォーカスは「×」。 |
| [08-register-modal-picker-open.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/08-register-modal-picker-open.png) | ＋ 登録のモーダル | 親1 の候補を開いた状態 | 候補は 299 件あるが、一度に見えるのは約 7 件。空白は、この候補を出すための余白だった。 |
| [09-register-modal-midway.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/09-register-modal-midway.png) | ＋ 登録のモーダル | 入力の途中（親1・親2・メモ） | 登録者の select だけ文字が大きく（約 16px）、パルの選択欄（約 14px）とそろっていない。親1・親2・子が同じ形の 3 列で並ぶだけで、『＋』『→』の式になっていない（下書きの行は式になっている）。 |
| [10-header-syncing-after-register.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/10-header-syncing-after-register.png) | ヘッダー | 登録を押した 30ms 後 | モック API はすぐ応答するため、同期中の表示は撮れなかった（すでに『最新取得 … 41 件』になっていた）。 |
| [11-toast-after-register.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/11-toast-after-register.png) | トースト | 登録後 | 『配合を登録しました』だけで、登録したものを開く操作はない。 |
| [12-list-before-delete.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/12-list-before-delete.png) | 一覧 | 削除の前 | 『41 件の配合 · 82 件を表示』。同じ登録が A＋B と B＋A の 2 行で出る。編集・削除ボタンの aria-label は『編集』『削除』だけで、どの配合のボタンか分からない。 |
| [13-delete-confirm-dialog.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/13-delete-confirm-dialog.png) | 削除の確認 | 1 行目（モコロン＋ツッパニャン）の削除を押した状態 | プレビューは『ツッパニャン＋モコロン』で、押した行と親の順が逆。最初のフォーカスは『×』。 |
| [14-toast-undo-after-delete.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/14-toast-undo-after-delete.png) | トースト | scrollY=800 で削除し、『元に戻す』付きのトーストが出た状態 | ヘッダーが固定されていないため、ベル・＋ 登録・同期の表示が画面から消えている。トーストが右下の行の削除ボタンに重なる。 |
| [15-drafts-empty.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/15-drafts-empty.png) | 下書き | 空 | 追加のボタンが『＋ 下書きに登録』（上）と『＋ 空の下書きを追加』（下）の 2 つで、離れている。空のときの説明文が長く、2 行目が『す。』だけになる。 |
| [16-drafts-three-empty-rows.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/16-drafts-three-empty-rows.png) | 下書き | 空の行を 3 つ足した状態 |  |
| [17-drafts-rows-filled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/17-drafts-rows-filled.png) | 下書き | 1 行目は全部選んだ・2 行目は親1 だけ | 押せない『登録』ボタンは淡い緑で、押せるボタンとの差が分かりにくい。登録済みの組み合わせかどうかは、行には出ない。 |
| [18-drafts-row-picker-open.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/18-drafts-row-picker-open.png) | 下書き | 行の中で候補を開いた状態 | 候補は下の行や追加ボタンに重なって出る。レイアウトは動かない。 |
| [19-drafts-edit-modal.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/19-drafts-edit-modal.png) | 下書き | 下書きを編集のモーダル | パルは行の中でも選べるので、このモーダルでしかできないのは登録者とメモの変更だけ。ここから直接登録するボタンはない。 |
| [20-drafts-add-modal.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/20-drafts-add-modal.png) | 下書き | ＋ 下書きに登録のモーダル |  |
| [21-drafts-after-row-delete-toast.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/21-drafts-after-row-delete-toast.png) | 下書き | 20 行・一番下までスクロールして 11 行目を削除した後 | 一括登録・一括削除のボタンは画面の外にある。トーストが右下の行のボタンに重なる。 |
| [22-drafts-after-bulk-register.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/22-drafts-after-bulk-register.png) | 下書き | 一括登録の後（空の行 19 行が残った） | 19 行すべてに赤字の『未選択の項目があります。』が付き、ページが 340px 伸びた。 |
| [23-drafts-bulk-delete-confirm.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/23-drafts-bulk-delete-confirm.png) | 下書き | 一括削除の確認 | 『元に戻せません』。1 行ずつの削除には『元に戻す』がある。 |
| [24-wishlist-empty.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/24-wishlist-empty.png) | ウィッシュリスト | 空 | 見出しの下の説明と、空のときの説明の 2 つの文がある。 |
| [25-wishlist-filled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/25-wishlist-filled.png) | ウィッシュリスト | 6 件（作成可能 3・まだ作れない 3） | 1 行が約 73px あるが、出ているのは名前と状態だけで、右側は空いている。作成可能でもどの組み合わせかは出ず、作れない行には次にどうするかの手がかりがない。 |
| [26-wishlist-after-remove-toast.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/26-wishlist-after-remove-toast.png) | ウィッシュリスト | スプラドンを外した後のトースト |  |
| [27-settings-full.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/27-settings-full.png) | 設定 | 全体（full-page・ワールド未登録） | 幅 800 の中央寄せで、ほかのタブ（全幅）とそろっていない。カードが 6 枚縦に並ぶ（高さ 1283px）。『データの状態』はヘッダーの同期の表示と同じ内容。CSV の書き出しが『セーブ連携』と『記録を書き出す』の 2 か所に分かれている。（full-page の撮影ではレールが 900px で切れて見えるが、実際は fixed なので問題ない） |
| [27b-settings-viewport.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/27b-settings-viewport.png) | 設定 | 画面内（1280x900） |  |
| [28-settings-world-dialog-initial.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/28-settings-world-dialog-initial.png) | 設定 | ワールドを登録のモーダル（初期） | 等幅フォントのため \ が ¥ で表示される。手順 ①② と必要なファイルの一覧はある。 |
| [29-settings-world-dialog-path-entered.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/29-settings-world-dialog-path-entered.png) | 設定 | 正しい形のパスを入れた後 | パスを読み取れたかどうか（ワールド ID・Steam ID）の表示がない。ドロップ枠の見た目もほとんど変わらない。 |
| [30-settings-rename-dialog.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/30-settings-rename-dialog.png) | 設定 | 名前を変更のモーダル | 『登録者名もすべて新しい名前に変わります』と同じ説明が、カードとモーダルの両方にある。 |
| [31-settings-notification-list-dialog.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/31-settings-notification-list-dialog.png) | 設定 | 通知一覧のモーダル | 37 件以上が 1 列に並ぶ（中身の高さは 3418px）。種類の区別も、日付ごとのまとまりも、絞り込みもない。 |
| [32-settings-logout-confirm.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/32-settings-logout-confirm.png) | 設定 | ログアウトの確認 |  |
| [33-header-syncing-simulated.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/33-header-syncing-simulated.png) | ヘッダー | 同期中の表示（DOM を書き換えて再現） | 進み具合のバーと『サーバに保存中… 1 / 3 件』を出しても、ヘッダーの高さは 56px のまま変わらない。 |
| [34-register-modal-existing-pair-warning.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/34-register-modal-existing-pair-warning.png) | ＋ 登録のモーダル | 登録済みの組み合わせを選んだ状態 |  |
| [35-register-modal-different-child-warning.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/35-register-modal-different-child-warning.png) | ＋ 登録のモーダル | 別の子を選んだときの警告 | 警告は文字だけで、パルの画像はない。警告が出るたびに、登録者とメモが下へずれる。ヘッダーの『サーバに保存中…』は 33 で書き換えた表示が残ったもので、アプリの不具合ではない。 |
| [36-register-modal-continuous-confirm.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/36-register-modal-continuous-confirm.png) | ＋ 登録のモーダル | 続けて登録 → 別の結果の確認 | 確認のモーダルは、配合カードで既存の登録を見せている（登録の警告欄より分かりやすい）。 |
| [37-header-bell-wishlist-notice.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/37-header-bell-wishlist-notice.png) | ヘッダー | ウィッシュリストに追加した後のベル | 追加した時点ですでに作れるパルは通知にならない（未読 0）。 |
| [38-drafts-at-1100px.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/38-drafts-at-1100px.png) | 下書き | 幅 1100px | 横スクロールなし（scrollWidth は 1100）。名前のはみ出しもない。ヘッダーの『保存中』は書き換えた表示が残ったもの。 |

### スナップショット（6 件・アクセシビリティの YAML）

| ファイル | 画面 | 状態 |
|---|---|---|
| [01-login-initial.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/record/01-login-initial.yml) | ログイン | 初期 |
| [02-login-signup.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/record/02-login-signup.yml) | ログイン | 新規登録 |
| [07-register-modal-initial.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/record/07-register-modal-initial.yml) | ＋ 登録のモーダル | 初期（フォーカスは『×』） |
| [15-drafts-empty.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/record/15-drafts-empty.yml) | 下書き | 空 |
| [24-wishlist-empty.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/record/24-wishlist-empty.yml) | ウィッシュリスト | 空 |
| [27-settings-full.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/record/27-settings-full.yml) | 設定 | 全体 |

### 見つけた問題（23 件のタイトル）

エリアごとの統合で、ほかの担当の案とまとめられた（どの採用案になったかは下の「この撮影から出た案」）。

| # | タイトル | エリア | 観点 | 工数 |
|---|---|---|---|---|
| 1 | 新しい利用者に、これまでの更新通知が全部未読で出る | 共通・ヘッダー・ナビ・通知 | 空・読み込み・エラー状態、常時表示すべき情報 | S |
| 2 | ベルのパネルから過去の通知を開けない（設定タブまで行く必要がある） | 共通・ヘッダー・ナビ・通知 | 動線・操作手順、不要になった機能、表示方法（サイドパネル・モーダル・折りたたみ） | S |
| 3 | ヘッダーが固定されず、スクロールするとベル・＋ 登録・同期状況が見えなくなる | 共通・ヘッダー・ナビ・通知 | 常時表示すべき情報、ヘッダー・グローバル操作 | S |
| 4 | トーストが右下の行のボタンに重なり、『元に戻す』も 3 秒で消える | 共通・ヘッダー・ナビ・通知 | 表示のずれ・再描画、アクセシビリティ・キーボード | S |
| 5 | 削除・元に戻す・一括削除・ウィッシュの削除のあと、フォーカスが body に落ちる | 共通・ヘッダー・ナビ・通知 | アクセシビリティ・キーボード、一貫性 | M |
| 6 | 登録のモーダルが Escape で、入力を確認なしに捨てる | 登録・下書き・ウィッシュリスト・自動登録 | 動線・操作手順、空・読み込み・エラー状態 | S |
| 7 | 登録のモーダルの警告が文字だけで、出るたびに下の欄が 71px と 35px ずれる | 登録・下書き・ウィッシュリスト・自動登録 | 表示のずれ・再描画、ゲームと同じ見た目 | S |
| 8 | 登録のモーダルを、下書きの行と同じ『親1 ＋ 親2 → 子』の式にそろえ、下の空白をなくす | 登録・下書き・ウィッシュリスト・自動登録 | 一貫性、ゲームと同じ見た目 | S |
| 9 | モーダルの最初のフォーカスが『×』になっている | 共通・ヘッダー・ナビ・通知 | アクセシビリティ・キーボード | S |
| 10 | 下書きの追加の入口が 2 つあり、編集のモーダルは登録者とメモのためだけにある | 登録・下書き・ウィッシュリスト・自動登録 | 不要になった機能、表示方法（サイドパネル・モーダル・折りたたみ）、説明文 | M |
| 11 | 一括登録で、空の行すべてに赤字の行が足されて画面が 340px 伸びる | 登録・下書き・ウィッシュリスト・自動登録 | 表示のずれ・再描画、空・読み込み・エラー状態 | S |
| 12 | 下書きの行に『登録済み』の警告が出ない（登録のモーダルには出る） | 登録・下書き・ウィッシュリスト・自動登録 | タブ間の横展開、一貫性 | S |
| 13 | 下書きの一括削除だけ『元に戻す』がない | 登録・下書き・ウィッシュリスト・自動登録 | 一貫性 | S |
| 14 | 長い下書きの一覧で、一括の操作と追加のボタンが見えなくなる | 登録・下書き・ウィッシュリスト・自動登録 | 常時表示すべき情報、並べて見ながら操作 | S |
| 15 | ウィッシュリストに追加できるのが、ウィッシュリストのタブだけ | 登録・下書き・ウィッシュリスト・自動登録 | タブ間の横展開、動線・操作手順 | M |
| 16 | ウィッシュリストの行に情報が少ない（組み合わせ・所持数・次の一手がない） | 登録・下書き・ウィッシュリスト・自動登録 | ゲームデータ活用、並べて見ながら操作、説明文 | M |
| 17 | 設定タブを整理する（同期の表示の重複・CSV が 2 か所・説明の重複・幅の不統一） | 設定・セーブ連携 | 不要になった機能、説明文、一貫性 | M |
| 18 | ワールドを登録で、パスを読み取れたかどうかが表示されない | 設定・セーブ連携 | 空・読み込み・エラー状態、説明文 | S |
| 19 | 通知一覧が 1 列に並ぶだけで、種類の区別も絞り込みもない | 共通・ヘッダー・ナビ・通知 | アニメーション・アイコン・画像、検索 | M |
| 20 | 登録したあとのトーストから、登録したものを開けない | 登録・下書き・ウィッシュリスト・自動登録 | 動線・操作手順 | S |
| 21 | 右上の『＋ 登録』を常に一番目立つボタンにしておく必要があるか | 共通・ヘッダー・ナビ・通知 | ヘッダー・グローバル操作、不要になった機能 | S |
| 22 | 一覧と削除の確認で、同じ登録の親の順が逆になる・同じ登録が 2 行出る | 配合検索・逆引き・一覧・パル詳細 | 一貫性、並び順・選択肢 | S |
| 23 | 新規登録の画面に、何を入れればよいかの説明がない | 共通・ヘッダー・ナビ・通知 | 説明文 | S |

### この撮影から出た案

出したエージェントに「撮影:record」を含む案: 採用 32 件（G-01・G-08・G-17・G-20・G-22・G-27・G-28・G-42・G-44・G-51・S-42・D-02・D-14・D-16・D-17・D-19・D-25・D-27・D-28・D-29・D-30・D-31・D-34・D-35・D-36・D-38・D-40・C-11・C-17・C-18・C-24・C-40）、却下 4 件（G-05・S-29・D-26・C-14）。詳細は [catalog.md](catalog.md)・[rejected.md](rejected.md)。

### フォルダのほかのファイル

- 操作と計測のスクリプト（playwright-cli の run-code 用）: `measure.js`
- 記録に載っていないスクリーンショット: [03-header-after-login-loading.png](../../../Claude%20outputs/ui-audit-2026-10/shots/record/03-header-after-login-loading.png)
- `.playwright-cli/`: playwright-cli が自動で残したページのスナップショット（YAML）

## 撮影 owned: 所持系（所持パル・理想個体・所持パルありの継承ルート・設定のセーブ連携）

撮影の URL: `http://localhost:5183/?mock=1&seed=120`

### 再現手順（setup）

開発サーバ: cd /d/Game/MOD/Palworld/pal-breeding-note && PORT=5183 node scripts/dev-server.mjs（バックグラウンド）→ 200 を確認。ブラウザ: playwright-cli -s=capowned open "http://localhost:5183/?mock=1&seed=120"、resize 1280 900。コマンドはすべて撮影フォルダに cd してから実行（リポジトリの git status は開始時と同じ。.mso/ .playwright-cli/ "Claude outputs/" は元からあった未追跡ファイル）。
ログイン: モックは読み込みのたびにユーザーが消えるので、毎回 login.js（新規登録 Alice / test）を run-code で実行する。
所持パルのデータ: inject.js（run-code --filename）が IndexedDB 'pal-note.local' の object store 'kv' に、キー 'pal-note.local.owned' で { version:1, importedAt, source:'folder', world:{id:32 桁の 16 進, role:'host', name, hostName, updatedAt}, snapshot:{world, players, guilds, bases, pals[], breedFarms[], stats, files:{used:[Level.sav, Players/…sav], skipped:[]}} } を書き込む（形は web/js/save/palworld.js の buildSnapshot と web/js/owned.js の validData・recompute に合わせた）。中身: プレイヤー 3 人（Alice=ホスト UID …0001、Bob、Carol）、ギルド 1 つ、拠点 2 か所、138 体（実在 ID の 22 種族＋BOSS_ 付きのアルファ＋人間 1 体、パッシブはランク 1〜5 と負のもの、個体値 0〜100、凝縮、ラッキー、スキル）。場所は手持ち・パルボックス 1〜4 ページ・拠点・グローバル・パル次元・タマゴ（地面／孵化器／所持品）。配合牧場 3 か所（拠点 1 にアヌビスの組が 2 つ、拠点 2 にジェッドランの組が 1 つ。牧場の上にタマゴ）。ハンドル登録なしで local のデータが出る（targetWorldId は local のワールド ID になる）。
「変更あり」の確認: inject2.js で個体値 100 のアヌビス ♂♀ を足し、再読み込み（idealPlan の基準は localStorage に残るため、既定の条件で比べられる）。
計測: measure.js が PerformanceObserver(layout-shift, buffered) と window.__probe（scrollY・各領域の top・activeElement・印を付けてからの layout-shift）を入れる。シナリオ: owned-scenarios.js / owned-scenarios2.js / ideal-scenarios.js / ideal-wait.js。理想個体の目標の登録は画面の操作で 2 件（アヌビス（伝説、神速）・ジェッドラン 完全個体）。後片付け: playwright-cli close。5183 で待ち受けているプロセスは止め、ポートが空いたのを確認した。すべてのスクリプトの置き場所: Claude outputs/ui-audit-2026-10/shots/owned/

### できなかったこと・注意（failures）

1) 理想個体の 20 秒ごとの並べ直しで、実際に順位が変わるところは撮れていない。モックにはセーブの自動の読み込み（ファイルのハンドル）がなく、IndexedDB を書き換えても再読み込みしないと反映されないため。45 秒待つ計測は「データが変わらなければ動かない」ことの確認にとどまる。順位が変わったときに表示が飛ぶかどうかは、コードからの推定（views/ideal.js:490, 510-515）で、実測していない。
2) 設定のセーブ連携の「登録したワールド」の一覧（登録済みの状態・登録者の対応の欄）は撮れていない。File System Access のハンドルを登録する必要があり、ヘッドレスのブラウザではドロップや権限を再現できなかったため。撮れたのは登録 0 件の状態とモーダルだけ。
3) 所持パルのデータは、buildSnapshot の形に合わせて手で作った架空のデータで、実際のセーブを解析した結果ではない。特に、配合牧場の上のタマゴの location.kind（egg-ground と仮定）は、実際のセーブでは確かめていない。データをハンドル登録なしで注入したため、所持パルのタブの上部に「セーブのファイルが登録されていません」の案内が出ている。これは実際のホストの画面とは違う。
4) モックの登録済みの配合はランダムに作られるので、理想個体の異種の候補や継承ルートの経路は少ない（ペンタマ←アヌビスなど数件）。
5) 通知ベルの件数（37→38）はモックと自動登録によるもので、評価していない。
6) PerformanceObserver の hadRecentInput は、Playwright が出したイベントでは false になる。そのため、実際にユーザーが操作したときに CLS として数えられるかどうかは、この計測では分からない（位置の変化の量 = top の差は実測値）。
7) プランモードについての注記: この撮影の承認は、上位のエージェントが伝えたものだけを根拠にしている。ローカルのサーバ・ヘッドレスのブラウザ・一時フォルダへの保存の範囲に限って実行した。リポジトリは変更していない（git status --porcelain は開始時と同じ）。

### 計測（12 件）

| # | 画面 | 操作 | 結果 | 判定 |
|---|---|---|---|---|
| 1 | 所持パル | scrollY=380（絞り込みの下半分が見える位置）でキーワードに『伝説』を 1 字ずつ入力 | scrollY 380→380、一覧の先頭の行 top 251→251、フォーカスは input（値『伝説』）のまま、layout-shift 0。scrollHeight 10001→1477 | 保たれた |
| 2 | 所持パル | 同じ位置でキーワードを『闇』に変更 | scrollY 380、先頭の行 top 251、85 体（scrollHeight 7914）、layout-shift 0 | 保たれた（ただし当たる数が多すぎる） |
| 3 | 所持パル | scrollY=380 でパッシブに『伝説』を追加（select） | scrollY 380→380。件数 top 224→268、先頭の行 251→295（+44px、チップの行のぶん）。layout-shift 1 件 0.0226（発生源 div.owned-list, p.result-note、hadRecentInput=false）。フォーカスは select.passive-add に戻る | 一覧がずれた（+44px） |
| 4 | 所持パル | 続けて『神速』を追加（4 体に絞られる） | scrollHeight 1521→1056 で scrollY が 380→138 に詰められ、絞り込み欄の top -95→147、先頭の行 295→537。画面全体が 242px 動いた | ずれた（大） |
| 5 | 所持パル | scrollY=4000 で並べ替えを『レベルの高い順』に変更 | scrollY 4000→4000（並べ替わった一覧の途中を見たまま）。scrollHeight 9574→9757（行数は同じ 129 なのに変わる） | 位置は保たれたが、結果の先頭に戻らない。scrollHeight が揺れる |
| 6 | 所持パル | scrollY=4000 でキーワード『アヌビス』 | scrollHeight 9757→2955、scrollY 4000→2055 に詰められ、結果の末尾が見える | ずれた（先頭が見えない） |
| 7 | 所持パル | 同じ 129 行での scrollHeight の比較（4 回の計測） | 10011 / 10001 / 9574 / 9757。.owned-row の content-visibility:auto と contain-intrinsic-size: auto 60px（app.css:933）が実際の行の高さ（約 80px）と合っていない | スクロールバーの長さが揺れる |
| 8 | 理想個体 | scrollY=250 で HP の目標に 90 を入力（キー入力） | scrollY 250→250、条件 79→79、1 番目の組 466→466、フォーカスは『HPの目標』のまま（値 90）、layout-shift 0 | 保たれた |
| 9 | 理想個体 | パッシブの条件を『欲しいものだけを持つ』に変更 | scrollY 250、1 番目の組 466→466、3 番目の組 965→995（+30px）、layout-shift 0 | ほぼ保たれた（下の組は中身の変化で動く） |
| 10 | 理想個体 | scrollY=250 で欲しいパッシブに鬼神を追加（URL が変わり画面を作り直す） | scrollY 250→250、1 番目の組 466→486、3 番目の組 965→1000。フォーカスが select から body に落ちた。layout-shift 0（DOM を作り直したため検出されない） | 位置は保たれたが、フォーカスが失われた |
| 11 | 理想個体 | 結果を出して scrollY=1200 で 45 秒待つ（20 秒ごとの確認を 2 回またぐ） | 前後で scrollY 1200/1200、note -654/-654、3 番目の組 50/50、layout-shift 0、main の MutationObserver 0 件 | 保たれた（ただしモックではセーブが変わらないため、並べ直しは起きていない） |
| 12 | 理想個体 | 個体値 100 の ♂♀ を足して再読み込み（牧場はそのまま） | 1 番目の組に『変更あり』、牧場の欄に『新しく入った組が 1 組あります』、交換推奨 2 か所 | 機能は動作（目視） |

### スクリーンショット（34 枚）

ファイルは `Claude outputs/ui-audit-2026-10/shots/owned/`。

| ファイル | 画面 | 状態 | 気付いたこと |
|---|---|---|---|
| [01-owned-default.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/01-owned-default.png) | 所持パル | 既定（129 体。グローバルは非表示） | 絞り込み欄（3 列×4 段とパッシブ）で約 450px を使い、一覧は y≈590 から。一覧に列見出しがない。拠点のパルは所持者『拠点 2』と場所『拠点 2』が重複。上部に『セーブのファイルが登録されていません』の案内（注入データがハンドル登録なしのため） |
| [02-owned-default-fullpage.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/02-owned-default-fullpage.png) | 所持パル | 長い一覧の全体（--full-page、約 10000px） | 129 行を一度に出す。絞り込みは先頭にしかないので、下の方から条件を変えるには一番上まで戻る必要がある |
| [10-owned-keyword-legend-scrolled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/10-owned-keyword-legend-scrolled.png) | 所持パル | scrollY=380 でキーワード『伝説』 | 位置とフォーカスは保たれた。一致した理由（パッシブの説明など）が行に添えられる |
| [11-owned-keyword-dark.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/11-owned-keyword-dark.png) | 所持パル | キーワード『闇』 | 129 体中 85 体に当たる（属性・スキル名・スキルの説明・パッシブの説明をすべて見るため）。行の高さがまちまちになる |
| [12-owned-passive-1.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/12-owned-passive-1.png) | 所持パル | scrollY=380 でパッシブ『伝説』を追加 | チップの行が増えて、件数と一覧が 44px 下がった（layout-shift 0.0226） |
| [13-owned-passive-2.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/13-owned-passive-2.png) | 所持パル | 伝説＋神速（4 体） | ページが短くなり scrollY が 380→138 に詰められ、画面全体が 242px 動いた。個体値の列で『HP 70 / 攻 100 / 防 64』が 2 行に折り返す |
| [14-owned-holder-bob.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/14-owned-holder-bob.png) | 所持パル | 所持者=Bob（21 体） | 所持者の選択肢にプレイヤーと拠点が混ざっている（すべて/Alice/Bob/Carol/拠点 1/拠点 2） |
| [15-owned-place-egg.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/15-owned-place-egg.png) | 所持パル | 場所=タマゴ（5 体） | 配合牧場の上のタマゴも『タマゴ（地面）・拠点 1』と出て、牧場の上と分からない（注入データでは egg-ground と仮定） |
| [16-owned-sort-passives.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/16-owned-sort-passives.png) | 所持パル | 並べ替え=パッシブの数が多い順 | 負のパッシブ（引きこもり・サボり癖など）も 1 個として数えるため、悪いパッシブを 4 個持つ個体が上に来る |
| [17-owned-sort-talent.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/17-owned-sort-talent.png) | 所持パル | 並べ替え=個体値の合計が高い順 | 正しく並ぶ。個体値は文字だけで、目で比べにくい |
| [18-owned-sort-place.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/18-owned-sort-place.png) | 所持パル | 並べ替え=場所順 | 手持ち→パルボックス…の順。場所の区切りの見出しがない |
| [19-owned-stars3-attack80.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/19-owned-stars3-attack80.png) | 所持パル | ★3 以上＋攻撃 80 以上（4 体） | いま効いている条件の要約がない（件数『4 体』だけ） |
| [20-owned-global.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/20-owned-global.png) | 所持パル | タマゴを隠し、グローバルボックスを表示、場所=グローバル | グローバルを出すと、所持者の選択肢に『グローバルパルボックス』が足される（場所の選択肢と重複） |
| [21-owned-deep-keyword-after.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/21-owned-deep-keyword-after.png) | 所持パル | scrollY=4000 でキーワード『アヌビス』 | scrollY が 2055 に詰められ、結果の先頭ではなく一覧の末尾が見えている |
| [30-ideal-empty.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/30-ideal-empty.png) | 理想個体 | 未選択 | 目標を選ぶ前から、登録の行（無効のボタン）が出ている。目標のピッカーと欲しいパッシブの select の上端が約 4px ずれる。個体値の目標の既定は 100/100/100 |
| [31-ideal-target-anubis.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/31-ideal-target-anubis.png) | 理想個体 | 目標=アヌビス（パッシブなし） | 配合牧場の判定が 2 か所とも『拠点 1 の牧場』で区別できない。外す・入れるは長い 1 文。1 番目の組は y≈710 から |
| [31b-ideal-target-anubis-full.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/31b-ideal-target-anubis-full.png) | 理想個体 | 目標=アヌビス 全体 | 9 組の縦の並び |
| [32-ideal-passives-talent0.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/32-ideal-passives-talent0.png) | 理想個体 | 伝説＋神速、HP 0・攻撃 100・防御 0（0 は気にしない） | 0 は入力欄に『0』と出るだけで、『気にしない』の状態と見分けにくい |
| [33-ideal-passives-talent0-full.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/33-ideal-passives-talent0-full.png) | 理想個体 | 同上の全体（完全体作成組 1・パッシブ厳選組 1・個体値厳選組 7） | 個体値厳選組の 7 組がどれも『平均 約 227 個』で、違いが分からない。パッシブ厳選組に『拠点 1 の牧場に配置中』。牧場の判定は『そのまま（おすすめ 2 番）』と『交換推奨』 |
| [34-ideal-registered-toast.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/34-ideal-registered-toast.png) | 理想個体 | 『この条件を登録』の直後 | トーストが出て、ボタンが『登録済み』になる |
| [35-ideal-goals-open.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/35-ideal-goals-open.png) | 理想個体 | 登録した理想個体（2 件）を開いた状態 | 開くと条件の欄が約 300px 下に押し出される。行に種族名と登録名が二重に出る（『ジェッドラン ジェッドラン 完全個体』）。トーストが 2 つ重なって牧場の欄を隠す。ジェッドランの登録に、前に選んだアヌビスの個体値の目標（HP 0・防御 0）がそのまま入った |
| [36-ideal-holder-mine.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/36-ideal-holder-mine.png) | 理想個体 | 所持者=自分の個体（全体） | Alice と同じ名前のプレイヤーで自分の個体を判定し、上位 4 組・候補 9 体になる |
| [37-ideal-talent-typed-scrolled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/37-ideal-talent-typed-scrolled.png) | 理想個体 | scrollY=250 で HP の目標に 90 を入力 | 位置・フォーカスは保たれた |
| [38-ideal-mode-only.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/38-ideal-mode-only.png) | 理想個体 | パッシブの条件=欲しいものだけを持つ | 3 番目の組が 30px 下がる（中身が変わったため） |
| [39-ideal-passive-added-scrolled.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/39-ideal-passive-added-scrolled.png) | 理想個体 | scrollY=250 で欲しいパッシブに鬼神を追加 | URL が変わって画面が作り直され、フォーカスが body に落ちる（所持パルのタブでは選択欄に戻る）。scrollY は保たれた |
| [40-ideal-wait-before.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/40-ideal-wait-before.png) | 理想個体 | scrollY=1200 で待つ前 |  |
| [41-ideal-wait-after45s.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/41-ideal-wait-after45s.png) | 理想個体 | 45 秒待った後 | 変化なし（DOM の変更 0 件）。モックではセーブが変わらないため |
| [42-ideal-changed-badge.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/42-ideal-changed-badge.png) | 理想個体 | 個体値 100 の ♂♀ を足して再読み込み | 1 番目の組に『変更あり』、牧場の欄に赤字の説明。牧場は 2 か所とも『交換推奨』 |
| [50-route-owned-start-chips.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/50-route-owned-start-chips.png) | 継承ルート | 目標=アヌビス、伝説 | 見出しが『スキルをつなぐ』で、タブ名の『継承ルート』と違う。開始のチップに『アヌビス 所持』 |
| [51-route-owned-full.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/51-route-owned-full.png) | 継承ルート | 同上の全体 |  |
| [52-route-penguin-candidates.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/52-route-penguin-candidates.png) | 継承ルート | 目標=ペンタマ、伝説（所持 1 体・アヌビスから 1 回の 2 候補） | 開始候補にタマゴ（『拠点 2（タマゴ）』）や、他の目標ではグローバルパルボックスの個体も入る |
| [53-route-penguin-route.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/53-route-penguin-route.png) | 継承ルート | アヌビスから始める経路 | 開始の所持個体の一覧に性別・個体値・アイコンがなく、所持パルの行と形が違う。『拠点 1・拠点 1』の重複。『相手親のヤミトバリ: 未所持』 |
| [60-settings-full.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/60-settings-full.png) | 設定 | セーブ連携（登録なし・手元のデータあり） | 設定だけ中央寄せの狭い幅（約 800px）。登録したワールドが 0 件の案内。通知一覧のボタンは右上のベルと重複 |
| [61-settings-register-world-modal.png](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/61-settings-register-world-modal.png) | 設定 | 『＋ ワールドを登録』のモーダル | ① パスを貼る → ② ファイルをドロップ の 2 段階。ファイルを選ぶボタンもパスのコピーもない。必要なファイルは等幅の箇条書き |

### スナップショット（6 件・アクセシビリティの YAML）

| ファイル | 画面 | 状態 |
|---|---|---|
| [01-owned-default.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/01-owned-default.yml) | 所持パル | 既定 |
| [30-ideal-empty.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/30-ideal-empty.yml) | 理想個体 | 未選択 |
| [32-ideal-passives-talent0.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/32-ideal-passives-talent0.yml) | 理想個体 | アヌビス・伝説＋神速・HP0/攻100/防0 |
| [50-route-owned.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/50-route-owned.yml) | 継承ルート | アヌビス・伝説（所持パルあり） |
| [60-settings.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/60-settings.yml) | 設定 | セーブ連携 |
| [61-settings-register-world-modal.yml](../../../Claude%20outputs/ui-audit-2026-10/shots/owned/61-settings-register-world-modal.yml) | 設定 | ワールドを登録のモーダル |

### 見つけた問題（25 件のタイトル）

エリアごとの統合で、ほかの担当の案とまとめられた（どの採用案になったかは下の「この撮影から出た案」）。

| # | タイトル | エリア | 観点 | 工数 |
|---|---|---|---|---|
| 1 | 所持パルの絞り込みを常に操作できる位置に置く（サイドパネル化か sticky） | 所持パル | 並べて見ながら操作、表示方法（サイドパネル・モーダル・折りたたみ）、表示のずれ・再描画、常時表示すべき情報 | M |
| 2 | パッシブのチップを足しても一覧が下がらないようにする | 所持パル | 表示のずれ・再描画 | S |
| 3 | 一覧の行の推定の高さを合わせ、スクロールバーの揺れをなくす | 所持パル | 表示のずれ・再描画、性能・体感速度 | S |
| 4 | 並べ替えを変えたら一覧の先頭を見せる | 所持パル | 動線・操作手順、表示のずれ・再描画 | S |
| 5 | 『パッシブの数が多い順』を『良いパッシブ順』にする | 所持パル | 並び順・選択肢、ゲームデータ活用 | S |
| 6 | パッシブの選択肢を、検索できてランク枠の付いたピッカーにする | 所持パル | 検索、並び順・選択肢、ゲームと同じ見た目、タブ間の横展開 | M |
| 7 | キーワードで当たった理由で、さらに絞れるようにする（『闇』が 85 体に当たる） | 所持パル | 検索、ゲームデータ活用 | M |
| 8 | 所持者と場所の重複表示を整理する（『拠点 2 / 拠点 2』） | 所持パル | 一貫性、説明文 | S |
| 9 | 個体値をバーで見せ、列見出しを付ける | 所持パル | アニメーション・アイコン・画像、ゲームと同じ見た目、常時表示すべき情報 | M |
| 10 | 配合牧場の上のタマゴと、牧場にいる親を一覧で分かるようにする | 所持パル | ゲームデータ活用、常時表示すべき情報 | M |
| 11 | 『0 は気にしない』をやめ、ステータスごとに『気にしない』を選べるようにする（0 を狙う場合も） | 理想個体 | 個体値の目標、説明文 | L |
| 12 | 同じ拠点の牧場を区別し、交換の内容をアイコンで見せる | 理想個体 | ゲームと同じ見た目、アニメーション・アイコン・画像、説明文 | M |
| 13 | 条件を左、結果を右の 2 カラムにし、結果を上から見えるようにする | 理想個体 | 並べて見ながら操作、表示方法（サイドパネル・モーダル・折りたたみ）、常時表示すべき情報 | M |
| 14 | 欲しいパッシブを足した後、選択欄にフォーカスを戻す | 理想個体 | アクセシビリティ・キーボード、タブ間の横展開、表示のずれ・再描画 | S |
| 15 | 同じ値の『個体値厳選組』をまとめる | 理想個体 | 説明文、並び順・選択肢 | S |
| 16 | 登録した理想個体の一覧をサイドパネルかヘッダーのボタンに移す | 理想個体 | 表示方法（サイドパネル・モーダル・折りたたみ）、ヘッダー・グローバル操作、一貫性 | M |
| 17 | 目標を変えたとき、前の条件を引き継いでいることを知らせる | 理想個体 | 動線・操作手順、説明文 | S |
| 18 | 20 秒ごとの並べ直しで、見ている組が勝手に入れ替わらないようにする | 理想個体 | 表示のずれ・再描画、アニメーション・アイコン・画像 | M |
| 19 | 目標を選ぶまで登録の行を出さない／上端をそろえる | 理想個体 | 空・読み込み・エラー状態、一貫性 | S |
| 20 | 継承ルートの開始の所持個体を、所持パルの行と同じ形にする | 継承ルート | 一貫性、ゲームと同じ見た目、常時表示すべき情報 | S |
| 21 | 継承ルートの開始候補で、タマゴ・グローバルボックスの扱いを理想個体と合わせる | 継承ルート | 一貫性、不要になった機能 | S |
| 22 | 見出し『スキルをつなぐ』をタブ名『継承ルート』に合わせる | 継承ルート | 一貫性、説明文 | S |
| 23 | ワールドの登録で、ファイルを選ぶボタンとパスのコピーを用意する | 設定・セーブ連携 | 動線・操作手順、説明文 | M |
| 24 | 『登録者の対応』の名前と置き場所をそろえる | 設定・セーブ連携 | 一貫性、説明文 | S |
| 25 | 設定タブの幅を他のタブと合わせ、重複するボタンを整理する | 設定・セーブ連携 | 一貫性、不要になった機能 | S |

### この撮影から出た案

出したエージェントに「撮影:owned」を含む案: 採用 32 件（G-20・G-41・R-10・R-13・R-15・R-26・O-01・O-04・O-05・O-09・O-10・O-13・O-15・O-24・O-25・O-30・O-44・O-51・I-02・I-10・I-17・I-19・I-20・I-22・I-27・I-28・I-37・C-03・C-04・C-10・C-17・C-23）、却下 8 件（O-02・O-16・O-23・I-03・I-11・I-16・I-33・C-25）。詳細は [catalog.md](catalog.md)・[rejected.md](rejected.md)。

### フォルダのほかのファイル

- 操作と計測のスクリプト（playwright-cli の run-code 用）: `ideal-scenarios.js`・`ideal-wait.js`・`inject.js`・`inject2.js`・`login.js`・`measure.js`・`owned-scenarios.js`・`owned-scenarios2.js`
- `.playwright-cli/`: playwright-cli が自動で残したページのスナップショット（YAML）

