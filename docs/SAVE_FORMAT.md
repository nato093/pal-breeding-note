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
| 観賞用ケージ（`MapObjectId` が `DisplayCharacter`）の `ConcreteModel.ModuleMap` の `CharacterContainer` の `RawData` の先頭 16 バイト | `MapObjectSaveData` | 観賞用ケージ・拠点 N（save-extras。2026-10-16。下の「観賞用ケージ」） |

- 拠点のパルには `OwnerPlayerUId` がない。`OldOwnerPlayerUIds` の最後を「預けた人」として出す。
- パル次元ストレージ（`_dps.sav`）とグローバルパルボックス（`GlobalPalStorage.sav`）は、それぞれのファイルの `SaveParameterArray` から読む（空き枠は `CharacterID` が `None`）。
  パル次元ストレージの位置は `SaveParameterArray` の添字（スナップショットの `location.slotIndex`）で、パルボックスと同じ 1 ページ 30 枠・横 6 列（2026-10-12 に実セーブで 7820 → 261 ページ 4 行 3 列などを確認）。個体の中の `SlotId` は預ける前のパルボックスの位置なので使わない。
- `Level.sav` の `worldSaveData.InLockerCharacterInstanceIDArray` は、パル次元ストレージの個体の `InstanceId` の一覧（全員の分。キーの `PlayerUId` は 0 で、誰の分かは分からない）。2026-10-16 に実セーブで 118 件が 2 人の `_dps.sav` の個体 27＋91＝118 と `InstanceId` が全部一致した（グローバルパルボックスの個体は含まない。ほかの 12 ワールドは 0 件）。`buildSnapshot` は、この一覧のうち読めた `_dps.sav` にない個体の数を `stats.inLockerMissing`（一覧の数は `stats.inLocker`）に残す（`_dps.sav` の読み漏れの検知。sync-fixes の dps-missing。`docs/OPERATIONS.md`）。
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

### 牧場のタマゴの画面と共有（farm-data。2026-10-15）

