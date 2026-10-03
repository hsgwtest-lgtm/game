// 記録帳：修行場ごとに、3つの流派が免許皆伝までにかかった数をくらべる

import { C, text, mini, button, panel } from '../ui/widgets.js';
import { ICON } from '../gfx/sprites.js';
import { STAGES } from '../sim/stages.js';
import { SCHOOLS, SCHOOL_KEYS } from '../core/config.js';
import { rgb } from '../gfx/fb.js';
import { textBlock } from '../gfx/font.js';

export class RecordsScreen {
  constructor(app) { this.app = app; }
  enter() { this.app.masters.clear(); }
  viewHeight() { return 0; }
  update(dt) { this.app.masters.update(dt); }

  draw(fb) {
    const app = this.app, px = app.px, g = app.game;
    const VW = px.VW, top = px.safe.t, bot = px.VH - px.safe.b;
    fb.rect(0, 0, VW, px.VH, C.ink);
    for (let yy = 0; yy < px.VH; yy += 8) for (let xx = (yy >> 3) & 1 ? 4 : 0; xx < VW; xx += 8) fb.px(xx, yy, C.navy);
    button(app, 'back', 3, top + 2, 18, 15, '', () => { app.sfx('back'); app.go('menu'); }, { icon: ICON.back });
    text(fb, '記録帳', 25, top + 4, C.white);
    text(fb, `印 ${g.medalCount()}/${STAGES.length * 3}`, VW - 6, top + 4, C.gold, { align: 'right' });
    const x = 4, w = VW - 8;
    let y = top + 22;
    const c0 = 58, cw = Math.floor((w - c0) / 3);
    // 見出し
    SCHOOL_KEYS.forEach((k, i) => text(fb, SCHOOLS[k].name, x + c0 + i * cw + cw / 2, y, rgb(SCHOOLS[k].color), { align: 'center' }));
    y += 13;
    const rowH = 21;
    const sums = { ga: 0, rl: 0, il: 0 }, cnt = { ga: 0, rl: 0, il: 0 };
    for (let s = 0; s < STAGES.length; s++) {
      const def = STAGES[s];
      const unlocked = g.isUnlocked(s);
      fb.rect(x, y, w, rowH - 2, s % 2 ? C.navy : C.slate);
      text(fb, unlocked ? (def.short || def.name) : '？？？', x + 3, y + 4, unlocked ? C.white : C.steel);
      mini(fb, String(s + 1), x + c0 - 6, y + 7, C.steel, 'right');
      SCHOOL_KEYS.forEach((k, i) => {
        const r = g.rec(def.id, k);
        const cx = x + c0 + i * cw;
        if (r && r.got) {
          fb.icon(ICON.medal, cx + 3, y + 6, rgb(SCHOOLS[k].color));
          text(fb, `${r.cost}${r.unit || ''}`, cx + cw - 3, y + 4, C.white, { align: 'right' });
          sums[k] += r.cost || 0; cnt[k]++;
        } else if (unlocked && g.loadBrain(def.id, k)) {
          text(fb, '修行中', cx + cw / 2, y + 4, C.steel, { align: 'center' });
        }
      });
      y += rowH;
    }
    // まとめ
    y += 4;
    panel(fb, x, y, w, bot - y - 2, { fill: C.navy });
    let yy = y + 5;
    text(fb, 'かかった数の単位', x + 6, yy, C.silver); yy += 13;
    text(fb, '進化流: 挑戦したでしの人数', x + 6, yy, C.lime); yy += 12;
    text(fb, '強化流: 挑戦した回数', x + 6, yy, C.orange); yy += 12;
    text(fb, '模倣流: 人が教えた歩数', x + 6, yy, C.cyan); yy += 14;
    if (cnt.ga && cnt.rl) textBlock(fb, `進化流は強化流のおよそ${Math.max(1, Math.round((sums.ga / cnt.ga) / Math.max(1, sums.rl / cnt.rl)))}倍の挑戦。お手本があれば、ずっと少なくてすむ。`, x + 6, yy, w - 12, C.cream);
    else textBlock(fb, '同じ修行場を3つの流派でクリアすると、学び方のちがいが数字で見えてくるぞ。', x + 6, yy, w - 12, C.cream);
  }
}
