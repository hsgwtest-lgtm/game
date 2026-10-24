// 物理エンジン（決定論的）
//
// ・骨 = 剛体（カプセル / 箱）。XPBD（位置ベースの拘束ソルバー, Müller ほか 2020）を小さな時間刻みで回す
//   1フレーム(1/60秒)を SUBSTEPS 回に分け、各回で「力 → 積分 → 関節 → 接触 → 速度の更新」を1回ずつ
// ・関節 = 位置をつなぐ拘束 ＋ 3軸の可動域（オイラー角を範囲に収める回転の拘束）
// ・筋肉 = Hill 型モデル。出せる力は「活性度 × 長さの特性 × 速さの特性 ＋ のびたときの弾性」
//   通り道（起始 → 滑車 → 停止）に沿って骨を引っぱる。押すことはできない
// ・地面との接触 = めりこみを押し戻し、摩擦（クーロン）で横すべりを止める
// ・水 = 浮力と、骨の向きで違う抵抗（横向きに強く、縦向きに弱い → くねらせると前に進む）
// 使う関数は四則演算と sqrt と dmath だけ → どの端末でも同じ結果

import { dexp, datan2, dasin, dsin, dcos } from './dmath.js';

export const FPS = 60;
export const DT = 1 / FPS;
export const SUBSTEPS = 10;
export const GRAVITY = 9.81;

const MAX_W = 60;      // 角速度の上限（rad/s）
const MAX_V = 40;      // 速度の上限（m/s）

// 作業用（物体ひとつ分の一時変数）
const T = new Float64Array(16);

export class Creature {
  constructor(model, opts = {}) {
    this.model = model;
    const n = this.n = model.n;
    const B = model.bodies;
    this.pos = new Float64Array(3 * n);
    this.q = new Float64Array(4 * n);
    this.v = new Float64Array(3 * n);
    this.w = new Float64Array(3 * n);
    this.pp = new Float64Array(3 * n);
    this.pq = new Float64Array(4 * n);
    this.f = new Float64Array(3 * n);
    this.t = new Float64Array(3 * n);
    this.invM = new Float64Array(n);
    this.invI = new Float64Array(3 * n);
    this.contact = new Uint8Array(n);       // このフレームで地面に触れたか
    this.contactF = new Float64Array(n);    // 押し返しの強さ（N）
    this.mass = new Float64Array(n);
    // 慣性の整え: 細い骨の「長さ方向のまわり」の慣性は極端に小さく、拘束を解くときに暴れやすい。
    // ほかの軸の一定割合までかさ上げして安定させる（見た目の動きにはほとんど影響しない）
    const IR = opts.inertiaRatio !== undefined ? opts.inertiaRatio : 0.5;
    for (let i = 0; i < n; i++) {
      this.invM[i] = 1 / B[i].mass;
      this.mass[i] = B[i].mass;
      const I = B[i].I.slice();
      const Imax = Math.max(I[0], I[1], I[2]);
      for (let a = 0; a < 3; a++) if (I[a] < IR * Imax) I[a] = IR * Imax;
      this.invI[3 * i] = 1 / I[0]; this.invI[3 * i + 1] = 1 / I[1]; this.invI[3 * i + 2] = 1 / I[2];
    }
    // 接触の点
    let nf = 0;
    for (const b of B) nf += b.feat.length;
    this.featStart = new Int32Array(n + 1);
    this.feat = new Float64Array(4 * nf);
    let k = 0;
    for (let i = 0; i < n; i++) {
      this.featStart[i] = k;
      for (const f of B[i].feat) { this.feat.set(f, 4 * k); k++; }
    }
    this.featStart[n] = k;
    this.capR = Float64Array.from(B.map(b => b.capR));
    this.capH = Float64Array.from(B.map(b => b.capH));
    this.bound = Float64Array.from(B.map(b => b.bound));
    // 関節
    const J = model.joints, nj = this.nj = J.length;
    this.jP = Int32Array.from(J.map(j => j.parent));
    this.jC = Int32Array.from(J.map(j => j.child));
    this.jrP = new Float64Array(3 * nj); this.jrC = new Float64Array(3 * nj);
    this.jqP = new Float64Array(4 * nj); this.jqC = new Float64Array(4 * nj);
    this.jlim = new Float64Array(6 * nj);
    this.jdamp = new Float64Array(nj);
    J.forEach((j, i) => {
      this.jrP.set(j.rP, 3 * i); this.jrC.set(j.rC, 3 * i);
      this.jqP.set(j.qJP, 4 * i); this.jqC.set(j.qJC, 4 * i);
      for (let a = 0; a < 3; a++) { this.jlim[6 * i + 2 * a] = j.limRad[a][0]; this.jlim[6 * i + 2 * a + 1] = j.limRad[a][1]; }
      this.jdamp[i] = 4 * (j.damp || 1);
    });
    this.jang = new Float64Array(3 * nj);   // 関節角（毎フレーム更新）
    this.jvel = new Float64Array(3 * nj);   // 関節の角速度
    // 筋肉
    const Ms = model.muscles, nm = this.nm = Ms.length;
    this.mStart = new Int32Array(nm + 1);
    let np = 0;
    for (const m of Ms) np += m.pts.length;
    this.mBody = new Int32Array(np);
    this.mLocal = new Float64Array(3 * np);
    k = 0;
    Ms.forEach((m, i) => {
      this.mStart[i] = k;
      for (const pt of m.pts) { this.mBody[k] = pt.body; this.mLocal.set(pt.local, 3 * k); k++; }
    });
    this.mStart[nm] = k;
    this.mFmax = Float64Array.from(Ms.map(m => m.fmax));
    this.mLfib = Float64Array.from(Ms.map(m => m.lfib));
    this.mLten = Float64Array.from(Ms.map(m => m.lten));
    this.mVmax = Float64Array.from(Ms.map(m => m.vmax));
    this.act = new Float64Array(nm);    // 活性度 0..1（神経が決める）
    this.mLen = new Float64Array(nm);   // 通り道の長さ
    this.mVel = new Float64Array(nm);   // のびる速さ
    this.mForce = new Float64Array(nm); // 張力（N）
    this.mFL = new Float64Array(nm);    // 長さの特性 0..1
    this.mFV = new Float64Array(nm);    // 速さの特性 0..1.5
    this.mPass = new Float64Array(nm);  // 弾性と粘り（最大張力に対する割合）
    this.spinal = null;                 // (creature, h) → 活性度を決める（脊髄）。サブステップごとに呼ばれる
    this.mPt = new Float64Array(3 * np); // 通り道の点（世界座標、描画用）
    this.selfPairs = Int32Array.from(model.pairs.flat());
    this.selfCollide = opts.selfCollide !== false;
    this.muFric = opts.friction || 0.9;
    this.alive = true;
    this.place(opts.x || 0, opts.z || 0, opts.heading || 0, opts.y);
  }

