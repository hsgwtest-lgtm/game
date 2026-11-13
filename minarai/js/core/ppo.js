// 強化学習（PPO）: 自分で動いてみて、ごほうびが増える動きを少しずつ強める。
//   アクター（方策）= KeyNet。画像と関節センサーだけを見て行動を決める
//   クリティック（価値の見積もり役）= 小さな Mlp。学習中だけ使う助手で、位置などの「答え」の数値を直接もらう
//   （アクターとクリティックで見るものが違う「非対称アクター・クリティック」。本番で動くのはアクターだけ）
import { Mlp, Adam, PROP } from './nn.js';
import { SVEC, DEFAULT_REWARD } from './env.js';
import { OBS } from './raster.js';
import { Arena, NOUT, HEAD_OFF, HEAD_N, probs, sample } from './policy.js';
import { makeRng } from './rng.js';

export const PPO_DEFAULTS = {
  envs: 32, horizon: 64, gamma: 0.98, lam: 0.95, clip: 0.2, epochs: 2, batch: 128,
  lrActor: 5e-4, lrCritic: 1e-3, entropy: 0.01, warmup: 0, maxKL: 0.05,
};

export class PPO {
  constructor(actor, stage, opts = {}) {
    const o = this.o = Object.assign({}, PPO_DEFAULTS, opts);
    this.actor = actor; this.stage = stage;
    this.N = o.envs; this.T = o.horizon; this.M = this.N * this.T;
    this.arena = new Arena(stage, this.N, o.seed || 1, o.reward || DEFAULT_REWARD);
    this.critic = new Mlp([SVEC, 64, 64, 1], (o.seed || 1) + 17, this.M + this.N);
    this.optA = new Adam(actor.params, o.lrActor, 0.5);
    this.optC = new Adam(this.critic.params, o.lrCritic, 1.0);
    this.rng = makeRng((o.seed || 1) * 31 + 7);
    const M = this.M, N = this.N;
    this.obs = new Uint8Array(M * OBS);
    this.prop = new Float32Array(M * PROP);
    this.svec = new Float32Array((M + N) * SVEC);
    this.act = new Uint8Array(M * 3);
    this.logp = new Float32Array(M);
    this.rew = new Float32Array(M);
    this.done = new Uint8Array(M);
    this.adv = new Float32Array(M);
    this.ret = new Float32Array(M);
    this.val = new Float32Array(M + N);
    this.epRet = new Float32Array(N);
    this.order = Int32Array.from({ length: M }, (_, i) => i);
    const B = o.batch;
    this.bOffs = new Int32Array(B); this.bProp = new Float32Array(B * PROP); this.bSvec = new Float32Array(B * SVEC);
    this.dz = new Float32Array(B * NOUT); this.dv = new Float32Array(B);
    this.p = new Float64Array(NOUT);
    this.t = 0; this.phase = 'collect'; this.iter = 0; this.steps = 0;
    this.epoch = 0; this.pos = 0;
    this.recent = [];           // 直近のエピソードの成否（成功率の表示用）
    this.seen = new Uint8Array(N); this.seenN = 0;   // 1回でも終わった作業場
    this.stat = { ok: 0, n: 0, ret: 0, len: 0 };
    this.klSum = 0; this.klN = 0; this.entSum = 0; this.vlSum = 0; this.stopped = false;
  }

  // 直近の成功率。全部の作業場が1回ずつ終わるまでは null
  // （はじめは「早く終わった＝成功した回」だけが先に数えられて、高く見えてしまうため）
  successRate(window = 200) {
    const r = this.recent, n = Math.min(window, r.length);
    if (!n || this.seenN < this.N) return null;
    let s = 0;
    for (let i = r.length - n; i < r.length; i++) s += r[i];
    return s / n;
  }

  // 全部の作業場を1歩ずつ進める
  _collectStep() {
    const N = this.N, t = this.t, a = this.arena, base = t * N;
    a.observe(true);
    this.obs.set(a.obs, base * OBS); this.prop.set(a.prop, base * PROP); this.svec.set(a.svec, base * SVEC);
    const z = this.actor.forward(a.obs, a.offs, N, a.prop);
    for (let i = 0; i < N; i++) {
      const k = base + i, e = a.envs[i];
      this.logp[k] = sample(z, i * NOUT, this.rng, this.act, k * 3);
      const r = e.step(this.act[k * 3] - 1, this.act[k * 3 + 1] - 1, this.act[k * 3 + 2]);
      this.rew[k] = r; this.epRet[i] += r;
      if (e.done) {
        this.done[k] = 1;
        this.recent.push(e.success ? 1 : 0); if (this.recent.length > 1000) this.recent.splice(0, 500);
        if (!this.seen[i]) { this.seen[i] = 1; this.seenN++; }
        this.stat.n++; this.stat.ok += e.success ? 1 : 0; this.stat.ret += this.epRet[i]; this.stat.len += e.t;
        this.epRet[i] = 0;
        e.reset();
      } else this.done[k] = 0;
    }
    this.t++; this.steps += N;
  }

