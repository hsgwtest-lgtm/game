// 設計図（骨・関節・筋肉）→ 物理モデル への組み立て
//
// 座標: メートル。+X = 前、+Y = 上、+Z = 右（左右対称の面は z = 0）
// 設計図の骨:
//   { id, parent, j:[関節の位置], a:[形の始点], b:[形の終点], r:太さ(半径), shape:'capsule'|'box', w:箱の幅,
//     dens:密度(水=1), joint:{ type, lim:[[lo,hi]×3](度), arm:筋肉のてこの長さ(m), str:筋力の倍率 }, mirror:左右の相方id }
// 関節の3つの軸（関節座標）:
//   e3 = 関節 → 子の骨の重心 の向き（ねじりの軸）
//   e1 = 左右方向(Z)に近い軸（曲げ・伸ばし）  e2 = e3 × e1（開き・閉じ）
// 関節角は「親から見た子の向き」を X→Y→Z の順のオイラー角で表したもの。
// 筋肉は関節の自由度ごとに「引き合う2本（屈筋・伸筋）」を自動でつける。
// 筋肉の通り道は 起始(親) → 滑車(関節の横) → 停止(子)。滑車があるので、てこの長さが関節の角度によらずほぼ一定になる。

import * as V from './vec.js';
import { PI } from './dmath.js';

export const MAX_BONES = 40;
export const DEG = PI / 180;

export const JOINT_TYPES = {
  hinge: { name: 'ひじ型', desc: '1つの軸で曲がる（ひざ・ひじ）', n: 1 },
  saddle: { name: 'くび型', desc: '2つの軸で曲がる（足首・手首）', n: 2 },
  ball: { name: 'かた型', desc: 'どの向きにも曲がり、ねじれる（肩・股）', n: 3 },
  fixed: { name: 'こてい', desc: '曲がらない', n: 0 },
};
export const DEFAULT_LIM = {
  hinge: [[-90, 90], [0, 0], [0, 0]],
  saddle: [[-50, 50], [-30, 30], [0, 0]],
  ball: [[-70, 70], [-45, 45], [-25, 25]],
  fixed: [[0, 0], [0, 0], [0, 0]],
};
export const AXIS_NAME = ['まげ', 'ひらき', 'ねじり'];

const RHO = 1000;         // 密度の基準（水）

export function normalizeLim(type, lim) {
  const base = DEFAULT_LIM[type] || DEFAULT_LIM.hinge;
  const out = [];
  const n = (JOINT_TYPES[type] || JOINT_TYPES.hinge).n;
  for (let k = 0; k < 3; k++) {
    if (k >= n) { out.push([0, 0]); continue; }
    const src = lim && lim[k] ? lim[k] : base[k];
    let lo = +src[0], hi = +src[1];
    if (!Number.isFinite(lo)) lo = base[k][0];
    if (!Number.isFinite(hi)) hi = base[k][1];
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    const capHi = k === 1 ? 80 : 175;
    lo = Math.max(-capHi, Math.min(0, lo));
    hi = Math.min(capHi, Math.max(0, hi));
    out.push([lo, hi]);
  }
  return out;
}

// 骨の形からローカル座標系（Y=骨の向き）を決める
export function boneFrame(a, b) {
  const L = V.dist(a, b);
  const Y = L > 1e-6 ? V.norm(V.sub(b, a)) : [0, 1, 0];
  let Z = V.sub([0, 0, 1], V.scale(Y, Y[2]));
  if (V.len(Z) < 0.3) Z = V.sub([1, 0, 0], V.scale(Y, Y[0]));
  Z = V.norm(Z);
  const X = V.cross(Y, Z);
  return { L, X, Y, Z, q: V.quatFromBasis(X, Y, Z) };
}

