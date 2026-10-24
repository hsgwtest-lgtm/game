// 進化のエンジン（画面側）: CMA-ES で遺伝子の「きょうだい」を作り、評価係（Worker）たちに配って試させる
//   ・支えの手: 背の高い体は、はじめ見えない手で胴を支えてもらい、倒れずに進めるようになるたびに少しずつ外す
//   ・停滞したら変異を強める（ゆさぶり）
import { CMAES } from './cmaes.js';
import { geneCount } from '../sim/nerves.js';
import { evaluate, Episode } from '../sim/sim.js';
import { compileModel } from '../sim/model.js';

// ── 評価係たち ──
export class WorkerPool {
  constructor(n) {
    this.workers = [];
    this.ok = false;
    this.key = '';
    this.seq = 0;
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        this.workers.push(w);
      }
      this.ok = this.workers.length > 0;
    } catch (e) {
      this.ok = false;
      this.workers = [];
    }
    this.local = null;   // Worker が使えないときの代わり
  }
  static size() {
    const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    return Math.max(1, Math.min(6, hc - 1));
  }
  async setup(design, env, key) {
    this.env = env;
    if (this.ok) {
      try {
        await Promise.all(this.workers.map(w => this._call(w, { type: 'setup', design, env, key }, 'ready')));
        this.key = key;
        return;
      } catch (e) {
        console.warn('worker setup failed', e);
        this.ok = false;
      }
    }
    this.local = { model: compileModel(design), env };
    this.key = key;
  }
  _call(w, msg, want) {
    return new Promise((res, rej) => {
      const h = (e) => {
        const d = e.data;
        if (want === 'ready' && d.type === 'ready') { w.removeEventListener('message', h); res(d); }
        else if (d.type === 'done' && d.batch === msg.batch) { w.removeEventListener('message', h); res(d); }
        else if (d.type === 'error' && (d.batch === msg.batch || want === 'ready')) { w.removeEventListener('message', h); rej(new Error(d.message)); }
      };
      w.addEventListener('message', h);
      w.postMessage(msg);
    });
  }
  // jobs: [{ id, x(Float64Array), assist }] → 結果の配列（同じ順）
  async evalAll(jobs) {
    if (this.ok && this.workers.length) {
      const W = this.workers.length;
      const parts = Array.from({ length: W }, () => []);
      jobs.forEach((j, i) => parts[i % W].push({ id: j.id, x: Array.from(j.x), assist: j.assist }));
      const outs = await Promise.all(parts.map((p, k) => p.length ? this._call(this.workers[k], { type: 'eval', jobs: p, batch: ++this.seq }, 'done') : Promise.resolve({ out: [] })));
      const map = new Map();
      for (const o of outs) for (const r of o.out) map.set(r.id, r.r);
      return jobs.map(j => map.get(j.id));
    }
    // 代わり: 画面を止めないよう、少しずつ計算する
    const out = [];
    for (const j of jobs) {
      out.push(evaluate(this.local.model, j.x, { ...this.local.env, assist: j.assist }));
      await new Promise(r => setTimeout(r, 0));
    }
    return out;
  }
  terminate() { for (const w of this.workers) w.terminate(); this.workers = []; this.ok = false; }
}

// ── 1つの種の進化 ──
export class Evolver {
  // design: 設計図, env: 環境, opts: { genes(初期の平均), state(CMAの保存), sigma, assist, tall }
  constructor(model, opts = {}) {
    this.model = model;
    this.n = geneCount(model);
    const mean = opts.genes && opts.genes.length === this.n ? opts.genes : new Float64Array(this.n);
    this.es = opts.state && opts.state.n === this.n
      ? new CMAES(this.n, { state: opts.state, seed: opts.seed })
      : new CMAES(this.n, { mean, sigma: opts.sigma || 0.4, seed: opts.seed || ((Math.random() * 1e9) | 0) });
    this.assist = opts.assist || 0;
    this.okStreak = opts.okStreak || 0;
    this.need = opts.need || Math.max(0.3, Math.min(2, model.size.h * 1.2));
    this.goal = opts.goal || 'distance';
    this.stall = 0;
    this.bestFit = opts.bestFit !== undefined ? opts.bestFit : -1e9;
  }
  get gen() { return this.es.gen; }

  // 1世代すすめる
  async step(pool) {
    const S = this.es.ask();
    const assist = this.assist;
    const res = await pool.evalAll(S.map((s, i) => ({ id: i, x: s.x, assist })));
    const fits = res.map(r => r.fitness);
    const idx = this.es.tell(S, fits);
    const b = res[idx[0]];
    const champ = { x: Float64Array.from(S[idx[0]].x), r: b, assist };
    const mean = fits.reduce((a, c) => a + c, 0) / fits.length;
    const events = [];
    // 支えの手を外していく
    if (this.assist > 0) {
      // 「ヒトの歩き方をまねる」では、ヒトらしさ（60点以上）を保ったまま歩けたときだけ手を放す
      const okH = this.goal !== 'human' || (b.human || 0) >= 60;
      if (!b.fell && b.dist > this.need && okH) this.okStreak++; else this.okStreak = 0;
      if (this.okStreak >= 4) {
        this.assist = Math.max(0, +(this.assist - 0.05).toFixed(2));
        this.okStreak = 0;
        events.push({ type: 'assist', value: this.assist });
      }
    }
    // 停滞
    if (b.fitness > this.bestFit + 0.05) { this.bestFit = b.fitness; this.stall = 0; }
    else if (++this.stall > 40) { this.es.kick(1.6); this.stall = 0; events.push({ type: 'kick' }); }
    return { gen: this.es.gen, champ, fits, mean, sigma: this.es.sigma, assist: this.assist, events, all: res };
  }

  save() {
    return { state: this.es.save(), assist: this.assist, okStreak: this.okStreak, bestFit: this.bestFit };
  }
}

// 背が高く、支えの手がいる体か（設計の姿勢のまま置いて、すぐ倒れるかで判断）
export function needsSupport(model, genes, env) {
  const ep = new Episode(model, genes || new Float64Array(geneCount(model)), { ...env, T: 3, assist: 0 });
  if (!ep.tall || ep.env.water) return false;
  while (!ep.done) ep.step();
  return ep.fell;
}
