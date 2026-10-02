// おしえる（模倣学習）画面
// あなたが飛ばした「目の画像 → 操縦」をデータとしてため、ヒナの脳がそれをまねるように学習する。
// 「AIにまかせる」でヒナだけで飛ばし、危ない時に指でたすけると、その場面を重点的に学ぶ（DAgger）。

import { C, text, mini, measure, button, panel, tabs, bar, dim } from '../ui/widgets.js';
import { ICON } from '../gfx/sprites.js';
import { STAGES, WORLD, CHICK_LOOK, PLAYER_LOOK } from '../core/config.js';
import { Session, Bird, CAUSE_LABEL } from '../sim/flight.js';
import { Stepper } from '../game/demo_flight.js';
import { Stick } from '../ui/stick.js';
import { drawBrain, drawStick, drawChart } from '../ui/viz.js';
import { RNG } from '../core/rng.js';

const PANEL_H = 152;
const HUD_H = 38;
const TABS = ['まなび', 'のう'];
const DROP_STEPS = 15;          // ぶつかる直前 0.5秒ぶんのお手本は捨てる
const SPEEDS = [1, 2, 4];

export class TeachScreen {
  constructor(app) {
    this.app = app;
    this.rng = new RNG();
    this.stepper = new Stepper();
    this.stick = new Stick(22);
    this.tab = 0;
    this.pred = new Float32Array(2);
    this.human = { x: 0, y: 0 };
    this.blink = 0;
  }

  enter(p) {
    const app = this.app, g = app.game;
    this.stageIdx = p.stageIdx ?? 0;
    this.stage = STAGES[this.stageIdx];
    this.chick = g.ensureChick();
    this.mode = 'teach';
    this.speedIdx = 0;
    this.banner = null;
    this.saveT = 0;
    this.overlay = null;
    this.stick.reset();
    app.world.setTheme(this.stage.theme);
    app.world.setCamMode(0);
    app.world.setGoal(-this.stage.goal);
    app.demo.dirty = true;
    app.sound.setMood('lab');
    this.startRun();
    if (!g.seen.teach) {
      g.seen.teach = true; g.saveProgress();
      app.prof.say('ここでは、きみの操縦をヒナがまねして学ぶ。画面のどこでもドラッグすると操縦できるぞ。', { prio: 2, dur: 7 });
      app.prof.say('きみが飛ぶほどデータがたまり、ヒナの脳が「同じ場面ならこう動く」を覚えていく。', { prio: 1, dur: 7 });
    }
  }

  exit() { this.app.game.saveChick(); this.stick.reset(); }

  viewHeight() { return this.app.px.VH - this.app.px.safe.b - PANEL_H; }

  startRun() {
    const app = this.app, st = this.stage;
    this.session = new Session(st, (this.rng.float() * 2 ** 32) >>> 0, { maxDist: st.goal * 1.25 });
    const b = new Bird({ x: 0, y: WORLD.START_Y });
    b.ctrl = (bb) => this.control(bb);
    b.look = this.mode === 'teach' ? PLAYER_LOOK : CHICK_LOOK;
    this.bird = this.session.add(b);
    this.phase = 'ready';
    this.phaseT = 0;
    this.aiClean = true;
    this.runSamples = 0;
    this.takeoverSteps = 0;
    this.stepper.reset();
    app.world.clearParticles();
    app.world.snapCamera(b);
  }

  setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    this.startRun();
    if (m === 'ai') {
      if (this.chick.count < 60) this.app.prof.say('まだデータが少ないぞ。まずは「じぶんで」何回か飛んで、お手本を見せよう。', { prio: 2, key: 'fewdata', cool: 30 });
      else this.app.prof.say('ヒナだけで飛ばすぞ。危ないと思ったら指でたすけよう。たすけた場面は強く覚える。', { prio: 1, key: 'aimode', cool: 60 });
    }
  }

  // 毎ステップの操縦：人 or AI
  control(b) {
    const v = this.stick.value();
    const chick = this.chick;
    chick.predict(b.inp, this.pred);
    const human = this.mode === 'teach' || this.stick.touching;
    this.human.x = v.x; this.human.y = v.y;
    if (human) {
      b.out[0] = v.x; b.out[1] = v.y;
      const w = this.mode === 'ai' ? 2.5 : 1;     // たすけたデータは重みを大きく
      chick.add(b.inp, v.x, v.y, w);
      this.runSamples++;
      if (this.mode === 'ai') { this.aiClean = false; this.takeoverSteps++; }
    } else {
      b.out[0] = this.pred[0]; b.out[1] = this.pred[1];
    }
    this.humanNow = human;
  }

  update(dt) {
    const app = this.app, chick = this.chick;
    this.blink += dt;
    this.phaseT += dt;
    this.saveT += dt;
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
    if (this.phase === 'ready') {
      if (this.mode === 'ai' ? this.phaseT > 0.7 : this.stick.touching) { this.phase = 'fly'; this.phaseT = 0; }
    } else if (this.phase === 'fly' && !this.overlay) {
      const sp = this.mode === 'ai' ? SPEEDS[this.speedIdx] : 1;
      this.stepper.run(dt, sp, () => { if (this.bird.alive) { this.session.step(); this.handleEvents(); } });
      if (!this.bird.alive) this.onEnd();
    } else if (this.phase === 'end') {
      if (this.phaseT > (this.endGoal ? 2.2 : 1.3)) this.startRun();
    }
    // 学習は飛んでいる間も止まっている間も少しずつ進める
    const before = chick.steps;
    chick.train(8, 32);
    this.agreeT = (this.agreeT || 0) + dt;
    if (this.agreeT > 0.5) { this.agreeT = 0; chick.evalAgree(48); }
    if (chick.steps > before && chick.steps % 400 < 8) this.commentLearning();
    if (this.saveT > 25) { this.saveT = 0; app.game.saveChick(); }
    const s = this.session;
    app.world.update(dt, { birds: s.birds, course: s.course, alpha: this.phase === 'fly' ? this.stepper.alpha : 1, focus: this.bird, T: s.T, aspect: app.px.aspect });
  }

  commentLearning() {
    const c = this.chick, prof = this.app.prof;
    if (c.count > 250 && c.count < 900) prof.say('データがたまってきた。グラフの「誤差」が下がるほど、きみの動きをまねできている。', { prio: 1, key: 'data', cool: 120 });
    else if (c.count >= 900 && c.loss !== null && c.loss < 0.06 && this.mode === 'teach') prof.say('だいぶ覚えたようじゃ。「AIまかせ」でヒナだけで飛ばしてみよう。', { prio: 1, key: 'tryai', cool: 90 });
  }

  handleEvents() {
    const app = this.app, w = app.world;
    for (const e of this.session.drain()) {
      if (e.type === 'crash') { w.burst(e.bird.x, e.bird.y, e.bird.z, e.bird.look.color, 16); app.sfx('crash'); }
      else if (e.type === 'pass') { app.sfx('pass'); w.sparkle(e.bird.x, e.bird.y, e.bird.z, w.theme.frame, 6); }
    }
  }

  onEnd() {
    const app = this.app, g = app.game, st = this.stage, b = this.bird, chick = this.chick;
    const goal = b.dist >= st.goal;
    this.endGoal = goal;
    this.phase = 'end';
    this.phaseT = 0;
    const rec = g.stageRec(st.id);
    if (this.mode === 'teach') {
      if (!goal) {
        chick.dropLast(Math.min(DROP_STEPS, this.runSamples));
        this.banner = { text: 'CRASH', sub: `${Math.floor(b.dist)}m  ${CAUSE_LABEL[b.cause] || ''}に ぶつかった`, t: 0, dur: 1.3, color: C.red };
        app.prof.say('ぶつかる直前のお手本は「まねしちゃダメな動き」なので、データから消しておいたぞ。', { prio: 1, key: 'drop', cool: 90 });
      } else {
        this.banner = { text: 'GOAL!', sub: 'いいお手本！', t: 0, dur: 2.2, color: C.lime };
        app.sfx('record');
      }
    } else {
      if (this.aiClean) rec.teachBest = Math.max(rec.teachBest || 0, b.dist);
      if (goal && this.aiClean) {
        chick.clears++;
        const info = g.markClear(this.stageIdx, 'teach');
        this.banner = { text: 'GOAL!', sub: 'ヒナだけで ゴール！ ★', t: 0, dur: 2.4, color: C.yellow };
        app.sfx('clear');
        app.prof.say(info.first ? 'おみごと！ ヒナが自分だけでゴールまで飛べた。きみのお手本のおかげじゃ！' : 'またヒナだけでゴール！ 安定してきたな。', { prio: 3, dur: 6 });
      } else if (goal) {
        this.banner = { text: 'GOAL!', sub: 'たすけありで ゴール', t: 0, dur: 2.2, color: C.lime };
        app.sfx('record');
      } else {
        this.banner = { text: 'CRASH', sub: `ヒナは ${Math.floor(b.dist)}m で ぶつかった`, t: 0, dur: 1.3, color: C.red };
        app.prof.say('失敗しそうな場面で指でたすけると、その場面のお手本が増えて強くなるぞ（DAggerという方法じゃ）。', { prio: 1, key: 'dagger', cool: 75 });
      }
    }
    g.saveProgress();
  }

  draw(fb) {
    const app = this.app, px = app.px;
    const VW = px.VW, VH = px.VH, top = px.safe.t;
    const viewH = this.viewHeight();
    // 操縦エリア（3D画面）
    app.ui.area('teach_stick', 0, top + HUD_H, VW, viewH - top - HUD_H, this.stick.handlers());
    this.drawHUD(fb, VW, top);
    // 状態表示
    const cy = Math.round(viewH * 0.55);
    if (this.phase === 'ready' && this.mode === 'teach') {
      if (Math.floor(this.blink * 2) % 2 === 0) {
        fb.icon(ICON.hand, VW / 2 - 3, cy - 20, C.white);
        text(fb, '指をおいて ドラッグで そうじゅう', VW / 2, cy - 8, C.white, { align: 'center', outline: C.ink });
      }
      text(fb, '（PCなら 矢印キー）', VW / 2, cy + 6, C.silver, { align: 'center', outline: C.ink });
    }
    if (this.phase === 'fly') {
      const recOn = this.humanNow;
      if (recOn) {
        if (Math.floor(this.blink * 3) % 2 === 0) fb.disc(9, top + HUD_H + 7, 3, C.red);
        text(fb, this.mode === 'teach' ? 'お手本を記録中' : 'たすけ中！ 記録中', 15, top + HUD_H + 2, C.white, { outline: C.ink });
      } else if (this.mode === 'ai') {
        fb.icon(ICON.robot, 5, top + HUD_H + 3, C.gold);
        text(fb, 'ヒナが操縦中', 15, top + HUD_H + 2, C.gold, { outline: C.ink });
      }
    }
    if (this.banner) {
      const b = this.banner;
      mini(fb, b.text, VW / 2 + 1, cy - 25, C.ink, 'center', 3);
      mini(fb, b.text, VW / 2, cy - 26, b.color, 'center', 3);
      if (b.sub) text(fb, b.sub, VW / 2, cy - 5, C.white, { align: 'center', outline: C.ink });
    }
    this.stick.draw(fb);
    // 博士
    if (app.prof.busy) {
      const bh = 3 * 12 + 5;
      app.prof.draw(fb, 4, viewH - bh - 10, VW - 8, 3, this.phase !== 'fly');
    }
    this.drawPanel(fb, VW, VH, viewH);
  }

  drawHUD(fb, VW, top) {
    const app = this.app, st = this.stage;
    fb.rect(0, top, VW, HUD_H - 6, C.ink);
    fb.rect(0, top + HUD_H - 6, VW, 1, C.navy);
    button(app, 'te_back', 3, top + 2, 20, 14, '', () => { app.sfx('back'); app.go('stages', { mode: 'teach' }); }, { icon: ICON.back });
    text(fb, 'おしえる', 27, top + 2, C.gold);
    mini(fb, 'ST' + st.id, 27 + measure('おしえる') + 5, top + 6, C.cyan);
    text(fb, `${Math.floor(this.bird.dist)}m`, VW - 28, top + 2, C.white, { align: 'right' });
    button(app, 'te_cam', VW - 23, top + 2, 20, 14, '', () => { app.world.setCamMode((app.world.cam.mode + 1) % 3); }, { icon: ICON.camera });
    const y2 = top + 18;
    button(app, 'te_m0', 3, y2, 62, 13, 'じぶんで', () => this.setMode('teach'), { active: this.mode === 'teach', icon: ICON.hand });
    button(app, 'te_m1', 68, y2, 62, 13, 'AIまかせ', () => this.setMode('ai'), { active: this.mode === 'ai', icon: ICON.robot });
    if (this.mode === 'ai') {
      for (let i = 0; i < SPEEDS.length; i++) {
        button(app, 'te_sp' + i, VW - 3 - (SPEEDS.length - i) * 17, y2, 16, 13, SPEEDS[i] + 'X', () => { this.speedIdx = i; }, { mini: true, active: this.speedIdx === i });
      }
    }
    // ゴールまでのバー
    const by = top + HUD_H - 4, bw = VW - 20;
    const d = this.bird.dist;
    fb.rect(4, by - 1, bw + 2, 5, C.ink);
    fb.rect(5, by, bw, 3, C.navy);
    fb.rect(5, by, Math.round(bw * Math.min(1, d / st.goal)), 3, d >= st.goal ? C.lime : C.gold);
    fb.icon(ICON.flag, VW - 13, by - 4, d >= st.goal ? C.lime : C.white);
  }

  drawPanel(fb, VW, VH, viewH) {
    const app = this.app;
    const y0 = viewH;
    fb.rect(0, y0, VW, VH - y0, C.navy);
    fb.rect(0, y0, VW, 1, C.ink);
    tabs(app, 'te_tab', 0, y0 + 1, VW, 14, TABS, this.tab, (i) => { this.tab = i; });
    const y = y0 + 16;
    if (this.tab === 0) this.panelLearn(fb, VW, y);
    else this.panelBrain(fb, VW, y);
  }

  panelLearn(fb, VW, y) {
    const app = this.app, c = this.chick, g = app.game;
    text(fb, `データ ${c.count}こ`, 6, y + 1, C.white);
    text(fb, `学習 ${c.steps}回`, VW - 6, y + 1, C.silver, { align: 'right' });
    // あなた(白) と AIの予想(黄) の操縦をくらべる
    const scx = 27, scy = y + 39;
    drawStick(fb, scx, scy, 19, this.pred[0], this.pred[1], C.yellow, this.human.x, this.human.y, C.white);
    fb.rect(6, y + 61, 3, 3, C.white); mini(fb, 'YOU', 11, y + 61, C.silver);
    fb.rect(30, y + 61, 3, 3, C.yellow); mini(fb, 'AI', 35, y + 61, C.silver);
    // 誤差のグラフ
    const gx = 56, gy = y + 25, gw = VW - gx - 7, gh = 34;
    text(fb, '誤差（下がるほど上手）', gx, y + 12, C.silver);
    const hist = c.lossHist;
    let ymax = 0.05;
    for (const v of hist) if (v > ymax) ymax = v;
    if (hist.length > 1) drawChart(fb, gx, gy, gw, gh, [{ data: hist, color: C.pink, dot: true }], { ymax: ymax * 1.1 });
    else { fb.rect(gx, gy, gw, gh, C.ink); fb.frame(gx - 1, gy - 1, gw + 2, gh + 2, C.steel); text(fb, 'とぶと学習が始まる', gx + gw / 2, gy + 11, C.steel, { align: 'center' }); }
    if (c.loss !== null) mini(fb, c.loss.toFixed(3), gx + gw - 2, gy + 2, C.pink, 'right');
    // 一致度
    const ag = c.agree == null ? 0 : c.agree;
    text(fb, '一致度', 6, y + 68, C.silver);
    bar(fb, 46, y + 72, VW - 92, 4, ag, ag > 0.85 ? C.lime : ag > 0.7 ? C.yellow : C.orange, C.ink);
    text(fb, c.agree == null ? '--' : `${Math.round(ag * 100)}%`, VW - 6, y + 68, C.white, { align: 'right' });
    // ボタン
    const bw = Math.floor((VW - 12 - 8) / 3), by = y + 84;
    button(app, 'te_clear', 6, by, bw, 16, 'データ消去', () => { c.clearData(); app.prof.say('お手本データを消した。脳はそのまま残っておる。', { prio: 1 }); }, { icon: ICON.trash });
    button(app, 'te_inject', 10 + bw, by, bw, 16, 'むれへ', () => this.inject(), { icon: ICON.plus, disabled: c.steps < 50 });
    button(app, 'te_reset', 14 + bw * 2, by, bw, 16, '脳リセット', () => {
      c.resetBrain(); app.prof.say('脳をまっさらにした。データはそのままなので、すぐに学び直すぞ。', { prio: 1 });
    });
    const hint = this.mode === 'teach'
      ? (c.count < 200 ? '穴の真ん中を ねらって とんでみよう' : 'うまく飛べたら「AIまかせ」へ')
      : (this.aiClean ? 'ヒナだけで ゴールすると ★' : '指でたすけると その場面を学ぶ');
    text(fb, hint, VW / 2, by + 21, C.steel, { align: 'center' });
    void g;
  }

  panelBrain(fb, VW, y) {
    const b = this.bird, c = this.chick;
    text(fb, 'ヒナの脳（いまの場面）', 6, y + 1, C.white);
    const by = y + 18;
    drawBrain(fb, c.net, b.inp, 8, by, VW - 16 - 36, 50, { cell: 5, labels: true });
    drawStick(fb, VW - 20, by + 22, 13, this.pred[0], this.pred[1], C.yellow, this.human.x, this.human.y, C.white);
    mini(fb, 'AI', VW - 20, by + 39, C.gray, 'center');
    text(fb, '目の明るさ × 重み で 操縦を計算。', 6, by + 58, C.silver);
    text(fb, 'お手本との差が小さくなるように', 6, by + 70, C.silver);
    text(fb, '重みを少しずつ直す（誤差逆伝播）', 6, by + 82, C.silver);
  }

  inject() {
    const app = this.app, g = app.game;
    const f = g.ensureFlock();
    const m = f.inject(this.chick.net.w);
    g.saveFlock();
    app.sfx('teach');
    app.prof.say(`おしえたヒナの脳を「マネ家」として群れに入れた（${m.name}）。そだてるで活躍を見てみよう！`, { prio: 2, dur: 6 });
  }
}
