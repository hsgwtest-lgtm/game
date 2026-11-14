// evaluate.js — 腕前テスト（純粋モジュール）
//   学習を止めた状態の方策を、決まったテスト用シーズン（同じ島・同じ出発地点・同じ乱数）で走らせて、
//   家族あたりの草の量を測る。Q学習は表を写して α=0・ε=0.03（知っていることで動き、ごくたまに試す）、
//   進化NN・ランダム＋選択はいまの世代の遺伝子をそのまま使う。ルールは何度測っても同じ値になる（対照）
import { RNG, hash32, mean } from './util.js';
import { DAY_TICKS } from './world.js';
import { M } from './defs.js';
import { Island, actorFromSnap } from './sim.js';

export const EVAL_SEEDS = [101, 202, 303, 404];
export const EVAL_EPS = 0.03; // Q学習はテストでも、ごくたまに試す（決まった行動のくり返しで動けなくなるのを防ぐ）

// 方式のいまの状態（遺伝子の集団、またはQ表）を取り出す
export function policyOf(lab, m) {
  const L = lab.learnerOf(m);
  if (!L) return null;
  if (m === M.Q) return { m, q: L.q.slice(), gamma: lab.cfg.q.gamma };
  if (m === M.NN || m === M.DICE) return { m, genomes: L.current.map((f) => f.g) };
  return { m };
}

// 学習する前の状態（世代0の集団・空のQ表）を作る。比較用
export function initialPolicyOf(lab, m) {
  if (m === M.Q) return { m, q: new Float32Array(lab.learnerOf(m).q.length), gamma: lab.cfg.q.gamma };
  if (m === M.NN || m === M.DICE) {
    const snap0 = lab.firstSnap ? lab.firstSnap[m] : null;
    if (snap0) return { m, genomes: snap0 };
  }
  return { m };
}

export function evaluatePolicy(lab, pol, opt = {}) {
  const seeds = opt.seeds || EVAL_SEEDS;
  const n = opt.founders || lab.cfg.founders;
  const days = opt.days || lab.cfg.days;
  const ticks = days * DAY_TICKS;
  const fakeLab = { terrain: lab.terrain };
  const m = pol.m;
  const fits = [];
  const lives = [];
  const births = [];
  for (const s of seeds) {
    const rng = new RNG(hash32(lab.cfg.seed, s, 0xe7a1));
    const land = Array.from(lab.terrain.land);
    rng.shuffle(land);
    const founders = [];
    for (let i = 0; i < n; i++) {
      const g = pol.genomes && pol.genomes.length ? pol.genomes[i % pol.genomes.length] : null;
      founders.push({ m, slot: i, gid: i + 1, g, sp: -1, parents: [], elite: false });
    }
    const st = m === M.Q ? { q: pol.q, eps: EVAL_EPS, alpha: 0, gamma: pol.gamma } : null;
    const snap = { gen: 0, seed: hash32(lab.cfg.seed, s, 0xe7a2), island: 0, methods: [m], founders, states: { [m]: st }, counts: { [m]: n }, starts: Int32Array.from(land.slice(0, n)) };
    const isl = new Island(fakeLab, 0, [m]);
    const actors = [];
    actors[m] = actorFromSnap(m, st);
    isl.begin(snap, actors);
    for (let t = 0; t < ticks; t++) isl.step();
    isl.finish();
    fits.push(mean(isl.fams.map((f) => f.food)));
    lives.push(mean(isl.fams.map((f) => f.founderLife)) / DAY_TICKS);
    births.push(isl.stat[m].births);
  }
  return { fit: mean(fits), life: mean(lives), births: mean(births), perSeed: fits };
}
