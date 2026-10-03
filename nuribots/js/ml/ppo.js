// PPO（Proximal Policy Optimization）の学習部分。
//  ・方策（どの行動をえらぶか）を「たくさんもらえた行動」の方へ少しずつ動かす
//  ・一度に動かしすぎないように、確率の比を 1±clip で切る（これが PPO のミソ）
//  ・価値（この先もらえそうなごほうび）も同時に学び、「思ったより良かった度」= アドバンテージを作る

import { Net } from './net.js';

export const PPO_DEFAULT = {
  gamma: 0.99,     // 先のごほうびをどれだけ大事にするか
  lam: 0.95,       // GAE（アドバンテージの平らにし方）
  clip: 0.2,
  ent: 0.01,       // 迷いボーナス（エントロピー）。大きいと色々ためす
  vf: 0.5,
  lr: 1e-3,
  epochs: 4,
  mb: 256,
  maxGrad: 0.5,
};

export class PPOLearner {
  constructor(net, cfg = {}) {
    this.net = net;
    this.cfg = { ...PPO_DEFAULT, ...cfg };
    const n = net.size;
    const { h1, h2, nAct } = net.arch;
    this.g = new Float64Array(n);
    this.m = new Float32Array(n);
    this.v = new Float32Array(n);
    this.t = 0;
    this.H1 = new Float64Array(h1);
    this.H2 = new Float64Array(h2);
    this.dH1 = new Float64Array(h1);
    this.dH2 = new Float64Array(h2);
    this.L = new Float64Array(nAct);
    this.P = new Float64Array(nAct);
    this.dl = new Float64Array(nAct);
  }

  resetOptimizer() { this.m.fill(0); this.v.fill(0); this.t = 0; }

