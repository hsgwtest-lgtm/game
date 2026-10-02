// そだてる（ニューロエボリューション）画面
// 群れ全員が同じコースを飛び、遠くまで飛べた子の脳（DNA）が次の世代へ受け継がれていく。

import { C, text, mini, miniMeasure, measure, button, panel, tabs, bar, dim, toggle } from '../ui/widgets.js';
import { ICON, CHICK, CHICK_DEAD, colors } from '../gfx/sprites.js';
import { STAGES, FAMILIES, MUTATION, POP_SIZES, WORLD, PAL } from '../core/config.js';
import { Session, Bird, CAUSE_LABEL } from '../sim/flight.js';
import { MLP } from '../ml/nn.js';
import { Stepper } from '../game/demo_flight.js';
import { drawBrain, drawStick, drawChart, drawDNA, drawShares } from '../ui/viz.js';
import { RNG } from '../core/rng.js';
import { rgb } from '../gfx/fb.js';

const SPEEDS = [1, 2, 4, 8];
const TABS = ['のう', 'グラフ', 'むれ', 'DNA'];
const PANEL_H = 152;
const HUD_H = 38;
const CAUSE_COLORS = { gate: C.cream, wall: C.clay, ground: C.green, pillar: C.gray, log: C.brown, finish: C.lime, ceiling: C.sky };
const CAMS = ['うしろ', 'まえ', 'うえ'];

export class EvolveScreen {
  constructor(app) {
    this.app = app;
    this.rng = new RNG();
    this.stepper = new Stepper();
    this.nets = [];
    this.tab = 0;
    this.famCols = FAMILIES.map(f => colors({ c: rgb(f.color), d: rgb(f.dark) }));
    this.deadCols = colors({ c: C.steel, d: C.slate, k: C.ink, o: C.slate, w: C.gray });
    this.blink = 0;
  }

  // ── 画面の出入り ──
  enter(p) {
    const app = this.app, g = app.game;
    this.stageIdx = p.stageIdx ?? g.stageIdx;
    this.stage = STAGES[this.stageIdx];
    g.stageIdx = this.stageIdx;
    this.flock = g.ensureFlock();
    this.speedIdx = Math.min(SPEEDS.length - 1, g.settings.speedIdx || 0);
    this.turbo = false;
    this.phase = 'run';
    this.phaseT = 0;
    this.overlay = null;          // 'settings' | 'reset'
    this.banner = null;
    this.summary = null;
    this.genGoal = false;
    this.stagnant = 0;
    this.turboGens = 0;
    this.lastFocusId = null;
    app.world.setTheme(this.stage.theme);
    app.world.setCamMode(g.settings.cam || 0);
    app.world.setGoal(-this.stage.goal);
    app.demo.dirty = true;
    app.sound.setMood('lab');
    this.startGen();
    const rec = g.stageRec(this.stage.id);
    if (!g.seen.evolve) {
      g.seen.evolve = true; g.saveProgress();
      app.prof.say('ヒナたちの脳は、まだでたらめじゃ。遠くまで飛べた子ほど親に選ばれ、その脳がまざって子に受け継がれる。', { prio: 2, dur: 8 });
      app.prof.say('下のパネルで「AIの目」や脳の動き、学習のグラフが見られるぞ。速さは右上で変えられる。', { prio: 1, dur: 7 });
    } else if (this.flock.history.length && this.flock.history[this.flock.history.length - 1].st !== this.stage.id && !rec.evo) {
      app.prof.say('新しいステージじゃ。前のステージで学んだ脳が、どこまで通用するかな？', { prio: 2 });
    }
  }

  exit() {
    const g = this.app.game;
    g.settings.speedIdx = this.speedIdx;
    g.saveSettings();
    g.saveFlock();
  }

  viewHeight() { return this.app.px.VH - this.app.px.safe.b - PANEL_H; }

  // ── 世代の始まりと終わり ──
  startGen() {
    const app = this.app, st = this.stage;
    const seed = (this.rng.float() * 2 ** 32) >>> 0;
    this.session = new Session(st, seed, { maxDist: st.goal * 1.25 });
    this.flock.members.forEach((m, i) => {
      const net = this.nets[i] || (this.nets[i] = new MLP(this.flock.nIn, this.flock.nHid, this.flock.nOut));
      net.w = m.genome;
      const b = new Bird({ x: this.rng.range(-2.2, 2.2), y: WORLD.START_Y + this.rng.range(-1.6, 1.6) });
      b.ctrl = (bb) => net.forward(bb.inp, bb.out);
      b.member = m;
      b.net = net;
      const fam = FAMILIES[m.family];
      b.look = { color: fam.color, dark: fam.dark, scale: 0.68 };
      this.session.add(b);
    });
    this.stepper.reset();
    this.genGoal = false;
    this.genStartBest = this.flock.bestByStage[st.id] || 0;
    this.recordShown = false;
    this.phase = 'run';
    this.phaseT = 0;
    app.world.clearParticles();
    app.world.snapCamera(this.focusBird() || this.session.birds[0]);
  }

