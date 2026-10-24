// 1回の「試し」（エピソード）: 地形の上に生き物を置き、神経系で動かして成績をはかる
// ワーカーでも画面でも同じコードを使う（決定論なので、同じ遺伝子なら寸分違わず同じ動き）

import { World, Creature, FPS, DT } from './physics.js';
import { Nerves } from './nerves.js';
import { makeTerrain } from './terrain.js';

export const DEFAULT_T = 10;

export function normalizeEnv(env = {}) {
  return {
    terrain: env.terrain || 'flat',
    water: !!env.water,
    gravity: env.gravity || 1,
    friction: env.friction || 1,
    shallow: +env.shallow || 0,
    deep: !!env.deep,
    goal: env.goal || 'distance',
    T: Math.max(2, Math.min(30, env.T || DEFAULT_T)),
    assist: Math.max(0, Math.min(1, env.assist || 0)),
    vstar: env.vstar,
    vcap: env.vcap,
    seed: env.seed | 0,
    nv: env.nv || null,
  };
}

export class Episode {
  constructor(model, genes, envIn, opts = {}) {
    const env = this.env = normalizeEnv(envIn);
    this.model = model;
    this.terrain = makeTerrain(env.terrain, env);
    const waterLevel = this.terrain.water;
    this.world = new World(this.terrain, {
      gravity: 9.81 * env.gravity,
      water: env.water || waterLevel ? { level: waterLevel || (() => model.size.h + 0.6) } : null,
    });
    const spawnY = env.water && !waterLevel ? 0.3 : undefined;
    this.c = this.world.add(new Creature(model, { x: 0, z: 0, y: spawnY !== undefined ? spawnY - model.minY + 0.0 : undefined, friction: 0.9 * env.friction }));
    if (spawnY === undefined) this.c.place(0, 0, 0, undefined, this.terrain.h(0, 0));
    this.nerves = new Nerves(model, genes, { vstar: env.vstar, ...(env.nv || {}) });
    this.nerves.assist = env.assist;
    const c = this.c, nv = this.nerves;
    c.spinal = (cc, h) => nv.spinal(cc, h);
    this.restSenseY = c.pos[3 * model.sense + 1] - this.terrain.h(0, 0);
    this.world.extForces = (cc, h) => nv.support(cc, h, this.restSenseY);
    c.measureJoints();
    nv.think(c, 0);
    this.x0 = nv.com[0]; this.z0 = nv.com[2];
    this.frame = 0;
    this.maxFrames = Math.round(env.T * FPS);
    this.fell = false;
    this.fellAt = -1;
    this.energy = 0;
    this.maxH = 0;
    this.upright = 0;
    this.contactFrames = 0;
    this.onFrame = opts.onFrame || null;
    this.fallTilt = opts.fallTilt || (env.water ? 9 : 0.95);
    this.tall = this.restSenseY > 0.25;
    this.credit = 0;          // 姿勢を保ったまま進んだ距離
    this.lastX = this.x0;
    this.walk = env.goal === 'walk';
    this.vcap = env.vcap || 1.4;  // 「あるく」目標: これより速く進んでも点にならない
    this.yawSum = 0;
    this.limitSum = 0;        // 関節を可動域のはしに押しつけていた時間（関節の負担）
    // 関節の負担の減点は「歩く」目標のときだけ（はやさの勝負では、関節をはしまで使ってもよい）
    this.limW = env.nv && env.nv.limW !== undefined ? env.nv.limW : (this.walk ? 0.35 : 0);
  }

  get done() { return this.frame >= this.maxFrames || this.fell; }
  get t() { return this.frame / FPS; }
  get progress() { return this.nerves.com[0] - this.x0; }

