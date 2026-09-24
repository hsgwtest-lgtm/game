/* =====================================================================
   SoftEvo 8 — evo.js
   遺伝的アルゴリズム + 系統 (クレード) の追跡
   ---------------------------------------------------------------------
   ・エリート保存 + トーナメント選択 + ニューロン単位の交叉 + ガウス変異
   ・停滞すると変異を自動で強める (適応的変異)
   ・記録を大きく更新した個体は「新しい系統」の祖となる。
     子孫は系統を受け継ぐので、系統の盛衰 (ミュラー図) が観察できる。
   ===================================================================== */
import { brainLayout, evaluate, randomGenome, makeRng, genomeLength } from './sim.js';

const TOP_K = 10;

export class Evolver {
  constructor(bp, settings, { seed = (Math.random() * 2 ** 31) | 0, seedGenome = null, startGen = 0, bestEver = null, cladeSeq = 0, clade = null } = {}) {
    this.bp = bp;
    this.settings = { ...settings };
    this.layout = brainLayout(bp, settings);
    this.rng = makeRng(seed);
    this.nextId = 1;
    this.gen = startGen;
    this.bestEver = bestEver;
    this.stall = 0;
    this.lastCladeGen = -99;
    this.cladeSeq = cladeSeq;
    this.clades = new Map();
    const root = clade || this.newClade(null, startGen);
    if (clade) this.clades.set(clade.id, clade);
    this.envKey = '';
    const len = genomeLength(this.layout.sizes);
    const ok = seedGenome && seedGenome.length === len;
    this.pop = [];
    for (let i = 0; i < settings.population; i++) {
      let g;
      if (ok) {
        g = Float32Array.from(seedGenome);
        if (i > 0) this.mutate(g, 0.1, 0.25);
      } else g = randomGenome(this.layout.sizes, this.rng);
      this.pop.push({ id: this.nextId++, g, parent: null, clade: root.id, fit: null, born: startGen });
    }
  }

  newClade(parent, gen) {
    const id = this.cladeSeq++;
    let label = '', k = id;
    do { label = String.fromCharCode(65 + (k % 26)) + label; k = Math.floor(k / 26) - 1; } while (k >= 0);
    const hue = parent ? (parent.hue + 47 + this.rng() * 50) % 360 : 195;
    const c = { id, label, parent: parent ? parent.id : null, born: gen, hue };
    this.clades.set(id, c);
    return c;
  }

  /** 環境の変更: 記録は「その環境での記録」なのでリセットする */
  setEnv(env) {
    const before = JSON.stringify(this.envOf());
    Object.assign(this.settings, env);
    if (JSON.stringify(this.envOf()) !== before) { this.bestEver = null; this.stall = 0; }
  }

  envOf() {
    const s = this.settings;
    return { terrain: s.terrain, objective: s.objective, gravity: s.gravity, friction: s.friction, evalSeconds: s.evalSeconds };
  }

  mutate(g, rate, size) {
    const rng = this.rng;
    for (let i = 0; i < g.length; i++) {
      if (rng() < rate) {
        if (rng() < 0.03) g[i] = rng.gauss();
        else g[i] += rng.gauss() * size;
      }
    }
  }

  pick() {
    const P = this.pop, rng = this.rng;
    let best = P[(rng() * P.length) | 0];
    for (let k = 0; k < 2; k++) { const c = P[(rng() * P.length) | 0]; if (c.fit > best.fit) best = c; }
    return best;
  }

  crossover(a, b) {
    const g = Float32Array.from(a.g), s = this.layout.sizes, rng = this.rng;
    let off = 0;
    for (let l = 1; l < s.length; l++) {
      const nIn = s[l - 1], nOut = s[l], bOff = off + nIn * nOut;
      for (let j = 0; j < nOut; j++) {
        if (rng() < 0.5) {
          for (let i = 0; i < nIn; i++) g[off + j * nIn + i] = b.g[off + j * nIn + i];
          g[bOff + j] = b.g[bOff + j];
        }
      }
      off = bOff + nOut;
    }
    if (rng() < 0.5) g[g.length - 1] = b.g[b.g.length - 1];
    return g;
  }

  runGeneration() {
    const env = this.envOf();
    const key = JSON.stringify(env);
    const envChanged = key !== this.envKey;
    this.envKey = key;
    const t0 = performance.now();

    for (const ind of this.pop) {
      if (ind.fit === null || envChanged) ind.fit = evaluate(this.bp, this.layout, ind.g, env).fitness;
    }
    this.pop.sort((a, b) => b.fit - a.fit);
    const P = this.pop, n = P.length;
    const fits = P.map(p => p.fit);
    const q = f => fits[Math.min(n - 1, Math.floor(f * n))];
    const champ = P[0];

    // チャンピオンの詳細 (歩容シグネチャ付き)
    const detail = evaluate(this.bp, this.layout, champ.g, env, { gait: true });

    // 記録と系統
    let newClade = null, record = false;
    const prev = this.bestEver;
    if (prev === null || champ.fit > prev) {
      record = prev !== null;
      const margin = prev === null ? Infinity : Math.max(10, Math.abs(prev) * 0.08);
      if (prev !== null && champ.fit - prev > margin && this.gen - this.lastCladeGen >= 3) {
        newClade = this.newClade(this.clades.get(champ.clade), this.gen);
        champ.clade = newClade.id;
        this.lastCladeGen = this.gen;
      }
      if (prev === null || champ.fit > prev + 0.5) this.stall = 0; else this.stall++;
      this.bestEver = champ.fit;
    } else this.stall++;

    const cladeCounts = {};
    for (const p of P) cladeCounts[p.clade] = (cladeCounts[p.clade] || 0) + 1;

    const parentInd = champ.parent;
    const summary = {
      gen: this.gen,
      env,
      best: champ.fit, median: q(0.5), p10: q(0.9), p90: q(0.1),
      avg: fits.reduce((a, b) => a + b, 0) / n,
      worst: fits[n - 1],
      record, bestEver: this.bestEver,
      boost: this.boost(),
      stall: this.stall,
      champ: {
        id: champ.id, clade: champ.clade, born: champ.born,
        genome: Float32Array.from(champ.g),
        parentGenome: parentInd ? Float32Array.from(parentInd) : null,
        fitness: champ.fit, distance: detail.distance, height: detail.height, gait: detail.gait,
      },
      top: P.slice(1, TOP_K).map(p => ({ genome: Float32Array.from(p.g), clade: p.clade, fitness: p.fit })),
      cladeCounts,
      newClade,
      clades: newClade || this.gen === 0 ? [...this.clades.values()] : null,
      ms: performance.now() - t0,
    };

    // 次世代
    const S = this.settings;
    const elites = Math.max(2, Math.round(n * 0.06));
    const next = [];
    for (let i = 0; i < elites; i++) next.push(P[i]);
    const size = S.mutationSize * this.boost();
    while (next.length < S.population) {
      const a = this.pick();
      let g;
      if (this.rng() < 0.3) { const b = this.pick(); g = this.crossover(a, b); }
      else g = Float32Array.from(a.g);
      this.mutate(g, S.mutationRate, size);
      next.push({ id: this.nextId++, g, parent: a.g, clade: a.clade, fit: null, born: this.gen + 1 });
    }
    this.pop = next.slice(0, S.population);
    this.gen++;
    return summary;
  }

  boost() { return 1 + Math.min(2, Math.max(0, this.stall - 15) / 25); }
}
