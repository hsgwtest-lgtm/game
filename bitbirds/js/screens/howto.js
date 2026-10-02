// しくみ（AIが学ぶしくみを、動くドット絵で説明する）

import { C, text, mini, button } from '../ui/widgets.js';
import { ICON, CHICK, colors } from '../gfx/sprites.js';
import { textBlock } from '../gfx/font.js';
import { FAMILIES, EYE } from '../core/config.js';
import { drawEye, drawStick, drawChart, heat, signed } from '../ui/viz.js';
import { rgb } from '../gfx/fb.js';
import { RNG } from '../core/rng.js';

const PAGES = [
  {
    title: 'ヒナの目',
    body: 'ヒナは前を 7×5＝35本の光線で見ている。近い物ほど明るく、遠いと暗い。この35マスの「ピクセル画像」と、速さ・位置の4つが脳への入力じゃ。',
    draw: 'eye',
  },
  {
    title: 'ヒナの脳',
    body: '入力39 → 隠れ層10 → 出力2（横と縦の操縦）。つながりの強さを「重み」といい、全部で422こ。重みしだいで、同じ景色でも動きが変わる。',
    draw: 'brain',
  },
  {
    title: 'しんか1  えらぶ',
    body: '全員が同じコースを飛び、遠くまで飛べた子ほど親に選ばれやすい。上位の数羽は「エリート」として、そのまま次の世代にも残る。',
    draw: 'select',
  },
  {
    title: 'しんか2  まぜる・かえる',
    body: '子の脳は、親2羽の脳をニューロンごとに混ぜて作る（交叉）。さらに、ところどころをランダムに少し変える（突然変異）。新しい動きはここから生まれる。',
    draw: 'dna',
  },
  {
    title: 'ほうしゅうの工夫',
    body: '最初はみんなすぐぶつかって差がつかない。そこで、穴の近くでぶつかった子には少しだけ点を足す。「穴に近づく」ことから学べるようにする工夫じゃ。',
    draw: 'reward',
  },
  {
    title: 'まねして学ぶ',
    body: '「おしえる」では、きみの操縦が正解データになる。AIの答えと正解の差（誤差）が小さくなるように重みを少しずつ直す。これを何千回もくり返す（誤差逆伝播）。',
    draw: 'imitate',
  },
  {
    title: 'たすけて教える',
    body: 'まねだけだと、きみが見せなかった場面でAIは迷う。AIに飛ばせて、危ない時だけ指でたすけると、苦手な場面のお手本がふえて強くなる（DAgger）。',
    draw: 'dagger',
  },
  {
    title: 'あそびかたのコツ',
    body: '・速さ8Xや高速しんかで一気に進める\n・伸びなやんだら突然変異を「たかい」に\n・推しを選ぶとカメラが追いかける\n・教えたヒナを「むれへ」入れて進化を後押し\n・前のステージの学びは次で生きる（転移学習）',
    draw: 'tips',
  },
];

export class HowtoScreen {
  constructor(app) {
    this.app = app;
    this.page = 0;
    this.t = 0;
    this.rng = new RNG(7);
    this.famCols = FAMILIES.map(f => colors({ c: rgb(f.color), d: rgb(f.dark) }));
    // 説明用の固定DNA
    this.dnaA = Float32Array.from({ length: 220 }, () => this.rng.gauss() * 0.7);
    this.dnaB = Float32Array.from({ length: 220 }, () => this.rng.gauss() * 0.7);
    this.eye = new Float32Array(EYE.cols * EYE.rows);
  }

  enter(p) { this.page = p.page || 0; this.t = 0; }
  viewHeight() { return 0; }
  update(dt) { this.t += dt; }

