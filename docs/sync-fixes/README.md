# 共有の取りこぼし・遅れとホストの交代の修正（sync-fixes）

> 2026-10-16 にユーザーが承認したプラン（Codex の 7 回のレビューを反映済み）。進み具合は [TODO.md](TODO.md)。実在のプレイヤー名・ワールド名は、ダミー（Alice・Bob・World9）に置き換えてある。


## Context

2 つの過去のセッションでユーザーが出した問題を、UI 改善（フェーズ 1a〜4、全テーマ配信済み・main `e984786`）の後のコードで確かめ直し、1 つの修正案にまとめる。

- **10/12（f2da3b27）パル次元ストレージ**: 次元ストレージの個体にページ・行・列が出ない。登録の後にできた `Players\<uid>_dps.sav` は読まれず、移したパルが消える（理想個体の親の候補からも）。→ 今も同じ（未登録の `<uid>.sav` の案内はあるが `_dps.sav` はない）。
- **10/15（30cd80e7）ホストの交代と共有の遅れ**: 他の人がホストした日に共有が更新されなかった（原因はホストの人がページを開いていなかった）。参加者は気づけず、古さの警告は最後に共有した人を「ホスト」と名指しする。反映に約 1〜2.5 分。10/15 の実測で速くする方法は分かっていたが未実装（間隔は当時のまま、GAS はシート全体を消して書き直す）。
- 目標: どの PC がホストしても、ゲームのセーブから参加者の画面まで目安 **十数秒**（要実測。今は 1〜2.5 分）で届き、届かないときは理由が全員に分かり、次元ストレージのパルも漏れなく位置つきで出る。

### 確かめた事実（2026-10-16）
- World9 の `Level.sav` の `InLockerCharacterInstanceIDArray` は 118 件で、2 人の `_dps.sav` の個体 27＋91＝118 と InstanceId が全部一致（グローバルは含まない。他の 12 ワールドは 0 件）。キーの PlayerUId は 0000…（誰の分かは `_dps.sav` がないと分からない）。
- 同期は **SaveSync**（Steam。公式ブログ: セッションの後に `Players` を含むワールドのフォルダ全体を全員の PC に同期）。手元の World9 は `savesync.sav`（SaveSync の目印）を含む全ファイルの更新日時が 08:52:40 でそろっていた → 同期の後はゲームをしていない PC も `judgeRole` で「ホスト」になり、更新日時が同期の時刻に書き換わる可能性がある（事前確認で確かめる）。
- 古い GAS は `ownedUpload` の最上位の知らない項目を `UNKNOWN_FIELD` で断るが、`world` の中の知らない項目は黙って捨てる（`gas/Owned.js:7・85`、`core/owned-shared.js` の `validateOwnedUpload`）。古い GAS は知らない列を無視し、その値を残す。今の所持パルの行は `updatedAt` と OwnedWorlds の `uploadedAt` が同じ値（`gas/Owned.js:94・108・125`）。
- `Level.sav` の中の保存時刻（生のティック `savedAtTicks`、`save/palworld.js:787`）は同期しても変わらない。ただしスナップショットには ISO に変換した `world.savedAt`（:1282。日本時間で 9 時間ずれることが SAVE_FORMAT.md:106 に記録済み）しか残らないので、生のティックの文字列を残して使う。ホストの PC のローカル時刻なので、**仲間が全員同じタイムゾーン（日本時間）で遊ぶ前提**で新旧を比べる。
- 今の「どちらのセーブが新しいか」は、どこもファイルの更新日時で比べている（GAS `gas/Owned.js:96`、手元と共有の選択 `owned.js:241・252`、自動登録の履歴 `auto-register.js:240・309`）。
- テスト環境と本番は同じ GAS の同じ deployment で、パスワードでシートを分けるだけ（`gas/Auth.js:26`）。deployment は版に固定されるので、`clasp push` だけでは本番は変わらない。`setup()` は test・prod 両方のシートに列を足す（`gas/Setup.js:7`）。

### ユーザーの決定（2026-10-16）
| 項目 | 決定 |
|---|---|
| GAS | F（そのワールドの行だけを書き、途中を見せない）と G（参加者の読み込みを 1 回に）も入れる |
| 開き忘れの対策 | 参加者の画面で知らせる ＋「ページを開いている PC」を共有する（起動のショートカットは不要） |
| 次元ストレージの読み漏れ | 参加者の画面にも出す |
| ゲームをしていない PC が共有より新しいセーブを読んだとき | 配合牧場の自動登録を動かす（共有と同じセーブなら動かさない） |
| セーブの識別 | OwnedWorlds に列 `saveKey` を足し、GAS エディタで `setup()` を 1 回実行する |
| 実機 | ユーザーがホストして確かめる。事前確認は次にホストするとき（それまでに 1〜5 を進める） |
| レビュー | Codex（読み取り専用）で 7 回。指摘（高 15・中 多数）をすべて反映し、最後の確認で「高・中の問題は残っていない」 |

既定として決めた点: GAS の書き方は **F1（世代）**。参加者は表のタブならどの画面でも 10 秒ごとに読み直す（裏では読まない D26 は維持）、ワールドの一覧は 5 分ごと。送る最短の間隔 15 秒・再試行 15 秒〜5 分。送るタブを 1 つに決める仕組み（Web Locks）は入れない（GAS の `unchanged` で二重の書き込みを吸収し、OPERATIONS.md:94 の注意は残す）。

## 進め方

- 1 テーマずつ `feature/<key>` → 統合ブランチ `integrate/sync-fixes`（main から）へ `--no-ff`。最後に観点別のエージェント＋Codex でレビューして直し、報告。main への反映と push は報告の後にユーザーの確認を得てから。
- 各テーマで `web/js/release-notes.js` の先頭に 1 件（title 20 字・body 60 字以内）。OPERATIONS.md・SAVE_FORMAT.md を合わせて直す。テストは `node:test`（`npm test`）。配信の前に UTC でも流す（Git Bash `TZ=UTC npm test`、PowerShell `$env:TZ='UTC'; npm test`）。
- file:line は HEAD `e984786` の目安。関数名で探し直す。core/ の中にはコメントでも `localStorage`・`window`・`document`・`fetch`・`api.js`・`store.js` を書かない。公開リポジトリなので、実データ・実パスワード・計測の生ログはコミットしない（`Claude outputs/` は Git の対象外）。

