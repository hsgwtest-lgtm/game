// ヘッドレス学習テスト: node tools/train_test.mjs [stageIndex] [generations] [popSize] [seed]
// ブラウザなしで「本当に学習できるか」「何世代でクリアできるか」を確かめる。

import { STAGES, WORLD } from '../js/core/config.js';
import { Session, Bird, N_IN } from '../js/sim/flight.js';
import { Flock } from '../js/ml/ga.js';
import { MLP } from '../js/ml/nn.js';
import { RNG } from '../js/core/rng.js';

const args = process.argv.slice(2);
const stageList = (args[0] ?? '0').split(',').map(Number);
const maxGen = Number(args[1] ?? 40);
const pop = Number(args[2] ?? 50);
const seed = Number(args[3] ?? 12345);

const flock = new Flock({ size: pop, seed }).initRandom();
if (process.env.PM) flock.override = { pm: Number(process.env.PM), sigma: Number(process.env.SIGMA || 0.2) };
if (process.env.XR) flock.crossRate = Number(process.env.XR);
const QUIET = !!process.env.QUIET;
const nets = [];
const seedRng = new RNG(seed ^ 0x9e3779b9);
let totalSteps = 0, totalBirdSteps = 0;
const t0 = Date.now();

for (const si of stageList) {
  const stage = STAGES[si];
  let clearedAt = -1;
  for (let g = 0; g < maxGen; g++) {
    const sess = new Session(stage, (seedRng.float() * 2 ** 32) >>> 0, { maxDist: stage.goal * 1.2 });
    flock.members.forEach((m, i) => {
      const net = nets[i] || (nets[i] = new MLP(flock.nIn, flock.nHid, flock.nOut));
      net.w = m.genome;
      const b = new Bird({ x: (seedRng.float() - 0.5) * 2, y: WORLD.START_Y + (seedRng.float() - 0.5) * 2 });
      b.ctrl = (bb) => net.forward(bb.inp, bb.out);
      b.tag = m;
      sess.add(b);
    });
    let steps = 0;
    while (!sess.done && steps < 20000) {
      totalBirdSteps += sess.aliveCount;
      sess.step(WORLD.DT); steps++;
    }
    totalSteps += steps;
    for (const b of sess.birds) { b.tag.fitness = b.dist + (process.env.NOSHAPE ? 0 : b.bonus); b.tag.cause = b.cause; }
    const s = flock.evolve(stage.id);
    const causes = Object.entries(s.causes).map(([k, v]) => `${k}:${v}`).join(' ');
    const finished = sess.birds.filter(b => b.cause === 'finish').length;
    if (!QUIET) console.log(`st${stage.id} gen ${String(s.gen).padStart(3)} best ${s.best.toFixed(0).padStart(4)} avg ${s.avg.toFixed(0).padStart(4)} fin ${String(finished).padStart(2)} div ${s.div.toFixed(2)} | ${causes}`);
    if (s.best >= stage.goal && clearedAt < 0) { clearedAt = s.gen; }
    if (clearedAt > 0 && s.gen >= clearedAt + 2) break;
  }
  console.log(`== stage ${stage.id} cleared at gen ${clearedAt}`);
}
const dt = (Date.now() - t0) / 1000;
console.log(`time ${dt.toFixed(1)}s, steps ${totalSteps}, bird-steps ${totalBirdSteps}, ${(totalBirdSteps / dt / 1000).toFixed(1)}k bird-steps/s, inputs ${N_IN}`);
