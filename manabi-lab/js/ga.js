// ga.js — 遺伝的アルゴリズム（純粋モジュール）
//   世代交代のときに、適応度（家族が集めた餌の量）で親を選び、
//   交叉（2つの親を混ぜる）と突然変異（少し変える）で次の世代を作る。
//   「ランダム＋選択」方式も同じ選択のしくみを使うが、交叉はせず、コピーのゆらぎだけ

// トーナメント選択: k 匹をくじで選び、そのなかでいちばん適応度の高い1匹を親にする
export function tournament(fits, k, rng, exclude = -1) {
  let best = -1;
  for (let i = 0; i < k; i++) {
    let j = rng.int(fits.length);
    if (j === exclude && fits.length > 1) j = (j + 1 + rng.int(fits.length - 1)) % fits.length;
    if (best < 0 || fits[j] > fits[best]) best = j;
  }
  return best;
}

// 適応度の高い順の番号
export function rankOrder(fits) {
  return fits.map((_, i) => i).sort((a, b) => fits[b] - fits[a] || a - b);
}

// 次の世代を作る
//   parents: [{ g: 遺伝子, gid, fit }]   n: 作る数
//   ops: { clone(g), crossover(a, b, rng), mutate(g, rng) }
//   opt: { elite: そのまま残す上位の数, tour: トーナメントの大きさ, cx: 交叉する確率 }
//   返り値: [{ g, parents: [gid...], elite }]
export function nextGeneration(parents, n, ops, opt, rng) {
  const fits = parents.map((p) => p.fit);
  const order = rankOrder(fits);
  const out = [];
  const nElite = Math.min(opt.elite ?? 2, n, parents.length);
  for (let e = 0; e < nElite; e++) {
    const p = parents[order[e]];
    out.push({ g: ops.clone(p.g), parents: [p.gid], elite: true });
  }
  while (out.length < n) {
    const ia = tournament(fits, opt.tour ?? 3, rng);
    const a = parents[ia];
    let g;
    let ps;
    if (ops.crossover && rng.next() < (opt.cx ?? 0)) {
      const ib = tournament(fits, opt.tour ?? 3, rng, ia);
      const b = parents[ib];
      g = ops.crossover(a.g, b.g, rng);
      ps = ib === ia ? [a.gid] : [a.gid, b.gid];
    } else {
      g = ops.clone(a.g);
      ps = [a.gid];
    }
    ops.mutate(g, rng);
    out.push({ g, parents: ps, elite: false });
  }
  return out;
}
