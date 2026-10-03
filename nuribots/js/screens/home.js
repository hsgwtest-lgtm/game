// ホーム（ガレージ）: 相棒ロボの様子と、各モードへの入り口

import { C, TEAM } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text, measure } from '../gfx/font.js';
import { botPortrait, deckStrip, icon } from '../ui/widgets.js';
import { radar } from '../ui/charts.js';
import { personality, shortSteps, fmtSteps } from '../game/coach.js';
import { LEAGUE } from '../game/league.js';
import { MAX_BOTS } from '../game/save.js';
import { Net, ARCH } from '../ml/net.js';
import { Rng, randomSeed } from '../core/rng.js';

export class HomeScreen {
  constructor(app) { this.app = app; this.net = null; this.loading = false; this.wait = 0; }

  enter() {
    const app = this.app;
    app.world.camMode = 'low';
    app.world.zoom = 1;
    app.world.focus = null;
    app.sound.playSong('home');
    this.loadBot();
  }

  async loadBot() {
    const app = this.app;
    const bot = app.G.bot;
    this.botId = bot.id;
    this.loading = true;
    let net = await app.G.loadNet(bot);
    if (!net) net = new Net(ARCH).init(new Rng(7));
    if (this.botId !== bot.id) return;
    this.net = net;
    this.loading = false;
    this.newMatch();
  }

  newMatch() {
    const app = this.app;
    const bot = app.G.bot;
    const opp = (bot.train.opps || []).find(o => o !== 'self') || 'koro';
    const arenas = (bot.train.arenas || [0]).filter(a => app.G.arenaUnlocked(a));
    const arena = arenas.length ? arenas[Math.floor(Math.random() * arenas.length)] : 0;
    app.spec.start({
      arena, seed: randomSeed(), a: { type: 'net', net: this.net }, b: { type: 'cpu', key: opp }, speed: 1,
      onEnd: () => { this.wait = 2.5; },
    });
    this.wait = 0;
  }

  leave() { this.app.spec.stop(); this.app.world.camMode = 'fit'; }

