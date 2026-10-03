// あそびかた・しくみの解説（はじめての人には最初に4ページだけ）

import { C, TEAM } from '../core/const.js';
import { col } from '../ui/ui.js';
import { text, mini } from '../gfx/font.js';
import { topBar, backdrop } from '../ui/layout.js';
import { botPortrait, cardBadge, valueColor, icon } from '../ui/widgets.js';
import { CARD, cardValue, fmtValue } from '../sim/rewards.js';

const PAGES = [
  {
    title: 'NURIBOTSって？',
    body: 'アリーナの床を自分の色にぬり合う陣取りバトル。\nでも、ロボはあなたが動かすのではありません。\nあなたが決めるのは「ごほうび」。ロボは強化学習で、ごほうびをたくさんもらえる動き方を自分で見つけていきます。',
    art: 'intro',
  },
  {
    title: 'ルール',
    body: '・入ったマス、立っているマスが自分の色に\n・40秒（240手）たって、マスが多いほうの勝ち\n・ペンキ弾: 前へ4マスぬる。当たった相手はしばらくピヨる\n・ペンキ爆弾: 拾うと、まわり13マスを一気にぬる',
    art: 'rules',
  },
  {
    title: '強化学習のしくみ',
    body: '①ロボがまわりを見て行動をえらぶ ②アリーナが動いて、できごとが起きる ③できごとにカードのごほうびがつく ④ごほうびが多かった行動を増やすように、脳（ニューラルネット）を少しだけ直す（PPO）。\nこれを何万回もくり返して上手くなります。',
    art: 'loop',
  },
  {
    title: 'ごほうびカード',
    body: 'カードを組み合わせて「報酬関数」をつくります。＋はごほうび、−は罰。\nロボはごほうびの合計を大きくしようとするだけ。何をほめるかで、まったくちがう性格のロボに育ちます。',
    art: 'cards',
  },
  {
    title: '学習を見る',
    body: 'トレーニング中は、いまの脳で戦うライブ試合が流れます。矢印は「AIがどの行動をえらびそうか」。\nグラフ＝勝率と床の割合　ごほうび＝何で稼いでいるか　せいかく＝レーダー　アリーナ＝同時に進む8試合　のう＝AIの目とニューロン',
    art: 'watch',
  },
  {
    title: '報酬ハッキング',
    body: '「相手に近づいたら＋」だけだと、近づいて離れて…をくり返して稼ぐことがあります。AIは言われたとおりに、ずるい方法も見つけます。\nこれは本物のAI研究でも大事な問題。コーチが気づいたら教えてくれます。',
    art: 'hack',
  },
  {
    title: 'オンライン対戦',
    body: 'ライブ対戦: ルームコードかクイック対戦で2人で戦う。3本勝負では試合の合間に「作戦タイム」があり、相手の脳を相手に対策学習できます。\nゴースト対戦: 登録されたロボにいつでも挑戦。\n試合は両方の端末で同じ計算をするので、同じ試合が同時に見えます。',
    art: 'online',
  },
];

export class HowtoScreen {
  constructor(app) { this.app = app; this.page = 0; }

  enter(p = {}) {
    this.intro = !!p.intro;
    this.page = 0;
    this.n = this.intro ? 4 : PAGES.length;
    this.t = 0;
  }
  leave() {}
  update(dt) { this.t += dt; }
  view() { return null; }

