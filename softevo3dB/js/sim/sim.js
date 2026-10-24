// 1回の「試し」（エピソード）: 地形の上に生き物を置き、神経系で動かして成績をはかる
// ワーカーでも画面でも同じコードを使う（決定論なので、同じ遺伝子なら寸分違わず同じ動き）

import { World, Creature, FPS, DT } from './physics.js';
import { Nerves } from './nerves.js';
import { makeTerrain } from './terrain.js';
import { datan2, dsin, dcos } from './dmath.js';
import { GaitRecorder, refAt } from './gait.js';

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
    this.nerves = new Nerves(model, genes, { vstar: env.vstar, mimic: env.goal === 'human', ...(env.nv || {}) });
    this.nerves.assist = env.assist;
    const c = this.c, nv = this.nerves;
    c.spinal = (cc, h) => nv.spinal(cc, h);
    this.restSenseY = c.pos[3 * model.sense + 1] - this.terrain.h(0, 0);
    this.world.extForces = (cc, h) => nv.support(cc, h, this.restSenseY);
    // 「ヒトの歩き方をまねる」: お手本の歩きの途中の姿勢と速さから始める（止まった姿勢から一歩目を出すのはむずかしいので）
    if (env.goal === 'human' && nv.mimic.length && !(env.nv && env.nv.noRSI)) startFromReference(this, model, c, nv, env);
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
    this.walk = env.goal === 'walk' || env.goal === 'human';
    // 「ヒトの歩き方をまねる」: 股・ひざ・足首の角度の記録をとり、最後にヒトの歩行とくらべる
    this.rec = env.goal === 'human' ? new GaitRecorder(model, this.maxFrames + 2) : null;
    if (this.rec && !this.rec.biped) this.rec = null;
    this.vcap = env.vcap || 1.4;  // 「あるく」目標: これより速く進んでも点にならない
    this.yawSum = 0;
    this.limitSum = 0;        // 関節を可動域のはしに押しつけていた時間（関節の負担）
    this.limW = env.nv && env.nv.limW !== undefined ? env.nv.limW : 0.35;
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
    if (this.rec) this.rec.record(this);
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
    fit -= this.limW * this.limitSum * (this.walk ? 1 : 0.4);
    let human = null;
    if (this.rec && this.rec.n > FPS * 2) {
      const hm = this.rec.compareHuman(Math.floor(this.rec.n * 0.25));
      human = hm ? hm.total : 0;
      fit += 0.9 * this.env.T * (human / 100) * (time / this.env.T);
    }
    else fit -= 0.02 * Erel;
    if (this.fell) fit -= 0.5 + 0.5 * (1 - time / this.env.T);
    fit -= 0.3 * nv.assistWork / (M * H);
    return {
      fitness: this.exploded ? -10 : fit, dist, drift, time, fell: this.fell, energy: Erel,
      upright: this.upright / Math.max(1, this.frame), assist: this.env.assist, maxH: this.maxH, credit: this.credit,
      speed: dist / Math.max(0.5, time), human,
    };
  }
}

export function evaluate(model, genes, env, opts = {}) {
  const ep = new Episode(model, genes, env, opts);
  while (!ep.done) ep.step();
  return ep.result();
}

// お手本の途中の姿勢（右足が立脚の中ほど）に体を曲げ、前向きの速さを与える
function startFromReference(ep, model, c, nv, env) {
  const q0 = 0.32;                                   // 右足: 周期の32%（立脚の中ほど）
  const pairPsi = nv.pairPsi[0] || 0;
  nv.phase = (q0 * 2 * Math.PI + pairPsi) % (2 * Math.PI);
  nv.time = 10;                                       // 動きはじめのゆるやかな立ち上がりはしない
  nv.ramp = 1;
  const order = nv.mimic.slice().sort((a, b) => model.dofs[a.dof].joint - model.dofs[b.dof].joint);
  for (const m of order) {
    const d = model.dofs[m.dof];
    const jo = model.joints[d.joint];
    let q = (nv.phase + nv.ph[d.i] - (nv.legPair[d.i] >= 0 ? nv.pairPsi[nv.legPair[d.i]] : 0)) / (2 * Math.PI);
    q -= Math.floor(q);
    const ang = m.sign * refAt(m.kind, q * 100) * Math.PI / 180;
    // 関節の位置と軸（いまの姿勢）
    const P = jo.parent, o = 4 * P;
    const J = rot(c.q, o, jo.rP); J[0] += c.pos[3 * P]; J[1] += c.pos[3 * P + 1]; J[2] += c.pos[3 * P + 2];
    const qJ = qmul([c.q[o], c.q[o + 1], c.q[o + 2], c.q[o + 3]], jo.qJP);
    const ax = rotq(qJ, d.axis === 0 ? [1, 0, 0] : d.axis === 1 ? [0, 1, 0] : [0, 0, 1]);
    const h = ang / 2, sn = dsin(h);
    const R = [dcos(h), ax[0] * sn, ax[1] * sn, ax[2] * sn];
    for (const bi of d.sub) {
      const r = [c.pos[3 * bi] - J[0], c.pos[3 * bi + 1] - J[1], c.pos[3 * bi + 2] - J[2]];
      const r2 = rotq(R, r);
      c.pos[3 * bi] = J[0] + r2[0]; c.pos[3 * bi + 1] = J[1] + r2[1]; c.pos[3 * bi + 2] = J[2] + r2[2];
      const qb = qmul(R, [c.q[4 * bi], c.q[4 * bi + 1], c.q[4 * bi + 2], c.q[4 * bi + 3]]);
      c.q[4 * bi] = qb[0]; c.q[4 * bi + 1] = qb[1]; c.q[4 * bi + 2] = qb[2]; c.q[4 * bi + 3] = qb[3];
    }
  }
  // 地面に下ろす（いちばん低い接触点を地面へ）
  let low = 1e9;
  for (let i = 0; i < c.n; i++) {
    for (let k = c.featStart[i]; k < c.featStart[i + 1]; k++) {
      const p = rot(c.q, 4 * i, [c.feat[4 * k], c.feat[4 * k + 1], c.feat[4 * k + 2]]);
      const y = c.pos[3 * i + 1] + p[1] - c.feat[4 * k + 3] - ep.terrain.h(c.pos[3 * i] + p[0], c.pos[3 * i + 2] + p[2]);
      if (y < low) low = y;
    }
  }
  const v0 = Math.min(nv.vstar, 1.4);
  for (let i = 0; i < c.n; i++) {
    c.pos[3 * i + 1] -= low - 0.002;
    c.v[3 * i] = v0; c.v[3 * i + 1] = 0; c.v[3 * i + 2] = 0;
    c.w[3 * i] = 0; c.w[3 * i + 1] = 0; c.w[3 * i + 2] = 0;
  }
  c.pp.set(c.pos); c.pq.set(c.q);
}
function rot(q, o, v) {
  const w = q[o], x = q[o + 1], y = q[o + 2], z = q[o + 3];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const rotq = (q, v) => rot(q, 0, v);
function qmul(a, b) {
  return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}
