// メインメニュー

import { C, text, mini, bigButton, button, panel } from '../ui/widgets.js';
import { ICON, CHICK, PROF, colors } from '../gfx/sprites.js';
import { STAGES, PAL } from '../core/config.js';
import { rgb } from '../gfx/fb.js';
import { drawLogo } from './title.js';

export class MenuScreen {
  constructor(app) {
    this.app = app;
    this.t = 0;
    this.chickCol = colors({ c: rgb(PAL.yellow), d: rgb(PAL.gold) });
    this.mimicCol = colors({ c: rgb(PAL.gold), d: rgb(PAL.orange) });
    this.profCol = colors();
  }

  enter() {
    this.t = 0;
    this.app.demo.ensure();
    const g = this.app.game;
    if (!g.seen.menu) {
      g.seen.menu = true; g.saveProgress();
      this.app.prof.say('ようこそ！ わしはドット博士。ここはAIのヒナを育てる研究所じゃ。まずは「そだてる」から始めてみよう。', { prio: 2, dur: 9 });
    }
  }

  update(dt) {
    this.t += dt;
    this.app.demo.update(dt);
  }

  draw(fb) {
    const app = this.app, px = app.px, g = app.game;
    const VW = px.VW, VH = px.VH, top = px.safe.t, bot = VH - px.safe.b;
    drawLogo(fb, VW / 2, top + 10, 2);
    // 研究所の状況
    const f = g.flock;
    const info = f ? `むれ GEN ${f.gen}  さいこう ${Math.floor(f.bestEver)}m` : 'まだヒナはいない';
    text(fb, info, VW / 2, top + 26, C.white, { align: 'center', outline: C.ink });
    // メダル（クリアしたステージ）
    const n = STAGES.length;
    const mx = Math.round(VW / 2 - (n * 12) / 2);
    for (let i = 0; i < n; i++) {
      const rec = g.progress.stages[STAGES[i].id];
      const unlocked = i < g.progress.unlocked;
      const x = mx + i * 12, y = top + 40;
      fb.rect(x, y, 10, 10, C.ink);
      fb.rect(x + 1, y + 1, 8, 8, unlocked ? C.slate : C.navy);
      if (rec && rec.evo) fb.icon(ICON.medal, x + 3 - 1, y + 1, C.gold);
      else if (!unlocked) fb.icon(ICON.lock, x + 3 - 1 + 1, y + 2 - 1, C.steel);
      else mini(fb, String(i + 1), x + 4, y + 3, C.silver);
    }
    // ボタン
    const bw = Math.min(VW - 20, 240), bx = Math.round((VW - bw) / 2);
    const bh = 34, gap = 5;
    const total = bh * 4 + gap * 3 + 18;
    let y = bot - total - 6;
    // 博士の吹き出し
    const ph = app.prof.draw(fb, 6, Math.max(top + 54, y - 46), VW - 12, 3);
    void ph;
    bigButton(app, 'm_evo', bx, y, bw, bh, 'そだてる', '遺伝的アルゴリズムで進化', () => app.go('stages', { mode: 'evolve' }),
      { sprite: CHICK, spriteColors: this.chickCol, accent: C.yellow });
    y += bh + gap;
    bigButton(app, 'm_teach', bx, y, bw, bh, 'おしえる', '模倣学習（まねっこ）', () => app.go('stages', { mode: 'teach' }),
      { sprite: CHICK, spriteColors: this.mimicCol, accent: C.gold });
    y += bh + gap;
    bigButton(app, 'm_race', bx, y, bw, bh, 'きそう', '育てたAIとレース', () => app.go('stages', { mode: 'race' }),
      { icon: ICON.flag, accent: C.magenta });
    y += bh + gap;
    bigButton(app, 'm_howto', bx, y, bw, bh, 'しくみ', 'AIが学ぶしくみ', () => app.go('howto'),
      { icon: ICON.eye, accent: C.cyan });
    y += bh + gap + 2;
    const sw = Math.floor((bw - 4) / 2);
    button(app, 'm_set', bx, y, sw, 15, 'せってい', () => app.go('settings'), { icon: ICON.gear });
    button(app, 'm_snd', bx + sw + 4, y, bw - sw - 4, 15, g.settings.sound ? 'おと ON' : 'おと OFF', () => {
      g.settings.sound = !g.settings.sound; app.sound.setOn(g.settings.sound); g.saveSettings();
    }, { icon: g.settings.sound ? ICON.sound : ICON.mute });
  }
}
