// DOT DOJO — エントリーポイント
// 描画ループ・画面遷移・共通サービス（音・保存・入力・3D）をまとめる。

import { PixelRenderer } from './gfx/pixel.js';
import { World3D } from './world/world3d.js';
import { UI } from './ui/ui.js';
import { C } from './ui/widgets.js';
import { Sound } from './core/audio.js';
import { GameState } from './game/state.js';
import { Masters } from './game/masters.js';
import { TestScreen } from './screens/test.js';
import { TitleScreen } from './screens/title.js';
import { MenuScreen } from './screens/menu.js';
import { StageSelectScreen } from './screens/stages.js';
import { GAScreen } from './screens/ga.js';
import { RLScreen } from './screens/rl.js';
import { ILScreen } from './screens/il.js';
import { CompareScreen } from './screens/compare.js';
import { HowtoScreen } from './screens/howto.js';
import { RecordsScreen } from './screens/records.js';
import { SettingsScreen } from './screens/settings.js';

class App {
  constructor() {
    this.canvas = document.getElementById('c');
    this.px = new PixelRenderer(this.canvas);
    this.world = new World3D();
    this.ui = new UI(this);
    this.sound = new Sound();
    this.game = new GameState();
    this.game.load();
    this.sound.on = this.game.settings.sound;
    this.sound.bgmOn = this.game.settings.bgm;
    this.px.outline = this.game.settings.outline !== false;
    if (typeof this.game.settings.dither === 'number') this.px.ditherAmt = this.game.settings.dither;
    this.masters = new Masters(this);
    this.screens = {
      test: new TestScreen(this),
      title: new TitleScreen(this),
      menu: new MenuScreen(this),
      stages: new StageSelectScreen(this),
      ga: new GAScreen(this),
      rl: new RLScreen(this),
      il: new ILScreen(this),
      compare: new CompareScreen(this),
      howto: new HowtoScreen(this),
      records: new RecordsScreen(this),
      settings: new SettingsScreen(this),
    };
    this.screen = null;
    this.screenName = '';
    this.trans = null;
    this.time = 0;
    this.last = performance.now();
    this.fpsAcc = 0; this.fpsN = 0; this.fps = 60;
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
    // 開発用: ?test=world で3Dの確認画面、?go=ga&stage=ippo で修行画面から
    const q = new URLSearchParams(location.search);
    if (q.get('test')) this._switch('test', {});
    else if (q.get('go') && this.screens[q.get('go')]) this._switch(q.get('go'), { stage: q.get('stage') || 'ippo' });
    else this._switch('title', {});
    const boot = document.getElementById('boot');
    if (boot) boot.classList.add('hide');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  sfx(name) { this.sound.play(name); }

  _saveNow() {
    try { if (this.screen && this.screen.session) this.screen.session.save(); this.game.saveProgress(); } catch (e) { /* noop */ }
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
      scr.update(dt);
      const px = this.px;
      const vh = scr.viewHeight ? scr.viewHeight() : px.VH;
      px.setViewHeight(vh);
      if (vh !== this.viewH) { this.viewH = vh; this.world.frameCamera(px.VW / Math.max(1, vh)); }
      this.world.update(dt);
      const fb = px.fb;
      fb.clear();
      this.ui.begin();
      scr.draw(fb);
      if (this.trans) {
        const f = this.trans.phase === 'out' ? this.trans.t / 0.16 : 1 - this.trans.t / 0.18;
        fb.dither(0, 0, px.VW, px.VH, C.ink, Math.round(Math.max(0, Math.min(1, f)) * 16));
      }
      px.render(vh > 0 ? this.world.scene : null, this.world.camera, this.world.theme.fog);
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

function start() {
  if (!window.THREE) {
    const d = document.getElementById('boot');
    if (d) d.textContent = 'THREE.JS を読み込めませんでした';
    return;
  }
  try {
    window.__dd = new App();
  } catch (e) {
    console.error(e);
    const d = document.getElementById('boot');
    if (d) { d.style.font = '12px monospace'; d.style.color = '#ff0044'; d.textContent = 'ERROR: ' + e.message; }
  }
}

start();

// オフライン用 Service Worker（テスト時は ?nosw で無効）
if ('serviceWorker' in navigator && !/[?&]nosw/.test(location.search)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* noop */ });
  });
}
