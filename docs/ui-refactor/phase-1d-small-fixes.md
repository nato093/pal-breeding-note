# フェーズ 1d: 小さく効く修正（実装ドキュメント）

> 2026-10-12 に、統合プラン（`~/.claude/plans/ui-jaunty-lampson.md`）・別セッションのプラン（[appendix/other-session-plan.md](appendix/other-session-plan.md)）・付録の案の全文（[appendix/catalog.md](appendix/catalog.md) の「フェーズ 1d」）を読み、**HEAD `c5c0683` のコードを開いて確かめて**書いた。file:line はこの時点の行。フェーズ 1a〜1c を入れた後は行がずれるので、**着手の前に必ず開き直す**（関数名・文字列で探す）。
>
> この文書だけで実装に入れるように書いてある。迷ったときの優先順位は「統合プランの決定事項（D1〜D8）・判断事項 → この文書 → catalog.md の案の『直し』 → 案の『提案』」。

## このフェーズの目的

- 毎日使う画面の土台（1a）・理想個体（1b）・所持パル（1c）を安定させた後に、**小さいが効き目の大きい修正**をまとめて入れる。
- 中身は 3 種類。
  1. **構造の欠陥を直す**: 参加者（や、ゲーム内の名前とノートの ID が違う人）が「このワールドでの自分」を選べず、理想個体の完成が判定されない（participant-self）。自動登録できた配合が 3 秒のトーストでしか分からない（autoreg-success）。
  2. **片付け**: 使われなくなった旧方式のコード・CSS・定義のない色・隠しているだけの「◇」（cleanup-dead-code）。
  3. **文言・操作・見た目の統一**: 見出しと用語・「設定タブの〜」の行き止まり（copy-dead-ends）、トーストと削除・元に戻す（delete-undo）、性別の色・状態チップ・押せないボタン・アイコン（visual-parts）。
- 決定事項との関係: D8（毎日使う画面の安定化を先に）の続き。D7（ヘッダー）・D3（ドロワー）・D1/D2/D5（タブ構成の整理）は他のフェーズ。このフェーズではタブの数は 9 のまま。

## テーマの順番（依存の順）

| 順 | テーマ | 工数 | 先に終わっているべきもの | このフェーズの中での理由 |
|---|---|---|---|---|
| 1 | **participant-self** | S | render-contract・stable-render・data-boundary（1a）、ideal-panel（1b）、owned-toolbar（1c） | 設定の `#/settings?world=<id>&open=auto`（該当の欄を開いてフォーカス）を作る。copy-dead-ends がこの行き先を使う |
| 2 | **autoreg-success** | S | inv2-notice・data-boundary（1a） | 通知の正規化に kind・worldId・batchId を通す。フェーズ 2 の bell がこれを土台にする |
| 3 | **cleanup-dead-code** | M | stable-render（1a。idealPlan の入口が変わっている場合に合わせる）、ideal-calc（テーマ 0。idealPlan と generationTable の形） | `empty()` の「◇」を消し、定義のない色を定義する。copy-dead-ends（空の状態のアイコン）と visual-parts（状態チップ）がその後に乗る |
| 4 | **copy-dead-ends** | M | participant-self（設定の行き先）、cleanup-dead-code（`empty()` の整理） | 見出し・用語・案内のボタン化 |
| 5 | **delete-undo** | S | header-frame・stable-render（1a。重なり順の CSS 変数と下端のスナックバー） | トーストの位置・時間・種類と、下書きの一括削除の元に戻す |
| 6 | **visual-parts** | M | cleanup-dead-code（色トークン）、delete-undo（トーストの × を作った後に icons.js へ寄せる） | 見た目の部品の統一。最後に置くと、ほかのテーマで足した部品もまとめて直せる |

- 実装は直列（同じファイルを触るテーマが多い）。1 テーマ＝1 ブランチ `feature/<テーマ key>`（例: `feature/participant-self`）→ 日本語のコミット → `main` に `--no-ff` でマージ。push と配信はユーザーの確認の後。
- このフェーズに GAS の変更はない（`npm run gas:push` は要らない）。

## 全テーマ共通の進め方と受け入れ条件

**1 テーマの手順**（統合プランの「実装の進め方」のとおり）

1. この文書の該当の節と、catalog.md の案（`### <ID>` で探す）を読む。
2. 「現状」の file:line を開いて確かめる（1a〜1c の後で変わっていれば、今の形に合わせて手順を読み替える）。
3. 振る舞いが変わる所は、テストを先に直す・足す（`node --test`。依存なし）。
4. 実装 → `npm test`（release-notes の文字数の確認を含む）。
5. `npm run dev` → `http://localhost:5173/?mock=1&seed=80` で画面を確かめる（ログインは任意の ID と最初に入れたパスワード。`seed` を付けると ID `架空データ` でも入れる。所持パルはフェーズ 0 の注入スクリプト `Claude outputs/ui-audit-2026-10/` の手順で入れる）。ライトとダークの両方。
6. `web/js/release-notes.js` の**先頭**に 1 件足す（不具合の修正でも足す。title 20 字以内・body 60 字以内。`id` は一度出したら変えない。日付は実装した日。新しい順でないと `test/web/notifications.test.js` が落ちる）。
7. 日本語でコミットし、`main` に `--no-ff` でマージ。

**共通の受け入れ条件**（統合プランより。各テーマの「注意」の節で、特に効くものを繰り返す）

- **INV-2**: 配合の候補は登録済みの記録だけから引く。配合表（`web/data/breeding.js`）と遺伝の仕組み（`web/js/core/ideal.js`）を読み込める場所は、今の `test/import.test.js:27-44` の制限のまま（配合表は `auto-register.js` だけ、`core/ideal.js` は `views/ideal.js` だけ）。新しく作るモジュールはこの 2 つを import しない。
- **セキュリティ**: `innerHTML`・`outerHTML`・`insertAdjacentHTML` と style 属性の文字列は使わない（`test/static/security.test.js:15-22`）。SVG は `createElementNS`、名前や説明は `textContent`、動的な配置は `style.setProperty`。CSP は緩めない。
- **保存データ**: 新しく保存する値は data-boundary（1a）の検証を通す。古い IndexedDB・古い共有データ・古い通知・古い sessionStorage・**旧コードのまま開いているタブ**が混ざっても壊れない。
- **性能**: 所持パル 2,000 行で最初の 200 行が 100ms 以内・全行 1 秒以内、所持パルの画面の DOM は 80,000 ノード以下、JS ヒープの増加 150MB 以下（Chrome で測る）。このフェーズで描き直しの回数を増やすときは、stable-render の差分更新と署名（「データ・index・実効の条件・本人」）の上に乗せる。
- **既存の決まりを壊さない**: 確認回数の表示や相手親の除外は戻さない（437536b・98b7962）。所持パルは「最初から全件・もっと見るなし」。パル選択の Enter は矢印で選んだときだけ（df0ab4e）。

**フェーズの終わり**: 観点別のエージェントと Codex（読み取り専用。使う前に目的を説明して許可を取る。この環境では Codex のシェルの起動が失敗したことがあるので、先に小さく動くか確かめる）で差分をレビューし、直してから報告する（変更したファイル・実行したコマンド・画面の確かめ方）。`npm run test:perf` も流す。

---

## participant-self: 参加者の「このワールドでの自分」

### 目的

参加者や、ゲーム内の名前とノートの ID が違う人でも、設定で「このワールドでの自分」を 1 人選べるようにする。選んだら、理想個体の完成の判定と通知、理想個体と所持パルの「自分の個体」の絞り込みが、その人の個体で働く。

### 経緯

- 別プランの **F054**（★。バッチ 1 の「小さく効く修正」）から来た。本セッションの案にはない（catalog.md の participant-self は「案 0 件」）。統合プランの「全体の所見 6. 構造の欠陥」。
- 本セッションで 4 体のエージェントがコードと照合（`wf_615b2142-92f` の identity の 4 件。すべて「正しい」）。
  1. players を持てるのはホストのときだけ（`views/owned-settings.js:302`）。参加者には自動登録の欄自体が出ない（`:223-225`）。理想個体の案内の「登録者の対応」という見出しは設定にない（`views/ideal.js:143・374`。実際の見出しは `owned-settings.js:222` の「配合牧場からの自動登録」と `:243` の「登録者（親を拠点に預けた人 → このノートの ID）」）。
  2. 既存の対応表（`autoRegister.setMapping`、`auto-register.js:343-351`）は「uid → ノートの ID」の多対一で、対応表にない**同じ名前のプレイヤーも自分に含まれる**（`core/ideal-goals.js:102-113`）。
  3. 完成の判定は、セーブの時刻が同じなら判定し直さない（`ideals.js:72` の stale。使うのは `:98・100・102`）。
  4. 参加者向けの players は共有済み（`core/owned.js` の sharedUpload と ownedFromShared、GAS の `OWNED_UPLOAD_FIELDS_`）なので、GAS の変更は要らない。
- **Codex の指摘で決まったこと**（別プラン §6 の P1-2・P1-3 と §9 の「自分」の保存キー、統合プランの 6 回目のレビューの指摘 6）
  - 単一の「自分」を既存の対応表（setMapping）に流用しない。A→B と変えたときに A の対応が残り、両方で完成と判定されるため。**自分の uid を単独で保存する**。
  - 保存キーは `${namespace}.ideals.self.<env>.<userIdKey>.<worldId>`（ユーザーごと）。採用するのは、ログイン中で、選んだ uid がそのワールドの players にあるときだけ。名前の変更（user-rename.js）でキーを移す。
  - `identityChanged` は「最新の保存内容を読み、そのワールドを判定し直す（完成は記録するが、通知しない）」。
  - 本人を変えたら、完成の判定だけでなく、理想個体の「自分の個体」の候補・パッシブの所持数・結果・牧場の基準と、所持パルの「自分の個体」の絞り込みも描き直す（今は理想個体の購読 `views/ideal.js:506` が登録の表示だけを更新し、所持パル `views/owned.js:229` は同じデータなら描き直さない）。別タブの変更（storage イベント）も同じ経路にする。
  - 同じセーブ時刻での変更と storage イベントをテストする。
- 統合プランの「検証」のシナリオ: 参加者としてログインし「このワールドでの自分」を選ぶと、登録済みの目標が「完成済み」になる（**選んだ時点で完成しているものは通知しない**）。その後の共有の更新で新しく完成した目標はベルに出る。

### 依存

- **render-contract**（1a）: 設定の画面が `applyRoute(route)` で URL の `world`・`open` を受け取れること。同じ画面の中の URL の変更で画面を作り直さないこと。
- **stable-render**（1a）: 理想個体の再計算の署名に「本人（自分の uid の集合）」が入っていること。ここで本人の変化を署名に流す。
- **data-boundary**（1a）: localStorage の値の検証の共通関数（uid の形の確認に使う）。
- **ideal-panel**（1b）: 目標の一覧が見出し右の「目標（N）」ボタン→ダイアログの表になっている（案内のボタンはその表の行に置く）。
- **owned-toolbar**（1c）: 所持パルの所持者に「自分の個体」があり、理想個体と同じ palsOfPlayers の意味で「許可する個体 id の Set」を作っていること。

### このテーマでやらないこと

- 自動登録の「登録者の対応」（`setMapping`）の仕組み・保存キーは変えない（自動登録の登録者は今のまま）。
- 「自分」を仲間に共有しない（この端末だけ。GAS は変えない）。
- 参加者向けの「参加しているワールドなので、自動登録は動きません。」（`owned-settings.js:224`）の言い換えは **roles**（フェーズ 2）。
- 「設定タブの〜」の案内全般の 1 文＋ボタン化（`setupHint`）は **copy-dead-ends**。ここでは理想個体の 2 か所と自動登録の通知の行き先だけを直す。
- 共有データでは預けた人の uid が空になる（`core/owned.js:514` の `lastOwnerUid: ''`）ため、拠点のパルは名前で照合し、同じ名前が複数いると数えない（`core/ideal-goals.js:122-129`）。この精度の問題は変えない。

### 現状

- 自分のプレイヤーの決め方: `app.js:75-78` で `identity: (worldId) => ({ userId, users, mapping: autoRegister.mapping(worldId) })` を渡す。`core/ideal-goals.js:102-113` の `ownPlayerUids` は、プレイヤーごとに対応表の値を優先し、なければ `player.name` がユーザー一覧にあれば、その人を自分とみなす。`ownPals`（`:134-137`）は自分の uid が 0 件なら `null`。
- 完成の判定: `ideals.js:93-103` の `observe` が `store`・`owned` の変化で動き、stale（`:72`。判定に使ったセーブ時刻 `observedAt` より新しいデータのときだけ）な目標だけを `judged`（`:75-82`）で作り直す。自分が分からない（`current()` が null、`:63-70`）と判定しない。そのワールドで初めての判定（`before.checked` が false）は完成していても `completedAt` を付けない＝通知しない。
- 設定: `views/owned-settings.js:389-395` の状態欄（`dl.owned-settings-status`）は「この PC」「表示中」「更新」だけ。描くたびに `status.replaceChildren()` で作り直す。登録者の select は、ホストで、読み込んでいるワールドの行を開いたときだけ（`:302・309`）。
- 設定は URL を読まない: `views/settings.js:67` は `settingsView(context)`。ワールドの行は `openWorlds`（`owned-settings.js:297`）が空で始まるので、通知から来ても閉じたまま（`:343`）。
- 理想個体の案内: `views/ideal.js:143`「未確認（セーブのどのプレイヤーが自分か分かりません。設定タブの「登録者の対応」で選んでください）」、`:373-374`「…設定タブの「登録者の対応」で選ぶか、所持者を「すべて」にしてください。」。どちらもリンクなし。
- 自動登録の通知「プレイヤーの対応が未設定です」の行き先は `'#/settings'`（`auto-register.js:228`）。
- 描き直し: 理想個体は `ideals.subscribe` で `renderRegister`・`renderGoals` だけ（`views/ideal.js:506`）、所持パルは `state.owned` が変わったときだけ（`views/owned.js:229`）。
- 名前の変更: `user-rename.js:31-74` の `moveUserStorage` は `ideals.<env>.<userIdKey>` などの配列と、自動登録の対応表を移す。

### 実装の手順

1. **新しいモジュール `web/js/self-player.js`**（「このワールドでの自分」の保存。DOM に触れない）

   ```js
   // このワールドでの自分（セーブのプレイヤーの uid）を、ID・環境・ワールドごとにこの端末に 1 つだけ残す。
   export const SELF_PREFIX = (namespace) => `${namespace}.ideals.self.`;
   export function selfKey(namespace, env, userId, worldId) // 'pal-note.ideals.self.prod.<userIdKey>.<WORLDID>'。どれか欠ければ ''
   export function createSelfStore({ store, storage, namespace = 'pal-note' }) {
     return {
       key(worldId),                // 今のログイン（store.state の env・userId・passcode）での保存キー。ログイン前は ''
       get(worldId),                // 保存した uid（形が合わなければ ''）
       set(worldId, uid),           // '' なら消す。保存できたら true。できなければメモリにだけ残して saveFailed を立て、false
       get saveFailed(),
       reload(storageKey),          // storage イベントのキーが SELF_PREFIX で始まればキャッシュを捨てて通知する
       subscribe(listener),         // 戻り値は購読の解除
     };
   }
   ```

   - worldId は `ownedWorldId`（`core/owned-shared.js:39-42`。32 桁の 16 進を大文字に）で正規化してからキーにする。userId は `userIdKey`（core/user.js）。
   - 値は uid の文字列をそのまま保存する（JSON にしない）。読むときは `/^[0-9A-Fa-f-]{1,64}$/` に合うものだけ受け付け、合わなければ ''（data-boundary の共通の検証があればそれを使う。追記 2026-10-12: core/boundary.js に形を見ない `idText(value, max)`（1〜max 字の文字列をそのまま）がある。16 進の形はこの正規表現で確かめる）。読み書きは try/catch で囲む（保存できない端末でもページを開いている間は効くよう、Map にも持つ）。
   - `set` と `reload` のあと、購読者を呼ぶ。

2. **`core/ideal-goals.js` の `ownPlayerUids` に `selfUid` を足す**（`:102-113`）

   ```js
   export function ownPlayerUids(players, { userId, users = [], mapping = {}, selfUid = '' }) {
     const me = userIdKey(userId);
     const mine = new Set();
     if (!me) return mine;                                    // ログイン中だけ
     if (selfUid && players.some((player) => player.uid === selfUid)) return new Set([selfUid]); // 「自分」があればそれだけ
     // …以下は今の対応表＋同じ名前の規則のまま
   }
   ```

   - JSDoc とファイル冒頭のコメント（`:95-101`「設定の『登録者の対応』で…」）を「このワールドでの自分 → 登録者の対応 → 同じ名前」の順に書き直す。
   - players にない uid（別のワールドの値・プレイヤーが消えた）は無視して、今の規則に戻る。

3. **`app.js` でつなぐ**

   - `createIdealStore` の前に `const self = createSelfStore({ store, storage: browserStorage, namespace });`。
   - `identity` に `selfUid: self.get(worldId)` を足す（`app.js:77`）。
   - `context` に `self` を足す（`app.js:159-206`）。
   - `self.subscribe(() => ideals.identityChanged());`
   - storage イベント（`app.js:324-329`）に `self.reload(event.key);` を足す（別タブの変更も同じ経路）。
   - `createRenamer` に `self` を渡す（手順 8）。

4. **`ideals.js` に本人の変化の経路を足す**

   - `judged(goal, view, byPal, notify)` の第 4 引数を `mode`（`'notify' | 'quiet' | 'identity'`）にする。今の `notify: true` が `'notify'`、`false` が `'quiet'`（`add` で使う）。
   - `'identity'` の決まり: 完成していて、前の記録も判定済み（`checked`）で完成していたなら、前の `completedAt` を残す。それ以外（新しく完成した・未完成）は `completedAt: ''`。＝「すでに完成しているものは通知せず『完成済み』表示」（一覧の「完成済み」は `goalMatches` で毎回見るので、`completedAt` がなくても出る。`views/ideal.js:141-149`）。新しく完成した目標の通知は、次に新しいセーブを読んだときの `'notify'` でも出ない（前の記録が complete になっているため）＝選んだ時点の完成は知らせない、が守られる。
   - 公開する関数を 2 つ足す。

     ```js
     /** 本人（自分のプレイヤー）が変わったら呼ぶ。同じセーブ時刻でも、表示しているワールドを判定し直す（通知はしない）。 */
     identityChanged() {
       const key = scope();
       if (!key || store.state.renaming) return false;   // 名前の変更中は、終わった後の store の通知で判定し直される
       const view = current();
       if (!view) { emit(); return false; }               // 自分が分からなくなった: 記録は消さず、画面だけ描き直させる
       const goals = latest(key);
       if (!goals.length) { emit(); return false; }
       const byPal = bySpecies(view.pals);
       save(key, goals.map((goal) => judged(goal, view, byPal, 'identity')));   // save が emit する
       return true;
     },
     /** 本人の署名（表示しているワールド ID と自分の uid の集合）。画面の再計算の署名に入れる。 */
     identityKey() // `${worldId}|${[...ownPlayerUids(players, identity(worldId))].sort().join(',')}`。データがなければ ''
     ```

   - `identityKey` のために `ownPlayerUids` を import する（`core/ideal-goals.js` は遺伝の仕組みを使わないので INV-2 の制限に触れない）。

