// 小さなニューラルネットを素の JavaScript で（外部ライブラリなし）。ブラウザ・Web Worker・Node.js で同じように動く。
//
//   KeyNet … アームの頭脳。「AIの目」の 32×32×3 画像と、関節センサー（肩・ひじの角度、グリッパーの開閉）から
//            行動の点数8つを出す
//   Mlp    … クリティック用の小さな全結合ネット（tanh）
//
// 速さの工夫: 画像のほとんどは真っ黒（0）で、ReLU の出力も多くが 0。
// そこで「0 でない入力」だけを拾い、それが効く出力へ足し込む形で計算している（順伝播も逆伝播も同じ拾い方）。
import { makeRng } from './rng.js';

const INV255 = 1 / 255;

// 入力の各位置が「どの出力位置に・カーネルのどの位置で」効くかの表
function coverage(H, W, k, s) {
  const OH = Math.floor((H - k) / s) + 1, OW = Math.floor((W - k) / s) + 1;
  const start = new Int32Array(H * W + 1), outPos = [], kPos = [];
  for (let iy = 0; iy < H; iy++) {
    for (let ix = 0; ix < W; ix++) {
      start[iy * W + ix] = outPos.length;
      for (let oy = Math.max(0, Math.ceil((iy - k + 1) / s)); oy <= Math.min(OH - 1, Math.floor(iy / s)); oy++) {
        for (let ox = Math.max(0, Math.ceil((ix - k + 1) / s)); ox <= Math.min(OW - 1, Math.floor(ix / s)); ox++) {
          outPos.push(oy * OW + ox); kPos.push((iy - oy * s) * k + (ix - ox * s));
        }
      }
    }
  }
  start[H * W] = outPos.length;
  return { OH, OW, start, outPos: Int32Array.from(outPos), kPos: Int32Array.from(kPos) };
}

class Param {
  constructor(n) { this.w = new Float32Array(n); this.g = new Float32Array(n); this.m = new Float32Array(n); this.v = new Float32Array(n); }
}

// Adam（全パラメータ共通）。勾配が大きすぎるときは全体を縮める（クリップ）
export class Adam {
  constructor(params, lr = 1e-3, clip = 0) { this.params = params; this.lr = lr; this.clip = clip; this.t = 0; this.b1 = 0.9; this.b2 = 0.999; this.eps = 1e-8; }
  zero() { for (const p of this.params) p.g.fill(0); }
  step() {
    let scale = 1;
    if (this.clip > 0) {
      let s = 0;
      for (const p of this.params) { const g = p.g; for (let i = 0; i < g.length; i++) s += g[i] * g[i]; }
      const n = Math.sqrt(s);
      if (n > this.clip) scale = this.clip / n;
      this.lastNorm = n;
    }
    this.t++;
    const b1 = this.b1, b2 = this.b2, c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    const a = this.lr * Math.sqrt(c2) / c1, eps = this.eps;
    for (const p of this.params) {
      const w = p.w, g = p.g, m = p.m, v = p.v;
      for (let i = 0; i < w.length; i++) {
        const gi = g[i] * scale;
        const mi = m[i] = b1 * m[i] + (1 - b1) * gi;
        const vi = v[i] = b2 * v[i] + (1 - b2) * gi * gi;
        w[i] -= a * mi / (Math.sqrt(vi) + eps);
      }
    }
  }
  reset() { this.t = 0; for (const p of this.params) { p.m.fill(0); p.v.fill(0); } }
}


// ------------------------------------------------------------------------------------------
// KeyNet（「注目点」で考える頭脳）
//   画像 → 畳み込み1 (4×4, 2画素おき) → ReLU → 畳み込み2 (3×3) → ReLU
//        → チャンネルごとに「どこが光っているか」の重心 (x, y) と光の量 m ＝ 注目点（K 個）
//   関節センサー → ひじと手先の位置（アームの長さは分かっているので角度から計算）＝ 注目点2個ぶん
//   注目点どうしの内積・外積（＝土台を中心に机ごと回しても変わらない量。距離や、どちら回りかが分かる）
//        → 全結合 → ReLU → 全結合 → ReLU → 出力
//   畳み込みのバイアスは 0 以下に限る（＝しきい値）。黒い所の出力がきっちり 0 になり、計算を飛ばせる。
export const DEFAULT_KEYNET = { img: 32, c1: 12, k1: 4, s1: 2, keys: 10, k2: 3, s2: 1, h1: 96, h2: 96, out: 8, eps: 0.2, m0: 2, l1: 0.95 / 2.2, l2: 0.95 / 2.2, stick: 1.2 };
export const PROP = 3;   // 関節センサーの数（肩の角度・ひじの角度・グリッパー）

