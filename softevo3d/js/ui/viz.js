// 学習の見える化（育成画面のパネル）
//  ・成長グラフ: 世代ごとの最高・平均。環境を変えた所に縦線。タップでその世代をえらぶ
//  ・群れの成績: その世代の全員を棒グラフで（王者・エリート・こども）
//  ・脳: 入力→隠れ→出力。強いつながりだけ線で。筋肉の出力は体と同じ色
//  ・リズム: 足の接地と筋肉の動きを楽譜のように（歩き方が決まると模様が規則的になる）

import { C, text, mini } from './widgets.js';
import { rgb } from '../gfx/fb.js';
import { CH_COLOR, CH_DARK, PAL } from '../core/config.js';
import { IN_GROUPS } from '../sim/brain.js';
import { formatFit } from '../evo/growth.js';
import { wrap } from '../gfx/font.js';

const GROUP_COL = [PAL.pink, PAL.lime, PAL.cyan, PAL.gold, PAL.white, PAL.orchid].map(rgb);
const CHC = CH_COLOR.map(rgb), CHD = CH_DARK.map(rgb);

// ── 成長グラフ ──
// 返り値: { gx(gen)→x, genAt(x)→gen }
export function drawGrowth(fb, x, y, w, h, history, envs, opts = {}) {
  fb.rect(x, y, w, h, C.ink);
  const n = history.length;
  if (!n) { text(fb, 'まだ記録がありません', x + w / 2, y + h / 2 - 6, C.steel, { align: 'center' }); return null; }
  const g0 = history[0].gen, g1 = Math.max(g0 + 1, history[n - 1].gen);
  let lo = 0, hi = 0.1;
  for (const r of history) { hi = Math.max(hi, r.best); lo = Math.min(lo, r.mean, r.best); }
  hi *= 1.08;
  const gx = (g) => x + 2 + Math.round((g - g0) / (g1 - g0) * (w - 5));
  const vy = (v) => y + h - 2 - Math.round((v - lo) / (hi - lo) * (h - 5));
  // 目盛り（0m と 最大）
  const zy = vy(0);
  for (let xx = x + 1; xx < x + w - 1; xx += 3) fb.px(xx, zy, C.slate);
  // 環境の境目
  for (let i = 1; i < n; i++) if (history[i].e !== history[i - 1].e) {
    const xx = gx(history[i].gen);
    for (let yy = y + 1; yy < y + h - 1; yy += 2) fb.px(xx, yy, C.orchid);
  }
  // 平均と最高
  const step = Math.max(1, Math.floor(n / (w * 2)));
  let pm = null, pb = null;
  for (let i = 0; i < n; i += step) {
    const r = history[i];
    const xx = gx(r.gen);
    const ym = vy(r.mean), yb = vy(r.best);
    if (pm) fb.line(pm[0], pm[1], xx, ym, C.sky);
    if (pb) fb.line(pb[0], pb[1], xx, yb, C.gold);
    pm = [xx, ym]; pb = [xx, yb];
  }
  const last = history[n - 1];
  if (n === 1) { fb.rect(gx(last.gen) - 1, vy(last.best) - 1, 3, 3, C.gold); fb.rect(gx(last.gen) - 1, vy(last.mean) - 1, 3, 3, C.sky); }
  if (pb) { fb.line(pb[0], pb[1], gx(last.gen), vy(last.best), C.gold); fb.line(pm[0], pm[1], gx(last.gen), vy(last.mean), C.sky); }
  // いま見ている世代
  if (opts.mark !== undefined && opts.mark !== null) {
    const xx = gx(opts.mark);
    fb.vline(xx, y + 1, y + h - 2, C.white);
  }
  if (opts.sel !== undefined && opts.sel !== null) {
    const xx = gx(opts.sel);
    for (let yy = y + 1; yy < y + h - 1; yy += 2) fb.px(xx, yy, C.magenta);
    fb.rect(xx - 1, y + 1, 3, 2, C.magenta);
  }
  mini(fb, formatFit(opts.obj || 'distance', hi / 1.08).replace('cm', 'CM').replace('m', 'M'), x + 3, y + 3, C.gold);
  mini(fb, String(g1), x + w - 3, y + h - 8, C.steel, 'right');
  return { gx, genAt: (px) => Math.round(g0 + (px - x - 2) / (w - 5) * (g1 - g0)) };
}

// ── 群れの成績（棒グラフ）──
export function drawHerd(fb, x, y, w, h, ranked, champId) {
  fb.rect(x, y, w, h, C.ink);
  if (!ranked || !ranked.length) return;
  const n = ranked.length;
  const bw = Math.max(1, Math.floor((w - 4) / n));
  let hi = 0.05, lo = 0;
  for (const r of ranked) { hi = Math.max(hi, r.fit); lo = Math.min(lo, r.fit); }
  const zy = y + h - 2 - Math.round((0 - lo) / (hi - lo) * (h - 4));
  for (let i = 0; i < n; i++) {
    const r = ranked[i];
    const bx = x + 2 + i * bw;
    const v = Math.round((r.fit - lo) / (hi - lo) * (h - 4));
    const top = y + h - 2 - v;
    const col = r.id === champId ? C.gold : r.kind === 'elite' ? C.cyan : r.kind === 'cross' ? C.lime : r.kind === 'new' ? C.silver : C.sky;
    if (top <= zy) fb.rect(bx, top, Math.max(1, bw - 1), zy - top + 1, col);
    else fb.rect(bx, zy, Math.max(1, bw - 1), top - zy + 1, C.red);
  }
}

