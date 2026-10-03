// 設定: 音・表示・ロボの管理・オンラインの接続先

import { C } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text } from '../gfx/font.js';
import { topBar, backdrop } from '../ui/layout.js';
import { fmtSteps } from '../game/coach.js';
import { DEFAULT_DB, dbUrl, setDbUrl } from '../net/fire.js';

export class SettingsScreen {
  constructor(app) { this.app = app; this.confirm = null; }

  enter() { this.confirm = null; }
  leave() { this.app.G.save(); }
  update() {}
  view() { return null; }

  toggle(ui, id, y, label, on, sub) {
    const W = ui.W, fb = ui.fb;
    text(fb, label, 10, y + 4, col(C.white));
    if (sub) text(fb, sub, 10, y + 16, col(C.lilac), { maxW: W - 90 });
    return ui.chip(id, W - 70, y + 2, 62, 18, on ? 'ON' : 'OFF', on, { onFace: C.green });
  }

  draw(ui) {
    const app = this.app, fb = ui.fb, G = app.G, S = G.settings;
    const W = ui.W, H = ui.H;
    backdrop(app);
    if (topBar(app, 'せってい') === 'back') return this.back();
    const y0 = app.top + 21;
    const off = ui.beginScroll('set', 0, y0, W, H - app.bottom - y0);
    let y = y0 + 6 + off;
    ui.header(6, y, W - 12, '音');
    y += 14;
    if (this.toggle(ui, 'set-sfx', y, '効果音', S.sfx)) { S.sfx = !S.sfx; app.sound.setSfx(S.sfx); G.save(); }
    y += 26;
    if (this.toggle(ui, 'set-music', y, 'BGM', S.music)) { S.music = !S.music; app.sound.setMusic(S.music); G.save(); }
    y += 30;
    ui.header(6, y, W - 12, '表示');
    y += 14;
    if (this.toggle(ui, 'set-outline', y, '3Dの輪郭線', S.outline)) { S.outline = !S.outline; app.r.outline = S.outline; G.save(); }
    y += 26;
    if (this.toggle(ui, 'set-policy', y, 'AIの考え（矢印）', S.policy, 'トレーニングのライブ試合')) { S.policy = !S.policy; G.save(); }
    y += 32;
    ui.header(6, y, W - 12, 'ロボ');
    y += 14;
    const bot = G.bot;
    text(fb, `${bot.name}（学習 ${fmtSteps(bot.steps)}手）`, 10, y + 2, col(C.white), { maxW: W - 20 });
    y += 16;
    if (this.confirm === 'reset') {
      text(fb, '脳とアルバムが消えます。いい？', 10, y + 4, col(C.salmon));
      if (ui.button('set-reset-ok', W - 70, y, 62, 20, 'リセット', { face: C.ruby })) { G.resetBrain(bot); this.confirm = null; ui.toast('脳をリセットしたよ', C.mint); }
    } else if (ui.button('set-reset', 8, y, W - 16, 20, 'このロボの脳をリセット（学習をやりなおす）', { face: C.night })) this.confirm = 'reset';
    y += 26;
    if (G.s.bots.length > 1) {
      if (this.confirm === 'del') {
        text(fb, `${bot.name}を消します。いい？`, 10, y + 4, col(C.salmon));
        if (ui.button('set-del-ok', W - 70, y, 62, 20, '消す', { face: C.ruby })) { G.deleteBot(G.s.active); this.confirm = null; }
      } else if (ui.button('set-del', 8, y, W - 16, 20, 'このロボを消す', { face: C.night })) this.confirm = 'del';
      y += 26;
    }
    y += 6;
    ui.header(6, y, W - 12, 'オンライン');
    y += 14;
    text(fb, 'なまえ: ' + (G.profile.name || '（未設定）'), 10, y + 2, col(C.white));
    if (ui.button('set-name', W - 70, y, 62, 18, 'かえる', { face: C.night })) {
      app.go('name', { title: 'プレイヤー名', initial: G.profile.name, done: (v) => { G.profile.name = v; G.save(); }, ret: 'settings' });
    }
    y += 24;
    const url = dbUrl();
    text(fb, '接続先データベース', 10, y, col(C.mist));
    y += 12;
    ui.textBlock(url.replace('https://', ''), 10, y, W - 20, url === DEFAULT_DB ? C.lilac : C.gold);
    y += 26;
    if (url !== DEFAULT_DB && ui.button('set-db', 8, y, W - 16, 20, '接続先を元にもどす', { face: C.night })) { setDbUrl(''); ui.toast('もどしたよ', C.mint); }
    if (url !== DEFAULT_DB) y += 26;
    ui.textBlock('URLの末尾に ?db=https://… をつけて開くと、接続先を変えられる', 10, y, W - 20, C.dusk);
    y += 30;
    ui.header(6, y, W - 12, 'このゲームについて');
    y += 14;
    const credits = 'NURIBOTS v1.0\n3D: Three.js r128（MIT）\nフォント: PixelMplus（M+ FONT LICENSE）\nパレット: Resurrect 64\n音: Web Audio でその場で合成\n強化学習: PPO（ブラウザの中で計算）';
    y += ui.textBlock(credits, 10, y, W - 20, C.mist);
    y += 12;
    ui.endScroll('set', y - (y0 + 6 + off));
  }

  back() { if (this.confirm) { this.confirm = null; return; } this.app.go('home'); }
}
