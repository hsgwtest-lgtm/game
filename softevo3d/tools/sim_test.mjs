// 物理の確認: node tools/sim_test.mjs
//  1) 脳がゼロ（筋肉が動かない）なら、生き物はその場でじっとしているか
//  2) ランダムな脳で暴れても壊れないか
//  3) 1体の評価にかかる時間
import { compileBody, validateVoxels } from '../js/sim/body.js';
import { brainLayout, randomGenome } from '../js/sim/brain.js';
import { Creature, evaluate, EVAL_FRAMES } from '../js/sim/creature.js';
import { PRESETS } from '../js/sim/presets.js';
import { RNG } from '../js/core/rng.js';

const rng = new RNG(12345);
let fail = 0;
for (const p of PRESETS) {
  const v = validateVoxels(p.voxels);
  if (!v.ok) { console.log(p.key, 'INVALID', v.problems); fail++; continue; }
  const body = compileBody(p.voxels);
  const L = brainLayout(body);
  // 1) 静止
  const zero = new Float64Array(L.len);
  const c = new Creature(body, L, zero, {});
  for (let f = 0; f < EVAL_FRAMES; f++) c.step();
  const r0 = c.result();
  let maxV = 0;
  for (let i = 0; i < c.vel.length; i++) maxV = Math.max(maxV, Math.abs(c.vel[i]));
  // 2) ランダム
  const t0 = performance.now();
  let best = -1e9, worst = 1e9, flags = {};
  const N = 12;
  for (let k = 0; k < N; k++) {
    const g = randomGenome(L, rng);
    const r = evaluate(body, L, g, {});
    best = Math.max(best, r.fitness); worst = Math.min(worst, r.fitness);
    flags[r.flag] = (flags[r.flag] || 0) + 1;
  }
  const ms = (performance.now() - t0) / N;
  console.log(`${p.key.padEnd(9)} vox=${body.nV} nodes=${body.nN} cons=${body.nC} ch=${body.nCh} in=${L.nIn} genes=${L.len}` +
    ` | still: dist=${r0.dist.toFixed(4)} maxV=${maxV.toExponential(1)} flag=${r0.flag}` +
    ` | random: best=${best.toFixed(2)} worst=${worst.toFixed(2)} ${JSON.stringify(flags)} | ${ms.toFixed(1)} ms/eval`);
  if (Math.abs(r0.dist) > 0.01 || r0.flag !== 'ok') fail++;
}
// 決定論: 同じ遺伝子なら同じ結果
{
  const body = compileBody(PRESETS[0].voxels);
  const L = brainLayout(body);
  const g = randomGenome(L, new RNG(7));
  const a = evaluate(body, L, g, {}), b = evaluate(body, L, g, {});
  const same = a.fitness === b.fitness;
  console.log('deterministic:', same, a.fitness);
  if (!same) fail++;
}
console.log(fail ? `FAIL ${fail}` : 'OK');
process.exit(fail ? 1 : 0);
