// methods.js — 4つの学習方式（純粋モジュール）
//   actor   = 生きているあいだの「行動の決め方」（毎ターン呼ばれる）
//   learner = 世代をこえた「学び方」（世代のはじめに創始者を作り、世代の終わりに結果を受けとる）
//
//   ルール        : 手書きの規則。学習も選択もしない（対照群）
//   進化NN        : 脳＝ニューラルネットの重み。生きているあいだは学ばない。世代交代で 選択＋交叉＋突然変異
//   Q学習         : 1つのQ表を仲間全員で共有し、毎ターンの経験で書き直す。選択はしない
//   ランダム＋選択 : まわりを見ずにサイコロで行動。サイコロの偏りだけが遺伝し、世代交代で選択される（交叉なし）
import { ACT, N_ACT, OBS, M } from './defs.js';
import { RNG, clamp, f32ToB64, b64ToF32 } from './util.js';
import * as NN from './nn.js';
import * as Q from './qlearn.js';
import { nextGeneration } from './ga.js';
import { SpeciesBook } from './species.js';

// ================= ルールベース
export const RULE_EAT_MIN = 0.12;
export const RULE_SCENT_MIN = 0.14;
export const RULE_TEXT = [
  '夜で、お腹がすいていなくて、足元に草がない → 眠る',
  `足元に草がある（${RULE_EAT_MIN}以上） → 食べる`,
  'においのする方向がある → いちばん強い方へ歩く',
  'どれでもない → 通れる方へ気ままに歩く（同じ向きを続けやすい）',
];

// out.rule に、どの規則が使われたかを書く
export function ruleDecide(o, rng, lastDir, out) {
  if (o[OBS.DARK] > 0.5 && o[OBS.ENERGY] > 0.3 && o[OBS.HERE] < RULE_EAT_MIN) {
    out.rule = 0;
    return ACT.SLEEP;
  }
  if (o[OBS.HERE] >= RULE_EAT_MIN) {
    out.rule = 1;
    return ACT.EAT;
  }
  let best = -1;
  let bv = RULE_SCENT_MIN;
  for (let d = 0; d < 4; d++) {
    const v = o[OBS.SN + d];
    if (v > bv) {
      bv = v;
      best = d;
    }
  }
  if (best >= 0) {
    out.rule = 2;
    return 1 + best;
  }
  out.rule = 3;
  if (lastDir >= 0 && o[OBS.SN + lastDir] >= 0 && rng.next() < 0.7) return 1 + lastDir;
  let n = 0;
  let pick = -1;
  for (let d = 0; d < 4; d++) {
    if (o[OBS.SN + d] >= 0) {
      n++;
      if (rng.next() * n < 1) pick = d;
    }
  }
  return pick >= 0 ? 1 + pick : ACT.EAT;
}

const RULE_ACTOR = {
  act(c, o, rng) {
    return ruleDecide(o, rng, c.dir, c);
  },
};

// ================= 進化NN
const NN_ACTOR = {
  act(c, o) {
    NN.forward(c.g, o, c.hid, c.out);
    return NN.argmax(c.out, N_ACT);
  },
};

// ================= Q学習
export class QActor {
  constructor(q, visits, st) {
    this.q = q;
    this.visits = visits;
    this.alpha = st.alpha;
    this.gamma = st.gamma;
    this.eps = st.eps;
    this.updates = 0;
    this.tdAbs = 0;
  }
  act(c, o, rng) {
    const s = Q.stateOf(o, c.dir);
    if (c.qs >= 0) {
      const err = Q.tdUpdate(this.q, c.qs, c.qa, c.qr, s, this.alpha, this.gamma);
      this.updates++;
      this.tdAbs += err < 0 ? -err : err;
    }
    let a;
    if (rng.next() < this.eps) {
      a = rng.int(N_ACT);
      c.explore = true;
    } else {
      a = Q.greedy(this.q, s, rng);
      c.explore = false;
    }
    c.qs = s;
    c.qa = a;
    if (this.visits) this.visits[s]++;
    return a;
  }
  reward(c, r) {
    c.qr = r;
  }
  death(c) {
    if (c.qs >= 0) {
      Q.tdUpdate(this.q, c.qs, c.qa, c.qr + Q.DEATH_PENALTY, -1, this.alpha, this.gamma);
      this.updates++;
    }
  }
}