## 事前確認（P0。次にユーザーがホストするとき。テーマ 6〜8 の前提）

- 実験用のページを `Claude outputs/sync-fixes/probe/`（Git の対象外）に置き、手元のサーバーで開く（2026-10-15 の実験と同じ作り: ファイルをドロップ → FileSystemObserver と Worker の 5 秒の確認を並べて記録）。
- ユーザーは World9 の一式をドロップしてホストで約 15 分遊び、タブを裏に 5 分より長く置く → ゲームを終えて SaveSync の同期を 1 回通す。
- 記録すること: 1 回の保存でどのファイルが・どの順に・何ミリ秒の間に書かれるか（Level.sav も置き換えで書かれるか）、`disappeared`・`errored`・`unknown` の出方、裏での遅れ。同期の前後のファイルの更新日時（同期の時刻か元の時刻か）・作成日時・LocalData.sav が書き換わるか。`Level.sav` の中の保存時刻は、生のティック・日本時間として読んだ時刻・ファイルの更新日時を分けて出す（`check:save` に足す）。
- 結果で、テーマ 3 のセーブの比べ方（生のティックで新旧を比べてよいか）、テーマ 6 の待ち時間（`quietMs`・`maxWaitMs`）、テーマ 7 の「ゲーム中」の判定を確定し、プランとの違いを報告する。テーマ 3 は P0 の前に作り始めてよいが、本番への反映は P0 の後。

### P0 の結果（2026-10-17。ユーザーがホスト。Chrome 155）
- 条件: ホストの 1 ワールドで約 36 分（保存 72 回）。タブは 04:07 から裏（途中で 1 秒だけ表）、04:14 からは 25 分続けて裏。ゲームを終えて SaveSync の同期を 1 回通した。記録は `Claude outputs/sync-fixes/probe/logs/`（Git の対象外）。
- 保存: 30.0 秒ごと（27.7〜30.4 秒）。1 回で 7 ファイルが変わる（`WorldOption.sav` は変わらない）。順はほぼ毎回 `LocalData.sav` → `Level.sav` → `LevelMeta.sav` → `Players` の 4 ファイル（`<uid>.sav`・`<uid>_dps.sav` の順は回によって入れ替わる）。`Level.sav` から後は数 ms の間にそろい、空くのは `LocalData.sav` と `Level.sav` の間だけ（中央値 0.79 秒・95% 1.85 秒・最大 2.74 秒。1.5 秒より空いたのは 72 回中 7 回）。ゲームを終えたときの保存だけは `LocalData.sav` が最後。
- 書き方: どのファイルも置き換えで書かれる（作成日時は変わらない）。FileSystemObserver の通知は毎回 `disappeared` と `errored`（まれに `appeared`）で、`modified`・`unknown`・`moved` は 1 回も出なかった。毎回の張り直しは 992 回すべて 1 回目で成功（Worker 中央値 23ms・最大 1.3 秒、画面 中央値 424ms・最大 1.6 秒）。
- 気づくまで（その保存でいちばん早い更新日時から）: Observer は画面・Worker とも中央値 0.011 秒・最大 0.78 秒で、裏に 5 分より長くあっても同じ。取りこぼし 0。Worker の 5 秒ごとの確認は裏でも 5 秒のまま（中央値約 2 秒・最大 2.9 秒・取りこぼし 0）。画面の 5 秒ごとの確認は裏で 60 秒ごとになり、7 ファイル × 30 回分（210 件）を取りこぼした（最大 23 秒の遅れ）。
- 保存時刻: `Level.sav` の中の時刻は毎回 30 秒ずつ進み、`LevelMeta.sav` の Timestamp と同じティック。更新日時は中の時刻（日本時間として読む）の 0.7〜2.9 秒後。保存の途中に読んだ 1 回だけ、`Level.sav` が新しく `LevelMeta.sav` が古いまま（30 秒の食い違い）だった。
- 同期: ホストの PC では、同期の後もセーブのファイルの更新日時・作成日時は最後の保存のときのままだった（同期はホストのファイルを書き換えない）。増えたのは `Players/savesync.sav` だけで、遊んでいる間はなく、最後の保存の 13 秒後に作られた（更新日時は最後の保存の時刻にそろえてある）。`Players` のフォルダと中のファイルの作成日時は、その日にゲームを始めた時刻だった（ワールドのフォルダ・`Level.sav` は前のまま。セッションの始めに作り直されるのかもしれない。未確認）。10/16 に手元で見た「同期の後に全ファイルの更新日時がそろっていた」は、受け取る側の PC のこと。
- 受け取る側（同じ日の 08:59〜10:29 に別の人がホストし、この PC が 10:30 に同期を受け取った）: SaveSync はまずワールドのフォルダの中を `LocalData.sav` 以外全部消し（`backup\world\…` の中も）、空になったフォルダを消してから、受け取ったセーブを書く。書いた後は、プレイヤーの入れ替え（この PC の人をホストの `…0001` にする。途中で `*.sav.swap` ができる）で `Level.sav`・`Players`・`LocalData.sav` を書き換え、全部の更新日時を元の最後の保存の時刻にそろえる（作成日時は同期の時刻）。`Level.sav` の中の保存時刻は元と同じティックのまま（大きさは変わる＝中身は元と違う）。
- **事故（2026-10-17 10:30）**: P0 の実験のページを開いたままにしていたため、同期を受け取るときに SaveSync が空の `Players` を消せず（ほかのプロセスが使用中）、例外で止まった。ワールドのフォルダには `LocalData.sav` だけが残り、SaveSync を起動し直した 12:07 に同期がやり直されて戻った（その間にゲームを始めていたら、ワールドがない状態だった）。
- **原因の確認（作業用のフォルダで再現）**: FileSystemObserver でファイルを見張ると、Chrome はそのファイルの入ったフォルダを押さえ、ファイルが消えた後も 0.5〜2 秒は押さえたまま。SaveSync と同じ順（ファイルを消す → すぐ空のフォルダを消す）だと、`Players` の中のファイルを画面か Worker の Observer で見張っている間は 4 回中 4 回失敗（EBUSY）。見張りなし・`getFile()` の確認・中身の読み込みでは 4 回中 4 回消せた。ワールドのフォルダの直下のファイル（`Level.sav`・`LevelMeta.sav`・`LocalData.sav`）だけを見張ったときも 4 回中 4 回消せた（直下のフォルダは `LocalData.sav` が残るので消されない）。見張りを止めた直後は 0.5 秒ほど押さえたままのことがある。
- 見ていないこと: 受け取る側の PC で、SaveSync が直下のフォルダそのものを作り直すことがあるか（今回は作り直さなかった）、Edge。

