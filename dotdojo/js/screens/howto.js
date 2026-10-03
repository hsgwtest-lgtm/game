// しくみ：3つの学び方のちがいを、動くドット絵で説明する

import { C, text, mini, button, panel } from '../ui/widgets.js';
import { ICON, MASTER } from '../gfx/sprites.js';
import { textBlock, LINE_H, wrap } from '../gfx/font.js';
import { FAMILIES, PAL } from '../core/config.js';
import { rgb } from '../gfx/fb.js';
import { heat, drawMiniArrow } from '../ui/viz.js';

const FAM = FAMILIES.map((f) => rgb(f.color));

const PAGES = [
  {
    title: 'でしの目と脳', who: 'il',
    body: 'でしの目は、まわり5×5マス。かべ・きけん・巻物・アイテムが見えて、巻物の方角もわかる。脳は小さなニューラルネット（入力105→16→行動5）。3つの流派はみんな同じ目と同じ形の脳を使う。ちがうのは「学び方」だけ。',
    draw: 'eye',
  },
  {
    title: '進化流（遺伝的アルゴリズム）', who: 'ga',
    body: '群れ全員が挑戦して、成績（ごほうびの合計）がよい子が親になる。親2人の脳をまぜて（交叉）、少しランダムに変える（突然変異）。手がかりは最後の成績だけ。たくさんの挑戦が必要だが、思いもよらない解き方を見つけることもある。',
    draw: 'ga',
  },
  {
    title: '強化流（強化学習）', who: 'rl',
    body: '1歩ごとに「ごほうび」と「ばつ」をもらう。予想よりごほうびが多かった行動は確率を上げ、少なかった行動は下げる。同時に「この場所からだと、あとどれくらいもらえそうか（価値）」も学ぶ。価値はゴールから逆向きに広がっていく。',
    draw: 'rl',
  },
  {
    title: '模倣流（模倣学習）', who: 'il',
    body: '人のお手本を「目に映ったもの → 押したボタン」のデータにして、同じ答えを出すように脳を直す。少ないデータですぐ覚えるが、お手本で見たことのない場面では迷いやすい。まかせて、迷った所だけ教える（DAgger）と強くなる。',
    draw: 'il',
  },
  {
    title: '3つの流派をくらべる', who: 'ga',
    body: '「先生こえ」は、教えた人より上手になれるか。模倣流はお手本そっくりが目標なので、お手本より上手にはなりにくい。進化流と強化流は自分で試すので、人が思いつかない近道を見つけることがある。そのかわり、たくさんの挑戦と、よいごほうびの決め方が必要じゃ。',
    draw: 'table',
  },
  {
    title: 'ごほうび設計のコツ', who: 'rl',
    body: '・小判のごほうびが大きいと、小判ばかり集める（ごほうびのハック）\n・ばつが大きすぎると、こわがって動かない\n・「近づいたらほめる」は行き止まりに弱い\n・「はじめての場所をほめる」と探検する\nAIは、決めたごほうびを正直に追いかける。',
    draw: 'reward',
  },
  {
    title: '合わせ技', who: 'il',
    body: 'お手本でだいたいの動きを覚えてから、強化学習で磨く。いまの会話AIやゲームAIも、この「まねしてから鍛える」順番で学ぶことが多い。卒業試験では、模倣流の脳を強化流や進化流に引きついでみよう。',
    draw: 'combo',
  },
];

export class HowtoScreen {
  constructor(app) { this.app = app; this.page = 0; this.t = 0; }

  enter(p) {
    this.page = p.page || 0;
    this.t = 0;
    this.app.sound.setMood('calm');
    this.app.masters.clear();
  }

  viewHeight() { return 0; }
  update(dt) { this.t += dt; }

