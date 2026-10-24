// 神経系（脳 → 脊髄 → 筋肉）
//
// どんな体の形でも同じしくみで動く:
//   1) リズム（CPG, 中枢パターン発生器）
//      すべての関節の軸ごとに「目標の角度」を、共通のリズム φ のフーリエ級数で作る
//        θ* = o + a1 sin φ + b1 cos φ + a2 sin 2φ + b2 cos 2φ
//      左右の相方は同じ遺伝子を使い、半周期（Δ）ずらす → 左右交互の歩き方が自然に生まれる
//   2) 平衡感覚（前庭）
//      胴の傾き・傾く速さ・速すぎ/遅すぎ・向きのずれ を「必要な立て直しの回転」ε にまとめ、
//      各関節の軸への射影 (ε · e) に、足が地面についているか（立脚/遊脚）で違う重みをかけて目標に足す
//      → 軸の向きで自動的に効き方が決まるので、四つ足でも二足でも同じ遺伝子の形で使える
//   3) 脊髄反射（サブステップごと）
//      目標とのずれから必要なトルク τ* = K(θ* − θ) − D θ' を計算し、
//      「その向きに引ける筋肉」に、いまの長さ・速さで出せる力の割合で割りふる
//   4) 着地でリズムをそろえる（位相のリセット）
//      足が地面についた瞬間に、リズムの位相を「その足が着地するはずの位相」へ少し引きよせる
//      → 歩幅が乱れても、リズムが体の動きに合わせて自然に立ち直る
//   遺伝子の一覧（1グループ = 左右の相方をまとめた1つの軸）:
//      全体: リズムの速さ, 左右のずれ Δ, 速さの感覚, 傾く速さの感覚, めざす速さ, 重心のずれの感覚, 着地のそろえ
//      各グループ: o, a1, b1, a2, b2, かたさ, 同時収縮, 立脚の平衡, 遊脚の平衡, 遊脚のときの姿勢
//      足の組ごと: 着地する位相

import { dsin, dcos, dexp, datan2, TWO_PI, PI } from './dmath.js';
import { mimicMap, refAt } from './gait.js';

export const G_GLOBAL = 7;
export const G_PER = 10;
export const GENE_NAMES_GLOBAL = ['リズムの速さ', '左右のずれ', '速さの感覚', '傾く速さの感覚', 'めざす速さ', '重心のずれの感覚', '着地のそろえ'];
export const GENE_NAMES_PER = ['姿勢', 'ゆれ1', 'ゆれ1′', 'ゆれ2', 'ゆれ2′', 'かたさ', '力み', '立脚の平衡', '遊脚の平衡', '足を上げる'];

export function geneCount(model) { return G_GLOBAL + G_PER * model.nGroup + (model.nFootPair || 0); }

const sat = (x) => x / (1 + (x < 0 ? -x : x));   // なめらかな飽和 (-1..1)

