# 類似ツールとの対応

パル配合ノートと、よく使われる Palworld の配合・セーブのツールの機能の対応を、小さくまとめた表です。似た機能を足すか考えるときと、仲間に紹介するときに使います。

- 類似ツールを調べた日: 2026-10-12（各ツールの公開されている説明・リポジトリを読んだ範囲。ゲームは Palworld v1.0.5）
- このアプリの欄: 2026-10-14 の版の画面
- 調べたツールと版
  - [PalCalc](https://github.com/tylercamp/palcalc): v1.21（調べた日の最新のリリース）
  - [PalworldSaveTools](https://github.com/deafdudecomputers/PalworldSaveTools): v2.4.5 で開発を終え、PalStudio に移った
  - [palworld-helper](https://github.com/MagitekZed/palworld-helper)・[PalEdit](https://github.com/EternalWraith/PalEdit): リポジトリの既定のブランチ（版の番号は確かめていない）
  - [paldb](https://paldb.cc/en/Breed)・[palworld.gg](https://palworld.gg/breeding-calculator) ほかの攻略サイト・[Pal Box Inspector](https://tools.supercraft.host/tools/palworld-pal-box-inspector): Web サイト（版の表記なし）
- 「どのツールにもない」は、上のツールと Web 検索（「Palworld breeding tracker share with friends」など）で見つからなかったという、調べた範囲での話です。
- 類似ツールは更新が速いので、ゲームの大きな更新のときなどに見直してください。

| 機能 | どのツールにあるか | このアプリ | 作らない理由（あれば） |
|---|---|---|---|
| セーブから所持パルを読む | PalCalc・PalworldSaveTools | あり（ワールドを一度登録すると、開いている間、ゲームが保存するたびに読み直す） | |
| 協力プレイで所持パルを分け合う | PalCalc（ホストがセーブを書き出し、参加者が手で取り込む） | あり（ホストが読んだ所持パルを、仲間の画面へ自動で共有） | |
| 2 体から子・子から親・継承ルートを引く | PalCalc・paldb・palworld.gg ほか（配合表から計算） | あり（仲間が登録した配合だけを使う） | 配合表から引いた結果は画面に出さない（[INV-2](../data/SOURCES.md)） |
| 継承ルートの段数の上限・経由／回避するパルの指定 | PalCalc | なし（最短から 3 回多いところまで、5 本） | 回避は前に消した「相手親の除外」と同じになり、経由も届かない場合が増えるだけなので見送った |
| 個体値の下限・「すべて 100」 | PalCalc（下限） | あり（チェックを外すか空欄で条件なし） | |
| 個体値の「以下」の条件 | PalCalc | なし | |
| ケーキ・手術台・費用の上限 | PalCalc | ケーキは 3 通りから選び、いちばん早く作れるケーキに印。手術台はない | |
| 完成までの所要時間 | PalCalc | なし（並べ方にタマゴの平均を使うだけ） | 時間はワールドの設定や孵化の時間で大きく変わり、誤解を招くので見送った |
| 突然変異の予測・配合ランクでの並べ替え | paldb・palworld.gg ほか | なし | 配合ランク（BreedingPower）などの配合の計算に使える値を取り込まない（INV-2） |
| 外部の配合表へのリンク | palworld-helper（paldb へ） | なし | 登録していない配合へ誘導しない（INV-2） |
| セーブの編集・変換 | PalworldSaveTools・PalEdit | なし（読むだけ） | |
| 個体値の合計・パッシブの良し悪しの見分け | Pal Box Inspector | 個体値の合計の列と合計順の並べ替え、パッシブはゲームと同じランクの印 | |
| 仲間で配合の記録と所持パルを 1 冊にまとめる | 調べた範囲ではなし | あり | |
| 配合牧場からの自動登録 | 調べた範囲ではなし | あり（配合表は自動登録にだけ使う。産まれたタマゴの照合と、突然変異タマゴ〔照合しない〕を親の組み合わせの子として登録するとき） | |
| 配合牧場の今の組と計画を比べる | 調べた範囲ではなし | あり（理想個体の交換推奨と「変更あり」） | |
