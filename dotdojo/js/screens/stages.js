// 修行場えらび（3×3 の島）と流派えらび

import { C, text, mini, button, panel, measure } from '../ui/widgets.js';
import { ICON, MASTER } from '../gfx/sprites.js';
import { STAGES, stageById } from '../sim/stages.js';
import { Stage } from '../sim/env.js';
import { SCHOOLS, SCHOOL_KEYS } from '../core/config.js';
import { drawMap } from '../ui/viz.js';
import { rgb } from '../gfx/fb.js';
import { wrap } from '../gfx/font.js';

const AFF = ['△', '○', '◎'];

export class StageSelectScreen {
  constructor(app) {
    this.app = app;
    this.sel = 0;
    this.stages = STAGES.map((d) => new Stage(d));
  }

  enter(p) {
    const app = this.app, g = app.game;
    this.compare = !!p.compare;
    if (p.stage) this.sel = Math.max(0, STAGES.findIndex((s) => s.id === p.stage));
    else this.sel = Math.min(this.sel, g.progress.unlocked - 1);
    this._showStage();
    app.world.cam.mode = 'orbit';
    app.sound.setMood('calm');
    app.masters.clear();
    if (this.compare) app.masters.say('rl', '対抗戦だ！ 2つ以上の流派で修行した修行場をえらんでくれ。', { dur: 5 });
  }

  exit() { this.app.world.cam.mode = 'fixed'; }

  _showStage() {
    const app = this.app, def = STAGES[this.sel];
    app.world.setTheme(def.theme);
    app.world.buildStage(this.stages[this.sel]);
    app.world.resetAgents([]);
  }

  viewHeight() { return 0; }
  update(dt) { this.app.masters.update(dt); }

