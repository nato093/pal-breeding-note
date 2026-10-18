# 専用サーバー（ServerSync）対応（server）

> 2026-10-18 にユーザーが承認したプラン（調査 11 本・設計 6 本＋横断チェック・Codex のレビュー 3 回を反映済み）。進み具合は [TODO.md](TODO.md)。実在のプレイヤー名・ワールド名・ID は書かない（作成者の UID は「U」、旧ホストの UID `00000000…0001` は「H」と書く）。
> 詳しい設計の下書き（テーマごと）と調査の生の結果は `Claude outputs/server/`（Git の対象外・この PC だけ）。文書と食い違えば、この文書が正。

## Context（なぜ・何を）

- 今までは協力プレイ（招待コード・ホストの交代・SaveSync で同期）に合わせて作ってきた。今後は ServerSync（Steam app 4862380。SaveSync と同じ開発元）で、サブ PC に専用サーバーを建てて遊ぶ。協力プレイのワールドも使い続ける。
- サーバーのセーブの形式・協力プレイとの違い・対応方法を調べた（読み取りのみ。11 本の調査と反証を行った）。
- ゴール: サーバーで遊んでいる間も、GAS とほかのプレイヤーが今までどおりノートを使えること。サーバーの PC には常駐プログラムを置く。サーバーにしたことで良くなる点も取り込む。
- テスト用サーバーは、このメイン PC の ServerSync のインスタンス（以下「テストのインスタンス」。場所は `%LOCALAPPDATA%\ServerSync\instances.json`）。本番は別のサブ PC に建てる。

## 調査の結果（要点・確認済み）

### サーバーのデータの形式と、今のツールとの違い

| 項目 | 協力プレイ | 専用サーバー（ServerSync） | ツールへの影響 |
|---|---|---|---|
| 置き場所 | `%LOCALAPPDATA%\Pal\Saved\SaveGames\<SteamID>\<ワールドID>` | `<インスタンス>\bin\Pal\Saved\SaveGames\0\<ワールドID>`（AppData の外） | パスの正規表現はそのまま当たる（steamId が '0'） |
| 中身の形式 | GVAS（Oodle・zlib） | 同じ。今の `readWorldFiles` でエラーなく読めた（1767 体・約 0.8 秒） | 解析の直しは要らない |
| ワールド ID | <ワールド ID> | **同じ** | GAS の共有の行は続く（サーバーの方が新しいので上書き） |
| ホストの PlayerUId | `0000…0001`（H） | 作成者の Steam ID から決まる `<作成者の UID>`（U） | UID をキーにした対応と「自分」が切れる |
| 個体の OldOwnerPlayerUIds | — | **H が書き換わらずに残る**（拠点の 115 体中 66 体、牧場 2 か所の親） | 預けた人が分からなくなる（自動登録の登録者が未設定、自分の個体から外れる）。H は「その時のホスト」なので、仲間がホストだった時期の分も混ざる |
| キャラクターの InstanceId | （同じ値） | **変わらない** | 往復しても同じ人を指せる手がかりになる |
| LevelMeta | ワールド名・ホスト名・Lv | 保存すると WorldName が "Autosave_W" になり、ホスト名が消える | 共有のワールド名が "Autosave_W" になる |
| LocalData.sav | ホストの PC が書く | サーバーは書かない（ServerSync が写した古いものがあるだけ） | 今は必須ファイルなので、写しがないと登録できない |
| GlobalPalStorage.sav | ホストの PC にある | ない（各自の PC にある）。設定は取り込み禁止 | グローバルの 42 体が消える。HOST_UID の決め打ちが空振りする |
| WorldOption.sav | ある | **写されていない** → ゲームの設定が 18 項目違う（孵化 72 時間←1 時間、デスペナルティ「全部」←「アイテム」など） | ツールとは別の問題。合わせる（決定 11） |

- 参加者の PC は、サーバーに入ると同じワールド ID のフォルダの LocalData.sav だけを 30 秒ごとに書く。今の判定（`web/js/save/source.js` の `judgeRole`）のままで「参加」になる。
- サーバーの保存時刻（Level.sav の Timestamp）も PC のローカル時刻。新旧の比較（`compareSaves`）はそのまま使える。
- ギルドの last_online によるプレイヤーごとの「プレイ中」の判定はサーバーでも正しい。一方、`core/playing.js` の「ゲーム中」の推定（保存が続いているか）は、サーバーが動いている間はいつも真になる。
- サーバーはオフラインの人の Players も毎回書き直す。`_dps.sav` は中身が同じでも更新日時だけ変わる。保存のたびに FName の大文字と小文字が変わることがある（種族の引き当ては小文字にそろえるので影響はない）。

### 新しく使える情報（今回は機能にしない・決定 9）

- Palworld の REST API（127.0.0.1:8212・Basic 認証・CORS なし）: 接続中の人（名前・ID・Lv・ping・位置）、info（worldguid）、metrics（日数）、保存の実行、ゲーム内アナウンス。
- ServerSync のローカル API（127.0.0.1:54866・認証なし）: インスタンスの一覧・状態・接続中の人数と名前・起動と停止・バックアップ。
- ブラウザから直接は呼べない（CORS がない・Local Network Access の許可が要る・管理者パスワードが要る）。常駐からなら使える。

### 方式の比較（結論: 常駐プログラム）

| 案 | 長所 | 短所 |
|---|---|---|
| A: サーバーの PC でページを開いておく | 足すものが少ない。G:\ はフォルダごと開ける見込み | 無人のタブは許可切れ・裏のタブ・メモリセーバー・版の更新で止まる。Observer がフォルダを押さえる。通知と対応がその PC の中だけになる |
| **B: Node の常駐が読み込み・共有・自動登録をする（採用）** | 今の画面のストアを Node でそのまま組み立てられる（確認済み）。新しく参加した人のファイルも自動で拾える。ブラウザの弱点がない | 常駐の導入と更新の手間。対応を GAS に置く必要がある |
| C: 常駐がデータを渡し、ページが送る | — | A と B の弱点を両方抱える |