// ================= ランダム＋選択（サイコロ）
export function diceProbs(g, out = new Float32Array(N_ACT)) {
  let mx = -Infinity;
  for (let a = 0; a < N_ACT; a++) if (g[a] > mx) mx = g[a];
  let s = 0;
  for (let a = 0; a < N_ACT; a++) {
    out[a] = Math.exp(g[a] - mx);
    s += out[a];
  }
  for (let a = 0; a < N_ACT; a++) out[a] /= s;
  return out;
}
export function diceCum(g) {
  const p = diceProbs(g);
  const cum = new Float32Array(N_ACT);
  let s = 0;
  for (let a = 0; a < N_ACT; a++) {
    s += p[a];
    cum[a] = s;
  }
  cum[N_ACT - 1] = 1;
  return cum;
}
const DICE_ACTOR = {
  act(c, o, rng) {
    const r = rng.next();
    const cum = c.cum;
    for (let a = 0; a < N_ACT - 1; a++) if (r < cum[a]) return a;
    return N_ACT - 1;
  },
};
const diceDistance = (a, b) => {
  const pa = diceProbs(a);
  const pb = diceProbs(b);
  let s = 0;
  for (let i = 0; i < N_ACT; i++) s += Math.abs(pa[i] - pb[i]);
  return s;
};

// ================= 行動テスト（「行動の獲得」を測る決まった場面）
export const SKILLS = [
  { key: 'eat', ja: '足元の草を食べる', short: '食べる', icon: 'eat' },
  { key: 'follow', ja: 'においをたどる', short: 'たどる', icon: 'nose' },
  { key: 'sleep', ja: '夜は眠る', short: '眠る', icon: 'sleep' },
];
function probe(e, here, sn, se, ss, sw, dark) {
  const o = new Float32Array(9);
  o[OBS.ENERGY] = e;
  o[OBS.HERE] = here;
  o[OBS.SN] = sn;
  o[OBS.SE] = se;
  o[OBS.SS] = ss;
  o[OBS.SW] = sw;
  o[OBS.DARK] = dark;
  o[OBS.CROWD] = 0;
  o[OBS.NOISE] = 0;
  return o;
}
function followProbes() {
  const list = [];
  for (let d = 0; d < 4; d++) {
    const s = [0.04, 0.04, 0.04, 0.04];
    s[d] = 0.55;
    list.push([probe(0.5, 0.02, ...s, 0), 1 + d]);
    const s2 = [0.03, 0.03, 0.03, 0.03];
    s2[d] = 0.45;
    s2[(d + 1) % 4] = -1;
    list.push([probe(0.4, 0.0, ...s2, 0), 1 + d]);
  }
  return list;
}
export const PROBES = [
  [
    [probe(0.45, 0.85, 0.3, 0.3, 0.3, 0.3, 0), ACT.EAT],
    [probe(0.65, 0.55, 0.2, 0.1, 0.25, 0.15, 0), ACT.EAT],
    [probe(0.25, 0.7, 0.5, 0.1, 0.1, -1, 0), ACT.EAT],
  ],
  followProbes(),
  [
    [probe(0.75, 0.0, 0.03, 0.02, 0.03, 0.02, 1), ACT.SLEEP],
    [probe(0.55, 0.02, 0.02, -1, 0.04, 0.01, 1), ACT.SLEEP],
    [probe(0.9, 0.0, -1, 0.02, 0.01, 0.03, 1), ACT.SLEEP],
  ],
];
export function skillScores(L) {
  return PROBES.map((list) => {
    let s = 0;
    for (const [o, a] of list) s += L.skillProb(o, a);
    return s / list.length;
  });
}