  endGen() {
    const app = this.app, g = app.game, st = this.stage, f = this.flock;
    const birds = this.session.birds;
    let bestDist = 0, bestBird = null, finished = 0;
    for (const b of birds) {
      const m = b.member;
      m.fitness = b.dist + b.bonus;
      m.dist = b.dist;
      m.rows = b.rows;
      m.cause = b.cause;
      if (b.dist > bestDist) { bestDist = b.dist; bestBird = b; }
      if (b.dist >= st.goal) finished++;
    }
    const rec = g.stageRec(st.id);
    const prevBest = f.bestByStage[st.id] || 0;
    const gen = f.gen;
    const sum = f.evolve(st.id);
    if (bestDist > rec.best) rec.best = bestDist;
    const cleared = finished > 0;
    let clearInfo = null;
    if (cleared && !rec.evo) clearInfo = g.markClear(this.stageIdx, 'evo');
    g.saveSoon(!!clearInfo);
    this.summary = {
      gen, best: bestDist, avg: sum.avg, prev: prevBest, record: bestDist > prevBest + 0.5, causes: sum.causes,
      finished, div: sum.div, bestName: bestBird ? bestBird.member.name : '', bestFam: bestBird ? bestBird.member.family : 0,
      top: sum.top, fam: sum.fam,
    };
    this.stagnant = this.summary.record ? 0 : this.stagnant + 1;
    this.comment(this.summary);
    if (clearInfo && clearInfo.first) {
      this.turbo = false;
      this.phase = 'clear';
      this.phaseT = 0;
      this.clearInfo = clearInfo;
      app.sfx('clear');
      app.prof.say(`やったぞ！ 第${gen}世代で ゴールまで飛べた！ ステージクリアじゃ！`, { prio: 3, dur: 6 });
      return;
    }
    if (this.turbo) { this.turboGens++; this.startGen(); return; }
    this.phase = 'summary';
    this.phaseT = 0;
    app.sfx(this.summary.record ? 'record' : 'gen');
  }

  // 世代の結果に合わせて博士がしゃべる
  comment(s) {
    const prof = this.app.prof, f = this.flock;
    if (this.turbo) return;
    if (s.gen === 1 && f.history.length <= 1) {
      prof.say('ほとんどすぐぶつかったな。でも少しでも遠くまで飛べた子が親になる。これが「自然選択」じゃ。', { prio: 2, dur: 7 });
      return;
    }
    if (s.record && s.prev > 0 && s.best > s.prev * 1.4 && s.best - s.prev > 30) {
      prof.say(`ぐんと伸びた！ ${Math.floor(s.prev)}m → ${Math.floor(s.best)}m。いい遺伝子の組み合わせが見つかったようじゃ。`, { prio: 2, key: 'jump', cool: 25 });
      return;
    }
    if (s.record) { prof.say(`きろく更新！ ${s.bestName}が ${Math.floor(s.best)}m 飛んだ。`, { prio: 1, key: 'record', cool: 18 }); return; }
    if (this.stagnant >= 10) {
      prof.say('伸びなやみか…。せっていで突然変異を「たかい」にすると、新しい動きが生まれやすいぞ。', { prio: 1, key: 'stag', cool: 60 });
      return;
    }
    if (s.div < 0.22) { prof.say('みんな似てきたな。多様性が下がると、新しい工夫が出にくくなるんじゃ。', { prio: 1, key: 'div', cool: 70 }); return; }
    const fam = s.fam;
    let mi = 0;
    for (let i = 1; i < fam.length; i++) if (fam[i] > fam[mi]) mi = i;
    if (fam[mi] / f.size > 0.55) {
      prof.say(`${FAMILIES[mi].name}家が むれの ${Math.round(fam[mi] / f.size * 100)}%に！ 強い血すじが広がっておる。`, { prio: 1, key: 'fam' + mi, cool: 80 });
    }
  }

  focusBird() {
    const s = this.session;
    if (!s) return null;
    const oshi = this.flock.oshiId;
    if (oshi != null) {
      const b = s.birds.find(bb => bb.member.id === oshi);
      if (b && b.alive) return b;
    }
    return s.leader || s.birds[0];
  }