  // 設計時の姿勢で、指定の場所に置く（heading = 上から見た向き, rad）
  place(x0, z0, heading = 0, yAbs = undefined, groundY = 0) {
    const B = this.model.bodies;
    const qh = heading === 0 ? [1, 0, 0, 0] : [dcos(heading / 2), 0, dsin(heading / 2), 0];
    const yOff = yAbs !== undefined ? yAbs : groundY - this.model.minY + 0.003;
    for (let i = 0; i < this.n; i++) {
      const c = B[i].c, q0 = B[i].q0;
      // 回転（Y軸まわり）
      let px = c[0], pz = c[2];
      if (heading !== 0) {
        const cs = qh[0] * qh[0] - qh[2] * qh[2], sn = 2 * qh[0] * qh[2];
        const rx = cs * px + sn * pz, rz = -sn * px + cs * pz;
        px = rx; pz = rz;
      }
      this.pos[3 * i] = px + x0; this.pos[3 * i + 1] = c[1] + yOff; this.pos[3 * i + 2] = pz + z0;
      const qq = qmulArr(qh, q0);
      this.q.set(qq, 4 * i);
      this.v.fill(0, 3 * i, 3 * i + 3); this.w.fill(0, 3 * i, 3 * i + 3);
    }
    this.pp.set(this.pos); this.pq.set(this.q);
  }

  // ── 筋肉: 通り道の長さ・速さと、長さ・速さの特性（力を出す前の準備）──
  muscleKinematics() {
    const { pos, q, v, w, mStart, mBody, mLocal, mPt } = this;
    for (let m = 0; m < this.nm; m++) {
      const s0 = mStart[m], s1 = mStart[m + 1];
      let L = 0, dLdt = 0;
      let px = 0, py = 0, pz = 0, vx = 0, vy = 0, vz = 0;
      for (let k = s0; k < s1; k++) {
        const b = mBody[k];
        rotInto(q, 4 * b, mLocal[3 * k], mLocal[3 * k + 1], mLocal[3 * k + 2], T, 0);
        const rx = T[0], ry = T[1], rz = T[2];
        const x = pos[3 * b] + rx, y = pos[3 * b + 1] + ry, z = pos[3 * b + 2] + rz;
        const wx = w[3 * b], wy = w[3 * b + 1], wz = w[3 * b + 2];
        const ux = v[3 * b] + wy * rz - wz * ry, uy = v[3 * b + 1] + wz * rx - wx * rz, uz = v[3 * b + 2] + wx * ry - wy * rx;
        mPt[3 * k] = x; mPt[3 * k + 1] = y; mPt[3 * k + 2] = z;
        if (k > s0) {
          const dx = x - px, dy = y - py, dz = z - pz;
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-12;
          L += l;
          dLdt += ((ux - vx) * dx + (uy - vy) * dy + (uz - vz) * dz) / l;
        }
        px = x; py = y; pz = z; vx = ux; vy = uy; vz = uz;
      }
      this.mLen[m] = L; this.mVel[m] = dLdt;
      const lt = (L - this.mLten[m]) / this.mLfib[m];
      const vt = dLdt / this.mVmax[m];
      const e = (lt - 1) / 0.56;
      this.mFL[m] = dexp(-e * e);
      this.mFV[m] = vt < 0 ? (vt <= -1 ? 0 : (1 + vt) / (1 - vt * 4)) : 1.5 - 0.5 / (1 + 6 * vt);
      // のびすぎたときの弾性（可動域の外でだけ効く）＋ わずかな粘り
      let fP = 0;
      if (lt > 1.55) { const d = lt - 1.55; fP = 4 * d * d; if (fP > 2) fP = 2; }
      this.mPass[m] = fP + 0.04 * (vt > 1 ? 1 : vt < -1 ? -1 : vt);
    }
  }

