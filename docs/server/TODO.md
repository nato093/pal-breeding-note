# TODO（server）

> [README.md](README.md) を先に読む。ここは進み具合の記録。
> 終わった項目は `- [x]` にし、テーマを終えたら「状態」の行にブランチ名とマージのコミットを書く。セッションを終えるときは末尾の「次にやること」を書き直す。

## 進め方の決まり

- 1 テーマずつ `feature/<key>`（統合ブランチ `integrate/server` から切る）→ `integrate/server` へ `--no-ff` でマージ。main への反映と push は、全体の報告の後にユーザーの確認を得てから。
- T1 と T2 は同じ配信で `OWNED_FORMAT` を 1 回だけ上げる（README の「テーマ間の取り決め」）。T5（常駐）は T1〜T4 の後。
- release-notes は v13 の配信で 1〜2 件にまとめる（テーマごとには足さない。統合のときに足す）。title 20 字・body 60 字以内。
- 公開リポジトリ: 実在のプレイヤー名・ワールド名・ワールド ID・インスタンス ID・Steam ID・作成者の UID・LAN の IP・パスワードを書かない（テストはダミー値）。コミットの前に `git grep` で確かめる（調べる語は親のメモリの一覧から。文書に書かない）。実験の記録は `Claude outputs/server/`（Git の対象外）。
- Codex（delegate-codex）は、この作業ではレビューにも実装にも使ってよい（2026-10-18 のユーザーの許可）。出力は未信頼として、git status とテストの終了コードで確かめる。
- テストのインスタンスの起動・停止は Claude が行ってよい（2026-10-18 のユーザーの許可）。ServerSync のローカル API で使ってよいのは、状態の読み取り・start・stop・backup だけ（revert はユーザーの了承の後）。

## P0 実機の確認とゲーム設定

