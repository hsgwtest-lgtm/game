// charts.js — グラフ（個体数・形質の推移・分布）と脳の図を Canvas 2D で描く
import { DAY_LEN } from './world.js';
import { TRAIT_MIN, TRAIT_MAX, TRAIT_JA, fmtTrait } from './genetics.js';
import { N_IN, N_HID, N_OUT, OFF_W2, INPUT_JA, ACTION_JA } from './brain.js';

export const HERB_COLOR = '#7bd88f';
export const CARN_COLOR = '#ff9a52';
const GRID = 'rgba(255,255,255,0.12)';
const INK = 'rgba(255,255,255,0.86)';
const SUB = 'rgba(255,255,255,0.55)';
const FONT = '-apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", system-ui, sans-serif';

export function spColor(sp, alpha = 1) {
  return `hsla(${Math.round(sp.hue * 360)}, ${Math.round(Math.max(0.45, sp.sat) * 100)}%, ${Math.round(Math.min(0.72, Math.max(0.5, sp.light)) * 100)}%, ${alpha})`;
}

// キャンバスを表示サイズ×端末の画素密度に合わせる
export function prep(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 300;
  const h = cv.clientHeight || 150;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = `11px ${FONT}`;
  g.textBaseline = 'middle';
  return { g, w, h };
}

function axes(g, x0, y0, x1, y1, ymax, t0, t1, fmtY = (v) => String(Math.round(v))) {
  g.strokeStyle = GRID;
  g.lineWidth = 1;
  g.fillStyle = SUB;
  g.textAlign = 'right';
  for (let k = 0; k <= 4; k++) {
    const y = y1 - ((y1 - y0) * k) / 4;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    g.fillText(fmtY((ymax * k) / 4), x0 - 4, y);
  }
  g.textAlign = 'center';
  const d0 = t0 / DAY_LEN;
  const d1 = t1 / DAY_LEN;
  const span = Math.max(0.5, d1 - d0);
  const step = span > 40 ? 10 : span > 16 ? 5 : span > 6 ? 2 : 1;
  for (let d = Math.ceil(d0 / step) * step; d <= d1; d += step) {
    const x = x0 + ((d - d0) / (d1 - d0 || 1)) * (x1 - x0);
    g.fillText(`${Math.floor(d) + 1}日`, x, y1 + 10);
  }
}

// 個体数の推移（草食・肉食の合計と、種ごとの細い線）
export function drawPopulation(cv, sim) {
  const { g, w, h } = prep(cv);
  const H = sim.hist;
  if (H.length < 2) {
    g.fillStyle = SUB;
    g.textAlign = 'center';
    g.fillText('記録がたまるまで少し待ってください', w / 2, h / 2);
    return;
  }
  const x0 = 30;
  const x1 = w - 8;
  const y0 = 8;
  const y1 = h - 18;
  const t0 = H[0].t;
  const t1 = H[H.length - 1].t;
  let ymax = 10;
  for (const s of H) ymax = Math.max(ymax, s.h, s.c);
  ymax = Math.ceil(ymax / 10) * 10;
  axes(g, x0, y0, x1, y1, ymax, t0, t1);
  const X = (t) => x0 + ((t - t0) / (t1 - t0 || 1)) * (x1 - x0);
  const Y = (v) => y1 - (v / ymax) * (y1 - y0);
  // 草（背景の帯）
  g.fillStyle = 'rgba(93,177,67,0.16)';
  g.beginPath();
  g.moveTo(X(t0), y1);
  for (const s of H) g.lineTo(X(s.t), y1 - s.g * (y1 - y0));
  g.lineTo(X(t1), y1);
  g.closePath();
  g.fill();
  // 種ごと
  const ids = new Set();
  for (const s of H) for (const k in s.sp) ids.add(+k);
  g.lineWidth = 1;
  for (const id of ids) {
    const sp = sim.species[id];
    if (!sp) continue;
    g.strokeStyle = spColor(sp, 0.75);
    g.setLineDash(sp.cls === 1 ? [3, 2] : []);
    g.beginPath();
    let pen = false;
    for (const s of H) {
      const v = s.sp[id];
      if (v === undefined) {
        pen = false;
        continue;
      }
      if (!pen) g.moveTo(X(s.t), Y(v));
      else g.lineTo(X(s.t), Y(v));
      pen = true;
    }
    g.stroke();
  }
  g.setLineDash([]);
  g.lineWidth = 2.2;
  for (const [key, col] of [
    ['h', HERB_COLOR],
    ['c', CARN_COLOR],
  ]) {
    g.strokeStyle = col;
    g.beginPath();
    H.forEach((s, i) => (i ? g.lineTo(X(s.t), Y(s[key])) : g.moveTo(X(s.t), Y(s[key]))));
    g.stroke();
  }
}

