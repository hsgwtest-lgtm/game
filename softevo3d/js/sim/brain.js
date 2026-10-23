// 脳（ニューラルネットワーク）
// 入力 = 筋肉の伸び（色ごと）・足の接地（前後左右）・体の傾き・速さ・ゴールの向き・リズム
// 出力 = 筋肉の色ごとに1つ（-1=ちぢむ … +1=ふくらむ）
// 遺伝子 = すべての重み・バイアス ＋ リズムの周期

import { dtanh, dsigmoid } from './dmath.js';
import { CH_LETTER } from './body.js';

export const HIDDEN_OPTIONS = [8, 12, 16];
export const DEFAULT_HIDDEN = 12;
export const W_CLAMP = 6;

// 入力のまとまり（脳の画面で色分けする）
export const IN_GROUPS = [
  { key: 'strain', name: '筋肉ののび' },
  { key: 'touch', name: '足のせっち' },
  { key: 'tilt', name: '体のかたむき' },
  { key: 'speed', name: '速さ' },
  { key: 'goal', name: 'ゴールの向き' },
  { key: 'rhythm', name: 'リズム' },
];

export function brainLayout(body, hidden = DEFAULT_HIDDEN) {
  const inNames = [], inGroup = [], inCh = [];
  for (const c of body.channels) { inNames.push(`${CH_LETTER[c]} のび`); inGroup.push(0); inCh.push(c); }
  for (const n of ['左前 せっち', '右前 せっち', '左後 せっち', '右後 せっち']) { inNames.push(n); inGroup.push(1); inCh.push(-1); }
  for (const n of ['前後の傾き', '上下の向き', '左右の傾き']) { inNames.push(n); inGroup.push(2); inCh.push(-1); }
  for (const n of ['前への速さ', '上への速さ', '横への速さ']) { inNames.push(n); inGroup.push(3); inCh.push(-1); }
  for (const n of ['ゴール 前', 'ゴール 横']) { inNames.push(n); inGroup.push(4); inCh.push(-1); }
  for (const n of ['リズム1', 'リズム2']) { inNames.push(n); inGroup.push(5); inCh.push(-1); }
  const nIn = inNames.length, nH = hidden, nOut = body.nCh;
  const outNames = body.channels.map(c => `筋肉 ${CH_LETTER[c]}`);
  return {
    nIn, nH, nOut, sizes: [nIn, nH, nOut],
    inNames, inGroup, inCh, outCh: body.channels.slice(), outNames,
    len: nIn * nH + nH + nH * nOut + nOut + 1,
  };
}

// 遺伝子の中の位置
export function w1Index(L, h, i) { return h * L.nIn + i; }
export function b1Index(L, h) { return L.nIn * L.nH + h; }
export function w2Index(L, o, h) { return L.nIn * L.nH + L.nH + o * L.nH + h; }
export function b2Index(L, o) { return L.nIn * L.nH + L.nH + L.nH * L.nOut + o; }
export function periodIndex(L) { return L.len - 1; }

// リズムの周期（秒）0.35〜1.8
export function periodOf(L, g) { return 0.35 + 1.45 * dsigmoid(g[L.len - 1]); }

// 重みは float32 で表せる値に丸めておく（保存しても値が変わらない＝再生がずれない）
export const fr = Math.fround;

export function randomGenome(L, rng) {
  const g = new Float64Array(L.len);
  const s1 = 1.6 / Math.sqrt(L.nIn), s2 = 1.6 / Math.sqrt(L.nH);
  for (let h = 0; h < L.nH; h++) {
    for (let i = 0; i < L.nIn; i++) g[w1Index(L, h, i)] = fr(rng.gauss() * s1);
    g[b1Index(L, h)] = fr(rng.gauss() * 0.3);
  }
  for (let o = 0; o < L.nOut; o++) {
    for (let h = 0; h < L.nH; h++) g[w2Index(L, o, h)] = fr(rng.gauss() * s2);
    g[b2Index(L, o)] = fr(rng.gauss() * 0.2);
  }
  g[L.len - 1] = fr(rng.gauss());
  return g;
}

// 体を改造したとき: 名前の同じ入力・出力どうしで重みを引きつぐ（新しい筋肉の配線はゼロから）
export function transplantGenome(g, from, to) {
  const out = new Float64Array(to.len);
  const nH = Math.min(from.nH, to.nH);
  const inMap = to.inNames.map(n => from.inNames.indexOf(n));
  const outMap = to.outCh.map(c => from.outCh.indexOf(c));
  for (let h = 0; h < nH; h++) {
    for (let i = 0; i < to.nIn; i++) if (inMap[i] >= 0) out[w1Index(to, h, i)] = g[w1Index(from, h, inMap[i])];
    out[b1Index(to, h)] = g[b1Index(from, h)];
  }
  for (let o = 0; o < to.nOut; o++) {
    if (outMap[o] < 0) continue;
    for (let h = 0; h < nH; h++) out[w2Index(to, o, h)] = g[w2Index(from, outMap[o], h)];
    out[b2Index(to, o)] = g[b2Index(from, outMap[o])];
  }
  out[to.len - 1] = g[from.len - 1];
  return out;
}

export class Brain {
  constructor(L, genome) {
    this.L = L;
    this.g = genome;
    this.inp = new Float64Array(L.nIn);
    this.hid = new Float64Array(L.nH);
    this.out = new Float64Array(L.nOut);
    // ノックアウト（脳の手術）: 1 のニューロンは働かない
    this.knockIn = new Uint8Array(L.nIn);
    this.knockH = new Uint8Array(L.nH);
    this.knockOut = new Uint8Array(L.nOut);
  }
  forward() {
    const { L, g, inp, hid, out } = this;
    const nIn = L.nIn, nH = L.nH, nOut = L.nOut;
    const kI = this.knockIn, kH = this.knockH, kO = this.knockOut;
    for (let i = 0; i < nIn; i++) if (kI[i]) inp[i] = 0;
    const b1 = nIn * nH;
    for (let h = 0; h < nH; h++) {
      let s = g[b1 + h];
      const off = h * nIn;
      for (let i = 0; i < nIn; i++) s += g[off + i] * inp[i];
      hid[h] = kH[h] ? 0 : dtanh(s);
    }
    const w2 = b1 + nH, b2 = w2 + nH * nOut;
    for (let o = 0; o < nOut; o++) {
      let s = g[b2 + o];
      const off = w2 + o * nH;
      for (let h = 0; h < nH; h++) s += g[off + h] * hid[h];
      out[o] = kO[o] ? 0 : dtanh(s);
    }
    return out;
  }
}
