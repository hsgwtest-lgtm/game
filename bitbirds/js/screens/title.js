// タイトル画面

import { C, text, mini } from '../ui/widgets.js';
import { BIG_CHICK, colors } from '../gfx/sprites.js';
import { VERSION, PAL } from '../core/config.js';
import { rgb } from '../gfx/fb.js';

const LOGO_ROWS = [rgb(PAL.yellow), rgb(PAL.yellow), rgb(PAL.gold), rgb(PAL.orange), rgb(PAL.orange)];
const LOGO_ROWS2 = [rgb(PAL.cyan), rgb(PAL.cyan), rgb(PAL.sky), rgb(PAL.sky), rgb(PAL.blue)];

export function drawLogo(fb, cx, y, scale = 4) {
  const w1 = 'BIT', w2 = 'BIRDS';
  // 影とふち
  const draw = (str, x, yy, rows) => {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) mini(fb, str, x + dx * 2, yy + dy * 2, C.ink, 'left', scale);
    mini(fb, str, x + scale, yy + scale, C.ink, 'left', scale);
    mini(fb, str, x, yy, 0, 'left', scale, rows);
  };
  const totalW = (w1.length + 1 + w2.length) * 4 * scale - scale;
  const x0 = Math.round(cx - totalW / 2);
  draw(w1, x0, y, LOGO_ROWS);
  draw(w2, x0 + (w1.length + 1) * 4 * scale, y, LOGO_ROWS2);
}

export class TitleScreen {
  constructor(app) {
    this.app = app;
    this.t = 0;
    this.col = colors({ c: rgb(PAL.yellow), d: rgb(PAL.gold) });
  }

  enter() {
    this.t = 0;
    this.app.demo.start(0);
    this.app.world.setCamMode(0);
    this.app.sound.setMood('calm');
  }

  update(dt) {
    this.t += dt;
    this.app.demo.update(dt);
  }

  draw(fb) {
    const app = this.app, px = app.px;
    const VW = px.VW, VH = px.VH, top = px.safe.t, bot = VH - px.safe.b;
    const ly = top + Math.max(18, Math.round((bot - top) * 0.1));
    drawLogo(fb, VW / 2, ly, 4);
    text(fb, 'AIヒナ そだてラボ', VW / 2, ly + 28, C.white, { align: 'center', outline: C.ink });
    // ヒナ
    const bob = Math.round(Math.sin(this.t * 3) * 2);
    const sx = Math.round(VW / 2 - BIG_CHICK.w * 1.5);
    fb.sprite(BIG_CHICK, sx, ly + 48 + bob, this.col, 3);
    // ピクセルの目（ヒナの目に見えているもの）の説明
    text(fb, 'ピクセルの目で 空を学ぶ', VW / 2, ly + 96, C.cyan, { align: 'center', outline: C.ink });
    if (Math.floor(this.t * 1.6) % 2 === 0) {
      text(fb, 'タップして はじめる', VW / 2, bot - 46, C.white, { align: 'center', outline: C.ink });
    }
    mini(fb, 'V' + VERSION, VW - 4, bot - 8, C.silver, 'right');
    mini(fb, 'THREE.JS R128', 4, bot - 8, C.silver);
    app.ui.btn('title_any', 0, 0, VW, VH, () => { app.sfx('tap'); app.go('menu'); });
  }
}
