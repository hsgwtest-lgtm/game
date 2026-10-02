// せってい画面（音・画質・データ・クレジット）

import { C, text, mini, button, panel, toggle, dim } from '../ui/widgets.js';
import { ICON } from '../gfx/sprites.js';
import { VERSION } from '../core/config.js';

export class SettingsScreen {
  constructor(app) { this.app = app; this.confirm = false; }
  enter() { this.confirm = false; }
  viewHeight() { return 0; }
  update() {}

  draw(fb) {
    const app = this.app, px = app.px, g = app.game;
    const VW = px.VW, VH = px.VH, top = px.safe.t, bot = VH - px.safe.b;
    fb.rect(0, 0, VW, VH, C.ink);
    button(app, 'st_back', 4, top + 4, 22, 16, '', () => { app.sfx('back'); app.go('menu'); }, { icon: ICON.back });
    text(fb, 'せってい', 32, top + 6, C.cyan, { bold: true });
    let y = top + 32;
    const row = (label, on, fn, sub) => {
      fb.rect(8, y, VW - 16, sub ? 28 : 18, C.navy);
      text(fb, label, 14, y + 4, C.white);
      if (sub) text(fb, sub, 14, y + 15, C.steel);
      toggle(app, 'st_' + label, VW - 38, y + 4, on, fn);
      y += (sub ? 28 : 18) + 4;
    };
    row('効果音', g.settings.sound, () => { g.settings.sound = !g.settings.sound; app.sound.setOn(g.settings.sound); g.saveSettings(); });
    row('BGM', g.settings.bgm, () => { g.settings.bgm = !g.settings.bgm; app.sound.setBgm(g.settings.bgm); g.saveSettings(); });
    row('輪郭線', px.outline, () => { px.outline = !px.outline; g.settings.outline = px.outline; g.saveSettings(); }, '3Dのふちを黒くする');
    row('ドット模様（ディザ）', px.ditherAmt > 0.01, () => { px.ditherAmt = px.ditherAmt > 0.01 ? 0 : 0.09; g.settings.dither = px.ditherAmt; g.saveSettings(); }, '色のあいだを点々で表現');
    y += 6;
    text(fb, 'データ', 10, y, C.gray); y += 14;
    const f = g.flock, c = g.chick;
    text(fb, f ? `むれ: 第${f.gen}世代 ${f.size}羽` : 'むれ: まだいない', 14, y, C.silver); y += 12;
    text(fb, c ? `おしえたヒナ: お手本${c.added}こ` : 'おしえたヒナ: まだいない', 14, y, C.silver); y += 16;
    button(app, 'st_wipe', 8, y, VW - 16, 18, 'すべてのデータを消す', () => { this.confirm = true; }, { accent: C.red });
    y += 30;
    text(fb, 'クレジット', 10, y, C.gray); y += 14;
    text(fb, '3D: Three.js r128 (MIT)', 14, y, C.silver); y += 12;
    text(fb, '文字: PixelMplus (M+ FONT LICENSE)', 14, y, C.silver); y += 12;
    text(fb, '色: Endesga 32 パレット', 14, y, C.silver); y += 12;
    text(fb, '音: Web Audio で合成', 14, y, C.silver); y += 12;
    mini(fb, 'BIT BIRDS V' + VERSION, VW / 2, bot - 10, C.steel, 'center');
    if (this.confirm) {
      dim(fb, 0, 0, VW, VH);
      const w = Math.min(VW - 16, 190), h = 86;
      const x = Math.round((VW - w) / 2), yy = Math.round((VH - h) / 2);
      panel(fb, x, yy, w, h, { fill: C.navy, border: C.red });
      text(fb, '本当に消しますか？', VW / 2, yy + 8, C.white, { align: 'center' });
      text(fb, '群れ・ヒナ・クリア記録が消えます', VW / 2, yy + 22, C.silver, { align: 'center' });
      const bw = Math.floor((w - 24) / 2);
      button(app, 'wipe_yes', x + 8, yy + 52, bw, 20, '消す', () => {
        g.resetAll();
        this.confirm = false;
        app.sound.setOn(true); app.sound.setBgm(true);
        app.go('title');
      }, { accent: C.red });
      button(app, 'wipe_no', x + 16 + bw, yy + 52, bw, 20, 'やめる', () => { this.confirm = false; });
    }
  }
}
