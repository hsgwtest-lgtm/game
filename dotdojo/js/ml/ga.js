// 進化流：遺伝的アルゴリズム（ニューロエボリューション）
// 1世代 = 群れの全員が同じ修行場に挑む → ごほうびの合計（成績）が高い子ほど親に選ばれやすい
//        → 親2人の脳（DNA）をまぜて（交叉）、少しだけランダムに変える（突然変異）→ 次の世代

import { MLP, argmax, f32ToB64, b64ToF32 } from './nn.js';
import { RNG } from '../core/rng.js';
import { N_IN, N_ACT } from '../sim/env.js';

export const HID = 16;
export const N_FAMILY = 10;
let MEMBER_ID = 1;

export const GA_MUTATION = [
  { key: 'low', pm: 0.04, sigma: 0.12 },
  { key: 'mid', pm: 0.1, sigma: 0.2 },
  { key: 'high', pm: 0.25, sigma: 0.35 },
];
export const GA_POP = [20, 40, 80];

export class Member {
  constructor(genome, family, opts = {}) {
    this.id = opts.id ?? MEMBER_ID++;
    if (this.id >= MEMBER_ID) MEMBER_ID = this.id + 1;
    this.genome = genome;
    this.family = family;
    this.born = opts.born ?? 1;
    this.parents = opts.parents ?? null;   // [{id, family}, {id, family}]
    this.src = opts.src ?? null;           // 遺伝子ごと: 0=親A 1=親B
    this.mut = opts.mut ?? null;           // 遺伝子ごと: 1=突然変異
    this.elite = !!opts.elite;
    this.age = opts.age ?? 0;
    this.fitness = 0;
    this.succ = 0;
    this.steps = 0;
    this.cause = 0;
    this.coins = 0;
  }
}

export class Population {
  constructor(opts = {}) {
    this.size = opts.size || 40;
    this.rng = new RNG(opts.seed);
    this.P = MLP.paramCount(N_IN, HID, N_ACT);
    this.gen = 1;
    this.members = [];
    this.history = [];        // {g, best, avg, succ}
    this.mutIdx = opts.mutIdx ?? 1;
    this.crossRate = 0.5;
    this.tourK = 5;
    this.keepOshi = true;
    this.oshiId = null;
    this.evals = 0;            // これまでに挑戦した延べ人数
    this.envSteps = 0;
    this.bestEver = -Infinity;
    this.firstClearEvals = 0;  // はじめてゴールした時点の延べ人数
    this.lastSummary = null;
    this.netTmp = new MLP(N_IN, HID, N_ACT);
    this.nets = [];
  }

  get eliteCount() { return Math.max(2, Math.round(this.size * 0.05)); }

  initRandom(seedGenome = null) {
    this.members = [];
    for (let i = 0; i < this.size; i++) {
      const net = new MLP(N_IN, HID, N_ACT).randomize(this.rng, 1, 1);
      if (seedGenome && i < Math.ceil(this.size * 0.25)) {
        // 「模倣流の脳」から始める子（少しずつ変える）
        net.w.set(seedGenome);
        if (i > 0) for (let p = 0; p < this.P; p++) if (this.rng.float() < 0.1) net.w[p] += this.rng.gauss() * 0.2;
      }
      this.members.push(new Member(net.w, i % N_FAMILY, { born: this.gen }));
    }
    this._buildNets();
    return this;
  }

  _buildNets() {
    this.nets = this.members.map((m) => new MLP(N_IN, HID, N_ACT, m.genome));
  }

  member(id) { return this.members.find((m) => m.id === id) || null; }

  // 行動を決める（遺伝的アルゴリズムは「いちばん点の高い行動」を必ず選ぶ）
  act(i, obs) { return argmax(this.nets[i].forward(obs)); }

