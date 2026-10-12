# フェーズ 1a: 土台（実装ドキュメント）

> 2026-10-12 作成。対象はパル配合ノートの画面（`web/`。素の ES Modules・`node --test`）。
> 本文の file:line は、HEAD `c5c0683`（web/ に未コミットの変更なし）のコードを**実際に開いて確かめた行**。実装を始める前に、もう一度開いて確かめること（ほかのテーマが先に入ると行はずれる）。
> 正の順: 統合プランの決定事項（D1〜D8）と判断事項 ＞ このドキュメント ＞ 付録（[appendix/catalog.md](appendix/catalog.md) ほか）。付録の案の「直し」とこのドキュメントが食い違うときは、このドキュメントに従う（プランは案の検証の後に、別プランとの突き合わせ・ユーザーの決定・Codex の 7 回のプランレビューを経て決めたもの）。
> 別担当の [phase-1b-1c-ideal-owned.md](phase-1b-1c-ideal-owned.md) は、このドキュメントの API の名前（`context.update`・`applyRoute`・`syncList`・`--header-h`・`--z-*`・`ui/popover.js`・`passiveSelector().update`）を前提にしている。名前を変えるときは向こうにも書く。

## このフェーズの目的

- 決定 D8（最初は毎日使う画面＝理想個体・所持パルの安定化。タブ構成の整理はその後）のための**土台**を先に入れる。1b（理想個体）・1c（所持パル）・1d・フェーズ 2〜3 が使う共通の仕組みを、使う側より前に用意する（Codex 1 回目 #17「共通部品の整備が利用側の後ろにある」への対応）。
- 入れるもの: 画面を作り直さない遷移の契約／読み戻しの検証／固定ヘッダーと重なり順の変数／差分更新・区切った描画・再計算の省略／位置と条件の保持／ポップオーバーとパッシブ選択の部品。
- あわせて、INV-2 の小さな逸脱（自動登録の通知に配合表の答え「表は X」を出している）を最初に直す。

## テーマの順番（依存の順）

上から順に、1 テーマ＝1 ブランチで入れる（実装は直列。同じファイルを触るテーマが多い）。**このフェーズの前に、テーマ 0 の ideal-calc（[phase-1-0-ideal-calc.md](phase-1-0-ideal-calc.md)。理想個体の計算の修正）を入れる**（2026-10-12 追記）。

| # | テーマ（ブランチ `feature/<key>`） | 短い名前 | 工数 | 先に終わっているべきテーマ | 主に触るファイル |
|---|---|---|---|---|---|
| 1 | **inv2-notice** | 自動登録の通知から配合表の答えを外す | S | なし | auto-register.js |
| 2 | **render-contract** | 同じ画面なら作り直さない遷移の契約 | M | なし | app.js・router.js・views/shared.js・views/{search,reverse,route,ideal,owned}.js |
| 3 | **data-boundary** | 読み戻しの境界の共通の検証 | M | なし | 新規 core/boundary.js・core/owned.js・owned.js・api.js・store.js |
| 4 | **header-frame** | 固定ヘッダー・状態・ID・重なり順の変数 | M | なし（順番だけ） | app.js・app.css・新規 ui/save-status.js・ui/sync-status.js・ui/account-menu.js |
| 5 | **stable-render** | 差分更新・区切った描画・再計算の省略・ずれの解消 | L | render-contract・header-frame | ui/dom.js・store.js・core/ideal.js・views/*・新規 ui/slice.js・ui/virtual-list.js |
| 6 | **keep-state** | 位置と条件の保持・フォーカスの一般化 | M | render-contract・data-boundary・stable-render | app.js・新規 ui/focus.js・ui/view-memory.js |
| 7 | **popovers** | ポップオーバーの共通化・パル選択・パッシブ選択 | M | render-contract・header-frame・keep-state | 新規 ui/popover.js・ui/pal-picker.js・ui/passive-picker.js・views/* |

```
inv2-notice（独立）
render-contract ──┬──────────────┬─→ stable-render ─→ keep-state ─→ popovers
data-boundary ────┼──────────────┘        ↑                ↑            ↑
header-frame ─────┴──（--z-*・下端のスナックバー）──┘   （data-focus-key）  （--z-popover）
```

## フェーズ共通の決まり

### 進め方（統合プランの「実装の進め方」から）

1. **フェーズ 0 を先に片付ける**: `.gitignore` の扱い（0-2）と `docs/ui-refactor/` のコミット（0-3）は、2026-10-12 に済んだ（`.mso/`・`.playwright-cli/`・`Claude outputs/` は `.gitignore` で無視。README の「8-2」）。残りの確認（0-1・0-4〜0-8）を済ませてから入る。変えたファイルだけを名前で add し、`git add -A` は使わない。
2. 1 テーマ＝1 ブランチ `feature/<key>`（直しは `fix/…`）→ 日本語のコミット → `main` へ `--no-ff` でマージ。push と配信はユーザーの確認の後。
3. 1 テーマの手順: このドキュメントの節を読む → 現状のコードを開いて確かめる → 振る舞いが変わる所はテストを先に直す・足す → 実装 → `npm test` → モックで画面を確かめ、基準の計測を取り直す → `web/js/release-notes.js` の先頭に 1 件。
4. フェーズの終わりに `npm run test:perf`、観点別のエージェントと Codex（読み取り専用）で差分をレビューし、直してから 1b へ。Codex を使う前に、目的を説明してユーザーの許可を取る（グローバルの決まり）。この環境では Codex のシェルの起動が失敗したことがある（ファイルの読み取りは node_repl で行えていた）ので、先に小さく試す。
5. フェーズの区切りで報告（変更したファイル・実行したコマンド・画面の確かめ方）。

### 全テーマ共通の受け入れ条件（統合プランから）

- **INV-2**: 配合の候補は登録済みの記録だけから引く。配合表（`web/data/breeding.js`）と理想個体の仕組み（`core/ideal.js`）を読み込める場所は、今のテスト（test/import.test.js:27-44）の制限のまま。配合表を読むのは auto-register.js だけ、`core/ideal.js` を import するのは views/ideal.js だけ。
- **セキュリティ**: innerHTML・outerHTML・insertAdjacentHTML・document.write と、style 属性の文字列（`style="…"`・`setAttribute('style', …)`）は使わない（test/static/security.test.js:15-22）。SVG は `document.createElementNS`、名前や説明は `textContent`、動的な値は `style.setProperty('--x', …)`。外部の画像・CDN は使わず、CSP（web/index.html）は緩めない。
- **保存データ**: 新しく保存・共有する値は data-boundary（テーマ 3）の検証を通す。古い IndexedDB・古い共有データ・古い通知・古い sessionStorage・旧コードのまま開いているタブが混ざっても壊れない。
- **性能の予算**（Chrome で測る）: 所持パル 2,000 行で最初の 200 行が 100ms 以内・全行が 1 秒以内、所持パルの画面の DOM は 80,000 ノード以下・JS ヒープの増加は 150MB 以下。2,000 行を超えたら見えている範囲だけ描く形に切り替え、20,000 行・偏った種族の分布でも入力が 100ms 以上止まらない。予算を超えたら、そのテーマを終えずに直す。

### テスト環境の制約（コードで確かめた。実装の形を決めるので必ず読む）

- **テスト用の DOM（test/helpers/dom.js:21-112 の FakeElement）にある API**: `append`・`insertBefore`・`replaceChildren`・`remove`・`contains`・`querySelector(All)`（`.class`・`#id`・`tag`・`[attr]`・`[attr="値"]` だけ。test/helpers/dom.js:5-13）・`setAttribute`/`getAttribute`/`removeAttribute`・`addEventListener`（`signal` で外せる）・`dispatch`・`focus`・`scrollIntoView`（何もしない）・`getBoundingClientRect`（固定値）・`classList.add`/`classList.toggle`・`style.setProperty`/`getPropertyValue`・`children`・`parentElement`・`lastElementChild`・`isConnected`。
  **無いもの**: `classList.remove`/`contains`・`closest`・`dataset`・`matches`・`nextSibling`/`previousSibling`・`replaceWith`・`before`/`after`・`scrollTo`/`scrollBy`。使うなら、`classList.toggle(name, false)`・`getAttribute('data-…')`・`parentElement` をたどる書き方にするか、テスト側のヘルパーに足す（どちらでもよいが、足したらこのドキュメントの該当の節に書き足す）。フォーカスのある要素を外すと body に戻る（:15-19。ブラウザと同じ）。
- **test/web/app.test.js の boot（:21-68）**:
  - `window.addEventListener` は名前ごとに 1 つしか持てない（`events.set(name, handler)`。:38-40）。**app.js に `hashchange`・`storage`・`beforeunload` の 2 つ目のリスナーを足すと、テストでは前の登録が消える**。hashchange はルーター（router.js:41）経由でだけ受ける。新しい名前（`pagehide` など）は足してよい。
  - `window` に `sessionStorage`・`scrollTo`・`scrollY`・`matchMedia`・`requestAnimationFrame`・`ResizeObserver` が無い。`history` は `state` と `replaceState` だけで **`pushState` が無い**（:44-51）。`document.addEventListener` は何もしない（:33）。`setInterval` は記録するだけ（:63-64）。→ 新しいコードは、これらが無くても動く（`typeof … === 'function'` で確かめる、try/catch）。
    - 追記（render-contract の実装、2026-10-12）: boot に `pushState` の引数を足した（`boot(t, { pushState: true })` で `history.pushState` を足す。既定は今までどおり無い）。fake の `replaceState` は渡された state を `history.state` に入れ、boot は `replaceStates`（渡された state）・`pushes`（push した URL）も返す。
- **ビューのテストの context**（test/web/views.test.js:14-20、ideal-view.test.js:40-46、owned-view.test.js:47-51）は `navigate`（と一部 `replace`・`viewState`）だけを持つ。`update` は無い → **ビューは `context.update` が無ければ `context.navigate` に落とす**（render-contract の `changeRoute`）。
- **web/ の中のファイルに「mock」という語を書かない**（コメントも。test/static/security.test.js:34-39）。
- `web/js/core/owned-shared.js` を変えたら `npm run build:gas` で `gas/Shared.js` を作り直す必要がある（test/core/shared.test.js:7-14 が一致を確かめる）。このフェーズでは owned-shared.js を**変えない**設計にした（新しい検証は core/boundary.js に置く）。

### このフェーズで作る共通部品（後のフェーズが使う）

| 部品 | ファイル | テーマ | 形 |
|---|---|---|---|
| 同じ画面の判定 | router.js | render-contract | `sameScreen(a, b) → boolean` |
| 同じ画面なら作り直さない遷移 | app.js の context | render-contract | `context.update(hash, { replace? })` |
| 画面内の遷移の共通口 | views/shared.js | render-contract | `changeRoute(context, hash)` |
| 選択欄の値合わせ・作り直す欄のフォーカス | views/shared.js | render-contract（実装で足した） | `syncPicker(picker, value)`（値が違うときだけ setValue）・`keepFocus(container, render, target)`（keep-state で ui/focus.js に置き換える） |
| ビューの契約 | 各 views | render-contract | `{ element, destroy, applyRoute?(route, { reason }), update?(state) }` |
| 読み戻しの検証 | core/boundary.js（新規） | data-boundary | `int`・`intOrNull`・`text`・`oneOf`・`isoTime`・`list`・`worldId`・`cleanRecords`・`cleanOwnedWorlds`・`cleanOwnedPayload`・`cleanSaved` |
| 高さと重なり順 | app.css の :root | header-frame | `--header-h`・`--z-sticky`・`--z-panel`・`--z-rail`・`--z-header`・`--z-drawer`・`--z-snackbar`・`--z-toast`・`--z-popover`・`--z-skip` |
| セーブ連携の状態 | ui/save-status.js（新規） | header-frame | `saveStatusModel(ownedState, opts)`・`saveStatus(deps) → { element, update, destroy }` |
| 自動登録の設定の購読 | auto-register.js | header-frame | `autoRegister.subscribe(fn) → unsubscribe` |
| キーで使い回す一覧 | ui/dom.js | stable-render | `syncList(container, items, { key, create, empty })`・`clearList(container)` |
| 入力の間引き | ui/dom.js | stable-render | `debounce(fn, ms)`・`onTextInput(input, fn, { delay })` |
| 区切った計算 | ui/slice.js（新規） | stable-render | `startSliced(iterator, { budget, signal }) → { done, value } \| { done: false, promise }` |
| 画面用の変更番号 | store.js | stable-render | `store.state.revision`（数） |
| 見えている範囲だけ描く | ui/virtual-list.js（新規） | stable-render | `visibleRange({...})`・`virtualRows(container, opts)` |
| 並べ替えの動き | ui/motion.js（新規） | stable-render | `withTransition(fn)` |
| フォーカスの引き継ぎ | ui/focus.js（新規） | keep-state | `captureFocus(root) → token`・`restoreFocus(root, token)` |
| 位置と条件の保持 | ui/view-memory.js（新規） | keep-state | `createViewMemory(deps)` |
| ポップオーバー | ui/popover.js（新規） | popovers | `placeFloating(popup, anchor, host)`・`createPopover(opts) → { element, open, close, isOpen, destroy }` |
| パッシブ選択 | ui/passive-picker.js | popovers | `passiveSelector(opts) → { element, update(next), destroy }` |

### release-notes の規則

- 機能の追加・変更・**不具合の修正でも** `web/js/release-notes.js` の先頭に 1 件（プロジェクトの CLAUDE.md）。title 20 字以内・body 60 字以内（web/js/notifications.js:6-7 の `TITLE_MAX`・`BODY_MAX`。test/web/notifications.test.js:39-40 が `String.length` で確かめる）。
- id は `<実装した日 YYYY-MM-DD>-<slug>`（1b・1c と同じ）。一度出したら変えない。各テーマの案の文字数は、テストと同じ `String.length`（`text.length`）で数えた値（このドキュメントの案はすべて数えてある。2026-10-12 の最終確認で数え直した）。

## コードで確かめた結果、プランと違っていた点・このドキュメントで決めた点

1. **render-contract の履歴の扱い**: 統合プランは画面内の条件変更で push か replace かを決めていない（別プラン F064 は replaceState、調査案 G-38 の判断は「今のまま」）。このドキュメントでは **今と同じ「1 選択＝1 履歴」（`history.pushState`）** にした（「戻る」の手応えを変えない・keep-state の「履歴エントリごとに条件を戻す」と合う）。replace にしたいときは `context.update` の 1 か所を変えるだけ。
2. **ログインの切り替えの判定**: 「認証」の比較はログイン中かどうか（in/out）だけにした。ID の名前の変更（store.js:142-146 の onUserIdChange）で作り直すと、条件が消えるため。別の ID でのログインは必ずログイン画面（out）を通るので forget() が効く。
3. **app.test.js の fake の制約**（上の「テスト環境の制約」）: `history.pushState` が無い・`window.addEventListener` が名前ごとに 1 つ。プランには書かれていない。render-contract と keep-state はフォールバックを持つ。
4. **inv2-notice の conflict の子**: conflict の通知の「表は X」の X（`candidate.record.childId`）は、ふつうのタマゴでもタマゴの中身ではなく配合表の子（core/auto-breeding.js:64・72。突然変異タマゴでも表の子: :17-18・:68）。そのため「新しいタマゴは X」とも書けない → **conflict は候補の子を出さず、登録済みの子だけ**を出す。anomaly の「新しいタマゴは X」は観測したタマゴの中身なので残す。
5. **data-boundary の個体値**: プランが挙げた core/owned.js:512（共有）のほかに、**手元のセーブの変換 core/owned.js:185-189 も同じく範囲を見ていない**（`Number(x) || 0`。'Infinity' や 150 が通る）。両方を直す。
6. **data-boundary の置き場所**: core/owned-shared.js に足すと gas/Shared.js の作り直しが要る（test/core/shared.test.js）。→ 新規 core/boundary.js に置き、owned-shared.js の定数を import して GAS と同じ上限にそろえる。
7. **header-frame の範囲**: G-17 の直しにある「設定の『データの状態』カードを消す」は、プランではフェーズ 2 の settings のテーマ。1a ではヘッダーを押して更新できるようにするだけで、カードは残す（app.test.js:490 は設定の「最新に更新」を押している）。
8. **header-frame の ID のメニュー**: 名前の変更の画面（views/settings.js:36 の `openRenameDialog`）は export されていない → ui/account-actions.js に移して共有する。メニューの中身は**開いたときだけ作る**（app.test.js:122・130・348・512・526 が `byText('ログアウト')`・`byText('名前を変更')` で設定の画面のボタンを探すため、常に DOM にあると先にヘッダーのボタンが見つかる）。
9. **X-02（container query）**: header-frame の案の一覧に入っているが、`.app-main` に `container-type: inline-size` を付けると、本文の中の `position: fixed` の要素の基準が本文に変わる（レイアウトの封じ込め）。行の切り替えは 1c の owned-rows で行の作りを変えるときにまとめる方が二度手間がないので、**1a では入れない**（owned-rows に申し送り）。
10. **自動登録の設定に購読の口がない**: プランは「setEnabled の変化で更新」とするが、auto-register.js:332-337 の setEnabled は誰にも知らせない → `autoRegister.subscribe` を足す。
11. **stable-render の理想個体の区切った計算**: 既存の ideal-view のテストは、条件を変えた直後に結果を同期で確かめる。→ 区切った計算は「1 回目の区切り（30ms）で終われば同期で結果を返す」形にする（小さいデータのテストはそのまま通る）。
12. **stable-render の同期バー**: 場所を残して隠すのを `hidden` をやめずに CSS（`.sync-progress[hidden] { display: block; visibility: hidden }`）で行う。app.test.js:278・286・298 の `bar.hidden` の確認がそのまま通る。
13. **keep-state の履歴エントリの状態**: 条件とスクロール位置を毎回 `history.replaceState` で書くと、スクロールのたびに履歴の API を呼ぶことになる。→ history.state には**エントリの ID だけ**を入れ、中身（版・環境・利用者・ワールド・条件・位置）は sessionStorage にエントリ ID ごとに持つ。プランの「history.state に保存」と同じ働き（エントリごと・合わなければ捨てる）。
14. **popovers の S-19**: ウィッシュリストの「追加済み」の印は、ウィッシュリストがフェーズ 2 で目標に統合されるので入れない。
15. 付録の X-09 の根拠「router.js:9（既定は search）」は、実際は router.js:10。

---

## inv2-notice: 自動登録の通知から配合表の答えを外す

### 目的

配合牧場からの自動登録が出す通知（登録を保留した・登録しなかった）の本文から、配合表（breeding.js）の答え「表は X」を外し、**親と理由（と、観測したタマゴの中身・登録済みの記録）だけ**にする。すでに端末に保存されている通知も、読み出すときに同じ形へ直す。

### 経緯

- 調査の案 **D-04**（直しつき）。事実確認で次が分かった。
  - anomaly（牧場の上の新しいタマゴが表と合わない）は**保留ではない**。見たタマゴとして記録され、二度と判定されない（auto-register.js:236-237、core/auto-breeding.js:98）。→ 文は「自動登録しませんでした」。
  - conflict（登録済みと食い違う）は候補が残り、対応や登録が変わったら次の判定でやり直す（auto-register.js:248-252・260-262）。→ 文は「保留」。
  - conflict の子（`candidate.record.childId`）は配合表の子で、突然変異タマゴのときはタマゴの中身とも違う（core/auto-breeding.js:17-18・64・68-72）。
- **Codex 1 回目 #3（高）**: 生成の文だけ直しても、保存済みの通知の「表は X」が残る（auto-register.js:192 が保存した本文をそのまま読み、:353 から通知欄へ渡す）。→ 読み出し時に安全な文へ変換し、旧本文を保存した状態から起動するテストを足す。
- **判断事項 1**: 自動登録の通知・保留に配合表の答えを**出さない**。別プランの F027「予想は X、タマゴは Y」も採らない（統合プランの「本プランの方を残したもの」。配合表の答えを画面に出すので、INV-2 の例外 (a)「照合にだけ使う」に反する）。
- 根拠の規則: data/SOURCES.md:35「画面での表示・検索・候補の提示には使わない」。

### 依存 / このテーマでやらないこと

- 依存: なし（最初に入れる。小さく独立）。
- やらないこと: conflict の通知の href（`#/list`）の付け替え（フェーズ 2 の find-merge）／成功の通知（1d の autoreg-success）／通知の kind の正規化（フェーズ 2 の bell）／自動登録の判定そのものの変更。

### 現状

- auto-register.js:210 `pairText(a, b)` は「親1×親2」（パル名）。
- auto-register.js:211-215 `anomalyNotice`: id `auto-breed:<env>:anomaly:<farmId>:<eggLocalId>`、title「配合の結果が表と違います」、body `「A×B：表は{expected}、新しいタマゴは{actual}」`（expected は breedChild の結果＝配合表の答え。core/auto-breeding.js:64・69）。
- auto-register.js:216-222 `conflictNotice`: title「登録済みの配合と違います」、body `「A×B：表は{candidate.record.childId}、登録は{登録済みの子（・区切り）}」`、href `#/list`。
- auto-register.js:192-195 `readNotices`: 保存した配列を、id の型と旧 id（:20 の LEGACY_NOTICE）だけで絞り、本文はそのまま返す。:353-356 `notices()` → app.js:81 の sources → ベル。
- auto-register.js:198-208 `saveNotices` は、同じ id の通知を足さない・更新しない → 文を直しても、保存済みの通知は旧本文のまま残り続ける（読み出し時の変換が要る理由）。
- 通知の保存先は名前の変更で移る（user-rename.js:41）。移った先でも読み出しの変換が効く。
- 先例: 旧 id の通知を出さない処理（auto-register.js:19-20）と、その起動テスト（test/web/auto-register.test.js:362 付近で localStorage に旧通知を入れている）。

### 実装の手順

1. auto-register.js に、通知の文を 1 か所で組み立てる関数を足す（ほかから import しないので export はテスト用）:

   ```js
   // 配合表の答えは通知に出さない（INV-2。表は照合にだけ使う。data/SOURCES.md）。
   // 出すのは、親・観測したタマゴの中身・登録済みの記録だけ
   export const AUTO_NOTICE_TITLES = Object.freeze({ anomaly: '自動登録しなかったタマゴ', conflict: '自動登録を保留した配合' });
   export const anomalyText = (pair, eggName) => `${pair} のタマゴ（${eggName}）は照合が合わず、自動登録しませんでした`;
   export const conflictText = (pair, registered) => `${pair}：登録済みの配合（子 ${registered}）と食い違うため、保留しました`;
   ```
   - title は 12 字・11 字（`TITLE_MAX` 20 以内）。body はパル名が最長 9 字でも 1 件なら 60 字以内に収まる。登録済みの子が多くて超えた分は cleanNotification（notifications.js:24-32）が「…」で切る（今と同じ）。
2. `anomalyNotice`（:211-215）を `{ id（今のまま）, date, title: AUTO_NOTICE_TITLES.anomaly, body: anomalyText(pairText(...m.parents), palName(m.actual)) }` に。`m.expected` は使わない（core/auto-breeding.js の anomalies の形は変えない）。
3. `conflictNotice`（:216-222）を `{ id, date, title: AUTO_NOTICE_TITLES.conflict, body: conflictText(pairText(p1, p2), 登録済みの子の名前を・で連結), href: '#/list'（今のまま） }` に。`candidate.record.childId` は文に使わない。
4. 読み出し時の変換（純粋関数。export してテストする）:

   ```js
   const OLD_ANOMALY = /^(.+?)：表は.*?、新しいタマゴは(.+)$/;
   const OLD_CONFLICT = /^(.+?)：表は.*?、登録は(.+)$/;
   /** 保存済みの通知を、配合表の答えを含まない文にする（前の版が保存した通知のため）。 */
   export function safeAutoNotice(notice) {
     const kind = /^auto-breed:[^:]*:(anomaly|conflict):/.exec(notice.id)?.[1];
     if (!kind) return notice;
     const body = String(notice.body ?? '');
     const old = (kind === 'anomaly' ? OLD_ANOMALY : OLD_CONFLICT).exec(body);
     const next = old ? (kind === 'anomaly' ? anomalyText(old[1], old[2]) : conflictText(old[1], old[2]))
       : body.includes('表は') ? '' : body;
     return { ...notice, title: AUTO_NOTICE_TITLES[kind], body: next };
   }
   ```
   - `readNotices`（:192-195）の filter の後に `.map(safeAutoNotice)` を足す。data-boundary（テーマ 3）で readNotices に形の検証を足すときは、その後ろに並べる。
5. 保存し直しはしない。読み出すたびに直す（saveNotices は readNotices の結果を before に使う（:200）ので、次に保存するときに新しい文で書き直される）。旧コードのまま開いているタブが旧文を書いても、新しいコードは読み出しで直す。
6. ファイル冒頭のコメント（auto-register.js:1-4）に「通知にも配合表の答えは出さない」を足す。

### 触るファイル

- web/js/auto-register.js
- test/web/auto-register.test.js
- web/js/release-notes.js

### テスト

- **期待値が変わる既存のテスト**（test/web/auto-register.test.js）: :128（conflict の title）・:149（anomaly の title）・:280（conflict の title）・:393-394（title と body の末尾 `/登録はツッパニャン$/` → `/子 ツッパニャン）と食い違う/` など）・:406-407（title。body の `/モコロン/` は親の名前なので通る見込み。確かめる）・:474（anomaly の title）。別プラン §9 の C の auto-register.test.js:235・241・356・406・474 は、:235（未設定の通知）と :356 付近は変わらない見込み。実行して落ちた所だけ直す。
- **追加するテスト**:
  1. 生成した anomaly・conflict の title と body に、配合表の答え（expected、conflict の候補の子のうち登録済みにない名前）が含まれない。突然変異タマゴ（`PalEgg_MutationPal…`）の候補でも同じ。
  2. 旧本文の通知（`{ id: 'auto-breed:test:anomaly:f1:e1', title: '配合の結果が表と違います', body: 'モコロン×ツッパニャン：表はセレムーン、新しいタマゴはフラリーナ' }` と conflict の旧本文）を localStorage の通知のキーに入れて起動 → `notices()` の body に「表は」が無く、親の名前と「フラリーナ」（観測したタマゴの中身）・登録済みの子は残る。id は同じ（既読がそのまま効く）。
  3. 旧形に合わない「表は」入りの本文は、body が空になり title だけ残る。
  4. `safeAutoNotice` の単体テスト（anomaly・conflict・ほかの種類はそのまま）。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: 配合表の子を、どの経路（生成・保存済み・名前の変更で移した通知）でも画面に出さない。anomaly の「タマゴの中身」は観測した事実（セーブに書かれている）なので出してよい。
- **互換**: id を変えない（既読の記録がそのまま効く）。保存の形も変えない。
- **セキュリティ**: 描画は今の textContent のまま（ui/notifications.js）。
- **性能**: 通知は最大 50 件（auto-register.js:16 の NOTICE_MAX）の正規表現だけ。

### release-notes の案

- id: `<実装日>-autoreg-notice-text`
- title: 「自動登録の通知の文を整理」（12 字）
- body: 「保留・見送りの通知に配合表の答えを出さず、親と理由と登録済みの子だけを出します。」（40 字）

### 完了の条件

- [ ] `npm test` が通る（release-notes の文字数を含む）。
- [ ] `grep -n "表は" web/js/auto-register.js` が、旧本文を読む正規表現（OLD_ANOMALY・OLD_CONFLICT と `includes('表は')`）以外で 0 件。
- [ ] モック（`npm run dev` → `http://localhost:5173/?mock=1&seed=40`）で、DevTools から旧本文の通知を `pal-note.local.autoBreeding.notices.test.<ID のキー>` に入れて読み込み直し、ベルの通知に「表は」が出ない。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 生成した通知・保存済みの旧本文の通知・名前の変更で移した通知のどれにも、配合表の子が出ない（上の追加テスト 1〜4）。互換 — 通知の id と保存の形を変えていない（既読がそのまま効く）。セキュリティ — 描画は textContent のまま（`test/static/security.test.js`）。性能 — 対象外（通知 50 件の正規表現だけ）。