### P0 で決めたこと（プランとの違い）
- **テーマ 3**: 生のティックで新旧を比べる方針はそのまま。中の時刻はファイルの中なので同期で変わらず、受け取る側の PC の更新日時がどうなっても影響しない。
- **テーマ 6**:
  - 見張りは Worker の FileSystemObserver を第一にする（張り直しが画面のスレッドより速い）。通知は毎回 `disappeared` → `errored` なので、張り直しは例外ではなくいつもの道。10・50・250・1000 ms の段は安全網のまま。落ちる先は Worker の 5 秒ごとの確認（裏でも 5 秒のまま）。
  - **Observer で見張るのは、ワールドのフォルダの直下のファイル（ホストは `Level.sav`、参加者・ほかの登録したワールドは `LocalData.sav`。`LevelMeta.sav` も可）だけにし、`Players` など下のフォルダのファイルは Observer で見張らない**（見張ると、同期を受け取るときに SaveSync が `Players` を消せずに止まり、ワールドのフォルダが `LocalData.sav` だけになる。上の「事故」）。`Players` のファイルは `Level.sav` の数 ms 後に書かれるので、`Level.sav` の通知と `quietMs` で足りる。下のフォルダの変化は Worker の 5 秒ごとの `getFile()` の確認で拾う（`getFile()` と読み込みはフォルダを押さえない）。プランの「今のワールドは全ファイル」を見張る対象（`watchTargets()`）から変える。テストで、`Players` の中のハンドルを Observer に渡さないことを確かめる。
  - `quietMs` は **1,000 ms**（最後の通知から）。ただし**ホストのワールドは `Level.sav` が変わったのを見てから数え始める**（`LocalData.sav` は最大 2.74 秒早く書かれるので、それだけでは読まない。`Level.sav` から後は数 ms でそろう）。プランの仮の値は 1.5 秒で、それだと 72 回中 7 回は `Level.sav` の前に読み始めていた。
  - `maxWaitMs` は **10,000 ms**（最初の通知から）。`Level.sav` が来なくても見直しを始める（参加者のワールド・`LocalData.sav` だけの変化）。
  - 読む前と後の印の比べ（プランのとおり）は要る（保存の途中に読むと `Level.sav` と `LevelMeta.sav` が食い違った）。
- **テーマ 7**: 「直近 2 分の中に、間が 20〜90 秒の変化を続けて 2 回」はそのまま（保存は 27.7〜30.4 秒ごと）。ホストの PC では同期がセーブを書かないのでだまされない。受け取る側の PC の同期の書き込みは 1 回の変化なので、続けて 2 回の条件で除ける。

## テーマ

| 順 | key | 規模 | 中身 | GAS | P0 の後 |
|---|---|---|---|---|---|
| 1 | `dps-position` | S | 次元ストレージの位置 | — | |
| 2 | `dps-missing` | M | `_dps.sav` の読み漏れの検知（ホスト・参加者） | players の JSON に 1 項目 | |
| 3 | `owned-gas` | L | F1・G・セーブの識別と結果の種類・ページを開いている PC の記録・`compactOwned`・計測・mock-api | **あり（列 `saveKey`）** | |
| 4 | `share-fetch` | M | 参加者の読み直しをアプリの層へ・G を使う・行数の安全網 | — | |
| 5 | `share-upload` | M | 送信中は待ち、終わったら最新を 1 回・再試行・識別を送る | — | |
| 6 | `save-watch` | L | FileSystemObserver → Worker の 5 秒 → 今の確認、の順に落とす見張り・一式の書き終わりの確認 | — | ✓ |
| 7 | `host-rotation` | M | ゲーム中なのに共有が古いときの案内・名指しの直し・登録の案内・自動登録の条件 | — | ✓ |
| 8 | `page-presence` | M | 「ページを開いている PC」の送信と表示 | 3 に含む | ✓ |

### 1. `dps-position`
- `web/js/core/owned.js`: `palboxLabel`・`BOX_LABEL` は変えない（共有の互換）。`dpsLabel()`（「パル次元ストレージ N ページ・R 行 C 列」）と `DPS_LABEL` を足し、`parseBoxLabel(label, kind = 'palbox')` にする。`normalizeOwned`（:411）で `palbox`・`dps` の両方に `palboxPosition(location.slotIndex)`（dps の slotIndex は arrayIndex。`save/palworld.js:1175`）。`ownedFromShared`（:1138）で dps も読み戻す。短い表記 `boxShort(pal)` を共通にする。
- 表示: `views/owned.js` の `fillWhereCell`（6×5 の図はそのまま）、`views/ideal.js` の `palBrief`、`views/route.js` の `holderSummary`（要約は場所名まで）。CSV・キーワード・共有は placeLabel から付く。並べ替え `boxIndex` は dps も位置の順。古いページは新しい文字をそのまま出す。
- テスト: `test/core/owned.test.js`（slotIndex 0・55・77・7820 → 1p1-1・2p5-2・3p3-6・261p4-3、palboxLabel の回帰、parseBoxLabel の往復と kind 違い、古い共有）、`owned-view`・`route-view`。所持パルの perf を前後で比べる。

