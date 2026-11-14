// charts.js — ドットで描くグラフ（ブラウザ用）
//   どのグラフも小さな解像度の canvas に 1 ドットずつ描き、CSS で拡大する（image-rendering: pixelated）。
//   線はブレゼンハムで 1 ドット幅、影も 1 ドットずらして描くので、ゲーム画面のような見た目になる
import { METHODS, ACT, N_ACT, ACT_ICON, M } from './defs.js';
import { N_STATES, stateIndex, maxQ } from './qlearn.js';
import * as NN from './nn.js';
import { DAY_TICKS, NIGHT_FROM } from './world.js';
import { pixText, textWidth, iconCanvas, PAL } from './icons.js';

export const BG = '#141c2e';
export const GRID = '#2a3550';
export const AXIS = '#56657a';
export const INK = '#c7d3e3';

// 種の色（12色をくり返す）
export const SP_COLORS = ['#ff6fd8', '#5fe6ff', '#ffd84a', '#63d36a', '#ff9a3c', '#a98bff', '#ff5a5a', '#4fa3ff', '#d4ff5a', '#ffb3e6', '#3fe0a8', '#e0c08a'];
export const spColor = (id) => (id < 0 ? '#7d8aa0' : SP_COLORS[id % SP_COLORS.length]);

// 行動の色
export const ACT_COLORS = ['#63d36a', '#5fe6ff', '#4fa3ff', '#3d7bd6', '#7dd0ff', '#a98bff'];

export class Pix {
  constructor(cv, w, h) {
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    this.cv = cv;
    this.w = w;
    this.h = h;
    this.ctx = cv.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
  }
  clear(c = BG) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }
  px(x, y, c) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  rect(x, y, w, h, c) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  // 1 ドット幅の線（ブレゼンハム）
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const ctx = this.ctx;
    ctx.fillStyle = c;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      ctx.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  dotted(x0, y, x1, c, step = 2) {
    for (let x = Math.round(x0); x <= x1; x += step) this.px(x, y, c);
  }
  vdotted(x, y0, y1, c, step = 2) {
    for (let y = Math.round(y0); y <= y1; y += step) this.px(x, y, c);
  }
  text(s, x, y, c = INK) {
    pixText(this.ctx, s, x, y, c);
  }
  // 1 ドットの影つき文字
  textS(s, x, y, c = INK) {
    pixText(this.ctx, s, x + 1, y + 1, '#000');
    pixText(this.ctx, s, x, y, c);
  }
  icon(name, x, y) {
    this.ctx.drawImage(iconCanvas(name), Math.round(x), Math.round(y));
  }
}

// 目盛りにちょうどよい刻み
function niceStep(max, n = 3) {
  const raw = max / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
const fmt = (v) => (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1));

function movingAvg(a, k) {
  const out = new Array(a.length);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= k) s -= a[i - k];
    out[i] = s / Math.min(i + 1, k);
  }
  return out;
}