5. **設定に「このワールドでの自分」を置く**（`views/owned-settings.js`）

   - 状態欄（`dl`）は描くたびに作り直すので、その中には入れない。`status` の直後に**作り直さない行**を置く: `selfRow = el('label', 'owned-import-row owned-self-row')`、中身は `el('span', 'field-label', 'このワールドでの自分')`・`selfSelect = el('select', 'owned-self')`（`aria-label`「このワールドでの自分」）・`selfNote = el('small', 'muted')`。`card.append(…)`（`:293`）の `status` の後に `selfRow` を入れる。
   - `renderSelf(state)` を足し、`render`（`:376-401`）・store の購読（`:405`）・`context.self.subscribe`（別タブ）から呼ぶ。`destroy` で購読を外す。
     - 出す条件: `context.self` があり、ログイン中（store の `passcode`・`userId`・`env`）で、`ownedWorldId(state.meta?.worldId)` があり、`state.owned?.players` が 1 人以上。満たさなければ `selfRow.hidden = true`。**ホストでも参加者でも出す**（players は表示中のデータのもの。参加者は共有から来る）。
     - 選択肢: 先頭は `''`。自動で決まる人（`ownPlayerUids(players, { userId, users, mapping: autoRegister.mapping(worldId) })`。selfUid なし）がいれば「自動（〈名前〉）」、いなければ「未設定（自分の個体を判定しません）」。続けて players を 1 人ずつ（表示は `player.name || 'プレイヤー ' + uid.slice(0, 8)`。同じ名前が 2 人以上いれば `（uid の先頭 8 文字）` を添える）。`option` の文字は `textContent`（`el('option', '', label)`）。
     - 値: 保存した uid が players にあればそれ、なければ `''`。
     - 署名 `JSON.stringify([worldId, players.map((p) => [p.uid, p.name]), saved, autoNames, users])` が前回と同じなら描き直さない（選んでいる途中・フォーカス中に作り直さない）。
     - `change` で `context.self.set(worldId, selfSelect.value)`。false（保存できない）なら `toast('この端末に保存できませんでした（ページを閉じると消えます）')`。
     - `selfNote` は「理想個体の完成の判定と、自分の個体の絞り込みに使います（この端末だけ）」。
   - 推奨（小さく済むので一緒に）: 登録者の select の change（`:251`）でも、`setMapping` の後に `context.ideals?.identityChanged()` を呼ぶ（対応表を変えたときも本人が変わるため。今は次のセーブまで判定し直さない）。

6. **設定が `#/settings?world=<id>&open=auto` を受け付ける**

   - `router.js` に `export function settingsHash(worldId = '') { return buildHash('settings', { world: worldId, open: 'auto' }); }` を足す（理想個体・自動登録・copy-dead-ends の `setupHint` が使う）。
   - `views/settings.js`: `settingsView(context, route)` にし、render-contract の形で `applyRoute(route)` を返す（作るときにも 1 回呼ぶ）。`applyRoute` は `open === 'auto'` のときだけ `ownedCard.reveal({ worldId: ownedWorldId(route.params.get('world')) })` を呼び、その後 `context.replace(buildHash('settings'))` で `world`・`open` を URL から外す（戻る・進むでもう一度開かないように。理想個体の `g` の扱い `views/ideal.js:186-195` と同じ考え方）。
   - `ownedSettingsCard` が `reveal({ worldId })` を返す。中身:
     1. 所持パルの状態がまだ読み込み前（`owned.state.ready` が false）なら、`pendingReveal` に覚えて、次の `render` で行う。
     2. `worldId` が登録したワールド（`state.auto.worlds`）にあれば `openWorlds.add(worldId)`、`renderedWorlds = ''` にして `renderRegistered(owned.state)` を呼び、行を開いた状態で描く。
     3. フォーカスの先（上から順に最初に当てはまるもの）: ① `selfRow` が出ていて、表示中のワールドが `worldId` と同じで、「自分」が未保存 → `selfSelect`。② 開いたワールドの行の「登録者」の select のうち値が `''`（未設定）の最初のもの。③ その行の自動登録のチェック。④ `selfSelect`（出ていれば）。⑤ カードの見出し（`tabIndex = -1` を付けてから）。
     4. 先に `target.scrollIntoView({ block: 'center' })`、それから `target.focus({ preventScroll: true })`（ヘッダーの高さは header-frame の CSS 変数で `scroll-margin-top` を付けておく。追記（header-frame の実装、2026-10-12）: header-frame で `html { scroll-padding-top: calc(var(--header-h) + 8px) }` を入れたので、ページ全体のスクロールでは要らない）。光らせる動きは付けない。
   - ID の大文字・小文字の揺れ（`owned.js` で `toUpperCase` している）があるので、比べるときは両方 `ownedWorldId` を通す。

7. **理想個体の案内をボタンにする**（`views/ideal.js`）

   - `goalStatus`（`:141-149`）: `pals === null` のとき `{ done: false, text: '未確認（このワールドでの自分が未設定）', action: { label: '設定で選ぶ', href: settingsHash(worldId) } }` を返す。worldId は `ownedWorldId(owned.state.meta?.worldId)`。目標の一覧（ideal-panel で作ったダイアログの表）の行は、`action` があれば状態の横に `link(action.label, action.href, 'button secondary small')` を出し、押したらダイアログを閉じる（リンクの click で `modal.close()`。ベルの通知 `ui/notifications.js:23` と同じやり方）。
   - `noPairs`（`:371-383`）: 所持者が「自分の個体」で自分が分からないときは `empty('このワールドでの自分が未設定のため、自分の個体で絞れません（所持者を「すべて」にすると全員の個体で探せます）。', link('設定で選ぶ', settingsHash(worldId), 'button secondary'))`。
   - 本人の変化で描き直す: `const unsubscribeSelf = context.self?.subscribe(() => update()) ?? (() => {});` を足し、`destroy` で外す。`update`（`:496-501`、render-contract 後は `update(state)`）が所持者の選択肢・パッシブの所持数・結果・牧場を描く。stable-render の署名に `context.ideals?.identityKey()` を入れ、本人が変わったときだけ再計算する（同じなら計算しない）。

8. **所持パルの「自分の個体」を描き直す**（`views/owned.js`。owned-toolbar の後の形に合わせる）

   - owned-toolbar で作った「自分の個体」の許可 id の Set（`palsOfPlayers(data, ownPlayerUids(...))` または `context.ideals.mine()`）を、`context.self` の購読で作り直し、所持者が「自分の個体」のときだけ結果（件数・行・パッシブの所持数）を描き直す。描き直しは stable-render の差分更新の経路で行い、フォーカスと位置を保つ。

9. **自動登録の通知の行き先**（`auto-register.js`）

   - `unmappedNotice`（`:224-229`）の `href` を `settingsHash(ctx.worldId)` にする（`router.js` から import。`auto-register.js` は配合表を読むが、`router.js` は読まないので INV-2 の制限は変わらない）。
   - 保存済みの古い通知（`href: '#/settings'`）も、`readNotices`（`:192-195`）で id が `auto-breed:<env>:unmapped:<worldId>:<uid>` の形なら `settingsHash(<worldId>)` に読み替える（id は変えない＝既読はそのまま）。

10. **名前の変更でキーを移す**（`user-rename.js`）

    - `moveUserStorage`（`:31-74`）の対応表のループ（`:64-72`）の後に、`${namespace}.ideals.self.${env}.${oldKey}.` で始まるキーを `${namespace}.ideals.self.${env}.${newKey}.` に移すループを足す（値は文字列のまま。移し先に書けたら元を消す。書けなければ `ok = false`）。移し先に値があっても、移す元（改名した本人の設定）を優先して上書きする（今の配列の連結で「元を先にする」のと同じ考え方）。大小・全半角だけの変更でキーが同じなら何もしない。
    - `moveLocal`（`:94-102`）の最後で `` self?.reload(`${namespace}.ideals.self.`) ``（どのキーでも通知する）。`createRenamer` の引数に `self` を足す。

### 触るファイル

- 新規: `web/js/self-player.js`、`test/web/self-player.test.js`
- 変更: `web/js/core/ideal-goals.js`、`web/js/ideals.js`、`web/js/app.js`、`web/js/router.js`、`web/js/views/settings.js`、`web/js/views/owned-settings.js`、`web/js/views/ideal.js`、`web/js/views/owned.js`、`web/js/auto-register.js`、`web/js/user-rename.js`、`web/css/app.css`（`.owned-self-row` の並び。`.owned-import-row` と同じ並びでよい）、`web/js/release-notes.js`
- テスト: `test/core/ideal-goals.test.js`、`test/web/ideals.test.js`、`test/web/user-rename.test.js`、`test/web/owned-view.test.js`（設定のカードのテストもここにある）、`test/web/ideal-view.test.js`、`test/web/auto-register.test.js`、`test/web/app.test.js`

### テスト

- 追加
  - `test/core/ideal-goals.test.js`: `selfUid` が players にあればそれだけを返す／players にない `selfUid` は無視して今の規則／ログアウト中（userId が空）は空の Set（今の `:85` の「登録者の対応を優先」のテストは残す）。
  - `test/web/self-player.test.js`（新規）: キーの形（env・userIdKey・ワールド ID の大文字化）、`get`・`set`・`set('')` で消える、形の合わない値は ''、保存に失敗したらメモリに残して `saveFailed`、`reload` は SELF_PREFIX のキーだけで通知する。
  - `test/web/ideals.test.js`: ①**同じセーブ時刻**で `identityChanged` を呼ぶと、完成していた目標が `complete: true` になり `completedAt` は ''（通知が出ない。`idealNotificationSource` が空）。②前から `completedAt` がある目標は、本人を変えても完成のままなら `completedAt` を保つ。③`identityChanged` の後、新しいセーブ時刻で新たに完成した目標は通知される。④自分が分からなくなったら記録は書き換えず、購読者だけ呼ぶ。⑤名前の変更中は書き換えない。
  - `test/web/user-rename.test.js`: self のキーが新しい名前へ移り、元が消える。大小だけの変更では同じキーのまま。
  - `test/web/owned-view.test.js`（設定のカード）: 参加者（共有データの players）でも「このワールドでの自分」が出る／自動の候補の名前が先頭の選択肢に出る／同じ名前の 2 人に uid の短縮が付く／選ぶと保存される／ログアウト中は出ない／`settingsView(context, parseHash('#/settings?world=<ID>&open=auto'))` で該当の行が開き、未設定の select にフォーカスが移り、URL から `world`・`open` が外れる（`context.replace` の呼び出しで確かめる）。
  - `test/web/ideal-view.test.js`: 同じ所持パルのデータのまま `context.self.set` すると、「自分の個体」の結果に組が出る（再計算される）。
  - `test/web/auto-register.test.js`: 保存済みの古い unmapped の通知（`href: '#/settings'`）が `settingsHash(<worldId>)` に読み替わる。
  - `test/web/app.test.js`: self のキーの storage イベントで、理想個体の一覧の状態が描き直される（別タブの変更）。
- 期待値が変わる既存のテスト
  - `test/web/auto-register.test.js:235`（`[['プレイヤーの対応が未設定です', '#/settings']]` → 行き先が `#/settings?world=<テストのワールド ID>&open=auto`）。
  - `test/web/ideal-view.test.js:493-505`（`/セーブのどのプレイヤーが自分か分かりません/` → 新しい文と「設定で選ぶ」のリンク）。
  - `test/core/ideal-goals.test.js:79・90`・`test/web/ideal-view.test.js:95` は変更不要（別プラン §9 の C のとおり。identity の形に `selfUid` が増えても、省略できる）。
  - `test/web/ideals.test.js:50・167`（§9 の C に挙がっている行。identity の形の確認があれば `selfUid` を足す）。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: `self-player.js` は配合表も `core/ideal.js` も読まない。`ideals.js` が import するのは `core/ideal-goals.js` だけのまま。
- **互換**: 保存キーは新しく足すだけで、目標の保存の形（`ideals.<env>.<user>` の配列）は変えない。**旧コードのタブ**は self のキーを知らないので、今の規則（対応表＋同じ名前）のまま判定を続ける。新しいセーブを読んだときに旧タブが古い本人で判定を書く可能性はあるが、新しいタブは次の `identityChanged`・`observe` で正しい本人に戻す（通知が 1 件余分に出る程度で、データは壊れない）。古い通知の `href` は読み出し時に読み替える（id は変えない）。
- **セキュリティ**: 選択肢の名前（セーブのプレイヤー名）は `textContent` で出す。保存する uid は形を確かめ、players にあるものだけ採用する。
- **性能**: `identityChanged` は本人を変えたときだけ。理想個体の再計算は stable-render の署名が変わったときだけ（20 秒ごとの確認で無条件に再計算しない）。

### release-notes の案

```js
{
  id: '<実装日>-participant-self', date: '<実装日>', title: '参加者も自分を選べる',
  body: '設定のセーブ連携で「このワールドでの自分」を選べます。理想個体の完成の判定と自分の個体に使います。',
},
```

title 10 字・body 49 字（node で `length` を数えて確かめた）。

### 完了の条件

- [ ] `npm test` がすべて通る（追加したテストを含む）。
- [ ] モックで、ID をセーブのプレイヤー名と違うものにしてログインし、目標を 1 件登録 → 一覧が「未確認（このワールドでの自分が未設定）」と「設定で選ぶ」になる → 押すと設定のセーブ連携が開き「このワールドでの自分」にフォーカスがある → 選ぶと、所持パルのデータが同じままでも目標が「完成済み」になり、**ベルに通知は出ない**。
- [ ] その後、完成していない目標の条件を満たす個体を所持パルに入れて（新しいセーブ時刻で）読み直すと、ベルに完成の通知が出る。
- [ ] 理想個体と所持パルで所持者「自分の個体」を選んだまま「自分」を変えると、理想個体の候補・パッシブの所持数・結果・牧場の判定（置いてある組の基準）と、所持パルの「自分の個体」の件数・行が描き直される（フォーカスと位置は保たれる。統合プランの participant-self の「反映範囲」と Codex 6 回目の指摘 6）。同じセーブ時刻のままの変更でも描き直る。
- [ ] 2 つのタブを開き、片方で「自分」を変えると、もう片方の理想個体の一覧も変わる。
- [ ] 自動登録の通知「プレイヤーの対応が未設定です」を押すと、そのワールドの行が開いて未設定の登録者の select にフォーカスがある。
- [ ] 名前を変えた後も「自分」の選択が残っている。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — `self-player.js` は配合表・`core/ideal.js` を読まない（`test/import.test.js`）。互換 — 目標の保存の形を変えていない。旧コードのタブを開いたままでもデータは壊れない（古い本人で判定を書かれても、次の `identityChanged`・`observe` で戻る）。古い unmapped の通知の href が読み替わる。セキュリティ — プレイヤー名は textContent、uid は形と players を確かめてから採用する（`test/static/security.test.js`）。性能 — 20 秒ごとの確認では再計算しない（`identityKey` を含む署名が同じ）。

### TODO

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

---

## autoreg-success: 自動登録の成功を通知に残す

### 目的

配合牧場から自動登録できた配合を、3 秒で消えるトーストだけでなくベルの通知に残す。席を外していた間に何が登録されたかを、ベルから 1 クリックでたどれるようにする。

### 経緯

- 本セッションの **D-01**（そのまま採用。判断: 登録済みの組は DUPLICATE として通知なしで終わるので、通知が出るのは新しい組だけで、増えすぎる心配は小さい）と、別プランの **F023**（★）。
- **Codex の指摘で決まったこと**（別プラン §6 の P2-10、§9 の「P2 通知・状態クラスタ」）
  - `saveNotices`（`auto-register.js:197-208`）は**同じ id の通知を追加も更新もしない**（`:201-202`。照合で確認）。D-01 の「1 回の読み込みで 1 件・id は importedAt」にすると、対応を設定した後の追加の登録が同じ id で捨てられる。→ **id はレコードごと**（`auto-breed:<env>:registered:<recordId>`）にし、まとめは**表示（ベルのパネル）だけ**で行う。既読は元の id ごと。
  - 通知の正規化（`cleanNotification`、`notifications.js:24-32`）に **kind・worldId・batchId** を通す（フェーズ 2 の bell と共通）。
  - 成功の通知は、**登録が確定するごとに、run を始めたときの保存先（env・ID）へ**残す（途中でログインや設定が変わって run が止まっても、確定した分は失わない）。
  - **成功は 20 件まで**。上限で未対応（unmapped）・異常（anomaly・conflict）の通知を追い出さない。
- **本プランの方を残したもの**（統合プランの「2 つの調査の突き合わせ」）: 別プランの通知の文「予想は X、タマゴは Y」（F027）は配合表の答えを画面に出すので INV-2 の例外 (a)（照合にだけ使う）に反する。成功の通知も**本文は登録したレコードだけ**にし、配合表の答えは出さない（inv2-notice と同じ方針）。
- D-01 の行き先 `#/list?sort=updated` は採らない。フェーズ 2 の find-merge で一覧は「配合を探す」に統合され、`#/search?p1=&p2=` はそのまま生きるので、該当の組の `buildHash('search', { p1, p2 })` にする（F023 と同じ）。
- 本文の親の記号は、copy-dead-ends の用語表（親の組は「＋」）に合わせて「A♂＋B♀ → C（拠点 1）」にする（統合プランの文面は「A♂×B♀ → C」だが、同じフェーズで「×」を「＋」にそろえるので、先に合わせておく）。

### 依存

- **inv2-notice**（1a）: 自動登録の通知の本文から配合表の答えを外し、保存済みの通知を読み出し時に安全な文へ変える経路（`readNotices`）ができていること。
- **data-boundary**（1a）: 通知の読み戻しの検証（型・文字数・配列の数）。足す項目（kind・worldId・batchId）もそこで検証する。
  - 追記（data-boundary の実装、2026-10-12）: 保存した自動登録の通知は auto-register.js の `cleanSavedNotice` が **id・date・title・body・href だけを写す**（知らない項目は捨てる）。通知欄の `cleanNotification`（notifications.js）も同じ。kind・worldId・batchId を足すときは、この 2 か所に足す（足さないと読み出しで落ちる）。href の確かめは core/boundary.js の `screenHref`。

### このテーマでやらないこと

- 配合のレコードの memo に「配合牧場（拠点 1）から自動登録」の印を入れる案（F023 の「まずは memo」）はやらない（カードに memo 行が出る副作用があり、登録の内容を変えるため。統合プランにも入っていない）。
- トーストに「見る」ボタン（D-02）・裏のタブの題名の数（X-18）などは **autoreg-visibility**（フェーズ 2）。
- 種類のチップ・個別の既読・「すべての通知を見る →」・赤い数字の数え方の見直しは **bell**（フェーズ 2）。ここではまとめ表示と、それに合わせた未読の数だけ。

### 現状

- 自動登録できたときは `auto-register.js:294` の件数のトースト「配合を自動登録しました（n件）」だけ。トーストの既定は 3,000ms（`ui/toast.js:19`）。何を登録したかは出ず、ベルにも残らない。成功の経路（`:264-267`）は `registered++` だけ。
- ベルに残るのは、異常（`anomalyNotice` `:211-215`、`:237` で保存）・食い違い（`conflictNotice` `:216-222`）・対応が未設定（`unmappedNotice` `:224-229`）だけ。食い違い・未設定は run の最後に、始めたときと同じ状態のときだけ保存（`:293`）。
- 保存: `saveNotices`（`:197-208`）は保存先の一覧に、まだない id の通知だけを足し、日時の新しい順に `NOTICE_MAX`（50 件、`:16`）まで残す。並び（id）が同じなら保存も `onNotice` もしない（`:204-205`）。保存先は `autoBreeding.notices.<env>.<userIdKey>`（`:48`）。
- 正規化: `cleanNotification`（`notifications.js:24-32`）は id・date・time・title・body・href だけを残す（ほかの項目は捨てる）。
- ベル: `ui/notifications.js:55-114` の `notificationMenu`。未読の数は `notifications.unread().length`（`:70`）。開くと、開いた時点の未読を `notificationList`（`:10-29`）で 1 件 1 行に並べ、既読にする（`:108`）。設定の「通知一覧」（`openNotificationList` `:35-52`）も 1 件 1 行。
- セーブはタブが裏にあっても 60 秒ごとに読み直す（`app.js:340`）ので、トーストはほとんど見られずに消える。

