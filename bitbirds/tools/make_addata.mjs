// 広告用データを本物の学習から作る: node tools/make_addata.mjs
// ・ステージ1→2を実際に進化させた「世代ごとの最高・平均距離」
// ・模倣学習（お手本→まね）の誤差の推移
import fs from 'fs';
import { STAGES, WORLD, EYE } from '../js/core/config.js';
import { Session, Bird, EYE_CELLS } from '../js/sim/flight.js';
import { Flock } from '../js/ml/ga.js';
import { MLP } from '../js/ml/nn.js';
import { Imitator } from '../js/ml/imitate.js';
import { RNG } from '../js/core/rng.js';

const flock = new Flock({ size: 50, seed: 3 }).initRandom();
const rng = new RNG(11);
const nets = flock.members.map(() => new MLP(flock.nIn, flock.nHid, flock.nOut));
const hist = [];
for (let g = 0; g < 40; g++) {
  const st = STAGES[g < 12 ? 0 : 1];
  const s = new Session(st, (rng.float() * 2 ** 32) >>> 0, { maxDist: st.goal * 1.25 });
  flock.members.forEach((m, i) => {
    nets[i].w = m.genome;
    const b = new Bird({ x: rng.range(-2, 2), y: WORLD.START_Y + rng.range(-1.5, 1.5) });
    b.ctrl = (bb) => nets[i].forward(bb.inp, bb.out);
    b.tag = m; s.add(b);
  });
  while (!s.done) s.step();
  for (const b of s.birds) { b.tag.fitness = b.dist + b.bonus; b.tag.dist = b.dist; b.tag.cause = b.cause; }
  const r = flock.evolve(st.id);
  hist.push([Math.round(r.best), Math.round(r.avg)]);
}
console.log('history', hist.map(h => h[0]).join(' '));

// 模倣学習の誤差（先生＝人のかわりのプログラム）
const U = [], V = [];
for (let r = 0; r < EYE.rows; r++) for (let c = 0; c < EYE.cols; c++) { U.push(((c + 0.5) / EYE.cols) * 2 - 1); V.push(1 - ((r + 0.5) / EYE.rows) * 2); }
const im = new Imitator(6000, 2);
for (let run = 0; run < 3; run++) {
  const s = new Session(STAGES[0], 50 + run, { maxDist: 300 });
  s.add(new Bird({ ctrl: (b) => {
    let sw = 0, sx = 0, sy = 0;
    for (let i = 0; i < EYE_CELLS; i++) { const w = Math.pow(1 - b.eye[i], 3); sw += w; sx += w * U[i]; sy += w * V[i]; }
    b.out[0] = Math.max(-1, Math.min(1, 3 * sx / sw - 0.3 * b.vx / WORLD.VLAT));
    b.out[1] = Math.max(-1, Math.min(1, 3 * sy / sw - 0.3 * b.vy / WORLD.VLAT));
    im.add(b.inp, b.out[0], b.out[1]);
    im.train(4, 32);
  } }));
  while (!s.done) s.step();
}
const loss = im.lossHist.slice(0, 60).map(v => +v.toFixed(4));
console.log('loss', loss.length, loss[0], loss[loss.length - 1]);
fs.writeFileSync(new URL('../js/ad/addata.js', import.meta.url),
  '// 自動生成（tools/make_addata.mjs）: 実際の学習で記録したデータ\n' +
  `export const AD_HISTORY = ${JSON.stringify(hist)};\n` +
  `export const AD_LOSS = ${JSON.stringify(loss)};\n`);
