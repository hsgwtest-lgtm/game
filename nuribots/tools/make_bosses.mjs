// CPUリーグのボス（強化学習AI）を育てる
//   node tools/make_bosses.mjs <key> <steps> [out.json]
//   key: senpai / mirror / king
import fs from 'fs';
import { Trainer } from '../js/ml/trainer.js';
import { Env } from '../js/sim/env.js';
import { CpuController } from '../js/sim/bots.js';
import { NetController } from '../js/ml/policy.js';
import { Rng } from '../js/core/rng.js';
import { packQ8, unpackQ8, packFull, unpackFull } from '../js/ml/net.js';

const key = process.argv[2] || 'senpai';
const steps = +(process.argv[3] || 600000);
const out = process.argv[4] || `tools/boss_${key}.json`;
const ALL = [0, 1, 2, 3, 4, 5];

const CFG = {
  senpai: {
    deck: [{ id: 'paint', lv: 2 }, { id: 'steal', lv: 2 }, { id: 'win', lv: 2 }, { id: 'hit', lv: 1 }, { id: 'item', lv: 1 }, { id: 'idle', lv: -1 }],
    phases: [
      { until: 0.4, opps: [['nurio2', 1], ['guard', 1], ['ace', 1]] },
      { until: 1.0, opps: [['nurio2', 1], ['guard', 1], ['ace', 2], ['self', 1]] },
    ],
  },
  mirror: {
    deck: [{ id: 'paint', lv: 2 }, { id: 'steal', lv: 2 }, { id: 'win', lv: 2 }, { id: 'hit', lv: 1 }, { id: 'stunned', lv: -1 }, { id: 'item', lv: 1 }],
    phases: [
      { until: 0.25, opps: [['nurio2', 1], ['guard', 1], ['ace', 1]] },
      { until: 1.0, opps: [['ace', 1], ['guard', 1], ['self', 3]] },
    ],
  },
  king: {
    deck: [{ id: 'paint', lv: 2 }, { id: 'steal', lv: 2 }, { id: 'win', lv: 2 }, { id: 'lead', lv: 1 }, { id: 'hit', lv: 1 }, { id: 'stunned', lv: -1 }, { id: 'item', lv: 1 }],
    phases: [
      { until: 0.2, opps: [['nurio2', 1], ['guard', 1], ['ace', 1]] },
      { until: 1.0, opps: [['ace', 1], ['guard', 1], ['self', 4]] },
    ],
  },
};

const cfg = CFG[key];
const toOpps = (list) => list.map(([k, w]) => k === 'self' ? { type: 'self', w } : { type: 'cpu', key: k, w });
let resume = null;
if (process.env.RESUME && fs.existsSync(process.env.RESUME)) resume = unpackFull(JSON.parse(fs.readFileSync(process.env.RESUME, 'utf8')).full);
const tr = new Trainer({ seed: 1000 + key.length * 77, deck: cfg.deck, arenas: ALL, opponents: toOpps(cfg.phases[0].opps), ppo: { ent: 0.01, lr: 7e-4 }, net: resume || undefined });

function evaluate(net, oppKey, n = 60) {
  let win = 0, share = 0;
  for (let g = 0; g < n; g++) {
    const env = new Env(ALL[g % 6], 5000 + g);
    const side = g % 2;
    const me = new NetController(net, new Rng(900 + g), 0.6);
    const op = new CpuController(oppKey, new Rng(1900 + g));
    while (!env.done) { const a = me.act(env, side), b = op.act(env, 1 - side); side === 0 ? env.step(a, b) : env.step(b, a); }
    const o = env.score(side), e = env.score(1 - side);
    if (o > e) win++; else if (o === e) win += 0.5;
    share += o / (o + e);
  }
  return { win: win / n, share: share / n };
}

const t0 = Date.now();
let phase = 0;
while (tr.steps < steps) {
  const frac = tr.steps / steps;
  while (phase < cfg.phases.length - 1 && frac >= cfg.phases[phase].until) { phase++; tr.setOpponents(toOpps(cfg.phases[phase].opps)); }
  // 最後は学習率を下げて仕上げ
  if (frac > 0.8) tr.setLR(3e-4);
  tr.iterate();
  if (tr.iter % 50 === 0) {
    const s = tr.summary(60);
    const sec = (Date.now() - t0) / 1000;
    console.log(`[${key}] ${(tr.steps / 1e3).toFixed(0)}k win ${(s.winRate * 100).toFixed(0)}% share ${(s.share * 100).toFixed(1)}% | ${Object.entries(s.byOpp).map(([k, b]) => `${k}:${(b.winRate * 100).toFixed(0)}`).join(' ')} | ${(tr.steps / sec).toFixed(0)}/s`);
  }
}
const q = packQ8(tr.net);
const qn = unpackQ8(q);
const ev = {};
for (const k of ['nurio2', 'guard', 'ace']) ev[k] = evaluate(qn, k);
console.log(`[${key}] final`, JSON.stringify(ev));
fs.writeFileSync(out, JSON.stringify({ key, steps: tr.steps, deck: cfg.deck, brain: q, full: packFull(tr.net), eval: ev }));
console.log('saved', out);