  // ── 筋肉: 活性度に応じた張力を、通り道に沿って骨にかける ──
  muscleApply() {
    const { pos, f, t, mStart, mBody, mPt, act } = this;
    for (let m = 0; m < this.nm; m++) {
      let F = this.mFmax[m] * (act[m] * this.mFL[m] * this.mFV[m] + this.mPass[m]);
      if (F < 0) F = 0;
      this.mForce[m] = F;
      if (F === 0) continue;
      const s0 = mStart[m], s1 = mStart[m + 1];
      for (let k = s0; k < s1 - 1; k++) {
        const dx = mPt[3 * k + 3] - mPt[3 * k], dy = mPt[3 * k + 4] - mPt[3 * k + 1], dz = mPt[3 * k + 5] - mPt[3 * k + 2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-12;
        const Fx = F * dx / l, Fy = F * dy / l, Fz = F * dz / l;
        const a = mBody[k], b = mBody[k + 1];
        if (a === b) continue;
        addForce(pos, f, t, a, mPt[3 * k], mPt[3 * k + 1], mPt[3 * k + 2], Fx, Fy, Fz);
        addForce(pos, f, t, b, mPt[3 * k + 3], mPt[3 * k + 4], mPt[3 * k + 5], -Fx, -Fy, -Fz);
      }
    }
  }

  // 関節角（オイラー角 X→Y→Z）と角速度を計算する（神経の入力）
  measureJoints() {
    const { q, w, jqP, jqC, jang, jvel } = this;
    for (let j = 0; j < this.nj; j++) {
      const P = this.jP[j], C = this.jC[j];
      qmulInto(q, 4 * P, jqP, 4 * j, T, 0);       // FP
      qmulInto(q, 4 * C, jqC, 4 * j, T, 4);       // FC
      // qrel = conj(FP) * FC
      const aw = T[0], ax = -T[1], ay = -T[2], az = -T[3];
      const bw = T[4], bx = T[5], by = T[6], bz = T[7];
      const rw = aw * bw - ax * bx - ay * by - az * bz;
      const rx = aw * bx + ax * bw + ay * bz - az * by;
      const ry = aw * by - ax * bz + ay * bw + az * bx;
      const rz = aw * bz + ax * by - ay * bx + az * bw;
      eulerXYZ(rw, rx, ry, rz, jang, 3 * j);
      // 角速度（親の関節座標で見た相対角速度）
      const dwx = w[3 * C] - w[3 * P], dwy = w[3 * C + 1] - w[3 * P + 1], dwz = w[3 * C + 2] - w[3 * P + 2];
      // FP の軸に射影（近似: 小さな角度ではオイラー角の速度にほぼ等しい）
      invRotInto(T, 0, dwx, dwy, dwz, T, 8);
      jvel[3 * j] = T[8]; jvel[3 * j + 1] = T[9]; jvel[3 * j + 2] = T[10];
    }
  }
}

// ── 世界（地形・水・生き物たち）──
export class World {
  constructor(terrain, opts = {}) {
    this.terrain = terrain;
    this.water = opts.water || null;          // { level(x,z) → 水面の高さ, current:[x,y,z] }
    this.g = opts.gravity !== undefined ? opts.gravity : GRAVITY;
    this.creatures = [];
    this.substeps = opts.substeps || SUBSTEPS;
    this.time = 0;
    this.frame = 0;
    this.extForces = null;   // (creature, h) → 補助の力など
    this._n = new Float64Array(3);
  }
  add(c) { this.creatures.push(c); return c; }

  step() {
    const h = DT / this.substeps;
    for (const c of this.creatures) { c.contact.fill(0); c.contactF.fill(0); }
    for (let s = 0; s < this.substeps; s++) this.substep(h);
    const inv = 1 / this.substeps;
    for (const c of this.creatures) {
      for (let i = 0; i < c.n; i++) c.contactF[i] *= inv;
      c.measureJoints();
    }
    this.time += DT;
    this.frame++;
  }