  step() {
    if (this.done) return;
    const c = this.c, nv = this.nerves, model = this.model;
    nv.think(c, DT);
    this.world.step();
    this.frame++;
    // 筋肉のエネルギー（体積 × 活性度²）
    let e = 0;
    for (let m = 0; m < c.nm; m++) { const a = c.act[m]; e += c.mFmax[m] * c.mLfib[m] * a * a; }
    this.energy += e * DT;
    const S = model.sense;
    const sy = c.pos[3 * S + 1] - this.terrain.h(c.pos[3 * S], c.pos[3 * S + 2]);
    if (sy > this.maxH) this.maxH = sy;
    if (nv.tilt < 0.5) this.upright++;
    // 進んだ距離は、胴がまっすぐなほど満額（傾いたまま転がる・座りこんで進むのは割り引く）
    const x = nv.com[0];
    const tilt = nv.tilt;
    const t0 = this.walk ? 0.15 : 0.35, t1 = this.walk ? 0.6 : 0.9;
    const wgt = this.env.water ? 1 : tilt < t0 ? 1 : tilt > t1 ? 0 : 1 - (tilt - t0) / (t1 - t0);
    const hgt = !this.tall ? 1 : sy > 0.75 * this.restSenseY ? 1 : sy < 0.5 * this.restSenseY ? 0 : (sy - 0.5 * this.restSenseY) / (0.25 * this.restSenseY);
    let dx = x - this.lastX;
    if (this.walk && dx > this.vcap * DT) dx = this.vcap * DT;
    this.credit += dx * wgt * hgt;
    const ye = nv.headingErr;
    this.yawSum += (ye < 0 ? -ye : ye) * DT;
    // 関節の負担: 可動域のはし（2.5°以内）にいる軸の数 × 時間
    if (this.limW > 0) {
      let k = 0;
      for (const d of model.dofs) {
        const th = c.jang[3 * d.joint + d.axis];
        if (th < d.lo + 0.044 || th > d.hi - 0.044) k++;
      }
      this.limitSum += k * DT;
    }
    this.lastX = x;
    // 倒れたか
    if (!this.env.water) {
      if (nv.tilt > this.fallTilt || (this.tall && sy < 0.4 * this.restSenseY)) { this.fell = true; this.fellAt = this.frame; }
    }
    let bad = false;
    for (let i = 0; i < c.pos.length; i++) if (!(Math.abs(c.pos[i]) < 1e4)) { bad = true; break; }
    if (bad) { this.fell = true; this.fellAt = this.frame; this.exploded = true; }
    if (this.onFrame) this.onFrame(this);
  }

  result() {
    const model = this.model, nv = this.nerves;
    const M = model.mass, H = Math.max(0.1, model.size.h);
    const dist = this.exploded ? -1 : this.progress;
    const drift = nv.com[2] - this.z0;
    const time = this.frame / FPS;
    const Erel = this.energy / (M * 9.81 * H) / Math.max(1, time);
    let fit;
    if (this.env.goal === 'height') fit = this.maxH;
    else fit = this.credit - 0.15 * Math.abs(drift);
    // 立っていられた時間のごほうび（背の高い体だけ。倒れずにいることを覚える足がかり）
    if (this.tall && !this.env.water) fit += 0.15 * Math.sqrt(9.81 * H) * time;
    if (this.walk) fit -= 0.25 * Erel * time / this.env.T + 0.15 * this.yawSum;
    fit -= this.limW * this.limitSum;
    fit -= 0.02 * Erel;
    if (this.fell) fit -= 0.5 + 0.5 * (1 - time / this.env.T);
    fit -= 0.3 * nv.assistWork / (M * H);
    return {
      fitness: this.exploded ? -10 : fit, dist, drift, time, fell: this.fell, energy: Erel,
      upright: this.upright / Math.max(1, this.frame), assist: this.env.assist, maxH: this.maxH, credit: this.credit,
      speed: dist / Math.max(0.5, time),
    };
  }
}

export function evaluate(model, genes, env, opts = {}) {
  const ep = new Episode(model, genes, env, opts);
  while (!ep.done) ep.step();
  return ep.result();
}
