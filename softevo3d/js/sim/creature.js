// 生物のシミュレーション（物理 + 感覚 + 脳）
//
// 物理: XPBD（位置ベースの拘束ソルバー）を小さな時間刻みで回す「スモールステップ法」
//   ・1フレーム(1/60秒)を SUBSTEPS 回に分け、各回で 重力→拘束→地面 を1回ずつ解く
//   ・拘束の補正は2点を結ぶ線の向きにだけかかり、運動量も角運動量も生まれない
//     （＝「数値の永久機関」で宙を飛んでいくズルが進化しない）
//   ・地面の摩擦は、めりこみの深さに比例した分だけ横ずれを止める（クーロン摩擦）
//   ・筋肉は一瞬では動けない（ローパス）。振動を悪用したズルを防ぎ、動きも生き物らしくなる
// 決定論: 同じ体・同じ遺伝子なら、いつ・どの端末で計算しても同じ結果（dmath.js を参照）

import { Brain, periodOf } from './brain.js';
import { makeGround, TERRAINS } from './terrain.js';
import { dsin, dcos, dexp } from './dmath.js';
import { MUSCLE_AMP } from './body.js';

export const FPS = 60;
export const DT = 1 / FPS;
export const SUBSTEPS = 6;
export const EVAL_SECONDS = 10;
export const EVAL_FRAMES = EVAL_SECONDS * FPS;
const GRAV = 9.81;
const TAU = 0.1;                       // 筋肉の反応時間（秒）
const ALPHA = 1 - dexp(-DT / TAU);
const BETA = 30;                       // 拘束の減衰
const START_Y = 0.002;
const DS = DT / SUBSTEPS;
const TWO_PI = 6.283185307179586;

export const GRAVITIES = {
  earth: { name: 'ちきゅう', g: 1 },
  mars: { name: 'かせい', g: 0.38 },
  moon: { name: 'つき', g: 0.17 },
};
export const GRAVITY_KEYS = ['earth', 'mars', 'moon'];
export const OBJECTIVES = {
  distance: { name: 'きょり', desc: '10びょうで まえへ すすんだ きょり' },
  jump: { name: 'ジャンプ', desc: 'じめんから いちばん たかく はなれた たかさ' },
};
export const OBJECTIVE_KEYS = ['distance', 'jump'];

export function normalizeEnv(env = {}) {
  return {
    terrain: TERRAINS[env.terrain] ? env.terrain : 'flat',
    gravity: GRAVITIES[env.gravity] ? env.gravity : 'earth',
    objective: OBJECTIVES[env.objective] ? env.objective : 'distance',
  };
}
export function envKey(env) { const e = normalizeEnv(env); return `${e.terrain}/${e.gravity}/${e.objective}`; }

// 拘束ごとの係数（体ごとに1回だけ計算）
function xpbdFactors(body) {
  if (body._xp) return body._xp;
  const n = body.nC;
  const gam = new Float64Array(n), k1 = new Float64Array(n);
  const inv2 = 1 / (DS * DS);
  for (let c = 0; c < n; c++) {
    const w = body.invMass[body.ca[c]] + body.invMass[body.cb[c]];
    const at = body.comp[c] * inv2;
    gam[c] = body.comp[c] * BETA / DS;
    k1[c] = 1 / ((1 + gam[c]) * w + at);
  }
  body._xp = { gam, k1 };
  return body._xp;
}