  // 集めた経験から「思ったより良かった度合い」（アドバンテージ）を計算する
  _finishRollout() {
    const N = this.N, T = this.T, M = this.M, o = this.o, a = this.arena;
    a.observe(true);
    this.svec.set(a.svec, M * SVEC);
    const v = this.critic.forward(this.svec, M + N);
    for (let i = 0; i < M + N; i++) this.val[i] = v[i];
    for (let i = 0; i < N; i++) {
      let gae = 0;
      for (let t = T - 1; t >= 0; t--) {
        const k = t * N + i, nd = this.done[k] ? 0 : 1;
        const delta = this.rew[k] + o.gamma * this.val[k + N] * nd - this.val[k];
        gae = delta + o.gamma * o.lam * nd * gae;
        this.adv[k] = gae; this.ret[k] = gae + this.val[k];
      }
    }
    let m = 0, s = 0;
    for (let i = 0; i < M; i++) m += this.adv[i];
    m /= M;
    for (let i = 0; i < M; i++) s += (this.adv[i] - m) ** 2;
    s = Math.sqrt(s / M) + 1e-6;
    for (let i = 0; i < M; i++) this.adv[i] = (this.adv[i] - m) / s;
    this.phase = 'update'; this.epoch = 0; this.pos = M;
    this.klSum = 0; this.klN = 0; this.entSum = 0; this.vlSum = 0; this.stopped = false;
  }

  _shuffle() {
    const o = this.order, r = this.rng;
    for (let i = o.length - 1; i > 0; i--) { const j = r.int(i + 1), t = o[i]; o[i] = o[j]; o[j] = t; }
    this.pos = 0;
  }

  // ミニバッチ1つぶんの更新。更新フェーズが終わったら true
  _updateStep() {
    const o = this.o, M = this.M;
    if (this.pos >= M) {
      if (this.epoch >= o.epochs || this.stopped) return true;
      this.epoch++; this._shuffle();
    }
    const B = Math.min(o.batch, M - this.pos);
    const actorOn = this.iter >= o.warmup && !this.stopped;
    for (let b = 0; b < B; b++) {
      const k = this.order[this.pos + b];
      this.bOffs[b] = k * OBS;
      this.bProp[b * PROP] = this.prop[k * PROP]; this.bProp[b * PROP + 1] = this.prop[k * PROP + 1]; this.bProp[b * PROP + 2] = this.prop[k * PROP + 2];
      for (let j = 0; j < SVEC; j++) this.bSvec[b * SVEC + j] = this.svec[k * SVEC + j];
    }
    if (actorOn) {
      const z = this.actor.forward(this.obs, this.bOffs, B, this.bProp), dz = this.dz, p = this.p;
      let kl = 0;
      for (let b = 0; b < B; b++) {
        const k = this.order[this.pos + b], zo = b * NOUT;
        probs(z, zo, p);
        let lp = 0;
        for (let h = 0; h < 3; h++) lp += Math.log(p[HEAD_OFF[h] + this.act[k * 3 + h]] + 1e-12);
        const ratio = Math.exp(lp - this.logp[k]), A = this.adv[k];
        kl += this.logp[k] - lp;
        // 変えすぎ防止（クリップ）: 得する向きに もう十分変わっていたら、それ以上は押さない
        const g = ((A >= 0 && ratio > 1 + o.clip) || (A < 0 && ratio < 1 - o.clip)) ? 0 : -A * ratio;
        for (let h = 0; h < 3; h++) {
          const off = HEAD_OFF[h], n = HEAD_N[h], a = this.act[k * 3 + h];
          let H = 0;
          for (let j = 0; j < n; j++) { const q = p[off + j]; if (q > 1e-12) H -= q * Math.log(q); }
          this.entSum += H;
          for (let j = 0; j < n; j++) {
            const q = p[off + j];
            // 方策の勾配 + 「迷い」（エントロピー）を少し保つ項
            dz[zo + off + j] = (g * ((j === a ? 1 : 0) - q) + o.entropy * q * (Math.log(q + 1e-12) + H)) / B;
          }
        }
      }
      this.klSum += kl; this.klN += B;
      this.optA.zero(); this.actor.backward(dz); this.optA.step();
      if (this.actor.clampBias) this.actor.clampBias();
      if (o.maxKL > 0 && kl / B > o.maxKL) this.stopped = true;
    }
    // クリティック: 実際に得られたごほうびの合計に見積もりを近づける
    const v = this.critic.forward(this.bSvec, B), dv = this.dv;
    for (let b = 0; b < B; b++) { const k = this.order[this.pos + b], d = v[b] - this.ret[k]; dv[b] = d / B; this.vlSum += 0.5 * d * d; }
    this.optC.zero(); this.critic.backward(dv); this.optC.step();
    this.pos += B;
    return false;
  }

  // 少しだけ進める（1歩ぶんの収集 or ミニバッチ1つの更新）。1周（収集+更新）が終わったら成績を返す
  tick() {
    if (this.phase === 'collect') {
      this._collectStep();
      if (this.t >= this.T) this._finishRollout();
      return null;
    }
    if (this._updateStep()) {
      const st = this.stat, M = this.M;
      const res = {
        iter: ++this.iter, steps: this.steps, episodes: st.n,
        success: st.n ? st.ok / st.n : 0, ret: st.n ? st.ret / st.n : 0, len: st.n ? st.len / st.n : 0,
        rate: this.successRate(), kl: this.klN ? this.klSum / this.klN : 0,
        entropy: this.klN ? this.entSum / this.klN : 0, vloss: this.vlSum / Math.max(1, M * this.o.epochs),
      };
      this.stat = { ok: 0, n: 0, ret: 0, len: 0 };
      this.t = 0; this.phase = 'collect';
      return res;
    }
    return null;
  }

  // 1周ぶん回す（ブラウザなしの実験用）
  iterate() { let r = null; while (!(r = this.tick())); return r; }
}
