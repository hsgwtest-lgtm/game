// タイトル画面: 学習ずみのイヌが、ドット絵の世界を歩く

import { C, text, mini } from '../ui/widgets.js';
import { VERSION, PAL } from '../core/config.js';
import { rgb } from '../gfx/fb.js';
import { compileBody } from '../sim/body.js';
import { brainLayout } from '../sim/brain.js';
import { presetByKey } from '../sim/presets.js';
import { Actor, Clock } from '../world/actor.js';
import { DEMO } from '../game/demo.js';
import { b64ToGenome } from '../core/share.js';
import { db } from '../core/db.js';
import { button } from '../ui/widgets.js';
import { ICON } from '../gfx/icons.js';

const ROW_A = [rgb(PAL.white), rgb(PAL.yellow), rgb(PAL.yellow), rgb(PAL.gold), rgb(PAL.orange)];
const ROW_B = [rgb(PAL.white), rgb(PAL.cyan), rgb(PAL.cyan), rgb(PAL.sky), rgb(PAL.blue)];

export function drawLogo(fb, cx, y, scale = 5) {
  const w1 = 'SOFTEVO', w2 = '3D';
  const draw = (str, x, yy, rows) => {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) mini(fb, str, x + dx * 2, yy + dy * 2, C.ink, 'left', scale);
    mini(fb, str, x + Math.max(1, scale >> 1), yy + Math.max(1, scale >> 1), C.ink, 'left', scale);
    mini(fb, str, x, yy, 0, 'left', scale, rows);
  };
  const totalW = (w1.length + 1 + w2.length) * 4 * scale - scale;
  const x0 = Math.round(cx - totalW / 2);
  draw(w1, x0, y, ROW_A);
  draw(w2, x0 + (w1.length + 1) * 4 * scale, y, ROW_B);
  return totalW;
}

export class TitleScreen {
  constructor(app) { this.app = app; this.t = 0; this.actor = null; }

  enter() {
    const app = this.app, w = app.world;
    this.t = 0;
    w.setTheme('flat');
    w.setTerrain('flat', 1);
    w.setRecord(null);
    w.buildGroup.visible = false;
    w.envGroup.visible = true;
    const p = presetByKey(DEMO.preset);
    this.body = compileBody(p.voxels);
    this.L = brainLayout(this.body);
    this.genome = Float64Array.from(b64ToGenome(DEMO.genome));
    this.actor = new Actor(w, this.body, this.L, this.genome, {});
    this.clock = new Clock();
    w.setView(0.7, 0.3, 1.9, true);
    w.focus(0, 0.15, 0, true);
    app.sound.setMood('title');
    this.last = null;
    if (app.settings.last) db.getCreature(app.settings.last).then(r => { this.last = r; });
  }

  exit() {
    if (this.actor) { this.actor.dispose(); this.actor = null; }
  }

  viewHeight() { return this.app.px.VH; }

  update(dt) {
    this.t += dt;
    const a = this.actor, w = this.app.world;
    a.stepFrames(this.clock.frames(dt), 1e9);
    if (a.distance > 7 || a.c.st.exploded) a.reset();
    a.sync(this.t);
    w.focus(a.com[0], 0.15, a.com[2]);
    w.cam.yawGoal = 0.7 + Math.sin(this.t * 0.15) * 0.5;
  }

  draw(fb) {
    const app = this.app, px = app.px;
    const VW = px.VW, top = px.safe.t, bot = px.VH - px.safe.b;
    const ly = top + Math.max(16, Math.round((bot - top) * 0.08));
    const sc = VW >= 200 ? 4 : 4;
    drawLogo(fb, VW / 2, ly, sc);
    text(fb, 'ボクセル生物 しんかラボ', VW / 2, ly + sc * 5 + 9, C.white, { align: 'center', outline: C.ink });
    text(fb, '自分でつくった生き物が', VW / 2, bot - 74, C.white, { align: 'center', outline: C.ink });
    text(fb, 'すこしずつ 歩きかたを おぼえていく', VW / 2, bot - 61, C.white, { align: 'center', outline: C.ink });
    if (Math.floor(this.t * 1.6) % 2 === 0) text(fb, 'タップして はじめる', VW / 2, bot - 34, C.yellow, { align: 'center', outline: C.ink });
    app.ui.btn('title_any', 0, 0, VW, px.VH, () => { app.sfx('start'); app.go('zukan'); });
    if (this.last) {
      const w = Math.min(VW - 40, 150);
      button(app, 'title_cont', Math.round((VW - w) / 2), bot - 112, w, 20, `つづきから（${this.last.name}）`, () => { app.sfx('start'); app.go('lab', { id: this.last.id }); }, { icon: ICON.play, accent: C.yellow });
    }
    mini(fb, 'V' + VERSION, VW - 4, bot - 8, C.white, 'right');
    mini(fb, 'THREE.JS R128', 4, bot - 8, C.white);
  }
}
