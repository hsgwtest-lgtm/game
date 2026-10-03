// ごほうび設計: ロボがもらう報酬をカードで組み立てる

import { C } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text } from '../gfx/font.js';
import { topBar, backdrop } from '../ui/layout.js';
import { deckRows, cardShelf, forecast, cardInfo } from '../ui/deckedit.js';
import { botPortrait } from '../ui/widgets.js';
import { cleanDeck } from '../sim/rewards.js';

const TIPS = [
  'ロボは「ごほうびの合計」が大きくなるように学ぶ。勝ち負けそのものは知らない',
  '＋はごほうび、−は罰。強さはレベル-3〜+3',
  '「かつ」は本当の目的。でも最後にしかもらえないので手がかりが少ない',
  'へんなごほうびを入れると、へんな方法で稼ぎはじめる（報酬ハッキング）',
  '学習中でも、トレーニング画面の「ごほうび」タブで値を変えられる',
];

export class DesignScreen {
  constructor(app) { this.app = app; this.info = null; this.tip = 0; }

  enter(p = {}) {
    this.ret = p.ret || 'home';
    this.info = null;
    this.tip = Math.floor(Math.random() * TIPS.length);
    const G = this.app.G;
    G.bot.deck = cleanDeck(G.bot.deck.filter(d => G.cardUnlocked(d.id)), G.slots);
  }
  leave() { this.app.G.save(); }
  update() {}
  view() { return null; }

  draw(ui) {
    const app = this.app, fb = ui.fb, G = app.G;
    const W = ui.W, H = ui.H;
    const bot = G.bot;
    backdrop(app);
    if (this.info) ui.block();
    const tb = topBar(app, 'ごほうび設計', { right: { text: `${bot.deck.length}/${G.slots}`, color: bot.deck.length >= G.slots ? C.gold : C.mist } });
    if (tb === 'back') return this.back();
    const bottom = H - app.bottom;
    const btnY = bottom - 30;
    const y0 = app.top + 21;
    const off = ui.beginScroll('design', 0, y0, W, btnY - y0 - 4);
    let y = y0 + off + 4;
    botPortrait(fb, 6, y, 0);
    text(fb, `${bot.name} の ごほうび`, 26, y + 3, col(C.white));
    y += 20;
    ui.textBlock(TIPS[this.tip], 8, y, W - 16, C.lilac);
    y += 26;
    ui.header(6, y, W - 12, `デッキ（${bot.deck.length}/${G.slots}まい）`);
    y += 14;
    const r = deckRows(app, 6, y, W - 12, bot.deck, { id: 'dz' });
    if (r.changed) G.save();
    if (r.info) this.info = r.info;
    y += r.h + 6;
    ui.header(6, y, W - 12, 'カードを追加');
    y += 14;
    const s = cardShelf(app, 6, y, W - 12, bot.deck, { id: 'sz' });
    if (s.added) G.save();
    y += s.h + 8;
    ui.header(6, y, W - 12, 'いまのロボだと 1試合で（予想）', C.gold);
    y += 15;
    y += forecast(app, 10, y, W - 22, bot.deck, bot.evs || null);
    y += 10;
    ui.endScroll('design', y - (y0 + off));
    if (ui.button('design-go', 6, btnY, W - 12, 26, 'この設計で学習する', { face: C.blue, icon: 'play' })) {
      G.save();
      app.go('train');
    }
    if (this.info) {
      ui.unblock();
      if (cardInfo(app, this.info, bot.deck) === 'close') this.info = null;
    }
  }

  back() {
    if (this.info) { this.info = null; return; }
    this.app.go(this.ret);
  }
}
