// ドットで描くグラフ類（学習曲線・レーダー・ミニアリーナ・陣取りバー）

import { col } from './ui.js';
import { C, TEAM } from '../core/const.js';
import { mini, text } from '../gfx/font.js';
import { GW, GH } from '../sim/arenas.js';
import { RADAR_SHORT } from '../game/coach.js';

// 折れ線グラフ。series: [{data:[...], color, dots}], opt: {min, max, grid:[...], label}
export function lineChart(fb, x, y, w, h, series, opt = {}) {
  fb.rect(x, y, w, h, col(opt.bg ?? C.ink));
  let min = opt.min, max = opt.max;
  if (min === undefined || max === undefined) {
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (const v of s.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) { hi = lo + 1; }
    const pad = (hi - lo) * 0.08;
    if (min === undefined) min = lo - pad;
    if (max === undefined) max = hi + pad;
  }
  const Y = v => y + h - 1 - Math.round((v - min) / (max - min) * (h - 1));
  for (const g of opt.grid || []) {
    if (g < min || g > max) continue;
    fb.dline(x, Y(g), x + w - 1, Y(g), col(opt.gridColor ?? C.night), 1, 2);
  }
  for (const s of series) {
    const d = s.data;
    const n = d.length;
    if (n < 1) continue;
    const span = Math.max(1, (opt.n || n) - 1);
    let px = -1, py = -1;
    for (let i = 0; i < n; i++) {
      const vx = x + Math.round(i / span * (w - 1));
      const vy = Math.max(y, Math.min(y + h - 1, Y(d[i])));
      if (px >= 0) fb.line(px, py, vx, vy, col(s.color));
      else fb.px(vx, vy, col(s.color));
      px = vx; py = vy;
    }
    if (s.dot !== false && n) fb.rect(px - 1, py - 1, 3, 3, col(s.color));
  }
  if (opt.frame !== false) fb.frame(x - 1, y - 1, w + 2, h + 2, col(C.night));
  return { min, max };
}

// レーダー（6角形）
export function radar(fb, cx, cy, r, vals, color, opt = {}) {
  const n = 6;
  const pt = (i, k) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / n;
    return [Math.round(cx + Math.cos(a) * r * k), Math.round(cy + Math.sin(a) * r * k)];
  };
  for (const k of [0.33, 0.66, 1]) {
    for (let i = 0; i < n; i++) {
      const [x0, y0] = pt(i, k), [x1, y1] = pt((i + 1) % n, k);
      if (k < 1) fb.dline(x0, y0, x1, y1, col(C.night), 1, 1);
      else fb.line(x0, y0, x1, y1, col(C.dusk));
    }
  }
  for (let i = 0; i < n; i++) { const [x0, y0] = pt(i, 1); fb.dline(cx, cy, x0, y0, col(C.night), 1, 2); }
  if (opt.ghost) drawPoly(fb, pt, opt.ghost, col(C.lilac), false);
  if (vals) drawPoly(fb, pt, vals, col(color), true);
  if (opt.labels !== false) {
    for (let i = 0; i < n; i++) {
      const [lx, ly] = pt(i, 1.0);
      const a = -Math.PI / 2 + i * Math.PI * 2 / n;
      const ax = Math.cos(a), ay = Math.sin(a);
      const label = RADAR_SHORT[i];
      const tx = lx + Math.round(ax * 6), ty = ly + Math.round(ay * 7) - 5;
      text(fb, label, tx, ty, col(opt.labelColor ?? C.mist), { align: Math.abs(ax) < 0.2 ? 'center' : ax > 0 ? 'left' : 'right' });
    }
  }
}

function drawPoly(fb, pt, vals, c, fill) {
  const n = 6;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(pt(i, Math.max(0.04, Math.min(1, vals[i] || 0))));
  if (fill) {
    // 中を市松で塗る
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let yy = minY; yy <= maxY; yy++) {
      const xs = [];
      for (let i = 0; i < n; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
        if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) xs.push(x0 + (yy - y0) * (x1 - x0) / (y1 - y0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) fb.checker(Math.ceil(xs[k]), yy, Math.floor(xs[k + 1]) - Math.ceil(xs[k]) + 1, 1, c, 0);
    }
  }
  for (let i = 0; i < n; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n]; fb.line(x0, y0, x1, y1, c); }
  for (const p of pts) fb.rect(p[0] - 1, p[1] - 1, 2, 2, c);
}

// ミニアリーナ（1マス s ピクセル）
const NEU = C.pale, WALLC = C.dusk;
export function miniArena(fb, x, y, s, grid, bots, items, opt = {}) {
  const cols = [col(NEU), col(TEAM[0].main), col(TEAM[1].main), col(WALLC)];
  for (let cy = 0; cy < GH; cy++) {
    for (let cx = 0; cx < GW; cx++) {
      const v = grid[cy * GW + cx];
      fb.rect(x + cx * s, y + cy * s, s, s, cols[v] ?? cols[0]);
    }
  }
  if (items) for (const c of items) {
    const ix = c % GW, iy = (c / GW) | 0;
    fb.rect(x + ix * s, y + iy * s, s, s, col(C.hotpink));
  }
  if (bots) {
    bots.forEach((b, i) => {
      if (!b) return;
      const bx = x + b[0] * s, by = y + b[1] * s;
      const c = col(b[3] > 0 ? C.gold : (i === opt.hi ? C.white : TEAM[i].deep));
      if (s >= 3) { fb.rect(bx, by, s, s, c); fb.px(bx + (s >> 1), by + (s >> 1), col(TEAM[i].light)); } else fb.rect(bx, by, s, s, c);
    });
  }
  if (opt.frame !== false) fb.frame(x - 1, y - 1, GW * s + 2, GH * s + 2, col(opt.frameColor ?? C.night));
}

// 陣取りバー（青｜まっさら｜だいだい）
export function shareBar(fb, x, y, w, h, s0, s1, floor) {
  const a = Math.round(w * s0 / floor), b = Math.round(w * s1 / floor);
  fb.rect(x, y, w, h, col(C.night));
  fb.rect(x, y, a, h, col(TEAM[0].main));
  fb.rect(x + w - b, y, b, h, col(TEAM[1].main));
  if (h > 2) {
    fb.rect(x, y, a, 1, col(TEAM[0].light));
    fb.rect(x + w - b, y, b, 1, col(TEAM[1].light));
  }
  fb.rect(x + (w >> 1), y - 1, 1, h + 2, col(C.white));
}

// 横棒（frac 0〜1）
export function bar(fb, x, y, w, h, frac, color, bg = C.night) {
  fb.rect(x, y, w, h, col(bg));
  const f = Math.max(0, Math.min(1, frac));
  fb.rect(x, y, Math.round(w * f), h, col(color));
}

// 0を中心に左右に伸びる棒（ごほうびの内訳）
export function signedBar(fb, x, y, w, h, v, max, cPos = C.emerald, cNeg = C.scarlet) {
  const mid = x + (w >> 1);
  fb.rect(x, y, w, h, col(C.ink));
  fb.rect(mid, y - 1, 1, h + 2, col(C.dusk));
  const len = Math.round(Math.min(1, Math.abs(v) / Math.max(1e-6, max)) * (w >> 1));
  if (v > 0) fb.rect(mid + 1, y, len, h, col(cPos));
  else if (v < 0) fb.rect(mid - len, y, len, h, col(cNeg));
}

export { mini };