- 状態: 済み（2026-10-18 の 13:37〜15:49）。結果と決めたことは README の「P0 の結果」「P0 で決めたこと」
- [x] `scripts/server-settings.mjs`（差の表。既定は読み取りのみ・`--apply` は止まっている間だけ）とテスト（cc029d8）
- [x] 計測の道具（`Claude outputs/server/p0/watch.mjs`。1 秒ごとの stat だけ）
- [x] バックアップ（ServerSync は前回から変化なし〔409〕で最新の自動バックアップが今の状態。サーバーの SaveGames・ini と協力プレイのワールドの写しは `<バックアップのドライブ>\pal-backup\<日時>\`）
- [x] 設定の差の表をユーザーに見せて決めてもらい、止まっている間に直す（9 項目を協力プレイに。`bAutoResetGuildNoOnlinePlayers` は false のまま）
- [x] 計測の通し（PC が 1 時間スリープしたが、その後にユーザーが参加して預け直し・退出・停止・ゲームの終了まで）
- [x] 結果と決めたことを README に書く（「同じ中身なら送らない」は入れない・稼働の判定は `status.running`・サーバーの PC はスリープしない）
- [ ] （T6 で）REST（8212）の待ち受けのアドレスを、サーバーが動いている間に `netstat` で見る

## T1 identity（大）

- 状態: 実装済（feature/identity。integrate/server へのマージのコミット a983caf。T2 と同じブランチ）
- [x] スナップショット・共有の players に `instanceId`、`world.clock`、汎用のワールド名を捨てる（754557c）
- [x] 鍵（`i:`・`u:`）と `HOST_UID` を `core/owned-shared.js` の 1 か所に（754557c）
- [x] `formers`（ワールドにいない UID。H は「以前のホスト」）と表示（754557c）
- [x] `HOST_UID` の決め打ちを H がいるワールドだけに（754557c）
- [x] このワールドでの自分を `i:` で持つ・移す（H は手元のホストのときだけ。c783d15）。レビューの直しで、値を `i:<InstanceId>|<UID>` にし、InstanceId のない共有（版 12・古い画面）でも別の人に替えない（f855f3c）
- [x] `resolveRegistrant` の「対応が同じ ID なら」（754557c）
- [x] サーバーのワールド（steamId `0`。必須ファイル・役割・名前〔`web/js/save/world-name.js`〕・`saveKind`。0cc1561）
- [x] `ownedOf` の不具合（f7356f3。取得の失敗でも手元に戻る ac5dc58）
- [x] GAS: `extras` 列（`at` で確かめる・`fitOwnedExtras`）・players の `instanceId`（1fe6b55・6ded4b5）
- [x] テスト（TZ=UTC npm test 2032 件・版 12 c1a29e7 との組み合わせ・実データで鍵と formers を確認）
- [ ] SAVE_FORMAT.md・OPERATIONS.md（T6 でまとめて）

## T2 share-extras（中。T1 と同じブランチで続ける）

- 状態: 実装済（feature/identity。マージ a983caf）
- [x] `soul`・`condition` の列（88e337a）
- [x] 捕獲数（players の `captures`・`fitOwnedPlayers`）・ケーキ（farms の `c`）・在庫（`extras.items`。別の `fitOwnedItems` は作らず `fitOwnedExtras` で詰める）（88e337a）
- [x] `ownedFromShared` で戻す・「ホストの画面」の文言（8de8363）
- [x] `OWNED_FORMAT` を T1 と合わせて 1 回で決める（4＋5＋1＝10）
- [x] テスト（往復・上限・版 12 の GAS との組み合わせ・版 13→12→13）。test:perf は全体で流すと共有 20,000 行が予算 200ms を超えることがある（変更前も同じ揺れ。単体・--test-concurrency=1 では通る）
- 残り: `web/js/ui/farm-board.js` の「中身はホストの画面で見られます」（T4 で見る）。文書の「共有しない」の記述（T6）

## T3 mapping（中〜大。T1 の後）

- 状態: 実装済（feature/mapping。integrate/server へのマージのコミット 378d1c4。T4 と同じブランチ）
- [x] GAS: `PlayerMap`・`PlayerMap_test`・`gas/PlayerMap.js`・`playerMap`・`playerMapSet`・rename（65579fe・98341d0・e548d78。同じ内容は書かない・鍵を増やして 200 を超えるときだけ断る）
- [x] `web/js/player-map.js`（`createPlayerMapStore`。e8efc40。レビューの直しで、書き込みはワールドごとに順に送り、判定には GAS に書けた対応だけを使う b397a38）
- [x] `auto-register.js` の `mappingFor`・`setMapping`・移行 `syncPlayerMap`（90cde95。レビューの直しで、対応の保存中は自動登録を待つ・前の版の H はこの PC がホストとして遊んでいるときだけ上げ、上げられなかった H は印に入れない bf70060）
- [x] 設定の「プレイヤーの対応」（誰でも・formers の行）・`nameMismatch`（da3c959・7c2da20）
- [x] このワールドでの自分の H の移行も、ホストとして遊んでいるときだけ（self-player.js の migrateShown。親が直した）
- [x] テスト（TZ=UTC npm test 2106 件。ミューテーション 70 個で穴を確かめて埋めた）
- 残り: 通知から「プレイヤーの対応」へ移るとき、通知の人の行ではなく最初の未設定の行へ移る（低。通知の形を変えるため見送り）。設定の欄を開いている間は 15 秒ごとに playerMap を読む（GAS の負荷は T6 で見る）。

## T4 participant-ui（小〜中。T1・T3 の後）

- 状態: 実装済（feature/mapping。マージ 378d1c4）
- [x] `saveKind` が server のときの文言（roleSummary・shareLagNotice・ワールド名・プレイ中の時点・roleLabel・参加の行。dca415d・6868ecb）
- [x] presence の `resident`（api.js の presenceFields・GAS・boundary・`createOwnedStore({ resident })`）と「サーバー（常駐）」の行（278fa04。状態はその行の「サーバー稼働中／停止中」だけ。協力プレイに戻した後も常駐が動いていれば行は出す〔Codex の低を見送った理由は TODO の履歴〕）
- [x] 登録のモーダルで `SaveGames\0` を断る・前の登録に削除を勧める 1 行・「協力プレイで交代でホストする人も」・farm-board の文（6868ecb・dca415d）
- [x] README の表記の決まり（サーバー・常駐）と wording.test

## T5 agent（大。T1〜T4 の後）

- 状態: 実装済（feature/agent。integrate/server へのマージのコミット 0391621。37 コミット）
- [x] `tools/server-agent/`（config・fs-handles・discover・server-state・kv-storage・log・lineage-guard・watch-client・gas-client・agent・dry-run・main）
- [x] サーバーが動いているか（ServerSync の status.running ＋ pid とこの PC の実行ファイルのパス。30 秒で確かめ直す。決められなければ unknown で共有も最後の送信もしない）
- [x] 停止のとき読み込みを止める（最後の送信は止まったと確かめたときだけ・最大 60 秒）・presence は常駐が自分で送る（resident・playing は動いていて保存が続いているか）
- [x] 古い系統の守り（判定待ち・attach の世代で古い判定を捨てる・止めた状態を KV に残す・受け入れの基準は読み込んだセーブと GAS の uploadedAt）と `createAutoRegister` の `paused`。自動登録の create も送る 1 回ごとに確かめる
- [x] GAS: 認証の後の失敗の応答にも env を付ける（Main.js。版 13 に入る）。常駐はすべての応答の env を確かめる
- [x] `install.ps1`（DPAPI・タスクの -DataDir）・`run-agent.ps1`（-Mode・子の node にだけパスワード）
- [x] 二重起動の防止は名前付きパイプ（Linux は抽象名前空間のソケット）
- [x] テスト（TZ=UTC npm test 2234 件。2 台の常駐の引き継ぎ・送る文字数・秘密が出ないこと・ミューテーション）。Codex のレビュー 4 回（最後は高・中・低とも 0）
- [x] 実機の --check（テストのインスタンス。読むだけ・何も書かない）
- 残り（T6 の実機で見る）: 共有のインスタンスを別の PC が動かしている間の ServerSync の running・pid・runningUsers。サブ PC での実行ファイルのパスと serverDir の一致。タスクの登録とログオンでの起動・DPAPI。常駐のループの attach は期限なし（--once だけ期限あり）。

## T6 統合・GAS 版 13・配信

- 状態: 実機の確認（test 環境）まで済み。最終レビュー中（作業フォルダ Claude outputs/worktrees/server-final・ブランチ fix/server-final-review）
- [x] 文書（OPERATIONS.md の新しい章「専用サーバー（ServerSync）と常駐（server-agent）」と「プレイヤーの対応（PlayerMap）」・SAVE_FORMAT.md・README）・release-notes 2 件（2026-10-19-server・2026-10-19-share-extras）・CI の fetch-depth: 0 と互換テストの必須化（feature/docs。マージ eb55981）
- [x] GAS: build:gas → gas:push（HEAD）→ setup()（2026-10-19 にユーザーが実行）→ 版 13 → テスト用 deployment（説明 "server test"）を -V 13 → api-check すべて OK（プレイヤーの対応の読み書きを含む）。本番は版 12 のまま
- [x] 常駐をこの PC の test 環境で（2026-10-19 の 10:55〜12:06。ID「サーバー」は --signup で Users_test に作った。データの場所は Claude outputs/server/agent-data）
  - サーバーの起動を検知して attach → 30 秒ごとに共有（1 回約 10 秒・約 69〜72 万字・結果は newer）・presence（resident・サーバー稼働中）
  - ユーザーが参加（11:26〜11:32）→ 共有の players の「プレイ中」が 1 人になり、退出の後の保存で 0 人
  - 参加者の画面（テスト用の deployment につないだ作業フォルダ Claude outputs/worktrees/server-test-page を 5193 で配り、playwright で test にログイン）: 「サーバーの PC の常駐プログラムが共有した所持パルを表示しています」・「「LC9」（サーバー）」・「● サーバー（常駐） · サーバー稼働中／停止中」・「プレイ中 〈名前〉（サーバーのセーブ 11:26 の時点）」・プレイヤーの対応の欄に「以前のホスト（0000…0001）· 拠点 62 体」
  - 閲覧者の画面から以前のホスト・2 人のプレイヤーの対応を選び、GAS（PlayerMap_test）に保存された（updatedBy も入る）。名前の不一致の案内は GAS の文になり、対応を選ぶと消えた
  - サーバーを止めた: 猶予 → 最後の保存を共有 → stopped で detach（lastUpload="sent"）→ presence だけ（サーバー停止中）。参加者の画面は警告にならない
  - stop.request で 2 秒以内に止まり、終了コード 0。記録・KV・標準出力にパスワードは出ていない
  - 見つけて直したこと: 設定の「プレイヤーの対応」の欄が、対応を読み終えてもすぐ出なかった（fix/players-render。マージ 4a0e703）
  - 実機で見られなかったこと: 牧場の新しいタマゴの自動登録（30 分待っても無人の牧場はタマゴを産まなかった。誰も近くにいないと拠点の牧場は進まないとみられる。仕組みは画面と同じで、常駐の結合テストで確かめてある。本番で遊ぶときに常駐の記録で見る）
- [x] REST（8212）の待ち受け: **0.0.0.0**（LAN の中から届く）。ファイアウォールに PalServer の実行ファイルを許可する規則がある。ServerSync のローカル API は 127.0.0.1 と ::1 だけ。→ サブ PC では 8212 をルーターで転送しない・外からの 8212 をファイアウォールで閉じるのを勧める（報告で提案）
- [ ] 最終レビュー（観点別 3 体＋Codex → 反証 → 直し）
- [ ] GAS の負荷: owned-bench は共有と読み直しだけ（対応の書き込み・自動登録を重ねる道具は未実装）。版 13 の形での計測は、本番の配信の後に Apps Script の実行数を見る形にする（実機で 30 秒ごとの共有は約 10 秒で通った）
- [ ] ユーザーへの報告と承認 → 本番の GAS（-V 13）→ 画面の配信 → 全員のタブの読み込み直し
- [ ] サブ PC の導入の手順（ユーザー）

## 次にやること

- **2026-10-19（セッション 4ca854cd）: 実機の確認（test 環境・版 13）まで済んだ。最終レビューのワークフローが作業フォルダ Claude outputs/worktrees/server-final（ブランチ fix/server-final-review）で動いている。** 終わったら直しを確かめて integrate/server へマージし、ユーザーに全体を報告して本番の配信の承認をもらう。
- 本番の配信の手順は docs/OPERATIONS.md の「GAS 版 13 の反映と巻き戻し」。テスト用 deployment（"server test"・版 13）は確かめ終わるまで残す。
- 片づけ: 作業フォルダ（Claude outputs/worktrees/server-docs・server-test-page・server-final）は使い終わったら git worktree remove。test 環境の Users_test の「サーバー」「検証A」と PlayerMap_test の行・OwnedWorlds_test のワールドは残してよい（test 環境）。
- 始める前に、ほかのセッションが同じ作業ツリーで動いていないかを `ListAgents` と `git status` で確かめる。
