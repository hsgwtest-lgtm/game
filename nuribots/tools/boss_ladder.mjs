// ボスどうしの直接対決: node tools/boss_ladder.mjs a.json b.json ...
import fs from 'fs';
import { Match } from '../js/sim/match.js';
import { unpackQ8 } from '../js/ml/net.js';
const bs = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const nets = bs.map(b => unpackQ8(b.brain));
const G = 60;
for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
  let w = 0, sh = 0;
  for (let g = 0; g < G; g++) {
    const side = g % 2;
    const a = { type: 'net', net: nets[i] }, b = { type: 'net', net: nets[j] };
    const m = new Match({ arena: g % 6, seed: 7777 + g * 13, a: side === 0 ? a : b, b: side === 0 ? b : a, logging: false });
    const r = m.runToEnd();
    const mine = r.scores[side], theirs = r.scores[1 - side];
    if (mine > theirs) w++; else if (mine === theirs) w += 0.5;
    sh += mine / (mine + theirs);
  }
  console.log(`${bs[i].key} vs ${bs[j].key}: win ${(w / G * 100).toFixed(0)}% share ${(sh / G * 100).toFixed(1)}%`);
}
