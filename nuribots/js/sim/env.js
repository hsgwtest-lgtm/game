// NURIBOTS のルール（決定論的）。
// 整数と四則演算だけで動くので、同じ seed・同じ行動なら どの端末でも結果が完全に一致する。
//
//  ・16×16 のアリーナで 2体のロボ（0=青, 1=赤）が同時に1手ずつ動く
//  ・行動: 0 とまる / 1 上 / 2 右 / 3 下 / 4 左 / 5 ペンキ弾
//  ・入ったマス・立っているマスは自分の色になる
//  ・ペンキ弾: 向いている方向へ最大4マスをぬり、相手に当たると 8手 ピヨる（動けない）
//  ・ペンキ爆弾（アイテム）: 拾うとまわり13マスを一気にぬる
//  ・240手で終了。自分の色のマスが多いほうの勝ち

import { GW, GH, GN, ARENAS } from './arenas.js';
import { Rng } from '../core/rng.js';

export const RULE = {
  T: 240,          // 1試合の手数
  STUN: 8,         // ピヨる手数
  INV: 6,          // ピヨりから回復した後の無敵
  COOL: 10,        // ペンキ弾のクールタイム
  RANGE: 4,        // ペンキ弾の射程
  ITEM_FIRST: 18,  // 最初のペンキ爆弾が出る手
  ITEM_EVERY: 30,  // 爆弾が出る間隔
  ITEM_MAX: 2,
  BOMB_R: 2,       // 爆弾の半径（ひし形）
  STEPS_PER_SEC: 6 // 試合の表示速度（1秒に6手 → 40秒）
};

export const WALL = 3;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const N_ACT = 6;

// 1手ごとに各ロボに起きた「できごと」。報酬カードはこれに重みをかけて足す
export const EV = {
  PAINT: 0,     // まっさらなマスをぬった数
  STEAL: 1,     // 相手の色をぬりかえた数
  LOST: 2,      // 自分の色をぬりかえられた数
  HIT: 3,       // ペンキ弾を当てた
  STUNNED: 4,   // 当てられてピヨった
  ITEM: 5,      // ペンキ爆弾を拾った
  APPROACH: 6,  // 自分が動いて相手に近づいた（はなれても罰はない）
  IDLE: 7,      // 何もぬれなかった手（ムダ足）
  BUMP: 8,      // かべにぶつかった
  EXPLORE: 9,   // この試合ではじめて入ったマス
  SHOT: 10,     // ペンキ弾をうった
  WIN: 11,      // 試合終了時: 勝ち +1 / 負け -1
  LEAD: 12,     // 毎手: (自分のマス − 相手のマス) ÷ 床の数
  RETREAT: 13,  // 自分が動いて相手からはなれた
};
export const N_EV = 14;

// 観察（AIの目）: 自分のまわり 7×7 マス × 4種 ＋ その他 63
export const VIEW_R = 3;
export const VIEW = VIEW_R * 2 + 1;
export const VIEW_N = VIEW * VIEW;
export const N_GLOBAL = 63;
export const OBS_N = VIEW_N * 4 + N_GLOBAL;

// 点対称の向き変換（赤ロボは「自分が左上にいる」と思って考える）
const FLIP_ACT = [0, 3, 4, 1, 2, 5];
export function flipAction(a) { return FLIP_ACT[a]; }

class Bot {
  constructor() { this.reset(0, 0, 1); }
  reset(x, y, dir) {
    this.x = x; this.y = y; this.dir = dir;
    this.stun = 0; this.inv = 0; this.cd = 0; this.just = 0;
    this.moved = 0;
    this.px = x; this.py = y;   // 前の手の位置（描画の補間用）
  }
}

// 描画用のできごと記録（学習中は使わない）
export class Fx {
  constructor() {
    this.paints = [];   // [cell, color, cause] cause: 0=移動 1=弾 2=爆弾
    this.shots = [];    // {i, x, y, d, len, hit}
    this.bombs = [];    // {i, cell}
    this.bumps = [];    // ロボ番号
    this.bounces = [];
    this.stuns = [];
    this.spawns = [];   // アイテムが出たマス
    this.turned = [];
  }
  reset() {
    this.paints.length = 0; this.shots.length = 0; this.bombs.length = 0;
    this.bumps.length = 0; this.bounces.length = 0; this.stuns.length = 0;
    this.spawns.length = 0; this.turned.length = 0;
  }
}

