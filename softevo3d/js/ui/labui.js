// 育成画面の窓: つよさ（ステータス）・かんきょう選び

import { C, win, button, text, bar, mini, dim, LINE_H } from './widgets.js';
import { drawIso } from './iso.js';
import { MOVE_ICON } from '../gfx/icons.js';
import { MOVES, MOVE_KEYS, titleFor, levelFor, levelProgress, levelThreshold, formatFit } from '../evo/growth.js';
import { TERRAINS, TERRAIN_KEYS } from '../sim/terrain.js';
import { GRAVITIES, GRAVITY_KEYS, OBJECTIVES, OBJECTIVE_KEYS, normalizeEnv } from '../sim/creature.js';
import { envLabel } from '../evo/session.js';
import { bodyStats } from '../sim/body.js';
import { rgb } from '../gfx/fb.js';
import { CH_COLOR } from '../core/config.js';
import { wrap } from '../gfx/font.js';

export class StatusModal {
  constructor(app, session) { this.app = app; this.s = session; this.t = 0; }
  update(dt) { this.t += dt; }
  close() { this.app.closeModal(this); }
  draw(fb, top) {
    const app = this.app, px = app.px, VW = px.VW, rec = this.s.rec;
    dim(fb, 0, 0, VW, px.VH);
    const w = VW - 10, x = 5;
    const y = px.safe.t + 12, h = px.VH - px.safe.b - y - 6;
    if (top) app.ui.btn('st_bg', 0, 0, VW, px.VH, () => {});
    win(fb, x, y, w, h, { title: 'つよさ', titleCenter: true });
    // 体の絵
    fb.rect(x + 8, y + 10, 70, 56, C.ink);
    drawIso(fb, rec.voxels, x + 43, y + 38, 66, 52);
    const tx = x + 84;
    text(fb, rec.name, tx, y + 10, C.white, { bold: true });
    text(fb, `LV ${rec.level}`, tx, y + 23, C.yellow);
    text(fb, `「${titleFor(rec.level)}」`, tx, y + 35, C.cyan);
    const obj = rec.env.objective;
    const sc = rec.scores[obj] || 0;
    const lvObj = levelFor(obj, sc);
    bar(fb, tx, y + 50, w - (tx - x) - 10, 5, levelProgress(obj, sc, lvObj), C.lime, C.ink, C.slate);
    const need = Math.max(0, levelThreshold(obj, lvObj + 1) - sc);
    text(fb, `つぎまで ${obj === 'jump' ? (need * 100).toFixed(1) + 'cm' : need >= 1 ? need.toFixed(2) + 'm' : (need * 100).toFixed(0) + 'cm'}`, tx, y + 56, C.silver);
    let cy = y + 72;
    const row = (k, v, col = C.white) => { text(fb, k, x + 10, cy, C.silver); text(fb, v, x + w - 10, cy, col, { align: 'right' }); cy += LINE_H; };
    row('世代', `${rec.gen}`);
    row('生まれてからの のび', obj === 'jump' ? `+${(sc * 100).toFixed(1)}cm` : `+${sc.toFixed(2)}m`, C.lime);
    const st = bodyStats(rec.voxels);
    row('からだ', `${st.count}ブロック ${st.kg.toFixed(1)}kg`);
    const L = this.s.L;
    row('のう', `${L.nIn}→${L.nH}→${L.nOut}  つながり${L.len - 1}`);
    if (rec.parent) row('おや', `${rec.parent.name} を かいぞう`);
    // 筋肉の色
    text(fb, '筋肉の神経', x + 10, cy, C.silver);
    let mx = x + w - 10 - st.channels.length * 12;
    for (const c of st.channels) { fb.rect(mx, cy + 2, 9, 8, C.ink); fb.rect(mx + 1, cy + 3, 7, 6, rgb(CH_COLOR[c])); text(fb, 'ABCDEF'[c], mx + 2, cy, C.ink); mx += 12; }
    cy += LINE_H + 4;
    // 記録
    text(fb, 'きろく', x + 10, cy, C.gold); cy += LINE_H;
    const bests = Object.entries(rec.bests || {}).sort((a, b) => b[1].gen - a[1].gen).slice(0, 3);
    if (!bests.length) { text(fb, 'まだ ありません', x + 16, cy, C.steel); cy += LINE_H; }
    for (const [k, b] of bests) {
      const [terrain, gravity, objective] = k.split('/');
      text(fb, envLabel({ terrain, gravity, objective }), x + 16, cy, C.white);
      text(fb, formatFit(objective, b.fit), x + w - 10, cy, C.gold, { align: 'right' });
      cy += LINE_H;
    }
    cy += 4;
    // わざ
    const learned = MOVE_KEYS.filter(k => rec.moves[k] !== undefined).length;
    text(fb, `おぼえた わざ ${learned}/${MOVE_KEYS.length}`, x + 10, cy, C.cyan); cy += LINE_H + 1;
    const cols = 3, cw = Math.floor((w - 16) / cols);
    MOVE_KEYS.forEach((k, i) => {
      const cx = x + 8 + (i % cols) * cw, yy = cy + Math.floor(i / cols) * 14;
      if (yy > y + h - 30) return;
      const has = rec.moves[k] !== undefined;
      const ic = MOVE_ICON[MOVES[k].icon];
      if (has) fb.sprite(ic, cx, yy + 1, ic.cols);
      else fb.rect(cx, yy + 1, 9, 9, C.slate);
      text(fb, has ? MOVES[k].name : '？？？', cx + 11, yy, has ? C.white : C.steel);
    });
    if (top) button(app, 'st_close', x + w / 2 - 30, y + h - 20, 60, 15, 'とじる', () => this.close());
  }
}

