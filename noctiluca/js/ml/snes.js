// 分離型 自然進化戦略（SNES: Separable Natural Evolution Strategies, Schaul ほか 2011）
// 重みごとに「平均 μ」と「ゆらぎの大きさ σ」を持つ。
//   1) μ のまわりに鏡あわせの変異体を作る（μ + σε と μ − σε）
//   2) 同じ条件で走らせて順位をつける
//   3) 上位の変異の向きへ μ を動かし、うまくいった重みの σ は広げ、効かない重みの σ はせばめる
import { RNG } from '../sim/rng.js';

export class SNES {
  constructor(mu, { sigma0 = 0.3, pairs = 7, etaMu = 1.0, etaSigma = null, seed = 1, sigmaMin = 0.01, sigmaMax = 1.2 } = {}) {
    this.d = mu.length;
    this.mu = Float32Array.from(mu);
    this.sigma = new Float32Array(this.d).fill(sigma0);
    this.pairs = pairs;
    this.lambda = pairs * 2;
    this.etaMu = etaMu;
    this._etaSigmaFixed = etaSigma;
    this.sigmaMin = sigmaMin;
    this.sigmaMax = sigmaMax;
    this.rng = new RNG(seed);
    this.eps = [];
    this.samples = [];
    this.lastGradNorm = 0;
  }

  get etaSigma() {
    return this._etaSigmaFixed ?? (3 + Math.log(this.d)) / (5 * Math.sqrt(this.d));
  }

  utilities(lambda) {
    const u = new Float32Array(lambda);
    let s = 0;
    for (let i = 0; i < lambda; i++) {
      u[i] = Math.max(0, Math.log(lambda / 2 + 1) - Math.log(i + 1));
      s += u[i];
    }
    for (let i = 0; i < lambda; i++) u[i] = u[i] / s - 1 / lambda;
    return u;
  }

  ask() {
    const { d, mu, sigma, rng } = this;
    this.eps = [];
    this.samples = [];
    for (let i = 0; i < this.pairs; i++) {
      const e = new Float32Array(d);
      const a = new Float32Array(d);
      const b = new Float32Array(d);
      for (let j = 0; j < d; j++) {
        e[j] = rng.gauss();
        a[j] = mu[j] + sigma[j] * e[j];
        b[j] = mu[j] - sigma[j] * e[j];
      }
      this.eps.push(e);
      this.samples.push(a, b);
    }
    return this.samples;
  }

  // fit: samples と同じ並び（大きいほど良い）
  tell(fit) {
    const lambda = this.lambda;
    const order = Array.from({ length: lambda }, (_, i) => i).sort((a, b) => fit[b] - fit[a]);
    const util = this.utilities(lambda);
    const uk = new Float32Array(lambda);
    order.forEach((k, rank) => { uk[k] = util[rank]; });
    const { d, mu, sigma } = this;
    const gMu = new Float32Array(d);
    const gS = new Float32Array(d);
    for (let i = 0; i < this.pairs; i++) {
      const e = this.eps[i];
      const ua = uk[2 * i], ub = uk[2 * i + 1];
      const du = ua - ub, su = ua + ub;
      for (let j = 0; j < d; j++) {
        gMu[j] += du * e[j];
        gS[j] += su * (e[j] * e[j] - 1);
      }
    }
    let gn = 0;
    const es = this.etaSigma;
    for (let j = 0; j < d; j++) {
      const step = this.etaMu * sigma[j] * gMu[j];
      mu[j] += step;
      gn += step * step;
      sigma[j] = Math.min(this.sigmaMax, Math.max(this.sigmaMin, sigma[j] * Math.exp(0.5 * es * gS[j])));
    }
    this.lastGradNorm = Math.sqrt(gn);
  }

  meanSigma() {
    let s = 0;
    for (let j = 0; j < this.d; j++) s += this.sigma[j];
    return s / Math.max(1, this.d);
  }

  // 次元をふやす（感覚器官・神経がふえたとき）。map[i] = 旧番号（なければ -1）
  remap(map, newMu, sigma0) {
    const mu = new Float32Array(map.length);
    const sg = new Float32Array(map.length);
    for (let i = 0; i < map.length; i++) {
      if (map[i] >= 0) { mu[i] = this.mu[map[i]]; sg[i] = Math.max(this.sigma[map[i]], sigma0 * 0.5); }
      else { mu[i] = newMu ? newMu[i] : 0; sg[i] = sigma0; }
    }
    this.mu = mu; this.sigma = sg; this.d = map.length;
  }

  toJSON() {
    return { mu: Array.from(this.mu), sigma: Array.from(this.sigma), pairs: this.pairs };
  }

  static fromJSON(o, opts = {}) {
    const s = new SNES(o.mu, { ...opts, pairs: o.pairs || opts.pairs || 7 });
    s.sigma = Float32Array.from(o.sigma);
    return s;
  }
}
