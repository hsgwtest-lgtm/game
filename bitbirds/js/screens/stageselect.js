// ステージ選択（そだてる・おしえる・きそう 共通）

import { C, text, mini, button, panel } from '../ui/widgets.js';
import { ICON } from '../gfx/sprites.js';
import { STAGES } from '../core/config.js';

const MODE_INFO = {
  evolve: { title: 'そだてる', sub: 'むれを しんかさせる ステージ', color: 'yellow' },
  teach: { title: 'おしえる', sub: 'お手本を見せる ステージ', color: 'gold' },
  race: { title: 'きそう', sub: 'レースをする ステージ', color: 'magenta' },
};

// ステージの絵（障害物の種類）
export function drawStageIcon(fb, idx, x, y, w, h, locked = false) {
  const bg = locked ? C.navy : C.blue, wall = locked ? C.slate : C.cream, fr = locked ? C.steel : C.gold;
  fb.rect(x, y, w, h, bg);
  const cx = x + w / 2 | 0, cy = y + h / 2 | 0;
  switch (idx) {
    case 0: // 大きな穴
      fb.rect(x + 2, y + 2, w - 4, h - 4, wall);
      fb.rect(cx - 6, cy - 4, 12, 8, bg); fb.frame(cx - 7, cy - 5, 14, 10, fr);
      break;
    case 1: // 小さな穴
      fb.rect(x + 2, y + 2, w - 4, h - 4, wall);
      fb.rect(cx + 2, cy - 5, 7, 6, bg); fb.frame(cx + 1, cy - 6, 9, 8, fr);
      break;
    case 2: // 柱
      for (let i = 0; i < 4; i++) fb.rect(x + 3 + i * 6 + (i % 2), y + 1, 3, h - 2, locked ? C.slate : C.gray);
      break;
    case 3: // 丸太
      fb.rect(x + 1, cy - 5, w - 2, 3, locked ? C.slate : C.clay);
      fb.rect(x + 1, cy + 3, w - 2, 3, locked ? C.slate : C.clay);
      fb.rect(cx + 3, y + 1, 3, h - 2, locked ? C.slate : C.gray);
      break;
    case 4: // 動く穴
      fb.rect(x + 2, y + 2, w - 4, h - 4, wall);
      fb.rect(cx - 4, cy - 3, 8, 6, bg); fb.frame(cx - 5, cy - 4, 10, 8, locked ? C.steel : C.magenta);
      fb.icon(ICON.back, x + 1, cy - 2, locked ? C.steel : C.magenta);
      fb.icon(ICON.next, x + w - 8, cy - 2, locked ? C.steel : C.magenta);
      break;
    default: // ミックス・夜
      fb.rect(x, y, w, h, locked ? C.navy : C.ink);
      fb.rect(x + 2, y + 2, 9, h - 4, wall); fb.rect(x + 4, cy - 2, 5, 4, locked ? C.navy : C.ink);
      fb.rect(x + 14, y + 1, 3, h - 2, locked ? C.slate : C.plum);
      fb.rect(x + 11, cy + 2, w - 12, 2, locked ? C.slate : C.steel);
      if (!locked) { fb.px(x + w - 4, y + 3, C.white); fb.px(x + w - 8, y + 5, C.white); }
      break;
  }
}

export class StageSelectScreen {
  constructor(app) { this.app = app; this.mode = 'evolve'; this.t = 0; }

  enter(p) {
    this.mode = p.mode || 'evolve';
    this.t = 0;
    this.app.demo.ensure();
  }

  update(dt) { this.t += dt; this.app.demo.update(dt); }

  pick(i) {
    const app = this.app;
    app.game.stageIdx = this.mode === 'evolve' ? i : app.game.stageIdx;
    app.game.saveProgress();
    if (this.mode === 'evolve') app.go('evolve', { stageIdx: i });
    else if (this.mode === 'teach') app.go('teach', { stageIdx: i });
    else app.go('race', { stageIdx: i });
  }

