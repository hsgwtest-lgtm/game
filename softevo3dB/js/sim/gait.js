// 歩き方の分析
//  ・足（地面につく先端の骨）ごとの接地の記録 → 歩き方の型（なみあし・はやあし・ギャロップ・はねる・くねる…）
//  ・二本足なら、股関節・ひざ・足首の角度を「1歩の周期」でそろえて平均し、ヒトの代表的な曲線とくらべる
// ヒトの曲線は、教科書でよく示される平らな地面での歩行（約1.3m/s）の代表的な形を簡略化したもの。

import { FPS } from './physics.js';
import { dsin, dcos, datan2, dexp, TWO_PI } from './dmath.js';

// [周期の%, 角度(度)]
export const HUMAN_REF = {
  hip: [[0, 30], [10, 28], [20, 20], [30, 12], [40, 4], [50, -5], [55, -8], [60, -4], [65, 4], [70, 13], [75, 21], [80, 27], [85, 31], [90, 32], [95, 31], [100, 30]],
  knee: [[0, 5], [5, 12], [10, 17], [15, 18], [20, 15], [30, 9], [40, 5], [45, 4], [50, 6], [55, 12], [60, 25], [65, 42], [70, 56], [73, 60], [76, 61], [80, 56], [85, 43], [90, 25], [95, 9], [100, 5]],
  ankle: [[0, 0], [5, -4], [8, -6], [12, -3], [20, 2], [30, 6], [40, 9], [45, 10], [50, 8], [55, 1], [60, -10], [63, -16], [66, -17], [70, -12], [75, -5], [80, -1], [85, 1], [90, 1], [95, 0], [100, 0]],
};
export const HUMAN_STATS = { cadence: 110, stride: 1.4, speed: 1.3, duty: 0.61 };

function sampleRef(pts, p) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (p <= x1) {
      // なめらかに（Catmull-Rom）
      const ym = i > 0 ? pts[i - 1][1] : y0, yp = i + 2 < pts.length ? pts[i + 2][1] : y1;
      const t = (p - x0) / (x1 - x0 || 1);
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * y0) + (-ym + y1) * t + (2 * ym - 5 * y0 + 4 * y1 - yp) * t2 + (-ym + 3 * y0 - 3 * y1 + yp) * t3);
    }
  }
  return pts[pts.length - 1][1];
}
export function refCurve(key, n = 101) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = sampleRef(HUMAN_REF[key], (i / (n - 1)) * 100);
  return out;
}

// 二本足の脚（股→ひざ→足首）を見つける
export function findLegs(model) {
  const root = 0;
  const legs = [];
  for (const jo of model.joints) {
    if (jo.parent !== root) continue;
    // その先で地面に届くか（いちばん低い骨まで3関節以内）
    const chain = [jo];
    let b = jo.child;
    while (model.bodies[b].children.length === 1 && chain.length < 3) {
      const nb = model.bodies[b].children[0];
      chain.push(model.joints[model.jointOfBody[nb]]);
      b = nb;
    }
    const tip = model.bodies[b];
    if (tip.c[1] > model.size.h * 0.15 + model.minY) continue;
    if (chain.length < 2) continue;
    legs.push({ hip: chain[0], knee: chain[1], ankle: chain[2] || null, foot: b, side: Math.sign(tip.c[2]) });
  }
  return legs;
}

// 腕: 胴（根もと→平衡感覚の骨）から生えた、左右の相方のいる、地面に届かない枝のつけ根
export function findArms(model) {
  const trunk = new Set();
  for (let b = model.sense; b >= 0; b = model.bodies[b].parent) trunk.add(b);
  const feet = new Set((model.feet || []).map(f => f.i));
  const out = [];
  for (const jo of model.joints) {
    if (!trunk.has(jo.parent) || trunk.has(jo.child)) continue;
    const C = model.bodies[jo.child];
    if (C.mirror < 0) continue;
    const sub = [jo.child];
    for (let k = 0; k < sub.length; k++) sub.push(...model.bodies[sub[k]].children);
    if (sub.some(b => feet.has(b) || model.bodies[b].lowY < model.minY + 0.15 * model.size.h)) continue;
    if (jo.dofs[1] < 0) continue;
    out.push(jo);
  }
  return out;
}