export class Creature {
  constructor(body, layout, genome, env, opts = {}) {
    this.body = body;
    this.L = layout;
    this.genome = genome;
    this.env = normalizeEnv(env);
    this.ground = makeGround(this.env.terrain);
    this.grav = GRAV * GRAVITIES[this.env.gravity].g;
    this.xp = xpbdFactors(body);
    const nN = body.nN;
    this.pos = new Float64Array(nN * 3);
    this.prev = new Float64Array(nN * 3);
    this.vel = new Float64Array(nN * 3);
    this.contact = new Uint8Array(nN);
    for (let i = 0; i < nN * 3; i++) this.pos[i] = body.rest[i];
    for (let n = 0; n < nN; n++) this.pos[n * 3 + 1] += START_Y;
    this.rest = Float64Array.from(body.rest0);
    this.act = new Float64Array(body.nCh);
    this.brain = new Brain(layout, genome);
    this.period = periodOf(layout, genome);
    this.phase = 0;
    this.q = [1, 0, 0, 0];
    this.R = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.com = [0, 0, 0];
    this.comV = [0, 0, 0];
    this.quadTouch = new Float64Array(4);
    this.strain = new Float64Array(body.nCh);
    this.frame = 0;
    this._nrm = [0, 1, 0];
    // 重心からの自然な位置（回転の推定に使う）
    const rq = new Float64Array(nN * 3);
    for (let n = 0; n < nN; n++) {
      rq[n * 3] = body.rest[n * 3];
      rq[n * 3 + 1] = body.rest[n * 3 + 1] - body.restCOM[1];
      rq[n * 3 + 2] = body.rest[n * 3 + 2];
    }
    this.rq = rq;
    this._computeCOM();
    this.startX = this.com[0];
    // 記録
    this.st = {
      air: 0, quad: [0, 0, 0, 0], upside: 0, rollZ: 0, rollX: 0,
      maxClear: 0, maxSpeed: 0, exploded: false, lastAz: 0, lastAx: 0, minY: 0,
    };
  }

  _computeCOM() {
    const b = this.body, p = this.pos, v = this.vel, m = b.mass;
    let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    for (let n = 0, i = 0; n < b.nN; n++, i += 3) {
      const w = m[n];
      cx += p[i] * w; cy += p[i + 1] * w; cz += p[i + 2] * w;
      vx += v[i] * w; vy += v[i + 1] * w; vz += v[i + 2] * w;
    }
    const inv = 1 / b.totalMass;
    this.com[0] = cx * inv; this.com[1] = cy * inv; this.com[2] = cz * inv;
    this.comV[0] = vx * inv; this.comV[1] = vy * inv; this.comV[2] = vz * inv;
  }

  // 体全体の回転を推定（Müller et al. 2016 の反復法。前フレームの値から始めるので数回で収束）
  _computeRotation() {
    const b = this.body, p = this.pos, rq = this.rq, m = b.mass;
    const cx = this.com[0], cy = this.com[1], cz = this.com[2];
    let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
    for (let n = 0, i = 0; n < b.nN; n++, i += 3) {
      const w = m[n];
      const px = (p[i] - cx) * w, py = (p[i + 1] - cy) * w, pz = (p[i + 2] - cz) * w;
      const rx = rq[i], ry = rq[i + 1], rz = rq[i + 2];
      a00 += px * rx; a01 += px * ry; a02 += px * rz;
      a10 += py * rx; a11 += py * ry; a12 += py * rz;
      a20 += pz * rx; a21 += pz * ry; a22 += pz * rz;
    }
    const q = this.q;
    let R = this.R;
    for (let it = 0; it < 8; it++) {
      this._qToR();
      R = this.R;
      // ω = Σ_j R_j × A_j / |Σ_j R_j · A_j|
      const r0x = R[0], r0y = R[3], r0z = R[6];   // 列0
      const r1x = R[1], r1y = R[4], r1z = R[7];   // 列1
      const r2x = R[2], r2y = R[5], r2z = R[8];   // 列2
      let ox = (r0y * a20 - r0z * a10) + (r1y * a21 - r1z * a11) + (r2y * a22 - r2z * a12);
      let oy = (r0z * a00 - r0x * a20) + (r1z * a01 - r1x * a21) + (r2z * a02 - r2x * a22);
      let oz = (r0x * a10 - r0y * a00) + (r1x * a11 - r1y * a01) + (r2x * a12 - r2y * a02);
      const dot = r0x * a00 + r0y * a10 + r0z * a20 + r1x * a01 + r1y * a11 + r1z * a21 + r2x * a02 + r2y * a12 + r2z * a22;
      const s = 1 / (Math.abs(dot) + 1e-9);
      ox *= s; oy *= s; oz *= s;
      const w = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (w < 1e-9) break;
      const half = w * 0.5, sn = dsin(half) / w, cs = dcos(half);
      const bw = cs, bx = ox * sn, by = oy * sn, bz = oz * sn;
      const nw = bw * q[0] - bx * q[1] - by * q[2] - bz * q[3];
      const nx = bw * q[1] + bx * q[0] + by * q[3] - bz * q[2];
      const ny = bw * q[2] - bx * q[3] + by * q[0] + bz * q[1];
      const nz = bw * q[3] + bx * q[2] - by * q[1] + bz * q[0];
      const ln = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
      q[0] = nw * ln; q[1] = nx * ln; q[2] = ny * ln; q[3] = nz * ln;
      if (w < 1e-6) break;
    }
    this._qToR();
  }

