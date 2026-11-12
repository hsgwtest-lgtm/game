// 5つの学習手法。どれも「見本 X（特徴の配列）と答え y（1=止める, 0=通す）」から学び、
// predict(x) で「止める」確率（0〜1）を返す。feats は使う特徴（レンズ）の番号。
import { makeRng } from './rng.js';

const sig = (z) => 1 / (1 + Math.exp(-z));

function constant(kind, y) {
  const p = y.length ? (y.reduce((a, b) => a + b, 0) / y.length >= 0.5 ? 1 : 0) : 0;
  return { kind, empty: true, constant: p, predict: () => p, explain: () => ({}) };
}
const oneClass = (y) => y.length === 0 || y.every((v) => v === y[0]);

// ── 線形（ロジスティック回帰）: 特徴ごとに重み1つ。足し算して線を1本引く
export function fitLinear(X, y, feats) {
  if (oneClass(y)) return constant('linear', y);
  const d = feats.length, n = X.length;
  const w = new Float64Array(d); let b = 0;
  const lr = 0.9, l2 = 0.002;
  for (let it = 0; it < 900; it++) {
    const gw = new Float64Array(d); let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * (X[i][feats[j]] - 0.5);
      const e = sig(z) - y[i];
      for (let j = 0; j < d; j++) gw[j] += e * (X[i][feats[j]] - 0.5);
      gb += e;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * gb / n;
  }
  const predict = (x) => { let z = b; for (let j = 0; j < d; j++) z += w[j] * (x[feats[j]] - 0.5); return sig(z); };
  return {
    kind: 'linear', feats, w: Array.from(w), b, predict,
    explain: (x) => ({ contrib: feats.map((f, j) => w[j] * (x[f] - 0.5)), p: predict(x) }),
  };
}

// ── 決定木: 「この特徴は○より大きい？」を順にたずねて分ける
function gini(c1, n) { if (!n) return 0; const p = c1 / n; return 2 * p * (1 - p); }
function buildTree(X, y, idx, feats, depth, maxDepth, rng) {
  let c1 = 0; for (const i of idx) c1 += y[i];
  const n = idx.length;
  const leaf = { leaf: true, p: n ? c1 / n : 0, n, label: c1 * 2 > n ? 1 : 0 };
  if (depth >= maxDepth || c1 === 0 || c1 === n) return leaf;
  const cand = rng ? pickSubset(feats, Math.max(1, Math.round(Math.sqrt(feats.length))), rng) : feats;
  let best = null;
  for (const f of cand) {
    const s = idx.slice().sort((a, b) => X[a][f] - X[b][f]);
    let l1 = 0;
    for (let k = 1; k < n; k++) {
      l1 += y[s[k - 1]];
      const a = X[s[k - 1]][f], b = X[s[k]][f];
      if (b - a < 1e-9) continue;
      const score = (k * gini(l1, k) + (n - k) * gini(c1 - l1, n - k)) / n;
      // 同点なら、すき間が広い切り方（余裕がある線）を選ぶ
      if (!best || score < best.score - 1e-12 || (Math.abs(score - best.score) <= 1e-12 && b - a > best.gap)) {
        best = { score, f, t: (a + b) / 2, gap: b - a };
      }
    }
  }
  if (!best || best.score >= gini(c1, n) - 1e-12) return leaf;
  const L = idx.filter((i) => X[i][best.f] <= best.t), R = idx.filter((i) => X[i][best.f] > best.t);
  return {
    leaf: false, f: best.f, t: best.t, n, p: c1 / n,
    lo: buildTree(X, y, L, feats, depth + 1, maxDepth, rng),
    hi: buildTree(X, y, R, feats, depth + 1, maxDepth, rng),
  };
}
function pickSubset(arr, k, rng) { const a = arr.slice(); rng.shuffle(a); return a.slice(0, k); }
function walk(node, x, path) {
  while (!node.leaf) { if (path) path.push(node); node = x[node.f] > node.t ? node.hi : node.lo; }
  if (path) path.push(node);
  return node;
}
export function fitTree(X, y, feats, depth = 2) {
  if (oneClass(y)) return constant('tree', y);
  const root = buildTree(X, y, X.map((_, i) => i), feats, 0, depth, null);
  return {
    kind: 'tree', feats, root, depth,
    predict: (x) => walk(root, x).label,
    explain: (x) => { const path = []; walk(root, x, path); return { path }; },
  };
}