  // ── 毎フレーム ──
  update(dt) {
    const app = this.app;
    this.blink += dt;
    this.phaseT += dt;
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
    const s = this.session;
    if (this.phase === 'run' && !this.overlay) {
      if (this.turbo) this.runTurbo();
      else {
        const sp = SPEEDS[this.speedIdx];
        this.stepper.run(dt, sp, () => { if (!this.session.done) { this.session.step(); this.handleEvents(); } }, 12);
        if (this.session.done) this.endGen();
      }
    } else if (this.phase === 'summary') {
      const dur = [1.6, 1.0, 0.65, 0.4][this.speedIdx];
      if (this.phaseT > dur) this.startGen();
    }
    const focus = this.focusBird();
    if (focus && focus.id !== this.lastFocusId) this.lastFocusId = focus.id;
    const ss = this.session;
    app.world.update(dt, { birds: ss.birds, course: ss.course, alpha: this.phase === 'run' ? this.stepper.alpha : 1, focus, T: ss.T, aspect: app.px.aspect });
  }

  // 高速しんか：時間の許すかぎり進める（世代もまたぐ）
  runTurbo() {
    const t0 = performance.now();
    let guard = 0;
    while (performance.now() - t0 < 14 && guard++ < 20000) {
      if (this.session.done) {
        this.endGen();
        if (this.phase !== 'run') return;
        continue;
      }
      this.session.step();
      if ((guard & 15) === 0) this.handleEvents(true);
    }
    this.handleEvents(true);
    this.stepper.alpha = 1;
  }

  handleEvents(quiet = false) {
    const app = this.app, w = app.world;
    const focus = this.focusBird();
    for (const e of this.session.drain()) {
      const b = e.bird;
      if (e.type === 'crash') {
        if (!quiet && Math.abs(b.z - w.camZ) < 45) w.burst(b.x, b.y, b.z, b.look.color, 12);
        if (b === focus || (b.member && b.member.id === this.flock.oshiId)) app.sfx('crash');
      } else if (e.type === 'pass') {
        if (b === focus && !quiet) { app.sfx('pass'); w.sparkle(b.x, b.y, b.z, w.theme.frame, 6); }
      }
    }
    // 飛んでいる最中に、この面の最高記録をこえたら知らせる
    if (!this.recordShown && !quiet && this.genStartBest > 25) {
      const lead = this.session.leader;
      if (lead && lead.alive && lead.dist > this.genStartBest && lead.dist < this.stage.goal) {
        this.recordShown = true;
        this.banner = { text: 'RECORD!', t: 0, dur: 1.5, color: C.magenta };
        app.sfx('record');
      }
    }
    if (!this.genGoal) {
      const lead = this.session.leader;
      if (lead && lead.dist >= this.stage.goal) {
        this.genGoal = true;
        if (!quiet) {
          this.banner = { text: 'GOAL!', t: 0, dur: 1.8, color: C.lime };
          w.sparkle(lead.x, lead.y, lead.z, 0xfee761, 14);
          app.sfx('record');
        }
      }
    }
  }

  setTab(i) { this.tab = i; }

  toggleTurbo() {
    this.turbo = !this.turbo;
    this.turboGens = 0;
    if (this.turbo) {
      if (this.phase === 'summary') this.startGen();
      this.app.prof.say('高速しんかモード！ 画面の動きはとばして、何世代も一気に進めるぞ。もう一度おすと止まる。', { prio: 1, key: 'turbo', cool: 120 });
    }
  }

  // ── 描画 ──
  draw(fb) {
    const app = this.app, px = app.px;
    const VW = px.VW, VH = px.VH, top = px.safe.t;
    const viewH = this.viewHeight();
    this.drawMarkers(fb, viewH);
    this.drawHUD(fb, VW, top);
    // 中央のお知らせ
    if (this.banner) {
      if (Math.floor(this.banner.t * 6) % 2 === 0 || this.banner.t > 0.6) {
        mini(fb, this.banner.text, VW / 2 + 2, Math.round(viewH * 0.36) + 2, C.ink, 'center', 3);
        mini(fb, this.banner.text, VW / 2, Math.round(viewH * 0.36), this.banner.color, 'center', 3);
      }
    }
    if (this.turbo) this.drawTurbo(fb, VW, viewH);
    if (this.phase === 'summary' && this.summary) this.drawSummary(fb, VW, viewH);
    // 博士
    if (!this.overlay && this.phase !== 'clear') {
      const lines = 3;
      const bh = app.prof.busy ? (Math.min(lines, 3) * 12 + 5) : 0;
      if (bh) app.prof.draw(fb, 4, viewH - bh - 4 - 6, VW - 8, lines);
    }
    this.drawPanel(fb, VW, VH, viewH);
    if (this.phase === 'clear') this.drawClear(fb, VW, VH, viewH);
    if (this.overlay === 'settings') this.drawSettings(fb, VW, VH);
    else if (this.overlay === 'reset') this.drawReset(fb, VW, VH);
  }

