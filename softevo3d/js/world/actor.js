// 画面の中で生き物を動かす（メインスレッドでのシミュレーション＋メッシュ）
// 物理は決定論的なので、ワーカーで評価したときと寸分違わず同じ動きを再生できる。

import { Creature, FPS, EVAL_FRAMES } from '../sim/creature.js';
import { VoxMesh } from './voxmesh.js';

export class Actor {
  // opts: { ghost: 色 | null, density, z: レーンのずらし, eyes }
  constructor(world, body, L, genome, env, opts = {}) {
    this.world = world;
    this.body = body;
    this.L = L;
    this.opts = opts;
    this.z = opts.z || 0;
    this.mesh = new VoxMesh(body, { ghost: opts.ghost ?? null, density: opts.density, eyes: opts.eyes });
    world.actors.add(this.mesh.group);
    this.acc = 0;
    this.reset(genome, env);
  }

  reset(genome = this.genome, env = this.env) {
    this.genome = genome instanceof Float64Array ? genome : Float64Array.from(genome);
    this.env = env;
    this.c = new Creature(this.body, this.L, this.genome, env);
    this.acc = 0;
    this.done = false;
    this.sync();
  }

  get frame() { return this.c.frame; }
  get t() { return this.c.frame / FPS; }
  get distance() { return this.c.distance; }
  get com() { return this.c.com; }

  // 1フレーム分（1/60秒）進める。max まで来たら止まる
  stepFrames(n, max = EVAL_FRAMES) {
    for (let i = 0; i < n; i++) {
      if (this.c.frame >= max || this.c.st.exploded) { this.done = true; break; }
      this.c.step();
      if (this.onStep) this.onStep(this.c);
    }
    if (this.c.frame >= max) this.done = true;
  }

  sync(time = 0) {
    this.mesh.update(this.c.pos, this.c.act, 0, 0, this.z, time);
  }

  setVisible(v) { this.mesh.setVisible(v); }

  dispose() {
    this.world.actors.remove(this.mesh.group);
    this.mesh.dispose();
  }
}

// 実時間 dt と再生速度から、このフレームで進めるシミュレーションのフレーム数
export class Clock {
  constructor() { this.acc = 0; }
  frames(dt, speed = 1, cap = 16) {
    this.acc += dt * FPS * speed;
    let n = Math.floor(this.acc);
    if (n > cap) { n = cap; this.acc = 0; }
    this.acc -= n;
    return n;
  }
}