  _qToR() {
    const [w, x, y, z] = this.q, R = this.R;
    R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - w * z); R[2] = 2 * (x * z + w * y);
    R[3] = 2 * (x * y + w * z); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - w * x);
    R[6] = 2 * (x * z - w * y); R[7] = 2 * (y * z + w * x); R[8] = 1 - 2 * (x * x + y * y);
  }

  // 感覚 → 脳の入力
  _sense() {
    const b = this.body, L = this.L, inp = this.brain.inp, R = this.R;
    this._computeCOM();
    this._computeRotation();
    let k = 0;
    // 筋肉の伸び
    const p = this.pos;
    for (let c = 0; c < b.nCh; c++) {
      const s0 = b.strainStart[c], s1 = b.strainStart[c + 1];
      let sum = 0;
      for (let s = s0; s < s1; s++) {
        const ci = b.strainIdx[s];
        const ia = b.ca[ci] * 3, ib = b.cb[ci] * 3;
        const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
        sum += Math.sqrt(dx * dx + dy * dy + dz * dz) / b.rest0[ci];
      }
      const st = s1 > s0 ? (sum / (s1 - s0) - 1) / MUSCLE_AMP : 0;
      this.strain[c] = st;
      inp[k++] = st > 2 ? 2 : st < -2 ? -2 : st;
    }
    // 接地（前後×左右）
    const qt = this.quadTouch;
    qt[0] = qt[1] = qt[2] = qt[3] = 0;
    const ct = this.contact, quad = b.quad;
    for (let n = 0; n < b.nN; n++) if (ct[n]) qt[quad[n]] += 1;
    for (let i = 0; i < 4; i++) { const v = qt[i] * 0.5; qt[i] = v > 1 ? 1 : v; inp[k++] = qt[i]; }
    // 体の傾き: 重力（下向き）を体の座標で見る = Rᵀ(0,-1,0)
    inp[k++] = -R[3]; inp[k++] = -R[4]; inp[k++] = -R[5];
    // 速さ（体の座標）
    const vx = this.comV[0], vy = this.comV[1], vz = this.comV[2];
    const bvx = R[0] * vx + R[3] * vy + R[6] * vz;
    const bvy = R[1] * vx + R[4] * vy + R[7] * vz;
    const bvz = R[2] * vx + R[5] * vy + R[8] * vz;
    inp[k++] = clamp3(bvx); inp[k++] = clamp3(bvy); inp[k++] = clamp3(bvz);
    // ゴール（+X 方向）の向き = Rᵀ(1,0,0)
    inp[k++] = R[0]; inp[k++] = R[2];
    // リズム
    inp[k++] = dsin(this.phase); inp[k++] = dcos(this.phase);
  }

  step() {
    const b = this.body;
    this._sense();
    const out = this.brain.forward();
    const act = this.act;
    for (let c = 0; c < b.nCh; c++) act[c] += (out[c] - act[c]) * ALPHA;
    // 筋肉の自然長
    const rest = this.rest, rest0 = b.rest0, aC = b.actC, aCh = b.actCh, aK = b.actCoef;
    for (let i = 0; i < aC.length; i++) rest[aC[i]] = rest0[aC[i]];
    for (let i = 0; i < aC.length; i++) rest[aC[i]] += rest0[aC[i]] * aK[i] * act[aCh[i]];
    // リズム
    this.phase += TWO_PI * DT / this.period;
    if (this.phase >= TWO_PI) this.phase -= TWO_PI;
    // 物理
    this.contact.fill(0);
    for (let s = 0; s < SUBSTEPS; s++) this._substep();
    this.frame++;
    this._record();
  }

  _substep() {
    const b = this.body, pos = this.pos, prev = this.prev, vel = this.vel;
    const nN = b.nN, inv = b.invMass;
    const gds = this.grav * DS;
    for (let i = 0, n = 0; n < nN; n++, i += 3) {
      vel[i + 1] -= gds;
      prev[i] = pos[i]; prev[i + 1] = pos[i + 1]; prev[i + 2] = pos[i + 2];
      pos[i] += vel[i] * DS; pos[i + 1] += vel[i + 1] * DS; pos[i + 2] += vel[i + 2] * DS;
    }
    // 拘束
    const ca = b.ca, cb = b.cb, rest = this.rest, gam = this.xp.gam, k1 = this.xp.k1, nC = b.nC;
    for (let c = 0; c < nC; c++) {
      const a = ca[c], bb = cb[c];
      const ia = a * 3, ib = bb * 3;
      const dx = pos[ib] - pos[ia], dy = pos[ib + 1] - pos[ia + 1], dz = pos[ib + 2] - pos[ia + 2];
      const L2 = dx * dx + dy * dy + dz * dz;
      if (L2 < 1e-18) continue;
      const len = Math.sqrt(L2), il = 1 / len;
      const nx = dx * il, ny = dy * il, nz = dz * il;
      const rd = nx * ((pos[ib] - prev[ib]) - (pos[ia] - prev[ia])) +
        ny * ((pos[ib + 1] - prev[ib + 1]) - (pos[ia + 1] - prev[ia + 1])) +
        nz * ((pos[ib + 2] - prev[ib + 2]) - (pos[ia + 2] - prev[ia + 2]));
      const dl = -(len - rest[c] + gam[c] * rd) * k1[c];
      const wa = inv[a] * dl, wb = inv[bb] * dl;
      pos[ia] -= nx * wa; pos[ia + 1] -= ny * wa; pos[ia + 2] -= nz * wa;
      pos[ib] += nx * wb; pos[ib + 1] += ny * wb; pos[ib + 2] += nz * wb;
    }
    // 地面
    const mu = b.mu, ct = this.contact, gr = this.ground;
    if (gr.flat) {
      for (let i = 0, n = 0; n < nN; n++, i += 3) {
        const y = pos[i + 1];
        if (y >= 0) continue;
        const d = -y;
        pos[i + 1] = 0;
        const tx = pos[i] - prev[i], tz = pos[i + 2] - prev[i + 2];
        const lt2 = tx * tx + tz * tz, lim = mu[n] * d;
        if (lt2 <= lim * lim) { pos[i] = prev[i]; pos[i + 2] = prev[i + 2]; }
        else { const s = lim / Math.sqrt(lt2); pos[i] -= tx * s; pos[i + 2] -= tz * s; }
        ct[n] = 1;
      }
    } else {
      const nrm = this._nrm;
      for (let i = 0, n = 0; n < nN; n++, i += 3) {
        const hgt = gr.h(pos[i], pos[i + 2]);
        if (pos[i + 1] >= hgt) continue;
        gr.normal(pos[i], pos[i + 2], nrm);
        const d = (hgt - pos[i + 1]) * nrm[1];
        pos[i] += nrm[0] * d; pos[i + 1] += nrm[1] * d; pos[i + 2] += nrm[2] * d;
        const ex = pos[i] - prev[i], ey = pos[i + 1] - prev[i + 1], ez = pos[i + 2] - prev[i + 2];
        const dn = ex * nrm[0] + ey * nrm[1] + ez * nrm[2];
        const tx = ex - dn * nrm[0], ty = ey - dn * nrm[1], tz = ez - dn * nrm[2];
        const lt2 = tx * tx + ty * ty + tz * tz, lim = mu[n] * d;
        if (lt2 <= lim * lim) { pos[i] -= tx; pos[i + 1] -= ty; pos[i + 2] -= tz; }
        else { const s = lim / Math.sqrt(lt2); pos[i] -= tx * s; pos[i + 1] -= ty * s; pos[i + 2] -= tz * s; }
        ct[n] = 1;
      }
    }
    const id = 1 / DS;
    for (let i = 0; i < nN * 3; i++) vel[i] = (pos[i] - prev[i]) * id;
  }

  _record() {
    const st = this.st, b = this.body, p = this.pos, gr = this.ground;
    let any = 0, q0 = 0, q1 = 0, q2 = 0, q3 = 0;
    const ct = this.contact, quad = b.quad;
    for (let n = 0; n < b.nN; n++) {
      if (!ct[n]) continue;
      any = 1;
      const q = quad[n];
      if (q === 0) q0 = 1; else if (q === 1) q1 = 1; else if (q === 2) q2 = 1; else q3 = 1;
    }
    if (!any) st.air++;
    st.quad[0] += q0; st.quad[1] += q1; st.quad[2] += q2; st.quad[3] += q3;
    const R = this.R;
    if (R[4] < 0) st.upside++;
    // 回転の累積（横から見た回転 = z軸まわり、前から見た回転 = x軸まわり）
    const ux = R[1], uy = R[4], uz = R[7];
    const az = Math.atan2(ux, uy), ax = Math.atan2(uz, uy);
    if (this.frame > 1) { st.rollZ += wrap(az - st.lastAz); st.rollX += wrap(ax - st.lastAx); }
    st.lastAz = az; st.lastAx = ax;
    // 地面からいちばん低い点の高さ（ジャンプ）
    let minC = 1e9, minY = 1e9;
    for (let n = 0, i = 0; n < b.nN; n++, i += 3) {
      const c = p[i + 1] - gr.h(p[i], p[i + 2]);
      if (c < minC) minC = c;
      if (p[i + 1] < minY) minY = p[i + 1];
    }
    st.minY = minY;
    if (this.frame > 18 && minC > st.maxClear) st.maxClear = minC;
    const v = this.comV, sp = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (sp > st.maxSpeed) st.maxSpeed = sp;
    const cx = this.com[0];
    if (!(Math.abs(cx) < 1e4) || !(sp < 1e4)) st.exploded = true;
  }

  get distance() { return this.com[0] - this.startX; }

  result() {
    this._computeCOM();
    const st = this.st, f = Math.max(1, this.frame);
    const dist = this.com[0] - this.startX;
    let fitness = this.env.objective === 'jump' ? st.maxClear : dist;
    let flag = 'ok';
    if (st.exploded || !Number.isFinite(fitness)) { flag = 'explode'; fitness = -1; }
    else if (st.maxSpeed > 20) { flag = 'cheat'; fitness = -1; }
    return {
      fitness, dist, jump: st.maxClear, flag,
      air: st.air / f, quad: st.quad.map(v => v / f), upside: st.upside / f,
      rollZ: st.rollZ / TWO_PI, rollX: st.rollX / TWO_PI,
      drift: this.com[2], period: this.period,
    };
  }
}

function clamp3(v) { return v > 3 ? 3 : v < -3 ? -3 : v; }
function wrap(a) { while (a > Math.PI) a -= TWO_PI; while (a < -Math.PI) a += TWO_PI; return a; }

// 1体を評価（ワーカーとテストで使う）
export function evaluate(body, layout, genome, env, frames = EVAL_FRAMES) {
  const c = new Creature(body, layout, genome, env);
  for (let f = 0; f < frames; f++) {
    c.step();
    if (c.st.exploded) break;
  }
  return c.result();
}
