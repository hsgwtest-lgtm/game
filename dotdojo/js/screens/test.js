// 開発用：3D の見た目を確かめる画面（?test=world&stage=oni）

import { C, text, mini } from '../ui/widgets.js';
import { STAGES } from '../sim/stages.js';
import { Stage, Episode, N_IN, N_ACT } from '../sim/env.js';
import { PAL, FAMILIES } from '../core/config.js';

export class TestScreen {
  constructor(app) { this.app = app; this.t = 0; }

  enter(p) {
    const q = new URLSearchParams(location.search);
    const def = STAGES.find((s) => s.id === (q.get('stage') || 'ippo')) || STAGES[0];
    this.stage = new Stage(def);
    this.app.world.setTheme(def.theme);
    this.app.world.buildStage(this.stage);
    this.n = +(q.get('n') || 12);
    this.ep = new Episode(this.stage, this.n);
    this.timer = 0;
    this.overlay = q.get('ov') || '';
    this._sync(true);
  }

  viewHeight() { return Math.round(this.app.px.VH * 0.62); }

  _sync(reset) {
    const ep = this.ep, list = [];
    for (let i = 0; i < ep.n; i++) {
      const f = FAMILIES[i % 10];
      list.push({ x: ep.x[i], y: ep.y[i], px: ep.px[i], py: ep.py[i], done: ep.done[i], cause: ep.cause[i], color: f.color, band: PAL.lime, key: ep.key[i] });
    }
    if (reset) this.app.world.resetAgents(list); else this.app.world.syncAgents(list);
  }

  update(dt) {
    this.t += dt;
    this.timer += dt;
    const STEP = 0.25;
    if (this.timer >= STEP) {
      this.timer -= STEP;
      if (this.ep.allDone) { this.ep.reset(); this._sync(true); }
      else {
        const acts = new Int8Array(this.ep.n);
        for (let i = 0; i < this.ep.n; i++) acts[i] = Math.random() < 0.55 ? 0 : Math.floor(Math.random() * N_ACT);
        this.ep.step(acts);
        this._sync(false);
      }
    }
    const w = this.app.world;
    w.setStepFrac(this.timer / STEP);
    w.setEnv(this.ep.t, this.timer / STEP);
    if (this.overlay === 'arrows' || this.overlay === 'both') {
      const arr = [];
      for (let i = 0; i < this.stage.W * this.stage.H; i++) {
        const x = i % this.stage.W, y = Math.floor(i / this.stage.W);
        arr.push(this.stage.walkable(x, y) ? { a: (x + y) % 5, c: PAL.white, s: 0.8 } : null);
      }
      w.setArrows(arr);
    }
    if (this.overlay === 'heat' || this.overlay === 'both') {
      const heat = [];
      const H = [PAL.navy, PAL.blue, PAL.sky, PAL.cyan, PAL.lime, PAL.yellow];
      for (let i = 0; i < this.stage.W * this.stage.H; i++) {
        const y = Math.floor(i / this.stage.W);
        heat.push(H[Math.max(0, Math.min(5, 5 - Math.floor(y * 6 / this.stage.H)))]);
      }
      w.setHeat(heat);
      this.overlay = this.overlay === 'both' ? 'arrows' : '';
    }
  }

  draw(fb) {
    const px = this.app.px;
    text(fb, 'TEST ' + this.stage.def.name, 4, px.safe.t + 2, C.white, { outline: C.ink });
    mini(fb, `T${this.ep.t} ALIVE ${this.ep.aliveCount()}`, 4, px.safe.t + 16, C.yellow);
  }
}