// 形質の平均（線）とばらつき（帯）の推移
export function drawTraitTrend(cv, sim, cls, ti) {
  const { g, w, h } = prep(cv);
  const H = sim.hist;
  const mk = cls === 0 ? 'mh' : 'mc';
  const sk = cls === 0 ? 'sh' : 'sc';
  const pts = H.filter((s) => s[mk]);
  if (pts.length < 2) {
    g.fillStyle = SUB;
    g.textAlign = 'center';
    g.fillText('この種類の動物がいません', w / 2, h / 2);
    return;
  }
  const x0 = 34;
  const x1 = w - 8;
  const y0 = 8;
  const y1 = h - 18;
  // 変化が見えるよう、縦軸はデータに合わせる（最低でも形質の幅の20%）
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of pts) {
    lo = Math.min(lo, s[mk][ti] - s[sk][ti]);
    hi = Math.max(hi, s[mk][ti] + s[sk][ti]);
  }
  const span = TRAIT_MAX[ti] - TRAIT_MIN[ti];
  const need = span * 0.2;
  if (hi - lo < need) {
    const mid = (hi + lo) / 2;
    lo = mid - need / 2;
    hi = mid + need / 2;
  }
  const pad = (hi - lo) * 0.08;
  lo = Math.max(TRAIT_MIN[ti], lo - pad);
  hi = Math.min(TRAIT_MAX[ti], hi + pad);
  const t0 = H[0].t;
  const t1 = H[H.length - 1].t;
  const X = (t) => x0 + ((t - t0) / (t1 - t0 || 1)) * (x1 - x0);
  const Y = (v) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
  g.strokeStyle = GRID;
  g.fillStyle = SUB;
  g.textAlign = 'right';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    const y = Y(v);
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    g.fillText(fmtTrait(ti, v), x0 - 4, y);
  }
  axes(g, x0, y0, x1, y1, 0, t0, t1, () => '');
  const col = cls === 0 ? HERB_COLOR : CARN_COLOR;
  g.fillStyle = cls === 0 ? 'rgba(123,216,143,0.22)' : 'rgba(255,154,82,0.22)';
  g.beginPath();
  pts.forEach((s, i) => {
    const v = s[mk][ti] + s[sk][ti];
    i ? g.lineTo(X(s.t), Y(v)) : g.moveTo(X(s.t), Y(v));
  });
  for (let i = pts.length - 1; i >= 0; i--) g.lineTo(X(pts[i].t), Y(pts[i][mk][ti] - pts[i][sk][ti]));
  g.closePath();
  g.fill();
  g.strokeStyle = col;
  g.lineWidth = 2.2;
  g.beginPath();
  pts.forEach((s, i) => (i ? g.lineTo(X(s.t), Y(s[mk][ti])) : g.moveTo(X(s.t), Y(s[mk][ti]))));
  g.stroke();
}

