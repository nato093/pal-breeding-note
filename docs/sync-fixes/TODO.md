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

- 状態: 未（実験のページの用意から）
- [ ] 実験のページを `Claude outputs/sync-fixes/probe/` に用意する（FileSystemObserver と Worker の 5 秒の確認を並べて、1 回の保存のファイルの順番・間隔・通知の種類・裏での遅れを記録）
- [ ] `check:save` に `Level.sav` の中の保存時刻（生のティック・日本時間として読んだ時刻）とファイルの更新日時を分けて出す
- [ ] ユーザーがホストで約 15 分遊び（タブを裏に 5 分より長く）、ゲームを終えて SaveSync の同期を 1 回通す
- [ ] 同期の前後の更新日時・作成日時・LocalData.sav の変化を記録する
- [ ] 結果で、テーマ 3 の比べ方・テーマ 6 の `quietMs`・`maxWaitMs`・テーマ 7 の「ゲーム中」の判定を確定し、README との違いを書く

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
- [ ] ユーザーに依頼: gas:push → setup() → テスト用の deployment → 計測 → 巻き戻しのリハーサル（手順は OPERATIONS.md の「共有の世代とセーブの識別」）
- [x] OPERATIONS.md（反映・巻き戻し・タイムゾーンの前提）・SAVE_FORMAT.md・release-notes

## 4. share-fetch（M）

- 状態: 実装済（feature/share-fetch。マージは親が確かめてから）
- [x] fetchShared を ownedSince に（できることを覚える・BAD_ACTION で落とす・一覧は 5 分ごと・変わらなければ作り直さない）
- [x] 安全網（生の行数と palCount・PARTIAL・確定として保存しない・古い応答を捨てる・送信の応答も）
- [x] app.js の 10 秒の 1 本と keepRefreshing の廃止
- [x] テストと release-notes

## 5. share-upload（M）

- 状態: 未
- [ ] 送信中は dirty・最短 15 秒・再試行の段
- [ ] 識別を送る・force・応答をスナップショットの印と組にして残す
- [ ] テスト（応答を失った後の再送・読み込み直し・古い GAS）と release-notes

## 6. save-watch（L・P0 の後）

- 状態: 未
- [ ] 見張り（Observer の張り直し・unknown・許可・世代番号・Worker への切り替え）
- [ ] 一式の書き終わりの確認（前後の印・登録したファイルの失敗と消失を 30 秒まで読み直す・壊れたファイル）
- [ ] watchTargets・refreshFromWatch・パネルの「監視」の行
- [ ] 「1 分ごと」の文言
- [ ] テスト（watch・owned-store・app・wording）と OPERATIONS.md・release-notes

## 7. host-rotation（M・P0 の後）

- 状態: 未
- [ ] 「ゲーム中」の判定（直近 2 分・続けて 2 回・数え直し）
- [ ] shareLagNotice・名指しの直し・登録の案内
- [ ] 自動登録の候補を「配合のキー＋saveStamp」ごとの 3 状態にし、応答ごとの表で決める
- [ ] テスト（auto-register の各経路・owned-status・save-status・owned-settings）
- [ ] OPERATIONS.md（ホストの交代〔SaveSync〕の節）・release-notes

## 8. page-presence（M・P0 の後）

- 状態: 未
- [ ] 送る側（60 秒・ownedSince への相乗り・pageId・device・古い GAS）
- [ ] 表示（● ○・3 分以内だけでまとめる・6 時間）と 7 の案内への添え書き
- [ ] テストと release-notes

## 終わり

- [ ] `npm test`・UTC でも・`npm run test:perf`
- [ ] 観点別のエージェントと Codex でレビューし、直す
- [ ] 実機の確認（README の「検証」の 3〜6）
- [ ] ユーザーに依頼: 本番の GAS の反映（update-deployment → list-deployments で版 11）→ 配信
- [ ] 全体の報告（変更したファイル・実行したコマンド・確かめ方・残した課題）

## 次にやること

- 2026-10-16: プランの承認の後、文書（この README・TODO）を置いた。次は P0 の実験のページの用意と、テーマ 1 dps-position から。