  draw(ui) {
    const app = this.app, fb = ui.fb;
    const W = ui.W, H = ui.H;
    backdrop(app);
    const pg = PAGES[this.page];
    const tb = topBar(app, this.intro ? 'ようこそ！' : 'あそびかた・しくみ', { back: !this.intro, right: this.intro ? { label: 'とばす', w: 50 } : null });
    if (tb === 'back') return this.back();
    if (tb === 'right') return this.finish();
    const y0 = app.top + 24;
    // 絵
    const artH = 110;
    fb.rrect(8, y0, W - 16, artH, col(C.night));
    fb.rframe(8, y0, W - 16, artH, col(C.dusk));
    this.drawArt(ui, pg.art, 8, y0, W - 16, artH);
    let y = y0 + artH + 8;
    text(fb, pg.title, W >> 1, y, col(C.gold), { align: 'center' });
    y += 16;
    ui.textBlock(pg.body, 10, y, W - 20, C.pale);
    // ページ送り
    const bottom = H - app.bottom;
    const by = bottom - 28;
    for (let i = 0; i < this.n; i++) fb.rect((W >> 1) - this.n * 4 + i * 8, by - 10, 5, 5, col(i === this.page ? C.mint : C.dusk));
    if (this.page > 0 && ui.button('ht-prev', 8, by, 70, 24, 'まえ', { face: C.night, icon: 'back' })) this.page--;
    const last = this.page === this.n - 1;
    if (ui.button('ht-next', W - 98, by, 90, 24, last ? (this.intro ? 'はじめる！' : 'おわり') : 'つぎへ', { face: last ? C.green : C.blue, icon: last ? 'play' : 'next', hot: last && this.intro })) {
      if (last) this.finish(); else this.page++;
    }
  }

  finish() {
    const app = this.app;
    if (this.intro) { app.G.s.seen.intro = 1; app.G.save(); app.go('home'); app.ui.toast('まずは「トレーニング」で学習させてみよう！', C.mint, 3.5); }
    else app.go('home');
  }

