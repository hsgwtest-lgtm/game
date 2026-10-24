// SoftEvo 3D B — 起動・画面の切りかえ・描画のループ・保存
import { makeRenderer } from './render/scene.js';
import * as store from './game/store.js';
import { newGame, SAVE_KEY } from './game/game.js';
import { WorkerPool } from './evo/engine.js';
import { $ } from './ui/dom.js';
import { HomeScreen } from './ui/home.js';
import { DesignScreen } from './ui/designer.js';
import { LabScreen } from './ui/lab.js';
import { TreeScreen } from './ui/tree.js';
import { OnlineScreen } from './ui/online.js';
import { ArenaScreen } from './ui/arena.js';

class App {
  async boot() {
    this.canvas = $('#gl');
    try {
      this.renderer = makeRenderer(this.canvas);
    } catch (e) {
      $('#boot span').textContent = 'この端末では 3D 表示（WebGL）が使えません。';
      return;
    }
    let g = null;
    try { g = await store.load(SAVE_KEY); } catch { g = null; }
    this.game = g && g.v === 1 ? g : newGame();
    this.setEra(this.game.era);
    this.screens = {
      home: new HomeScreen(this, $('#s-home')),
      design: new DesignScreen(this, $('#s-design')),
      lab: new LabScreen(this, $('#s-lab')),
      tree: new TreeScreen(this, $('#s-tree')),
      online: new OnlineScreen(this, $('#s-online')),
      arena: new ArenaScreen(this, $('#s-arena')),
    };
    this.cur = null;
    this.size = { w: 0, h: 0 };
    const onResize = () => this.resize();
    addEventListener('resize', onResize);
    addEventListener('orientationchange', () => setTimeout(onResize, 200));
    this.resize();
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); });
    // パネルの取っ手をタップすると、たたむ／ひらく（3Dを広く見たいとき）
    document.addEventListener('click', (e) => {
      const gp = e.target.closest && e.target.closest('.grip');
      if (gp && gp.parentElement) { gp.parentElement.classList.toggle('collapsed'); setTimeout(() => this.resize(), 30); }
    });
    addEventListener('pagehide', () => this.saveNow());
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    const q = new URLSearchParams(location.search);
    this.go(q.get('screen') || 'home');
    setTimeout(() => $('#boot').classList.add('out'), 150);
    setTimeout(() => $('#boot').remove(), 800);
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  pool() {
    if (!this._pool) this._pool = new WorkerPool(WorkerPool.size());
    return this._pool;
  }

  go(name, params = {}) {
    const next = this.screens[name] || this.screens.home;
    if (this.cur) { this.cur.leave(); this.cur.el.classList.remove('active'); }
    this.cur = next;
    next.el.classList.add('active');
    next.enter(params);
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.size = { w, h };
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    if (this.cur && this.cur.resize) this.cur.resize(w, h);
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.cur || document.hidden) return;
    try {
      this.cur.frame(dt, now);
      this.cur.render();
    } catch (e) {
      console.error(e);
    }
  }

  setEra(era) { document.body.dataset.era = String(era); }

  save() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.saveNow(), 1200);
  }
  saveNow() {
    clearTimeout(this._saveT);
    if (this.game) store.save(SAVE_KEY, this.game).catch(() => {});
  }
}

const app = new App();
window.__app = app;
app.boot();
