// 実験用: 環境変数でGAや目の設定を変えて、何世代でクリアできるかを調べる
// 例) STAGES=1 SEEDS=1,2,3 PM=0.05 SIGMA=0.2 node tools/exp.mjs
const E = process.env;
const cfg = await import('../js/core/config.js');
if (E.EYE_COLS) cfg.EYE.cols = Number(E.EYE_COLS);
if (E.EYE_ROWS) cfg.EYE.rows = Number(E.EYE_ROWS);
if (E.EYE_SUB) cfg.EYE.sub = Number(E.EYE_SUB);
if (E.HID) cfg.NET.hid = Number(E.HID);
if (E.LAM) cfg.EYE.lambda = Number(E.LAM);
const { Session, Bird, N_IN } = await import('../js/sim/flight.js');
const { Flock } = await import('../js/ml/ga.js');
const { MLP } = await import('../js/ml/nn.js');
const { RNG } = await import('../js/core/rng.js');
const { STAGES, WORLD } = cfg;

const stages = (E.STAGES ?? '1').split(',').map(Number);
const seeds = (E.SEEDS ?? '1,2,3').split(',').map(Number);
const maxGen = Number(E.GENS ?? 80);
const pop = Number(E.POP ?? 50);
const fix = Number(E.FIX ?? 1);           // 同じコースを何世代つづけるか
const jit = Number(E.JIT ?? 1);           // スタート位置のばらつき
const verbose = !!E.V;
const results = [];
const t0 = Date.now();
for (const seed of seeds) {
  const flock = new Flock({ size: pop, seed }).initRandom();
  if (E.PM) flock.override = { pm: Number(E.PM), sigma: Number(E.SIGMA ?? 0.2) };
  if (E.XR) flock.crossRate = Number(E.XR);
  if (E.TOUR) flock.tourK = Number(E.TOUR);
  if (E.TRUNC) flock.truncFrac = Number(E.TRUNC);
  const nets = [];
  const rng = new RNG(seed * 7919 + 1);
  const row = [];
  let gen = 0;
  for (const si of stages) {
    const st = STAGES[si];
    let cleared = -1, courseSeed = 0;
    for (let g = 0; g < maxGen; g++, gen++) {
      if (g % fix === 0) courseSeed = (rng.float() * 2 ** 32) >>> 0;
      const sess = new Session(st, courseSeed, { maxDist: st.goal });
      flock.members.forEach((m, i) => {
        const net = nets[i] || (nets[i] = new MLP(flock.nIn, flock.nHid, flock.nOut));
        net.w = m.genome;
        const b = new Bird({ x: (rng.float() - 0.5) * 2 * jit, y: WORLD.START_Y + (rng.float() - 0.5) * 2 * jit });
        b.ctrl = (bb) => net.forward(bb.inp, bb.out);
        b.tag = m; sess.add(b);
      });
      let steps = 0;
      while (!sess.done && steps < 30000) { sess.step(); steps++; }
      for (const b of sess.birds) { b.tag.fitness = b.dist + (E.NOSHAPE ? 0 : b.bonus); b.tag.cause = b.cause; }
      const s = flock.evolve(st.id);
      if (verbose && g % 5 === 0) console.log(`  seed${seed} st${st.id} g${g} best ${s.best.toFixed(0)} avg ${s.avg.toFixed(0)} med ${s.med.toFixed(0)} div ${s.div.toFixed(2)}`);
      if (s.best >= st.goal && cleared < 0) { cleared = g + 1; if (!E.NOSTOP) break; }
    }
    row.push(cleared);
  }
  results.push(row);
  console.log(`seed ${seed}: ${row.join(' ')}`);
}
console.log(`time ${((Date.now() - t0) / 1000).toFixed(0)}s  N_IN=${N_IN} P=${MLP.paramCount(N_IN, cfg.NET.hid, 2)}`);
