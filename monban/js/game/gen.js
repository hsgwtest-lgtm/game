// 日替わり・夜勤のための、その場で作る出題
import { makeRng, hashStr } from '../ml/rng.js';
import { ruleText, ruleFeats } from './rules.js';

const T = (f, t, dir = 1) => ({ type: 'thr', f, t, dir });
const CONT = [0, 1, 3, 4, 5]; // 角（とびとびの値）以外
const thrOf = (rng, f) => (f === 2 ? rng.pick([0.4, 0.6]) : rng.range(0.4, 0.6));
const pickN = (rng, arr, n) => rng.shuffle(arr.slice()).slice(0, n);

// 難しさ tier（1〜4）ごとのルールのひな型。good はそのルールに向いた手法
const TEMPLATES = {
  1: [
    (r) => { const f = r.int(6); return { rule: T(f, thrOf(r, f), r() < 0.25 ? -1 : 1), good: ['linear', 'tree'] }; },
    (r) => ({ rule: { type: 'sum', fs: pickN(r, CONT, 2), t: 1.0 }, good: ['linear'] }),
  ],
  2: [
    (r) => { const [a, b] = pickN(r, [0, 1, 2, 3, 4, 5], 2); return { rule: { type: 'and', parts: [T(a, thrOf(r, a)), T(b, thrOf(r, b))] }, good: ['tree', 'forest'] }; },
    (r) => { const [a, b] = pickN(r, [0, 1, 2, 3, 4, 5], 2); return { rule: { type: 'or', parts: [T(a, thrOf(r, a) + 0.1), T(b, thrOf(r, b) + 0.1)] }, good: ['tree', 'forest'] }; },
    (r) => { const lo = r.range(0.25, 0.38); return { rule: { type: 'band', f: r.pick(CONT), lo, hi: lo + r.range(0.3, 0.38) }, good: ['tree', 'knn'] }; },
    (r) => ({ rule: { type: 'sum', fs: pickN(r, CONT, 3), t: 1.5 }, good: ['linear'] }),
    (r) => ({ rule: { type: 'sum', fs: pickN(r, CONT, 2), ws: [0.8, 0.2], t: 0.5 }, good: ['linear'] }),
  ],
  3: [
    (r) => ({ rule: { type: 'blob', fs: pickN(r, CONT, 2), c: [r.range(0.3, 0.7), r.range(0.3, 0.7)], r: r.range(0.25, 0.3) }, good: ['knn', 'forest'] }),
    (r) => { const [a, b] = pickN(r, CONT, 2); return { rule: { type: 'xor', parts: [T(a, 0.5), T(b, 0.5)] }, good: ['tree', 'knn'] }; },
    (r) => ({ rule: { type: 'dband', fs: pickN(r, CONT, 2), c: 1.0, w: r.range(0.22, 0.28) }, good: ['nn', 'knn'] }),
    (r) => { const [a, b, c] = pickN(r, [0, 1, 2, 3, 4, 5], 3); return { rule: { type: 'or', parts: [{ type: 'and', parts: [T(a, thrOf(r, a)), T(b, thrOf(r, b))] }, T(c, c === 2 ? 0.6 : 0.78)] }, good: ['tree', 'forest'] }; },
  ],
  4: [
    (r) => { const fs = pickN(r, CONT, 2); return { rule: { type: 'or', parts: [{ type: 'blob', fs, c: [0.24, 0.26], r: 0.21 }, { type: 'blob', fs, c: [0.74, 0.72], r: 0.22 }] }, good: ['knn'] }; },
    (r) => ({ rule: { type: 'dband', fs: pickN(r, CONT, 3), c: 1.5, w: 0.3 }, good: ['nn', 'knn'] }),
    (r) => { const fs = pickN(r, CONT, 3); return { rule: { type: 'or', parts: [{ type: 'blob', fs: fs.slice(0, 2), c: [0.7, 0.7], r: 0.25 }, T(fs[2], 0.8)] }, good: ['knn', 'forest'] }; },
    (r) => { const [a, b] = pickN(r, CONT, 2); return { rule: { type: 'wave', fx: a, fy: b, base: 0.5, amp: 0.34, freq: 1.5 }, good: ['knn', 'nn'] }; },
  ],
};
const SHAPE = { 1: { pool: 12, budget: 4 }, 2: { pool: 14, budget: 6 }, 3: { pool: 18, budget: 8 }, 4: { pool: 20, budget: 10 } };

export function genDef(rng, tier, unlocked, { hand = false, hideHint = false, testN = 30 } = {}) {
  const { rule, good } = rng.pick(TEMPLATES[tier])(rng);
  const rel = [...ruleFeats(rule)];
  const others = rng.shuffle([0, 1, 2, 3, 4, 5].filter((f) => !rel.includes(f)));
  const extra = tier === 1 ? rng.int(2) : tier === 2 ? 1 : 1 + rng.int(2);
  const lenses = [...rel, ...others.slice(0, extra)].sort((a, b) => a - b);
  let cards = unlocked.slice();
  if (hand && unlocked.length > 2) {
    const g = good.filter((m) => unlocked.includes(m));
    const first = g.length ? rng.pick(g) : rng.pick(unlocked);
    const second = rng.pick(unlocked.filter((m) => m !== first));
    cards = unlocked.filter((m) => m === first || m === second);
  }
  const noise = tier >= 3 && rng() < 0.3 ? 1 : 0;
  const { pool, budget } = SHAPE[tier];
  return {
    name: '', hint: hideHint ? null : '止める相手: ' + ruleText(rule) + (noise ? '（見本の答えが1体まちがっている）' : ''),
    rule, lenses, cards, pool, budget, par: budget - 2, pass: tier >= 3 ? 0.75 : 0.8, s2: 0.9, noise, testN,
    seed: 1 + rng.int(1e9), tier, generated: true,
  };
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function dailyDef(key, unlocked) {
  const rng = makeRng(hashStr('monban-daily-' + key));
  const def = genDef(rng, rng() < 0.5 ? 3 : 4, unlocked, { hideHint: true });
  def.name = `日替わりの門 ${key.slice(5).replace('-', '/')}`;
  def.daily = key;
  return def;
}
// 夜勤: 門を越えるたびに難しくなる。手札は毎回2枚だけ配られる
export function nightDef(seed, wave, unlocked) {
  const rng = makeRng(hashStr(`monban-night-${seed}-${wave}`));
  const tier = Math.min(4, 1 + Math.floor((wave - 1) / 2) + (wave > 2 && rng() < 0.25 ? 1 : 0));
  const def = genDef(rng, Math.min(4, tier), unlocked, { hand: true, hideHint: tier >= 4, testN: 10 });
  def.name = `夜勤 ${wave}つめの門`;
  def.night = wave;
  return def;
}
export function dailyScore(acc, used, budget) { return Math.round(acc * 1000) + (acc >= 0.75 ? (budget - used) * 25 : 0); }
