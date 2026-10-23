// GAの設定をくらべる: node tools/ga_sweep.mjs '{"sigma":0.4}' inu,tokage 30 1,2,3
// 「最後の記録」と「記録が伸びた世代の数（＝見ていて楽しい頻度）」を出す
import { compileBody } from '../js/sim/body.js';
import { brainLayout } from '../js/sim/brain.js';
import { evaluate } from '../js/sim/creature.js';
import { presetByKey } from '../js/sim/presets.js';
import { GA, GA_PARAMS } from '../js/evo/ga.js';

const over = JSON.parse(process.argv[2] || '{}');
Object.assign(GA_PARAMS, over);
const keys = (process.argv[3] || 'inu').split(',');
const gens = +(process.argv[4] || 30);
const seeds = (process.argv[5] || '1,2,3').split(',').map(Number);
const out = [];
for (const key of keys) {
  const body = compileBody(presetByKey(key).voxels);
  const L = brainLayout(body);
  let sumBest = 0, sumUps = 0, maxPlat = 0;
  for (const seed of seeds) {
    const ga = new GA(L, { size: 30, seed });
    let prev = -Infinity, ups = 0, plat = 0, s;
    for (let g = 0; g < gens; g++) {
      for (const ind of ga.pending()) { const r = evaluate(body, L, ind.g, {}); ind.fit = r.fitness; ind.res = r; }
      s = ga.breed();
      if (s.best.fit > prev + 1e-9) { if (g > 0) ups++; prev = s.best.fit; plat = 0; } else { plat++; maxPlat = Math.max(maxPlat, plat); }
    }
    sumBest += s.best.fit; sumUps += ups;
  }
  out.push(`${key}: best=${(sumBest / seeds.length).toFixed(2)} ups=${(sumUps / seeds.length).toFixed(1)} maxPlateau=${maxPlat}`);
}
console.log(JSON.stringify(over), '|', out.join(' | '));
