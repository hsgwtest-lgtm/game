// 「博士のヒナ」をさらに鍛える（複数コースの平均で選ぶ）: node tools/make_demo_robust.mjs
// make_demo.mjs で作った脳を種にして、毎世代 3 つのステージで飛ばした合計で選ぶ。
import fs from 'fs';
import { STAGES, WORLD } from '../js/core/config.js';
import { Session, Bird } from '../js/sim/flight.js';
import { Flock } from '../js/ml/ga.js';
import { MLP, f32ToB64, b64ToF32 } from '../js/ml/nn.js';
import { RNG } from '../js/core/rng.js';
import { DEMO_GENOME } from '../js/game/demo.js';

const GENS = Number(process.argv[2] || 120);
const flock = new Flock({ size: 60, seed: 77 }).initRandom();
flock.override = { pm: 0.05, sigma: 0.15 };
const base = b64ToF32(DEMO_GENOME);
// 種: 博士のヒナ＋その変異
const rngS = new RNG(5);
flock.members.forEach((m, i) => {
  m.genome.set(base);
  if (i > 0) for (let p = 0; p < m.genome.length; p++) if (rngS.float() < 0.1) m.genome[p] += rngS.gauss() * 0.3;
});
const rng = new RNG(1234);
const nets = flock.members.map(() => new MLP(flock.nIn, flock.nHid, flock.nOut));

function evalGen() {
  for (const m of flock.members) { m.fitness = 0; m.dist = 0; }
  const picks = [];
  while (picks.length < 3) { const s = rng.int(0, STAGES.length - 1); if (!picks.includes(s)) picks.push(s); }
  for (const si of picks) {
    const st = STAGES[si];
    const sess = new Session(st, (rng.float() * 2 ** 32) >>> 0, { maxDist: st.goal });
    flock.members.forEach((m, i) => {
      nets[i].w = m.genome;
      const b = new Bird({ x: (rng.float() - 0.5) * 2, y: WORLD.START_Y + (rng.float() - 0.5) * 2 });
      b.ctrl = (bb) => nets[i].forward(bb.inp, bb.out);
      b.tag = m; sess.add(b);
    });
    while (!sess.done) sess.step();
    for (const b of sess.birds) { b.tag.fitness += (b.dist + b.bonus) / st.goal; b.tag.dist += b.dist / st.goal * 100; }
  }
}

function robustScore(g, trials = 8) {
  const net = new MLP(flock.nIn, flock.nHid, flock.nOut, g);
  let score = 0;
  const per = [];
  for (const st of STAGES) {
    let fin = 0;
    for (let k = 0; k < trials; k++) {
      const s = new Session(st, 777 + k * 31 + st.id * 1000, { maxDist: st.goal });
      s.add(new Bird({ ctrl: (bb) => net.forward(bb.inp, bb.out) }));
      while (!s.done) s.step();
      score += s.birds[0].dist / st.goal;
      if (s.birds[0].cause === 'finish') fin++;
    }
    per.push(fin);
  }
  return { score: score / (STAGES.length * trials), per };
}

let best = { score: robustScore(base).score, g: base };
console.log('start', best.score.toFixed(3));
for (let g = 0; g < GENS; g++) {
  evalGen();
  const s = flock.evolve(0);
  if (g % 10 === 9) {
    const cand = flock.members.slice(0, 4);   // エリート
    for (const m of cand) {
      const r = robustScore(m.genome);
      if (r.score > best.score) { best = { score: r.score, g: new Float32Array(m.genome), per: r.per }; }
    }
    console.log(`gen ${g + 1} avg ${s.avg.toFixed(1)} best-robust ${best.score.toFixed(3)} ${best.per ? best.per.join('/') : ''}`);
  }
}
fs.writeFileSync(new URL('../js/game/demo.js', import.meta.url),
  '// 自動生成（tools/make_demo.mjs → make_demo_robust.mjs）: 博士が育てたヒナの脳\n' +
  `export const DEMO_SCORE = ${best.score.toFixed(3)};\n` +
  `export const DEMO_GENOME = '${f32ToB64(best.g)}';\n`);
console.log('wrote js/game/demo.js', best.score.toFixed(3));