  draw(fb) {
    const app = this.app, px = app.px, VW = px.VW, top = px.safe.t, bot = px.VH - px.safe.b;
    fb.rect(0, 0, VW, px.VH, C.ink);
    for (let yy = 0; yy < px.VH; yy += 8) for (let xx = (yy >> 3) & 1 ? 4 : 0; xx < VW; xx += 8) fb.px(xx, yy, C.navy);
    button(app, 'back', 3, top + 2, 18, 15, '', () => { app.sfx('back'); app.go('menu'); }, { icon: ICON.back });
    text(fb, 'しくみ', 25, top + 4, C.white);
    mini(fb, `${this.page + 1}/${PAGES.length}`, VW - 6, top + 7, C.silver, 'right');
    const pg = PAGES[this.page];
    const x = 6, w = VW - 12;
    let y = top + 22;
    // 見出し
    const spr = MASTER[pg.who];
    fb.sprite(spr, x, y, spr.cols, 1);
    text(fb, pg.title, x + 20, y + 3, C.white, { bold: true });
    y += 22;
    // 図（説明の文の長さに合わせて大きさを決める）
    const nLines = pg.body ? wrap(pg.body, w).length : 0;
    const fh = Math.max(116, Math.min(170, bot - 26 - y - 6 - nLines * LINE_H - 6));
    panel(fb, x, y, w, fh, { fill: C.navy });
    fb.setClip(x + 1, y + 1, w - 2, fh - 2);
    this['fig_' + pg.draw](fb, x + 4, y + 4, w - 8, fh - 8);
    fb.resetClip();
    y += fh + 6;
    // 説明
    if (pg.body) textBlock(fb, pg.body, x, y, w, C.cream, null, LINE_H);
    // ページ送り
    const by = bot - 20;
    button(app, 'prev', x, by, 50, 16, 'まえ', () => { this.page = (this.page + PAGES.length - 1) % PAGES.length; this.t = 0; }, { icon: ICON.left });
    button(app, 'next', VW - x - 50, by, 50, 16, 'つぎ', () => { this.page = (this.page + 1) % PAGES.length; this.t = 0; }, { icon: ICON.right, accent: C.cyan });
    for (let k = 0; k < PAGES.length; k++) fb.rect(VW / 2 - PAGES.length * 4 + k * 8, by + 6, 5, 5, k === this.page ? C.white : C.slate);
  }

