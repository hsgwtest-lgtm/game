// 1試合を決定論的に進める係。
// seed と 2つの脳（またはCPU）が同じなら、どの端末でも同じ試合になる。

import { Env, EV, N_EV, RULE } from './env.js';
import { CpuController } from './bots.js';
import { NetController } from '../ml/policy.js';
import { Rng } from '../core/rng.js';

export const BATTLE_TEMP = 0.6;   // 試合では少しだけ迷いを減らす

// spec: { type:'net', net, temp } / { type:'cpu', key }
export function makeController(spec, seed) {
  const rng = new Rng(seed);
  if (spec.type === 'cpu') return new CpuController(spec.key, rng);
  return new NetController(spec.net, rng, spec.temp ?? BATTLE_TEMP);
}

export class Match {
  constructor({ arena, seed, a, b, logging = true }) {
    this.seed = seed >>> 0;
    this.arena = arena;
    this.env = new Env(arena, this.seed);
    this.env.setLogging(logging);
    this.ctl = [makeController(a, (this.seed ^ 0xA511E9B3) >>> 0), makeController(b, (this.seed ^ 0x5A17C3D1) >>> 0)];
    this.ev = [new Float64Array(N_EV), new Float64Array(N_EV)];
    this.timeline = [];        // 10手ごとの [青のマス, 赤のマス]
    this.lastActs = [0, 0];
  }

  get done() { return this.env.done; }
  get t() { return this.env.t; }

  step() {
    const env = this.env;
    if (env.done) return true;
    const a0 = this.ctl[0].act(env, 0);
    const a1 = this.ctl[1].act(env, 1);
    this.lastActs[0] = a0; this.lastActs[1] = a1;
    env.step(a0, a1);
    for (let i = 0; i < 2; i++) {
      const e = env.ev[i], acc = this.ev[i];
      for (let k = 0; k < N_EV; k++) acc[k] += e[k];
    }
    if (env.t % 10 === 0 || env.done) this.timeline.push([env.score(0), env.score(1)]);
    return env.done;
  }

  runToEnd() { while (!this.env.done) this.step(); return this.result(); }

  result() {
    const env = this.env;
    const s0 = env.score(0), s1 = env.score(1);
    return {
      scores: [s0, s1],
      winner: s0 > s1 ? 0 : s1 > s0 ? 1 : -1,
      hash: env.hash(),
      floor: env.floor,
      stats: this.ev.map(e => ({
        paint: e[EV.PAINT], steal: e[EV.STEAL], lost: e[EV.LOST], hit: e[EV.HIT], stunned: e[EV.STUNNED],
        item: e[EV.ITEM], shot: e[EV.SHOT], bump: e[EV.BUMP], idle: e[EV.IDLE], explore: e[EV.EXPLORE],
        approach: e[EV.APPROACH],
      })),
      ev: this.ev.map(e => Array.from(e)),
      timeline: this.timeline.slice(),
    };
  }
}

export { RULE };
