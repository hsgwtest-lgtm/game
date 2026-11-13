// genetics.js — 形質（速さ・大きさ・視野・食性・耐寒性）の遺伝と突然変異、種の名前
import { clamp } from './util.js';

export const TRAIT_KEYS = ['speed', 'size', 'vision', 'diet', 'cold'];
export const TRAIT_JA = ['速さ', '大きさ', '視野', '食性', '耐寒性'];
export const TRAIT_MIN = [0.4, 0.5, 2, 0, 0];
export const TRAIT_MAX = [2.2, 2.0, 10, 1, 1];
export const TRAIT_N = 5;
export const TR = { SPEED: 0, SIZE: 1, VISION: 2, DIET: 3, COLD: 4 };

// 食性の意味は草食と肉食で違う（0 と 1 の両端の呼び名）
export const DIET_ENDS = [
  ['草', '木の実'],
  ['雑食', '肉食'],
];

const SPAN = TRAIT_MAX.map((v, i) => v - TRAIT_MIN[i]);

export function clampTraits(t) {
  for (let i = 0; i < TRAIT_N; i++) t[i] = clamp(t[i], TRAIT_MIN[i], TRAIT_MAX[i]);
  return t;
}

// 突然変異: 各形質を幅の4.5%くらいの正規分布でずらす（rate で強さを変えられる）
export function mutateTraits(t, rng, rate = 1) {
  const out = t.slice();
  for (let i = 0; i < TRAIT_N; i++) {
    if (rng.next() < 0.8) out[i] += rng.gauss() * 0.045 * SPAN[i] * rate;
  }
  return clampTraits(out);
}

// 交配: 形質ごとに父母のあいだのどこか
export function crossTraits(a, b, rng) {
  const out = new Array(TRAIT_N);
  for (let i = 0; i < TRAIT_N; i++) {
    const k = rng.next();
    out[i] = a[i] * k + b[i] * (1 - k);
  }
  return out;
}

// 形質どうしの離れ具合（各形質を幅で割ってから距離をとる）
export function traitDist(a, b) {
  let s = 0;
  for (let i = 0; i < TRAIT_N; i++) {
    const d = (a[i] - b[i]) / SPAN[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export function traitNorm(i, v) {
  return clamp((v - TRAIT_MIN[i]) / SPAN[i], 0, 1);
}

export function fmtTrait(i, v) {
  return i === TR.VISION ? v.toFixed(1) : v.toFixed(2);
}

// 種の名前: 目立つ形質を頭につける（例: ユキハヤウサギ）
const HERB_NOUN = [
  [0.72, 'ネズミ'],
  [1.08, 'ウサギ'],
  [1.45, 'ヤギ'],
  [9, 'シカ'],
];
const CARN_NOUN = [
  [0.82, 'イタチ'],
  [1.3, 'キツネ'],
  [9, 'オオカミ'],
];
const PLAIN = ['ソラ', 'ツキ', 'ホシ', 'コハク', 'ミナミ', 'キタ', 'ヒカリ', 'クリ', 'モモ', 'ハイイロ', 'シマ', 'ナギ'];

export function makeSpeciesName(cls, t, taken, rng) {
  const nouns = cls === 0 ? HERB_NOUN : CARN_NOUN;
  let noun = nouns[nouns.length - 1][1];
  for (const [lim, n] of nouns) {
    if (t[TR.SIZE] < lim) {
      noun = n;
      break;
    }
  }
  const cand = [];
  const z = (v, m, s) => (v - m) / s;
  const sp = z(t[TR.SPEED], 1.0, 0.25);
  if (sp > 1) cand.push([sp, 'ハヤ']);
  if (sp < -1) cand.push([-sp, 'ノロ']);
  const sz = z(t[TR.SIZE], 1.05, 0.3);
  if (sz > 1.2) cand.push([sz, 'オオ']);
  if (sz < -1.2) cand.push([-sz, 'チビ']);
  const vi = z(t[TR.VISION], 5.5, 1.4);
  if (vi > 1) cand.push([vi, 'トオミ']);
  if (vi < -1) cand.push([-vi, 'ネボケ']);
  const co = z(t[TR.COLD], 0.4, 0.17);
  if (co > 1) cand.push([co, 'ユキ']);
  if (co < -1) cand.push([-co, 'サバク']);
  if (cls === 0) {
    if (t[TR.DIET] > 0.62) cand.push([z(t[TR.DIET], 0.4, 0.2), 'モリ']);
    if (t[TR.DIET] < 0.22) cand.push([z(0.45, t[TR.DIET], 0.2), 'ノハラ']);
  } else if (t[TR.DIET] < 0.5) {
    cand.push([z(0.8, t[TR.DIET], 0.2), 'ナンデモ']);
  }
  cand.sort((a, b) => b[0] - a[0]);
  let base;
  if (cand.length === 0) base = rng.pick(PLAIN) + noun;
  else if (cand.length === 1) base = cand[0][1] + noun;
  else base = cand[0][1] + cand[1][1] + noun;
  if (!taken.includes(base)) return base;
  const roman = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  for (const r of roman) if (!taken.includes(base + r)) return base + r;
  return base + (taken.length + 1);
}
