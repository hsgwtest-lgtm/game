// 試合の画面（CPUリーグ・ゴースト・アルバム・オンラインで共通）

import { C, TEAM } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text, mini, measure } from '../gfx/font.js';
import { shareBar } from '../ui/charts.js';
import { portrait, botPortrait, teamLook, CARD_COLOR } from '../ui/widgets.js';
import { RULE, EV } from '../sim/env.js';
import { EMOTES, CARD_ICONS } from '../gfx/sprites.js';
import { CARD } from '../sim/rewards.js';
import { fmtNum } from '../ui/deckedit.js';

const INTRO = 1.6;      // VS の表示
const COUNT = 3;        // 3,2,1

export class BattleScreen {
  constructor(app) { this.app = app; }

  // p: { mode, arena, seed, a:{spec,name,portrait,look,deck}, b:{...}, clock, onEnd, ret, retParams, online }
  enter(p) {
    const app = this.app;
    this.p = p;
    this.t = 0;
    this.phase = 'intro';
    this.speed = p.online ? 1 : (app.G.settings.bspeed || 1);
    this.ticker = [];
    this.res = null;
    this.lastLead = 0;
    this.endT = 0;
    this.emotes = [];
    this.emoteCool = 0;
    this.started = false;
    this.done = false;
    this.lastCount = 99;
    app.world.camMode = 'fit';
    app.world.zoom = 1;
    app.world.tilt = 1.2;
    app.world.focus = null;
    app.sound.playSong('battle');
    app.world.setArena(p.arena);
    // まだ動かさずに盤面だけ見せる
    this.match = app.spec.start({
      arena: p.arena, seed: p.seed, a: p.a.spec, b: p.b.spec, speed: 0.0001,
      deck: (p.me === 1 ? p.b.deck : p.a.deck) || null, side: p.me || 0, policy: -1, sfx: true,
      onEnd: (res) => this.onEnd(res),
      onStep: (m) => this.onStep(m),
    });
    app.spec.paused = true;
    if (p.online && p.online.onEmote) p.online.onEmote((e) => this.showEmote(e.side, e.e));
  }

  // 時計: オンラインは共通の時計、それ以外は自分の時間
  clock() {
    const p = this.p;
    if (p.clock) return p.clock();
    return this.t - INTRO - COUNT;
  }

  onStep(m) {
    const env = m.env, fx = env.fx, p = this.p;
    const nm = [p.a.name, p.b.name];
    if (fx) {
      for (const i of fx.stuns) this.say(`${nm[1 - i]}の命中！ ${nm[i]}がピヨった`, TEAM[1 - i].light);
      for (const b of fx.bombs) this.say(`${nm[b.i]}がペンキ爆弾！`, C.hotpink);
    }
    const lead = Math.sign(env.score(0) - env.score(1));
    if (lead !== 0 && lead !== this.lastLead && env.t > 30) this.say(`${nm[lead > 0 ? 0 : 1]}がリード！`, TEAM[lead > 0 ? 0 : 1].main);
    if (lead !== 0) this.lastLead = lead;
    if (env.t === RULE.T - 60) { this.say('のこり10秒！', C.gold); this.app.sound.play('count'); }
  }

  say(s, color) {
    this.ticker.push({ s, color, t: this.app.t });
    if (this.ticker.length > 6) this.ticker.shift();
  }

  onEnd(res) {
    this.res = res;
    this.phase = 'end';
    this.endT = 0;
    this.app.sound.play('whistle');
    const me = this.p.me || 0;
    setTimeout(() => this.app.sound.play(res.winner === me ? 'win' : res.winner === 1 - me ? 'lose' : 'click'), 500);
  }

  leave() { this.app.spec.stop(); this.app.world.zoom = 1; this.app.world.tilt = 1.12; }

  update(dt) {
    const app = this.app;
    this.t += dt;
    this.emoteCool -= dt;
    for (const e of this.emotes) e.t += dt;
    this.emotes = this.emotes.filter(e => e.t < 2.2);
    const c = this.clock();
    if (this.phase === 'intro' && c > -COUNT) { this.phase = 'count'; this.lastCount = 99; }
    if (this.phase === 'count') {
      const n = Math.ceil(-c);
      if (n !== this.lastCount && n > 0) { this.lastCount = n; app.sound.play('count'); }
      if (c >= 0) {
        this.phase = 'play';
        app.sound.play('go');
        app.spec.paused = false;
        app.spec.speed = this.speed;
        if (this.p.clock) app.spec.clock = () => Math.max(0, this.p.clock());
        this.say('スタート！', C.white);
      }
    }
    app.spec.update(dt);
    if (this.phase === 'end') {
      this.endT += dt;
      if (this.endT > 2.4) this.finish();
    }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    const p = this.p;
    if (p.onEnd) p.onEnd(this.res, this.match);
    else this.app.go('result', { battle: p, res: this.res });
  }

