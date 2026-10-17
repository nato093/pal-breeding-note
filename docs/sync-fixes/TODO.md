# TODO（sync-fixes）

> [README.md](README.md) を先に読む。ここは進み具合の記録。
> 終わった項目は `- [x]` にし、テーマを終えたら「状態」の行にブランチ名とマージのコミットを書く。セッションを終えるときは末尾の「次にやること」を書き直す。

## 進め方の決まり

- 1 テーマずつ `feature/<key>`（統合ブランチ `integrate/sync-fixes` から切る）→ `integrate/sync-fixes` へ `--no-ff` でマージ。main への反映と push は、全体の報告の後にユーザーの確認を得てから。
- テーマ 6〜8 は事前確認（P0）の後。テーマ 3 は P0 の前に作り始めてよいが、本番への反映は P0 の後。
- 各テーマで `web/js/release-notes.js` の先頭に 1 件（title 20 字・body 60 字以内）。
- 公開リポジトリ: 実在のプレイヤー名・ワールド名・ID・ユーザー名入りのパスを書かない（コミットの前に `git grep` で確かめる）。実験の記録は `Claude outputs/sync-fixes/`（Git の対象外）。
- Codex（delegate-codex）は、この作業ではレビューにも実装にも使ってよい（2026-10-16 のユーザーの許可）。出力は未信頼として、git status とテストの終了コードで確かめる。

## 事前確認（P0）

- 状態: 済み（2026-10-17 の 04:04〜04:41 にユーザーがホストし、同期を 1 回通した）。結果と決めたことは README の「P0 の結果」「P0 で決めたこと」
- [x] 実験のページを `Claude outputs/sync-fixes/probe/` に用意する（FileSystemObserver と Worker の 5 秒の確認を並べて、1 回の保存のファイルの順番・間隔・通知の種類・裏での遅れを記録）（→ 手順は同じフォルダの README.md。`node "Claude outputs/sync-fixes/probe/serve.mjs"` → http://127.0.0.1:5190/。記録は同じフォルダの `logs/`。ユーザーにはワールドのフォルダの実際のパスつきの手順を 2026-10-16 にチャットで渡した）
- [x] `check:save` に `Level.sav` の中の保存時刻（生のティック・日本時間として読んだ時刻）とファイルの更新日時を分けて出す（→ リポジトリの check:save ではなく、実験のフォルダの `snap.mjs` が出す。同期の前後で 1 回ずつ走らせる。手元の 1 ワールドでは、Level.sav の中の保存時刻〔日本時間として読む〕はファイルの更新日時の約 0.4 秒前で、LevelMeta.sav の Timestamp は Level.sav と同じティックだった）
- [x] ユーザーがホストで約 15 分遊び（タブを裏に 5 分より長く）、ゲームを終えて SaveSync の同期を 1 回通す（→ 約 36 分・保存 72 回・25 分続けて裏。サーバーと `snap.mjs` は Claude が動かした）
- [x] 同期の前後の更新日時・作成日時・LocalData.sav の変化を記録する（→ ホストの PC だけ。同期はセーブのファイルを書き換えず、`Players/savesync.sav` が作られただけ。受け取る側の PC は見ていない）
- [x] 結果で、テーマ 3 の比べ方・テーマ 6 の `quietMs`・`maxWaitMs`・テーマ 7 の「ゲーム中」の判定を確定し、README との違いを書く（→ 3 と 7 はプランのまま。6 は `quietMs` 1,000 ms〔ホストのワールドは Level.sav が変わってから数える〕・`maxWaitMs` 10,000 ms・Worker の Observer を第一に）
- [x] （追加）同じ日の 10:30、実験のページを開いたままにしていたため、同期を受け取るときに SaveSync が止まり、ワールドが `LocalData.sav` だけになった（12:07 に SaveSync を起動し直して戻った）。作業用のフォルダで再現し、原因が `Players` の中のファイルの Observer だと確かめた → テーマ 6 は Observer をワールドのフォルダの直下のファイルだけにする（README の「P0 の結果」「P0 で決めたこと」）。受け取る側の SaveSync の書き方も分かった（中の時刻はそのまま）