  drawArt(ui, kind, x, y, w, h) {
    const fb = ui.fb, t = this.t;
    const cx = x + (w >> 1), cy = y + (h >> 1);
    if (kind === 'intro') {
      board(fb, cx - 32, cy - 26, 4, t);
      botPortrait(fb, x + 14, cy - 16, 0, 2);
      botPortrait(fb, x + w - 46, cy - 16, 1, 2);
      text(fb, 'あなた: ごほうびを決める', cx, y + h - 28, col(C.gold), { align: 'center' });
      text(fb, 'ロボ: 自分で学ぶ', cx, y + h - 15, col(C.mint), { align: 'center' });
    } else if (kind === 'rules') {
      board(fb, x + 12, y + 14, 6, t, true);
      // 弾
      const sx = x + 120, sy = y + 30;
      fb.rect(sx, sy, 8, 8, col(TEAM[0].main));
      const k = (t * 1.5) % 1;
      for (let i = 0; i < 4; i++) fb.rect(sx + 10 + i * 9, sy, 8, 8, col(i < k * 4 ? TEAM[0].light : C.pale));
      text(fb, 'ペンキ弾', sx, sy + 12, col(C.white));
      // 爆弾
      const bx = x + 140, by = y + 66;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -(2 - Math.abs(dy)); dx <= 2 - Math.abs(dy); dx++) fb.rect(bx + dx * 6, by + dy * 6, 5, 5, col(TEAM[1].main));
      fb.disc(bx + 2, by + 2, 3, col(C.ink));
      text(fb, '爆弾', bx + 20, by - 4, col(C.white));
    } else if (kind === 'loop') {
      const bw = 56, bh = 20;
      const p1 = [cx - bw / 2, y + 10], p2 = [x + w - bw - 10, cy - 4], p3 = [x + 10, cy - 4];
      fb.rrect(p1[0], p1[1], bw, bh, col(C.indigo)); text(fb, 'ロボの脳', p1[0] + bw / 2, p1[1] + 5, col(C.white), { align: 'center' });
      fb.rrect(p2[0], p2[1], bw, bh, col(C.green)); text(fb, 'アリーナ', p2[0] + bw / 2, p2[1] + 5, col(C.white), { align: 'center' });
      fb.rrect(p3[0], p3[1], bw, bh, col(C.amber)); text(fb, 'ごほうび', p3[0] + bw / 2, p3[1] + 5, col(C.white), { align: 'center' });
      arrow(fb, p1[0] + bw, p1[1] + 10, p2[0] + bw / 2, p2[1], C.mint);
      text(fb, '行動', p2[0] + 6, p1[1] + 14, col(C.mint));
      arrow(fb, p2[0] + bw / 2, p2[1] + bh, cx + 10, y + h - 14, C.leaf);
      arrow(fb, cx - 10, y + h - 14, p3[0] + bw / 2, p3[1] + bh, C.leaf);
      text(fb, 'できごと', cx, y + h - 24, col(C.leaf), { align: 'center' });
      arrow(fb, p3[0] + bw / 2, p3[1], p1[0], p1[1] + 10, C.gold);
      text(fb, '学ぶ', p3[0] + 4, p1[1] + 14, col(C.gold));
      // まわる点
      const a = t * 2;
      fb.rect(Math.round(cx + Math.cos(a) * 30), Math.round(cy + 6 + Math.sin(a) * 14), 3, 3, col(C.white));
    } else if (kind === 'cards') {
      const ex = [['paint', 2], ['idle', -1], ['win', 2]];
      ex.forEach(([id, lv], i) => {
        const yy = y + 12 + i * 30;
        fb.rrect(x + 20, yy, w - 40, 24, col(C.navy));
        cardBadge(fb, x + 25, yy + 5, id, 13);
        text(fb, CARD[id].name, x + 44, yy + 6, col(C.white));
        const v = cardValue(id, lv);
        text(fb, fmtValue(v), x + w - 28, yy + 6, col(valueColor(v)), { align: 'right' });
      });
    } else if (kind === 'watch') {
      const items = [['brain', 'のう'], ['eye', 'ライブ'], ['star', 'せいかく'], ['card', 'ごほうび']];
      items.forEach(([ic, nm], i) => {
        const xx = x + 14 + i * ((w - 28) / 4);
        fb.rrect(xx, y + 18, 40, 40, col(C.navy));
        icon(fb, ic, xx + 16, y + 30, C.mint, 1);
        text(fb, nm, xx + 20, y + 64, col(C.white), { align: 'center' });
      });
      // 学習曲線
      for (let i = 0; i < w - 40; i++) {
        const v = 1 - Math.exp(-i / 40) + Math.sin(i * 0.4 + t * 3) * 0.04;
        fb.px(x + 20 + i, y + h - 12 - Math.round(v * 20), col(C.gold));
      }
    } else if (kind === 'hack') {
      const k = Math.sin(t * 5);
      const bx = Math.round(cx - 30 + k * 18);
      botPortrait(fb, bx - 8, cy - 14, 0, 1);
      botPortrait(fb, cx + 30, cy - 14, 1, 1);
      if (k > 0.6) text(fb, '+0.2', bx - 6, cy - 30, col(C.leaf));
      arrow(fb, cx - 54, cy + 12, cx - 4, cy + 12, C.hotpink);
      arrow(fb, cx - 4, cy + 18, cx - 54, cy + 18, C.hotpink);
      text(fb, 'ちかづく＋ だけだと…', cx, y + h - 18, col(C.hotpink), { align: 'center' });
    } else if (kind === 'online') {
      botPortrait(fb, x + 20, cy - 16, 0, 2);
      botPortrait(fb, x + w - 52, cy - 16, 1, 2);
      icon(fb, 'globe', cx - 3, cy - 20, C.mint, 1);
      const k = (t * 0.8) % 1;
      fb.dline(x + 56, cy, x + w - 56, cy, col(C.dusk), 2, 2);
      fb.rect(Math.round(x + 56 + (w - 112) * k), cy - 1, 3, 3, col(C.gold));
      text(fb, '同じ試合が両方で同時に', cx, y + h - 18, col(C.white), { align: 'center' });
    }
  }

  back() {
    if (this.intro) return;
    if (this.page > 0) { this.page--; return; }
    this.app.go('home');
  }
}

function board(fb, x, y, s, t, items = false) {
  const n = 16;
  for (let r = 0; r < 8; r++) for (let c = 0; c < n; c++) {
    const v = (c + r * 0.6) < 5 + Math.sin(t + r) * 1.5 ? 1 : (c - r * 0.4) > 10 + Math.cos(t * 1.2 + r) * 1.5 ? 2 : 0;
    fb.rect(x + c * s, y + r * s, s - 1, s - 1, col(v === 1 ? TEAM[0].main : v === 2 ? TEAM[1].main : C.pale));
  }
}

function arrow(fb, x0, y0, x1, y1, c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  fb.line(x0, y0, x1, y1, col(c));
  const a = Math.atan2(y1 - y0, x1 - x0);
  for (const s of [-0.5, 0.5]) fb.line(x1, y1, Math.round(x1 - Math.cos(a + s) * 5), Math.round(y1 - Math.sin(a + s) * 5), col(c));
}