export class Env {
  constructor(arenaId = 0, seed = 1) {
    this.grid = new Uint8Array(GN);
    this.item = new Uint8Array(GN);
    this.items = [];
    this.visited = [new Uint8Array(GN), new Uint8Array(GN)];
    this.bots = [new Bot(), new Bot()];
    this.ev = [new Float32Array(N_EV), new Float32Array(N_EV)];
    this.cnt = [0, 0, 0, 0];
    this.blk = new Int16Array(3 * 16);   // 4×4ブロックごとの色の数
    this.blkDirty = true;
    this.rng = new Rng(seed);
    this.fx = null;
    this._tgt = [-1, -1];
    this._shoot = [0, 0];
    this.reset(arenaId, seed);
  }

  setLogging(on) { this.fx = on ? (this.fx || new Fx()) : null; }

  reset(arenaId = this.arenaId, seed) {
    if (seed !== undefined) this.rng = new Rng(seed);
    this.arenaId = arenaId;
    const A = ARENAS[arenaId];
    this.arena = A;
    this.floor = A.floor;
    const g = this.grid;
    for (let i = 0; i < GN; i++) g[i] = A.wall[i] ? WALL : 0;
    this.item.fill(0);
    this.items.length = 0;
    this.visited[0].fill(0); this.visited[1].fill(0);
    this.cnt[0] = A.floor; this.cnt[1] = this.cnt[2] = 0;
    this.t = 0;
    this.done = false;
    const s0 = A.start[0], s1 = A.start[1];
    this.bots[0].reset(s0.x, s0.y, 1);
    this.bots[1].reset(s1.x, s1.y, 3);
    this._paint(s0.y * GW + s0.x, 0, null);
    this._paint(s1.y * GW + s1.x, 1, null);
    this.visited[0][s0.y * GW + s0.x] = 1;
    this.visited[1][s1.y * GW + s1.x] = 1;
    this.ev[0].fill(0); this.ev[1].fill(0);
    this.blkDirty = true;
    if (this.fx) this.fx.reset();
  }

  // セルを i 番ロボの色にする。ev があればできごとを数える
  _paint(c, i, cause) {
    const g = this.grid;
    const col = i + 1;
    const old = g[c];
    if (old === col || old === WALL) return;
    if (cause !== null) {
      if (old === 0) this.ev[i][EV.PAINT] += 1;
      else { this.ev[i][EV.STEAL] += 1; this.ev[1 - i][EV.LOST] += 1; }
      if (this.fx) this.fx.paints.push(c, col, cause);
    }
    this.cnt[old]--;
    this.cnt[col]++;
    g[c] = col;
    this.blkDirty = true;
  }

  score(i) { return this.cnt[i + 1]; }

