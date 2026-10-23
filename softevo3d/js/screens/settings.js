// せってい
import { C, text, button, iconButton, toggle, win, LINE_H } from '../ui/widgets.js';
import { ICON } from '../gfx/icons.js';
import { confirm, message } from '../ui/overlay.js';
import { db } from '../core/db.js';
import { VERSION } from '../core/config.js';
import { POP_OPTIONS } from '../evo/ga.js';
import { HIDDEN_OPTIONS } from '../sim/brain.js';
import { wrap } from '../gfx/font.js';

const DITHER = [0, 0.05, 0.09, 0.14];

export class SettingsScreen {
  constructor(app) { this.app = app; }
  enter() { this.t = 0; }
  exit() {}
  viewHeight() { return 0; }
  update(dt) { this.t += dt; }

  draw(fb) {
    const app = this.app, px = app.px, VW = px.VW, VH = px.VH, top = px.safe.t, bot = VH - px.safe.b;
    const st = app.settings;
    fb.rect(0, 0, VW, VH, C.navy);
    iconButton(app, 'set_back', 4, top + 3, 18, 14, ICON.back, () => app.go('zukan'));
    text(fb, 'せってい', 26, top + 4, C.white);
    let y = top + 26;
    const row = (label, draw) => { text(fb, label, 12, y + 1, C.white); draw(y); y += 20; };
    win(fb, 6, y - 4, VW - 12, 6 * 20 + 10);
    y += 4;
    row('こうかおん', (yy) => toggle(app, 'set_snd', VW - 40, yy + 1, st.sound, () => { st.sound = !st.sound; app.sound.setOn(st.sound); app.saveSettings(); }));
    row('BGM', (yy) => toggle(app, 'set_bgm', VW - 40, yy + 1, st.bgm, () => { st.bgm = !st.bgm; app.sound.setBgm(st.bgm); app.saveSettings(); }));
    row('りんかくせん', (yy) => toggle(app, 'set_ol', VW - 40, yy + 1, st.outline, () => { st.outline = !st.outline; app.px.outline = st.outline; app.saveSettings(); }));
    row('ディザ', (yy) => {
      const bw = 22;
      DITHER.forEach((d, i) => button(app, 'set_d' + i, VW - 16 - (DITHER.length - i) * (bw + 2), yy, bw, 14, String(i), () => { st.dither = d; app.px.ditherAmt = d; app.saveSettings(); }, { active: Math.abs(st.dither - d) < 1e-6, mini: true }));
    });
    row('むれの数', (yy) => {
      const bw = 26;
      POP_OPTIONS.forEach((p, i) => button(app, 'set_p' + p, VW - 16 - (POP_OPTIONS.length - i) * (bw + 2), yy, bw, 14, String(p), () => { st.pop = p; app.saveSettings(); }, { active: st.pop === p, mini: true }));
    });
    row('脳の大きさ', (yy) => {
      const bw = 26;
      HIDDEN_OPTIONS.forEach((p, i) => button(app, 'set_h' + p, VW - 16 - (HIDDEN_OPTIONS.length - i) * (bw + 2), yy, bw, 14, String(p), () => { st.hidden = p; app.saveSettings(); }, { active: st.hidden === p, mini: true }));
    });
    y += 6;
    for (const ln of wrap('※むれの数・脳の大きさは、新しく つくる生き物から つかわれます', VW - 24)) { text(fb, ln, 12, y, C.gray); y += LINE_H; }
    y += 8;
    const info = [
      `評価ワーカー ${app.pool.broken ? 'なし（ふつうの計算）' : app.pool.maxWorkers + 'こ'}`,
      db.memoryOnly ? '保存: できません（この端末では一時的）' : '保存: この端末の中（IndexedDB）',
    ];
    info.forEach(l => { text(fb, l, 12, y, C.silver); y += LINE_H; });
    y += 8;
    button(app, 'set_help', 12, y, VW - 24, 16, 'あそびかたの説明を もういちど見る', () => { st.help = {}; app.saveSettings(); app.toast('次に画面を ひらいたとき 説明が出ます', C.lime); });
    y += 22;
    button(app, 'set_wipe', 12, y, VW - 24, 16, 'すべての データを けす', () => confirm(app, 'データを けす', '図鑑の生き物と 記録を ぜんぶ けします。もとに もどせません。', async () => {
      const list = await db.listCreatures();
      for (const r of list) await db.deleteCreature(r.id);
      app.toast('ぜんぶ けしました', C.red);
    }, 'けす', 'やめる'), { accent: C.red });
    text(fb, `SoftEvo 3D v${VERSION}`, VW / 2, bot - 48, C.steel, { align: 'center' });
    text(fb, 'Three.js r128 / PixelMplus', VW / 2, bot - 36, C.steel, { align: 'center' });
    text(fb, 'パレット Endesga 32', VW / 2, bot - 24, C.steel, { align: 'center' });
    void message;
  }
}
