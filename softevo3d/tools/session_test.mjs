// 育成セッションの確認: node tools/session_test.mjs
//  ・世代を進めると できごと（レベル・わざ・記録）が出るか
//  ・保存→読みこみ のあとも、まったく同じ続きの進化になるか（乱数の状態・重みの保存）
import { Session, newRecord } from '../js/evo/session.js';
import { presetByKey } from '../js/sim/presets.js';
import { compileBody } from '../js/sim/body.js';
import { brainLayout } from '../js/sim/brain.js';
import { evaluate } from '../js/sim/creature.js';

const pool = {
  maxWorkers: 1,
  async evaluate(task, genomes) {
    const body = compileBody(task.voxels), L = brainLayout(body, task.hidden);
    return genomes.map(g => evaluate(body, L, g, task.env));
  },
};
const step = async (s) => { s.viewGen = s.lastGen; s.update(); while (s.busy) await new Promise(r => setTimeout(r, 1)); };

const rec = newRecord({ name: 'テスト', voxels: presetByKey('tokage').voxels, env: {}, popSize: 20 });
rec.seed = 42;
const a = new Session(rec, [], pool);
for (let g = 0; g < 8; g++) await step(a);
console.log('after 8 gens: level', rec.level, 'moves', Object.keys(rec.moves), 'best', rec.history.at(-1).best.toFixed(3));
for (const j of rec.journal) console.log('  G' + j.gen, j.kind, j.text);
// 保存（IndexedDB と同じく structuredClone）→ 読みこみ
a.save(true);
const rec2 = structuredClone(a.rec);
const champs2 = structuredClone(a.champs);
const b = new Session(rec2, champs2, pool);
const seqA = [], seqB = [];
for (let g = 0; g < 4; g++) { await step(a); seqA.push(a.champs.at(-1).fit); }
for (let g = 0; g < 4; g++) { await step(b); seqB.push(b.champs.at(-1).fit); }
const same = seqA.every((v, i) => v === seqB[i]);
console.log('continue A:', seqA.map(v => v.toFixed(4)).join(' '));
console.log('continue B:', seqB.map(v => v.toFixed(4)).join(' '));
console.log(same ? 'OK: 保存しても同じ続き' : 'NG: 続きがずれた');
// 環境を変える
b.setEnv({ terrain: 'hills', gravity: 'moon', objective: 'distance' });
await step(b);
console.log('env changed:', b.rec.envs.length, 'envs, last champ e =', b.champs.at(-1).e, 'fit', b.champs.at(-1).fit.toFixed(3));
process.exit(same ? 0 : 1);