  _layout() {
    const app = this.app, H = app.H;
    const bottom = H - app.bottom;
    const ctrlY = bottom - 24;
    const tickY = ctrlY - 27;
    const meterY = tickY - 17;
    const statsY = meterY - 27;
    return { bottom, ctrlY, tickY, meterY, statsY, viewH: statsY - 3 };
  }

  view() { return { y: 0, h: this._layout().viewH, padT: this.app.top + 36, padB: 2 }; }

  showEmote(side, e) {
    this.emotes.push({ side, e, t: 0 });
    this.app.sound.play('emote');
  }

  draw(ui) {
    const app = this.app, fb = ui.fb, p = this.p;
    const W = ui.W;
    const L = this._layout();
    const env = app.spec.env;
    // ── 上の HUD ──
    const ty = app.top;
    fb.rect(0, 0, W, ty + 34, col(C.ink));
    fb.rect(0, ty + 34, W, 1, col(C.night));
    drawFace(fb, p.a, 4, ty + 1, 0);
    drawFace(fb, p.b, W - 20, ty + 1, 1);
    text(fb, p.a.name, 23, ty + 1, col(TEAM[0].light), { maxW: 70 });
    text(fb, p.b.name, W - 23, ty + 1, col(TEAM[1].light), { align: 'right', maxW: 70 });
    if (env) {
      mini(fb, String(env.score(0)), 23, ty + 13, col(C.white), 'left', 2);
      mini(fb, String(env.score(1)), W - 23, ty + 13, col(C.white), 'right', 2);
      const left = Math.max(0, Math.ceil((RULE.T - env.t) / RULE.STEPS_PER_SEC));
      const tc = left <= 10 && this.phase === 'play' && Math.floor(app.t * 4) % 2 ? C.scarlet : C.white;
      mini(fb, String(left), W >> 1, ty + 3, col(tc), 'center', 2);
      shareBar(fb, 23, ty + 27, W - 46, 4, env.score(0), env.score(1), env.floor);
    }
    // スタンプ
    for (const e of this.emotes) {
      const em = EMOTES[e.e];
      if (!em) continue;
      const x = e.side === 0 ? 8 : W - 30;
      const y = ty + 40 + Math.round(Math.sin(e.t * 6) * 2) - Math.round(e.t * 4);
      fb.rrect(x - 2, y - 2, 26, 26, col(C.white));
      fb.art(em.art, x + 2, y + 2, { '#': col(e.side === 0 ? TEAM[0].main : TEAM[1].main), '+': col(C.white), o: col(C.ink) }, 2);
      text(fb, em.label, x + 11, y + 25, col(C.white), { align: 'center', outline: col(C.ink) });
    }
    // ── 中央の表示 ──
    const cy = L.viewH >> 1;
    if (this.phase === 'intro') {
      const k = Math.min(1, this.t / 0.35);
      fb.checker(0, cy - 40, W, 80, col(C.ink));
      const ax = Math.round(-80 + k * 100), bx = Math.round(W + 80 - k * 100);
      drawFace(fb, p.a, ax - 16, cy - 30, 0, 2);
      drawFace(fb, p.b, bx - 16, cy - 30, 1, 2);
      text(fb, p.a.name, ax, cy + 6, col(TEAM[0].light), { align: 'center', outline: col(C.ink) });
      text(fb, p.b.name, bx, cy + 6, col(TEAM[1].light), { align: 'center', outline: col(C.ink) });
      text(fb, 'VS', W >> 1, cy - 14, col(C.gold), { align: 'center', scale: 2, outline: col(C.ink) });
      if (p.subtitle) text(fb, p.subtitle, W >> 1, cy + 24, col(C.white), { align: 'center', outline: col(C.ink) });
    } else if (this.phase === 'count') {
      const n = Math.ceil(-this.clock());
      if (n > 0 && n <= 3) mini(fb, String(n), W >> 1, cy - 15, col(C.white), 'center', 8);
    } else if (this.phase === 'play' && this.clock() < 0.8) {
      text(fb, 'GO!', W >> 1, cy - 12, col(C.gold), { align: 'center', scale: 3, outline: col(C.ink) });
    } else if (this.phase === 'end' && this.res) {
      const r = this.res;
      const s = this.endT < 1 ? 'FINISH!' : r.winner === 0 ? `${p.a.name}のかち！` : r.winner === 1 ? `${p.b.name}のかち！` : 'ひきわけ！';
      fb.checker(0, cy - 18, W, 36, col(C.ink));
      text(fb, s, W >> 1, cy - 11, col(this.endT < 1 ? C.white : r.winner === 0 ? TEAM[0].light : r.winner === 1 ? TEAM[1].light : C.gold), { align: 'center', scale: 2, outline: col(C.ink) });
    }
    // ── 下のパネル ──
    fb.rect(0, L.statsY - 2, W, L.bottom - L.statsY + 2 + app.bottom, col(C.ink));
    fb.rect(0, L.statsY - 3, W, 1, col(C.night));
    if (env) {
      const m = app.spec.match;
      const keys = [['brush', EV.PAINT], ['swap', EV.STEAL], ['target', EV.HIT], ['dizzy', EV.STUNNED], ['bomb', EV.ITEM]];
      for (let i = 0; i < 2; i++) {
        const yy = L.statsY + i * 12;
        fb.rect(4, yy + 1, 3, 9, col(TEAM[i].main));
        const ev = m ? m.ev[i] : null;
        let x = 11;
        for (const [ic, k] of keys) {
          fb.art(CARD_ICONS[ic], x, yy + 1, { '#': col(TEAM[i].light), '+': col(C.white), o: col(TEAM[i].dark) });
          const v = ev ? Math.round(ev[k]) : 0;
          text(fb, String(v), x + 11, yy, col(C.white));
          x += 11 + Math.max(10, String(v).length * 5) + 6;
        }
      }
    }
    // ごほうびメーター（自分のロボがいまもらっている報酬）
    const me = p.me || 0;
    const myDeck = me === 1 ? p.b.deck : p.a.deck;
    if (myDeck && myDeck.length && app.spec.W) {
      const cs = app.spec.cardSum;
      let pos = 0, neg = 0;
      for (const d of myDeck) { const v = cs[CARD[d.id].ev]; if (v > 0) pos += v; else neg -= v; }
      const tot = pos - neg;
      text(fb, 'ごほうび', 4, L.meterY + 2, col(C.leaf));
      text(fb, fmtNum(tot), W - 4, L.meterY + 2, col(tot >= 0 ? C.leaf : C.flesh), { align: 'right' });
      const bx = 50, bw = W - 50 - 44, by = L.meterY + 5;
      fb.rect(bx, by, bw, 6, col(C.night));
      const scale = bw / Math.max(1, pos + neg, 60);
      let x = bx;
      for (const d of myDeck) {
        const v = cs[CARD[d.id].ev];
        if (v <= 0) continue;
        const w = Math.round(v * scale);
        fb.rect(x, by, w, 6, col(CARD_COLOR[d.id] || C.mist));
        x += w;
      }
      if (neg > 0) fb.rect(bx + bw - Math.round(neg * scale), by, Math.round(neg * scale), 6, col(C.scarlet));
    }
    // ── 実況 ──
    const lines = this.ticker.slice(-2);
    lines.forEach((l, i) => text(fb, l.s, 6, L.tickY + i * 12, col(l.color), { maxW: W - 12 }));
    // ── 操作 ──
    const y = L.ctrlY;
    if (p.online) {
      // スタンプ
      const n = EMOTES.length;
      const bw = Math.floor((W - 8 - (n - 1) * 3) / n);
      EMOTES.forEach((em, i) => {
        const x = 4 + i * (bw + 3);
        const h = ui.hit('em-' + i, x, y, bw, 22);
        fb.rrect(x, y + (h.down ? 1 : 0), bw, 22, col(this.emoteCool > 0 ? C.night : C.navy));
        fb.art(em.art, x + (bw >> 1) - 4, y + 2 + (h.down ? 1 : 0), { '#': col(this.emoteCool > 0 ? C.dusk : C.gold), '+': col(C.white), o: col(C.ink) });
        text(fb, em.label, x + (bw >> 1), y + 11, col(C.mist), { align: 'center', maxW: bw - 2 });
        if (h.click && this.emoteCool <= 0) {
          this.emoteCool = 1.2;
          this.showEmote(p.me || 0, i);
          if (p.online.sendEmote) p.online.sendEmote(i);
        }
      });
    } else {
      const sp = [1, 2, 4];
      for (let i = 0; i < 3; i++) {
        if (ui.chip('bt-sp' + i, 4 + i * 33, y, 31, 22, `×${sp[i]}`, this.speed === sp[i])) {
          this.speed = sp[i]; app.G.settings.bspeed = sp[i]; app.G.save();
          if (this.phase === 'play') app.spec.speed = this.speed;
        }
      }
      if (this.phase === 'play' && ui.button('bt-skip', W - 74, y, 70, 22, 'スキップ', { face: C.night, icon: 'fast' })) {
        app.spec.paused = false;
        app.spec.skip();
      }
      if ((this.phase === 'intro' || this.phase === 'count') && ui.button('bt-go', W - 74, y, 70, 22, 'すぐ開始', { face: C.night })) {
        this.t = INTRO + COUNT;
      }
    }
  }

  back() {
    if (this.p.online) return;   // オンラインは途中でやめない
    this.app.go(this.p.ret || 'home', this.p.retParams || {});
  }
}

export function drawFace(fb, side, x, y, team, scale = 1) {
  if (side.portrait && side.portrait !== 'bot') portrait(fb, x, y, side.portrait, side.look, scale);
  else botPortrait(fb, x, y, team, scale);
}
