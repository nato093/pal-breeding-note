# 運用手順

## デプロイ情報

| 項目 | 値 |
|---|---|
| deployment ID | `AKfycbwjWCwzno2iqv93NILd331dT3USJXoFWMSC2PBEhdL_rPbXf792tSgMPb2-ddFTogrt` |
| /exec URL | `https://script.google.com/macros/s/AKfycbwjWCwzno2iqv93NILd331dT3USJXoFWMSC2PBEhdL_rPbXf792tSgMPb2-ddFTogrt/exec` |

- scriptId とスプレッドシートの ID は `.clasp.json`（コミットしない）にある。失った場合は Apps Script エディタの［プロジェクトの設定］で確認できる。
- URL を変えずに更新する: `npm run gas:push` → `npx clasp update-deployment <deployment ID>` → `npx clasp list-deployments` で版番号を確認する。
- `clasp push` は必ず `--force` 付きで実行する（`npm run gas:push`）。付けないと、対話できない環境ではマニフェストの変更が黙ってスキップされる。

## 権限の再承認

GAS に新しい権限（OAuth スコープ）が必要な変更を入れたら、スクリプトエディタで関数を 1 回実行して承認し直す。
承認するまで、匿名の利用者全員がエラーになる。

## パスコード

- 本番: スクリプトエディタで `rotatePasscode()` を実行 → 実行ログに出た新しい値で招待リンクを作り直して配る。全端末が再入力になる。
- テスト用: Script Properties の `TEST_PASSCODE` を消して `setup()` を再実行すると作り直される。値は `.env.local` の `PAL_TEST_PASSCODE` に保存する（コミットしない）。
