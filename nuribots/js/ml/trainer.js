// 強化学習の「トレーニング場」。
// いくつものアリーナを同時に動かして経験を集め（ロールアウト）、PPO で脳を更新する。
// Web Worker の中でも Node でも動く（DOM を使わない）。

import { Env, OBS_N, N_ACT, N_EV, EV, toRealAction } from '../sim/env.js';
import { CpuController } from '../sim/bots.js';
import { deckWeights, rewardOf } from '../sim/rewards.js';
import { Rng } from '../core/rng.js';
import { Net } from './net.js';
import { PPOLearner, RunningStat } from './ppo.js';
import { NetController } from './policy.js';
import { softmax, sampleIndex } from './mathx.js';

export const TRAIN_DEFAULT = {
  nEnv: 8,
  T: 128,
  arenas: [0],
  // スパーリング相手: { type:'cpu', key } / { type:'self' } / { type:'net', id, net }
  opponents: [{ type: 'cpu', key: 'koro', w: 1 }],
  selfEvery: 4,
  poolEvery: 12,
  poolMax: 6,
};

export class Trainer {
  constructor(opts = {}) {
    const o = { ...TRAIN_DEFAULT, ...opts };
    this.opts = o;
    this.rng = new Rng(o.seed || 12345);
    this.net = o.net || new Net().init(this.rng);
    this.learner = new PPOLearner(this.net, o.ppo || {});
    this.nEnv = o.nEnv;
    this.T = o.T;
    const N = this.nEnv * this.T;
    this.N = N;
    this.X = new Float32Array(N * OBS_N);
    this.A = new Uint8Array(N);
    this.LOGP = new Float32Array(N);
    this.V = new Float32Array(N);
    this.RAW = new Float32Array(N);
    this.R = new Float32Array(N);
    this.D = new Uint8Array(N);
    this.ADV = new Float32Array(N);
    this.RET = new Float32Array(N);
    this.logits = new Float64Array(N_ACT);
    this.prob = new Float64Array(N_ACT);
    this.retAcc = new Float64Array(this.nEnv);
    this.rs = new RunningStat();
    this.W = deckWeights(o.deck || []);
    this.selfNet = this.net.clone();
    this.pool = [];
    this.opponents = o.opponents;
    this.arenas = o.arenas;
    this.steps = o.steps || 0;
    this.iter = o.iters || 0;
    this.episodes = 0;
    this.recent = [];
    this.recentMax = 60;
    this.lastLoss = null;
    this.t = 0;
    this.slots = [];
    for (let e = 0; e < this.nEnv; e++) {
      const s = {
        env: new Env(this.arenas[0], this.rng.u32()),
        side: 0, opp: null, oppId: '', arena: 0,
        R: 0, cards: new Float64Array(N_EV), evs: new Float64Array(N_EV),
      };
      this._resetSlot(s);
      this.slots.push(s);
    }
  }

  setDeck(deck) { this.W = deckWeights(deck); }
  setArenas(list) { if (list && list.length) this.arenas = list.slice(); }
  setOpponents(list) { if (list && list.length) this.opponents = list.slice(); }
  setEntropy(x) { this.learner.cfg.ent = x; }
  setLR(x) { this.learner.cfg.lr = x; }

  _pickOpponent() {
    const ops = this.opponents;
    let tot = 0;
    for (const op of ops) tot += op.w || 1;
    let u = this.rng.next() * tot;
    let op = ops[ops.length - 1];
    for (const o of ops) { u -= o.w || 1; if (u < 0) { op = o; break; } }
    const r = new Rng(this.rng.u32());
    if (op.type === 'cpu') return { ctl: new CpuController(op.key, r), id: op.key };
    if (op.type === 'self') {
      // 自分の分身。半分は少し前の自分、半分はもっと昔の自分
      let net = this.selfNet;
      if (this.pool.length && this.rng.next() < 0.5) net = this.pool[this.rng.int(this.pool.length)];
      return { ctl: new NetController(net, r, 1), id: 'self' };
    }
    if (op.type === 'net') return { ctl: new NetController(op.net, r, op.temp || 1), id: op.id || 'net' };
    return { ctl: new CpuController('koro', r), id: 'koro' };
  }

  _resetSlot(s) {
    const arena = this.arenas[this.rng.int(this.arenas.length)];
    s.arena = arena;
    s.env.reset(arena, this.rng.u32());
    s.side = this.rng.int(2);
    const p = this._pickOpponent();
    s.opp = p.ctl; s.oppId = p.id;
    s.R = 0; s.cards.fill(0); s.evs.fill(0);
  }

  _finishEpisode(s) {
    const env = s.env;
    const own = env.score(s.side), enemy = env.score(1 - s.side);
    const sum = {
      opp: s.oppId, arena: s.arena,
      win: Math.sign(own - enemy), own, enemy,
      share: own / Math.max(1, own + enemy),
      R: s.R, cards: Array.from(s.cards), evs: Array.from(s.evs),
      it: this.iter,
    };
    this.recent.push(sum);
    if (this.recent.length > this.recentMax) this.recent.shift();
    this.episodes++;
    if (this.onEpisode) this.onEpisode(sum);
  }

  // 1回分: 経験を集めて PPO で更新。統計を返す
  iterate() {
    this.beginRollout();
    while (!this.stepAll()) { /* 集める */ }
    return this.learn();
  }

  beginRollout() { this.t = 0; this._t0 = Date.now(); }