export class Nerves {
  constructor(model, genes, opts = {}) {
    this.model = model;
    this.genes = genes;
    this.opts = opts;
    const nd = model.nDof, G = model.nGroup;
    this.nd = nd;
    const g = (i) => (i < genes.length ? genes[i] : 0);
    // 全体（体の大きさで割って、小さな虫でも大きなヒトでも同じ遺伝子の意味になるように）
    const Hn = Math.max(0.08, model.size.h), gH = Math.sqrt(9.81 * Hn), tH = Math.sqrt(Hn / 9.81);
    let freq = 0.35 / tH * dexp(0.5 * g(0));
    this.freq = freq < 0.25 ? 0.25 : freq > 4 ? 4 : freq;
    this.delta = PI + 1.0 * g(1);
    this.cv = (0.8 + 0.4 * g(2)) / gH;
    this.cw = 0.3 * tH * dexp(0.5 * g(3));
    this.vstar = opts.vstar !== undefined ? opts.vstar : 0.25 * gH * dexp(0.5 * g(4));
    this.cd = opts.noCd ? 0 : (1.0 + 0.5 * g(5)) / Hn;
    const kp = 0.7 * sat(g(6));
    this.kappa = opts.noReset || kp < 0 ? 0 : kp;   // 0 = そろえない（はじめは0。進化で使うようになる）
    // 足の組ごとの着地の位相
    const fp0 = G_GLOBAL + G_PER * model.nGroup;
    this.feet = (model.feet || []).map(f => ({ i: f.i, sec: f.sec, phi: PI * (f.pair % 2) + PI * g(fp0 + f.pair), air: 0, on: 1 }));
    // 足の組ごとの「振り出しの位相」（脚の軸は、この位相のまわり半周期のあいだ「振り出しの姿勢」をとる）
    this.legPair = new Int32Array(model.nDof).fill(-1);
    // はじめは、となりあう足の組を半周期ずらす（四つ足なら対角の足がそろう「はやあし」、六本足なら三脚歩行）
    this.pairPsi = (model.feet || []).filter(f => !f.sec).map(f => PI * (f.pair % 2) + PI * g(fp0 + f.pair));
    this.cmdSwing = !opts.contactSwing;
    this.sup = [0, 0];       // 支え（地面についている所）の中心
    this.supOk = false;
    this.H = Math.max(0.1, model.size.h);
    // 自由度ごと
    this.o = new Float64Array(nd); this.a1 = new Float64Array(nd); this.b1 = new Float64Array(nd);
    this.a2 = new Float64Array(nd); this.b2 = new Float64Array(nd);
    this.K = new Float64Array(nd); this.D = new Float64Array(nd);
    this.Ksw = new Float64Array(nd); this.Dsw = new Float64Array(nd);
    this.osw = new Float64Array(nd); this.swS = new Float64Array(nd);
    this.cc = new Float64Array(nd); this.kst = new Float64Array(nd); this.ksw = new Float64Array(nd);
    this.ph = new Float64Array(nd); this.ms = new Float64Array(nd);
    this.lo = new Float64Array(nd); this.hi = new Float64Array(nd);
    this.target = new Float64Array(nd);
    this.tau = new Float64Array(nd);
    const stiff = opts.stiffness || 1.3;
    const amp = opts.amp || 0.45;
    // 筋肉の反応の速さ: 小さな体ほど速い（ヒトの大きさで 25ms、虫の大きさで 7ms ほど）
    const Hs = Math.max(0.05, model.size.h);
    this.tauAct = opts.tauAct || Math.max(0.006, Math.min(0.025, 0.025 * Math.sqrt(Hs / 1.7)));
    for (const d of model.dofs) {
      const b = G_GLOBAL + G_PER * d.group;
      const W = Math.max(0.05, (d.hi - d.lo) / 2);
      const s = d.msign;
      this.o[d.i] = s * 0.35 * W * g(b);
      this.a1[d.i] = s * amp * W * g(b + 1);
      this.b1[d.i] = s * amp * W * g(b + 2);
      this.a2[d.i] = s * 0.5 * amp * W * g(b + 3);
      this.b2[d.i] = s * 0.5 * amp * W * g(b + 4);
      const pr = opts.noPrior ? { st: 0, sw: 0, osw: 0 } : (d.prior || { st: 0, sw: 0, osw: 0 });
      this.osw[d.i] = opts.noSwingOff ? 0 : pr.osw + s * 0.4 * W * g(b + 9);
      for (const f of model.feet || []) if (d.sub.includes(f.i)) { this.legPair[d.i] = f.pair; break; }
      const kp = dexp(0.6 * g(b + 5));
      const Tref = (d.Tpos + d.Tneg) / 2;
      this.K[d.i] = stiff * kp * Tref / 0.5;
      this.D[d.i] = 2 * 0.5 * Math.sqrt(this.K[d.i] * d.Ieff);
      // 足が宙にあるときのかたさの上限: 筋肉の反応の遅れより速くゆれないように（軽い足先のふるえ止め）
      const wc = (opts.wcap || 1.5) / this.tauAct;
      this.Ksw[d.i] = Math.min(this.K[d.i], d.Ieff * wc * wc);
      this.Dsw[d.i] = 2 * 0.5 * Math.sqrt(this.Ksw[d.i] * d.Ieff);
      this.cc[d.i] = 0.05 * (1 + sat(g(b + 6)));
      this.kst[d.i] = pr.st + 0.6 * g(b + 7);
      this.ksw[d.i] = pr.sw + 0.6 * g(b + 8);
      this.ph[d.i] = d.secondary ? this.delta : 0;
      this.lo[d.i] = d.lo; this.hi[d.i] = d.hi;
    }
    // 筋肉の同時収縮（その筋肉がまたぐ自由度の平均）
    const nm = model.muscles.length;
    this.mcc = new Float64Array(nm);
    model.muscles.forEach((m, k) => {
      let s = 0, n = 0;
      for (const a of m.arms) { s += this.cc[a.dof]; n++; }
      this.mcc[k] = n ? s / n : 0.02;
    });
    // 筋肉→自由度（てこの長さ）を平らな配列に
    let na = 0;
    for (const m of model.muscles) na += m.arms.length;
    this.armStart = new Int32Array(nm + 1);
    this.armDof = new Int32Array(na);
    this.armR = new Float64Array(na);
    let k = 0;
    model.muscles.forEach((m, i) => {
      this.armStart[i] = k;
      for (const a of m.arms) { this.armDof[k] = a.dof; this.armR[k] = a.r; k++; }
    });
    this.armStart[nm] = k;
    this.Tp = new Float64Array(nd); this.Tn = new Float64Array(nd);
    // 立脚の判定に使う部分木
    this.dofSub = model.dofs.map(d => Int32Array.from(d.sub));
    this.stance = new Uint8Array(nd);
    // 感覚に使う体（胴）
    const S = model.bodies[model.sense];
    const q0 = S.q0;
    // 設計時の「上」と「前」を、その骨のローカル座標で
    this.upL = invRot(q0, [0, 1, 0]);
    // 脚のつけ根（親が胴の骨）: 足が宙にあるとき、親の骨の傾きを打ち消して「地面に対して」の角度で脚を振る
    this.wfParent = new Int32Array(nd).fill(-1);
    this.wfUp = new Map();
    if (!opts.noWorldSwing) {
      for (const d of model.dofs) {
        if (!d.proximal) continue;
        const jo = model.joints[d.joint];
        const P = model.bodies[jo.parent];
        this.wfParent[d.i] = jo.parent;
        if (!this.wfUp.has(jo.parent)) this.wfUp.set(jo.parent, invRot(P.q0, [0, 1, 0]));
      }
    }
    this.wfEps = new Map();
    this.fwdL = invRot(q0, [1, 0, 0]);
    this.phase = 0;
    this.eps = new Float64Array(3);
    this.epsS = new Float64Array(3);
    this.split = !opts.noSplit;
    this.goal = [1, 0, 0];          // めざす向き（水平）

    this.assist = 0;                // 支えの手 0..1
    this.assistWork = 0;
    this.tilt = 0;                  // 胴の傾き（rad）
    this.headingErr = 0;
    this.comV = [0, 0, 0];
    this.com = [0, 0, 0];
    this.knock = new Uint8Array(nd);  // しゅじゅつ（この軸の神経を止める）
    this.fvComp = !!opts.fvComp;
    // お手本をまねる（「ヒトの歩き方をまねる」のとき）: 股・ひざ・足首の目標に、ヒトの歩行の角度を足す
    this.mimic = opts.mimic ? mimicMap(model) : [];
    this.stanceTorso = !!opts.stanceTorso;
    this.rampT = opts.rampT || 0.8;
    // 足首の立ち直り（実験）
    if (opts.anklePrior) for (const d of model.dofs) {
      if (d.leg && !d.proximal && model.feet.some(f => f.i === model.joints[d.joint].child)) this.kst[d.i] += opts.anklePrior;
    }
    this.kstT = opts.kstT !== undefined ? opts.kstT : -1;
    this.mimicOf = new Int32Array(nd).fill(-1);
    this.mimic.forEach((m, k) => {
      this.mimicOf[m.dof] = k;
      this.osw[m.dof] -= (model.dofs[m.dof].prior ? model.dofs[m.dof].prior.osw : 0);   // 足ぶみ反射のかわりにお手本
    });
  }

