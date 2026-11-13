// 方策（アームの頭脳の使い方）: ネットの出力8つを3つの行動に読み替える・複数の作業場を同時に動かす・腕前を測る
//   出力 0..2 = 肩（−/止/＋）、3..5 = ひじ（−/止/＋）、6..7 = グリッパー（開く/にぎる）
import { Env, SNAP, SVEC, DEFAULT_REWARD } from './env.js';
import { Raster, OBS } from './raster.js';
import { makeRng } from './rng.js';
import { PROP } from './nn.js';

export const NOUT = 8;
export const HEAD_OFF = [0, 3, 6];
export const HEAD_N = [3, 3, 2];

// 点数 z（8つ）→ 確率 p（8つ。頭ごとに足して1）
export function probs(z, zo, p, po = 0) {
  for (let h = 0; h < 3; h++) {
    const o = HEAD_OFF[h], n = HEAD_N[h];
    let mx = -Infinity;
    for (let k = 0; k < n; k++) if (z[zo + o + k] > mx) mx = z[zo + o + k];
    let s = 0;
    for (let k = 0; k < n; k++) { const e = Math.exp(z[zo + o + k] - mx); p[po + o + k] = e; s += e; }
    for (let k = 0; k < n; k++) p[po + o + k] /= s;
  }
  return p;
}

const _p = new Float64Array(NOUT);
const _z = new Float64Array(NOUT);

// 確率どおりにくじ引きで選ぶ。act[ao..ao+2] に書き、選んだ行動の log確率 を返す
export function sample(z, zo, rng, act, ao, temp = 1) {
  if (temp !== 1) { for (let k = 0; k < NOUT; k++) _z[k] = z[zo + k] / temp; probs(_z, 0, _p); } else probs(z, zo, _p);
  let lp = 0;
  for (let h = 0; h < 3; h++) {
    const o = HEAD_OFF[h], n = HEAD_N[h];
    let u = rng(), k = 0;
    for (; k < n - 1; k++) { u -= _p[o + k]; if (u < 0) break; }
    act[ao + h] = k; lp += Math.log(_p[o + k] + 1e-12);
  }
  return lp;
}

// いちばん点数の高い行動を選ぶ
export function greedy(z, zo, act, ao) {
  for (let h = 0; h < 3; h++) {
    const o = HEAD_OFF[h], n = HEAD_N[h];
    let best = 0;
    for (let k = 1; k < n; k++) if (z[zo + o + k] > z[zo + o + best]) best = k;
    act[ao + h] = best;
  }
}

// 複数の作業場（環境）をまとめて持ち、「AIの目」の画像をまとめて描く
export class Arena {
  constructor(stage, n, seed = 1, reward = DEFAULT_REWARD) {
    this.stage = stage; this.n = n;
    this.envs = [];
    for (let i = 0; i < n; i++) this.envs.push(new Env(stage, (seed * 7919 + i * 104729) >>> 0, reward));
    this.snaps = new Float32Array(n * SNAP);
    this.obs = new Uint8Array(n * OBS);
    this.offs = Int32Array.from({ length: n }, (_, i) => i * OBS);
    this.svec = new Float32Array(n * SVEC);
    this.prop = new Float32Array(n * PROP);
    this.ras = new Raster();
  }
  observe(withState = false) {
    for (let i = 0; i < this.n; i++) {
      const e = this.envs[i];
      e.snapshot(this.snaps, i * SNAP);
      this.ras.render(this.snaps, i * SNAP, this.obs, i * OBS);
      this.prop[i * PROP] = e.a1; this.prop[i * PROP + 1] = e.a2; this.prop[i * PROP + 2] = e.grip;
      if (withState) this.envs[i].stateVec(this.svec, i * SVEC);
    }
  }
}

// 腕前を測る: 決まった出題（seed から作る）を episodes 回。行動は確率どおりのくじ引き（乱数も seed で固定するので、
// 同じ頭脳なら何度受けても同じ結果になる）。tick() で少しずつ進められる
export class Evaluator {
  constructor(net, stage, episodes, seed, opts = {}) {
    this.net = net; this.episodes = episodes; this.seed = seed; this.opts = opts;
    this.par = Math.min(opts.par || 20, episodes);
    this.arena = new Arena(stage, this.par, 1);
    this.rng = makeRng((seed ^ 0x5bd1e995) >>> 0);
    this.act = new Uint8Array(3);
    this.epi = new Int32Array(this.par);
    this.results = new Int8Array(episodes).fill(-1);   // -1 まだ / 0 失敗 / 1 成功
    this.next = 0; this.finished = 0; this.ok = 0; this.steps = 0;
    for (let i = 0; i < this.par; i++) this._assign(i);
  }
  _assign(i) {
    if (this.next >= this.episodes) { this.epi[i] = -1; return; }
    this.epi[i] = this.next;
    const e = this.arena.envs[i];
    e.setSeed((this.seed + Math.imul(this.next + 1, 2654435761)) >>> 0); e.reset();
    this.next++;
  }
  get done() { return this.finished >= this.episodes; }
  get rate() { return this.ok / this.episodes; }
  tick() {
    if (this.done) return;
    const a = this.arena, par = this.par, act = this.act, o = this.opts;
    a.observe();
    const z = this.net.forward(a.obs, a.offs, par, a.prop);
    for (let i = 0; i < par; i++) {
      if (this.epi[i] < 0) continue;
      const e = a.envs[i];
      if (o.greedy) greedy(z, i * NOUT, act, 0); else sample(z, i * NOUT, this.rng, act, 0, o.temp || 1);
      e.step(act[0] - 1, act[1] - 1, act[2]);
      if (e.done) {
        this.finished++; this.results[this.epi[i]] = e.success ? 1 : 0;
        if (e.success) { this.ok++; this.steps += e.t; }
        this._assign(i);
      }
    }
  }
}

export function evaluate(net, stage, episodes, seed, opts = {}) {
  const ev = new Evaluator(net, stage, episodes, seed, opts);
  while (!ev.done) ev.tick();
  return { rate: ev.rate, steps: ev.ok ? ev.steps / ev.ok : 0 };
}