  substep(h) {
    const g = this.g;
    for (const c of this.creatures) {
      c.f.fill(0); c.t.fill(0);
      c.muscleKinematics();
      if (c.spinal) { c.measureJoints(); c.spinal(c, h); }
      c.muscleApply();
      if (this.water) waterForces(c, this.water);
      if (this.extForces) this.extForces(c, h);
      integrate(c, h, g);
    }
    // 関節と地面を2回くり返して解く（1回だと細い骨の鎖がふるえやすい）
    for (let it = 0; it < 2; it++) {
      for (const c of this.creatures) solveJoints(c);
      for (const c of this.creatures) solveGround(c, this.terrain, h, this._n);
    }
    for (const c of this.creatures) if (c.selfCollide) solveSelf(c);
    if (this.creatures.length > 1) {
      for (let a = 0; a < this.creatures.length; a++) for (let b = a + 1; b < this.creatures.length; b++) solveBetween(this.creatures[a], this.creatures[b]);
    }
    for (const c of this.creatures) { updateVel(c, h); jointDamping(c, h); }
  }
}

// ─────────────────────────────────────────────────────────────
// 低レベルの計算（インライン展開しやすい小さな関数）
// ─────────────────────────────────────────────────────────────

// q(off) で (x,y,z) を回す → out[o..o+2]
function rotInto(q, off, x, y, z, out, o) {
  const w = q[off], qx = q[off + 1], qy = q[off + 2], qz = q[off + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[o] = x + w * tx + (qy * tz - qz * ty);
  out[o + 1] = y + w * ty + (qz * tx - qx * tz);
  out[o + 2] = z + w * tz + (qx * ty - qy * tx);
}
function invRotInto(q, off, x, y, z, out, o) {
  const w = q[off], qx = -q[off + 1], qy = -q[off + 2], qz = -q[off + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[o] = x + w * tx + (qy * tz - qz * ty);
  out[o + 1] = y + w * ty + (qz * tx - qx * tz);
  out[o + 2] = z + w * tz + (qx * ty - qy * tx);
}
function qmulInto(a, ao, b, bo, out, o) {
  const aw = a[ao], ax = a[ao + 1], ay = a[ao + 2], az = a[ao + 3];
  const bw = b[bo], bx = b[bo + 1], by = b[bo + 2], bz = b[bo + 3];
  out[o] = aw * bw - ax * bx - ay * by - az * bz;
  out[o + 1] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 2] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 3] = aw * bz + ax * by - ay * bx + az * bw;
}
export function qmulArr(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

// 単位クォータニオン → オイラー角（内因性 X→Y→Z）: R = Rx(α) Ry(β) Rz(γ)
function eulerXYZ(w, x, y, z, out, o) {
  const m02 = 2 * (x * z + w * y);
  const m12 = 2 * (y * z - w * x);
  const m22 = 1 - 2 * (x * x + y * y);
  const m01 = 2 * (x * y - w * z);
  const m00 = 1 - 2 * (y * y + z * z);
  const s = m02 > 1 ? 1 : m02 < -1 ? -1 : m02;
  out[o + 1] = dasin(s);
  out[o] = datan2(-m12, m22);
  out[o + 2] = datan2(-m01, m00);
}
function eulerToQuat(a, b, c, out, o) {
  const ca = dcos(a / 2), sa = dsin(a / 2), cb = dcos(b / 2), sb = dsin(b / 2), cc = dcos(c / 2), sc = dsin(c / 2);
  // qx(a) * qy(b)
  const w1 = ca * cb, x1 = sa * cb, y1 = ca * sb, z1 = sa * sb;
  // * qz(c)
  out[o] = w1 * cc - z1 * sc;
  out[o + 1] = x1 * cc + y1 * sc;
  out[o + 2] = y1 * cc - x1 * sc;
  out[o + 3] = z1 * cc + w1 * sc;
}

// 世界座標の逆慣性 × ベクトル → out
function invIw(c, i, x, y, z, out, o) {
  invRotInto(c.q, 4 * i, x, y, z, out, o);
  out[o] *= c.invI[3 * i]; out[o + 1] *= c.invI[3 * i + 1]; out[o + 2] *= c.invI[3 * i + 2];
  rotInto(c.q, 4 * i, out[o], out[o + 1], out[o + 2], out, o);
}

function addForce(pos, f, t, b, x, y, z, Fx, Fy, Fz) {
  f[3 * b] += Fx; f[3 * b + 1] += Fy; f[3 * b + 2] += Fz;
  const rx = x - pos[3 * b], ry = y - pos[3 * b + 1], rz = z - pos[3 * b + 2];
  t[3 * b] += ry * Fz - rz * Fy; t[3 * b + 1] += rz * Fx - rx * Fz; t[3 * b + 2] += rx * Fy - ry * Fx;
}
export function addForceAt(c, b, x, y, z, Fx, Fy, Fz) { addForce(c.pos, c.f, c.t, b, x, y, z, Fx, Fy, Fz); }

// 小さな回転ベクトル φ を q に加える: q ← normalize(q + 0.5 [φ,0] q)
function addRot(q, o, fx, fy, fz) {
  const w = q[o], x = q[o + 1], y = q[o + 2], z = q[o + 3];
  const nw = w + 0.5 * (-fx * x - fy * y - fz * z);
  const nx = x + 0.5 * (fx * w + fy * z - fz * y);
  const ny = y + 0.5 * (fy * w + fz * x - fx * z);
  const nz = z + 0.5 * (fz * w + fx * y - fy * x);
  const l = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
  q[o] = nw * l; q[o + 1] = nx * l; q[o + 2] = ny * l; q[o + 3] = nz * l;
}

function integrate(c, h, g) {
  const { pos, q, v, w, pp, pq, f, t, invM, invI } = c;
  for (let i = 0; i < c.n; i++) {
    const i3 = 3 * i, i4 = 4 * i;
    v[i3] += h * f[i3] * invM[i];
    v[i3 + 1] += h * (f[i3 + 1] * invM[i] - g);
    v[i3 + 2] += h * f[i3 + 2] * invM[i];
    // 角速度（ローカル座標でジャイロ項込み）
    invRotInto(q, i4, w[i3], w[i3 + 1], w[i3 + 2], T, 0);
    invRotInto(q, i4, t[i3], t[i3 + 1], t[i3 + 2], T, 3);
    const Ix = 1 / invI[i3], Iy = 1 / invI[i3 + 1], Iz = 1 / invI[i3 + 2];
    const wx = T[0], wy = T[1], wz = T[2];
    const Lx = Ix * wx, Ly = Iy * wy, Lz = Iz * wz;
    const gx = wy * Lz - wz * Ly, gy = wz * Lx - wx * Lz, gz = wx * Ly - wy * Lx;
    T[0] = wx + h * invI[i3] * (T[3] - gx);
    T[1] = wy + h * invI[i3 + 1] * (T[4] - gy);
    T[2] = wz + h * invI[i3 + 2] * (T[5] - gz);
    rotInto(q, i4, T[0], T[1], T[2], w, i3);
    // 暴れすぎ防止
    let ww = w[i3] * w[i3] + w[i3 + 1] * w[i3 + 1] + w[i3 + 2] * w[i3 + 2];
    if (ww > MAX_W * MAX_W) { const s = MAX_W / Math.sqrt(ww); w[i3] *= s; w[i3 + 1] *= s; w[i3 + 2] *= s; }
    let vv = v[i3] * v[i3] + v[i3 + 1] * v[i3 + 1] + v[i3 + 2] * v[i3 + 2];
    if (vv > MAX_V * MAX_V) { const s = MAX_V / Math.sqrt(vv); v[i3] *= s; v[i3 + 1] *= s; v[i3 + 2] *= s; }
    pp[i3] = pos[i3]; pp[i3 + 1] = pos[i3 + 1]; pp[i3 + 2] = pos[i3 + 2];
    pq[i4] = q[i4]; pq[i4 + 1] = q[i4 + 1]; pq[i4 + 2] = q[i4 + 2]; pq[i4 + 3] = q[i4 + 3];
    pos[i3] += h * v[i3]; pos[i3 + 1] += h * v[i3 + 1]; pos[i3 + 2] += h * v[i3 + 2];
    addRot(q, i4, h * w[i3], h * w[i3 + 1], h * w[i3 + 2]);
  }
}

// 2つの物体の点を n 方向に c だけ近づける（A の点を +c n 動かす）。B = -1 は動かない地面
// 戻り値: 押した量（λ）
function applyPos(cA, A, rAx, rAy, rAz, cB, B, rBx, rBy, rBz, nx, ny, nz, cc) {
  // rA × n
  const ax = rAy * nz - rAz * ny, ay = rAz * nx - rAx * nz, az = rAx * ny - rAy * nx;
  invIw(cA, A, ax, ay, az, T, 0);
  let wsum = cA.invM[A] + ax * T[0] + ay * T[1] + az * T[2];
  let bx = 0, by = 0, bz = 0;
  if (B >= 0) {
    bx = rBy * nz - rBz * ny; by = rBz * nx - rBx * nz; bz = rBx * ny - rBy * nx;
    invIw(cB, B, bx, by, bz, T, 3);
    wsum += cB.invM[B] + bx * T[3] + by * T[4] + bz * T[5];
  }
  const dl = cc / wsum;
  const pA = cA.pos;
  pA[3 * A] += nx * dl * cA.invM[A]; pA[3 * A + 1] += ny * dl * cA.invM[A]; pA[3 * A + 2] += nz * dl * cA.invM[A];
  addRot(cA.q, 4 * A, T[0] * dl, T[1] * dl, T[2] * dl);
  if (B >= 0) {
    const pB = cB.pos;
    pB[3 * B] -= nx * dl * cB.invM[B]; pB[3 * B + 1] -= ny * dl * cB.invM[B]; pB[3 * B + 2] -= nz * dl * cB.invM[B];
    addRot(cB.q, 4 * B, -T[3] * dl, -T[4] * dl, -T[5] * dl);
  }
  return dl;
}

// A を B に対して回転ベクトル (ex,ey,ez) だけ回す
function applyRot(c, A, B, ex, ey, ez) {
  const th = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (th < 1e-12) return;
  const nx = ex / th, ny = ey / th, nz = ez / th;
  invIw(c, A, nx, ny, nz, T, 0);
  invIw(c, B, nx, ny, nz, T, 3);
  const wA = nx * T[0] + ny * T[1] + nz * T[2];
  const wB = nx * T[3] + ny * T[4] + nz * T[5];
  const dl = th / (wA + wB);
  addRot(c.q, 4 * A, T[0] * dl, T[1] * dl, T[2] * dl);
  addRot(c.q, 4 * B, -T[3] * dl, -T[4] * dl, -T[5] * dl);
}

const JT = new Float64Array(24);
function solveJoints(c) {
  const { pos, q, jrP, jrC, jqP, jqC, jlim } = c;
  for (let j = 0; j < c.nj; j++) {
    const P = c.jP[j], C = c.jC[j];
    // 可動域（回転を先に、つなぎ目の位置をあとに合わせる）
    qmulInto(q, 4 * P, jqP, 4 * j, JT, 8);    // FP
    qmulInto(q, 4 * C, jqC, 4 * j, JT, 12);   // FC
    const aw = JT[8], ax = -JT[9], ay = -JT[10], az = -JT[11];
    const bw = JT[12], bx = JT[13], by = JT[14], bz = JT[15];
    const rw = aw * bw - ax * bx - ay * by - az * bz;
    const rx = aw * bx + ax * bw + ay * bz - az * by;
    const ry = aw * by - ax * bz + ay * bw + az * bx;
    const rz = aw * bz + ax * by - ay * bx + az * bw;
    eulerXYZ(rw, rx, ry, rz, JT, 16);
    const l = 6 * j;
    let a0 = JT[16], a1 = JT[17], a2 = JT[18], ch = false;
    if (a0 < jlim[l]) { a0 = jlim[l]; ch = true; } else if (a0 > jlim[l + 1]) { a0 = jlim[l + 1]; ch = true; }
    if (a1 < jlim[l + 2]) { a1 = jlim[l + 2]; ch = true; } else if (a1 > jlim[l + 3]) { a1 = jlim[l + 3]; ch = true; }
    if (a2 < jlim[l + 4]) { a2 = jlim[l + 4]; ch = true; } else if (a2 > jlim[l + 5]) { a2 = jlim[l + 5]; ch = true; }
    if (ch) {
    eulerToQuat(a0, a1, a2, JT, 19);
    // 目標の子の関節座標 FC' = FP * qt
    const tw = JT[8] * JT[19] - JT[9] * JT[20] - JT[10] * JT[21] - JT[11] * JT[22];
    const tx = JT[8] * JT[20] + JT[9] * JT[19] + JT[10] * JT[22] - JT[11] * JT[21];
    const ty = JT[8] * JT[21] - JT[9] * JT[22] + JT[10] * JT[19] + JT[11] * JT[20];
    const tz = JT[8] * JT[22] + JT[9] * JT[21] - JT[10] * JT[20] + JT[11] * JT[19];
    // Δ = FC' * conj(FC)
    let ew = tw * bw + tx * bx + ty * by + tz * bz;
    let ex = -tw * bx + tx * bw - ty * bz + tz * by;
    let ey = -tw * by + tx * bz + ty * bw - tz * bx;
    let ez = -tw * bz - tx * by + ty * bx + tz * bw;
    if (ew < 0) { ew = -ew; ex = -ex; ey = -ey; ez = -ez; }
    const s = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (s > 1e-12) {
      const ang = 2 * datan2(s, ew);
      applyRot(c, C, P, ex / s * ang, ey / s * ang, ez / s * ang);
    }
    }
    // 位置（つなぎ目）
    rotInto(q, 4 * P, jrP[3 * j], jrP[3 * j + 1], jrP[3 * j + 2], JT, 0);
    rotInto(q, 4 * C, jrC[3 * j], jrC[3 * j + 1], jrC[3 * j + 2], JT, 3);
    const dx = pos[3 * P] + JT[0] - pos[3 * C] - JT[3];
    const dy = pos[3 * P + 1] + JT[1] - pos[3 * C + 1] - JT[4];
    const dz = pos[3 * P + 2] + JT[2] - pos[3 * C + 2] - JT[5];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 1e-10) applyPos(c, C, JT[3], JT[4], JT[5], c, P, JT[0], JT[1], JT[2], dx / d, dy / d, dz / d, d);
  }
}

// 地面との接触（めりこみを戻す＋摩擦）
function solveGround(c, terrain, h, nrm) {
  const { pos, q, pp, pq, feat, featStart } = c;
  const mu = c.muFric * (terrain.friction || 1);
  for (let i = 0; i < c.n; i++) {
    for (let k = featStart[i]; k < featStart[i + 1]; k++) {
      const fx = feat[4 * k], fy = feat[4 * k + 1], fz = feat[4 * k + 2], r = feat[4 * k + 3];
      rotInto(q, 4 * i, fx, fy, fz, T, 6);
      const cx = pos[3 * i] + T[6], cy = pos[3 * i + 1] + T[7], cz = pos[3 * i + 2] + T[8];
      const gh = terrain.h(cx, cz);
      if (cy - r - gh > 0.02) continue;
      terrain.n(cx, cz, nrm);
      const nx = nrm[0], ny = nrm[1], nz = nrm[2];
      const dist = (cy - gh) * ny - r;
      if (dist >= 0) continue;
      // 接触点（物体の重心から）
      const rx = T[6] - nx * r, ry = T[7] - ny * r, rz = T[8] - nz * r;
      const ln = applyPos(c, i, rx, ry, rz, null, -1, 0, 0, 0, nx, ny, nz, -dist);
      c.contact[i] = 1;
      c.contactF[i] += ln / (h * h);
      // 摩擦: このサブステップでの接触点の横すべりを戻す
      // （接触点の代わりに球の中心の動きで横すべりを測る）
      rotInto(q, 4 * i, fx, fy, fz, T, 9);
      rotInto(pq, 4 * i, fx, fy, fz, T, 12);
      const dxp = (pos[3 * i] + T[9]) - (pp[3 * i] + T[12]);
      const dyp = (pos[3 * i + 1] + T[10]) - (pp[3 * i + 1] + T[13]);
      const dzp = (pos[3 * i + 2] + T[11]) - (pp[3 * i + 2] + T[14]);
      const dn = dxp * nx + dyp * ny + dzp * nz;
      const tx = dxp - dn * nx, ty = dyp - dn * ny, tz = dzp - dn * nz;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl < 1e-10) continue;
      const ux = tx / tl, uy = ty / tl, uz = tz / tl;
      const crx = T[9] - nx * r, cry = T[10] - ny * r, crz = T[11] - nz * r;
      // 必要な力積と上限
      const ax = cry * uz - crz * uy, ay = crz * ux - crx * uz, az = crx * uy - cry * ux;
      invIw(c, i, ax, ay, az, T, 0);
      const wt = c.invM[i] + ax * T[0] + ay * T[1] + az * T[2];
      const lt = tl / wt;
      const corr = lt <= mu * ln ? tl : tl * (mu * ln / lt);
      applyPos(c, i, crx, cry, crz, null, -1, 0, 0, 0, -ux, -uy, -uz, corr);
    }
  }
}