// ---- 学習曲線（方式ごと）。metric: fit / best / life / births / share / eps
export const METRICS = {
  fit: { ja: '平均の草', unit: '草/家族' },
  best: { ja: 'ベスト家族', unit: '草' },
  life: { ja: '生存日数', unit: '日' },
  births: { ja: '生まれた数', unit: '匹' },
  share: { ja: '取り分', unit: '%' },
};
export function drawCurves(cv, lab, metric = 'fit', opt = {}) {
  const W = opt.w || 200;
  const H = opt.h || 112;
  const p = new Pix(cv, W, H);
  p.clear();
  const ms = lab.cfg.methods;
  const series = [];
  let n = 0;
  let max = 0;
  for (const m of ms) {
    let a = lab.hist[m][metric] || [];
    if (metric === 'share') a = a.map((v) => v * 100);
    if (!a.length) continue;
    series.push({ m, a });
    n = Math.max(n, a.length);
    for (const v of a) if (v > max) max = v;
  }
  if (metric === 'share') max = Math.max(max, 50);
  const step = niceStep(Math.max(max, 1e-6) * 1.05);
  const top = Math.max(step, Math.ceil((max * 1.05) / step) * step);
  const lab0 = fmt(top);
  const L = textWidth(lab0) + 4;
  const B = 8;
  const T = 4;
  const R = 3;
  const pw = W - L - R;
  const ph = H - B - T;
  const Y = (v) => T + ph - 1 - Math.round((v / top) * (ph - 1));
  // 目盛り
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = Y(v);
    p.dotted(L, y, W - R - 1, GRID, 2);
    p.text(fmt(v), L - 3 - textWidth(fmt(v)), y - 2, AXIS);
  }
  p.rect(L - 1, T, 1, ph, AXIS);
  p.rect(L - 1, T + ph, pw + 1, 1, AXIS);
  if (!n) {
    p.text('NO DATA', L + pw / 2 - 13, T + ph / 2 - 2, AXIS);
    return;
  }
  // 横軸: 世代
  const X = (i) => L + (n <= 1 ? 0 : Math.round((i / (n - 1)) * (pw - 1)));
  p.text('G0', L, H - 6, AXIS);
  const gl = `G${n - 1}`;
  p.text(gl, W - R - textWidth(gl), H - 6, AXIS);
  // ルールの水準（点線）
  if (opt.ruleLine && ms.includes(M.RULE) && metric !== 'share') {
    const ra = lab.hist[M.RULE][metric];
    if (ra && ra.length) {
      const rv = ra.reduce((a, b) => a + b, 0) / ra.length;
      p.dotted(L, Y(rv), W - R - 1, METHODS[M.RULE].dark, 3);
    }
  }
  // 生の値は暗い点、移動平均は明るい線（影つき）
  const k = Math.max(1, Math.round(n / 40));
  for (const { m, a } of series) {
    const dark = METHODS[m].dark;
    if (n <= pw * 2) for (let i = 0; i < a.length; i++) p.px(X(i), Y(a[i]), dark);
  }
  for (const { m, a } of series) {
    const sm = movingAvg(a, Math.max(3, k * 2));
    const col = METHODS[m].color;
    let lx = -1;
    let ly = -1;
    const pts = [];
    if (sm.length > pw) {
      // 1列に複数の世代が入るときは平均してまとめる
      for (let x = 0; x < pw; x++) {
        const i0 = Math.floor((x / pw) * sm.length);
        const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / pw) * sm.length));
        let s = 0;
        for (let i = i0; i < i1; i++) s += sm[i];
        pts.push([L + x, Y(s / (i1 - i0))]);
      }
    } else for (let i = 0; i < sm.length; i++) pts.push([X(i), Y(sm[i])]);
    for (const [x, y] of pts) {
      if (lx >= 0) p.line(lx, ly + 1, x, y + 1, '#000');
      lx = x;
      ly = y;
    }
    lx = -1;
    for (const [x, y] of pts) {
      if (lx >= 0) p.line(lx, ly, x, y, col);
      else p.px(x, y, col);
      lx = x;
      ly = y;
    }
    // いまの値に目印
    const [ex, ey] = pts[pts.length - 1];
    p.rect(ex - 1, ey - 1, 3, 3, '#000');
    p.px(ex, ey, col);
  }
}

