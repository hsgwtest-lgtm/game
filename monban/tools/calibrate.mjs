// 各ステージが「画面で見える情報だけで」解けるかを確かめる（開発用）: node tools/calibrate.mjs [番号,番号]
// 見本の選び方を何通りも試し、「見本の列での正解数」が一番高い選び方を採る。その本番での正解率を出す
import { STAGES } from '../js/game/stages.js';
import { buildLevel, fitLevel, accuracy } from '../js/game/level.js';
import { METHODS } from '../js/ml/models.js';
import { ruleFeats } from '../js/game/rules.js';
import { makeRng } from '../js/ml/rng.js';

const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
const TRIES = +(process.env.TRIES || 150);
for (const def of STAGES) {
  if (only && !only.includes(def.id + 1)) continue;
  const level = buildLevel(def);
  const rel = [...ruleFeats(def.rule)].filter((f) => def.lenses.includes(f)).sort();
  const lensSets = rel.length === def.lenses.length ? [def.lenses] : [rel, def.lenses];
  console.log(`\n#${def.id + 1} ${def.name}  pool=${def.pool} budget=${def.budget} par=${def.par} pass=${def.pass} noise=${def.noise} seed+${(level.seed - def.seed) / 101}`);
  for (const m of def.cards) {
    const dial = METHODS[m].dial;
    for (const param of dial ? dial.values : [null]) {
      for (const lenses of lensSets) {
        const accs = [];
        const rng = makeRng(def.seed + 99);
        for (let k = 2; k <= def.budget; k++) {
          let best = null;
          const tries = m === 'nn' ? Math.min(TRIES, 40) : TRIES;
          for (let t = 0; t < tries; t++) {
            const picks = rng.shuffle(level.pool.map((_, i) => i)).slice(0, k);
            const model = fitLevel(level, picks, m, param, lenses);
            const a = accuracy(model, level.pool, 'badge');
            if (!best || a > best.a + 1e-9) best = { a, model };
          }
          accs.push(Math.round(accuracy(best.model, level.test) * 100));
        }
        const first = accs.findIndex((a) => a >= 90);
        console.log(`  ${m.padEnd(7)} ${String(param ?? '-').padStart(2)} lens=${lenses.length === def.lenses.length ? 'all' : 'rel'}  [2..] ${accs.join(' ')}  ${first >= 0 ? '≥90@' + (first + 2) : ''}`);
      }
    }
  }
}
