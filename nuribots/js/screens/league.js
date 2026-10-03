// CPU リーグ: 9人のライバルに順番に挑む

import { C, TEAM } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text, measure } from '../gfx/font.js';
import { topBar, backdrop } from '../ui/layout.js';
import { portrait, cardBadge } from '../ui/widgets.js';
import { miniArena } from '../ui/charts.js';
import { LEAGUE } from '../game/league.js';
import { ARENAS, GN } from '../sim/arenas.js';
import { CARD } from '../sim/rewards.js';
import { WALL } from '../sim/env.js';
import { bossNet, bossInfo } from '../ml/boss.js';
import { Net, ARCH } from '../ml/net.js';
import { Rng, randomSeed } from '../core/rng.js';
import { ICONS, bitmap } from '../gfx/sprites.js';

export class LeagueScreen {
  constructor(app) { this.app = app; this.sel = null; }

  enter() {
    this.sel = null;
    this.app.sound.playSong('home');
    // つぎの相手が見えるようにスクロール
    const i = this.app.G.leagueIndex();
    setTimeout(() => this.app.ui.scrollTo('league', Math.max(0, (i - 2) * 48)), 0);
  }
  leave() {}
  update() {}
  view() { return null; }

  arenaOf(L) {
    if (L.arena >= 0) return L.arena;
    // どこでも: 解放済みのアリーナから毎回えらぶ
    const a = this.app.G.unlock.arenas;
    return a[Math.floor(Math.random() * a.length)];
  }

  draw(ui) {
    const app = this.app, fb = ui.fb, G = app.G;
    const W = ui.W, H = ui.H;
    backdrop(app);
    if (this.sel !== null) ui.block();
    const cur = G.leagueIndex();
    const tb = topBar(app, 'CPUリーグ', { right: { text: `${Math.min(cur, LEAGUE.length)}/${LEAGUE.length}`, color: C.gold } });
    if (tb === 'back') return this.back();
    const y0 = app.top + 21;
    const bottom = H - app.bottom;
    const off = ui.beginScroll('league', 0, y0, W, bottom - y0);
    let y = y0 + 4 + off;
    LEAGUE.forEach((L, i) => {
      const cleared = !!G.s.league.cleared[L.id];
      const open = i <= cur;
      const rh = 44;
      const h = ui.hit('lg-' + i, 6, y, W - 12, rh);
      const face = cleared ? C.navy : i === cur ? C.indigo : C.night;
      fb.rrect(6, y + (h.down ? 1 : 0), W - 12, rh, col(face));
      if (i === cur) fb.rframe(5, y - 1, W - 10, rh + 2, col(Math.floor(app.t * 3) % 2 ? C.gold : C.amber));
      // 番号
      fb.rrect(9, y + 4, 12, 12, col(C.ink));
      text(fb, String(i + 1), 15, y + 5, col(cleared ? C.gold : C.mist), { align: 'center' });
      // 顔
      fb.rrect(24, y + 4, 36, 36, col(C.ink));
      if (open) portrait(fb, 26, y + 6, L.portrait, L.look, 2);
      else {
        // シルエット
        portrait(fb, 26, y + 6, L.portrait, { b: C.night, l: C.night, d: C.night, a: C.night, e: C.night }, 2);
      }
      const isBoss = L.opp.type === 'boss';
      text(fb, open ? L.name : '？？？', 66, y + 4, col(open ? C.white : C.dusk));
      if (isBoss && open) text(fb, 'AI', 70 + measure(L.name), y + 4, col(C.hotpink));
      text(fb, open ? L.desc : 'まえの相手に勝つと挑戦できる', 66, y + 16, col(open ? C.mist : C.dusk), { maxW: W - 66 - 14 });
      const ar = L.arena >= 0 ? ARENAS[L.arena].name : 'どこでも';
      text(fb, open ? `アリーナ: ${ar}` : '', 66, y + 28, col(C.lilac), { maxW: W - 120 });
      if (cleared) {
        fb.icon(bitmap(ICONS.star), W - 20, y + 29, col(C.gold));
        text(fb, 'クリア', W - 24, y + 28, col(C.gold), { align: 'right' });
      } else if (i === cur) text(fb, 'つぎ！', W - 12, y + 28, col(C.gold), { align: 'right' });
      else if (!open) fb.icon(bitmap(ICONS.lock), W - 18, y + 28, col(C.dusk));
      if (h.click) {
        if (open) { this.sel = i; app.sound.play('click'); }
        else { ui.toast('まえの相手に勝つと挑戦できる', C.salmon); app.sound.play('deny'); }
      }
      y += rh + 4;
    });
    y += 4;
    ui.textBlock('勝つと新しいごほうびカードやアリーナが手に入る。1試合40秒の一本勝負', 8, y, W - 16, C.lilac);
    y += 30;
    ui.endScroll('league', y - (y0 + 4 + off));
    if (this.sel !== null) { ui.unblock(); this.drawSheet(ui, LEAGUE[this.sel]); }
  }

