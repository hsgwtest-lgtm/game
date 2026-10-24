// 対戦: すもう（同じ世界でぶつかり合う）
//   2匹を向かい合わせに置き、それぞれの神経系に「相手のいる向き」を目標として与える。
//   歩くことを覚えた生き物は、そのまま相手に向かって進み、押し合いになる。
//   土俵（円）の外に重心が出るか、倒れたら負け。時間切れは中心に近いほうの勝ち（判定）。
//   決定論なので、同じ2匹・同じ東西なら、どの端末でも同じ取組になる。

import { World, Creature, FPS, DT } from './physics.js';
import { Nerves } from './nerves.js';
import { makeTerrain } from './terrain.js';
import { PI } from './dmath.js';

export const SUMO_T = 20;

export class SumoBout {
  // fighters: [{ model, genes }, { model, genes }]
  constructor(fighters, opts = {}) {
    this.models = fighters.map(f => f.model);
    const L = (m) => Math.max(m.size.x, m.size.h, 0.2);
    this.R = opts.R || Math.max(1.2, 1.0 + 0.9 * Math.max(L(this.models[0]), L(this.models[1])));
    this.terrain = makeTerrain('flat');
    this.world = new World(this.terrain, {});
    this.T = opts.T || SUMO_T;
    const gap = opts.gap !== undefined ? opts.gap : 0.25;
    this.cs = [];
    this.nv = [];
    fighters.forEach((f, k) => {
      const m = f.model;
      const sgn = k === 0 ? -1 : 1;
      const c = new Creature(m, { friction: 0.9 });
      c.place(0, 0, k === 0 ? 0 : PI, undefined, 0);
      // 体の前の端が、土俵の中心から gap/2 のところに来るように（東は向きが逆）
      const shift = sgn * (gap / 2 + m.size.maxX);
      for (let i = 0; i < c.n; i++) { c.pos[3 * i] += shift; c.pp[3 * i] += shift; }
      this.world.add(c);
      const nv = new Nerves(m, f.genes, {});
      nv.goal = [-sgn, 0, 0];
      const restY = c.pos[3 * m.sense + 1];
      c.spinal = (cc, h) => nv.spinal(cc, h);
      c.measureJoints();
      nv.think(c, 0);
      nv.restY = restY;
      nv.tall = restY > 0.25;
      this.cs.push(c); this.nv.push(nv);
    });
    this.frame = 0;
    this.result = null;
    this.out = [0, 0];      // 土俵の外に出ていたフレーム数
    this.down = [0, 0];     // 倒れていたフレーム数
    this.touched = false;
    this.contactFrames = 0;
  }

  get t() { return this.frame / FPS; }
  get done() { return !!this.result; }

  step() {
    if (this.result) return;
    const [a, b] = this.cs, [na, nb] = this.nv;
    // 相手のいる向き（水平）
    for (let k = 0; k < 2; k++) {
      const me = this.nv[k], op = this.nv[1 - k];
      const dx = op.com[0] - me.com[0], dz = op.com[2] - me.com[2];
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l > 1e-6) { me.goal[0] = dx / l; me.goal[2] = dz / l; }
    }
    na.think(a, DT); nb.think(b, DT);
    a.hitOther = 0; b.hitOther = 0;
    this.world.step();
    this.frame++;
    if (a.hitOther) { this.touched = true; this.contactFrames++; }
    // 判定
    const R = this.R;
    for (let k = 0; k < 2; k++) {
      const nv = this.nv[k];
      const r = Math.sqrt(nv.com[0] * nv.com[0] + nv.com[2] * nv.com[2]);
      this.out[k] = r > R ? this.out[k] + 1 : 0;
      const c = this.cs[k];
      const sy = c.pos[3 * this.models[k].sense + 1];
      const fell = nv.tilt > 1.1 || (nv.tall && sy < 0.4 * nv.restY);
      this.down[k] = fell ? this.down[k] + 1 : 0;
    }
    const lostOut = this.out.map(v => v > 6), lostDown = this.down.map(v => v > 18);
    const lost = [lostOut[0] || lostDown[0], lostOut[1] || lostDown[1]];
    if (lost[0] || lost[1]) {
      let winner;
      if (lost[0] && lost[1]) winner = -1;
      else winner = lost[0] ? 1 : 0;
      const loser = winner === -1 ? 0 : 1 - winner;
      let kimarite;
      if (winner === -1) kimarite = '同体';
      else if (lostOut[loser]) kimarite = this.touched ? '押し出し' : '勇み足';
      else kimarite = this.touched ? '突き落とし' : '自滅';
      this.result = { winner, kimarite, t: this.t };
      return;
    }
    if (this.frame >= this.T * FPS) {
      const r = this.nv.map(nv => Math.sqrt(nv.com[0] * nv.com[0] + nv.com[2] * nv.com[2]));
      const winner = Math.abs(r[0] - r[1]) < 0.02 ? -1 : r[0] < r[1] ? 0 : 1;
      this.result = { winner, kimarite: winner === -1 ? '引き分け' : '判定', t: this.t };
    }
  }

  run() { while (!this.result) this.step(); return this.result; }
}
