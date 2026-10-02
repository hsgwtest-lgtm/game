// 遺伝的アルゴリズム（ニューロエボリューション）
// 1世代 = 全員が同じコースを飛ぶ → 遠くまで飛べた子ほど親に選ばれやすい
//        → 親2羽の脳（DNA）を混ぜて（交叉）、少しランダムに変える（突然変異）

import { MLP, f32ToB64, b64ToF32 } from './nn.js';
import { RNG } from '../core/rng.js';
import { FAMILIES, TEACH_FAMILY, MUTATION, NET } from '../core/config.js';
import { N_IN } from '../sim/flight.js';

let MEMBER_ID = 1;

export class Member {
  constructor(genome, family, opts = {}) {
    this.id = opts.id ?? MEMBER_ID++;
    if (this.id >= MEMBER_ID) MEMBER_ID = this.id + 1;
    this.genome = genome;
    this.family = family;
    this.born = opts.born ?? 1;
    this.parents = opts.parents ?? null;   // [親A, 親B]（{id, family, genome}）
    this.src = opts.src ?? null;           // 遺伝子ごと: 0=親Aから 1=親Bから
    this.mut = opts.mut ?? null;           // 遺伝子ごと: 1=突然変異した
    this.elite = !!opts.elite;
    this.crossed = !!opts.crossed;      // 交叉で生まれたか
    this.age = opts.age ?? 0;              // エリートとして生き残った回数
    this.fitness = 0;
    this.dist = undefined;    // 直前の世代で飛んだ距離
    this.rows = 0;
    this.cause = null;
  }
  get name() { return FAMILIES[this.family].name + this.id; }
  get color() { return FAMILIES[this.family].color; }
}

export class Flock {
  constructor(opts = {}) {
    this.size = opts.size || 50;
    this.nIn = N_IN; this.nHid = NET.hid; this.nOut = NET.out;
    this.P = MLP.paramCount(this.nIn, this.nHid, this.nOut);
    this.rng = new RNG(opts.seed);
    this.gen = 1;
    this.members = [];
    this.history = [];         // 世代ごとの記録
    this.mutIdx = 1;           // MUTATION のどれを使うか
    this.keepOshi = true;      // 推しを必ず次の世代に残す
    this.oshiId = null;
    this.bestEver = 0;
    this.bestByStage = {};
    this.lastSummary = null;
    this.crossRate = 0.5;      // 交叉する確率
    this.override = null;      // テスト用 {pm, sigma}
    this.tourK = 3;            // トーナメントの大きさ
    this.truncFrac = 0;        // >0 なら上位この割合から一様に親を選ぶ
    this.netTmp = new MLP(this.nIn, this.nHid, this.nOut);
  }

  get eliteCount() { return Math.max(2, Math.round(this.size * 0.06)); }

  initRandom() {
    this.members = [];
    for (let i = 0; i < this.size; i++) {
      const net = new MLP(this.nIn, this.nHid, this.nOut).randomize(this.rng, 1.2);
      this.members.push(new Member(net.w, i % 10, { born: this.gen }));
    }
    return this;
  }

  member(id) { return this.members.find(m => m.id === id) || null; }

  tournament(k, sorted) {
    if (this.truncFrac > 0) {
      const n = Math.max(2, Math.round(sorted.length * this.truncFrac));
      return sorted[Math.floor(this.rng.float() * n)];
    }
    let best = null;
    for (let i = 0; i < k; i++) {
      const c = sorted[Math.floor(this.rng.float() * sorted.length)];
      if (!best || c.fitness > best.fitness) best = c;
    }
    return best;
  }