  drawSheet(ui, L) {
    const app = this.app, fb = ui.fb, G = app.G;
    const W = ui.W;
    const h = 262 + app.bottom;
    const y = ui.sheet(h, '');
    fb.rrect(8, y + 10, 52, 52, col(C.ink));
    portrait(fb, 10, y + 12, L.portrait, L.look, 3);
    text(fb, L.name, 68, y + 12, col(C.white));
    if (L.opp.type === 'boss') text(fb, '強化学習AI', 68, y + 24, col(C.hotpink));
    else text(fb, 'ルールで動くCPU', 68, y + 24, col(C.lilac));
    ui.textBlock(L.desc, 68, y + 38, W - 76, C.mist);
    let yy = y + 70;
    ui.textBlock('ヒント: ' + L.tip, 8, yy, W - 16, C.gold);
    yy += 28;
    // アリーナ
    const arenaId = L.arena;
    if (arenaId >= 0) {
      const A = ARENAS[arenaId];
      const g = new Uint8Array(GN);
      for (let c = 0; c < GN; c++) g[c] = A.wall[c] ? WALL : 0;
      miniArena(fb, 10, yy + 2, 2, g, [[A.start[0].x, A.start[0].y, 0, 0], [A.start[1].x, A.start[1].y, 0, 0]], null);
      text(fb, A.name, 48, yy + 2, col(C.white));
      ui.textBlock(A.desc, 48, yy + 14, W - 56, C.lilac);
    } else {
      text(fb, 'アリーナ: 毎回ランダム（解放ずみの中から）', 10, yy + 4, col(C.white));
    }
    yy += 40;
    // ほうび
    const u = L.unlock || {};
    const gets = [];
    for (const c of u.cards || []) gets.push(`カード「${CARD[c].name}」`);
    for (const a of u.arenas || []) gets.push(`アリーナ「${ARENAS[a].name}」`);
    if (u.slots) gets.push(`デッキ枠 ${u.slots}まい`);
    if (u.title) gets.push(`称号「${u.title}」`);
    yy += ui.textBlock('勝つと: ' + (gets.length ? gets.join('・') : 'えいよ'), 8, yy, W - 16, C.leaf) + 4;
    // ボスの準備
    let ready = true;
    if (L.opp.type === 'boss' && !bossNet(L.opp.key)) { ready = false; text(fb, 'このボスはまだ準備中です', 8, yy, col(C.salmon)); }
    const bw = Math.floor((W - 24) / 3);
    const by = y + h - app.bottom - 28;
    if (ui.button('lg-close', 8, by, bw, 24, 'とじる', { face: C.dusk })) this.sel = null;
    if (L.opp.type === 'cpu' && ui.button('lg-practice', 12 + bw, by, bw, 24, '練習する', { face: C.teal })) {
      const bot = G.bot;
      if (!bot.train.opps.includes(L.opp.key)) bot.train.opps.push(L.opp.key);
      if (arenaId >= 0 && G.arenaUnlocked(arenaId) && !bot.train.arenas.includes(arenaId)) bot.train.arenas.push(arenaId);
      G.save();
      app.ui.toast(`スパーリング相手に${L.name}を入れたよ`, C.mint);
      app.go('train', { ret: 'league' });
    }
    if (ui.button('lg-fight', 16 + bw * 2, by, bw, 24, 'たたかう', { face: C.orange, disabled: !ready, hot: ready })) this.fight(L);
  }

  async fight(L) {
    const app = this.app, G = app.G;
    const bot = G.bot;
    let net = await G.loadNet(bot);
    if (!net) net = new Net(ARCH).init(new Rng(1));
    const opp = L.opp.type === 'boss' ? { type: 'net', net: bossNet(L.opp.key) } : { type: 'cpu', key: L.opp.key };
    const info = L.opp.type === 'boss' ? bossInfo(L.opp.key) : null;
    const arena = this.arenaOf(L);
    this.sel = null;
    app.go('battle', {
      mode: 'league', leagueId: L.id, arena, seed: randomSeed(), me: 0,
      a: { spec: { type: 'net', net }, name: bot.name, portrait: 'bot', deck: G.usableDeck(bot) },
      b: { spec: opp, name: L.name, portrait: L.portrait, look: L.look, deck: info ? info.deck : null, steps: info ? info.steps : 0 },
      subtitle: `CPUリーグ ${LEAGUE.indexOf(L) + 1}戦目`, ret: 'league', showOppDeck: !!info,
    });
  }

  back() {
    if (this.sel !== null) { this.sel = null; return; }
    this.app.go('home');
  }
}