### これまでの要望との関係

- **サーバーで良くなる**
  - ページの開き忘れで共有と自動登録が止まらなくなる。
  - 送り手が 1 つになる（古いタブとの書き合いがなくなる）。
  - 新しく参加した人の Players のファイルを自動で拾える。
  - 保存時刻の時計が 1 台になる。
  - 「ホストの画面だけ」の情報を全員に出せる。
  - 招待コードが要らなくなる。
  - プレイ中の人を REST で正確に取れる（今回は入れない）。
- **変わらずできない**
  - 孵化の残り時間、お気に入り、牧場に置いた人。
  - 参加者の PC のファイルだけで所持パルを読むこと。
  - GAS の書き込みにかかる 13〜15 秒。
- **サーバー化で失う（今回直す）**
  - 預けた人（旧ホストの UID）。
  - ワールド名とホスト名。
  - ホストの画面だけの情報。
  - 対応と自動登録の通知が、サーバーの PC の中だけになる。

## ユーザーの決定（2026-10-18）

1. 本番のサーバーは別のサブ PC に建てる。この PC はテスト用。
2. 協力プレイとサーバーを両方使う。
3. 常駐プログラムを置く（Node を入れてよい）。
4. サーバーは遊ぶときだけ起動する。
5. 元のワールド はサーバーと協力プレイを**往復**する（サーバー→協力プレイの変換はユーザーが行う。同時には進めない）。
6. 旧ホストの UID（H）は、プレイヤーの対応に「以前のホスト（0000…0001）」の行を出して選べるようにする。
7. 常駐はサーバー専用の ID（例「サーバー」）でログインする。
8. ホストの画面だけだった情報を全員に共有する。
9. REST の状態表示・通知の共有・ゲーム内アナウンス・今すぐ保存は、今は入れない。
10. グローバルパルボックスはサーバーでは出さない。
11. サーバーのゲーム設定を協力プレイの 元のワールド に合わせる（差の一覧を見せてから直す）。
12. プレイヤーの対応を、画面で誰でも設定・変更できるようにする（基本は名前が同じ）。常駐もそれを使う。そのため対応は GAS に置く。
13. 実機の確認にはユーザーが参加する。仲間の参加方法はこの作業の範囲外。
14. 仲間も ServerSync の共有でサーバーを建てるかもしれない。常駐は、どの PC にも入れられる作りにする。
15. ノートの ID は基本ゲーム内の名前と同じだが、対応は画面で設定・変更できるようにする（12 と同じ）。
16. ブラウザの「ワールドを登録」では、サーバーのセーブのフォルダ（`SaveGames\0\…`）を登録させない（常駐だけが読む）。
17. 対応の行は、「預けた人」がワールドにいないプレイヤー**全員**に出す。往復すると、協力プレイに戻した後に U も残るため。H 以外の UID は人ごとに固定なので、一度選べば往復しても正しい。
18. 常駐に「古い系統の守り」を入れる。古いサーバーのワールドで共有を上書きしないため。
19. ゲームの設定は P0 で差の一覧を見せ、要確認の項目（`bAutoResetGuildNoOnlinePlayers`・`bAllowGlobalPalboxImport`・最大人数・`-publiclobby` など）をその場で決める。
20. 作業の管理は、これまでどおり `docs/server/README.md`・`TODO.md` で行う（AGENTS.md の bd は今回も使わない。ユーザーの回答）。

## 実装の方針（全体像）

```
サーバーの PC: PalServer（ServerSync）── セーブ（G:\…\SaveGames\0\<ワールドID>）
                    │ 5 秒ごとに stat・読む（フォルダを押さえない）
               常駐（Node。tools/server-agent/）── 画面と同じストアを Node で組み立て
                    │ ownedUpload・create・presence・playerMap（ID「サーバー」）
                    ▼
                  GAS（版 13）── スプレッドシート（OwnedWorlds・OwnedPals・PlayerMap）
                    ▲
各自の PC: ページ（参加者。LocalData.sav だけ新しいので自動で「参加」）── 対応を画面で設定
協力プレイの期間: 今までどおりホストの PC のページが共有する（往復しても同じワールドの行）
```

- データの意味の直し（同一性・旧ホスト・サーバーの種類・共有の拡張）は `web/js/core`・`web/js/save` に入れる。画面と常駐の両方に効く。
- 常駐は画面のストア（`createStore`・`createOwnedStore`・`createAutoRegister`）を再利用し、ブラウザに頼る所だけを差し替える。新しいロジックは持たない。
- GAS の変更は版 13 に 1 回でまとめる。GAS を先に配信し、画面、常駐の順に出す。

## テーマ間の取り決め（横断チェックで決めたこと）

- **プレイヤーの鍵**: `i:<キャラクターの InstanceId>`。InstanceId がないとき・ワールドにいない UID は `u:<uid>`。
  - 定数・関数（`HOST_UID`・`playerKeyOf`・`playerMapKey`・GUID の検査）は `web/js/core/owned-shared.js` の 1 か所に置く。build:gas で GAS にも写る。
  - プレフィックスのない UID は、前の版の値を読むときだけ受けて `u:` に読み替える。
- **鍵から UID への解決は `auto-register.js` の `mappingFor` だけで行う**。`ideal-goals.js`・`auto-breeding.js`・`app.js` の identity は、今の「uid → ID」の形のまま使う。
  - `mappingFor` に渡すプレイヤーは次のとおり（Codex の指摘。協力プレイの古い H が手元に残り、共有では U になっているときに食い違わないため）。
    - 自動登録の判定: その回の `ctx.snapshot.players`。
    - 表示と設定の欄: **今表示しているデータ**（`state.owned.players`）。
    - `setMapping`: 鍵を設定の欄と同じ一覧から作る。
  - 「手元に古い H が残る参加者」の場合をテストする。
  - `u:H` は、H がワールドのプレイヤーにいないときだけ効く。協力プレイのホストを「以前のホスト」の対応と取り違えないため。
  - 前の版の H の対応・「自分」を `i:` に移すのは、この PC がホストとして読んだ手元のデータのときだけ。
