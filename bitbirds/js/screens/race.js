// きそう（レース）画面：自分で飛ばして、育てたAIや教えたヒナと競争する

import { C, text, mini, measure, button, panel, bar, dim, toggle } from '../ui/widgets.js';
import { ICON, CHICK, colors } from '../gfx/sprites.js';
import { STAGES, WORLD, FAMILIES, CHICK_LOOK, PLAYER_LOOK, PAL, NET } from '../core/config.js';
import { Session, Bird, CAUSE_LABEL, N_IN } from '../sim/flight.js';
import { MLP } from '../ml/nn.js';
import { Stepper, demoGenome } from '../game/demo_flight.js';
import { Stick } from '../ui/stick.js';
import { drawEye, drawStick } from '../ui/viz.js';
import { rgb } from '../gfx/fb.js';
import { RNG } from '../core/rng.js';

const PANEL_H = 96;
const HUD_H = 38;
const PROF_LOOK = { color: PAL.silver, dark: PAL.steel };

export class RaceScreen {
  constructor(app) {
    this.app = app;
    this.rng = new RNG();
    this.stepper = new Stepper();
    this.stick = new Stick(22);
    this.blink = 0;
    this.sel = { champ: true, chick: true, prof: true };
  }

  enter(p) {
    const app = this.app, g = app.game;
    this.stageIdx = p.stageIdx ?? 0;
    this.stage = STAGES[this.stageIdx];
    this.stick.reset();
    app.world.setTheme(this.stage.theme);
    app.world.setCamMode(0);
    app.world.setGoal(-this.stage.goal);
    app.demo.dirty = true;
    app.sound.setMood('race');
    // あいての候補
    const f = g.flock, c = g.chick, demo = demoGenome();
    const champ = f && f.members.length ? f.members[0] : null;
    this.cands = [
      { key: 'champ', name: champ ? `むれのエース ${champ.name}` : 'むれのエース', sub: champ ? `第${f.gen}世代の群れから` : 'まだ群れがいない', avail: !!(champ && f.history.length > 0), genome: champ && champ.genome, look: champ ? { color: FAMILIES[champ.family].color, dark: FAMILIES[champ.family].dark } : null },
      { key: 'chick', name: 'おしえたヒナ', sub: c && c.steps > 100 ? `お手本 ${c.added}こで学習` : 'まだ教えていない', avail: !!(c && c.steps > 100), genome: c && c.net.w, look: CHICK_LOOK },
      { key: 'prof', name: '博士のヒナ', sub: 'よく鍛えられた見本', avail: !!demo, genome: demo, look: PROF_LOOK },
    ];
    this.phase = 'lobby';
    this.phaseT = 0;
    this.results = null;
    this.prepare();
    if (!g.seen.race) {
      g.seen.race = true; g.saveProgress();
      app.prof.say('自分で飛んで、AIたちと競争じゃ。ゴールに一番近づいた者の勝ち！', { prio: 2 });
    }
  }

  exit() { this.stick.reset(); }

  viewHeight() { return this.app.px.VH - this.app.px.safe.b - PANEL_H; }

  // コースと参加者を用意（スタート前は止まっている）
  prepare() {
    const app = this.app, st = this.stage;
    this.session = new Session(st, (this.rng.float() * 2 ** 32) >>> 0, { maxDist: st.goal });
    const player = new Bird({ x: 0, y: WORLD.START_Y });
    player.ctrl = (b) => { const v = this.stick.value(); b.out[0] = v.x; b.out[1] = v.y; };
    player.look = PLAYER_LOOK;
    player.label = 'あなた';
    player.isPlayer = true;
    this.player = this.session.add(player);
    this.racers = [player];
    const offs = [[-2.2, 0.6], [2.2, 0.6], [0, -1.6]];
    let k = 0;
    for (const c of this.cands) {
      if (!c.avail || !this.sel[c.key]) continue;
      const net = new MLP(N_IN, NET.hid, NET.out, new Float32Array(c.genome));
      if (net.size !== c.genome.length) continue;
      const [ox, oy] = offs[k++ % offs.length];
      const b = new Bird({ x: ox, y: WORLD.START_Y + oy });
      b.ctrl = (bb) => net.forward(bb.inp, bb.out);
      b.net = net;
      b.look = c.look;
      b.label = c.key === 'champ' ? 'エース' : c.key === 'chick' ? 'おしえたヒナ' : '博士のヒナ';
      this.session.add(b);
      this.racers.push(b);
    }
    this.stepper.reset();
    app.world.clearParticles();
    app.world.snapCamera(player);
  }

