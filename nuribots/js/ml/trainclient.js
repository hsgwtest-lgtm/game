// 画面側から学習ワーカーを操作する窓口。

export class TrainClient {
  constructor() {
    this.w = null;
    this.handlers = {};
    this.running = false;
    this.waiters = [];
  }

  on(type, fn) { this.handlers[type] = fn; return this; }

  start(cfg) {
    this.stopNow();
    this.w = new Worker(new URL('./train.worker.js', import.meta.url), { type: 'module' });
    this.w.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'params' || m.t === 'final') {
        const ws = this.waiters.splice(0);
        for (const r of ws) r(m);
      }
      const h = this.handlers[m.t];
      if (h) h(m);
    };
    this.w.onerror = (e) => {
      const h = this.handlers.error;
      if (h) h({ t: 'error', msg: (e && e.message) || 'worker error' });
    };
    const msg = { t: 'init', ...cfg };
    const transfer = [];
    this.w.postMessage(msg, transfer);
    this.running = true;
  }

  send(m) { if (this.w) this.w.postMessage(m); }
  setDeck(deck) { this.send({ t: 'deck', deck }); }
  setOpps(opps) { this.send({ t: 'opps', opps }); }
  setArenas(arenas) { this.send({ t: 'arenas', arenas }); }
  setEnt(ent) { this.send({ t: 'ent', ent }); }
  setSpeed(speed) { this.send({ t: 'speed', speed }); }
  pause() { this.send({ t: 'pause' }); }
  resume() { this.send({ t: 'resume' }); }

  // 今の脳を受け取る
  get(timeout = 4000) {
    if (!this.w) return Promise.resolve(null);
    return new Promise((res) => {
      const timer = setTimeout(() => res(null), timeout);
      this.waiters.push((m) => { clearTimeout(timer); res(m); });
      this.send({ t: 'get' });
    });
  }

  // 止めて最後の脳を受け取る
  async stop() {
    if (!this.w) return null;
    const p = new Promise((res) => {
      const timer = setTimeout(() => res(null), 5000);
      this.waiters.push((m) => { clearTimeout(timer); res(m); });
    });
    this.send({ t: 'stop' });
    const m = await p;
    this.stopNow();
    return m;
  }

  stopNow() {
    if (this.w) { this.w.terminate(); this.w = null; }
    this.running = false;
    this.waiters.splice(0).forEach(r => r(null));
  }
}