// 線分どうしの最近点（パラメータ s,t を T[0],T[1] に）
function closestSeg(p1x, p1y, p1z, d1x, d1y, d1z, p2x, p2y, p2z, d2x, d2y, d2z) {
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = f / e; t = t < 0 ? 0 : t > 1 ? 1 : t; }
  else {
    const cc = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-12) { t = 0; s = -cc / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den > 1e-12 ? (b * f - cc * e) / den : 0;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = -cc / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
      else if (t > 1) { t = 1; s = (b - cc) / a; s = s < 0 ? 0 : s > 1 ? 1 : s; }
    }
  }
  T[0] = s; T[1] = t;
}

const CT = new Float64Array(12);
function collideCaps(cA, A, cB, B) {
  const pa = cA.pos, pb = cB.pos;
  const dx0 = pa[3 * A] - pb[3 * B], dy0 = pa[3 * A + 1] - pb[3 * B + 1], dz0 = pa[3 * A + 2] - pb[3 * B + 2];
  const R = cA.bound[A] + cB.bound[B];
  if (dx0 * dx0 + dy0 * dy0 + dz0 * dz0 > R * R) return;
  rotInto(cA.q, 4 * A, 0, cA.capH[A], 0, CT, 0);
  rotInto(cB.q, 4 * B, 0, cB.capH[B], 0, CT, 3);
  const p1x = pa[3 * A] - CT[0], p1y = pa[3 * A + 1] - CT[1], p1z = pa[3 * A + 2] - CT[2];
  const p2x = pb[3 * B] - CT[3], p2y = pb[3 * B + 1] - CT[4], p2z = pb[3 * B + 2] - CT[5];
  const d1x = 2 * CT[0], d1y = 2 * CT[1], d1z = 2 * CT[2], d2x = 2 * CT[3], d2y = 2 * CT[4], d2z = 2 * CT[5];
  closestSeg(p1x, p1y, p1z, d1x, d1y, d1z, p2x, p2y, p2z, d2x, d2y, d2z);
  const s = T[0], t = T[1];
  const ax = p1x + d1x * s, ay = p1y + d1y * s, az = p1z + d1z * s;
  const bx = p2x + d2x * t, by = p2y + d2y * t, bz = p2z + d2z * t;
  let nx = ax - bx, ny = ay - by, nz = az - bz;
  const d = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const pen = cA.capR[A] + cB.capR[B] - d;
  if (pen <= 0) return;
  if (d < 1e-9) { nx = 0; ny = 1; nz = 0; } else { nx /= d; ny /= d; nz /= d; }
  const rA = cA.capR[A], rB = cB.capR[B];
  applyPos(cA, A, ax - nx * rA - pa[3 * A], ay - ny * rA - pa[3 * A + 1], az - nz * rA - pa[3 * A + 2],
    cB, B, bx + nx * rB - pb[3 * B], by + ny * rB - pb[3 * B + 1], bz + nz * rB - pb[3 * B + 2], nx, ny, nz, pen);
  return 1;
}
function solveSelf(c) {
  const P = c.selfPairs;
  for (let k = 0; k < P.length; k += 2) collideCaps(c, P[k], c, P[k + 1]);
}
function solveBetween(a, b) {
  let hit = 0;
  for (let i = 0; i < a.n; i++) for (let j = 0; j < b.n; j++) hit |= collideCaps(a, i, b, j) || 0;
  if (hit) { a.hitOther = 1; b.hitOther = 1; }
}

