// 実況コーチ: 学習の様子を見て、できごとや「報酬ハッキング」を見つけて教えてくれる。

import { EV } from '../sim/env.js';
import { C } from '../core/const.js';
import { CPU_DEFS } from '../sim/bots.js';

export function oppName(id) {
  if (id === 'self') return '自分の分身';
  if (id === 'rival') return 'ライバル';
  if (id && id.startsWith('snap')) return '過去の自分';
  return (CPU_DEFS[id] && CPU_DEFS[id].name) || id;
}

// 性格レーダー（0〜1 × 6項目）
export const RADAR_KEYS = ['ぬり', 'うばう', 'こうげき', 'よける', 'ばくだん', 'かしこさ'];
export const RADAR_SHORT = ['ぬり', 'うばう', '攻撃', '回避', '爆弾', '勝率'];
export function radarOf(sum) {
  if (!sum || !sum.n) return null;
  const e = sum.evs;
  const cl = v => Math.max(0, Math.min(1, v));
  return [
    cl((e[EV.PAINT] + e[EV.STEAL]) / 150),
    cl(e[EV.STEAL] / 70),
    cl(e[EV.HIT] / 2.5),
    cl(1 - e[EV.STUNNED] / 2.5),
    cl(e[EV.ITEM] / 2.2),
    cl(sum.winRate),
  ];
}

// 性格のひとこと
export function personality(r) {
  if (!r) return 'まだ わからない';
  const [nu, ub, ko, yo, ba, ka] = r;
  if (ko > 0.6 && nu < 0.5) return 'ハンター';
  if (ba > 0.6) return '爆弾マニア';
  if (ub > 0.7) return 'うばい屋';
  if (nu > 0.75 && ka > 0.6) return 'ぬりの達人';
  if (yo > 0.85 && ko < 0.2) return 'にげ上手';
  if (nu > 0.6) return 'はたらき者';
  if (ka < 0.2 && nu < 0.35) return 'のんびり屋';
  return 'バランス型';
}

export class Coach {
  constructor() { this.reset(); }

  reset() {
    this.flags = {};
    this.best = 0;
    this.oppWin = {};
    this.hist = [];
    this.lastSay = {};
    this.it = 0;
    this.stepMark = 0;
  }

  _once(key) { if (this.flags[key]) return false; this.flags[key] = true; return true; }
  _every(key, iters) { const l = this.lastSay[key]; if (l !== undefined && this.it - l < iters) return false; this.lastSay[key] = this.it; return true; }

