// 学習の様子を「見える化」する部品（AIの目・脳・操縦・グラフ・DNA）

import { C, text, mini, miniMeasure } from './widgets.js';
import { EYE, NET } from '../core/config.js';
import { EYE_CELLS } from '../sim/flight.js';

// 近さ(0..1) → 色（遠い=暗い紺 … 近い=明るい黄）
export const HEAT = [C.ink, C.navy, C.blue, C.plum, C.orchid, C.red, C.orange, C.gold, C.yellow, C.white];
export function heat(v) {
  const i = Math.max(0, Math.min(HEAT.length - 1, Math.floor(v * (HEAT.length - 0.01))));
  return HEAT[i];
}

// 重みや活動(-1..1) → 色（マイナス=赤系、プラス=青系）
const POS = [C.slate, C.blue, C.sky, C.cyan, C.white];
const NEG = [C.slate, C.plum, C.crimson, C.red, C.pink];
export function signed(v, scale = 1) {
  const a = Math.min(0.999, Math.abs(v) / scale);
  const i = Math.floor(a * 5);
  return v >= 0 ? POS[i] : NEG[i];
}

// AIの目（7x5 の奥行き画像）
export function drawEye(fb, eye, x, y, cell = 6, frame = true) {
  const W = EYE.cols * cell, H = EYE.rows * cell;
  if (frame) { fb.rect(x - 2, y - 2, W + 4, H + 4, C.ink); fb.frame(x - 1, y - 1, W + 2, H + 2, C.steel); }
  for (let r = 0; r < EYE.rows; r++)
    for (let c = 0; c < EYE.cols; c++)
      fb.rect(x + c * cell, y + r * cell, cell, cell, heat(eye[r * EYE.cols + c]));
  return { w: W, h: H };
}

// 操縦（ジョイスティック表示）。ax, ay は -1..1（ay は上が+）
export function drawStick(fb, cx, cy, r, ax, ay, color = C.yellow, ax2 = null, ay2 = null, color2 = C.white) {
  fb.disc(cx, cy, r, C.ink);
  fb.circle(cx, cy, r, C.steel);
  fb.hline(cx - r + 2, cx + r - 2, cy, C.slate);
  fb.vline(cx, cy - r + 2, cy + r - 2, C.slate);
  if (ax2 !== null) {
    const x2 = Math.round(cx + ax2 * (r - 2)), y2 = Math.round(cy - ay2 * (r - 2));
    fb.rect(x2 - 1, y2 - 1, 3, 3, color2);
  }
  const x = Math.round(cx + ax * (r - 2)), y = Math.round(cy - ay * (r - 2));
  fb.line(cx, cy, x, y, color);
  fb.rect(x - 1, y - 1, 3, 3, color);
}

// 脳（ニューラルネット）の図。net: MLP（h に直前の活動が入っている）, inp: 入力
// 入力は「目」の各ピクセル＋4つの状態。強いつながりだけ線を引く。
export function drawBrain(fb, net, inp, x, y, w, h, opts = {}) {
  const cell = opts.cell || 5;
  const eyeW = EYE.cols * cell, eyeH = EYE.rows * cell;
  // 入力（目）
  drawEye(fb, inp, x, y, cell, true);
  // 状態入力（横速度・縦速度・横位置・高さ）
  const sy = y + eyeH + 5;
  const stateLabels = ['VX', 'VY', 'X', 'Y'];
  const stPos = [];
  for (let i = 0; i < 4; i++) {
    const sx = x + i * 9;
    const v = inp[EYE_CELLS + i];
    fb.rect(sx, sy, 7, 7, C.ink);
    fb.rect(sx + 1, sy + 1, 5, 5, signed(v, 1));
    stPos.push([sx + 3, sy + 3]);
    if (opts.labels) mini(fb, stateLabels[i], sx + 4, sy + 9, C.steel, 'center');
  }
  // 隠れ層
  const nh = net.nHid;
  const hx = x + Math.max(eyeW + 22, Math.round(w * 0.55));
  const top = y + 1, span = Math.max(10, h - 4);
  const hPos = [];
  for (let j = 0; j < nh; j++) hPos.push([hx, Math.round(top + (j + 0.5) * span / nh)]);
  // 出力
  const ox = x + w - 6;
  const oPos = [[ox, Math.round(top + span * 0.3)], [ox, Math.round(top + span * 0.7)]];
  const nIn = net.nIn, wts = net.w;
  // 入力 → 隠れ：各隠れニューロンへの寄与が大きい上位3本
  const contrib = [];
  for (let j = 0; j < nh; j++) {
    contrib.length = 0;
    for (let i = 0; i < nIn; i++) {
      const c = wts[j * nIn + i] * inp[i];
      contrib.push([Math.abs(c), c, i]);
    }
    contrib.sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < 3; k++) {
      const [mag, c, i] = contrib[k];
      if (mag < 0.08) break;
      let px, py;
      if (i < EYE_CELLS) { px = x + (i % EYE.cols) * cell + cell / 2; py = y + Math.floor(i / EYE.cols) * cell + cell / 2; }
      else { [px, py] = stPos[i - EYE_CELLS]; }
      fb.dline(px | 0, py | 0, hPos[j][0] - 3, hPos[j][1], signed(c, 1.2), 1, mag > 0.5 ? 0 : 1);
    }
  }
  // 隠れ → 出力
  for (let k = 0; k < 2; k++) {
    for (let j = 0; j < nh; j++) {
      const wv = wts[net.oW2 + k * nh + j];
      const c = wv * net.h[j];
      if (Math.abs(c) < 0.1) continue;
      fb.dline(hPos[j][0] + 3, hPos[j][1], oPos[k][0] - 3, oPos[k][1], signed(c, 1.2), 1, Math.abs(c) > 0.5 ? 0 : 1);
    }
  }
  // ノード
  for (let j = 0; j < nh; j++) {
    const [px, py] = hPos[j];
    fb.disc(px, py, 2, C.ink);
    fb.rect(px - 1, py - 1, 3, 3, signed(net.h[j], 1));
  }
  for (let k = 0; k < 2; k++) {
    const [px, py] = oPos[k];
    fb.disc(px, py, 3, C.ink);
    fb.disc(px, py, 2, signed(net.o[k], 1));
  }
  if (opts.labels) {
    mini(fb, 'H', hx, top - 7, C.gray, 'center');
    mini(fb, 'X', ox - 6, oPos[0][1] - 2, C.gray, 'right');
    mini(fb, 'Y', ox - 6, oPos[1][1] - 2, C.gray, 'right');
  }
  return { outPos: oPos };
}

