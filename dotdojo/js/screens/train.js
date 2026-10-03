// 修行画面の共通部分（3つの流派で共有）
//  上: 3D の修行場（HUD・状況・師範の吹き出し・矢印などの重ね表示）
//  下: パネル（タブ・中身・操作ボタン）

import { C, text, mini, button, tabs, toggle, measure, panel, dim } from '../ui/widgets.js';
import { ICON } from '../gfx/sprites.js';
import { STAGES, stageById } from '../sim/stages.js';
import { EV_MOVE, EV_BUMP, EV_FALL, EV_ONI, EV_SPIKE, EV_COIN, EV_KEY, EV_GOAL, EV_DOOR, C_FALL, C_ONI, C_SPIKE, C_TIME, C_GOAL } from '../sim/env.js';
import { SCHOOLS, REWARD_KNOBS, PAL } from '../core/config.js';
import { SPEEDS } from '../game/session.js';
import { computePolicyMap, heatHex } from '../ui/viz.js';
import { rgb } from '../gfx/fb.js';
import { softmax } from '../ml/nn.js';
import { wrap } from '../gfx/font.js';

export const CAUSE_NAME = ['', 'ゴール', '落ちた', 'オニ', 'トゲ', '時間切れ'];
const KANJI = { ga: '進', rl: '強', il: '模' };

export class TrainBase {
  constructor(app, school) {
    this.app = app;
    this.school = school;
    this.sc = SCHOOLS[school];
    this.scCol = rgb(this.sc.color);
    this.tab = 0;
    this.popups = [];
    this.banner = null;
    this.celebrate = null;
    this.overlay = { arrows: false, heat: false, foot: false };
    this.mapT = 0;
    this.sheet = null;
  }

  // ── 画面に入る ──
  enter(p) {
    const def = stageById(p.stage);
    this.def = def;
    this.stageNo = STAGES.indexOf(def) + 1;
    this.session = this.makeSession(def);
    this.app.world.setTheme(def.theme);
    this.app.world.buildStage(this.session.stage);
    this.app.world.cam.mode = 'fixed';
    this.app.sound.setMood('train');
    this.popups = []; this.banner = null; this.celebrate = null; this.sheet = null;
    this.tab = p.tab ?? this.tab;
    if (this.tab >= this.tabNames().length) this.tab = 0;
    this._syncWorld(true);
    this._frame();
    this.app.masters.clear();
    this.intro();
  }

  exit() {
    if (this.session) this.session.save();
    this.app.world.setArrows(null);
    this.app.world.setHeat(null);
    this.app.world.setFootprints(null);
  }

  resize() { this._frame(); }

  get top() { return this.app.px.safe.t; }
  get bot() { return this.app.px.VH - this.app.px.safe.b; }
  panelH() { return 166 + this.app.px.safe.b; }
  viewHeight() { return Math.max(150, this.app.px.VH - this.panelH()); }

  _frame() {
    const vh = this.viewHeight();
    const hud = this.top + 32;
    this.app.world.frameCamera(this.app.px.VW / vh, { top: 1 - 2 * (hud / vh), bot: -0.97, mx: 0.95 });
  }

  // ── 3D と同期 ──
  _syncWorld(reset) {
    const s = this.session, w = this.app.world;
    const list = s.agentList();
    if (reset) w.resetAgents(list); else w.syncAgents(list);
    this._syncItems();
  }

  _syncItems() {
    const s = this.session, ep = s.ep, w = this.app.world, st = s.stage;
    if (!ep) return;
    const i = Math.min(s.focus, ep.n - 1);
    const coins = st.coins.map((c, k) => ep.coinAvail(i, k, ep.t + 1));
    w.setItems(!ep.key[i], coins, ep.key[i] && ep.alive[i]);
  }