### 2. `dps-missing`
- `save/palworld.js` の `buildSnapshot`: 個体 ID の集合の差で数える。expected＝`inLocker`（Level.sav の ID 集合）、found＝正しく読めた `_dps.sav` の個体の ID との積、missing＝expected − found。`stats.inLocker`・`stats.inLockerMissing`（数だけ）。古い保存データ（項目なし）は「分からない」で案内なし。
- `ui/owned-status.js` に `dimensionGap(snapshot)`: missing > 0 なら、候補＝`Players/<uid>.sav` は読めたのに `<uid>_dps.sav` がない人（`level > 0`）。候補がいれば「Level.sav では次元ストレージに 118 体いますが、27 体を読めていません。Players\XXXX_dps.sav（Bob）が登録されていないかもしれません」＋`editWorld`。候補がいなければ「…読めていません（ファイルが足りないか、保存の途中に読んだ可能性があります）」。欠けの数を候補の人数で割ったり、特定の人と断定したりしない。出し先: `ownedNotices`、ヘッダー（`ui/save-status.js` の `problems()`）、理想個体の結果の上（`setupHint`）。
- **参加者にも出す**: 候補のプレイヤーに `dpsGap`（欠けの数）を付けて共有する。経路の全部を直す: `core/owned.js` の `sharedUpload` → `core/owned-shared.js` の `cleanOwnedPlayer`（→ `build:gas`）→ 受け側の `core/boundary.js` の `cleanSharedPlayers`（:158）→ `ownedFromShared`（:1150 のプレイヤーの作り直し）。参加者の案内は自分が候補のときだけ「次元ストレージの 27 体が出ていません。ホストの登録にあなたの Players\…_dps.sav がないかもしれません。ホストに足してもらってください」。古い GAS は黙って捨てるだけ。
- 登録モーダル（`views/owned-settings.js` の `openWorldDialog`、:200）に「後から次元ストレージを使い始めた人の `_dps.sav` もここから足せます」。`scripts/check-save.mjs` に「次元ストレージ: Level.sav 118 体・読めていない 0 体」。
- テスト: save（集合の差。`{A,B}` と `{A,C}` で 1）、owned-status（候補 1 人・複数・なし・古い stats・参加者の自分／他人）、save-status、ideal-view、**送信 → GAS → API の検査 → キャッシュの復元 → 参加者の案内 の往復テスト**。

### 3. `owned-gas`（GAS。テスト用の deployment で計測してから本番へ）
- **セーブの識別と比べ方**: スナップショットに生のティックの文字列 `world.savedAtTicks` を残す（`save/palworld.js` の buildSnapshot）。送る `world` の中に（古い GAS は捨てる）`saveStamp`（そのティック）・`contentHash`（送る中身の SHA-256。対象の項目・並び・型と、古い列の幅に縮めたときの計算を固定する。画面の側で `crypto.subtle`。core/ の外）・`format`（共有の形の版の番号）・`fileCount`（読めたファイルの数。GlobalPalStorage も数える）・`missingCount`（登録してあるのに読めなかったファイルの数）・`force`（登録の確定のときだけ true）。OwnedWorlds に列 `saveKey`（`uploadedAt|stamp|hash|format|fileCount|missingCount`）を足す。読むときに先頭の `uploadedAt` がその行の `uploadedAt` と違えば、識別はない（古い版が後から書いた行）として扱う。
- **新旧の比べ方を 1 つの関数に**: `core/owned-shared.js` に `compareSaves(a, b)`（両方に stamp があれば生のティックを桁をそろえて比べる。どちらかになければ今の更新日時）。GAS（build:gas で共有）・手元と共有の選択（`owned.js:241・252`）・自動登録の履歴（`auto-register.js:240・309`）で同じものを使う。受け側で落とさないよう、`core/boundary.js` の `cleanWorld`（:175。API の応答〔`api.js:96`〕とキャッシュの復元〔`owned.js:145`〕の両方が通る）に `saveStamp` などを足し、**API の受信 → 保存 → 復元 → `compareSaves`** の往復テストを書く。
- **結果の種類**（`stored` も今どおり返す）:
  | 条件 | 結果 | 書く |
  |---|---|---|
  | ワールドがない | `new` | ○ |
  | 両方に stamp があり、届いた方が新しい／古い | `newer`／`stale` | ○／× |
  | stamp が同じで saveKey も同じ | `unchanged` | ×（③の掃除は要れば行う） |
  | stamp が同じで、同じ人の送信で、`format`・`fileCount` が減らず `missingCount` が増えず、どれかがよくなる（`format`・`fileCount` が増える、`missingCount` が減る＝飛ばしたファイルが戻った）。または登録の確定（`force`。別の人でもよい）で、どれも悪くならない | `resent` | ○ |
  | stamp が同じで、上以外（別の人・古いタブの劣った中身） | `same` | × |
  | 届いた方か今の行に有効な stamp がない（古い画面・列を足す前・古い GAS が書いた行〔`saveKey` の `uploadedAt` が合わない〕） | 今の更新日時の比較（新しければ `newer`、古ければ `stale`）。同じ時刻は、今の行に識別があり届いた方にない（古い画面）なら `same`（2026-10-17 の最終レビュー。同期を受け取った PC の古いタブの劣った中身で上書きしない）、今の行に識別がなければ上書き | 書いたら saveKey は届いた値（なければ空）にする。空どうしを同じセーブとは見ない |
  応答には、今公開されている world（`saveStamp`・`uploadedBy` を含む）と `cleanup` の成否を必ず返す。
