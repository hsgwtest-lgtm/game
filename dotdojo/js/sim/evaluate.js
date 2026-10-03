// 脳の「本番テスト」：いちばん自信のある行動だけで修行場に挑む（すべてのスタート地点で）
// 免許皆伝（その流派の印）は、ここで全部成功したときにもらえる。

import { Episode, N_IN } from './env.js';

// actFn(obs) → 行動
export function evalPolicy(stage, rewards, actFn, opts = {}) {
  const obs = new Float32Array(N_IN);
  const per = [];
  let ok = 0, maxSteps = 0, sumSteps = 0;
  for (let si = 0; si < stage.starts.length; si++) {
    const ep = new Episode(stage, 1, rewards, si);
    const path = opts.path ? [[ep.x[0], ep.y[0]]] : null;
    while (!ep.allDone) {
      ep.observe(0, obs);
      ep.step([actFn(obs)]);
      if (path) path.push([ep.x[0], ep.y[0]]);
    }
    const r = { succ: ep.succ[0], steps: ep.steps[0], cause: ep.cause[0], ret: ep.ret[0], coins: ep.coinsGot[0], path };
    per.push(r);
    if (r.succ) { ok++; sumSteps += r.steps; maxSteps = Math.max(maxSteps, r.steps); }
  }
  return { succ: ok === stage.starts.length, ok, n: stage.starts.length, steps: ok ? Math.round(sumSteps / ok) : 0, maxSteps, per };
}