  // 1回の学習ごとに呼ぶ。新しいメッセージの配列を返す
  onIter(m, deck) {
    const out = [];
    const say = (text, color = C.white, big = false) => out.push({ text, color, big });
    const L = m.loss, S = m.sum;
    this.it = m.iter;
    const w = {};
    for (const d of deck || []) w[d.id] = d.lv;
    this.hist.push({ it: m.iter, R: S.R, win: S.winRate, share: S.share, ent: L.entropy, n: S.n });
    if (this.hist.length > 120) this.hist.shift();
    if (this._once('start')) say('学習スタート！ さいしょは でたらめに動くよ', C.mint);
    // 手数の節目
    const marks = [10e3, 50e3, 100e3, 300e3, 1e6, 3e6, 1e7];
    for (const mk of marks) if (m.steps >= mk && this.stepMark < mk) { this.stepMark = mk; if (mk >= 50e3) say(`${fmtSteps(mk)}手 学習した！`, C.sky); }
    if (S.n >= 8) {
      // 自己ベスト
      if (S.share > this.best + 0.04 && S.share > 0.3) {
        this.best = S.share;
        if (this._every('best', 6)) say(`床の割合 自己ベスト ${(S.share * 100).toFixed(0)}%！`, C.gold);
      }
      // 相手ごと
      for (const id in S.byOpp) {
        const b = S.byOpp[id];
        const o = this.oppWin[id] || (this.oppWin[id] = { first: false, half: false, top: false });
        if (!o.first && b.win > 0) { o.first = true; say(`はじめて ${oppName(id)} に勝った！`, C.gold, true); }
        if (!o.half && b.n >= 6 && b.winRate >= 0.5) { o.half = true; say(`${oppName(id)} に勝ち越し！`, C.emerald, true); }
        if (!o.top && b.n >= 8 && b.winRate >= 0.9) { o.top = true; say(`${oppName(id)} は もう相手にならない！`, C.emerald); }
      }
      const e = S.evs;
      // ── 報酬ハッキングの気配 ──
      if ((w.approach || 0) > 0 && e[EV.APPROACH] > 45 && e[EV.RETREAT] > 35 && S.share < 0.5 && this._every('hackA', 25))
        say('「ちかづく」を稼ぐために行ったり来たりしてる？ これが「報酬ハッキング」', C.hotpink, true);
      if ((w.shot || 0) > 0 && e[EV.SHOT] > 16 && e[EV.HIT] < 1 && this._every('hackS', 25))
        say('弾をうつだけで ごほうび…「撃ちまくりロボ」になってきた', C.hotpink, true);
      if ((w.item || 0) >= 2 && e[EV.ITEM] > 1.6 && S.share < 0.45 && this._every('hackI', 30))
        say('爆弾ばかり追いかけて、勝負は二の次かも', C.hotpink);
      if ((w.explore || 0) >= 2 && e[EV.EXPLORE] > 90 && S.share < 0.45 && this._every('hackE', 30))
        say('たんけんに夢中。新しいマスに行くのが楽しすぎる？', C.hotpink);
      if ((w.paint || 0) < 0 && this._every('hackP', 40))
        say('「ぬる」が罰になっている… ぬらないロボに育っていく', C.hotpink);
      if ((w.hit || 0) >= 2 && e[EV.HIT] > 1.5 && S.share < 0.45 && this._every('hackH', 30))
        say('撃つのに夢中で、ぬるのを忘れてない？', C.hotpink);
      if ((w.idle || 0) <= -3 && e[EV.BUMP] > 20 && this._every('hackB', 30))
        say('ムダ足の罰が強すぎて、あせって壁にぶつかってる？', C.hotpink);
      // ごほうびと勝敗のズレ
      if (this.hist.length >= 40) {
        const a = this.hist[this.hist.length - 40], b = this.hist[this.hist.length - 1];
        if (b.R > a.R * 1.2 + 2 && b.win < a.win - 0.25 && this._every('gap', 40))
          say('ごほうびは増えたのに勝てなくなった… 本当の目的とズレているかも', C.salmon, true);
      }
      // 「かつ」だけ
      const dense = (w.paint || 0) + (w.steal || 0) + (w.lead || 0) + Math.abs(w.lost || 0);
      if ((w.win || 0) > 0 && dense === 0 && m.steps > 60e3 && S.winRate < 0.25 && this._every('sparse', 60))
        say('「かつ」だけだと手がかりが少なくて学びにくい。「リード」や「ぬる」を足すと速くなるよ', C.salmon);
    }
    // 迷い（エントロピー）
    if (L.entropy < 0.3 && m.iter < 60 && this._once('entLow')) say('迷いがほとんど消えた。同じ動きばかりになってない？', C.lavender);
    if (L.entropy > 1.55 && m.iter > 80 && this._every('entHigh', 60)) say('まだ迷っている。ごほうびの差が小さいのかも', C.lavender);
    if (L.explained > 0.8 && m.iter > 10 && this._once('value')) say('先の見通しが立ってきた（価値の予想が当たりはじめた）', C.sky);
    return out;
  }
}

export function fmtSteps(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '億';
  if (n >= 1e4) return Math.round(n / 1e4) + '万';
  return String(Math.round(n));
}

// 手数を短く（12.3k / 1.2M）
export function shortSteps(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k';
  return String(n);
}
