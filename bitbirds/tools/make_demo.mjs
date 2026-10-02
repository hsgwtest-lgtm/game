// 「博士のヒナ」の脳を作る: node tools/make_demo.mjs
// 全ステージを順に進化させ、いろいろなコースで安定して飛べる個体を選んで js/game/demo.js に書き出す。
// （タイトル画面のデモ飛行と、きそうモードの相手に使う）

import fs from 'fs';
import { STAGES, WORLD } from '../js/core/config.js';
import { Session, Bird } from '../js/sim/flight.js';
import { Flock } from '../js/ml/ga.js';
import { MLP, f32ToB64 } from '../js/ml/nn.js';
import { RNG } from '../js/core/rng.js';

const flock = new Flock({ size: 60, seed: 2024 }).initRandom();
const rng = new RNG(99);
const nets = [];

function runGen(st) {
  const sess = new Session(st, (rng.float() * 2 ** 32) >>> 0, { maxDist: st.goal * 1.25 });
  flock.members.forEach((m, i) => {
    const net = nets[i] || (nets[i] = new MLP(flock.nIn, flock.nHid, flock.nOut));
    net.w = m.genome;
    const b = new Bird({ x: (rng.float() - 0.5) * 2, y: WORLD.START_Y + (rng.float() - 0.5) * 2 });
    b.ctrl = (bb) => net.forward(bb.inp, bb.out);
    b.tag = m; sess.add(b);
  });
  while (!sess.done) sess.step();
  for (const b of sess.birds) { b.tag.fitness = b.dist + b.bonus; b.tag.cause = b.cause; }
  return flock.evolve(st.id);
}

function evalGenome(g, trials = 8) {
  const net = new MLP(flock.nIn, flock.nHid, flock.nOut, g);
  let score = 0;
  for (const st of STAGES) {
    for (let k = 0; k < trials; k++) {
      const s = new Session(st, 777 + k * 31 + st.id * 1000, { maxDist: st.goal });
      s.add(new Bird({ ctrl: (bb) => net.forward(bb.inp, bb.out) }));
      while (!s.done) s.step();
      score += s.birds[0].dist / st.goal;
    }
  }
  return score / (STAGES.length * trials);
}

for (const st of STAGES) {
  let g = 0;
  for (; g < 150; g++) { const s = runGen(st); if (s.med >= st.goal * 0.8) break; }
  console.log(`stage ${st.id} trained ${g} gens, gen=${flock.gen}`);
}
// ミックスで仕上げ
for (let r = 0; r < 240; r++) runGen(STAGES[r % STAGES.length]);
const cands = [...flock.members].sort((a, b) => b.fitness - a.fitness).slice(0, 20);
let best = null, bestS = -1;
for (const m of cands) {
  const s = evalGenome(m.genome);
  if (s > bestS) { bestS = s; best = m; }
}
console.log('best robust score', bestS.toFixed(3));
for (const st of STAGES) {
  const net = new MLP(flock.nIn, flock.nHid, flock.nOut, best.genome);
  let fin = 0;
  for (let k = 0; k < 10; k++) {
    const s = new Session(st, 5000 + k, { maxDist: st.goal });
    s.add(new Bird({ ctrl: (bb) => net.forward(bb.inp, bb.out) }));
    while (!s.done) s.step();
    if (s.birds[0].cause === 'finish') fin++;
  }
  console.log(`  stage ${st.id}: ${fin}/10 finish`);
}
fs.writeFileSync(new URL('../js/game/demo.js', import.meta.url),
  '// 自動生成（tools/make_demo.mjs）: 博士が育てたヒナの脳\n' +
  `export const DEMO_SCORE = ${bestS.toFixed(3)};\n` +
  `export const DEMO_GENOME = '${f32ToB64(best.genome)}';\n`);
console.log('wrote js/game/demo.js');
