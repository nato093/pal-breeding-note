// 配合牧場（セーブの snapshot.breedFarms）とタマゴから、自動登録する配合を見つける。DOM には触れない。
// タマゴには親の情報がなく、牧場には親を入れ替える前に産んだタマゴが拾うまで残る（実セーブで確認）。
// そこで、前に読んだときになかった「新しく現れたタマゴ」だけを見る。
// - 牧場の上: 前に読んだときと親が同じ牧場のタマゴを、その親の配合とみなす（突然変異タマゴも、表の子で登録する）
// - 牧場の外（孵化器・所持品など。産まれてすぐ拾われたもの）: 中身が、牧場の親（いま、または前に読んだときの）から
//   配合表で求めた子と一致すれば、その組み合わせの配合とみなす。同じ子になる組み合わせが複数あれば、どれも候補にする
// 子は配合表で決める。タマゴの中身は、表と合うかの確かめにだけ使う。
// 古代文明の配合器（snapshot.breeders。産んだタマゴを中で孵化させる）は、中に新しく現れたタマゴのうち、中身が配合器の親（いま、
// または前に読んだときの）の表の子と合うものをその親の配合とみなす。合わないものは牧場の外のタマゴと同じに扱う（ほかで産まれた
// タマゴを入れて孵化させることもあるため。breeder）。
import { breedChild } from './breeding.js';
import { identityKey, normalizeRecord } from './pair.js';
import { userIdKey } from './user.js';
import { isMutationEggItem } from './owned-shared.js';

const GENDER = { Male: 'M', Female: 'F' };
// 覚えておく「見たことのあるタマゴ」の数。孵化したり、読めないファイルに移ったりして見えなくなっても、しばらくは忘れない
const SEEN_EGGS_MAX = 2000;
// 前に読んだときの親の組として使えるか（♂♀がそろっている）
const validPair = (pair) => Boolean(pair?.a?.palId && pair?.b?.palId && pair.a.gender && pair.b.gender && pair.a.gender !== pair.b.gender);
// 突然変異タマゴ（親と関係ない子が入る）。親の組み合わせで産んだことには変わりないので、表の子で登録する
export const isMutationEgg = (egg) => isMutationEggItem(egg.itemId);

// 牧場の親 2 体（♂♀がそろい、種族が分かるとき）。だめなら null
function pairOf(farm, resolveSpecies) {
  if (farm.status !== 'ok' || farm.parents.length !== 2) return null;
  const [a, b] = farm.parents.map((p) => ({ palId: resolveSpecies(p.characterId).palId, gender: GENDER[p.gender] ?? '', depositorUid: p.depositorUid ?? '' }));
  if (!a.palId || !b.palId || !a.gender || !b.gender || a.gender === b.gender) return null;
  return { a, b };
}

/**
 * @param {object} snapshot buildSnapshot の結果（breedFarms がない古いものは空として扱う）
 * @param {{ resolveSpecies: (characterId: string) => { palId: string }, table: object,
 *   history: { farms: Record<string, { parents: string, eggs: string[], pair?: object }>, eggs: string[] | null,
 *     breeders?: Record<string, { parents: string, eggs: string[], pair?: object }> | null } | null }} deps
 *   history は前に読んだときの記録（牧場ごとの親とタマゴ、見たことのあるタマゴ、配合器ごとの親とタマゴ）。null なら初めて読むので、記録するだけ
 *   （breeders がない記録〔前の版が書いたもの〕では、配合器は記録するだけ）
 * @returns {{ candidates: object[], anomalies: object[], history: object }}
 *   anomalies: 牧場の上の新しいふつうのタマゴなのに表と合わないもの（ゲームの更新に表が追いついていないなど）
 */