- **F1 世代の書き込み**（`actionOwnedUpload_`）: 鍵の中で ①新しい行を最後の行の下に `setValues`（`updatedAt`＝serverTime。他のワールドの行は触らない・`clearContent` しない）→ flush → ②OwnedWorlds の行を書く（`uploadedAt`＝serverTime・`saveKey`。**ここで公開**）→ flush → ③そのワールドの「今と 1 つ前」以外の世代を `deleteRows` で消す。③は書かない結果（`unchanged`・`same`・`stale`）のときも、消す世代が残っていれば行う。③の失敗は共有の成功と分け（`cleanup:false`。次の呼び出しでもう一度）、②の前に落ちた行は公開されない孤児として次の ③で消える。
- **読み込み**（`actionOwned_`）: まずは今と同じく全行を 1 回読み、`worldId` と `updatedAt === world.uploadedAt` で絞る（範囲を絞る読み方は計測で要るときだけ）。数が `palCount` と違えば 1 回だけ読み直し、それでも違えば再試行できるエラー `PARTIAL`。`palCount` 0 は正しい空。「世代が合わなければ worldId の全部」には落とさない（削除したパルが戻るため）。`actionOwnedDelete_` も塊ごとの `deleteRows`。
- **G `ownedSince`**（`gas/Actions.js`）: `{ worldId, uploadedAt, presence? }` → `{ changed:false, uploadedAt, uploadedBy, saveUpdatedAt, palCount, presence }` か、`owned` と同じ中身＋`presence`。
- **ページを開いている PC**: `presence` 操作と `ownedSince` の `presence`（`ownedUpload` には載せない＝古い GAS が断るため）。CacheService に、ページごとのキー `presence:<env>:<worldId>:<pageId>`（6 時間）と、ワールドの索引のキー `presence:<env>:<worldId>`（ページの ID の一覧）。索引の読み・足し・期限切れの除去・上限（1 ワールド 50）は短い鍵の中で行う（共有の鍵と別の鍵を使えるか実装のときに確かめ、だめなら共有の鍵を 0.5 秒だけ試す。取れなければ presence だけが失敗し、ページのキーは書く＝次の 60 秒で戻る）。値は `{ user, device, role, playing, canShare, at }`（`at` はサーバーの時刻。role は host・guest・none。長さ・形を検査）。キャッシュと索引の失敗は本体の操作を失敗させない（索引だけが先に消えても次の送信で戻る）。ID はワールドごとのランダムな値で、認証にも本人の証明にも使わない（共通パスワードの認証なので、名前と役割は自己申告）。
- `compactOwned(env)`（鍵の中で、まず環境ごとの停止の印〔Script Properties の `OWNED_PAUSED_<env>`〕を立て、指定した環境〔`'test'`・`'prod'`。それ以外・省略なら何もせず止める〕の全ワールドを今の世代だけにし、`saveKey` の列を空にする。GAS の編集画面から実行。巻き戻しのときに使う）と `resumeOwned(env)`（停止の印を消す）。新しい版の `ownedUpload`・`ownedDelete` は、鍵を取った後に停止の印を見て、立っていれば何も書かずに `BUSY` を返す（巻き戻しの後に遅れて届いた新しい版の呼び出しが、世代や `saveKey` を書き戻さないため。古い版は印を見ないので、巻き戻した後の共有は止まらない）。テストで、test を指定したときに prod の行・`saveKey`・停止の印が変わらないこと、停止の印が立った後の書き込みが何も書かないこと、**新しい版に戻した後に「新しい版の書き込み → 遅れて古い版の書き込み → 新しい版の再送」で、古い版の行に残った `saveKey` を識別として使わない**ことを確かめる。
- `web/js/api.js`（操作・項目・応答の検査）、`dev/mock-api.js`（同じ動き）。
- **計測 `scripts/owned-bench.mjs`**: URL は環境変数で指定（テスト用の deployment）。最初に読み取りの操作でテスト環境だと確かめ、だめなら何も書かずに止める。ランダムな worldId だけを使い、`finally` でそれだけを消す（`api-check` の片付けは流用しない。`api-check` はテスト環境の記録を全部消す作りなので、ベンチとは同時に流さない）。3 ワールド計約 4600 行を入れ、世代ごとに違う個体 ID・値で中身の一致を確かめる。ふつうの 30 秒ごとと、負荷の 15 秒ごとを分けて、同時の読み手・再送・`probe`（鍵を取る）を重ね、各操作の時間・途中の中身（0 回が目標）・鍵の待ち・失敗率を測る。
- テスト: `test/gas/owned.test.js`（clearContent しない・他のワールドを書き直さない・公開前の世代を返さない・2 世代まで・古い形の行・結果の種類の表の全行・stamp の欠けの組み合わせ〔届いた方・今の行・列なし〕・古いタブの劣った中身を `same` で断る・`force`・`PARTIAL`・palCount 0・③の失敗の後に同じ要求の再送で掃除される・②の前の失敗・読み手が古い world を持つ間の 2 回の共有・他のワールドの削除との交錯・`ownedSince` の 4 通り・presence〔env の分離・索引の同時更新・上限・期限・失敗しても本体は成功〕・`compactOwned`）、`compareSaves`（ティックの桁違い・片方だけ stamp）、`harness.js` の FakeSheet（`insertRowsAfter`・失敗の注入）、`mock-api`・`api`。**古い GAS（`git show e984786:gas/…`）＋新しい画面**と**新しい GAS＋古い画面**の組み合わせのテスト。

### 4. `share-fetch`
- `web/js/owned.js` の `fetchShared`（:322）: 今のワールドを持っていれば `ownedSince` を 1 回。できること（`ownedSince`・`presence`）は接続先と環境ごとに覚え、古い GAS の `BAD_ACTION` なら 1 時間、今の 2 回呼びに落とす。一覧（`ownedWorlds`）は起動・ログインの切り替え・force・目当てがない・5 分ごとだけ。変わっていない応答は所持パルを作り直さない（`owned.js:244` の参照の同一性を保つ）。
- 安全網: 受け取った生の行数（重複を除く前）が `palCount` と違う・`PARTIAL` なら、前の表示を残し、その `uploadedAt` を確定として保存せず、5 秒後に読み直す（3 回まで）。ワールドや scope を変えた後に届いた古い応答は捨てる。送信の応答（:411）も同じに扱う。
- `web/js/app.js`（:897-900）の 60 秒の setInterval を 10 秒の 1 本にする（表なら `owned.autoRefresh()`、裏なら `owned.pollAuto()`）。画面ごとの `keepRefreshing`（`views/shared.js:49`、`views/owned.js:1876`、`views/ideal.js:1985`）をやめる。表に戻ったらすぐ照らし合わせる（今の visibilitychange のまま）。
- テスト: `app.test.js:123-127`、`owned-store`（ownedSince の 2 通り・BAD_ACTION と覚え方・行数の食い違いと PARTIAL・古い応答・一覧の 5 分・変わらないときの同一性）、`owned-view`・`ideal-view` のタイマー。