- **共有のワールドの追加の情報は、`OwnedWorlds` の新しい列 1 本（`extras`。JSON）にまとめる**。
  - 中身は `{ at: uploadedAt, saveKind: 'server'|'coop', items, formers, clock }`。`formers` は「ワールドにいない UID と、拠点・牧場の数」。`clock` は Level.sav の `RealDateTimeTicks` の 10 進の文字列。
  - 読むとき、`at` がその行の `uploadedAt` と違えば使わない。版 12 に巻き戻した間の古い値を使わないため。
  - **セル全体を 45,000 字以下に詰める `fitOwnedExtras`** を置く（Codex の指摘。在庫と formers を合わせると 5 万字を超えうる）。詰める順は、在庫の場所の内訳を外す → formers を数の多い順に切り、`formersPartial` の印を付ける。画面・GAS・開発用 API の検査で同じ関数を使い、GAS は行を書き始める前に確かめる。
  - `contentHash` に入れるのは `items` だけ。`clock`・`saveKind`・`formers` は入れない。
- **`OWNED_FORMAT` は統合のときに 1 回だけ決める**。足す列（`soul`・`condition`）と JSON の形の変更を合わせて、規則（owned-shared.js:144-149）で計算する。設計の時点の見込みは 10。
- `fitOwnedPlayers`（players のセルを 45,000 字以下に詰める）が外すのは `captures` だけ。`instanceId` などは必ず残す。
- presence に `resident: true` を足す。`api.js` の `presenceFields` にも足す（足さないと送る前に落ちる）。
- サーバーの見分けはパスの `SaveGames\0`（steamId '0'）で行う。関数は `handles.js` に 1 組（`SERVER_SAVE_ID`・`isServerWorld`）だけ置く。中身では判定しない。
- 常駐の独自の回避策（仮の LocalData.sav・名前の置き換え・`mapping-sync`）は作らない。core の直しを使う。
- release-notes は v13 の配信で 1〜2 件にまとめる（例「サーバーのワールドに対応」「捕獲数や在庫も共有」）。

## フェーズとテーマ

進め方は sync-fixes・UI 改善と同じ。統合ブランチ `integrate/server` を切り、テーマごとのブランチで実装して、Codex のレビューを通してからマージする。経緯・決定・P0 の結果・TODO は `docs/server/README.md`・`docs/server/TODO.md` に書く（引き継ぎ用）。main への反映と push は、フェーズの報告の後にユーザーに確認する。

### P0 実機の確認とゲーム設定（コードの前・約 30 分、うちユーザーの参加 10 分）