## 1. dps-position（S）

- 状態: 実装済（feature/dps-position。integrate/sync-fixes へのマージのコミット 5087ea1）
- [x] `dpsLabel`・`DPS_LABEL`・`parseBoxLabel(label, kind)`・`boxShort(pal)`（core/owned.js。palboxLabel と BOX_LABEL は変えない）
- [x] `normalizeOwned` で dps にも位置、`ownedFromShared` で dps も読み戻す
- [x] 表示（fillWhereCell・palBrief・holderSummary）
- [x] テスト（core/owned・owned-view・route-view）と所持パルの perf の前後の比較
- [x] OPERATIONS.md・release-notes

## 2. dps-missing（M）

- 状態: 実装済（feature/dps-missing。integrate/sync-fixes へのマージのコミット 5dcfcce）
- [x] buildSnapshot で集合の差（`stats.inLocker`・`stats.inLockerMissing`）
- [x] `dimensionGap` と案内（所持パル・ヘッダー・理想個体）
- [x] 参加者への `dpsGap`（sharedUpload → cleanOwnedPlayer → build:gas → boundary の cleanSharedPlayers → ownedFromShared）と参加者の案内
- [x] 登録モーダルの 1 行・check-save の 1 行
- [x] テスト（集合の差・案内の各場合・往復）
- [x] OPERATIONS.md・SAVE_FORMAT.md・release-notes

## 3. owned-gas（L）

- 状態: 実装済（feature/owned-gas。integrate/sync-fixes へのマージのコミット faf146a。GAS の反映はユーザーに依頼）
- [x] スナップショットに `world.savedAtTicks`、`compareSaves`（core/owned-shared.js）、boundary の cleanWorld で保存印を残す
- [x] 送る world の中の識別（saveStamp・contentHash・format・fileCount・missingCount・force）と列 `saveKey`（先頭に uploadedAt）
- [x] 結果の種類（new・newer・stale・unchanged・resent・same・識別なし）と応答の published・cleanup
- [x] F1 世代の書き込み（①行 → ②公開 → ③掃除）と読み込み（世代で絞る・PARTIAL）・削除
- [x] `ownedSince`・`presence`（CacheService・索引の短い鍵・env の分離）
- [x] `compactOwned(env)`・`resumeOwned(env)`・停止の印
- [x] api.js・mock-api
- [x] `scripts/owned-bench.mjs`（URL を環境変数で・テスト環境の確認・自分の worldId だけを片付ける）と api-check の URL の指定
- [x] テスト（gas・harness・compareSaves・往復・古い GAS＋新しい画面・新しい GAS＋古い画面）
- [x] `gas:push`（2026-10-16 13:29。Claude が統合ブランチの写しの作業フォルダから `clasp push --force`。HEAD だけが変わり、本番の deployment は版 10 のまま）
- [x] GAS エディタで `setup()`（2026-10-16 にユーザーが実行。列 `saveKey` が test・prod に足された）
- [x] 版 11 を作る → テスト用の deployment（2026-10-16 19:16 に統合ブランチ 8a3a293 の中身で `clasp push --force` をし直してから `create-version`〔版 11〕・`create-deployment -V 11 -d "owned-gas test (sync-fixes)"`。ID は `npx clasp list-deployments` の説明で見分ける。本番の deployment は版 10 のまま）
- [x] 計測（2026-10-16 の夜。ユーザーに「誰も遊んでいない」と確かめてから。数字は下の「計測の結果」）と `api-check`（17 項目すべて OK）
- [x] 巻き戻しのリハーサル（prepare → テスト用の deployment を版 10 → ユーザーが `compactOwnedTest()`〔2 ワールド・古い世代 100 行を消す〕→ legacy-write〔今の世代だけが読め、3 倍の体数も書けた〕→ ユーザーが `resumeOwnedTest()` → 版 11 → finish〔newer で書けて読め、ownedSince も変わらないを返し、ワールドを消した〕。すべて通った）
- [ ] 計測の数字で、テーマ 4〜8 の値（間隔・閾値）を見直す（テーマ 5 の最短 15 秒は、1 回の共有 13〜15 秒に対してそのままでよい。6〜8 は P0 の結果と合わせて決める）
- 計測の結果（テスト用の deployment・版 11。「中央値／95%／最大」）:
  - ホスト 1 人・1 ワールド 4,600 行・読み手 3・30 秒ごと: ownedUpload 13.4／14.9／14.9 秒、ownedSince 2.9／5.9／7.0 秒、owned 4.6／6.0／6.4 秒、鍵の待ち（probe）2.8／15.4／39.6 秒。失敗 0
  - 3 ワールド計 4,600 行・3 人が同時に 30 秒ごと: ownedUpload 11.4／27.2／27.4 秒、ownedSince 4.8／7.5／30.1 秒。同じく 15 秒ごと（実際よりずっと重い）: ownedUpload 11.3／19.4／22.7 秒、鍵の待ち 6.5／21.4／24.4 秒（上限 25 秒に近い）
  - 3 回とも、途中の中身（世代の混ざり・数の食い違い）・PARTIAL・掃除の失敗は 0 回。同じ要求の送り直しはすべて unchanged
  - **GAS の応答がまれに `doGet` の形になる**: echo の URL（`script.googleusercontent.com/macros/echo`）が 302 で `/exec` への GET に戻し、`doGet` が `{ ok, service, api }`（`env` なし）を返す。echo が 404 の HTML を返すこともある。どちらも `doPost` は動いた後で、応答だけを失う。画面の `api.js` は RESPONSE として 1 回送り直す（共有の送信なら識別のおかげで unchanged）。計測のスクリプトはこれを「テスト環境以外の応答」とみなして止めてしまっていた（最初の計測が止まり、後片付けを手で行った）→ ユーザーの答えで直した（fix/bench-doget-response。マージ 64baaf8。NO_ENV と数えて止めず、読むだけの確かめは読み直し、応答を失った・送り直しで書けた世代を最後の読みで認める。env が prod・形の分からない応答で止めるのは今までどおり）