  draw(fb) {
    const app = this.app, px = app.px;
    const VW = px.VW, VH = px.VH, top = px.safe.t, bot = VH - px.safe.b;
    fb.rect(0, 0, VW, VH, C.ink);
    // ヘッダー
    button(app, 'ht_back', 4, top + 4, 22, 16, '', () => { app.sfx('back'); app.go('menu'); }, { icon: ICON.back });
    text(fb, 'AIのしくみ', 32, top + 6, C.cyan);
    mini(fb, `${this.page + 1}/${PAGES.length}`, VW - 6, top + 10, C.silver, 'right');
    const pg = PAGES[this.page];
    text(fb, pg.title, VW / 2, top + 28, C.yellow, { align: 'center', bold: true });
    // 絵
    const ix = 8, iy = top + 44, iw = VW - 16, ih = 132;
    fb.rect(ix - 1, iy - 1, iw + 2, ih + 2, C.steel);
    fb.rect(ix, iy, iw, ih, C.navy);
    this['draw_' + pg.draw](fb, ix, iy, iw, ih);
    // 本文
    textBlock(fb, pg.body, 10, iy + ih + 10, VW - 20, C.white, null, 13);
    // ページ送り
    const by = bot - 26;
    const bw = Math.floor((VW - 24) / 2);
    button(app, 'ht_prev', 8, by, bw, 20, 'まえ', () => { this.page = Math.max(0, this.page - 1); this.t = 0; }, { icon: ICON.back, disabled: this.page === 0 });
    if (this.page < PAGES.length - 1) button(app, 'ht_next', 16 + bw, by, bw, 20, 'つぎ', () => { this.page++; this.t = 0; }, { icon: ICON.next, accent: C.cyan });
    else button(app, 'ht_done', 16 + bw, by, bw, 20, 'おわり', () => app.go('menu'), { accent: C.lime });
    // ページの点
    for (let i = 0; i < PAGES.length; i++) fb.rect(VW / 2 - PAGES.length * 4 + i * 8 + 2, by - 9, 4, 4, i === this.page ? C.cyan : C.slate);
  }

  // ── 各ページの絵 ──
  draw_eye(fb, x, y, w, h) {
    const t = this.t;
    // 左: 横から見た図（鳥・光線・穴のあいた壁）
    const bx = x + 14, by = y + 66;
    const wallX = x + 92;
    const holeY = Math.round(y + 66 + Math.sin(t * 1.3) * 30);
    fb.rect(wallX, y + 8, 6, h - 16, C.cream);
    fb.rect(wallX, holeY - 12, 6, 24, C.navy);
    fb.frame(wallX - 1, holeY - 13, 8, 26, C.gold);
    for (let i = 0; i < 5; i++) {
      const ty = by + (i - 2) * 22;
      const ey = Math.round(by + (ty - by));
      const hit = Math.abs(ey - holeY) > 12;
      fb.dline(bx + 8, by, hit ? wallX : wallX + 40, hit ? ey : by + (ey - by) * 1.43, hit ? C.yellow : C.blue, 1, 1);
    }
    fb.sprite(CHICK, bx - 4, by - 4, this.famCols[0]);
    text(fb, '横から見た図', x + 4, y + 2, C.steel);
    // 右: ヒナの目の画像
    const ex = x + w - 7 * 8 - 10, ey = y + 34;
    const hc = Math.round(3 + Math.sin(t * 0.9) * 2.4);
    const hr = Math.round(2 - Math.sin(t * 1.3) * 1.6);
    for (let r = 0; r < EYE.rows; r++) for (let c = 0; c < EYE.cols; c++) {
      const inHole = Math.abs(c - hc) <= 1 && Math.abs(r - hr) <= 1;
      this.eye[r * EYE.cols + c] = inHole ? 0.05 + 0.05 * Math.sin(t * 3 + c) : 0.55 + 0.08 * Math.sin(t * 2 + r + c) + (c === 0 || c === 6 ? 0.2 : 0);
    }
    drawEye(fb, this.eye, ex, ey, 8, true);
    text(fb, 'ヒナの目', ex + 4, ey - 15, C.white);
    text(fb, '暗い所＝穴', ex - 2, ey + 46, C.cyan);
  }

  draw_brain(fb, x, y, w, h) {
    const t = this.t;
    const colsX = [x + 22, x + w / 2, x + w - 24];
    const ins = 13, hid = 10;
    const inPos = [], hPos = [], oPos = [];
    for (let i = 0; i < ins; i++) inPos.push([colsX[0], Math.round(y + 12 + i * (h - 24) / (ins - 1))]);
    for (let j = 0; j < hid; j++) hPos.push([Math.round(colsX[1]), Math.round(y + 14 + j * (h - 28) / (hid - 1))]);
    oPos.push([colsX[2], y + h * 0.35 | 0], [colsX[2], y + h * 0.65 | 0]);
    const rng = new RNG(3);
    for (const a of inPos) for (const b of hPos) {
      const wv = rng.gauss();
      if (Math.abs(wv) < 1.1) continue;
      const pulse = Math.sin(t * 3 + a[1] * 0.1) > 0.3;
      fb.dline(a[0] + 3, a[1], b[0] - 3, b[1], pulse ? signed(wv, 2) : C.slate, 1, 1);
    }
    for (const a of hPos) for (const b of oPos) {
      const wv = rng.gauss();
      fb.line(a[0] + 3, a[1], b[0] - 4, b[1], signed(wv, 2));
    }
    inPos.forEach(([px, py], i) => { fb.rect(px - 2, py - 2, 5, 5, C.ink); fb.rect(px - 1, py - 1, 3, 3, heat((Math.sin(t * 2 + i) + 1) / 2)); });
    hPos.forEach(([px, py], j) => { fb.disc(px, py, 3, C.ink); fb.disc(px, py, 2, signed(Math.sin(t * 2.5 + j * 1.7), 1)); });
    oPos.forEach(([px, py], k) => { fb.disc(px, py, 4, C.ink); fb.disc(px, py, 3, signed(Math.sin(t * 1.5 + k * 2), 1)); });
    mini(fb, 'IN 39', colsX[0], y + 2, C.gray, 'center');
    mini(fb, 'HIDDEN 10', colsX[1], y + 2, C.gray, 'center');
    mini(fb, 'OUT 2', colsX[2], y + 2, C.gray, 'center');
    text(fb, '横', colsX[2] + 7, oPos[0][1] - 5, C.white);
    text(fb, '縦', colsX[2] + 7, oPos[1][1] - 5, C.white);
  }

