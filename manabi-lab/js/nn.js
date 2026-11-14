// nn.js — 自作の小さなニューラルネット（機械学習ライブラリなし・純粋モジュール）
//
//   2つの回路でできている:
//   ① 全体回路   5入力（体力・足元の草・夜・混雑・気まぐれ）→ 中間6（tanh）→ 「食べる」「眠る」の点数
//   ② 方向回路   その方向の2入力（におい・通れない）＋①の中間6 → 中間4（tanh）→ 「その方向へ歩く」の点数
//                ②は北・東・南・西の4方向で同じ重みを使う（どの向きでも同じ考え方をする＝重み共有）
//   6つの点数のうち、いちばん高い行動をとる。
//   重み91個がそのまま「遺伝子」。生きているあいだは変わらない（学習しない）。
//   良い重みは遺伝的アルゴリズム（ga.js）の選択・交叉・突然変異で、世代をこえて見つかっていく
import { clamp } from './util.js';
import { OBS, ACT } from './defs.js';

export const G_IN = 5;
export const G_HID = 6;
export const D_IN = 2;
export const D_HID = 4;
export const G_IN_JA = ['体力', '足元の草', '夜', '混雑', '気まぐれ'];
export const D_IN_JA = ['におい', '通れない'];

// 重みの並び
export const OFF_WG = 0; // 全体回路の入力→中間 G_HID×G_IN
export const OFF_BG = OFF_WG + G_HID * G_IN; // 30
export const OFF_A = OFF_BG + G_HID; // 36  方向回路の入力→中間 D_HID×D_IN
export const OFF_U = OFF_A + D_HID * D_IN; // 44  全体の中間→方向の中間 D_HID×G_HID
export const OFF_C = OFF_U + D_HID * G_HID; // 68  方向の中間のかたより
export const OFF_V = OFF_C + D_HID; // 72  方向の中間→歩く点数
export const OFF_BM = OFF_V + D_HID; // 76
export const OFF_WE = OFF_BM + 1; // 77  全体の中間→食べる
export const OFF_BE = OFF_WE + G_HID; // 83
export const OFF_WS = OFF_BE + 1; // 84  全体の中間→眠る
export const OFF_BS = OFF_WS + G_HID; // 90
export const N_W = OFF_BS + 1; // 91
export const N_OUT = 6;
export const N_HID = G_HID + 4 * D_HID; // 表示用に中間の値をまとめて持つ（全体6 + 方向4×4）
export const W_MAX = 4;

// でたらめな初期の脳（本能は与えない。ゼロからの出発）
export function randomBrain(rng, scale = 1) {
  const w = new Float32Array(N_W);
  for (let i = 0; i < N_W; i++) w[i] = clamp(rng.gauss() * scale, -W_MAX, W_MAX);
  return w;
}

// 順伝播。hid（全体6 + 方向4×4）と out（6つの点数）に書き込む
export function forward(w, o, hid, out) {
  const g0 = o[OBS.ENERGY];
  const g1 = o[OBS.HERE];
  const g2 = o[OBS.DARK];
  const g3 = o[OBS.CROWD];
  const g4 = o[OBS.NOISE];
  let se = w[OFF_BE];
  let ss = w[OFF_BS];
  for (let j = 0; j < G_HID; j++) {
    const b = OFF_WG + j * G_IN;
    const h = Math.tanh(w[OFF_BG + j] + w[b] * g0 + w[b + 1] * g1 + w[b + 2] * g2 + w[b + 3] * g3 + w[b + 4] * g4);
    hid[j] = h;
    se += w[OFF_WE + j] * h;
    ss += w[OFF_WS + j] * h;
  }
  out[ACT.EAT] = se;
  out[ACT.SLEEP] = ss;
  // 方向回路: 全体の中間からくる分は4方向で共通なので先に計算
  for (let k = 0; k < D_HID; k++) {
    let z = w[OFF_C + k];
    const bu = OFF_U + k * G_HID;
    for (let j = 0; j < G_HID; j++) z += w[bu + j] * hid[j];
    tmpZ[k] = z;
  }
  for (let d = 0; d < 4; d++) {
    const sc = o[OBS.SN + d];
    const blocked = sc < 0 ? 1 : 0;
    const s = blocked ? 0 : sc;
    let sm = w[OFF_BM];
    for (let k = 0; k < D_HID; k++) {
      const h = Math.tanh(tmpZ[k] + w[OFF_A + k * 2] * s + w[OFF_A + k * 2 + 1] * blocked);
      hid[G_HID + d * D_HID + k] = h;
      sm += w[OFF_V + k] * h;
    }
    out[1 + d] = sm;
  }
}
const tmpZ = new Float64Array(D_HID);

export function argmax(a, n = a.length) {
  let bi = 0;
  let bv = a[0];
  for (let i = 1; i < n; i++) {
    if (a[i] > bv) {
      bv = a[i];
      bi = i;
    }
  }
  return bi;
}

// 突然変異: 重みごとに確率 rate で少しずらし、そのうち1割は作り直す
export function mutate(w, rng, rate = 0.12, sigma = 0.3) {
  const pr = rate * 0.1;
  for (let i = 0; i < N_W; i++) {
    const r = rng.next();
    if (r < pr) w[i] = clamp(rng.gauss(), -W_MAX, W_MAX);
    else if (r < rate) w[i] = clamp(w[i] + rng.gauss() * sigma, -W_MAX, W_MAX);
  }
  return w;
}

// 交叉: 中間ニューロン単位で、どちらの親から受け継ぐかを選ぶ
//   （そのニューロンに入る重みと出ていく重みをひとまとまりで受け継ぐので、回路がこわれにくい）
export function crossover(a, b, rng) {
  const w = new Float32Array(N_W);
  for (let j = 0; j < G_HID; j++) {
    const src = rng.next() < 0.5 ? a : b;
    for (let i = 0; i < G_IN; i++) w[OFF_WG + j * G_IN + i] = src[OFF_WG + j * G_IN + i];
    w[OFF_BG + j] = src[OFF_BG + j];
    w[OFF_WE + j] = src[OFF_WE + j];
    w[OFF_WS + j] = src[OFF_WS + j];
  }
  for (let k = 0; k < D_HID; k++) {
    const src = rng.next() < 0.5 ? a : b;
    for (let i = 0; i < D_IN; i++) w[OFF_A + k * D_IN + i] = src[OFF_A + k * D_IN + i];
    for (let j = 0; j < G_HID; j++) w[OFF_U + k * G_HID + j] = src[OFF_U + k * G_HID + j];
    w[OFF_C + k] = src[OFF_C + k];
    w[OFF_V + k] = src[OFF_V + k];
  }
  w[OFF_BM] = (rng.next() < 0.5 ? a : b)[OFF_BM];
  w[OFF_BE] = (rng.next() < 0.5 ? a : b)[OFF_BE];
  w[OFF_BS] = (rng.next() < 0.5 ? a : b)[OFF_BS];
  return w;
}

// 2つの脳のちがい（重みの差の平均）。種の判定に使う
export function distance(a, b) {
  let s = 0;
  for (let i = 0; i < N_W; i++) s += Math.abs(a[i] - b[i]);
  return s / N_W;
}
