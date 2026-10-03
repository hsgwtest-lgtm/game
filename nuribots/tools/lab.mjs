// ブラウザなしで学習を回す実験台。
//   node tools/lab.mjs [iters] [opp=koro] [arenas=0] [deck=paint:2,steal:2,win:2]
import { Trainer } from '../js/ml/trainer.js';
import { Env, RULE } from '../js/sim/env.js';
import { CpuController } from '../js/sim/bots.js';
import { NetController } from '../js/ml/policy.js';
import { Rng } from '../js/core/rng.js';
import { CARDS } from '../js/sim/rewards.js';

const iters = +(process.argv[2] || 60);
const opps = (process.argv[3] || 'koro').split(',');
const arenas = (process.argv[4] || '0').split(',').map(Number);
const deckStr = process.argv[5] || 'paint:2,steal:2,win:2';
const deck = deckStr.split(',').map(s => { const [id, lv] = s.split(':'); return { id, lv: +lv }; });
const ent = +(process.env.ENT || 0.01);
const lr = +(process.env.LR || 1e-3);
const seed = +(process.env.SEED || 7);
const h = process.env.H ? process.env.H.split(',').map(Number) : null;

const opponents = opps.map(k => k === 'self' ? { type: 'self', w: 1 } : { type: 'cpu', key: k, w: 1 });
const tr = new Trainer({ seed, deck, arenas, opponents, ppo: { ent, lr } });

export function evaluate(net, oppKey, arenaList, n = 40, temp = 1, seed0 = 999) {
  let win = 0, lose = 0, share = 0;
  for (let g = 0; g < n; g++) {
    const arena = arenaList[g % arenaList.length];
    const env = new Env(arena, seed0 + g);
    const side = g % 2;
    const me = new NetController(net, new Rng(seed0 * 7 + g), temp);
    const op = new CpuController(oppKey, new Rng(seed0 * 13 + g));
    while (!env.done) {
      const a = me.act(env, side);
      const b = op.act(env, 1 - side);
      side === 0 ? env.step(a, b) : env.step(b, a);
    }
    const o = env.score(side), e = env.score(1 - side);
    if (o > e) win++; else if (o < e) lose++;
    share += o / (o + e);
  }
  return { win: win / n, lose: lose / n, share: share / n };
}

const t0 = Date.now();
for (let i = 1; i <= iters; i++) {
  const L = tr.iterate();
  if (i % 5 === 0 || i === 1) {
    const s = tr.summary(40);
    const cards = deck.map(d => {
      const c = CARDS.find(c => c.id === d.id);
      return `${d.id}:${s.cards[c.ev].toFixed(1)}`;
    }).join(' ');
    const ev = s.evs;
    console.log(`it${String(i).padStart(4)} steps ${String(tr.steps).padStart(7)} | win ${(s.winRate * 100).toFixed(0).padStart(3)}% share ${(s.share * 100).toFixed(1)}% R ${s.R.toFixed(1)} | ${cards} | paint ${ev[0].toFixed(0)} steal ${ev[1].toFixed(0)} hit ${ev[3].toFixed(1)} stun ${ev[4].toFixed(1)} item ${ev[5].toFixed(1)} shot ${ev[10].toFixed(1)} bump ${ev[8].toFixed(1)} | ent ${L.entropy.toFixed(2)} kl ${L.kl.toFixed(3)} cf ${L.clipFrac.toFixed(2)} ev ${L.explained.toFixed(2)} | ${L.rollMs}+${L.learnMs}ms`);
  }
}
const sec = (Date.now() - t0) / 1000;
console.log(`done ${tr.steps} steps in ${sec.toFixed(1)}s = ${(tr.steps / sec).toFixed(0)} steps/s`);
for (const k of ['koro', 'nurio', 'oikake', 'nurio2', 'guard', 'ace']) {
  const r1 = evaluate(tr.net, k, arenas, 40, 1);
  const r2 = evaluate(tr.net, k, arenas, 40, 0.5);
  console.log(`vs ${k.padEnd(7)} T1: win ${(r1.win * 100).toFixed(0)}% share ${(r1.share * 100).toFixed(1)}% | T.5: win ${(r2.win * 100).toFixed(0)}% share ${(r2.share * 100).toFixed(1)}%`);
}
if (process.env.SAVE) {
  const { packFull } = await import('../js/ml/net.js');
  const fs = await import('fs');
  fs.writeFileSync(process.env.SAVE, JSON.stringify(packFull(tr.net)));
  console.log('saved', process.env.SAVE);
}
