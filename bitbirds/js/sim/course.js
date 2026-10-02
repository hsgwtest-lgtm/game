// コース（障害物の並び）の生成。
// 同じ stage と seed からは必ず同じコースができる（世代内の全員が同じコースを飛ぶため）。

import { WORLD } from '../core/config.js';
import { RNG } from '../core/rng.js';

export const OB_GATE = 0;    // 穴のあいた壁
export const OB_PILLAR = 1;  // 縦の柱（地面から天井まで）
export const OB_LOG = 2;     // 横の丸太（左の壁から右の壁まで）

const GATE_T = 0.8;          // ゲートの厚み

// すべての障害物を同じ形のオブジェクトにする（JSエンジンが速く扱える）
function mk(type, z) {
  return { type, z, x: 0, y: 0, r: 0, t: 0, hw: 0, hh: 0, cx: 0, cy: 0, hx: 0, hy: 0, ax: 0, ay: 0, w: 0, ph: 0 };
}

export class Course {
  constructor(stage, seed) {
    this.stage = stage;
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.obs = [];      // 障害物（z の大きい順 = 手前から奥へ）
    this.rows = [];     // 列ごとの z（「いくつ越えたか」を数える用）
    this.zNext = -stage.first;
    this.prevX = 0;
    this.prevY = WORLD.START_Y;
    this.moving = [];   // 動くゲートだけを集めたもの
    this.ensure(-160);
  }

  // z が zMin（奥）に届くまでコースを伸ばす
  ensure(zMin) {
    while (this.zNext > zMin) this._addRow();
  }

  // 動くゲートの穴の現在位置を更新する
  update(T) {
    for (let i = 0; i < this.moving.length; i++) {
      const o = this.moving[i];
      o.cx = o.hx + o.ax * Math.sin(o.w * T + o.ph);
      o.cy = o.hy + o.ay * Math.sin(o.w * 0.83 * T + o.ph * 1.7);
    }
  }

  _addRow() {
    const st = this.stage;
    const rng = this.rng;
    const spec = rng.weighted(st.rows);
    const z = this.zNext;
    const list = [];
    switch (spec.t) {
      case 'gate': list.push(this._gate(z, st.gate, false)); break;
      case 'mgate': list.push(this._gate(z, st.gate, true)); break;
      case 'pillars': this._pillars(z, st.pillars, list); break;
      case 'logs': this._logs(z, st.logs, list); break;
      case 'cross': this._cross(z, st, list); break;
    }
    list.sort((a, b) => b.z - a.z);
    for (const o of list) this.obs.push(o);
    // 列ごとに「通り道」の矩形を覚えておく（ほうしゅう設計とおてほんの目安に使う）
    const g = this._gap;
    this.rows.push({ z: z, t: spec.t, gx: g.gx, gy: g.gy, gw: g.gw, gh: g.gh, gate: g.gate || null });
    this.zNext = z - rng.range(spec.sp[0], spec.sp[1]);
  }

  _gate(z, g, moving) {
    const rng = this.rng;
    const hw = rng.range(g.hw[0], g.hw[1]);
    const hh = rng.range(g.hh[0], g.hh[1]);
    const xMin = WORLD.XMIN + hw / 2 + 0.4, xMax = WORLD.XMAX - hw / 2 - 0.4;
    const yMin = WORLD.YMIN + hh / 2 + 0.5, yMax = WORLD.YMAX - hh / 2 - 0.4;
    const s = g.shift;
    let hx = clamp(this.prevX + rng.range(-s, s), xMin, xMax);
    let hy = clamp(this.prevY + rng.range(-s * 0.7, s * 0.7), yMin, yMax);
    let ax = 0, ay = 0, w = 0, ph = 0;
    if (moving) {
      const amp = rng.range(g.amp[0], g.amp[1]);
      const per = rng.range(g.period[0], g.period[1]);
      w = Math.PI * 2 / per;
      ph = rng.range(0, Math.PI * 2);
      // 横ゆれ・縦ゆれ・ななめゆれ のどれか
      const mode = rng.int(0, 2);
      ax = mode !== 1 ? amp : 0;
      ay = mode !== 0 ? amp * 0.7 : 0;
      // 壁からはみ出さないように中心と振幅を調整
      ax = Math.min(ax, Math.max(0, (xMax - xMin) / 2));
      ay = Math.min(ay, Math.max(0, (yMax - yMin) / 2));
      hx = clamp(hx, xMin + ax, xMax - ax);
      hy = clamp(hy, yMin + ay, yMax - ay);
    }
    this.prevX = hx; this.prevY = hy;
    const o = mk(OB_GATE, z);
    o.t = GATE_T; o.hx = hx; o.hy = hy; o.hw = hw; o.hh = hh;
    o.ax = ax; o.ay = ay; o.w = w; o.ph = ph; o.cx = hx; o.cy = hy;
    o.x = hx; o.y = hy;
    if (moving) { this.moving.push(o); this.update(0); }
    this._gap = { gx: hx, gy: hy, gw: hw, gh: hh, gate: o };
    return o;
  }