- [x] OPERATIONS.md（反映・巻き戻し・タイムゾーンの前提）・SAVE_FORMAT.md・release-notes

## 4. share-fetch（M）

- 状態: 実装済（feature/share-fetch。integrate/sync-fixes へのマージのコミット 396118f）
- [x] fetchShared を ownedSince に（できることを覚える・BAD_ACTION で落とす・一覧は 5 分ごと・変わらなければ作り直さない）
- [x] 安全網（生の行数と palCount・PARTIAL・確定として保存しない・古い応答を捨てる・送信の応答も）
- [x] app.js の 10 秒の 1 本と keepRefreshing の廃止
- [x] テストと release-notes

## 5. share-upload（M）

- 状態: 実装済（feature/share-upload。integrate/sync-fixes へのマージのコミット 1e36e38）。実装は別のセッションが c87adc7・08b2dd4（Codex のレビューの直し）まで進めて止まり、書きかけの差分（中身の印の行の並べ方を速くする）を 42e1ef7 として引き継いだ。`npm test`・UTC は 1852 件すべて通過。`test:perf` はゲームが動いている間に 5〜6 件落ちたが、変更前のコード（5a54c37）でも同じ条件で 7 件落ちたので、CPU の混み具合による揺れ（テーマ 5 はその処理に触れていない）
- 決めたこと（詳しくは OPERATIONS.md の「共有の世代とセーブの識別」）: contentHash は `core/owned.js` の `ownedContentText`（識別・送った人・saveUpdatedAt を入れず、行・一覧・鍵の並びによらない）の SHA-256。format は `OWNED_FORMAT`（今は 4）で、古い GAS に合わせて列を狭めたら外した列の数だけ下げる。送れなかったときの再試行の段は、同じワールドのセーブの読み直し（holdUpload）では残し、登録の削除・解除・別のワールド（blockUpload）では消す
- [x] 送信中は dirty・最短 15 秒・再試行の段
- [x] 識別を送る・force・応答をスナップショットの印と組にして残す
- [x] テスト（応答を失った後の再送・読み込み直し・古い GAS）と release-notes