// ── 森: 切る位置をでたらめに選んだ木をたくさん育て、多数決をとる
// （見本が少ないので、見本の抜き取りではなく「切る位置の乱数」で木ごとの違いを作る）
function buildRandTree(X, y, idx, feats, depth, rng) {
  let c1 = 0; for (const i of idx) c1 += y[i];
  const n = idx.length;
  const leaf = { leaf: true, p: n ? c1 / n : 0, n, label: c1 * 2 > n ? 1 : 0 };
  if (depth >= 5 || c1 === 0 || c1 === n) return leaf;
  let best = null;
  for (const f of feats) {
    let lo = Infinity, hi = -Infinity;
    for (const i of idx) { lo = Math.min(lo, X[i][f]); hi = Math.max(hi, X[i][f]); }
    if (hi - lo < 1e-9) continue;
    const t = lo + (0.1 + 0.8 * rng()) * (hi - lo);
    let nl = 0, l1 = 0;
    for (const i of idx) if (X[i][f] <= t) { nl++; l1 += y[i]; }
    if (!nl || nl === n) continue;
    const score = (nl * gini(l1, nl) + (n - nl) * gini(c1 - l1, n - nl)) / n;
    if (!best || score < best.score) best = { score, f, t };
  }
  if (!best) return leaf;
  const L = idx.filter((i) => X[i][best.f] <= best.t), R = idx.filter((i) => X[i][best.f] > best.t);
  return { leaf: false, f: best.f, t: best.t, n, p: c1 / n,
    lo: buildRandTree(X, y, L, feats, depth + 1, rng), hi: buildRandTree(X, y, R, feats, depth + 1, rng) };
}
export function fitForest(X, y, feats, nTrees = 9, seed = 1) {
  if (oneClass(y)) return constant('forest', y);
  const rng = makeRng(seed * 7919 + 13);
  const all = X.map((_, i) => i);
  const trees = [];
  for (let t = 0; t < nTrees; t++) trees.push(buildRandTree(X, y, all, feats, 0, rng));
  const votes = (x) => trees.map((r) => walk(r, x).label);
  const predict = (x) => { const v = votes(x); return v.reduce((a, b) => a + b, 0) / v.length; };
  const used = trees.map((r) => { const s = new Set(); (function go(nd) { if (!nd.leaf) { s.add(nd.f); go(nd.lo); go(nd.hi); } })(r); return [...s]; });
  return { kind: 'forest', feats, trees, used, predict, explain: (x) => ({ votes: votes(x) }) };
}

// ── k近傍法: 学習はしない。見本をそのまま覚え、一番似ている k 体の多数決
export function fitKnn(X, y, feats, k = 1) {
  if (y.length === 0) return constant('knn', y);
  const near = (x) => {
    const ds = X.map((e, i) => { let s = 0; for (const f of feats) { const v = e[f] - x[f]; s += v * v; } return { i, d: Math.sqrt(s) }; });
    ds.sort((a, b) => a.d - b.d || a.i - b.i);
    return ds.slice(0, Math.min(k, ds.length));
  };
  const predict = (x) => {
    const nb = near(x); let c = 0; for (const o of nb) c += y[o.i];
    if (c * 2 === nb.length) return y[nb[0].i];
    return c / nb.length;
  };
  return { kind: 'knn', feats, k, n: X.length, predict, explain: (x) => ({ near: near(x) }) };
}