export const HERD_LEGEND = [
  ['王者', C.gold], ['エリート', C.cyan], ['こうさ', C.lime], ['へんい', C.sky],
];

// ── 脳 ──
// state: { sel: {layer, i} | null }。返り値: クリック判定用の節点の位置
export function drawBrain(fb, x, y, w, h, brain, L, state, time, prevG = null) {
  fb.rect(x, y, w, h, C.ink);
  if (!brain) return [];
  const nIn = L.nIn, nH = L.nH, nOut = L.nOut;
  const colX = [x + 40, x + Math.round(w * 0.58), x + w - 22];
  const posY = (n, i) => y + 4 + Math.round((i + 0.5) * (h - 8) / n);
  const nodes = [];
  const g = brain.g;
  // 線（強いものだけ）
  const lines = [];
  const showDiff = !!(prevG && state.diff);
  // 変わったつながりのうち、変化の大きい16本だけを目立たせる
  let chgSet = null;
  if (showDiff) {
    const diffs = [];
    const nW = nIn * nH + nH + nH * nOut;
    for (let k = 0; k < nW; k++) { const d = Math.abs(g[k] - prevG[k]); if (d > 1e-7) diffs.push([d, k]); }
    diffs.sort((a, b) => b[0] - a[0]);
    chgSet = new Set(diffs.slice(0, 16).map(d => d[1]));
  }
  const changed = (k) => !!chgSet && chgSet.has(k);
  for (let hh = 0; hh < nH; hh++) for (let i = 0; i < nIn; i++) {
    const k = hh * nIn + i, wgt = g[k];
    lines.push([Math.abs(wgt * brain.inp[i]) + Math.abs(wgt) * 0.15 + (changed(k) ? 100 : 0), 0, i, hh, wgt, changed(k)]);
  }
  const w2o = nIn * nH + nH;
  for (let o = 0; o < nOut; o++) for (let hh = 0; hh < nH; hh++) {
    const k = w2o + o * nH + hh, wgt = g[k];
    lines.push([Math.abs(wgt * brain.hid[hh]) + Math.abs(wgt) * 0.15 + (changed(k) ? 100 : 0), 1, hh, o, wgt, changed(k)]);
  }
  lines.sort((a, b) => b[0] - a[0]);
  const sel = state.sel;
  const maxL = 46;
  let drawn = 0;
  for (const [s, layer, a, b, wgt, chg] of lines) {
    const related = sel && ((sel.layer === layer && sel.i === a) || (sel.layer === layer + 1 && sel.i === b));
    if (drawn >= maxL && !related && !chg) continue;
    if (sel && !related && !chg && drawn >= 20) continue;
    const x0 = colX[layer] + 3, y0 = posY(layer === 0 ? nIn : nH, a);
    const x1 = colX[layer + 1] - 1, y1 = posY(layer === 0 ? nH : nOut, b);
    const strong = s > 0.6;
    const col = wgt > 0 ? (strong ? C.yellow : C.gold) : (strong ? C.cyan : C.blue);
    if (chg) fb.line(x0, y0, x1, y1, C.magenta);
    else if (strong || related) fb.line(x0, y0, x1, y1, related ? C.white : col);
    else fb.dline(x0, y0, x1, y1, col, 1, 1);
    drawn++;
  }
  // 節点
  const node = (layer, i, cx, cy, v, colPos, colNeg, knocked) => {
    const a = Math.min(1, Math.abs(v));
    const c = knocked ? C.steel : a < 0.15 ? C.slate : v > 0 ? colPos : colNeg;
    fb.rect(cx - 1, cy - 2, 5, 5, C.ink);
    fb.rect(cx, cy - 1, 3, 3, c);
    if (knocked) { fb.px(cx, cy - 1, C.red); fb.px(cx + 2, cy + 1, C.red); fb.px(cx + 1, cy, C.red); }
    if (sel && sel.layer === layer && sel.i === i) fb.frame(cx - 2, cy - 3, 7, 7, C.white);
    nodes.push({ layer, i, x: cx + 1, y: cy });
  };
  for (let i = 0; i < nIn; i++) {
    const cy = posY(nIn, i);
    const grp = L.inGroup[i];
    const gc = L.inCh[i] >= 0 ? CHC[L.inCh[i]] : GROUP_COL[grp];
    fb.rect(x + 2, cy - 1, 3, 3, gc);
    node(0, i, colX[0], cy, brain.inp[i], C.white, C.steel, brain.knockIn[i]);
  }
  for (let i = 0; i < nH; i++) node(1, i, colX[1], posY(nH, i), brain.hid[i], C.yellow, C.cyan, brain.knockH[i]);
  for (let o = 0; o < nOut; o++) {
    const cy = posY(nOut, o), ch = L.outCh[o];
    const v = brain.out[o];
    node(2, o, colX[2], cy, v, CHC[ch], CHD[ch], brain.knockOut[o]);
    // 出力の大きさを横棒で
    const bl = Math.round(Math.abs(v) * 12);
    fb.rect(colX[2] + 6, cy - 1, 13, 3, C.navy);
    fb.rect(v >= 0 ? colX[2] + 12 : colX[2] + 12 - bl, cy - 1, Math.max(1, bl), 3, CHC[ch]);
    text(fb, 'ABCDEF'[ch], colX[2] + 1, cy - 12, CHC[ch]);
  }
  // 入力のまとまり名
  let prev = -1;
  for (let i = 0; i < nIn; i++) {
    const grp = L.inGroup[i];
    if (grp !== prev) {
      prev = grp;
      mini(fb, ['NOBI', 'TOUCH', 'TILT', 'SPEED', 'GOAL', 'BEAT'][grp], x + 7, posY(nIn, i) - 2, GROUP_COL[grp]);
    }
  }
  return nodes;
}

