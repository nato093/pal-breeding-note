# Palworld のセーブの構成（所持パルの読み込み用）

調査日: 2026-10-05。対象: Steam 版 v1.0.5（build 25246127）の協力プレイのワールド。読み取りのみで調べた。
実装は `web/js/save/`（解凍 `oodle.js`、GVAS の読み取り `gvas.js`、パルの抽出 `palworld.js`、取りまとめ `import.js`）。

## 置き場所

```
%LOCALAPPDATA%\Pal\Saved\SaveGames\
  <Steam ID>\
    GlobalPalStorage.sav          グローバルパルボックス（ワールドをまたいで共有）
    <ワールド ID（32 桁）>\
      Level.sav                   ワールド全体（パル・拠点・アイテム・建物）
      LevelMeta.sav               ワールド名・ホスト名
      Players\<PlayerUId>.sav     プレイヤーごとの手持ち・パルボックスの入れ物 ID
      Players\<PlayerUId>_dps.sav パル次元ストレージ（使った人だけ）
      backup\…                    自動バックアップ（読み込まない）
```

- ゲームのインストール先（`steamapps\common\Palworld`）にはセーブはない。
- 協力プレイではホストの PC にだけワールドがある（ホストの PlayerUId は `00000000…0001`）。
- 参加している側の PC には、ホストのワールド ID と同じ名前のフォルダに `LocalData.sav` だけが置かれる（`Level.sav` はない）。このアプリは、`Level.sav` があればホスト、`LocalData.sav` だけなら参加している側と判定する（2026-10-05、ユーザーの PC で別の Steam アカウントどうしのフォルダ名が一致することを確認）。
- 専用サーバーは `…\SaveGames\0\<ワールド ID>\` に同じ構成で置かれる。

## ファイルの形式

| 部分 | 内容 |
|---|---|
| 先頭 12 バイト | 展開後の大きさ（u32）・圧縮後の大きさ（u32）・`PlM`（Oodle）または `PlZ`（zlib）・種類（1 バイト） |
| 圧縮 | 現行版は `PlM` = Oodle。ストリームの種類は Mermaid（0x0A）。外部の編集ツールで保存し直すと Kraken になることがある。古い版は `PlZ`（0x31 は zlib 1 回、0x32 は 2 回） |
| 中身 | Unreal Engine の GVAS（SaveGame）。プロパティの並び。`RawData` という名前のバイト配列の中に、さらに独自の並びが入っている |

`Level.sav` は約 2.5 MB → 展開後 約 38 MB、`_dps.sav` は約 36 KB → 約 73 MB（9600 枠ぶんの既定値が並ぶ）。

## パルの場所の判定

`Level.sav` の `worldSaveData.CharacterSaveParameterMap` にプレイヤーとパルが入っている（`IsPlayer` が真ならプレイヤー、`NickName` が名前）。
パルの `SlotId.ContainerId` を、次の入れ物と照らして場所を決める。

| 入れ物 | 取り出し元 | 画面の表示 |
|---|---|---|
| `OtomoCharacterContainerId` | `Players\<uid>.sav` | 手持ち（そのプレイヤー） |
| `PalStorageContainerId` | `Players\<uid>.sav` | パルボックス（そのプレイヤー） |
| 拠点の `WorkerDirector` の `container_id` | `BaseCampSaveData` | 拠点 N（番号はギルドの拠点の並び順） |

- 拠点のパルには `OwnerPlayerUId` がない。`OldOwnerPlayerUIds` の最後を「預けた人」として出す。
- パル次元ストレージ（`_dps.sav`）とグローバルパルボックス（`GlobalPalStorage.sav`）は、それぞれのファイルの `SaveParameterArray` から読む（空き枠は `CharacterID` が `None`）。
- タマゴ（`DynamicItemSaveData` の卵）にも生まれるパルのパッシブが入っている。入っているアイテムの入れ物から場所を決める:
  配合牧場が地面に置いたタマゴ（建物 `Palegg`・`PalEgg_<属性>`）、孵化器、保管箱、プレイヤーの所持品。どこからも参照されないものは数えない。
- 野生のボス（アルファ）は `CharacterID` に `BOSS_` が付く。捕まえた人間（`Male_Soldier01` など）はパルのマスターにないので、内部名のまま出す。

## 使う項目

`CharacterID`・`NickName`・`Gender`・`Level`（ないときは 1）・`Rank`（凝縮。ないときは 1 = 星なし）・`Talent_HP` / `Talent_Shot` / `Talent_Defense`（個体値）・`PassiveSkillList`（パッシブの内部名）・`IsRarePal`（ラッキー）・`OwnerPlayerUId`・`OldOwnerPlayerUIds`・`SlotId`。

パッシブの日本語名は PalCalc のデータ（`npm run build:passives`）から引く。ゲーム本体の `DT_SkillNameText_Common` と照合し、名前のある 488 件はすべて一致した（2026-10-05）。

## 注意

- ブラウザ（Chrome・Edge）は `AppData` 配下のフォルダを File System Access API で開けない（ドラッグ＆ドロップも同じ制限）。そのため自動の読み込みはセーブ連携ツール（`scripts/save-bridge.mjs`）を通す。フォルダの選択（`<input webkitdirectory>`）とフォルダのドロップは毎回の手動操作で読める。
- `Level.sav` の `Timestamp` は PC のローカル時刻なので、セーブの更新日時にはファイルの更新日時を使う。
- ゲームの更新で構造が変わったら、`npm run check:save -- "<ワールドのフォルダ>"` で読み込みを確かめる。
