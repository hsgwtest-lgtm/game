// 三流派の対抗戦：それぞれの流派で育てた脳を、同じ修行場で同時に走らせてくらべる
// 「鏡の島」（左右反転）は、覚えた道をなぞっているだけか、見て判断しているかを試す応用問題。

import { C, text, mini, button, panel, toggle, measure } from '../ui/widgets.js';
import { ICON, MASTER } from '../gfx/sprites.js';
import { stageById, STAGES } from '../sim/stages.js';
import { Stage, Episode, N_IN, C_GOAL } from '../sim/env.js';
import { Population } from '../ml/ga.js';
import { PPOAgent } from '../ml/ppo.js';
import { Imitator } from '../ml/bc.js';
import { MLP, argmax } from '../ml/nn.js';
import { SCHOOLS, SCHOOL_KEYS, PAL } from '../core/config.js';
import { plan } from '../sim/planner.js';
import { rgb } from '../gfx/fb.js';
import { CAUSE_NAME } from './train.js';

const COLORS = { ga: [PAL.lime, PAL.green], rl: [PAL.orange, PAL.rust], il: [PAL.cyan, PAL.red] };

export class CompareScreen {
  constructor(app) { this.app = app; }

  enter(p) {
    const app = this.app, g = app.game;
    this.def = stageById(p.stage);
    this.mirror = false;
    this.startIdx = 0;
    // 各流派の脳を読み込む
    this.brains = {};
    for (const k of SCHOOL_KEYS) {
      const d = g.loadBrain(this.def.id, k);
      let fn = null;
      if (d) {
        if (k === 'ga') {
          const pop = Population.deserialize(d);
          if (pop) {
            let best = 0;
            for (let i = 1; i < pop.members.length; i++) if (pop.members[i].fitness > pop.members[best].fitness) best = i;
            const net = new MLP(N_IN, 16, 5, pop.members[best].genome);
            fn = (o) => argmax(net.forward(o));
          }
        } else if (k === 'rl') {
          const ag = PPOAgent.deserialize(d);
          if (ag) fn = (o) => ag.greedy(o);
        } else {
          const im = Imitator.deserialize(d);
          if (im && im.steps > 0) fn = (o) => im.greedy(o);
        }
      }
      this.brains[k] = fn;
    }
    this.order = SCHOOL_KEYS.filter((k) => this.brains[k]);
    this.result = null;
    this.state = 'ready';
    app.world.frameOpts = {};
    this._setupStage();
    app.world.cam.mode = 'fixed';
    app.sound.setMood('train');
    app.masters.clear();
    app.masters.say('rl', '対抗戦だ！ それぞれの流派で育てた脳を、同じ修行場でいっせいに走らせるぞ。', { dur: 5 });
  }

  _setupStage() {
    const app = this.app;
    this.stage = new Stage(this.def, this.mirror);
    app.world.setTheme(this.def.theme);
    app.world.buildStage(this.stage);
    this._frame();
    this.ep = new Episode(this.stage, Math.max(1, this.order.length), {}, this.startIdx);
    this.paths = this.order.map(() => [[this.ep.x[0], this.ep.y[0]]]);
    this._sync(true);
    this.timer = 0;
    this.par = plan(this.stage, this.stage.maxSteps, null, this.startIdx);
  }

  _frame() {
    const vh = this.viewHeight();
    this.app.world.frameCamera(this.app.px.VW / vh, { top: 1 - 2 * ((this.app.px.safe.t + 34) / vh), bot: -0.96, mx: 0.95 });
  }
  resize() { this._frame(); }

  panelH() { return 186 + this.app.px.safe.b; }
  viewHeight() { return Math.max(150, this.app.px.VH - this.panelH()); }

  _sync(reset) {
    const ep = this.ep, list = [];
    this.order.forEach((k, i) => {
      list.push({ x: ep.x[i], y: ep.y[i], px: ep.px[i], py: ep.py[i], done: ep.done[i], cause: ep.cause[i], color: COLORS[k][0], band: COLORS[k][1], key: ep.key[i] });
    });
    if (reset) this.app.world.resetAgents(list); else this.app.world.syncAgents(list);
  }

