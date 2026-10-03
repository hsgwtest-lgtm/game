// 試合結果: スコア・できごと・「ごほうびの内訳」・相手のデッキ・解放

import { C, TEAM } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text, mini } from '../gfx/font.js';
import { lineChart, signedBar } from '../ui/charts.js';
import { cardBadge, valueColor, deckStrip } from '../ui/widgets.js';
import { CARD, CARDS, cardValue, fmtValue } from '../sim/rewards.js';
import { ARENAS } from '../sim/arenas.js';
import { fmtNum } from '../ui/deckedit.js';
import { randomSeed } from '../core/rng.js';
import { drawFace } from './battle.js';

export class ResultScreen {
  constructor(app) { this.app = app; }

  // p: { battle, res, got }
  enter(p) {
    const app = this.app, G = app.G;
    this.p = p;
    this.b = p.battle;
    this.res = p.res;
    this.me = this.b.me || 0;
    this.t = 0;
    this.got = p.got || [];
    app.world.camMode = 'low';
    app.world.zoom = 1;
    app.sound.playSong('home');
    const r = this.res;
    const won = r.winner === this.me, lost = r.winner === 1 - this.me;
    // 記録
    if (this.b.mode && this.b.mode !== 'album' && !this.b.replay && !p.recorded) {
      p.recorded = true;
      const bot = G.bot;
      if (won) bot.rec.w++; else if (lost) bot.rec.l++; else bot.rec.d++;
      if (this.b.mode === 'league' && won) this.got = G.clearLeague(this.b.leagueId);
      G.save();
      if (this.got.length) setTimeout(() => app.sound.play('unlock'), 900);
      if (this.b.afterResult) this.b.afterResult(r);
    }
  }

  leave() { this.app.world.camMode = 'fit'; }
  update(dt) { this.t += dt; }

  _layout() {
    const app = this.app, H = app.H;
    const bottom = H - app.bottom;
    return { bottom, btnY: bottom - 26, viewH: Math.floor(H * 0.3) };
  }
  view() { return { y: 0, h: this._layout().viewH, padT: this.app.top + 8, padB: 2 }; }

