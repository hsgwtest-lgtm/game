// せってい：音・見た目・データ

import { C, text, mini, button, toggle, panel, dim } from '../ui/widgets.js';
import { ICON } from '../gfx/sprites.js';
import { VERSION } from '../core/config.js';
import { STAGES } from '../sim/stages.js';
import { wrap } from '../gfx/font.js';

const DITHER = [0, 0.08, 0.16];

export class SettingsScreen {
  constructor(app) { this.app = app; this.confirm = null; }
  enter() { this.confirm = null; }
  viewHeight() { return 0; }
  update() {}

  draw(fb) {
    const app = this.app, px = app.px, g = app.game, s = g.settings;
    const VW = px.VW, top = px.safe.t, bot = px.VH - px.safe.b;
    fb.rect(0, 0, VW, px.VH, C.ink);
    for (let yy = 0; yy < px.VH; yy += 8) for (let xx = (yy >> 3) & 1 ? 4 : 0; xx < VW; xx += 8) fb.px(xx, yy, C.navy);
    button(app, 'back', 3, top + 2, 18, 15, '', () => { app.sfx('back'); app.go('menu'); }, { icon: ICON.back });
    text(fb, 'せってい', 25, top + 4, C.white);
    const x = 8, w = VW - 16;
    let y = top + 26;
    const row = (label, on, onTap, id) => {
      text(fb, label, x, y + 1, C.white);
      toggle(app, id, x + w - 24, y + 2, on, onTap);
      y += 18;
    };
    row('効果音', s.sound, () => { s.sound = !s.sound; app.sound.setOn(s.sound); g.saveSettings(); }, 't_snd');
    row('BGM', s.bgm, () => { s.bgm = !s.bgm; app.sound.setBgm(s.bgm); g.saveSettings(); }, 't_bgm');
    row('3Dの輪郭線', s.outline !== false, () => { s.outline = s.outline === false; app.px.outline = s.outline; g.saveSettings(); }, 't_out');
    text(fb, 'ざらざら', x, y + 1, C.white);
    ['なし', 'ふつう', 'つよい'].forEach((nm, k) => {
      button(app, 'dt' + k, x + w - (3 - k) * 34, y, 32, 14, nm, () => { s.dither = DITHER[k]; app.px.ditherAmt = DITHER[k]; g.saveSettings(); }, { active: Math.abs((s.dither ?? 0.08) - DITHER[k]) < 0.001 });
    });
    y += 20;
    row('すべての修行場を開く', !!g.progress.allOpen, () => {
      g.progress.allOpen = !g.progress.allOpen;
      if (!g.progress.allOpen) g.progress.unlocked = 1;
      g._recalcUnlock(); g.saveProgress();
    }, 't_open');
    y += 4;
    button(app, 'reset', x, y, w, 16, 'すべてのデータを消す', () => { this.confirm = true; }, { icon: ICON.reset });
    y += 26;
    // クレジット
    panel(fb, x - 2, y, w + 4, bot - y - 4, { fill: C.navy });
    let yy = y + 6;
    const lines = [
      `DOT DOJO  v${VERSION}`,
      '3D: Three.js r128 (MIT)',
      'フォント: PixelMplus',
      '　(M+ FONT LICENSE)',
      'パレット: Endesga 32',
      '音: Web Audio APIでその場で合成',
      '',
      '学習はすべてこの端末の中で動いています。',
      'データはこの端末にだけ保存されます。',
    ];
    for (const ln of lines) {
      for (const l2 of wrap(ln, w - 8)) { text(fb, l2, x + 4, yy, ln.startsWith('DOT') ? C.white : C.silver); yy += 12; }
      if (!ln) yy -= 6;
    }
    if (this.confirm) {
      dim(fb, 0, 0, VW, px.VH);
      app.ui.btn('blk', 0, 0, VW, px.VH, () => { this.confirm = null; });
      const pw = Math.min(VW - 16, 176), ph = 76, pxx = Math.round((VW - pw) / 2), py = Math.round(px.VH * 0.38);
      panel(fb, pxx, py, pw, ph);
      text(fb, '育てた脳・記録・印を', pxx + 8, py + 8, C.white);
      text(fb, '全部消しますか？', pxx + 8, py + 20, C.white);
      button(app, 'no', pxx + 8, py + ph - 22, (pw - 24) / 2, 15, 'やめる', () => { this.confirm = null; });
      button(app, 'yes', pxx + 16 + (pw - 24) / 2, py + ph - 22, (pw - 24) / 2, 15, '消す', () => {
        g.resetAll(); app.sound.setOn(true); app.sound.setBgm(true); app.px.outline = true; app.px.ditherAmt = 0.08;
        this.confirm = null; app.go('title');
      }, { accent: C.red });
    }
    void STAGES;
  }
}