  // ── 図：でしの目 ──
  fig_eye(fb, x, y, w, h) {
    const t = this.t;
    // 5×5 の目
    const cell = 12;
    const grid = [
      'wwvvv', '.d...', '..s.g', '.i..d', '.....',
    ];
    const ex = x + 6, ey = y + 18;
    text(fb, 'でしの目', ex, y, C.silver);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      const ch = grid[r][c];
      let col = C.slate;
      if (ch === 'w') col = C.gray; else if (ch === 'v' || ch === 'd') col = C.red; else if (ch === 'g') col = C.gold; else if (ch === 'i') col = C.yellow;
      fb.rect(ex + c * cell, ey + r * cell, cell - 1, cell - 1, col);
    }
    fb.frame(ex + 2 * cell - 1, ey + 2 * cell - 1, cell + 1, cell + 1, C.white);
    fb.rect(ex + 2 * cell + 3, ey + 2 * cell + 3, 4, 4, C.cyan);
    // 矢印 → 脳
    const bx = ex + 5 * cell + 10;
    for (let k = 0; k < 3; k++) {
      const phase = ((t * 30 + k * 10) % 30);
      fb.rect(bx + phase, ey + 30, 2, 2, C.cyan);
    }
    // 脳（3層）
    const nx = bx + 38;
    const ly = [ey + 6, ey + 30, ey + 54];
    for (let j = 0; j < 6; j++) {
      const yy = ey + j * 11;
      const on = Math.sin(t * 4 + j) > 0;
      fb.rect(nx, yy, 6, 6, on ? C.cyan : C.blue);
      for (let k = 0; k < 5; k++) fb.dline(nx + 6, yy + 3, nx + 34, ey + k * 13 + 3, on ? C.sky : C.slate, 1, 2);
    }
    const best = Math.floor(t) % 5;
    for (let k = 0; k < 5; k++) {
      const yy = ey + k * 13;
      fb.rect(nx + 34, yy, 7, 7, k === best ? C.yellow : C.steel);
      drawMiniArrow(fb, nx + 48, yy + 3, k, k === best ? C.yellow : C.gray);
    }
    void ly;
    text(fb, '赤=きけん 灰=かべ 金=巻物', x + 4, y + h - 13, C.silver);
  }

  // ── 図：進化流 ──
  fig_ga(fb, x, y, w, h) {
    const t = this.t % 6;
    const n = 8, cw = Math.floor((w - 8) / n);
    // 1段目: 群れ（成績のバー）
    text(fb, '1.みんな挑戦', x, y, C.silver);
    const fit = [3, 7, 2, 9, 5, 1, 6, 4];
    for (let i = 0; i < n; i++) {
      const bx = x + 4 + i * cw;
      const hh = Math.round(fit[i] * 2.4 * Math.min(1, t / 1.5));
      fb.rect(bx, y + 36 - hh, cw - 3, hh, FAM[i]);
      fb.rect(bx, y + 37, cw - 3, 5, FAM[i]);
    }
    // 2段目: 親をえらぶ
    if (t > 1.6) {
      text(fb, '2.成績のよい子が親に', x, y + 44, C.silver);
      const pA = 3, pB = 1;
      for (const [k, i] of [[0, pA], [1, pB]]) {
        const bx = x + 20 + k * 50;
        fb.rect(bx, y + 58, 16, 10, FAM[i]);
        fb.frame(bx - 1, y + 57, 18, 12, C.white);
      }
      text(fb, '×', x + 46, y + 56, C.white);
    }
    // 3段目: 子ども（まぜる＋突然変異）
    if (t > 3) {
      text(fb, '3.まぜて少し変える', x + 92, y + 44, C.silver);
      for (let c = 0; c < 4; c++) {
        const bx = x + 98 + c * 18;
        for (let s = 0; s < 4; s++) fb.rect(bx + s * 4, y + 58, 4, 10, ((s + c) & 1) ? FAM[3] : FAM[1]);
        if (Math.sin(this.t * 6 + c) > 0.6) fb.rect(bx + (c % 4) * 4, y + 58, 4, 10, C.white);
      }
    }
    if (t > 4.2) text(fb, '→ 次の世代へ（くりかえす）', x + 4, y + 80, C.lime);
  }

  // ── 図：強化流（価値が広がる）──
  fig_rl(fb, x, y, w, h) {
    const t = this.t;
    const W = 7, H = 5, cell = 12;
    const gx = x + 4, gy = y + 14;
    text(fb, 'ねだん（価値）が広がる', x, y, C.silver);
    const goal = [6, 0];
    const spread = (t * 2.2) % 16;
    if (!this._bfs) {
      // かべを回りこむ本当の道のりで距離をはかる
      const wall = (xx, yy) => xx === 3 && yy < 3;
      const dist = new Array(W * H).fill(99), q = [[goal[0], goal[1]]];
      dist[goal[1] * W + goal[0]] = 0;
      while (q.length) {
        const [cx, cy] = q.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || wall(nx, ny) || dist[ny * W + nx] < 99) continue;
          dist[ny * W + nx] = dist[cy * W + cx] + 1; q.push([nx, ny]);
        }
      }
      // 矢印：となりのマスでいちばんゴールに近い方
      const arrow = new Array(W * H).fill(-1);
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
        let best = -1, bd = dist[yy * W + xx];
        [[0, -1, 0], [0, 1, 1], [-1, 0, 2], [1, 0, 3]].forEach(([dx, dy, a]) => {
          const nx = xx + dx, ny = yy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
          if (dist[ny * W + nx] < bd) { bd = dist[ny * W + nx]; best = a; }
        });
        arrow[yy * W + xx] = best;
      }
      this._bfs = { dist, arrow, wall };
    }
    const { dist, arrow, wall } = this._bfs;
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      if (wall(xx, yy)) { fb.rect(gx + xx * cell, gy + yy * cell, cell - 1, cell - 1, C.gray); continue; }
      const d = dist[yy * W + xx];
      const v = d <= spread ? Math.max(0, 1 - d / 11) : 0;
      fb.rect(gx + xx * cell, gy + yy * cell, cell - 1, cell - 1, heat(v * 0.95));
      if (d <= spread && d > 0 && arrow[yy * W + xx] >= 0) drawMiniArrow(fb, gx + xx * cell + 5, gy + yy * cell + 5, arrow[yy * W + xx], C.white);
    }
    fb.icon(ICON.scroll, gx + goal[0] * cell + 2, gy + 3, C.ink);
    // 右：ごほうび
    const rx = gx + W * cell + 8;
    text(fb, 'ゴール +10', rx, gy, C.yellow);
    text(fb, '落ちる -1', rx, gy + 13, C.pink);
    text(fb, '1歩 -0.02', rx, gy + 26, C.silver);
    text(fb, '予想より', rx, gy + 44, C.white);
    text(fb, '多い→増やす', rx, gy + 56, C.lime);
    text(fb, '少ない→減らす', rx, gy + 68, C.pink);
  }

  // ── 図：模倣流 ──
  fig_il(fb, x, y, w, h) {
    const t = this.t % 7;
    text(fb, 'お手本', x, y, C.silver);
    // お手本の道（人）
    const path = [[0, 4], [0, 3], [1, 3], [1, 2], [2, 2], [2, 1], [3, 1], [3, 0]];
    const cell = 11, gx = x + 4, gy = y + 14;
    for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 4; xx++) fb.rect(gx + xx * cell, gy + yy * cell, cell - 1, cell - 1, C.forest);
    const k = Math.min(path.length - 1, Math.floor(t * 2));
    for (let i = 1; i <= k; i++) {
      const [x0, y0] = path[i - 1], [x1, y1] = path[i];
      fb.line(gx + x0 * cell + 5, gy + y0 * cell + 5, gx + x1 * cell + 5, gy + y1 * cell + 5, C.white);
    }
    fb.rect(gx + path[k][0] * cell + 3, gy + path[k][1] * cell + 3, 5, 5, C.cyan);
    // データ（目 → ボタン）
    const dx = gx + 4 * cell + 8;
    text(fb, 'データ', dx, y, C.silver);
    const acts = [0, 3, 0, 3, 0, 3, 0];
    for (let i = 0; i < Math.min(k, 6); i++) {
      const yy = gy + i * 9;
      fb.rect(dx, yy, 7, 7, C.slate); fb.px(dx + 3, yy + 3, C.cyan);
      text(fb, '→', dx + 9, yy - 2, C.silver);
      drawMiniArrow(fb, dx + 24, yy + 3, acts[i], C.yellow);
    }
    // DAgger
    if (t > 4) {
      const ax = dx + 40;
      text(fb, 'まかせて', ax, y, C.silver);
      text(fb, '迷ったら', ax, y + 14, C.white);
      text(fb, '手助け', ax, y + 26, C.yellow);
      fb.icon(ICON.hand, ax + 4, y + 42, C.yellow);
      text(fb, '→重く覚える', ax, y + 54, C.lime);
    }
  }

  // ── 図：くらべる表 ──
  fig_table(fb, x, y, w, h) {
    const cols = ['', '進化', '強化', '模倣'];
    const colC = [C.white, C.lime, C.orange, C.cyan];
    const rows = [
      ['手がかり', '成績', 'ごほうび', 'お手本'],
      ['必要なもの', '挑戦', '挑戦', '人'],
      ['覚える速さ', 'おそい', 'ふつう', 'はやい'],
      ['先生こえ', '○', '○', 'むり'],
      ['ほうび設計', '要', '要', '不要'],
      ['苦手', '細かい', 'ハック', '初見'],
    ];
    const cw0 = 58, cw = Math.floor((w - cw0) / 3);
    for (let c = 0; c < 4; c++) text(fb, cols[c], c === 0 ? x : x + cw0 + (c - 1) * cw + cw / 2, y, colC[c], { align: c === 0 ? 'left' : 'center' });
    for (let r = 0; r < rows.length; r++) {
      const yy = y + 14 + r * 16;
      fb.rect(x, yy - 1, w, 1, C.slate);
      text(fb, rows[r][0], x, yy + 2, C.silver);
      for (let c = 1; c < 4; c++) text(fb, rows[r][c], x + cw0 + (c - 1) * cw + cw / 2, yy + 2, C.white, { align: 'center' });
    }
  }

  // ── 図：ごほうびの落とし穴 ──
  fig_reward(fb, x, y, w, h) {
    const t = this.t;
    text(fb, '小判のわな', x, y, C.silver);
    // 小判のまわりをぐるぐる回るでし
    const cx = x + 30, cy = y + 50;
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1;
      fb.disc(Math.round(cx + Math.cos(a) * 16), Math.round(cy + Math.sin(a) * 12), 3, C.gold);
    }
    const a = t * 2.5;
    fb.rect(Math.round(cx + Math.cos(a) * 16) - 3, Math.round(cy + Math.sin(a) * 12) - 3, 7, 7, C.orange);
    fb.icon(ICON.scroll, x + 70, y + 18, C.cream);
    fb.dline(x + 48, y + 40, x + 70, y + 26, C.steel, 1, 2);
    text(fb, '巻物は？', x + 64, y + 30, C.pink);
    // 右：こわがって動かない
    const rx = x + w / 2 + 10;
    text(fb, 'ばつが大きすぎ', rx, y, C.silver);
    fb.rect(rx + 20, y + 40, 9, 9, C.orange);
    if (Math.floor(t * 3) % 2) text(fb, '…', rx + 32, y + 36, C.white);
    fb.rect(rx, y + 56, 60, 6, C.ink);
    text(fb, 'うごかない', rx + 4, y + 66, C.pink);
  }

  // ── 図：合わせ技 ──
  fig_combo(fb, x, y, w, h) {
    const t = this.t % 6;
    const cw = Math.floor((w - 20) / 3);
    const boxes = [['模倣流', 'まねる', C.cyan], ['→', '', C.white], ['強化流', '鍛える', C.orange]];
    let bx = x + 4;
    for (let i = 0; i < 3; i++) {
      const [a, b, col] = boxes[i];
      if (i === 1) { text(fb, a, bx + 8, y + 30, col); bx += 26; continue; }
      fb.rect(bx, y + 14, cw, 40, C.ink);
      fb.frame(bx, y + 14, cw, 40, col);
      text(fb, a, bx + cw / 2, y + 20, col, { align: 'center' });
      text(fb, b, bx + cw / 2, y + 34, C.white, { align: 'center' });
      bx += cw + 4;
    }
    // ゴール率のグラフ（まねで早く上がって、強化でさらに上がる）
    const gx = x + 4, gy = y + 64, gw = w - 8, gh = 40;
    fb.rect(gx, gy, gw, gh, C.ink);
    let px0 = -1, py0 = -1;
    for (let i = 0; i <= Math.min(gw - 4, t * 40); i++) {
      const f = i / (gw - 4);
      const v = f < 0.25 ? f / 0.25 * 0.6 : 0.6 + (f - 0.25) / 0.75 * 0.35;
      const px = gx + 2 + i, py = gy + gh - 3 - Math.round(v * (gh - 6));
      if (px0 >= 0) fb.line(px0, py0, px, py, f < 0.25 ? C.cyan : C.orange);
      px0 = px; py0 = py;
    }
    text(fb, 'うまさ', gx + 2, gy + 1, C.steel);
  }
}