## 6. save-watch（L・P0 の後）

- 状態: 実装済（feature/save-watch。integrate/sync-fixes へのマージのコミット 960bfd9）。実装は担当のエージェント（481a4b8〜09b48b2）、親が 6d01d93（Observer を今のワールドだけに）と、Codex のレビュー 2 回（1 回目 中 2・低 1 → 5b482e5 で直した。2 回目「高・中の問題は残っていない」）、49bf897（「今すぐ読み込む」の held の知らせ）。`npm test`・UTC は 1887 件すべて通過。`test:perf` はゲームが動いている間に変更後 8 件・5 件、変更前（89d13c8）6 件が落ち、落ちたのはどちらも配合の計画・理想個体・共有の行の変換の予算（テーマ 6 は触れていない。CPU の混み具合による揺れ）。実機は未確認（下の「次にやること」）
- 決めたこと（詳しくは OPERATIONS.md の「セーブの見張り」）: 見張りは `web/js/save/watch.js`（Worker の中の `createSaveWatcher` と画面側の `createWatchClient`。Worker は `save/worker.js` の `type: 'watch'`・`'stop'`）。**Observer に渡すのは今のワールドの直下のファイルだけ**（画面側の `watchTargets()` の `observe` と Worker 側の `observable()` の 2 か所で守る）。ほかの登録したワールド（Level.sav・LocalData.sav）・`Players`・`GlobalPalStorage.sav` は 5 秒ごとの確認だけ（README のプランの「他の登録したワールドも Observer」から変えた。Chrome が押さえるフォルダを 1 つにする）。見張る対象から外すのは許可のないワールドだけ（一時的に読めないワールドは残す）。読み直しの保留は `readAuto` の `'held'`（前後の印の違いは 1 秒後、登録したファイルの失敗・消失は 1・3・10・30 秒で 30 秒続いた形は受け入れて覚える、見張りからの読めない失敗は 1・3・10 秒）。保留のタイマーは画面のスレッド（裏のタブで遅れるかは未実測）。**張り直しの直し（2026-10-17。ユーザーの了承。feature/save-watch-rearm・マージ 893fa3a）**: ファイルが 1.3 秒より長く消えて張り直しを諦めた（最初の observe に失敗した）ファイルも、5 秒ごとの確認でファイルが戻ったのに気づいたら張り直す（README の「次の許可・登録の変更で張り直す」から変えた。SaveSync の同期の受け取りの後も、読み込み直さずに Observer に戻る）。Observer に渡すのは今までどおり Observer で見張るはずのファイルだけ
- [x] 見張り（Observer の張り直し・unknown・許可・世代番号・Worker への切り替え）
- [x] 一式の書き終わりの確認（前後の印・登録したファイルの失敗と消失を 30 秒まで読み直す・壊れたファイル）
- [x] watchTargets・refreshFromWatch・パネルの「監視」の行（**Observer に渡すのはワールドのフォルダの直下のファイルだけ。`Players` の中は Worker の 5 秒ごとの確認だけ**。見張ると SaveSync の同期を壊す〔README の「P0 の結果」の事故〕。テストで確かめる）（→ `test/save/watch.test.js` と `test/web/owned-store.test.js` で、Players・GlobalPalStorage.sav のハンドルが `observe()` に渡らないこと、止めた見張りに張り直さないことを確かめている）
- [x] 「1 分ごと」の文言（→ `HOST_SUMMARY` は「ゲームが保存するたびにセーブを読みます」。過去の release-notes は直さない。`docs/COMPARISON.md:17` の「1 分ごとに読み直す」は範囲の外として残した）
- [x] テスト（watch・owned-store・app・wording）と OPERATIONS.md・release-notes
- [x] 実機の確認の「B」（2026-10-17 の 15:15〜15:56。手順は `Claude outputs/sync-fixes/b-test/README.md`。893fa3a のアプリを 5191・モックで開き、ユーザーがホスト中のワールドを保存の直後に作業用のフォルダへ写して登録）: 3 回とも、アプリが「ファイルの変更」で見張っている間に SaveSync と同じ順（`LocalData.sav` 以外を全部消す → すぐ空の `Players` を消す）で `Players` を**すぐ消せた**（1 回目 ドロップの直後、2 回目 ページを開き直した後〔IndexedDB から読み出したハンドル〕、3 回目 開き直さずにファイルが一度消えた後〔同期を受け取った後と同じ。張り直しの直しの後〕）。どの回も保存の真似（`LocalData.sav` → 0.8 秒後に残り）で、パネルが「ファイルの変更 · 最後の保存 〈その時刻〉（7 ファイル・0.8〜1.4 秒）」になった → **IndexedDB から読み出したハンドルも Worker で observe できる**。**実機の確認で同期を受け取る前にページを閉じる（A）は要らない**
- [ ] 実機の確認（ユーザーがホスト。Chrome）: パネルの「監視」が「ファイルの変更」になり、「最後の保存」が約 30 秒ごとに進む・タブを裏に 5 分より長く置いても遅れない・SaveSync の同期を受け取った後も「ファイルの変更」のまま読む。Edge

