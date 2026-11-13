// 開発用の実験（ブラウザなし）: node tools/lab.mjs <コマンド> [オプション]
//   expert            … お手本ロボの成功率と平均歩数（全現場）
//   dump [stage]      … 「AIの目」の画像を tools/out/ に書き出す
//   bc stage=anywhere demos=50 noise=0.15 epochs=30 … 模倣学習だけでどこまで行くか
//   rl stage=touch steps=200000 [demos=20 bcEpochs=30] … 強化学習（demos を付けると模倣→強化）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES, STAGE_BY_ID } from '../js/core/stages.js';
import { Env, expertAction, SNAP } from '../js/core/env.js';
import { Raster, IMG, OBS } from '../js/core/raster.js';
import { KeyNet } from '../js/core/nn.js';
import { DemoSet, addRobotDemos, BCTrainer } from '../js/core/bc.js';
import { evaluate } from '../js/core/policy.js';
import { PPO } from '../js/core/ppo.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cmd = args[0] || 'expert';
const opt = Object.fromEntries(args.slice(1).filter((a) => a.includes('=')).map((a) => a.split('=')));

function runExpert(stage, n, seed = 1) {
  const env = new Env(stage, seed);
  const a = [0, 0, 0];
  let ok = 0, steps = 0, fail = 0, timeout = 0, maxLen = 0;
  for (let i = 0; i < n; i++) {
    env.reset();
    while (!env.done) { expertAction(env, a); env.step(a[0], a[1], a[2]); }
    if (env.success) { ok++; steps += env.t; if (env.t > maxLen) maxLen = env.t; } else if (env.failed) fail++; else timeout++;
  }
  return { ok: ok / n, avgSteps: steps / Math.max(1, ok), maxLen, fail, timeout };
}

async function writePng(file, rgb, w, h, scale = 8) {
  const { createRequire } = await import('node:module');
  const sharp = createRequire('/opt/npm-tools/node_modules/')('sharp');
  await sharp(Buffer.from(rgb), { raw: { width: w, height: h, channels: 3 } }).resize(w * scale, h * scale, { kernel: 'nearest' }).png().toFile(file);
}

if (cmd === 'expert') {
  for (const st of STAGES) {
    const r = runExpert(st, +(opt.n || 2000));
    console.log(`${st.no}.${st.name.padEnd(6, '　')} 成功 ${(r.ok * 100).toFixed(1)}%  平均 ${r.avgSteps.toFixed(1)}歩  最長 ${r.maxLen}歩  失格 ${r.fail}  時間切れ ${r.timeout}`);
  }
} else if (cmd === 'dump') {
  const out = path.join(HERE, 'out'); fs.mkdirSync(out, { recursive: true });
  const ras = new Raster();
  const list = opt.stage ? [STAGE_BY_ID[opt.stage]] : STAGES;
  const cols = 8, rows = list.length;
  const sheet = new Uint8Array(cols * IMG * rows * IMG * 3);
  const snap = new Float32Array(SNAP), img = new Uint8Array(OBS), a = [0, 0, 0];
  list.forEach((st, r) => {
    const env = new Env(st, 7 + r);
    for (let c = 0; c < cols; c++) {
      if (env.done) env.reset();
      const skip = c === 0 ? 0 : 6 + c * 3;
      for (let k = 0; k < skip && !env.done; k++) { expertAction(env, a); env.step(a[0], a[1], a[2]); }
      env.snapshot(snap); ras.render(snap, 0, img);
      for (let y = 0; y < IMG; y++) sheet.set(img.subarray(y * IMG * 3, (y + 1) * IMG * 3), ((r * IMG + y) * cols * IMG + c * IMG) * 3);
    }
  });
  await writePng(path.join(out, 'eye.png'), sheet, cols * IMG, rows * IMG, 8);
  console.log('wrote', path.join(out, 'eye.png'));
}

function makeNet(seed) {
  const c = {};
  if (opt.net) { const [c1, k, h1, h2] = opt.net.split('-').map(Number); c.c1 = c1; c.keys = k; c.h1 = h1; c.h2 = h2 || h1; }
  if (opt.eps) c.eps = +opt.eps;
  return new KeyNet(c, seed);
}

