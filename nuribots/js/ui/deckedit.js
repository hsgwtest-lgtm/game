// ごほうびカードの編集部品（設計画面・トレーニング中・オンラインの作戦タイムで共通）

import { col } from './ui.js';
import { C } from '../core/const.js';
import { text } from '../gfx/font.js';
import { CARDS, CARD, LEVELS, cardValue, fmtValue } from '../sim/rewards.js';
import { cardBadge, valueColor, CARD_COLOR } from './widgets.js';
import { signedBar } from './charts.js';
import { ICONS, bitmap } from '../gfx/sprites.js';

// デッキの一覧（値の上げ下げ・はずす）。戻り値 { h, changed, info }
export function deckRows(app, x, y, w, deck, opt = {}) {
  const ui = app.ui, fb = ui.fb;
  const rowH = opt.rowH || 30;
  let changed = false, info = null;
  let yy = y;
  const idp = opt.id || 'deck';
  for (let i = 0; i < deck.length; i++) {
    const d = deck[i];
    const c = CARD[d.id];
    if (!c) continue;
    fb.rrect(x, yy, w, rowH - 3, col(C.navy));
    fb.rect(x, yy + 1, 2, rowH - 5, col(CARD_COLOR[d.id] || C.mist));
    cardBadge(fb, x + 5, yy + Math.floor((rowH - 3 - 13) / 2), d.id, 13);
    const nameW = w - 5 - 13 - 4 - 76 - (opt.noRemove ? 0 : 17);
    const h = ui.hit(`${idp}-info-${d.id}`, x + 20, yy, nameW + 4, rowH - 3);
    text(fb, c.name, x + 22, yy + 3, col(h.down ? C.gold : C.white), { maxW: nameW });
    text(fb, c.per + 'ごとに', x + 22, yy + 15, col(C.lilac), { maxW: nameW });
    if (h.click) info = d.id;
    const v = cardValue(d.id, d.lv);
    const sx = x + w - 76 - (opt.noRemove ? 0 : 17);
    const r = ui.stepper(`${idp}-st-${d.id}`, sx, yy + Math.floor((rowH - 3 - 17) / 2), 74, 17, fmtValue(v), {
      fg: valueColor(v), minDis: d.lv <= -3, maxDis: d.lv >= 3, face: C.night,
    });
    if (r) { d.lv = Math.max(-3, Math.min(3, d.lv + r)); changed = true; }
    if (!opt.noRemove) {
      if (ui.button(`${idp}-rm-${d.id}`, x + w - 16, yy + Math.floor((rowH - 3 - 15) / 2), 14, 15, '', { icon: 'x', face: C.night, fg: C.lilac, sfx: 'back' })) {
        deck.splice(i, 1); i--; changed = true;
      }
    }
    yy += rowH;
  }
  if (!deck.length) {
    text(fb, 'カードがありません。下から追加しよう', x + 4, yy + 4, col(C.mist));
    yy += 20;
  }
  return { h: yy - y, changed, info };
}