// ================= 学び方（learner）
class BaseLearner {
  constructor(m, cfg) {
    this.m = m;
    this.cfg = cfg;
  }
  bodies(n, lab) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ gid: lab.newGid(), g: null, sp: -1, parents: [], elite: false });
    this.current = out;
    return out;
  }
  snapState() {
    return null;
  }
  endSeason() {
    return { born: [], extinct: [] };
  }
  extraStats() {
    return {};
  }
  toJSON() {
    return {};
  }
  loadJSON() {}
}

export class RuleLearner extends BaseLearner {
  makeFounders(n, gen, rng, lab) {
    return this.bodies(n, lab);
  }
  liveActor() {
    return RULE_ACTOR;
  }
  actorFromSnap() {
    return RULE_ACTOR;
  }
  skillProb(o, a) {
    return ruleDecide(o, new RNG(1), -1, {}) === a ? 1 : 0;
  }
}

class EvoLearner extends BaseLearner {
  constructor(m, cfg, book) {
    super(m, cfg);
    this.book = book;
    this.evaluated = null; // 前の世代の結果 [{ g, gid, fit, sp }]
    this.current = [];
  }
  makeFounders(n, gen, rng, lab) {
    let made;
    if (!this.evaluated || this.evaluated.length === 0) {
      made = [];
      for (let i = 0; i < n; i++) made.push({ g: this.randomGenome(rng), parents: [], elite: false });
    } else {
      made = nextGeneration(this.evaluated, n, this.ops(), this.gaOpt(), rng);
    }
    const psp = new Map();
    if (this.evaluated) for (const e of this.evaluated) psp.set(e.gid, e.sp);
    const out = made.map((x) => {
      const p0 = x.parents.length ? psp.get(x.parents[0]) ?? -1 : -1;
      return { gid: lab.newGid(), g: x.g, sp: this.book.assign(x.g, p0, gen), parents: x.parents, elite: x.elite };
    });
    this.current = out;
    return out;
  }
  endSeason(results, gen) {
    this.evaluated = results.map((r) => ({ g: r.g, gid: r.gid, fit: r.fit, sp: r.sp }));
    return this.book.tally(gen, results.map((r) => r.sp));
  }
  liveActor() {
    return this.actor;
  }
  actorFromSnap() {
    return this.actor;
  }
  extraStats() {
    return { nsp: this.book.living().length };
  }
  toJSON() {
    return { species: this.book.toJSON(f32ToB64) };
  }
  loadJSON(o) {
    if (o && o.species) this.book.loadJSON(o.species, b64ToF32);
  }
}

export class NNLearner extends EvoLearner {
  constructor(m, cfg) {
    super(m, cfg, new SpeciesBook('nn', NN.distance, 0.6));
    this.actor = NN_ACTOR;
    this.hid = new Float32Array(NN.N_HID);
    this.out = new Float32Array(NN.N_OUT);
    this.po = new Float32Array(9);
  }
  randomGenome(rng) {
    return NN.randomBrain(rng, this.cfg.nn.init);
  }
  ops() {
    const c = this.cfg.nn;
    return {
      clone: (g) => g.slice(),
      crossover: NN.crossover,
      mutate: (g, rng) => NN.mutate(g, rng, c.rate, c.sigma),
    };
  }
  gaOpt() {
    const c = this.cfg.nn;
    return { elite: c.elite, tour: c.tour, cx: c.cx };
  }
  // 世代の全員・気まぐれ入力3通りで、その行動をとる割合
  skillProb(o, a) {
    const pop = this.evaluated || this.current;
    if (!pop || !pop.length) return 0;
    let hit = 0;
    let n = 0;
    this.po.set(o);
    for (const p of pop) {
      for (const nz of [-0.6, 0, 0.6]) {
        this.po[OBS.NOISE] = nz;
        NN.forward(p.g, this.po, this.hid, this.out);
        if (NN.argmax(this.out, N_ACT) === a) hit++;
        n++;
      }
    }
    return hit / n;
  }
}