1. **バックアップ**
   - ServerSync の手動バックアップ（ローカル API `POST /instances/<ID>/backup`）を取る。
   - あわせて、サーバーの `SaveGames`・ini と、この PC の協力プレイの 元のワールド のフォルダ一式を `<バックアップのドライブ>pal-backup\<日時>\` に写す。リポジトリ・SaveGames の下・インスタンスの中は避ける。
2. **設定の差**: `scripts/server-settings.mjs`（新規。既定は読み取りのみ）で、元のワールドの `WorldOption.sav` と ini の差の表を出し、ユーザーに見せて決めてもらう（決定 11・19）。
   - 書き換えは PalServer が止まっている間だけ、ini の対象の `Key=Value` だけを書き換える（`--apply`。ServerSync は手での編集を取り込む）。
   - パスワードの項目は読まない・出さない。
3. **測る**（1 秒ごとの stat だけの使い捨ての道具。`Claude outputs/server-p0/`。Observer と fs.watch は使わない）
   - 起動はローカル API の `action start` で、許可した操作だけを使う。
   - 誰も接続していない間を 6 分 → ユーザーが参加して 10 分（牧場の親の預け直しと、タマゴを 1 つ）→ 切断して 6 分 → 停止。
   - 測るもの:
     - M1 保存の間隔（無人・接続中）
     - M2 保存の書き方
     - M3 無人の間に共有の中身が変わる間隔
     - M4 REST の worldguid と `DedicatedServerName`
     - M5 停止・起動で ini が残るか
     - M6 **預け直しで OldOwner の最後が U になるか**
     - M7 参加者の LocalData.sav
     - M8 ゲームを終えたときの SaveSync
     - M9・M10 停止と起動の流れ
     - M11 Timestamp と更新日時
     - 古い系統の守りに使う単調な値（`RealDateTimeTicks`・`GameDateTimeTicks`）が保存のたびに進むか
     - REST と ServerSync のローカル API の待ち受けのアドレス（`netstat`）と、ファイアウォールの規則
   - M3 は、今回共有に足す状態（`normalizeOwned` の `soul`・`condition`）も含めた中身で測る（Codex の指摘）。
   - REST の AdminPassword は、プロセスの中で ini から読むだけにする（表示しない）。
   - P0 の間、仲間は協力プレイの 元のワールド をホストしない（SaveSync と重ねない）。
4. 結果と決めたことを `docs/server/README.md` に書く。M3 の結果で、常駐の「同じ中身なら送らない」を入れるかを決める（今の見込みは入れない。状態の共有で中身が毎回変わり、遊ぶときだけ動かすので、今の協力プレイのホストと同じ量になる）。

#### P0 の結果（2026-10-18。テストのインスタンス・このメイン PC。ユーザーが参加）

- 条件: 13:37 起動 → 無人 → 14:57 にユーザーが参加 → 15:45 に退出 → 15:49 に停止 → ゲームを終了。13:54〜14:54 は **PC がスリープして、サーバーも計測も止まっていた**（Windows の電源の記録で確認）。記録は `Claude outputs/server/p0/logs/`（Git の対象外）。
- 設定: 決定 11・19 のとおり、合わせる候補の 9 項目を `scripts/server-settings.mjs --apply game` で書き換えた（`bAutoResetGuildNoOnlinePlayers` は false のまま）。起動の後、REST の `/v1/api/settings` で 9 項目とも効いていた（応答にパスワードの項目はない）。停止のときにサーバーが ini を書き直したが、値は残った（M5）。書き換えの前の写しは同じフォルダの `PalWorldSettings.ini.before-<日時>`、セーブと ini の写しは `<バックアップのドライブ>\pal-backup\<日時>\`。
- M1 保存の間隔: **誰も接続していなくても 30.0 秒ごとに保存する**（無人 33 回の中央値 30.02 秒・29.6〜30.3 秒、接続中 94 回の中央値 30.0 秒）。
- M2 1 回の保存: `Level.sav` → `LevelMeta.sav` → `Players` の 4 ファイルが 6 ms の間にそろう。`backup\world\<日時>` は保存のたびに増え、古いものが消える（3〜7 個）。
- M3 共有の中身: 状態（SAN・空腹など）は**保存のたびに変わる**（無人でも毎回）。状態を除いた共有の中身は、無人の 17 分で 5 回（牧場のタマゴなど。無人でもワールドは動く）、接続中の 48 分で 13 回変わった。
- M4: REST の `/v1/api/info` の worldguid は、セーブのフォルダ名と一致した。
- M6: **牧場の親を拠点から取り出して置き直すと、「預けた人」が今のプレイヤーになった**（6 体すべて。前は 4 体が H）。
- M7: 参加者の PC は、協力プレイと同じワールド ID のフォルダの `LocalData.sav` だけを 30 秒ごとに書く（Level・Players・GlobalPalStorage.sav は変わらない）。
- M8: サーバーで遊んだ後にゲームを終えても、SaveSync は協力プレイのフォルダを書き換えなかった（15 分見た）。
- M9 停止: ServerSync の stop → REST の save → shutdown → 6 秒で停止。最後の保存は停止の直前に書かれ、読めた。
- M10 起動: ServerSync の `status.state` は、起動の後も**誰かが接続するまで `Starting` のまま**で、最初の接続で `Ready` になった（`status.running` は起動から `true`）。REST は起動の数秒後から応答した。
- プレイ中の判定: 退出から約 37 秒後の保存で、ギルドの記録の「プレイ中」も 0 人になった。REST の players も同じ。
- 時計: `RealDateTimeTicks` は壁の時計と同じだけ進んだ（PC のスリープの間も進んだ）。`GameDateTimeTicks` も進み、日数は 678 → 680。
- CORS: REST の OPTIONS には 404 が返り、CORS のヘッダーもない（ブラウザのページからは呼べない）。
- 待ち受け: ServerSync のローカル API は 127.0.0.1:54866 だけ。REST（8212）の待ち受けのアドレスは、サーバーが止まった後に見たので未確認（T6 で見る）。

#### P0 で決めたこと

- 常駐がサーバーの稼働を判定するのは、ServerSync の `status.running`（と `pid`）にする。`state` が `Ready` になるのを待たない（誰かが接続するまで `Starting` のままのため）。
- 「同じ中身なら送らない」は入れない（状態が保存のたびに変わるため。サーバーは遊ぶときだけ動かす）。GAS の負荷は T6 の計測で見て、問題があれば考え直す。
- 決定 6 の「正確にしたい牧場は親を預け直す」は、そのまま案内してよい（M6）。
- **サーバーの PC はスリープしない設定にする**（スリープの間はサーバーも常駐も止まる）。T6 のサブ PC の導入の条件に足す。
- 常駐の presence の `playing` は、保存が続いているか（`core/playing.js` の推定）で決めてよい。サーバーが動いている間は 30 秒ごとに保存するので、「サーバー稼働中」の意味になる。

### T1 identity: プレイヤーの同一性・ワールドにいない人・サーバーのワールド（大）

- `web/js/save/palworld.js` `buildSnapshot`: `players[].instanceId` を足す。Level のプレイヤーのキーと `Players/<uid>.sav` の IndividualId から取る。"Autosave_W" は名前にしない（`isGenericWorldName`）。`world.clock`（RealDateTimeTicks）を残す。
- `web/js/core/owned.js`:
  - `normalizeOwned`・`sharedUpload`・`ownedFromShared` に `instanceId` を通す。
  - `formers` を作る。対象は拠点・観賞用の lastOwner と牧場の depositor のうち、プレイヤーにいない UID。
  - 名前は、H がいなければ「以前のホスト」、ほかは「不明なプレイヤー（頭 8 字）」。
  - `HOST_UID` の決め打ち（:139,451）は、H がいるワールドだけにする。
- `web/js/core/ideal-goals.js:7,148`: グローバルパルボックスの判定を、H がいるワールドだけにする。`ownPlayerUids` は「自分」を鍵で引き、ワールドにいない UID のうち自分に対応づけたものを足す。
- `web/js/core/auto-breeding.js`: `resolveRegistrant` は、2 体の預けた人の UID が違っても、対応が同じノートの ID ならその ID にする。
- `web/js/self-player.js`: このワールドでの自分を `i:` で持ち、前の版の UID から移す（H は手元のホストのときだけ）。
- サーバーのワールドの種類（`web/js/save/handles.js`）:
  - steamId '0' は、必須を Level.sav・LevelMeta.sav だけにし、役割を host に固定する。LocalData.sav と GlobalPalStorage.sav は使わない。
  - 名前は「登録・設定の名前 → セーブの名前（汎用の名前を除く）→ 前の共有の名前」の順で決める。ホスト名は空。
  - 共有に `saveKind` を載せる。
- `web/js/owned.js` `ownedOf`: 参加者と判定したワールドで、手元の古いデータを返さない（CSV の書き出しの不具合。別のコミット）。`canShare` は変えない。
- GAS: `extras` 列の読み書き（`at` で確かめる）。players の JSON の `instanceId` を残す。

### T2 share-extras: ホストの画面だけだった情報を全員に（中。T1 と同じブランチで続けて実装）

- `OwnedPals` に列 `soul`（`hp|attack|defense|craft`）・`condition`（`sick|hunger|san`。SAN は整数）を足す（`OWNED_FIELDS`・`OWNED_ADDED_FIELDS`）。
- 捕獲数は players の JSON の `captures` に入れ、`fitOwnedPlayers` で詰める。牧場のケーキは farms の JSON の `c` に入れ、`fitOwnedFarms` の段（タマゴ → ケーキ → 牧場）で詰める。在庫は `extras.items` に入れる（`cleanOwnedItems`・`fitOwnedItems`）。
- `ownedFromShared` で戻す。画面の分岐は「null なら出さない」だけなので、値が入れば参加者にも出る。「ホストの画面」の文言とコメントを直す。
- 古い GAS（版 12）は 31 列を `INVALID_COLUMNS` で断る。そのときは今の「狭めて送り直す」で 29 列にして送る（届かないだけで、共有は止まらない）。

### T3 mapping: プレイヤーの対応を GAS に置き、誰の画面からでも設定（中〜大。T1 の後）

- GAS: 新しいシート `PlayerMap`・`PlayerMap_test`（`worldId・key・userId・playerName・updatedBy・updatedAt`）と、新しいファイル `gas/PlayerMap.js` を足す。
  - 操作 `playerMap`（読む）・`playerMapSet`（50 件ずつ・`onlyMissing`・外したら墓標の行・ノートにない ID は断る）。
  - `actionRename_` で、ID の変更に合わせて書き換える。
- 画面: `web/js/player-map.js`（新規。DOM を使わないので常駐も使う）。
  - `createPlayerMapStore` を作る。写しを持ち、`BAD_ACTION` は 1 時間覚える。古い GAS なら前の localStorage の対応に落とす。
  - `auto-register.js` に `mappingFor`（解決の 1 か所）、`setMapping` の非同期化、移行の `syncPlayerMap`（前の対応を `onlyMissing` で一度だけ上げる）を入れる。
- 設定の「プレイヤーの対応」（`views/owned-settings.js`）: ホスト・参加者・閲覧者の誰でも選べる。
  - 行はワールドのプレイヤーと、`formers` の「以前のホスト（0000…0001）」「不明なプレイヤー（XXXXXXXX）・拠点 n 体・牧場 m か所」。
  - `formers` は、手元のホストならスナップショットから、ほかは共有の `extras.formers` から出す。
- `ui/owned-status.js` の `nameMismatch` の文を直す（「どの PC からでも選べます」）。
- 読み直し: 自動登録は判定のたびに 60 秒、設定の欄は 15 秒、表のタブは 5 分（`ownedSince` には載せない）。

### T4 participant-ui: 参加者・閲覧者の画面の文言（小〜中。T1・T3 の後）

- 最後の共有の `saveKind` が 'server' のときだけ、文言をサーバー向けにする。往復するので、最後の共有で決める。
  - `roleSummary`（参加者・閲覧者）、`shareLagNotice` の案内、ワールド名の「（サーバー）」、「サーバーのセーブ HH:MM の時点」。
  - 協力プレイの共有なら、今の文言のまま。
- 「ページを開いている PC」の一覧で、`resident` の行を「サーバー（常駐）· サーバー稼働中／停止中」と出す。ヘッダーの新しいチップや REST の状態表示は作らない（決定 9）。
  - サーバーが止まっているのは正常として扱う（警告の色にしない）。警告は「常駐が動いているのに共有が古い」と、今の「参加者がゲーム中なのに共有が止まっている」だけ。
- 登録のモーダル: `SaveGames\0\…` を貼ったら「専用サーバーのセーブはサーバーの PC の常駐が読み込みます」と出して登録させない（決定 16）。「交代でホストする人も」は「協力プレイで交代でホストする人も」にする。
- README の表記の決まりに「サーバー（Palworld の専用サーバー）」「常駐（常駐プログラム）」を足す。

### T5 agent: サーバーの PC の常駐（大。T1〜T4 の後）

- `tools/server-agent/`。依存なし、Node 22 以上（24 LTS を勧める）。
  - `main.mjs`: 引数・二重起動の防止・終了コード。
  - `config.mjs`: パスワードは環境変数だけ。prod は config.json に `env: "prod"` があるときだけ動き、応答の env が違えば止まる。
  - `fs-handles.mjs`: stat と読み込みだけ。ENOENT・EBUSY などを DOMException の名前に変える。フォルダを押さえない。
  - `discover.mjs`: 設定のパス → `%LOCALAPPDATA%\ServerSync\instances.json` → `GameUserSettings.ini` の `DedicatedServerName` の順に探す。`instance.json`・`PalWorldSettings.ini` は読まない。
  - `server-state.mjs`: 対象のインスタンスのサーバーが動いているかを見る（下の「サーバーが動いているか」）。
  - `watch-client.mjs`: `createSaveWatcher` を Observer なしで使う（5 秒ごとの確認）。
  - `kv-storage.mjs`: localStorage の形をファイルに書く。パスワードとキャッシュは書かない。
  - `agent.mjs`（組み立て）・`log.mjs`（ID・パス・IP・秘密を伏せる。値は JSON の文字列にする・切る前に伏せる）。
  - `gas-client.mjs`: GAS との通信（常駐・`--once`・`--signup`・`--check --online`・`--dry-run` の読み取りで共通）。送る 1 回ごと（`createApi` の自動の再送を含む）に、止める条件（常駐の停止・最後の送信の期限・attach の世代）と応答の env を確かめる（Codex の再レビュー）。
    - env は形の検証と再送より前に比べ、失敗の応答でも env があれば比べる。GAS は版 13 から認証の後の失敗にも env を付ける（画面は失敗の env を読まない）。
    - env を確かめられていない間（起動の直後・env のない失敗の応答〔認証の前・版 12 以前の GAS〕の後）の書き込みは、先に読み取り（`ownedWorlds`）で確かめてから送る。
- **サーバーが動いているかは、対象のインスタンスに結び付けて決める**（Codex の指摘。イメージ名だけだと、別のインスタンスの PalServer を取り違える）。
  - 第一に、ServerSync のローカル API の `GET /instances/<ID>` の `status.state` を見る（読み取りの GET だけ）。
    - この応答には起動の計画が入り、管理者パスワードなどの秘密を含みうる（Codex の指摘）。`status.state` だけを取り出したら、応答の残りはすぐ捨てる。ログ・例外の文・キャッシュに残さない。
    - 秘密が出ないかのテストでは、GAS の共通パスワードに加えて、管理者パスワード・ServerPassword のダミー値も調べる。
  - 取れなければ、PalServer の実行ファイルのパスが対象のインスタンスのフォルダの下か（`Get-CimInstance Win32_Process` の ExecutablePath）で見る。
  - どちらでも決められないときは、共有と自動登録をしない。複数のインスタンスが候補なら、更新日時では選ばず、設定の `instance` を求める。
  - ServerSync が動いていると言うときも、この PC で対象のフォルダの PalServer が動いているかを実行ファイルのパスで確かめる（30 秒で確かめ直す）。確かめられなければ決められない扱い（Codex の再レビュー）。
- 動き:
  - 起動したら「サーバー」でログインする。
  - 対象のサーバーが動いている間（＋60 秒）は、セーブを読んで共有・自動登録する。Players に増えたファイルは、10 秒ごとの見直しで足す。
  - **止まったら、読み込みの部品を全部止める**（Codex の指摘。`owned.js` の見張りの `onSettled` は自分で読み込みを始めるため）。
    - 止めるもの: 見張り（`update([])`）・読み直しと送信の予約・自動登録の判定。
    - 最後の保存の送信は**最大 60 秒だけ**待ち、送れなくても（通信の失敗・古い系統で送らない）、読み込みと見張りは必ず止める（Codex の指摘）。送れなかった最後の保存は、次に動いたときの読み込みで送る。
    - presence は常駐が自分で送る（`owned.js` の `reportPresence` は使わない）。形は `cleanPresenceInput` に合わせ、対象のワールド ID・`role: 'host'`・`resident: true`・`playing`（サーバーが動いているか）を、ファイルの読み込みとは別に決める。
  - 対応は `createPlayerMapStore` で GAS から読む。
- **古い系統の守り**（決定 18。Codex の 2 回のレビューで強めた）。小さな部品 `lineage-guard.mjs` にまとめ、状態は KV に残す。
  - **比べ方**: 同じ単位どうしだけを比べる。
    - 両方に `clock`（RealDateTimeTicks）があれば `clock` どうし。
    - どちらかに `clock` がなければ日数（`inGameDay`）どうし。
    - 日数もどちらかになければ比べない（送ってよい）。
    - ティックと日数を混ぜて比べたり、大きい方を取ったりはしない。
  - **比べる相手**: 次のどれかより小さければ「古い系統」とする。
    - (a) GAS で公開されている同じワールドの値。ただし受け入れの時点より後に公開されたもの（`uploadedAt` で見る）か、受け入れたことがなければ全部。
    - (b) この常駐が前に送った値（KV に残す）。
  - **判定が済むまでは「判定待ち」**（Codex の指摘。今の `auto-register.js` の `run` は、共有の完了を待たずに候補を取り込むため）。
    - 起動したとき・セーブを読んだたびに、まず判定待ちにする。公開の値を読み、そのスナップショットが古い系統でないと確かめたら、そのスナップショットの保存時刻（stamp）に限って解除する。
    - 公開の値を読んでいる間と、読めない（通信の失敗）間も、判定待ちのまま。
  - **判定待ち・止めている間に止めるもの**: 共有、自動登録の候補の取り込み、登録の直前の送信。
    - `createAutoRegister` に `paused(worldId, stamp)` を足し、候補を取り込む所と送る直前の 2 か所で確かめる。共有のエラーだけでは、前に登録を許した候補が送られるため。
    - 画面のページは `paused` を渡さないので、今の動きは変わらない。
  - **止めた状態は残す**: 一度でも古い系統と判定したら、止めた状態を KV に残す。明示の受け入れまで、再起動しても、後で値が公開の値を追い越しても解除しない。
    - 判定は、公開の値を読み始めたときと状態を書き換える直前とで、attach の世代・受け入れの回が同じときだけ状態に残す（最後の送信の期限の後・次の attach の後・受け入れの後に、前に始めた判定で止めたり解除したりしない。Codex の再レビュー）。
    - KV の状態が壊れている・形が違う（3 項目と値の形）なら止めた状態にする。壊れた `state.json` は写しを残し、止めた状態を書き出すまで元を残す（書く前に終わっても、次の起動でまた止まる）。
  - **受け入れ**: `--accept-world` で行う（動いている常駐には、要求のファイルで伝える）。
    - そのときのセーブの値と、**受け入れたときに GAS から読んだ公開の世代の `uploadedAt`**（GAS のサーバーの時計で作る。`gas/Owned.js:162`）を「受け入れの基準」として KV に残す。(a) の比べる相手は、`uploadedAt` がそれより後の世代だけにする。PC の時計は使わない（Codex の指摘。PC の時計がずれると、直後にまた止まったり、後の公開を見落としたりするため）。
    - 公開の世代がない・読めないときは受け入れない（読めるまで待つ）。
    - (b) の「前に送った値」も、受け入れたセーブの値にする。
    - あわせて、止めていた間の候補と牧場の記録を捨て、最初の読み込みと同じく「記録だけ」から始める。
    - テストで、受け入れの直後の読み込みでも、再起動の後でも、止まらないことを確かめる（Codex の指摘。基準を直さないと、解除した直後にまた止まる）。
  - **限界**（OPERATIONS.md に書く）:
    - 古いワールドを初めて読む PC で、その時点ですでに公開の値を追い越していれば、見分けられない。同じ通算の時間（`clock`）なので、系統そのものは区別できない。
    - 協力プレイの側（古いコピーをホストした場合）には守りがない。
    - どちらも手順で守る: 古いインスタンスは起動しない。別の PC で建てる前に、最後の共有とセーブの日数・時刻を照らす。
- Windows での導入: `install.ps1` と `run-agent.ps1`。実行はユーザー。更新は `git pull` → タスクの再起動（文書に書く）。
  - `install.ps1`: パスワードを SecureString で聞き、**DPAPI で暗号化してデータのフォルダに保存する**（Codex の指摘。ユーザーの環境変数に入れると平文で残るため）。タスク スケジューラに、ログオン時の起動・3 日の上限なしで登録する。
  - `run-agent.ps1`: 暗号化したパスワードを復号し、子の node の環境変数にだけ渡す。落ちたら起動し直す。
  - ログ・例外・`--check` の出力にパスワードが出ないことをテストする。
- 確かめるための引数:
  - `--check`: ネットにつながず、発見と解析の要約だけを出す。
  - `--check --online`: ログインと読むだけ（書かない）。
  - `--dry-run --once`: 送る中身を組み立てるが送らない。
  - `--once --force-host`: test 環境だけ。
- テスト（`test/server-agent/`。`npm test` に入る）:
  - 単体: fs のハンドル、KV（パスワードがファイルに出ないこと）、発見（ダミーの ServerSync の形）、インスタンスの判定、古い系統の守り（判定が済むまで共有も登録もしない・公開の値を読めない間も待つ・止めた状態が再起動でも残る・追い越しても解除されない・前に許した候補も送らない・受け入れの直後と再起動の後に止まらない・受け入れで記録だけから・clock と日数を混ぜない・PC の時計が進んでいても遅れていても受け入れの基準が効く）。
  - 結合（`dev/mock-api.js`）: ログイン → 共有 → presence → 新しいファイル → 自動登録 → 停止（読み込みが止まり presence だけ）→ 停止中の常駐の再起動 → env の違いで止まる。
  - **2 台の常駐**（Codex の指摘・決定 14）: KV が別の 2 つの常駐と 1 つの模擬 GAS で、A が止まって B が建てる引き継ぎを再現する。共有の新旧・自動登録の重複なし・古い系統の守り・全プレイヤーの InstanceId が引き継ぎの前後で同じことを確かめる。
  - 送る本文の文字数を測るテストを足す（GAS の本文の上限は 4 Mi 字〔`gas/Main.js:13`〕。今の 1,767 体で約 66 万字）。上限を超えるワールドでは、常駐のログに理由を出す（上限は変えない）。

### T6 統合・GAS 版 13・配信（中）

1. 統合ブランチで、全テーマの最終レビューを行う（Codex と、別のエージェントの反証）。`TZ=UTC npm test`・`npm run test:perf`・`npm run build:gas` の差分を見る。公開リポジトリに実値がないかを、メモリの一覧で `git grep` して確かめる。
   - **互換テストが CI で黙って省かれないようにする**（Codex の指摘）。`test/gas/legacy.js` は履歴がないとテストを飛ばす。そこで `.github/workflows/pages.yml` の checkout に `fetch-depth: 0` を足し、CI では旧版が取れないときに失敗させる。
   - 互換の場合を足す: 旧画面が `instanceId` のない共有を書く、版 13 → 12 → 13、往復の後の自分・対応・候補。
2. GAS（このメインの PC・テスト用の deployment）:
   1. `npm run build:gas` → `npm run gas:push`
   2. GAS の編集画面で `setup()`（`PlayerMap*`・`extras`・`soul`・`condition` の列を足す。版 12 は知らない列とシートを無視する）
   3. `npx clasp create-version`（13）→ テスト用 deployment を `-V 13` に向ける
   4. `api-check`（playerMap の読み書き、31 列、`extras`、`captures`、`resident`）
3. 常駐をこの PC で試す（test 環境・ID「サーバー」は `Users_test`。test の画面は別の Chrome プロファイルで見る）。
   - テストのサーバーを起動し、ユーザーが参加して確かめる: 共有、対応の画面（以前のホストの行）、牧場のタマゴの自動登録、捕獲数・在庫・状態が参加者の画面に出ること、停止したときの表示、古い系統の守り。
   - **GAS の負荷と容量**（Codex の指摘）: 版 13 の形で、次を重ねて測る（`scripts/owned-bench.mjs` を広げる。遊んでいない時間に）。合わせて、全シートの確保済みのセル数（一時的に足す行を含む）が 1,000 万の上限から十分遠いことを確かめる。
     - 30 秒ごとの共有
     - 参加者の読み直し
     - 対応の書き込み（`playerMapSet` も同じ ScriptLock を使う）
     - 自動登録
4. **ユーザーに報告して承認をもらってから本番に出す**。
   1. `update-deployment <本番の ID> -V 13 -d "server"` → `list-deployments` で ID と版を照らす → `smoke.mjs`
   2. 画面を配信する（main へマージして push → Actions）
   3. 最後にホストした PC で最初に開く（前の対応を GAS へ移すため）→ 全員のタブを読み込み直してもらう
5. サブ PC（ユーザーが行う。手順は文書に書く）:
   1. 最新の協力プレイからインスタンスを作る
   2. 設定を合わせる（`server-settings.mjs`）
   3. 本番の Users に「サーバー」を作る
   4. Node と git を入れる → `install.ps1`
   5. 画面でプレイヤーの対応を設定する
   - **導入の条件**（Codex の指摘）:
     - ServerSync のローカル API が 127.0.0.1 だけで待ち受けていること（`netstat`）。
     - REST のポート（8212）が、トンネル・ルーターの転送・ファイアウォールの許可で外に出ていないこと。
     - 常駐は管理の操作（起動・停止・保存・REST）を持たない。
   - **別の PC への引き継ぎの手順**（Codex の指摘・決定 14）を、次の 2 つに分けて文書に書く。どちらも、前後で全プレイヤーの InstanceId と最後の共有を照らしてから遊ぶ。
     - 「ServerSync の共有で、同じサーバーを別の PC が建てる」: 受け取りの完了・動いているインスタンスを確かめる。
     - 「協力プレイから変換し直す」: 変換する人の Steam で H が誰の UID になるか、`savesync.sav` を確かめる。
6. 巻き戻し: GAS は `-V 12`（`extras` は `at` で守られる。足した列のセルを空にする手順を文書に書く）。常駐はタスクを止める。

## 変更するファイル（代表）

| 種類 | ファイル |
|---|---|
| 解析・core | `web/js/save/palworld.js`・`handles.js`・`web/js/core/owned.js`・`owned-shared.js`（GAS に写る）・`boundary.js`・`ideal-goals.js`・`auto-breeding.js` |
| 画面 | `web/js/owned.js`・`auto-register.js`・`self-player.js`・`player-map.js`（新）・`api.js`・`app.js`・`views/owned-settings.js`・`ui/owned-status.js`・`views/paldex.js`・`views/pal-detail.js`・`ui/farm-board.js`・`release-notes.js` |
| GAS | `gas/PlayerMap.js`（新）・`Owned.js`・`Sheets.js`・`Setup.js`・`Actions.js`・`Service.js`（rename）・`Presence.js`・`Main.js`（認証の後の失敗に env）・`Shared.js`（生成） |
| 常駐・道具 | `tools/server-agent/*`（新）・`scripts/server-settings.mjs`（新）・`package.json`（`agent`・`agent:check`） |
| 開発用 | `dev/mock-api.js`・`scripts/api-check.mjs` |
| テスト | `test/core/*`・`test/web/*`・`test/gas/player-map.test.js`（新）・`test/server-agent/*`（新）・`test/server-settings.test.js`（新） |
| 文書 | `docs/server/README.md`・`TODO.md`（新）・`docs/OPERATIONS.md`・`docs/SAVE_FORMAT.md`・`README.md` |

## 確かめ方

- 自動: 各テーマで `TZ=UTC npm test`（exit code 0）を通す。share-extras の後は `npm run test:perf`、GAS を直したら `npm run build:gas` の差分を見る。
- 実データ（読み取りのみ。node に heredoc）: テストのサーバーと協力プレイの 元のワールド を読み、次を確かめる。
  - 両方のプレイヤーの `i:` の鍵が同じ組になる。
  - サーバーの `formers` に H（変換の直後は拠点 66・牧場 2。P0 の預け直しの後は拠点 62・牧場 0）、協力プレイに U（5）が出る。
  - `sharedUpload` → `validateOwnedUpload` → `ownedFromShared` の往復で、捕獲数・在庫・状態が戻る。
- GAS: テスト用の deployment（版 13）で `api-check` を通す。版 12 と新しい画面、版 13 と古い画面の組み合わせのテストも行う（`test/gas/legacy.js`）。
- 実機（テストのインスタンス・test 環境。ユーザーが参加する）: 常駐が共有し、別のプロファイルの参加者の画面で次を見る。
  - 「サーバー（常駐）· 稼働中」・所持パル・捕獲数・在庫・状態・ケーキが出る。
  - 対応の画面で「以前のホスト」を選ぶと、牧場のタマゴの自動登録の登録者に効く。
  - 停止すると「停止中」になり、警告にならない。
  - 古いバックアップ相当で守りが効き、`--accept-world` で戻る。
  - ServerSync のバックアップ・停止・起動を、常駐が妨げない。
- 往復（後日・ユーザーの変換の後）: 協力プレイに戻しても、自分・対応が同じキャラクターに付いたままになる。

## リスク・未確定事項

- H は人ではなく「その時のホスト」の枠なので、「以前のホスト」を 1 人に対応づけると、仲間の預けた分もその人の分になる。正確にしたい牧場は預け直す（M6 で直るかを確かめる）。
- 状態（SAN・空腹）を共有すると、サーバーが動いている間は 30 秒ごとに GAS に書く（1 回 13〜15 秒の鍵）。これは今の協力プレイのホストと同じ量。無人の間の量は M3 で見る。
- ServerSync のローカル API は認証がない。使ってよい操作を決めて守る（start・stop・backup・状態の読み取り。revert はユーザーの了承の後だけ）。トンネルを使うと REST のポートも外に出るおそれがある。
- サーバーの PC の時刻が日本時間であること（新旧の比較の前提）。キャラクターを作り直すと InstanceId が変わり、対応が外れる（同じ名前の規則に落ちる）。
- 本番のサブ PC の ServerSync は、ユーザー本人の Steam で動かす（変換で H が作成者の UID になるため）。最新の協力プレイをサブ PC に渡す方法は、そのときに決める。
- ゲームの設定の細目は P0 で決める（決定 19）。
- GAS の本文の上限（4 Mi 字）は今と同じ。2 万体ほどのワールドでは共有が断られる（今の協力プレイも同じ）。今回は上限を変えず、送る文字数のテストとログで分かるようにする。
- パスワードは DPAPI でこの Windows ユーザーに結び付けて保存する。別のユーザーや別の PC では復号できない（常駐を入れる PC ごとに `install.ps1` を実行する）。