  // 全員の fitness を入れてから呼ぶ。次の世代を作る。
  evolve(stageId) {
    const rng = this.rng;
    const mut = this.override || MUTATION[this.mutIdx];
    const sorted = [...this.members].sort((a, b) => b.fitness - a.fitness);
    // 表示用の成績は「飛んだ距離」（選ぶ時はボーナス込みの fitness を使う）
    const dists = this.members.map(m => m.dist ?? m.fitness).sort((a, b) => b - a);
    const best = dists[0];
    const avg = dists.reduce((s, v) => s + v, 0) / dists.length;
    const med = dists[Math.floor(dists.length / 2)];
    const causes = {};
    for (const m of sorted) if (m.cause) causes[m.cause] = (causes[m.cause] || 0) + 1;
    const prevBest = this.bestByStage[stageId] || 0;
    const record = best > prevBest;
    if (record) this.bestByStage[stageId] = best;
    if (best > this.bestEver) this.bestEver = best;
    const div = this.diversity();
    const fam = this.familyCounts();
    this.history.push({ g: this.gen, best, avg, med, st: stageId, div });
    if (this.history.length > 400) this.history.splice(0, this.history.length - 400);
    this.lastSummary = { gen: this.gen, best, avg, med, prevBest, record, causes, div, fam, top: sorted.slice(0, 4).map(m => ({ id: m.id, family: m.family, fitness: m.fitness, dist: m.dist ?? m.fitness })) };

    // ── 次の世代 ──
    const next = [];
    const E = this.eliteCount;
    for (let i = 0; i < E && i < sorted.length; i++) {
      const m = sorted[i];
      next.push(new Member(m.genome, m.family, { id: m.id, born: m.born, elite: true, age: m.age + 1, parents: m.parents, src: m.src, mut: m.mut }));
    }
    if (this.keepOshi && this.oshiId != null && !next.some(m => m.id === this.oshiId)) {
      const o = sorted.find(m => m.id === this.oshiId);
      if (o) next.push(new Member(o.genome, o.family, { id: o.id, born: o.born, elite: true, age: o.age + 1, parents: o.parents, src: o.src, mut: o.mut }));
    }
    const P = this.P;
    const net = this.netTmp;
    while (next.length < this.size) {
      const A = this.tournament(this.tourK, sorted);
      let B = this.tournament(this.tourK, sorted);
      for (let t = 0; t < 4 && B === A; t++) B = this.tournament(this.tourK, sorted);
      const g = new Float32Array(P);
      const src = new Uint8Array(P);
      const mm = new Uint8Array(P);
      if (rng.float() < this.crossRate && B !== A) {
        // ニューロン単位の交叉：隠れニューロンごとに、どちらの親の部品を使うか決める
        const pick = new Uint8Array(this.nHid + 1);
        for (let j = 0; j <= this.nHid; j++) pick[j] = rng.float() < 0.5 ? 0 : 1;
        for (let p = 0; p < P; p++) {
          const s = pick[net.geneNeuron(p)];
          src[p] = s;
          g[p] = s ? B.genome[p] : A.genome[p];
        }
      } else {
        g.set(A.genome);
      }
      // 突然変異
      for (let p = 0; p < P; p++) {
        if (rng.float() < mut.pm) {
          if (rng.float() < 0.06) g[p] = rng.gauss();
          else g[p] += rng.gauss() * mut.sigma;
          if (g[p] > 5) g[p] = 5; else if (g[p] < -5) g[p] = -5;
          mm[p] = 1;
        }
      }
      next.push(new Member(g, A.family, {
        born: this.gen + 1,
        parents: [{ id: A.id, family: A.family, genome: A.genome, dist: A.dist ?? 0 }, { id: B.id, family: B.family, genome: B.genome, dist: B.dist ?? 0 }],
        crossed: B !== A && src.some(v => v === 1),
        src, mut: mm,
      }));
    }
    this.members = next;
    this.gen++;
    return this.lastSummary;
  }

  // 遺伝子のばらつき（多様性）0..1
  diversity() {
    const n = this.members.length;
    if (n < 2) return 0;
    const P = this.P;
    let acc = 0;
    for (let p = 0; p < P; p++) {
      let s = 0, s2 = 0;
      for (let i = 0; i < n; i++) { const v = this.members[i].genome[p]; s += v; s2 += v * v; }
      const mean = s / n;
      acc += Math.sqrt(Math.max(0, s2 / n - mean * mean));
    }
    return Math.min(1, (acc / P) / 0.35);
  }

  familyCounts() {
    const c = new Array(FAMILIES.length).fill(0);
    for (const m of this.members) c[m.family]++;
    return c;
  }

  // おしえたヒナの脳を群れに入れる（一番成績の悪い子と入れ替え）
  inject(genome) {
    let worst = 0;
    for (let i = 1; i < this.members.length; i++) if (this.members[i].fitness < this.members[worst].fitness) worst = i;
    const m = new Member(new Float32Array(genome), TEACH_FAMILY, { born: this.gen, elite: true });
    this.members[worst] = m;
    return m;
  }

  serialize() {
    return {
      v: 1, size: this.size, gen: this.gen, mutIdx: this.mutIdx, keepOshi: this.keepOshi,
      oshiId: this.oshiId, bestEver: this.bestEver, bestByStage: this.bestByStage,
      history: this.history,
      members: this.members.map(m => ({ id: m.id, f: m.family, b: m.born, e: m.elite ? 1 : 0, a: m.age, g: f32ToB64(m.genome) })),
    };
  }

  static deserialize(d) {
    if (!d || !d.members || d.members.length < 2) return null;
    const f = new Flock({ size: d.size });
    if (d.members.length && b64ToF32(d.members[0].g).length !== f.P) return null; // 脳の形が違う
    f.gen = d.gen; f.mutIdx = d.mutIdx ?? 1; f.keepOshi = d.keepOshi ?? true;
    f.oshiId = d.oshiId ?? null; f.bestEver = d.bestEver || 0; f.bestByStage = d.bestByStage || {};
    f.history = d.history || [];
    f.members = d.members.map(o => new Member(b64ToF32(o.g), o.f, { id: o.id, born: o.b, elite: !!o.e, age: o.a || 0 }));
    f.size = f.members.length;
    return f;
  }
}