  draw_select(fb, x, y, w, h) {
    const t = this.t;
    const n = 8;
    const ds = [310, 280, 190, 160, 120, 90, 40, 25];
    const fams = [5, 0, 5, 3, 7, 2, 9, 4];
    text(fb, '飛んだきょり', x + 4, y + 2, C.steel);
    for (let i = 0; i < n; i++) {
      const yy = y + 16 + i * 14;
      fb.sprite(CHICK, x + 6, yy, this.famCols[fams[i]]);
      const bw = Math.round((w - 70) * ds[i] / 320 * Math.min(1, t * 0.8));
      fb.rect(x + 20, yy + 2, bw, 4, i < 2 ? C.yellow : i < 5 ? C.cyan : C.steel);
      mini(fb, `${ds[i]}m`, x + 24 + bw, yy + 2, C.silver);
      if (i < 2) { fb.icon(ICON.crown, x + w - 40, yy, C.yellow); text(fb, 'エリート', x + w - 32, yy - 2, C.yellow); }
      else if (i < 5 && Math.floor(t * 2) % 2) text(fb, '親候補', x + w - 32, yy - 2, C.cyan);
    }
  }

  draw_dna(fb, x, y, w, h) {
    const t = this.t;
    const cols = 11, size = 4;
    const A = this.dnaA.subarray(0, 110), B = this.dnaB.subarray(0, 110);
    const ax = x + 8, bx = x + 8 + cols * size + 18, cx = x + w - cols * size - 8, yy = y + 22;
    text(fb, '親A', ax, y + 6, rgb(FAMILIES[5].color));
    text(fb, '親B', bx, y + 6, rgb(FAMILIES[3].color));
    text(fb, '子', cx, y + 6, C.white);
    const draw = (g, ox, src, mut) => {
      for (let i = 0; i < g.length; i++) {
        const px = ox + (i % cols) * size, py = yy + Math.floor(i / cols) * size;
        let c = signed(g[i], 1.2);
        if (src) c = src[i] ? rgb(FAMILIES[3].color) : rgb(FAMILIES[5].dark);
        if (mut && mut[i] && Math.floor(t * 4) % 2) c = C.white;
        fb.rect(px, py, size, size, c);
      }
    };
    draw(A, ax); draw(B, bx);
    // 子：列（ニューロン）ごとにどちらかの親から
    const src = new Uint8Array(110), mut = new Uint8Array(110), child = new Float32Array(110);
    for (let i = 0; i < 110; i++) {
      const col = i % cols;
      src[i] = (col % 3 === 1) ? 1 : 0;
      child[i] = src[i] ? B[i] : A[i];
      mut[i] = (i * 37 % 23 === 0) ? 1 : 0;
    }
    const showSrc = Math.floor(t / 2.5) % 2 === 0;
    draw(child, cx, showSrc ? src : null, mut);
    mini(fb, '+', bx - 11, yy + 18, C.white);
    mini(fb, '=', cx - 11, yy + 18, C.white);
    text(fb, showSrc ? '色＝どちらの親から来たか' : '色＝重みの値（青＋ 赤－）', x + w / 2, y + h - 30, C.silver, { align: 'center' });
    text(fb, '白く光る＝突然変異', x + w / 2, y + h - 16, C.white, { align: 'center' });
  }

