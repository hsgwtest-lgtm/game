// ゴースト対戦: ほかのプレイヤーが登録したロボに挑戦する（相手がオフラインでも遊べる）

import { C, TEAM } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text } from '../gfx/font.js';
import { topBar, backdrop } from '../ui/layout.js';
import { botPortrait, deckStrip } from '../ui/widgets.js';
import { fmtSteps } from '../game/coach.js';
import { randomSeed, Rng } from '../core/rng.js';
import { Net, ARCH } from '../ml/net.js';
import { N_ARENAS } from '../sim/arenas.js';

export class GhostScreen {
  constructor(app) { this.app = app; this.list = null; this.err = null; this.sort = 0; }

  enter() {
    this.err = null;
    if (!this.list) this.load();
  }

  async load() {
    const app = this.app;
    this.loading = true;
    try {
      this.list = await app.online.listGhosts();
      this.err = null;
    } catch (e) { this.err = app.online.errorText(e.kind || 'network'); }
    this.loading = false;
  }

  leave() {}
  update() {}
  view() { return null; }

  sorted() {
    const l = (this.list || []).slice();
    if (this.sort === 0) l.sort((a, b) => b.t - a.t);
    else if (this.sort === 1) l.sort((a, b) => (b.w - b.l) - (a.w - a.l) || b.w - a.w);
    else l.sort((a, b) => b.steps - a.steps);
    return l;
  }

  draw(ui) {
    const app = this.app, fb = ui.fb;
    const W = ui.W, H = ui.H;
    backdrop(app);
    const tb = topBar(app, 'ゴースト対戦', { right: { icon: 'refresh' } });
    if (tb === 'back') return this.back();
    if (tb === 'right') this.load();
    let y = app.top + 23;
    this.sort = ui.tabs('gh-sort', 4, y, W - 8, 15, ['あたらしい', 'つよい', '学習量'], this.sort);
    y += 19;
    if (this.loading && !this.list) { text(fb, 'よみこみ中…', W >> 1, H >> 1, col(C.mist), { align: 'center' }); return; }
    if (this.err) { ui.textBlock(this.err, 10, y + 10, W - 20, C.salmon); return; }
    const list = this.sorted();
    if (!list.length) { ui.textBlock('まだ だれも登録していません。オンライン画面から自分のロボを登録しよう！', 10, y + 10, W - 20, C.mist); return; }
    const off = ui.beginScroll('ghosts', 0, y, W, H - app.bottom - y);
    let yy = y + 2 + off;
    for (const g of list) {
      const mine = g.oid === app.online.pid;
      const h = ui.hit('gh-' + g.key, 6, yy, W - 12, 40);
      fb.rrect(6, yy + (h.down ? 1 : 0), W - 12, 40, col(mine ? C.teal : C.navy));
      botPortrait(fb, 10, yy + 4, 1);
      text(fb, g.name, 30, yy + 3, col(C.white), { maxW: 90 });
      text(fb, `by ${g.owner}`, 30, yy + 15, col(C.lilac), { maxW: 90 });
      deckStrip(fb, 30, yy + 27, g.deck.slice(0, 6), 9, 1);
      text(fb, `${g.w}勝${g.l}敗`, W - 12, yy + 3, col(C.gold), { align: 'right' });
      text(fb, `${fmtSteps(g.steps)}手`, W - 12, yy + 15, col(C.mist), { align: 'right' });
      if (mine) text(fb, 'あなた', W - 12, yy + 27, col(C.mint), { align: 'right' });
      if (h.click) this.challenge(g);
      yy += 44;
    }
    ui.endScroll('ghosts', yy - (y + 2 + off) + 4);
  }

  async challenge(g) {
    const app = this.app, G = app.G, bot = G.bot;
    if (this.busy) return;
    this.busy = true;
    try {
      const ghost = await app.online.ghostBrain(g.key);
      let net = await G.loadNet(bot);
      if (!net) net = new Net(ARCH).init(new Rng(1));
      const arena = Math.floor(Math.random() * N_ARENAS);
      app.go('battle', {
        mode: 'ghost', arena, seed: randomSeed(), me: 0,
        a: { spec: { type: 'net', net }, name: bot.name, portrait: 'bot', deck: G.usableDeck(bot) },
        b: { spec: { type: 'net', net: ghost }, name: g.name, portrait: 'bot', deck: g.deck, steps: g.steps },
        subtitle: `${g.owner}のゴースト`, showOppDeck: true, ret: 'ghosts',
        afterResult: (res) => { app.online.reportGhost(g.key, res.winner === 1 ? 1 : res.winner === 0 ? -1 : 0); },
      });
    } catch (e) {
      app.ui.toast(e.kind ? app.online.errorText(e.kind) : 'ゴーストを読みこめませんでした', C.scarlet, 3);
    }
    this.busy = false;
  }

  back() { this.app.go('online'); }
}