### TODO

- [ ] auto-register.js に `AUTO_NOTICE_TITLES`・`anomalyText`・`conflictText` を足す
- [ ] `anomalyNotice` を新しい文にする（expected を使わない）
- [ ] `conflictNotice` を新しい文にする（候補の子を使わない・href は今のまま）
- [ ] `safeAutoNotice` を足し、`readNotices` で通す
- [ ] ファイル冒頭のコメントを直す
- [ ] auto-register.test.js の title・body の期待値を直す（:128・149・280・393-394・406-407・474）
- [ ] 生成した通知に配合表の答えが無いテスト（突然変異タマゴを含む）を足す
- [ ] 旧本文の通知から起動するテストと、`safeAutoNotice` の単体テストを足す
- [ ] release-notes に 1 件足す
- [ ] `npm test`・モックのベルで確かめる

---

## render-contract: 同じ画面なら作り直さない遷移の契約

### 目的

同じ画面の中の URL の変更（パル・パッシブを選ぶ・× で外す・⇄・開始チップ）では画面を作り直さず、ビューが自分で条件と結果を更新する。違う画面・ログインの切り替えのときだけ作り直す。遷移の理由（タブ・画面内の条件変更・戻る/進む）を区別して、keep-state に渡す。

### 経緯

- 調査の案 **G-38**（直しつき）。判断は「まずフォーカスの引き継ぎを足す小さな直しにとどめ、updateRoute は理想個体の 1 画面だけ」だったが、統合プランは**全画面に契約を入れる**と決めた（付録 catalog.md の冒頭の注記のとおり、プランが優先）。理由:
  - **Codex 1 回目 #1（高）**: app.js:259 で毎回 destroy し、:275 で作り直すので、ビューの中で行や select を使い回しても URL の変更をまたいで保てない（差分更新の土台がない）。
  - **Codex 1 回目 #9（中）**: ルーター（router.js:24）は遷移の理由を区別せず、app.js:172 は履歴の state を null で置き換える → タブ操作・画面内の条件変更・履歴の移動を区別し、URL の正規化でも state を保つ。
  - **別プラン F064・§9 P1**: 最初のリリースを基盤にし、`context.update` はルーターと共用の遷移の適用関数で「認証・画面・ID」を比べて更新か作り直しかを選ぶ。ログインの切り替えでは必ず destroy と forget()。画面を作る途中の URL の正規化では描き直さない。ビューは `applyRoute(route)`（条件・部品を最新の route に同期）と `update(state)`（データの描き直し）に分ける。継承ルートにも同じ部分更新を入れる。**P1-1**: 今の `context.replace`（app.js:171-174）は route もビューも更新しない。
- 撮影の計測（付録 measurements.md）: 継承ルートでチップの × を押すとフォーカスが body に落ちる。理想個体で条件を変えると「登録する名前」が消える（G-38 の現状）。
- 吸収した案 S-39（配合検索の部分更新）・I-07（理想個体で URL 遷移による作り直しをやめる）。

### 依存 / このテーマでやらないこと

- 依存: なし。
- やらないこと: スクロール位置・条件の保存と復元（keep-state）／フォーカスの戻し方の一般化（keep-state の G-41）／パッシブ選択の部品化（popovers）／一覧の差分更新・再計算の省略（stable-render）／旧 URL（`#/reverse`・`#/list` など）の読み替え（フェーズ 2）。

### 現状

- app.js:287-290 `startRouter((nextRoute) => { route = nextRoute; render(); })`。render（:252-285）は毎回 `currentView?.destroy()`（:259）→ `views[route.view](context, route)`（:275）→ `main.replaceChildren(...)`（:276）。
- フォーカスの引き継ぎは、作り直す前の `aria-haspopup=listbox`（パル選択）と `.passive-add` の aria-label を覚え、作り直した後に同じラベルの要素へ戻すだけ（:255-258・:277-284）。
- `context.navigate`（:170）は `location.hash = hash`（履歴が 1 件増え、hashchange → render）。
- `context.replace`（:171-174）は `history.replaceState(null, …)` で**履歴の state を null にし**、`remember` だけする（route 変数もビューも更新しない）。
- router.js:24-44 `startRouter` は hashchange を区別しない。旧 k の除去は `replaceState(browser.history.state, …)`（:37）で state を保つ。router.js:10 で知らない view は 'search'。
- views/shared.js:22-27 `navigateSelection` は `context.navigate`。:13-20 `validId` は `route.params` を書き換えて `context.replace`。:40-54 `watchView` は `{ element, destroy }` を返す。
- 画面の中で URL を変える所: views/search.js:13-15（親 1・親 2）、views/reverse.js:10-11（子）、views/route.js:46（selectPal）・:61-66（setPassives）・:83-88（⇄）・:101・107（開始チップ）、views/ideal.js:197（目標）・:357-362（setPassives）。URL を読んで直す所: views/ideal.js:187-195（`g` を読んで外す）、views/owned.js:83-90（holder・place・pal・p を読んで `#/owned` に replace）、views/pal.js:11。
- URL から読む値は生成時の定数: views/search.js:10-11（p1・p2）、views/reverse.js:9（child）、views/route.js:43-45（from・to・passives）、views/ideal.js:178-179（to・passives）。
- ログインの切り替え: store.subscribe（app.js:306-309）でログインの有無が変わると render。ログイン画面に移るとき `forget()`（:266）。

### 設計（契約）

- **ビューが返すもの**: `{ element, destroy(), applyRoute?(route, info), update?(state) }`
  - `applyRoute(route, { reason })`: URL から読む条件（パル・パッシブなど）を変数に入れ直し、部品（ピッカーの `setValue` など）と結果を最新に同期する。**同じ route で 2 回呼ばれても結果が変わらない（冪等）**。URL の正規化（不正な ID を外す・`g` を外す）が要るときは `context.replace` を呼ぶ（描き直しは起きない）。
  - `update(state)`: データ（store・owned）の変化での描き直し（今の watchView のコールバック）。
  - 生成時も `applyRoute(route, { reason: 'create' })` と同じ内部関数を 1 回呼ぶだけにする（「初期化」と「更新」の 2 つの道を作らない。G-38 のリスク）。
  - `applyRoute` を持たないビューは、今までどおり作り直す（views/list.js・drafts.js・wishlist.js・settings.js・pal.js）。
- **遷移の理由 `reason`**: `'boot'`（起動）・`'auth'`（ログインの有無が変わった）・`'navigate'`（`context.navigate`・画面内のリンク）・`'tab'`（ナビのタブ。keep-state が印を付ける）・`'update'`（`context.update`＝同じ画面の条件変更）・`'history'`（印のない hashchange＝戻る・進む・手入力）。
- **同じ画面**: `sameScreen(a, b) = a.view === b.view && a.id === b.id`（パル詳細は id まで比べる。Codex 1 回目 #9）。
- **認証の比較**: ログイン中かどうか（`passcode && userId` の有無）だけ。名前の変更（store.js:142-146）では作り直さない。
- **履歴**: 画面内の条件変更は今と同じ「1 選択＝1 履歴」。`history.pushState` は hashchange を起こさないので、描き直しは `context.update` が直接行う。戻る・進むでは hashchange が起き、ルーター経由で `reason: 'history'` になる。

### 実装の手順

1. **router.js**
   - `export function sameScreen(a, b) { return Boolean(a && b) && a.view === b.view && a.id === b.id; }`
   - `startRouter` の `onChange` に第 2 引数 `{ hash: browser.location.hash }` を渡す（理由はアプリが決める）。test/web/router.test.js:46 の `routes.push(route)` は第 1 引数だけ見るので通る。
2. **app.js（遷移の適用関数を 1 つにする）**

   ```js
   let shownRoute = null;    // 画面に出している route（作り直し・applyRoute の後に入れる）
   let shownAuth = '';       // 'in' | 'out'
   let intent = null;        // 次の hashchange の理由（'navigate' | 'tab'）。1 回使ったら消す
   let booted = false;
   const authKey = () => (store.state.passcode && store.state.userId ? 'in' : 'out');

   startRouter((nextRoute) => {
     const reason = !booted ? 'boot' : intent ?? 'history';
     booted = true;
     intent = null;
     route = nextRoute;
     render(reason);
   });

   function render(reason = 'auth') {
     const needsLogin = !store.state.passcode || !store.state.userId;
     if (showingLogin && needsLogin) return;
     const auth = authKey();
     const reuse = !needsLogin && auth === shownAuth && currentView?.applyRoute && shownRoute && sameScreen(shownRoute, route);
     if (reuse) {
       remember(route);
       markTabs(route);            // 今の :269-274 を関数に
       shownRoute = route;
       currentView.applyRoute(route, { reason });
       return;
     }
     // ここから下は今の作り直し（:255-284）。フォーカスの引き継ぎも今のまま残す（一般化は keep-state）
     ...
     shownAuth = auth;
     currentView = views[route.view](context, route);   // 生成の中で context.replace が route を書き換えることがある
     shownRoute = route;                                // だから生成の後に入れる
     main.replaceChildren(currentView.element);
     ...
   }
   ```
   - store.subscribe（:306-309）の `render()` は `render('auth')`。ログアウト（ログイン画面へ）で `forget()`（今の :266 のまま）。
3. **context の navigate・update・replace**

   ```js
   navigate(hash) { intent = 'navigate'; location.hash = hash; },
   // 同じ画面の条件変更。違う画面・作り直すしかない画面では navigate と同じ
   update(hash, { replace = false } = {}) {
     const next = parseHash(hash);
     if (showingLogin || !currentView?.applyRoute || !sameScreen(shownRoute, next)) { context.navigate(hash); return; }
     const url = `${location.pathname}${location.search}${hash}`;
     if (replace) history.replaceState(history.state, '', url);
     else if (typeof history.pushState === 'function') history.pushState(null, '', url);
     else location.hash = hash;   // pushState の無い環境（テスト）。後で hashchange が来ても applyRoute は冪等
     route = next;
     render('update');
   },
   replace(hash) {
     // 画面を作る途中の URL の正規化（不正な ID を外すなど）。履歴の state は消さない。描き直さない
     history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
     if (showingLogin) return;
     route = parseHash(hash);
     if (shownRoute && sameScreen(shownRoute, route)) shownRoute = route;
     remember(route);
   },
   ```
   - keep-state は `update` の pushState の第 1 引数（state）にエントリの ID を入れる（このテーマでは null）。
4. **views/shared.js**
   - `export function changeRoute(context, hash) { if (context.update) context.update(hash); else context.navigate(hash); }`（ビューのテストの context は update を持たない）。
   - `navigateSelection(context, route, key, value)` の最後を `changeRoute(context, …)` に。**呼び出し側は「今の route」（applyRoute で入れ直したもの）を渡す**。
   - `watchView` の戻り値に `update` を足す（`{ element, update, destroy }`）。
5. **各ビューを「状態 → 描画」の形にする**（生成時も applyRoute を通す）
   - **search.js**: `let current = route; let p1 = ''; let p2 = '';`。`applyRoute(next)`: `current = next` → `p1 = validId(next, 'p1', context)`・`p2 = …` → ピッカーの値が違うときだけ `setValue` → `update(context.store.state)`。ピッカーの onChange は `navigateSelection(context, current, key, id)`。返す値は `{ ...watchView(...), applyRoute }`。
   - **reverse.js**: 同じ形（child）。
   - **route.js**: `from`・`to`・`passives` を `let` に。`applyRoute`: validId（from・to）・passives を読み直す → `toPicker.setValue`・`fromPicker?.setValue` → `update(context.store.state)`（arrange は形が変わるときだけ作り直す今のまま :180）。setPassives（:61-66）・⇄（:83-88）・開始チップ（:101・107）は `changeRoute(context, buildHash('route', params))` で、params は `current.params` から作る。
   - **ideal.js**: `to`・`passives` を `let` に。`applyRoute`: `g` の処理（:187-195）を applyRoute の中へ移す（`g` を読んだら conditions に入れ、`route.params.delete('g')` の後 `context.replace`）→ validId → `toPicker.setValue` → `renderRegister()`・`renderPassives(...)`・`renderResults()`（renderGoals は不要）。setPassives（:357-362）と目標の onChange（:197）は changeRoute。
     - **登録する名前（nameInput :276-279）は作り直さないので残る**（G-38 のいちばんの痛み）。ただし**目標（to）が変わったら `nameInput.value = ''`** にする（前の目標の名前で別のパルを登録する事故を防ぐ。G-38 のリスク「目標が変わったら名前を消すかを決める」への答え）。パッシブだけの変更では残す。
   - **owned.js**: `applyRoute`: URL に holder・place・pal・p のどれかがあれば filter に入れ（今の :83-88）、`renderFilters`・`renderPassives`・`renderResults`、memory があれば `context.replace(buildHash('owned'))`（今の :89）。生成時も同じ関数。
   - pal.js・list.js・drafts.js・wishlist.js・settings.js は変えない（作り直しのまま）。
6. フォーカスの引き継ぎ（app.js:255-258・277-284）は**作り直しの経路に残す**。applyRoute の経路では要素が残るので、フォーカスも残る。
7. コメントを直す: app.js:267（「画面の部品が URL を書き換える…」）・views/shared.js の navigateSelection に「同じ画面なら作り直さない」。

### 境界のケース

| ケース | 動き |
|---|---|
| パル詳細 A → B（同じ view・違う id） | 作り直す（pal に applyRoute なし。あっても id が違う） |
| ログイン画面のときの navigate | 今のまま |
| applyRoute を持つビューから別の view へ | 作り直す |
| update の中で validId が不正な ID を外す | `context.replace` が今の履歴（push した 1 件）を書き換える |
| 戻る・進むで同じ画面の前の条件へ | hashchange → `reason: 'history'` → applyRoute（位置と条件の復元は keep-state） |
| 同じ hash への navigate（表示中のタブをもう一度押す） | hashchange が起きない（今と同じ） |
| テストの fake（pushState なし）で update | `location.hash` に代入。テストが changeHash で hashchange を起こすと同じ route で applyRoute がもう一度呼ばれる → 冪等なので変わらない |

### 触るファイル

- web/js/router.js・web/js/app.js・web/js/views/shared.js
- web/js/views/search.js・reverse.js・route.js・ideal.js・owned.js
- test/web/app.test.js・test/web/router.test.js・test/web/views.test.js・test/web/ideal-view.test.js・test/web/owned-view.test.js
- web/js/release-notes.js

### テスト

- **期待値が変わる既存のテスト**:
  - test/web/app.test.js:302-322（× で URL を変える）: 今は「新しいトリガーにフォーカスを戻す」（:319 `assert.notEqual(trigger, original)`）。作り直さなくなるので、**同じトリガーのまま（`assert.equal(trigger, original)`）でフォーカスも残る**に直す（別プラン §9 の C の app.test.js:319）。
  - test/web/views.test.js:65・86（`app.navigations[0]` を見ている）: context に update が無いので navigate に落ち、今のまま通る見込み。落ちたら期待値を直す。
  - ideal-view.test.js・owned-view.test.js の navigations・replacements を見ているテスト（ideal-view.test.js:385-435、owned-view.test.js:98-135）: 同上。owned-view.test.js:126・131 の `replaced` は今と同じになるはず。
- **追加するテスト**:
  1. app.test.js: `#/search?p1=SheepBall` で親 2 を選ぶ（ピッカーで選んで onChange）→ `main` の子の要素が同じ（作り直していない）・結果のカードが変わる・`location.hash` が新しい URL。
  2. app.test.js: 別の画面（タブ）へ移ると作り直す（`main` の子が別の要素）。
  3. app.test.js: `#/pal/A` → `#/pal/B` は作り直す。
  4. app.test.js: ログアウトで destroy と forget（タブの href が既定に戻る。:324-352 の既存テストの延長）。
  5. app.test.js: `context.replace` が `history.state` を保つ（fake の replaceState に渡る state を記録して確かめる）。
  6. views: search・route・ideal の `applyRoute` を直接呼び、ピッカーの値と結果が変わり、要素は同じ。ideal は nameInput の値がパッシブの変更で残り、目標の変更で消える。`g` つきの route を applyRoute すると条件が入り、replace が呼ばれる。
  7. router.test.js: `sameScreen` の単体テストと、onChange の第 2 引数。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: 変更なし（候補の出どころは変えない）。
- **互換**: URL の形は変えない。履歴の数も今と同じ（1 選択 1 件）。ブックマーク・通知のリンクは今のまま開ける。
- **テスト環境**: app.js に `window.addEventListener('hashchange', …)` を足さない（テストの fake では router の登録が消える）。`history.pushState` は無いことがある。
- **性能**: 理想個体の再計算は applyRoute でも走る（同じ条件なら省くのは stable-render）。作り直しが減るぶん、選ぶたびの DOM の作り直しは減る。

### release-notes の案

- id: `<実装日>-keep-inputs-on-select`
- title: 「選び直しても入力が消えない」（13 字）
- body: 「同じ画面でパルやパッシブを選び直しても画面を作り直さず、入力中の名前や開いた欄を保ちます。」（45 字）

### 完了の条件

- [ ] `npm test` が通る。
- [ ] モック（`?mock=1&seed=80`）の配合検索で親 1 → 親 2 を選んでも、選択欄の要素が同じ（DevTools で `const t = document.querySelector('.picker-trigger')` を覚え、選んだ後に `t === document.querySelector('.picker-trigger')`）。
- [ ] 継承ルートで開始チップ・パッシブのチップの × を押しても `document.activeElement` が body にならない（検証の表「理想個体でパッシブ追加／継承ルートのチップの × → 選択欄・次の要素に残る」の前半）。
- [ ] 理想個体で「登録する名前」を入れてからパッシブを足しても名前が残り、目標を変えると消える。
- [ ] ブラウザの戻る・進むで、前の選択の画面に戻る（位置の復元は keep-state で確かめる）。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 候補の出どころを変えていない（`test/import.test.js` が変更なしで通る）。互換 — URL の形と履歴の数（1 選択＝1 件）が今と同じで、ブックマークと保存済みの通知のリンクが開ける。セキュリティ — `test/static/security.test.js` が通る。性能 — 同じ画面の条件の変更で `main` の中を作り直さない（上のモックの確認）。

### TODO

- [ ] router.js に `sameScreen` を足し、onChange に第 2 引数を渡す
- [ ] app.js の render を「同じ画面なら applyRoute・違えば作り直し」にし、`shownRoute`・`shownAuth`・`intent` を持つ
- [ ] `context.update` を足し、`context.navigate` に intent を、`context.replace` に state の保持と route の更新を入れる
- [ ] views/shared.js に `changeRoute` を足し、navigateSelection と watchView を直す
- [ ] search.js・reverse.js を applyRoute の形にする
- [ ] route.js を applyRoute の形にする（setPassives・⇄・開始チップを changeRoute に）
- [ ] ideal.js を applyRoute の形にする（g の処理を移す・目標が変わったら名前を消す）
- [ ] owned.js の URL の条件の読み込みを applyRoute に移す
- [ ] app.test.js:319 の期待値を直し、作り直さない・作り直す・ログアウト・replace の state のテストを足す
- [ ] views・router のテストを足す
- [ ] release-notes に 1 件足す
- [ ] モックで要素が同じこと・フォーカス・名前・戻る/進むを確かめる

### 実装の記録（2026-10-12、セッション `300704ce`）

実装のときに決めたこと・文書と違う形にしたこと（後のテーマはこちらを正とする）。

1. **フォーカス（手順 6 の直し）**: 手順 6 は「applyRoute の経路では要素が残るので、フォーカスも残る」としていたが、継承ルートの開始チップ（renderStartFilter の replaceChildren）とパッシブの選択欄（継承ルートの renderOwned・理想個体の renderPassives）は update の中で作り直すので、押した要素が消えて body に落ちる（パッシブを足した後に追加欄へ戻る今の動きも、作り直しの経路にある app.js の決め打ちが効かなくなるので失われる）。→ views/shared.js に `keepFocus(container, render, target)`（作り直す欄の中にフォーカスがあって外れたら、target が返す要素へ移す）を足し、開始チップに `data-focus-key`（`start:<palId>`・`start:all`。keep-state の名前と同じ）を付けた。パッシブの欄は作り直した `.passive-add` へ移す。4 個目を足して select が押せなくなったときは、今と同じく body に落ちる（keep-state の group で直す）。**keep-state は keepFocus を ui/focus.js の captureFocus／restoreFocus に置き換える**。
2. **値合わせ**: views/shared.js に `syncPicker(picker, value)`（値が違うときだけ setValue）を足した。同じ値で setValue すると、選んだパルの画像が現れる動き（app.css の `@starting-style`）がもう一度出るため。継承ルートの「他のパル…」の欄（renderStartFilter）で毎回 setValue していたのも、これにした。
3. **生成と applyRoute**: 各ビューは URL を読む `readRoute(next)` を 1 つ持ち、生成時はそれを 1 回呼んでから部品を作る。最初の描画は今のとおり watchView（理想個体は update）が行う（生成時に applyRoute を呼ぶと、理想個体の計算が 2 回走るため）。「生成時も同じ内部関数を 1 回呼ぶだけ」の意図（初期化と更新の 2 つの道を作らない）はこの形で守る。`reason` はビューに渡すが、このテーマでは使わない（keep-state が使う）。返す値は search・reverse が `{ ...watchView(...), applyRoute }`、route・ideal・owned が `{ element, update, applyRoute, destroy }`。
4. **理想個体の g**: 同じ画面のまま g つきの URL が来たとき（一覧・通知の「呼び出す」）は、条件を入れたうえで、個体値・パッシブの条件・ケーキの入力欄も合わせる（`showConditions()`。作り直していた今までは、新しい入力欄が条件をそのまま出していた）。所持者は g で変わらないので触らない。1b の talent-target で個体値の行を部品にしたら、この中の個体値を `talent.update(conditions.targets)` にする。
5. **所持パル**: URL に絞り込み（holder・place・pal・p）が無い applyRoute は何もしない。あるときは絞り込みを入れ、パルの選択欄を syncPicker で合わせ、所持者・場所・パッシブ・一覧を描き直す（キーワードなどの入力欄は触らない）。
6. **context.update と navigate**: 今と同じ URL への update（押されている「すべて」をもう一度押すなど）は何もしない（pushState で同じ履歴が増えるのを防ぐ。今までの location.hash の代入と同じ動き）。navigate は、今と違うハッシュのときだけ intent を付ける（同じハッシュでは hashchange が来ず、印が次の戻る・進むに付いてしまうため）。
7. **テスト**: app.test.js の boot の追記は「テスト環境の制約」のとおり。ビューのテストで context.update の経路を確かめるときは、`ctx.update = (hash) => view.applyRoute(parseHash(hash), { reason: 'update' })` のように小さく組む（ideal-view.test.js・owned-view.test.js のフォーカスのテスト）。

