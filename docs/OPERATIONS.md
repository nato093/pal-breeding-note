# 運用手順

## デプロイ情報

| 項目 | 値 |
|---|---|
| deployment ID | `AKfycbwjWCwzno2iqv93NILd331dT3USJXoFWMSC2PBEhdL_rPbXf792tSgMPb2-ddFTogrt` |
| /exec URL | `https://script.google.com/macros/s/AKfycbwjWCwzno2iqv93NILd331dT3USJXoFWMSC2PBEhdL_rPbXf792tSgMPb2-ddFTogrt/exec` |

- scriptId とスプレッドシートの ID は `.clasp.json`（コミットしない）にある。失った場合は Apps Script エディタの［プロジェクトの設定］で確認できる。
- URL を変えずに更新する: `npm run gas:push` → `npx clasp update-deployment <deployment ID>` → `npx clasp list-deployments` で版番号を確認する。
- `clasp push` は必ず `--force` 付きで実行する（`npm run gas:push`）。付けないと、対話できない環境ではマニフェストの変更が黙ってスキップされる。

## 動作確認

- 画面をローカルで確認するには、`npm run dev` を実行してから `http://localhost:5173/?mock=1` を開く。架空データを入れるなら `&seed=30` を付ける。
  - モックはメモリ上だけで動くので、再読み込みで初期状態に戻る。
  - パスコードは何を入れても通る。
- 本番の API を確かめるには `node scripts/smoke.mjs` を実行する。認証の確認だけで、読み取りのみ。
- 書き込みまで確かめるには `node scripts/api-check.mjs` を実行する。
  - テスト用シートに対して、登録・冪等性・重複・競合・+1・編集・削除と復元・統合・並列 5 件の書き込みを確かめる。
  - 開始時に、テスト用シートの有効レコードを片付ける。
  - 応答の環境が本番だった場合は、その時点で中断する。

## 権限の再承認

GAS に新しい権限（OAuth スコープ）が必要な変更を入れたら、スクリプトエディタで関数を 1 回実行して承認し直す。
承認するまで、匿名の利用者全員がエラーになる。

## パスコード

- 本番: スクリプトエディタで `rotatePasscode()` を実行 → 実行ログに出た新しい値で招待リンクを作り直して配る。全端末が再入力になる。
- テスト用: Script Properties の `TEST_PASSCODE` を消して `setup()` を再実行すると作り直される。値は `.env.local` の `PAL_TEST_PASSCODE` に保存する（コミットしない）。