  drawHUD(fb, VW, top) {
    const app = this.app, st = this.stage, f = this.flock, s = this.session;
    fb.rect(0, top, VW, HUD_H - 6, C.ink);
    fb.rect(0, top + HUD_H - 6, VW, 1, C.navy);
    button(app, 'ev_back', 3, top + 2, 20, 14, '', () => { app.sfx('back'); app.go('stages', { mode: 'evolve' }); }, { icon: ICON.back });
    mini(fb, 'ST' + st.id, 27, top + 6, C.cyan);
    text(fb, st.name, 27 + miniMeasure('ST' + st.id) + 4, top + 2, C.white);
    const camW = 20;
    button(app, 'ev_gear', VW - 23, top + 2, 20, 14, '', () => { this.overlay = 'settings'; }, { icon: ICON.gear });
    button(app, 'ev_cam', VW - 23 - camW - 2, top + 2, camW, 14, '', () => {
      const m = (app.world.cam.mode + 1) % 3;
      app.world.setCamMode(m); app.game.settings.cam = m; app.game.saveSettings();
    }, { icon: ICON.camera });
    // 2行目：世代・生き残り・速さ
    const y2 = top + 18;
    text(fb, `第${f.gen}世代`, 4, y2 - 1, C.yellow);
    const genW = 4 + measure(`第${f.gen}世代`) + 4;
    mini(fb, `${s.aliveCount}/${s.birds.length}`, genW, y2 + 3, C.silver);
    // 速さボタン
    let bx = VW - 3 - 18;
    button(app, 'ev_turbo', bx, y2, 18, 12, '', () => this.toggleTurbo(), { icon: ICON.turbo, active: this.turbo });
    for (let i = SPEEDS.length - 1; i >= 0; i--) {
      bx -= 16;
      button(app, 'ev_sp' + i, bx, y2, 15, 12, SPEEDS[i] + 'X', () => { this.speedIdx = i; this.turbo = false; }, { mini: true, active: !this.turbo && this.speedIdx === i });
    }
    // 進み具合バー（先頭の距離／ゴール）
    const by = top + HUD_H - 4;
    const lead = s.leader;
    const d = lead ? lead.dist : 0;
    const bw = VW - 20;
    fb.rect(4, by - 1, bw + 2, 5, C.ink);
    fb.rect(5, by, bw, 3, C.navy);
    fb.rect(5, by, Math.round(bw * Math.min(1, d / st.goal)), 3, d >= st.goal ? C.lime : C.yellow);
    const best = f.bestByStage[st.id] || 0;
    if (best > 0) { const mx = 5 + Math.round(bw * Math.min(1, best / st.goal)); fb.rect(mx, by - 1, 1, 5, C.white); }
    fb.icon(ICON.flag, VW - 13, by - 4, d >= st.goal ? C.lime : C.white);
  }

  drawMarkers(fb, viewH) {
    const app = this.app, px = app.px, w = app.world;
    const s = this.session;
    const focus = this.focusBird();
    const lead = s.leader;
    const a = this.phase === 'run' ? this.stepper.alpha : 1;
    const mark = (b, icon, col, label) => {
      if (!b || !b.alive) return;
      const x = b.px + (b.x - b.px) * a, y = b.py + (b.y - b.py) * a, z = b.pz + (b.z - b.pz) * a;
      const p = w.project(x, y + 0.9, z, px.VW, viewH);
      if (!p || p.y < px.safe.t + HUD_H || p.y > viewH - 4 || p.x < 0 || p.x > px.VW) return;
      const bob = Math.round(Math.sin(this.blink * 6) * 1);
      fb.icon(icon, p.x - 3 + 1, p.y - 9 + bob + 1, C.ink);
      fb.icon(icon, p.x - 3, p.y - 9 + bob, col);
      if (label) text(fb, label, p.x, p.y - 22 + bob, C.white, { align: 'center', outline: C.ink });
    };
    if (lead && lead !== focus) mark(lead, ICON.crown, C.yellow);
    if (focus) {
      const isOshi = focus.member.id === this.flock.oshiId;
      mark(focus, isOshi ? ICON.heart : ICON.crown, isOshi ? C.pink : C.yellow, w.cam.mode === 0 ? null : focus.member.name);
    }
  }