  _pillars(z, p, list) {
    const rng = this.rng;
    const W0 = WORLD.XMIN, W1 = WORLD.XMAX;
    for (let tries = 0; tries < 30; tries++) {
      const n = rng.int(p.n[0], p.n[1]);
      const ps = [];
      for (let i = 0; i < n; i++) {
        const r = rng.range(p.r[0], p.r[1]);
        ps.push({ x: rng.range(W0 + 0.3, W1 - 0.3), r });
      }
      // 通れるすき間（壁と柱、柱と柱の間）を調べる
      const iv = ps.map(q => [q.x - q.r, q.x + q.r]).sort((a, b) => a[0] - b[0]);
      let best = 0, bestMid = 0, cur = W0;
      for (const [a, b] of iv) {
        if (a - cur > best) { best = a - cur; bestMid = (a + cur) / 2; }
        cur = Math.max(cur, b);
      }
      if (W1 - cur > best) { best = W1 - cur; bestMid = (W1 + cur) / 2; }
      if (best >= p.gap && best <= 8.5) {
        for (const q of ps) {
          list.push(pillar(z + rng.range(-1.2, 1.2), q.x, q.r));
        }
        this.prevX = bestMid;
        this._gap = { gx: bestMid, gy: (WORLD.YMIN + WORLD.YMAX) / 2, gw: best, gh: WORLD.YMAX - WORLD.YMIN };
        return;
      }
    }
    // うまく置けなかったら柱1本
    const x = rng.range(-4, 4);
    list.push(pillar(z, x, p.r[0]));
    this.prevX = x > 0 ? (WORLD.XMIN + x - p.r[0]) / 2 : (WORLD.XMAX + x + p.r[0]) / 2;
    this._gap = { gx: this.prevX, gy: (WORLD.YMIN + WORLD.YMAX) / 2, gw: 3, gh: WORLD.YMAX - WORLD.YMIN };
  }

  _logs(z, p, list) {
    const rng = this.rng;
    const H0 = WORLD.YMIN, H1 = WORLD.YMAX;
    for (let tries = 0; tries < 30; tries++) {
      const n = rng.int(p.n[0], p.n[1]);
      const ls = [];
      for (let i = 0; i < n; i++) {
        const r = rng.range(p.r[0], p.r[1]);
        ls.push({ y: rng.range(H0 + 1.0, H1 - 0.8), r });
      }
      const iv = ls.map(q => [q.y - q.r, q.y + q.r]).sort((a, b) => a[0] - b[0]);
      let best = 0, bestMid = 0, cur = H0;
      for (const [a, b] of iv) {
        if (a - cur > best) { best = a - cur; bestMid = (a + cur) / 2; }
        cur = Math.max(cur, b);
      }
      if (H1 - cur > best) { best = H1 - cur; bestMid = (H1 + cur) / 2; }
      if (best >= p.gap && best <= 7) {
        for (const q of ls) list.push(log(z + rng.range(-0.8, 0.8), q.y, q.r));
        this.prevY = bestMid;
        this._gap = { gx: 0, gy: bestMid, gw: WORLD.XMAX - WORLD.XMIN, gh: best };
        return;
      }
    }
    list.push(log(z, 5, p.r[0]));
    this.prevY = 2.5;
    this._gap = { gx: 0, gy: 2.4, gw: WORLD.XMAX - WORLD.XMIN, gh: 3.5 };
  }

  _cross(z, st, list) {
    const rng = this.rng;
    const pr = st.pillars ? rng.range(st.pillars.r[0], st.pillars.r[1]) : 0.8;
    const lr = st.logs ? rng.range(st.logs.r[0], st.logs.r[1]) : 0.7;
    const x = rng.range(-3.2, 3.2);
    const y = rng.range(3.4, 6.6);
    list.push(pillar(z, x, pr));
    list.push(log(z - 0.01, y, lr));
    // 一番広い区画の中心を「次の目安」にする
    const left = x - pr - WORLD.XMIN, right = WORLD.XMAX - (x + pr);
    const down = y - lr - WORLD.YMIN, up = WORLD.YMAX - (y + lr);
    this.prevX = left > right ? (WORLD.XMIN + x - pr) / 2 : (WORLD.XMAX + x + pr) / 2;
    this.prevY = down > up ? (WORLD.YMIN + y - lr) / 2 : (WORLD.YMAX + y + lr) / 2;
    this._gap = { gx: this.prevX, gy: this.prevY, gw: Math.max(left, right), gh: Math.max(down, up) };
  }
}

function pillar(z, x, r) { const o = mk(OB_PILLAR, z); o.x = x; o.r = r; return o; }
function log(z, y, r) { const o = mk(OB_LOG, z); o.y = y; o.r = r; return o; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