  start() {
    this.prepare();
    this.phase = 'count';
    this.phaseT = 0;
    this.lastBeep = -1;
  }

  update(dt) {
    const app = this.app;
    this.blink += dt;
    this.phaseT += dt;
    const s = this.session;
    if (this.phase === 'count') {
      const n = Math.floor(this.phaseT);
      if (n !== this.lastBeep && n < 3) { this.lastBeep = n; app.sfx('count'); }
      if (this.phaseT >= 3) { this.phase = 'race'; this.phaseT = 0; app.sfx('go'); }
    } else if (this.phase === 'race') {
      this.stepper.run(dt, 1, () => { if (!s.done) { s.step(); this.handleEvents(); } });
      if (!this.player.alive && this.deadT === undefined) this.deadT = 0;
      if (this.deadT !== undefined) this.deadT += dt;
      if (s.done || (this.deadT !== undefined && this.deadT > 3.5)) this.finish();
    }
    const focus = this.player.alive || this.phase !== 'race' ? this.player : (s.leader || this.player);
    app.world.update(dt, { birds: s.birds, course: s.course, alpha: this.phase === 'race' ? this.stepper.alpha : 1, focus, T: s.T, aspect: app.px.aspect });
  }

  handleEvents() {
    const app = this.app, w = app.world;
    for (const e of this.session.drain()) {
      const b = e.bird;
      if (e.type === 'crash') { w.burst(b.x, b.y, b.z, b.look.color, 14); if (b.isPlayer || Math.abs(b.z - w.camZ) < 25) app.sfx('crash'); }
      else if (e.type === 'pass' && b.isPlayer) { app.sfx('pass'); w.sparkle(b.x, b.y, b.z, w.theme.frame, 6); }
      else if (e.type === 'finish') { w.sparkle(b.x, b.y, b.z, 0xfee761, 12); if (b.isPlayer) app.sfx('record'); }
    }
  }

  finish() {
    const app = this.app, g = app.game;
    this.deadT = undefined;
    const goal = this.stage.goal;
    const list = this.racers.map(b => ({ b, d: Math.min(goal, b.dist), fin: b.dist >= goal - 0.01, t: b.deathT }));
    // ゴールした者同士は早くゴールした方が上
    list.sort((a, c) => (c.d - a.d) || (a.fin && c.fin ? a.t - c.t : 0));
    const rank = list.findIndex(r => r.b.isPlayer) + 1;
    const win = rank === 1 && this.racers.length > 1;
    this.results = { list, rank, win };
    this.phase = 'result';
    this.phaseT = 0;
    if (win) {
      const info = g.markClear(this.stageIdx, 'race');
      app.sfx('win');
      app.prof.say(info.first ? 'きみの勝ちじゃ！ AIに勝つとは、さすがの腕前！' : 'また勝ったな！', { prio: 2 });
    } else {
      app.sfx('lose');
      const top = list[0].b;
      if (!top.isPlayer) app.prof.say(`${top.label}の勝ち。AIは0.03秒ごとに目の情報で判断しておる。手ごわいぞ。`, { prio: 1, key: 'lose', cool: 40 });
    }
  }

  draw(fb) {
    const app = this.app, px = app.px;
    const VW = px.VW, VH = px.VH, top = px.safe.t;
    const viewH = this.viewHeight();
    if (this.phase === 'race' || this.phase === 'count') {
      app.ui.area('race_stick', 0, top + HUD_H, VW, viewH - top - HUD_H, this.stick.handlers());
    }
    this.drawHUD(fb, VW, top);
    this.drawLabels(fb, viewH);
    const cy = Math.round(viewH * 0.45);
    if (this.phase === 'count') {
      const n = 3 - Math.floor(this.phaseT);
      mini(fb, String(n), VW / 2 + 2, cy - 18, C.ink, 'center', 6);
      mini(fb, String(n), VW / 2, cy - 20, C.yellow, 'center', 6);
      text(fb, 'ドラッグで そうじゅう', VW / 2, cy + 16, C.white, { align: 'center', outline: C.ink });
    } else if (this.phase === 'race' && this.phaseT < 0.8) {
      mini(fb, 'GO!', VW / 2 + 2, cy - 13, C.ink, 'center', 5);
      mini(fb, 'GO!', VW / 2, cy - 15, C.lime, 'center', 5);
    } else if (this.phase === 'race' && !this.player.alive) {
      text(fb, `${Math.floor(this.player.dist)}m で ぶつかった`, VW / 2, cy, C.white, { align: 'center', outline: C.ink });
    }
    this.stick.draw(fb);
    if (app.prof.busy && this.phase !== 'race') {
      const bh = 3 * 12 + 5;
      app.prof.draw(fb, 4, viewH - bh - 8, VW - 8, 3);
    }
    this.drawPanel(fb, VW, VH, viewH);
    if (this.phase === 'lobby') this.drawLobby(fb, VW, VH);
    else if (this.phase === 'result') this.drawResult(fb, VW, VH);
  }