// ---- 系図（進化NN・ランダム＋選択）。世代を横に並べ、親から子へ線を引く
export function drawLineage(cv, lab, m, opt = {}) {
  const all = lab.lineage[m] || [];
  const cw = opt.colW || 5;
  const maxCols = opt.maxW ? Math.max(8, Math.floor((opt.maxW - 6) / cw)) : all.length;
  const lin = all.slice(-maxCols);
  const cols = lin.length;
  const rows = Math.max(1, ...lin.map((e) => e.ids.length));
  const rh = rows > 28 ? 3 : 4;
  const L = 2;
  const T = 9;
  const W = Math.max(opt.maxW ? Math.min(120, opt.maxW) : 120, L + cols * cw + 4);
  const H = T + rows * rh + 3;
  const p = new Pix(cv, W, H);
  p.clear();
  if (!cols) {
    p.text('WAIT 1 GEN', 4, 2, AXIS);
    return { W, H };
  }
  // 並び順: はじめの列は 種→適応度、そのあとは親の位置にそろえる（線が交わりにくい）
  const rowOf = [];
  for (let c = 0; c < cols; c++) {
    const e = lin[c];
    const idx = e.ids.map((_, i) => i);
    if (c === 0) idx.sort((a, b) => e.sp[a] - e.sp[b] || e.fit[b] - e.fit[a]);
    else {
      const prev = rowOf[c - 1];
      const key = (i) => {
        const ps = e.parents[i] || [];
        let s = 0;
        let k = 0;
        for (const g of ps) {
          if (prev.has(g)) {
            s += prev.get(g) + (k ? 0.01 : 0);
            k++;
          }
        }
        return k ? s / k : rows;
      };
      idx.sort((a, b) => key(a) - key(b) || e.sp[a] - e.sp[b]);
    }
    const map = new Map();
    idx.forEach((i, r) => map.set(e.ids[i], r));
    rowOf.push(map);
  }
  const X = (c) => L + c * cw + 2;
  const Yr = (r) => T + r * rh + 1;
  // 最新世代のいちばん成績のよい個体の祖先をたどる
  const anc = new Set();
  {
    const last = lin[cols - 1];
    let bi = 0;
    for (let i = 1; i < last.fit.length; i++) if (last.fit[i] > last.fit[bi]) bi = i;
    let frontier = new Set([last.ids[bi]]);
    for (let c = cols - 1; c >= 0 && frontier.size; c--) {
      const e = lin[c];
      const next = new Set();
      e.ids.forEach((g, i) => {
        if (frontier.has(g)) {
          anc.add(g);
          for (const pg of e.parents[i] || []) next.add(pg);
        }
      });
      frontier = next;
    }
  }
  // 世代の目盛り
  for (let c = 0; c < cols; c++) {
    if (lin[c].gen % 10 === 0) {
      p.vdotted(X(c), T, H - 2, GRID, 2);
      if (X(c) + textWidth(String(lin[c].gen)) < W) p.text(String(lin[c].gen), X(c), 1, AXIS);
    }
  }
  // 親子の線（ふつう → 祖先の順に描く）
  for (const pass of [0, 1]) {
    for (let c = 1; c < cols; c++) {
      const e = lin[c];
      const prev = rowOf[c - 1];
      e.ids.forEach((g, i) => {
        const isAnc = anc.has(g);
        if ((pass === 1) !== isAnc) return;
        (e.parents[i] || []).forEach((pg, j) => {
          if (!prev.has(pg)) return;
          const col = isAnc && anc.has(pg) ? '#ffd84a' : j === 0 ? shade(spColor(e.sp[i]), 0.45) : shade(spColor(e.sp[i]), 0.28);
          p.line(X(c - 1), Yr(prev.get(pg)), X(c), Yr(rowOf[c].get(g)), col);
        });
      });
    }
  }
  // 個体の点
  for (let c = 0; c < cols; c++) {
    const e = lin[c];
    let bi = 0;
    for (let i = 1; i < e.fit.length; i++) if (e.fit[i] > e.fit[bi]) bi = i;
    e.ids.forEach((g, i) => {
      const x = X(c);
      const y = Yr(rowOf[c].get(g));
      const col = spColor(e.sp[i]);
      if (rh >= 4) p.rect(x - 1, y - 1, 2, 2, col);
      else p.px(x, y, col);
      if (e.elite[i]) p.px(x, y, '#ffffff');
      if (i === bi) p.px(x, y - 1, '#ffd84a');
    });
  }
  return { W, H, anc: anc.size };
}

// 色を白に近づける
export function tint(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * f);
  const g = Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * f);
  const b = Math.round((n & 255) + (255 - (n & 255)) * f);
  return `rgb(${r},${g},${b})`;
}

// 色を暗くする
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