  draw(fb) {
    const app = this.app, px = app.px, g = app.game;
    const VW = px.VW, top = px.safe.t, bot = px.VH - px.safe.b;
    fb.rect(0, 0, VW, px.VH, C.ink);
    for (let yy = 0; yy < px.VH; yy += 8) for (let xx = (yy >> 3) & 1 ? 4 : 0; xx < VW; xx += 8) fb.px(xx, yy, C.navy);
    button(app, 'back', 3, top + 2, 18, 15, '', () => { app.sfx('back'); app.go('menu'); }, { icon: ICON.back });
    text(fb, this.compare ? '対抗戦の修行場をえらぶ' : '修行場をえらぶ', 25, top + 4, C.white, { outline: C.ink });
    // 3×3 の島
    const gx = 4, gy = top + 21;
    const tw = Math.floor((VW - 8 - 4) / 3);
    const th = Math.max(60, Math.min(80, Math.floor((bot - gy - 150) / 3) - 2));
    for (let i = 0; i < STAGES.length; i++) {
      const def = STAGES[i], st = this.stages[i];
      const x = gx + (i % 3) * (tw + 2), y = gy + Math.floor(i / 3) * (th + 2);
      const unlocked = g.isUnlocked(i);
      const on = i === this.sel;
      fb.rrect(x, y, tw, th, on ? C.white : C.ink);
      fb.rect(x + 1, y + 1, tw - 2, th - 2, on ? C.slate : C.navy);
      if (unlocked) {
        const mapH = th - 24;
        const cell = Math.min(5, Math.floor((tw - 8) / st.W), Math.floor(mapH / st.H));
        const mw = st.W * cell, mh = st.H * cell;
        drawMap(fb, st, x + Math.round((tw - mw) / 2), y + 3 + Math.round((mapH - mh) / 2), cell, { showKey: true });
        let name = def.name;
        if (measure(name) > tw - 4) name = def.short || name.slice(0, 5);
        text(fb, name, x + tw / 2, y + th - 20, on ? C.white : C.silver, { align: 'center' });
        const m = g.stageMedals(def.id);
        const cols = [m.ga ? C.lime : C.ink, m.rl ? C.orange : C.ink, m.il ? C.cyan : C.ink];
        for (let k = 0; k < 3; k++) {
          const sx = x + tw / 2 - 13 + k * 9;
          fb.rect(sx, y + th - 7, 8, 4, C.ink);
          fb.rect(sx + 1, y + th - 6, 6, 2, cols[k] === C.ink ? C.slate : cols[k]);
        }
        mini(fb, String(i + 1), x + 3, y + 3, C.silver);
      } else {
        fb.icon(ICON.lock, x + tw / 2 - 2, y + th / 2 - 6, C.steel);
        mini(fb, String(i + 1), x + 3, y + 3, C.steel);
      }
      app.ui.btn('stg' + i, x, y, tw, th, () => {
        if (!unlocked) { app.masters.say('ga', 'その修行場は、ひとつ前の修行場で印をもらうと開くぞ。', { key: 'lock' }); return; }
        if (this.sel !== i) { this.sel = i; this._showStage(); }
      });
    }
    // えらんだ修行場の流派えらび
    const def = STAGES[this.sel];
    const py = gy + 3 * (th + 2) + 2;
    const ph = bot - py;
    panel(fb, 3, py, VW - 6, ph, { fill: C.navy });
    text(fb, `${this.sel + 1}. ${def.name}`, 9, py + 4, C.white, { bold: true });
    text(fb, def.desc, 9, py + 17, C.silver);
    const recs = g.records[def.id] || {};
    // 学びのポイント（印をひとつ取ると読める）
    const anyMedal = recs.ga?.got || recs.rl?.got || recs.il?.got;
    const lessonLines = wrap(anyMedal ? def.lesson : '学びのポイントは、印をひとつ取ると読めるぞ。', VW - 20);
    const nL = Math.min(anyMedal ? 3 : 1, lessonLines.length);
    for (let k = 0; k < nL; k++) text(fb, lessonLines[k], 9, py + 30 + k * 11, anyMedal ? C.cream : C.steel);
    // 3つの流派ボタン
    const bw = Math.floor((VW - 18) / 3), by = py + 33 + nL * 11, bh = 48;
    SCHOOL_KEYS.forEach((k, idx) => {
      const sc = SCHOOLS[k];
      const bx = 9 + idx * (bw + 0);
      const r = recs[k];
      const pressed = app.ui.btn('sch_' + k, bx, by, bw - 2, bh, () => { app.sfx('tap'); app.go(k, { stage: def.id }); });
      const oy = pressed ? 1 : 0;
      fb.rrect(bx, by + 1, bw - 2, bh - 1, C.ink);
      fb.rect(bx + 1, by + 1 + oy, bw - 4, bh - 3, C.slate);
      fb.rect(bx + 1, by + 1 + oy, bw - 4, 2, rgb(sc.color));
      const spr = MASTER[k];
      fb.sprite(spr, bx + (bw - 2) / 2 - 8, by + 5 + oy, spr.cols, 1);
      text(fb, sc.name, bx + (bw - 2) / 2, by + 22 + oy, rgb(sc.color), { align: 'center' });
      if (r && r.got) {
        fb.icon(ICON.medal, bx + 4, by + 37 + oy, C.gold);
        text(fb, `${r.cost}${r.unit || ''}`, bx + bw - 6, by + 35 + oy, C.white, { align: 'right' });
      } else {
        const has = !!g.loadBrain(def.id, k);
        text(fb, has ? '修行中' : 'まだ', bx + (bw - 2) / 2, by + 35 + oy, has ? C.yellow : C.steel, { align: 'center' });
      }
      if (anyMedal && def.aff) mini(fb, AFF[def.aff[k]], bx + bw - 7, by + 5 + oy, C.silver);
    });
    // 対抗戦
    const trained = SCHOOL_KEYS.filter((k) => !!g.loadBrain(def.id, k)).length;
    const cy = by + bh + 4;
    if (cy + 16 <= bot - 2) {
      button(app, 'cmp', 9, cy, VW - 18, 16, trained >= 2 ? '三流派で対抗戦' : '対抗戦（2流派以上で修行すると）', () => app.go('compare', { stage: def.id }), { icon: ICON.trophy, disabled: trained < 2, accent: this.compare && trained >= 2 ? C.orange : undefined });
    }
    if (anyMedal && def.aff && cy + 32 <= bot - 2) text(fb, '右上の印＝流派の相性 ◎とくい ○ふつう △にがて', 9, cy + 20, C.steel);
    app.masters.draw(fb, 6, py - 4, VW - 12, 2, { anchorBottom: true });
  }
}