// お手本（ヒトの歩行）を当てはめる関節: 股・ひざ・足首の「曲げ」の軸
//   向き（どちらが曲げか）は、足を持ちあげる向き（model の生まれつきの反射）から決める
export function mimicMap(model) {
  const legs = findLegs(model);
  if (legs.length !== 2 || legs[0].side === legs[1].side) return [];
  const out = [];
  for (const L of legs) {
    for (const [kind, jo] of [['hip', L.hip], ['knee', L.knee], ['ankle', L.ankle]]) {
      if (!jo) continue;
      const di = jo.dofs[0];
      if (di < 0) continue;
      const d = model.dofs[di];
      const sg = d.prior && d.prior.osw ? Math.sign(d.prior.osw) : (kind === 'knee' ? -1 : 1);
      out.push({ dof: di, kind, sign: sg });
    }
  }
  return out;
}
// 0..100% の周期での、お手本の角度（度）
const REF_TABLE = {};
export function refAt(kind, pct) {
  let t = REF_TABLE[kind];
  if (!t) t = REF_TABLE[kind] = refCurve(kind, 101);
  const x = pct < 0 ? 0 : pct > 100 ? 100 : pct;
  const i = Math.floor(x), f = x - i;
  return i >= 100 ? t[100] : t[i] * (1 - f) + t[i + 1] * f;
}

export class GaitRecorder {
  constructor(model, maxFrames = 1800) {
    this.model = model;
    this.n = 0;
    this.max = maxFrames;
    this.contact = new Uint8Array(model.n * maxFrames);
    this.x = new Float32Array(maxFrames);
    this.legs = findLegs(model);
    this.biped = this.legs.length === 2 && this.legs[0].side !== this.legs[1].side;
    this.ang = this.legs.map(() => ({ hip: new Float32Array(maxFrames), knee: new Float32Array(maxFrames), ankle: new Float32Array(maxFrames) }));
    // 曲げの向き（足を持ちあげる向きを＋に）
    const sg = (jo, def) => { if (!jo || jo.dofs[0] < 0) return def; const d = model.dofs[jo.dofs[0]]; return d.prior && d.prior.osw ? Math.sign(d.prior.osw) : def; };
    this.signs = this.legs.map(L => ({ hip: sg(L.hip, 1), knee: sg(L.knee, -1), ankle: sg(L.ankle, 1) }));
    this.arms = findArms(model);
    this.armAbd = 0; this.armN = 0;
    this.phase = new Float64Array(maxFrames);
  }
  record(ep) {
    if (this.n >= this.max) return;
    const c = ep.c, f = this.n, n = this.model.n;
    for (let i = 0; i < n; i++) this.contact[f * n + i] = c.contact[i];
    this.x[f] = ep.nerves.com[0];
    this.phase[f] = ep.nerves.phase;
    const D = 180 / Math.PI;
    this.legs.forEach((L, k) => {
      const A = this.ang[k], S = this.signs[k];
      A.hip[f] = S.hip * c.jang[3 * L.hip.i] * D;
      A.knee[f] = S.knee * c.jang[3 * L.knee.i] * D;
      A.ankle[f] = L.ankle ? S.ankle * c.jang[3 * L.ankle.i] * D : 0;
    });
    for (const jo of this.arms) { const a = c.jang[3 * jo.i + 1] * D; this.armAbd += a < 0 ? -a : a; this.armN++; }
    this.n++;
  }