### 実装の手順

1. **通知の正規化に kind・worldId・batchId を通す**（`web/js/notifications.js`）

   ```js
   // 通知の種類（ベルのまとめ表示・種類のチップに使う）。フェーズ 2 の bell で種類を足す
   export const NOTIFICATION_KINDS = Object.freeze(['auto-registered']);
   const BATCH = /^[0-9A-Za-z:._+-]{1,64}$/;
   // cleanNotification の最後に足す（不正な値は付けない。今の通知の形は変わらない）
   if (NOTIFICATION_KINDS.includes(value.kind)) notification.kind = value.kind;
   const worldId = ownedWorldId(value.worldId);           // core/owned-shared.js
   if (worldId) notification.worldId = worldId;
   if (typeof value.batchId === 'string' && BATCH.test(value.batchId)) notification.batchId = value.batchId;
   ```

   - release-notes の通知は kind を持たないので、`test/web/notifications.test.js:41` の `assert.deepEqual(cleanNotification({ ...note }), { ...note, time, body })` はそのまま通る（kind を既定で付けないこと）。

2. **まとめ表示の関数を足す**（`web/js/notifications.js`。DOM に触れない純粋な関数にしてテストする）

   ```js
   /**
    * 通知欄に出す行にまとめる。自動登録の成功（kind: 'auto-registered'）は、同じワールド・同じ読み込み（batchId）の分を 1 行にする。
    * @returns {{ ids: string[], count: number, id, date, time, title, body, href?, kind? }[]} 並びは list の順（いちばん上の通知の位置に置く）
    */
   export function groupNotifications(list)
   ```

   - まとめた行の `body` は、まとめた中で最初の通知の本文に「 ほか N 件」を足し、`clip(…, BODY_MAX)` し直す（1 件なら元の本文のまま）。`href` も最初の通知のもの。`ids` はまとめた全部の id。
   - kind のない通知・batchId のない通知は 1 件 1 行（`ids: [id]`）。

3. **ベルと通知一覧をまとめ表示にする**（`web/js/ui/notifications.js`）

   - `notificationList(items, unread, onOpen)`（`:10-29`）は、まとめた行を受け取る。未読の印は `item.ids.some((id) => unread.has(id))`。
   - `openNotificationList`（`:35-52`）は `groupNotifications(notifications.list())` を描く。`listKey` は行の `ids` をつないだもの。
   - `notificationMenu` の `update`（`:69-75`）: 未読の数は `groupNotifications(notifications.unread()).length`（まとめた行の数。`aria-label` も同じ数）。
   - `open`（`:77-109`）: 開いた時点の未読の id（`opened`）は元の id のまま持ち、`renderPanel` で `groupNotifications(notifications.list().filter((item) => opened.has(item.id)))` を描く。既読にするのは元の id 全部（`notifications.markRead([...opened])` は今のまま）。

4. **成功の通知を作って残す**（`web/js/auto-register.js`）

   ```js
   const SUCCESS = 'auto-registered';
   const SUCCESS_MAX = 20;
   const REGISTERED = /^auto-breed:[^:]*:registered:/;
   const genderMark = (gender) => (gender === 'M' ? '♂' : gender === 'F' ? '♀' : '');
   const registeredNotice = (ctx, record, farmLabel) => ({
     id: `auto-breed:${ctx.env}:registered:${record.id}`, date: ctx.importedAt,
     kind: SUCCESS, worldId: ctx.worldId, batchId: ctx.importedAt,
     title: '配合を自動登録しました',
     body: `${palName(record.parent1Id)}${genderMark(record.parent1Gender)}＋${palName(record.parent2Id)}${genderMark(record.parent2Gender)} → ${palName(record.childId)}（${farmLabel}）`,
     href: buildHash('search', { p1: record.parent1Id, p2: record.parent2Id }),   // router.js
   });
   ```

   - `farmLabel`: 候補の最初の証拠の牧場（`candidate.evidence[0].farmId`）を `ctx.snapshot.breedFarms` から探し、その `baseId` の拠点名を `owned.state.owned?.bases`（`core/owned.js` の正規化で付く `label`）から引く（`owned.state.meta?.worldId` が `ctx.worldId` と同じときだけ）。分からなければ「配合牧場」。
   - `run`（`:231-295`）の成功の経路（`await store.mutate('create', …)` → `finish` → `registered++` の直後）で、`saveNotices(ctx, [registeredNotice(ctx, record, farmLabel)])` を**すぐに**呼ぶ。`same(ctx, current())` では止めない（確定した登録は、始めたときの保存先へ残す）。`allowDifferentChild` で送った後に食い違いが見つかった場合（`:270-275`）も、登録はできているので成功の通知は残す。
   - `record.id` は `:253` で作った `crypto.randomUUID()`。
   - `saveNotices`（`:197-208`）の残し方を変える: 足した後の一覧を日時の新しい順に並べ、**成功（`kind === SUCCESS` か id が `REGISTERED` に合う）は新しい 20 件、それ以外は新しい 50 件**を残してから、もう一度日時順に並べる。成功がいくら増えても未対応・異常の通知は追い出されない。並び（id）が同じなら保存しない、は今のまま。
   - 件数のトースト（`:294`）は残す（ページを見ているときの即時の知らせ）。

5. **既読と名前の変更**

   - 既読は元の id ごと（`notifications.read.<userIdKey>`）。まとめた行を開いたら、まとめた全部の id が既読になる。
   - 通知の保存先 `autoBreeding.notices.<env>.<userIdKey>` は、名前の変更で今も移している（`user-rename.js:41`）。変更は要らない。

### 触るファイル

- `web/js/notifications.js`、`web/js/ui/notifications.js`、`web/js/auto-register.js`、`web/js/release-notes.js`
- テスト: `test/web/notifications.test.js`、`test/web/auto-register.test.js`、（必要なら）`test/web/app.test.js`

### テスト

- 追加
  - `test/web/notifications.test.js`: `cleanNotification` は正しい kind・worldId・batchId だけを残し、不正な値（知らない kind・32 桁でないワールド ID・記号の多い batchId）は付けない。`groupNotifications` は同じワールド・同じ batchId の成功を 1 行にし、本文に「ほか N 件」を足して 60 字に収める。batchId が違う・kind がない通知はまとめない。行の並びは、いちばん上の通知の位置。
  - ベルの部品のテスト（`notificationMenu` を直接作る）: 同じ読み込みの成功 3 件が未読なら、数は 1、パネルの行は 1。開くと 3 件の id がすべて既読になる。
  - `test/web/auto-register.test.js`: ①登録が 1 件確定すると、id `auto-breed:test:registered:<recordId>`・title「配合を自動登録しました」・body「〈親1〉♂＋〈親2〉♀ → 〈子〉（〈拠点〉）」・href `#/search?p1=…&p2=…`・kind・worldId・batchId（= importedAt）の通知が残る。②同じ読み込みで 2 件登録すると 2 件の通知（同じ batchId）。③成功が 21 件以上になっても、未設定・異常の通知は消えない（成功は新しい 20 件）。④1 件目の登録の後で run が止まっても（途中でセーブが変わるなど）、確定した 1 件目の通知は残る。⑤本文に配合表だけで決まる文（「表は」「予想は」）が入らない。
- 期待値が変わる既存のテスト（別プラン §9 の C の `auto-register.test.js:241,356,406,474`。どれも、登録が確定した後の `notices()` を確かめている）
  - `:241`（対応づけの後の `assert.deepEqual(t.auto.notices(), [])`）→ 成功の通知だけが残ることを確かめる形に（例: `notices().filter((n) => n.kind !== 'auto-registered')` が空、成功が 1 件）。
  - `:356`（突然変異タマゴの登録の後の `notices()` が空）→ 同じく成功だけ。
  - `:406`・`:474`（title の配列）→ 実際に登録が確定しているかを開いて確かめ、確定していれば「配合を自動登録しました」を含めた配列にする。
  - `:108`（トーストの文）は変わらない。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: 本文は**登録したレコード**（もう登録済みの記録になったもの）だけで作る。配合表で求めた子を「表は」「予想は」として出さない。anomaly・conflict の文は inv2-notice の形のまま。
- **互換**: 古い通知（kind なし）はそのまま 1 件 1 行で出る。**旧コードのタブ**は kind を正規化で捨てるので、成功の通知を 1 件 1 行で出す（壊れない）。旧タブの `saveNotices` は日時順に 50 件で切るので、成功が多いと旧タブ側の保存で未対応の通知が押し出されることはあるが、新しいタブで次に保存すれば上限の分け方に戻る。
- **セキュリティ**: href は `#/` で始まるものだけ（今の `cleanNotification` の制限のまま）。名前は `textContent`。
- **性能**: 登録 1 件ごとに localStorage を 1 回書く（自動登録は 1 分に 1 回の読み込みで、新しい組だけなので回数は少ない）。

### release-notes の案

```js
{
  id: '<実装日>-autoreg-success', date: '<実装日>', title: '自動登録の結果を通知に',
  body: '配合牧場から自動登録した配合をベルに残します。同じ読み込みの分は 1 行にまとめます。',
},
```

title 11 字・body 43 字。

### 完了の条件

- [ ] `npm test` がすべて通る。
- [ ] 自動登録が 2 件起きた後（実機のホストのセーブか、テストと同じ手順の注入で）、ベルの数が 1 増え、開くと「配合を自動登録しました」「〈親1〉♂＋〈親2〉♀ → 〈子〉（〈拠点〉） ほか 1 件」の 1 行が出る。押すと配合検索のその組に移る。
- [ ] 設定の「通知一覧」でも同じ 1 行で出る。
- [ ] 成功の通知が 20 件を超えても、「プレイヤーの対応が未設定です」の通知は残っている（テストで確認）。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 成功の通知の本文は登録したレコードだけで作り、配合表の子が出ない（テストで固定）。互換 — kind のない古い通知が 1 件 1 行で出て、旧コードのタブが成功の通知を読んでも壊れない。成功の通知が増えても未対応・異常の通知が追い出されない。セキュリティ — href は `#/` で始まるものだけ、名前は textContent（`test/static/security.test.js`）。性能 — 登録 1 件ごとに localStorage を 1 回書くだけ。

### TODO

- [ ] `cleanNotification` に kind・worldId・batchId を通す（`NOTIFICATION_KINDS`）とテスト
- [ ] `groupNotifications` を作り、テストする
- [ ] ベル（未読の数・パネル）と通知一覧をまとめ表示にする
- [ ] `registeredNotice` を作り、登録が確定するごとに `saveNotices` で残す
- [ ] `saveNotices` で成功 20 件・それ以外 50 件に分けて残す
- [ ] 拠点名の引き方（なければ「配合牧場」）
- [ ] 既存のテスト（auto-register.test.js:241・356・406・474）を直し、新しいテストを足す
- [ ] release-notes に 1 件、画面で確かめる

---

## cleanup-dead-code: 使われなくなったコード・CSS の片付け

### 目的

画面から使われなくなった旧方式のコード（理想個体の並べ方の選択・継承ルートの相手親の除外と代表の配合）・CSS・定義のない色・隠しているだけの「◇」を片付け、読む人の混乱と保守の手間を減らす。テストは消さずに、今の方式（idealPlan）で同じ値を確かめる形に移す。あわせて、保存失敗の警告を共通の短文にし、接続診断ページの用途とこのアプリの強み・類似ツールとの対応を文書にする。

### 経緯

- 本セッションの案: **I-62**（理想個体の旧方式。直しつき M）、**R-18**（step.representative。直しつき）、**V-15**（未使用の CSS・定義のないトークン・隠すだけの ◇。S-50・C-45 を吸収）、**G-53**（diag の用途を文書に。直しつき）、**G-54**（保存失敗の警告の共通化。D-41 を吸収。直しつき）、**X-27**（強みと類似ツールの対応。直しつき）。別プランの **F087**（未使用コードの掃除の一覧）。
- 決まったこと
  - I-62 の判断: idealPairs・compare・compareGenerations・ORDERS を消す。ideal.test.js の idealPairs のテストのうち、**確率と世代の平均を確かめているもの**は idealPlan と generationTable・generationEggs を直接呼ぶ形に移し、**並べ方（order）だけのテスト**は消す。性能テストは idealPlan だけ（許容 2 秒のまま）。cleanGoal は order を読んでも無視し保存しない。GOAL_ORDERS は消す。README.md:23 を今の計画方式の表現に。**過去の release-notes は直さない**（配った通知の履歴）。
  - Codex の 1 回目のレビューの指摘 18（旧 API の試験の移行）→ 統合プランで「テストは消さずに idealPlan へ移す。test/perf/ideal.perf.js も。generationTable・generationEggs は残す」。
  - R-18 の判断: representative の計算とテストの確かめ方を削る。multiChild は残す（`ui/route-view.js` で使う）。「確認 N 回」のバッジは出さない（437536b で消した表示の復活になる）。
  - F087・統合プラン: `test/web/views.test.js:54-67`（継承ルートで除外・確認回数を出さず、旧 URL の `exclude=` でも経路を出す）と `test/web/router.test.js:22-25`（`exclude` をそのまま読み書きする）は**回帰テストとして残す**。
  - G-54 の判断: 3 か所の警告を `storageWarning(name)` にまとめ、文を「この端末に〇〇を保存できませんでした（ページを閉じると消えます）」にそろえる。option・select・group の共通化は、その画面を他の案で触るときに合わせて行い、単独の作業にしない。
  - G-53 の判断: diag.js の中身は変えず、docs/OPERATIONS.md の「動作確認」に 1 項目だけ足す。
  - X-27: 統合プランは「このアプリの強み・類似ツールとの対応表を文書化」。案の判断は「COMPARISON.md と対応表は作らず、SOURCES.md に『作らない機能』、README に強みの 3〜4 行」だった（理由: 表がリポジトリにない案 ID を大量に参照し、類似ツールの版にも依存してすぐ古くなる）。**統合プランを優先し、その理由を避ける形で書く**（下の手順 7。案 ID を書かない・調査日と版を書く・小さく保つ）。
  - 定義のない色（`--md-sys-color-on-error-container`）: 別プランの「残る小さな論点」は「error 系のまま定義する／tertiary 系に寄せる（推奨）」。ここでは**定義だけを足す**（今の見た目の意図どおりになる最小の修正）。状態チップとしての色の割り当ては visual-parts で決める。

### 依存

- **stable-render**（1a）: idealPlan を区切って計算する形（generator）にしているはずなので、テストの移し先はその同期の入口（今の `idealPlan(...)` と同じ戻り値を返す関数）にする。名前が変わっていれば読み替える。
- **ideal-calc**（テーマ 0。2026-10-12 追記）: `idealPlan` は、同じ種族で両親合わせて欲しいパッシブがそろう組も完全体作成組にする（idealPairs の `order: 'generations'` は今までどおり「両親それぞれが全部持つ」個体だけ）。`generationTable` には `parentExtras` が増え、`value()` は範囲外で `Infinity` を返す。下の手順 1 の値の比べ方はこの形を前提にする。
- **ideal-panel**（1b）: 目標を保存する所（今の `views/ideal.js:275` の `goalConditions`）が動いている場合は、そちらの `order: 'next'` を消す。

### このテーマでやらないこと

- `linkLabel`（`ui/owned-status.js:17-20`）は消さない（`:46` で使っている。外から読まれない export を外すかは任意）。`parseCsv`（`core/csv.js`）も残す（`test/core/csv.test.js` が使う）。
- 自動登録の設定キー `owned.bridge` の改名はしない（移行の手間に見合わない）。
- option・select・group の共通部品化（G-54 の残り）は単独ではやらない。
- 確認回数（confirmCount）の列・API・CSV は触らない（統合プランの判断事項 2）。
- 別プランの F087 にある `preview/design/shared/preview.js` の `ICONS`（`app.js:109-111` が先に SVG を入れるので、もう使われない）は、統合プランに入っていないので触らない。preview はデザイン案の確認用で、配信物ではない。
- `core/ideal.js` の `talentExpectation`（`:125`）は web から使われていない（`test/core/ideal.test.js` だけ）が、統合プランに入っていないので残す。

### 現状

- 理想個体の旧方式（コードで確かめた）
  - `core/ideal.js:37-40` の `ORDERS`、`:194-198` の `compare`、`:200-205` の `compareGenerations`、`:524-662` の `idealPairs`（説明のコメントを含む）。参照は `core/ideal.js` の中と `test/core/ideal.test.js`（`:5` の import、`:162・186・190・194・207・224・234・255・272・275・404・416・418・493・506・511・523`）と `test/perf/ideal.perf.js`（`:4・21・48`）だけ。`compareIds`（`:191-192`）は今の計画の並び `comparePlan`（`:218`）でも使うので**残す**。`breedingLayouts`・`passiveChance`・`talentChance`・`generationTable`・`generationEggs` も idealPlan が使うので残す。
  - 目標の `order`: `core/ideal-goals.js:11` の `GOAL_ORDERS`、`:64` の `order: oneOf(GOAL_ORDERS, value.order, 'next')`。画面は常に `'next'` を保存（`views/ideal.js:275`）。`goalKey`（`:91-93`）は order を見ない。
  - 性能テスト: 1 つ目のテスト（`test/perf/ideal.perf.js:6-30`。`:27-29` の 3 つ）と、2 つ目のテストの `:54`（世代・ケーキなし）・`:59`（世代・キノコケーキ 200）は idealPairs を測る。`:56・58・62-65` は `plan: true` で idealPlan を測っている。
  - README.md:23 の「1 個のタマゴの確率つきで提案します」は古い（今は組の目的 3 つとタマゴの平均）。
- 継承ルート: `core/route.js:42-55` の `filterPartners`、`:89-90` の `shortestRoute(..., { excludePartners })`、`:124・127` の `findRoutes(..., { excludePartners })`。画面（`views/route.js`）は `findRoutes(state.graph, state.index, from, to, { k: 5, slack: 3 })`（`:194`）で除外を渡さない。`:113-114・119` の `representative` は web のどこからも使わない。テストは `test/core/route.test.js:94・102・104・107-119・202・217`。`palComparator`・`compareId`（`:3-8`）は `:27・34・135` でも使うので残す。
- CSS（`web/css/app.css`）
  - `.ideal-changed`（`:1045`）が `--md-sys-color-on-error-container` を使うが、ライト（`:3-73`）にもダーク（`:75-107`）にも定義がない（`error-container` だけ `:26・97`）。値が無効になり、文字色が親から継がれる。
  - web/js のどこにもないクラス: `.load-more`（`:672`）、`.owned-import`（`:836`。`owned-import-row` とは別）、`.owned-status`（`:837`）、`.owned-section`（`:847-848`）、`.owned-preview`（`:892-894`）、`.owned-folder-worlds`（`:839` のセレクタの一部と `:908-909`）、`.owned-warnings`（`:1086` と `:1277` のセレクタの一部）。`test/web/owned-view.test.js:205` は `.load-more` が 0 件なことを確かめるだけなので、消しても通る。
  - `.tab-symbol { font-size: 20px }`（`:264`）は `.nav-tab .tab-symbol { font-size: 0 }`（`:1228`）で上書きされて効いていない。
  - ワールドの行の開閉の ▸ の `transition`（`:858`）が、動きを減らす設定のブロック（`@media (prefers-reduced-motion: no-preference)`、`:756-833`）の外にある。