## 7. host-rotation（M・P0 の後）

- 状態: 実装済（feature/host-rotation。integrate/sync-fixes へのマージのコミット a4a819f）。実装は担当のエージェント（03b5044〜a4b1a9d）と、Codex のレビュー 2 回（1 回目 高 1・中 3 → 1a56830・fad6648 で直した。2 回目は中が解消、高は下の「残した危うさ」だけ）。`npm test`・UTC は 1927 件すべて通過。`test:perf` はゲームが動いている間に 3 件（パルリバーサー・共有の 20,000 行の変換・目標の一覧の予算）が落ち、変更前（971a13d）でも同じ条件で同じ 3 件が落ちた（CPU の混み具合による揺れ。テーマ 7 は触れていない）。実機は未確認
- 決めたこと（詳しくは OPERATIONS.md の「ホストの交代（SaveSync）」）: ゲーム中の推定は `web/js/core/playing.js`（`owned.js` の `state.play`）。変化の間は**見た時刻ではなく値の差**（ホストは Level.sav の中の保存時刻、参加者は LocalData.sav の更新日時）で測る（裏のタブの遅れにも、同期で更新日時が元に戻ることにもだまされない）。見張りのやり直しで数え直すのは、前に見張りの対象があったときだけ。「共有が止まっています」は、今のワールドの共有を 60 秒以内に取得できていて（`shared.fetchedWorldId`）、取得の失敗がないときだけ出す（参加者のタブは裏で共有を読まないため）。自動登録の判定（`verdicts`）は牧場の記録に残し、`state.upload` の送ったときの環境（`scope`）が今の環境と同じものだけを使う。自分の ID の `same`（同じ PC の別のタブ）は mine。識別のないセーブの done は更新日時で前の候補を決める。書く直前に最新の記録の判定と和を取り、候補に当て直す
- 残した危うさ: (a) 同じ PC の 2 つのタブが、同じワールドの自動登録の記録を数 ms の差で書き合うと、片方の判定が消えることがある（localStorage はタブの間で排他されない。Codex の 2 回目の高。テストの偽の保存先で処理の途中に割り込ませて再現したもの）。最悪でも、別の PC の担当だったセーブのタマゴを登録しにいくだけで、重なった登録は GAS の重複の判定で断られる。完全に防ぐにはタブの間の排他（Web Locks など）が要るが、プランで入れないと決めている（README の「ユーザーの決定」の後の既定）。(b) 配信の前の版のまま開いているタブは、保留の候補も登録し、記録の新しい項目を落とす（配信の後はタブの読み込み直しが要る。OPERATIONS.md）。(c) 本番の GAS が版 10 の間は `stored` が mine になるので、同期で受け取ったセーブでも今までどおり登録する（効くのは版 11 の後）。(d) 参加者の LocalData.sav が約 30 秒ごとに書かれるかは実測していない（P0 はホストだけ。書かれなければ「共有が止まっています」は出ない）
- [x] 「ゲーム中」の判定（直近 2 分・続けて 2 回・数え直し）
- [x] shareLagNotice・名指しの直し・登録の案内
- [x] 自動登録の候補を「配合のキー＋saveStamp」ごとの 3 状態にし、応答ごとの表で決める
- [x] テスト（auto-register の各経路・owned-status・save-status・owned-settings）
- [x] OPERATIONS.md（ホストの交代〔SaveSync〕の節）・release-notes
- [ ] 実機の確認（ユーザーがホスト・参加者の両方）: ホストのパネルの「この PC」の行の 1 行目（最終レビューの前は「ゲーム」の行）が約 1 分で「ホスト中（推定）」になり、ゲームを終えて約 2 分で「ホスト用のセーブあり」に戻る。参加者の LocalData.sav が約 30 秒ごとに書かれ「参加中（推定）」になる。ホストのページを閉じて約 5 分で、参加者の画面に「共有が止まっています」。同期を受け取った PC のページは、自動登録しない（設定の「登録待ち」に出ず、ベルの通知も増えない）