---

## data-boundary: 読み戻しの境界の共通の検証

### 目的

端末や共有から読み戻すデータ（IndexedDB の所持パル・共有の応答と保存したキャッシュ・配合の記録のキャッシュ・localStorage・後で使う sessionStorage・通知）に、共通の検証を入れる。型・有限の整数・範囲・文字数・配列の数・ID の重複を確かめ、**壊れた要素だけを捨てるか既定の値に直し、読める分は表示する**。欠けている値と 0 を区別できる道具と、後から足す項目の既定値の表を用意する。

### 経緯

- 統合プランで新しく足したテーマ（本セッションの調査の案はなし。付録の「（新）」）。
- **Codex 1 回目 #5（高）**: owned.js:108 の IndexedDB の検証はほぼ外形だけ、共有の応答も api.js:84 で配列と worldId の有無を見る程度、core/owned.js:512 の個体値は有限か・範囲内かを見ていない。新しい数値・配列を足すと、壊れたキャッシュによる例外・過大な処理・誤った完成の判定が増える → 読み込みの境界で、型・有限の整数・範囲・文字数・配列の数・ID の重複を検証する共通の変換を設け、欠落と「0」を区別し、新しい項目には旧データ用の既定値を定義する。2 回目のレビューで「解消」。
- 全テーマ共通の受け入れ条件「保存データ: 新しく保存・共有する値は data-boundary の検証を通す。古い IndexedDB・古い共有データ・古い通知・古い sessionStorage・旧コードのタブが混ざっても壊れない」の土台。

### 依存 / このテーマでやらないこと

- 依存: なし。keep-state（このフェーズ）・ideal-farms（1b）・goals-merge（フェーズ 2）・farm-data（フェーズ 3）・save-extras（フェーズ 4）がこの道具を使う。
- やらないこと: 保存の形・キーの変更と移行／GAS 側の検証（core/owned-shared.js の `validateOwnedUpload`）の変更／owned-shared.js の変更（gas/Shared.js の作り直しが要るため）／新しい項目の追加／下書き・理想個体の登録の検証の作り直し（drafts.js の cleanDraft・core/ideal-goals.js の cleanGoal・parseGoals はすでにある）。

### 現状

| 境界 | 今の検証 | 足りないこと |
|---|---|---|
| IndexedDB の手元の所持パル（`<ns>.owned`） | owned.js:108-110 `validData`: version===1・snapshot.pals が配列か | world.id の形（:256 で大文字にするだけ）、importedAt、snapshot の大きさ |
| IndexedDB の共有のキャッシュ（`<ns>.owned.shared.<env>`） | owned.js:112-114 `validShared`: worlds が配列か | worlds の各要素、current（rows）の形 |
| 共有の応答（ownedWorlds・owned・ownedUpload） | api.js:84-94 `validateOwnedResponse`: worlds の各要素の worldId が文字列か、rows・columns が配列か | worldId の形・重複、rows の件数・各行が配列か、セルの文字数、instanceId の重複 |
| 画面用の変換（手元） | core/owned.js:177-189: `Number(x) \|\| 1`・`Number(x) \|\| 0` | 範囲（個体値 0〜100）・有限か（`'Infinity'` が通る）、個体 ID の重複、パッシブの数 |
| 画面用の変換（共有） | core/owned.js:505-512: 同じ | 同じ。players・bases の件数（:519-520） |
| 配合の記録（サーバの応答・localStorage のキャッシュ） | api.js:65-68 `validSnapshot`: records・warnings・users が配列か。store.js:163-169 でキャッシュを読み、:148 で `confirmed = snapshot.records` | 各レコードの形・id の重複・文字数 |
| 既読（`<ns>.notifications.read.<ID>`） | notifications.js:48-52: 文字列だけ残す | 件数の上限 |
| 自動登録の通知（`<ns>.autoBreeding.notices.<env>.<ID>`） | auto-register.js:192-195: id が文字列か | date・title・body・href の形 |
| 自動登録の対応表（`<ns>.autoBreeding.players.<env>.<worldId>`） | auto-register.js:316-319: object か | 値（ノートの ID）の型・長さ、件数 |
| セーブ連携の設定（`<ns>.owned.bridge`） | owned.js:141・161・165・169: worldId だけ 32 桁を確かめ、viewWorldId は文字列か | viewWorldId の形 |
| 通知の正規化 | notifications.js:24-32 `cleanNotification`: id・日時・title・body・href（`#/` だけ） | id・href の長さ |

GAS と画面で同じにしてある上限（そろえる相手）: core/owned-shared.js:16 `OWNED_MAX_ROWS` 20000・:19 `OWNED_MAX_FARMS` 200・:15 skillIds 1000 字、`validateOwnedUpload` の players 100 件・bases 200 件（:57-58）・セル 200 字（:74）・worldName 100 字・hostName 50 字（:83-84）・プレイヤー名 50 字・uid 40 字（:86）・拠点の名前 60 字（:87）。配合の記録は core/validate.js:17（registrant 30 字・memo 200 字）。ノートの ID は 1〜20 文字（app.js:228 の案内）。

### 設計

- 新規 **web/js/core/boundary.js**（DOM なし。import は core/validate.js の `sanitizeText` と core/owned-shared.js の定数・`ownedWorldId`・`cleanOwnedFarms` だけ。GAS には複写しない＝scripts/build-gas.mjs:8 の SHARED_FILES に入れない）。

  ```js
  export const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  /** 有限の整数にして範囲に収める。数にならなければ fallback（欠けている・壊れている）。'12' は 12、12.7 は 12 */
  export function int(value, { min = -Infinity, max = Infinity, fallback = 0 } = {}) { … }
  /** 欠けている（undefined・null・''）なら null、それ以外は int と同じ。「0」と「欠けている」を区別するとき */
  export function intOrNull(value, range) { … }
  /** 文字列だけを受け取り、制御文字を除いて max 字で切る。文字列でなければ fallback */
  export function text(value, max, fallback = '') { … }
  export const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  /** Date.parse できる文字列ならそのまま、でなければ '' */
  export function isoTime(value) { … }
  /** 配列でなければ []。max 件まで。map が null を返した要素は捨てる。key があれば同じ key の後の要素を捨てる（先勝ち） */
  export function list(value, { max = Infinity, map = (item) => item, key } = {}) { … }
  export const worldId = (value) => ownedWorldId(value);   // 32 桁の 16 進を大文字に。違えば ''
  /** schema の項目ごとに、合わない値だけ既定に戻す（G-48 の「版では捨てず、項目ごとの形で捨てる」）。schema: { 名前: (値) => 直した値 } */
  export function cleanSaved(value, schema) { … }
  ```

- **方針**:
  1. 形が根本から違う（配列のはずが配列でない・object でない）→ 今と同じく「データなし」（null）か `RESPONSE` のエラー。
  2. 要素ごとの不正 → その要素を捨てるか、値を既定に直す（良い要素は残す）。
  3. 保存し直さない（読み出すたびに直す）。旧コードのまま開いているタブが書いた値も、読み出しで直る。
  4. 正しいデータでは、結果が今と同じ（テストで確かめる）。
- **項目ごとの既定値の表**（欠けている・壊れているとき。今の値に合わせた。後から項目を足すテーマは、この表に行を足す）

  | 項目 | 範囲・形 | 欠け・不正のとき | 根拠・備考 |
  |---|---|---|---|
  | 個体値 hp・shot・defense | 0〜100 の整数 | 0（今と同じ。目標の判定では「満たさない」側） | core/owned.js:185-189・512 |
  | レベル | 1〜999 の整数（タマゴは 0） | 1 | :177・505 |
  | ランク（rank） | 1〜5 の整数 | 1 | :178・505。stars は今のまま 0〜4（:179・506） |
  | パッシブ | 文字列 64 字・重複を除き最大 16 件 | 空の配列 | 5 個以上は切り詰めない（別プラン F066・core/ideal.js:720 が 5 個以上を別扱い） |
  | 性別 | 'M'・'F'・'' | '' | :176・504 |
  | 個体 ID | 文字列 1〜64 字。重複は先勝ち | その個体を捨てる | 共有は :492-493 で空を捨てている |
  | ニックネーム・名前 | 50 字 | '' | validateOwnedUpload の名前 50 字 |
  | 場所の表示（placeLabel） | 200 字 | PLACE_LABELS の名前 | セル 200 字 |
  | プレイヤー | 最大 100 件・uid 40 字・名前 50 字 | uid が空なら捨てる | owned-shared.js:57・86 |
  | 拠点 | 最大 200 件・id 40 字・名前 60 字 | id が空なら捨てる | owned-shared.js:58・87 |
  | 配合の記録 | 下の cleanRecords | id が無い・重複は捨てる | core/validate.js:17 |
  | 後から足す項目（例: フェーズ 4 の入手時刻） | テーマで決める | `intOrNull` などで「不明」（null）を表す | 欠けと 0 を区別する |

### 実装の手順

1. **core/boundary.js** を作り、単体テスト test/core/boundary.test.js を書く。
2. **画面用の変換**（core/owned.js）:
   - `normalizeOwned`（:140-200）と `ownedFromShared`（:490-516）の数値を `int` で: 個体値（0〜100）・レベル（1〜999、タマゴは 0）・ランク（1〜5）。
   - 個体 ID の重複を捨てる（先勝ち。`Set`）。手元の個体も ID が空なら捨てる（共有は今も捨てている）。
   - パッシブ（:161・:496）: 文字列・64 字・重複を除き・最大 16 件。
   - 文字列の長さ: ニックネーム 50・名前 50・placeLabel 200・所持者の表示（holder）60。
   - players（:203・:519）は最大 100 件、bases（:204・:520）は最大 200 件。
3. **IndexedDB**（owned.js）:
   - `validData`（:108）を `cleanLocalData(value)` に: version===1・world が object・`worldId(world.id)` が 32 桁（違えば null＝データなし。登録したファイルから読み直せる）・importedAt は `isoTime`・source は文字列 20 字・snapshot が object で pals が配列。pals が `OWNED_MAX_ROWS` の 5 倍（100,000 件）を超えたら null（黙って一部を捨てない）。
   - `validShared`（:112）を `cleanSharedCache(value)` に: worlds は `cleanOwnedWorlds`、current は `cleanOwnedPayload`（だめなら null）、fetchedAt は `isoTime`。
4. **共有の応答**（api.js:84-94）: 今の形の確認の後で中身を整える（api.js から core/boundary.js を import する）。
   - ownedWorlds: `response.worlds = cleanOwnedWorlds(response.worlds)`（worldId は 32 桁・重複は先勝ち・最大 200 件、worldName 100 字・hostName 50 字・uploadedBy 20 字・saveUpdatedAt と uploadedAt は `isoTime`、players・bases は上の表、farms は `cleanOwnedFarms`（owned-shared.js:22-33）。farms が無い（undefined・null）なら null のまま＝「牧場の情報なし」を区別する）。
   - owned: `cleanOwnedPayload(response)` で world・columns・rows を整える: rows は最大 `OWNED_MAX_ROWS` 件、配列でない行は捨てる、セルは文字列にして 200 字（skillIds 1000 字）、instanceId（位置は columns から引く）の重複は先勝ち。columns は文字列の配列だけ残す（ownedFromShared は列名で引くので、並びは問わない）。
   - ownedUpload: world を `cleanOwnedWorlds([world])[0]` で。
5. **配合の記録**（api.js・store.js）:
   - core/boundary.js に `cleanRecords(records)`: 要素が object・id が文字列 1〜64 字（違えば捨てる）・id の重複は先勝ち・parent1Id・parent2Id・childId は文字列 64 字（**マスターにない ID も捨てない**: 新しいパルの登録を古い画面で消さない）・性別は 'M'・'F'・''・registrant 30 字・memo 200 字・confirmCount は 0 以上の整数・createdAt・updatedAt は `isoTime`・etag は文字列 200 字。`cleanUsers(users)`: 文字列 1〜64 字・重複を除く・最大 1000 件。warnings: object だけ・最大 1000 件。
   - api.js の `validateResponse`（:70-82）の成功の後で、snapshot の records・users・warnings を整える。store.js:165 のキャッシュの読み出しも、`validSnapshot` の後に同じ関数を通す。
   - GAS は正しい形を返す前提なので、本番で捨てる要素は出ない見込み（テストで「正しいデータは変わらない」ことを確かめる）。
6. **localStorage**:
   - 既読（notifications.js:48-52 `stored`）: 文字列・200 字・最大 2000 件（配列の末尾＝新しい方を残す）。
   - 自動登録の通知（auto-register.js:192-195 `readNotices`）: id 200 字・date は `isoTime`（空なら捨てる）・title 40 字・body 200 字（表示では cleanNotification が 20・60 字に切る）・href は `#/` で始まり 300 字以内（違えば外す）・最大 NOTICE_MAX 件。inv2-notice の `safeAutoNotice` はこの後に通す。
   - 自動登録の対応表（auto-register.js:316-319 `mappingOf`）: キー（uid）は 40 字、値（ノートの ID）は文字列 1〜20 字（違えば捨てる）・最大 100 件。
   - セーブ連携の設定（owned.js:169）: `viewWorldId` も `worldId(...)`（違えば ''）。
7. **通知の正規化**（notifications.js:24-32 `cleanNotification`）: id が 200 字を超えたら捨てる、href は `#/` で始まり 300 字以内。フェーズ 2 の bell で kind・worldId・batchId を足すときもここに足す。
8. **sessionStorage・history.state 用の道具**: `cleanSaved(value, schema)` を keep-state が使う（所持パルの絞り込み・理想個体の条件・一覧の並べ替えの schema は keep-state で足す）。

### 触るファイル

- 新規 web/js/core/boundary.js・test/core/boundary.test.js
- web/js/core/owned.js・web/js/owned.js・web/js/api.js・web/js/store.js・web/js/notifications.js・web/js/auto-register.js
- test/core/owned.test.js・test/web/api.test.js・test/web/store.test.js・test/web/owned-store.test.js・test/web/notifications.test.js・test/web/auto-register.test.js
- test/perf/（計測を 1 つ足す）
- web/js/release-notes.js

### テスト

- **新規** test/core/boundary.test.js: `int`（範囲・NaN・Infinity・'150'・'-5'・null・小数）、`intOrNull`（undefined・''・0 の区別）、`text`（制御文字・切り詰め・文字列でない値）、`list`（上限・重複の先勝ち・map の null）、`worldId`、`cleanSaved`（合わない項目だけ既定に戻る）。
- **追加**（既存のファイル）:
  - test/core/owned.test.js: `ownedFromShared` で talentHp が `'Infinity'`・`'150'`・`'-5'`・`'abc'` → 0〜100 に収まる、instanceId の重複は先勝ち、パッシブ 20 個 → 16 個、players 150 件 → 100 件。`normalizeOwned` で talent 150 → 100・欠け → 0。正しいデータでは今と同じ結果（既存の :61-62・:208・:216・:290 付近のテストが通る）。
  - test/web/api.test.js: ownedWorlds の応答で worldId が不正な要素・重複を捨てる、owned の rows が 20,001 件 → 20,000 件、配列でない行を捨てる、snapshot の records の id なし・重複を捨てる、正しい応答は同じ。
  - test/web/store.test.js: 壊れたキャッシュ（records に null・id なしの要素）から起動しても index ができ、壊れた要素だけが消える。
  - test/web/owned-store.test.js: IndexedDB の world.id が不正なら手元のデータなしとして扱う、共有のキャッシュの current.rows が配列でなければ current なし。
  - test/web/notifications.test.js（:41 付近）: 既読の id が 3,000 件のとき 2,000 件になる。id が 201 字の通知は出ない。
  - test/web/auto-register.test.js: 対応表に数値の値・長すぎる値が入っていても落ちず、その対応だけ無視する。通知に date の無い要素があっても落ちない。
- 期待値が変わる既存のテスト: なし（正しいデータでは結果が同じになるように作る）。落ちたら、検証が厳しすぎないかを先に疑う。

### INV-2・互換・セキュリティ・性能の注意

- **互換**: 保存の形は変えない（旧コードのタブが読んでも同じ）。直すのは読み出した値だけ。正しいデータの結果は今と同じ。
- **欠けと 0**: 今ある項目の既定値は今と同じにした（表）。後から足す項目は `intOrNull` などで「不明」を表し、テーマごとに既定値を表に足す（例: 1b の ideal-farms の牧場の状態、フェーズ 4 の入手時刻）。
- **セキュリティ**: 文字数の上限で、極端に長い文字列による描画の詰まりを防ぐ。href は `#/` だけ（今のまま）。
- **性能**: 20,000 行 × 27 列のセルの整え直しは、共有を読み直すときに 1 回（数十 ms の見込み）。手元の大きなセーブも読み込みのたびに 1 回。test/perf/ に計測を 1 つ足す（20,000 行の `cleanOwnedPayload` ＋ `ownedFromShared` が 200ms 以内）。
- **INV-2**: 関係なし。

### release-notes の案

- id: `<実装日>-data-check`
- title: 「保存データの読み込みを強化」（13 字）
- body: 「壊れた保存データや共有データが混ざっても、画面を止めずに読める分を表示します。」（39 字）

### 完了の条件

- [ ] `npm test` が通る（既存のテストは期待値を変えずに通る）。
- [ ] `npm run test:perf` に足した計測が予算内。
- [ ] モックで、DevTools から IndexedDB の `pal-note.local.owned` の個体の `talent.hp` を 150 にして読み込み直すと、所持パルの行が「HP 100」と出て、画面が止まらない。
- [ ] 同じく localStorage の配合のキャッシュ（`pal-note.local.cache.test`）の records に `null` を混ぜて読み込み直しても、配合検索が動く。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — 保存の形を変えていない（旧コードのタブが読んでも同じ）。正しいデータでは既存のテストが期待値を変えずに通り、欠けた値と 0 を取り違えない。セキュリティ — 文字数の上限と、href は `#/` で始まるものだけ。性能 — 20,000 行の `cleanOwnedPayload`＋`ownedFromShared` が 200ms 以内（`npm run test:perf`）。INV-2 — 対象外。

### TODO

- [ ] core/boundary.js（int・intOrNull・text・oneOf・isoTime・list・worldId・cleanSaved）と単体テストを作る
- [ ] core/owned.js の normalizeOwned・ownedFromShared の数値・ID の重複・パッシブ・文字数・件数を直す
- [ ] owned.js の validData を cleanLocalData に、validShared を cleanSharedCache にする
- [ ] core/boundary.js に cleanOwnedWorlds・cleanOwnedPayload を足し、api.js の共有の応答で通す
- [ ] cleanRecords・cleanUsers を足し、api.js の応答と store.js のキャッシュの読み出しで通す
- [ ] 既読・自動登録の通知・対応表・viewWorldId の読み出しを直す
- [ ] cleanNotification に id・href の長さの上限を足す
- [ ] owned・api・store・owned-store・notifications・auto-register のテストを足す
- [ ] test/perf に 20,000 行の計測を足す
- [ ] release-notes に 1 件足す
- [ ] モックで壊れたデータから起動して確かめる

---

## header-frame: 固定ヘッダー・状態・ID・重なり順の変数

### 目的

ヘッダーを 1 行・高さ固定・sticky にし、どこまでスクロールしても**同期状況・セーブ連携の状態・ベル・ID** が見えて押せるようにする（決定 D7）。後のテーマ（1b・1c の sticky のパネル、ドロワー、スナックバー）が使う**ヘッダーの高さと重なり順の CSS 変数**を決める。

### 経緯

- **決定 D7**（別セッションで回答）: ベルとログイン ID はヘッダーに残して sticky に。セーブ連携の状態はベルの左、ID は右端に小さく。
- 調査の案（付録 catalog.md）:
  - **G-08**（そのまま）: ヘッダーを sticky にし、ベル・登録をヘッダーの flex の中へ。Tab の順番を見た目に合わせる（今は main の後にベルが来る）。
  - **X-03**（直し）: テスト環境の帯をロゴの右のチップにし、app.css:297 の補正をなくす。右上の操作の absolute をやめ nowrap に、:311 の 170px の余白を消す。隠す順番は窓の @media で決める（ヘッダーは .app-main の外なので container query では判定できない）。
  - **G-11**（そのまま）: `html { scrollbar-gutter: stable }`。
  - **X-04**（そのまま）: body の min-width 960px → 920px（実機で確かめてから）。
  - **G-17**（直し）: 同期状況を button にし、押すと store.refresh()。api.js:20 の文言も直す。
  - **G-18**（直し）: 同期状況に日付を出し、取得に失敗しても前回の時刻と件数を残す（経過時間「3 分前」は 1 分ごとの描き直しが要るので出さない）。
  - **G-19**（直し）: 同期状況の aria-live を外すだけ（告知欄は作らない）。
  - **G-12**（直し）: セーブ連携・自動登録の状態チップ。調査の判断は最小の形（ポップオーバーなし）だったが、統合プランは別プラン **F003**・§9 **P2-11** に合わせてポップオーバー（役割・表示中・許可・今すぐ読み込む・設定を開く）まで入れる。表示は owned.state の meta・role・shared.error・upload.status・auto.status と autoRegister.enabled から組み立て、owned・store・setEnabled の変化で更新し、セーブ時刻と共有時刻を分け、未取得・読み込み中・失敗・古いデータの表示も決める。
  - **X-02** は 1c の owned-rows に回した（冒頭の「プランと違っていた点」の 9）。
- 別プラン **F005**（テスト環境の帯をヘッダーの中へ）・§9 **P1-4**（`.header-actions` は header の兄弟で absolute なので header の中へ移す。`.app-header` を sticky・高さ固定・折り返し禁止、長いワールド名は ellipsis）。
- **Codex 1 回目 #8（中）**: ヘッダーは app.css:189 で折り返し可能、レールは z-index 5、候補は :457 で 4。各テーマが独立して top:0 や 56px を指定すると重なる → ヘッダーの高さを共有する CSS 変数と重なり順を header-frame で定義し、固定帯と scroll-margin-top は同じ変数を使う。
- 計測（付録 measurements.md）: 一覧で scrollY=800 のとき `.app-header` の top は −773（ベル・同期状況が画面の外）。ログイン直後に layout-shift 0.21（テスト環境の帯が後から入る。テスト環境だけ）。

### 依存 / このテーマでやらないこと

- 依存: なし（順番として inv2-notice・render-contract・data-boundary の後）。
- やらないこと:
  - 「＋ 登録」をヘッダーから外す（フェーズ 2 の register-entry）。このテーマでは**ヘッダーの中へ移すだけ**。
  - 設定の「データの状態」カードを消す（フェーズ 2 の settings）。
  - ヘッダーのパル検索と「/」キー（フェーズ 3 の pal-detail）。接続中の仲間・Day・Lv（フェーズ 4 の save-extras）。
  - 所持パルのタブの上の案内・「読み込み中…」の帯の整理（1c の owned-status）。
  - 自動登録の status API（止まっている理由・最後の件数。フェーズ 2 の autoreg-visibility）。ここでは owned.state と `enabled` から組み立てる。
  - ポップオーバーの中のワールドの切り替えの select（G-12 の判断で外した。1 分ごとの更新で閉じる問題があるため）。
  - ブランドのキャッチコピー「仲間と残す、冒険の発見。」の削除（1d の copy-dead-ends。判断事項 9）。
  - X-02 の container query（1c の owned-rows）。

### 現状