### 5. `share-upload`
- `uploadLocal`（owned.js:365）を、送信中は `dirty` にして終わった後に最新を 1 回送る形に。最短の間隔 15 秒。失敗（TIMEOUT・CONNECTION・BUSY・INTERNAL・RESPONSE）は 15・30・60・120・300 秒で再予約、VALIDATION（列の幅の手当て :390-410 は今のまま）・AUTH・TOO_LARGE は再試行しない。`blockUpload()` は全部を消す。
- 送る `world` に 3 の識別の項目を足す（登録の確定〔`commitRegistration`〕から送るときだけ `force`）。応答を、**送ったスナップショットの印**（`verifiedSignature`）と組にして `state.upload = { status, result, signature, published }` に残す（`published` は応答の今公開されている world の `saveStamp`・`uploadedBy`）。`unchanged`・`same`・`stale` はエラーにしない（パネルに「同じセーブが共有済み（〈送った人〉の PC から）」など）。新しいセーブを読んだら前の結果を消す。
- テスト（`owned-store`）: 送信中の 2 回 → 終わってから最新を 1 回、最短の間隔、再試行の段と復帰、VALIDATION、削除・解除で消える、:671 の回帰、結果の種類と印の組、**書き込みは成功したが応答を失い、再送が `unchanged` になる**、ページの読み込み直し、古い GAS（`stored` だけ）の扱い、`force`。

### 6. `save-watch`（P0 の後）
- 見張りは既存の `web/js/save/worker.js` に `type:'watch'` の分岐を足すか、新しい `web/js/save/watch.js`（最上位で `self` に触れない。`test/static/build-release.test.js:72` が Node で import する）。
  - FileSystemObserver: 各ハンドルを observe。`disappeared`・`errored` は張り直し（`getFile()` が通ったら `await observe()` の成功を確かめ、その直後に 1 回照らし合わせる。だめなら 10・50・250・1000 ms。入れ子のタイマーは 4 段まで）。`unknown` は照らし合わせ直し、許可が外れたら許可待ちへ。張り直せないファイルは Worker の確認に回し、次の許可・登録の変更で張り直す。止めた後や古い監視から届く通知は世代番号で捨てる。
  - 使えなければ Worker の中の 5 秒ごとの `getFile()` の lastModified・size の比較。それもなければ 4 の確認だけ。
- **一式の書き終わりの確認**（見張りの通知でも、ページを開いた直後の最初の読み込みでも同じ）: 最後の通知から `quietMs`（P0 で決める。仮 1.5 秒）静かになったら読む。読む前と後でファイルの印を比べ、変わっていたら採用せずに読み直す。**登録してあるファイル**の読み・解凍・解析の失敗と、一時的な消失（`NotFoundError`。今は `missing` にして飛ばす。`handles.js:117・133・212`、`import.js:75`）は、初回から採用を止め、前の完全な表示と共有を残したまま 1・3・10・30 秒で一式を読み直す（ゲームの保存の間隔 30 秒をまたぐまで）。それでも同じファイルが同じ形で失敗・消失し続けたら、壊れた・消えたとみなし、今と同じく飛ばして読み、案内を出して共有する（消したファイルで共有がずっと止まるのを避けるため）。このとき新しいセーブなら欠けたまま `newer` で載る（今と同じ）。3 の `same` が防ぐのは、同じセーブを劣った中身で置き換えることだけ。後でそのファイルが戻れば `missingCount` が減るので、同じセーブのまま `resent` で直る。登録していないファイルの欠けとは分ける。`maxWaitMs` は「見直しを始める期限」で、不完全な一式を送る期限ではない。
- 見張る対象（`owned.js` に `watchTargets()`）: ~~今のワールドは全ファイル~~ → **Observer は直下のファイルだけ**（2026-10-17 の P0 の「事故」と「P0 で決めたこと」。今のワールドは直下のファイル〔Level.sav・LevelMeta.sav・LocalData.sav〕を Observer、`Players` のファイルは Worker の 5 秒ごとの確認だけ）、他の登録したワールドは Level.sav・LocalData.sav、許可が granted のものだけ。読み直しは `refreshFromWatch(worldId)`（`runAuto({ transient:true })`。置き換えの途中で読めなければ 1・3・10 秒で読み直し、それでもだめなら今の案内）。`AUTO_INTERVAL` は安全網として残す。
- 確かめるための表示: ヘッダーのセーブ連携のパネルに「監視: ファイルの変更 · 最後の保存 12:03:30（6 ファイル・0.8 秒）」。
- 文言の「1 分ごと」を直す（`ui/owned-status.js:30` の `HOST_SUMMARY`、`ui/save-status.js:53`、OPERATIONS.md:62・106・121・140、`PRESENCE_FRESH_*` のコメント）。
- テスト: 新しく `test/save/watch.test.js`（偽の Observer・Worker。通知の種類・張り直しの成功と失敗・unknown・世代番号・Worker への切り替えと戻り・stop）、`owned-store`（refreshFromWatch・transient・読む前後の印の違い・初回と 2 回目以降の一時的な失敗・登録した `_dps.sav` の一時的な消失と復帰・30 秒を超えて消えたまま・印の変わらない壊れたファイル・busy 中のまとめ）、`app.test.js`（Observer も Worker もない Node で落ちない）、`wording`。