- 隠しているだけの「◇」: `empty()`（`ui/dom.js:27-32`）が `span.empty-symbol`「◇」を作り（`:29`）、`.empty-symbol { display: none }`（`app.css:567`）で隠す。ログイン画面の `span.login-mark`「◇」（`app.js:212`）も `display: none`（`app.css:748`）。（ヘッダーのロゴの「◇」は visual-parts の X-16 で扱う）
- 保存失敗の警告（同じ長い文が 3 か所）: `views/drafts.js:163-164`、`views/wishlist.js:15-16`、`views/ideal.js:310`。「この端末に〜を保存できませんでした。ページを閉じると、保存できなかった変更は失われます。」
- 接続診断ページ: `web/diag.html`・`web/js/diag.js` の用途は README・docs のどこにも書かれていない。GAS の probe 系はテスト用パスワードでしか動かない（`gas/Actions.js`）。`docs/OPERATIONS.md:18-22` は smoke.mjs と api-check.mjs だけ。
- 強み・類似ツール: README.md:3-5 は INV-2 の説明、`:22-23` は機能の説明だけ。data/SOURCES.md の「取り込まないもの（INV-2）」（`:23`）に「作らない機能」の一覧はない。

### 実装の手順

1. **理想個体のテストを先に移す**（消す前に、確かめている値を保つ）
   - `test/core/ideal.test.js` の idealPairs のテストを 1 つずつ見て、確かめている値を 3 つに分ける。
     - (a) **idealPlan にもある値**: `candidates`・`unknownGender`・`missing`・`complete`・`tooMany`・組の `passiveChance`・`talentChance`・`chance`・`pool`・`extras`・`cleanPassiveChance`・`sources`、`isParentCandidate`（グローバルとタマゴを候補にしない）。→ 同じ入力で idealPlan を呼んで確かめる（組の並びは計画の並び `comparePlan` に変わるので、組は `find` で探して確かめる）。
     - (b) **世代の平均**（`order: 'generations'` の `:493-523`）: `generationTable`・`generationEggs` を直接呼ぶ形か、idealPlan の完全体作成組の `generations`・`generationsUpper` で確かめる。
     - (c) **idealPairs だけの意味**（並べ方 `order`、「欲しいパッシブがそろわない組は出さない」で `total: 0` になる `:186-194` など。idealPlan はそういう組もパッシブ厳選組・個体値厳選組として並べる）: 消す。
   - 消す前に、scratchpad（リポジトリの外）で一時のスクリプトを作り、(a)(b) の各テストの入力で idealPairs と idealPlan（または直接の関数）の値を並べて出し、同じであることを確かめる。違う値は、意味が違う理由をコミットのメッセージに書く。
     - **ideal-calc による意図した差**（2026-10-12 追記）: 同じ種族で、両親合わせて欲しいパッシブはそろうが、どちらかが全部は持たない組は、idealPairs（`order: 'generations'`）では候補にならず、idealPlan では完全体作成組（`generations` あり）になる。組の目的（`group`）と、完全体作成組の `generations`・`eggs` が違うのはこの理由。両親それぞれが全部持つ組の `generations` は、同じ `generationTable` の値なので同じになるはず（違えば `parentExtras` の正規化を疑う）。
     - (b) の世代の平均を `generationTable`・`generationEggs` を直接呼んで確かめるときは、ideal-calc の後の引数（`parentExtras`）の形で呼ぶ。今のテストの値は、`parentExtras` を渡さない（＝4 − 欲しい数）ときと同じになる。
   - `test/perf/ideal.perf.js`: 1 つ目のテスト（`:6-30`）を idealPlan で測る（`:27` の `total` の確かめは、idealPlan の戻り値で確かめられる値に直す。例: `pairs.length === 20`）。ideal-calc と stable-render で足した測定（世代の表の作成と使い回し・`idealPlanSteps` の区切り）は残す。2 つ目のテストの `:54`・`:59` は idealPlan に切り替えると `:56`・`:62`/`:63` と同じ測り方になるので消し、`measure` の `(plan ? idealPlan : idealPairs)`（`:48`）を idealPlan だけにする。import（`:4`）から idealPairs を外す。許容は 1 回 2 秒のまま。
2. **理想個体の旧方式を消す**
   - `core/ideal.js`: `ORDERS`（`:37-40`）、`compare`（`:194-198` とその上のコメント）、`compareGenerations`（`:200-205` とコメント）、`idealPairs`（`:524-662`、説明のコメントを含む）を消す。消した後に、どこからも使われなくなった内部の関数がないか `grep` で確かめる（`compareIds` は残る）。
   - `core/ideal-goals.js`: `GOAL_ORDERS`（`:11`）と、`cleanGoal` の `order`（`:64`）を消す（読むときは無視、保存しない）。`goalKey` のコメント（`:88-90`「ケーキと並べ方は作り方なので含めない」）は「ケーキは作り方なので含めない」に直す。
   - `views/ideal.js:275`（ideal-panel の後はその場所）の `order: 'next'` を消す。
   - README.md:23 の理想個体の説明を今の計画方式に直す（例:「…所持パルのどの ♂×♀ を配合牧場に置くとよいかを、組の目的（完全体作成組・パッシブ厳選組・個体値厳選組）ごとに、完成までのタマゴの平均の少ない順に並べます」）。release-notes の過去の通知は直さない。
3. **継承ルートの未使用を消す**（`core/route.js`）
   - `filterPartners`（`:42-55`）を消し、`shortestRoute`・`findRoutes` は `graph` をそのまま使う（引数の `excludePartners` を外す）。
   - `addStepDetails`（`:108-122`）から `representative` の計算（`:113-114`）と戻り値の `representative`（`:119`）を消し、`multiChild` は残す。
   - テスト（`test/core/route.test.js`）: `:94`・`:102`・`:217` の representative の確かめを消す。`:104` の `{ excludePartners: ['Y'] }` は外す。`:107-119` の「excludePartners: 候補を除外し…」のテストは消す。`:202` のランダムなテストの `excludePartners: excluded` と、それに合わせた期待値の作り方を外す。
   - `test/web/views.test.js:54-67` と `test/web/router.test.js:22-25` は**消さない**（URL に残った `exclude=` を無視して経路を出し、入れ替えでも URL に残すことの回帰テスト）。
4. **CSS と「◇」を片付ける**（`web/css/app.css`・`web/js/ui/dom.js`・`web/js/app.js`）
   - `--md-sys-color-on-error-container` を定義する: ライト `#7a1626`（`error-container` `#fbe1e4` に対して 8.62:1）、ダーク `#ffd9dd`（`#5a1c26` に対して 9.96:1）。比は相対輝度から計算した（WCAG の式）。
   - 未使用のルールを消す: `.load-more`、`.owned-import`、`.owned-status`、`.owned-section`（と `h3`）、`.owned-preview`（3 行）、`.owned-folder-worlds`（2 行と、`:839` の `, .owned-folder-worlds select` の部分）、`.owned-warnings`（`:1086` と、`:1277` の `, .owned-warnings` の部分）。**消す前にクラス名ごとに `grep -rn` で web/ と test/ を探し、テンプレート文字列での組み立ても含めて 0 件であることを確かめる**。
   - `.tab-symbol { font-size: 20px; line-height: 1.1; }`（`:264`）を消す（`:1228` が効いている）。消した後、レールのアイコンの位置が変わらないことを画面で確かめる。
   - `.owned-world-summary::before` の `transition: transform .15s ease`（`:858`）を外し、動きを減らす設定のブロック（`:756-833`）の中に `.owned-world-summary::before { transition: transform .15s ease; }` を足す。
   - 旧名のトークン（`--muted`・`--line` など、`:44-56`）の上に「新しく書く CSS では M3 のロール（--md-sys-color-*）を使う。旧名は触るついでに置き換える」とコメントを書く（一括の置き換えはしない）。
   - `empty()`（`ui/dom.js:27-32`）から `el('span', 'empty-symbol', '◇')` を消し、`.empty-symbol`（`app.css:567`）を消す。ログイン画面の `el('span', 'login-mark', '◇')`（`app.js:212`）と `.login-mark`（`app.css:748`）を消す。
5. **保存失敗の警告を共通の短文に**
   - `ui/dom.js` に足す:

     ```js
     /** この端末への保存に失敗したときの警告（hidden で出し入れする）。what は「下書き」「ウィッシュリスト」「目標」など */
     export function storageWarning(what, className = '') {
       const node = el('p', `form-errors storage-warning ${className}`.trim(), `この端末に${what}を保存できませんでした（ページを閉じると消えます）`);
       node.setAttribute('role', 'alert');
       return node;
     }
     ```

   - `views/drafts.js:163-165` → `storageWarning('下書き', 'drafts-warning')`、`views/wishlist.js:15-17` → `storageWarning('ウィッシュリスト', 'wishlist-warning')`、`views/ideal.js:310`（ideal-panel の後はダイアログの中）→ `storageWarning('目標')`。今のクラス名（余白の CSS）は第 2 引数で残す。
6. **接続診断ページの用途を書く**（`docs/OPERATIONS.md`）
   - 「動作確認」の並び（`:18-22`。smoke.mjs・api-check.mjs の後）に 1 項目を足す:「GAS を入れ直した後や CSP を変えた後は、配信先の `/diag.html` をテスト用パスワードで開き、CSP・CORS・並列書き込みを実際のブラウザで確かめる（画面からのリンクはない）。」 `web/js/diag.js` の中身は変えない。
   - 規約ファイル（CLAUDE.md）ではないので変更記録は要らないが、コミットのメッセージに理由を書く。
7. **強みと「作らない機能」と対応表を書く**
   - README.md の 5 行目の後に「このアプリの強み」を 4 行で足す（X-27 の文に事実確認の直しを入れたもの）:
     - 仲間で 1 冊: 配合の記録も所持パルも、仲間全員の画面にそろう。ホストがセーブを読めば、参加者の画面にも自動で届く。
     - 試した配合だけ: 配合検索・逆引き・継承ルートに出すのは仲間が登録した配合だけで、登録者と日時が付く。攻略サイトの配合表は画面に出さない（配合牧場の自動登録の照合にだけ使う）。
     - 手入力いらず: 配合牧場の親と、新しく産まれたタマゴをセーブから照らし合わせ、配合を自動で登録する。
     - 牧場まで見る計画: 理想個体は全員の所持パルから、配合牧場に置く組を別々の個体で並べ、今の牧場との交換を、全体の速さの目安が上がるときだけ勧める（ideal-calc の後の形）。
   - data/SOURCES.md の「取り込まないもの（INV-2）」（`:23`）の節に「作らない機能」を 5 行ほどで足す: 配合表の表示、配合ランク（BreedingPower）、突然変異の予測、外部の配合表へのリンク、（却下済みの）継承ルートの経由・回避と完成までの所要時間。
   - 新しく `docs/COMPARISON.md` を作り、類似ツールとの**小さな**対応表を置く（列は「機能｜どのツールにあるか｜このアプリ｜作らない理由（あれば）」）。**案の ID は書かない**。冒頭に調査日（2026-10-12）と各ツールの版（PalCalc は v1.21 まで、PalworldSaveTools は v2.4.5 で終了 など）を書き、「どのツールにもない」は調べた範囲での話だと添える。行は X-27 の表から、フェーズ 1d の時点の画面に合わせて選ぶ（例: 個体値の下限は「あり」。「すべて 100」は talent-target で入る）。data/SOURCES.md の冒頭からリンクする。
   - 文書だけの変更なので、この手順 6・7 だけなら release-notes は要らない（このテーマ全体では手順 4・5 の見た目の修正があるので 1 件足す）。

### 触るファイル

- `web/js/core/ideal.js`、`web/js/core/ideal-goals.js`、`web/js/views/ideal.js`、`web/js/core/route.js`、`web/js/ui/dom.js`、`web/js/app.js`、`web/js/views/drafts.js`、`web/js/views/wishlist.js`、`web/css/app.css`、`web/js/release-notes.js`
- 文書: `README.md`、`docs/OPERATIONS.md`、`data/SOURCES.md`、新規 `docs/COMPARISON.md`
- テスト: `test/core/ideal.test.js`、`test/perf/ideal.perf.js`、`test/core/route.test.js`、`test/core/ideal-goals.test.js`、`test/web/ideals.test.js`

### テスト

- 移す・直す
  - `test/core/ideal.test.js`: 手順 1 のとおり。import（`:5`）から idealPairs を外す。
  - `test/perf/ideal.perf.js`: 手順 1 のとおり。
  - `test/core/route.test.js:94・102・104・107-119・202・217`: 手順 3 のとおり。
  - `test/core/ideal-goals.test.js:10・19・31・58`: 目標の形から `order` を外す。`:31` は `clean.order` が `undefined`（保存しない）ことを確かめる形に。`:58`（cake・order が違っても同じ goalKey）は cake だけにしてもよいし、order を渡しても同じ key になることを残してもよい。
  - `test/web/ideals.test.js:16・54`: `GOAL` から `order` を外す（`:54` はログアウト中に null になる確かめなので、order がなくても意味は同じ）。
- 変わらないことを確かめる
  - `test/web/views.test.js:54-67`、`test/web/router.test.js:22-25`（残す）。
  - `test/web/owned-view.test.js:205`（`.load-more` が 0 件）。
  - `test/web/drafts.test.js:116`（`/保存できませんでした/` は新しい文にも合う）。
- 追加
  - `test/static/styles.test.js` に「`--md-sys-color-on-error-container` がライトとダークの両方で定義されている」「`var(--…)` で参照している `--md-sys-color-*` はすべて定義がある」を足す（定義のない色が二度と入らないように）。
  - 古い保存（`order: 'generations'` を含む目標）を `parseGoals` で読んでも捨てずに読み、保存し直すと `order` がないことを確かめる。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: `core/ideal.js` の import は `./index.js` だけのまま（`test/import.test.js:38-44`）。
- **互換**: 保存済みの目標の `order` は読み捨てる（cleanGoal は決まった項目しか残さないので、`order` を消すと次の保存で消える）。**旧コードのタブ**は `order` がない目標を読むと既定の `'next'` を入れるだけで、goalKey に order は入っていないので、同じ目標が 2 件に分かれることはない。
- **画面の挙動**: 消すコードは画面から使われていないので、理想個体・継承ルートの結果は変わらない（テストの移行で値が同じことを確かめる）。
- **性能**: 性能テストは idealPlan だけで 2 秒以内のまま（`npm run test:perf`）。

### release-notes の案

```js
{
  id: '<実装日>-cleanup-style', date: '<実装日>', title: '「変更あり」の文字色を修正',
  body: '理想個体の「変更あり」の文字色を直し、端末に保存できなかったときの警告を短くしました。',
},
```

title 13 字・body 43 字。

### 完了の条件

- [ ] `npm test` と `npm run test:perf` が通る。
- [ ] `grep -rn "idealPairs\|ORDERS\|GOAL_ORDERS\|excludePartners\|filterPartners\|representative" web/js test` が 0 件（`views.test.js`・`router.test.js` の URL の `exclude` は別の文字列なので残る）。
- [ ] 理想個体の「変更あり」のタグの文字が、ライトでは濃い赤、ダークでは淡い赤で読める（画面で確認）。
- [ ] 空の状態とログイン画面の DOM に `empty-symbol`・`login-mark` がない。
- [ ] 理想個体・継承ルートの画面の結果が、片付けの前と同じ（モックの同じ操作で比べる）。
- [ ] README・OPERATIONS・SOURCES・COMPARISON の追記を読み、案 ID や古い記述がない。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — `core/ideal.js` の import が `./index.js` だけのまま（`test/import.test.js`）。互換 — 保存済みの目標の `order` を読み捨てても、旧コードのタブで同じ目標が 2 件に分かれない（goalKey に order が入っていない）。性能 — `npm run test:perf` で idealPlan が 2 秒以内のまま。セキュリティ — `test/static/security.test.js` が通る。

### TODO

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

---

## copy-dead-ends: 見出し・用語・案内の行き止まり

### 目的

見出しをタブ名にそろえ、表記ゆれを用語表で決めて固定する。「設定タブの〜」とだけ書いて行き先のない案内を、1 文＋該当の欄を開くボタンにする。空の状態には次の操作を、読み込みの失敗には再試行を付け、行き止まりをなくす。

### 経緯

- 本セッションの案: **G-32**（見出しをタブ名に。S-43 を吸収）、**G-33**（見出しの階層）、**R-26**（継承ルートの見出しと「スキル」）、**G-51**（ログイン画面）、**G-55**（表記ゆれ）、**C-05**（ID と名前）、**G-30**（設定の該当の箇所を開く。C-01・C-02・D-05・O-33 を吸収）、**G-49**（状態表示。V-27 を吸収）、**G-50**（空の状態の次の操作）、**I-56**（組が出ないときの次の一手）、**X-15**（空の状態の絵はナビのアイコン）。別プランの **F080**（「設定タブの〜」7 か所を `setupHint({text, action})` に、`#/settings?world=<id>&open=auto` で該当の行を開いてフォーカス）・**F084**（用語表）。
- 統合プランで決まったこと（案の判断と違うところは統合プランを優先）
  - 見出しのキャッチコピーは**削除**、ログイン画面の INV-2 の注記「このノートに載るのは、仲間が登録した配合だけ。」は**残す**（判断事項 9）。
  - 用語表の項目: 産まれる・所持者＝人・パル濃縮・パッシブ・登録＝サーバ／保存＝端末・h1＝タブ名（F084）。
  - **文言のテストを作る**（統合プランの要点に「用語表と文言のテスト」）。G-55 の判断は「GLOSSARY.md と wording.test.js は作らない（コメントや内部の文字列を誤って検出しやすい）」だったので、その理由を避ける形にする（コメントを除いて、画面に出る決まった言い回しだけを調べる。手順 2）。
  - 案内のボタンの行き先は `#/settings?world=&open=auto`（該当の行を開いてフォーカス）。G-30 の判断は「光らせたり select へフォーカスを移したりはしない」だったが、統合プランは「開いてフォーカス」。participant-self で作った `reveal` を使う（光らせる動きは付けない）。
  - 空の状態の絵は**ナビのアイコン**（判断事項 6。X-15。AI の線画 F086 は任意の後回し、V-17・V-18 は却下・取り消し）。