export class KeyNet {
  constructor(cfg = DEFAULT_KEYNET, seed = 1, maxBatch = 128) {
    this.cfg = Object.assign({}, DEFAULT_KEYNET, cfg);
    const c = this.cfg;
    this.cov1 = coverage(c.img, c.img, c.k1, c.s1);
    this.P1 = this.cov1.OH * this.cov1.OW;
    this.cov2 = coverage(this.cov1.OH, this.cov1.OW, c.k2, c.s2);
    this.P2 = this.cov2.OH * this.cov2.OW;
    this.N = c.keys + 2;                        // 注目点の数（画像から K 個 + センサーから2個）
    this.F = this.N * this.N + c.keys + 1;      // 全結合へ入る数（内積・外積 N² + 光の量 K + グリッパー）
    this.w1 = new Param(c.k1 * c.k1 * 3 * c.c1); this.b1 = new Param(c.c1);
    this.w2 = new Param(c.k2 * c.k2 * c.c1 * c.keys); this.b2 = new Param(c.keys);
    this.wa = new Param(this.F * c.h1); this.ba = new Param(c.h1);
    this.wb = new Param(c.h1 * c.h2); this.bb = new Param(c.h2);
    this.wo = new Param(c.h2 * c.out); this.bo = new Param(c.out);
    this.params = [this.w1, this.b1, this.w2, this.b2, this.wa, this.ba, this.wb, this.bb, this.wo, this.bo];
    this.o1 = this.cov1.outPos.map((p) => p * c.c1); this.q1 = this.cov1.kPos.map((p) => p * 3 * c.c1);
    this.o2 = this.cov2.outPos.map((p) => p * c.keys); this.q2 = this.cov2.kPos.map((p) => p * c.c1 * c.keys);
    // 畳み込み2の出力マスの中心が、画像のどこにあたるか（-1〜1。x は右、y は下）
    const OW = this.cov2.OW, OH = this.cov2.OH;
    this.X = new Float32Array(this.P2); this.Y = new Float32Array(this.P2);
    for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
      const px = (x * c.s2 + (c.k2 - 1) / 2) * c.s1 + (c.k1 - 1) / 2 + 0.5, py = (y * c.s2 + (c.k2 - 1) / 2) * c.s1 + (c.k1 - 1) / 2 + 0.5;
      this.X[y * OW + x] = px / c.img * 2 - 1; this.Y[y * OW + x] = py / c.img * 2 - 1;
    }
    this.init(seed);
    this._alloc(maxBatch);
  }

  init(seed) {
    const r = makeRng(seed), c = this.cfg;
    const fill = (p, std) => { for (let i = 0; i < p.w.length; i++) p.w[i] = r.gauss() * std; };
    fill(this.w1, Math.sqrt(2 / (c.k1 * c.k1 * 3)));
    fill(this.w2, Math.sqrt(2 / (c.k2 * c.k2 * c.c1)));
    fill(this.wa, Math.sqrt(2 / this.F) * 2);
    fill(this.wb, Math.sqrt(2 / c.h1));
    fill(this.wo, 0.01);
    for (const p of [this.b1, this.b2, this.ba, this.bb, this.bo]) p.w.fill(0);
  }

  _alloc(B) {
    const c = this.cfg;
    this.B = B;
    this.a1 = new Float32Array(B * this.P1 * c.c1);
    this.a2 = new Float32Array(B * this.P2 * c.keys);
    this.S = new Float32Array(B * c.keys);
    this.tok = new Float32Array(B * this.N * 2);      // 注目点の座標 (x, y)
    this.feat = new Float32Array(B * this.F);
    this.ha = new Float32Array(B * c.h1);
    this.hb = new Float32Array(B * c.h2);
    this.z = new Float32Array(B * c.out);
    this.d1 = new Float32Array(this.P1 * c.c1);
    this.d2 = new Float32Array(this.P2 * c.keys);
    this.dt = new Float32Array(this.N * 2);
    this.df = new Float32Array(this.F);
    this.da = new Float32Array(c.h1);
    this.db = new Float32Array(c.h2);
  }

  // 学習の1歩のあとに呼ぶ: 畳み込みのバイアスを 0 以下に保つ
  clampBias() {
    for (const p of [this.b1, this.b2]) { const w = p.w; for (let i = 0; i < w.length; i++) if (w[i] > 0) w[i] = 0; }
  }

  // 順伝播。src: 画像バイト列、offs[i]: i 枚目の先頭、n: 枚数、prop: 関節センサー（n×3 = 肩・ひじ・グリッパー）
  // 戻り値 z（n×out。次の呼び出しまで有効）
  forward(src, offs, n, prop) {
    if (n > this.B) this._alloc(n);
    const c = this.cfg, C1 = c.c1, K = c.keys, H1 = c.h1, H2 = c.h2, O = c.out, F = this.F, N = this.N;
    const P1 = this.P1, P2 = this.P2, P1C = P1 * C1, P2K = P2 * K, npx = c.img * c.img, C1x2 = 2 * C1;
    const w1 = this.w1.w, b1 = this.b1.w, w2 = this.w2.w, b2 = this.b2.w, wa = this.wa.w, ba = this.ba.w, wb = this.wb.w, bb = this.bb.w, wo = this.wo.w, bo = this.bo.w;
    const a1 = this.a1, a2 = this.a2, S = this.S, tok = this.tok, feat = this.feat, ha = this.ha, hb = this.hb, z = this.z, X = this.X, Y = this.Y;
    const s1 = this.cov1.start, o1 = this.o1, q1 = this.q1, s2 = this.cov2.start, o2 = this.o2, q2 = this.q2;
    const eps = c.eps, m0 = c.m0;
    this.n = n; this.src = src; this.offs = offs;
    for (let b = 0; b < n; b++) {
      const sb = offs[b], ab = b * P1C;
      a1.fill(0, ab, ab + P1C);
      for (let pos = 0, p3 = sb; pos < npx; pos++, p3 += 3) {
        const r = src[p3], g = src[p3 + 1], bl = src[p3 + 2];
        if ((r | g | bl) === 0) continue;
        const rf = r * INV255, gf = g * INV255, bf = bl * INV255;
        for (let j = s1[pos], je = s1[pos + 1]; j < je; j++) {
          const o = ab + o1[j], w = q1[j];
          for (let f = 0; f < C1; f++) a1[o + f] += rf * w1[w + f] + gf * w1[w + C1 + f] + bf * w1[w + C1x2 + f];
        }
      }
      const cb = b * P2K;
      a2.fill(0, cb, cb + P2K);
      for (let pos = 0; pos < P1; pos++) {
        const ib = ab + pos * C1, js = s2[pos], je = s2[pos + 1];
        for (let ch = 0; ch < C1; ch++) {
          let v = a1[ib + ch];
          if (v === 0) continue;
          v += b1[ch];
          if (v <= 0) { a1[ib + ch] = 0; continue; }
          a1[ib + ch] = v;
          const wc = ch * K;
          for (let j = js; j < je; j++) {
            const o = cb + o2[j], w = q2[j] + wc;
            for (let f = 0; f < K; f++) a2[o + f] += v * w2[w + f];
          }
        }
      }
      // 注目点（重心と光の量）
      const tb = b * N * 2, kb = b * K, fb = b * F;
      for (let k = 0; k < K; k++) { S[kb + k] = 0; tok[tb + 2 * k] = 0; tok[tb + 2 * k + 1] = 0; }
      for (let p = 0, i = cb; p < P2; p++) {
        const x = X[p], y = Y[p];
        for (let k = 0; k < K; k++, i++) {
          let v = a2[i];
          if (v === 0) continue;
          v += b2[k];
          if (v <= 0) { a2[i] = 0; continue; }
          a2[i] = v;
          S[kb + k] += v; tok[tb + 2 * k] += v * x; tok[tb + 2 * k + 1] += v * y;
        }
      }
      const mOff = fb + N * N;
      for (let k = 0; k < K; k++) {
        const s = S[kb + k], inv = 1 / (s + eps);
        tok[tb + 2 * k] *= inv; tok[tb + 2 * k + 1] *= inv; feat[mOff + k] = s / (s + m0);
      }
      // 関節センサー → ひじ・手先の位置（画像と同じ座標）
      const q1a = prop[b * PROP], q2a = prop[b * PROP + 1];
      const ex = c.l1 * Math.cos(q1a), ey = -c.l1 * Math.sin(q1a);
      tok[tb + 2 * K] = ex; tok[tb + 2 * K + 1] = ey;
      tok[tb + 2 * K + 2] = ex + c.l2 * Math.cos(q1a + q2a); tok[tb + 2 * K + 3] = ey - c.l2 * Math.sin(q1a + q2a);
      feat[mOff + K] = prop[b * PROP + 2];
      // 内積（i ≤ j）と外積（i < j）
      let fi = fb;
      for (let i = 0; i < N; i++) {
        const xi = tok[tb + 2 * i], yi = tok[tb + 2 * i + 1];
        for (let j = i; j < N; j++) feat[fi++] = xi * tok[tb + 2 * j] + yi * tok[tb + 2 * j + 1];
        for (let j = i + 1; j < N; j++) feat[fi++] = xi * tok[tb + 2 * j + 1] - yi * tok[tb + 2 * j];
      }
      // 全結合 ×2 → 出力
      const hab = b * H1, hbb = b * H2, zb = b * O;
      for (let j = 0; j < H1; j++) ha[hab + j] = ba[j];
      for (let i = 0; i < F; i++) {
        const v = feat[fb + i];
        if (v === 0) continue;
        const w = i * H1;
        for (let j = 0; j < H1; j++) ha[hab + j] += v * wa[w + j];
      }
      for (let j = 0; j < H2; j++) hb[hbb + j] = bb[j];
      for (let i = 0; i < H1; i++) {
        const v = ha[hab + i];
        if (v <= 0) { ha[hab + i] = 0; continue; }
        const w = i * H2;
        for (let j = 0; j < H2; j++) hb[hbb + j] += v * wb[w + j];
      }
      for (let k = 0; k < O; k++) z[zb + k] = bo[k];
      for (let i = 0; i < H2; i++) {
        const v = hb[hbb + i];
        if (v <= 0) { hb[hbb + i] = 0; continue; }
        const w = i * O;
        for (let k = 0; k < O; k++) z[zb + k] += v * wo[w + k];
      }
      // グリッパーは「いまの状態を続ける」ほうへ少しだけ背中を押す（開いたり閉じたりを繰り返さないための初期のくせ。学習で上書きできる）
      if (c.stick) z[zb + O - 2 + (prop[b * PROP + 2] > 0.5 ? 1 : 0)] += c.stick;
    }
    return z;
  }

  // 逆伝播。dz: 出力ごとの誤差（n×out）。直前の forward と同じ入力に対して、勾配を各 Param.g に足し込む
  backward(dz) {
    const c = this.cfg, C1 = c.c1, K = c.keys, H1 = c.h1, H2 = c.h2, O = c.out, F = this.F, N = this.N;
    const P1 = this.P1, P2 = this.P2, P1C = P1 * C1, P2K = P2 * K, npx = c.img * c.img, C1x2 = 2 * C1;
    const w2 = this.w2.w, wa = this.wa.w, wb = this.wb.w, wo = this.wo.w;
    const g1 = this.w1.g, gb1 = this.b1.g, g2 = this.w2.g, gb2 = this.b2.g, ga = this.wa.g, gba = this.ba.g, gwb = this.wb.g, gbb = this.bb.g, go = this.wo.g, gbo = this.bo.g;
    const a1 = this.a1, a2 = this.a2, S = this.S, tok = this.tok, feat = this.feat, ha = this.ha, hb = this.hb, X = this.X, Y = this.Y;
    const d1 = this.d1, d2 = this.d2, dt = this.dt, df = this.df, da = this.da, db = this.db;
    const s1 = this.cov1.start, o1 = this.o1, q1 = this.q1, s2 = this.cov2.start, o2 = this.o2, q2 = this.q2;
    const eps = c.eps, m0 = c.m0, src = this.src, offs = this.offs, n = this.n;
    for (let b = 0; b < n; b++) {
      const zb = b * O, hab = b * H1, hbb = b * H2, fb = b * F, kb = b * K, cb = b * P2K, ab = b * P1C, tb = b * N * 2;
      for (let k = 0; k < O; k++) gbo[k] += dz[zb + k];
      for (let i = 0; i < H2; i++) {
        const v = hb[hbb + i];
        if (v === 0) { db[i] = 0; continue; }
        const w = i * O;
        let s = 0;
        for (let k = 0; k < O; k++) { const d = dz[zb + k]; s += wo[w + k] * d; go[w + k] += v * d; }
        db[i] = s; gbb[i] += s;
      }
      for (let i = 0; i < H1; i++) {
        const v = ha[hab + i];
        if (v === 0) { da[i] = 0; continue; }
        const w = i * H2;
        let s = 0;
        for (let j = 0; j < H2; j++) { const d = db[j]; s += wb[w + j] * d; gwb[w + j] += v * d; }
        da[i] = s; gba[i] += s;
      }
      for (let i = 0; i < F; i++) {
        const v = feat[fb + i], w = i * H1;
        let s = 0;
        for (let j = 0; j < H1; j++) { const d = da[j]; s += wa[w + j] * d; ga[w + j] += v * d; }
        df[i] = s;
      }
      // 内積・外積 → 注目点の座標へ
      dt.fill(0);
      let fi = 0;
      for (let i = 0; i < N; i++) {
        const xi = tok[tb + 2 * i], yi = tok[tb + 2 * i + 1];
        for (let j = i; j < N; j++) {
          const g = df[fi++];
          dt[2 * i] += g * tok[tb + 2 * j]; dt[2 * i + 1] += g * tok[tb + 2 * j + 1];
          dt[2 * j] += g * xi; dt[2 * j + 1] += g * yi;
        }
        for (let j = i + 1; j < N; j++) {
          const g = df[fi++];
          dt[2 * i] += g * tok[tb + 2 * j + 1]; dt[2 * i + 1] -= g * tok[tb + 2 * j];
          dt[2 * j] -= g * yi; dt[2 * j + 1] += g * xi;
        }
      }
      // 注目点 → 畳み込み2の出力へ
      const mOff = N * N;
      for (let p = 0, i = 0; p < P2; p++) {
        const x = X[p], y = Y[p];
        for (let k = 0; k < K; k++, i++) {
          if (a2[cb + i] === 0) { d2[i] = 0; continue; }
          const s = S[kb + k], inv = 1 / (s + eps), mm = s + m0;
          const d = (dt[2 * k] * (x - tok[tb + 2 * k]) + dt[2 * k + 1] * (y - tok[tb + 2 * k + 1])) * inv + df[mOff + k] * m0 / (mm * mm);
          d2[i] = d; gb2[k] += d;
        }
      }
      // 畳み込み2
      for (let pos = 0; pos < P1; pos++) {
        const ib = pos * C1, js = s2[pos], je = s2[pos + 1];
        for (let ch = 0; ch < C1; ch++) {
          const v = a1[ab + ib + ch];
          if (v === 0) { d1[ib + ch] = 0; continue; }
          const wc = ch * K;
          let s = 0;
          for (let j = js; j < je; j++) {
            const o = o2[j], w = q2[j] + wc;
            for (let f = 0; f < K; f++) { const d = d2[o + f]; s += w2[w + f] * d; g2[w + f] += v * d; }
          }
          d1[ib + ch] = s; gb1[ch] += s;
        }
      }
      // 畳み込み1（重みの勾配だけ。画像そのものへの勾配は学習には要らない）
      const sb = offs[b];
      for (let pos = 0, p3 = sb; pos < npx; pos++, p3 += 3) {
        const r = src[p3], g = src[p3 + 1], bl = src[p3 + 2];
        if ((r | g | bl) === 0) continue;
        const rf = r * INV255, gf = g * INV255, bf = bl * INV255;
        for (let j = s1[pos], je = s1[pos + 1]; j < je; j++) {
          const o = o1[j], w = q1[j];
          for (let f = 0; f < C1; f++) {
            const d = d1[o + f];
            if (d === 0) continue;
            g1[w + f] += rf * d; g1[w + C1 + f] += gf * d; g1[w + C1x2 + f] += bf * d;
          }
        }
      }
    }
  }

  count() { let n = 0; for (const p of this.params) n += p.w.length; return n; }
  getWeights() { const out = new Float32Array(this.count()); let o = 0; for (const p of this.params) { out.set(p.w, o); o += p.w.length; } return out; }
  setWeights(arr) { let o = 0; for (const p of this.params) { p.w.set(arr.subarray(o, o + p.w.length)); o += p.w.length; } }
  copyFrom(net) { for (let i = 0; i < this.params.length; i++) this.params[i].w.set(net.params[i].w); }
}

