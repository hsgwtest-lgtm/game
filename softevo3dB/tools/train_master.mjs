// ぬしを育てる: node tools/train_master.mjs <region> <見本のkey> <世代数> [seed]
// その地方の「はじまりの時代」の環境で進化させ、tools/masters/<region>.json に保存する
// （pick = 最後までで、支えなしのいちばん。ぬしは「そこそこ強い」くらいがよいので、世代数で強さを決める）
import { writeFileSync, mkdirSync } from 'fs';
import { compileModel } from '../js/sim/model.js';
import { templateByKey } from '../js/sim/templates.js';
import { geneCount } from '../js/sim/nerves.js';
import { evaluate } from '../js/sim/sim.js';
import { CMAES } from '../js/evo/cmaes.js';
import { needsSupport } from '../js/evo/engine.js';
import { envOf, regionAt } from '../js/game/world.js';

const [region, key, gensArg, seedArg, targetArg] = process.argv.slice(2);
const target = targetArg ? +targetArg : null;   // この記録に最初に届いた遺伝子をぬしにする（強すぎないように）
const gens = +(gensArg || 60);
const model = compileModel(templateByKey(key).build());
const n = geneCount(model);
const env = envOf(regionAt(region, 0), {});
const es = new CMAES(n, { sigma: 0.3, seed: +(seedArg || 3) });
let assist = needsSupport(model, new Float64Array(n), env) ? 1 : 0;
let ok = 0, best = null;
const t0 = Date.now();
console.log(region, key, 'genes', n, 'assist', assist, JSON.stringify(env));
for (let g = 0; g < gens; g++) {
  const S = es.ask();
  const res = S.map(s => evaluate(model, s.x, { ...env, assist }));
  const idx = es.tell(S, res.map(r => r.fitness));
  const b = res[idx[0]];
  if (assist === 0 && (!best || b.dist > best.dist) && !(best && target && best.dist >= target)) best = { dist: b.dist, x: Array.from(S[idx[0]].x), gen: g, fell: b.fell };
  if (target && best && best.dist >= target && g > 5) { console.log('reached target at', g); break; }
  if (assist > 0) {
    if (!b.fell && b.dist > Math.max(0.3, Math.min(2, model.size.h * 1.2))) ok++; else ok = 0;
    if (ok >= 4) { assist = Math.max(0, +(assist - 0.05).toFixed(2)); ok = 0; }
  }
  if (g % 10 === 9 || g === gens - 1) console.log(`g${g + 1} dist=${b.dist.toFixed(2)} fell=${b.fell ? 'Y' : 'N'} assist=${assist} best=${best ? best.dist.toFixed(2) + '@' + best.gen : '-'} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
mkdirSync('tools/masters', { recursive: true });
writeFileSync(`tools/masters/${region}.json`, JSON.stringify({ region, key, pick: best ? best.x : Array.from(es.m), dist: best ? best.dist : 0, gen: best ? best.gen : -1 }));
console.log('saved', region, best && best.dist.toFixed(2));
