// 所持パルの 1 体の詳細（右のドロワーの中身。owned-detail）。所持パルの一覧の並びを見たまま、その個体の全部の情報（パッシブの説明・
// パートナースキル・アクティブスキル・個体値・場所の図・キーワードに一致した理由の全文）と、その種族で次にすること（親にして配合を探す・
// 逆引き・継承ルート）を出す。出すのはセーブの所持データとゲームのマスターだけ（INV-2）。ニックネーム・プレイヤー名は textContent
import { el, button, link } from '../ui/dom.js';
import { palsById, palIcon, humanIcon, elementChips, genderMark } from '../ui/pal-icon.js';
import { passiveChip, passivesById } from '../ui/passive-picker.js';
import { navIcon } from '../ui/nav-icons.js';
import { keywordTerms, keywordNotes } from '../core/owned.js';
import { buildHash } from '../router.js';
import { fillTalentCell, fillWhereCell } from './owned.js';

// 節（見出しは h3。ドロワーの見出しが h2）
function section(title, className, ...children) {
  const box = el('section', `owned-detail-section ${className}`);
  box.append(el('h3', 'owned-detail-heading', title), ...children);
  return box;
}

// 行き先のボタン（リンク。navIcon を 16px で添える）
function actionLink(text, href, view) {
  const node = link('', href, 'button secondary small pal-action');
  node.append(navIcon(view), el('span', '', text));
  return node;
}

/** 個体の表示名（ニックネームがあれば「モコロン「もこ」」） */
export const ownedTitle = (pal) => `${pal.name}${pal.nickname ? `「${pal.nickname}」` : ''}`;

/**
 * @param {object} context app.js の context（owned・drawer）
 * @param {string} instanceId 個体 ID（タマゴも同じ ID）
 * @param {{ terms?: string[], query?: string }} [options] 所持パルで入れていたキーワード（一致の理由の全文を出す）。query は語に分ける前の文
 * @returns {{ element: HTMLElement, title: string, registerInitial(): object | undefined, destroy(): void } | null}
 *   今のデータにいない個体は null（ドロワーが「見つかりません」）
 */
export function ownedDetail(context, instanceId, { terms, query = '' } = {}) {
  const owned = context.owned;
  const words = terms ?? (query ? keywordTerms(query) : []);
  const find = (state) => state?.owned?.pals?.find((pal) => pal.id === instanceId) ?? null;
  const first = find(owned?.state);
  if (!first) return null;
  const element = el('div', 'owned-detail');
  let shown = null;

  function render(pal) {
    shown = pal;
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
    const badges = [pal.egg ? 'タマゴ' : '', pal.lucky ? 'ラッキー' : '', pal.alpha ? 'アルファ' : ''].filter(Boolean);
    if (badges.length) {
      const line = el('p', 'owned-badges owned-detail-badges');
      line.append(...badges.map((text) => el('span', `owned-badge ${text === 'タマゴ' ? 'badge-egg' : text === 'ラッキー' ? 'badge-lucky' : 'badge-alpha'}`, text)));
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
      section('パートナースキル', 'is-partner', partner), section('アクティブスキル', 'is-actives', activeBody),
      section('場所', 'is-where', where, placeText));
    // その種族で次にすること（パルのマスターにある種族だけ。タマゴは親にできないので、親の検索は出さない）
    if (master) {
      const actions = el('div', 'owned-detail-actions');
      const species = button('', () => context.drawer?.open({ kind: 'pal', id: master.id }), 'button secondary small pal-action owned-detail-species');
      species.append(navIcon('search'), el('span', '', 'パル詳細'));
      species.setAttribute('aria-label', `${master.ja}のパル詳細`);
      actions.append(species);
      if (!pal.egg) actions.append(actionLink('親にして配合を探す', buildHash('search', { p1: master.id }), 'search'));
      actions.append(actionLink('逆引き（この種族が産まれる配合）', buildHash('search', { c: master.id }), 'search'),
        actionLink('この種族を目標に継承ルート', buildHash('route', { to: master.id }), 'route'));
      parts.push(actions);
    }
    element.replaceChildren(...parts);
  }

  // 消えた個体（移動・引き渡し・解放）の案内。ドロワーは閉じずに案内と「閉じる」
  function missing() {
    shown = null;
    const box = el('div', 'side-drawer-missing');
    box.append(el('p', '', 'この個体は最新のセーブにいません（移動・引き渡し・解放）。'),
      button('閉じる', () => context.drawer?.close({ reason: 'dismiss' }), 'button secondary small'));
    element.replaceChildren(box);
  }

  render(first);
  // 所持パルを読み直したら、同じ個体 ID を新しいデータから引き直して描き直す（中身だけ。ドロワーのスクロールは保つ）
  let lastData = owned.state.owned;
  const unsubscribe = owned.subscribe?.((state) => {
    if (state.owned === lastData) return;
    lastData = state.owned;
    const next = find(state);
    if (next) render(next);
    else missing();
  }) ?? (() => {});

  return {
    element,
    title: ownedTitle(first),
    // ドロワーの中の N: その種族を親1 にして登録を開く（持っている個体を親にする。タマゴ・人間は初期値なし）
    registerInitial: () => (shown?.known && !shown.egg ? { parent1Id: shown.palId } : undefined),
    destroy() { unsubscribe(); },
  };
}
