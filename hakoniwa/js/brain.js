// brain.js — 自作の小さなニューラルネット（MLライブラリなし）
//   12入力 → 中間8（tanh） → 5出力（行動ごとの点数。いちばん高い行動を選ぶ）
//   重みは遺伝子として子に受け継がれ、突然変異で少しずつ変わる
import { clamp, bytesToB64, b64ToBytes } from './util.js';

export const N_IN = 12;
export const N_HID = 8;
export const N_OUT = 5;
export const OFF_B1 = N_IN * N_HID; // 96
export const OFF_W2 = OFF_B1 + N_HID; // 104
export const OFF_B2 = OFF_W2 + N_HID * N_OUT; // 144
export const N_W = OFF_B2 + N_OUT; // 149
export const W_MAX = 5;

export const IN = {
  ENERGY: 0,
  FOOD: 1,
  THREAT: 2,
  MATE: 3,
  CROWD: 4,
  LOCAL: 5,
  DARK: 6,
  TEMP: 7,
  AGE: 8,
  CANREP: 9,
  RAIN: 10,
  NOISE: 11,
};
export const ACT = { WANDER: 0, EAT: 1, FLEE: 2, REPRO: 3, REST: 4 };

export const INPUT_JA = ['体力', '餌の近さ', '敵の近さ', '仲間の近さ', '混み具合', '足元の餌', '暗さ', '暑さ寒さ', '年齢', '繁殖できる', '雨', '気まぐれ'];
export const ACTION_JA = ['うろうろ', '食べる', '逃げる', '繁殖', '休む'];
export const ACTION_ICON = ['🚶', '🍽️', '💨', '💕', '💤'];

// 順伝播。hid と out に結果を書き込む（毎回の配列確保を避ける）
export function forward(w, inp, hid, out) {
  for (let h = 0; h < N_HID; h++) {
    let s = w[OFF_B1 + h];
    const base = h * N_IN;
    for (let i = 0; i < N_IN; i++) s += w[base + i] * inp[i];
    hid[h] = Math.tanh(s);
  }
  for (let o = 0; o < N_OUT; o++) {
    let s = w[OFF_B2 + o];
    const base = OFF_W2 + o * N_HID;
    for (let h = 0; h < N_HID; h++) s += w[base + h] * hid[h];
    out[o] = s;
  }
}

export const w1Index = (h, i) => h * N_IN + i;
export const w2Index = (o, h) => OFF_W2 + o * N_HID + h;

// 最初の世代の「本能」。でたらめな脳だと初日に全滅するので、
// 「お腹がすいたら食べる」「敵が近いと逃げる」くらいの傾向を持たせ、そこにゆらぎを足す
export function priorBrain(rng, noise = 0.15) {
  const w = new Float32Array(N_W);
  for (let i = 0; i < N_W; i++) w[i] = rng.gauss() * noise;
  const W1 = (h, i, v) => {
    w[w1Index(h, i)] += v;
  };
  const B1 = (h, v) => {
    w[OFF_B1 + h] += v;
  };
  const W2 = (o, h, v) => {
    w[w2Index(o, h)] += v;
  };
  const B2 = (o, v) => {
    w[OFF_B2 + o] += v;
  };
  W1(0, IN.ENERGY, 2);
  B1(0, -1); // h0: 満腹度
  W1(1, IN.FOOD, 2.2); // h1: 餌が見えている
  W1(2, IN.THREAT, 3); // h2: 危険
  W1(3, IN.CANREP, 2);
  W1(3, IN.ENERGY, 1);
  B1(3, -1.6); // h3: 子を残せる
  W1(4, IN.DARK, 2);
  B1(4, -1); // h4: 夜
  W1(5, IN.MATE, 2); // h5: 仲間が近い
  W1(6, IN.CROWD, 2);
  B1(6, -0.6); // h6: 混雑
  W1(7, IN.NOISE, 1.5);
  W1(7, IN.TEMP, 1); // h7: 気まぐれ・不快
  B2(ACT.WANDER, 0.2);
  W2(ACT.WANDER, 6, 0.5);
  W2(ACT.WANDER, 7, 0.3);
  W2(ACT.WANDER, 1, -0.3);
  B2(ACT.EAT, 0.35);
  W2(ACT.EAT, 0, -1.2);
  W2(ACT.EAT, 1, 1.0);
  B2(ACT.FLEE, -0.8);
  W2(ACT.FLEE, 2, 2.6);
  B2(ACT.REPRO, -0.5);
  W2(ACT.REPRO, 3, 2.0);
  W2(ACT.REPRO, 5, 0.4);
  B2(ACT.REST, -0.7);
  W2(ACT.REST, 4, 0.7);
  W2(ACT.REST, 0, 0.4);
  return w;
}

// 突然変異: 一部の重みを少しずらし、ごくまれに大きく作り直す
export function mutateBrain(w, rng, rate = 1) {
  const p = 0.08 * rate;
  const pr = 0.004 * rate;
  for (let i = 0; i < N_W; i++) {
    const r = rng.next();
    if (r < pr) w[i] = rng.gauss() * 0.8;
    else if (r < pr + p) w[i] = clamp(w[i] + rng.gauss() * 0.3, -W_MAX, W_MAX);
  }
}

// 交配: 中間ニューロン単位で親を選ぶ（入出力のつながりをまとめて受け継ぐ）
export function crossoverBrain(a, b, rng) {
  const w = new Float32Array(N_W);
  for (let h = 0; h < N_HID; h++) {
    const src = rng.next() < 0.5 ? a : b;
    for (let i = 0; i < N_IN; i++) w[w1Index(h, i)] = src[w1Index(h, i)];
    w[OFF_B1 + h] = src[OFF_B1 + h];
    for (let o = 0; o < N_OUT; o++) w[w2Index(o, h)] = src[w2Index(o, h)];
  }
  for (let o = 0; o < N_OUT; o++) w[OFF_B2 + o] = (rng.next() < 0.5 ? a : b)[OFF_B2 + o];
  return w;
}

// 保存用: 重みを 1/25 刻みの8bitにして base64 に
export function encodeBrain(w) {
  const b = new Int8Array(N_W);
  for (let i = 0; i < N_W; i++) b[i] = Math.round(clamp(w[i] * 25, -127, 127));
  return bytesToB64(new Uint8Array(b.buffer));
}
export function decodeBrain(s) {
  const u = b64ToBytes(s);
  const b = new Int8Array(u.buffer, u.byteOffset, u.length);
  const w = new Float32Array(N_W);
  for (let i = 0; i < N_W && i < b.length; i++) w[i] = b[i] / 25;
  return w;
}