- 画面用の形（`web/js/core/owned.js` の `normalizeOwned`）: 牧場ごとに `eggs: [{ id: タマゴの localId, palId: 中身〔マスターにないものは空〕, mutant: 突然変異 }]`（セーブの順・64 個まで）と `eggCount`。突然変異は、タマゴのアイテム ID が `PalEgg_MutationPal_*` のもの（`web/js/core/owned-shared.js` の `isMutationEggItem`。自動登録の照合も同じ関数）。2026-10-15 の手元のセーブ（`npm run check:save`）では牧場 7 か所・タマゴ 34 個（1 か所に 19 個）。
- 共有（スプレッドシートのワールドの行の `farms` の 1 セル）: 牧場ごとに短い鍵 `n`（タマゴの数）・`eggs: [{ id, p: パル ID, m: 1〔突然変異〕 }]`（1 牧場 20 個まで）と、読めない牧場は `s: 'u'` と、どの個体にも当たらない仮の親 2 つ（`OWNED_FARM_UNREADABLE_PARENTS` の `?1`・`?2`。`cleanOwnedFarms` が置き換えるので、GAS も決まりを守らない送り主の親を残さない）で送る（古い GAS・古い画面が `s` を捨てても、置いてある組にも空き牧場にもならない。親を空にしていたときは、古い画面が空き牧場に数えて「空いた牧場に置くなら」を勧めた。フェーズ 3 の終わりのレビュー。受け取った新しい画面は親を捨てる）。JSON にした後 45,000 字（`OWNED_FARMS_MAX_CHARS`）を超えたら、全部の牧場の `eggs` を外して `n` だけにし、それでも超えたら牧場を先頭から入る分だけにして `of`（元の牧場の数）を付ける（`fitOwnedFarms`。画面・GAS・開発用 API の `validateOwnedUpload` で同じ）。今の 200 件の上限では、ID が ASCII なら 2 段目で収まる（1 牧場 約 210 字。`"`・`\` や孤立したサロゲートの ID は JSON で字数が増え、3 段目になることがある。どの場合も 45,000 字以下）。200 件の上限で切ったときも、残した牧場に `of`（元の数）を付ける（受け取った側は「一部だけ」）。
- 受け取る側（`ownedFromShared`）: `eggs` がなければ中身が分からない（`eggs: null`）。`n` のない古い形（古い GAS・古いホストの画面）は「タマゴの情報なし」で、`farmsCounted: false`（理想個体は空き牧場を数えない）。`of` が受け取った数より多ければ `farmsPartial: true`（理想個体は交換推奨・空き牧場・使用中の判定を保留）。中身だけを省いたときは保留しない。
- GAS に新しい列は要らない（`farms` の列のまま）。反映は `npm run gas:push` だけ（`setup()` は `farms` の列がないシートのときだけ）。
- タマゴのアイテム ID（farm-board。2026-10-15）: 個体の `location.itemId`（タマゴのとき）を画面用の `eggItemId` に残し、共有は個体の列の末尾に `eggItemId` を足した（`OWNED_ADDED_FIELDS`。GAS は `setup()` をやり直してシートに列が足されるまで書かずに読む。足す前の画面からの共有も受け付ける）。名前はゲーム本体の `DT_ItemNameText_Common` の `ITEM_NAME_PalEgg_*`（56 件。`npm run extract:skills` → `web/data/items.js`。セーブの ID と大文字小文字が違うことがあるので小文字にそろえて引く）。突然変異は `PalEgg_MutationPal_*`（名前は「突然変異タマゴ」など）。
- 個体の牧場の印（farm-board）: 画面用の各個体に `farm: { id, baseId, role: 'parent' | 'egg', mutant } | null`（牧場の親と、牧場の上のタマゴ。共有で中身を省いた牧場のタマゴには付かない）。

## 使う項目

`CharacterID`・`NickName`・`Gender`・`Level`（ないときは 1）・`Rank`（凝縮。ないときは 1 = 星なし）・`Talent_HP` / `Talent_Shot` / `Talent_Defense`（個体値）・`PassiveSkillList`（パッシブの内部名）・`EquipWaza` / `MasteredWaza`（アクティブスキル）・`IsRarePal`（ラッキー）・`OwnerPlayerUId`・`OldOwnerPlayerUIds`・`SlotId`。
2026-10-16 から（save-extras。下の「セーブから読む追加の情報」）: `OwnedTime`（入手した時刻）・`Rank_HP` / `Rank_Attack` / `Rank_Defence` / `Rank_CraftSpeed`（魂の強化）・`WorkerSick`（病気）・`HungerType`（空腹）・`SanityValue`（SAN）。`Level.sav` の `worldSaveData.GameTimeSaveData` の `RealDateTimeTicks`・`GameDateTimeTicks` と、ギルドのメンバーの `last_online_real_time` も読む。

`EquipWaza`（装備中）と `MasteredWaza`（習得済み）は、どちらも `EPalWazaID::<ID>` の EnumProperty の配列。手元のセーブ（1561 体）では、`EquipWaza` は全員にあり、`MasteredWaza` は 1039 体にだけあった。片方にしかないスキルもあるため、2 つを合わせたもの（装備中を先、重複を除く）を「覚えているアクティブスキル」とする（2026-10-10）。

パルボックスの個体の `SlotId.SlotIndex` は、プレイヤーごとのパルボックスの通し番号（0 始まり・重複なし）。1 ページ 30 枠・横 6 列で、ページ＝番号÷30（切り捨て）＋1、ページ内の行・列は余りから求める（2026-10-08 にゲーム内で、29 が 1 ページ目の最後、30 が 2 ページ目の最初、59 が 2 ページ目の最後、60 が 3 ページ目の最初と確認。ゲームの設定は `PalBoxPageNum`・`PalBoxSlotNumInPage`）。計算は `web/js/core/owned.js` の `palboxPosition`。

パッシブの日本語名は PalCalc のデータ（`npm run build:passives`）から引く。ゲーム本体の `DT_SkillNameText_Common` と照合し、名前のある 488 件はすべて一致した（2026-10-05）。

アクティブスキルとパートナースキルの日本語名は、ゲーム本体の同じ `DT_SkillNameText_Common` の `ACTION_SKILL_<ID>`・`PARTNERSKILL_<パル ID>` の行から取り出す（`npm run extract:skills` → `web/data/skills.js`）。名前が `-` の行は捨てる。パートナースキルの行がないナエモチ（花）（`PlantSlime_Flower`）は、ナエモチ（`PlantSlime`）の名前を使う。

説明文は、アクティブスキルが `DT_SkillDescText_Common` の `ACTION_SKILL_<ID>`、パートナースキルが `DT_PalFirstActivatedInfoText` の `PAL_FIRST_SPAWN_DESC_<パル ID>`。文の中の参照（`<characterName id=|…|/>`・`<uiCommon id=|COMMON_ELEMENT_NAME_Dark|…/>` など）は、`DT_PalNameText_Common`（`PAL_NAME_`）・`DT_ItemNameText_Common`（`ITEM_NAME_`）・`DT_MapObjectNameText_Common`（`MAPOBJECT_NAME_`）・`DT_SkillNameText_Common`（`ACTION_SKILL_`）・`DT_UI_Common_Text_Common` から名前を引いて置き換える。アイコン（`<img …/>`）と文字の飾り（`<Status_Up>…</>`）は外し、レベルで変わる数値（`{Passive1_EffectValue1}` など）は ○、レベルで変わる追記（`{ReferenceMsgId_…}`。`DT_PartnerSkillAppendText` の行で、レベル 1 は空）は外す（2026-10-10）。

## セーブから読む追加の情報（save-extras。2026-10-15〜16 に手元のセーブで確認）

`npm run check:save -- "<ワールドのフォルダ>" --probe`（`scripts/save-probe.mjs`。読み取りのみ・ふだんの読み込みは変えない）で、個体の項目の有無・プレイ中の差・場所が不明の個体の入れ物・牧場の入れ物とケーキ・孵化器・インプラントとパルリバーサーの入れ物・`RecordData` を出せる。出力の読み方は `docs/ui-refactor/phase-3-4-drawer-data.md` の save-extras の「実装の記録」。

### 入手した時刻（`OwnedTime`）

- DateTime（u64 のティック。2^53 を超えるので 10 進の文字列で読む）。持ち主のある個体には全部ある（ないのは持ち主のない NPC・タマゴなど）。パル次元ストレージ・グローバルパルボックスの個体にもある。
- **ホストの PC のローカル時刻**（日本時間の PC なら日本時間）のティック。`Level.sav` の `Timestamp` と同じで、UTC として読む `ticksToIso` では 9 時間ずれる。`web/js/save/palworld.js` の `ticksToLocalIso` が、ブラウザのタイムゾーンで年月日時を組み立てて本当の時刻（ISO）にする（ページはホストの PC で動くため。BigInt で割るのでミリ秒まで合う）。手元のセーブで、バックアップより後に増えた 27 体は全部それより新しく、孵化させた時刻と合った。
- 画面は個体の `ownedAt`（toISOString の形。空は分からない）。入手の新しい順の並べ替え（`OWNED_SORTS` の `ownedAt`。時刻のない個体は向きによらず最後）と、所持パルの「NEW」（前に所持パルの画面で見ていたデータのセーブの時刻より後に入手した個体。`web/js/owned-seen.js`）。共有は個体の列の末尾 `ownedAt`（`OWNED_ADDED_FIELDS`）。
- なお、スナップショットの `world.savedAt`（`Level.sav` の `Timestamp` を `ticksToIso` で読んだもの）も同じく 9 時間ずれているが、画面では使っていない（セーブの更新日時はファイルの日時）。セーブの新旧と同じセーブの見分けには、生のティックの 10 進の文字列 `world.savedAtTicks`（`ticksText`。ISO にするとミリ秒より細かい桁が落ちる）を使う（下の「注意」の `Timestamp` の項目）。

### 魂の強化と状態

- `Rank_HP`・`Rank_Attack`・`Rank_Defence`・`Rank_CraftSpeed`（ByteProperty。段階の数）: `Level.sav` では既定（0）のとき書かれない（手元で `Level` に書かれていたのは `Rank_CraftSpeed` の 1 体だけ）。パル次元ストレージ・グローバルパルボックスでは全部書かれる（例 10）。
- `WorkerSick`（EnumProperty `EPalBaseCampWorkerSickType::None` など）・`HungerType`（EnumProperty `EPalStatusHungerType::Default`・`Starvation` など）・`SanityValue`（FloatProperty。書かれないときは 100）。`Level.sav` で病気の個体は手元のワールドでは 0 体（別のワールドで 15 体）、空腹は 5 体、SAN が 100 でない個体は 10〜14 体。
- 画面は個体の `soul: { hp, attack, defense, craft }`・`condition: { sick, hunger, sanity }`（種類はゲームの内部名のまま。日本語の表は取り込んでいない）。個体の詳細のドロワーの「魂の強化と状態」の節と、拠点・手持ちの行の「病気」「空腹」の印。**共有しない**（参加者の画面では `null`）。
- `IsFavoritePal`・`CraftSpeeds` は手元のセーブのどの個体にもなかった。

### プレイ中の仲間とゲーム内の日数

- `worldSaveData.GameTimeSaveData` に `RealDateTimeTicks`・`GameDateTimeTicks`（Int64Property）がある（読み取りの許可リスト `LEVEL_SKIP` に足した）。
- `RealDateTimeTicks` は**日時ではなく、ワールドが動いた通算の時間**（ホストのゲームが止まっている間は増えない）。ギルドのメンバーごとの `last_online_real_time`（ギルドの `RawData` の末尾のメンバーの並び。`readGuildPlayers` が前は読み飛ばしていた）が同じ時計で、接続中の人は保存のたびに `RealDateTimeTicks` と同じ値になる（11 世代で差 0〜0.02 秒）。接続していない人は数時間ずれた。
- → プレイヤーの `online` は、差が 10 秒（1 億ティック）以内なら true、離れていれば false、どちらかが読めなければ null（分からない）。最終ログインの日時（`lastOnlineAt`）は作らない（通算の時間なので日時に直せない）。`Players/*.sav` の `LastOnlineDateTime` は保存のたびに全員分が書き直されるので使えない。
- ゲームを閉じた後も最後の保存には「プレイ中」が残るので、画面では必ずセーブの時刻を添え（「Alice・Bob（セーブ 03:07 の時点）」。参加者も共有した時刻ではなく「ホストのセーブ」の時刻）、所持者の選択肢の「（プレイ中）」は保存が新しいとき（この PC は 5 分・共有は 10 分以内）だけ付ける。
- ゲーム内の日数は `LevelMeta.sav` の `InGameDay`（前から読んでいた）。`floor(GameDateTimeTicks ÷ 864e9)` と 4 世代で一致したので、`LevelMeta.sav` が読めないときはこちらから求める。
- 共有: プレイヤーの Lv・プレイ中は `players` の JSON の中（`level`・`online`。古い GAS は捨てるだけ）、日数はワールドの行の新しい列 `inGameDay`（送る側では既存の `world` の中に入れる。GAS は `setup()` をやり直すまで書かずに読む）。

### 観賞用ケージ

- 場所が「不明」になっていた個体は、手元のワールドでは 0 体だったが、別のワールドで 454 体・4 体があり、**すべて観賞用ケージ（`MapObjectId` が `DisplayCharacter`）**の個体だった。ケージの `ConcreteModel.ModuleMap` のキーは `EPalMapObjectConcreteModelModuleType::CharacterContainer` だけで、その `RawData`（20 バイト）の先頭 16 バイトが入れ物 ID（`CharacterContainerSaveData` に `SlotNum` 40）。12 個とも拠点（`baseCampId`）に属し、中の個体は全員に持ち主がある。
- → 場所 `display`（「観賞用ケージ・拠点 N」。所持者は拠点。所持者の絞り込みでは拠点の個体と同じく預けた人の個体）。古い画面は知らない場所を「不明」として受ける。2024 年の古いワールドには入れ物のない「不明」が残る（別の原因。調べていない）。

### 配合牧場のケーキ

- 牧場（`BreedFarm`）の `ConcreteModel.ModuleMap` に `ItemContainer`（`RawData` 34 バイト。先頭 16 バイトが入れ物 ID）と `Workee` がある。手元の 7 か所すべてに入れ物があり、ケーキが入っていた。**1 か所に複数の種類が入っていることがある**（例 `Cake03`×18 と `Cake02`×51）。
- → スナップショットの牧場に `cakes: [{ itemId, count }]`（ケーキ〔`Cake`・`Cake02`〜`Cake05`〕だけ・同じ種類は合わせる・スロットの順）。空の入れ物は `[]`（ケーキ切れ）、入れ物が見つからないとき・入れ物に読めないスロットが 1 つでもあるとき（数を確かめられない。`malformed.itemSlots` にも数える。2026-10-16 のフェーズ 4 の終わりのレビューで、全部のスロットが読めなくても `[]`〈ケーキ切れ〉になっていたのを直した）は `null`（分からない）。**共有しない**（ホストの画面だけ）。名前はゲーム本体の `DT_ItemNameText_Common` の `ITEM_NAME_Cake*`（`web/data/items.js` の `CAKE_NAMES`。ケーキ・キノコケーキ・野菜ケーキ・豪華野菜ケーキ・スペシャルケーキ）。

### 見送ったもの（調べた結果）

- **お気に入り**（2026-10-15 のユーザーの答えで見送り）: `IsFavoritePal` はない。代わりに `FavoriteIndex`（ByteProperty 0〜3。`Level.sav` では 0 は書かれない。保管庫では全部書かれる）があり、手元のセーブでは 2×350・1×296・3×142・0×86。並んで `bFavoriteChangedByFriendship`（BoolProperty）がある。手持ちの 10 体は全部 1、孵化したばかりの 465 体で 1 は 3 体で、ゲームのお気に入りの印と対応するかを確かめられなかったので取り込まない。
- **孵化の残り時間**（F088。2026-10-15 のユーザーの答えで見送り）: 孵化器（`MultiElectricHatchingPalEgg` など）の `ConcreteModel.RawData` は、配合なしは 44 バイトで変わらない。卵が入ると 2.6〜14 KB（卵ごとの `SaveParameter` が入る）。`WorkSaveData` の作業は `Progress` が f32 の 3600・1800・2400。卵 10 個のまま 50 分（6 世代）で、`RawData` も作業も 1 バイトも変わらなかった（減っていく値が見つからない）。`WorldOption.sav` の `PalEggDefaultHatchingTime` は 1。
- `CraftSpeeds`（作業適性の個体の値）: ない。作業適性は種族の値（game-assets の `web/data/work.js`）。

### 後のテーマが使う入れ物（--probe の [6]・[7]）

- インプラント（`PalPassiveSkillChange_*`）とパルリバーサー（`PalGenderReverse`）: `ItemContainerSaveData` のスロット。入れ物の持ち主は、ギルド保管庫（`GuildExtraSaveDataMap` の `GuildItemStorage.RawData` の先頭 16 バイト）・プレイヤーの所持品（`Players/*.sav` の `InventoryInfo` の `*ContainerId`。`Essential` など）・拠点の MapObject（`ItemChest_04` などの `ModuleMap` の `ItemContainer`）・拠点の外の宝箱（`TreasureBox_*`。在庫に数えない）。手元のセーブでは 31 種・406 個（拠点の箱 288・拠点の外の宝箱 85・所持品 13・ギルド保管庫 12 ほか）。implants の在庫はここから（下の「アイテムの在庫」）。
- 捕獲数と図鑑: `Players/<uid>.sav` の `SaveData.RecordData` の `PalCaptureCount`（MapProperty<NameProperty, IntProperty>。キーはパル ID〔大文字小文字が違うことがある〕、`Human` などパルでないキーもある）・`PaldeckUnlockFlag`（MapProperty<NameProperty, BoolProperty>）。手元では 1 人 220〜250 件。paldex で `PalCaptureCount` を読むようにした（下の「捕獲数」）。

### 解析の時間

上の項目を足した前後で、同じセーブの写しを交互に 12 回ずつ読んだ中央値（1 回目を除く。2026-10-16、この PC）: 手元のワールド（個体 1,576 体・`Level.sav` 2.7 MB）で 582 → 613 ms（+5.4%）、別のワールド（1,032 体）で 111 → 118 ms（+6.7%）。

## アイテムの在庫（implants。2026-10-16）

インプラントとパルリバーサーの在庫（理想個体の足りないパッシブのパル手術台の案内・目標の一覧の「手術で完成できる」に添える。後のパルリバーサーの案内も使う）。**ホストの画面だけ**（手元でセーブを読んだときだけ。共有しない）。

- 数えるアイテム: `ItemContainerSaveData` のスロットの `staticId` が `PalPassiveSkillChange_*`（インプラント `PalPassiveSkillChange_〈パッシブ〉`・使い切り `PalPassiveSkillChange_Consumable_〈パッシブ〉`）と `PalGenderReverse`（パルリバーサー）。`parseLevel` の牧場のケーキと同じスロットのループで、入れ物ごと・アイテムごとに数える（`itemCounts`。0 個のスロットは数えない）。
- 入れ物の持ち主: 数えた入れ物を持つ MapObject（`ModuleMap` の `ItemContainer` の `RawData` の先頭 16 バイト）と、その `Model.RawData` の `baseCampId` を `itemOwners` に取る。**タマゴの入れ物の持ち主（`containerOwners`）とは別に持ち**、タマゴの場所の判定は前と同じ入れ物・同じ順（最初に見つかった MapObject）で決める（同じ箱にタマゴとインプラントが入っていても、タマゴの場所は変わらない。合成のセーブで、在庫のアイテムのないワールドとスナップショットの個体が同じことを `test/save/implants-stock.test.js` で、手元のワールド 4 つで前の版と個体・統計・牧場が同じことを確かめた）。
- 在庫に数える入れ物（`buildSnapshot`）: ギルド保管庫（`GuildItemStorage`）・プレイヤーの所持品（`InventoryInfo` の `*ContainerId`。`Common`・`Essential` など全部）・`baseCampId` のある MapObject（拠点の箱 `ItemChest*`・配合牧場 `BreedFarm`・ほかの設備〔`AncientRelicRecycler` など〕）。**`baseCampId` が空の MapObject（拠点の外の宝箱 `TreasureBox_*`）と、持ち主の分からない入れ物は数えない**（数えると手元のセーブでパルリバーサーが 12 個から 97 個に化ける）。
- スナップショット: `items: [{ itemId, count, where: 'base'|'guild'|'player', id: 拠点・ギルド・プレイヤーの ID, object: 'chest'|'farm'|'other'|'' }]`（アイテムと場所ごとに合わせる）。在庫を読む前のスナップショットにはない。
- 画面（`web/js/core/owned.js` の `normalizeOwned`）: `items: { 〈アイテム ID〉: { total, places: [{ label, count }] } }`（場所は数の多い順に 3 つまで。呼び名は「拠点 1 の箱」「拠点 1 の配合牧場」「拠点 1 の設備」「ギルド保管庫」「Alice の所持品」）。在庫を読む前のスナップショットは `null`（分からない）。大文字小文字の違う同じアイテムは合わせる。共有のデータ（`ownedFromShared`）はいつも `null`。引くのは `itemStock(owned, itemId)` → `{ total, places } | null`（読んだデータにないアイテムは `{ total: 0, places: [] }`＝在庫なし）、文は `stockText(stock)`（「在庫 5（拠点 1 の箱）」「在庫 7（拠点 1 の箱 5・ギルド保管庫 2）」「在庫なし」。`{ short: true }` は「在庫 5」）。
- 手元のセーブ（2026-10-16）: 31 種・321 個（拠点の箱 288・拠点の設備 8・ギルド保管庫 12〔パルリバーサーだけ〕・所持品 13）。拠点の外の宝箱の 85 個（全部パルリバーサー）は数えない。`npm run check:save` の通常の出力に「アイテムの在庫（インプラント・パルリバーサー。拠点の外の宝箱は数えない）: 321 個・31 種（うちパルリバーサー 12 個）」の 1 行。
- 解析の時間: 同じセーブの写しを前の版と交互に 12 回ずつ読んだ中央値で、手元のワールド（1,558 体）625 → 615 ms、別のワールド（1,032 体）115 → 114 ms（差は揺れの範囲。スロットのループは 1 回のまま）。

## 捕獲数（RecordData。paldex。2026-10-16）

自分が捕まえた数（パル詳細の「捕獲 n 回（自分）」と図鑑のマスの「捕獲 n」）。**ホストの画面だけ**（手元でセーブを読んだときだけ。共有しない）。

- 場所: `Players/<uid>.sav` の `SaveData.RecordData.PalCaptureCount`。MapProperty<NameProperty, IntProperty>（キーはキャラクター ID、値は捕まえた回数）。`npm run check:save -- "<ワールドのフォルダ>" --probe` の [7] で形を確かめた（2026-10-16。手元のワールドのプレイヤー 2 人で 246 件・224 件、マスターで引けないのはどちらも `Human` だけ）。読み取りの許可リスト `PLAYER_SKIP` は `.SaveData` に `RecordData`、`.SaveData.RecordData` に `PalCaptureCount` だけを足した。**`PaldeckUnlockFlag`（図鑑の登録。MapProperty<NameProperty, BoolProperty>）は画面で使わないので読まない**（--probe の [7] では件数を出す）。`RecordData` のほかの項目も読まない。
- 解析（`web/js/save/palworld.js` の `parsePlayer`）: `captures: [{ id: キャラクター ID, count }]`（セーブのキーのまま。0 回は省く・2,000 件まで）。`RecordData`・`PalCaptureCount` がない（古いセーブ）・形が違う（値が整数でない項目しかない、Map でない）なら `null`（分からない）。壊れた Map（要素の数がデータより多いなど）は `readGvas` の回復で飛ばし、`malformed.properties` に数える（後ろの項目と所持パルの取り込みは続く。スナップショットの `stats.malformed['player.properties']`）。
- スナップショット（`buildSnapshot`）: 捕獲数を読めたプレイヤーだけ `players[].captures` に写す（読めなかったプレイヤー・古いスナップショットには項目がない）。
- 画面（`web/js/core/owned.js` の `normalizeOwned`）: プレイヤーの `captures: { 〈パル ID〉: 回数 }`。キャラクター ID は `createSpeciesResolver` で引く（大文字小文字の違い〔例 セーブの `WereWolf_Ice` → マスターの `Werewolf_Ice`〕・`BOSS_` などの接頭辞もそろえ、同じ種族は合わせる）。`Human` などマスターにないキーと 0 回は捨てる。形の違う値（配列でない・空でないのに形の合う項目〔文字列の id・0 以上の整数の count〕が 1 つもない）は項目を付けない（「捕獲 0 回」と区別する。空の配列は `{}`＝捕まえていない）。共有のデータ（`ownedFromShared`）には付けない（`sharedUpload` も送らない。`cleanSharedPlayers` は uid・name・Lv・プレイ中だけを残す）。自分の分は `ownCaptures(players, uids)`（`ideals.selfUids()` のプレイヤーの分を合わせた `Map`。自分が分からない・捕獲数のあるプレイヤーがいなければ `null`）。
- 手元のセーブ（2026-10-16）: `npm run check:save` の通常の出力に「捕獲数: 〈プレイヤー〉 245 種・合計 15334（引けないキー 1: Human）, …」の 1 行（名前は手元の console にだけ出る）。もう 1 人は 223 種。
- 解析の時間: 同じセーブの写しを前の版（統合ブランチの HEAD）と交互に 13 回ずつ読んだ中央値（1 回目を除く）で、手元のワールド（1,558 体）605 → 601 ms（差は揺れの範囲。プレイヤーのファイルは小さい）。
- 捕獲ボーナスのしきい値（10 回など）はゲームのデータで確かめていないので出さない。仲間の捕獲数の共有もしない。

## 注意

- ブラウザ（Chrome・Edge）は `AppData` 配下のフォルダを File System Access API で開けない（フォルダのドラッグ＆ドロップも同じ制限。Chromium の blocklist で `DIR_LOCAL_APP_DATA` が `kBlockAllChildren`）。ただし、ドロップした**ファイル**はこの確認を受けず、`DataTransferItem.getAsFileSystemHandle()` のハンドルを IndexedDB に保存して後から読み直せる（Chrome 154 で確認。ゲームが保存し直した後も同じハンドルで最新を読める。「毎回のアクセスを許可」を選ぶと、開き直しても確認なしで読める）。自動の読み込みはこの仕組みを使う（`web/js/save/handles.js`）。
- `Level.sav`・`LevelMeta.sav` にはワールド ID（フォルダ名）が入っていない（2026-10-05 に確認）。ファイルの登録では、貼ってもらったフォルダのパスから ID を取る。
- ホストか参加かは `Level.sav` と `LocalData.sav` の更新日時で決める。ホストで保存すると `LocalData.sav` が先に、`Level.sav` がその少し後に書かれる（2026-10-17 の P0 の実測で中央値 0.79 秒・最大 2.74 秒。ゲームを終えたときの保存だけは `LocalData.sav` が最後）。参加すると `LocalData.sav` だけが書かれる。`LocalData.sav` が 60 秒以上新しければ参加（`Level.sav` は前にホストしたとき・同期で受け取ったときの残り）。保存の途中は `LocalData.sav` が前の保存の `Level.sav` より保存の間隔（約 30 秒）ほど新しくなるので、それより十分長くしてある（前は 10 秒で、保存の途中に読むと参加と取り違えた）。
- `Level.sav` の `Timestamp` は PC のローカル時刻なので、セーブの更新日時（画面の表示・古さの判定）にはファイルの更新日時を使う。
- **セーブの新旧と同じセーブの見分けは、`Timestamp` の生のティックで比べる**（2026-10-16。sync-fixes の owned-gas）。SaveSync の同期でファイルの更新日時が書き換わっても、中の `Timestamp` は変わらない。スナップショットの `world.savedAtTicks`（10 進の文字列。2^53 を超えるので数にしない）を、共有の `saveStamp`（`OwnedWorlds` の列 `saveKey` の中）として送り、`web/js/core/owned-shared.js` の `compareSaves` で桁をそろえて比べる（GAS の共有・手元と共有の選択・自動登録の記録で同じ関数）。片方にない（古いデータ）ときだけ、ファイルの更新日時で比べる。ホストの PC のローカル時刻なので、**仲間が全員同じタイムゾーン（日本時間）で遊ぶ前提**（別のタイムゾーンの人がホストすると、交代の前後の新旧を誤る）。
- ゲームの更新で構造が変わったら、`npm run check:save -- "<ワールドのフォルダ>"` で読み込みを確かめる。
