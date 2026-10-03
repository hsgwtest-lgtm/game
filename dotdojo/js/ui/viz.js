// 学習の様子を「見える化」する部品（AIの目・脳・行動の確率・グラフ・方針マップ）

import { C, text, mini, miniMeasure } from './widgets.js';
import { ICON } from '../gfx/sprites.js';
import { VC, VS, CH_WALL, CH_DANGER, CH_GOAL, CH_ITEM, I_DX, I_DY, I_KEY, N_ACT, T_WALL, T_VOID, T_GOAL, T_DOOR, T_SPIKE_A, T_SPIKE_B } from '../sim/env.js';
import { softmax } from '../ml/nn.js';

export const ACT_ICON = [ICON.up, ICON.down, ICON.left, ICON.right, ICON.wait];
export const ACT_NAME = ['うえ', 'した', 'ひだり', 'みぎ', 'まつ'];

// 価値（-1..1 くらい）→ 色（低い=暗い紺 … 高い=明るい黄）
export const HEAT = [C.ink, C.navy, C.blue, C.plum, C.orchid, C.red, C.orange, C.gold, C.yellow, C.white];
export function heat(v) {
  const i = Math.max(0, Math.min(HEAT.length - 1, Math.floor(v * (HEAT.length - 0.01))));
  return HEAT[i];
}
// 3D のゆか用（hex）
export const HEAT_HEX = [0x181425, 0x262b44, 0x124e89, 0x68386c, 0xb55088, 0xe43b44, 0xf77622, 0xfeae34, 0xfee761, 0xffffff];
export function heatHex(v) { return HEAT_HEX[Math.max(0, Math.min(HEAT_HEX.length - 1, Math.floor(v * (HEAT_HEX.length - 0.01))))]; }

// 重みや活動(-1..1) → 色（マイナス=赤系、プラス=青系）
const POS = [C.slate, C.blue, C.sky, C.cyan, C.white];
const NEG = [C.slate, C.plum, C.crimson, C.red, C.pink];
export function signed(v, scale = 1) {
  const a = Math.min(0.999, Math.abs(v) / scale);
  const i = Math.floor(a * 5);
  return v >= 0 ? POS[i] : NEG[i];
}

// AIの目（5×5）。色: きけん=赤 かべ=灰 ゴール=金 アイテム=黄 なし=紺
export function drawEye(fb, obs, x, y, cell = 6, opts = {}) {
  const W = VS * cell;
  fb.rect(x - 2, y - 2, W + 4, W + 4, C.ink);
  fb.frame(x - 1, y - 1, W + 2, W + 2, opts.frame ?? C.steel);
  for (let r = 0; r < VS; r++) {
    for (let c = 0; c < VS; c++) {
      const k = r * VS + c;
      let col = C.navy;
      if (obs[CH_DANGER * VC + k] > 0.5) col = C.red;
      else if (obs[CH_WALL * VC + k] > 0.5) col = C.gray;
      else if (obs[CH_GOAL * VC + k] > 0.5) col = C.gold;
      else if (obs[CH_ITEM * VC + k] > 0.5) col = C.yellow;
      fb.rect(x + c * cell, y + r * cell, cell, cell, col);
      if (cell >= 5 && col === C.navy && ((r + c) & 1)) fb.px(x + c * cell + (cell >> 1), y + r * cell + (cell >> 1), C.slate);
    }
  }
  // まんなか＝自分
  const cx = x + 2 * cell, cy = y + 2 * cell;
  fb.frame(cx, cy, cell, cell, C.white);
  if (cell >= 6) fb.rect(cx + 2, cy + 2, cell - 4, cell - 4, opts.self ?? C.cyan);
  return W;
}