  update(dt) {
    const app = this.app;
    if (this.botId !== app.G.bot.id && !this.loading) this.loadBot();
    if (this.net) app.spec.update(dt);
    if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) this.newMatch(); }
  }

  _layout() {
    const app = this.app;
    const H = app.H;
    const bottom = H - app.bottom;
    const btnH = 34, gap = 5;
    const gridY = bottom - (btnH * 3 + gap * 2) - 4;
    const panelH = 70;
    const panelY = gridY - panelH - 6;
    return { bottom, btnH, gap, gridY, panelH, panelY, viewH: panelY - 2 };
  }

  view() { return { y: 0, h: this._layout().viewH, padT: this.app.top + 16, padB: 16 }; }

  draw(ui) {
    const app = this.app, fb = ui.fb, G = app.G;
    const W = ui.W;
    const L = this._layout();
    const bot = G.bot;
    // 上のバー（3Dの上に重ねる）
    const ty = app.top;
    const li = G.leagueIndex();
    fb.rrect(3, ty, 92, 16, col(C.ink));
    text(fb, 'NURIBOTS', 8, ty + 3, col(C.mint));
    ui.mini(`${Math.min(li, LEAGUE.length)}/${LEAGUE.length}`, 90, ty + 6, C.gold, 'right');
    if (G.unlock.title) text(fb, G.unlock.title, 100, ty + 3, col(C.gold), { outline: col(C.ink) });
    if (ui.iconBtn('home-gear', W - 29, ty, 26, 16, 'gear', { face: C.night })) app.go('settings');
    // 3Dの下端にロボの今
    const vy = L.viewH;
    const sc = app.spec.env;
    if (sc) {
      const label = bot.steps ? `${bot.name} vs ${oppLabel(app)}` : `${bot.name}（まだ何も学んでいない）`;
      text(fb, label, 6, vy - 13, col(C.white), { outline: col(C.ink), maxW: W - 60 });
      ui.mini(`${sc.score(0)}-${sc.score(1)}`, W - 6, vy - 10, C.white, 'right');
    }
    // ロボのパネル
    const py = L.panelY;
    fb.rect(0, py - 2, W, L.panelH + 4, col(C.ink));
    ui.panel(4, py, W - 8, L.panelH, C.night, C.dusk);
    const n = G.s.bots.length;
    if (ui.button('home-prev', 7, py + 4, 14, L.panelH - 8, '', { icon: 'back', face: C.navy, disabled: G.s.active === 0 })) {
      G.s.active = Math.max(0, G.s.active - 1); G.save();
    }
    const canAdd = n < MAX_BOTS && G.s.active === n - 1;
    if (ui.button('home-next', W - 21, py + 4, 14, L.panelH - 8, '', { icon: canAdd ? 'plus' : 'next', face: canAdd ? C.green : C.navy, disabled: !canAdd && G.s.active >= n - 1 })) {
      if (canAdd) { const b = G.addBot(); if (b) ui.toast(`新しいロボ「${b.name}」！ ごほうびを決めて育てよう`); }
      else { G.s.active = Math.min(n - 1, G.s.active + 1); G.save(); }
    }
    const team = 0;
    botPortrait(fb, 26, py + 6, team, 2);
    // 名前（タップで変更）
    const nh = ui.hit('home-name', 62, py + 4, 100, 14);
    text(fb, bot.name, 62, py + 6, col(nh.down ? C.gold : C.white), { maxW: 96 });
    icon(fb, 'card', 62 + Math.min(96, measure(bot.name)) + 3, py + 8, C.dusk);
    if (nh.click) app.go('name', { title: 'ロボのなまえ', initial: bot.name, done: (v) => { bot.name = v; G.save(); } });
    text(fb, `学習 ${fmtSteps(bot.steps)}手`, 62, py + 19, col(C.mist));
    text(fb, personality(bot.radar), 62, py + 31, col(C.sky), { maxW: 96 });
    ui.mini(`${G.s.active + 1}/${n}`, 26, py + 46, C.lilac);
    deckStrip(fb, 62, py + 46, G.usableDeck(bot), 11, 2);
    const rx = W - 52, ry = py + 36;
    radar(fb, rx, ry, 20, bot.radar, C.mint, { labels: false });
    // ボタン
    const gx = 6, gw = (W - 12 - 6) >> 1;
    const by = L.gridY, bh = L.btnH, g = L.gap;
    const next = LEAGUE[Math.min(li, LEAGUE.length - 1)];
    const items = [
      ['home-train', 'トレーニング', bot.steps ? '続きを学習' : 'まずは学習！', C.blue, 'brain', 'train', !bot.steps],
      ['home-design', 'ごほうび設計', `カード ${G.usableDeck(bot).length}/${G.slots}`, C.green, 'card', 'design'],
      ['home-league', 'CPUリーグ', li >= LEAGUE.length ? '全員たおした！' : `つぎ: ${next.name}`, C.orange, 'trophy', 'league'],
      ['home-online', 'オンライン', 'ライブ・ゴースト', C.purple, 'globe', 'online'],
      ['home-album', 'アルバム', `${bot.album.length}まい`, C.teal, 'album', 'album'],
      ['home-howto', 'あそびかた', 'しくみ解説', C.dusk, 'book', 'howto'],
    ];
    items.forEach((it, i) => {
      const x = gx + (i % 2) * (gw + 6), y = by + Math.floor(i / 2) * (bh + g);
      if (ui.button(it[0], x, y, gw, bh, it[1], { face: it[3], icon: it[4], sub: it[2], hot: it[6] })) app.go(it[5]);
    });
  }

  back() {}
}

function oppLabel(app) {
  const m = app.spec.match;
  if (!m) return '';
  const c = m.ctl[1];
  return c.def ? c.def.name : 'CPU';
}