  // 足の接地の型
  analyze() {
    const model = this.model, n = model.n, F = this.n;
    if (F < FPS * 2) return null;
    const start = Math.floor(F * 0.3);   // はじめの立ち上がりは除く
    // 足 = 接地の多い、末端（子のない）骨
    const feet = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) continue;
      let cnt = 0;
      for (let f = start; f < F; f++) cnt += this.contact[f * n + i];
      const frac = cnt / (F - start);
      if (frac > 0.05 && model.bodies[i].children.length === 0) feet.push({ i, duty: frac });
    }
    const bellyDrag = (() => { let cnt = 0; for (let f = start; f < F; f++) cnt += this.contact[f * n]; return cnt / (F - start); })();
    // 足ごとの接地の始まり（着地）
    for (const ft of feet) {
      ft.strikes = [];
      let prev = 1, off = 0;
      for (let f = start; f < F; f++) {
        const c = this.contact[f * n + ft.i];
        if (!c) off++;
        if (c && !prev && off > 4) { ft.strikes.push(f); off = 0; }
        prev = c;
      }
    }
    const period = (() => {
      const ps = [];
      for (const ft of feet) for (let k = 1; k < ft.strikes.length; k++) ps.push(ft.strikes[k] - ft.strikes[k - 1]);
      if (!ps.length) return 0;
      ps.sort((a, b) => a - b);
      return ps[Math.floor(ps.length / 2)];
    })();
    // 足どうしの位相差（0..1）
    const phaseOf = (a, b) => {
      if (!period || !a.strikes.length || !b.strikes.length) return null;
      const s = a.strikes[0];
      let best = 1e9;
      for (const t of b.strikes) { const d = ((t - s) % period + period) % period; best = Math.min(best, d); }
      return best / period;
    };
    let air = 0;
    for (let f = start; f < F; f++) {
      let any = 0;
      for (let i = 0; i < n; i++) if (this.contact[f * n + i]) { any = 1; break; }
      if (!any) air++;
    }
    const airFrac = air / (F - start);
    const dist = this.x[F - 1] - this.x[start];
    const speed = dist / ((F - start) / FPS);
    const type = classify(feet, period, phaseOf, airFrac, bellyDrag, model, this);
    const out = { feet, period: period / FPS, airFrac, speed, type, bellyDrag };
    if (period) {
      out.cadence = 60 / (period / FPS) * Math.max(1, Math.min(2, feet.length));
      out.stride = speed * period / FPS;
    }
    if (this.biped) out.human = this.compareHuman(start);
    return out;
  }

  // ヒトとくらべる（左足の着地から次の着地までを1周期とする）
  compareHuman(start) {
    // 1歩の周期は、神経のリズム（位相）でそろえる。足が地面につく瞬間の位相を「かかとの着地」= 0% とする
    const leg = this.legs[0], k = 0;
    const n = this.model.n, F = this.n;
    if (F - start < FPS * 1.5) return null;
    let sx = 0, sy = 0, ns = 0, prev = 1, off = 0;
    for (let f = start; f < F; f++) {
      const c = this.contact[f * n + leg.foot];
      if (!c) off++;
      if (c && !prev && off > 4) { sx += dcos(this.phase[f]); sy += dsin(this.phase[f]); ns++; off = 0; }
      prev = c;
    }
    if (ns < 2) return null;
    const hs = datan2(sy, sx);
    const N = 101;
    const sum = { hip: new Float64Array(N), knee: new Float64Array(N), ankle: new Float64Array(N) };
    const cnt = new Float64Array(N);
    let wraps = 0;
    for (let f = start; f < F; f++) {
      let q = (this.phase[f] - hs) / TWO_PI;
      q -= Math.floor(q);
      const b = Math.min(N - 1, Math.round(q * (N - 1)));
      cnt[b]++;
      for (const key of ['hip', 'knee', 'ankle']) sum[key][b] += this.ang[k][key][f];
      if (f > start && this.phase[f] < this.phase[f - 1] - 3) wraps++;
    }
    const res = { cycles: wraps, curves: {}, ref: {}, score: {}, total: 0 };
    const keys = ['hip', 'knee', 'ankle'];
    const curves = {};
    for (const key of keys) {
      const cv = new Float64Array(N);
      // 空の区間は、となりから補う
      for (let i = 0; i < N; i++) cv[i] = cnt[i] ? sum[key][i] / cnt[i] : NaN;
      for (let i = 0; i < N; i++) if (Number.isNaN(cv[i])) {
        let a = i - 1, b = i + 1;
        while (a >= 0 && Number.isNaN(cv[a])) a--;
        while (b < N && Number.isNaN(cv[b])) b++;
        cv[i] = a >= 0 && b < N ? (cv[a] + cv[b]) / 2 : a >= 0 ? cv[a] : b < N ? cv[b] : 0;
      }
      const sm = new Float64Array(N);
      for (let i = 0; i < N; i++) sm[i] = (cv[(i + N - 1) % N] + 2 * cv[i] + cv[(i + 1) % N]) / 4;
      curves[key] = sm;
    }
    // 足の着地がはっきりしないこともあるので、3つの関節に共通の「ずらし」を、ヒトの曲線にいちばん合うように選ぶ
    const refs = {};
    for (const key of keys) refs[key] = refCurve(key, N);
    const corrAt = (a, b, sh) => {
      let ma = 0, mb = 0;
      for (let i = 0; i < N - 1; i++) { ma += a[(i + sh) % (N - 1)]; mb += b[i]; }
      ma /= N - 1; mb /= N - 1;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < N - 1; i++) { const dx = a[(i + sh) % (N - 1)] - ma, dy = b[i] - mb; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      return sxx > 1e-9 && syy > 1e-9 ? sxy / Math.sqrt(sxx * syy) : 0;
    };
    let bestSh = 0, bestC = -1e9;
    for (let sh = 0; sh < N - 1; sh += 2) {
      let cc = 0;
      for (const key of keys) cc += corrAt(curves[key], refs[key], sh);
      if (cc > bestC) { bestC = cc; bestSh = sh; }
    }
    res.shift = bestSh;
    let tot = 0;
    for (const key of keys) {
      const ref = refs[key];
      const sm = new Float64Array(N);
      for (let i = 0; i < N; i++) sm[i] = curves[key][(i + bestSh) % (N - 1)];
      res.curves[key] = Array.from(sm);
      res.ref[key] = Array.from(ref);
      // 形の似かた（相関）と大きさの近さ（ずれの大きさ）
      let mc = 0, mr = 0;
      for (let i = 0; i < N; i++) { mc += sm[i]; mr += ref[i]; }
      mc /= N; mr /= N;
      let sxy = 0, sxx = 0, syy = 0, se = 0;
      for (let i = 0; i < N; i++) {
        const dx = sm[i] - mc, dy = ref[i] - mr;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
        se += (sm[i] - ref[i]) * (sm[i] - ref[i]);
      }
      const r = sxx > 1e-9 && syy > 1e-9 ? sxy / Math.sqrt(sxx * syy) : 0;
      const rms = Math.sqrt(se / N);
      const sc = 100 * (0.55 * Math.max(0, r) + 0.45 * dexp(-(rms / 18) * (rms / 18)));
      res.score[key] = { r, rms, score: sc };
      tot += sc;
    }
    res.total = tot / 3;
    // 腕: だらりと下ろしているほどヒトらしい（横に広げて釣り合いをとると減点）
    if (this.armN) {
      const abd = this.armAbd / this.armN;
      res.arm = { abd, score: 100 * dexp(-(abd / 30) * (abd / 30)) };
      res.total = 0.8 * res.total + 0.2 * res.arm.score;
    }
    return res;
  }
}

