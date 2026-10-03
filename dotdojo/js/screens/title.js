// タイトル画面：浮き島の道場で、3つの流派のでしが跳ねまわる

import { C, text, mini } from '../ui/widgets.js';
import { MASTER } from '../gfx/sprites.js';
import { VERSION, PAL, SCHOOLS } from '../core/config.js';
import { rgb } from '../gfx/fb.js';
import { Stage, Episode } from '../sim/env.js';

const ROW_A = [rgb(PAL.white), rgb(PAL.cyan), rgb(PAL.cyan), rgb(PAL.sky), rgb(PAL.blue)];
const ROW_B = [rgb(PAL.yellow), rgb(PAL.gold), rgb(PAL.orange), rgb(PAL.orange), rgb(PAL.rust)];

// 「DOT DOJO」のロゴ（3×5 のミニ文字を拡大）
export function drawLogo(fb, cx, y, scale = 5) {
  const w1 = 'DOT', w2 = 'DOJO';
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

// 3D の背景：道場の島
export const TITLE_STAGE = {
  id: 'title', name: 'title', theme: 0, maxSteps: 9999,
  map: [
    '   #G#   ',
    '  .....  ',
    ' ....... ',
    ' ..#.#.. ',
    ' ....... ',
    '  .....  ',
    '   ...   ',
  ],
};

export class TitleScreen {
  constructor(app) {
    this.app = app;
    this.t = 0;
  }

  enter() {
    this.t = 0;
    const app = this.app;
    this.stage = new Stage(Object.assign({}, TITLE_STAGE, { map: TITLE_STAGE.map.map((r) => r.replace('   ...   ', '   .S.   ')) }));
    app.world.frameOpts = { top: 0.42, bot: -0.42, mx: 0.86 };
    app.world.setTheme(0);
    app.world.buildStage(this.stage);
    app.world.cam.mode = 'orbit';
    app.sound.setMood('calm');
    this.ep = new Episode(this.stage, 3, { shaping: 0 });
    this.ep.x.set([3, 4, 5]); this.ep.y.set([4, 4, 4]);
    this.ep.px.set([3, 4, 5]); this.ep.py.set([4, 4, 4]);
    this.timer = 0;
    this._sync(true);
  }

  exit() { this.app.world.cam.mode = 'fixed'; }

  _sync(reset) {
    const ep = this.ep;
    const cols = [[PAL.lime, PAL.green], [PAL.orange, PAL.rust], [PAL.cyan, PAL.red]];
    const list = [];
    for (let i = 0; i < 3; i++) list.push({ x: ep.x[i], y: ep.y[i], px: ep.px[i], py: ep.py[i], done: 0, cause: 0, color: cols[i][0], band: cols[i][1], key: 0 });
    if (reset) this.app.world.resetAgents(list); else this.app.world.syncAgents(list);
  }

  viewHeight() { return this.app.px.VH; }

  update(dt) {
    this.t += dt;
    this.timer += dt;
    if (this.timer > 0.5) {
      this.timer = 0;
      // でたらめに跳ねる（落ちないように）
      const ep = this.ep, st = this.stage;
      for (let i = 0; i < 3; i++) {
        ep.px[i] = ep.x[i]; ep.py[i] = ep.y[i];
        if (Math.random() < 0.4) continue;
        const d = [[0, -1], [0, 1], [-1, 0], [1, 0]][Math.floor(Math.random() * 4)];
        const nx = ep.x[i] + d[0], ny = ep.y[i] + d[1];
        if (st.walkable(nx, ny) && st.tile(nx, ny) !== 3) { ep.x[i] = nx; ep.y[i] = ny; }
      }
      this._sync(false);
    }
    this.app.world.setStepFrac(this.timer / 0.3);
  }

  draw(fb) {
    const app = this.app, px = app.px;
    const VW = px.VW, top = px.safe.t, bot = px.VH - px.safe.b;
    const ly = top + Math.max(14, Math.round((bot - top) * 0.07));
    const sc = VW >= 200 ? 6 : 5;
    drawLogo(fb, VW / 2, ly, sc);
    text(fb, 'AI 三流派 修行録', VW / 2, ly + sc * 5 + 8, C.white, { align: 'center', outline: C.ink });
    // 3人の師範
    const keys = ['ga', 'rl', 'il'];
    const gap = Math.floor((VW - 12) / 3);
    for (let k = 0; k < 3; k++) {
      const spr = MASTER[keys[k]];
      const cx = 6 + gap * k + gap / 2;
      const bob = Math.round(Math.sin(this.t * 3 + k * 1.3) * 1.5);
      const yy = bot - 96 + bob;
      fb.rect(Math.round(cx - spr.w - 2), yy - 2, spr.w * 2 + 4, spr.h * 2 + 4, C.ink);
      fb.sprite(spr, Math.round(cx - spr.w), yy, spr.cols, 2);
      text(fb, SCHOOLS[keys[k]].name, cx, yy + 36, rgb(SCHOOLS[keys[k]].color), { align: 'center', outline: C.ink });
      text(fb, ['進化', '強化学習', '模倣学習'][k], cx, yy + 48, C.white, { align: 'center', outline: C.ink });
    }
    if (Math.floor(this.t * 1.6) % 2 === 0) text(fb, 'タップして はじめる', VW / 2, bot - 24, C.white, { align: 'center', outline: C.ink });
    mini(fb, 'V' + VERSION, VW - 4, bot - 8, C.silver, 'right');
    mini(fb, 'THREE.JS R128', 4, bot - 8, C.silver);
    app.ui.btn('title_any', 0, 0, VW, px.VH, () => { app.sfx('tap'); app.go('menu'); });
  }
}
