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
- 参加している側の PC には、ホストのワールド ID と同じ名前のフォルダに `LocalData.sav` だけが置かれる（`Level.sav` はない）。このアプリは、`Level.sav` があればホスト、`LocalData.sav` だけなら参加している側と判定する（2026-10-05、ユーザーの PC で別の Steam アカウントどうしのフォルダ名が一致することを確認）。ただし、前にホストしたワールドに参加すると、同じフォルダに古い `Level.sav` が残ったまま `LocalData.sav` だけが新しくなるため、更新日時でも判定する（下の「注意」）。
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

## 配合牧場（自動登録）

`Level.sav` の中で、牧場・親・タマゴが ID でつながっている（2026-10-06 に手元のセーブで確認）。読むのは `web/js/save/palworld.js` の `parseBreedFarms`。

| 欲しいもの | 場所 | 並び |
|---|---|---|
| 牧場 | `MapObjectSaveData` のうち `MapObjectId` が `BreedFarm` | `Model.RawData` の先頭 16 バイトがモデル ID |
| 産んだタマゴ | 牧場の `ConcreteModel.RawData` | 具象 ID(16)・モデル ID(16)・4 バイト・u32 件数・タマゴの MapObject ID × 件数・… |
| 親 2 体 | `WorkSaveData` のうち、`RawData` の 144 バイト目（id 16・workable_bounds 112・base_camp_id 16 の後）が牧場のモデル ID のもの | `WorkAssignMap` の各 `RawData`（62 バイト）の 37 バイト目（id 16・location_index 4・assign_type 1・player_uid 16 の後）が親の InstanceId |
| タマゴの中身 | タマゴの MapObject（`PalEgg_<属性>`）の ItemContainer → スロット → `DynamicItemSaveData` | 既存のタマゴの読み方と同じ |

- 牧場に**置いた人**は記録されていない（割り当ての player_uid は空）。親の `OldOwnerPlayerUIds` の最後（拠点に**預けた人**）で、誰の配合かを決める。
- タマゴの中身は産んだ時点で決まっている。ただし、タマゴに親の情報はない。拾うまで牧場に残るので、親を入れ替えた後も前の親が産んだタマゴが残る（実セーブのバックアップで、同じタマゴが親を 7 回入れ替えても残っていたのを確認・2026-10-06）。
  そのため自動登録では、前に読んだときになかった**新しく現れたタマゴ**だけを見る。子は配合表で決める。
  - 牧場の上: 前に読んだときと親が同じ牧場のタマゴを、その親が産んだものとみなす。
  - 牧場の外（孵化器・所持品など）: 産まれてすぐ（2 秒ほどで）拾うと、ゲームの保存（30 秒ごと）の前に牧場から消えるため、牧場の上では見えない。そこで、牧場の外に新しく現れたタマゴの中身が、牧場の親（いま、または前に読んだとき）から配合表で求めた子と一致すれば、その組み合わせの配合とみなす（同じ子になる組み合わせが複数あれば、どれも登録する）。突然変異タマゴは中身から親を決められないので、牧場の外では使わない。
- 突然変異タマゴは、アイテム ID が `PalEgg_MutationPal_*`（ふつうは `PalEgg_<属性>_NN`）で、親と関係ない子（例: アルファのシェルガドラ）が入る。親の組み合わせで産んだことには変わりないので、表の子で登録する。
- 読めない・食い違う牧場（件数が大きすぎる、割り当てが 3 体以上、親が見つからない、ゼロ GUID など）は `status: 'uncertain'` にして、自動登録に使わない。
- 解析にかかる時間は、`WorkSaveData` を読む分だけ増えた（手元のセーブで 129 → 143 ms）。

## 使う項目

`CharacterID`・`NickName`・`Gender`・`Level`（ないときは 1）・`Rank`（凝縮。ないときは 1 = 星なし）・`Talent_HP` / `Talent_Shot` / `Talent_Defense`（個体値）・`PassiveSkillList`（パッシブの内部名）・`IsRarePal`（ラッキー）・`OwnerPlayerUId`・`OldOwnerPlayerUIds`・`SlotId`。

パルボックスの個体の `SlotId.SlotIndex` は、プレイヤーごとのパルボックスの通し番号（0 始まり・重複なし）。1 ページ 30 枠・横 6 列で、ページ＝番号÷30（切り捨て）＋1、ページ内の行・列は余りから求める（2026-10-08 にゲーム内で、29 が 1 ページ目の最後、30 が 2 ページ目の最初、59 が 2 ページ目の最後、60 が 3 ページ目の最初と確認。ゲームの設定は `PalBoxPageNum`・`PalBoxSlotNumInPage`）。計算は `web/js/core/owned.js` の `palboxPosition`。

パッシブの日本語名は PalCalc のデータ（`npm run build:passives`）から引く。ゲーム本体の `DT_SkillNameText_Common` と照合し、名前のある 488 件はすべて一致した（2026-10-05）。

## 注意

- ブラウザ（Chrome・Edge）は `AppData` 配下のフォルダを File System Access API で開けない（フォルダのドラッグ＆ドロップも同じ制限。Chromium の blocklist で `DIR_LOCAL_APP_DATA` が `kBlockAllChildren`）。ただし、ドロップした**ファイル**はこの確認を受けず、`DataTransferItem.getAsFileSystemHandle()` のハンドルを IndexedDB に保存して後から読み直せる（Chrome 154 で確認。ゲームが保存し直した後も同じハンドルで最新を読める。「毎回のアクセスを許可」を選ぶと、開き直しても確認なしで読める）。自動の読み込みはこの仕組みを使う（`web/js/save/handles.js`）。
- `Level.sav`・`LevelMeta.sav` にはワールド ID（フォルダ名）が入っていない（2026-10-05 に確認）。ファイルの登録では、貼ってもらったフォルダのパスから ID を取る。
- ホストか参加かは `Level.sav` と `LocalData.sav` の更新日時で決める。ホストで保存すると 2 つはほぼ同時に書かれる（実測で `LocalData.sav` が後になるのは 1 秒ほど、先になるのは最大 18 秒）。参加すると `LocalData.sav` だけが書かれる。`LocalData.sav` が 10 秒以上新しければ参加（`Level.sav` は前にホストしたときの残り）。
- `Level.sav` の `Timestamp` は PC のローカル時刻なので、セーブの更新日時にはファイルの更新日時を使う。
- ゲームの更新で構造が変わったら、`npm run check:save -- "<ワールドのフォルダ>"` で読み込みを確かめる。