// 小さな全結合ネット（tanh）。入力はふつうの数値ベクトル
export class Mlp {
  constructor(sizes, seed = 1, maxBatch = 128, outScale = 1) {
    this.sizes = sizes; this.L = sizes.length - 1;
    this.W = []; this.Bp = []; this.params = [];
    const r = makeRng(seed);
    for (let l = 0; l < this.L; l++) {
      const w = new Param(sizes[l] * sizes[l + 1]), b = new Param(sizes[l + 1]);
      const std = Math.sqrt(1 / sizes[l]) * (l === this.L - 1 ? outScale : 1);
      for (let i = 0; i < w.w.length; i++) w.w[i] = r.gauss() * std;
      this.W.push(w); this.Bp.push(b); this.params.push(w, b);
    }
    this._alloc(maxBatch);
  }
  _alloc(B) {
    this.B = B;
    this.act = this.sizes.map((s) => new Float32Array(B * s));
    this.delta = this.sizes.map((s) => new Float32Array(s));
  }
  // x: n×sizes[0]（そのまま参照する）。戻り値: 出力（n×sizes[L]）
  forward(x, n) {
    if (n > this.B) this._alloc(n);
    this.n = n; this.x = x;
    let inp = x;
    for (let l = 0; l < this.L; l++) {
      const I = this.sizes[l], J = this.sizes[l + 1], w = this.W[l].w, bias = this.Bp[l].w, out = this.act[l + 1], last = l === this.L - 1;
      for (let b = 0; b < n; b++) {
        const ib = b * I, ob = b * J;
        for (let j = 0; j < J; j++) out[ob + j] = bias[j];
        for (let i = 0; i < I; i++) { const v = inp[ib + i]; if (v === 0) continue; const wi = i * J; for (let j = 0; j < J; j++) out[ob + j] += v * w[wi + j]; }
        if (!last) for (let j = 0; j < J; j++) out[ob + j] = Math.tanh(out[ob + j]);
      }
      inp = out;
    }
    return inp;
  }
  // dOut: n×sizes[L]
  backward(dOut) {
    const n = this.n;
    for (let b = 0; b < n; b++) {
      let d = this.delta[this.L];
      const JL = this.sizes[this.L];
      for (let j = 0; j < JL; j++) d[j] = dOut[b * JL + j];
      for (let l = this.L - 1; l >= 0; l--) {
        const I = this.sizes[l], J = this.sizes[l + 1], w = this.W[l].w, gw = this.W[l].g, gb = this.Bp[l].g;
        const inp = l === 0 ? this.x : this.act[l], ib = b * I, dIn = this.delta[l];
        for (let j = 0; j < J; j++) gb[j] += d[j];
        for (let i = 0; i < I; i++) {
          const v = inp[ib + i], wi = i * J;
          let s = 0;
          for (let j = 0; j < J; j++) { s += w[wi + j] * d[j]; gw[wi + j] += v * d[j]; }
          dIn[i] = l > 0 ? s * (1 - v * v) : s;
        }
        d = dIn;
      }
    }
  }
  count() { let n = 0; for (const p of this.params) n += p.w.length; return n; }
  getWeights() { const out = new Float32Array(this.count()); let o = 0; for (const p of this.params) { out.set(p.w, o); o += p.w.length; } return out; }
  setWeights(arr) { let o = 0; for (const p of this.params) { p.w.set(arr.subarray(o, o + p.w.length)); o += p.w.length; } }
}