## 8. page-presence（M・P0 の後）

- 状態: 実装済（feature/page-presence。integrate/sync-fixes へのマージのコミット c582c28）。実装は担当のエージェント（e3e18a1〜32a4506）と、Codex のレビュー 1 回（中 3・低 1 → 921a6d8 で直した）。担当が、テーマ 4 の既存のテスト（共有の送信中に保存先が替わる）が並べて流すと時々落ちるのを、送信が GAS に届くのを待つ形に直した（13766c8。テストだけ）。`npm test`・UTC は 1947 件すべて通過。`test:perf` はゲームが動いている間に 5 件が落ち、変更前（e54d16d）でも同じ条件で 5 件が落ちた（配合の計画・パルリバーサー・共有の 20,000 行の変換・目標の一覧の予算。テーマ 8 は触れていない）。実機は未確認
- 決めたこと（詳しくは OPERATIONS.md の「ページを開いている PC」）: GAS は変えていない（テーマ 3 の `presence`・`ownedSince` のまま）。送るのは `owned.js` の `reportPresence`（`app.js` の 10 秒ごとのタイマーで、読み直しの後に呼ぶ。表でも裏でも）と、共有の読み直しの `ownedSince` への相乗り。相乗りは表のタブの参加者だけでなく、`ownedSince` を呼ぶ回のすべてのページ（表のタブのホスト・連携していない人も）。60 秒に 1 回（5 秒の余裕）に加えて、ワールド・値（役割・ゲーム中・共有できる）が変わったら次の回に送る。`canShare` は「このワールドをホストの一式〔Level.sav・LevelMeta.sav・LocalData.sav〕で登録＋直近の一覧で許可待ちでない」（Players は問わない）。表示の役割は 1 台に複数のタブがあれば host → guest → none の順に選ぶ。「（PC 2）」の番号は今の一覧に残る PC の ID の順（見る人によって入れ替わらない。古い PC が一覧から消えると繰り上がることがある）、この PC は「（この PC）」。経過は応答のサーバーの時刻で測る。7 の案内への添え書きは「3 分以内に応答があったほかの PC」（この PC と ○ は除く）。一覧は `state.pages`（環境が替わったら空）。Codex のレビュー（高 0・中 3・低 1）を直した: 遅れて届いた前のワールドの presence の応答は捨てる、自動の読み込みが許可待ちで止まっている間は canShare を false、古い GAS（BAD_ACTION）と分かったら前の一覧も消す、「PC 2」の番号の説明
- [x] 送る側（60 秒・ownedSince への相乗り・pageId・device・古い GAS）
- [x] 表示（● ○・3 分以内だけでまとめる・6 時間）と 7 の案内への添え書き
- [x] テストと release-notes（owned-store・owned-status・save-status・app・mock-api）と OPERATIONS.md
- [ ] 実機の確認: パネルの「ページを開いている PC」に、この PC が ●（「（この PC）」・役割）で出る。2 つ目のブラウザ（か PC）で開くと両方が出て、片方を閉じると約 3〜4 分で ○「最近の応答なし」になる（本番は版 12 の後。それまではテスト用の deployment で）

## 終わり

