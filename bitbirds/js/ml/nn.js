// 小さなニューラルネットワーク（入力 → 隠れ層(tanh) → 出力(tanh)）
// 重みは1本の Float32Array に並べる。これがそのまま「DNA（遺伝子）」になる。
//
// 並び順:  W1[h][i] (隠れ層hへの入力iの重み) | b1[h] | W2[o][h] | b2[o]

export class MLP {
  constructor(nIn, nHid, nOut, weights = null) {
    this.nIn = nIn; this.nHid = nHid; this.nOut = nOut;
    this.oB1 = nHid * nIn;
    this.oW2 = this.oB1 + nHid;
    this.oB2 = this.oW2 + nOut * nHid;
    this.size = this.oB2 + nOut;
    this.w = weights ? weights : new Float32Array(this.size);
    this.h = new Float32Array(nHid);   // 隠れ層の活動（可視化用にも使う）
    this.o = new Float32Array(nOut);
    this.a1 = new Float32Array(nHid);
  }

  static paramCount(nIn, nHid, nOut) { return nHid * nIn + nHid + nOut * nHid + nOut; }

  randomize(rng, scale = 1) {
    const w = this.w;
    const s1 = scale / Math.sqrt(this.nIn), s2 = scale / Math.sqrt(this.nHid);
    for (let i = 0; i < this.oB1; i++) w[i] = rng.gauss() * s1;
    for (let i = this.oB1; i < this.oW2; i++) w[i] = rng.gauss() * 0.2;
    for (let i = this.oW2; i < this.oB2; i++) w[i] = rng.gauss() * s2;
    for (let i = this.oB2; i < this.size; i++) w[i] = rng.gauss() * 0.1;
    return this;
  }

  forward(x, out = this.o) {
    const w = this.w, nIn = this.nIn, nHid = this.nHid, nOut = this.nOut;
    const h = this.h, a1 = this.a1;
    for (let j = 0; j < nHid; j++) {
      let s = w[this.oB1 + j];
      const base = j * nIn;
      for (let i = 0; i < nIn; i++) s += w[base + i] * x[i];
      a1[j] = s;
      h[j] = Math.tanh(s);
    }
    for (let k = 0; k < nOut; k++) {
      let s = w[this.oB2 + k];
      const base = this.oW2 + k * nHid;
      for (let j = 0; j < nHid; j++) s += w[base + j] * h[j];
      out[k] = Math.tanh(s);
    }
    return out;
  }

  // 遺伝子の位置 → どの隠れニューロンの部品か（交叉と可視化に使う）
  // 戻り値: 0..nHid-1 = そのニューロン, nHid = 出力バイアス
  geneNeuron(g) {
    if (g < this.oB1) return Math.floor(g / this.nIn);
    if (g < this.oW2) return g - this.oB1;
    if (g < this.oB2) return (g - this.oW2) % this.nHid;
    return this.nHid;
  }
}

// ── Adam で教師あり学習（模倣学習で使う）──
export class AdamTrainer {
  constructor(net, lr = 0.004) {
    this.net = net;
    this.lr = lr;
    this.b1 = 0.9; this.b2 = 0.999; this.eps = 1e-8;
    this.m = new Float32Array(net.size);
    this.v = new Float32Array(net.size);
    this.g = new Float32Array(net.size);
    this.t = 0;
    this.dh = new Float32Array(net.nHid);
    this.out = new Float32Array(net.nOut);
  }

  // X: Float32Array(N*nIn), Y: Float32Array(N*nOut), W: Float32Array(N) 重み
  // idx: 使うサンプル番号の配列。戻り値は平均二乗誤差
  step(X, Y, W, idx, count) {
    const net = this.net, w = net.w, g = this.g;
    const nIn = net.nIn, nHid = net.nHid, nOut = net.nOut;
    g.fill(0);
    let loss = 0, wsum = 0;
    const dh = this.dh, out = this.out;
    for (let n = 0; n < count; n++) {
      const s = idx[n];
      const xs = X.subarray(s * nIn, s * nIn + nIn);
      net.forward(xs, out);
      const sw = W ? W[s] : 1;
      wsum += sw;
      dh.fill(0);
      for (let k = 0; k < nOut; k++) {
        const err = out[k] - Y[s * nOut + k];
        loss += sw * err * err;
        const da2 = sw * err * (1 - out[k] * out[k]);
        const base = net.oW2 + k * nHid;
        for (let j = 0; j < nHid; j++) {
          g[base + j] += da2 * net.h[j];
          dh[j] += w[base + j] * da2;
        }
        g[net.oB2 + k] += da2;
      }
      for (let j = 0; j < nHid; j++) {
        const da1 = dh[j] * (1 - net.h[j] * net.h[j]);
        const base = j * nIn;
        for (let i = 0; i < nIn; i++) g[base + i] += da1 * xs[i];
        g[net.oB1 + j] += da1;
      }
    }
    if (wsum <= 0) return 0;
    const inv = 1 / wsum;
    this.t++;
    const b1 = this.b1, b2 = this.b2;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    const lr = this.lr, eps = this.eps, m = this.m, v = this.v;
    for (let p = 0; p < net.size; p++) {
      const gp = g[p] * inv;
      m[p] = b1 * m[p] + (1 - b1) * gp;
      v[p] = b2 * v[p] + (1 - b2) * gp * gp;
      w[p] -= lr * (m[p] / c1) / (Math.sqrt(v[p] / c2) + eps);
    }
    return (loss * inv) / nOut;
  }

  reset() { this.m.fill(0); this.v.fill(0); this.t = 0; }
}

// ── Float32Array ⇔ base64（保存用）──
export function f32ToB64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
export function b64ToF32(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