  drawTurbo(fb, VW, viewH) {
    const y = Math.round(viewH * 0.5) - 14;
    fb.rect(VW / 2 - 60, y, 120, 26, C.ink);
    fb.frame(VW / 2 - 59, y + 1, 118, 24, C.cyan);
    mini(fb, 'TURBO', VW / 2, y + 4, Math.floor(this.blink * 4) % 2 ? C.cyan : C.white, 'center', 2);
    text(fb, `+${this.turboGens}世代`, VW / 2, y + 14, C.silver, { align: 'center' });
  }

  drawSummary(fb, VW, viewH) {
    const s = this.summary;
    const w = 168, h = 74;
    const x = Math.round((VW - w) / 2), y = Math.round(viewH * 0.42 - h / 2);
    panel(fb, x, y, w, h, { fill: C.ink, border: C.cyan });
    text(fb, `第${s.gen}世代 のけっか`, x + 8, y + 4, C.cyan);
    text(fb, 'さいこう', x + 8, y + 18, C.silver);
    text(fb, `${Math.floor(s.best)}m`, x + 62, y + 18, C.yellow);
    if (s.record) text(fb, 'きろく!', x + w - 8, y + 18, Math.floor(this.blink * 6) % 2 ? C.magenta : C.pink, { align: 'right' });
    text(fb, 'へいきん', x + 8, y + 30, C.silver);
    text(fb, `${Math.floor(s.avg)}m`, x + 62, y + 30, C.cyan);
    // 死因の内訳
    const parts = Object.entries(s.causes).map(([k, v]) => ({ v, c: CAUSE_COLORS[k] || C.gray }));
    drawShares(fb, x + 8, y + 45, w - 16, 5, parts);
    const n = Math.min(3, Math.floor(this.phaseT * 6));
    const dots = '.'.repeat(n);
    text(fb, `こどもを うんでいます${dots}`, x + 8, y + 56, C.white);
  }

  drawClear(fb, VW, VH, viewH) {
    const app = this.app;
    dim(fb, 0, 0, VW, VH);
    const w = 176, h = 132;
    const x = Math.round((VW - w) / 2), y = Math.round(Math.max(app.px.safe.t + 30, viewH * 0.5 - h / 2));
    panel(fb, x, y, w, h, { fill: C.navy, border: C.yellow });
    const blink = Math.floor(this.phaseT * 4) % 2;
    mini(fb, 'STAGE', VW / 2 + 1, y + 9, C.ink, 'center', 3);
    mini(fb, 'STAGE', VW / 2, y + 8, blink ? C.yellow : C.gold, 'center', 3);
    mini(fb, 'CLEAR!', VW / 2 + 1, y + 28, C.ink, 'center', 3);
    mini(fb, 'CLEAR!', VW / 2, y + 27, blink ? C.gold : C.yellow, 'center', 3);
    const s = this.summary;
    text(fb, `第${s.gen}世代で ゴール！`, VW / 2, y + 48, C.white, { align: 'center' });
    text(fb, `${s.finished}羽が ${this.stage.goal}m を こえた`, VW / 2, y + 60, C.silver, { align: 'center' });
    const hasNext = this.stageIdx + 1 < STAGES.length;
    let by = y + 78;
    if (hasNext) {
      button(app, 'clr_next', x + 10, by, w - 20, 18, 'つぎのステージへ', () => {
        app.go('evolve', { stageIdx: this.stageIdx + 1 });
      }, { accent: C.yellow, icon: ICON.next });
      by += 22;
    } else {
      text(fb, 'ぜんステージ せいは！', VW / 2, by + 3, C.lime, { align: 'center' });
      by += 22;
    }
    button(app, 'clr_stay', x + 10, by, w - 20, 18, 'このまま きたえる', () => {
      this.phase = 'summary'; this.phaseT = 0;
    });
  }