export class DiceLearner extends EvoLearner {
  constructor(m, cfg) {
    super(m, cfg, new SpeciesBook('dice', diceDistance, 0.32));
    this.actor = DICE_ACTOR;
    this.tmp = new Float32Array(N_ACT);
  }
  randomGenome(rng) {
    const g = new Float32Array(N_ACT);
    for (let a = 0; a < N_ACT; a++) g[a] = rng.gauss();
    return g;
  }
  ops() {
    const s = this.cfg.dice.sigma;
    return {
      clone: (g) => g.slice(),
      crossover: null,
      mutate: (g, rng) => {
        if (s <= 0) return g;
        for (let a = 0; a < N_ACT; a++) g[a] = clamp(g[a] + rng.gauss() * s, -6, 6);
        return g;
      },
    };
  }
  gaOpt() {
    const c = this.cfg.dice;
    return { elite: c.elite, tour: c.tour, cx: 0 };
  }
  skillProb(o, a) {
    const pop = this.evaluated || this.current;
    if (!pop || !pop.length) return 0;
    let s = 0;
    for (const p of pop) s += diceProbs(p.g, this.tmp)[a];
    return s / pop.length;
  }
  // 世代の平均のサイコロ（表示用）
  meanProbs() {
    const pop = this.evaluated || this.current;
    const m = new Float32Array(N_ACT);
    if (!pop || !pop.length) return m;
    for (const p of pop) {
      const pr = diceProbs(p.g, this.tmp);
      for (let a = 0; a < N_ACT; a++) m[a] += pr[a] / pop.length;
    }
    return m;
  }
}

export class QLearner extends BaseLearner {
  constructor(m, cfg) {
    super(m, cfg);
    this.q = Q.newTable();
    this.visits = new Uint32Array(Q.N_STATES);
    this.updates = 0;
    this.eps = cfg.q.eps0;
    this.live = null;
    this.lastTd = 0;
  }
  makeFounders(n, gen, rng, lab) {
    this.eps = Q.epsAt(gen, this.cfg.q);
    return this.bodies(n, lab);
  }
  // 世代のはじめの表を写しておく（リプレイと「つづきから」で同じ世代をそのまま再現するため）
  snapState() {
    return { q: this.q.slice(), eps: this.eps, alpha: this.cfg.q.alpha, gamma: this.cfg.q.gamma };
  }
  liveActor(st) {
    this.live = new QActor(this.q, this.visits, st);
    return this.live;
  }
  actorFromSnap(st) {
    return new QActor(st.q.slice(), null, st);
  }
  endSeason() {
    if (this.live) {
      this.updates += this.live.updates;
      this.lastTd = this.live.updates ? this.live.tdAbs / this.live.updates : 0;
    }
    return { born: [], extinct: [] };
  }
  skillProb(o, a) {
    return Q.greedyShare(this.q, Q.stateOf(o, -1), a);
  }
  extraStats() {
    let known = 0;
    for (let s = 0; s < Q.N_STATES; s++) if (this.visits[s] > 0) known++;
    return { eps: this.eps, known, td: this.lastTd };
  }
  toJSON() {
    return { visits: Array.from(this.visits), updates: this.updates, lastTd: this.lastTd };
  }
  loadJSON(o) {
    if (!o) return;
    if (o.visits) this.visits.set(o.visits.slice(0, Q.N_STATES));
    this.updates = o.updates || 0;
    this.lastTd = o.lastTd || 0;
  }
}

// 保存しておいた世代のはじめの状態から、その世代の行動の決め方を作り直す（リプレイ用）
export function actorFromSnap(m, st) {
  if (m === M.RULE) return RULE_ACTOR;
  if (m === M.NN) return NN_ACTOR;
  if (m === M.DICE) return DICE_ACTOR;
  return new QActor(st.q.slice(), null, st);
}

export function makeLearner(m, cfg) {
  if (m === M.RULE) return new RuleLearner(m, cfg);
  if (m === M.NN) return new NNLearner(m, cfg);
  if (m === M.Q) return new QLearner(m, cfg);
  return new DiceLearner(m, cfg);
}
