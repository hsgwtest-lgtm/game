// 強化流：強化学習（方策勾配法 PPO ＋ 価値の見積もり）
// 分身たちが同じ脳で何度も挑戦する → うまくいった行動（ごほうびが予想より多かった行動）の確率を上げ、
// 失敗した行動の確率を下げる。同時に「この場所からだと、あとどれくらいごほうびがもらえそうか（価値）」も学ぶ。
//
// 行動は確率で選ぶ（はじめはでたらめ＝探検、学ぶほど迷いが減る）。

import { MLP, Adam, softmax, argmax, f32ToB64, b64ToF32 } from './nn.js';
import { RNG } from '../core/rng.js';
import { N_IN, N_ACT } from '../sim/env.js';
import { HID } from './ga.js';

export const RL_ENT = [0.003, 0.012, 0.04];     // 好奇心（エントロピーボーナス）
export const RL_LR = [0.001, 0.003, 0.008];      // 学習の速さ
export const RL_CLONES = [8, 16, 32];            // 分身の数

const GAMMA = 0.96, LAMBDA = 0.9, CLIP = 0.2, EPOCHS = 4, MB = 64;

export class PPOAgent {
  constructor(opts = {}) {
    this.rng = new RNG(opts.seed);
    this.policy = new MLP(N_IN, HID, N_ACT).randomize(this.rng, 1, 0.1);
    this.critic = new MLP(N_IN, HID, 1).randomize(this.rng, 1, 0.1);
    this.entIdx = opts.entIdx ?? 1;
    this.lrIdx = opts.lrIdx ?? 1;
    this.clonesIdx = opts.clonesIdx ?? 1;
    this.adamP = new Adam(this.policy.size, RL_LR[this.lrIdx]);
    this.adamV = new Adam(this.critic.size, 0.005);
    this.gP = new Float32Array(this.policy.size);
    this.gV = new Float32Array(this.critic.size);
    this.cap = 4096;
    this._alloc(this.cap);
    this.n = 0;
    this.round = 0;
    this.episodes = 0;
    this.envSteps = 0;
    this.firstClearEps = 0;
    this.history = [];   // {r, succ, ret, ent}
    this.lastSummary = null;
    this.warmup = 0;     // >0 の間は脳（方策）を固定して価値だけ学ぶ（引き継いだ脳をこわさないため）
    this.probs = new Float32Array(N_ACT);
    this.z = new Float32Array(N_ACT);
    this.vtmp = new Float32Array(1);
    this.dz = new Float32Array(N_ACT);
    this.dv = new Float32Array(1);
    this.obsTmp = new Float32Array(N_IN);
    this.lastIdx = null;
    this.entSum = 0; this.entN = 0;
  }

  get clones() { return RL_CLONES[this.clonesIdx]; }
  setLr(i) { this.lrIdx = i; this.adamP.lr = RL_LR[i]; }

  _alloc(cap) {
    const old = this.obs ? { obs: this.obs, act: this.act, logp: this.logp, val: this.val, rew: this.rew, done: this.done, agent: this.agent, adv: this.adv, ret: this.retn } : null;
    this.cap = cap;
    this.obs = new Float32Array(cap * N_IN);
    this.act = new Int8Array(cap);
    this.logp = new Float32Array(cap);
    this.val = new Float32Array(cap);
    this.rew = new Float32Array(cap);
    this.done = new Uint8Array(cap);
    this.agent = new Int16Array(cap);
    this.adv = new Float32Array(cap);
    this.retn = new Float32Array(cap);
    if (old) {
      this.obs.set(old.obs); this.act.set(old.act); this.logp.set(old.logp); this.val.set(old.val);
      this.rew.set(old.rew); this.done.set(old.done); this.agent.set(old.agent);
    }
  }

  beginRound(ep) {
    this.n = 0;
    this.lastIdx = new Int32Array(ep.n).fill(-1);
    this.entSum = 0; this.entN = 0;
  }

  // 行動の確率（可視化にも使う）
  policyProbs(obs, out = this.probs) { return softmax(this.policy.forward(obs, this.z), out); }
  value(obs) { return this.critic.forward(obs, this.vtmp)[0]; }
  greedy(obs) { return argmax(this.policy.forward(obs, this.z)); }

  _sample(p) {
    let r = this.rng.float(), a = 0;
    for (; a < N_ACT - 1; a++) { r -= p[a]; if (r <= 0) break; }
    return a;
  }