export const GAIT_NAMES = {
  stand: { name: 'たちどまる', desc: 'その場にとどまる' },
  crawl: { name: 'はいずる', desc: 'おなかを地面につけて進む' },
  wiggle: { name: 'くねる', desc: '体をくねらせて進む' },
  roll: { name: 'ころがる', desc: '体ごと回って進む' },
  walk: { name: 'あるく', desc: 'いつもどれかの足が地面についている' },
  trot: { name: 'はやあし', desc: '対角線の足をそろえて動かす' },
  pace: { name: 'そくたい', desc: '同じ側の前後の足をそろえる' },
  bound: { name: 'バウンド', desc: '左右をそろえ、前と後ろで交互にはねる' },
  gallop: { name: 'ギャロップ', desc: '宙に浮きながらかけぬける' },
  pronk: { name: 'とびはね', desc: '全部の足でいっしょにはねる' },
  run: { name: 'はしる', desc: '両足が地面から離れる瞬間がある' },
  hop: { name: 'ホップ', desc: '両足をそろえてはねる' },
  biwalk: { name: '二足歩行', desc: '左右の足を交互について歩く' },
  swim: { name: 'およぐ', desc: '水をかいて進む' },
};

function classify(feet, period, phaseOf, airFrac, belly, model, rec) {
  if (Math.abs(rec.x[rec.n - 1] - rec.x[Math.floor(rec.n * 0.3)]) < 0.2) return 'stand';
  if (!feet.length || belly > 0.5) return feet.length >= 2 && !belly ? 'walk' : (belly > 0.5 ? (feet.length ? 'crawl' : 'wiggle') : 'wiggle');
  const duty = feet.reduce((a, f) => a + f.duty, 0) / feet.length;
  if (feet.length === 2) {
    // 片足だけが地面についている時間が長ければ「交互」、両足がそろって浮き沈みするなら「ホップ」
    const n = model.n, F = rec.n, st = Math.floor(F * 0.3);
    let single = 0;
    for (let f = st; f < F; f++) if (rec.contact[f * n + feet[0].i] !== rec.contact[f * n + feet[1].i]) single++;
    const sf = single / Math.max(1, F - st);
    if (sf < 0.12 && airFrac > 0.08) return 'hop';
    return airFrac > 0.1 && sf > 0.25 ? 'run' : 'biwalk';
  }
  if (feet.length >= 4) {
    // 前後・左右をきめる
    const B = model.bodies;
    const fr = feet.map(f => ({ ...f, x: B[f.i].c[0], z: B[f.i].c[2] }));
    fr.sort((a, b) => b.x - a.x);
    const front = fr.slice(0, 2), hind = fr.slice(-2);
    const [fl, frr] = front[0].z < front[1].z ? front : [front[1], front[0]];
    const [hl, hr] = hind[0].z < hind[1].z ? hind : [hind[1], hind[0]];
    const p = (a, b) => phaseOf(a, b);
    const near0 = (v) => v !== null && (v < 0.15 || v > 0.85);
    const lr = p(fl, frr), diag = p(fl, hr), ipsi = p(fl, hl);
    if (near0(lr) && near0(p(hl, hr)) && near0(ipsi)) return 'pronk';
    if (near0(lr) && near0(p(hl, hr))) return 'bound';
    if (near0(diag) && !near0(lr)) return airFrac > 0.1 ? 'trot' : (duty > 0.6 ? 'walk' : 'trot');
    if (near0(ipsi) && !near0(lr)) return 'pace';
    if (airFrac > 0.12) return 'gallop';
    return 'walk';
  }
  return airFrac > 0.15 ? 'gallop' : 'walk';
}
