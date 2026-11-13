// main.js — 全体の流れ（タイトル・観察・ミッション）、ゲームループ、保存
import { View } from './render.js';
import { Sim } from './sim.js';
import { Gestures } from './input.js';
import { UI } from './ui.js';
import { evalMission, missionOptions, missionById } from './missions.js';
import { DAY_LEN } from './world.js';

const SAVE_KEY = 'hakoniwa:save:v1';
const PREF_KEY = 'hakoniwa:prefs:v1';

function readJSON(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}
function writeJSON(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
    return true;
  } catch (e) {
    return false;
  }
}

const app = {
  view: null,
  sim: null,
  ui: null,
  speed: 1,
  playing: false,
  prefs: Object.assign({ pixel: 2, shadows: true, colorMode: 'gene', speed: 1, clears: {} }, readJSON(PREF_KEY) || {}),
  saveAcc: 0,

  savePrefs() {
    this.prefs.speed = this.speed;
    writeJSON(PREF_KEY, this.prefs);
  },
  hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch (e) {
      return false;
    }
  },
  save() {
    if (!this.playing || !this.sim) return false;
    return writeJSON(SAVE_KEY, { v: 1, savedAt: Date.now(), sim: this.sim.toJSON() });
  },
  loadSave() {
    const o = readJSON(SAVE_KEY);
    if (!o || o.v !== 1 || !o.sim) return null;
    try {
      return Sim.fromJSON(o.sim);
    } catch (e) {
      return null;
    }
  },
  saveInfo() {
    const o = readJSON(SAVE_KEY);
    if (!o || !o.sim) return null;
    const day = Math.floor(o.sim.world.time / DAY_LEN) + 1;
    if (o.sim.mission) {
      const d = missionById(o.sim.mission.id);
      return `${d ? d.title : 'ミッション'}・${day}日目`;
    }
    return `観察中の島・${day}日目`;
  },

  setSim(sim) {
    this.sim = sim;
    this.view.setSim(sim);
    this.view.orbit.tx = 0;
    this.view.orbit.tz = 0;
  },
  setSpeed(n) {
    this.speed = n;
    this.ui.refreshSpeed();
    this.savePrefs();
  },
  startPlaying() {
    this.playing = true;
    this.view.orbit.rad = Math.max(this.view.orbit.rad, 50);
    this.ui.showGame();
    this.saveAcc = 0;
    this.save();
  },

  newSandbox() {
    this.setSim(Sim.create({ mode: 'sandbox' }));
    this.startPlaying();
    this.ui.toast('🏝️ 新しい島での観察をはじめました');
  },
  startMission(id) {
    this.setSim(Sim.create(missionOptions(id, Math.floor(Math.random() * 2 ** 31))));
    this.startPlaying();
    this.ui.missionIntro(id);
  },
  continueGame() {
    const sim = this.loadSave();
    if (!sim) {
      this.ui.toast('記録を読みこめませんでした。新しい島を始めてください');
      return;
    }
    this.setSim(sim);
    this.startPlaying();
    this.ui.toast('つづきから再開しました');
  },
  // ミッションの後もそのまま観察を続ける
  toSandbox() {
    const s = this.sim;
    if (s.mission && s.mission.status === 'clear') this.recordClear(s.mission);
    s.mode = 'sandbox';
    s.mission = null;
    s.god.inf = true;
    this.ui.refreshCosts();
    this.ui.hudAcc = 1;
    this.save();
  },
  recordClear(m) {
    const prev = this.prefs.clears[m.id];
    const day = Math.round(m.endDay * 10) / 10;
    if (!prev || day < prev.day) this.prefs.clears[m.id] = { day, at: Date.now() };
    this.savePrefs();
  },
  toTitle() {
    this.save();
    this.playing = false;
    this.ui.showTitle(this.saveInfo());
  },
};

function boot() {
  const canvas = document.getElementById('view');
  let view;
  try {
    view = new View(canvas);
  } catch (e) {
    document.getElementById('title').innerHTML =
      '<div class="title-card"><h1>はこにわ<br>進化島</h1><p class="lead">この端末では 3D 表示（WebGL）が使えないため、遊べませんでした。Safari の設定や、ほかのブラウザでお試しください。</p></div>';
    return;
  }
  app.view = view;
  view.pixel = app.prefs.pixel;
  view.colorMode = app.prefs.colorMode;
  view.setShadows(app.prefs.shadows);
  view.resize();
  app.speed = app.prefs.speed ?? 1;
  app.ui = new UI(app);

  // タイトルの後ろでは、保存された島（なければ新しい島）がゆっくり動いている
  const saved = app.loadSave();
  app.setSim(saved || Sim.create({ mode: 'sandbox' }));
  app.ui.showTitle(saved ? app.saveInfo() : null);

  new Gestures(canvas, view, (x, y) => app.ui.tap(x, y));
  window.addEventListener('resize', () => view.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => view.resize(), 200));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') app.save();
  });
  window.addEventListener('pagehide', () => app.save());

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const sim = app.sim;
    if (app.playing) {
      if (app.speed > 0) {
        const g = dt * app.speed;
        sim.update(g);
        const r = evalMission(sim, g);
        if (r) {
          if (r === 'clear') app.recordClear(sim.mission);
          app.ui.missionEnded(r);
          app.save();
        }
      }
      app.saveAcc += dt;
      if (app.saveAcc > 20) {
        app.saveAcc = 0;
        app.save();
      }
    } else {
      sim.update(dt);
      view.orbit.az += dt * 0.06;
    }
    if (sim.events.length) {
      view.onEvents(sim.events);
      app.ui.onEvents(sim.events);
      sim.events.length = 0;
    }
    view.render(dt);
    app.ui.tick(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  window.__hakoniwa = app;
}

boot();
