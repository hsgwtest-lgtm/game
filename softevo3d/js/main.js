// SoftEvo 3D — エントリーポイント
// 描画ループ・画面遷移・共通サービス（音・保存・入力・3D・評価ワーカー）をまとめる。

import { PixelRenderer } from './gfx/pixel.js';
import { World3D } from './world/world3d.js';
import { UI } from './ui/ui.js';
import { C } from './ui/widgets.js';
import { Sound } from './core/audio.js';
import { db } from './core/db.js';
import { EvalPool } from './evo/pool.js';
import { drawToasts } from './ui/overlay.js';
import { TitleScreen } from './screens/title.js';
import { ZukanScreen } from './screens/zukan.js';
import { BuildScreen } from './screens/build.js';
import { LabScreen } from './screens/lab.js';
import { ParadeScreen } from './screens/parade.js';
import { SettingsScreen } from './screens/settings.js';
import { readShareFromHash } from './core/share.js';

const DEFAULT_SETTINGS = {
  sound: true, bgm: true, outline: true, dither: 0.09, pop: 30, hidden: 12, last: null, help: {},
};

class App {
  constructor(settings) {
    this.canvas = document.getElementById('c');
    this.px = new PixelRenderer(this.canvas);
    this.world = new World3D(this.px.renderer);
    this.ui = new UI(this);
    this.sound = new Sound();
    this.settings = settings;
    this.sound.on = settings.sound;
    this.sound.bgmOn = settings.bgm;
    this.px.outline = settings.outline !== false;
    this.px.ditherAmt = settings.dither;
    this.pool = new EvalPool();
    this.modals = [];
    this.toasts = [];
    this.screens = {
      title: new TitleScreen(this),
      zukan: new ZukanScreen(this),
      build: new BuildScreen(this),
      lab: new LabScreen(this),
      parade: new ParadeScreen(this),
      settings: new SettingsScreen(this),
    };
    this.screen = null;
    this.screenName = '';
    this.trans = null;
    this.time = 0;
    this.last = performance.now();
    this.fps = 60; this.fpsAcc = 0; this.fpsN = 0;
    this.viewH = -1;
    this.ui.onFirstTouch = () => this.sound.unlock();
    this.ui.onTouchEnd = () => { const c = this.sound.ctx; if (!c || c.state !== 'running') this.sound.unlock(); };
    window.addEventListener('resize', () => this._onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._onResize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this._saveNow(); if (this.sound.ctx) this.sound.ctx.suspend(); }
      else if (this.sound.ctx) this.sound.ctx.resume();
    });
    window.addEventListener('pagehide', () => this._saveNow());
    this.incoming = readShareFromHash();
    const q = new URLSearchParams(location.search);
    const go = q.get('go');
    if (go && this.screens[go]) this._switch(go, { id: q.get('id'), preset: q.get('preset') });
    else this._switch('title', {});
    const boot = document.getElementById('boot');
    if (boot) boot.classList.add('hide');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  sfx(name) { this.sound.play(name); }

  saveSettings() { db.setMeta('settings', this.settings); }

  toast(textStr, color = C.yellow, dur = 2.4) {
    this.toasts.push({ text: textStr, color, t: 0, dur });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  openModal(m) { this.modals.push(m); if (m.open) m.open(); }
  closeModal(m) {
    const i = this.modals.indexOf(m);
    if (i >= 0) this.modals.splice(i, 1);
    if (m && m.onClose) m.onClose();
  }
  get topModal() { return this.modals.length ? this.modals[this.modals.length - 1] : null; }

  _saveNow() {
    try { if (this.screen && this.screen.saveNow) this.screen.saveNow(); } catch (e) { /* noop */ }
  }

  _onResize() {
    clearTimeout(this._rt);
    this._rt = setTimeout(() => {
      this.px.resize();
      this.viewH = -1;
      if (this.screen && this.screen.resize) this.screen.resize();
    }, 60);
  }

  go(name, params = {}) {
    if (this.trans) return;
    this.trans = { phase: 'out', t: 0, to: name, params };
  }

  _switch(name, params) {
    if (this.screen && this.screen.exit) this.screen.exit();
    this.modals = [];
    this.ui.reset();
    this.screenName = name;
    this.screen = this.screens[name];
    this.viewH = -1;
    this.screen.enter(params || {});
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    try {
      this.ui.flush();
      if (this.trans) {
        this.trans.t += dt;
        if (this.trans.phase === 'out' && this.trans.t >= 0.16) {
          this._switch(this.trans.to, this.trans.params);
          this.trans.phase = 'in'; this.trans.t = 0;
        } else if (this.trans.phase === 'in' && this.trans.t >= 0.18) {
          this.trans = null;
        }
      }
      const scr = this.screen;
      const modal = this.topModal;
      scr.update(dt, !!modal);
      if (modal && modal.update) modal.update(dt);
      for (const t of this.toasts) t.t += dt;
      this.toasts = this.toasts.filter(t => t.t < t.dur);
      const px = this.px;
      const vh = scr.viewHeight ? scr.viewHeight() : px.VH;
      px.setViewHeight(vh);
      if (vh !== this.viewH) { this.viewH = vh; this.world.setAspect(px.VW / Math.max(1, vh)); }
      this.world.update(dt);
      const fb = px.fb;
      fb.clear();
      this.ui.begin();
      scr.draw(fb);
      for (const m of this.modals) m.draw(fb, m === modal);
      drawToasts(this, fb);
      if (this.trans) {
        const f = this.trans.phase === 'out' ? this.trans.t / 0.16 : 1 - this.trans.t / 0.18;
        fb.dither(0, 0, px.VW, px.VH, C.ink, Math.round(Math.max(0, Math.min(1, f)) * 16));
      }
      px.render(vh > 0 ? this.world.scene : null, this.world.camera, this.world.clearColor);
    } catch (e) {
      console.error(e);
      this._showError(e);
    }
  }

  _showError(e) {
    if (this._errShown) return;
    this._errShown = true;
    const d = document.getElementById('boot');
    if (d) { d.classList.remove('hide'); d.style.font = '12px monospace'; d.style.color = '#ff0044'; d.textContent = 'ERROR: ' + (e && e.message); }
  }
}

async function start() {
  const boot = document.getElementById('boot');
  if (!window.THREE) { if (boot) boot.textContent = 'THREE.JS を読み込めませんでした'; return; }
  try {
    const saved = await db.getMeta('settings', null);
    const settings = Object.assign({}, DEFAULT_SETTINGS, saved || {});
    settings.help = Object.assign({}, saved && saved.help);
    window.__se3d = new App(settings);
  } catch (e) {
    console.error(e);
    if (boot) { boot.style.font = '12px monospace'; boot.style.color = '#ff0044'; boot.textContent = 'ERROR: ' + e.message; }
  }
}

start();

// オフライン用 Service Worker（テスト時は ?nosw で無効）
if ('serviceWorker' in navigator && !/[?&]nosw/.test(location.search)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* noop */ });
  });
}
