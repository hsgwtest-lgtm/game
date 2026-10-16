// 学習専用の Web Worker。重い計算を画面の描画と切り離して行う。
import { createModel, runTraining, DEFAULT_CONFIG } from './cnn.js';

let stopRequested = false;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'stop') {
    stopRequested = true;
    return;
  }
  if (m.type !== 'train') return;
  stopRequested = false;
  try {
    const model = createModel(DEFAULT_CONFIG, m.seed);
    if (m.params) model.P.set(m.params);
    const res = await runTraining({
      model,
      data: m.data,
      labels: m.labels,
      n: m.n,
      epochs: m.epochs,
      lr: m.lr,
      seed: m.seed,
      onProgress: (p) => self.postMessage({ type: 'progress', ...p }),
      onEpoch: (r) => self.postMessage({ type: 'epoch', ...r, params: model.P.slice() }),
      shouldStop: () => stopRequested,
      tick: () => new Promise((resolve) => setTimeout(resolve, 0)),
    });
    self.postMessage({ type: 'done', stopped: res.stopped, params: model.P.slice() });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