function updateVel(c, h) {
  const { pos, q, v, w, pp, pq } = c;
  const ih = 1 / h;
  for (let i = 0; i < c.n; i++) {
    const i3 = 3 * i, i4 = 4 * i;
    v[i3] = (pos[i3] - pp[i3]) * ih; v[i3 + 1] = (pos[i3 + 1] - pp[i3 + 1]) * ih; v[i3 + 2] = (pos[i3 + 2] - pp[i3 + 2]) * ih;
    // dq = q * conj(pq)
    const aw = q[i4], ax = q[i4 + 1], ay = q[i4 + 2], az = q[i4 + 3];
    const bw = pq[i4], bx = -pq[i4 + 1], by = -pq[i4 + 2], bz = -pq[i4 + 3];
    const dw = aw * bw - ax * bx - ay * by - az * bz;
    const dx = aw * bx + ax * bw + ay * bz - az * by;
    const dy = aw * by - ax * bz + ay * bw + az * bx;
    const dz = aw * bz + ax * by - ay * bx + az * bw;
    const s = dw >= 0 ? 2 * ih : -2 * ih;
    w[i3] = dx * s; w[i3 + 1] = dy * s; w[i3 + 2] = dz * s;
  }
}

// 関節の粘り（相対的な回転をすこし弱める）
function jointDamping(c, h) {
  const { w } = c;
  for (let j = 0; j < c.nj; j++) {
    const P = c.jP[j], C = c.jC[j];
    const rx = w[3 * C] - w[3 * P], ry = w[3 * C + 1] - w[3 * P + 1], rz = w[3 * C + 2] - w[3 * P + 2];
    const m = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (m < 1e-9) continue;
    const nx = rx / m, ny = ry / m, nz = rz / m;
    invIw(c, C, nx, ny, nz, T, 0);
    invIw(c, P, nx, ny, nz, T, 3);
    const wC = nx * T[0] + ny * T[1] + nz * T[2], wP = nx * T[3] + ny * T[4] + nz * T[5];
    let k = h * c.jdamp[j]; if (k > 1) k = 1;
    const dl = k * m / (wC + wP);
    w[3 * C] -= T[0] * dl; w[3 * C + 1] -= T[1] * dl; w[3 * C + 2] -= T[2] * dl;
    w[3 * P] += T[3] * dl; w[3 * P + 1] += T[4] * dl; w[3 * P + 2] += T[5] * dl;
  }
}