- app.js:86-87 テスト環境の帯 `.environment-banner`（header の外）、:88-99 ヘッダー（brand・`p.sync-status`（:94-95 で aria-live=polite）・同期バー）、:133-140 「＋ 登録」とベルを `.header-actions` に入れる、:153 `root.append(skip, banner, header, nav, update.element, main, actions)`（ベルと登録が main の後＝Tab の順で最後）、:262-266 ログイン画面では brand を inert・nav・register・bell を隠す、:292 `banner.hidden = state.env !== 'test'`、:302-305 同期状況の文（`state.error || 前回取得…` なので、エラーのとき時刻と件数が消える）。
- app.css:110 `body { min-width: 960px }`、:176-184 `.environment-banner`、:185-197 `.app-header`（`flex-wrap: wrap`・`min-height: 56px`・position の指定なし）、:213-224 `.sync-status`・`.header-status`（縦並び）・`.sync-progress`、:288-296 `.header-actions`（absolute・top:8px・z-index 6）、:297 テスト環境のとき top:35px、:311 `.header-status` の `margin-right: 170px`、:174 スキップリンク z-index 20、:234 ナビ z-index 5、:457 候補 z-index 4、:617 トースト z-index 20、:1283-1284 ログイン画面のヘッダーの余白。
- views/settings.js:71-77 「データの状態」カードの「最新に更新」（画面からの唯一の手動の store.refresh。app.test.js:490 が押している）、:36-65 `openRenameDialog`（export されていない）、:89-91 ログアウトの確認。
- auto-register.js:80-84 `enabled(worldId)`、:332-337 `setEnabled`（誰にも知らせない）。
- owned.state（owned.js:162-176）: ready・busy・progress・error・auto（enabled・status: 'off'|'checking'|'ready'|'permission'|'error'|'empty'・error）・role（'host'|'guest'|''）・shared（error）・upload（status: ''|'sending'|'done'|'stale'|'error'）・meta（worldId・worldName・hostName・source: 'local'|'shared'・saveUpdatedAt・importedAt・sharedAt・uploadedBy・palCount。owned.js:222-232）。`grantAndRefresh` はクリックの中で await を挟まずに呼ぶ（owned.js:629-636）。
- ui/owned-status.js に表示の道具: `dateTime`（:4-8）・`worldName`（:10-14）・`roleLabel`（:22-25）・`timeLines`（:32-39）。
- ベルのパネルの作り（ui/notifications.js:55-110 の `notificationMenu`。開くと document の pointerdown・Escape で閉じ、リスナーは AbortController で外す）。
- api.js:20 TIMEOUT の文「…最新に更新して結果を確認してください」（テストは文言を見ていない。grep で確認）。

### 実装の手順

1. **CSS 変数**（app.css の `:root`。:60 付近の `--drawer` の近く）:

   ```css
   --header-h: 56px;
   /* 重なり順（小さい順）。各テーマはこの変数だけを使い、数字を直接書かない */
   --z-sticky: 2;     /* 2 段目の固定（所持パルの列見出し・理想個体の牧場の帯） */
   --z-panel: 3;      /* 画面の条件パネル（sticky） */
   --z-rail: 5;       /* 左のナビ（.navigation） */
   --z-header: 6;     /* ヘッダー */
   --z-drawer: 30;    /* 右のドロワー（フェーズ 3） */
   --z-snackbar: 40;  /* 新しい版の案内（stable-render）。トーストより下 */
   --z-toast: 50;     /* トースト */
   --z-popover: 60;   /* 本文の外（body・dialog）に浮かせる候補・メニュー */
   --z-skip: 70;      /* スキップリンク */
   /* ダイアログ（showModal）は top layer なので z-index は要らない */
   ```
   - 既存の z-index を置き換える: :174 スキップリンク → `var(--z-skip)`、:234 ナビ → `var(--z-rail)`、:457 `.picker-popover` → `var(--z-panel)`（本文の中で開くもの）、`.picker-popover-floating`（:460）に `z-index: var(--z-popover)`、:617 トースト → `var(--z-toast)`。
   - 注意: 本文の中に絶対配置で出す候補は、親の sticky パネルの重なりの中に閉じる（パネルの z-index が基準になる）。パネルの近くで上に開くとヘッダーの下に潜ることがある → そういう所では浮かせる形（body に付ける。z-index は `--z-popover`）にする（popovers のテーマの `createPopover` の host）。
2. **DOM**（app.js）:
   - テスト環境の帯をヘッダーの中のチップに: `const envChip = el('span', 'env-chip', 'テスト環境'); envChip.hidden = true;`。:292 は `envChip.hidden = state.env !== 'test'`。
   - 同期状況を button に: `const status = button('', refreshRecords, 'sync-status'); status.title = '最新に更新';`（aria-live は付けない＝:95 を消す）。文は下の 3. の `syncStatusText`。
   - `header.append(brand, envChip, headerStatus, saveStatus.element, bell.element, register, account.element)`。`.header-actions` は作らない（:139-140 と root.append の `actions` を消す）。`root.append(skip, header, nav, update.element, main)`。
   - ログイン画面（:262-266）: 今の register・bell に加えて `saveStatus.element.hidden`・`account.element.hidden` を切り替える。ログイン画面に移るときはそれぞれの `close()` も呼ぶ（今の `bell.close()` と同じ）。
3. **同期状況の文**（新規 web/js/ui/sync-status.js。G-18・G-19）:

   ```js
   /** 同期状況の文。error があっても前回の時刻と件数を残す */
   export function syncStatusText(state, now = Date.now()) → { label: string, time: string, count: string, error: string }
   ```
   - syncing: `サーバに保存中… ${syncDone} / ${syncTotal} 件`（今と同じ。app.test.js:285・293 が完全一致で見ている）。
   - loading: 「記録を更新中…」。
   - serverTime あり: `${cached ? '前回取得' : '最新取得'} ${時刻}${cached ? ' 時点' : ''} · ${records.length} 件`（今と同じ形。app.test.js:279・299 の `/最新取得/`）。時刻は、取得が今日なら `formatTime(t)`（時:分）、違う日なら `formatTime(t, true)`（月/日 時:分。ui/dom.js:34-39）。error があっても文を残し、**button の外（隣）**に `.sync-error` のチップ「更新できませんでした」（title にエラー文）を出す（button の textContent は今と同じ文のままにする。テストが完全一致で見ているため）。
   - serverTime なし: error があれば error、なければ「仲間だけの配合ノート」（今と同じ）。
   - 「最新取得」「前回取得」の語は `<span class="sync-label">` に分ける（狭い幅で隠すため。手順 8）。
   - 押したとき: `runButton(status, async () => { await store.refresh(); toast('最新の記録に更新しました'); }, (error) => toast(error.message))`（views/settings.js:74-76 と同じ）。syncing・renaming のときとログイン画面では `disabled`。
   - api.js:20 TIMEOUT の文を「応答に時間がかかっています。右上の取得時刻を押して、結果を確かめてください。」に（設定のボタンはフェーズ 2 で消えるため）。
4. **セーブ連携の状態**（新規 web/js/ui/save-status.js。G-12・F003・P2-11）:

   ```js
   /** 表示の中身を決める（DOM なし）。 */
   export function saveStatusModel(ownedState, { autoEnabled = () => false, now = Date.now() } = {})
     → { tone: 'ok' | 'busy' | 'warn' | 'stale' | 'none', text: string, title: string, action: 'grant' | null }
   /** ヘッダーの部品。中身は textContent・className・title だけを書き換える（作り直さない） */
   export function saveStatus({ owned, autoRegister, store }) → { element, update(), close(), destroy() }
   ```
   判定の順（上が優先）:

   | 条件 | tone | 文（例） | 押したとき |
   |---|---|---|---|
   | `!ready` | busy | 所持パルを確認中… | ポップオーバー |
   | `auto.enabled && auto.status === 'permission'` | warn | 許可が必要 | **クリックの中で await を挟まず** `owned.grantAndRefresh()`（失敗はトースト） |
   | `auto.enabled && ['error', 'empty'].includes(auto.status)` | warn | セーブを読めません | ポップオーバー（auto.error を出す） |
   | `upload.status === 'error'` | warn | 共有できません | ポップオーバー（upload.error） |
   | `shared.error && !meta?.source` | warn | 共有を読めません | ポップオーバー |
   | `!meta?.source`（データなし） | none | セーブ未連携（`role === 'guest'` なら「共有待ち」） | ポップオーバー（設定を開く） |
   | `meta.source === 'local'`（この PC で読んだ） | ok / stale | 「ワールド」· セーブ 03:07 · 自動登録 オン | ポップオーバー |
   | `meta.source === 'shared'` | ok / stale | 「ワールド」· 共有 03:07 | ポップオーバー |

   - **読み込み中（`busy`）は文を変えない**（幅が揺れない）。`is-busy` のクラスで点を流れる光にし、title に `progress`（「セーブを読み込み中…」など）。前の警告はそのまま残す。
   - セーブ時刻は `meta.saveUpdatedAt`、共有時刻は `meta.sharedAt`（owned.js:227-229）。時刻は今日なら 時:分、違う日なら 月/日 時:分。
   - 自動登録の「オン／オフ」は `role === 'host'` のときだけ出す（`autoRegister.enabled(meta.worldId)`）。
   - **古いデータ（stale）**: この PC で読んだデータで、自動の読み込みがオンなのに `importedAt` が 5 分より前（1 分ごとに読み直すので、止まっている印）／共有のデータで `sharedAt` が 60 分より前。文はそのまま、点を灰色にし、title に「最後に読み込んだのは …」。閾値は定数 `STALE_LOCAL_MS = 5 * 60 * 1000`・`STALE_SHARED_MS = 60 * 60 * 1000`（実機で直してよい）。
   - 色の点は CSS の `::before`（tone ごとのクラス）、文字は textContent。ワールド名は「」付きで、はみ出しは ellipsis（CSS）。全文と時刻の詳細は title。
   - 要素: `<div class="save-status"><button class="save-status-button" aria-haspopup="dialog" aria-expanded="false">…</button></div>`。
   - **ポップオーバー**（ui/notifications.js:55-110 のベルのパネルと同じ作り。開いたときだけ中身を作る。document の pointerdown と Escape で閉じ、リスナーは AbortController で外す。popovers のテーマで ui/popover.js に移す）: 中身は `dl`（この PC＝`roleLabel(state)`、表示中＝`worldName(meta)`＋体数、更新＝`timeLines(state)`、エラーがあればその文）と、ボタン「読み込みを許可」（許可が要るとき。クリックの中で await なし）・「今すぐ読み込む」（登録したワールドがあるとき。`owned.refreshAuto({ enable: true })`。views/owned-settings.js:192 と同じ）・リンク「設定を開く」（`#/settings`）。**開いている間に update が来たら中身の文だけ書き換え、閉じない**。
   - 購読: `owned.subscribe(update)`・`store.subscribe(update)`（ログイン・環境）・`autoRegister.subscribe(update)`（次の 5.）。ヘッダーはアプリと同じ寿命だが、テストのために destroy で全部外せるようにする。
5. **自動登録の設定の購読**（auto-register.js）: `const listeners = new Set()`、返す object に `subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }`、`setEnabled`（:332-337）と `setMapping`（:343-351）の保存の後で `listeners.forEach((fn) => fn())`。
6. **ID（右端）**（新規 web/js/ui/account-menu.js と web/js/ui/account-actions.js）:
   - views/settings.js:36-65 の `openRenameDialog` と :89-91 のログアウトの確認を **ui/account-actions.js** に移して export（`openRenameDialog(context)`・`confirmLogout(store)`）。settings.js はそれを import する（振る舞いは同じ。app.test.js:508-532 の名前の変更のテストがそのまま通ること）。
   - `accountMenu(context) → { element, update(state), close(), destroy() }`: ボタンの文字は userId（CSS で最大 8em・ellipsis・12px）、aria-label「ログイン中の ID: {ID}（名前の変更・ログアウト）」。押すと小さなメニュー（ベルのパネルと同じ作り）: 「名前を変更」（`context.renamer` があり、名前の変更が途中で止まっていないとき）・「ログアウト」（`confirmLogout`）。`state.renaming` の間は両方押せない。
   - **メニューの中身は開いたときだけ作る**（app.test.js:122・130・348・512・526 は `byText('ログアウト')`・`byText('名前を変更')` で設定の画面のボタンを探す。常に DOM にあると、先にヘッダーのボタンが見つかってしまう）。
   - store.subscribe で `update(state)`（ID が変わったら文字を書き換える）。
7. **CSS**（app.css）:

   ```css
   html { scrollbar-gutter: stable; scroll-padding-top: calc(var(--header-h) + 8px); }
   body { min-width: 920px; }                      /* :110 の 960px から */
   .app-header {                                    /* :185-197 */
     position: sticky; top: 0; z-index: var(--z-header);
     height: var(--header-h); min-height: 0; flex-wrap: nowrap; gap: 12px;
   }
   .app-header .header-status { margin-left: auto; min-width: 0; align-items: flex-end; }   /* :311 の margin-right: 170px を消す */
   .sync-status { background: none; border: 0; padding: 4px 8px; border-radius: 8px; white-space: nowrap; color: var(--muted); }
   .sync-status:hover:not(:disabled) { background: var(--state-hover); }
   .env-chip { /* 今の .environment-banner の色（:179-180）を移す */ border-radius: 100px; padding: 2px 10px; font-size: 12px; font-weight: 800; white-space: nowrap; }
   .save-status-button { max-width: 22em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
   .account-chip { max-width: 8em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
   ```
   - 消す: `.header-actions`（:288-296）、:297 のテスト環境の補正、:311 の `margin-right: 170px`、`.environment-banner`（:176-184。色は `.env-chip` へ）。
   - ログイン画面の補正（:1284 の `.app-header { padding: 12px 32px }`）が高さ固定で収まるか確かめる（収まらなければ padding を左右だけに）。
   - `.sync-progress` は `.header-status` の中で文の下に並ぶ（今のまま。場所を残して隠すのは stable-render）。
8. **幅が足りないときの隠す順番**（ヘッダーは .app-main の外なので、窓の @media で決める）:
   1. 1200px 未満: ブランドの副題（`.brand small`）を隠す。
   2. 1100px 未満: 同期状況の「最新取得／前回取得」の語（`.sync-label`）を隠して時刻と件数だけにし、セーブ連携の状態の最大幅を 14em に。
   3. 980px 未満: ブランドの文字（`.brand strong`）を隠してマークだけにする（リンクの aria-label「パル配合ノート（配合検索へ）」を付ける）。セーブ連携の状態はワールド名を隠し「セーブ 03:07」だけ。
   - **ベル・ID・「許可が必要」は隠さない**。920px でも折り返さない（はみ出しは各部品の ellipsis で吸収）。
   - 試算（1100px の窓・ヘッダーの中身 約 1004px）: ブランド 約 220・テスト 80・同期状況 約 200・セーブ連携 約 260・ベル 40・登録 約 90・ID 約 90・すき間 6×12 ＝ 約 1050px → 1100px 未満では 2. が要る。実機で測って閾値を直す（直したらここに書く）。
9. Tab の順番: brand → 同期状況 → セーブ連携 → ベル → 登録 → ID → ナビ → 本文（テスト環境のチップは押せないので飛ばされる）。スキップリンク（app.js:131-132）は今のまま先頭。

### 触るファイル

- web/js/app.js・web/css/app.css・web/js/api.js（:20 の文言）・web/js/auto-register.js（subscribe）・web/js/views/settings.js（関数を移す）
- 新規 web/js/ui/sync-status.js・ui/save-status.js・ui/account-menu.js・ui/account-actions.js
- test/web/app.test.js・新規 test/web/save-status.test.js・test/web/auto-register.test.js
- web/js/release-notes.js

### テスト

- **期待値が変わる既存のテスト**:
  - test/web/app.test.js:72・116（ログイン画面で隠す／ログイン後に出すクラスの一覧 `['navigation', 'register-button', 'notification-menu']`）: `save-status`・`account-chip` を足す。register-button と notification-menu はヘッダーの中に移るだけで、クラスは同じ。
  - test/web/app.test.js:276-299（同期状況と同期バー）: 文の形は同じなので通る見込み（要素が `p` から `button` に変わるだけ）。
  - 別プラン §9 の C が挙げた app.test.js:122-132・348-350・513-530 は、ログアウトと名前の変更のテスト。メニューの中身を開いたときだけ作れば変わらない（変わったら、ヘッダーのボタンを先に見つけていないかを確かめる）。
  - test/web/views.test.js:137-144（設定のカードの並び）: このテーマでは変わらない（カードを消すのはフェーズ 2）。
- **追加するテスト**:
  1. app.test.js: ヘッダーの子の並びが brand → env-chip → header-status → save-status → notification-menu → register-button → account-chip で、ルートに `.header-actions` が無い。
  2. app.test.js: 同期状況を押すと snapshot の要求が 1 回増え、トーストが出る。
  3. app.test.js: 取得に失敗しても前回の時刻と件数が残り、`.sync-error` が出る（api で snapshot を失敗させる）。
  4. 新規 test/web/save-status.test.js: `saveStatusModel` の表の各行（未確認・許可・読めない・共有できない・データなし・参加者の共有待ち・ホスト・参加者・古いデータ）、時刻の形（今日・別の日）、`update` で要素が作り直されない（同じ button）、許可のボタンが await なしで `grantAndRefresh` を呼ぶ（クリックの処理の中で同期的に呼ばれたことを記録）、開いている間の update でポップオーバーが閉じない。
  5. test/web/auto-register.test.js: `setEnabled`・`setMapping` で subscribe の関数が呼ばれる。
  6. account-menu: ボタンで開くとメニューができ、「ログアウト」→ 確認 → `store.logout`。閉じると中身が DOM から消える。
  7. `syncStatusText` の単体テスト（今日・前日・キャッシュ・エラーで前回値が残る）。

### INV-2・互換・セキュリティ・性能の注意

- **セキュリティ**: 点の色・アイコンは CSS と createElementNS。ワールド名・ID は textContent。
- **許可の要求**: File System Access の requestPermission はユーザーの操作の中で呼ぶ必要がある → チップのクリックの処理の中で、await を挟まずに `owned.grantAndRefresh()` を呼ぶ。実機（Chrome）で確かめる。
- **重なり**: ヘッダーを固定すると、本文の中の候補（z-index 4 → `--z-panel`）がスクロールした状態でヘッダーの下に潜ることがある。record-editor.js:121 の scrollIntoView と、フォーカスを戻す処理でヘッダーに隠れないよう `scroll-padding-top` を必ず付ける。
- **縦の領域**: 固定で 56px 使う（縦 900px の約 6%）。
- **互換**: 保存するデータは増えない。
- **性能**: 状態の描き直しは文字とクラスだけ。

### release-notes の案

- id: `<実装日>-sticky-header`
- title: 「ヘッダーを常に表示」（9 字）
- body: 「同期状況・セーブ連携の状態・通知・ID がいつも見えます。取得時刻を押すと最新に更新します。」（46 字）
- テスト環境のチップへの変更は、テスト環境だけの見た目なので別には書かない（X-03 の判断）。

### 完了の条件

- [ ] `npm test` が通る。
- [ ] モック（`?mock=1&seed=80`）の一覧で scrollY=800 まで下げても、`document.querySelector('.app-header').getBoundingClientRect().top === 0` で、ベル・同期状況・セーブ連携の状態・ID が見えて押せる（検証の表「ヘッダー（scrollY=800）→ 常に見える」）。
- [ ] 同期状況を押すと取得し直し、トーストが出る。オフラインにして押すと、前回の時刻と件数が残り「更新できませんでした」が出る。
- [ ] 幅 1100px・980px・920px（DevTools のデバイス）で 1 行に収まり、横スクロールが出ない。実機の Windows Chrome で幅 960px の窓で `document.documentElement.scrollWidth === document.documentElement.clientWidth`（X-04）。
- [ ] 所持パルのデータあり（注入スクリプト `Claude outputs/ui-audit-2026-10/shots/owned/inject.js`）でセーブ連携の状態に「ワールド」と時刻が出る。表の全行は `saveStatusModel` のテストで確かめる。
- [ ] 実機（Chrome・セーブを登録した PC）で、許可が切れた状態から状態チップを押すと許可の画面が出る。
- [ ] テスト環境でログインした直後に、本文が下へずれない（帯がチップになったため）。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: セキュリティ — ワールド名・ID は textContent、点とアイコンは CSS と createElementNS（`test/static/security.test.js`）。互換 — 保存するデータは増えていない。性能 — 状態が変わっても部品を作り直さず、文字とクラスだけを書き換える（`saveStatus` の update のテスト）。INV-2 — 対象外。

### TODO

- [ ] app.css に `--header-h` と `--z-*` を足し、既存の z-index を置き換える
- [ ] テスト環境の帯をヘッダーの中のチップにする
- [ ] `.header-actions` をなくし、ベル・登録をヘッダーの中へ移す（DOM の順番＝Tab の順番）
- [ ] ui/sync-status.js（syncStatusText）を作り、同期状況を押せる button にする（aria-live を外す・失敗しても前回値）
- [ ] api.js:20 の TIMEOUT の文を直す
- [ ] ui/save-status.js（saveStatusModel・saveStatus とポップオーバー）を作る
- [ ] auto-register.js に subscribe を足し、setEnabled・setMapping で知らせる
- [ ] openRenameDialog・confirmLogout を ui/account-actions.js に移し、ui/account-menu.js（右端の ID）を作る
- [ ] ヘッダーの CSS（sticky・高さ固定・nowrap・scrollbar-gutter・scroll-padding-top・min-width 920px）を直す
- [ ] 幅が足りないときの隠す順番を @media で入れ、実機で閾値を確かめる
- [ ] app.test.js:72・116 を直し、並び・同期状況・失敗時のテストを足す
- [ ] save-status・auto-register・account-menu のテストを足す
- [ ] release-notes に 1 件足す
- [ ] モックと実機で、固定・幅・許可・テスト環境を確かめる

---

## stable-render: 差分更新・区切った描画・再計算の省略・ずれの解消

### 目的

取得・自動の読み直し・条件の変更のたびに起きている「中身が同じでも全部作り直す」「重い計算を同期で回す」「高さを確保しない部品」をなくす。表示が上下に動かず、フォーカス・スクロール位置・開いた選択肢が保たれ、所持パル 2,000〜20,000 行・理想個体の重い計算でも入力が止まらないようにする。

### 経緯

- 調査の案（付録 catalog.md。直しを優先）:
  - **G-39**（直し）: 記録の取得で中身が同じなら index を作り直さず、画面も描き直さない。所持パル側（O-28）はすでに手が打たれている（owned.js:215・459）ので入れない。
  - **G-40**（直し）: キーで要素を使い回す差分更新。判断は「所持パルから・共通部品は 2 つ目の使い道まで待つ」だったが、統合プランは共通部品 `syncList` を作ると決めた（別プラン F065・§9 P2）。
  - **I-09**（直し）: パッシブ・所持者の選択欄は、中身が同じなら作り直さない。フォーカスがある間は待つ。
  - **I-10**（直し）: 20 秒ごとの自動取得で、表示する中身の署名が同じなら DOM に触らない。保留の帯と「並べ直す」ボタンは作らない。
  - **C-07**（直し）: 設定の登録したワールドの一覧の署名から busy を外し、「使うワールド」の選択肢は中身が変わったときだけ作り直す。行の並びを登録順に固定する案は外す（owned.js の自動の選択が handles.js:205 の並びを前提にしているため）。
  - **O-17**（そのまま）: キーワード・数値の入力を間引き、日本語の変換中は絞らない。
  - **S-35**（直し）: 件数の行（`.result-note`）に min-height を付けるだけ（文言は増やさない）。
  - **V-28**（直し）: 同期バーは場所を残して隠す。新しい版の案内は本文の流れから外し、トーストとぶつからない下端の固定のカードにする。
- 別プラン: **F062**（固定スロット）・**F065**（`syncList`）・**F029**（下端の固定スナックバー。幅 `min(720px, calc(100% − var(--drawer) − 48px − 484px))`・z-index はトースト（20）より下・下から出る・未送信のフォームがあれば再読み込みを保留＝Codex D）・§9 **P2 部品の契約**（行は `{ element, update, destroy }`・復元は `focus({ preventScroll: true })`・`data-focus` で区別・列見出し行は syncList の管理行に混ぜない・content-visibility の推定の高さ）・§9 **P2 性能**（理想個体の再計算は「データ・index・実効の条件・本人」が変わったときだけ、20 秒ごとの確認を無条件の再計算にしない、先頭に見えていた行の key と位置を戻す、View Transition はヘルパーで API の有無と減らす設定を判定し、続けての操作は最新だけ描く）。
- Codex のプランレビュー: 1 回目 **#2**（id＋etag では楽観更新を見逃す。一覧は 1 件 2 行なので行のキーに表示の向き）・**#4**（理想個体の計算は views/ideal.js:469 から同期で、core/ideal.js:791 に ♂×♀ の二重ループ。最悪 20,000 体で 1 億組）・**#20**（大量 DOM と集計の予算）、2 回目 **A**（計算方式と test/import.test.js:41 の import の制限の両立）・**B**（初回の大量 DOM の方針と合格値）、3 回目 **新 1**（所持パルの分割描画に取り消しの条件がない。views/owned.js:244 は購読の解除だけ）。
- 計測（付録 measurements.md）: 配合検索で親を選ぶと結果が 27px 上下する（`.card-stack` の top 223↔250）・所持パル 129 行で scrollHeight が 9574〜10011px で揺れる・新しい版の帯で本文が押し下がる・同期バーで同期状況の文字が約 5px 上下する。

### 依存 / このテーマでやらないこと

- 依存: render-contract（`applyRoute` と `update` の分離の上に差分更新を載せる）・header-frame（`--z-snackbar`・`--z-toast`）。理想個体の計算は、テーマ 0 の ideal-calc（[phase-1-0-ideal-calc.md](phase-1-0-ideal-calc.md)）の後の形（`idealPlan` の入力に `prefer`・`watch`、戻り値に `measures`）を前提にする（2026-10-12 追記）。
- やらないこと:
  - 所持パルの行の見た目（4 セル・2×2 のパッシブ枠・★4 枠・列見出し）（1c の owned-rows）。ここでは今の行の見た目のまま使い回せるようにするだけ。
  - 理想個体の組のカードの部品化（`pairCard` を `{ element, update }` に）と要約の作り直し（1b の ideal-results）。ここでは「同じなら描かない」「区切って計算する」だけ。
  - パッシブ選択の部品化（popovers）。ここでは呼び出し側の署名の比較だけ。
  - 保留の帯・「並べ直す」ボタン（I-10 の判断で作らない）、新しい行を光らせる（フェーズ 2 の find-merge）、設定の行の並びの固定（C-07 の判断で外した）。
  - 理想個体の計算の Web Worker 化（予算を超えたときだけ。条件は手順 F-5）。