  drawSettings(fb, VW, VH) {
    const app = this.app, f = this.flock, g = app.game;
    dim(fb, 0, 0, VW, VH);
    const w = Math.min(VW - 12, 200), h = 212;
    const x = Math.round((VW - w) / 2), y = Math.round(Math.max(app.px.safe.t + 8, (VH - h) / 2 - 10));
    panel(fb, x, y, w, h, { fill: C.navy, border: C.cyan, title: 'しんかの せってい' });
    let yy = y + 12;
    text(fb, '突然変異の強さ', x + 8, yy, C.white); yy += 12;
    const bw = Math.floor((w - 16 - 8) / 3);
    MUTATION.forEach((mu, i) => {
      button(app, 'set_mut' + i, x + 8 + i * (bw + 4), yy, bw, 16, mu.label, () => { f.mutIdx = i; g.saveFlock(); }, { active: f.mutIdx === i });
    });
    yy += 19;
    text(fb, ['変化がすくなく安定', '標準', '変化が大きく冒険的'][f.mutIdx], x + 8, yy, C.silver); yy += 16;
    text(fb, '推しを 次の世代に のこす', x + 8, yy, C.white);
    toggle(app, 'set_oshi', x + w - 30, yy + 1, f.keepOshi, () => { f.keepOshi = !f.keepOshi; g.saveFlock(); });
    yy += 16;
    text(fb, 'カメラ', x + 8, yy, C.white); yy += 12;
    CAMS.forEach((c, i) => {
      button(app, 'set_cam' + i, x + 8 + i * (bw + 4), yy, bw, 16, c, () => { app.world.setCamMode(i); g.settings.cam = i; g.saveSettings(); }, { active: app.world.cam.mode === i });
    });
    yy += 22;
    text(fb, `むれの数（リセット時）`, x + 8, yy, C.white); yy += 12;
    POP_SIZES.forEach((n, i) => {
      button(app, 'set_pop' + i, x + 8 + i * (bw + 4), yy, bw, 16, `${n}羽`, () => { this.nextPop = n; }, { active: (this.nextPop || f.size) === n });
    });
    yy += 22;
    button(app, 'set_reset', x + 8, yy, w - 16, 18, 'むれを はじめから やりなおす', () => { this.overlay = 'reset'; }, { accent: C.red });
    yy += 24;
    button(app, 'set_close', x + 8, yy, w - 16, 18, 'とじる', () => { this.overlay = null; }, { accent: C.cyan });
  }

  drawReset(fb, VW, VH) {
    const app = this.app;
    dim(fb, 0, 0, VW, VH);
    const w = Math.min(VW - 16, 190), h = 92;
    const x = Math.round((VW - w) / 2), y = Math.round((VH - h) / 2);
    panel(fb, x, y, w, h, { fill: C.navy, border: C.red });
    text(fb, 'むれを リセットしますか？', VW / 2, y + 8, C.white, { align: 'center' });
    text(fb, '脳はぜんぶ でたらめに戻ります', VW / 2, y + 22, C.silver, { align: 'center' });
    text(fb, '（クリア記録は消えません）', VW / 2, y + 34, C.silver, { align: 'center' });
    const bw = Math.floor((w - 24) / 2);
    button(app, 'rst_yes', x + 8, y + 56, bw, 20, 'リセット', () => {
      const n = this.nextPop || this.flock.size;
      this.flock = app.game.newFlock(n);
      this.nets = [];
      this.overlay = null;
      this.summary = null;
      this.stagnant = 0;
      this.startGen();
      app.prof.say('新しいヒナたちじゃ。また一から学ぶぞ。', { prio: 2 });
    }, { accent: C.red });
    button(app, 'rst_no', x + 16 + bw, y + 56, bw, 20, 'やめる', () => { this.overlay = 'settings'; });
  }

  // ── 下のパネル ──
  drawPanel(fb, VW, VH, viewH) {
    const app = this.app;
    const y0 = viewH;
    fb.rect(0, y0, VW, VH - y0, C.navy);
    fb.rect(0, y0, VW, 1, C.ink);
    tabs(app, 'ev_tab', 0, y0 + 1, VW, 14, TABS, this.tab, (i) => this.setTab(i));
    const cy = y0 + 16;
    const ch = VH - app.px.safe.b - cy;
    if (this.tab === 0) this.panelBrain(fb, VW, cy, ch);
    else if (this.tab === 1) this.panelGraph(fb, VW, cy, ch);
    else if (this.tab === 2) this.panelFlock(fb, VW, cy, ch);
    else this.panelDNA(fb, VW, cy, ch);
  }

  panelBrain(fb, VW, y, h) {
    const b = this.focusBird();
    if (!b) return;
    const m = b.member;
    const fam = FAMILIES[m.family];
    fb.rect(6, y + 4, 7, 7, C.ink); fb.rect(7, y + 5, 5, 5, rgb(fam.color));
    text(fb, m.name, 16, y + 2, C.white);
    const isOshi = m.id === this.flock.oshiId;
    const role = isOshi ? '推し' : (b === this.session.leader ? 'トップ' : '');
    if (role) text(fb, role, 16 + measure(m.name) + 5, y + 2, isOshi ? C.pink : C.yellow);
    text(fb, `${Math.floor(b.dist)}m`, VW - 6, y + 2, b.alive ? C.cyan : C.steel, { align: 'right' });
    const by = y + 18;
    const bw = VW - 16 - 36;
    drawBrain(fb, b.net, b.inp, 8, by, bw, 50, { cell: 6, labels: true });
    drawStick(fb, VW - 20, by + 22, 13, b.out[0], b.out[1], C.yellow);
    mini(fb, 'OUT', VW - 20, by + 39, C.gray, 'center');
    const ty = by + 58;
    text(fb, 'あかるいほど 近いかべ。のうが', 6, ty, C.silver);
    text(fb, '光の配置から よける向きを決める', 6, ty + 12, C.silver);
    if (!b.alive) text(fb, `${CAUSE_LABEL[b.cause] || 'ゴール'}で とまった`, VW - 6, ty + 24, C.steel, { align: 'right' });
    else text(fb, '▶ むれタブで推しをえらべる', 6, ty + 24, C.steel);
  }