// ゴールの方角（コンパス）
export function drawCompass(fb, obs, cx, cy, r = 6) {
  fb.disc(cx, cy, r, C.ink);
  fb.circle(cx, cy, r, C.steel);
  const dx = obs[I_DX], dy = obs[I_DY];
  const l = Math.hypot(dx, dy) || 1;
  const ex = Math.round(cx + dx / l * (r - 2)), ey = Math.round(cy + dy / l * (r - 2));
  fb.line(cx, cy, ex, ey, C.gold);
  fb.rect(ex - 1, ey - 1, 2, 2, C.yellow);
  if (obs[I_KEY] > 0.5) fb.icon(ICON.key, cx + r + 2, cy - 2, C.gold);
}

// 行動の確率（横棒）。probs: 5つ, pick: 実際に選んだ行動, human: 人の操作
export function drawProbs(fb, probs, x, y, w, opts = {}) {
  const bw = w - 12;
  for (let a = 0; a < N_ACT; a++) {
    const yy = y + a * 8;
    const on = opts.pick === a;
    fb.icon(ACT_ICON[a], x, yy, on ? (opts.color ?? C.yellow) : C.silver);
    fb.rect(x + 10, yy + 1, bw, 5, C.ink);
    const fw = Math.round(bw * Math.max(0, Math.min(1, probs[a])));
    if (fw > 0) fb.rect(x + 10, yy + 1, fw, 5, on ? (opts.color ?? C.yellow) : C.steel);
    if (opts.human === a) fb.frame(x + 9, yy, bw + 2, 7, C.white);
  }
  return N_ACT * 8;
}

// 脳の図：入力（目＋コンパス）→ 隠れ層16 → 出力5
export function drawBrain(fb, net, obs, x, y, w, h, opts = {}) {
  const cell = opts.cell || 4;
  drawEye(fb, obs, x + 2, y + 2, cell);
  const eyeW = VS * cell + 4;
  drawCompass(fb, obs, x + 2 + eyeW / 2 - 2, y + eyeW + 12, 6);
  const nh = net.nHid;
  const hx = x + Math.round(w * 0.52);
  const top = y + 3, span = h - 6;
  const hPos = [];
  for (let j = 0; j < nh; j++) hPos.push([hx, Math.round(top + (j + 0.5) * span / nh)]);
  const ox = x + w - 18;
  const oPos = [];
  for (let k = 0; k < net.nOut; k++) oPos.push([ox, Math.round(top + (k + 0.5) * span / net.nOut)]);
  const wts = net.w, nIn = net.nIn;
  // 入力 → 隠れ：各ニューロンへの寄与が大きい2本だけ
  const srcX = x + eyeW + 2;
  for (let j = 0; j < nh; j++) {
    let b1 = -1, b2 = -1, v1 = 0, v2 = 0;
    for (let i = 0; i < nIn; i++) {
      const c = Math.abs(wts[j * nIn + i] * obs[i]);
      if (c > v1) { v2 = v1; b2 = b1; v1 = c; b1 = i; } else if (c > v2) { v2 = c; b2 = i; }
    }
    for (const [bi, bv] of [[b1, v1], [b2, v2]]) {
      if (bi < 0 || bv < 0.3) continue;
      const sy = y + 2 + Math.min(VS * cell - 1, Math.floor((bi % VC) / VS) * cell + (cell >> 1));
      fb.dline(srcX, sy, hPos[j][0] - 3, hPos[j][1], signed(wts[j * nIn + bi] * obs[bi], 1.5), 1, 1);
    }
  }
  // 隠れ → 出力：強いつながり
  for (let k = 0; k < net.nOut; k++) {
    for (let j = 0; j < nh; j++) {
      const c = wts[net.oW2 + k * nh + j] * net.h[j];
      if (Math.abs(c) < 0.5) continue;
      fb.line(hPos[j][0] + 3, hPos[j][1], oPos[k][0] - 4, oPos[k][1], signed(c, 2));
    }
  }
  for (let j = 0; j < nh; j++) {
    const [px, py] = hPos[j];
    fb.rect(px - 2, py - 2, 5, 5, C.ink);
    fb.rect(px - 1, py - 1, 3, 3, signed(net.h[j], 1));
  }
  const probs = opts.probs || softmax(net.z, new Float32Array(net.nOut));
  let best = 0;
  for (let k = 1; k < net.nOut; k++) if (probs[k] > probs[best]) best = k;
  for (let k = 0; k < net.nOut; k++) {
    const [px, py] = oPos[k];
    const on = k === best;
    fb.rect(px - 3, py - 3, 7, 7, C.ink);
    fb.rect(px - 2, py - 2, 5, 5, on ? (opts.color ?? C.yellow) : signed(probs[k] * 2 - 0.4, 1));
    fb.icon(ACT_ICON[k], px + 5, py - 3, on ? (opts.color ?? C.yellow) : C.steel);
  }
}

