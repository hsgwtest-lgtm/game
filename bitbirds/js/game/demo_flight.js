// 背景用のデモ飛行（タイトル・メニューの後ろで博士のヒナたちが飛ぶ）
// ついでに、どの画面でも使う「固定ステップで進める」小道具 Stepper もここに置く。

import { Session, Bird } from '../sim/flight.js';
import { STAGES, FAMILIES, WORLD } from '../core/config.js';
import { MLP, b64ToF32 } from '../ml/nn.js';
import { DEMO_GENOME } from './demo.js';
import { RNG } from '../core/rng.js';
import { N_IN } from '../sim/flight.js';
import { NET } from '../core/config.js';

export class Stepper {
  constructor() { this.acc = 0; this.alpha = 1; }
  // 実時間 dt × 倍速 speed ぶんだけ step() を呼ぶ。重い時は maxMs で打ち切る
  run(dt, speed, step, maxMs = 12) {
    this.acc += dt * speed;
    const t0 = performance.now();
    let n = 0;
    while (this.acc >= WORLD.DT) {
      step();
      this.acc -= WORLD.DT;
      n++;
      if ((n & 3) === 0 && performance.now() - t0 > maxMs) { this.acc = Math.min(this.acc, WORLD.DT); break; }
    }
    this.alpha = Math.min(1, this.acc / WORLD.DT);
    return n;
  }
  reset() { this.acc = 0; this.alpha = 1; }
}

export function demoGenome() {
  try {
    const g = b64ToF32(DEMO_GENOME);
    if (g.length === MLP.paramCount(N_IN, NET.hid, NET.out)) return g;
  } catch (e) { /* noop */ }
  return null;
}

export class DemoFlight {
  constructor(app) {
    this.app = app;
    this.rng = new RNG();
    this.base = demoGenome();
    this.stepper = new Stepper();
    this.session = null;
    this.stageIdx = 0;
    this.camTimer = 0;
    this.dirty = true;      // ほかの画面が3Dワールドを使ったら true
  }

  // 背景として使う画面が呼ぶ：必要ならデモをやり直す
  ensure(stageIdx = null) {
    if (!this.session || this.dirty) this.start(stageIdx);
  }

  start(stageIdx = null) {
    const app = this.app;
    this.stageIdx = stageIdx ?? this.rng.int(0, STAGES.length - 1);
    const st = STAGES[this.stageIdx];
    this.dirty = false;
    app.world.setTheme(st.theme);
    app.world.setGoal(null);
    this.session = new Session(st, (this.rng.float() * 2 ** 32) >>> 0, { maxDist: 2000 });
    const n = 9;
    for (let i = 0; i < n; i++) {
      const net = new MLP(N_IN, NET.hid, NET.out);
      if (this.base) {
        net.w.set(this.base);
        if (i > 0) for (let p = 0; p < net.size; p++) if (this.rng.float() < 0.1) net.w[p] += this.rng.gauss() * 0.3;
      } else net.randomize(this.rng);
      const b = new Bird({ x: (this.rng.float() - 0.5) * 6, y: WORLD.START_Y + (this.rng.float() - 0.5) * 4 });
      b.ctrl = (bb) => net.forward(bb.inp, bb.out);
      const fam = FAMILIES[i % 10];
      b.look = { color: fam.color, dark: fam.dark, scale: 0.75 };
      this.session.add(b);
    }
    this.stepper.reset();
    app.world.clearParticles();
    app.world.snapCamera(this.session.birds[0]);
  }

  update(dt, speed = 1) {
    const app = this.app;
    if (!this.session) this.start();
    const s = this.session;
    this.stepper.run(dt, speed, () => s.step());
    for (const e of s.drain()) {
      if (e.type === 'crash') app.world.burst(e.bird.x, e.bird.y, e.bird.z, e.bird.look.color);
    }
    this.camTimer += dt;
    if (this.camTimer > 9) { this.camTimer = 0; app.world.setCamMode((app.world.cam.mode + 1) % 3); }
    const lead = s.leader;
    app.world.update(dt, { birds: s.birds, course: s.course, alpha: this.stepper.alpha, focus: lead, T: s.T, aspect: app.px.aspect });
    if (s.done || (lead && lead.dist > 1400)) this.start();
  }
}
