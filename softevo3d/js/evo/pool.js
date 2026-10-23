// 評価ワーカーのプール
// 集団を何匹かずつに分けて複数のワーカーで同時に評価する。
// ワーカーが使えない環境では、画面を止めないよう1匹ずつ休みながらメインスレッドで評価する。

import { compileBody } from '../sim/body.js';
import { brainLayout } from '../sim/brain.js';
import { evaluate } from '../sim/creature.js';

const JOB_TIMEOUT = 90000;

export class EvalPool {
  constructor() {
    this.workers = [];
    this.broken = false;
    this.job = 0;
    this.pending = new Map();
    const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    this.maxWorkers = Math.max(1, Math.min(4, hc - 1));
    this._local = null;
  }

  _spawn(n) {
    while (this.workers.length < n && !this.broken) {
      let w;
      try {
        w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      } catch (e) {
        this.broken = true;
        break;
      }
      w.onmessage = (e) => this._onMsg(e.data);
      w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); this._fail(w); };
      this.workers.push(w);
    }
  }

  // task = { voxels, bodyKey, hidden, env }。結果は genomes と同じ順番
  async evaluate(task, genomes, parallel = 1) {
    if (!genomes.length) return [];
    if (!this.broken) this._spawn(Math.max(1, Math.min(parallel, this.maxWorkers)));
    if (this.broken || !this.workers.length) return this._evalLocal(task, genomes);
    const n = Math.max(1, Math.min(parallel, this.workers.length, genomes.length));
    const per = Math.ceil(genomes.length / n);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const slice = genomes.slice(i * per, (i + 1) * per);
      if (slice.length) parts.push(this._send(this.workers[i], task, slice));
    }
    try {
      const res = await Promise.all(parts);
      return [].concat(...res);
    } catch (e) {
      this.broken = true;
      this.terminate();
      return this._evalLocal(task, genomes);
    }
  }

  _send(w, task, genomes) {
    return new Promise((resolve, reject) => {
      const job = ++this.job;
      const timer = setTimeout(() => { if (this.pending.delete(job)) reject(new Error('timeout')); }, JOB_TIMEOUT);
      this.pending.set(job, { resolve, reject, w, timer });
      w.postMessage({ type: 'eval', job, voxels: task.voxels, bodyKey: task.bodyKey, hidden: task.hidden, env: task.env, genomes });
    });
  }

  _onMsg(m) {
    const p = this.pending.get(m.job);
    if (!p) return;
    this.pending.delete(m.job);
    clearTimeout(p.timer);
    if (m.type === 'done') p.resolve(m.results);
    else p.reject(new Error(m.message || 'worker error'));
  }

  _fail(w) {
    for (const [job, p] of this.pending) {
      if (p.w !== w) continue;
      this.pending.delete(job);
      clearTimeout(p.timer);
      p.reject(new Error('worker error'));
    }
  }

  async _evalLocal(task, genomes) {
    const key = task.bodyKey + '/' + task.hidden;
    if (!this._local || this._local.key !== key) {
      const body = compileBody(task.voxels);
      this._local = { key, body, L: brainLayout(body, task.hidden) };
    }
    const out = [];
    for (const g of genomes) {
      out.push(evaluate(this._local.body, this._local.L, g, task.env));
      await new Promise(r => setTimeout(r, 0));
    }
    return out;
  }

  terminate() {
    for (const w of this.workers) { try { w.terminate(); } catch (e) { /* noop */ } }
    this.workers = [];
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('terminated')); }
    this.pending.clear();
  }
}