// 水の力（浮力と抵抗）
const WT = new Float64Array(6);
const SAMPLE = [-0.5, 0, 0.5], SW = [0.25, 0.5, 0.25];
function waterForces(c, water) {
  const B = c.model.bodies;
  const rho = 1000;
  const cur = water.current || null;
  for (let i = 0; i < c.n; i++) {
    const b = B[i];
    const r = b.shape === 'box' ? (b.r + b.w / 2) / 2 : b.r;
    const L = b.L;
    rotInto(c.q, 4 * i, 0, 1, 0, WT, 0);   // 骨の向き
    const ux = WT[0], uy = WT[1], uz = WT[2];
    const vol = b.mass / (rho * b.dens);
    for (let s = 0; s < 3; s++) {
      const off = SAMPLE[s] * L;
      const px = c.pos[3 * i] + ux * off, py = c.pos[3 * i + 1] + uy * off, pz = c.pos[3 * i + 2] + uz * off;
      const lev = water.level(px, pz);
      let frac = (lev - (py - r)) / (2 * r);
      if (frac <= 0) continue;
      if (frac > 1) frac = 1;
      const wgt = SW[s] * frac;
      // 浮力
      let Fy = rho * vol * 9.81 * wgt;
      // 抵抗
      const rx = ux * off, ry = uy * off, rz = uz * off;
      const wx = c.w[3 * i], wy = c.w[3 * i + 1], wz = c.w[3 * i + 2];
      let vx = c.v[3 * i] + wy * rz - wz * ry, vy = c.v[3 * i + 1] + wz * rx - wx * rz, vz = c.v[3 * i + 2] + wx * ry - wy * rx;
      if (cur) { vx -= cur[0]; vy -= cur[1]; vz -= cur[2]; }
      const vt = vx * ux + vy * uy + vz * uz;
      const tx = vt * ux, ty = vt * uy, tz = vt * uz;
      const nx = vx - tx, ny = vy - ty, nz = vz - tz;
      const vn = Math.sqrt(nx * nx + ny * ny + nz * nz), vta = vt < 0 ? -vt : vt;
      const An = 2 * r * (L + 2 * r) * wgt, At = 3.14159 * r * r * wgt;
      const kn = 0.5 * rho * 1.2 * An * vn + 6 * An, kt = 0.5 * rho * 0.15 * At * vta + 1 * At;
      const Fx = -kn * nx - kt * tx;
      Fy += -kn * ny - kt * ty;
      const Fz = -kn * nz - kt * tz;
      addForce(c.pos, c.f, c.t, i, px, py, pz, Fx, Fy, Fz);
    }
  }
}