- [x] `npm test`・UTC でも・`npm run test:perf`（2026-10-17 の夜、最終レビューの直しの後の bfaed80 で 1957 件すべて通過〔UTC も〕。`test:perf` はゲームが動いている間に並べて流すと共有の 20,000 行の変換の 1 件が落ち、`--test-concurrency=1` では 15 件すべて通過）
- [x] 観点別のエージェントと Codex でレビューし、直す（下の「最終レビュー」）
- [ ] 実機の確認（README の「検証」の 3〜6。6・7・8 の最後の項目）
- [ ] `api-check`（テスト用の deployment・版 12。テスト用シートの記録を全部片付けるので、5192 の実機の確認が終わってから）
- [ ] ユーザーに依頼: 本番の GAS の反映（OPERATIONS.md の「GAS の反映」の 7。版 12）→ 配信
- [ ] 全体の報告（変更したファイル・実行したコマンド・確かめ方・残した課題）

### 最終レビュー（2026-10-17 の夜）

- 観点別のエージェント 3 体（テーマ間の状態と非同期の競合・配信の順番と互換・文言と文書と公開リポジトリ）と Codex（テーマをまたぐ不具合と互換）で `main...integrate/sync-fixes` を読んだ。公開リポジトリの値の漏れはなし。Observer に渡るのはワールドのフォルダの直下のファイルだけ（2 か所で守っている）。
- 直したこと（fix/final-review・マージ b6e8948、fix/final-wording・マージ 6cf7c5a、fix/final-review-force・マージ 2b7eb64）:
  - 【高】共有の送信で、中身の印の計算中にログインの環境が替わると、替わった後の環境に書き込んでいた → 送る直前にも確かめる。捨てた送信とログインの前に読んだセーブは、環境が決まったら新しい環境に送る（登録の確定の印も残す。Codex の再レビュー）。テーマ 8 の担当が「並べて流すと時々落ちる」としてテストを直した（13766c8）のは、この不具合を拾っていた（元の形のテストも足した）。
  - 【高】古いタブ（識別を送らない画面）が、識別のある同じセーブの共有を同じ時刻で上書きできた → `decideOwnedUpload` で same（GAS の版 12。ユーザーの了承。2026-10-17 21:48 に gas:push・版 12・テスト用の deployment を版 12。本番は版 10 のまま）。
  - 【中】遅れて届いた送信の応答で、後から読んだ新しい共有を古い方に戻していた（main からある）→ サーバーの時刻で比べて戻さない。
  - 【中】保存の途中（LocalData.sav が先・Level.sav が最大 2.74 秒後）にタイマーの読み直しが当たると、ホストが一瞬「参加者」と判定され、共有の予約・ゲーム中の推定が消えていた → `GUEST_AFTER_MS` を 60 秒、見張りが動いている間はタイマーからの読み直しも transient、LocalData.sav だけが変わったときは読み直さない（`readSignature`）。
  - 【低】ほかのワールドの登録の変化でゲーム中の推定を数え直していた → 今のワールドの見張りの対象だけで比べる。
  - 文言: 参加者の案内で同じ警告が 2 つ並ぶ・パネルの見出しが長く本文が狭まる（「ゲーム」の行は「この PC」の 1 行目へ、「ページを開いている PC」は表の幅いっぱいに）・ヘッダーで押せないボタン名・同じセーブの知らせを帯に出さない・PARTIAL の文など。更新内容の通知は、ユーザーの了承で 8 件を 3 件にまとめた（「各テーマで 1 件」は今回はまとめた。まだ配信していない id なので既読の判定は壊れない）。
  - 文書: OPERATIONS.md の「GAS の反映」を版 12 に（`-V`・`-d` を付けて ID で確かめる・GAS が先・停止の印の確認・配信の後は最後にホストした PC で最初に開く・全員のタブを読み込み直す）。
- 残したこと: 古いタブが残る間は新しい保護（同じセーブの same 以外の判定・自動登録の判定）が効かない（全員のタブの読み込み直しで防ぐ）。版 12 の最初の共有だけは更新日時で比べる（最後にホストした PC で最初に開く）。参加者の判定は最大約 1 分遅れる。GAS の呼び出しは、ホストの表のタブで約 8 回/分・参加者の表のタブで約 6 回/分（ホスト＋参加者 3 人で約 27 回/分。README の見込みの内）。

