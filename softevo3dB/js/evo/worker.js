// 評価係（Web Worker）: 遺伝子を受けとり、物理で1回ずつ試して成績を返す
// 物理は決定論なので、画面側で同じ遺伝子を再生すれば、ここで測った動きとまったく同じになる
import { compileModel } from '../sim/model.js';
import { evaluate } from '../sim/sim.js';

let model = null, env = null, key = '';

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'setup') {
      if (m.key !== key) { model = compileModel(m.design); key = m.key; }
      env = m.env;
      self.postMessage({ type: 'ready', key });
    } else if (m.type === 'eval') {
      const out = [];
      for (const job of m.jobs) {
        const r = evaluate(model, Float64Array.from(job.x), { ...env, assist: job.assist });
        out.push({ id: job.id, r });
      }
      self.postMessage({ type: 'done', batch: m.batch, out });
    }
  } catch (err) {
    self.postMessage({ type: 'error', batch: m.batch, message: String(err && err.message || err) });
  }
};