- 案の判断で決まった細部: パル詳細の h1 は「No.117 ソルレイス」の形で、hero の名前と重ならないようにする。「← 戻る」は足さない（通知やブックマークから開くとアプリの外へ出るため）。G-33 は G-32 と同じ変更で、CSS のセレクタとテストの `querySelector('h3')` も直す。CSV と GAS の列名（凝縮・最後の持ち主。`core/owned.js` の `OWNED_COLUMNS`）は**変えない**（共有シートの列と結びついている）。スケルトンは入れない（G-49）。空の状態のアイコンは 5 か所だけ、パルの影は使わない（X-15）。
- 決まっていなかったので、この文書で決めたこと（コードで確かめた上で）
  - **「生まれる」と「産まれる」→「産まれる」**: web/js で「産まれ」28 か所・「生まれ」6 か所（画面に出るのは `views/pal.js:24`・`views/reverse.js:10`・`wishlist.js:190` の 3 か所）。理想個体・自動登録・release-notes も「産まれる」。統合プランの用語表の「生まれる」は項目の名前と読む。
  - **「新しいバージョン」と「新しい版」→「新しいバージョン」**: G-55 の判断は「新しい版」にそろえるだったが、プロジェクトの CLAUDE.md（「新しいバージョンがあります：〈title〉」）と `test/web/version.test.js:135・137` が「新しいバージョン」を前提にしている。規約ファイルを文言のためだけに変えないよう、画面の 1 か所（`ui/update-banner.js:38` の「新しい版を確認できませんでした」）を「新しいバージョン」に直す。
  - **「ID」と「名前」→「ID」**: C-05 は「名前」にそろえる案、G-51 の判断はログインのラベルを「ID（20 文字まで）」、決定事項 D7 は「ログイン ID」。画面の上の呼び名は「ID」にそろえ、設定の「名前を変更」も「ID を変更」にする（内部のキー userId・autocomplete=username は変えない）。

### 依存

- **participant-self**: `settingsHash(worldId)`（router.js）と、設定の `applyRoute`・`reveal`（行を開いてフォーカス）。
- **cleanup-dead-code**: `empty()` から「◇」を消してあること（ここでアイコンの枠を足す）。
- **owned-status**（1c）: 所持パルの読み込み状態の表示と「ファイル未登録はデータがないときだけボタンつきで」が入っていること（`ui/owned-status.js` の案内は、1c で変わった形の上で直す）。
- **owned-toolbar**（1c）: 所持パルの「すべて解除」（条件を既定に戻す関数）。空の状態のボタンはそれを呼ぶ。
- **ideal-results**（1b）: 理想個体の「計算のしくみ」がダイアログに移っていること（中の「参加している人」もそこで直す）。
- **header-frame**（1a）: ヘッダーのロゴの副題（キャッチコピー）が残っているかどうか（残っていればここで消す）。

### このテーマでやらないこと

- タブの統合・タブ名の変更（「配合を探す」など）は **find-merge** ほか（フェーズ 2）。ここでは今の 9 タブの名前に見出しをそろえる。タブ名を 1 か所から引く形にしておくので、フェーズ 2 で名前を変えれば見出しも変わる。
- 設定の「通知一覧」カードの削除と、プロジェクトの CLAUDE.md:16・`ui/notifications.js:54・89` の文言の変更（規約ファイルの変更記録を含む）は **bell**（フェーズ 2）。ここではベルの空の文を、通知一覧を開くボタンにするだけ（設定のカードは残るので、CLAUDE.md の記述は正しいまま）。
- 別プランの F080 の「参加者向けの案内は × で閉じて記憶」は統合プランに入っていないのでやらない（参加者の案内は roles で直す）。
- `docs/GLOSSARY.md` は作らない（用語表は README の開発の節に短く置く）。
- 読み込み中のスケルトン（V-27）、選ぶ前の案内の部品（hintState）は作らない。
- 削除・元に戻すの文言は **delete-undo**。

### 現状

- 見出し: 各画面の h1 は `viewHeading(title)`（`views/shared.js:7-11`）。タブ名と違うのは 6 か所: `views/search.js:9`「配合を見つけよう」、`views/reverse.js:8`「この子の親を探す」、`views/route.js:42`「スキルをつなぐ」、`views/list.js:9`「みんなの配合ノート」、`views/settings.js:70`「ノートの設定」、`views/pal.js:15`「パルの配合ノート」（パル名なし）。タブ名は `app.js:103` の `tabs`。見出しの文言を確かめるテストはない。
- 見出しの階層: 継承ルートは h1 の次が h3（`ui/route-view.js:43`、`views/route.js:128・139`）。理想個体の配合牧場も h3（`views/ideal.js:410`）。CSS は `.route-owned-box h3`（`app.css:1011`）と `.ideal-farms h3`（`:1050`）。h2 は 17px（`:134`）。テストは `test/web/route-view.test.js:32・72-73`、`test/web/ideal-view.test.js:528` が `querySelector('h3')`。
- 表記ゆれ（画面に出るもの）
  - 生まれる: `views/pal.js:24`「このパルが生まれる配合」、`views/reverse.js:10` のラベル「生まれる子」（`test/web/app.test.js:304` が確かめる）、`wishlist.js:190` の通知の本文。
  - オスとメス: `views/ideal.js:375・380`（同じ関数の `:379` は「♂ と ♀」）。
  - グローバルボックス: `views/owned.js:120`「グローバルボックスを表示」（`test/web/owned-view.test.js:76`）。同じ欄の `:185` と `core/owned.js:18` は「グローバルパルボックス」。
  - 新しい版／新しいバージョン: `ui/update-banner.js:38`「新しい版を確認できませんでした」と `:62`「新しいバージョンがあります」。
  - 参加者の呼び方: `views/owned-settings.js:24`「参加だけ」・`:59`「参加している側」、`ui/owned-status.js:24`「参加している側」、`views/ideal.js:168`「参加している人」。
  - 継承ルートの「スキル」: `views/route.js:57` の説明「この経路はスキルを運ぶ個体の流れです。相手親は別途用意します」（`test/web/views.test.js:61` が確かめる）、`:117` の欄名「運びたいパッシブ（所持パルから探す）」。
  - 親の組の記号: カード・下書き・継承ルートは「＋」、自動登録の通知の `pairText`（`auto-register.js:210`）と理想個体の組の出どころ（`views/ideal.js:75`）・牧場の判定（`:415`）は「×」。
  - ID と名前: ログインは「ID（1〜20文字）」（`app.js:228`）、設定は「ログイン中の ID:」（`views/settings.js:111`）なのにボタンは「名前を変更」（`:81`）、ダイアログは「新しい名前（1〜20文字）」（`:45`）。`api.js:5` の USER_NOT_FOUND は「このIDは登録されていません（ID が見つかりません）。…」で同じことを 2 回言う。ログアウトの確認（`views/settings.js:90`）にも「ID と共通パスワード」。
- ログイン画面（`app.js:210-250`）: ロゴの副題「仲間と残す、冒険の発見。」（`:92`、`test/web/app.test.js:166` が確かめる）、eyebrow「仲間とつくる、配合の記録」・h1「冒険の発見を、みんなのノートに。」（`:212-213`）・説明「ID と共通パスワードを入力してください。」（`:214`。ログインと新規登録で同じ）・注記（`:248`）。最初のフォーカスがどの入力欄にもない。
- 「設定タブの〜」の行き止まり（リンクなし）: `ui/owned-status.js:47・51・75`、`views/ideal.js:143・374`（participant-self で直した後）・`:463`、`views/route.js:121`、`ui/notifications.js:89`。`owned.js:433` の読み込みのエラー文にも「設定タブの「セーブ連携」の…」があり、`owned-status.js:51` で「（設定タブで確認できます）」が続くので「設定タブ」が 2 回出る。
- 状態表示: `empty(text, action)`（`ui/dom.js:27-32`）1 つで、選ぶ前の案内・結果なし・読み込み中（`views/shared.js:36`「登録済みの配合を読み込んでいます…」、`views/owned.js:214`・`views/ideal.js:462`「読み込み中…」）・エラー（`shared.js:36` の `state.error`）を同じ見た目で出す。エラーに再試行がない。句点の有無がばらばら（`views/reverse.js:21`、`views/search.js:26`、`views/route.js:192・196`、`views/pal.js:12` は句点なし）。
- 空の状態の次の操作: 一覧は登録者名で絞って 0 件でも「見つけた配合を登録しましょう。」と「配合を登録」（`views/list.js:45-46`）。所持パルの「条件に合うパルはいません。」（`views/owned.js:221`）に解除の手段がない。配合検索は親を 1 体だけ選んで 0 件でも「この組み合わせを登録」（`views/search.js:26-28`）。理想個体の組が出ないとき（`views/ideal.js:371-383`）は文だけ。

### 実装の手順

1. **見出しをタブ名に**
   - 新しく `web/js/views/tabs.js` を作り、`export const TABS = Object.freeze([['search', '配合検索'], …])`（今の `app.js:103` の配列をそのまま移す）と `export const tabLabel = (view) => TABS.find(([key]) => key === view)?.[1] ?? ''` を置く。`app.js` は `TABS` を import してナビを作る。
   - 6 か所の `viewHeading('…')` を `viewHeading(tabLabel('<view>'))` にする（search・reverse・route・list・settings）。drafts・wishlist・owned・ideal も同じ形にそろえる（文言は今と同じ）。
   - パル詳細（`views/pal.js:15-17`）: h1 を `No.${pal.label} ${pal.ja}` にする。hero は名前を重ねないよう、`palTile(…, { large: true })` の代わりに画像（`palIcon(pal, { large: true })`、`ui/pal-icon.js:31`）と属性のチップ（`elementChips`）だけにする。CSS の `.pal-hero` の並びを画像＋チップに合わせる。
   - 見出しの階層: `ui/route-view.js:43`・`views/route.js:128・139`・`views/ideal.js:410`（ideal-farms の後はその見出し）の h3 を h2 にする。`app.css` の `.route-owned-box h3`（`:1011`）・`.ideal-farms h3`（`:1050`）を h2 に替え、`.route-card h2 { font-size: 15px; }` を足して今の大きさを保つ。
   - ヘッダーのロゴの副題（`app.js:92`）が header-frame の後も残っていれば消す（キャッチコピーの削除）。追記（header-frame の実装、2026-10-12）: 残っている（`brandText`＝`span.brand-text` の中の `small`）。消すときは app.css の `@media (width < 1200px) { .brand small { display: none; } }` も消し、app.test.js の `/仲間と残す、冒険の発見。/` の確認を直す。
2. **用語表と文言のテスト**
   - README.md の「開発」の節に「表記の決まり」を表で置く（8 行ほど）:

     | 使う | 使わない・意味 |
     |---|---|
     | 産まれる | 生まれる |
     | 親A＋親B → 子（性別は ♂・♀。文章でも「オス・メス」と書かない） | ×（親の組） |
     | 所持者＝人（プレイヤー）。拠点・グローバルは「場所」 | 拠点を所持者と呼ぶ |
     | パル濃縮（★） | 凝縮（CSV の列名だけは変えない） |
     | パッシブ（パッシブスキル）。アクティブスキル・パートナースキルは「スキル」 | パッシブを「スキル」 |
     | 登録＝サーバ（仲間と共有する配合）／保存＝この端末（下書き・目標・既読・自分） | 端末だけのものを「登録」 |
     | 画面の h1＝タブ名（パル詳細はパル名） | キャッチコピーの見出し |
     | グローバルパルボックス・ホスト・参加者・新しいバージョン・ID | グローバルボックス・参加だけ・参加している側・新しい版・（画面での）名前 |

   - 新しく `test/static/wording.test.js` を作る: `web/js` の .js を読み、**コメント（`//…` と `/* … */`）を取り除いた**本文に、使わない言い回し（`生まれ`・`グローバルボックス`・`オスとメス`・`参加だけ`・`参加している側`・`参加している人`・`新しい版`・`スキルをつなぐ`・`スキルを運ぶ`）がないことを確かめる。例外のファイル（`release-notes.js`。配った通知の履歴なので直さない）は許可リストに入れる。CSV の列名は「凝縮」で、言い回しの一覧に入れない。
3. **画面の文言を直す**（CSV と GAS の列名は変えない）
   - 産まれる: `views/pal.js:24`、`views/reverse.js:10`（「産まれる子」）、`wishlist.js:190`。
   - ♂・♀: `views/ideal.js:375・380`（「♂ と ♀ で所持していません」「♂ と ♀ の組を作れる個体がいません」）。
   - 親の組の「＋」: `auto-register.js:210` の `pairText`（inv2-notice で文が変わっていれば、その中の記号）、`views/ideal.js:75` の組の出どころ（ideal-results の後の形）、`:415` の牧場の判定（ideal-farms の後の形）。
   - グローバルパルボックス: `views/owned.js:120`（owned-toolbar で 2 つのチェックが場所のチップに変わっていれば不要）。
   - 新しいバージョン: `ui/update-banner.js:38`。
   - 参加者: `views/owned-settings.js:24`（「参加者」）・`:59`（「…いまは参加者と判定します」）、`ui/owned-status.js:24`（「参加者（ホストが共有した所持パルを表示します）」）、`views/ideal.js:168`（計算の説明。ideal-results でダイアログに移った後の文）。
   - 継承ルート: 見出しは手順 1 で「継承ルート」。`views/route.js:57` を「この経路はパッシブを運ぶ個体の流れです。相手親は別途用意します」、`:117` を「運びたいパッシブ」。
   - ID: `views/settings.js:81` のボタン「ID を変更」、`:37` のダイアログの題「ID を変更」、`:45`「新しい ID（20 文字まで）」、`:46・114` の説明「これまでの配合の登録者名も、すべて新しい ID に変わります…」、`:33` の `renameErrors`（「ID を入力してください。」「ID は 20 文字以内で入力してください。」「今と同じ ID です。」）、`:55` のトースト「ID を「…」に変更しました」（`:86` も）、`:59` の「この ID はすでに使われています。別の ID を入力してください。」、`:113` の「「…」から「…」への ID の変更が…」。`api.js:6` の USER_EXISTS を「この ID はすでに使われています。別の ID にするか、ログインしてください。」。`grep -rn "名前" web/js/views/settings.js web/js/app.js web/js/api.js` で残りを洗い出す（セーブのプレイヤー名・パル名の「名前」は別物なので残す）。
4. **ログイン画面を減らす**（`app.js:210-250`）
   - h1 はログインなら「ログイン」、新規登録なら「新規登録」。eyebrow（`:212`）を消す。
   - 説明（`:214`）は新規登録のときだけ「ID は配合の登録者名になります（後で変更できます）。パスワードは仲間から聞いた共通のものです。」。ログインでは出さない。
   - ラベル（`:228`）を「ID（20 文字まで）」「共通パスワード」。
   - `api.js:5` の USER_NOT_FOUND を「この ID は見つかりません。初めての方は新規登録へ。」。
   - `main.replaceChildren(panel)`（`:249`）の後に、ID が入っていればパスワードの欄、空なら ID の欄にフォーカスする。
   - 注記「このノートに載るのは、仲間が登録した配合だけ。」（`:248`）は**残す**（INV-2 を利用者に伝える文）。
5. **「設定タブの〜」を 1 文＋ボタンに**
   - `ui/dom.js` に足す:

     ```js
     /**
      * 設定などへ移る必要がある案内。1 文と、行き先のボタン 1 つ。
      * @param {{ text: string, action?: { label: string, href?: string, run?: () => void }, kind?: 'info'|'warning' }} options
      */
     export function setupHint({ text, action, kind = 'info' }) // <div class="setup-hint setup-hint-{kind}"><p>text</p>（a.button.secondary.small か button）</div>
     ```

   - 置き換え（文は短く、行き先はボタンで示す）
     - `views/ideal.js:463`（所持パルのデータがない）→ `empty('所持パルのデータがありません。', link('セーブ連携を開く', settingsHash(''), 'button secondary'))`。
     - `views/route.js:121` → 同じ文とボタン（`setupHint` で、所持パルの欄の中に出す）。
     - `ui/owned-status.js:47`（セーブのファイルが未登録）→ 文「セーブのファイルが登録されていません。」＋ action `register`（ボタン「ワールドを登録」で `openWorldDialog(context)`）。owned-status（1c）で同じ形になっていれば、そのまま。
     - `ui/owned-status.js:51` → 「（設定タブで確認できます）」を消し、action `settings`（ボタン「セーブ連携を開く」で `context.navigate(settingsHash(linkedWorldId))`）。`owned.js:433` の文は「セーブのファイルが登録されていません。」だけにする（同じ文が設定のカードの `autoError` にも出る）。
     - `ui/owned-status.js:75`（登録されていないプレイヤーのファイル）→ 文「登録されていないプレイヤーのファイルがあります: 〈名前〉（Players\…sav）。」＋ action `editWorld`（ボタン「ワールドを編集」で `openWorldDialog(context, { world })`。world は `owned.state.auto.worlds` の `linkedWorldId` のもの）。`views/owned.js` の `noticeActions`（`:98`）に `register`・`settings`・`editWorld` を足す（`openWorldDialog` は `views/owned-settings.js` から import）。
     - `ui/notifications.js:89`（ベルの空の文）→ 「新しい通知はありません。」と、ボタン「これまでの通知」（`openNotificationList(notifications)` を開き、パネルを閉じる）。設定の「通知一覧」カードはこのフェーズでは残す。
   - `settingsHash('')`（ワールドの指定なし）でも、設定はセーブ連携のカードまでスクロールし、「このワールドでの自分」（出ていれば）かカードの見出しにフォーカスする（participant-self の `reveal` の ④⑤）。
6. **状態表示を分ける**（`ui/dom.js`・`views/shared.js`）
   - `errorState(message, retry)` を足す: `role="alert"`、error の左の帯、ボタン「もう一度読み込む」（`runButton` で `retry()` を呼ぶ）。
   - `loadingState(text)` を足す: `empty(text)` と同じ見た目で `role="status"`。
   - `dataPending(target, state, retry)`（`views/shared.js:34-38`）: `state.error` があれば `errorState(state.error, retry)`、なければ `loadingState('登録済みの配合を読み込み中…')`。呼んでいる画面（search・reverse・list・pal・route・ideal・drafts）は `() => context.store.refresh()` を渡す。
   - 読み込み中の文を「〜を読み込み中…」にそろえる: `views/owned.js:214`・`views/ideal.js:462` は「所持パルを読み込み中…」、`views/settings.js:127` の「取得後に表示します。」は「読み込み中…」。
   - 句点をそろえる: `views/reverse.js:21`、`views/search.js:26` の 2 つの文、`views/route.js:192・196`、`views/pal.js:12` の末尾に「。」。
7. **空の状態に次の操作とアイコン**
   - `empty(text, action, { icon } = {})`: `icon` がビュー名なら、文の上に高さ 48px の枠（`span.empty-icon`、`aria-hidden="true"`）を置き、`navIcon(icon)` を入れる（`ui/nav-icons.js:23`。CSS で `.empty-icon svg { width: 40px; height: 40px; stroke-width: 1.5; }`、色は `--md-sys-color-on-surface-variant`）。読み込み中・エラーには出さない。
   - アイコンを出すのは 5 か所だけ: 一覧（`views/list.js:45`、icon `list`）、下書き（`views/drafts.js:231`、`drafts`）、ウィッシュリスト（`views/wishlist.js:77`、`wishlist`）、所持パル（`views/owned.js:221`、`owned`）、理想個体（`views/ideal.js:382`・`:466`、`ideal`）。
   - 一覧（`views/list.js:45-46`）: 登録者名で絞っていて 0 件なら「「〈入力〉」に合う登録はありません。」＋ボタン「絞り込みを解除」（入力を空にして描き直す）。登録が 1 件もないときだけ、今の文と「配合を登録」。
   - 所持パル（`views/owned.js:221`）: 「条件に合うパルはいません。」＋ボタン「条件をすべて解除」（owned-toolbar の「すべて解除」と同じ関数を呼ぶ）。
   - 配合検索（`views/search.js:26-28`）: 親を 1 体だけ選んで 0 件のときは、ボタンを「この親の配合を登録」（`context.register({ parent1Id: p1 || p2 })`）。両方選んでいるときは今の「この組み合わせを登録」。
   - 理想個体の組が出ないとき（`views/ideal.js:371-383`）: `!result.candidates`（目標を ♂♀ で持っていない）なら、ボタンを 2 つ（`empty` の第 2 引数に 2 つのボタンを入れた `div`）: 「逆引きで親を探す」（`buildHash('reverse', { c: to })`）と「ウィッシュリストに追加」（`context.wishlist.add(to)`。すでにあれば `wishlist.list().some((wish) => wish.palId === to)` で判定し、押せない「ウィッシュリストにあります」）。ログインしていない（`wishlist.scope()` が空）ときは 2 つ目を出さない。フェーズ 2 の goals-merge で「目標に登録」に替わる。

