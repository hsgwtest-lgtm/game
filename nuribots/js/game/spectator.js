// 試合を3Dで見せる係（タイトルの見本試合・トレーニングのライブ・本番の試合で共通）。
// Match（決定論）を一定の速さで進め、World3D に演出を渡し、ごほうびのポップを出す。

import { Match } from '../sim/match.js';
import { RULE, EV, N_EV } from '../sim/env.js';
import { deckWeights } from '../sim/rewards.js';
import { C } from '../core/const.js';
import { col } from '../ui/ui.js';
import { mini, text } from '../gfx/font.js';

export class Spectator {
  constructor(app) {
    this.app = app;
    this.match = null;
    this.speed = 1;
    this.acc = 0;
    this.popups = [];
    this.W = null;
    this.side = 0;
    this.paused = false;
    this.running = false;
    this.clock = null;      // オンライン: () => 試合開始からの秒
    this.onEnd = null;
    this.onStep = null;
    this.rewardSum = 0;
    this.cardSum = new Float64Array(N_EV);
    this.policySide = -1;
    this.lastProb = null;
    this.endHold = 0;
  }

  // opt: { arena, seed, a, b, speed, deck, side, clock, onEnd, onStep, policy }
  start(opt) {
    this.match = new Match({ arena: opt.arena, seed: opt.seed, a: opt.a, b: opt.b, logging: true });
    this.speed = opt.speed ?? 1;
    this.W = opt.deck ? deckWeights(opt.deck) : null;
    this.side = opt.side ?? 0;
    this.clock = opt.clock || null;
    this.onEnd = opt.onEnd || null;
    this.onStep = opt.onStep || null;
    this.policySide = opt.policy ?? -1;
    this.sfx = !!opt.sfx;
    this.acc = 0;
    this.popups = [];
    this.rewardSum = 0;
    this.cardSum.fill(0);
    this.running = true;
    this.paused = false;
    this.ended = false;
    this.endHold = 0;
    const w = this.app.world;
    w.sync(this.match.env);
    w.setPolicy(0, null);
    for (let i = 0; i < 2; i++) w.setPose(i, null);
    return this.match;
  }

  get env() { return this.match ? this.match.env : null; }

  stop() { this.running = false; this.match = null; this.app.world.setPolicy(0, null); }

  _step() {
    const m = this.match;
    const w = this.app.world;
    m.step();
    const sd = 1 / (RULE.STEPS_PER_SEC * Math.max(0.25, this.speed));
    w.applyStep(m.env, Math.min(0.2, sd));
    const fx = m.env.fx;
    const snd = this.app.sound;
    if (fx && this.sfx && this.speed <= 2) {
      if (fx.shots.length) snd.play('shoot');
      if (fx.stuns.length) snd.play('hit');
      if (fx.bombs.length) snd.play('bomb');
    }
    // ごほうびのポップ
    if (this.W) {
      const ev = m.env.ev[this.side];
      let r = 0;
      for (let k = 0; k < N_EV; k++) if (this.W[k]) { const v = this.W[k] * ev[k]; r += v; this.cardSum[k] += v; }
      this.rewardSum += r;
      if (Math.abs(r) >= 0.05 && this.speed <= 2) {
        this.popups.push({ v: r, t: 0, k: this.popups.length });
        if (this.popups.length > 8) this.popups.shift();
      }
    }
    // AIの考え（矢印）
    if (this.policySide >= 0) {
      const ctl = m.ctl[this.policySide];
      if (ctl && ctl.isNet) { this.lastProb = ctl.prob; w.setPolicy(this.policySide, ctl.prob); }
    }
    if (this.onStep) this.onStep(m);
    if (m.done && !this.ended) {
      this.ended = true;
      const res = m.result();
      w.setPose(res.winner === 0 ? 0 : 1, res.winner === -1 ? 'idle' : 'win');
      if (res.winner >= 0) w.setPose(1 - res.winner, 'lose');
      w.setPolicy(0, null);
      if (this.onEnd) this.onEnd(res, m);
    }
  }

  update(dt) {
    if (!this.running || !this.match) return;
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter(p => p.t < 0.8);
    if (this.paused || this.match.done) return;
    if (this.clock) {
      // オンライン: 時計に合わせて進める（遅れていたら早送り）
      const target = Math.min(RULE.T, Math.floor(this.clock() * RULE.STEPS_PER_SEC));
      let n = 0;
      while (this.match.env.t < target && n < 40) { this._step(); n++; }
      if (this.match.env.t < target) { while (this.match.env.t < target) this.match.step(); this.app.world.sync(this.match.env); }
      return;
    }
    this.acc += dt * RULE.STEPS_PER_SEC * this.speed;
    let n = 0;
    while (this.acc >= 1 && n < 12) {
      this.acc -= 1;
      this._step();
      n++;
      if (this.match.done) break;
    }
    if (this.acc > 3) this.acc = 0;
  }

  // 一気に最後まで
  skip() {
    if (!this.match) return;
    while (!this.match.done) this.match.step();
    this.app.world.sync(this.match.env);
    this.ended = false;
    this._finishAfterSkip();
  }

  _finishAfterSkip() {
    const m = this.match;
    this.ended = true;
    const res = m.result();
    const w = this.app.world;
    if (res.winner >= 0) { w.setPose(res.winner, 'win'); w.setPose(1 - res.winner, 'lose'); }
    if (this.onEnd) this.onEnd(res, m);
  }

  // ポップを描く（view は3Dの範囲）
  drawPopups(ui, view) {
    if (!this.match || !this.popups.length) return;
    const w = this.app.world;
    const p0 = w.botScreen(this.side, view.w, view.h, 1.6);
    for (const p of this.popups) {
      const k = p.t / 0.8;
      const y = Math.round(view.y + p0.y - 4 - k * 14);
      const x = Math.round(p0.x);
      const s = (p.v > 0 ? '+' : '-') + fmtSmall(Math.abs(p.v));
      const c = p.v > 0 ? C.leaf : C.flesh;
      if (k > 0.75 && Math.floor(p.t * 20) % 2) continue;
      mini(ui.fb, s, x + 1, y + 1, col(C.ink), 'center');
      mini(ui.fb, s, x, y, col(c), 'center');
    }
  }
}

function fmtSmall(v) {
  if (v >= 10) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1).replace(/\.0$/, '');
  return v.toFixed(2).replace(/^0/, '').replace(/0$/, '');
}

export { text };