  draw_reward(fb, x, y, w, h) {
    const t = this.t;
    const wx = x + w / 2 - 30, wy = y + 14, ww = 60, wh = h - 28;
    fb.rect(wx, wy, ww, wh, C.cream);
    const hx = wx + 20, hy = wy + 30;
    fb.rect(hx, hy, 22, 20, C.navy);
    fb.frame(hx - 1, hy - 1, 24, 22, C.gold);
    // ぶつかった2羽
    const p1 = [wx + 6, wy + wh - 14], p2 = [hx + 26, hy + 8];
    for (const [px, py] of [p1, p2]) { fb.icon(ICON.cross, px, py, C.red); }
    text(fb, '+0', p1[0] - 20, p1[1] - 2, C.steel);
    const pulse = Math.floor(t * 3) % 2;
    text(fb, '+ボーナス', p2[0] + 8, p2[1] - 2, pulse ? C.lime : C.yellow);
    fb.dline(p2[0] + 2, p2[1] + 2, hx + 11, hy + 10, C.lime, 1, 1);
    text(fb, '穴に近いほど 点が多い', x + w / 2, y + h - 12, C.silver, { align: 'center' });
  }

  draw_imitate(fb, x, y, w, h) {
    const t = this.t;
    const k = Math.min(1, t / 6);
    const hx = Math.sin(t * 1.3) * 0.8, hy = Math.cos(t * 0.9) * 0.6;
    const ax = hx * k + Math.sin(t * 3.1) * 0.6 * (1 - k), ay = hy * k + Math.cos(t * 2.3) * 0.6 * (1 - k);
    drawStick(fb, x + 30, y + 40, 22, ax, ay, C.yellow, hx, hy, C.white);
    fb.rect(x + 8, y + 70, 3, 3, C.white); text(fb, 'あなた', x + 14, y + 66, C.white);
    fb.rect(x + 8, y + 84, 3, 3, C.yellow); text(fb, 'AI', x + 14, y + 80, C.yellow);
    const data = [];
    for (let i = 0; i < 40; i++) data.push(0.3 * Math.exp(-i / 9) + 0.02 + 0.015 * Math.sin(i * 1.7));
    const n = Math.max(2, Math.min(40, Math.floor(t * 8)));
    drawChart(fb, x + 70, y + 20, w - 80, 70, [{ data: data.slice(0, n), color: C.pink, dot: true }], { ymax: 0.34 });
    text(fb, '誤差', x + 72, y + 6, C.pink);
    text(fb, '学習するほど 黄の点が白に近づく', x + w / 2, y + h - 14, C.silver, { align: 'center' });
  }

  draw_dagger(fb, x, y, w, h) {
    const t = this.t;
    // コース（上から見た図）
    const lx = x + 30, rx = x + w - 30;
    fb.rect(lx - 3, y + 6, 3, h - 12, C.clay);
    fb.rect(rx, y + 6, 3, h - 12, C.clay);
    // AIの道（右へずれていく）
    const ph = (t % 4) / 4;
    let px = (lx + rx) / 2, py = y + h - 10;
    for (let i = 0; i < 40; i++) {
      const f = i / 40;
      const nx = (lx + rx) / 2 + f * f * 60;
      const ny = y + h - 10 - f * (h - 24);
      if (f <= ph) fb.line(px | 0, py | 0, nx | 0, ny | 0, f > 0.55 ? C.red : C.yellow);
      px = nx; py = ny;
    }
    if (ph > 0.55) {
      const hy = y + h - 10 - 0.55 * (h - 24);
      const hx = (lx + rx) / 2 + 0.3 * 60;
      fb.icon(ICON.hand, hx - 10, hy - 3, C.white);
      text(fb, 'たすけ！', hx - 50, hy - 6, C.white);
      fb.dline(hx | 0, hy | 0, (lx + rx) / 2 | 0, y + 14, C.lime, 1, 1);
    }
    fb.icon(ICON.robot, (lx + rx) / 2 - 3, y + h - 10, C.gold);
    text(fb, '苦手な場面をおぼえる', x + w / 2, y + 2, C.silver, { align: 'center' });
  }

  draw_tips(fb, x, y, w, h) {
    const t = this.t;
    fb.sprite(CHICK, x + w / 2 - 14, y + 40 + Math.round(Math.sin(t * 3) * 2), this.famCols[0], 3);
    for (let i = 0; i < 5; i++) {
      const a = t * 1.5 + i * 1.256;
      fb.icon(ICON.star, Math.round(x + w / 2 + Math.cos(a) * 60 - 3), Math.round(y + 60 + Math.sin(a) * 40 - 3), [C.yellow, C.cyan, C.pink, C.lime, C.orange][i]);
    }
  }
}