if (cmd === 'bc') {
  const stages = (opt.stage || 'anywhere').split(',');
  for (const sid of stages) {
    const st = STAGE_BY_ID[sid];
    for (const nd of (opt.demos || '50').split(',').map(Number)) {
      for (const noise of (opt.noise || '0').split(',').map(Number)) {
        const set = new DemoSet();
        addRobotDemos(set, st, nd, +(opt.seed || 1), noise);
        const net = makeNet(+(opt.seed || 1));
        const tr = new BCTrainer(net, set, st, { lr: +(opt.lr || 1e-3), batch: +(opt.batch || 32), seed: 5, augment: opt.aug !== '0' });
        const epochs = +(opt.epochs || 30), every = +(opt.every || 10);
        const t0 = performance.now();
        let line = `${st.no}.${st.name} デモ${nd}本(${set.n}歩) ゆらぎ${noise}:`;
        let last = null;
        while (tr.epoch < epochs) {
          const r = tr.step();
          if (r) { last = r; if (r.epoch % every === 0 || r.epoch === epochs) {
            const g = evaluate(net, st, 200, 777, { greedy: true }), sm = evaluate(net, st, 200, 777, { greedy: false });
            line += `  [${r.epoch}] 誤差${r.loss.toFixed(3)} 一致${(r.acc * 100).toFixed(0)}% 成功 最大選択${(g.rate * 100).toFixed(0)}%/くじ${(sm.rate * 100).toFixed(0)}%`;
          } }
        }
        if (opt.temps) for (const T of opt.temps.split(',').map(Number)) { const e = evaluate(net, st, 300, 4242, { temp: T }); line += `  T${T}:${(e.rate * 100).toFixed(0)}%(${e.steps.toFixed(0)}歩)`; }
        console.log(line + `  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
      }
    }
  }
}

if (cmd === 'rl') {
  for (const sid of (opt.stage || 'touch').split(',')) {
    const st = STAGE_BY_ID[sid], seed = +(opt.seed || 1);
    const net = makeNet(seed);
    let head = `${st.no}.${st.name}`;
    const nd = +(opt.demos || 0);
    if (nd > 0) {
      const set = new DemoSet();
      addRobotDemos(set, st, nd, seed, +(opt.noise || 0.15));
      const tr = new BCTrainer(net, set, st, { lr: +(opt.bcLr || 2e-3), batch: 32, seed: 5 });
      const be = +(opt.bcEpochs || 30);
      while (tr.epoch < be) tr.step();
      head += ` 模倣(デモ${nd}本・${be}周)→成功${(evaluate(net, st, 300, 4242).rate * 100).toFixed(0)}%`;
    }
    console.log(head);
    const po = { seed };
    for (const k of ['envs', 'horizon', 'gamma', 'lam', 'clip', 'epochs', 'batch', 'lrActor', 'lrCritic', 'entropy', 'warmup', 'maxKL']) if (opt[k] !== undefined) po[k] = +opt[k];
    if (nd > 0 && po.warmup === undefined) po.warmup = 3;
    const ppo = new PPO(net, st, po);
    const total = +(opt.steps || 200000), every = +(opt.every || 10);
    const t0 = performance.now();
    while (ppo.steps < total) {
      const r = ppo.iterate();
      if (r.iter % every === 0 || ppo.steps >= total) {
        const ev = opt.eval ? ` 検定${(evaluate(net, st, 200, 4242).rate * 100).toFixed(0)}%` : '';
        console.log(`  ${String(r.steps).padStart(7)}歩 成功${r.rate == null ? '  –' : (r.rate * 100).toFixed(0).padStart(3)}% 直近${(r.success * 100).toFixed(0).padStart(3)}% 得点${r.ret.toFixed(2).padStart(6)} 長さ${r.len.toFixed(0).padStart(3)} 迷い${r.entropy.toFixed(2)} KL${r.kl.toFixed(3)} V誤差${r.vloss.toFixed(2)}${ev}  ${(r.steps / ((performance.now() - t0) / 1000)).toFixed(0)}歩/秒`);
      }
    }
    console.log(`  最終 検定 ${(evaluate(net, st, 500, 999).rate * 100).toFixed(1)}%  (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