  // 1手すすめる。a0, a1 は実際の向きでの行動
  step(a0, a1) {
    const bots = this.bots, g = this.grid, fx = this.fx;
    const e0 = this.ev[0], e1 = this.ev[1];
    e0.fill(0); e1.fill(0);
    if (fx) fx.reset();
    const tgt = this._tgt, shoot = this._shoot;
    const acts = [a0, a1];
    for (let i = 0; i < 2; i++) {
      const b = bots[i];
      b.px = b.x; b.py = b.y; b.moved = 0;
      tgt[i] = -1; shoot[i] = 0;
      if (b.stun > 0) continue;
      const a = acts[i];
      if (a >= 1 && a <= 4) {
        const d = a - 1;
        if (fx && d !== b.dir) fx.turned.push(i);
        b.dir = d;
        const nx = b.x + DX[d], ny = b.y + DY[d];
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH || g[ny * GW + nx] === WALL) {
          this.ev[i][EV.BUMP] = 1;
          if (fx) fx.bumps.push(i);
        } else tgt[i] = ny * GW + nx;
      } else if (a === 5 && b.cd === 0) {
        shoot[i] = 1;
      }
    }
    // 移動の衝突を解決（同じマス・入れかわり・止まっている相手 → はね返る）
    const B0 = bots[0], B1 = bots[1];
    const p0 = B0.y * GW + B0.x, p1 = B1.y * GW + B1.x;
    let m0 = tgt[0] >= 0, m1 = tgt[1] >= 0;
    if (m0 && m1 && (tgt[0] === tgt[1] || (tgt[0] === p1 && tgt[1] === p0))) {
      m0 = m1 = false;
      if (fx) fx.bounces.push(0, 1);
    } else {
      if (m0 && !m1 && tgt[0] === p1) { m0 = false; if (fx) fx.bounces.push(0); }
      if (m1 && !m0 && tgt[1] === p0) { m1 = false; if (fx) fx.bounces.push(1); }
    }
    const oldD = Math.abs(B0.x - B1.x) + Math.abs(B0.y - B1.y);
    if (m0) { B0.x = tgt[0] % GW; B0.y = (tgt[0] / GW) | 0; B0.moved = 1; }
    if (m1) { B1.x = tgt[1] % GW; B1.y = (tgt[1] / GW) | 0; B1.moved = 1; }
    // 近づいた・はなれた（自分の動きの分だけ）
    for (let i = 0; i < 2; i++) {
      const b = bots[i], o = bots[1 - i];
      if (!b.moved) continue;
      const d1 = Math.abs(b.x - o.px) + Math.abs(b.y - o.py);
      const d0 = Math.abs(b.px - o.px) + Math.abs(b.py - o.py);
      if (d1 < d0) this.ev[i][EV.APPROACH] = 1;
      else if (d1 > d0) this.ev[i][EV.RETREAT] = 1;
    }
    // ペンキ弾（両方同時にうてる）
    for (let i = 0; i < 2; i++) {
      if (!shoot[i]) continue;
      const b = bots[i], o = bots[1 - i];
      b.cd = RULE.COOL;
      this.ev[i][EV.SHOT] = 1;
      let x = b.x, y = b.y, len = 0, hit = 0;
      for (let s = 1; s <= RULE.RANGE; s++) {
        x += DX[b.dir]; y += DY[b.dir];
        if (x < 0 || y < 0 || x >= GW || y >= GH) break;
        const c = y * GW + x;
        if (g[c] === WALL) break;
        len = s;
        this._paint(c, i, 1);
        if (o.x === x && o.y === y) {
          if (o.stun === 0 && o.inv === 0) {
            o.stun = RULE.STUN; o.just = 1;
            this.ev[i][EV.HIT] = 1;
            this.ev[1 - i][EV.STUNNED] = 1;
            if (fx) fx.stuns.push(1 - i);
            hit = 1;
          } else hit = 2;   // 当たったけど効かない（無敵・ピヨり中）
          break;
        }
      }
      if (fx) fx.shots.push({ i, x: b.x, y: b.y, d: b.dir, len, hit });
    }
    // ペンキ爆弾
    for (let i = 0; i < 2; i++) {
      const b = bots[i];
      const c = b.y * GW + b.x;
      if (!this.item[c]) continue;
      this.item[c] = 0;
      const k = this.items.indexOf(c);
      if (k >= 0) this.items.splice(k, 1);
      this.ev[i][EV.ITEM] = 1;
      if (fx) fx.bombs.push({ i, cell: c });
      const R = RULE.BOMB_R;
      for (let dy = -R; dy <= R; dy++) {
        const yy = b.y + dy;
        if (yy < 0 || yy >= GH) continue;
        const w = R - Math.abs(dy);
        for (let dx = -w; dx <= w; dx++) {
          const xx = b.x + dx;
          if (xx < 0 || xx >= GW) continue;
          this._paint(yy * GW + xx, i, 2);
        }
      }
    }
    // 立っているマスをぬる（ピヨっていなければ）
    for (let i = 0; i < 2; i++) {
      const b = bots[i];
      if (b.stun === 0) this._paint(b.y * GW + b.x, i, 0);
    }
    // タイマー
    for (let i = 0; i < 2; i++) {
      const b = bots[i];
      if (b.stun > 0) {
        if (b.just) b.just = 0;
        else { b.stun--; if (b.stun === 0) b.inv = RULE.INV; }
      } else if (b.inv > 0) b.inv--;
      if (b.cd > 0) b.cd--;
      const c = b.y * GW + b.x;
      const ev = this.ev[i];
      if (!this.visited[i][c]) { this.visited[i][c] = 1; ev[EV.EXPLORE] = 1; }
      if (ev[EV.PAINT] + ev[EV.STEAL] === 0) ev[EV.IDLE] = 1;
    }
    // アイテム出現
    this.t++;
    if (this.arena.items && this.t >= RULE.ITEM_FIRST &&
      (this.t - RULE.ITEM_FIRST) % RULE.ITEM_EVERY === 0 && this.items.length < RULE.ITEM_MAX) {
      this._spawnItem();
    }
    const lead = (this.cnt[1] - this.cnt[2]) / this.floor;
    e0[EV.LEAD] = lead; e1[EV.LEAD] = -lead;
    if (this.t >= RULE.T) {
      this.done = true;
      const w = Math.sign(this.cnt[1] - this.cnt[2]);
      e0[EV.WIN] = w; e1[EV.WIN] = -w;
    }
    return this.done;
  }

  _spawnItem() {
    const g = this.grid, B0 = this.bots[0], B1 = this.bots[1];
    for (let tries = 0; tries < 40; tries++) {
      const c = this.rng.int(GN);
      if (g[c] === WALL || this.item[c]) continue;
      const x = c % GW, y = (c / GW) | 0;
      const d0 = Math.abs(x - B0.x) + Math.abs(y - B0.y);
      const d1 = Math.abs(x - B1.x) + Math.abs(y - B1.y);
      if (d0 < 3 || d1 < 3) continue;
      // どちらかに極端に近い場所は避ける（なるべく公平に）
      if (tries < 30 && Math.abs(d0 - d1) > 6) continue;
      this.item[c] = 1;
      this.items.push(c);
      if (this.fx) this.fx.spawns.push(c);
      return;
    }
  }

  _updateBlocks() {
    const b = this.blk, g = this.grid;
    b.fill(0);
    for (let y = 0; y < GH; y++) {
      const by = (y >> 2) * 4;
      for (let x = 0; x < GW; x++) {
        const v = g[y * GW + x];
        if (v === 1 || v === 2) b[(v - 1) * 16 + by + (x >> 2)]++;
      }
    }
    this.blkDirty = false;
  }

  // 射線: (x,y) から向き d へ射程内に (tx,ty) があり、間にかべがないか
  _inLine(x, y, d, tx, ty) {
    const g = this.grid;
    for (let s = 1; s <= RULE.RANGE; s++) {
      x += DX[d]; y += DY[d];
      if (x < 0 || y < 0 || x >= GW || y >= GH) return false;
      if (g[y * GW + x] === WALL) return false;
      if (x === tx && y === ty) return true;
    }
    return false;
  }

  // i 番ロボの観察を out[o..o+OBS_N) に書く。
  // 赤ロボ(1)は盤面を180度回して「自分が左上スタート」に見えるようにする
  observe(i, out, o = 0) {
    const me = this.bots[i], en = this.bots[1 - i];
    const flip = i === 1;
    const sg = flip ? -1 : 1;
    const myC = i + 1, enC = 2 - i;
    const g = this.grid, item = this.item;
    let k = o;
    for (let dy = -VIEW_R; dy <= VIEW_R; dy++) {
      const ry = me.y + sg * dy;
      for (let dx = -VIEW_R; dx <= VIEW_R; dx++) {
        const rx = me.x + sg * dx;
        let own = 0, enm = 0, wall = 0, it = 0;
        if (rx < 0 || ry < 0 || rx >= GW || ry >= GH) wall = 1;
        else {
          const c = ry * GW + rx, v = g[c];
          if (v === WALL) wall = 1;
          else if (v === myC) own = 1;
          else if (v === enC) enm = 1;
          if (item[c]) it = 1;
        }
        out[k] = own; out[k + VIEW_N] = enm; out[k + 2 * VIEW_N] = wall; out[k + 3 * VIEW_N] = it;
        k++;
      }
    }
    k = o + VIEW_N * 4;
    const rot = flip ? 2 : 0;
    // 自分の向き
    const md = (me.dir + rot) & 3;
    out[k] = md === 0 ? 1 : 0; out[k + 1] = md === 1 ? 1 : 0; out[k + 2] = md === 2 ? 1 : 0; out[k + 3] = md === 3 ? 1 : 0;
    k += 4;
    out[k++] = me.cd / RULE.COOL;
    out[k++] = (me.cd === 0 && me.stun === 0) ? 1 : 0;
    out[k++] = me.stun / RULE.STUN;
    out[k++] = me.inv > 0 ? 1 : 0;
    // 相手の位置
    const rdx = sg * (en.x - me.x), rdy = sg * (en.y - me.y);
    out[k++] = rdx / 15; out[k++] = rdy / 15;
    out[k++] = (Math.abs(rdx) + Math.abs(rdy)) / 30;
    // 自分の射線に相手がいるか（向きごと）
    for (let cd = 0; cd < 4; cd++) {
      const d = (cd + rot) & 3;
      out[k++] = this._inLine(me.x, me.y, d, en.x, en.y) ? 1 : 0;
    }
    // 相手の射線に自分が入っているか
    out[k++] = this._inLine(en.x, en.y, en.dir, me.x, me.y) ? 1 : 0;
    out[k++] = (en.cd === 0 && en.stun === 0) ? 1 : 0;
    const ed = (en.dir + rot) & 3;
    out[k] = ed === 0 ? 1 : 0; out[k + 1] = ed === 1 ? 1 : 0; out[k + 2] = ed === 2 ? 1 : 0; out[k + 3] = ed === 3 ? 1 : 0;
    k += 4;
    out[k++] = en.stun / RULE.STUN;
    out[k++] = en.inv > 0 ? 1 : 0;
    // いちばん近いペンキ爆弾
    let best = 999, bx = 0, by = 0;
    for (let j = 0; j < this.items.length; j++) {
      const c = this.items[j];
      const x = c % GW, y = (c / GW) | 0;
      const d = Math.abs(x - me.x) + Math.abs(y - me.y);
      if (d < best) { best = d; bx = sg * (x - me.x); by = sg * (y - me.y); }
    }
    out[k++] = best < 999 ? bx / 15 : 0;
    out[k++] = best < 999 ? by / 15 : 0;
    out[k++] = best < 999 ? 1 : 0;
    // 全体の地図（4×4ブロックごとの自分・相手の割合）
    if (this.blkDirty) this._updateBlocks();
    const blk = this.blk;
    for (let b = 0; b < 16; b++) {
      const rb = flip ? 15 - b : b;
      out[k + b] = blk[(myC - 1) * 16 + rb] / 16;
      out[k + 16 + b] = blk[(enC - 1) * 16 + rb] / 16;
    }
    k += 32;
    out[k++] = (flip ? GW - 1 - me.x : me.x) / 15;
    out[k++] = (flip ? GH - 1 - me.y : me.y) / 15;
    out[k++] = (RULE.T - this.t) / RULE.T;
    out[k++] = this.cnt[myC] / this.floor;
    out[k++] = this.cnt[enC] / this.floor;
    return out;
  }

  // 状態のハッシュ（オンライン対戦で両端末の結果が一致したか確かめる）
  hash() {
    let h = 0x811c9dc5;
    const g = this.grid;
    for (let i = 0; i < GN; i++) { h ^= g[i]; h = Math.imul(h, 0x01000193); }
    for (const b of this.bots) {
      h ^= b.x * 31 + b.y * 7 + b.dir; h = Math.imul(h, 0x01000193);
      h ^= b.stun * 13 + b.cd; h = Math.imul(h, 0x01000193);
    }
    h ^= this.t; h = Math.imul(h, 0x01000193);
    return h >>> 0;
  }

  // 盤面のコピー（描画・リプレイ用）
  snapshot() {
    return {
      grid: this.grid.slice(), items: this.items.slice(), t: this.t,
      bots: this.bots.map(b => ({ x: b.x, y: b.y, dir: b.dir, stun: b.stun, inv: b.inv, cd: b.cd, px: b.px, py: b.py })),
      cnt: this.cnt.slice(),
    };
  }
}

// 実際の行動 ←→ 赤ロボの「自分目線」の行動
export function toRealAction(i, canonicalAction) {
  return i === 1 ? FLIP_ACT[canonicalAction] : canonicalAction;
}