export class EnvModal {
  constructor(app, session, onApply) {
    this.app = app; this.s = session; this.onApply = onApply;
    this.env = normalizeEnv(session.rec.env);
  }
  update() {}
  close() { this.app.closeModal(this); }
  draw(fb, top) {
    const app = this.app, px = app.px, VW = px.VW;
    dim(fb, 0, 0, VW, px.VH);
    const w = VW - 12, x = 6, h = 214;
    const y = Math.max(px.safe.t + 14, Math.round((px.VH - h) / 2));
    if (top) app.ui.btn('env_bg', 0, 0, VW, px.VH, () => {});
    win(fb, x, y, w, h, { title: 'かんきょうを かえる', titleCenter: true });
    let cy = y + 10;
    const group = (label, keys, table, field, cols = keys.length) => {
      text(fb, label, x + 10, cy, C.silver); cy += 12;
      const bw = Math.floor((w - 20 - (cols - 1) * 3) / cols);
      keys.forEach((k, i) => {
        const bx = x + 10 + (i % cols) * (bw + 3), by = cy + Math.floor(i / cols) * 18;
        button(app, `env_${field}_${k}`, bx, by, bw, 15, table[k].name, () => { this.env[field] = k; }, { active: this.env[field] === k });
      });
      cy += 19 + (Math.ceil(keys.length / cols) - 1) * 18;
    };
    group('ちけい', TERRAIN_KEYS, TERRAINS, 'terrain', 2);
    group('じゅうりょく', GRAVITY_KEYS, GRAVITIES, 'gravity');
    group('もくてき', OBJECTIVE_KEYS, OBJECTIVES, 'objective');
    const e = this.env;
    const desc = `${TERRAINS[e.terrain].desc}。${OBJECTIVES[e.objective].desc}`;
    wrap(desc, w - 20).slice(0, 3).forEach(l => { text(fb, l, x + 10, cy, C.white); cy += LINE_H; });
    text(fb, '脳は そのまま 学びなおす', x + 10, y + h - 38, C.gray);
    button(app, 'env_cancel', x + 10, y + h - 22, Math.floor((w - 24) / 2), 15, 'やめる', () => this.close());
    button(app, 'env_ok', x + 14 + Math.floor((w - 24) / 2), y + h - 22, Math.ceil((w - 24) / 2), 15, 'かえる', () => {
      this.close();
      this.onApply(this.env);
    }, { accent: C.lime });
  }
}