### 現状

- **記録**: store.js:89-98 `render()` は呼ばれるたびに `buildIndex`・`buildCarrierGraph` を作り直す。`apply()`（:132-161）は応答のたびに render（:159）。起動時はキャッシュ → サーバの 2 回（:163-169）、タブに戻ると refresh（app.js:341-348。store.js:306-313 で 30 秒に 1 回まで）。楽観更新の update は etag を変えない（:15-16）。
- views/shared.js:40-54 `watchView` は index の参照・env・error で比べる（:46）→ 中身が同じでも各画面が描き直す。
- **配合のカード**: views/shared.js:29-32 `renderCards`・views/search.js:32-36 は replaceChildren の後に全部作り直す。views/list.js:37-50 も同じで、親の順のとき `parentRows`（core/record-sort.js:9-14）で 1 件 2 行、件数の行（:43）は「80 件の配合 · 160 件を表示」。
- **所持パル**: views/owned.js:210-224 `renderResults` は replaceChildren（:220）の後、全行を同期で作り（:223）、行ごとに keywordNotes を計算する。キーワード（:162）・個体値（:142-146）は input のたびに全部やり直す。`renderFilters`（:180-194）は呼ばれるたびに option を作り直し、`renderPassives`（:196-208）は部品ごと作り直す。`destroy`（:244）は購読の解除だけ。app.css:933 `.owned-row { content-visibility: auto; contain-intrinsic-size: auto 60px }`。
- **理想個体**: views/ideal.js:453-494 `renderResults` は `idealPlan` を同期で計算し（:469-472）、missingBox・farmBox・results を作り直す（:459-460・:490）。`update`（:496-501）は所持者・パッシブ・結果・登録の一覧を全部やり直す。watchView（:504）で記録の取得のたび、owned.subscribe（:510-515）で所持パルが変わるたびに update。開いている間は 20.5 秒ごとに読み直す（:519-524）。core/ideal.js:786-843 の ♂×♀ の二重ループ（:791-792）。test/perf/ideal.perf.js は ♂1000×♀1000（100 万組）で 2 秒以内を見ている。
  - **ideal-calc の後**（2026-10-12 追記。行は ideal-calc で動く）: `renderResults` は「`breedingLayouts(state.index, to)` → `targetFarms` → `farmSignature` → `planMemory.get(id)`（署名が合えば基準の上から K 組を `prefer.baseline`）→ `idealPlan({ ..., prefer, watch })` → `farmAdvice(placedFarms, result.pairs, { measureOf })` → `planChanges`（`changed` を交換推奨の行き先に絞る）」の順になる（phase-1-0-ideal-calc.md の手順 5）。世代の表は `parentExtras` で大きくなりうる（欲しい 4 つで余計 4 個までなら `span` 1 → 5）。
- **継承ルート**: views/route.js:177-200 の update → renderOwned（:115-118）でパッシブ選択を毎回作り直す。
- **設定**: views/owned-settings.js:314 の署名に `state.busy` が入る（60 秒ごとの読み直しで一覧を 2 回作り直し、開いている select が閉じる）。:357-374 は option を毎回作り直す。
- **高さ**: app.css:568 `.result-note` に min-height なし（views/search.js:21 で毎回空にし、空の行は高さ 0）。ui/sync-progress.js:15 は hidden を切り替える（.header-status は縦並び。app.css:214）。
- **新しい版の帯**: app.css:267-281 の `.update-banner` は本文の流れの中（margin 12px）、app.js:153 で nav と main の間 → 出た瞬間に本文全体が押し下がる。トーストの領域は app.css:617（right 24px・幅 min(460px, 100% − 48px)・z-index 20）。
- View Transition は使っていない。

### 実装の手順

**A. 画面用の変更番号（store）** — G-39・Codex #2

1. store.js に `let revision = 0; let confirmedKey = ''; let lastQueueKey = '';`、state に `revision: 0` を足す。
2. `render({ confirmedChanged = true } = {})`: records の計算と syncing の数は今のまま。`const queueKey = queue.map((operation) => operation.opId).join(',')`。`!confirmedChanged && queueKey === lastQueueKey` のときは、index・graph・revision をそのままにして emit だけする（同期状況の文と同期バーは更新される）。それ以外は `state.revision = ++revision` にし、index と graph を作り直す。`lastQueueKey = queueKey`。
3. `apply()`（:132-161）で `const key = snapshot.records.map((record) => `${record.id}:${record.etag}:${record.updatedAt}`).join('\n')`、`render({ confirmedChanged: key !== confirmedKey })`、その後 `confirmedKey = key`。中身が同じときは `confirmed` も前の配列のまま残す（index の中のレコードと `state.records` のレコードを同じ object にそろえる）。users・warnings・serverTime などは今までどおり入れ替える。楽観更新（mutate :315-334）・失敗の巻き戻し（:241）・送信済みの除去（settled）は queue が変わるので必ず番号が増える（**id＋etag だけでは楽観更新を見逃す**ため、番号は「確定した中身」と「送信待ち」の両方で決める）。
4. `clearData()`（:100-120）でも `state.revision = ++revision`・`confirmedKey = ''`。
5. views/shared.js の watchView は `state.revision`・`env`・`error` で比べる（:90）。
6. 設定の「整合性の警告」（views/settings.js:126-131）は watchView の中で描いているので、記録が同じで警告だけ変わると描き直されなくなる → settings.js の store.subscribe（:121 の renderAccount と同じ所）で `JSON.stringify(state.warnings)` の署名が変わったときに描く。

**B. キーで使い回す一覧 `syncList`**（ui/dom.js）— G-40・F065・P2

```js
// container → { rows: Map<key, row>, keys: Map<Element, key>, emptyNode }
const lists = new WeakMap();
/**
 * container の子を items に合わせる。同じ key の行は使い回して update、無くなった行だけ destroy、位置の違う行だけ insertBefore。
 * create(item) → { element, update(item), destroy() }。update は中身を書き換えてよいが element は差し替えない。
 * フォーカス: 同期の前にフォーカスのある行の key と、行の中の data-focus の値を覚え、同期の後で同じ行の同じ部品へ focus({ preventScroll: true })。
 *   行が消えたときは、次の行（なければ前の行）の最初の [data-focus] へ。どちらも無ければ fallbackFocus（任意の要素）へ。
 * items が空のとき、empty（任意。() => Element）があればその要素を 1 つだけ出す。
 */
export function syncList(container, items, { key, create, empty, fallbackFocus } = {}) { … }
/** 管理している行のキー（分割描画で、まだ無い行の数を数えるときに使う） */
export function listKeys(container) → Set<string>
/** すべての行を destroy して空にする（画面の destroy・表示の形を変えるときに呼ぶ） */
export function clearList(container) { … }
```

- 中身の流れ（views/drafts.js:216-239 の方式を一般化）:
  1. 今のフォーカス: `document.activeElement` から parentElement をたどり、container の直下の行（`keys` にある要素）と、途中の `data-focus` 属性の値を覚える（テスト用の DOM に `closest`・`dataset` が無いので getAttribute でたどる）。
  2. 新しい key の Set に無い行: その行がフォーカスを含んでいたら位置を覚え、`destroy()`・`element.remove()`・Map から消す。
  3. 各 item: 行があれば `update(item)`、無ければ `create(item)`。
  4. 並べる: `items.forEach((item, i) => { const node = …; if (container.children[i] !== node) container.insertBefore(node, container.children[i] ?? null); })`、余りは `lastElementChild.remove()`（空の表示の要素もここで消える）。
  5. フォーカスを戻す: 覚えた行が残っていて、フォーカスが外れていれば `[data-focus="値"]` → 行の最初の `[data-focus]` の順に `focus({ preventScroll: true })`。行が消えていたら views/drafts.js:245-250 の `moveFocus` と同じく次（なければ前）の行へ。
- **決まり**: syncList で管理する入れ物に replaceChildren を直接使わない（空の表示・読み込み中の表示を出すときは、先に `clearList`）。列見出し行（1c の owned-rows）は入れ物の外に置く（P2: 管理行に混ぜない）。

**C. 配合のカード**（検索・逆引き・パル詳細・一覧）— G-40・Codex #2

1. views/shared.js の `renderCards(target, records, context, options)` を、`[{ record, leftParent?, focusParent? }]` の並びを受ける形にして syncList で描く。key は `${record.id}|${leftParent ?? focusParent ?? ''}|${record.etag}|${record.updatedAt}`（**表示の向き**を含める＝1 件 2 行の一覧で同じ key にならない。**中身の版**を含める＝楽観更新は updatedAt を変える（store.js:16）、送信待ちの登録は pending の etag）。中身が変わった配合は key が変わって作り直される（breedingCard には中身の更新の関数が無いため。A の番号で、無駄な作り直しはもう起きない）。
2. views/search.js（:32-36）・reverse.js・pal.js・list.js（:44-49 の行の作り）を renderCards に寄せる。list.js の行は `parentRows` の `parent1Id`（左に出す親）を leftParent に。
3. カードの操作ボタン（ui/breeding-card.js の編集・削除など）に `data-focus`（'edit'・'remove' など）を付ける（削除して行が詰まったとき、次の行の同じボタンではなく最初の操作へ移る）。

**D. 所持パルの一覧** — G-40・O-17・Codex 2 回目 B・3 回目 新 1

1. views/owned.js の `ownedRow`（:51-69）の中身を `fillOwnedRow(element, pal, { notes })`（element.replaceChildren(...) で入れ直す）に分け、`ownedRow(pal, options) = fillOwnedRow(el('article', 'owned-row'), pal, options)` とする（ideal.js の pairCard が使う形は変えない）。
2. 行の部品（views/owned.js の中）:

   ```js
   // 表示に出す値と一致の理由の署名（理由を入れ忘れると、キーワードを変えても古い理由が残る。G-40 のリスク）
   const rowSignature = (pal, notes) => [pal.level, pal.rank, pal.stars, pal.passives.join(','), pal.talent.hp, pal.talent.shot,
     pal.talent.defense, pal.holder, pal.placeLabel, pal.nickname, pal.gender, pal.egg, pal.lucky, pal.alpha, pal.lastOwner,
     notes.map((note) => `${note.label}:${note.name}:${note.desc}`).join('|')].join('\u0001');
   function ownedRowItem(pal) {
     let shown = '';
     const element = el('article', 'owned-row');
     const item = {
       element,
       update(next) {
         const notes = terms.length ? keywordNotes(next, terms) : [];   // terms は今のキーワード（renderResults が入れる）
         const signature = rowSignature(next, notes);
         if (signature !== shown) { shown = signature; fillOwnedRow(element, next, { notes }); }
       },
       destroy() {},
     };
     item.update(pal);
     return item;
   }
   ```
3. **描画の仕事（job）**: `renderResults` を呼ぶたびに `const job = ++jobSeq`。
   - 2,000 行以下: まだ無い行（`listKeys` に無い key）が 200 以下なら、全部を 1 回の syncList で（自動の読み直しで中身が少し変わっただけのときは、ほぼ update だけで済む）。
   - まだ無い行が 200 を超える（初めて開いた・絞り込みを大きく変えた）: 先頭の 200 行を syncList で**すぐ**出し、残りは区切って足す。1 回の区切りは 16ms 以内（`performance.now()` で測り、前の区切りの速さで足す行数を 25〜400 の間で増減）、`requestAnimationFrame`（無ければ `setTimeout(…, 0)`）でつなぐ。区切りごとに `syncList(results, list.slice(0, shown), …)` を呼ぶ（先頭の行は使い回され、後ろに足されるだけ）。
   - **古い仕事を捨てる**: 区切りの始めに `job !== jobSeq || destroyed` なら何もしない。条件の変更・データの更新（どちらも renderResults を呼ぶ）・画面の破棄で古い仕事は止まる。`destroy`（:244）で `destroyed = true; jobSeq++; clearList(results)`。
   - 「最初から全件・もっと見るなし」（views/owned.js:222 のコメント・プランの決まり）は守る（区切って全部出す。途中で止めない）。
4. **自動の更新の後に位置を戻す**（P2 性能）: データの更新（`update(state)` から呼ぶとき。条件の変更では戻さない）の前に、ヘッダーと固定のパネルの下で最初に見えている行の key と `getBoundingClientRect().top` を覚え（行の top は単調に増えるので二分探索）、同期の後に同じ行があれば `window.scrollBy?.(0, 新しい top − 前の top)`。道具は ui/dom.js に `anchorOf(container, offsetTop) → { key, top } | null`・`restoreAnchor(container, anchor)`。
5. **選択肢を作り直さない**（I-09・G-40 の直し）: `renderFilters`（:180-194）は、作る選択肢の並び（`[value, label]` の配列）の署名が前回と同じなら value だけ合わせる。違っても、その select にフォーカスがある間（`document.activeElement === select`）は作り直さず、`blur` を 1 回だけ待ってから作り直す（待っている印を持ち、リスナーを重ねない）。`renderPassives`（:196-208）も `JSON.stringify([filter.passives, [...counts]])` が同じなら作り直さない（部品の update は popovers で入れる）。
6. **入力の間引き**（O-17）: キーワード（:162）は `onTextInput(query, (value) => { filter.query = value; renderResults(); }, { delay })`。個体値（:142-146）は input を 150ms 間引き、change ですぐ（`flush`）。`delay` は `context.inputDelay ?? 150`（テストの context は 0 にして同期のまま確かめる）。

**E. 2,000 行を超えたら見えている範囲だけ描く**（新規 web/js/ui/virtual-list.js）— 性能の予算

```js
/** 見えている行の範囲（純粋関数）。offsets[i] は i 行目の上端（offsets.length は行数 +1） */
export function visibleRange({ offsets, scrollTop, viewport, overscan = 10 }) → { start, end }
/** container に上下の余白（spacer）と、見えている行だけを置く。行の高さは描いた後に測って覚える（測っていない行は estimate） */
export function virtualRows(container, { key, create, estimate = 60, overscan = 10, topOffset = () => 0 }) → { render(items), destroy() }
```

- container の中を `[上の余白, 行の入れ物（syncList の対象）, 下の余白]` にする。行の高さは key ごとの Map（描いた後に `getBoundingClientRect().height`）、上端の累積は render のたびに作り直す（20,000 行でも足し算だけ）。
- window の scroll（passive）・resize を requestAnimationFrame で間引いて範囲を計算し直す。リスナーは AbortController で外す（destroy）。
- 仮想のときは content-visibility を外す（`.owned-list.is-virtual .owned-row { content-visibility: visible; }`）。
- 2,000 行以下に戻ったら `destroy` して D の形に戻す（`clearList`）。
- 知っておく制限: 画面の外の行は DOM に無いので、ブラウザのページ内検索（Ctrl+F）と Tab では届かない（キーワードの絞り込みで探す）。1c の owned-rows で行の高さが固定になったら、高さを測らない形に簡単にしてよい。

**F. 理想個体: 再計算の省略と区切った計算** — I-10・Codex #4・2 回目 A・P2 性能

1. **署名**（views/ideal.js）:

   ```js
   // 所持パルのデータ（owned.state.owned は中身が変わったときだけ作り直される: owned.js:215）を番号にする
   const ownedIds = new WeakMap();
   let ownedSeq = 0;
   const ownedRev = (data) => (!data ? 0 : ownedIds.get(data) ?? (ownedIds.set(data, ++ownedSeq), ownedSeq));
   // データ・index・実効の条件・本人
   function planKey(state) {
     const self = conditions.holder === 'mine' ? (ideals?.mine()?.map((pal) => pal.id).join(',') ?? 'unknown') : '';
     return JSON.stringify([state.revision, state.env, ownedRev(owned?.state?.owned), to, [...passives].sort(), conditions.mode,
       TALENT_KEYS.map((key) => conditions.targets[key]), conditions.cake, conditions.holder, self]);
   }
   ```
   - `renderResults` の始めで `planKey` が前回の表示と同じなら、計算も DOM も触らない（I-10 の直し）。データがない・目標がないなどの早い戻りでは、前回の key を空にする（次に条件がそろったら必ず計算する）。
   - 1d の participant-self で「自分」が変わると `ideals.mine()` の結果が変わるので、key も変わる。
   - **ideal-calc の後**（2026-10-12 追記）: key の配列の最後に、牧場の署名（`farmSignature(placedFarms)`）と `prefer` の中身（`[...prefer.placed].sort()`・`[...prefer.baseline].sort()`）を足す。`prefer` は計画の並びを変えるので、入れないと、別のタブが基準を書き換えたときなどに古い並びが残る。そのため key は、layouts・`targetFarms`・`planMemory.get` を済ませた後（`idealPlan` の前）に作る。
2. **ジェネレーター**（core/ideal.js）: `idealPlan` の本体を `export function* idealPlanSteps(input)` に移し、二重ループの内側（:792 の `for (const female of females)` の先頭）で `if ((++work & 4095) === 0) yield;`。結果は `return`。ideal-calc の後は、入力の `prefer`・`watch` もそのまま受け、戻り値に `measures` を含める（`idealPlan` と同じ戻り値）。世代の表の作成（`generationTable`）は今の形ではループの前で区切れないので、手順 5 の上限（D18: 1 回 300ms まで。超えたら表の作成も分けて回す）で時間を見る。`export function idealPlan(input) { const steps = idealPlanSteps(input); let step; do { step = steps.next(); } while (!step.done); return step.value; }`（今の呼び出し・テスト・性能テストはそのまま）。core/ideal.js の import は './index.js' だけのまま（test/import.test.js:43）。
3. **区切って進める道具**（新規 web/js/ui/slice.js。core/ideal.js を import しない＝INV-2 の制限に触れない）:

   ```js
   /**
    * ジェネレーターを 1 回 budget ms までずつ進める。最初の区切りで終われば同期で { done: true, value } を返す（小さなデータ・テストは同期のまま）。
    * 終わらなければ { done: false, promise, cancel }。cancel() か signal の abort で古い計算を捨てる（promise は null で解決）。
    */
   export function startSliced(iterator, { budget = 30, now = () => performance.now(), schedule = (fn) => setTimeout(fn, 0), signal } = {}) { … }
   ```
