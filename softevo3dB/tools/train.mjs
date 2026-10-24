// ブラウザなしで進化させる: node tools/train.mjs <見本のkey> <世代数> [JSONのオプション]
// 例) node tools/train.mjs dog 60
//     node tools/train.mjs human 200 '{"assist":1,"T":8}'
// 結果は tools/tmp/best_<key><tag>.json（out で変えられる）
import { writeFileSync, mkdirSync } from 'fs';
import { compileModel } from '../js/sim/model.js';
import { templateByKey } from '../js/sim/templates.js';
import { geneCount } from '../js/sim/nerves.js';
import { evaluate } from '../js/sim/sim.js';
import { CMAES } from '../js/evo/cmaes.js';

const key = process.argv[2] || 'dog';
const gens = +(process.argv[3] || 50);
const opt = JSON.parse(process.argv[4] || '{}');
const model = compileModel(templateByKey(key).build());
const n = geneCount(model);
const es = new CMAES(n, { sigma: opt.sigma || 0.6, lambda: opt.lambda, seed: opt.seed || 1 });
let assist = opt.assist || 0;
const env = { terrain: opt.terrain || 'flat', water: opt.water, T: opt.T || 8, vstar: opt.vstar, nv: opt.nv, goal: opt.goal, vcap: opt.vcap };
let okStreak = 0, best = null;
mkdirSync('tools/tmp', { recursive: true });
const out = opt.out || `tools/tmp/best_${key}${opt.tag || ''}.json`;
const t0 = Date.now();
console.log(`${key}: genes=${n} lambda=${es.lambda} dofs=${model.nDof} groups=${model.nGroup}`);
for (let g = 0; g < gens; g++) {
  const S = es.ask();
  const res = S.map(s => evaluate(model, s.x, { ...env, assist }));
  const fits = res.map(r => r.fitness);
  const idx = es.tell(S, fits);
  const b = res[idx[0]];
  // いちばん良いもの: 支えの手が少ないほうを優先し、同じ支えなら成績で
  if (!best || assist < best.assist || (assist === best.assist && b.fitness > best.r.fitness)) best = { r: b, x: Array.from(S[idx[0]].x), assist, gen: g };
  // 支えの手: 倒れずに進めたら少しずつ外す
  if (assist > 0) {
    if (!b.fell && b.dist > (opt.need || 1.5)) okStreak++; else okStreak = 0;
    if (okStreak >= (opt.streak || 3)) { assist = Math.max(0, +(assist - (opt.astep || 0.1)).toFixed(2)); okStreak = 0; }
  }
  if (g % 10 === 9) writeFileSync(out, JSON.stringify({ key, ...best, cur: Array.from(S[idx[0]].x), curAssist: assist, mean: Array.from(es.m), assistEnd: assist }));
  if (g % (opt.every || 5) === 0 || g === gens - 1) {
    const meanFit = fits.reduce((a, c) => a + c, 0) / fits.length;
    console.log(`g${String(g).padStart(3)} best=${b.fitness.toFixed(2)} dist=${b.dist.toFixed(2)}m fell=${b.fell ? 'Y@' + b.time.toFixed(1) : 'N'} up=${b.upright.toFixed(2)} E=${b.energy.toFixed(2)} mean=${meanFit.toFixed(2)} σ=${es.sigma.toFixed(3)} assist=${assist.toFixed(1)} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
writeFileSync(out, JSON.stringify({ key, ...best, mean: Array.from(es.m), assistEnd: assist, nv: opt.nv }));
console.log('saved', out, 'best', best.r.fitness.toFixed(2), 'at gen', best.gen, 'assist', best.assist);