// ── ニューラルネット: 中間の層を1つはさむ。重みを少しずつ直して覚える
export function initNN(feats, hidden, seed) {
  const rng = makeRng(seed * 31 + 5);
  const d = feats.length, H = hidden;
  const W1 = [], b1 = [], W2 = [];
  for (let h = 0; h < H; h++) { W1.push(Array.from({ length: d }, () => rng.gauss() * 1.6)); b1.push(rng.gauss() * 0.5); W2.push(rng.gauss() * 0.8); }
  const P = { W1, b1, W2, b2: 0 };
  const m = { feats, H, P, step: 0, mom: null, vel: null };
  return m;
}
function nnForward(P, feats, x) {
  const H = P.W1.length, a = new Array(H);
  let z = P.b2;
  for (let h = 0; h < H; h++) {
    let s = P.b1[h];
    for (let j = 0; j < feats.length; j++) s += P.W1[h][j] * (x[feats[j]] - 0.5) * 2;
    a[h] = Math.tanh(s); z += P.W2[h] * a[h];
  }
  return { a, p: sig(z) };
}
// steps 回だけ学習を進める（画面では少しずつ呼んで、重みが動く様子を見せる）
export function trainNN(m, X, y, steps) {
  const { feats, H, P } = m, d = feats.length, n = X.length;
  if (!n) return 0;
  const size = H * d + H + H + 1;
  if (!m.mom) { m.mom = new Float64Array(size); m.vel = new Float64Array(size); }
  const lr = 0.03, b1c = 0.9, b2c = 0.999, l2 = 0.0005;
  let loss = 0;
  for (let s = 0; s < steps; s++) {
    const g = new Float64Array(size); loss = 0;
    for (let i = 0; i < n; i++) {
      const { a, p } = nnForward(P, feats, X[i]);
      const e = p - y[i];
      loss += -(y[i] ? Math.log(p + 1e-9) : Math.log(1 - p + 1e-9));
      for (let h = 0; h < H; h++) {
        const dh = e * P.W2[h] * (1 - a[h] * a[h]);
        for (let j = 0; j < d; j++) g[h * d + j] += dh * (X[i][feats[j]] - 0.5) * 2;
        g[H * d + h] += dh;
        g[H * d + H + h] += e * a[h];
      }
      g[size - 1] += e;
    }
    m.step++;
    let q = 0;
    const upd = (get, set, decay) => {
      const grad = g[q] / n + (decay ? l2 * get() : 0);
      m.mom[q] = b1c * m.mom[q] + (1 - b1c) * grad;
      m.vel[q] = b2c * m.vel[q] + (1 - b2c) * grad * grad;
      const mh = m.mom[q] / (1 - Math.pow(b1c, m.step)), vh = m.vel[q] / (1 - Math.pow(b2c, m.step));
      set(get() - lr * mh / (Math.sqrt(vh) + 1e-8)); q++;
    };
    for (let h = 0; h < H; h++) for (let j = 0; j < d; j++) upd(() => P.W1[h][j], (v) => { P.W1[h][j] = v; }, true);
    for (let h = 0; h < H; h++) upd(() => P.b1[h], (v) => { P.b1[h] = v; }, false);
    for (let h = 0; h < H; h++) upd(() => P.W2[h], (v) => { P.W2[h] = v; }, true);
    upd(() => P.b2, (v) => { P.b2 = v; }, false);
  }
  return loss / n;
}
export const NN_STEPS = 700;
export function nnModel(m, done = true) {
  const predict = (x) => nnForward(m.P, m.feats, x).p;
  return { kind: 'nn', feats: m.feats, H: m.H, P: m.P, training: !done, predict, explain: (x) => nnForward(m.P, m.feats, x) };
}
export function fitNN(X, y, feats, hidden = 4, seed = 1) {
  if (oneClass(y)) return constant('nn', y);
  const m = initNN(feats, hidden, seed);
  trainNN(m, X, y, NN_STEPS);
  return nnModel(m);
}

// 手法の一覧（カード）。dial は1つだけ回せるつまみ
export const METHODS = {
  linear: { id: 'linear', name: '線形', short: '重みをかけて足す。線を1本引く', full: '線形（ロジスティック回帰）', dial: null,
    blurb: '特徴に重みをかけて足し、線を1本引く。少ない見本で安定するが、曲がった境目は引けない。' },
  tree: { id: 'tree', name: '決定木', short: '質問を重ねて、まっすぐ切る', full: '決定木', dial: { label: '深さ', values: [1, 2, 3, 4], def: 2 },
    blurb: '「大きさは○より上？」を順にたずねて分ける。「かつ」「または」に強いが、ななめの境目は苦手。' },
  knn: { id: 'knn', name: 'k近傍法', short: '似ている見本の答えをまねる', full: 'k近傍法', dial: { label: 'k', values: [1, 3, 5], def: 1 },
    blurb: '学習はしない。見本を丸ごと覚え、いちばん似ている見本の答えをまねる。飛び地に強いが、関係ないレンズに惑わされる。' },
  nn: { id: 'nn', name: 'ニューラルネット', short: '線を組み合わせて曲げる', full: 'ニューラルネット', dial: { label: '中間の数', values: [2, 4, 8], def: 4 },
    blurb: '中間の層をはさんで、曲がった境目も引ける。そのぶん見本がたくさん要り、少ないと当てずっぽうになる。' },
  forest: { id: 'forest', name: '森', short: 'でたらめに切った木の多数決', full: '森（ランダムフォレスト）', dial: { label: '木の本数', values: [5, 9, 15], def: 9 },
    blurb: '切る位置をでたらめに変えた木をたくさん育てて多数決。階段がならされて、ななめや丸い境目にも近づける。' },
};
export const METHOD_ORDER = ['linear', 'tree', 'knn', 'nn', 'forest'];

export function fit(method, X, y, feats, param, seed = 1) {
  if (!feats.length) return constant(method, y);
  const dial = METHODS[method].dial;
  const v = param ?? (dial ? dial.def : null);
  switch (method) {
    case 'linear': return fitLinear(X, y, feats);
    case 'tree': return fitTree(X, y, feats, v);
    case 'knn': return fitKnn(X, y, feats, v);
    case 'nn': return fitNN(X, y, feats, v, seed);
    case 'forest': return fitForest(X, y, feats, v, seed);
  }
  throw new Error('unknown method ' + method);
}
export const decide = (model, x) => (model.predict(x) >= 0.5 ? 1 : 0);
