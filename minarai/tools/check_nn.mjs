// ニューラルネットの検算（開発用）: node tools/check_nn.mjs
//   1) 逆伝播の勾配を、重みを少しずらした差分と見比べる
//   2) 実際の「AIの目」画像で、1枚あたりの計算時間を測る
import { KeyNet, Mlp, Adam, PROP } from '../js/core/nn.js';
import { makeRng } from '../js/core/rng.js';
import { STAGE_BY_ID } from '../js/core/stages.js';
import { Env, expertAction, SNAP } from '../js/core/env.js';
import { Raster, OBS } from '../js/core/raster.js';

function makeObs(n, stageId = 'sort', seed = 3, every = 1) {
  const env = new Env(STAGE_BY_ID[stageId], seed), ras = new Raster();
  const obs = new Uint8Array(n * OBS), prop = new Float32Array(n * PROP), snap = new Float32Array(SNAP), a = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (env.done) env.reset();
    env.snapshot(snap); ras.render(snap, 0, obs, i * OBS);
    prop[i * PROP] = env.a1; prop[i * PROP + 1] = env.a2; prop[i * PROP + 2] = env.grip;
    for (let k = 0; k < every && !env.done; k++) { expertAction(env, a); env.step(a[0], a[1], a[2]); }
  }
  return { obs, prop };
}

// ---- 1) 勾配の検算（ReLU の折れ目をまたがないよう、ずらす幅は小さく。ごく小さい勾配は丸め誤差に埋もれるので比べない）
{
  const n = 2, O = 8;
  const { obs, prop } = makeObs(n, 'sort', 3, 9);
  const offs = Int32Array.from({ length: n }, (_, i) => i * OBS);
  const net = new KeyNet({ c1: 6, keys: 5, h1: 12, h2: 10 }, 5);
  const r = makeRng(11);
  for (let i = 0; i < net.wo.w.length; i++) net.wo.w[i] = r.gauss() * 0.3;
  for (const p of [net.b1, net.b2]) for (let i = 0; i < p.w.length; i++) p.w[i] = -Math.abs(r.gauss()) * 0.05;
  for (const p of [net.ba, net.bb]) for (let i = 0; i < p.w.length; i++) p.w[i] = r.gauss() * 0.1;
  const tgt = Float32Array.from({ length: n * O }, () => r.gauss());
  const loss = () => { const z = net.forward(obs, offs, n, prop); let s = 0; for (let i = 0; i < n * O; i++) s += 0.5 * (z[i] - tgt[i]) ** 2; return s; };
  const z = net.forward(obs, offs, n, prop);
  const dz = new Float32Array(n * O);
  for (let i = 0; i < n * O; i++) dz[i] = z[i] - tgt[i];
  for (const p of net.params) p.g.fill(0);
  net.backward(dz);
  const names = ['w1', 'b1', 'w2', 'b2', 'wa', 'ba', 'wb', 'bb', 'wo', 'bo'];
  let bad = 0, tot = 0;
  net.params.forEach((p, pi) => {
    let b = 0, t = 0, mx = 0;
    for (let k = 0; k < 200; k++) {
      const i = r.int(p.w.length), w0 = p.w[i], eps = 3e-4;
      p.w[i] = w0 + eps; const lp = loss(); p.w[i] = w0 - eps; const lm = loss(); p.w[i] = w0;
      const num = (lp - lm) / (2 * eps), ana = p.g[i];
      if (Math.abs(num) < 2e-2 && Math.abs(ana) < 2e-2) continue;
      const rel = Math.abs(num - ana) / (Math.abs(num) + Math.abs(ana));
      t++; if (rel > 0.05) b++; if (rel > mx) mx = rel;
    }
    bad += b; tot += t;
    console.log(`勾配 ${names[pi].padEnd(3)} ずれ ${b}/${t}点  相対誤差の最大 ${mx.toFixed(3)}`);
  });
  console.log(bad <= tot * 0.02 ? 'OK: 勾配は差分とほぼ一致' : 'NG: 勾配がずれている');

  const m = new Mlp([7, 9, 5, 1], 3);
  const x = Float32Array.from({ length: 4 * 7 }, () => r.gauss());
  const t2 = Float32Array.from({ length: 4 }, () => r.gauss());
  const l2 = () => { const y = m.forward(x, 4); let s = 0; for (let i = 0; i < 4; i++) s += 0.5 * (y[i] - t2[i]) ** 2; return s; };
  const y = m.forward(x, 4); const dy = new Float32Array(4); for (let i = 0; i < 4; i++) dy[i] = y[i] - t2[i];
  for (const p of m.params) p.g.fill(0);
  m.backward(dy);
  let w2 = 0;
  for (const p of m.params) for (let t = 0; t < 10; t++) {
    const i = r.int(p.w.length), w0 = p.w[i], eps = 1e-3;
    p.w[i] = w0 + eps; const lp = l2(); p.w[i] = w0 - eps; const lm = l2(); p.w[i] = w0;
    const num = (lp - lm) / (2 * eps), rel = Math.abs(num - p.g[i]) / Math.max(1e-5, Math.abs(num) + Math.abs(p.g[i]));
    if (rel > w2) w2 = rel;
  }
  console.log(`Mlp 相対誤差の最大 ${w2.toExponential(2)} ${w2 < 0.02 ? 'OK' : 'NG'}`);
}

// ---- 2) 速さ
{
  const n = 64, reps = 40;
  const { obs, prop } = makeObs(n * 4, 'anywhere');
  const net = new KeyNet({}, 1);
  const offs = new Int32Array(n), pr = new Float32Array(n * PROP);
  const dz = new Float32Array(n * 8).fill(0.01);
  const opt = new Adam(net.params, 1e-4);
  const pick = (k) => { for (let i = 0; i < n; i++) { const j = (k * n + i) % (n * 4); offs[i] = j * OBS; pr.set(prop.subarray(j * PROP, j * PROP + PROP), i * PROP); } };
  for (let w = 0; w < 5; w++) { pick(w); net.forward(obs, offs, n, pr); net.backward(dz); }
  let t0 = performance.now();
  for (let k = 0; k < reps; k++) { pick(k); net.forward(obs, offs, n, pr); }
  const tf = (performance.now() - t0) / (reps * n);
  t0 = performance.now();
  for (let k = 0; k < reps; k++) { pick(k); opt.zero(); net.forward(obs, offs, n, pr); net.backward(dz); opt.step(); }
  const tt = (performance.now() - t0) / (reps * n);
  console.log(`KeyNet: パラメータ ${net.count()}個  順伝播 ${(tf * 1000).toFixed(0)}µs/枚  学習 ${(tt * 1000).toFixed(0)}µs/枚`);
  const ras = new Raster(), env = new Env(STAGE_BY_ID.sort, 1), snap = new Float32Array(SNAP), img = new Uint8Array(OBS);
  env.snapshot(snap);
  t0 = performance.now();
  for (let i = 0; i < 20000; i++) ras.render(snap, 0, img);
  console.log(`「AIの目」の描画 ${((performance.now() - t0) / 20000 * 1000).toFixed(1)}µs/枚`);
}
