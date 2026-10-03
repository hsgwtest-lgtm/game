// 道場（メインメニュー）

import { C, text, mini, bigButton, button } from '../ui/widgets.js';
import { ICON, MASTER } from '../gfx/sprites.js';
import { STAGES } from '../sim/stages.js';
import { drawLogo, TITLE_STAGE } from './title.js';
import { Stage } from '../sim/env.js';

export class MenuScreen {
  constructor(app) { this.app = app; this.t = 0; }

  enter() {
    this.t = 0;
    const app = this.app, g = app.game;
    app.world.frameOpts = { top: 0.55, bot: -0.15, mx: 0.8 };
    if (!app.world.stage || app.world.stage.def.id !== 'title') {
      const st = new Stage(Object.assign({}, TITLE_STAGE, { map: TITLE_STAGE.map.map((r) => r.replace('   ...   ', '   .S.   ')) }));
      app.world.setTheme(0);
      app.world.buildStage(st);
      app.world.resetAgents([]);
    } else app.world.frameCamera(app.px.VW / app.px.VH, app.world.frameOpts);
    app.world.cam.mode = 'orbit';
    app.sound.setMood('calm');
    app.masters.clear();
    if (!g.progress.seen.menu) {
      g.progress.seen.menu = true; g.saveProgress();
      app.masters.say('ga', 'ようこそ、ドット道場へ。ここではAIのでしを、3つの流派で鍛えるのじゃ。', { prio: 2, dur: 6 });
      app.masters.say('rl', '同じ修行場でも、流派によって学び方がまるでちがうぞ！ くらべてみてくれ！', { prio: 1, dur: 6 });
      app.masters.say('il', 'まずは「修行する」から、1つ目の修行場をえらんでね。', { prio: 1, dur: 5 });
    } else {
      const n = g.medalCount();
      if (n > 0 && Math.random() < 0.6) app.masters.say(['ga', 'rl', 'il'][Math.floor(Math.random() * 3)], `いまの印は ${n}こ。全部で ${STAGES.length * 3}こあるぞ。`, { dur: 4 });
    }
  }

  exit() { this.app.world.cam.mode = 'fixed'; }
  viewHeight() { return this.app.px.VH; }
  update(dt) { this.t += dt; this.app.masters.update(dt); }

  draw(fb) {
    const app = this.app, px = app.px, g = app.game;
    const VW = px.VW, top = px.safe.t, bot = px.VH - px.safe.b;
    drawLogo(fb, VW / 2, top + 8, 3);
    const n = g.medalCount();
    text(fb, `あつめた印 ${n} / ${STAGES.length * 3}`, VW / 2, top + 28, C.white, { align: 'center', outline: C.ink });
    // 印のならび（修行場ごと3つ）
    const mw = STAGES.length * 11;
    let mx = Math.round(VW / 2 - mw / 2);
    for (let i = 0; i < STAGES.length; i++) {
      const m = g.stageMedals(STAGES[i].id);
      const unlocked = g.isUnlocked(i);
      const cols = [m.ga ? C.lime : C.slate, m.rl ? C.orange : C.slate, m.il ? C.cyan : C.slate];
      fb.rect(mx, top + 42, 10, 12, C.ink);
      for (let k = 0; k < 3; k++) fb.rect(mx + 1, top + 43 + k * 4, 8, 3, unlocked ? cols[k] : C.navy);
      mx += 11;
    }
    const bw = Math.min(VW - 20, 240), bx = Math.round((VW - bw) / 2);
    const bh = 32, gap = 5;
    let y = bot - (bh * 4 + gap * 3 + 22);
    app.masters.draw(fb, 6, Math.min(y - 6, top + 62), VW - 12, 3, { anchorBottom: false });
    bigButton(app, 'm_train', bx, y, bw, bh, '修行する', '修行場と流派をえらぶ', () => app.go('stages'), { icon: ICON.scroll, accent: C.lime });
    y += bh + gap;
    bigButton(app, 'm_cmp', bx, y, bw, bh, '三流派くらべ', '育てたでしで対抗戦', () => app.go('stages', { compare: true }), { icon: ICON.trophy, accent: C.orange });
    y += bh + gap;
    bigButton(app, 'm_howto', bx, y, bw, bh, 'しくみ', '3つの学び方のちがい', () => app.go('howto'), { icon: ICON.book, accent: C.cyan });
    y += bh + gap;
    bigButton(app, 'm_rec', bx, y, bw, bh, '記録帳', 'かかった回数をくらべる', () => app.go('records'), { icon: ICON.medal, accent: C.gold });
    y += bh + gap + 3;
    const sw = Math.floor((bw - 4) / 2);
    button(app, 'm_set', bx, y, sw, 15, 'せってい', () => app.go('settings'), { icon: ICON.gear });
    button(app, 'm_snd', bx + sw + 4, y, bw - sw - 4, 15, g.settings.sound ? 'おと ON' : 'おと OFF', () => {
      g.settings.sound = !g.settings.sound; app.sound.setOn(g.settings.sound); g.saveSettings();
    }, { icon: g.settings.sound ? ICON.sound : ICON.mute });
  }
}