4. **views/ideal.js の renderResults**: key が違えば前の仕事を `cancel()` し、`startSliced(idealPlanSteps({...}))`。同期で終われば今と同じく描く。終わらなければ、前の結果を残したまま results に `aria-busy="true"` と `is-computing` のクラス（CSS で薄く。高さは変えない）を付け、終わったら（その仕事がまだ最新なら）外して描く。描く中身は今の :473-493 をまとめた `showPlan(result, key)`（ideal-calc の後は、`farmAdvice(…, { measureOf })` と「変更あり」の絞り込みも含む）。`destroy` で `cancel()`。
5. **画面が止まる時間の上限と Worker にする条件**（D18。2026-10-12 にユーザーが決めた。README の [3-1](README.md#3-1-決定事項d1d18ユーザーの回答)）:
   - **分けて回せる計算**（`idealPlanSteps` の組のループ）: 1 回の区切りが 50ms 以内（今までどおり）。
   - **分けられない処理**（世代の表 `generationTable` の作成）: 新しい表が要るとき（条件を変えた直後、または所持パルの更新で必要な `parentExtras` が増えたとき）の 1 回だけなら、**300ms まで**許す。表を作る前に一度 `yield` して、結果に `aria-busy` と `is-computing`（「計算中」）を描いてから作る。表は 8 件までキャッシュされるので、同じ条件に戻ったときは止まらない。
     - 背景: 文書の点検の計測（開発に使っている PC）で、今のコードでも欲しい数が 2 以下なら 52〜260ms、ideal-calc の後は欲しい 4 つでも約 200ms（キノコケーキは表が 2 つで約 400ms）になる見込み。1000ms まで許す案は、遅い PC（2〜3 倍）で数秒止まるので採らなかった。50ms のままにする案は、Worker がほぼ確実に要るので採らなかった。
   - **表の作成が 300ms を超えたら、まず表の作成も分けて回す**: `buildGenerationTable` を生成関数にし、状態のループ（`:364-382`）と確定のループ（`:419-433`）の中で `yield` する。`generationTable` は、キャッシュにあれば今どおり返し、なければ生成関数を `idealPlanSteps` から `yield*` で回す（同期の `idealPlan` は最後まで回す）。途中で取り消したときは、作りかけの表をキャッシュに入れない。区切っても表の値が同じことをテストで確かめる。core/ideal.js の中だけの変更なので、import の制限は変わらず、ユーザーの確認は要らない（コードの形からの見込みで、まだ試していない）。
   - **Worker は最後の手段**: それでも、偏った分布（同じ種族の ♂ と ♀ が多い）で 1 回の区切りが 50ms を超えるか、区切った計算の合計が 5 秒を超えるときだけ、Worker を検討する。そのときは**専用の入口（例 web/js/ideal-worker.js）だけが core/ideal.js を読める**よう、test/import.test.js:38-44 の許可と data/SOURCES.md の「例外: 理想個体の提案に使う遺伝の仕組み」の節を、**変更記録つきで**直す（規約に関わるので、事前にユーザーの確認を取る）。
6. 所持者の選択肢（`renderHolders` :235-244）とパッシブ（`renderPassives` :364-369）も D-5 と同じく署名が同じなら作り直さず、フォーカス中は待つ（I-09）。
7. 個体値の目標（:213-216）は input を 150ms 間引き、change ですぐ（O-17 に吸収した I-06）。

**G. 継承ルート・設定の選択肢**（I-09・C-07）

1. views/route.js の renderOwned（:115-118）: パッシブ選択は `JSON.stringify([passives, [...counts]])` が変わったときだけ作り直す（フォーカス中は待つ）。
2. views/owned-settings.js:314: 署名から `state.busy` を外す。作った行の「編集・削除・CSV・共有の削除」のボタンを配列に覚えておき、render のたびに `disabled` だけを書き換える（busy の間に押せない動きは保つ）。:357-374 `renderWorldSelect`: option の中身（id と表示名）の署名が変わったときだけ作り直し、それ以外は value と disabled だけ。owned-view.test.js:413 付近の「行を開いたままにする」動きが変わらないことを確かめる。

**H. 入力の間引き**（ui/dom.js）— O-17

```js
/** 最後の呼び出しから ms 待って 1 回だけ呼ぶ。flush() ですぐ呼び、cancel() で取り消す。ms が 0 なら同期で呼ぶ */
export function debounce(fn, ms) { … }
/** テキストの入力を間引いて fn(value) を呼ぶ。日本語の変換中（compositionstart〜compositionend・event.isComposing）は呼ばず、確定したときに呼ぶ */
export function onTextInput(input, fn, { delay = 150, signal } = {}) { … }
```
- 使う所: 所持パルのキーワード（D-6）・所持パルの個体値（D-6）・理想個体の個体値（F-7）・一覧の登録者名（views/list.js:30-36 の registrant だけ。並べ替えの select はすぐ）。
- パル選択の検索欄は対象にしない（変換中も絞る方が便利。O-17 のリスク）。

**I. 高さを確保する**（S-35・V-28）

1. app.css:568 `.result-note` に `min-height: 1.5em;`（空のときも高さを保つ。文言は増やさない）。drafts-toolbar の `.result-note`（app.css:693 付近）の見た目を確かめる。
2. 同期バー: `.sync-progress[hidden] { display: block; visibility: hidden; opacity: 0; }`（場所を残して隠す）。ui/sync-progress.js:15 で hidden と一緒に `aria-hidden` を合わせる。hidden の切り替えは残す（app.test.js:278・286・298 がそのまま通る）。

**J. 新しい版の案内を下端の固定スナックバーに**（F029・V-28）

1. app.css:267-281 `.update-banner` を:

   ```css
   .update-banner {
     position: fixed; bottom: 24px; left: calc(var(--drawer) + 24px);
     width: auto; min-width: 320px;
     max-width: min(720px, calc(100% - var(--drawer) - 48px - 484px));   /* 484px = トーストの幅 460 + 右の余白 24（app.css:617） */
     margin: 0; z-index: var(--z-snackbar); box-shadow: var(--elevation-3);
   }
   ```
   - ここの `--drawer` はナビのレールの幅（96px。app.css:60）。フェーズ 3 のドロワーの幅とは別もの（ドロワーを開いたときの置き場所はフェーズ 3 の drawer で決める）。
   - `@media (prefers-reduced-motion: no-preference)` の中で、下から出る動き（`@starting-style { translate: 0 16px; opacity: 0; }`）。
   - 時間では消さない（今のまま「閉じる」がある）。
2. 再読み込みの保留（Codex D）: app.js:145-149 の `busy()` に、開いているダイアログ（`document.querySelector('dialog[open]')`）があれば「開いている入力画面を閉じてから、もう一度押してください。」を返す（登録の画面・ワールドの登録・名前の変更の入力を失わない）。
3. test/web/version.test.js は `element.hidden` で確かめている → hidden の切り替えは残す（ui/update-banner.js は変えない）。

**K. 並べ替えのときだけ View Transition**（新規 web/js/ui/motion.js）

```js
let running = null;
/** 行の順番が変わるときだけ使う。API が無い・動きを減らす設定・前の動きの途中なら、すぐ fn()（続けての操作は最新だけ描く） */
export function withTransition(fn) {
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (typeof document.startViewTransition !== 'function' || reduce || running) { fn(); return; }
  running = document.startViewTransition(fn);
  running.finished.finally(() => { running = null; });
}
```
- 使う所: 所持パルの並べ替え（views/owned.js:159-161 の sort）と一覧の並べ替え（views/list.js）。行が 2,000 を超えるときは使わない（スナップショットが重い）。

### 触るファイル

- web/js/store.js・web/js/views/shared.js・web/js/views/settings.js
- web/js/ui/dom.js（syncList・listKeys・clearList・debounce・onTextInput・anchorOf・restoreAnchor）
- 新規 web/js/ui/slice.js・ui/virtual-list.js・ui/motion.js
- web/js/views/search.js・reverse.js・pal.js・list.js・owned.js・ideal.js・route.js・owned-settings.js
- web/js/ui/breeding-card.js（data-focus）・web/js/ui/sync-progress.js
- web/js/core/ideal.js（idealPlanSteps）
- web/css/app.css（.result-note・.sync-progress・.update-banner・.owned-list.is-virtual・.is-computing）
- web/js/app.js（busy にダイアログ）
- テスト: test/web/store.test.js・新規 test/web/dom.test.js・新規 test/web/slice.test.js・新規 test/web/virtual-list.test.js・test/core/ideal.test.js・test/web/ideal-view.test.js・test/web/owned-view.test.js・test/web/views.test.js・新規 test/perf/owned.perf.js・test/perf/ideal.perf.js
- web/js/release-notes.js

### テスト

- **追加**:
  1. store.test.js: 同じ snapshot を 2 回 apply しても index は同じ参照で revision も同じ／etag が変われば revision が増える／楽観更新（update は etag を変えない）でも増える／失敗の巻き戻しでも増える／警告だけ変わったとき emit される（設定の警告が描き直される）。
  2. 新規 test/web/dom.test.js（syncList）: 並びが変わったとき位置の違う行だけ insertBefore される（呼び出しを数える）・同じ key の要素を使い回す・消えた行だけ destroy・フォーカスが同じ行の同じ `data-focus` に戻る・行が消えたら次の行へ・空の表示・clearList。debounce と onTextInput（`node:test` の mock.timers、compositionstart〜compositionend の間は呼ばない）。
  3. 新規 test/web/slice.test.js: 小さい仕事は同期で終わる／大きい仕事は schedule と now を差し替えて区切りごとに進む／cancel で null。
  4. test/core/ideal.test.js: `idealPlanSteps` を最後まで回した結果が `idealPlan` と同じ（いくつかの条件。ideal-calc の `prefer`・`watch` を渡したときの `pairs` と `measures` も）・大きい入力で 1 回以上 yield する。
  5. ideal-view.test.js: 同じデータ・同じ条件で store や owned が emit しても、結果のカードの要素が同じ（作り直していない）。条件を変えたら変わる。
  6. owned-view.test.js: 中身が同じセーブの読み直しで行の要素が同じ／キーワードを変えると一致の理由の行が変わる／250 行のとき最初は 200 行、タイマーを進めると 250 行／区切りの途中で destroy すると、それ以上行が足されない／選択肢が同じなら select の option が作り直されない／2,001 行で仮想になり、DOM の行の数が全体より少ない。
  7. 新規 test/web/virtual-list.test.js: `visibleRange` の端（先頭・末尾・overscan）。
  8. views.test.js: 一覧の親の順で 1 件 2 行の key が別（同じ配合の 2 行が両方出る）・取得し直しても同じ要素。
- **期待値が変わる既存のテスト**: input を dispatch した直後に結果を見ているテスト（owned-view.test.js:142-196 付近のキーワード・個体値、ideal-view.test.js の個体値）は、context に `inputDelay: 0` を足すか、change を dispatch する（O-17 のリスク）。ほかは同じ結果になるはず。
- **性能テスト**（`npm run test:perf`）:
  - 新規 test/perf/owned.perf.js: 20,000 体（同じ種族が 6 割の偏った分布）で、`filterOwned`＋`sortOwned`＋全行の `rowSignature`（キーワードあり）が 100ms 以内。
  - test/perf/ideal.perf.js に足す: ♂2,000×♀2,000（同じ種族）の `idealPlanSteps` を 30ms の区切りで回し、1 回の区切りの最大と合計を出す（区切りの最大 50ms 以内を確かめる。合計は記録だけ）。ideal-calc の後なので、和集合がそろい余計を 3〜4 個持つ親を混ぜ、`parentExtras` で大きくなった世代の表を**新しく作る**場合の時間も測る（D18: 表の作成は 1 回 300ms 以内を確かめる。キノコケーキの 2 つの表も。超えたら手順 F-5 のとおり表の作成も分けて回し、そのときは 1 回の区切り 50ms 以内を確かめる。ideal-calc の性能テストで分けて測った値と比べる）。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: ui/slice.js・ui/virtual-list.js は core/ideal.js を import しない。idealPlanSteps を import するのは views/ideal.js だけ（test/import.test.js:41 の制限のまま）。Worker にするときだけ、変更記録つきで制限を直す（F-5）。
- **互換**: 保存するデータは変えない。行のキーに中身の版（etag・updatedAt）と表示の向きを入れ忘れると、古い表示が残る（G-39・G-40 のリスク）。
- **セキュリティ**: 新しい部品も createElement と textContent だけ。
- **性能の予算**（Chrome で測る。共通の受け入れ条件）: 所持パル 2,000 行で最初の 200 行が 100ms 以内・全行が 1 秒以内、DOM 80,000 ノード以下・JS ヒープの増加 150MB 以下、2,000 行を超えたら仮想、20,000 行・偏った分布でも入力が 100ms 以上止まらない。超えたらこのテーマを終えずに直す。
- **テスト環境**: requestAnimationFrame・matchMedia・startViewTransition・scrollBy が無いことがある（typeof で確かめる）。分割描画のテストは timers を進めて確かめる。

### release-notes の案

- id: `<実装日>-stable-render`
- title: 「表示のずれと描き直しを削減」（13 字）
- body: 「取得のたびの作り直しをやめ、件数の行の高さを固定。新しいバージョンの案内は画面の下に出します。」（47 字。画面の文言は copy-dead-ends の用語表に合わせ「新しい版」と書かない）

### 完了の条件

- [ ] `npm test` と `npm run test:perf` が通る。
- [ ] モック（`?mock=1&seed=80`）の配合検索で親を選び替えても、結果のカードの位置が動かない（`.card-stack` の top が 27px 動かない。検証の表「配合検索で親を選ぶ → 動かない」）。
- [ ] 所持パル（注入スクリプト `Claude outputs/ui-audit-2026-10/shots/owned/inject.js`、129 行）で、セーブの読み直し（`owned.pollAuto` が走る 1 分）をはさんでも `document.documentElement.scrollHeight` が揺れず、見ていた行が同じ位置にある（検証の表「所持パルの行（129 行）→ 揺れない」）。
- [ ] 新しい版の案内（DevTools で `update.show` 相当を起こすか、版を変えて配信を模す）で本文がずれず、トーストと重ならない。ダイアログを開いたまま「読み込み直す」を押すと保留の文が出る。
- [ ] 理想個体を開いたまま 20 秒待っても、所持パルが変わらなければカードが作り直されない（DevTools で要素を覚えて同じか確かめる）。
- [ ] 理想個体の計算で、1 回の区切りが 50ms 以内、世代の表の作成が 1 回 300ms 以内（キノコケーキの 2 つの表を含む。表の作成の前に「計算中」が出る）。超えていたら表の作成も分けて回した（D18。値を末尾の「計測の記録」に書く）。
- [ ] **性能の予算**: 2,000 行・20,000 行（偏った分布）の注入（`inject.js` を元に、行数を引数にした写しを `Claude outputs/ui-audit-2026-10/shots/owned/` に作る。リポジトリには入れない）で、Performance パネルで最初の 200 行 ≤ 100ms・全行 ≤ 1 秒、`document.querySelectorAll('*').length` ≤ 80,000、ヒープの増加 ≤ 150MB、キーワードの入力中の Long Task ≤ 100ms。結果をこのドキュメントの末尾の「計測の記録」に書く。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — `test/import.test.js` が変更なしで通る（Worker にしたときだけ、変更記録つきで直し `data/SOURCES.md` にも書いた）。互換 — 保存するデータを変えていない。行のキーに表示の向きと中身の版が入っていて、楽観更新・巻き戻しでも古い表示が残らない。セキュリティ — 新しい部品も createElement と textContent だけ（`test/static/security.test.js`）。性能 — 上の予算の行を満たした。

### TODO

- [ ] store.js に revision と署名による index の据え置きを入れ、watchView と設定の警告を直す
- [ ] ui/dom.js に syncList・listKeys・clearList（フォーカスの復元つき）とテストを作る
- [ ] renderCards を syncList にし、検索・逆引き・パル詳細・一覧を寄せる（キーに表示の向きと版）
- [ ] 所持パルの行を fillOwnedRow と ownedRowItem（署名で更新）に分ける
- [ ] 所持パルの描画の仕事（先頭 200 行・16ms の区切り・古い仕事の破棄・destroy）を入れる
- [ ] 自動の更新の後に先頭の行の位置を戻す（anchorOf・restoreAnchor）
- [ ] ui/virtual-list.js を作り、2,000 行を超えたら仮想にする
- [ ] core/ideal.js に idealPlanSteps を足し（ideal-calc の `prefer`・`watch`・`measures` を通す）、ui/slice.js と views/ideal.js の署名（牧場の署名と `prefer` を含む）・区切った計算を入れる（表の作成の前に「計算中」を描く。表の作成が 300ms を超えたら表の作成も分けて回す＝D18）
- [ ] 所持パル・理想個体・継承ルート・設定の選択肢を署名で作り直さないようにする（フォーカス中は待つ）
- [ ] debounce・onTextInput を作り、キーワード・個体値・登録者名に使う（テストの inputDelay）
- [ ] .result-note の min-height と同期バーの場所を残す隠し方を入れる
- [ ] 新しい版の案内を下端の固定スナックバーにし、ダイアログが開いていたら再読み込みを保留する
- [ ] ui/motion.js（withTransition）を作り、所持パルと一覧の並べ替えに使う
- [ ] 性能テスト（owned.perf.js・ideal.perf.js の追加分）と、ブラウザでの予算の計測をする
- [ ] release-notes に 1 件足す

---

## keep-state: 位置と条件の保持・フォーカスの一般化

### 目的

- **位置**: 画面が替わったら先頭から、タブで戻ったら前の位置、戻る・進むはそのときの条件と位置に戻す。
- **条件**: 履歴のエントリごとに条件を残し、読み込み直しても（新しい版を読み込み直しても）所持パル・理想個体・一覧の条件が残る。最後に開いたタブから始められる。
- **フォーカス**: 作り直した後のフォーカスの戻し方を、2 つの決め打ち（app.js:255-258・277-284）から、`data-focus-key` の決まった手順に置き換える。
- 選んでいない欄の画像まで毎回ポップインする動きをやめる。

### 経緯

- 調査の案（付録 catalog.md）:
  - **G-37**（そのまま。工数 M）: 画面が替わったら先頭、タブで戻ったら前の位置、戻る・進むはブラウザの復元に任せる、高さが後から決まる画面ではデータが来てから 1 回やり直す。
  - **G-41**（直し）: `data-focus-key` で戻す対象を一般化（開始チップ・すべて・⇄・チップの ×・呼び出す・本文のリンク）、select が押せない（4 個目）なら残ったチップの最後の × へ、見つからなければ何もしない。「画面が変わったら h1 へ」は入れない。app.js の 2 つの決め打ちはこの仕組みで置き換える。
  - **G-48**（直し）: viewState（所持パルの絞り込み・理想個体の条件・一覧の並べ替え）とタブの行き先を、ID ごとのキーで sessionStorage に。保存は pagehide と visibilitychange(hidden) のとき。**版では捨てず**、項目ごとに型と許可された値を検査し、合わないものは既定に戻す。Map（planBaselines）は保存しない。forget() で消す。app.js:115・owned.js:75・ideal.js:180 のコメントと release-notes `2026-10-05-keep-view-state`（「ページを読み込み直すと元に戻ります」）と食い違うので、通知を 1 件足す。
  - **X-09**（そのまま）: 最後に開いたタブを ID ごとに localStorage に。URL のハッシュが空のときだけそこから始める（ブックマーク・通知のリンクは優先）。ログアウトでは消さない。
  - **V-20**（直し）: app.css:785-788 の選択欄の画像のポップインを消すだけ（候補が開く動き :782 は残す）。
- **Codex のプランレビュー**: 1 回目 **#9**（タブ操作・画面内の条件変更・履歴の移動を区別し、位置を保存する単位と復元の責任を決める。パル詳細は id まで区別）・**#13**（保存する条件のスキーマ・版・長さ・列挙値を決め、環境・利用者・必要ならワールドで分ける。URL の指定を優先。ログアウト・名前の変更・ワールドの切り替えの扱いを決める。最後のタブは許可した画面名だけ）、2 回目 **#9 / D**（ブラウザは JS の状態を履歴ごとに戻せない。app.js:176 は画面ごとに最新の 1 つだけ、views/owned.js:89 は URL の条件を消す → 履歴エントリ単位の条件の保存と、条件の適用 → 描画 → 位置の復元の順を明記）、3 回目 **新 2**（history から前の利用者・前のワールドの条件が戻る → 版・環境・利用者・ワールドを持たせ、合わなければ捨てる）。
- 計測（付録 measurements.md）: 配合検索を 500px スクロールしてカードのパル名を押すと、パル詳細が scrollY=364 の途中から表示される（見出しの top −261）。一覧を scrollY=2500 まで読んでから配合検索へ行き、一覧に戻ると 0。ブラウザの「戻る」では位置が戻った（scrollY=400）。継承ルートでチップの × → フォーカスが body。

### 依存 / このテーマでやらないこと

- 依存: render-contract（遷移の理由 `reason`・`context.update` の pushState・`context.replace` の state の保持）・data-boundary（`cleanSaved`）・stable-render（区切った描画が進んでから位置を戻す）。
- やらないこと: 「画面が変わったら h1 へフォーカス」（G-41 の判断で入れない）／ドロワーの開閉の保持（フェーズ 3）／所持パルの絞り込みを URL に全部載せる「リンクをコピー」（1c の owned-toolbar）／端末のデータ（下書き・目標）の保存の変更。

### 現状

- web/ にスクロールの処理がない（`scrollTo`・`scrollY`・`scrollRestoration` は 0 件。`scrollIntoView` は ui/pal-picker.js:116 と ui/record-editor.js:121 だけ）。
- app.js:115-128: viewStates（Map。メモリだけ）・`remember`（タブの href を覚える）・`forget`（ログアウトで消す）。:176-179 `viewState(view)`。
- views/owned.js:75-90: 絞り込みを viewState に。URL の条件を読んだら `#/owned` に replace する（条件が URL から消え、「戻る」で戻せない）。views/ideal.js:180-184: 条件（所持者・パッシブの条件・個体値・ケーキ。URL に出ない）を viewState に。views/list.js:20-23: 登録者名と並べ替え。
- release-notes.js:101-103 `2026-10-05-keep-view-state`「…ページを読み込み直すと元に戻ります。」
- app.js:255-258・277-284 のフォーカスの決め打ち（パル選択のトリガーと `.passive-add`。aria-label で探す）。views/route.js:100-113 は開始チップを replaceChildren で作り直す（押したチップが消える）。ui/passive-picker.js:21-25 チップの ×、:71 で 4 個目に select が押せなくなる。
- app.css:785-788 `.picker-trigger.has-selection .pal-icon img` の `@starting-style`（作り直すたびにすべての選択欄の画像が拡大して現れる）。
- router.js:10 ハッシュが空なら 'search'。store.js:68 で passcode・userId を localStorage から戻し、:163-169 でキャッシュがあれば env も同期で決まる（起動時に「ログイン済みでハッシュが空」を判定できる）。

### 設計

- **遷移の理由ごとの位置**（render-contract の `reason` を使う）

  | reason | いつ | 条件 | 位置 |
  |---|---|---|---|
  | `update` | 同じ画面の条件変更（context.update） | 変えた条件のまま | そのまま |
  | `navigate` | context.navigate・本文の中のリンク（`a[href^="#/"]` の click） | viewState（メモリ）のまま | 違う画面なら先頭（0） |
  | `tab` | ナビのタブの click | viewState のまま | その画面を離れたときの位置（`viewState(view).scrollY`。無ければ 0） |
  | `history` | 印のない hashchange（戻る・進む・手入力） | エントリに保存した条件（合わなければ使わない） | エントリに保存した位置（無ければ動かさない） |
  | `boot` | 起動・読み込み直し | エントリがあれば `history` と同じ。無ければ G-48 の保存 | エントリの位置か先頭 |
  | `auth` | ログイン・ログアウト | 消す（ログアウト） | 先頭 |

- **履歴のエントリ**: `history.state` には `{ palEntry: '<ID>' }` だけを入れる（ID は `Date.now().toString(36)` ＋乱数）。中身は sessionStorage の `<ns>.entries` に ID ごとに持つ（スクロールのたびに `history.replaceState` を呼ばないため。冒頭の「プランと違っていた点」の 13）。
  - 中身: `{ v: 1, id, env, user: userIdKey(userId), world: owned.state.meta?.worldId ?? '', view, key: routeKey(route), cond, scrollY, at }`。最大 50 件（古い順に捨てる）。
  - **合わなければ捨てる**: `v`（保存の形の版。このテーマで 1。アプリの版ではない）・env・user・world・view・key のどれかが今と違えば使わない（3 回目 新 2）。
- **G-48 の保存**（読み込み直し用）: sessionStorage の `<ns>.views` に `{ v: 1, env, user, world, views: { owned: { filter }, ideal: { conditions }, list: { registrant, sort } }, tabs: { [view]: href } }`。保存は `pagehide` と `visibilitychange`(hidden)。読み戻しは項目ごとに `cleanSaved`（data-boundary）で検査し、合わない項目だけ既定に戻す。world が違えば owned・ideal の条件は使わない（所持者がワールドのプレイヤーに依存するため）。
- **最後のタブ**（X-09）: localStorage の `<ns>.lastView.<userIdKey>` に**画面名だけ**（許可するのはナビのタブの名前＝app.js:103 の tabs の view。pal とログイン画面は入れない）。
- **条件の schema**（各ビューのモジュールが export する。app.js が集めて `cleanSaved` に渡す。views/ideal.js の schema は core/ideal.js の `PASSIVE_MODES`・`CAKES` を使ってよい＝import してよいのは views/ideal.js だけなので、schema もそこに置く）:
  - 所持パル（views/owned.js の `OWNED_MEMORY`）: holder（'' か `player:<uid>`・`base:<id>`・'global'。80 字）・place（`PLACE_ORDER` か ''）・palId（マスターにある ID か ''）・passives（文字列 64 字・最大 4 件）・query（100 字）・sort（`OWNED_SORTS` のキー。違えば 'dex'）・eggs・globals（真偽値。違えば既定）・stars（0〜4）・talent（各 0〜100）。**1c の owned-toolbar で絞り込みの形（場所のチップ・所持者）を変えたら、この schema も直す**。
  - 理想個体（views/ideal.js の `IDEAL_MEMORY`）: holder（'' か 'mine' か `player:<uid>`）・mode（PASSIVE_MODES の値）・targets（各 0〜100）・cake（CAKES の値）。登録する名前・planBaselines は保存しない。
  - 一覧（views/list.js の `LIST_MEMORY`）: registrant（30 字）・sort（5 つのキー）。
- **適用の順番**（2 回目 D）: ① 条件を当てる（エントリか G-48 の保存から viewState に書く）→ ② 描く（作り直すか applyRoute）→ ③ 位置を戻す（データが後から来て高さが足りなければ、届くまでやり直す）。
- **消すとき**: ログアウト（forget）で viewStates・タブの行き先・sessionStorage の entries と views を消す（最後のタブは ID ごとなので消さない。X-09）。名前の変更（userIdKey が変わる）で sessionStorage の entries と views を消す。表示中のワールドが別のワールドに替わったら、メモリの owned の `filter.holder` と ideal の `conditions.holder` を '' に戻す（エントリは world の比較で自然に捨てられる）。

### 実装の手順

1. **新規 web/js/ui/view-memory.js**:

   ```js
   /**
    * 位置と条件の保持。storage は sessionStorage（store.js の safeStorage で包む）、local は localStorage。
    * scope() は { env, user, world } を返す（合わない保存を捨てるため）。
    */
   export function createViewMemory({ storage, local, namespace, scope, schemas, now = Date.now }) → {
     newEntryId(): string,
     readEntry(id, { view, key }): { cond, scrollY } | null,        // 版・環境・利用者・ワールド・画面・URL が合わなければ null
     writeEntry(id, { view, key, cond, scrollY }): void,           // 最大 50 件
     saveViews({ views, tabs }): void,  loadViews(): { views, tabs } | null,   // G-48。項目ごとに schemas で検査
     lastView(user): string,  setLastView(user, view): void,       // X-09。許可した画面名だけ
     clear(): void,                                                // entries と views（lastView は残す）
   }
   ```
   - storage が使えない（無い・例外）ときは何もしない（今と同じく、読み込み直すと既定に戻るだけ）。
2. **app.js: エントリの ID**
   - `ensureEntry()`: `history.state?.palEntry` が無ければ `history.replaceState({ ...(history.state ?? {}), palEntry: memory.newEntryId() }, '', location.href)`。render の最後に呼ぶ（新しく来たエントリに ID を付ける）。
   - render-contract の `context.update` の pushState の state を `{ palEntry: memory.newEntryId() }` にする（push の前に今のエントリを保存: 手順 3）。
   - 起動時に `if ('scrollRestoration' in history) history.scrollRestoration = 'manual';`（位置はアプリが戻す）。
3. **app.js: 今のエントリを保存する**（`saveEntry()`）: `memory.writeEntry(history.state?.palEntry, { view: shownRoute.view, key: routeKey(shownRoute), cond: snapshotCond(shownRoute.view), scrollY: window.scrollY ?? 0 })`。`snapshotCond(view)` は viewState(view) のうち schema にある項目だけの写し。呼ぶ時:
   - 移る前: ナビのタブの click（`nav` の click で `.nav-tab` をたどって見つけたら `saveEntry(); intent = 'tab';`）、本文の中のリンクの click（`main.addEventListener('click', …)` で `a[href^="#/"]` をたどって見つけたら `saveEntry(); intent = 'navigate';`。document ではなく main に付ける＝テストの fake でも動く）、`context.navigate`・`context.update` の始め。
   - スクロール: `window.addEventListener('scroll', …, { passive: true })` を 300ms 間引いて `saveEntry()`（戻る・進むは hashchange の時点で前のエントリに書けないため、常に最新に近い位置を書いておく）。
   - `pagehide`・`visibilitychange`(hidden): `saveEntry()` と G-48 の `saveViews`。
   - 離れる画面の位置をメモリにも: render で画面が替わるとき（作り直しの経路）、作り直す前に `context.viewState(shownRoute.view).scrollY = window.scrollY ?? 0`（タブで戻ったとき用）。
4. **app.js: 適用の順番**（render の中。render-contract の形に足す）:
   1. reason が `history` か `boot` で、`readEntry(history.state?.palEntry, { view: route.view, key: routeKey(route) })` があれば、その cond を `viewState(route.view)` に書く（owned は `memory.filter` の object に `Object.assign`、ideal は `memory.conditions` に）。`boot` でエントリが無ければ、G-48 の `loadViews()` を viewStates に入れる（起動の最初に 1 回だけ）。
   2. 描く（作り直すか applyRoute）。**同じ画面で applyRoute するとき、owned・ideal のビューは viewState から入力欄（キーワード・select・個体値・チェック）も合わせ直す**（render-contract の applyRoute の冪等性に「viewState との同期」を足す）。
   3. 位置: 上の表のとおり `restoreScroll(y)`。
5. **`restoreScroll(y)`**（app.js か ui/view-memory.js）:
   - `requestAnimationFrame`（無ければ `setTimeout(…, 0)`）の後で `window.scrollTo?.(0, y)`。
   - ページがまだ短い（`document.documentElement.scrollHeight - innerHeight < y`。データの読み込み待ち・区切った描画の途中）なら、次のフレームでやり直す。最大 2 秒。
   - 次の遷移・利用者の操作（`wheel`・`keydown`・`pointerdown`。window に付け、AbortController で外す）があれば、やり直しをやめる。
6. **G-48 と X-09**:
   - 起動（boot）で、startRouter の前に: ログイン済み（`store.state.passcode && store.state.userId`）で `location.hash` が `''`・`'#'`・`'#/'` のとき、`memory.lastView(user)` が許可した画面なら、`history.replaceState(history.state, '', `${location.pathname}${location.search}${tabs[view] ?? buildHash(view)}`)`（tabs は loadViews のタブの行き先。無ければ画面名だけ）。ブックマーク・通知のリンクなどハッシュがあるときは何もしない。
   - `remember(route)` で、タブの画面なら `memory.setLastView(user, route.view)`。
   - G-48 のタブの行き先の読み戻しは、`#/` で始まり `parseHash(href).view` がその画面の名前と一致するものだけ。
7. **消す**: `forget()`（app.js:124-128）に `memory.clear()` を足す。store.subscribe で userIdKey が前と変わったら（名前の変更）`memory.clear()`。owned.subscribe で `meta?.worldId` が前の空でない値から別の値に変わったら、メモリの owned・ideal の holder を '' に。
8. **フォーカスの一般化**（新規 web/js/ui/focus.js。G-41）:

   ```js
   /** 作り直す前に、フォーカスのある要素（か先祖）の data-focus-key と data-focus-fallback を覚える（parentElement をたどる） */
   export function captureFocus(root) → { key, fallback } | null
   /** 作り直した後に「同じ key → fallback」の順に [data-focus-key="…"] を探して focus({ preventScroll: true })。
    *  見つかった要素が押せない（disabled）なら、同じ data-focus-group の最後の要素（残ったチップの ×）へ。見つからなければ何もしない */
   export function restoreFocus(root, token)
   ```
   - 付ける key: パル選択のトリガー `picker:<label>`（ui/pal-picker.js）・解除の × は key `picker-clear:<label>` と fallback `picker:<label>`・パッシブの追加欄 `passive:<label>`・パッシブのチップの × は key `passive-chip:<id>`・fallback `passive:<label>`・group `passive:<label>`（ui/passive-picker.js）・開始チップ `start:<palId>`・「すべて」`start:all`・⇄ `route:swap`（views/route.js）・理想個体の「呼び出す」`goal:<id>`（views/ideal.js）。同じ画面に同じラベルの部品が 2 つあるとき（継承ルートの目標と開始）はラベルが違うので重ならない。key に `"` を入れない（テスト用の DOM のセレクターが `[attr="値"]` を `"` で区切るため）。
   - app.js:255-258・277-284 の決め打ちを `const token = captureFocus(main)` → 作り直し → `restoreFocus(main, token)` に置き換える（同じ動きを保つ。app.test.js:302-322 は render-contract で「同じトリガーのまま」に直してある）。
   - ビューの中で一部を作り直す所でも使う: views/route.js の renderStartFilter（:112 の replaceChildren の前後）・arrange（:71-97）・passiveSlot の作り直し（popovers までの間）。
   - 追記（render-contract の実装、2026-10-12）: renderStartFilter・継承ルートの renderOwned・理想個体の renderPassives には、views/shared.js の `keepFocus` が入っている（開始チップには `data-focus-key` の `start:<palId>`・`start:all` も付けてある）。これを captureFocus／restoreFocus に置き換え、keepFocus は消す。
9. **V-20**: app.css:785-788 の `.picker-trigger.has-selection .pal-icon img` の規則（`@starting-style` のポップイン）を消す。:779-783 の候補が開く動きは残す。
10. **コメントと通知**: app.js:115・views/owned.js:75・views/ideal.js:180 の「ページを読み込み直すと既定に戻る／消える」を、「読み込み直しても同じタブ（sessionStorage）の間は残る」に直す。release-notes に 1 件（下）。

### 触るファイル

- web/js/app.js・web/js/router.js（`routeKey` を足すなら）・新規 web/js/ui/view-memory.js・新規 web/js/ui/focus.js
- web/js/views/owned.js・ideal.js・list.js（schema の export・applyRoute での入力欄の同期・コメント）・web/js/views/route.js（data-focus-key・captureFocus）
- web/js/ui/pal-picker.js・web/js/ui/passive-picker.js（data-focus-key）
- web/js/core/boundary.js（schema で使う小さな検査を足すなら）
- web/css/app.css（:785-788 を消す）
- test/web/app.test.js・新規 test/web/view-memory.test.js・新規 test/web/focus.test.js・test/web/owned-view.test.js・test/web/ideal-view.test.js
- web/js/release-notes.js

### テスト

- **テストの準備**: app.test.js の boot の `window` に、必要なテストだけ `sessionStorage`（Map で作る）・`scrollY`・`scrollTo(x, y)`（呼ばれた値を記録）・`innerHeight` を足し、`history` に `pushState(state, title, url)`（state を `history.state` に入れ、URL を location に反映）を足す。fake の `replaceState` も `history.state = state` を入れるように直す（今は URL だけ）。足さないテストでは、新しいコードが無い API を飛ばして今と同じに動くこと。（追記 2026-10-12: pushState の引数と replaceState の state は render-contract で入れた。「テスト環境の制約」の追記を参照）
- **追加**:
  1. app.test.js: 一覧で `scrollY` を 2500 にして配合検索へ（タブの click）→ 一覧のタブで戻ると `scrollTo(0, 2500)` が呼ばれる。配合検索のカードのパル名のリンクから詳細へ（本文のリンク）→ `scrollTo(0, 0)`。
  2. app.test.js: 理想個体で所持者・個体値を変えた後、別の画面へ移ってから「戻る」（`history.state` に前のエントリの ID を入れて hashchange）→ 条件が戻る。別の利用者・別のワールドのエントリは使わない（3 回目 新 2）。
  3. app.test.js: sessionStorage に G-48 の保存を入れて起動 → 所持パルの絞り込み・理想個体の条件が戻る。形の合わない項目（sort: 'xxx'、talent.hp: 150、holder に別のワールドのプレイヤー）は既定に戻る。保存の形の版（v）が違えば使わない。アプリの版（runningVersion）が違っても使う。
  4. app.test.js: localStorage に最後のタブ `owned` を入れ、ハッシュ '' で起動 → `#/owned`。ハッシュがあればそれを優先。`pal` や知らない名前は使わない。ログアウトしても最後のタブは消えず、entries と views は消える。
  5. 新規 test/web/view-memory.test.js: エントリの上限 50 件・scope の比較・storage が例外を投げても落ちない。
  6. 新規 test/web/focus.test.js: `captureFocus`／`restoreFocus` の key → fallback → disabled なら group の最後、見つからなければ何もしない。
  7. route-view・views のテスト: 開始チップを押して作り直しても、同じチップ（`start:<palId>`）にフォーカスが戻る。パッシブのチップの × の後、追加欄にフォーカスが戻る。
- **期待値が変わる既存のテスト**: owned-view.test.js:98-135（URL の条件を読んでから `#/owned` に replace する動き）は変えない（条件はエントリに残すので、URL から外す動きは今のまま）。app.test.js:324-352（タブを切り替えても選択を残し、ログアウトで忘れる）は通る見込み（forget で消す範囲が増えるだけ）。

### INV-2・互換・セキュリティ・性能の注意

- **互換**: sessionStorage・history.state・localStorage に新しく持つ値は、すべて読み戻しで `cleanSaved` を通す（共通の受け入れ条件）。旧コードのタブは、これらのキーを読まない・書かないので混ざっても壊れない。保存の形の版 `v` を変えたら、前の形は捨てる（形が違うだけで、アプリの版ではない）。
- **セキュリティ**: 保存するのは画面の条件と位置だけ。パスワード・記録の中身は入れない。タブの行き先は `#/` で始まるものだけ戻す。
- **テスト環境**: window の `hashchange` は足さない（render-contract と同じ）。足すのは `scroll`・`pagehide`・`wheel`・`keydown`・`pointerdown` で、テストの fake の名前ごとに 1 つの制約に当たらない（今 app.js が window に付けているのは beforeunload・storage と、ルーターの hashchange だけ）。
- **性能**: スクロールの保存は 300ms 間引き。位置のやり直しは最大 2 秒・フレームごと。

### release-notes の案

- id: `<実装日>-keep-position`
- title: 「画面の位置と条件を保持」（11 字）
- body: 「タブで戻ると前の位置に、戻る・進むで前の条件に戻ります。読み込み直しても条件が残ります。」（44 字）

### 完了の条件

- [ ] `npm test` が通る。
- [ ] モックで、配合検索を 500px スクロールしてカードのパル名を押すと、パル詳細が先頭（見出しと画像が見える）から表示される（検証の表「配合検索→パル詳細（scrollY=500）」の今の段階。ドロワーはフェーズ 3）。
- [ ] 一覧を scrollY=2500 まで読み、配合検索へ移ってから一覧のタブで戻ると 2500 付近に戻る。ブラウザの戻る・進むでも、そのときの位置と条件に戻る。
- [ ] 所持パル（注入した 129 行）で下の方を見てから理想個体へ行き、所持パルのタブで戻ると同じ行が見える（区切った描画が終わるのを待って戻る）。
- [ ] 理想個体で個体値の目標・ケーキを変えてから読み込み直す（F5・新しい版の「読み込み直す」）と、条件が残る。ログアウトしてログインし直すと残らない。
- [ ] ハッシュなしの URL で開くと、最後に開いたタブから始まる。
- [ ] 継承ルートで開始チップ・⇄・パッシブのチップの × を押しても、キーボードのフォーカスが body に落ちない。
- [ ] 条件を変えても、変えていない選択欄の画像がポップインしない。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: 互換 — sessionStorage・history.state・localStorage の値は読み戻しで `cleanSaved` を通り、版・環境・利用者・ワールドが合わなければ捨てる（別の ID・別の環境の値を入れて起動するテスト）。旧コードのタブと混ざっても壊れない。セキュリティ — 保存するのは条件と位置だけ（パスワード・記録の中身なし）、戻す行き先は `#/` で始まるものだけ（`test/static/security.test.js`）。性能 — スクロールの保存は 300ms の間引き、位置のやり直しは最大 2 秒で打ち切る。INV-2 — 対象外。

### TODO

- [ ] ui/view-memory.js（エントリ・G-48 の保存・最後のタブ・clear）と単体テストを作る
- [ ] 所持パル・理想個体・一覧の条件の schema を各ビューから export する
- [ ] app.js でエントリの ID を付け（ensureEntry・update の pushState）、scrollRestoration を manual にする
- [ ] 移る前・スクロール・pagehide・hidden で今のエントリを保存する（タブ・本文のリンクの click で intent を付ける）
- [ ] render に「条件を当てる → 描く → 位置を戻す」を入れ、restoreScroll（やり直し・取りやめ）を作る
- [ ] owned・ideal の applyRoute で viewState から入力欄を合わせ直す
- [ ] 起動時の最後のタブ（ハッシュが空のときだけ）とタブの行き先の読み戻しを入れる
- [ ] ログアウト・名前の変更・ワールドの切り替えで消す
- [ ] ui/focus.js を作り、各部品に data-focus-key を付け、app.js の決め打ちを置き換える
- [ ] app.css:785-788 のポップインを消す
- [ ] コメント（app.js:115・owned.js:75・ideal.js:180）を直す
- [ ] app.test.js の fake に sessionStorage・scrollTo・pushState を足し、位置・条件・最後のタブ・消去のテストを書く
- [ ] release-notes に 1 件足す
- [ ] モックで位置・戻る/進む・読み込み直し・フォーカスを確かめる

---

## popovers: ポップオーバーの共通化・パル選択・パッシブ選択

### 目的

- パル選択の固定配置の計算を `ui/popover.js` に切り出し、`{ element, update, destroy }` の契約の部品にする（document・window のリスナーは AbortController で外す）。
- **パル選択**: 所持している種族を先に「♂3 ♀2」、記録を探す画面では登録件数、継承ルートでは目標までの回数を出す。番号の頭の 0・先頭一致・英名・属性・パートナースキルでも探せる。選んでいる行と矢印で動かしている行を見分ける。
- **パッシブ選択**: native の select を「[パッシブを追加… ▾]＋選んだチップ」の 1 行の部品にし、ポップオーバーで名前・効果を検索して選ぶ。所持パル・理想個体・継承ルートで共用し、呼び出し側は作り直さず `update` を呼ぶ。登録した組み合わせ（プリセット）から入れられる。

### 経緯

- 調査の案（付録 catalog.md。直しを優先）:
  - **G-60**（直し・第 1 段だけ）: 所持パル・理想個体の目標・継承ルートの「他のパル…」で、所持している種族を先に「♂3 ♀2」つきで。最近選んだパル・属性の絞り込みは入れない。所持数は `ownedBySpecies` 系から（配合の候補ではないので INV-2 に触れない）。
  - **S-19**（直し）: 配合検索の親は「親 N 件」、逆引きの子は「子 N 件」を行の右に、0 件は薄く（opacity ではなく色の変数で）。**並び順・見出し・↑↓・Enter の仕様は変えない**（437536b で「最近使ったパルの並べ替え」をなくした判断と食い違わないように）。
  - **S-17**（直し）: プレースホルダーを「名前・英名・番号で探す」に。属性は語が属性名に完全一致したとき（「闇」「闇属性」「Dark」）だけ、パートナースキルは 2 文字以上の語がスキル名に含まれるときだけ一致にし、名前の一致の後に並べて「パートナースキル: ○○」を添える。空白区切りの複数の語。ID の部分一致はやめて完全一致に（「Grass」で `_Grass` の 13 体が出る件）。
  - **S-18**（そのまま）: 数字だけの語の頭の 0 を外し、並びを「番号・ラベルの完全一致 → 番号の前方一致 → 名前（和名・英名）の先頭一致 → 部分一致」に。
  - **G-61**（そのまま）: 選んでいる行は背景なし・✓・太字、矢印の行は背景と左の帯。開いたら選んでいる行を見せる。position は −1 のまま（**↑↓で選んでいないときの Enter は何もしない＝df0ab4e の決まり**）、↓ は選んでいる行の次から。
  - **S-22**（直し）: 格子にはせず、高さだけ `min(60vh, 520px)`・浮かせる表示の上限を 560 に。
  - **R-09**（直し）: palPicker に省略できる注記の口を 1 つ。継承ルートの開始の選択欄でだけ、目標から逆向きに 1 回 BFS して回数を求め、「2回」を付けて先に、届かないパルは薄く後ろに。見出しは入れない。
  - **R-10**（直し）: パッシブの選択を pal-picker と同じ検索つきポップオーバーに（3 タブ同時）。閉じた select で ↓ を押すと 1 個ずつ追加される不具合も直る。候補は passiveChip・所持数・効果 1 行。群は「所持パルが持っている」「その他（std）」の 2 つ（「ランク 3 以上」は入れない）。マスターに無い内部名も「所持パルが持っている」に出す。検索は normalizeQuery で和名・英名・効果。
  - **O-13**（そのまま）: チップを追加欄の右に並べ、1 個目を選んでも下が 44px 下がらないようにする。
  - **O-14**（直し）: 所持パルの所持数を `passiveCounts(filterOwned(pals, filter))`（選んでいるパッシブも含めた今の結果の中の数）にし、見出しを引数で変えられるように（所持パル「いまの絞り込みの中で持っているもの」・継承ルート「所持パルが持っているもの（タマゴを含む）」）。
  - **I-49**（そのまま）: 理想個体では、目標を選んでいるとき群を「{目標}と配合の親が持っているもの」「ほかの所持パルが持っているもの」に分ける（`breedingLayouts(state.index, to)` の種族）。
  - **I-50**（直し）: 理想個体・継承ルートの欲しいパッシブでは、負のパッシブを最後の群「マイナスのパッシブ」に（所持パルでは今のまま）。Collator の並べ替え・最近選んだものは入れない。
  - **I-51**（直し）: 登録した理想個体のパッシブの組み合わせ（重複を除き新しい順に 5 件）を「登録した組み合わせ」として出し、押すと選択をその組で置き換える（1 回の onChange）。理想個体と継承ルートだけ。名前を付けて保存はしない。
  - **V-35**（直し）: `passiveChip(id, { compact: true })` を足し、views/ideal.js:118・391・393 の文字のパッシブ名をチップに（ボタンは「[伝説] を運ぶ経路」の形）。
- 別プラン **F058**・§9 **P2-6**（部品は `{ element, update({ selected, counts }), destroy() }`、document・window のリスナーは AbortController、候補のクリックは**その場で onChange**（未確定の状態を持たない）、**開いている間に update が来ても閉じず**所持数だけ描き直す、Escape・外側のクリック・スクロールで閉じる、呼び出し側は作り直さず update）、§9 **P2**（パッシブ部品の update は selected も同期し、検索語・ハイライト・フォーカスを保つ）、**F055**（プリセット）、**F077**（パル選択に「データあり」の群と件数。統合プランでは S-19 の形＝並びは変えずバッジ）。
- **Codex 1 回目 #17（中）**: stable-render で select を使い回した後に passive-picker で select 自体を置き換えると二重作業 → ポップオーバーの共通化と picker の更新・破棄の契約をフェーズ 1 の前半へ。**#20（低）**: pal-picker は候補を毎回作り直すので、所持数を候補ごとに全件走査すると重い → 所持数・性別数・登録件数はデータの更新時に 1 回集計し、候補は Map で引く。

### 依存 / このテーマでやらないこと

- 依存: render-contract（選んだら `context.update` で、部品を作り直さずに `update`）・header-frame（`--z-popover`）・keep-state（`data-focus-key`。チップの × の後のフォーカス）。
- やらないこと: パル選択の格子表示（S-22 の判断）／最近選んだパル・属性のアイコンの絞り込み（G-60 の第 2 段・アイコンはフェーズ 4）／パル選択の「データあり」の群の見出しとキー操作の追加（フェーズ 3 の pal-detail の F077・F078）／ホバーの解説（F059。フェーズ 3）／ウィッシュリストの「追加済み」（フェーズ 2 で目標に統合）／所持パルの絞り込みへのプリセット（I-51 の判断で要望があってから）／名前を付けて保存するプリセット。

### 現状

- **パル選択**（ui/pal-picker.js）: `filterPals`（:8-14）は `palMatches`（core/kana.js:7-12。和名・英名・ID・ラベル・番号の部分一致）で絞り、番号・ラベルの完全一致の後は図鑑順。`palPicker({ label, value, onChange, popupHost, placeholder })`（:16）。検索欄のプレースホルダー「名前・図鑑番号で探す」（:53）。浮かせる配置の計算（:83-106。trigger の rect から left・width・max-height・上下、scroll（候補の外）・resize・ダイアログの cancel で閉じる。AbortController :69）。highlight（:108-119。矢印の行と選んでいる行が同じ背景 app.css:489-492、position>=0 のときだけ scrollIntoView）、renderOptions（:120-138。position=−1、検索語が空なら先頭に「パルを選択」）、Enter は矢印で選んだときだけ（:149-150）。`{ element, setValue, getValue, destroy }`（:160-165）。.picker-options の max-height 300px（app.css:474）、浮かせる表示の上限 400px（:99）。
- **パッシブ選択**（ui/passive-picker.js:39-77 `passiveSelector`）: 毎回新しい要素を返す。`wrapper.append(chips, select)`（:75。チップの行が先で、空のときは :empty で隠れる → 1 個目でチップの行 44px が現れて下が下がる）。native の select（optgroup「所持パルが持っているもの」「その他」:49-52）、並びは所持数 → ランク（:53）、std でない所持なしは出さない（:57）、マスターに無い内部名も出す（:62-68）、change ですぐ onChange（:72-74）、4 個で disabled（:71）。
- **呼び出し側**: views/owned.js:196-208（`passiveCounts(state.owned?.pals)` でデータ全体を数える。作り直して :205 でフォーカスを戻す）、views/ideal.js:364-369（`passiveCounts(ofHolder(全種族の親の候補))`）、views/route.js:115-118（`passiveCounts(pals)`）。app.js:257-258・282-284 の `.passive-add` のフォーカスの決め打ち（keep-state で一般化済み）。
- **文字のパッシブ**: views/ideal.js:118（「余計なパッシブ: …」）・:391（配合では作れない警告）・:393（「○○を運ぶ経路」のボタン）。
- **データ**: web/data/passives.js（id・ja・en・rank・std・desc）、web/data/pals.js（ELEMENTS・el）、web/data/skills.js:337 `PARTNER_SKILLS`（パル ID → 名前）。core/route.js:11-40 `buildCarrierGraph`（`Map<from, Map<to, options>>`）。core/owned.js:353-361 `ownedBySpecies`・:364-368 `passiveCounts`・:259-261 `keywordTerms`。core/ideal.js:153 `breedingLayouts`（export 済み）。ideals.js の `list()`。
- **テスト**: test/web/pal-picker.test.js:87-97（filterPals の期待値）・:130・186・202（aria-selected と ArrowDown）。ideal-view.test.js:178・210・352・465（`.passive-add` の option を数える）。

### 実装の手順

1. **新規 web/js/ui/popover.js**

   ```js
   /** pal-picker.js:83-106 の計算を切り出したもの。anchor の位置から popup の left・width・max-height と上下を決め、CSS 変数に書く */
   export function placeFloating(popup, anchor, host, { minWidth = 320, maxHeight = 560 } = {}) { … }   // --picker-left・--picker-width・--picker-max-height・--picker-top/--picker-bottom
   /**
    * 開閉と外側の操作。open() で popup を付ける（floating なら host＝document.body かダイアログ、そうでなければ wrapper の中）。
    * 外側の pointerdown・Escape・（floating のとき）popup の外のスクロール・resize・ダイアログの cancel で閉じる。リスナーは AbortController で外す。
    */
   export function createPopover({ anchor, wrapper, host = null, className = 'picker-popover', onClose }) →
     { element, open(), close({ focus = true } = {}), isOpen(), reposition(), destroy() }
   ```
   - 本文の中で開くもの（今の pal-picker の既定）は今のまま wrapper の中（z-index は `--z-panel`）。**sticky のパネルの中で上に開く・ダイアログの中・候補が本文の外にはみ出す所**では host を渡して浮かせる（z-index は `--z-popover`）。
   - header-frame のセーブ連携の状態と ID のメニューも、この部品に移す（今はベルのパネルと同じ作り）。
2. **パル選択の検索**（新規 web/js/core/pal-search.js。DOM なし）:

   ```js
   /** 語（空白区切り。keywordTerms と同じ）をすべて含むパルを、一致の段階と図鑑順で並べる。note は名前以外で一致したときの添え書き */
   export function searchPals(pals, query, { partnerSkills = PARTNER_SKILLS, elements = ELEMENTS } = {}) → [{ pal, tier, note }]
   ```
   - 語ごとの一致の段階（小さいほど上）: 0 番号・ラベルの完全一致（数字だけの語・数字で始まる語は頭の 0 を外して比べる: `term.replace(/^0+(?=\d)/, '')`）→ 1 番号・ラベルの前方一致 → 2 和名・英名の先頭一致 → 3 和名・英名の部分一致・ID の**完全一致** → 4 属性の完全一致（`ELEMENTS[el]`・`${ELEMENTS[el]}属性`・英名の小文字）→ 5 パートナースキル名を含む（語が 2 文字以上のときだけ。note「パートナースキル: ○○」）。パルの段階は語ごとの段階の最大。同じ段階は図鑑順（今の `a.no - b.no || variant`）。
   - 比べるときは `normalizeQuery`（core/kana.js:1-5）で、ひらがな／カタカナ・全角／半角・大小をそろえる。
   - ui/pal-picker.js の `filterPals(query)` は `searchPals(activePals, query).map(({ pal }) => pal)` に（ほかの所が使っていれば互換のため残す。grep では pal-picker.js の中だけ）。プレースホルダーを「名前・英名・番号で探す」に。
3. **パル選択の注記**（ui/pal-picker.js）:
   - 引数に `describe`（省略可。開くたびと update のたびに呼ぶ関数）を足す: `describe() → { order?: Map<palId, number>, badges?: Map<palId, string>, dim?: Set<palId> }`。
   - 並び: 検索語が空のとき、`order` があれば order の小さい順（無いパルは後ろ。同じなら図鑑順）。検索語があるときは、一致の段階 → order → 図鑑順。**記録を探す画面（配合検索・逆引き）では order を渡さない**（並びを変えない。S-19 の判断）。見出しの行は作らない（↑↓の数え方を変えない）。
   - 行: palTile の右に `badges` の文字（`.picker-badge`）、`dim` の行は `.is-dim`（文字を薄い色の変数で。opacity は使わない）、検索の note は `.picker-note`。
   - 返す値に `update({ describe })` を足す（開いていたら候補を描き直す。検索語と矢印の位置は id で保つ）。
   - G-61: 選んでいる行は `.is-selected`（背景なし・太字・右に ✓。✓ は createElementNS の SVG）、矢印の行は `.highlighted`（`--md-sys-color-secondary-container` の背景と左 3px の primary の帯）。app.css:489-492 の 2 つを分ける。開いたら選んでいる行を `scrollIntoView({ block: 'center' })`（position は −1 のまま）。position が −1 のときの ↓ は選んでいる行の次から、↑ は前から。**Enter は position>=0 のときだけ**（:149-150 のまま）。
   - S-22: `.picker-options { max-height: min(60vh, 520px); }`（app.css:474）、浮かせる上限を 560（placeFloating の maxHeight）。
   - data-focus-key `picker:<label>`（keep-state）を trigger に。
4. **所持数・件数・回数の集計**（データの更新時に 1 回。候補は Map で引く。Codex #20）:
   - core/owned.js に `speciesGenderCounts(pals) → Map<palId, { M, F, total }>`（タマゴは数えない）。views は owned のデータごとに WeakMap で覚える。バッジは「♂3 ♀2」（性別の分からない個体だけなら「3 体」）。
   - core/route.js に `distancesTo(graph, target) → Map<palId, number>`（逆向きの隣接を作って BFS。graph と target ごとに WeakMap で覚える）。バッジは「N 回」、届かないパルは dim で後ろ。
   - 登録件数は `state.index.byParent.get(id)?.length`・`byChild`（core/index.js:20-27 の Map を引くだけ）。
   - 使う所:

     | 画面の選択欄 | order | badges | dim |
     |---|---|---|---|
     | 配合検索の親 1・親 2（views/search.js） | なし | 「親 N 件」 | 0 件 |
     | 逆引きの子（views/reverse.js） | なし | 「子 N 件」 | 0 件 |
     | 継承ルートの目標（views/route.js:47） | 所持している種族を先に | 「♂a ♀b」 | なし |
     | 継承ルートの開始（「他のパル…」:76 と、所持パルなしの形の開始 :82） | 目標までの回数の少ない順 | 「N 回」 | 届かない |
     | 理想個体の目標（views/ideal.js:197） | 所持している種族を先に | 「♂a ♀b」 | なし |
     | 所持パルのパル（views/owned.js:151） | 所持している種族を先に | 「♂a ♀b」 | なし |
     | 登録の画面・下書き | なし（今のまま） | なし | なし |
5. **パッシブ選択の部品**（ui/passive-picker.js の `passiveSelector` を作り替える）:

   ```js
   /**
    * パッシブを最大 max 個まで選ぶ 1 行の部品（[パッシブを追加… ▾] ＋ 選んだチップ）。
    * groups: 候補の群 [{ label, counts: Map<id, n> }]。無ければ counts から「countLabel」の群と「その他」の 2 群。
    * negatives: 'last'（負のパッシブを最後の群「マイナスのパッシブ」に。理想個体・継承ルート）| 'inline'（所持パル）
    * presets: [{ label, passives }]（登録した組み合わせ。押すと選択をその組で置き換える）
    */
   export function passiveSelector({ label, selected, counts = new Map(), countLabel = '所持パルが持っているもの', groups,
     negatives = 'inline', presets = [], onChange, max = 4 }) → { element, update({ selected, counts, groups, presets }), destroy() }
   ```
   - **見た目**（O-13）: `.field.passive-selector` の中に見出しと 1 行（`display: flex; flex-wrap: wrap; align-items: center; min-height: 40px`）: 追加のボタン `.passive-add`（クラス名は残す。aria-label `${label}を追加`・aria-haspopup="listbox"・aria-expanded・data-focus-key `passive:<label>`。文字は「パッシブを追加… ▾」、max に達したら「最大 4 個まで」で disabled）→ 選んだチップ（`passiveChip(id, { onRemove })`。× に data-focus-key `passive-chip:<id>`・fallback と group `passive:<label>`）。
   - **開く**: ボタンの click・↓・Enter・Space（閉じたボタンで ↓ を押しても追加しない＝R-10 の不具合が直る）。
   - **ポップオーバーの中**: ①「登録した組み合わせ」（presets があるときだけ。各行は compact のチップの並びのボタン。押すと `onChange(preset.passives.slice(0, max))`）→ ② 検索欄（role="combobox"・placeholder「名前・効果で探す」）→ ③ 件数の行 → ④ 候補（role="listbox"。群の見出しは role="presentation" で ↑↓ の対象にしない。候補は role="option"・id・tabIndex −1・mousedown で preventDefault（pal-picker.js:128-130 と同じ理由））。候補の中身は `passiveChip(id, { compact: true })`・所持数「N 体」（あれば）・効果 1 行（`.passive-option-desc`。ellipsis）。
   - **並びと群**: groups が無いとき、「countLabel」の群＝所持数 > 0（所持数の多い順 → ランクの高い順 → passives.js の順）、「その他」＝std で所持数 0（ランクの高い順）。`negatives: 'last'` なら rank < 0 を最後の群「マイナスのパッシブ」へ。マスターに無い内部名で所持数があるものは最初の群（名前は id のまま）。選んでいるものは候補から外す。
   - **検索**: `keywordTerms`（空白区切り・すべてを含む）で、和名・英名・効果・id を normalizeQuery して部分一致。
   - **選ぶ**: クリック、または ↑↓ で選んだ後の Enter（↑↓で選んでいないときの Enter は何もしない＝pal-picker と同じ決まり）→ **その場で** `onChange([...selected, id])`（未確定の状態を持たない）。ポップオーバーは閉じない。
   - **update**: `update({ selected, counts, groups, presets })` が来たら、ボタンとチップを合わせ直し（同じ id のチップは使い回す）、開いていれば候補だけ描き直す（検索語・入力のフォーカス・矢印の位置（id で）を保つ。**閉じない**）。selected が max に達したら閉じて、最後のチップの × にフォーカス（keep-state の group）。
   - **閉じる**: Escape（追加ボタンへフォーカス）・外側のクリック・（浮かせているとき）スクロール。リスナーは popover.js の AbortController。`destroy` で外す。
   - **compact のチップ**（V-35）: `passiveChip(id, { compact: true, onRemove })` → `.passive-chip.compact`（min-height 22px・font-size 12px・min-width auto・矢印 14px）。
6. **呼び出し側を「作り直さず update」に**:
   - **所持パル**（views/owned.js:196-208）: 生成時に 1 回作り、`renderPassives` は `passive.update({ selected: filter.passives, counts })`。counts は `passiveCounts(filterOwned(pals, filter))`（O-14。選んでいるパッシブも含めた今の結果の中の数）、countLabel「いまの絞り込みの中で持っているもの」、negatives 'inline'。絞り込み（キーワードは間引きの後）が変わるたびに counts を update。:205 のフォーカスの戻しは消す（作り直さないので要らない）。
   - **理想個体**（views/ideal.js:364-369）: `to` があるとき groups は I-49 の 2 群（`breedingLayouts(state.index, to)` の種族の集合で、親の候補 `ofHolder(pals.filter(isParentCandidate))` を分けて passiveCounts）。`to` が無いときは 1 群。negatives 'last'。presets は `ideals.list()` の passives（空でないもの）を重複を除いて新しい順に 5 件、label は目標の名前。applyRoute（パッシブの変更）と update（データの変更）で `passive.update`。
   - **継承ルート**（views/route.js:115-118）: countLabel「所持パルが持っているもの（タマゴを含む）」、negatives 'last'、presets は理想個体と同じ（context.ideals があるとき）。
   - stable-render で入れた「署名が同じなら作り直さない」比較（D-5・F-6・G-1）は、update に置き換わるので消す。
   - 理想個体・継承ルートのパッシブの欄を作り直すところにある `keepFocus`（render-contract で足したもの。keep-state で restoreFocus にしていればそれ）も、作り直さなくなるので外す（追記 2026-10-12）。
7. **文字のパッシブをチップに**（V-35）: views/ideal.js:118 の「余計なパッシブ: …」・:391 の警告の中のパッシブ名・:393 のボタン（「[伝説] を運ぶ経路」＝ボタンの中に compact のチップ＋文字）。チップの title とボタンの title が重ならないよう、ボタンには title を付けない。1b の ideal-results でこの 3 か所を作り直すときは、このチップの形を引き継ぐ。
8. **CSS**（app.css）: `.passive-row`（1 行・min-height 40px）、`.passive-option`・`.passive-option-desc`・`.passive-group-label`、`.picker-option.is-selected`・`.highlighted` の分離、`.picker-badge`・`.picker-note`・`.is-dim`、`.passive-chip.compact`、`.picker-options` の max-height。app.css:958-960（`.passive-selector .passive-list` の下の余白・`:empty` で隠す・`.passive-add` の最大幅）の、チップの行を select の上に置く前提の規則を見直す。

### 触るファイル

- 新規 web/js/ui/popover.js・新規 web/js/core/pal-search.js
- web/js/ui/pal-picker.js・web/js/ui/passive-picker.js・web/js/core/kana.js（使うなら）・web/js/core/owned.js（speciesGenderCounts）・web/js/core/route.js（distancesTo）
- web/js/views/search.js・reverse.js・route.js・ideal.js・owned.js
- web/js/ui/save-status.js・web/js/ui/account-menu.js（ui/popover.js へ移す）
- web/css/app.css
- test/web/pal-picker.test.js・新規 test/web/passive-picker.test.js・新規 test/web/popover.test.js・新規 test/core/pal-search.test.js・test/core/kana.test.js・test/core/route.test.js・test/core/owned.test.js・test/web/ideal-view.test.js・test/web/owned-view.test.js・test/web/route-view.test.js・test/web/views.test.js
- web/js/release-notes.js

### テスト

- **期待値が変わる既存のテスト**:
  - test/web/pal-picker.test.js:87-97（`filterPals` の結果: 先頭一致が上に来る・ID は完全一致だけ・「030」で 30 番が出る）。:130・186・202（aria-selected と ArrowDown: ↓ が選んでいる行の次から始まる）。
  - test/web/ideal-view.test.js:178・210・352・465（`.passive-add` の option を数えている）→ 追加のボタンを押してポップオーバーを開き、`[role="option"]` を数える形に。:352 の所持数（候補の「N 体」）、:465 の追加の操作（候補を click）。
  - test/web/owned-view.test.js のパッシブの選択（select の change）→ 候補の click に。所持数が絞り込みの後の数になる（O-14）。
  - views.test.js・route-view.test.js の select 前提の箇所（あれば）。
- **追加**:
  1. 新規 test/core/pal-search.test.js: 「030」→ 30 番、「8」の先頭一致が上、「ラ」で始まる名前が上、「闇」「闇属性」「dark」で闇属性、「grass」で ID の部分一致が出ない、2 文字以上でパートナースキル（note 付き・名前の一致の後）、1 文字ではスキルを見ない、「炎 竜」で両方を含む。
  2. 新規 test/web/popover.test.js: open で付き、外側の pointerdown・Escape・destroy で外れる（AbortController でリスナーが外れる＝テスト用の DOM の signal 対応 test/helpers/dom.js:81-83 を使う）。placeFloating が上下を選ぶ。
  3. 新規 test/web/passive-picker.test.js: 1 行の並び（ボタン → チップ）、閉じたボタンで ↓ を押しても追加されない、候補の click で onChange が 1 回・ポップオーバーは開いたまま、update で候補の所持数が変わっても閉じず検索語が残る、max で閉じて最後の × にフォーカス、`negatives: 'last'` で負のパッシブが最後の群、groups の 2 群、presets の click で置き換え、マスターに無い内部名が出る、Enter は矢印で選んだときだけ。
  4. pal-picker.test.js: describe の badges・dim・order（order なしでは並びが変わらない）、開いたら選んでいる行が見える、update で開いたまま描き直す。
  5. test/core/route.test.js: `distancesTo`（直接の親は 1、届かないパルは入らない、目標は 0）。test/core/owned.test.js: `speciesGenderCounts`（タマゴを数えない）。
  6. ideal-view.test.js: 目標を選ぶと群が 2 つになる（I-49）・登録した組み合わせが出る（I-51）・余計なパッシブがチップで出る（V-35）。
- **性能**: 20,000 体の `speciesGenderCounts` と 300 種の BFS は 1 回で数 ms の見込み（test/perf に足すなら所持パルの計測の中で）。

### INV-2・互換・セキュリティ・性能の注意

- **INV-2**: 継承ルートの回数（`distancesTo`）は `state.graph`（登録済みの記録だけで作る。core/route.js:11-40）から。所持数は所持データだけ。I-49 の群の種族は `breedingLayouts`（views/ideal.js から呼ぶ。core/ideal.js を import するのは今と同じく views/ideal.js だけ）。配合表は使わない。
- **互換**: URL の形（`p=a,b`）は変えない。キーボードの決まり（矢印で選んでいないときの Enter は何もしない。df0ab4e）を守る。437536b の判断（使用履歴の並べ替えはしない）を守る（記録を探す画面の並びは変えない）。
- **セキュリティ**: ✓ や矢印は createElementNS、名前・効果は textContent、位置は `style.setProperty('--picker-…')`。
- **性能**: 集計はデータの更新時に 1 回（WeakMap）、候補は Map で引く。パッシブの候補は約 120（std 115 件）＋所持の内部名なので、開くたびに描いても軽い。

### release-notes の案

- id: `<実装日>-passive-search`
- title: 「パッシブを検索して選べる」（12 字）
- body: 「パッシブを名前・効果で検索して選べます。パル選択に所持数・登録件数・回数を出します。」（42 字）

### 完了の条件

- [ ] `npm test` が通る。
- [ ] モックで、所持パル・理想個体・継承ルートのパッシブを足しても、下の欄・一覧が下がらない（1 個目でも。検証の表「継承ルート・所持パルでパッシブを足す → 動かない」）。
- [ ] パッシブの候補を名前・効果（例「攻撃」）で探せ、選んでもポップオーバーが閉じず続けて選べる。閉じたボタンで ↓ を押しても勝手に追加されない。
- [ ] 理想個体でパッシブを足した後・継承ルートでチップの × を押した後、フォーカスが追加のボタン・残ったチップにある（検証の表「理想個体でパッシブ追加／継承ルートのチップの × → 選択欄・次の要素に残る」）。
- [ ] 開いている間に 20 秒の自動の確認・1 分の読み直しが来ても、ポップオーバーが閉じない（所持数だけ変わる）。
- [ ] パル選択で「030」「ラ」「闇」「Lamball」で期待どおりに出て、配合検索の候補に「親 N 件」、継承ルートの開始に「N 回」、所持パル・理想個体の目標で所持している種族が先に「♂a ♀b」で出る。
- [ ] ↓ で動かしている行と選んでいる行が見分けられ、開いたら選んでいる行が見える。
- [ ] **共通の受け入れ条件**（[README の 5-1](README.md#5-1-全テーマ共通の受け入れ条件)。詳しくは上の「INV-2・互換・セキュリティ・性能の注意」）: INV-2 — 回数は `state.graph`（登録済みの記録）から、所持数は所持データから数え、新しいファイルは配合表・`core/ideal.js` を import しない（`test/import.test.js`）。互換 — URL の形（`p=a,b`）と「Enter は矢印で選んだときだけ」（df0ab4e。`test/web/pal-picker.test.js`）を変えていない。セキュリティ — ✓・矢印は createElementNS、名前・効果は textContent（`test/static/security.test.js`）。性能 — 集計はデータの更新時に 1 回で、候補は Map で引く。

### TODO

- [ ] ui/popover.js（placeFloating・createPopover）を作り、pal-picker の配置と閉じる処理を移す
- [ ] core/pal-search.js（頭の 0・段階・英名・属性・パートナースキル・ID の完全一致）を作り、filterPals を置き換える
- [ ] pal-picker に describe（order・badges・dim）と update を足し、選んでいる行と矢印の行を分ける（G-61・S-22）
- [ ] speciesGenderCounts・distancesTo を足し、検索・逆引き・継承ルート・理想個体・所持パルの選択欄に注記を渡す
- [ ] passiveSelector を 1 行の部品（ボタン＋チップ・ポップオーバー・検索・群・その場の onChange・update で閉じない）に作り替える
- [ ] negatives・groups（I-49）・presets（I-51）を入れる
- [ ] passiveChip に compact を足し、views/ideal.js:118・391・393 をチップにする
- [ ] 所持パル・理想個体・継承ルートの呼び出し側を「作り直さず update」にする（O-14 の数え方）
- [ ] header-frame のセーブ連携の状態と ID のメニューを ui/popover.js に移す
- [ ] CSS（1 行・候補・選択中と矢印・バッジ・compact・高さ）を入れる
- [ ] pal-picker・ideal-view・owned-view のテストの期待値を直す
- [ ] pal-search・popover・passive-picker・route・owned のテストを足す
- [ ] release-notes に 1 件足す
- [ ] モックで、ずれ・続けて選ぶ・フォーカス・自動の更新中も閉じない・注記を確かめる

---

## フェーズ 1a の終わりにすること

- [ ] `npm test`・`npm run test:perf` が通る。
- [ ] 統合プランの「検証」の表のうち 1a で直る行を、同じ操作で計り直す（モック `npm run dev` → `http://localhost:5173/?mock=1&seed=80`、所持系は `Claude outputs/ui-audit-2026-10/shots/owned/inject.js`。手順は付録 measurements.md の「モックでの再現の仕方」）:

  | 操作 | 今（実測） | 1a の後の目標 | 直すテーマ |
  |---|---|---|---|
  | 配合検索で親を選ぶ | 結果が 27px 下がる | 動かない | stable-render |
  | 継承ルート・所持パルでパッシブを足す | 下が 44px 下がる | 動かない | popovers |
  | 所持パルの行（129 行） | scrollHeight が 9574〜10011px で揺れる | 揺れない | stable-render |
  | 理想個体でパッシブ追加／継承ルートのチップの × | フォーカスが body に落ちる | 選択欄・次の要素に残る | render-contract・keep-state・popovers |
  | ヘッダー（scrollY=800） | ベル・同期状況が画面外 | 常に見える | header-frame |
  | 配合検索→パル詳細（scrollY=500） | 新しい画面が途中から表示 | 先頭から表示（ドロワーはフェーズ 3） | keep-state |
  | 一覧で並べ替え（scrollY=2500） | 見ていた内容が失われる | 先頭へ（固定の条件帯はフェーズ 2 の find-merge） | keep-state・stable-render |

- [ ] ブラウザでしか確かめられないこと（統合プランの「検証」）: 戻る／進む、日本語変換中の入力、候補を開いたままの同期、20 秒の更新で順位が変わる場面、幅 920px・1100px・拡大 125〜150%、ヘッダー・候補・トースト・ダイアログの重なり、許可の要求（実機）。
- [ ] 新旧データの混在: 古い IndexedDB・古い共有データ・旧本文の通知・古い sessionStorage・旧コードのまま開いたタブがある状態から起動しても壊れない（data-boundary・inv2-notice・keep-state のテストと、モックでの確認）。
- [ ] 観点別のエージェントと Codex（読み取り専用。使う前にユーザーの許可・シェルが動くか小さく試す）でフェーズの差分をレビューし、直してから 1b（[phase-1b-1c-ideal-owned.md](phase-1b-1c-ideal-owned.md)）へ。
- [ ] フェーズの区切りの報告（変更したファイル・実行したコマンド・画面の確かめ方）。

## 計測の記録（実装した人が書き足す）

| 日付 | テーマ | 操作 | 結果 | 予算・目標 | 備考 |
|---|---|---|---|---|---|
| 2026-10-12 | フェーズ 0（0-7） | `npm run test:perf`（変える前。web/・test/ は `c5c0683` のまま） | パッシブの指定なし 316.96 ms・パッシブ 2 個 85.01・4 個ケーキあり 14.27・世代・ケーキなし ♂1000×♀1000 618.22・計画・ケーキなし ♂1000×♀1000 662.94・計画・足りないパッシブ・ケーキなし 627.73・世代・キノコケーキ ♂200×♀200（88〜100）934.37・計画・キノコケーキ ♂1000×♀1000（0〜100）1158.68・計画・キノコケーキ ♂200×♀200 759.60・計画・足りないパッシブ・キノコケーキ ♂1000×♀1000 693.60・同 ♂200×♀200 365.83。継承ルート: インデックス 41.85・グラフ 22.24・経路 5.12 | 1 回 2 秒以内 | ideal-calc の「変える前の値」。同じ PC で変える前のコードを 2 回測り直すと、計画・ケーキなし 706.87／749.61、世代・キノコケーキ 1059.05／984.29、計画・キノコケーキ ♂1000×♀1000 1206.76／1253.48、同 ♂200×♀200 789.28／704.00（揺れは 1〜2 割） |
| 2026-10-12 | ideal-calc（変える前後の比較） | `npm run test:perf` を、変える前（`git stash`）と後で同じ時間帯に 2 回ずつ | 後／前: 計画・ケーキなし ♂1000×♀1000 485・471／444・436 ms、計画・足りないパッシブ・ケーキなし 440・476／416・440、世代・キノコケーキ ♂200×♀200 608・645／623・641、計画・キノコケーキ ♂1000×♀1000 575・639／555・551、同 ♂200×♀200 375・401／369・360、計画・足りないパッシブ・キノコケーキ ♂1000×♀1000 335・399／311・304 | 1 回 2 秒以内（変える前と同じ条件で比べる） | 増えたのは 5〜10% ほど（丸めた比較・優先・見張り。範囲の検査は遷移の中では省いた）。PC の負荷で 1.5〜2 倍揺れるので（上の 0-7 の値は負荷の高い時間帯）、比べるときは前後を続けて測る |
| 2026-10-12 | ideal-calc（表の作成） | 親の余計 4 個まで広げた世代の表を新しく作る（`generationTable`。表 1 つずつ） | 欲しい 4 つ: ケーキなし 25〜27 ms、キノコケーキ 目安 35〜45・上限 32〜40。欲しい 1 つ（8,000 状態）: ケーキなし 187〜201 ms、キノコケーキ 目安 243〜271・上限 245〜260（2 つを続けて作るので計 約 490〜530 ms） | D18: 表の作成は 1 回 300ms まで（先に「計算中」） | 表 1 つは 300ms 以内。キノコケーキの 2 つを合わせると超えるので、stable-render で「1 回」を表 1 つと数えるか、2 つを分けて回すかを決める。欲しい 2 つは約 110〜155 ms（レビュー担当の計測） |
| 2026-10-12 | ideal-calc（表の使い回し） | 表を作った後の計画（`idealPlan`。今の牧場の組 3 つを優先・見張り） | 欲しい 4 つ・ケーキなし ♂1000×♀1000 451 ms、欲しい 4 つ・キノコケーキ ♂200×♀200 129、欲しい 1 つ・ケーキなし ♂1000×♀1000 571、欲しい 1 つ・キノコケーキ ♂1000×♀1000（0〜100）784 | 1 回 2 秒以内 | 欲しいものを欠いて余計を 3〜4 個持つ親を含む fixture（`test/perf/ideal.perf.js` の 3 つ目） |
| 2026-10-12 | ideal-calc（画面） | モックに画像の 4 体（ゴウカブキ。拠点 4 の牧場に ♂A×♀B）を注入して理想個体タブを開く | 1 番 ♂A×♀D「世代を重ねて 平均 約 3,592 個」、2 番 ♂C×♀B（約 4,948 個）。牧場は「交換推奨 → おすすめ 1 番」「外す: ゴウカブキ♀（HP 97・攻 99・防 96） / 入れる: ゴウカブキ♀（HP 100・攻 14・防 96）」 | 完了の条件の画面の確認 | 注入は `Claude outputs/ui-audit-2026-10/shots/owned/inject-kabuki.js`（inject.js を元に 4 体だけにしたもの。注入 → 読み込み直し → 新規登録し直し）、確かめは同じ場所の `check-kabuki.js`（playwright-cli の run-code） |
| 2026-10-12 | フェーズ 0（0-8） | モックで基準の再現（`?mock=1&seed=80`・1280×900） | 配合検索で親 1 を選ぶ: `.card-stack` の top 223 → 250（+27px、件数の行のぶん）。一覧で scrollY=800: `.app-header` top −773（position: static）・`.header-actions` top −765（absolute）・`.navigation` は fixed | README 7-2 の基準と同じ値 | モックの配合は `Math.random` なので、配合のある親（一覧の先頭の配合の親）を選んで測る |
| 2026-10-12 | render-contract（画面） | モック（`?mock=1&seed=80`、ヘッドレスの Chromium）で、配合検索・継承ルート（inject.js の所持パルあり）・理想個体を操作。選ぶ前の `.picker-trigger`・`#main` の子・`.route-query`・「登録する名前」の要素を覚えて比べる | 配合検索: 親 1 → 親 2 を選んでも `.picker-trigger` と `#main` の子が同じ。1 選択ごとに `history.length` が 1 増え、戻る・進むで同じ画面のまま前の選択と件数に戻る。親 1 の × を Enter で押すとフォーカスは親 1 のトリガーに残る。継承ルート: パッシブを足す → 追加欄、開始チップ（`start:SheepBall`）と「すべて」を Enter → 押したチップ、チップの × → 追加欄（どれも body にならない）。理想個体: 名前を入れてパッシブを足すと名前が残り、同じ画面の一覧の「呼び出す」で攻撃の目標の欄が登録の 90 に戻り URL から g が外れ、目標を変えると名前が消える。コンソールのエラー 0 件 | 完了の条件の画面の確認 | 確かめのスクリプトはセッションの一時フォルダに置いた（find/login.js・owned/inject.js の写しと、run-code で動かす確かめ用の js）。実機の戻る・進むの手応え（スワイプ・マウスのボタン）は確かめていない |