// 折れ線グラフ。series: [{data:[..], color, max?}], opts: {min, max, label}
export function drawGraph(fb, series, x, y, w, h, opts = {}) {
  fb.rect(x, y, w, h, C.ink);
  fb.frame(x, y, w, h, C.slate);
  let lo = opts.min ?? Infinity, hi = opts.max ?? -Infinity;
  let n = 0;
  for (const s of series) {
    n = Math.max(n, s.data.length);
    if (opts.min == null) for (const v of s.data) lo = Math.min(lo, v);
    if (opts.max == null) for (const v of s.data) hi = Math.max(hi, v);
  }
  if (!isFinite(lo)) lo = 0;
  if (!isFinite(hi)) hi = 1;
  if (hi - lo < 1e-6) hi = lo + 1;
  // 目盛り
  for (let k = 1; k < 4; k++) fb.dline(x + 1, y + Math.round(h * k / 4), x + w - 2, y + Math.round(h * k / 4), C.navy, 1, 2);
  if (opts.zero && lo < 0 && hi > 0) {
    const zy = y + h - 2 - Math.round((0 - lo) / (hi - lo) * (h - 4));
    fb.hline(x + 1, x + w - 2, zy, C.slate);
  }
  if (n < 2) {
    if (opts.empty) text(fb, opts.empty, x + w / 2, y + h / 2 - 6, C.steel, { align: 'center' });
    return;
  }
  for (const s of series) {
    const d = s.data;
    const m = d.length;
    let px0 = -1, py0 = -1;
    for (let i = 0; i < m; i++) {
      const px = x + 2 + Math.round(i / Math.max(1, n - 1) * (w - 5));
      const py = y + h - 3 - Math.round((d[i] - lo) / (hi - lo) * (h - 6));
      if (px0 >= 0) fb.line(px0, py0, px, py, s.color);
      px0 = px; py0 = py;
    }
    if (s.dot && m) fb.rect(px0 - 1, py0 - 1, 3, 3, s.color);
  }
  if (opts.hiLabel) mini(fb, opts.hiLabel, x + w - 3, y + 3, C.steel, 'right');
  if (opts.loLabel) mini(fb, opts.loLabel, x + w - 3, y + h - 8, C.steel, 'right');
}