### 触るファイル

- 新規: `web/js/views/tabs.js`、`test/static/wording.test.js`
- 変更: `web/js/app.js`、`web/js/api.js`、`web/js/ui/dom.js`、`web/js/views/shared.js`、`web/js/views/search.js`、`web/js/views/reverse.js`、`web/js/views/route.js`、`web/js/ui/route-view.js`、`web/js/views/list.js`、`web/js/views/settings.js`、`web/js/views/pal.js`、`web/js/views/drafts.js`、`web/js/views/wishlist.js`、`web/js/views/owned.js`、`web/js/views/ideal.js`、`web/js/views/owned-settings.js`、`web/js/ui/owned-status.js`、`web/js/owned.js`、`web/js/ui/notifications.js`、`web/js/ui/update-banner.js`、`web/js/wishlist.js`、`web/js/auto-register.js`、`web/css/app.css`、`README.md`、`web/js/release-notes.js`
- テスト: `test/web/app.test.js`、`test/web/store.test.js`、`test/web/views.test.js`、`test/web/route-view.test.js`、`test/web/ideal-view.test.js`、`test/web/owned-view.test.js`、`test/web/wishlist.test.js`

### テスト

- 期待値が変わる既存のテスト
  - `test/web/app.test.js:166`（ロゴの副題。消すなら外す）、`:304`（「生まれる子」→「産まれる子」）、`:507-530`（「名前を変更」→「ID を変更」、`:513` の「新しい名前」→「新しい ID」）。`:119・525` の「ログイン中の ID」は変わらない。
  - `test/web/store.test.js:189・201`（`/ID が見つかりません/` → `/この ID は見つかりません/`）。
  - `test/web/views.test.js:61`（継承ルートの説明「スキルを運ぶ」→「パッシブを運ぶ」）。`:30` の見出しの確かめ（「仲間とつくる」などが出ない）は通るまま。`:144` は変わらない。
  - `test/web/route-view.test.js:32・72-73`、`test/web/ideal-view.test.js:528`（`querySelector('h3')` → `'h2'`）。
  - `test/web/owned-view.test.js:76`（「グローバルボックスを表示」。owned-toolbar で消えていれば不要）、`:216`（`/セーブのファイルが登録されていません。.*設定タブ/` → 新しい文とボタン「ワールドを登録」）、`:311`（`/設定タブの「セーブ連携」でワールドを登録/` → 「所持パルのデータがありません。」と「セーブ連携を開く」）。
  - `test/web/wishlist.test.js:135`（通知の本文の「生まれる」→「産まれる」）。
  - `test/web/app.test.js:441` の `/新しい通知はありません/` は通るまま（ボタンが足されるだけ）。
- 追加
  - `test/static/wording.test.js`（手順 2）。
  - 見出し: 全タブで h1 が `TABS` のラベルと同じ。パル詳細の h1 が「No.〈番号〉 〈名前〉」で、hero に名前が二重に出ない。
  - `setupHint`・`errorState`（「もう一度読み込む」で retry が呼ばれる）・`loadingState`（role=status）の部品のテスト。
  - 一覧で絞り込んで 0 件 →「絞り込みを解除」で元の件数に戻る。所持パルの「条件をすべて解除」。配合検索で片親だけ 0 件 →「この親の配合を登録」で親1 が入った登録のモーダル。理想個体で目標を持っていない →「逆引きで親を探す」の href と「ウィッシュリストに追加」。
  - ログイン: ID が入っていればパスワードにフォーカス、ログインでは説明が出ず、新規登録では出る。
  - 案内のボタン: 所持パルのデータがない理想個体の「セーブ連携を開く」の href が `#/settings?open=auto`。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: ログイン画面の注記は消さない。「逆引きで親を探す」は登録済みの配合だけを出す（今のまま）。
- **互換**: CSV と GAS の列名（`OWNED_COLUMNS`）は変えない。release-notes の過去の通知の文は直さない（wording.test.js の許可リスト）。通知の id は変えない（`wishlist.js:190` は本文だけ変わる。保存済みの通知はないので影響なし）。
- **セキュリティ**: アイコンは `navIcon`（`createElementNS`）。文は `textContent`。
- **性能**: 影響なし。

### release-notes の案

```js
{
  id: '<実装日>-copy-dead-ends', date: '<実装日>', title: '見出しと案内をそろえました',
  body: '見出しをタブ名にそろえ、設定への案内はボタンで該当の欄を開くようにしました。',
},
```

title 13 字・body 38 字。

### 完了の条件

- [ ] `npm test` が通る（wording.test.js を含む）。
- [ ] 9 タブとパル詳細を開き、h1 がタブ名（パル詳細はパル名）。継承ルートと理想個体で h1 の次の見出しが h2。
- [ ] 理想個体・継承ルート・所持パルの「設定タブの〜」が 1 文＋ボタンになり、押すと設定の該当の欄が開いてフォーカスがある。
- [ ] 一覧・所持パル・配合検索・理想個体の 0 件の画面に次の操作のボタンがある。キャッシュのない初回に取得を失敗させると「もう一度読み込む」が出て、押すと取り直す。
- [ ] ログイン画面のキャッチコピーが消え、INV-2 の注記は残っている。ID の欄かパスワードの欄にフォーカスがある。
- [ ] `grep -rn "設定タブ" web/js` で、画面に出る文に残っていない（コメントは可）。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — ログイン画面の INV-2 の注記が残っている（判断事項 9）。互換 — CSV・GAS の列名、通知の id、過去の release-notes の文を変えていない（`wording.test.js` の許可リスト）。セキュリティ — アイコンは createElementNS、文は textContent（`test/static/security.test.js`）。性能 — 対象外。

### TODO

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

---

## delete-undo: トーストと、削除・元に戻すの決まり

### 目的

トーストが行の右端のボタン（編集・削除）に重なる・「元に戻す」が 3 秒で消える・エラーを見落とす、を直す。消すときの決まりを「この端末だけのもの＝確認なしで消して元に戻す／仲間と共有するもの＝確認を残す」にそろえ、外れている下書きの一括削除を直す。削除の確認に出すカードの親の左右を、押した行と同じにする。

### 経緯

- 本セッションの案: **G-44**（トーストの位置・時間・止める。直しつき）、**G-45**（エラーの種類と閉じるボタン。V-29 を吸収。直しつき）、**V-26**（閉じるときの短い動き。直しつき）、**D-29**（下書きの一括削除に元に戻す。そのまま）、**D-30**（消すときの決まりと、確認のカードの左右。S-30 を吸収。直しつき）。
- 決まったこと（案の判断と統合プラン）
  - 位置は **main の幅の中の下中央**（行の右端の操作にも、左端のパルの画像にも重ならない）。ダイアログの中のトーストは今のまま（ダイアログの中に出す）。
  - **操作つき（元に戻す・入力し直す）は 6 秒**、文言だけのものは 3 秒（今のまま）。マウスが乗っている間（:hover）とフォーカスがある間（:focus-within）はタイマーを止め、残り時間から再開する。下端の残り時間の線も `animation-play-state: paused` で止め、長さは `--toast-duration` で JS とそろえる（WCAG 2.2.1）。
  - `app.js:192` の「3 秒間」は定数から作る。
  - 同じ文言のトーストをまとめる処理と、同時に出す数の上限は**見送る**（自動登録の連続が実際に問題になってから）。
  - エラーだけを区別する: `toast(message, { kind: 'error' })`。エラーは role=alert・error-container の地と左の帯・6 秒・右端に ×（aria-label「閉じる」）。syncInBackground の失敗はエラーにする。成功・情報のアイコン分けは見送る。
  - 閉じるときの動きは**トーストだけ**（150ms で薄くなりながら 8px 下がってから消す。動きを減らす設定ではすぐ消す）。ダイアログの閉じる動きはやらない（Esc・closeDialogs・confirmDialog の順番に影響し、`test/web/dialog.test.js:12-15` が閉じた直後の `isConnected=false` を確かめているため）。
  - 端末だけのもの（下書き・目標）は確認なしで消して「元に戻す」、共有する配合は確認を残す（判断事項 7。S-47「配合の削除の確認をやめる」は取り消し）。今の決まりから外れているのは**下書きの一括削除だけ**（D-30 の事実確認）。
  - 確認のカードの左右: 一覧（`views/list.js:48`）・配合検索（`views/search.js:35`）は `leftParent` を付けて行を出すのに、削除の確認（`app.js:191-194`）は付けずに出すので、親の左右が逆になる（不具合。13-delete-confirm-dialog.png で確認済み）。
  - 配合の確認の文は「仲間の画面からも消えます。削除後 6 秒間は元に戻せます。」（D-30 の任意の部分。秒数は定数から）。

### 依存

- **header-frame**（1a）: 重なり順の CSS 変数（トースト・ダイアログ・ドロワーなど）。トーストの z-index はそれを使う。
- **stable-render**（1a）: 「新しいバージョン」の帯が下端の固定スナックバーになっていること。stable-render ではトーストが**右下**にある前提で、スナックバーの幅（トースト領域と横に重ならない）と z-index（トーストより下）を決めている。トーストを下中央に移すので、ここでスナックバーとの位置関係を決め直す（手順 2）。

### このテーマでやらないこと

- ダイアログの閉じる動き（上の理由）。
- 同じ文言のトーストのまとめ・同時に出す数の上限。
- 削除の後のフォーカスの決まりの統一（G-42）は後回し。
- 消える行を短く畳んでから作り直す動き（V-24）は後回し。
- 元に戻すの 8 秒と Ctrl+Z（F085）は任意の後回し。
- 配合の削除の確認をやめること（S-47 は取り消し）。

### 現状

- トーストの部品 `ui/toast.js`: `toast(message, { action, actionLabel = '元に戻す', duration = 3000 })`（`:19`）。呼び出し側で duration を渡す所はない。マウスを乗せても止まらず、閉じるボタンもない。`dismiss` は `clearTimeout` と `node.remove()` だけ（`:23`）。表示先は一番手前のダイアログか本文（`currentRegion`、`:6-17`）で、ダイアログを閉じると残りを次の表示先へ移す（`:12-14`）。表示先は `aria-live="polite"` が 1 つ（`:10`）。
- CSS: `.toast-region`（`app.css:617`）は `position: fixed; bottom: 24px; right: 24px; width: min(460px, calc(100% - 48px)); z-index: 20`。`.toast`（`:618-631`）は反転色の 1 種類。残り時間の線は `.toast:has(.toast-action)::after`（`:1325-1336`）を `animation: countdown 3s linear forwards`（`:777`。duration と連動しない）。出るときの動きは `:809-812`（`@starting-style`）。
- 重なる所: 配合カード（一覧・配合検索・逆引き・パル詳細）の右端の編集・削除、下書きの行の登録・編集・削除、ウィッシュリストと理想個体の登録一覧の「外す」。理想個体で続けて登録するとトーストが 2 つ積み重なり、牧場の判定の右側を隠す（35-ideal-goals-open.png）。
- エラーも成功と同じ関数・同じ見た目: `ui/sync.js:10`（syncInBackground の失敗。「入力し直す」の操作つきのことがある）、`app.js:312` の `toast(error.message)` など（web/js で `toast(error.message)` は 15 か所）。
- 削除の決まり（今）: 配合は確認を出し（文は「削除後、3 秒間は元に戻せます。」）、消した後 3 秒は元に戻せる（`app.js:191-205`）。下書き 1 件（`views/drafts.js:176-181`。`drafts.remove` が `{ draft, index }` を返し、`restore` で戻す、`drafts.js:112-126`）・ウィッシュリスト（`views/wishlist.js:43-48`）・理想個体の登録（`views/ideal.js:315-325`）は確認なし＋元に戻す。ワールドの登録・共有した所持パルの削除は確認だけ（`views/owned-settings.js:274-277・322-326`）。**下書きの一括削除だけが確認ありで戻せない**（`views/drafts.js:183-194`。「この操作は元に戻せません」）。`drafts.removeMany`（`drafts.js:127-134`）は件数だけを返す。
- 確認のカード: `breeding-card.js:57-58` は `context.remove(record)` とだけ渡し、`app.js:193` は `breedingCard(record, {}, { preview: true })` で作る（leftParent も focusParent も渡らない）。

### 実装の手順

1. **トーストの部品**（`web/js/ui/toast.js`）

   ```js
   export const TOAST_DURATION = 3000;     // 文言だけ
   export const ACTION_DURATION = 6000;    // 元に戻す・入力し直すなどの操作つき
   export const ERROR_DURATION = 6000;
   /** @param {{ action?: () => any, actionLabel?: string, duration?: number, kind?: 'info'|'error' }} [options] */
   export function toast(message, { action, actionLabel = '元に戻す', duration, kind = 'info' } = {})   // 戻り値は dismiss（今のまま）
   ```

   - 既定の時間: `duration ?? (kind === 'error' ? ERROR_DURATION : action ? ACTION_DURATION : TOAST_DURATION)`。
   - 残り時間の線: `` node.style.setProperty('--toast-duration', `${duration}ms`) ``（style 属性の文字列は使わない）。
   - 止める: `pointerenter`・`focusin` でタイマーを止めて残り時間を覚え、`.paused` を付ける。`pointerleave`・`focusout` で、マウスもフォーカスもなくなったら残り時間から再開して `.paused` を外す（フォーカスの有無は `node.contains(event.relatedTarget)` で見る）。
   - エラー: `kind === 'error'` なら `node.classList.add('toast-error')`、`role="alert"`、右端に閉じるボタン `button('×', dismiss, 'toast-close')`（`aria-label`「閉じる」。visual-parts で SVG のアイコンに替える）。
   - 読み上げが二重にならないよう、表示先を 2 つに分ける: `.toast-region`（位置を決める入れ物。aria-live なし）の中に、`.toast-list`（`aria-live="polite"`。ふつうのトースト）と `.toast-alerts`（aria-live なし。role=alert のトースト）を置く。`currentRegion` は `.toast-region` を返し、`toast` は kind で入れる先を選ぶ。ダイアログを閉じたときの移し替え（`:12-14`）は、それぞれのリストの子を、次の表示先の同じリストへ移す（`.leaving` の付いたノードは移さない）。`test/web/dialog.test.js:40` の `body.querySelector('.toast-region').contains(node)` はそのまま通る。
   - 閉じる動き: `dismiss` は 2 回目以降は何もしない。`globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches` が真か、`matchMedia` がない（テストの DOM）なら、すぐ `node.remove()`。そうでなければ `.leaving` を付けて中のボタンを `disabled` にし（元に戻すの押し違いを防ぐ）、150ms 後に `remove()`。
2. **トーストの位置と見た目**（`web/css/app.css`）
   - `.toast-region`: `left: calc(var(--drawer) + (100% - var(--drawer)) / 2); right: auto; transform: translateX(-50%); bottom: calc(24px + var(--snackbar-offset, 0px)); width: min(460px, calc(100% - var(--drawer) - 48px)); z-index: var(--z-toast, 20);`（`--drawer` は**左のレールの幅**（`:61` の 96px）。フェーズ 3 の右のドロワーとは別の変数なので混同しない）。中の 2 つのリストは `display: grid; gap: 8px;`。
   - ダイアログの中: `dialog .toast-region { left: 50%; width: min(460px, calc(100% - 48px)); }`。
   - スナックバーとの関係: 「新しいバージョン」のスナックバーが出ている間は、トーストをその上に積む。`:root:has(.update-banner:not([hidden])) { --snackbar-offset: calc(var(--snackbar-height) + 8px); }`（`--snackbar-height` は stable-render で決めたスナックバーの高さの変数。なければここで足す）。stable-render で決めたスナックバーの幅の式（右下のトーストを避ける `- 484px` など）は、トーストが下中央に移ったので見直し、スナックバーも下中央・トーストより下の z-index にする。
   - 残り時間の線: `:777` を `animation: countdown var(--toast-duration, 3s) linear forwards;` にし、`.toast.paused::after { animation-play-state: paused; }` を足す。コメント（`:1324`「toast の既定の 3 秒」）を直す。
   - エラー: `.toast-error { background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); border-left: 4px solid var(--md-sys-color-error); }`（`--md-sys-color-on-error-container` は cleanup-dead-code で定義済み）、`.toast-close`（24×24px 以上、文字色は currentColor）。
   - 閉じる動き（動きを減らす設定のブロック `:756-833` の中）: `.toast.leaving { opacity: 0; transform: translateY(8px); transition: opacity .15s linear, transform .15s var(--ease-emphasized); }`。
3. **エラーをエラーとして出す**
   - `ui/sync.js:10`: `toast(…, { kind: 'error', …(retry ? { action, actionLabel: '入力し直す' } : {}) })`。
   - `app.js:312`（取得の失敗）の `toast(error.message)` を `toast(error.message, { kind: 'error' })`。ほかの `toast(error.message)`（`grep -rn "toast(error.message)" web/js`）も、操作の失敗を知らせるものは `kind: 'error'` にする。
4. **配合の削除の確認**（`app.js:191-205`・`ui/breeding-card.js:57-58`）
   - `breeding-card.js:58` を `context.remove(record, { leftParent })` にする（`focusParent` のカード〈パル詳細の「相手 → 子」〉は渡さず、確認では両親の形のまま）。
   - `app.js` の `remove(record, { leftParent = '' } = {})` で、プレビューを `breedingCard(record, {}, { preview: true, leftParent })` にする。
   - 確認の文を `` `仲間の画面からも消えます。削除後 ${ACTION_DURATION / 1000} 秒間は元に戻せます。` `` にする（`ACTION_DURATION` は toast.js から import）。削除の後の「元に戻す」付きのトースト（`:197`）は既定で 6 秒になる。
5. **下書きの一括削除を確認なし＋元に戻すに**（`web/js/drafts.js`・`web/js/views/drafts.js`）
   - `drafts.js` に足す（`removeMany` の戻り値〈件数〉は今のまま。`test/web/drafts.test.js:162` が 0 を確かめている）:

     ```js
     /** 一括で消し、元に戻すための { draft, index }[]（index は消す前の位置。小さい順）を返す。消せなければ null */
     removeAll(ids, key = scope())
     /** 消した時点の ID・環境に、index の小さい順に差し込み直す（index は今の長さに丸める。同じ id があれば飛ばす）。戻した数を返す */
     restoreMany(items, key)
     ```

     - `removeAll` は `removeMany` と同じ条件（送信中の下書きは消さない・名前の変更中は null）。
     - `restoreMany` は `restore`（`:121-126`）と同じく、`key` がないとき・名前の変更中（`locked()`）は 0。
   - `views/drafts.js` の `removeAll()`（`:183-194`）: 確認ダイアログをやめ、見えている下書き（送信中を除く。`visible(key)`）を `drafts.removeAll(ids, key)` で消し、`` toast(`${removed.length} 件の下書きを削除しました`, { action: () => { if (!drafts.restoreMany(removed, key)) toast('元に戻せませんでした', { kind: 'error' }); } }) ``。
   - 下書きはフェーズ 2 の register-entry で「配合を探す」の折り畳み帯に移るが、ストアの関数はそのまま使われる。

### 触るファイル

