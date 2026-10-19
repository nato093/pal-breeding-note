// 所持パルの 1 体の詳細（右のドロワーの中身。owned-detail）。所持パルの一覧の並びを見たまま、その個体の全部の情報（パッシブの説明・
// パートナースキル・アクティブスキル・個体値・場所の図・キーワードに一致した理由の全文）と、その種族で次にすること（親にして配合を探す・
// 逆引き・継承ルート）を出す。出すのはセーブの所持データとゲームのマスターだけ（INV-2）。ニックネーム・プレイヤー名は textContent
import { el, button, link, loadingState } from '../ui/dom.js';
import { captureFocus, restoreFocus } from '../ui/focus.js';
import { palsById, palIcon, humanIcon, elementChips, genderMark } from '../ui/pal-icon.js';
import { passiveChip, passivesById } from '../ui/passive-picker.js';
import { navIcon } from '../ui/nav-icons.js';
import { keywordTerms, keywordNotes, eggName, isMutantEgg } from '../core/owned.js';
import { buildHash } from '../router.js';
import { fillTalentCell, fillWhereCell } from './owned.js';

// 魂の強化の並び（save-extras。F070。段階の数。0 は出さない）
const SOUL_PARTS = [['hp', 'HP'], ['attack', '攻撃'], ['defense', '防御'], ['craft', '作業速度']];
// 入手した日時（「2026/10/15 21:52」。年は今年でも付ける＝古い個体と見分ける）
function ownedDate(value) {
  const time = new Date(value);
  if (!value || !Number.isFinite(time.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${time.getFullYear()}/${pad(time.getMonth() + 1)}/${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

/**
 * 魂の強化と状態の節の中身（save-extras）。魂の強化（0 でないものだけ。「HP +10 · 攻撃 +10」）・病気（種類）・空腹（種類）・SAN。
 * 魂の強化も状態も分からない（列のない古い共有・読む前のセーブ）・タマゴなら null（節を出さない）
 */
export function soulAndCondition(pal) {
  if (pal.egg || (!pal.soul && !pal.condition)) return null;
  const list = el('dl', 'owned-detail-facts');
  const add = (term, detail, className = '') => {
    const value = el('dd', className, detail);
    list.append(el('dt', '', term), value);
    return value;
  };
  if (pal.soul) {
    const parts = SOUL_PARTS.filter(([key]) => pal.soul[key] > 0).map(([key, name]) => `${name} +${pal.soul[key]}`);
    add('魂の強化', parts.length ? parts.join(' · ') : 'なし');
  }
  if (pal.condition) {
    const { sick, hunger, sanity } = pal.condition;
    // 見える文は「病気」「空腹」だけ。種類はゲームの内部名（日本語の表を取り込んでいない）なので title にだけ出す（前は「病気（Sprain）」と
    // 英語の内部名を本文に出していた。フェーズ 4 の終わりのレビュー）
    const state = add('状態', [sick ? '病気' : '', hunger ? '空腹' : ''].filter(Boolean).join(' · ') || '病気・空腹なし', sick || hunger ? 'is-warning' : '');
    const kinds = [sick ? `病気: ${sick}` : '', hunger ? `空腹: ${hunger}` : ''].filter(Boolean);
    if (kinds.length) state.title = `種類（ゲームの内部名）\n${kinds.join('\n')}`;
    if (sanity !== null) add('SAN', String(Math.round(sanity)));
  }
  return list;
}

// 節（見出しは h3。ドロワーの見出しが h2）
function section(title, className, ...children) {
  const box = el('section', `owned-detail-section ${className}`);
  box.append(el('h3', 'owned-detail-heading', title), ...children);
  return box;
}

// 行き先のボタン（リンク。navIcon を 16px で添える）。data-focus-key は描き直したときにフォーカスを引き継ぐ目印
function actionLink(text, href, view) {
  const node = link('', href, 'button secondary small pal-action');
  node.append(navIcon(view), el('span', '', text));
  node.setAttribute('data-focus-key', `owned-detail:${text}`);
  return node;
}

/** 個体の表示名（ニックネームがあれば「モコロン「もこ」」） */
export const ownedTitle = (pal) => `${pal.name}${pal.nickname ? `「${pal.nickname}」` : ''}`;

/**
 * @param {object} context app.js の context（owned・drawer）
 * @param {string} instanceId 個体 ID（タマゴも同じ ID）
 * @param {{ terms?: string[], query?: string, setTitle?: (text: string) => void }} [options] 所持パルで入れていたキーワード（一致の理由の
 *   全文を出す）。query は語に分ける前の文。setTitle はドロワーの見出しを直す（ドロワーが渡す。読み直してニックネームが変わったときなど）
 * @returns {{ element: HTMLElement, title: string, registerInitial(): object | undefined, destroy(): void } | null}
 *   読み込んだデータにいない個体は null（ドロワーが「見つかりません」）。所持パルをまだ読み込んでいなければ、読み込み中を出して届いたら描く
 */
export function ownedDetail(context, instanceId, { terms, query = '', setTitle } = {}) {
  const owned = context.owned;
  const words = terms ?? (query ? keywordTerms(query) : []);
  const find = (state) => state?.owned?.pals?.find((pal) => pal.id === instanceId) ?? null;
  const first = find(owned?.state);
  // 読み込み直した直後（履歴からドロワーを戻した）は、所持パルの読み込み（IndexedDB・共有）がまだ終わっていない
  const waiting = !first && owned?.state && !owned.state.ready && typeof owned.subscribe === 'function';
  if (!first && !waiting) return null;
  const element = el('div', 'owned-detail');
  let shown = null;

  // 中身を入れ替える（フォーカスが中にあれば、同じ役目の部品へ。なければ中身の先頭へ。ドロワーの Esc を受けられるように中に残す）
  function replace(...nodes) {
    const token = captureFocus(element);
    const doc = globalThis.document;
    const inside = Boolean(doc?.activeElement) && doc.activeElement !== doc.body && element.contains(doc.activeElement);
    element.replaceChildren(...nodes);
    if (!inside || restoreFocus(element, token)) return;
    if (element.tabIndex === undefined || element.tabIndex < 0) element.tabIndex = -1;
    element.focus({ preventScroll: true });
  }

  function render(pal) {
    shown = pal;
    setTitle?.(ownedTitle(pal));
    const master = pal.known ? palsById.get(pal.palId) : null;
    // 頭: 大きい絵・名前・ニックネーム・性別・Lv・★・印（タマゴ・ラッキー・アルファ）
    const head = el('div', `owned-detail-hero element-${master?.el?.[0] ?? 'Neutral'}`);
    const picture = master ? palIcon(master, { large: true }) : pal.human?.icon ? humanIcon(pal.human.icon) : el('span', 'pal-icon pal-icon-large');
    const names = el('div', 'owned-detail-names');
    const nameLine = el('p', 'owned-detail-name');
    const mark = genderMark(pal.gender);
    if (mark) nameLine.append(mark);
    nameLine.append(el('strong', '', pal.name));
    if (master) nameLine.append(el('small', 'dex-label', ` No.${master.label}`));
    names.append(nameLine);
    if (pal.nickname) names.append(el('p', 'owned-detail-nickname', `「${pal.nickname}」`));
    const stars = Math.max(0, Math.min(4, pal.stars));
    const level = el('p', 'owned-detail-level', pal.egg ? '—' : `Lv ${pal.level}`);
    const starNode = el('span', 'owned-stars', '★'.repeat(stars));
    starNode.setAttribute('role', 'img');
    starNode.setAttribute('aria-label', stars ? `パル濃縮 ★${stars}` : 'パル濃縮なし');
    starNode.setAttribute('data-off', '☆'.repeat(4 - stars));
    level.append(starNode);
    names.append(level);
    // 印（所持パルの行と同じ。タマゴはゲームのタマゴの名前、配合牧場の親とタマゴ、突然変異。farm-board）
    const badges = [
      pal.egg ? ['badge-egg', eggName(pal.eggItemId) || 'タマゴ'] : null, isMutantEgg(pal) ? ['badge-mutant', '突然変異'] : null,
      pal.farm ? ['badge-farm', pal.farm.role === 'egg' ? '配合牧場のタマゴ' : '配合牧場'] : null,
      pal.lucky ? ['badge-lucky', 'ラッキー'] : null, pal.alpha ? ['badge-alpha', 'アルファ'] : null,
      // 病気・空腹（save-extras。行は拠点・手持ちだけ、詳細はどこの個体でも）
      pal.condition?.sick ? ['badge-sick', '病気'] : null, pal.condition?.hunger ? ['badge-hungry', '空腹'] : null,
    ].filter(Boolean);
    if (badges.length) {
      const line = el('p', 'owned-badges owned-detail-badges');
      line.append(...badges.map(([className, text]) => el('span', `owned-badge ${className}`, text)));
      names.append(line);
    }
    if (master) names.append(elementChips(master));
    head.append(picture, names);

    // 個体値（所持パルの行と同じ 4 セルとミニバー）
    const talent = el('div', 'owned-talent owned-detail-talent');
    talent.setAttribute('role', 'img');
    fillTalentCell(talent, pal.talent);

    // パッシブ（ランク順。チップと説明の文を 1 つずつ。5 個以上も全部）
    const ordered = pal.passives.map((id, index) => ({ id, index, rank: passivesById.get(id)?.rank ?? 0 }))
      .sort((a, b) => b.rank - a.rank || a.index - b.index);
    const passives = el('ul', 'owned-detail-passives');
    for (const { id, index } of ordered) {
      const item = el('li', 'owned-detail-passive');
      item.append(passiveChip(id, { compact: true }));
      const desc = pal.passiveDescs?.[index] || passivesById.get(id)?.desc || '';
      if (desc) item.append(el('span', 'owned-detail-desc', desc));
      passives.append(item);
    }
    const passiveBody = ordered.length ? passives : el('p', 'muted owned-detail-none', 'パッシブはありません。');

    // パートナースキル・アクティブスキル（スキルを読む前に読み込んだセーブ・skillIds の列のない共有は記録がない）
    const partner = el('div', 'owned-detail-skill');
    if (pal.partnerSkill) {
      partner.append(el('strong', '', pal.partnerSkill));
      if (pal.partnerSkillDesc) partner.append(el('p', 'owned-detail-desc', pal.partnerSkillDesc));
    } else partner.append(el('p', 'muted owned-detail-none', pal.known ? '名前の表にありません。' : 'パルではないため、ありません。'));
    const actives = el('ul', 'owned-detail-skills');
    pal.skills.forEach((id, index) => {
      const item = el('li', '');
      item.append(el('strong', '', pal.skillNames[index] ?? id));
      if (pal.skillDescs[index]) item.append(el('span', 'owned-detail-desc', pal.skillDescs[index]));
      actives.append(item);
    });
    const activeBody = pal.skills.length ? actives : el('p', 'muted owned-detail-none', 'このセーブには記録がありません。');

    // 場所（所持者と場所の短い表記・6×5 の図。所持パルの行と同じ）と場所の全文
    const where = el('div', 'owned-where owned-detail-where');
    fillWhereCell(where, pal);
    const placeText = el('p', 'owned-detail-place', pal.placeLabel);
    // 入手した日時（save-extras。入手の新しい順の並べ替えと同じ値。持ち主のない個体・タマゴ・古いデータにはない）
    const acquired = pal.ownedAt ? el('p', 'owned-detail-acquired', `入手 ${ownedDate(pal.ownedAt)}`) : null;

    const parts = [head];
    // キーワードに一致した理由の全文（所持パルで入れていた語。行では 1 行に切っている）
    const notes = words.length ? keywordNotes(pal, words) : [];
    if (notes.length) {
      const list = el('ul', 'owned-detail-hits');
      for (const note of notes) {
        const item = el('li', '');
        item.append(el('span', 'owned-detail-hit-label', `${note.label}：`), el('strong', '', note.name));
        if (note.desc) item.append(el('span', 'owned-detail-desc', note.desc));
        list.append(item);
      }
      parts.push(section(`キーワード「${words.join(' ')}」に一致`, 'is-hits', list));
    }
    parts.push(section('個体値', 'is-talent', talent), section('パッシブ', 'is-passives', passiveBody),
      section('パートナースキル', 'is-partner', partner), section('アクティブスキル', 'is-actives', activeBody));
    // 魂の強化と状態（save-extras。共有の列 soul・condition で参加者にも出る。server の share-extras）
    const facts = soulAndCondition(pal);
    if (facts) parts.push(section('魂の強化と状態', 'is-condition', facts));
    parts.push(section('場所', 'is-where', where, placeText, ...(acquired ? [acquired] : [])));
    // その種族で次にすること（パルのマスターにある種族だけ。タマゴは親にできないので、親の検索は出さない）
    if (master) {
      const actions = el('div', 'owned-detail-actions');
      const species = button('', () => context.drawer?.open({ kind: 'pal', id: master.id }), 'button secondary small pal-action owned-detail-species');
      species.append(navIcon('search'), el('span', '', 'パル詳細'));
      species.setAttribute('aria-label', `${master.ja}のパル詳細`);
      species.setAttribute('data-focus-key', 'owned-detail:species');
      actions.append(species);
      if (!pal.egg) actions.append(actionLink(`${master.ja}を親に使う配合`, buildHash('search', { p1: master.id }), 'search'));
      actions.append(actionLink(`${master.ja}が産まれる配合`, buildHash('search', { c: master.id }), 'search'),
        actionLink(`${master.ja}への継承ルート`, buildHash('route', { to: master.id }), 'route'));
      parts.push(actions);
    }
    replace(...parts);
  }

  // 消えた個体（移動・引き渡し・解放）の案内。ドロワーは閉じずに案内と「閉じる」
  function missing() {
    shown = null;
    const box = el('div', 'side-drawer-missing');
    box.append(el('p', '', 'この個体は最新のセーブにいません（移動・引き渡し・解放）。'),
      button('閉じる', () => context.drawer?.close({ reason: 'dismiss' }), 'button secondary small'));
    replace(box);
  }

  if (first) render(first);
  else element.append(loadingState('所持パルを読み込み中…'));
  // 所持パルを読み直したら、同じ個体 ID を新しいデータから引き直して描き直す（中身だけ。ドロワーのスクロールは保つ）。
  // 読み込みを待っていたら、読み込みが終わるまで（ready）待つ
  let lastData = owned.state.owned;
  const unsubscribe = owned.subscribe?.((state) => {
    if (!shown && !state.ready) return;
    if (shown && state.owned === lastData) return;
    lastData = state.owned;
    const next = find(state);
    if (next) render(next);
    else missing();
  }) ?? (() => {});

  return {
    element,
    title: first ? ownedTitle(first) : '所持パルの個体',
    // ドロワーの中の N: その種族を親1 にして登録を開く（持っている個体を親にする。タマゴ・人間は初期値なし）
    registerInitial: () => (shown?.known && !shown.egg ? { parent1Id: shown.palId } : undefined),
    destroy() { unsubscribe(); },
  };
}