### 7. `host-rotation`（P0 の後）
- **「ゲーム中」の判定**（同期の 1 回の書き込みにだまされない形）: 直近 2 分の中に、そのファイルの変化を続けて 2 回以上見た（間が 20〜90 秒。ゲームは 30 秒ごとに保存する）。ホストは Level.sav の中の保存時刻が進んだこと、参加者は LocalData.sav の更新日時の変化。ページを開いた直後の最初の読み込みは数えない。2 分変化がない・ワールドや役割が変わった・見張りをやり直したら、数え直す。パネルでは「ホスト用のセーブあり」と「ホスト中（推定）」を分けて出す。P0 の結果で調整する。
- **ゲーム中なのに共有が古い**（`ui/owned-status.js` に `shareLagNotice`）: 参加者がゲーム中なのに、共有のセーブの時刻が 5 分以上古い（または共有がない）とき、`ownedNotices` とヘッダーのチップ（warn・「共有が止まっています」）に「ゲーム中のようですが、共有は N 分前のセーブのままです。今のホストの PC でこのページが開いているか確かめてください（あなたがホストなら［ワールドを編集］で Level.sav・LevelMeta.sav を足す）」と 8 の一覧。
- **名指しの直し**（`roleSummary`、owned-status.js:56-75）: 古い共有・自分が送った共有では「最後の共有は 2 時間前（Alice の PC から）です。今ホストしている人の画面が閉じていると、共有も配合牧場の自動登録も止まります」。OPERATIONS.md:108。
- **登録の案内**（`views/owned-settings.js`）: 参加者の `previewText`（:86）・組の見出し（:197「ホストする PC（交代でホストする人も）」）・参加者のワールドの行（:321-324）。OPERATIONS.md に「ホストの交代（SaveSync）」の節（全員が一式を登録・役割の判定・セーブの識別と結果の種類・同期の後にゲームをしていない PC が送る動き・案内の意味）。
- **自動登録の条件**（`auto-register.js:235-239`・`absorb` :305）: 証拠を集めることと、登録すること（GAS への書き込み）を分ける。
  - 集める: 今どおり、読んだスナップショットごとに牧場を前と比べて候補を足す（タマゴの証拠はそのスナップショットにしかないため、送信の結果を待たない）。候補にはそのスナップショットの `saveStamp` を付け、今の保存先（端末の storage）に残す（読み込み直しにも耐える）。
  - 候補の状態は「保留 → 登録してよい／捨てる」の 3 つで、端末に残す。一度「登録してよい」になった候補は、後の応答で取り消さない（プレイヤーの対応が未設定で待っている候補も消さない）。
  - 未決の証拠は **「配合のキー＋saveStamp」ごと**に持ち、状態・ホスト中の推定・期限もその単位で管理する（今は同じ配合のキー〔`core/pair.js:16`。stamp を含まない〕の候補に証拠を足していく〔`auto-register.js:314`〕ので、ここを変える）。登録に使うのは「登録してよい」になった証拠だけで、それを配合のキーごとにまとめて今の登録の流れ（登録者の判定 `core/auto-breeding.js:119` を含む）に渡す。
  - 応答のたびに、**その要求で送った stamp（S）以前**の未決の候補だけを次のように決める（S より後に読んだ候補は、その応答では決めない）:
    | 応答 | 候補 |
    |---|---|
    | 自分が載せた（`new`・`newer`・`resent`・自分の前の送信が届いていた `unchanged`〔応答を失った後の再送・読み込み直し〕） | S 以前 → 登録してよい |
    | 別の人が**同じ stamp** を載せている（`same`・他人の `unchanged`） | stamp が S の候補 → 捨てる（そのセーブは別の PC の担当）。S より前の候補は保留のまま |
    | 別の人が新しいセーブを載せている（`stale`） | このページが「ホスト中（推定）」〔7 の判定〕の間に読んだ候補 → 登録してよい（自分のプレイの証拠）。それ以外 → 保留のまま（推定が立たなかっただけで、同期で受け取ったとは言い切れないため） |
    | 応答がない・失敗 | 保留のまま |
  - 保留の候補は、後で自分が載せた応答（その stamp 以後）で登録してよいになり、別の人が同じ stamp を載せたと分かれば捨てる。7 日たっても決まらない候補は捨てる（今の候補の上限 `PENDING_MAX` もそのまま）。
  - S1 の応答を失った後に S2 を読み、S2 が自分のものとして載れば S1 の候補も登録される。別の人が S2 を載せても、自分の S1 の候補は捨てない。重なった登録は今どおり GAS の重複の判定で消える。
  - 古い GAS（stamp がない）では今どおり `stored:true` で登録。ユーザーの決定どおり、開き忘れて遊んだ分（共有より新しいセーブ）は後から埋まり、共有と同じセーブでは動かない。履歴の新旧は `compareSaves` で比べる。
- テスト: owned-status（名指しの 3 通り・shareLagNotice・ゲーム中の判定〔1 回の変化・2 回・離れた 2 回の同期・最初の読み込み・古い〕）、save-status、auto-register（結果の種類ごと・自分と他人の `unchanged`・**S1 の応答を失う → S2 を読む → 再試行で S1 にしかない証拠も登録される**・**S1 の応答を失う → 別の人が S2 を載せる → S1 の候補は残る**（ホスト中の推定が立つ前の S1 も）・**S1 の送信中に S3 を読む → S1 の `stale` で S3 の候補は決まらない**・**同じ配合の証拠が S1 と S3 にあり、S1 の応答で S1 の分だけが決まる**・7 日の期限・他人の `same` で候補を捨てる・登録してよいになった後の他人の共有で取り消されない・対応が未設定で待つ候補・読み込み直しの後に決まる・古い GAS・ファイルの更新日時だけが新しい同じセーブ）、owned-settings の文。

### 8. `page-presence`（P0 の後）
- 送る側（`web/js/owned.js`）: ログインしているページは、今のワールドについて 60 秒に 1 回 `presence` を送る（表のタブの参加者は 10 秒ごとの `ownedSince` に載せるので別には送らない）。`role`（判定の結果）・`playing`（7 の判定）・`canShare`（一式の登録＋許可 granted）。`device` はワールドごとに localStorage のランダムな値、`pageId` はページを読み込むたびにメモリの中で作るランダムな値（sessionStorage は複製されたタブで同じ値になるので使わない）。古い GAS ではできないと覚えて送らない。
- 表示（ヘッダーのセーブ連携のパネル、`ui/save-status.js`）: 「ページを開いている PC」— ● 3 分以内に応答があった PC（例「Alice · 1 分前 · ホスト中 · 共有できる」。役割・ゲーム中・共有できるは、その PC の 3 分以内のページの応答だけでまとめる）、○ それより前は「最近の応答なし（3 時間前）」（閉じていると断定しない。古いページの役割は出さない）、6 時間より前は出さない。同じ人の 2 台目は「（PC 2）」。7 の案内にも添える。
- テスト: owned-store（送る間隔・相乗り・裏のタブ・古い GAS）、save-status（● ○・まとめ方・6 時間）、mock-api。

