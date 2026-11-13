// 作業の世界（環境）。アーム・ブロック・置き場の状態と、1歩ごとのルール・ごほうびを決める。
// 行動は3つを同時に選ぶ: 肩（−1/0/+1）・ひじ（−1/0/+1）・グリッパー（0 開く / 1 にぎる）
import { L1, L2, A2_MAX, STEP, R_MIN, R_MAX, HOME_A1, HOME_A2, wrapPi, fk, ik, jointMove } from './arm.js';
import { makeRng } from './rng.js';

export const GRIP_R = 0.28;    // 手先からこの距離までのブロックをつかめる
export const GOAL_R = 0.42;    // 置き場の半径（ブロックの中心がこの中で放せば成功）
export const TOUCH_R = 0.22;   // 「ふれた」と見なす距離
export const T_A = 0, T_B = 1, T_DECOY = 2;   // ブロックの種類（だいだい / みどり / 赤いニセモノ）
export const SNAP = 22;        // 描画用スナップショットの長さ
export const SVEC = 35;        // 価値の見積もり役（クリティック）に渡す数値の数

// ごほうびの重み（強化学習）。画面の「ごほうび設計」で変えられる
export const DEFAULT_REWARD = { reach: 1, grasp: 1, carry: 1.5, deliver: 3, success: 5, time: 0.01, fail: 2 };

const _fk = [0, 0, 0, 0];
const _ik = [0, 0];

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  let t = ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}

export class Env {
  constructor(stage, seed = 1, reward = DEFAULT_REWARD) {
    this.stage = stage;
    this.rw = reward;
    this.rng = makeRng(seed);
    this.bx = [0, 0]; this.by = [0, 0]; this.bth = [0, 0]; this.btype = [0, 0]; this.bdone = [0, 0];
    this.gx = [0, 0]; this.gy = [0, 0];
    this.nb = 0; this.ng = 0; this.nTargets = 0;
    this.reset();
  }

  setSeed(seed) { this.rng = makeRng(seed); }

  reset() {
    const st = this.stage, rng = this.rng;
    this.t = 0; this.done = false; this.success = false; this.failed = false;
    this.grip = 0; this.held = -1; this.delivered = 0;
    this.event = '';
    if (st.randomStart) {
      this.a1 = rng.range(-Math.PI, Math.PI);
      this.a2 = rng.range(0.5, A2_MAX - 0.1) * (rng() < 0.5 ? -1 : 1);
    } else { this.a1 = HOME_A1; this.a2 = HOME_A2; }
    this._fk();
    this.nb = st.blocks + (st.decoy ? 1 : 0);
    this.ng = st.goals;
    this.nTargets = st.blocks;
    this.turn = st.turn ? st.turn * (rng() < 0.5 ? -1 : 1) : 0;
    const placed = [];
    const put = (rMin, rMax, armGap) => {
      let x = 0, y = 0;
      for (let k = 0; k < 300; k++) {
        const r = Math.sqrt(rng.range(rMin * rMin, rMax * rMax)), th = rng.range(-Math.PI, Math.PI);
        x = r * Math.cos(th); y = r * Math.sin(th);
        let ok = segDist(x, y, 0, 0, this.ex, this.ey) >= armGap && segDist(x, y, this.ex, this.ey, this.tx, this.ty) >= armGap + 0.08;
        for (let i = 0; ok && i < placed.length; i += 2) if (Math.hypot(x - placed[i], y - placed[i + 1]) < 0.88) ok = false;
        if (ok) break;
      }
      placed.push(x, y);
      return [x, y];
    };
    for (let i = 0; i < this.ng; i++) {
      const p = (st.fixedGoal && i === 0) ? (placed.push(st.fixedGoal[0], st.fixedGoal[1]), st.fixedGoal) : put(0.7, 1.68, 0.3);
      this.gx[i] = p[0]; this.gy[i] = p[1];
    }
    for (let i = 0; i < this.nb; i++) {
      const p = this.turn ? put(0.85, 1.6, 0.42) : put(0.62, 1.72, 0.42);
      this.bx[i] = p[0]; this.by[i] = p[1]; this.bth[i] = 0; this.bdone[i] = 0;
      this.btype[i] = (st.decoy && i === this.nb - 1) ? T_DECOY : i;
    }
    this._cam();
    return this;
  }