// ---- 種の川（世代ごとの種の頭数を積み上げる）
export function drawSpeciesRiver(cv, book, gen, opt = {}) {
  const span = opt.span || 60;
  const g0 = Math.max(0, gen - span);
  const cols = gen - g0;
  const cw = opt.colW || (opt.maxW ? Math.max(2, Math.min(4, Math.floor((opt.maxW - 6) / Math.max(1, cols)))) : 4);
  const W = Math.max(opt.maxW ? Math.min(120, opt.maxW) : 120, cols * cw + 6);
  const H = opt.h || 44;
  const p = new Pix(cv, W, H);
  p.clear();
  if (!book || cols <= 0) {
    p.text('WAIT 1 GEN', 4, 4, AXIS);
    return;
  }
  const per = Array.from({ length: cols }, () => []);
  let maxTot = 1;
  for (const sp of book.list) {
    for (let i = 0; i < sp.counts.length; i += 2) {
      const g = sp.counts[i];
      if (g >= g0 && g < gen) per[g - g0].push([sp.id, sp.counts[i + 1]]);
    }
  }
  for (const a of per) {
    a.sort((x, y) => x[0] - y[0]);
    maxTot = Math.max(maxTot, a.reduce((s, v) => s + v[1], 0));
  }
  const ph = H - 2;
  for (let c = 0; c < cols; c++) {
    let y = H - 1;
    for (const [id, n] of per[c]) {
      const h = Math.max(1, Math.round((n / maxTot) * ph));
      p.rect(2 + c * cw, y - h, cw - 1, h, spColor(id));
      p.rect(2 + c * cw, y - h, cw - 1, 1, tint(spColor(id), 0.4));
      y -= h;
    }
  }
}

// ---- Q表の「方針地図」。3×3 の大きなマス（縦: 体力 / 横: 足元の草）の中に 4×4（縦: 昼夜×におい / 横: においの方向）
const MINI = {
  [ACT.EAT]: ['.....', '.x.x.', '..x..', '.x.x.', '.....'],
  [ACT.N]: ['..x..', '.xxx.', 'x.x.x', '..x..', '..x..'],
  [ACT.E]: ['..x..', '...x.', 'xxxxx', '...x.', '..x..'],
  [ACT.S]: ['..x..', '..x..', 'x.x.x', '.xxx.', '..x..'],
  [ACT.W]: ['..x..', '.x...', 'xxxxx', '.x...', '..x..'],
  [ACT.SLEEP]: ['xxxx.', '..x..', '.x...', 'xxxx.', '.....'],
};
export function drawQPolicy(cv, q, visits) {
  const cs = 7;
  const gap = 3;
  const L = 10;
  const T = 9;
  const bw = 4 * cs;
  const W = L + 3 * bw + 2 * gap + 2;
  const H = T + 3 * bw + 2 * gap + 2;
  const p = new Pix(cv, W, H);
  p.clear();
  const gl = ['G0', 'G1', 'G2'];
  const el = ['E0', 'E1', 'E2'];
  for (let g = 0; g < 3; g++) p.text(gl[g], L + g * (bw + gap) + bw / 2 - 3, 1, AXIS);
  for (let e = 0; e < 3; e++) p.text(el[2 - e], 1, T + e * (bw + gap) + bw / 2 - 2, AXIS);
  for (let e = 0; e < 3; e++) {
    for (let g = 0; g < 3; g++) {
      const bx = L + g * (bw + gap);
      const by = T + (2 - e) * (bw + gap); // 満腹を上に
      for (let row = 0; row < 4; row++) {
        const n = row >> 1;
        const st = row & 1;
        for (let d = 0; d < 4; d++) {
          const s = stateIndex(e, g, d, st, n);
          const x = bx + d * cs;
          const y = by + row * cs;
          const seen = visits ? visits[s] > 0 : true;
          const b = s * N_ACT;
          let best = 0;
          for (let a = 1; a < N_ACT; a++) if (q[b + a] > q[b + best]) best = a;
          const allZero = maxQ(q, s) === 0 && q.subarray(b, b + N_ACT).every((v) => v === 0);
          if (!seen || allZero) {
            p.rect(x, y, cs - 1, cs - 1, n ? '#1a2238' : '#232d45');
            p.px(x + 3, y + 3, '#3a4660');
            continue;
          }
          p.rect(x, y, cs - 1, cs - 1, shade(ACT_COLORS[best], n ? 0.38 : 0.5));
          const g5 = MINI[best];
          for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 5; xx++) if (g5[yy][xx] === 'x') p.px(x + xx, y + yy, ACT_COLORS[best]);
        }
      }
      p.rect(bx - 1, by - 1, bw + 1, 1, AXIS);
    }
  }
}
export const Q_STATES = N_STATES;

