// CPU どうしの強さ表: node tools/cpu_matrix.mjs [arenas] [games]
import { Env } from '../js/sim/env.js';
import { CpuController, CPU_DEFS } from '../js/sim/bots.js';
import { Rng } from '../js/core/rng.js';
const arenas = (process.argv[2] || '0,1,2,3,4,5').split(',').map(Number);
const G = +(process.argv[3] || 60);
const keys = Object.keys(CPU_DEFS);
const t0 = Date.now(); let steps = 0;
console.log('row vs col: win% (share%)');
console.log(''.padEnd(9) + keys.map(k => k.padEnd(13)).join(''));
for (const a of keys) {
  let line = a.padEnd(9);
  for (const b of keys) {
    let w = 0, sh = 0;
    for (let g = 0; g < G; g++) {
      const env = new Env(arenas[g % arenas.length], 100 + g);
      const side = g % 2;
      const A = new CpuController(a, new Rng(1000 + g)), B = new CpuController(b, new Rng(2000 + g));
      while (!env.done) { const x = A.act(env, side), y = B.act(env, 1 - side); side === 0 ? env.step(x, y) : env.step(y, x); steps++; }
      const o = env.score(side), e = env.score(1 - side);
      if (o > e) w++; else if (o === e) w += 0.5;
      sh += o / (o + e);
    }
    line += `${(w / G * 100).toFixed(0).padStart(3)}% (${(sh / G * 100).toFixed(0)}%)`.padEnd(13);
  }
  console.log(line);
}
console.log('steps/s', (steps / ((Date.now() - t0) / 1000)).toFixed(0));