// いまの分布（種ごとに色を積み上げたヒストグラム）
export function drawHistogram(cv, sim, cls, ti) {
  const { g, w, h } = prep(cv);
  const B = 16;
  const lo = TRAIT_MIN[ti];
  const hi = TRAIT_MAX[ti];
  const bins = Array.from({ length: B }, () => new Map());
  let maxN = 1;
  for (const c of sim.creatures) {
    if (!c.alive || c.cls !== cls) continue;
    const b = Math.min(B - 1, Math.max(0, Math.floor(((c.t[ti] - lo) / (hi - lo)) * B)));
    bins[b].set(c.sp, (bins[b].get(c.sp) || 0) + 1);
  }
  for (const m of bins) {
    let s = 0;
    for (const v of m.values()) s += v;
    maxN = Math.max(maxN, s);
  }
  const x0 = 8;
  const x1 = w - 8;
  const y0 = 6;
  const y1 = h - 16;
  const bw = (x1 - x0) / B;
  for (let b = 0; b < B; b++) {
    let y = y1;
    for (const [sp, n] of bins[b]) {
      const hh = (n / maxN) * (y1 - y0);
      g.fillStyle = spColor(sim.species[sp]);
      g.fillRect(Math.round(x0 + b * bw + 1), Math.round(y - hh), Math.max(1, Math.round(bw - 2)), Math.round(hh));
      y -= hh;
    }
  }
  g.fillStyle = SUB;
  g.textAlign = 'left';
  g.fillText(`${fmtTrait(ti, lo)}`, x0, h - 6);
  g.textAlign = 'right';
  g.fillText(`${fmtTrait(ti, hi)}`, x1, h - 6);
  g.textAlign = 'center';
  g.fillText(`いまの${TRAIT_JA[ti]}の分布`, (x0 + x1) / 2, h - 6);
}

// 脳の図: 入力12 → 中間8 → 出力5。線の色は重みの符号、太さは大きさ。丸の明るさは今の値
export function drawBrain(cv, c) {
  const { g, w, h } = prep(cv);
  const xi = 74;
  const xh = w * 0.52;
  const xo = w - 70;
  const yi = (i) => 10 + (i * (h - 20)) / (N_IN - 1);
  const yh = (i) => 22 + (i * (h - 44)) / (N_HID - 1);
  const yo = (i) => 26 + (i * (h - 52)) / (N_OUT - 1);
  const W = c.w;
  const edge = (x0, y0, x1, y1, wt, act) => {
    const a = Math.min(1, Math.abs(wt) / 2.5) * (0.25 + 0.75 * Math.min(1, Math.abs(act)));
    if (a < 0.05) return;
    g.strokeStyle = wt > 0 ? `rgba(120,180,255,${a})` : `rgba(255,110,110,${a})`;
    g.lineWidth = 0.5 + Math.min(2.5, Math.abs(wt));
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  for (let hI = 0; hI < N_HID; hI++) for (let i = 0; i < N_IN; i++) edge(xi, yi(i), xh, yh(hI), W[hI * N_IN + i], c.inp[i]);
  for (let o = 0; o < N_OUT; o++) for (let hI = 0; hI < N_HID; hI++) edge(xh, yh(hI), xo, yo(o), W[OFF_W2 + o * N_HID + hI], c.hid[hI]);
  const node = (x, y, v, r) => {
    const t = Math.max(-1, Math.min(1, v));
    g.fillStyle = t >= 0 ? `rgba(255,255,255,${0.2 + 0.8 * t})` : `rgba(255,110,110,${0.2 + 0.8 * -t})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1;
    g.stroke();
  };
  g.textAlign = 'right';
  for (let i = 0; i < N_IN; i++) {
    node(xi, yi(i), c.inp[i], 4);
    g.fillStyle = INK;
    g.fillText(INPUT_JA[i], xi - 8, yi(i));
  }
  for (let hI = 0; hI < N_HID; hI++) node(xh, yh(hI), c.hid[hI], 5);
  g.textAlign = 'left';
  for (let o = 0; o < N_OUT; o++) {
    const on = o === c.act;
    node(xo, yo(o), on ? 1 : 0.15, on ? 7 : 5);
    g.fillStyle = on ? '#ffd84a' : INK;
    g.font = `${on ? 'bold ' : ''}12px ${FONT}`;
    g.fillText(ACTION_JA[o], xo + 11, yo(o));
    g.font = `11px ${FONT}`;
  }
}
