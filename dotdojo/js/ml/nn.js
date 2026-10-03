// 小さなニューラルネットワーク（入力 → 隠れ層(tanh) → 出力）
// 3つの流派はすべて「同じ形の脳」を使う。重みは1本の Float32Array で、これがそのまま遺伝子（DNA）。
//
// 並び順:  W1[h][i] | b1[h] | W2[o][h] | b2[o]

export class MLP {
  constructor(nIn, nHid, nOut, weights = null) {
    this.nIn = nIn; this.nHid = nHid; this.nOut = nOut;
    this.oB1 = nHid * nIn;
    this.oW2 = this.oB1 + nHid;
    this.oB2 = this.oW2 + nOut * nHid;
    this.size = this.oB2 + nOut;
    this.w = weights || new Float32Array(this.size);
    this.h = new Float32Array(nHid);     // 直前の隠れ層の活動（逆伝播・可視化用）
    this.z = new Float32Array(nOut);     // 直前の出力
  }

  static paramCount(nIn, nHid, nOut) { return nHid * nIn + nHid + nOut * nHid + nOut; }

  randomize(rng, scale = 1, outScale = 1) {
    const w = this.w;
    const s1 = scale / Math.sqrt(this.nIn * 0.25), s2 = outScale / Math.sqrt(this.nHid);
    for (let i = 0; i < this.oB1; i++) w[i] = rng.gauss() * s1;
    for (let i = this.oB1; i < this.oW2; i++) w[i] = rng.gauss() * 0.1 * scale;
    for (let i = this.oW2; i < this.oB2; i++) w[i] = rng.gauss() * s2;
    for (let i = this.oB2; i < this.size; i++) w[i] = 0;
    return this;
  }

  forward(x, out = this.z) {
    const w = this.w, nIn = this.nIn, nHid = this.nHid, nOut = this.nOut, h = this.h;
    const oB1 = this.oB1;
    for (let j = 0; j < nHid; j++) {
      let s = w[oB1 + j];
      const base = j * nIn;
      for (let i = 0; i < nIn; i++) {
        const xi = x[i];
        if (xi !== 0) s += w[base + i] * xi;
      }
      h[j] = Math.tanh(s);
    }
    const oW2 = this.oW2, oB2 = this.oB2;
    for (let k = 0; k < nOut; k++) {
      let s = w[oB2 + k];
      const base = oW2 + k * nHid;
      for (let j = 0; j < nHid; j++) s += w[base + j] * h[j];
      out[k] = s;
    }
    return out;
  }

  // forward の直後に呼ぶ。dz = dL/d出力 を受け取り、勾配 g に足しこむ
  backward(x, dz, g) {
    const w = this.w, nIn = this.nIn, nHid = this.nHid, nOut = this.nOut, h = this.h;
    const oB1 = this.oB1, oW2 = this.oW2, oB2 = this.oB2;
    for (let j = 0; j < nHid; j++) {
      let dh = 0;
      for (let k = 0; k < nOut; k++) {
        const d = dz[k];
        if (d === 0) continue;
        g[oW2 + k * nHid + j] += d * h[j];
        dh += w[oW2 + k * nHid + j] * d;
      }
      const da = dh * (1 - h[j] * h[j]);
      if (da === 0) continue;
      const base = j * nIn;
      for (let i = 0; i < nIn; i++) {
        const xi = x[i];
        if (xi !== 0) g[base + i] += da * xi;
      }
      g[oB1 + j] += da;
    }
    for (let k = 0; k < nOut; k++) g[oB2 + k] += dz[k];
  }

  // 遺伝子の位置 → どの隠れニューロンの部品か（交叉と可視化）。nHid = 出力バイアス
  geneNeuron(p) {
    if (p < this.oB1) return Math.floor(p / this.nIn);
    if (p < this.oW2) return p - this.oB1;
    if (p < this.oB2) return (p - this.oW2) % this.nHid;
    return this.nHid;
  }

  copyFrom(other) { this.w.set(other.w); return this; }
}

// ソフトマックス（確率にする）。戻り値は out
export function softmax(z, out, n = z.length) {
  let m = -Infinity;
  for (let k = 0; k < n; k++) if (z[k] > m) m = z[k];
  let s = 0;
  for (let k = 0; k < n; k++) { const e = Math.exp(z[k] - m); out[k] = e; s += e; }
  for (let k = 0; k < n; k++) out[k] /= s;
  return out;
}

export function argmax(z, n = z.length) {
  let b = 0;
  for (let k = 1; k < n; k++) if (z[k] > z[b]) b = k;
  return b;
}

// Adam（学習の「歩幅」を自動で調整する最適化手法）
export class Adam {
  constructor(size, lr = 0.003) {
    this.lr = lr;
    this.b1 = 0.9; this.b2 = 0.999; this.eps = 1e-8;
    this.m = new Float32Array(size);
    this.v = new Float32Array(size);
    this.t = 0;
  }
  // g は平均済みの勾配。clip: 勾配の大きさの上限（暴れ防止）
  step(w, g, clip = 0) {
    let scale = 1;
    if (clip > 0) {
      let n2 = 0;
      for (let i = 0; i < g.length; i++) n2 += g[i] * g[i];
      const n = Math.sqrt(n2);
      if (n > clip) scale = clip / n;
    }
    this.t++;
    const b1 = this.b1, b2 = this.b2, lr = this.lr, eps = this.eps, m = this.m, v = this.v;
    const c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    for (let i = 0; i < w.length; i++) {
      const gi = g[i] * scale;
      m[i] = b1 * m[i] + (1 - b1) * gi;
      v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      w[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + eps);
    }
  }
  reset() { this.m.fill(0); this.v.fill(0); this.t = 0; }
}

// ── 保存用: Float32Array ⇔ base64 ──
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
export function u8ToB64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
export function b64ToU8(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