// 関節の3軸（世界座標・設計時の姿勢）
export function jointAxes(J, childCenter, childY, parentCenter) {
  let e3 = V.sub(childCenter, J);
  if (V.len(e3) < 1e-4) e3 = V.len(childY) > 0.5 ? childY : V.sub(childCenter, parentCenter);
  e3 = V.norm(e3);
  if (V.len(e3) < 0.5) e3 = [0, 1, 0];
  let e1 = V.sub([0, 0, 1], V.scale(e3, e3[2]));
  if (V.len(e1) < 0.35) e1 = V.sub([0, 1, 0], V.scale(e3, e3[1]));
  e1 = V.norm(e1);
  const e2 = V.cross(e3, e1);
  return [e1, e2, e3];
}

// 鏡に映した軸ベクトル（回転軸は擬ベクトルなので -M e）
const mirrorAxial = (e) => [-e[0], -e[1], e[2]];

function massProps(shape, L, r, w, dens) {
  const rho = RHO * dens;
  if (shape === 'box') {
    const X = 2 * r, Y = Math.max(L, 2 * r), Z = w;
    const m = rho * X * Y * Z;
    return { m, I: [m / 12 * (Y * Y + Z * Z), m / 12 * (X * X + Z * Z), m / 12 * (X * X + Y * Y)] };
  }
  const mc = rho * PI * r * r * L;
  const ms = rho * 4 / 3 * PI * r * r * r;
  const Iy = mc * r * r / 2 + ms * 2 * r * r / 5;
  const Ip = mc * (L * L / 12 + r * r / 4) + ms * (2 * r * r / 5 + L * L / 4 + 3 * L * r / 8);
  return { m: mc + ms, I: [Ip, Iy, Ip] };
}

// 線分どうしの最短距離（組み立て時の重なり判定用）
function segDist(p1, q1, p2, q2) {
  const d1 = V.sub(q1, p1), d2 = V.sub(q2, p2), r = V.sub(p1, p2);
  const a = V.dot(d1, d1), e = V.dot(d2, d2), f = V.dot(d2, r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) return V.len(r);
  if (a <= 1e-12) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = V.dot(d1, r);
    if (e <= 1e-12) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = V.dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return V.dist(V.add(p1, V.scale(d1, s)), V.add(p2, V.scale(d2, t)));
}

// 設計図の検査: 問題があれば日本語のメッセージ
export function validateDesign(design) {
  const problems = [];
  const bones = design && Array.isArray(design.bones) ? design.bones : [];
  if (!bones.length) return ['骨がありません'];
  if (bones.length > MAX_BONES) problems.push(`骨は ${MAX_BONES}本 まで`);
  const ids = new Set();
  for (const b of bones) {
    if (!b || typeof b.id !== 'string' || ids.has(b.id)) { problems.push('骨のデータがこわれています'); break; }
    ids.add(b.id);
    for (const p of [b.a, b.b, b.j || b.a]) {
      if (!Array.isArray(p) || p.length !== 3 || p.some(v => !Number.isFinite(v) || Math.abs(v) > 5)) { problems.push('骨の位置がおかしいです'); break; }
    }
    if (!(b.r >= 0.008 && b.r <= 0.4)) problems.push('骨の太さがおかしいです');
  }
  const roots = bones.filter(b => !b.parent);
  if (roots.length !== 1) problems.push('胴体（根もとの骨）は1つだけにしてください');
  for (const b of bones) if (b.parent && !ids.has(b.parent)) problems.push('つながっていない骨があります');
  // 輪になっていないか
  const byId = new Map(bones.map(b => [b.id, b]));
  for (const b of bones) {
    let c = b, n = 0;
    while (c && c.parent && n <= bones.length) { c = byId.get(c.parent); n++; }
    if (n > bones.length) { problems.push('骨のつながりが輪になっています'); break; }
  }
  return [...new Set(problems)];
}