// 上から見た地図。opts: {arrows, values, path, agents, focusXY}
export function drawMap(fb, st, x, y, cell, opts = {}) {
  const W = st.W, H = st.H;
  fb.rect(x - 1, y - 1, W * cell + 2, H * cell + 2, C.ink);
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const t = st.tile(xx, yy);
      const i = yy * W + xx;
      let col = ((xx + yy) & 1) ? C.green : C.forest;
      if (t === T_VOID) col = C.ink;
      else if (t === T_WALL) col = C.steel;
      else if (t === T_GOAL) col = C.gold;
      else if (t === T_DOOR) col = C.brown;
      else if (t === T_SPIKE_A || t === T_SPIKE_B) col = C.slate;
      if (opts.values && opts.values[i] != null && t !== T_VOID && t !== T_WALL) col = heat(opts.values[i]);
      fb.rect(x + xx * cell, y + yy * cell, cell, cell, col);
      if (st.keyIdx === i && opts.showKey !== false) fb.rect(x + xx * cell + (cell >> 1) - 1, y + yy * cell + (cell >> 1) - 1, 3, 3, C.yellow);
      if (st.coinAt[i] >= 0) fb.rect(x + xx * cell + (cell >> 1) - 1, y + yy * cell + (cell >> 1) - 1, 2, 2, C.yellow);
    }
  }
  // 足あと
  if (opts.path) {
    const p = opts.path;
    for (let k = 1; k < p.length; k++) {
      const [x0, y0] = p[k - 1], [x1, y1] = p[k];
      fb.line(x + x0 * cell + (cell >> 1), y + y0 * cell + (cell >> 1), x + x1 * cell + (cell >> 1), y + y1 * cell + (cell >> 1), opts.pathColor ?? C.white);
    }
  }
  if (opts.paths) {
    for (const pp of opts.paths) {
      const p = pp.path, col = pp.color;
      for (let k = 1; k < p.length; k++) {
        const [x0, y0] = p[k - 1], [x1, y1] = p[k];
        fb.line(x + x0 * cell + (cell >> 1), y + y0 * cell + (cell >> 1), x + x1 * cell + (cell >> 1), y + y1 * cell + (cell >> 1), col);
      }
    }
  }
  // 矢印（方針）
  if (opts.arrows && cell >= 7) {
    for (let i = 0; i < W * H; i++) {
      const o = opts.arrows[i];
      if (!o) continue;
      const xx = i % W, yy = Math.floor(i / W);
      const cx = x + xx * cell + (cell >> 1), cy = y + yy * cell + (cell >> 1);
      const col = o.conf > 0.8 ? C.white : o.conf > 0.5 ? C.silver : C.gray;
      drawMiniArrow(fb, cx, cy, o.a, col);
    }
  }
  // スタートとゴール
  for (const s of st.starts) fb.frame(x + s.x * cell, y + s.y * cell, cell, cell, C.white);
  if (opts.focusXY) {
    const [fx, fy] = opts.focusXY;
    fb.frame(x + fx * cell - 1, y + fy * cell - 1, cell + 2, cell + 2, C.yellow);
  }
}

export function drawMiniArrow(fb, cx, cy, a, col) {
  if (a === 4) { fb.rect(cx - 1, cy - 1, 2, 2, col); return; }
  const d = [[0, -1], [0, 1], [-1, 0], [1, 0]][a];
  fb.line(cx - d[0] * 2, cy - d[1] * 2, cx + d[0] * 2, cy + d[1] * 2, col);
  const hx = cx + d[0] * 2, hy = cy + d[1] * 2;
  fb.px(hx - d[1] - d[0], hy - d[0] - d[1], col);
  fb.px(hx + d[1] - d[0], hy + d[0] - d[1], col);
}

// 方針マップを計算する（注目しているでしの状況のまま、全マスに置いてみる）
// probsFn(obs) → 確率5つ, valueFn(obs) → 価値
export function computePolicyMap(st, ep, i, probsFn, valueFn = null) {
  const W = st.W, H = st.H;
  const obs = new Float32Array(105);
  const arrows = new Array(W * H).fill(null);
  const values = valueFn ? new Array(W * H).fill(null) : null;
  let vmin = Infinity, vmax = -Infinity;
  const hasKey = ep.key[i];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = st.tile(x, y);
      if (t === T_WALL || t === T_VOID || t === T_GOAL) continue;
      if (t === T_DOOR && !hasKey) continue;
      ep.observe(i, obs, x, y, hasKey);
      const p = probsFn(obs);
      let b = 0;
      for (let k = 1; k < 5; k++) if (p[k] > p[b]) b = k;
      arrows[y * W + x] = { a: b, conf: p[b] };
      if (valueFn) {
        const v = valueFn(obs);
        values[y * W + x] = v;
        vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
      }
    }
  }
  if (values) {
    // 価値を 0..1 にそろえる（色にするため）
    const lo = Math.min(vmin, -1), hi = Math.max(vmax, 2);
    for (let k = 0; k < values.length; k++) if (values[k] != null) values[k] = (values[k] - lo) / (hi - lo);
  }
  return { arrows, values };
}

export { miniMeasure };
