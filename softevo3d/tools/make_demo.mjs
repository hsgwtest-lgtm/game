// タイトル画面で歩く「おてほんの脳」を作る: node tools/make_demo.mjs [世代数]
// 物理が決定論的なので、ここで学習した脳はブラウザでもまったく同じ動きをする。
import { writeFileSync } from 'fs';
import { compileBody } from '../js/sim/body.js';
import { brainLayout } from '../js/sim/brain.js';
import { evaluate } from '../js/sim/creature.js';
import { presetByKey } from '../js/sim/presets.js';
import { GA } from '../js/evo/ga.js';
import { genomeToB64 } from '../js/core/share.js';

const gens = +(process.argv[2] || 80);
const key = process.env.PRESET || 'inu';
const p = presetByKey(key);
const body = compileBody(p.voxels);
const L = brainLayout(body);
let best = null;
for (const seed of (process.env.SEEDS || '3').split(',').map(Number)) {
  const ga = new GA(L, { size: 30, seed });
  let s;
  for (let g = 0; g < gens; g++) {
    for (const ind of ga.pending()) { const r = evaluate(body, L, ind.g, {}); ind.fit = r.fitness; ind.res = r; }
    s = ga.breed();
    if (g % 10 === 9) console.log(`seed ${seed} gen ${g + 1}: ${s.best.fit.toFixed(2)}m`);
  }
  if (!best || s.best.fit > best.fit) best = { fit: s.best.fit, g: s.best.g, seed };
}
const check = evaluate(body, L, Float64Array.from(Float32Array.from(best.g)), {});
console.log('best', best.fit, 'recheck', check.fitness);
writeFileSync(new URL('../js/game/demo.js', import.meta.url), `// 自動生成（tools/make_demo.mjs）: タイトル画面で歩くおてほんの脳\nexport const DEMO = { preset: '${key}', fit: ${check.fitness}, genome: '${genomeToB64(best.g)}' };\n`);