export function compileModel(design) {
  const problems = validateDesign(design);
  if (problems.length) throw new Error(problems[0]);
  const src = design.bones;
  const byId = new Map(src.map(b => [b.id, b]));
  // 親が先に来る順番（幅優先）
  const order = [];
  const root = src.find(b => !b.parent);
  const queue = [root];
  while (queue.length) {
    const b = queue.shift();
    order.push(b);
    for (const c of src) if (c.parent === b.id) queue.push(c);
  }
  const n = order.length;
  const index = new Map(order.map((b, i) => [b.id, i]));
  const strAll = (design.muscles && design.muscles.str) || 1;

  // ── 骨（剛体）──
  const bodies = order.map((b, i) => {
    const shape = b.shape === 'box' ? 'box' : 'capsule';
    const r = Math.max(0.008, b.r);
    const w = shape === 'box' ? Math.max(2 * r, b.w || 4 * r) : 2 * r;
    const f = boneFrame(b.a, b.b);
    const L = shape === 'box' ? Math.max(f.L, 2 * r) : f.L;
    const dens = Math.max(0.2, Math.min(4, b.dens || 1));
    const mp = massProps(shape, L, r, w, dens);
    return {
      i, id: b.id, name: b.name || b.id, parent: b.parent ? index.get(b.parent) : -1,
      shape, r, w, L, dens, a: b.a.slice(), b: b.b.slice(), c: V.lerp(b.a, b.b, 0.5),
      Y: f.Y, q0: f.q, mass: mp.m, I: mp.I, mirror: -1, children: [],
      tag: b.tag || '',
    };
  });
  for (const bd of bodies) if (bd.parent >= 0) bodies[bd.parent].children.push(bd.i);
  order.forEach((b, i) => { if (b.mirror && index.has(b.mirror)) bodies[i].mirror = index.get(b.mirror); });

  // ── 関節 ──
  const joints = [];
  const jointOfBody = new Int32Array(n).fill(-1);
  for (let i = 1; i < n; i++) {
    const b = order[i], bd = bodies[i], P = bodies[bd.parent];
    const J = (b.j || b.a).slice();
    const ax = jointAxes(J, bd.c, bd.Y, P.c);
    const qJ = V.quatFromBasis(ax[0], ax[1], ax[2]);
    const jt = b.joint || {};
    const type = JOINT_TYPES[jt.type] ? jt.type : 'hinge';
    let lim = normalizeLim(type, jt.lim);
    const jo = {
      i: joints.length, parent: bd.parent, child: i, type, J, ax,
      rP: V.qinvrot(P.q0, V.sub(J, P.c)), rC: V.qinvrot(bd.q0, V.sub(J, bd.c)),
      qJP: V.qmul(V.qconj(P.q0), qJ), qJC: V.qmul(V.qconj(bd.q0), qJ),
      lim, limRad: null, arm: jt.arm, str: jt.str || 1, mirrorSign: [1, 1, 1], primary: true, partner: -1,
      damp: jt.damp || 1,
    };
    jointOfBody[i] = jo.i;
    joints.push(jo);
  }
  // 左右の相方: あとに来る方（二次）は、先に来る方（一次）の可動域を鏡に映して使う
  for (const jo of joints) {
    const m = bodies[jo.child].mirror;
    if (m < 0 || jointOfBody[m] < 0) continue;
    const pj = joints[jointOfBody[m]];
    const signs = [0, 1, 2].map(k => {
      const d = V.dot(jo.ax[k], mirrorAxial(pj.ax[k]));
      return Math.abs(d) > 0.5 ? Math.sign(d) : 0;
    });
    if (signs.some(s => s === 0) || pj.type !== jo.type) continue;
    jo.partner = pj.i; jo.mirrorSign = signs;
    if (m < jo.child) {
      jo.primary = false;
      jo.lim = pj.lim.map(([lo, hi], k) => (signs[k] > 0 ? [lo, hi] : [-hi, -lo]));
    }
  }
  for (const jo of joints) jo.limRad = jo.lim.map(([lo, hi]) => [lo * DEG, hi * DEG]);

  // 子孫（部分木）
  const subtree = (i) => { const out = [i]; for (let k = 0; k < out.length; k++) out.push(...bodies[out[k]].children); return out; };

  // ── 自由度（筋肉で動かせる軸）──
  const dofs = [];
  for (const jo of joints) {
    jo.dofs = [-1, -1, -1];
    if (jo.type === 'fixed') continue;
    const sub = subtree(jo.child);
    for (let k = 0; k < 3; k++) {
      const [lo, hi] = jo.limRad[k];
      if (hi - lo < 1e-4) continue;
      const e = jo.ax[k];
      let Ieff = 0;
      for (const bi of sub) {
        const B = bodies[bi];
        const eL = V.qinvrot(B.q0, e);
        Ieff += B.I[0] * eL[0] * eL[0] + B.I[1] * eL[1] * eL[1] + B.I[2] * eL[2] * eL[2];
        const d = V.sub(B.c, jo.J);
        const perp = V.sub(d, V.scale(e, V.dot(d, e)));
        Ieff += B.mass * V.dot(perp, perp);
      }
      const dof = {
        i: dofs.length, joint: jo.i, axis: k, e, lo, hi, Ieff, sub,
        group: -1, msign: 1, secondary: false, name: `${bodies[jo.child].name}・${AXIS_NAME[k]}`,
      };
      jo.dofs[k] = dof.i;
      dofs.push(dof);
    }
  }
  // 遺伝子を共有するグループ（左右の相方は同じグループ）
  let ng = 0;
  for (const d of dofs) {
    const jo = joints[d.joint];
    if (!jo.primary && jo.partner >= 0) {
      const pd = joints[jo.partner].dofs[d.axis];
      if (pd >= 0) { d.group = dofs[pd].group; d.msign = jo.mirrorSign[d.axis]; d.secondary = true; continue; }
    }
    d.group = ng++;
  }

  // ── 筋肉 ──
  const muscles = [];
  const off = (design.muscles && design.muscles.off) || {};
  const mult = (design.muscles && design.muscles.mult) || {};
  const armOf = (jo) => {
    if (jo.arm) return Math.max(0.008, Math.min(0.15, jo.arm));
    const C = bodies[jo.child];
    const rc = C.shape === 'box' ? Math.max(C.r, C.w * 0.3) : C.r;
    return Math.max(0.01, Math.min(0.08, 0.85 * rc));
  };
  // 関節に必要な力（トルク）を体のつくりから見積もる:
  //   体重を支える関節（その先が地面に届く）… 体重 × (関節の高さ と 先の広がり)
  //   それ以外 … 自分より先の部分を持ち上げて振れるくらい
  // → 太さではなく「何を動かすか」で筋力が決まるので、どんな形でもほどよい強さになる
  const lowY = bodies.map(Bd => {
    let y = 1e9;
    for (const f of (Bd.shape === 'box'
      ? [[Bd.r, Bd.L / 2, Bd.w / 2], [Bd.r, -Bd.L / 2, Bd.w / 2], [-Bd.r, Bd.L / 2, Bd.w / 2], [-Bd.r, -Bd.L / 2, Bd.w / 2], [Bd.r, Bd.L / 2, -Bd.w / 2], [Bd.r, -Bd.L / 2, -Bd.w / 2], [-Bd.r, Bd.L / 2, -Bd.w / 2], [-Bd.r, -Bd.L / 2, -Bd.w / 2]]
      : [[0, Bd.L / 2, 0], [0, -Bd.L / 2, 0]])) {
      const p = V.add(Bd.c, V.qrot(Bd.q0, f));
      y = Math.min(y, p[1] - (Bd.shape === 'box' ? 0 : Bd.r));
    }
    return y;
  });
  const gMinY = Math.min(...lowY);
  bodies.forEach((Bd, i) => { Bd.lowY = lowY[i]; });
  let Mtot = 0; for (const Bd of bodies) Mtot += Bd.mass;
  const G = 9.81;
  const torqueNeed = (jo) => {
    const sub = subtree(jo.child);
    let m = 0, cx = 0, cy = 0, cz = 0, ext = 0, touches = false;
    for (const bi of sub) {
      const Bd = bodies[bi];
      m += Bd.mass; cx += Bd.c[0] * Bd.mass; cy += Bd.c[1] * Bd.mass; cz += Bd.c[2] * Bd.mass;
      if (lowY[bi] < gMinY + 0.03) touches = true;
      for (const p of [Bd.a, Bd.b]) {
        const dx = p[0] - jo.J[0], dz = p[2] - jo.J[2];
        ext = Math.max(ext, Math.sqrt(dx * dx + dz * dz) + Bd.r);
      }
    }
    const com = [cx / m, cy / m, cz / m];
    const dsub = V.dist(com, jo.J);
    const lift = 3 * m * G * dsub + 0.3;
    if (!touches) return lift;
    const h = Math.max(0, jo.J[1] - gMinY);
    return Math.max(lift, Mtot * G * (0.35 * h + 0.6 * ext));
  };
  for (const jo of joints) jo.Tneed = jo.type === 'fixed' ? 0 : torqueNeed(jo);
  const addMuscle = (m) => {
    if (off[m.key]) return;
    m.fmax *= strAll * (mult[m.key] || 1);
    muscles.push(m);
  };
  for (const jo of joints) {
    if (jo.type === 'fixed') continue;
    const P = bodies[jo.parent], C = bodies[jo.child];
    const [e1, e2, e3] = jo.ax;
    const J = jo.J;
    const arm = armOf(jo);
    const dc = Math.max(0.03, Math.min(0.3, 0.9 * V.dist(C.c, J)));
    let up = V.sub(P.c, J);
    const dpRaw = V.len(up);
    up = dpRaw > 1e-3 ? V.norm(up) : V.scale(e3, -1);
    const dp = Math.max(0.03, Math.min(0.25, 0.7 * dpRaw + 0.03));
    for (let k = 0; k < 3; k++) {
      if (jo.dofs[k] < 0) continue;
      const [lo, hi] = jo.limRad[k];
      const mid = (lo + hi) / 2;
      for (const sgn of [1, -1]) {
        let pts;
        if (k < 2) {
          const s = V.norm(V.cross(jo.ax[k], e3));
          const side = V.scale(s, sgn * arm);
          pts = [
            { body: P.i, p: V.add(V.add(J, V.scale(up, dp)), side) },
            { body: P.i, p: V.add(J, side) },
            { body: C.i, p: V.add(V.add(J, V.scale(e3, dc)), side) },
          ];
        } else {
          const ra = arm * 1.3;
          pts = [
            { body: P.i, p: V.add(J, V.scale(e1, -sgn * ra)) },
            { body: C.i, p: V.add(V.add(J, V.scale(e3, dc)), V.scale(e2, ra)) },
          ];
        }
        const key = `${C.id}:${k}:${sgn > 0 ? '+' : '-'}`;
        const fmax = jo.Tneed * jo.str * (k === 2 ? 0.5 : 1) / (k === 2 ? arm * 0.6 : arm);
        addMuscle({
          key, kind: k === 2 ? 'twist' : 'single', joint: jo.i, dof: jo.dofs[k], sign: sgn, fmax,
          pts, name: `${C.name} ${AXIS_NAME[k]}${sgn > 0 ? '＋' : '−'}`, range: hi - lo, mid,
        });
      }
    }
  }
  // 2関節筋など（骨Aから子孫の骨Bへ。途中の関節すべてを滑車でまたぐ）
  for (const ex of (design.muscles && design.muscles.extra) || []) {
    const A = index.get(ex.from), B = index.get(ex.to);
    if (A === undefined || B === undefined || A === B) continue;
    const chain = [];
    let c = B;
    while (c !== A && c >= 0) { chain.unshift(c); c = bodies[c].parent; }
    if (c !== A || !chain.length) continue;
    const sides = ex.sides || [];
    const pts = [];
    let fbody = bodies[chain[chain.length - 1]];
    chain.forEach((ci, idx) => {
      const jo = joints[jointOfBody[ci]];
      const arm = armOf(jo) * (ex.arm || 1);
      const s = V.norm(V.cross(jo.ax[0], jo.ax[2]));
      const side = V.scale(s, (sides[idx] || 1) * arm);
      if (idx === 0) {
        const P = bodies[jo.parent];
        let up = V.sub(P.c, jo.J);
        const dpRaw = V.len(up);
        up = dpRaw > 1e-3 ? V.norm(up) : V.scale(jo.ax[2], -1);
        pts.push({ body: P.i, p: V.add(V.add(jo.J, V.scale(up, Math.max(0.03, Math.min(0.25, 0.7 * dpRaw + 0.03)))), side) });
      }
      pts.push({ body: jo.parent, p: V.add(jo.J, side) });
      if (idx === chain.length - 1) {
        const C = bodies[ci];
        const dc = Math.max(0.03, Math.min(0.3, 0.9 * V.dist(C.c, jo.J)));
        pts.push({ body: C.i, p: V.add(V.add(jo.J, V.scale(jo.ax[2], dc)), side) });
      }
    });
    const lastJ = joints[jointOfBody[chain[chain.length - 1]]];
    addMuscle({
      key: `x:${ex.id || ex.from + '-' + ex.to}`, kind: 'multi', joint: lastJ.i, dof: -1, sign: 1,
      fmax: lastJ.Tneed * (ex.f || 1) / (armOf(lastJ) * (ex.arm || 1)), pts, name: ex.name || `${bodies[A].name}→${fbody.name}`, range: 0, mid: 0,
    });
  }
  // ローカル座標へ・長さ・てこの長さ（数値微分）
  const restOf = (m, tf) => {
    let Lsum = 0, prev = null;
    for (const pt of m.pts) {
      const T = tf ? tf[pt.body] : null;
      const w = T ? V.add(T.c, V.qrot(T.q, pt.local)) : pt.p;
      if (prev) Lsum += V.dist(prev, w);
      prev = w;
    }
    return Lsum;
  };
  for (const m of muscles) {
    for (const pt of m.pts) pt.local = V.qinvrot(bodies[pt.body].q0, V.sub(pt.p, bodies[pt.body].c));
    m.rest = restOf(m, null);
  }
  const restTf = bodies.map(B => ({ c: B.c, q: B.q0 }));
  const DLT = 1e-3;
  for (const m of muscles) m.arms = [];
  for (const d of dofs) {
    const jo = joints[d.joint];
    const inSub = new Uint8Array(n);
    for (const bi of d.sub) inSub[bi] = 1;
    const tfAt = (ang) => {
      const qr = V.qaxis(d.e, ang);
      return bodies.map((B, bi) => inSub[bi]
        ? { c: V.add(jo.J, V.qrot(qr, V.sub(B.c, jo.J))), q: V.qmul(qr, B.q0) }
        : restTf[bi]);
    };
    const tp = tfAt(DLT), tm = tfAt(-DLT);
    for (const m of muscles) {
      if (!m.pts.some(pt => inSub[pt.body]) || m.pts.every(pt => inSub[pt.body])) continue;
      const r = -(restOf(m, tp) - restOf(m, tm)) / (2 * DLT);
      if (Math.abs(r) > 1e-5) m.arms.push({ dof: d.i, r });
    }
  }
  // 筋線維の長さ（可動域の真ん中で一番力が出るように）
  for (const m of muscles) {
    let lfib, lmid = m.rest;
    if (m.kind === 'single') {
      const a = m.arms.find(x => x.dof === m.dof);
      const r = a ? Math.abs(a.r) : 0.03;
      lmid = m.rest - (a ? a.r : 0) * m.mid;
      lfib = Math.max(0.3 * m.rest, r * m.range / 0.95);
    } else {
      lfib = 0.45 * m.rest;
    }
    lfib = Math.min(lfib, 0.95 * lmid);
    m.lfib = Math.max(0.01, lfib);
    m.lten = Math.max(0, lmid - m.lfib);
    m.vmax = 10 * m.lfib;
    m.volume = m.fmax * m.lfib;   // 筋肉の体積に比例（エネルギーの計算用）
  }
  // 自由度ごとの最大トルク（神経系の計算用）
  for (const d of dofs) { d.Tpos = 0; d.Tneg = 0; }
  for (const m of muscles) {
    for (const a of m.arms) {
      const d = dofs[a.dof];
      if (a.r > 0) d.Tpos += m.fmax * a.r; else d.Tneg += m.fmax * -a.r;
    }
  }

  // ── 接触の点（地面）──
  for (const B of bodies) {
    const f = [];
    if (B.shape === 'box') {
      const hx = B.r, hy = B.L / 2, hz = B.w / 2;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) f.push([sx * hx, sy * hy, sz * hz, 0.004]);
    } else if (B.L > 1e-4) {
      f.push([0, -B.L / 2, 0, B.r], [0, B.L / 2, 0, B.r]);
      if (B.L > 3 * B.r) f.push([0, 0, 0, B.r]);
    } else f.push([0, 0, 0, B.r]);
    B.feat = f;
    // 衝突用のカプセル（箱は長さ方向のカプセルで近似）
    B.capR = B.shape === 'box' ? Math.min(B.w / 2, B.r * 1.4) : B.r;
    B.capH = B.shape === 'box' ? Math.max(0, B.L / 2 - B.capR * 0.5) : B.L / 2;
    B.bound = B.capH + B.capR + (B.shape === 'box' ? B.w / 2 : 0);
  }
  // 自分どうしの衝突ペア（親子と、設計時点で重なっているものは除く）
  const pairs = [];
  const segOf = (B) => {
    const h = V.scale(B.Y, B.capH);
    return [V.sub(B.c, h), V.add(B.c, h)];
  };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = bodies[i], B = bodies[j];
    if (A.parent === j || B.parent === i) continue;
    if (A.parent >= 0 && A.parent === B.parent && V.dist(order[i].j || order[i].a, order[j].j || order[j].a) < 0.02) continue;
    const sa = segOf(A), sb = segOf(B);
    if (segDist(sa[0], sa[1], sb[0], sb[1]) < A.capR + B.capR + 0.01) continue;
    pairs.push([i, j]);
  }

  // ── 全体 ──
  let M = 0, com = [0, 0, 0], minY = 1e9;
  for (const B of bodies) {
    M += B.mass;
    com = V.add(com, V.scale(B.c, B.mass));
    for (const f of B.feat) {
      const p = V.add(B.c, V.qrot(B.q0, f));
      minY = Math.min(minY, p[1] - f[3]);
    }
  }
  com = V.scale(com, 1 / M);
  let maxY = -1e9, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const B of bodies) for (const f of B.feat) {
    const p = V.add(B.c, V.qrot(B.q0, f));
    maxY = Math.max(maxY, p[1] + f[3]); minX = Math.min(minX, p[0] - f[3]); maxX = Math.max(maxX, p[0] + f[3]);
    minZ = Math.min(minZ, p[2] - f[3]); maxZ = Math.max(maxZ, p[2] + f[3]);
  }
  const senseId = order.findIndex(b => b.sense);
  // 足: 左右の相方がいて、設計の姿勢で地面に届いている骨（着地のタイミングでリズムをそろえるのに使う）
  //   相方どうしを1組とし、組ごとに「着地する位相」の遺伝子を1つ持つ
  const Hh = maxY - minY;
  const nearG = (Bd) => Bd.lowY < minY + Math.max(0.02, 0.08 * Hh);
  const feet = [];
  let nFootPair = 0;
  for (const Bd of bodies) {
    if (Bd.i === 0 || Bd.mirror < 0 || !nearG(Bd)) continue;
    // 同じ脚の中では、いちばん先（地面に近い）だけ
    if (Bd.children.some(ci => nearG(bodies[ci]))) continue;
    if (Bd.i > Bd.mirror) continue;   // 先に並ぶ方（一次側）から組を作る
    feet.push({ i: Bd.i, pair: nFootPair, sec: 0 }, { i: Bd.mirror, pair: nFootPair, sec: 1 });
    nFootPair++;
  }
  // ── 生まれつきの反射（遺伝子が 0 のときの神経のふるまい）──
  //   立ち直り反射: 根もと→平衡感覚の骨 のあいだの関節は、感覚の骨をまっすぐに保つ向きへ
  //                 脚のつけ根の関節は、足が地面についているあいだ、胴をまっすぐに保つ向きへ
  //   足ぶみ反射:   脚のつけ根は、足が宙にあるとき、体が倒れそうな向きへ足を踏みだす
  //                 脚の関節は、リズムの「振り出し」の半周期に、足を持ちあげる向きへ曲がる
  //   どれも遺伝子で強めたり、弱めたり、逆にしたりできる
  const sense = senseId >= 0 ? senseId : 0;
  const trunk = new Set();
  for (let b = sense; b >= 0; b = bodies[b].parent) trunk.add(b);
  const nTrunkJ = [...trunk].filter(b => b !== 0).length;
  const footSet = new Set(feet.map(f => f.i));
  for (const d of dofs) {
    const jo = joints[d.joint];
    d.prior = { st: 0, sw: 0, osw: 0 };
    const leg = d.sub.some(b => footSet.has(b));
    d.leg = leg;
    d.proximal = leg && trunk.has(jo.parent);   // 脚のつけ根（胴から生えている関節）
    // 胴をまっすぐに保つ反射は、二本足（足が1組だけ）の体のときだけ（四つ足では胴は脚の上に「のる」ので要らない）
    const biped = nFootPair === 1;
    if (biped && trunk.has(jo.child)) {
      d.prior.st = d.prior.sw = 1 / (nTrunkJ + 1);
    } else if (biped && leg && trunk.has(jo.parent)) {
      d.prior.st = -1 / (nTrunkJ + 1);
      d.prior.sw = 0.6;
    }
    if (leg && d.axis === 0) {
      // 足を持ちあげる向き: この軸で ±0.35rad 回したとき、足の重心がどれだけ上がるか（つけ根は、前へ出るほうも少し重視）
      const proximal = trunk.has(jo.parent);
      const foot = d.sub.find(b => footSet.has(b));
      const F = bodies[foot].c;
      const r = V.sub(F, jo.J);
      let best = 0, bs = 0.002;
      for (const sg of [1, -1]) {
        const lim = sg > 0 ? d.hi : -d.lo;
        const th = Math.min(0.35, 0.8 * lim);
        if (th < 0.05) continue;
        const qr = V.qaxis(d.e, sg * th);
        const dp = V.sub(V.qrot(qr, r), r);
        const score = dp[1] + (proximal ? 0.1 * dp[0] : 0);
        if (score > bs) { bs = score; best = sg * th; }
      }
      // 二本足ははっきりと、多くの足を持つ体はひかえめに（たくさんの足が一度に浮くと転ぶ）
      d.prior.osw = best * (biped ? 0.85 : 0.45);
    }
  }
  return {
    name: design.name || '', bodies, joints, dofs, muscles, pairs, n, feet, nFootPair,
    nDof: dofs.length, nGroup: ng, mass: M, com, minY,
    size: { h: maxY - minY, x: maxX - minX, z: maxZ - minZ, minX, maxX },
    sense: senseId >= 0 ? senseId : 0,
    index, jointOfBody,
  };
}
