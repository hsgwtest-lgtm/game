// NURIBOTS — 起動とメインループ、画面の切りかえ

import { PixelRenderer } from './gfx/pixel.js';
import { World3D } from './gfx/world3d.js';
import { Input } from './ui/input.js';
import { UI, col } from './ui/ui.js';
import { Sound } from './core/audio.js';
import { Game } from './game/save.js';
import { persist } from './core/store.js';
import { TrainClient } from './ml/trainclient.js';
import { Spectator } from './game/spectator.js';
import { Online } from './net/online.js';
import { C } from './core/const.js';
import { text, textBlock } from './gfx/font.js';

import { TitleScreen } from './screens/title.js';
import { HomeScreen } from './screens/home.js';
import { DesignScreen } from './screens/design.js';
import { TrainScreen } from './screens/train.js';
import { LeagueScreen } from './screens/league.js';
import { BattleScreen } from './screens/battle.js';
import { ResultScreen } from './screens/result.js';
import { OnlineScreen } from './screens/online.js';
import { RoomScreen } from './screens/room.js';
import { GhostScreen } from './screens/ghosts.js';
import { AlbumScreen } from './screens/album.js';
import { HowtoScreen } from './screens/howto.js';
import { SettingsScreen } from './screens/settings.js';
import { NameScreen } from './screens/name.js';

const canvas = document.getElementById('c');

const app = {
  t: 0,
  fatal: null,
  screens: {},
  cur: null,
  curName: '',
  stack: [],
  get top() { return Math.max(this.r.safe.t, 4); },
  get bottom() { return Math.max(this.r.safe.b, 4); },
  get W() { return this.r.VW; },
  get H() { return this.r.VH; },
};

function boot() {
  app.r = new PixelRenderer(canvas);
  app.world = new World3D();
  app.input = new Input(canvas, app.r);
  app.sound = new Sound();
  app.ui = new UI(app.r.fb, app.input, app.sound);
  app.G = new Game().load();
  app.trainer = new TrainClient();
  app.spec = new Spectator(app);
  app.online = new Online(app);
  app.sound.setSfx(app.G.settings.sfx);
  app.sound.setMusic(app.G.settings.music);
  app.r.outline = app.G.settings.outline;
  app.input.onFirstGesture = () => app.sound.unlock();
  canvas.addEventListener('pointerdown', () => app.sound.unlock());
  persist();

  const S = {
    title: TitleScreen, home: HomeScreen, design: DesignScreen, train: TrainScreen, league: LeagueScreen,
    battle: BattleScreen, result: ResultScreen, online: OnlineScreen, room: RoomScreen, ghosts: GhostScreen,
    album: AlbumScreen, howto: HowtoScreen, settings: SettingsScreen, name: NameScreen,
  };
  for (const k in S) app.screens[k] = new S[k](app);

  app.go = (name, params = {}) => {
    const next = app.screens[name];
    if (!next) return;
    if (app.cur && app.cur.leave) app.cur.leave(name);
    app.prevName = app.curName;
    app.cur = next;
    app.curName = name;
    app.ui.scrolls.clear();
    app.ui.active = null;
    next.enter(params);
  };

  const startScreen = /[?&]screen=(\w+)/.exec(location.search);
  app.go(startScreen && app.screens[startScreen[1]] ? startScreen[1] : 'title');
  window.addEventListener('resize', () => app.r.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => app.r.resize(), 300));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { app.G.save(true); if (app.cur && app.cur.onHide) app.cur.onHide(); }
  });
  window.addEventListener('pagehide', () => app.G.save(true));
  document.getElementById('boot').classList.add('hide');
  window.__app = app;
  requestAnimationFrame(loop);
}

let last = 0;
function loop(t) {
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
  last = t;
  app.t += dt;
  const { r, ui, input, world } = app;
  try {
    input.frame();
    ui.safe = r.safe;
    ui.begin(dt);
    r.fb.clear();
    if (input.keys.includes('Escape') && app.cur && app.cur.back) app.cur.back();
    app.cur.update(dt);
    const v = app.cur.view ? app.cur.view() : null;
    if (v && v.h > 0) {
      r.setView(v.y, v.h);
      world.setAspect(r.aspect);
      world.setPad(v.padT || 0, v.padB || 0, v.h);
      world.update(dt);
    }
    app.cur.draw(ui);
    if (app.fatal) drawFatal();
    ui.end();
    r.render(v && v.h > 0 ? world.scene : null, world.camera, world.clear);
    app.sound.update();
    input.endFrame();
  } catch (e) {
    console.error(e);
    app.fatal = String(e && e.stack || e);
    try { r.fb.clear(); drawFatal(); r.render(null, null); } catch (e2) { /* ignore */ }
  }
  requestAnimationFrame(loop);
}

function drawFatal() {
  const fb = app.ui.fb;
  fb.rect(0, app.top, fb.w, 120, col(C.blood));
  text(fb, 'エラーが起きました', 6, app.top + 4, col(C.white));
  textBlock(fb, String(app.fatal).slice(0, 300), 6, app.top + 18, fb.w - 12, col(C.skin));
}

window.addEventListener('error', (e) => { if (app.r) app.fatal = (e.message || 'error') + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno; });
window.addEventListener('unhandledrejection', (e) => { console.warn('unhandled', e.reason); });

// Service Worker（オフラインで遊べるように）
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

boot();
