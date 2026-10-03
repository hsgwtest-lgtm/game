// 成長アルバム: 学習のとちゅうの脳を残しておき、過去の自分と戦ったり、もどしたりできる

import { C, TEAM } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text } from '../gfx/font.js';
import { topBar, backdrop } from '../ui/layout.js';
import { lineChart, miniArena } from '../ui/charts.js';
import { b64ToGrid, MILESTONES } from '../game/save.js';
import { fmtSteps } from '../game/coach.js';
import { randomSeed } from '../core/rng.js';
import { Net, ARCH } from '../ml/net.js';
import { Rng } from '../core/rng.js';

export class AlbumScreen {
  constructor(app) { this.app = app; this.sel = null; this.confirm = false; }

  enter() { this.sel = null; this.confirm = false; }
  leave() {}
  update() {}
  view() { return null; }

  draw(ui) {
    const app = this.app, fb = ui.fb, G = app.G, bot = G.bot;
    const W = ui.W, H = ui.H;
    backdrop(app);
    if (this.sel !== null) ui.block();
    if (topBar(app, `${bot.name}のアルバム`) === 'back') return this.back();
    const y0 = app.top + 21;
    const bottom = H - app.bottom;
    const btnY = bottom - 26;
    const off = ui.beginScroll('album', 0, y0, W, btnY - y0 - 4);
    let y = y0 + 4 + off;
    ui.header(6, y, W - 12, '学習の記録（ぜんぶ）');
    y += 14;
    const hs = bot.hist;
    if (hs.length > 1) {
      lineChart(fb, 8, y, W - 16, 60, [
        { data: hs.map(h => h.sh), color: C.sky },
        { data: hs.map(h => h.w), color: C.gold },
      ], { min: 0, max: 1, grid: [0.5] });
      y += 64;
      text(fb, '金=勝率  青=床の割合', 8, y, col(C.lilac));
      text(fb, `${fmtSteps(bot.steps)}手`, W - 8, y, col(C.mist), { align: 'right' });
      y += 16;
    } else {
      text(fb, 'まだ記録がありません。トレーニングしよう', 8, y, col(C.mist));
      y += 18;
    }
    ui.header(6, y, W - 12, `成長のアルバム（${bot.album.length}まい）`);
    y += 14;
    if (!bot.album.length) {
      ui.textBlock('学習が 1万手・3万手・6万手…と進むと、そのころの脳が自動で残る', 8, y, W - 16, C.mist);
      y += 30;
    }
    const cw = Math.floor((W - 18) / 2), chh = 50;
    bot.album.forEach((a, i) => {
      const x = 6 + (i % 2) * (cw + 6), yy = y + Math.floor(i / 2) * (chh + 5);
      const h = ui.hit('al-' + i, x, yy, cw, chh);
      fb.rrect(x, yy + (h.down ? 1 : 0), cw, chh, col(C.navy));
      const g = b64ToGrid(a.g || '');
      miniArena(fb, x + 3, yy + 9, 2, g, null, null, { frame: false });
      text(fb, a.label || fmtSteps(a.steps) + '手', x + 39, yy + 5, col(C.white), { maxW: cw - 41 });
      text(fb, `勝率 ${Math.round((a.w || 0) * 100)}%`, x + 39, yy + 18, col(C.gold));
      text(fb, `床 ${Math.round((a.sh || 0) * 100)}%`, x + 39, yy + 30, col(C.sky));
      if (h.click) { this.sel = i; this.confirm = false; }
    });
    y += Math.ceil(bot.album.length / 2) * (chh + 5) + 8;
    ui.endScroll('album', y - (y0 + 4 + off));
    if (ui.button('al-snap', 6, btnY, W - 12, 22, 'いまの脳をアルバムに残す', { face: C.teal, icon: 'album', disabled: !bot.steps })) this.snapNow();
    if (this.sel !== null) { ui.unblock(); this.drawSheet(ui, bot.album[this.sel]); }
  }

  async snapNow() {
    const app = this.app, G = app.G, bot = G.bot;
    const net = await G.loadNet(bot);
    if (!net) return;
    const S = bot.hist[bot.hist.length - 1];
    await G.addSnapshot(bot, net.p, { steps: bot.steps, w: S ? S.w : 0, sh: S ? S.sh : 0, label: fmtSteps(bot.steps) + '手（手動）' });
    app.ui.toast('アルバムに残したよ', C.mint);
  }

  drawSheet(ui, a) {
    const app = this.app, fb = ui.fb, G = app.G, bot = G.bot;
    if (!a) { this.sel = null; return; }
    const W = ui.W;
    const h = 150 + app.bottom;
    const y = ui.sheet(h, a.label || '');
    text(fb, `${fmtSteps(a.steps)}手のころの${bot.name}`, 10, y + 22, col(C.white));
    text(fb, `勝率 ${Math.round((a.w || 0) * 100)}% / 床 ${Math.round((a.sh || 0) * 100)}%`, 10, y + 36, col(C.mist));
    const by = y + 56;
    if (ui.button('al-fight', 8, by, W - 16, 24, 'いまの自分 vs このころの自分', { face: C.orange })) this.fight(a);
    if (!this.confirm) {
      if (ui.button('al-restore', 8, by + 28, W - 16, 22, 'この脳にもどす', { face: C.night })) this.confirm = true;
    } else {
      text(fb, 'いまの脳は消えます。いい？', 10, by + 32, col(C.salmon));
      if (ui.button('al-restore-ok', W - 70, by + 28, 62, 22, 'もどす', { face: C.ruby })) this.restore(a);
    }
    if (ui.button('al-close', W - 70, y + h - app.bottom - 26, 62, 22, 'とじる', { face: C.dusk })) this.sel = null;
  }

  async fight(a) {
    const app = this.app, G = app.G, bot = G.bot;
    const past = await G.loadSnapshot(a);
    let now = await G.loadNet(bot);
    if (!past) { app.ui.toast('読みこめませんでした', C.scarlet); return; }
    if (!now) now = new Net(ARCH).init(new Rng(1));
    this.sel = null;
    const arenas = G.unlock.arenas;
    app.go('battle', {
      mode: 'album', arena: arenas[Math.floor(Math.random() * arenas.length)], seed: randomSeed(), me: 0,
      a: { spec: { type: 'net', net: now }, name: `${bot.name}(今)`, portrait: 'bot', deck: G.usableDeck(bot) },
      b: { spec: { type: 'net', net: past }, name: `${fmtSteps(a.steps)}手`, portrait: 'bot', look: { b: C.mist, l: C.pale, d: C.lilac, a: C.gold } },
      subtitle: '過去の自分との対決', ret: 'album',
    });
  }

  async restore(a) {
    const app = this.app, G = app.G, bot = G.bot;
    const net = await G.loadSnapshot(a);
    if (!net) return;
    await G.saveBrain(bot, { params: net.p.slice() });
    bot.steps = a.steps;
    bot.msLast = 0;
    for (const ms of MILESTONES) if (ms <= a.steps) bot.msLast = ms;
    bot.hist = bot.hist.filter(h => h.s <= a.steps);
    G.save();
    this.sel = null; this.confirm = false;
    app.ui.toast(`${fmtSteps(a.steps)}手のころの脳にもどしたよ`, C.mint);
  }

  back() {
    if (this.sel !== null) { this.sel = null; return; }
    this.app.go('home');
  }
}