export function findNewBreedings(snapshot, { resolveSpecies, table, history }) {
  const byKey = new Map();
  const anomalies = [];
  const farms = {};
  const add = (pair, childId, evidence) => {
    const { a, b } = pair;
    const record = normalizeRecord({ parent1Id: a.palId, parent1Gender: a.gender, parent2Id: b.palId, parent2Gender: b.gender, childId });
    const key = identityKey(record);
    if (!byKey.has(key)) byKey.set(key, { key, record, evidence: [] });
    byKey.get(key).evidence.push({ ...evidence, depositorUids: [a.depositorUid, b.depositorUid] });
  };

  // 親の個体（並びは問わない）。読めない牧場・配合器は空にして、次に読んだときの比べ先にもしない
  const parentsKeyOf = (farm) => (farm.status === 'ok' ? farm.parents.map((p) => p.instanceId).sort().join('|') : '');

  // ---- 牧場の上のタマゴ ----
  const pairs = []; // 牧場の外のタマゴの照合に使う親の組（いまと、前に読んだとき）
  const farmEggIds = new Set();
  for (const farm of snapshot?.breedFarms ?? []) {
    const parentsKey = parentsKeyOf(farm);
    const pair = pairOf(farm, resolveSpecies);
    farms[farm.id] = { parents: parentsKey, eggs: farm.eggs.map((e) => e.localId), ...(pair ? { pair } : {}) };
    for (const egg of farm.eggs) farmEggIds.add(egg.localId);
    if (pair) pairs.push({ farmId: farm.id, pair });
    const before = history?.farms?.[farm.id];
    if (validPair(before?.pair) && before.parents !== parentsKey) pairs.push({ farmId: farm.id, pair: before.pair });
    if (!before || !pair || before.parents !== parentsKey) continue;
    const seen = new Set(before.eggs);
    const fresh = farm.eggs.filter((e) => !seen.has(e.localId));
    if (!fresh.length) continue;
    const expected = breedChild(table, pair.a.palId, pair.a.gender, pair.b.palId, pair.b.gender);
    for (const egg of fresh) {
      const actual = resolveSpecies(egg.characterId).palId;
      const evidence = { farmId: farm.id, eggLocalId: egg.localId };
      if (!expected || (actual !== expected && !isMutationEgg(egg))) {
        anomalies.push({ ...evidence, depositorUids: [pair.a.depositorUid, pair.b.depositorUid], parents: [pair.a.palId, pair.b.palId], expected, actual: actual || egg.characterId });
        continue;
      }
      add(pair, expected, evidence);
    }
  }

  // ---- 古代文明の配合器の中のタマゴ ----
  // 配合器は孵化器でもあり、牧場などで産まれたタマゴを入れて孵化させることもある（手元のセーブで、親がノクサージュのままの配合器に
  // ベラルージュのタマゴが 10 個入っていた。2026-10-19）。そこで、どこかで前に見たタマゴは新しいと数えず、新しく現れたタマゴのうち、
  // 中身が配合器の親の配合表の子と同じものだけを、その親の配合とみなす。前に読んだときと親が同じなら、突然変異タマゴもその親の配合
  //（表の子）とみなす。親を何度も入れ替えて使うので、親が入れ替わっていても、前の親といまの親のうち、表の子が中身と同じになる配合
  //（配合のキー）が 1 つだけなら、その配合とみなす。いまの親が読めない配合器では決めない。
  // 配合器の親で決まらなかったタマゴは、異常として知らせず、前と同じく牧場の外のタマゴとして牧場の親と照合する（牧場で産まれてすぐ
  // 拾われ、配合器に入れられたタマゴかもしれない）。配合器の親は、牧場の外のタマゴの照合には使わない。
  // 記録は牧場（farms）と分けて breeders に持つ（前の版の画面は breeders を知らないので、撤去した牧場の親として照合に使わない）
  const breeders = {};
  const seenBefore = new Set(history?.eggs ?? []);
  for (const farm of [...Object.values(history?.farms ?? {}), ...Object.values(history?.breeders ?? {})]) for (const id of farm?.eggs ?? []) seenBefore.add(id);
  const childOf = (p) => breedChild(table, p.a.palId, p.a.gender, p.b.palId, p.b.gender);
  for (const breeder of snapshot?.breeders ?? []) {
    const parentsKey = parentsKeyOf(breeder);
    const pair = pairOf(breeder, resolveSpecies);
    breeders[breeder.id] = { parents: parentsKey, eggs: breeder.eggs.map((e) => e.localId), ...(pair ? { pair } : {}) };
    const before = history?.breeders?.[breeder.id];
    if (!before || breeder.status !== 'ok') continue;
    const same = Boolean(pair) && before.parents === parentsKey;
    const options = same ? [pair] : [pair, validPair(before.pair) ? before.pair : null].filter(Boolean);
    for (const egg of breeder.eggs) {
      if (seenBefore.has(egg.localId)) continue;
      const evidence = { farmId: breeder.id, eggLocalId: egg.localId };
      if (isMutationEgg(egg)) {
        const child = same ? childOf(pair) : '';
        if (child) {
          add(pair, child, evidence);
          farmEggIds.add(egg.localId);
        }
        continue;
      }
      const actual = resolveSpecies(egg.characterId).palId;
      const matches = actual ? options.filter((p) => childOf(p) === actual) : [];
      // 入れ替える前と後が同じ種族の組み合わせなら、同じ配合（同じキー）なので 1 つと数える。そのときは両方の親を根拠に残す
      //（預けた人が違えば、登録者は resolveRegistrant が決める）
      const records = new Set(matches.map((p) => identityKey(normalizeRecord({ parent1Id: p.a.palId, parent1Gender: p.a.gender, parent2Id: p.b.palId, parent2Gender: p.b.gender, childId: actual }))));
      if (records.size !== 1) continue;
      for (const p of matches) add(p, actual, evidence);
      farmEggIds.add(egg.localId);
    }
  }

  // 拾った直後に撤去した牧場の、前に読んだときの親も照合に使う
  for (const [farmId, before] of Object.entries(history?.farms ?? {})) {
    if (!(farmId in farms) && validPair(before?.pair)) pairs.push({ farmId, pair: before.pair });
  }

  // ---- 牧場の外のタマゴ（産まれてすぐ拾われ、牧場の上では見えなかったもの） ----
  const eggs = (snapshot?.pals ?? []).filter((p) => p.source === 'egg');
  const seenEggs = history?.eggs ? new Set(history.eggs) : null;
  for (const farm of Object.values(history?.farms ?? {})) for (const id of farm.eggs ?? []) seenEggs?.add(id);
  if (seenEggs) {
    for (const egg of eggs) {
      if (seenEggs.has(egg.instanceId) || farmEggIds.has(egg.instanceId)) continue;
      // 突然変異タマゴは中身から親を決められないので、牧場の外では使わない
      if (isMutationEgg({ itemId: egg.location?.itemId })) continue;
      const actual = resolveSpecies(egg.characterId).palId;
      if (!actual) continue;
      for (const { farmId, pair } of pairs) {
        if (breedChild(table, pair.a.palId, pair.a.gender, pair.b.palId, pair.b.gender) === actual) add(pair, actual, { farmId, eggLocalId: egg.instanceId });
      }
    }
  }
  // 見たことのあるタマゴは、前に見たものも残す（一度見えなくなってから別の場所に現れても、新しいタマゴと数えない）
  const breederEggIds = Object.values(breeders).flatMap((breeder) => breeder.eggs);
  const seen = [...new Set([...(history?.eggs ?? []), ...eggs.map((e) => e.instanceId), ...farmEggIds, ...breederEggIds])].slice(-SEEN_EGGS_MAX);
  return { candidates: [...byKey.values()], anomalies, history: { farms, eggs: seen, breeders } };
}