// ── リズム（歩容図）──
// buf: { n, len, contact: Uint8Array(len*4), act: Float32Array(len*C), head }
export function drawGait(fb, x, y, w, h, buf, nCh, chList) {
  fb.rect(x, y, w, h, C.ink);
  if (!buf) return;
  const rows = 4 + nCh;
  const rh = Math.max(3, Math.floor((h - 4) / rows));
  const labels = ['左前', '右前', '左後', '右後'];
  const lx = x + 30, lw = w - 34;
  const len = buf.len, n = Math.min(buf.n, len);
  for (let r = 0; r < rows; r++) {
    const ry = y + 2 + r * rh;
    if (r < 4) mini(fb, ['FL', 'FR', 'BL', 'BR'][r], x + 3, ry + Math.floor(rh / 2) - 2, C.lime);
    else text(fb, 'ABCDEF'[chList[r - 4]], x + 6, ry + Math.floor(rh / 2) - 6, CHC[chList[r - 4]]);
    fb.rect(lx, ry, lw, rh - 1, C.navy);
  }
  for (let px = 0; px < lw; px++) {
    // 右端が最新
    const k = Math.floor(px / lw * len);
    const age = len - 1 - k;
    if (age >= n) continue;
    const idx = (buf.head - 1 - age + len * 2) % len;
    for (let q = 0; q < 4; q++) {
      if (buf.contact[idx * 4 + q]) fb.rect(lx + px, y + 2 + q * rh, 1, rh - 1, C.lime);
    }
    for (let c = 0; c < nCh; c++) {
      const v = buf.act[idx * nCh + c];
      const ry = y + 2 + (4 + c) * rh;
      const hh = Math.round((v + 1) / 2 * (rh - 1));
      if (hh > 0) fb.rect(lx + px, ry + rh - 1 - hh, 1, hh, CHC[chList[c]]);
    }
  }
  void labels;
}

export class GaitBuffer {
  constructor(nCh, len = 240) {
    this.len = len; this.nCh = nCh; this.n = 0; this.head = 0;
    this.contact = new Uint8Array(len * 4);
    this.act = new Float32Array(len * nCh);
  }
  push(c) {
    const i = this.head;
    for (let q = 0; q < 4; q++) this.contact[i * 4 + q] = c.quadTouch[q] > 0 ? 1 : 0;
    for (let k = 0; k < this.nCh; k++) this.act[i * this.nCh + k] = c.act[k];
    this.head = (this.head + 1) % this.len;
    this.n++;
  }
  clear() { this.n = 0; this.head = 0; }
}

// ── ぼうけんのしょ ──
export function drawJournal(fb, x, y, w, h, journal, scroll) {
  fb.rect(x, y, w, h, C.ink);
  const rowH = 12;
  fb.setClip(x, y + 1, w, h - 2);
  let yy = y + 2 - scroll;
  const rows = [];
  for (let i = journal.length - 1; i >= 0; i--) {
    const j = journal[i];
    const col = j.kind === 'level' ? C.yellow : j.kind === 'move' ? C.cyan : j.kind === 'record' ? C.gold : j.kind === 'env' ? C.orchid : j.kind === 'first' ? C.lime : C.silver;
    const lines = wrap(j.text, w - 34);
    if (yy + lines.length * rowH > y && yy < y + h) {
      mini(fb, 'G' + j.gen, x + 3, yy + 3, C.steel);
      lines.forEach((ln, k) => text(fb, ln, x + 28, yy + k * rowH, col));
    }
    rows.push({ y0: yy, y1: yy + lines.length * rowH, gen: j.gen });
    yy += lines.length * rowH + 2;
  }
  fb.resetClip();
  return { rows, total: yy + scroll - y };
}

export { IN_GROUPS };
