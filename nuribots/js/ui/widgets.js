// ゲーム専用の UI 部品（ロゴ・顔・カード・デッキ表示）

import { col } from './ui.js';
import { C, TEAM } from '../core/const.js';
import { text, measure, mini } from '../gfx/font.js';
import { CARD_ICONS, PORTRAITS, LOGO_GLYPHS, ICONS, bitmap } from '../gfx/sprites.js';
import { CARD, cardValue, fmtValue } from '../sim/rewards.js';

export const CARD_COLOR = {
  paint: C.emerald, steal: C.amber, win: C.gold, idle: C.lilac, lost: C.blue, hit: C.scarlet,
  stunned: C.lavender, item: C.hotpink, explore: C.leaf, approach: C.coral, lead: C.mint, shot: C.salmon, bump: C.mist,
};

// 顔（16×16）。look: {b, l, d, a}
export function portrait(fb, x, y, key, look, scale = 1) {
  const rows = PORTRAITS[key] || PORTRAITS.bot;
  const L = look || { b: C.blue, l: C.sky, d: C.cobalt, a: C.gold };
  fb.art(rows, x, y, {
    k: col(C.ink), b: col(L.b), l: col(L.l), d: col(L.d), a: col(L.a ?? C.gold), e: col(L.e ?? C.ink), w: col(C.white),
  }, scale);
}

export function teamLook(team) {
  const T = TEAM[team];
  return { b: T.main, l: T.light, d: T.dark, a: team === 0 ? C.gold : C.mint };
}

export function botPortrait(fb, x, y, team, scale = 1) { portrait(fb, x, y, 'bot', teamLook(team), scale); }

// カードのアイコン（9×9）を色つきの箱に
export function cardBadge(fb, x, y, id, size = 13, dim = false) {
  const c = CARD[id];
  const cc = dim ? C.dusk : (CARD_COLOR[id] || C.mist);
  fb.rrect(x, y, size, size, col(dim ? C.night : C.ink));
  fb.rframe(x, y, size, size, col(cc));
  const rows = CARD_ICONS[c ? c.icon : 'brush'];
  const off = Math.floor((size - 9) / 2);
  fb.art(rows, x + off, y + off, { '#': col(cc), '+': col(dim ? C.lilac : C.white), o: col(dim ? C.night : C.dusk) });
}

// 値の表示（+1.0 は緑、−1.0 は赤）
export function valueColor(v) { return v > 0 ? C.leaf : v < 0 ? C.flesh : C.mist; }

// デッキを小さなアイコンで並べる
export function deckStrip(fb, x, y, deck, size = 11, gap = 2) {
  let cx = x;
  for (const d of deck) {
    cardBadge(fb, cx, y, d.id, size);
    const v = cardValue(d.id, d.lv);
    fb.rect(cx + size - 4, y + size - 4, 4, 4, col(C.ink));
    fb.rect(cx + size - 3, y + size - 3, 2, 2, col(v >= 0 ? C.leaf : C.flesh));
    cx += size + gap;
  }
  return cx;
}

// タイトルロゴ
export function logo(fb, cx, y, scale, time, opt = {}) {
  const word = 'NURIBOTS';
  const gap = scale;
  let w = 0;
  for (const ch of word) w += LOGO_GLYPHS[ch][0].length * scale + gap;
  w -= gap;
  let x = Math.round(cx - w / 2);
  const rowsA = [C.ice, C.sky, C.blue, C.blue, C.cobalt, C.cobalt, C.navy];
  const rowsB = [C.cream, C.sand, C.orange, C.orange, C.brick, C.brick, C.blood];
  let i = 0;
  for (const ch of word) {
    const g = LOGO_GLYPHS[ch];
    const gw = g[0].length;
    const rows = i < 4 ? rowsA : rowsB;
    const bob = opt.still ? 0 : Math.round(Math.sin(time * 3 + i * 0.7) * 1.2);
    // 影
    for (let r = 0; r < 7; r++) for (let c = 0; c < gw; c++) if (g[r][c] === '#') fb.rect(x + c * scale + scale, y + bob + r * scale + scale, scale, scale, col(C.ink));
    for (let r = 0; r < 7; r++) for (let c = 0; c < gw; c++) if (g[r][c] === '#') fb.rect(x + c * scale, y + bob + r * scale, scale, scale, col(rows[r]));
    // ペンキのしずく
    if (!opt.still && (i === 1 || i === 4 || i === 6)) {
      const dl = (Math.sin(time * 1.3 + i) * 0.5 + 0.5) * scale * 3;
      const dx = x + Math.floor(gw / 2) * scale;
      fb.rect(dx, y + bob + 7 * scale, Math.max(1, scale - 1), Math.round(dl), col(rows[4]));
      fb.rect(dx, y + bob + 7 * scale + Math.round(dl), Math.max(1, scale - 1), Math.max(1, scale - 1), col(rows[3]));
    }
    x += gw * scale + gap;
    i++;
  }
  return w;
}

// アイコン（1色）
export function icon(fb, name, x, y, c, scale = 1) {
  const rows = ICONS[name];
  if (!rows) return;
  fb.icon(bitmap(rows), x, y, col(c), scale);
}

// 名前のついたロボの小さな札
export function botTag(fb, x, y, team, name, sub) {
  botPortrait(fb, x, y, team);
  text(fb, name, x + 19, y + 1, col(C.white), { maxW: 120 });
  if (sub) text(fb, sub, x + 19, y + 12, col(C.mist), { maxW: 120 });
}

export { CARD, cardValue, fmtValue, measure, mini, text };