  // 終わっていない分身ぜんいんの行動を決めて記録する
  actAll(ep, acts) {
    const obs = this.obsTmp;
    for (let i = 0; i < ep.n; i++) {
      if (ep.done[i]) { acts[i] = 4; continue; }
      ep.observe(i, obs);
      const p = this.policyProbs(obs);
      const a = this._sample(p);
      acts[i] = a;
      if (this.n >= this.cap) this._alloc(this.cap * 2);
      const k = this.n++;
      this.obs.set(obs, k * N_IN);
      this.act[k] = a;
      this.logp[k] = Math.log(Math.max(1e-8, p[a]));
      this.val[k] = this.value(obs);
      this.agent[k] = i;
      this.done[k] = 0;
      this.rew[k] = 0;
      this.lastIdx[i] = k;
      let H = 0;
      for (let j = 0; j < N_ACT; j++) if (p[j] > 1e-8) H -= p[j] * Math.log(p[j]);
      this.entSum += H; this.entN++;
    }
  }

  // ep.step の直後に呼ぶ：ごほうびと終了を記録
  afterStep(ep) {
    for (let i = 0; i < ep.n; i++) {
      const k = this.lastIdx[i];
      if (k < 0) continue;
      this.rew[k] = ep.r[i];
      if (ep.done[i]) this.done[k] = 1;
      this.lastIdx[i] = -1;
    }
  }

  // 1ラウンド終わったら学習する
  endRound(ep) {
    const n = this.n;
    this.round++;
    this.episodes += ep.n;
    let succ = 0, retSum = 0, steps = 0, coins = 0;
    for (let i = 0; i < ep.n; i++) { succ += ep.succ[i]; retSum += ep.ret[i]; steps += ep.steps[i]; coins += ep.coinsGot[i]; }
    this.envSteps += steps;
    if (succ > 0 && !this.firstClearEps) this.firstClearEps = this.episodes;
    // GAE（一般化アドバンテージ推定）：分身ごとに後ろから計算
    const lastAdv = new Float32Array(ep.n), nextVal = new Float32Array(ep.n);
    const seen = new Uint8Array(ep.n);
    for (let k = n - 1; k >= 0; k--) {
      const i = this.agent[k];
      let nv = 0, la = 0;
      if (seen[i] && !this.done[k]) { nv = nextVal[i]; la = lastAdv[i]; }
      const delta = this.rew[k] + GAMMA * nv - this.val[k];
      const a = delta + GAMMA * LAMBDA * la;
      this.adv[k] = a;
      this.retn[k] = a + this.val[k];
      lastAdv[i] = a; nextVal[i] = this.val[k]; seen[i] = 1;
    }
    // アドバンテージを正規化（平均0・ばらつき1）
    let m = 0;
    for (let k = 0; k < n; k++) m += this.adv[k];
    m /= Math.max(1, n);
    let s2 = 0;
    for (let k = 0; k < n; k++) s2 += (this.adv[k] - m) ** 2;
    const sd = Math.sqrt(s2 / Math.max(1, n)) + 1e-6;
    for (let k = 0; k < n; k++) this.adv[k] = (this.adv[k] - m) / sd;
    const ent = this.entN ? this.entSum / this.entN : 0;
    const summary = {
      round: this.round, succ, n: ep.n, ret: retSum / ep.n, ent, coins: coins / ep.n,
      vloss: 0, kl: 0, steps: steps / ep.n,
    };
    this.history.push({ r: this.round, succ: succ / ep.n, ret: summary.ret, ent });
    if (this.history.length > 300) this.history.splice(0, this.history.length - 300);
    this.lastSummary = summary;
    // 学習（ミニバッチ単位で少しずつ進められるようにしておく：画面がカクつかないように）
    const idx = new Int32Array(n);
    for (let k = 0; k < n; k++) idx[k] = k;
    this.upd = { n, idx, e: 0, s: 0, vloss: 0, vcnt: 0, kl: 0, klN: 0, freeze: this.warmup > 0, done: n === 0 };
    this._shuffle();
    if (this.upd.done) this._finishUpdate();
    return summary;
  }

  // ラウンドの終わりにまとめて学習まで済ませる（高速モード・ツール用）
  endRoundSync(ep) {
    const s = this.endRound(ep);
    while (!this.updateStep(1000)) { /* 続ける */ }
    return s;
  }