  // 全アリーナを1手すすめる。T手たまったら true
  stepAll() {
    const { nEnv, X, A, LOGP, V, RAW, D, logits, prob, net, rng, W } = this;
    const t = this.t;
    for (let e = 0; e < nEnv; e++) {
      const s = this.slots[e];
      const env = s.env;
      const n = t * nEnv + e;
      const xo = n * OBS_N;
      env.observe(s.side, X, xo);
      const v = net.forward(X, logits, xo);
      softmax(logits, N_ACT, prob, 1);
      const a = sampleIndex(prob, N_ACT, rng.next());
      A[n] = a;
      LOGP[n] = Math.log(Math.max(1e-12, prob[a]));
      V[n] = v;
      const ra = toRealAction(s.side, a);
      const oa = s.opp.act(env, 1 - s.side);
      const done = s.side === 0 ? env.step(ra, oa) : env.step(oa, ra);
      const ev = env.ev[s.side];
      const r = rewardOf(ev, W);
      s.R += r;
      for (let k = 0; k < N_EV; k++) { s.evs[k] += ev[k]; if (W[k] !== 0) s.cards[k] += W[k] * ev[k]; }
      RAW[n] = r;
      D[n] = done ? 1 : 0;
      if (done) { this._finishEpisode(s); this._resetSlot(s); }
    }
    this.t++;
    return this.t >= this.T;
  }

  learn() {
    const t0 = this._t0 || Date.now();
    const { nEnv, T, V, RAW, R, D, ADV, RET, logits, net, rng, X, A, LOGP } = this;
    const gamma = this.learner.cfg.gamma, lam = this.learner.cfg.lam;
    // 報酬のスケールをそろえる（割引した報酬の合計のばらつきで割る）
    const tmp = new Float64Array(nEnv);
    for (let t = 0; t < T; t++) {
      for (let e = 0; e < nEnv; e++) {
        const n = t * nEnv + e;
        this.retAcc[e] = this.retAcc[e] * gamma + RAW[n];
        tmp[e] = this.retAcc[e];
        if (D[n]) this.retAcc[e] = 0;
      }
      this.rs.push(tmp, nEnv);
    }
    const sd = this.rs.std;
    for (let n = 0; n < this.N; n++) R[n] = Math.max(-10, Math.min(10, RAW[n] / sd));
    // 最後の状態の価値（続きのぶん）
    const lastV = new Float64Array(nEnv);
    const obs = new Float32Array(OBS_N);
    for (let e = 0; e < nEnv; e++) {
      const s = this.slots[e];
      s.env.observe(s.side, obs, 0);
      lastV[e] = net.forward(obs, logits, 0);
    }
    // GAE（アドバンテージ＝思ったより良かった度）
    for (let e = 0; e < nEnv; e++) {
      let gae = 0;
      for (let t = T - 1; t >= 0; t--) {
        const n = t * nEnv + e;
        const nextV = t === T - 1 ? lastV[e] : V[n + nEnv];
        const nonterm = 1 - D[n];
        const delta = R[n] + gamma * nextV * nonterm - V[n];
        gae = delta + gamma * lam * nonterm * gae;
        ADV[n] = gae;
        RET[n] = gae + V[n];
      }
    }
    const t1 = Date.now();
    const loss = this.learner.update({ X, A, LOGP, ADV, RET, N: this.N }, rng);
    const t2 = Date.now();
    this.iter++;
    this.steps += this.N;
    if (this.iter % this.opts.selfEvery === 0) this.selfNet.copyFrom(net);
    if (this.iter % this.opts.poolEvery === 0) {
      this.pool.push(net.clone());
      if (this.pool.length > this.opts.poolMax) this.pool.shift();
    }
    // 価値の予想がどれだけ当たっているか（説明できる分散）
    let mr = 0;
    for (let n = 0; n < this.N; n++) mr += RET[n];
    mr /= this.N;
    let vr = 0, ve = 0;
    for (let n = 0; n < this.N; n++) { vr += (RET[n] - mr) ** 2; ve += (RET[n] - V[n]) ** 2; }
    loss.explained = vr > 0 ? 1 - ve / vr : 0;
    loss.rollMs = t1 - t0;
    loss.learnMs = t2 - t1;
    this.lastLoss = loss;
    return loss;
  }

  // 最近の試合のまとめ
  summary(lastN = 40, filterOpp = null) {
    let eps = this.recent;
    if (filterOpp) eps = eps.filter(e => e.opp === filterOpp);
    eps = eps.slice(-lastN);
    return summarize(eps);
  }
}

export function summarize(eps) {
  const n = eps.length;
  const out = { n, win: 0, lose: 0, draw: 0, share: 0, R: 0, cards: new Array(N_EV).fill(0), evs: new Array(N_EV).fill(0), byOpp: {}, winRate: 0 };
  if (!n) return out;
  for (const e of eps) {
    if (e.win > 0) out.win++; else if (e.win < 0) out.lose++; else out.draw++;
    out.share += e.share; out.R += e.R;
    for (let k = 0; k < N_EV; k++) { out.cards[k] += e.cards[k]; out.evs[k] += e.evs[k]; }
    const b = out.byOpp[e.opp] || (out.byOpp[e.opp] = { n: 0, win: 0, share: 0 });
    b.n++; if (e.win > 0) b.win++; b.share += e.share;
  }
  out.share /= n; out.R /= n;
  for (let k = 0; k < N_EV; k++) { out.cards[k] /= n; out.evs[k] /= n; }
  out.winRate = out.win / n;
  for (const k in out.byOpp) { const b = out.byOpp[k]; b.winRate = b.win / b.n; b.share /= b.n; }
  return out;
}

export { EV };