  // ── 毎フレーム ──
  update(dt) {
    const s = this.session;
    if (!this.celebrate) s.update(dt);
    for (const e of s.drainEvents()) this._onEvent(e);
    const w = this.app.world;
    w.setStepFrac(s.frac);
    if (s.ep) w.setEnv(s.ep.t, s.frac);
    // お手本中などは師範の話を止めておく（修行場をかくさないように。終わったら続きを話す）
    if (!(this.bubbleTop && this.bubbleTop())) this.app.masters.update(dt);
    // 重ね表示（方針の矢印・価値）は少し間引いて計算
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 0.12; this._updateOverlays(); }
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < p.life);
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.life) this.banner = null; }
    if (this.celebrate) this.celebrate.t += dt;
    this.updateSchool && this.updateSchool(dt);
  }

  _onEvent(e) {
    const s = this.session, w = this.app.world;
    switch (e.type) {
      case 'reset': this._syncWorld(true); break;
      case 'step': this._syncWorld(false); this._stepFx(e); break;
      case 'medal': this._medal(e); break;
      case 'gen': case 'round': this.mapT = 0; break;
      default: break;
    }
    this.onEvent && this.onEvent(e);
    void w;
  }

  // 1歩ごとの効果（音・パーティクル）。群れの時は代表だけ
  _stepFx(e) {
    const s = this.session, ep = s.ep, w = this.app.world;
    if (!ep) return;
    let hop = 0, fall = 0, hit = 0, goal = 0, coin = 0, key = 0, door = 0;
    for (let i = 0; i < ep.n; i++) {
      const ev = ep.ev[i];
      if (!ev) continue;
      const focus = i === s.focus;
      if (ev & EV_MOVE) hop++;
      if (ev & EV_FALL) fall++;
      if (ev & (EV_ONI | EV_SPIKE)) { hit++; w.burst(ep.x[i], ep.y[i], ev & EV_ONI ? 'oni' : 'poof', ep.n > 20 ? 5 : 9); }
      if (ev & EV_GOAL) { goal++; w.burst(ep.x[i], ep.y[i], 'goal', ep.n > 20 ? 8 : 16); }
      if (ev & EV_COIN) { coin++; if (focus || ep.n <= 16) w.burst(ep.x[i], ep.y[i], 'coin', 5); }
      if (ev & EV_KEY) { key++; w.burst(ep.x[i], ep.y[i], 'key', 8); }
      if (ev & EV_DOOR) door++;
      if (focus && this.showRewardPopups && Math.abs(ep.r[i]) > 0.05) {
        const r = ep.r[i];
        this.popup(ep.x[i], ep.y[i], (r > 0 ? '+' : '') + (Math.abs(r) >= 1 ? r.toFixed(0) : r.toFixed(1)), r > 0 ? C.yellow : C.pink);
      }
    }
    const sf = this.app;
    if (goal) sf.sfx('goal');
    else if (hit) sf.sfx('hit');
    else if (fall) sf.sfx('fall');
    if (key) sf.sfx('key');
    if (coin) sf.sfx('coin');
    if (door) sf.sfx('door');
    if (hop && s.speed <= 2 && ep.n <= 20) sf.sfx('hop');
    if (e.bumped) sf.sfx('bump');
  }

  popup(x, y, str, col, life = 0.9) {
    if (this.popups.length > 12) this.popups.shift();
    this.popups.push({ x, y, str, col, t: 0, life });
  }

  showBanner(str, sub = '', col = C.white, life = 1.4) { this.banner = { str, sub, col, t: 0, life }; }

  _medal(e) {
    this.app.sfx('medal');
    this.celebrate = { t: 0, info: e };
    const s = this.session;
    const ep = s.ep;
    if (ep) for (let k = 0; k < 3; k++) this.app.world.burst(s.stage.goal.x, s.stage.goal.y, 'goal', 14);
    this.onMedal && this.onMedal(e);
  }

  // ── 方針の矢印・価値の重ね表示 ──
  _updateOverlays() {
    const s = this.session, w = this.app.world, ep = s.ep;
    if (!ep) return;
    const needMap = this.overlay.arrows || this.overlay.heat || this.tabNeedsMap();
    if (!needMap) {
      if (this._hadArrows) { w.setArrows(null); this._hadArrows = false; }
      if (this._hadHeat) { w.setHeat(null); this._hadHeat = false; }
      const fp = !this.overlay.foot && this.phaseFootprints ? this.phaseFootprints() : null;
      if (this.overlay.foot) w.setFootprints(this.footPath(), this.sc.color);
      else w.setFootprints(fp ? fp.path : null, fp ? fp.color : undefined);
      return;
    }
    const i = Math.min(s.focus, ep.n - 1);
    const pm = computePolicyMap(s.stage, ep, i, this.probsFn(), this.overlay.heat || this.tabNeedsValue() ? this.valueFn() : null);
    this.pmap = pm;
    if (this.overlay.arrows) {
      const arr = pm.arrows.map((o) => o ? { a: o.a, c: o.conf > 0.8 ? PAL.white : o.conf > 0.5 ? PAL.silver : PAL.gray, s: 0.45 + 0.5 * o.conf } : null);
      w.setArrows(arr);
      this._hadArrows = true;
    } else if (this._hadArrows) { w.setArrows(null); this._hadArrows = false; }
    if (this.overlay.heat && pm.values) {
      w.setHeat(pm.values.map((v) => v == null ? -1 : heatHex(v)));
      this._hadHeat = true;
    } else if (this._hadHeat) { w.setHeat(null); this._hadHeat = false; }
    if (this.overlay.foot) {
      const path = this.footPath();
      w.setFootprints(path, this.sc.color);
    } else {
      const fp = this.phaseFootprints ? this.phaseFootprints() : null;
      if (fp) w.setFootprints(fp.path, fp.color);
      else w.setFootprints(null);
    }
  }

  // 子クラスで上書き
  tabNeedsMap() { return false; }
  tabNeedsValue() { return false; }
  valueFn() { return null; }
  probsFn() {
    const net = this.focusNet();
    const out = new Float32Array(5);
    return (o) => softmax(net.forward(o, new Float32Array(5)), out);
  }
  footPath() { const s = this.session; return s.paths[s.focus] || null; }

  // ── 3D をタップ：近いでしを選ぶ ──
  _registerViewTap() {
    const app = this.app, px = app.px, vh = this.viewHeight();
    app.ui.btn('view_tap', 0, this.top + 34, px.VW, vh - this.top - 34, () => {
      const s = this.session, ep = s.ep;
      if (!ep) return;
      const tx = app.ui.px, ty = app.ui.py;
      let best = -1, bd = 1e9;
      for (let i = 0; i < ep.n; i++) {
        const ap = app.world.agentPos(i);
        if (!ap || !ap.visible) continue;
        const q = app.world.project(ap.X, 0.3, ap.Z, px.VW, vh);
        const d = Math.hypot(q.x - tx, q.y - ty);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0 && bd < 14) { s.focus = best; this._syncWorld(false); this._syncItems(); this.onFocus && this.onFocus(best); app.sfx('tap'); }
      else app.masters.skip();
    });
  }

  // ── 描画 ──
  draw(fb) {
    const app = this.app, px = app.px, VW = px.VW;
    const vh = this.viewHeight();
    this._registerViewTap();
    this._drawViewOverlay(fb, vh);
    this._drawHud(fb);
    this._drawPanel(fb, vh);
    // 師範の吹き出し：パネルの上に出す（3Dの修行場をかくさない）。お手本中・まかせ中はお休み
    if (!(this.bubbleTop && this.bubbleTop())) app.masters.draw(fb, 4, vh + 19, VW - 8, 3);
    if (this.sheet) this.drawSheet(fb);
    if (this.celebrate) this._drawCelebrate(fb);
  }

  _drawHud(fb) {
    const app = this.app, VW = app.px.VW, top = this.top;
    button(app, 'hud_back', 3, top + 2, 18, 15, '', () => { app.sfx('back'); app.go('stages', { stage: this.def.id }); }, { icon: ICON.back });
    // 流派の札と修行場の名前
    const name = this.def.name;
    const chipW = measure(this.sc.name) + 6;
    fb.rect(25, top + 3, chipW, 13, C.ink);
    fb.rect(26, top + 4, chipW - 2, 11, this.scCol);
    text(fb, this.sc.name, 28, top + 4, C.ink);
    text(fb, `${this.stageNo}.${name}`, 25 + chipW + 3, top + 4, C.white, { outline: C.ink });
    this.drawStatus(fb, top + 20);
    // 重ね表示の切り替え（右端）
    const items = this.overlayButtons();
    let y = top + 36;
    for (const it of items) {
      const on = this.overlay[it.key];
      button(app, 'ov_' + it.key, VW - 19, y, 16, 14, '', () => { this.overlay[it.key] = !on; this.mapT = 0; if (!this.overlay[it.key]) { if (it.key === 'arrows') app.world.setArrows(null); if (it.key === 'heat') app.world.setHeat(null); if (it.key === 'foot') app.world.setFootprints(null); } }, { icon: it.icon, active: on });
      y += 17;
    }
  }

  overlayButtons() { return [{ key: 'arrows', icon: ICON.arrow }, { key: 'foot', icon: ICON.foot }]; }

  _drawViewOverlay(fb, vh) {
    const app = this.app, VW = app.px.VW, w = app.world, s = this.session;
    // 注目しているでしの目印
    const ep = s.ep;
    if (ep && ep.n > 1 && s.focus < ep.n) {
      const ap = w.agentPos(s.focus);
      if (ap && ap.visible) {
        const q = w.project(ap.X, 0.95, ap.Z, VW, vh);
        const bob = Math.round(Math.sin(app.time * 6) * 1.5);
        const x = Math.round(q.x), y = Math.round(q.y) - 4 + bob;
        fb.rect(x - 3, y - 1, 7, 1, C.ink); fb.rect(x - 2, y, 5, 1, C.ink); fb.rect(x - 1, y + 1, 3, 1, C.ink); fb.px(x, y + 2, C.ink);
        fb.rect(x - 2, y - 1, 5, 1, C.yellow); fb.rect(x - 1, y, 3, 1, C.yellow); fb.px(x, y + 1, C.yellow);
      }
    }
    // ふきだし数字（ごほうび）
    for (const p of this.popups) {
      const q = w.projectTile(p.x, p.y, 0.9, VW, vh);
      const yy = Math.round(q.y - p.t * 16);
      if (p.t / p.life > 0.7 && Math.floor(p.t * 20) % 2) continue;
      mini(fb, p.str, Math.round(q.x), yy, p.col, 'center');
      void yy;
    }
    if (this.banner) {
      const b = this.banner;
      const f = Math.min(1, b.t * 5), out = b.t > b.life - 0.25;
      if (!out || Math.floor(b.t * 20) % 2) {
        const y = Math.round(vh * 0.36 - (1 - f) * 8);
        text(fb, b.str, VW / 2, y, b.col, { align: 'center', outline: C.ink, bold: true });
        if (b.sub) text(fb, b.sub, VW / 2, y + 13, C.white, { align: 'center', outline: C.ink });
      }
    }
    this.drawViewExtra && this.drawViewExtra(fb, vh);
  }

  _drawPanel(fb, vh) {
    const app = this.app, VW = app.px.VW, bot = this.bot;
    const y0 = vh;
    fb.rect(0, y0, VW, app.px.VH - y0, C.navy);
    fb.rect(0, y0, VW, 1, C.ink);
    fb.rect(0, y0 + 1, VW, 1, C.slate);
    const names = this.tabNames();
    tabs(app, 'tab', 2, y0 + 3, VW - 4, 14, names, this.tab, (i) => { this.tab = i; this.mapT = 0; });
    const cy = y0 + 19, ch = bot - 23 - cy;
    fb.setClip(0, cy, VW, ch + 1);
    this.drawTab(fb, this.tab, 4, cy + 2, VW - 8, ch - 2);
    fb.resetClip();
    this.drawActions(fb, bot - 20);
  }

  // ── 免許皆伝のお祝い ──
  _drawCelebrate(fb) {
    const app = this.app, px = app.px, VW = px.VW, VH = px.VH;
    const c = this.celebrate, t = c.t;
    dim(fb, 0, 0, VW, VH);
    app.ui.btn('cel_block', 0, 0, VW, VH, () => {});
    const w = Math.min(VW - 16, 176), h = 150;
    const x = Math.round((VW - w) / 2), y = Math.round(VH * 0.22);
    panel(fb, x, y, w, h, { fill: C.cream, border: C.ink, hi: C.white });
    text(fb, '免許皆伝！', VW / 2, y + 8, C.crimson, { align: 'center', bold: true, scale: 1 });
    text(fb, `${this.def.name}`, VW / 2, y + 22, C.ink, { align: 'center' });
    // はんこ（だんだん押される）
    const sz = Math.max(36, Math.round(60 - Math.min(1, t * 4) * 24));
    const hx = Math.round(VW / 2 - sz / 2), hy = y + 36 + Math.round((36 - sz) / 2);
    if (t > 0.05) {
      fb.rect(hx, hy, sz, sz, C.red);
      fb.frame(hx + 2, hy + 2, sz - 4, sz - 4, C.cream);
      text(fb, KANJI[this.school], hx + sz / 2, hy + sz / 2 - 6, C.cream, { align: 'center', scale: sz >= 36 ? 2 : 1, bold: true });
    }
    const info = c.info;
    const lines = this.medalLines(info);
    let yy = y + 80;
    for (const ln of lines) {
      text(fb, ln, VW / 2, yy, C.ink, { align: 'center' });
      yy += 12;
    }
    if (t > 0.8) {
      button(app, 'cel_ok', x + w / 2 - 34, y + h - 22, 68, 16, 'つづける', () => { this.celebrate = null; this.afterCelebrate && this.afterCelebrate(); }, { accent: this.scCol });
    }
  }

  medalLines(info) {
    const r = [];
    if (info.cost != null) r.push(`かかった数: ${info.cost}${info.unit || ''}`);
    if (info.steps) r.push(`ゴールまで ${info.steps}歩`);
    return r;
  }

  // ── ごほうび設定（強化流・進化流）──
  drawRewardKnobs(fb, x, y, w) {
    const app = this.app, s = this.session, st = s.stage;
    let yy = y;
    text(fb, 'ごほうびの決め方', x, yy, C.silver);
    yy += 13;
    for (const kb of REWARD_KNOBS) {
      if (kb.need === 'hasKey' && !st.hasKey) continue;
      if (kb.need === 'hasCoin' && !st.hasCoin) continue;
      text(fb, kb.label, x, yy + 1, C.white);
      const n = kb.opts.length;
      const bw = 20, gap = 2;
      let bx = x + w - n * (bw + gap) + gap;
      const cur = s.rw[kb.key];
      for (let k = 0; k < n; k++) {
        const on = Math.abs(cur - kb.opts[k]) < 1e-6;
        button(app, `rk_${kb.key}_${k}`, bx, yy, bw, 13, kb.names[k], () => {
          const rw = Object.assign({}, s.rw); rw[kb.key] = kb.opts[k]; s.setRewards(rw);
          this.onRewardChange && this.onRewardChange(kb.key);
        }, { active: on, mini: kb.names[k].length > 2 ? false : false });
        bx += bw + gap;
      }
      yy += 16;
    }
    text(fb, '巻物+10 ・ 1歩ごと-0.02', x, yy, C.steel);
    return yy + 12 - y;
  }

  // 下からせり上がるシート（確認ダイアログなど）
  confirm(msg, onYes, yesLabel = 'はい') { this.sheet = { kind: 'confirm', msg, onYes, yesLabel }; }

  drawSheet(fb) {
    const app = this.app, px = app.px, VW = px.VW, VH = px.VH;
    const sh = this.sheet;
    dim(fb, 0, 0, VW, VH);
    app.ui.btn('sheet_block', 0, 0, VW, VH, () => { this.sheet = null; });
    if (sh.kind === 'confirm') {
      const w = Math.min(VW - 16, 180);
      const lines = wrap(sh.msg, w - 16);
      const h = 40 + lines.length * 12;
      const x = Math.round((VW - w) / 2), y = Math.round(VH * 0.4 - h / 2);
      panel(fb, x, y, w, h);
      for (let i = 0; i < lines.length; i++) text(fb, lines[i], x + 8, y + 7 + i * 12, C.white);
      const by = y + h - 20;
      button(app, 'sh_no', x + 8, by, (w - 24) / 2, 15, 'やめる', () => { this.sheet = null; });
      button(app, 'sh_yes', x + 16 + (w - 24) / 2, by, (w - 24) / 2, 15, sh.yesLabel, () => { const f = sh.onYes; this.sheet = null; f(); }, { accent: C.red });
    }
  }

  // 1倍速〜8倍速の切り替えボタン
  speedButton(fb, x, y, w = 24) {
    const s = this.session;
    button(this.app, 'spd', x, y, w, 16, `${SPEEDS[s.speedIdx]}x`, () => { s.speedIdx = (s.speedIdx + 1) % SPEEDS.length; }, { mini: true });
  }
}

export { CAUSE_NAME as CAUSES, C_FALL, C_ONI, C_SPIKE, C_TIME, C_GOAL };