  panelGraph(fb, VW, y, h) {
    const f = this.flock, st = this.stage;
    const hist = f.history;
    const n = Math.min(hist.length, 80);
    const H = hist.slice(hist.length - n);
    text(fb, '学習きょくせん', 6, y + 1, C.white);
    fb.rect(VW - 86, y + 5, 6, 2, C.yellow); text(fb, 'さいこう', VW - 78, y + 1, C.silver);
    fb.rect(VW - 38, y + 5, 6, 2, C.cyan); text(fb, '平均', VW - 30, y + 1, C.silver);
    const cy = y + 15, ch = 62;
    let ymax = st.goal * 1.3;
    for (const r of H) if (r.best > ymax) ymax = r.best;
    const marks = [];
    for (let i = 1; i < H.length; i++) if (H[i].st !== H[i - 1].st) marks.push({ at: i / Math.max(1, H.length - 1), label: 'ST' + H[i].st });
    if (H.length) drawChart(fb, 8, cy, VW - 16, ch, [
      { data: H.map(r => r.avg), color: C.cyan },
      { data: H.map(r => r.best), color: C.yellow, dot: true },
    ], { ymax, goal: st.goal, marks });
    else { fb.rect(8, cy, VW - 16, ch, C.ink); text(fb, '1世代目を飛んでいます…', VW / 2, cy + ch / 2 - 5, C.steel, { align: 'center' }); }
    if (H.length) {
      mini(fb, `G${H[0].g}`, 9, cy + ch + 3, C.steel);
      mini(fb, `G${H[H.length - 1].g}`, VW - 9, cy + ch + 3, C.steel, 'right');
    }
    mini(fb, `${Math.round(ymax)}m`, 10, cy + 2, C.steel);
    const sy = cy + ch + 11;
    const best = f.bestByStage[st.id] || 0;
    text(fb, `この面の最高 ${Math.floor(best)}m`, 6, sy, C.yellow);
    const last = H[H.length - 1];
    text(fb, `平均 ${last ? Math.floor(last.avg) : 0}m`, VW - 6, sy, C.cyan, { align: 'right' });
    const div = f.diversity();
    text(fb, '多様性', 6, sy + 13, C.silver);
    bar(fb, 46, sy + 17, VW - 92, 4, div, div < 0.25 ? C.orange : C.lime, C.ink);
    text(fb, `${Math.round(div * 100)}%`, VW - 6, sy + 13, C.silver, { align: 'right' });
  }