  drawHUD(fb, VW, top) {
    const app = this.app, st = this.stage;
    fb.rect(0, top, VW, HUD_H - 6, C.ink);
    fb.rect(0, top + HUD_H - 6, VW, 1, C.navy);
    button(app, 'ra_back', 3, top + 2, 20, 14, '', () => { app.sfx('back'); app.go('stages', { mode: 'race' }); }, { icon: ICON.back });
    text(fb, 'きそう', 27, top + 2, C.magenta);
    mini(fb, 'ST' + st.id, 27 + measure('きそう') + 5, top + 6, C.cyan);
    text(fb, st.name, 27 + measure('きそう') + 22, top + 2, C.white);
    // 順位と距離
    const sorted = [...this.racers].sort((a, b) => b.dist - a.dist);
    const rank = sorted.indexOf(this.player) + 1;
    text(fb, `${Math.floor(this.player.dist)}m`, 4, top + 17, C.white);
    text(fb, `${rank}位 / ${this.racers.length}`, VW - 4, top + 17, rank === 1 ? C.yellow : C.silver, { align: 'right' });
    // 全員の位置
    const by = top + HUD_H - 4, bw = VW - 20;
    fb.rect(4, by - 1, bw + 2, 5, C.ink);
    fb.rect(5, by, bw, 3, C.navy);
    for (const b of this.racers) {
      const x = 5 + Math.round(bw * Math.min(1, b.dist / st.goal));
      fb.rect(x - 1, by - 1, 3, 5, b.isPlayer ? C.white : rgb(b.look.color));
    }
    fb.icon(ICON.flag, VW - 13, by - 4, C.white);
  }

  drawLabels(fb, viewH) {
    const app = this.app, px = app.px, w = app.world;
    const a = this.phase === 'race' ? this.stepper.alpha : 1;
    for (const b of this.racers) {
      if (!b.alive || b.isPlayer) continue;
      const x = b.px + (b.x - b.px) * a, y = b.py + (b.y - b.py) * a, z = b.pz + (b.z - b.pz) * a;
      const p = w.project(x, y + 1.0, z, px.VW, viewH);
      if (!p || p.y < px.safe.t + HUD_H + 4 || p.y > viewH - 4) continue;
      text(fb, b.label, p.x, p.y - 12, rgb(b.look.color), { align: 'center', outline: C.ink });
    }
  }

  drawPanel(fb, VW, VH, viewH) {
    const y0 = viewH;
    fb.rect(0, y0, VW, VH - y0, C.navy);
    fb.rect(0, y0, VW, 1, C.ink);
    // 参加者リスト
    let y = y0 + 4;
    const goal = this.stage.goal;
    const list = [...this.racers].sort((a, b) => b.dist - a.dist);
    for (const b of list.slice(0, 4)) {
      fb.rect(5, y + 2, 6, 6, C.ink);
      fb.rect(6, y + 3, 4, 4, b.isPlayer ? C.white : rgb(b.look.color));
      text(fb, b.label, 14, y, b.alive ? C.white : C.steel);
      bar(fb, 82, y + 4, VW - 82 - 34, 3, b.dist / goal, b.isPlayer ? C.white : rgb(b.look.color), C.ink);
      mini(fb, `${Math.floor(b.dist)}m`, VW - 5, y + 3, b.alive ? C.silver : C.steel, 'right');
      y += 12;
    }
    // 一番前のAIの目（AIが何を見ているか）
    const ai = list.find(b => !b.isPlayer && b.alive) || list.find(b => !b.isPlayer);
    if (ai && y0 + 56 + 28 < VH) {
      const ey = y0 + 54;
      text(fb, `${ai.label}の目`, 6, ey, C.gray);
      drawEye(fb, ai.eye, 8, ey + 13, 4, true);
      drawStick(fb, 52, ey + 22, 9, ai.out[0], ai.out[1], rgb(ai.look.color));
      text(fb, 'あなたの目', VW / 2 + 10, ey, C.gray);
      drawEye(fb, this.player.eye, VW / 2 + 12, ey + 13, 4, true);
      drawStick(fb, VW / 2 + 56, ey + 22, 9, this.player.out[0], this.player.out[1], C.white);
    }
  }

