// 最短ルートさがし（時間つき幅優先探索）
// オニやトゲの動きも考えて「何歩で巻物にたどりつけるか」を求める。
// ゲーム内では「最短 ○歩」の目安に、開発用ツールではお手本の自動生成に使う。

import { Episode, N_ACT } from './env.js';

// from: { x, y, key, t } を渡すと、その状態からの最短ルート（startIdx でスタート地点を選ぶ）
export function plan(stage, maxT = stage.maxSteps, from = null, startIdx = 0) {
  const W = stage.W, H = stage.H, S = W * H * 2;
  const ep = new Episode(stage, 1, { shaping: 0 });
  const enc = (x, y, k) => (k * H + y) * W + x;
  // parent[t][s] = 前の状態*8 + 行動（-1 は未到達）
  const parents = [];
  const t0 = from ? from.t : 0;
  let layer = new Int32Array(S).fill(-1);
  const st0 = stage.starts[startIdx] || stage.start;
  const s0 = from ? enc(from.x, from.y, from.key ? 1 : 0) : enc(st0.x, st0.y, 0);
  layer[s0] = 0;
  for (let t = 0; t < t0; t++) parents.push(null);
  parents.push(layer);
  let frontier = [s0];
  for (let t = t0; t < maxT && frontier.length; t++) {
    const next = new Int32Array(S).fill(-1);
    const nf = [];
    for (const s of frontier) {
      const x = s % W, y = Math.floor(s / W) % H, k = Math.floor(s / (W * H));
      for (let a = 0; a < N_ACT; a++) {
        ep.reset();
        ep.t = t; ep._prepT = -1;
        ep.x[0] = x; ep.y[0] = y; ep.key[0] = k;
        ep.step([a]);
        if (!ep.alive[0]) continue;
        if (ep.succ[0]) {
          // ゴール: 道のりを逆にたどる
          const acts = [a];
          let cur = s;
          for (let tt = t; tt > t0; tt--) {
            const p = parents[tt][cur];
            acts.push(p & 7);
            cur = p >> 3;
          }
          acts.reverse();
          return { steps: t + 1 - t0, actions: acts };
        }
        const ns = enc(ep.x[0], ep.y[0], ep.key[0]);
        if (next[ns] === -1) { next[ns] = (s << 3) | a; nf.push(ns); }
      }
    }
    parents.push(next);
    frontier = nf;
  }
  return null;
}