  start() {
    if (!this.order.length) return;
    this._setupStage();
    this.state = 'run';
    this.app.sfx('go');
  }

  update(dt) {
    const app = this.app;
    app.masters.update(dt);
    if (this.state === 'run') {
      this.timer += dt;
      const STEP = 0.26;
      if (this.timer >= STEP) {
        this.timer -= STEP;
        const ep = this.ep, obs = new Float32Array(N_IN), acts = new Int8Array(ep.n);
        this.order.forEach((k, i) => { if (!ep.done[i]) { ep.observe(i, obs); acts[i] = this.brains[k](obs); } });
        ep.step(acts);
        this.order.forEach((k, i) => {
          if (ep.px[i] !== ep.x[i] || ep.py[i] !== ep.y[i]) this.paths[i].push([ep.x[i], ep.y[i]]);
          if (ep.ev[i] & 128) { app.world.burst(ep.x[i], ep.y[i], 'goal', 14); app.sfx('goal'); }
          else if (ep.ev[i] & (4 | 8 | 16)) app.sfx(ep.ev[i] & 4 ? 'fall' : 'hit');
        });
        this._sync(false);
        if (ep.allDone) this._finish();
      }
      app.world.setStepFrac(this.timer / STEP);
      app.world.setEnv(this.ep.t, this.timer / STEP);
    } else {
      app.world.setStepFrac(1);
    }
  }

  _finish() {
    const ep = this.ep, g = this.app.game;
    const rows = this.order.map((k, i) => {
      const rec = g.rec(this.def.id, k);
      return { k, succ: ep.succ[i], steps: ep.steps[i], cause: ep.cause[i], cost: rec && rec.cost, unit: rec && rec.unit };
    });
    const ranked = rows.slice().sort((a, b) => (b.succ - a.succ) || (a.steps - b.steps));
    this.result = { rows, ranked, mirror: this.mirror };
    this.state = 'done';
    const win = ranked[0];
    const m = this.app.masters;
    if (!win.succ) {
      this.app.sfx('lose');
      m.say('ga', this.mirror ? '鏡の島ではだれもゴールできなんだ。左右が逆になると、覚えた道が役に立たんのじゃ。' : 'だれもゴールできなんだ。もう少し修行が必要じゃな。', { prio: 2 });
    } else {
      this.app.sfx('win');
      const winners = ranked.filter((r) => r.succ && r.steps === win.steps);
      const lines = {
        ga: '群れで鍛えた脳の勝ちじゃ！ たくさん試して残った子は強いのう。',
        rl: 'ごほうびで鍛えた脳の勝ちだ！ 自分で近道を見つけたぞ！',
        il: 'お手本で覚えた脳の勝ち！ キミのマネが一番うまくいったよ！',
      };
      if (winners.length > 1) m.say(win.k, `${winners.length}流派が同時にゴール！ ${win.steps}歩で引き分けだ。`, { prio: 2 });
      else m.say(win.k, lines[win.k], { prio: 2 });
      if (this.mirror) {
        const ok = rows.filter((r) => r.succ).map((r) => SCHOOLS[r.k].name);
        const ng = rows.filter((r) => !r.succ).map((r) => SCHOOLS[r.k].name);
        if (ng.length) m.say('il', `鏡の島で${ng.join('・')}は迷ったね。「場所」で道を覚えていると、左右が逆になると迷うんだ。`, { prio: 1 });
        else m.say('il', '鏡の島でもみんなゴール！ 目に映るものを見て判断できている証拠だね。', { prio: 1 });
      }
    }
  }