// ---- 脳の重み（進化NN）。青＝正、赤＝負。4段階に量子化してドットで
function wColor(v) {
  const a = Math.min(1, Math.abs(v) / 2.5);
  const lv = a < 0.12 ? 0 : a < 0.4 ? 1 : a < 0.75 ? 2 : 3;
  if (lv === 0) return '#2a3550';
  return v > 0 ? ['', '#1f6f86', '#3fb4d8', '#9af0ff'][lv] : ['', '#7a2a3a', '#d04a5a', '#ffa0a8'][lv];
}
export function drawBrain(cv, w) {
  const c = 5;
  const W = 172;
  const H = 74;
  const p = new Pix(cv, W, H);
  p.clear();
  if (!w) {
    p.text('NO BRAIN', 4, 4, AXIS);
    return;
  }
  const block = (x0, y0, rows, cols, off, title) => {
    p.text(title, x0, y0, AXIS);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) p.rect(x0 + k * c, y0 + 7 + r * c, c - 1, c - 1, wColor(w[off + r * cols + k]));
  };
  // 全体回路
  block(2, 2, NN.G_HID, NN.G_IN, NN.OFF_WG, 'IN');
  block(30, 2, NN.G_HID, 1, NN.OFF_BG, 'B');
  block(40, 2, NN.G_HID, 1, NN.OFF_WE, 'E');
  block(50, 2, NN.G_HID, 1, NN.OFF_WS, 'Z');
  p.rect(40, 40, c - 1, c - 1, wColor(w[NN.OFF_BE]));
  p.rect(50, 40, c - 1, c - 1, wColor(w[NN.OFF_BS]));
  // 方向回路（4方向で共有）
  block(66, 2, NN.D_HID, NN.D_IN, NN.OFF_A, 'SC');
  block(82, 2, NN.D_HID, NN.G_HID, NN.OFF_U, 'FROM HID');
  block(118, 2, NN.D_HID, 1, NN.OFF_C, 'B');
  block(128, 2, NN.D_HID, 1, NN.OFF_V, 'GO');
  p.rect(128, 32, c - 1, c - 1, wColor(w[NN.OFF_BM]));
  // 凡例
  const lx = 146;
  p.text('+', lx, 2, AXIS);
  for (let i = 0; i < 3; i++) p.rect(lx + 6 + i * 6, 2, 5, 5, wColor(0.6 + i * 0.9));
  p.text('-', lx, 10, AXIS);
  for (let i = 0; i < 3; i++) p.rect(lx + 6 + i * 6, 10, 5, 5, wColor(-(0.6 + i * 0.9)));
  p.text(`W ${NN.N_W}`, lx, 20, AXIS);
  // 入力名の頭文字（体力・草・夜・混雑・気まぐれ）
  ['E', 'G', 'N', 'C', 'R'].forEach((s, i) => p.text(s, 3 + i * c, 41, AXIS));
  ['S', 'X'].forEach((s, i) => p.text(s, 67 + i * c, 31, AXIS));
  p.text('1 HID 6', 2, 50, AXIS);
  p.text('DIR HID 4 X4', 66, 50, AXIS);
  p.text('SHARED N E S W', 66, 58, AXIS);
}

// ---- サイコロ（ランダム＋選択）の平均の出やすさ
export function drawDice(cv, probs, w = 200) {
  const W = w;
  const H = 64;
  const p = new Pix(cv, W, H);
  p.clear();
  const bw = 22;
  const gap = (W - 8 - N_ACT * bw) / (N_ACT - 1);
  const top = 12;
  const ph = H - top - 12;
  for (let a = 0; a < N_ACT; a++) {
    const x = 4 + a * (bw + gap);
    const v = probs ? probs[a] : 0;
    const h = Math.round(v * ph * 1.6);
    const hh = Math.min(ph, h);
    p.rect(x, top, bw, ph, '#1a2238');
    // 2ドットおきの段で積み上げる
    for (let y = 0; y < hh; y += 2) p.rect(x + 1, top + ph - 1 - y, bw - 2, 1, ACT_COLORS[a]);
    const t = `${Math.round(v * 100)}%`;
    p.textS(t, x + bw / 2 - textWidth(t) / 2, 3, INK);
    p.icon(ACT_ICON[a], x + bw / 2 - 4, H - 10);
  }
  p.dotted(4, top + ph - 1 - Math.round((ph * 1.6) / 6), W - 4, '#56657a', 3);
}