  // エピソードの結果を書きこむ
  setResults(ep) {
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      // 成績 = ごほうびの合計（同点なら早くゴールした方を少し上に）
      m.fitness = ep.ret[i] + (ep.succ[i] ? (ep.st.maxSteps - ep.steps[i]) * 0.01 : 0);
      m.succ = ep.succ[i];
      m.steps = ep.steps[i];
      m.cause = ep.cause[i];
      m.coins = ep.coinsGot[i];
      this.envSteps += ep.steps[i];
    }
    this.evals += this.members.length;
  }

  _tournament(sorted) {
    let best = null;
    for (let i = 0; i < this.tourK; i++) {
      const c = sorted[Math.floor(this.rng.float() * sorted.length)];
      if (!best || c.fitness > best.fitness) best = c;
    }
    return best;
  }

  // 次の世代をつくる
  evolve() {
    const rng = this.rng;
    const mut = GA_MUTATION[this.mutIdx];
    const sorted = [...this.members].sort((a, b) => b.fitness - a.fitness);
    const fits = sorted.map((m) => m.fitness);
    const best = fits[0];
    const avg = fits.reduce((s, v) => s + v, 0) / fits.length;
    const succ = this.members.reduce((s, m) => s + m.succ, 0);
    const record = best > this.bestEver + 1e-6;
    if (record) this.bestEver = best;
    if (succ > 0 && !this.firstClearEvals) this.firstClearEvals = this.evals;
    const div = this.diversity();
    this.history.push({ g: this.gen, best, avg, succ: succ / this.members.length, div });
    if (this.history.length > 300) this.history.splice(0, this.history.length - 300);
    const causes = [0, 0, 0, 0, 0, 0];
    for (const m of this.members) causes[m.cause]++;
    this.lastSummary = {
      gen: this.gen, best, avg, succ, n: this.members.length, record, div, causes,
      top: sorted.slice(0, 3).map((m) => ({ id: m.id, family: m.family, fitness: m.fitness, succ: m.succ })),
      coins: sorted[0].coins,
    };

    const next = [];
    const E = this.eliteCount;
    for (let i = 0; i < E && i < sorted.length; i++) {
      const m = sorted[i];
      next.push(new Member(m.genome, m.family, { id: m.id, born: m.born, elite: true, age: m.age + 1, parents: m.parents, src: m.src, mut: m.mut }));
    }
    if (this.keepOshi && this.oshiId != null && !next.some((m) => m.id === this.oshiId)) {
      const o = sorted.find((m) => m.id === this.oshiId);
      if (o) next.push(new Member(o.genome, o.family, { id: o.id, born: o.born, elite: true, age: o.age + 1, parents: o.parents, src: o.src, mut: o.mut }));
    }
    const P = this.P, net = this.netTmp, nH = HID;
    while (next.length < this.size) {
      const A = this._tournament(sorted);
      let B = this._tournament(sorted);
      for (let t = 0; t < 4 && B === A; t++) B = this._tournament(sorted);
      const g = new Float32Array(P);
      const src = new Uint8Array(P);
      const mm = new Uint8Array(P);
      if (rng.float() < this.crossRate && B !== A) {
        // ニューロン単位の交叉：隠れニューロンごとに、どちらの親の部品を使うか決める
        const pick = new Uint8Array(nH + 1);
        for (let j = 0; j <= nH; j++) pick[j] = rng.float() < 0.5 ? 0 : 1;
        for (let p = 0; p < P; p++) {
          const s = pick[net.geneNeuron(p)];
          src[p] = s;
          g[p] = s ? B.genome[p] : A.genome[p];
        }
      } else {
        g.set(A.genome);
      }
      for (let p = 0; p < P; p++) {
        if (rng.float() < mut.pm) {
          if (rng.float() < 0.05) g[p] = rng.gauss();
          else g[p] += rng.gauss() * mut.sigma;
          if (g[p] > 4) g[p] = 4; else if (g[p] < -4) g[p] = -4;
          mm[p] = 1;
        }
      }
      next.push(new Member(g, A.family, {
        born: this.gen + 1,
        parents: [{ id: A.id, family: A.family }, { id: B.id, family: B.family }],
        src, mut: mm,
      }));
    }
    this.members = next;
    this.gen++;
    this._buildNets();
    return this.lastSummary;
  }

  // 遺伝子のばらつき（多様性）0..1
  diversity() {
    const n = this.members.length;
    if (n < 2) return 0;
    const P = this.P;
    let acc = 0, cnt = 0;
    for (let p = 0; p < P; p += 3) {
      let s = 0, s2 = 0;
      for (let i = 0; i < n; i++) { const v = this.members[i].genome[p]; s += v; s2 += v * v; }
      const mean = s / n;
      acc += Math.sqrt(Math.max(0, s2 / n - mean * mean));
      cnt++;
    }
    return Math.min(1, (acc / cnt) / 0.35);
  }

  familyCounts() {
    const c = new Array(N_FAMILY + 1).fill(0);
    for (const m of this.members) c[m.family]++;
    return c;
  }

  // いちばん成績のよい子（前の世代の結果から並べたもの）
  bestGenome() {
    let b = this.members[0];
    for (const m of this.members) if (m.elite && (!b.elite || m.fitness > b.fitness)) b = m;
    return b.genome;
  }

  // ほかの流派の脳を群れに入れる（一番成績の悪い子と入れかえ）
  inject(genome, family = N_FAMILY) {
    let worst = 0;
    for (let i = 1; i < this.members.length; i++) if (this.members[i].fitness < this.members[worst].fitness) worst = i;
    const m = new Member(new Float32Array(genome), family, { born: this.gen, elite: true });
    this.members[worst] = m;
    this._buildNets();
    return m;
  }

  serialize(keep = 8) {
    const sorted = [...this.members].sort((a, b) => (b.elite - a.elite) || (b.fitness - a.fitness));
    return {
      v: 1, size: this.size, gen: this.gen, mutIdx: this.mutIdx, keepOshi: this.keepOshi,
      evals: this.evals, envSteps: this.envSteps, bestEver: this.bestEver, first: this.firstClearEvals,
      history: this.history.slice(-200),
      members: sorted.slice(0, keep).map((m) => ({ id: m.id, f: m.family, b: m.born, e: m.elite ? 1 : 0, a: m.age, fit: m.fitness, g: f32ToB64(m.genome) })),
    };
  }

  static deserialize(d, seed) {
    if (!d || !d.members || !d.members.length) return null;
    const p = new Population({ size: d.size, seed, mutIdx: d.mutIdx });
    if (b64ToF32(d.members[0].g).length !== p.P) return null;
    p.gen = d.gen; p.keepOshi = d.keepOshi ?? true;
    p.evals = d.evals || 0; p.envSteps = d.envSteps || 0; p.bestEver = d.bestEver ?? -Infinity;
    p.firstClearEvals = d.first || 0;
    p.history = d.history || [];
    const saved = d.members.map((o) => {
      const m = new Member(b64ToF32(o.g), o.f, { id: o.id, born: o.b, elite: !!o.e, age: o.a || 0 });
      m.fitness = o.fit ?? 0;
      return m;
    });
    // 保存していない子は、保存した子の突然変異で補う
    const members = saved.slice();
    let k = 0;
    while (members.length < p.size) {
      const src = saved[k++ % saved.length];
      const g = new Float32Array(src.genome);
      for (let q = 0; q < g.length; q++) if (p.rng.float() < 0.05) g[q] += p.rng.gauss() * 0.3;
      members.push(new Member(g, src.family, { born: p.gen }));
    }
    p.members = members;
    p._buildNets();
    return p;
  }
}