- `web/js/ui/toast.js`、`web/js/ui/sync.js`、`web/js/app.js`、`web/js/ui/breeding-card.js`、`web/js/drafts.js`、`web/js/views/drafts.js`、`web/css/app.css`、（`toast(error.message)` を直す所）`web/js/views/*.js`・`web/js/ui/*.js`、`web/js/release-notes.js`
- テスト: `test/web/dialog.test.js`、`test/web/drafts.test.js`、`test/web/breeding-card.test.js`（または `test/web/app.test.js`）、新規 `test/web/toast.test.js`

### テスト

- 追加
  - `test/web/toast.test.js`（新規）: ①操作つきは 6 秒・文言だけは 3 秒で消える（タイマーはテストの時計で進める）。②`pointerenter` で止まり、`pointerleave` で残り時間から再開する。`focusin`・`focusout` も同じ。③`kind: 'error'` は role=alert・閉じるボタン（aria-label「閉じる」）があり、押すと消える。エラーは `.toast-alerts` に、ふつうは `aria-live="polite"` の `.toast-list` に入る。④`--toast-duration` が `style.setProperty` で入る。⑤`matchMedia` がないときは、dismiss ですぐ消える。
  - `test/web/drafts.test.js`: 一括削除で確認が出ずに消え、トーストの「元に戻す」で同じ順に戻る。戻す前に別の下書きを足しても、元の位置（丸めた位置）に戻る。名前の変更中は戻せない。
  - 確認のカードの左右: 一覧で「親の順」に並べた行（`leftParent` 付き）の削除を押すと、確認のカードの左の親が押した行と同じ（`test/web/app.test.js` か `views.test.js` で、確認ダイアログの中の `.pal-tile` の順を確かめる）。
- 期待値が変わる既存のテスト
  - `test/web/drafts.test.js:275-292`（一括削除は確認してから消す）→ 確認なしで消え、元に戻せる形に書き直す。
  - `:356-374`（送信中で隠れている下書きは一括削除の対象に含めない）→ 確認ダイアログの手順を外し、送信中の下書きが残ることだけを確かめる。
  - `:376-395`（確認中に送信に失敗して戻った下書きは消さない）→ 確認の待ち時間がなくなり、この競合は起きなくなる。テストを消すか、「押した時点で見えていた下書きだけを消す」ことを確かめる形に変える。
  - `test/web/dialog.test.js:30-43`（トーストの移し替え）は、2 つのリストに分けた後も通ることを確かめる（通らなければ、リストごとの移し替えに合わせて直す）。
  - 配合の削除の確認の文を確かめているテストがあれば直す（`grep -rn "元に戻せます" test`）。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: 関係なし。
- **互換**: `toast()` の引数は増えるだけ（今の呼び出しはそのまま動く）。`drafts.removeMany` の戻り値は変えない。
- **セキュリティ**: 残り時間は `style.setProperty`。文は `textContent`。
- **アクセシビリティ**: エラーは role=alert で、ふつうの知らせとは別のリストに出す（二重に読まれない）。止める・閉じるで WCAG 2.2.1（時間の調整）に合う。
- **性能**: 影響なし。

### release-notes の案

```js
{
  id: '<実装日>-delete-undo', date: '<実装日>', title: '元に戻すを長めに',
  body: '元に戻す付きの知らせは 6 秒出し、マウスを乗せると止まります。下書きの一括削除も戻せます。',
},
```

title 8 字・body 46 字。

### 完了の条件

- [ ] `npm test` が通る。
- [ ] モック（`?mock=1&seed=40`）で、一覧を下までスクロールして最下段のカードを削除 → トーストが画面の下中央に出て、行の右端の編集・削除に重ならない（14-toast-undo-after-delete.png と比べる）。
- [ ] 「元に戻す」付きのトーストが 6 秒出て、マウスを乗せている間は消えず、線も止まる。キーボードで「元に戻す」にフォーカスしている間も止まる。
- [ ] 通信を失敗させると、赤い地のトーストが × 付きで 6 秒出る。
- [ ] 一覧の「親の順」の行を削除するとき、確認のカードの親の左右が押した行と同じ。
- [ ] 下書きを 2 件作って一括削除 → 確認なしで消え、「元に戻す」で同じ順に戻る。
- [ ] 「新しいバージョン」のスナックバーが出ているとき、トーストがその上に出て重ならない。
- [ ] 動きを減らす設定（OS の設定）では、トーストがすぐ消える。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — `toast()` の今の呼び出しがそのまま動き、`drafts.removeMany` の戻り値を変えていない。共有する配合の削除の確認は残している（判断事項 7）。セキュリティ — 残り時間は `style.setProperty`、文は textContent（`test/static/security.test.js`）。INV-2・性能 — 対象外。

### TODO

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

---

## visual-parts: 見た目の部品の統一

### 目的

性別の色・入力欄の枠・属性チップのコントラストを WCAG の基準に合わせ、性別マーク・状態チップ・押せないボタン・アイコンを 1 つの部品にそろえる。ファビコンをダークに対応させ、画像の作り方の決まりを SOURCES.md に書く。

### 経緯

- 本セッションの案: **V-08**（性別の色のトークン。そのまま）、**V-09**（genderMark()。直しつき）、**V-41**（コントラスト。直しつき）、**V-42**（部品の高さ・ラベルの間隔・開閉の印・×。そのまま）、**V-43**（状態チップ。そのまま）、**V-45**（押せないボタン。そのまま）、**V-14**（ui/icons.js。直しつき M）、**G-57**（ロゴ・ファビコン。V-19 を吸収。直しつき）、**X-16**（ロゴの形とファビコンのダーク対応・「◇」の読み上げ。直しつき）、**X-13**（Codex の画像生成は配信物に使わない・画像の作り方の表。直しつき）。
- 決まったこと（案の判断と統合プラン）
  - 性別: `--gender-male`・`--gender-female` をライトとダークで定義し、♀ がエラーの赤（`--danger`）を流用しているのをやめる。`genderMark(gender)` を `ui/pal-icon.js` に作り、**置き換えるのは palTile と所持パルの人間の行の 2 か所だけ**。理想個体の文の中の ♂♀ は、色のクラスだけそろえる（文の途中に丸いバッジを置くと行の高さが崩れるため）。SVG もゲーム画像も使わない（文字の ♂♀ のまま）。
  - コントラスト: ライトの outline を `#6f8a84` 前後に（背景に約 3.4:1、白に約 3.7:1。WCAG 1.4.11 の 3:1）。属性チップの白文字は **text-shadow に頼らず**、4.5:1 に届かない 5 色（無・炎・水・雷・氷）を暗くする（text-shadow はコントラストの計算に入らない。12px の太字は大きい文字にならない）。`--Neutral` などは SVG のアバター（`.pal-avatar`）でも使うので、チップだけの色にする。式の「＋」は on-surface-variant。
  - アイコン: `ui/icons.js` にパスの定義（ナビ・編集・削除・ベル）を集め、navIcon・svgIcon・actionIcon はそこから呼ぶだけにする。**文字から SVG に替えるのは閉じる「×」だけ**（dialog.js・pal-picker.js・passive-picker.js。aria-label を必ず付け、テストは名前で探す形に）。入れ替えの「⇄」は案の判断では SVG にする対象だったが、フェーズ 2 の **route-cleanup で ⇄ と 2 つの形をやめる**ので、ここでは替えない。配合の式の ＋ → と ✓/— は文字のまま（テストが textContent で確かめ、コピーや読み上げでも文字が自然）。
  - ロゴ・ファビコン: `favicon.svg` に `@media (prefers-color-scheme: dark)` を入れる（ヘッダーと同じダークの色 #65d7bc／#102f2e）。ヘッダーのロゴの span の中身「◇」を空にして `aria-hidden` を付ける（リンクの名前に「◇」が読まれている。01-search-empty.yml:6）。マスクを `web/img/brand-mark.svg` に移すのは形を変えるときに。ロゴの描き直し（Codex の画像生成で下絵）は**任意**で、使うならユーザーに目的を説明して許可を取ってから。ナビのアイコンの描き直しと見出しのアイコンは見送り。
  - Codex の画像生成は配信する画像に使わない（判断事項 5）。画像の置き場所ごとの作り方を data/SOURCES.md の「画像の扱い」に表で書く。
  - 状態チップは V-43 の向き（1 部品にそろえる）を採る（理想個体の計画をゲーム風の暗い帯にする V-38 は却下）。
- 「変更あり」の色: 別プランの「残る小さな論点」は tertiary 系に寄せる案を推奨していたが、このアプリの tertiary は primary と同じ色（`app.css:11-14`）で、「作成可能」「完成済み」が tertiary-container を使う。区別がつかなくなるので、状態チップでは「変更あり」を **is-warning**（warning-container）にする（この文書で決めた）。

### 依存

- **cleanup-dead-code**: `--md-sys-color-on-error-container` の定義（状態チップの is-error とエラーのトーストで使う）、`empty()` とログイン画面の「◇」の削除。
- **delete-undo**: エラーのトーストの閉じるボタン（ここで SVG のアイコンに替える）。
- **header-frame**（1a）: ヘッダーのロゴ（brand）の作り。ロゴの span の位置が変わっていれば合わせる。
- **popovers**（1a）・**ideal-results**・**ideal-farms**（1b）・**owned-rows**（1c）: パッシブ選択・組のタグ・牧場の行・所持パルの行の作りが変わっている。性別マーク・状態チップ・× の置き換えは、その後の形に対して行う。

### このテーマでやらないこと

- 「⇄」の SVG 化（route-cleanup で消える）。
- 配合の式の ＋ → と ✓/— の SVG 化。
- ナビのアイコンの描き直し・見出しへのアイコン追加（タブの構成が決まった後に別の作業）。
- ゲームから性別・属性などのアイコンを取り出すこと（**game-assets**、フェーズ 4）。
- ★の 4 枠（owned-rows）、組の種類のタグの色とアイコン（ideal-results）。
- 角丸と文字の大きさのトークン化（V-16 は却下）、テーマの切り替え（V-33 は後回し）。

### 現状

- 性別の色: `.gender-M { color: var(--Water); }`・`.gender-F { color: var(--danger); }`（`app.css:519-520`）。♂ の #247fbc は白に対して 4.34:1、ダークの行の背景 #1a2b30 に対して 3.38:1 で、AA の 4.5:1 に届かない（相対輝度から計算して確かめた）。属性の色（`:35-43`）はダークのブロック（`:75-107`）で上書きされない。♀ はエラーの赤（#b03043）で、ごみ箱のボタンと同じ色。
- 性別マークの組み立ては 4 か所: `ui/pal-icon.js:73`（palTile）、`views/owned.js:33-36`（人間の行で同じ処理をもう一度）、`views/ideal.js:398`（牧場の説明文 `palText`）、`:75`（組の出どころの文）。配合カード（`ui/breeding-card.js:32-39`）は palTile に gender を渡しているので、palTile を直せばそろう。テストは `.gender` のクラスと textContent の ♂♀ で確かめている（`test/web/breeding-card.test.js:72・77`、`test/web/route-view.test.js:29`、`test/web/views.test.js:47`、`test/web/owned-view.test.js:177` は `['♀', 'モコロン']` の並び）。
- コントラスト: `--md-sys-color-outline: #a9bfb8`（`app.css:23`）は背景 #f3f7f4 に 1.79:1・白に 1.94:1。入力欄（`:122`）・パル選択・セカンダリボタン・式の「＋」（`.equation-symbol`、`:537`）が使う。属性チップ（`.element-chip`、`:512`。出るのはパル詳細だけ: `ui/pal-icon.js:60-63` → `views/pal.js:17`）の白文字 12px 太字は、無 4.13・炎 4.17・氷 4.25・水 4.34・雷 4.47:1。
- 部品の間隔: `.field` は gap 4px＋ラベルの margin-bottom 4px で 8px（`:390-391`）、`.picker` は `position: relative` だけ（`:392`）でラベルの margin の 4px しか空かない。個別にラベルの margin を 0 にしている所が `:387・687・914・1074`。select は OS の ▼、パル選択は線の ∨（`:413-424`）。パッシブの ×（`.passive-remove`、`:1200`）は padding 0 2px・16px で約 12×20px（WCAG 2.5.8 の 24×24px より小さい）。チップの min-height は 32px（`:1104`）。
- 状態の印がばらばら: `.unread-chip`（`:367-374`。角 4px の primary の塗り）、`.warning-chip`（`:663-671`。削除済み。角 8px・margin-top 10px）、`.wishlist-status`（`:702-711`）、`.owned-auto-state`（`:843-845・1084`。文字の色だけ）、`.owned-world-state`（`:861-862`。文字の色だけ。`views/owned-settings.js:335-339` が className を直接書き換える）、`.ideal-changed`・`.ideal-placed`（`:1042-1046`）、`.ideal-goal-status`（`:1082-1083`。文字の色だけ）。テストは `.unread-chip`（`test/web/app.test.js:450`、`test/web/notifications.test.js:190`）・`.ideal-changed`（`test/web/ideal-view.test.js:541・563・581・604・615`）・`.owned-world-state`（`test/web/owned-view.test.js:388・389・398`）をクラス名で探す。
- 押せないボタン: `button:disabled { opacity: .55; cursor: default; }`（`:115`）だけで、塗りのボタンは「薄い緑のボタン」に見える。理由も出ない（下書きの行の「登録」`views/drafts.js:131`、一括登録・一括削除 `:208-209`）。理想個体の登録だけは placeholder で理由を出す（`views/ideal.js:287-289`）。`test/static/styles.test.js:5-13` が `button:disabled` のルールに `cursor: default` があり、`button[aria-busy="true"]` がその後にあることを確かめる。
- アイコンの定義が 4 か所: `ui/nav-icons.js:2-12`（PATHS）、`ui/breeding-card.js:5-8`（icons）と `:10-18`（svgIcon）、`ui/notifications.js:5`（BELL）、`app.css:1234-1241`（ロゴの菱形の data URI のマスク）・`:1361-1362`（チェックの ✓）。線の太さは ナビ 2（選択中 2.5、`:1312`）・ベル 1.8（`:323`）・カード 1.7（`:564`）。閉じる「×」は `ui/dialog.js:11`（20px）・`ui/pal-picker.js:22`（18px）・`ui/passive-picker.js:22`（16px）で大きさがばらばら。`test/web/owned-view.test.js:365` はダイアログのボタンの文字 `['×', 'キャンセル', '保存']`、`test/web/pal-picker.test.js:152` は `clear.textContent === '×'` を確かめる。
- ロゴ・ファビコン: `web/favicon.svg` は #067b70 の角丸に白い菱形（線 3）の固定の色。ヘッダーのロゴは同じ菱形を data URI のマスクで別に持ち（線 4、`app.css:1234-1241`）、中身の「◇」（`app.js:90`）を `font-size: 0`（`:209`）で隠しているだけなので、リンクの名前に読まれる。
- data/SOURCES.md の「画像の扱い」（`:65-70`）は、ゲームの実物の例外だけを書いている。

### 実装の手順

1. **性別の色のトークン**（`web/css/app.css`）
   - `:root` に `--gender-male: #1b6ca8; --gender-female: #c0306a; --on-gender: #ffffff;`、ダークのブロックに `--gender-male: #7cc4ff; --gender-female: #ff8cc6; --on-gender: #0c171a;`。
   - 計算した比（WCAG の相対輝度の式）: ライトの ♂ #1b6ca8 は白に 5.59・#f3f7f4 に 5.17、♀ #c0306a は白に 5.42・#f3f7f4 に 5.02。ダークの ♂ #7cc4ff は #1a2b30 に 7.82・#111e22 に 9.08、♀ #ff8cc6 は #1a2b30 に 6.86・#111e22 に 7.97。実装したら、ブラウザの開発ツールのコントラストの表示でもう一度確かめる。
   - `.gender-M { color: var(--gender-male); }`・`.gender-F { color: var(--gender-female); }`。
2. **genderMark()**（`web/js/ui/pal-icon.js`）

   ```js
   /** 性別の印。文字の ♂♀ を色の丸い地に置く（inline: true なら色だけ。文の中に置くとき） */
   export function genderMark(gender, { inline = false } = {}) {
     if (gender !== 'M' && gender !== 'F') return null;
     const mark = el('span', `gender gender-${gender}${inline ? ' gender-inline' : ''}`, gender === 'M' ? '♂' : '♀');
     mark.setAttribute('role', 'img');
     mark.setAttribute('aria-label', gender === 'M' ? 'オス' : 'メス');
     mark.title = gender === 'M' ? 'オス' : 'メス';
     return mark;
   }
   ```

   - CSS: `.gender:not(.gender-inline) { display: inline-grid; place-items: center; inline-size: 18px; block-size: 18px; border-radius: 50%; color: var(--on-gender); font-size: 12px; }`、`.gender-M:not(.gender-inline) { background: var(--gender-male); }`・`.gender-F:not(.gender-inline) { background: var(--gender-female); color: var(--on-gender); }`（地の色は上のトークン。ライトの白い文字は ♂ の地に 5.59・♀ の地に 5.42、ダークの #0c171a の文字は ♂ の地に 9.71・♀ の地に 8.51）。
   - palTile（`:73`）と `views/owned.js:33-36` を `genderMark(...)` に置き換える（クラスと textContent は今と同じなので、テストはそのまま通る）。理想個体の文の中の ♂♀（`views/ideal.js:75`・`:398`。ideal-results・ideal-farms で DOM の部品になっていれば）は `genderMark(gender, { inline: true })` で色だけ付ける。文字列のままなら変えない。
3. **コントラスト**（`web/css/app.css`）
   - ライトの `--md-sys-color-outline` を `#6f8a84`（#f3f7f4 に 3.44・白に 3.72）。ダークの `#5f7c79`（`:94`）は #111e22 に 3.77・#1a2b30 に 3.24 で基準を満たすので変えない。セカンダリボタンの枠が強すぎて見えたら、ボタンの枠だけ中間の色にしてよい（ライトとダークで撮って決める）。
   - 属性チップだけの色: `.element-chip { background: var(--element-chip, var(--element, var(--Neutral))); }` とし、5 色に `--element-chip` を足す: 無 `#70747e`（白に 4.68）・炎 `#c54e34`（4.65）・水 `#237ab4`（4.65）・雷 `#907109`（4.61）・氷 `#238089`（4.65）。草・地・闇・竜は今の色で 4.5:1 以上（4.70〜5.47）。`--Neutral` など元の変数は変えない（`.pal-avatar` が使う）。
   - `.equation-symbol`（`:537`）の色を `var(--md-sys-color-on-surface-variant)`（白に 5.02・#f3f7f4 に 4.64）。
4. **部品の高さ・間隔・開閉の印・×**（`web/css/app.css`）
   - `.picker { display: flex; flex-direction: column; gap: 4px; }`、`.field-label` の `margin-bottom` を 0 にし（`.field` の gap 4px だけにする）、個別の上書き（`:387`、`:687`、`:914`、`:1074`）を消す（`:686` の `.list-filters .field` の `margin-bottom: 0` は残す）。`.pair-selection` は subgrid（`:384`）なので、ずれないか画面で確かめる。
   - select の開閉の印をパル選択と同じ ∨ に: `select { appearance: none; padding-right: 36px; background: no-repeat right 12px center / 12px url("data:image/svg+xml,…stroke='%235b7471'…"); }`、ダークは `stroke='%23b1c7bf'` の別の data URI（data URI の SVG は currentColor を使えないため、色ごとに持つ）。CSP は `img-src 'self' data:` なので使える。高さは 40px（今の `min-height: 40px`、`:122`）のまま。
   - `.passive-remove`（`:1200`）を 24×24px の丸いボタンに: `display: inline-grid; place-items: center; inline-size: 24px; block-size: 24px; border-radius: 50%; padding: 0;`、ホバーで `background: color-mix(in srgb, currentColor 12%, transparent)`。チップの min-height 32px に収まる。