  // buf: { X, A, LOGP, ADV, RET, N }  → 学習して、損失などの統計を返す
  update(buf, rng) {
    const cfg = this.cfg;
    const N = buf.N;
    const idx = new Int32Array(N);
    for (let i = 0; i < N; i++) idx[i] = i;
    // アドバンテージを平均0・ばらつき1にそろえる
    let mean = 0, sq = 0;
    for (let i = 0; i < N; i++) mean += buf.ADV[i];
    mean /= N;
    for (let i = 0; i < N; i++) { const d = buf.ADV[i] - mean; sq += d * d; }
    const std = Math.sqrt(sq / N) + 1e-8;
    const adv = new Float32Array(N);
    for (let i = 0; i < N; i++) adv[i] = (buf.ADV[i] - mean) / std;

    const st = { pl: 0, vl: 0, ent: 0, kl: 0, clipf: 0, n: 0, gnorm: 0, nb: 0 };
    for (let ep = 0; ep < cfg.epochs; ep++) {
      // シャッフル
      for (let i = N - 1; i > 0; i--) { const j = rng.int(i + 1); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (let s = 0; s < N; s += cfg.mb) {
        const e = Math.min(N, s + cfg.mb);
        this._minibatch(buf, adv, idx, s, e, st);
      }
    }
    const n = Math.max(1, st.n);
    return {
      policyLoss: st.pl / n, valueLoss: st.vl / n, entropy: st.ent / n,
      kl: st.kl / n, clipFrac: st.clipf / n, gradNorm: st.gnorm / Math.max(1, st.nb),
    };
  }

  _minibatch(buf, adv, idx, s, e, st) {
    const net = this.net, cfg = this.cfg;
    const { nIn, h1, h2, nAct } = net.arch;
    const p = net.p, g = this.g;
    const { oW1, oB1, oW2, oB2, oWp, oBp, oWv, oBv } = net;
    const H1 = this.H1, H2 = this.H2, dH1 = this.dH1, dH2 = this.dH2;
    const L = this.L, P = this.P, dl = this.dl;
    const X = buf.X;
    const B = e - s;
    const inv = 1 / B;
    g.fill(0);
    const clipLo = 1 - cfg.clip, clipHi = 1 + cfg.clip;
    for (let bi = s; bi < e; bi++) {
      const n = idx[bi];
      const xo = n * nIn;
      // ── 前向き ──
      for (let j = 0; j < h1; j++) H1[j] = p[oB1 + j];
      for (let k = 0; k < nIn; k++) {
        const xv = X[xo + k];
        if (xv === 0) continue;
        const wo = oW1 + k * h1;
        for (let j = 0; j < h1; j++) H1[j] += xv * p[wo + j];
      }
      for (let j = 0; j < h1; j++) if (H1[j] < 0) H1[j] = 0;
      for (let j = 0; j < h2; j++) H2[j] = p[oB2 + j];
      for (let i = 0; i < h1; i++) {
        const hv = H1[i];
        if (hv === 0) continue;
        const wo = oW2 + i * h2;
        for (let j = 0; j < h2; j++) H2[j] += hv * p[wo + j];
      }
      for (let j = 0; j < h2; j++) if (H2[j] < 0) H2[j] = 0;
      for (let a = 0; a < nAct; a++) L[a] = p[oBp + a];
      let v = p[oBv];
      for (let j = 0; j < h2; j++) {
        const hv = H2[j];
        if (hv === 0) continue;
        const wo = oWp + j * nAct;
        for (let a = 0; a < nAct; a++) L[a] += hv * p[wo + a];
        v += hv * p[oWv + j];
      }
      // 確率
      let mx = -Infinity;
      for (let a = 0; a < nAct; a++) if (L[a] > mx) mx = L[a];
      let z = 0;
      for (let a = 0; a < nAct; a++) { P[a] = Math.exp(L[a] - mx); z += P[a]; }
      let ent = 0;
      for (let a = 0; a < nAct; a++) { P[a] /= z; if (P[a] > 1e-12) ent -= P[a] * Math.log(P[a]); }
      const act = buf.A[n];
      const logp = Math.log(Math.max(1e-12, P[act]));
      const ratio = Math.exp(logp - buf.LOGP[n]);
      const A = adv[n];
      const s1 = ratio * A;
      const s2 = Math.min(Math.max(ratio, clipLo), clipHi) * A;
      st.pl += -Math.min(s1, s2);
      st.kl += buf.LOGP[n] - logp;
      if (ratio < clipLo || ratio > clipHi) st.clipf += 1;
      st.ent += ent;
      const dv0 = v - buf.RET[n];
      st.vl += 0.5 * dv0 * dv0;
      st.n++;
      // ── 勾配（損失をこの値で微分）──
      // 方策: 切られていない側が選ばれているときだけ流れる
      const dlogp = (s1 <= s2) ? -ratio * A : 0;
      for (let a = 0; a < nAct; a++) {
        const ind = a === act ? 1 : 0;
        let d = dlogp * (ind - P[a]);
        // エントロピー（迷い）を増やす向き: d(-ent)/dl = P (log P + ent)
        if (P[a] > 1e-12) d += cfg.ent * P[a] * (Math.log(P[a]) + ent);
        dl[a] = d * inv;
      }
      const dv = cfg.vf * dv0 * inv;
      // ── 逆向き ──
      for (let a = 0; a < nAct; a++) g[oBp + a] += dl[a];
      g[oBv] += dv;
      for (let j = 0; j < h2; j++) {
        const hv = H2[j];
        if (hv === 0) { dH2[j] = 0; continue; }
        const wo = oWp + j * nAct;
        let dh = 0;
        for (let a = 0; a < nAct; a++) { g[wo + a] += hv * dl[a]; dh += p[wo + a] * dl[a]; }
        g[oWv + j] += hv * dv;
        dh += p[oWv + j] * dv;
        dH2[j] = dh;
      }
      for (let j = 0; j < h2; j++) g[oB2 + j] += dH2[j];
      for (let i = 0; i < h1; i++) {
        const hv = H1[i];
        if (hv === 0) { dH1[i] = 0; continue; }
        const wo = oW2 + i * h2;
        let dh = 0;
        for (let j = 0; j < h2; j++) { const d2 = dH2[j]; g[wo + j] += hv * d2; dh += p[wo + j] * d2; }
        dH1[i] = dh;
      }
      for (let i = 0; i < h1; i++) g[oB1 + i] += dH1[i];
      for (let k = 0; k < nIn; k++) {
        const xv = X[xo + k];
        if (xv === 0) continue;
        const wo = oW1 + k * h1;
        for (let i = 0; i < h1; i++) g[wo + i] += xv * dH1[i];
      }
    }
    // 勾配の大きさを制限してから Adam で更新
    let gn = 0;
    for (let i = 0; i < g.length; i++) gn += g[i] * g[i];
    gn = Math.sqrt(gn);
    st.gnorm += gn; st.nb++;
    const scale = gn > cfg.maxGrad ? cfg.maxGrad / gn : 1;
    this._adam(scale);
  }

  _adam(scale) {
    const p = this.net.p, g = this.g, m = this.m, v = this.v;
    const b1 = 0.9, b2 = 0.999, eps = 1e-5;
    this.t++;
    const lr = this.cfg.lr * Math.sqrt(1 - Math.pow(b2, this.t)) / (1 - Math.pow(b1, this.t));
    for (let i = 0; i < p.length; i++) {
      const gi = g[i] * scale;
      const mi = m[i] = b1 * m[i] + (1 - b1) * gi;
      const vi = v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      p[i] -= lr * mi / (Math.sqrt(vi) + eps);
    }
  }
}

// ばらつきの見積もり（報酬のスケールをそろえる）
export class RunningStat {
  constructor() { this.n = 1e-4; this.mean = 0; this.var = 1; }
  push(xs, count) {
    let m = 0;
    for (let i = 0; i < count; i++) m += xs[i];
    m /= count;
    let v = 0;
    for (let i = 0; i < count; i++) { const d = xs[i] - m; v += d * d; }
    v /= count;
    const tot = this.n + count;
    const delta = m - this.mean;
    this.mean += delta * count / tot;
    this.var = (this.var * this.n + v * count + delta * delta * this.n * count / tot) / tot;
    this.n = tot;
  }
  get std() { return Math.sqrt(this.var) + 1e-8; }
}

export { Net };
