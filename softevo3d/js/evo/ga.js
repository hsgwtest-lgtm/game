// 遺伝的アルゴリズム
//  ・エリート保存（上位はそのまま次の世代へ。決定論なので評価し直す必要もない）
//  ・トーナメント選択（3匹のうちいちばん良い子が親になる）
//  ・ニューロン単位の交叉（隠れニューロン1つ分の配線を、まとめて片方の親から受けつぐ）
//  ・ガウス突然変異（伸びなやむと自動で強くなる）

import { RNG, randomSeed } from '../core/rng.js';
import { randomGenome, W_CLAMP, fr, w1Index, b1Index, w2Index } from '../sim/brain.js';

export const POP_OPTIONS = [20, 30, 40];
export const DEFAULT_POP = 30;
// 調整用のパラメータ（tools/ga_sweep.mjs で比べて決めた値）
export const GA_PARAMS = { tournament: 3, crossP: 0.35, sigma: 0.4, pmGenes: 12, stallGens: 8, boost: 2, elite: 0.1 };

export class GA {
  constructor(L, opts = {}) {
    this.L = L;
    this.size = opts.size || DEFAULT_POP;
    this.rng = new RNG(opts.seed ?? randomSeed());
    if (opts.rngState !== undefined) this.rng.state = opts.rngState >>> 0;
    this.gen = opts.gen || 0;
    this.nextId = opts.nextId || 1;
    this.boost = opts.boost || 1;
    this.stall = opts.stall || 0;
    this.bestFit = opts.bestFit ?? -Infinity;
    this.pm = Math.min(0.15, GA_PARAMS.pmGenes / L.len);
    this.pop = opts.pop || this._initial(opts.seedGenomes);
  }

  _initial(seeds) {
    const pop = [];
    for (let i = 0; i < this.size; i++) {
      let g, kind = 'new';
      if (seeds && seeds.length) {
        g = Float64Array.from(seeds[i % seeds.length]);
        if (i >= seeds.length) { this._mutate(g, 1.5); kind = 'mut'; }
      } else g = randomGenome(this.L, this.rng);
      pop.push({ id: this.nextId++, g, fit: null, res: null, pa: 0, pb: 0, kind });
    }
    return pop;
  }

  pending() { return this.pop.filter(i => i.fit === null); }

  // 環境が変わったら全員を評価し直す
  invalidate() { for (const i of this.pop) { i.fit = null; i.res = null; } this.bestFit = -Infinity; this.stall = 0; this.boost = 1; }

  _tournament(ranked) {
    let best = null;
    for (let k = 0; k < GA_PARAMS.tournament; k++) {
      const c = ranked[Math.floor(this.rng.next() * ranked.length)];
      if (!best || c.fit > best.fit) best = c;
    }
    return best;
  }

  _mutate(g, scale = 1) {
    const L = this.L, rng = this.rng;
    const pm = this.pm * scale, s = GA_PARAMS.sigma * this.boost;
    let n = 0;
    for (let i = 0; i < L.len; i++) {
      if (rng.next() >= pm) continue;
      let v = g[i] + rng.gauss() * s;
      if (v > W_CLAMP) v = W_CLAMP; else if (v < -W_CLAMP) v = -W_CLAMP;
      g[i] = fr(v);
      n++;
    }
    if (n === 0) {   // 必ずどこか1つは変わる
      const i = Math.floor(rng.next() * L.len);
      g[i] = fr(Math.max(-W_CLAMP, Math.min(W_CLAMP, g[i] + rng.gauss() * s)));
    }
  }

  _cross(a, b) {
    const L = this.L, g = Float64Array.from(a);
    for (let h = 0; h < L.nH; h++) {
      if (this.rng.next() < 0.5) continue;
      for (let i = 0; i < L.nIn; i++) g[w1Index(L, h, i)] = b[w1Index(L, h, i)];
      g[b1Index(L, h)] = b[b1Index(L, h)];
      for (let o = 0; o < L.nOut; o++) g[w2Index(L, o, h)] = b[w2Index(L, o, h)];
    }
    return g;
  }

  // 全員の評価が終わったら呼ぶ: この世代のまとめを返し、次の世代を作る
  breed() {
    const ranked = this.pop.slice().sort((a, b) => (b.fit - a.fit) || (a.id - b.id));
    const n = ranked.length;
    let sum = 0;
    for (const i of ranked) sum += Math.max(-1, i.fit);
    const best = ranked[0];
    const improved = !Number.isFinite(this.bestFit) || best.fit > this.bestFit + Math.max(0.005, Math.abs(this.bestFit) * 0.01);
    let boosted = false;
    if (improved) { this.bestFit = best.fit; this.stall = 0; this.boost = 1; }
    else {
      this.stall++;
      if (this.stall >= GA_PARAMS.stallGens && this.boost === 1) { this.boost = GA_PARAMS.boost; boosted = true; }
    }
    const summary = {
      gen: this.gen, ranked, best, mean: sum / n, improved, boosted, boost: this.boost,
    };
    // 次の世代
    const elites = Math.max(1, Math.round(this.size * GA_PARAMS.elite));
    const next = [];
    for (let i = 0; i < elites && i < n; i++) {
      const e = ranked[i];
      next.push({ id: e.id, g: e.g, fit: e.fit, res: e.res, pa: e.pa, pb: e.pb, kind: 'elite' });
    }
    while (next.length < this.size) {
      const pa = this._tournament(ranked);
      let g, kind, pb = 0;
      if (this.rng.next() < GA_PARAMS.crossP) {
        const b = this._tournament(ranked);
        g = this._cross(pa.g, b.g);
        pb = b.id; kind = 'cross';
        if (this.rng.next() < 0.7) this._mutate(g);
      } else {
        g = Float64Array.from(pa.g);
        const big = this.rng.next() < 0.15;
        this._mutate(g, big ? 3 : 1);
        kind = big ? 'big' : 'mut';
      }
      next.push({ id: this.nextId++, g, fit: null, res: null, pa: pa.id, pb, kind });
    }
    this.pop = next;
    this.gen++;
    return summary;
  }

  toJSON() {
    return {
      size: this.size, rngState: this.rng.state, gen: this.gen, nextId: this.nextId,
      boost: this.boost, stall: this.stall, bestFit: Number.isFinite(this.bestFit) ? this.bestFit : null,
      pop: this.pop.map(i => ({ id: i.id, g: Float32Array.from(i.g), fit: i.fit, res: i.res, pa: i.pa, pb: i.pb, kind: i.kind })),
    };
  }

  static fromJSON(L, o) {
    const pop = o.pop.map(i => ({ id: i.id, g: Float64Array.from(i.g), fit: i.fit, res: i.res, pa: i.pa, pb: i.pb, kind: i.kind }));
    return new GA(L, {
      size: o.size, rngState: o.rngState, seed: 1, gen: o.gen, nextId: o.nextId, boost: o.boost,
      stall: o.stall, bestFit: o.bestFit ?? -Infinity, pop,
    });
  }
}
