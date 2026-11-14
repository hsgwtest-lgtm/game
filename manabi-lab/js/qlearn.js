// qlearn.js — 表形式のQ学習（純粋モジュール）
//   状況（状態）を 体力3 × 足元の草3 × 進む方向4 × においの強さ2 × 昼夜2 = 144通りに分け、
//   各状態で6つの行動それぞれの「良さ」Q(s,a) を表に持つ。
//   「進む方向」は、通れる方向のうちにおいがいちばん強い方向（同じなら、いま向いている方を優先）。
//   毎ターン: Q(s,a) ← Q(s,a) + α [ r + γ max Q(s',·) − Q(s,a) ]
//   r は体力の増減（食べれば＋、動けば−）。死んだら罰（DEATH_PENALTY）。
//   ε-greedy: 確率 ε でわざとでたらめな行動をとって試す（探索）
import { N_ACT, OBS } from './defs.js';

export const E_BINS = 3;
export const G_BINS = 3;
export const D_BINS = 4;
export const S_BINS = 2;
export const N_BINS = 2;
export const N_STATES = E_BINS * G_BINS * D_BINS * S_BINS * N_BINS; // 144
export const REWARD_SCALE = 0.1; // 体力1の増減を報酬0.1とする
export const DEATH_PENALTY = -3;
export const SCENT_MIN = 0.26; // これより弱いにおいは「うすい」

export const E_JA = ['腹ぺこ', 'ふつう', '満腹'];
export const G_JA = ['草なし', '少し', 'たっぷり'];
export const D_JA = ['北', '東', '南', '西'];
export const S_JA = ['うすい', 'におう'];
export const N_JA = ['昼', '夜'];

// 感覚（9つの数）と、いま向いている方向から、状態の番号 0〜143 を作る
export function stateOf(o, heading = 0) {
  const en = o[OBS.ENERGY];
  const e = en < 0.3 ? 0 : en < 0.7 ? 1 : 2;
  const gh = o[OBS.HERE];
  const g = gh < 0.08 ? 0 : gh < 0.4 ? 1 : 2;
  const h = heading >= 0 ? heading & 3 : 0;
  let dir = h;
  let bv = -2;
  for (let q = 0; q < 4; q++) {
    const d = (h + q) & 3;
    const v = o[OBS.SN + d];
    if (v > bv + 1e-9) {
      bv = v;
      dir = d;
    }
  }
  const str = bv >= SCENT_MIN ? 1 : 0;
  const n = o[OBS.DARK] > 0.5 ? 1 : 0;
  return stateIndex(e, g, dir, str, n);
}

export function stateIndex(e, g, d, st, n) {
  return (((e * G_BINS + g) * D_BINS + d) * S_BINS + st) * N_BINS + n;
}

export function stateParts(s) {
  const n = s % N_BINS;
  let r = (s - n) / N_BINS;
  const st = r % S_BINS;
  r = (r - st) / S_BINS;
  const d = r % D_BINS;
  r = (r - d) / D_BINS;
  const g = r % G_BINS;
  const e = (r - g) / G_BINS;
  return { e, g, d, st, n };
}

export function newTable() {
  return new Float32Array(N_STATES * N_ACT);
}

export function maxQ(q, s) {
  const b = s * N_ACT;
  let m = q[b];
  for (let a = 1; a < N_ACT; a++) if (q[b + a] > m) m = q[b + a];
  return m;
}

// いちばん良い行動（同点ならくじ引き）
export function greedy(q, s, rng) {
  const b = s * N_ACT;
  let m = q[b];
  let cnt = 1;
  let pick = 0;
  for (let a = 1; a < N_ACT; a++) {
    const v = q[b + a];
    if (v > m) {
      m = v;
      cnt = 1;
      pick = a;
    } else if (v === m) {
      cnt++;
      if (rng.next() * cnt < 1) pick = a;
    }
  }
  return pick;
}

// 同点も考えた「その行動がいちばん良いとされている度合い」（行動テスト用）
export function greedyShare(q, s, a) {
  const m = maxQ(q, s);
  const b = s * N_ACT;
  if (q[b + a] !== m) return 0;
  let cnt = 0;
  for (let k = 0; k < N_ACT; k++) if (q[b + k] === m) cnt++;
  return 1 / cnt;
}

export function epsGreedy(q, s, eps, rng) {
  if (rng.next() < eps) return rng.int(N_ACT);
  return greedy(q, s, rng);
}

// TD 更新。s2 < 0 は「終わり（死んだ）」。返り値は TD 誤差
export function tdUpdate(q, s, a, r, s2, alpha, gamma) {
  const i = s * N_ACT + a;
  const target = s2 < 0 ? r : r + gamma * maxQ(q, s2);
  const err = target - q[i];
  q[i] += alpha * err;
  return err;
}

// 世代ごとの ε（だんだん試すのを減らす）
export function epsAt(gen, c) {
  return Math.max(c.epsMin, c.eps0 * Math.pow(c.epsDecay, gen));
}