  draw(ui) {
    const app = this.app, fb = ui.fb, G = app.G;
    const W = ui.W;
    const L = this._layout();
    const b = this.b, r = this.res, me = this.me;
    const sides = [b.a, b.b];
    const my = sides[me], op = sides[1 - me];
    const won = r.winner === me, lost = r.winner === 1 - me;
    // バナー（3Dの上）
    const ty = app.top + 6;
    const banner = won ? 'かち！' : lost ? 'まけ…' : 'ひきわけ';
    const bc = won ? C.gold : lost ? C.mist : C.sky;
    const bounce = won ? Math.round(Math.abs(Math.sin(this.t * 4)) * 3) : 0;
    text(fb, banner, W >> 1, ty - bounce, col(bc), { align: 'center', scale: 3, outline: col(C.ink) });
    // 中身
    fb.rect(0, L.viewH, W, ui.H - L.viewH, col(C.ink));
    const off = ui.beginScroll('res', 0, L.viewH + 1, W, L.btnY - L.viewH - 5);
    let y = L.viewH + 6 + off;
    // スコア
    drawFace(fb, b.a, 8, y, 0, 2);
    drawFace(fb, b.b, W - 40, y, 1, 2);
    mini(fb, String(r.scores[0]), 48, y + 6, col(TEAM[0].light), 'left', 3);
    mini(fb, String(r.scores[1]), W - 48, y + 6, col(TEAM[1].light), 'right', 3);
    mini(fb, '-', W >> 1, y + 10, col(C.mist), 'center', 2);
    y += 34;
    text(fb, b.a.name + (me === 0 ? '（あなた）' : ''), 8, y, col(TEAM[0].light), { maxW: (W >> 1) - 10 });
    text(fb, b.b.name + (me === 1 ? '（あなた）' : ''), W - 8, y, col(TEAM[1].light), { align: 'right', maxW: (W >> 1) - 10 });
    y += 14;
    const fl = r.floor || 256;
    text(fb, `床の ${Math.round(r.scores[0] / fl * 100)}%`, 8, y, col(C.mist));
    text(fb, `${Math.round(r.scores[1] / fl * 100)}%`, W - 8, y, col(C.mist), { align: 'right' });
    text(fb, ARENAS[b.arena] ? ARENAS[b.arena].name : '', W >> 1, y, col(C.lilac), { align: 'center' });
    y += 16;
    // 陣取りの推移
    if (r.timeline && r.timeline.length > 1) {
      ui.header(6, y, W - 12, '陣取りの推移');
      y += 13;
      lineChart(fb, 8, y, W - 16, 40, [
        { data: r.timeline.map(t => t[0]), color: TEAM[0].main },
        { data: r.timeline.map(t => t[1]), color: TEAM[1].main },
      ], { min: 0, max: Math.max(...r.timeline.map(t => Math.max(t[0], t[1]))) * 1.1 + 1 });
      y += 46;
    }
    // できごと
    ui.header(6, y, W - 12, 'できごと');
    y += 14;
    const rows = [['ぬった', 'paint'], ['うばった', 'steal'], ['命中', 'hit'], ['ピヨった', 'stunned'], ['爆弾', 'item'], ['弾をうった', 'shot']];
    for (const [nm, k] of rows) {
      const v0 = r.stats[0][k], v1 = r.stats[1][k];
      text(fb, String(v0), 60, y, col(v0 > v1 ? C.white : C.mist), { align: 'right' });
      text(fb, nm, W >> 1, y, col(C.lilac), { align: 'center' });
      text(fb, String(v1), W - 60, y, col(v1 > v0 ? C.white : C.mist));
      y += 12;
    }
    y += 6;
    // 自分のロボがもらったごほうび
    if (my.deck && my.deck.length) {
      ui.header(6, y, W - 12, `${my.name}がもらったごほうび`, C.leaf);
      y += 14;
      const ev = r.ev[me];
      let max = 1, tot = 0;
      const items = my.deck.map(d => { const v = cardValue(d.id, d.lv) * ev[CARD[d.id].ev]; max = Math.max(max, Math.abs(v)); tot += v; return [d, v]; });
      for (const [d, v] of items) {
        cardBadge(fb, 8, y - 1, d.id, 11);
        text(fb, CARD[d.id].name, 22, y, col(C.mist), { maxW: 54 });
        signedBar(fb, 80, y + 3, W - 80 - 44, 5, v, max);
        mini(fb, fmtNum(v), W - 8, y + 3, col(valueColor(v)), 'right');
        y += 13;
      }
      text(fb, `ごうけい ${fmtNum(tot)}`, W - 8, y, col(valueColor(tot)), { align: 'right' });
      y += 14;
      ui.textBlock('ロボはこの合計が大きくなるように学んでいる。勝ち負けとズレていないかな？', 8, y, W - 16, C.dusk);
      y += 26;
    }
    // 相手のデッキ（オンライン・ゴースト）
    if (op.deck && op.deck.length && b.showOppDeck) {
      ui.header(6, y, W - 12, `${op.name}のごほうび設計`, C.salmon);
      y += 14;
      for (const d of op.deck) {
        if (!CARD[d.id]) continue;
        const v = cardValue(d.id, d.lv);
        cardBadge(fb, 8, y - 1, d.id, 11);
        text(fb, CARD[d.id].name, 22, y, col(C.white));
        text(fb, fmtValue(v), W - 8, y, col(valueColor(v)), { align: 'right' });
        y += 13;
      }
      if (op.steps) { text(fb, `学習 ${Math.round(op.steps / 1000)}k手`, 8, y, col(C.lilac)); y += 12; }
      y += 6;
    }
    // 解放
    if (this.got.length) {
      ui.header(6, y, W - 12, '手に入れた！', C.gold);
      y += 14;
      for (const g of this.got) {
        let s = '';
        if (g.type === 'card') { cardBadge(fb, 8, y - 1, g.id, 11); s = `ごほうびカード「${CARD[g.id].name}」`; }
        else if (g.type === 'arena') s = `アリーナ「${ARENAS[g.id].name}」`;
        else if (g.type === 'slots') s = `デッキの枠が ${g.n}まいに`;
        else if (g.type === 'title') s = `称号「${g.name}」`;
        const blink = this.t < 3 && Math.floor(this.t * 6) % 2;
        text(fb, s, 24, y, col(blink ? C.white : C.gold));
        y += 13;
      }
      y += 6;
    }
    ui.endScroll('res', y - (L.viewH + 6 + off) + 6);
    // ボタン
    const bw = Math.floor((W - 16) / 3);
    if (this.p.room) { this.drawOnlineButtons(ui, L, bw); return; }
    if (!b.noReplay && ui.button('res-replay', 4, L.btnY, bw, 22, 'リプレイ', { face: C.night, icon: 'refresh' })) {
      app.go('battle', { ...b, replay: true, onEnd: null });
    }
    if (b.rematch !== false && ui.button('res-again', 8 + bw, L.btnY, bw, 22, 'もう一回', { face: C.blue })) {
      if (typeof b.rematch === 'function') b.rematch();
      else app.go('battle', { ...b, seed: randomSeed(), replay: false, onEnd: null });
    }
    if (ui.button('res-back', 12 + bw * 2, L.btnY, bw, 22, 'もどる', { face: C.dusk })) this.back();
  }

  // オンラインの試合のあと
  drawOnlineButtons(ui, L, bw) {
    const app = this.app, fb = ui.fb, room = this.p.room, b = this.b;
    const W = ui.W;
    const over = room.state === 'over';
    const w = room.wins();
    const sync = room.checkSync(b.round);
    fb.rect(0, L.btnY - 14, W, 13, col(C.ink));
    let info = room.bestOf > 1 ? `${room.bestOf}本勝負  ${w.host} - ${w.guest}` : 'ライブ対戦';
    if (sync === false) info += '  ※結果が相手とずれています';
    text(fb, info, W >> 1, L.btnY - 13, col(sync === false ? C.salmon : C.white), { align: 'center' });
    if (ui.button('res-replay', 4, L.btnY, bw, 22, 'リプレイ', { face: C.night, icon: 'refresh' })) {
      const p = this.p;
      app.go('battle', { ...b, replay: true, clock: null, online: null, onEnd: () => app.go('result', p) });
    }
    if (!over) {
      const left = Math.max(0, Math.ceil(((room.planEnd || 0) - app.online.now()) / 1000));
      if (ui.button('res-plan', 8 + bw, L.btnY, bw * 2 + 4, 22, `作戦タイムへ（${left}）`, { face: C.green, hot: true }) || (this.t > 7 && room.planEnd)) app.go('room', {});
    } else if (ui.button('res-next', 8 + bw, L.btnY, bw * 2 + 4, 22, '最終結果へ', { face: C.blue })) app.go('room', {});
  }

  back() { const b = this.b; this.app.go(b.ret || 'home', b.retParams || {}); }
}
