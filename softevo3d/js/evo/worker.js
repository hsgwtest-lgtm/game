// 評価ワーカー: 遺伝子を受け取り、10秒間のシミュレーションをして成績を返す
import { compileBody } from '../sim/body.js';
import { brainLayout } from '../sim/brain.js';
import { evaluate } from '../sim/creature.js';

let cache = { key: '', body: null, L: null };

self.onmessage = (e) => {
  const m = e.data;
  if (!m || m.type !== 'eval') return;
  try {
    const key = m.bodyKey + '/' + m.hidden;
    if (cache.key !== key) {
      const body = compileBody(m.voxels);
      cache = { key, body, L: brainLayout(body, m.hidden) };
    }
    const results = [];
    for (const g of m.genomes) results.push(evaluate(cache.body, cache.L, g, m.env));
    self.postMessage({ type: 'done', job: m.job, results });
  } catch (err) {
    self.postMessage({ type: 'error', job: m.job, message: String(err && err.message || err) });
  }
};