  get updating() { return !!(this.upd && !this.upd.done); }
  // 0..1 学習の進み具合
  get updateProgress() {
    const u = this.upd;
    if (!u || u.done) return 1;
    const per = Math.ceil(u.n / MB);
    return Math.min(1, (u.e * per + u.s / MB) / (EPOCHS * per));
  }

  _shuffle() {
    const u = this.upd, idx = u.idx;
    for (let k = u.n - 1; k > 0; k--) { const j = Math.floor(this.rng.float() * (k + 1)); const t = idx[k]; idx[k] = idx[j]; idx[j] = t; }
  }

  // ミニバッチを最大 maxMB 個ぶん学習する。終わったら true
  updateStep(maxMB = 4) {
    const u = this.upd;
    if (!u || u.done) return true;
    const pol = this.policy, cri = this.critic, gP = this.gP, gV = this.gV;
    const p = this.probs, dz = this.dz, dv = this.dv;
    const ent = RL_ENT[this.entIdx];
    const n = u.n, idx = u.idx;
    for (let b = 0; b < maxMB && !u.done; b++) {
      const s = u.s, end = Math.min(n, s + MB), cnt = end - s;
      gP.fill(0); gV.fill(0);
      for (let q = s; q < end; q++) {
        const k = idx[q];
        const x = this.obs.subarray(k * N_IN, k * N_IN + N_IN);
        const A = this.adv[k];
        if (!u.freeze) {
          softmax(pol.forward(x, this.z), p);
          const a = this.act[k];
          const lp = Math.log(Math.max(1e-8, p[a]));
          const ratio = Math.exp(lp - this.logp[k]);
          if (u.e === EPOCHS - 1) { u.kl += this.logp[k] - lp; u.klN++; }
          let glp = -ratio * A;
          if ((A >= 0 && ratio > 1 + CLIP) || (A < 0 && ratio < 1 - CLIP)) glp = 0;
          let H = 0;
          for (let j = 0; j < N_ACT; j++) if (p[j] > 1e-8) H -= p[j] * Math.log(p[j]);
          for (let j = 0; j < N_ACT; j++) {
            const lpj = Math.log(Math.max(1e-8, p[j]));
            dz[j] = glp * ((j === a ? 1 : 0) - p[j]) + ent * p[j] * (lpj + H);
          }
          pol.backward(x, dz, gP);
        }
        const v = cri.forward(x, this.vtmp)[0];
        const err = v - this.retn[k];
        u.vloss += err * err; u.vcnt++;
        dv[0] = err;
        cri.backward(x, dv, gV);
      }
      const inv = 1 / cnt;
      if (!u.freeze) { for (let i = 0; i < gP.length; i++) gP[i] *= inv; this.adamP.step(pol.w, gP, 1.0); }
      for (let i = 0; i < gV.length; i++) gV[i] *= inv;
      this.adamV.step(cri.w, gV, 5.0);
      u.s = end;
      if (u.s >= n) {
        u.s = 0; u.e++;
        if (u.e >= EPOCHS) { u.done = true; this._finishUpdate(); }
        else this._shuffle();
      }
    }
    return u.done;
  }

  _finishUpdate() {
    const u = this.upd;
    if (this.lastSummary) {
      this.lastSummary.vloss = u.vcnt ? u.vloss / u.vcnt : 0;
      this.lastSummary.kl = u.klN ? u.kl / u.klN : 0;
    }
    if (this.warmup > 0) this.warmup--;
  }

  // ほかの流派の脳から始める（合わせ技）
  loadPolicy(w) {
    this.policy.w.set(w);
    this.adamP.reset();
    this.warmup = 3;
  }

  serialize() {
    return {
      v: 1, p: f32ToB64(this.policy.w), c: f32ToB64(this.critic.w), round: this.round,
      eps: this.episodes, steps: this.envSteps, first: this.firstClearEps,
      ent: this.entIdx, lr: this.lrIdx, cl: this.clonesIdx, history: this.history.slice(-200),
    };
  }

  static deserialize(d, seed) {
    if (!d || !d.p) return null;
    const a = new PPOAgent({ seed, entIdx: d.ent, lrIdx: d.lr, clonesIdx: d.cl });
    const p = b64ToF32(d.p), c = b64ToF32(d.c);
    if (p.length !== a.policy.size || c.length !== a.critic.size) return null;
    a.policy.w.set(p); a.critic.w.set(c);
    a.round = d.round || 0; a.episodes = d.eps || 0; a.envSteps = d.steps || 0;
    a.firstClearEps = d.first || 0; a.history = d.history || [];
    return a;
  }
}