  draw(fb) {
    const app = this.app, px = app.px, g = app.game;
    const VW = px.VW, VH = px.VH, top = px.safe.t, bot = VH - px.safe.b;
    const info = MODE_INFO[this.mode];
    // ヘッダー
    panel(fb, 0, 0, VW, top + 30, { fill: C.ink, border: C.ink, flat: true });
    button(app, 'ss_back', 4, top + 6, 22, 18, '', () => { app.sfx('back'); app.go('menu'); }, { icon: ICON.back });
    text(fb, info.title, 32, top + 4, C[info.color], { bold: true });
    text(fb, info.sub, 32, top + 16, C.silver);
    // カード
    const cols = 2, gap = 6;
    const cw = Math.floor((Math.min(VW, 260) - 12 - gap) / cols);
    const ch = 66;
    const x0 = Math.round((VW - (cw * cols + gap)) / 2);
    const yStart = top + 40;
    const avail = bot - yStart - 30;
    const rowsGap = Math.max(4, Math.min(10, Math.floor((avail - ch * 3) / 2)));
    for (let i = 0; i < STAGES.length; i++) {
      const st = STAGES[i];
      const c = i % cols, r = Math.floor(i / cols);
      const x = x0 + c * (cw + gap), y = yStart + r * (ch + rowsGap);
      const locked = i >= g.progress.unlocked;
      const rec = g.progress.stages[st.id] || {};
      const pressed = !locked && app.ui.btn('ss_' + i, x, y, cw, ch, () => { app.sfx('tap'); this.pick(i); });
      const oy = pressed ? 1 : 0;
      fb.rrect(x, y + 1, cw, ch - 1, C.ink);
      fb.rrect(x, y + oy, cw, ch - 1, C.ink);
      fb.rect(x + 1, y + oy + 1, cw - 2, ch - 3, locked ? C.navy : C.slate);
      if (!locked && !pressed) fb.rect(x + 1, y + oy + 1, cw - 2, 1, C.steel);
      mini(fb, 'STAGE ' + st.id, x + 4, y + oy + 4, locked ? C.steel : C.cyan);
      drawStageIcon(fb, i, x + cw - 30, y + oy + 4, 26, 16, locked);
      text(fb, st.name, x + 4, y + oy + 22, locked ? C.steel : C.white);
      if (locked) {
        fb.icon(ICON.lock, x + 4, y + oy + 37, C.steel);
        text(fb, '前をクリア', x + 12, y + oy + 35, C.steel);
      } else {
        text(fb, `${st.goal}m`, x + 4, y + oy + 35, C.silver);
        const best = this.mode === 'teach' ? (rec.teachBest || 0) : (rec.best || 0);
        if (best > 0) mini(fb, `BEST ${Math.floor(best)}m`, x + cw - 4, y + oy + 38, C.gray, 'right');
        // メダル: しんか・おしえる・きそう
        const med = [[rec.evo, C.gold, 'しんか'], [rec.teach, C.orange, 'おしえ'], [rec.race, C.magenta, 'きそう']];
        for (let k = 0; k < 3; k++) {
          const mx = x + 4 + k * 13, my = y + oy + 49;
          fb.rect(mx, my, 11, 11, C.ink);
          fb.rect(mx + 1, my + 1, 9, 9, med[k][0] ? med[k][1] : C.navy);
          if (med[k][0]) fb.icon(ICON.star, mx + 2, my + 2, C.white);
        }
      }
    }
    // 説明
    const msg = this.mode === 'evolve' ? 'クリアすると つぎのステージが ひらく'
      : this.mode === 'teach' ? 'おしえたヒナだけで ゴールすると ★'
      : '育てたAIに 勝つと ★';
    text(fb, msg, VW / 2, bot - 20, C.white, { align: 'center', outline: C.ink });
  }
}