/**
 * セーブのプレイヤーに対応するアプリのユーザー。手で選んだものを優先し、なければ同じ名前のユーザー。
 * @returns {string} 見つからなければ ''
 */
export function mappedUser(player, { mapping = {}, users = [] }) {
  const exists = (userId) => users.find((u) => userIdKey(u) === userIdKey(userId));
  const chosen = mapping[player.uid];
  if (chosen) return exists(chosen) ?? '';
  return player.name ? exists(player.name) ?? '' : '';
}

/**
 * 誰の登録にするか。親 2 体を同じ人が拠点に預けていればその人に対応するユーザー。2 体の預けた人の UID が違っても、どちらも同じユーザーに
 * 対応していればそのユーザー（サーバーのワールドで、以前のホスト〔H〕と作成者の今の UID が預けた親など。server の identity）。
 * 預けた人が違う・分からない（牧場ごとに食い違う場合も）ならログイン中のユーザー。同じ人が預けたのに対応するユーザーがいなければ未設定。
 * @returns {{ userId: string } | { unmapped: string }}
 */
export function resolveRegistrant(candidate, { players = [], mapping = {}, users = [], currentUserId }) {
  const userOf = (uid) => mappedUser(players.find((p) => p.uid === uid) ?? { uid, name: '' }, { mapping, users });
  // 証拠ごとの登録者（キーは 'id:' ＋ユーザーの ID・対応のない同じ人は 'uid:' ＋ UID・分からなければ ''）。全部が 1 つにまとまればその人
  const registrants = new Map();
  for (const { depositorUids: [x, y] } of candidate.evidence) {
    const user = x && y ? userOf(x) : '';
    if (user && (x === y || userIdKey(userOf(y)) === userIdKey(user))) registrants.set(`id:${userIdKey(user)}`, { userId: user });
    else if (x && x === y) registrants.set(`uid:${x}`, { unmapped: x });
    else registrants.set('', null);
  }
  const [[key, registrant] = ['', null]] = registrants;
  return registrants.size === 1 && key ? registrant : { userId: currentUserId };
}