  draw(fb) {
    const app = this.app, px = app.px, VW = px.VW, top = px.safe.t, bot = px.VH - px.safe.b;
    const vh = this.viewHeight();
    button(app, 'back', 3, top + 2, 18, 15, '', () => { app.sfx('back'); app.go('stages', { stage: this.def.id }); }, { icon: ICON.back });
    text(fb, `対抗戦 ${this.def.name}`, 25, top + 4, C.white, { outline: C.ink });
    if (this.mirror) text(fb, '鏡の島（左右反転）', 4, top + 20, C.cyan, { outline: C.ink });
    // パネル
    fb.rect(0, vh, VW, px.VH - vh, C.navy);
    fb.rect(0, vh, VW, 1, C.ink);
    fb.rect(0, vh + 1, VW, 1, C.slate);
    let y = vh + 6;
    const x = 6, w = VW - 12;
    // 流派ごとの行
    const rowH = 30;
    SCHOOL_KEYS.forEach((k) => {
      const sc = SCHOOLS[k], has = !!this.brains[k];
      const i = this.order.indexOf(k);
      const rec = app.game.rec(this.def.id, k);
      fb.rect(x, y, w, rowH - 2, C.ink);
      fb.rect(x + 1, y + 1, 3, rowH - 4, rgb(sc.color));
      const spr = MASTER[k];
      fb.sprite(spr, x + 7, y + 6, spr.cols, 1);
      text(fb, sc.name, x + 27, y + 2, rgb(sc.color));
      // 学習にかかった数
      const costStr = rec && rec.got ? `学習 ${rec.cost}${rec.unit || ''}` : (has ? '修行中' : 'まだ修行していない');
      text(fb, costStr, x + 27, y + 14, has ? C.silver : C.steel);
      // レースの状態
      let st = '', col = C.white;
      if (has && this.ep && i >= 0) {
        const ep = this.ep;
        if (this.state === 'ready') st = '';
        else if (ep.succ[i]) { st = `ゴール ${ep.steps[i]}歩`; col = C.yellow; }
        else if (ep.done[i]) { st = CAUSE_NAME[ep.cause[i]] || '×'; col = C.pink; }
        else st = `${ep.steps[i]}歩…`;
      }
      if (st) text(fb, st, x + w - 4, y + 8, col, { align: 'right' });
      const best = this.result && this.result.ranked[0];
      const row = this.result && this.result.rows.find((r) => r.k === k);
      if (best && best.succ && row && row.succ && row.steps === best.steps) fb.icon(ICON.trophy, x + w - 4 - measure(st) - 11, y + 10, C.gold);
      y += rowH;
    });
    // 操作
    y += 2;
    const multi = this.stage.starts.length > 1;
    if (this.state !== 'run') {
      button(app, 'go', x, y, 80, 18, this.state === 'done' ? 'もう一度' : 'スタート', () => this.start(), { icon: ICON.play, accent: C.orange, disabled: !this.order.length });
      button(app, 'mir', x + 84, y, w - 84, 18, this.mirror ? 'ふつうの島へ' : '鏡の島で試す', () => { this.mirror = !this.mirror; this.state = 'ready'; this.result = null; this._setupStage(); if (this.mirror) app.masters.say('il', '鏡の島は左右が逆。場所で覚えた道は使えないよ。見て判断できるかな？', { key: 'mir' }); }, { active: this.mirror });
      y += 22;
      if (multi) {
        text(fb, 'スタート地点', x, y + 1, C.silver);
        for (let k = 0; k < this.stage.starts.length; k++) button(app, 'sst' + k, x + w - (this.stage.starts.length - k) * 22, y, 20, 14, String(k + 1), () => { this.startIdx = k; this.state = 'ready'; this.result = null; this._setupStage(); }, { active: this.startIdx === k, mini: true });
        y += 18;
      }
      if (this.par) text(fb, `最短ルートは ${this.par.steps}歩`, x, y + 2, C.steel);
      y += 14;
    } else {
      text(fb, `${this.ep.t}歩目`, VW / 2, y + 4, C.white, { align: 'center' });
      y += 22;
    }
    app.masters.draw(fb, 4, Math.min(y, bot - 30), VW - 8, 2);
  }
}
