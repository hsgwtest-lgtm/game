// 1回ぶんの出題（見本の列＋本番の列）を作る。採点もここ
import { makeCrowd, addNoise, evalRule } from './rules.js';
import { fit, decide, METHODS } from '../ml/models.js';
import { TEST_N } from './stages.js';

function rawLevel(def, seed) {
  const pool = addNoise(makeCrowd(def.rule, def.lenses, def.pool, seed), def.noise || 0, seed);
  const test = makeCrowd(def.rule, def.lenses, def.testN || TEST_N, seed + 7777);
  return { def, pool, test, seed };
}
// 見本の列が「ルールを伝えきれる」ものになるまで、種をずらして作り直す。
// 目安: 列の全員を見本にしたとき、手札のどれかが本番でほぼ正解できること
export function buildLevel(def) {
  const target = def.noise ? 0.9 : 0.95;
  const solvers = def.solver ? [def.solver] : def.cards.map((m) => [m, null]);
  let best = null;
  for (let k = 0; k < 40; k++) {
    const level = rawLevel(def, def.seed + k * 101);
    const all = level.pool.map((_, i) => i);
    let top = 0;
    for (const [m, param] of solvers) {
      const X = all.map((i) => level.pool[i].x), y = all.map((i) => level.pool[i].badge);
      const lens = def.rel || def.lenses;
      top = Math.max(top, accuracy(fit(m, X, y, lens, param, level.seed), level.test));
      if (top >= target) break;
    }
    if (!best || top > best.top) best = { level, top };
    if (top >= target) break;
  }
  return best.level;
}
// 選んだ見本（pool の番号）から学習データを作る
export function trainSet(level, picks) {
  return { X: picks.map((i) => level.pool[i].x), y: picks.map((i) => level.pool[i].badge) };
}
export function fitLevel(level, picks, method, param, lenses) {
  const { X, y } = trainSet(level, picks);
  return fit(method, X, y, lenses, param, level.seed);
}
export function accuracy(model, crowd, key = 'y') {
  let ok = 0; for (const c of crowd) if (decide(model, c.x) === c[key]) ok++;
  return ok / crowd.length;
}
export function starsFor(def, acc, used) {
  if (acc + 1e-9 < def.pass) return 0;
  if (acc + 1e-9 < (def.s2 ?? 0.9)) return 1;
  return used <= def.par ? 3 : 2;
}
// 同じ見本・同じレンズで、ほかの手法ならどうだったか
export function compareAll(level, picks, lenses, methods, chosen) {
  return methods.map((m) => {
    const dial = METHODS[m].dial;
    const param = chosen && chosen.method === m ? chosen.param : (dial ? dial.def : null);
    const model = fitLevel(level, picks, m, param, lenses);
    return { method: m, param, acc: accuracy(model, level.test) };
  });
}
export { evalRule };