## 次にやること

- **2026-10-17 の夜（セッション a95dcb3f）: テーマ 1〜8 と最終レビューの直しは統合ブランチにマージ済み（bfaed80 まで）。GAS は版 12 を作り、テスト用の deployment を版 12 にした（本番は版 10 のまま）。次は上から順に:**
  1. テーマ 6・7・8 の実機の確認（6・7・8 の最後の項目）。ユーザーがホストしている間に、統合ブランチの別の作業フォルダ `Claude outputs/worktrees/live-check`（`web/js/config.js` だけをテスト用の deployment の URL に書き換えてある。コミットしない）を 5192 で配っている（`PORT=5192 node "Claude outputs/worktrees/live-check/scripts/dev-server.mjs"`。中身を新しくするには、その作業フォルダで `git checkout --detach <コミット>`。config.js の書き換えは残る）。ユーザーはテスト用のパスワードでログインし、ホスト中のワールドを登録する（本番の共有・配合牧場には書かない）。参加者の側は、この形では確かめられない（本番の版 12 の後か、別の人がホストする日）。終わったら 5192 のサーバーを止めて `git worktree remove --force "Claude outputs/worktrees/live-check"`。
  2. 実機の確認が終わってから `PAL_API_URL=<テスト用の /exec> node scripts/api-check.mjs`（版 12。テスト用シートの記録を全部片付ける）。
  3. 全体の報告 → ユーザーの確認を得てから、本番の GAS を版 12 に（OPERATIONS.md の「GAS の反映」の 7）→ main にマージして push・配信 → 最後にホストした PC で最初に開く → 全員のタブを読み込み直してもらう。
- **始める前に、ほかのセッションが同じ作業ツリーで動いていないかを `ListAgents` と `git status` で確かめる**（2026-10-16 の夕方、別のセッションが同じテーマ 5 をこの作業ツリーで進めていて重なった。こちらが切ったブランチと相手の未コミットの変更がぶつかりかけた）。
- 進め方で効いた形: テーマごとに実装担当のエージェント（general-purpose）を 1 体立て、`feature/<key>` へのコミットまで任せる。親は `git status`・`npm test`（終了コード）・差分の個人情報（実在のプレイヤー名・ワールド名・ID・ユーザー名入りのパス。調べる語の一覧は文書に書かず、親のメモリの「公開リポジトリに個人情報を書かない」から取る）を確かめてから `--no-ff` でマージする。担当には README の節を読ませ、「範囲の外は直さない・push しない・`Claude outputs/` に触れない」を必ず添える。
- 気づいたこと: (a) 作業ツリーは担当がブランチを切り替えながら使うので、GAS の push のように統合ブランチの中身が要る作業は `git worktree add "Claude outputs/worktrees/<名前>" integrate/sync-fixes` の別の作業フォルダで行う（`.clasp.json` は Git の対象外なので写す。clasp はリポジトリの `node_modules/.bin/clasp` を使う。`build:gas` の後の gas/Shared.js の差分は改行だけ）。使い終わったら `git worktree remove`（`Claude outputs/worktrees/sync-gas` の空のフォルダが権限で消せずに残っている。消してよい）。(b) `npm run test:perf` は、ゲームが動いて CPU が埋まっていると、共有の 20,000 行の変換（予算 200ms）とパルリバーサーの D17（予算 2 秒）が揺れて落ちる。変更前のコードでも同じように落ちた（予算は変えない。`--test-concurrency=1` でも流して比べる）。(c) テーマ 4 で 10 秒ごとに `pollAuto` を呼ぶようになったので、ホストの裏のタブも 20 秒ごとにセーブを確かめる（長く裏にあると Chrome が 1 分に 1 回まで遅らせるのは同じ。見張りはテーマ 6）。(d) 本番の GAS は版 10 のままなので、新しい画面は ownedSince を 1 時間に 1 回試して BAD_ACTION で今の 2 回呼びに落ちる。
