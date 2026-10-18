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

- 状態: 未着手
- [ ] `scripts/server-settings.mjs`（差の表。既定は読み取りのみ・`--apply` は止まっている間だけ）とテスト
- [ ] 計測の道具（`Claude outputs/server/p0/`。1 秒ごとの stat だけ）
- [ ] バックアップ（ServerSync の手動バックアップ＋サーバーの SaveGames・ini と協力プレイのワールドの写し）
- [ ] 設定の差の表をユーザーに見せて決めてもらい、止まっている間に直す（決定 11・19）
- [ ] 計測の通し（無人 6 分 → ユーザーが参加して 10 分〔牧場の親の預け直し・タマゴ 1 つ〕→ 切断して 6 分 → 停止）
- [ ] 結果と決めたことを README の「P0 の結果」「P0 で決めたこと」に書く（M3 で「同じ中身なら送らない」を入れるか）

## T1 identity（大）

- 状態: 未着手
- [ ] スナップショット・共有の players に `instanceId`、`world.clock`、汎用のワールド名を捨てる
- [ ] 鍵（`i:`・`u:`）と `HOST_UID` を `core/owned-shared.js` の 1 か所に
- [ ] `formers`（ワールドにいない UID。H は「以前のホスト」）と表示
- [ ] `HOST_UID` の決め打ちを H がいるワールドだけに（core/owned.js・core/ideal-goals.js）
- [ ] このワールドでの自分を `i:` で持つ・移す（H は手元のホストのときだけ）
- [ ] `resolveRegistrant` の「対応が同じ ID なら」
- [ ] サーバーのワールド（steamId '0'。必須ファイル・役割・名前・`saveKind`）
- [ ] `ownedOf` の不具合（別のコミット）
- [ ] GAS: `extras` 列（`at` で確かめる・`fitOwnedExtras`）・players の `instanceId`
- [ ] テスト・SAVE_FORMAT.md・OPERATIONS.md

## T2 share-extras（中。T1 と同じブランチで続ける）

- 状態: 未着手
- [ ] `soul`・`condition` の列（`OWNED_FIELDS`・`OWNED_ADDED_FIELDS`）
- [ ] 捕獲数（players の `captures`・`fitOwnedPlayers`）・ケーキ（farms の `c`）・在庫（`extras.items`）
- [ ] `ownedFromShared` で戻す・「ホストの画面」の文言
- [ ] `OWNED_FORMAT` を T1 と合わせて 1 回で決める
- [ ] テスト（往復・上限・古い GAS との組み合わせ）・`npm run test:perf`

## T3 mapping（中〜大。T1 の後）

- 状態: 未着手
- [ ] GAS: `PlayerMap`・`PlayerMap_test`・`gas/PlayerMap.js`・`playerMap`・`playerMapSet`・rename
- [ ] `web/js/player-map.js`（`createPlayerMapStore`）
- [ ] `auto-register.js` の `mappingFor`・`setMapping`・移行 `syncPlayerMap`
- [ ] 設定の「プレイヤーの対応」（誰でも・formers の行）・`nameMismatch`
- [ ] テスト（GAS・画面・手元に古い H が残る参加者）

## T4 participant-ui（小〜中。T1・T3 の後）

- 状態: 未着手
- [ ] `saveKind` が server のときの文言（roleSummary・shareLagNotice・ワールド名・プレイ中の時点）
- [ ] presence の `resident`（api.js の presenceFields・GAS・boundary）と「サーバー（常駐）」の行
- [ ] 登録のモーダルで `SaveGames\0` を断る・「協力プレイで交代でホストする人も」
- [ ] README の表記の決まり・テスト

## T5 agent（大。T1〜T4 の後）

- 状態: 未着手
- [ ] `tools/server-agent/`（main・config・fs-handles・discover・server-state・watch-client・kv-storage・lineage-guard・agent・log）
- [ ] サーバーが動いているか（ServerSync の状態 → 実行ファイルのパス。決められなければ止める）
- [ ] 停止のとき読み込みを止める（最後の送信は最大 60 秒）・presence は常駐が自分で送る
- [ ] 古い系統の守り（判定待ち・止めた状態を残す・受け入れの基準は GAS の uploadedAt）と `createAutoRegister` の `paused`
- [ ] `install.ps1`（DPAPI）・`run-agent.ps1`
- [ ] テスト（単体・結合・2 台の常駐・送る文字数・秘密が出ないこと）

## T6 統合・GAS 版 13・配信

- 状態: 未着手
- [ ] 最終レビュー（Codex と観点別のエージェント）・`TZ=UTC npm test`・`npm run test:perf`・`git grep`
- [ ] CI の `fetch-depth: 0` と互換テストの必須化
- [ ] release-notes（1〜2 件）・OPERATIONS.md・SAVE_FORMAT.md・README.md
- [ ] GAS: build:gas → gas:push → setup() → 版 13 → テスト用 deployment → api-check
- [ ] 常駐をこの PC の test 環境で（ユーザーが参加）・GAS の負荷と容量
- [ ] ユーザーへの報告と承認 → 本番の GAS → 画面 → 全員のタブの読み込み直し
- [ ] サブ PC の導入の手順（ユーザー）

## 次にやること

- **2026-10-18（セッション 4ca854cd）: プランが承認された。統合ブランチ `integrate/server` を main（40e6f0d）から切った。P0 の準備から始める。**
- 始める前に、ほかのセッションが同じ作業ツリーで動いていないかを `ListAgents` と `git status` で確かめる。