  drawLobby(fb, VW, VH) {
    const app = this.app;
    dim(fb, 0, 0, VW, VH);
    const w = Math.min(VW - 12, 200), h = 196;
    const x = Math.round((VW - w) / 2), y = Math.round(Math.max(app.px.safe.t + 40, (VH - h) / 2 - 20));
    panel(fb, x, y, w, h, { fill: C.navy, border: C.magenta, title: 'レースの あいて' });
    let yy = y + 12;
    text(fb, `${this.stage.name}  ${this.stage.goal}m`, x + 8, yy, C.silver);
    yy += 16;
    for (const c of this.cands) {
      const on = c.avail && this.sel[c.key];
      fb.rect(x + 6, yy, w - 12, 30, C.slate);
      if (c.look) fb.sprite(CHICK, x + 10, yy + 11, colors({ c: rgb(c.look.color), d: rgb(c.look.dark) }));
      text(fb, c.name.length > 13 ? c.name.slice(0, 13) : c.name, x + 24, yy + 3, c.avail ? C.white : C.steel);
      text(fb, c.sub, x + 24, yy + 16, C.silver);
      if (c.avail) toggle(app, 'lob_' + c.key, x + w - 32, yy + 10, on, () => { this.sel[c.key] = !this.sel[c.key]; this.prepare(); });
      else text(fb, 'なし', x + w - 10, yy + 10, C.steel, { align: 'right' });
      yy += 34;
    }
    const any = this.cands.some(c => c.avail && this.sel[c.key]);
    button(app, 'lob_start', x + 8, yy + 4, w - 16, 20, any ? 'スタート！' : 'ひとりで とぶ', () => this.start(), { accent: C.magenta });
    text(fb, '勝つと ステージに ★', VW / 2, yy + 30, C.steel, { align: 'center' });
  }

  drawResult(fb, VW, VH) {
    const app = this.app, r = this.results;
    dim(fb, 0, 0, VW, VH);
    const w = Math.min(VW - 12, 196), h = 64 + r.list.length * 14 + 50;
    const x = Math.round((VW - w) / 2), y = Math.round(Math.max(app.px.safe.t + 30, (VH - h) / 2 - 20));
    panel(fb, x, y, w, h, { fill: C.navy, border: r.win ? C.yellow : C.steel });
    const title = r.win ? 'WIN!' : (this.racers.length > 1 ? 'LOSE' : 'FINISH');
    const blink = Math.floor(this.phaseT * 4) % 2;
    mini(fb, title, VW / 2 + 1, y + 9, C.ink, 'center', 4);
    mini(fb, title, VW / 2, y + 8, r.win ? (blink ? C.yellow : C.gold) : C.silver, 'center', 4);
    text(fb, r.win ? 'きみの勝ち！' : `${r.rank}位`, VW / 2, y + 32, C.white, { align: 'center' });
    let yy = y + 48;
    r.list.forEach((e, i) => {
      const b = e.b;
      text(fb, `${i + 1}`, x + 10, yy, i === 0 ? C.yellow : C.silver);
      fb.rect(x + 22, yy + 3, 5, 5, b.isPlayer ? C.white : rgb(b.look.color));
      text(fb, b.label, x + 30, yy, b.isPlayer ? C.white : C.silver);
      text(fb, e.fin ? 'ゴール' : `${Math.floor(e.d)}m`, x + w - 8, yy, e.fin ? C.lime : C.silver, { align: 'right' });
      yy += 14;
    });
    const bw = Math.floor((w - 20) / 2);
    button(app, 'res_again', x + 8, yy + 8, bw, 20, 'もういちど', () => { this.start(); }, { accent: C.magenta });
    button(app, 'res_back', x + 12 + bw, yy + 8, bw, 20, 'あいて変更', () => { this.phase = 'lobby'; this.prepare(); });
  }
}