  // ── 60Hz: 脳と平衡感覚 → 目標の角度 ──
  think(c, dt) {
    const model = this.model, S = model.sense;
    // 重心と速度
    let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < c.n; i++) {
      const m = c.mass[i];
      M += m; cx += m * c.pos[3 * i]; cy += m * c.pos[3 * i + 1]; cz += m * c.pos[3 * i + 2];
      vx += m * c.v[3 * i]; vy += m * c.v[3 * i + 1]; vz += m * c.v[3 * i + 2];
    }
    this.com[0] = cx / M; this.com[1] = cy / M; this.com[2] = cz / M;
    this.comV[0] = vx / M; this.comV[1] = vy / M; this.comV[2] = vz / M;
    // 胴の「上」と「前」
    const qo = 4 * S;
    const u = rotArr(c.q, qo, this.upL), f = rotArr(c.q, qo, this.fwdL);
    // 2つの「立て直しの回転」:
    //   εB（姿勢）… 胴の傾きと、傾く速さ。地面についている脚と、胴の関節が使う（胴をまっすぐに）
    //   εS（踏みだし）… 速すぎ／遅すぎと、重心が支えからずれている量。宙にある脚が使う（足を置く場所）
    // 傾き: u × Y = (-u_z, 0, u_x)
    let ex = -u[2], ey = 0, ez = u[0];
    this.tilt = datan2(Math.sqrt(u[0] * u[0] + u[2] * u[2]), u[1]);
    // 傾く速さ（水平成分）
    const wx = c.w[3 * S], wz = c.w[3 * S + 2];
    ex -= this.cw * wx; ez -= this.cw * wz;
    // 速さのずれ: (v - v* g) × Y = (-(v_z - v* g_z), 0, (v_x - v* g_x))
    const gx = this.goal[0], gz = this.goal[2];
    const evx = this.comV[0] - this.vstar * gx, evz = this.comV[2] - this.vstar * gz;
    let sx_ = -this.cv * evz, sz_ = this.cv * evx;
    // 重心と支えのずれ
    let sx = 0, sz = 0, ns = 0;
    for (let i = 0; i < c.n; i++) if (c.contact[i]) { sx += c.pos[3 * i]; sz += c.pos[3 * i + 2]; ns++; }
    if (ns) { this.sup[0] = sx / ns; this.sup[1] = sz / ns; this.supOk = true; }
    if (this.supOk && this.cd !== 0) {
      let dx = this.com[0] - this.sup[0], dz = this.com[2] - this.sup[1];
      const L = this.H;
      dx = dx > L ? L : dx < -L ? -L : dx; dz = dz > L ? L : dz < -L ? -L : dz;
      sx_ -= this.cd * dz; sz_ += this.cd * dx;
    }
    if (this.split) { this.epsS[0] = sx_; this.epsS[2] = sz_; }
    else { ex += sx_; ez += sz_; this.epsS[0] = 0; this.epsS[2] = 0; }
    // 向きのずれ（上から見て、目標の向きへ回るのに必要な角度）
    const fh = Math.sqrt(f[0] * f[0] + f[2] * f[2]);
    let yaw = 0;
    if (fh > 1e-6) yaw = datan2(f[2] * gx - f[0] * gz, f[0] * gx + f[2] * gz);
    // yaw = 前の向き f を目標の向き g に回すのに必要な、+Y 軸まわりの回転
    this.headingErr = yaw;
    ey = 0.5 * (yaw > 0.6 ? 0.6 : yaw < -0.6 ? -0.6 : yaw);
    this.eps[0] = ex; this.eps[1] = ey; this.eps[2] = ez;
    // リズム（はじめの0.8秒で、ゆっくり動きはじめる）
    this.tick = (this.tick || 0) + 1;
    this.time = (this.time || 0) + dt;
    const RT = this.rampT;
    this.ramp = this.time >= RT ? 1 : this.time / RT;
    this.swA = dt > 0 ? 1 - dexp(-dt / 0.05) : 0;
    this.phase += TWO_PI * this.freq * dt;
    // 着地でリズムをそろえる
    if (this.kappa > 0) {
      for (const f of this.feet) {
        const on = c.contact[f.i];
        if (on && !f.on && f.air > 6) {
          let err = f.phi + (f.sec ? this.delta : 0) - this.phase;
          err -= TWO_PI * Math.floor((err + PI) / TWO_PI);
          this.phase += this.kappa * err;
          this.resets = (this.resets || 0) + 1;
        }
        f.air = on ? 0 : f.air + 1;
        f.on = on;
      }
    }
    if (this.phase > TWO_PI) this.phase -= TWO_PI;
    if (this.phase < 0) this.phase += TWO_PI;
    // 目標の角度
    for (const d of model.dofs) {
      const i = d.i;
      if (this.knock[i]) { this.target[i] = c.jang[3 * d.joint + d.axis]; continue; }
      const p = this.phase + this.ph[i];
      const s1 = dsin(p), c1 = dcos(p), s2 = 2 * s1 * c1, c2 = c1 * c1 - s1 * s1;
      const rp = this.ramp;
      let th = this.o[i] + rp * (this.a1[i] * s1 + this.b1[i] * c1 + this.a2[i] * s2 + this.b2[i] * c2);
      const mk = this.mimicOf[i];
      let mref = 0;
      if (mk >= 0) {
        const m = this.mimic[mk];
        const lp = this.legPair[i];
        let q = (p - (lp >= 0 ? this.pairPsi[lp] : 0)) / TWO_PI;
        q -= Math.floor(q);
        mref = rp * m.sign * refAt(m.kind, q * 100) * (PI / 180);
      }
      // 立脚か遊脚か
      let st = 0;
      const sub = this.dofSub[i];
      for (let k = 0; k < sub.length; k++) if (c.contact[sub[k]]) { st = 1; break; }
      this.stance[i] = st;
      // 足が宙にあるときの姿勢（なめらかに切りかえる）: ひざを曲げて足を上げる、など
      this.swS[i] += ((st ? 0 : 1) - this.swS[i]) * this.swA;
      const lp = this.legPair[i];
      if (lp >= 0 && this.cmdSwing) {
        // 脚: リズムが「振り出し」の半周期のあいだ、振り出しの姿勢へ（ひざを曲げて足を上げ、前へ出す…は進化が決める）
        let w = 1.6 * dsin(p - this.pairPsi[lp]) - 0.15;
        w = w < 0 ? 0 : w > 1 ? 1 : w;
        th += this.osw[i] * w * rp;
      } else th += this.osw[i] * this.swS[i];
      // 平衡: ε を、いまのこの軸の向き（親の関節座標）に射影
      const jo = model.joints[d.joint];
      const ax = axisWorld(c, jo, d.axis);
      const proj = this.eps[0] * ax[0] + this.eps[1] * ax[1] + this.eps[2] * ax[2];
      if (mk >= 0) th += this.stanceTorso && d.proximal ? mref * this.swS[i] : mref;
      if (st) th += (this.stanceTorso && d.proximal && mk >= 0 ? this.kstT : this.kst[i]) * proj;
      else if (d.leg && this.split) th += this.ksw[i] * (this.epsS[0] * ax[0] + this.epsS[2] * ax[2]);
      else th += this.ksw[i] * proj;
      const wp = this.wfParent[i];
      if (wp >= 0 && !st) {
        let e = this.wfEps.get(wp);
        if (!e || e.f !== this.tick) {
          const u = rotArr(c.q, 4 * wp, this.wfUp.get(wp));
          e = { f: this.tick, x: -u[2], z: u[0] };
          this.wfEps.set(wp, e);
        }
        th += this.swS[i] * (e.x * ax[0] + e.z * ax[2]);
      }
      if (th < this.lo[i]) th = this.lo[i]; else if (th > this.hi[i]) th = this.hi[i];
      this.target[i] = th;
    }
  }

  // ── サブステップごと: 脊髄反射 → 筋肉の活性度 ──
  spinal(c, h) {
    const model = this.model;
    const nd = this.nd, tau = this.tau, Tp = this.Tp, Tn = this.Tn;
    for (let i = 0; i < nd; i++) {
      const d = model.dofs[i];
      const th = c.jang[3 * d.joint + d.axis], om = c.jvel[3 * d.joint + d.axis];
      tau[i] = this.knock[i] ? 0 : this.stance[i] ? this.K[i] * (this.target[i] - th) - this.D[i] * om
        : this.Ksw[i] * (this.target[i] - th) - this.Dsw[i] * om;
      Tp[i] = 1e-6; Tn[i] = 1e-6;
    }
    const nm = c.nm, aS = this.armStart, aD = this.armDof, aR = this.armR;
    for (let m = 0; m < nm; m++) {
      // 速さの特性（縮むほど力が落ちる）は補わない → 筋肉そのものが自然なブレーキになる
      let fv = c.mFV[m]; if (fv < 0.05) fv = 0.05;
      const F = c.mFmax[m] * c.mFL[m] * (this.fvComp ? fv : 1);
      for (let k = aS[m]; k < aS[m + 1]; k++) {
        const r = aR[k];
        if (r > 0) Tp[aD[k]] += F * r; else Tn[aD[k]] -= F * r;
      }
    }
    const a = 1 - dexp(-h / this.tauAct);
    const act = c.act;
    for (let m = 0; m < nm; m++) {
      let u = this.mcc[m];
      for (let k = aS[m]; k < aS[m + 1]; k++) {
        const r = aR[k], T = tau[aD[k]];
        if (r > 0) { if (T > 0) u += T / Tp[aD[k]]; }
        else if (T < 0) u -= T / Tn[aD[k]];
      }
      if (u > 1) u = 1;
      act[m] += (u - act[m]) * a;
    }
  }

  // ── 支えの手（胴を立たせる見えない手）。強さ this.assist ──
  support(c, h, restH) {
    const al = this.assist;
    if (al <= 0) return;
    const S = this.model.sense, M = this.model.mass;
    const u = rotArr(c.q, 4 * S, this.upL);
    const H = Math.max(0.15, restH);
    const Kt = al * M * 9.81 * H * 2.0;
    const Dt = al * M * H * H * 1.2;
    // 傾きを戻すトルク（水平軸のみ）
    const tx = -u[2] * Kt - Dt * c.w[3 * S];
    const tz = u[0] * Kt - Dt * c.w[3 * S + 2];
    c.t[3 * S] += tx; c.t[3 * S + 2] += tz;
    // 沈みこみを支える力
    const y = c.pos[3 * S + 1];
    let lift = 0;
    const drop = (restH - y) / (0.25 * H);
    if (drop > 0) lift = al * M * 9.81 * 0.6 * (drop > 1 ? 1 : drop) - al * M * 2 * c.v[3 * S + 1];
    if (lift > 0) c.f[3 * S + 1] += lift;
    this.assistWork += (Math.abs(tx) + Math.abs(tz)) * h * 0.02 + (lift > 0 ? lift : 0) * h * 0.01;
  }
}

// 親の関節座標の k 番目の軸（世界座標）
const AX = new Float64Array(4);
function axisWorld(c, jo, k) {
  const P = jo.parent, o = 4 * P;
  // FP = qP * qJP
  const q = c.q, a = jo.qJP;
  const w = q[o] * a[0] - q[o + 1] * a[1] - q[o + 2] * a[2] - q[o + 3] * a[3];
  const x = q[o] * a[1] + q[o + 1] * a[0] + q[o + 2] * a[3] - q[o + 3] * a[2];
  const y = q[o] * a[2] - q[o + 1] * a[3] + q[o + 2] * a[0] + q[o + 3] * a[1];
  const z = q[o] * a[3] + q[o + 1] * a[2] - q[o + 2] * a[1] + q[o + 3] * a[0];
  const v = k === 0 ? [1, 0, 0] : k === 1 ? [0, 1, 0] : [0, 0, 1];
  return rot4(w, x, y, z, v);
}
function rot4(w, x, y, z, v) {
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
function rotArr(q, o, v) { return rot4(q[o], q[o + 1], q[o + 2], q[o + 3], v); }
function invRot(q, v) { return rot4(q[0], -q[1], -q[2], -q[3], v); }