  panelFlock(fb, VW, y, h) {
    const app = this.app, f = this.flock, s = this.session;
    // 家系の割合
    const fam = f.familyCounts();
    const parts = [];
    fam.forEach((v, i) => { if (v > 0) parts.push({ v, c: rgb(FAMILIES[i].color), i }); });
    drawShares(fb, 7, y + 3, VW - 14, 5, parts);
    parts.sort((a, b) => b.v - a.v);
    let lx = 7;
    for (let k = 0; k < Math.min(3, parts.length); k++) {
      const p = parts[k];
      const label = `${FAMILIES[p.i].name}${Math.round(p.v / f.size * 100)}%`;
      fb.rect(lx, y + 13, 5, 5, p.c);
      text(fb, label, lx + 7, y + 10, C.silver);
      lx += 7 + measure(label) + 6;
    }
    // ヒナの一覧
    const cw = 11, chh = 10;
    const perRow = Math.max(1, Math.floor((VW - 12) / cw));
    const gx = Math.round((VW - perRow * cw) / 2), gy = y + 24;
    const byId = new Map();
    for (const b of s.birds) byId.set(b.member.id, b);
    const focus = this.focusBird();
    f.members.forEach((m, i) => {
      const cx = gx + (i % perRow) * cw, cyy = gy + Math.floor(i / perRow) * chh;
      const b = byId.get(m.id);
      const alive = b ? b.alive : false;
      const finished = b && b.cause === 'finish';
      app.ui.btn('fl_' + m.id, cx, cyy, cw, chh, () => {
        app.sfx('tap');
        f.oshiId = f.oshiId === m.id ? null : m.id;
        if (f.oshiId != null) {
          app.prof.say(`${m.name}を推しにした。カメラが追いかけるぞ。せっていで「推しを残す」がONなら、次の世代にも必ず残る。`, { prio: 1, key: 'oshi', cool: 90 });
        }
      });
      fb.sprite(alive || finished ? CHICK : CHICK_DEAD, cx + 1, cyy + 1, alive || finished ? this.famCols[m.family] : this.deadCols);
      if (m.elite) fb.rect(cx + 2, cyy + 9, 6, 1, C.yellow);
      if (m.id === f.oshiId) fb.icon(ICON.heart, cx + 2, cyy - 1, Math.floor(this.blink * 4) % 2 ? C.pink : C.magenta);
      if (b && b === focus && Math.floor(this.blink * 3) % 2) fb.frame(cx, cyy, cw, chh, C.white);
    });
    const rows = Math.ceil(f.members.length / perRow);
    const iy = gy + rows * chh + 4;
    const sel = f.oshiId != null ? f.member(f.oshiId) : null;
    if (sel) {
      const b = byId.get(sel.id);
      text(fb, `推し: ${sel.name}  第${sel.born}世代生まれ`, 6, iy, C.pink);
      text(fb, sel.elite ? `エリートとして ${sel.age}回 生き残り` : (sel.parents ? `親: ${FAMILIES[sel.parents[0].family].name}${sel.parents[0].id} と ${FAMILIES[sel.parents[1].family].name}${sel.parents[1].id}` : '最初の世代のヒナ'), 6, iy + 12, C.silver);
      void b;
    } else {
      text(fb, 'ヒナをタップすると「推し」になる', 6, iy, C.silver);
      text(fb, '黄色い線 = 前の世代からのエリート', 6, iy + 12, C.steel);
    }
  }

  panelDNA(fb, VW, y, h) {
    const b = this.focusBird();
    if (!b) return;
    const m = b.member;
    const cols = 22, size = 2;
    const blink = Math.floor(this.blink * 3) % 2 === 0;
    text(fb, `${m.name} の DNA（脳の重み ${m.genome.length}こ）`, 6, y + 1, C.white);
    const my = y + 24;
    if (m.parents) {
      const [A, B] = m.parents;
      const xs = [8, 8 + 44 + 14, 8 + (44 + 14) * 2];
      text(fb, 'おやA', xs[0], my - 11, rgb(FAMILIES[A.family].color));
      text(fb, 'おやB', xs[1], my - 11, rgb(FAMILIES[B.family].color));
      text(fb, 'こども', xs[2], my - 11, C.white);
      drawDNA(fb, A.genome, xs[0], my, cols, size);
      drawDNA(fb, B.genome, xs[1], my, cols, size);
      const srcColors = [rgb(FAMILIES[A.family].dark), rgb(FAMILIES[B.family].color)];
      drawDNA(fb, m.genome, xs[2], my, cols, size, { src: m.src, srcColors, mut: m.mut, blink });
      mini(fb, '+', xs[0] + 50, my + 18, C.white);
      mini(fb, '=', xs[1] + 50, my + 18, C.white);
      mini(fb, `${Math.floor(A.dist || 0)}M`, xs[0], my + 44, C.steel);
      mini(fb, `${Math.floor(B.dist || 0)}M`, xs[1], my + 44, C.steel);
      let nm = 0;
      if (m.mut) for (let i = 0; i < m.mut.length; i++) nm += m.mut[i];
      const ty = my + 54;
      text(fb, m.crossed ? '交叉: 親の脳をニューロンごとに混ぜた' : 'コピー: 親Aの脳を そのまま受けついだ', 6, ty, C.silver);
      text(fb, `突然変異: 白く光る遺伝子 ${nm}こ`, 6, ty + 12, C.silver);
      if (m.elite) text(fb, `エリート（${m.age}世代 生き残り中）`, 6, ty + 24, C.yellow);
    } else {
      drawDNA(fb, m.genome, 8, my, cols, size);
      text(fb, '青=プラス', 62, my, C.sky);
      text(fb, '赤=マイナスの重み', 62, my + 12, C.pink);
      if (m.born <= 1) {
        text(fb, '第1世代は ランダムな DNA から', 6, my + 50, C.silver);
        text(fb, '生まれた。親はいない', 6, my + 62, C.silver);
      } else {
        text(fb, '親の記録は 保存されていない', 6, my + 50, C.silver);
        text(fb, '（つづきから 再開した世代）', 6, my + 62, C.steel);
      }
      text(fb, '子が生まれると 親とのつながりが見える', 6, my + 76, C.steel);
    }
  }
}

