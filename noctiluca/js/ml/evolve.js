// 並列世界での進化: 16 の世界に「いまの本能・最高記録・14の変異体」を入れて同時に走らせる
import { SNES } from './snes.js';
import { genomeToRow, rowToGenome, ROW_FLOATS } from '../sim/brain.js';
import { hashSeed } from '../sim/rng.js';

export const SLOT_CENTER = 0;
export const SLOT_ELITE = 1;

export class Evolution {
  constructor(swarm, { stage, layout, row0, seed = 1, sigma0 = 0.3, pairs = null, makeCfg, sigmaVec = null }) {
    this.swarm = swarm;
    this.stage = stage;
    this.layout = layout;
    this.makeCfg = makeCfg;
    this.baseSeed = seed >>> 0;
    this.pairs = pairs ?? Math.floor((swarm.K - 2) / 2);
    const g0 = rowToGenome(row0, layout);
    this.es = new SNES(g0, { sigma0, pairs: this.pairs, seed: hashSeed('es', seed) });
    // 近道（反射）の重みは大きめにゆらして探す
    layout.kind.forEach((k, i) => { if (k === 4) this.es.sigma[i] = sigma0 * 2; });
    // 受けついだ本能は少しだけ、新しい器官の重みは大きくゆらす
    if (sigmaVec) this.es.sigma = Float32Array.from(sigmaVec);
    this.elite = { genome: Float32Array.from(g0), fit: -Infinity };
    this.gen = 0;
    this.history = [];
    this.lastFit = null;
    this.stepsLeft = 0;
    this.episodeSteps = 0;
    this.candidates = [];
    this.behind = 0;
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { this.listeners.forEach((f) => f(ev)); }

  centerRow() { return genomeToRow(this.es.mu, this.layout); }
  eliteRow() { return genomeToRow(this.elite.genome, this.layout); }

  startGeneration() {
    const samples = this.es.ask();
    this.candidates = [Float32Array.from(this.es.mu), Float32Array.from(this.elite.genome), ...samples];
    const rows = this.candidates.map((g) => genomeToRow(g, this.layout));
    const sw = this.swarm;
    sw.setLayout(this.layout);
    sw.setRows(rows);
    this.genSeed = hashSeed(this.baseSeed, 'gen', this.gen);
    const cfg = this.makeCfg(this.genSeed);
    this.cfg = cfg;
    sw.setStage(cfg);
    sw.beaconPath = cfg.beaconPath || null;
    sw.reset(this.genSeed);
    this.episodeSteps = cfg.steps;
    this.stepsLeft = cfg.steps;
    this.emit({ type: 'start', gen: this.gen });
  }

  // n ステップ進める。世代が終わったら true
  advance(n) {
    if (this.stepsLeft <= 0) this.startGeneration();
    const k = Math.min(n, this.stepsLeft);
    this.swarm.step(k);
    this.stepsLeft -= k;
    if (this.stepsLeft <= 0) {
      this.finishGeneration();
      return true;
    }
    return false;
  }

  finishGeneration() {
    const sw = this.swarm;
    const { B, C } = sw.reduce();
    const K = sw.K, P = sw.P, T = this.episodeSteps;
    const fit = [], alive = [], glow = [], moonSync = [], goal = [];
    for (let k = 0; k < K; k++) {
      fit.push(C[k * 4 + 1] / (P * T));
      alive.push(C[k * 4] / P);
      goal.push(B[k * 4 + 3] / P);
      moonSync.push(C[k * 4 + 2] / (P * T));
      glow.push(C[k * 4 + 3] / (P * T));
    }
    const n = 2 + this.pairs * 2;
    const rawFit = fit.slice();
    if (this.fitnessOverride) {
      const f2 = this.fitnessOverride(fit.slice(), { alive, goal });
      if (f2) for (let k = 0; k < n; k++) fit[k] = f2[k];
    }
    this.es.tell(fit.slice(2, n));
    // 最高記録の入れかえ（同じ条件で比べている）
    let bi = 1;
    for (let k = 0; k < n; k++) if (fit[k] > fit[bi]) bi = k;
    if (bi !== SLOT_ELITE) this.elite = { genome: Float32Array.from(this.candidates[bi]), fit: fit[bi] };
    else this.elite.fit = fit[SLOT_ELITE];
    // いまの本能が最高記録から大きく離れつづけたら、最高記録へ戻す
    if (fit[SLOT_CENTER] < fit[SLOT_ELITE] - 0.08 * Math.abs(fit[SLOT_ELITE])) this.behind++;
    else this.behind = 0;
    let restored = false;
    if (this.behind >= 10) {
      this.es.mu = Float32Array.from(this.elite.genome);
      this.behind = 0;
      restored = true;
    }
    const samp = fit.slice(2, n);
    const rec = {
      gen: this.gen,
      center: fit[SLOT_CENTER],
      elite: fit[SLOT_ELITE],
      best: Math.max(...fit.slice(0, n)),
      mean: samp.reduce((a, b) => a + b, 0) / samp.length,
      aliveCenter: alive[SLOT_CENTER],
      aliveBest: alive[bi],
      goalCenter: goal[SLOT_CENTER],
      sigma: this.es.meanSigma(),
      glowCenter: glow[SLOT_CENTER],
      moonSync: moonSync[SLOT_CENTER],
      bestSlot: bi,
      restored,
    };
    this.lastFit = rawFit;
    this.lastAlive = alive;
    this.lastGlow = glow;
    this.lastGoal = goal;
    this.lastSync = moonSync;
    this.history.push(rec);
    this.gen++;
    this.emit({ type: 'end', rec, fit, alive, goal, sync: moonSync });
  }

  // 学習の状態を保存できる形に
  toJSON() {
    return {
      es: this.es.toJSON(),
      elite: { genome: Array.from(this.elite.genome), fit: this.elite.fit },
      gen: this.gen,
      history: this.history.slice(-400),
      baseSeed: this.baseSeed,
    };
  }

  load(o) {
    this.es = SNES.fromJSON(o.es, { pairs: this.pairs, seed: hashSeed('es', o.baseSeed, o.gen) });
    this.elite = { genome: Float32Array.from(o.elite.genome), fit: o.elite.fit };
    this.gen = o.gen;
    this.history = o.history || [];
    this.baseSeed = o.baseSeed;
    this.stepsLeft = 0;
  }
}

export { ROW_FLOATS };