  _fk() {
    fk(this.a1, this.a2, _fk);
    this.ex = _fk[0]; this.ey = _fk[1]; this.tx = _fk[2]; this.ty = _fk[3];
  }

  // カメラのゆれ（「ゆれる目」の現場だけ）。単位は画素
  _cam() {
    const s = this.stage.shake || 0;
    if (s > 0) {
      this.camX = this.rng.range(-s, s); this.camY = this.rng.range(-s, s);
    } else { this.camX = 0; this.camY = 0; }
  }

  // いま取り組むブロック（つかんでいる本物、なければ まだ運んでいない最初の本物）
  active() {
    if (this.held >= 0 && this.btype[this.held] !== T_DECOY) return this.held;
    for (let i = 0; i < this.nb; i++) if (this.btype[i] !== T_DECOY && !this.bdone[i]) return i;
    return -1;
  }

  // ごほうびの「近づく」が指すブロック: つかんでいる本物、なければ いちばん近い まだ運んでいない本物
  nearestTarget() {
    if (this.held >= 0 && this.btype[this.held] !== T_DECOY) return this.held;
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.nb; i++) {
      if (this.btype[i] === T_DECOY || this.bdone[i]) continue;
      const d = Math.hypot(this.bx[i] - this.tx, this.by[i] - this.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  _nearestGraspable() {
    let best = -1, bd = GRIP_R;
    for (let i = 0; i < this.nb; i++) {
      if (this.bdone[i]) continue;
      const d = Math.hypot(this.bx[i] - this.tx, this.by[i] - this.ty);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  nearAnyGoal(x, y, r) {
    for (let i = 0; i < this.ng; i++) if (Math.hypot(x - this.gx[i], y - this.gy[i]) < r) return true;
    return false;
  }

  // 1歩進める。u1, u2 ∈ {-1, 0, 1}、g ∈ {0, 1}。戻り値はごほうび
  step(u1, u2, g) {
    if (this.done) return 0;
    const st = this.stage, rw = this.rw;
    let r = -rw.time;
    this.event = '';
    const act0 = this.nearestTarget();

    // ① グリッパー（見えていた姿勢のまま、開く／にぎる）
    if (g === 1 && this.grip === 0) {
      this.grip = 1;
      const k = this._nearestGraspable();
      if (k >= 0) {
        if (this.btype[k] !== T_DECOY) r += rw.grasp + (k === act0 ? rw.reach * Math.hypot(this.bx[k] - this.tx, this.by[k] - this.ty) : 0);
        this.held = k; this.bx[k] = this.tx; this.by[k] = this.ty; this.bth[k] = this.a1 + this.a2;
        this.event = 'grasp';
      } else this.event = 'miss';
    } else if (g === 0 && this.grip === 1) {
      this.grip = 0;
      if (this.held >= 0) {
        const k = this.held; this.held = -1; this.event = 'drop';
        if (this.btype[k] === T_DECOY) {
          if (this.nearAnyGoal(this.bx[k], this.by[k], GOAL_R)) { r -= rw.fail; this.done = true; this.failed = true; this.event = 'fail'; }
        } else if (st.task === 'place' && Math.hypot(this.bx[k] - this.gx[this.btype[k]], this.by[k] - this.gy[this.btype[k]]) < GOAL_R) {
          this.bdone[k] = 1; this.delivered++;
          if (this.delivered >= this.nTargets) { r += rw.success; this.done = true; this.success = true; this.event = 'success'; }
          else { r += rw.deliver; this.event = 'deliver'; }
        } else r -= rw.grasp;
      }
    }
    if (st.task === 'grasp' && this.held >= 0 && this.btype[this.held] !== T_DECOY && !this.done) {
      r += rw.success; this.done = true; this.success = true; this.event = 'success';
    }

    if (!this.done) {
      // ② 関節を動かす（つかんでいるブロックは手先についてくる）
      const act = this.nearestTarget();
      let dReach = -1, dCarry = -1;
      if (act >= 0) {
        if (this.held === act) { if (st.task === 'place') dCarry = Math.hypot(this.bx[act] - this.gx[this.btype[act]], this.by[act] - this.gy[this.btype[act]]); }
        else if (this.held < 0) dReach = Math.hypot(this.bx[act] - this.tx, this.by[act] - this.ty);
      }
      this.a1 = wrapPi(this.a1 + u1 * STEP);
      let a2 = this.a2 + u2 * STEP;
      if (a2 > A2_MAX) a2 = A2_MAX; else if (a2 < -A2_MAX) a2 = -A2_MAX;
      this.a2 = a2;
      this._fk();
      if (this.held >= 0) { const k = this.held; this.bx[k] = this.tx; this.by[k] = this.ty; this.bth[k] = this.a1 + this.a2; }
      // ③ 回る台
      if (this.turn) {
        const c = Math.cos(this.turn), s = Math.sin(this.turn);
        for (let i = 0; i < this.nb; i++) {
          if (i === this.held || this.bdone[i]) continue;
          const x = this.bx[i], y = this.by[i];
          this.bx[i] = x * c - y * s; this.by[i] = x * s + y * c; this.bth[i] += this.turn;
        }
      }
      // ④ 近づいた分・運んだ分のごほうび
      if (dCarry >= 0) r += rw.carry * (dCarry - Math.hypot(this.bx[act] - this.gx[this.btype[act]], this.by[act] - this.gy[this.btype[act]]));
      if (dReach >= 0) {
        const a2n = this.nearestTarget();     // 動いたあとで「いちばん近い」が入れ替わっても、距離はなめらかにつながる
        const d = Math.hypot(this.bx[a2n] - this.tx, this.by[a2n] - this.ty);
        r += rw.reach * (dReach - d);
        if (st.task === 'touch' && d < TOUCH_R) { r += rw.success; this.done = true; this.success = true; this.event = 'success'; }
      }
    }
    this.t++;
    if (!this.done && this.t >= st.maxSteps) { this.done = true; this.event = 'timeout'; }
    this._cam();
    return r;
  }

  // 描画用のスナップショット（3D表示と「AIの目」の両方がこれを使う）
  snapshot(out, off = 0) {
    out[off] = this.a1; out[off + 1] = this.a2; out[off + 2] = this.grip; out[off + 3] = this.held;
    out[off + 4] = this.nb; out[off + 5] = this.ng;
    for (let i = 0; i < 2; i++) {
      const o = off + 6 + i * 4;
      out[o] = this.bx[i]; out[o + 1] = this.by[i]; out[o + 2] = this.bth[i]; out[o + 3] = this.btype[i] + 4 * this.bdone[i];
      out[off + 14 + i * 2] = this.gx[i]; out[off + 15 + i * 2] = this.gy[i];
    }
    out[off + 18] = this.camX; out[off + 19] = this.camY; out[off + 20] = 1; out[off + 21] = this.t;
    return out;
  }

  // クリティック用の数値（位置などの「答え」を直接渡す。方策＝アクターは画像しか見ない）
  stateVec(out, off = 0) {
    const st = this.stage;
    out[off] = Math.cos(this.a1); out[off + 1] = Math.sin(this.a1);
    out[off + 2] = Math.cos(this.a1 + this.a2); out[off + 3] = Math.sin(this.a1 + this.a2);
    out[off + 4] = this.a2 / A2_MAX; out[off + 5] = this.tx / 2; out[off + 6] = this.ty / 2;
    out[off + 7] = this.grip; out[off + 8] = this.held >= 0 ? 1 : 0; out[off + 9] = 1 - this.t / st.maxSteps;
    for (let i = 0; i < 2; i++) {
      const o = off + 10 + i * 6, has = i < this.nb;
      out[o] = has ? this.bx[i] / 2 : 0; out[o + 1] = has ? this.by[i] / 2 : 0; out[o + 2] = has ? 1 : 0;
      out[o + 3] = has ? this.bdone[i] : 0; out[o + 4] = has && this.held === i ? 1 : 0; out[o + 5] = has && this.btype[i] === T_DECOY ? 1 : 0;
      const q = off + 22 + i * 3, hg = i < this.ng;
      out[q] = hg ? this.gx[i] / 2 : 0; out[q + 1] = hg ? this.gy[i] / 2 : 0; out[q + 2] = hg ? 1 : 0;
    }
    const act = this.nearestTarget();
    if (act >= 0) {
      out[off + 28] = (this.bx[act] - this.tx) / 2; out[off + 29] = (this.by[act] - this.ty) / 2;
      if (st.task === 'place') { const gi = this.btype[act]; out[off + 30] = (this.gx[gi] - this.bx[act]) / 2; out[off + 31] = (this.gy[gi] - this.by[act]) / 2; }
      else { out[off + 30] = 0; out[off + 31] = 0; }
      out[off + 32] = this.held === act ? 1 : 0;
    } else { out[off + 28] = 0; out[off + 29] = 0; out[off + 30] = 0; out[off + 31] = 0; out[off + 32] = 0; }
    out[off + 33] = this.turn * 20;
    out[off + 34] = this.nTargets ? this.delivered / this.nTargets : 0;
    return out;
  }
}

// 目標点へ向かう1歩（各関節を −/止/＋）。人の指の操作とお手本ロボの両方が使う。out = [u1, u2]
export function moveToward(env, x, y, out) {
  ik(x, y, env.a1, env.a2, _ik);
  out[0] = jointMove(env.a1, _ik[0], true);
  out[1] = jointMove(env.a2, _ik[1], false);
  return out;
}

// お手本ロボ（位置を直接知っている台本どおりの動き）。out = [u1, u2, g]
export function expertAction(env, out) {
  const st = env.stage;
  const act = env.active();
  out[0] = 0; out[1] = 0; out[2] = env.grip;
  if (act < 0) return out;
  if (env.held >= 0 && env.held !== act) {
    // ニセモノをつかんでいる: 置き場の外へ出てから放す
    if (env.nearAnyGoal(env.tx, env.ty, GOAL_R + 0.12)) {
      const a = Math.atan2(env.ty, env.tx) + 0.5, r = Math.min(1.5, Math.max(0.8, Math.hypot(env.tx, env.ty)));
      moveToward(env, r * Math.cos(a), r * Math.sin(a), out); out[2] = 1;
    } else out[2] = 0;
    return out;
  }
  if (env.held === act) {
    const gi = env.btype[act], gx = env.gx[gi], gy = env.gy[gi];
    moveToward(env, gx, gy, out);
    const d = Math.hypot(gx - env.tx, gy - env.ty);
    out[2] = 1;
    if (d < 0.14 || (out[0] === 0 && out[1] === 0 && d < GOAL_R * 0.85)) { out[0] = 0; out[1] = 0; out[2] = 0; }
    return out;
  }
  if (env.grip === 1 && st.task !== 'touch') { out[2] = 0; return out; }   // 空振りのまま → まず開く
  let px = env.bx[act], py = env.by[act];
  if (env.turn) {
    // 回る台: 着くまでの歩数ぶん先回りする
    let n = 0;
    for (let it = 0; it < 3; it++) {
      const c = Math.cos(env.turn * n), s = Math.sin(env.turn * n);
      px = env.bx[act] * c - env.by[act] * s; py = env.bx[act] * s + env.by[act] * c;
      ik(px, py, env.a1, env.a2, _ik);
      n = Math.max(Math.abs(wrapPi(_ik[0] - env.a1)), Math.abs(_ik[1] - env.a2)) / STEP;
    }
  }
  moveToward(env, px, py, out);
  if (st.task === 'touch') { out[2] = 0; return out; }
  const d = Math.hypot(env.bx[act] - env.tx, env.by[act] - env.ty);
  out[2] = 0;
  if (d < 0.13 || (out[0] === 0 && out[1] === 0 && d < GRIP_R * 0.85)) { out[0] = 0; out[1] = 0; out[2] = 1; }
  return out;
}