// 追加できるカードの棚。戻り値 { h, added, info }
export function cardShelf(app, x, y, w, deck, opt = {}) {
  const ui = app.ui, fb = ui.fb, G = app.G;
  const cols = 3, gap = 3;
  const tw = Math.floor((w - gap * (cols - 1)) / cols), th = 24;
  const inDeck = new Set(deck.map(d => d.id));
  const full = deck.length >= (opt.slots ?? G.slots);
  let added = null, info = null;
  let k = 0;
  const idp = opt.id || 'shelf';
  for (const c of CARDS) {
    if (inDeck.has(c.id)) continue;
    const unlocked = opt.all || G.cardUnlocked(c.id);
    const cx = x + (k % cols) * (tw + gap), cy = y + Math.floor(k / cols) * (th + gap);
    k++;
    if (!unlocked) {
      fb.rrect(cx, cy, tw, th, col(C.night));
      fb.icon(bitmap(ICONS.lock), cx + 5, cy + 8, col(C.dusk));
      text(fb, '？？？', cx + 15, cy + 7, col(C.dusk));
      const h = ui.hit(`${idp}-lk-${c.id}`, cx, cy, tw, th);
      if (h.click) ui.toast('CPUリーグで勝つと手に入る', C.gold);
      continue;
    }
    const h = ui.hit(`${idp}-c-${c.id}`, cx, cy, tw, th);
    const press = h.down ? 1 : 0;
    fb.rrect(cx, cy + 1, tw, th, col(C.ink));
    fb.rrect(cx, cy + press, tw, th, col(full ? C.night : C.indigo));
    cardBadge(fb, cx + 3, cy + 5 + press, c.id, 13, full);
    text(fb, c.name, cx + 19, cy + 7 + press, col(full ? C.lilac : C.white), { maxW: tw - 21 });
    if (h.click) {
      if (full) { ui.toast(`カードは ${opt.slots ?? G.slots} 枚まで。どれかをはずしてね`, C.salmon); app.sound.play('deny'); }
      else { deck.push({ id: c.id, lv: c.def }); added = c.id; app.sound.play('card'); }
    }
  }
  const rows = Math.ceil(k / cols);
  return { h: rows * (th + gap), added, info };
}

// 予想の内訳（いまのロボの1試合あたりのできごと evs × 新しい重み）
export function forecast(app, x, y, w, deck, evs) {
  const ui = app.ui, fb = ui.fb;
  if (!evs) {
    text(fb, '学習すると、ここに「1試合でもらえそうな', x, y, col(C.lilac));
    text(fb, 'ごほうび」の予想が出るよ', x, y + 12, col(C.lilac));
    return 26;
  }
  let max = 1;
  const rows = deck.map(d => { const c = CARD[d.id]; const v = cardValue(d.id, d.lv) * (evs[c.ev] || 0); max = Math.max(max, Math.abs(v)); return [d.id, v]; });
  let yy = y, tot = 0;
  for (const [id, v] of rows) {
    tot += v;
    text(fb, CARD[id].name, x, yy, col(C.mist), { maxW: 54 });
    signedBar(fb, x + 58, yy + 3, w - 58 - 34, 6, v, max);
    ui.mini(fmtNum(v), x + w, yy + 3, valueColor(v), 'right');
    yy += 11;
  }
  fb.dline(x, yy + 1, x + w, yy + 1, col(C.dusk), 1, 1);
  text(fb, 'ごうけい', x, yy + 4, col(C.white));
  ui.mini(fmtNum(tot), x + w, yy + 7, valueColor(tot), 'right');
  return yy + 16 - y;
}

// カードの説明シート
export function cardInfo(app, id, deck) {
  const ui = app.ui, fb = ui.fb;
  const c = CARD[id];
  if (!c) return 'close';
  const h = 150;
  const y = ui.sheet(h + app.bottom, '');
  cardBadge(fb, 10, y + 10, id, 13);
  text(fb, c.name, 30, y + 11, col(C.white), { scale: 1 });
  const d = deck.find(x => x.id === id);
  if (d) {
    const v = cardValue(id, d.lv);
    text(fb, `いまの値 ${fmtValue(v)}（${c.per}ごと）`, 30, y + 24, col(valueColor(v)));
  }
  ui.textBlock(c.desc + '、この値のごほうびをもらう。−なら罰になる。', 10, y + 42, ui.W - 20, C.pale);
  ui.textBlock('ヒント: ' + c.hint, 10, y + 82, ui.W - 20, C.gold);
  if (ui.button('ci-close', ui.W - 70, y + h - 28, 62, 22, 'とじる', { face: C.dusk })) return 'close';
  return null;
}

export function fmtNum(v) {
  const a = Math.abs(v);
  const s = a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2);
  return (v < 0 ? '-' : v > 0 ? '+' : '') + s;
}

export { LEVELS };