5. **状態チップを 1 部品に**
   - `ui/dom.js` に `export function statusChip(text, tone = 'neutral', className = '')`（`<span class="status-chip is-{tone} {className}">`）。tone は `ready`（tertiary-container）・`warning`（warning-container）・`error`（error-container と on-error-container）・`info`（secondary-container）・`neutral`（surface-container-highest）。
   - CSS: `.status-chip { display: inline-block; border-radius: 4px; padding: 1px 8px; font-size: 11px; font-weight: 700; line-height: 1.6; white-space: nowrap; }` と tone ごとの色。今の個別の見た目のルール（`.unread-chip`・`.warning-chip`・`.wishlist-status`・`.owned-auto-state`・`.owned-world-state`・`.ideal-changed`・`.ideal-placed`・`.ideal-goal-status` の色・角・余白）は消す。**クラス名は第 3 引数で残す**（テストと、画面の中の探し方を壊さない）。
   - 置き換え（tone）: 未読（`ui/notifications.js:19`）→ info、削除済み（`ui/breeding-card.js:51`）→ warning、ウィッシュリストの「作成可能」→ ready・「まだ作れません」→ neutral、理想個体の「完成済み」→ ready・「未完成」「未確認」→ neutral、「変更あり」→ warning、「〈拠点〉に配置中」→ info、設定の「配合の自動登録: オン」→ ready・「オフ」「対象外」→ neutral（`views/owned-settings.js:335-339` の `className` の書き換えは、tone のクラスを付け替える形に）、読み込みの状態（`owned-auto-state`）の「読み込み済み」→ ready・「許可が必要」→ warning・「エラー」「登録なし」→ error・「確認中…」→ neutral。
   - 組の種類のタグ（`.ideal-tier`）と所持パルのバッジ（ラッキー・アルファ・タマゴ）は状態ではないので、ここでは変えない。
6. **押せないボタン**
   - `web/css/app.css:115` を M3 の無効の見た目に: `button:disabled { cursor: default; color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent); }`（`opacity` はやめる。`cursor: default` は残す＝`test/static/styles.test.js` の決まり。`button[aria-busy="true"]` のルールはこの後に置いたまま）と、塗り・枠のあるボタンだけ `:is(.button.primary, .button.secondary, .button.danger, .register-button):disabled { background: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent); border-color: transparent; box-shadow: none; }`。アイコンのボタン・quiet のボタンは文字の色だけ。
   - `ui/dom.js` に `export function setDisabled(node, disabled, reason = '')`: `disabled` を切り替え、押せないときは `title = reason`、押せるときは `title` を消す（同じ場所で一緒に変えて、古い理由が残らないようにする）。
   - 使う所: 下書きの行の「登録」（`views/drafts.js:131`。「親1・親2・子を選ぶと登録できます」）、一括登録・一括削除（`:208-209`。下書きがないとき「下書きがありません」、一括登録の途中「登録しています」）、理想個体の保存（ideal-panel の「目標として保存」。目標がないとき「目標のパルを選ぶと保存できます」、保存済み「同じ条件の目標があります」）、パッシブの追加が上限（popovers の部品。「最大 4 個まで」）。`runButton` の処理中（aria-busy）は理由を出さない。
7. **アイコンを `ui/icons.js` に**
   - 新しく `web/js/ui/icons.js`:

     ```js
     // アイコンの定義。24px の格子・線・角丸の線画で描き、色は文字色（currentColor）。要素は createElementNS で作る（HTML 文字列は使わない）
     export const ICONS = { search: [...], …（ナビの 9 個）, edit: [...], remove: [...], bell: [...], close: ['<path d="M6 6l12 12M18 6 6 18"/>'] };
     export function icon(name, { className = 'icon' } = {}) // svg（viewBox 0 0 24 24・aria-hidden・fill none・stroke currentColor・round）を返す
     ```

     - パスの書き方は今の `nav-icons.js` の PATHS（`<tag attr="…"/>` を `shape()` で解釈して `createElementNS` で作る）に合わせ、`shape()` も icons.js に移す。線の太さは CSS で決める（新しいアイコンは 2 にそろえる。ベル 1.8・カード 1.7 も 2 にしてよいが、画面で太く見えないか確かめてから）。
   - `ui/nav-icons.js` の `navIcon(view)` は `icon(view, { className: 'tab-icon' })` を返すだけに。`ui/breeding-card.js` の `icons`・`svgIcon` は icons.js の名前を使う形にする（`actionIcon(label, name, action, className)`。呼んでいる所 `views/ideal.js:335` なども合わせる）。`ui/notifications.js` の `BELL` は `icon('bell')`。
   - 閉じる「×」を SVG に: `ui/dialog.js:11`、`ui/pal-picker.js:22`、`ui/passive-picker.js:22`、delete-undo のトーストの閉じるボタン。中身を `icon('close')` にし、`aria-label` はどれも付ける（dialog は「閉じる」、pal-picker は今の「〈ラベル〉の選択を解除」、passive-picker は今の「〈パッシブ〉 を外す」）。大きさは CSS で 20px にそろえ、押せる範囲は 24×24px 以上。
8. **ファビコンとロゴ**
   - `web/favicon.svg`: 2 つの path に class（`bg`・`mark`）を付け、`<style>@media (prefers-color-scheme: dark){.bg{fill:#65d7bc}.mark{stroke:#102f2e}}</style>` を足す（SVG の中の style は CSP の影響を受けない。ブラウザによっては、テーマを変えてもすぐには替わらない）。
   - ヘッダーのロゴの span（`app.js:90` の `el('span', 'brand-mark', '◇')`。header-frame の後はその場所）の中身を空にし、`aria-hidden="true"` を付ける。見た目はマスク（`app.css:1234-1241`）のまま。
   - ロゴの描き直し（Codex の画像生成で下絵を作り、手で SVG に起こす）は任意。やるなら、Codex を使う目的を説明して許可を取り、下絵は web/ の外（scratchpad など）に置いて配信しない。形を変えるときに、マスクを `web/img/brand-mark.svg` に移して data URI の重複をなくす。
9. **画像の作り方の表**（`data/SOURCES.md` の「画像の扱い」`:65-70`）
   - 次の表を足す（案の ID は書かない）:

     | 置き場所 | 作り方 |
     |---|---|
     | ファビコン・ヘッダーのロゴ | 手描きの SVG（アプリ独自の印。ゲームのロゴやパルスフィアは使わない）。Codex の画像生成は下絵にだけ使ってよい |
     | レールのアイコン・閉じるなどの記号 | 手描きの SVG（`web/js/ui/icons.js`。24px の格子・線 2・currentColor） |
     | 空の状態の絵 | 新しく描かない。そのタブのナビのアイコン |
     | 図鑑の未登録の影 | パル画像（実物の webp）に CSS の filter |
     | 属性・作業適性・ケーキ・タマゴ・牧場・性別 | ゲームの実物を取り出せたら使う。それまでは今の文字の表示（手描きで似せた絵は作らない） |
     | 性別 | 文字の ♂♀ と色のトークン（--gender-male・--gender-female） |
     | パル画像・パッシブの画像・人間のアイコン・代わりのアバター | 今のまま（上の節のとおり） |

   - 1 行を添える:「Codex の画像生成で作った画像は、配信する画像には使わない（ゲームの実物と並べると絵柄が浮き、ライトとダークで色も変えられないため）。」

### 触るファイル

- 新規: `web/js/ui/icons.js`、`test/web/icons.test.js`
- 変更: `web/css/app.css`、`web/js/ui/pal-icon.js`、`web/js/views/owned.js`、`web/js/views/ideal.js`、`web/js/ui/dom.js`、`web/js/ui/notifications.js`、`web/js/ui/breeding-card.js`、`web/js/views/wishlist.js`、`web/js/views/owned-settings.js`、`web/js/views/drafts.js`、`web/js/ui/nav-icons.js`、`web/js/ui/dialog.js`、`web/js/ui/pal-picker.js`、`web/js/ui/passive-picker.js`、`web/js/ui/toast.js`、`web/js/app.js`、`web/favicon.svg`、`data/SOURCES.md`、`web/js/release-notes.js`
- テスト: `test/static/styles.test.js`、`test/web/owned-view.test.js`、`test/web/pal-picker.test.js`、（必要なら）`test/web/breeding-card.test.js`

### テスト

- 追加
  - `test/static/styles.test.js`: `--gender-male`・`--gender-female` がライトとダークの両方にある。`.gender-F` が `--danger`・`--md-sys-color-error` を使っていない。属性チップの 5 色に `--element-chip` がある。`button:disabled` に `opacity` がなく、`cursor: default` はある（今の決まりも残す）。
  - `test/web/icons.test.js`（新規）: `icon(name)` が `createElementNS` で svg を作り、知らない名前は空の svg（または例外にしない）。ナビの 9 個・edit・remove・bell・close がある。
  - `genderMark`: role=img・aria-label「オス」「メス」・textContent ♂♀・クラス `gender gender-M`。`inline: true` で `gender-inline`。
  - `statusChip`: tone のクラスと、残したクラス名。
  - `setDisabled`: 押せないときだけ title に理由。
- 期待値が変わる既存のテスト
  - `test/web/owned-view.test.js:365`（ダイアログのボタンの文字 `['×', 'キャンセル', '保存']`）→ 1 つ目は文字ではなく aria-label「閉じる」で確かめる。
  - `test/web/pal-picker.test.js:152`（`clear.textContent === '×'`）→ aria-label で確かめる。
  - `.unread-chip`・`.ideal-changed`・`.owned-world-state` を探すテスト（`app.test.js:450`、`notifications.test.js:190`、`ideal-view.test.js:541` ほか、`owned-view.test.js:388・389・398`）は、クラス名を残すので変わらない。
  - 性別の `.gender` の textContent を確かめるテスト（`breeding-card.test.js:72・77`、`route-view.test.js:29`、`views.test.js:47`、`owned-view.test.js:177`）は変わらない。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: 関係なし（ゲームの画像も配合の情報も使わない）。
- **互換**: クラス名を残すので、ほかのテーマ・テストの探し方は壊れない。
- **セキュリティ**: アイコンは `createElementNS` で作る（`innerHTML` を使わない）。select の印は CSS の data URI（CSP の `img-src 'self' data:` の範囲）。favicon の style は SVG の中だけで効く。
- **アクセシビリティ**: 性別の色・入力欄の枠・属性チップ・式の記号が WCAG の基準を満たす（上の計算値）。× の押せる範囲は 24×24px 以上。押せないボタンに理由。
- **性能**: 影響なし。

### release-notes の案

```js
{
  id: '<実装日>-visual-parts', date: '<実装日>', title: '性別とボタンを見やすく',
  body: '♂♀の色を見分けやすくし、押せないボタンは理由が分かるようにしました。',
},
```

title 11 字・body 35 字。

### 完了の条件

- [ ] `npm test` が通る。
- [ ] モックでライトとダークの両方を撮り、所持パル・理想個体・配合カードの ♂♀ が丸い地で見分けられ、♀ がごみ箱の赤と違う色。ダークの ♂ が沈んで見えない（`Claude outputs/l-dark-rows.png` と比べる）。
- [ ] 入力欄・パル選択の枠がはっきり見え、同じ行の select とパル選択の上端がそろう（`Claude outputs/ui-audit-2026-10/shots/owned/30-ideal-empty.png`・`01-owned-default.png` と比べる）。select の印がパル選択と同じ ∨。
- [ ] パッシブのチップの × を押しやすい（24×24px）。
- [ ] 状態の印（未読・削除済み・作成可能・完成済み・変更あり・配置中・自動登録 オン/オフ・読み込みの状態）が同じ形のチップ。
- [ ] 押せないボタンが灰色で、マウスを乗せると理由が出る。
- [ ] ダークのタブでファビコンが明るい地になる。読み上げでロゴのリンクに「◇」が読まれない（アクセシビリティのツリーで確かめる）。
- [ ] data/SOURCES.md の表を読み、案の ID や古い記述がない。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: セキュリティ — アイコンは createElementNS（`test/static/security.test.js`）。select の印の data URI は今の CSP の範囲で、CSP を変えていない。配信する画像に Codex の生成画像を使っていない（判断事項 5）。互換 — クラス名を残し、ほかのテーマ・テストの探し方が壊れない。INV-2・性能 — 対象外。

### TODO

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

---

## コードで確かめた結果、統合プラン・案と違っていた点（まとめ）

書くときに HEAD `c5c0683` のコードを開いて確かめた。統合プランの file:line（`views/ideal.js:143・374`、`views/owned-settings.js:224・302・389-395`、`views/ideal.js:506`、`views/owned.js:229`、`ideals.js:72`、`auto-register.js:197-208・228・294`、`ui/notifications.js:54・89`、`app.css:617`、`views.test.js:54-67`、`router.test.js:22-25`）はすべて合っていた。違っていた点・この文書で決めた点は次のとおり（各テーマの「経緯」にも書いた）。

| テーマ | 統合プラン・案 | コードで確かめたこと | この文書での扱い |
|---|---|---|---|
| participant-self | 行き先は `#/settings?world=<id>&open=auto` の 1 つ | 「このワールドでの自分」はワールドの行の外（状態欄）に置き、未設定の登録者の select はワールドの行の中にある。参加者は登録したワールドの行がないこともある | URL は 1 つのまま、フォーカスの先の順番（自分の select → 未設定の登録者 → 自動登録のチェック → 見出し）を決めた |
| participant-self | 状態欄（`dl`）に select | 状態欄は描くたびに `replaceChildren` で作り直す（`owned-settings.js:394`）ので、中に select を置くとフォーカスと開いた選択肢が失われる | 状態欄の直後に、作り直さない行として置く |
| autoreg-success | 本文「A♂×B♀ → C（拠点 1）」 | 同じフェーズの copy-dead-ends で親の組の記号を「＋」にそろえる | 「A♂＋B♀ → C（拠点 1）」 |
| autoreg-success | （D-01）行き先 `#/list?sort=updated` | 一覧はフェーズ 2 で「配合を探す」に統合される | 該当の組の `#/search?p1=&p2=`（F023 と同じ） |
| cleanup-dead-code | 「強み・類似ツールとの対応表を文書化」 | 案 X-27 の判断は「対応表は作らない」（案 ID の参照が多く、すぐ古くなる） | 統合プランを優先し、案 ID を書かない小さな表（調査日と版つき）にした |
| cleanup-dead-code | （F087）`preview/design/shared/preview.js` の ICONS も消す | 確かに使われていない（`app.js:109-111` が先に SVG を入れる）が、統合プランに入っていない | 触らない（preview は配信物ではない） |
| cleanup-dead-code | — | `core/ideal.js:125` の `talentExpectation` も web から使われていない（テストだけ） | 統合プランにないので残す（気づいた点として記録） |
| cleanup-dead-code | 性能テストの `:54・59` を idealPlan で測り直す（I-62 の事実確認） | idealPlan に切り替えると `:56`・`:62/63` と同じ測り方になる | 消して、`measure` を idealPlan だけにする |
| cleanup-dead-code | ideal.test.js の idealPairs のテストを idealPlan へ移す | 「欲しいパッシブがそろわない組は出さない（total 0）」など、idealPairs だけの意味のテストがある（idealPlan はそういう組もパッシブ厳選組・個体値厳選組に並べる） | 値が共通のもの（候補の数・確率・世代の平均など）だけを移し、意味が違うものは消す。消す前に一時スクリプトで値を比べる |
| copy-dead-ends | 用語表「生まれる」 | web/js で「産まれ」28 か所・「生まれ」6 か所（画面は 3 か所）。理想個体・自動登録も「産まれる」 | 「産まれる」にそろえる（用語表の「生まれる」は項目名と読んだ） |
| copy-dead-ends | （G-55 の判断）「新しいバージョン」→「新しい版」 | プロジェクトの CLAUDE.md と `version.test.js:135・137` が「新しいバージョン」を前提にしている | 規約ファイルを変えないよう「新しいバージョン」にそろえる（`update-banner.js:38` を直す） |
| copy-dead-ends | （C-05）画面の呼び名を「名前」に | G-51 の判断はログインのラベルを「ID」、決定事項 D7 は「ログイン ID」 | 「ID」にそろえる（設定の「名前を変更」も「ID を変更」）。違う判断にするなら実装前にユーザーに確かめる |
| copy-dead-ends | 文言のテストを作る（統合プラン）／作らない（G-55 の判断） | 禁止語を探すと、コメントや内部の文字列を誤って拾う | コメントを除き、決まった言い回しだけを調べる `test/static/wording.test.js` を作る（release-notes は除外） |
| copy-dead-ends | 「設定タブの〜」は 7 か所 | 画面に出るのは 8 か所（`owned-status.js:47・51・75`、`ideal.js:143・374・463`、`route.js:121`、`ui/notifications.js:89`）。ほかに `owned.js:433` のエラー文 | 全部を直す（`ideal.js:143・374` は participant-self、ベルの文は通知一覧を開くボタン） |
| copy-dead-ends | （G-30 の判断）光らせたり select へフォーカスを移したりはしない | 統合プランは「該当の行を開いてフォーカス」 | 統合プランのとおりフォーカスする（光らせない） |
| delete-undo | トーストを本文の下中央へ | stable-render は「トーストは右下」を前提に、スナックバーの幅（右下のトーストを避ける）を決めている | スナックバーも下中央・トーストより下にし、スナックバーが出ている間はトーストをその上に積む（`--snackbar-offset`） |
| delete-undo | 下書きの一括削除に元に戻す | `test/web/drafts.test.js:376-395` は「確認中に送信に失敗して戻った下書きは消さない」を確かめる。確認をやめるとこの競合は起きない | テストを消すか、押した時点で見えていた下書きだけを消すことを確かめる形に変える |
| visual-parts | （V-14 の判断）× と ⇄ を SVG に | ⇄ はフェーズ 2 の route-cleanup で消える | × だけを SVG にする |
| visual-parts | （別プランの推奨）「変更あり」は tertiary 系に | このアプリの tertiary は primary と同じで、「作成可能」「完成済み」が tertiary-container を使う | 状態チップでは warning にする |

## フェーズ 1d の終わりのチェックリスト

- [ ] 6 テーマのブランチをすべて `main` に `--no-ff` でマージした（push・配信はユーザーの確認の後）。
- [ ] `npm test` と `npm run test:perf` が通る。
- [ ] `web/js/release-notes.js` に 6 件（各テーマ 1 件。新しい順・title 20 字・body 60 字以内）。
- [ ] 観点別のエージェントと Codex（読み取り専用。事前に許可を取り、シェルが動くか先に確かめる）で、フェーズ 1d の差分をレビューし、指摘を直した。
- [ ] 統合プランの「検証」のシナリオのうち、このフェーズの分を確かめた: 参加者として「このワールドでの自分」を選ぶと、登録済みの目標が「完成済み」になり、選んだ時点の完成は通知されない。その後の共有の更新で新しく完成した目標はベルに出る。
- [ ] 規約ファイル（プロジェクトの CLAUDE.md）は変えていない（設定の「通知一覧」カードの削除と CLAUDE.md:16 の文言の変更はフェーズ 2 の bell）。
- [ ] ユーザーへの報告（変更したファイル・実行したコマンド・画面の確かめ方）。