// 折れ線グラフ。series: [{data:[..], color}], ymax
export function drawChart(fb, x, y, w, h, series, opts = {}) {
  fb.rect(x, y, w, h, C.ink);
  const ymax = opts.ymax || 1;
  // 目盛り
  for (let i = 1; i < 4; i++) {
    const gy = Math.round(y + h - (h - 2) * i / 4) ;
    for (let gx = x + 1; gx < x + w - 1; gx += 3) fb.px(gx, gy, C.navy);
  }
  if (opts.goal) {
    const gy = Math.round(y + h - 1 - (h - 2) * Math.min(1, opts.goal / ymax));
    for (let gx = x + 1; gx < x + w - 1; gx += 2) fb.px(gx, gy, C.lime);
    mini(fb, 'GOAL', x + w - 2, gy - 6, C.lime, 'right');
  }
  // 区切り（ステージが変わった所など）
  if (opts.marks) {
    for (const m of opts.marks) {
      const mx = Math.round(x + 1 + (w - 3) * m.at);
      for (let gy = y + 1; gy < y + h - 1; gy += 2) fb.px(mx, gy, C.steel);
      if (m.label) mini(fb, m.label, mx + 2, y + 2, C.steel);
    }
  }
  for (const s of series) {
    const d = s.data;
    const n = d.length;
    if (n === 0) continue;
    let px = -1, py = -1;
    for (let i = 0; i < n; i++) {
      const vx = Math.round(x + 1 + (n === 1 ? (w - 3) : (w - 3) * i / (n - 1)));
      const vy = Math.round(y + h - 2 - (h - 3) * Math.max(0, Math.min(1, d[i] / ymax)));
      if (px >= 0) fb.line(px, py, vx, vy, s.color);
      else fb.px(vx, vy, s.color);
      px = vx; py = vy;
    }
    if (s.dot) fb.rect(px - 1, py - 1, 3, 3, s.color);
  }
  fb.frame(x - 1, y - 1, w + 2, h + 2, C.steel);
}

// DNA（重み）を色のモザイクで描く。mode: 'value' | 'source'
export function drawDNA(fb, genome, x, y, cols, size, opts = {}) {
  const n = genome.length;
  const rows = Math.ceil(n / cols);
  fb.rect(x - 1, y - 1, cols * size + 2, rows * size + 2, C.ink);
  const blink = opts.blink !== undefined ? opts.blink : false;
  for (let i = 0; i < n; i++) {
    const cx = x + (i % cols) * size, cy = y + Math.floor(i / cols) * size;
    let col;
    if (opts.mut && opts.mut[i] && blink) col = C.white;
    else if (opts.src && opts.srcColors) col = opts.srcColors[opts.src[i]];
    else col = signed(genome[i], 1.0);
    fb.rect(cx, cy, size, size, col);
    if (opts.src && opts.srcColors && !(opts.mut && opts.mut[i] && blink)) {
      // 値の強さを点で重ねる
      if (Math.abs(genome[i]) > 0.6 && size >= 2) fb.px(cx, cy, signed(genome[i], 1.0));
    }
  }
  return { w: cols * size, h: rows * size };
}

// 積み上げ横棒（割合）
export function drawShares(fb, x, y, w, h, parts) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  fb.rect(x - 1, y - 1, w + 2, h + 2, C.ink);
  let cx = x;
  parts.forEach((p, i) => {
    let pw = Math.round(w * p.v / total);
    if (i === parts.length - 1) pw = x + w - cx;
    if (pw > 0) fb.rect(cx, y, pw, h, p.c);
    cx += pw;
  });
}

export { EYE_CELLS };
