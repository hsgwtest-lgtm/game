// 学習の実験台（ブラウザなしで3流派を走らせる）
//   node tools/lab.mjs ippo,hashi --ga --rl --il --seeds 1,2,3
//   node tools/lab.mjs kagi --rl --rw key=3          （ごほうびを変える）
//   node tools/lab.mjs kagi --rl --rw shaping=0 --ent 2
//   node tools/lab.mjs ippo --show                    （地図と最短ルート）
//   node tools/lab.mjs shiken --combo                 （模倣 → 強化の合わせ技）
import { STAGES } from '../js/sim/stages.js';
import { O, configure, show, runGA, runRL, runIL } from './labcore.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ids = (args[0] && !args[0].startsWith('--') ? args[0] : STAGES.map((s) => s.id).join(',')).split(',');
const seeds = opt('--seeds', '1,2,3').split(',').map(Number);
const rw = {};
for (const kv of (opt('--rw', '') || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); rw[k] = +v; }
configure({
  rw, gens: +opt('--gens', 150), rounds: +opt('--rounds', 250), mirror: flag('--mirror'),
  pop: +opt('--pop', 40), mut: +opt('--mut', 1), ent: +opt('--ent', 1), lr: +opt('--lr', 1), clones: +opt('--clones', 1),
  iltrain: +opt('--iltrain', 300), ilmode: opt('--ilmode', 'dagger'),
});

for (const id of ids) {
  const def = STAGES.find((s) => s.id === id);
  if (!def) { console.log('unknown', id); continue; }
  show(def);
  if (flag('--show')) continue;
  for (const seed of seeds) {
    const t0 = Date.now();
    if (flag('--ga')) { const r = runGA(def, seed); console.log(`  GA s${seed}: first=${r.first} (evals ${r.firstEvals}) gen=${r.gen} best=${r.best} succ=${r.succ} coins=${r.coins}  ${Date.now() - t0}ms`); }
    const t1 = Date.now();
    if (flag('--il') || flag('--combo')) {
      const r = runIL(def, seed);
      console.log(`  IL s${seed}: ok=${r.ok} demos=${r.demos} fixes=${r.fixes} n=${r.samples} acc=${r.acc} | ${r.log}  ${Date.now() - t1}ms`);
      if (flag('--combo')) O.ilInit = r.w;
    }
    const t2 = Date.now();
    if (flag('--rl') || flag('--combo')) { const r = runRL(def, seed); console.log(`  RL s${seed}: first=${r.first} (eps ${r.firstEps}) anySucc@${r.firstAny} round=${r.round} succ=${r.succ} ent=${r.ent} ret=${r.ret} coins=${r.coins} greedy=${r.greedy.succ ? 'OK' : 'x'}(${r.greedy.steps},c${r.greedy.coins})  ${Date.now() - t2}ms`); }
    O.ilInit = null;
  }
}
