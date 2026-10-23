// 学習できるかの確認（ブラウザなし）: node tools/evo_test.mjs イヌのkey 世代数 [env JSON]
// 例) node tools/evo_test.mjs inu 40
import { compileBody } from '../js/sim/body.js';
import { brainLayout } from '../js/sim/brain.js';
import { evaluate } from '../js/sim/creature.js';
import { PRESETS } from '../js/sim/presets.js';
import { GA } from '../js/evo/ga.js';

const key = process.argv[2] || 'inu';
const gens = +(process.argv[3] || 40);
const env = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const seed = +(process.env.SEED || 1);
const pop = +(process.env.POP || 30);
const p = PRESETS.find(q => q.key === key);
const body = compileBody(p.voxels);
const L = brainLayout(body);
const ga = new GA(L, { size: pop, seed });
const t0 = performance.now();
const line = [];
let last = null;
for (let g = 0; g < gens; g++) {
  for (const ind of ga.pending()) { const r = evaluate(body, L, ind.g, env); ind.fit = r.fitness; ind.res = r; }
  const s = ga.breed();
  last = s;
  line.push(s.best.fit.toFixed(2));
}
const r = last.best.res;
console.log(`${key} seed=${seed} ${JSON.stringify(env)} ${((performance.now() - t0) / 1000).toFixed(0)}s best/gen: ${line.join(' ')}`);
console.log(`  final: fit=${r.fitness.toFixed(3)} air=${r.air.toFixed(2)} quad=${r.quad.map(v => v.toFixed(2)).join('/')} upside=${r.upside.toFixed(2)} rollZ=${r.rollZ.toFixed(2)} rollX=${r.rollX.toFixed(2)} drift=${r.drift.toFixed(2)} period=${r.period.toFixed(2)} flag=${r.flag}`);
