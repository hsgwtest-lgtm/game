// ボスをほかのボスと戦わせて仕上げる（リーグ学習）
//   node tools/finetune_boss.mjs <in.json> <steps> <out.json> rival1.json rival2.json ...
import fs from 'fs';
import { Trainer } from '../js/ml/trainer.js';
import { unpackFull, unpackQ8, packQ8, packFull } from '../js/ml/net.js';
const [inF, stepsS, outF, ...rivals] = process.argv.slice(2);
const steps = +stepsS;
const base = JSON.parse(fs.readFileSync(inF, 'utf8'));
const net = unpackFull(base.full);
const opps = [{ type: 'self', w: 2 }, { type: 'cpu', key: 'ace', w: 1 }];
for (const f of rivals) { const r = JSON.parse(fs.readFileSync(f, 'utf8')); opps.push({ type: 'net', id: r.key, net: unpackQ8(r.brain), temp: 0.6, w: 2 }); }
const tr = new Trainer({ seed: 4242, net, deck: base.deck, arenas: [0, 1, 2, 3, 4, 5], opponents: opps, ppo: { ent: 0.008, lr: 4e-4 }, steps: base.steps });
const t0 = Date.now(); const s0 = tr.steps;
while (tr.steps - s0 < steps) {
  tr.iterate();
  if (tr.iter % 50 === 0) {
    const s = tr.summary(60);
    console.log(`[ft ${base.key}] +${((tr.steps - s0) / 1e3).toFixed(0)}k win ${(s.winRate * 100).toFixed(0)}% | ${Object.entries(s.byOpp).map(([k, b]) => `${k}:${(b.winRate * 100).toFixed(0)}`).join(' ')} | ${((tr.steps - s0) / ((Date.now() - t0) / 1000)).toFixed(0)}/s`);
  }
}
fs.writeFileSync(outF, JSON.stringify({ ...base, steps: tr.steps, brain: packQ8(tr.net), full: packFull(tr.net) }));
console.log('saved', outF);