## GAS の反映・巻き戻し
1. `owned-gas` を統合ブランチに入れる → `npm run gas:push`（HEAD だけ更新。本番の deployment は版 10 のまま）。
2. GAS エディタ（HEAD のコード）で **`setup()`** を実行し、列 `saveKey` を test・prod の両方に足す（本番の版 10 は知らない列を無視するので、この時点で本番に影響はない）。
3. テスト用の deployment を作る（clasp 3.4.1 の deployment の作成のコマンドは実装のときに `npx clasp --help` で確かめる）→ その URL とテスト用パスワードで `owned-bench.mjs`、別の時に `api-check.mjs`（どちらも URL を環境変数で指定できるようにする）。鍵とキャッシュは本番と共用なので、計測は遊んでいない時間に。
4. 数字を見て 4〜8 の値を決める。巻き戻しのリハーサル（下の 6。巻き戻している間の共有の書き込み → 新しい版に戻す、まで）もテスト用の deployment で行う。
5. 本番（P0 の後）: `npx clasp update-deployment <本番の ID>` → `npx clasp list-deployments` で版 11 を確かめる → 画面を配信 → ホストの PC のタブを読み込み直す。
6. 巻き戻し: `update-deployment` で本番を版 10 に戻す → GAS エディタ（HEAD のコード）で `compactOwned('prod')`（停止の印を立ててから、今の世代だけにして `saveKey` を空にする。遅れて届いた新しい版の呼び出しは印を見て書かない）→ 共有を読み、2 世代が残っていない・`saveKey` が空なことを確かめる。リハーサルは `compactOwned('test')`・`resumeOwned('test')` だけで行う（巻き戻している間の書き込み → 新しい版に戻す、まで）。戻してから圧縮するまでの間は、古い画面に 2 世代が重なって見えることがある（そのワールドの次の共有でも直る）。古い版は `saveKey` を書かないので、圧縮の後は空のまま。新しい版に戻すときは `resumeOwned('prod')` → `update-deployment`。最初の共有は今の更新日時の比較で動く。

## 時間と負荷の見込み（要実測）
- 目安: 気づく約 0.01 秒（Observer）／最大 5 秒（Worker）＋書き終わりの待ち〔P0〕＋解析約 1 秒＋共有〔F1・要計測。今は 14〜22 秒〕＋参加者の読み直し 0〜10 秒＋約 3 秒。最悪の値は約束しない（タブが freeze されるとタイマーも通信も止まる。表に戻ったらすぐ照らし合わせる）。見張りの方式ごと・表と裏ごとに実測して報告する。
- GAS: 呼び出しごとに認証で設定のシートを読む（`gas/Auth.js:14`）。共有は保存ごと（約 120 回/時）、参加者の読み直しは今の所持パル・理想個体だけから全画面へ広がる、presence は 1 ページ 60 回/時。鍵の待ちの上限は 25 秒（`gas/Sheets.js:38`）。公表の上限だけでなく、計測の失敗率と、Apps Script の「実行数」を 1 週間見て確かめる。

## 検証
1. 各テーマで `npm test`。統合の後に UTC でも、`npm run test:perf`（1 は所持パルの perf を前後で比べる）。
2. GAS: harness のテスト（古い GAS＋新しい画面を含む）→ テスト用の deployment で計測と `api-check`・`/diag.html` → 本番。
3. P0 と、実装の後の実機（ユーザーがホスト。Chrome）: 一式を登録して遊び、タブを裏に 5 分より長く。パネルの「監視」の行で検出数・書き込みの長さ・共有の時刻、参加者の画面（別のブラウザかスマホ）で反映までの秒数。
4. 参加者側: DevTools で `ownedSince` が 10 秒ごと・裏では止まる。ホストのタブを閉じて約 5 分で遅れの案内と「最近の応答なし」。参加者用の登録のままホストしても案内。
5. 同期の後: SaveSync の後に別の PC（またはホストの PC で開き直し）でページを開き、結果が `unchanged`／`same`・`uploadedBy` が変わらない・自動登録が動かない。共有より新しいセーブなら `newer` で自動登録が動く。
6. 次元ストレージ: `npm run check:save -- "<World9>"` で 118・読めていない 0。`_dps.sav` を 1 つ外して登録し、ホストと参加者の両方に案内。位置をゲーム内の位置と照らす。

## リスクと未確定事項
- FileSystemObserver の Level.sav（2.7MB）の書き方・書き終わりまでの時間・Edge での有無（P0 で確かめる。なければ Worker）。Chrome の仕様の変化。
- SaveSync が更新日時を書き換えるか・LocalData.sav を各 PC 分どう扱うか（P0）。同じセーブの見分けと新旧は `Level.sav` の中の保存時刻（生のティック）で比べ、更新日時は変化の検知と、識別のない古い形のときだけに使う。保存時刻はホストの PC のローカル時刻なので、仲間が別のタイムゾーンで遊ぶと交代の前後の新旧を誤る（前提として OPERATIONS.md に書く）。PC の時計のずれは、交代の間（ゲームの終了と同期の時間）より小さい前提。グローバルパルボックス（Steam アカウントごと）が別の人の物として載るずれは範囲の外（別の人の同じセーブは `same` で上書きしないので、今より悪くはならない）。
- F1: 公開の前に落ちた孤児の行・③の失敗・大きなシートでの `deleteRows`・`insertRowsAfter` の速さ（計測とテストの失敗の注入で確かめる）。
- CacheService は期限前に消えることがある（presence は次の 60 秒で戻る。表示は「最近の応答なし」）。
- 送るタブを 1 つに決めないので、同じ PC で 2 つのタブを開くと解析も 2 回になる（同じ中身の共有は `unchanged` で書かない。古い版のタブや登録の少ないタブの劣った中身は `same` で断る。自動登録は今の注意のまま）。

## 主に触るファイル
web/js/owned.js・web/js/app.js・web/js/core/{owned,owned-shared,boundary}.js・web/js/save/{palworld,handles,worker}.js（または新規 save/watch.js）・web/js/ui/{owned-status,save-status}.js・web/js/views/{owned,ideal,route,owned-settings,shared}.js・web/js/auto-register.js・web/js/api.js・dev/mock-api.js・gas/{Owned,Actions,Sheets,Setup}.js（gas/Shared.js は build:gas で生成）・scripts/{check-save,api-check,owned-bench（新規）}.mjs・docs/{OPERATIONS,SAVE_FORMAT}.md・web/js/release-notes.js・テスト一式。P0 の実験のページは `Claude outputs/sync-fixes/probe/`（Git の対象外）。