// ---- リプレイ: 家族が集めた草（線）と生きている数（棒）。夜は暗い帯、いまの時刻に縦線
export function drawReplay(cv, rep, t, w = 200) {
  const W = w;
  const H = 64;
  const p = new Pix(cv, W, H);
  p.clear();
  if (!rep) return;
  const T = rep.ticks;
  const L = 14;
  const pw = W - L - 3;
  const ph = H - 12;
  const X = (i) => L + Math.round((i / T) * (pw - 1));
  for (let i = 0; i < T; i++) {
    const tod = (i % DAY_TICKS) / DAY_TICKS;
    if (tod >= NIGHT_FROM) p.rect(X(i), 2, Math.max(1, X(i + 1) - X(i)), ph, '#0e1424');
  }
  let maxF = 1;
  let maxA = 1;
  for (let i = 0; i <= T; i++) {
    maxF = Math.max(maxF, rep.famFood[i]);
    maxA = Math.max(maxA, rep.famAlive[i]);
  }
  for (let i = 0; i <= T; i += 2) {
    const h = Math.round((rep.famAlive[i] / maxA) * (ph * 0.5));
    p.rect(X(i), 2 + ph - h, 1, h, '#3a2a55');
  }
  const col = METHODS[rep.m].color;
  let lx = -1;
  let ly = 0;
  for (let i = 0; i <= T; i++) {
    const x = X(i);
    const y = 2 + ph - 1 - Math.round((rep.famFood[i] / maxF) * (ph - 2));
    if (lx >= 0 && x !== lx) {
      p.line(lx, ly + 1, x, y + 1, '#000');
      p.line(lx, ly, x, y, col);
    }
    lx = x;
    ly = y;
  }
  p.text(fmt(maxF), 1, 2, AXIS);
  p.text('0', 1, ph - 3, AXIS);
  const cx = X(Math.min(T, Math.max(0, t)));
  p.rect(cx, 1, 1, ph + 2, '#ffd84a');
  for (let d = 0; d * DAY_TICKS <= T; d++) p.text(`D${d + 1}`, X(d * DAY_TICKS) + 1, H - 7, AXIS);
}

// ---- 競争モード: 取り分の積み上げ
export function drawShare(cv, lab, w = 200) {
  const W = w;
  const H = 48;
  const p = new Pix(cv, W, H);
  p.clear();
  const ms = lab.cfg.methods;
  const n = lab.hist[ms[0]].share.length;
  if (!n) {
    p.text('WAIT 1 GEN', 4, 4, AXIS);
    return;
  }
  const cols = Math.min(n, W - 4);
  for (let x = 0; x < cols; x++) {
    const i = n <= cols ? x : Math.floor((x / cols) * n);
    let y = H - 2;
    const xx = 2 + (n <= cols ? Math.round((x / Math.max(1, n - 1)) * (W - 5)) : x);
    const w = n <= cols ? Math.max(1, Math.ceil((W - 4) / n)) : 1;
    for (const m of ms) {
      const h = Math.round((lab.hist[m].share[i] || 0) * (H - 4));
      p.rect(xx, y - h, w, h, METHODS[m].color);
      y -= h;
    }
  }
  p.dotted(2, Math.round(H / 2), W - 3, '#000', 3);
}

// ---- 小さな棒（0〜1）を 10 段のドットで
export function meterHTML(v, color) {
  const n = Math.max(0, Math.min(10, Math.round(v * 10)));
  let s = '<span class="pmeter" aria-hidden="true">';
  for (let i = 0; i < 10; i++) s += `<i${i < n ? ` style="background:${color}"` : ''}></i>`;
  return `${s}</span>`;
}

export { PAL };
